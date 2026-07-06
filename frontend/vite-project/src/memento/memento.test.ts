import { describe, expect, it } from "vitest"
import { CodekMemento } from "./memento"
import { CodekStorageService, StorageScope, StorageTarget } from "../storage/storageService"

interface TestMemento {
  counter?: number
  label?: string
}

describe("CodekMemento", () => {
  it("stores, removes, and reloads memento values through the storage service", () => {
    const storage = new CodekStorageService({ workspaceId: "workspace-a", profileId: "profile-a" })
    const memento = new CodekMemento<TestMemento>("feature.test", storage)
    const workspaceState = memento.getMemento(StorageScope.WORKSPACE, StorageTarget.USER)

    workspaceState.counter = 1
    memento.saveMemento()

    expect(storage.getObject("memento/feature.test", StorageScope.WORKSPACE)).toEqual({ counter: 1 })

    delete workspaceState.counter
    memento.saveMemento()

    expect(storage.get("memento/feature.test", StorageScope.WORKSPACE)).toBeUndefined()

    storage.store("memento/feature.test", { label: "from-storage" }, StorageScope.WORKSPACE, StorageTarget.USER)
    memento.reloadMemento(StorageScope.WORKSPACE)

    expect(workspaceState).toEqual({ label: "from-storage" })
  })

  it("keeps workspace and profile memento objects scoped to the same storage source", () => {
    const storage = new CodekStorageService({ workspaceId: "workspace-a", profileId: "profile-a" })
    const memento = new CodekMemento<TestMemento>("feature.test", storage)

    memento.getMemento(StorageScope.WORKSPACE, StorageTarget.USER).label = "workspace"
    memento.getMemento(StorageScope.PROFILE, StorageTarget.USER).label = "profile"
    memento.saveMemento()

    expect(storage.getObject("memento/feature.test", StorageScope.WORKSPACE)).toEqual({ label: "workspace" })
    expect(storage.getObject("memento/feature.test", StorageScope.PROFILE)).toEqual({ label: "profile" })
  })

  it("reports memento owner evidence through the existing storage service", () => {
    const storage = new CodekStorageService({ workspaceId: "workspace-a", profileId: "profile-a" })
    const memento = new CodekMemento<TestMemento>("feature.test", storage)

    const evidence = memento.getOwnerEvidence()

    expect(evidence.mementoOwner).toBe("CodekMemento")
    expect(evidence.storageServiceOwner).toBe("CodekStorageService")
    expect(evidence.persistenceSource).toBe("CodekStorageService.inMemoryBuckets")
    expect(evidence.remainingProfileUiOwnerGap.connected).toBe(false)
  })
})
