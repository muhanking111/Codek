// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\extensions\browser\extensionsWorkbenchService.ts
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\extensions\browser\extensionsActions.ts
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\extensions\browser\extensionEditor.ts
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\extensions\browser\extensionsQuickAccess.ts

import { Action2, MenuId, MenuRegistry, registerAction2 } from "../vscode-adapter/platform/actions/common/menuRegistry"
import type { Disposable } from "../vscode-adapter/platform/commands/common/commandsRegistry"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import { registerQuickAccessProvider, type QuickAccessItem } from "../vscode-adapter/platform/quickinput/common/quickAccess"
import { executeCommand } from "../workbench/commandRegistry"
import { registerView, registerViewContainer } from "../workbench/viewRegistry"
import {
  disableExtension,
  enableExtension,
  type ExtensionHostLifecycleOperationEvidence,
  type ExtensionDisablementOverride,
  getFullExtensionDetails,
  installExtension,
  listInstalledExtensions,
  rollbackExtension,
  searchExtensions,
  streamInstallProgress,
  uninstallExtension,
  type ExtensionAuditEntry,
  type ExtensionAvailability,
  type ExtensionDetailsPayload,
  type InstallProgressEvent,
  type VsixMetadata,
} from "./ehClient"

export const EXTENSIONS_WORKBENCH_COMMAND_IDS = {
  Search: "workbench.extensions.search",
  Open: "workbench.extensions.open",
  Install: "workbench.extensions.install",
  Uninstall: "workbench.extensions.uninstall",
  Enable: "workbench.extensions.enable",
  Disable: "workbench.extensions.disable",
  Rollback: "workbench.extensions.rollback",
  ShowInstalled: "workbench.extensions.showInstalled",
  Manage: "workbench.extensions.manage",
} as const

export const EXTENSIONS_WORKBENCH_VIEW_IDS = {
  Container: "workbench.view.extensions",
  Marketplace: "workbench.extensions.marketplace",
  Installed: "workbench.extensions.installed",
  Editor: "workbench.extensions.detail",
} as const

export type ExtensionWorkbenchInstallState =
  | "installable"
  | "installed"
  | "activated"
  | "disabled"
  | "unsupported"
  | "updateAvailable"
  | "notInstallable"
  | "pending"
  | "error"

export type ExtensionWorkbenchActionId = "install" | "update" | "uninstall" | "enable" | "disable" | "rollback" | "open"

export const VS_CODE_EXTENSION_ENABLEMENT_STATE_CONTRACT = [
  "DisabledByTrustRequirement",
  "DisabledByExtensionKind",
  "DisabledByEnvironment",
  "EnabledByEnvironment",
  "DisabledByMalicious",
  "DisabledByVirtualWorkspace",
  "DisabledByInvalidExtension",
  "DisabledByAllowlist",
  "DisabledByExtensionDependency",
  "DisabledByUnification",
  "DisabledGlobally",
  "DisabledWorkspace",
  "EnabledGlobally",
  "EnabledWorkspace",
] as const

export type ExtensionWorkbenchEnablementState = typeof VS_CODE_EXTENSION_ENABLEMENT_STATE_CONTRACT[number]

export type ExtensionWorkbenchEnablementReason =
  | "workspaceTrust"
  | "extensionKind"
  | "environment"
  | "product"
  | "malicious"
  | "virtualWorkspace"
  | "invalidExtension"
  | "allowlist"
  | "configuration"
  | "extensionDependency"
  | "unification"
  | "globalUser"
  | "workspaceUser"

export interface ExtensionWorkbenchEnablementStateMatrixEntry {
  source: "vscode"
  state: ExtensionWorkbenchEnablementState
  vscodeOrdinal: number
  reason: ExtensionWorkbenchEnablementReason
  enabled: boolean
  mutableByUser: boolean
  requiresWorkspaceTrustTransition: boolean
}

export interface ExtensionWorkbenchEnablementProjection {
  source: "extensionsWorkbenchService"
  serviceId: string
  extensionId: string
  state: ExtensionWorkbenchEnablementState
  disabledByTrustRequirement: boolean
  workspaceTrusted: boolean
  requiresWorkspaceTrust: boolean
  untrustedWorkspaceSupport: boolean | "limited" | "unknown"
  trustRequirementSource:
    | "manifest.capabilities.untrustedWorkspaces.supported"
    | "installPlan.requiresConfirmation"
    | "missingManifestCapability"
  reason: ExtensionWorkbenchEnablementReason
  reasonDetail: string
  stateSource: "extensionsWorkbenchService+workspaceTrust" | "extensionsWorkbenchService+ehClient"
  evidence: ExtensionWorkbenchEnablementReasonEvidence
  dependencyEvidence: ExtensionWorkbenchDependencyEnablementEvidence | null
  workspaceLocationEvidence: ExtensionWorkbenchWorkspaceLocationTrustEvidence
}

export type ExtensionWorkbenchEnablementReasonEvidenceStatus = "available" | "blocked"
export type ExtensionWorkbenchEnablementReasonSource =
  | "manifest.capabilities.untrustedWorkspaces.supported"
  | "extensionDependencies"
  | "extensionKind"
  | "productService.disableExtensions"
  | "configurationService.extensions.allowed"
  | "globalExtensionEnablementService.disabledExtensions"
  | "missingProductConfigurationOverride"
  | "installed.enabled"

export interface ExtensionWorkbenchEnablementReasonEvidence {
  source: ExtensionWorkbenchEnablementReasonSource
  status: ExtensionWorkbenchEnablementReasonEvidenceStatus
  reason: ExtensionWorkbenchEnablementReason
  detail: string
  runtimeReference: false
  vscodeSourcePaths: readonly string[]
  currentSourcePaths: readonly string[]
  blockedReason?: string
  configKey?: string
  scope?: string
}

export interface ExtensionWorkbenchDependencyEnablementEvidence {
  source: "extensionDependencies"
  status: "available" | "notRequired"
  dependencyIds: readonly string[]
  disabledDependencyIds: readonly string[]
  disabledDependencyStates: ReadonlyArray<{
    extensionId: string
    state: ExtensionWorkbenchEnablementState
    reason: ExtensionWorkbenchEnablementReason
  }>
  reason: ExtensionWorkbenchEnablementReason
  detail: string
  runtimeReference: false
  vscodeSourcePaths: readonly string[]
  currentSourcePaths: readonly string[]
}

export interface ExtensionWorkbenchWorkspaceLocationTrustEvidence {
  source: "contextService.isInsideWorkspace(extension.location)"
  status: "available" | "blocked"
  isInsideWorkspace: boolean | null
  installPath: string
  workspaceRoots: readonly string[]
  reason: string
  runtimeReference: false
  vscodeSourcePaths: readonly string[]
  currentSourcePaths: readonly string[]
  blockedReason?: string
}

export type ExtensionWorkbenchLifecycleContractStatus = "available" | "partial" | "blocked"
export type ExtensionWorkbenchLifecyclePhase =
  | "notRequired"
  | "stopRequested"
  | "startRequested"
  | "blocked"
  | "completed"

export interface ExtensionWorkbenchLifecycleContractProjection {
  source: "extensionsWorkbenchService"
  serviceId: string
  vscodeServiceId: "extensionService"
  stateSource: "extensionsWorkbenchService+ehClient"
  restartOwner: "desktopExtensionHostProcessOwner"
  restartContract: "workbench.action.restartExtensionHost->IExtensionService.stopExtensionHosts+startExtensionHosts"
  reloadOwner: "workbenchWindowReloadService"
  localContract: "IExtensionService.stopExtensionHosts+startExtensionHosts"
  remoteContract: "hostService.reload"
  status: ExtensionWorkbenchLifecycleContractStatus
  phase: ExtensionWorkbenchLifecyclePhase
  owner: string
  reason: string
  blockedBy: "none" | "desktopExtensionHostLifecycleOwner" | "remoteAuthorityReloadOwner" | "workspaceTrustTransitionOwner"
  stopStartRoutesAvailable: boolean
  restartRequiresWorkspaceTrustTransition: boolean
  restartCompletedHere: boolean
  latestStopEvidence: ExtensionHostLifecycleOperationEvidence | null
  latestStartEvidence: ExtensionHostLifecycleOperationEvidence | null
  hostWorkspaceEvidence: ExtensionWorkbenchLifecycleWorkspaceEvidence
  remoteReloadOwnerEvidence: ExtensionWorkbenchRemoteReloadOwnerEvidence
}

export interface ExtensionWorkbenchLifecycleWorkspaceEvidence {
  source: "desktop.extensionsHostService.lifecycleEvidence"
  status: "available" | "blocked"
  workspaceRoots: readonly string[]
  workspaceFile: string | null
  reason: string
  runtimeReference: false
  currentSourcePaths: readonly string[]
  vscodeSourcePaths: readonly string[]
  blockedReason?: string
}

export interface ExtensionWorkbenchRemoteReloadOwnerEvidence {
  source: "WorkspaceTrustUXHandler.remoteAuthorityReload"
  status: "blocked"
  owner: "remoteAuthorityReloadOwner"
  blockedOwner: "workbenchWindowReloadService"
  blockedBoundary: "requiresWorkbenchWindowReloadOwner"
  vscodeContract: "IHostService.reload"
  vscodeSourcePaths: readonly string[]
  currentSourcePaths: readonly string[]
  requiredSignals: readonly ["remoteAgentService.getConnection().remoteAuthority", "hostService.reload"]
  currentSignals: {
    remoteAuthorityResolver: "available"
    extensionHostStopStartRoutes: "available"
    extensionHostReloadRoute: "extensionHostOnly"
    desktopLifecycleReloadOwner: "notWorkspaceTrustReloadOwner"
    hostServiceReload: "missing"
  }
  availableServiceLifecycleEvidence: readonly ["IExtensionService.stopExtensionHosts", "IExtensionService.startExtensionHosts"]
  extensionHostProcessRestartOwner: "desktopExtensionHostProcessOwner"
  vscodeRestartSourcePaths: readonly string[]
  restartContract: "workbench.action.restartExtensionHost->IExtensionService.stopExtensionHosts+startExtensionHosts"
  extensionHostReloadRouteScope: "extensionHostOnly"
  missingWindowReloadOwner: "AppWindowShellOrElectronMainReloadOwner"
  cannotSatisfyVscodeHostReloadWithExtensionHostReload: true
  blockedByCurrentOwnerBoundary: "AppWindowShellOrElectronMainReloadOwner"
  windowReloadSeparateFromExtensionHostRestart: true
  reason: string
  runtimeReference: false
}

export interface ExtensionWorkbenchEnablementRecomputeEvidence {
  source: "extensionsWorkbenchService"
  serviceId: string
  stateSource: "extensionsWorkbenchService+workspaceTrust"
  vscodeServiceId: "extensionEnablementService"
  vscodeSourcePaths: readonly string[]
  vscodeComputeSource: "IWorkspaceTrustManagementService.isWorkspaceTrusted+_computeEnablementState"
  trigger: "workspaceTrustTransition"
  workspaceTrusted: boolean
  recomputedCount: number
  disabledByTrustRequirementCount: number
  enablementMatrix: ExtensionWorkbenchEnablementStateMatrixEntry[]
  lifecycle: ExtensionWorkbenchLifecycleContractProjection
  hostLifecycleBinding: ExtensionWorkbenchHostLifecycleBindingEvidence
  states: ExtensionWorkbenchEnablementProjection[]
}

