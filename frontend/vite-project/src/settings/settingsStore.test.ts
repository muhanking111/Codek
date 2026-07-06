import { describe, expect, it, vi } from "vitest"
import { SETTINGS_SCHEMA, getDefaultSettings, getSettingDefinition } from "./settingsSchema"
import {
  settingsRecordToWorkspaceSettings,
  splitKnownSettings,
  workspaceSettingsToSettingsRecord,
} from "./settingsCompat"
import { importSettingsJson, parseSettingsJson, stringifySettingsJson } from "./settingsJson"
import {
  ConfigurationTarget,
  ConfigurationService,
  IConfigurationService,
  IWorkbenchConfigurationService,
  SettingsStore,
  settingsStore,
  workbenchConfigurationService,
  type SettingsStorage,
} from "./settingsStore"
import { ConfigurationRegistry, ConfigurationScope, configurationRegistry } from "./configurationRegistry"
import { DEFAULT_WORKSPACE_SETTINGS, type WorkspaceSettings } from "../workspace/workspaceSettings"
import { readWorkspaceSettingsFile, writeWorkspaceSettingsFile } from "./workspaceSettingsFileClient"
import { getSingletonServiceDescriptors } from "../vscode-adapter/platform/instantiation/common/extensions"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"

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

function createStore(): SettingsStore {
  return new SettingsStore({
    storage: new MemoryStorage(),
    userKey: "test-user-settings",
    workspaceKeyPrefix: "test-workspace-settings:",
    unknownKey: "test-unknown-settings",
  })
}

describe("settings schema", () => {
  it("registers defaults for every setting", () => {
    const defaults = getDefaultSettings()

    expect(Object.keys(defaults)).toHaveLength(SETTINGS_SCHEMA.length)
    expect(defaults["editor.fontSize"]).toBe(14)
    expect(defaults["files.autoSave"]).toBe("off")
    expect(defaults["codek.locale"]).toBe("zh")
    expect(defaults["workbench.productIconTheme"]).toBe("Default")
    expect(defaults["codek.privacy.enabled"]).toBe(false)
    expect(defaults["telemetry.telemetryLevel"]).toBe("off")
    expect(defaults["codek.rules.enabled"]).toBe(true)
    expect(defaults["codek.memory.enabled"]).toBe(true)
    expect(defaults["codek.memory.provider"]).toBe("local")
    expect(defaults["codek.memory.agentmemory.baseUrl"]).toBe("http://127.0.0.1:3111")
    expect(defaults["codek.memory.agentmemory.fallbackToLocal"]).toBe(true)
    expect(defaults["codek.memory.agentmemory.authHeader"]).toBe("")
    expect(defaults["codek.orchestration.ruflo.enabled"]).toBe(false)
    expect(defaults["codek.orchestration.ruflo.mode"]).toBe("disabled")
    expect(defaults["codek.orchestration.ruflo.command"]).toBe("npx ruflo@latest")
    expect(defaults["codek.indexing.enabled"]).toBe(true)
    expect(getSettingDefinition("workbench.colorTheme")?.title).toBe("颜色主题")
    expect(getSettingDefinition("codek.locale")?.group).toBe("general")
    expect(getSettingDefinition("files.trimTrailingWhitespace")?.status).toBeUndefined()
    expect(getSettingDefinition("files.insertFinalNewline")?.status).toBeUndefined()
    expect(getSettingDefinition("codek.privacy.redactLogs")?.status).toBeUndefined()
    expect(getSettingDefinition("codek.privacy.sensitiveFilePatterns")?.status).toBeUndefined()
    expect(getSettingDefinition("codek.rules.cursorCompat")?.status).toBeUndefined()
  })

  it("exposes VS Code-style configuration registry metadata for settings UI and extensions", () => {
    const properties = configurationRegistry.getConfigurationProperties()

    expect(properties["editor.fontSize"].scope).toBe(ConfigurationScope.LANGUAGE_OVERRIDABLE)
    expect(properties["files.autoSave"].scope).toBe(ConfigurationScope.WINDOW)
    expect(properties["codek.locale"].scope).toBe(ConfigurationScope.APPLICATION)
    expect(properties["workbench.colorTheme"].default).toBe("dark")
    expect(properties["workbench.colorTheme"].enum).toEqual(["dark", "light"])
    expect(properties["workbench.productIconTheme"].default).toBe("Default")
    expect(properties["workbench.productIconTheme"].enum).toEqual(["Default"])
  })

  it("tracks VS Code-style configuration deregistration, excluded settings and policy metadata", () => {
    const registry = new ConfigurationRegistry([])
    const node = registry.registerConfiguration({
      id: "sample.extension",
      title: "Sample Extension",
      restrictedProperties: ["sample.extension.restrictedMode"],
      properties: {
        "sample.extension.restrictedMode": {
          type: "string",
          default: "auto",
        },
        "sample.extension.policyMode": {
          type: "boolean",
          default: false,
          included: false,
          policy: { name: "SamplePolicyMode" },
        },
      },
    })

    expect(registry.getConfigurationProperties()["sample.extension.restrictedMode"].restricted).toBe(true)
    expect(registry.getExcludedConfigurationProperties()["sample.extension.policyMode"].included).toBe(false)
    expect(registry.getPolicyConfigurations().get("SamplePolicyMode")).toBe("sample.extension.policyMode")
    expect(registry.validateProperty("sample.extension.restrictedMode", { type: "string" })).toContain("already registered")
    expect(registry.validateProperty("[typescript]", { type: "object" })).toContain("language-specific override")

    registry.deregisterConfigurations([node])

    expect(registry.getConfigurationProperties()["sample.extension.restrictedMode"]).toBeUndefined()
    expect(registry.getExcludedConfigurationProperties()["sample.extension.policyMode"]).toBeUndefined()
    expect(registry.getPolicyConfigurations().has("SamplePolicyMode")).toBe(false)
  })
})

