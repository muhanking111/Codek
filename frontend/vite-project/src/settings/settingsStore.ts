import {
  createConfigurationModel,
  mergeConfigurationRecords,
  type ConfigurationInspectValue,
  type ConfigurationModel,
  type ConfigurationOverrides,
  keyFromOverrideIdentifiers,
} from "../vscode-adapter/platform/configuration/common/configurationModel"
import {
  normalizeWorkspaceStorageRecord,
  settingsRecordToWorkspaceSettings,
  splitKnownSettings,
  type ImportSettingsResult,
  type SettingsRecord,
} from "./settingsCompat"
import type { WorkspaceSettings } from "../workspace/workspaceSettings"
import { readWorkspaceSettingsFile, writeWorkspaceSettingsFile } from "./workspaceSettingsFileClient"
import { patchUserSetting, readUserSettingsFile, writeUserSettingsFile } from "./settingsFileClient"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import {
  ConfigurationScope,
  configurationRegistry,
  getDefaultSettingsFromConfigurationRegistry,
  type ConfigurationRegistry,
} from "./configurationRegistry"

export type SettingsScope = "user" | "workspace" | "extension"

// Mirrors VS Code's ConfigurationTarget values for the targets Codek can write
// today while leaving the enum shape ready for deeper service migration.
export const enum ConfigurationTarget {
  APPLICATION = 1,
  USER = 2,
  USER_LOCAL = 3,
  USER_REMOTE = 4,
  WORKSPACE = 5,
  WORKSPACE_FOLDER = 6,
  DEFAULT = 7,
  MEMORY = 8,
}

export interface ConfigurationUpdateOverrides {
  overrideIdentifiers?: string[] | null
  resource?: string | { toString(): string } | null
  preserveExplicitValue?: boolean
}

export interface SettingsConfigurationChange {
  keys: string[]
  overrides: [string, string[]][]
}

export interface SettingsConfigurationChangeEvent {
  source: ConfigurationTarget
  affectedKeys: ReadonlySet<string>
  change: SettingsConfigurationChange
  affectsConfiguration(configuration: string, overrides?: ConfigurationOverrides): boolean
}

export interface SettingsConfigurationInspectValue<T = unknown> extends ConfigurationInspectValue<T> {
  applicationValue?: T
  defaultValue?: T
  extensionDefaultValue?: T
  userLocalValue?: T
  userRemoteValue?: T
  userValue?: T
  workspaceValue?: T
  workspaceFolderValue?: T
  effectiveValue?: T
  application?: ConfigurationInspectValue<T>
  default?: ConfigurationInspectValue<T>
  extensionDefault?: ConfigurationInspectValue<T>
  userLocal?: ConfigurationInspectValue<T>
  userRemote?: ConfigurationInspectValue<T>
  user?: ConfigurationInspectValue<T>
  workspace?: ConfigurationInspectValue<T>
  workspaceFolder?: ConfigurationInspectValue<T>
  overrideIdentifiers?: string[]
}

export type SettingsOwnerStatus = "connected" | "partial" | "blocked" | "absent"

export interface SettingsOwnerEvidence {
  id: string
  status: SettingsOwnerStatus
  source: string
  reason?: string
}

export interface SettingsSourceChainEntry<T = unknown> {
  source: "default" | "extensionDefault" | "application" | "user" | "userLocal" | "userRemote" | "workspace" | "workspaceFolder"
  target: ConfigurationTarget
  value?: T
  defined: boolean
  override?: boolean
}

export interface SettingsScopeEvidence {
  key: string
  scope?: ConfigurationScope
  scopeName: string
  restricted: boolean
  registered: boolean
}

export interface SettingsReadonlyEvidence {
  readonlyEvidence: true
  writesUserSettingsFile: false
  writesWorkspaceSettingsFile: false
  runtimeDependencyOnSourceMirror: false
}

export interface SettingsRemainingUiOwnerGap {
  status: "blocked"
  connected: false
  owner: "settingsEditor"
  reason: string
  requiredSurface: string
}

export interface SettingsConfigurationOwnerEvidence<T = unknown> {
  key: string
  overrideIdentifier?: string
  resource?: string
  effectiveValue?: T
  registryOwner: SettingsOwnerEvidence
  settingsStoreOwner: SettingsOwnerEvidence
  workspaceSettingsOwner: SettingsOwnerEvidence
  profileStorageOwner: SettingsOwnerEvidence
  settingScope: SettingsScopeEvidence
  sourceChain: SettingsSourceChainEntry<T>[]
  readonlyEvidence: SettingsReadonlyEvidence
  remainingUiOwnerGap: SettingsRemainingUiOwnerGap
}

export interface SettingsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface IConfigurationService {
  readonly _serviceBrand: undefined
  onDidChangeConfiguration(listener: ConfigurationChangeListener): () => void
  getValue<T = unknown>(key: string, overrides?: ConfigurationOverrides): T
  inspect<T = unknown>(key: string, overrides?: ConfigurationOverrides): SettingsConfigurationInspectValue<T>
  getOwnerEvidence<T = unknown>(key: string, overrides?: ConfigurationOverrides): SettingsConfigurationOwnerEvidence<T>
  updateValue(
    key: string,
    value: unknown,
    arg3?: ConfigurationTarget | ConfigurationOverrides | ConfigurationUpdateOverrides,
    arg4?: ConfigurationTarget,
  ): Promise<void>
}

