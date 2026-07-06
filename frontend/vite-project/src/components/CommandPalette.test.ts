import { mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { nextTick } from "vue"
import {
  clearQuickAccessProviders,
  registerQuickAccessProvider,
} from "../vscode-adapter/platform/quickinput/common/quickAccess"
import { Action2, MenuId, MenuRegistry, registerAction2 } from "../vscode-adapter/platform/actions/common/menuRegistry"
import { clearCommands, registerCommand } from "../workbench/commandRegistry"
import { clearSymbolNavigationCommandHandoff } from "../workbench/symbolNavigationService"
import { provideI18n } from "../i18n/index"
import CommandPalette from "./CommandPalette.vue"

describe("CommandPalette QuickAccess", () => {
  beforeEach(() => {
    clearQuickAccessProviders()
    clearCommands()
    clearSymbolNavigationCommandHandoff()
    MenuRegistry.clear()
    localStorage.clear()
    document.body.innerHTML = ""
  })

  afterEach(() => {
    clearQuickAccessProviders()
    clearCommands()
    clearSymbolNavigationCommandHandoff()
    MenuRegistry.clear()
    document.body.innerHTML = ""
  })

  it("renders VS Code-style quick access provider results from a prefix", async () => {
    registerQuickAccessProvider({
      prefix: "mcp:",
      placeholder: "MCP",
      helpEntries: [{ description: "MCP Resources" }],
      provider: {
        provide: () => [{
          id: "mcp.resources",
          label: "Browse MCP Resources",
          description: "MCP",
        }],
      },
    })

    const wrapper = mountPalette()
    wrapper.vm.open("mcp:")
    await nextTick()
    await vi.dynamicImportSettled()
    await nextTick()

    expect(wrapper.find(".palette-section-header").text()).toBe("MCP Resources")
    expect(wrapper.text()).toContain("Browse MCP Resources")

    wrapper.unmount()
  })

  it("accepts quick access items through custom accept handlers", async () => {
    const accept = vi.fn()
    registerQuickAccessProvider({
      prefix: "mcp:",
      provider: {
        provide: () => [{
          id: "mcp.resources",
          label: "Browse MCP Resources",
          accept,
        }],
      },
    })

    const wrapper = mountPalette()
    wrapper.vm.open("mcp:")
    await nextTick()
    await vi.dynamicImportSettled()
    await nextTick()

    await wrapper.find(".palette-item").trigger("click")

    expect(accept).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted("close")).toHaveLength(1)

    wrapper.unmount()
  })

  it("executes workbench commands from quick access items on Enter", async () => {
    const handler = vi.fn()
    registerCommand({
      id: "workbench.mcp.browseResources",
      title: "MCP: Browse Resources",
      handler,
    })
    registerQuickAccessProvider({
      prefix: "mcp:",
      provider: {
        provide: () => [{
          id: "mcp.resources",
          label: "Browse MCP Resources",
          commandId: "workbench.mcp.browseResources",
        }],
      },
    })

    const wrapper = mountPalette()
    wrapper.vm.open("mcp:")
    await nextTick()
    await vi.dynamicImportSettled()
    await nextTick()

    await wrapper.find(".palette-search-input").trigger("keydown", { key: "Enter" })
    await vi.dynamicImportSettled()

    expect(handler).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it("keeps # symbol search on the legacy event path until symbol navigation handoff is ready", async () => {
    registerQuickAccessProvider({
      prefix: "#",
      provider: {
        provide: () => [{
          id: "symbol.run",
          label: "run",
        }],
      },
    })

    const wrapper = mountPalette()
    wrapper.vm.open("#run")
    await nextTick()
    await vi.dynamicImportSettled()
    await nextTick()

    expect(wrapper.text()).toContain("搜索符号")

    await wrapper.find(".palette-search-input").trigger("keydown", { key: "Enter" })

    expect(wrapper.emitted("symbolSearch")?.[0]).toEqual(["run"])

    wrapper.unmount()
  })

  it("executes MCP Gallery detail commands from quick access without a custom dialog", async () => {
    const handler = vi.fn()
    registerCommand({
      id: "workbench.mcp.openGalleryServer",
      title: "MCP: Open Gallery Server",
      handler,
    })
    registerQuickAccessProvider({
      prefix: "mcp:",
      provider: {
        provide: () => [{
          id: "mcp.gallery.filesystem",
          label: "Filesystem MCP",
          description: "MCP Gallery",
          detail: "打开 Gallery 详情",
          commandId: "workbench.mcp.openGalleryServer",
          args: [{ name: "io.modelcontextprotocol.filesystem" }],
        }],
      },
    })

    const wrapper = mountPalette()
    wrapper.vm.open("mcp:filesystem")
    await nextTick()
    await vi.dynamicImportSettled()
    await nextTick()

    await wrapper.find(".palette-search-input").trigger("keydown", { key: "Enter" })
    await vi.dynamicImportSettled()

    expect(handler).toHaveBeenCalledWith({ name: "io.modelcontextprotocol.filesystem" })
    expect(wrapper.emitted("close")).toHaveLength(1)

    wrapper.unmount()
  })

  it("runs quick access item buttons without accepting the item", async () => {
    const accept = vi.fn()
    const attach = vi.fn()
    registerQuickAccessProvider({
      prefix: "mcpr ",
      provider: {
        provide: () => [{
          id: "mcpr.readme",
          label: "README",
          accept,
          buttons: [{ id: "attach", label: "+", tooltip: "Attach to chat", accept: attach }],
        }],
      },
    })

    const wrapper = mountPalette()
    wrapper.vm.open("mcpr readme")
    await nextTick()
    await vi.dynamicImportSettled()
    await nextTick()

    await wrapper.find(".palette-item-button").trigger("click")

    expect(attach).toHaveBeenCalledTimes(1)
    expect(accept).not.toHaveBeenCalled()
    expect(wrapper.emitted("close")).toHaveLength(1)

    wrapper.unmount()
  })

  it("runs quick access item buttons in the background when requested", async () => {
    const attach = vi.fn()
    registerQuickAccessProvider({
      prefix: "mcpr ",
      provider: {
        provide: () => [{
          id: "mcpr.readme",
          label: "README",
          buttons: [{ id: "attach", label: "+", tooltip: "Attach to chat", acceptInBackground: true, accept: attach }],
        }],
      },
    })

    const wrapper = mountPalette()
    wrapper.vm.open("mcpr readme")
    await nextTick()
    await vi.dynamicImportSettled()
    await nextTick()

    await wrapper.find(".palette-item-button").trigger("click")

    expect(attach).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted("close")).toBeUndefined()
    expect(wrapper.find(".palette-item").exists()).toBe(true)

    wrapper.unmount()
  })

  it("renders and executes Action2 command palette contributions from the shared registry", async () => {
    const run = vi.fn()
    class OpenAgentEvidenceAction extends Action2 {
      constructor() {
        super({
          id: "agent.evidence.openTimeline",
          title: { value: "打开智能体证据时间线" },
          category: { value: "智能体" },
          f1: true,
          menu: { id: MenuId.AgentEvidenceTimeline },
        })
      }

      override run(): void {
        run()
      }
    }
    const disposable = registerAction2(OpenAgentEvidenceAction)

    const wrapper = mountPalette()
    wrapper.vm.open()
    await nextTick()

    const input = wrapper.find(".palette-search-input")
    await input.setValue("证据")
    await input.trigger("input")
    await nextTick()

    expect(wrapper.text()).toContain("打开智能体证据时间线")
    await wrapper.find(".palette-search-input").trigger("keydown", { key: "Enter" })
    await vi.dynamicImportSettled()

    expect(run).toHaveBeenCalledTimes(1)
    disposable.dispose()
    wrapper.unmount()
  })

  it("does not own global Ctrl+Shift+P handling", async () => {
    const wrapper = mountPalette()
    const event = new KeyboardEvent("keydown", {
      key: "p",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })

    document.dispatchEvent(event)
    await nextTick()

    expect(event.defaultPrevented).toBe(false)
    expect(wrapper.find(".palette-overlay").exists()).toBe(false)

    wrapper.unmount()
  })
})

function mountPalette() {
  return mount(CommandPalette, {
    attachTo: document.body,
    global: {
      plugins: [{
        install(app) {
          provideI18n(app)
        },
      }],
    },
  })
}
