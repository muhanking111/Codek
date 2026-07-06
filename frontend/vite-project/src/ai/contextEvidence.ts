import type { Mention } from "./mentions"
import type { RuleFile } from "../workspace/teamRules"
import type { ChatAttachment } from "../components/chatAttachments"

export interface ContextEvidenceMention {
  type: string
  id: string
  label: string
  detail?: string
  resolved: boolean
  truncated?: boolean
}

export interface ContextEvidenceAttachment {
  id?: string
  name: string
  size: number
  type: string
  kind: string
  status: string
  truncated: boolean
  error?: string
  contentLength?: number
}

export interface ContextEvidenceRule {
  path: string
  title: string
  glob: string | null
  priority: number
  contentLength: number
  truncated?: boolean
}

export interface ContextEvidenceWorkspaceSource {
  type: string
  label: string
  path?: string
  detail?: string
  count?: number
  contentLength?: number
  truncated?: boolean
}

export interface ContextEvidenceBudgetPolicy {
  modelWindowChars: number
  reservedResponseChars: number
  availableContextChars: number
  taskType: string
  riskLevel: string
  allocation: Record<string, number>
  overflowChars: number
}

export interface ContextEvidenceIndexStatus {
  enabled: boolean
  state: string
  indexedFiles: number
  indexableFiles: number
  excludedFiles: number
  workspaceRoots: number
  freshness: string
  updatedAt: number | null
}

export interface ContextEvidenceBudget {
  totalSources: number
  estimatedChars: number
  contextBlockChars: number
  attachmentTextChars: number
  ruleChars: number
  workspaceContextChars: number
  truncatedSources: number
  warningCount: number
  policy?: ContextEvidenceBudgetPolicy
}

export interface ContextEvidence {
  version: 1
  mentions: ContextEvidenceMention[]
  attachments: ContextEvidenceAttachment[]
  rules: ContextEvidenceRule[]
  workspaceSources: ContextEvidenceWorkspaceSource[]
  indexStatus?: ContextEvidenceIndexStatus | null
  warnings: string[]
  budget: ContextEvidenceBudget
}

