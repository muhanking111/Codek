import { beforeEach, describe, expect, it, vi } from "vitest"
import { getUpdateSettings, runConfiguredUpdateCheck } from "./updateSettings"
import { settingsStore } from "./settingsStore"

describe("updateSettings", () => {
  beforeEach(() => {
    delete window.codek
    settingsStore.reset()
  })

  it("maps update mode to check and download behavior", () => {
    expect(getUpdateSettings({ "update.mode": "manual" })).toEqual({
      mode: "manual",
      shouldCheck: false,
      shouldDownload: false,
    })
    expect(getUpdateSettings({ "update.mode": "check" })).toEqual({
      mode: "check",
      shouldCheck: true,
      shouldDownload: false,
    })
    expect(getUpdateSettings({ "update.mode": "download" })).toEqual({
      mode: "download",
      shouldCheck: true,
      shouldDownload: true,
    })
    expect(getUpdateSettings({ "update.mode": "future" })).toEqual({
      mode: "manual",
      shouldCheck: false,
      shouldDownload: false,
    })
  })

  it("calls desktop update endpoint only when configured", async () => {
    const api = vi.fn().mockResolvedValue({ ok: true })
    window.codek = { api } as unknown as typeof window.codek

    settingsStore.set("update.mode", "manual")
    await expect(runConfiguredUpdateCheck()).resolves.toBe(false)
    expect(api).not.toHaveBeenCalled()

    settingsStore.set("update.mode", "download")
    await expect(runConfiguredUpdateCheck()).resolves.toBe(true)
    expect(api).toHaveBeenCalledWith("POST", "/updates/check", { download: true })
  })
})
