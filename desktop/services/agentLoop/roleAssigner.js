const DEFAULT_TOOL_POLICIES = Object.freeze({
  planner: {
    allowedTools: ["readFile", "listDir", "searchCode", "search"],
    sandboxMode: "read-only",
    canWrite: false,
  },
  research: {
    allowedTools: ["readFile", "listDir", "searchCode", "search"],
    sandboxMode: "read-only",
    canWrite: false,
  },
  researcher: {
    allowedTools: ["readFile", "listDir", "searchCode", "search"],
    sandboxMode: "read-only",
    canWrite: false,
  },
  coder: {
    allowedTools: ["readFile", "listDir", "searchCode", "search", "writeFile", "applyPatch", "runCommand"],
    sandboxMode: "workspace-write",
    canWrite: true,
  },
  implementer: {
    allowedTools: ["readFile", "listDir", "searchCode", "search", "writeFile", "applyPatch", "runCommand"],
    sandboxMode: "workspace-write",
    canWrite: true,
  },
  reviewer: {
    allowedTools: ["readFile", "listDir", "searchCode", "search", "runCommand"],
    sandboxMode: "read-only",
    canWrite: false,
  },
  tester: {
    allowedTools: ["readFile", "listDir", "searchCode", "search", "runCommand"],
    sandboxMode: "workspace-write",
    canWrite: false,
  },
  verifier: {
    allowedTools: ["readFile", "listDir", "searchCode", "search", "runCommand"],
    sandboxMode: "workspace-write",
    canWrite: false,
  },
  security: {
    allowedTools: ["readFile", "listDir", "searchCode", "search", "runCommand"],
    sandboxMode: "read-only",
    canWrite: false,
  },
  docs: {
    allowedTools: ["readFile", "listDir", "searchCode", "search", "writeFile", "applyPatch", "runCommand"],
    sandboxMode: "workspace-write",
    canWrite: true,
  },
  release: {
    allowedTools: ["readFile", "listDir", "searchCode", "search", "runCommand"],
    sandboxMode: "workspace-write",
    canWrite: false,
  },
  integrator: {
    allowedTools: ["readFile", "listDir", "searchCode", "search", "writeFile", "applyPatch", "runCommand"],
    sandboxMode: "workspace-write",
    canWrite: true,
  },
})

const PATH_RE = /[\w./\\-]+\.(?:tsx|ts|jsx|json|js|vue|md|scss|css|html|java|py|rs|go|yaml|yml|sql)/gi
const CONSENSUS_ROLE_ORDER = ["reviewer", "tester", "security"]
const LEGACY_ROLE_ALIASES = Object.freeze({
  implementer: "coder",
  verifier: "tester",
  researcher: "research",
  integrator: "release",
})

function makeId(runId, phaseId, role) {
  return `${runId}_${phaseId}_${role}`.replace(/[^\w.-]+/g, "_")
}

function taskText(phase) {
  return [
    phase.name,
    phase.description,
    phase.instruction,
    ...(phase.tasks || []).flatMap((task) => [task.description, task.instruction]),
  ].filter(Boolean).join("\n")
}

function normalizeRole(role) {
  const value = String(role || "").toLowerCase()
  return LEGACY_ROLE_ALIASES[value] || value
}

function isWriteLike(text) {
  return /\b(write|edit|applyPatch|delete|create|modify|rewrite|refactor|implement|fix)\b/i.test(text) ||
    /(写|修改|编辑|删除|新增|创建|重构|替换|实现|修复)/.test(text)
}

function inferRole(phase, index, total) {
  const agent = normalizeRole(phase.agent || phase.agentRole || phase.role)
  if (DEFAULT_TOOL_POLICIES[agent]) return agent
  const text = taskText(phase)
  const writeLike = isWriteLike(text)
  if (index === 0 && /(plan|规划|分析|拆解)/i.test(text)) return "planner"
  if (!writeLike && /(security|auth|permission|secret|token|privacy|安全|权限|认证|密钥|隐私)/i.test(text)) return "security"
  if (!writeLike && /(review|audit|审查|检查|风险|复核)/i.test(text)) return "reviewer"
  if (!writeLike && /(test|verify|typecheck|lint|build|验证|测试|构建|类型检查|质量门)/i.test(text)) return "tester"
  if (writeLike) return "coder"
  if (/(doc|readme|manual|runbook|文档|说明|手册)/i.test(text)) return "docs"
  if (index === total - 1 && /(release|publish|package|gate|integrat|合并|汇总|交付|发布|打包|验收)/i.test(text)) return "release"
  if (/(research|调研|阅读|查找|分析|研究)/i.test(text)) return "research"
  return "coder"
}

