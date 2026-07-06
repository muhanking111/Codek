import { beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsStore, type SettingsStorage } from "../settings/settingsStore"
import { createExperimentsService, type ExperimentDefinition } from "./experimentsService"

class MemoryStorage implements SettingsStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function createSettingsStore(): SettingsStore {
  return new SettingsStore({
    storage: new MemoryStorage(),
    userKey: "experiments-user",
    workspaceKeyPrefix: "experiments-workspace:",
    unknownKey: "experiments-unknown",
  })
}

const definitions: ExperimentDefinition[] = [
  {
    id: "workspaceRecommendations.richEvidence",
    featureFlag: "recommendations.richEvidence",
    rollout: 1,
    defaultEnabled: false,
    description: "推荐证据描述增强",
  },
  {
    id: "remoteDisabled",
    featureFlag: "remote.disabled",
    rollout: 0,
    defaultEnabled: false,
    description: "默认关闭的远端实验",
  },
]

describe("experimentsService", () => {
  let settingsStore: SettingsStore

  beforeEach(() => {
    vi.setSystemTime(20_000)
    settingsStore = createSettingsStore()
  })

  it("builds a stable local assignment and feature flag read model", () => {
    const service = createExperimentsService({
      settingsStore,
      definitions,
      stableId: "workspace-D:/Workspace",
      now: () => 20_000,
    })

    const first = service.refresh()
    const second = service.refresh()

    expect(first.assignments).toEqual(second.assignments)
    expect(first.flags["recommendations.richEvidence"]).toBe(true)
    expect(first.flags["remote.disabled"]).toBe(false)
    expect(first.assignments["workspaceRecommendations.richEvidence"]).toEqual(expect.objectContaining({
      source: "localStableHash",
      transport: "localOnly",
      enabled: true,
      featureFlag: "recommendations.richEvidence",
    }))
    expect(service.isFeatureEnabled("recommendations.richEvidence")).toBe(true)
  })

  it("keeps experiments closed by opt out and records local evidence only", () => {
    settingsStore.set("codek.experiments.enabled", false)
    const service = createExperimentsService({
      settingsStore,
      definitions,
      stableId: "workspace-D:/Workspace",
      now: () => 21_000,
    })

    const snapshot = service.refresh()

    expect(snapshot.enabled).toBe(false)
    expect(snapshot.flags).toEqual({
      "recommendations.richEvidence": false,
      "remote.disabled": false,
    })
    expect(snapshot.localEvidence).toEqual([
      expect.objectContaining({
        kind: "policy",
        detail: "实验服务已由本地设置关闭。",
      }),
    ])
    expect(snapshot.privacy).toEqual(expect.objectContaining({
      assignmentStore: "localSettingsOnly",
      remoteFetch: false,
      telemetry: false,
    }))
  })

  it("allows explicit local feature flag overrides without remote assignment", () => {
    settingsStore.set("codek.experiments.overrides", {
      "recommendations.richEvidence": false,
      "remote.disabled": true,
    })
    const service = createExperimentsService({
      settingsStore,
      definitions,
      stableId: "workspace-D:/Workspace",
      now: () => 22_000,
    })

    const snapshot = service.refresh()

    expect(snapshot.flags).toEqual({
      "recommendations.richEvidence": false,
      "remote.disabled": true,
    })
    expect(snapshot.assignments["workspaceRecommendations.richEvidence"]).toEqual(expect.objectContaining({
      source: "localOverride",
      enabled: false,
    }))
    expect(snapshot.assignments.remoteDisabled).toEqual(expect.objectContaining({
      source: "localOverride",
      enabled: true,
    }))
  })
})
