import { describe, expect, it, vi } from "vitest"
import { openLocation } from "./navigationService"

function createContext(activeFile: string | null = null, openResult: unknown = true) {
  const editor = {
    focus: vi.fn(),
    setPosition: vi.fn(),
    setSelection: vi.fn(),
    revealLineInCenter: vi.fn(),
    revealLineInCenterIfOutsideViewport: vi.fn(),
    revealPositionInCenter: vi.fn(),
    revealPositionInCenterIfOutsideViewport: vi.fn(),
  }
  const openFile = vi.fn(async () => openResult)
  return {
    editor,
    openFile,
    context: {
      getEditor: () => editor,
      getActiveFile: () => activeFile,
      openFile,
    },
  }
}

describe("navigationService", () => {
  it("opens inactive files before revealing the requested location", async () => {
    const { editor, openFile, context } = createContext("src/current.ts")

    await expect(openLocation({ path: "src/target.ts", line: 4, column: 9 }, context)).resolves.toBe(true)

    expect(openFile).toHaveBeenCalledWith("src/target.ts")
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 4, column: 9 })
    expect(editor.revealPositionInCenterIfOutsideViewport).toHaveBeenCalledWith({ lineNumber: 4, column: 9 })
    expect(editor.focus).toHaveBeenCalled()
  })

  it("selects exact ranges for search match locations", async () => {
    const { editor, context } = createContext("src/current.ts")

    await openLocation({ path: "src/current.ts", line: 8, column: 3, matchLength: 5 }, context)

    expect(editor.setSelection).toHaveBeenCalledWith({
      startLineNumber: 8,
      startColumn: 3,
      endLineNumber: 8,
      endColumn: 8,
    })
    expect(editor.setPosition).not.toHaveBeenCalled()
  })

  it("uses VS Code-style position reveal for line search navigation when available", async () => {
    const { editor, context } = createContext("src/current.ts")

    await openLocation({ path: "src/current.ts", line: 8, column: 3, matchLength: 5, reveal: "line" }, context)

    expect(editor.revealPositionInCenterIfOutsideViewport).toHaveBeenCalledWith({ lineNumber: 8, column: 3 })
    expect(editor.revealLineInCenter).not.toHaveBeenCalled()
  })

  it("does not move the editor when opening the target file fails", async () => {
    const { editor, openFile, context } = createContext("src/current.ts", false)

    await expect(openLocation({ path: "src/missing.ts", line: 2 }, context)).resolves.toBe(false)

    expect(openFile).toHaveBeenCalledWith("src/missing.ts")
    expect(editor.setPosition).not.toHaveBeenCalled()
    expect(editor.setSelection).not.toHaveBeenCalled()
  })

  it("can preserve focus for preview-style navigation", async () => {
    const { editor, context } = createContext("src/current.ts")

    await openLocation({ path: "src/current.ts", line: 1, column: 1, preserveFocus: true }, context)

    expect(editor.focus).not.toHaveBeenCalled()
  })
})
