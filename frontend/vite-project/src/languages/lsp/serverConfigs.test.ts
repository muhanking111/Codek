import { describe, expect, it } from "vitest"
import { getServerConfigForFile, getServerConfigForLanguage } from "./serverConfigs"

describe("serverConfigs", () => {
  it("resolves servers by detected language", () => {
    expect(getServerConfigForFile("src/main.ts")?.id).toBe("typescript")
    expect(getServerConfigForFile("src/App.vue")?.id).toBe("html")
    expect(getServerConfigForFile("src/data.jsonc")?.id).toBe("json")
  })

  it("keeps direct language lookup working", () => {
    expect(getServerConfigForLanguage("javascript")?.id).toBe("typescript")
    expect(getServerConfigForLanguage("jsonc")?.id).toBe("json")
  })
})
