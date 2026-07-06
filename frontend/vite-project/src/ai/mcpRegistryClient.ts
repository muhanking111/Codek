import { api } from "../lib/api"

export interface McpRegistryInputValue {
  value: string
}

export interface McpRegistryCollection {
  id: string
  label?: string
  source?: string
  scope?: string
  order?: number
  serverNames?: string[]
}

export interface McpRegistryServer {
  serverName: string
  initialized?: boolean
  allowed?: boolean
  disabledReason?: string
  capabilities?: Record<string, unknown> | null
  profileScoped?: boolean
  workspaceScoped?: boolean
  installedScoped?: boolean
  extensionScoped?: boolean
  config?: Record<string, unknown>
  authSession?: McpAuthenticationSessionViewModel
  transportState?: {
    sessionId?: string
    backchannelDisabled?: boolean
    lastEventId?: string
    retryAfter?: string
    retryMode?: "active" | "manual" | "closed" | string
    retryAttempt?: number
    retryBudget?: number
    lastError?: string
    nextRetryAt?: number
    lastBackchannelError?: string
    channelStatus?: "idle" | "connecting" | "open" | "closed" | "error" | string
    reconnectRequested?: boolean
    userActionRequired?: boolean
    noAutoRetry?: boolean
  } | null
  tools?: Array<Record<string, unknown>>
}

export type McpAuthenticationSessionStatus = "missing" | "pending" | "authorized" | "expired" | "revoked" | "error"

export interface McpAuthenticationSessionViewModel {
  status: McpAuthenticationSessionStatus
  label: string
  detail: string
  promptLabel: string
  promptDetail: string
  canPrompt: boolean
  providerId?: string
  sessionId?: string
  accountLabel?: string
  authorizationUrl?: string
  error?: string
}

export interface McpRegistrySnapshot {
  collections: McpRegistryCollection[]
  servers: McpRegistryServer[]
  delegates: Array<Record<string, unknown>>
}

export interface McpServerActionResult {
  success: boolean
  server?: McpRegistryServer | null
}

export interface McpGalleryInstalledSnapshot {
  status?: string
  servers: Array<Record<string, unknown>>
}

export interface McpGalleryServer {
  id?: string
  name: string
  displayName?: string
  description?: string
  version?: string
  publisher?: string
  repositoryUrl?: string
  readme?: string
  readmeUrl?: string
  icon?: unknown
  configuration?: Record<string, unknown>
  [key: string]: unknown
}

export interface McpGallerySearchSnapshot {
  status?: string
  servers: McpGalleryServer[]
  hasMore: boolean
  page?: number
}

export interface McpGalleryCanInstallResult {
  canInstall: boolean
  reason: string
  details?: unknown
}

export interface McpGalleryInstallOptions extends McpRegistryInputWriteOptions {
  packageType?: string
  mcpTarget?: string
  workspace?: string
  workspaceFile?: string
  values?: Record<string, McpRegistryInputValue>
  secrets?: Record<string, McpRegistryInputValue>
}

export interface McpGalleryInstallResult {
  success: boolean
  server?: Record<string, unknown>
  profileResource?: unknown
  error?: string
}

export interface McpResource {
  uri: string
  name?: string
  title?: string
  description?: string
  mimeType?: string
  size?: number
}

export interface McpResourceTemplate {
  uriTemplate?: string
  template?: string
  name?: string
  title?: string
  description?: string
  mimeType?: string
}

export interface McpResourceReadResult {
  contents: Array<Record<string, unknown>>
}

export interface McpResourceUpdateEvent {
  serverName: string
  uri: string
}

export interface McpResourceSubscription {
  ready?: boolean
  reason?: string
  retryMode?: "active" | "manual" | "closed" | string
  retryAfter?: string
  lastEventId?: string
  channelStatus?: "idle" | "connecting" | "open" | "closed" | "error" | string
  reconnectRequested?: boolean
  userActionRequired?: boolean
  noAutoRetry?: boolean
  dispose(): void | Promise<void>
}

export interface McpResourceTemplateCompletionResult {
  values: string[]
  total?: number
  hasMore?: boolean
}

export interface McpRegistrySavedInputs {
  inputs: Record<string, McpRegistryInputValue>
}

export interface McpRegistryInputMetadata {
  id: string
  type?: string
  description?: string
  password?: boolean
  default?: unknown
  options?: unknown[]
}

