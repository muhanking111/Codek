import { describe, expect, it } from "vitest"
import { URI } from "../../../../base/common/uri"
import { Emitter } from "../../../../base/common/event"
import { getSingletonServiceDescriptors } from "../../../../platform/instantiation/common/extensions"
import { InstantiationService } from "../../../../platform/instantiation/common/instantiationService"
import { ServiceCollection } from "../../../../platform/instantiation/common/serviceCollection"
import {
  FileChangeType,
  FileService,
  FileSystemProviderCapabilities,
  FileSystemProviderErrorCode,
  FileType,
  createFileSystemProviderError,
  type IFileChange,
  type IFileSystemProvider,
  type IStat,
} from "../../../../platform/files/common/files"
import { SaveReason, TextFileEditorModelState } from "../../textfile/common/textfiles"
import { TextFileService, createCodekFileSystemProvider } from "../../textfile/common/textFileService"
import { WorkingCopyFileService } from "./workingCopyFileService"
import { WorkingCopyService } from "./workingCopyService"
import {
  CodekStoredFileWorkingCopyModel,
  DiskWorkingCopyBackupService,
  IWorkingCopyBackupService,
  InMemoryWorkingCopyBackupService,
  InMemoryWorkingCopyBackupStorage,
  StoredFileWorkingCopy,
  globalWorkingCopyBackupService,
  hashIdentifier,
  toWorkingCopyIdentifier,
} from "./storedFileWorkingCopy"

class MemoryFileSystemProvider implements IFileSystemProvider {
  readonly capabilities = FileSystemProviderCapabilities.FileReadWrite
  private readonly onDidChangeCapabilitiesEmitter = new Emitter<void>()
  readonly onDidChangeCapabilities = this.onDidChangeCapabilitiesEmitter.event
  private readonly onDidChangeFileEmitter = new Emitter<readonly IFileChange[]>()
  readonly onDidChangeFile = this.onDidChangeFileEmitter.event
  readonly files = new Map<string, Uint8Array>()
  readonly folders = new Set<string>(["/"])
  delayMs = 0

  async stat(resource: URI): Promise<IStat> {
    const path = normalizeMemoryPath(resource.path)
    if (this.folders.has(path)) {
      return { type: FileType.Directory, size: 0, mtime: 1, ctime: 1 }
    }
    const file = this.files.get(path)
    if (!file) throw createFileSystemProviderError("missing", FileSystemProviderErrorCode.FileNotFound)
    return { type: FileType.File, size: file.byteLength, mtime: 1, ctime: 1 }
  }

  async readdir(resource: URI): Promise<[string, FileType][]> {
    const root = normalizeMemoryPath(resource.path)
    if (!this.folders.has(root)) throw createFileSystemProviderError("missing", FileSystemProviderErrorCode.FileNotFound)
    const prefix = root === "/" ? "/" : `${root}/`
    const entries = new Map<string, FileType>()
    for (const folder of this.folders) {
      if (folder === root || !folder.startsWith(prefix)) continue
      const rest = folder.slice(prefix.length)
      const name = rest.split("/")[0]
      if (name) entries.set(name, FileType.Directory)
    }
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue
      const rest = file.slice(prefix.length)
      const name = rest.split("/")[0]
      if (name && !entries.has(name)) entries.set(name, FileType.File)
    }
    return Array.from(entries)
  }

  async readFile(resource: URI, options: { readonly length?: number } = {}): Promise<Uint8Array> {
    const file = this.files.get(normalizeMemoryPath(resource.path))
    if (!file) throw createFileSystemProviderError("missing", FileSystemProviderErrorCode.FileNotFound)
    return typeof options.length === "number" ? file.slice(0, options.length) : file
  }

  async writeFile(resource: URI, content: Uint8Array): Promise<void> {
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs))
    const path = normalizeMemoryPath(resource.path)
    this.ensureParentFolders(path)
    this.files.set(path, content)
    this.onDidChangeFileEmitter.fire([{ type: FileChangeType.UPDATED, resource }])
  }

  async mkdir(resource: URI): Promise<void> {
    const path = normalizeMemoryPath(resource.path)
    this.ensureParentFolders(path)
    this.folders.add(path)
    this.onDidChangeFileEmitter.fire([{ type: FileChangeType.ADDED, resource }])
  }

  async delete(resource: URI): Promise<void> {
    const path = normalizeMemoryPath(resource.path)
    if (!this.files.has(path) && !this.folders.has(path)) {
      throw createFileSystemProviderError("missing", FileSystemProviderErrorCode.FileNotFound)
    }
    for (const file of Array.from(this.files.keys())) {
      if (file === path || file.startsWith(`${path}/`)) this.files.delete(file)
    }
    for (const folder of Array.from(this.folders)) {
      if (folder !== "/" && (folder === path || folder.startsWith(`${path}/`))) this.folders.delete(folder)
    }
    this.onDidChangeFileEmitter.fire([{ type: FileChangeType.DELETED, resource }])
  }

  watch() {
    return { dispose() {} }
  }

  private ensureParentFolders(path: string): void {
    const parts = path.split("/").filter(Boolean)
    let current = ""
    for (const part of parts.slice(0, -1)) {
      current = `${current}/${part}`
      this.folders.add(current || "/")
    }
  }
}

