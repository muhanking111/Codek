import { auth } from "../auth/authState"
import {
  codekStorageService,
  StorageScope,
  StorageTarget,
  type ICodekStorageService,
} from "../storage/storageService"
import {
  activateExtensionHostByEvent,
  startExtensionHosts as startExtensionHostsViaClient,
  stopExtensionHosts as stopExtensionHostsViaClient,
  type ExtensionHostLifecycleOperationEvidence,
  type ExtensionHostLifecycleOperationOptions,
} from "../extensions/ehClient"
import {
  EXTENSIONS_WORKBENCH_COMMAND_IDS,
  EXTENSIONS_WORKBENCH_VIEW_IDS,
  extensionWorkbenchService,
  getExtensionWorkbenchSurfaceSnapshot,
  type ExtensionWorkbenchEnablementRecomputeEvidence,
} from "../extensions/extensionsWorkbenchService"
import { api } from "../lib/api"
import type { RemoteConnection, SshConfig } from "../remote/sshClient"
import { getRemoteManager } from "../remote/remoteManager"
import { Emitter, type Event } from "../vscode-adapter/base/common/event"
import { globalCodekDialogService, type ICodekDialogService } from "../dialogs/dialogService"
import { Action2, MenuId, registerAction2 } from "../vscode-adapter/platform/actions/common/menuRegistry"
import type { Disposable } from "../vscode-adapter/platform/commands/common/commandsRegistry"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import { RawContextKey, globalContextKeyService } from "./contextKeys"
import { globalEditorPartService } from "../vscode-adapter/workbench/services/editor/common/editorPartService"
import {
  WorkbenchStatusbarAlignment,
  globalWorkbenchStatusbarService,
  type IWorkbenchStatusbarService,
  type WorkbenchStatusbarEntryAccessor,
} from "./statusNotificationProgressService"
import { registerView, registerViewContainer } from "./viewRegistry"
import {
  globalWorkbenchExplorerEditorService,
  type IWorkbenchExplorerEditorService,
} from "./workbenchExplorerEditorService"
import {
  ConfigurationTarget,
  workbenchConfigurationService,
  type IConfigurationService,
  type IWorkbenchConfigurationService,
  type RestrictedSettings,
} from "../settings/settingsStore"
import {
  createWorkbenchTableShellOwnerAdapter,
  type WorkbenchTableShellOwnerAdapter,
} from "./genericShellOwnerContract"

// VS Code source adapter.
// Source references:
// - src/vs/workbench/services/extensions/common/extensions.ts
// - src/vs/workbench/services/extensions/common/abstractExtensionService.ts
// - src/vs/workbench/contrib/extensions/browser/extensionEnablementWorkspaceTrustTransitionParticipant.ts
// - src/vs/platform/workspace/common/workspaceTrust.ts
// - src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts
// - src/vs/platform/remote/common/remoteAuthorityResolver.ts
// - src/vs/workbench/services/authentication/common/authentication.ts
// - src/vs/workbench/contrib/authentication/browser/authentication.contribution.ts
//
// Codek keeps the runtime owners unchanged: extension workbench/ehClient,
// workspaceTrust routes + agentPolicy, remoteManager, and authState/MCP OAuth.
// This module contributes one VS Code-style workbench boundary around them.

export type WorkspaceTrustStatus = "trusted" | "restricted" | "unknown" | "pending"
export type WorkspaceTrustDecision = "allow" | "deny" | "unknown" | "pending"
export type WorkspaceTrustRequestKind = "workspace" | "resources" | "openFiles" | "startup"
export type WorkspaceTrustRequestStatus = "pending" | "completed" | "cancelled"
export type WorkspaceTrustUriResponse = "open" | "openInNewWindow" | "cancel"
export type WorkspaceTrustDialogShellStatus = "notRegistered" | "registered"
export type RemoteAuthorityResolveStatus = "resolved" | "error"
export type AuthenticationSessionStatus = "missing" | "pending" | "authorized" | "expired" | "revoked" | "error"

export const WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID = "workbench.banner.restrictedMode"
const WORKSPACE_TRUST_STARTUP_PROMPT_SHOWN_KEY = "workspace.trust.startupPrompt.shown"
const WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_DISMISSED_KEY = "workbench.banner.restrictedMode.dismissed"
const WORKSPACE_TRUST_DOCS_HREF = "https://aka.ms/vscode-workspace-trust"
const WORKSPACE_TRUST_ENABLED_CONFIGURATION_KEY = "security.workspace.trust.enabled"
const WORKSPACE_TRUST_STARTUP_PROMPT_CONFIGURATION_KEY = "security.workspace.trust.startupPrompt"
const WORKSPACE_TRUST_UNTRUSTED_FILES_CONFIGURATION_KEY = "security.workspace.trust.untrustedFiles"
const WORKSPACE_TRUST_BANNER_CONFIGURATION_KEY = "security.workspace.trust.banner"
const WORKSPACE_TRUST_EMPTY_WINDOW_CONFIGURATION_KEY = "security.workspace.trust.emptyWindow"

type WorkspaceTrustStartupPromptSetting = "once" | "always" | "never"
type WorkspaceTrustUntrustedFilesSetting = "prompt" | "open" | "newWindow"
type WorkspaceTrustBannerSetting = "untilDismissed" | "always" | "never"

export const EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS = {
  Container: "codek.view.extensionTrustRemoteAuth",
  ExtensionHost: "codek.extensionHost.surface",
  WorkspaceTrust: "codek.workspaceTrust.surface",
  RemoteAuthority: "codek.remoteAuthority.surface",
  Authentication: "codek.authentication.surface",
} as const

export const EXTENSION_HOST_WORKBENCH_COMMAND_IDS = {
  ActivatePlaceholder: "workbench.extensionHost.activatePlaceholder",
  OpenExtensions: EXTENSIONS_WORKBENCH_COMMAND_IDS.Open,
} as const

export const WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS = {
  Open: "workbench.workspaceTrust.open",
  Manage: "workbench.trust.manage",
  Configure: "workbench.trust.configure",
  Allow: "workbench.workspaceTrust.allow",
  Deny: "workbench.workspaceTrust.deny",
} as const

const WORKSPACE_TRUST_EDITOR_INPUT_ID = "workbench.input.workspaceTrust"
const WORKSPACE_TRUST_EDITOR_ID = "workbench.editor.workspaceTrust"
const WORKSPACE_TRUST_EDITOR_RESOURCE = "vscode-workspace-trust://workspaceTrustEditor"
const WORKSPACE_TRUST_SETTING_TAG = "workspaceTrust"
const WORKSPACE_TRUST_SETTINGS_QUERY = `@tag:${WORKSPACE_TRUST_SETTING_TAG}`
const WORKSPACE_TRUST_SETTINGS_SECTION = "vscode-settings"
const SETTINGS_EDITOR_COMMAND_FILTER_UNTRUSTED = "settings.filterUntrusted"
const REQUIRE_TRUSTED_WORKSPACE_SETTING_TAG = "requireTrustedWorkspace"
const FILTER_UNTRUSTED_SETTINGS_QUERY = `@tag:${REQUIRE_TRUSTED_WORKSPACE_SETTING_TAG}`

export const WORKSPACE_TRUST_CONTEXT_KEYS = {
  IsEnabled: "isWorkspaceTrustEnabled",
  IsTrusted: "isWorkspaceTrusted",
  LegacyTrusted: "workspaceTrust",
} as const

export const WORKSPACE_TRUST_CONTEXT = {
  IsEnabled: new RawContextKey<boolean>(WORKSPACE_TRUST_CONTEXT_KEYS.IsEnabled, false),
  IsTrusted: new RawContextKey<boolean>(WORKSPACE_TRUST_CONTEXT_KEYS.IsTrusted, false),
  LegacyTrusted: new RawContextKey<boolean>(WORKSPACE_TRUST_CONTEXT_KEYS.LegacyTrusted, false),
} as const

const workspaceTrustEnabledContextKey = WORKSPACE_TRUST_CONTEXT.IsEnabled.bindTo(globalContextKeyService)
const workspaceTrustTrustedContextKey = WORKSPACE_TRUST_CONTEXT.IsTrusted.bindTo(globalContextKeyService)
const workspaceTrustLegacyContextKey = WORKSPACE_TRUST_CONTEXT.LegacyTrusted.bindTo(globalContextKeyService)

export const REMOTE_AUTHORITY_WORKBENCH_COMMAND_IDS = {
  Open: "workbench.remoteAuthority.open",
  Resolve: "workbench.remoteAuthority.resolve",
  ClearCache: "workbench.remoteAuthority.clearCache",
} as const

export const AUTHENTICATION_WORKBENCH_COMMAND_IDS = {
  Open: "workbench.authentication.open",
  RequestSession: "workbench.authentication.requestSession",
  RevokeSession: "workbench.authentication.revokeSession",
} as const

export interface ExtensionActivationEvidence {
  serviceId: string
  stateSource: "extensionsWorkbenchService+ehClient"
  activationEvent: string
  extensionId: string
  status: "activated" | "error"
  createdAt: number
  error?: string
}

export interface ExtensionHostLifecycleServiceEvidence {
  serviceId: string
  stateSource: "extensionsWorkbenchService+ehClient"
  vscodeContract: "IExtensionService.stopExtensionHosts" | "IExtensionService.startExtensionHosts"
  action: "stopExtensionHosts" | "startExtensionHosts"
  reason: string
  auto?: boolean
  requested: boolean
  stopped?: boolean
  started?: boolean
  wasRunning?: boolean
  alreadyRunning?: boolean
  vetoed?: boolean
  vetoReason?: string
  rootDir?: string
  workspaceRoots?: string[]
  workspaceFile?: string | null
  createdAt: number
  error?: string
  backendEvidence?: ExtensionHostLifecycleOperationEvidence
}

export interface ExtensionHostWorkbenchSnapshot {
  serviceId: string
  vscodeServiceId: "extensionService"
  stateSource: "extensionsWorkbenchService+ehClient"
  extensionWorkbenchServiceId: string
  extensionWorkbenchViewIds: string[]
  extensionWorkbenchCommandIds: string[]
  activationCount: number
  latestActivation: ExtensionActivationEvidence | null
  activations: ExtensionActivationEvidence[]
  constraints: {
    noSecondExtensionRuntime: true
    preservesExtensionGalleryState: true
    activationEvidenceOnly: true
  }
}

export interface WorkspaceTrustDecisionEvidence {
  serviceId: string
  stateSource: "workspaceTrustRoutes+agentPolicy"
  root: string
  status: WorkspaceTrustStatus
  decision: WorkspaceTrustDecision
  trusted: boolean
  createdAt: number
  persisted: boolean
  persistError?: string
}

export interface WorkspaceTrustRequestEvidence {
  serviceId: string
  stateSource: "workspaceTrustRoutes+agentPolicy"
  kind: WorkspaceTrustRequestKind
  root: string
  uri: string
  uris: string[]
  message: string
  status: WorkspaceTrustRequestStatus
  result: WorkspaceTrustStatus | WorkspaceTrustUriResponse | ""
  createdAt: number
  completedAt: number | null
}

export interface WorkspaceTrustDialogShellProjection {
  owner: "WorkspaceTrustRequestHandler"
  status: WorkspaceTrustDialogShellStatus
  serviceId: "dialogService"
  stateSource: "CodekDialogService"
  handles: Array<"workspaceRequestDialog" | "startupRequestDialog" | "openFilesDialog" | "resourcesDialog">
  visualShellOwner: "App.vue dialog renderer"
  reason: string
}

export interface WorkspaceTrustEditorInputProjection {
  typeId: typeof WORKSPACE_TRUST_EDITOR_INPUT_ID
  editorId: typeof WORKSPACE_TRUST_EDITOR_ID
  name: "工作区信任"
  resource: typeof WORKSPACE_TRUST_EDITOR_RESOURCE
  capabilities: Array<"singleton" | "requiresModal">
}

export interface WorkspaceTrustManageEditorOpenRequest {
  commandId: typeof WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage
  input: WorkspaceTrustEditorInputProjection
  options: {
    pinned: true
  }
  editorPath: typeof WORKSPACE_TRUST_EDITOR_RESOURCE
  opened: boolean
  timestamp: number
}

export interface WorkspaceTrustManageEditorShellProjection {
  owner: "WorkspaceTrustEditor"
  status: WorkspaceTrustDialogShellStatus
  serviceId: "workbenchExplorerEditorService"
  stateSource: "WorkspaceTrustEditorInput+CodekEditorShell"
  input: WorkspaceTrustEditorInputProjection
  latestOpenRequest: WorkspaceTrustManageEditorOpenRequest | null
  openRequestCount: number
  reason: string
}

export interface WorkspaceTrustConfigureSettingsOpenRequest {
  commandId: typeof WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Configure
  vscodeContract: "IPreferencesService.openUserSettings"
  options: {
    jsonEditor: false
    query: typeof WORKSPACE_TRUST_SETTINGS_QUERY
  }
  settingsSection: typeof WORKSPACE_TRUST_SETTINGS_SECTION
  settingTag: typeof WORKSPACE_TRUST_SETTING_TAG
  opened: boolean
  timestamp: number
}

export type WorkspaceTrustSettingsShellOpener = (request: WorkspaceTrustConfigureSettingsOpenRequest) => void | Promise<void>

export interface WorkspaceTrustConfigureSettingsShellProjection {
  owner: "WorkspaceTrustSettings"
  status: WorkspaceTrustDialogShellStatus
  serviceId: "workbenchLayoutSettingsShell"
  stateSource: "IPreferencesService.openUserSettings+CodekSettingsShell"
  settingTag: typeof WORKSPACE_TRUST_SETTING_TAG
  query: typeof WORKSPACE_TRUST_SETTINGS_QUERY
  settingsSection: typeof WORKSPACE_TRUST_SETTINGS_SECTION
  latestOpenRequest: WorkspaceTrustConfigureSettingsOpenRequest | null
  openRequestCount: number
  reason: string
}

export interface WorkspaceTrustRestrictedModeProjection {
  enabled: boolean
  canExecuteCommands: boolean
  canUseNetwork: boolean
  canInstallExtensions: boolean
  canWriteWorkspaceFiles: boolean
  reason: string
}

export interface WorkspaceTrustCapabilitiesProjection {
  requestWorkspaceTrust: true
  trustedFolders: true
  resourceTrustRequests: true
  restrictedMode: true
  evidenceSafeActions: true
  requestService: WorkspaceTrustRequestServiceProjection
}

export type WorkspaceTrustRequestCapabilityStatus = "available" | "partial" | "blocked"

export interface WorkspaceTrustRequestCapabilityEvidence {
  status: WorkspaceTrustRequestCapabilityStatus
  owner: string
  reason: string
}

export interface WorkspaceTrustStatusbarProjection {
  serviceId: "statusbarService"
  stateSource: "WorkbenchStatusbarService"
  entryId: "status.workspaceTrust"
  owner: "WorkspaceTrustUXHandler"
  status: WorkspaceTrustRequestCapabilityStatus
  visible: boolean
  reason: string
}

export interface WorkspaceTrustBannerActionProjection {
  label: string
  href: string
}

export interface WorkspaceTrustBannerItemProjection {
  id: typeof WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID
  owner: "WorkspaceTrustUXHandler"
  serviceId: "bannerService"
  stateSource: "WorkspaceTrustBannerService" | "WorkspaceTrustBannerService+CodekStorageService"
  visible: boolean
  dismissed: boolean
  ariaLabel: string
  message: string
  actions: WorkspaceTrustBannerActionProjection[]
  reason: string
}

export interface WorkspaceTrustRequestServiceProjection {
  serviceId: string
  stateSource: "workspaceTrustRoutes+agentPolicy"
  vscodeServiceId: "workspaceTrustRequestService"
  codekOwnerServiceId: "workspaceTrustManagementService"
  vscodeOwnerAudit: WorkspaceTrustRequestOwnerAuditProjection
  requestOpen: WorkspaceTrustRequestCapabilityEvidence
  complete: WorkspaceTrustRequestCapabilityEvidence
  pending: WorkspaceTrustRequestCapabilityEvidence
  modalUi: WorkspaceTrustRequestCapabilityEvidence
  uiOwners: WorkspaceTrustRequestUiOwnerProjection
  entrypoints: WorkspaceTrustRequestCapabilityEvidence
  contextKeys: WorkspaceTrustRequestCapabilityEvidence
  activeRequestCount: number
  totalRequestCount: number
  latestRequest: WorkspaceTrustRequestEvidence | null
  entrypointCommandIds: string[]
  missingEntrypointCommandIds: string[]
  contextKeyIds: string[]
  missingContextKeyIds: string[]
  dialogShell: WorkspaceTrustDialogShellProjection
  smokeReadiness: WorkspaceTrustRequestSmokeReadinessProjection
  manageEditorShell: WorkspaceTrustManageEditorShellProjection
  configureSettingsShell: WorkspaceTrustConfigureSettingsShellProjection
  statusbar: WorkspaceTrustStatusbarProjection
  banner: WorkspaceTrustBannerItemProjection
  editorPane: WorkspaceTrustEditorPaneContractProjection
  startupPolicy: WorkspaceTrustStartupPolicyContractProjection
  constraints: {
    noSecondRequestStore: true
    modalUiNotImplemented: boolean
    fullWorkspaceTrustEditorPaneNotImplemented: boolean
    requestLifecycleEvidenceOnly: true
  }
}

export interface WorkspaceTrustEditorPaneContractProjection {
  owner: "WorkspaceTrustEditor"
  status: WorkspaceTrustRequestCapabilityStatus
  vscodeSourcePaths: string[]
  ownerFeasibility: WorkspaceTrustEditorPaneOwnerFeasibilityProjection
  settingsEditor2: WorkspaceTrustSettingsEditor2OwnerProjection
  settingsTree: WorkspaceTrustSettingsTreeOwnerProjection
  workbenchTableRowModel: WorkspaceTrustWorkbenchTableRowModelProjection
  vscodeEditorPaneDomAudit: {
    sourceClass: "WorkspaceTrustEditor"
    editorPaneId: "workbench.editor.workspaceTrust"
    rootSelector: ".workspace-trust-editor"
    bodySelector: ".workspace-trust-editor-body"
    focusContract: "WorkspaceTrustEditor.focus -> rootElement.focus"
    keyboardContracts: Array<"UpArrow/DownArrow section navigation" | "Escape root focus" | "CtrlCmd+Enter toggle workspace trust" | "CtrlCmd+Shift+Enter trust parent folder">
    renderDependencies: Array<
      | "IExtensionsWorkbenchService.onChange"
      | "IWorkbenchConfigurationService.onDidChangeRestrictedSettings"
      | "IWorkspaceTrustManagementService.onDidChangeTrust"
      | "IWorkspaceTrustManagementService.onDidChangeTrustedFolders"
    >
    requiredDomSections: Array<"header" | "affectedFeatures" | "trustedContainer" | "untrustedContainer" | "configuration" | "trustedUrisTable">
  }
  stateSource: "WorkspaceTrustEditorInput+CodekEditorShell"
  openRequestStatus: WorkspaceTrustRequestCapabilityStatus
  paneOwnerStatus: "blocked" | "partial" | "available"
  trustStore: "WorkspaceTrustWorkbenchService"
  domSmoke: {
    owner: "App.vue WorkspaceTrustEditor smoke DOM"
    status: WorkspaceTrustRequestCapabilityStatus
    rootSelector: ".workspace-trust-editor"
    bodySelector: ".workspace-trust-editor-body"
    trustedUrisTableSelector: "[data-codek-smoke=\"workspace-trust-editor-trusted-folders-table\"]"
    affectedFeaturesSelector: "[data-codek-smoke=\"workspace-trust-editor-affected-features\"]"
    focusContract: "rootElement.focus"
    keyboardContracts: Array<"UpArrow/DownArrow section navigation" | "Escape root focus" | "CtrlCmd+Enter toggle workspace trust" | "CtrlCmd+Shift+Enter trust parent folder">
    stateSource: "WorkspaceTrustWorkbenchService+extensionsWorkbenchService"
    currentSourcePaths: string[]
    reason: string
  }
  trustedUrisTable: WorkspaceTrustEditorPaneSubsurfaceProjection & {
    trustedFolderCount: number
    trustedFoldersEventCount: number
  }
  affectedFeaturesList: WorkspaceTrustEditorPaneSubsurfaceProjection & {
    restrictedModeEnabled: boolean
    disabledByTrustRequirementCount: number
  }
  restrictedSettingsRender: WorkspaceTrustEditorPaneSubsurfaceProjection & {
    configurationKeys: WorkspaceTrustStartupPolicyGateKey[]
    restrictedSettingCount: number
    workspaceRestrictedSettingCount: number
    treeRows: WorkspaceTrustRestrictedSettingsTreeRowProjection[]
    filterUntrustedCommand: WorkspaceTrustFilterUntrustedCommandProjection
  }
  covered: {
    singletonInput: boolean
    pinnedOpenRequest: boolean
    domVisible: boolean
    rootFocus: boolean
    keyboardNavigation: boolean
    noSecondTrustStore: true
  }
  blocked: {
    editorPaneDom: boolean
    fullEditorPaneClass: boolean
    keyboardNavigation: boolean
    focusMethod: boolean
    affectedFeaturesList: boolean
    trustedUrisTable: boolean
    restrictedSettingsRender: boolean
  }
  blockedReason: string
}

export interface WorkspaceTrustEditorPaneOwnerFeasibilityProjection {
  status: "contractOwnerAvailable" | "blocked"
  conclusion: "minimalOpenRequestOwnerOnly"
  inspectedVscodeOwners: Array<"WorkspaceTrustEditor" | "SettingsEditor2" | "SettingsTree" | "WorkbenchTable">
  inspectedCodekShells: Array<{
    owner: "WorkbenchExplorerEditorService" | "EditorPartService" | "App.vue WorkspaceTrustEditor smoke DOM"
    status: "reusableForOpenRequest" | "genericShellContract" | "fileTabOnly" | "smokeOnly"
    supports: string[]
    missingForFullOwner: string[]
    reason: string
  }>
  minimalAdapter: {
    owner: "WorkspaceTrustWorkbenchService.registerWorkspaceTrustManageEditorShell"
    status: WorkspaceTrustRequestCapabilityStatus
    commandId: typeof WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage
    editorResource: typeof WORKSPACE_TRUST_EDITOR_RESOURCE
    openOptions: {
      pinned: true
      permanent: true
      preview: false
    }
    stateSource: "WorkbenchExplorerEditorService.openEditor"
    reason: string
  }
  blockedOwners: Array<"EditorPaneDescriptor" | "EditorInputSerializer" | "IEditorService.openEditor(EditorInput)" | "SettingsTree DOM owner" | "WorkbenchTable DOM owner" | "IInstantiationService graph" | "IStorageService memento">
  nextOwnerBoundary: "generic editor shell/App.vue owner"
  runtimeReference: false
  reason: string
}

export interface WorkspaceTrustSettingsEditor2OwnerProjection {
  owner: "SettingsEditor2"
  status: "partial" | "blocked"
  editorPaneId: "workbench.editor.settings2"
  vscodeSourcePaths: string[]
  currentSourcePaths: string[]
  stateSource: "IPreferencesService.openUserSettings+CodekSettingsShell" | "blocked"
  reusedConfigurationSource: "workbenchConfigurationService"
  workspaceTrustQueryTags: Array<"workspaceTrust" | "requireTrustedWorkspace">
  trustChangeModelUpdate: "IWorkspaceTrustManagementService.onDidChangeTrust -> SettingsTreeModel.updateWorkspaceTrust"
  workspaceTrustGroupInjection: "configured untrusted workspace settings -> Workspace Trust settings group"
  coveredSignals: string[]
  blockedSignals: string[]
  missingOwners: Array<"EditorPane" | "IInstantiationService" | "IPreferencesService" | "IStorageService">
  reason: string
}

export interface WorkspaceTrustSettingsTreeOwnerProjection {
  owner: "SettingsTree"
  status: "partial" | "blocked"
  vscodeSourcePaths: string[]
  currentSourcePaths: string[]
  stateSource: "workbenchConfigurationService"
  rowModelSource: "IWorkbenchConfigurationService.restrictedSettings"
  query: typeof FILTER_UNTRUSTED_SETTINGS_QUERY
  indicatorOwner: "SettingsTreeIndicatorsLabel"
  indicatorCommandId: "workbench.trust.manage"
  indicatorClass: "setting-item-workspace-trust"
  modelTrustUpdateSignal: "SettingsTreeModel.updateWorkspaceTrust"
  rowCount: number
  coveredSignals: string[]
  blockedSignals: string[]
  missingOwners: Array<"SettingsTree" | "WorkbenchObjectTree" | "IListService" | "IInstantiationService">
  reason: string
}

