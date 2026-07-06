import { describe, expect, it, vi } from "vitest"
import {
  ByteSize,
  ETAG_DISABLED,
  FileSystemProviderErrorCode,
  FileChangeType,
  FileChangesEvent,
  FileService,
  IFileService,
  FileOperation,
  FileOperationErrorEvent,
  FileOperationEvent,
  FileOperationError,
  FileOperationResult,
  FilePermission,
  FileSystemProviderCapabilities,
  FileSystemProviderError,
  FileType,
  NotModifiedSinceFileOperationError,
  TooLargeFileOperationError,
  etag,
  getLargeFileConfirmationLimit,
  globalFileService,
  type IFileChange,
  type IFileReadStreamOptions,
  createFileSystemProviderError,
  type IFileSystemProvider,
  type IReadableStreamEvents,
  normalizeFileStat,
  toFileOperationResult,
  toFileSystemProviderErrorCode,
} from "./files"
import { URI } from "../../../base/common/uri"
import { Emitter } from "../../../base/common/event"
import { CancellationToken, CancellationTokenSource } from "../../../base/common/cancellation"
import { InstantiationService } from "../../instantiation/common/instantiationService"
import { getSingletonServiceDescriptors } from "../../instantiation/common/extensions"
import { ServiceCollection } from "../../instantiation/common/serviceCollection"

