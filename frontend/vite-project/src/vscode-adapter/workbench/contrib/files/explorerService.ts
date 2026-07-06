// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\files\browser\explorerService.ts
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\files\common\explorerModel.ts
// - D:\SourceMirror\vscode\src\vs\platform\files\common\fileService.ts
//
// This is the first Codek ExplorerService facade slice. It subscribes Explorer
// model refresh to FileService operation/change events while keeping Codek's
// renderer, Chinese UX, Agent evidence, and workspace observability outside the
// low-level FileService implementation.

import type { IDisposable } from "../../../base/common/lifecycle"
import type { URI } from "../../../base/common/uri"
import {
  FileChangeType,
  FileOperation,
  type FileChangesEvent,
  type FileOperationEvent,
  type IFileService,
} from "../../../platform/files/common/files"
import type { CodekWorkspaceFileOperationPayload, NormalizeOperationPath } from "./fileOperationRefreshModel"
import { normalizeWorkspaceOperationPath } from "./fileOperationRefreshModel"

export interface CodekExplorerServiceHost {
  isEditable(): boolean
  hasKnownPath(path: string): boolean
  hasLoadedParentForPath(path: string): boolean
  applyFileOperationAsync(payload: CodekWorkspaceFileOperationPayload): Promise<boolean>
  refresh(): Promise<unknown> | unknown
}

export interface CodekExplorerServiceFacadeOptions {
  fileService: Pick<IFileService, "onDidRunOperation" | "onDidFilesChange">
  host: CodekExplorerServiceHost
  normalizePath?: NormalizeOperationPath
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
  fileChangeDelayMs?: number
}

export interface CodekExplorerServiceFacade extends IDisposable {
  flushPendingFileChanges(): Promise<boolean>
}

export const CODEK_EXPLORER_FILE_CHANGES_REACT_DELAY_MS = 50
const CODEK_EXPLORER_OWNER = "ExplorerService"
const CODEK_FILE_SERVICE_OWNER = "IFileService"
const CODEK_FILE_OPERATION_SOURCE = "FileService.onDidRunOperation"
const CODEK_SERVICE_ONLY_UI_GAP = "service-evidence-only"

export function createCodekExplorerServiceFacade(options: CodekExplorerServiceFacadeOptions): CodekExplorerServiceFacade {
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
  const fileChangeDelayMs = options.fileChangeDelayMs ?? CODEK_EXPLORER_FILE_CHANGES_REACT_DELAY_MS
  const pendingFileChanges: FileChangesEvent[] = []
  const disposables: IDisposable[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const scheduleFileChangeRefresh = () => {
    if (disposed || options.host.isEditable() || timer) return
    timer = setTimeoutFn(() => {
      timer = null
      void flushPendingFileChanges()
    }, fileChangeDelayMs)
  }

  const flushPendingFileChanges = async (): Promise<boolean> => {
    if (disposed || options.host.isEditable() || pendingFileChanges.length === 0) return false
    if (timer) {
      clearTimeoutFn(timer)
      timer = null
    }
    const events = pendingFileChanges.splice(0, pendingFileChanges.length)
    if (!shouldRefreshForFileChanges(events, options.host, options.normalizePath)) return false
    await options.host.refresh()
    return true
  }

  disposables.push(options.fileService.onDidRunOperation((event) => {
    const payload = toCodekExplorerOperationPayload(event, options.normalizePath)
    if (!payload) return
    void options.host.applyFileOperationAsync(payload).then((applied) => {
      if (!applied) return options.host.refresh()
      return undefined
    })
  }))
  disposables.push(options.fileService.onDidFilesChange((event) => {
    pendingFileChanges.push(event)
    scheduleFileChangeRefresh()
  }))

  return {
    flushPendingFileChanges,
    dispose() {
      disposed = true
      if (timer) {
        clearTimeoutFn(timer)
        timer = null
      }
      pendingFileChanges.length = 0
      for (const disposable of disposables.splice(0)) disposable.dispose()
    },
  }
}

export function toCodekExplorerOperationPayload(
  event: FileOperationEvent,
  normalizePath?: NormalizeOperationPath,
): CodekWorkspaceFileOperationPayload | null {
  if (event.isOperation(FileOperation.CREATE)) {
    const pathAfter = normalizeResourcePath(event.target?.resource || event.resource, normalizePath)
    if (!pathAfter) return null
    return {
      ...createExplorerOwnerEvidence("create"),
      action: "create",
      type: event.target?.isDirectory ? "create_folder" : "create_file",
      path: pathAfter,
      pathAfter,
    }
  }
  if (event.isOperation(FileOperation.COPY)) {
    const pathBefore = normalizeResourcePath(event.resource, normalizePath)
    const pathAfter = normalizeResourcePath(event.target?.resource, normalizePath)
    if (!pathAfter) return null
    return {
      ...createExplorerOwnerEvidence("copy"),
      action: "copy",
      type: event.target?.isDirectory ? "copy_folder" : "copy_file",
      path: pathAfter,
      pathBefore,
      pathAfter,
    }
  }
  if (event.isOperation(FileOperation.MOVE)) {
    const pathBefore = normalizeResourcePath(event.resource, normalizePath)
    const pathAfter = normalizeResourcePath(event.target?.resource, normalizePath)
    if (!pathBefore || !pathAfter) return null
    return {
      ...createExplorerOwnerEvidence("rename"),
      action: "rename",
      type: "rename_move",
      path: pathAfter,
      pathBefore,
      pathAfter,
    }
  }
  if (event.isOperation(FileOperation.DELETE)) {
    const pathBefore = normalizeResourcePath(event.resource, normalizePath)
    if (!pathBefore) return null
    return {
      ...createExplorerOwnerEvidence("delete"),
      action: "delete",
      type: "delete_file",
      path: pathBefore,
      pathBefore,
    }
  }
  return null
}

function createExplorerOwnerEvidence(action: "create" | "copy" | "rename" | "delete"): Pick<
  CodekWorkspaceFileOperationPayload,
  "explorerOwner" | "fileServiceOwner" | "operationSource" | "resourceUriKind" | "readonlyGuard" | "destructiveGuard" | "remainingUiOwnerGap"
> {
  return {
    explorerOwner: CODEK_EXPLORER_OWNER,
    fileServiceOwner: CODEK_FILE_SERVICE_OWNER,
    operationSource: CODEK_FILE_OPERATION_SOURCE,
    resourceUriKind: "file-uri",
    readonlyGuard: "FileService.provider-capability",
    destructiveGuard: action === "delete" ? "FileService.delete-guard" : "not-destructive",
    remainingUiOwnerGap: CODEK_SERVICE_ONLY_UI_GAP,
  }
}

function shouldRefreshForFileChanges(
  events: FileChangesEvent[],
  host: CodekExplorerServiceHost,
  normalizePath?: NormalizeOperationPath,
): boolean {
  for (const event of events) {
    for (const resource of [...event.rawDeleted, ...event.rawUpdated]) {
      const path = normalizeResourcePath(resource, normalizePath)
      if (path && host.hasKnownPath(path)) return true
    }
    for (const resource of event.rawAdded) {
      const path = normalizeResourcePath(resource, normalizePath)
      if (path && !host.hasKnownPath(path) && host.hasLoadedParentForPath(path)) return true
    }
  }
  return false
}

function normalizeResourcePath(resource: URI | undefined, normalizePath?: NormalizeOperationPath): string {
  if (!resource) return ""
  return normalizeWorkspaceOperationPath(resource.fsPath || resource.path || resource.toString(), normalizePath)
}