export interface WorkspaceTrustWorkbenchTableRowModelProjection {
  owner: "WorkbenchTable"
  status: "partial" | "blocked"
  vscodeSourcePaths: string[]
  currentSourcePaths: string[]
  stateSource: "WorkspaceTrustWorkbenchService"
  sourceClass: "WorkspaceTrustedUrisTable"
  tableOwnerId: "WorkspaceTrust"
  tableUpdateSignal: "WorkspaceTrustedUrisTable.updateTable -> WorkbenchTable.splice"
  rowCount: number
  eventCount: number
  coveredSignals: string[]
  blockedSignals: string[]
  missingOwners: Array<"WorkbenchTable" | "IInstantiationService" | "IStorageService">
  shellAdapter: WorkbenchTableShellOwnerAdapter
  reason: string
}

export interface WorkspaceTrustEditorPaneSubsurfaceProjection {
  owner: "WorkspaceTrustEditor"
  surface: "trustedUrisTable" | "affectedFeaturesList" | "restrictedSettingsRender"
  status: WorkspaceTrustRequestCapabilityStatus
  stateSource: "WorkspaceTrustWorkbenchService" | "WorkspaceTrustWorkbenchService+extensionsWorkbenchService" | "workbenchConfigurationService"
  vscodeSourcePaths: string[]
  currentSourcePaths: string[]
  coveredSignals: string[]
  blockedSignals: string[]
  reason: string
}

export interface WorkspaceTrustRestrictedSettingsTreeRowProjection {
  key: string
  target: "default" | "application" | "userLocal" | "userRemote" | "workspace" | "workspaceFolder"
  configuredTarget: "workspace" | "workspaceFolder" | "unknown"
  commandId: typeof SETTINGS_EDITOR_COMMAND_FILTER_UNTRUSTED
  query: typeof FILTER_UNTRUSTED_SETTINGS_QUERY
  stateSource: "IWorkbenchConfigurationService.restrictedSettings"
}

export interface WorkspaceTrustFilterUntrustedCommandProjection {
  commandId: typeof SETTINGS_EDITOR_COMMAND_FILTER_UNTRUSTED
  status: WorkspaceTrustRequestCapabilityStatus
  vscodeContract: "IPreferencesService.openWorkspaceSettings"
  options: {
    jsonEditor: false
    query: typeof FILTER_UNTRUSTED_SETTINGS_QUERY
  }
  settingTag: typeof REQUIRE_TRUSTED_WORKSPACE_SETTING_TAG
  stateSource: "IWorkbenchConfigurationService.restrictedSettings+CodekSettingsShell"
  reason: string
}

interface WorkspaceTrustEditorPaneEvidenceInput {
  trustedFolderCount: number
  trustedFoldersEventCount: number
  restrictedModeEnabled: boolean
  disabledByTrustRequirementCount: number
  startupPolicySettings: WorkspaceTrustStartupPolicySettingsSnapshot
  restrictedSettings: RestrictedSettings
}

export interface WorkspaceTrustRequestSmokeReadinessProjection {
  status: "ready" | "blocked"
  owner: "WorkspaceTrustRequestHandler"
  rendererOwner: "App.vue CodekDialogService modal"
  selectors: {
    modal: "codek-dialog-service-modal"
    sourceAttribute: "data-dialog-source"
    commandIdAttribute: "data-dialog-command-id"
    workspaceFolderAttribute: "data-dialog-workspace-folder"
    buttonLabelsAttribute: "data-dialog-button-labels"
  }
  serviceEvidence: {
    requestLifecycleSource: "WorkspaceTrustWorkbenchService.requestLifecycle"
    dialogRequestSource: "CodekDialogService.getActiveDialog"
    dialogDecisionSource: "CodekDialogService.getDecisionProjections"
    trustDecisionSource: "WorkspaceTrustWorkbenchService.getTrustSnapshot"
    trustStore: "WorkspaceTrustWorkbenchService"
    noSecondTrustStore: true
  }
  decisionEvents: string[]
  readyWhen: string[]
  blockedUntil: string
}

export type WorkspaceTrustStartupPolicyGateKey =
  | "security.workspace.trust.enabled"
  | "security.workspace.trust.startupPrompt"
  | "security.workspace.trust.untrustedFiles"
  | "security.workspace.trust.banner"
  | "security.workspace.trust.emptyWindow"

export interface WorkspaceTrustStartupPolicyGateProjection {
  key: WorkspaceTrustStartupPolicyGateKey
  status: WorkspaceTrustRequestCapabilityStatus
  stateSource: "workspaceTrustRoutes+agentPolicy" | "workbenchConfigurationService" | "blocked"
  owner: "WorkspaceTrustEnablementService" | "WorkspaceTrustUXHandler" | "WorkspaceTrustRequestHandler"
  value: boolean | WorkspaceTrustStartupPromptSetting | WorkspaceTrustUntrustedFilesSetting | WorkspaceTrustBannerSetting
  reason: string
}

export interface WorkspaceTrustStartupHostFocusProjection extends WorkspaceTrustRequestCapabilityEvidence {
  serviceId: "hostService"
  vscodeServiceId: "IHostService"
  vscodeDeferralContract: {
    sourceClass: "WorkspaceTrustUXHandler"
    method: "constructor"
    immediateWhen: "hostService.hasFocus"
    deferredBy: "hostService.onDidChangeFocus"
    deferredAction: "showModalOnStart"
    sourcePath: "src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts"
  }
  requiredContracts: Array<"hasFocus" | "onDidChangeFocus">
  exploredCodekFacades: Array<{
    facade: string
    ownerStatus: "notApplicable" | "missing" | "available"
    reason: string
  }>
  availableSignals: Array<{
    source: "renderer" | "desktop" | "smoke"
    facade: string
    provides: Array<"blurEvent" | "focusEvent" | "visibilityChangeEvent" | "currentFocusSnapshot" | "foregroundFocusResult" | "hostFocusState" | "focusChangeEvent">
    missingForHostService: Array<"hasFocus" | "onDidChangeFocus">
    reason: string
  }>
  requiredServiceContract: {
    serviceId: "hostService"
    owner: "CodekHostFocusService"
    currentState: "missing" | "available"
    hasFocus: "missing" | "available"
    onDidChangeFocus: "missing" | "available"
    minimumAdapter: "document.hasFocus/window focus-blur or Electron BrowserWindow focus/blur bridged through preload"
    noSyntheticFocus: true
  }
  covered: {
    startupRequestEvidence: true
    dialogShell: boolean
  }
  blocked: {
    hostFocusState: boolean
    focusChangeEvent: boolean
    startupModalDeferral: boolean
  }
}

export interface WorkspaceTrustStartupStoragePolicyProjection extends WorkspaceTrustRequestCapabilityEvidence {
  serviceId: "storageService"
  vscodeServiceId: "IStorageService"
  startupPromptShownKey: typeof WORKSPACE_TRUST_STARTUP_PROMPT_SHOWN_KEY
  bannerDismissedKey: typeof WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_DISMISSED_KEY
  storageScope: "WORKSPACE"
  storageTarget: "MACHINE"
  covered: {
    bannerDismissalEvidence: true
    startupPromptRequestEvidence: true
    persistedStartupPromptShown: boolean
    persistedBannerDismissal: boolean
  }
  blocked: {
    fullStartupPolicyCompletion: true
  }
}

export interface WorkspaceTrustStartupPolicyContractProjection {
  owner: "WorkspaceTrustUXHandler"
  status: "partial"
  vscodeSourcePaths: string[]
  stateSource: "workspaceTrustRoutes+agentPolicy"
  requestLifecycleSource: "WorkspaceTrustWorkbenchService.requestLifecycle"
  dialogShellStatus: WorkspaceTrustDialogShellStatus
  trustStore: "WorkspaceTrustWorkbenchService"
  hostFocus: WorkspaceTrustStartupHostFocusProjection
  storagePolicy: WorkspaceTrustStartupStoragePolicyProjection
  configurationGates: WorkspaceTrustStartupPolicyGateProjection[]
  covered: {
    startupRequestEvidence: true
    dialogShell: boolean
    statusbarIndicator: true
    restrictedModeBanner: true
    noSecondTrustStore: true
  }
  blockedReason: string
}

export interface WorkspaceTrustStartupPolicySettingsSnapshot {
  enabled: boolean
  startupPrompt: WorkspaceTrustStartupPromptSetting
  untrustedFiles: WorkspaceTrustUntrustedFilesSetting
  banner: WorkspaceTrustBannerSetting
  emptyWindow: boolean
}

export interface WorkspaceTrustRequestOwnerAuditProjection {
  requestHandlerOwner: "WorkspaceTrustRequestHandler"
  uxHandlerOwner: "WorkspaceTrustUXHandler"
  editorOwner: "WorkspaceTrustEditor"
  contextKeysOwner: "WorkspaceTrustContextKeys"
  sourcePaths: string[]
}

export interface WorkspaceTrustRequestUiOwnerProjection {
  workspaceRequestDialog: WorkspaceTrustRequestCapabilityEvidence
  openFilesDialog: WorkspaceTrustRequestCapabilityEvidence
  resourcesDialog: WorkspaceTrustRequestCapabilityEvidence
  startupModal: WorkspaceTrustRequestCapabilityEvidence
  banner: WorkspaceTrustRequestCapabilityEvidence
  statusbar: WorkspaceTrustRequestCapabilityEvidence
  manageEditor: WorkspaceTrustRequestCapabilityEvidence
  configureSettings: WorkspaceTrustRequestCapabilityEvidence
}

export interface WorkspaceTrustRequestLifecycleProjection {
  workspaceRequestActive: boolean
  resourceRequestCount: number
  openFilesRequestCount: number
  startupRequestCount: number
  latestRequest: WorkspaceTrustRequestEvidence | null
  requests: WorkspaceTrustRequestEvidence[]
}

export interface WorkspaceTrustEnablementProjection {
  serviceId: string
  stateSource: "workspaceTrustRoutes+agentPolicy"
  enabled: boolean
  disableWorkspaceTrust: boolean
  configurationKey: "security.workspace.trust.enabled"
  constraints: {
    noSecondTrustEnablementStore: true
    preservesAgentPolicyGate: true
  }
}

export type WorkspaceTrustExtensionHostLifecycleAction = "none" | "stopStart" | "reloadWindow"
export type WorkspaceTrustExtensionHostLifecycleStatus = "notRequired" | "completed" | "blocked" | "unsupported" | "participantFailed"
export type WorkspaceTrustRemoteReloadOwnerStatus = "partial" | "blocked" | "connected"

export interface CodekHostReloadOptions {
  disableExtensions?: boolean
  reason?: string
  remoteAuthority?: string
  dryRun?: boolean
}

type CodekHostReloadDelegate = (options?: CodekHostReloadOptions) => Promise<void> | void

export interface CodekHostReloadEvidence {
  source: "CodekHostReloadService.reload"
  serviceId: "hostService"
  vscodeServiceId: "IHostService"
  requested: boolean
  reloaded: boolean
  delegateAvailable: boolean
  disableExtensions: boolean
  reason: string
  remoteAuthority: string
  blockedOwner: "workbenchWindowReloadService"
  blockedBoundary: "requiresAppWindowShellOrElectronMainReloadOwner"
  currentOwner: "rendererFacadeOnly" | "appWindowShellOrElectronMain"
  error?: string
  createdAt: number
}

export interface WorkspaceTrustRemoteReloadOwnerEvidence {
  source: "WorkspaceTrustUXHandler.remoteAuthorityReload"
  status: WorkspaceTrustRemoteReloadOwnerStatus
  owner: "CodekHostReloadService" | "missingCodekHostReloadOwner"
  blockedOwner: "workbenchWindowReloadService"
  blockedBoundary: "requiresWorkbenchWindowReloadOwner"
  vscodeContract: "IHostService.reload"
  vscodeSourcePaths: readonly string[]
  currentSourcePaths: readonly string[]
  requiredSignals: readonly ["environmentService.remoteAuthority", "hostService.reload"]
  currentSignals: {
    remoteAuthorityResolver: "available"
    extensionHostStopStartRoutes: "available"
    desktopWindowReloadHook: "preloadIpc" | "smokeOnly" | "missing"
    extensionHostReloadRoute: "extensionHostOnly"
    desktopLifecycleReloadOwner: "electronMainBrowserWindowReloadOwner" | "notWorkspaceTrustReloadOwner"
    hostServiceReload: "missing" | "facadeAvailable" | "connected"
  }
  availableServiceLifecycleEvidence: readonly ["stopExtensionHosts", "startExtensionHosts"]
  extensionHostReloadRouteScope: "extensionHostOnly"
  missingWindowReloadOwner: "AppWindowShellOrElectronMainReloadOwner"
  cannotSatisfyVscodeHostReloadWithExtensionHostReload: true
  blockedByCurrentOwnerBoundary: "AppWindowShellOrElectronMainReloadOwner"
  reloadEvidence: CodekHostReloadEvidence | null
  reason: string
  runtimeReference: false
}

export interface WorkspaceTrustExtensionHostLifecycleEvidence {
  serviceId: string
  stateSource: "workspaceTrustRoutes+agentPolicy"
  vscodeLocalContract: "stopExtensionHosts+startExtensionHosts"
  vscodeRemoteContract: "hostService.reload"
  action: WorkspaceTrustExtensionHostLifecycleAction
  status: WorkspaceTrustExtensionHostLifecycleStatus
  restartEvidenceStatus: "notRequested" | "requested" | "completed" | "blocked"
  restartCompletionSource: "none" | "desktop.extensionsHostService" | "blocked"
  reason: string
  stopRequested: boolean
  stopped: boolean
  restartRequested: boolean
  restarted: boolean
  reloadRequested: boolean
  reloaded: boolean
  blocked: boolean
  blockedBy: "missingExtensionHostLifecycleService" | "remoteAuthorityReloadNotOwnedHere" | "transitionParticipantError" | "extensionHostLifecycleError" | "extensionHostStopVeto" | "none"
  remoteReloadOwnerEvidence: WorkspaceTrustRemoteReloadOwnerEvidence
  stopEvidence?: ExtensionHostLifecycleServiceEvidence
  startEvidence?: ExtensionHostLifecycleServiceEvidence
}

export interface WorkspaceTrustTransitionEvidence {
  serviceId: string
  stateSource: "workspaceTrustRoutes+agentPolicy"
  trusted: boolean
  participantCount: number
  extensionEnablementRecomputed: boolean
  extensionEnablement: ExtensionWorkbenchEnablementRecomputeEvidence
  extensionHostLifecycle: WorkspaceTrustExtensionHostLifecycleEvidence
  createdAt: number
}

export interface WorkspaceTrustWorkbenchSnapshot {
  serviceId: string
  stateSource: "workspaceTrustRoutes+agentPolicy"
  root: string
  status: WorkspaceTrustStatus
  trusted: boolean
  trustEventCount: number
  trustedFoldersEventCount: number
  trustedFolders: string[]
  trustedFolderCount: number
  decisionCount: number
  latestDecision: WorkspaceTrustDecisionEvidence | null
  decisions: WorkspaceTrustDecisionEvidence[]
  pendingRequest: boolean
  acceptsOutOfWorkspaceFiles: boolean
  requestLifecycle: WorkspaceTrustRequestLifecycleProjection
  restrictedMode: WorkspaceTrustRestrictedModeProjection
  enablement: WorkspaceTrustEnablementProjection
  startupPolicySettings: WorkspaceTrustStartupPolicySettingsSnapshot
  transitionCount: number
  latestTransition: WorkspaceTrustTransitionEvidence | null
  transitions: WorkspaceTrustTransitionEvidence[]
  capabilities: WorkspaceTrustCapabilitiesProjection
  constraints: {
    noSecondTrustStore: true
    preservesAgentPolicyGate: true
    securityAuditPathOwnedByBackend: true
    requestLifecycleEvidenceOnly: true
  }
}

export interface RemoteAuthorityResolveOptions {
  type?: "wsl" | "ssh"
  target?: string
  sshConfig?: SshConfig
}

export interface RemoteAuthorityResolvedProjection {
  authority: string
  connectionId?: string
  id?: string
  type?: string
  label?: string
  connectionToken?: string
}

export interface RemoteAuthorityResolvedOptionsProjection {
  isTrusted?: boolean
  authenticationSession?: {
    id: string
    providerId: string
  }
}

export interface RemoteAuthorityResolveEvidence {
  serviceId: string
  stateSource: "remoteManager"
  authority: string
  status: RemoteAuthorityResolveStatus
  cacheHit: boolean
  label: string
  type: string
  connectionId: string
  error: string
  optionsTrusted: boolean
  authenticationSessionProviderId: string
  authenticationSessionId: string
  createdAt: number
}

export interface RemoteAuthorityWorkbenchSnapshot {
  serviceId: string
  stateSource: "remoteManager"
  resolveCount: number
  successCount: number
  failureCount: number
  cacheHitCount: number
  latestResult: RemoteAuthorityResolveEvidence | null
  results: RemoteAuthorityResolveEvidence[]
  activeConnectionLabel: string
  activeConnectionType: string
  cachedAuthorities: string[]
  constraints: {
    noSecondRemoteState: true
    noCredentialPersistence: true
    resolverCacheEvidenceOnly: true
    connectionTokensRedacted: true
  }
}

export interface RemoteAuthorityContextProjection {
  serviceId: string
  stateSource: "remoteManager+workspaceTrustRoutes"
  authority: string
  remoteName: string
  hostLabel: string
  isRemote: boolean
  isTrusted: boolean
  restrictedMode: boolean
  activeConnectionLabel: string
  activeConnectionType: string
  resolveStatus: RemoteAuthorityResolveStatus | "unknown"
  optionsTrusted: boolean
  authenticationSessionProviderId: string
  authenticationSessionId: string
  constraints: {
    noSecondRemoteState: true
    noCredentialPersistence: true
    connectionTokensRedacted: true
  }
}

export interface AuthenticationSessionEvidence {
  providerId: string
  sessionId: string
  accountLabel: string
  scopes: string[]
  status: AuthenticationSessionStatus
  canPrompt: boolean
  promptLabel: string
  promptDetail: string
  error: string
  tokenRedacted: boolean
  createdAt: number
}

export interface AuthenticationWorkbenchSnapshot {
  serviceId: string
  stateSource: "authState+mcpRegistryClient"
  providerIds: string[]
  latestSession: AuthenticationSessionEvidence
  sessions: AuthenticationSessionEvidence[]
  statuses: AuthenticationSessionStatus[]
  hasToken: boolean
  oauthStatus: string
  oauthProvider: string
  constraints: {
    noTokenInEvidence: true
    noSecondAuthStore: true
    sharesMcpOAuthSessionBoundary: true
    preservesSecureStore: true
  }
}

export interface ExtensionTrustRemoteAuthWorkbenchSnapshot {
  source: "extensionTrustRemoteAuthWorkbenchService"
  containerId: typeof EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.Container
  viewIds: string[]
  commandIds: string[]
  serviceIds: {
    extensionHost: string
    workspaceTrust: string
    workspaceTrustEnablement: string
    remoteAuthority: string
    authentication: string
  }
  stateSource: "facade"
  extensionHost: ExtensionHostWorkbenchSnapshot
  workspaceTrust: WorkspaceTrustWorkbenchSnapshot
  remoteAuthority: RemoteAuthorityWorkbenchSnapshot
  authentication: AuthenticationWorkbenchSnapshot
  constraints: {
    noSecondExtensionRuntime: true
    noSecondTrustStore: true
    noSecondRemoteState: true
    noSecondAuthStore: true
    preservesAgentEvidence: true
    viewActionMenuDriven: true
  }
}

export interface ExtensionHostService {
  readonly _serviceBrand: undefined
  activateByEvent(activationEvent: string, extensionId?: string): Promise<ExtensionActivationEvidence>
  stopExtensionHosts(reason: string, options?: ExtensionHostLifecycleOperationOptions): Promise<ExtensionHostLifecycleServiceEvidence>
  startExtensionHosts(reason?: string, options?: ExtensionHostLifecycleOperationOptions): Promise<ExtensionHostLifecycleServiceEvidence>
  getExtensionHostSnapshot(): ExtensionHostWorkbenchSnapshot
  clearEvidence(): void
}

export interface CodekHostReloadService {
  readonly _serviceBrand: undefined
  reload(options?: CodekHostReloadOptions): Promise<CodekHostReloadEvidence>
  getLatestReloadEvidence(): CodekHostReloadEvidence | null
  clearEvidence(): void
}

export interface WorkspaceTrustManagementService {
  readonly _serviceBrand: undefined
  readonly onDidChangeTrust: Event<boolean>
  readonly onDidChangeTrustedFolders: Event<void>
  readonly onDidInitiateWorkspaceTrustRequest: Event<WorkspaceTrustRequestEvidence>
  readonly onDidInitiateOpenFilesTrustRequest: Event<WorkspaceTrustRequestEvidence>
  readonly onDidInitiateResourcesTrustRequest: Event<WorkspaceTrustRequestEvidence>
  readonly workspaceTrustInitialized: Promise<void>
  requestWorkspaceTrust(root: string): Promise<WorkspaceTrustDecisionEvidence>
  requestWorkspaceTrustOnStartup(root?: string): WorkspaceTrustRequestEvidence
  completeWorkspaceTrustRequest(trusted?: boolean): Promise<WorkspaceTrustDecisionEvidence>
  cancelWorkspaceTrustRequest(): void
  requestOpenFilesTrust(uris: string[]): Promise<WorkspaceTrustUriResponse | "pending">
  completeOpenFilesTrustRequest(result: WorkspaceTrustUriResponse, saveResponse?: boolean): Promise<void>
  requestResourcesTrust(options: { uri: string; message?: string }): Promise<boolean | undefined>
  completeResourcesTrustRequest(uri: string, result: WorkspaceTrustUriResponse): Promise<void>
  getUriTrustInfo(uri: string): { uri: string; trusted: boolean }
  setUrisTrust(uris: string[], trusted: boolean): Promise<void>
  getTrustedUris(): string[]
  setTrustedUris(uris: string[]): Promise<void>
  setWorkspaceTrust(root: string, status: WorkspaceTrustStatus): Promise<WorkspaceTrustDecisionEvidence>
  getWorkspaceTrustDialogShellProjection(): WorkspaceTrustDialogShellProjection
  registerWorkspaceTrustDialogShell(dialogService?: ICodekDialogService): Disposable
  openWorkspaceTrustManageEditor(): WorkspaceTrustManageEditorOpenRequest
  recordWorkspaceTrustManageEditorOpenForSmoke(): WorkspaceTrustManageEditorOpenRequest
  getWorkspaceTrustManageEditorShellProjection(): WorkspaceTrustManageEditorShellProjection
  registerWorkspaceTrustManageEditorShell(editorService?: IWorkbenchExplorerEditorService): Disposable
  registerWorkspaceTrustConfigureSettingsShell(opener: WorkspaceTrustSettingsShellOpener): Disposable
  openWorkspaceTrustConfigureSettings(): WorkspaceTrustConfigureSettingsOpenRequest
  getWorkspaceTrustConfigureSettingsShellProjection(): WorkspaceTrustConfigureSettingsShellProjection
  isWorkspaceTrusted(root?: string): boolean
  addWorkspaceTrustTransitionParticipant(participant: WorkspaceTrustTransitionParticipant): Disposable
  getTrustSnapshot(root?: string): WorkspaceTrustWorkbenchSnapshot
  clearEvidence(): void
}

export interface CodekHostFocusService {
  readonly _serviceBrand: undefined
  readonly onDidChangeFocus: Event<boolean>
  readonly hasFocus: boolean
  dispose(): void
}

export interface WorkspaceTrustBannerService {
  readonly _serviceBrand: undefined
  readonly onDidChangeBanner: Event<WorkspaceTrustBannerItemProjection>
  show(item: WorkspaceTrustBannerItemProjection): void
  hide(id: typeof WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID): void
  dismiss(id: typeof WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID): void
  isDismissed(id: typeof WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID): boolean
  getBannerItem(id: typeof WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID): WorkspaceTrustBannerItemProjection
  clearEvidence(): void
}

export interface WorkspaceTrustEnablementService {
  readonly _serviceBrand: undefined
  isWorkspaceTrustEnabled(): boolean
  getEnablementSnapshot(): WorkspaceTrustEnablementProjection
}

export interface WorkspaceTrustTransitionParticipant {
  participate(trusted: boolean): Promise<void> | void
}

