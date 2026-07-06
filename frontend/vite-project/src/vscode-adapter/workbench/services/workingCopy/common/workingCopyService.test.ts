import { describe, expect, it } from "vitest"
import { URI } from "../../../../base/common/uri"
import { Emitter } from "../../../../base/common/event"
import { getSingletonServiceDescriptors } from "../../../../platform/instantiation/common/extensions"
import { InstantiationService } from "../../../../platform/instantiation/common/instantiationService"
import { ServiceCollection } from "../../../../platform/instantiation/common/serviceCollection"
import {
  IWorkingCopyService,
  WorkingCopyHotExitTracker,
  WorkingCopyService,
  globalWorkingCopyService,
  type IWorkingCopy,
  type IWorkingCopySaveEvent,
} from "./workingCopyService"
import { InMemoryWorkingCopyBackupService } from "./storedFileWorkingCopy"

function createWorkingCopy(resource: URI, typeId = "test"): IWorkingCopy & {
  markDirty(): void
  markSaved(): void
} {
  let dirty = false
  const onDidChangeDirtyEmitter = new Emitter<void>()
  const onDidChangeContentEmitter = new Emitter<void>()
  const onDidSaveEmitter = new Emitter<IWorkingCopySaveEvent>()
  return {
    resource,
    typeId,
    onDidChangeDirty: onDidChangeDirtyEmitter.event,
    onDidChangeContent: onDidChangeContentEmitter.event,
    onDidSave: onDidSaveEmitter.event,
    isDirty: () => dirty,
    markDirty() {
      dirty = true
      onDidChangeDirtyEmitter.fire()
    },
    markSaved() {
      dirty = false
      onDidSaveEmitter.fire({})
    },
  }
}

