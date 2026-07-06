import type { WorkspaceSettings } from "../workspace/workspaceSettings"

export type SettingsRecord = Record<string, unknown>

export interface ImportSettingsResult {
  applied: SettingsRecord
  unknown: SettingsRecord
}

export const LEGACY_WORKSPACE_TO_SETTINGS_KEY = {
  "editor.fontSize": "editor.fontSize",
  "editor.fontFamily": "editor.fontFamily",
  "editor.tabSize": "editor.tabSize",
  "editor.wordWrap": "editor.wordWrap",
  "editor.formatOnSave": "editor.formatOnSave",
  "editor.lintOnSave": "codek.editor.lintOnSave",
  "editor.minimap": "editor.minimap.enabled",
  "editor.bracketPairColorization": "editor.bracketPairColorization.enabled",
  "files.encoding": "files.encoding",
  "files.eol": "files.eol",
  "files.autoSave": "files.autoSave",
  "files.autoSaveDelay": "files.autoSaveDelay",
  "files.excludeGlob": "files.exclude",
  "search.includeGlob": "search.include",
  "search.excludeGlob": "search.exclude",
  "git.autoStage": "git.autoStage",
  "git.commitTemplate": "codek.git.commitTemplate",
  "ai.provider": "codek.ai.provider",
  "ai.model": "codek.ai.model",
  "ai.temperature": "codek.ai.temperature",
  "ai.qualityGateCommands": "codek.agent.qualityGateCommands",
} as const