export interface RemoteAuthorityResolverService {
  readonly _serviceBrand: undefined
  resolveAuthority(authority: string, options?: RemoteAuthorityResolveOptions): Promise<RemoteAuthorityResolveEvidence>
  getConnectionData(authority: string): RemoteAuthorityResolveEvidence | null
  getCanonicalURI(uri: string): Promise<string>
  getRemoteAuthorityContextProjection(trust?: WorkspaceTrustWorkbenchSnapshot): RemoteAuthorityContextProjection
  getRemoteAuthoritySnapshot(): RemoteAuthorityWorkbenchSnapshot
  clearResolvedAuthority(authority?: string): void
  _clearResolvedAuthority(authority: string): void
  _setResolvedAuthority(
    resolvedAuthority: RemoteAuthorityResolvedProjection,
    resolvedOptions?: RemoteAuthorityResolvedOptionsProjection,
  ): void
  _setResolvedAuthorityError(authority: string, error: unknown): void
  _setAuthorityConnectionToken(authority: string, connectionToken: string): void
  clearEvidence(): void
}

export interface AuthenticationService {
  readonly _serviceBrand: undefined
  observeCodekAuthState(scopes?: string[]): AuthenticationSessionEvidence
  requestSession(providerId?: string, scopes?: string[] | string): Promise<AuthenticationSessionEvidence>
  revokeSession(providerId?: string, accountLabel?: string): AuthenticationSessionEvidence
  getSessions(providerId?: string, scopes?: string[] | string): Promise<AuthenticationSessionEvidence[]>
  createSession(providerId?: string, scopes?: string[] | string): Promise<AuthenticationSessionEvidence>
  removeSession(providerId: string, sessionId: string): Promise<void>
  getAuthenticationSnapshot(): AuthenticationWorkbenchSnapshot
  clearEvidence(): void
}

export const IExtensionHostService = createDecorator<ExtensionHostService>("extensionHostService")
export const IWorkspaceTrustManagementService = createDecorator<WorkspaceTrustManagementService>("workspaceTrustManagementService")
export const IWorkspaceTrustEnablementService = createDecorator<WorkspaceTrustEnablementService>("workspaceTrustEnablementService")
export const IRemoteAuthorityResolverService = createDecorator<RemoteAuthorityResolverService>("remoteAuthorityResolverService")
export const IAuthenticationService = createDecorator<AuthenticationService>("IAuthenticationService")
export const IHostService = createDecorator<CodekHostReloadService>("hostService")

export class ExtensionHostWorkbenchService implements ExtensionHostService {
  declare readonly _serviceBrand: undefined
  private readonly activations: ExtensionActivationEvidence[] = []
  private readonly lifecycleOperations: ExtensionHostLifecycleServiceEvidence[] = []

  async activateByEvent(activationEvent: string, extensionId = "codek.placeholder"): Promise<ExtensionActivationEvidence> {
    const normalizedActivationEvent = String(activationEvent || "onStartupFinished")
    const normalizedExtensionId = String(extensionId || "codek.placeholder")
    let evidence: ExtensionActivationEvidence
    try {
      const result = await activateExtensionHostByEvent(normalizedActivationEvent, normalizedExtensionId)
      evidence = {
        serviceId: String(IExtensionHostService),
        stateSource: "extensionsWorkbenchService+ehClient",
        activationEvent: normalizedActivationEvent,
        extensionId: normalizedExtensionId,
        status: result?.success === false ? "error" : "activated",
        createdAt: Date.now(),
        ...(result?.error ? { error: result.error } : {}),
        ...(result?.evidence || {}),
      }
    } catch (error) {
      evidence = {
        serviceId: String(IExtensionHostService),
        stateSource: "extensionsWorkbenchService+ehClient",
        activationEvent: normalizedActivationEvent,
        extensionId: normalizedExtensionId,
        status: "error",
        createdAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      }
    }
    this.activations.push(evidence)
    return evidence
  }

  async stopExtensionHosts(
    reason: string,
    options: ExtensionHostLifecycleOperationOptions = {},
  ): Promise<ExtensionHostLifecycleServiceEvidence> {
    const normalizedReason = String(reason || "Stopping extension hosts")
    let evidence: ExtensionHostLifecycleServiceEvidence
    try {
      const result = await stopExtensionHostsViaClient(normalizedReason, options)
      evidence = buildExtensionHostLifecycleServiceEvidence(
        "stopExtensionHosts",
        normalizedReason,
        result?.success === false ? result.error || "Extension host stop failed" : "",
        result?.evidence,
      )
    } catch (error) {
      evidence = buildExtensionHostLifecycleServiceEvidence(
        "stopExtensionHosts",
        normalizedReason,
        error instanceof Error ? error.message : String(error),
      )
    }
    this.lifecycleOperations.push(evidence)
    return evidence
  }

  async startExtensionHosts(
    reason = "",
    options: ExtensionHostLifecycleOperationOptions = {},
  ): Promise<ExtensionHostLifecycleServiceEvidence> {
    const normalizedReason = String(reason || "")
    let evidence: ExtensionHostLifecycleServiceEvidence
    try {
      const result = await startExtensionHostsViaClient(normalizedReason, options)
      evidence = buildExtensionHostLifecycleServiceEvidence(
        "startExtensionHosts",
        normalizedReason,
        result?.success === false ? result.error || "Extension host start failed" : "",
        result?.evidence,
      )
    } catch (error) {
      evidence = buildExtensionHostLifecycleServiceEvidence(
        "startExtensionHosts",
        normalizedReason,
        error instanceof Error ? error.message : String(error),
      )
    }
    this.lifecycleOperations.push(evidence)
    return evidence
  }

  getExtensionHostSnapshot(): ExtensionHostWorkbenchSnapshot {
    const extensionSurface = getExtensionWorkbenchSurfaceSnapshot()
    return {
      serviceId: String(IExtensionHostService),
      vscodeServiceId: "extensionService",
      stateSource: "extensionsWorkbenchService+ehClient",
      extensionWorkbenchServiceId: extensionSurface.serviceId,
      extensionWorkbenchViewIds: extensionSurface.viewIds,
      extensionWorkbenchCommandIds: extensionSurface.commandIds,
      activationCount: this.activations.length,
      latestActivation: this.activations.at(-1) || null,
      activations: [...this.activations],
      constraints: {
        noSecondExtensionRuntime: true,
        preservesExtensionGalleryState: true,
        activationEvidenceOnly: true,
      },
    }
  }

  clearEvidence(): void {
    this.activations.length = 0
    this.lifecycleOperations.length = 0
  }
}

export class WorkspaceTrustBannerWorkbenchService implements WorkspaceTrustBannerService {
  declare readonly _serviceBrand: undefined
  private readonly onDidChangeBannerEmitter = new Emitter<WorkspaceTrustBannerItemProjection>()
  readonly onDidChangeBanner = this.onDidChangeBannerEmitter.event
  private item: WorkspaceTrustBannerItemProjection | null = null

  constructor(private readonly storageService: ICodekStorageService = codekStorageService) {}

  private get dismissed(): boolean {
    return this.storageService.getBoolean(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_DISMISSED_KEY, StorageScope.WORKSPACE, false) === true
  }

  private set dismissed(value: boolean) {
    if (value) {
      this.storageService.store(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_DISMISSED_KEY, true, StorageScope.WORKSPACE, StorageTarget.MACHINE)
    } else {
      this.storageService.remove(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_DISMISSED_KEY, StorageScope.WORKSPACE)
    }
  }

  show(item: WorkspaceTrustBannerItemProjection): void {
    if (this.dismissed) return
    this.item = {
      ...item,
      visible: true,
      dismissed: false,
    }
    this.onDidChangeBannerEmitter.fire(this.getBannerItem(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID))
  }

  hide(id: typeof WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID): void {
    if (this.item?.id !== id) return
    this.item = buildWorkspaceTrustBannerItemProjection("unknown", false, this.dismissed)
    this.onDidChangeBannerEmitter.fire(this.getBannerItem(id))
  }

  dismiss(id: typeof WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID): void {
    if (id !== WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID) return
    this.dismissed = true
    this.hide(id)
  }

  isDismissed(id: typeof WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID): boolean {
    return id === WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID && this.dismissed
  }

  getBannerItem(id: typeof WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID): WorkspaceTrustBannerItemProjection {
    if (this.item?.id === id) return { ...this.item, actions: this.item.actions.map((action) => ({ ...action })) }
    return {
      ...buildWorkspaceTrustBannerItemProjection("unknown", false, this.dismissed),
      stateSource: "WorkspaceTrustBannerService+CodekStorageService",
    }
  }

  clearEvidence(): void {
    this.item = null
    this.dismissed = false
    this.onDidChangeBannerEmitter.fire(this.getBannerItem(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID))
  }
}

export class CodekWindowHostFocusService implements CodekHostFocusService {
  declare readonly _serviceBrand: undefined
  private readonly onDidChangeFocusEmitter = new Emitter<boolean>()
  readonly onDidChangeFocus = this.onDidChangeFocusEmitter.event
  private readonly removeListeners: Array<() => void> = []
  private lastFocus: boolean

  constructor(
    private readonly hostWindow: Pick<Window, "addEventListener" | "removeEventListener" | "document"> | undefined =
      typeof window !== "undefined" ? window : undefined,
  ) {
    this.lastFocus = this.readHasFocus()
    const target = this.hostWindow
    if (!target) return
    const emitCurrentFocus = () => this.emitIfChanged()
    target.addEventListener("focus", emitCurrentFocus)
    target.addEventListener("blur", emitCurrentFocus)
    target.document?.addEventListener?.("visibilitychange", emitCurrentFocus)
    this.removeListeners.push(
      () => target.removeEventListener("focus", emitCurrentFocus),
      () => target.removeEventListener("blur", emitCurrentFocus),
      () => target.document?.removeEventListener?.("visibilitychange", emitCurrentFocus),
    )
  }

  get hasFocus(): boolean {
    this.lastFocus = this.readHasFocus()
    return this.lastFocus
  }

  dispose(): void {
    for (const remove of this.removeListeners.splice(0)) remove()
    this.onDidChangeFocusEmitter.dispose()
  }

  private readHasFocus(): boolean {
    return this.hostWindow?.document?.hasFocus?.() === true
  }

  private emitIfChanged(): void {
    const nextFocus = this.readHasFocus()
    if (nextFocus === this.lastFocus) return
    this.lastFocus = nextFocus
    this.onDidChangeFocusEmitter.fire(nextFocus)
  }
}

export class WorkspaceTrustWorkbenchService implements WorkspaceTrustManagementService {
  declare readonly _serviceBrand: undefined
  private readonly onDidChangeTrustEmitter = new Emitter<boolean>()
  readonly onDidChangeTrust = this.onDidChangeTrustEmitter.event
  private readonly onDidChangeTrustedFoldersEmitter = new Emitter<void>()
  readonly onDidChangeTrustedFolders = this.onDidChangeTrustedFoldersEmitter.event
  private readonly onDidInitiateWorkspaceTrustRequestEmitter = new Emitter<WorkspaceTrustRequestEvidence>()
  readonly onDidInitiateWorkspaceTrustRequest = this.onDidInitiateWorkspaceTrustRequestEmitter.event
  private readonly onDidInitiateOpenFilesTrustRequestEmitter = new Emitter<WorkspaceTrustRequestEvidence>()
  readonly onDidInitiateOpenFilesTrustRequest = this.onDidInitiateOpenFilesTrustRequestEmitter.event
  private readonly onDidInitiateResourcesTrustRequestEmitter = new Emitter<WorkspaceTrustRequestEvidence>()
  readonly onDidInitiateResourcesTrustRequest = this.onDidInitiateResourcesTrustRequestEmitter.event
  readonly workspaceTrustInitialized = Promise.resolve()
  private readonly decisions: WorkspaceTrustDecisionEvidence[] = []
  private readonly requests: WorkspaceTrustRequestEvidence[] = []
  private readonly transitions: WorkspaceTrustTransitionEvidence[] = []
  private readonly transitionParticipants = new Set<WorkspaceTrustTransitionParticipant>()
  private workspaceTrustRequestPromise: Promise<WorkspaceTrustDecisionEvidence> | null = null
  private workspaceTrustRequestResolver: ((decision: WorkspaceTrustDecisionEvidence) => void) | null = null
  private dialogShellDisposable: Disposable | null = null
  private dialogShellRegistered = false
  private manageEditorShellDisposable: Disposable | null = null
  private manageEditorShellRegistered = false
  private manageEditorService: IWorkbenchExplorerEditorService | null = null
  private readonly manageEditorOpenRequests: WorkspaceTrustManageEditorOpenRequest[] = []
  private configureSettingsShellDisposable: Disposable | null = null
  private configureSettingsShellRegistered = false
  private configureSettingsShellOpener: WorkspaceTrustSettingsShellOpener | null = null
  private readonly configureSettingsOpenRequests: WorkspaceTrustConfigureSettingsOpenRequest[] = []
  private readonly trustedUris = new Set<string>()
  private status: WorkspaceTrustStatus = "unknown"
  private root = ""
  private pendingRoot = ""
  private startupFocusDisposable: Disposable | null = null
  private acceptsOutOfWorkspaceFilesValue = false
  private trustEventCount = 0
  private trustedFoldersEventCount = 0
  private workspaceTrustStatusbarEntry: WorkbenchStatusbarEntryAccessor | null = null

  constructor(
    private readonly statusbarService: IWorkbenchStatusbarService = globalWorkbenchStatusbarService,
    private readonly bannerService: WorkspaceTrustBannerService = globalWorkspaceTrustBannerService,
    private readonly storageService: ICodekStorageService = codekStorageService,
    private readonly configurationService: IConfigurationService = workbenchConfigurationService,
    private readonly hostFocusService: CodekHostFocusService = globalCodekHostFocusService,
    private readonly hostReloadService: CodekHostReloadService = globalCodekHostReloadService,
    private readonly remoteAuthorityService: RemoteAuthorityResolverService = globalRemoteAuthorityResolverService,
  ) {}

  async requestWorkspaceTrust(root: string): Promise<WorkspaceTrustDecisionEvidence> {
    if (this.workspaceTrustRequestPromise) return this.workspaceTrustRequestPromise
    this.pendingRoot = String(root || this.root || "")
    if (this.isWorkspaceTrusted()) {
      return this.buildWorkspaceTrustDecisionEvidence(this.pendingRoot || this.root, this.status, false)
    }
    if (!this.dialogShellRegistered) {
      this.recordTrustRequest("workspace", { root: this.pendingRoot })
      return this.setWorkspaceTrust(this.pendingRoot, "pending")
    }
    this.workspaceTrustRequestPromise = new Promise<WorkspaceTrustDecisionEvidence>((resolve) => {
      this.workspaceTrustRequestResolver = resolve
    })
    this.recordTrustRequest("workspace", { root: this.pendingRoot })
    void this.setWorkspaceTrust(this.pendingRoot, "pending")
    return this.workspaceTrustRequestPromise
  }

  requestWorkspaceTrustOnStartup(root = this.root): WorkspaceTrustRequestEvidence {
    this.pendingRoot = String(root || this.root || "")
    const startupPrompt = this.getWorkspaceTrustStartupPolicySettings().startupPrompt
    const hasShownStartupPrompt = this.storageService.getBoolean(WORKSPACE_TRUST_STARTUP_PROMPT_SHOWN_KEY, StorageScope.WORKSPACE, false) === true
    if (startupPrompt === "never" || (startupPrompt === "once" && hasShownStartupPrompt)) {
      return this.recordTrustRequest("startup", {
        root: this.pendingRoot,
        message: `skipped:${WORKSPACE_TRUST_STARTUP_PROMPT_CONFIGURATION_KEY}=${startupPrompt}`,
      }, "cancelled")
    }
    this.storageService.store(WORKSPACE_TRUST_STARTUP_PROMPT_SHOWN_KEY, true, StorageScope.WORKSPACE, StorageTarget.MACHINE)
    const hasHostFocus = this.hostFocusService.hasFocus
    const request = this.recordTrustRequest("startup", {
      root: this.pendingRoot,
      message: hasHostFocus ? "" : "deferred:hostService.onDidChangeFocus",
    }, "pending", hasHostFocus, !hasHostFocus)
    if (!hasHostFocus) {
      this.startupFocusDisposable?.dispose()
      this.startupFocusDisposable = this.hostFocusService.onDidChangeFocus((focused) => {
        if (!focused) return
        this.startupFocusDisposable?.dispose()
        this.startupFocusDisposable = null
        request.message = "resumed:hostService.onDidChangeFocus"
        this.fireRequestInitiated(request)
      })
    }
    return { ...request, uris: [...request.uris] }
  }

  async completeWorkspaceTrustRequest(trusted?: boolean): Promise<WorkspaceTrustDecisionEvidence> {
    const root = this.pendingRoot || this.root
    this.pendingRoot = ""
    const decision = await this.setWorkspaceTrust(root, trusted ? "trusted" : "restricted")
    this.resolveWorkspaceTrustRequest(decision)
    return decision
  }

  cancelWorkspaceTrustRequest(): void {
    this.pendingRoot = ""
    this.completeActiveRequests("workspace", "unknown", "cancelled")
    this.completeActiveRequests("startup", "unknown", "cancelled")
    this.resolveWorkspaceTrustRequest(this.buildWorkspaceTrustDecisionEvidence(this.root, this.status, false))
  }

  async requestOpenFilesTrust(uris: string[]): Promise<WorkspaceTrustUriResponse | "pending"> {
    const normalizedUris = normalizeTrustUris(uris)
    if (normalizedUris.every((uri) => this.getUriTrustInfo(uri).trusted)) return "open"
    const untrustedFiles = this.getWorkspaceTrustStartupPolicySettings().untrustedFiles
    if (untrustedFiles === "open") return "open"
    if (untrustedFiles === "newWindow") return "openInNewWindow"
    this.recordTrustRequest("openFiles", { uris: normalizedUris })
    return "pending"
  }

  async completeOpenFilesTrustRequest(result: WorkspaceTrustUriResponse, saveResponse?: boolean): Promise<void> {
    if (result === "open") this.acceptsOutOfWorkspaceFilesValue = true
    if (saveResponse && (result === "open" || result === "openInNewWindow")) {
      await this.configurationService.updateValue(
        WORKSPACE_TRUST_UNTRUSTED_FILES_CONFIGURATION_KEY,
        result === "open" ? "open" : "newWindow",
        ConfigurationTarget.USER,
      )
    }
    this.completeActiveRequests("openFiles", result, "completed")
  }

  async requestResourcesTrust(options: { uri: string; message?: string }): Promise<boolean | undefined> {
    const uri = normalizeTrustUri(options.uri)
    if (this.getUriTrustInfo(uri).trusted) return true
    this.recordTrustRequest("resources", { uri, message: options.message })
    return undefined
  }

  async completeResourcesTrustRequest(uri: string, result: WorkspaceTrustUriResponse): Promise<void> {
    const normalizedUri = normalizeTrustUri(uri)
    if (result === "open") await this.setUrisTrust([normalizedUri], true)
    this.completeActiveRequests("resources", result, "completed", normalizedUri)
  }

  getUriTrustInfo(uri: string): { uri: string; trusted: boolean } {
    const normalizedUri = normalizeTrustUri(uri)
    if (this.status === "trusted") return { uri: normalizedUri, trusted: true }
    const trustedUri = longestTrustedUri(normalizedUri, this.trustedUris)
    return { uri: trustedUri || normalizedUri, trusted: Boolean(trustedUri) }
  }

  async setUrisTrust(uris: string[], trusted: boolean): Promise<void> {
    const before = trustedUrisKey(this.trustedUris)
    for (const uri of normalizeTrustUris(uris)) {
      if (trusted) this.trustedUris.add(uri)
      else this.trustedUris.delete(uri)
    }
    this.fireTrustedFoldersChangeIfNeeded(before)
  }

  getTrustedUris(): string[] {
    return [...this.trustedUris]
  }

  getWorkspaceTrustDialogShellProjection(): WorkspaceTrustDialogShellProjection {
    return buildWorkspaceTrustDialogShellProjection(this.dialogShellRegistered)
  }

  getWorkspaceTrustManageEditorShellProjection(): WorkspaceTrustManageEditorShellProjection {
    return buildWorkspaceTrustManageEditorShellProjection(
      this.manageEditorShellRegistered,
      this.manageEditorOpenRequests.at(-1) || null,
      this.manageEditorOpenRequests.length,
    )
  }

  getWorkspaceTrustConfigureSettingsShellProjection(): WorkspaceTrustConfigureSettingsShellProjection {
    return buildWorkspaceTrustConfigureSettingsShellProjection(
      this.configureSettingsShellRegistered,
      this.configureSettingsOpenRequests.at(-1) || null,
      this.configureSettingsOpenRequests.length,
    )
  }

  registerWorkspaceTrustManageEditorShell(editorService: IWorkbenchExplorerEditorService = globalWorkbenchExplorerEditorService): Disposable {
    this.manageEditorShellDisposable?.dispose()
    this.manageEditorShellRegistered = true
    this.manageEditorService = editorService
    this.manageEditorShellDisposable = {
      dispose: () => {
        this.manageEditorShellRegistered = false
        this.manageEditorService = null
        this.manageEditorShellDisposable = null
      },
    }
    return this.manageEditorShellDisposable
  }

  openWorkspaceTrustManageEditor(): WorkspaceTrustManageEditorOpenRequest {
    if (!this.manageEditorShellRegistered || !this.manageEditorService) {
      const request = buildWorkspaceTrustManageEditorOpenRequest(false)
      this.manageEditorOpenRequests.push(request)
      return request
    }

    this.manageEditorService.openEditor(WORKSPACE_TRUST_EDITOR_RESOURCE, {
      pinned: true,
      permanent: true,
      preview: false,
    })
    const request = buildWorkspaceTrustManageEditorOpenRequest(true)
    this.manageEditorOpenRequests.push(request)
    return request
  }

  recordWorkspaceTrustManageEditorOpenForSmoke(): WorkspaceTrustManageEditorOpenRequest {
    const request = buildWorkspaceTrustManageEditorOpenRequest(false)
    this.manageEditorOpenRequests.push(request)
    return request
  }

  registerWorkspaceTrustConfigureSettingsShell(opener: WorkspaceTrustSettingsShellOpener): Disposable {
    this.configureSettingsShellDisposable?.dispose()
    this.configureSettingsShellRegistered = true
    this.configureSettingsShellOpener = opener
    const disposable: Disposable = {
      dispose: () => {
        if (this.configureSettingsShellDisposable !== disposable) return
        this.configureSettingsShellRegistered = false
        this.configureSettingsShellOpener = null
        this.configureSettingsShellDisposable = null
      },
    }
    this.configureSettingsShellDisposable = disposable
    return this.configureSettingsShellDisposable
  }

  openWorkspaceTrustConfigureSettings(): WorkspaceTrustConfigureSettingsOpenRequest {
    const request = buildWorkspaceTrustConfigureSettingsOpenRequest(Boolean(this.configureSettingsShellRegistered && this.configureSettingsShellOpener))
    if (request.opened) {
      void this.configureSettingsShellOpener?.(request)
    }
    this.configureSettingsOpenRequests.push(request)
    return request
  }

  registerWorkspaceTrustDialogShell(dialogService: ICodekDialogService = globalCodekDialogService): Disposable {
    this.dialogShellDisposable?.dispose()
    this.dialogShellRegistered = true
    const disposables = [
      this.onDidInitiateWorkspaceTrustRequest((request) => {
        void showWorkspaceTrustRequestDialog(this, dialogService, request)
      }),
      this.onDidInitiateOpenFilesTrustRequest((request) => {
        void showOpenFilesTrustRequestDialog(this, dialogService, request)
      }),
      this.onDidInitiateResourcesTrustRequest((request) => {
        void showResourcesTrustRequestDialog(this, dialogService, request)
      }),
    ]
    this.dialogShellDisposable = {
      dispose: () => {
        for (const disposable of disposables) disposable.dispose()
        this.dialogShellRegistered = false
        this.dialogShellDisposable = null
      },
    }
    return this.dialogShellDisposable
  }

  async setTrustedUris(uris: string[]): Promise<void> {
    const before = trustedUrisKey(this.trustedUris)
    this.trustedUris.clear()
    for (const uri of normalizeTrustUris(uris)) this.trustedUris.add(uri)
    this.fireTrustedFoldersChangeIfNeeded(before)
  }

  async setWorkspaceTrust(root: string, status: WorkspaceTrustStatus): Promise<WorkspaceTrustDecisionEvidence> {
    this.root = String(root || "")
    const previousTrusted = this.status === "trusted"
    const requestedStatus = normalizeTrustStatus(status)
    const persistence = await this.persistWorkspaceTrust(this.root, requestedStatus)
    const nextTrusted = persistence.status === "trusted"
    const trustChanged = persistence.status !== "pending" && previousTrusted !== nextTrusted
    if (trustChanged) await this.runWorkspaceTrustTransitionParticipants(nextTrusted)
    this.status = persistence.status
    if (persistence.trustedFolders) await this.setTrustedUris(persistence.trustedFolders)
    if (this.status !== "pending") {
      this.completeActiveRequests("workspace", this.status, "completed")
      this.completeActiveRequests("startup", this.status, "completed")
    }
    if (this.status !== "trusted") this.acceptsOutOfWorkspaceFilesValue = false
    const evidence = this.buildWorkspaceTrustDecisionEvidence(
      this.root,
      this.status,
      persistence.persisted,
      persistence.error,
    )
    this.decisions.push(evidence)
    if (trustChanged) this.fireTrustChange(nextTrusted)
    this.updateWorkspaceTrustContextKeys()
    this.updateWorkspaceTrustStatusbarEntry()
    this.updateWorkspaceTrustBanner()
    return evidence
  }

