// Extension Host marketplace + install API wrapper.
// All requests go through window.codek.api → /extensions-host/* routes.

import { api } from "../lib/api"

export interface VsixMetadata {
  id: string
  displayName: string
  description: string
  version: string
  publisher: string
  downloads: number
  rating?: number
  icon?: string
  iconUrl?: string
  iconCacheUrl?: string
  iconUrlFallback?: string
  iconDataUrl?: string
  iconSource?: "gallery" | "manifest" | "default" | string
  defaultIcon?: boolean
  categories: string[]
  installed?: boolean
  enabled?: boolean
  builtin?: boolean
  status?: string
  statusLabel?: string
  statusDetail?: string
  statusReason?: string
  availability?: ExtensionAvailability
  capabilities?: ExtensionManifestCapabilities
  enablement?: ExtensionEnablementMetadata | null
  productDisablement?: ExtensionDisablementOverride | null
  configurationDisablement?: ExtensionDisablementOverride | null
}

export interface ExtensionAvailability {
  status: "activated" | "enabled" | "disabled" | "error" | "unsupported" | "installing" | string
  label: string
  detail: string
  reason: string
}

export interface ExtensionDisablementOverride {
  disabled?: boolean
  source?: string
  reason?: string
  detail?: string
  configKey?: string
  scope?: "global" | "workspace" | "profile" | "environment" | string
  runtimeReference?: boolean
}

export interface ExtensionEnablementMetadata {
  state?: string
  reason?: string
  source?: string
  detail?: string
  productDisablement?: ExtensionDisablementOverride | null
  configurationDisablement?: ExtensionDisablementOverride | null
}

export interface ExtensionDetails extends VsixMetadata {
  source?: string
  sourceUrl?: string
  repository?: string
  license?: string
  verified?: boolean
  deprecated?: boolean
  extensionDependencies?: string[]
  extensionPack?: string[]
  enabledApiProposals?: string[]
  engines?: { vscode?: string }
  extensionKind?: string[]
  contributes?: Record<string, unknown>
  readmeUrl?: string
  downloadUrl?: string
  enablement?: ExtensionEnablementMetadata | null
  productDisablement?: ExtensionDisablementOverride | null
  configurationDisablement?: ExtensionDisablementOverride | null
}

export interface ExtensionManifestCapabilities {
  untrustedWorkspaces?: {
    supported?: boolean | "limited"
    description?: string
    restrictedConfigurations?: string[]
  }
  virtualWorkspaces?: boolean | "limited" | {
    supported?: boolean | "limited"
    description?: string
  }
  [key: string]: unknown
}

export interface ExtensionReadme {
  id: string
  source?: string
  readme: string
  available: boolean
  readmeUrl?: string
  error?: string
}

export interface ExtensionVersion {
  version: string
  date?: string
  targetPlatforms?: string[]
  url?: string
}

export interface ExtensionVersions {
  id: string
  source?: string
  versions: ExtensionVersion[]
  error?: string
}

export interface ExtensionInstallOperation {
  kind: "dependency" | "extension-pack" | "target"
  id: string
  status: "already-installed" | "pending"
  version?: string
}

export interface ExtensionInstallPlan {
  reportKind: "extension-install-plan"
  id: string
  readyToInstall: boolean
  requiresConfirmation: boolean
  dependencies: string[]
  extensionPack: string[]
  missingDependencies: string[]
  missingExtensionPack: string[]
  operations: ExtensionInstallOperation[]
  warnings: Array<{ id: string; severity: string; message: string; values?: string[]; value?: string }>
}

export interface ExtensionCompatibilityReport {
  reportKind: "extension-compatibility-report"
  ready: boolean
  status: "ready" | "degraded" | "blocked"
  summary: {
    total: number
    native: number
    compatible: number
    degraded: number
    blocked: number
  }
  extensions: Array<{
    id: string
    displayName: string
    status: "native" | "compatible" | "degraded" | "blocked"
    supportedContributionPoints: string[]
    partialContributionPoints: string[]
    unsupportedContributionPoints: string[]
    blockers: Array<{ id: string; message: string }>
    warnings: Array<{ id: string; message: string; values?: string[] }>
  }>
}

export interface ExtensionInstallState {
  id: string
  status?: string
  version?: string
  previousVersion?: string
  installedAt?: number | string
  updatedAt?: number | string
  installSource?: string
  installPath?: string
  lastBackup?: string
  error?: string
}

