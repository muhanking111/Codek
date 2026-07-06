import { settingsStore } from "./settingsStore"

export interface ExtensionSettings {
  autoUpdate: boolean
  ignoreRecommendations: boolean
}

export function getExtensionSettings(settings = settingsStore.getAll()): ExtensionSettings {
  return {
    autoUpdate: settings["extensions.autoUpdate"] !== false,
    ignoreRecommendations: settings["extensions.ignoreRecommendations"] === true,
  }
}