export interface McpRegistryInputWriteOptions {
  profileId?: string | null
}

function profileQuery(profileId?: string | null): string {
  const value = typeof profileId === "string" ? profileId.trim() : ""
  return value ? `?profileId=${encodeURIComponent(value)}` : ""
}

function normalizeInputValue(value: unknown): McpRegistryInputValue {
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")) {
    const raw = (value as { value?: unknown }).value
    return { value: raw == null ? "" : String(raw) }
  }
  return { value: value == null ? "" : String(value) }
}

export async function getMcpRegistrySnapshot(): Promise<McpRegistrySnapshot> {
  const result = await api.get<Partial<McpRegistrySnapshot>>("/extensions-host/mcp-registry")
  return {
    collections: Array.isArray(result?.collections) ? result.collections : [],
    servers: normalizeRegistryServers(result?.servers),
    delegates: Array.isArray(result?.delegates) ? result.delegates : [],
  }
}

export async function getConfiguredMcpServers(): Promise<McpRegistryServer[]> {
  return (await getMcpRegistrySnapshot()).servers
}

export async function startMcpServer(serverName: string): Promise<McpServerActionResult> {
  return runMcpServerAction(serverName, "start")
}

export async function stopMcpServer(serverName: string): Promise<McpServerActionResult> {
  return runMcpServerAction(serverName, "stop")
}

export async function restartMcpServer(serverName: string): Promise<McpServerActionResult> {
  return runMcpServerAction(serverName, "restart")
}

export async function getInstalledMcpGalleryServers(): Promise<McpGalleryInstalledSnapshot> {
  const result = await api.get<Partial<McpGalleryInstalledSnapshot>>("/extensions-host/mcp-gallery/installed")
  return {
    status: result?.status,
    servers: normalizeInstalledGalleryServers(result?.servers),
  }
}

export async function searchMcpGalleryServers(query = "", pageSize = 50, page = 1): Promise<McpGallerySearchSnapshot> {
  const params = new URLSearchParams()
  if (query.trim()) params.set("q", query.trim())
  params.set("pageSize", String(pageSize))
  params.set("page", String(Math.max(1, Math.trunc(page))))
  const result = await api.get<Partial<McpGallerySearchSnapshot>>(`/extensions-host/mcp-gallery/search?${params}`)
  return {
    status: result?.status,
    servers: normalizeGalleryServers(result?.servers),
    hasMore: result?.hasMore === true,
    page: typeof result?.page === "number" ? result.page : Math.max(1, Math.trunc(page)),
  }
}

export async function getMcpGalleryServers(servers: Array<Pick<McpGalleryServer, "name" | "id">>): Promise<McpGalleryServer[]> {
  const result = await api.post<{ servers?: unknown[] }>("/extensions-host/mcp-gallery/servers", { servers })
  return normalizeGalleryServers(result?.servers)
}

export async function getMcpGalleryReadme(server: McpGalleryServer): Promise<string> {
  const result = await api.post<{ readme?: unknown }>("/extensions-host/mcp-gallery/readme", { server })
  return typeof result?.readme === "string" ? result.readme : ""
}

export async function canInstallMcpGalleryServer(server: McpGalleryServer): Promise<McpGalleryCanInstallResult> {
  const result = await api.post<Partial<McpGalleryCanInstallResult>>("/extensions-host/mcp-gallery/can-install", { server })
  return {
    canInstall: result?.canInstall === true,
    reason: typeof result?.reason === "string" ? result.reason : "",
    details: result?.details,
  }
}

export async function installMcpGalleryServer(
  server: McpGalleryServer,
  options: McpGalleryInstallOptions = {},
): Promise<McpGalleryInstallResult> {
  return api.post<McpGalleryInstallResult>("/extensions-host/mcp-gallery/install", {
    server,
    ...normalizeMcpGalleryInstallOptions(options),
  })
}

export async function updateMcpGalleryServerMetadata(
  server: McpGalleryServer,
  options: McpGalleryInstallOptions & { name?: string; serverName?: string } = {},
): Promise<McpGalleryInstallResult> {
  return api.post<McpGalleryInstallResult>("/extensions-host/mcp-gallery/update-metadata", {
    server,
    ...normalizeMcpGalleryInstallOptions(options),
    name: options.name,
    serverName: options.serverName,
  })
}