export const VSCODE_COMPAT_ALIASES: Record<string, string> = {
  "workbench.colorTheme": "workbench.colorTheme",
  "workbench.iconTheme": "workbench.iconTheme",
  "workbench.productIconTheme": "workbench.productIconTheme",
  "workbench.activityBar.visible": "workbench.activityBar.visible",
  "workbench.statusBar.visible": "workbench.statusBar.visible",
  "workbench.sideBar.location": "workbench.sideBar.location",
  "workbench.panel.defaultLocation": "workbench.panel.defaultLocation",
  "editor.fontSize": "editor.fontSize",
  "editor.fontFamily": "editor.fontFamily",
  "editor.tabSize": "editor.tabSize",
  "editor.insertSpaces": "editor.insertSpaces",
  "editor.wordWrap": "editor.wordWrap",
  "editor.minimap.enabled": "editor.minimap.enabled",
  "editor.lineNumbers": "editor.lineNumbers",
  "editor.renderWhitespace": "editor.renderWhitespace",
  "editor.bracketPairColorization.enabled": "editor.bracketPairColorization.enabled",
  "editor.formatOnSave": "editor.formatOnSave",
  "editor.formatOnPaste": "editor.formatOnPaste",
  "files.autoSave": "files.autoSave",
  "files.autoSaveDelay": "files.autoSaveDelay",
  "files.encoding": "files.encoding",
  "files.eol": "files.eol",
  "files.trimTrailingWhitespace": "files.trimTrailingWhitespace",
  "files.insertFinalNewline": "files.insertFinalNewline",
  "files.exclude": "files.exclude",
  "search.include": "search.include",
  "search.exclude": "search.exclude",
  "terminal.integrated.defaultProfile.windows": "terminal.integrated.defaultProfile.windows",
  "terminal.integrated.fontFamily": "terminal.integrated.fontFamily",
  "terminal.integrated.fontSize": "terminal.integrated.fontSize",
  "terminal.integrated.scrollback": "terminal.integrated.scrollback",
  "git.enabled": "git.enabled",
  "git.autofetch": "git.autofetch",
  "git.autoStage": "git.autoStage",
  "extensions.autoUpdate": "extensions.autoUpdate",
  "extensions.ignoreRecommendations": "extensions.ignoreRecommendations",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function flattenObject(value: Record<string, unknown>, prefix = ""): SettingsRecord {
  const out: SettingsRecord = {}
  for (const [key, entry] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key
    if (isRecord(entry)) {
      Object.assign(out, flattenObject(entry, nextKey))
    } else {
      out[nextKey] = entry
    }
  }
  return out
}

function setIfDefined(out: SettingsRecord, key: string, value: unknown): void {
  if (value !== undefined) out[key] = value
}

export function normalizeSettingsKey(key: string): string | null {
  if (key.startsWith("codek.")) return key
  return VSCODE_COMPAT_ALIASES[key] ?? null
}

export function splitKnownSettings(
  input: SettingsRecord,
  supportedKeys: ReadonlySet<string>,
): ImportSettingsResult {
  const applied: SettingsRecord = {}
  const unknown: SettingsRecord = {}

  for (const [key, value] of Object.entries(input)) {
    if (supportedKeys.has(key)) {
      applied[key] = value
      continue
    }
    const normalizedKey = normalizeSettingsKey(key)
    if (normalizedKey && supportedKeys.has(normalizedKey)) {
      applied[normalizedKey] = value
    } else {
      unknown[key] = value
    }
  }

  return { applied, unknown }
}

export function workspaceSettingsToSettingsRecord(settings: WorkspaceSettings): SettingsRecord {
  const flattened = flattenObject(settings as unknown as Record<string, unknown>)
  const out: SettingsRecord = {}
  for (const [legacyKey, value] of Object.entries(flattened)) {
    const nextKey = LEGACY_WORKSPACE_TO_SETTINGS_KEY[
      legacyKey as keyof typeof LEGACY_WORKSPACE_TO_SETTINGS_KEY
    ]
    setIfDefined(out, nextKey ?? legacyKey, value)
  }
  return out
}

export function normalizeWorkspaceStorageRecord(record: SettingsRecord): SettingsRecord {
  if (!isLegacyWorkspaceStorage(record)) return record
  return workspaceSettingsToSettingsRecord(record as unknown as WorkspaceSettings)
}

export function settingsRecordToWorkspaceSettings(
  settings: SettingsRecord,
  fallback: WorkspaceSettings,
): WorkspaceSettings {
  return {
    editor: {
      ...fallback.editor,
      tabSize: numberValue(settings["editor.tabSize"], fallback.editor.tabSize),
      fontSize: numberValue(settings["editor.fontSize"], fallback.editor.fontSize),
      fontFamily: stringValue(settings["editor.fontFamily"], fallback.editor.fontFamily),
      wordWrap: enumValue(settings["editor.wordWrap"], fallback.editor.wordWrap, [
        "off",
        "on",
        "wordWrapColumn",
      ]),
      formatOnSave: booleanValue(settings["editor.formatOnSave"], fallback.editor.formatOnSave),
      lintOnSave: booleanValue(settings["codek.editor.lintOnSave"], fallback.editor.lintOnSave),
      minimap: booleanValue(settings["editor.minimap.enabled"], fallback.editor.minimap),
      bracketPairColorization: booleanValue(
        settings["editor.bracketPairColorization.enabled"],
        fallback.editor.bracketPairColorization,
      ),
    },
    files: {
      ...fallback.files,
      encoding: stringValue(settings["files.encoding"], fallback.files.encoding),
      eol: enumValue(settings["files.eol"], fallback.files.eol, ["auto", "lf", "crlf"]),
      autoSave: enumValue(settings["files.autoSave"], fallback.files.autoSave, [
        "off",
        "afterDelay",
        "onFocusChange",
      ]),
      autoSaveDelay: numberValue(settings["files.autoSaveDelay"], fallback.files.autoSaveDelay),
      excludeGlob: stringArrayValue(settings["files.exclude"], fallback.files.excludeGlob),
    },
    search: {
      ...fallback.search,
      includeGlob: stringArrayValue(settings["search.include"], fallback.search.includeGlob),
      excludeGlob: stringArrayValue(settings["search.exclude"], fallback.search.excludeGlob),
    },
    git: {
      ...fallback.git,
      autoStage: booleanValue(settings["git.autoStage"], fallback.git.autoStage),
      commitTemplate: stringValue(settings["codek.git.commitTemplate"], fallback.git.commitTemplate),
    },
    ai: {
      ...fallback.ai,
      provider: stringValue(settings["codek.ai.provider"], fallback.ai.provider),
      model: stringValue(settings["codek.ai.model"], fallback.ai.model),
      temperature: numberValue(settings["codek.ai.temperature"], fallback.ai.temperature),
      qualityGateCommands: stringArrayValue(
        settings["codek.agent.qualityGateCommands"],
        fallback.ai.qualityGateCommands,
      ),
    },
  }
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

function stringArrayValue(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  return value.filter((item): item is string => typeof item === "string")
}

function enumValue<T extends string>(value: unknown, fallback: T, allowed: T[]): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback
}

function isLegacyWorkspaceStorage(record: SettingsRecord): boolean {
  return (
    isRecord(record.editor) ||
    isRecord(record.files) ||
    isRecord(record.search) ||
    isRecord(record.git) ||
    isRecord(record.ai)
  )
}