describe("settings compat", () => {
  it("converts legacy workspace settings to unified keys", () => {
    const legacy: WorkspaceSettings = {
      ...DEFAULT_WORKSPACE_SETTINGS,
      editor: {
        ...DEFAULT_WORKSPACE_SETTINGS.editor,
        fontSize: 16,
        tabSize: 4,
        minimap: false,
      },
      files: {
        ...DEFAULT_WORKSPACE_SETTINGS.files,
        autoSave: "afterDelay",
        excludeGlob: ["node_modules", "dist"],
      },
      ai: {
        ...DEFAULT_WORKSPACE_SETTINGS.ai,
        provider: "codex-shared",
      },
    }

    const migrated = workspaceSettingsToSettingsRecord(legacy)

    expect(migrated["editor.fontSize"]).toBe(16)
    expect(migrated["editor.tabSize"]).toBe(4)
    expect(migrated["editor.minimap.enabled"]).toBe(false)
    expect(migrated["files.autoSave"]).toBe("afterDelay")
    expect(migrated["files.exclude"]).toEqual(["node_modules", "dist"])
    expect(migrated["codek.ai.provider"]).toBe("codex-shared")
  })

  it("converts unified settings back to workspace settings", () => {
    const workspace = settingsRecordToWorkspaceSettings(
      {
        "editor.fontSize": 18,
        "editor.wordWrap": "on",
        "files.autoSave": "onFocusChange",
        "search.exclude": ["node_modules"],
        "git.autoStage": true,
        "codek.ai.temperature": 0.2,
      },
      DEFAULT_WORKSPACE_SETTINGS,
    )

    expect(workspace.editor.fontSize).toBe(18)
    expect(workspace.editor.wordWrap).toBe("on")
    expect(workspace.files.autoSave).toBe("onFocusChange")
    expect(workspace.search.excludeGlob).toEqual(["node_modules"])
    expect(workspace.git.autoStage).toBe(true)
    expect(workspace.ai.temperature).toBe(0.2)
  })

  it("splits known and unknown imported settings", () => {
    const supported = new Set(["editor.fontSize", "codek.ai.provider", "workbench.productIconTheme"])
    const result = splitKnownSettings(
      {
        "editor.fontSize": 15,
        "codek.ai.provider": "ollama",
        "workbench.productIconTheme": "Default",
        "unknown.futureSetting": true,
      },
      supported,
    )

    expect(result.applied).toEqual({
      "editor.fontSize": 15,
      "codek.ai.provider": "ollama",
      "workbench.productIconTheme": "Default",
    })
    expect(result.unknown).toEqual({
      "unknown.futureSetting": true,
    })
  })

  it("keeps dynamically registered VS Code configuration keys in the applied settings bucket", () => {
    const result = splitKnownSettings(
      {
        "sample.extension.mode": "manual",
        "unknown.futureSetting": true,
      },
      new Set(["sample.extension.mode"]),
    )

    expect(result.applied).toEqual({
      "sample.extension.mode": "manual",
    })
    expect(result.unknown).toEqual({
      "unknown.futureSetting": true,
    })
  })
})

