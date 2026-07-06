import { reactive } from "vue"

import { deleteFile, readProjectFile, saveFile, workspace } from "./manager"
import { recordChange } from "./changeHistory"
import { computeHunks } from "../editor/lineDiff"

export const pendingChangeState = reactive({
  batches: [],
})

function makeId() {
  return `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function buildBatchTitle(changes) {
  const files = [...new Set(changes.map((change) => change.path))]
  if (files.length <= 2) return files.join(", ")
  return `${files.length} files`
}

function markBatchBlocked(batch, reason, path = "") {
  batch.applyStatus = "blocked"
  batch.blockReason = reason
  batch.blockedPath = path
  batch.blockedAt = Date.now()
}

function clearBatchBlocked(batch) {
  delete batch.applyStatus
  delete batch.blockReason
  delete batch.blockedPath
  delete batch.blockedAt
}

async function assertNoPendingChangeDrift(batch, change) {
  if (change.beforeContent === null || change.beforeContent === undefined) return true
  const current = await readProjectFile(change.path)
  if (current === change.beforeContent) return true
  markBatchBlocked(batch, "manual-change-detected", change.path)
  return false
}

export function queuePendingBatch({ source = "agent", action = "patch", changes = [], summary = "" }) {
  const normalized = changes
    .filter((change) => change && typeof change.path === "string")
    .map((change) => ({
      path: change.path,
      beforeContent: change.beforeContent ?? null,
      afterContent: change.afterContent ?? "",
      action: change.action || action,
    }))

  if (normalized.length === 0) return null

  const batch = {
    id: makeId(),
    title: summary || buildBatchTitle(normalized),
    source,
    action,
    createdAt: Date.now(),
    applyStatus: "pending",
    blockReason: null,
    blockedPath: null,
    blockedAt: null,
    changes: normalized,
  }

  pendingChangeState.batches.unshift(batch)
  return batch
}

export function clearPendingBatches() {
  pendingChangeState.batches = []
}

export function rejectPendingBatch(batchId) {
  pendingChangeState.batches = pendingChangeState.batches.filter((batch) => batch.id !== batchId)
}

function findBatchIndex(batchId) {
  return pendingChangeState.batches.findIndex((batch) => batch.id === batchId)
}

function findChangeIndex(batch, path) {
  return batch.changes.findIndex((change) => change.path === path)
}

function removePendingChange(batchIdx, changeIdx) {
  const batch = pendingChangeState.batches[batchIdx]
  if (!batch) return
  batch.changes.splice(changeIdx, 1)
  if (batch.changes.length === 0) {
    pendingChangeState.batches.splice(batchIdx, 1)
  }
}

function applyHunksToContent(beforeContent, hunks, accept) {
  const beforeLines = beforeContent === "" ? [] : (beforeContent ?? "").split("\n")
  const newLines = []
  let cursor = 0
  for (const hunk of hunks) {
    const sliceEnd = Math.max(hunk.beforeStart - 1, cursor)
    newLines.push(...beforeLines.slice(cursor, sliceEnd))
    if (accept.has(hunk.id)) {
      newLines.push(...hunk.afterLines)
    } else {
      newLines.push(...hunk.beforeLines)
    }
    cursor = hunk.beforeEnd
  }
  newLines.push(...beforeLines.slice(cursor))
  return newLines.join("\n")
}

export async function applyPendingHunk(batchId, path, hunkId) {
  const batchIdx = findBatchIndex(batchId)
  if (batchIdx < 0) return false
  const batch = pendingChangeState.batches[batchIdx]
  const changeIdx = findChangeIndex(batch, path)
  if (changeIdx < 0) return false
  const change = batch.changes[changeIdx]

  const hunks = computeHunks(change.beforeContent ?? "", change.afterContent ?? "")
  const target = hunks.find((h) => h.id === hunkId)
  if (!target) return false

  if (!(await assertNoPendingChangeDrift(batch, change))) return false
  clearBatchBlocked(batch)

  const previous = change.beforeContent ?? (await readProjectFile(path)) ?? ""
  const partial = applyHunksToContent(previous, hunks, new Set([hunkId]))

  const success = await saveFile(path, partial, { recordOperation: false })
  if (!success) return false

  recordChange({
    path,
    beforeContent: previous,
    afterContent: partial,
    source: batch.source,
    action: "patch-hunk",
  })

  if (workspace.activeFile === path) {
    workspace.files[path] = partial
  }

  change.beforeContent = partial
  if (computeHunks(partial, change.afterContent ?? "").length === 0) {
    batch.changes.splice(changeIdx, 1)
    if (batch.changes.length === 0) {
      pendingChangeState.batches.splice(batchIdx, 1)
    }
  }
  return true
}

export function rejectPendingHunk(batchId, path, hunkId) {
  const batchIdx = findBatchIndex(batchId)
  if (batchIdx < 0) return false
  const batch = pendingChangeState.batches[batchIdx]
  const changeIdx = findChangeIndex(batch, path)
  if (changeIdx < 0) return false
  const change = batch.changes[changeIdx]

  const hunks = computeHunks(change.beforeContent ?? "", change.afterContent ?? "")
  if (!hunks.some((h) => h.id === hunkId)) return false

  const accepted = new Set(hunks.filter((h) => h.id !== hunkId).map((h) => h.id))
  const rebuilt = applyHunksToContent(change.beforeContent ?? "", hunks, accepted)
  change.afterContent = rebuilt

  if (computeHunks(change.beforeContent ?? "", rebuilt).length === 0) {
    removePendingChange(batchIdx, changeIdx)
  }
  return true
}

async function applyPendingChange(batch, change) {
  if (!(await assertNoPendingChangeDrift(batch, change))) return false
  const currentBefore = await readProjectFile(change.path)
  const previous = change.beforeContent ?? currentBefore

  let success = false
  if (change.afterContent === null) {
    success = await deleteFile(change.path, { recordOperation: false })
  } else {
    success = await saveFile(change.path, change.afterContent, { recordOperation: false })
  }

  if (!success) return false

  recordChange({
    path: change.path,
    beforeContent: previous,
    afterContent: change.afterContent,
    source: batch.source,
    action: change.action,
  })

  if (workspace.activeFile === change.path && change.afterContent !== null) {
    workspace.files[change.path] = change.afterContent
  }

  return true
}

export async function applyPendingFile(batchId, path) {
  const batchIdx = findBatchIndex(batchId)
  if (batchIdx < 0) return false
  const batch = pendingChangeState.batches[batchIdx]
  const changeIdx = findChangeIndex(batch, path)
  if (changeIdx < 0) return false

  const success = await applyPendingChange(batch, batch.changes[changeIdx])
  if (!success) return false

  clearBatchBlocked(batch)
  removePendingChange(batchIdx, changeIdx)
  return true
}

export function rejectPendingFile(batchId, path) {
  const batchIdx = findBatchIndex(batchId)
  if (batchIdx < 0) return false
  const batch = pendingChangeState.batches[batchIdx]
  const changeIdx = findChangeIndex(batch, path)
  if (changeIdx < 0) return false
  removePendingChange(batchIdx, changeIdx)
  return true
}

export async function applyPendingBatch(batchId) {
  const batch = pendingChangeState.batches.find((item) => item.id === batchId)
  if (!batch) return false

  for (const change of batch.changes) {
    const success = await applyPendingChange(batch, change)
    if (!success) return false
  }

  clearBatchBlocked(batch)
  rejectPendingBatch(batchId)
  return true
}