export interface ExtensionWorkbenchHostLifecycleBindingEvidence {
  source: "extensionsWorkbenchService"
  serviceId: string
  stateSource: "extensionsWorkbenchService+workspaceTrust"
  vscodeSourcePaths: readonly string[]
  currentSourcePaths: readonly string[]
  trigger: "workspaceTrustTransition"
  workspaceTrusted: boolean
  status: "notRequired" | "bound" | "blocked"
  reason: string
  disabledByTrustRequirementCount: number
  lifecyclePhase: ExtensionWorkbenchLifecyclePhase
  lifecycleStatus: ExtensionWorkbenchLifecycleContractStatus
  stopStartBoundToTrustTransition: boolean
  stopEvidenceBound: boolean
  startEvidenceBound: boolean
  stopReason: string
  startReason: string
  stopStateSource: "desktop.extensionsHostService" | "none"
  startStateSource: "desktop.extensionsHostService" | "none"
  noSecondEnablementState: true
  runtimeReference: false
}

export interface ExtensionWorkbenchAction {
  id: ExtensionWorkbenchActionId
  label: string
  enabled: boolean
  pending?: boolean
  detail?: string
}

export interface ExtensionWorkbenchUsabilityRow {
  id: string
  label: string
  status: "ready" | "pending" | "unsupported" | "notDeclared"
  statusLabel: string
  detail: string
}

export interface ExtensionWorkbenchActionState {
  action: Exclude<ExtensionWorkbenchActionId, "open" | "update">
  status: "pending" | "error"
  message?: string
}

export interface ExtensionWorkbenchActionCommand {
  source: "extensionsWorkbenchService"
  serviceId: string
  stateSource: "extensionsWorkbenchService"
  actionId: ExtensionWorkbenchActionId | "manage"
  commandId: string
  owner: "extensionsWorkbenchService"
  vscodeOwner: "extensionsActions"
  route: "workbench.commandRegistry"
  enabled: boolean
  label: string
  detail: string
  noSecondInstallState: true
}

export interface ExtensionWorkbenchEditorViewModel {
  id: string
  title: string
  displayName: string
  description: string
  publisher: string
  version: string
  source: string
  readmeSummary: string
  installPlanSummary: string
  compatibilitySummary: string
  installState: ExtensionWorkbenchInstallState
  statusLabel: string
  statusDetail: string
  metadata: Array<{ label: string; value: string }>
  actions: ExtensionWorkbenchAction[]
  evidence: {
    installPlanReady: boolean
    requiresConfirmation: boolean
    warnings: string[]
    audit: ExtensionAuditEntry[]
  }
  detailSummary: ExtensionWorkbenchDetailSummary
  payload: ExtensionDetailsPayload
}

export interface ExtensionWorkbenchDetailSummary {
  source: "extensionsWorkbenchService"
  serviceId: string
  extensionId: string
  label: string
  detail: string
  installState: ExtensionWorkbenchInstallState
  installPlanReady: boolean
  requiresConfirmation: boolean
  trustGate: {
    required: boolean
    detail: string
    warnings: string[]
  }
  availability: ExtensionAvailability
  usabilityRows: ExtensionWorkbenchUsabilityRow[]
  rollbackRisk: {
    available: boolean
    lastBackup: string
    detail: string
  }
  actionIds: string[]
  actionCommands: ExtensionWorkbenchActionCommand[]
  manageActionOwner: ExtensionWorkbenchActionCommand
  manageSecondaryActions: ExtensionWorkbenchActionCommand[]
  noSecondInstallState: true
  localFirst: true
  goesThroughEhClient: true
}

export interface ExtensionWorkbenchContributionSummary {
  source: "extensionsWorkbenchService"
  serviceId: string
  label: string
  containerId: string
  viewIds: string[]
  commandIds: string[]
  supportedContributionPoints: string[]
  unsupportedContributionPoints: string[]
  usabilityContract: "installed->enabled->extensionHostActivation->contributionProjection"
  quickAccessPrefix: "ext "
  viewActionMenuDriven: true
  noSecondInstallState: true
}

export interface ExtensionWorkbenchSurfaceSnapshot {
  source: "extensionsWorkbenchService"
  serviceId: string
  containerId: string
  viewIds: string[]
  commandIds: string[]
  quickAccessPrefix: "ext "
  stateSource: "service"
  contributionSummary: ExtensionWorkbenchContributionSummary
  lastSearchQuery: string
  lastSearchResultCount: number
  installedCount: number
  editorCount: number
  openedExtensionIds: string[]
  latestEditorId: string
  actionStateCount: number
  pendingActionCount: number
  errorActionCount: number
  progressCount: number
  enablementRecomputedCount?: number
  disabledByTrustRequirementCount?: number
  enablementMatrix?: ExtensionWorkbenchEnablementStateMatrixEntry[]
  extensionHostLifecycle?: ExtensionWorkbenchLifecycleContractProjection
  latestEnablementRecompute?: ExtensionWorkbenchEnablementRecomputeEvidence | null
  latestProgress?: (InstallProgressEvent & { extensionId: string })
  constraints: {
    localFirst: true
    goesThroughEhClient: true
    noSecondInstallState: true
    viewActionMenuDriven: true
  }
}

export interface ExtensionsWorkbenchService {
  readonly _serviceBrand: undefined
  search(query: string, options?: { pageSize?: number; category?: string }): Promise<VsixMetadata[]>
  open(extensionId: string, version?: string): Promise<ExtensionWorkbenchEditorViewModel | null>
  showInstalled(): Promise<VsixMetadata[]>
  install(extensionId: string, version?: string, options?: { onProgress?: (event: InstallProgressEvent) => void }): Promise<{ success: boolean; error?: string }>
  uninstall(extensionId: string): Promise<{ success: boolean; error?: string }>
  enable(extensionId: string): Promise<{ success: boolean; error?: string }>
  disable(extensionId: string): Promise<{ success: boolean; error?: string }>
  rollback(extensionId: string): Promise<{ success: boolean; error?: string }>
  buildEditorViewModel(payload: ExtensionDetailsPayload): ExtensionWorkbenchEditorViewModel
  setEditorViewModelForEvidence(payload: ExtensionDetailsPayload): ExtensionWorkbenchEditorViewModel
  getEditorViewModel(extensionId: string): ExtensionWorkbenchEditorViewModel | undefined
  getDetailSummary(extensionId: string): ExtensionWorkbenchDetailSummary | undefined
  getInstallProgress(extensionId: string): InstallProgressEvent | undefined
  getActionState(extensionId: string): ExtensionWorkbenchActionState | undefined
  recomputeEnablementForWorkspaceTrust(workspaceTrusted: boolean): ExtensionWorkbenchEnablementRecomputeEvidence
  getEnablementProjection(extensionId: string): ExtensionWorkbenchEnablementProjection | undefined
  getEnablementStateMatrix(): ExtensionWorkbenchEnablementStateMatrixEntry[]
  getExtensionHostLifecycleContract(): ExtensionWorkbenchLifecycleContractProjection
  recordExtensionHostLifecycleEvidence(input: {
    stopEvidence?: ExtensionHostLifecycleOperationEvidence | null
    startEvidence?: ExtensionHostLifecycleOperationEvidence | null
  }): ExtensionWorkbenchLifecycleContractProjection
  getSurfaceSnapshot(): ExtensionWorkbenchSurfaceSnapshot
  clearState(): void
}

export const IExtensionsWorkbenchService = createDecorator<ExtensionsWorkbenchService>("extensionsWorkbenchService")

export const VS_CODE_EXTENSION_TRUST_SOURCE_PATHS = [
  "src/vs/workbench/services/extensionManagement/browser/extensionEnablementService.ts",
  "src/vs/platform/extensionManagement/common/extensionEnablementService.ts",
  "src/vs/platform/extensionManagement/common/allowedExtensionsService.ts",
  "src/vs/platform/workspace/common/workspace.ts",
  "src/vs/workbench/services/extensionManagement/common/extensionManagement.ts",
  "src/vs/workbench/services/extensions/common/extensions.ts",
  "src/vs/workbench/contrib/extensions/browser/extensionsWorkbenchService.ts",
  "src/vs/platform/workspace/common/workspaceTrust.ts",
] as const

export const VS_CODE_WORKSPACE_TRUST_REMOTE_RELOAD_SOURCE_PATHS = [
  "src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts",
  "src/vs/workbench/services/remote/common/remoteAgentService.ts",
  "src/vs/workbench/services/host/browser/host.ts",
  "src/vs/workbench/services/host/electron-browser/nativeHostService.ts",
] as const

export const VS_CODE_EXTENSION_HOST_RESTART_SOURCE_PATHS = [
  "src/vs/workbench/services/extensions/electron-browser/nativeExtensionService.ts",
  "src/vs/workbench/services/extensions/common/abstractExtensionService.ts",
  "src/vs/workbench/services/extensions/common/extensions.ts",
] as const

export const CODEK_WORKSPACE_TRUST_REMOTE_RELOAD_AUDIT_SOURCE_PATHS = [
  "frontend/vite-project/src/extensions/extensionsWorkbenchService.ts",
  "frontend/vite-project/src/workbench/extensionTrustRemoteAuthWorkbench.ts",
  "frontend/vite-project/src/extensions/ehClient.ts",
  "desktop/services/extensions-host/index.js",
  "desktop/lifecycle.js",
  "desktop/main.js",
  "frontend/vite-project/src/App.vue",
] as const

export const CODEK_EXTENSION_ENABLEMENT_SOURCE_PATHS = [
  "frontend/vite-project/src/extensions/extensionsWorkbenchService.ts",
  "frontend/vite-project/src/extensions/ehClient.ts",
  "desktop/services/extensions-host/extensionManager.js",
  "desktop/services/extensions-host/extensionDetails.js",
  "desktop/services/extensions-host/index.js",
  "desktop/services/extensions-host/mainThread/mainThreadWorkspace.js",
] as const

export const EXTENSION_WORKBENCH_ENABLEMENT_STATE_MATRIX: ExtensionWorkbenchEnablementStateMatrixEntry[] = [
  { source: "vscode", state: "DisabledByTrustRequirement", vscodeOrdinal: 0, reason: "workspaceTrust", enabled: false, mutableByUser: false, requiresWorkspaceTrustTransition: true },
  { source: "vscode", state: "DisabledByExtensionKind", vscodeOrdinal: 1, reason: "extensionKind", enabled: false, mutableByUser: false, requiresWorkspaceTrustTransition: false },
  { source: "vscode", state: "DisabledByEnvironment", vscodeOrdinal: 2, reason: "environment", enabled: false, mutableByUser: false, requiresWorkspaceTrustTransition: false },
  { source: "vscode", state: "EnabledByEnvironment", vscodeOrdinal: 3, reason: "environment", enabled: true, mutableByUser: false, requiresWorkspaceTrustTransition: false },
  { source: "vscode", state: "DisabledByMalicious", vscodeOrdinal: 4, reason: "malicious", enabled: false, mutableByUser: false, requiresWorkspaceTrustTransition: false },
  { source: "vscode", state: "DisabledByVirtualWorkspace", vscodeOrdinal: 5, reason: "virtualWorkspace", enabled: false, mutableByUser: false, requiresWorkspaceTrustTransition: false },
  { source: "vscode", state: "DisabledByInvalidExtension", vscodeOrdinal: 6, reason: "invalidExtension", enabled: false, mutableByUser: false, requiresWorkspaceTrustTransition: false },
  { source: "vscode", state: "DisabledByAllowlist", vscodeOrdinal: 7, reason: "allowlist", enabled: false, mutableByUser: false, requiresWorkspaceTrustTransition: false },
  { source: "vscode", state: "DisabledByExtensionDependency", vscodeOrdinal: 8, reason: "extensionDependency", enabled: false, mutableByUser: false, requiresWorkspaceTrustTransition: false },
  { source: "vscode", state: "DisabledByUnification", vscodeOrdinal: 9, reason: "unification", enabled: false, mutableByUser: false, requiresWorkspaceTrustTransition: false },
  { source: "vscode", state: "DisabledGlobally", vscodeOrdinal: 10, reason: "globalUser", enabled: false, mutableByUser: true, requiresWorkspaceTrustTransition: false },
  { source: "vscode", state: "DisabledWorkspace", vscodeOrdinal: 11, reason: "workspaceUser", enabled: false, mutableByUser: true, requiresWorkspaceTrustTransition: false },
  { source: "vscode", state: "EnabledGlobally", vscodeOrdinal: 12, reason: "globalUser", enabled: true, mutableByUser: true, requiresWorkspaceTrustTransition: false },
  { source: "vscode", state: "EnabledWorkspace", vscodeOrdinal: 13, reason: "workspaceUser", enabled: true, mutableByUser: true, requiresWorkspaceTrustTransition: false },
]

