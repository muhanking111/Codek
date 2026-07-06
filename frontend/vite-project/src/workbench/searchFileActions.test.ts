import { describe, expect, it, vi } from "vitest"
import { projectTextSearchWorkbenchResult } from "../vscode-adapter/workbench/contrib/search/searchWorkbenchService"
import { createSearchFileActionOwnerEvidence, handleExternalFileChange, openFileAtLocation, openGrepMatch, replaceAll, replaceOne, type SearchFileActionContext } from "./searchFileActions"

function createContext(overrides: Record<string, unknown> = {}) {
  let currentSelection: ReturnType<typeof Object> | null = null
  let currentContext: SearchFileActionContext | null = null
  const editor = {
    getValue: vi.fn(() => {
      const path = currentContext?.workspace.activeFile
      const content = path ? currentContext?.workspace.files[path] : ""
      return typeof content === "string" ? content : ""
    }),
    getSelection: vi.fn(() => currentSelection),
    setPosition: vi.fn(),
    setSelection: vi.fn((selection) => {
      currentSelection = selection
    }),
    revealLineInCenter: vi.fn(),
    revealLineInCenterIfOutsideViewport: vi.fn(),
    revealPosition: vi.fn(),
    revealPositionInCenter: vi.fn(),
    revealPositionInCenterIfOutsideViewport: vi.fn(),
    focus: vi.fn(),
  }
  const context = {
    workspace: { activeFile: null, files: {} },
    workspaceManager: {
      getAllFiles: () => ({}),
      updateFile: vi.fn(),
      readProjectFile: vi.fn(async () => null),
      saveFile: vi.fn(async () => true),
      getRelativePath: (path: string) => path,
      isDirty: () => false,
      markChangedExternally: vi.fn(),
      reloadFile: vi.fn(),
      closeFile: vi.fn(),
      refreshFileTree: vi.fn(),
      isBinaryEditorBlockedFile: vi.fn(() => false),
      removeBinaryEditorState: vi.fn(),
    },
    getEditor: () => editor,
    getSearchQuery: () => "needle",
    getReplaceQuery: () => "",
    getGrepResults: () => [],
    createSearchPattern: () => /needle/g,
    openFile: vi.fn(async () => true),
    syncEditorFromWorkspace: vi.fn(),
    refreshSearchResults: vi.fn(),
    refreshActiveAnalysis: vi.fn(),
    ...overrides,
  } as unknown as SearchFileActionContext
  currentContext = context
  return {
    editor,
    context,
  }
}

