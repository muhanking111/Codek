const fs = require("node:fs")
const crypto = require("node:crypto")
const os = require("node:os")
const path = require("node:path")

const TRUST_STATUSES = new Set(["trusted", "restricted", "unknown"])
const RESTRICTED_CAPABILITIES = Object.freeze({
  enabled: true,
  canExecuteCommands: false,
  canUseNetwork: false,
  canInstallExtensions: false,
  canWriteWorkspaceFiles: false,
})
const TRUSTED_CAPABILITIES = Object.freeze({
  enabled: false,
  canExecuteCommands: true,
  canUseNetwork: true,
  canInstallExtensions: true,
  canWriteWorkspaceFiles: true,
})
const STORE_FILE = path.join(
  process.env.CODEK_DATA || path.join(os.homedir(), ".codek"),
  "workspace-trust.json",
)
const ENTERPRISE_POLICY_FILE = path.join(
  process.env.CODEK_DATA || path.join(os.homedir(), ".codek"),
  "enterprise-policy.json",
)
const SECURITY_AUDIT_FILE = path.join(
  process.env.CODEK_DATA || path.join(os.homedir(), ".codek"),
  "workspace-security-audit.jsonl",
)

const DEFAULT_TRUST = Object.freeze({
  status: "unknown",
  trustedAt: null,
  updatedAt: null,
  trustedFolders: [],
})
const DEFAULT_ENTERPRISE_POLICY = Object.freeze({
  version: 1,
  allow: {
    actions: [],
    commands: [],
    tools: [],
    paths: [],
    providers: [],
    networkDomains: [],
  },
  deny: {
    actions: [],
    commands: [],
    tools: [],
    paths: [],
    providers: [],
    networkDomains: [],
  },
})
const WORKSPACE_TRUST_OWNER_EVIDENCE = Object.freeze({
  workspaceTrustServiceOwner: "desktop/services/workspaceTrust",
  trustStateSource: "workspaceTrustStore",
  extensionTrustGateOwner: "desktop/services/extensions-host install routes",
  securityPolicyOwner: "desktop/services/workspaceTrust enterprisePolicy",
  persistenceSource: "CODEK_DATA/workspace-trust.json",
  remainingTrustUiOwnerGap: "full WorkspaceTrustEditor/App shell owner is outside this backend contract",
  vscodeSourcePaths: Object.freeze([
    "src/vs/platform/workspace/common/workspaceTrust.ts",
    "src/vs/workbench/services/workspaces/common/workspaceTrust.ts",
    "src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts",
    "src/vs/workbench/contrib/workspace/browser/workspaceTrustEditor.ts",
  ]),
  codekSourcePaths: Object.freeze([
    "desktop/services/workspaceTrust/index.js",
    "desktop/services/extensions-host/index.js",
    "frontend/vite-project/src/workbench/extensionTrustRemoteAuthWorkbench.ts",
  ]),
  runtimeReference: false,
})

function normalizeRoot(root) {
  if (typeof root !== "string" || !root.trim()) return ""
  return path.resolve(root)
}

function readStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) return {}
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true })
  fs.writeFileSync(STORE_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8")
}

function sanitizeText(value, max = 200) {
  return String(value || "").trim().slice(0, max)
}

function sanitizeList(value, maxItems = 200) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => sanitizeText(item, 240))
    .filter(Boolean)
    .slice(0, maxItems)
}

function sanitizeTrustedFolders(value) {
  if (!Array.isArray(value)) return []
  const folders = []
  const seen = new Set()
  for (const item of value) {
    const folder = normalizeRoot(item)
    const key = folder.toLowerCase()
    if (!folder || seen.has(key)) continue
    seen.add(key)
    folders.push(folder)
  }
  return folders.slice(0, 200)
}

function sanitizePolicySection(section) {
  return {
    actions: sanitizeList(section?.actions),
    commands: sanitizeList(section?.commands),
    tools: sanitizeList(section?.tools),
    paths: sanitizeList(section?.paths),
    providers: sanitizeList(section?.providers),
    networkDomains: sanitizeList(section?.networkDomains),
  }
}

function sanitizeEnterprisePolicy(input) {
  return {
    version: 1,
    allow: sanitizePolicySection(input?.allow),
    deny: sanitizePolicySection(input?.deny),
  }
}

function readEnterprisePolicy() {
  try {
    if (!fs.existsSync(ENTERPRISE_POLICY_FILE)) return sanitizeEnterprisePolicy(DEFAULT_ENTERPRISE_POLICY)
    const parsed = JSON.parse(fs.readFileSync(ENTERPRISE_POLICY_FILE, "utf8"))
    return sanitizeEnterprisePolicy(parsed)
  } catch {
    return sanitizeEnterprisePolicy(DEFAULT_ENTERPRISE_POLICY)
  }
}

