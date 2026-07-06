import { api } from "../lib/api"
import type { SettingsRecord } from "./settingsCompat"

export interface UserSettingsFile {
  path: string
  settings: SettingsRecord
}

export async function readUserSettingsFile(): Promise<UserSettingsFile> {
  return api.get<UserSettingsFile>("/settings/user")
}

export async function writeUserSettingsFile(settings: SettingsRecord): Promise<UserSettingsFile> {
  return api.request<UserSettingsFile>("PUT", "/settings/user", { settings })
}

export async function patchUserSetting(key: string, value: unknown): Promise<UserSettingsFile> {
  return api.request<UserSettingsFile>("PATCH", "/settings/user", { key, value })
}
