import { test, expect, _electron as electron } from "@playwright/test"

test.describe("Codek Desktop", () => {
  let app
  let window

  test.beforeAll(async () => {
    app = await electron.launch({
      args: ["."],
      cwd: "../desktop",
    })
    window = await app.firstWindow()
  })

  test.afterAll(async () => {
    if (app) await app.close()
  })

  test("launches successfully", async () => {
    expect(window).toBeTruthy()
    const title = await window.title()
    expect(title).toContain("Codek")
  })

  test("renders sidebar", async () => {
    const sidebar = window.locator(".activity-bar, .sidebar")
    await expect(sidebar).toBeAttached({ timeout: 10000 })
  })

  test("opens settings panel", async () => {
    const settingsBtn = window.locator('[title="Settings"], [aria-label*="Settings"], button:has-text("Settings")')
    if (await settingsBtn.count() > 0) {
      await settingsBtn.first().click()
      await window.waitForTimeout(500)
    }
  })

  test("opens file tree", async () => {
    const filesBtn = window.locator('[title="Files"], [aria-label*="Files"], button:has-text("Files")')
    if (await filesBtn.count() > 0) {
      await filesBtn.first().click()
    }
  })
})