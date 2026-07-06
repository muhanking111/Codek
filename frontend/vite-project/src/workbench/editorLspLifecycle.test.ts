import { describe, expect, it, vi } from "vitest"
import {
  LSP_FILE_OPEN_NOTIFY_TIMEOUT_MS,
  notifyLspFileOpened,
  startEditorLsp,
} from "./editorLspLifecycle"

describe("editorLspLifecycle", () => {
  it("skips LSP startup when no project root is available", async () => {
    const setDetachLsp = vi.fn()
    const initLsp = vi.fn()

    const started = await startEditorLsp({
      projectRoot: "",
      monaco: {},
      editor: {},
      features: { initLsp },
      setDetachLsp,
    })

    expect(started).toBe(false)
    expect(initLsp).not.toHaveBeenCalled()
    expect(setDetachLsp).toHaveBeenCalledWith(null)
  })

  it("starts LSP and stores the Monaco registration disposable", async () => {
    const detach = vi.fn()
    const setDetachLsp = vi.fn()
    const monaco = { id: "monaco" }
    const editor = { id: "editor" }
    const initLsp = vi.fn(async () => true)
    const registerMonacoLsp = vi.fn(() => detach)

    const started = await startEditorLsp({
      projectRoot: "D:/Workspace",
      monaco,
      editor,
      features: { initLsp, registerMonacoLsp },
      setDetachLsp,
    })

    expect(started).toBe(true)
    expect(initLsp).toHaveBeenCalledWith("D:/Workspace")
    expect(registerMonacoLsp).toHaveBeenCalledWith(monaco, editor)
    expect(setDetachLsp).toHaveBeenCalledWith(detach)
  })

  it("keeps file-open notifications best effort", async () => {
    const openFile = vi.fn(async () => {
      throw new Error("offline")
    })

    await expect(notifyLspFileOpened(true, { openFile }, "src/App.vue", "<template />")).resolves.toBeUndefined()
    expect(openFile).toHaveBeenCalledWith("src/App.vue", "<template />")
  })

  it("does not wait for a hung file-open notification", async () => {
    vi.useFakeTimers()
    try {
      const openFile = vi.fn(() => new Promise<void>(() => {}))
      const notification = notifyLspFileOpened(true, { openFile }, "src/App.vue", "<template />", { timeoutMs: 25 })

      await vi.advanceTimersByTimeAsync(24)
      let settled = false
      void notification.then(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await expect(notification).resolves.toBeUndefined()
      expect(openFile).toHaveBeenCalledWith("src/App.vue", "<template />")
    } finally {
      vi.useRealTimers()
    }
  })

  it("documents the short default LSP open budget used by the workbench", () => {
    expect(LSP_FILE_OPEN_NOTIFY_TIMEOUT_MS).toBeLessThanOrEqual(1500)
  })
})