describe("VS Code platform files adapter", () => {
  it("preserves VS Code file type and permission bit semantics", () => {
    const stat = normalizeFileStat({
      exists: true,
      type: FileType.File | FileType.SymbolicLink,
      permissions: FilePermission.Readonly | FilePermission.Executable,
      size: 31,
      mtime: 1710000000000,
    }, "D:/repo/bin/tool")

    expect(stat).toMatchObject({
      exists: true,
      type: FileType.File | FileType.SymbolicLink,
      isFile: true,
      isDirectory: false,
      isSymbolicLink: true,
      readonly: true,
      executable: true,
      locked: false,
      size: 31,
      etag: etag({ mtime: 1710000000000, size: 31 }),
    })
  })

  it("normalizes legacy Codek bridge stats into the VS Code stat contract", () => {
    const stat = normalizeFileStat({
      exists: true,
      isDir: true,
      size: 0,
    }, "D:/repo/src")

    expect(stat.type).toBe(FileType.Directory)
    expect(stat.isDirectory).toBe(true)
    expect(stat.isFile).toBe(false)
    expect(stat.name).toBe("src")
  })

  it("keeps VS Code etag, byte-size, and local large-file limits", () => {
    expect(etag({ mtime: 29, size: 31 })).toBe("1010")
    expect(ByteSize.formatSize(1024 * 1024)).toBe("1.00MB")
    expect(getLargeFileConfirmationLimit(URI.file("D:/repo/large.log"))).toBe(1024 * ByteSize.MB)
    expect(getLargeFileConfirmationLimit("ssh-remote+host")).toBe(10 * ByteSize.MB)
  })

  it("routes file change queries with VS Code deleted-parent semantics", () => {
    const root = URI.file("D:/repo/src")
    const child = URI.file("D:/repo/src/App.ts")
    const sibling = URI.file("D:/repo/tests/App.test.ts")
    const event = new FileChangesEvent([
      { type: FileChangeType.DELETED, resource: root },
      { type: FileChangeType.ADDED, resource: sibling, cId: 7 },
    ], true)

    expect(event.contains(child, FileChangeType.DELETED)).toBe(true)
    expect(event.affects(root, FileChangeType.DELETED)).toBe(true)
    expect(event.gotAdded()).toBe(true)
    expect(event.gotDeleted()).toBe(true)
    expect(event.hasCorrelation()).toBe(true)
    expect(event.correlates(7)).toBe(true)
  })

  it("uses VS Code tree matching for child additions and case-insensitive file paths", () => {
    const root = URI.file("D:/repo/src")
    const child = URI.file("D:/REPO/SRC/App.ts")
    const event = new FileChangesEvent([
      { type: FileChangeType.ADDED, resource: child },
    ], true)

    expect(event.contains(root, FileChangeType.ADDED)).toBe(false)
    expect(event.affects(root, FileChangeType.ADDED)).toBe(true)
    expect(event.contains(URI.file("D:/repo/src/app.ts"), FileChangeType.ADDED)).toBe(true)
  })

  it("exposes VS Code file operation event checks", () => {
    const event = new FileOperationEvent(URI.file("D:/repo/src/App.ts"), FileOperation.WRITE)

    expect(event.isOperation(FileOperation.WRITE)).toBe(true)
    expect(event.isOperation(FileOperation.DELETE)).toBe(false)
  })

  it("registers and disposes filesystem providers with VS Code-style events", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const events: Array<[boolean, string]> = []
    service.onDidChangeFileSystemProviderRegistrations((event) => events.push([event.added, event.scheme]))

    const disposable = service.registerProvider("test", provider)

    expect(service.getProvider("test")).toBe(provider)
    expect(events).toEqual([[true, "test"]])

    const resolved = await service.resolve(URI.parse("test:///workspace/"))
    expect(resolved.children?.map((child) => [child.name, child.isFile, child.isDirectory])).toEqual([
      ["README.md", true, false],
      ["src", false, true],
    ])
    await expect(service.readFile(URI.parse("test:///workspace/README.md")).then((data) => Array.from(data))).resolves.toEqual(Array.from(new TextEncoder().encode("README")))

    disposable.dispose()

    expect(service.getProvider("test")).toBeUndefined()
    expect(events).toEqual([[true, "test"], [false, "test"]])
  })

  it("registers FileService as the VS Code IFileService singleton service", () => {
    const singleton = getSingletonServiceDescriptors().find(([id]) => id === IFileService)
    expect(singleton?.[1]).toBe(globalFileService)

    const services = new ServiceCollection(...getSingletonServiceDescriptors())
    const instantiationService = new InstantiationService(services)

    expect(instantiationService.invokeFunction((accessor) => accessor.get(IFileService))).toBe(globalFileService)
  })

  it("forwards uncorrelated provider file changes through VS Code FileService onDidFilesChange", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const events: FileChangesEvent[] = []
    service.onDidFilesChange((event) => events.push(event))
    const resource = URI.parse("test:///workspace/README.md")

    service.registerProvider("test", provider)
    provider.fireChanges?.([{ type: FileChangeType.UPDATED, resource }])

    expect(events).toHaveLength(1)
    expect(events[0].contains(resource, FileChangeType.UPDATED)).toBe(true)
    expect(events[0].hasCorrelation()).toBe(false)
  })

  it("coalesces provider file changes before publishing FileService events", () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const events: FileChangesEvent[] = []
    const createdThenDeleted = URI.parse("test:///workspace/transient.md")
    const deletedThenCreated = URI.parse("test:///workspace/recreated.md")
    const createdThenUpdated = URI.parse("test:///workspace/generated.md")
    const deletedFolder = URI.parse("test:///workspace/removed")
    const deletedChild = URI.parse("test:///workspace/removed/child.ts")
    const unrelated = URI.parse("test:///workspace/changed.ts")

    service.onDidFilesChange((event) => events.push(event))
    service.registerProvider("test", provider)

    provider.fireChanges?.([
      { type: FileChangeType.ADDED, resource: createdThenDeleted },
      { type: FileChangeType.DELETED, resource: createdThenDeleted },
      { type: FileChangeType.DELETED, resource: deletedThenCreated },
      { type: FileChangeType.ADDED, resource: deletedThenCreated },
      { type: FileChangeType.ADDED, resource: createdThenUpdated },
      { type: FileChangeType.UPDATED, resource: createdThenUpdated },
      { type: FileChangeType.DELETED, resource: deletedFolder },
      { type: FileChangeType.DELETED, resource: deletedChild },
      { type: FileChangeType.UPDATED, resource: unrelated },
    ])

    expect(events).toHaveLength(1)
    expect(events[0].contains(createdThenDeleted, FileChangeType.ADDED, FileChangeType.DELETED, FileChangeType.UPDATED)).toBe(false)
    expect(events[0].contains(deletedThenCreated, FileChangeType.UPDATED)).toBe(true)
    expect(events[0].contains(createdThenUpdated, FileChangeType.ADDED)).toBe(true)
    expect(events[0].contains(createdThenUpdated, FileChangeType.UPDATED)).toBe(false)
    expect(events[0].contains(deletedFolder, FileChangeType.DELETED)).toBe(true)
    expect(events[0].contains(deletedChild, FileChangeType.DELETED)).toBe(true)
    expect(events[0].rawDeleted).toEqual([deletedFolder])
    expect(events[0].contains(unrelated, FileChangeType.UPDATED)).toBe(true)
  })

  it("coalesces correlated watcher events while preserving the watcher correlation id", () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const watcherEvents: FileChangesEvent[] = []
    const resource = URI.parse("test:///workspace/recreated.md")
    service.registerProvider("test", provider)

    const watcher = service.createWatcher(resource, { recursive: false })
    watcher.onDidChange((event) => watcherEvents.push(event))
    const correlationId = provider.watch.mock.calls[0]?.[1].correlationId as number

    provider.fireChanges?.([
      { type: FileChangeType.DELETED, resource, cId: correlationId },
      { type: FileChangeType.ADDED, resource, cId: correlationId },
    ])

    expect(watcherEvents).toHaveLength(1)
    expect(watcherEvents[0].contains(resource, FileChangeType.UPDATED)).toBe(true)
    expect(watcherEvents[0].hasCorrelation()).toBe(true)
    expect(watcherEvents[0].correlates(correlationId)).toBe(true)
  })

  it("keeps provider change coalescing isolated by watcher correlation id", () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const globalEvents: FileChangesEvent[] = []
    const firstWatcherEvents: FileChangesEvent[] = []
    const secondWatcherEvents: FileChangesEvent[] = []
    const resource = URI.parse("test:///workspace/shared.md")
    service.onDidFilesChange((event) => globalEvents.push(event))
    service.registerProvider("test", provider)

    const firstWatcher = service.createWatcher(resource, { recursive: false })
    const secondWatcher = service.createWatcher(resource, { recursive: false })
    firstWatcher.onDidChange((event) => firstWatcherEvents.push(event))
    secondWatcher.onDidChange((event) => secondWatcherEvents.push(event))
    const firstCorrelationId = provider.watch.mock.calls[0]?.[1].correlationId as number
    const secondCorrelationId = provider.watch.mock.calls[1]?.[1].correlationId as number

    provider.fireChanges?.([
      { type: FileChangeType.ADDED, resource },
      { type: FileChangeType.DELETED, resource, cId: firstCorrelationId },
      { type: FileChangeType.ADDED, resource, cId: firstCorrelationId },
      { type: FileChangeType.UPDATED, resource, cId: secondCorrelationId },
    ])

    expect(globalEvents).toHaveLength(1)
    expect(globalEvents[0].hasCorrelation()).toBe(false)
    expect(globalEvents[0].contains(resource, FileChangeType.ADDED)).toBe(true)
    expect(firstWatcherEvents).toHaveLength(1)
    expect(firstWatcherEvents[0].correlates(firstCorrelationId)).toBe(true)
    expect(firstWatcherEvents[0].contains(resource, FileChangeType.UPDATED)).toBe(true)
    expect(secondWatcherEvents).toHaveLength(1)
    expect(secondWatcherEvents[0].correlates(secondCorrelationId)).toBe(true)
    expect(secondWatcherEvents[0].contains(resource, FileChangeType.UPDATED)).toBe(true)
  })

  it("routes correlated watcher changes to the watcher without publishing global file changes", () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const globalEvents: FileChangesEvent[] = []
    const watcherEvents: FileChangesEvent[] = []
    const resource = URI.parse("test:///workspace/README.md")
    service.onDidFilesChange((event) => globalEvents.push(event))
    service.registerProvider("test", provider)

    const watcher = service.createWatcher(resource, { recursive: false })
    watcher.onDidChange((event) => watcherEvents.push(event))
    const providerWatchOptions = provider.watch.mock.calls[0]?.[1] as { correlationId?: number }

    expect(providerWatchOptions).toMatchObject({ recursive: false, excludes: [] })
    expect(typeof providerWatchOptions.correlationId).toBe("number")

    provider.fireChanges?.([{ type: FileChangeType.UPDATED, resource, cId: providerWatchOptions.correlationId }])
    provider.fireChanges?.([{ type: FileChangeType.DELETED, resource, cId: (providerWatchOptions.correlationId ?? 0) + 1 }])
    provider.fireChanges?.([{ type: FileChangeType.ADDED, resource }])

    expect(watcherEvents).toHaveLength(1)
    expect(watcherEvents[0].contains(resource, FileChangeType.UPDATED)).toBe(true)
    expect(globalEvents).toHaveLength(1)
    expect(globalEvents[0].contains(resource, FileChangeType.ADDED)).toBe(true)

    watcher.dispose()
    provider.fireChanges?.([{ type: FileChangeType.UPDATED, resource, cId: providerWatchOptions.correlationId }])
    expect(watcherEvents).toHaveLength(1)
    expect(provider.disposeWatch).toHaveBeenCalledTimes(1)
  })

  it("keeps correlated provider watch requests isolated even when resource and options match", () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const resource = URI.parse("test:///workspace/README.md")
    service.registerProvider("test", provider)

    const first = service.createWatcher(resource, { recursive: false })
    const second = service.createWatcher(resource, { recursive: false })

    expect(provider.watch).toHaveBeenCalledTimes(2)
    expect(provider.watch.mock.calls[0]?.[1].correlationId).not.toBe(provider.watch.mock.calls[1]?.[1].correlationId)

    first.dispose()
    expect(provider.disposeWatch).toHaveBeenCalledTimes(1)
    second.dispose()
    expect(provider.disposeWatch).toHaveBeenCalledTimes(2)
  })

  it("routes watch through the provider and tears it down on dispose/unregister", () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const resource = URI.parse("test:///workspace/README.md")
    const registration = service.registerProvider("test", provider)

    const watcher = service.watch(resource, { recursive: false, excludes: ["node_modules"] })

    expect(provider.watch).toHaveBeenCalledWith(resource, { recursive: false, excludes: ["node_modules"] })
    watcher.dispose()
    expect(provider.disposeWatch).toHaveBeenCalledTimes(1)

    service.watch(resource).dispose()
    registration.dispose()
    expect(provider.disposeWatch).toHaveBeenCalledTimes(2)
  })

  it("deduplicates identical provider watch requests until the last reference is disposed", () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const resource = URI.parse("test:///workspace/README.md")
    service.registerProvider("test", provider)

    const first = service.watch(resource, { recursive: true, excludes: ["node_modules", "dist"] })
    const second = service.watch(resource, { recursive: true, excludes: ["node_modules", "dist"] })

    expect(provider.watch).toHaveBeenCalledTimes(1)
    first.dispose()
    first.dispose()
    expect(provider.disposeWatch).not.toHaveBeenCalled()

    second.dispose()
    expect(provider.disposeWatch).toHaveBeenCalledTimes(1)
  })

  it("keeps distinct provider watch requests isolated by options and resource", () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const readme = URI.parse("test:///workspace/README.md")
    const source = URI.parse("test:///workspace/src")
    const registration = service.registerProvider("test", provider)

    const nonRecursive = service.watch(readme, { recursive: false })
    const recursive = service.watch(readme, { recursive: true })
    const folder = service.watch(source, { recursive: true })

    expect(provider.watch).toHaveBeenCalledTimes(3)
    nonRecursive.dispose()
    expect(provider.disposeWatch).toHaveBeenCalledTimes(1)

    registration.dispose()
    expect(provider.disposeWatch).toHaveBeenCalledTimes(3)

    recursive.dispose()
    folder.dispose()
    expect(provider.disposeWatch).toHaveBeenCalledTimes(3)
  })

  it("writes through the registered provider and emits VS Code FileOperation.WRITE", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const resource = URI.parse("test:///workspace/README.md")
    const operations: FileOperationEvent[] = []
    service.onDidRunOperation((event) => operations.push(event))
    service.registerProvider("test", provider)

    const stat = await service.writeFile(resource, new TextEncoder().encode("updated"), { create: true, overwrite: true })

    expect(provider.writeFile).toHaveBeenCalledWith(resource, new TextEncoder().encode("updated"), { create: true, overwrite: true })
    expect(stat).toMatchObject({ resource, isFile: true, size: 7 })
    expect(operations).toHaveLength(1)
    expect(operations[0].resource).toBe(resource)
    expect(operations[0].isOperation(FileOperation.WRITE)).toBe(true)
  })

  it("publishes operation failure evidence for provider write errors", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider({
      writeError: createFileSystemProviderError("disk full", FileSystemProviderErrorCode.Unavailable),
    })
    const resource = URI.parse("test:///workspace/README.md")
    const failures: FileOperationErrorEvent[] = []
    const operations: FileOperationEvent[] = []
    service.onDidFailOperation((event) => failures.push(event))
    service.onDidRunOperation((event) => operations.push(event))
    service.registerProvider("test", provider)

    await expect(service.writeFile(resource, new TextEncoder().encode("updated"), { create: true, overwrite: true })).rejects.toMatchObject({
      fileOperationResult: FileOperationResult.FILE_OTHER_ERROR,
      fileOperation: FileOperation.WRITE,
      rollbackRisk: "partial-write",
    })

    expect(operations).toEqual([])
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({
      resource,
      operation: FileOperation.WRITE,
      result: FileOperationResult.FILE_OTHER_ERROR,
      rollbackRisk: "partial-write",
    })
    expect(failures[0].reason).toContain("disk full")
  })

  it("cancels provider writeFile before touching the provider or emitting success", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const resource = URI.parse("test:///workspace/generated.txt")
    const source = new CancellationTokenSource()
    const failures: FileOperationErrorEvent[] = []
    const operations: FileOperationEvent[] = []
    service.onDidFailOperation((event) => failures.push(event))
    service.onDidRunOperation((event) => operations.push(event))
    service.registerProvider("test", provider)
    source.cancel()

    await expect(service.writeFile(resource, new TextEncoder().encode("generated"), { create: true, overwrite: true }, source.token)).rejects.toMatchObject({
      fileOperationResult: FileOperationResult.FILE_OTHER_ERROR,
    })

    expect(provider.writeFile).not.toHaveBeenCalled()
    expect(operations).toEqual([])
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({
      resource,
      operation: FileOperation.WRITE,
      rollbackRisk: "none",
    })
    await expect(service.exists(resource)).resolves.toBe(false)
  })

  it("publishes operation failure evidence for create move and delete errors", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const failures: FileOperationErrorEvent[] = []
    service.onDidFailOperation((event) => failures.push(event))
    service.registerProvider("test", provider)

    await expect(service.createFile(URI.parse("test:///workspace/README.md"))).rejects.toMatchObject({
      code: FileSystemProviderErrorCode.FileExists,
    })
    await expect(service.move(
      URI.parse("test:///workspace/missing-source.md"),
      URI.parse("test:///workspace/moved.md"),
    )).rejects.toMatchObject({
      code: FileSystemProviderErrorCode.FileNotFound,
    })
    await expect(service.delete(URI.parse("test:///workspace/missing.md"))).rejects.toMatchObject({
      code: FileSystemProviderErrorCode.FileNotFound,
    })

    expect(failures.map((event) => ({
      operation: event.operation,
      resource: event.resource.toString(),
      result: event.result,
      rollbackRisk: event.rollbackRisk,
    }))).toEqual([
      {
        operation: FileOperation.CREATE,
        resource: "test:/workspace/README.md",
        result: FileOperationResult.FILE_MOVE_CONFLICT,
        rollbackRisk: "none",
      },
      {
        operation: FileOperation.MOVE,
        resource: "test:/workspace/missing-source.md",
        result: FileOperationResult.FILE_NOT_FOUND,
        rollbackRisk: "unknown",
      },
      {
        operation: FileOperation.DELETE,
        resource: "test:/workspace/missing.md",
        result: FileOperationResult.FILE_NOT_FOUND,
        rollbackRisk: "unknown",
      },
    ])
  })

  it("activates providers through onWillActivateFileSystemProvider joiners", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const resource = URI.parse("lazy:///workspace/README.md")
    const activations: string[] = []
    service.onWillActivateFileSystemProvider((event) => {
      activations.push(event.scheme)
      if (service.getProvider(event.scheme)) return
      event.join(Promise.resolve().then(() => {
        if (service.getProvider(event.scheme)) return
        service.registerProvider(event.scheme, provider)
      }))
    })

    await expect(service.canHandleResource(resource)).resolves.toBe(true)
    await expect(service.stat(resource)).resolves.toMatchObject({ isFile: true })
    expect(activations).toEqual(["lazy", "lazy"])
  })

  it("forwards provider capability changes and lists current capabilities", () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const events: string[] = []
    service.onDidChangeFileSystemProviderCapabilities((event) => events.push(event.scheme))

    service.registerProvider("test", provider)
    provider.fireCapabilities()

    expect(events).toEqual(["test"])
    expect(service.hasCapability(URI.parse("test:///workspace/README.md"), FileSystemProviderCapabilities.FileReadWrite)).toBe(true)
    expect(Array.from(service.listCapabilities())).toEqual([{
      scheme: "test",
      capabilities: FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.PathCaseSensitive,
    }])
  })

  it("stops forwarding provider capability changes after unregister", () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const events: string[] = []
    service.onDidChangeFileSystemProviderCapabilities((event) => events.push(event.scheme))

    const registration = service.registerProvider("test", provider)
    provider.fireCapabilities()
    registration.dispose()
    provider.fireCapabilities()

    expect(events).toEqual(["test"])
  })

  it("forwards provider watch errors until the provider is unregistered", () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const errors: string[] = []
    service.onDidWatchError((error) => errors.push(error.message))

    const registration = service.registerProvider("test", provider)
    provider.fireWatchError("watch failed")
    registration.dispose()
    provider.fireWatchError("after unregister")

    expect(errors).toEqual(["watch failed"])
  })

  it("resolves all entries with VS Code-style per-entry error isolation", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    service.registerProvider("test", provider)

    const [readme, missing, folder] = await service.resolveAll([
      { resource: URI.parse("test:///workspace/README.md") },
      { resource: URI.parse("test:///workspace/missing.md") },
      { resource: URI.parse("test:///workspace/") },
    ])

    expect(readme).toMatchObject({ success: true, stat: { name: "README.md", isFile: true } })
    expect(missing).toEqual({ success: false, stat: undefined })
    expect(folder).toMatchObject({ success: true, stat: { name: "workspace", isDirectory: true } })
    expect(folder.stat?.children?.map((child) => child.name)).toEqual(["README.md", "src"])
  })

  it("prefers provider readFileStream for service-level streamed reads", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider({ stream: true })
    const resource = URI.parse("test:///workspace/README.md")
    service.registerProvider("test", provider)

    const result = await service.readFileStream(resource, { position: 1, length: 3 })

    expect(provider.readFileStream).toHaveBeenCalledWith(resource, { position: 1, length: 3 }, CancellationToken.None)
    await expect(consumeStream(result.value).then((data) => Array.from(data))).resolves.toEqual(Array.from(new TextEncoder().encode("EAD")))
    expect(result).toMatchObject({ resource, isFile: true })
  })

  it("bridges VS Code CancellationToken to provider streams and AbortSignal", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider({ stream: true, streamDelayMs: 20 })
    const resource = URI.parse("test:///workspace/README.md")
    const source = new CancellationTokenSource()
    service.registerProvider("test", provider)

    const result = await service.readFileStream(resource, {}, source.token)
    const read = consumeStream(result.value)
    source.cancel()

    expect(provider.readFileStream).toHaveBeenCalledWith(
      resource,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      source.token,
    )
    await expect(read).rejects.toMatchObject({
      fileOperationResult: FileOperationResult.FILE_OTHER_ERROR,
    })
  })

  it("falls back to provider open read close when buffered readFile is not available", async () => {
    const service = new FileService()
    const provider = createOpenReadWriteCloseProvider()
    const resource = URI.parse("test:///workspace/README.md")
    service.registerProvider("test", provider)

    await expect(service.readFile(resource, { position: 1, length: 4 }).then((data) => new TextDecoder().decode(data))).resolves.toBe("EADM")

    expect(provider.open).toHaveBeenCalledWith(resource, { create: false })
    expect(provider.read).toHaveBeenCalled()
    expect(provider.close).toHaveBeenCalledTimes(1)
  })

  it("falls back to provider open write close when writeFile is not available", async () => {
    const service = new FileService()
    const provider = createOpenReadWriteCloseProvider()
    const resource = URI.parse("test:///workspace/generated.txt")
    service.registerProvider("test", provider)

    const stat = await service.writeFile(resource, new TextEncoder().encode("generated"), { create: true, overwrite: true })

    expect(stat).toMatchObject({ resource, isFile: true, size: 9 })
    expect(provider.open).toHaveBeenCalledWith(resource, { create: true, append: false })
    expect(provider.write).toHaveBeenCalled()
    expect(provider.close).toHaveBeenCalledTimes(1)
    await expect(service.readFile(resource).then((data) => new TextDecoder().decode(data))).resolves.toBe("generated")
  })

  it("cancels open write close fallback without reporting success and still closes the handle", async () => {
    const service = new FileService()
    const source = new CancellationTokenSource()
    const provider = createOpenReadWriteCloseProvider({
      afterOpen: () => source.cancel(),
    })
    const resource = URI.parse("test:///workspace/cancelled.txt")
    const failures: FileOperationErrorEvent[] = []
    const operations: FileOperationEvent[] = []
    service.onDidFailOperation((event) => failures.push(event))
    service.onDidRunOperation((event) => operations.push(event))
    service.registerProvider("test", provider)

    await expect(service.writeFile(resource, new TextEncoder().encode("cancelled"), { create: true, overwrite: true }, source.token)).rejects.toMatchObject({
      fileOperationResult: FileOperationResult.FILE_OTHER_ERROR,
    })

    expect(provider.open).toHaveBeenCalledWith(resource, { create: true, append: false })
    expect(provider.write).not.toHaveBeenCalled()
    expect(provider.close).toHaveBeenCalledTimes(1)
    expect(operations).toEqual([])
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({
      resource,
      operation: FileOperation.WRITE,
      rollbackRisk: "none",
    })
    await expect(service.exists(resource)).resolves.toBe(false)
  })

  it("validates read metadata before calling provider read", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const resource = URI.parse("test:///workspace/README.md")
    service.registerProvider("test", provider)
    const currentEtag = etag({ mtime: 1, size: 12 })

    await expect(service.readFile(resource, { etag: currentEtag })).rejects.toBeInstanceOf(NotModifiedSinceFileOperationError)
    await expect(service.readFileStream(resource, { limits: { size: 11 } })).rejects.toBeInstanceOf(TooLargeFileOperationError)
    await expect(service.readFile(resource, { etag: ETAG_DISABLED, limits: { size: 12 } }).then((data) => Array.from(data))).resolves.toEqual(Array.from(new TextEncoder().encode("README")))

    expect(provider.readFile).toHaveBeenCalledTimes(1)
  })

  it("maps NotModifiedSince and TooLarge reads to VS Code FileOperationResult values", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const resource = URI.parse("test:///workspace/README.md")
    service.registerProvider("test", provider)

    await expect(service.readFileStream(resource, { etag: etag({ mtime: 1, size: 12 }) })).rejects.toMatchObject({
      fileOperationResult: FileOperationResult.FILE_NOT_MODIFIED_SINCE,
      stat: expect.objectContaining({ etag: etag({ mtime: 1, size: 12 }) }),
    })
    await expect(service.readFile(resource, { limits: { size: 1 } })).rejects.toMatchObject({
      fileOperationResult: FileOperationResult.FILE_TOO_LARGE,
      size: 12,
    })
  })

  it("falls back from service readFileStream to readFile with position and length slicing", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const resource = URI.parse("test:///workspace/README.md")
    service.registerProvider("test", provider)

    const result = await service.readFileStream(resource, { position: 2, length: 3 })

    expect(provider.readFileStream).toBeUndefined()
    await expect(consumeStream(result.value).then((data) => Array.from(data))).resolves.toEqual(Array.from(new TextEncoder().encode("ADM")))
  })

  it("aborts fallback readFileStream without publishing late provider data", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider({ readDelayMs: 20 })
    const resource = URI.parse("test:///workspace/README.md")
    const controller = new AbortController()
    service.registerProvider("test", provider)

    const result = await service.readFileStream(resource, { signal: controller.signal })
    const read = consumeStream(result.value)
    controller.abort("test abort")

    await expect(read).rejects.toMatchObject({
      fileOperationResult: FileOperationResult.FILE_OTHER_ERROR,
    })
    expect(provider.readFile).toHaveBeenCalledTimes(1)
  })

  it("aborts provider readFileStream without emitting buffered data", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider({ streamDelayMs: 20 })
    const resource = URI.parse("test:///workspace/README.md")
    const controller = new AbortController()
    service.registerProvider("test", provider)

    const result = await service.readFileStream(resource, { signal: controller.signal })
    const read = consumeStream(result.value)
    controller.abort("stop stream")

    await expect(read).rejects.toMatchObject({
      fileOperationResult: FileOperationResult.FILE_OTHER_ERROR,
    })
  })

  it("maps provider readFileStream errors through FileOperationError", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider({ streamError: createFileSystemProviderError("denied", FileSystemProviderErrorCode.NoPermissions) })
    const resource = URI.parse("test:///workspace/README.md")
    service.registerProvider("test", provider)

    const result = await service.readFileStream(resource)

    await expect(consumeStream(result.value)).rejects.toMatchObject({
      fileOperationResult: FileOperationResult.FILE_PERMISSION_DENIED,
    })
  })

  it("maps readFile fallback stream errors through FileOperationError", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const resource = URI.parse("test:///workspace/missing.md")
    service.registerProvider("test", provider)

    await expect(service.readFileStream(resource)).rejects.toMatchObject({
      fileOperationResult: FileOperationResult.FILE_NOT_FOUND,
    })
  })

  it("keeps missing metadata strict unless read callers explicitly opt into provider reads", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider({ virtualContent: "virtual" })
    const resource = URI.parse("test:///workspace/virtual.md")
    service.registerProvider("test", provider)

    await expect(service.readFile(resource)).rejects.toMatchObject({
      fileOperationResult: FileOperationResult.FILE_NOT_FOUND,
    })
    await expect(service.readFile(resource, { allowMissingReadMetadata: true }).then((data) => new TextDecoder().decode(data))).resolves.toBe("virtual")
  })

  it("maps provider errors without regressing FileNotFound FileExists and NoPermissions semantics", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    service.registerProvider("test", provider)

    await expect(service.resolve(URI.parse("test:///workspace/missing.md"))).rejects.toMatchObject({
      fileOperationResult: FileOperationResult.FILE_NOT_FOUND,
    })
    await expect(service.createFile(URI.parse("test:///workspace/README.md"))).rejects.toMatchObject({
      code: FileSystemProviderErrorCode.FileExists,
    })

    const permissionError = createFileSystemProviderError("denied", FileSystemProviderErrorCode.NoPermissions)
    expect(toFileSystemProviderErrorCode(permissionError)).toBe(FileSystemProviderErrorCode.NoPermissions)
    expect(toFileOperationResult(permissionError)).toBe(FileOperationResult.FILE_PERMISSION_DENIED)
    expect(toFileOperationResult(createFileSystemProviderError("exists", FileSystemProviderErrorCode.FileExists))).toBe(FileOperationResult.FILE_MOVE_CONFLICT)
    expect(toFileOperationResult(new FileOperationError("not found", FileOperationResult.FILE_NOT_FOUND))).toBe(FileOperationResult.FILE_NOT_FOUND)

    const marked = new Error("marked")
    marked.name = `${FileSystemProviderErrorCode.FileNotFound} (FileSystemError)`
    expect(toFileSystemProviderErrorCode(marked)).toBe(FileSystemProviderErrorCode.FileNotFound)
    expect(new FileSystemProviderError("missing", FileSystemProviderErrorCode.FileNotFound).code).toBe(FileSystemProviderErrorCode.FileNotFound)
  })

  it("runs service-level create folder move copy delete operations with FileOperation events", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider()
    const operations: FileOperationEvent[] = []
    service.onDidRunOperation((event) => operations.push(event))
    service.registerProvider("test", provider)

    const created = await service.createFile(URI.parse("test:///workspace/new.txt"), new TextEncoder().encode("new"))
    const folder = await service.createFolder(URI.parse("test:///workspace/generated"))
    const moved = await service.move(URI.parse("test:///workspace/new.txt"), URI.parse("test:///workspace/moved.txt"))
    const copied = await service.copy(URI.parse("test:///workspace/moved.txt"), URI.parse("test:///workspace/copied.txt"))
    await service.delete(URI.parse("test:///workspace/moved.txt"))

    expect(created.isFile).toBe(true)
    expect(folder.isDirectory).toBe(true)
    expect(moved.resource.toString()).toBe("test:/workspace/moved.txt")
    expect(copied.resource.toString()).toBe("test:/workspace/copied.txt")
    expect(operations.map((event) => event.operation)).toEqual([
      FileOperation.WRITE,
      FileOperation.CREATE,
      FileOperation.CREATE,
      FileOperation.MOVE,
      FileOperation.COPY,
      FileOperation.DELETE,
    ])
    expect(operations[1].isOperation(FileOperation.CREATE)).toBe(true)
    expect(operations[3].isOperation(FileOperation.MOVE)).toBe(true)
    expect(operations[4].isOperation(FileOperation.COPY)).toBe(true)
    expect(operations[5].isOperation(FileOperation.DELETE)).toBe(true)
  })

  it("keeps readonly providers protected for service-level operations", async () => {
    const service = new FileService()
    const provider = createTestFileSystemProvider({ capabilities: FileSystemProviderCapabilities.Readonly })
    service.registerProvider("readonly", provider)
    const resource = URI.parse("readonly:///workspace/README.md")

    await expect(service.createFile(resource, new Uint8Array())).rejects.toMatchObject({
      code: FileSystemProviderErrorCode.NoPermissions,
    })
    await expect(service.createFolder(URI.parse("readonly:///workspace/generated"))).rejects.toMatchObject({
      code: FileSystemProviderErrorCode.NoPermissions,
    })
    await expect(service.move(resource, URI.parse("readonly:///workspace/renamed.md"))).rejects.toMatchObject({
      code: FileSystemProviderErrorCode.NoPermissions,
    })
    await expect(service.copy(resource, URI.parse("readonly:///workspace/copied.md"))).rejects.toMatchObject({
      code: FileSystemProviderErrorCode.NoPermissions,
    })
    await expect(service.delete(resource)).rejects.toMatchObject({
      code: FileSystemProviderErrorCode.NoPermissions,
    })
  })
})

