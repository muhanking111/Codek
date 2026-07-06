import { settingsStore } from "./settingsStore"

export type UpdateMode = "manual" | "check" | "download"

export interface UpdateSettings {
  mode: UpdateMode
  shouldCheck: boolean
  shouldDownload: boolean
}

export function getUpdateSettings(settings = settingsStore.getAll()): UpdateSettings {
  const value = settings["update.mode"]
  const mode: UpdateMode = value === "check" || value === "download" ? value : "manual"
  return {
    mode,
    shouldCheck: mode === "check" || mode === "download",
    shouldDownload: mode === "download",
  }
}

export async function runConfiguredUpdateCheck(): Promise<boolean> {
  const updateSettings = getUpdateSettings()
  if (!updateSettings.shouldCheck) return false

  const api = window.codek
  const request = api?.api
  if (typeof request !== "function") return false

  try {
    await request("POST", "/updates/check", {
      download: updateSettings.shouldDownload,
    })
    return true
  } catch {
    return false
  }
}