  isWorkspaceTrusted(): boolean {
    return this.status === "trusted"
  }

  getTrustSnapshot(root = this.root): WorkspaceTrustWorkbenchSnapshot {
    const restrictedMode = buildRestrictedModeProjection(this.status)
    const requestLifecycle = buildRequestLifecycleProjection(this.requests)
    const enablement = globalWorkspaceTrustEnablementService.getEnablementSnapshot()
    const startupPolicySettings = this.getWorkspaceTrustStartupPolicySettings()
    const latestEnablementRecompute = extensionWorkbenchService.getSurfaceSnapshot().latestEnablementRecompute
    return {
      serviceId: String(IWorkspaceTrustManagementService),
      stateSource: "workspaceTrustRoutes+agentPolicy",
      root: String(root || this.root || ""),
      status: this.status,
      trusted: this.status === "trusted",
      trustEventCount: this.trustEventCount,
      trustedFoldersEventCount: this.trustedFoldersEventCount,
      trustedFolders: this.getTrustedUris(),
      trustedFolderCount: this.trustedUris.size,
      decisionCount: this.decisions.length,
      latestDecision: this.decisions.at(-1) || null,
      decisions: [...this.decisions],
      pendingRequest: this.status === "pending" || requestLifecycle.requests.some((request) => request.status === "pending"),
      acceptsOutOfWorkspaceFiles: this.acceptsOutOfWorkspaceFilesValue,
      requestLifecycle,
      restrictedMode,
      enablement,
      startupPolicySettings,
      transitionCount: this.transitions.length,
      latestTransition: this.transitions.at(-1) || null,
      transitions: [...this.transitions],
      capabilities: {
        requestWorkspaceTrust: true,
        trustedFolders: true,
        resourceTrustRequests: true,
        restrictedMode: true,
        evidenceSafeActions: true,
        requestService: buildRequestServiceProjection(
          requestLifecycle,
          this.getWorkspaceTrustDialogShellProjection(),
          this.getWorkspaceTrustManageEditorShellProjection(),
          this.getWorkspaceTrustConfigureSettingsShellProjection(),
          this.getWorkspaceTrustStatusbarProjection(),
          this.getWorkspaceTrustBannerProjection(),
          startupPolicySettings,
          this.hostFocusService,
          {
            trustedFolderCount: this.trustedUris.size,
            trustedFoldersEventCount: this.trustedFoldersEventCount,
            restrictedModeEnabled: restrictedMode.enabled,
            disabledByTrustRequirementCount: latestEnablementRecompute?.disabledByTrustRequirementCount || 0,
            startupPolicySettings,
            restrictedSettings: readWorkbenchRestrictedSettings(this.configurationService),
          },
        ),
      },
      constraints: {
        noSecondTrustStore: true,
        preservesAgentPolicyGate: true,
        securityAuditPathOwnedByBackend: true,
        requestLifecycleEvidenceOnly: true,
      },
    }
  }

  addWorkspaceTrustTransitionParticipant(participant: WorkspaceTrustTransitionParticipant): Disposable {
    this.transitionParticipants.add(participant)
    return { dispose: () => this.transitionParticipants.delete(participant) }
  }

  clearEvidence(): void {
    this.decisions.length = 0
    this.requests.length = 0
    this.transitions.length = 0
    this.transitionParticipants.clear()
    this.startupFocusDisposable?.dispose()
    this.startupFocusDisposable = null
    this.manageEditorOpenRequests.length = 0
    this.configureSettingsOpenRequests.length = 0
    this.trustedUris.clear()
    this.status = "unknown"
    this.root = ""
    this.pendingRoot = ""
    this.acceptsOutOfWorkspaceFilesValue = false
    this.resolveWorkspaceTrustRequest(this.buildWorkspaceTrustDecisionEvidence("", "unknown", false))
    this.trustEventCount = 0
    this.trustedFoldersEventCount = 0
    this.bannerService.clearEvidence()
    this.hostReloadService.clearEvidence()
    this.updateWorkspaceTrustContextKeys()
    this.updateWorkspaceTrustStatusbarEntry()
    this.updateWorkspaceTrustBanner()
  }

  private fireTrustChange(trusted: boolean): void {
    this.trustEventCount += 1
    this.onDidChangeTrustEmitter.fire(trusted)
  }

  private updateWorkspaceTrustContextKeys(): void {
    workspaceTrustEnabledContextKey.set(globalWorkspaceTrustEnablementService.isWorkspaceTrustEnabled())
    workspaceTrustTrustedContextKey.set(this.isWorkspaceTrusted())
    workspaceTrustLegacyContextKey.set(this.isWorkspaceTrusted())
  }

  private updateWorkspaceTrustStatusbarEntry(): void {
    const shouldShow = this.getWorkspaceTrustStartupPolicySettings().enabled && (this.status === "restricted" || this.status === "pending")
    if (!shouldShow) {
      this.workspaceTrustStatusbarEntry?.dispose()
      this.workspaceTrustStatusbarEntry = null
      return
    }

    const entry = {
      name: "工作区信任",
      text: "受限模式",
      ariaLabel: "受限模式：当前工作区未受信任，部分功能已停用。",
      tooltip: "当前处于受限模式。管理工作区信任后可启用全部功能。",
      command: WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage,
      kind: "prominent" as const,
      source: "WorkspaceTrustUXHandler",
    }
    if (this.workspaceTrustStatusbarEntry) {
      this.workspaceTrustStatusbarEntry.update(entry)
      return
    }
    this.workspaceTrustStatusbarEntry = this.statusbarService.addEntry(
      entry,
      "status.workspaceTrust",
      WorkbenchStatusbarAlignment.LEFT,
      Number.POSITIVE_INFINITY,
    )
  }

  private getWorkspaceTrustStatusbarProjection(): WorkspaceTrustStatusbarProjection {
    const visible = Boolean(this.workspaceTrustStatusbarEntry)
    return {
      serviceId: "statusbarService",
      stateSource: "WorkbenchStatusbarService",
      entryId: "status.workspaceTrust",
      owner: "WorkspaceTrustUXHandler",
      status: "available",
      visible,
      reason: visible
        ? "WorkspaceTrustUXHandler owns the VS Code-style status.workspaceTrust entry through Codek WorkbenchStatusbarService and the existing App.vue statusbar renderer"
        : "WorkspaceTrustUXHandler owns status.workspaceTrust through Codek WorkbenchStatusbarService; entry is hidden while workspace trust is trusted or disabled",
    }
  }

  private updateWorkspaceTrustBanner(): void {
    const bannerSetting = this.getWorkspaceTrustStartupPolicySettings().banner
    const shouldShow = this.getWorkspaceTrustStartupPolicySettings().enabled
      && bannerSetting !== "never"
      && (this.status === "restricted" || this.status === "pending")
    if (!shouldShow) {
      this.bannerService.hide(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID)
      return
    }
    if (bannerSetting === "untilDismissed" && this.bannerService.isDismissed(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID)) return
    this.bannerService.show(buildWorkspaceTrustBannerItemProjection(this.status, true, false))
  }

  private getWorkspaceTrustBannerProjection(): WorkspaceTrustBannerItemProjection {
    return this.bannerService.getBannerItem(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID)
  }

  private getWorkspaceTrustStartupPolicySettings(): WorkspaceTrustStartupPolicySettingsSnapshot {
    return readWorkspaceTrustStartupPolicySettings(this.configurationService)
  }

  private fireTrustedFoldersChangeIfNeeded(before: string): void {
    if (before === trustedUrisKey(this.trustedUris)) return
    this.trustedFoldersEventCount += 1
    this.onDidChangeTrustedFoldersEmitter.fire()
  }

  private async runWorkspaceTrustTransitionParticipants(trusted: boolean): Promise<void> {
    let participantError = ""
    for (const participant of [...this.transitionParticipants]) {
      try {
        await participant.participate(trusted)
      } catch (error) {
        participantError = error instanceof Error ? error.message : String(error)
        break
      }
    }
    let stopEvidence: ExtensionHostLifecycleServiceEvidence | undefined
    let startEvidence: ExtensionHostLifecycleServiceEvidence | undefined
    let reloadEvidence: CodekHostReloadEvidence | undefined
    const lifecycleOptions = buildExtensionHostLifecycleOperationOptions(this.root)
    const remoteAuthority = this.getActiveRemoteAuthority()
    if (!trusted && !participantError && remoteAuthority) {
      reloadEvidence = await this.hostReloadService.reload({
        reason: "Changing workspace trust",
        remoteAuthority,
      })
    } else if (!trusted && !participantError) {
      stopEvidence = await globalExtensionHostService.stopExtensionHosts("Changing workspace trust", lifecycleOptions)
    }
    const extensionEnablement = extensionWorkbenchService.recomputeEnablementForWorkspaceTrust(trusted)
    if (!trusted && !remoteAuthority && stopEvidence?.stopped === true && !stopEvidence.vetoed && !stopEvidence.error) {
      startEvidence = await globalExtensionHostService.startExtensionHosts("Changing workspace trust", lifecycleOptions)
    }
    const extensionHostLifecycleContract = extensionWorkbenchService.recordExtensionHostLifecycleEvidence({
      stopEvidence: stopEvidence?.backendEvidence ?? null,
      startEvidence: startEvidence?.backendEvidence ?? null,
    })
    const refreshedEnablement = extensionWorkbenchService.getSurfaceSnapshot().latestEnablementRecompute || extensionEnablement
    const extensionEnablementWithLifecycle: ExtensionWorkbenchEnablementRecomputeEvidence = {
      ...refreshedEnablement,
      lifecycle: extensionHostLifecycleContract,
      hostLifecycleBinding: refreshedEnablement.hostLifecycleBinding,
    }
    const extensionHostLifecycle = buildWorkspaceTrustExtensionHostLifecycleEvidence(trusted, participantError, stopEvidence, startEvidence, reloadEvidence, remoteAuthority)
    this.transitions.push({
      serviceId: String(IWorkspaceTrustManagementService),
      stateSource: "workspaceTrustRoutes+agentPolicy",
      trusted,
      participantCount: this.transitionParticipants.size,
      extensionEnablementRecomputed: extensionEnablement.recomputedCount >= 0,
      extensionEnablement: extensionEnablementWithLifecycle,
      extensionHostLifecycle,
      createdAt: Date.now(),
    })
  }

  private getActiveRemoteAuthority(): string {
    const snapshot = this.remoteAuthorityService.getRemoteAuthoritySnapshot()
    const latestAuthority = snapshot.latestResult?.status === "resolved" ? snapshot.latestResult.authority : ""
    if (latestAuthority) return latestAuthority
    const activeType = snapshot.activeConnectionType
    const activeLabel = snapshot.activeConnectionLabel
    return activeType && activeLabel ? `${activeType}+${activeLabel}` : ""
  }

  private recordTrustRequest(
    kind: WorkspaceTrustRequestKind,
    input: { root?: string; uri?: string; uris?: string[]; message?: string } = {},
    initialStatus: WorkspaceTrustRequestStatus = "pending",
    fireInitiated = true,
    returnInternal = false,
  ): WorkspaceTrustRequestEvidence {
    const request: WorkspaceTrustRequestEvidence = {
      serviceId: String(IWorkspaceTrustManagementService),
      stateSource: "workspaceTrustRoutes+agentPolicy",
      kind,
      root: String(input.root || this.root || ""),
      uri: normalizeTrustUri(input.uri || ""),
      uris: normalizeTrustUris(input.uris || []),
      message: String(input.message || ""),
      status: initialStatus,
      result: "",
      createdAt: Date.now(),
      completedAt: initialStatus === "pending" ? null : Date.now(),
    }
    this.requests.push(request)
    if (initialStatus === "pending" && fireInitiated) this.fireRequestInitiated(request)
    return returnInternal ? request : { ...request, uris: [...request.uris] }
  }

  private fireRequestInitiated(request: WorkspaceTrustRequestEvidence): void {
    const copy = { ...request, uris: [...request.uris] }
    if (request.kind === "workspace" || request.kind === "startup") this.onDidInitiateWorkspaceTrustRequestEmitter.fire(copy)
    else if (request.kind === "openFiles") this.onDidInitiateOpenFilesTrustRequestEmitter.fire(copy)
    else if (request.kind === "resources") this.onDidInitiateResourcesTrustRequestEmitter.fire(copy)
  }

  private completeActiveRequests(
    kind: WorkspaceTrustRequestKind,
    result: WorkspaceTrustStatus | WorkspaceTrustUriResponse,
    status: WorkspaceTrustRequestStatus,
    uri = "",
  ): void {
    const normalizedUri = normalizeTrustUri(uri)
    for (const request of this.requests) {
      if (request.kind !== kind || request.status !== "pending") continue
      if (normalizedUri && request.uri !== normalizedUri) continue
      request.status = status
      request.result = result
      request.completedAt = Date.now()
    }
  }

  private resolveWorkspaceTrustRequest(decision: WorkspaceTrustDecisionEvidence): void {
    this.workspaceTrustRequestResolver?.(decision)
    this.workspaceTrustRequestResolver = null
    this.workspaceTrustRequestPromise = null
  }

  private buildWorkspaceTrustDecisionEvidence(
    root: string,
    status: WorkspaceTrustStatus,
    persisted: boolean,
    persistError?: string,
  ): WorkspaceTrustDecisionEvidence {
    return {
      serviceId: String(IWorkspaceTrustManagementService),
      stateSource: "workspaceTrustRoutes+agentPolicy",
      root: String(root || ""),
      status,
      decision: trustDecisionForStatus(status),
      trusted: status === "trusted",
      createdAt: Date.now(),
      persisted,
      ...(persistError ? { persistError } : {}),
    }
  }

