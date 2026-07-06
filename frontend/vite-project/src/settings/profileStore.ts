import type { SettingsRecord } from "./settingsCompat"
import type { SettingsStore, SettingsStorage } from "./settingsStore"
import { settingsStore as defaultSettingsStore } from "./settingsStore"
import type { VsCodeKeybindingEntry } from "./keybindingsJson"
import {
  userDataProfileStorageClient,
  type ProfileStorageDataUpdate,
  type WorkbenchProfileAssociations,
  type WorkbenchProfilesStorageClient,
  type WorkbenchProfilesStorageSnapshot,
} from "./userDataProfileStorageClient"
import { URI } from "../vscode-adapter/base/common"
import { Emitter, type Event } from "../vscode-adapter/base/common/event"
import {
  createDefaultUserDataProfile,
  createUserDataProfileId,
  deserializeUserDataProfile,
  isSerializedUserDataProfile,
  serializeUserDataProfile,
  toUserDataProfile,
  type SerializedUserDataProfile,
  type UserDataProfile,
} from "../vscode-adapter/platform/userDataProfile/common/userDataProfile"
import {
  UserDataProfileService,
  UserDataProfilesService,
  type DidChangeUserDataProfileEvent,
  type DidChangeProfilesEvent,
} from "../vscode-adapter/platform/userDataProfile/common/userDataProfileService"

export type ProfileSource = "codek" | "vscode" | "cursor" | "manual"
export type WorkbenchProfileResourceKey = "tasks" | "snippets" | "globalState" | "extensions" | "mcp"
export type WorkbenchProfileResources = Partial<Record<WorkbenchProfileResourceKey, string>>

export interface WorkbenchProfile {
  id: string
  name: string
  source: ProfileSource
  settings: SettingsRecord
  keybindings: VsCodeKeybindingEntry[]
  resources: WorkbenchProfileResources
  userDataProfile: UserDataProfile
  createdAt: string
  updatedAt: string
}

export interface WorkbenchProfileSummary {
  id: string
  name: string
  source: ProfileSource
  active: boolean
  settingsCount: number
  keybindingsCount: number
  colorTheme: string
  updatedAt: string
}

export interface WorkbenchProfileResourceSummary {
  hasContent: boolean
  count: number
}

export interface WorkbenchProfileTasksSummary extends WorkbenchProfileResourceSummary {
  labels: string[]
}

export interface WorkbenchProfileExtensionsSummary extends WorkbenchProfileResourceSummary {
  ids: string[]
  disabledCount: number
}

export interface WorkbenchProfileSelectionItem {
  id: string
  name: string
  source: ProfileSource
  active: boolean
  canSwitch: boolean
  settings: {
    count: number
    colorTheme: string
    iconTheme: string
    sensitiveKeysRedacted: true
  }
  keybindings: {
    count: number
  }
  resources: {
    tasks: WorkbenchProfileTasksSummary
    extensions: WorkbenchProfileExtensionsSummary
  }
  action: {
    commandId: "workbench.profiles.switchProfile"
    args: [string]
    evidenceSafe: true
  }
  updatedAt: string
}

export interface WorkbenchProfileActionEvidence {
  action: "upsert" | "switch" | "remove"
  profileId: string
  profileName: string
  activeProfileId: string
  settingsCount: number
  tasksCount: number
  extensionsCount: number
  tokenRedacted: true
  createdAt: number
}

export interface WorkbenchProfileSelectionProjection {
  stateSource: "workbenchProfileStore.profileEntries+userDataProfileService.currentProfile"
  activeProfileId: string
  profiles: WorkbenchProfileSelectionItem[]
  actionEvidence: WorkbenchProfileActionEvidence[]
  constraints: {
    noSecondProfileStore: true
    profileScopedResourcesDerivedFromProfileEntries: true
    evidenceSafeActions: true
  }
}

export interface UserDataProfileTemplate {
  readonly name: string
  readonly icon?: string
  readonly settings?: string
  readonly keybindings?: string
  readonly tasks?: string
  readonly snippets?: string
  readonly globalState?: string
  readonly extensions?: string
  readonly mcp?: string
}

export interface ImportedWorkbenchProfileSnapshot {
  id?: string
  name?: string
  source?: ProfileSource
  settings?: SettingsRecord
  keybindings?: VsCodeKeybindingEntry[]
  resources?: WorkbenchProfileResources
  activate?: boolean
}

export interface WorkbenchProfileTemplateImport {
  template: UserDataProfileTemplate
  snapshot?: ImportedWorkbenchProfileSnapshot
  id?: string
  source?: ProfileSource
  activate?: boolean
}