function createTestFileSystemProvider(options: {
  capabilities?: FileSystemProviderCapabilities
  stream?: boolean
  streamError?: Error
  readDelayMs?: number
  streamDelayMs?: number
  virtualContent?: string
  writeError?: Error
} = {}): IFileSystemProvider & {
  fireChanges(changes: readonly IFileChange[]): void
  fireCapabilities(): void
  fireWatchError(message: string): void
  watch: ReturnType<typeof vi.fn>
  writeFile: ReturnType<typeof vi.fn>
  readFileStream?: ReturnType<typeof vi.fn>
  disposeWatch: ReturnType<typeof vi.fn>
} {
  const onDidChangeCapabilities = new Emitter<void>()
  const onDidChangeFile = new Emitter<readonly IFileChange[]>()
  const onDidWatchError = new Emitter<string>()
  const disposeWatch = vi.fn()
  const entries = new Map<string, { type: FileType; size: number; mtime: number; ctime: number }>([
    ["/workspace/", { type: FileType.Directory, size: 0, mtime: 0, ctime: 0 }],
    ["/workspace/README.md", { type: FileType.File, size: 12, mtime: 1, ctime: 1 }],
    ["/workspace/src", { type: FileType.Directory, size: 0, mtime: 2, ctime: 2 }],
  ])
  const provider: IFileSystemProvider & {
    fireChanges(changes: readonly IFileChange[]): void
    fireCapabilities(): void
    fireWatchError(message: string): void
    watch: ReturnType<typeof vi.fn>
    writeFile: ReturnType<typeof vi.fn>
    readFileStream?: ReturnType<typeof vi.fn>
    disposeWatch: ReturnType<typeof vi.fn>
  } = {
    capabilities: options.capabilities ?? (
      FileSystemProviderCapabilities.FileReadWrite
      | (options.stream || options.streamError || options.streamDelayMs ? FileSystemProviderCapabilities.FileReadStream : FileSystemProviderCapabilities.None)
      | FileSystemProviderCapabilities.PathCaseSensitive
    ),
    onDidChangeCapabilities: onDidChangeCapabilities.event,
    onDidChangeFile: onDidChangeFile.event,
    onDidWatchError: onDidWatchError.event,
    fireChanges(changes) {
      onDidChangeFile.fire(changes)
    },
    fireCapabilities() {
      onDidChangeCapabilities.fire()
    },
    fireWatchError(message) {
      onDidWatchError.fire(message)
    },
    async stat(resource) {
      const stat = entries.get(resource.path)
      if (!stat) throw createFileSystemProviderError(`missing ${resource.toString()}`, FileSystemProviderErrorCode.FileNotFound)
      return stat
    },
    async readdir(resource) {
      if (resource.path !== "/workspace/") return []
      return [
        ["README.md", FileType.File],
        ["src", FileType.Directory],
      ]
    },
    readFile: vi.fn(async (resource: URI) => {
      if (typeof options.readDelayMs === "number") {
        await new Promise((resolve) => setTimeout(resolve, options.readDelayMs))
      }
      if (resource.path === "/workspace/virtual.md" && typeof options.virtualContent === "string") {
        return new TextEncoder().encode(options.virtualContent)
      }
      if (resource.path !== "/workspace/README.md") throw new Error(`missing ${resource.toString()}`)
      return new TextEncoder().encode("README")
    }),
    writeFile: vi.fn(async (resource: URI, content: Uint8Array) => {
      if (options.writeError) throw options.writeError
      const existing = entries.get(resource.path)
      entries.set(resource.path, {
        type: FileType.File,
        size: content.byteLength,
        mtime: existing ? existing.mtime + 1 : 1,
        ctime: existing?.ctime ?? 1,
      })
    }),
    mkdir: vi.fn(async (resource: URI) => {
      entries.set(resource.path, { type: FileType.Directory, size: 0, mtime: 1, ctime: 1 })
    }),
    delete: vi.fn(async (resource: URI) => {
      if (!entries.delete(resource.path)) throw createFileSystemProviderError("missing", FileSystemProviderErrorCode.FileNotFound)
    }),
    rename: vi.fn(async (from: URI, to: URI) => {
      const stat = entries.get(from.path)
      if (!stat) throw createFileSystemProviderError("missing", FileSystemProviderErrorCode.FileNotFound)
      entries.delete(from.path)
      entries.set(to.path, stat)
    }),
    copy: vi.fn(async (from: URI, to: URI) => {
      const stat = entries.get(from.path)
      if (!stat) throw createFileSystemProviderError("missing", FileSystemProviderErrorCode.FileNotFound)
      entries.set(to.path, { ...stat })
    }),
    watch: vi.fn(() => ({ dispose: disposeWatch })),
    disposeWatch,
  }
  if (options.stream || options.streamError || options.streamDelayMs) {
    provider.readFileStream = vi.fn((resource: URI, opts: IFileReadStreamOptions = {}) => {
      const stream = new TestReadableStream<Uint8Array>()
      if (options.streamError) {
        queueMicrotask(() => stream.error(options.streamError!))
        return stream
      }
      provider.readFile?.(resource).then((data) => {
        const position = Math.max(0, opts.position || 0)
        const length = typeof opts.length === "number" && opts.length >= 0 ? opts.length : undefined
        const publish = () => stream.end(length === undefined ? data.slice(position) : data.slice(position, position + length))
        if (typeof options.streamDelayMs === "number") setTimeout(publish, options.streamDelayMs)
        else publish()
      }, (error) => stream.error(error instanceof Error ? error : new Error(String(error))))
      return stream
    })
  }
  return provider
}

