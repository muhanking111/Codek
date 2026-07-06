import { beforeEach, describe, expect, it, vi } from "vitest"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"
import { MenuId, MenuRegistry } from "../vscode-adapter/platform/actions/common/menuRegistry"
import { MarkerService } from "../vscode-adapter/platform/markers/common/markers"
import { clearCommands, executeCommand, getCommand, searchCommands } from "./commandRegistry"
import { WorkbenchExplorerEditorService } from "./workbenchExplorerEditorService"
import { ProblemsDiagnosticsService } from "./problemsDiagnosticsService"
import {
  SymbolNavigationWorkbenchService,
  type CodekSymbolInformation,
} from "./symbolNavigationService"
import {
  EDITOR_WORKBENCH_COMMAND_IDS,
  IEditorService,
  IOutlineService,
  buildEditorWorkbenchContributionSurface,
  disposeEditorWorkbenchContributions,
  registerEditorWorkbenchContributions,
  type EditorWorkbenchContributionContext,
} from "./editorWorkbenchContributions"

function symbol(overrides: Partial<CodekSymbolInformation> = {}): CodekSymbolInformation {
  return {
    name: "run",
    kind: "function",
    path: "src/main.ts",
    line: 4,
    column: 2,
    detail: "",
    range: { startLineNumber: 4, startColumn: 2, endLineNumber: 8, endColumn: 1 },
    ...overrides,
  }
}

function createContext(): EditorWorkbenchContributionContext & {
  editorService: WorkbenchExplorerEditorService
  outlineService: SymbolNavigationWorkbenchService
  problemsService: ProblemsDiagnosticsService
} {
  const editorService = new WorkbenchExplorerEditorService()
  const outlineService = new SymbolNavigationWorkbenchService()
  const markerService = new MarkerService()
  const problemsService = new ProblemsDiagnosticsService(markerService)
  const activeFile = { value: "src/main.ts" }

  outlineService.registerDocumentSymbolProvider({
    provideDocumentSymbols: (path) => [
      symbol({ name: "Runner", kind: "class", path, line: 1, column: 1, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 20, endColumn: 1 } }),
      symbol({ name: "run", kind: "method", path, line: 4, column: 3, range: { startLineNumber: 4, startColumn: 3, endLineNumber: 6, endColumn: 1 } }),
    ],
  })
  outlineService.registerWorkspaceSymbolProvider({
    provideWorkspaceSymbols: (query) => [
      symbol({ name: `workspace:${query}`, path: "src/workspace.ts", line: 9, column: 1 }),
    ],
  })

  return {
    editorService,
    outlineService,
    problemsService,
    getEditor: () => ({
      setPosition: vi.fn(),
      revealPositionInCenter: vi.fn(),
      focus: vi.fn(),
    }),
    getActiveFile: () => activeFile.value,
    openFile: vi.fn(async (path: string) => {
      activeFile.value = path
      return true
    }),
    openSidebarView: vi.fn(),
    setSymbolQuery: vi.fn(),
    setProblemsVisible: vi.fn(),
    nextTick: (callback?: () => void) => {
      callback?.()
      return Promise.resolve()
    },
  }
}

beforeEach(() => {
  disposeEditorWorkbenchContributions()
  clearCommands()
  MenuRegistry.clear()
})