function normalizeMemoryPath(path: string): string {
  const normalized = `/${String(path || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")}`
  return normalized === "/" ? "/" : normalized.replace(/\/+$/g, "")
}

describe("VS Code StoredFileWorkingCopy adapter", () => {
  it("registers a VS Code-style IWorkingCopyBackupService identifier with an in-memory singleton", () => {
    const service = new InMemoryWorkingCopyBackupService()
    const collection = new ServiceCollection([IWorkingCopyBackupService, service])
    const instantiationService = new InstantiationService(collection)

    const resolved = instantiationService.invokeFunction((accessor) => accessor.get(IWorkingCopyBackupService))

    expect(String(IWorkingCopyBackupService)).toBe("workingCopyBackupService")
    expect(resolved).toBe(service)
    expect(resolved._serviceBrand).toBeUndefined()
    expect(globalWorkingCopyBackupService._serviceBrand).toBeUndefined()
    expect(getSingletonServiceDescriptors().some(([id, instance]) => id === IWorkingCopyBackupService && instance === globalWorkingCopyBackupService)).toBe(true)
  })

  it("registers with WorkingCopyService and unregisters on dispose", async () => {
    const fileService = new FileService()
    fileService.registerProvider("file", createCodekFileSystemProvider({
      delegate: {
        readFile: () => "initial",
        writeFile: async () => undefined,
        fileExists: () => ({ exists: true, isFile: true, size: 0 }),
      },
    }))
    const workingCopyService = new WorkingCopyService()
    const textFileService = new TextFileService({ fileService, workingCopyService })
    const resource = URI.file("D:/repo/src/main.ts")
    const events: string[] = []
    workingCopyService.onDidRegister((copy) => events.push(`register:${copy.resource.fsPath}`))
    workingCopyService.onDidUnregister((copy) => events.push(`unregister:${copy.resource.fsPath}`))
    workingCopyService.onDidChangeDirty((copy) => events.push(`dirty:${copy.isDirty()}`))
    workingCopyService.onDidSave((event) => events.push(`save:${event.workingCopy.resource.fsPath}`))

    const workingCopy = await textFileService.files.resolve(resource, { contents: "initial" })
    workingCopy.update("changed")
    await workingCopy.save({ reason: SaveReason.EXPLICIT })
    workingCopy.dispose()

    expect(workingCopyService.has(resource)).toBe(false)
    expect(events).toEqual([
      "register:d:/repo/src/main.ts",
      "dirty:true",
      "dirty:false",
      "save:d:/repo/src/main.ts",
      "unregister:d:/repo/src/main.ts",
    ])
  })

  it("resolves, dirties, saves, and fires working copy events", async () => {
    const fileService = new FileService()
    const writes: string[] = []
    fileService.registerProvider("file", createCodekFileSystemProvider({
      delegate: {
        readFile: () => "initial",
        writeFile: async (_path, content) => { writes.push(content) },
        fileExists: () => ({ exists: true, isFile: true, size: 0 }),
      },
    }))
    const workingCopyFileService = new WorkingCopyFileService()
    const textFileService = new TextFileService({ fileService, workingCopyFileService })
    const workingCopy = new StoredFileWorkingCopy({
      resource: URI.file("D:/repo/src/main.ts"),
      textFileService,
      fileService,
    })
    const events: string[] = []
    workingCopy.onDidResolve(() => events.push("resolve"))
    workingCopy.onDidChangeDirty(() => events.push(`dirty:${workingCopy.stateName()}`))
    workingCopy.onDidSave(() => events.push("save"))

    await workingCopy.resolve()
    workingCopy.update("changed")
    await expect(workingCopy.save({ reason: SaveReason.EXPLICIT })).resolves.toBe(true)

    expect(writes).toEqual(["changed"])
    expect(events).toContain("resolve")
    expect(events).toContain("dirty:dirty")
    expect(events).toContain("save")
    expect(workingCopy.hasState(TextFileEditorModelState.SAVED)).toBe(true)
  })

  it("stores and restores hot-exit backups into dirty models", async () => {
    const fileService = new FileService()
    const textFileService = new TextFileService({ fileService })
    const resource = URI.file("D:/repo/src/main.ts")
    const backupService = new InMemoryWorkingCopyBackupService()
    const identifier = toWorkingCopyIdentifier(resource)

    await backupService.backup(identifier, "unsaved", 7, { state: "dirty" })
    const backup = await backupService.resolve(identifier)
    const workingCopy = new StoredFileWorkingCopy({
      resource,
      textFileService,
      fileService,
      model: new CodekStoredFileWorkingCopyModel(resource),
    })
    workingCopy.restoreFromBackup(backup!)

    expect(backupService.hasBackupSync(identifier)).toBe(true)
    expect(workingCopy.model?.getValue()).toBe("unsaved")
    expect(workingCopy.stateName()).toBe("dirty")
  })

  it("persists backup content and metadata through an injectable storage adapter", async () => {
    const storage = new InMemoryWorkingCopyBackupStorage()
    const resource = URI.file("D:/repo/src/main.ts")
    const identifier = toWorkingCopyIdentifier(resource)
    const firstService = new InMemoryWorkingCopyBackupService(storage)

    await firstService.backup(identifier, "unsaved from previous window", 42, {
      state: "conflict",
      mtime: 1234,
      versionId: 42,
    })

    const restoredService = new InMemoryWorkingCopyBackupService(storage)
    const backups = await restoredService.getBackups()
    expect(backups.map((backup) => `${backup.typeId}:${backup.resource.fsPath}`)).toEqual([
      `${identifier.typeId}:d:/repo/src/main.ts`,
    ])
    await expect(restoredService.resolve(identifier)).resolves.toEqual({
      value: "unsaved from previous window",
      meta: {
        state: "conflict",
        mtime: 1234,
        versionId: 42,
      },
    })
    expect(restoredService.hasBackupSync(identifier, 42)).toBe(true)

    await restoredService.discardBackup(identifier)

    await expect(firstService.getBackups()).resolves.toEqual([])
    await expect(firstService.resolve(identifier)).resolves.toBeUndefined()
  })

  it("writes, lists, restores, and discards backups from a workspace disk backup root", async () => {
    const fileService = new FileService()
    const provider = new MemoryFileSystemProvider()
    fileService.registerProvider("mem", provider)
    const backupRoot = URI.from({ scheme: "mem", path: "/workspace-backups/session-a" })
    const sourceA = toWorkingCopyIdentifier(URI.file("D:/repo/src/main.ts"))
    const sourceB = toWorkingCopyIdentifier(URI.from({ scheme: "untitled", path: "/scratch/main.ts" }))

    const firstService = new DiskWorkingCopyBackupService({ backupWorkspaceHome: backupRoot, fileService })
    await firstService.backup(sourceA, "disk content", 1, { state: "dirty", mtime: 10 })
    await firstService.backup(sourceB, "untitled content", 1, { state: "dirty", mtime: 11 })
    await expect(firstService.getBackups().then((backups) => backups.map((backup) => `${backup.typeId}:${backup.resource.toString()}`).sort())).resolves.toEqual([
      `${sourceA.typeId}:${sourceA.resource.toString()}`,
      `${sourceB.typeId}:${sourceB.resource.toString()}`,
    ].sort())

    const mainBackupResource = URI.joinPath(backupRoot, "file", hashIdentifier(sourceA))
    const untitledBackupResource = URI.joinPath(backupRoot, "untitled", hashIdentifier(sourceB))
    expect(provider.files.has(normalizeMemoryPath(mainBackupResource.path))).toBe(true)
    expect(provider.files.has(normalizeMemoryPath(untitledBackupResource.path))).toBe(true)

    const restoredService = new DiskWorkingCopyBackupService({ backupWorkspaceHome: backupRoot, fileService })
    await expect(restoredService.getBackups().then((backups) => backups.map((backup) => `${backup.typeId}:${backup.resource.toString()}`).sort())).resolves.toEqual([
      `${sourceA.typeId}:${sourceA.resource.toString()}`,
      `${sourceB.typeId}:${sourceB.resource.toString()}`,
    ].sort())
    await expect(restoredService.resolve(sourceA)).resolves.toEqual({
      value: "disk content",
      meta: { state: "dirty", mtime: 10 },
    })

    await restoredService.discardBackup(sourceA)

    await expect(restoredService.resolve(sourceA)).resolves.toBeUndefined()
    expect(provider.files.has(normalizeMemoryPath(mainBackupResource.path))).toBe(false)
    expect(provider.files.has(normalizeMemoryPath(untitledBackupResource.path))).toBe(true)
  })

  it("treats missing disk backup discard as non-blocking while keeping the model in sync", async () => {
    const fileService = new FileService()
    const provider = new MemoryFileSystemProvider()
    const diagnostics: Array<{ operation: string; resource: string; severity?: string; reason?: string; ignored?: boolean }> = []
    fileService.registerProvider("mem", provider)
    const backupRoot = URI.from({ scheme: "mem", path: "/workspace-backups/session-missing-discard" })
    const identifier = toWorkingCopyIdentifier(URI.file("D:/repo/src/main.ts"))
    const service = new DiskWorkingCopyBackupService({
      backupWorkspaceHome: backupRoot,
      fileService,
      onError: (_error, operation, resource, diagnostic) => {
        diagnostics.push({
          operation,
          resource: resource?.toString() || "",
          severity: diagnostic?.severity,
          reason: diagnostic?.reason,
          ignored: diagnostic?.ignored,
        })
      },
    })

    await service.backup(identifier, "disk content", 1, { state: "dirty" })
    const backupResource = URI.joinPath(backupRoot, "file", hashIdentifier(identifier))
    provider.files.delete(normalizeMemoryPath(backupResource.path))

    await expect(service.discardBackup(identifier)).resolves.toBeUndefined()
    await expect(service.getBackups()).resolves.toEqual([])
    expect(diagnostics).toEqual([{
      operation: "discard",
      resource: backupResource.toString(),
      severity: "nonBlocking",
      reason: "backupMissing",
      ignored: true,
    }])
  })

  it("still rejects real disk backup discard IO failures", async () => {
    const fileService = new FileService()
    const provider = new MemoryFileSystemProvider()
    const errors: Array<{ operation: string; severity?: string; reason?: string }> = []
    fileService.registerProvider("mem", provider)
    const backupRoot = URI.from({ scheme: "mem", path: "/workspace-backups/session-discard-error" })
    const identifier = toWorkingCopyIdentifier(URI.file("D:/repo/src/main.ts"))
    const service = new DiskWorkingCopyBackupService({
      backupWorkspaceHome: backupRoot,
      fileService,
      onError: (_error, operation, _resource, diagnostic) => {
        errors.push({ operation, severity: diagnostic?.severity, reason: diagnostic?.reason })
      },
    })
    const originalDelete = provider.delete.bind(provider)
    provider.delete = async (resource: URI) => {
      if (resource.path.includes(hashIdentifier(identifier))) {
        throw createFileSystemProviderError("permission denied", FileSystemProviderErrorCode.NoPermissions)
      }
      await originalDelete(resource)
    }

    await service.backup(identifier, "disk content", 1, { state: "dirty" })

    await expect(service.discardBackup(identifier)).rejects.toThrow(/permission denied/)
    expect(errors).toEqual([{ operation: "discard", severity: undefined, reason: undefined }])
  })

  it("serializes concurrent backup and discard operations per backup resource", async () => {
    const fileService = new FileService()
    const provider = new MemoryFileSystemProvider()
    provider.delayMs = 5
    fileService.registerProvider("mem", provider)
    const identifier = toWorkingCopyIdentifier(URI.file("D:/repo/src/race.ts"))
    const service = new DiskWorkingCopyBackupService({
      backupWorkspaceHome: URI.from({ scheme: "mem", path: "/workspace-backups/session-b" }),
      fileService,
    })

    await Promise.all([
      service.backup(identifier, "first", 1, { state: "dirty" }),
      service.discardBackup(identifier),
      service.backup(identifier, "second", 2, { state: "dirty" }),
    ])

    await expect(service.resolve(identifier)).resolves.toEqual({
      value: "second",
      meta: { state: "dirty" },
    })
    expect(service.hasBackupSync(identifier, 2)).toBe(true)
  })

  it("surfaces disk backup IO errors through the caller and onError hook", async () => {
    const fileService = new FileService()
    const errors: string[] = []
    const service = new DiskWorkingCopyBackupService({
      backupWorkspaceHome: URI.from({ scheme: "missing", path: "/workspace-backups/session-c" }),
      fileService,
      onError: (error, operation, resource) => {
        errors.push(`${operation}:${resource?.toString()}:${String((error as Error).message || error)}`)
      },
    })

    await expect(service.backup(toWorkingCopyIdentifier(URI.file("D:/repo/src/main.ts")), "value")).rejects.toThrow(/No file system provider/)
    expect(errors[0]).toContain("initialize:missing:/workspace-backups/session-c")
    expect(errors.at(-1)).toContain("backup:missing:/workspace-backups/session-c/file/")
  })
})