export interface DidChangeWorkbenchProfileEvent {
  readonly previous: UserDataProfile
  readonly profile: UserDataProfile
  join(promise: Promise<void>): void
}

export interface DidChangeWorkbenchProfilesEvent {
  readonly added: readonly UserDataProfile[]
  readonly removed: readonly UserDataProfile[]
  readonly updated: readonly UserDataProfile[]
  readonly all: readonly UserDataProfile[]
}

export interface WorkbenchProfileStoreOptions {
  storage?: SettingsStorage
  settingsStore?: SettingsStore
  profilesKey?: string
  activeKey?: string
  now?: () => Date
  profileStorage?: WorkbenchProfilesStorageClient | null
  getWorkspaceIdentifier?: () => string | null | Promise<string | null>
}

const DEFAULT_PROFILES_KEY = "codek-workbench-profiles.v1"
const DEFAULT_ACTIVE_KEY = "codek-active-workbench-profile.v1"
const PROFILE_USER_DATA_HOME = URI.from({ scheme: "codek-user-data", path: "/" })
const PROFILE_HOME = URI.joinPath(PROFILE_USER_DATA_HOME, "profiles")
const PROFILE_CACHE_HOME = URI.joinPath(PROFILE_USER_DATA_HOME, "profile-cache")
const DEFAULT_USER_DATA_PROFILE = createDefaultUserDataProfile(PROFILE_USER_DATA_HOME)
const SENSITIVE_SETTING_KEY = /(api[-_.]?key|token|secret|password|credential|authorization)/i

function getBrowserStorage(): SettingsStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeWorkspaceIdentifier(value: unknown): string | null {
  const workspace = typeof value === "string" ? value.trim() : ""
  return workspace || null
}

async function getDefaultWorkspaceIdentifier(): Promise<string | null> {
  if (typeof window === "undefined") return null
  try {
    const state = await window.codek?.getWorkspaceState?.()
    return normalizeWorkspaceIdentifier(state?.workspaceFile) ??
      normalizeWorkspaceIdentifier(state?.projectRoot) ??
      normalizeWorkspaceIdentifier(state?.workspaceRoots?.[0])
  } catch {
    return null
  }
}

function normalizeProfileAssociations(value: unknown): WorkbenchProfileAssociations {
  const source = isRecord(value) ? value : {}
  const workspaces: Record<string, string> = {}
  const emptyWindows: Record<string, string> = {}
  if (isRecord(source.workspaces)) {
    for (const [workspace, profileId] of Object.entries(source.workspaces)) {
      const key = typeof workspace === "string" ? workspace.trim() : ""
      const id = typeof profileId === "string" ? profileId.trim() : ""
      if (key && id) workspaces[key] = id
    }
  }
  if (isRecord(source.emptyWindows)) {
    for (const [windowId, profileId] of Object.entries(source.emptyWindows)) {
      const key = typeof windowId === "string" ? windowId.trim() : ""
      const id = typeof profileId === "string" ? profileId.trim() : ""
      if (key && id) emptyWindows[key] = id
    }
  }
  return { workspaces, emptyWindows }
}

function filterProfileAssociations(value: WorkbenchProfileAssociations, validProfileIds: Set<string>): WorkbenchProfileAssociations {
  const source = normalizeProfileAssociations(value)
  const workspaces: Record<string, string> = {}
  const emptyWindows: Record<string, string> = {}
  for (const [workspace, profileId] of Object.entries(source.workspaces ?? {})) {
    if (validProfileIds.has(profileId)) workspaces[workspace] = profileId
  }
  for (const [windowId, profileId] of Object.entries(source.emptyWindows ?? {})) {
    if (validProfileIds.has(profileId)) emptyWindows[windowId] = profileId
  }
  return { workspaces, emptyWindows }
}

function sanitizeSettings(settings: SettingsRecord): SettingsRecord {
  const out: SettingsRecord = {}
  for (const [key, value] of Object.entries(settings || {})) {
    if (SENSITIVE_SETTING_KEY.test(key)) continue
    out[key] = value
  }
  return out
}

function normalizeSource(source: unknown): ProfileSource {
  return source === "vscode" || source === "cursor" || source === "manual" ? source : "codek"
}

function isUserDataProfileTemplate(value: unknown): value is UserDataProfileTemplate {
  return Boolean(
    isRecord(value) &&
      typeof value.name === "string" &&
      (value.icon === undefined || typeof value.icon === "string") &&
      (value.settings === undefined || typeof value.settings === "string") &&
      (value.keybindings === undefined || typeof value.keybindings === "string") &&
      (value.tasks === undefined || typeof value.tasks === "string") &&
      (value.snippets === undefined || typeof value.snippets === "string") &&
      (value.globalState === undefined || typeof value.globalState === "string") &&
      (value.extensions === undefined || typeof value.extensions === "string") &&
      (value.mcp === undefined || typeof value.mcp === "string"),
  )
}