export class ExtensionWorkbenchService implements ExtensionsWorkbenchService {
  declare readonly _serviceBrand: undefined

  private readonly editors = new Map<string, ExtensionWorkbenchEditorViewModel>()
  private readonly actionStates = new Map<string, ExtensionWorkbenchActionState>()
  private readonly progress = new Map<string, InstallProgressEvent>()
  private readonly enablement = new Map<string, ExtensionWorkbenchEnablementProjection>()
  private readonly searchResults = new Map<string, VsixMetadata>()
  private readonly installed = new Map<string, VsixMetadata>()
  private latestEnablementRecompute: ExtensionWorkbenchEnablementRecomputeEvidence | null = null
  private latestStopEvidence: ExtensionHostLifecycleOperationEvidence | null = null
  private latestStartEvidence: ExtensionHostLifecycleOperationEvidence | null = null
  private lastSearchQuery = ""
  private lastSearchResultCount = 0
  private latestEditorId = ""
  private latestProgressExtensionId = ""

  async search(query: string, options: { pageSize?: number; category?: string } = {}): Promise<VsixMetadata[]> {
    const results = await searchExtensions(query, { pageSize: options.pageSize ?? 30, category: options.category })
    this.lastSearchQuery = String(query || "")
    this.lastSearchResultCount = results.length
    this.searchResults.clear()
    for (const extension of results) this.searchResults.set(normalizeExtensionId(extension.id), extension)
    return results
  }

  async open(extensionId: string, version?: string): Promise<ExtensionWorkbenchEditorViewModel | null> {
    const payload = await getFullExtensionDetails(extensionId, version)
    if (!payload) return null
    return this.setEditorViewModelForEvidence(payload)
  }

  async showInstalled(): Promise<VsixMetadata[]> {
    const installed = await listInstalledExtensions()
    this.installed.clear()
    for (const extension of installed) this.installed.set(normalizeExtensionId(extension.id), extension)
    return installed
  }

  async install(
    extensionId: string,
    version?: string,
    options: { onProgress?: (event: InstallProgressEvent) => void } = {},
  ): Promise<{ success: boolean; error?: string }> {
    return this.runControlledAction(extensionId, "install", async () => {
      const off = streamInstallProgress(extensionId, (event) => {
        this.progress.set(normalizeExtensionId(extensionId), event)
        this.latestProgressExtensionId = extensionId
        options.onProgress?.(event)
      })
      try {
        return await installExtension(extensionId, version, { confirmed: this.resolveInstallConfirmation(extensionId) })
      } finally {
        off()
      }
    })
  }

  async uninstall(extensionId: string): Promise<{ success: boolean; error?: string }> {
    return this.runControlledAction(extensionId, "uninstall", () => uninstallExtension(extensionId))
  }

  async enable(extensionId: string): Promise<{ success: boolean; error?: string }> {
    return this.runControlledAction(extensionId, "enable", async () => {
      await enableExtension(extensionId)
      return { success: true }
    })
  }

  async disable(extensionId: string): Promise<{ success: boolean; error?: string }> {
    return this.runControlledAction(extensionId, "disable", async () => {
      await disableExtension(extensionId)
      return { success: true }
    })
  }

  async rollback(extensionId: string): Promise<{ success: boolean; error?: string }> {
    return this.runControlledAction(extensionId, "rollback", () => rollbackExtension(extensionId))
  }

  buildEditorViewModel(payload: ExtensionDetailsPayload): ExtensionWorkbenchEditorViewModel {
    const extension = payload.extension
    const actionState = this.actionStates.get(normalizeExtensionId(payload.id))
    const installState = resolveInstallState(payload, actionState)
    const status = statusForInstallState(installState, payload, actionState)
    const source = extension.sourceUrl || extension.source || extension.repository || extension.downloadUrl || ""
    const version = payload.latestVersion || extension.version || payload.installed?.version || ""
    const metadata = [
      { label: "发布者", value: extension.publisher },
      { label: "版本", value: version },
      { label: "来源", value: source },
      { label: "引擎", value: extension.engines?.vscode || "" },
      { label: "类别", value: extension.categories?.join(", ") || "" },
      { label: "许可证", value: extension.license || "" },
    ].filter((entry) => entry.value)

    return {
      id: payload.id,
      title: extension.displayName || payload.id,
      displayName: extension.displayName || payload.id,
      description: extension.description || "",
      publisher: extension.publisher || "",
      version,
      source,
      readmeSummary: summarizeMarkdown(payload.readme?.text || ""),
      installPlanSummary: summarizeInstallPlan(payload),
      compatibilitySummary: summarizeCompatibility(payload),
      installState,
      statusLabel: status.label,
      statusDetail: status.detail,
      metadata,
      actions: buildActions(installState, status.detail, Boolean(payload.installState?.lastBackup), payload.installed?.enabled !== false, actionState),
      evidence: {
        installPlanReady: Boolean(payload.installPlan?.readyToInstall),
        requiresConfirmation: Boolean(payload.installPlan?.requiresConfirmation),
        warnings: [
          ...(payload.installPlan?.warnings || []).map((warning) => warning.message),
          ...(payload.compatibility?.warnings || []).map((warning) => warning.message),
          ...(payload.compatibility?.blockers || []).map((blocker) => blocker.message),
        ].filter(Boolean),
        audit: payload.audit || [],
      },
      detailSummary: buildDetailSummary(payload, installState, status.label, status.detail, actionState),
      payload,
    }
  }

  setEditorViewModelForEvidence(payload: ExtensionDetailsPayload): ExtensionWorkbenchEditorViewModel {
    const model = this.buildEditorViewModel(payload)
    this.editors.set(normalizeExtensionId(model.id), model)
    this.latestEditorId = model.id
    return model
  }

  getEditorViewModel(extensionId: string): ExtensionWorkbenchEditorViewModel | undefined {
    return this.editors.get(normalizeExtensionId(extensionId))
  }

  getDetailSummary(extensionId: string): ExtensionWorkbenchDetailSummary | undefined {
    return this.getEditorViewModel(extensionId)?.detailSummary
  }

  getInstallProgress(extensionId: string): InstallProgressEvent | undefined {
    return this.progress.get(normalizeExtensionId(extensionId))
  }

  getActionState(extensionId: string): ExtensionWorkbenchActionState | undefined {
    return this.actionStates.get(normalizeExtensionId(extensionId))
  }

  recomputeEnablementForWorkspaceTrust(workspaceTrusted: boolean): ExtensionWorkbenchEnablementRecomputeEvidence {
    const models = [...this.editors.values()]
    const baseStates = models.map((model) => this.buildEnablementProjection(model, workspaceTrusted))
    const states = applyDependencyEnablementProjections(models, baseStates)
    this.enablement.clear()
    for (const state of states) this.enablement.set(normalizeExtensionId(state.extensionId), state)
    const evidence: ExtensionWorkbenchEnablementRecomputeEvidence = {
      source: "extensionsWorkbenchService",
      serviceId: String(IExtensionsWorkbenchService),
      stateSource: "extensionsWorkbenchService+workspaceTrust",
      vscodeServiceId: "extensionEnablementService",
      vscodeSourcePaths: VS_CODE_EXTENSION_TRUST_SOURCE_PATHS,
      vscodeComputeSource: "IWorkspaceTrustManagementService.isWorkspaceTrusted+_computeEnablementState",
      trigger: "workspaceTrustTransition",
      workspaceTrusted,
      recomputedCount: states.length,
      disabledByTrustRequirementCount: states.filter((state) => state.disabledByTrustRequirement).length,
      enablementMatrix: this.getEnablementStateMatrix(),
      lifecycle: this.getExtensionHostLifecycleContract(),
      hostLifecycleBinding: buildHostLifecycleBindingEvidence(
        workspaceTrusted,
        states.filter((state) => state.disabledByTrustRequirement).length,
        this.getExtensionHostLifecycleContract(),
      ),
      states,
    }
    this.latestEnablementRecompute = evidence
    return evidence
  }

  getEnablementProjection(extensionId: string): ExtensionWorkbenchEnablementProjection | undefined {
    return this.enablement.get(normalizeExtensionId(extensionId))
  }

  getEnablementStateMatrix(): ExtensionWorkbenchEnablementStateMatrixEntry[] {
    return EXTENSION_WORKBENCH_ENABLEMENT_STATE_MATRIX.map((entry) => ({ ...entry }))
  }

  getExtensionHostLifecycleContract(): ExtensionWorkbenchLifecycleContractProjection {
    return buildExtensionHostLifecycleContract(this.latestStopEvidence, this.latestStartEvidence)
  }

  recordExtensionHostLifecycleEvidence(input: {
    stopEvidence?: ExtensionHostLifecycleOperationEvidence | null
    startEvidence?: ExtensionHostLifecycleOperationEvidence | null
  }): ExtensionWorkbenchLifecycleContractProjection {
    if (input.stopEvidence !== undefined) this.latestStopEvidence = input.stopEvidence
    if (input.startEvidence !== undefined) this.latestStartEvidence = input.startEvidence
    if (this.latestEnablementRecompute) {
      this.refreshWorkspaceLocationEvidence()
      const lifecycle = this.getExtensionHostLifecycleContract()
      const states = [...this.enablement.values()]
      this.latestEnablementRecompute = {
        ...this.latestEnablementRecompute,
        lifecycle,
        hostLifecycleBinding: buildHostLifecycleBindingEvidence(
          this.latestEnablementRecompute.workspaceTrusted,
          states.filter((state) => state.disabledByTrustRequirement).length,
          lifecycle,
        ),
        states,
      }
    }
    return this.getExtensionHostLifecycleContract()
  }

  clearState(): void {
    this.editors.clear()
    this.actionStates.clear()
    this.progress.clear()
    this.enablement.clear()
    this.searchResults.clear()
    this.installed.clear()
    this.latestEnablementRecompute = null
    this.latestStopEvidence = null
    this.latestStartEvidence = null
    this.lastSearchQuery = ""
    this.lastSearchResultCount = 0
    this.latestEditorId = ""
    this.latestProgressExtensionId = ""
  }

  getSurfaceSnapshot(): ExtensionWorkbenchSurfaceSnapshot {
    const actionStates = [...this.actionStates.values()]
    const latestProgress = this.latestProgressExtensionId
      ? this.progress.get(normalizeExtensionId(this.latestProgressExtensionId))
      : undefined
    return {
      source: "extensionsWorkbenchService",
      serviceId: String(IExtensionsWorkbenchService),
      containerId: EXTENSIONS_WORKBENCH_VIEW_IDS.Container,
      viewIds: [
        EXTENSIONS_WORKBENCH_VIEW_IDS.Marketplace,
        EXTENSIONS_WORKBENCH_VIEW_IDS.Installed,
        EXTENSIONS_WORKBENCH_VIEW_IDS.Editor,
      ],
      commandIds: Object.values(EXTENSIONS_WORKBENCH_COMMAND_IDS),
      quickAccessPrefix: "ext ",
      stateSource: "service",
      contributionSummary: buildContributionSummary(),
      lastSearchQuery: this.lastSearchQuery,
      lastSearchResultCount: this.lastSearchResultCount,
      installedCount: this.installed.size,
      editorCount: this.editors.size,
      openedExtensionIds: [...this.editors.values()].map((model) => model.id),
      latestEditorId: this.latestEditorId,
      actionStateCount: actionStates.length,
      pendingActionCount: actionStates.filter((state) => state.status === "pending").length,
      errorActionCount: actionStates.filter((state) => state.status === "error").length,
      progressCount: this.progress.size,
      enablementRecomputedCount: this.latestEnablementRecompute?.recomputedCount || 0,
      disabledByTrustRequirementCount: this.latestEnablementRecompute?.disabledByTrustRequirementCount || 0,
      enablementMatrix: this.getEnablementStateMatrix(),
      extensionHostLifecycle: this.getExtensionHostLifecycleContract(),
      latestEnablementRecompute: this.latestEnablementRecompute,
      ...(latestProgress ? { latestProgress: { extensionId: this.latestProgressExtensionId, ...latestProgress } } : {}),
      constraints: {
        localFirst: true,
        goesThroughEhClient: true,
        noSecondInstallState: true,
        viewActionMenuDriven: true,
      },
    }
  }

