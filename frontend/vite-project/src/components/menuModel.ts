import {
  MenuId,
  MenuRegistry,
  prepareMenuEntries,
  type VscodePreparedMenuEntry,
} from "../vscode-adapter/platform/actions/common/menuRegistry"
import { globalMenuService } from "../vscode-adapter/platform/actions/common/menuService"
import { ContextKeyService, type ContextKeyValue } from "../workbench/contextKeys"

export type MenuAction =
  | "newFile"
  | "newWindow"
  | "newAgentWindow"
  | "openFile"
  | "openProject"
  | "openWorkspaceFile"
  | "openRecent"
  | "addFolderToWorkspace"
  | "saveWorkspaceAs"
  | "duplicateWorkspace"
  | "save"
  | "saveAs"
  | "saveAll"
  | "share"
  | "toggleAutoSave"
  | "openCodekSettings"
  | "openVsCodeSettings"
  | "openKeyboardShortcuts"
  | "openSettingsJson"
  | "openKeybindingsJson"
  | "revertFile"
  | "closeEditor"
  | "closeWindow"
  | "quit"
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "find"
  | "replace"
  | "globalSearch"
  | "globalReplace"
  | "toggleLineComment"
  | "toggleBlockComment"
  | "emmetExpand"
  | "selectAll"
  | "expandSelection"
  | "shrinkSelection"
  | "copyLineUp"
  | "copyLineDown"
  | "moveLineUp"
  | "moveLineDown"
  | "repeatSelection"
  | "addCursorAbove"
  | "addCursorBelow"
  | "addCursorToLineEnds"
  | "addSelectionToNextFindMatch"
  | "addSelectionToPreviousFindMatch"
  | "selectAllOccurrences"
  | "toggleMultiCursorModifier"
  | "toggleColumnSelection"
  | "commandPalette"
  | "openView"
  | "toggleActivityBar"
  | "toggleStatusBar"
  | "toggleExplorer"
  | "toggleSearch"
  | "toggleSourceControl"
  | "togglePlugins"
  | "toggleProblems"
  | "toggleOutput"
  | "toggleChat"
  | "toggleGoals"
  | "toggleSandbox"
  | "toggleToolAuth"
  | "toggleSplitEditor"
  | "toggleWordWrap"
  | "navigateBack"
  | "navigateForward"
  | "lastEditLocation"
  | "switchEditor"
  | "switchGroup"
  | "quickOpen"
  | "workspaceSymbols"
  | "editorSymbols"
  | "goToDefinition"
  | "goToDeclaration"
  | "goToTypeDefinition"
  | "goToImplementation"
  | "addSymbolToCurrentChat"
  | "findReferences"
  | "addSymbolToNewChat"
  | "gotoLine"
  | "goToBracket"
  | "nextProblem"
  | "previousProblem"
  | "nextChange"
  | "previousChange"
  | "showAllCommands"
  | "editorPlayground"
  | "accessibilityGettingStarted"
  | "giveFeedback"
  | "viewLicense"
  | "toggleDeveloperTools"
  | "openProcessExplorer"
  | "checkUpdates"
  | "about"
  | "openLogs"
  | "exportDiagnostics"
  | "openAgentLogs"
  | "openSandboxPolicy"
  | "openExtensionHostStatus"

export interface MenuContext {
  [key: string]: ContextKeyValue
  hasEditor?: boolean
  hasSelection?: boolean
  hasWorkspace?: boolean
  hasActiveFile?: boolean
  dirty?: boolean
  chatOpen?: boolean
  sidebarVisible?: boolean
  autoSave?: boolean
  isElectron?: boolean
}

export interface MenuBase {
  id: string
  label: string
  group?: "navigation" | string
  order?: number
  source?: "codek" | "vscode" | "extension" | "agent"
  visible?: (context: MenuContext) => boolean
  enabled?: (context: MenuContext) => boolean
  checked?: (context: MenuContext) => boolean
}

export interface MenuItem extends MenuBase {
  type: "item"
  action: MenuAction
  shortcut?: string
}

export interface MenuSubmenu extends MenuBase {
  type: "submenu"
  items: MenuEntry[]
}

export interface MenuSeparator {
  type: "separator"
  group?: "navigation" | string
  order?: number
  visible?: (context: MenuContext) => boolean
}

export type MenuEntry = MenuItem | MenuSubmenu | MenuSeparator

export interface MenuDefinition {
  id: string
  label: string
  items: MenuEntry[]
  vscodeMenuId?: MenuId
}