export interface RestrictedSettings {
  default: ReadonlyArray<string>
  application: ReadonlyArray<string>
  userLocal: ReadonlyArray<string>
  userRemote: ReadonlyArray<string>
  workspace: ReadonlyArray<string>
  workspaceFolder: ReadonlyMap<string, ReadonlyArray<string>>
}

type RestrictedSettingsListener = (settings: RestrictedSettings) => void

export interface IWorkbenchConfigurationService extends IConfigurationService {
  readonly restrictedSettings: RestrictedSettings
  onDidChangeRestrictedSettings(listener: RestrictedSettingsListener): () => void
  whenRemoteConfigurationLoaded(): Promise<void>
  initialize(arg?: unknown): Promise<void>
  isSettingAppliedForAllProfiles(setting: string): boolean
}

export const IConfigurationService = createDecorator<IConfigurationService>("configurationService")
export const IWorkbenchConfigurationService = createDecorator<IWorkbenchConfigurationService>("workbenchConfigurationService")

export interface SettingsStoreOptions {
  storage?: SettingsStorage
  applicationKey?: string
  userKey?: string
  workspaceKeyPrefix?: string
  workspaceFolderKeyPrefix?: string
  unknownKey?: string
  userFileSync?: boolean
  configurationRegistry?: ConfigurationRegistry
}

type SettingsListener = (settings: SettingsRecord) => void
type ConfigurationChangeListener = (event: SettingsConfigurationChangeEvent) => void

interface ConfigurationLayerSnapshot {
  application: SettingsRecord
  defaults: SettingsRecord
  extensionDefaults: SettingsRecord
  user: SettingsRecord
  workspace: SettingsRecord
  workspaceFolder: SettingsRecord
}

const DEFAULT_APPLICATION_KEY = "codek-application-settings"
const DEFAULT_USER_KEY = "codek-user-settings"
const DEFAULT_WORKSPACE_PREFIX = "codek-workspace-settings:"
const DEFAULT_WORKSPACE_FOLDER_PREFIX = "codek-workspace-folder-settings:"
const DEFAULT_UNKNOWN_KEY = "codek-unknown-vscode-settings"

export class SettingsStore {
  private readonly storage: SettingsStorage | null
  private readonly applicationKey: string
  private readonly userKey: string
  private readonly workspaceKeyPrefix: string
  private readonly workspaceFolderKeyPrefix: string
  private readonly unknownKey: string
  private readonly configurationRegistry: ConfigurationRegistry
  private applicationSettings: SettingsRecord = {}
  private userSettings: SettingsRecord = {}
  private workspaceSettings: SettingsRecord = {}
  private workspaceFolderSettings = new Map<string, SettingsRecord>()
  private extensionDefaultSettings: SettingsRecord = {}
  private unknownSettings: SettingsRecord = {}
  private projectRoot: string | null = null
  private activeProfileId = ""
  private userFileSyncEnabled = false
  private suppressUserFileSync = false
  private readonly listeners = new Set<SettingsListener>()
  private readonly configurationListeners = new Set<ConfigurationChangeListener>()

  constructor(options: SettingsStoreOptions = {}) {
    this.storage = options.storage ?? getBrowserStorage()
    this.applicationKey = options.applicationKey ?? DEFAULT_APPLICATION_KEY
    this.userKey = options.userKey ?? DEFAULT_USER_KEY
    this.workspaceKeyPrefix = options.workspaceKeyPrefix ?? DEFAULT_WORKSPACE_PREFIX
    this.workspaceFolderKeyPrefix = options.workspaceFolderKeyPrefix ?? DEFAULT_WORKSPACE_FOLDER_PREFIX
    this.unknownKey = options.unknownKey ?? DEFAULT_UNKNOWN_KEY
    this.configurationRegistry = options.configurationRegistry ?? configurationRegistry
    this.userFileSyncEnabled = options.userFileSync === true
    this.applicationSettings = this.readRecord(this.applicationKey)
    this.userSettings = this.readRecord(this.userKey)
    this.unknownSettings = this.readRecord(this.unknownKey)
  }

  enableUserFileSync(enabled = true): void {
    this.userFileSyncEnabled = enabled
  }

  async hydrateUserSettingsFromFile(): Promise<boolean> {
    if (typeof window === "undefined" || !window.codek?.api) return false
    const file = await readUserSettingsFile()
    this.replaceUserSettingsFromExternal(file.settings, ConfigurationTarget.USER)
    return true
  }

  loadWorkspace(projectRoot: string): SettingsRecord {
    const previous = this.createLayerSnapshot()
    this.projectRoot = projectRoot
    const storageKey = this.getWorkspaceKey(projectRoot)
    const rawSettings = this.readRecord(storageKey)
    this.workspaceSettings = normalizeWorkspaceStorageRecord(rawSettings)
    if (this.workspaceSettings !== rawSettings) {
      this.writeRecord(storageKey, this.workspaceSettings)
    }
    this.notify(ConfigurationTarget.WORKSPACE, this.createChange(Object.keys(this.workspaceSettings)), previous)
    return this.getAll()
  }

  async loadWorkspaceFromFile(projectRoot: string): Promise<SettingsRecord> {
    this.loadWorkspace(projectRoot)
    const result = await readWorkspaceSettingsFile(projectRoot)
    if (result.found) {
      this.workspaceSettings = normalizeWorkspaceStorageRecord(result.settings)
      this.persistWorkspace()
      this.notify()
    }
    return this.getAll()
  }