function parseJsonObject(text: string | undefined): Record<string, unknown> {
  if (!text) return {}
  try {
    const parsed = JSON.parse(text) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function parseSettingsResource(content: string | undefined): SettingsRecord {
  const parsed = parseJsonObject(content)
  if (typeof parsed.settings !== "string") return {}
  return sanitizeSettings(parseJsonObject(parsed.settings) as SettingsRecord)
}

function parseKeybindingsResource(content: string | undefined): VsCodeKeybindingEntry[] {
  const parsed = parseJsonObject(content)
  if (typeof parsed.keybindings !== "string") return []
  try {
    const keybindings = JSON.parse(parsed.keybindings) as unknown
    return Array.isArray(keybindings) ? keybindings as VsCodeKeybindingEntry[] : []
  } catch {
    return []
  }
}

function sanitizeProfileResources(resources: unknown): WorkbenchProfileResources {
  if (!isRecord(resources)) return {}
  const out: WorkbenchProfileResources = {}
  for (const key of ["tasks", "snippets", "globalState", "extensions", "mcp"] as const) {
    const value = resources[key]
    if (typeof value === "string") out[key] = value
  }
  return out
}

function extractTemplateProfileResources(template: UserDataProfileTemplate): WorkbenchProfileResources {
  return sanitizeProfileResources(template)
}

function parseGlobalStateStorageEntries(content: string | undefined): ProfileStorageDataUpdate["data"] {
  const parsed = parseJsonObject(content)
  const storage = isRecord(parsed.storage) ? parsed.storage : {}
  const entries: ProfileStorageDataUpdate["data"] = {}
  for (const [key, value] of Object.entries(storage)) {
    const storageKey = typeof key === "string" ? key.trim() : ""
    if (!storageKey) continue
    if (isRecord(value) && ("value" in value || "target" in value || "scope" in value)) {
      entries[storageKey] = {
        value: value.value === undefined || value.value === null ? undefined : String(value.value),
        target: typeof value.target === "number" ? value.target : 0,
        scope: typeof value.scope === "number" ? value.scope : 0,
      }
    } else if (value !== undefined && value !== null) {
      entries[storageKey] = String(value)
    }
  }
  return entries
}

function createGlobalStateResourceContentFromEntries(entries: Record<string, { value?: string; target?: number; scope?: number }>): string {
  const storage: Record<string, string> = {}
  for (const [key, entry] of Object.entries(entries)) {
    if (entry?.value === undefined) continue
    if (entry.target !== undefined && entry.target !== 0) continue
    storage[key] = entry.value
  }
  return JSON.stringify({ storage })
}

function stringifyJsonResource(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function getProfileResourcePlatform(): string {
  if (typeof navigator !== "undefined" && /win/i.test(navigator.platform || "")) return "win32"
  if (typeof navigator !== "undefined" && /mac/i.test(navigator.platform || "")) return "darwin"
  if (typeof navigator !== "undefined" && /linux/i.test(navigator.platform || "")) return "linux"
  return "web"
}

function createSettingsResourceContent(settings: SettingsRecord): string {
  return JSON.stringify({
    settings: stringifyJsonResource(settings || {}),
  })
}

function createKeybindingsResourceContent(keybindings: VsCodeKeybindingEntry[]): string {
  return JSON.stringify({
    keybindings: stringifyJsonResource(Array.isArray(keybindings) ? keybindings : []),
    platform: getProfileResourcePlatform(),
  })
}

function summarizeTasksResource(content: string | undefined): WorkbenchProfileTasksSummary {
  const parsed = parseJsonObject(content)
  const tasksContent = typeof parsed.tasks === "string" ? parseJsonObject(parsed.tasks) : {}
  const tasks = Array.isArray(tasksContent.tasks) ? tasksContent.tasks : []
  const labels = tasks
    .map((task) => isRecord(task) && typeof task.label === "string" ? task.label : "")
    .filter(Boolean)
  return {
    hasContent: Boolean(content && tasks.length),
    count: tasks.length,
    labels,
  }
}

function summarizeExtensionsResource(content: string | undefined): WorkbenchProfileExtensionsSummary {
  let extensions: unknown[] = []
  if (content) {
    try {
      const parsed = JSON.parse(content) as unknown
      extensions = Array.isArray(parsed) ? parsed : []
    } catch {
      extensions = []
    }
  }
  const ids = extensions
    .map((extension) => {
      if (!isRecord(extension) || !isRecord(extension.identifier)) return ""
      return typeof extension.identifier.id === "string" ? extension.identifier.id : ""
    })
    .filter(Boolean)
  const disabledCount = extensions.filter((extension) => isRecord(extension) && extension.disabled === true).length
  return {
    hasContent: extensions.length > 0,
    count: extensions.length,
    ids,
    disabledCount,
  }
}

function createProfileResource(id: string, name: string, serialized?: unknown): UserDataProfile {
  if (isSerializedUserDataProfile(serialized)) return deserializeUserDataProfile(serialized)
  return toUserDataProfile(id, name, URI.joinPath(PROFILE_HOME, id), PROFILE_CACHE_HOME)
}

function reviveWorkspaceUri(value: string): URI | null {
  try {
    return URI.parse(value)
  } catch {
    return null
  }
}

function getProfileWorkspaceUris(id: string, profileAssociations: WorkbenchProfileAssociations): URI[] {
  const workspaces: URI[] = []
  for (const [workspace, profileId] of Object.entries(profileAssociations.workspaces ?? {})) {
    if (profileId !== id) continue
    const uri = reviveWorkspaceUri(workspace)
    if (uri) workspaces.push(uri)
  }
  return workspaces
}

function applyProfileAssociationsToEntries(
  entries: WorkbenchProfile[],
  profileAssociations: WorkbenchProfileAssociations,
): WorkbenchProfile[] {
  return entries.map((profile) => {
    const workspaces = getProfileWorkspaceUris(profile.id, profileAssociations)
    return {
      ...profile,
      userDataProfile: {
        ...profile.userDataProfile,
        workspaces: workspaces.length ? workspaces : undefined,
      },
    }
  })
}

function normalizeProfile(value: unknown): WorkbenchProfile | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : ""
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : ""
  if (!id || !name) return null
  return {
    id,
    name,
    source: normalizeSource(value.source),
    settings: isRecord(value.settings) ? sanitizeSettings(value.settings as SettingsRecord) : {},
    keybindings: Array.isArray(value.keybindings) ? value.keybindings as VsCodeKeybindingEntry[] : [],
    resources: sanitizeProfileResources(value.resources),
    userDataProfile: createProfileResource(id, name, value.userDataProfile),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
  }
}

function cloneUserDataProfile(profile: UserDataProfile): UserDataProfile {
  return {
    ...profile,
    workspaces: profile.workspaces ? [...profile.workspaces] : undefined,
  }
}

export class WorkbenchProfileStore {
  private readonly storage: SettingsStorage | null
  private profileStorage: WorkbenchProfilesStorageClient | null
  private readonly usesDefaultProfileStorage: boolean
  private readonly settingsStore: SettingsStore
  private readonly profilesKey: string
  private readonly activeKey: string
  private readonly now: () => Date
  private readonly getWorkspaceIdentifier: () => string | null | Promise<string | null>
  private readonly currentProfileService: UserDataProfileService
  private readonly profilesService: UserDataProfilesService
  private profileEntries: WorkbenchProfile[] = []
  private activeProfileId = ""
  private currentWorkspaceIdentifier: string | null = null
  private profileAssociations: WorkbenchProfileAssociations = { workspaces: {}, emptyWindows: {} }
  private readonly actionEvidence: WorkbenchProfileActionEvidence[] = []
  private hydratePromise: Promise<boolean> | null = null
  private pendingProfileStorageWrite: Promise<void> | null = null
  private pendingWorkspaceAssociationWrite: Promise<void> | null = null
  private pendingProfileScopedStorageWrite: Promise<void> | null = null
  private profileStorageWriteChain: Promise<void> = Promise.resolve()

  constructor(options: WorkbenchProfileStoreOptions = {}) {
    this.storage = options.storage ?? getBrowserStorage()
    this.usesDefaultProfileStorage = options.profileStorage === undefined
    this.profileStorage = this.usesDefaultProfileStorage ? getDefaultProfileStorage() : options.profileStorage
    this.settingsStore = options.settingsStore ?? defaultSettingsStore
    this.profilesKey = options.profilesKey ?? DEFAULT_PROFILES_KEY
    this.activeKey = options.activeKey ?? DEFAULT_ACTIVE_KEY
    this.now = options.now ?? (() => new Date())
    this.getWorkspaceIdentifier = options.getWorkspaceIdentifier ?? getDefaultWorkspaceIdentifier
    this.profileEntries = this.readProfiles()
    this.activeProfileId = this.storage?.getItem(this.activeKey) || ""
    this.currentProfileService = new UserDataProfileService(this.getActiveProfileEntry()?.userDataProfile ?? DEFAULT_USER_DATA_PROFILE)
    this.profilesService = new UserDataProfilesService(DEFAULT_USER_DATA_PROFILE, this.profileEntries.map((profile) => profile.userDataProfile))
  }

  list(): WorkbenchProfileSummary[] {
    return this.profileEntries.map((profile) => ({
      id: profile.id,
      name: profile.name,
      source: profile.source,
      active: profile.id === this.activeProfileId,
      settingsCount: Object.keys(profile.settings).length,
      keybindingsCount: profile.keybindings.length,
      colorTheme: String(profile.settings["workbench.colorTheme"] || ""),
      updatedAt: profile.updatedAt,
    }))
  }

  get profiles(): readonly UserDataProfile[] {
    return this.profilesService.profiles.map(cloneUserDataProfile)
  }

  get currentProfile(): UserDataProfile {
    return cloneUserDataProfile(this.currentProfileService.currentProfile)
  }

  get onDidChangeCurrentProfile(): Event<DidChangeWorkbenchProfileEvent> {
    return this.currentProfileService.onDidChangeCurrentProfile as Event<DidChangeUserDataProfileEvent>
  }

  get onDidChangeProfiles(): Event<DidChangeWorkbenchProfilesEvent> {
    return this.profilesService.onDidChangeProfiles as Event<DidChangeProfilesEvent>
  }

  getActiveProfileId(): string {
    return this.activeProfileId
  }

  getProfile(id: string): WorkbenchProfile | null {
    const profile = this.profileEntries.find((entry) => entry.id === id)
    return profile ? this.clone(profile) : null
  }

  getSelectionProjection(): WorkbenchProfileSelectionProjection {
    return {
      stateSource: "workbenchProfileStore.profileEntries+userDataProfileService.currentProfile",
      activeProfileId: this.activeProfileId,
      profiles: this.profileEntries.map((profile) => this.toSelectionItem(profile)),
      actionEvidence: [...this.actionEvidence],
      constraints: {
        noSecondProfileStore: true,
        profileScopedResourcesDerivedFromProfileEntries: true,
        evidenceSafeActions: true,
      },
    }
  }

  hydrateFromProfileStorage(): Promise<boolean> {
    if (!this.getProfileStorage()) return Promise.resolve(false)
    if (this.hydratePromise) return this.hydratePromise
    this.hydratePromise = this.doHydrateFromProfileStorage()
    return this.hydratePromise
  }

  refreshFromProfileStorage(): Promise<boolean> {
    if (!this.getProfileStorage()) return Promise.resolve(false)
    this.hydratePromise = null
    return this.hydrateFromProfileStorage()
  }

  async flushProfileStorage(): Promise<void> {
    await this.pendingProfileStorageWrite
    await this.pendingWorkspaceAssociationWrite
    await this.pendingProfileScopedStorageWrite
  }

  saveCurrent(name: string, options: {
    source?: ProfileSource
    keybindings?: VsCodeKeybindingEntry[]
    activate?: boolean
  } = {}): WorkbenchProfile {
    return this.upsertSnapshot({
      name,
      source: options.source ?? "manual",
      settings: this.settingsStore.getUserSettings(),
      keybindings: options.keybindings ?? [],
      activate: options.activate ?? true,
    })
  }

  importFromVsCodeTemplate(input: WorkbenchProfileTemplateImport): WorkbenchProfile {
    if (!isUserDataProfileTemplate(input.template)) {
      throw new Error("VS Code Profile 模板格式无效")
    }
    const settings = input.snapshot?.settings && isRecord(input.snapshot.settings)
      ? input.snapshot.settings
      : parseSettingsResource(input.template.settings)
    const keybindings = Array.isArray(input.snapshot?.keybindings)
      ? input.snapshot.keybindings
      : parseKeybindingsResource(input.template.keybindings)
    const resources = {
      ...extractTemplateProfileResources(input.template),
      ...sanitizeProfileResources(input.snapshot?.resources),
    }

    const profile = this.upsertSnapshot({
      id: input.snapshot?.id ?? input.id,
      name: input.snapshot?.name || input.template.name || "导入的 Profile",
      source: normalizeSource(input.snapshot?.source ?? input.source),
      settings,
      keybindings,
      resources,
      activate: input.snapshot?.activate ?? input.activate ?? true,
    })
    if (profile.id === this.activeProfileId) {
      this.settingsStore.replaceUserSettingsForProfile(profile.id, profile.settings)
    }
    this.queueProfileScopedGlobalStatePersist(profile.id, profile.resources.globalState)
    return profile
  }

  exportToVsCodeTemplate(id: string): UserDataProfileTemplate {
    const profile = this.profileEntries.find((entry) => entry.id === id)
    if (!profile) throw new Error(`Profile 不存在：${id}`)
    return {
      name: profile.name,
      icon: profile.userDataProfile.icon,
      settings: createSettingsResourceContent(profile.settings),
      keybindings: createKeybindingsResourceContent(profile.keybindings),
      ...profile.resources,
    }
  }

  async exportToVsCodeTemplateAsync(id: string): Promise<UserDataProfileTemplate> {
    const template = this.exportToVsCodeTemplate(id)
    const profileStorage = this.getProfileStorage()
    if (!profileStorage?.readStorageData) return template
    const storageData = await profileStorage.readStorageData(id)
    if (!storageData.invalid) {
      return {
        ...template,
        globalState: createGlobalStateResourceContentFromEntries(storageData.entries),
      }
    }
    return template
  }

  upsertSnapshot(input: {
    id?: string
    name: string
    source?: ProfileSource
    settings: SettingsRecord
    keybindings?: VsCodeKeybindingEntry[]
    resources?: WorkbenchProfileResources
    activate?: boolean
  }): WorkbenchProfile {
    const now = this.now()
    const timestamp = now.toISOString()
    const existingIds = new Set(this.profileEntries.map((profile) => profile.id))
    const id = input.id && input.id.trim()
      ? input.id.trim()
      : createUserDataProfileId(input.name, existingIds, now)
    const existing = this.profileEntries.find((profile) => profile.id === id)
    const name = input.name.trim() || "未命名 Profile"
    const profile: WorkbenchProfile = {
      id,
      name,
      source: input.source ?? existing?.source ?? "manual",
      settings: sanitizeSettings(input.settings),
      keybindings: Array.isArray(input.keybindings) ? input.keybindings : existing?.keybindings ?? [],
      resources: input.resources ? sanitizeProfileResources(input.resources) : existing?.resources ?? {},
      userDataProfile: existing?.userDataProfile
        ? { ...existing.userDataProfile, name }
        : createProfileResource(id, name),
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    }

    this.profileEntries = existing
      ? this.profileEntries.map((entry) => (entry.id === id ? profile : entry))
      : [...this.profileEntries, profile]
    if (input.activate !== false) {
      this.activeProfileId = id
    }
    this.persist()
    this.fireProfilesChange(
      existing ? [] : [profile.userDataProfile],
      [],
      existing ? [profile.userDataProfile] : [],
    )
    if (input.activate !== false) {
      this.queueWorkspaceProfileAssociation(id)
      void this.currentProfileService.updateCurrentProfile(profile.userDataProfile)
    }
    this.recordProfileAction("upsert", profile)
    return this.clone(profile)
  }

  switchTo(id: string): WorkbenchProfile {
    const profile = this.profileEntries.find((entry) => entry.id === id)
    if (!profile) throw new Error(`Profile 不存在：${id}`)
    this.settingsStore.replaceUserSettingsForProfile(profile.id, profile.settings)
    this.activeProfileId = id
    this.persist()
    this.queueWorkspaceProfileAssociation(id)
    void this.currentProfileService.updateCurrentProfile(profile.userDataProfile)
    this.recordProfileAction("switch", profile)
    return this.clone(profile)
  }

  remove(id: string): void {
    const existing = this.profileEntries.find((profile) => profile.id === id)
    if (!existing) return
    const wasCurrentProfile = this.currentProfile.id === existing.userDataProfile.id
    this.profileEntries = this.profileEntries.filter((profile) => profile.id !== id)
    if (this.activeProfileId === id) {
      this.activeProfileId = ""
    }
    this.persist()
    this.fireProfilesChange([], [existing.userDataProfile], [])
    if (wasCurrentProfile) {
      void this.currentProfileService.updateCurrentProfile(DEFAULT_USER_DATA_PROFILE)
    }
    this.recordProfileAction("remove", existing)
  }

  private toSelectionItem(profile: WorkbenchProfile): WorkbenchProfileSelectionItem {
    const active = profile.id === this.activeProfileId
    return {
      id: profile.id,
      name: profile.name,
      source: profile.source,
      active,
      canSwitch: !active,
      settings: {
        count: Object.keys(profile.settings).length,
        colorTheme: String(profile.settings["workbench.colorTheme"] || ""),
        iconTheme: String(profile.settings["workbench.iconTheme"] || ""),
        sensitiveKeysRedacted: true,
      },
      keybindings: {
        count: profile.keybindings.length,
      },
      resources: {
        tasks: summarizeTasksResource(profile.resources.tasks),
        extensions: summarizeExtensionsResource(profile.resources.extensions),
      },
      action: {
        commandId: "workbench.profiles.switchProfile",
        args: [profile.id],
        evidenceSafe: true,
      },
      updatedAt: profile.updatedAt,
    }
  }

  private recordProfileAction(action: WorkbenchProfileActionEvidence["action"], profile: WorkbenchProfile): void {
    const tasks = summarizeTasksResource(profile.resources.tasks)
    const extensions = summarizeExtensionsResource(profile.resources.extensions)
    this.actionEvidence.push({
      action,
      profileId: profile.id,
      profileName: profile.name,
      activeProfileId: this.activeProfileId,
      settingsCount: Object.keys(profile.settings).length,
      tasksCount: tasks.count,
      extensionsCount: extensions.count,
      tokenRedacted: true,
      createdAt: Date.now(),
    })
  }

  private readProfiles(): WorkbenchProfile[] {
    if (!this.storage) return []
    try {
      const raw = this.storage.getItem(this.profilesKey)
      if (!raw) return []
      const parsed: unknown = JSON.parse(raw)
      const entries = Array.isArray(parsed) ? parsed : Array.isArray((parsed as any)?.profiles) ? (parsed as any).profiles : []
      return entries.map(normalizeProfile).filter(Boolean) as WorkbenchProfile[]
    } catch {
      return []
    }
  }

  private persist(): void {
    this.persistLocal()
    this.queueProfileStoragePersist()
  }

  private persistLocal(): void {
    const profiles = this.profileEntries.map((profile) => ({
      ...profile,
      userDataProfile: serializeUserDataProfile(profile.userDataProfile) as SerializedUserDataProfile,
    }))
    this.storage?.setItem(this.profilesKey, JSON.stringify({ profiles }, null, 2))
    if (this.activeProfileId) {
      this.storage?.setItem(this.activeKey, this.activeProfileId)
    } else {
      this.storage?.removeItem(this.activeKey)
    }
  }

  private queueProfileStoragePersist(): void {
    const profileStorage = this.getProfileStorage()
    if (!profileStorage) return
    const snapshot = this.serializeStorageSnapshot()
    this.profileStorageWriteChain = this.profileStorageWriteChain
      .catch(() => undefined)
      .then(() => profileStorage.write(snapshot))
      .then(() => undefined)
      .catch(() => undefined)
    this.pendingProfileStorageWrite = this.profileStorageWriteChain
  }

  private getProfileStorage(): WorkbenchProfilesStorageClient | null {
    if (!this.profileStorage && this.usesDefaultProfileStorage) {
      this.profileStorage = getDefaultProfileStorage()
    }
    return this.profileStorage
  }

  private getActiveProfileEntry(): WorkbenchProfile | null {
    return this.profileEntries.find((entry) => entry.id === this.activeProfileId) ?? null
  }

  private fireProfilesChange(added: UserDataProfile[], removed: UserDataProfile[], updated: UserDataProfile[]): void {
    this.profilesService.updateProfiles({
      added,
      removed,
      updated,
    })
  }

  private serializeStorageSnapshot(): WorkbenchProfilesStorageSnapshot {
    const validProfileIds = new Set(this.profileEntries.map((profile) => profile.id))
    this.profileAssociations = filterProfileAssociations(this.profileAssociations, validProfileIds)
    return {
      version: 2,
      profiles: this.profileEntries.map((profile) => ({
        ...profile,
        userDataProfile: serializeUserDataProfile(profile.userDataProfile) as SerializedUserDataProfile,
      })),
      activeProfileId: this.activeProfileId,
      workspace: this.currentWorkspaceIdentifier ?? undefined,
      profileAssociations: this.profileAssociations,
    }
  }

  private async doHydrateFromProfileStorage(): Promise<boolean> {
    const profileStorage = this.getProfileStorage()
    if (!profileStorage) return false
    const workspace = normalizeWorkspaceIdentifier(await this.getWorkspaceIdentifier())
    this.currentWorkspaceIdentifier = workspace
    const snapshot = await profileStorage.read({ workspace })
    this.profileAssociations = normalizeProfileAssociations(snapshot.profileAssociations)
    if (!snapshot.exists || snapshot.invalid) {
      if (this.profileEntries.length > 0 || this.activeProfileId) {
        this.queueProfileStoragePersist()
      }
      return false
    }
    const entries = Array.isArray(snapshot.profiles)
      ? snapshot.profiles.map(normalizeProfile).filter(Boolean) as WorkbenchProfile[]
      : []
    const associatedEntries = applyProfileAssociationsToEntries(entries, this.profileAssociations)
    const workspaceProfileId = typeof snapshot.workspaceProfileId === "string" ? snapshot.workspaceProfileId : ""
    const activeProfileId = associatedEntries.some((profile) => profile.id === workspaceProfileId)
      ? workspaceProfileId
      : (typeof snapshot.activeProfileId === "string" ? snapshot.activeProfileId : "")
    const changed = this.applyHydratedProfiles(associatedEntries, activeProfileId)
    this.persistLocal()
    return changed
  }

  private queueWorkspaceProfileAssociation(profileId: string): void {
    const profileStorage = this.getProfileStorage()
    if (!profileStorage?.setProfileForWorkspace) return
    const pendingPersist = this.pendingProfileStorageWrite ?? Promise.resolve()
    const associationWrite = pendingPersist
      .catch(() => undefined)
      .then(async () => {
        const workspace = normalizeWorkspaceIdentifier(await this.getWorkspaceIdentifier())
        if (!workspace) return
        this.currentWorkspaceIdentifier = workspace
        const snapshot = await profileStorage.setProfileForWorkspace?.(workspace, profileId)
        this.profileAssociations = normalizeProfileAssociations(snapshot?.profileAssociations)
        this.profileEntries = applyProfileAssociationsToEntries(this.profileEntries, this.profileAssociations)
        this.profilesService.updateProfiles({
          updated: this.profileEntries.map((profile) => profile.userDataProfile),
        })
        void this.currentProfileService.updateCurrentProfile(this.getActiveProfileEntry()?.userDataProfile ?? DEFAULT_USER_DATA_PROFILE)
      })
      .catch(() => undefined)
    this.pendingWorkspaceAssociationWrite = associationWrite
  }

  private queueProfileScopedGlobalStatePersist(profileId: string, globalState: string | undefined): void {
    const profileStorage = this.getProfileStorage()
    if (!profileStorage?.updateStorageData || !globalState) return
    const data = parseGlobalStateStorageEntries(globalState)
    if (Object.keys(data).length === 0) return
    const pendingPersist = this.pendingProfileStorageWrite ?? Promise.resolve()
    const storageWrite = pendingPersist
      .catch(() => undefined)
      .then(() => profileStorage.updateStorageData?.(profileId, { data, target: 0, scope: 0 }))
      .then(() => undefined)
      .catch(() => undefined)
    this.pendingProfileScopedStorageWrite = storageWrite
  }

  private applyHydratedProfiles(entries: WorkbenchProfile[], activeProfileId: string): boolean {
    const previousEntries = this.profileEntries
    const previousActive = this.activeProfileId
    const nextActive = entries.some((profile) => profile.id === activeProfileId) ? activeProfileId : ""
    const changed = JSON.stringify(this.serializeComparableProfiles(previousEntries, previousActive)) !==
      JSON.stringify(this.serializeComparableProfiles(entries, nextActive))
    if (!changed) return false

    const previousById = new Map(previousEntries.map((profile) => [profile.id, profile]))
    const nextById = new Map(entries.map((profile) => [profile.id, profile]))
    const added = entries
      .filter((profile) => !previousById.has(profile.id))
      .map((profile) => profile.userDataProfile)
    const removed = previousEntries
      .filter((profile) => !nextById.has(profile.id))
      .map((profile) => profile.userDataProfile)
    const updated = entries
      .filter((profile) => {
        const previous = previousById.get(profile.id)
        return previous && JSON.stringify(this.serializeComparableProfile(previous)) !== JSON.stringify(this.serializeComparableProfile(profile))
      })
      .map((profile) => profile.userDataProfile)

    this.profileEntries = entries
    this.activeProfileId = nextActive
    this.fireProfilesChange(added, removed, updated)
    void this.currentProfileService.updateCurrentProfile(this.getActiveProfileEntry()?.userDataProfile ?? DEFAULT_USER_DATA_PROFILE)
    return true
  }

  private serializeComparableProfiles(entries: WorkbenchProfile[], activeProfileId: string): unknown {
    return {
      activeProfileId,
      profiles: entries.map((profile) => this.serializeComparableProfile(profile)),
    }
  }

  private serializeComparableProfile(profile: WorkbenchProfile): unknown {
    return {
      ...profile,
      userDataProfile: serializeUserDataProfile(profile.userDataProfile),
    }
  }

  private clone(profile: WorkbenchProfile): WorkbenchProfile {
    return {
      ...profile,
      settings: { ...profile.settings },
      keybindings: [...profile.keybindings],
      resources: { ...profile.resources },
      userDataProfile: cloneUserDataProfile(profile.userDataProfile),
    }
  }
}

function getDefaultProfileStorage(): WorkbenchProfilesStorageClient | null {
  if (typeof window === "undefined") return null
  return window.codek && typeof window.codek.api === "function" ? userDataProfileStorageClient : null
}

export const workbenchProfileStore = new WorkbenchProfileStore()
