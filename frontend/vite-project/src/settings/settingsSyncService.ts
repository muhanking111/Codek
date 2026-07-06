// VS Code source adapter.
// Source references:
// - src/vs/platform/storage/common/storage.ts
// - src/vs/platform/userDataSync/common/userDataSync.ts
//
// Codek keeps Settings Sync local-only for now. This service mirrors the VS Code
// sync resource/profile contract without wiring any external sync store.

import {
  workbenchProfileStore,
  type UserDataProfileTemplate,
  type WorkbenchProfile,
  type WorkbenchProfileResourceKey,
  type WorkbenchProfileStore,
} from "./profileStore"

export const enum CodekStorageScope {
  APPLICATION_SHARED = -2,
  APPLICATION = -1,
  PROFILE = 0,
  WORKSPACE = 1,
}

export const enum CodekStorageTarget {
  USER = 0,
  MACHINE = 1,
}

export type SettingsSyncResource = "settings" | "keybindings" | WorkbenchProfileResourceKey | "profiles"
export type SettingsSyncPreviewAuthority = "base" | "local" | "remote" | "accepted"
export type SettingsSyncChangeKind = "none" | "modified"

export interface SettingsSyncConflictSetting {
  key: string
  localValue: unknown
  remoteValue: unknown
}

export interface SettingsSyncPreviewInput {
  localContent: string | null
  remoteContent: string | null
  baseContent: string | null
  ignoredSettings?: string[]
}

export interface SettingsSyncPreviewResource {
  authority: SettingsSyncPreviewAuthority
  resource: string
  content: string | null
}

export interface SettingsSyncMergePreview {
  content: string | null
  localChange: SettingsSyncChangeKind
  remoteChange: SettingsSyncChangeKind
  hasConflicts: boolean
  conflictsSettings: SettingsSyncConflictSetting[]
}

export interface SettingsSyncSourceParity {
  settingsMerge: "src/vs/platform/userDataSync/common/settingsMerge.ts"
  settingsSync: "src/vs/platform/userDataSync/common/settingsSync.ts"
  settingsResource: "src/vs/workbench/services/userDataProfile/browser/settingsResource.ts"
}

export interface SettingsSyncPreviewResult {
  status: "preview"
  source: "settingsSync"
  localOnly: true
  externalSync: false
  sourceParity: SettingsSyncSourceParity
  resources: SettingsSyncPreviewResource[]
  preview: SettingsSyncMergePreview
  acceptedContent: string | null
  createdAt: string
}

export interface SettingsSyncAcceptResult {
  content: string | null
  localChange: SettingsSyncChangeKind
  remoteChange: SettingsSyncChangeKind
}

interface SettingsMergeContentResult {
  localContent: string | null
  remoteContent: string | null
  content: string | null
  hasConflicts: boolean
  conflictsSettings: SettingsSyncConflictSetting[]
}

const SETTINGS_SYNC_SOURCE_PARITY: SettingsSyncSourceParity = {
  settingsMerge: "src/vs/platform/userDataSync/common/settingsMerge.ts",
  settingsSync: "src/vs/platform/userDataSync/common/settingsSync.ts",
  settingsResource: "src/vs/workbench/services/userDataProfile/browser/settingsResource.ts",
}

export interface LocalSettingsSyncPayload {
  version: 1
  source: "codek-local"
  activeProfileId: string
  exportedAt: string
  resources: SettingsSyncResource[]
  template: UserDataProfileTemplate
}

export interface SettingsSyncEvidenceProjection {
  id: string
  source: "settingsSync"
  localOnly: true
  externalSync: false
  reversible: boolean
  resources: SettingsSyncResource[]
  changedResources: SettingsSyncResource[]
  activeProfileIdBefore: string
  activeProfileIdAfter: string
  createdAt: string
}

export interface SettingsSyncRollbackProjection {
  profileBefore: WorkbenchProfile | null
  activeProfileIdBefore: string
  restoreHint: string
}

export interface SettingsSyncImportInput {
  template: UserDataProfileTemplate
  id?: string
  activate?: boolean
}

export interface SettingsSyncDryRunResult {
  status: "dryRun"
  profileId: string
  profileName: string
  evidence: SettingsSyncEvidenceProjection
  rollback: SettingsSyncRollbackProjection
}

export interface SettingsSyncImportResult {
  status: "imported"
  profile: WorkbenchProfile
  evidence: SettingsSyncEvidenceProjection
  rollback: SettingsSyncRollbackProjection
}