function createOpenReadWriteCloseProvider(options: {
  afterOpen?: () => void
  beforeWrite?: () => void
  skipWriteWhenCancelled?: () => boolean
} = {}): IFileSystemProvider & {
  open: ReturnType<typeof vi.fn>
  read: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
} {
  const onDidChangeCapabilities = new Emitter<void>()
  const onDidChangeFile = new Emitter<readonly IFileChange[]>()
  const entries = new Map<string, Uint8Array>([
    ["/workspace/README.md", new TextEncoder().encode("README")],
  ])
  const handles = new Map<number, { resource: URI; content: Uint8Array; dirty: boolean }>()
  let handlePool = 1
  return {
    capabilities: FileSystemProviderCapabilities.FileOpenReadWriteClose | FileSystemProviderCapabilities.PathCaseSensitive,
    onDidChangeCapabilities: onDidChangeCapabilities.event,
    onDidChangeFile: onDidChangeFile.event,
    async stat(resource) {
      if (resource.path === "/workspace/") return { type: FileType.Directory, size: 0, mtime: 1, ctime: 1 }
      const content = entries.get(resource.path)
      if (!content) throw createFileSystemProviderError(`missing ${resource.toString()}`, FileSystemProviderErrorCode.FileNotFound)
      return { type: FileType.File, size: content.byteLength, mtime: 1, ctime: 1 }
    },
    async readdir(resource) {
      if (resource.path !== "/workspace/") return []
      return Array.from(entries.keys()).map((path) => [path.split("/").pop() || path, FileType.File] as [string, FileType])
    },
    open: vi.fn(async (resource: URI, opts: { create?: boolean } = {}) => {
      const content = opts.create ? new Uint8Array() : entries.get(resource.path)
      if (!content) throw createFileSystemProviderError(`missing ${resource.toString()}`, FileSystemProviderErrorCode.FileNotFound)
      const handle = handlePool++
      handles.set(handle, { resource, content: content.slice(), dirty: false })
      options.afterOpen?.()
      return handle
    }),
    read: vi.fn(async (handle: number, pos: number, data: Uint8Array, offset: number, length: number) => {
      const entry = handles.get(handle)
      if (!entry) throw createFileSystemProviderError("invalid handle", FileSystemProviderErrorCode.Unavailable)
      const chunk = entry.content.slice(pos, pos + length)
      data.set(chunk, offset)
      return chunk.byteLength
    }),
    write: vi.fn(async (handle: number, pos: number, data: Uint8Array, offset: number, length: number) => {
      const entry = handles.get(handle)
      if (!entry) throw createFileSystemProviderError("invalid handle", FileSystemProviderErrorCode.Unavailable)
      options.beforeWrite?.()
      if (options.skipWriteWhenCancelled?.()) return length
      const next = new Uint8Array(Math.max(entry.content.byteLength, pos + length))
      next.set(entry.content)
      next.set(data.slice(offset, offset + length), pos)
      entry.content = next
      entry.dirty = true
      return length
    }),
    close: vi.fn(async (handle: number) => {
      const entry = handles.get(handle)
      if (!entry) return
      handles.delete(handle)
      if (entry.dirty) {
        entries.set(entry.resource.path, entry.content)
        onDidChangeFile.fire([{ type: FileChangeType.UPDATED, resource: entry.resource }])
      }
    }),
    watch: vi.fn(() => ({ dispose() {} })),
  }
}

