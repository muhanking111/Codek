import {
  clearKeybindings,
  handleKeyEvent,
  loadOverriddenKeybindings,
  registerKeybinding,
} from "../keybindings"
import { globalCommandService } from "./commandRegistry"

interface WorkspaceLike {
  activeFile?: string | null
}

interface EditorLike {
  hasTextFocus?: () => boolean
  trigger?: (source: string, handlerId: string, payload: unknown) => void
}

export interface WorkbenchKeybindingContext {
  t: (key: string) => string
  getEditor: () => EditorLike | null
  getWorkspace: () => WorkspaceLike
  isInlineEditVisible: () => boolean
  setQuickQuestionVisible: (visible: boolean) => void
  saveActiveFile: () => void | Promise<void>
  toggleChatPanel: () => void
  openInlineEdit: () => void
  openSidebarView: (view: string) => void
  handleToggleSplit: () => void
  sendSelectionToChat: () => void
  toggleMinimap: () => void
  focusNextRegion: () => void
  focusPrevRegion: () => void
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  handleCloseTab: (path: string) => void | Promise<void>
  openGotoLine: () => void
  openFileSwitcher: () => void
  handleSwitcherKeydown: (event: KeyboardEvent) => void
  handleSwitcherKeyup: (event: KeyboardEvent) => void
  handleAccessibilityKeydown: (event: KeyboardEvent) => void
}

export function installWorkbenchKeybindings(context: WorkbenchKeybindingContext): () => void {
  registerWorkbenchKeybindings(context)

  const handleKeydown = (event: KeyboardEvent) => {
    context.handleSwitcherKeydown(event)
    handleKeyEvent(event)
    context.handleAccessibilityKeydown(event)
  }

  const handleKeyup = (event: KeyboardEvent) => {
    context.handleSwitcherKeyup(event)
  }

  document.addEventListener("keydown", handleKeydown)
  document.addEventListener("keyup", handleKeyup)

  return () => {
    document.removeEventListener("keydown", handleKeydown)
    document.removeEventListener("keyup", handleKeyup)
  }
}

