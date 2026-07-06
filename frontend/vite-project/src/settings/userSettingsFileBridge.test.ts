import { describe, expect, it, vi } from "vitest"
import { SettingsStore, type SettingsStorage } from "./settingsStore"
import { installUserSettingsFileBridge } from "./userSettingsFileBridge"

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
    userKey: "bridge:user",
    workspaceKeyPrefix: "bridge:workspace:",
    unknownKey: "bridge:unknown",
  })
}

describe("userSettingsFileBridge", () => {
  it("hydrates the renderer settings store from the VS Code-style User/settings.json file", async () => {
    const store = createStore()
    const bridge = installUserSettingsFileBridge({
      settingsStore: store,
      codek: null,
      readSettingsFile: async () => ({
        path: "D:/Workspace/User/settings.json",
        settings: {
          "editor.fontSize": 20,
          "workbench.iconTheme": "vs-seti",
          "workbench.productIconTheme": "Default",
        },
      }),
    })

    await expect(bridge.hydrate()).resolves.toBe(true)

    expect(store.get("editor.fontSize")).toBe(20)
    expect(store.get("workbench.iconTheme")).toBe("vs-seti")
    expect(store.get("workbench.productIconTheme")).toBe("Default")
    expect(store.getUserSettings()).toEqual({
      "editor.fontSize": 20,
      "workbench.iconTheme": "vs-seti",
      "workbench.productIconTheme": "Default",
    })
  })

  it("projects desktop settings change broadcasts into configuration listeners", async () => {
    const store = createStore()
    let listener: ((payload: unknown) => void) | undefined
    const unsubscribe = vi.fn()
    const events: string[][] = []

    store.onDidChangeConfiguration((event) => {
      events.push([...event.affectedKeys])
    })
    const bridge = installUserSettingsFileBridge({
      settingsStore: store,
      codek: {
        onUserSettingsChanged(callback) {
          listener = callback as (payload: unknown) => void
          return unsubscribe
        },
      },
      readSettingsFile: async () => ({
        path: "D:/Workspace/User/settings.json",
        settings: {},
      }),
    })

    listener?.({
      settings: {
        "workbench.colorTheme": "light",
        "workbench.iconTheme": "minimal",
        "workbench.productIconTheme": "Default",
      },
    })

    expect(store.get("workbench.colorTheme")).toBe("light")
    expect(store.get("workbench.iconTheme")).toBe("minimal")
    expect(store.get("workbench.productIconTheme")).toBe("Default")
    expect(events.at(-1)).toEqual(["workbench.colorTheme", "workbench.iconTheme", "workbench.productIconTheme"])

    bridge.dispose()
    listener?.({ settings: { "workbench.colorTheme": "dark" } })
    expect(store.get("workbench.colorTheme")).toBe("light")
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
