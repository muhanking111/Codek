import { beforeEach, describe, expect, it, vi } from "vitest"
import { auth } from "../auth/authState"
import * as ehClient from "../extensions/ehClient"
import type { ExtensionDetailsPayload, VsixMetadata } from "../extensions/ehClient"
import { extensionWorkbenchService } from "../extensions/extensionsWorkbenchService"
import { api } from "../lib/api"
import { getRemoteManager, resetRemoteManager } from "../remote/remoteManager"
import { CodekStorageService, StorageScope, StorageTarget } from "../storage/storageService"
import { CodekDialogService } from "../dialogs/dialogService"
import { ConfigurationService, SettingsStore, settingsStore, type SettingsStorage } from "../settings/settingsStore"
import { ConfigurationRegistry, ConfigurationScope } from "../settings/configurationRegistry"
import { MenuId, MenuRegistry } from "../vscode-adapter/platform/actions/common/menuRegistry"
import { getSingletonServiceDescriptors } from "../vscode-adapter/platform/instantiation/common/extensions"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"
import { clearCommands, executeCommand, getCommand } from "./commandRegistry"
import { globalContextKeyService } from "./contextKeys"
import {
  AUTHENTICATION_WORKBENCH_COMMAND_IDS,
  EXTENSION_HOST_WORKBENCH_COMMAND_IDS,
  EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS,
  ExtensionHostWorkbenchService,
  IAuthenticationService,
  IExtensionHostService,
  IRemoteAuthorityResolverService,
  IWorkspaceTrustEnablementService,
  IWorkspaceTrustManagementService,
  REMOTE_AUTHORITY_WORKBENCH_COMMAND_IDS,
  RemoteAuthorityResolverWorkbenchService,
  WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID,
  WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS,
  WORKSPACE_TRUST_CONTEXT_KEYS,
  CodekWorkbenchHostReloadService,
  CodekWindowHostFocusService,
  WorkspaceTrustBannerWorkbenchService,
  WorkspaceTrustWorkbenchService,
  clearExtensionTrustRemoteAuthWorkbenchEvidence,
  getExtensionTrustRemoteAuthWorkbenchSurfaceSnapshot,
  globalAuthenticationService,
  globalExtensionHostService,
  globalRemoteAuthorityResolverService,
  globalWorkspaceTrustEnablementService,
  globalWorkspaceTrustManagementService,
  registerExtensionTrustRemoteAuthWorkbenchContributions,
  resolveCodekWorkbenchWindowReloadDelegate,
} from "./extensionTrustRemoteAuthWorkbench"
import { WorkbenchNotificationProgressService, WorkbenchStatusbarAlignment } from "./statusNotificationProgressService"
import { WorkbenchExplorerEditorService } from "./workbenchExplorerEditorService"
import { clearViews, getViewContainers, getViews } from "./viewRegistry"
import { Emitter } from "../vscode-adapter/base/common/event"

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    request: vi.fn(),
  },
}))

class MemorySettingsStorage implements SettingsStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

class TestHostFocusService {
  declare readonly _serviceBrand: undefined
  private readonly onDidChangeFocusEmitter = new Emitter<boolean>()
  readonly onDidChangeFocus = this.onDidChangeFocusEmitter.event

  constructor(private focused: boolean) {}

  get hasFocus(): boolean {
    return this.focused
  }

  setFocus(focused: boolean): void {
    this.focused = focused
    this.onDidChangeFocusEmitter.fire(focused)
  }

  dispose(): void {
    this.onDidChangeFocusEmitter.dispose()
  }
}

class TestRemoteAuthorityService extends RemoteAuthorityResolverWorkbenchService {
  constructor(activeAuthority: string) {
    super()
    if (activeAuthority) {
      const remoteType = activeAuthority.startsWith("ssh-remote+") ? "ssh" : "wsl"
      this.recordResolvedAuthorityForEvidence(activeAuthority, {
        id: activeAuthority,
        type: remoteType,
        label: activeAuthority,
      })
    }
  }
}

const trustRequiredExtension: VsixMetadata = {
  id: "sample.trust-required",
  displayName: "Trust Required",
  description: "Requires workspace trust",
  version: "1.0.0",
  publisher: "sample",
  downloads: 1,
  categories: ["Other"],
}

