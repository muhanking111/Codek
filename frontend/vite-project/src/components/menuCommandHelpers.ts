import { flattenMenuActions, menuDefinitions, type MenuAction } from "./menuModel"

type PaletteCategory = "File" | "Edit" | "Selection" | "View" | "Navigation" | "Run" | "Help"

interface PaletteCommand {
  id: string
  label: string
  category: PaletteCategory
  shortcut?: string
  action: () => void
}

const menuCategoryMap: Record<string, PaletteCategory> = {
  file: "File",
  edit: "Edit",
  selection: "Selection",
  view: "View",
  go: "Navigation",
  run: "Run",
  help: "Help",
}

const unsupportedMenuCommandMessages: Partial<Record<MenuAction, string>> = {
  openWorkspaceFile: "工作区文件入口需要接入 VS Code Workbench 工作区服务",
  addFolderToWorkspace: "多根工作区正在规划中",
  saveWorkspaceAs: "工作区另存为需要接入工作区文件服务",
  duplicateWorkspace: "复制工作区需要接入桌面工作区服务",
  share: "共享需要接入远程同步服务",
  revertFile: "还原文件需要接入磁盘版本读取和确认流程",
  exportDiagnostics: "诊断包导出正在规划中",
}

export function buildMenuPaletteCommands(onAction: (action: MenuAction) => void): PaletteCommand[] {
  return menuDefinitions.flatMap((menu) =>
    flattenMenuActions(menu.items).map((item) => ({
      id: `menu.${item.action}`,
      label: item.label,
      category: menuCategoryMap[menu.id] || "View",
      shortcut: item.shortcut,
      action: () => onAction(item.action),
    })),
  )
}

export function getUnsupportedMenuCommandMessage(action: MenuAction): string {
  return (
    unsupportedMenuCommandMessages[action] ||
    "该命令已保留为 VS Code / Cursor 兼容入口，当前版本会跳转到最接近的面板。"
  )
}
