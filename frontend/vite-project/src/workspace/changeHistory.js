import { reactive } from "vue"

import { deleteFile, normalizeRelativePath, readProjectFile, saveFile, workspace } from "./manager"
import { recordFileOperation, rollbackFileOperation } from "./fileOperations"

const MAX_CHANGE_ENTRIES = 80

export const changeHistory = reactive({
  entries: [],
})

function makeId() {
  return `change-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function recordChange({ path, beforeContent, afterContent, source = "agent", action = "edit" }) {
  const relativePath = normalizeRelativePath(path)
  if (!relativePath) return null
  if (beforeContent === afterContent) return null

  const entry = {
    id: makeId(),
    path: relativePath,
    beforeContent: beforeContent ?? null,
    afterContent: afterContent ?? "",
    source,
    action,
    createdAt: Date.now(),
    operationId: null,
    applyStatus: "applied",
    rollbackError: null,
  }

  const operation = recordFileOperation({
    type: afterContent === null ? "delete_file" : (beforeContent === null || beforeContent === undefined ? "create_file" : "update_file"),
    source,
    pathBefore: beforeContent === null || beforeContent === undefined ? null : relativePath,
    pathAfter: afterContent === null ? null : relativePath,
    beforeContent: beforeContent ?? null,
    afterContent: afterContent ?? null,
    reason: `change history ${action}`,
    riskLevel: afterContent === null ? "high" : "medium",
  })
  entry.operationId = operation?.id || null

  changeHistory.entries.unshift(entry)
  if (changeHistory.entries.length > MAX_CHANGE_ENTRIES) {
    changeHistory.entries.length = MAX_CHANGE_ENTRIES
  }

  return entry
}

export function dismissChange(changeId) {
  changeHistory.entries = changeHistory.entries.filter((entry) => entry.id !== changeId)
}

export function clearChanges() {
  changeHistory.entries = []
}

export async function revertChange(changeId) {
  const entry = changeHistory.entries.find((item) => item.id === changeId)
  if (!entry) return false

  if (entry.operationId) {
    const result = await rollbackFileOperation(entry.operationId, {
      readFile: async (path) => readProjectFile(normalizeRelativePath(path)),
      writeFile: (path, content, options) => saveFile(path, content, options),
      deleteFile: (path, options) => deleteFile(path, options),
    })
    if (!result.ok) {
      entry.applyStatus = "rollback_blocked"
      entry.rollbackError = result.reason || result.error || "rollback-blocked"
      return false
    }
    dismissChange(changeId)
    return true
  }

  let success = false
  if (entry.beforeContent === null) {
    success = await deleteFile(entry.path, { recordOperation: false })
  } else {
    success = await saveFile(entry.path, entry.beforeContent, { recordOperation: false })
  }

  if (!success) return false

  if (workspace.activeFile === entry.path && entry.beforeContent !== null) {
    workspace.files[entry.path] = entry.beforeContent
  }

  dismissChange(changeId)
  return true
}
