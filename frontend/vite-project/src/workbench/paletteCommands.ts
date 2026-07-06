import { buildMenuPaletteCommands } from "../components/menuCommandHelpers"
import type { MenuAction } from "../components/menuModel"
import { createEditorFeatureCommandRunner } from "../editor/editorLanguageFeatureService"
import { executeCommand, getCommand, registerCommand, registerCommandAlias } from "./commandRegistry"
import { TERMINAL_DEBUG_TASK_COMMAND_IDS } from "./terminalDebugTaskWorkbench"

type CommandCategory = "File" | "Edit" | "Selection" | "View" | "Navigation" | "Run" | "AI" | "Git" | "Help"

interface CommandPaletteCommand {
  id: string
  label: string
  category: CommandCategory
  shortcut?: string
  action?: () => void
}

interface CommandPaletteLike {
  registerCommands?: (commands: CommandPaletteCommand[]) => void
  open?: (mode?: "files" | string) => void
}

interface EditorLike {
  trigger?: (source: string, handlerId: string, payload: unknown) => void
}

interface WorkspaceLike {
  activeFile?: string | null
}

export interface CommandPaletteContext {
  t: (key: string) => string
  getCommandPalette: () => CommandPaletteLike | null | undefined
  getEditor: () => EditorLike | null
  getWorkspace: () => WorkspaceLike
  getOpenFiles: () => string[]
  saveActiveFile: () => void | Promise<void>
  saveFile: (path: string) => void | Promise<void>
  openSidebarView: (view: string) => void
  toggleChatPanel: () => void
  toggleSidebarVisibility: () => void
  toggleOutputPanel: () => void
  toggleCollab: () => void | Promise<void>
  toggleMinimap: () => void
  toggleSidebarView: (view: string) => void
  toggleLargeFile: () => void
  handleCloseTab: (path: string) => void | Promise<void>
  closeOtherTabs: (path: string) => void | Promise<void>
  closeAllSavedTabs: () => void | Promise<void>
  openGotoLine: () => void
  openFileSwitcher: () => void
  openInlineEdit: () => void
  handleMenuAction: (action: MenuAction) => void | Promise<void>
}

