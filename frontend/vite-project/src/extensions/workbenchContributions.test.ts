import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearKeybindings, getRegisteredKeybindings, handleKeyEvent, setKeybindingContext } from "../keybindings"
import { detectLanguageForPath, resetLanguageRegistry } from "../languages/languageRegistry"
import { clearCommands, executeCommand, getCommand, registerCommand } from "../workbench/commandRegistry"
import { clearViews, getViewContainers, getViews } from "../workbench/viewRegistry"
import { MenuId, MenuRegistry } from "../vscode-adapter/platform/actions/common/menuRegistry"
import { clearQuickAccessProviders, matchQuickAccessProvider } from "../vscode-adapter/platform/quickinput/common/quickAccess"
import { loadExtensionWorkbenchContributions } from "./workbenchContributions"
import { EXTENSIONS_WORKBENCH_COMMAND_IDS, EXTENSIONS_WORKBENCH_VIEW_IDS, disposeExtensionWorkbenchContributions } from "./extensionsWorkbenchService"

function asApiGet(valueOrFactory: unknown | (() => unknown)) {
  const mock = vi.fn(async (_path: string) => (typeof valueOrFactory === "function" ? (valueOrFactory as () => unknown)() : valueOrFactory))
  const get = async <T = unknown>(path: string): Promise<T> => mock(path) as Promise<T>
  return { get, mock }
}

function asApiPost(value: unknown) {
  const mock = vi.fn(async (_path: string, _body?: unknown) => value)
  const post = async <T = unknown>(path: string, body?: unknown): Promise<T> => mock(path, body) as Promise<T>
  return { post, mock }
}

