import { beforeEach, describe, expect, it, vi } from "vitest"
import { readUserKeybindingsFile, writeUserKeybindingsFile } from "./keybindingsFileClient"

describe("keybindingsFileClient", () => {
  const apiCalls: Array<{ method: string; path: string; body?: unknown }> = []

  beforeEach(() => {
    apiCalls.length = 0
    window.codek = {
      api: vi.fn(async (method: string, path: string, body?: unknown) => {
        apiCalls.push({ method, path, body })
        if (method === "GET" && path === "/keybindings/user") {
          return {
            ok: true,
            data: {
              path: "D:/Workspace/User/keybindings.json",
              keybindings: [],
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

  it("reads the desktop keybindings.json file", async () => {
    const result = await readUserKeybindingsFile()

    expect(result.path).toBe("D:/Workspace/User/keybindings.json")
    expect(apiCalls[0]).toEqual({ method: "GET", path: "/keybindings/user", body: null })
  })

  it("writes VS Code style keybindings to the desktop file", async () => {
    const result = await writeUserKeybindingsFile([
      {
        key: "ctrl+s",
        command: "workbench.action.files.save",
        when: "editorTextFocus",
      },
    ])

    expect(result.keybindings).toEqual([
      {
        key: "ctrl+s",
        command: "workbench.action.files.save",
        when: "editorTextFocus",
      },
    ])
    expect(apiCalls[0]).toEqual({
      method: "PUT",
      path: "/keybindings/user",
      body: {
        keybindings: [
          {
            key: "ctrl+s",
            command: "workbench.action.files.save",
            when: "editorTextFocus",
          },
        ],
      },
    })
  })
})
