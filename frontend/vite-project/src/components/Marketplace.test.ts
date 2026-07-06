import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Marketplace from "./Marketplace.vue"
import {
  EXTENSIONS_WORKBENCH_COMMAND_IDS,
  EXTENSIONS_WORKBENCH_VIEW_IDS,
  extensionWorkbenchService,
  getExtensionWorkbenchSurfaceSnapshot,
} from "../extensions/extensionsWorkbenchService"
import { getMigratedExtensionQueue } from "../extensions/ehClient"
import type { VsixMetadata } from "../extensions/ehClient"

vi.mock("../extensions/ehClient", () => ({
  getExtensionIconDataUrl: vi.fn().mockResolvedValue(""),
  getInstalledExtensionIconDataUrl: vi.fn().mockResolvedValue(""),
  getMigratedExtensionQueue: vi.fn(),
  updateMigratedExtensionStatus: vi.fn(),
}))

vi.mock("../extensions/extensionsWorkbenchService", async () => {
  const actual = await vi.importActual<typeof import("../extensions/extensionsWorkbenchService")>("../extensions/extensionsWorkbenchService")
  return {
    ...actual,
    extensionWorkbenchService: {
      search: vi.fn(),
      showInstalled: vi.fn(),
      install: vi.fn(),
      uninstall: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      open: vi.fn(),
      setEditorViewModelForEvidence: vi.fn(),
    },
    getExtensionWorkbenchSurfaceSnapshot: vi.fn(),
  }
})

const sampleExtension: VsixMetadata = {
  id: "sample.publisher-extension",
  displayName: "Sample Extension",
  description: "Marketplace result from the shared service",
  version: "1.2.3",
  publisher: "sample",
  downloads: 42,
  categories: ["Other"],
}

function surfaceSnapshot() {
  return {
    source: "extensionsWorkbenchService" as const,
    serviceId: "extensionsWorkbenchService",
    containerId: EXTENSIONS_WORKBENCH_VIEW_IDS.Container,
    viewIds: [
      EXTENSIONS_WORKBENCH_VIEW_IDS.Marketplace,
      EXTENSIONS_WORKBENCH_VIEW_IDS.Installed,
      EXTENSIONS_WORKBENCH_VIEW_IDS.Editor,
    ],
    commandIds: Object.values(EXTENSIONS_WORKBENCH_COMMAND_IDS),
    quickAccessPrefix: "ext " as const,
    stateSource: "service" as const,
    contributionSummary: {
      source: "extensionsWorkbenchService" as const,
      serviceId: "extensionsWorkbenchService",
      label: "Extensions workspace surface: Marketplace, Installed, Details, Command Palette, View Title, Quick Access",
      containerId: EXTENSIONS_WORKBENCH_VIEW_IDS.Container,
      viewIds: [
        EXTENSIONS_WORKBENCH_VIEW_IDS.Marketplace,
        EXTENSIONS_WORKBENCH_VIEW_IDS.Installed,
        EXTENSIONS_WORKBENCH_VIEW_IDS.Editor,
      ],
      commandIds: Object.values(EXTENSIONS_WORKBENCH_COMMAND_IDS),
      supportedContributionPoints: ["commands", "configuration", "storage", "views"],
      unsupportedContributionPoints: ["debuggers", "notebooks", "webviews"],
      usabilityContract: "installed->enabled->extensionHostActivation->contributionProjection" as const,
      quickAccessPrefix: "ext " as const,
      viewActionMenuDriven: true as const,
      noSecondInstallState: true as const,
    },
    lastSearchQuery: "sample",
    lastSearchResultCount: 1,
    installedCount: 0,
    editorCount: 1,
    openedExtensionIds: [sampleExtension.id],
    latestEditorId: sampleExtension.id,
    actionStateCount: 0,
    pendingActionCount: 0,
    errorActionCount: 0,
    progressCount: 0,
    constraints: {
      localFirst: true as const,
      goesThroughEhClient: true as const,
      noSecondInstallState: true as const,
      viewActionMenuDriven: true as const,
    },
  }
}