function trustRequiredPayload(): ExtensionDetailsPayload {
  return {
    reportKind: "extension-details",
    createdAt: 1710000000000,
    ready: true,
    id: trustRequiredExtension.id,
    extension: trustRequiredExtension,
    installed: {
      id: trustRequiredExtension.id,
      version: "1.0.0",
      enabled: true,
      installPath: "D:/Workspace/extensions/sample.trust-required",
      builtin: false,
    },
    readme: {
      id: trustRequiredExtension.id,
      available: true,
      length: 0,
      text: "",
    },
    versions: [{ version: "1.0.0" }],
    latestVersion: "1.0.0",
    installPlan: {
      reportKind: "extension-install-plan",
      id: trustRequiredExtension.id,
      readyToInstall: true,
      requiresConfirmation: true,
      dependencies: [],
      extensionPack: [],
      missingDependencies: [],
      missingExtensionPack: [],
      operations: [],
      warnings: [],
    },
    compatibility: {
      available: true,
      status: "compatible",
      blockers: [],
      warnings: [],
      unsupportedContributionPoints: [],
      partialContributionPoints: [],
    },
    installState: null,
    audit: [],
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function resetAuthState(): void {
  auth.isLoggedIn = false
  auth.token = ""
  auth.username = ""
  auth.email = ""
  auth.loading = false
  auth.oauthStatus = "idle"
  auth.oauthProvider = ""
  auth.loginError = ""
  auth.loginErrorCode = ""
  auth.githubDeviceFlow.active = false
  auth.githubDeviceFlow.userCode = ""
  auth.githubDeviceFlow.verificationUri = ""
  auth.githubDeviceFlow.statusText = ""
}

describe("Extension Host / Workspace Trust / Remote Authority / Authentication Workbench contribution", () => {
  beforeEach(() => {
    settingsStore.reset()
    clearCommands()
    clearViews()
    MenuRegistry.clear()
    clearExtensionTrustRemoteAuthWorkbenchEvidence()
    extensionWorkbenchService.clearState()
    resetRemoteManager()
    resetAuthState()
    vi.restoreAllMocks()
    vi.mocked(api.post).mockImplementation(async (_path, body) => ({
      trust: {
        status: typeof body === "object" && body && "status" in body ? body.status : "unknown",
        trustedFolders: typeof body === "object" && body && "trustedFolders" in body && Array.isArray(body.trustedFolders)
          ? body.trustedFolders
          : [],
      },
    }))
    vi.spyOn(ehClient, "activateExtensionHostByEvent").mockImplementation(async (activationEvent, extensionId = "codek.placeholder") => ({
      success: true,
      evidence: {
        serviceId: "extensionHostService",
        stateSource: "extensionsWorkbenchService+ehClient",
        activationEvent,
        extensionId,
        status: "activated",
        createdAt: Date.now(),
      },
    }))
    vi.spyOn(ehClient, "stopExtensionHosts").mockImplementation(async (reason, options = {}) => ({
      success: true,
      evidence: {
        serviceId: "extensionHostLifecycleService",
        stateSource: "desktop.extensionsHostService",
        vscodeContract: "IExtensionService.stopExtensionHosts",
        action: "stopExtensionHosts",
        reason,
        requested: true,
        stopped: true,
        wasRunning: true,
        vetoed: false,
        vetoReason: "",
        rootDir: options.rootDir,
        workspaceRoots: options.workspaceRoots,
        workspaceFile: options.workspaceFile,
        createdAt: Date.now(),
      },
    }))
    vi.spyOn(ehClient, "startExtensionHosts").mockImplementation(async (reason = "", options = {}) => ({
      success: true,
      evidence: {
        serviceId: "extensionHostLifecycleService",
        stateSource: "desktop.extensionsHostService",
        vscodeContract: "IExtensionService.startExtensionHosts",
        action: "startExtensionHosts",
        reason,
        requested: true,
        started: true,
        alreadyRunning: false,
        rootDir: options.rootDir,
        workspaceRoots: options.workspaceRoots,
        workspaceFile: options.workspaceFile,
        createdAt: Date.now(),
      },
    }))
  })

  it("registers VS Code-style service identifiers and resolves them through ServiceCollection", () => {
    const collection = new ServiceCollection(
      [IExtensionHostService, globalExtensionHostService],
      [IWorkspaceTrustEnablementService, globalWorkspaceTrustEnablementService],
      [IWorkspaceTrustManagementService, globalWorkspaceTrustManagementService],
      [IRemoteAuthorityResolverService, globalRemoteAuthorityResolverService],
      [IAuthenticationService, globalAuthenticationService],
    )

    expect(String(IExtensionHostService)).toBe("extensionHostService")
    expect(String(IWorkspaceTrustEnablementService)).toBe("workspaceTrustEnablementService")
    expect(String(IWorkspaceTrustManagementService)).toBe("workspaceTrustManagementService")
    expect(String(IRemoteAuthorityResolverService)).toBe("remoteAuthorityResolverService")
    expect(String(IAuthenticationService)).toBe("IAuthenticationService")
    expect(collection.get(IExtensionHostService)).toBe(globalExtensionHostService)
    expect(collection.get(IWorkspaceTrustEnablementService)).toBe(globalWorkspaceTrustEnablementService)
    expect(collection.get(IWorkspaceTrustManagementService)).toBe(globalWorkspaceTrustManagementService)
    expect(collection.get(IRemoteAuthorityResolverService)).toBe(globalRemoteAuthorityResolverService)
    expect(collection.get(IAuthenticationService)).toBe(globalAuthenticationService)

    expect(getSingletonServiceDescriptors()).toEqual(expect.arrayContaining([
      [IExtensionHostService, globalExtensionHostService],
      [IWorkspaceTrustEnablementService, globalWorkspaceTrustEnablementService],
      [IWorkspaceTrustManagementService, globalWorkspaceTrustManagementService],
      [IRemoteAuthorityResolverService, globalRemoteAuthorityResolverService],
      [IAuthenticationService, globalAuthenticationService],
    ]))
  })

  it("registers view container, views, command palette actions and view title menus", () => {
    registerExtensionTrustRemoteAuthWorkbenchContributions()

    expect(getViewContainers("activityBar").map((container) => container.id)).toContain(
      EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.Container,
    )
    expect(getViews(EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.Container).map((view) => view.id)).toEqual(expect.arrayContaining([
      EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.ExtensionHost,
      EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.WorkspaceTrust,
      EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.RemoteAuthority,
      EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.Authentication,
    ]))

    const commandIds = [
      EXTENSION_HOST_WORKBENCH_COMMAND_IDS.ActivatePlaceholder,
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage,
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Configure,
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Allow,
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Deny,
      REMOTE_AUTHORITY_WORKBENCH_COMMAND_IDS.Resolve,
      AUTHENTICATION_WORKBENCH_COMMAND_IDS.RequestSession,
      AUTHENTICATION_WORKBENCH_COMMAND_IDS.RevokeSession,
    ]
    expect(commandIds.map((id) => getCommand(id)?.id)).toEqual(commandIds)

    const paletteIds = MenuRegistry.getMenuEntries(MenuId.CommandPalette).map((entry) => entry.type === "item" ? entry.commandId : entry.id)
    expect(paletteIds).toEqual(expect.arrayContaining(commandIds))

    const trustTitleIds = MenuRegistry.getMenuEntries(MenuId.ViewTitle, {
      view: EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.WorkspaceTrust,
    }).map((entry) => entry.type === "item" ? entry.commandId : entry.id)
    expect(trustTitleIds).toEqual(expect.arrayContaining([
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage,
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Configure,
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Allow,
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Deny,
    ]))
  })

  it("opens the VS Code-style WorkspaceTrustEditorInput through a pinned Codek editor shell request", async () => {
    const service = new WorkspaceTrustWorkbenchService()
    const editorService = new WorkbenchExplorerEditorService()
    extensionWorkbenchService.setEditorViewModelForEvidence(trustRequiredPayload())
    extensionWorkbenchService.recomputeEnablementForWorkspaceTrust(false)

    expect(service.getTrustSnapshot().capabilities.requestService.uiOwners.manageEditor).toMatchObject({
      status: "blocked",
      owner: "WorkspaceTrustEditor",
    })

    const registration = service.registerWorkspaceTrustManageEditorShell(editorService)
    const request = service.openWorkspaceTrustManageEditor()

    expect(request).toMatchObject({
      commandId: "workbench.trust.manage",
      opened: true,
      options: { pinned: true },
      editorPath: "vscode-workspace-trust://workspaceTrustEditor",
      input: {
        typeId: "workbench.input.workspaceTrust",
        editorId: "workbench.editor.workspaceTrust",
        name: "工作区信任",
        resource: "vscode-workspace-trust://workspaceTrustEditor",
        capabilities: ["singleton", "requiresModal"],
      },
    })
    expect(editorService.getOpenEditorsModel()).toMatchObject({
      activeEditor: "vscode-workspace-trust://workspaceTrustEditor",
      totalEditors: 1,
      pinnedCount: 1,
    })
    expect(service.getTrustSnapshot().capabilities.requestService).toMatchObject({
      uiOwners: {
        manageEditor: {
          status: "available",
          owner: "WorkspaceTrustEditor",
        },
      },
      manageEditorShell: {
        status: "registered",
        serviceId: "workbenchExplorerEditorService",
        latestOpenRequest: {
          commandId: "workbench.trust.manage",
          opened: true,
        },
        openRequestCount: 1,
      },
      missingEntrypointCommandIds: [WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Configure],
      constraints: {
        noSecondRequestStore: true,
        fullWorkspaceTrustEditorPaneNotImplemented: true,
        requestLifecycleEvidenceOnly: true,
      },
        editorPane: {
          owner: "WorkspaceTrustEditor",
          status: "partial",
          openRequestStatus: "available",
          paneOwnerStatus: "partial",
          trustStore: "WorkspaceTrustWorkbenchService",
          ownerFeasibility: {
            status: "contractOwnerAvailable",
            conclusion: "minimalOpenRequestOwnerOnly",
            inspectedVscodeOwners: ["WorkspaceTrustEditor", "SettingsEditor2", "SettingsTree", "WorkbenchTable"],
            minimalAdapter: {
              owner: "WorkspaceTrustWorkbenchService.registerWorkspaceTrustManageEditorShell",
              status: "available",
              commandId: "workbench.trust.manage",
              editorResource: "vscode-workspace-trust://workspaceTrustEditor",
              openOptions: {
                pinned: true,
                permanent: true,
                preview: false,
              },
              stateSource: "WorkbenchExplorerEditorService.openEditor",
            },
            blockedOwners: expect.arrayContaining([
              "EditorPaneDescriptor",
              "IEditorService.openEditor(EditorInput)",
              "SettingsTree DOM owner",
              "WorkbenchTable DOM owner",
            ]),
            nextOwnerBoundary: "generic editor shell/App.vue owner",
            runtimeReference: false,
          },
          settingsEditor2: {
            owner: "SettingsEditor2",
            status: "partial",
          editorPaneId: "workbench.editor.settings2",
          stateSource: "IPreferencesService.openUserSettings+CodekSettingsShell",
          reusedConfigurationSource: "workbenchConfigurationService",
          workspaceTrustQueryTags: ["workspaceTrust", "requireTrustedWorkspace"],
          trustChangeModelUpdate: "IWorkspaceTrustManagementService.onDidChangeTrust -> SettingsTreeModel.updateWorkspaceTrust",
          workspaceTrustGroupInjection: "configured untrusted workspace settings -> Workspace Trust settings group",
          missingOwners: ["EditorPane", "IInstantiationService", "IPreferencesService", "IStorageService"],
          coveredSignals: expect.arrayContaining([
            "SettingsEditor2 @tag:workspaceTrust/@tag:requireTrustedWorkspace suggestions",
            "IWorkspaceTrustManagementService.onDidChangeTrust refreshes SettingsTreeModel",
            "configured untrusted workspace settings are injected into Workspace Trust group",
          ]),
          blockedSignals: expect.arrayContaining([
            "complete SettingsEditor2 EditorPane class",
            "SettingsEditor2 split view/search widget lifecycle",
            "SettingsEditor2 memento storage",
          ]),
        },
        settingsTree: {
          owner: "SettingsTree",
          status: "partial",
          stateSource: "workbenchConfigurationService",
          rowModelSource: "IWorkbenchConfigurationService.restrictedSettings",
          query: "@tag:requireTrustedWorkspace",
          indicatorOwner: "SettingsTreeIndicatorsLabel",
          indicatorCommandId: "workbench.trust.manage",
          indicatorClass: "setting-item-workspace-trust",
          modelTrustUpdateSignal: "SettingsTreeModel.updateWorkspaceTrust",
          rowCount: 0,
          missingOwners: ["SettingsTree", "WorkbenchObjectTree", "IListService", "IInstantiationService"],
          coveredSignals: expect.arrayContaining([
            "SettingsTreeIndicatorsLabel workspace trust indicator",
            "SettingsTreeModel.updateWorkspaceTrust",
          ]),
          blockedSignals: expect.arrayContaining([
            "SettingsTree DOM owner",
            "WorkbenchObjectTree/ListService owner",
            "AbstractSettingRenderer controls",
          ]),
        },
        workbenchTableRowModel: {
          owner: "WorkbenchTable",
          status: "partial",
          stateSource: "WorkspaceTrustWorkbenchService",
          sourceClass: "WorkspaceTrustedUrisTable",
          tableOwnerId: "WorkspaceTrust",
          tableUpdateSignal: "WorkspaceTrustedUrisTable.updateTable -> WorkbenchTable.splice",
          rowCount: 0,
          eventCount: 0,
          missingOwners: ["WorkbenchTable", "IInstantiationService", "IStorageService"],
          coveredSignals: expect.arrayContaining([
            "WorkspaceTrustedUrisTable.updateTable -> WorkbenchTable.splice",
          ]),
          blockedSignals: expect.arrayContaining([
            "WorkbenchTable DOM owner",
            "TrustedUri table column renderers",
            "TrustedUri edit/delete input widgets",
          ]),
          shellAdapter: expect.objectContaining({
            source: "codek.workbenchTableShellOwnerAdapter",
            status: "blocked",
            shellSource: "feature-row-model+genericShellOwnerContract",
            noSecondWorkbenchState: true,
            runtimeReference: false,
            tableOwnerId: "WorkspaceTrust",
            rowModelStatus: "partial",
            implementedOwners: expect.arrayContaining([
              "WorkspaceTrustedUrisTable row model",
              "WorkspaceTrustedUrisTable.updateTable -> WorkbenchTable.splice",
            ]),
            blockedOwners: expect.arrayContaining([
              "WorkbenchTable widget construction",
              "TableListRenderer cell template lifecycle",
              "IListService focus/style/context-key registration",
              "Table.domFocus/layout/dispose owner",
              "storage-backed table column state",
            ]),
          }),
        },
        domSmoke: {
          owner: "App.vue WorkspaceTrustEditor smoke DOM",
          status: "available",
          rootSelector: ".workspace-trust-editor",
          focusContract: "rootElement.focus",
          stateSource: "WorkspaceTrustWorkbenchService+extensionsWorkbenchService",
        },
        covered: {
          singletonInput: true,
          pinnedOpenRequest: true,
          domVisible: true,
          rootFocus: true,
          keyboardNavigation: true,
          noSecondTrustStore: true,
        },
        blocked: {
          editorPaneDom: false,
          fullEditorPaneClass: true,
          keyboardNavigation: false,
          focusMethod: false,
          affectedFeaturesList: false,
          trustedUrisTable: false,
          restrictedSettingsRender: false,
        },
        trustedUrisTable: {
          owner: "WorkspaceTrustEditor",
          surface: "trustedUrisTable",
          status: "available",
          stateSource: "WorkspaceTrustWorkbenchService",
          trustedFolderCount: 0,
          trustedFoldersEventCount: 0,
          coveredSignals: ["getTrustedUris", "setTrustedUris", "setUrisTrust", "onDidChangeTrustedFolders"],
          blockedSignals: [],
        },
        affectedFeaturesList: {
          owner: "WorkspaceTrustEditor",
          surface: "affectedFeaturesList",
          status: "available",
          stateSource: "WorkspaceTrustWorkbenchService+extensionsWorkbenchService",
          restrictedModeEnabled: true,
          disabledByTrustRequirementCount: 1,
          blockedSignals: [],
        },
        restrictedSettingsRender: {
          owner: "WorkspaceTrustEditor",
          surface: "restrictedSettingsRender",
          status: "available",
          stateSource: "workbenchConfigurationService",
          configurationKeys: [
            "security.workspace.trust.enabled",
            "security.workspace.trust.startupPrompt",
            "security.workspace.trust.untrustedFiles",
            "security.workspace.trust.banner",
            "security.workspace.trust.emptyWindow",
          ],
          blockedSignals: [],
          filterUntrustedCommand: {
            commandId: "settings.filterUntrusted",
            status: "available",
            vscodeContract: "IPreferencesService.openWorkspaceSettings",
            options: {
              jsonEditor: false,
              query: "@tag:requireTrustedWorkspace",
            },
            settingTag: "requireTrustedWorkspace",
            stateSource: "IWorkbenchConfigurationService.restrictedSettings+CodekSettingsShell",
          },
        },
      },
      smokeReadiness: {
        status: "blocked",
        owner: "WorkspaceTrustRequestHandler",
        rendererOwner: "App.vue CodekDialogService modal",
        serviceEvidence: {
          trustStore: "WorkspaceTrustWorkbenchService",
          noSecondTrustStore: true,
        },
      },
    })
    expect(service.getTrustSnapshot().capabilities.requestService.uiOwners.manageEditor.reason).toContain("pinned: true")
    expect(service.getTrustSnapshot().capabilities.requestService.editorPane.blockedReason).toContain("SettingsEditor2, SettingsTree and WorkbenchTable row evidence")
    expect(service.getTrustSnapshot().capabilities.requestService.editorPane.restrictedSettingsRender).toMatchObject({
      restrictedSettingCount: 0,
      workspaceRestrictedSettingCount: 0,
      treeRows: [],
      coveredSignals: expect.arrayContaining([
        "IWorkbenchConfigurationService.restrictedSettings",
        "IWorkbenchConfigurationService.onDidChangeRestrictedSettings",
        "settings.filterUntrusted -> @tag:requireTrustedWorkspace",
      ]),
    })
    expect(service.getTrustSnapshot().capabilities.requestService.editorPane).toMatchObject({
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/workspace/browser/workspaceTrustEditor.ts",
        "src/vs/workbench/services/workspaces/browser/workspaceTrustEditorInput.ts",
        "src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts",
      ],
      vscodeEditorPaneDomAudit: {
        sourceClass: "WorkspaceTrustEditor",
        editorPaneId: "workbench.editor.workspaceTrust",
        rootSelector: ".workspace-trust-editor",
        bodySelector: ".workspace-trust-editor-body",
        focusContract: "WorkspaceTrustEditor.focus -> rootElement.focus",
        renderDependencies: [
          "IExtensionsWorkbenchService.onChange",
          "IWorkbenchConfigurationService.onDidChangeRestrictedSettings",
          "IWorkspaceTrustManagementService.onDidChangeTrust",
          "IWorkspaceTrustManagementService.onDidChangeTrustedFolders",
        ],
      },
      blocked: {
        keyboardNavigation: false,
        focusMethod: false,
      },
    })
    expect(service.getTrustSnapshot().capabilities.requestService.editorPane.domSmoke.reason).toContain("root element")
    expect(service.getTrustSnapshot().capabilities.requestService.editorPane.ownerFeasibility.inspectedCodekShells).toEqual(expect.arrayContaining([
      expect.objectContaining({
        owner: "WorkbenchExplorerEditorService",
        status: "reusableForOpenRequest",
        missingForFullOwner: expect.arrayContaining(["EditorPaneDescriptor registration", "createEditor(parent) lifecycle"]),
      }),
      expect.objectContaining({
        owner: "EditorPartService",
        status: "genericShellContract",
        supports: expect.arrayContaining([
          "editorGroups-backed active editor summary",
          "WorkspaceTrustEditorInput-compatible resource tab via WorkbenchExplorerEditorService",
        ]),
        missingForFullOwner: expect.arrayContaining([
          "EditorPaneDescriptor registry",
          "IEditorService.openEditor(EditorInput)",
          "EditorPane createEditor(parent) DOM lifecycle",
        ]),
      }),
      expect.objectContaining({
        owner: "App.vue WorkspaceTrustEditor smoke DOM",
        status: "smokeOnly",
        missingForFullOwner: expect.arrayContaining(["owned WorkspaceTrustEditor class", "WorkbenchTable widget construction"]),
      }),
    ]))
    expect(service.getTrustSnapshot().capabilities.requestService.editorPane.ownerFeasibility.reason).toContain("Only the pinned open request has a real Codek owner")
    expect(service.getTrustSnapshot().capabilities.requestService.editorPane.settingsEditor2.reason).toContain("does not claim the full VS Code SettingsEditor2 EditorPane class")
    expect(service.getTrustSnapshot().capabilities.requestService.editorPane.settingsTree.reason).toContain("Restricted SettingsTree rows are projected")
    expect(service.getTrustSnapshot().capabilities.requestService.editorPane.workbenchTableRowModel.reason).toContain("trusted URI row model")
    expect(service.getTrustSnapshot().capabilities.requestService.editorPane.workbenchTableRowModel.shellAdapter.blockedReason).toContain("full VS Code WorkbenchTable ownership requires the table widget")
    expect(service.getTrustSnapshot().capabilities.requestService.editorPane.settingsEditor2.vscodeSourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/contrib/preferences/browser/settingsEditor2.ts",
      "src/vs/workbench/contrib/preferences/browser/settingsTreeModels.ts",
      "src/vs/workbench/services/preferences/common/preferences.ts",
    ]))
    expect(service.getTrustSnapshot().capabilities.requestService.editorPane.settingsTree.vscodeSourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/contrib/preferences/browser/settingsTree.ts",
      "src/vs/workbench/contrib/preferences/browser/settingsTreeModels.ts",
      "src/vs/workbench/contrib/preferences/browser/settingsEditorSettingIndicators.ts",
    ]))
    expect(service.getTrustSnapshot().capabilities.requestService.editorPane.workbenchTableRowModel.vscodeSourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/contrib/workspace/browser/workspaceTrustEditor.ts",
      "src/vs/platform/list/browser/listService.ts",
      "src/vs/base/browser/ui/table/table.ts",
    ]))
    expect(JSON.stringify(service.getTrustSnapshot())).not.toContain("SourceMirror")

    registration.dispose()
    expect(service.getTrustSnapshot().capabilities.requestService.uiOwners.manageEditor.status).toBe("blocked")
  })

  it("records WorkspaceTrustEditor smoke open evidence without invoking the editor shell owner", async () => {
    const service = new WorkspaceTrustWorkbenchService()
    const editorService = new WorkbenchExplorerEditorService()
    const registration = service.registerWorkspaceTrustManageEditorShell(editorService)

    const request = service.recordWorkspaceTrustManageEditorOpenForSmoke()

    expect(request).toMatchObject({
      commandId: "workbench.trust.manage",
      opened: false,
      options: { pinned: true },
      editorPath: "vscode-workspace-trust://workspaceTrustEditor",
      input: {
        typeId: "workbench.input.workspaceTrust",
        editorId: "workbench.editor.workspaceTrust",
        name: "工作区信任",
        resource: "vscode-workspace-trust://workspaceTrustEditor",
      },
    })
    expect(editorService.getOpenEditorsModel()).toMatchObject({
      activeEditor: null,
      totalEditors: 0,
      pinnedCount: 0,
    })
    expect(service.getWorkspaceTrustManageEditorShellProjection()).toMatchObject({
      status: "registered",
      latestOpenRequest: {
        opened: false,
      },
      openRequestCount: 1,
    })

    registration.dispose()
  })

  it("projects WorkspaceTrustEditor restricted settings rows from the existing workbench configuration service", () => {
    const registry = new ConfigurationRegistry([])
    const store = new SettingsStore({
      storage: new MemorySettingsStorage(),
      userKey: "test-workspace-trust-restricted-settings",
      configurationRegistry: registry,
    })
    const configurationService = new ConfigurationService(store, registry)
    const service = new WorkspaceTrustWorkbenchService(
      new WorkbenchNotificationProgressService(),
      new WorkspaceTrustBannerWorkbenchService(),
      new CodekStorageService(),
      configurationService,
    )
    const editorService = new WorkbenchExplorerEditorService()
    const registration = service.registerWorkspaceTrustManageEditorShell(editorService)

    registry.registerConfiguration({
      id: "sample.extension",
      title: "Sample Extension",
      restrictedProperties: ["sample.extension.workspaceOnly"],
      properties: {
        "sample.extension.workspaceOnly": {
          type: "boolean",
          default: false,
          scope: ConfigurationScope.WINDOW,
        },
      },
    })

    expect(service.getTrustSnapshot().capabilities.requestService.editorPane.restrictedSettingsRender).toMatchObject({
      status: "available",
      restrictedSettingCount: 1,
      workspaceRestrictedSettingCount: 1,
      blockedSignals: [],
      treeRows: expect.arrayContaining([
        {
          key: "sample.extension.workspaceOnly",
          target: "default",
          configuredTarget: "unknown",
          commandId: "settings.filterUntrusted",
          query: "@tag:requireTrustedWorkspace",
          stateSource: "IWorkbenchConfigurationService.restrictedSettings",
        },
        {
          key: "sample.extension.workspaceOnly",
          target: "workspace",
          configuredTarget: "workspace",
          commandId: "settings.filterUntrusted",
          query: "@tag:requireTrustedWorkspace",
          stateSource: "IWorkbenchConfigurationService.restrictedSettings",
        },
      ]),
      filterUntrustedCommand: {
        commandId: "settings.filterUntrusted",
        status: "available",
        vscodeContract: "IPreferencesService.openWorkspaceSettings",
        options: {
          jsonEditor: false,
          query: "@tag:requireTrustedWorkspace",
        },
      },
    })
    expect(service.getTrustSnapshot().capabilities.requestService.editorPane.settingsTree).toMatchObject({
      owner: "SettingsTree",
      status: "partial",
      rowModelSource: "IWorkbenchConfigurationService.restrictedSettings",
      query: "@tag:requireTrustedWorkspace",
      rowCount: 2,
      coveredSignals: expect.arrayContaining([
        "restricted settings row keys",
        "restricted settings configured target",
        "settings.filterUntrusted query",
        "SettingsTreeIndicatorsLabel workspace trust indicator",
        "SettingsTreeModel.updateWorkspaceTrust",
        "no second configuration state source",
      ]),
      blockedSignals: expect.arrayContaining([
        "SettingsTree DOM owner",
        "WorkbenchObjectTree/ListService owner",
      ]),
      indicatorOwner: "SettingsTreeIndicatorsLabel",
      indicatorCommandId: "workbench.trust.manage",
      modelTrustUpdateSignal: "SettingsTreeModel.updateWorkspaceTrust",
    })

    registration.dispose()
  })

  it("opens Workspace Trust settings through the VS Code configure command projection", async () => {
    registerExtensionTrustRemoteAuthWorkbenchContributions()

    const executed = await executeCommand(WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Configure)

    expect(executed).toBe(true)
    const snapshot = globalWorkspaceTrustManagementService.getTrustSnapshot().capabilities.requestService
    expect(snapshot).toMatchObject({
      uiOwners: {
        configureSettings: {
          status: "available",
          owner: "WorkspaceTrustSettings",
        },
        manageEditor: {
          status: "available",
          owner: "WorkspaceTrustEditor",
        },
      },
      configureSettingsShell: {
        owner: "WorkspaceTrustSettings",
        status: "registered",
        serviceId: "workbenchLayoutSettingsShell",
        stateSource: "IPreferencesService.openUserSettings+CodekSettingsShell",
        settingTag: "workspaceTrust",
        query: "@tag:workspaceTrust",
        settingsSection: "vscode-settings",
        latestOpenRequest: {
          commandId: "workbench.trust.configure",
          vscodeContract: "IPreferencesService.openUserSettings",
          options: {
            jsonEditor: false,
            query: "@tag:workspaceTrust",
          },
          opened: true,
        },
        openRequestCount: 1,
      },
      entrypoints: {
        status: "available",
      },
      missingEntrypointCommandIds: [],
      constraints: {
        noSecondRequestStore: true,
        fullWorkspaceTrustEditorPaneNotImplemented: true,
      },
    })
    expect(snapshot.entrypointCommandIds).toEqual(expect.arrayContaining([
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage,
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Configure,
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Open,
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Allow,
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Deny,
    ]))
    expect(snapshot.uiOwners.configureSettings.reason).toContain("IPreferencesService.openUserSettings")
    expect(snapshot.configureSettingsShell.reason).toContain("@tag:workspaceTrust")
    expect(JSON.stringify(snapshot)).not.toContain("SourceMirror")
  })

  it("routes Workspace Trust configure requests to the registered Codek settings shell", async () => {
    const service = new WorkspaceTrustWorkbenchService()
    const opened: unknown[] = []
    const registration = service.registerWorkspaceTrustConfigureSettingsShell((request) => {
      opened.push(request)
    })

    const request = service.openWorkspaceTrustConfigureSettings()

    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({
      commandId: "workbench.trust.configure",
      options: {
        jsonEditor: false,
        query: "@tag:workspaceTrust",
      },
      settingsSection: "vscode-settings",
      opened: true,
    })
    expect(request).toMatchObject({
      opened: true,
      options: { query: "@tag:workspaceTrust" },
    })
    expect(service.getTrustSnapshot().capabilities.requestService.configureSettingsShell).toMatchObject({
      status: "registered",
      latestOpenRequest: {
        opened: true,
      },
      openRequestCount: 1,
    })

    registration.dispose()
    const blocked = service.openWorkspaceTrustConfigureSettings()
    expect(blocked.opened).toBe(false)
    expect(service.getTrustSnapshot().capabilities.requestService.configureSettingsShell).toMatchObject({
      status: "notRegistered",
      latestOpenRequest: {
        opened: false,
      },
      openRequestCount: 2,
    })
  })

  it("records workspace trust allow/deny evidence while preserving the existing policy boundary", async () => {
    registerExtensionTrustRemoteAuthWorkbenchContributions()

    await executeCommand(WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Allow, ["D:/Workspace"])
    await executeCommand(WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Deny, ["D:/Workspace"])

    const snapshot = globalWorkspaceTrustManagementService.getTrustSnapshot()
    expect(snapshot).toMatchObject({
      serviceId: "workspaceTrustManagementService",
      stateSource: "workspaceTrustRoutes+agentPolicy",
      status: "restricted",
      trusted: false,
      decisionCount: 2,
      latestDecision: {
        root: "D:/Workspace",
        status: "restricted",
        decision: "deny",
        persisted: true,
      },
      constraints: {
        noSecondTrustStore: true,
        preservesAgentPolicyGate: true,
      },
    })
    expect(api.post).toHaveBeenCalledWith("/workspace/trust", {
      root: "D:/Workspace",
      status: "trusted",
      trustedFolders: [],
    })
    expect(api.post).toHaveBeenCalledWith("/workspace/trust", {
      root: "D:/Workspace",
      status: "restricted",
      trustedFolders: [],
    })
  })

  it("records remote authority success, failure and cached resolve evidence from RemoteManager", async () => {
    const manager = getRemoteManager()
    const connectSpy = vi.spyOn(manager, "connect")
      .mockResolvedValueOnce({
        id: "remote-1",
        type: "wsl",
        label: "WSL: Ubuntu",
        state: "connected",
        config: { host: "wsl", port: 0, username: "", authType: "password" },
      })
      .mockRejectedValueOnce(new Error("resolver offline"))

    const success = await globalRemoteAuthorityResolverService.resolveAuthority("wsl+Ubuntu", { type: "wsl", target: "Ubuntu" })
    const cached = await globalRemoteAuthorityResolverService.resolveAuthority("wsl+Ubuntu")
    const failure = await globalRemoteAuthorityResolverService.resolveAuthority("ssh-remote+prod", {
      type: "ssh",
      sshConfig: { host: "prod.example.test", port: 22, username: "dev", authType: "password", password: "redacted" },
    })

    expect(connectSpy).toHaveBeenCalledTimes(2)
    expect(success.status).toBe("resolved")
    expect(cached.cacheHit).toBe(true)
    expect(failure).toMatchObject({ status: "error", error: "resolver offline" })
    expect(globalRemoteAuthorityResolverService.getRemoteAuthoritySnapshot()).toMatchObject({
      serviceId: "remoteAuthorityResolverService",
      stateSource: "remoteManager",
      resolveCount: 3,
      successCount: 2,
      failureCount: 1,
      cacheHitCount: 1,
      latestResult: {
        authority: "ssh-remote+prod",
        status: "error",
      },
      constraints: {
        noSecondRemoteState: true,
        noCredentialPersistence: true,
      },
    })
  })

  it("projects authentication session missing, pending, authorized, expired, revoked and error evidence without storing tokens", () => {
    const service = globalAuthenticationService
    service.observeCodekAuthState()
    auth.loading = true
    auth.oauthStatus = "pending"
    auth.oauthProvider = "github"
    auth.githubDeviceFlow.active = true
    auth.githubDeviceFlow.userCode = "ABCD-EFGH"
    auth.githubDeviceFlow.verificationUri = "https://github.com/login/device"
    service.observeCodekAuthState()
    auth.isLoggedIn = true
    auth.token = "secret-token"
    auth.username = "codek-user"
    auth.email = "codek@example.test"
    auth.loading = false
    auth.oauthStatus = "success"
    service.observeCodekAuthState()
    auth.isLoggedIn = false
    auth.token = ""
    auth.oauthStatus = "expired"
    auth.loginError = "GitHub 验证码已过期，请重新登录"
    auth.loginErrorCode = "expired"
    service.observeCodekAuthState()
    service.revokeSession("github", "codek-user")
    auth.loginError = "network failed"
    auth.loginErrorCode = "network"
    auth.oauthStatus = "error"
    service.observeCodekAuthState()

    const snapshot = service.getAuthenticationSnapshot()
    expect(snapshot.statuses).toEqual(expect.arrayContaining(["missing", "pending", "authorized", "expired", "revoked", "error"]))
    expect(snapshot.sessions.some((session) => session.status === "expired")).toBe(true)
    expect(snapshot.latestSession).toMatchObject({
      providerId: "github",
      status: "error",
      error: "network failed",
    })
    expect(snapshot.hasToken).toBe(false)
    expect(JSON.stringify(snapshot)).not.toContain("secret-token")
    expect(snapshot.constraints).toMatchObject({
      noTokenInEvidence: true,
      noSecondAuthStore: true,
      sharesMcpOAuthSessionBoundary: true,
    })
  })

  it("records extension activation evidence through the EH activation route", async () => {
    const service = new ExtensionHostWorkbenchService()

    const evidence = await service.activateByEvent("onCommand:codek.test", "sample.extension")

    expect(ehClient.activateExtensionHostByEvent).toHaveBeenCalledWith("onCommand:codek.test", "sample.extension")
    expect(evidence).toMatchObject({
      serviceId: "extensionHostService",
      stateSource: "extensionsWorkbenchService+ehClient",
      activationEvent: "onCommand:codek.test",
      extensionId: "sample.extension",
      status: "activated",
    })
    expect(service.getExtensionHostSnapshot()).toMatchObject({
      activationCount: 1,
      latestActivation: {
        activationEvent: "onCommand:codek.test",
        extensionId: "sample.extension",
      },
      constraints: {
        noSecondExtensionRuntime: true,
        preservesExtensionGalleryState: true,
      },
    })
  })

  it("records error evidence when EH activation fails", async () => {
    vi.mocked(ehClient.activateExtensionHostByEvent).mockResolvedValueOnce({
      success: false,
      error: "Extension host not running",
      evidence: {
        serviceId: "extensionHostService",
        stateSource: "extensionsWorkbenchService+ehClient",
        activationEvent: "onView:codek.extensionHost.surface",
        extensionId: "sample.extension",
        status: "error",
        createdAt: Date.now(),
        error: "Extension host not running",
      },
    })
    const service = new ExtensionHostWorkbenchService()

    const evidence = await service.activateByEvent("onView:codek.extensionHost.surface", "sample.extension")

    expect(evidence).toMatchObject({
      activationEvent: "onView:codek.extensionHost.surface",
      extensionId: "sample.extension",
      status: "error",
      error: "Extension host not running",
    })
    expect(service.getExtensionHostSnapshot().latestActivation).toMatchObject({
      status: "error",
      error: "Extension host not running",
    })
  })

  it("rolls all four surfaces into a single workbench snapshot for real UI evidence", async () => {
    registerExtensionTrustRemoteAuthWorkbenchContributions()
    await executeCommand(EXTENSION_HOST_WORKBENCH_COMMAND_IDS.ActivatePlaceholder, ["onStartupFinished", "codek.placeholder"])
    await executeCommand(WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Allow, ["D:/Workspace"])
    await executeCommand(AUTHENTICATION_WORKBENCH_COMMAND_IDS.RequestSession, ["github", "repo"])
    await globalRemoteAuthorityResolverService.resolveAuthority("wsl+Ubuntu", { type: "wsl", target: "Ubuntu" })

    const snapshot = getExtensionTrustRemoteAuthWorkbenchSurfaceSnapshot()

    expect(snapshot).toMatchObject({
      source: "extensionTrustRemoteAuthWorkbenchService",
      containerId: EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.Container,
      serviceIds: {
        extensionHost: "extensionHostService",
        workspaceTrust: "workspaceTrustManagementService",
        workspaceTrustEnablement: "workspaceTrustEnablementService",
        remoteAuthority: "remoteAuthorityResolverService",
        authentication: "IAuthenticationService",
      },
      constraints: {
        noSecondExtensionRuntime: true,
        noSecondTrustStore: true,
        noSecondRemoteState: true,
        noSecondAuthStore: true,
        preservesAgentEvidence: true,
      },
    })
    expect(snapshot.commandIds).toEqual(expect.arrayContaining([
      EXTENSION_HOST_WORKBENCH_COMMAND_IDS.ActivatePlaceholder,
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Allow,
      REMOTE_AUTHORITY_WORKBENCH_COMMAND_IDS.Resolve,
      AUTHENTICATION_WORKBENCH_COMMAND_IDS.RequestSession,
    ]))
  })

  it("cleans contribution registrations without clearing underlying evidence", async () => {
    const disposable = registerExtensionTrustRemoteAuthWorkbenchContributions()
    await executeCommand(WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Allow, ["D:/Workspace"])

    disposable.dispose()

    expect(getCommand(WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Allow)).toBeNull()
    expect(globalWorkspaceTrustManagementService.getTrustSnapshot().decisionCount).toBe(1)
  })

  it("can use a scoped workspace trust service for focused tests", async () => {
    const service = new WorkspaceTrustWorkbenchService()

    await service.setWorkspaceTrust("D:/Workspace", "trusted")

    expect(service.getTrustSnapshot()).toMatchObject({
      serviceId: "workspaceTrustManagementService",
      status: "trusted",
      trusted: true,
      decisionCount: 1,
      latestDecision: {
        persisted: true,
      },
    })
  })

  it("falls back to evidence-only workspace trust state when the backend trust route is unavailable", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("Codek API not available"))
    const service = new WorkspaceTrustWorkbenchService()

    const decision = await service.setWorkspaceTrust("D:/Workspace", "restricted")

    expect(decision).toMatchObject({
      root: "D:/Workspace",
      status: "restricted",
      decision: "deny",
      persisted: false,
      persistError: "Codek API not available",
    })
    expect(service.getTrustSnapshot()).toMatchObject({
      status: "restricted",
      latestDecision: {
        persisted: false,
        persistError: "Codek API not available",
      },
    })
  })

  it("keeps the requested trust decision when the backend route succeeds without echoing status", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ trust: {} })
    const service = new WorkspaceTrustWorkbenchService()

    const decision = await service.setWorkspaceTrust("D:/Workspace", "trusted")

    expect(decision).toMatchObject({
      status: "trusted",
      decision: "allow",
      trusted: true,
      persisted: true,
    })
    expect(service.getTrustSnapshot()).toMatchObject({
      status: "trusted",
      trusted: true,
    })
  })

  it("projects workspace trust pending requests before allow or deny completion", async () => {
    const service = new WorkspaceTrustWorkbenchService()

    const pending = await service.requestWorkspaceTrust("D:/Workspace")
    const allow = await service.completeWorkspaceTrustRequest(true)
    const deny = await service.completeWorkspaceTrustRequest(false)

    expect(pending).toMatchObject({
      root: "D:/Workspace",
      status: "pending",
      decision: "pending",
      trusted: false,
    })
    expect(allow).toMatchObject({ status: "trusted", decision: "allow", trusted: true })
    expect(deny).toMatchObject({ status: "restricted", decision: "deny", trusted: false })
    expect(service.getTrustSnapshot()).toMatchObject({
      status: "restricted",
      decisionCount: 3,
      pendingRequest: false,
      latestDecision: {
        decision: "deny",
      },
      constraints: {
        noSecondTrustStore: true,
        preservesAgentPolicyGate: true,
      },
    })
  })

  it("tracks trusted folders, resource requests and restricted capabilities from the single trust facade", async () => {
    const service = new WorkspaceTrustWorkbenchService()

    const request = await service.requestResourcesTrust({
      uri: "file:///D:/Workspace/tools",
      message: "工具目录需要信任后才能执行",
    })
    expect(request).toBeUndefined()

    await service.completeResourcesTrustRequest("file:///D:/Workspace/tools", "open")
    await service.setUrisTrust(["file:///D:/Workspace/docs"], true)
    await service.setUrisTrust(["file:///D:/Workspace/docs"], true)
    await service.setUrisTrust(["file:///D:/Workspace/tools"], false)
    const openFiles = await service.requestOpenFilesTrust(["file:///D:/external/a.ts"])
    await service.completeOpenFilesTrustRequest("openInNewWindow", true)
    const startup = service.requestWorkspaceTrustOnStartup("D:/Workspace")
    await service.setWorkspaceTrust("D:/Workspace", "restricted")

    const snapshot = service.getTrustSnapshot()
    expect(openFiles).toBe("pending")
    expect(startup.status).toBe("pending")
    expect(snapshot).toMatchObject({
      status: "restricted",
      trustedFolders: ["file:///D:/Workspace/docs"],
      acceptsOutOfWorkspaceFiles: false,
      requestLifecycle: {
        workspaceRequestActive: false,
        resourceRequestCount: 1,
        openFilesRequestCount: 1,
        startupRequestCount: 1,
        latestRequest: {
          kind: "startup",
          status: "completed",
          result: "restricted",
        },
      },
      restrictedMode: {
        enabled: true,
        canExecuteCommands: false,
        canUseNetwork: false,
        canInstallExtensions: false,
        canWriteWorkspaceFiles: false,
      },
      capabilities: {
        requestWorkspaceTrust: true,
        trustedFolders: true,
        resourceTrustRequests: true,
        restrictedMode: true,
        requestService: {
          vscodeServiceId: "workspaceTrustRequestService",
          codekOwnerServiceId: "workspaceTrustManagementService",
          requestOpen: {
            status: "available",
          },
          complete: {
            status: "available",
          },
          pending: {
            status: "available",
          },
          modalUi: {
            status: "blocked",
          },
          uiOwners: {
            workspaceRequestDialog: {
              status: "blocked",
              owner: "WorkspaceTrustRequestHandler",
            },
            startupModal: {
              status: "blocked",
              owner: "WorkspaceTrustUXHandler",
            },
            banner: {
              status: "available",
              owner: "WorkspaceTrustUXHandler",
            },
            statusbar: {
              status: "available",
              owner: "WorkspaceTrustUXHandler",
            },
            manageEditor: {
              status: "blocked",
              owner: "WorkspaceTrustEditor",
            },
          },
          entrypoints: {
            status: "partial",
          },
          contextKeys: {
            status: "available",
          },
          activeRequestCount: 0,
          totalRequestCount: 3,
          entrypointCommandIds: [
            WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage,
            WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Configure,
            WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Open,
            WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Allow,
            WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Deny,
          ],
          missingEntrypointCommandIds: [
            WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage,
            WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Configure,
          ],
          contextKeyIds: [
            WORKSPACE_TRUST_CONTEXT_KEYS.IsEnabled,
            WORKSPACE_TRUST_CONTEXT_KEYS.IsTrusted,
            WORKSPACE_TRUST_CONTEXT_KEYS.LegacyTrusted,
          ],
          missingContextKeyIds: [
            "config.security.workspace.trust.enabled",
            "security.workspace.trust.startupPrompt",
            "security.workspace.trust.untrustedFiles",
          ],
          editorPane: {
            status: "blocked",
            trustedUrisTable: {
              status: "blocked",
              stateSource: "WorkspaceTrustWorkbenchService",
              trustedFolderCount: 1,
              trustedFoldersEventCount: 3,
              blockedSignals: ["WorkspaceTrustEditorInput pinned open request"],
            },
            affectedFeaturesList: {
              status: "blocked",
              restrictedModeEnabled: true,
              disabledByTrustRequirementCount: 0,
            },
          },
          constraints: {
            noSecondRequestStore: true,
            modalUiNotImplemented: true,
            requestLifecycleEvidenceOnly: true,
          },
        },
      },
    })
  })

  it("keeps WorkspaceTrustRequestService modal ownership explicit without claiming full VS Code UI", async () => {
    const service = new WorkspaceTrustWorkbenchService()

    service.requestWorkspaceTrustOnStartup("D:/Workspace")
    await service.requestOpenFilesTrust(["file:///D:/external/loose.ts"])
    await service.requestResourcesTrust({
      uri: "file:///D:/external/project",
      message: "资源需要工作区信任",
    })

    const snapshot = service.getTrustSnapshot()
    expect(snapshot.pendingRequest).toBe(true)
    expect(snapshot.capabilities.requestService).toMatchObject({
      stateSource: "workspaceTrustRoutes+agentPolicy",
      vscodeServiceId: "workspaceTrustRequestService",
      codekOwnerServiceId: "workspaceTrustManagementService",
      requestOpen: {
        status: "available",
        owner: "WorkspaceTrustWorkbenchService",
      },
      complete: {
        status: "available",
        owner: "WorkspaceTrustWorkbenchService",
      },
      pending: {
        status: "available",
        owner: "WorkspaceTrustWorkbenchService",
      },
      modalUi: {
        status: "blocked",
        owner: "WorkspaceTrustRequestHandler",
      },
      uiOwners: {
        workspaceRequestDialog: {
          status: "blocked",
          owner: "WorkspaceTrustRequestHandler",
        },
        openFilesDialog: {
          status: "blocked",
          owner: "WorkspaceTrustRequestHandler",
        },
        resourcesDialog: {
          status: "blocked",
          owner: "WorkspaceTrustRequestHandler",
        },
        startupModal: {
          status: "blocked",
          owner: "WorkspaceTrustUXHandler",
        },
        banner: {
          status: "available",
          owner: "WorkspaceTrustUXHandler",
        },
        statusbar: {
          status: "available",
          owner: "WorkspaceTrustUXHandler",
        },
        manageEditor: {
          status: "blocked",
          owner: "WorkspaceTrustEditor",
        },
      },
      entrypoints: {
        status: "partial",
      },
      contextKeys: {
        status: "available",
      },
      activeRequestCount: 2,
      totalRequestCount: 3,
      latestRequest: {
        kind: "resources",
        status: "pending",
        uri: "file:///D:/external/project",
      },
      constraints: {
        noSecondRequestStore: true,
        modalUiNotImplemented: true,
        requestLifecycleEvidenceOnly: true,
      },
      editorPane: {
        owner: "WorkspaceTrustEditor",
        status: "blocked",
        paneOwnerStatus: "blocked",
        trustStore: "WorkspaceTrustWorkbenchService",
        covered: {
          singletonInput: false,
          pinnedOpenRequest: false,
          noSecondTrustStore: true,
        },
      },
      startupPolicy: {
        owner: "WorkspaceTrustUXHandler",
        status: "partial",
        stateSource: "workspaceTrustRoutes+agentPolicy",
        requestLifecycleSource: "WorkspaceTrustWorkbenchService.requestLifecycle",
        dialogShellStatus: "notRegistered",
        trustStore: "WorkspaceTrustWorkbenchService",
        hostFocus: {
          status: "available",
          owner: "IHostService",
          serviceId: "hostService",
          vscodeServiceId: "IHostService",
          requiredContracts: ["hasFocus", "onDidChangeFocus"],
          exploredCodekFacades: expect.arrayContaining([
            expect.objectContaining({
              facade: "WorkbenchLayoutService.hasFocus(part)",
              ownerStatus: "notApplicable",
            }),
            expect.objectContaining({
              facade: "Codek window/app focus service",
              ownerStatus: "available",
            }),
          ]),
          availableSignals: expect.arrayContaining([
            expect.objectContaining({
              source: "renderer",
              facade: "CodekWindowHostFocusService",
              provides: expect.arrayContaining(["hostFocusState", "focusChangeEvent"]),
              missingForHostService: [],
            }),
            expect.objectContaining({
              source: "renderer",
              facade: "App.vue window blur autosave listener",
              provides: ["blurEvent"],
              missingForHostService: ["hasFocus", "onDidChangeFocus"],
            }),
            expect.objectContaining({
              source: "desktop",
              facade: "desktop/main.js collectProcessSummary BrowserWindow.isFocused()",
              provides: ["currentFocusSnapshot"],
              missingForHostService: ["onDidChangeFocus"],
            }),
            expect.objectContaining({
              source: "smoke",
              facade: "desktop/main.js bringSmokeWindowToForeground",
              provides: ["foregroundFocusResult"],
              missingForHostService: ["hasFocus", "onDidChangeFocus"],
            }),
          ]),
          requiredServiceContract: {
            serviceId: "hostService",
            owner: "CodekHostFocusService",
            currentState: "available",
            hasFocus: "available",
            onDidChangeFocus: "available",
            minimumAdapter: "document.hasFocus/window focus-blur or Electron BrowserWindow focus/blur bridged through preload",
            noSyntheticFocus: true,
          },
          covered: {
            startupRequestEvidence: true,
            dialogShell: false,
          },
          blocked: {
            hostFocusState: false,
            focusChangeEvent: false,
          },
        },
        storagePolicy: {
          status: "partial",
          owner: "IStorageService",
          serviceId: "storageService",
          vscodeServiceId: "IStorageService",
          startupPromptShownKey: "workspace.trust.startupPrompt.shown",
          bannerDismissedKey: "workbench.banner.restrictedMode.dismissed",
          storageScope: "WORKSPACE",
          storageTarget: "MACHINE",
          covered: {
            bannerDismissalEvidence: true,
            startupPromptRequestEvidence: true,
            persistedStartupPromptShown: true,
            persistedBannerDismissal: true,
          },
          blocked: {
            fullStartupPolicyCompletion: true,
          },
        },
        covered: {
          startupRequestEvidence: true,
          dialogShell: false,
          statusbarIndicator: true,
          restrictedModeBanner: true,
          noSecondTrustStore: true,
        },
      },
    })
    expect(snapshot.requestLifecycle.requests.find((request) => request.kind === "startup")).toMatchObject({
      kind: "startup",
      status: "cancelled",
      message: "skipped:security.workspace.trust.startupPrompt=once",
    })
    expect(snapshot.capabilities.requestService.vscodeOwnerAudit).toMatchObject({
      requestHandlerOwner: "WorkspaceTrustRequestHandler",
      uxHandlerOwner: "WorkspaceTrustUXHandler",
      editorOwner: "WorkspaceTrustEditor",
      contextKeysOwner: "WorkspaceTrustContextKeys",
    })
    expect(snapshot.capabilities.requestService.vscodeOwnerAudit.sourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts",
      "src/vs/workbench/contrib/workspace/browser/workspaceTrustEditor.ts",
      "src/vs/workbench/contrib/workspace/common/workspace.ts",
    ]))
    expect(snapshot.capabilities.requestService.modalUi.reason).toContain("missing Codek workbench dialog shell owner")
    expect(snapshot.capabilities.requestService.uiOwners.startupModal.reason).toContain("host focus, storage, configuration and dialog services")
    expect(snapshot.capabilities.requestService.uiOwners.banner.reason).toContain("WorkspaceTrustBannerService")
    expect(snapshot.capabilities.requestService.uiOwners.statusbar.reason).toContain("status.workspaceTrust")
    expect(snapshot.capabilities.requestService.uiOwners.manageEditor.reason).toContain("WorkspaceTrustEditorInput")
    expect(snapshot.capabilities.requestService.entrypoints.reason).toContain("workbench.trust.manage")
    expect(snapshot.capabilities.requestService.contextKeys.reason).toContain("isWorkspaceTrustEnabled")
    expect(snapshot.capabilities.requestService.editorPane.blockedReason).toContain("full WorkspaceTrustEditor EditorPane owner remains blocked")
    expect(snapshot.capabilities.requestService.startupPolicy.blockedReason).toContain("IHostService-compatible host focus deferral")
    expect(snapshot.capabilities.requestService.startupPolicy.hostFocus.reason).toContain("CodekWindowHostFocusService")
    expect(snapshot.capabilities.requestService.startupPolicy.hostFocus.reason).toContain("without synthetic focus")
    expect(snapshot.capabilities.requestService.startupPolicy.storagePolicy.reason).toContain("CodekStorageService")
    expect(snapshot.capabilities.requestService.startupPolicy.configurationGates).toEqual([
      expect.objectContaining({
        key: "security.workspace.trust.enabled",
        status: "available",
        stateSource: "workbenchConfigurationService",
        owner: "WorkspaceTrustEnablementService",
        value: true,
      }),
      expect.objectContaining({
        key: "security.workspace.trust.startupPrompt",
        status: "partial",
        stateSource: "workbenchConfigurationService",
        owner: "WorkspaceTrustUXHandler",
        value: "once",
      }),
      expect.objectContaining({
        key: "security.workspace.trust.untrustedFiles",
        status: "partial",
        stateSource: "workbenchConfigurationService",
        owner: "WorkspaceTrustRequestHandler",
        value: "prompt",
      }),
      expect.objectContaining({
        key: "security.workspace.trust.banner",
        status: "available",
        stateSource: "workbenchConfigurationService",
        owner: "WorkspaceTrustUXHandler",
        value: "untilDismissed",
      }),
      expect.objectContaining({
        key: "security.workspace.trust.emptyWindow",
        status: "partial",
        stateSource: "workbenchConfigurationService",
        owner: "WorkspaceTrustUXHandler",
        value: true,
      }),
    ])
    expect(snapshot.capabilities.requestService.missingEntrypointCommandIds).toEqual([
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage,
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Configure,
    ])
    expect(snapshot.capabilities.requestService.contextKeyIds).toEqual([
      WORKSPACE_TRUST_CONTEXT_KEYS.IsEnabled,
      WORKSPACE_TRUST_CONTEXT_KEYS.IsTrusted,
      WORKSPACE_TRUST_CONTEXT_KEYS.LegacyTrusted,
    ])
    expect(snapshot.capabilities.requestService.missingContextKeyIds).toEqual([
      "config.security.workspace.trust.enabled",
      "security.workspace.trust.startupPrompt",
      "security.workspace.trust.untrustedFiles",
    ])
  })

  it("exposes a real IHostService-compatible focus source for Workspace Trust startup deferral", () => {
    const listeners: Record<string, Array<() => void>> = {}
    const documentListeners: Record<string, Array<() => void>> = {}
    let focused = false
    const hostWindow = {
      document: {
        hasFocus: () => focused,
        addEventListener: (type: string, listener: () => void) => {
          documentListeners[type] = [...(documentListeners[type] || []), listener]
        },
        removeEventListener: (type: string, listener: () => void) => {
          documentListeners[type] = (documentListeners[type] || []).filter((candidate) => candidate !== listener)
        },
      },
      addEventListener: (type: string, listener: () => void) => {
        listeners[type] = [...(listeners[type] || []), listener]
      },
      removeEventListener: (type: string, listener: () => void) => {
        listeners[type] = (listeners[type] || []).filter((candidate) => candidate !== listener)
      },
    }
    const service = new CodekWindowHostFocusService(hostWindow as unknown as Window)
    const changes: boolean[] = []
    service.onDidChangeFocus((event) => changes.push(event))

    expect(service.hasFocus).toBe(false)

    focused = true
    listeners.focus?.forEach((listener) => listener())
    expect(service.hasFocus).toBe(true)
    expect(changes).toEqual([true])

    focused = false
    documentListeners.visibilitychange?.forEach((listener) => listener())
    expect(service.hasFocus).toBe(false)
    expect(changes).toEqual([true, false])

    service.dispose()
    focused = true
    listeners.focus?.forEach((listener) => listener())
    expect(changes).toEqual([true, false])
  })

  it("defers Workspace Trust startup request evidence until CodekHostFocusService reports focus", async () => {
    const storageService = new CodekStorageService()
    const hostFocusService = new TestHostFocusService(false)
    const service = new WorkspaceTrustWorkbenchService(
      new WorkbenchNotificationProgressService(),
      new WorkspaceTrustBannerWorkbenchService(storageService),
      storageService,
      undefined,
      hostFocusService,
    )
    const startupRequests: string[] = []
    service.onDidInitiateWorkspaceTrustRequest((request) => {
      if (request.kind === "startup") startupRequests.push(request.message)
    })

    const request = service.requestWorkspaceTrustOnStartup("D:/Workspace")

    expect(request).toMatchObject({
      kind: "startup",
      status: "pending",
      message: "deferred:hostService.onDidChangeFocus",
    })
    expect(startupRequests).toEqual([])
    expect(service.getTrustSnapshot().capabilities.requestService.startupPolicy.hostFocus).toMatchObject({
      status: "available",
      requiredServiceContract: {
        currentState: "available",
        hasFocus: "available",
        onDidChangeFocus: "available",
      },
      blocked: {
        hostFocusState: false,
        focusChangeEvent: false,
        startupModalDeferral: false,
      },
    })

    hostFocusService.setFocus(true)
    await flushPromises()

    expect(startupRequests).toEqual(["resumed:hostService.onDidChangeFocus"])
    expect(service.getTrustSnapshot().requestLifecycle).toMatchObject({
      startupRequestCount: 1,
      latestRequest: {
        kind: "startup",
        status: "pending",
        message: "resumed:hostService.onDidChangeFocus",
      },
    })
  })

  it("gates Workspace Trust startup and open-file policy through the existing configuration service", async () => {
    const configurationStore = new SettingsStore({
      storage: new MemorySettingsStorage(),
      userKey: "workspace-trust-policy:user",
      workspaceKeyPrefix: "workspace-trust-policy:workspace:",
      workspaceFolderKeyPrefix: "workspace-trust-policy:folder:",
      unknownKey: "workspace-trust-policy:unknown",
    })
    const configurationService = new ConfigurationService(configurationStore)
    const storageService = new CodekStorageService()
    const bannerService = new WorkspaceTrustBannerWorkbenchService(storageService)
    const service = new WorkspaceTrustWorkbenchService(
      new WorkbenchNotificationProgressService(),
      bannerService,
      storageService,
      configurationService,
    )

    await configurationService.updateValue("security.workspace.trust.startupPrompt", "never")
    await configurationService.updateValue("security.workspace.trust.untrustedFiles", "newWindow")
    await configurationService.updateValue("security.workspace.trust.banner", "never")
    await configurationService.updateValue("security.workspace.trust.emptyWindow", false)

    const skippedStartup = service.requestWorkspaceTrustOnStartup("D:/Workspace")
    const openFilesDecision = await service.requestOpenFilesTrust(["file:///D:/outside/untrusted.ts"])
    await service.setWorkspaceTrust("D:/Workspace", "restricted")

    const snapshot = service.getTrustSnapshot()
    expect(skippedStartup).toMatchObject({
      kind: "startup",
      status: "cancelled",
      message: "skipped:security.workspace.trust.startupPrompt=never",
    })
    expect(openFilesDecision).toBe("openInNewWindow")
    expect(snapshot.requestLifecycle.startupRequestCount).toBe(1)
    expect(snapshot.requestLifecycle.openFilesRequestCount).toBe(0)
    expect(snapshot.startupPolicySettings).toEqual({
      enabled: true,
      startupPrompt: "never",
      untrustedFiles: "newWindow",
      banner: "never",
      emptyWindow: false,
    })
    expect(snapshot.capabilities.requestService.startupPolicy.configurationGates).toEqual([
      expect.objectContaining({
        key: "security.workspace.trust.enabled",
        status: "available",
        stateSource: "workbenchConfigurationService",
        value: true,
      }),
      expect.objectContaining({
        key: "security.workspace.trust.startupPrompt",
        status: "partial",
        stateSource: "workbenchConfigurationService",
        value: "never",
      }),
      expect.objectContaining({
        key: "security.workspace.trust.untrustedFiles",
        status: "partial",
        stateSource: "workbenchConfigurationService",
        value: "newWindow",
      }),
      expect.objectContaining({
        key: "security.workspace.trust.banner",
        status: "available",
        stateSource: "workbenchConfigurationService",
        value: "never",
      }),
      expect.objectContaining({
        key: "security.workspace.trust.emptyWindow",
        status: "partial",
        stateSource: "workbenchConfigurationService",
        value: false,
      }),
    ])
    expect(snapshot.capabilities.requestService.startupPolicy.hostFocus).toMatchObject({
      status: "available",
      owner: "IHostService",
      serviceId: "hostService",
      vscodeServiceId: "IHostService",
      requiredContracts: ["hasFocus", "onDidChangeFocus"],
      requiredServiceContract: {
        owner: "CodekHostFocusService",
        currentState: "available",
        hasFocus: "available",
        onDidChangeFocus: "available",
        noSyntheticFocus: true,
      },
      blocked: {
        hostFocusState: false,
        focusChangeEvent: false,
      },
    })
    expect(snapshot.capabilities.requestService.startupPolicy.blockedReason).toContain("IHostService-compatible host focus deferral")
    expect(snapshot.capabilities.requestService.startupPolicy.hostFocus.availableSignals.map((signal) => signal.facade)).toEqual([
      "CodekWindowHostFocusService",
      "App.vue window blur autosave listener",
      "desktop/main.js collectProcessSummary BrowserWindow.isFocused()",
      "desktop/main.js bringSmokeWindowToForeground",
    ])
    expect(bannerService.getBannerItem(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID)).toMatchObject({
      visible: false,
      dismissed: false,
    })

    await service.completeOpenFilesTrustRequest("open", true)
    expect(configurationService.getValue("security.workspace.trust.untrustedFiles")).toBe("open")
  })

  it("owns the VS Code-style workspace trust statusbar entry through the Codek statusbar service", async () => {
    const statusbarService = new WorkbenchNotificationProgressService()
    const service = new WorkspaceTrustWorkbenchService(statusbarService)

    expect(statusbarService.getStatusbarEntries()).toEqual([])

    await service.setWorkspaceTrust("D:/Workspace", "restricted")

    expect(statusbarService.getStatusbarEntries()).toMatchObject([
      {
        id: "status.workspaceTrust",
        name: "工作区信任",
        text: "受限模式",
        command: WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage,
        kind: "prominent",
        source: "WorkspaceTrustUXHandler",
        alignment: WorkbenchStatusbarAlignment.LEFT,
        priority: Number.POSITIVE_INFINITY,
        visible: true,
      },
    ])
    expect(service.getTrustSnapshot().capabilities.requestService).toMatchObject({
      uiOwners: {
        statusbar: {
          status: "available",
          owner: "WorkspaceTrustUXHandler",
        },
      },
      statusbar: {
        serviceId: "statusbarService",
        stateSource: "WorkbenchStatusbarService",
        entryId: "status.workspaceTrust",
        owner: "WorkspaceTrustUXHandler",
        status: "available",
        visible: true,
      },
      missingEntrypointCommandIds: [
        WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage,
        WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Configure,
      ],
    })
    expect(service.getTrustSnapshot().capabilities.requestService.statusbar.reason).toContain("App.vue statusbar renderer")

    await service.setWorkspaceTrust("D:/Workspace", "trusted")

    expect(statusbarService.getStatusbarEntries()).toEqual([])
    expect(service.getTrustSnapshot().capabilities.requestService.statusbar).toMatchObject({
      status: "available",
      visible: false,
    })

    await service.setWorkspaceTrust("D:/Workspace", "pending")
    expect(statusbarService.getStatusbarEntries().map((entry) => entry.id)).toEqual(["status.workspaceTrust"])
    service.clearEvidence()
    expect(statusbarService.getStatusbarEntries()).toEqual([])
  })

  it("owns the VS Code restricted-mode banner through a Codek banner shell adapter", async () => {
    const statusbarService = new WorkbenchNotificationProgressService()
    const storageService = new CodekStorageService({ workspaceId: "workspace-trust-banner" })
    const bannerService = new WorkspaceTrustBannerWorkbenchService(storageService)
    const service = new WorkspaceTrustWorkbenchService(statusbarService, bannerService)
    const bannerEvents: Array<{ visible: boolean; dismissed: boolean }> = []
    bannerService.onDidChangeBanner((item) => {
      bannerEvents.push({ visible: item.visible, dismissed: item.dismissed })
    })

    expect(bannerService.getBannerItem(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID)).toMatchObject({
      id: WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID,
      owner: "WorkspaceTrustUXHandler",
      serviceId: "bannerService",
      stateSource: "WorkspaceTrustBannerService+CodekStorageService",
      visible: false,
      dismissed: false,
    })

    await service.setWorkspaceTrust("D:/Workspace", "restricted")

    expect(bannerService.getBannerItem(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID)).toMatchObject({
      id: WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID,
      owner: "WorkspaceTrustUXHandler",
      visible: true,
      dismissed: false,
      message: "当前处于受限模式，仅适合安全浏览代码。信任当前工作区后可启用全部功能。",
      actions: [
        { label: "管理", href: `command:${WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage}` },
        { label: "了解更多", href: "https://aka.ms/vscode-workspace-trust" },
      ],
    })
    expect(service.getTrustSnapshot().capabilities.requestService).toMatchObject({
      uiOwners: {
        banner: {
          status: "available",
          owner: "WorkspaceTrustUXHandler",
        },
      },
      banner: {
        id: WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID,
        serviceId: "bannerService",
        stateSource: "WorkspaceTrustBannerService",
        visible: true,
      },
      missingEntrypointCommandIds: [
        WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage,
        WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Configure,
      ],
    })
    expect(service.getTrustSnapshot().capabilities.requestService.uiOwners.banner.reason).toContain("IBannerService.show/hide")
    expect(bannerEvents.at(-1)).toEqual({ visible: true, dismissed: false })

    await service.setWorkspaceTrust("D:/Workspace", "trusted")
    expect(bannerService.getBannerItem(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID)).toMatchObject({
      visible: false,
      dismissed: false,
    })
    expect(bannerEvents.at(-1)).toEqual({ visible: false, dismissed: false })

    await service.setWorkspaceTrust("D:/Workspace", "restricted")
    bannerService.dismiss(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID)
    expect(storageService.getBoolean("workbench.banner.restrictedMode.dismissed", StorageScope.WORKSPACE)).toBe(true)
    expect(storageService.keys(StorageScope.WORKSPACE, StorageTarget.MACHINE)).toContain("workbench.banner.restrictedMode.dismissed")
    expect(service.getTrustSnapshot().capabilities.requestService.banner).toMatchObject({
      visible: false,
      dismissed: true,
    })
    expect(bannerEvents.at(-1)).toEqual({ visible: false, dismissed: true })

    const restoredBannerService = new WorkspaceTrustBannerWorkbenchService(storageService)
    expect(restoredBannerService.isDismissed(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID)).toBe(true)
    expect(restoredBannerService.getBannerItem(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID)).toMatchObject({
      visible: false,
      dismissed: true,
      stateSource: "WorkspaceTrustBannerService+CodekStorageService",
    })

    await service.setWorkspaceTrust("D:/Workspace", "pending")
    expect(bannerService.getBannerItem(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID)).toMatchObject({
      visible: false,
      dismissed: true,
    })

    service.clearEvidence()
    expect(bannerService.getBannerItem(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID)).toMatchObject({
      visible: false,
      dismissed: false,
    })
  })

  it("keeps trust snapshots side-effect free for Vue render projections", async () => {
    const statusbarService = new WorkbenchNotificationProgressService()
    const storageService = new CodekStorageService({ workspaceId: "workspace-trust-pure-snapshot" })
    const bannerService = new WorkspaceTrustBannerWorkbenchService(storageService)
    const service = new WorkspaceTrustWorkbenchService(statusbarService, bannerService)
    const bannerEvents: Array<{ visible: boolean; dismissed: boolean }> = []
    bannerService.onDidChangeBanner((item) => {
      bannerEvents.push({ visible: item.visible, dismissed: item.dismissed })
    })

    await service.setWorkspaceTrust("D:/Workspace", "restricted")
    expect(bannerEvents.length).toBe(1)
    expect(statusbarService.getStatusbarEntries().map((entry) => entry.id)).toEqual(["status.workspaceTrust"])

    const firstSnapshot = service.getTrustSnapshot()
    const secondSnapshot = service.getTrustSnapshot()

    expect(firstSnapshot.status).toBe("restricted")
    expect(secondSnapshot.status).toBe("restricted")
    expect(bannerEvents.length).toBe(1)
    expect(statusbarService.getStatusbarEntries().map((entry) => entry.id)).toEqual(["status.workspaceTrust"])
  })

  it("wires WorkspaceTrustRequestHandler requests to the Codek dialog service without adding a second trust store", async () => {
    let idCounter = 0
    const service = new WorkspaceTrustWorkbenchService()
    const dialogService = new CodekDialogService({
      now: () => 1700000000000,
      createId: (prefix) => `${prefix}-${idCounter++}`,
    })
    const registration = service.registerWorkspaceTrustDialogShell(dialogService)

    const workspaceRequest = service.requestWorkspaceTrust("D:/Workspace")
    expect(dialogService.getActiveDialog()).toMatchObject({
      id: "dialog-0",
      kind: "prompt",
      source: "WorkspaceTrustRequestHandler",
      message: "是否信任此工作区内文件的作者？",
      buttons: [
        { index: 0, label: "信任工作区并继续", isCancel: false },
        { index: 1, label: "以受限模式继续", isCancel: false },
        { index: 2, label: "管理", isCancel: false },
        { index: 3, label: "取消", isCancel: true },
      ],
      evidenceContext: {
        workspaceFolder: "D:/Workspace",
        commandId: "workbench.trust.request",
      },
    })
    expect(service.getTrustSnapshot().capabilities.requestService).toMatchObject({
      modalUi: {
        status: "available",
        owner: "WorkspaceTrustRequestHandler",
      },
      uiOwners: {
        workspaceRequestDialog: {
          status: "available",
          owner: "WorkspaceTrustRequestHandler",
        },
        openFilesDialog: {
          status: "available",
          owner: "WorkspaceTrustRequestHandler",
        },
        resourcesDialog: {
          status: "available",
          owner: "WorkspaceTrustRequestHandler",
        },
        startupModal: {
          status: "partial",
          owner: "WorkspaceTrustUXHandler",
        },
        banner: {
          status: "available",
          owner: "WorkspaceTrustUXHandler",
        },
        statusbar: {
          status: "available",
          owner: "WorkspaceTrustUXHandler",
        },
        manageEditor: {
          status: "blocked",
          owner: "WorkspaceTrustEditor",
        },
      },
      dialogShell: {
        status: "registered",
        serviceId: "dialogService",
        stateSource: "CodekDialogService",
        handles: ["workspaceRequestDialog", "startupRequestDialog", "openFilesDialog", "resourcesDialog"],
      },
      constraints: {
        noSecondRequestStore: true,
        modalUiNotImplemented: false,
        requestLifecycleEvidenceOnly: true,
      },
    })

    dialogService.resolveActiveDialog({ buttonIndex: 0 })
    await expect(workspaceRequest).resolves.toMatchObject({
      status: "trusted",
      decision: "allow",
      trusted: true,
    })
    await Promise.resolve()
    expect(service.getTrustSnapshot()).toMatchObject({
      status: "trusted",
      trusted: true,
      decisionCount: 2,
      requestLifecycle: {
        latestRequest: {
          kind: "workspace",
          status: "completed",
          result: "trusted",
        },
      },
    })

    await service.setWorkspaceTrust("D:/Workspace", "restricted")
    const openFiles = await service.requestOpenFilesTrust(["file:///D:/external/loose.ts"])
    expect(openFiles).toBe("pending")
    expect(dialogService.getActiveDialog()).toMatchObject({
      id: "dialog-1",
      message: "是否允许在此工作区中打开不受信任的文件？",
      checkbox: { label: "记住对所有工作区的选择", checked: false },
      evidenceContext: {
        resource: "file:///D:/external/loose.ts",
        commandId: "workbench.trust.openFiles",
      },
    })
    dialogService.resolveActiveDialog({ buttonIndex: 1, checkboxChecked: true })
    await flushPromises()
    expect(service.getTrustSnapshot().requestLifecycle.requests.at(-1)).toMatchObject({
      kind: "openFiles",
      status: "completed",
      result: "openInNewWindow",
    })

    const resourceRequest = await service.requestResourcesTrust({
      uri: "file:///D:/external/project",
      message: "资源需要工作区信任",
    })
    expect(resourceRequest).toBeUndefined()
    expect(dialogService.getActiveDialog()).toMatchObject({
      id: "dialog-2",
      message: "是否信任此文件夹内文件的作者？",
      detail: "资源需要工作区信任",
      evidenceContext: {
        resource: "file:///D:/external/project",
        commandId: "workbench.trust.resources",
      },
    })
    dialogService.resolveActiveDialog({ buttonIndex: 0 })
    await Promise.resolve()
    expect(service.getUriTrustInfo("file:///D:/external/project")).toMatchObject({
      trusted: true,
      uri: "file:///D:/external/project",
    })
    expect(JSON.stringify(dialogService.getDecisionProjections())).not.toContain("SourceMirror")

    registration.dispose()
    expect(service.getTrustSnapshot().capabilities.requestService.dialogShell.status).toBe("notRegistered")
  })

  it("resolves WorkspaceTrustRequestHandler denied modal decisions through the same trust facade", async () => {
    let idCounter = 0
    const service = new WorkspaceTrustWorkbenchService()
    const dialogService = new CodekDialogService({
      now: () => 1700000000000,
      createId: (prefix) => `${prefix}-${idCounter++}`,
    })
    const registration = service.registerWorkspaceTrustDialogShell(dialogService)

    const workspaceRequest = service.requestWorkspaceTrust("D:/Workspace")
    expect(dialogService.getActiveDialog()).toMatchObject({
      id: "dialog-0",
      source: "WorkspaceTrustRequestHandler",
      buttons: [
        { index: 0, label: "信任工作区并继续", isCancel: false },
        { index: 1, label: "以受限模式继续", isCancel: false },
        { index: 2, label: "管理", isCancel: false },
        { index: 3, label: "取消", isCancel: true },
      ],
      evidenceContext: {
        workspaceFolder: "D:/Workspace",
        commandId: "workbench.trust.request",
      },
    })

    dialogService.resolveActiveDialog({ buttonIndex: 1 })
    await expect(workspaceRequest).resolves.toMatchObject({
      root: "D:/Workspace",
      status: "restricted",
      decision: "deny",
      trusted: false,
      persisted: true,
    })
    expect(dialogService.getDecisionProjections().at(-1)).toMatchObject({
      source: "WorkspaceTrustRequestHandler",
      outcome: "confirmed",
      buttonIndex: 1,
      buttonLabel: "以受限模式继续",
      evidenceContext: {
        workspaceFolder: "D:/Workspace",
        commandId: "workbench.trust.request",
      },
    })
    expect(service.getTrustSnapshot()).toMatchObject({
      status: "restricted",
      trusted: false,
      latestDecision: {
        decision: "deny",
      },
      requestLifecycle: {
        latestRequest: {
          kind: "workspace",
          status: "completed",
          result: "restricted",
        },
      },
      constraints: {
        noSecondTrustStore: true,
        preservesAgentPolicyGate: true,
      },
    })
    expect(JSON.stringify(dialogService.getDecisionProjections())).not.toContain("SourceMirror")

    registration.dispose()
  })

  it("routes startup workspace trust prompts through the Codek dialog shell without claiming full startup policy", async () => {
    let idCounter = 0
    const statusbarService = new WorkbenchNotificationProgressService()
    const storageService = new CodekStorageService({ workspaceId: "workspace-trust-startup" })
    const bannerService = new WorkspaceTrustBannerWorkbenchService(storageService)
    const service = new WorkspaceTrustWorkbenchService(
      statusbarService,
      bannerService,
      storageService,
      undefined,
      new TestHostFocusService(true),
    )
    const dialogService = new CodekDialogService({
      now: () => 1700000000000,
      createId: (prefix) => `${prefix}-${idCounter++}`,
    })
    const registration = service.registerWorkspaceTrustDialogShell(dialogService)

    service.requestWorkspaceTrustOnStartup("D:/Workspace")

    expect(storageService.getBoolean("workspace.trust.startupPrompt.shown", StorageScope.WORKSPACE)).toBe(true)
    expect(storageService.keys(StorageScope.WORKSPACE, StorageTarget.MACHINE)).toEqual(["workspace.trust.startupPrompt.shown"])
    expect(dialogService.getActiveDialog()).toMatchObject({
      id: "dialog-0",
      kind: "prompt",
      modal: true,
      source: "WorkspaceTrustRequestHandler",
      message: "是否信任此工作区内文件的作者？",
      evidenceContext: {
        workspaceFolder: "D:/Workspace",
        commandId: "workbench.trust.request",
      },
    })
    expect(service.getTrustSnapshot().capabilities.requestService).toMatchObject({
      modalUi: {
        status: "available",
        owner: "WorkspaceTrustRequestHandler",
      },
      smokeReadiness: {
        status: "ready",
        owner: "WorkspaceTrustRequestHandler",
        rendererOwner: "App.vue CodekDialogService modal",
        selectors: {
          modal: "codek-dialog-service-modal",
          sourceAttribute: "data-dialog-source",
          commandIdAttribute: "data-dialog-command-id",
          workspaceFolderAttribute: "data-dialog-workspace-folder",
          buttonLabelsAttribute: "data-dialog-button-labels",
        },
        serviceEvidence: {
          requestLifecycleSource: "WorkspaceTrustWorkbenchService.requestLifecycle",
          dialogRequestSource: "CodekDialogService.getActiveDialog",
          dialogDecisionSource: "CodekDialogService.getDecisionProjections",
          trustDecisionSource: "WorkspaceTrustWorkbenchService.getTrustSnapshot",
          trustStore: "WorkspaceTrustWorkbenchService",
          noSecondTrustStore: true,
        },
      },
      uiOwners: {
        workspaceRequestDialog: {
          status: "available",
          owner: "WorkspaceTrustRequestHandler",
        },
        startupModal: {
          status: "partial",
          owner: "WorkspaceTrustUXHandler",
        },
        banner: {
          status: "available",
          owner: "WorkspaceTrustUXHandler",
        },
        statusbar: {
          status: "available",
          owner: "WorkspaceTrustUXHandler",
        },
        manageEditor: {
          status: "blocked",
          owner: "WorkspaceTrustEditor",
        },
      },
      dialogShell: {
        status: "registered",
        handles: ["workspaceRequestDialog", "startupRequestDialog", "openFilesDialog", "resourcesDialog"],
      },
      missingEntrypointCommandIds: [
        WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage,
        WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Configure,
      ],
      constraints: {
        noSecondRequestStore: true,
        modalUiNotImplemented: false,
        requestLifecycleEvidenceOnly: true,
      },
      startupPolicy: {
        owner: "WorkspaceTrustUXHandler",
        status: "partial",
        dialogShellStatus: "registered",
        hostFocus: {
          status: "available",
          owner: "IHostService",
          serviceId: "hostService",
          vscodeServiceId: "IHostService",
          requiredContracts: ["hasFocus", "onDidChangeFocus"],
          exploredCodekFacades: [
            expect.objectContaining({
              facade: "WorkbenchLayoutService.hasFocus(part)",
              ownerStatus: "notApplicable",
            }),
            expect.objectContaining({
              facade: "AccessibleView editor-shell focus projection",
              ownerStatus: "notApplicable",
            }),
            expect.objectContaining({
              facade: "CodekDialogService modal shell",
              ownerStatus: "notApplicable",
            }),
            expect.objectContaining({
              facade: "Codek window/app focus service",
              ownerStatus: "available",
            }),
          ],
          availableSignals: expect.arrayContaining([
            expect.objectContaining({
              source: "renderer",
              facade: "CodekWindowHostFocusService",
              provides: expect.arrayContaining(["hostFocusState", "focusChangeEvent"]),
              missingForHostService: [],
            }),
            expect.objectContaining({
              source: "renderer",
              facade: "App.vue window blur autosave listener",
              provides: ["blurEvent"],
              missingForHostService: ["hasFocus", "onDidChangeFocus"],
            }),
            expect.objectContaining({
              source: "desktop",
              facade: "desktop/main.js collectProcessSummary BrowserWindow.isFocused()",
              provides: ["currentFocusSnapshot"],
              missingForHostService: ["onDidChangeFocus"],
            }),
            expect.objectContaining({
              source: "smoke",
              facade: "desktop/main.js bringSmokeWindowToForeground",
              provides: ["foregroundFocusResult"],
              missingForHostService: ["hasFocus", "onDidChangeFocus"],
            }),
          ]),
          requiredServiceContract: {
            serviceId: "hostService",
            owner: "CodekHostFocusService",
            currentState: "available",
            hasFocus: "available",
            onDidChangeFocus: "available",
            minimumAdapter: "document.hasFocus/window focus-blur or Electron BrowserWindow focus/blur bridged through preload",
            noSyntheticFocus: true,
          },
          covered: {
            startupRequestEvidence: true,
            dialogShell: true,
          },
          blocked: {
            hostFocusState: false,
            focusChangeEvent: false,
            startupModalDeferral: false,
          },
        },
        storagePolicy: {
          status: "partial",
          owner: "IStorageService",
          serviceId: "storageService",
          vscodeServiceId: "IStorageService",
          startupPromptShownKey: "workspace.trust.startupPrompt.shown",
          bannerDismissedKey: "workbench.banner.restrictedMode.dismissed",
          storageScope: "WORKSPACE",
          storageTarget: "MACHINE",
          covered: {
            bannerDismissalEvidence: true,
            startupPromptRequestEvidence: true,
            persistedStartupPromptShown: true,
            persistedBannerDismissal: true,
          },
          blocked: {
            fullStartupPolicyCompletion: true,
          },
        },
        covered: {
          startupRequestEvidence: true,
          dialogShell: true,
          statusbarIndicator: true,
          restrictedModeBanner: true,
          noSecondTrustStore: true,
        },
      },
    })
    expect(service.getTrustSnapshot().capabilities.requestService.smokeReadiness.decisionEvents).toEqual(expect.arrayContaining([
      "CodekDialogService.onWillShowDialog",
      "CodekDialogService.onDidShowDialog",
      "WorkspaceTrustWorkbenchService.onDidInitiateWorkspaceTrustRequest",
    ]))
    expect(service.getTrustSnapshot().capabilities.requestService.smokeReadiness.readyWhen).toEqual(expect.arrayContaining([
      "dialog resolution calls completeWorkspaceTrustRequest/completeOpenFilesTrustRequest/completeResourcesTrustRequest on the same WorkspaceTrustWorkbenchService instance",
      "WorkspaceTrustWorkbenchService.getTrustSnapshot().constraints.noSecondTrustStore remains true",
    ]))
    expect(service.getTrustSnapshot().capabilities.requestService.uiOwners.startupModal.reason).toContain("security.workspace.trust.startupPrompt")
    expect(service.getTrustSnapshot().capabilities.requestService.uiOwners.manageEditor.reason).toContain("IEditorService.openEditor")
    expect(service.getTrustSnapshot().capabilities.requestService.startupPolicy.hostFocus.reason).toContain("IHostService.hasFocus")
    expect(service.getTrustSnapshot().capabilities.requestService.startupPolicy.hostFocus.reason).toContain("CodekWindowHostFocusService")
    expect(service.getTrustSnapshot().capabilities.requestService.startupPolicy.hostFocus).toMatchObject({
      vscodeDeferralContract: {
        sourceClass: "WorkspaceTrustUXHandler",
        method: "constructor",
        immediateWhen: "hostService.hasFocus",
        deferredBy: "hostService.onDidChangeFocus",
        deferredAction: "showModalOnStart",
      },
      blocked: {
        startupModalDeferral: false,
      },
    })
    expect(service.getTrustSnapshot().capabilities.requestService.startupPolicy.hostFocus.reason).toContain("showModalOnStart")
    expect(service.getTrustSnapshot().capabilities.requestService.startupPolicy.storagePolicy.reason).toContain("workspace.trust.startupPrompt.shown")
    expect(service.getTrustSnapshot().capabilities.requestService.startupPolicy.storagePolicy.reason).toContain("MACHINE target")
    expect(service.getTrustSnapshot().capabilities.requestService.startupPolicy.hostFocus.requiredServiceContract).toMatchObject({
      owner: "CodekHostFocusService",
      currentState: "available",
      hasFocus: "available",
      onDidChangeFocus: "available",
      noSyntheticFocus: true,
    })
    expect(service.getTrustSnapshot().capabilities.requestService.startupPolicy.storagePolicy.reason).toContain("workbench.banner.restrictedMode.dismissed")
    expect(service.getTrustSnapshot().capabilities.requestService.startupPolicy.configurationGates.map((gate) => gate.key)).toEqual([
      "security.workspace.trust.enabled",
      "security.workspace.trust.startupPrompt",
      "security.workspace.trust.untrustedFiles",
      "security.workspace.trust.banner",
      "security.workspace.trust.emptyWindow",
    ])

    dialogService.resolveActiveDialog({ buttonIndex: 0 })
    await flushPromises()

    const snapshot = service.getTrustSnapshot()
    expect(snapshot).toMatchObject({
      status: "trusted",
      trusted: true,
      decisionCount: 1,
      latestDecision: {
        root: "D:/Workspace",
        status: "trusted",
        decision: "allow",
      },
      requestLifecycle: {
        startupRequestCount: 1,
        latestRequest: {
          kind: "startup",
          status: "completed",
          result: "trusted",
        },
      },
      capabilities: {
        requestService: {
          uiOwners: {
            startupModal: {
              status: "partial",
            },
            banner: {
              status: "available",
            },
            statusbar: {
              status: "available",
            },
            manageEditor: {
              status: "blocked",
            },
          },
        },
      },
      constraints: {
        noSecondTrustStore: true,
      },
    })
    expect(dialogService.getDecisionProjections().at(-1)).toMatchObject({
      source: "WorkspaceTrustRequestHandler",
      buttonIndex: 0,
      buttonLabel: "信任工作区并继续",
      evidenceContext: {
        commandId: "workbench.trust.request",
        workspaceFolder: "D:/Workspace",
      },
    })
    expect(statusbarService.getStatusbarEntries()).toEqual([])
    expect(bannerService.getBannerItem(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID)).toMatchObject({
      visible: false,
      dismissed: false,
    })
    expect(JSON.stringify(dialogService.getDecisionProjections())).not.toContain("SourceMirror")

    registration.dispose()
  })

  it("projects VS Code WorkspaceTrust context keys from the single trust facade without adding another store", async () => {
    const service = new WorkspaceTrustWorkbenchService()

    expect(service.getTrustSnapshot().capabilities.requestService.contextKeys).toMatchObject({
      status: "available",
      owner: "WorkspaceTrustWorkbenchService",
    })
    expect(globalContextKeyService.getContextKeyValue(WORKSPACE_TRUST_CONTEXT_KEYS.IsEnabled)).toBe(true)
    expect(globalContextKeyService.getContextKeyValue(WORKSPACE_TRUST_CONTEXT_KEYS.IsTrusted)).toBe(false)
    expect(globalContextKeyService.getContextKeyValue(WORKSPACE_TRUST_CONTEXT_KEYS.LegacyTrusted)).toBe(false)

    await service.setWorkspaceTrust("D:/Workspace", "trusted")

    expect(globalContextKeyService.getContextKeyValue(WORKSPACE_TRUST_CONTEXT_KEYS.IsEnabled)).toBe(true)
    expect(globalContextKeyService.getContextKeyValue(WORKSPACE_TRUST_CONTEXT_KEYS.IsTrusted)).toBe(true)
    expect(globalContextKeyService.getContextKeyValue(WORKSPACE_TRUST_CONTEXT_KEYS.LegacyTrusted)).toBe(true)
    expect(service.getTrustSnapshot().constraints.noSecondTrustStore).toBe(true)
  })

  it("emits VS Code-style trust events, stops extension hosts, recomputes enablement, then restarts", async () => {
    const service = new WorkspaceTrustWorkbenchService()
    extensionWorkbenchService.setEditorViewModelForEvidence(trustRequiredPayload())
    const trustEvents: boolean[] = []
    let trustedFoldersEvents = 0
    const transitions: boolean[] = []
    service.onDidChangeTrust((trusted) => trustEvents.push(trusted))
    service.onDidChangeTrustedFolders(() => { trustedFoldersEvents += 1 })
    service.addWorkspaceTrustTransitionParticipant({
      participate: (trusted) => {
        transitions.push(trusted)
      },
    })

    await service.setWorkspaceTrust("D:/Workspace", "trusted")
    await service.setWorkspaceTrust("D:/Workspace", "trusted")
    await service.setUrisTrust(["file:///D:/Workspace/docs"], true)
    await service.setUrisTrust(["file:///D:/Workspace/docs"], true)
    await service.setTrustedUris(["file:///D:/Workspace/src"])
    await service.setWorkspaceTrust("D:/Workspace", "restricted")

    expect(trustEvents).toEqual([true, false])
    expect(transitions).toEqual([true, false])
    expect(trustedFoldersEvents).toBe(2)
    expect(service.getTrustSnapshot()).toMatchObject({
      status: "restricted",
      trustEventCount: 2,
      trustedFoldersEventCount: 2,
      trustedFolders: ["file:///D:/Workspace/src"],
      enablement: {
        serviceId: "workspaceTrustEnablementService",
        enabled: true,
        disableWorkspaceTrust: false,
        configurationKey: "security.workspace.trust.enabled",
        constraints: {
          noSecondTrustEnablementStore: true,
          preservesAgentPolicyGate: true,
        },
      },
      transitionCount: 2,
      latestTransition: {
        trusted: false,
        participantCount: 1,
        extensionEnablementRecomputed: true,
        extensionHostLifecycle: {
          vscodeLocalContract: "stopExtensionHosts+startExtensionHosts",
          vscodeRemoteContract: "hostService.reload",
          action: "stopStart",
          status: "completed",
          restartEvidenceStatus: "completed",
          restartCompletionSource: "desktop.extensionsHostService",
          stopRequested: true,
          stopped: true,
          restartRequested: true,
          restarted: true,
          reloadRequested: false,
          reloaded: false,
          blocked: false,
          blockedBy: "none",
          remoteReloadOwnerEvidence: {
            source: "WorkspaceTrustUXHandler.remoteAuthorityReload",
            status: "blocked",
            owner: "missingCodekHostReloadOwner",
            blockedOwner: "workbenchWindowReloadService",
            blockedBoundary: "requiresWorkbenchWindowReloadOwner",
            vscodeContract: "IHostService.reload",
            requiredSignals: ["environmentService.remoteAuthority", "hostService.reload"],
            currentSignals: {
              remoteAuthorityResolver: "available",
              extensionHostStopStartRoutes: "available",
              desktopWindowReloadHook: "smokeOnly",
              extensionHostReloadRoute: "extensionHostOnly",
              desktopLifecycleReloadOwner: "notWorkspaceTrustReloadOwner",
              hostServiceReload: "missing",
            },
            availableServiceLifecycleEvidence: ["stopExtensionHosts", "startExtensionHosts"],
            extensionHostReloadRouteScope: "extensionHostOnly",
            missingWindowReloadOwner: "AppWindowShellOrElectronMainReloadOwner",
            cannotSatisfyVscodeHostReloadWithExtensionHostReload: true,
            blockedByCurrentOwnerBoundary: "AppWindowShellOrElectronMainReloadOwner",
            reloadEvidence: null,
            runtimeReference: false,
          },
          stopEvidence: {
            action: "stopExtensionHosts",
            reason: "Changing workspace trust",
            stopped: true,
            wasRunning: true,
            vetoed: false,
            rootDir: "D:/Workspace",
            workspaceRoots: ["D:/Workspace"],
            workspaceFile: null,
          },
          startEvidence: {
            action: "startExtensionHosts",
            reason: "Changing workspace trust",
            started: true,
            rootDir: "D:/Workspace",
            workspaceRoots: ["D:/Workspace"],
            workspaceFile: null,
          },
        },
        extensionEnablement: {
          vscodeComputeSource: "IWorkspaceTrustManagementService.isWorkspaceTrusted+_computeEnablementState",
          trigger: "workspaceTrustTransition",
          workspaceTrusted: false,
          recomputedCount: 1,
          disabledByTrustRequirementCount: 1,
          lifecycle: {
            status: "available",
            restartCompletedHere: true,
            blockedBy: "none",
            hostWorkspaceEvidence: {
              status: "available",
              workspaceRoots: ["D:/Workspace"],
              workspaceFile: null,
            },
            latestStopEvidence: {
              serviceId: "extensionHostLifecycleService",
              stateSource: "desktop.extensionsHostService",
              action: "stopExtensionHosts",
              stopped: true,
              wasRunning: true,
              rootDir: "D:/Workspace",
              workspaceRoots: ["D:/Workspace"],
            },
            latestStartEvidence: {
              serviceId: "extensionHostLifecycleService",
              stateSource: "desktop.extensionsHostService",
              action: "startExtensionHosts",
              started: true,
              rootDir: "D:/Workspace",
              workspaceRoots: ["D:/Workspace"],
            },
          },
          hostLifecycleBinding: {
            status: "bound",
            trigger: "workspaceTrustTransition",
            workspaceTrusted: false,
            disabledByTrustRequirementCount: 1,
            lifecyclePhase: "completed",
            lifecycleStatus: "available",
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
            extensionId: trustRequiredExtension.id,
            state: "DisabledByTrustRequirement",
            disabledByTrustRequirement: true,
          }],
        },
      },
    })
    expect(extensionWorkbenchService.getEnablementProjection(trustRequiredExtension.id)).toMatchObject({
      state: "DisabledByTrustRequirement",
      disabledByTrustRequirement: true,
    })
    expect(extensionWorkbenchService.getSurfaceSnapshot().extensionHostLifecycle).toMatchObject({
      phase: "completed",
      status: "available",
      restartCompletedHere: true,
      blockedBy: "none",
      hostWorkspaceEvidence: {
        status: "available",
        workspaceRoots: ["D:/Workspace"],
        workspaceFile: null,
      },
    })
    expect(ehClient.stopExtensionHosts).toHaveBeenCalledWith("Changing workspace trust", {
      rootDir: "D:/Workspace",
      workspaceRoots: ["D:/Workspace"],
      workspaceFile: null,
    })
    expect(ehClient.startExtensionHosts).toHaveBeenCalledWith("Changing workspace trust", {
      rootDir: "D:/Workspace",
      workspaceRoots: ["D:/Workspace"],
      workspaceFile: null,
    })
  })

  it("refreshes latest transition enablement evidence when Electron start evidence only carries rootDir", async () => {
    vi.mocked(ehClient.startExtensionHosts).mockResolvedValueOnce({
      success: true,
      evidence: {
        serviceId: "extensionHostLifecycleService",
        stateSource: "desktop.extensionsHostService",
        vscodeContract: "IExtensionService.startExtensionHosts",
        action: "startExtensionHosts",
        reason: "Changing workspace trust",
        requested: true,
        started: true,
        alreadyRunning: false,
        rootDir: "D:/Workspace",
        workspaceFile: null,
        createdAt: Date.now(),
      },
    })
    const service = new WorkspaceTrustWorkbenchService()
    extensionWorkbenchService.setEditorViewModelForEvidence(trustRequiredPayload())

    await service.setWorkspaceTrust("D:/Workspace", "trusted")
    await service.setWorkspaceTrust("D:/Workspace", "restricted")

    const disabledByTrustRequirementStates = service.getTrustSnapshot()
      .latestTransition
      ?.extensionEnablement
      .states
      .filter((entry) => entry.state === "DisabledByTrustRequirement") || []

    expect(disabledByTrustRequirementStates).toHaveLength(1)
    expect(disabledByTrustRequirementStates[0].workspaceLocationEvidence).toMatchObject({
      status: "available",
      isInsideWorkspace: true,
      installPath: "D:/Workspace/extensions/sample.trust-required",
      workspaceRoots: ["D:/Workspace"],
    })
    expect(disabledByTrustRequirementStates[0].workspaceLocationEvidence.blockedReason).toBeUndefined()
  })

  it("keeps latest transition workspace-location evidence available when downgrade start evidence is missing", async () => {
    vi.mocked(ehClient.stopExtensionHosts).mockResolvedValueOnce({
      success: true,
      evidence: {
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
        rootDir: "D:/Workspace",
        createdAt: Date.now(),
      },
    })
    vi.mocked(ehClient.startExtensionHosts).mockResolvedValueOnce({
      success: false,
      error: "start route did not return lifecycle evidence",
    })
    const service = new WorkspaceTrustWorkbenchService()
    extensionWorkbenchService.setEditorViewModelForEvidence(trustRequiredPayload())

    await service.setWorkspaceTrust("D:/Workspace", "trusted")
    await service.setWorkspaceTrust("D:/Workspace", "restricted")

    const latestTransition = service.getTrustSnapshot().latestTransition
    const disabledByTrustRequirementStates = latestTransition
      ?.extensionEnablement
      .states
      .filter((entry) => entry.state === "DisabledByTrustRequirement") || []

    expect(latestTransition?.extensionHostLifecycle).toMatchObject({
      status: "blocked",
      blockedBy: "extensionHostLifecycleError",
      stopEvidence: {
        backendEvidence: {
          rootDir: "D:/Workspace",
        },
      },
    })
    const remoteReloadOwnerEvidence = service.getTrustSnapshot().latestTransition?.extensionHostLifecycle.remoteReloadOwnerEvidence
    expect(remoteReloadOwnerEvidence?.reason).toContain("IHostService.reload")
    expect(remoteReloadOwnerEvidence).toMatchObject({
      status: "blocked",
      blockedOwner: "workbenchWindowReloadService",
      blockedBoundary: "requiresWorkbenchWindowReloadOwner",
      blockedByCurrentOwnerBoundary: "AppWindowShellOrElectronMainReloadOwner",
      currentSignals: {
        extensionHostReloadRoute: "extensionHostOnly",
        desktopLifecycleReloadOwner: "notWorkspaceTrustReloadOwner",
        hostServiceReload: "missing",
      },
      availableServiceLifecycleEvidence: ["stopExtensionHosts", "startExtensionHosts"],
      extensionHostReloadRouteScope: "extensionHostOnly",
      missingWindowReloadOwner: "AppWindowShellOrElectronMainReloadOwner",
      cannotSatisfyVscodeHostReloadWithExtensionHostReload: true,
    })
    expect(remoteReloadOwnerEvidence?.reason).toContain("desktop/lifecycle.js owns close and backup decisions")
    expect(remoteReloadOwnerEvidence?.reason).toContain("App/window shell or Electron main workbench-window reload owner")
    expect(JSON.stringify(remoteReloadOwnerEvidence)).not.toContain("SourceMirror")
    expect(disabledByTrustRequirementStates).toHaveLength(1)
    expect(disabledByTrustRequirementStates[0].workspaceLocationEvidence).toMatchObject({
      status: "available",
      isInsideWorkspace: true,
      installPath: "D:/Workspace/extensions/sample.trust-required",
      workspaceRoots: ["D:/Workspace"],
    })
    expect(disabledByTrustRequirementStates[0].workspaceLocationEvidence.blockedReason).toBeUndefined()
  })

  it("routes remote Workspace Trust downgrade to a HostService reload facade without faking extension-host restart", async () => {
    const hostReloadService = new CodekWorkbenchHostReloadService()
    const remoteAuthorityService = new TestRemoteAuthorityService("wsl+Ubuntu")
    const service = new WorkspaceTrustWorkbenchService(
      new WorkbenchNotificationProgressService(),
      new WorkspaceTrustBannerWorkbenchService(),
      new CodekStorageService(),
      undefined,
      new TestHostFocusService(true),
      hostReloadService,
      remoteAuthorityService,
    )

    await service.setWorkspaceTrust("D:/Workspace", "trusted")
    vi.mocked(ehClient.stopExtensionHosts).mockClear()
    vi.mocked(ehClient.startExtensionHosts).mockClear()

    await service.setWorkspaceTrust("D:/Workspace", "restricted")

    expect(ehClient.stopExtensionHosts).not.toHaveBeenCalled()
    expect(ehClient.startExtensionHosts).not.toHaveBeenCalled()
    expect(hostReloadService.getLatestReloadEvidence()).toMatchObject({
      source: "CodekHostReloadService.reload",
      serviceId: "hostService",
      vscodeServiceId: "IHostService",
      requested: true,
      reloaded: false,
      delegateAvailable: false,
      remoteAuthority: "wsl+Ubuntu",
      blockedOwner: "workbenchWindowReloadService",
      blockedBoundary: "requiresAppWindowShellOrElectronMainReloadOwner",
      currentOwner: "rendererFacadeOnly",
    })
    expect(service.getTrustSnapshot().latestTransition?.extensionHostLifecycle).toMatchObject({
      action: "reloadWindow",
      status: "blocked",
      restartEvidenceStatus: "notRequested",
      restartCompletionSource: "none",
      stopRequested: false,
      stopped: false,
      restartRequested: false,
      restarted: false,
      reloadRequested: true,
      reloaded: false,
      blocked: true,
      blockedBy: "remoteAuthorityReloadNotOwnedHere",
      remoteReloadOwnerEvidence: {
        status: "partial",
        owner: "CodekHostReloadService",
        currentSignals: {
          remoteAuthorityResolver: "available",
          extensionHostReloadRoute: "extensionHostOnly",
          hostServiceReload: "facadeAvailable",
        },
        reloadEvidence: {
          requested: true,
          reloaded: false,
          delegateAvailable: false,
          remoteAuthority: "wsl+Ubuntu",
        },
      },
    })
    expect(service.getTrustSnapshot().latestTransition?.extensionHostLifecycle.reason).toContain("host reload facade")
    expect(service.getTrustSnapshot().latestTransition?.extensionHostLifecycle.remoteReloadOwnerEvidence.reason).toContain("must not be treated as extension-host reload completion")
    expect(JSON.stringify(service.getTrustSnapshot().latestTransition?.extensionHostLifecycle)).not.toContain("SourceMirror")
  })

  it("connects remote Workspace Trust downgrade to the workbench window reload delegate", async () => {
    const reloadDelegate = vi.fn().mockResolvedValue(undefined)
    const hostReloadService = new CodekWorkbenchHostReloadService(reloadDelegate)
    const remoteAuthorityService = new TestRemoteAuthorityService("wsl+Ubuntu")
    const service = new WorkspaceTrustWorkbenchService(
      new WorkbenchNotificationProgressService(),
      new WorkspaceTrustBannerWorkbenchService(),
      new CodekStorageService(),
      undefined,
      new TestHostFocusService(true),
      hostReloadService,
      remoteAuthorityService,
    )

    await service.setWorkspaceTrust("D:/Workspace", "trusted")
    vi.mocked(ehClient.stopExtensionHosts).mockClear()
    vi.mocked(ehClient.startExtensionHosts).mockClear()

    await service.setWorkspaceTrust("D:/Workspace", "restricted")

    expect(reloadDelegate).toHaveBeenCalledWith({
      reason: "Changing workspace trust",
      remoteAuthority: "wsl+Ubuntu",
    })
    expect(ehClient.stopExtensionHosts).not.toHaveBeenCalled()
    expect(ehClient.startExtensionHosts).not.toHaveBeenCalled()
    expect(hostReloadService.getLatestReloadEvidence()).toMatchObject({
      source: "CodekHostReloadService.reload",
      serviceId: "hostService",
      vscodeServiceId: "IHostService",
      requested: true,
      reloaded: true,
      delegateAvailable: true,
      remoteAuthority: "wsl+Ubuntu",
      currentOwner: "appWindowShellOrElectronMain",
    })
    expect(service.getTrustSnapshot().latestTransition?.extensionHostLifecycle).toMatchObject({
      action: "reloadWindow",
      status: "completed",
      restartEvidenceStatus: "notRequested",
      restartCompletionSource: "none",
      stopRequested: false,
      restartRequested: false,
      reloadRequested: true,
      reloaded: true,
      blocked: false,
      blockedBy: "none",
      remoteReloadOwnerEvidence: {
        status: "connected",
        owner: "CodekHostReloadService",
        currentSignals: {
          desktopWindowReloadHook: "preloadIpc",
          extensionHostReloadRoute: "extensionHostOnly",
          desktopLifecycleReloadOwner: "electronMainBrowserWindowReloadOwner",
          hostServiceReload: "connected",
        },
        reloadEvidence: {
          requested: true,
          reloaded: true,
          delegateAvailable: true,
          remoteAuthority: "wsl+Ubuntu",
        },
      },
    })
    expect(service.getTrustSnapshot().latestTransition?.extensionHostLifecycle.reason).toContain("IHostService.reload delegate reported completion")
    expect(service.getTrustSnapshot().latestTransition?.extensionHostLifecycle.remoteReloadOwnerEvidence.reason).toContain("Electron main BrowserWindow.reload")
    expect(JSON.stringify(service.getTrustSnapshot().latestTransition?.extensionHostLifecycle)).not.toContain("SourceMirror")
  })

  it("resolves the preload workbench-window reload bridge without referencing extension-host reload", async () => {
    const originalCodek = (globalThis as { codek?: unknown }).codek
    const reloadWorkbenchWindow = vi.fn().mockResolvedValue({
      ok: true,
      reloaded: false,
      dryRun: true,
    })
    ;(globalThis as { codek?: unknown }).codek = {
      reloadWorkbenchWindow,
    }

    try {
      const delegate = resolveCodekWorkbenchWindowReloadDelegate()
      expect(delegate).toBeTypeOf("function")
      await delegate?.({
        disableExtensions: true,
        reason: "Changing workspace trust",
        remoteAuthority: "wsl+Ubuntu",
        dryRun: true,
      })
      expect(reloadWorkbenchWindow).toHaveBeenCalledWith({
        disableExtensions: true,
        reason: "Changing workspace trust",
        remoteAuthority: "wsl+Ubuntu",
        dryRun: true,
      })
    } finally {
      ;(globalThis as { codek?: unknown }).codek = originalCodek
    }
  })

  it("does not fake extension host restart completion when a workspace trust transition participant fails", async () => {
    const service = new WorkspaceTrustWorkbenchService()
    service.addWorkspaceTrustTransitionParticipant({
      participate: () => {
        throw new Error("transition vetoed by test participant")
      },
    })

    await service.setWorkspaceTrust("D:/Workspace", "trusted")

    expect(service.getTrustSnapshot().latestTransition).toMatchObject({
      trusted: true,
      participantCount: 1,
      extensionEnablementRecomputed: true,
      extensionHostLifecycle: {
        action: "none",
        status: "participantFailed",
        restartEvidenceStatus: "blocked",
        restartCompletionSource: "blocked",
        stopRequested: false,
        stopped: false,
        restartRequested: false,
        restarted: false,
        reloadRequested: false,
        reloaded: false,
        blocked: true,
        blockedBy: "transitionParticipantError",
        remoteReloadOwnerEvidence: {
          status: "blocked",
          owner: "missingCodekHostReloadOwner",
          currentSignals: {
            hostServiceReload: "missing",
          },
        },
      },
    })
    expect(service.getTrustSnapshot().latestTransition?.extensionHostLifecycle.reason).toContain("transition vetoed by test participant")
    expect(ehClient.stopExtensionHosts).not.toHaveBeenCalled()
    expect(ehClient.startExtensionHosts).not.toHaveBeenCalled()
  })

  it("does not start extension hosts when stopExtensionHosts reports a veto", async () => {
    vi.mocked(ehClient.stopExtensionHosts).mockResolvedValueOnce({
      success: true,
      evidence: {
        serviceId: "extensionHostLifecycleService",
        stateSource: "desktop.extensionsHostService",
        vscodeContract: "IExtensionService.stopExtensionHosts",
        action: "stopExtensionHosts",
        reason: "Changing workspace trust",
        requested: true,
        stopped: false,
        wasRunning: true,
        vetoed: true,
        vetoReason: "extension host stop vetoed by test",
        createdAt: Date.now(),
      },
    })
    const service = new WorkspaceTrustWorkbenchService()

    await service.setWorkspaceTrust("D:/Workspace", "trusted")
    await service.setWorkspaceTrust("D:/Workspace", "restricted")

    expect(service.getTrustSnapshot().latestTransition).toMatchObject({
      trusted: false,
      extensionHostLifecycle: {
        action: "stopStart",
        status: "blocked",
        restartEvidenceStatus: "blocked",
        restartCompletionSource: "blocked",
        stopped: false,
        restartRequested: false,
        restarted: false,
        blocked: true,
        blockedBy: "extensionHostStopVeto",
        stopEvidence: {
          vetoed: true,
          vetoReason: "extension host stop vetoed by test",
        },
      },
    })
    expect(ehClient.startExtensionHosts).toHaveBeenCalledTimes(0)
  })

  it("marks extension host restart as not requested when no host was running during trust downgrade", async () => {
    vi.mocked(ehClient.stopExtensionHosts).mockResolvedValueOnce({
      success: true,
      evidence: {
        serviceId: "extensionHostLifecycleService",
        stateSource: "desktop.extensionsHostService",
        vscodeContract: "IExtensionService.stopExtensionHosts",
        action: "stopExtensionHosts",
        reason: "Changing workspace trust",
        requested: true,
        stopped: false,
        wasRunning: false,
        vetoed: false,
        vetoReason: "",
        createdAt: Date.now(),
      },
    })
    const service = new WorkspaceTrustWorkbenchService()

    await service.setWorkspaceTrust("D:/Workspace", "trusted")
    await service.setWorkspaceTrust("D:/Workspace", "restricted")

    expect(service.getTrustSnapshot().latestTransition).toMatchObject({
      trusted: false,
      extensionHostLifecycle: {
        action: "stopStart",
        status: "notRequired",
        restartEvidenceStatus: "notRequested",
        restartCompletionSource: "none",
        stopRequested: true,
        stopped: false,
        restartRequested: false,
        restarted: false,
        blocked: false,
        blockedBy: "none",
        stopEvidence: {
          requested: true,
          stopped: false,
          wasRunning: false,
        },
      },
    })
    expect(ehClient.startExtensionHosts).toHaveBeenCalledTimes(0)
  })

  it("keeps VS Code remote resolver hooks as cache/evidence projections without leaking tokens", async () => {
    const service = new RemoteAuthorityResolverWorkbenchService()

    service._setResolvedAuthority({
      authority: "ssh-remote+prod",
      connectionId: "managed-1",
      type: "ssh",
      label: "SSH: prod",
      connectionToken: "secret-connection-token",
    }, {
      isTrusted: true,
      authenticationSession: { id: "auth-session-1", providerId: "github" },
    })
    service._setAuthorityConnectionToken("ssh-remote+prod", "rotated-secret-token")
    service._setResolvedAuthorityError("ssh-remote+blocked", new Error("resolver offline"))

    const cached = service.getConnectionData("ssh-remote+prod")
    const canonical = await service.getCanonicalURI("vscode-remote://ssh-remote+prod/home/codek")
    const snapshot = service.getRemoteAuthoritySnapshot()

    expect(cached).toMatchObject({
      authority: "ssh-remote+prod",
      status: "resolved",
      cacheHit: false,
      connectionId: "managed-1",
      optionsTrusted: true,
      authenticationSessionProviderId: "github",
      authenticationSessionId: "auth-session-1",
    })
    expect(canonical).toBe("vscode-remote://ssh-remote+prod/home/codek")
    expect(snapshot).toMatchObject({
      resolveCount: 2,
      successCount: 1,
      failureCount: 1,
      latestResult: {
        authority: "ssh-remote+blocked",
        status: "error",
        error: "resolver offline",
      },
      constraints: {
        noCredentialPersistence: true,
        connectionTokensRedacted: true,
      },
    })
    expect(JSON.stringify(snapshot)).not.toContain("secret-connection-token")
    expect(JSON.stringify(snapshot)).not.toContain("rotated-secret-token")

    service._clearResolvedAuthority("ssh-remote+prod")
    expect(service.getConnectionData("ssh-remote+prod")).toBeNull()
  })

  it("projects remote authority context and restricted trust without creating another remote state", () => {
    const remote = new RemoteAuthorityResolverWorkbenchService()
    const trust = new WorkspaceTrustWorkbenchService()

    remote._setResolvedAuthority({
      authority: "ssh-remote+prod",
      connectionId: "managed-1",
      type: "ssh",
      label: "SSH: prod",
    }, { isTrusted: false })
    void trust.setWorkspaceTrust("vscode-remote://ssh-remote+prod/workspaces/codek", "restricted")

    const projection = remote.getRemoteAuthorityContextProjection(trust.getTrustSnapshot())

    expect(projection).toMatchObject({
      authority: "ssh-remote+prod",
      remoteName: "ssh-remote",
      hostLabel: "prod",
      isRemote: true,
      isTrusted: false,
      restrictedMode: true,
      stateSource: "remoteManager+workspaceTrustRoutes",
      constraints: {
        noSecondRemoteState: true,
        noCredentialPersistence: true,
        connectionTokensRedacted: true,
      },
    })
  })

  it("proxies VS Code-style authentication sessions through authState without exposing access tokens", async () => {
    const service = globalAuthenticationService
    auth.isLoggedIn = true
    auth.token = "secret-auth-token"
    auth.username = "codek-user"
    auth.email = "codek@example.test"
    auth.oauthProvider = "github"
    auth.oauthStatus = "success"

    const session = await service.createSession("github", ["repo", "user:email"])
    const sessions = await service.getSessions("github", ["repo"])
    await service.removeSession("github", session.sessionId)

    const snapshot = service.getAuthenticationSnapshot()
    expect(session).toMatchObject({
      providerId: "github",
      sessionId: "github:codek-user",
      accountLabel: "codek-user",
      status: "authorized",
      tokenRedacted: true,
    })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ status: "authorized", tokenRedacted: true })
    expect(snapshot.statuses).toEqual(expect.arrayContaining(["authorized", "revoked"]))
    expect(snapshot.latestSession).toMatchObject({ status: "revoked", sessionId: "github:codek-user" })
    expect(snapshot.constraints).toMatchObject({
      noTokenInEvidence: true,
      noSecondAuthStore: true,
      preservesSecureStore: true,
    })
    expect(JSON.stringify(snapshot)).not.toContain("secret-auth-token")
  })
})
