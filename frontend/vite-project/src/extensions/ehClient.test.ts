import { beforeEach, describe, expect, it, vi } from "vitest"
import { api } from "../lib/api"
import {
  getExtensionDetails,
  getExtensionIconDataUrl,
  installExtension,
  installVsixFile,
  listInstalledExtensions,
  restartExtensionHosts,
  startExtensionHosts,
  stopExtensionHosts,
  type VsixMetadata,
} from "./ehClient"

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

function extension(overrides: Partial<VsixMetadata> = {}): VsixMetadata {
  return {
    id: "publisher.extension",
    displayName: "Extension",
    description: "",
    version: "1.0.0",
    publisher: "publisher",
    downloads: 0,
    categories: [],
    ...overrides,
  }
}

describe("extension host client icon resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("keeps the VS Code-style default icon visible but still fetches gallery or manifest icons", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ dataUrl: "data:image/png;base64,real" })

    const dataUrl = await getExtensionIconDataUrl(extension({
      iconUrl: "https://example.com/icon.png",
      iconCacheUrl: "/extensions-host/marketplace/icon/publisher.extension?url=https%3A%2F%2Fexample.com%2Ficon.png",
      iconDataUrl: "data:image/svg+xml;base64,default",
    }))

    expect(api.get).toHaveBeenCalledWith("/extensions-host/marketplace/icon/publisher.extension?url=https%3A%2F%2Fexample.com%2Ficon.png")
    expect(dataUrl).toBe("data:image/png;base64,real")
  })

  it("uses the provided default icon only when no gallery or manifest icon URL exists", async () => {
    const dataUrl = await getExtensionIconDataUrl(extension({
      iconDataUrl: "data:image/svg+xml;base64,default",
    }))

    expect(api.get).not.toHaveBeenCalled()
    expect(dataUrl).toBe("data:image/svg+xml;base64,default")
  })

  it("keeps installed manifest icon paths separate from marketplace icon URLs", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      extensions: [{
        id: "publisher.extension",
        name: "extension",
        publisher: "publisher",
        version: "1.0.0",
        icon: "media/icon.svg",
        iconCacheUrl: "/extensions-host/installed/publisher.extension/icon",
        iconDataUrl: "data:image/svg+xml;base64,default",
        capabilities: {
          untrustedWorkspaces: {
            supported: false,
            description: "Requires trusted workspace file access.",
            restrictedConfigurations: ["publisher.extension.workspaceRoot"],
          },
        },
      }],
    })

    const [installed] = await listInstalledExtensions()

    expect(installed.icon).toBe("media/icon.svg")
    expect(installed.iconUrl).toBeUndefined()
    expect(installed.iconCacheUrl).toBe("/extensions-host/installed/publisher.extension/icon")
    expect(installed.capabilities?.untrustedWorkspaces?.supported).toBe(false)
    expect(installed.capabilities?.untrustedWorkspaces?.restrictedConfigurations).toEqual(["publisher.extension.workspaceRoot"])
  })

  it("keeps marketplace or detail manifest capabilities for workbench trust recompute", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      extension: {
        id: "publisher.extension",
        namespace: "publisher",
        name: "extension",
        version: "1.0.0",
        productDisablement: {
          disabled: true,
          source: "productService.disableExtensions",
          detail: "Product policy disabled this extension.",
          runtimeReference: false,
        },
        configurationDisablement: {
          disabled: true,
          source: "configurationService",
          configKey: "extensions.allowed",
          runtimeReference: false,
        },
        enablement: {
          state: "DisabledByEnvironment",
          reason: "product",
        },
        capabilities: {
          untrustedWorkspaces: {
            supported: false,
            description: "Requires trusted workspace file access.",
            restrictedConfigurations: ["publisher.extension.workspaceRoot"],
          },
        },
      },
    })

    const details = await getExtensionDetails("publisher.extension")

    expect(details?.capabilities?.untrustedWorkspaces?.supported).toBe(false)
    expect(details?.capabilities?.untrustedWorkspaces?.description).toBe("Requires trusted workspace file access.")
    expect(details?.capabilities?.untrustedWorkspaces?.restrictedConfigurations).toEqual(["publisher.extension.workspaceRoot"])
    expect(details?.productDisablement).toMatchObject({
      disabled: true,
      source: "productService.disableExtensions",
      runtimeReference: false,
    })
    expect(details?.configurationDisablement).toMatchObject({
      disabled: true,
      configKey: "extensions.allowed",
      runtimeReference: false,
    })
    expect(details?.enablement).toMatchObject({
      state: "DisabledByEnvironment",
      reason: "product",
    })
  })

  it("does not auto-confirm extension installs unless the workbench service passes confirmation evidence", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true })

    await installExtension("publisher.extension", "1.0.0")

    expect(api.post).toHaveBeenCalledWith(
      "/extensions-host/marketplace/install",
      { extensionId: "publisher.extension", version: "1.0.0" },
    )
  })

  it("passes explicit install confirmation through to the extension host route", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true })

    await installExtension("publisher.extension", "1.0.0", { confirmed: true })

    expect(api.post).toHaveBeenCalledWith(
      "/extensions-host/marketplace/install",
      { extensionId: "publisher.extension", version: "1.0.0", confirmed: true },
    )
  })

  it("does not auto-confirm VSIX installs from the client boundary", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true })

    await installVsixFile("D:/Workspace/extensions/fixture.vsix")

    expect(api.post).toHaveBeenCalledWith(
      "/extensions-host/install-vsix",
      { filePath: "D:/Workspace/extensions/fixture.vsix" },
    )
  })

  it("routes Workspace Trust lifecycle stop/start through dedicated extension host lifecycle endpoints", async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ success: true, evidence: { action: "stopExtensionHosts", stopped: true } })
      .mockResolvedValueOnce({ success: true, evidence: { action: "startExtensionHosts", started: true } })

    await stopExtensionHosts("Changing workspace trust")
    await startExtensionHosts("Changing workspace trust")

    expect(api.post).toHaveBeenNthCalledWith(
      1,
      "/extensions-host/lifecycle/stop",
      { reason: "Changing workspace trust" },
    )
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/extensions-host/lifecycle/start",
      { reason: "Changing workspace trust" },
    )
  })

  it("routes local extension host restart through a dedicated stop-start endpoint without window reload", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      success: true,
      evidence: {
        serviceId: "extensionHostLifecycleService",
        stateSource: "desktop.extensionsHostService",
        vscodeContract: "IExtensionService.stopExtensionHosts+startExtensionHosts",
        action: "restartExtensionHosts",
        reason: "Changing workspace trust",
        requested: true,
        restartRequested: true,
        restarted: true,
        reloadRequested: false,
        reloaded: false,
        createdAt: 1710000000000,
      },
    })

    await restartExtensionHosts("Changing workspace trust", {
      rootDir: "D:/Workspace",
      workspaceRoots: ["D:/Workspace"],
      workspaceFile: "D:/Workspace/codek.code-workspace",
    })

    expect(api.post).toHaveBeenCalledWith(
      "/extensions-host/lifecycle/restart",
      {
        reason: "Changing workspace trust",
        rootDir: "D:/Workspace",
        workspaceRoots: ["D:/Workspace"],
        workspaceFile: "D:/Workspace/codek.code-workspace",
      },
    )
  })
})