describe("searchFileActions", () => {
  it("opens a file and selects the exact search match range", async () => {
    const keepSearchViewActive = vi.fn()
    const { editor, context } = createContext({
      workspace: { activeFile: "src/app.ts", files: { "src/app.ts": "export const app = true" } },
      keepSearchViewActive,
    })

    await openFileAtLocation("src/app.ts", { line: 12, column: 9, matchLength: 6 }, context)

    expect(context.openFile).not.toHaveBeenCalled()
    expect(editor.setSelection).toHaveBeenCalledWith({
      startLineNumber: 12,
      startColumn: 9,
      endLineNumber: 12,
      endColumn: 15,
    })
    expect(editor.revealPositionInCenterIfOutsideViewport).toHaveBeenCalledWith({ lineNumber: 12, column: 9 })
    expect(editor.focus).toHaveBeenCalled()
    expect(keepSearchViewActive).toHaveBeenCalled()
  })

  it("keeps backward-compatible line-only grep navigation", async () => {
    const { editor, context } = createContext({
      workspace: { activeFile: "src/app.ts", files: { "src/app.ts": "export const app = true" } },
    })

    await openGrepMatch("src/app.ts", 7, context)

    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 7, column: 1 })
    expect(editor.revealPositionInCenterIfOutsideViewport).toHaveBeenCalledWith({ lineNumber: 7, column: 1 })
  })

  it("uses grep match column metadata when provided", async () => {
    const { editor, context } = createContext({
      workspace: { activeFile: "src/app.ts", files: { "src/app.ts": "export const app = true" } },
    })

    await openGrepMatch("src/app.ts", { line: 4, column: 11, matchLength: 3 }, context)

    expect(editor.setSelection).toHaveBeenCalledWith({
      startLineNumber: 4,
      startColumn: 11,
      endLineNumber: 4,
      endColumn: 14,
    })
  })

  it("syncs the editor model before selecting a newly opened search result", async () => {
    const workspace = { activeFile: "src/current.ts", files: {} as Record<string, string> }
    const { editor, context } = createContext({
      workspace,
      openFile: vi.fn(async (path: string) => {
        setTimeout(() => {
          workspace.activeFile = path
          workspace.files[path] = "export const target = 'needle'\n"
        }, 20)
        return true
      }),
      syncEditorFromWorkspace: vi.fn(),
    })

    await openFileAtLocation("src/target.ts", { line: 1, column: 24, matchLength: 6 }, context)

    expect(context.openFile).toHaveBeenCalledWith("src/target.ts")
    expect(context.syncEditorFromWorkspace).toHaveBeenCalledBefore(editor.setSelection)
    expect(editor.setSelection).toHaveBeenCalledWith({
      startLineNumber: 1,
      startColumn: 24,
      endLineNumber: 1,
      endColumn: 30,
    })
  })

  it("force-loads search result content when openFile succeeds before workspace content is mounted", async () => {
    const workspace = { activeFile: "src/current.ts", files: {} as Record<string, string> }
    const updateFile = vi.fn()
    const { editor, context } = createContext({
      workspace,
      openFile: vi.fn(async () => true),
      syncEditorFromWorkspace: vi.fn(),
      workspaceManager: {
        getAllFiles: () => ({}),
        updateFile,
        readProjectFile: vi.fn(async () => "export const target = 'needle'\n"),
        saveFile: vi.fn(async () => true),
        getRelativePath: (path: string) => path,
        isDirty: () => false,
        markChangedExternally: vi.fn(),
        reloadFile: vi.fn(),
        closeFile: vi.fn(),
        refreshFileTree: vi.fn(),
      },
    })

    await openFileAtLocation("src/target.ts", { line: 1, column: 24, matchLength: 6 }, context)

    expect(workspace.activeFile).toBe("src/target.ts")
    expect(workspace.files["src/target.ts"]).toContain("needle")
    expect(updateFile).toHaveBeenCalledWith("src/target.ts", expect.stringContaining("needle"), { dirty: false, external: false })
    expect(context.syncEditorFromWorkspace).toHaveBeenCalledBefore(editor.setSelection)
  })

  it("opens clean cross-file search results from cached search content without normal open IPC", async () => {
    const workspace = { activeFile: "src/current.ts", files: {} as Record<string, string> }
    const updateFile = vi.fn()
    const readProjectFile = vi.fn(async () => "should not read from disk")
    const { editor, context } = createContext({
      workspace,
      openFile: vi.fn(async () => {
        throw new Error("normal open should not run")
      }),
      syncEditorFromWorkspace: vi.fn(),
      getGrepResults: () => [
        {
          path: "src/target.ts",
          content: "export const target = 'needle cached'\n",
          matches: [{ line: 1, column: 24, matchLength: 6 }],
        },
      ],
      workspaceManager: {
        getAllFiles: () => ({}),
        updateFile,
        readProjectFile,
        saveFile: vi.fn(async () => true),
        getRelativePath: (path: string) => path,
        isDirty: () => false,
        markChangedExternally: vi.fn(),
        reloadFile: vi.fn(),
        closeFile: vi.fn(),
        refreshFileTree: vi.fn(),
      },
    })

    await openFileAtLocation("src/target.ts", { line: 1, column: 24, matchLength: 6 }, context)

    expect(context.openFile).not.toHaveBeenCalled()
    expect(readProjectFile).not.toHaveBeenCalled()
    expect(workspace.activeFile).toBe("src/target.ts")
    expect(workspace.files["src/target.ts"]).toContain("needle cached")
    expect(updateFile).toHaveBeenCalledWith(
      "src/target.ts",
      expect.stringContaining("needle cached"),
      { dirty: false, external: false },
    )
    expect(context.syncEditorFromWorkspace).toHaveBeenCalledBefore(editor.setSelection)
    expect(editor.setSelection).toHaveBeenCalledWith({
      startLineNumber: 1,
      startColumn: 24,
      endLineNumber: 1,
      endColumn: 30,
    })
  })

  it("falls back to force-loading real content when the normal search-result open path fails", async () => {
    const workspace = { activeFile: "src/current.ts", files: {} as Record<string, string> }
    const updateFile = vi.fn()
    const { editor, context } = createContext({
      workspace,
      openFile: vi.fn(async () => false),
      syncEditorFromWorkspace: vi.fn(),
      workspaceManager: {
        getAllFiles: () => ({}),
        updateFile,
        readProjectFile: vi.fn(async () => "export const target = 'needle fallback'\n"),
        saveFile: vi.fn(async () => true),
        getRelativePath: (path: string) => path,
        isDirty: () => false,
        markChangedExternally: vi.fn(),
        reloadFile: vi.fn(),
        closeFile: vi.fn(),
        refreshFileTree: vi.fn(),
      },
    })

    await openFileAtLocation("src/target.ts", { line: 1, column: 24, matchLength: 6 }, context)

    expect(context.openFile).toHaveBeenCalledWith("src/target.ts")
    expect(workspace.activeFile).toBe("src/target.ts")
    expect(workspace.files["src/target.ts"]).toContain("needle fallback")
    expect(updateFile).toHaveBeenCalledWith("src/target.ts", expect.stringContaining("needle fallback"), { dirty: false, external: false })
    expect(context.syncEditorFromWorkspace).toHaveBeenCalledBefore(editor.setSelection)
    expect(editor.setSelection).toHaveBeenCalledWith({
      startLineNumber: 1,
      startColumn: 24,
      endLineNumber: 1,
      endColumn: 30,
    })
  })

  it("falls back to force-loading search result content after a hung normal open path times out", async () => {
    const workspace = { activeFile: "src/current.ts", files: {} as Record<string, string> }
    const updateFile = vi.fn()
    const { editor, context } = createContext({
      workspace,
      openFile: vi.fn(() => new Promise<boolean>(() => {})),
      openFileTimeoutMs: 5,
      readProjectFileTimeoutMs: 50,
      syncEditorFromWorkspace: vi.fn(),
      workspaceManager: {
        getAllFiles: () => ({}),
        updateFile,
        readProjectFile: vi.fn(async () => "export const target = 'needle fallback after timeout'\n"),
        saveFile: vi.fn(async () => true),
        getRelativePath: (path: string) => path,
        isDirty: () => false,
        markChangedExternally: vi.fn(),
        reloadFile: vi.fn(),
        closeFile: vi.fn(),
        refreshFileTree: vi.fn(),
      },
    })

    await openFileAtLocation("src/target.ts", { line: 1, column: 24, matchLength: 6 }, context)

    expect(context.openFile).toHaveBeenCalledWith("src/target.ts")
    expect(workspace.activeFile).toBe("src/target.ts")
    expect(workspace.files["src/target.ts"]).toContain("needle fallback after timeout")
    expect(updateFile).toHaveBeenCalledWith(
      "src/target.ts",
      expect.stringContaining("needle fallback after timeout"),
      { dirty: false, external: false },
    )
    expect(context.syncEditorFromWorkspace).toHaveBeenCalledBefore(editor.setSelection)
    expect(editor.setSelection).toHaveBeenCalledWith({
      startLineNumber: 1,
      startColumn: 24,
      endLineNumber: 1,
      endColumn: 30,
    })
  })

  it("does not bypass a hung normal open path when the active file is dirty", async () => {
    const showOpenError = vi.fn()
    const workspace = {
      activeFile: "src/current.ts",
      files: { "src/current.ts": "unsaved change" } as Record<string, string>,
    }
    const updateFile = vi.fn()
    const { context } = createContext({
      workspace,
      showOpenError,
      openFile: vi.fn(() => new Promise<boolean>(() => {})),
      openFileTimeoutMs: 5,
      readProjectFileTimeoutMs: 50,
      workspaceManager: {
        getAllFiles: () => ({}),
        updateFile,
        readProjectFile: vi.fn(async () => "export const target = 'needle fallback after timeout'\n"),
        saveFile: vi.fn(async () => true),
        getRelativePath: (path: string) => path,
        isDirty: (path: string) => path === "src/current.ts",
        markChangedExternally: vi.fn(),
        reloadFile: vi.fn(),
        closeFile: vi.fn(),
        refreshFileTree: vi.fn(),
      },
    })

    await expect(openFileAtLocation("src/target.ts", { line: 1, column: 24, matchLength: 6 }, context))
      .rejects.toThrow("open search result src/target.ts timed out")

    expect(context.workspaceManager.readProjectFile).not.toHaveBeenCalled()
    expect(updateFile).not.toHaveBeenCalled()
    expect(workspace.activeFile).toBe("src/current.ts")
    expect(showOpenError).not.toHaveBeenCalled()
  })

  it("waits once for a cold editor instance before selecting the first opened search result", async () => {
    const workspace = { activeFile: "src/current.ts", files: {} as Record<string, string> }
    let mountedEditor: typeof editor | null = null
    const { editor, context } = createContext({
      workspace,
      getEditor: () => mountedEditor,
      openFile: vi.fn(async (path: string) => {
        workspace.activeFile = path
        workspace.files[path] = "export const target = 'needle'\n"
        return true
      }),
      syncEditorFromWorkspace: vi.fn(),
      ensureEditorReady: vi.fn(async () => {
        mountedEditor = editor
        return true
      }),
    })

    await openFileAtLocation("src/target.ts", { line: 1, column: 24, matchLength: 6 }, context)

    expect(context.ensureEditorReady).toHaveBeenCalledTimes(1)
    expect(context.ensureEditorReady).toHaveBeenCalledWith(10_000)
    expect(context.ensureEditorReady as any).toHaveBeenCalledBefore(context.syncEditorFromWorkspace as any)
    expect(context.ensureEditorReady as any).toHaveBeenCalledBefore(editor.setSelection)
    expect(editor.setSelection).toHaveBeenCalledWith({
      startLineNumber: 1,
      startColumn: 24,
      endLineNumber: 1,
      endColumn: 30,
    })
  })

  it("waits until workspace content is mounted into the editor before search navigation", async () => {
    const workspace = { activeFile: "src/current.ts", files: {} as Record<string, string> }
    let editorValue = ""
    let syncCalls = 0
    const { editor, context } = createContext({
      workspace,
      openFile: vi.fn(async (path: string) => {
        workspace.activeFile = path
        workspace.files[path] = "export const target = 'needle'\n"
        return true
      }),
      syncEditorFromWorkspace: vi.fn(() => {
        syncCalls += 1
        if (syncCalls >= 2) {
          editorValue = workspace.files["src/target.ts"]
        }
      }),
    })
    editor.getValue = vi.fn(() => editorValue)

    await openFileAtLocation("src/target.ts", { line: 1, column: 24, matchLength: 6 }, context)

    expect(context.syncEditorFromWorkspace).toHaveBeenCalledTimes(2)
    expect(editor.setSelection).toHaveBeenCalledWith({
      startLineNumber: 1,
      startColumn: 24,
      endLineNumber: 1,
      endColumn: 30,
    })
  })

  it("re-applies the exact search selection when model sync overwrites the first selections", async () => {
    const workspace = { activeFile: "src/current.ts", files: {} as Record<string, string> }
    const expected = {
      startLineNumber: 1,
      startColumn: 24,
      endLineNumber: 1,
      endColumn: 30,
    }
    const { editor, context } = createContext({
      workspace,
      openFile: vi.fn(async (path: string) => {
        workspace.activeFile = path
        workspace.files[path] = "export const target = 'needle'\n"
        return true
      }),
      syncEditorFromWorkspace: vi.fn(),
    })
    let readCount = 0
    editor.getSelection = vi.fn(() => {
      readCount += 1
      return readCount >= 7 ? expected : {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 1,
      }
    })

    await openFileAtLocation("src/target.ts", { line: 1, column: 24, matchLength: 6 }, context)

    expect(readCount).toBeGreaterThan(6)
    expect(editor.setSelection).toHaveBeenLastCalledWith(expected)
    expect(editor.revealPositionInCenterIfOutsideViewport).toHaveBeenCalledWith({ lineNumber: 1, column: 24 })
  })

  it("keeps cross-file search clicks accurate when the previous file selection lingers after opening", async () => {
    const workspace = {
      activeFile: "src/a.ts",
      files: {
        "src/a.ts": "const a = 'needle'\n",
      } as Record<string, string>,
    }
    const expectedB = {
      startLineNumber: 20,
      startColumn: 5,
      endLineNumber: 20,
      endColumn: 11,
    }
    const { editor, context } = createContext({
      workspace,
      openFile: vi.fn(async (path: string) => {
        workspace.activeFile = path
        workspace.files[path] = "const b = 'needle'\n".repeat(24)
        return true
      }),
      syncEditorFromWorkspace: vi.fn(),
    })
    let staleReads = 0
    editor.getSelection = vi.fn(() => {
      staleReads += 1
      if (staleReads <= 3) {
        return {
          startLineNumber: 1,
          startColumn: 11,
          endLineNumber: 1,
          endColumn: 17,
        }
      }
      return expectedB
    })

    await openFileAtLocation("src/b.ts", { line: 20, column: 5, matchLength: 6 }, context)

    expect(context.openFile).toHaveBeenCalledWith("src/b.ts")
    expect(editor.setSelection).toHaveBeenLastCalledWith(expectedB)
    expect(editor.revealPositionInCenterIfOutsideViewport).toHaveBeenLastCalledWith({ lineNumber: 20, column: 5 })
  })

  it("stops re-applying the exact search selection once the editor reports it consistently", async () => {
    const workspace = { activeFile: "src/current.ts", files: {} as Record<string, string> }
    const expected = {
      startLineNumber: 1,
      startColumn: 24,
      endLineNumber: 1,
      endColumn: 30,
    }
    const { editor, context } = createContext({
      workspace,
      openFile: vi.fn(async (path: string) => {
        workspace.activeFile = path
        workspace.files[path] = "export const target = 'needle'\n"
        return true
      }),
      syncEditorFromWorkspace: vi.fn(),
    })
    editor.getSelection = vi.fn(() => editor.setSelection.mock.calls.length >= 2 ? expected : {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
    })

    await openFileAtLocation("src/target.ts", { line: 1, column: 24, matchLength: 6 }, context)

    expect(editor.setSelection.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(editor.setSelection).toHaveBeenLastCalledWith(expected)
  })

  it("accepts Monaco selection objects that expose anchor and position fields", async () => {
    const workspace = { activeFile: "src/current.ts", files: {} as Record<string, string> }
    const expected = {
      startLineNumber: 1,
      startColumn: 24,
      endLineNumber: 1,
      endColumn: 30,
    }
    const { editor, context } = createContext({
      workspace,
      openFile: vi.fn(async (path: string) => {
        workspace.activeFile = path
        workspace.files[path] = "export const target = 'needle'\n"
        return true
      }),
      syncEditorFromWorkspace: vi.fn(),
    })
    editor.getSelection = vi.fn(() => editor.setSelection.mock.calls.length >= 2 ? {
      selectionStartLineNumber: expected.startLineNumber,
      selectionStartColumn: expected.startColumn,
      positionLineNumber: expected.endLineNumber,
      positionColumn: expected.endColumn,
    } : {
      selectionStartLineNumber: 1,
      selectionStartColumn: 1,
      positionLineNumber: 1,
      positionColumn: 1,
    })

    await openFileAtLocation("src/target.ts", { line: 1, column: 24, matchLength: 6 }, context)

    expect(editor.setSelection.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(editor.setSelection).toHaveBeenLastCalledWith(expected)
  })

  it("does not treat a single accurate read as stable search navigation", async () => {
    const workspace = { activeFile: "src/current.ts", files: {} as Record<string, string> }
    const expected = {
      startLineNumber: 1,
      startColumn: 24,
      endLineNumber: 1,
      endColumn: 30,
    }
    const { editor, context } = createContext({
      workspace,
      openFile: vi.fn(async (path: string) => {
        workspace.activeFile = path
        workspace.files[path] = "export const target = 'needle'\n"
        return true
      }),
      syncEditorFromWorkspace: vi.fn(),
    })
    let readCount = 0
    editor.getSelection = vi.fn(() => {
      readCount += 1
      if (readCount === 2) return expected
      if (readCount >= 8) return expected
      return {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 1,
      }
    })

    await openFileAtLocation("src/target.ts", { line: 1, column: 24, matchLength: 6 }, context)

    expect(readCount).toBeGreaterThanOrEqual(10)
    expect(editor.setSelection).toHaveBeenLastCalledWith(expected)
  })

  it("keeps cross-file search navigation alive when the first exact selection is overwritten by model activation", async () => {
    const workspace = {
      activeFile: "src/previous.ts",
      files: { "src/previous.ts": "export const previous = 'needle'\n" } as Record<string, string>,
    }
    const expected = {
      startLineNumber: 42,
      startColumn: 7,
      endLineNumber: 42,
      endColumn: 13,
    }
    const { editor, context } = createContext({
      workspace,
      openFile: vi.fn(async (path: string) => {
        workspace.activeFile = path
        workspace.files[path] = `${"\n".repeat(41)}target needle\n`
        return true
      }),
      syncEditorFromWorkspace: vi.fn(),
    })
    let readCount = 0
    editor.getSelection = vi.fn(() => {
      readCount += 1
      if (readCount === 1) return expected
      if (readCount <= 6) {
        return {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 1,
        }
      }
      return expected
    })

    await openFileAtLocation("src/target.ts", { line: 42, column: 7, matchLength: 6 }, context)

    expect(context.openFile).toHaveBeenCalledWith("src/target.ts")
    expect(readCount).toBeGreaterThan(8)
    expect(editor.setSelection.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(editor.setSelection).toHaveBeenLastCalledWith(expected)
    expect(editor.revealPositionInCenterIfOutsideViewport).toHaveBeenLastCalledWith({ lineNumber: 42, column: 7 })
  })

  it("waits until the exact search selection survives delayed editor model activation", async () => {
    const workspace = { activeFile: "src/current.ts", files: {} as Record<string, string> }
    const expected = {
      startLineNumber: 1,
      startColumn: 24,
      endLineNumber: 1,
      endColumn: 30,
    }
    const { editor, context } = createContext({
      workspace,
      openFile: vi.fn(async (path: string) => {
        workspace.activeFile = path
        workspace.files[path] = "export const target = 'needle'\n"
        return true
      }),
      syncEditorFromWorkspace: vi.fn(),
    })
    let readCount = 0
    editor.getSelection = vi.fn(() => {
      readCount += 1
      return readCount >= 12 ? expected : {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
      }
    })

    await openFileAtLocation("src/target.ts", { line: 1, column: 24, matchLength: 6 }, context)

    expect(readCount).toBeGreaterThanOrEqual(14)
    expect(editor.setSelection.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(editor.setSelection).toHaveBeenLastCalledWith(expected)
  })

  it("does not keep resetting a delayed Monaco selection before it can settle", async () => {
    const workspace = { activeFile: "src/current.ts", files: {} as Record<string, string> }
    const expected = {
      startLineNumber: 1,
      startColumn: 24,
      endLineNumber: 1,
      endColumn: 30,
    }
    const { editor, context } = createContext({
      workspace,
      openFile: vi.fn(async (path: string) => {
        workspace.activeFile = path
        workspace.files[path] = "export const target = 'needle'\n"
        return true
      }),
      syncEditorFromWorkspace: vi.fn(),
    })
    let readsSinceLastSet = 0
    editor.setSelection = vi.fn((selection) => {
      readsSinceLastSet = 0
      return selection
    })
    editor.getSelection = vi.fn(() => {
      readsSinceLastSet += 1
      return readsSinceLastSet >= 2 ? expected : {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 1,
      }
    })

    await openFileAtLocation("src/target.ts", { line: 1, column: 24, matchLength: 6 }, context)

    expect(editor.setSelection.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(editor.setSelection.mock.calls.length).toBeLessThan(6)
    expect(editor.setSelection).toHaveBeenLastCalledWith(expected)
  })

  it("does not fail a completed search navigation when delayed replay sees a disposed model", async () => {
    const workspace = { activeFile: "src/current.ts", files: {} as Record<string, string> }
    const expected = {
      startLineNumber: 1,
      startColumn: 24,
      endLineNumber: 1,
      endColumn: 30,
    }
    const reportNavigationStage = vi.fn()
    const { editor, context } = createContext({
      workspace,
      reportNavigationStage,
      openFile: vi.fn(async (path: string) => {
        workspace.activeFile = path
        workspace.files[path] = "export const target = 'needle'\n"
        return true
      }),
      syncEditorFromWorkspace: vi.fn(),
    })
    let currentSelection: typeof expected | null = null
    let throwOnReplay = false
    editor.setSelection = vi.fn((selection) => {
      if (throwOnReplay) throw new Error("Model is disposed!")
      currentSelection = selection
    })
    editor.getSelection = vi.fn(() => currentSelection)

    await openFileAtLocation("src/target.ts", { line: 1, column: 24, matchLength: 6 }, context)
    throwOnReplay = true
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(reportNavigationStage).toHaveBeenCalledWith("selection:done", {
      path: "src/target.ts",
      selectionApplied: true,
    })
    expect(reportNavigationStage).toHaveBeenCalledWith("selection:apply-error", expect.objectContaining({
      reason: expect.stringContaining("replay:"),
      error: "Model is disposed!",
    }))
  })

  it("waits for a replacement editor when Monaco selection reads hit a disposed model", async () => {
    const workspace = { activeFile: "src/current.ts", files: {} as Record<string, string> }
    const expected = {
      startLineNumber: 1,
      startColumn: 24,
      endLineNumber: 1,
      endColumn: 30,
    }
    const reportNavigationStage = vi.fn()
    const { editor, context } = createContext({
      workspace,
      reportNavigationStage,
      openFile: vi.fn(async (path: string) => {
        workspace.activeFile = path
        workspace.files[path] = "export const target = 'needle'\n"
        return true
      }),
      syncEditorFromWorkspace: vi.fn(),
    })
    let readCount = 0
    editor.getSelection = vi.fn(() => {
      readCount += 1
      if (readCount <= 2) throw new Error("Model is disposed!")
      return expected
    })

    await openFileAtLocation("src/target.ts", { line: 1, column: 24, matchLength: 6 }, context)

    expect(reportNavigationStage).toHaveBeenCalledWith("selection:read-error", expect.objectContaining({
      reason: "verify",
      error: "Model is disposed!",
    }))
    expect(editor.setSelection).toHaveBeenLastCalledWith(expected)
  })

  it("accepts an exact search selection that becomes stable at the verification timeout edge", async () => {
    const workspace = { activeFile: "src/current.ts", files: {} as Record<string, string> }
    const expected = {
      startLineNumber: 1,
      startColumn: 24,
      endLineNumber: 1,
      endColumn: 30,
    }
    const { editor, context } = createContext({
      workspace,
      openFile: vi.fn(async (path: string) => {
        workspace.activeFile = path
        workspace.files[path] = "export const target = 'needle'\n"
        return true
      }),
      syncEditorFromWorkspace: vi.fn(),
    })
    const firstReadAt = Date.now()
    let readCount = 0
    editor.getSelection = vi.fn(() => {
      readCount += 1
      return Date.now() - firstReadAt >= 2480 ? expected : {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 1,
      }
    })

    await openFileAtLocation("src/target.ts", { line: 1, column: 24, matchLength: 6 }, context)

    expect(readCount).toBeGreaterThanOrEqual(3)
    expect(editor.setSelection).toHaveBeenLastCalledWith(expected)
  })

  it("rejects search result navigation when the editor never reports the exact selection", async () => {
    const showOpenError = vi.fn()
    const workspace = { activeFile: "src/current.ts", files: {} as Record<string, string> }
    const { editor, context } = createContext({
      workspace,
      showOpenError,
      openFile: vi.fn(async (path: string) => {
        workspace.activeFile = path
        workspace.files[path] = "export const target = 'needle'\n"
        return true
      }),
      syncEditorFromWorkspace: vi.fn(),
    })
    editor.getSelection = vi.fn(() => ({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
    }))

    await expect(openFileAtLocation("src/target.ts", { line: 1, column: 24, matchLength: 6 }, context))
      .rejects.toThrow("编辑器没有稳定跳转到匹配位置")

    expect(showOpenError).toHaveBeenCalledWith(
      expect.stringContaining("编辑器没有稳定跳转到匹配位置"),
      "src/target.ts",
    )
  })

  it("rejects blank editor success states when a search result file did not load", async () => {
    const showOpenError = vi.fn()
    const { context } = createContext({
      workspace: { activeFile: "src/app.ts", files: {} },
      showOpenError,
    })

    await expect(openFileAtLocation("src/app.ts", { line: 1, column: 1 }, context)).rejects.toThrow("无法打开搜索结果")

    expect(showOpenError).toHaveBeenCalledWith(
      expect.stringContaining("已阻止空白编辑器状态"),
      "src/app.ts",
    )
  })

  it("blocks binary search-result cache paths before they can become active Monaco files", async () => {
    const showOpenError = vi.fn()
    const workspace = {
      activeFile: "src/current.ts",
      files: {
        "src/current.ts": "export const current = true\n",
        "vscode/.build/electron/locales/af.pak": "\0pak-binary",
      } as Record<string, string>,
    }
    const removeBinaryEditorState = vi.fn((path: string) => {
      delete workspace.files[path]
    })
    const { context } = createContext({
      workspace,
      showOpenError,
      workspaceManager: {
        getAllFiles: () => ({
          "vscode/.build/electron/locales/af.pak": "\0pak-binary",
        }),
        updateFile: vi.fn(),
        readProjectFile: vi.fn(async () => "\0pak-binary"),
        saveFile: vi.fn(async () => true),
        getRelativePath: (path: string) => path,
        isDirty: () => false,
        markChangedExternally: vi.fn(),
        reloadFile: vi.fn(),
        closeFile: vi.fn(),
        refreshFileTree: vi.fn(),
        isBinaryEditorBlockedFile: vi.fn((path: string) => path.endsWith(".pak")),
        removeBinaryEditorState,
      },
      getGrepResults: () => [{
        path: "vscode/.build/electron/locales/af.pak",
        content: "\0pak-binary",
        matches: [{ line: 1, column: 1, matchLength: 3 }],
      }],
      openFile: vi.fn(async () => false),
    })

    await expect(openFileAtLocation(
      "vscode/.build/electron/locales/af.pak",
      { line: 1, column: 1, matchLength: 3 },
      context,
    )).rejects.toThrow("无法打开搜索结果")

    expect(removeBinaryEditorState).toHaveBeenCalledWith("vscode/.build/electron/locales/af.pak")
    expect(workspace.activeFile).toBe("src/current.ts")
    expect(workspace.files).not.toHaveProperty("vscode/.build/electron/locales/af.pak")
    expect(context.workspaceManager.updateFile).not.toHaveBeenCalled()
    expect(showOpenError).toHaveBeenCalledWith(
      expect.stringContaining("二进制文件"),
      "vscode/.build/electron/locales/af.pak",
    )
  })

  it("does not reload deleted external files after unlink events", async () => {
    const { context } = createContext({
      workspace: {
        activeFile: "src/deleted.ts",
        files: {
          "src/deleted.ts": "export const deleted = true",
        },
      },
    })

    await handleExternalFileChange({ path: "src/deleted.ts", type: "unlink" }, context)

    expect(context.workspaceManager.reloadFile).not.toHaveBeenCalled()
    expect(context.workspaceManager.closeFile).toHaveBeenCalledWith("src/deleted.ts")
    expect(context.workspaceManager.refreshFileTree).toHaveBeenCalled()
  })

  it("reloads clean external add and change events", async () => {
    const { context } = createContext({
      workspace: {
        activeFile: "src/main.ts",
        files: {
          "src/main.ts": "export const main = 1",
        },
      },
    })
    context.workspaceManager.reloadFile = vi.fn(async () => true)

    await handleExternalFileChange({ path: "src/main.ts", type: "change" }, context)

    expect(context.workspaceManager.reloadFile).toHaveBeenCalledWith("src/main.ts")
    expect(context.syncEditorFromWorkspace).toHaveBeenCalled()
    expect(context.refreshActiveAnalysis).toHaveBeenCalledWith("src/main.ts")
  })

  it("replaces only the first precise occurrence when repeated matches are collapsed on one line", async () => {
    const { context } = createContext({
      workspace: { activeFile: "src/repeated.ts", files: { "src/repeated.ts": "const value = needle + needle\n" } },
      workspaceManager: {
        getAllFiles: () => ({ "src/repeated.ts": "const value = needle + needle\n" }),
        updateFile: vi.fn(),
        readProjectFile: vi.fn(async () => null),
        saveFile: vi.fn(async () => true),
        getRelativePath: (path: string) => path,
        isDirty: () => false,
        markChangedExternally: vi.fn(),
        reloadFile: vi.fn(),
        closeFile: vi.fn(),
        refreshFileTree: vi.fn(),
      },
      getReplaceQuery: () => "haystack",
      keepSearchViewActive: vi.fn(),
      getGrepResults: () => [
        {
          path: "src/repeated.ts",
          matches: [
            {
              line: 1,
              column: 15,
              matchLength: 6,
              text: "const value = needle + needle",
              count: 2,
              occurrences: [
                { column: 15, matchLength: 6 },
                { column: 24, matchLength: 6 },
              ],
            },
          ],
        },
      ],
      createSearchPattern: () => /needle/g,
    })

    await replaceOne(context)

    expect(context.workspaceManager.saveFile).toHaveBeenCalledWith(
      "src/repeated.ts",
      "const value = haystack + needle\n",
      expect.objectContaining({ reason: "search replace" }),
    )
    expect(context.refreshSearchResults).toHaveBeenCalledWith("needle")
    expect(context.keepSearchViewActive).toHaveBeenCalled()
  })

  it("reports file navigation owner evidence for the current resultTree match", async () => {
    const reportNavigationStage = vi.fn()
    const { editor, context } = createContext({
      workspace: { activeFile: "src/app.ts", files: { "src/app.ts": "export const app = 'needle'\n" } },
      reportNavigationStage,
    })

    await openFileAtLocation("src/app.ts", { line: 1, column: 21, matchLength: 6 }, context)

    expect(editor.setSelection).toHaveBeenCalledWith({
      startLineNumber: 1,
      startColumn: 21,
      endLineNumber: 1,
      endColumn: 27,
    })
    expect(reportNavigationStage).toHaveBeenCalledWith("owner:search-navigation", expect.objectContaining({
      path: "src/app.ts",
      line: 1,
      column: 21,
      matchLength: 6,
      actionOwner: "SearchFileActions",
      currentMatchOwner: "searchModel.resultTree",
      openFileOwner: "navigationService.openLocation",
      fileActionNavigation: "Search resultTree match -> navigationService.openLocation",
      rawMatchesRole: "adapter-normalization-only",
      secondSearchStateSource: false,
    }))
  })

  it("exposes a stable file action owner evidence contract", () => {
    expect(createSearchFileActionOwnerEvidence()).toEqual(expect.objectContaining({
      textSearchProvider: "ISearchService.textSearch",
      resultTree: "searchModel.resultTree",
      replacePreview: "IReplaceService.openReplacePreview-compatible",
      applyReplace: "IReplaceService.replaceOne/replaceAll -> bulkEditService.apply",
      fileActionNavigation: "Search resultTree match -> navigationService.openLocation",
      history: "SearchHistoryService",
      contextKeys: "SearchContext",
      actionOwner: "SearchFileActions",
      currentMatchOwner: "searchModel.resultTree",
      openFileOwner: "navigationService.openLocation",
      rawMatchesRole: "adapter-normalization-only",
      secondSearchStateSource: false,
    }))
  })

  it("keeps CRLF line endings when replacing one precise search match", async () => {
    const { context } = createContext({
      workspace: { activeFile: "src/crlf.ts", files: { "src/crlf.ts": "first needle\r\nsecond needle\r\n" } },
      workspaceManager: {
        getAllFiles: () => ({ "src/crlf.ts": "first needle\r\nsecond needle\r\n" }),
        updateFile: vi.fn(),
        readProjectFile: vi.fn(async () => null),
        saveFile: vi.fn(async () => true),
        getRelativePath: (path: string) => path,
        isDirty: () => false,
        markChangedExternally: vi.fn(),
        reloadFile: vi.fn(),
        closeFile: vi.fn(),
        refreshFileTree: vi.fn(),
      },
      getReplaceQuery: () => "haystack",
      keepSearchViewActive: vi.fn(),
      getGrepResults: () => [
        {
          path: "src/crlf.ts",
          matches: [
            {
              line: 2,
              column: 8,
              matchLength: 6,
              text: "second needle",
              occurrences: [{ column: 8, matchLength: 6 }],
            },
          ],
        },
      ],
      createSearchPattern: () => /needle/g,
    })

    await replaceOne(context)

    expect(context.workspaceManager.saveFile).toHaveBeenCalledWith(
      "src/crlf.ts",
      "first needle\r\nsecond haystack\r\n",
      expect.objectContaining({ reason: "search replace" }),
    )
  })

  it("replaces matches in unopened project files by reading and saving real workspace content", async () => {
    const readProjectFile = vi.fn(async (path: string) => {
      if (path === "src/unopened-a.ts") return "export const a = 'needle'\n"
      if (path === "src/unopened-b.ts") return "export const b = 'needle needle'\n"
      return null
    })
    const saveFile = vi.fn(async () => true)
    const { context } = createContext({
      workspace: { activeFile: null, files: {} },
      workspaceManager: {
        getAllFiles: () => ({}),
        updateFile: vi.fn(),
        readProjectFile,
        saveFile,
        getRelativePath: (path: string) => path,
        isDirty: () => false,
        markChangedExternally: vi.fn(),
        reloadFile: vi.fn(),
        closeFile: vi.fn(),
        refreshFileTree: vi.fn(),
      },
      getReplaceQuery: () => "haystack",
      keepSearchViewActive: vi.fn(),
      getGrepResults: () => [
        { path: "src/unopened-a.ts", matches: [{ line: 1, column: 19, matchLength: 6 }] },
        { path: "src/unopened-b.ts", matches: [{ line: 1, column: 19, matchLength: 6, count: 2 }] },
      ],
      createSearchPattern: () => /needle/g,
    })

    await replaceAll(context)

    expect(readProjectFile).toHaveBeenCalledWith("src/unopened-a.ts")
    expect(readProjectFile).toHaveBeenCalledWith("src/unopened-b.ts")
    expect(saveFile).toHaveBeenCalledWith(
      "src/unopened-a.ts",
      "export const a = 'haystack'\n",
      expect.objectContaining({ reason: "search replace" }),
    )
    expect(saveFile).toHaveBeenCalledWith(
      "src/unopened-b.ts",
      "export const b = 'haystack haystack'\n",
      expect.objectContaining({ reason: "search replace" }),
    )
    expect(context.keepSearchViewActive).toHaveBeenCalled()
  })

  it("refreshes replace all results after the workspace save path and exposes watcher-stable search state", async () => {
    const savedContent: Record<string, string> = {
      "src/repeated.ts": "export const repeated = 'needle needle'\n",
      "src/other.ts": "export const other = 'needle'\n",
    }
    const saveFile = vi.fn(async (path: string, content: string) => {
      savedContent[path] = content
      return true
    })
    const refreshSearchResults = vi.fn(async (query: string) => {
      const remaining = Object.values(savedContent).filter((content) => content.includes(query)).length
      expect(remaining).toBe(0)
    })
    const { context } = createContext({
      workspace: { activeFile: null, files: {} },
      workspaceManager: {
        getAllFiles: () => savedContent,
        updateFile: vi.fn(),
        readProjectFile: vi.fn(async (path: string) => savedContent[path] ?? null),
        saveFile,
        getRelativePath: (path: string) => path,
        isDirty: () => false,
        markChangedExternally: vi.fn(),
        reloadFile: vi.fn(),
        closeFile: vi.fn(),
        refreshFileTree: vi.fn(),
      },
      getReplaceQuery: () => "haystack",
      keepSearchViewActive: vi.fn(),
      refreshSearchResults,
      getGrepResults: () => [
        {
          path: "src/repeated.ts",
          matches: [{
            line: 1,
            column: 26,
            matchLength: 6,
            text: "export const repeated = 'needle needle'",
            occurrences: [
              { column: 26, matchLength: 6 },
              { column: 33, matchLength: 6 },
            ],
          }],
        },
        { path: "src/other.ts", matches: [{ line: 1, column: 23, matchLength: 6 }] },
      ],
      createSearchPattern: () => /needle/g,
    })

    const result = await replaceAll(context)

    expect(result?.summary.changedFiles).toEqual(["src/repeated.ts", "src/other.ts"])
    expect(saveFile).toHaveBeenCalledTimes(2)
    expect(refreshSearchResults).toHaveBeenCalledWith("needle")
    expect(context.keepSearchViewActive).toHaveBeenCalled()
  })

  it("previews replace all through dry-run without saving or refreshing results", async () => {
    const readProjectFile = vi.fn(async (path: string) => {
      if (path === "src/unopened-a.ts") return "export const a = 'needle'\n"
      if (path === "src/unopened-b.ts") return "export const b = 'needle needle'\n"
      return null
    })
    const saveFile = vi.fn(async () => true)
    const { context } = createContext({
      workspace: { activeFile: null, files: {} },
      workspaceManager: {
        getAllFiles: () => ({}),
        updateFile: vi.fn(),
        readProjectFile,
        saveFile,
        getRelativePath: (path: string) => path,
        isDirty: () => false,
        markChangedExternally: vi.fn(),
        reloadFile: vi.fn(),
        closeFile: vi.fn(),
        refreshFileTree: vi.fn(),
      },
      getReplaceQuery: () => "haystack",
      keepSearchViewActive: vi.fn(),
      getGrepResults: () => [
        { path: "src/unopened-a.ts", matches: [{ line: 1, column: 19, matchLength: 6 }] },
        { path: "src/unopened-b.ts", matches: [{ line: 1, column: 19, matchLength: 6, count: 2 }] },
      ],
      createSearchPattern: () => /needle/g,
    })

    const result = await replaceAll(context, { dryRun: true })

    expect(result).toEqual(expect.objectContaining({
      applied: false,
      dryRun: true,
      summary: expect.objectContaining({
        changedFileCount: 2,
        changedFiles: ["src/unopened-a.ts", "src/unopened-b.ts"],
        editCount: 3,
        riskLevel: "medium",
      }),
    }))
    expect(readProjectFile).toHaveBeenCalledWith("src/unopened-a.ts")
    expect(readProjectFile).toHaveBeenCalledWith("src/unopened-b.ts")
    expect(saveFile).not.toHaveBeenCalled()
    expect(context.refreshSearchResults).not.toHaveBeenCalled()
    expect(context.keepSearchViewActive).not.toHaveBeenCalled()
  })

  it("drives replace all from the workbench result tree instead of raw search matches", async () => {
    const searchProjection = projectTextSearchWorkbenchResult({
      matches: [
        { path: "src/tree-owned.ts", line: 1, column: 19, matchLength: 6, preview: "export const a = 'needle'" },
        { path: "src/raw-only.ts", line: 1, column: 19, matchLength: 6, preview: "export const b = 'needle'" },
      ],
      fileContents: {
        "src/tree-owned.ts": "export const a = 'needle'\n",
        "src/raw-only.ts": "export const b = 'needle'\n",
      },
    }, {
      includeMatch: (path) => path === "src/tree-owned.ts",
    })
    const savedContent: Record<string, string> = {
      "src/tree-owned.ts": "export const a = 'needle'\n",
      "src/raw-only.ts": "export const b = 'needle'\n",
    }
    const saveFile = vi.fn(async (path: string, content: string) => {
      savedContent[path] = content
      return true
    })
    const { context } = createContext({
      workspace: { activeFile: null, files: {} },
      workspaceManager: {
        getAllFiles: () => savedContent,
        updateFile: vi.fn(),
        readProjectFile: vi.fn(async (path: string) => savedContent[path] ?? null),
        saveFile,
        getRelativePath: (path: string) => path,
        isDirty: () => false,
        markChangedExternally: vi.fn(),
        reloadFile: vi.fn(),
        closeFile: vi.fn(),
        refreshFileTree: vi.fn(),
      },
      getReplaceQuery: () => "haystack",
      keepSearchViewActive: vi.fn(),
      getGrepResults: () => searchProjection.resultTree,
      createSearchPattern: () => /needle/g,
    })

    const result = await replaceAll(context)

    expect(searchProjection.rawMatches.map((match) => match.path)).toEqual(["src/tree-owned.ts", "src/raw-only.ts"])
    expect(searchProjection.resultTree.map((group) => group.path)).toEqual(["src/tree-owned.ts"])
    expect(result?.summary.changedFiles).toEqual(["src/tree-owned.ts"])
    expect(saveFile).toHaveBeenCalledTimes(1)
    expect(saveFile).toHaveBeenCalledWith(
      "src/tree-owned.ts",
      "export const a = 'haystack'\n",
      expect.objectContaining({ reason: "search replace" }),
    )
    expect(saveFile).not.toHaveBeenCalledWith(
      "src/raw-only.ts",
      expect.any(String),
      expect.any(Object),
    )
    expect(savedContent["src/raw-only.ts"]).toBe("export const b = 'needle'\n")
    expect(result?.projection).toEqual(expect.objectContaining({
      source: "workspaceEditService",
      label: "search replace",
      changedResources: ["src/tree-owned.ts"],
    }))
    expect(context.refreshSearchResults).toHaveBeenCalledWith("needle")
    expect(context.keepSearchViewActive).toHaveBeenCalled()
  })

  it("reports replace preview and apply owner evidence while applying resultTree matches", async () => {
    const reportNavigationStage = vi.fn()
    const savedContent: Record<string, string> = {
      "src/tree-owned.ts": "export const a = 'needle needle'\n",
    }
    const saveFile = vi.fn(async (path: string, content: string) => {
      savedContent[path] = content
      return true
    })
    const searchProjection = projectTextSearchWorkbenchResult({
      matches: [
        { path: "src/tree-owned.ts", line: 1, column: 19, matchLength: 6, preview: "export const a = 'needle needle'" },
        { path: "src/tree-owned.ts", line: 1, column: 26, matchLength: 6, preview: "export const a = 'needle needle'" },
      ],
      fileContents: savedContent,
    })
    const { context } = createContext({
      workspace: { activeFile: null, files: {} },
      reportNavigationStage,
      workspaceManager: {
        getAllFiles: () => savedContent,
        updateFile: vi.fn(),
        readProjectFile: vi.fn(async (path: string) => savedContent[path] ?? null),
        saveFile,
        getRelativePath: (path: string) => path,
        isDirty: () => false,
        markChangedExternally: vi.fn(),
        reloadFile: vi.fn(),
        closeFile: vi.fn(),
        refreshFileTree: vi.fn(),
      },
      getReplaceQuery: () => "haystack",
      keepSearchViewActive: vi.fn(),
      getGrepResults: () => searchProjection.resultTree,
      createSearchPattern: () => /needle/g,
    })

    const result = await replaceAll(context)

    expect(result?.summary.changedFiles).toEqual(["src/tree-owned.ts"])
    expect(saveFile).toHaveBeenCalledWith(
      "src/tree-owned.ts",
      "export const a = 'haystack haystack'\n",
      expect.objectContaining({ reason: "search replace" }),
    )
    expect(reportNavigationStage).toHaveBeenCalledWith("owner:replace-preview", expect.objectContaining({
      mode: "all",
      fileCount: 1,
      matchCount: 1,
      actionOwner: "SearchFileActions",
      currentMatchOwner: "searchModel.resultTree",
      replacePreview: "IReplaceService.openReplacePreview-compatible",
      rawMatchesRole: "adapter-normalization-only",
      secondSearchStateSource: false,
    }))
    expect(reportNavigationStage).toHaveBeenCalledWith("owner:replace-apply", expect.objectContaining({
      mode: "all",
      changedFiles: ["src/tree-owned.ts"],
      applyReplace: "IReplaceService.replaceOne/replaceAll -> bulkEditService.apply",
      resultTree: "searchModel.resultTree",
    }))
  })

  it("returns replace one summary for smoke evidence while preserving normal apply behavior", async () => {
    const { context } = createContext({
      workspace: { activeFile: "src/repeated.ts", files: { "src/repeated.ts": "const value = needle + needle\n" } },
      workspaceManager: {
        getAllFiles: () => ({ "src/repeated.ts": "const value = needle + needle\n" }),
        updateFile: vi.fn(),
        readProjectFile: vi.fn(async () => null),
        saveFile: vi.fn(async () => true),
        getRelativePath: (path: string) => path,
        isDirty: () => false,
        markChangedExternally: vi.fn(),
        reloadFile: vi.fn(),
        closeFile: vi.fn(),
        refreshFileTree: vi.fn(),
      },
      getReplaceQuery: () => "haystack",
      keepSearchViewActive: vi.fn(),
      getGrepResults: () => [
        {
          path: "src/repeated.ts",
          matches: [{
            line: 1,
            column: 15,
            matchLength: 6,
            text: "const value = needle + needle",
            occurrences: [
              { column: 15, matchLength: 6 },
              { column: 24, matchLength: 6 },
            ],
          }],
        },
      ],
      createSearchPattern: () => /needle/g,
    })

    const result = await replaceOne(context)

    expect(result).toEqual(expect.objectContaining({
      applied: true,
      dryRun: false,
      summary: expect.objectContaining({
        changedFileCount: 1,
        changedFiles: ["src/repeated.ts"],
        editCount: 1,
        riskLevel: "safe",
      }),
      projection: expect.objectContaining({
        source: "workspaceEditService",
        label: "search replace",
        changedResources: ["src/repeated.ts"],
        rollbackRisk: "none",
        resources: [expect.objectContaining({
          resource: "src/repeated.ts",
          state: "changed",
          evidence: expect.objectContaining({
            source: "user",
            reason: "search replace",
            label: "search replace",
          }),
        })],
      }),
    }))
    expect(context.workspaceManager.saveFile).toHaveBeenCalledWith(
      "src/repeated.ts",
      "const value = haystack + needle\n",
      expect.objectContaining({ reason: "search replace" }),
    )
    expect(context.refreshSearchResults).toHaveBeenCalledWith("needle")
    expect(context.keepSearchViewActive).toHaveBeenCalled()
  })

  it("does not refresh search results when the workspace save path rejects replace all", async () => {
    const saveFile = vi.fn(async () => false)
    const { context } = createContext({
      workspace: { activeFile: null, files: {} },
      workspaceManager: {
        getAllFiles: () => ({ "src/rejected.ts": "export const value = 'needle'\n" }),
        updateFile: vi.fn(),
        readProjectFile: vi.fn(async () => null),
        saveFile,
        getRelativePath: (path: string) => path,
        isDirty: () => false,
        markChangedExternally: vi.fn(),
        reloadFile: vi.fn(),
        closeFile: vi.fn(),
        refreshFileTree: vi.fn(),
      },
      getReplaceQuery: () => "haystack",
      keepSearchViewActive: vi.fn(),
      getGrepResults: () => [
        { path: "src/rejected.ts", matches: [{ line: 1, column: 23, matchLength: 6 }] },
      ],
      createSearchPattern: () => /needle/g,
    })

    await replaceAll(context)

    expect(saveFile).toHaveBeenCalledWith(
      "src/rejected.ts",
      "export const value = 'haystack'\n",
      expect.objectContaining({ reason: "search replace" }),
    )
    expect(context.refreshSearchResults).not.toHaveBeenCalled()
    expect(context.keepSearchViewActive).not.toHaveBeenCalled()
  })
})