export async function uninstallMcpGalleryServer(
  serverOrName: McpGalleryServer | string,
  options: McpGalleryInstallOptions = {},
): Promise<McpGalleryInstallResult> {
  const server = typeof serverOrName === "string" ? undefined : serverOrName
  const name = typeof serverOrName === "string" ? serverOrName : serverOrName.name
  return api.post<McpGalleryInstallResult>("/extensions-host/mcp-gallery/uninstall", {
    server,
    name,
    ...normalizeMcpGalleryInstallOptions(options),
  })
}

export async function listMcpResources(serverName: string): Promise<McpResource[]> {
  const name = normalizeServerName(serverName)
  const result = await api.get<{ resources?: McpResource[] }>(
    `/extensions-host/mcp-registry/servers/${encodeURIComponent(name)}/resources`,
  )
  return Array.isArray(result?.resources) ? result.resources : []
}

export async function listMcpResourceTemplates(serverName: string): Promise<McpResourceTemplate[]> {
  const name = normalizeServerName(serverName)
  const result = await api.get<{ resourceTemplates?: McpResourceTemplate[] }>(
    `/extensions-host/mcp-registry/servers/${encodeURIComponent(name)}/resource-templates`,
  )
  return Array.isArray(result?.resourceTemplates) ? result.resourceTemplates : []
}

export async function readMcpResource(serverName: string, uri: string): Promise<McpResourceReadResult> {
  const name = normalizeServerName(serverName)
  const resourceUri = typeof uri === "string" ? uri.trim() : ""
  if (!resourceUri) throw new Error("MCP resource uri is required")
  const result = await api.post<Partial<McpResourceReadResult>>(
    `/extensions-host/mcp-registry/servers/${encodeURIComponent(name)}/read-resource`,
    { uri: resourceUri },
  )
  return {
    contents: Array.isArray(result?.contents) ? result.contents : [],
  }
}

export async function subscribeMcpResource(
  serverName: string,
  uri: string,
  listener: (event: McpResourceUpdateEvent) => void,
): Promise<McpResourceSubscription> {
  const name = normalizeServerName(serverName)
  const resourceUri = typeof uri === "string" ? uri.trim() : ""
  if (!resourceUri) throw new Error("MCP resource uri is required")
  const bridge = window.codek?.subscribeMcpResource
  if (typeof bridge !== "function") {
    return {
      ready: false,
      reason: "MCP resource subscribe bridge is not available outside Electron.",
      dispose() {},
    }
  }
  const subscription = await bridge(name, resourceUri, (event) => {
    const eventUri = typeof event?.uri === "string" ? event.uri.trim() : ""
    if (eventUri !== resourceUri) return
    listener({
      serverName: typeof event?.serverName === "string" && event.serverName.trim() ? event.serverName.trim() : name,
      uri: eventUri,
    })
  })
  return {
    ready: subscription?.ready !== false,
    reason: subscription?.ready === false && typeof subscription?.reason === "string" ? subscription.reason : undefined,
    retryMode: typeof subscription?.retryMode === "string" ? subscription.retryMode : undefined,
    retryAfter: typeof subscription?.retryAfter === "string" ? subscription.retryAfter : undefined,
    lastEventId: typeof subscription?.lastEventId === "string" ? subscription.lastEventId : undefined,
    channelStatus: typeof subscription?.channelStatus === "string" ? subscription.channelStatus : undefined,
    reconnectRequested: subscription?.reconnectRequested === true,
    userActionRequired: subscription?.userActionRequired === true,
    noAutoRetry: subscription?.noAutoRetry === true,
    dispose: () => subscription?.dispose?.(),
  }
}

export async function completeMcpResourceTemplate(
  serverName: string,
  request: { uriTemplate: string; variable: string; value?: string; context?: Record<string, string | string[]> },
  options?: { signal?: AbortSignal },
): Promise<McpResourceTemplateCompletionResult> {
  const name = normalizeServerName(serverName)
  const uriTemplate = typeof request?.uriTemplate === "string" ? request.uriTemplate.trim() : ""
  const variable = typeof request?.variable === "string" ? request.variable.trim() : ""
  if (!uriTemplate) throw new Error("MCP resource template uri is required")
  if (!variable) throw new Error("MCP resource template variable is required")
  const body = {
    uriTemplate,
    variable,
    value: request.value || "",
    context: request.context || {},
  }
  const path = `/extensions-host/mcp-registry/servers/${encodeURIComponent(name)}/resource-template-completions`
  const result = options?.signal
    ? await api.post<{ completion?: Partial<McpResourceTemplateCompletionResult> }>(path, body, options)
    : await api.post<{ completion?: Partial<McpResourceTemplateCompletionResult> }>(path, body)
  return {
    values: Array.isArray(result?.completion?.values) ? result.completion.values.filter((value): value is string => typeof value === "string") : [],
    total: typeof result?.completion?.total === "number" ? result.completion.total : undefined,
    hasMore: result?.completion?.hasMore === true,
  }
}

