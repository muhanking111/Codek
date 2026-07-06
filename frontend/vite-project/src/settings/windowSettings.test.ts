import { describe, expect, it } from "vitest"
import { getRestoreWindowsMode, shouldRestoreWorkspace } from "./windowSettings"

describe("windowSettings", () => {
  it("maps window restore settings to startup behavior", () => {
    expect(getRestoreWindowsMode({ "window.restoreWindows": "folders" })).toBe("folders")
    expect(getRestoreWindowsMode({ "window.restoreWindows": "none" })).toBe("none")
    expect(getRestoreWindowsMode({ "window.restoreWindows": "bad" })).toBe("all")
    expect(shouldRestoreWorkspace({ "window.restoreWindows": "all" })).toBe(true)
    expect(shouldRestoreWorkspace({ "window.restoreWindows": "folders" })).toBe(true)
    expect(shouldRestoreWorkspace({ "window.restoreWindows": "none" })).toBe(false)
  })
})
