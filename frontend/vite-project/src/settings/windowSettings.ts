import { settingsStore } from "./settingsStore"

export type RestoreWindowsMode = "all" | "folders" | "none"

export function getRestoreWindowsMode(settings = settingsStore.getAll()): RestoreWindowsMode {
  const value = settings["window.restoreWindows"]
  return value === "folders" || value === "none" ? value : "all"
}

export function shouldRestoreWorkspace(settings = settingsStore.getAll()): boolean {
  return getRestoreWindowsMode(settings) !== "none"
}
