import type { InstalledPlugin, PluginManifest, PluginEvent, PluginEventListener } from "./types"

const STORAGE_KEY = "codek.plugins.v2"
const EVENTS_KEY = "codek.pluginEvents.v1"
const SETTINGS_KEY = "codek.pluginSettings.v1"

let _registry: InstalledPlugin[] | null = null
const _listeners = new Set<PluginEventListener>()

export function getInstalledPlugins(): InstalledPlugin[] {
  if (_registry) return _registry
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      _registry = JSON.parse(raw) as InstalledPlugin[]
      return _registry
    }
  } catch { /* ignore */ }
  _registry = []
  return _registry
}

export function installPlugin(manifest: PluginManifest, installPath: string, source: InstalledPlugin["installSource"] = "marketplace"): InstalledPlugin {
  const registry = getInstalledPlugins()
  const now = Date.now()
  const existingIndex = registry.findIndex((p) => p.manifest.id === manifest.id)

  const entry: InstalledPlugin = {
    manifest,
    installedAt: now,
    updatedAt: now,
    installPath,
    installSource: source,
    enabled: true,
    pinned: false,
  }

  if (existingIndex >= 0) {
    entry.installedAt = registry[existingIndex].installedAt
    registry[existingIndex] = entry
  } else {
    registry.push(entry)
  }

  persist()
  emitEvent({ type: "install", pluginId: manifest.id, timestamp: now })
  return entry
}

export function updateInstalledPluginManifest(manifest: PluginManifest): InstalledPlugin | null {
  const registry = getInstalledPlugins()
  const plugin = registry.find((p) => p.manifest.id === manifest.id)
  if (!plugin) return null

  plugin.manifest = manifest
  plugin.updatedAt = Date.now()
  persist()
  emitEvent({ type: "update", pluginId: manifest.id, timestamp: plugin.updatedAt })
  return plugin
}

export function uninstallPlugin(pluginId: string): boolean {
  const registry = getInstalledPlugins()
  const idx = registry.findIndex((p) => p.manifest.id === pluginId)
  if (idx < 0) return false
  registry.splice(idx, 1)
  persist()
  emitEvent({ type: "uninstall", pluginId, timestamp: Date.now() })
  return true
}

export function setPluginEnabled(pluginId: string, enabled: boolean): void {
  const registry = getInstalledPlugins()
  const plugin = registry.find((p) => p.manifest.id === pluginId)
  if (!plugin || plugin.enabled === enabled) return
  plugin.enabled = enabled
  persist()
  emitEvent({ type: enabled ? "enable" : "disable", pluginId, timestamp: Date.now() })
}

export function togglePlugin(pluginId: string): boolean {
  const plugin = getPlugin(pluginId)
  if (!plugin) return false
  setPluginEnabled(pluginId, !plugin.enabled)
  return !plugin.enabled
}

export function setPluginPinned(pluginId: string, pinned: boolean): void {
  const registry = getInstalledPlugins()
  const plugin = registry.find((p) => p.manifest.id === pluginId)
  if (!plugin) return
  plugin.pinned = pinned
  persist()
}

export function isPluginInstalled(pluginId: string): boolean {
  return getInstalledPlugins().some((p) => p.manifest.id === pluginId)
}

export function isPluginEnabled(pluginId: string): boolean {
  const plugin = getPlugin(pluginId)
  return plugin?.enabled === true
}

export function getPlugin(pluginId: string): InstalledPlugin | undefined {
  return getInstalledPlugins().find((p) => p.manifest.id === pluginId)
}

export function getEnabledPlugins(): InstalledPlugin[] {
  return getInstalledPlugins().filter((p) => p.enabled)
}

export function getPluginsForLanguage(language: string): InstalledPlugin[] {
  return getEnabledPlugins().filter((p) => {
    const m = p.manifest
    return m.language === language
      || m.languages?.includes(language)
      || m.contributes.languages?.some((l) => l.id === language || l.extensions.includes(`.${language}`))
  })
}

export function getPluginsByCategory(category: string): InstalledPlugin[] {
  return getEnabledPlugins().filter((p) => p.manifest.categories.includes(category as never))
}

export function getPluginSettings(pluginId: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return {}
    const all = JSON.parse(raw)
    return all[pluginId] || {}
  } catch { return {} }
}

export function setPluginSetting(pluginId: string, key: string, value: unknown): void {
  const all = getPluginAllSettings()
  if (!all[pluginId]) all[pluginId] = {}
  all[pluginId][key] = value
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(all))
}

function getPluginAllSettings(): Record<string, Record<string, unknown>> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export function getInstalledCount(): number {
  return getInstalledPlugins().length
}

export function getEnabledCount(): number {
  return getEnabledPlugins().length
}

export function onPluginEvent(listener: PluginEventListener): () => void {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

function emitEvent(event: PluginEvent): void {
  for (const listener of _listeners) {
    try { listener(event) } catch { /* ignore */ }
  }
  appendEventLog(event)
}

function appendEventLog(event: PluginEvent): void {
  try {
    const raw = localStorage.getItem(EVENTS_KEY)
    const events: PluginEvent[] = raw ? JSON.parse(raw) : []
    events.push(event)
    if (events.length > 200) events.splice(0, events.length - 200)
    localStorage.setItem(EVENTS_KEY, JSON.stringify(events))
  } catch { /* ignore */ }
}

export function getPluginEvents(): PluginEvent[] {
  try {
    const raw = localStorage.getItem(EVENTS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function clearPluginCache(): void {
  _registry = null
}

function persist(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(_registry))
}
