import type { ImportSettingsResult, SettingsRecord } from "./settingsCompat"
import { type SettingsScope, type SettingsStore, settingsStore } from "./settingsStore"

export interface ParseSettingsJsonResult {
  ok: boolean
  settings: SettingsRecord
  error?: string
}

export function parseSettingsJson(source: string): ParseSettingsJsonResult {
  try {
    const parsed: unknown = JSON.parse(source)
    if (!isRecord(parsed)) {
      return {
        ok: false,
        settings: {},
        error: "设置 JSON 必须是一个对象。",
      }
    }
    return { ok: true, settings: parsed }
  } catch (error) {
    return {
      ok: false,
      settings: {},
      error: error instanceof Error ? error.message : "JSON 解析失败。",
    }
  }
}

export function stringifySettingsJson(settings: SettingsRecord): string {
  return `${JSON.stringify(sortRecord(settings), null, 2)}\n`
}

export function importSettingsJson(
  source: string,
  scope: SettingsScope = "user",
  store: SettingsStore = settingsStore,
): ImportSettingsResult & { ok: boolean; error?: string } {
  const parsed = parseSettingsJson(source)
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error,
      applied: {},
      unknown: {},
    }
  }
  return {
    ok: true,
    ...store.importSettings(parsed.settings, scope),
  }
}

function sortRecord(record: SettingsRecord): SettingsRecord {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
}

function isRecord(value: unknown): value is SettingsRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
