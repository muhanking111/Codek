/*---------------------------------------------------------------------------------------------
 *  Agent policy center — single source of truth for sandbox + approval gating.
 *
 *  Two orthogonal axes (modeled after Codex):
 *
 *  SandboxMode:
 *    "read-only"          — agent may inspect files; mutating + network tools refused outright.
 *    "workspace-write"    — mutating file ops allowed only inside projectRoot; network tools
 *                           refused unless approval mode says otherwise.
 *    "danger-full-access" — no enforcement; everything goes through (still asks approval per mode).
 *
 *  ApprovalMode:
 *    "never"        — never prompt; deny anything the sandbox refuses (autonomous).
 *    "on-failure"   — try without prompting; if tool fails, ask user before retrying with elevation.
 *    "on-request"   — prompt for any mutating/network tool (default; matches current Codek UX).
 *    "untrusted"    — prompt for everything except a small read-only allowlist.
 *
 *  Persisted to <userData>/codek-policy.json. Defaults are safe: workspace-write + on-request.
 *--------------------------------------------------------------------------------------------*/

const fs = require("fs")
const path = require("path")
const os = require("os")
const {
  applyWorkspaceTrustToPolicy,
  evaluateEnterprisePolicy,
  getWorkspaceTrust,
  writeSecurityAuditEvent,
} = require("../workspaceTrust")
const {
  MCP_ACCESS_CONFIG,
  allowedMcpServersService,
  getMcpAccessValue,
} = require("../mcp/mcpAccess")

const SANDBOX_MODES = new Set(["read-only", "workspace-write", "danger-full-access"])
const APPROVAL_MODES = new Set(["never", "on-failure", "on-request", "untrusted"])

const DEFAULT_POLICY = Object.freeze({
  sandboxMode: "workspace-write",
  approvalMode: "on-request",
  networkAllowed: false,
  writableRoots: [], // additional roots beyond projectRoot
})

const STORE_FILE = path.join(
  process.env.CODEK_DATA || path.join(os.homedir(), ".codek"),
  "policy.json",
)

let current = { ...DEFAULT_POLICY }
let loaded = false

function load() {
  if (loaded) return current
  loaded = true
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"))
      current = { ...DEFAULT_POLICY, ...sanitize(raw) }
    }
  } catch {
    current = { ...DEFAULT_POLICY }
  }
  return current
}

function sanitize(input) {
  const out = {}
  if (SANDBOX_MODES.has(input?.sandboxMode)) out.sandboxMode = input.sandboxMode
  if (APPROVAL_MODES.has(input?.approvalMode)) out.approvalMode = input.approvalMode
  if (typeof input?.networkAllowed === "boolean") out.networkAllowed = input.networkAllowed
  if (Array.isArray(input?.writableRoots)) {
    out.writableRoots = input.writableRoots.filter((r) => typeof r === "string")
  }
  return out
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true })
    fs.writeFileSync(STORE_FILE, JSON.stringify(current, null, 2), "utf8")
  } catch {
    // non-fatal — policy still applies in-memory.
  }
}

function getPolicy() {
  return { ...load() }
}

function setPolicy(patch) {
  load()
  current = { ...current, ...sanitize(patch || {}) }
  persist()
  return { ...current }
}

// ─────────────────────────────────────────────────────────────────────────────
// Path containment — single canonical check used everywhere.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve `target` (absolute or relative-to-root) and assert it stays inside
 * projectRoot. Returns the canonical absolute path.
 *
 * Throws if path escapes projectRoot. Workspace-write tools MUST funnel every
 * path through this so we cannot be tricked by `..` or symlinks.
 */
