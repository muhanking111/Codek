import { describe, expect, it, vi } from "vitest"
import { gotoLine, openDiagnostic, revealLocation, selectSymbol, updateBreadcrumbState } from "./navigationActions"
import type { NavigationActionContext } from "./navigationActions"
import { WorkbenchExplorerEditorService } from "./workbenchExplorerEditorService"

function createContext(): { context: NavigationActionContext; editor: Record<string, unknown>; openFile: ReturnType<typeof vi.fn> } {
  const editor = {
    focus: vi.fn(),
    setPosition: vi.fn(),
    setSelection: vi.fn(),
    revealPositionInCenter: vi.fn(),
    revealLineInCenter: vi.fn(),
    getModel: vi.fn(),
    getPosition: vi.fn(),
  }
  const workspace = {
    activeFile: "src/current.ts",
    projectRoot: "D:/Workspace",
  }
  const openFile = vi.fn(async (path: string) => {
    workspace.activeFile = path
    return true
  })
  return {
    editor,
    openFile,
    context: {
      getEditor: () => editor,
      getMonacoApi: () => ({}),
      getWorkspace: () => workspace,
      openFile,
      updateSelectedSymbol: vi.fn(),
      openSidebarView: vi.fn(),
      setSymbolQuery: vi.fn(),
      nextTick: vi.fn(),
      getBreadcrumbPath: vi.fn(() => []),
      getSymbolBreadcrumb: vi.fn(() => []),
      getBreadcrumbState: () => ({ path: [], symbols: [], activeDropdown: null }),
      setBreadcrumbPath: vi.fn(),
      setBreadcrumbSymbols: vi.fn(),
      setActiveBreadcrumbDropdown: vi.fn(),
    },
  }
}

describe("navigationActions shared location service", () => {
  it("reveals diagnostics through the shared location path", async () => {
    const { context, editor, openFile } = createContext()

    await openDiagnostic({ file: "ignored.ts", path: "src/problem.ts", line: 10, column: 4 }, context)

    expect(openFile).toHaveBeenCalledWith("src/problem.ts")
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 10, column: 4 })
    expect(editor.revealPositionInCenter).toHaveBeenCalledWith({ lineNumber: 10, column: 4 })
  })

  it("selects symbols and opens their file through the same location path", async () => {
    const { context, editor, openFile } = createContext()

    await selectSymbol({ name: "run", path: "src/run.ts", line: 3, column: 7 }, context)

    expect(context.updateSelectedSymbol).toHaveBeenCalledWith("run")
    expect(openFile).toHaveBeenCalledWith("src/run.ts")
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 3, column: 7 })
  })

  it("keeps goto line on the active editor without opening another file", () => {
    const { context, editor, openFile } = createContext()

    gotoLine(22, context)

    expect(openFile).not.toHaveBeenCalled()
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 22, column: 1 })
    expect(editor.revealLineInCenter).toHaveBeenCalledWith(22)
  })

  it("keeps invalid goto line requests from moving the editor", () => {
    const { context, editor, openFile } = createContext()

    gotoLine("not-a-line", context)

    expect(openFile).not.toHaveBeenCalled()
    expect(editor.setPosition).not.toHaveBeenCalled()
    expect(editor.revealLineInCenter).not.toHaveBeenCalled()
  })

  it("does not move editor position when target file cannot be opened", async () => {
    const { context, editor, openFile } = createContext()
    openFile.mockResolvedValueOnce(false)

    await revealLocation("src/missing.ts", 2, 1, context)

    expect(editor.setPosition).not.toHaveBeenCalled()
  })

  it("updates breadcrumbs from the same active editor source and clears after close", () => {
    const { context } = createContext()
    const workspace = context.getWorkspace()
    const breadcrumbPath = [{ name: "src" }, { name: "current.ts" }]
    const breadcrumbSymbols = [{ name: "run", kind: "function", range: { startLine: 4 } }]
    context.getBreadcrumbPath = vi.fn(() => breadcrumbPath)
    context.getSymbolBreadcrumb = vi.fn((_model, _position, activeFile) => activeFile === "src/current.ts" ? breadcrumbSymbols : [])
    context.clearBreadcrumbState = vi.fn()

    updateBreadcrumbState(context)

    expect(context.getSymbolBreadcrumb).toHaveBeenCalledWith(undefined, undefined, "src/current.ts")
    expect(context.setBreadcrumbPath).toHaveBeenCalledWith(breadcrumbPath)
    expect(context.setBreadcrumbSymbols).toHaveBeenCalledWith(breadcrumbSymbols)

    workspace.activeFile = null
    updateBreadcrumbState(context)

    expect(context.clearBreadcrumbState).toHaveBeenCalledTimes(1)
  })

  it("publishes breadcrumb updates through the shared workbench explorer/editor service", () => {
    const { context } = createContext()
    const service = new WorkbenchExplorerEditorService()
    context.workbenchExplorerEditorService = service
    context.getBreadcrumbPath = vi.fn(() => [{ name: "src" }, { name: "current.ts" }])
    context.getSymbolBreadcrumb = vi.fn(() => [{ name: "run", kind: "function", range: { startLine: 4 } }])

    updateBreadcrumbState(context)

    expect(service.getBreadcrumbs()).toEqual(expect.objectContaining({
      source: "workbenchExplorerEditorService",
      pathCount: 2,
      symbolCount: 1,
      displayModel: expect.objectContaining({
        visible: true,
        elements: expect.arrayContaining([expect.objectContaining({ label: "run()" })]),
      }),
    }))
  })
})
