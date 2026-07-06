import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import SettingsPanel from "./SettingsPanel.vue"
import { provideI18n } from "../i18n/index"

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(async (_path?: string) => ({})),
  apiPost: vi.fn(async (_path?: string, _body?: unknown) => ({})),
  codekApi: vi.fn(async (_method?: string, _path?: string, _body?: unknown, _headers?: unknown, _options?: unknown) => ({})),
  installVsixFile: vi.fn(async () => ({ success: true })),
  showInstalledExtensions: vi.fn(async () => []),
  workbenchUninstall: vi.fn(async () => ({ success: true })),
  workbenchEnable: vi.fn(async () => ({ success: true })),
  workbenchDisable: vi.fn(async () => ({ success: true })),
  ehStatus: vi.fn(async () => ({ state: "running", activated: 0 })),
  syncExtensionProfileContentHandlers: vi.fn(async () => 1),
  importProfileFromFile: vi.fn(async () => ({
    status: "imported" as const,
    filePath: "D:/Workspace/profile.code-profile",
    profile: {
      id: "imported-profile",
      name: "Imported Profile",
      source: "vscode" as const,
      settings: {},
      keybindings: [],
      resources: {},
      userDataProfile: {},
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
  })),
  exportProfileToFile: vi.fn(async () => ({
    status: "exported" as const,
    filePath: "D:/Workspace/profile.code-profile",
    bytesWritten: 128,
  })),
}))

vi.mock("../workspace/manager.js", () => ({
  workspace: {
    projectRoot: "D:/Workspace",
  },
}))

vi.mock("../ai/indexer", () => ({
  buildIndex: vi.fn(),
}))

vi.mock("../lib/api", () => ({
  api: {
    get: mocks.apiGet,
    post: mocks.apiPost,
  },
}))

vi.mock("../extensions/ehClient", () => ({
  reloadExtensionHost: vi.fn(async () => {}),
  installVsixFile: mocks.installVsixFile,
  ehStatus: mocks.ehStatus,
}))

vi.mock("../extensions/extensionsWorkbenchService", () => ({
  extensionWorkbenchService: {
    showInstalled: mocks.showInstalledExtensions,
    uninstall: mocks.workbenchUninstall,
    enable: mocks.workbenchEnable,
    disable: mocks.workbenchDisable,
  },
}))

vi.mock("../vscode-adapter/workbench/services/userDataProfile/browser/userDataProfileImportExportService", () => ({
  userDataProfileImportExportService: {
    syncExtensionProfileContentHandlers: mocks.syncExtensionProfileContentHandlers,
    importProfileFromFile: mocks.importProfileFromFile,
    exportProfileToFile: mocks.exportProfileToFile,
  },
}))

function mountSettingsPanel() {
  return mount(SettingsPanel, {
    props: {
      ollamaOk: true,
      selectedModel: "qwen2.5-coder:1.5b",
      availableModels: ["qwen2.5-coder:1.5b", "qwen2.5-coder:3b"],
      autoSaveMode: "off",
    },
    global: {
      plugins: [
        {
          install(app) {
            provideI18n(app)
          },
        },
      ],
    },
  })
}