export interface MenubarProjectionEntry {
  id: string
  type: MenuEntry["type"]
  label?: string
  action?: MenuAction
  enabled: boolean
  checked: boolean
  group?: string
  order?: number
  source: "codek" | "vscode" | "extension" | "agent"
  children?: MenubarProjectionEntry[]
}

export interface MenubarProjectionMenu {
  id: string
  label: string
  vscodeMenuId?: string
  entries: MenubarProjectionEntry[]
  actionIds: string[]
}

export interface MenubarProjection {
  schemaVersion: 1
  source: "menuModel"
  noSecondMenuState: true
  menuIds: string[]
  actionIds: string[]
  menus: MenubarProjectionMenu[]
}

const hasEditor = (context: MenuContext): boolean => Boolean(context.hasEditor)
const hasWorkspace = (context: MenuContext): boolean => Boolean(context.hasWorkspace)
const hasActiveFile = (context: MenuContext): boolean => Boolean(context.hasActiveFile)
const hasSelection = (context: MenuContext): boolean => Boolean(context.hasSelection)
const isElectron = (context: MenuContext): boolean => Boolean(context.isElectron)
const isDirty = (context: MenuContext): boolean => Boolean(context.dirty)
const workspaceOrElectron = (context: MenuContext): boolean => Boolean(context.hasWorkspace || context.isElectron)
const unavailable = (): boolean => false