describe("VS Code WorkingCopyService adapter", () => {
  it("registers a VS Code-style IWorkingCopyService identifier and singleton", () => {
    const service = new WorkingCopyService()
    const collection = new ServiceCollection([IWorkingCopyService, service])
    const instantiationService = new InstantiationService(collection)

    const resolved = instantiationService.invokeFunction((accessor) => accessor.get(IWorkingCopyService))

    expect(String(IWorkingCopyService)).toBe("workingCopyService")
    expect(resolved).toBe(service)
    expect(resolved._serviceBrand).toBeUndefined()
    expect(globalWorkingCopyService._serviceBrand).toBeUndefined()
    expect(getSingletonServiceDescriptors().some(([id, instance]) => id === IWorkingCopyService && instance === globalWorkingCopyService)).toBe(true)
  })

  it("registers working copies and forwards dirty/save lifecycle events", () => {
    const service = new WorkingCopyService()
    const workingCopy = createWorkingCopy(URI.file("D:/repo/src/main.ts"))
    const events: string[] = []
    service.onDidRegister((copy) => events.push(`register:${copy.resource.path}`))
    service.onDidChangeDirty((copy) => events.push(`dirty:${copy.isDirty()}`))
    service.onDidSave((event) => events.push(`save:${event.workingCopy.resource.path}`))

    const disposable = service.registerWorkingCopy(workingCopy)
    workingCopy.markDirty()
    workingCopy.markSaved()

    expect(service.dirtyCount).toBe(0)
    expect(service.modifiedCount).toBe(0)
    expect(events).toEqual([
      "register:/D:/repo/src/main.ts",
      "dirty:true",
      "save:/D:/repo/src/main.ts",
    ])
    disposable.dispose()
    expect(service.workingCopies).toEqual([])
  })

  it("rejects duplicate resource and type registrations", () => {
    const service = new WorkingCopyService()
    const resource = URI.file("D:/repo/src/main.ts")
    service.registerWorkingCopy(createWorkingCopy(resource))

    expect(() => service.registerWorkingCopy(createWorkingCopy(resource))).toThrow(/Cannot register/)
  })

  it("tracks dirty working copies for backup restore and discard", async () => {
    const service = new WorkingCopyService()
    const backupService = new InMemoryWorkingCopyBackupService()
    const tracker = new WorkingCopyHotExitTracker(service, backupService)
    const clean = createWorkingCopy(URI.file("D:/repo/src/clean.ts"))
    const dirty = createWorkingCopy(URI.file("D:/repo/src/dirty.ts"))
    service.registerWorkingCopy(clean)
    service.registerWorkingCopy(dirty)
    dirty.markDirty()

    expect(tracker.dirtyWorkingCopies.map((workingCopy) => workingCopy.resource.fsPath)).toEqual(["d:/repo/src/dirty.ts"])
    await expect(tracker.backupDirtyWorkingCopies((workingCopy) => `backup:${workingCopy.resource.path}`)).resolves.toEqual([
      dirty.resource,
    ])

    const backups = await tracker.resolveBackups()
    expect(backups).toHaveLength(1)
    expect(`${backups[0].identifier.typeId}:${backups[0].identifier.resource.fsPath}`).toBe("test:d:/repo/src/dirty.ts")
    expect(backups[0].backup).toEqual({
      value: "backup:/D:/repo/src/dirty.ts",
      meta: {
        state: "dirty",
      },
    })

    await tracker.discardBackups()
    await expect(tracker.resolveBackups()).resolves.toEqual([])
  })

  it("projects evidence-safe backup actions without leaking backup content", async () => {
    const service = new WorkingCopyService()
    const backupService = new InMemoryWorkingCopyBackupService()
    const tracker = new WorkingCopyHotExitTracker(service, backupService)
    const dirty = createWorkingCopy(URI.file("D:/repo/src/dirty.ts"))
    service.registerWorkingCopy(dirty)
    dirty.markDirty()

    const result = await tracker.backupDirtyWorkingCopiesWithProjection(
      () => "secret unsaved content",
      () => ({
        state: "dirty",
        source: "restart",
        backupContentHash: "hash-123",
        payload: { shouldNotLeak: "raw" },
      }),
    )

    expect(result.backedUp.map((resource) => resource.fsPath)).toEqual(["d:/repo/src/dirty.ts"])
    expect(result.actions).toEqual([{
      id: "backup",
      resource: dirty.resource.toString(),
      typeId: "test",
      state: "dirty",
      source: "restart",
      payloadKeys: ["backupContentHash", "payload", "source", "state"],
      evidenceSafe: true,
    }])
    expect(JSON.stringify(result.actions)).not.toContain("secret unsaved content")
    expect(JSON.stringify(result.actions)).not.toContain("shouldNotLeak")
  })

  it("creates restore and shutdown projections from one working copy backup source", async () => {
    const service = new WorkingCopyService()
    const backupService = new InMemoryWorkingCopyBackupService()
    const tracker = new WorkingCopyHotExitTracker(service, backupService)
    const dirty = createWorkingCopy(URI.file("D:/repo/src/dirty.ts"))
    const clean = createWorkingCopy(URI.file("D:/repo/src/clean.ts"))
    service.registerWorkingCopy(dirty)
    service.registerWorkingCopy(clean)
    dirty.markDirty()
    await backupService.backup({ resource: dirty.resource, typeId: dirty.typeId }, "dirty content", undefined, {
      state: "dirty",
      source: "restart",
      mtime: 100,
      backupContentHash: "hash-dirty",
    })

    await expect(tracker.createShutdownVetoProjection("restart")).resolves.toEqual({
      reason: "restart",
      veto: true,
      dirtyCount: 1,
      pendingBackupCount: 1,
      force: false,
      actions: [{
        id: "backup",
        resource: dirty.resource.toString(),
        typeId: "test",
        state: "dirty",
        source: "restart",
        payloadKeys: ["backupContentHash", "mtime", "source", "state"],
        evidenceSafe: true,
      }],
    })
    await expect(tracker.createShutdownVetoProjection("restart", { force: true })).resolves.toMatchObject({
      reason: "restart",
      veto: false,
      dirtyCount: 1,
      pendingBackupCount: 1,
      force: true,
    })

    const restoreModel = await tracker.createRestoreModel()
    expect(restoreModel.entries[0].identifier.resource.toString()).toBe(dirty.resource.toString())
    expect(restoreModel).toMatchObject({
      hasBackups: true,
      count: 1,
      entries: [{
        identifier: { typeId: "test" },
        state: "dirty",
        source: "restart",
        mtime: 100,
        backupContentHash: "hash-dirty",
        diskContentHash: undefined,
        actions: [
          {
            id: "restore",
            resource: dirty.resource.toString(),
            typeId: "test",
            state: "dirty",
            source: "restart",
            payloadKeys: ["backupContentHash", "mtime", "source", "state"],
            evidenceSafe: true,
          },
          {
            id: "discard",
            resource: dirty.resource.toString(),
            typeId: "test",
            state: "dirty",
            source: "restart",
            payloadKeys: ["backupContentHash", "mtime", "source", "state"],
            evidenceSafe: true,
          },
          {
            id: "open-as-conflict",
            resource: dirty.resource.toString(),
            typeId: "test",
            state: "dirty",
            source: "restart",
            payloadKeys: ["backupContentHash", "mtime", "source", "state"],
            evidenceSafe: true,
          },
          {
            id: "open-as-orphan",
            resource: dirty.resource.toString(),
            typeId: "test",
            state: "dirty",
            source: "restart",
            payloadKeys: ["backupContentHash", "mtime", "source", "state"],
            evidenceSafe: true,
          },
        ],
      }],
    })
  })

  it("cleans stale backups while retaining active dirty working copies", async () => {
    const service = new WorkingCopyService()
    const backupService = new InMemoryWorkingCopyBackupService()
    const tracker = new WorkingCopyHotExitTracker(service, backupService)
    const activeDirty = createWorkingCopy(URI.file("D:/repo/src/active.ts"))
    const staleClean = createWorkingCopy(URI.file("D:/repo/src/stale.ts"))
    service.registerWorkingCopy(activeDirty)
    service.registerWorkingCopy(staleClean)
    activeDirty.markDirty()

    await tracker.backupDirtyWorkingCopies((workingCopy) => `backup:${workingCopy.resource.path}`)
    await backupService.backup({ resource: staleClean.resource, typeId: staleClean.typeId }, "stale clean")

    await expect(tracker.cleanupBackups().then((identifiers) => identifiers.map((identifier) => identifier.resource.fsPath))).resolves.toEqual([
      "d:/repo/src/stale.ts",
    ])
    await expect(tracker.resolveBackups().then((entries) => entries.map((entry) => entry.identifier.resource.fsPath))).resolves.toEqual([
      "d:/repo/src/active.ts",
    ])
  })

  it("reports cleanup policy decisions as evidence-safe actions", async () => {
    const service = new WorkingCopyService()
    const backupService = new InMemoryWorkingCopyBackupService()
    const tracker = new WorkingCopyHotExitTracker(service, backupService)
    const keep = createWorkingCopy(URI.file("D:/repo/src/keep.ts"))
    const remove = createWorkingCopy(URI.file("D:/repo/src/remove.ts"))
    service.registerWorkingCopy(keep)
    keep.markDirty()
    await backupService.backup({ resource: keep.resource, typeId: keep.typeId }, "keep", undefined, { state: "dirty", source: "manual" })
    await backupService.backup({ resource: remove.resource, typeId: remove.typeId }, "raw stale content should not leak", undefined, { state: "clean", source: "cleanup" })

    const cleanup = await tracker.cleanupBackupsWithProjection()
    expect(cleanup.kept.map((identifier) => `${identifier.typeId}:${identifier.resource.toString()}`)).toEqual([
      `test:${keep.resource.toString()}`,
    ])
    expect(cleanup.removed.map((identifier) => `${identifier.typeId}:${identifier.resource.toString()}`)).toEqual([
      `test:${remove.resource.toString()}`,
    ])
    expect(cleanup.actions).toEqual([{
      id: "cleanup",
      resource: remove.resource.toString(),
      typeId: "test",
      state: "clean",
      source: "cleanup",
      payloadKeys: ["source", "state"],
      evidenceSafe: true,
    }])
    expect(cleanup.owner).toEqual({
      source: "WorkingCopyHotExitTracker.cleanupBackupsWithProjection",
      backupOwner: "IWorkingCopyBackupService",
      dirtySource: "IWorkingCopyService.dirtyWorkingCopies",
      stateSource: "single-working-copy-backup-service",
      status: "connected",
    })
    expect(cleanup.decisions).toEqual([
      {
        resource: keep.resource.toString(),
        typeId: "test",
        decision: "keep",
        reason: "activeDirtyWorkingCopy",
        readonly: true,
        safeCleanup: true,
        blockedReason: undefined,
      },
      {
        resource: remove.resource.toString(),
        typeId: "test",
        decision: "remove",
        reason: "staleBackup",
        readonly: true,
        safeCleanup: true,
        blockedReason: undefined,
      },
    ])
    expect(cleanup.policy).toEqual({
      keepDirty: true,
      exceptCount: 0,
      hasCustomKeep: false,
      readonly: true,
      safeCleanup: true,
    })
    expect(JSON.stringify(cleanup)).not.toContain("raw stale content should not leak")
  })

  it("marks cleanup as partial when UI owner is intentionally outside the service projection", async () => {
    const service = new WorkingCopyService()
    const backupService = new InMemoryWorkingCopyBackupService()
    const tracker = new WorkingCopyHotExitTracker(service, backupService)
    const keep = createWorkingCopy(URI.file("D:/repo/src/keep-by-policy.ts"))
    await backupService.backup({ resource: keep.resource, typeId: keep.typeId }, "policy keep", undefined, { state: "clean" })

    const cleanup = await tracker.cleanupBackupsWithProjection({
      keep: () => true,
      uiOwnerConnected: false,
      uiOwnerBlockedReason: "App.vue owner not migrated in this service-only projection",
    })

    expect(cleanup.removed).toEqual([])
    expect(cleanup.owner).toEqual(expect.objectContaining({
      status: "partial",
      blockedReason: "App.vue owner not migrated in this service-only projection",
    }))
    expect(cleanup.decisions).toEqual([expect.objectContaining({
      decision: "keep",
      reason: "customKeepPolicy",
      blockedReason: "App.vue owner not migrated in this service-only projection",
      readonly: true,
      safeCleanup: true,
    })])
  })
})
