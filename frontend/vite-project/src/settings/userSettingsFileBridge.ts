import { settingsStore as defaultSettingsStore, type SettingsStore } from "./settingsStore"
import { readUserSettingsFile } from "./settingsFileClient"
import type { SettingsRecord } from "./settingsCompat"

export interface UserSettingsFileChangeEvent {
  version?: number
  reason?: string
  path?: string
  changedKeys?: string[]
  settings?: SettingsRecord
}

export interface UserSettingsFileBridgeOptions {
  settingsStore?: SettingsStore
  codek?: Pick<CodekAPI, "onUserSettingsChanged"> | null
  readSettingsFile?: typeof readUserSettingsFile
}

export interface UserSettingsFileBridge {
  hydrate(): Promise<boolean>
  dispose(): void
}

export function installUserSettingsFileBridge(options: UserSettingsFileBridgeOptions = {}): UserSettingsFileBridge {
  const store = options.settingsStore ?? defaultSettingsStore
  const codek = options.codek ?? (typeof window !== "undefined" ? window.codek : null)
  const readSettingsFile = options.readSettingsFile ?? readUserSettingsFile
  let disposed = false

  store.enableUserFileSync(true)

  const unsubscribe = codek?.onUserSettingsChanged?.((event) => {
    if (disposed) return
    if (isSettingsRecord(event?.settings)) {
      store.replaceUserSettingsFromExternal(event.settings)
      return
    }
    void readSettingsFile().then((file) => {
      if (!disposed) store.replaceUserSettingsFromExternal(file.settings)
    }).catch(() => {})
  }) ?? null

  return {
    async hydrate() {
      try {
        const file = await readSettingsFile()
        if (disposed) return false
        store.replaceUserSettingsFromExternal(file.settings)
        return true
      } catch {
        return false
      }
    },
    dispose() {
      disposed = true
      unsubscribe?.()
      store.enableUserFileSync(false)
    },
  }
}

function isSettingsRecord(value: unknown): value is SettingsRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