function writeEnterprisePolicy(patch) {
  const previous = readEnterprisePolicy()
  const next = sanitizeEnterprisePolicy({
    ...previous,
    ...(patch || {}),
    allow: { ...previous.allow, ...(patch?.allow || {}) },
    deny: { ...previous.deny, ...(patch?.deny || {}) },
  })
  fs.mkdirSync(path.dirname(ENTERPRISE_POLICY_FILE), { recursive: true })
  fs.writeFileSync(ENTERPRISE_POLICY_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8")
  return next
}

function sanitizeTrust(input) {
  const status = TRUST_STATUSES.has(input?.status) ? input.status : DEFAULT_TRUST.status
  const now = new Date().toISOString()
  return {
    status,
    trustedAt: status === "trusted" ? input?.trustedAt || now : null,
    updatedAt: now,
    trustedFolders: sanitizeTrustedFolders(input?.trustedFolders),
  }
}

function getWorkspaceTrust(root) {
  const normalized = normalizeRoot(root)
  if (!normalized) return { root: "", ...DEFAULT_TRUST }
  const store = readStore()
  const existing = store[normalized]
  return {
    root: normalized,
    ...DEFAULT_TRUST,
    ...(existing && typeof existing === "object" ? existing : {}),
  }
}

function setWorkspaceTrust(root, patch) {
  const normalized = normalizeRoot(root)
  if (!normalized) {
    const err = new Error("workspace root is required")
    err.statusCode = 400
    throw err
  }
  const store = readStore()
  const previous = getWorkspaceTrust(normalized)
  store[normalized] = sanitizeTrust({ ...previous, ...(patch || {}) })
  writeStore(store)
  return { root: normalized, ...store[normalized] }
}

function setTrustedFolders(root, folders) {
  return setWorkspaceTrust(root, {
    ...getWorkspaceTrust(root),
    trustedFolders: sanitizeTrustedFolders(folders),
  })
}

function isUriTrusted(root, uri) {
  const trust = getWorkspaceTrust(root)
  if (trust.status === "trusted") {
    return { uri: normalizeRoot(uri), trusted: true, trustedBy: trust.root }
  }
  const normalizedUri = normalizeRoot(uri)
  let matched = ""
  for (const folder of sanitizeTrustedFolders(trust.trustedFolders)) {
    const folderKey = folder.toLowerCase()
    const uriKey = normalizedUri.toLowerCase()
    if (uriKey === folderKey || uriKey.startsWith(`${folderKey}${path.sep}`)) {
      if (folder.length > matched.length) matched = folder
    }
  }
  return { uri: normalizedUri, trusted: Boolean(matched), trustedBy: matched }
}

function restrictedCapabilitiesForTrust(status) {
  if (status === "trusted") {
    return {
      ...TRUSTED_CAPABILITIES,
      reason: "",
    }
  }
  return {
    ...RESTRICTED_CAPABILITIES,
    reason: status === "restricted" ? "workspace is restricted" : "workspace trust is unknown",
  }
}

function getWorkspaceTrustModel(root) {
  const trust = getWorkspaceTrust(root)
  return {
    ...WORKSPACE_TRUST_OWNER_EVIDENCE,
    stateSource: "workspaceTrustStore+enterprisePolicy",
    root: trust.root,
    status: trust.status,
    trusted: trust.status === "trusted",
    trustedFolders: sanitizeTrustedFolders(trust.trustedFolders),
    restrictedMode: restrictedCapabilitiesForTrust(trust.status),
    capabilities: {
      requestWorkspaceTrust: true,
      trustedFolders: true,
      resourceTrustRequests: true,
      restrictedMode: true,
      securityAudit: true,
    },
    constraints: {
      noSecondTrustStore: true,
      preservesAgentPolicyGate: true,
      securityAuditPathOwnedByBackend: true,
      requestLifecycleEvidenceOnly: true,
      partialUiOwnerIsNotConnected: true,
    },
  }
}

function applyWorkspaceTrustToPolicy(policy, trust) {
  const status = trust?.status || "unknown"
  if (status === "trusted") {
    return {
      ...policy,
      workspaceTrust: status,
    }
  }
  if (status === "restricted") {
    return {
      ...policy,
      sandboxMode: "read-only",
      approvalMode: "untrusted",
      networkAllowed: false,
      workspaceTrust: status,
      restrictedReason: "workspace is restricted",
    }
  }
  return {
    ...policy,
    approvalMode: policy?.approvalMode === "never" ? "on-request" : policy?.approvalMode || "on-request",
    networkAllowed: false,
    workspaceTrust: "unknown",
    restrictedReason: "workspace trust is unknown",
  }
}

function commandDigest(command) {
  const normalized = sanitizeText(command, 4000).replace(/\s+/g, " ")
  if (!normalized) return { commandHash: "", commandLength: 0 }
  return {
    commandHash: crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16),
    commandLength: normalized.length,
  }
}

