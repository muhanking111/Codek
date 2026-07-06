import { describe, expect, it, vi } from "vitest"
import { URI } from "../../../../base/common/uri"
import { FileChangeType, FileOperation, FileService, FileSystemProviderCapabilities } from "../../../../platform/files/common/files"
import { getSingletonServiceDescriptors } from "../../../../platform/instantiation/common/extensions"
import { InstantiationService } from "../../../../platform/instantiation/common/instantiationService"
import { ServiceCollection } from "../../../../platform/instantiation/common/serviceCollection"
import { WorkingCopyService } from "../../workingCopy/common/workingCopyService"
import { WorkingCopyFileService } from "../../workingCopy/common/workingCopyFileService"
import {
  SaveReason,
  TextFileEditorModelState,
  createTextFileModelState,
  hasExternalTextFileChange,
  markTextFileExternalChange,
} from "./textfiles"
import {
  CODEK_TEXTFILE_SAVE_SOURCE,
  ITextFileService,
  TextFileService,
  createCodekFileSystemProvider,
  globalTextFileService,
} from "./textFileService"

describe("VS Code TextFileService save pipeline adapter", () => {
  it("registers a VS Code-style ITextFileService identifier and singleton", () => {
    const service = new TextFileService({ fileService: new FileService() })
    const collection = new ServiceCollection([ITextFileService, service])
    const instantiationService = new InstantiationService(collection)

    const resolved = instantiationService.invokeFunction((accessor) => accessor.get(ITextFileService))

    expect(String(ITextFileService)).toBe("textFileService")
    expect(resolved).toBe(service)
    expect(resolved._serviceBrand).toBeUndefined()
    expect(globalTextFileService._serviceBrand).toBeUndefined()
    expect(getSingletonServiceDescriptors().some(([id, instance]) => id === ITextFileService && instance === globalTextFileService)).toBe(true)
  })

  it("exposes a VS Code-style files model manager with lifecycle events per resource", async () => {
    const fileService = new FileService()
    const writes: string[] = []
    fileService.registerProvider("file", createCodekFileSystemProvider({
      delegate: {
        readFile: () => "from disk",
        writeFile: async (_path, content) => { writes.push(content) },
        fileExists: () => ({ exists: true, isFile: true, size: 0 }),
      },
    }))
    const service = new TextFileService({ fileService })
    const resource = URI.file("D:/repo/src/main.ts")
    const state = createTextFileModelState()
    const events: string[] = []
    service.files.onDidCreate((model) => events.push(`create:${model.resource.fsPath}`))
    service.files.onDidResolve((event) => events.push(`resolve:${event.model.model?.getValue()}`))
    service.files.onDidChangeDirty((model) => events.push(`dirty:${model.state.state}`))
    service.files.onDidSave((event) => events.push(`save:${event.model.model?.getValue()}`))
    service.files.onDidSaveError((event) => events.push(`saveError:${event.model.resource.fsPath}`))
    service.files.onDidRevert((model) => events.push(`revert:${model.resource.fsPath}`))
    service.files.onDidRemove((removed) => events.push(`remove:${removed.fsPath}`))

    const model = await service.files.resolve(resource, { contents: "initial", state })
    expect(service.files.get(resource)).toBe(model)

    model.update("changed")
    await expect(model.save({ reason: SaveReason.EXPLICIT })).resolves.toBe(true)
    await model.revert()
    service.files.remove(resource)

    expect(writes).toEqual(["changed"])
    expect(events).toEqual([
      "create:d:/repo/src/main.ts",
      "resolve:initial",
      `dirty:${TextFileEditorModelState.DIRTY}`,
      `dirty:${TextFileEditorModelState.SAVED}`,
      "save:changed",
      "revert:d:/repo/src/main.ts",
      "remove:d:/repo/src/main.ts",
    ])
  })

  it("saves through FileService.writeFile and emits FileOperation.WRITE before clearing dirty state", async () => {
    const fileService = new FileService()
    const writes: string[] = []
    const provider = createCodekFileSystemProvider({
      delegate: {
        writeFile: async (_path, content) => {
          writes.push(content)
        },
        fileExists: () => ({ exists: true, isFile: true, size: 0 }),
      },
    })
    const operations: Array<{ operation: FileOperation; path: string }> = []
    fileService.onDidRunOperation((event) => operations.push({ operation: event.operation, path: event.resource.fsPath }))
    fileService.registerProvider("file", provider)
    const service = new TextFileService({ fileService })
    const state = createTextFileModelState({ dirty: true })

    const result = await service.save({
      resource: URI.file("D:/repo/src/main.ts"),
      value: "export const value = 1",
      state,
      options: { reason: SaveReason.EXPLICIT, source: CODEK_TEXTFILE_SAVE_SOURCE },
    })

    expect(result.success).toBe(true)
    expect(writes).toEqual(["export const value = 1"])
    expect(operations).toEqual([{ operation: FileOperation.WRITE, path: "d:/repo/src/main.ts" }])
    expect(state.state).toBe(TextFileEditorModelState.SAVED)
    expect(hasExternalTextFileChange(state)).toBe(false)
  })

  it("projects dirty save owner evidence from the TextFileService working copy state source", async () => {
    const fileService = new FileService()
    const workingCopyService = new WorkingCopyService()
    const writes: string[] = []
    fileService.registerProvider("mem", createCodekFileSystemProvider({
      delegate: {
        readFile: () => "initial",
        writeFile: async (_path, content) => { writes.push(content) },
        fileExists: () => ({ exists: true, isFile: true, size: 0 }),
      },
    }))
    const service = new TextFileService({ fileService, workingCopyService })
    const resource = URI.parse("mem:/repo/src/main.ts")
    const model = await service.files.resolve(resource, { contents: "initial" })

    model.update("changed")

    const dirtyEvidence = service.getDirtySaveOwnerEvidence(resource)
    expect(dirtyEvidence).toMatchObject({
      source: "codek.textFile.dirtySaveOwnerEvidence",
      textModelOwner: "StoredFileWorkingCopy.model",
      textFileServiceOwner: "TextFileService.files",
      workingCopyOwner: "WorkingCopyService",
      dirtySource: "TextFileModelState via StoredFileWorkingCopy.isDirty",
      saveOwner: "TextFileService.save -> StoredFileWorkingCopy.acceptSaveSucceeded -> FileService.writeFile",
      revertOwner: "TextFileService.revert -> StoredFileWorkingCopy.revert",
      resourceUri: {
        value: "mem:/repo/src/main.ts",
        scheme: "mem",
        kind: "inMemory",
      },
      stateName: "dirty",
      dirty: true,
      modelResolved: true,
      registeredInTextFileService: true,
      registeredInWorkingCopyService: true,
      stateSourceConsistent: true,
      usesSecondDirtyStateSource: false,
      evidenceOnly: true,
      remainingEditorUiOwnerGap: {
        connected: false,
        owner: "missing",
      },
    })
    expect(service.files.get(resource)).toBe(model)
    expect(workingCopyService.dirtyWorkingCopies).toEqual([model])

    await expect(model.save({ reason: SaveReason.EXPLICIT })).resolves.toBe(true)
    expect(writes).toEqual(["changed"])

    const savedEvidence = service.getDirtySaveOwnerEvidence(resource)
    expect(savedEvidence.dirty).toBe(false)
    expect(savedEvidence.stateName).toBe("saved")
    expect(savedEvidence.usesSecondDirtyStateSource).toBe(false)
    expect(workingCopyService.dirtyCount).toBe(0)

    model.update("draft")
    expect(service.getDirtySaveOwnerEvidence(resource).dirty).toBe(true)

    await model.revert()
    const revertedEvidence = service.getDirtySaveOwnerEvidence(resource)
    expect(revertedEvidence.dirty).toBe(false)
    expect(revertedEvidence.stateName).toBe("saved")
    expect(revertedEvidence.remainingEditorUiOwnerGap.connected).toBe(false)
  })

  it("keeps partial editor UI owner as a remaining gap for unregistered headless evidence", () => {
    const service = new TextFileService({ fileService: new FileService() })
    const resource = URI.parse("untitled:/scratch")
    const state = createTextFileModelState({ dirty: true })

    const evidence = service.getDirtySaveOwnerEvidence(resource, state)

    expect(evidence.registeredInTextFileService).toBe(false)
    expect(evidence.registeredInWorkingCopyService).toBe(false)
    expect(evidence.workingCopyOwner).toBe("not-connected")
    expect(evidence.textModelOwner).toBe("missing")
    expect(evidence.resourceUri.kind).toBe("untitled")
    expect(evidence.dirty).toBe(true)
    expect(evidence.stateName).toBe("dirty")
    expect(evidence.usesSecondDirtyStateSource).toBe(false)
    expect(evidence.remainingEditorUiOwnerGap).toEqual({
      connected: false,
      owner: "missing",
      reason: "Editor UI owner requires App.vue or generic editor shell wiring; this service projection intentionally stays headless.",
    })
  })

  it("blocks non-forced save when an external change is pending", async () => {
    const fileService = new FileService()
    const writeFile = vi.fn()
    fileService.registerProvider("file", createCodekFileSystemProvider({
      delegate: {
        writeFile,
        fileExists: () => ({ exists: true, isFile: true, size: 0 }),
      },
    }))
    const service = new TextFileService({ fileService })
    const state = createTextFileModelState({ dirty: true })
    markTextFileExternalChange(state)

    const result = await service.save({
      resource: URI.file("D:/repo/src/main.ts"),
      value: "changed",
      state,
      options: { reason: SaveReason.EXPLICIT },
    })

    expect(result.success).toBe(false)
    expect(writeFile).not.toHaveBeenCalled()
    expect(state.state).toBe(TextFileEditorModelState.CONFLICT)
    expect(hasExternalTextFileChange(state)).toBe(true)
  })

  it("keeps conflict and error models dirty for auto save requests", async () => {
    const service = new TextFileService({ fileService: new FileService() })
    const state = createTextFileModelState({ dirty: true })
    state.state = TextFileEditorModelState.CONFLICT

    const result = await service.save({
      resource: URI.file("D:/repo/src/main.ts"),
      value: "auto",
      state,
      options: { reason: SaveReason.AUTO },
    })

    expect(result.success).toBe(false)
    expect(state.state).toBe(TextFileEditorModelState.CONFLICT)
  })

  it("updates registered working copies from FileService change and write operation events", async () => {
    const fileService = new FileService()
    const provider = createCodekFileSystemProvider({
      delegate: {
        writeFile: async () => undefined,
        fileExists: () => ({ exists: true, isFile: true, size: 0 }),
      },
    })
    fileService.registerProvider("file", provider)
    const service = new TextFileService({ fileService })
    const resource = URI.file("D:/repo/src/main.ts")
    const state = createTextFileModelState()
    const stateEvents: TextFileEditorModelState[] = []
    service.registerWorkingCopy(resource, state)
    service.onDidChangeWorkingCopyState((event) => stateEvents.push(event.state.state))

    provider.fireDidChangeFile([{ type: FileChangeType.UPDATED, resource }])

    expect(state.state).toBe(TextFileEditorModelState.SAVED)
    expect(hasExternalTextFileChange(state)).toBe(true)

    provider.fireDidChangeFile([{ type: FileChangeType.DELETED, resource }])
    expect(state.state).toBe(TextFileEditorModelState.ORPHAN)

    await service.save({
      resource,
      value: "restored",
      state,
      options: { reason: SaveReason.EXPLICIT, force: true },
    })

    expect(state.state).toBe(TextFileEditorModelState.SAVED)
    expect(stateEvents).toContain(TextFileEditorModelState.ORPHAN)
    expect(stateEvents.at(-1)).toBe(TextFileEditorModelState.SAVED)
  })

  it("runs save participants before write and fails without touching disk", async () => {
    const fileService = new FileService()
    const writes: string[] = []
    fileService.registerProvider("file", createCodekFileSystemProvider({
      delegate: {
        writeFile: async (_path, content) => { writes.push(content) },
        fileExists: () => ({ exists: true, isFile: true, size: 0 }),
      },
    }))
    const workingCopyFileService = new WorkingCopyFileService()
    const service = new TextFileService({ fileService, workingCopyFileService })
    const state = createTextFileModelState({ dirty: true })
    workingCopyFileService.addSaveParticipant({
      participate(workingCopy) {
        workingCopy.update(`${workingCopy.model?.getValue() || ""}\nformatted`)
      },
    })

    await expect(service.save({
      resource: URI.file("D:/repo/src/main.ts"),
      value: "body",
      state,
      options: { reason: SaveReason.EXPLICIT },
    })).resolves.toMatchObject({ success: true })
    expect(writes).toEqual(["body\nformatted"])

    workingCopyFileService.addSaveParticipant({
      ordinal: 100,
      participate() {
        throw new Error("blocked by participant")
      },
    })
    await expect(service.save({
      resource: URI.file("D:/repo/src/main.ts"),
      value: "next",
      state,
      options: { reason: SaveReason.EXPLICIT },
    })).resolves.toMatchObject({ success: false })
    expect(writes).toEqual(["body\nformatted"])
    expect(state.state).toBe(TextFileEditorModelState.ERROR)
  })

  it("adapts Codek workspace IPC structural operations through the FileService provider", async () => {
    const entries = new Map<string, { kind: "file" | "dir"; content?: string }>([
      ["D:/repo/src", { kind: "dir" }],
      ["D:/repo/src/main.ts", { kind: "file", content: "main" }],
    ])
    const fileService = new FileService()
    fileService.registerProvider("file", createCodekFileSystemProvider({
      delegate: {
        readDir: async (path) => Array.from(entries)
          .filter(([entry]) => entry.startsWith(`${path.replace(/\/+$/, "")}/`))
          .map(([entry, value]) => ({ name: entry.slice(path.length + 1).split("/")[0], isDirectory: value.kind === "dir" })),
        writeFile: async (path, content) => {
          entries.set(path, { kind: "file", content })
        },
        fileExists: async (path) => {
          const entry = entries.get(path)
          if (!entry) return false
          return { exists: true, isDirectory: entry.kind === "dir", isFile: entry.kind === "file", size: entry.content?.length || 0 }
        },
        createDir: async (path) => {
          entries.set(path, { kind: "dir" })
        },
        deleteFile: async (path) => {
          entries.delete(path)
        },
        rename: async (oldPath, newPath) => {
          const entry = entries.get(oldPath)
          if (!entry) return false
          entries.delete(oldPath)
          entries.set(newPath, entry)
          return true
        },
        copyEntry: async (sourcePath, targetPath) => {
          const entry = entries.get(sourcePath)
          if (!entry) return false
          entries.set(targetPath, { ...entry })
          return true
        },
      },
    }))
    const operations: FileOperation[] = []
    fileService.onDidRunOperation((event) => operations.push(event.operation))

    await fileService.createFolder(URI.file("D:/repo/src/generated"))
    await fileService.createFile(URI.file("D:/repo/src/new.ts"), new TextEncoder().encode("new"))
    await fileService.move(URI.file("D:/repo/src/new.ts"), URI.file("D:/repo/src/moved.ts"))
    await fileService.copy(URI.file("D:/repo/src/moved.ts"), URI.file("D:/repo/src/copied.ts"))
    await fileService.delete(URI.file("D:/repo/src/moved.ts"))

    expect(entries.has("D:/repo/src/generated")).toBe(true)
    expect(entries.get("D:/repo/src/copied.ts")?.content).toBe("new")
    expect(entries.has("D:/repo/src/moved.ts")).toBe(false)
    expect(operations).toEqual([
      FileOperation.CREATE,
      FileOperation.WRITE,
      FileOperation.CREATE,
      FileOperation.MOVE,
      FileOperation.COPY,
      FileOperation.DELETE,
    ])
  })

  it("exposes Codek workspace IPC reads and writes through open/read/write/close provider handles", async () => {
    const entries = new Map<string, { kind: "file" | "dir"; content?: string }>([
      ["D:/repo/src/main.ts", { kind: "file", content: "main" }],
    ])
    const provider = createCodekFileSystemProvider({
      delegate: {
        readFile: async (path) => entries.get(path)?.content,
        writeFile: async (path, content) => {
          entries.set(path, { kind: "file", content })
        },
        fileExists: async (path) => {
          const entry = entries.get(path)
          if (!entry) return false
          return { exists: true, isDirectory: entry.kind === "dir", isFile: entry.kind === "file", size: entry.content?.length || 0 }
        },
      },
    })
    const resource = URI.file("D:/repo/src/main.ts")

    expect(provider.capabilities & FileSystemProviderCapabilities.FileOpenReadWriteClose).toBe(FileSystemProviderCapabilities.FileOpenReadWriteClose)

    const readHandle = await provider.open?.(resource, { create: false })
    expect(typeof readHandle).toBe("number")
    const readBuffer = new Uint8Array(8)
    const bytesRead = await provider.read?.(readHandle!, 1, readBuffer, 0, 2)
    await provider.close?.(readHandle!)

    expect(bytesRead).toBe(2)
    expect(new TextDecoder().decode(readBuffer.slice(0, bytesRead))).toBe("ai")

    const writeHandle = await provider.open?.(URI.file("D:/repo/src/generated.ts"), { create: true })
    const content = new TextEncoder().encode("generated")
    await provider.write?.(writeHandle!, 0, content, 0, content.byteLength)
    await provider.close?.(writeHandle!)

    expect(entries.get("D:/repo/src/generated.ts")?.content).toBe("generated")
  })

  it("maps Codek desktop watcher events through the provider and disposes stale subscriptions", () => {
    const watchCallbacks: Array<(event: unknown) => void> = []
    const disposeWatch = vi.fn()
    const provider = createCodekFileSystemProvider({
      delegate: {
        fileExists: () => ({ exists: true, isDirectory: true, size: 0 }),
        watch: (path, options, onDidChange) => {
          expect(path).toBe("D:/repo/src")
          expect(options).toEqual({ recursive: true, excludes: ["node_modules"] })
          watchCallbacks.push(onDidChange)
          return { dispose: disposeWatch }
        },
      },
    })
    const events: Array<{ type: FileChangeType; path: string }> = []
    provider.onDidChangeFile((changes) => {
      events.push(...changes.map((change) => ({ type: change.type, path: change.resource.fsPath })))
    })

    const watcher = provider.watch?.(URI.file("D:/repo/src"), { recursive: true, excludes: ["node_modules"] })
    expect(watchCallbacks).toHaveLength(1)

    watchCallbacks[0]({ type: "change", path: "D:\\repo\\src\\main.ts" })
    watchCallbacks[0]({ type: "unlink", path: "D:/repo/src/deleted.ts" })
    watchCallbacks[0]({ type: "add", path: "D:/repo/other.ts" })

    expect(events).toEqual([
      { type: FileChangeType.UPDATED, path: "d:/repo/src/main.ts" },
      { type: FileChangeType.DELETED, path: "d:/repo/src/deleted.ts" },
    ])

    watcher?.dispose()
    watchCallbacks[0]({ type: "change", path: "D:/repo/src/main.ts" })
    expect(events).toHaveLength(2)
    expect(disposeWatch).toHaveBeenCalledTimes(1)
  })

  it("keeps Codek watcher event ordering and non-recursive filtering aligned with VS Code FileService", () => {
    const watchCallbacks: Array<(event: unknown) => void> = []
    const provider = createCodekFileSystemProvider({
      delegate: {
        fileExists: () => ({ exists: true, isDirectory: true, size: 0 }),
        watch: (_path, _options, onDidChange) => {
          watchCallbacks.push(onDidChange)
          return { dispose: () => undefined }
        },
      },
    })
    const events: Array<{ type: FileChangeType; path: string }> = []
    provider.onDidChangeFile((changes) => {
      events.push(...changes.map((change) => ({ type: change.type, path: change.resource.fsPath })))
    })

    provider.watch?.(URI.file("D:/repo/src"), { recursive: false })
    watchCallbacks[0]({ type: "add", path: "D:/repo/src/new.ts" })
    watchCallbacks[0]({ type: "change", path: "D:/repo/src/new.ts" })
    watchCallbacks[0]({ type: "unlink", path: "D:/repo/src/new.ts" })
    watchCallbacks[0]({ type: "add", path: "D:/repo/src/nested/deep.ts" })

    expect(events).toEqual([
      { type: FileChangeType.ADDED, path: "d:/repo/src/new.ts" },
      { type: FileChangeType.UPDATED, path: "d:/repo/src/new.ts" },
      { type: FileChangeType.DELETED, path: "d:/repo/src/new.ts" },
    ])
  })

  it("projects Codek watcher create change delete events through FileService correlated watchers", () => {
    const fileService = new FileService()
    const watchCallbacks: Array<(event: unknown) => void> = []
    const provider = createCodekFileSystemProvider({
      delegate: {
        fileExists: () => ({ exists: true, isDirectory: true, size: 0 }),
        watch: (_path, options, onDidChange) => {
          expect(typeof options.correlationId).toBe("number")
          watchCallbacks.push(onDidChange)
          return { dispose: () => undefined }
        },
      },
    })
    const globalEvents: unknown[] = []
    const watcherEvents: Array<{ added: string[]; updated: string[]; deleted: string[] }> = []
    fileService.registerProvider("file", provider)
    fileService.onDidFilesChange((event) => globalEvents.push(event))

    const watcher = fileService.createWatcher(URI.file("D:/repo/src/new.ts"), { recursive: false })
    watcher.onDidChange((event) => {
      watcherEvents.push({
        added: event.rawAdded.map((resource) => resource.fsPath),
        updated: event.rawUpdated.map((resource) => resource.fsPath),
        deleted: event.rawDeleted.map((resource) => resource.fsPath),
      })
    })
    watchCallbacks[0]({ type: "add", path: "D:/repo/src/new.ts" })
    watchCallbacks[0]({ type: "change", path: "D:/repo/src/new.ts" })
    watchCallbacks[0]({ type: "unlink", path: "D:/repo/src/new.ts" })

    expect(watcherEvents).toEqual([
      { added: ["d:/repo/src/new.ts"], updated: [], deleted: [] },
      { added: [], updated: ["d:/repo/src/new.ts"], deleted: [] },
      { added: [], updated: [], deleted: ["d:/repo/src/new.ts"] },
    ])
    expect(globalEvents).toEqual([])
    watcher.dispose()
  })

  it("includes nested Codek watcher events only for recursive subscriptions", () => {
    const watchCallbacks: Array<(event: unknown) => void> = []
    const provider = createCodekFileSystemProvider({
      delegate: {
        fileExists: () => ({ exists: true, isDirectory: true, size: 0 }),
        watch: (_path, _options, onDidChange) => {
          watchCallbacks.push(onDidChange)
          return { dispose: () => undefined }
        },
      },
    })
    const paths: string[] = []
    provider.onDidChangeFile((changes) => {
      paths.push(...changes.map((change) => change.resource.fsPath))
    })

    provider.watch?.(URI.file("D:/repo/src"), { recursive: true })
    watchCallbacks[0]({ type: "change", path: "D:/repo/src/nested/deep.ts" })

    expect(paths).toEqual(["d:/repo/src/nested/deep.ts"])
  })

  it("forwards Codek watcher subscribe failures through FileService onDidWatchError", () => {
    const fileService = new FileService()
    const provider = createCodekFileSystemProvider({
      delegate: {
        fileExists: () => ({ exists: true, isDirectory: true, size: 0 }),
        watch: () => {
          throw new Error("native watcher failed")
        },
      },
    })
    const watchErrors: string[] = []
    fileService.onDidWatchError((error) => watchErrors.push(error.message))
    fileService.registerProvider("file", provider)

    const watcher = fileService.watch(URI.file("D:/repo"), { recursive: true })

    expect(watchErrors).toEqual(["native watcher failed"])
    watcher.dispose()
  })

  it("updates registered working copies from provider-backed watcher events", () => {
    const fileService = new FileService()
    const watchCallbacks: Array<(event: unknown) => void> = []
    const provider = createCodekFileSystemProvider({
      delegate: {
        writeFile: async () => undefined,
        fileExists: () => ({ exists: true, isDirectory: true, size: 0 }),
        watch: (_path, _options, onDidChange) => {
          watchCallbacks.push(onDidChange)
          return { dispose: () => undefined }
        },
      },
    })
    fileService.registerProvider("file", provider)
    const service = new TextFileService({ fileService })
    const resource = URI.file("D:/repo/src/main.ts")
    const state = createTextFileModelState()
    service.registerWorkingCopy(resource, state)

    const watcher = fileService.watch(URI.file("D:/repo"), { recursive: true })
    watchCallbacks[0]({ type: "change", path: "D:/repo/src/main.ts" })

    expect(hasExternalTextFileChange(state)).toBe(true)

    watchCallbacks[0]({ type: "unlink", path: "D:/repo/src/main.ts" })

    expect(state.state).toBe(TextFileEditorModelState.ORPHAN)
    watcher.dispose()
  })
})