async function consumeStream(stream: IReadableStreamEvents<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  return new Promise((resolve, reject) => {
    stream.onData((chunk) => chunks.push(chunk))
    stream.onError(reject)
    stream.onEnd(() => {
      const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
      const result = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.byteLength
      }
      resolve(result)
    })
  })
}

class TestReadableStream<T> implements IReadableStreamEvents<T> {
  private dataListeners = new Set<(data: T) => unknown>()
  private errorListeners = new Set<(error: Error) => unknown>()
  private endListeners = new Set<() => unknown>()
  private ended = false
  private bufferedData: T[] = []
  private bufferedError: Error | undefined

  onData(listener: (data: T) => unknown) {
    this.dataListeners.add(listener)
    for (const data of this.bufferedData) listener(data)
    return { dispose: () => { this.dataListeners.delete(listener) } }
  }

  onError(listener: (error: Error) => unknown) {
    this.errorListeners.add(listener)
    if (this.bufferedError) listener(this.bufferedError)
    return { dispose: () => { this.errorListeners.delete(listener) } }
  }

  onEnd(listener: () => unknown) {
    this.endListeners.add(listener)
    if (this.ended) listener()
    return { dispose: () => { this.endListeners.delete(listener) } }
  }

  end(data: T): void {
    if (this.ended) return
    this.bufferedData.push(data)
    for (const listener of Array.from(this.dataListeners)) listener(data)
    this.ended = true
    for (const listener of Array.from(this.endListeners)) listener()
  }

  error(error: Error): void {
    if (this.ended) return
    this.bufferedError = error
    this.ended = true
    for (const listener of Array.from(this.errorListeners)) listener(error)
    for (const listener of Array.from(this.endListeners)) listener()
  }
}