  get<T = unknown>(key: string, fallback?: T, overrides?: ConfigurationOverrides): T {
    const value = this.getConfigurationModel(overrides).getValue<T>(key)
    if (value !== undefined) return value
    return fallback as T
  }

  inspect<T = unknown>(key: string, overrides?: ConfigurationOverrides): SettingsConfigurationInspectValue<T> {
    const overrideIdentifier = overrides?.overrideIdentifier ?? null
    const defaultModel = createConfigurationModel(this.getDefaultSettings())
    const extensionModel = createConfigurationModel(this.extensionDefaultSettings)
    const applicationModel = createConfigurationModel(this.applicationSettings)
    const userModel = createConfigurationModel(this.userSettings)
    const workspaceModel = createConfigurationModel(this.workspaceSettings)
    const workspaceFolderModel = this.getWorkspaceFolderModel(overrides)
    const emptyModel = createConfigurationModel({})
    const mergedModel = defaultModel.merge(extensionModel, applicationModel, userModel, workspaceModel, workspaceFolderModel)
    const merged = mergedModel.inspect<T>(key, overrideIdentifier)

    return {
      ...merged,
      defaultValue: this.getValueFromModel<T>(defaultModel, key, overrideIdentifier),
      extensionDefaultValue: this.getValueFromModel<T>(extensionModel, key, overrideIdentifier),
      applicationValue: this.getValueFromModel<T>(applicationModel, key, overrideIdentifier),
      userValue: this.getValueFromModel<T>(userModel, key, overrideIdentifier),
      userLocalValue: this.getValueFromModel<T>(userModel, key, overrideIdentifier),
      userRemoteValue: undefined,
      workspaceValue: this.getValueFromModel<T>(workspaceModel, key, overrideIdentifier),
      workspaceFolderValue: this.getValueFromModel<T>(workspaceFolderModel, key, overrideIdentifier),
      effectiveValue: merged.merged,
      default: defaultModel.inspect<T>(key, overrideIdentifier),
      extensionDefault: extensionModel.inspect<T>(key, overrideIdentifier),
      application: applicationModel.inspect<T>(key, overrideIdentifier),
      user: userModel.inspect<T>(key, overrideIdentifier),
      userLocal: userModel.inspect<T>(key, overrideIdentifier),
      userRemote: emptyModel.inspect<T>(key, overrideIdentifier),
      workspace: workspaceModel.inspect<T>(key, overrideIdentifier),
      workspaceFolder: workspaceFolderModel.inspect<T>(key, overrideIdentifier),
      overrideIdentifiers: mergedModel.getAllOverrideIdentifiers(),
    }
  }

  getOwnerEvidence<T = unknown>(key: string, overrides?: ConfigurationOverrides): SettingsConfigurationOwnerEvidence<T> {
    const inspect = this.inspect<T>(key, overrides)
    const property = this.configurationRegistry.getConfigurationProperties()[key]
    const resource = getResourceOverrideKey(overrides) ?? undefined
    const overrideIdentifier = overrides?.overrideIdentifier ?? undefined
    const workspaceFolderDefined = inspect.workspaceFolderValue !== undefined
    const workspaceDefined = inspect.workspaceValue !== undefined
    const profileId = this.activeProfileId || "default"

    return {
      key,
      ...(overrideIdentifier ? { overrideIdentifier } : {}),
      ...(resource ? { resource } : {}),
      effectiveValue: inspect.effectiveValue,
      registryOwner: {
        id: "configurationRegistry",
        status: property ? "connected" : "absent",
        source: "ConfigurationRegistry.getConfigurationProperties",
        reason: property ? undefined : "Setting key is not registered in the shared configuration registry.",
      },
      settingsStoreOwner: {
        id: "settingsStore",
        status: "connected",
        source: "SettingsStore.inspect",
      },
      workspaceSettingsOwner: {
        id: workspaceFolderDefined ? "workspaceFolderSettings" : "workspaceSettings",
        status: workspaceFolderDefined || workspaceDefined ? "connected" : "partial",
        source: workspaceFolderDefined
          ? "SettingsStore.getWorkspaceFolderSettings"
          : "SettingsStore.getWorkspaceSettings",
        reason: workspaceFolderDefined || workspaceDefined
          ? undefined
          : "No workspace layer currently defines this setting; defaults/user/profile evidence still remain readable.",
      },
      profileStorageOwner: {
        id: "userDataProfileStorageClient",
        status: this.activeProfileId ? "connected" : "partial",
        source: `SettingsStore.activeProfileId:${profileId}`,
        reason: this.activeProfileId
          ? undefined
          : "The active profile falls back to the default user layer; profile storage client wiring is available but not invoked by this readonly evidence snapshot.",
      },
      settingScope: {
        key,
        scope: property?.scope,
        scopeName: configurationScopeName(property?.scope),
        restricted: property?.restricted === true,
        registered: Boolean(property),
      },
      sourceChain: createSourceChain(inspect),
      readonlyEvidence: {
        readonlyEvidence: true,
        writesUserSettingsFile: false,
        writesWorkspaceSettingsFile: false,
        runtimeDependencyOnSourceMirror: false,
      },
      remainingUiOwnerGap: {
        status: "blocked",
        connected: false,
        owner: "settingsEditor",
        reason: "Full Settings UI/editor owner still requires App.vue or the generic editor shell, which this contract intentionally does not touch.",
        requiredSurface: "SettingsPanel.vue integration through the real workbench/editor shell",
      },
    }
  }

