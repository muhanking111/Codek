import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import KeybindingSettings from "./KeybindingSettings.vue"
import {
  clearKeybindings,
  getKeybindingForCommand,
  registerKeybinding,
  resetAllKeybindings,
} from "../keybindings"

type ApiCall = { method: string; path: string; body?: unknown }

function registerTestCommand(id: string, key: string, description = id): void {
  registerKeybinding({
    id,
    key,
    ctrl: true,
    shift: false,
    alt: false,
    description,
    action: () => {},
  })
}

describe("KeybindingSettings", () => {
  const apiCalls: ApiCall[] = []

  beforeEach(() => {
    localStorage.clear()
    resetAllKeybindings()
    clearKeybindings()
    apiCalls.length = 0
    registerTestCommand("workbench.action.files.save", "s", "保存")
    window.codek = {
      api: vi.fn(async (method: string, path: string, body?: unknown) => {
        apiCalls.push({ method, path, body })
        if (method === "GET" && path === "/keybindings/user") {
          return {
            ok: true,
            data: {
              path: "D:/Workspace/User/keybindings.json",
              keybindings: [
                {
                  key: "ctrl+shift+s",
                  command: "workbench.action.files.save",
                  when: "editorTextFocus",
                },
              ],
            },
          }
        }
        if (method === "PUT" && path === "/keybindings/user") {
          return {
            ok: true,
            data: {
              path: "D:/Workspace/User/keybindings.json",
              keybindings: (body as { keybindings?: unknown })?.keybindings ?? [],
            },
          }
        }
        return { ok: false, error: "unexpected request" }
      }),
    }
  })

  it("loads desktop keybindings.json on mount", async () => {
    const wrapper = mount(KeybindingSettings)

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("D:/Workspace/User/keybindings.json")
    })

    expect(apiCalls[0]).toEqual({ method: "GET", path: "/keybindings/user", body: null })
    expect(getKeybindingForCommand("workbench.action.files.save")).toMatchObject({
      key: "s",
      ctrl: true,
      shift: true,
      alt: false,
    })
  })

  it("writes the desktop keybindings.json after importing JSON", async () => {
    const wrapper = mount(KeybindingSettings)
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("D:/Workspace/User/keybindings.json")
    })

    await wrapper.get("textarea").setValue(
      JSON.stringify([
        {
          key: "ctrl+alt+s",
          command: "workbench.action.files.save",
        },
      ]),
    )
    await wrapper.get('[data-testid="keybindings-json-import"]').trigger("click")

    await vi.waitFor(() => {
      expect(apiCalls.some((call) => call.method === "PUT" && call.path === "/keybindings/user")).toBe(true)
    })
    const putCall = apiCalls.find((call) => call.method === "PUT" && call.path === "/keybindings/user")
    expect(putCall?.body).toEqual({
      keybindings: [
        {
          key: "ctrl+alt+s",
          command: "workbench.action.files.save",
        },
      ],
    })
  })
})
