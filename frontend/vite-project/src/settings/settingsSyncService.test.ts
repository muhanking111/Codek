import { describe, expect, it, vi } from "vitest"
import { SettingsStore, type SettingsStorage } from "./settingsStore"
import { WorkbenchProfileStore, type UserDataProfileTemplate } from "./profileStore"
import {
  CodekStorageScope,
  CodekStorageTarget,
  SettingsSyncService,
  type SettingsSyncPreviewInput,
  exportSettingsSyncThroughLegacyEntry,
  importSettingsSyncThroughLegacyEntry,
  runSettingsSyncDryRunThroughLegacyEntry,
} from "./settingsSyncService"

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

function createProfileStore(): WorkbenchProfileStore {
  const storage = new MemoryStorage()
  return new WorkbenchProfileStore({
    storage,
    settingsStore: new SettingsStore({ storage, userKey: "settings:user" }),
    profilesKey: "profiles",
    activeKey: "profiles:active",
    now: () => new Date("2026-06-01T00:00:00.000Z"),
  })
}

function createTemplate(settings: Record<string, unknown> = { "editor.fontSize": 18 }): UserDataProfileTemplate {
  return {
    name: "Imported Sync Profile",
    settings: JSON.stringify({ settings: JSON.stringify(settings) }),
    keybindings: JSON.stringify({
      keybindings: JSON.stringify([{ key: "ctrl+k", command: "workbench.action.quickOpen" }]),
      platform: "win32",
    }),
    globalState: JSON.stringify({
      storage: {
        "workbench.panel.defaultLocation": {
          value: "bottom",
          target: CodekStorageTarget.USER,
          scope: CodekStorageScope.PROFILE,
        },
      },
    }),
  }
}

function createSettingsSyncPreviewInput(
  overrides: Partial<SettingsSyncPreviewInput> = {},
): SettingsSyncPreviewInput {
  return {
    localContent: JSON.stringify({
      "editor.fontSize": 16,
      "workbench.colorTheme": "Codek Dark",
    }),
    remoteContent: JSON.stringify({
      "editor.fontSize": 16,
      "workbench.colorTheme": "Codek Dark",
    }),
    baseContent: JSON.stringify({
      "editor.fontSize": 14,
      "workbench.colorTheme": "Codek Light",
    }),
    ...overrides,
  }
}