export const menuDefinitions: MenuDefinition[] = [
  {
    id: "file",
    label: "文件(F)",
    vscodeMenuId: MenuId.MenubarFileMenu,
    items: [
      { type: "item", id: "newFile", label: "新建文本文件", action: "newFile", shortcut: "Ctrl+N" },
      { type: "item", id: "newWindow", label: "新建窗口", action: "newWindow", shortcut: "Ctrl+Shift+N", enabled: isElectron },
      { type: "item", id: "newAgentWindow", label: "新建智能体窗口", action: "newAgentWindow", enabled: isElectron },
      {
        type: "submenu",
        id: "newWindowWithProfile",
        label: "使用配置文件新建窗口",
        enabled: isElectron,
        items: [
          { type: "item", id: "newWindowDefaultProfile", label: "默认配置文件", action: "newWindow", enabled: isElectron },
          { type: "item", id: "newAgentWindowDefaultProfile", label: "智能体配置文件", action: "newAgentWindow", enabled: isElectron },
        ],
      },
      { type: "separator" },
      { type: "item", id: "openFile", label: "打开文件...", action: "openFile", shortcut: "Ctrl+O" },
      { type: "item", id: "openFolder", label: "打开文件夹...", action: "openProject", shortcut: "Ctrl+M Ctrl+O" },
      { type: "item", id: "openWorkspaceFile", label: "从文件打开工作区...", action: "openWorkspaceFile", enabled: isElectron },
      { type: "item", id: "openRecent", label: "打开最近的文件", action: "openRecent" },
      { type: "separator" },
      { type: "item", id: "addFolderToWorkspace", label: "将文件夹添加到工作区...", action: "addFolderToWorkspace", enabled: isElectron },
      { type: "item", id: "saveWorkspaceAs", label: "将工作区另存为...", action: "saveWorkspaceAs", enabled: workspaceOrElectron },
      { type: "item", id: "duplicateWorkspace", label: "复制工作区", action: "duplicateWorkspace", enabled: unavailable },
      { type: "separator" },
      { type: "item", id: "save", label: "保存", action: "save", shortcut: "Ctrl+S", enabled: isDirty },
      { type: "item", id: "saveAs", label: "另存为...", action: "saveAs", shortcut: "Ctrl+Shift+S", enabled: unavailable },
      { type: "item", id: "saveAll", label: "全部保存", action: "saveAll", shortcut: "Ctrl+M S" },
      { type: "separator" },
      { type: "item", id: "share", label: "共享", action: "share", enabled: unavailable },
      { type: "item", id: "autoSave", label: "自动保存", action: "toggleAutoSave", checked: (context) => Boolean(context.autoSave) },
      {
        type: "submenu",
        id: "settings",
        label: "设置",
        items: [
          { type: "item", id: "codekSettings", label: "Codek 设置", action: "openCodekSettings" },
          { type: "item", id: "vsCodeSettings", label: "VS Code 兼容设置", action: "openVsCodeSettings" },
          { type: "separator" },
          { type: "item", id: "keyboardShortcuts", label: "键盘快捷方式", action: "openKeyboardShortcuts" },
          { type: "item", id: "settingsJson", label: "设置 JSON", action: "openSettingsJson" },
          { type: "item", id: "keybindingsJson", label: "快捷键 JSON", action: "openKeybindingsJson" },
        ],
      },
      { type: "separator" },
      { type: "item", id: "revertFile", label: "还原文件", action: "revertFile", enabled: isDirty },
      { type: "item", id: "closeEditor", label: "关闭编辑器", action: "closeEditor", shortcut: "Ctrl+F4", enabled: hasActiveFile },
      { type: "item", id: "closeWindow", label: "关闭窗口", action: "closeWindow", shortcut: "Alt+F4", enabled: isElectron },
      { type: "separator" },
      { type: "item", id: "exit", label: "退出", action: "quit", enabled: isElectron },
    ],
  },
  {
    id: "edit",
    label: "编辑(E)",
    vscodeMenuId: MenuId.MenubarEditMenu,
    items: [
      { type: "item", id: "undo", label: "撤消", action: "undo", shortcut: "Ctrl+Z", enabled: hasEditor },
      { type: "item", id: "redo", label: "恢复", action: "redo", shortcut: "Ctrl+Y", enabled: hasEditor },
      { type: "separator" },
      { type: "item", id: "cut", label: "剪切", action: "cut", shortcut: "Ctrl+X", enabled: hasSelection },
      { type: "item", id: "copy", label: "复制", action: "copy", shortcut: "Ctrl+C", enabled: hasSelection },
      { type: "item", id: "paste", label: "粘贴", action: "paste", shortcut: "Ctrl+V", enabled: hasEditor },
      { type: "separator" },
      { type: "item", id: "find", label: "查找", action: "find", shortcut: "Ctrl+F", enabled: hasEditor },
      { type: "item", id: "replace", label: "替换", action: "replace", shortcut: "Ctrl+H", enabled: hasEditor },
      { type: "separator" },
      { type: "item", id: "globalSearch", label: "在文件中查找", action: "globalSearch", shortcut: "Ctrl+Shift+F" },
      { type: "item", id: "globalReplace", label: "在文件中替换", action: "globalReplace", shortcut: "Ctrl+Shift+H" },
      { type: "separator" },
      { type: "item", id: "toggleLineComment", label: "切换行注释", action: "toggleLineComment", shortcut: "Ctrl+/", enabled: hasEditor },
      { type: "item", id: "toggleBlockComment", label: "切换块注释", action: "toggleBlockComment", shortcut: "Shift+Alt+A", enabled: hasEditor },
      { type: "item", id: "emmetExpand", label: "Emmet: 展开缩写", action: "emmetExpand", shortcut: "Tab", enabled: hasEditor },
    ],
  },
  {
    id: "selection",
    label: "选择(S)",
    vscodeMenuId: MenuId.MenubarSelectionMenu,
    items: [
      { type: "item", id: "selectAll", label: "全选", action: "selectAll", shortcut: "Ctrl+A", enabled: hasEditor },
      { type: "item", id: "expandSelection", label: "扩大选区", action: "expandSelection", shortcut: "Shift+Alt+RightArrow", enabled: hasEditor },
      { type: "item", id: "shrinkSelection", label: "缩小选区", action: "shrinkSelection", shortcut: "Shift+Alt+LeftArrow", enabled: hasEditor },
      { type: "separator" },
      { type: "item", id: "copyLineUp", label: "向上复制一行", action: "copyLineUp", shortcut: "Shift+Alt+UpArrow", enabled: hasEditor },
      { type: "item", id: "copyLineDown", label: "向下复制一行", action: "copyLineDown", shortcut: "Shift+Alt+DownArrow", enabled: hasEditor },
      { type: "item", id: "moveLineUp", label: "向上移动一行", action: "moveLineUp", shortcut: "Alt+UpArrow", enabled: hasEditor },
      { type: "item", id: "moveLineDown", label: "向下移动一行", action: "moveLineDown", shortcut: "Alt+DownArrow", enabled: hasEditor },
      { type: "item", id: "repeatSelection", label: "重复选择", action: "repeatSelection", enabled: hasEditor },
      { type: "separator" },
      { type: "item", id: "addCursorAbove", label: "在上面添加光标", action: "addCursorAbove", shortcut: "Ctrl+Alt+UpArrow", enabled: hasEditor },
      { type: "item", id: "addCursorBelow", label: "在下面添加光标", action: "addCursorBelow", shortcut: "Ctrl+Alt+DownArrow", enabled: hasEditor },
      { type: "item", id: "addCursorToLineEnds", label: "在行尾添加光标", action: "addCursorToLineEnds", shortcut: "Shift+Alt+I", enabled: hasEditor },
      { type: "item", id: "addSelectionToNextFindMatch", label: "添加下一个匹配项", action: "addSelectionToNextFindMatch", shortcut: "Ctrl+D", enabled: hasEditor },
      { type: "item", id: "addSelectionToPreviousFindMatch", label: "添加上一个匹配项", action: "addSelectionToPreviousFindMatch", enabled: hasEditor },
      { type: "item", id: "selectAllOccurrences", label: "选择所有匹配项", action: "selectAllOccurrences", enabled: hasEditor },
      { type: "separator" },
      { type: "item", id: "toggleMultiCursorModifier", label: "切换为“Ctrl+单击”进行多光标功能", action: "toggleMultiCursorModifier", enabled: hasEditor },
      { type: "item", id: "toggleColumnSelection", label: "列选择模式", action: "toggleColumnSelection", checked: () => false, enabled: hasEditor },
    ],
  },
  {
    id: "view",
    label: "视图(V)",
    vscodeMenuId: MenuId.MenubarViewMenu,
    items: [
      { type: "item", id: "commandPalette", label: "命令面板...", action: "commandPalette", shortcut: "Ctrl+Shift+P" },
      {
        type: "submenu",
        id: "openView",
        label: "打开视图...",
        items: [
          { type: "item", id: "viewExplorer", label: "资源管理器", action: "toggleExplorer", shortcut: "Ctrl+Shift+E" },
          { type: "item", id: "viewSearch", label: "搜索", action: "toggleSearch", shortcut: "Ctrl+Shift+F" },
          { type: "item", id: "viewSourceControl", label: "源代码管理", action: "toggleSourceControl", shortcut: "Ctrl+Shift+G" },
          { type: "item", id: "viewExtensions", label: "扩展", action: "togglePlugins", shortcut: "Ctrl+Shift+X" },
          { type: "item", id: "viewGoals", label: "多智能体任务", action: "toggleGoals" },
        ],
      },
      {
        type: "submenu",
        id: "appearance",
        label: "外观",
        items: [
          { type: "item", id: "appearanceActivityBar", label: "活动栏", action: "toggleActivityBar", checked: () => true },
          { type: "item", id: "appearanceStatusBar", label: "状态栏", action: "toggleStatusBar", checked: () => false },
          { type: "item", id: "appearanceExplorer", label: "左侧栏", action: "toggleExplorer", checked: (context) => Boolean(context.sidebarVisible) },
          { type: "item", id: "appearanceChat", label: "智能助手", action: "toggleChat", checked: (context) => Boolean(context.chatOpen) },
        ],
      },
      {
        type: "submenu",
        id: "editorLayout",
        label: "编辑器布局",
        items: [
          { type: "item", id: "layoutSingle", label: "单编辑器", action: "toggleSplitEditor", checked: () => false },
          { type: "item", id: "layoutSplit", label: "左右拆分", action: "toggleSplitEditor" },
        ],
      },
      { type: "separator" },
      { type: "item", id: "explorer", label: "资源管理器", action: "toggleExplorer", shortcut: "Ctrl+Shift+E" },
      { type: "item", id: "search", label: "搜索", action: "toggleSearch", shortcut: "Ctrl+Shift+F" },
      { type: "item", id: "sourceControl", label: "源代码管理", action: "toggleSourceControl", shortcut: "Ctrl+Shift+G" },
      { type: "item", id: "extensions", label: "扩展", action: "togglePlugins", shortcut: "Ctrl+Shift+X" },
      { type: "separator" },
      { type: "item", id: "problems", label: "问题", action: "toggleProblems", shortcut: "Ctrl+Shift+M" },
      { type: "item", id: "output", label: "输出", action: "toggleOutput", shortcut: "Ctrl+Shift+U" },
      { type: "item", id: "wordWrap", label: "自动换行", action: "toggleWordWrap", shortcut: "Alt+Z" },
      { type: "separator" },
      { type: "item", id: "chatAI", label: "智能助手", action: "toggleChat", checked: (context) => Boolean(context.chatOpen) },
      { type: "item", id: "multiAgentGoals", label: "多智能体任务", action: "toggleGoals" },
      { type: "item", id: "sandboxStatus", label: "沙箱状态", action: "toggleSandbox" },
      { type: "item", id: "toolAuthorization", label: "工具授权", action: "toggleToolAuth" },
    ],
  },
  {
    id: "go",
    label: "转到(G)",
    vscodeMenuId: MenuId.MenubarGoMenu,
    items: [
      { type: "item", id: "back", label: "返回", action: "navigateBack", shortcut: "Alt+LeftArrow" },
      { type: "item", id: "forward", label: "前进", action: "navigateForward", shortcut: "Alt+RightArrow" },
      { type: "item", id: "lastEditLocation", label: "上次编辑位置", action: "lastEditLocation", shortcut: "Ctrl+M Ctrl+Q", enabled: hasEditor },
      { type: "separator" },
      { type: "item", id: "switchEditor", label: "切换编辑器", action: "switchEditor" },
      { type: "item", id: "switchGroup", label: "切换组", action: "switchGroup" },
      { type: "separator" },
      { type: "item", id: "quickOpen", label: "转到文件...", action: "quickOpen", shortcut: "Ctrl+P" },
      { type: "item", id: "workspaceSymbols", label: "转到工作区中的符号...", action: "workspaceSymbols", shortcut: "Ctrl+T", enabled: hasWorkspace },
      { type: "item", id: "editorSymbols", label: "转到编辑器中的符号...", action: "editorSymbols", shortcut: "Ctrl+Shift+O", enabled: hasEditor },
      { type: "item", id: "definition", label: "转到定义", action: "goToDefinition", shortcut: "F12", enabled: hasEditor },
      { type: "item", id: "declaration", label: "转到声明", action: "goToDeclaration", enabled: hasEditor },
      { type: "item", id: "typeDefinition", label: "转到类型定义", action: "goToTypeDefinition", enabled: hasEditor },
      { type: "item", id: "implementation", label: "转到实现", action: "goToImplementation", shortcut: "Ctrl+F12", enabled: hasEditor },
      { type: "item", id: "symbolToCurrentChat", label: "添加符号到当前智能助手", action: "addSymbolToCurrentChat", enabled: hasEditor },
      { type: "item", id: "references", label: "转到引用", action: "findReferences", shortcut: "Shift+F12", enabled: hasEditor },
      { type: "item", id: "symbolToNewChat", label: "添加符号到新智能会话", action: "addSymbolToNewChat", enabled: hasEditor },
      { type: "separator" },
      { type: "item", id: "gotoLine", label: "转到行/列...", action: "gotoLine", shortcut: "Ctrl+G", enabled: hasEditor },
      { type: "item", id: "goToBracket", label: "转到括号", action: "goToBracket", shortcut: "Ctrl+Shift+\\", enabled: hasEditor },
      { type: "separator" },
      { type: "item", id: "nextProblem", label: "下一个问题", action: "nextProblem", shortcut: "F8" },
      { type: "item", id: "previousProblem", label: "上一个问题", action: "previousProblem", shortcut: "Shift+F8" },
      { type: "separator" },
      { type: "item", id: "nextChange", label: "下一个更改", action: "nextChange", shortcut: "Alt+F3", enabled: hasWorkspace },
      { type: "item", id: "previousChange", label: "上一个更改", action: "previousChange", shortcut: "Shift+Alt+F3", enabled: hasWorkspace },
    ],
  },
  {
    id: "help",
    label: "帮助(H)",
    vscodeMenuId: MenuId.MenubarHelpMenu,
    items: [
      { type: "item", id: "showAllCommands", label: "显示所有命令", action: "showAllCommands", shortcut: "Ctrl+Shift+P" },
      { type: "item", id: "editorPlayground", label: "编辑器操场", action: "editorPlayground" },
      { type: "item", id: "accessibilityGettingStarted", label: "辅助功能入门", action: "accessibilityGettingStarted" },
      { type: "separator" },
      { type: "item", id: "giveFeedback", label: "提交反馈...", action: "giveFeedback" },
      { type: "separator" },
      { type: "item", id: "viewLicense", label: "查看许可证", action: "viewLicense" },
      { type: "separator" },
      { type: "item", id: "toggleDeveloperTools", label: "切换开发者工具", action: "toggleDeveloperTools", enabled: isElectron },
      { type: "item", id: "openProcessExplorer", label: "打开进程资源管理器", action: "openProcessExplorer" },
      { type: "separator" },
      { type: "item", id: "checkUpdates", label: "检查更新...", action: "checkUpdates" },
      { type: "item", id: "about", label: "关于", action: "about" },
      { type: "separator" },
      { type: "item", id: "openLogs", label: "打开日志文件夹", action: "openLogs", enabled: isElectron },
      { type: "item", id: "exportDiagnostics", label: "导出诊断包", action: "exportDiagnostics", enabled: isElectron },
      { type: "item", id: "openAgentLogs", label: "查看智能体运行日志", action: "openAgentLogs" },
      { type: "item", id: "openSandboxPolicy", label: "查看沙箱策略说明", action: "openSandboxPolicy" },
      { type: "item", id: "openExtensionHostStatus", label: "查看扩展主机状态", action: "openExtensionHostStatus" },
    ],
  },
]

