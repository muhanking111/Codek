import { describe, expect, it, vi } from "vitest"
import { Emitter } from "../../../base/common/event"
import { URI } from "../../../base/common/uri"
import {
  FileChangeType,
  FileChangesEvent,
  FileOperation,
  FileOperationEvent,
  FileType,
  type FileChangesEvent as FileChangesEventType,
  type FileOperationEvent as FileOperationEventType,
  type IFileStatWithMetadata,
} from "../../../platform/files/common/files"
import {
  createCodekExplorerServiceFacade,
  toCodekExplorerOperationPayload,
  type CodekExplorerServiceHost,
} from "./explorerService"

describe("ExplorerService facade adapter", () => {
  it("maps VS Code FileOperationEvent move/copy/create/delete events to Codek explorer payloads", () => {
    const normalizePath = (path: string) => path.replace(/\\/g, "/").replace(/^D:\/repo\//i, "")
    const source = URI.file("D:/repo/src/main.ts")
    const target = stat("D:/repo/tests/main.ts")

    expect(toCodekExplorerOperationPayload(
      new FileOperationEvent(source, FileOperation.MOVE, target),
      normalizePath,
    )).toEqual(expect.objectContaining({
      action: "rename",
      type: "rename_move",
      path: "tests/main.ts",
      pathBefore: "src/main.ts",
      pathAfter: "tests/main.ts",
      explorerOwner: "ExplorerService",
      fileServiceOwner: "IFileService",
      operationSource: "FileService.onDidRunOperation",
      resourceUriKind: "file-uri",
      readonlyGuard: "FileService.provider-capability",
      destructiveGuard: "not-destructive",
      remainingUiOwnerGap: "service-evidence-only",
    }))
    expect(toCodekExplorerOperationPayload(
      new FileOperationEvent(target.resource, FileOperation.CREATE, target),
      normalizePath,
    )).toMatchObject({
      action: "create",
      type: "create_file",
      pathAfter: "tests/main.ts",
    })
    expect(toCodekExplorerOperationPayload(
      new FileOperationEvent(source, FileOperation.COPY, target),
      normalizePath,
    )).toMatchObject({
      action: "copy",
      type: "copy_file",
      pathBefore: "src/main.ts",
      pathAfter: "tests/main.ts",
    })
    expect(toCodekExplorerOperationPayload(
      new FileOperationEvent(source, FileOperation.DELETE),
      normalizePath,
    )).toMatchObject({
      action: "delete",
      type: "delete_file",
      pathBefore: "src/main.ts",
    })
  })

  it("applies FileService operation events through the explorer host before falling back to refresh", async () => {
    const operationEmitter = new Emitter<FileOperationEventType>()
    const changeEmitter = new Emitter<FileChangesEventType>()
    const host = createHost()

    createCodekExplorerServiceFacade({
      fileService: {
        onDidRunOperation: operationEmitter.event,
        onDidFilesChange: changeEmitter.event,
      },
      host,
      normalizePath: (path) => path.replace(/\\/g, "/").replace(/^D:\/repo\//i, ""),
    })

    operationEmitter.fire(new FileOperationEvent(
      URI.file("D:/repo/src/main.ts"),
      FileOperation.MOVE,
      stat("D:/repo/tests/main.ts"),
    ))
    await Promise.resolve()

    expect(host.applyFileOperationAsync).toHaveBeenCalledWith({
      action: "rename",
      type: "rename_move",
      path: "tests/main.ts",
      pathBefore: "src/main.ts",
      pathAfter: "tests/main.ts",
      explorerOwner: "ExplorerService",
      fileServiceOwner: "IFileService",
      operationSource: "FileService.onDidRunOperation",
      resourceUriKind: "file-uri",
      readonlyGuard: "FileService.provider-capability",
      destructiveGuard: "not-destructive",
      remainingUiOwnerGap: "service-evidence-only",
    })
    expect(host.refresh).not.toHaveBeenCalled()
  })

  it("defers FileService change refresh while an editable Explorer row is active", async () => {
    vi.useFakeTimers()
    const operationEmitter = new Emitter<FileOperationEventType>()
    const changeEmitter = new Emitter<FileChangesEventType>()
    const host = createHost({
      editable: true,
      knownPaths: new Set(["src/main.ts"]),
    })
    const facade = createCodekExplorerServiceFacade({
      fileService: {
        onDidRunOperation: operationEmitter.event,
        onDidFilesChange: changeEmitter.event,
      },
      host,
      normalizePath: (path) => path.replace(/\\/g, "/").replace(/^D:\/repo\//i, ""),
      fileChangeDelayMs: 5,
    })

    changeEmitter.fire(new FileChangesEvent([
      { type: FileChangeType.DELETED, resource: URI.file("D:/repo/src/main.ts") },
    ], true))
    await vi.runAllTimersAsync()
    expect(host.refresh).not.toHaveBeenCalled()

    host.editable = false
    await expect(facade.flushPendingFileChanges()).resolves.toBe(true)
    expect(host.refresh).toHaveBeenCalledTimes(1)
    facade.dispose()
    vi.useRealTimers()
  })
})

function createHost(options: { editable?: boolean; knownPaths?: Set<string> } = {}) {
  const host = {
    editable: Boolean(options.editable),
    knownPaths: options.knownPaths || new Set<string>(),
    loadedParents: new Set(["src", "tests"]),
    isEditable() {
      return this.editable
    },
    hasKnownPath(path: string) {
      return this.knownPaths.has(path)
    },
    hasLoadedParentForPath(path: string) {
      return this.loadedParents.has(path.replace(/\/[^/]+$/, ""))
    },
    applyFileOperationAsync: vi.fn(async () => true),
    refresh: vi.fn(async () => undefined),
  } satisfies CodekExplorerServiceHost & { editable: boolean; knownPaths: Set<string>; loadedParents: Set<string> }
  return host
}

function stat(path: string, isDirectory = false): IFileStatWithMetadata {
  return {
    resource: URI.file(path),
    name: path.split(/[\\/]/).pop() || path,
    type: isDirectory ? FileType.Directory : FileType.File,
    isFile: !isDirectory,
    isDirectory,
    isSymbolicLink: false,
    mtime: 1,
    ctime: 1,
    size: 1,
    etag: "1",
    readonly: false,
    locked: false,
    executable: false,
    children: undefined,
  }
}
