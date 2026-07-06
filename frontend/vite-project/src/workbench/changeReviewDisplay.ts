import { computeHunks, type DiffHunk } from "../editor/lineDiff"

export interface PendingChangeReviewChange {
  path: string
  beforeContent: string | null
  afterContent: string | null
  action: string
}

export interface PendingChangeReviewBatch {
  id: string
  title: string
  source: string
  action: string
  applyStatus?: string | null
  blockReason?: string | null
  blockedPath?: string | null
  blockedAt?: number | null
  changes: PendingChangeReviewChange[]
}

export interface ChangeReviewMessage {
  kind: "blocked" | "info"
  title: string
  body: string
  path: string | null
}

export interface ChangeReviewFileModel {
  path: string
  action: string
  hunks: DiffHunk[]
  hunkCount: number
  canApply: boolean
  canReject: boolean
}

export interface ChangeReviewBatchModel {
  id: string
  title: string
  source: string
  action: string
  status: "pending" | "blocked"
  blocked: boolean
  blockedPath: string | null
  message: ChangeReviewMessage | null
  files: ChangeReviewFileModel[]
}

export interface ChangeOperationLogEntry {
  id: string
  type?: string | null
  source?: string | null
  agentId?: string | null
  runId?: string | null
  pathBefore?: string | null
  pathAfter?: string | null
  path?: string | null
  beforeContent?: string | null
  afterContent?: string | null
  action?: string | null
  reason?: string | null
  riskLevel?: string | null
  applyStatus?: string | null
  rollbackError?: string | null
  operationId?: string | null
  timestamp?: number | null
  createdAt?: number | null
}

export interface ChangeOperationLogModel {
  id: string
  title: string
  badge: string
  sourceKind: "agent" | "user"
  sourceLabel: string
  operationLabel: string
  primaryPath: string
  pathBefore: string | null
  pathAfter: string | null
  agentId: string | null
  runId: string | null
  riskLabel: string
  statusLabel: string
  rollbackBlocked: boolean
  blockedReasonLabel: string | null
  canRevert: boolean
  isGitDiff: false
  beforeContent: string | null
  afterContent: string | null
}

export function createChangeReviewBatchModel(batch: PendingChangeReviewBatch): ChangeReviewBatchModel {
  const blocked = batch.applyStatus === "blocked"
  const blockedPath = batch.blockedPath || null

  return {
    id: batch.id,
    title: batch.title,
    source: batch.source,
    action: batch.action,
    status: blocked ? "blocked" : "pending",
    blocked,
    blockedPath,
    message: blocked ? createBlockedMessage(batch.blockReason, blockedPath) : null,
    files: batch.changes.map((change) => createFileModel(change, blocked, blockedPath)),
  }
}

export function createChangeReviewBatchModels(
  batches: PendingChangeReviewBatch[],
): ChangeReviewBatchModel[] {
  return batches.map((batch) => createChangeReviewBatchModel(batch))
}

export function createOperationLogModels(entries: ChangeOperationLogEntry[]): ChangeOperationLogModel[] {
  return entries.map((entry) => {
    const source = normalizeSource(entry.source)
    const applyStatus = entry.applyStatus || "applied"
    const rollbackBlocked = applyStatus === "rollback_blocked"
    const primaryPath = entry.pathAfter || entry.pathBefore || entry.path || ""
    return {
      id: entry.id,
      title: source === "agent" ? "智能体变更集" : "用户操作",
      badge: source === "agent" ? "智能体操作记录" : "工作台操作记录",
      sourceKind: source,
      sourceLabel: source === "agent" ? "智能体" : "用户",
      operationLabel: formatOperationLabel(entry.type || entry.action || ""),
      primaryPath,
      pathBefore: entry.pathBefore || entry.path || null,
      pathAfter: entry.pathAfter || entry.path || null,
      agentId: entry.agentId || null,
      runId: entry.runId || null,
      riskLabel: formatRiskLabel(entry.riskLevel),
      statusLabel: formatStatusLabel(applyStatus),
      rollbackBlocked,
      blockedReasonLabel: rollbackBlocked ? formatBlockedReason(entry.rollbackError) : null,
      canRevert: applyStatus === "applied",
      isGitDiff: false,
      beforeContent: entry.beforeContent ?? null,
      afterContent: entry.afterContent ?? null,
    }
  })
}

export function createScmAgentChangeSetModels(entries: ChangeOperationLogEntry[]): ChangeOperationLogModel[] {
  return createOperationLogModels(entries).filter((entry) => entry.sourceKind === "agent")
}

function createFileModel(
  change: PendingChangeReviewChange,
  batchBlocked: boolean,
  blockedPath: string | null,
): ChangeReviewFileModel {
  const hunks = computeHunks(change.beforeContent ?? "", change.afterContent ?? "")
  const blockedThisFile = batchBlocked && (!blockedPath || blockedPath === change.path)
  return {
    path: change.path,
    action: change.action,
    hunks,
    hunkCount: hunks.length,
    canApply: !blockedThisFile,
    canReject: true,
  }
}

function normalizeSource(source: string | null | undefined): "agent" | "user" {
  return source === "agent" ? "agent" : "user"
}

function formatOperationLabel(type: string): string {
  if (type === "create_file") return "创建文件"
  if (type === "create_folder") return "创建文件夹"
  if (type === "update_file" || type === "edit" || type === "write") return "更新文件"
  if (type === "delete_file") return "删除文件"
  if (type === "rename_move") return "重命名 / 移动"
  if (type === "patch") return "补丁"
  return type ? type.replace(/[_-]+/g, " ") : "变更"
}

function formatRiskLabel(risk: string | null | undefined): string {
  if (risk === "high") return "高风险"
  if (risk === "medium") return "中风险"
  if (risk === "safe") return "安全"
  return "中风险"
}

function formatStatusLabel(status: string | null | undefined): string {
  if (status === "pending") return "待处理"
  if (status === "failed") return "失败"
  if (status === "rolled_back") return "已回滚"
  if (status === "rollback_blocked") return "回滚被阻止"
  return "已应用"
}

function formatBlockedReason(reason: string | null | undefined): string {
  if (reason === "manual-change-detected") return "检测到手动修改"
  if (!reason) return "回滚被阻止"
  return reason.replace(/[_-]+/g, " ")
}

function createBlockedMessage(reason: string | null | undefined, path: string | null): ChangeReviewMessage {
  if (reason === "manual-change-detected") {
    return {
      kind: "blocked",
      title: "检测到用户手动修改，已暂停应用",
      body: "智能体补丁基于旧内容生成。为避免覆盖你刚写的改动，请打开受影响文件检查差异，确认后重新生成或手动处理这组补丁。",
      path,
    }
  }

  return {
    kind: "blocked",
    title: "这组智能体变更已暂停",
    body: "当前补丁无法安全应用。请检查受影响文件后重试，Codek 不会静默写入到不确定的文件状态。",
    path,
  }
}
