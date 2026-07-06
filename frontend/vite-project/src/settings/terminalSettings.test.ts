import { describe, expect, it } from "vitest"
import {
  getProfileFromShellType,
  getShellTypeFromProfile,
  getTerminalSettingsOptions,
} from "./terminalSettings"

describe("terminalSettings", () => {
  it("maps terminal settings to xterm options", () => {
    expect(
      getTerminalSettingsOptions({
        "terminal.integrated.fontFamily": "Consolas",
        "terminal.integrated.fontSize": 16,
        "terminal.integrated.scrollback": 5000,
      }),
    ).toEqual({
      fontFamily: "Consolas",
      fontSize: 16,
      scrollback: 5000,
    })
  })

  it("falls back to safe defaults for invalid values", () => {
    expect(
      getTerminalSettingsOptions({
        "terminal.integrated.fontFamily": "",
        "terminal.integrated.fontSize": 100,
        "terminal.integrated.scrollback": -1,
      }),
    ).toEqual({
      fontFamily: "Consolas, monospace",
      fontSize: 40,
      scrollback: 1000,
    })
  })

  it("maps VS Code Windows profiles to shell types", () => {
    expect(getShellTypeFromProfile("PowerShell")).toBe("powershell")
    expect(getShellTypeFromProfile("Command Prompt")).toBe("cmd")
    expect(getShellTypeFromProfile("Git Bash")).toBe("gitbash")
    expect(getShellTypeFromProfile("Unknown")).toBe("powershell")
  })

  it("maps shell types back to VS Code Windows profiles", () => {
    expect(getProfileFromShellType("powershell")).toBe("PowerShell")
    expect(getProfileFromShellType("cmd")).toBe("Command Prompt")
    expect(getProfileFromShellType("bash")).toBe("Bash")
    expect(getProfileFromShellType("gitbash")).toBe("Git Bash")
  })
})