export interface InstallExtensionOptions {
  confirmed?: boolean
}

export interface ExtensionAuditEntry {
  id?: string
  extensionId: string
  action: string
  status: string
  version?: string
  source?: string
  message?: string
  error?: string
  createdAt?: number
  timestamp?: number
}

export interface ExtensionHostActivationEvidence {
  serviceId: string
  stateSource: "extensionsWorkbenchService+ehClient"
  activationEvent: string
  extensionId: string
  status: "activated" | "error"
  createdAt: number
  error?: string
}

export interface ExtensionHostActivationResult {
  success: boolean
  error?: string
  message?: string
  evidence?: ExtensionHostActivationEvidence
}

export interface ExtensionHostLifecycleOperationEvidence {
  serviceId: string
  stateSource: "desktop.extensionsHostService"
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
}

export interface ExtensionHostLifecycleRestartEvidence {
  serviceId: string
  stateSource: "desktop.extensionsHostService"
  vscodeContract: "IExtensionService.stopExtensionHosts+startExtensionHosts"
  action: "restartExtensionHosts"
  reason: string
  auto?: boolean
  requested: boolean
  restartRequested: boolean
  restarted: boolean
  reloadRequested: false
  reloaded: false
  rootDir?: string
  workspaceRoots?: string[]
  workspaceFile?: string | null
  createdAt: number
  stopEvidence?: ExtensionHostLifecycleOperationEvidence | null
  startEvidence?: ExtensionHostLifecycleOperationEvidence | null
  blockedBy?: "none" | "stopExtensionHosts" | "startExtensionHosts" | "onWillStopVeto"
  vetoed?: boolean
  vetoReason?: string
  error?: string
}

export interface ExtensionHostLifecycleOperationResult {
  success: boolean
  error?: string
  evidence?: ExtensionHostLifecycleOperationEvidence
}

export interface ExtensionHostLifecycleRestartResult {
  success: boolean
  message?: string
  error?: string
  evidence?: ExtensionHostLifecycleRestartEvidence
}

export interface ExtensionHostLifecycleOperationOptions {
  rootDir?: string
  workspaceRoots?: string[]
  workspaceFile?: string | null
}

export interface ExtensionDetailsPayload {
  reportKind: "extension-details"
  createdAt: number
  ready: boolean
  id: string
  extension: ExtensionDetails
  installed: null | {
    id: string
    version: string
    enabled: boolean
    installPath: string
    builtin: boolean
    status?: string
    statusLabel?: string
    statusDetail?: string
    statusReason?: string
    availability?: ExtensionAvailability | null
    enablement?: ExtensionEnablementMetadata | null
    productDisablement?: ExtensionDisablementOverride | null
    configurationDisablement?: ExtensionDisablementOverride | null
    iconUrl?: string
    iconCacheUrl?: string
    iconUrlFallback?: string
    iconDataUrl?: string
    iconSource?: string
    defaultIcon?: boolean
  }
  readme: {
    id: string
    available: boolean
    readmeUrl?: string
    length: number
    text: string
    error?: string
  }
  versions: ExtensionVersion[]
  latestVersion: string
  installPlan: ExtensionInstallPlan | null
  compatibility: {
    available: boolean
    status: "native" | "compatible" | "degraded" | "blocked" | "unknown"
    blockers: Array<{ id?: string; message: string }>
    warnings: Array<{ id?: string; message: string; values?: string[] }>
    unsupportedContributionPoints: string[]
    partialContributionPoints: string[]
  }
  installState: ExtensionInstallState | null
  audit: ExtensionAuditEntry[]
}

export interface SearchOptions {
  category?: string
  pageSize?: number
}

export interface MigratedExtensionQueueItem {
  id: string
  status: "pending" | "installed" | "failed"
  error?: string
  updatedAt?: string
}

export interface MigratedExtensionQueue {
  path: string
  exists: boolean
  source: string
  importedAt: string
  installPolicy: string
  reason: string
  total: number
  pending: number
  installed: number
  failed: number
  extensions: MigratedExtensionQueueItem[]
}

interface OpenVsxSearchEntry {
  id?: string
  publisher?: string
  namespace?: string
  name?: string
  displayName?: string
  description?: string
  version?: string
  installCount?: number
  downloadCount?: number
  averageRating?: number
  iconUrl?: string
  iconCacheUrl?: string
  files?: { icon?: string }
  categories?: string[]
}