describe("editor workbench contributions bridge", () => {
  it("registers editor, outline, breadcrumbs and problems as VS Code-style contributions", async () => {
    const context = createContext()
    const disposable = registerEditorWorkbenchContributions(context)

    const surface = buildEditorWorkbenchContributionSurface()
    expect(surface.services.map((service) => service.id)).toEqual([
      "editorService",
      "outlineService",
      "markerService",
    ])
    expect(surface.stateSources).toEqual({
      editor: "workbenchExplorerEditorService",
      breadcrumbs: "workbenchExplorerEditorService",
      outline: "symbolNavigationWorkbenchService",
      problems: "problemsDiagnosticsService(globalMarkerService)",
    })
    expect(surface.commandsByArea.outline).toContain(EDITOR_WORKBENCH_COMMAND_IDS.EditorSymbols)
    expect(surface.commandsByArea.problems).toContain(EDITOR_WORKBENCH_COMMAND_IDS.ToggleProblems)

    const collection = new ServiceCollection(
      [IEditorService, context.editorService],
      [IOutlineService, context.outlineService],
    )
    expect(collection.get(IEditorService)).toBe(context.editorService)
    expect(collection.get(IOutlineService)).toBe(context.outlineService)

    await expect(executeCommand(EDITOR_WORKBENCH_COMMAND_IDS.EditorSymbols, [], { editorTextFocus: true })).resolves.toBe(true)
    expect(context.openSidebarView).toHaveBeenCalledWith("symbols")
    expect(context.setSymbolQuery).toHaveBeenCalledWith("@")

    disposable.dispose()
  })

  it("updates breadcrumbs and outline through the shared service models", async () => {
    const context = createContext()
    registerEditorWorkbenchContributions(context)

    context.editorService.openEditor("src/main.ts")
    const breadcrumbs = context.editorService.updateBreadcrumbs({
      path: [{ name: "src" }, { name: "main.ts" }],
      symbols: [{ name: "Runner", kind: "class", range: { startLine: 1 } }],
    })

    const outline = await context.outlineService.getOutlineModel("src/main.ts")

    expect(breadcrumbs).toMatchObject({
      source: "workbenchExplorerEditorService",
      activeEditor: "src/main.ts",
      pathCount: 2,
      symbolCount: 1,
    })
    expect(outline).toMatchObject({
      uri: "src/main.ts",
      outlineKind: "codek.analysis",
      elements: [
        expect.objectContaining({
          label: "Runner",
          children: [expect.objectContaining({ label: "run" })],
        }),
      ],
    })
  })

  it("projects diagnostics from IMarkerService into the Problems facade without adding another source", () => {
    const context = createContext()
    registerEditorWorkbenchContributions(context)

    context.problemsService.replaceSourceDiagnosticsForFile("src/main.ts", "monaco", [
      { file: "src/main.ts", line: 2, column: 5, message: "Unexpected token", severity: "error", source: "TypeScript" },
    ])

    const projection = context.problemsService.createVisibleProjection()
    expect(projection.summary).toEqual(expect.objectContaining({
      diagnosticCount: 1,
      errorCount: 1,
      sourceNames: ["TypeScript"],
    }))
    expect(projection.viewModel.sourceGroups[0]?.fileGroups[0]?.items[0]).toEqual(expect.objectContaining({
      file: "src/main.ts",
      message: "Unexpected token",
    }))
  })

  it("contributes command palette and menu entries, including legacy proxies", async () => {
    const context = createContext()
    registerEditorWorkbenchContributions(context)

    const goMenuEntries = MenuRegistry.getMenuEntries(MenuId.MenubarGoMenu, { editorTextFocus: true })
    const paletteEntries = MenuRegistry.getMenuEntries(MenuId.CommandPalette, { editorTextFocus: true })

    expect(goMenuEntries.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      EDITOR_WORKBENCH_COMMAND_IDS.EditorSymbols,
      EDITOR_WORKBENCH_COMMAND_IDS.WorkspaceSymbols,
      EDITOR_WORKBENCH_COMMAND_IDS.NextProblem,
      EDITOR_WORKBENCH_COMMAND_IDS.PreviousProblem,
    ]))
    expect(paletteEntries.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      EDITOR_WORKBENCH_COMMAND_IDS.ToggleProblems,
      EDITOR_WORKBENCH_COMMAND_IDS.EditorSymbols,
    ]))
    expect(searchCommands("symbol").map((command) => command.id)).toEqual(expect.arrayContaining([
      EDITOR_WORKBENCH_COMMAND_IDS.WorkspaceSymbols,
    ]))

    await expect(executeCommand("workbench.action.gotoSymbol", ["query"])).resolves.toBe(true)
    await expect(executeCommand("outline.focus")).resolves.toBe(true)
    await expect(executeCommand("workbench.actions.view.problems")).resolves.toBe(true)

    expect(context.openSidebarView).toHaveBeenCalledWith("symbols")
    expect(context.setSymbolQuery).toHaveBeenCalledWith("query")
    expect(context.setProblemsVisible).toHaveBeenCalledWith(true)
    expect(getCommand(EDITOR_WORKBENCH_COMMAND_IDS.WorkspaceSymbols)?.source).toBe("vscode")
  })
})