async function runMcpServerAction(
  serverName: string,
  action: "start" | "stop" | "restart",
): Promise<McpServerActionResult> {
  const name = normalizeServerName(serverName)
  return api.post<McpServerActionResult>(
    `/extensions-host/mcp-registry/servers/${encodeURIComponent(name)}/${action}`,
  )
}

function normalizeServerName(serverName: string): string {
  const name = typeof serverName === "string" ? serverName.trim() : ""
  if (!name) throw new Error("MCP server name is required")
  return name
}

export function buildMcpAuthenticationSessionViewModel(server: Pick<McpRegistryServer, "config" | "allowed" | "disabledReason">): McpAuthenticationSessionViewModel {
  const config = server.config || {}
  const rawSession = isRecord(config.authSession) ? config.authSession : {}
  const status = normalizeAuthenticationSessionStatus(rawSession.status ?? config.authSessionState ?? config.authState)
  const authorizationUrl = typeof config.authorizationUrl === "string" ? config.authorizationUrl.trim() : ""
  const hint = typeof config.authActionHint === "string" && config.authActionHint.trim()
    ? config.authActionHint.trim()
    : "Open Gateway authorization"
  const accountLabel = stringValue(rawSession.accountLabel) || stringValue(config.authAccountLabel)
  const providerId = stringValue(rawSession.providerId) || stringValue(config.authProviderId)
  const sessionId = stringValue(rawSession.sessionId)
  const error = stringValue(rawSession.error) || stringValue(config.authError) || (status === "error" ? stringValue(server.disabledReason) : "")
  const stateLabels: Record<McpAuthenticationSessionStatus, string> = {
    missing: "Missing authentication session",
    pending: "Authentication pending",
    authorized: "Authorized",
    expired: "Authentication expired",
    revoked: "Authentication revoked",
    error: "Authentication error",
  }
  const stateDetails: Record<McpAuthenticationSessionStatus, string> = {
    missing: "No OAuth session is available for this MCP server.",
    pending: "OAuth authorization is in progress or waiting for user confirmation.",
    authorized: accountLabel ? `Signed in as ${accountLabel}.` : "A valid OAuth session is available.",
    expired: "The OAuth session expired or refresh failed.",
    revoked: "The OAuth session was revoked and must be authorized again.",
    error: error || "The OAuth session provider reported an error.",
  }
  return {
    status,
    label: stateLabels[status],
    detail: stateDetails[status],
    promptLabel: status === "authorized" ? "Manage authentication session" : "Authorize Gateway",
    promptDetail: authorizationUrl ? `${hint} - ${authorizationUrl}` : hint,
    canPrompt: status !== "authorized" && Boolean(authorizationUrl),
    providerId: providerId || undefined,
    sessionId: sessionId || undefined,
    accountLabel: accountLabel || undefined,
    authorizationUrl: authorizationUrl || undefined,
    error: error || undefined,
  }
}

function normalizeRegistryServers(value: unknown): McpRegistryServer[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((server): server is McpRegistryServer => Boolean(server) && typeof server === "object" && typeof (server as { serverName?: unknown }).serverName === "string")
    .map((server) => {
      const authSession = buildMcpAuthenticationSessionViewModel(server)
      const shouldExposeSession = isAuthenticationConfigured(server.config) || authSession.status !== "missing"
      return {
        ...server,
        authSession: shouldExposeSession ? authSession : undefined,
      }
    })
}

function isAuthenticationConfigured(config: Record<string, unknown> | undefined): boolean {
  if (!config) return false
  return config.gateway === true
    || config.authRequired === true
    || typeof config.authState === "string"
    || isRecord(config.authSession)
    || typeof config.authorizationUrl === "string"
}