describe("settings store", () => {
  it("merges defaults, user settings and workspace settings", () => {
    const store = createStore()

    store.set("editor.fontSize", 15)
    store.loadWorkspace("D:/Workspace")
    store.set("editor.fontSize", 17, "workspace")

    expect(store.get("editor.fontSize")).toBe(17)
    expect(store.getUserSettings()).toEqual({ "editor.fontSize": 15 })
    expect(store.getWorkspaceSettings()).toEqual({ "editor.fontSize": 17 })
  })

  it("merges extension defaults below user and workspace settings", () => {
    const store = createStore()

    store.registerExtensionConfigurationDefaults({
      "editor.fontSize": 13,
      "codek.extension.sample.enabled": true,
    })
    store.set("editor.fontSize", 15)
    store.loadWorkspace("D:/Workspace")
    store.set("editor.fontSize", 17, "workspace")

    expect(store.get("editor.fontSize")).toBe(17)
    expect(store.get("codek.extension.sample.enabled")).toBe(true)
    expect(store.getExtensionDefaultSettings()).toEqual({
      "editor.fontSize": 13,
      "codek.extension.sample.enabled": true,
    })
  })

  it("keeps VS Code style language overrides from leaking into global editor settings", () => {
    const store = createStore()

    store.registerExtensionConfigurationDefaults({
      "editor.tabSize": 2,
      "[typescript]": {
        "editor.tabSize": 3,
      },
      "[search-result]": {
        "editor.lineNumbers": "off",
      },
    })
    store.set("editor.tabSize", 4)
    store.loadWorkspace("D:/Workspace")
    store.set("editor.tabSize", 6, "workspace")
    store.set("[typescript]", { "editor.tabSize": 8 }, "workspace")

    expect(store.get("editor.tabSize")).toBe(6)
    expect(store.get("editor.lineNumbers")).toBe("on")
    expect(store.getExtensionDefaultSettings()["[search-result]"]).toEqual({
      "editor.lineNumbers": "off",
    })
    expect(store.getWorkspaceSettings()["[typescript]"]).toEqual({
      "editor.tabSize": 8,
    })
  })

  it("reads VS Code language override values through the configuration model", () => {
    const store = createStore()

    store.registerExtensionConfigurationDefaults({
      "editor.tabSize": 2,
      "editor.insertSpaces": true,
      "[typescript][javascript]": {
        "editor.tabSize": 3,
      },
      "[typescript]": {
        "editor.insertSpaces": false,
      },
    })
    store.set("editor.tabSize", 4)
    store.set("[typescript]", { "editor.tabSize": 8 }, "workspace")

    expect(store.get("editor.tabSize")).toBe(4)
    expect(store.get("editor.tabSize", 2, { overrideIdentifier: "typescript" })).toBe(8)
    expect(store.get("editor.insertSpaces", true, { overrideIdentifier: "typescript" })).toBe(false)
    expect(store.get("editor.tabSize", 2, { overrideIdentifier: "javascript" })).toBe(3)
    expect(store.getOverrideIdentifiers()).toEqual(["typescript", "javascript"])
  })

  it("inspects default, user, workspace and override values", () => {
    const store = createStore()

    store.registerExtensionConfigurationDefaults({
      "[typescript]": { "editor.tabSize": 3 },
    })
    store.set("editor.tabSize", 4)
    store.set("[typescript]", { "editor.tabSize": 8 }, "workspace")

    const inspected = store.inspect<number>("editor.tabSize", { overrideIdentifier: "typescript" })

    expect(inspected.value).toBe(4)
    expect(inspected.override).toBe(8)
    expect(inspected.merged).toBe(8)
    expect(inspected.overrides).toEqual([
      { identifiers: ["typescript"], value: 8 },
    ])
  })

  it("returns VS Code-style inspect layers for default, extension, user and workspace targets", () => {
    const store = createStore()

    store.registerExtensionConfigurationDefaults({
      "editor.fontSize": 13,
      "[typescript]": { "editor.fontSize": 15 },
    })
    store.set("editor.fontSize", 16)
    store.loadWorkspace("D:/Workspace")
    store.set("[typescript]", { "editor.fontSize": 18 }, "workspace")

    const inspected = store.inspect<number>("editor.fontSize", { overrideIdentifier: "typescript" })

    expect(inspected.defaultValue).toBe(14)
    expect(inspected.extensionDefaultValue).toBe(15)
    expect(inspected.userValue).toBe(16)
    expect(inspected.workspaceValue).toBe(18)
    expect(inspected.effectiveValue).toBe(18)
    expect(inspected.default?.value).toBe(14)
    expect(inspected.extensionDefault?.override).toBe(15)
    expect(inspected.workspace?.override).toBe(18)
    expect(inspected.overrideIdentifiers).toEqual(["typescript"])
  })

  it("updates user and workspace targets with VS Code default-value removal semantics", async () => {
    const store = createStore()

    await store.updateValue("editor.fontSize", 20, ConfigurationTarget.USER)
    await store.updateValue("files.autoSave", "afterDelay", ConfigurationTarget.WORKSPACE)

    expect(store.getUserSettings()).toMatchObject({ "editor.fontSize": 20 })
    expect(store.getWorkspaceSettings()).toMatchObject({ "files.autoSave": "afterDelay" })

    await store.updateValue("editor.fontSize", 14, ConfigurationTarget.USER)
    await store.updateValue("files.autoSave", "off", ConfigurationTarget.WORKSPACE)

    expect(store.getUserSettings()["editor.fontSize"]).toBeUndefined()
    expect(store.getWorkspaceSettings()["files.autoSave"]).toBeUndefined()
  })

  it("normalizes VS Code configuration target aliases and rejects unsupported scopes", async () => {
    const store = createStore()

    await store.updateValue("editor.fontSize", 18, ConfigurationTarget.USER_LOCAL)
    await store.updateValue("files.autoSave", "afterDelay", ConfigurationTarget.USER_REMOTE)
    await store.updateValue("editor.wordWrap", "on", ConfigurationTarget.MEMORY)

    expect(store.getUserSettings()).toMatchObject({
      "editor.fontSize": 18,
      "files.autoSave": "afterDelay",
      "editor.wordWrap": "on",
    })

    await expect(store.updateValue("editor.fontSize", 20, ConfigurationTarget.APPLICATION)).rejects.toThrow(
      "Unsupported configuration target",
    )
    await expect(store.updateValue("editor.fontSize", 20, ConfigurationTarget.WORKSPACE_FOLDER)).rejects.toThrow(
      "resource override",
    )
    await expect(store.updateValue("editor.fontSize", 20, ConfigurationTarget.DEFAULT)).rejects.toThrow(
      "Unsupported configuration target",
    )
  })

  it("updates language override targets without rewriting unrelated override settings", async () => {
    const store = createStore()

    store.set("[typescript]", { "editor.insertSpaces": false }, "workspace")
    await store.updateValue(
      "editor.tabSize",
      6,
      { overrideIdentifiers: ["typescript", "javascript"] },
      ConfigurationTarget.WORKSPACE,
    )

    expect(store.get("editor.tabSize", 2, { overrideIdentifier: "typescript" })).toBe(6)
    expect(store.get("editor.tabSize", 2, { overrideIdentifier: "javascript" })).toBe(6)
    expect(store.getWorkspaceSettings()).toEqual({
      "[typescript]": { "editor.insertSpaces": false },
      "[typescript][javascript]": { "editor.tabSize": 6 },
    })
  })

  it("merges workspace folder settings above workspace settings for resource overrides", async () => {
    const store = createStore()

    store.set("editor.fontSize", 16)
    store.loadWorkspace("D:/Workspace")
    store.set("editor.fontSize", 18, "workspace")
    store.updateWorkspaceFolder("file:///d:/codek/packages/app", {
      "editor.fontSize": 22,
      "[typescript]": { "editor.tabSize": 6 },
    })

    expect(store.get("editor.fontSize")).toBe(22)
    expect(store.get("editor.fontSize", 0, { resource: "file:///d:/codek/packages/app" })).toBe(22)
    expect(store.get("editor.tabSize", 2, {
      resource: "file:///d:/codek/packages/app",
      overrideIdentifier: "typescript",
    })).toBe(6)
    expect(store.inspect<number>("editor.fontSize", {
      resource: "file:///d:/codek/packages/app",
    }).workspaceFolderValue).toBe(22)
  })

  it("writes VS Code workspace-folder target only when a resource override is supplied", async () => {
    const store = createStore()

    await expect(
      store.updateValue("editor.fontSize", 20, ConfigurationTarget.WORKSPACE_FOLDER),
    ).rejects.toThrow("resource override")

    await store.updateValue(
      "editor.fontSize",
      20,
      { resource: "file:///d:/codek/packages/app" },
      ConfigurationTarget.WORKSPACE_FOLDER,
    )

    expect(store.getWorkspaceFolderSettings("file:///d:/codek/packages/app")).toEqual({
      "editor.fontSize": 20,
    })
    expect(store.get("editor.fontSize", 0, { resource: "file:///d:/codek/packages/app" })).toBe(20)
  })

  it("emits VS Code-style configuration change events with affectsConfiguration", async () => {
    const store = createStore()
    const events: Array<{ source: ConfigurationTarget; keys: string[]; tabSize: boolean; fontSize: boolean; tsTabSize: boolean }> = []

    store.onDidChangeConfiguration((event) => {
      events.push({
        source: event.source,
        keys: [...event.affectedKeys],
        tabSize: event.affectsConfiguration("editor.tabSize"),
        fontSize: event.affectsConfiguration("editor.fontSize"),
        tsTabSize: event.affectsConfiguration("editor.tabSize", { overrideIdentifier: "typescript" }),
      })
    })

    await store.updateValue("editor.tabSize", 5, { overrideIdentifiers: ["typescript"] }, ConfigurationTarget.WORKSPACE)

    expect(events).toEqual([
      {
        source: ConfigurationTarget.WORKSPACE,
        keys: ["editor.tabSize"],
        tabSize: true,
        fontSize: false,
        tsTabSize: true,
      },
    ])
  })

  it("preserves unknown imported VS Code settings", () => {
    const store = createStore()

    const result = store.importSettings({
      "editor.fontSize": 20,
      "cursor.chat.smoothStreaming": true,
    })

    expect(result.applied).toEqual({ "editor.fontSize": 20 })
    expect(result.unknown).toEqual({ "cursor.chat.smoothStreaming": true })
    expect(store.get("editor.fontSize")).toBe(20)
    expect(store.getUnknownSettings()).toEqual({ "cursor.chat.smoothStreaming": true })
  })

  it("uses the configuration registry as the supported settings source for imports", () => {
    const registry = new ConfigurationRegistry([])
    registry.registerConfiguration({
      id: "sample.extension",
      title: "Sample Extension",
      properties: {
        "sample.extension.mode": {
          type: "string",
          default: "auto",
          scope: ConfigurationScope.WINDOW,
        },
      },
    })
    const store = new SettingsStore({
      storage: new MemoryStorage(),
      userKey: "test-dynamic-user-settings",
      unknownKey: "test-dynamic-unknown-settings",
      configurationRegistry: registry,
    })

    const result = store.importSettings({
      "sample.extension.mode": "manual",
      "cursor.futureSetting": true,
    })

    expect(result.applied).toEqual({ "sample.extension.mode": "manual" })
    expect(result.unknown).toEqual({ "cursor.futureSetting": true })
    expect(store.get("sample.extension.mode")).toBe("manual")
    expect(store.getUnknownSettings()).toEqual({ "cursor.futureSetting": true })
  })

  it("stops treating deregistered extension configuration keys as supported settings", () => {
    const registry = new ConfigurationRegistry([])
    const node = registry.registerConfiguration({
      id: "sample.extension",
      title: "Sample Extension",
      properties: {
        "sample.extension.mode": {
          type: "string",
          default: "auto",
          scope: ConfigurationScope.WINDOW,
        },
      },
    })
    const store = new SettingsStore({
      storage: new MemoryStorage(),
      userKey: "test-deregistered-user-settings",
      unknownKey: "test-deregistered-unknown-settings",
      configurationRegistry: registry,
    })

    registry.deregisterConfigurations([node])
    const result = store.importSettings({ "sample.extension.mode": "manual" })

    expect(result.applied).toEqual({})
    expect(result.unknown).toEqual({ "sample.extension.mode": "manual" })
    expect(store.getUnknownSettings()).toEqual({ "sample.extension.mode": "manual" })
  })

  it("exports only user and preserved unknown settings to the VS Code-style user settings file", () => {
    const store = createStore()

    store.set("editor.fontSize", 20)
    store.loadWorkspace("D:/Workspace")
    store.set("files.autoSave", "afterDelay", "workspace")
    store.importSettings({ "cursor.chat.smoothStreaming": true })

    expect(store.exportUserSettings()).toEqual({
      "cursor.chat.smoothStreaming": true,
      "editor.fontSize": 20,
    })
    expect(store.exportSettings()).toEqual(expect.objectContaining({
      "cursor.chat.smoothStreaming": true,
      "editor.fontSize": 20,
      "files.autoSave": "afterDelay",
    }))
  })

  it("replaces user settings from the desktop User/settings.json without keeping stale local keys", () => {
    const store = createStore()
    const events: string[][] = []
    store.set("editor.fontSize", 12)
    store.importSettings({ "cursor.old": true })
    store.onDidChangeConfiguration((event) => {
      events.push([...event.affectedKeys])
    })

    store.replaceUserSettingsFromExternal({
      "workbench.colorTheme": "light",
      "cursor.new": true,
    })

    expect(store.getUserSettings()).toEqual({ "workbench.colorTheme": "light" })
    expect(store.getUnknownSettings()).toEqual({ "cursor.new": true })
    expect(store.get("editor.fontSize")).toBe(14)
    expect(store.exportUserSettings()).toEqual({
      "cursor.new": true,
      "workbench.colorTheme": "light",
    })
    expect(events.at(-1)).toEqual(["editor.fontSize", "cursor.old", "workbench.colorTheme", "cursor.new"])
  })

  it("syncs user-layer writes to the desktop settings API without writing workspace settings to User/settings.json", async () => {
    const apiMock = vi.fn(async (method: string, path: string, body?: unknown) => ({
      path: "D:/Workspace/User/settings.json",
      settings: (body as any)?.settings ?? {},
    }))
    window.codek = { api: apiMock } as unknown as typeof window.codek
    const store = createStore()
    store.enableUserFileSync(true)

    store.set("editor.fontSize", 18)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(apiMock).toHaveBeenLastCalledWith(
      "PATCH",
      "/settings/user",
      { key: "editor.fontSize", value: 18 },
      undefined,
      undefined,
    )

    apiMock.mockClear()
    store.loadWorkspace("D:/Workspace")
    store.set("files.autoSave", "afterDelay", "workspace")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(apiMock).not.toHaveBeenCalled()

    store.importSettings({ "cursor.futureSetting": true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const putCall = apiMock.mock.calls.find((call) => call[0] === "PUT" && call[1] === "/settings/user")
    expect(putCall?.[2]).toEqual({
      settings: {
        "cursor.futureSetting": true,
        "editor.fontSize": 18,
      },
    })
  })

  it("notifies listeners when settings change", () => {
    const store = createStore()
    const snapshots: number[] = []

    const unsubscribe = store.subscribe((settings) => {
      snapshots.push(settings["editor.fontSize"] as number)
    })
    store.set("editor.fontSize", 19)
    unsubscribe()
    store.set("editor.fontSize", 21)

    expect(snapshots).toEqual([19])
  })

  it("loads workspace settings from .codek/settings.json and keeps local fallback", async () => {
    const writes = new Map<string, string>()
    window.codek = {
      readFile: async (path: string) => {
        if (path.endsWith("/.codek/settings.json")) {
          return JSON.stringify({ "editor.fontSize": 18, "files.autoSave": "afterDelay" })
        }
        return null
      },
      createDir: async () => true,
      writeFile: async (path: string, content: string) => {
        writes.set(path, content)
        return true
      },
    } as unknown as typeof window.codek

    const store = createStore()
    await store.loadWorkspaceFromFile("D:/Workspace")

    expect(store.get("editor.fontSize")).toBe(18)
    expect(store.getWorkspaceSettings()).toEqual({
      "editor.fontSize": 18,
      "files.autoSave": "afterDelay",
    })

    store.set("editor.fontSize", 20, "workspace")
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(writes.get("D:/Workspace/.codek/settings.json")).toContain('"editor.fontSize": 20')
  })

  it("exposes VS Code-style configuration services without creating a second settings source", async () => {
    const store = createStore()
    const service = new ConfigurationService(store)
    const events: string[][] = []

    service.onDidChangeConfiguration((event) => {
      events.push([...event.affectedKeys])
    })
    await service.updateValue("editor.fontSize", 19, ConfigurationTarget.USER)

    expect(service._serviceBrand).toBeUndefined()
    expect(service.getValue("editor.fontSize")).toBe(19)
    expect(store.get("editor.fontSize")).toBe(19)
    expect(service.inspect("editor.fontSize")?.userValue).toBe(19)
    expect(events).toEqual([["editor.fontSize"]])
  })

  it("updates override identifiers through the configuration service facade", async () => {
    const store = createStore()
    const service = new ConfigurationService(store)
    const events: Array<{ keys: string[]; tsTabSize: boolean }> = []

    service.onDidChangeConfiguration((event) => {
      events.push({
        keys: [...event.affectedKeys],
        tsTabSize: event.affectsConfiguration("editor.tabSize", { overrideIdentifier: "typescript" }),
      })
    })

    await service.updateValue(
      "editor.tabSize",
      6,
      { overrideIdentifiers: ["typescript"] },
      ConfigurationTarget.USER,
    )

    expect(service.getValue("editor.tabSize", { overrideIdentifier: "typescript" })).toBe(6)
    expect(service.inspect<number>("editor.tabSize", { overrideIdentifier: "typescript" }).user?.override).toBe(6)
    expect(store.getUserSettings()).toEqual({ "[typescript]": { "editor.tabSize": 6 } })
    expect(events).toEqual([{ keys: ["editor.tabSize"], tsTabSize: true }])
  })

  it("projects Settings owner evidence from the shared registry and store without creating a second state source", async () => {
    const store = createStore()
    const service = new ConfigurationService(store)

    store.registerExtensionConfigurationDefaults({
      "editor.tabSize": 2,
      "[typescript]": { "editor.tabSize": 3 },
    })
    await service.updateValue("editor.tabSize", 4, ConfigurationTarget.USER)
    store.loadWorkspace("D:/Workspace")
    await service.updateValue(
      "editor.tabSize",
      6,
      { overrideIdentifiers: ["typescript"] },
      ConfigurationTarget.WORKSPACE,
    )

    const evidence = service.getOwnerEvidence<number>("editor.tabSize", { overrideIdentifier: "typescript" })

    expect(evidence.registryOwner).toEqual({
      id: "configurationRegistry",
      status: "connected",
      source: "ConfigurationRegistry.getConfigurationProperties",
      reason: undefined,
    })
    expect(evidence.settingsStoreOwner).toEqual({
      id: "settingsStore",
      status: "connected",
      source: "SettingsStore.inspect",
    })
    expect(evidence.settingScope).toEqual({
      key: "editor.tabSize",
      scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
      scopeName: "languageOverridable",
      restricted: false,
      registered: true,
    })
    expect(evidence.sourceChain.map((entry) => [entry.source, entry.defined, entry.value, entry.override])).toEqual([
      ["default", true, 2, false],
      ["extensionDefault", true, 3, true],
      ["application", false, undefined, false],
      ["user", true, 4, false],
      ["userLocal", true, 4, false],
      ["userRemote", false, undefined, false],
      ["workspace", true, 6, true],
      ["workspaceFolder", false, undefined, false],
    ])
    expect(evidence.effectiveValue).toBe(6)
    expect(evidence.readonlyEvidence).toEqual({
      readonlyEvidence: true,
      writesUserSettingsFile: false,
      writesWorkspaceSettingsFile: false,
      runtimeDependencyOnSourceMirror: false,
    })
    expect(store.get("editor.tabSize", 0, { overrideIdentifier: "typescript" })).toBe(6)
  })

  it("keeps Settings UI owner evidence partial when the real editor shell is not connected", () => {
    const store = createStore()
    const evidence = store.getOwnerEvidence("workbench.colorTheme")

    expect(evidence.remainingUiOwnerGap).toEqual({
      status: "blocked",
      connected: false,
      owner: "settingsEditor",
      reason: "Full Settings UI/editor owner still requires App.vue or the generic editor shell, which this contract intentionally does not touch.",
      requiredSurface: "SettingsPanel.vue integration through the real workbench/editor shell",
    })
    expect(evidence.workspaceSettingsOwner.status).toBe("partial")
    expect(evidence.profileStorageOwner).toEqual({
      id: "userDataProfileStorageClient",
      status: "partial",
      source: "SettingsStore.activeProfileId:default",
      reason: "The active profile falls back to the default user layer; profile storage client wiring is available but not invoked by this readonly evidence snapshot.",
    })
  })

  it("does not write real user or workspace settings files while reading owner evidence", () => {
    const apiMock = vi.fn()
    const writeFile = vi.fn()
    window.codek = {
      api: apiMock,
      writeFile,
      createDir: vi.fn(),
    } as unknown as typeof window.codek
    const store = createStore()

    store.loadWorkspace("D:/Workspace")
    const evidence = store.getOwnerEvidence("files.autoSave")

    expect(evidence.readonlyEvidence.writesUserSettingsFile).toBe(false)
    expect(evidence.readonlyEvidence.writesWorkspaceSettingsFile).toBe(false)
    expect(apiMock).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("projects profile and workspace-folder owner evidence through the same settings store", async () => {
    const store = createStore()

    store.replaceUserSettingsForProfile("profile-a", { "editor.fontSize": 16 })
    await store.updateValue(
      "editor.fontSize",
      22,
      { resource: "file:///d:/codek/packages/app" },
      ConfigurationTarget.WORKSPACE_FOLDER,
    )

    const evidence = store.getOwnerEvidence<number>("editor.fontSize", {
      resource: "file:///d:/codek/packages/app",
    })

    expect(evidence.profileStorageOwner).toEqual({
      id: "userDataProfileStorageClient",
      status: "connected",
      source: "SettingsStore.activeProfileId:profile-a",
      reason: undefined,
    })
    expect(evidence.workspaceSettingsOwner).toEqual({
      id: "workspaceFolderSettings",
      status: "connected",
      source: "SettingsStore.getWorkspaceFolderSettings",
      reason: undefined,
    })
    expect(evidence.resource).toBe("file:///d:/codek/packages/app")
    expect(evidence.effectiveValue).toBe(22)
    expect(evidence.sourceChain.find((entry) => entry.source === "workspaceFolder")).toEqual({
      source: "workspaceFolder",
      target: ConfigurationTarget.WORKSPACE_FOLDER,
      value: 22,
      defined: true,
      override: false,
    })
  })

  it("exposes workbench configuration service closure methods over the same settings store", async () => {
    const store = createStore()
    const service = new ConfigurationService(store)

    store.set("workbench.settings.applyToAllProfiles", ["editor.fontSize"])

    await expect(service.initialize({ id: "workspace" })).resolves.toBeUndefined()
    await expect(service.whenRemoteConfigurationLoaded()).resolves.toBeUndefined()
    expect(service.restrictedSettings.workspace).toEqual([])
    expect(service.isSettingAppliedForAllProfiles("editor.fontSize")).toBe(true)
    expect(service.isSettingAppliedForAllProfiles("files.autoSave")).toBe(false)
  })

  it("projects restricted registry settings through the workbench configuration service", () => {
    const registry = new ConfigurationRegistry([])
    const store = new SettingsStore({
      storage: new MemoryStorage(),
      userKey: "test-restricted-user-settings",
      configurationRegistry: registry,
    })
    const service = new ConfigurationService(store, registry)
    const events: string[][] = []
    service.onDidChangeRestrictedSettings((settings) => {
      events.push([...settings.workspace])
    })

    registry.registerConfiguration({
      id: "sample.extension",
      title: "Sample Extension",
      restrictedProperties: ["sample.extension.workspaceOnly"],
      properties: {
        "sample.extension.workspaceOnly": {
          type: "boolean",
          default: false,
          scope: ConfigurationScope.WINDOW,
        },
      },
    })

    expect(service.restrictedSettings.default).toEqual(["sample.extension.workspaceOnly"])
    expect(service.restrictedSettings.workspace).toEqual(["sample.extension.workspaceOnly"])
    expect(events).toEqual([["sample.extension.workspaceOnly"]])
  })

  it("registers IConfigurationService and IWorkbenchConfigurationService to the shared settings facade", () => {
    const collection = new ServiceCollection(
      [IConfigurationService, workbenchConfigurationService],
      [IWorkbenchConfigurationService, workbenchConfigurationService],
    )

    expect(collection.get(IConfigurationService)).toBe(workbenchConfigurationService)
    expect(collection.get(IWorkbenchConfigurationService)).toBe(workbenchConfigurationService)
    expect(workbenchConfigurationService.getValue("codek.locale")).toBe(settingsStore.get("codek.locale"))
    expect(getSingletonServiceDescriptors().some(([id, instance]) => id === IConfigurationService && instance === workbenchConfigurationService)).toBe(true)
    expect(getSingletonServiceDescriptors().some(([id, instance]) => id === IWorkbenchConfigurationService && instance === workbenchConfigurationService)).toBe(true)
  })

  it("registers VS Code Workspace Trust startup policy keys in the shared configuration registry", () => {
    expect(workbenchConfigurationService.getValue("security.workspace.trust.enabled")).toBe(true)
    expect(workbenchConfigurationService.getValue("security.workspace.trust.startupPrompt")).toBe("once")
    expect(workbenchConfigurationService.getValue("security.workspace.trust.untrustedFiles")).toBe("prompt")
    expect(workbenchConfigurationService.getValue("security.workspace.trust.banner")).toBe("untilDismissed")
    expect(workbenchConfigurationService.getValue("security.workspace.trust.emptyWindow")).toBe(true)

    expect(configurationRegistry.getConfigurationProperties()).toMatchObject({
      "security.workspace.trust.enabled": expect.objectContaining({ default: true }),
      "security.workspace.trust.startupPrompt": expect.objectContaining({ default: "once" }),
      "security.workspace.trust.untrustedFiles": expect.objectContaining({ default: "prompt" }),
      "security.workspace.trust.banner": expect.objectContaining({ default: "untilDismissed" }),
      "security.workspace.trust.emptyWindow": expect.objectContaining({ default: true }),
    })
  })
})

describe("workspace settings file client", () => {
  it("treats missing workspace settings file as an empty record", async () => {
    window.codek = {
      readFile: async () => null,
    } as unknown as typeof window.codek

    await expect(readWorkspaceSettingsFile("D:/Workspace")).resolves.toEqual({
      path: "D:/Workspace/.codek/settings.json",
      settings: {},
      found: false,
    })
  })

  it("creates .codek before writing workspace settings", async () => {
    const calls: string[] = []
    window.codek = {
      createDir: async (path: string) => {
        calls.push(`mkdir:${path}`)
        return true
      },
      writeFile: async (path: string, content: string) => {
        calls.push(`write:${path}:${content.includes('"editor.tabSize": 4')}`)
        return true
      },
    } as unknown as typeof window.codek

    await expect(writeWorkspaceSettingsFile("D:/Workspace", { "editor.tabSize": 4 })).resolves.toBe(
      "D:/Workspace/.codek/settings.json",
    )
    expect(calls).toEqual([
      "mkdir:D:/Workspace/.codek",
      "write:D:/Workspace/.codek/settings.json:true",
    ])
  })
})

describe("settings json", () => {
  it("imports valid settings JSON", () => {
    const store = createStore()

    const result = importSettingsJson(
      JSON.stringify({
        "editor.fontSize": 22,
        "cursor.unknown": "kept",
      }),
      "user",
      store,
    )

    expect(result.ok).toBe(true)
    expect(result.applied).toEqual({ "editor.fontSize": 22 })
    expect(result.unknown).toEqual({ "cursor.unknown": "kept" })
    expect(store.get("editor.fontSize")).toBe(22)
  })

  it("returns a Chinese error for invalid JSON shape", () => {
    const result = parseSettingsJson("[]")

    expect(result.ok).toBe(false)
    expect(result.error).toContain("设置 JSON 必须是一个对象")
  })

  it("stringifies settings in stable key order", () => {
    const output = stringifySettingsJson({
      "files.autoSave": "off",
      "editor.fontSize": 14,
    })

    expect(output.indexOf("editor.fontSize")).toBeLessThan(output.indexOf("files.autoSave"))
    expect(output.endsWith("\n")).toBe(true)
  })
})