export function isMenuEntryEnabled(entry: MenuEntry, context: MenuContext): boolean {
  if (entry.type === "separator") return false
  return entry.enabled ? entry.enabled(context) : true
}

export function isMenuEntryChecked(entry: MenuEntry, context: MenuContext): boolean {
  if (entry.type === "separator" || !entry.checked) return false
  return entry.checked(context)
}

export function getPreparedMenuEntries(entries: MenuEntry[], context: MenuContext): MenuEntry[] {
  return prepareMenuEntries(entries, context) as MenuEntry[]
}

export function getPreparedMenuDefinitionEntries(menu: MenuDefinition, context: MenuContext): MenuEntry[] {
  const contributed = menu.vscodeMenuId
    ? globalMenuService
        .getMenuActions(menu.vscodeMenuId, new ContextKeyService(context))
        .flatMap(([, actions]) => actions.map(toMenuEntry))
    : []
  return getPreparedMenuEntries([...menu.items, ...contributed], context)
}

export function flattenMenuActions(entries: MenuEntry[]): MenuItem[] {
  return getPreparedMenuEntries(entries, {}).flatMap((entry) => {
    if (entry.type === "item") return [entry]
    if (entry.type === "submenu") return flattenMenuActions(entry.items)
    return []
  })
}

export function buildMenubarProjection(context: MenuContext = {}): MenubarProjection {
  const menus = menuDefinitions.map((menu) => {
    const entries = getPreparedMenuDefinitionEntries(menu, context)
    const projectedEntries = entries.map((entry, index) => toProjectionEntry(entry, context, index))
    return {
      id: menu.id,
      label: menu.label,
      vscodeMenuId: menu.vscodeMenuId?.id,
      entries: projectedEntries,
      actionIds: collectActionIds(projectedEntries),
    }
  })
  const actionIds = [...new Set(menus.flatMap((menu) => menu.actionIds))]
  return {
    schemaVersion: 1,
    source: "menuModel",
    noSecondMenuState: true,
    menuIds: menus.map((menu) => menu.id),
    actionIds,
    menus,
  }
}