export interface SettingsSyncExportResult {
  status: "exported"
  payload: LocalSettingsSyncPayload
  evidence: SettingsSyncEvidenceProjection
}

export interface SettingsSyncServiceOptions {
  profileStore?: WorkbenchProfileStore
  now?: () => Date
}

export class SettingsSyncService {
  private readonly profileStore: WorkbenchProfileStore
  private readonly now: () => Date

  constructor(options: SettingsSyncServiceOptions = {}) {
    this.profileStore = options.profileStore ?? workbenchProfileStore
    this.now = options.now ?? (() => new Date())
  }

  async dryRunImport(input: SettingsSyncImportInput): Promise<SettingsSyncDryRunResult> {
    const normalized = this.normalizeImport(input)
    const profileBefore = normalized.id ? this.profileStore.getProfile(normalized.id) : null
    const activeProfileIdBefore = this.profileStore.getActiveProfileId()
    const activeProfileIdAfter = normalized.activate === false ? activeProfileIdBefore : normalized.id
    const changedResources = getChangedResources(normalized.template, profileBefore)
    return {
      status: "dryRun",
      profileId: normalized.id,
      profileName: normalized.template.name,
      evidence: this.createEvidence({
        changedResources,
        resources: getTemplateResources(normalized.template),
        activeProfileIdBefore,
        activeProfileIdAfter,
        reversible: true,
      }),
      rollback: createRollback(profileBefore, activeProfileIdBefore),
    }
  }

  async importProfile(input: SettingsSyncImportInput): Promise<SettingsSyncImportResult> {
    const dryRun = await this.dryRunImport(input)
    const profile = this.profileStore.importFromVsCodeTemplate({
      template: input.template,
      id: dryRun.profileId,
      source: "vscode",
      activate: input.activate ?? true,
    })
    return {
      status: "imported",
      profile,
      evidence: {
        ...dryRun.evidence,
        activeProfileIdAfter: this.profileStore.getActiveProfileId(),
      },
      rollback: dryRun.rollback,
    }
  }

  async exportProfile(profileId: string): Promise<SettingsSyncExportResult> {
    const profile = this.profileStore.getProfile(profileId)
    if (!profile) throw new Error(`Profile 不存在：${profileId}`)
    const template = await this.profileStore.exportToVsCodeTemplateAsync(profileId)
    const resources = getTemplateResources(template)
    const exportedAt = this.now().toISOString()
    return {
      status: "exported",
      payload: {
        version: 1,
        source: "codek-local",
        activeProfileId: profileId,
        exportedAt,
        resources,
        template,
      },
      evidence: this.createEvidence({
        changedResources: resources,
        resources,
        activeProfileIdBefore: this.profileStore.getActiveProfileId(),
        activeProfileIdAfter: this.profileStore.getActiveProfileId(),
        reversible: true,
        createdAt: exportedAt,
      }),
    }
  }

  previewSettingsMerge(input: SettingsSyncPreviewInput): SettingsSyncPreviewResult {
    const merge = mergeSettingsContent(input)
    const acceptedContent = merge.hasConflicts ? merge.content : merge.localContent ?? merge.remoteContent ?? merge.content
    const preview: SettingsSyncMergePreview = {
      content: merge.hasConflicts ? normalizeSettingsContent(input.baseContent) : acceptedContent,
      localChange: merge.localContent !== null ? "modified" : "none",
      remoteChange: merge.remoteContent !== null ? "modified" : "none",
      hasConflicts: merge.hasConflicts,
      conflictsSettings: merge.conflictsSettings,
    }

    return {
      status: "preview",
      source: "settingsSync",
      localOnly: true,
      externalSync: false,
      sourceParity: SETTINGS_SYNC_SOURCE_PARITY,
      resources: [
        createPreviewResource("base", input.baseContent),
        createPreviewResource("local", input.localContent),
        createPreviewResource("remote", input.remoteContent),
        createPreviewResource("accepted", preview.content),
      ],
      preview,
      acceptedContent: preview.content,
      createdAt: this.now().toISOString(),
    }
  }

