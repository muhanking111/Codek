import { describe, expect, it, vi } from "vitest"
import { SettingsStore, type SettingsStorage } from "../../../../../settings/settingsStore"
import { WorkbenchProfileStore } from "../../../../../settings/profileStore"
import { UserDataProfileImportExportService } from "./userDataProfileImportExportService"

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

function createProfileStoreWithProfileStorage(profileStorage: ConstructorParameters<typeof WorkbenchProfileStore>[0]["profileStorage"]): WorkbenchProfileStore {
  const storage = new MemoryStorage()
  return new WorkbenchProfileStore({
    storage,
    settingsStore: new SettingsStore({ storage, userKey: "settings:user" }),
    profilesKey: "profiles",
    activeKey: "profiles:active",
    now: () => new Date("2026-06-01T00:00:00.000Z"),
    profileStorage,
  })
}

describe("UserDataProfileImportExportService", () => {
  it("imports a local .code-profile file through the VS Code profile template contract", async () => {
    const profileStore = createProfileStore()
    const service = new UserDataProfileImportExportService({
      profileStore,
      now: () => 123,
      dialog: {
        openProfileFile: vi.fn().mockResolvedValue("D:/profiles/work.code-profile"),
        saveProfileFile: vi.fn(),
      },
      importProfileFile: vi.fn().mockResolvedValue({
        filePath: "D:/profiles/work.code-profile",
        profileTemplate: {
          name: "Work",
          settings: JSON.stringify({ settings: JSON.stringify({ "editor.fontSize": 18 }) }),
          tasks: JSON.stringify({ tasks: JSON.stringify({ version: "2.0.0" }) }),
        },
      }),
      exportProfileFile: vi.fn(),
    })

    const result = await service.importProfileFromFile()

    expect(result.status).toBe("imported")
    if (result.status !== "imported") throw new Error("expected imported profile result")
    expect(result.filePath).toBe("D:/profiles/work.code-profile")
    expect(result.profile?.id).toBe("imported-code-profile-123")
    expect(result.profile?.settings["editor.fontSize"]).toBe(18)
    expect(result.profile?.resources.tasks).toBe(JSON.stringify({ tasks: JSON.stringify({ version: "2.0.0" }) }))
    expect(profileStore.getActiveProfileId()).toBe("imported-code-profile-123")
  })

  it("exports a stored profile through one service instead of SettingsPanel orchestration", async () => {
    const profileStore = createProfileStore()
    const exportProfileFile = vi.fn().mockResolvedValue({
      filePath: "D:/profiles/Codek-Work.code-profile",
      saved: true,
      bytesWritten: 256,
    })
    const service = new UserDataProfileImportExportService({
      profileStore,
      dialog: {
        openProfileFile: vi.fn(),
        saveProfileFile: vi.fn().mockResolvedValue("D:/profiles/Codek-Work.code-profile"),
      },
      importProfileFile: vi.fn(),
      exportProfileFile,
    })
    profileStore.upsertSnapshot({
      id: "codek-work",
      name: "Codek/Work",
      settings: { "workbench.colorTheme": "Default Dark Modern" },
      resources: {
        mcp: JSON.stringify({ mcp: JSON.stringify({ servers: {} }) }),
      },
    })

    const result = await service.exportProfileToFile("codek-work")

    expect(result).toMatchObject({
      status: "exported",
      filePath: "D:/profiles/Codek-Work.code-profile",
      bytesWritten: 256,
    })
    expect(exportProfileFile).toHaveBeenCalledWith({
      filePath: "D:/profiles/Codek-Work.code-profile",
      template: expect.objectContaining({
        name: "Codek/Work",
        mcp: JSON.stringify({ mcp: JSON.stringify({ servers: {} }) }),
      }),
    })
  })

  it("exports globalState through VS Code profile scoped storage data when available", async () => {
    const profileStore = createProfileStoreWithProfileStorage({
      async read() {
        return { exists: false, profiles: [], activeProfileId: "" }
      },
      async write(snapshot) {
        return snapshot
      },
      async readStorageData(profileId) {
        expect(profileId).toBe("codek-work")
        return {
          profileId,
          entries: {
            "workbench.panel.defaultLocation": { value: "right", target: 0, scope: 0 },
          },
        }
      },
    })
    const exportProfileFile = vi.fn().mockResolvedValue({
      filePath: "D:/profiles/Codek-Work.code-profile",
      saved: true,
      bytesWritten: 512,
    })
    const service = new UserDataProfileImportExportService({
      profileStore,
      dialog: {
        openProfileFile: vi.fn(),
        saveProfileFile: vi.fn().mockResolvedValue("D:/profiles/Codek-Work.code-profile"),
      },
      importProfileFile: vi.fn(),
      exportProfileFile,
    })
    profileStore.upsertSnapshot({
      id: "codek-work",
      name: "Codek Work",
      settings: {},
      resources: {
        globalState: JSON.stringify({ storage: { stale: "value" } }),
      },
    })

    await service.exportProfileToFile("codek-work")

    expect(JSON.parse(exportProfileFile.mock.calls[0][0].template.globalState)).toEqual({
      storage: {
        "workbench.panel.defaultLocation": "right",
      },
    })
  })

  it("supports VS Code-style profile content handlers beyond the default file handler", async () => {
    const profileStore = createProfileStore()
    const service = new UserDataProfileImportExportService({
      profileStore,
      dialog: {
        openProfileFile: vi.fn(),
        saveProfileFile: vi.fn(),
      },
      importProfileFile: vi.fn(),
      exportProfileFile: vi.fn(),
    })
    const saved: string[] = []
    service.registerProfileContentHandler("memory", {
      name: "Memory",
      async readProfile(idOrUri) {
        expect(idOrUri).toBe("memory:work")
        return JSON.stringify({
          name: "Memory Work",
          settings: JSON.stringify({ settings: JSON.stringify({ "editor.fontSize": 20 }) }),
        })
      },
      async saveProfile(name, content) {
        saved.push(`${name}:${content}`)
        return { id: "memory:work", filePath: "memory:work", bytesWritten: content.length }
      },
    })

    const imported = await service.importProfile("memory:work", { handlerId: "memory", id: "memory-profile" })
    expect(imported.status).toBe("imported")
    if (imported.status !== "imported") throw new Error("expected imported profile result")
    expect(imported.profile.settings["editor.fontSize"]).toBe(20)

    const exported = await service.exportProfile("memory-profile", { handlerId: "memory" })
    expect(exported).toMatchObject({ status: "exported", filePath: "memory:work" })
    expect(saved[0]).toContain("Memory Work")
  })

  it("syncs extension-host profile content handlers into the service boundary", async () => {
    const profileStore = createProfileStore()
    const saved: Array<{ handlerId: string; name: string; content: string }> = []
    const service = new UserDataProfileImportExportService({
      profileStore,
      dialog: {
        openProfileFile: vi.fn(),
        saveProfileFile: vi.fn(),
      },
      importProfileFile: vi.fn(),
      exportProfileFile: vi.fn(),
      listExtensionProfileContentHandlers: vi.fn().mockResolvedValue([
        { id: "cloud", name: "Cloud Profiles", description: "Remote profiles", extensionId: "publisher.cloud" },
      ]),
      readExtensionProfileContent: vi.fn().mockResolvedValue(JSON.stringify({
        name: "Cloud Work",
        settings: JSON.stringify({ settings: JSON.stringify({ "workbench.colorTheme": "Cloud Dark" }) }),
      })),
      saveExtensionProfileContent: vi.fn(async (handlerId, name, content) => {
        saved.push({ handlerId, name, content })
        return { id: "cloud:work", filePath: "cloud:work", bytesWritten: content.length }
      }),
    })

    await expect(service.syncExtensionProfileContentHandlers()).resolves.toBe(1)
    const imported = await service.importProfile("cloud:work", { handlerId: "cloud", id: "cloud-work" })
    expect(imported.status).toBe("imported")
    if (imported.status !== "imported") throw new Error("expected imported profile result")
    expect(imported.profile.settings["workbench.colorTheme"]).toBe("Cloud Dark")

    const exported = await service.exportProfile("cloud-work", { handlerId: "cloud" })
    expect(exported).toMatchObject({ status: "exported", filePath: "cloud:work" })
    expect(saved[0].handlerId).toBe("cloud")
    expect(saved[0].name).toBe("Cloud Work")
    expect(saved[0].content).toContain("Cloud Work")

    await expect(service.syncExtensionProfileContentHandlers()).resolves.toBe(0)
  })

  it("returns cancelled when file dialogs are dismissed", async () => {
    const service = new UserDataProfileImportExportService({
      profileStore: createProfileStore(),
      dialog: {
        openProfileFile: vi.fn().mockResolvedValue(null),
        saveProfileFile: vi.fn().mockResolvedValue(null),
      },
      importProfileFile: vi.fn(),
      exportProfileFile: vi.fn(),
    })

    await expect(service.importProfileFromFile()).resolves.toEqual({ status: "cancelled" })

    const profile = service.profileStore.upsertSnapshot({
      id: "profile",
      name: "Profile",
      settings: {},
    })
    await expect(service.exportProfileToFile(profile.id)).resolves.toEqual({ status: "cancelled" })
  })
})
