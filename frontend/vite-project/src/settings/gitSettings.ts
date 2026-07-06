export interface GitSettings {
  enabled: boolean
  autofetch: boolean
  autoStage: boolean
}

export type SettingsRecord = Record<string, unknown>

export function getGitSettings(settings: SettingsRecord): GitSettings {
  return {
    enabled: booleanValue(settings["git.enabled"], true),
    autofetch: booleanValue(settings["git.autofetch"], true),
    autoStage: booleanValue(settings["git.autoStage"], false),
  }
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}