describe("SettingsSyncService", () => {
  it("dry-runs a local profile import without mutating profiles", async () => {
    const profileStore = createProfileStore()
    profileStore.upsertSnapshot({
      id: "current-profile",
      name: "Current Profile",
      settings: { "editor.fontSize": 14 },
      keybindings: [],
    })
    const service = new SettingsSyncService({ profileStore, now: () => new Date("2026-06-02T00:00:00.000Z") })

    const result = await service.dryRunImport({
      id: "current-profile",
      template: createTemplate(),
      activate: true,
    })

    expect(result.status).toBe("dryRun")
    expect(result.profileId).toBe("current-profile")
    expect(result.evidence.localOnly).toBe(true)
    expect(result.evidence.externalSync).toBe(false)
    expect(result.evidence.changedResources).toEqual(["settings", "keybindings", "globalState"])
    expect(result.rollback.profileBefore?.settings).toEqual({ "editor.fontSize": 14 })
    expect(profileStore.getProfile("current-profile")?.settings).toEqual({ "editor.fontSize": 14 })
  })

  it("imports a local settings sync payload with rollback evidence", async () => {
    const profileStore = createProfileStore()
    profileStore.upsertSnapshot({
      id: "current-profile",
      name: "Current Profile",
      settings: { "editor.fontSize": 14 },
      keybindings: [],
    })
    const service = new SettingsSyncService({ profileStore, now: () => new Date("2026-06-02T00:00:00.000Z") })

    const result = await service.importProfile({
      id: "current-profile",
      template: createTemplate({ "editor.fontSize": 20, "workbench.colorTheme": "Default Dark Modern" }),
      activate: true,
    })

    expect(result.status).toBe("imported")
    expect(result.profile.id).toBe("current-profile")
    expect(result.profile.settings).toEqual({
      "editor.fontSize": 20,
      "workbench.colorTheme": "Default Dark Modern",
    })
    expect(result.evidence.reversible).toBe(true)
    expect(result.rollback.profileBefore?.settings).toEqual({ "editor.fontSize": 14 })
    expect(result.evidence.changedResources).toContain("settings")
  })

  it("exports the active profile as a VS Code-style local sync payload", async () => {
    const profileStore = createProfileStore()
    profileStore.upsertSnapshot({
      id: "export-profile",
      name: "Export Profile",
      settings: { "editor.fontSize": 16 },
      keybindings: [{ key: "ctrl+k", command: "workbench.action.quickOpen" }],
      resources: {
        globalState: JSON.stringify({ storage: { "workbench.panel.defaultLocation": "right" } }),
      },
    })
    const service = new SettingsSyncService({ profileStore, now: () => new Date("2026-06-02T00:00:00.000Z") })

    const result = await service.exportProfile("export-profile")

    expect(result.status).toBe("exported")
    expect(result.payload).toMatchObject({
      version: 1,
      source: "codek-local",
      activeProfileId: "export-profile",
    })
    expect(result.payload.resources).toEqual(["settings", "keybindings", "globalState"])
    expect(JSON.parse(JSON.parse(result.payload.template.settings || "{}").settings)).toEqual({ "editor.fontSize": 16 })
    expect(result.evidence.changedResources).toEqual(["settings", "keybindings", "globalState"])
  })

  it("proxies old settings sync entries into the unified service", async () => {
    const service = {
      dryRunImport: vi.fn().mockResolvedValue({ status: "dryRun" }),
      importProfile: vi.fn().mockResolvedValue({ status: "imported" }),
      exportProfile: vi.fn().mockResolvedValue({ status: "exported" }),
    } as unknown as SettingsSyncService
    const input = { id: "legacy-profile", template: createTemplate(), activate: false }

    await expect(runSettingsSyncDryRunThroughLegacyEntry(input, service)).resolves.toEqual({ status: "dryRun" })
    await expect(importSettingsSyncThroughLegacyEntry(input, service)).resolves.toEqual({ status: "imported" })
    await expect(exportSettingsSyncThroughLegacyEntry("legacy-profile", service)).resolves.toEqual({ status: "exported" })

    expect(service.dryRunImport).toHaveBeenCalledWith(input)
    expect(service.importProfile).toHaveBeenCalledWith(input)
    expect(service.exportProfile).toHaveBeenCalledWith("legacy-profile")
  })

  it("projects a deterministic VS Code-style settings merge preview without mutating profiles", async () => {
    const profileStore = createProfileStore()
    profileStore.upsertSnapshot({
      id: "current-profile",
      name: "Current Profile",
      settings: { "editor.fontSize": 14 },
      keybindings: [],
    })
    const service = new SettingsSyncService({ profileStore, now: () => new Date("2026-06-02T00:00:00.000Z") })

    const preview = service.previewSettingsMerge(createSettingsSyncPreviewInput({
      localContent: JSON.stringify({
        "editor.fontSize": 16,
        "workbench.colorTheme": "Codek Light",
      }),
      remoteContent: JSON.stringify({
        "editor.fontSize": 14,
        "workbench.colorTheme": "Codek Dark",
      }),
    }))

    expect(preview.status).toBe("preview")
    expect(preview.sourceParity).toEqual({
      settingsMerge: "src/vs/platform/userDataSync/common/settingsMerge.ts",
      settingsSync: "src/vs/platform/userDataSync/common/settingsSync.ts",
      settingsResource: "src/vs/workbench/services/userDataProfile/browser/settingsResource.ts",
    })
    expect(preview.resources.map((resource) => resource.authority)).toEqual(["base", "local", "remote", "accepted"])
    expect(preview.preview.hasConflicts).toBe(false)
    expect(preview.preview.conflictsSettings).toEqual([])
    expect(preview.preview.localChange).toBe("modified")
    expect(preview.preview.remoteChange).toBe("modified")
    expect(JSON.parse(preview.preview.content || "{}")).toEqual({
      "editor.fontSize": 16,
      "workbench.colorTheme": "Codek Dark",
    })
    expect(JSON.parse(preview.acceptedContent || "{}")).toEqual({
      "editor.fontSize": 16,
      "workbench.colorTheme": "Codek Dark",
    })
    expect(profileStore.getProfile("current-profile")?.settings).toEqual({ "editor.fontSize": 14 })
  })

  it("keeps conflicting settings in base preview and exposes accepted local/remote/preview decisions", async () => {
    const service = new SettingsSyncService({ profileStore: createProfileStore(), now: () => new Date("2026-06-02T00:00:00.000Z") })
    const input = createSettingsSyncPreviewInput({
      localContent: JSON.stringify({ "editor.fontSize": 16 }),
      remoteContent: JSON.stringify({ "editor.fontSize": 20 }),
      baseContent: JSON.stringify({ "editor.fontSize": 14 }),
    })

    const preview = service.previewSettingsMerge(input)

    expect(preview.preview.hasConflicts).toBe(true)
    expect(preview.preview.content).toBe(input.baseContent)
    expect(preview.preview.conflictsSettings).toEqual([{
      key: "editor.fontSize",
      localValue: 16,
      remoteValue: 20,
    }])
    expect(service.acceptSettingsMergePreview(preview, "local").content).toBe(input.localContent)
    expect(service.acceptSettingsMergePreview(preview, "remote").content).toBe(input.remoteContent)
    expect(JSON.parse(service.acceptSettingsMergePreview(preview, "preview", JSON.stringify({ "editor.fontSize": 18 })).content || "{}")).toEqual({
      "editor.fontSize": 18,
    })
  })
})