  acceptSettingsMergePreview(
    preview: SettingsSyncPreviewResult,
    resource: SettingsSyncPreviewAuthority | "preview",
    content?: string | null,
  ): SettingsSyncAcceptResult {
    if (resource === "local") {
      return {
        content: getPreviewResourceContent(preview, "local"),
        localChange: "none",
        remoteChange: "modified",
      }
    }

    if (resource === "remote") {
      return {
        content: getPreviewResourceContent(preview, "remote"),
        localChange: "modified",
        remoteChange: "none",
      }
    }

    if (resource === "preview" || resource === "accepted") {
      return {
        content: content === undefined ? preview.acceptedContent : normalizeSettingsContent(content),
        localChange: preview.preview.hasConflicts || content !== undefined ? "modified" : preview.preview.localChange,
        remoteChange: preview.preview.hasConflicts || content !== undefined ? "modified" : preview.preview.remoteChange,
      }
    }

    throw new Error(`Settings Sync preview resource 不受支持：${resource}`)
  }

  private normalizeImport(input: SettingsSyncImportInput): Required<Pick<SettingsSyncImportInput, "id" | "template">> & Pick<SettingsSyncImportInput, "activate"> {
    const name = input.template?.name?.trim()
    if (!name) throw new Error("Settings Sync Profile 模板缺少名称")
    const id = input.id?.trim() || `settings-sync-${slugify(name)}-${this.now().getTime().toString(36)}`
    return {
      ...input,
      id,
      template: input.template,
    }
  }

  private createEvidence(input: {
    resources: SettingsSyncResource[]
    changedResources: SettingsSyncResource[]
    activeProfileIdBefore: string
    activeProfileIdAfter: string
    reversible: boolean
    createdAt?: string
  }): SettingsSyncEvidenceProjection {
    return {
      id: `settings-sync-${this.now().getTime().toString(36)}`,
      source: "settingsSync",
      localOnly: true,
      externalSync: false,
      reversible: input.reversible,
      resources: input.resources,
      changedResources: input.changedResources,
      activeProfileIdBefore: input.activeProfileIdBefore,
      activeProfileIdAfter: input.activeProfileIdAfter,
      createdAt: input.createdAt ?? this.now().toISOString(),
    }
  }
}

export const settingsSyncService = new SettingsSyncService()

export function runSettingsSyncDryRunThroughLegacyEntry(
  input: SettingsSyncImportInput,
  service: SettingsSyncService = settingsSyncService,
): Promise<SettingsSyncDryRunResult> {
  return service.dryRunImport(input)
}

export function importSettingsSyncThroughLegacyEntry(
  input: SettingsSyncImportInput,
  service: SettingsSyncService = settingsSyncService,
): Promise<SettingsSyncImportResult> {
  return service.importProfile(input)
}

export function exportSettingsSyncThroughLegacyEntry(
  profileId: string,
  service: SettingsSyncService = settingsSyncService,
): Promise<SettingsSyncExportResult> {
  return service.exportProfile(profileId)
}

function createRollback(profileBefore: WorkbenchProfile | null, activeProfileIdBefore: string): SettingsSyncRollbackProjection {
  return {
    profileBefore,
    activeProfileIdBefore,
    restoreHint: profileBefore
      ? "用 profileBefore 重新 upsert，并切回 activeProfileIdBefore。"
      : "删除本次导入的 profile，并切回 activeProfileIdBefore。",
  }
}

function getTemplateResources(template: UserDataProfileTemplate): SettingsSyncResource[] {
  const resources: SettingsSyncResource[] = []
  if (template.settings !== undefined) resources.push("settings")
  if (template.keybindings !== undefined) resources.push("keybindings")
  for (const key of ["tasks", "snippets", "globalState", "extensions", "mcp"] as const) {
    if (template[key] !== undefined) resources.push(key)
  }
  return resources
}

function getChangedResources(template: UserDataProfileTemplate, profileBefore: WorkbenchProfile | null): SettingsSyncResource[] {
  if (!profileBefore) return getTemplateResources(template)
  const changed: SettingsSyncResource[] = []
  if (template.settings !== undefined && normalizeResourceText(template.settings) !== normalizeResourceText(createSettingsResource(profileBefore))) {
    changed.push("settings")
  }
  if (template.keybindings !== undefined && normalizeResourceText(template.keybindings) !== normalizeResourceText(createKeybindingsResource(profileBefore))) {
    changed.push("keybindings")
  }
  for (const key of ["tasks", "snippets", "globalState", "extensions", "mcp"] as const) {
    if (template[key] !== undefined && template[key] !== profileBefore.resources[key]) changed.push(key)
  }
  return changed
}

function createSettingsResource(profile: WorkbenchProfile): string {
  return JSON.stringify({ settings: JSON.stringify(profile.settings || {}, null, 2) })
}

