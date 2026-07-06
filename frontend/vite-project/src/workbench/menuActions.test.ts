import { afterEach, describe, expect, it, vi } from "vitest"
import { clearCommands, registerCommand } from "./commandRegistry"
import { runWorkbenchMenuAction, type WorkbenchMenuActionContext } from "./menuActions"
import { MenuRegistry } from "../vscode-adapter/platform/actions/common/menuRegistry"
import {
  TERMINAL_DEBUG_TASK_COMMAND_IDS,
  TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS,
  disposeTerminalDebugTaskWorkbenchContributions,
  globalPaneCompositePartService,
  registerTerminalDebugTaskWorkbenchContributions,
} from "./terminalDebugTaskWorkbench"

function createMenuContext(): WorkbenchMenuActionContext {
  return {
    getActiveFile: vi.fn(() => "src/main.ts"),
    getOpenFiles: vi.fn(() => ["src/main.ts"]),
    getEditor: vi.fn(() => null),
    getSplitEditor: vi.fn(() => null),
    isSplitOpen: vi.fn(() => false),
    getDebugBreakpoints: vi.fn(() => []),
    setDebugBreakpoints: vi.fn(),
    setSearchReplaceQuery: vi.fn(),
    ensureSearchReplaceQuery: vi.fn(),
    setChatOpen: vi.fn(),
    setOutputPanelOpen: vi.fn(),
    handleCreateFile: vi.fn(),
    invokeDesktopWindowAction: vi.fn(),
    openCommandPalette: vi.fn(),
    handleOpenProject: vi.fn(),
    handleOpenWorkspaceFile: vi.fn(),
    handleAddFolderToWorkspace: vi.fn(),
    handleSaveWorkspaceAs: vi.fn(),
    handleSave: vi.fn(),
    toggleAutoSaveMode: vi.fn(),
    openSettingsSection: vi.fn(),
    reloadActiveFile: vi.fn(),
    handleCloseTab: vi.fn(),
    runEditorAction: vi.fn(),
    toggleMultiCursorModifier: vi.fn(),
    toggleColumnSelection: vi.fn(),
    toggleWorkbenchBoolean: vi.fn(),
    toggleSidebarView: vi.fn(),
    openSidebarView: vi.fn(),
    toggleProblemsPanel: vi.fn(),
    toggleChatPanel: vi.fn(),
    handleToggleSplit: vi.fn(),
    toggleWordWrapSetting: vi.fn(),
    navigateBack: vi.fn(),
    navigateForward: vi.fn(),
    openFileSwitcher: vi.fn(),
    sendSelectionToChat: vi.fn(),
    handleNewChat: vi.fn(),
    openGotoLine: vi.fn(),
    openNextProblem: vi.fn(),
    openProcessExplorer: vi.fn(),
    exportDiagnostics: vi.fn(),
    runConfiguredUpdateCheck: vi.fn(),
  }
}

describe("runWorkbenchMenuAction", () => {
  afterEach(() => {
    disposeTerminalDebugTaskWorkbenchContributions()
    clearCommands()
    MenuRegistry.clear()
    globalPaneCompositePartService.clear()
  })

  it("opens Process Explorer without routing through Output", async () => {
    const context = createMenuContext()

    await runWorkbenchMenuAction("openProcessExplorer", context)

    expect(context.openProcessExplorer).toHaveBeenCalledTimes(1)
    expect(context.setOutputPanelOpen).not.toHaveBeenCalled()
  })

  it("routes global search and replace through the Search workbench surface", async () => {
    const context = createMenuContext()

    await runWorkbenchMenuAction("globalSearch", context)
    await runWorkbenchMenuAction("globalReplace", context)

    expect(context.openSidebarView).toHaveBeenNthCalledWith(1, "search")
    expect(context.openSidebarView).toHaveBeenNthCalledWith(2, "search")
    expect(context.ensureSearchReplaceQuery).toHaveBeenCalledTimes(1)
  })

  it("toggles the VS Code-style Search view container from the View menu", async () => {
    const context = createMenuContext()

    await runWorkbenchMenuAction("toggleSearch", context)

    expect(context.toggleSidebarView).toHaveBeenCalledWith("search")
  })

  it("delegates contributed menubar actions to the shared command registry", async () => {
    const context = createMenuContext()
    const handler = vi.fn()
    registerCommand({
      id: "sample.hello",
      title: "Hello",
      source: "extension",
      handler,
    })

    await runWorkbenchMenuAction("sample.hello" as never, context)

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("passes menu action arguments through old entry proxies to contributed commands", async () => {
    const context = createMenuContext()
    const handler = vi.fn()
    registerCommand({
      id: "sample.openResource",
      title: "Open Resource",
      source: "extension",
      handler,
    })

    await runWorkbenchMenuAction("sample.openResource" as never, context, ["src/page.astro"])

    expect(handler).toHaveBeenCalledWith("src/page.astro")
  })

  it("routes old View menu Problems and Output entries through VS Code-style contribution commands", async () => {
    const context = createMenuContext()
    const calls: Array<{ action: string; id: string }> = []
    registerTerminalDebugTaskWorkbenchContributions({
      openPanel: async (id) => { calls.push({ action: "openPanel", id }) },
      openProblems: async (id) => { calls.push({ action: "openProblems", id }) },
    })

    await runWorkbenchMenuAction("toggleOutput", context, ["Workbench"])
    await runWorkbenchMenuAction("toggleProblems", context)

    expect(calls).toEqual([
      { action: "openPanel", id: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output },
      { action: "openProblems", id: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems },
    ])
    expect(context.setOutputPanelOpen).not.toHaveBeenCalled()
    expect(context.toggleProblemsPanel).not.toHaveBeenCalled()
    expect(globalPaneCompositePartService.getEvidence()).toEqual(expect.objectContaining({
      lastOpenedPanelId: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output,
      problemsOpened: true,
    }))
    expect(TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputShow).toBe("workbench.action.output.showOutput")
    expect(TERMINAL_DEBUG_TASK_COMMAND_IDS.ProblemsToggle).toBe("workbench.actions.view.toggleProblems")
  })
})
