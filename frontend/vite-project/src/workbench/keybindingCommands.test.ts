import { describe, expect, it, vi } from "vitest"
import zh from "../i18n/zh"
import { clearKeybindings, getRegisteredKeybindings } from "../keybindings"
import { installWorkbenchKeybindings, type WorkbenchKeybindingContext } from "./keybindingCommands"
import { clearCommands, registerCommand } from "./commandRegistry"

function t(key: string): string {
  const value = key.split(".").reduce<unknown>((current, part) => {
    if (current && typeof current === "object") return (current as Record<string, unknown>)[part]
    return undefined
  }, zh)
  return typeof value === "string" ? value : key
}

function createContext(): WorkbenchKeybindingContext {
  return {
    t,
    getEditor: () => null,
    getWorkspace: () => ({ activeFile: null }),
    isInlineEditVisible: () => false,
    setQuickQuestionVisible: () => {},
    saveActiveFile: () => {},
    toggleChatPanel: () => {},
    openInlineEdit: () => {},
    openSidebarView: () => {},
    handleToggleSplit: () => {},
    sendSelectionToChat: () => {},
    toggleMinimap: () => {},
    focusNextRegion: () => {},
    focusPrevRegion: () => {},
    zoomIn: () => {},
    zoomOut: () => {},
    zoomReset: () => {},
    handleCloseTab: () => {},
    openGotoLine: () => {},
    openFileSwitcher: () => {},
    handleSwitcherKeydown: () => {},
    handleSwitcherKeyup: () => {},
    handleAccessibilityKeydown: () => {},
  }
}

describe("installWorkbenchKeybindings", () => {
  it("registers user-visible keybinding descriptions in Chinese by default", () => {
    const dispose = installWorkbenchKeybindings(createContext())

    const descriptions = new Map(getRegisteredKeybindings().map((binding) => [binding.id, binding.description]))
    expect(descriptions.get("toggleSplit")).toBe("切换分屏编辑器")
    expect(descriptions.get("rename")).toBe("重命名符号")
    expect(descriptions.get("format")).toBe("格式化文档")
    expect(descriptions.get("quickQuestion")).toBe("快速提问")
    expect(descriptions.get("focusNextRegion")).toBe("聚焦下一个区域")
    expect(descriptions.get("focusPrevRegion")).toBe("聚焦上一个区域")

    expect([...descriptions.values()]).not.toEqual(
      expect.arrayContaining([
        "Toggle split editor",
        "Rename symbol",
        "Format document",
        "Quick question",
        "Focus next region",
        "Focus previous region",
      ]),
    )

    dispose()
    clearKeybindings()
  })

  it("opens the command palette through the keybinding resolver and command service", async () => {
    const handler = vi.fn()
    registerCommand({ id: "workbench.action.showCommands", title: "Show Commands", handler })
    const dispose = installWorkbenchKeybindings({
      ...createContext(),
    })

    const event = new KeyboardEvent("keydown", {
      key: "p",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))

    dispose()
    clearKeybindings()
    clearCommands()
  })

  it("opens file quick access through the same keybinding resolver and command service", async () => {
    const handler = vi.fn()
    registerCommand({ id: "workbench.action.quickOpen", title: "Quick Open", handler })
    const openSidebarView = vi.fn()
    const dispose = installWorkbenchKeybindings({
      ...createContext(),
      openSidebarView,
    })

    const event = new KeyboardEvent("keydown", {
      key: "p",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))
    expect(openSidebarView).not.toHaveBeenCalled()

    dispose()
    clearKeybindings()
    clearCommands()
  })
})