  set(key: string, value: unknown, scope: SettingsScope = "user"): void {
    const previous = this.createLayerSnapshot()
    if (scope === "workspace") {
      this.workspaceSettings = { ...this.workspaceSettings, [key]: value }
      this.persistWorkspace()
      this.persistWorkspaceFile()
    } else if (scope === "extension") {
      this.extensionDefaultSettings = { ...this.extensionDefaultSettings, [key]: value }
    } else {
      this.userSettings = { ...this.userSettings, [key]: value }
      this.writeRecord(this.userKey, this.userSettings)
      this.syncUserSettingFilePatch(key, value)
    }
    this.notify(scopeToTarget(scope), this.createChange([key]), previous)
  }

  update(values: SettingsRecord, scope: SettingsScope = "user"): void {
    const previous = this.createLayerSnapshot()
    if (scope === "workspace") {
      this.workspaceSettings = { ...this.workspaceSettings, ...values }
      this.persistWorkspace()
      this.persistWorkspaceFile()
    } else if (scope === "extension") {
      this.extensionDefaultSettings = { ...this.extensionDefaultSettings, ...values }
    } else {
      this.userSettings = { ...this.userSettings, ...values }
      this.writeRecord(this.userKey, this.userSettings)
      this.syncUserSettingsFile()
    }
    this.notify(scopeToTarget(scope), this.createChange(Object.keys(values)), previous)
  }

  async updateValue(
    key: string,
    value: unknown,
    arg3?: ConfigurationTarget | ConfigurationOverrides | ConfigurationUpdateOverrides,
    arg4?: ConfigurationTarget,
  ): Promise<void> {
    const updateOverrides = normalizeUpdateOverrides(arg3)
    const overrideIdentifiers = updateOverrides.overrideIdentifiers?.length
      ? [...new Set(updateOverrides.overrideIdentifiers)].filter(Boolean)
      : undefined
    const target = normalizeConfigurationTarget(typeof arg3 === "number" ? arg3 : arg4 ?? ConfigurationTarget.USER)

    const previous = this.createLayerSnapshot()
    const defaultValue = this.inspect(key, {
      overrideIdentifier: overrideIdentifiers?.[0] ?? null,
    }).defaultValue
    const nextValue = updateOverrides.preserveExplicitValue || !deepEqual(value, defaultValue) ? value : undefined
    if (target === ConfigurationTarget.WORKSPACE) {
      this.workspaceSettings = writeConfigurationValue(this.workspaceSettings, key, nextValue, overrideIdentifiers)
      this.persistWorkspace()
      this.persistWorkspaceFile()
    } else if (target === ConfigurationTarget.WORKSPACE_FOLDER) {
      const resource = getResourceOverrideKey(updateOverrides)
      if (!resource) {
        throw new Error("WORKSPACE_FOLDER configuration updates require a resource override.")
      }
      const current = this.workspaceFolderSettings.get(resource) ?? {}
      this.setWorkspaceFolderSettings(resource, writeConfigurationValue(current, key, nextValue, overrideIdentifiers))
    } else {
      this.userSettings = writeConfigurationValue(this.userSettings, key, nextValue, overrideIdentifiers)
      this.writeRecord(this.userKey, this.userSettings)
      this.syncUserSettingsFile()
    }
    this.notify(target, this.createChange([key], overrideIdentifiers), previous)
  }

  reset(scope?: SettingsScope): void {
    const previous = this.createLayerSnapshot()
    const affectedKeys = this.getAllKnownKeys()
    if (!scope || scope === "user") {
      this.applicationSettings = {}
      this.storage?.removeItem(this.applicationKey)
      this.userSettings = {}
      this.storage?.removeItem(this.userKey)
      this.unknownSettings = {}
      this.storage?.removeItem(this.unknownKey)
    }
    if (!scope || scope === "workspace") {
      this.workspaceSettings = {}
      if (this.projectRoot) this.storage?.removeItem(this.getWorkspaceKey(this.projectRoot))
      for (const resource of this.workspaceFolderSettings.keys()) {
        this.storage?.removeItem(this.getWorkspaceFolderKey(resource))
      }
      this.workspaceFolderSettings.clear()
      this.persistWorkspaceFile()
    }
    if (!scope || scope === "extension") {
      this.extensionDefaultSettings = {}
    }
    if (!scope || scope === "user") {
      this.syncUserSettingsFile()
    }
    this.notify(scope ? scopeToTarget(scope) : ConfigurationTarget.USER, this.createChange(affectedKeys), previous)
  }

  getAll(): SettingsRecord {
    return mergeConfigurationRecords(
      this.getDefaultSettings(),
      this.extensionDefaultSettings,
      this.applicationSettings,
      this.userSettings,
      this.workspaceSettings,
      ...this.workspaceFolderSettings.values(),
    ) as SettingsRecord
  }

  getAllForOverride(overrideIdentifier: string): SettingsRecord {
    return this.getConfigurationModel({ overrideIdentifier }).toRecord() as SettingsRecord
  }

  getOverrideIdentifiers(): string[] {
    return this.getConfigurationModel().getAllOverrideIdentifiers()
  }

