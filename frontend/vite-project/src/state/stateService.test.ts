import { describe, expect, it } from "vitest"
import { CodekStorageService, StorageScope } from "../storage/storageService"
import { CodekStateService } from "./stateService"

describe("CodekStateService", () => {
  it("reads and writes state items through the shared storage service", () => {
    const storage = new CodekStorageService({ workspaceId: "workspace-a", profileId: "profile-a" })
    const state = new CodekStateService(storage)
    const changes: string[] = []

    state.onDidChangeItem((event) => changes.push(`${event.scope}:${event.key}`))
    state.setItem("window.restoreCount", 2, StorageScope.APPLICATION)
    state.setItems([
      { key: "workspace.view", data: { active: "explorer" }, scope: StorageScope.WORKSPACE },
      { key: "profile.locale", data: "zh-CN", scope: StorageScope.PROFILE },
    ])
    state.removeItem("profile.locale", StorageScope.PROFILE)

    expect(state.getItem("window.restoreCount", 0, StorageScope.APPLICATION)).toBe(2)
    expect(state.getItem("workspace.view", {}, StorageScope.WORKSPACE)).toEqual({ active: "explorer" })
    expect(state.getItem("profile.locale", "missing", StorageScope.PROFILE)).toBe("missing")
    expect(changes).toEqual([
      `${StorageScope.APPLICATION}:window.restoreCount`,
      `${StorageScope.WORKSPACE}:workspace.view`,
      `${StorageScope.PROFILE}:profile.locale`,
      `${StorageScope.PROFILE}:profile.locale`,
    ])
  })

  it("records evidence-safe state actions without storing raw values", () => {
    const storage = new CodekStorageService({ workspaceId: "workspace-a", profileId: "profile-a" })
    const state = new CodekStateService(storage, { now: () => 42 })

    const action = state.recordStateAction({
      action: "state.update",
      actorId: "agent-1",
      key: "secret.token",
      scope: StorageScope.PROFILE,
      value: { token: "do-not-store" },
      mutatesWorkspace: false,
      requiresApproval: true,
    })

    expect(action).toEqual({
      action: "state.update",
      actorId: "agent-1",
      key: "secret.token",
      mutatesWorkspace: false,
      readonlyEvidence: false,
      requiresApproval: true,
      scope: StorageScope.PROFILE,
      timestamp: 42,
      valueShape: "object:token",
    })
    expect(JSON.stringify(state.getEvidenceActions())).not.toContain("do-not-store")
  })

  it("delegates flush and backup boundaries to storage", async () => {
    const storage = new CodekStorageService({ workspaceId: "workspace-a", profileId: "profile-a" })
    const state = new CodekStateService(storage)

    state.setItem("workspace.view", "explorer", StorageScope.WORKSPACE)
    await state.flush()
    const backup = await state.backup("manual")

    expect(backup.scopes.workspace.entries).toEqual([{ key: "state/workspace.view", target: 1, value: "explorer" }])
  })
})
