import { getUnsupportedMenuCommandMessage } from "../components/menuCommandHelpers"
import type { MenuAction } from "../components/menuModel"
import { resolveEditorFeatureActionId } from "../editor/editorLanguageFeatureService"
import { executeCommand, getCommand } from "./commandRegistry"
import { TERMINAL_DEBUG_TASK_COMMAND_IDS } from "./terminalDebugTaskWorkbench"

interface EditorLike {
  focus?: () => void
  trigger?: (source: string, handlerId: string, payload: unknown) => void
}

export interface WorkbenchMenuActionContext {
  getActiveFile: () => string | null | undefined
  getOpenFiles: () => string[]
  getEditor: () => EditorLike | null
  getSplitEditor: () => EditorLike | null
  isSplitOpen: () => boolean
  getDebugBreakpoints: () => Array<{ enabled?: boolean }>
  setDebugBreakpoints: (breakpoints: Array<{ enabled?: boolean }>) => void
  setSearchReplaceQuery: (value: string) => void
  ensureSearchReplaceQuery: () => void
  setChatOpen: (open: boolean) => void
  setOutputPanelOpen: (open: boolean | ((current: boolean) => boolean)) => void
  handleCreateFile: () => void
  invokeDesktopWindowAction: (action: "newWindow" | "newAgentWindow" | "closeWindow" | "quit" | "toggleDeveloperTools" | "openLogs") => Promise<void>
  openCommandPalette: (mode?: "files") => void
  handleOpenProject: () => Promise<void>
  handleOpenWorkspaceFile: () => Promise<void>
  handleAddFolderToWorkspace: () => Promise<void>
  handleSaveWorkspaceAs: () => Promise<void>
  handleSave: (path?: string) => Promise<void>
  toggleAutoSaveMode: () => void
  openSettingsSection: (section: string) => void
  reloadActiveFile: () => Promise<void>
  handleCloseTab: (path: string) => Promise<void>
  runEditorAction: (actionId: string) => void
  toggleMultiCursorModifier: () => void
  toggleColumnSelection: () => void
  toggleWorkbenchBoolean: (key: string, fallback?: boolean) => void
  toggleSidebarView: (view: string) => void
  openSidebarView: (view: string) => void
  toggleProblemsPanel: () => void
  toggleChatPanel: () => void
  handleToggleSplit: () => void
  toggleWordWrapSetting: () => void
  navigateBack: () => Promise<void>
  navigateForward: () => Promise<void>
  openFileSwitcher: () => void
  sendSelectionToChat: () => void
  handleNewChat: () => void
  openGotoLine: () => void
  openNextProblem: (direction: 1 | -1) => void
  openProcessExplorer: () => Promise<void>
  exportDiagnostics: () => Promise<void>
  runConfiguredUpdateCheck: () => Promise<unknown>
}