function registerWorkbenchKeybindings(context: WorkbenchKeybindingContext) {
  const { t } = context
  const getEditor = () => context.getEditor()

  clearKeybindings()

  registerKeybinding({
    id: "save",
    key: "s",
    ctrl: true,
    shift: false,
    alt: false,
    action: () => { void context.saveActiveFile() },
    description: t("settings.shortcutSave"),
  })

  registerKeybinding({
    id: "chat",
    key: "k",
    ctrl: true,
    shift: false,
    alt: false,
    action: () => {
      if (context.isInlineEditVisible()) return
      const editor = getEditor()
      if (editor?.hasTextFocus?.()) context.openInlineEdit()
      else context.toggleChatPanel()
    },
    description: t("settings.shortcutChat"),
  })

  registerKeybinding({
    id: "quickOpen",
    key: "p",
    ctrl: true,
    shift: false,
    alt: false,
    action: () => { void globalCommandService.executeCommand("workbench.action.quickOpen") },
    description: t("settings.shortcutSearch"),
  })

  registerKeybinding({
    id: "globalSearch",
    key: "f",
    ctrl: true,
    shift: true,
    alt: false,
    action: () => { context.openSidebarView("search") },
    description: t("settings.shortcutGlobalSearch"),
  })

  registerKeybinding({
    id: "commandPalette",
    key: "p",
    ctrl: true,
    shift: true,
    alt: false,
    action: () => { void globalCommandService.executeCommand("workbench.action.showCommands") },
    description: t("settings.shortcutCommandPalette"),
  })

  registerKeybinding({
    id: "toggleComment",
    key: "/",
    ctrl: true,
    shift: false,
    alt: false,
    action: () => {
      getEditor()?.trigger?.("keyboard", "editor.action.commentLine", null)
    },
    description: t("settings.shortcutComment"),
  })

  registerKeybinding({
    id: "toggleSplit",
    key: "\\",
    ctrl: true,
    shift: false,
    alt: false,
    action: () => context.handleToggleSplit(),
    description: t("settings.shortcutSplit"),
  })

  registerKeybinding({
    id: "rename",
    key: "F2",
    ctrl: false,
    shift: false,
    alt: false,
    action: () => {
      getEditor()?.trigger?.("keyboard", "editor.action.rename", null)
    },
    description: t("app.cmdRenameSymbol"),
  })

  registerKeybinding({
    id: "format",
    key: "f",
    ctrl: true,
    shift: true,
    alt: false,
    action: () => {
      getEditor()?.trigger?.("keyboard", "editor.action.formatDocument", null)
    },
    description: t("app.cmdFormat"),
  })

  registerKeybinding({
    id: "sendToChat",
    key: "l",
    ctrl: true,
    shift: false,
    alt: false,
    action: () => context.sendSelectionToChat(),
    description: t("app.kbSendToChat"),
  })

  registerKeybinding({
    id: "quickQuestion",
    key: "l",
    ctrl: true,
    shift: true,
    alt: false,
    action: () => {
      context.setQuickQuestionVisible(true)
    },
    description: t("quickQuestion.command"),
  })

  registerKeybinding({
    id: "toggleMinimap",
    key: "m",
    ctrl: true,
    shift: true,
    alt: false,
    action: () => context.toggleMinimap(),
    description: t("settings.shortcutMinimap"),
  })

  registerKeybinding({
    id: "fold",
    key: "[",
    ctrl: true,
    shift: true,
    alt: false,
    action: () => {
      getEditor()?.trigger?.("keyboard", "editor.fold", null)
    },
    description: t("settings.shortcutFold"),
  })

  registerKeybinding({
    id: "unfold",
    key: "]",
    ctrl: true,
    shift: true,
    alt: false,
    action: () => {
      getEditor()?.trigger?.("keyboard", "editor.unfold", null)
    },
    description: t("settings.shortcutUnfold"),
  })

  registerKeybinding({
    id: "foldAll",
    key: "0",
    ctrl: true,
    shift: true,
    alt: false,
    action: () => {
      getEditor()?.trigger?.("keyboard", "editor.foldAll", null)
    },
    description: t("settings.shortcutFoldAll"),
  })

  registerKeybinding({
    id: "unfoldAll",
    key: "j",
    ctrl: true,
    shift: true,
    alt: false,
    action: () => {
      getEditor()?.trigger?.("keyboard", "editor.unfoldAll", null)
    },
    description: t("settings.shortcutUnfoldAll"),
  })

  registerKeybinding({
    id: "addNextOccurrence",
    key: "d",
    ctrl: true,
    shift: false,
    alt: false,
    action: () => {
      getEditor()?.trigger?.("keyboard", "editor.action.addSelectionToNextFindMatch", null)
    },
    description: t("settings.shortcutAddNextOccurrence"),
  })

  registerKeybinding({
    id: "selectAllOccurrences",
    key: "l",
    ctrl: true,
    shift: true,
    alt: false,
    action: () => {
      getEditor()?.trigger?.("keyboard", "editor.action.selectHighlights", null)
    },
    description: t("settings.shortcutSelectAllOccurrences"),
  })

  registerKeybinding({
    id: "focusNextRegion",
    key: "F6",
    ctrl: false,
    shift: false,
    alt: false,
    action: () => context.focusNextRegion(),
    description: t("app.kbFocusNextRegion"),
  })

  registerKeybinding({
    id: "focusPrevRegion",
    key: "F6",
    ctrl: false,
    shift: true,
    alt: false,
    action: () => context.focusPrevRegion(),
    description: t("app.kbFocusPreviousRegion"),
  })

  registerKeybinding({
    id: "zoomIn",
    key: "=",
    ctrl: true,
    shift: false,
    alt: false,
    action: () => context.zoomIn(),
    description: t("app.kbZoomIn"),
  })

  registerKeybinding({
    id: "zoomOut",
    key: "-",
    ctrl: true,
    shift: false,
    alt: false,
    action: () => context.zoomOut(),
    description: t("app.kbZoomOut"),
  })

  registerKeybinding({
    id: "zoomReset",
    key: "0",
    ctrl: true,
    shift: false,
    alt: false,
    action: () => context.zoomReset(),
    description: t("app.kbZoomReset"),
  })

  registerKeybinding({
    id: "closeTab",
    key: "w",
    ctrl: true,
    shift: false,
    alt: false,
    action: () => {
      const activeFile = context.getWorkspace().activeFile
      if (activeFile) void context.handleCloseTab(activeFile)
    },
    description: t("app.cmdCloseTab"),
  })

  registerKeybinding({
    id: "gotoLine",
    key: "g",
    ctrl: true,
    shift: false,
    alt: false,
    action: () => context.openGotoLine(),
    description: t("app.cmdGotoLine"),
  })

  registerKeybinding({
    id: "fileSwitcher",
    key: "Tab",
    ctrl: true,
    shift: false,
    alt: false,
    action: () => context.openFileSwitcher(),
    description: t("app.cmdFileSwitcher"),
  })

  loadOverriddenKeybindings()
}