function writeSecurityAuditEvent(event) {
  const safe = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    root: normalizeRoot(event?.root),
    action: sanitizeText(event?.action, 120),
    category: sanitizeText(event?.category, 80),
    decision: event?.decision === "allowed" ? "allowed" : "blocked",
    code: sanitizeText(event?.code, 120),
    workspaceTrust: sanitizeText(event?.workspaceTrust, 40),
    policyRule: sanitizeText(event?.policyRule, 160),
    toolName: sanitizeText(event?.toolName, 120),
    provider: sanitizeText(event?.provider, 120),
    domain: sanitizeText(event?.domain, 160),
    pathHash: event?.path ? crypto.createHash("sha256").update(sanitizeText(event.path, 4000)).digest("hex").slice(0, 16) : "",
    ...commandDigest(event?.command),
  }
  try {
    fs.mkdirSync(path.dirname(SECURITY_AUDIT_FILE), { recursive: true })
    fs.appendFileSync(SECURITY_AUDIT_FILE, `${JSON.stringify(safe)}\n`, "utf8")
  } catch {
    // Audit write failures must not crash the workbench; gates still return their decision.
  }
  return safe
}

function listSecurityAuditEvents(limit = 100) {
  try {
    if (!fs.existsSync(SECURITY_AUDIT_FILE)) return []
    const lines = fs.readFileSync(SECURITY_AUDIT_FILE, "utf8").split(/\r?\n/).filter(Boolean)
    return lines.slice(-Math.max(1, Math.min(Number(limit) || 100, 500))).map((line) => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean).reverse()
  } catch {
    return []
  }
}

function normalizeComparable(value) {
  return sanitizeText(value, 4000).replace(/\\/g, "/").replace(/\s+/g, " ").toLowerCase()
}

function matchesRule(value, rule, mode = "exactOrPrefix") {
  const normalizedValue = normalizeComparable(value)
  const normalizedRule = normalizeComparable(rule)
  if (!normalizedValue || !normalizedRule) return false
  if (normalizedRule === "*") return true
  if (normalizedRule.endsWith("*")) return normalizedValue.startsWith(normalizedRule.slice(0, -1))
  if (mode === "command") return normalizedValue === normalizedRule || normalizedValue.startsWith(`${normalizedRule} `)
  if (mode === "path") {
    const trimmed = normalizedRule.replace(/\/+$/, "")
    return normalizedValue === trimmed || normalizedValue.startsWith(`${trimmed}/`)
  }
  return normalizedValue === normalizedRule || normalizedValue.startsWith(`${normalizedRule}.`)
}

function firstMatch(value, rules, mode) {
  return (rules || []).find((rule) => matchesRule(value, rule, mode)) || ""
}

function evaluateEnterprisePolicy(input = {}) {
  const policy = readEnterprisePolicy()
  const checks = [
    { key: "actions", value: input.action, mode: "exactOrPrefix", label: "动作" },
    { key: "commands", value: input.command, mode: "command", label: "命令" },
    { key: "tools", value: input.toolName, mode: "exactOrPrefix", label: "工具" },
    { key: "paths", value: input.path, mode: "path", label: "路径" },
    { key: "providers", value: input.provider, mode: "exactOrPrefix", label: "Provider" },
    { key: "networkDomains", value: input.domain, mode: "exactOrPrefix", label: "网络域名" },
  ]

  for (const check of checks) {
    if (!check.value) continue
    const denied = firstMatch(check.value, policy.deny[check.key], check.mode)
    if (denied) {
      return {
        allowed: false,
        code: "enterprise_policy_denied",
        message: `企业策略已禁止${check.label}: ${sanitizeText(check.value, 120)}`,
        policyRule: `${check.key}:deny:${denied}`,
      }
    }
  }

  for (const check of checks) {
    if (!check.value) continue
    const allowRules = policy.allow[check.key] || []
    if (allowRules.length > 0 && !firstMatch(check.value, allowRules, check.mode)) {
      return {
        allowed: false,
        code: "enterprise_policy_not_allowed",
        message: `企业策略未允许${check.label}: ${sanitizeText(check.value, 120)}`,
        policyRule: `${check.key}:allow`,
      }
    }
  }

  return {
    allowed: true,
    code: "enterprise_policy_allowed",
    message: "",
    policyRule: "",
  }
}

