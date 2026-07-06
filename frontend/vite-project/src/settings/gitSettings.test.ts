import { describe, expect, it } from "vitest"
import { getGitSettings } from "./gitSettings"

describe("gitSettings", () => {
  it("maps VS Code Git settings to runtime flags", () => {
    expect(
      getGitSettings({
        "git.enabled": false,
        "git.autofetch": false,
        "git.autoStage": true,
      }),
    ).toEqual({
      enabled: false,
      autofetch: false,
      autoStage: true,
    })
  })

  it("uses conservative defaults for invalid values", () => {
    expect(
      getGitSettings({
        "git.enabled": "yes",
        "git.autofetch": "no",
        "git.autoStage": "maybe",
      }),
    ).toEqual({
      enabled: true,
      autofetch: true,
      autoStage: false,
    })
  })
})
