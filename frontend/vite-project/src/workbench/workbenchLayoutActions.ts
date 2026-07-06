import type { BottomPanelId } from "./bottomPanelState"
import type { CodekSidebarViewId } from "./workbenchLayoutModel"
import { containerIdToSidebarView } from "./workbenchLayoutModel"
import { Action2, MenuId, registerAction2, type Action2Descriptor } from "../vscode-adapter/platform/actions/common/menuRegistry"
import type { Disposable } from "../vscode-adapter/platform/commands/common/commandsRegistry"

export interface WorkbenchLayoutActionContext {
  toggleWorkbenchBoolean: (key: string, fallback?: boolean) => void
  toggleSidebarVisibility: () => void
  toggleSidebarView: (view: CodekSidebarViewId) => void
  openSidebarView: (view: CodekSidebarViewId) => void
  toggleBottomPanel: (panel: BottomPanelId) => void
  toggleSplitEditor: () => void
  openSettingsView: () => void
  openSettingsSection?: (section: string) => void
}

interface LayoutCommandContribution {
  descriptor: Action2Descriptor
  run: () => void
}

export function registerWorkbenchLayoutActions(context: WorkbenchLayoutActionContext): Disposable {
  const disposables = createWorkbenchLayoutCommandContributions(context).map(registerWorkbenchLayoutAction)
  return { dispose: () => disposables.forEach((disposable) => disposable.dispose()) }
}

function createWorkbenchLayoutCommandContributions(context: WorkbenchLayoutActionContext): LayoutCommandContribution[] {
  return [
    {
      descriptor: {
        id: "workbench.action.toggleActivityBarVisibility",
        title: "切换活动栏可见性",
        category: "View",
        source: "vscode",
        toggled: "workbench.activityBar.visible",
        menu: [
          { id: MenuId.CommandPalette, group: "navigation", order: 10 },
          { id: MenuId.MenubarViewMenu, group: "3_appearance", order: 10 },
        ],
      },
      run: () => context.toggleWorkbenchBoolean("workbench.activityBar.visible", true),
    },
    {
      descriptor: {
        id: "workbench.action.toggleSidebarVisibility",
        title: "切换侧边栏可见性",
        category: "View",
        source: "vscode",
        toggled: "workbench.sideBar.visible",
        menu: [
          { id: MenuId.CommandPalette, group: "navigation", order: 20 },
          { id: MenuId.MenubarViewMenu, group: "3_appearance", order: 20 },
        ],
      },
      run: () => context.toggleSidebarVisibility(),
    },
    {
      descriptor: {
        id: "workbench.action.togglePanel",
        title: "切换面板",
        category: "View",
        source: "vscode",
        toggled: "workbench.panel.visible",
        menu: [
          { id: MenuId.CommandPalette, group: "navigation", order: 30 },
          { id: MenuId.MenubarViewMenu, group: "3_appearance", order: 30 },
        ],
      },
      run: () => context.toggleBottomPanel("output"),
    },
    {
      descriptor: {
        id: "workbench.action.terminal.toggleTerminal",
        title: "切换终端",
        category: "View",
        source: "vscode",
        menu: [
          { id: MenuId.CommandPalette, group: "navigation", order: 40 },
          { id: MenuId.MenubarViewMenu, group: "4_panel", order: 20 },
        ],
      },
      run: () => context.toggleBottomPanel("terminal"),
    },
    {
      descriptor: {
        id: "workbench.action.splitEditor",
        title: "拆分编辑器",
        category: "View",
        source: "vscode",
        menu: [
          { id: MenuId.CommandPalette, group: "navigation", order: 50 },
          { id: MenuId.MenubarViewMenu, group: "2_editor", order: 10 },
        ],
      },
      run: () => context.toggleSplitEditor(),
    },
    {
      descriptor: {
        id: "workbench.action.openSettings",
        title: "打开设置",
        category: "View",
        source: "vscode",
        menu: [
          { id: MenuId.CommandPalette, group: "navigation", order: 60 },
        ],
      },
      run: () => context.openSettingsView(),
    },
    viewCommand("workbench.view.explorer", "打开资源管理器", "workbench.view.explorer", context, 100),
    viewCommand("workbench.view.search", "打开搜索", "workbench.view.search", context, 110),
    viewCommand("workbench.view.scm", "打开源代码管理", "workbench.view.scm", context, 120),
    viewCommand("workbench.view.debug", "打开运行和调试", "workbench.view.debug", context, 130),
    viewCommand("workbench.view.extensions", "打开扩展", "workbench.view.extensions", context, 140),
    viewCommand("workbench.view.mcp", "打开 MCP", "workbench.view.mcp", context, 150),
    viewCommand("codek.view.symbols", "打开符号", "codek.view.symbols", context, 160),
    viewCommand("codek.view.agent", "打开智能体", "codek.view.agent", context, 170),
    viewCommand("codek.view.automation", "打开自动化", "codek.view.automation", context, 180),
    viewCommand("codek.view.remote", "打开远程", "codek.view.remote", context, 190),
    viewCommand("workbench.view.testing", "打开测试", "workbench.view.testing", context, 200),
    settingsViewCommand(context, 210),
    settingsSectionCommand("workbench.action.openGlobalSettings", "打开用户设置", "vscode-settings", context, 220),
    settingsSectionCommand("workbench.action.openSettingsJson", "打开设置 JSON", "advanced", context, 230),
    settingsSectionCommand("workbench.profiles.actions.manageProfiles", "管理配置文件", "advanced", context, 240),
    settingsSectionCommand("workbench.action.selectTheme", "选择颜色主题", "appearance", context, 250),
    settingsSectionCommand("workbench.action.selectIconTheme", "选择文件图标主题", "appearance", context, 260),
  ]
}

function viewCommand(
  commandId: string,
  title: string,
  containerId: string,
  context: WorkbenchLayoutActionContext,
  order: number,
): LayoutCommandContribution {
  return {
    descriptor: {
      id: commandId,
      title,
      category: "View",
      source: containerId.startsWith("workbench.") ? "vscode" : "codek",
      menu: [
        { id: MenuId.CommandPalette, group: "navigation", order },
        { id: MenuId.MenubarViewMenu, group: "1_views", order },
      ],
    },
    run: () => context.openSidebarView(containerIdToSidebarView(containerId)),
  }
}

function settingsViewCommand(
  context: WorkbenchLayoutActionContext,
  order: number,
): LayoutCommandContribution {
  return {
    descriptor: {
      id: "workbench.view.settings",
      title: "打开设置",
      category: "View",
      source: "vscode",
      menu: [
        { id: MenuId.CommandPalette, group: "navigation", order },
        { id: MenuId.MenubarViewMenu, group: "1_views", order },
      ],
    },
    run: () => context.openSettingsView(),
  }
}

function settingsSectionCommand(
  id: string,
  title: string,
  section: string,
  context: WorkbenchLayoutActionContext,
  order: number,
): LayoutCommandContribution {
  return {
    descriptor: {
      id,
      title,
      category: "Preferences",
      source: "vscode",
      menu: [
        { id: MenuId.CommandPalette, group: "preferences", order },
      ],
    },
    run: () => {
      if (context.openSettingsSection) context.openSettingsSection(section)
      else context.openSettingsView()
    },
  }
}

function registerWorkbenchLayoutAction(contribution: LayoutCommandContribution): Disposable {
  return registerAction2(class extends Action2 {
    constructor() {
      super(contribution.descriptor)
    }

    override run(): void {
      contribution.run()
    }
  })
}
