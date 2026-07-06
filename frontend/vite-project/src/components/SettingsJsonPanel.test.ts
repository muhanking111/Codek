import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import SettingsJsonPanel from "./SettingsJsonPanel.vue"
import { settingsStore } from "../settings/settingsStore"

type ApiCall = { method: string; path: string; body?: unknown }

describe("SettingsJsonPanel", () => {
  const apiCalls: ApiCall[] = []

  beforeEach(() => {
    settingsStore.reset()
    apiCalls.length = 0
    window.codek = {
      api: vi.fn(async (method: string, path: string, body?: unknown) => {
        apiCalls.push({ method, path, body })
        if (method === "GET" && path === "/settings/user") {
          return {
            ok: true,
            data: {
              path: "D:/Workspace/User/settings.json",
              settings: {},
            },
          }
        }
        if (method === "PUT" && path === "/settings/user") {
          return {
            ok: true,
            data: {
              path: "D:/Workspace/User/settings.json",
              settings: (body as { settings?: unknown })?.settings ?? {},
            },
          }
        }
        return { ok: false, error: "unexpected request" }
      }),
    }
  })

  it("imports supported settings from JSON and writes the user settings file", async () => {
    const wrapper = mount(SettingsJsonPanel)
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("已加载 D:/Workspace/User/settings.json")
    })
    const textarea = wrapper.get("textarea")

    await textarea.setValue(
      JSON.stringify({
        "editor.fontSize": 24,
        "cursor.unknown": true,
      }),
    )
    await wrapper.get('[data-testid="settings-json-import"]').trigger("click")

    await vi.waitFor(() => {
      expect(apiCalls.some((call) => call.method === "PUT" && call.path === "/settings/user")).toBe(true)
    })
    expect(settingsStore.get("editor.fontSize")).toBe(24)
    expect(settingsStore.getUnknownSettings()).toEqual({ "cursor.unknown": true })
    expect(wrapper.text()).toContain("已应用 1 项")
  })

  it("shows a Chinese error when JSON is invalid", async () => {
    const wrapper = mount(SettingsJsonPanel)
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("已加载 D:/Workspace/User/settings.json")
    })

    await wrapper.get("textarea").setValue("[]")
    await wrapper.get('[data-testid="settings-json-import"]').trigger("click")

    expect(wrapper.text()).toContain("设置 JSON 必须是一个对象")
  })
})