  getUserSettings(): SettingsRecord {
    return { ...this.userSettings }
  }

  getApplicationSettings(): SettingsRecord {
    return { ...this.applicationSettings }
  }

  getActiveProfileId(): string {
    return this.activeProfileId
  }

  replaceUserSettingsForProfile(profileId: string, settings: SettingsRecord): void {
    const previous = this.createLayerSnapshot()
    const result = splitKnownSettings(settings, this.getSupportedKeys())
    this.activeProfileId = profileId
    this.userSettings = { ...result.applied }
    this.unknownSettings = { ...result.unknown }
    if (Object.keys(this.userSettings).length > 0) {
      this.writeRecord(this.userKey, this.userSettings)
    } else {
      this.storage?.removeItem(this.userKey)
    }
    if (Object.keys(this.unknownSettings).length > 0) {
      this.writeRecord(this.unknownKey, this.unknownSettings)
    } else {
      this.storage?.removeItem(this.unknownKey)
    }
    this.syncUserSettingsFile()
    this.notify(ConfigurationTarget.USER, this.createChange(this.getAllKnownKeys()), previous)
  }

  replaceUserSettingsFromExternal(settings: SettingsRecord, source: ConfigurationTarget = ConfigurationTarget.USER): void {
    const result = splitKnownSettings(isRecord(settings) ? settings : {}, this.getSupportedKeys())
    const previous = this.createLayerSnapshot()
    const changedKeys = normalizeChangedKeys([
      ...Object.keys(this.userSettings),
      ...Object.keys(this.unknownSettings),
      ...Object.keys(result.applied),
      ...Object.keys(result.unknown),
    ])
    this.userSettings = { ...result.applied }
    this.unknownSettings = { ...result.unknown }
    this.suppressUserFileSync = true
    try {
      if (Object.keys(this.userSettings).length > 0) {
        this.writeRecord(this.userKey, this.userSettings)
      } else {
        this.storage?.removeItem(this.userKey)
      }
      if (Object.keys(this.unknownSettings).length > 0) {
        this.writeRecord(this.unknownKey, this.unknownSettings)
      } else {
        this.storage?.removeItem(this.unknownKey)
      }
    } finally {
      this.suppressUserFileSync = false
    }
    this.notify(source, this.createChange(changedKeys), previous)
  }

  getWorkspaceSettings(): SettingsRecord {
    return { ...this.workspaceSettings }
  }

  loadWorkspaceFolder(resource: string): SettingsRecord {
    const previous = this.createLayerSnapshot()
    const settings = this.readRecord(this.getWorkspaceFolderKey(resource))
    this.workspaceFolderSettings.set(resource, settings)
    this.notify(ConfigurationTarget.WORKSPACE_FOLDER, this.createChange(Object.keys(settings)), previous)
    return this.getAll()
  }

  updateWorkspaceFolder(resource: string, values: SettingsRecord): void {
    const previous = this.createLayerSnapshot()
    const current = this.workspaceFolderSettings.get(resource) ?? {}
    this.setWorkspaceFolderSettings(resource, { ...current, ...values })
    this.notify(ConfigurationTarget.WORKSPACE_FOLDER, this.createChange(Object.keys(values)), previous)
  }

  getWorkspaceFolderSettings(resource: string): SettingsRecord {
    return { ...(this.workspaceFolderSettings.get(resource) ?? {}) }
  }

  getExtensionDefaultSettings(): SettingsRecord {
    return { ...this.extensionDefaultSettings }
  }

  registerExtensionConfigurationDefaults(values: SettingsRecord): void {
    this.update(values, "extension")
  }

  getUnknownSettings(): SettingsRecord {
    return { ...this.unknownSettings }
  }

  importSettings(input: SettingsRecord, scope: SettingsScope = "user"): ImportSettingsResult {
    const result = splitKnownSettings(input, this.getSupportedKeys())
    if (Object.keys(result.applied).length > 0) {
      this.update(result.applied, scope)
    }
    if (Object.keys(result.unknown).length > 0) {
      this.unknownSettings = { ...this.unknownSettings, ...result.unknown }
      this.writeRecord(this.unknownKey, this.unknownSettings)
      if (scope === "user") this.syncUserSettingsFile()
    }
    return result
  }

  exportSettings(includeUnknown = true): SettingsRecord {
    const explicit = { ...this.userSettings, ...this.workspaceSettings }
    return includeUnknown ? { ...this.unknownSettings, ...explicit } : explicit
  }

  exportUserSettings(includeUnknown = true): SettingsRecord {
    return includeUnknown ? { ...this.unknownSettings, ...this.userSettings } : { ...this.userSettings }
  }

  toWorkspaceSettings(fallback: WorkspaceSettings): WorkspaceSettings {
    return settingsRecordToWorkspaceSettings(this.getAll(), fallback)
  }

  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onDidChangeConfiguration(listener: ConfigurationChangeListener): () => void {
    this.configurationListeners.add(listener)
    return () => this.configurationListeners.delete(listener)
  }

  private persistWorkspace(): void {
    if (!this.projectRoot) return
    this.writeRecord(this.getWorkspaceKey(this.projectRoot), this.workspaceSettings)
  }

  private persistWorkspaceFile(): void {
    if (!this.projectRoot || typeof window === "undefined") return
    writeWorkspaceSettingsFile(this.projectRoot, this.workspaceSettings).catch(() => {
      // File sync is best-effort; localStorage remains the fallback source.
    })
  }