function createKeybindingsResource(profile: WorkbenchProfile): string {
  return JSON.stringify({ keybindings: JSON.stringify(profile.keybindings || [], null, 2) })
}

function normalizeResourceText(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value))
  } catch {
    return value
  }
}

function mergeSettingsContent(input: SettingsSyncPreviewInput): SettingsMergeContentResult {
  const ignored = new Set(input.ignoredSettings ?? [])
  const local = parseSettingsContent(input.localContent)
  const remote = parseSettingsContent(input.remoteContent)
  const base = parseSettingsContent(input.baseContent)
  const keys = new Set([
    ...Object.keys(local),
    ...Object.keys(remote),
    ...Object.keys(base),
  ].filter((key) => !ignored.has(key)))
  const merged: Record<string, unknown> = { ...local }
  const conflictsSettings: SettingsSyncConflictSetting[] = []
  let localChanged = false
  let remoteChanged = false

  for (const key of [...keys].sort()) {
    const baseHas = hasOwn(base, key)
    const localHas = hasOwn(local, key)
    const remoteHas = hasOwn(remote, key)
    const localForwarded = !settingsValuesEqual(base[key], local[key]) || baseHas !== localHas
    const remoteForwarded = !settingsValuesEqual(base[key], remote[key]) || baseHas !== remoteHas

    if (localForwarded && !remoteForwarded) {
      applyMergedSetting(merged, key, local, localHas)
      remoteChanged = true
      continue
    }

    if (remoteForwarded && !localForwarded) {
      applyMergedSetting(merged, key, remote, remoteHas)
      localChanged = true
      continue
    }

    if (!localForwarded && !remoteForwarded) {
      applyMergedSetting(merged, key, local, localHas)
      continue
    }

    if (localHas === remoteHas && settingsValuesEqual(local[key], remote[key])) {
      applyMergedSetting(merged, key, local, localHas)
      continue
    }

    conflictsSettings.push({
      key,
      localValue: localHas ? local[key] : undefined,
      remoteValue: remoteHas ? remote[key] : undefined,
    })
  }

  if (conflictsSettings.length > 0) {
    return {
      localContent: normalizeSettingsContent(input.localContent),
      remoteContent: normalizeSettingsContent(input.remoteContent),
      content: normalizeSettingsContent(input.baseContent),
      hasConflicts: true,
      conflictsSettings,
    }
  }

  const mergedContent = stringifySettingsContent(merged)
  return {
    localContent: localChanged ? mergedContent : null,
    remoteContent: remoteChanged ? mergedContent : null,
    content: mergedContent,
    hasConflicts: false,
    conflictsSettings: [],
  }
}

function parseSettingsContent(content: string | null): Record<string, unknown> {
  const normalized = normalizeSettingsContent(content)
  if (normalized === null) return {}
  const parsed = JSON.parse(normalized) as unknown
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Settings Sync preview 只支持 JSON object settings 内容")
  }
  return parsed as Record<string, unknown>
}

function normalizeSettingsContent(content: string | null | undefined): string | null {
  if (content === undefined || content === null) return null
  const trimmed = content.trim()
  return trimmed || "{}"
}

function createPreviewResource(authority: SettingsSyncPreviewAuthority, content: string | null): SettingsSyncPreviewResource {
  return {
    authority,
    resource: `codek-user-data-sync://${authority}/settings.json`,
    content: normalizeSettingsContent(content),
  }
}

function getPreviewResourceContent(preview: SettingsSyncPreviewResult, authority: SettingsSyncPreviewAuthority): string | null {
  return preview.resources.find((resource) => resource.authority === authority)?.content ?? null
}

function applyMergedSetting(target: Record<string, unknown>, key: string, source: Record<string, unknown>, sourceHasKey: boolean): void {
  if (sourceHasKey) {
    target[key] = source[key]
  } else {
    delete target[key]
  }
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function settingsValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeSettingsValue(left)) === JSON.stringify(normalizeSettingsValue(right))
}

function stringifySettingsContent(value: Record<string, unknown>): string {
  return JSON.stringify(sortRecord(value), null, 2)
}

function normalizeSettingsValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSettingsValue)
  if (typeof value === "object" && value !== null) return sortRecord(value as Record<string, unknown>)
  return value
}

function sortRecord(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    out[key] = normalizeSettingsValue(value[key])
  }
  return out
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "profile"
}
