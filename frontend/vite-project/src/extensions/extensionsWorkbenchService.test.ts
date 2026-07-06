import { beforeEach, describe, expect, it, vi } from "vitest"
import { getSingletonServiceDescriptors } from "../vscode-adapter/platform/instantiation/common/extensions"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"
import { clearQuickAccessProviders, matchQuickAccessProvider } from "../vscode-adapter/platform/quickinput/common/quickAccess"
import { MenuId, MenuRegistry } from "../vscode-adapter/platform/actions/common/menuRegistry"
import { clearCommands, executeCommand, getCommand } from "../workbench/commandRegistry"
import { clearViews, getViewContainers, getViews } from "../workbench/viewRegistry"
import type { ExtensionDetailsPayload, ExtensionHostLifecycleOperationEvidence, VsixMetadata } from "./ehClient"
import {
  EXTENSIONS_WORKBENCH_COMMAND_IDS,
  EXTENSIONS_WORKBENCH_VIEW_IDS,
  CODEK_EXTENSION_ENABLEMENT_SOURCE_PATHS,
  CODEK_WORKSPACE_TRUST_REMOTE_RELOAD_AUDIT_SOURCE_PATHS,
  EXTENSION_WORKBENCH_ENABLEMENT_STATE_MATRIX,
  ExtensionWorkbenchService,
  IExtensionsWorkbenchService,
  VS_CODE_EXTENSION_ENABLEMENT_STATE_CONTRACT,
  VS_CODE_EXTENSION_HOST_RESTART_SOURCE_PATHS,
  VS_CODE_EXTENSION_TRUST_SOURCE_PATHS,
  getExtensionWorkbenchEvidenceSummary,
  getExtensionWorkbenchDetailSummary,
  getExtensionWorkbenchSurfaceSnapshot,
  disposeExtensionWorkbenchContributions,
  extensionWorkbenchService,
  registerExtensionWorkbenchContributions,
} from "./extensionsWorkbenchService"
import {
  disableExtension,
  enableExtension,
  getFullExtensionDetails,
  installExtension,
  listInstalledExtensions,
  rollbackExtension,
  searchExtensions,
  streamInstallProgress,
  uninstallExtension,
} from "./ehClient"

vi.mock("./ehClient", () => ({
  getFullExtensionDetails: vi.fn(),
  installExtension: vi.fn(),
  listInstalledExtensions: vi.fn(),
  rollbackExtension: vi.fn(),
  searchExtensions: vi.fn(),
  streamInstallProgress: vi.fn(),
  uninstallExtension: vi.fn(),
  enableExtension: vi.fn(),
  disableExtension: vi.fn(),
}))

const sampleExtension: VsixMetadata = {
  id: "sample.publisher-extension",
  displayName: "Sample Extension",
  description: "Adds focused evidence views",
  version: "1.2.3",
  publisher: "sample",
  downloads: 42,
  iconDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
  iconSource: "default",
  defaultIcon: true,
  categories: ["Other"],
}

function samplePayload(overrides: Partial<ExtensionDetailsPayload> = {}): ExtensionDetailsPayload {
  return {
    reportKind: "extension-details",
    createdAt: 1710000000000,
    ready: true,
    id: sampleExtension.id,
    extension: {
      ...sampleExtension,
      source: "open-vsx",
      sourceUrl: "https://open-vsx.org/extension/sample/publisher-extension",
      license: "MIT",
      engines: { vscode: "^1.90.0" },
      extensionDependencies: ["sample.dependency"],
      extensionPack: [],
      contributes: {
        commands: [{ command: "sample.run", title: "运行示例" }],
        configuration: { properties: { "sample.enabled": { type: "boolean" } } },
        views: { explorer: [{ id: "sample.tree", name: "示例视图" }] },
      },
      iconDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
      iconSource: "default",
      defaultIcon: true,
    },
    installed: null,
    readme: {
      id: sampleExtension.id,
      available: true,
      length: 48,
      text: "# Sample Extension\n\n**Evidence** and rollback notes.",
    },
    versions: [{ version: "1.2.3", targetPlatforms: ["win32-x64"] }],
    latestVersion: "1.2.3",
    installPlan: {
      reportKind: "extension-install-plan",
      id: sampleExtension.id,
      readyToInstall: true,
      requiresConfirmation: true,
      dependencies: ["sample.dependency"],
      extensionPack: [],
      missingDependencies: ["sample.dependency"],
      missingExtensionPack: [],
      operations: [{ kind: "dependency", id: "sample.dependency", status: "pending" }],
      warnings: [{ id: "target-platform", severity: "info", message: "win32-x64 compatible" }],
    },
    compatibility: {
      available: true,
      status: "compatible",
      blockers: [],
      warnings: [{ id: "api", message: "部分 API 走 Codek shim" }],
      unsupportedContributionPoints: [],
      partialContributionPoints: ["views"],
    },
    installState: null,
    audit: [{ extensionId: sampleExtension.id, action: "install-plan", status: "ready", createdAt: 1710000000000 }],
    ...overrides,
  }
}