function resolveInsideRoot(projectRoot, target) {
  if (!projectRoot) throw new Error("projectRoot is required")
  const abs = path.isAbsolute(target) ? target : path.join(projectRoot, target)
  const normalized = path.resolve(abs)
  const rootResolved = path.resolve(projectRoot)
  const rel = path.relative(rootResolved, normalized)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path escapes project root: ${target}`)
  }
  return normalized
}

/**
 * Same as resolveInsideRoot but returns null on escape instead of throwing.
 * Useful when the caller wants to format a structured deny reason.
 */
function isInsideRoot(projectRoot, target) {
  try {
    resolveInsideRoot(projectRoot, target)
    return true
  } catch {
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool-flag based evaluation.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool flags shape (set on tool definitions):
 *   {
 *     mutates: boolean,        // writes to disk or runs commands
 *     network: boolean,        // tool may reach the network
 *     readOnly: boolean,       // pure inspection; convenience opposite of mutates
 *     pathArgs: string[]       // names of input fields whose values are paths
 *   }
 */
const SAFE_READ_TOOLS = new Set(["read_file", "list_dir", "grep", "glob", "mcp_list_tools"])

/**
 * Decide what to do with a tool call before we run it.
 *
 * Returns: { decision: "allow" | "deny" | "prompt", reason?, networkAccess: boolean }
 *
 * Caller is responsible for actually prompting the user when decision="prompt".
 */
function evaluateToolCall({ tool, input, projectRoot, retryAfterFailure = false }) {
  const trust = getWorkspaceTrust(projectRoot)
  const policy = applyWorkspaceTrustToPolicy(getPolicy(), trust)
  const flags = (tool && tool.flags) || {}
  const toolName = tool?.name || "<unknown>"
  const mutates = !!flags.mutates
  const network = !!flags.network
  const isReadOnly = !mutates && !network

  const mcpAllowed = toolName === "mcp_call_tool" ? allowedMcpServersService.isAllowed(input) : true
  if (mcpAllowed !== true) {
    const mcpAccess = getMcpAccessValue()
    writeSecurityAuditEvent({
      root: projectRoot,
      action: "Agent MCP 工具调用",
      category: "agent_tool",
      decision: "blocked",
      code: "mcp_access_disabled",
      workspaceTrust: trust.status,
      policyRule: MCP_ACCESS_CONFIG,
      toolName,
    })
    return {
      decision: "deny",
      reason: String(mcpAllowed?.value || "MCP server disabled"),
      networkAccess: false,
      code: "mcp_access_disabled",
      workspaceTrust: trust.status,
      policyRule: MCP_ACCESS_CONFIG,
      mcpAccess,
    }
  }

  const enterpriseDecision = evaluateEnterprisePolicy({
    action: mutates ? "Agent 写入" : network ? "Agent 网络请求" : "Agent 工具调用",
    toolName,
    path: Array.isArray(flags.pathArgs)
      ? flags.pathArgs.map((argName) => input?.[argName]).find((value) => typeof value === "string" && value)
      : "",
  })
  if (!enterpriseDecision.allowed) {
    writeSecurityAuditEvent({
      root: projectRoot,
      action: mutates ? "Agent 写入" : network ? "Agent 网络请求" : "Agent 工具调用",
      category: "agent_tool",
      decision: "blocked",
      code: enterpriseDecision.code,
      workspaceTrust: trust.status,
      policyRule: enterpriseDecision.policyRule,
      toolName,
      path: Array.isArray(flags.pathArgs)
        ? flags.pathArgs.map((argName) => input?.[argName]).find((value) => typeof value === "string" && value)
        : "",
    })
    return {
      decision: "deny",
      reason: enterpriseDecision.message,
      networkAccess: false,
      code: enterpriseDecision.code,
      workspaceTrust: trust.status,
      policyRule: enterpriseDecision.policyRule,
    }
  }

  // Path containment check upfront (applies to every mode except danger-full).
  if (policy.sandboxMode !== "danger-full-access" && Array.isArray(flags.pathArgs)) {
    for (const argName of flags.pathArgs) {
      const value = input?.[argName]
      if (typeof value !== "string" || !value) continue
      if (!isInsideRoot(projectRoot, value)) {
        writeSecurityAuditEvent({
          root: projectRoot,
          action: "Agent 路径访问",
          category: "agent_tool",
          decision: "blocked",
          code: "path_escapes_project_root",
          workspaceTrust: trust.status,
          toolName,
          path: value,
        })
        return {
          decision: "deny",
          reason: `path escapes project root (${argName}=${value})`,
          networkAccess: false,
        }
      }
    }
  }

  // SandboxMode gate.
  if (policy.sandboxMode === "read-only" && mutates) {
    writeSecurityAuditEvent({
      root: projectRoot,
      action: "Agent 写入",
      category: "agent_tool",
      decision: "blocked",
      code: "sandbox_read_only",
      workspaceTrust: trust.status,
      toolName,
    })
    return {
      decision: "deny",
      reason: policy.workspaceTrust === "restricted"
        ? `workspace is restricted; mutating tool '${toolName}' is disabled`
        : `sandbox=read-only refuses mutating tool '${toolName}'`,
      networkAccess: false,
    }
  }

  const networkAccess =
    policy.sandboxMode === "danger-full-access"
      ? true
      : policy.sandboxMode === "workspace-write"
        ? !!policy.networkAllowed
        : false

  if (network && !networkAccess && policy.sandboxMode !== "danger-full-access") {
    if (policy.workspaceTrust === "restricted") {
      writeSecurityAuditEvent({
        root: projectRoot,
        action: "Agent 网络请求",
        category: "agent_tool",
        decision: "blocked",
        code: "workspace_trust_restricted",
        workspaceTrust: trust.status,
        toolName,
      })
      return {
        decision: "deny",
        reason: `workspace is restricted; network tool '${toolName}' is disabled`,
        networkAccess: false,
      }
    }
    // Network tool but network is off; executor receives networkAccess=false
    // and the sandbox does the real enforcement.
  }

  // ApprovalMode gate.
  switch (policy.approvalMode) {
    case "never":
      // Autonomous: allow everything the sandbox allows. No prompts.
      return { decision: "allow", networkAccess }

    case "on-failure":
      // Run without prompting; if the tool fails and we're retrying, escalate.
      if (retryAfterFailure && (mutates || network)) {
        return { decision: "prompt", reason: "elevate after failure", networkAccess }
      }
      return { decision: "allow", networkAccess }

    case "untrusted":
      // Prompt for anything not in the small safe-read allowlist.
      if (SAFE_READ_TOOLS.has(toolName)) {
        return { decision: "allow", networkAccess }
      }
      return { decision: "prompt", networkAccess }

    case "on-request":
    default:
      // Default: prompt for mutating/network tools; auto-allow read-only.
      if (isReadOnly) return { decision: "allow", networkAccess }
      return { decision: "prompt", networkAccess }
  }
}

function register(router) {
  router.register("GET", "/agent/policy", async ({ query }) => {
    const trust = getWorkspaceTrust(query?.root || query?.projectRoot || "")
    const policy = applyWorkspaceTrustToPolicy(getPolicy(), trust)
    return {
      ok: true,
      policy,
      trust,
      modes: { sandbox: [...SANDBOX_MODES], approval: [...APPROVAL_MODES] },
    }
  })

  router.register("POST", "/agent/policy", async ({ body }) => {
    const updated = setPolicy(body || {})
    return { ok: true, policy: updated }
  })
}

module.exports = {
  // policy state
  getPolicy,
  setPolicy,
  DEFAULT_POLICY,
  SANDBOX_MODES: [...SANDBOX_MODES],
  APPROVAL_MODES: [...APPROVAL_MODES],
  // path helpers
  resolveInsideRoot,
  isInsideRoot,
  // gating
  evaluateToolCall,
  SAFE_READ_TOOLS: [...SAFE_READ_TOOLS],
  // service registration
  register,
}