export async function runWorkbenchMenuAction(
  action: MenuAction,
  context: WorkbenchMenuActionContext,
  args: unknown[] = [],
): Promise<void> {
  switch (action) {
    case "newFile":
      context.handleCreateFile()
      break
    case "newWindow":
    case "newAgentWindow":
    case "closeWindow":
    case "quit":
    case "toggleDeveloperTools":
    case "openLogs":
      await context.invokeDesktopWindowAction(action)
      break
    case "openFile":
    case "quickOpen":
      context.openCommandPalette("files")
      break
    case "openRecent":
      context.openCommandPalette("files")
      await openUnsupportedCommand(action)
      break
    case "openProject":
      await context.handleOpenProject()
      break
    case "openWorkspaceFile":
      await context.handleOpenWorkspaceFile()
      break
    case "addFolderToWorkspace":
      await context.handleAddFolderToWorkspace()
      break
    case "saveWorkspaceAs":
      await context.handleSaveWorkspaceAs()
      break
    case "duplicateWorkspace":
    case "share":
      await openUnsupportedCommand(action)
      context.openSidebarView("files")
      break
    case "save":
      await context.handleSave()
      break
    case "saveAs":
      await context.handleSave()
      await openUnsupportedCommand(action)
      break
    case "saveAll":
      await Promise.all(context.getOpenFiles().map((path) => context.handleSave(path)))
      break
    case "toggleAutoSave":
      context.toggleAutoSaveMode()
      break
    case "openCodekSettings":
      context.openSettingsSection("codek-settings")
      break
    case "openVsCodeSettings":
      context.openSettingsSection("vscode-settings")
      break
    case "openKeyboardShortcuts":
    case "openKeybindingsJson":
      context.openSettingsSection("keybindings")
      break
    case "openSettingsJson":
      context.openSettingsSection("advanced")
      break
    case "revertFile":
      await context.reloadActiveFile()
      break
    case "closeEditor": {
      const activeFile = context.getActiveFile()
      if (activeFile) await context.handleCloseTab(activeFile)
      break
    }
    case "undo":
      context.getEditor()?.trigger?.("menu", "undo", null)
      break
    case "redo":
      context.getEditor()?.trigger?.("menu", "redo", null)
      break
    case "cut":
      context.runEditorAction("editor.action.clipboardCutAction")
      break
    case "copy":
      context.runEditorAction("editor.action.clipboardCopyAction")
      break
    case "paste":
      context.runEditorAction("editor.action.clipboardPasteAction")
      break
    case "find":
      context.runEditorAction("actions.find")
      break
    case "replace":
      context.runEditorAction("editor.action.startFindReplaceAction")
      break
    case "globalSearch":
      context.openSidebarView("search")
      break
    case "globalReplace":
      context.openSidebarView("search")
      context.ensureSearchReplaceQuery()
      break
    case "toggleLineComment":
      context.runEditorAction("editor.action.commentLine")
      break
    case "toggleBlockComment":
      context.runEditorAction("editor.action.blockComment")
      break
    case "emmetExpand":
      context.runEditorAction("editor.emmet.action.expandAbbreviation")
      break
    case "selectAll":
      context.runEditorAction("editor.action.selectAll")
      break
    case "expandSelection":
      context.runEditorAction("editor.action.smartSelect.expand")
      break
    case "shrinkSelection":
      context.runEditorAction("editor.action.smartSelect.shrink")
      break
    case "copyLineUp":
      context.runEditorAction("editor.action.copyLinesUpAction")
      break
    case "copyLineDown":
      context.runEditorAction("editor.action.copyLinesDownAction")
      break
    case "moveLineUp":
      context.runEditorAction("editor.action.moveLinesUpAction")
      break
    case "moveLineDown":
      context.runEditorAction("editor.action.moveLinesDownAction")
      break
    case "repeatSelection":
    case "addSelectionToNextFindMatch":
      context.runEditorAction("editor.action.addSelectionToNextFindMatch")
      break
    case "addSelectionToPreviousFindMatch":
      context.runEditorAction("editor.action.addSelectionToPreviousFindMatch")
      break
    case "addCursorAbove":
      context.runEditorAction("editor.action.insertCursorAbove")
      break
    case "addCursorBelow":
      context.runEditorAction("editor.action.insertCursorBelow")
      break
    case "addCursorToLineEnds":
      context.runEditorAction("editor.action.insertCursorAtEndOfEachLineSelected")
      break
    case "selectAllOccurrences":
      context.runEditorAction("editor.action.selectHighlights")
      break
    case "toggleMultiCursorModifier":
      context.toggleMultiCursorModifier()
      break
    case "toggleColumnSelection":
      context.toggleColumnSelection()
      break
    case "commandPalette":
    case "showAllCommands":
      context.openCommandPalette()
      break
    case "toggleActivityBar":
      context.toggleWorkbenchBoolean("workbench.activityBar.visible", true)
      break
    case "toggleStatusBar":
      context.toggleWorkbenchBoolean("workbench.statusBar.visible", false)
      break
    case "toggleExplorer":
      context.toggleSidebarView("files")
      break
    case "toggleSearch":
      context.toggleSidebarView("search")
      break
    case "toggleSourceControl":
      context.toggleSidebarView("changes")
      break
    case "togglePlugins":
      context.toggleSidebarView("marketplace")
      break
    case "toggleProblems":
      if (await executeRegisteredCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.ProblemsToggle, args)) break
      context.toggleProblemsPanel()
      break
    case "toggleOutput":
      if (await executeRegisteredCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputShow, args)) break
      context.setOutputPanelOpen((current) => !current)
      break
    case "toggleChat":
      context.toggleChatPanel()
      break
    case "toggleGoals":
      context.toggleSidebarView("goals")
      break
    case "openAgentLogs":
      context.toggleSidebarView("orchestrator")
      break
    case "toggleSandbox":
    case "toggleToolAuth":
      context.openSettingsSection("agent")
      break
    case "toggleSplitEditor":
      context.handleToggleSplit()
      break
    case "toggleWordWrap":
      context.toggleWordWrapSetting()
      break
    case "navigateBack":
      await context.navigateBack()
      break
    case "navigateForward":
      await context.navigateForward()
      break
    case "lastEditLocation":
      context.getEditor()?.focus?.()
      break
    case "switchEditor":
      context.openFileSwitcher()
      break
    case "switchGroup":
      if (context.isSplitOpen() && context.getSplitEditor()) context.getSplitEditor()?.focus?.()
      else context.getEditor()?.focus?.()
      break
    case "workspaceSymbols":
    case "editorSymbols":
      context.openSidebarView("symbols")
      break
    case "goToDefinition":
      context.runEditorAction("editor.action.revealDefinition")
      break
    case "goToDeclaration":
      context.runEditorAction("editor.action.revealDeclaration")
      break
    case "goToTypeDefinition":
      context.runEditorAction("editor.action.goToTypeDefinition")
      break
    case "goToImplementation":
      context.runEditorAction("editor.action.goToImplementation")
      break
    case "findReferences":
      context.runEditorAction(resolveEditorFeatureActionId("findReferences"))
      break
    case "addSymbolToCurrentChat":
      context.sendSelectionToChat()
      break
    case "addSymbolToNewChat":
      context.handleNewChat()
      context.sendSelectionToChat()
      break
    case "gotoLine":
      context.openGotoLine()
      break
    case "goToBracket":
      context.runEditorAction("editor.action.jumpToBracket")
      break
    case "nextProblem":
      context.openNextProblem(1)
      break
    case "previousProblem":
      context.openNextProblem(-1)
      break
    case "nextChange":
    case "previousChange":
      context.openSidebarView("changes")
      break
    case "openProcessExplorer":
      await context.openProcessExplorer()
      break
    case "exportDiagnostics":
      context.setOutputPanelOpen(true)
      await context.exportDiagnostics()
      break
    case "checkUpdates":
      await context.runConfiguredUpdateCheck()
      context.openSettingsSection("advanced")
      break
    case "about":
    case "viewLicense":
      context.openSettingsSection("release")
      break
    case "openExtensionHostStatus":
      context.openSettingsSection("extensions")
      break
    case "openSandboxPolicy":
      context.openSettingsSection("agent")
      break
    case "editorPlayground":
    case "accessibilityGettingStarted":
    case "giveFeedback":
      context.openCommandPalette()
      break
    default:
      if (getCommand(action)) {
        await executeCommand(action, args)
        break
      }
      await openUnsupportedCommand(action)
      break
  }
}

async function executeRegisteredCommand(commandId: string, args: unknown[] = []): Promise<boolean> {
  if (!getCommand(commandId)) return false
  return executeCommand(commandId, args)
}

async function openUnsupportedCommand(action: MenuAction): Promise<void> {
  console.info(`[menu] ${action}: ${getUnsupportedMenuCommandMessage(action)}`)
}
