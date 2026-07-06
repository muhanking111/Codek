import { describe, expect, it } from "vitest"
import { getExtensionSettings } from "./extensionSettings"

describe("extensionSettings", () => {
  it("maps extension settings to marketplace behavior flags", () => {
    expect(
      getExtensionSettings({
        "extensions.autoUpdate": false,
        "extensions.ignoreRecommendations": true,
      }),
    ).toEqual({
      autoUpdate: false,
      ignoreRecommendations: true,
    })
  })

  it("keeps auto update enabled and recommendations visible by default", () => {
    expect(getExtensionSettings({})).toEqual({
      autoUpdate: true,
      ignoreRecommendations: false,
    })
  })
})
