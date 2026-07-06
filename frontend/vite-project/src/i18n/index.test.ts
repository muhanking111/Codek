import { beforeEach, describe, expect, it } from "vitest"
import { createI18n } from "./index"
import { settingsStore } from "../settings/settingsStore"

describe("i18n settings integration", () => {
  beforeEach(() => {
    localStorage.clear()
    settingsStore.reset()
  })

  it("initializes locale from the unified settings store", () => {
    settingsStore.set("codek.locale", "en")

    const i18n = createI18n()

    expect(i18n.locale.value).toBe("en")
  })

  it("persists locale changes to the unified settings store", () => {
    const i18n = createI18n()

    i18n.setLocale("zhTw")

    expect(i18n.locale.value).toBe("zhTw")
    expect(settingsStore.get("codek.locale")).toBe("zhTw")
    expect(localStorage.getItem("codek.locale.v1")).toBe("zhTw")
  })

  it("reacts when Settings JSON updates codek.locale", () => {
    const i18n = createI18n()

    settingsStore.set("codek.locale", "en")

    expect(i18n.locale.value).toBe("en")
  })
})