describe("SettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mocks.apiGet.mockResolvedValue({})
    mocks.codekApi.mockResolvedValue({})
    ;(window as any).codek = {
      openFileDialog: vi.fn(async () => ({ filePath: "D:/Workspace/test-extension.vsix" })),
      api: mocks.codekApi,
    }
  })

  it("keeps the settings page localized and removes duplicate workspace settings entry", async () => {
    const wrapper = mountSettingsPanel()

    expect(wrapper.find(".settings-row-control .codek-select-shell").exists()).toBe(true)
    expect(wrapper.text()).not.toContain("打开工作区设置")
    expect(wrapper.text()).not.toContain("真实工作区试运行设置")
    expect(wrapper.find('[data-codek-smoke="real-workspace-trial-settings"]').exists()).toBe(false)
    expect(wrapper.find(".schema-settings-key").exists()).toBe(false)

    const navGroupLabels = wrapper.findAll(".settings-nav-group-label").map((label) => label.text())
    expect(navGroupLabels).not.toContain("工作区")

    wrapper.vm.openSection("agent")
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll(".codek-textarea.variant-code").length).toBeGreaterThanOrEqual(2)
    expect(wrapper.find(".settings-textarea").exists()).toBe(false)
    expect(wrapper.find('[role="switch"][aria-checked="true"]').exists()).toBe(true)

    wrapper.vm.openSection("release")
    await wrapper.vm.$nextTick()
    expect(wrapper.find(".release-actions .codek-select-shell").exists()).toBe(true)
    expect(wrapper.find(".settings-select").exists()).toBe(false)

    wrapper.vm.openSection("languages")
    await wrapper.vm.$nextTick()
    expect(wrapper.find(".settings-row > .codek-select-shell").exists()).toBe(true)
  })

  it("opens VS Code settings with Workspace Trust query evidence", async () => {
    const wrapper = mountSettingsPanel()

    wrapper.vm.openSection("vscode-settings", "@tag:workspaceTrust")
    await wrapper.vm.$nextTick()

    const evidence = wrapper.find('[data-codek-smoke="settings-query-evidence"]')
    expect(evidence.exists()).toBe(true)
    expect(evidence.attributes("data-settings-query")).toBe("@tag:workspaceTrust")
    expect(evidence.attributes("data-settings-section")).toBe("vscode-settings")
    expect(evidence.text()).toContain("@tag:workspaceTrust")
    expect((wrapper.find(".settings-search-input").element as HTMLInputElement).value).toBe("@tag:workspaceTrust")
    expect(wrapper.text()).toContain("工作区信任")
  })

  it("toggles sandbox network blocking instead of rendering an inert checkbox", async () => {
    const wrapper = mountSettingsPanel()

    wrapper.vm.openSection("agent")
    await wrapper.vm.$nextTick()

    const switchButton = wrapper.find(".settings-switch-wide")
    expect(switchButton.exists()).toBe(true)
    expect(switchButton.attributes("role")).toBe("switch")
    expect(switchButton.attributes("aria-checked")).toBe("true")
    expect(switchButton.text()).toContain("已阻断")

    await switchButton.trigger("click")

    expect(switchButton.attributes("aria-checked")).toBe("false")
    expect(switchButton.text()).toContain("未阻断")
    expect(mocks.codekApi).toHaveBeenCalledWith(
      "POST",
      "/sandbox/settings",
      expect.objectContaining({ blockNetwork: false }),
    )
  })

  it("installs a VSIX through the Electron file dialog", async () => {
    const wrapper = mountSettingsPanel()

    wrapper.vm.openSection("extensions")
    await wrapper.vm.$nextTick()

    const installButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("从 .vsix 安装"))
    expect(installButton).toBeTruthy()

    await installButton!.trigger("click")
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    expect((window as any).codek.openFileDialog).toHaveBeenCalledWith({
      title: "选择 .vsix 扩展包",
      filters: [{ name: "VS Code Extension", extensions: ["vsix"] }],
      readContent: false,
    })
    expect(mocks.installVsixFile).toHaveBeenCalledWith("D:/Workspace/test-extension.vsix")
    expect(wrapper.text()).toContain("扩展安装完成。")
  })

  it("uses service-backed status and enablement actions for installed extensions", async () => {
    mocks.showInstalledExtensions.mockResolvedValue([
      {
        id: "sample.publisher-extension",
        displayName: "Sample Extension",
        description: "Adds focused evidence views",
        version: "1.2.3",
        publisher: "sample",
        downloads: 42,
        categories: ["Other"],
        builtin: false,
        enabled: true,
        statusLabel: "已启用",
        availability: {
          status: "disabled",
          label: "已禁用（需重载）",
          detail: "扩展宿主尚未重新加载。",
          reason: "extension-host",
        },
      },
    ])

    const wrapper = mountSettingsPanel()
    wrapper.vm.openSection("extensions")
    await flushPromises()

    expect(wrapper.text()).toContain("已禁用（需重载）")
    const enableButton = wrapper.findAll("button").find((button) => button.text().includes("启用"))
    expect(enableButton).toBeTruthy()

    await enableButton!.trigger("click")
    await flushPromises()

    expect(mocks.workbenchEnable).toHaveBeenCalledWith("sample.publisher-extension")
    expect(mocks.workbenchDisable).not.toHaveBeenCalled()
  })

  it("routes uninstall through the shared extension workbench service", async () => {
    mocks.showInstalledExtensions.mockResolvedValue([
      {
        id: "sample.publisher-extension",
        displayName: "Sample Extension",
        description: "Adds focused evidence views",
        version: "1.2.3",
        publisher: "sample",
        downloads: 42,
        categories: ["Other"],
        builtin: false,
        enabled: true,
      },
    ])

    const wrapper = mountSettingsPanel()
    wrapper.vm.openSection("extensions")
    await flushPromises()

    const uninstallButton = wrapper.findAll("button").find((button) => button.text().includes("卸载"))
    expect(uninstallButton).toBeTruthy()

    await uninstallButton!.trigger("click")
    await flushPromises()

    expect(mocks.workbenchUninstall).toHaveBeenCalledWith("sample.publisher-extension")
  })

  it("syncs VS Code profile content handlers before importing a profile file", async () => {
    const wrapper = mountSettingsPanel()

    wrapper.vm.openSection("advanced")
    await wrapper.vm.$nextTick()

    const importButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("导入 .code-profile"))
    expect(importButton).toBeTruthy()

    await importButton!.trigger("click")
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(mocks.syncExtensionProfileContentHandlers).toHaveBeenCalledTimes(1)
    expect(mocks.importProfileFromFile).toHaveBeenCalledTimes(1)
    expect(mocks.syncExtensionProfileContentHandlers.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.importProfileFromFile.mock.invocationCallOrder[0],
    )
  })

  it("syncs VS Code profile content handlers before exporting a profile file", async () => {
    const wrapper = mountSettingsPanel()

    await (wrapper.vm as any).exportWorkbenchProfileFile("profile-for-export")
    await flushPromises()

    expect(mocks.syncExtensionProfileContentHandlers).toHaveBeenCalledTimes(1)
    expect(mocks.exportProfileToFile).toHaveBeenCalledWith("profile-for-export")
    expect(mocks.syncExtensionProfileContentHandlers.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.exportProfileToFile.mock.invocationCallOrder[0],
    )
  })

  it("rehydrates workbench profiles when the desktop profile store broadcasts a change", async () => {
    let listener: ((payload: unknown) => void) | undefined
    const unsubscribe = vi.fn()
    mocks.apiGet.mockImplementation(async (path) => {
      if (String(path).startsWith("/profiles/workbench")) {
        return {
          exists: true,
          activeProfileId: "broadcast-profile",
          profiles: [
            {
              id: "broadcast-profile",
              name: "Broadcast Profile",
              source: "vscode",
              settings: {},
              keybindings: [],
              resources: {},
              createdAt: "2026-06-01T00:00:00.000Z",
              updatedAt: "2026-06-01T00:00:00.000Z",
            },
          ],
        }
      }
      return {}
    })
    ;(window as any).codek = {
      openFileDialog: vi.fn(async () => ({ filePath: "D:/Workspace/test-extension.vsix" })),
      api: mocks.codekApi,
      onUserDataProfileChanged: vi.fn((callback) => {
        listener = callback
        return unsubscribe
      }),
    }

    const wrapper = mountSettingsPanel()
    await flushPromises()
    const readCountAfterMount = mocks.apiGet.mock.calls.filter((call) => String(call[0]).startsWith("/profiles/workbench")).length

    listener?.({ reason: "profiles:write" })
    await flushPromises()

    const readCountAfterBroadcast = mocks.apiGet.mock.calls.filter((call) => String(call[0]).startsWith("/profiles/workbench")).length
    expect((window as any).codek.onUserDataProfileChanged).toHaveBeenCalledTimes(1)
    expect(readCountAfterBroadcast).toBe(readCountAfterMount + 1)
    wrapper.vm.openSection("advanced")
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain("Broadcast Profile")

    wrapper.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