function collectPaths(phase) {
  const files = new Set()
  for (const task of phase.tasks || []) {
    for (const file of task.files || []) files.add(String(file))
    const matches = String(task.description || "").match(PATH_RE) || []
    for (const file of matches) files.add(file.replace(/\\/g, "/"))
  }
  return [...files]
}

function phaseRisk(phase) {
  const explicit = String(phase.risk || phase.estimatedRisk || "").toLowerCase()
  if (["safe", "medium", "high"].includes(explicit)) return explicit
  const text = taskText(phase)
  if (/\b(delete|drop|rebase|push|publish|deploy|payment|auth|permission|secret|token|private key)\b/i.test(text)) return "high"
  if (/(删除|权限|认证|密钥|部署|发布|支付|隐私|数据库|危险)/.test(text)) return "high"
  if (/\b(refactor|migration|migrate|network|command)\b/i.test(text) || /(重构|迁移|命令|网络)/.test(text)) return "medium"
  return "safe"
}

function requiredConsensusRoles(phase, role) {
  if (typeof phase.consensusForStepId === "string" || typeof phase.consensusForPhaseId === "string") return []
  const risk = phaseRisk(phase)
  const text = taskText(phase)
  const required = new Set()
  const explicit = Array.isArray(phase.consensusWith)
    ? phase.consensusWith.map(normalizeRole).filter((item) => DEFAULT_TOOL_POLICIES[item])
    : []
  for (const item of explicit) required.add(item)

  if (phase.requiresConsensus === true || risk === "high") {
    required.add("reviewer")
    required.add("tester")
  }
  if (
    risk === "high" ||
    role === "security" ||
    /\b(auth|permission|secret|token|delete|network|payment|privacy|private key)\b/i.test(text) ||
    /(权限|认证|密钥|删除|网络|支付|隐私|安全)/.test(text)
  ) {
    required.add("security")
  }
  if (role !== "coder" && phase.requiresConsensus !== true && risk !== "high") {
    required.delete("reviewer")
    required.delete("tester")
  }
  return CONSENSUS_ROLE_ORDER.filter((roleName) => required.has(roleName) && roleName !== role)
}

function assignRoles({ runId, plan, projectRoot, executionStrategy = "single-agent" }) {
  if (!plan || !Array.isArray(plan.phases)) return []
  return plan.phases.map((phase, index) => {
    const role = inferRole(phase, index, plan.phases.length)
    const policy = DEFAULT_TOOL_POLICIES[role] || DEFAULT_TOOL_POLICIES.coder
    const paths = collectPaths(phase)
    const consensusWith = requiredConsensusRoles(phase, role)
    const consensusForStepId = typeof phase.consensusForStepId === "string"
      ? phase.consensusForStepId
      : typeof phase.consensusForPhaseId === "string"
        ? phase.consensusForPhaseId
        : null
    return {
      id: makeId(runId, phase.id, role),
      runId,
      phaseId: phase.id,
      role,
      agentRole: role,
      status: "queued",
      workspaceId: null,
      sandboxId: null,
      sandboxMode: policy.sandboxMode,
      allowedTools: [...policy.allowedTools],
      readPaths: paths.length ? paths : [projectRoot || "."],
      writePaths: policy.canWrite ? paths : [],
      lockedFiles: [],
      requiresConsensus: consensusWith.length > 0 || phase.requiresConsensus === true,
      consensusWith,
      consensusForStepId,
      executionStrategy,
      startedAt: null,
      completedAt: null,
    }
  })
}

module.exports = {
  DEFAULT_TOOL_POLICIES,
  assignRoles,
  inferRole,
  requiredConsensusRoles,
}