function normalizeSearchEntry(e: OpenVsxSearchEntry): VsixMetadata {
  const publisher = e.namespace || e.publisher || ""
  const name = e.name || ""
  return {
    id: e.id || (publisher && name ? `${publisher}.${name}` : name || publisher),
    displayName: e.displayName || name,
    description: e.description || "",
    version: e.version || "",
    publisher,
    downloads: e.downloadCount || e.installCount || 0,
    rating: e.averageRating,
    iconUrl: e.iconUrl || e.files?.icon,
    iconCacheUrl: e.iconCacheUrl,
    iconUrlFallback: (e as any).iconUrlFallback,
    iconDataUrl: (e as any).iconDataUrl,
    iconSource: (e as any).iconSource,
    defaultIcon: (e as any).defaultIcon,
    categories: e.categories || [],
  }
}

function normalizeInstalled(e: any): VsixMetadata {
  return {
    id: e.id || `${e.publisher || ""}.${e.name || ""}`,
    displayName: e.displayName || e.name || "",
    description: e.description || "",
    version: e.version || "",
    publisher: e.publisher || "",
    downloads: 0,
    icon: e.icon,
    iconUrl: e.iconUrl,
    iconCacheUrl: e.iconCacheUrl,
    iconUrlFallback: e.iconUrlFallback,
    iconDataUrl: e.iconDataUrl,
    iconSource: e.iconSource,
    defaultIcon: e.defaultIcon,
    categories: e.categories || [],
    installed: true,
    enabled: e.enabled !== false,
    builtin: !!e.builtin,
    status: e.status,
    statusLabel: e.statusLabel,
    statusDetail: e.statusDetail,
    statusReason: e.statusReason,
    availability: e.availability,
    enablement: e.enablement,
    productDisablement: e.productDisablement,
    configurationDisablement: e.configurationDisablement,
    capabilities: e.capabilities,
  }
}

function splitExtensionId(id: string): { namespace: string; name: string } {
  const dot = id.indexOf(".")
  if (dot <= 0) return { namespace: "", name: id }
  return { namespace: id.slice(0, dot), name: id.slice(dot + 1) }
}

function normalizeDetails(e: any): ExtensionDetails {
  const base = normalizeSearchEntry(e || {})
  return {
    ...base,
    source: e?.source,
    sourceUrl: e?.sourceUrl,
    repository: e?.repository,
    license: e?.license,
    verified: e?.verified,
    deprecated: e?.deprecated,
    extensionDependencies: e?.extensionDependencies || [],
    extensionPack: e?.extensionPack || [],
    enabledApiProposals: e?.enabledApiProposals || [],
    engines: e?.engines || {},
    extensionKind: e?.extensionKind || [],
    readmeUrl: e?.readmeUrl,
    downloadUrl: e?.downloadUrl,
    enablement: e?.enablement,
    productDisablement: e?.productDisablement,
    configurationDisablement: e?.configurationDisablement,
    icon: e?.icon,
    iconUrlFallback: e?.iconUrlFallback,
    iconDataUrl: e?.iconDataUrl,
    iconSource: e?.iconSource,
    defaultIcon: e?.defaultIcon,
    capabilities: e?.capabilities,
    contributes: e?.contributes,
  }
}

export async function searchExtensions(query: string, opts: SearchOptions = {}): Promise<VsixMetadata[]> {
  const params = new URLSearchParams()
  if (query) params.set("q", query)
  if (opts.category) params.set("category", opts.category)
  if (opts.pageSize) params.set("pageSize", String(opts.pageSize))
  const res = await api.get<{ extensions?: OpenVsxSearchEntry[] } | OpenVsxSearchEntry[]>(
    `/extensions-host/marketplace/search?${params.toString()}`,
  )
  const list = Array.isArray(res) ? res : (res?.extensions || [])
  return list.map(normalizeSearchEntry)
}

export async function getExtensionDetails(id: string, version?: string): Promise<ExtensionDetails | null> {
  const { namespace, name } = splitExtensionId(id)
  if (!namespace || !name) return null
  const params = new URLSearchParams()
  if (version) params.set("version", version)
  const suffix = params.toString() ? `?${params.toString()}` : ""
  const res = await api.get<{ extension?: any }>(
    `/extensions-host/marketplace/details/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}${suffix}`,
  )
  return res?.extension ? normalizeDetails(res.extension) : null
}

