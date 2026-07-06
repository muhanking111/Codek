import { describe, expect, it, vi } from "vitest"
import { SettingsStore, type SettingsStorage } from "../settings/settingsStore"
import { loadExtensionConfigurationDefaults } from "./configurationDefaults"

class MemoryStorage implements SettingsStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function createStore(): SettingsStore {
  return new SettingsStore({
    storage: new MemoryStorage(),
    userKey: "ext-defaults-user",
    workspaceKeyPrefix: "ext-defaults-workspace:",
    unknownKey: "ext-defaults-unknown",
  })
}

describe("extension configuration defaults bridge", () => {
  it("loads contributed defaults into the settings store below user settings", async () => {
    const store = createStore()
    store.set("editor.fontSize", 18)
    const getMock = vi.fn(async (_path: string) => ({
      defaults: {
        "editor.fontSize": 13,
        "codek.sample.enabled": true,
        "[typescript]": { "editor.tabSize": 2 },
      },
      sources: [{ extensionId: "codek.sample", displayName: "Sample", keys: ["editor.fontSize"] }],
    }))
    const get = async <T = unknown>(path: string): Promise<T> => {
      return getMock(path) as Promise<T>
    }

    const result = await loadExtensionConfigurationDefaults({
      settingsStore: store,
      apiClient: {
        get,
      },
    })

    expect(result.ok).toBe(true)
    expect(result.appliedKeys).toBe(3)
    expect(store.get("editor.fontSize")).toBe(18)
    expect(store.get("codek.sample.enabled")).toBe(true)
    expect(store.get("editor.tabSize")).toBe(2)
  })

  it("does not throw when the extension host API is unavailable", async () => {
    const store = createStore()
    const getMock = vi.fn(async (_path: string) => {
      throw new Error("Codek API not available")
    })
    const get = async <T = unknown>(path: string): Promise<T> => {
      return getMock(path) as Promise<T>
    }

    const result = await loadExtensionConfigurationDefaults({
      settingsStore: store,
      apiClient: {
        get,
      },
    })

    expect(result.ok).toBe(false)
    expect(result.appliedKeys).toBe(0)
    expect(result.error).toContain("Codek API not available")
    expect(store.getExtensionDefaultSettings()).toEqual({})
  })
})
