function clip(value, limit = 240) {
  const text = String(value ?? "")
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeMention(mention = {}) {
  return {
    type: clip(mention.type, 80),
    id: clip(mention.id, 500),
    label: clip(mention.label, 240),
    detail: mention.detail ? clip(mention.detail, 500) : undefined,
    resolved: mention.resolved !== false,
    truncated: mention.truncated === true,
  }
}

function normalizeAttachment(attachment = {}) {
  return {
    id: attachment.id ? clip(attachment.id, 240) : undefined,
    name: clip(attachment.name, 240),
    size: finiteNumber(attachment.size),
    type: clip(attachment.type, 120),
    kind: clip(attachment.kind, 80),
    status: clip(attachment.status, 80),
    truncated: attachment.truncated === true || attachment.status === "truncated",
    error: attachment.error ? clip(attachment.error, 500) : undefined,
    contentLength: finiteNumber(attachment.contentLength),
  }
}

function normalizeRule(rule = {}) {
  return {
    path: clip(rule.path, 500),
    title: clip(rule.title, 240),
    glob: rule.glob ? clip(rule.glob, 240) : null,
    priority: finiteNumber(rule.priority),
    contentLength: finiteNumber(rule.contentLength),
    truncated: rule.truncated === true,
  }
}

function normalizeWorkspaceSource(source = {}) {
  return {
    type: clip(source.type, 80),
    label: clip(source.label, 240),
    path: source.path ? clip(source.path, 500) : undefined,
    detail: source.detail ? clip(source.detail, 500) : undefined,
    count: source.count == null ? undefined : finiteNumber(source.count),
    contentLength: finiteNumber(source.contentLength),
    truncated: source.truncated === true,
  }
}

function normalizeBudgetPolicy(policy = {}, estimatedChars = 0) {
  if (!policy || typeof policy !== "object") return undefined
  const modelWindowChars = Math.max(4000, finiteNumber(policy.modelWindowChars, 64000))
  const reservedResponseChars = Math.max(1000, finiteNumber(policy.reservedResponseChars, 8000))
  const availableContextChars = Math.max(1000, finiteNumber(policy.availableContextChars, modelWindowChars - reservedResponseChars))
  const allocationInput = policy.allocation && typeof policy.allocation === "object" ? policy.allocation : {}
  return {
    modelWindowChars,
    reservedResponseChars,
    availableContextChars,
    taskType: clip(policy.taskType || "general", 80),
    riskLevel: clip(policy.riskLevel || "normal", 80),
    allocation: {
      workspace: finiteNumber(allocationInput.workspace, Math.floor(availableContextChars * 0.56)),
      mentions: finiteNumber(allocationInput.mentions, Math.floor(availableContextChars * 0.18)),
      attachments: finiteNumber(allocationInput.attachments, Math.floor(availableContextChars * 0.14)),
      rules: finiteNumber(allocationInput.rules, Math.floor(availableContextChars * 0.08)),
      diagnostics: finiteNumber(allocationInput.diagnostics, Math.floor(availableContextChars * 0.04)),
    },
    overflowChars: Math.max(0, finiteNumber(policy.overflowChars, estimatedChars - availableContextChars)),
  }
}

function normalizeIndexStatus(status = {}) {
  if (!status || typeof status !== "object" || Object.keys(status).length === 0) return null
  return {
    enabled: status.enabled !== false,
    state: clip(status.state || "unknown", 80),
    indexedFiles: finiteNumber(status.indexedFiles),
    indexableFiles: finiteNumber(status.indexableFiles),
    excludedFiles: finiteNumber(status.excludedFiles),
    workspaceRoots: finiteNumber(status.workspaceRoots),
    freshness: clip(status.freshness || "unknown", 80),
    updatedAt: Number.isFinite(Number(status.updatedAt)) ? Number(status.updatedAt) : null,
  }
}

function normalizeBudget(inputBudget = {}, normalized) {
  const contextBlockChars = finiteNumber(inputBudget.contextBlockChars)
  const attachmentTextChars = finiteNumber(inputBudget.attachmentTextChars)
  const ruleChars = finiteNumber(inputBudget.ruleChars)
  const workspaceContextChars = finiteNumber(inputBudget.workspaceContextChars)
  const fallbackEstimated = contextBlockChars + attachmentTextChars + ruleChars + workspaceContextChars
  const estimatedChars = finiteNumber(inputBudget.estimatedChars, fallbackEstimated)
  return {
    totalSources: finiteNumber(inputBudget.totalSources, normalized.mentions.length + normalized.attachments.length + normalized.rules.length + normalized.workspaceSources.length),
    estimatedChars,
    contextBlockChars,
    attachmentTextChars,
    ruleChars,
    workspaceContextChars,
    truncatedSources: finiteNumber(
      inputBudget.truncatedSources,
      normalized.mentions.filter((item) => item.truncated).length
        + normalized.attachments.filter((item) => item.truncated).length
        + normalized.rules.filter((item) => item.truncated).length
        + normalized.workspaceSources.filter((item) => item.truncated).length,
    ),
    warningCount: finiteNumber(inputBudget.warningCount, normalized.warnings.length),
    policy: normalizeBudgetPolicy(inputBudget.policy, estimatedChars),
  }
}

function normalizeContextEvidence(input) {
  if (!input || typeof input !== "object") return null
  const normalized = {
    version: 1,
    mentions: Array.isArray(input.mentions) ? input.mentions.slice(0, 50).map(normalizeMention) : [],
    attachments: Array.isArray(input.attachments) ? input.attachments.slice(0, 50).map(normalizeAttachment) : [],
    rules: Array.isArray(input.rules) ? input.rules.slice(0, 50).map(normalizeRule) : [],
    workspaceSources: Array.isArray(input.workspaceSources) ? input.workspaceSources.slice(0, 80).map(normalizeWorkspaceSource) : [],
    indexStatus: normalizeIndexStatus(input.indexStatus),
    warnings: Array.isArray(input.warnings) ? input.warnings.slice(0, 20).map((warning) => clip(warning, 500)) : [],
    budget: null,
  }
  normalized.budget = normalizeBudget(input.budget || {}, normalized)
  return normalized
}

module.exports = {
  normalizeContextEvidence,
}