describe("Marketplace", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(extensionWorkbenchService.search).mockResolvedValue([sampleExtension])
    vi.mocked(extensionWorkbenchService.showInstalled).mockResolvedValue([])
    vi.mocked(extensionWorkbenchService.install).mockResolvedValue({ success: true })
    vi.mocked(extensionWorkbenchService.uninstall).mockResolvedValue({ success: true })
    vi.mocked(extensionWorkbenchService.enable).mockResolvedValue({ success: true })
    vi.mocked(extensionWorkbenchService.disable).mockResolvedValue({ success: true })
    vi.mocked(extensionWorkbenchService.open).mockResolvedValue(null)
    vi.mocked(extensionWorkbenchService.setEditorViewModelForEvidence).mockImplementation((payload) => ({
      id: payload.id,
      installState: "installable",
      detailSummary: {
        requiresConfirmation: true,
        actionIds: ["install"],
      },
    }) as never)
    vi.mocked(getExtensionWorkbenchSurfaceSnapshot).mockReturnValue(surfaceSnapshot())
    vi.mocked(getMigratedExtensionQueue).mockResolvedValue({
      exists: false,
      path: "",
      source: "vscode",
      importedAt: "",
      installPolicy: "manual",
      reason: "no migrated queue",
      total: 0,
      pending: 0,
      installed: 0,
      failed: 0,
      extensions: [],
    })
  })

  it("renders the shared Extension Gallery workbench surface without creating a second install state source", async () => {
    const wrapper = mount(Marketplace, {
      global: {
        stubs: {
          ExtensionMigrationPanel: { template: "<div data-test=\"migration-panel\" />" },
          ExtensionDetails: { template: "<aside data-test=\"extension-details\" />" },
        },
      },
    })

    await flushPromises()

    expect(wrapper.attributes("data-extension-gallery-state-source")).toBe("service")
    expect(wrapper.attributes("data-extension-gallery-no-second-state")).toBe("true")
    expect(wrapper.attributes("data-extension-gallery-service-id")).toBe("extensionsWorkbenchService")
    expect(wrapper.attributes("data-extension-gallery-contribution-container-id")).toBe(EXTENSIONS_WORKBENCH_VIEW_IDS.Container)
    expect(wrapper.attributes("data-extension-gallery-contribution-view-ids")).toContain(EXTENSIONS_WORKBENCH_VIEW_IDS.Editor)
    expect(wrapper.attributes("data-extension-gallery-contribution-command-ids")).toContain(EXTENSIONS_WORKBENCH_COMMAND_IDS.Install)
    expect(wrapper.attributes("data-extension-gallery-view-action-menu-driven")).toBe("true")
    expect(wrapper.attributes("data-extension-gallery-manage-command-id")).toBe(EXTENSIONS_WORKBENCH_COMMAND_IDS.Manage)
    expect(extensionWorkbenchService.search).toHaveBeenCalledWith("ai", { pageSize: 30 })
    expect(getExtensionWorkbenchSurfaceSnapshot).toHaveBeenCalledWith(extensionWorkbenchService)
  })

  it("renders marketplace titles and descriptions through the Chinese visible-copy layer", async () => {
    const wrapper = mount(Marketplace, {
      global: {
        stubs: {
          ExtensionMigrationPanel: { template: "<div data-test=\"migration-panel\" />" },
          ExtensionDetails: { template: "<aside data-test=\"extension-details\" />" },
        },
      },
    })

    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain("扩展市场条目")
    expect(text).toContain("来自扩展市场的扩展条目")
    expect(text).not.toContain("Sample Extension")
    expect(text).not.toContain("Marketplace result from the shared service")
  })

  it("keeps uninstalled marketplace AI entries fully localized, including icon fallback", async () => {
    vi.mocked(extensionWorkbenchService.search).mockResolvedValue([{
      ...sampleExtension,
      id: "ai-studio.workbench",
      displayName: "AI工作台",
      description: "AI coding assistant",
      publisher: "ai-studio",
      iconDataUrl: "data:image/png;base64,external-ai-studio-icon",
      categories: ["AI"],
    }])

    const wrapper = mount(Marketplace, {
      global: {
        stubs: {
          ExtensionMigrationPanel: { template: "<div data-test=\"migration-panel\" />" },
          ExtensionDetails: { template: "<aside data-test=\"extension-details\" />" },
        },
      },
    })

    await flushPromises()

    expect(wrapper.text()).toContain("智能辅助扩展")
    expect(wrapper.text()).toContain("智能")
    expect(wrapper.text()).not.toContain("AI工作台")
    expect(wrapper.find(".extension-icon-img").exists()).toBe(false)
  })

  it("opens detail evidence before routing install actions through the same extensionsWorkbenchService facade", async () => {
    const wrapper = mount(Marketplace, {
      global: {
        stubs: {
          ExtensionMigrationPanel: { template: "<div data-test=\"migration-panel\" />" },
          ExtensionDetails: { template: "<aside data-test=\"extension-details\" />" },
        },
      },
    })

    await flushPromises()
    const installButton = wrapper.find(".extension-install-btn")
    expect(installButton.exists()).toBe(true)

    await installButton.trigger("click")
    await flushPromises()

    expect(extensionWorkbenchService.open).toHaveBeenCalledWith(sampleExtension.id, sampleExtension.version)
    expect(extensionWorkbenchService.install).toHaveBeenCalledWith(sampleExtension.id, sampleExtension.version, expect.objectContaining({
      onProgress: expect.any(Function),
    }))
    expect(vi.mocked(extensionWorkbenchService.open).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(extensionWorkbenchService.install).mock.invocationCallOrder[0],
    )
    expect(wrapper.find("[data-test='extension-details']").exists()).toBe(true)
  })

  it("opens migrated extension details before installing so confirmation evidence stays service-backed", async () => {
    vi.mocked(getMigratedExtensionQueue).mockResolvedValue({
      exists: true,
      path: "D:/Workspace/User/extensions.json",
      source: "vscode",
      importedAt: "2026-06-30T00:00:00.000Z",
      installPolicy: "user-confirmed",
      reason: "imported from VS Code",
      total: 1,
      pending: 1,
      installed: 0,
      failed: 0,
      extensions: [{ id: sampleExtension.id, status: "pending" }],
    })

    const wrapper = mount(Marketplace, {
      global: {
        stubs: {
          ExtensionMigrationPanel: {
            props: ["queue"],
            emits: ["install"],
            template: "<button data-test=\"migrated-install\" @click=\"$emit('install', queue.extensions[0])\">install migrated</button>",
          },
          ExtensionDetails: { template: "<aside data-test=\"extension-details\" />" },
        },
      },
    })

    await flushPromises()
    await wrapper.find("[data-test='migrated-install']").trigger("click")
    await flushPromises()

    expect(extensionWorkbenchService.open).toHaveBeenCalledWith(sampleExtension.id, sampleExtension.version)
    expect(extensionWorkbenchService.install).toHaveBeenCalledWith(sampleExtension.id, sampleExtension.version, expect.objectContaining({
      onProgress: expect.any(Function),
    }))
    expect(vi.mocked(extensionWorkbenchService.open).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(extensionWorkbenchService.install).mock.invocationCallOrder[0],
    )
  })

  it("opens smoke detail through extensionsWorkbenchService instead of seeding a fake editor model", async () => {
    const wrapper = mount(Marketplace, {
      global: {
        stubs: {
          ExtensionMigrationPanel: { template: "<div data-test=\"migration-panel\" />" },
          ExtensionDetails: { template: "<aside data-test=\"extension-details\" />" },
        },
      },
    })

    await flushPromises()

    const openForSmoke = (window as Window & {
      __codekSeedExtensionGalleryWorkbenchDetailForSmoke?: () => Promise<string>
    }).__codekSeedExtensionGalleryWorkbenchDetailForSmoke

    expect(openForSmoke).toBeTypeOf("function")
    await expect(openForSmoke?.()).resolves.toBe(sampleExtension.id)
    expect(extensionWorkbenchService.open).toHaveBeenCalledWith(sampleExtension.id)

    wrapper.unmount()
  })

  it("seeds a service-backed smoke detail when marketplace and installed lists are empty", async () => {
    vi.mocked(extensionWorkbenchService.search).mockResolvedValue([])
    vi.mocked(extensionWorkbenchService.showInstalled).mockResolvedValue([])
    vi.mocked(getExtensionWorkbenchSurfaceSnapshot).mockReturnValue({
      ...surfaceSnapshot(),
      lastSearchResultCount: 0,
      installedCount: 0,
      editorCount: 0,
      openedExtensionIds: [],
      latestEditorId: "",
    })
    const wrapper = mount(Marketplace, {
      global: {
        stubs: {
          ExtensionMigrationPanel: { template: "<div data-test=\"migration-panel\" />" },
          ExtensionDetails: { template: "<aside data-test=\"extension-details\" />" },
        },
      },
    })

    await flushPromises()
    const openForSmoke = (window as Window & {
      __codekSeedExtensionGalleryWorkbenchDetailForSmoke?: () => Promise<string>
    }).__codekSeedExtensionGalleryWorkbenchDetailForSmoke

    await expect(openForSmoke?.()).resolves.toBe("codek.smoke-extension-gallery")
    expect(extensionWorkbenchService.open).not.toHaveBeenCalled()
    expect(extensionWorkbenchService.setEditorViewModelForEvidence).toHaveBeenCalledWith(expect.objectContaining({
      id: "codek.smoke-extension-gallery",
      reportKind: "extension-details",
      installPlan: expect.objectContaining({
        readyToInstall: true,
        requiresConfirmation: true,
      }),
      compatibility: expect.objectContaining({
        status: "compatible",
      }),
    }))
    expect(wrapper.find("[data-test='extension-details']").exists()).toBe(true)

    wrapper.unmount()
  })
})