function evaluateWorkspaceTrustAction(root, action, options = {}) {
  const trust = getWorkspaceTrust(root)
  const actionName = action || "workbench action"
  if (trust.status === "restricted") {
    const decision = {
      ...WORKSPACE_TRUST_OWNER_EVIDENCE,
      allowed: false,
      status: trust.status,
      code: "workspace_trust_restricted",
      message: `当前工作区处于受限模式，已禁止${actionName}。请先信任工作区或切换到安全配置后重试。`,
    }
    writeSecurityAuditEvent({
      root,
      action: actionName,
      category: options.category || "workspace_trust",
      decision: "blocked",
      code: decision.code,
      workspaceTrust: trust.status,
      toolName: options.toolName,
      provider: options.provider,
      domain: options.domain,
      path: options.path,
    })
    return decision
  }
  if (trust.status === "unknown" && options.requireConfirmation !== false && options.confirmed !== true) {
    const decision = {
      ...WORKSPACE_TRUST_OWNER_EVIDENCE,
      allowed: false,
      status: trust.status,
      code: "workspace_trust_confirmation_required",
      message: `当前工作区尚未设置信任状态。${actionName}需要用户确认后才能继续。`,
    }
    writeSecurityAuditEvent({
      root,
      action: actionName,
      category: options.category || "workspace_trust",
      decision: "blocked",
      code: decision.code,
      workspaceTrust: trust.status,
      toolName: options.toolName,
      provider: options.provider,
      domain: options.domain,
      path: options.path,
    })
    return decision
  }

  const policyDecision = evaluateEnterprisePolicy({
    action: actionName,
    command: options.command,
    toolName: options.toolName,
    path: options.path,
    provider: options.provider,
    domain: options.domain,
  })
  if (!policyDecision.allowed) {
    const decision = {
      ...WORKSPACE_TRUST_OWNER_EVIDENCE,
      allowed: false,
      status: trust.status,
      code: policyDecision.code,
      message: policyDecision.message,
      policyRule: policyDecision.policyRule,
    }
    writeSecurityAuditEvent({
      root,
      action: actionName,
      category: options.category || "enterprise_policy",
      decision: "blocked",
      code: decision.code,
      workspaceTrust: trust.status,
      policyRule: decision.policyRule,
      command: options.command,
      toolName: options.toolName,
      provider: options.provider,
      domain: options.domain,
      path: options.path,
    })
    return decision
  }

  const decision = {
    ...WORKSPACE_TRUST_OWNER_EVIDENCE,
    allowed: true,
    status: trust.status,
    code: "workspace_trust_allowed",
    message: "",
  }
  if (options.audit === true) {
    writeSecurityAuditEvent({
      root,
      action: actionName,
      category: options.category || "workspace_trust",
      decision: "allowed",
      code: decision.code,
      workspaceTrust: trust.status,
      command: options.command,
      toolName: options.toolName,
      provider: options.provider,
      domain: options.domain,
      path: options.path,
    })
  }
  return decision
}

function evaluateCommandExecution(root, command, options = {}) {
  const decision = evaluateWorkspaceTrustAction(root, options.action || "执行命令", {
    ...options,
    category: options.category || "command_execution",
    command,
  })
  if (!decision.allowed) {
    return {
      ...decision,
      command: typeof command === "string" ? command.slice(0, 200) : "",
    }
  }
  return {
    ...decision,
    command: typeof command === "string" ? command.slice(0, 200) : "",
  }
}

function register(router) {
  router.register("GET", "/workspace/trust", async ({ query }) => ({
    ok: true,
    trust: getWorkspaceTrust(query?.root || query?.projectRoot || ""),
    statuses: [...TRUST_STATUSES],
  }))

  router.register("POST", "/workspace/trust", async ({ body }) => ({
    ok: true,
    trust: setWorkspaceTrust(body?.root || body?.projectRoot || "", body || {}),
  }))

  router.register("GET", "/workspace/enterprise-policy", async () => ({
    ok: true,
    policy: readEnterprisePolicy(),
    path: ENTERPRISE_POLICY_FILE,
  }))

  router.register("POST", "/workspace/enterprise-policy", async ({ body }) => ({
    ok: true,
    policy: writeEnterprisePolicy(body || {}),
    path: ENTERPRISE_POLICY_FILE,
  }))

  router.register("GET", "/workspace/security-audit", async ({ query }) => ({
    ok: true,
    events: listSecurityAuditEvents(query?.limit),
    path: SECURITY_AUDIT_FILE,
  }))
}

module.exports = {
  TRUST_STATUSES: [...TRUST_STATUSES],
  applyWorkspaceTrustToPolicy,
  evaluateEnterprisePolicy,
  evaluateCommandExecution,
  evaluateWorkspaceTrustAction,
  getWorkspaceTrust,
  getWorkspaceTrustModel,
  isUriTrusted,
  listSecurityAuditEvents,
  normalizeRoot,
  readEnterprisePolicy,
  register,
  setTrustedFolders,
  setWorkspaceTrust,
  WORKSPACE_TRUST_OWNER_EVIDENCE,
  writeEnterprisePolicy,
  writeSecurityAuditEvent,
}