function toMenuEntry(entry: VscodePreparedMenuEntry): MenuEntry {
  if (entry.type === "separator") return { type: "separator", group: entry.group, order: entry.order }
  if (entry.type === "submenu") {
    return {
      type: "submenu",
      id: entry.id,
      label: entry.label,
      group: entry.group,
      order: entry.order,
      items: entry.items.map(toMenuEntry),
    }
  }
  return {
    type: "item",
    id: entry.id,
    label: entry.label,
    group: entry.group,
    order: entry.order,
    source: "vscode",
    action: entry.commandId as MenuAction,
    checked: () => Boolean(entry.toggled),
    enabled: () => !entry.disabled,
  }
}

function toProjectionEntry(entry: MenuEntry, context: MenuContext, index: number): MenubarProjectionEntry {
  if (entry.type === "separator") {
    return {
      id: `separator-${index}`,
      type: "separator",
      enabled: false,
      checked: false,
      group: entry.group,
      order: entry.order,
      source: "codek",
    }
  }
  const base = {
    id: entry.id,
    type: entry.type,
    label: entry.label,
    enabled: isMenuEntryEnabled(entry, context),
    checked: isMenuEntryChecked(entry, context),
    group: entry.group,
    order: entry.order,
    source: entry.source || "codek",
  } satisfies Omit<MenubarProjectionEntry, "action" | "children">
  if (entry.type === "item") {
    return {
      ...base,
      action: entry.action,
    }
  }
  return {
    ...base,
    children: getPreparedMenuEntries(entry.items, context).map((child, childIndex) => toProjectionEntry(child, context, childIndex)),
  }
}

function collectActionIds(entries: MenubarProjectionEntry[]): string[] {
  const ids: string[] = []
  for (const entry of entries) {
    if (entry.action) ids.push(entry.action)
    if (entry.children) ids.push(...collectActionIds(entry.children))
  }
  return [...new Set(ids)]
}
