import { beforeEach, describe, expect, it } from "vitest"
import {
  clearKeybindings,
  formatKeybinding,
  getKeybindingForCommand,
  registerCommandKeybinding,
  registerKeybinding,
  resetAllKeybindings,
} from "../keybindings"
import {
  exportKeybindingsJson,
  formatKeybindingForJson,
  importKeybindingsJson,
  replaceKeybindingsJson,
  parseKeybindingString,
} from "./keybindingsJson"

function registerTestCommand(id: string, key: string, description = id): void {
  registerKeybinding({
    id,
    key,
    ctrl: true,
    shift: false,
    alt: false,
    description,
    action: () => {},
  })
}

describe("keybindingsJson", () => {
  beforeEach(() => {
    localStorage.clear()
    resetAllKeybindings()
    clearKeybindings()
  })

  it("parses VS Code style key strings", () => {
    expect(parseKeybindingString("ctrl+s")).toEqual({
      key: "s",
      ctrl: true,
      shift: false,
      alt: false,
    })
    expect(parseKeybindingString("cmd+shift+p")).toEqual({
      key: "p",
      ctrl: true,
      shift: true,
      alt: false,
    })
    expect(parseKeybindingString("ctrl+alt+f5")).toEqual({
      key: "f5",
      ctrl: true,
      shift: false,
      alt: true,
    })
  })

  it("formats current keybindings for keybindings.json", () => {
    expect(
      formatKeybindingForJson({
        key: "p",
        ctrl: true,
        shift: true,
        alt: false,
      }),
    ).toBe("ctrl+shift+p")
  })

  it("imports supported commands and preserves when clauses", () => {
    registerTestCommand("workbench.action.files.save", "s", "保存")

    const result = importKeybindingsJson([
      {
        key: "ctrl+shift+s",
        command: "workbench.action.files.save",
        when: "editorTextFocus",
      },
    ])

    expect(result.applied).toEqual([
      {
        command: "workbench.action.files.save",
        key: "ctrl+shift+s",
        when: "editorTextFocus",
        conflicts: [],
      },
    ])
    expect(formatKeybinding(getKeybindingForCommand("workbench.action.files.save")!)).toBe(
      "Ctrl+Shift+S",
    )
    expect(exportKeybindingsJson()).toContainEqual({
      key: "ctrl+shift+s",
      command: "workbench.action.files.save",
      when: "editorTextFocus",
    })
  })

  it("treats command keybinding contributions as known commands through the old command id proxy", () => {
    registerCommandKeybinding("workbench.action.showCommands", {
      key: "p",
      ctrl: true,
      shift: true,
      alt: false,
      when: "workspaceTrust",
    })

    const result = importKeybindingsJson([
      {
        key: "ctrl+alt+p",
        command: "workbench.action.showCommands",
        when: "agentEvidenceAvailable",
      },
    ])

    expect(result.unknown).toEqual([])
    expect(result.applied).toEqual([
      {
        command: "workbench.action.showCommands",
        key: "ctrl+alt+p",
        when: "agentEvidenceAvailable",
        conflicts: [],
      },
    ])
    expect(formatKeybinding(getKeybindingForCommand("workbench.action.showCommands")!)).toBe("Ctrl+Alt+P")
    expect(exportKeybindingsJson()).toContainEqual({
      key: "ctrl+alt+p",
      command: "workbench.action.showCommands",
      when: "agentEvidenceAvailable",
    })
  })

  it("reports conflicts while still applying supported commands", () => {
    registerTestCommand("workbench.action.files.save", "s", "保存")
    registerTestCommand("workbench.action.showCommands", "p", "命令面板")

    const result = importKeybindingsJson([
      {
        key: "ctrl+p",
        command: "workbench.action.files.save",
      },
    ])

    expect(result.applied[0]).toEqual({
      command: "workbench.action.files.save",
      key: "ctrl+p",
      conflicts: ["workbench.action.showCommands"],
    })
  })

  it("keeps unknown commands instead of dropping them", () => {
    const result = importKeybindingsJson([
      {
        key: "ctrl+k ctrl+s",
        command: "workbench.action.openGlobalKeybindings",
        when: "editorTextFocus",
      },
    ])

    expect(result.unknown).toEqual([
      {
        key: "ctrl+k ctrl+s",
        command: "workbench.action.openGlobalKeybindings",
        when: "editorTextFocus",
        reason: "未接入命令",
      },
    ])
    expect(exportKeybindingsJson()).toContainEqual({
      key: "ctrl+k ctrl+s",
      command: "workbench.action.openGlobalKeybindings",
      when: "editorTextFocus",
    })
  })

  it("reports invalid json entries", () => {
    const result = importKeybindingsJson([
      {
        key: "",
        command: "workbench.action.files.save",
      },
      {
        key: "ctrl+s",
        command: "",
      },
    ])

    expect(result.invalid).toHaveLength(2)
    expect(result.applied).toEqual([])
  })

  it("replaces existing keybindings when loading from keybindings.json", () => {
    registerTestCommand("workbench.action.files.save", "s", "保存")
    importKeybindingsJson([
      {
        key: "ctrl+shift+s",
        command: "workbench.action.files.save",
        when: "editorTextFocus",
      },
      {
        key: "ctrl+k ctrl+s",
        command: "workbench.action.openGlobalKeybindings",
      },
    ])

    const result = replaceKeybindingsJson([])

    expect(result).toEqual({ applied: [], unknown: [], invalid: [] })
    expect(formatKeybinding(getKeybindingForCommand("workbench.action.files.save")!)).toBe("Ctrl+S")
    expect(exportKeybindingsJson()).toEqual([
      {
        key: "ctrl+s",
        command: "workbench.action.files.save",
      },
    ])
  })
})