describe("extensions workbench service", () => {
  beforeEach(() => {
    disposeExtensionWorkbenchContributions()
    extensionWorkbenchService.clearState()
    clearCommands()
    clearViews()
    clearQuickAccessProviders()
    MenuRegistry.clear()
    vi.clearAllMocks()
    vi.mocked(streamInstallProgress).mockReturnValue(() => {})
    vi.mocked(searchExtensions).mockResolvedValue([sampleExtension])
    vi.mocked(getFullExtensionDetails).mockResolvedValue(samplePayload())
    vi.mocked(listInstalledExtensions).mockResolvedValue([])
    vi.mocked(installExtension).mockResolvedValue({ success: true })
    vi.mocked(uninstallExtension).mockResolvedValue({ success: true })
    vi.mocked(rollbackExtension).mockResolvedValue({ success: true })
    vi.mocked(enableExtension).mockResolvedValue()
    vi.mocked(disableExtension).mockResolvedValue()
  })

  it("registers a VS Code-style service identifier and resolves through ServiceCollection", () => {
    const collection = new ServiceCollection([IExtensionsWorkbenchService, extensionWorkbenchService])
    const singleton = getSingletonServiceDescriptors().find(([id]) => id === IExtensionsWorkbenchService)

    expect(String(IExtensionsWorkbenchService)).toBe("extensionsWorkbenchService")
    expect(collection.get(IExtensionsWorkbenchService)).toBe(extensionWorkbenchService)
    expect(singleton?.[1]).toBe(extensionWorkbenchService)
  })

  it("builds an extension editor view model with install plan, compatibility and evidence state", () => {
    const service = new ExtensionWorkbenchService()
    const model = service.buildEditorViewModel(samplePayload())

    expect(model).toMatchObject({
      id: sampleExtension.id,
      title: "Sample Extension",
      installState: "installable",
      statusLabel: "可安装",
      compatibilitySummary: "兼容；1 个警告；1 个部分支持贡献点",
    })
    expect(model.detailSummary).toMatchObject({
      source: "extensionsWorkbenchService",
      serviceId: "extensionsWorkbenchService",
      extensionId: sampleExtension.id,
      installState: "installable",
      installPlanReady: true,
      requiresConfirmation: true,
      trustGate: {
        required: true,
      },
      availability: {
        label: "可安装",
      },
      usabilityRows: expect.arrayContaining([
        expect.objectContaining({ id: "commands", label: "命令", statusLabel: "待安装后验证" }),
        expect.objectContaining({ id: "configuration", label: "配置", statusLabel: "待安装后验证" }),
        expect.objectContaining({ id: "views", label: "Tree/View 视图", statusLabel: "待安装后验证" }),
      ]),
      noSecondInstallState: true,
      localFirst: true,
      goesThroughEhClient: true,
    })
    expect(model.readmeSummary).toContain("Sample Extension")
    expect(model.installPlanSummary).toContain("待安装依赖 1 个")
    expect(model.metadata).toContainEqual({ label: "发布者", value: "sample" })
    expect(model.actions).toContainEqual(expect.objectContaining({ id: "install", enabled: true }))
    expect(model.detailSummary.actionCommands).toContainEqual(expect.objectContaining({
      actionId: "install",
      commandId: EXTENSIONS_WORKBENCH_COMMAND_IDS.Install,
      owner: "extensionsWorkbenchService",
      vscodeOwner: "extensionsActions",
      noSecondInstallState: true,
    }))
    expect(model.detailSummary.manageActionOwner).toMatchObject({
      actionId: "manage",
      commandId: EXTENSIONS_WORKBENCH_COMMAND_IDS.Manage,
      owner: "extensionsWorkbenchService",
    })
    expect(model.detailSummary.usabilityRows).toContainEqual(expect.objectContaining({
      id: "storage",
      label: "扩展存储",
      statusLabel: "待安装后验证",
    }))
    expect(model.evidence.audit[0]).toMatchObject({ action: "install-plan", status: "ready" })
  })

  it("projects installed extension availability states from the VS Code-style status chain", () => {
    const service = new ExtensionWorkbenchService()
    const activated = service.buildEditorViewModel(samplePayload({
      installed: {
        id: sampleExtension.id,
        version: "1.2.3",
        enabled: true,
        installPath: "D:\\Workspace\\extensions\\sample.publisher-extension",
        builtin: false,
        availability: {
          status: "activated",
          label: "已激活",
          detail: "扩展宿主已加载并激活该扩展。",
          reason: "extension-host",
        },
      },
    }))
    const disabled = service.buildEditorViewModel(samplePayload({
      installed: {
        id: sampleExtension.id,
        version: "1.2.3",
        enabled: false,
        installPath: "D:\\Workspace\\extensions\\sample.publisher-extension",
        builtin: false,
        availability: {
          status: "disabled",
          label: "已禁用",
          detail: "扩展已安装但当前被禁用。",
          reason: "disabled",
        },
      },
    }))
    const unsupported = service.buildEditorViewModel(samplePayload({
      installed: {
        id: sampleExtension.id,
        version: "1.2.3",
        enabled: true,
        installPath: "D:\\Workspace\\extensions\\sample.publisher-extension",
        builtin: false,
        availability: {
          status: "unsupported",
          label: "不支持",
          detail: "该扩展使用 Codek 当前不支持的 VS Code 能力。",
          reason: "compatibility",
        },
      },
    }))

    expect(activated).toMatchObject({ installState: "activated", statusLabel: "已激活" })
    expect(disabled).toMatchObject({ installState: "disabled", statusLabel: "已禁用" })
    expect(disabled.actions).toContainEqual(expect.objectContaining({ id: "enable", enabled: true }))
    expect(disabled.detailSummary.manageSecondaryActions.map((action) => action.actionId)).toEqual(["enable", "uninstall"])
    expect(disabled.detailSummary.manageSecondaryActions).toContainEqual(expect.objectContaining({
      actionId: "enable",
      commandId: EXTENSIONS_WORKBENCH_COMMAND_IDS.Enable,
      owner: "extensionsWorkbenchService",
      route: "workbench.commandRegistry",
    }))
    expect(unsupported).toMatchObject({ installState: "unsupported", statusLabel: "不支持" })
    expect(unsupported.statusDetail).toContain("不支持")
  })

  it("maps update availability to the real install command and exposes manage secondary action owners", () => {
    const service = new ExtensionWorkbenchService()
    const model = service.buildEditorViewModel(samplePayload({
      latestVersion: "1.2.4",
      installed: {
        id: sampleExtension.id,
        version: "1.2.3",
        enabled: true,
        installPath: "D:\\Workspace\\extensions\\sample.publisher-extension",
        builtin: false,
        availability: {
          status: "installed",
          label: "已安装",
          detail: "扩展已安装。",
          reason: "extension-host",
        },
      },
    }))

    expect(model.installState).toBe("updateAvailable")
    expect(model.actions).toContainEqual(expect.objectContaining({ id: "update", label: "更新" }))
    expect(model.detailSummary.actionCommands).toContainEqual(expect.objectContaining({
      actionId: "update",
      commandId: EXTENSIONS_WORKBENCH_COMMAND_IDS.Install,
      owner: "extensionsWorkbenchService",
      vscodeOwner: "extensionsActions",
    }))
    expect(model.detailSummary.manageSecondaryActions.map((action) => action.commandId)).toEqual([
      EXTENSIONS_WORKBENCH_COMMAND_IDS.Install,
      EXTENSIONS_WORKBENCH_COMMAND_IDS.Disable,
      EXTENSIONS_WORKBENCH_COMMAND_IDS.Uninstall,
    ])
  })

  it("recomputes VS Code-style DisabledByTrustRequirement from real manifest untrusted workspace capability", () => {
    const service = new ExtensionWorkbenchService()
    service.setEditorViewModelForEvidence(samplePayload({
      extension: {
        ...samplePayload().extension,
        capabilities: {
          untrustedWorkspaces: {
            supported: false,
            description: "Needs trusted file-system access.",
          },
        },
      },
      installPlan: {
        ...samplePayload().installPlan,
        requiresConfirmation: false,
      },
      installed: {
        id: sampleExtension.id,
        version: "1.2.3",
        enabled: true,
        installPath: "D:/Workspace/extensions/sample.publisher-extension",
        builtin: false,
      },
    }))

    const restricted = service.recomputeEnablementForWorkspaceTrust(false)

    expect(restricted).toMatchObject({
      source: "extensionsWorkbenchService",
      serviceId: "extensionsWorkbenchService",
      stateSource: "extensionsWorkbenchService+workspaceTrust",
      vscodeServiceId: "extensionEnablementService",
      vscodeSourcePaths: VS_CODE_EXTENSION_TRUST_SOURCE_PATHS,
      vscodeComputeSource: "IWorkspaceTrustManagementService.isWorkspaceTrusted+_computeEnablementState",
      trigger: "workspaceTrustTransition",
      workspaceTrusted: false,
      recomputedCount: 1,
      disabledByTrustRequirementCount: 1,
      enablementMatrix: EXTENSION_WORKBENCH_ENABLEMENT_STATE_MATRIX,
      lifecycle: {
        source: "extensionsWorkbenchService",
        localContract: "IExtensionService.stopExtensionHosts+startExtensionHosts",
        status: "partial",
        blockedBy: "workspaceTrustTransitionOwner",
        stopStartRoutesAvailable: true,
        restartCompletedHere: false,
      },
      hostLifecycleBinding: {
        status: "blocked",
        trigger: "workspaceTrustTransition",
        workspaceTrusted: false,
        disabledByTrustRequirementCount: 1,
        lifecyclePhase: "notRequired",
        lifecycleStatus: "partial",
        stopStartBoundToTrustTransition: false,
        stopEvidenceBound: false,
        startEvidenceBound: false,
        stopStateSource: "none",
        startStateSource: "none",
        noSecondEnablementState: true,
        runtimeReference: false,
      },
      states: [{
        extensionId: sampleExtension.id,
        state: "DisabledByTrustRequirement",
        disabledByTrustRequirement: true,
        requiresWorkspaceTrust: true,
        trustRequirementSource: "manifest.capabilities.untrustedWorkspaces.supported",
        untrustedWorkspaceSupport: false,
        reason: "workspaceTrust",
      }],
    })
    expect(service.getEnablementProjection(sampleExtension.id)).toMatchObject({
      state: "DisabledByTrustRequirement",
      disabledByTrustRequirement: true,
      reasonDetail: "manifest capabilities.untrustedWorkspaces.supported=false requires a trusted workspace",
      workspaceLocationEvidence: {
        source: "contextService.isInsideWorkspace(extension.location)",
        status: "blocked",
        isInsideWorkspace: null,
        installPath: "D:/Workspace/extensions/sample.publisher-extension",
        workspaceRoots: [],
        runtimeReference: false,
        blockedReason: expect.stringContaining("workspace roots"),
      },
    })

    const trusted = service.recomputeEnablementForWorkspaceTrust(true)

    expect(trusted).toMatchObject({
      vscodeComputeSource: "IWorkspaceTrustManagementService.isWorkspaceTrusted+_computeEnablementState",
      trigger: "workspaceTrustTransition",
      workspaceTrusted: true,
      disabledByTrustRequirementCount: 0,
      hostLifecycleBinding: {
        status: "notRequired",
        workspaceTrusted: true,
        disabledByTrustRequirementCount: 0,
        stopStartBoundToTrustTransition: false,
      },
      states: [{
        extensionId: sampleExtension.id,
        state: "EnabledWorkspace",
        disabledByTrustRequirement: false,
        requiresWorkspaceTrust: true,
        reason: "workspaceUser",
      }],
    })
    expect(service.getSurfaceSnapshot()).toMatchObject({
      enablementRecomputedCount: 1,
      disabledByTrustRequirementCount: 0,
      latestEnablementRecompute: {
        workspaceTrusted: true,
      },
    })
  })

  it("does not treat manifest untrusted workspace support true or limited as DisabledByTrustRequirement", () => {
    const service = new ExtensionWorkbenchService()
    service.setEditorViewModelForEvidence(samplePayload({
      id: "sample.supported",
      extension: {
        ...samplePayload().extension,
        id: "sample.supported",
        capabilities: {
          untrustedWorkspaces: { supported: true },
        },
      },
      installPlan: {
        ...samplePayload().installPlan,
        requiresConfirmation: true,
      },
      installed: {
        id: "sample.supported",
        version: "1.2.3",
        enabled: true,
        installPath: "D:/Workspace/extensions/sample.supported",
        builtin: false,
      },
    }))
    service.setEditorViewModelForEvidence(samplePayload({
      id: "sample.limited",
      extension: {
        ...samplePayload().extension,
        id: "sample.limited",
        capabilities: {
          untrustedWorkspaces: { supported: "limited" },
        },
      },
      installPlan: {
        ...samplePayload().installPlan,
        requiresConfirmation: true,
      },
      installed: {
        id: "sample.limited",
        version: "1.2.3",
        enabled: true,
        installPath: "D:/Workspace/extensions/sample.limited",
        builtin: false,
      },
    }))

    const restricted = service.recomputeEnablementForWorkspaceTrust(false)

    expect(restricted.disabledByTrustRequirementCount).toBe(0)
    expect(restricted.states).toEqual(expect.arrayContaining([
      expect.objectContaining({
        extensionId: "sample.supported",
        state: "EnabledWorkspace",
        requiresWorkspaceTrust: false,
        trustRequirementSource: "manifest.capabilities.untrustedWorkspaces.supported",
        untrustedWorkspaceSupport: true,
      }),
      expect.objectContaining({
        extensionId: "sample.limited",
        state: "EnabledWorkspace",
        requiresWorkspaceTrust: false,
        trustRequirementSource: "manifest.capabilities.untrustedWorkspaces.supported",
        untrustedWorkspaceSupport: "limited",
      }),
    ]))
  })

  it("propagates workspace-trust disabled dependencies as VS Code-style DisabledByExtensionDependency", () => {
    const service = new ExtensionWorkbenchService()
    service.setEditorViewModelForEvidence(samplePayload({
      id: "sample.trust-required-dependency",
      extension: {
        ...samplePayload().extension,
        id: "sample.trust-required-dependency",
        extensionDependencies: [],
        capabilities: {
          untrustedWorkspaces: { supported: false },
        },
      },
      installPlan: {
        ...samplePayload().installPlan,
        requiresConfirmation: false,
      },
      installed: {
        id: "sample.trust-required-dependency",
        version: "1.2.3",
        enabled: true,
        installPath: "D:/Workspace/extensions/sample.trust-required-dependency",
        builtin: false,
      },
    }))
    service.setEditorViewModelForEvidence(samplePayload({
      id: "sample.depender",
      extension: {
        ...samplePayload().extension,
        id: "sample.depender",
        extensionDependencies: ["sample.trust-required-dependency"],
        capabilities: {
          untrustedWorkspaces: { supported: true },
        },
      },
      installPlan: {
        ...samplePayload().installPlan,
        requiresConfirmation: false,
        dependencies: ["sample.trust-required-dependency"],
        missingDependencies: [],
        operations: [],
      },
      installed: {
        id: "sample.depender",
        version: "1.2.3",
        enabled: true,
        installPath: "D:/Workspace/extensions/sample.depender",
        builtin: false,
      },
    }))

    const restricted = service.recomputeEnablementForWorkspaceTrust(false)

    expect(restricted.disabledByTrustRequirementCount).toBe(1)
    expect(restricted.states).toEqual(expect.arrayContaining([
      expect.objectContaining({
        extensionId: "sample.trust-required-dependency",
        state: "DisabledByTrustRequirement",
        reason: "workspaceTrust",
        dependencyEvidence: expect.objectContaining({
          source: "extensionDependencies",
          status: "notRequired",
          dependencyIds: [],
          disabledDependencyIds: [],
        }),
      }),
      expect.objectContaining({
        extensionId: "sample.depender",
        state: "DisabledByExtensionDependency",
        disabledByTrustRequirement: false,
        requiresWorkspaceTrust: false,
        reason: "extensionDependency",
        stateSource: "extensionsWorkbenchService+workspaceTrust",
        evidence: expect.objectContaining({
          source: "extensionDependencies",
          status: "available",
          reason: "extensionDependency",
          runtimeReference: false,
        }),
        dependencyEvidence: expect.objectContaining({
          source: "extensionDependencies",
          status: "available",
          dependencyIds: ["sample.trust-required-dependency"],
          disabledDependencyIds: ["sample.trust-required-dependency"],
          disabledDependencyStates: [{
            extensionId: "sample.trust-required-dependency",
            state: "DisabledByTrustRequirement",
            reason: "workspaceTrust",
          }],
          runtimeReference: false,
          vscodeSourcePaths: VS_CODE_EXTENSION_TRUST_SOURCE_PATHS,
          currentSourcePaths: CODEK_EXTENSION_ENABLEMENT_SOURCE_PATHS,
        }),
      }),
    ]))

    const trusted = service.recomputeEnablementForWorkspaceTrust(true)

    expect(trusted.disabledByTrustRequirementCount).toBe(0)
    expect(trusted.states.find((state) => state.extensionId === "sample.depender")).toMatchObject({
      state: "EnabledWorkspace",
      reason: "workspaceUser",
      dependencyEvidence: {
        dependencyIds: ["sample.trust-required-dependency"],
        disabledDependencyIds: [],
      },
    })
  })

  it("does not propagate DisabledByExtensionKind dependencies as dependency disablement", () => {
    const service = new ExtensionWorkbenchService()
    service.setEditorViewModelForEvidence(samplePayload({
      id: "sample.kind-disabled-dependency",
      extension: {
        ...samplePayload().extension,
        id: "sample.kind-disabled-dependency",
        extensionDependencies: [],
        enablement: {
          state: "DisabledByExtensionKind",
          source: "extensionEnablementService",
          reason: "extensionKind",
          detail: "Extension kind cannot run on this host.",
        },
      },
      installed: {
        id: "sample.kind-disabled-dependency",
        version: "1.2.3",
        enabled: true,
        installPath: "D:/Workspace/extensions/sample.kind-disabled-dependency",
        builtin: false,
      },
    }))
    service.setEditorViewModelForEvidence(samplePayload({
      id: "sample.kind-depender",
      extension: {
        ...samplePayload().extension,
        id: "sample.kind-depender",
        extensionDependencies: ["sample.kind-disabled-dependency"],
        capabilities: {
          untrustedWorkspaces: { supported: true },
        },
      },
      installed: {
        id: "sample.kind-depender",
        version: "1.2.3",
        enabled: true,
        installPath: "D:/Workspace/extensions/sample.kind-depender",
        builtin: false,
      },
    }))

    const restricted = service.recomputeEnablementForWorkspaceTrust(false)

    expect(restricted.states.find((state) => state.extensionId === "sample.kind-disabled-dependency")).toMatchObject({
      state: "DisabledByExtensionKind",
      reason: "extensionKind",
    })
    expect(restricted.states.find((state) => state.extensionId === "sample.kind-depender")).toMatchObject({
      state: "EnabledWorkspace",
      reason: "workspaceUser",
      dependencyEvidence: {
        dependencyIds: ["sample.kind-disabled-dependency"],
        disabledDependencyIds: [],
        reason: "workspaceUser",
      },
    })
  })

  it("prioritizes product disablement evidence over manifest trust recompute", () => {
    const service = new ExtensionWorkbenchService()
    service.setEditorViewModelForEvidence(samplePayload({
      extension: {
        ...samplePayload().extension,
        productDisablement: {
          disabled: true,
          source: "productService.disableExtensions",
          reason: "product-disableExtensions",
          detail: "Product policy disabled this extension.",
          scope: "environment",
          runtimeReference: false,
        },
        capabilities: {
          untrustedWorkspaces: { supported: false },
        },
      },
      installed: {
        id: sampleExtension.id,
        version: "1.2.3",
        enabled: true,
        installPath: "D:/Workspace/extensions/sample.publisher-extension",
        builtin: false,
      },
    }))

    const restricted = service.recomputeEnablementForWorkspaceTrust(false)

    expect(restricted.disabledByTrustRequirementCount).toBe(0)
    expect(restricted.states[0]).toMatchObject({
      extensionId: sampleExtension.id,
      state: "DisabledByEnvironment",
      reason: "product",
      reasonDetail: "Product policy disabled this extension.",
      stateSource: "extensionsWorkbenchService+ehClient",
      evidence: {
        source: "productService.disableExtensions",
        status: "available",
        runtimeReference: false,
        vscodeSourcePaths: VS_CODE_EXTENSION_TRUST_SOURCE_PATHS,
        currentSourcePaths: CODEK_EXTENSION_ENABLEMENT_SOURCE_PATHS,
        scope: "environment",
      },
    })
  })

  it("distinguishes configuration allowlist and disabledExtensions evidence sources", () => {
    const service = new ExtensionWorkbenchService()
    service.setEditorViewModelForEvidence(samplePayload({
      id: "sample.allowlist",
      extension: {
        ...samplePayload().extension,
        id: "sample.allowlist",
        configurationDisablement: {
          disabled: true,
          source: "configurationService",
          configKey: "extensions.allowed",
          detail: "extensions.allowed blocks this extension.",
          runtimeReference: false,
        },
      },
      installed: {
        id: "sample.allowlist",
        version: "1.2.3",
        enabled: true,
        installPath: "D:/Workspace/extensions/sample.allowlist",
        builtin: false,
      },
    }))
    service.setEditorViewModelForEvidence(samplePayload({
      id: "sample.global-disabled",
      extension: {
        ...samplePayload().extension,
        id: "sample.global-disabled",
        enablement: {
          configurationDisablement: {
            disabled: true,
            source: "globalExtensionEnablementService.disabledExtensions",
            detail: "disabledExtensions storage contains this extension.",
            scope: "profile",
            runtimeReference: false,
          },
        },
      },
      installed: {
        id: "sample.global-disabled",
        version: "1.2.3",
        enabled: true,
        installPath: "D:/Workspace/extensions/sample.global-disabled",
        builtin: false,
      },
    }))

    const recompute = service.recomputeEnablementForWorkspaceTrust(true)

    expect(recompute.states).toEqual(expect.arrayContaining([
      expect.objectContaining({
        extensionId: "sample.allowlist",
        state: "DisabledByAllowlist",
        reason: "configuration",
        evidence: expect.objectContaining({
          source: "configurationService.extensions.allowed",
          configKey: "extensions.allowed",
          runtimeReference: false,
        }),
      }),
      expect.objectContaining({
        extensionId: "sample.global-disabled",
        state: "DisabledGlobally",
        reason: "globalUser",
        evidence: expect.objectContaining({
          source: "globalExtensionEnablementService.disabledExtensions",
          scope: "profile",
          runtimeReference: false,
        }),
      }),
    ]))
  })

  it("marks product and configuration override parity blocked when payload has no real source fields", () => {
    const service = new ExtensionWorkbenchService()
    service.setEditorViewModelForEvidence(samplePayload({
      installPlan: {
        ...samplePayload().installPlan,
        requiresConfirmation: false,
      },
      installed: {
        id: sampleExtension.id,
        version: "1.2.3",
        enabled: true,
        installPath: "D:/Workspace/extensions/sample.publisher-extension",
        builtin: false,
      },
    }))

    const recompute = service.recomputeEnablementForWorkspaceTrust(true)

    expect(recompute.states[0]).toMatchObject({
      state: "EnabledWorkspace",
      reason: "workspaceUser",
      evidence: {
        source: "missingProductConfigurationOverride",
        status: "blocked",
        runtimeReference: false,
        blockedReason: expect.stringContaining("Desktop extension host does not yet expose productService.disableExtensions"),
      },
      workspaceLocationEvidence: {
        status: "blocked",
        blockedReason: expect.stringContaining("workspace roots"),
      },
    })
  })

  it("publishes the VS Code enablement matrix without claiming host restart completion", () => {
    const service = new ExtensionWorkbenchService()

    expect(service.getEnablementStateMatrix().map((entry) => entry.state)).toEqual([...VS_CODE_EXTENSION_ENABLEMENT_STATE_CONTRACT])
    expect(VS_CODE_EXTENSION_ENABLEMENT_STATE_CONTRACT).toContain("DisabledByTrustRequirement")
    expect(VS_CODE_EXTENSION_ENABLEMENT_STATE_CONTRACT).not.toContain("DisabledByWorkspaceTrust")
    expect(service.getEnablementStateMatrix().find((entry) => entry.state === "DisabledByTrustRequirement")).toMatchObject({
      vscodeOrdinal: 0,
      enabled: false,
      mutableByUser: false,
      requiresWorkspaceTrustTransition: true,
      reason: "workspaceTrust",
    })
    expect(service.getEnablementStateMatrix().map((entry) => entry.vscodeOrdinal)).toEqual(
      VS_CODE_EXTENSION_ENABLEMENT_STATE_CONTRACT.map((_, index) => index),
    )
    expect(service.getEnablementStateMatrix().at(-1)).toMatchObject({
      state: "EnabledWorkspace",
      vscodeOrdinal: 13,
    })
    expect(service.getEnablementStateMatrix().filter((entry) => entry.enabled).map((entry) => entry.state)).toEqual([
      "EnabledByEnvironment",
      "EnabledGlobally",
      "EnabledWorkspace",
    ])
    expect(service.getExtensionHostLifecycleContract()).toMatchObject({
      vscodeServiceId: "extensionService",
      stateSource: "extensionsWorkbenchService+ehClient",
      restartOwner: "desktopExtensionHostProcessOwner",
      restartContract: "workbench.action.restartExtensionHost->IExtensionService.stopExtensionHosts+startExtensionHosts",
      reloadOwner: "workbenchWindowReloadService",
      status: "partial",
      blockedBy: "workspaceTrustTransitionOwner",
      phase: "notRequired",
      stopStartRoutesAvailable: true,
      restartRequiresWorkspaceTrustTransition: true,
      restartCompletedHere: false,
      latestStopEvidence: null,
      latestStartEvidence: null,
      hostWorkspaceEvidence: {
        source: "desktop.extensionsHostService.lifecycleEvidence",
        status: "blocked",
        workspaceRoots: [],
        workspaceFile: null,
        runtimeReference: false,
        blockedReason: expect.stringContaining("extension-host lifecycle evidence"),
      },
    })
  })

  it("carries real extension host stop-start evidence into connected service-level restart lifecycle", () => {
    const service = new ExtensionWorkbenchService()
    service.setEditorViewModelForEvidence(samplePayload({
      installed: {
        id: sampleExtension.id,
        version: "1.2.3",
        enabled: true,
        installPath: "D:/Workspace/extensions/sample.publisher-extension",
        builtin: false,
      },
    }))
    service.recomputeEnablementForWorkspaceTrust(false)
    const stopEvidence: ExtensionHostLifecycleOperationEvidence = {
      serviceId: "extensionHostLifecycleService",
      stateSource: "desktop.extensionsHostService",
      vscodeContract: "IExtensionService.stopExtensionHosts",
      action: "stopExtensionHosts",
      reason: "Changing workspace trust",
      requested: true,
      stopped: true,
      wasRunning: true,
      vetoed: false,
      vetoReason: "",
      createdAt: 1710000000100,
    }
    const startEvidence: ExtensionHostLifecycleOperationEvidence = {
      serviceId: "extensionHostLifecycleService",
      stateSource: "desktop.extensionsHostService",
      vscodeContract: "IExtensionService.startExtensionHosts",
      action: "startExtensionHosts",
      reason: "Changing workspace trust",
      requested: true,
      started: true,
      alreadyRunning: false,
      workspaceRoots: ["D:/Workspace"],
      workspaceFile: "D:/Workspace/codek.code-workspace",
      createdAt: 1710000000200,
    }

    const lifecycle = service.recordExtensionHostLifecycleEvidence({ stopEvidence, startEvidence })

    expect(lifecycle).toMatchObject({
      status: "available",
      phase: "completed",
      restartOwner: "desktopExtensionHostProcessOwner",
      restartContract: "workbench.action.restartExtensionHost->IExtensionService.stopExtensionHosts+startExtensionHosts",
      reloadOwner: "workbenchWindowReloadService",
      blockedBy: "none",
      restartRequiresWorkspaceTrustTransition: false,
      restartCompletedHere: true,
      latestStopEvidence: stopEvidence,
      latestStartEvidence: startEvidence,
      hostWorkspaceEvidence: {
        source: "desktop.extensionsHostService.lifecycleEvidence",
        status: "available",
        workspaceRoots: ["D:/Workspace"],
        workspaceFile: "D:/Workspace/codek.code-workspace",
        reason: expect.stringContaining("desktop extension-host lifecycle evidence"),
      },
    })
    expect(service.getEnablementProjection(sampleExtension.id)?.workspaceLocationEvidence).toMatchObject({
      source: "contextService.isInsideWorkspace(extension.location)",
      status: "available",
      isInsideWorkspace: true,
      installPath: "D:/Workspace/extensions/sample.publisher-extension",
      workspaceRoots: ["D:/Workspace"],
      runtimeReference: false,
    })
    expect(service.getEnablementProjection(sampleExtension.id)?.workspaceLocationEvidence.blockedReason).toBeUndefined()
    expect(service.getSurfaceSnapshot()).toMatchObject({
      latestEnablementRecompute: {
        lifecycle: {
          status: "available",
          blockedBy: "none",
          restartRequiresWorkspaceTrustTransition: false,
          restartCompletedHere: true,
          latestStopEvidence: stopEvidence,
          latestStartEvidence: startEvidence,
        },
        hostLifecycleBinding: {
          status: "bound",
          reason: expect.stringContaining("same transition"),
          stopStartBoundToTrustTransition: true,
          stopEvidenceBound: true,
          startEvidenceBound: true,
          stopReason: "Changing workspace trust",
          startReason: "Changing workspace trust",
          stopStateSource: "desktop.extensionsHostService",
          startStateSource: "desktop.extensionsHostService",
          noSecondEnablementState: true,
          runtimeReference: false,
        },
        states: [{
          workspaceLocationEvidence: {
            status: "available",
            isInsideWorkspace: true,
            workspaceRoots: ["D:/Workspace"],
          },
        }],
      },
    })
  })

  it("uses lifecycle workspace roots to mirror VS Code contextService.isInsideWorkspace during trust recompute", () => {
    const service = new ExtensionWorkbenchService()
    service.setEditorViewModelForEvidence(samplePayload({
      installed: {
        id: sampleExtension.id,
        version: "1.2.3",
        enabled: true,
        installPath: "D:/Workspace/extensions/sample.publisher-extension",
        builtin: false,
      },
    }))
    service.recordExtensionHostLifecycleEvidence({
      startEvidence: {
        serviceId: "extensionHostLifecycleService",
        stateSource: "desktop.extensionsHostService",
        vscodeContract: "IExtensionService.startExtensionHosts",
        action: "startExtensionHosts",
        reason: "Changing workspace trust",
        requested: true,
        started: true,
        alreadyRunning: false,
        workspaceRoots: ["D:/Workspace"],
        workspaceFile: null,
        createdAt: 1710000000200,
      },
    })

    const restricted = service.recomputeEnablementForWorkspaceTrust(false)

    expect(restricted.states[0]).toMatchObject({
      state: "DisabledByTrustRequirement",
      workspaceLocationEvidence: {
        source: "contextService.isInsideWorkspace(extension.location)",
        status: "available",
        isInsideWorkspace: true,
        installPath: "D:/Workspace/extensions/sample.publisher-extension",
        workspaceRoots: ["D:/Workspace"],
        reason: expect.stringContaining("contextService.isInsideWorkspace"),
        runtimeReference: false,
      },
    })
    expect(restricted.states[0].workspaceLocationEvidence.blockedReason).toBeUndefined()

    service.setEditorViewModelForEvidence(samplePayload({
      id: "sample.external-extension",
      extension: {
        ...samplePayload().extension,
        id: "sample.external-extension",
      },
      installed: {
        id: "sample.external-extension",
        version: "1.2.3",
        enabled: true,
        installPath: "D:/WorkspaceUser/extensions/sample.external-extension",
        builtin: false,
      },
    }))

    const external = service.recomputeEnablementForWorkspaceTrust(false).states.find((state) => state.extensionId === "sample.external-extension")
    expect(external?.workspaceLocationEvidence).toMatchObject({
      status: "available",
      isInsideWorkspace: false,
      workspaceRoots: ["D:/Workspace"],
    })
  })

  it("uses lifecycle rootDir when Electron start evidence has no workspaceRoots yet", () => {
    const service = new ExtensionWorkbenchService()
    service.setEditorViewModelForEvidence(samplePayload({
      extension: {
        ...samplePayload().extension,
        capabilities: {
          untrustedWorkspaces: { supported: false },
        },
      },
      installed: {
        id: sampleExtension.id,
        version: "1.2.3",
        enabled: true,
        installPath: "D:/Workspace/extensions/sample.publisher-extension",
        builtin: false,
      },
    }))
    service.recomputeEnablementForWorkspaceTrust(false)

    const startEvidence: ExtensionHostLifecycleOperationEvidence = {
      serviceId: "extensionHostLifecycleService",
      stateSource: "desktop.extensionsHostService",
      vscodeContract: "IExtensionService.startExtensionHosts",
      action: "startExtensionHosts",
      reason: "Changing workspace trust",
      requested: true,
      started: true,
      alreadyRunning: false,
      rootDir: "D:/Workspace",
      createdAt: 1710000000200,
    }

    const lifecycle = service.recordExtensionHostLifecycleEvidence({ startEvidence })

    expect(lifecycle.hostWorkspaceEvidence).toMatchObject({
      status: "available",
      workspaceRoots: ["D:/Workspace"],
      workspaceFile: null,
    })
    expect(lifecycle.hostWorkspaceEvidence.blockedReason).toBeUndefined()
    expect(service.getEnablementProjection(sampleExtension.id)?.workspaceLocationEvidence).toMatchObject({
      status: "available",
      isInsideWorkspace: true,
      installPath: "D:/Workspace/extensions/sample.publisher-extension",
      workspaceRoots: ["D:/Workspace"],
    })
    expect(service.getEnablementProjection(sampleExtension.id)?.workspaceLocationEvidence.blockedReason).toBeUndefined()
    expect(service.getSurfaceSnapshot().latestEnablementRecompute?.states[0].workspaceLocationEvidence).toMatchObject({
      status: "available",
      isInsideWorkspace: true,
      workspaceRoots: ["D:/Workspace"],
    })
  })

  it("separates extension host lifecycle stop/start requested, blocked and completed evidence", () => {
    const service = new ExtensionWorkbenchService()
    const stopRequested: ExtensionHostLifecycleOperationEvidence = {
      serviceId: "extensionHostLifecycleService",
      stateSource: "desktop.extensionsHostService",
      vscodeContract: "IExtensionService.stopExtensionHosts",
      action: "stopExtensionHosts",
      reason: "Changing workspace trust",
      requested: true,
      stopped: false,
      wasRunning: true,
      vetoed: false,
      vetoReason: "",
      createdAt: 1710000000100,
    }

    expect(service.recordExtensionHostLifecycleEvidence({ stopEvidence: stopRequested })).toMatchObject({
      phase: "stopRequested",
      status: "partial",
      blockedBy: "workspaceTrustTransitionOwner",
      restartCompletedHere: false,
    })

    const stopBlocked: ExtensionHostLifecycleOperationEvidence = {
      ...stopRequested,
      vetoed: true,
      vetoReason: "debug session veto",
      createdAt: 1710000000200,
    }

    expect(service.recordExtensionHostLifecycleEvidence({ stopEvidence: stopBlocked })).toMatchObject({
      phase: "blocked",
      status: "blocked",
      blockedBy: "desktopExtensionHostLifecycleOwner",
      reason: expect.stringContaining("debug session veto"),
      restartCompletedHere: false,
    })

    const stopCompleted: ExtensionHostLifecycleOperationEvidence = {
      ...stopRequested,
      stopped: true,
      createdAt: 1710000000300,
    }
    const startRequested: ExtensionHostLifecycleOperationEvidence = {
      serviceId: "extensionHostLifecycleService",
      stateSource: "desktop.extensionsHostService",
      vscodeContract: "IExtensionService.startExtensionHosts",
      action: "startExtensionHosts",
      reason: "Changing workspace trust",
      requested: true,
      started: false,
      alreadyRunning: false,
      createdAt: 1710000000400,
    }

    expect(service.recordExtensionHostLifecycleEvidence({ stopEvidence: stopCompleted, startEvidence: startRequested })).toMatchObject({
      phase: "startRequested",
      status: "partial",
      restartCompletedHere: false,
    })

    const startOnlyService = new ExtensionWorkbenchService()
    expect(startOnlyService.recordExtensionHostLifecycleEvidence({
      startEvidence: {
        ...startRequested,
        started: true,
        createdAt: 1710000000500,
      },
    })).toMatchObject({
      phase: "completed",
      status: "partial",
      restartCompletedHere: false,
    })

    expect(service.recordExtensionHostLifecycleEvidence({
      stopEvidence: stopCompleted,
      startEvidence: {
        ...startRequested,
        started: true,
        createdAt: 1710000000600,
      },
    })).toMatchObject({
      phase: "completed",
      status: "available",
      blockedBy: "none",
      restartRequiresWorkspaceTrustTransition: false,
      restartCompletedHere: true,
    })

    const lifecycle = service.getExtensionHostLifecycleContract()
    expect(lifecycle.remoteReloadOwnerEvidence).toMatchObject({
      source: "WorkspaceTrustUXHandler.remoteAuthorityReload",
      status: "blocked",
      owner: "remoteAuthorityReloadOwner",
      blockedOwner: "workbenchWindowReloadService",
      blockedBoundary: "requiresWorkbenchWindowReloadOwner",
      vscodeContract: "IHostService.reload",
      currentSignals: {
        remoteAuthorityResolver: "available",
        extensionHostStopStartRoutes: "available",
        extensionHostReloadRoute: "extensionHostOnly",
        desktopLifecycleReloadOwner: "notWorkspaceTrustReloadOwner",
        hostServiceReload: "missing",
      },
      availableServiceLifecycleEvidence: ["IExtensionService.stopExtensionHosts", "IExtensionService.startExtensionHosts"],
      extensionHostProcessRestartOwner: "desktopExtensionHostProcessOwner",
      vscodeRestartSourcePaths: VS_CODE_EXTENSION_HOST_RESTART_SOURCE_PATHS,
      restartContract: "workbench.action.restartExtensionHost->IExtensionService.stopExtensionHosts+startExtensionHosts",
      extensionHostReloadRouteScope: "extensionHostOnly",
      missingWindowReloadOwner: "AppWindowShellOrElectronMainReloadOwner",
      cannotSatisfyVscodeHostReloadWithExtensionHostReload: true,
      blockedByCurrentOwnerBoundary: "AppWindowShellOrElectronMainReloadOwner",
      windowReloadSeparateFromExtensionHostRestart: true,
      runtimeReference: false,
    })
    expect(lifecycle.remoteReloadOwnerEvidence.reason).toContain("IHostService.reload")
    expect(lifecycle.remoteReloadOwnerEvidence.reason).toContain("workbench.action.restartExtensionHost")
    expect(lifecycle.remoteReloadOwnerEvidence.reason).toContain("stopExtensionHosts+startExtensionHosts")
    expect(lifecycle.remoteReloadOwnerEvidence.reason).toContain("App/window shell or Electron main workbench-window reload owner")
    expect(JSON.stringify(lifecycle.remoteReloadOwnerEvidence)).not.toContain("SourceMirror")
  })

  it("stores service-backed editor evidence without calling the EH details endpoint", () => {
    const service = new ExtensionWorkbenchService()
    const model = service.setEditorViewModelForEvidence(samplePayload())

    expect(getFullExtensionDetails).not.toHaveBeenCalled()
    expect(service.getEditorViewModel(sampleExtension.id)).toBe(model)
    expect(getExtensionWorkbenchDetailSummary(service, sampleExtension.id)).toMatchObject({
      extensionId: sampleExtension.id,
      actionIds: ["install", "open"],
      noSecondInstallState: true,
    })
    expect(service.getSurfaceSnapshot()).toMatchObject({
      editorCount: 1,
      latestEditorId: sampleExtension.id,
      openedExtensionIds: [sampleExtension.id],
      constraints: {
        noSecondInstallState: true,
      },
    })
  })

  it("tracks controlled install progress and failure evidence without bypassing ehClient", async () => {
    vi.mocked(streamInstallProgress).mockImplementation((_id, onEvent) => {
      onEvent({ phase: "download", percent: 45, message: "downloaded" })
      return vi.fn()
    })
    vi.mocked(installExtension).mockResolvedValue({ success: false, error: "trust gate rejected" })

    const result = await extensionWorkbenchService.install(sampleExtension.id, "1.2.3")

    expect(result).toEqual({ success: false, error: "trust gate rejected" })
    expect(streamInstallProgress).toHaveBeenCalledWith(sampleExtension.id, expect.any(Function))
    expect(installExtension).toHaveBeenCalledWith(sampleExtension.id, "1.2.3", { confirmed: false })
    expect(extensionWorkbenchService.getInstallProgress(sampleExtension.id)).toMatchObject({ phase: "download", percent: 45 })
    expect(extensionWorkbenchService.getActionState(sampleExtension.id)).toMatchObject({
      action: "install",
      status: "error",
      message: "trust gate rejected",
    })
  })

  it("passes trust confirmation from the service-backed install plan instead of ehClient defaulting it", async () => {
    await extensionWorkbenchService.open(sampleExtension.id)

    await extensionWorkbenchService.install(sampleExtension.id, "1.2.3")

    expect(installExtension).toHaveBeenCalledWith(sampleExtension.id, "1.2.3", { confirmed: true })
  })

  it("summarizes extension workbench evidence including progress, rollback risk, and local-first constraints", async () => {
    vi.mocked(streamInstallProgress).mockImplementation((_id, onEvent) => {
      onEvent({ phase: "extract", percent: 75, message: "extracting cached VSIX" })
      return vi.fn()
    })
    vi.mocked(installExtension).mockResolvedValueOnce({ success: false, error: "offline cache missing" })

    await extensionWorkbenchService.open(sampleExtension.id)
    await extensionWorkbenchService.install(sampleExtension.id, "1.2.3")

    expect(getExtensionWorkbenchEvidenceSummary(extensionWorkbenchService, sampleExtension.id)).toEqual({
      source: "extensionsWorkbenchService",
      serviceId: "extensionsWorkbenchService",
      extensionId: sampleExtension.id,
      installState: "error",
      actionState: {
        action: "install",
        status: "error",
        message: "offline cache missing",
      },
      progress: {
        phase: "extract",
        percent: 75,
        message: "extracting cached VSIX",
      },
      evidence: {
        installPlanReady: true,
        requiresConfirmation: true,
        warnings: ["win32-x64 compatible", "部分 API 走 Codek shim"],
        auditCount: 1,
      },
      rollbackRisk: {
        available: false,
        lastBackup: "",
        detail: "该扩展暂无可回滚备份",
      },
      actionCommands: expect.arrayContaining([
        expect.objectContaining({
          actionId: "install",
          commandId: EXTENSIONS_WORKBENCH_COMMAND_IDS.Install,
          owner: "extensionsWorkbenchService",
        }),
      ]),
      manageActionOwner: expect.objectContaining({
        actionId: "manage",
        commandId: EXTENSIONS_WORKBENCH_COMMAND_IDS.Manage,
        owner: "extensionsWorkbenchService",
      }),
      manageSecondaryActions: expect.arrayContaining([
        expect.objectContaining({
          actionId: "install",
          commandId: EXTENSIONS_WORKBENCH_COMMAND_IDS.Install,
        }),
      ]),
      constraints: {
        localFirst: true,
        goesThroughEhClient: true,
        noSecondInstallState: true,
      },
    })
  })

  it("projects a serializable Extension Gallery workbench surface from the same service state", async () => {
    vi.mocked(listInstalledExtensions).mockResolvedValue([sampleExtension])
    vi.mocked(streamInstallProgress).mockImplementation((_id, onEvent) => {
      onEvent({ phase: "activate", percent: 90, message: "activating extension host contribution" })
      return vi.fn()
    })
    vi.mocked(installExtension).mockResolvedValueOnce({ success: false, error: "approval required" })

    await extensionWorkbenchService.search("sample", { pageSize: 7 })
    await extensionWorkbenchService.showInstalled()
    await extensionWorkbenchService.open(sampleExtension.id)
    await extensionWorkbenchService.install(sampleExtension.id, "1.2.3")

    expect(getExtensionWorkbenchSurfaceSnapshot(extensionWorkbenchService)).toEqual({
      source: "extensionsWorkbenchService",
      serviceId: "extensionsWorkbenchService",
      containerId: EXTENSIONS_WORKBENCH_VIEW_IDS.Container,
      viewIds: [
        EXTENSIONS_WORKBENCH_VIEW_IDS.Marketplace,
        EXTENSIONS_WORKBENCH_VIEW_IDS.Installed,
        EXTENSIONS_WORKBENCH_VIEW_IDS.Editor,
      ],
      commandIds: Object.values(EXTENSIONS_WORKBENCH_COMMAND_IDS),
      quickAccessPrefix: "ext ",
      stateSource: "service",
      contributionSummary: {
        source: "extensionsWorkbenchService",
        serviceId: "extensionsWorkbenchService",
        label: "扩展工作台：扩展市场、已安装、详情、命令面板、视图标题和快速访问",
        containerId: EXTENSIONS_WORKBENCH_VIEW_IDS.Container,
        viewIds: [
          EXTENSIONS_WORKBENCH_VIEW_IDS.Marketplace,
          EXTENSIONS_WORKBENCH_VIEW_IDS.Installed,
          EXTENSIONS_WORKBENCH_VIEW_IDS.Editor,
        ],
        commandIds: Object.values(EXTENSIONS_WORKBENCH_COMMAND_IDS),
        supportedContributionPoints: ["commands", "configuration", "storage", "views"],
        unsupportedContributionPoints: ["debuggers", "notebooks", "webviews"],
        usabilityContract: "installed->enabled->extensionHostActivation->contributionProjection",
        quickAccessPrefix: "ext ",
        viewActionMenuDriven: true,
        noSecondInstallState: true,
      },
      lastSearchQuery: "sample",
      lastSearchResultCount: 1,
      installedCount: 1,
      editorCount: 1,
      openedExtensionIds: [sampleExtension.id],
      latestEditorId: sampleExtension.id,
      actionStateCount: 1,
      pendingActionCount: 0,
      errorActionCount: 1,
      progressCount: 1,
      enablementRecomputedCount: 0,
      disabledByTrustRequirementCount: 0,
      enablementMatrix: EXTENSION_WORKBENCH_ENABLEMENT_STATE_MATRIX,
      extensionHostLifecycle: {
        source: "extensionsWorkbenchService",
        serviceId: "extensionsWorkbenchService",
        vscodeServiceId: "extensionService",
        stateSource: "extensionsWorkbenchService+ehClient",
        restartOwner: "desktopExtensionHostProcessOwner",
        restartContract: "workbench.action.restartExtensionHost->IExtensionService.stopExtensionHosts+startExtensionHosts",
        reloadOwner: "workbenchWindowReloadService",
        localContract: "IExtensionService.stopExtensionHosts+startExtensionHosts",
        remoteContract: "hostService.reload",
        status: "partial",
        phase: "notRequired",
        owner: "ExtensionHostWorkbenchService + desktop /extensions-host/lifecycle routes",
        reason: "Codek exposes stop/start lifecycle routes and WorkspaceTrust transition evidence, but this service only projects the contract and does not own or claim a completed host restart.",
        blockedBy: "workspaceTrustTransitionOwner",
        stopStartRoutesAvailable: true,
        restartRequiresWorkspaceTrustTransition: true,
        restartCompletedHere: false,
        latestStopEvidence: null,
        latestStartEvidence: null,
        hostWorkspaceEvidence: {
          source: "desktop.extensionsHostService.lifecycleEvidence",
          status: "blocked",
          workspaceRoots: [],
          workspaceFile: null,
          reason: "extension host lifecycle evidence has no workspaceRoots/workspaceFile owner data yet",
          runtimeReference: false,
          currentSourcePaths: CODEK_EXTENSION_ENABLEMENT_SOURCE_PATHS,
          vscodeSourcePaths: VS_CODE_EXTENSION_TRUST_SOURCE_PATHS,
          blockedReason: "Workspace-location trust parity needs extension-host lifecycle evidence with workspaceRoots/workspaceFile before Codek can mirror contextService.isInsideWorkspace(extension.location).",
        },
        remoteReloadOwnerEvidence: {
          source: "WorkspaceTrustUXHandler.remoteAuthorityReload",
          status: "blocked",
          owner: "remoteAuthorityReloadOwner",
          blockedOwner: "workbenchWindowReloadService",
          blockedBoundary: "requiresWorkbenchWindowReloadOwner",
          vscodeContract: "IHostService.reload",
          vscodeSourcePaths: [
            "src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts",
            "src/vs/workbench/services/remote/common/remoteAgentService.ts",
            "src/vs/workbench/services/host/browser/host.ts",
            "src/vs/workbench/services/host/electron-browser/nativeHostService.ts",
          ],
          requiredSignals: ["remoteAgentService.getConnection().remoteAuthority", "hostService.reload"],
          currentSignals: {
            remoteAuthorityResolver: "available",
            extensionHostStopStartRoutes: "available",
            extensionHostReloadRoute: "extensionHostOnly",
            desktopLifecycleReloadOwner: "notWorkspaceTrustReloadOwner",
            hostServiceReload: "missing",
          },
          availableServiceLifecycleEvidence: ["IExtensionService.stopExtensionHosts", "IExtensionService.startExtensionHosts"],
          extensionHostProcessRestartOwner: "desktopExtensionHostProcessOwner",
          vscodeRestartSourcePaths: VS_CODE_EXTENSION_HOST_RESTART_SOURCE_PATHS,
          restartContract: "workbench.action.restartExtensionHost->IExtensionService.stopExtensionHosts+startExtensionHosts",
          extensionHostReloadRouteScope: "extensionHostOnly",
          missingWindowReloadOwner: "AppWindowShellOrElectronMainReloadOwner",
          cannotSatisfyVscodeHostReloadWithExtensionHostReload: true,
          currentSourcePaths: CODEK_WORKSPACE_TRUST_REMOTE_RELOAD_AUDIT_SOURCE_PATHS,
          blockedByCurrentOwnerBoundary: "AppWindowShellOrElectronMainReloadOwner",
          windowReloadSeparateFromExtensionHostRestart: true,
          reason: "VS Code workbench.action.restartExtensionHost restarts extension hosts through IExtensionService.stopExtensionHosts+startExtensionHosts, while remote-authority workbench reloads use IHostService.reload. Codek owns the former through desktop extension-host process restart evidence and keeps the latter blocked until an App/window shell or Electron main workbench-window reload owner exists.",
          runtimeReference: false,
        },
      },
      latestEnablementRecompute: null,
      latestProgress: {
        extensionId: sampleExtension.id,
        phase: "activate",
        percent: 90,
        message: "activating extension host contribution",
      },
      constraints: {
        localFirst: true,
        goesThroughEhClient: true,
        noSecondInstallState: true,
        viewActionMenuDriven: true,
      },
    })
  })

  it("routes enable and disable through the same extension workbench service instead of a second UI state source", async () => {
    await extensionWorkbenchService.enable(sampleExtension.id)
    await extensionWorkbenchService.disable(sampleExtension.id)

    expect(enableExtension).toHaveBeenCalledWith(sampleExtension.id)
    expect(disableExtension).toHaveBeenCalledWith(sampleExtension.id)
    expect(extensionWorkbenchService.getActionState(sampleExtension.id)).toBeUndefined()
  })

  it("registers extension views, actions, menus and QuickAccess provider on the shared workbench surface", async () => {
    registerExtensionWorkbenchContributions()

    expect(getViewContainers("activityBar").map((container) => container.id)).toContain(EXTENSIONS_WORKBENCH_VIEW_IDS.Container)
    expect(getViews(EXTENSIONS_WORKBENCH_VIEW_IDS.Container).map((view) => view.id)).toEqual([
      EXTENSIONS_WORKBENCH_VIEW_IDS.Marketplace,
      EXTENSIONS_WORKBENCH_VIEW_IDS.Installed,
      EXTENSIONS_WORKBENCH_VIEW_IDS.Editor,
    ])
    expect(getCommand(EXTENSIONS_WORKBENCH_COMMAND_IDS.Search)).toMatchObject({
      category: "扩展",
      source: "vscode",
    })
    expect(MenuRegistry.getMenuEntries(MenuId.ViewTitle, { view: EXTENSIONS_WORKBENCH_VIEW_IDS.Marketplace }).map((entry) => entry.type === "item" ? entry.commandId : entry.id)).toContain(
      EXTENSIONS_WORKBENCH_COMMAND_IDS.Search,
    )

    const match = matchQuickAccessProvider("ext sample")
    expect(match).toMatchObject({ filter: "sample", descriptor: { prefix: "ext " } })
    const items = await Promise.resolve(match?.descriptor.provider.provide(match.filter))
    expect(items?.map((item) => item.id)).toContain(`extensions.detail:${sampleExtension.id}`)

    await items?.find((item) => item.id === `extensions.detail:${sampleExtension.id}`)?.accept?.()
    expect(getFullExtensionDetails).toHaveBeenCalledWith(sampleExtension.id, undefined)

    await items?.find((item) => item.id === `extensions.detail:${sampleExtension.id}`)?.buttons?.[0].accept?.()
    expect(installExtension).toHaveBeenCalledWith(sampleExtension.id, "1.2.3", { confirmed: true })

    await executeCommand(EXTENSIONS_WORKBENCH_COMMAND_IDS.Open, [sampleExtension.id])
    expect(getFullExtensionDetails).toHaveBeenCalledWith(sampleExtension.id, undefined)

    expect(getCommand(EXTENSIONS_WORKBENCH_COMMAND_IDS.Manage)).toMatchObject({
      category: "扩展",
      source: "vscode",
    })
    vi.mocked(getFullExtensionDetails).mockClear()
    await executeCommand(EXTENSIONS_WORKBENCH_COMMAND_IDS.Manage, [sampleExtension.id, { source: "notification" }])
    expect(getFullExtensionDetails).toHaveBeenCalledWith(sampleExtension.id, undefined)

    await executeCommand(EXTENSIONS_WORKBENCH_COMMAND_IDS.Disable, [sampleExtension.id])
    await executeCommand(EXTENSIONS_WORKBENCH_COMMAND_IDS.Enable, [sampleExtension.id])
    expect(disableExtension).toHaveBeenCalledWith(sampleExtension.id)
    expect(enableExtension).toHaveBeenCalledWith(sampleExtension.id)
  })
})