export async function getFullExtensionDetails(id: string, version?: string): Promise<ExtensionDetailsPayload | null> {
  const { namespace, name } = splitExtensionId(id)
  if (!namespace || !name) return null
  const params = new URLSearchParams()
  if (version) params.set("version", version)
  const suffix = params.toString() ? `?${params.toString()}` : ""
  return api.get<ExtensionDetailsPayload>(
    `/extensions-host/marketplace/details/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/full${suffix}`,
  )
}

export async function getExtensionReadme(id: string): Promise<ExtensionReadme> {
  const { namespace, name } = splitExtensionId(id)
  if (!namespace || !name) return { id, readme: "", available: false, error: "invalid extension id" }
  return api.get<ExtensionReadme>(
    `/extensions-host/marketplace/readme/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
  )
}

export async function getExtensionVersions(id: string): Promise<ExtensionVersions> {
  const { namespace, name } = splitExtensionId(id)
  if (!namespace || !name) return { id, versions: [], error: "invalid extension id" }
  return api.get<ExtensionVersions>(
    `/extensions-host/marketplace/versions/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
  )
}

export async function getExtensionInstallPlan(id: string, version?: string): Promise<ExtensionInstallPlan | null> {
  const r = await api.post<{ success?: boolean; error?: string; plan?: ExtensionInstallPlan }>(
    "/extensions-host/marketplace/install-plan",
    { extensionId: id, version },
  )
  return r?.success === false ? null : (r?.plan || null)
}

export async function getExtensionIconDataUrl(meta: VsixMetadata): Promise<string> {
  if (!meta.iconCacheUrl && !meta.iconUrl) return meta.iconDataUrl || ""
  const path = meta.iconCacheUrl
    || `/extensions-host/marketplace/icon/${encodeURIComponent(meta.id)}?url=${encodeURIComponent(meta.iconUrl || "")}`
  const res = await api.get<{ dataUrl?: string }>(path)
  return res?.dataUrl || meta.iconDataUrl || ""
}

export async function getInstalledExtensionIconDataUrl(id: string): Promise<string> {
  const res = await api.get<{ dataUrl?: string }>(`/extensions-host/installed/${encodeURIComponent(id)}/icon`)
  return res?.dataUrl || ""
}

export async function installExtension(id: string, version?: string, options: InstallExtensionOptions = {}): Promise<{ success: boolean; error?: string }> {
  try {
    const r = await api.post<{ success?: boolean; error?: string }>(
      "/extensions-host/marketplace/install",
      { extensionId: id, version, ...(options.confirmed === true ? { confirmed: true } : {}) },
    )
    return { success: r?.success !== false, error: r?.error }
  } catch (e) {
    return { success: false, error: (e as Error)?.message || "install failed" }
  }
}

export async function getMigratedExtensionQueue(): Promise<MigratedExtensionQueue> {
  return api.get<MigratedExtensionQueue>("/migration/vscode/extensions")
}

export async function updateMigratedExtensionStatus(
  extensionId: string,
  status: MigratedExtensionQueueItem["status"],
  error?: string,
): Promise<MigratedExtensionQueue> {
  return api.post<MigratedExtensionQueue>("/migration/vscode/extensions/status", { extensionId, status, error })
}

export async function installVsixFile(filePath: string, options: InstallExtensionOptions = {}): Promise<{ success: boolean; error?: string }> {
  try {
    const r = await api.post<{ success?: boolean; error?: string }>(
      "/extensions-host/install-vsix",
      { filePath, ...(options.confirmed === true ? { confirmed: true } : {}) },
    )
    return { success: r?.success !== false, error: r?.error }
  } catch (e) {
    return { success: false, error: (e as Error)?.message || "install failed" }
  }
}

export async function uninstallExtension(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const r = await api.post<{ success?: boolean; error?: string }>(
      "/extensions-host/uninstall",
      { extensionId: id },
    )
    return { success: r?.success !== false, error: r?.error }
  } catch (e) {
    return { success: false, error: (e as Error)?.message || "uninstall failed" }
  }
}

