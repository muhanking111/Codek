import { describe, expect, it } from "vitest"
import { WorkbenchProfileStore } from "./profileStore"
import { ConfigurationService, SettingsStore, type SettingsStorage } from "./settingsStore"
import { CodekWorkbenchThemeService } from "../vscode-adapter/platform/theme/common/themeService"

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

function createStores(now = new Date("2026-06-01T00:00:00.000Z")) {
  const storage = new MemoryStorage()
  const settings = new SettingsStore({
    storage,
    userKey: "settings:user",
    workspaceKeyPrefix: "settings:workspace:",
    unknownKey: "settings:unknown",
  })
  const profiles = new WorkbenchProfileStore({
    storage,
    settingsStore: settings,
    profilesKey: "profiles",
    activeKey: "profiles:active",
    now: () => now,
  })
  return { storage, settings, profiles }
}

describe("WorkbenchProfileStore", () => {
  it("saves the current user settings as an active profile without secrets", () => {
    const { settings, profiles } = createStores()
    const profileEvents: string[] = []
    const currentEvents: Array<{ previous: string; profile: string }> = []
    profiles.onDidChangeProfiles((event) => {
      profileEvents.push(`added:${event.added.map((profile) => profile.name).join(",")}`)
      expect(event.removed).toEqual([])
      expect(event.updated).toEqual([])
      expect(event.all).toHaveLength(1)
    })
    profiles.onDidChangeCurrentProfile((event) => {
      currentEvents.push({ previous: event.previous.id, profile: event.profile.name })
      event.join(Promise.resolve())
    })
    settings.update({
      "editor.fontSize": 18,
      "workbench.colorTheme": "dark",
      "codek.ai.apiKey": "secret",
    })

    const profile = profiles.saveCurrent("Cursor 工作区", {
      source: "cursor",
      keybindings: [{ key: "ctrl+shift+p", command: "workbench.action.showCommands" }],
    })

    expect(profile.name).toBe("Cursor 工作区")
    expect(profile.source).toBe("cursor")
    expect(profile.settings["editor.fontSize"]).toBe(18)
    expect(profile.settings["codek.ai.apiKey"]).toBeUndefined()
    expect(profile.keybindings).toHaveLength(1)
    expect(profile.userDataProfile.settingsResource.path).toBe(`/profiles/${profile.id}/settings.json`)
    expect(profile.userDataProfile.keybindingsResource.path).toBe(`/profiles/${profile.id}/keybindings.json`)
    expect(profiles.currentProfile.name).toBe("Cursor 工作区")
    expect(profiles.profiles.map((entry) => entry.name)).toEqual(["Cursor 工作区"])
    expect(profileEvents).toEqual(["added:Cursor 工作区"])
    expect(currentEvents).toEqual([{ previous: "__default__profile__", profile: "Cursor 工作区" }])
    expect(profiles.list()[0]).toMatchObject({
      active: true,
      settingsCount: 2,
      keybindingsCount: 1,
      colorTheme: "dark",
    })
  })

  it("switches profiles by replacing user settings and notifying theme subscribers", () => {
    const { settings, profiles } = createStores()
    const seen: unknown[] = []
    settings.subscribe((snapshot) => seen.push(snapshot["workbench.colorTheme"]))

    profiles.upsertSnapshot({
      id: "light-profile",
      name: "Light",
      settings: { "editor.fontSize": 14, "workbench.colorTheme": "light" },
      activate: false,
    })
    settings.set("editor.fontSize", 20)
    settings.set("files.autoSave", "afterDelay")

    profiles.switchTo("light-profile")

    expect(settings.getUserSettings()).toEqual({
      "editor.fontSize": 14,
      "workbench.colorTheme": "light",
    })
    expect(profiles.getProfile("light-profile")?.userDataProfile.settingsResource.path).toBe(
      "/profiles/light-profile/settings.json",
    )
    expect(settings.get("files.autoSave")).toBe("off")
    expect(seen.at(-1)).toBe("light")
    expect(profiles.getActiveProfileId()).toBe("light-profile")
  })

  it("keeps profile-scoped user settings isolated from workspace settings when switching profiles", () => {
    const { settings, profiles } = createStores()
    const configurationEvents: Array<{ profileId: string; fontSize: unknown }> = []
    settings.loadWorkspace("D:/Workspace")
    settings.set("files.autoSave", "afterDelay", "workspace")
    settings.onDidChangeConfiguration(() => {
      configurationEvents.push({
        profileId: settings.getActiveProfileId(),
        fontSize: settings.getUserSettings()["editor.fontSize"],
      })
    })

    profiles.upsertSnapshot({
      id: "profile-a",
      name: "Profile A",
      settings: { "editor.fontSize": 14, "workbench.colorTheme": "light" },
      activate: false,
    })
    profiles.upsertSnapshot({
      id: "profile-b",
      name: "Profile B",
      settings: { "editor.fontSize": 20, "workbench.colorTheme": "dark" },
      activate: false,
    })

    profiles.switchTo("profile-a")
    expect(settings.getActiveProfileId()).toBe("profile-a")
    expect(settings.getUserSettings()).toEqual({
      "editor.fontSize": 14,
      "workbench.colorTheme": "light",
    })
    expect(settings.getWorkspaceSettings()).toEqual({ "files.autoSave": "afterDelay" })

    profiles.switchTo("profile-b")
    expect(settings.getActiveProfileId()).toBe("profile-b")
    expect(settings.getUserSettings()).toEqual({
      "editor.fontSize": 20,
      "workbench.colorTheme": "dark",
    })
    expect(settings.getWorkspaceSettings()).toEqual({ "files.autoSave": "afterDelay" })
    expect(configurationEvents.at(-2)).toEqual({ profileId: "profile-a", fontSize: 14 })
    expect(configurationEvents.at(-1)).toEqual({ profileId: "profile-b", fontSize: 20 })
  })

  it("projects profile-scoped color and icon theme changes through the VS Code-style theme service", () => {
    const { settings, profiles } = createStores()
    const themeService = new CodekWorkbenchThemeService(new ConfigurationService(settings))
    const colorEvents: string[] = []
    const iconEvents: string[] = []
    themeService.onDidColorThemeChange((theme) => colorEvents.push(theme.settingsId))
    themeService.onDidFileIconThemeChange((theme) => iconEvents.push(theme.settingsId))

    profiles.upsertSnapshot({
      id: "profile-a",
      name: "Profile A",
      settings: { "workbench.colorTheme": "Default Light Modern", "workbench.iconTheme": "minimal" },
      activate: false,
    })
    profiles.upsertSnapshot({
      id: "profile-b",
      name: "Profile B",
      settings: { "workbench.colorTheme": "Default Dark Modern", "workbench.iconTheme": "vs-seti" },
      activate: false,
    })

    profiles.switchTo("profile-a")
    expect(themeService.getColorTheme().settingsId).toBe("light")
    expect(themeService.getFileIconTheme().settingsId).toBe("minimal")

    profiles.switchTo("profile-b")
    expect(settings.getUserSettings()).toEqual({
      "workbench.colorTheme": "Default Dark Modern",
      "workbench.iconTheme": "vs-seti",
    })
    expect(themeService.getColorTheme().settingsId).toBe("dark")
    expect(themeService.getFileIconTheme().settingsId).toBe("vs-seti")
    expect(colorEvents).toEqual(["light", "dark"])
    expect(iconEvents).toEqual(["minimal", "vs-seti"])
  })

  it("emits VS Code-style profile update and current-profile events when updating the active profile", () => {
    const { profiles } = createStores()
    const profileEvents: Array<{ added: string[]; removed: string[]; updated: string[]; all: string[] }> = []
    const currentEvents: Array<{ previous: string; profile: string }> = []
    profiles.onDidChangeProfiles((event) => {
      profileEvents.push({
        added: event.added.map((profile) => profile.name),
        removed: event.removed.map((profile) => profile.name),
        updated: event.updated.map((profile) => profile.name),
        all: event.all.map((profile) => profile.name),
      })
    })
    profiles.onDidChangeCurrentProfile((event) => {
      currentEvents.push({ previous: event.previous.name, profile: event.profile.name })
    })

    profiles.upsertSnapshot({
      id: "active",
      name: "Active",
      settings: { "editor.fontSize": 14 },
    })
    profiles.upsertSnapshot({
      id: "active",
      name: "Active Renamed",
      settings: { "editor.fontSize": 16 },
    })

    expect(profileEvents).toEqual([
      { added: ["Active"], removed: [], updated: [], all: ["Active"] },
      { added: [], removed: [], updated: ["Active Renamed"], all: ["Active Renamed"] },
    ])
    expect(currentEvents).toEqual([
      { previous: "Default", profile: "Active" },
      { previous: "Active", profile: "Active Renamed" },
    ])
    expect(profiles.currentProfile.name).toBe("Active Renamed")
  })

  it("imports VS Code profile templates through the profile store instead of SettingsPanel file rereads", () => {
    const { settings, profiles } = createStores()
    const profileEvents: Array<{ added: string[]; all: string[] }> = []
    profiles.onDidChangeProfiles((event) => {
      profileEvents.push({
        added: event.added.map((profile) => profile.name),
        all: event.all.map((profile) => profile.name),
      })
    })

    const profile = profiles.importFromVsCodeTemplate({
      template: {
        name: "Cursor Work",
        settings: JSON.stringify({
          settings: JSON.stringify({
            "editor.fontSize": 18,
            "codek.ai.apiKey": "secret",
          }),
        }),
        keybindings: JSON.stringify({
          keybindings: JSON.stringify([
            { key: "ctrl+shift+p", command: "workbench.action.showCommands" },
          ]),
          platform: "win32",
        }),
      },
      snapshot: {
        id: "imported-cursor-work",
        name: "Cursor Work（Cursor）",
        source: "cursor",
        settings: { "editor.fontSize": 20, "workbench.colorTheme": "Cursor Dark" },
        keybindings: [{ key: "ctrl+k", command: "workbench.action.quickOpen" }],
        activate: true,
      },
    })

    expect(profile.id).toBe("imported-cursor-work")
    expect(profile.source).toBe("cursor")
    expect(profile.name).toBe("Cursor Work（Cursor）")
    expect(profile.settings).toEqual({
      "editor.fontSize": 20,
      "workbench.colorTheme": "Cursor Dark",
    })
    expect(profile.keybindings).toEqual([{ key: "ctrl+k", command: "workbench.action.quickOpen" }])
    expect(settings.getUserSettings()).toEqual(profile.settings)
    expect(profileEvents.at(-1)).toEqual({ added: ["Cursor Work（Cursor）"], all: ["Cursor Work（Cursor）"] })
  })

  it("falls back to VS Code template resource content when no snapshot is supplied", () => {
    const { settings, profiles } = createStores()

    const profile = profiles.importFromVsCodeTemplate({
      template: {
        name: "VS Code Default",
        settings: JSON.stringify({
          settings: JSON.stringify({ "editor.fontSize": 16 }),
        }),
        keybindings: JSON.stringify({
          keybindings: JSON.stringify([
            { key: "ctrl+k ctrl+s", command: "workbench.action.openGlobalKeybindings" },
          ]),
        }),
      },
      source: "vscode",
      id: "imported-vscode-default",
    })

    expect(profile.settings["editor.fontSize"]).toBe(16)
    expect(profile.keybindings[0].command).toBe("workbench.action.openGlobalKeybindings")
    expect(settings.getUserSettings()).toEqual({ "editor.fontSize": 16 })
  })

  it("exports a stored profile as a VS Code .code-profile template", () => {
    const { profiles } = createStores()
    profiles.upsertSnapshot({
      id: "export-me",
      name: "Export Me",
      source: "manual",
      settings: { "editor.fontSize": 15, "workbench.colorTheme": "Default Dark Modern" },
      keybindings: [{ key: "ctrl+k ctrl+s", command: "workbench.action.openGlobalKeybindings" }],
    })

    const template = profiles.exportToVsCodeTemplate("export-me")

    expect(template.name).toBe("Export Me")
    expect(JSON.parse(JSON.parse(template.settings || "{}").settings)).toEqual({
      "editor.fontSize": 15,
      "workbench.colorTheme": "Default Dark Modern",
    })
    const keybindingsResource = JSON.parse(template.keybindings || "{}")
    expect(JSON.parse(keybindingsResource.keybindings)).toEqual([
      { key: "ctrl+k ctrl+s", command: "workbench.action.openGlobalKeybindings" },
    ])
    expect(typeof keybindingsResource.platform).toBe("string")
  })

  it("preserves VS Code profile-scoped resources when importing and exporting templates", () => {
    const { profiles } = createStores()
    const tasks = JSON.stringify({ tasks: JSON.stringify({ version: "2.0.0", tasks: [{ label: "build" }] }) })
    const snippets = JSON.stringify({ snippets: { "typescript.json": JSON.stringify({ Log: { prefix: "log" } }) } })
    const globalState = JSON.stringify({ storage: { "workbench.panel.defaultLocation": "bottom" } })
    const extensions = JSON.stringify([{ identifier: { id: "ms-python.python" }, disabled: true }])
    const mcp = JSON.stringify({ mcp: JSON.stringify({ servers: { local: { command: "node" } } }) })

    const imported = profiles.importFromVsCodeTemplate({
      template: {
        name: "Full Profile",
        settings: JSON.stringify({ settings: JSON.stringify({ "editor.fontSize": 16 }) }),
        keybindings: JSON.stringify({ keybindings: JSON.stringify([]), platform: "win32" }),
        tasks,
        snippets,
        globalState,
        extensions,
        mcp,
      },
      id: "full-profile",
      source: "vscode",
    })

    expect(imported.resources).toEqual({ tasks, snippets, globalState, extensions, mcp })

    const exported = profiles.exportToVsCodeTemplate("full-profile")
    expect(exported.tasks).toBe(tasks)
    expect(exported.snippets).toBe(snippets)
    expect(exported.globalState).toBe(globalState)
    expect(exported.extensions).toBe(extensions)
    expect(exported.mcp).toBe(mcp)
  })

  it("projects profile selection, switching, and profile-scoped resources for UI without a second state source", () => {
    const { profiles } = createStores()
    const tasks = JSON.stringify({
      tasks: JSON.stringify({
        version: "2.0.0",
        tasks: [
          { label: "build" },
          { label: "lint" },
        ],
      }),
    })
    const extensions = JSON.stringify([
      { identifier: { id: "ms-python.python" }, disabled: true },
      { identifier: { id: "dbaeumer.vscode-eslint" } },
    ])

    profiles.upsertSnapshot({
      id: "profile-a",
      name: "Profile A",
      settings: {
        "editor.fontSize": 16,
        "workbench.colorTheme": "Default Light Modern",
        "codek.ai.token": "secret-token",
      },
      resources: { tasks, extensions },
      activate: false,
    })
    profiles.upsertSnapshot({
      id: "profile-b",
      name: "Profile B",
      settings: { "workbench.colorTheme": "Default Dark Modern" },
      activate: false,
    })

    profiles.switchTo("profile-a")

    const projection = profiles.getSelectionProjection()
    expect(projection.stateSource).toBe("workbenchProfileStore.profileEntries+userDataProfileService.currentProfile")
    expect(projection.activeProfileId).toBe("profile-a")
    expect(projection.constraints).toMatchObject({
      noSecondProfileStore: true,
      profileScopedResourcesDerivedFromProfileEntries: true,
      evidenceSafeActions: true,
    })
    expect(projection.profiles.find((profile) => profile.id === "profile-a")).toMatchObject({
      id: "profile-a",
      active: true,
      canSwitch: false,
      settings: {
        count: 2,
        colorTheme: "Default Light Modern",
        sensitiveKeysRedacted: true,
      },
      resources: {
        tasks: { count: 2, labels: ["build", "lint"], hasContent: true },
        extensions: { count: 2, disabledCount: 1, ids: ["ms-python.python", "dbaeumer.vscode-eslint"], hasContent: true },
      },
      action: {
        commandId: "workbench.profiles.switchProfile",
        args: ["profile-a"],
      },
    })
    expect(projection.profiles.find((profile) => profile.id === "profile-b")).toMatchObject({
      active: false,
      canSwitch: true,
      resources: {
        tasks: { count: 0, labels: [], hasContent: false },
        extensions: { count: 0, disabledCount: 0, ids: [], hasContent: false },
      },
    })
    expect(projection.actionEvidence.map((item) => item.action)).toEqual(
      expect.arrayContaining(["upsert", "switch"]),
    )
    expect(JSON.stringify(projection)).not.toContain("secret-token")
  })

  it("applies imported VS Code globalState through profile scoped storage", async () => {
    const { storage, settings } = createStores()
    const updates: any[] = []
    const profiles = new WorkbenchProfileStore({
      storage,
      settingsStore: settings,
      profilesKey: "profiles",
      activeKey: "profiles:active",
      profileStorage: {
        async read() {
          return { exists: false, profiles: [], activeProfileId: "" }
        },
        async write(snapshot) {
          return snapshot
        },
        async updateStorageData(profileId, update) {
          updates.push({ profileId, update })
          return { profileId, entries: {} }
        },
      },
    })
    const globalState = JSON.stringify({
      storage: {
        "workbench.panel.defaultLocation": "bottom",
        "machine.scope": { value: "local", target: 1, scope: 0 },
      },
    })

    profiles.importFromVsCodeTemplate({
      template: {
        name: "Global State",
        globalState,
      },
      id: "global-state-profile",
      source: "vscode",
    })
    await profiles.flushProfileStorage()

    expect(updates).toEqual([
      {
        profileId: "global-state-profile",
        update: {
          target: 0,
          scope: 0,
          data: {
            "workbench.panel.defaultLocation": "bottom",
            "machine.scope": { value: "local", target: 1, scope: 0 },
          },
        },
      },
    ])
  })

  it("exports VS Code globalState from profile scoped storage when available", async () => {
    const { storage, settings } = createStores()
    const profiles = new WorkbenchProfileStore({
      storage,
      settingsStore: settings,
      profilesKey: "profiles",
      activeKey: "profiles:active",
      profileStorage: {
        async read() {
          return { exists: false, profiles: [], activeProfileId: "" }
        },
        async write(snapshot) {
          return snapshot
        },
        async readStorageData(profileId) {
          expect(profileId).toBe("export-storage")
          return {
            profileId,
            entries: {
              "workbench.panel.defaultLocation": { value: "right", target: 0, scope: 0 },
              "machine.only": { value: "local", target: 1, scope: 0 },
            },
          }
        },
      },
    })
    profiles.upsertSnapshot({
      id: "export-storage",
      name: "Export Storage",
      settings: {},
      resources: {
        globalState: JSON.stringify({ storage: { stale: "value" } }),
      },
    })

    const exported = await profiles.exportToVsCodeTemplateAsync("export-storage")

    expect(JSON.parse(exported.globalState || "{}")).toEqual({
      storage: {
        "workbench.panel.defaultLocation": "right",
      },
    })
  })

  it("revives stored profile-scoped resources from persisted profile data", () => {
    const { storage, profiles } = createStores()
    const snippets = JSON.stringify({ snippets: { "javascript.json": "{}" } })
    profiles.upsertSnapshot({
      id: "persisted",
      name: "Persisted",
      settings: {},
      resources: { snippets },
    })

    const revived = new WorkbenchProfileStore({
      storage,
      settingsStore: new SettingsStore({ storage, userKey: "settings:user:2" }),
      profilesKey: "profiles",
      activeKey: "profiles:active",
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    })

    expect(revived.getProfile("persisted")?.resources).toEqual({ snippets })
    expect(revived.exportToVsCodeTemplate("persisted").snippets).toBe(snippets)
  })

  it("hydrates profiles from desktop profile storage over localStorage fallback", async () => {
    const { storage, settings } = createStores()
    const writes: unknown[] = []
    storage.setItem("profiles", JSON.stringify({
      profiles: [
        {
          id: "local-profile",
          name: "Local Profile",
          source: "manual",
          settings: { "editor.fontSize": 11 },
          keybindings: [],
          resources: {},
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
    }))
    storage.setItem("profiles:active", "local-profile")
    const profiles = new WorkbenchProfileStore({
      storage,
      settingsStore: settings,
      profilesKey: "profiles",
      activeKey: "profiles:active",
      profileStorage: {
        async read() {
          return {
            exists: true,
            activeProfileId: "desktop-profile",
            profiles: [
              {
                id: "desktop-profile",
                name: "Desktop Profile",
                source: "vscode",
                settings: { "editor.fontSize": 22 },
                keybindings: [],
                resources: {},
                createdAt: "2026-06-01T00:00:00.000Z",
                updatedAt: "2026-06-01T00:00:00.000Z",
              },
            ],
          }
        },
        async write(snapshot) {
          writes.push(snapshot)
          return snapshot
        },
      },
    })
    const events: string[] = []
    profiles.onDidChangeProfiles((event) => {
      events.push(`added:${event.added.map((profile) => profile.name).join(",")};removed:${event.removed.map((profile) => profile.name).join(",")}`)
    })

    const changed = await profiles.hydrateFromProfileStorage()

    expect(changed).toBe(true)
    expect(profiles.list()).toHaveLength(1)
    expect(profiles.list()[0]).toMatchObject({ id: "desktop-profile", active: true, source: "vscode" })
    expect(events).toEqual(["added:Desktop Profile;removed:Local Profile"])
    expect(JSON.parse(storage.getItem("profiles") || "{}").profiles[0].id).toBe("desktop-profile")
    expect(storage.getItem("profiles:active")).toBe("desktop-profile")
    expect(writes).toEqual([])
  })

  it("force-refreshes desktop profile storage after an external profile change event", async () => {
    const { storage, settings } = createStores()
    let readCount = 0
    const snapshots = [
      {
        exists: true,
        activeProfileId: "first-profile",
        profiles: [
          {
            id: "first-profile",
            name: "First Profile",
            source: "vscode",
            settings: { "editor.fontSize": 14 },
            keybindings: [],
            resources: {},
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
        ],
      },
      {
        exists: true,
        activeProfileId: "second-profile",
        profiles: [
          {
            id: "second-profile",
            name: "Second Profile",
            source: "cursor",
            settings: { "editor.fontSize": 18 },
            keybindings: [],
            resources: {},
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
        ],
      },
    ]
    const profiles = new WorkbenchProfileStore({
      storage,
      settingsStore: settings,
      profilesKey: "profiles",
      activeKey: "profiles:active",
      profileStorage: {
        async read() {
          const snapshot = snapshots[Math.min(readCount, snapshots.length - 1)]
          readCount += 1
          return snapshot
        },
        async write(snapshot) {
          return snapshot
        },
      },
    })

    await profiles.hydrateFromProfileStorage()
    await profiles.hydrateFromProfileStorage()
    expect(readCount).toBe(1)
    expect(profiles.getActiveProfileId()).toBe("first-profile")

    const changed = await profiles.refreshFromProfileStorage()

    expect(changed).toBe(true)
    expect(readCount).toBe(2)
    expect(profiles.getActiveProfileId()).toBe("second-profile")
    expect(profiles.list()).toEqual([
      expect.objectContaining({ id: "second-profile", source: "cursor", active: true }),
    ])
  })

  it("hydrates the VS Code workspace-associated profile before the global active profile", async () => {
    const { storage, settings } = createStores()
    const readOptions: unknown[] = []
    const profiles = new WorkbenchProfileStore({
      storage,
      settingsStore: settings,
      profilesKey: "profiles",
      activeKey: "profiles:active",
      getWorkspaceIdentifier: () => "D:/workspace-a",
      profileStorage: {
        async read(options) {
          readOptions.push(options)
          return {
            exists: true,
            activeProfileId: "global-profile",
            workspaceProfileId: "workspace-profile",
            profileAssociations: {
              workspaces: {
                "file:///D:/workspace-a": "workspace-profile",
              },
              emptyWindows: {},
            },
            profiles: [
              {
                id: "global-profile",
                name: "Global Profile",
                source: "vscode",
                settings: { "editor.fontSize": 16 },
                keybindings: [],
                resources: {},
                createdAt: "2026-06-01T00:00:00.000Z",
                updatedAt: "2026-06-01T00:00:00.000Z",
              },
              {
                id: "workspace-profile",
                name: "Workspace Profile",
                source: "cursor",
                settings: { "editor.fontSize": 22 },
                keybindings: [],
                resources: {},
                createdAt: "2026-06-01T00:00:00.000Z",
                updatedAt: "2026-06-01T00:00:00.000Z",
              },
            ],
          }
        },
        async write(snapshot) {
          return snapshot
        },
      },
    })

    const changed = await profiles.hydrateFromProfileStorage()

    expect(changed).toBe(true)
    expect(readOptions).toEqual([{ workspace: "D:/workspace-a" }])
    expect(profiles.getActiveProfileId()).toBe("workspace-profile")
    expect(profiles.list().find((profile) => profile.id === "workspace-profile")?.active).toBe(true)
    expect(profiles.currentProfile.workspaces?.map((workspace) => workspace.toString())).toEqual([
      "file:///d:/workspace-a",
    ])
    expect(profiles.getProfile("workspace-profile")?.userDataProfile.workspaces?.map((workspace) => workspace.toString())).toEqual([
      "file:///d:/workspace-a",
    ])
    expect(storage.getItem("profiles:active")).toBe("workspace-profile")
  })

  it("binds the selected profile to the current workspace after switching profiles", async () => {
    const { storage, settings } = createStores()
    const operations: Array<{ type: string; workspace?: string; profileId?: string; activeProfileId?: string }> = []
    const profiles = new WorkbenchProfileStore({
      storage,
      settingsStore: settings,
      profilesKey: "profiles",
      activeKey: "profiles:active",
      getWorkspaceIdentifier: () => "D:/workspace-a",
      profileStorage: {
        async read() {
          return { exists: false, profiles: [], activeProfileId: "" }
        },
        async write(snapshot) {
          operations.push({ type: "write", activeProfileId: snapshot.activeProfileId })
          return snapshot
        },
        async setProfileForWorkspace(workspace, profileId) {
          operations.push({ type: "setWorkspace", workspace, profileId })
          return {
            exists: true,
            profiles: [],
            activeProfileId: profileId,
            profileAssociations: {
              workspaces: { [workspace]: profileId },
              emptyWindows: {},
            },
          }
        },
      },
    })
    profiles.upsertSnapshot({
      id: "workspace-profile",
      name: "Workspace Profile",
      settings: { "editor.fontSize": 18 },
      activate: false,
    })
    await profiles.flushProfileStorage()
    operations.length = 0

    profiles.switchTo("workspace-profile")
    await profiles.flushProfileStorage()

    expect(operations).toEqual([
      { type: "write", activeProfileId: "workspace-profile" },
      { type: "setWorkspace", workspace: "D:/workspace-a", profileId: "workspace-profile" },
    ])
    expect(profiles.currentProfile.workspaces?.map((workspace) => workspace.toString())).toEqual(["D:/workspace-a"])
  })

  it("preserves desktop workspace profile associations when writing later profile snapshots", async () => {
    const { storage, settings } = createStores()
    const writes: any[] = []
    const profiles = new WorkbenchProfileStore({
      storage,
      settingsStore: settings,
      profilesKey: "profiles",
      activeKey: "profiles:active",
      getWorkspaceIdentifier: () => "D:/workspace-a",
      profileStorage: {
        async read() {
          return {
            exists: true,
            activeProfileId: "global-profile",
            workspaceProfileId: "workspace-profile",
            profileAssociations: {
              workspaces: {
                "file:///D:/workspace-a": "workspace-profile",
              },
              emptyWindows: {
                "empty-window-1": "global-profile",
              },
            },
            profiles: [
              {
                id: "global-profile",
                name: "Global Profile",
                source: "vscode",
                settings: {},
                keybindings: [],
                resources: {},
                createdAt: "2026-06-01T00:00:00.000Z",
                updatedAt: "2026-06-01T00:00:00.000Z",
              },
              {
                id: "workspace-profile",
                name: "Workspace Profile",
                source: "cursor",
                settings: {},
                keybindings: [],
                resources: {},
                createdAt: "2026-06-01T00:00:00.000Z",
                updatedAt: "2026-06-01T00:00:00.000Z",
              },
            ],
          }
        },
        async write(snapshot) {
          writes.push(snapshot)
          return snapshot
        },
      },
    })
    await profiles.hydrateFromProfileStorage()

    profiles.upsertSnapshot({
      id: "workspace-profile",
      name: "Workspace Profile Renamed",
      settings: { "editor.fontSize": 20 },
      activate: false,
    })
    await profiles.flushProfileStorage()

    expect(writes.at(-1).version).toBe(2)
    expect(writes.at(-1).profileAssociations).toEqual({
      workspaces: {
        "file:///D:/workspace-a": "workspace-profile",
      },
      emptyWindows: {
        "empty-window-1": "global-profile",
      },
    })
  })

  it("keeps local profiles and backfills desktop profile storage when no desktop file exists", async () => {
    const { storage, settings } = createStores()
    const writes: unknown[] = []
    const profiles = new WorkbenchProfileStore({
      storage,
      settingsStore: settings,
      profilesKey: "profiles",
      activeKey: "profiles:active",
      profileStorage: {
        async read() {
          return { exists: false, profiles: [], activeProfileId: "" }
        },
        async write(snapshot) {
          writes.push(snapshot)
          return snapshot
        },
      },
    })
    profiles.upsertSnapshot({
      id: "local-only",
      name: "Local Only",
      settings: { "editor.fontSize": 13 },
    })
    await profiles.flushProfileStorage()
    writes.length = 0

    const changed = await profiles.hydrateFromProfileStorage()
    await profiles.flushProfileStorage()

    expect(changed).toBe(false)
    expect(profiles.list()[0].id).toBe("local-only")
    expect(writes).toHaveLength(1)
    expect((writes[0] as any).profiles[0].id).toBe("local-only")
    expect((writes[0] as any).activeProfileId).toBe("local-only")
  })

  it("removes the active profile marker when deleting the active profile", () => {
    const { profiles } = createStores()
    const profileEvents: Array<{ removed: string[]; all: string[] }> = []
    const currentEvents: Array<{ previous: string; profile: string }> = []
    profiles.onDidChangeProfiles((event) => {
      profileEvents.push({
        removed: event.removed.map((profile) => profile.name),
        all: event.all.map((profile) => profile.name),
      })
    })
    profiles.onDidChangeCurrentProfile((event) => {
      currentEvents.push({ previous: event.previous.name, profile: event.profile.name })
    })
    const profile = profiles.upsertSnapshot({
      name: "临时",
      settings: { "editor.fontSize": 16 },
    })

    profiles.remove(profile.id)

    expect(profiles.list()).toEqual([])
    expect(profiles.getActiveProfileId()).toBe("")
    expect(profileEvents.at(-1)).toEqual({ removed: ["临时"], all: [] })
    expect(currentEvents.at(-1)).toEqual({ previous: "临时", profile: "Default" })
  })
})
