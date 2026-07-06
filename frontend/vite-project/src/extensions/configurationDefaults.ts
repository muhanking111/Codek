import { api } from "../lib/api"
import { settingsStore as defaultSettingsStore, type SettingsStore } from "../settings/settingsStore"
import type { SettingsRecord } from "../settings/settingsCompat"

interface ConfigurationDefaultsSource {
  extensionId: string
  displayName: string
  keys: string[]
}

interface ConfigurationDefaultsResponse {
  defaults?: SettingsRecord
  sources?: ConfigurationDefaultsSource[]
  summary?: {
    extensions?: number
    keys?: number
  }
}

interface ApiClient {
  get<T = unknown>(path: string): Promise<T>
}

export interface LoadExtensionConfigurationDefaultsOptions {
  settingsStore?: SettingsStore
  apiClient?: ApiClient
}

export interface LoadExtensionConfigurationDefaultsResult {
  ok: boolean
  appliedKeys: number
  sources: ConfigurationDefaultsSource[]
  error?: string
}

export async function loadExtensionConfigurationDefaults(
  options: LoadExtensionConfigurationDefaultsOptions = {},
): Promise<LoadExtensionConfigurationDefaultsResult> {
  const store = options.settingsStore ?? defaultSettingsStore
  const client = options.apiClient ?? api

  try {
    const response = await client.get<ConfigurationDefaultsResponse>("/extensions-host/configuration-defaults")
    const defaults = response?.defaults && typeof response.defaults === "object" ? response.defaults : {}
    const sources = Array.isArray(response?.sources) ? response.sources : []
    const appliedKeys = Object.keys(defaults).length
    if (appliedKeys > 0) {
      store.registerExtensionConfigurationDefaults(defaults)
    }
    return { ok: true, appliedKeys, sources }
  } catch (error) {
    return {
      ok: false,
      appliedKeys: 0,
      sources: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