function normalizeAuthenticationSessionStatus(value: unknown): McpAuthenticationSessionStatus {
  const status = typeof value === "string" ? value.trim().toLowerCase() : ""
  switch (status) {
    case "authorized":
    case "pending":
    case "expired":
    case "revoked":
    case "error":
    case "missing":
      return status
    case "unauthorized":
      return "missing"
    case "refresh_failed":
    case "refresh-failed":
      return "expired"
    case "failed":
      return "error"
    default:
      return "missing"
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalizeGalleryServers(value: unknown): McpGalleryServer[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((server): server is McpGalleryServer => Boolean(server) && typeof server === "object" && typeof (server as { name?: unknown }).name === "string")
    .map((server) => ({ ...server, name: server.name.trim() }))
    .filter((server) => server.name.length > 0)
}

function normalizeInstalledGalleryServers(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value
    .filter((server): server is Record<string, unknown> => Boolean(server) && typeof server === "object")
    .map((server) => {
      const name = typeof server.name === "string" ? server.name.trim() : ""
      const serverName = typeof server.serverName === "string" ? server.serverName.trim() : ""
      const id = typeof server.id === "string" ? server.id.trim() : ""
      const { name: _name, serverName: _serverName, id: _id, ...rest } = server
      return {
        ...rest,
        ...(name ? { name } : {}),
        ...(serverName ? { serverName } : {}),
        ...(id ? { id } : {}),
      }
    })
    .filter((server) => typeof server.name === "string" || typeof server.serverName === "string" || typeof server.id === "string")
}

function normalizeMcpGalleryInstallOptions(options: McpGalleryInstallOptions): McpGalleryInstallOptions {
  return {
    packageType: options.packageType || undefined,
    profileId: options.profileId || undefined,
    mcpTarget: options.mcpTarget || undefined,
    workspace: options.workspace || undefined,
    workspaceFile: options.workspaceFile || undefined,
    values: options.values,
    secrets: options.secrets,
  }
}

export async function getSavedMcpInputs(profileId?: string | null): Promise<Record<string, McpRegistryInputValue>> {
  const result = await api.get<McpRegistrySavedInputs>(`/extensions-host/mcp-registry/inputs${profileQuery(profileId)}`)
  return result?.inputs && typeof result.inputs === "object" ? result.inputs : {}
}

export async function setSavedMcpInput(
  input: McpRegistryInputMetadata,
  value: unknown,
  options: McpRegistryInputWriteOptions = {},
): Promise<Record<string, McpRegistryInputValue>> {
  const id = typeof input?.id === "string" ? input.id.trim() : ""
  if (!id) throw new Error("MCP input id is required")
  const bucket = input.password ? "secrets" : "values"
  const result = await api.request<McpRegistrySavedInputs>("PUT", "/extensions-host/mcp-registry/inputs", {
    profileId: options.profileId || undefined,
    [bucket]: {
      [id]: normalizeInputValue(value),
    },
  })
  return result?.inputs && typeof result.inputs === "object" ? result.inputs : {}
}

export async function setSavedMcpInputs(
  inputs: Array<{ metadata: McpRegistryInputMetadata; value: unknown }>,
  options: McpRegistryInputWriteOptions = {},
): Promise<Record<string, McpRegistryInputValue>> {
  const values: Record<string, McpRegistryInputValue> = {}
  const secrets: Record<string, McpRegistryInputValue> = {}
  for (const entry of Array.isArray(inputs) ? inputs : []) {
    const id = typeof entry?.metadata?.id === "string" ? entry.metadata.id.trim() : ""
    if (!id) continue
    const target = entry.metadata.password ? secrets : values
    target[id] = normalizeInputValue(entry.value)
  }
  const result = await api.request<McpRegistrySavedInputs>("PUT", "/extensions-host/mcp-registry/inputs", {
    profileId: options.profileId || undefined,
    values,
    secrets,
  })
  return result?.inputs && typeof result.inputs === "object" ? result.inputs : {}
}

export async function clearSavedMcpInput(id: string, options: McpRegistryInputWriteOptions = {}): Promise<void> {
  const inputId = typeof id === "string" ? id.trim() : ""
  if (!inputId) throw new Error("MCP input id is required")
  await api.request("DELETE", `/extensions-host/mcp-registry/inputs/${encodeURIComponent(inputId)}`, {
    profileId: options.profileId || undefined,
  })
}

export async function clearAllSavedMcpInputs(options: McpRegistryInputWriteOptions = {}): Promise<void> {
  await api.request("DELETE", "/extensions-host/mcp-registry/inputs", {
    profileId: options.profileId || undefined,
  })
}