export async function rollbackExtension(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const r = await api.post<{ success?: boolean; error?: string }>(
      "/extensions-host/rollback",
      { extensionId: id },
    )
    return { success: r?.success !== false, error: r?.error }
  } catch (e) {
    return { success: false, error: (e as Error)?.message || "rollback failed" }
  }
}

export async function activateExtensionHostByEvent(
  activationEvent: string,
  extensionId = "codek.placeholder",
): Promise<ExtensionHostActivationResult> {
  return api.post<ExtensionHostActivationResult>("/extensions-host/activate", {
    activationEvent,
    extensionId,
  })
}

export async function stopExtensionHosts(
  reason: string,
  options: ExtensionHostLifecycleOperationOptions = {},
): Promise<ExtensionHostLifecycleOperationResult> {
  return api.post<ExtensionHostLifecycleOperationResult>("/extensions-host/lifecycle/stop", {
    reason,
    ...options,
  })
}

export async function startExtensionHosts(
  reason = "",
  options: ExtensionHostLifecycleOperationOptions = {},
): Promise<ExtensionHostLifecycleOperationResult> {
  return api.post<ExtensionHostLifecycleOperationResult>("/extensions-host/lifecycle/start", {
    reason,
    ...options,
  })
}

export async function restartExtensionHosts(
  reason = "Restarting extension hosts",
  options: ExtensionHostLifecycleOperationOptions = {},
): Promise<ExtensionHostLifecycleRestartResult> {
  return api.post<ExtensionHostLifecycleRestartResult>("/extensions-host/lifecycle/restart", {
    reason,
    ...options,
  })
}

export async function listInstalledExtensions(): Promise<VsixMetadata[]> {
  const r = await api.get<{ extensions?: any[] } | any[]>("/extensions-host/installed")
  const list = Array.isArray(r) ? r : (r?.extensions || [])
  return list.map(normalizeInstalled)
}

export async function listExtensionInstallStates(): Promise<ExtensionInstallState[]> {
  const r = await api.get<{ extensions?: ExtensionInstallState[] } | ExtensionInstallState[]>("/extensions-host/install-state")
  return Array.isArray(r) ? r : (r?.extensions || [])
}

export async function getExtensionAuditLog(limit = 100): Promise<ExtensionAuditEntry[]> {
  const params = new URLSearchParams()
  params.set("limit", String(limit))
  const r = await api.get<{ entries?: ExtensionAuditEntry[] } | ExtensionAuditEntry[]>(`/extensions-host/audit?${params.toString()}`)
  return Array.isArray(r) ? r : (r?.entries || [])
}

export async function enableExtension(id: string): Promise<void> {
  await api.post("/extensions-host/enable", { extensionId: id })
}

export async function disableExtension(id: string): Promise<void> {
  await api.post("/extensions-host/disable", { extensionId: id })
}

export async function reloadExtensionHost(): Promise<void> {
  await api.post("/extensions-host/reload", {})
}

export async function ehStatus(): Promise<{ state: string; activated: number; error?: string }> {
  return api.get("/extensions-host/status")
}

export async function getExtensionCompatibilityReport(): Promise<ExtensionCompatibilityReport> {
  return api.get<ExtensionCompatibilityReport>("/extensions-host/compatibility")
}

export async function runExtensionCompatibilityReport(): Promise<ExtensionCompatibilityReport> {
  return api.post<ExtensionCompatibilityReport>("/extensions-host/compatibility/run", {})
}

export interface InstallProgressEvent {
  phase: "download" | "extract" | "activate" | "done" | "error"
  percent?: number
  message?: string
}

export function streamInstallProgress(
  extensionId: string,
  onEvent: (e: InstallProgressEvent) => void,
): () => void {
  const url = `/extensions-host/install-stream?extensionId=${encodeURIComponent(extensionId)}`
  const codek: any = (window as any).codek
  if (codek && typeof codek.subscribeSse === "function") {
    const off = codek.subscribeSse(url, (msg: any) => {
      try { onEvent(typeof msg === "string" ? JSON.parse(msg) : msg) } catch {}
    })
    return typeof off === "function" ? off : () => {}
  }
  // Fallback: EventSource (only works for absolute URLs over HTTP)
  try {
    const es = new EventSource(url)
    es.onmessage = (ev) => {
      try { onEvent(JSON.parse(ev.data)) } catch {}
    }
    return () => es.close()
  } catch {
    return () => {}
  }
}
