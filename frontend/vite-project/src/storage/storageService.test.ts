import { describe, expect, it } from "vitest"
import {
  CodekStorageService,
  StorageScope,
  StorageTarget,
  WillSaveStateReason,
} from "./storageService"

describe("CodekStorageService", () => {
  it("isolates application, profile, and workspace values while tracking target keys", () => {
    const storage = new CodekStorageService({ workspaceId: "workspace-a", profileId: "profile-a" })

    storage.store("recent", "global-value", StorageScope.APPLICATION, StorageTarget.USER)
    storage.store("recent", "profile-value", StorageScope.PROFILE, StorageTarget.USER)
    storage.store("recent", "workspace-value", StorageScope.WORKSPACE, StorageTarget.MACHINE)

    expect(storage.get("recent", StorageScope.APPLICATION)).toBe("global-value")
    expect(storage.get("recent", StorageScope.PROFILE)).toBe("profile-value")
    expect(storage.get("recent", StorageScope.WORKSPACE)).toBe("workspace-value")
    expect(storage.keys(StorageScope.PROFILE, StorageTarget.USER)).toEqual(["recent"])
    expect(storage.keys(StorageScope.WORKSPACE, StorageTarget.MACHINE)).toEqual(["recent"])
  })

  it("emits scoped change, target, flush, backup, and migration events", async () => {
    const storage = new CodekStorageService({ workspaceId: "workspace-a", profileId: "profile-a" })
    const changes: string[] = []
    const targetChanges: StorageScope[] = []
    const willSaveReasons: WillSaveStateReason[] = []
    const backupReasons: string[] = []
    const migrationSources: string[] = []

    storage.onDidChangeValue(StorageScope.WORKSPACE, undefined)((event) => changes.push(`${event.key}:${event.external ? "external" : "local"}`))
    storage.onDidChangeTarget((event) => targetChanges.push(event.scope))
    storage.onWillSaveState((event) => willSaveReasons.push(event.reason))
    storage.onDidBackup((event) => backupReasons.push(event.reason))
    storage.onDidMigrate((event) => migrationSources.push(event.source))

    storage.store("alpha", 1, StorageScope.WORKSPACE, StorageTarget.USER)
    storage.store("alpha", undefined, StorageScope.WORKSPACE, StorageTarget.USER)
    await storage.flush(WillSaveStateReason.SHUTDOWN)
    const snapshot = await storage.backup("hot-exit")
    storage.migrate({
      source: "profile-import",
      entries: [{ key: "beta", value: "2", scope: StorageScope.WORKSPACE, target: StorageTarget.MACHINE }],
    })

    expect(changes).toEqual(["alpha:local", "alpha:local", "beta:external"])
    expect(targetChanges).toEqual([StorageScope.WORKSPACE, StorageScope.WORKSPACE, StorageScope.WORKSPACE])
    expect(willSaveReasons).toEqual([WillSaveStateReason.SHUTDOWN, WillSaveStateReason.NONE])
    expect(backupReasons).toEqual(["hot-exit"])
    expect(snapshot.workspaceId).toBe("workspace-a")
    expect(migrationSources).toEqual(["profile-import"])
  })

  it("switches profile and workspace buckets without leaking values across scopes", async () => {
    const storage = new CodekStorageService({ workspaceId: "workspace-a", profileId: "profile-a" })

    storage.store("profile.key", "profile-a", StorageScope.PROFILE, StorageTarget.USER)
    storage.store("workspace.key", "workspace-a", StorageScope.WORKSPACE, StorageTarget.MACHINE)

    await storage.switchProfile("profile-b", false)
    await storage.switchWorkspace("workspace-b", false)

    expect(storage.get("profile.key", StorageScope.PROFILE)).toBeUndefined()
    expect(storage.get("workspace.key", StorageScope.WORKSPACE)).toBeUndefined()

    await storage.switchProfile("profile-a", false)
    await storage.switchWorkspace("workspace-a", false)

    expect(storage.get("profile.key", StorageScope.PROFILE)).toBe("profile-a")
    expect(storage.get("workspace.key", StorageScope.WORKSPACE)).toBe("workspace-a")
  })

  it("exposes owner evidence from the existing storage buckets without adding a second source", () => {
    const storage = new CodekStorageService({ workspaceId: "workspace-a", profileId: "profile-a" })

    storage.store("profile.key", "profile-a", StorageScope.PROFILE, StorageTarget.USER)
    storage.store("workspace.key", "workspace-a", StorageScope.WORKSPACE, StorageTarget.MACHINE)

    const evidence = storage.getOwnerEvidence()

    expect(evidence.storageServiceOwner).toBe("CodekStorageService")
    expect(evidence.profileStorageOwner).toBe("CodekStorageService.profileBucket")
    expect(evidence.scopeOwner.profile).toBe("CodekStorageService.profileBucket")
    expect(evidence.scopeOwner.workspace).toBe("CodekStorageService.workspaceBucket")
    expect(evidence.persistenceSource).toBe("CodekStorageService.inMemoryBuckets")
    expect(evidence.profileId).toBe("profile-a")
    expect(evidence.workspaceId).toBe("workspace-a")
    expect(evidence.remainingProfileUiOwnerGap.connected).toBe(false)
  })
})
