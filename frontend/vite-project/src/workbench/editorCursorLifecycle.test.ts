import { describe, expect, it, vi } from "vitest"
import {
  installEditorCursorLifecycle,
  normalizeEditorCursorPosition,
  normalizeEditorCursorSelection,
} from "./editorCursorLifecycle"

describe("editorCursorLifecycle", () => {
  it("updates cursor position, breadcrumbs and navigation history", () => {
    let cursorCallback: (() => void) | undefined
    const setCursorPosition = vi.fn()
    const updateBreadcrumb = vi.fn()
    const pushNavigationHistory = vi.fn()
    const editor = {
      getPosition: vi.fn(() => ({ lineNumber: 12, column: 7 })),
      getSelection: vi.fn(),
      onDidChangeCursorPosition: vi.fn((callback) => {
        cursorCallback = callback
        return { dispose: vi.fn() }
      }),
      onDidChangeCursorSelection: vi.fn(() => ({ dispose: vi.fn() })),
    }

    installEditorCursorLifecycle({
      editor,
      getActiveFile: () => "src/App.vue",
      setCursorPosition,
      setHasEditorSelection: vi.fn(),
      updateBreadcrumb,
      pushNavigationHistory,
    })
    cursorCallback?.()

    expect(setCursorPosition).toHaveBeenCalledWith(12, 7)
    expect(updateBreadcrumb).toHaveBeenCalledTimes(1)
    expect(pushNavigationHistory).toHaveBeenCalledWith({ file: "src/App.vue", line: 12, column: 7 })
  })

  it("falls back to line and column 1 when Monaco returns no cursor position", () => {
    let cursorCallback: (() => void) | undefined
    const setCursorPosition = vi.fn()
    const pushNavigationHistory = vi.fn()
    const editor = {
      getPosition: vi.fn(() => null),
      onDidChangeCursorPosition: vi.fn((callback) => {
        cursorCallback = callback
        return { dispose: vi.fn() }
      }),
      onDidChangeCursorSelection: vi.fn(() => ({ dispose: vi.fn() })),
    }

    installEditorCursorLifecycle({
      editor,
      getActiveFile: () => null,
      setCursorPosition,
      setHasEditorSelection: vi.fn(),
      updateBreadcrumb: vi.fn(),
      pushNavigationHistory,
    })
    cursorCallback?.()

    expect(setCursorPosition).toHaveBeenCalledWith(1, 1)
    expect(pushNavigationHistory).toHaveBeenCalledWith({ file: "", line: 1, column: 1 })
  })

  it("tracks whether the editor has a non-empty selection", () => {
    let selectionCallback: (() => void) | undefined
    const setHasEditorSelection = vi.fn()
    const editor = {
      getPosition: vi.fn(),
      getSelection: vi.fn(() => ({ isEmpty: () => false })),
      onDidChangeCursorPosition: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeCursorSelection: vi.fn((callback) => {
        selectionCallback = callback
        return { dispose: vi.fn() }
      }),
    }

    installEditorCursorLifecycle({
      editor,
      getActiveFile: () => "src/App.vue",
      setCursorPosition: vi.fn(),
      setHasEditorSelection,
      updateBreadcrumb: vi.fn(),
      pushNavigationHistory: vi.fn(),
    })
    selectionCallback?.()

    expect(setHasEditorSelection).toHaveBeenCalledWith(true)
  })

  it("normalizes Monaco-like cursor state into VS Code-style core objects", () => {
    const position = normalizeEditorCursorPosition({ lineNumber: 3, column: 9 })
    const selection = normalizeEditorCursorSelection({
      selectionStartLineNumber: 3,
      selectionStartColumn: 9,
      positionLineNumber: 4,
      positionColumn: 2,
    })

    expect(position.toString()).toBe("(3,9)")
    expect(selection?.toString()).toBe("[3,9 -> 4,2]")
    expect(normalizeEditorCursorPosition({ lineNumber: -1, column: 0 }).toJSON()).toEqual({ lineNumber: 1, column: 1 })
  })

  it("disposes installed cursor and selection listeners", () => {
    const disposeCursor = vi.fn()
    const disposeSelection = vi.fn()
    const editor = {
      getPosition: vi.fn(),
      getSelection: vi.fn(),
      onDidChangeCursorPosition: vi.fn(() => ({ dispose: disposeCursor })),
      onDidChangeCursorSelection: vi.fn(() => ({ dispose: disposeSelection })),
    }

    const disposable = installEditorCursorLifecycle({
      editor,
      getActiveFile: () => "src/App.vue",
      setCursorPosition: vi.fn(),
      setHasEditorSelection: vi.fn(),
      updateBreadcrumb: vi.fn(),
      pushNavigationHistory: vi.fn(),
    })
    disposable.dispose()

    expect(disposeCursor).toHaveBeenCalledTimes(1)
    expect(disposeSelection).toHaveBeenCalledTimes(1)
  })
})
