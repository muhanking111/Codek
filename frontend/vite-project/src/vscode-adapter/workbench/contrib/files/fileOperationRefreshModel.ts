// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\platform\files\common\files.ts
// - D:\SourceMirror\vscode\src\vs\base\common\resources.ts
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\files\common\explorerModel.ts
//
// Codek uses lightweight workspace operation payloads from the desktop shell.
// This adapter keeps VS Code resource identity and FileChangesEvent matching in
// one place so Explorer refresh, active editor reload, and SCM/analysis updates
// do not each reimplement string path matching.

import { extUriBiasedIgnorePathCase } from "../../../base/common/resources"
import { URI } from "../../../base/common/uri"
import {
  FileChangeType,
  FileChangesEvent,
  type IFileChange,
} from "../../../platform/files/common/files"

export type NormalizeOperationPath = (path: string) => string

export interface CodekWorkspaceFileOperationPayload {
  type?: unknown
  action?: unknown
  explorerOwner?: unknown
  fileServiceOwner?: unknown
  operationSource?: unknown
  resourceUriKind?: unknown
  readonlyGuard?: unknown
  destructiveGuard?: unknown
  remainingUiOwnerGap?: unknown
  path?: unknown
  pathBefore?: unknown
  pathAfter?: unknown
}

export function normalizeWorkspaceOperationPath(
  path: unknown,
  normalizePath?: NormalizeOperationPath,
): string {
  if (typeof path !== "string" || !path.trim()) return ""
  if (normalizePath) {
    try {
      const normalized = normalizePath(path)
      if (typeof normalized === "string") return trimWorkspacePath(normalized)
    } catch {
      // Fall through to resource-style normalization.
    }
  }
  return trimWorkspacePath(path)
}

export function getWorkspaceOperationRefreshPaths(
  payload: CodekWorkspaceFileOperationPayload = {},
  normalizePath?: NormalizeOperationPath,
): string[] {
  const seen = new Map<string, string>()
  for (const candidate of [payload.path, payload.pathBefore, payload.pathAfter]) {
    const path = normalizeWorkspaceOperationPath(candidate, normalizePath)
    if (!path) continue
    seen.set(getWorkspaceOperationComparisonKey(path), path)
  }
  return Array.from(seen.values())
}

export function getWorkspaceOperationFileChanges(
  payload: CodekWorkspaceFileOperationPayload = {},
  normalizePath?: NormalizeOperationPath,
): IFileChange[] {
  const type = String(payload.type || "")
  const action = String(payload.action || "")
  const changes: IFileChange[] = []
  const addChange = (changeType: FileChangeType, path: unknown) => {
    const normalized = normalizeWorkspaceOperationPath(path, normalizePath)
    if (!normalized) return
    changes.push({ type: changeType, resource: toWorkspaceOperationResource(normalized) })
  }

  if (type === "rename_move" || action === "rename") {
    addChange(FileChangeType.DELETED, payload.pathBefore)
    addChange(FileChangeType.ADDED, payload.pathAfter || payload.path)
    return changes
  }

  if (type === "delete_file" || action === "delete") {
    addChange(FileChangeType.DELETED, payload.pathBefore || payload.path)
    return changes
  }

  if (type === "create_file" || type === "create_folder" || action === "create") {
    addChange(FileChangeType.ADDED, payload.pathAfter || payload.path)
    return changes
  }

  if (type === "update_file" || action === "write") {
    addChange(FileChangeType.UPDATED, payload.pathAfter || payload.path || payload.pathBefore)
  }

  return changes
}

export function createWorkspaceOperationFileChangesEvent(
  payload: CodekWorkspaceFileOperationPayload = {},
  normalizePath?: NormalizeOperationPath,
): FileChangesEvent {
  return new FileChangesEvent(getWorkspaceOperationFileChanges(payload, normalizePath), true)
}

export function isWorkspaceOperationPathAffected(options: {
  targetPath: unknown
  operationPaths: string[]
  normalizePath?: NormalizeOperationPath
  payload?: CodekWorkspaceFileOperationPayload
}): boolean {
  const normalizedTargetPath = normalizeWorkspaceOperationPath(options.targetPath, options.normalizePath)
  if (!normalizedTargetPath) return false
  if (options.payload && String(options.payload.type || "") !== "create_folder") {
    const event = createWorkspaceOperationFileChangesEvent(options.payload, options.normalizePath)
    if (event.contains(toWorkspaceOperationResource(normalizedTargetPath))) return true
  }
  const targetKey = getWorkspaceOperationComparisonKey(normalizedTargetPath)
  return options.operationPaths.some((path) => getWorkspaceOperationComparisonKey(path) === targetKey)
}

export function toWorkspaceOperationResource(path: string): URI {
  return URI.from({
    scheme: "codek-workspace",
    path: `/${trimWorkspacePath(path)}`,
  })
}

function getWorkspaceOperationComparisonKey(path: string): string {
  return extUriBiasedIgnorePathCase.getComparisonKey(toWorkspaceOperationResource(path), true).toLowerCase()
}

function trimWorkspacePath(path: string): string {
  return String(path || "").replace(/\\/g, "/").replace(/^\.?\//, "").replace(/^\/+|\/+$/g, "")
}