  private getWorkspaceKey(projectRoot: string): string {
    return `${this.workspaceKeyPrefix}${projectRoot}`
  }

  private getWorkspaceFolderKey(resource: string): string {
    return `${this.workspaceFolderKeyPrefix}${resource}`
  }

  private setWorkspaceFolderSettings(resource: string, settings: SettingsRecord): void {
    const next = { ...settings }
    if (Object.keys(next).length === 0) {
      this.workspaceFolderSettings.delete(resource)
      this.storage?.removeItem(this.getWorkspaceFolderKey(resource))
      return
    }
    this.workspaceFolderSettings.set(resource, next)
    this.writeRecord(this.getWorkspaceFolderKey(resource), next)
  }

  private readRecord(key: string): SettingsRecord {
    if (!this.storage) return {}
    try {
      const raw = this.storage.getItem(key)
      if (!raw) return {}
      const parsed: unknown = JSON.parse(raw)
      return isRecord(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  private writeRecord(key: string, value: SettingsRecord): void {
    this.storage?.setItem(key, JSON.stringify(value))
  }

  private syncUserSettingFilePatch(key: string, value: unknown): void {
    if (!this.shouldSyncUserSettingsFile()) return
    void patchUserSetting(key, value).catch(() => {
      void this.syncUserSettingsFile()
    })
  }

  private syncUserSettingsFile(): void {
    if (!this.shouldSyncUserSettingsFile()) return
    const snapshot = this.exportUserSettings()
    void writeUserSettingsFile(snapshot).catch(() => {
      // Desktop settings.json is the authoritative shared file when available;
      // localStorage remains the renderer fallback if the API is not ready.
    })
  }

  private shouldSyncUserSettingsFile(): boolean {
    return this.userFileSyncEnabled && !this.suppressUserFileSync && typeof window !== "undefined" && Boolean(window.codek?.api)
  }

  private notify(
    source: ConfigurationTarget = ConfigurationTarget.USER,
    change: SettingsConfigurationChange = this.createChange(this.getAllKnownKeys()),
    previous: ConfigurationLayerSnapshot = this.createLayerSnapshot(),
  ): void {
    const settings = this.getAll()
    for (const listener of this.listeners) {
      listener(settings)
    }
    if (change.keys.length === 0 && change.overrides.length === 0) return
    const current = this.createLayerSnapshot()
    const event = createConfigurationChangeEvent(source, change, previous, current)
    for (const listener of this.configurationListeners) {
      listener(event)
    }
  }

  private getConfigurationModel(overrides?: ConfigurationOverrides): ConfigurationModel {
    const model = createConfigurationModel(this.getDefaultSettings())
      .merge(createConfigurationModel(this.extensionDefaultSettings))
      .merge(createConfigurationModel(this.applicationSettings))
      .merge(createConfigurationModel(this.userSettings))
      .merge(createConfigurationModel(this.workspaceSettings))
      .merge(this.getWorkspaceFolderModel(overrides))
    const overrideIdentifier = overrides?.overrideIdentifier
    return overrideIdentifier ? model.override(overrideIdentifier) : model
  }

  private getWorkspaceFolderModel(overrides?: ConfigurationOverrides): ConfigurationModel {
    const resource = getResourceOverrideKey(overrides)
    if (resource) return createConfigurationModel(this.workspaceFolderSettings.get(resource))
    return [...this.workspaceFolderSettings.values()]
      .map((settings) => createConfigurationModel(settings))
      .reduce((previous, current) => previous.merge(current), createConfigurationModel({}))
  }

  private getValueFromModel<T>(model: ConfigurationModel, key: string, overrideIdentifier: string | null): T | undefined {
    return overrideIdentifier ? model.override(overrideIdentifier).getValue<T>(key) : model.getValue<T>(key)
  }

  private createLayerSnapshot(): ConfigurationLayerSnapshot {
    return {
      defaults: this.getDefaultSettings() as SettingsRecord,
      application: { ...this.applicationSettings },
      extensionDefaults: { ...this.extensionDefaultSettings },
      user: { ...this.userSettings },
      workspace: { ...this.workspaceSettings },
      workspaceFolder: mergeConfigurationRecords(...this.workspaceFolderSettings.values()) as SettingsRecord,
    }
  }

  private getAllKnownKeys(): string[] {
    return [
      ...Object.keys(this.getDefaultSettings()),
      ...Object.keys(this.applicationSettings),
      ...Object.keys(this.extensionDefaultSettings),
      ...Object.keys(this.userSettings),
      ...Object.keys(this.workspaceSettings),
      ...[...this.workspaceFolderSettings.values()].flatMap((settings) => Object.keys(settings)),
    ]
  }

  private createChange(keys: string[], overrideIdentifiers?: string[]): SettingsConfigurationChange {
    const distinct = normalizeChangedKeys(keys)
    const overrides: [string, string[]][] = overrideIdentifiers?.length
      ? overrideIdentifiers.map((identifier) => [identifier, distinct])
      : []
    return { keys: distinct, overrides }
  }

  private getDefaultSettings(): Record<string, unknown> {
    return getDefaultSettingsFromConfigurationRegistry(this.configurationRegistry)
  }

  private getSupportedKeys(): ReadonlySet<string> {
    return new Set(Object.keys(this.configurationRegistry.getConfigurationProperties()))
  }
}

function normalizeChangedKeys(keys: string[]): string[] {
  return [...new Set(keys.filter(Boolean))]
}

function isRecord(value: unknown): value is SettingsRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getBrowserStorage(): SettingsStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function scopeToTarget(scope: SettingsScope): ConfigurationTarget {
  if (scope === "workspace") return ConfigurationTarget.WORKSPACE
  if (scope === "extension") return ConfigurationTarget.DEFAULT
  return ConfigurationTarget.USER
}

function normalizeConfigurationTarget(target: ConfigurationTarget): ConfigurationTarget {
  if (
    target === ConfigurationTarget.USER ||
    target === ConfigurationTarget.USER_LOCAL ||
    target === ConfigurationTarget.USER_REMOTE ||
    target === ConfigurationTarget.MEMORY
  ) {
    return target === ConfigurationTarget.USER ? target : ConfigurationTarget.USER
  }
  if (target === ConfigurationTarget.WORKSPACE) return ConfigurationTarget.WORKSPACE
  if (target === ConfigurationTarget.WORKSPACE_FOLDER) return ConfigurationTarget.WORKSPACE_FOLDER
  throw new Error(`Unsupported configuration target ${target}. Codek can write USER, WORKSPACE and WORKSPACE_FOLDER settings only.`)
}

function normalizeUpdateOverrides(
  value: ConfigurationTarget | ConfigurationOverrides | ConfigurationUpdateOverrides | undefined,
): ConfigurationUpdateOverrides {
  if (!value || typeof value === "number") return {}
  const updateOverrides = value as ConfigurationUpdateOverrides
  if (Array.isArray(updateOverrides.overrideIdentifiers) || updateOverrides.preserveExplicitValue !== undefined) {
    return {
      overrideIdentifiers: updateOverrides.overrideIdentifiers,
      resource: updateOverrides.resource,
      preserveExplicitValue: updateOverrides.preserveExplicitValue,
    }
  }
  const overrides = value as ConfigurationOverrides
  return {
    overrideIdentifiers: overrides.overrideIdentifier ? [overrides.overrideIdentifier] : undefined,
    resource: overrides.resource,
  }
}

function getResourceOverrideKey(overrides?: ConfigurationOverrides | ConfigurationUpdateOverrides): string | null {
  const resource = (overrides as { resource?: string | { toString(): string } | null } | undefined)?.resource
  if (!resource) return null
  return typeof resource === "string" ? resource : resource.toString()
}

function writeConfigurationValue(
  record: SettingsRecord,
  key: string,
  value: unknown,
  overrideIdentifiers?: string[],
): SettingsRecord {
  const next = { ...record }
  if (overrideIdentifiers?.length) {
    const overrideKey = keyFromOverrideIdentifiers(overrideIdentifiers)
    const current = isRecord(next[overrideKey]) ? { ...(next[overrideKey] as SettingsRecord) } : {}
    if (value === undefined) delete current[key]
    else current[key] = value
    if (Object.keys(current).length === 0) delete next[overrideKey]
    else next[overrideKey] = current
    return next
  }
  if (value === undefined) delete next[key]
  else next[key] = value
  return next
}

function createConfigurationChangeEvent(
  source: ConfigurationTarget,
  change: SettingsConfigurationChange,
  previous: ConfigurationLayerSnapshot,
  current: ConfigurationLayerSnapshot,
): SettingsConfigurationChangeEvent {
  const affectedKeys = new Set<string>(change.keys)
  for (const [, keys] of change.overrides) {
    for (const key of keys) affectedKeys.add(key)
  }
  return {
    source,
    affectedKeys,
    change,
    affectsConfiguration(configuration, overrides) {
      const directlyAffected = [...affectedKeys].some((key) => key === configuration || key.startsWith(`${configuration}.`))
      if (!directlyAffected) return false
      if (!overrides?.overrideIdentifier) return true
      return !deepEqual(
        getEffectiveSnapshotValue(previous, configuration, overrides),
        getEffectiveSnapshotValue(current, configuration, overrides),
      )
    },
  }
}

function getEffectiveSnapshotValue<T>(
  snapshot: ConfigurationLayerSnapshot,
  key: string,
  overrides?: ConfigurationOverrides,
): T | undefined {
  const model = createConfigurationModel(snapshot.defaults)
    .merge(createConfigurationModel(snapshot.extensionDefaults))
    .merge(createConfigurationModel(snapshot.application))
    .merge(createConfigurationModel(snapshot.user))
    .merge(createConfigurationModel(snapshot.workspace))
    .merge(createConfigurationModel(snapshot.workspaceFolder))
  const overrideIdentifier = overrides?.overrideIdentifier
  return overrideIdentifier ? model.override(overrideIdentifier).getValue<T>(key) : model.getValue<T>(key)
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export const settingsStore = new SettingsStore()

export class ConfigurationService implements IWorkbenchConfigurationService {
  declare readonly _serviceBrand: undefined
  private readonly restrictedSettingsListeners = new Set<RestrictedSettingsListener>()
  readonly restrictedSettings: RestrictedSettings

  constructor(
    private readonly store: SettingsStore = settingsStore,
    private readonly registry: ConfigurationRegistry = configurationRegistry,
  ) {
    this.restrictedSettings = createRestrictedSettingsProjection(this.registry)
    this.registry.onDidUpdateConfiguration(() => {
      const next = createRestrictedSettingsProjection(this.registry)
      Object.assign(this.restrictedSettings, next)
      for (const listener of this.restrictedSettingsListeners) listener(this.restrictedSettings)
    })
  }

  onDidChangeConfiguration(listener: ConfigurationChangeListener): () => void {
    return this.store.onDidChangeConfiguration(listener)
  }

  getValue<T = unknown>(key: string, overrides?: ConfigurationOverrides): T {
    return this.store.get<T>(key, undefined, overrides)
  }

  inspect<T = unknown>(key: string, overrides?: ConfigurationOverrides): SettingsConfigurationInspectValue<T> {
    return this.store.inspect<T>(key, overrides)
  }

  getOwnerEvidence<T = unknown>(key: string, overrides?: ConfigurationOverrides): SettingsConfigurationOwnerEvidence<T> {
    return this.store.getOwnerEvidence<T>(key, overrides)
  }

  updateValue(
    key: string,
    value: unknown,
    arg3?: ConfigurationTarget | ConfigurationOverrides | ConfigurationUpdateOverrides,
    arg4?: ConfigurationTarget,
  ): Promise<void> {
    return this.store.updateValue(key, value, arg3, arg4)
  }

  onDidChangeRestrictedSettings(listener: RestrictedSettingsListener): () => void {
    this.restrictedSettingsListeners.add(listener)
    return () => this.restrictedSettingsListeners.delete(listener)
  }

  whenRemoteConfigurationLoaded(): Promise<void> {
    return Promise.resolve()
  }

  initialize(_arg?: unknown): Promise<void> {
    return Promise.resolve()
  }

  isSettingAppliedForAllProfiles(setting: string): boolean {
    const applied = this.store.get<string[]>("workbench.settings.applyToAllProfiles", [])
    return Array.isArray(applied) && applied.includes(setting)
  }
}

export const workbenchConfigurationService = new ConfigurationService(settingsStore)
registerSingleton(IConfigurationService, workbenchConfigurationService, InstantiationType.Delayed)
registerSingleton(IWorkbenchConfigurationService, workbenchConfigurationService, InstantiationType.Delayed)

function createRestrictedSettingsProjection(registry: ConfigurationRegistry): RestrictedSettings {
  const restricted = [...Object.entries(registry.getConfigurationProperties())]
    .filter(([, property]) => property.restricted)
    .map(([key, property]) => ({ key, scope: property.scope }))
  return {
    default: restricted.map(({ key }) => key),
    application: restricted.filter(({ scope }) => scope === ConfigurationScope.APPLICATION).map(({ key }) => key),
    userLocal: [],
    userRemote: [],
    workspace: restricted
      .filter(({ scope }) => scope === ConfigurationScope.WINDOW || scope === ConfigurationScope.RESOURCE)
      .map(({ key }) => key),
    workspaceFolder: new Map(),
  }
}

function createSourceChain<T>(inspect: SettingsConfigurationInspectValue<T>): SettingsSourceChainEntry<T>[] {
  return [
    createSourceChainEntry("default", ConfigurationTarget.DEFAULT, inspect.defaultValue, inspect.default?.override !== undefined),
    createSourceChainEntry(
      "extensionDefault",
      ConfigurationTarget.DEFAULT,
      inspect.extensionDefaultValue,
      inspect.extensionDefault?.override !== undefined,
    ),
    createSourceChainEntry("application", ConfigurationTarget.APPLICATION, inspect.applicationValue, inspect.application?.override !== undefined),
    createSourceChainEntry("user", ConfigurationTarget.USER, inspect.userValue, inspect.user?.override !== undefined),
    createSourceChainEntry("userLocal", ConfigurationTarget.USER_LOCAL, inspect.userLocalValue, inspect.userLocal?.override !== undefined),
    createSourceChainEntry("userRemote", ConfigurationTarget.USER_REMOTE, inspect.userRemoteValue, inspect.userRemote?.override !== undefined),
    createSourceChainEntry("workspace", ConfigurationTarget.WORKSPACE, inspect.workspaceValue, inspect.workspace?.override !== undefined),
    createSourceChainEntry(
      "workspaceFolder",
      ConfigurationTarget.WORKSPACE_FOLDER,
      inspect.workspaceFolderValue,
      inspect.workspaceFolder?.override !== undefined,
    ),
  ]
}

function createSourceChainEntry<T>(
  source: SettingsSourceChainEntry<T>["source"],
  target: ConfigurationTarget,
  value: T | undefined,
  override: boolean,
): SettingsSourceChainEntry<T> {
  return {
    source,
    target,
    value,
    defined: value !== undefined,
    override,
  }
}

function configurationScopeName(scope: ConfigurationScope | undefined): string {
  if (scope === ConfigurationScope.APPLICATION) return "application"
  if (scope === ConfigurationScope.MACHINE) return "machine"
  if (scope === ConfigurationScope.APPLICATION_MACHINE) return "applicationMachine"
  if (scope === ConfigurationScope.WINDOW) return "window"
  if (scope === ConfigurationScope.RESOURCE) return "resource"
  if (scope === ConfigurationScope.LANGUAGE_OVERRIDABLE) return "languageOverridable"
  if (scope === ConfigurationScope.MACHINE_OVERRIDABLE) return "machineOverridable"
  return "unknown"
}
