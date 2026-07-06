import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearCommands, executeCommand, getCommand, getCommandRegistrationDiagnostics, searchCommands } from "./commandRegistry"
import { MenuId, MenuRegistry } from "../vscode-adapter/platform/actions/common/menuRegistry"
import { registerWorkbenchLayoutActions, type WorkbenchLayoutActionContext } from "./workbenchLayoutActions"
import {
  DEBUG_WORKBENCH_VIEW_IDS,
  TERMINAL_DEBUG_TASK_COMMAND_IDS,
  TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS,
  registerTerminalDebugTaskWorkbenchContributions,
} from "./terminalDebugTaskWorkbench"

function createContext(): WorkbenchLayoutActionContext {
  return {
    toggleWorkbenchBoolean: vi.fn(),
    toggleSidebarVisibility: vi.fn(),
    toggleSidebarView: vi.fn(),
    openSidebarView: vi.fn(),
    toggleBottomPanel: vi.fn(),
    toggleSplitEditor: vi.fn(),
    openSettingsView: vi.fn(),
    openSettingsSection: vi.fn(),
  }
}

describe("workbenchLayoutActions", () => {
  beforeEach(() => {
    clearCommands()
    MenuRegistry.clear()
  })

  it("registers layout commands through the shared command registry and command palette menu", async () => {
    const context = createContext()
    const disposable = registerWorkbenchLayoutActions(context)

    expect(getCommand("workbench.action.toggleSidebarVisibility")?.title).toBe("切换侧边栏可见性")
    expect(searchCommands("side").map((command) => command.id)).toContain("workbench.action.toggleSidebarVisibility")
    expect(MenuRegistry.getMenuEntries(MenuId.CommandPalette).map((entry) => entry.id)).toContain(
      "workbench.action.toggleSidebarVisibility",
    )

    await executeCommand("workbench.action.toggleSidebarVisibility")
    expect(context.toggleSidebarVisibility).toHaveBeenCalledTimes(1)

    disposable.dispose()
    expect(getCommand("workbench.action.toggleSidebarVisibility")).toBeNull()
  })

  it("routes view container and panel commands to existing Codek layout state", async () => {
    const context = createContext()
    registerWorkbenchLayoutActions(context)

    await executeCommand("workbench.view.search")
    await executeCommand("workbench.view.scm")
    await executeCommand("workbench.view.mcp")
    await executeCommand("workbench.action.togglePanel")
    await executeCommand("workbench.action.terminal.toggleTerminal")
    await executeCommand("workbench.action.splitEditor")
    await executeCommand("workbench.action.openSettings")
    await executeCommand("workbench.view.settings")

    expect(context.openSidebarView).toHaveBeenNthCalledWith(1, "search")
    expect(context.openSidebarView).toHaveBeenNthCalledWith(2, "changes")
    expect(context.openSidebarView).toHaveBeenNthCalledWith(3, "mcp")
    expect(context.toggleBottomPanel).toHaveBeenNthCalledWith(1, "output")
    expect(context.toggleBottomPanel).toHaveBeenNthCalledWith(2, "terminal")
    expect(context.toggleSplitEditor).toHaveBeenCalledTimes(1)
    expect(context.openSettingsView).toHaveBeenCalledTimes(2)
  })

  it("routes VS Code settings, profile, theme and icon commands to the matching settings surfaces", async () => {
    const context = createContext()
    registerWorkbenchLayoutActions(context)

    await executeCommand("workbench.action.openGlobalSettings")
    await executeCommand("workbench.action.openSettingsJson")
    await executeCommand("workbench.profiles.actions.manageProfiles")
    await executeCommand("workbench.action.selectTheme")
    await executeCommand("workbench.action.selectIconTheme")

    expect(context.openSettingsSection).toHaveBeenCalledTimes(5)
    expect(context.openSettingsSection).toHaveBeenNthCalledWith(1, "vscode-settings")
    expect(context.openSettingsSection).toHaveBeenNthCalledWith(2, "advanced")
    expect(context.openSettingsSection).toHaveBeenNthCalledWith(3, "advanced")
    expect(context.openSettingsSection).toHaveBeenNthCalledWith(4, "appearance")
    expect(context.openSettingsSection).toHaveBeenNthCalledWith(5, "appearance")
    expect(MenuRegistry.getMenuEntries(MenuId.CommandPalette).map((entry) => entry.id)).toEqual(expect.arrayContaining([
      "workbench.action.openGlobalSettings",
      "workbench.action.openSettingsJson",
      "workbench.profiles.actions.manageProfiles",
      "workbench.action.selectTheme",
      "workbench.action.selectIconTheme",
    ]))
  })

  it("lets later VS Code-style facade actions own duplicate workbench ids while preserving fallback", async () => {
    const context = createContext()
    const layoutDisposable = registerWorkbenchLayoutActions(context)
    const calls: Array<{ action: string; id: string }> = []
    const facadeDisposable = registerTerminalDebugTaskWorkbenchContributions({
      togglePanel: async (id) => { calls.push({ action: "togglePanel", id }) },
      openDebugView: async (id) => { calls.push({ action: "openDebugView", id }) },
    })

    expect(getCommandRegistrationDiagnostics(TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalToggle)).toMatchObject({
      id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalToggle,
      stackDepth: 2,
      duplicateCount: 1,
    })
    expect(getCommandRegistrationDiagnostics(TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugOpen)).toMatchObject({
      id: TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugOpen,
      stackDepth: 2,
      duplicateCount: 1,
    })

    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalToggle)
    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugOpen)

    expect(calls).toEqual([
      { action: "togglePanel", id: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal },
      { action: "openDebugView", id: DEBUG_WORKBENCH_VIEW_IDS.Container },
    ])
    expect(context.toggleBottomPanel).not.toHaveBeenCalled()
    expect(context.openSidebarView).not.toHaveBeenCalled()

    facadeDisposable.dispose()
    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalToggle)
    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugOpen)

    expect(context.toggleBottomPanel).toHaveBeenCalledWith("terminal")
    expect(context.openSidebarView).toHaveBeenCalledWith("debug")

    layoutDisposable.dispose()
  })

  it("contributes View menu items with VS Code-style ordering and toggled state", () => {
    const context = createContext()
    registerWorkbenchLayoutActions(context)

    const viewEntries = MenuRegistry.getMenuEntries(MenuId.MenubarViewMenu, {
      "workbench.sideBar.visible": true,
      "workbench.panel.visible": false,
    })

    expect(viewEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "workbench.action.toggleSidebarVisibility", toggled: true }),
      expect.objectContaining({ id: "workbench.action.togglePanel", toggled: false }),
      expect.objectContaining({ id: "workbench.view.explorer" }),
      expect.objectContaining({ id: "workbench.view.search" }),
      expect.objectContaining({ id: "workbench.view.mcp" }),
    ]))
  })
})