  private async runControlledAction(
    extensionId: string,
    action: Exclude<ExtensionWorkbenchActionId, "open" | "update">,
    run: () => Promise<{ success: boolean; error?: string }>,
  ): Promise<{ success: boolean; error?: string }> {
    const key = normalizeExtensionId(extensionId)
    this.actionStates.set(key, { action, status: "pending" })
    try {
      const result = await run()
      if (!result.success) {
        this.actionStates.set(key, { action, status: "error", message: result.error || "扩展操作失败" })
      } else {
        this.actionStates.delete(key)
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.actionStates.set(key, { action, status: "error", message })
      return { success: false, error: message }
    }
  }

  private resolveInstallConfirmation(extensionId: string): boolean {
    const model = this.getEditorViewModel(extensionId)
    return model?.detailSummary.requiresConfirmation === true
  }

  private buildEnablementProjection(
    model: ExtensionWorkbenchEditorViewModel,
    workspaceTrusted: boolean,
  ): ExtensionWorkbenchEnablementProjection {
    const installedEnabled = model.payload.installed?.enabled !== false
    const trustRequirement = resolveWorkspaceTrustRequirement(model)
    const override = resolveProductConfigurationOverride(model)
    if (override) {
      return {
        source: "extensionsWorkbenchService",
        serviceId: String(IExtensionsWorkbenchService),
        extensionId: model.id,
        state: override.state,
        disabledByTrustRequirement: false,
        workspaceTrusted,
        requiresWorkspaceTrust: trustRequirement.requiresWorkspaceTrust,
        untrustedWorkspaceSupport: trustRequirement.untrustedWorkspaceSupport,
        trustRequirementSource: trustRequirement.source,
        reason: override.reason,
        reasonDetail: override.evidence.detail,
        stateSource: "extensionsWorkbenchService+ehClient",
        evidence: override.evidence,
        dependencyEvidence: buildDependencyEnablementEvidence(model),
        workspaceLocationEvidence: buildWorkspaceLocationTrustEvidence(model, this.getWorkspaceLocationLifecycleEvidence()),
      }
    }
    const disabledByTrustRequirement = trustRequirement.requiresWorkspaceTrust && !workspaceTrusted && installedEnabled
    const state: ExtensionWorkbenchEnablementState = disabledByTrustRequirement
      ? "DisabledByTrustRequirement"
      : installedEnabled
        ? "EnabledWorkspace"
        : "DisabledWorkspace"
    return {
      source: "extensionsWorkbenchService",
      serviceId: String(IExtensionsWorkbenchService),
      extensionId: model.id,
      state,
      disabledByTrustRequirement,
      workspaceTrusted,
      requiresWorkspaceTrust: trustRequirement.requiresWorkspaceTrust,
      untrustedWorkspaceSupport: trustRequirement.untrustedWorkspaceSupport,
      trustRequirementSource: trustRequirement.source,
      reason: disabledByTrustRequirement
        ? "workspaceTrust"
        : installedEnabled
          ? "workspaceUser"
          : "workspaceUser",
      reasonDetail: disabledByTrustRequirement
        ? trustRequirement.reasonDetail
        : installedEnabled
          ? "extension remains enabled for the current workspace trust state"
          : "extension is disabled by its installed workspace state",
      stateSource: "extensionsWorkbenchService+workspaceTrust",
      evidence: disabledByTrustRequirement
        ? buildEnablementReasonEvidence({
          source: "manifest.capabilities.untrustedWorkspaces.supported",
          status: "available",
          reason: "workspaceTrust",
          detail: trustRequirement.reasonDetail,
        })
        : buildEnablementReasonEvidence({
          source: installedEnabled ? "missingProductConfigurationOverride" : "installed.enabled",
          status: installedEnabled ? "blocked" : "available",
          reason: "workspaceUser",
          detail: installedEnabled
            ? "No product/config override metadata was present in the extension details payload; enablement remains workspace-user derived until desktop exposes productService/configurationService evidence."
            : "已安装扩展 payload 通过现有扩展宿主安装状态报告 enabled=false。",
          blockedReason: installedEnabled
            ? "Desktop extension host does not yet expose productService.disableExtensions, configurationService extensions.allowed, or global disabledExtensions metadata on this payload."
            : undefined,
        }),
      dependencyEvidence: buildDependencyEnablementEvidence(model),
      workspaceLocationEvidence: buildWorkspaceLocationTrustEvidence(model, this.getWorkspaceLocationLifecycleEvidence()),
    }
  }

  private refreshWorkspaceLocationEvidence(): void {
    const lifecycleEvidence = this.getWorkspaceLocationLifecycleEvidence()
    for (const [extensionId, state] of this.enablement) {
      const model = this.editors.get(normalizeExtensionId(extensionId))
      if (!model) continue
      this.enablement.set(extensionId, {
        ...state,
        workspaceLocationEvidence: buildWorkspaceLocationTrustEvidence(model, lifecycleEvidence),
      })
    }
  }

  private getWorkspaceLocationLifecycleEvidence(): ExtensionHostLifecycleOperationEvidence | null {
    return resolveWorkspaceLocationLifecycleEvidence(this.latestStartEvidence, this.latestStopEvidence)
  }
}

export const extensionWorkbenchService = new ExtensionWorkbenchService()
registerSingleton(IExtensionsWorkbenchService, extensionWorkbenchService, InstantiationType.Delayed)

let registrations: Disposable[] = []

export function registerExtensionWorkbenchContributions(service: ExtensionsWorkbenchService = extensionWorkbenchService): Disposable {
  disposeExtensionWorkbenchContributions()

  registerViewContainer({
    id: EXTENSIONS_WORKBENCH_VIEW_IDS.Container,
    name: "扩展",
    location: "activityBar",
    icon: "extensions",
    source: "vscode",
    order: 50,
  })
  registerView({
    id: `${EXTENSIONS_WORKBENCH_VIEW_IDS.Container}.default`,
    name: "扩展",
    containerId: EXTENSIONS_WORKBENCH_VIEW_IDS.Container,
    location: "sideBar",
    source: "vscode",
    order: 999,
    when: "extensionsWorkbenchAdapterDisabled == true",
    userDescription: "默认扩展占位视图被 extensionsWorkbenchService adapter 接管后隐藏。",
  })
  registerView({
    id: EXTENSIONS_WORKBENCH_VIEW_IDS.Marketplace,
    name: "扩展市场",
    containerId: EXTENSIONS_WORKBENCH_VIEW_IDS.Container,
    location: "sideBar",
    source: "vscode",
    order: 10,
  })
  registerView({
    id: EXTENSIONS_WORKBENCH_VIEW_IDS.Installed,
    name: "已安装扩展",
    containerId: EXTENSIONS_WORKBENCH_VIEW_IDS.Container,
    location: "sideBar",
    source: "vscode",
    order: 20,
  })
  registerView({
    id: EXTENSIONS_WORKBENCH_VIEW_IDS.Editor,
    name: "扩展详情",
    containerId: EXTENSIONS_WORKBENCH_VIEW_IDS.Container,
    location: "sideBar",
    source: "vscode",
    order: 30,
  })

  registrations = [
    registerExtensionSearchAction(service),
    registerExtensionOpenAction(service),
    registerExtensionInstallAction(service),
    registerExtensionUninstallAction(service),
    registerExtensionEnableAction(service),
    registerExtensionDisableAction(service),
    registerExtensionRollbackAction(service),
    registerExtensionShowInstalledAction(service),
    registerExtensionManageAction(service),
    registerQuickAccessProvider({
      prefix: "ext ",
      placeholder: "搜索扩展",
      helpEntries: [{
        prefix: "ext ",
        description: "扩展",
        commandId: EXTENSIONS_WORKBENCH_COMMAND_IDS.Search,
      }],
      provider: {
        provide: (filter) => getExtensionQuickAccessItems(filter, service),
      },
    }),
  ]

  return { dispose: disposeExtensionWorkbenchContributions }
}

export function disposeExtensionWorkbenchContributions(): void {
  for (const registration of registrations.splice(0)) registration.dispose()
}

async function getExtensionQuickAccessItems(filter: string, service: ExtensionsWorkbenchService): Promise<QuickAccessItem[]> {
  const query = String(filter || "").trim()
  if (!query) {
    return [{
      id: "extensions.search.placeholder",
      label: "输入扩展名称进行搜索",
      description: "扩展",
      commandId: EXTENSIONS_WORKBENCH_COMMAND_IDS.Search,
    }]
  }

  const results = await service.search(query, { pageSize: 12 })
  const items = results.map((extension): QuickAccessItem => ({
    id: `extensions.detail:${extension.id}`,
    label: extension.displayName || extension.id,
    description: extension.id,
    detail: extension.description,
    commandId: EXTENSIONS_WORKBENCH_COMMAND_IDS.Open,
    args: [extension.id],
    buttons: [{
      id: "install",
      label: "+",
      tooltip: "安装扩展",
      acceptInBackground: true,
      accept: async () => {
        await service.install(extension.id, extension.version)
      },
    }],
    accept: async () => {
      await service.open(extension.id)
    },
  }))

  return items.length > 0 ? items : [{
    id: "extensions.search.empty",
    label: `没有找到“${query}”相关扩展`,
    description: "扩展",
  }]
}

function registerExtensionSearchAction(service: ExtensionsWorkbenchService): Disposable {
  return registerActionClass(EXTENSIONS_WORKBENCH_COMMAND_IDS.Search, "搜索扩展", "扩展", async (...args) => {
    await service.search(String(args[0] || ""), { pageSize: 30 })
  }, [{
    id: MenuId.CommandPalette,
    group: "navigation",
  }, {
    id: MenuId.ViewTitle,
    group: "navigation",
    order: 10,
    when: "view == workbench.extensions.marketplace",
  }])
}

function registerExtensionOpenAction(service: ExtensionsWorkbenchService): Disposable {
  return registerActionClass(EXTENSIONS_WORKBENCH_COMMAND_IDS.Open, "打开扩展", "扩展", async (...args) => {
    const [extensionId, version] = normalizeActionArgs(args)
    if (extensionId) await service.open(extensionId, version)
  }, [{
    id: MenuId.CommandPalette,
    group: "navigation",
  }])
}

function registerExtensionInstallAction(service: ExtensionsWorkbenchService): Disposable {
  return registerActionClass(EXTENSIONS_WORKBENCH_COMMAND_IDS.Install, "安装扩展", "扩展", async (...args) => {
    const [extensionId, version] = normalizeActionArgs(args)
    if (extensionId) await service.install(extensionId, version)
  }, [{
    id: MenuId.CommandPalette,
    group: "navigation",
  }, {
    id: MenuId.ViewTitle,
    group: "navigation",
    order: 20,
    when: "view == workbench.extensions.detail",
  }])
}

function registerExtensionUninstallAction(service: ExtensionsWorkbenchService): Disposable {
  return registerActionClass(EXTENSIONS_WORKBENCH_COMMAND_IDS.Uninstall, "卸载扩展", "扩展", async (...args) => {
    const [extensionId] = normalizeActionArgs(args)
    if (extensionId) await service.uninstall(extensionId)
  }, [{
    id: MenuId.CommandPalette,
    group: "navigation",
  }, {
    id: MenuId.ViewTitle,
    group: "navigation",
    order: 30,
    when: "view == workbench.extensions.detail",
  }])
}

function registerExtensionEnableAction(service: ExtensionsWorkbenchService): Disposable {
  return registerActionClass(EXTENSIONS_WORKBENCH_COMMAND_IDS.Enable, "启用扩展", "扩展", async (...args) => {
    const [extensionId] = normalizeActionArgs(args)
    if (extensionId) await service.enable(extensionId)
  }, [{
    id: MenuId.CommandPalette,
    group: "navigation",
  }, {
    id: MenuId.ViewTitle,
    group: "navigation",
    order: 40,
    when: "view == workbench.extensions.detail",
  }])
}

function registerExtensionDisableAction(service: ExtensionsWorkbenchService): Disposable {
  return registerActionClass(EXTENSIONS_WORKBENCH_COMMAND_IDS.Disable, "禁用扩展", "扩展", async (...args) => {
    const [extensionId] = normalizeActionArgs(args)
    if (extensionId) await service.disable(extensionId)
  }, [{
    id: MenuId.CommandPalette,
    group: "navigation",
  }, {
    id: MenuId.ViewTitle,
    group: "navigation",
    order: 50,
    when: "view == workbench.extensions.detail",
  }])
}

function registerExtensionRollbackAction(service: ExtensionsWorkbenchService): Disposable {
  return registerActionClass(EXTENSIONS_WORKBENCH_COMMAND_IDS.Rollback, "回滚扩展", "扩展", async (...args) => {
    const [extensionId] = normalizeActionArgs(args)
    if (extensionId) await service.rollback(extensionId)
  }, [{
    id: MenuId.CommandPalette,
    group: "navigation",
  }])
}

function registerExtensionShowInstalledAction(service: ExtensionsWorkbenchService): Disposable {
  return registerActionClass(EXTENSIONS_WORKBENCH_COMMAND_IDS.ShowInstalled, "查看已安装扩展", "扩展", async () => {
    await service.showInstalled()
  }, [{
    id: MenuId.CommandPalette,
    group: "navigation",
  }, {
    id: MenuId.ViewTitle,
    group: "navigation",
    order: 10,
    when: "view == workbench.extensions.installed",
  }])
}

function registerExtensionManageAction(service: ExtensionsWorkbenchService): Disposable {
  return registerActionClass(EXTENSIONS_WORKBENCH_COMMAND_IDS.Manage, "管理扩展", "扩展", async (...args) => {
    const [extensionId, version] = normalizeActionArgs(args)
    if (extensionId) await service.open(extensionId, version)
  }, [{
    id: MenuId.CommandPalette,
    group: "navigation",
  }, {
    id: MenuId.ViewTitle,
    group: "navigation",
    order: 60,
    when: "view == workbench.extensions.detail",
  }])
}

function registerActionClass(
  id: string,
  title: string,
  category: string,
  run: (...args: unknown[]) => void | Promise<void>,
  menu: Array<{ id: MenuId; group?: "navigation" | string; order?: number; when?: string; precondition?: string | null }>,
): Disposable {
  const ctor = class extends Action2 {
    constructor() {
      super({
        id,
        title,
        category,
        source: "vscode",
        f1: true,
        menu: menu.filter((entry) => entry.id !== MenuId.CommandPalette),
        metadata: { description: title },
      })
    }

    override async run(_accessor: unknown, ...args: unknown[]): Promise<void> {
      await run(...args)
    }
  }
  return registerAction2(ctor)
}

function normalizeActionArgs(args: unknown[]): [string, string | undefined] {
  const first = Array.isArray(args[0]) ? args[0] : args
  const extensionId = typeof first[0] === "string" ? first[0] : ""
  const version = typeof first[1] === "string" ? first[1] : undefined
  return [extensionId, version]
}

function resolveInstallState(
  payload: ExtensionDetailsPayload,
  actionState?: ExtensionWorkbenchActionState,
): ExtensionWorkbenchInstallState {
  if (actionState?.status === "pending") return "pending"
  if (actionState?.status === "error") return "error"
  if (payload.installed?.version) {
    const availability = payload.installed.availability?.status || payload.installed.status || ""
    if (availability === "error") return "error"
    if (availability === "disabled") return "disabled"
    if (availability === "unsupported") return "unsupported"
    if (availability === "activated") return "activated"
    const latest = payload.latestVersion || payload.extension.version
    return latest && payload.installed.version !== latest ? "updateAvailable" : "installed"
  }
  if (payload.installPlan && payload.installPlan.readyToInstall === false) return "notInstallable"
  if (payload.compatibility?.status === "blocked") return "notInstallable"
  return "installable"
}

function statusForInstallState(
  state: ExtensionWorkbenchInstallState,
  payload: ExtensionDetailsPayload,
  actionState?: ExtensionWorkbenchActionState,
): { label: string; detail: string } {
  if (state === "pending") return { label: `正在${actionLabel(actionState?.action || "install")}`, detail: "等待扩展安装进度、安全审批和证据流返回" }
  if (state === "error") return { label: "操作失败", detail: actionState?.message || payload.installed?.availability?.detail || payload.installed?.statusDetail || payload.installState?.error || "扩展操作失败" }
  if (state === "activated") return { label: payload.installed?.availability?.label || "已激活", detail: payload.installed?.availability?.detail || "扩展宿主已激活该扩展" }
  if (state === "disabled") return { label: payload.installed?.availability?.label || "已禁用", detail: payload.installed?.availability?.detail || "扩展已安装但当前被禁用" }
  if (state === "unsupported") return { label: payload.installed?.availability?.label || "不支持", detail: payload.installed?.availability?.detail || payload.compatibility?.blockers?.[0]?.message || "该扩展使用 Codek 当前不支持的 VS Code 能力" }
  if (state === "installed") return { label: payload.installed?.availability?.label || "已启用", detail: payload.installed?.availability?.detail || "扩展已在本地扩展宿主可见" }
  if (state === "updateAvailable") return { label: "可更新", detail: "Marketplace 版本高于当前已安装版本" }
  if (state === "notInstallable") {
    const reason = payload.installPlan?.warnings?.[0]?.message || payload.compatibility?.blockers?.[0]?.message || "当前兼容性或安全策略不允许安装"
    return { label: "不可安装", detail: reason }
  }
  return { label: "可安装", detail: "安装将继续走现有 marketplace install-plan、confirmed trust gate 和进度证据路径" }
}

function buildActions(
  state: ExtensionWorkbenchInstallState,
  statusDetail: string,
  hasRollback: boolean,
  installedEnabled = true,
  actionState?: ExtensionWorkbenchActionState,
): ExtensionWorkbenchAction[] {
  if (state === "pending" && actionState) {
    return [{ id: actionState.action, label: actionLabel(actionState.action), enabled: false, pending: true, detail: statusDetail }]
  }
  if (state === "installed" || state === "activated" || state === "disabled" || state === "unsupported") {
    return [
      { id: "open", label: "打开详情", enabled: true },
      installedEnabled
        ? { id: "disable", label: "禁用", enabled: true, detail: "通过现有扩展宿主禁用路径执行" }
        : { id: "enable", label: "启用", enabled: true, detail: "通过现有扩展宿主启用路径执行" },
      { id: "uninstall", label: "卸载", enabled: true, detail: "通过现有扩展宿主卸载路径执行" },
      ...(hasRollback ? [{ id: "rollback" as const, label: "回滚", enabled: true, detail: "恢复最近一次安装备份" }] : []),
    ]
  }
  if (state === "updateAvailable") {
    return [
      { id: "update", label: "更新", enabled: true, detail: statusDetail },
      installedEnabled
        ? { id: "disable", label: "禁用", enabled: true }
        : { id: "enable", label: "启用", enabled: true },
      { id: "uninstall", label: "卸载", enabled: true },
    ]
  }
  return [
    { id: "install", label: "安装", enabled: state === "installable", detail: statusDetail },
    { id: "open", label: "打开详情", enabled: true },
  ]
}

function summarizeInstallPlan(payload: ExtensionDetailsPayload): string {
  const plan = payload.installPlan
  if (!plan) return "未生成安装计划"
  const parts = [
    plan.readyToInstall ? "安装计划就绪" : "安装计划未就绪",
    plan.requiresConfirmation ? "需要确认" : "",
    plan.missingDependencies.length ? `待安装依赖 ${plan.missingDependencies.length} 个` : "",
    plan.missingExtensionPack.length ? `待安装扩展包 ${plan.missingExtensionPack.length} 个` : "",
    plan.warnings.length ? `警告 ${plan.warnings.length} 条` : "",
  ].filter(Boolean)
  return parts.join("；")
}

function summarizeCompatibility(payload: ExtensionDetailsPayload): string {
  const compatibility = payload.compatibility
  if (!compatibility?.available) return "未生成兼容性报告"
  const statusMap: Record<string, string> = {
    native: "原生",
    compatible: "兼容",
    degraded: "降级",
    blocked: "阻断",
    unknown: "未知",
  }
  const parts = [
    statusMap[compatibility.status] || compatibility.status || "未知",
    compatibility.blockers.length ? `${compatibility.blockers.length} 个阻断` : "",
    compatibility.warnings.length ? `${compatibility.warnings.length} 个警告` : "",
    compatibility.unsupportedContributionPoints.length ? `${compatibility.unsupportedContributionPoints.length} 个不支持贡献点` : "",
    compatibility.partialContributionPoints.length ? `${compatibility.partialContributionPoints.length} 个部分支持贡献点` : "",
  ].filter(Boolean)
  return parts.join("；")
}

function summarizeMarkdown(value: string): string {
  return value.replace(/[#*_`>\[\]()]/g, "").replace(/\s+/g, " ").trim().slice(0, 900)
}

function actionLabel(action: ExtensionWorkbenchActionId): string {
  if (action === "uninstall") return "卸载"
  if (action === "enable") return "启用"
  if (action === "disable") return "禁用"
  if (action === "rollback") return "回滚"
  if (action === "open") return "打开"
  if (action === "update") return "更新"
  return "安装"
}

function commandIdForAction(action: ExtensionWorkbenchActionId | "manage"): string {
  if (action === "open") return EXTENSIONS_WORKBENCH_COMMAND_IDS.Open
  if (action === "install" || action === "update") return EXTENSIONS_WORKBENCH_COMMAND_IDS.Install
  if (action === "uninstall") return EXTENSIONS_WORKBENCH_COMMAND_IDS.Uninstall
  if (action === "enable") return EXTENSIONS_WORKBENCH_COMMAND_IDS.Enable
  if (action === "disable") return EXTENSIONS_WORKBENCH_COMMAND_IDS.Disable
  if (action === "rollback") return EXTENSIONS_WORKBENCH_COMMAND_IDS.Rollback
  return EXTENSIONS_WORKBENCH_COMMAND_IDS.Manage
}

function buildActionCommand(
  action: ExtensionWorkbenchActionId | "manage",
  enabled: boolean,
  detail: string,
): ExtensionWorkbenchActionCommand {
  return {
    source: "extensionsWorkbenchService",
    serviceId: String(IExtensionsWorkbenchService),
    stateSource: "extensionsWorkbenchService",
    actionId: action,
    commandId: commandIdForAction(action),
    owner: "extensionsWorkbenchService",
    vscodeOwner: "extensionsActions",
    route: "workbench.commandRegistry",
    enabled,
    label: action === "manage" ? "管理扩展" : actionLabel(action),
    detail,
    noSecondInstallState: true,
  }
}

function buildActionCommands(
  actions: ExtensionWorkbenchAction[],
  statusDetail: string,
): ExtensionWorkbenchActionCommand[] {
  return actions.map((action) => buildActionCommand(action.id, action.enabled, action.detail || statusDetail))
}

function buildExtensionHostLifecycleContract(
  latestStopEvidence: ExtensionHostLifecycleOperationEvidence | null = null,
  latestStartEvidence: ExtensionHostLifecycleOperationEvidence | null = null,
): ExtensionWorkbenchLifecycleContractProjection {
  const phase = resolveExtensionHostLifecyclePhase(latestStopEvidence, latestStartEvidence)
  const blockedReason = resolveExtensionHostLifecycleBlockedReason(latestStopEvidence, latestStartEvidence)
  const restartCompletedHere = didCompleteExtensionHostStopStartRestart(latestStopEvidence, latestStartEvidence)
  return {
    source: "extensionsWorkbenchService",
    serviceId: String(IExtensionsWorkbenchService),
    vscodeServiceId: "extensionService",
    stateSource: "extensionsWorkbenchService+ehClient",
    restartOwner: "desktopExtensionHostProcessOwner",
    restartContract: "workbench.action.restartExtensionHost->IExtensionService.stopExtensionHosts+startExtensionHosts",
    reloadOwner: "workbenchWindowReloadService",
    localContract: "IExtensionService.stopExtensionHosts+startExtensionHosts",
    remoteContract: "hostService.reload",
    status: phase === "blocked" ? "blocked" : restartCompletedHere ? "available" : "partial",
    phase,
    owner: "ExtensionHostWorkbenchService + desktop /extensions-host/lifecycle routes",
    reason: blockedReason || reasonForExtensionHostLifecyclePhase(phase),
    blockedBy: phase === "blocked" ? "desktopExtensionHostLifecycleOwner" : restartCompletedHere ? "none" : "workspaceTrustTransitionOwner",
    stopStartRoutesAvailable: true,
    restartRequiresWorkspaceTrustTransition: !restartCompletedHere,
    restartCompletedHere,
    latestStopEvidence,
    latestStartEvidence,
    hostWorkspaceEvidence: buildLifecycleWorkspaceEvidence(latestStartEvidence, latestStopEvidence),
    remoteReloadOwnerEvidence: buildRemoteReloadOwnerEvidence(),
  }
}

function buildHostLifecycleBindingEvidence(
  workspaceTrusted: boolean,
  disabledByTrustRequirementCount: number,
  lifecycle: ExtensionWorkbenchLifecycleContractProjection,
): ExtensionWorkbenchHostLifecycleBindingEvidence {
  const stopReason = lifecycle.latestStopEvidence?.reason || ""
  const startReason = lifecycle.latestStartEvidence?.reason || ""
  const stopEvidenceBound = lifecycle.latestStopEvidence?.stateSource === "desktop.extensionsHostService"
    && lifecycle.latestStopEvidence.action === "stopExtensionHosts"
    && stopReason === "Changing workspace trust"
  const startEvidenceBound = lifecycle.latestStartEvidence?.stateSource === "desktop.extensionsHostService"
    && lifecycle.latestStartEvidence.action === "startExtensionHosts"
    && startReason === "Changing workspace trust"
  const needsStopStartBinding = !workspaceTrusted && disabledByTrustRequirementCount > 0
  const stopStartBoundToTrustTransition = stopEvidenceBound
    && startEvidenceBound
    && lifecycle.restartCompletedHere
    && lifecycle.status === "available"
  const status = !needsStopStartBinding
    ? "notRequired"
    : stopStartBoundToTrustTransition
      ? "bound"
      : "blocked"
  return {
    source: "extensionsWorkbenchService",
    serviceId: String(IExtensionsWorkbenchService),
    stateSource: "extensionsWorkbenchService+workspaceTrust",
    vscodeSourcePaths: [
      "src/vs/workbench/services/extensionManagement/browser/extensionEnablementService.ts",
      "src/vs/workbench/services/extensions/common/abstractExtensionService.ts",
    ],
    currentSourcePaths: CODEK_EXTENSION_ENABLEMENT_SOURCE_PATHS,
    trigger: "workspaceTrustTransition",
    workspaceTrusted,
    status,
    reason: status === "bound"
      ? "WorkspaceTrust downgrade recomputed DisabledByTrustRequirement and the same transition is bound to desktop stopExtensionHosts/startExtensionHosts evidence."
      : status === "blocked"
        ? "WorkspaceTrust downgrade recomputed DisabledByTrustRequirement, but desktop stopExtensionHosts/startExtensionHosts evidence is not both bound to the same trust transition."
        : "No untrusted-workspace DisabledByTrustRequirement state needs a local extension-host stop/start binding for this recompute.",
    disabledByTrustRequirementCount,
    lifecyclePhase: lifecycle.phase,
    lifecycleStatus: lifecycle.status,
    stopStartBoundToTrustTransition,
    stopEvidenceBound,
    startEvidenceBound,
    stopReason,
    startReason,
    stopStateSource: lifecycle.latestStopEvidence?.stateSource === "desktop.extensionsHostService"
      ? "desktop.extensionsHostService"
      : "none",
    startStateSource: lifecycle.latestStartEvidence?.stateSource === "desktop.extensionsHostService"
      ? "desktop.extensionsHostService"
      : "none",
    noSecondEnablementState: true,
    runtimeReference: false,
  }
}

function didCompleteExtensionHostStopStartRestart(
  latestStopEvidence: ExtensionHostLifecycleOperationEvidence | null,
  latestStartEvidence: ExtensionHostLifecycleOperationEvidence | null,
): boolean {
  const stopped = latestStopEvidence?.stopped === true
  const started = latestStartEvidence?.started === true || latestStartEvidence?.alreadyRunning === true
  return stopped && started
}

function resolveExtensionHostLifecyclePhase(
  latestStopEvidence: ExtensionHostLifecycleOperationEvidence | null,
  latestStartEvidence: ExtensionHostLifecycleOperationEvidence | null,
): ExtensionWorkbenchLifecyclePhase {
  if (latestStopEvidence?.error || latestStartEvidence?.error || latestStopEvidence?.vetoed) return "blocked"
  if (latestStartEvidence?.started || latestStartEvidence?.alreadyRunning) return "completed"
  if (latestStartEvidence?.requested) return "startRequested"
  if (latestStopEvidence?.requested) return "stopRequested"
  return "notRequired"
}

function resolveExtensionHostLifecycleBlockedReason(
  latestStopEvidence: ExtensionHostLifecycleOperationEvidence | null,
  latestStartEvidence: ExtensionHostLifecycleOperationEvidence | null,
): string {
  if (latestStopEvidence?.vetoed) return `Extension host stop was vetoed: ${latestStopEvidence.vetoReason || "no veto reason was reported"}`
  if (latestStopEvidence?.error) return `Extension host stop failed: ${latestStopEvidence.error}`
  if (latestStartEvidence?.error) return `Extension host start failed: ${latestStartEvidence.error}`
  return ""
}

function reasonForExtensionHostLifecyclePhase(phase: ExtensionWorkbenchLifecyclePhase): string {
  if (phase === "completed") {
    return "Desktop extension-host stop/start routes reported both stop and start completion; this service records evidence only and does not claim it owns the restart."
  }
  if (phase === "stopRequested") {
    return "Desktop extension-host stop route was requested; start evidence has not completed, so restart remains partial."
  }
  if (phase === "startRequested") {
    return "Desktop extension-host stop completed and start was requested; start completion evidence is still pending."
  }
  return "Codek exposes stop/start lifecycle routes and WorkspaceTrust transition evidence, but this service only projects the contract and does not own or claim a completed host restart."
}

function buildLifecycleWorkspaceEvidence(
  latestStartEvidence: ExtensionHostLifecycleOperationEvidence | null,
  latestStopEvidence: ExtensionHostLifecycleOperationEvidence | null,
): ExtensionWorkbenchLifecycleWorkspaceEvidence {
  const lifecycleEvidence = resolveWorkspaceLocationLifecycleEvidence(latestStartEvidence, latestStopEvidence)
  const workspaceRoots = resolveLifecycleWorkspaceRoots(lifecycleEvidence)
  const workspaceFile = typeof lifecycleEvidence?.workspaceFile === "string" && lifecycleEvidence.workspaceFile.length > 0
    ? lifecycleEvidence.workspaceFile
    : null
  const hasWorkspaceOwnerEvidence = workspaceRoots.length > 0 || Boolean(workspaceFile)
  return {
    source: "desktop.extensionsHostService.lifecycleEvidence",
    status: hasWorkspaceOwnerEvidence ? "available" : "blocked",
    workspaceRoots,
    workspaceFile,
    reason: hasWorkspaceOwnerEvidence
      ? "desktop extension-host lifecycle evidence carries workspaceRoots/workspaceFile from the lifecycle owner"
      : "extension host lifecycle evidence has no workspaceRoots/workspaceFile owner data yet",
    runtimeReference: false,
    currentSourcePaths: CODEK_EXTENSION_ENABLEMENT_SOURCE_PATHS,
    vscodeSourcePaths: VS_CODE_EXTENSION_TRUST_SOURCE_PATHS,
    ...(hasWorkspaceOwnerEvidence
      ? {}
      : { blockedReason: "Workspace-location trust parity needs extension-host lifecycle evidence with workspaceRoots/workspaceFile before Codek can mirror contextService.isInsideWorkspace(extension.location)." }),
  }
}

function buildRemoteReloadOwnerEvidence(): ExtensionWorkbenchRemoteReloadOwnerEvidence {
  return {
    source: "WorkspaceTrustUXHandler.remoteAuthorityReload",
    status: "blocked",
    owner: "remoteAuthorityReloadOwner",
    blockedOwner: "workbenchWindowReloadService",
    blockedBoundary: "requiresWorkbenchWindowReloadOwner",
    vscodeContract: "IHostService.reload",
    vscodeSourcePaths: VS_CODE_WORKSPACE_TRUST_REMOTE_RELOAD_SOURCE_PATHS,
    currentSourcePaths: CODEK_WORKSPACE_TRUST_REMOTE_RELOAD_AUDIT_SOURCE_PATHS,
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
    blockedByCurrentOwnerBoundary: "AppWindowShellOrElectronMainReloadOwner",
    windowReloadSeparateFromExtensionHostRestart: true,
    reason: "VS Code workbench.action.restartExtensionHost restarts extension hosts through IExtensionService.stopExtensionHosts+startExtensionHosts, while remote-authority workbench reloads use IHostService.reload. Codek owns the former through desktop extension-host process restart evidence and keeps the latter blocked until an App/window shell or Electron main workbench-window reload owner exists.",
    runtimeReference: false,
  }
}

function buildWorkspaceLocationTrustEvidence(
  model: ExtensionWorkbenchEditorViewModel,
  latestLifecycleEvidence: ExtensionHostLifecycleOperationEvidence | null = null,
): ExtensionWorkbenchWorkspaceLocationTrustEvidence {
  const installPath = model.payload.installed?.installPath || ""
  const workspaceRoots = resolveLifecycleWorkspaceRoots(latestLifecycleEvidence)
  const canEvaluate = Boolean(installPath) && workspaceRoots.length > 0
  const isInsideWorkspace = canEvaluate ? isPathInsideAnyWorkspaceRoot(installPath, workspaceRoots) : null
  return {
    source: "contextService.isInsideWorkspace(extension.location)",
    status: canEvaluate ? "available" : "blocked",
    isInsideWorkspace,
    installPath,
    workspaceRoots,
    reason: canEvaluate
      ? "Desktop extension-host lifecycle evidence provides workspaceRoots, so Codek can mirror VS Code contextService.isInsideWorkspace(extension.location) for the installed extension path."
      : "VS Code also disables user extensions located inside the current workspace in restricted mode; Codek extension details do not yet carry workspace roots on the enablement payload.",
    runtimeReference: false,
    vscodeSourcePaths: VS_CODE_EXTENSION_TRUST_SOURCE_PATHS,
    currentSourcePaths: CODEK_EXTENSION_ENABLEMENT_SOURCE_PATHS,
    ...(canEvaluate
      ? {}
      : { blockedReason: "Enablement recompute has installPath but no workspace roots or contextService owner, so it cannot safely decide contextService.isInsideWorkspace(extension.location)." }),
  }
}

function resolveLifecycleWorkspaceRoots(
  latestLifecycleEvidence: ExtensionHostLifecycleOperationEvidence | null,
): string[] {
  const workspaceRoots = Array.isArray(latestLifecycleEvidence?.workspaceRoots)
    ? latestLifecycleEvidence.workspaceRoots.filter((root): root is string => typeof root === "string" && root.trim().length > 0)
    : []
  const rootDir = typeof latestLifecycleEvidence?.rootDir === "string" && latestLifecycleEvidence.rootDir.trim().length > 0
    ? latestLifecycleEvidence.rootDir
    : ""
  return workspaceRoots.length > 0 ? workspaceRoots : (rootDir ? [rootDir] : [])
}

function resolveWorkspaceLocationLifecycleEvidence(
  latestStartEvidence: ExtensionHostLifecycleOperationEvidence | null,
  latestStopEvidence: ExtensionHostLifecycleOperationEvidence | null,
): ExtensionHostLifecycleOperationEvidence | null {
  if (resolveLifecycleWorkspaceRoots(latestStartEvidence).length > 0) return latestStartEvidence
  if (resolveLifecycleWorkspaceRoots(latestStopEvidence).length > 0) return latestStopEvidence
  return latestStartEvidence || latestStopEvidence
}

function isPathInsideAnyWorkspaceRoot(filePath: string, workspaceRoots: readonly string[]): boolean {
  const candidate = normalizeComparablePath(filePath)
  if (!candidate) return false
  return workspaceRoots.some((root) => {
    const normalizedRoot = normalizeComparablePath(root)
    return Boolean(normalizedRoot) && (candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}/`))
  })
}

function normalizeComparablePath(value: string): string {
  return String(value || "")
    .replace(/^file:\/+/, "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase()
}

function applyDependencyEnablementProjections(
  models: readonly ExtensionWorkbenchEditorViewModel[],
  baseStates: readonly ExtensionWorkbenchEnablementProjection[],
): ExtensionWorkbenchEnablementProjection[] {
  let states = baseStates.map((state) => ({ ...state }))
  for (let pass = 0; pass < models.length; pass += 1) {
    let changed = false
    const stateById = new Map(states.map((state) => [normalizeExtensionId(state.extensionId), state]))
    states = states.map((state, index) => {
      const dependencyEvidence = buildDependencyEnablementEvidence(models[index], stateById)
      const nextState = dependencyEvidence.disabledDependencyIds.length > 0 && isEnabledWorkbenchEnablementState(state.state)
        ? buildDependencyDisabledProjection(state, dependencyEvidence)
        : { ...state, dependencyEvidence }
      changed = changed || nextState.state !== state.state || dependencyEvidence.disabledDependencyIds.join("\0") !== (state.dependencyEvidence?.disabledDependencyIds || []).join("\0")
      return nextState
    })
    if (!changed) break
  }
  return states
}

function buildDependencyDisabledProjection(
  state: ExtensionWorkbenchEnablementProjection,
  dependencyEvidence: ExtensionWorkbenchDependencyEnablementEvidence,
): ExtensionWorkbenchEnablementProjection {
  return {
    ...state,
    state: "DisabledByExtensionDependency",
    disabledByTrustRequirement: false,
    reason: "extensionDependency",
    reasonDetail: dependencyEvidence.detail,
    stateSource: "extensionsWorkbenchService+workspaceTrust",
    evidence: buildEnablementReasonEvidence({
      source: "extensionDependencies",
      status: "available",
      reason: "extensionDependency",
      detail: dependencyEvidence.detail,
    }),
    dependencyEvidence,
  }
}

function buildDependencyEnablementEvidence(
  model: ExtensionWorkbenchEditorViewModel,
  stateById: ReadonlyMap<string, ExtensionWorkbenchEnablementProjection> = new Map(),
): ExtensionWorkbenchDependencyEnablementEvidence {
  const dependencyIds = normalizeExtensionDependencies(model.payload.extension.extensionDependencies)
  const disabledDependencyStates = dependencyIds
    .map((id) => stateById.get(normalizeExtensionId(id)))
    .filter((dependency): dependency is ExtensionWorkbenchEnablementProjection =>
      Boolean(dependency)
      && !isEnabledWorkbenchEnablementState(dependency.state)
      && dependency.state !== "DisabledByExtensionKind",
    )
    .map((dependency) => ({
      extensionId: dependency.extensionId,
      state: dependency.state,
      reason: dependency.reason,
    }))
  return {
    source: "extensionDependencies",
    status: dependencyIds.length > 0 ? "available" : "notRequired",
    dependencyIds,
    disabledDependencyIds: disabledDependencyStates.map((dependency) => dependency.extensionId),
    disabledDependencyStates,
    reason: disabledDependencyStates.length > 0 ? "extensionDependency" : "workspaceUser",
    detail: disabledDependencyStates.length > 0
      ? `VS Code _isDisabledByExtensionDependency parity: disabled dependencies ${disabledDependencyStates.map((dependency) => `${dependency.extensionId}:${dependency.state}`).join(", ")} block this extension.`
      : dependencyIds.length > 0
        ? "VS Code _isDisabledByExtensionDependency parity: dependencies are enabled or only DisabledByExtensionKind, so they do not block this extension."
        : "Extension manifest does not declare extensionDependencies.",
    runtimeReference: false,
    vscodeSourcePaths: VS_CODE_EXTENSION_TRUST_SOURCE_PATHS,
    currentSourcePaths: CODEK_EXTENSION_ENABLEMENT_SOURCE_PATHS,
  }
}

function normalizeExtensionDependencies(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))]
    : []
}

function isEnabledWorkbenchEnablementState(state: ExtensionWorkbenchEnablementState): boolean {
  return state === "EnabledByEnvironment" || state === "EnabledGlobally" || state === "EnabledWorkspace"
}

function normalizeExtensionId(value: string): string {
  return String(value || "").trim().toLowerCase()
}

function resolveWorkspaceTrustRequirement(model: ExtensionWorkbenchEditorViewModel): {
  requiresWorkspaceTrust: boolean
  untrustedWorkspaceSupport: boolean | "limited" | "unknown"
  source: ExtensionWorkbenchEnablementProjection["trustRequirementSource"]
  reasonDetail: string
} {
  const supported = model.payload.extension.capabilities?.untrustedWorkspaces?.supported
  if (supported !== undefined) {
    return {
      requiresWorkspaceTrust: supported === false,
      untrustedWorkspaceSupport: supported,
      source: "manifest.capabilities.untrustedWorkspaces.supported",
      reasonDetail: supported === false
        ? "manifest capabilities.untrustedWorkspaces.supported=false requires a trusted workspace"
        : `manifest capabilities.untrustedWorkspaces.supported=${String(supported)} permits restricted workspace enablement`,
    }
  }

  if (model.detailSummary.trustGate.required) {
    return {
      requiresWorkspaceTrust: true,
      untrustedWorkspaceSupport: "unknown",
      source: "installPlan.requiresConfirmation",
      reasonDetail: "manifest untrusted workspace capability is missing; Codek falls back to the existing install-plan trust confirmation evidence",
    }
  }

  return {
    requiresWorkspaceTrust: false,
    untrustedWorkspaceSupport: "unknown",
    source: "missingManifestCapability",
    reasonDetail: "manifest untrusted workspace capability is missing and no install-plan trust confirmation requires workspace trust",
  }
}

function resolveProductConfigurationOverride(model: ExtensionWorkbenchEditorViewModel): null | {
  state: ExtensionWorkbenchEnablementState
  reason: ExtensionWorkbenchEnablementReason
  evidence: ExtensionWorkbenchEnablementReasonEvidence
} {
  const explicitEnablement = firstEnablementMetadata(model.payload.extension.enablement, model.payload.installed?.enablement)
  if (isExplicitExtensionKindDisablement(explicitEnablement)) {
    return {
      state: "DisabledByExtensionKind",
      reason: "extensionKind",
      evidence: buildEnablementReasonEvidence({
        source: "extensionKind",
        status: "available",
        reason: "extensionKind",
        detail: explicitEnablement?.detail || "Extension host enablement metadata reports DisabledByExtensionKind for this extension.",
      }),
    }
  }

  const productDisablement = firstDisablementOverride(
    model.payload.extension.productDisablement,
    model.payload.extension.enablement?.productDisablement,
    model.payload.installed?.productDisablement,
    model.payload.installed?.enablement?.productDisablement,
  )
  if (productDisablement?.disabled === true) {
    return {
      state: "DisabledByEnvironment",
      reason: "product",
      evidence: buildEnablementReasonEvidence({
        source: "productService.disableExtensions",
        status: "available",
        reason: "product",
        detail: productDisablement.detail || productDisablement.reason || "Product or environment policy disables this extension before workspace trust is evaluated.",
        configKey: productDisablement.configKey,
        scope: productDisablement.scope,
      }),
    }
  }

  const configurationDisablement = firstDisablementOverride(
    model.payload.extension.configurationDisablement,
    model.payload.extension.enablement?.configurationDisablement,
    model.payload.installed?.configurationDisablement,
    model.payload.installed?.enablement?.configurationDisablement,
  )
  if (configurationDisablement?.disabled === true) {
    const source = resolveConfigurationDisablementSource(configurationDisablement)
    const state: ExtensionWorkbenchEnablementState = source === "globalExtensionEnablementService.disabledExtensions"
      ? "DisabledGlobally"
      : "DisabledByAllowlist"
    const reason: ExtensionWorkbenchEnablementReason = source === "globalExtensionEnablementService.disabledExtensions"
      ? "globalUser"
      : "configuration"
    return {
      state,
      reason,
      evidence: buildEnablementReasonEvidence({
        source,
        status: "available",
        reason,
        detail: configurationDisablement.detail || configurationDisablement.reason || reasonForConfigurationDisablementSource(source),
        configKey: configurationDisablement.configKey,
        scope: configurationDisablement.scope,
      }),
    }
  }

  return null
}

function firstDisablementOverride(...items: Array<ExtensionDisablementOverride | null | undefined>): ExtensionDisablementOverride | null {
  return items.find((item) => item && typeof item === "object") || null
}

type ExtensionWorkbenchEnablementMetadata = NonNullable<ExtensionDetailsPayload["extension"]["enablement"]>

function firstEnablementMetadata(...items: Array<ExtensionWorkbenchEnablementMetadata | null | undefined>): ExtensionWorkbenchEnablementMetadata | null {
  return items.find((item): item is ExtensionWorkbenchEnablementMetadata => Boolean(item) && typeof item === "object") || null
}

function isExplicitExtensionKindDisablement(item: ExtensionWorkbenchEnablementMetadata | null): boolean {
  if (!item) return false
  const value = `${item.state || ""} ${item.reason || ""} ${item.source || ""}`.toLowerCase()
  return value.includes("disabledbyextensionkind") || value.includes("extensionkind") || value.includes("extension kind")
}

function resolveConfigurationDisablementSource(
  override: ExtensionDisablementOverride,
): Extract<ExtensionWorkbenchEnablementReasonSource, "configurationService.extensions.allowed" | "globalExtensionEnablementService.disabledExtensions"> {
  const value = `${override.source || ""} ${override.reason || ""} ${override.configKey || ""}`.toLowerCase()
  if (value.includes("disabledextensions") || value.includes("disabled extensions") || value.includes("globalextensionenablement")) {
    return "globalExtensionEnablementService.disabledExtensions"
  }
  return "configurationService.extensions.allowed"
}

function reasonForConfigurationDisablementSource(source: ExtensionWorkbenchEnablementReasonEvidence["source"]): string {
  if (source === "globalExtensionEnablementService.disabledExtensions") {
    return "VS Code global extension enablement storage lists this extension in disabledExtensions."
  }
  return "VS Code allowed extensions configuration blocks this extension."
}

function buildEnablementReasonEvidence(input: {
  source: ExtensionWorkbenchEnablementReasonSource
  status: ExtensionWorkbenchEnablementReasonEvidenceStatus
  reason: ExtensionWorkbenchEnablementReason
  detail: string
  blockedReason?: string
  configKey?: string
  scope?: string
}): ExtensionWorkbenchEnablementReasonEvidence {
  return {
    source: input.source,
    status: input.status,
    reason: input.reason,
    detail: input.detail,
    runtimeReference: false,
    vscodeSourcePaths: VS_CODE_EXTENSION_TRUST_SOURCE_PATHS,
    currentSourcePaths: CODEK_EXTENSION_ENABLEMENT_SOURCE_PATHS,
    ...(input.blockedReason ? { blockedReason: input.blockedReason } : {}),
    ...(input.configKey ? { configKey: input.configKey } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
  }
}

export function getExtensionWorkbenchEvidenceSummary(service: ExtensionsWorkbenchService, extensionId: string) {
  const model = service.getEditorViewModel(extensionId)
  const actionState = service.getActionState(extensionId)
  const progress = service.getInstallProgress(extensionId)
  const detailSummary = model?.detailSummary
  const fallbackManageActionOwner = buildActionCommand("manage", Boolean(model), "打开扩展详情，并从统一扩展服务派生管理动作")
  return {
    source: "extensionsWorkbenchService",
    serviceId: String(IExtensionsWorkbenchService),
    extensionId,
    installState: actionState?.status === "error"
      ? "error"
      : actionState?.status === "pending"
        ? "pending"
        : model?.installState,
    actionState,
    progress,
    evidence: {
      installPlanReady: Boolean(detailSummary?.installPlanReady),
      requiresConfirmation: Boolean(detailSummary?.requiresConfirmation),
      warnings: model?.evidence.warnings || [],
      auditCount: model?.evidence.audit.length || 0,
    },
    rollbackRisk: detailSummary?.rollbackRisk || {
      available: false,
      lastBackup: "",
      detail: "该扩展暂无可回滚备份",
    },
    actionCommands: detailSummary?.actionCommands || [],
    manageActionOwner: detailSummary?.manageActionOwner || fallbackManageActionOwner,
    manageSecondaryActions: detailSummary?.manageSecondaryActions || [],
    constraints: {
      localFirst: true,
      goesThroughEhClient: true,
      noSecondInstallState: true,
    },
  }
}

export function getExtensionWorkbenchDetailSummary(
  service: ExtensionsWorkbenchService,
  extensionId: string,
): ExtensionWorkbenchDetailSummary | undefined {
  return service.getDetailSummary(extensionId)
}

export function getExtensionWorkbenchSurfaceSnapshot(
  service: ExtensionsWorkbenchService = extensionWorkbenchService,
): ExtensionWorkbenchSurfaceSnapshot {
  return service.getSurfaceSnapshot()
}

export async function executeExtensionWorkbenchCommand(id: string, ...args: unknown[]): Promise<boolean> {
  return executeCommand(id, args)
}

function buildDetailSummary(
  payload: ExtensionDetailsPayload,
  installState: ExtensionWorkbenchInstallState,
  statusLabel: string,
  statusDetail: string,
  actionState?: ExtensionWorkbenchActionState,
): ExtensionWorkbenchDetailSummary {
  const lastBackup = payload.installState?.lastBackup || ""
  const installPlanWarnings = [
    ...(payload.installPlan?.warnings || []).map((warning) => warning.message),
    ...(payload.compatibility?.warnings || []).map((warning) => warning.message),
    ...(payload.compatibility?.blockers || []).map((blocker) => blocker.message),
  ].filter(Boolean)
  const actionModels = buildActions(installState, statusDetail, Boolean(lastBackup), payload.installed?.enabled !== false, actionState)
  const actionCommands = buildActionCommands(actionModels, statusDetail)
  const manageSecondaryActions = actionCommands.filter((action) => action.actionId !== "open")
  return {
    source: "extensionsWorkbenchService",
    serviceId: String(IExtensionsWorkbenchService),
    extensionId: payload.id,
    label: statusLabel,
    detail: statusDetail,
    installState,
    installPlanReady: Boolean(payload.installPlan?.readyToInstall),
    requiresConfirmation: Boolean(payload.installPlan?.requiresConfirmation),
    trustGate: {
      required: Boolean(payload.installPlan?.requiresConfirmation),
      detail: payload.installPlan?.warnings?.[0]?.message || "安装将继续经过信任确认和进度证据路径",
      warnings: installPlanWarnings,
    },
    availability: {
      status: actionState?.status === "pending"
        ? "installing"
        : payload.installed?.availability?.status
          || payload.installed?.status
          || installState,
      label: actionState?.status === "pending"
        ? actionLabel(actionState.action)
        : payload.installed?.availability?.label
          || payload.installed?.statusLabel
          || statusLabel,
      detail: actionState?.message
        || payload.installed?.availability?.detail
        || payload.installed?.statusDetail
        || payload.installState?.error
        || "扩展详情已由统一 service 计算",
      reason: actionState?.status === "pending"
        ? "extension-workbench-action"
        : payload.installed?.availability?.reason
          || payload.installed?.statusReason
          || "extensionsWorkbenchService",
    },
    usabilityRows: buildUsabilityRows(payload, installState),
    rollbackRisk: {
      available: Boolean(lastBackup),
      lastBackup,
      detail: lastBackup ? `可回滚到最近备份：${lastBackup}` : "该扩展暂无可回滚备份",
    },
    actionIds: actionModels.map((action) => action.id),
    actionCommands,
    manageActionOwner: buildActionCommand("manage", true, "打开扩展详情，并从统一扩展服务派生管理动作"),
    manageSecondaryActions,
    noSecondInstallState: true,
    localFirst: true,
    goesThroughEhClient: true,
  }
}

function buildContributionSummary(): ExtensionWorkbenchContributionSummary {
  return {
    source: "extensionsWorkbenchService",
    serviceId: String(IExtensionsWorkbenchService),
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
  }
}

function buildUsabilityRows(
  payload: ExtensionDetailsPayload,
  installState: ExtensionWorkbenchInstallState,
): ExtensionWorkbenchUsabilityRow[] {
  const contributes = isPlainRecord(payload.extension?.contributes)
    ? payload.extension.contributes
    : {}
  const installed = Boolean(payload.installed)
  const enabled = payload.installed?.enabled !== false
  const activated = payload.installed?.availability?.status === "activated" || installState === "activated"
  const pending = installState === "pending"
  const unsupportedPoints = new Set(payload.compatibility?.unsupportedContributionPoints || [])
  const partialPoints = new Set(payload.compatibility?.partialContributionPoints || [])

  return [
    contributionUsabilityRow({
      id: "commands",
      label: "命令",
      declared: hasContribution(contributes, "commands"),
      unsupported: unsupportedPoints.has("commands"),
      partial: partialPoints.has("commands"),
      installed,
      enabled,
      activated,
      pending,
      readyDetail: "扩展声明的命令会进入 Codek 命令面板和扩展工作台动作。",
      pendingDetail: "命令已在 manifest 中声明，安装并启用后由扩展宿主投影到命令面板。",
      notDeclaredDetail: "该扩展没有声明命令贡献点。",
    }),
    contributionUsabilityRow({
      id: "configuration",
      label: "配置",
      declared: hasContribution(contributes, "configuration") || hasContribution(contributes, "configurationDefaults"),
      unsupported: unsupportedPoints.has("configuration"),
      partial: partialPoints.has("configuration"),
      installed,
      enabled,
      activated,
      pending,
      readyDetail: "配置贡献会进入 Codek 设置和设置 JSON 路径。",
      pendingDetail: "配置贡献已识别，安装并启用后可在设置路径查看。",
      notDeclaredDetail: "该扩展没有声明配置贡献点。",
    }),
    contributionUsabilityRow({
      id: "storage",
      label: "扩展存储",
      declared: Boolean(payload.extension?.id),
      unsupported: unsupportedPoints.has("storage"),
      partial: partialPoints.has("storage"),
      installed,
      enabled,
      activated,
      pending,
      readyDetail: "扩展安装目录和本地状态由 Codek 扩展服务统一维护。",
      pendingDetail: "安装完成后会建立本地安装记录、审计记录和可回滚状态。",
      notDeclaredDetail: "扩展存储不依赖 manifest 声明，安装后由 Codek 管理。",
    }),
    contributionUsabilityRow({
      id: "views",
      label: "Tree/View 视图",
      declared: hasContribution(contributes, "views") || hasContribution(contributes, "viewsContainers"),
      unsupported: unsupportedPoints.has("views"),
      partial: partialPoints.has("views"),
      installed,
      enabled,
      activated,
      pending,
      readyDetail: "已声明的 Tree/View 会进入 Codek 当前支持的扩展视图投影。",
      pendingDetail: "视图贡献已识别，安装启用后会按当前 Codek 能力投影。",
      partialDetail: "该扩展声明了视图贡献，但当前 Codek 只支持其中一部分视图能力。",
      notDeclaredDetail: "该扩展没有声明 Tree/View 视图贡献点。",
    }),
    contributionUsabilityRow({
      id: "unsupported",
      label: "Debug/Notebook/Webview",
      declared: hasContribution(contributes, "debuggers")
        || hasContribution(contributes, "notebooks")
        || hasContribution(contributes, "webviews"),
      unsupported: true,
      partial: false,
      installed,
      enabled,
      activated,
      pending,
      readyDetail: "Debug、Notebook 和 Webview 贡献点当前暂不进入 Codek 扩展可用闭环。",
      pendingDetail: "Debug、Notebook 和 Webview 贡献点当前暂不支持；安装后也不会伪装为可用。",
      notDeclaredDetail: "未声明当前暂不支持的深层 VS Code 贡献点。",
    }),
  ]
}

function contributionUsabilityRow(options: {
  id: string
  label: string
  declared: boolean
  unsupported: boolean
  partial: boolean
  installed: boolean
  enabled: boolean
  activated: boolean
  pending: boolean
  readyDetail: string
  pendingDetail: string
  notDeclaredDetail: string
  partialDetail?: string
}): ExtensionWorkbenchUsabilityRow {
  if (!options.declared) {
    return {
      id: options.id,
      label: options.label,
      status: "notDeclared",
      statusLabel: "未声明",
      detail: options.notDeclaredDetail,
    }
  }
  if (options.unsupported) {
    return {
      id: options.id,
      label: options.label,
      status: "unsupported",
      statusLabel: "暂不支持",
      detail: options.readyDetail,
    }
  }
  if (options.pending || !options.installed || !options.enabled) {
    return {
      id: options.id,
      label: options.label,
      status: "pending",
      statusLabel: options.enabled ? "待安装后验证" : "待启用后验证",
      detail: options.pendingDetail,
    }
  }
  return {
    id: options.id,
    label: options.label,
    status: options.partial || !options.activated ? "pending" : "ready",
    statusLabel: options.partial || !options.activated ? "部分接入" : "已接入",
    detail: options.partial
      ? options.partialDetail || "该贡献点当前只接入部分 Codek 能力。"
      : options.activated
        ? options.readyDetail
        : "扩展已安装并启用，等待扩展宿主激活证据返回。",
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasContribution(contributes: Record<string, unknown>, key: string): boolean {
  const value = contributes[key]
  if (Array.isArray(value)) return value.length > 0
  if (isPlainRecord(value)) return Object.keys(value).length > 0
  return Boolean(value)
}
