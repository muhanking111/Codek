import { settingsStore } from "../settings/settingsStore"

export type AgentMode = "ask" | "plan" | "agent" | "auto"

export type SandboxLevel = "none" | "local" | "docker"

export interface SandboxPolicy {
  level: SandboxLevel
  allowedCommands: string[]
  blockedPatterns: RegExp[]
  requireApproval: boolean
}

const ALLOWED_PREFIXES = [
  "npm test",
  "npm run test",
  "npm run lint",
  "npm run build",
  "yarn test",
  "yarn build",
  "pnpm test",
  "pnpm build",
  "git status",
  "git diff",
  "git log",
  "git branch",
  "ls",
  "dir",
  "cat",
  "type",
  "node --version",
  "npm --version",
  "tsc --noEmit",
  "vue-tsc",
]

const ALWAYS_BLOCKED: RegExp[] = [
  /\brm\s+-rf\s+\/(?:\s|$)/,
  /\brm\s+-rf\s+\*/,
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/[sf]\s+\/[qf]\s+c:/i,
  /\bmkfs\b/,
  /\bdd\s+if=.*\bof=\/dev\//,
  /:\s*\(\)\s*\{\s*:\|:&\s*\};:/,
  /shutdown\s+(?:-h|\/s)/i,
  /reboot\b/,
  /\bcurl\b.*\|\s*sh/,
  /\bwget\b.*\|\s*sh/,
  /chmod\s+777\s+\//,
]

const PLAN_POLICY: SandboxPolicy = {
  level: "none",
  allowedCommands: [],
  blockedPatterns: ALWAYS_BLOCKED,
  requireApproval: true,
}

const AGENT_POLICY: SandboxPolicy = {
  level: "local",
  allowedCommands: ALLOWED_PREFIXES,
  blockedPatterns: ALWAYS_BLOCKED,
  requireApproval: false,
}

const AUTO_POLICY: SandboxPolicy = {
  level: "docker",
  allowedCommands: ALLOWED_PREFIXES,
  blockedPatterns: ALWAYS_BLOCKED,
  requireApproval: false,
}

export function getPolicyForMode(mode: AgentMode): SandboxPolicy {
  const basePolicy =
    mode === "plan" || mode === "ask" ? PLAN_POLICY
    : mode === "agent" ? AGENT_POLICY
    : AUTO_POLICY
  return applyAgentSettings(basePolicy)
}

export interface PolicyCheckResult {
  allowed: boolean
  reason?: string
  requireApproval?: boolean
  routeTo?: SandboxLevel
}

export function checkCommand(command: string, policy: SandboxPolicy): PolicyCheckResult {
  const trimmed = command.trim()
  if (!trimmed) {
    return { allowed: false, reason: "Empty command" }
  }

  for (const pattern of policy.blockedPatterns) {
    if (pattern.test(trimmed)) {
      return { allowed: false, reason: `Blocked by destructive pattern: ${pattern}` }
    }
  }

  if (policy.level === "none") {
    return { allowed: false, reason: "Plan mode does not allow command execution" }
  }

  const isAllowed = policy.allowedCommands.some((prefix) => trimmed.startsWith(prefix))

  if (!isAllowed && policy.requireApproval) {
    return { allowed: true, requireApproval: true, routeTo: policy.level }
  }

  return { allowed: true, requireApproval: false, routeTo: policy.level }
}

export function checkCode(_language: string, code: string, policy: SandboxPolicy): PolicyCheckResult {
  if (policy.level === "none") {
    return { allowed: false, reason: "Plan mode does not allow code execution" }
  }

  for (const pattern of policy.blockedPatterns) {
    if (pattern.test(code)) {
      return { allowed: false, reason: `Code contains destructive pattern: ${pattern}` }
    }
  }

  const dangerousImports = /\b(?:os\.system|subprocess|child_process|execSync|spawnSync)\b/
  if (dangerousImports.test(code) && policy.level !== "docker") {
    return {
      allowed: true,
      requireApproval: false,
      routeTo: "docker",
    }
  }

  return { allowed: true, requireApproval: false, routeTo: policy.level }
}

export function explainPolicy(policy: SandboxPolicy): string {
  return [
    `Sandbox level: ${policy.level}`,
    `Allowed prefixes: ${policy.allowedCommands.length}`,
    `Blocked patterns: ${policy.blockedPatterns.length}`,
    `Require approval: ${policy.requireApproval}`,
  ].join("\n")
}

function applyAgentSettings(policy: SandboxPolicy): SandboxPolicy {
  const approvalMode = settingsStore.get<string>("codek.agent.approvalMode", "ask")
  const terminalPolicy = settingsStore.get<string>("codek.agent.terminalPolicy", "ask")
  const next: SandboxPolicy = {
    ...policy,
    allowedCommands: [...policy.allowedCommands],
    blockedPatterns: [...policy.blockedPatterns],
  }

  if (approvalMode === "read-only") {
    next.level = "none"
    next.allowedCommands = []
    next.requireApproval = true
  } else if (approvalMode === "ask") {
    next.requireApproval = true
  } else if (approvalMode === "workspace-auto") {
    next.requireApproval = false
  }

  if (terminalPolicy === "disabled") {
    next.level = "none"
    next.allowedCommands = []
    next.requireApproval = true
  } else if (terminalPolicy === "safe-only") {
    next.allowedCommands = ALLOWED_PREFIXES
  } else if (terminalPolicy === "ask") {
    next.requireApproval = true
  }

  return next
}