export function installCommandPaletteCommands(context: CommandPaletteContext): void {
  const t = context.t
  const getEditor = () => context.getEditor()
  const runEditorFeature = createEditorFeatureCommandRunner(getEditor)

  const commands: CommandPaletteCommand[] = [
    { id: "save", label: t("app.cmdSave"), category: "File", shortcut: "Ctrl+S", action: () => { void context.saveActiveFile() } },
    { id: "saveAll", label: t("app.cmdSaveAll"), category: "File", shortcut: "Ctrl+M S", action: () => { void Promise.all(context.getOpenFiles().map((path) => context.saveFile(path))) } },
    { id: "formatDocument", label: t("app.cmdFormat"), category: "Edit", shortcut: "Shift+Alt+F", action: () => { getEditor()?.trigger?.("keyboard", "editor.action.formatDocument", null) } },
    { id: "organizeImports", label: t("app.cmdOrganizeImports"), category: "Edit", shortcut: "Shift+Alt+O", action: () => { runEditorFeature("organizeImports") } },
    { id: "globalSearch", label: t("app.cmdGlobalSearch"), category: "Navigation", shortcut: "Ctrl+Shift+F", action: () => { context.openSidebarView("search") } },
    { id: "goToDefinition", label: t("app.cmdGoToDefinition"), category: "Navigation", shortcut: "F12", action: () => { getEditor()?.trigger?.("keyboard", "editor.action.revealDefinition", null) } },
    { id: "commandPalette", label: t("app.cmdCommandPalette"), category: "View", shortcut: "Ctrl+Shift+P", action: () => { context.getCommandPalette()?.open?.() } },
    { id: "closeTab", label: t("app.cmdCloseTab"), category: "File", shortcut: "Ctrl+W", action: () => { const activeFile = context.getWorkspace().activeFile; if (activeFile) void context.handleCloseTab(activeFile) } },
    { id: "closeOtherTabs", label: t("app.cmdCloseOtherTabs"), category: "File", action: () => { const activeFile = context.getWorkspace().activeFile; if (activeFile) void context.closeOtherTabs(activeFile) } },
    { id: "closeAllSavedTabs", label: t("app.cmdCloseAllSaved"), category: "File", action: () => { void context.closeAllSavedTabs() } },
    { id: "gotoLine", label: t("app.cmdGotoLine"), category: "Navigation", shortcut: "Ctrl+G", action: () => { context.openGotoLine() } },
    { id: "fileSwitcher", label: t("app.cmdFileSwitcher"), category: "Navigation", shortcut: "Ctrl+Tab", action: () => { context.openFileSwitcher() } },
    { id: "toggleMinimap", label: t("app.cmdToggleMinimap"), category: "View", shortcut: "Ctrl+Shift+M", action: () => { context.toggleMinimap() } },
    { id: "toggleGitPanel", label: t("app.cmdToggleGitPanel"), category: "Git", action: () => { context.toggleSidebarView("changes") } },
    { id: "toggleCollab", label: t("app.cmdToggleCollab"), category: "View", action: () => { void context.toggleCollab() } },
    { id: "openRemote", label: t("app.cmdOpenRemote"), category: "View", action: () => { context.openSidebarView("remote") } },
    {
      id: "openOutput",
      label: t("app.cmdOpenOutput"),
      category: "View",
      action: () => {
        void executeRegisteredCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputShow)
          .then((routed) => {
            if (!routed) context.toggleOutputPanel()
          })
      },
    },
    { id: "toggleLargeFile", label: t("app.cmdToggleLargeFile"), category: "View", action: () => { context.toggleLargeFile() } },
    { id: "findReferences", label: t("app.cmdFindReferences"), category: "Navigation", shortcut: "Shift+F12", action: () => { runEditorFeature("findReferences") } },
    { id: "renameSymbol", label: t("app.cmdRenameSymbol"), category: "Edit", shortcut: "F2", action: () => { runEditorFeature("renameSymbol") } },
    { id: "toggleComment", label: t("app.cmdToggleComment"), category: "Edit", shortcut: "Ctrl+/", action: () => { getEditor()?.trigger?.("keyboard", "editor.action.commentLine", null) } },
    { id: "quickOpen", label: t("app.cmdQuickOpen"), category: "Navigation", shortcut: "Ctrl+P", action: () => { context.getCommandPalette()?.open?.("files") } },
    { id: "toggleSidebar", label: t("app.cmdToggleSidebar"), category: "View", action: () => { context.toggleSidebarVisibility() } },
    { id: "gitCommit", label: t("app.cmdGitCommit"), category: "Git", action: () => { context.openSidebarView("changes") } },
    { id: "gitPush", label: t("app.cmdGitPush"), category: "Git", action: () => { context.openSidebarView("changes") } },
    { id: "gitPull", label: t("app.cmdGitPull"), category: "Git", action: () => { context.openSidebarView("changes") } },
    { id: "aiChat", label: t("app.cmdAiChat"), category: "AI", shortcut: "Ctrl+K", action: () => { context.toggleChatPanel() } },
    { id: "aiInlineEdit", label: t("app.cmdAiInlineEdit"), category: "AI", action: () => { if (getEditor()) context.openInlineEdit() } },
  ]

  const menuCommands = buildMenuPaletteCommands((action) => {
    void context.handleMenuAction(action)
  })
  registerPaletteCommands(commands)
  registerPaletteCommands(menuCommands)
}

async function executeRegisteredCommand(commandId: string): Promise<boolean> {
  if (!getCommand(commandId)) return false
  return executeCommand(commandId)
}

function registerPaletteCommands(commands: CommandPaletteCommand[]): void {
  for (const command of commands) {
    const commandId = toWorkbenchCommandId(command.id)
    registerCommand({
      id: commandId,
      title: command.label,
      category: command.category,
      source: "codek",
      handler: command.action,
    })
    if (commandId !== command.id) {
      registerCommandAlias(command.id, commandId)
    }
  }
}

function toWorkbenchCommandId(id: string): string {
  if (id === "quickOpen") return "workbench.action.quickOpen"
  if (id === "commandPalette") return "workbench.action.showCommands"
  return id
}
