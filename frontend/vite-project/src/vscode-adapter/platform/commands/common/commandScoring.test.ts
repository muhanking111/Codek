import { describe, expect, it } from "vitest"
import { scoreCommandPaletteMatch, scoreCommandPaletteMatchWithHighlights } from "./commandScoring"

describe("VS Code command palette scoring adapter", () => {
  it("prioritizes exact and prefix matches", () => {
    const command = { id: "workbench.action.openSettings", title: "打开设置", category: "Preferences" }

    expect(scoreCommandPaletteMatch(command, "workbench.action.openSettings")).toBe(1000)
    expect(scoreCommandPaletteMatch(command, "workbench.action.open")).toBe(850)
    expect(scoreCommandPaletteMatch(command, "preferences")).toBe(700)
  })

  it("matches command labels by word boundary and acronym", () => {
    const command = { id: "workbench.action.openKeyboardShortcuts", title: "Open Keyboard Shortcuts", category: "Preferences" }

    expect(scoreCommandPaletteMatch(command, "oks")).toBeGreaterThan(0)
    expect(scoreCommandPaletteMatch(command, "keyboard shortcuts")).toBeGreaterThan(0)
  })

  it("rejects non-matching queries", () => {
    expect(scoreCommandPaletteMatch({ id: "workbench.action.files.save", title: "保存" }, "zzzz")).toBe(0)
  })

  it("returns title highlight indices for command palette rendering", () => {
    expect(scoreCommandPaletteMatchWithHighlights(
      { id: "workbench.action.openKeyboardShortcuts", title: "Open Keyboard Shortcuts", category: "Preferences" },
      "oks",
    )).toEqual(expect.objectContaining({
      score: expect.any(Number),
      titleIndices: [0, 5, 14],
    }))
  })
})