function clip(value: unknown, limit = 240): string {
  const text = String(value ?? "")
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function attachmentContentLength(attachment: ChatAttachment): number {
  if (typeof attachment.content === "string") return attachment.content.length
  if (typeof attachment.dataUrl === "string") return attachment.dataUrl.length
  return 0
}

function finiteNumber(value: unknown, fallback = 0): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

function normalizeBudgetPolicy(
  policy: Partial<ContextEvidenceBudgetPolicy> | undefined,
  estimatedChars: number,
): ContextEvidenceBudgetPolicy {
  const modelWindowChars = Math.max(4_000, finiteNumber(policy?.modelWindowChars, 64_000))
  const reservedResponseChars = Math.max(1_000, finiteNumber(policy?.reservedResponseChars, 8_000))
  const availableContextChars = Math.max(1_000, finiteNumber(policy?.availableContextChars, modelWindowChars - reservedResponseChars))
  const allocation = {
    workspace: finiteNumber(policy?.allocation?.workspace, Math.floor(availableContextChars * 0.56)),
    mentions: finiteNumber(policy?.allocation?.mentions, Math.floor(availableContextChars * 0.18)),
    attachments: finiteNumber(policy?.allocation?.attachments, Math.floor(availableContextChars * 0.14)),
    rules: finiteNumber(policy?.allocation?.rules, Math.floor(availableContextChars * 0.08)),
    diagnostics: finiteNumber(policy?.allocation?.diagnostics, Math.floor(availableContextChars * 0.04)),
  }
  return {
    modelWindowChars,
    reservedResponseChars,
    availableContextChars,
    taskType: clip(policy?.taskType || "general", 80),
    riskLevel: clip(policy?.riskLevel || "normal", 80),
    allocation,
    overflowChars: Math.max(0, finiteNumber(policy?.overflowChars, estimatedChars - availableContextChars)),
  }
}

function normalizeIndexStatus(status: Partial<ContextEvidenceIndexStatus> | undefined): ContextEvidenceIndexStatus | null {
  if (!status || typeof status !== "object") return null
  return {
    enabled: status.enabled !== false,
    state: clip(status.state || "unknown", 80),
    indexedFiles: finiteNumber(status.indexedFiles),
    indexableFiles: finiteNumber(status.indexableFiles),
    excludedFiles: finiteNumber(status.excludedFiles),
    workspaceRoots: finiteNumber(status.workspaceRoots),
    freshness: clip(status.freshness || "unknown", 80),
    updatedAt: Number.isFinite(status.updatedAt) ? Number(status.updatedAt) : null,
  }
}

export function buildContextEvidence(input: {
  mentions?: Mention[]
  attachments?: ChatAttachment[]
  rules?: RuleFile[]
  workspaceSources?: ContextEvidenceWorkspaceSource[]
  indexStatus?: Partial<ContextEvidenceIndexStatus> | null
  budgetPolicy?: Partial<ContextEvidenceBudgetPolicy>
  contextBlock?: string
  attachmentWarnings?: string[]
} = {}): ContextEvidence {
  const mentions = (input.mentions || []).map((mention) => ({
    type: mention.type,
    id: clip(mention.id, 500),
    label: clip(mention.label, 240),
    detail: mention.detail ? clip(mention.detail, 500) : undefined,
    resolved: true,
    truncated: (mention as Mention & { truncated?: boolean }).truncated === true,
  }))

  const attachments = (input.attachments || []).map((attachment) => ({
    id: attachment.id ? clip(attachment.id, 240) : undefined,
    name: clip(attachment.name, 240),
    size: Number.isFinite(attachment.size) ? attachment.size : 0,
    type: clip(attachment.type, 120),
    kind: attachment.kind,
    status: attachment.status,
    truncated: attachment.truncated === true || attachment.status === "truncated",
    error: attachment.error ? clip(attachment.error, 500) : undefined,
    contentLength: attachmentContentLength(attachment),
  }))

  const rules = (input.rules || []).map((rule) => ({
    path: clip(rule.path, 500),
    title: clip(rule.title, 240),
    glob: rule.glob ? clip(rule.glob, 240) : null,
    priority: Number.isFinite(rule.priority) ? rule.priority : 0,
    contentLength: typeof rule.content === "string" ? rule.content.length : 0,
    truncated: (rule as RuleFile & { truncated?: boolean }).truncated === true,
  }))

  const workspaceSources = (input.workspaceSources || []).map((source) => ({
    type: clip(source.type, 80),
    label: clip(source.label, 240),
    path: source.path ? clip(source.path, 500) : undefined,
    detail: source.detail ? clip(source.detail, 500) : undefined,
    count: Number.isFinite(source.count) ? source.count : undefined,
    contentLength: Number.isFinite(source.contentLength) ? source.contentLength : 0,
    truncated: source.truncated === true,
  }))

  const contextBlockChars = typeof input.contextBlock === "string" ? input.contextBlock.length : 0
  const attachmentTextChars = attachments.reduce((sum, item) => sum + (item.kind === "text" ? item.contentLength || 0 : 0), 0)
  const ruleChars = rules.reduce((sum, item) => sum + item.contentLength, 0)
  const workspaceContextChars = workspaceSources.reduce((sum, item) => sum + (item.contentLength || 0), 0)
  const truncatedSources = mentions.filter((item) => item.truncated).length
    + attachments.filter((item) => item.truncated).length
    + rules.filter((item) => item.truncated).length
    + workspaceSources.filter((item) => item.truncated).length
  const warnings = (input.attachmentWarnings || []).slice(0, 20).map((warning) => clip(warning, 500))
  const estimatedChars = contextBlockChars + attachmentTextChars + ruleChars + workspaceContextChars
  const policy = normalizeBudgetPolicy(input.budgetPolicy, estimatedChars)
  const indexStatus = normalizeIndexStatus(input.indexStatus || undefined)

  return {
    version: 1,
    mentions,
    attachments,
    rules,
    workspaceSources,
    indexStatus,
    warnings,
    budget: {
      totalSources: mentions.length + attachments.length + rules.length + workspaceSources.length,
      estimatedChars,
      contextBlockChars,
      attachmentTextChars,
      ruleChars,
      workspaceContextChars,
      truncatedSources,
      warningCount: warnings.length,
      policy,
    },
  }
}