  private async persistWorkspaceTrust(
    root: string,
    status: WorkspaceTrustStatus,
  ): Promise<{ status: WorkspaceTrustStatus; trustedFolders?: string[]; persisted: boolean; error?: string }> {
    if (status === "pending") return { status, persisted: false }
    try {
      const response = await api.post<{ trust?: { status?: unknown; trustedFolders?: unknown[] } }>("/workspace/trust", {
        root,
        status,
        trustedFolders: this.getTrustedUris(),
      })
      const persistedStatus = response?.trust?.status == null
        ? status
        : normalizeTrustStatus(response.trust.status)
      return {
        status: persistedStatus,
        trustedFolders: Array.isArray(response?.trust?.trustedFolders)
          ? normalizeTrustUris(response.trust.trustedFolders)
          : undefined,
        persisted: true,
      }
    } catch (error) {
      return {
        status,
        persisted: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

export class CodekWorkbenchHostReloadService implements CodekHostReloadService {
  declare readonly _serviceBrand: undefined
  private latestReloadEvidence: CodekHostReloadEvidence | null = null

  constructor(
    private readonly reloadDelegate?: CodekHostReloadDelegate,
  ) {}

  async reload(options: CodekHostReloadOptions = {}): Promise<CodekHostReloadEvidence> {
    const base = {
      source: "CodekHostReloadService.reload" as const,
      serviceId: "hostService" as const,
      vscodeServiceId: "IHostService" as const,
      requested: true,
      disableExtensions: options.disableExtensions === true,
      reason: String(options.reason || ""),
      remoteAuthority: String(options.remoteAuthority || ""),
      blockedOwner: "workbenchWindowReloadService" as const,
      blockedBoundary: "requiresAppWindowShellOrElectronMainReloadOwner" as const,
      createdAt: Date.now(),
    }
    if (!this.reloadDelegate) {
      this.latestReloadEvidence = {
        ...base,
        reloaded: false,
        delegateAvailable: false,
        currentOwner: "rendererFacadeOnly",
        error: "No App/window shell or Electron main workbench-window reload delegate is registered for WorkspaceTrust remote downgrade",
      }
      return this.latestReloadEvidence
    }
    try {
      await this.reloadDelegate(options)
      this.latestReloadEvidence = {
        ...base,
        reloaded: true,
        delegateAvailable: true,
        currentOwner: "appWindowShellOrElectronMain",
      }
    } catch (error) {
      this.latestReloadEvidence = {
        ...base,
        reloaded: false,
        delegateAvailable: true,
        currentOwner: "appWindowShellOrElectronMain",
        error: error instanceof Error ? error.message : String(error),
      }
    }
    return this.latestReloadEvidence
  }

  getLatestReloadEvidence(): CodekHostReloadEvidence | null {
    return this.latestReloadEvidence
  }

  clearEvidence(): void {
    this.latestReloadEvidence = null
  }
}

type CodekWorkbenchWindowReloadBridgeResult = {
  ok?: boolean
  reloaded?: boolean
  dryRun?: boolean
  error?: string
}

function getCodekWorkbenchWindowReloadBridge(): ((options?: CodekHostReloadOptions) => Promise<CodekWorkbenchWindowReloadBridgeResult | void>) | null {
  const codek = (typeof globalThis !== "undefined"
    ? (globalThis as { codek?: { reloadWorkbenchWindow?: (options?: CodekHostReloadOptions) => Promise<CodekWorkbenchWindowReloadBridgeResult | void> } }).codek
    : undefined)
  return typeof codek?.reloadWorkbenchWindow === "function" ? codek.reloadWorkbenchWindow.bind(codek) : null
}

export function resolveCodekWorkbenchWindowReloadDelegate(): CodekHostReloadDelegate | undefined {
  const reloadWorkbenchWindow = getCodekWorkbenchWindowReloadBridge()
  if (!reloadWorkbenchWindow) return undefined
  return async (options: CodekHostReloadOptions = {}) => {
    const result = await reloadWorkbenchWindow({
      disableExtensions: options.disableExtensions === true,
      reason: options.reason,
      remoteAuthority: options.remoteAuthority,
      dryRun: options.dryRun === true,
    })
    if (result && result.ok === false) {
      throw new Error(result.error || "Electron main workbench-window reload delegate rejected the request")
    }
  }
}

export class WorkspaceTrustEnablementWorkbenchService implements WorkspaceTrustEnablementService {
  declare readonly _serviceBrand: undefined

  constructor(private readonly configurationService: IConfigurationService = workbenchConfigurationService) {}

  isWorkspaceTrustEnabled(): boolean {
    return this.configurationService.getValue<boolean>(WORKSPACE_TRUST_ENABLED_CONFIGURATION_KEY) !== false
  }

  getEnablementSnapshot(): WorkspaceTrustEnablementProjection {
    return {
      serviceId: String(IWorkspaceTrustEnablementService),
      stateSource: "workspaceTrustRoutes+agentPolicy",
      enabled: this.isWorkspaceTrustEnabled(),
      disableWorkspaceTrust: !this.isWorkspaceTrustEnabled(),
      configurationKey: "security.workspace.trust.enabled",
      constraints: {
        noSecondTrustEnablementStore: true,
        preservesAgentPolicyGate: true,
      },
    }
  }
}

export class RemoteAuthorityResolverWorkbenchService implements RemoteAuthorityResolverService {
  declare readonly _serviceBrand: undefined
  private readonly results: RemoteAuthorityResolveEvidence[] = []
  private readonly cache = new Map<string, RemoteAuthorityResolveEvidence>()
  private readonly redactedConnectionTokenAuthorities = new Set<string>()

  async resolveAuthority(authority: string, options: RemoteAuthorityResolveOptions = {}): Promise<RemoteAuthorityResolveEvidence> {
    const normalizedAuthority = String(authority || "").trim()
    const cached = this.cache.get(normalizedAuthority)
    if (cached && !options.type && !options.target && !options.sshConfig) {
      const evidence = { ...cached, cacheHit: true, createdAt: Date.now() }
      this.results.push(evidence)
      return evidence
    }

    try {
      const manager = getRemoteManager()
      const connection = await resolveRemoteConnection(manager, normalizedAuthority, options)
      const evidence = buildRemoteAuthorityEvidence(normalizedAuthority, connection, "", false)
      this.cache.set(normalizedAuthority, evidence)
      this.results.push(evidence)
      return evidence
    } catch (error) {
      const evidence = buildRemoteAuthorityEvidence(normalizedAuthority, null, error instanceof Error ? error.message : String(error), false)
      this.results.push(evidence)
      return evidence
    }
  }

  getConnectionData(authority: string): RemoteAuthorityResolveEvidence | null {
    return this.cache.get(String(authority || "").trim()) || null
  }

  async getCanonicalURI(uri: string): Promise<string> {
    return String(uri || "")
  }

  getRemoteAuthorityContextProjection(trust?: WorkspaceTrustWorkbenchSnapshot): RemoteAuthorityContextProjection {
    const active = getRemoteManager().activeConnection
    const latest = this.results.at(-1) || null
    const authority = latest?.authority || ""
    const remoteName = remoteAuthorityPrefix(authority)
    return {
      serviceId: String(IRemoteAuthorityResolverService),
      stateSource: "remoteManager+workspaceTrustRoutes",
      authority,
      remoteName,
      hostLabel: parseRemoteTarget(authority),
      isRemote: Boolean(authority || active),
      isTrusted: trust ? trust.trusted : latest?.optionsTrusted === true,
      restrictedMode: trust ? trust.restrictedMode.enabled : latest?.optionsTrusted === false,
      activeConnectionLabel: active?.label || "",
      activeConnectionType: active?.type || "",
      resolveStatus: latest?.status || "unknown",
      optionsTrusted: latest?.optionsTrusted === true,
      authenticationSessionProviderId: latest?.authenticationSessionProviderId || "",
      authenticationSessionId: latest?.authenticationSessionId || "",
      constraints: {
        noSecondRemoteState: true,
        noCredentialPersistence: true,
        connectionTokensRedacted: true,
      },
    }
  }

  _clearResolvedAuthority(authority: string): void {
    this.clearResolvedAuthority(authority)
  }

  _setResolvedAuthority(
    resolvedAuthority: RemoteAuthorityResolvedProjection,
    resolvedOptions: RemoteAuthorityResolvedOptionsProjection = {},
  ): void {
    const authority = String(resolvedAuthority.authority || "").trim()
    if (resolvedAuthority.connectionToken) this.redactedConnectionTokenAuthorities.add(authority)
    const evidence = buildRemoteAuthorityEvidence(
      authority,
      {
        id: resolvedAuthority.connectionId || resolvedAuthority.id || authority,
        type: resolvedAuthority.type || remoteAuthorityType(authority),
        label: resolvedAuthority.label || authority,
      } as RemoteConnection,
      "",
      false,
      resolvedOptions,
    )
    this.cache.set(authority, evidence)
    this.results.push(evidence)
  }

  _setResolvedAuthorityError(authority: string, error: unknown): void {
    this.recordResolvedAuthorityFailureForEvidence(authority, error instanceof Error ? error.message : String(error || "remote authority resolver failed"))
  }

  _setAuthorityConnectionToken(authority: string, _connectionToken: string): void {
    this.redactedConnectionTokenAuthorities.add(String(authority || "").trim())
  }

  recordResolvedAuthorityForEvidence(authority: string, connection: Pick<RemoteConnection, "id" | "type" | "label">): RemoteAuthorityResolveEvidence {
    const evidence = buildRemoteAuthorityEvidence(String(authority || "").trim(), connection as RemoteConnection, "", false)
    this.cache.set(evidence.authority, evidence)
    this.results.push(evidence)
    return evidence
  }

  recordResolvedAuthorityCacheHitForEvidence(authority: string): RemoteAuthorityResolveEvidence {
    const normalizedAuthority = String(authority || "").trim()
    const cached = this.cache.get(normalizedAuthority) || buildRemoteAuthorityEvidence(normalizedAuthority, null, "resolved authority cache is empty", false)
    const evidence = { ...cached, cacheHit: true, createdAt: Date.now() }
    this.results.push(evidence)
    return evidence
  }

  recordResolvedAuthorityFailureForEvidence(authority: string, error: string): RemoteAuthorityResolveEvidence {
    const evidence = buildRemoteAuthorityEvidence(String(authority || "").trim(), null, String(error || "remote authority resolver failed"), false)
    this.results.push(evidence)
    return evidence
  }

  getRemoteAuthoritySnapshot(): RemoteAuthorityWorkbenchSnapshot {
    const active = getRemoteManager().activeConnection
    return {
      serviceId: String(IRemoteAuthorityResolverService),
      stateSource: "remoteManager",
      resolveCount: this.results.length,
      successCount: this.results.filter((result) => result.status === "resolved").length,
      failureCount: this.results.filter((result) => result.status === "error").length,
      cacheHitCount: this.results.filter((result) => result.cacheHit).length,
      latestResult: this.results.at(-1) || null,
      results: [...this.results],
      activeConnectionLabel: active?.label || "",
      activeConnectionType: active?.type || "",
      cachedAuthorities: [...this.cache.keys()],
      constraints: {
        noSecondRemoteState: true,
        noCredentialPersistence: true,
        resolverCacheEvidenceOnly: true,
        connectionTokensRedacted: true,
      },
    }
  }

  clearResolvedAuthority(authority?: string): void {
    if (authority) {
      const normalizedAuthority = String(authority).trim()
      this.cache.delete(normalizedAuthority)
      this.redactedConnectionTokenAuthorities.delete(normalizedAuthority)
    } else {
      this.cache.clear()
      this.redactedConnectionTokenAuthorities.clear()
    }
  }

  clearEvidence(): void {
    this.results.length = 0
    this.cache.clear()
    this.redactedConnectionTokenAuthorities.clear()
  }
}

export class AuthenticationWorkbenchService implements AuthenticationService {
  declare readonly _serviceBrand: undefined
  private readonly sessions: AuthenticationSessionEvidence[] = []

  observeCodekAuthState(scopes: string[] = []): AuthenticationSessionEvidence {
    const evidence = buildAuthenticationSessionEvidence(scopes)
    this.sessions.push(evidence)
    return evidence
  }

  async requestSession(providerId: string = auth.oauthProvider || "github", scopes: string[] | string = []): Promise<AuthenticationSessionEvidence> {
    if (auth.isLoggedIn) {
      const evidence = buildAuthenticationSessionEvidence(normalizeScopes(scopes), providerId, "authorized")
      this.sessions.push(evidence)
      return evidence
    }
    const evidence = buildAuthenticationSessionEvidence(normalizeScopes(scopes), providerId, authenticationStatusFromAuthState())
    this.sessions.push(evidence)
    return evidence
  }

  revokeSession(providerId: string = auth.oauthProvider || "github", accountLabel: string = auth.username || auth.email || "codek"): AuthenticationSessionEvidence {
    const evidence = buildAuthenticationSessionEvidence([], providerId, "revoked", accountLabel)
    this.sessions.push(evidence)
    return evidence
  }

  async getSessions(providerId: string = auth.oauthProvider || "github", scopes: string[] | string = []): Promise<AuthenticationSessionEvidence[]> {
    if (!auth.isLoggedIn) {
      const evidence = buildAuthenticationSessionEvidence(normalizeScopes(scopes), providerId, authenticationStatusFromAuthState())
      this.sessions.push(evidence)
      return []
    }
    const evidence = buildAuthenticationSessionEvidence(normalizeScopes(scopes), providerId, "authorized")
    this.sessions.push(evidence)
    return [evidence]
  }

  async createSession(providerId: string = auth.oauthProvider || "github", scopes: string[] | string = []): Promise<AuthenticationSessionEvidence> {
    return this.requestSession(providerId, scopes)
  }

  async removeSession(providerId: string, sessionId: string): Promise<void> {
    const [, accountLabel = ""] = String(sessionId || "").split(":", 2)
    this.revokeSession(providerId, accountLabel || auth.username || auth.email || "codek")
  }

  recordSessionForEvidence(
    providerId: string,
    status: AuthenticationSessionStatus,
    accountLabel = "",
    scopes: string[] = [],
    error = "",
  ): AuthenticationSessionEvidence {
    const previousError = auth.loginError
    if (status === "error" && error) auth.loginError = error
    const evidence = buildAuthenticationSessionEvidence(scopes, providerId, status, accountLabel)
    if (status === "error" && error) auth.loginError = previousError
    this.sessions.push(evidence)
    return evidence
  }

  getAuthenticationSnapshot(): AuthenticationWorkbenchSnapshot {
    const latest = this.sessions.at(-1) || buildAuthenticationSessionEvidence()
    const statuses = [...new Set(this.sessions.map((session) => session.status))]
    if (!statuses.length) statuses.push(latest.status)
    return {
      serviceId: String(IAuthenticationService),
      stateSource: "authState+mcpRegistryClient",
      providerIds: [...new Set([auth.oauthProvider || "", "github"].filter(Boolean))],
      latestSession: latest,
      sessions: [...this.sessions],
      statuses,
      hasToken: Boolean(auth.token),
      oauthStatus: auth.oauthStatus,
      oauthProvider: auth.oauthProvider,
      constraints: {
        noTokenInEvidence: true,
        noSecondAuthStore: true,
        sharesMcpOAuthSessionBoundary: true,
        preservesSecureStore: true,
      },
    }
  }

  clearEvidence(): void {
    this.sessions.length = 0
  }
}

export const globalExtensionHostService = new ExtensionHostWorkbenchService()
export const globalCodekHostReloadService = new CodekWorkbenchHostReloadService(resolveCodekWorkbenchWindowReloadDelegate())
export const globalWorkspaceTrustEnablementService = new WorkspaceTrustEnablementWorkbenchService()
export const globalWorkspaceTrustBannerService = new WorkspaceTrustBannerWorkbenchService()
export const globalCodekHostFocusService = new CodekWindowHostFocusService()
export const globalRemoteAuthorityResolverService = new RemoteAuthorityResolverWorkbenchService()
export const globalWorkspaceTrustManagementService = new WorkspaceTrustWorkbenchService()
export const globalAuthenticationService = new AuthenticationWorkbenchService()

registerSingleton(IExtensionHostService, globalExtensionHostService, InstantiationType.Delayed)
registerSingleton(IHostService, globalCodekHostReloadService, InstantiationType.Delayed)
registerSingleton(IWorkspaceTrustEnablementService, globalWorkspaceTrustEnablementService, InstantiationType.Delayed)
registerSingleton(IWorkspaceTrustManagementService, globalWorkspaceTrustManagementService, InstantiationType.Delayed)
registerSingleton(IRemoteAuthorityResolverService, globalRemoteAuthorityResolverService, InstantiationType.Delayed)
registerSingleton(IAuthenticationService, globalAuthenticationService, InstantiationType.Delayed)

let registrations: Disposable[] = []

export function registerExtensionTrustRemoteAuthWorkbenchContributions(): Disposable {
  disposeExtensionTrustRemoteAuthWorkbenchContributions()
  registerExtensionTrustRemoteAuthViews()

  registrations = [
    globalWorkspaceTrustManagementService.registerWorkspaceTrustDialogShell(globalCodekDialogService),
    globalWorkspaceTrustManagementService.registerWorkspaceTrustManageEditorShell(globalWorkbenchExplorerEditorService),
    globalWorkspaceTrustManagementService.registerWorkspaceTrustConfigureSettingsShell(() => {}),
    registerExtensionHostActivationAction(),
    registerWorkspaceTrustManageAction(),
    registerWorkspaceTrustConfigureAction(),
    registerWorkspaceTrustFilterUntrustedSettingsAction(),
    registerWorkspaceTrustOpenAction(),
    registerWorkspaceTrustAllowAction(),
    registerWorkspaceTrustDenyAction(),
    registerRemoteAuthorityOpenAction(),
    registerRemoteAuthorityResolveAction(),
    registerRemoteAuthorityClearCacheAction(),
    registerAuthenticationOpenAction(),
    registerAuthenticationRequestSessionAction(),
    registerAuthenticationRevokeSessionAction(),
  ]
  return { dispose: disposeExtensionTrustRemoteAuthWorkbenchContributions }
}

export function disposeExtensionTrustRemoteAuthWorkbenchContributions(): void {
  for (const disposable of registrations.splice(0)) disposable.dispose()
}

export function clearExtensionTrustRemoteAuthWorkbenchEvidence(): void {
  globalExtensionHostService.clearEvidence()
  globalCodekHostReloadService.clearEvidence()
  globalWorkspaceTrustBannerService.clearEvidence()
  globalWorkspaceTrustManagementService.clearEvidence()
  globalRemoteAuthorityResolverService.clearEvidence()
  globalAuthenticationService.clearEvidence()
}

export function seedRemoteAuthorityWorkbenchEvidenceForSmoke(): RemoteAuthorityWorkbenchSnapshot {
  globalRemoteAuthorityResolverService.recordResolvedAuthorityForEvidence("wsl+CodekSmoke", {
    id: "codek-smoke-remote",
    type: "wsl",
    label: "WSL: CodekSmoke",
  })
  globalRemoteAuthorityResolverService.recordResolvedAuthorityCacheHitForEvidence("wsl+CodekSmoke")
  globalRemoteAuthorityResolverService.recordResolvedAuthorityFailureForEvidence("ssh-remote+blocked", "resolver offline")
  return globalRemoteAuthorityResolverService.getRemoteAuthoritySnapshot()
}

export function seedAuthenticationWorkbenchEvidenceForSmoke(): AuthenticationWorkbenchSnapshot {
  const service = globalAuthenticationService as AuthenticationWorkbenchService
  service.recordSessionForEvidence("github", "missing", "", ["repo"])
  service.recordSessionForEvidence("github", "pending", "codek-smoke", ["repo"])
  service.recordSessionForEvidence("github", "authorized", "codek-smoke", ["repo"])
  service.recordSessionForEvidence("github", "expired", "codek-smoke", ["repo"])
  service.revokeSession("github", "codek-smoke")
  service.recordSessionForEvidence("github", "error", "codek-smoke", ["repo"], "smoke authentication error")
  return globalAuthenticationService.getAuthenticationSnapshot()
}

export function getExtensionTrustRemoteAuthWorkbenchSurfaceSnapshot(): ExtensionTrustRemoteAuthWorkbenchSnapshot {
  return {
    source: "extensionTrustRemoteAuthWorkbenchService",
    containerId: EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.Container,
    viewIds: [
      EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.ExtensionHost,
      EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.WorkspaceTrust,
      EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.RemoteAuthority,
      EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.Authentication,
    ],
    commandIds: [
      EXTENSION_HOST_WORKBENCH_COMMAND_IDS.ActivatePlaceholder,
      EXTENSION_HOST_WORKBENCH_COMMAND_IDS.OpenExtensions,
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Open,
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Configure,
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Allow,
      WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Deny,
      REMOTE_AUTHORITY_WORKBENCH_COMMAND_IDS.Open,
      REMOTE_AUTHORITY_WORKBENCH_COMMAND_IDS.Resolve,
      REMOTE_AUTHORITY_WORKBENCH_COMMAND_IDS.ClearCache,
      AUTHENTICATION_WORKBENCH_COMMAND_IDS.Open,
      AUTHENTICATION_WORKBENCH_COMMAND_IDS.RequestSession,
      AUTHENTICATION_WORKBENCH_COMMAND_IDS.RevokeSession,
    ],
    serviceIds: {
      extensionHost: String(IExtensionHostService),
      workspaceTrust: String(IWorkspaceTrustManagementService),
      workspaceTrustEnablement: String(IWorkspaceTrustEnablementService),
      remoteAuthority: String(IRemoteAuthorityResolverService),
      authentication: String(IAuthenticationService),
    },
    stateSource: "facade",
    extensionHost: globalExtensionHostService.getExtensionHostSnapshot(),
    workspaceTrust: globalWorkspaceTrustManagementService.getTrustSnapshot(),
    remoteAuthority: globalRemoteAuthorityResolverService.getRemoteAuthoritySnapshot(),
    authentication: globalAuthenticationService.getAuthenticationSnapshot(),
    constraints: {
      noSecondExtensionRuntime: true,
      noSecondTrustStore: true,
      noSecondRemoteState: true,
      noSecondAuthStore: true,
      preservesAgentEvidence: true,
      viewActionMenuDriven: true,
    },
  }
}

function registerExtensionTrustRemoteAuthViews(): void {
  registerViewContainer({
    id: EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.Container,
    name: "扩展 / 信任 / 远程 / 认证",
    location: "activityBar",
    icon: "shield",
    source: "vscode",
    order: 57,
  })
  registerView({
    id: EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.ExtensionHost,
    name: "扩展宿主",
    containerId: EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.Container,
    location: "sideBar",
    source: "vscode",
    order: 10,
  })
  registerView({
    id: EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.WorkspaceTrust,
    name: "工作区信任",
    containerId: EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.Container,
    location: "sideBar",
    source: "vscode",
    order: 20,
  })
  registerView({
    id: EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.RemoteAuthority,
    name: "远程授权",
    containerId: EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.Container,
    location: "sideBar",
    source: "vscode",
    order: 30,
  })
  registerView({
    id: EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.Authentication,
    name: "认证",
    containerId: EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.Container,
    location: "sideBar",
    source: "vscode",
    order: 40,
  })
}

function registerExtensionHostActivationAction(): Disposable {
  return registerAction2(class ExtensionHostActivationAction extends Action2 {
    constructor() {
      super({
        id: EXTENSION_HOST_WORKBENCH_COMMAND_IDS.ActivatePlaceholder,
        title: "扩展：记录激活证据",
        category: "扩展",
        f1: true,
        source: "vscode",
        menu: { id: MenuId.ViewTitle, when: `view == ${EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.ExtensionHost}`, group: "navigation", order: 10 },
      })
    }

    async run(_accessor: unknown, activationEvent?: unknown, extensionId?: unknown): Promise<void> {
      await globalExtensionHostService.activateByEvent(String(activationEvent || "onStartupFinished"), String(extensionId || "codek.placeholder"))
    }
  })
}

function registerWorkspaceTrustOpenAction(): Disposable {
  return registerNoopAction(WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Open, "工作区信任：打开", "工作区信任", {
    id: MenuId.MenubarViewMenu,
    group: "1_views",
    order: 145,
  })
}

function registerWorkspaceTrustManageAction(): Disposable {
  return registerAction2(class WorkspaceTrustManageAction extends Action2 {
    constructor() {
      super({
        id: WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage,
        title: "管理工作区信任",
        category: "工作区",
        f1: true,
        source: "vscode",
        menu: [
          { id: MenuId.MenubarViewMenu, group: "1_views", order: 144 },
          { id: MenuId.ViewTitle, when: `view == ${EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.WorkspaceTrust}`, group: "navigation", order: 5 },
        ],
      })
    }

    run(): void {
      globalWorkspaceTrustManagementService.openWorkspaceTrustManageEditor()
    }
  })
}

function registerWorkspaceTrustConfigureAction(): Disposable {
  return registerAction2(class WorkspaceTrustConfigureAction extends Action2 {
    constructor() {
      super({
        id: WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Configure,
        title: "配置工作区信任设置",
        category: "工作区",
        f1: true,
        source: "vscode",
        menu: [
          { id: MenuId.CommandPalette, group: "preferences", order: 205 },
          { id: MenuId.ViewTitle, when: `view == ${EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.WorkspaceTrust}`, group: "navigation", order: 6 },
        ],
      })
    }

    run(): void {
      globalWorkspaceTrustManagementService.openWorkspaceTrustConfigureSettings()
    }
  })
}

function registerWorkspaceTrustFilterUntrustedSettingsAction(): Disposable {
  return registerAction2(class WorkspaceTrustFilterUntrustedSettingsAction extends Action2 {
    constructor() {
      super({
        id: SETTINGS_EDITOR_COMMAND_FILTER_UNTRUSTED,
        title: "显示不受信任工作区设置",
        category: "首选项",
        f1: true,
        source: "vscode",
        menu: [
          { id: MenuId.CommandPalette, group: "preferences", order: 206 },
        ],
      })
    }

    run(): void {
      globalWorkspaceTrustManagementService.openWorkspaceTrustConfigureSettings()
    }
  })
}

function registerWorkspaceTrustAllowAction(): Disposable {
  return registerAction2(class WorkspaceTrustAllowAction extends Action2 {
    constructor() {
      super({
        id: WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Allow,
        title: "工作区信任：信任当前工作区",
        category: "工作区信任",
        f1: true,
        source: "vscode",
        menu: { id: MenuId.ViewTitle, when: `view == ${EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.WorkspaceTrust}`, group: "navigation", order: 10 },
      })
    }

    async run(_accessor: unknown, root?: unknown): Promise<void> {
      await globalWorkspaceTrustManagementService.setWorkspaceTrust(String(root || ""), "trusted")
    }
  })
}

function registerWorkspaceTrustDenyAction(): Disposable {
  return registerAction2(class WorkspaceTrustDenyAction extends Action2 {
    constructor() {
      super({
        id: WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Deny,
        title: "工作区信任：限制当前工作区",
        category: "工作区信任",
        f1: true,
        source: "vscode",
        menu: { id: MenuId.ViewTitle, when: `view == ${EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.WorkspaceTrust}`, group: "navigation", order: 20 },
      })
    }

    async run(_accessor: unknown, root?: unknown): Promise<void> {
      await globalWorkspaceTrustManagementService.setWorkspaceTrust(String(root || ""), "restricted")
    }
  })
}

function registerRemoteAuthorityOpenAction(): Disposable {
  return registerNoopAction(REMOTE_AUTHORITY_WORKBENCH_COMMAND_IDS.Open, "远程：打开远程授权", "远程", {
    id: MenuId.MenubarViewMenu,
    group: "1_views",
    order: 150,
  })
}

function registerRemoteAuthorityResolveAction(): Disposable {
  return registerAction2(class RemoteAuthorityResolveAction extends Action2 {
    constructor() {
      super({
        id: REMOTE_AUTHORITY_WORKBENCH_COMMAND_IDS.Resolve,
        title: "远程：解析授权",
        category: "远程",
        f1: true,
        source: "vscode",
        menu: { id: MenuId.ViewTitle, when: `view == ${EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.RemoteAuthority}`, group: "navigation", order: 10 },
      })
    }

    async run(_accessor: unknown, authority?: unknown, options?: unknown): Promise<void> {
      await globalRemoteAuthorityResolverService.resolveAuthority(String(authority || ""), isRecord(options) ? options as RemoteAuthorityResolveOptions : {})
    }
  })
}

function registerRemoteAuthorityClearCacheAction(): Disposable {
  return registerAction2(class RemoteAuthorityClearCacheAction extends Action2 {
    constructor() {
      super({
        id: REMOTE_AUTHORITY_WORKBENCH_COMMAND_IDS.ClearCache,
        title: "远程：清除授权解析缓存",
        category: "远程",
        f1: true,
        source: "vscode",
        menu: { id: MenuId.ViewTitle, when: `view == ${EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.RemoteAuthority}`, group: "navigation", order: 20 },
      })
    }

    run(_accessor: unknown, authority?: unknown): void {
      globalRemoteAuthorityResolverService.clearResolvedAuthority(typeof authority === "string" ? authority : undefined)
    }
  })
}

function registerAuthenticationOpenAction(): Disposable {
  return registerNoopAction(AUTHENTICATION_WORKBENCH_COMMAND_IDS.Open, "账号：打开认证", "账号", {
    id: MenuId.MenubarViewMenu,
    group: "1_views",
    order: 155,
  })
}

function registerAuthenticationRequestSessionAction(): Disposable {
  return registerAction2(class AuthenticationRequestSessionAction extends Action2 {
    constructor() {
      super({
        id: AUTHENTICATION_WORKBENCH_COMMAND_IDS.RequestSession,
        title: "账号：请求认证会话",
        category: "账号",
        f1: true,
        source: "vscode",
        menu: { id: MenuId.ViewTitle, when: `view == ${EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.Authentication}`, group: "navigation", order: 10 },
      })
    }

    async run(_accessor: unknown, providerId?: unknown, scopes?: unknown): Promise<void> {
      await globalAuthenticationService.requestSession(String(providerId || "github"), normalizeScopes(scopes))
    }
  })
}

function registerAuthenticationRevokeSessionAction(): Disposable {
  return registerAction2(class AuthenticationRevokeSessionAction extends Action2 {
    constructor() {
      super({
        id: AUTHENTICATION_WORKBENCH_COMMAND_IDS.RevokeSession,
        title: "账号：撤销认证会话",
        category: "账号",
        f1: true,
        source: "vscode",
        menu: { id: MenuId.ViewTitle, when: `view == ${EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS.Authentication}`, group: "navigation", order: 20 },
      })
    }

    run(_accessor: unknown, providerId?: unknown, accountLabel?: unknown): void {
      globalAuthenticationService.revokeSession(String(providerId || "github"), String(accountLabel || "codek"))
    }
  })
}

function registerNoopAction(
  id: string,
  title: string,
  category: string,
  menu: { id: MenuId; group?: string; order?: number; when?: string },
): Disposable {
  return registerAction2(class WorkbenchOpenAction extends Action2 {
    constructor() {
      super({
        id,
        title,
        category,
        f1: true,
        source: "vscode",
        menu,
      })
    }

    run(): void {}
  })
}

function normalizeTrustStatus(value: unknown): WorkspaceTrustStatus {
  return value === "trusted" || value === "restricted" || value === "unknown" || value === "pending" ? value : "unknown"
}

function trustDecisionForStatus(status: WorkspaceTrustStatus): WorkspaceTrustDecision {
  if (status === "trusted") return "allow"
  if (status === "restricted") return "deny"
  if (status === "pending") return "pending"
  return "unknown"
}

function normalizeTrustUri(uri: unknown): string {
  return String(uri || "").trim().replace(/\\/g, "/").replace(/\/+$/, "")
}

function normalizeTrustUris(uris: unknown[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of uris) {
    const uri = normalizeTrustUri(value)
    if (!uri || seen.has(uri)) continue
    seen.add(uri)
    result.push(uri)
  }
  return result
}

function longestTrustedUri(uri: string, trustedUris: Set<string>): string {
  let match = ""
  for (const trustedUri of trustedUris) {
    if (uri === trustedUri || uri.startsWith(`${trustedUri}/`)) {
      if (trustedUri.length > match.length) match = trustedUri
    }
  }
  return match
}

function trustedUrisKey(trustedUris: Set<string>): string {
  return [...trustedUris].sort().join("\n")
}

function buildExtensionHostLifecycleServiceEvidence(
  action: "stopExtensionHosts" | "startExtensionHosts",
  reason: string,
  error = "",
  backendEvidence?: ExtensionHostLifecycleOperationEvidence,
): ExtensionHostLifecycleServiceEvidence {
  const requested = backendEvidence?.requested !== false
  const base = {
    serviceId: String(IExtensionHostService),
    stateSource: "extensionsWorkbenchService+ehClient" as const,
    vscodeContract: action === "stopExtensionHosts"
      ? "IExtensionService.stopExtensionHosts" as const
      : "IExtensionService.startExtensionHosts" as const,
    action,
    reason: backendEvidence?.reason || reason,
    ...(backendEvidence?.auto !== undefined ? { auto: backendEvidence.auto } : {}),
    ...(backendEvidence?.rootDir ? { rootDir: backendEvidence.rootDir } : {}),
    ...(backendEvidence?.workspaceRoots ? { workspaceRoots: [...backendEvidence.workspaceRoots] } : {}),
    ...(backendEvidence?.workspaceFile !== undefined ? { workspaceFile: backendEvidence.workspaceFile } : {}),
    requested,
    createdAt: backendEvidence?.createdAt || Date.now(),
    ...(backendEvidence ? { backendEvidence } : {}),
    ...(error ? { error } : {}),
  }
  if (action === "stopExtensionHosts") {
    return {
      ...base,
      stopped: backendEvidence?.stopped === true,
      wasRunning: backendEvidence?.wasRunning === true,
      vetoed: backendEvidence?.vetoed === true,
      vetoReason: backendEvidence?.vetoReason || "",
    }
  }
  return {
    ...base,
    started: backendEvidence?.started === true,
    alreadyRunning: backendEvidence?.alreadyRunning === true,
  }
}

function buildRestrictedModeProjection(status: WorkspaceTrustStatus): WorkspaceTrustRestrictedModeProjection {
  const restricted = status !== "trusted"
  return {
    enabled: restricted,
    canExecuteCommands: !restricted,
    canUseNetwork: !restricted,
    canInstallExtensions: !restricted,
    canWriteWorkspaceFiles: !restricted,
    reason: restricted ? `workspace trust is ${status}` : "",
  }
}

function buildWorkspaceTrustBannerItemProjection(
  status: WorkspaceTrustStatus,
  visible: boolean,
  dismissed: boolean,
): WorkspaceTrustBannerItemProjection {
  const messageSubject = "workspace"
  return {
    id: WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID,
    owner: "WorkspaceTrustUXHandler",
    serviceId: "bannerService",
    stateSource: "WorkspaceTrustBannerService",
    visible,
    dismissed,
    ariaLabel: "受限模式用于安全浏览代码。信任当前工作区后可启用全部功能。可使用键盘导航访问横幅操作。",
    message: "当前处于受限模式，仅适合安全浏览代码。信任当前工作区后可启用全部功能。",
    actions: [
      {
        label: "管理",
        href: `command:${WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage}`,
      },
      {
        label: "了解更多",
        href: WORKSPACE_TRUST_DOCS_HREF,
      },
    ],
    reason: visible
      ? `WorkspaceTrustUXHandler owns ${WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID} through Codek WorkspaceTrustBannerService for ${status || "unknown"} ${messageSubject} trust`
      : dismissed
        ? `${WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_DISMISSED_KEY} is set; WorkspaceTrustBannerService keeps the restricted-mode banner hidden without changing the trust store`
        : `WorkspaceTrustUXHandler owns ${WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID} through Codek WorkspaceTrustBannerService; banner is hidden while workspace trust is trusted, unknown or disabled`,
  }
}

function buildWorkspaceTrustExtensionHostLifecycleEvidence(
  trusted: boolean,
  participantError: string,
  stopEvidence?: ExtensionHostLifecycleServiceEvidence,
  startEvidence?: ExtensionHostLifecycleServiceEvidence,
  reloadEvidence?: CodekHostReloadEvidence,
  remoteAuthority = "",
): WorkspaceTrustExtensionHostLifecycleEvidence {
  const remoteReloadOwnerEvidence = buildWorkspaceTrustRemoteReloadOwnerEvidence(reloadEvidence || null)
  const base = {
    serviceId: String(IWorkspaceTrustManagementService),
    stateSource: "workspaceTrustRoutes+agentPolicy" as const,
    vscodeLocalContract: "stopExtensionHosts+startExtensionHosts" as const,
    vscodeRemoteContract: "hostService.reload" as const,
    remoteReloadOwnerEvidence,
  }
  if (participantError) {
    return {
      ...base,
      action: "none",
      status: "participantFailed",
      restartEvidenceStatus: "blocked",
      restartCompletionSource: "blocked",
      reason: `workspace trust transition participant failed before extension host lifecycle could run: ${participantError}`,
      stopRequested: false,
      stopped: false,
      restartRequested: false,
      restarted: false,
      reloadRequested: false,
      reloaded: false,
      blocked: true,
      blockedBy: "transitionParticipantError",
    }
  }
  if (trusted) {
    return {
      ...base,
      action: "none",
      status: "notRequired",
      restartEvidenceStatus: "notRequested",
      restartCompletionSource: "none",
      reason: "untrusted-to-trusted transition only requires extension enablement recompute in the current Codek service boundary",
      stopRequested: false,
      stopped: false,
      restartRequested: false,
      restarted: false,
      reloadRequested: false,
      reloaded: false,
      blocked: false,
      blockedBy: "none",
    }
  }
  if (remoteAuthority) {
    return {
      ...base,
      action: "reloadWindow",
      status: reloadEvidence?.reloaded === true ? "completed" : "blocked",
      restartEvidenceStatus: "notRequested",
      restartCompletionSource: "none",
      reason: reloadEvidence?.reloaded === true
        ? "remote workspace trust downgrade requested a VS Code-style workbench window reload and IHostService.reload delegate reported completion"
        : "remote workspace trust downgrade reached the Codek host reload facade, but no App/window shell or Electron main workbench-window reload owner completed IHostService.reload",
      stopRequested: false,
      stopped: false,
      restartRequested: false,
      restarted: false,
      reloadRequested: reloadEvidence?.requested === true,
      reloaded: reloadEvidence?.reloaded === true,
      blocked: reloadEvidence?.reloaded !== true,
      blockedBy: reloadEvidence?.reloaded === true ? "none" : "remoteAuthorityReloadNotOwnedHere",
    }
  }
  if (!stopEvidence) {
    return {
      ...base,
      action: "stopStart",
      status: "blocked",
      restartEvidenceStatus: "blocked",
      restartCompletionSource: "blocked",
      reason: "VS Code local trust downgrade requires stopExtensionHosts before recomputing extension enablement, but Codek did not receive lifecycle service evidence",
      stopRequested: true,
      stopped: false,
      restartRequested: true,
      restarted: false,
      reloadRequested: false,
      reloaded: false,
      blocked: true,
      blockedBy: "missingExtensionHostLifecycleService",
    }
  }
  if (stopEvidence.error) {
    return {
      ...base,
      action: "stopStart",
      status: "blocked",
      restartEvidenceStatus: "blocked",
      restartCompletionSource: "blocked",
      reason: `extension host stop failed before workspace trust enablement restart: ${stopEvidence.error}`,
      stopRequested: true,
      stopped: false,
      restartRequested: false,
      restarted: false,
      reloadRequested: false,
      reloaded: false,
      blocked: true,
      blockedBy: "extensionHostLifecycleError",
      stopEvidence,
    }
  }
  if (stopEvidence.vetoed) {
    return {
      ...base,
      action: "stopStart",
      status: "blocked",
      restartEvidenceStatus: "blocked",
      restartCompletionSource: "blocked",
      reason: stopEvidence.vetoReason || "extension host stop was vetoed",
      stopRequested: true,
      stopped: false,
      restartRequested: false,
      restarted: false,
      reloadRequested: false,
      reloaded: false,
      blocked: true,
      blockedBy: "extensionHostStopVeto",
      stopEvidence,
    }
  }
  if (!stopEvidence.stopped) {
    return {
      ...base,
      action: "stopStart",
      status: "notRequired",
      restartEvidenceStatus: "notRequested",
      restartCompletionSource: "none",
      reason: "extension hosts were not running when workspace trust changed; enablement was recomputed without faking a restart",
      stopRequested: true,
      stopped: false,
      restartRequested: false,
      restarted: false,
      reloadRequested: false,
      reloaded: false,
      blocked: false,
      blockedBy: "none",
      stopEvidence,
    }
  }
  if (!startEvidence) {
    return {
      ...base,
      action: "stopStart",
      status: "blocked",
      restartEvidenceStatus: "requested",
      restartCompletionSource: "blocked",
      reason: "extension hosts stopped for workspace trust downgrade but no startExtensionHosts evidence was produced",
      stopRequested: true,
      stopped: true,
      restartRequested: true,
      restarted: false,
      reloadRequested: false,
      reloaded: false,
      blocked: true,
      blockedBy: "missingExtensionHostLifecycleService",
      stopEvidence,
    }
  }
  if (startEvidence.error || !startEvidence.started) {
    return {
      ...base,
      action: "stopStart",
      status: "blocked",
      restartEvidenceStatus: "blocked",
      restartCompletionSource: "blocked",
      reason: startEvidence.error || "extension host start did not report completion after workspace trust downgrade",
      stopRequested: true,
      stopped: true,
      restartRequested: true,
      restarted: false,
      reloadRequested: false,
      reloaded: false,
      blocked: true,
      blockedBy: "extensionHostLifecycleError",
      stopEvidence,
      startEvidence,
    }
  }
  return {
    ...base,
    action: "stopStart",
    status: "completed",
    restartEvidenceStatus: "completed",
    restartCompletionSource: "desktop.extensionsHostService",
    reason: "workspace trust downgrade stopped extension hosts, recomputed extension enablement, then restarted extension hosts through the Codek lifecycle service owner",
    stopRequested: true,
    stopped: true,
      restartRequested: true,
      restarted: true,
      reloadRequested: false,
      reloaded: false,
      blocked: false,
    blockedBy: "none",
    stopEvidence,
    startEvidence,
  }
}

function buildWorkspaceTrustRemoteReloadOwnerEvidence(reloadEvidence: CodekHostReloadEvidence | null = null): WorkspaceTrustRemoteReloadOwnerEvidence {
  const hostServiceReload = reloadEvidence?.reloaded === true
    ? "connected"
    : reloadEvidence?.requested === true
      ? "facadeAvailable"
      : "missing"
  const status: WorkspaceTrustRemoteReloadOwnerStatus = reloadEvidence?.reloaded === true
    ? "connected"
    : reloadEvidence?.requested === true
      ? "partial"
      : "blocked"
  return {
    source: "WorkspaceTrustUXHandler.remoteAuthorityReload",
    status,
    owner: reloadEvidence?.requested === true ? "CodekHostReloadService" : "missingCodekHostReloadOwner",
    vscodeContract: "IHostService.reload",
    vscodeSourcePaths: [
      "src/vs/workbench/contrib/extensions/browser/extensionEnablementWorkspaceTrustTransitionParticipant.ts",
      "src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts",
      "src/vs/workbench/services/host/browser/host.ts",
      "src/vs/workbench/services/host/electron-browser/nativeHostService.ts",
      "src/vs/code/electron-main/app.ts",
    ],
    currentSourcePaths: [
      "frontend/vite-project/src/workbench/extensionTrustRemoteAuthWorkbench.ts",
      "frontend/vite-project/src/extensions/extensionsWorkbenchService.ts",
      "frontend/vite-project/src/extensions/ehClient.ts",
      "desktop/services/extensions-host/index.js",
      "desktop/lifecycle.js",
      "desktop/main.js",
      "frontend/vite-project/src/App.vue",
    ],
    requiredSignals: ["environmentService.remoteAuthority", "hostService.reload"],
    blockedOwner: "workbenchWindowReloadService",
    blockedBoundary: "requiresWorkbenchWindowReloadOwner",
    currentSignals: {
      remoteAuthorityResolver: "available",
      extensionHostStopStartRoutes: "available",
      desktopWindowReloadHook: reloadEvidence?.delegateAvailable === true ? "preloadIpc" : "smokeOnly",
      extensionHostReloadRoute: "extensionHostOnly",
      desktopLifecycleReloadOwner: reloadEvidence?.delegateAvailable === true ? "electronMainBrowserWindowReloadOwner" : "notWorkspaceTrustReloadOwner",
      hostServiceReload,
    },
    availableServiceLifecycleEvidence: ["stopExtensionHosts", "startExtensionHosts"],
    extensionHostReloadRouteScope: "extensionHostOnly",
    missingWindowReloadOwner: "AppWindowShellOrElectronMainReloadOwner",
    cannotSatisfyVscodeHostReloadWithExtensionHostReload: true,
    blockedByCurrentOwnerBoundary: "AppWindowShellOrElectronMainReloadOwner",
    reloadEvidence,
    reason: reloadEvidence?.reloaded === true
      ? "VS Code reloads the workbench window on remote workspace trust downgrade through IHostService.reload when environmentService.remoteAuthority is present. Codek requested and completed that through CodekHostReloadService, preload window:reloadWorkbench IPC, and Electron main BrowserWindow.reload; extension-host-only reload remains explicitly separate."
      : reloadEvidence?.requested === true
        ? "VS Code reloads the workbench window on remote workspace trust downgrade through IHostService.reload when environmentService.remoteAuthority is present. Codek now reaches a HostService-like reload facade, but the default renderer facade has no App/window shell or Electron main delegate, so this remains partial and must not be treated as extension-host reload completion."
        : "VS Code reloads the workbench window on remote workspace trust downgrade through IHostService.reload when environmentService.remoteAuthority is present. Codek currently owns local extension-host stop/start evidence plus an extension-host-only reload route; desktop/lifecycle.js owns close and backup decisions, while existing window reload/relaunch paths are smoke/login/update lifecycle hooks and are not a WorkspaceTrust host reload owner. Claiming this requires an App/window shell or Electron main workbench-window reload owner.",
    runtimeReference: false,
  }
}

function buildRequestLifecycleProjection(requests: WorkspaceTrustRequestEvidence[]): WorkspaceTrustRequestLifecycleProjection {
  return {
    workspaceRequestActive: requests.some((request) => (request.kind === "workspace" || request.kind === "startup") && request.status === "pending"),
    resourceRequestCount: requests.filter((request) => request.kind === "resources").length,
    openFilesRequestCount: requests.filter((request) => request.kind === "openFiles").length,
    startupRequestCount: requests.filter((request) => request.kind === "startup").length,
    latestRequest: requests.at(-1) || null,
    requests: [...requests],
  }
}

function buildRequestServiceProjection(
  requestLifecycle: WorkspaceTrustRequestLifecycleProjection,
  dialogShell: WorkspaceTrustDialogShellProjection,
  manageEditorShell: WorkspaceTrustManageEditorShellProjection,
  configureSettingsShell: WorkspaceTrustConfigureSettingsShellProjection,
  statusbar: WorkspaceTrustStatusbarProjection,
  banner: WorkspaceTrustBannerItemProjection,
  startupPolicySettings: WorkspaceTrustStartupPolicySettingsSnapshot,
  hostFocusService: CodekHostFocusService,
  editorPaneEvidence: WorkspaceTrustEditorPaneEvidenceInput,
): WorkspaceTrustRequestServiceProjection {
  const entrypointCommandIds = [
    WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage,
    WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Configure,
    WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Open,
    WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Allow,
    WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Deny,
  ]
  const contextKeyIds = [
    WORKSPACE_TRUST_CONTEXT_KEYS.IsEnabled,
    WORKSPACE_TRUST_CONTEXT_KEYS.IsTrusted,
    WORKSPACE_TRUST_CONTEXT_KEYS.LegacyTrusted,
  ]
  const hasDialogShell = dialogShell.status === "registered"
  const hasManageEditorShell = manageEditorShell.status === "registered"
  const hasConfigureSettingsShell = configureSettingsShell.status === "registered"
  return {
    serviceId: String(IWorkspaceTrustManagementService),
    stateSource: "workspaceTrustRoutes+agentPolicy",
    vscodeServiceId: "workspaceTrustRequestService",
    codekOwnerServiceId: "workspaceTrustManagementService",
    vscodeOwnerAudit: {
      requestHandlerOwner: "WorkspaceTrustRequestHandler",
      uxHandlerOwner: "WorkspaceTrustUXHandler",
      editorOwner: "WorkspaceTrustEditor",
      contextKeysOwner: "WorkspaceTrustContextKeys",
      sourcePaths: [
        "src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts",
        "src/vs/workbench/contrib/workspace/browser/workspaceTrustEditor.ts",
        "src/vs/workbench/contrib/workspace/common/workspace.ts",
      ],
    },
    requestOpen: {
      status: "available",
      owner: "WorkspaceTrustWorkbenchService",
      reason: "requestWorkspaceTrust/requestOpenFilesTrust/requestResourcesTrust record lifecycle evidence on the existing WorkspaceTrustWorkbenchService facade; workspace requests now return a dialog-resolved promise like VS Code WorkspaceTrustRequestService",
    },
    complete: {
      status: "available",
      owner: "WorkspaceTrustWorkbenchService",
      reason: "completeWorkspaceTrustRequest/completeOpenFilesTrustRequest/completeResourcesTrustRequest complete pending evidence through the same trust facade",
    },
    pending: {
      status: "available",
      owner: "WorkspaceTrustWorkbenchService",
      reason: "pending workspace/startup/openFiles/resources requests are projected from the single requestLifecycle evidence list",
    },
    modalUi: {
      status: hasDialogShell ? "available" : "blocked",
      owner: "WorkspaceTrustRequestHandler",
      reason: hasDialogShell
        ? "WorkspaceTrustRequestHandler workspace/openFiles/resources request events are wired to CodekDialogService and App.vue renders the shared modal selector; full WorkspaceTrustUXHandler startup policy plus editor are not claimed here"
        : "blocked by missing Codek workbench dialog shell owner for WorkspaceTrustRequestHandler prompts; this boundary records request evidence only and does not claim modal completion",
    },
    uiOwners: {
      workspaceRequestDialog: {
        status: hasDialogShell ? "available" : "blocked",
        owner: "WorkspaceTrustRequestHandler",
        reason: hasDialogShell
          ? "onDidInitiateWorkspaceTrustRequest is handled through CodekDialogService.prompt and requestWorkspaceTrust resolves from the same WorkspaceTrustWorkbenchService facade after the dialog is resolved"
          : "requires IDialogService prompt handling for onDidInitiateWorkspaceTrustRequest; Codek has no WorkspaceTrustRequestHandler dialog shell owner in this boundary",
      },
      openFilesDialog: {
        status: hasDialogShell ? "available" : "blocked",
        owner: "WorkspaceTrustRequestHandler",
        reason: hasDialogShell
          ? "onDidInitiateOpenFilesTrustRequest is handled through CodekDialogService.prompt with remember-decision checkbox evidence; persistence remains scoped to the existing trust facade"
          : "requires IDialogService prompt handling for onDidInitiateOpenFilesTrustRequest and checkbox persistence; Codek only records openFiles request lifecycle evidence",
      },
      resourcesDialog: {
        status: hasDialogShell ? "available" : "blocked",
        owner: "WorkspaceTrustRequestHandler",
        reason: hasDialogShell
          ? "onDidInitiateResourcesTrustRequest is handled through CodekDialogService.prompt and completes resource trust through the same WorkspaceTrustWorkbenchService facade"
          : "requires IDialogService prompt handling for onDidInitiateResourcesTrustRequest; Codek only records resources request lifecycle evidence",
      },
      startupModal: {
        status: hasDialogShell ? "partial" : "blocked",
        owner: "WorkspaceTrustUXHandler",
        reason: hasDialogShell
          ? "requestWorkspaceTrustOnStartup emits startup request evidence into the existing CodekDialogService modal shell and persists workspace.trust.startupPrompt.shown through CodekStorageService; full VS Code WorkspaceTrustUXHandler startup policy remains partial because Codek has not wired host focus and security.workspace.trust.startupPrompt configuration gates"
          : "requires startup prompt orchestration through host focus, storage, configuration and dialog services; no Codek WorkspaceTrustUXHandler shell owner is wired here",
      },
      banner: {
        status: "available",
        owner: "WorkspaceTrustUXHandler",
        reason: `${banner.reason}; mirrors VS Code WorkspaceTrustUXHandler updateWorkbenchIndicators -> IBannerService.show/hide without adding another trust store`,
      },
      statusbar: {
        status: statusbar.status,
        owner: "WorkspaceTrustUXHandler",
        reason: statusbar.reason,
      },
      manageEditor: {
        status: hasManageEditorShell ? "available" : "blocked",
        owner: "WorkspaceTrustEditor",
        reason: hasManageEditorShell
          ? "workbench.trust.manage creates a WorkspaceTrustEditorInput-compatible singleton input and calls the registered Codek editor shell with pinned: true; this owns the open request evidence without claiming the full VS Code EditorPane DOM"
          : "requires WorkspaceTrustEditorInput, EditorPane registration and IEditorService.openEditor owner; no Codek editor shell owner is wired in this boundary",
      },
      configureSettings: {
        status: hasConfigureSettingsShell ? "available" : "blocked",
        owner: "WorkspaceTrustSettings",
        reason: hasConfigureSettingsShell
          ? `workbench.trust.configure records the VS Code IPreferencesService.openUserSettings({ jsonEditor: false, query: "${WORKSPACE_TRUST_SETTINGS_QUERY}" }) request and targets the existing Codek ${WORKSPACE_TRUST_SETTINGS_SECTION} settings shell without adding a second trust store`
          : "requires IPreferencesService.openUserSettings or a Codek settings shell owner for @tag:workspaceTrust; configure command is not claimed in this boundary",
      },
    },
    entrypoints: {
      status: hasManageEditorShell && hasConfigureSettingsShell ? "available" : "partial",
      owner: "ExtensionTrustRemoteAuthWorkbench contributions",
      reason: hasManageEditorShell
        ? hasConfigureSettingsShell
          ? "workbench.trust.manage, workbench.trust.configure plus open/allow/deny command evidence exists; startup request dialog shell, status.workspaceTrust and workbench.banner.restrictedMode are owned through Codek shell services"
          : "workbench.trust.manage plus open/allow/deny command evidence exists; startup request dialog shell, status.workspaceTrust and workbench.banner.restrictedMode are owned through Codek shell services, while workbench.trust.configure remains unclaimed"
        : hasConfigureSettingsShell
          ? "workbench.trust.configure plus open/allow/deny command evidence exists, but VS Code workbench.trust.manage is intentionally not claimed without a Codek editor shell"
          : "command/view evidence exists for open/allow/deny, startup request dialog shell, status.workspaceTrust and workbench.banner.restrictedMode are owned through Codek shell services, but VS Code workbench.trust.manage and workbench.trust.configure are intentionally not claimed here",
    },
    contextKeys: {
      status: "available",
      owner: "WorkspaceTrustWorkbenchService",
      reason: "WorkspaceTrustWorkbenchService updates VS Code-style isWorkspaceTrustEnabled/isWorkspaceTrusted plus legacy workspaceTrust command context from the single trust facade",
    },
    activeRequestCount: requestLifecycle.requests.filter((request) => request.status === "pending").length,
    totalRequestCount: requestLifecycle.requests.length,
    latestRequest: requestLifecycle.latestRequest,
    entrypointCommandIds,
    missingEntrypointCommandIds: [
      ...(hasManageEditorShell ? [] : [WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage]),
      ...(hasConfigureSettingsShell ? [] : [WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Configure]),
    ],
    contextKeyIds,
    missingContextKeyIds: [
      "config.security.workspace.trust.enabled",
      "security.workspace.trust.startupPrompt",
      "security.workspace.trust.untrustedFiles",
    ],
    dialogShell,
    smokeReadiness: buildWorkspaceTrustRequestSmokeReadinessProjection(hasDialogShell),
    manageEditorShell,
    configureSettingsShell,
    statusbar,
    banner,
    editorPane: buildWorkspaceTrustEditorPaneContractProjection(hasManageEditorShell, editorPaneEvidence),
    startupPolicy: buildWorkspaceTrustStartupPolicyContractProjection(hasDialogShell, startupPolicySettings, hostFocusService),
    constraints: {
      noSecondRequestStore: true,
      modalUiNotImplemented: !hasDialogShell,
      fullWorkspaceTrustEditorPaneNotImplemented: true,
      requestLifecycleEvidenceOnly: true,
    },
  }
}

function buildWorkspaceTrustEditorPaneContractProjection(
  hasManageEditorShell: boolean,
  evidence: WorkspaceTrustEditorPaneEvidenceInput,
): WorkspaceTrustEditorPaneContractProjection {
  const trustedUrisTable = buildWorkspaceTrustTrustedUrisTableProjection(hasManageEditorShell, evidence)
  const affectedFeaturesList = buildWorkspaceTrustAffectedFeaturesProjection(hasManageEditorShell, evidence)
  const restrictedSettingsRender = buildWorkspaceTrustRestrictedSettingsProjection(hasManageEditorShell, evidence)
  const settingsEditor2 = buildWorkspaceTrustSettingsEditor2OwnerProjection(hasManageEditorShell)
  const settingsTree = buildWorkspaceTrustSettingsTreeOwnerProjection(hasManageEditorShell, restrictedSettingsRender)
  const workbenchTableRowModel = buildWorkspaceTrustWorkbenchTableRowModelProjection(hasManageEditorShell, evidence)
  return {
    owner: "WorkspaceTrustEditor",
    status: hasManageEditorShell ? "partial" : "blocked",
    vscodeSourcePaths: [
      "src/vs/workbench/contrib/workspace/browser/workspaceTrustEditor.ts",
      "src/vs/workbench/services/workspaces/browser/workspaceTrustEditorInput.ts",
      "src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts",
    ],
    ownerFeasibility: buildWorkspaceTrustEditorPaneOwnerFeasibilityProjection(hasManageEditorShell),
    settingsEditor2,
    settingsTree,
    workbenchTableRowModel,
    vscodeEditorPaneDomAudit: {
      sourceClass: "WorkspaceTrustEditor",
      editorPaneId: "workbench.editor.workspaceTrust",
      rootSelector: ".workspace-trust-editor",
      bodySelector: ".workspace-trust-editor-body",
      focusContract: "WorkspaceTrustEditor.focus -> rootElement.focus",
      keyboardContracts: [
        "UpArrow/DownArrow section navigation",
        "Escape root focus",
        "CtrlCmd+Enter toggle workspace trust",
        "CtrlCmd+Shift+Enter trust parent folder",
      ],
      renderDependencies: [
        "IExtensionsWorkbenchService.onChange",
        "IWorkbenchConfigurationService.onDidChangeRestrictedSettings",
        "IWorkspaceTrustManagementService.onDidChangeTrust",
        "IWorkspaceTrustManagementService.onDidChangeTrustedFolders",
      ],
      requiredDomSections: ["header", "affectedFeatures", "trustedContainer", "untrustedContainer", "configuration", "trustedUrisTable"],
    },
    stateSource: "WorkspaceTrustEditorInput+CodekEditorShell",
    openRequestStatus: hasManageEditorShell ? "available" : "blocked",
    paneOwnerStatus: hasManageEditorShell ? "partial" : "blocked",
    trustStore: "WorkspaceTrustWorkbenchService",
    domSmoke: {
      owner: "App.vue WorkspaceTrustEditor smoke DOM",
      status: hasManageEditorShell ? "available" : "blocked",
      rootSelector: ".workspace-trust-editor",
      bodySelector: ".workspace-trust-editor-body",
      trustedUrisTableSelector: "[data-codek-smoke=\"workspace-trust-editor-trusted-folders-table\"]",
      affectedFeaturesSelector: "[data-codek-smoke=\"workspace-trust-editor-affected-features\"]",
      focusContract: "rootElement.focus",
      keyboardContracts: [
        "UpArrow/DownArrow section navigation",
        "Escape root focus",
        "CtrlCmd+Enter toggle workspace trust",
        "CtrlCmd+Shift+Enter trust parent folder",
      ],
      stateSource: "WorkspaceTrustWorkbenchService+extensionsWorkbenchService",
      currentSourcePaths: [
        "frontend/vite-project/src/App.vue",
        "frontend/vite-project/src/workbench/extensionTrustRemoteAuthWorkbench.ts",
        "frontend/vite-project/src/extensions/extensionsWorkbenchService.ts",
      ],
      reason: hasManageEditorShell
        ? "App.vue renders a WorkspaceTrustEditor-compatible DOM surface for smoke verification, focuses the root element directly, and routes section navigation plus trust toggle keys to the existing WorkspaceTrustWorkbenchService facade."
        : "WorkspaceTrustEditor-compatible DOM smoke is blocked until workbench.trust.manage has a registered Codek editor shell owner.",
    },
    trustedUrisTable,
    affectedFeaturesList,
    restrictedSettingsRender,
    covered: {
      singletonInput: hasManageEditorShell,
      pinnedOpenRequest: hasManageEditorShell,
      domVisible: hasManageEditorShell,
      rootFocus: hasManageEditorShell,
      keyboardNavigation: hasManageEditorShell,
      noSecondTrustStore: true,
    },
    blocked: {
      editorPaneDom: !hasManageEditorShell,
      fullEditorPaneClass: true,
      keyboardNavigation: !hasManageEditorShell,
      focusMethod: !hasManageEditorShell,
      affectedFeaturesList: affectedFeaturesList.status !== "available",
      trustedUrisTable: trustedUrisTable.status !== "available",
      restrictedSettingsRender: restrictedSettingsRender.status !== "available",
    },
    blockedReason: hasManageEditorShell
      ? "Codek owns WorkspaceTrustEditorInput-compatible pinned open requests plus a WorkspaceTrustEditor-compatible App.vue DOM/focus/keyboard smoke surface backed by existing services; SettingsEditor2, SettingsTree and WorkbenchTable row evidence is available at service level, but the full VS Code EditorPane class remains blocked because this boundary cannot own App.vue/generic shell wiring or full VS Code list/tree instantiation."
      : "requires WorkspaceTrustEditorInput plus IEditorService.openEditor shell wiring before even the open request can be claimed; the full WorkspaceTrustEditor EditorPane owner remains blocked",
  }
}

function buildWorkspaceTrustEditorPaneOwnerFeasibilityProjection(
  hasManageEditorShell: boolean,
): WorkspaceTrustEditorPaneOwnerFeasibilityProjection {
  const editorPartShellContract = globalEditorPartService.getGenericEditorPaneShellContract()
  return {
    status: hasManageEditorShell ? "contractOwnerAvailable" : "blocked",
    conclusion: "minimalOpenRequestOwnerOnly",
    inspectedVscodeOwners: ["WorkspaceTrustEditor", "SettingsEditor2", "SettingsTree", "WorkbenchTable"],
    inspectedCodekShells: [
      {
        owner: "WorkbenchExplorerEditorService",
        status: hasManageEditorShell ? "reusableForOpenRequest" : "fileTabOnly",
        supports: hasManageEditorShell
          ? [
              "pinned editor tab entry",
              "singleton WorkspaceTrustEditorInput-compatible resource",
              "active editor evidence",
            ]
          : [
              "file-backed editor tab model",
            ],
        missingForFullOwner: [
          "EditorPaneDescriptor registration",
          "EditorInput serializer",
          "IEditorService.openEditor(EditorInput)",
          "createEditor(parent) lifecycle",
          "theme/storage/telemetry injected EditorPane base",
        ],
        reason: hasManageEditorShell
          ? "WorkbenchExplorerEditorService can own the minimal workbench.trust.manage pinned open request by opening the WorkspaceTrustEditorInput-compatible resource, but it is still a file/tab facade rather than a VS Code EditorPane host."
          : "WorkbenchExplorerEditorService exists as the current file/tab facade, but WorkspaceTrust has not registered it as the manage editor shell in this service instance.",
      },
      {
        owner: "EditorPartService",
        status: "genericShellContract",
        supports: [...editorPartShellContract.supports],
        missingForFullOwner: [...editorPartShellContract.blockedOwners],
        reason: editorPartShellContract.reason,
      },
      {
        owner: "App.vue WorkspaceTrustEditor smoke DOM",
        status: "smokeOnly",
        supports: [
          "workspace-trust-editor selectors",
          "root focus smoke",
          "keyboard smoke",
          "trusted folders/affected features visible evidence",
        ],
        missingForFullOwner: [
          "owned WorkspaceTrustEditor class",
          "WorkbenchTable widget construction",
          "SettingsTree widget construction",
          "dispose/re-render lifecycle parity",
        ],
        reason: "The App.vue smoke DOM verifies the user-visible WorkspaceTrust surface, but it is not a reusable generic EditorPane shell and must not upgrade service evidence into full VS Code owner parity.",
      },
    ],
    minimalAdapter: {
      owner: "WorkspaceTrustWorkbenchService.registerWorkspaceTrustManageEditorShell",
      status: hasManageEditorShell ? "available" : "blocked",
      commandId: WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage,
      editorResource: WORKSPACE_TRUST_EDITOR_RESOURCE,
      openOptions: {
        pinned: true,
        permanent: true,
        preview: false,
      },
      stateSource: "WorkbenchExplorerEditorService.openEditor",
      reason: hasManageEditorShell
        ? "This is the only low-conflict owner adapter available in the current boundary: it connects workbench.trust.manage to the existing editor shell while keeping full EditorPane/List/Table owners blocked."
        : "The minimal adapter is available only after a caller registers the WorkspaceTrust manage editor shell.",
    },
    blockedOwners: [
      "EditorPaneDescriptor",
      "EditorInputSerializer",
      "IEditorService.openEditor(EditorInput)",
      "SettingsTree DOM owner",
      "WorkbenchTable DOM owner",
      "IInstantiationService graph",
      "IStorageService memento",
    ],
    nextOwnerBoundary: "generic editor shell/App.vue owner",
    runtimeReference: false,
    reason: hasManageEditorShell
      ? "Only the pinned open request has a real Codek owner. Full WorkspaceTrustEditor, SettingsEditor2, SettingsTree and WorkbenchTable ownership requires generic editor shell and list/table construction work outside this safe boundary."
      : "No registered manage editor shell is available for this service instance, so even the minimal open request owner is blocked; service evidence remains projection-only.",
  }
}

function buildWorkspaceTrustSettingsEditor2OwnerProjection(
  hasManageEditorShell: boolean,
): WorkspaceTrustSettingsEditor2OwnerProjection {
  return {
    owner: "SettingsEditor2",
    status: hasManageEditorShell ? "partial" : "blocked",
    editorPaneId: "workbench.editor.settings2",
    vscodeSourcePaths: [
      "src/vs/workbench/contrib/preferences/browser/settingsEditor2.ts",
      "src/vs/workbench/contrib/preferences/browser/preferences.contribution.ts",
      "src/vs/workbench/contrib/preferences/browser/settingsTreeModels.ts",
      "src/vs/workbench/services/preferences/common/preferences.ts",
    ],
    currentSourcePaths: [
      "frontend/vite-project/src/workbench/extensionTrustRemoteAuthWorkbench.ts",
      "frontend/vite-project/src/settings/settingsStore.ts",
    ],
    stateSource: hasManageEditorShell ? "IPreferencesService.openUserSettings+CodekSettingsShell" : "blocked",
    reusedConfigurationSource: "workbenchConfigurationService",
    workspaceTrustQueryTags: ["workspaceTrust", "requireTrustedWorkspace"],
    trustChangeModelUpdate: "IWorkspaceTrustManagementService.onDidChangeTrust -> SettingsTreeModel.updateWorkspaceTrust",
    workspaceTrustGroupInjection: "configured untrusted workspace settings -> Workspace Trust settings group",
    coveredSignals: hasManageEditorShell
      ? [
          "workbench.trust.configure -> IPreferencesService.openUserSettings",
          `${SETTINGS_EDITOR_COMMAND_FILTER_UNTRUSTED} -> ${FILTER_UNTRUSTED_SETTINGS_QUERY}`,
          "configuration keys read from workbenchConfigurationService",
          "SettingsEditor2 @tag:workspaceTrust/@tag:requireTrustedWorkspace suggestions",
          "IWorkspaceTrustManagementService.onDidChangeTrust refreshes SettingsTreeModel",
          "configured untrusted workspace settings are injected into Workspace Trust group",
        ]
      : [
          "configuration keys read from workbenchConfigurationService",
          "SettingsEditor2 @tag:workspaceTrust/@tag:requireTrustedWorkspace suggestions",
        ],
    blockedSignals: [
      "complete SettingsEditor2 EditorPane class",
      "SettingsEditor2 split view/search widget lifecycle",
      "SettingsEditor2 memento storage",
    ],
    missingOwners: [
      "EditorPane",
      "IInstantiationService",
      "IPreferencesService",
      "IStorageService",
    ],
    reason: hasManageEditorShell
      ? "Codek projects SettingsEditor2 command/query ownership through the existing settings shell and workbenchConfigurationService, but does not claim the full VS Code SettingsEditor2 EditorPane class, split view, search widget, or memento lifecycle in this file boundary."
      : "SettingsEditor2 remains blocked until a settings editor shell owner exists; restricted configuration evidence remains service-level only.",
  }
}

function buildWorkspaceTrustSettingsTreeOwnerProjection(
  hasManageEditorShell: boolean,
  restrictedSettingsRender: WorkspaceTrustEditorPaneContractProjection["restrictedSettingsRender"],
): WorkspaceTrustSettingsTreeOwnerProjection {
  return {
    owner: "SettingsTree",
    status: hasManageEditorShell && restrictedSettingsRender.status === "available" ? "partial" : "blocked",
    vscodeSourcePaths: [
      "src/vs/workbench/contrib/preferences/browser/settingsTree.ts",
      "src/vs/workbench/contrib/preferences/browser/settingsTreeModels.ts",
      "src/vs/workbench/contrib/preferences/browser/settingsEditorSettingIndicators.ts",
      "src/vs/platform/list/browser/listService.ts",
    ],
    currentSourcePaths: [
      "frontend/vite-project/src/workbench/extensionTrustRemoteAuthWorkbench.ts",
      "frontend/vite-project/src/settings/settingsStore.ts",
    ],
    stateSource: "workbenchConfigurationService",
    rowModelSource: "IWorkbenchConfigurationService.restrictedSettings",
    query: FILTER_UNTRUSTED_SETTINGS_QUERY,
    indicatorOwner: "SettingsTreeIndicatorsLabel",
    indicatorCommandId: "workbench.trust.manage",
    indicatorClass: "setting-item-workspace-trust",
    modelTrustUpdateSignal: "SettingsTreeModel.updateWorkspaceTrust",
    rowCount: restrictedSettingsRender.treeRows.length,
    coveredSignals: [
      "restricted settings row keys",
      "restricted settings configured target",
      `${SETTINGS_EDITOR_COMMAND_FILTER_UNTRUSTED} query`,
      "SettingsTreeIndicatorsLabel workspace trust indicator",
      "SettingsTreeModel.updateWorkspaceTrust",
      "no second configuration state source",
    ],
    blockedSignals: hasManageEditorShell
      ? [
          "SettingsTree DOM owner",
          "WorkbenchObjectTree/ListService owner",
          "AbstractSettingRenderer controls",
        ]
      : [
          "WorkspaceTrustEditorInput pinned open request",
          "SettingsTree DOM owner",
          "WorkbenchObjectTree/ListService owner",
          "AbstractSettingRenderer controls",
        ],
    missingOwners: [
      "SettingsTree",
      "WorkbenchObjectTree",
      "IListService",
      "IInstantiationService",
    ],
    reason: hasManageEditorShell
      ? "Restricted SettingsTree rows are projected from IWorkbenchConfigurationService.restrictedSettings and keep the VS Code @tag:requireTrustedWorkspace query contract, while the real SettingsTree widget/list/renderers stay blocked outside this allowed file boundary."
      : "Restricted settings rows can be computed from workbenchConfigurationService, but no WorkspaceTrustEditor shell or SettingsTree widget owner is claimed.",
  }
}

function buildWorkspaceTrustWorkbenchTableRowModelProjection(
  hasManageEditorShell: boolean,
  evidence: WorkspaceTrustEditorPaneEvidenceInput,
): WorkspaceTrustWorkbenchTableRowModelProjection {
  const projection: Omit<WorkspaceTrustWorkbenchTableRowModelProjection, "shellAdapter"> = {
    owner: "WorkbenchTable",
    status: hasManageEditorShell ? "partial" : "blocked",
    vscodeSourcePaths: [
      "src/vs/workbench/contrib/workspace/browser/workspaceTrustEditor.ts",
      "src/vs/platform/list/browser/listService.ts",
      "src/vs/base/browser/ui/table/table.ts",
    ],
    currentSourcePaths: [
      "frontend/vite-project/src/workbench/extensionTrustRemoteAuthWorkbench.ts",
    ],
    stateSource: "WorkspaceTrustWorkbenchService",
    sourceClass: "WorkspaceTrustedUrisTable",
    tableOwnerId: "WorkspaceTrust",
    tableUpdateSignal: "WorkspaceTrustedUrisTable.updateTable -> WorkbenchTable.splice",
    rowCount: evidence.trustedFolderCount,
    eventCount: evidence.trustedFoldersEventCount,
    coveredSignals: [
      "trusted URI row count",
      "trusted folders change event count",
      "WorkspaceTrustWorkbenchService.getTrustedUris",
      "WorkspaceTrustWorkbenchService.onDidChangeTrustedFolders",
      "WorkspaceTrustedUrisTable.updateTable -> WorkbenchTable.splice",
    ],
    blockedSignals: hasManageEditorShell
      ? [
          "WorkbenchTable DOM owner",
          "TrustedUri table column renderers",
          "TrustedUri edit/delete input widgets",
        ]
      : [
          "WorkspaceTrustEditorInput pinned open request",
          "WorkbenchTable DOM owner",
          "TrustedUri table column renderers",
          "TrustedUri edit/delete input widgets",
        ],
    missingOwners: [
      "WorkbenchTable",
      "IInstantiationService",
      "IStorageService",
    ],
    reason: hasManageEditorShell
      ? "Codek owns the trusted URI row model through WorkspaceTrustWorkbenchService, but does not claim VS Code WorkbenchTable construction, column renderers, or storage-backed table widget state in this boundary."
      : "Trusted URI state exists, but WorkbenchTable row ownership is blocked until the WorkspaceTrustEditor shell is available.",
  }
  return {
    ...projection,
    shellAdapter: createWorkbenchTableShellOwnerAdapter(projection),
  }
}

function buildWorkspaceTrustTrustedUrisTableProjection(
  hasManageEditorShell: boolean,
  evidence: WorkspaceTrustEditorPaneEvidenceInput,
): WorkspaceTrustEditorPaneContractProjection["trustedUrisTable"] {
  return {
    owner: "WorkspaceTrustEditor",
    surface: "trustedUrisTable",
    status: hasManageEditorShell ? "available" : "blocked",
    stateSource: "WorkspaceTrustWorkbenchService",
    vscodeSourcePaths: [
      "src/vs/workbench/contrib/workspace/browser/workspaceTrustEditor.ts",
      "src/vs/platform/workspace/common/workspaceTrust.ts",
    ],
    currentSourcePaths: [
      "frontend/vite-project/src/workbench/extensionTrustRemoteAuthWorkbench.ts",
    ],
    trustedFolderCount: evidence.trustedFolderCount,
    trustedFoldersEventCount: evidence.trustedFoldersEventCount,
    coveredSignals: [
      "getTrustedUris",
      "setTrustedUris",
      "setUrisTrust",
      "onDidChangeTrustedFolders",
    ],
    blockedSignals: hasManageEditorShell ? [] : ["WorkspaceTrustEditorInput pinned open request"],
    reason: hasManageEditorShell
      ? "WorkspaceTrustEditor trusted folders table can project getTrustedUris/setTrustedUris/setUrisTrust and onDidChangeTrustedFolders from the single WorkspaceTrustWorkbenchService facade; table DOM edit widgets remain part of the full EditorPane blocker."
      : "trusted folders state exists on WorkspaceTrustWorkbenchService, but the WorkspaceTrustEditor shell is not registered, so the table UI entry point is not available.",
  }
}

function buildWorkspaceTrustAffectedFeaturesProjection(
  hasManageEditorShell: boolean,
  evidence: WorkspaceTrustEditorPaneEvidenceInput,
): WorkspaceTrustEditorPaneContractProjection["affectedFeaturesList"] {
  return {
    owner: "WorkspaceTrustEditor",
    surface: "affectedFeaturesList",
    status: hasManageEditorShell ? "available" : "blocked",
    stateSource: "WorkspaceTrustWorkbenchService+extensionsWorkbenchService",
    vscodeSourcePaths: [
      "src/vs/workbench/contrib/workspace/browser/workspaceTrustEditor.ts",
      "src/vs/workbench/services/extensionManagement/browser/extensionEnablementService.ts",
    ],
    currentSourcePaths: [
      "frontend/vite-project/src/workbench/extensionTrustRemoteAuthWorkbench.ts",
      "frontend/vite-project/src/extensions/extensionsWorkbenchService.ts",
    ],
    restrictedModeEnabled: evidence.restrictedModeEnabled,
    disabledByTrustRequirementCount: evidence.disabledByTrustRequirementCount,
    coveredSignals: [
      "restrictedMode.enabled",
      "latestEnablementRecompute.disabledByTrustRequirementCount",
      "ExtensionWorkbenchEnablementState.DisabledByTrustRequirement",
    ],
    blockedSignals: hasManageEditorShell ? [] : ["WorkspaceTrustEditorInput pinned open request"],
    reason: hasManageEditorShell
      ? "WorkspaceTrustEditor affected features can project restricted-mode state and DisabledByTrustRequirement counts from WorkspaceTrustWorkbenchService plus extensionsWorkbenchService without inventing a second feature list store."
      : "affected-features evidence exists on the trust and extension workbench services, but the WorkspaceTrustEditor shell is not registered.",
  }
}

function buildWorkspaceTrustRestrictedSettingsProjection(
  hasManageEditorShell: boolean,
  evidence: WorkspaceTrustEditorPaneEvidenceInput,
): WorkspaceTrustEditorPaneContractProjection["restrictedSettingsRender"] {
  const settings = evidence.startupPolicySettings
  const configurationKeys: WorkspaceTrustStartupPolicyGateKey[] = [
    "security.workspace.trust.enabled",
    "security.workspace.trust.startupPrompt",
    "security.workspace.trust.untrustedFiles",
    "security.workspace.trust.banner",
    "security.workspace.trust.emptyWindow",
  ]
  const treeRows = buildWorkspaceTrustRestrictedSettingsTreeRows(evidence.restrictedSettings)
  const hasRestrictedSettingsService = Array.isArray(evidence.restrictedSettings.default)
  const hasFilterUntrustedProjection = hasRestrictedSettingsService
  const status: WorkspaceTrustRequestCapabilityStatus = hasManageEditorShell && hasRestrictedSettingsService && hasFilterUntrustedProjection
    ? "available"
    : hasManageEditorShell
      ? "partial"
      : "blocked"
  return {
    owner: "WorkspaceTrustEditor",
    surface: "restrictedSettingsRender",
    status,
    stateSource: "workbenchConfigurationService",
    vscodeSourcePaths: [
      "src/vs/workbench/contrib/workspace/browser/workspaceTrustEditor.ts",
      "src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts",
      "src/vs/workbench/contrib/preferences/browser/preferences.contribution.ts",
      "src/vs/workbench/contrib/preferences/browser/settingsEditor2.ts",
      "src/vs/workbench/contrib/preferences/browser/settingsTree.ts",
      "src/vs/workbench/services/configuration/common/configuration.ts",
    ],
    currentSourcePaths: [
      "frontend/vite-project/src/workbench/extensionTrustRemoteAuthWorkbench.ts",
      "frontend/vite-project/src/settings/settingsStore.ts",
    ],
    configurationKeys,
    restrictedSettingCount: evidence.restrictedSettings.default.length,
    workspaceRestrictedSettingCount: evidence.restrictedSettings.workspace.length
      + [...evidence.restrictedSettings.workspaceFolder.values()].reduce((count, keys) => count + keys.length, 0),
    treeRows,
    filterUntrustedCommand: {
      commandId: SETTINGS_EDITOR_COMMAND_FILTER_UNTRUSTED,
      status: hasFilterUntrustedProjection ? "available" : "blocked",
      vscodeContract: "IPreferencesService.openWorkspaceSettings",
      options: {
        jsonEditor: false,
        query: FILTER_UNTRUSTED_SETTINGS_QUERY,
      },
      settingTag: REQUIRE_TRUSTED_WORKSPACE_SETTING_TAG,
      stateSource: "IWorkbenchConfigurationService.restrictedSettings+CodekSettingsShell",
      reason: "VS Code settings.filterUntrusted opens workspace settings with @tag:requireTrustedWorkspace; Codek projects the same command/query through the existing workbenchConfigurationService restrictedSettings and settings shell boundary.",
    },
    coveredSignals: [
      "IWorkbenchConfigurationService.restrictedSettings",
      "IWorkbenchConfigurationService.onDidChangeRestrictedSettings",
      `${SETTINGS_EDITOR_COMMAND_FILTER_UNTRUSTED} -> ${FILTER_UNTRUSTED_SETTINGS_QUERY}`,
      `restrictedSettings.default.count=${String(evidence.restrictedSettings.default.length)}`,
      `restrictedSettings.workspace.count=${String(evidence.restrictedSettings.workspace.length)}`,
      `security.workspace.trust.enabled=${String(settings.enabled)}`,
      `security.workspace.trust.startupPrompt=${settings.startupPrompt}`,
      `security.workspace.trust.untrustedFiles=${settings.untrustedFiles}`,
      `security.workspace.trust.banner=${settings.banner}`,
      `security.workspace.trust.emptyWindow=${String(settings.emptyWindow)}`,
    ],
    blockedSignals: status === "available"
      ? []
      : [
          ...(hasRestrictedSettingsService ? [] : ["IWorkbenchConfigurationService.restrictedSettings"]),
          ...(hasFilterUntrustedProjection ? [] : ["settings.filterUntrusted command"]),
          ...(hasManageEditorShell ? [] : ["WorkspaceTrustEditorInput pinned open request"]),
        ],
    reason: hasManageEditorShell
      ? "WorkspaceTrustEditor restricted settings evidence is derived from the existing workbenchConfigurationService.restrictedSettings projection and links to the VS Code settings.filterUntrusted query path without creating a second configuration state source; the full SettingsEditor2/SettingsTree class remains partial."
      : "workspace trust configuration gates are readable, but the WorkspaceTrustEditor shell is not registered and the VS Code restricted settings tree remains unowned.",
  }
}

function buildWorkspaceTrustRestrictedSettingsTreeRows(
  restrictedSettings: RestrictedSettings,
): WorkspaceTrustRestrictedSettingsTreeRowProjection[] {
  const rows: WorkspaceTrustRestrictedSettingsTreeRowProjection[] = []
  const seen = new Set<string>()
  const pushRows = (
    keys: ReadonlyArray<string>,
    target: WorkspaceTrustRestrictedSettingsTreeRowProjection["target"],
    configuredTarget: WorkspaceTrustRestrictedSettingsTreeRowProjection["configuredTarget"],
  ) => {
    for (const key of keys) {
      const id = `${target}:${configuredTarget}:${key}`
      if (seen.has(id)) continue
      seen.add(id)
      rows.push({
        key,
        target,
        configuredTarget,
        commandId: SETTINGS_EDITOR_COMMAND_FILTER_UNTRUSTED,
        query: FILTER_UNTRUSTED_SETTINGS_QUERY,
        stateSource: "IWorkbenchConfigurationService.restrictedSettings",
      })
    }
  }
  pushRows(restrictedSettings.default, "default", "unknown")
  pushRows(restrictedSettings.application, "application", "unknown")
  pushRows(restrictedSettings.userLocal, "userLocal", "unknown")
  pushRows(restrictedSettings.userRemote, "userRemote", "unknown")
  pushRows(restrictedSettings.workspace, "workspace", "workspace")
  for (const keys of restrictedSettings.workspaceFolder.values()) {
    pushRows(keys, "workspaceFolder", "workspaceFolder")
  }
  return rows.sort((left, right) => left.key.localeCompare(right.key) || left.target.localeCompare(right.target))
}

function readWorkbenchRestrictedSettings(configurationService: IConfigurationService): RestrictedSettings {
  const restrictedSettings = (configurationService as Partial<IWorkbenchConfigurationService>).restrictedSettings
  if (restrictedSettings) return restrictedSettings
  return {
    default: [],
    application: [],
    userLocal: [],
    userRemote: [],
    workspace: [],
    workspaceFolder: new Map(),
  }
}

function readWorkspaceTrustStartupPolicySettings(configurationService: IConfigurationService): WorkspaceTrustStartupPolicySettingsSnapshot {
  return {
    enabled: configurationService.getValue<boolean>(WORKSPACE_TRUST_ENABLED_CONFIGURATION_KEY) !== false,
    startupPrompt: normalizeStartupPromptSetting(configurationService.getValue(WORKSPACE_TRUST_STARTUP_PROMPT_CONFIGURATION_KEY)),
    untrustedFiles: normalizeUntrustedFilesSetting(configurationService.getValue(WORKSPACE_TRUST_UNTRUSTED_FILES_CONFIGURATION_KEY)),
    banner: normalizeBannerSetting(configurationService.getValue(WORKSPACE_TRUST_BANNER_CONFIGURATION_KEY)),
    emptyWindow: configurationService.getValue<boolean>(WORKSPACE_TRUST_EMPTY_WINDOW_CONFIGURATION_KEY) !== false,
  }
}

function normalizeStartupPromptSetting(value: unknown): WorkspaceTrustStartupPromptSetting {
  return value === "always" || value === "never" ? value : "once"
}

function normalizeUntrustedFilesSetting(value: unknown): WorkspaceTrustUntrustedFilesSetting {
  return value === "open" || value === "newWindow" ? value : "prompt"
}

function normalizeBannerSetting(value: unknown): WorkspaceTrustBannerSetting {
  return value === "always" || value === "never" ? value : "untilDismissed"
}

function buildWorkspaceTrustStartupPolicyContractProjection(
  hasDialogShell: boolean,
  settings: WorkspaceTrustStartupPolicySettingsSnapshot,
  hostFocusService: CodekHostFocusService,
): WorkspaceTrustStartupPolicyContractProjection {
  const hasHostFocusContract = typeof hostFocusService.hasFocus === "boolean"
  return {
    owner: "WorkspaceTrustUXHandler",
    status: "partial",
    vscodeSourcePaths: [
      "src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts",
      "src/vs/workbench/services/workspaces/common/workspaceTrust.ts",
      "src/vs/workbench/contrib/relauncher/browser/relauncher.contribution.ts",
    ],
    stateSource: "workspaceTrustRoutes+agentPolicy",
    requestLifecycleSource: "WorkspaceTrustWorkbenchService.requestLifecycle",
    dialogShellStatus: hasDialogShell ? "registered" : "notRegistered",
    trustStore: "WorkspaceTrustWorkbenchService",
    hostFocus: {
      status: hasHostFocusContract ? "available" : "blocked",
      owner: "IHostService",
      serviceId: "hostService",
      vscodeServiceId: "IHostService",
      vscodeDeferralContract: {
        sourceClass: "WorkspaceTrustUXHandler",
        method: "constructor",
        immediateWhen: "hostService.hasFocus",
        deferredBy: "hostService.onDidChangeFocus",
        deferredAction: "showModalOnStart",
        sourcePath: "src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts",
      },
      requiredContracts: ["hasFocus", "onDidChangeFocus"],
      exploredCodekFacades: [
        {
          facade: "WorkbenchLayoutService.hasFocus(part)",
          ownerStatus: "notApplicable",
          reason: "tracks focused workbench parts and cannot answer whether the host window is focused",
        },
        {
          facade: "AccessibleView editor-shell focus projection",
          ownerStatus: "notApplicable",
          reason: "documents editor focus restoration evidence in the Accessibility domain, not host window focus",
        },
        {
          facade: "CodekDialogService modal shell",
          ownerStatus: "notApplicable",
          reason: "renders WorkspaceTrustRequestHandler prompts after a request exists; it does not defer startup requests on window focus",
        },
        {
          facade: "Codek window/app focus service",
          ownerStatus: hasHostFocusContract ? "available" : "missing",
          reason: hasHostFocusContract
            ? "CodekWindowHostFocusService exposes IHostService-compatible hasFocus and onDidChangeFocus from document.hasFocus plus window focus/blur/visibilitychange events"
            : "no existing document.hasFocus/window focus-blur facade or onDidChangeFocus event service is wired in the workbench boundary",
        },
      ],
      availableSignals: [
        {
          source: "renderer",
          facade: "CodekWindowHostFocusService",
          provides: ["hostFocusState", "focusChangeEvent", "focusEvent", "blurEvent", "visibilityChangeEvent"],
          missingForHostService: [],
          reason: "runtime WorkspaceTrust startup deferral now reads document.hasFocus() and listens to window focus/blur plus document visibilitychange through a reusable host focus service",
        },
        {
          source: "renderer",
          facade: "App.vue window blur autosave listener",
          provides: ["blurEvent"],
          missingForHostService: ["hasFocus", "onDidChangeFocus"],
          reason: "App.vue observes blur for auto-save on focus change, but it is a component-local side effect and does not expose a reusable current focus state or focus-change Event<boolean>",
        },
        {
          source: "desktop",
          facade: "desktop/main.js collectProcessSummary BrowserWindow.isFocused()",
          provides: ["currentFocusSnapshot"],
          missingForHostService: ["onDidChangeFocus"],
          reason: "desktop diagnostics can snapshot BrowserWindow.isFocused(), but no preload/workbench service exposes it as IHostService.hasFocus or streams focus/blur changes",
        },
        {
          source: "smoke",
          facade: "desktop/main.js bringSmokeWindowToForeground",
          provides: ["foregroundFocusResult"],
          missingForHostService: ["hasFocus", "onDidChangeFocus"],
          reason: "smoke helpers can force and report focus for acceptance harnesses only; they are not runtime WorkspaceTrust owners",
        },
      ],
      requiredServiceContract: {
        serviceId: "hostService",
        owner: "CodekHostFocusService",
        currentState: hasHostFocusContract ? "available" : "missing",
        hasFocus: hasHostFocusContract ? "available" : "missing",
        onDidChangeFocus: hasHostFocusContract ? "available" : "missing",
        minimumAdapter: "document.hasFocus/window focus-blur or Electron BrowserWindow focus/blur bridged through preload",
        noSyntheticFocus: true,
      },
      covered: {
        startupRequestEvidence: true,
        dialogShell: hasDialogShell,
      },
      blocked: {
        hostFocusState: !hasHostFocusContract,
        focusChangeEvent: !hasHostFocusContract,
        startupModalDeferral: !hasHostFocusContract,
      },
      reason: hasHostFocusContract
        ? "VS Code WorkspaceTrustUXHandler calls showModalOnStart immediately when IHostService.hasFocus is true, or defers it through IHostService.onDidChangeFocus; Codek now owns that minimum contract through CodekWindowHostFocusService without synthetic focus"
        : "VS Code WorkspaceTrustUXHandler calls showModalOnStart immediately when IHostService.hasFocus is true, or defers it through IHostService.onDidChangeFocus; Codek records startup request evidence and dialog shell readiness, and it has renderer blur plus Electron diagnostic/smoke focus signals, but none form a reusable hostService.hasFocus/onDidChangeFocus owner yet",
    },
    storagePolicy: {
      status: "partial",
      owner: "IStorageService",
      serviceId: "storageService",
      vscodeServiceId: "IStorageService",
      startupPromptShownKey: WORKSPACE_TRUST_STARTUP_PROMPT_SHOWN_KEY,
      bannerDismissedKey: WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_DISMISSED_KEY,
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
      reason: "VS Code persists workspace.trust.startupPrompt.shown and workbench.banner.restrictedMode.dismissed with IStorageService in WORKSPACE scope and MACHINE target; Codek now writes both keys through the existing CodekStorageService facade without adding a second trust store, while complete startup policy remains partial until host focus and security.workspace.trust startup configuration gates are wired",
    },
    configurationGates: [
      {
        key: "security.workspace.trust.enabled",
        status: "available",
        stateSource: "workbenchConfigurationService",
        owner: "WorkspaceTrustEnablementService",
        value: settings.enabled,
        reason: "WorkspaceTrustEnablementService reads security.workspace.trust.enabled from the existing workbenchConfigurationService without creating another trust enablement store",
      },
      {
        key: "security.workspace.trust.startupPrompt",
        status: "partial",
        stateSource: "workbenchConfigurationService",
        owner: "WorkspaceTrustUXHandler",
        value: settings.startupPrompt,
        reason: hasHostFocusContract
          ? "requestWorkspaceTrustOnStartup reads security.workspace.trust.startupPrompt from workbenchConfigurationService and uses CodekHostFocusService for VS Code-style startup host focus deferral"
          : "requestWorkspaceTrustOnStartup reads security.workspace.trust.startupPrompt from workbenchConfigurationService and skips startup prompts for never or already-shown once policy; host focus deferral remains blocked",
      },
      {
        key: "security.workspace.trust.untrustedFiles",
        status: "partial",
        stateSource: "workbenchConfigurationService",
        owner: "WorkspaceTrustRequestHandler",
        value: settings.untrustedFiles,
        reason: "requestOpenFilesTrust reads security.workspace.trust.untrustedFiles from workbenchConfigurationService and completeOpenFilesTrustRequest persists saved open/newWindow decisions through the same configuration service",
      },
      {
        key: "security.workspace.trust.banner",
        status: "available",
        stateSource: "workbenchConfigurationService",
        owner: "WorkspaceTrustUXHandler",
        value: settings.banner,
        reason: "restricted-mode banner visibility is owned by WorkspaceTrustBannerService and gated by security.workspace.trust.banner from workbenchConfigurationService",
      },
      {
        key: "security.workspace.trust.emptyWindow",
        status: "partial",
        stateSource: "workbenchConfigurationService",
        owner: "WorkspaceTrustUXHandler",
        value: settings.emptyWindow,
        reason: "WorkspaceTrust snapshots expose security.workspace.trust.emptyWindow from workbenchConfigurationService for empty-window policy evidence, but full VS Code workspace startup ownership remains outside this boundary",
      },
    ],
    covered: {
      startupRequestEvidence: true,
      dialogShell: hasDialogShell,
      statusbarIndicator: true,
      restrictedModeBanner: true,
      noSecondTrustStore: true,
    },
    blockedReason: hasHostFocusContract
      ? "Startup request dialog, storage policy evidence, security.workspace.trust configuration gates, and IHostService-compatible host focus deferral are available through existing Codek services; full WorkspaceTrustEditor pane and broader WorkspaceTrustUXHandler work remain outside this task"
      : "Startup request dialog, storage policy evidence, and security.workspace.trust configuration gates are available through existing services; full VS Code WorkspaceTrustUXHandler startup modal deferral remains blocked until a real CodekHostFocusService exposes IHostService-compatible hasFocus and onDidChangeFocus without synthetic focus",
  }
}

function buildWorkspaceTrustRequestSmokeReadinessProjection(hasDialogShell: boolean): WorkspaceTrustRequestSmokeReadinessProjection {
  return {
    status: hasDialogShell ? "ready" : "blocked",
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
    decisionEvents: [
      "CodekDialogService.onWillShowDialog",
      "CodekDialogService.onDidShowDialog",
      "WorkspaceTrustWorkbenchService.onDidInitiateWorkspaceTrustRequest",
      "WorkspaceTrustWorkbenchService.onDidInitiateOpenFilesTrustRequest",
      "WorkspaceTrustWorkbenchService.onDidInitiateResourcesTrustRequest",
    ],
    readyWhen: [
      "App.vue exposes the shared CodekDialogService modal selector",
      "dialog evidenceContext.commandId matches workbench.trust.request/openFiles/resources",
      "dialog resolution calls completeWorkspaceTrustRequest/completeOpenFilesTrustRequest/completeResourcesTrustRequest on the same WorkspaceTrustWorkbenchService instance",
      "requestWorkspaceTrust returns the dialog-resolved WorkspaceTrustDecisionEvidence instead of a synthetic pending decision",
      "WorkspaceTrustWorkbenchService.getTrustSnapshot().constraints.noSecondTrustStore remains true",
    ],
    blockedUntil: hasDialogShell
      ? "Electron smoke harness can consume these selectors without new WorkspaceTrust runtime code; full WorkspaceTrustEditor pane, startup policy, and IHostService focus remain separate blockers"
      : "registerWorkspaceTrustDialogShell(globalCodekDialogService) must be active before Electron smoke can exercise request decisions",
  }
}

function buildWorkspaceTrustEditorInputProjection(): WorkspaceTrustEditorInputProjection {
  return {
    typeId: WORKSPACE_TRUST_EDITOR_INPUT_ID,
    editorId: WORKSPACE_TRUST_EDITOR_ID,
    name: "工作区信任",
    resource: WORKSPACE_TRUST_EDITOR_RESOURCE,
    capabilities: ["singleton", "requiresModal"],
  }
}

function buildWorkspaceTrustConfigureSettingsOpenRequest(opened: boolean): WorkspaceTrustConfigureSettingsOpenRequest {
  return {
    commandId: WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Configure,
    vscodeContract: "IPreferencesService.openUserSettings",
    options: {
      jsonEditor: false,
      query: WORKSPACE_TRUST_SETTINGS_QUERY,
    },
    settingsSection: WORKSPACE_TRUST_SETTINGS_SECTION,
    settingTag: WORKSPACE_TRUST_SETTING_TAG,
    opened,
    timestamp: Date.now(),
  }
}

function buildWorkspaceTrustConfigureSettingsShellProjection(
  registered: boolean,
  latestOpenRequest: WorkspaceTrustConfigureSettingsOpenRequest | null,
  openRequestCount: number,
): WorkspaceTrustConfigureSettingsShellProjection {
  return {
    owner: "WorkspaceTrustSettings",
    status: registered ? "registered" : "notRegistered",
    serviceId: "workbenchLayoutSettingsShell",
    stateSource: "IPreferencesService.openUserSettings+CodekSettingsShell",
    settingTag: WORKSPACE_TRUST_SETTING_TAG,
    query: WORKSPACE_TRUST_SETTINGS_QUERY,
    settingsSection: WORKSPACE_TRUST_SETTINGS_SECTION,
    latestOpenRequest,
    openRequestCount,
    reason: registered
      ? `VS Code workbench.trust.configure is represented as IPreferencesService.openUserSettings({ jsonEditor: false, query: "${WORKSPACE_TRUST_SETTINGS_QUERY}" }) and targets the existing Codek ${WORKSPACE_TRUST_SETTINGS_SECTION} settings shell`
      : "Workspace Trust settings shell is not wired in this boundary",
  }
}

function buildWorkspaceTrustManageEditorOpenRequest(opened: boolean): WorkspaceTrustManageEditorOpenRequest {
  return {
    commandId: WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Manage,
    input: buildWorkspaceTrustEditorInputProjection(),
    options: { pinned: true },
    editorPath: WORKSPACE_TRUST_EDITOR_RESOURCE,
    opened,
    timestamp: Date.now(),
  }
}

function buildWorkspaceTrustManageEditorShellProjection(
  registered: boolean,
  latestOpenRequest: WorkspaceTrustManageEditorOpenRequest | null,
  openRequestCount: number,
): WorkspaceTrustManageEditorShellProjection {
  return {
    owner: "WorkspaceTrustEditor",
    status: registered ? "registered" : "notRegistered",
    serviceId: "workbenchExplorerEditorService",
    stateSource: "WorkspaceTrustEditorInput+CodekEditorShell",
    input: buildWorkspaceTrustEditorInputProjection(),
    latestOpenRequest,
    openRequestCount,
    reason: registered
      ? "WorkspaceTrustEditorInput-compatible singleton input is wired to the existing Codek editor shell; open requests call the shell with pinned: true and preserve one WorkspaceTrustWorkbenchService state source"
      : "WorkspaceTrustEditorInput-compatible open requests are not wired to a Codek editor shell in this boundary",
  }
}

function buildWorkspaceTrustDialogShellProjection(registered: boolean): WorkspaceTrustDialogShellProjection {
  return {
    owner: "WorkspaceTrustRequestHandler",
    status: registered ? "registered" : "notRegistered",
    serviceId: "dialogService",
    stateSource: "CodekDialogService",
    handles: ["workspaceRequestDialog", "startupRequestDialog", "openFilesDialog", "resourcesDialog"],
    visualShellOwner: "App.vue dialog renderer",
    reason: registered
      ? "WorkspaceTrustRequestHandler workspace/startup/openFiles/resources request events are wired to CodekDialogService; dialog decisions complete the existing WorkspaceTrustWorkbenchService request lifecycle without adding a second trust store"
      : "WorkspaceTrustRequestHandler request events are not wired to CodekDialogService in this boundary",
  }
}

function buildExtensionHostLifecycleOperationOptions(root: string): ExtensionHostLifecycleOperationOptions {
  const normalizedRoot = String(root || "").trim()
  if (!normalizedRoot) return {}
  const workspaceFile = normalizedRoot.toLowerCase().endsWith(".code-workspace")
    ? normalizedRoot
    : null
  return {
    rootDir: normalizedRoot,
    workspaceRoots: [normalizedRoot],
    workspaceFile,
  }
}

async function showWorkspaceTrustRequestDialog(
  service: WorkspaceTrustManagementService,
  dialogService: ICodekDialogService,
  request: WorkspaceTrustRequestEvidence,
): Promise<void> {
  const { result } = await dialogService.prompt<"trust" | "restricted" | "manage">({
    type: "info",
    title: "工作区信任",
    message: "是否信任此工作区内文件的作者？",
    detail: request.message || "如果当前工作区不受信任，部分功能可能存在安全风险。",
    source: "WorkspaceTrustRequestHandler",
    evidenceContext: {
      operationId: `${request.kind}:${request.createdAt}`,
      workspaceFolder: request.root,
      commandId: "workbench.trust.request",
    },
    buttons: [
      { label: "信任工作区并继续", run: () => "trust" },
      { label: "以受限模式继续", run: () => "restricted" },
      { label: "管理", run: () => "manage" },
    ],
    cancelButton: "取消",
  })
  if (result === "trust") await service.completeWorkspaceTrustRequest(true)
  else if (result === "restricted") await service.completeWorkspaceTrustRequest(false)
  else if (result === "manage") service.cancelWorkspaceTrustRequest()
  else service.cancelWorkspaceTrustRequest()
}

async function showOpenFilesTrustRequestDialog(
  service: WorkspaceTrustManagementService,
  dialogService: ICodekDialogService,
  request: WorkspaceTrustRequestEvidence,
): Promise<void> {
  const { result, checkboxChecked } = await dialogService.prompt<WorkspaceTrustUriResponse>({
    type: "info",
    title: "工作区信任",
    message: "是否允许在此工作区中打开不受信任的文件？",
    detail: request.uris.join("\n"),
    source: "WorkspaceTrustRequestHandler",
    checkbox: { label: "记住对所有工作区的选择", checked: false },
    evidenceContext: {
      operationId: `${request.kind}:${request.createdAt}`,
      workspaceFolder: request.root,
      resource: request.uris[0],
      commandId: "workbench.trust.openFiles",
    },
    buttons: [
      { label: "打开", run: () => "open" },
      { label: "以受限模式打开", run: () => "openInNewWindow" },
    ],
    cancelButton: {
      label: "取消",
      run: () => "cancel",
    },
  })
  await service.completeOpenFilesTrustRequest(result || "cancel", Boolean(checkboxChecked))
}

async function showResourcesTrustRequestDialog(
  service: WorkspaceTrustManagementService,
  dialogService: ICodekDialogService,
  request: WorkspaceTrustRequestEvidence,
): Promise<void> {
  const { result } = await dialogService.prompt<WorkspaceTrustUriResponse>({
    type: "info",
    title: "工作区信任",
    message: "是否信任此文件夹内文件的作者？",
    detail: request.message || request.uri,
    source: "WorkspaceTrustRequestHandler",
    evidenceContext: {
      operationId: `${request.kind}:${request.createdAt}`,
      workspaceFolder: request.root,
      resource: request.uri,
      commandId: "workbench.trust.resources",
    },
    buttons: [
      { label: "信任文件夹并继续", run: () => "open" },
    ],
    cancelButton: {
      label: "取消",
      run: () => "cancel",
    },
  })
  await service.completeResourcesTrustRequest(request.uri, result || "cancel")
}

async function resolveRemoteConnection(
  manager: ReturnType<typeof getRemoteManager>,
  authority: string,
  options: RemoteAuthorityResolveOptions,
): Promise<RemoteConnection> {
  if (options.type === "ssh" || authority.startsWith("ssh-remote+")) {
    const sshConfig = options.sshConfig || parseSshAuthority(authority)
    return manager.connect("ssh", sshConfig)
  }
  const target = options.target || parseRemoteTarget(authority) || "default"
  return manager.connect("wsl", target)
}

function buildRemoteAuthorityEvidence(
  authority: string,
  connection: RemoteConnection | null,
  error: string,
  cacheHit: boolean,
  options: RemoteAuthorityResolvedOptionsProjection = {},
): RemoteAuthorityResolveEvidence {
  return {
    serviceId: String(IRemoteAuthorityResolverService),
    stateSource: "remoteManager",
    authority,
    status: connection ? "resolved" : "error",
    cacheHit,
    label: connection?.label || "",
    type: connection?.type || "",
    connectionId: connection?.id || "",
    error,
    optionsTrusted: options.isTrusted === true,
    authenticationSessionProviderId: options.authenticationSession?.providerId || "",
    authenticationSessionId: options.authenticationSession?.id || "",
    createdAt: Date.now(),
  }
}

function remoteAuthorityType(authority: string): string {
  if (authority.startsWith("ssh-remote+")) return "ssh"
  if (authority.startsWith("wsl+")) return "wsl"
  const index = authority.indexOf("+")
  return index > 0 ? authority.slice(0, index) : ""
}

function remoteAuthorityPrefix(authority: string): string {
  const index = authority.indexOf("+")
  return index > 0 ? authority.slice(0, index) : authority
}

function parseRemoteTarget(authority: string): string {
  const index = authority.indexOf("+")
  return index >= 0 ? authority.slice(index + 1) : authority
}

function parseSshAuthority(authority: string): SshConfig {
  const target = parseRemoteTarget(authority)
  const [usernamePart, hostPart] = target.includes("@") ? target.split("@", 2) : ["", target]
  const [host, portValue] = hostPart.split(":", 2)
  return {
    host: host || target || "localhost",
    port: Number(portValue) || 22,
    username: usernamePart || "codek",
    authType: "password",
    password: "",
  }
}

function buildAuthenticationSessionEvidence(
  scopes: string[] = [],
  providerId: string = auth.oauthProvider || "github",
  forcedStatus?: AuthenticationSessionStatus,
  forcedAccountLabel?: string,
): AuthenticationSessionEvidence {
  const status = forcedStatus || authenticationStatusFromAuthState()
  const accountLabel = forcedAccountLabel || auth.username || auth.email || ""
  return {
    providerId: providerId || "github",
    sessionId: accountLabel ? `${providerId || "github"}:${accountLabel}` : "",
    accountLabel,
    scopes,
    status,
    canPrompt: status === "missing" || status === "pending" || status === "expired" || status === "error",
    promptLabel: status === "authorized" ? "Signed in" : "Sign in",
    promptDetail: authenticationPromptDetail(status),
    error: status === "error" || status === "expired" ? auth.loginError || auth.loginErrorCode || "authentication error" : "",
    tokenRedacted: true,
    createdAt: Date.now(),
  }
}

function authenticationStatusFromAuthState(): AuthenticationSessionStatus {
  if (auth.oauthStatus === "expired" || auth.loginErrorCode === "expired") return "expired"
  if (auth.loginError || auth.oauthStatus === "error") return "error"
  if (auth.isLoggedIn) return "authorized"
  if (auth.loading || auth.oauthStatus === "pending" || auth.githubDeviceFlow.active) return "pending"
  return "missing"
}

function authenticationPromptDetail(status: AuthenticationSessionStatus): string {
  if (status === "pending") {
    return auth.githubDeviceFlow.verificationUri
      ? `Authorize ${auth.oauthProvider || "github"} - ${auth.githubDeviceFlow.verificationUri}`
      : "Authentication is pending"
  }
  if (status === "authorized") return auth.username || auth.email || "Authorized"
  if (status === "expired") return auth.loginError || auth.loginErrorCode || "Authentication expired"
  if (status === "revoked") return "Session was revoked through Authentication workbench facade"
  if (status === "error") return auth.loginError || auth.loginErrorCode || "Authentication failed"
  return "No authentication session"
}

function normalizeScopes(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean)
  if (typeof value === "string" && value.trim()) return [value.trim()]
  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