describe("extension workbench contributions bridge", () => {
  beforeEach(() => {
    disposeExtensionWorkbenchContributions()
    clearCommands()
    clearViews()
    clearKeybindings()
    clearQuickAccessProviders()
    resetLanguageRegistry()
    MenuRegistry.clear()
  })

  it("registers extension commands, views, languages and keybindings in workbench registries", async () => {
    const { get } = asApiGet({
      commands: [{ id: "sample.hello", title: "Hello", category: "Sample", enablement: "editorTextFocus" }],
      viewsContainers: [{ id: "sampleContainer", name: "Sample", location: "activityBar" }],
      views: [{ id: "sampleView", name: "Sample View", containerId: "sampleContainer", when: "sampleEnabled" }],
      languages: [{ id: "astro", aliases: ["Astro"], extensions: [".astro"], extensionId: "astro-build.astro-vscode" }],
      menus: [
        { location: "commandPalette", command: "sample.hello", when: "editorTextFocus", group: "navigation", order: 3 },
        { location: "explorer/context", command: "sample.hello", when: "resourceLangId == astro", group: "navigation", order: 10 },
      ],
      keybindings: [
        { command: "sample.hello", key: "ctrl+alt+h", when: "editorTextFocus" },
        { command: "sample.chord", key: "ctrl+k ctrl+s", when: "editorTextFocus" },
      ],
    })
    const { post, mock: postMock } = asApiPost({ success: true })

    const registerCommands = vi.fn()
    const result = await loadExtensionWorkbenchContributions({
      apiClient: { get, post },
      commandPalette: {
        registerCommands,
      },
    })

    expect(result.ok).toBe(true)
    expect(result.summary.commands).toBe(1)
    expect(result.summary.viewsContainers).toBe(1)
    expect(result.summary.views).toBe(1)
    expect(result.summary.menus).toBe(2)
    expect(result.summary.languages).toBe(1)
    expect(getCommand(EXTENSIONS_WORKBENCH_COMMAND_IDS.Search)).toMatchObject({ source: "vscode", category: "扩展" })
    expect(getCommand("sample.hello")).toMatchObject({ title: "Hello", precondition: "editorTextFocus" })
    expect(getViewContainers("activityBar", { sampleEnabled: true }).map((container) => container.id)).toEqual(expect.arrayContaining([
      EXTENSIONS_WORKBENCH_VIEW_IDS.Container,
      "sampleContainer",
    ]))
    expect(getViews(EXTENSIONS_WORKBENCH_VIEW_IDS.Container).map((view) => view.id)).toEqual([
      EXTENSIONS_WORKBENCH_VIEW_IDS.Marketplace,
      EXTENSIONS_WORKBENCH_VIEW_IDS.Installed,
      EXTENSIONS_WORKBENCH_VIEW_IDS.Editor,
    ])
    expect(getViews("sampleContainer", { sampleEnabled: true }).map((view) => view.id)).toEqual(["sampleView"])
    expect(MenuRegistry.getMenuEntries(MenuId.CommandPalette, { editorTextFocus: false }).map((entry) => entry.type === "item" ? entry.commandId : entry.id)).not.toContain("sample.hello")
    expect(MenuRegistry.getMenuEntries(MenuId.CommandPalette, { editorTextFocus: true }).map((entry) => entry.type === "item" ? entry.commandId : entry.id)).toContain("sample.hello")
    expect(MenuRegistry.getMenuEntries(MenuId.ExplorerContext, { resourceLangId: "plaintext" }).map((entry) => entry.type === "item" ? entry.commandId : entry.id)).not.toContain("sample.hello")
    expect(MenuRegistry.getMenuEntries(MenuId.ExplorerContext, { resourceLangId: "astro" }).map((entry) => entry.type === "item" ? entry.commandId : entry.id)).toContain("sample.hello")
    expect(matchQuickAccessProvider("ext sample")?.descriptor.prefix).toBe("ext ")
    expect(getRegisteredKeybindings().map((binding) => binding.id)).toContain("sample.hello")
    expect(getRegisteredKeybindings().find((binding) => binding.id === "sample.chord")?.sequence).toEqual([
      { key: "k", ctrl: true, shift: false, alt: false },
      { key: "s", ctrl: true, shift: false, alt: false },
    ])
    expect(detectLanguageForPath("src/page.astro")).toBe("astro")

    expect(await executeCommand("sample.hello", [], { editorTextFocus: false })).toBe(false)
    expect(postMock).not.toHaveBeenCalled()
    await executeCommand("sample.hello", [], { editorTextFocus: true })
    expect(postMock).toHaveBeenCalledWith("/extensions-host/commands/execute", {
      commandId: "sample.hello",
      args: [],
    })

    const explorerCommand = MenuRegistry.getMenuEntries(MenuId.ExplorerContext, { resourceLangId: "astro", editorTextFocus: true })
      .find((entry) => entry.type === "item" && entry.commandId === "sample.hello")
    expect(explorerCommand).toEqual(expect.objectContaining({ label: "Hello", disabled: false }))
    await executeCommand(explorerCommand!.id, ["src/page.astro"], { editorTextFocus: true })
    expect(postMock).toHaveBeenCalledWith("/extensions-host/commands/execute", {
      commandId: "sample.hello",
      args: ["src/page.astro"],
    })

    expect(registerCommands).not.toHaveBeenCalled()
    const paletteCommand = MenuRegistry.getMenuEntries(MenuId.CommandPalette, { editorTextFocus: true })
      .find((entry) => entry.type === "item" && entry.commandId === "sample.hello")
    const override = vi.fn()
    registerCommand({
      id: "sample.hello",
      title: "Hello override",
      category: "Sample",
      handler: override,
    })
    await executeCommand(paletteCommand!.id, [], { editorTextFocus: true })
    expect(override).toHaveBeenCalledTimes(1)
    expect(postMock).toHaveBeenCalledTimes(2)
  })

  it("routes extension keybinding-only contributions through the shared command registry with keybinding context", async () => {
    const { get } = asApiGet({
      keybindings: [
        { command: "sample.hello", key: "ctrl+alt+h", when: "editorTextFocus" },
      ],
    })
    const { post, mock: postMock } = asApiPost({ success: true })

    await loadExtensionWorkbenchContributions({
      apiClient: { get, post },
    })

    setKeybindingContext({ editorTextFocus: false })
    expect(handleKeyEvent(new KeyboardEvent("keydown", {
      key: "h",
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    }))).toBe(false)
    expect(postMock).not.toHaveBeenCalled()

    setKeybindingContext({ editorTextFocus: true })
    expect(handleKeyEvent(new KeyboardEvent("keydown", {
      key: "h",
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    }))).toBe(true)
    await vi.dynamicImportSettled()
    expect(postMock).toHaveBeenCalledWith("/extensions-host/commands/execute", {
      commandId: "sample.hello",
      args: [],
    })
  })

  it("throws when an extension command execution returns an explicit failure", async () => {
    const { get } = asApiGet({
      commands: [{ id: "sample.fail", title: "Fail" }],
    })
    const { post } = asApiPost({ success: false, message: "Extension host is not running" })

    await loadExtensionWorkbenchContributions({
      apiClient: { get, post },
    })

    await expect(executeCommand("sample.fail")).rejects.toThrow("Extension host is not running")
  })

  it("fails softly when contribution API is unavailable", async () => {
    const { get } = asApiGet(() => {
      throw new Error("offline")
    })
    const { post } = asApiPost({})

    const result = await loadExtensionWorkbenchContributions({
      apiClient: { get, post },
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain("offline")
    expect(getCommand(EXTENSIONS_WORKBENCH_COMMAND_IDS.Search)).toMatchObject({ source: "vscode" })
    expect(getViewContainers("activityBar").map((container) => container.id)).toContain(EXTENSIONS_WORKBENCH_VIEW_IDS.Container)
    expect(matchQuickAccessProvider("ext sample")?.descriptor.prefix).toBe("ext ")
  })
})
