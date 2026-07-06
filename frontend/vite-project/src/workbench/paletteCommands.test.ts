import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearCommands, executeCommand, getCommand } from "./commandRegistry"
import { installCommandPaletteCommands } from "./paletteCommands"
import { MenuRegistry } from "../vscode-adapter/platform/actions/common/menuRegistry"
import {
  TERMINAL_DEBUG_TASK_COMMAND_IDS,
  TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS,
  disposeTerminalDebugTaskWorkbenchContributions,
  registerTerminalDebugTaskWorkbenchContributions,
} from "./terminalDebugTaskWorkbench"

function createContext(overrides: Partial<Parameters<typeof installCommandPaletteCommands>[0]> = {}) {
  const open = vi.fn()
  const registerCommands = vi.fn()
  const context = {
    t: (key: string) => key,
    getCommandPalette: () => ({ open, registerCommands }),
    getEditor: () => null,
    getWorkspace: () => ({ activeFile: null }),
    getOpenFiles: () => [],
    saveActiveFile: vi.fn(),
    saveFile: vi.fn(),
    openSidebarView: vi.fn(),
    toggleChatPanel: vi.fn(),
    toggleSidebarVisibility: vi.fn(),
    toggleOutputPanel: vi.fn(),
    toggleCollab: vi.fn(),
    toggleMinimap: vi.fn(),
    toggleSidebarView: vi.fn(),
    toggleLargeFile: vi.fn(),
    handleCloseTab: vi.fn(),
    closeOtherTabs: vi.fn(),
    closeAllSavedTabs: vi.fn(),
    openGotoLine: vi.fn(),
    openFileSwitcher: vi.fn(),
    openInlineEdit: vi.fn(),
    handleMenuAction: vi.fn(),
    ...overrides,
  }
  return { context, open, registerCommands }
}

describe("installCommandPaletteCommands", () => {
  beforeEach(() => {
    disposeTerminalDebugTaskWorkbenchContributions()
    clearCommands()
    MenuRegistry.clear()
  })

  it("registers VS Code quick access command ids as the executable command service entries", async () => {
    const { context, open, registerCommands } = createContext()
    installCommandPaletteCommands(context)

    expect(getCommand("workbench.action.quickOpen")?.title).toBe("app.cmdQuickOpen")
    expect(getCommand("workbench.action.showCommands")?.title).toBe("app.cmdCommandPalette")
    expect(registerCommands).not.toHaveBeenCalled()

    await expect(executeCommand("workbench.action.quickOpen")).resolves.toBe(true)
    expect(open).toHaveBeenCalledWith("files")

    await expect(executeCommand("workbench.action.showCommands")).resolves.toBe(true)
    expect(open).toHaveBeenCalledWith()
  })

  it("keeps legacy palette ids as aliases to the command service path", async () => {
    const { context, open } = createContext()
    installCommandPaletteCommands(context)

    await expect(executeCommand("quickOpen")).resolves.toBe(true)
    await expect(executeCommand("commandPalette")).resolves.toBe(true)

    expect(open).toHaveBeenCalledWith("files")
    expect(open).toHaveBeenCalledWith()
  })

  it("registers command palette entries even when the component instance is not mounted", async () => {
    installCommandPaletteCommands({
      ...createContext().context,
      getCommandPalette: () => null,
    })

    expect(getCommand("workbench.action.quickOpen")?.title).toBe("app.cmdQuickOpen")
    expect(getCommand("workbench.action.showCommands")?.title).toBe("app.cmdCommandPalette")
    await expect(executeCommand("workbench.action.quickOpen")).resolves.toBe(true)
  })

  it("routes the legacy Open Output palette entry through the VS Code-style output command when registered", async () => {
    const calls: string[] = []
    registerTerminalDebugTaskWorkbenchContributions({
      openPanel: async (id) => { calls.push(id) },
    })
    const { context } = createContext()
    installCommandPaletteCommands(context)

    await expect(executeCommand("openOutput")).resolves.toBe(true)
    await vi.waitFor(() => {
      expect(calls).toEqual([TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output])
    })

    expect(context.toggleOutputPanel).not.toHaveBeenCalled()
    expect(TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputShow).toBe("workbench.action.output.showOutput")
  })
})
