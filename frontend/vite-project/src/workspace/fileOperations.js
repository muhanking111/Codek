import { reactive } from "vue"

const MAX_OPERATION_ENTRIES = 500

export const fileOperationState = reactive({
  operations: [],
})

const listeners = new Set()

function makeId() {
  return `file-op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizePath(pathValue) {
  return String(pathValue || "").replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "")
}

function normalizeRisk(riskLevel) {
  if (riskLevel === "high" || riskLevel === "medium" || riskLevel === "safe") return riskLevel
  return "medium"
}

function inferRiskLevel(type) {
  if (type === "delete_file" || type === "rename_move") return "high"
  if (type === "update_file") return "medium"
  return "safe"
}

function normalizeStatus(status) {
  if (
    status === "pending"
    || status === "applied"
    || status === "failed"
    || status === "rolled_back"
    || status === "rollback_blocked"
  ) return status
  return "applied"
}

function normalizeResourceUriKind(value) {
  if (value === "workspace-relative" || value === "file-uri" || value === "unknown") return value
  return "workspace-relative"
}

function isDestructiveOperation(type) {
  return type === "delete_file" || type === "rename_move"
}

function defaultOperationSource(input) {
  if (input?.operationSource) return input.operationSource
  const source = input?.source || "user"
  return `workspace.fileOperations.${source}`
}

function defaultReadonlyGuard(input) {
  if (input?.readonlyGuard) return input.readonlyGuard
  if (input?.serviceOperationResult === "readonly" || input?.failureCause === "readonly") return "blocked-readonly"
  return "not-evaluated"
}

function defaultDestructiveGuard(input) {
  if (input?.destructiveGuard) return input.destructiveGuard
  return isDestructiveOperation(input?.type) ? "operation-log-required" : "not-destructive"
}

function publish(event) {
  for (const listener of Array.from(listeners)) {
    listener(event)
  }
}

export function subscribeFileOperations(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function clearFileOperations() {
  fileOperationState.operations = []
}

export function getFileOperations(filter = {}) {
  const entries = fileOperationState.operations
  if (!filter || Object.keys(filter).length === 0) return entries
  return entries.filter((operation) => {
    if (filter.source && operation.source !== filter.source) return false
    if (filter.agentId && operation.agentId !== filter.agentId) return false
    if (filter.runId && operation.runId !== filter.runId) return false
    if (filter.path) {
      const path = normalizePath(filter.path)
      if (operation.pathBefore !== path && operation.pathAfter !== path) return false
    }
    return true
  })
}

export function recordFileOperation(input) {
  const type = input?.type
  if (!type) return null

  const operation = {
    id: input.id || makeId(),
    type,
    source: input.source || "user",
    explorerOwner: input.explorerOwner || "ExplorerService",
    fileServiceOwner: input.fileServiceOwner || "IFileService",
    operationSource: defaultOperationSource(input),
    resourceUriKind: normalizeResourceUriKind(input.resourceUriKind),
    readonlyGuard: defaultReadonlyGuard(input),
    destructiveGuard: defaultDestructiveGuard(input),
    remainingUiOwnerGap: input.remainingUiOwnerGap || "service-evidence-only",
    agentId: input.agentId || null,
    runId: input.runId || null,
    pathBefore: input.pathBefore ? normalizePath(input.pathBefore) : null,
    pathAfter: input.pathAfter ? normalizePath(input.pathAfter) : null,
    beforeContent: input.beforeContent ?? null,
    afterContent: input.afterContent ?? null,
    diff: input.diff || null,
    reason: input.reason || "",
    riskLevel: normalizeRisk(input.riskLevel || inferRiskLevel(type)),
    timestamp: input.timestamp || Date.now(),
    applyStatus: normalizeStatus(input.applyStatus),
    failureCause: input.failureCause || null,
    serviceOperation: input.serviceOperation || null,
    serviceOperationResult: input.serviceOperationResult ?? null,
    rollbackRisk: input.rollbackRisk || null,
    rollbackError: null,
    rollbackAt: null,
  }

  fileOperationState.operations.unshift(operation)
  if (fileOperationState.operations.length > MAX_OPERATION_ENTRIES) {
    fileOperationState.operations.length = MAX_OPERATION_ENTRIES
  }
  publish({ type: "recorded", operation })
  return operation
}

export function updateFileOperationStatus(operationId, applyStatus, patch = {}) {
  const operation = fileOperationState.operations.find((item) => item.id === operationId)
  if (!operation) return null
  operation.applyStatus = normalizeStatus(applyStatus)
  Object.assign(operation, patch)
  publish({ type: "status", operation })
  return operation
}

async function readCurrentContent(applier, path) {
  if (!path || typeof applier.readFile !== "function") return null
  return await applier.readFile(path)
}

async function assertNoManualDrift(applier, operation, path, expectedContent) {
  if (expectedContent === null || expectedContent === undefined) return true
  const current = await readCurrentContent(applier, path)
  return current === expectedContent
}

export async function rollbackFileOperation(operationId, applier, options = {}) {
  const operation = fileOperationState.operations.find((item) => item.id === operationId)
  if (!operation) return { ok: false, reason: "operation-not-found" }
  if (!applier) return { ok: false, reason: "missing-applier" }

  const protectUserChanges = options.protectUserChanges !== false

  try {
    if (operation.type === "create_file" || operation.type === "create_folder") {
      const target = operation.pathAfter
      if (!target || typeof applier.deleteFile !== "function") return { ok: false, reason: "missing-delete-applier" }
      if (protectUserChanges && operation.type === "create_file") {
        const unchanged = await assertNoManualDrift(applier, operation, target, operation.afterContent)
        if (!unchanged) {
          updateFileOperationStatus(operation.id, "rollback_blocked", {
            rollbackError: "manual-change-detected",
          })
          return { ok: false, reason: "manual-change-detected" }
        }
      }
      await applier.deleteFile(target, { recordOperation: false })
    } else if (operation.type === "update_file") {
      const target = operation.pathAfter || operation.pathBefore
      if (!target) return { ok: false, reason: "missing-path" }
      if (protectUserChanges) {
        const unchanged = await assertNoManualDrift(applier, operation, target, operation.afterContent)
        if (!unchanged) {
          updateFileOperationStatus(operation.id, "rollback_blocked", {
            rollbackError: "manual-change-detected",
          })
          return { ok: false, reason: "manual-change-detected" }
        }
      }
      if (operation.beforeContent === null) {
        if (typeof applier.deleteFile !== "function") return { ok: false, reason: "missing-delete-applier" }
        await applier.deleteFile(target, { recordOperation: false })
      } else {
        if (typeof applier.writeFile !== "function") return { ok: false, reason: "missing-write-applier" }
        await applier.writeFile(target, operation.beforeContent, { recordOperation: false })
      }
    } else if (operation.type === "delete_file") {
      const target = operation.pathBefore
      if (!target || operation.beforeContent === null || typeof applier.writeFile !== "function") {
        return { ok: false, reason: "missing-restore-content" }
      }
      await applier.writeFile(target, operation.beforeContent, { recordOperation: false })
    } else if (operation.type === "rename_move") {
      if (!operation.pathBefore || !operation.pathAfter || typeof applier.renameEntry !== "function") {
        return { ok: false, reason: "missing-rename-applier" }
      }
      await applier.renameEntry(operation.pathAfter, operation.pathBefore, { recordOperation: false })
    } else {
      return { ok: false, reason: "unsupported-operation-type" }
    }
  } catch (error) {
    updateFileOperationStatus(operation.id, "failed", {
      rollbackError: error instanceof Error ? error.message : String(error),
    })
    return { ok: false, reason: operation.rollbackError || "rollback-failed" }
  }

  updateFileOperationStatus(operation.id, "rolled_back", {
    rollbackAt: Date.now(),
    rollbackError: null,
  })
  publish({ type: "rolled_back", operation })
  return { ok: true, operation }
}
