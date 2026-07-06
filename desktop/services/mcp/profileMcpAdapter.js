const { spawn } = require("child_process")
const { fetch } = require("undici")
const fs = require("fs")
const os = require("os")
const path = require("path")
const extensionInstallState = require("../extensions-host/extensionInstallState")
const userDataProfile = require("../userDataProfile")
const { allowedMcpServersService } = require("./mcpAccess")
const { getInstallableMcpServersFromInstalledRecord } = require("./mcpManagementAdapter")
const { McpRegistryInputStorageAdapter } = require("./mcpRegistryInputStorageAdapter")
const { McpRegistryServiceAdapter } = require("./mcpRegistryServiceAdapter")

const MCP_TIMEOUT_MS = 10_000
const MAX_BUFFER_SIZE = 10 * 1024 * 1024
const MCP_PROTOCOL_VERSION = "2024-11-05"
const MCP_REMOTE_RECONNECT_BASE_MS = 50
const MCP_REMOTE_RECONNECT_MAX_MS = 2_000
const MCP_REMOTE_RECONNECT_BUDGET = 3
const installedMcpStatePath = extensionInstallState.defaultStatePath()

const clientRegistry = new Map()
const profileClientNames = new Set()
const workspaceClientNames = new Set()
const installedClientNames = new Set()
const extensionClientNames = new Set()
const extensionCollectionClientNames = new Map()
const discoverySources = new Map()
const mcpRegistryService = new McpRegistryServiceAdapter({
  accessProvider: () => allowedMcpServersService.access,
})
let activeProfileKey = ""
let activeWorkspaceKey = ""

class JsonRpcError extends Error {
  constructor(code, message, data) {
    super(message)
    this.name = "JsonRpcError"
    this.code = code
    this.data = data
  }
}

class McpInputRequiredError extends Error {
  constructor(serverName, missingInputs) {
    const ids = missingInputs.map((input) => input.id).join(", ")
    super(`MCP input required for ${serverName}: ${ids}`)
    this.name = "McpInputRequiredError"
    this.code = "MCP_INPUT_REQUIRED"
    this.missingInputs = missingInputs.map((input) => ({ ...input }))
  }
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function stripJsonComments(source) {
  let output = ""
  let inString = false
  let quote = ""
  let escaped = false
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    const next = source[i + 1]
    if (inString) {
      output += char
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === quote) {
        inString = false
        quote = ""
      }
      continue
    }
    if (char === "\"" || char === "'") {
      inString = true
      quote = char
      output += char
      continue
    }
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1
      output += "\n"
      continue
    }
    if (char === "/" && next === "*") {
      i += 2
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1
      i += 1
      continue
    }
    output += char
  }
  return output
}

function stripTrailingCommas(source) {
  let output = ""
  let inString = false
  let quote = ""
  let escaped = false
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (inString) {
      output += char
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === quote) {
        inString = false
        quote = ""
      }
      continue
    }
    if (char === "\"" || char === "'") {
      inString = true
      quote = char
      output += char
      continue
    }
    if (char === ",") {
      let j = i + 1
      while (/\s/.test(source[j] || "")) j += 1
      if (source[j] === "}" || source[j] === "]") continue
    }
    output += char
  }
  return output
}

function parseJsonc(text) {
  return JSON.parse(stripTrailingCommas(stripJsonComments(String(text || ""))))
}

function parseProfileResourceContent(resource) {
  if (!resource || !String(resource).trim()) return { value: undefined, errors: [] }
  try {
    return { value: parseJsonc(resource), errors: [] }
  } catch (error) {
    return { value: undefined, errors: [error && error.message ? error.message : String(error)] }
  }
}

function resolveInnerMcpContent(value, errors) {
  if (!isRecord(value)) return undefined
  if (!Object.prototype.hasOwnProperty.call(value, "mcp")) return value
  const content = value.mcp
  if (content === null || content === undefined || content === "") return undefined
  if (typeof content === "string") {
    try {
      return parseJsonc(content)
    } catch (error) {
      errors.push(error && error.message ? error.message : String(error))
      return undefined
    }
  }
  return isRecord(content) ? content : undefined
}

function stringArray(value) {
  if (!Array.isArray(value)) return undefined
  const out = value.filter((item) => typeof item === "string")
  return out.length ? out : undefined
}

function stringMap(value) {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
    .filter(([, item]) => typeof item === "string" || typeof item === "number" || item === null)
    .map(([key, item]) => [key, item === null ? "" : String(item)])
  return entries.length ? Object.fromEntries(entries) : undefined
}

function headerMap(value) {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
    .filter(([, item]) => typeof item === "string")
    .map(([key, item]) => [key, item])
  return entries.length ? Object.fromEntries(entries) : undefined
}

function sanitizeMcpInputMetadata(input) {
  if (!isRecord(input)) return null
  const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : ""
  if (!id) return null
  const normalized = {
    id,
    type: Array.isArray(input.options) || Array.isArray(input.choices) ? "pick" : "prompt",
    description: typeof input.description === "string" ? input.description : "",
    password: !!input.password || !!input.isSecret || !!input.is_secret,
  }
  if (Object.prototype.hasOwnProperty.call(input, "default")) normalized.default = input.default
  if (Array.isArray(input.options)) normalized.options = [...input.options]
  else if (Array.isArray(input.choices)) normalized.options = [...input.choices]
  return normalized
}

function normalizeMcpInputs(value) {
  const inputs = Array.isArray(value) ? value.map(sanitizeMcpInputMetadata).filter(Boolean) : []
  return inputs.length ? inputs : undefined
}

function fallbackMcpInputMetadata(id) {
  return {
    id,
    type: "prompt",
    description: "",
    password: false,
  }
}

function collectMcpInputReferencesFromString(value, output) {
  if (typeof value !== "string") return
  const regex = /\$\{input:([^}]+)\}/g
  let match
  while ((match = regex.exec(value)) !== null) {
    const id = String(match[1] || "").trim()
    if (id) output.add(id)
  }
}

function collectMcpInputReferences(value, output = new Set()) {
  if (typeof value === "string") {
    collectMcpInputReferencesFromString(value, output)
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMcpInputReferences(item, output)
    return output
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) collectMcpInputReferences(item, output)
  }
  return output
}

function getUnresolvedMcpInputMetadata(definition, launch) {
  const ids = [...collectMcpInputReferences(launch)].sort((left, right) => left.localeCompare(right))
  if (!ids.length) return []
  const metadata = new Map(
    (Array.isArray(definition?.inputs) ? definition.inputs : [])
      .map((input) => sanitizeMcpInputMetadata(input))
      .filter(Boolean)
      .map((input) => [input.id, input]),
  )
  return ids.map((id) => ({ ...(metadata.get(id) || fallbackMcpInputMetadata(id)) }))
}

function normalizeServerConfig(name, value) {
  if (!isRecord(value)) return null
  const source = isRecord(value.config) ? { ...value.config, version: value.version, gallery: value.gallery } : value
  const serverMetadata = {
    version: typeof source.version === "string" ? source.version : undefined,
    gallery: typeof source.gallery === "string" ? source.gallery : undefined,
    inputs: normalizeMcpInputs(value.inputs || source.inputs),
  }
  const rawType = typeof source.type === "string" ? source.type : ""
  const rawTransportType = typeof source.transportType === "string"
    ? source.transportType
    : typeof source.transport === "string"
      ? source.transport
      : ""
  const type = rawType === "local" ? "stdio" : rawType === "remote" ? "http" : rawType
  const httpTransportType = rawTransportType === "streamable-http" || rawTransportType === "streamable"
    ? "streamable-http"
    : rawTransportType === "sse"
      ? "sse"
      : type === "sse"
        ? "sse"
        : "http"
  if (type === "ws") return null
  const command = typeof source.command === "string" ? source.command.trim() : ""
  const url = typeof source.url === "string"
    ? source.url.trim()
    : typeof source.serverUrl === "string"
      ? source.serverUrl.trim()
      : ""
  const streamUrl = typeof source.streamUrl === "string"
    ? source.streamUrl.trim()
    : typeof source.sseUrl === "string"
      ? source.sseUrl.trim()
      : typeof source.eventSourceUrl === "string"
        ? source.eventSourceUrl.trim()
        : ""
  if (type === "http" || type === "sse" || (!command && url)) {
    if (!url) return null
    return {
      ...serverMetadata,
      serverName: name,
      name,
      type: "http",
      transport: "http",
      transportType: httpTransportType,
      url,
      serverUrl: url,
      streamUrl: streamUrl || undefined,
      headers: headerMap(source.headers),
      gateway: source.gateway === true || source.provider === "gateway" ? true : undefined,
      authRequired: source.authRequired === true || source.authorization === "oauth" ? true : undefined,
      authState: typeof source.authState === "string" ? source.authState : undefined,
      authSession: normalizeAuthenticationSessionMetadata(source),
      authProviderId: typeof source.authProviderId === "string" ? source.authProviderId : undefined,
      authAccountLabel: typeof source.authAccountLabel === "string" ? source.authAccountLabel : undefined,
      authError: typeof source.authError === "string" ? source.authError : undefined,
      authorizationUrl: typeof source.authorizationUrl === "string" ? source.authorizationUrl : undefined,
      authActionHint: typeof source.authActionHint === "string"
        ? source.authActionHint
        : typeof source.actionHint === "string"
          ? source.actionHint
          : undefined,
      provider: typeof source.provider === "string" ? source.provider : undefined,
    }
  }
  if (!command) return null
  return {
    ...serverMetadata,
    serverName: name,
    name,
    type: "stdio",
    transport: "stdio",
    command,
    args: stringArray(source.args),
    env: stringMap(source.env),
    cwd: typeof source.cwd === "string" ? source.cwd : undefined,
  }
}

function normalizeAuthenticationSessionStatus(value) {
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
      return ""
  }
}

function normalizeAuthenticationSessionMetadata(source) {
  const raw = isRecord(source.authSession) ? source.authSession : {}
  const status = normalizeAuthenticationSessionStatus(raw.status)
    || normalizeAuthenticationSessionStatus(source.authSessionState)
    || normalizeAuthenticationSessionStatus(source.authState)
  if (!status) return undefined
  const session = { status }
  const providerId = typeof raw.providerId === "string" ? raw.providerId : source.authProviderId
  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId : source.authSessionId
  const accountLabel = typeof raw.accountLabel === "string" ? raw.accountLabel : source.authAccountLabel
  const error = typeof raw.error === "string" ? raw.error : source.authError
  const scopes = Array.isArray(raw.scopes)
    ? raw.scopes.filter((scope) => typeof scope === "string")
    : Array.isArray(source.authScopes)
      ? source.authScopes.filter((scope) => typeof scope === "string")
      : undefined
  if (typeof providerId === "string" && providerId.trim()) session.providerId = providerId.trim()
  if (typeof sessionId === "string" && sessionId.trim()) session.sessionId = sessionId.trim()
  if (typeof accountLabel === "string" && accountLabel.trim()) session.accountLabel = accountLabel.trim()
  if (typeof error === "string" && error.trim()) session.error = error.trim()
  if (scopes?.length) session.scopes = scopes
  return session
}

function looksLikeServerMap(value) {
  const entries = Object.entries(value)
  if (!entries.length) return false
  return entries.every(([, item]) => isRecord(item) && (
    typeof item.command === "string" ||
    typeof item.url === "string" ||
    typeof item.serverUrl === "string" ||
    isRecord(item.config)
  ))
}

function resolveServerMap(value) {
  if (!isRecord(value)) return {}
  if (isRecord(value.servers)) return value.servers
  if (isRecord(value.mcpServers)) return value.mcpServers
  if (looksLikeServerMap(value)) return value
  return {}
}

function parseMcpProfileResource(resource) {
  const errors = []
  const parsed = parseProfileResourceContent(resource)
  errors.push(...parsed.errors)
  const inner = resolveInnerMcpContent(parsed.value, errors)
  const serverMap = resolveServerMap(inner)
  const servers = Object.entries(serverMap)
    .map(([name, value]) => normalizeServerConfig(name, value))
    .filter(Boolean)
  return {
    servers,
    inputs: isRecord(inner) && Array.isArray(inner.inputs) ? inner.inputs : [],
    sandbox: isRecord(inner) ? inner.sandbox : undefined,
    errors,
  }
}

function withServerSource(server, source) {
  return {
    ...server,
    source: source.source,
    sourceLabel: source.label,
    sourcePath: source.path,
    workspaceScoped: !!source.workspaceScoped,
  }
}

function normalizeProjectRoot(projectRoot) {
  if (typeof projectRoot !== "string" || !projectRoot.trim()) return ""
  return path.resolve(projectRoot)
}

function normalizeDiscoverySource(source) {
  if (!isRecord(source)) return null
  const id = typeof source.id === "string" && source.id.trim() ? source.id.trim() : ""
  const label = typeof source.label === "string" && source.label.trim() ? source.label.trim() : ""
  const sourceName = typeof source.source === "string" && source.source.trim() ? source.source.trim() : id
  const pathSegments = Array.isArray(source.pathSegments)
    ? source.pathSegments.filter((segment) => typeof segment === "string" && segment.trim())
    : []
  if (!id || !label || !sourceName || pathSegments.length === 0) return null
  return {
    id,
    label,
    source: sourceName,
    pathSegments,
    workspaceScoped: source.workspaceScoped !== false,
    fromGallery: !!source.fromGallery,
  }
}

function registerMcpDiscoverySource(source) {
  const normalized = normalizeDiscoverySource(source)
  if (!normalized) throw new Error("invalid MCP discovery source")
  const previous = discoverySources.get(normalized.id)
  discoverySources.set(normalized.id, normalized)
  return {
    dispose() {
      if (previous) discoverySources.set(normalized.id, previous)
      else discoverySources.delete(normalized.id)
    },
  }
}

function listMcpDiscoverySources() {
  return [...discoverySources.values()].map((source) => ({ ...source, pathSegments: [...source.pathSegments] }))
}

function normalizeMcpCollectionDefinition(collection, defaults = {}) {
  if (!isRecord(collection)) return null
  const id = typeof collection.id === "string" && collection.id.trim() ? collection.id.trim() : ""
  const label = typeof collection.label === "string" && collection.label.trim() ? collection.label.trim() : id
  if (!id || !label) return null
  return {
    ...defaults,
    ...collection,
    id,
    label,
    source: typeof collection.source === "string" && collection.source.trim()
      ? collection.source.trim()
      : defaults.source,
    scope: typeof collection.scope === "string" && collection.scope.trim()
      ? collection.scope.trim()
      : defaults.scope,
    order: Number.isFinite(Number(collection.order ?? defaults.order))
      ? Number(collection.order ?? defaults.order)
      : 0,
    lazy: collection.lazy ? { ...collection.lazy } : defaults.lazy,
    serverNames: new Set(),
  }
}

async function clearMcpCollection(collectionId) {
  await mcpRegistryService.clearCollection(collectionId, clearMcpClientNames)
}

function registerMcpCollection(collection, options = {}) {
  const normalized = normalizeMcpCollectionDefinition(collection)
  if (!normalized) throw new Error("invalid MCP collection")
  return mcpRegistryService.registerCollection(normalized, options)
}

function listMcpCollections() {
  return mcpRegistryService.listCollections()
}

function registerMcpDelegate(delegate) {
  if (!isRecord(delegate)) throw new Error("invalid MCP delegate")
  return mcpRegistryService.registerDelegate(delegate)
}

function listMcpDelegates() {
  return mcpRegistryService.listDelegates()
}

function onDidChangeMcpCollections(listener) {
  return mcpRegistryService.onDidChangeCollections(listener)
}

function resetMcpDiscoverySourcesForTest() {
  discoverySources.clear()
  registerDefaultMcpDiscoverySources()
}

function registerDefaultMcpDiscoverySources() {
  registerMcpDiscoverySource({
    id: "workspace-dot-mcp",
    label: ".mcp.json",
    source: "workspace-dot-mcp",
    pathSegments: [".mcp.json"],
    workspaceScoped: true,
    fromGallery: false,
  })

  registerMcpDiscoverySource({
    id: "cursor-workspace",
    label: ".cursor/mcp.json",
    source: "cursor-workspace",
    pathSegments: [".cursor", "mcp.json"],
    workspaceScoped: true,
    fromGallery: false,
  })
}

registerDefaultMcpDiscoverySources()

function readEnvironmentVariable(name) {
  if (!name) return ""
  if (Object.prototype.hasOwnProperty.call(process.env, name)) return process.env[name] || ""
  if (process.platform !== "win32") return ""
  const lowered = name.toLowerCase()
  const match = Object.keys(process.env).find((key) => key.toLowerCase() === lowered)
  return match ? process.env[match] || "" : ""
}

function normalizeMcpInputValue(entry) {
  if (!isRecord(entry)) return undefined
  if (!Object.prototype.hasOwnProperty.call(entry, "value")) return undefined
  const value = entry.value
  if (value === undefined || value === null) return ""
  return String(value)
}

async function readMcpInputMap(profileId) {
  const storage = new McpRegistryInputStorageAdapter({ profileId })
  return storage.getMap()
}

function stableMcpInputKey(inputMap) {
  if (!isRecord(inputMap)) return ""
  const entries = Object.entries(inputMap)
    .map(([key, value]) => [key, normalizeMcpInputValue(value)])
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return JSON.stringify(entries)
}

function resolveMcpVariable(value, context) {
  if (typeof value !== "string") return value
  const workspaceFolder = context.workspaceFolder || ""
  const workspaceFolderBasename = workspaceFolder ? path.basename(workspaceFolder) : ""
  const userHome = os.homedir()
  return value.replace(/\$\{([^}]+)\}/g, (match, expression) => {
    const [variable, ...rest] = String(expression || "").split(":")
    const argument = rest.join(":")
    switch (variable) {
      case "workspaceRoot":
      case "workspaceFolder":
        return workspaceFolder || match
      case "workspaceFolderBasename":
        return workspaceFolderBasename || match
      case "userHome":
        return userHome || match
      case "cwd":
        return workspaceFolder || process.cwd()
      case "env":
        return argument ? readEnvironmentVariable(argument) : match
      case "input": {
        const resolved = normalizeMcpInputValue(context.inputs?.[argument])
        return resolved === undefined ? match : resolved
      }
      default:
        return match
    }
  })
}

function resolveStringRecordVariables(record, context) {
  if (!isRecord(record)) return record
  const entries = Object.entries(record).map(([key, value]) => [
    key,
    typeof value === "string" ? resolveMcpVariable(value, context) : value,
  ])
  return Object.fromEntries(entries)
}

function resolveProjectServerConfig(server, projectRoot, options = {}) {
  const workspaceFolder = normalizeProjectRoot(projectRoot)
  const context = { workspaceFolder, inputs: options.inputs || {} }
  const resolved = { ...server }
  if (typeof resolved.command === "string") resolved.command = resolveMcpVariable(resolved.command, context)
  if (typeof resolved.sourcePath === "string") resolved.sourcePath = resolveMcpVariable(resolved.sourcePath, context)
  if (Array.isArray(resolved.args)) {
    resolved.args = resolved.args.map((arg) => resolveMcpVariable(arg, context))
  }
  if (resolved.env) resolved.env = resolveStringRecordVariables(resolved.env, context)
  if (resolved.headers) resolved.headers = resolveStringRecordVariables(resolved.headers, context)
  if (typeof resolved.url === "string") resolved.url = resolveMcpVariable(resolved.url, context)
  if (typeof resolved.serverUrl === "string") resolved.serverUrl = resolveMcpVariable(resolved.serverUrl, context)
  if (typeof resolved.streamUrl === "string") resolved.streamUrl = resolveMcpVariable(resolved.streamUrl, context)
  if (typeof resolved.cwd === "string" && resolved.cwd.trim()) {
    resolved.cwd = resolveMcpVariable(resolved.cwd, context)
  } else if (resolved.transport === "stdio" && workspaceFolder) {
    resolved.cwd = workspaceFolder
  }
  return resolved
}

function getWorkspaceMcpCandidates(projectRoot, options = {}) {
  const workspaceFolder = normalizeProjectRoot(projectRoot)
  if (!workspaceFolder) return []
  const access = options.mcpAccess || "all"
  const candidates = listMcpDiscoverySources()
    .filter((source) => access !== "registry" || source.fromGallery)
    .map((source) => ({
      ...source,
      path: path.join(workspaceFolder, ...source.pathSegments),
    }))
  const workspaceFile = resolveWorkspaceMcpResourceCandidate(options)
  if (workspaceFile && access !== "registry") {
    candidates.push({
      id: "vscode-workspace-settings-mcp",
      label: ".code-workspace settings.mcp",
      source: "workspace-settings-mcp",
      path: workspaceFile,
      workspaceScoped: true,
      fromGallery: false,
      extractMcpResource: extractWorkspaceSettingsMcpResource,
    })
  }
  return candidates
}

function resolveWorkspaceMcpResourceCandidate(options = {}) {
  const value = [options.workspaceFile, options.workspaceResource, options.mcpResourcePath, options.resourcePath]
    .find((candidate) => typeof candidate === "string" && candidate.trim())
  if (!value) return ""
  const resolved = path.resolve(value)
  return resolved.endsWith(".code-workspace") ? resolved : ""
}

function extractWorkspaceSettingsMcpResource(content) {
  const parsed = parseProfileResourceContent(content)
  if (parsed.errors.length || !isRecord(parsed.value)) return { resource: "", errors: parsed.errors }
  const mcp = isRecord(parsed.value.settings) ? parsed.value.settings.mcp : undefined
  return {
    resource: mcp === undefined ? "" : JSON.stringify(mcp),
    errors: [],
  }
}

function workspaceServerCollisionSuffix(source) {
  return source === "cursor-workspace" ? "cursor" : "workspace"
}

function chooseWorkspaceServerName(server) {
  const originalName = String(server.serverName || server.name || "mcp-server").trim() || "mcp-server"
  if (!clientRegistry.has(originalName)) {
    return { ...server, serverName: originalName, name: originalName, originalName }
  }
  const suffix = workspaceServerCollisionSuffix(server.source)
  let candidate = `${originalName}@${suffix}`
  let index = 2
  while (clientRegistry.has(candidate)) {
    candidate = `${originalName}@${suffix}-${index}`
    index += 1
  }
  return { ...server, serverName: candidate, name: candidate, originalName }
}

async function discoverWorkspaceMcpServers(projectRoot, options = {}) {
  const candidates = getWorkspaceMcpCandidates(projectRoot, options)
  const errors = []
  const sources = []
  const servers = []
  const keyParts = [normalizeProjectRoot(projectRoot), options.mcpAccess || "all"]
  for (const candidate of candidates) {
    let content = ""
    try {
      content = await fs.promises.readFile(candidate.path, "utf8")
    } catch (error) {
      if (error && error.code === "ENOENT") continue
      errors.push(`${candidate.label}: ${error && error.message ? error.message : String(error)}`)
      continue
    }
    const extracted = typeof candidate.extractMcpResource === "function"
      ? candidate.extractMcpResource(content)
      : { resource: content, errors: [] }
    errors.push(...(extracted.errors || []).map((message) => `${candidate.label}: ${message}`))
    keyParts.push(candidate.source, content)
    const parsed = parseMcpProfileResource(extracted.resource || "")
    errors.push(...parsed.errors.map((message) => `${candidate.label}: ${message}`))
    if (parsed.servers.length) {
      sources.push({ source: candidate.source, label: candidate.label, path: candidate.path, serverCount: parsed.servers.length })
      servers.push(...parsed.servers.map((server) => withServerSource(server, candidate)))
    }
  }
  return {
    key: keyParts.join("\0"),
    servers,
    sources,
    errors,
  }
}

function getActiveProfileResource(projectRoot) {
  const state = userDataProfile.readWorkbenchProfileState({ workspace: projectRoot })
  const activeProfileId = state.workspaceProfileId || state.activeProfileId || ""
  const profile = Array.isArray(state.profiles)
    ? state.profiles.find((entry) => entry && entry.id === activeProfileId)
    : null
  return {
    state,
    activeProfileId,
    resource: typeof profile?.resources?.mcp === "string" ? profile.resources.mcp : "",
  }
}

function redactedConfig(config) {
  const result = {
    serverName: config.serverName,
    transport: config.transport,
    type: config.type,
  }
  if (config.command) result.command = config.command
  if (Array.isArray(config.args)) result.args = [...config.args]
  if (config.cwd) result.cwd = config.cwd
  if (config.url || config.serverUrl) result.url = config.url || config.serverUrl
  if (config.transportType) result.transportType = config.transportType
  if (config.env) result.envKeys = Object.keys(config.env)
  if (config.headers) result.headerKeys = Object.keys(config.headers)
  if (config.gateway) result.gateway = true
  if (config.authRequired) result.authRequired = true
  if (config.authState) result.authState = config.authState
  if (config.authSession) result.authSession = { ...config.authSession }
  if (config.authProviderId) result.authProviderId = config.authProviderId
  if (config.authAccountLabel) result.authAccountLabel = config.authAccountLabel
  if (config.authError) result.authError = config.authError
  if (config.authorizationUrl) result.authorizationUrl = config.authorizationUrl
  if (config.authActionHint) result.authActionHint = config.authActionHint
  if (config.provider) result.provider = config.provider
  if (Array.isArray(config.inputs)) result.inputs = config.inputs.map((input) => ({ ...input }))
  if (config.gallery && typeof config.gallery === "string") result.gallery = config.gallery
  if (config.source) result.source = config.source
  if (config.sourceLabel) result.sourceLabel = config.sourceLabel
  if (config.sourcePath) result.sourcePath = config.sourcePath
  if (config.workspaceScoped) result.workspaceScoped = true
  if (config.extensionId) result.extensionId = config.extensionId
  if (config.collectionId) result.collectionId = config.collectionId
  if (config.definitionId) result.definitionId = config.definitionId
  if (config.cacheNonce) result.cacheNonce = config.cacheNonce
  if (config.originalName && config.originalName !== config.serverName) result.originalName = config.originalName
  return result
}

function toAllowedState(config) {
  if (config.gateway && config.authRequired && config.authState !== "authorized") {
    return {
      allowed: false,
      disabledReason: "MCP Gateway server requires OAuth authorization before it can start.",
    }
  }
  const result = allowedMcpServersService.isAllowed({
    name: config.serverName || config.name || "",
    config,
  })
  if (result === true) {
    return { allowed: true, disabledReason: "" }
  }
  return {
    allowed: false,
    disabledReason: String(result?.value || result || "MCP server disabled"),
  }
}

class StdioTransport {
  constructor(config) {
    this.config = config
    this.process = null
    this.buffer = ""
    this.callbacks = new Map()
    this.notificationListeners = new Set()
  }

  async start() {
    const env = { ...process.env, ...(this.config.env || {}) }
    this.process = spawn(this.config.command, Array.isArray(this.config.args) ? this.config.args : [], {
      cwd: this.config.cwd || undefined,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    })
    this.process.stdout.on("data", (data) => this.handleData(data.toString("utf8")))
    this.process.stderr.on("data", () => {})
    this.process.on("exit", () => this.handleClose())
    this.process.on("error", (error) => this.handleClose(error))
  }

  handleData(chunk) {
    this.buffer += chunk
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer = this.buffer.slice(-MAX_BUFFER_SIZE)
    }
    const lines = this.buffer.split("\n")
    this.buffer = lines.pop() || ""
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let message
      try {
        message = JSON.parse(trimmed)
      } catch {
        continue
      }
      if (message.id === undefined && typeof this.onNotification === "function") {
        for (const listener of Array.from(this.notificationListeners)) listener(message)
        continue
      }
      if (!this.callbacks.has(message.id)) continue
      const callback = this.callbacks.get(message.id)
      this.callbacks.delete(message.id)
      if (message.error) {
        callback.reject(new JsonRpcError(message.error.code, message.error.message, message.error.data))
      } else {
        callback.resolve(message.result)
      }
    }
  }

  handleClose(error) {
    for (const [, callback] of this.callbacks) {
      callback.reject(error || new Error("MCP server process closed"))
    }
    this.callbacks.clear()
  }

  send(message) {
    if (!this.process || !this.process.stdin) {
      return Promise.reject(new Error("MCP stdio transport not started"))
    }
    const id = message.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.callbacks.delete(id)) {
          reject(new Error(`MCP request timeout: ${message.method}`))
        }
      }, MCP_TIMEOUT_MS)
      this.callbacks.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.process.stdin.write(`${JSON.stringify(message)}\n`)
    })
  }

  sendNotification(message) {
    if (!this.process || !this.process.stdin) return
    this.process.stdin.write(`${JSON.stringify(message)}\n`)
  }

  onNotification(listener) {
    if (typeof listener !== "function") return { dispose() {} }
    this.notificationListeners.add(listener)
    return {
      dispose: () => {
        this.notificationListeners.delete(listener)
      },
    }
  }

  async close() {
    this.callbacks.clear()
    this.notificationListeners.clear()
    if (this.process) {
      try {
        this.process.kill("SIGTERM")
      } catch {
        // ignore closed process
      }
    }
    this.process = null
  }
}

class HttpTransport {
  constructor(config) {
    this.serverUrl = String(config.serverUrl || config.url || "").replace(/\/+$/, "")
    this.streamUrl = String(config.streamUrl || config.sseUrl || config.eventSourceUrl || config.serverUrl || config.url || "").replace(/\/+$/, "")
    this.headers = config.headers || {}
    this.transportType = config.transportType || "http"
    this.sessionId = ""
    this.backchannelDisabled = false
    this.lastEventId = ""
    this.retryAfter = ""
    this.retryAfterSource = ""
    this.retryMode = "active"
    this.lastBackchannelError = ""
    this.channelStatus = "idle"
    this.retryAttempt = 0
    this.retryBudget = Number.isFinite(Number(config.retryBudget))
      ? Math.max(0, Number(config.retryBudget))
      : MCP_REMOTE_RECONNECT_BUDGET
    this.nextRetryAt = 0
    this.reconnectGeneration = 0
    this.reconnectTimer = null
    this.disposed = false
    this.notificationListeners = new Set()
    this.streamController = null
    this.streamPromise = null
  }

  requestHeaders(extra = {}) {
    const headers = { ...this.headers, ...extra }
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId
    if (this.lastEventId) headers["Last-Event-ID"] = this.lastEventId
    return headers
  }

  updateSessionId(response) {
    const sessionId = response?.headers?.get?.("Mcp-Session-Id")
      || response?.headers?.get?.("mcp-session-id")
      || ""
    if (sessionId) this.sessionId = String(sessionId)
  }

  updateRetryState(response) {
    const retryAfter = response?.headers?.get?.("Retry-After")
      || response?.headers?.get?.("retry-after")
      || ""
    if (retryAfter) this.retryAfter = String(retryAfter)
    if (retryAfter) this.retryAfterSource = "header"
  }

  markManualReconnect(reason) {
    this.backchannelDisabled = true
    this.retryMode = "manual"
    this.lastBackchannelError = reason
    this.channelStatus = "error"
    this.clearReconnectTimer()
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.nextRetryAt = 0
  }

  resetRetryState() {
    this.backchannelDisabled = false
    this.retryMode = "active"
    this.retryAttempt = 0
    this.nextRetryAt = 0
    this.lastBackchannelError = ""
    this.clearReconnectTimer()
  }

  reconnectDelayMs(attempt) {
    const retryAfter = Number(this.retryAfter)
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      const delay = this.retryAfterSource === "sse" ? retryAfter : retryAfter * 1000
      return Math.min(delay, MCP_REMOTE_RECONNECT_MAX_MS)
    }
    return Math.min(MCP_REMOTE_RECONNECT_BASE_MS * Math.max(1, 2 ** Math.max(0, attempt - 1)), MCP_REMOTE_RECONNECT_MAX_MS)
  }

  scheduleReconnect(reason, generation = this.reconnectGeneration) {
    if (this.disposed || this.backchannelDisabled || this.notificationListeners.size === 0) return
    this.lastBackchannelError = reason
    if (this.retryAttempt >= this.retryBudget) {
      this.retryMode = "failed"
      this.channelStatus = "error"
      this.nextRetryAt = 0
      return
    }
    this.retryAttempt += 1
    this.retryMode = "reconnecting"
    this.channelStatus = "reconnecting"
    const delay = this.reconnectDelayMs(this.retryAttempt)
    this.nextRetryAt = Date.now() + delay
    this.clearReconnectTimer()
    this.nextRetryAt = Date.now() + delay
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.disposed || generation !== this.reconnectGeneration || this.notificationListeners.size === 0) return
      this.streamController = null
      this.streamPromise = null
      this.ensureStream({ preserveRetry: true })
    }, delay)
  }

  manualReconnect() {
    this.reconnectGeneration += 1
    this.stopStream()
    this.resetRetryState()
    this.ensureStream({ manual: true })
  }

  async handleSessionExpired(response) {
    const status = response?.status || 0
    const statusText = response?.statusText || ""
    const reason = `MCP HTTP session expired: ${status} ${statusText}`.trim()
    this.markManualReconnect(reason)
    this.sessionId = ""
    this.lastEventId = ""
    this.stopStream()
    try { await response?.body?.cancel?.() } catch {}
    throw new Error(reason)
  }

  async send(message) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS)
    try {
      const response = await fetch(this.serverUrl, {
        method: "POST",
        headers: this.requestHeaders({
          "Content-Type": "application/json",
          Accept: "text/event-stream, application/json",
        }),
        body: JSON.stringify(message),
        signal: controller.signal,
      })
      this.updateSessionId(response)
      this.updateRetryState(response)
      if ((response.status === 400 || response.status === 404) && this.sessionId) {
        await this.handleSessionExpired(response)
      }
      if (!response.ok) {
        throw new Error(`MCP HTTP error: ${response.status} ${response.statusText}`)
      }
      const contentType = String(response.headers.get("content-type") || "").toLowerCase()
      if (contentType.includes("text/event-stream") && response.body) {
        await this.readStreamResponse(response, controller.signal)
        return {}
      }
      if (response.status === 202) return {}
      const text = await response.text()
      if (!text.trim()) return {}
      const json = JSON.parse(text)
      if (json.error) {
        throw new JsonRpcError(json.error.code, json.error.message, json.error.data)
      }
      return json.result
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error(`MCP request timeout: ${message.method}`)
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async sendNotification(message) {
    try {
      await fetch(this.serverUrl, {
        method: "POST",
        headers: this.requestHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(message),
      })
    } catch {
      // notifications are fire-and-forget
    }
  }

  onNotification(listener) {
    if (typeof listener !== "function") return { dispose() {} }
    this.notificationListeners.add(listener)
    this.ensureStream()
    return {
      dispose: () => {
        this.notificationListeners.delete(listener)
        if (this.notificationListeners.size === 0) this.stopStream()
      },
    }
  }

  ensureStream(options = {}) {
    if (!this.streamUrl || this.backchannelDisabled || this.streamPromise || this.streamController || this.disposed) return
    const generation = ++this.reconnectGeneration
    this.streamController = new AbortController()
    if (!options.preserveRetry) this.retryMode = "active"
    this.channelStatus = options.preserveRetry ? "reconnecting" : "connecting"
    const promise = this.readStream(this.streamController.signal).catch((error) => {
      if (this.disposed || this.streamController?.signal?.aborted || error?.name === "AbortError") return
      this.scheduleReconnect(error && error.message ? error.message : String(error), generation)
    }).finally(() => {
      const wasOpen = this.channelStatus === "open"
      if (this.streamPromise === promise) {
        this.streamController = null
        this.streamPromise = null
      }
      if (this.disposed || generation !== this.reconnectGeneration) return
      if (wasOpen) {
        this.channelStatus = "closed"
        this.scheduleReconnect("MCP remote channel disconnected", generation)
      }
    })
    this.streamPromise = promise
  }

  async readStream(signal) {
    const response = await fetch(this.streamUrl, {
      method: this.transportType === "streamable-http" || this.sessionId ? "GET" : "POST",
      headers: this.requestHeaders({
        "Content-Type": "application/json",
        Accept: "text/event-stream, application/x-ndjson, application/json",
      }),
      body: this.transportType === "streamable-http" || this.sessionId
        ? undefined
        : JSON.stringify({ jsonrpc: "2.0", method: "notifications/subscribe", params: {} }),
      signal,
    })
    this.updateSessionId(response)
    this.updateRetryState(response)
    const contentType = String(response.headers.get("content-type") || "").toLowerCase()
    if (!response.ok || !response.body || (!contentType.includes("text/event-stream") && !contentType.includes("ndjson"))) {
      if ((response.status === 400 || response.status === 404) && this.sessionId) {
        await this.handleSessionExpired(response)
      }
      if (response.status >= 400) {
        this.markManualReconnect(`MCP backchannel unavailable: ${response.status} ${response.statusText}`)
      }
      try { await response.body?.cancel?.() } catch {}
      return
    }
    this.retryMode = "active"
    this.channelStatus = "open"
    this.nextRetryAt = 0
    await this.readStreamResponse(response, signal)
  }

  async readStreamResponse(response, signal) {
    const contentType = String(response.headers.get("content-type") || "").toLowerCase()
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        buffer = this.consumeStreamBuffer(buffer, contentType)
        if (buffer.length > MAX_BUFFER_SIZE) buffer = buffer.slice(-MAX_BUFFER_SIZE)
      }
      buffer += decoder.decode()
      this.consumeStreamBuffer(`${buffer}\n\n`, contentType)
    } finally {
      try { reader.releaseLock?.() } catch {}
    }
  }

  consumeStreamBuffer(buffer, contentType) {
    if (contentType.includes("text/event-stream")) {
      const events = buffer.split(/\r?\n\r?\n/)
      const remainder = events.pop() || ""
      for (const event of events) {
        const lines = event.split(/\r?\n/)
        const idLine = lines.find((line) => line.startsWith("id:"))
        const retryLine = lines.find((line) => line.startsWith("retry:"))
        if (idLine) this.lastEventId = idLine.slice(3).trim()
        if (retryLine) {
          this.retryAfter = retryLine.slice(6).trim()
          this.retryAfterSource = "sse"
        }
        const data = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n")
        this.handleStreamPayload(data)
      }
      return remainder
    }
    const lines = buffer.split(/\r?\n/)
    const remainder = lines.pop() || ""
    for (const line of lines) this.handleStreamPayload(line.trim())
    return remainder
  }

  handleStreamPayload(payload) {
    if (!payload || payload === "[DONE]") return
    let message
    try {
      message = JSON.parse(payload)
    } catch {
      return
    }
    if (!isRecord(message) || message.id !== undefined) return
    for (const listener of Array.from(this.notificationListeners)) listener(message)
  }

  stopStream() {
    this.reconnectGeneration += 1
    this.clearReconnectTimer()
    this.streamController?.abort()
    this.streamController = null
    if (this.channelStatus === "connecting" || this.channelStatus === "open") this.channelStatus = "closed"
  }

  async close() {
    this.disposed = true
    this.notificationListeners.clear()
    this.stopStream()
    await this.streamPromise
    this.sessionId = ""
    this.lastEventId = ""
    this.retryMode = "closed"
  }

  getState() {
    return {
      sessionId: this.sessionId,
      backchannelDisabled: this.backchannelDisabled,
      lastEventId: this.lastEventId,
      retryAfter: this.retryAfter,
      retryMode: this.retryMode,
      retryAttempt: this.retryAttempt,
      retryBudget: this.retryBudget,
      lastError: this.lastBackchannelError,
      nextRetryAt: this.nextRetryAt || undefined,
      lastBackchannelError: this.lastBackchannelError,
      channelStatus: this.channelStatus,
      reconnectRequested: this.retryMode === "manual",
      userActionRequired: this.retryMode === "manual",
      noAutoRetry: this.retryMode === "manual",
    }
  }
}

function normalizeDelegateLaunch(launch, definition) {
  const source = isRecord(launch) ? launch : {}
  const type = source.type === 2 || source.transport === "http" ? "http" : "stdio"
  if (type === "http") {
    const url = String(source.url || source.serverUrl || source.uri || "").trim()
    const streamUrl = String(source.streamUrl || source.sseUrl || source.eventSourceUrl || "").trim()
    return {
      serverName: definition.label,
      name: definition.label,
      type: "http",
      transport: "http",
      url,
      serverUrl: url,
      streamUrl: streamUrl || undefined,
      headers: source.headers && !Array.isArray(source.headers) ? { ...source.headers } : headerEntriesToMap(source.headers),
    }
  }
  return {
    serverName: definition.label,
    name: definition.label,
    type: "stdio",
    transport: "stdio",
    command: typeof source.command === "string" ? source.command : "",
    args: Array.isArray(source.args) ? source.args.filter((arg) => typeof arg === "string") : undefined,
    env: stringMap(source.env),
    cwd: typeof source.cwd === "string" && source.cwd.trim() ? source.cwd : undefined,
  }
}

registerMcpDelegate({
  priority: 0,
  async waitForInitialProviderPromises() {},
  canStart(_collection, definition) {
    const launch = definition?.launch
    if (!isRecord(launch)) return false
    if (launch.type === 2 || launch.transport === "http") {
      return Boolean(launch.url || launch.serverUrl || launch.uri)
    }
    return typeof launch.command === "string" && launch.command.trim().length > 0
  },
  async substituteVariables(_definition, launch) {
    return launch
  },
  async start(_collection, definition, launch) {
    const config = normalizeDelegateLaunch(launch, definition)
    if (config.transport === "http") {
      if (!config.url) throw new Error("MCP HTTP server URL is required")
      return new HttpTransport(config)
    }
    if (!config.command) throw new Error("MCP stdio server command is required")
    const transport = new StdioTransport(config)
    await transport.start()
    return transport
  },
})

class McpClient {
  constructor(config) {
    this.serverName = config.serverName
    this.config = config
    this.transport = null
    this.requestId = 0
    this.tools = []
    this.capabilities = null
    this.resourceUpdateListeners = new Set()
    this.transportNotificationDisposable = null
    this.initialized = false
  }

  configure(config) {
    this.serverName = config.serverName
    this.config = config
  }

  async connect() {
    if (this.initialized) return
    this.transport = await resolveMcpConnection(this.config)
    try {
      const initializeResult = await this.sendRequest("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "codek", version: "1.0.0" },
      })
      this.capabilities = initializeResult?.capabilities || null
      this.installNotificationListener()
      await this.sendNotification("notifications/initialized", {})
      await this.discoverTools()
      this.initialized = true
    } catch (error) {
      await this.disconnect()
      if (error && error.code === "MCP_INPUT_REQUIRED") {
        throw error
      }
      throw new Error(`MCP connect failed: ${error && error.message ? error.message : String(error)}`)
    }
  }

  async sendRequest(method, params) {
    if (!this.transport) throw new Error("MCP transport not available")
    const id = ++this.requestId
    return this.transport.send({ jsonrpc: "2.0", id, method, params })
  }

  async sendNotification(method, params) {
    if (!this.transport) return
    await this.transport.sendNotification({ jsonrpc: "2.0", method, params })
  }

  installNotificationListener() {
    this.transportNotificationDisposable?.dispose?.()
    this.transportNotificationDisposable = this.transport && typeof this.transport.onNotification === "function"
      ? this.transport.onNotification((message) => this.handleNotification(message))
      : null
  }

  handleNotification(message) {
    if (!isRecord(message) || message.method !== "notifications/resources/updated") return
    const uri = typeof message.params?.uri === "string" ? message.params.uri.trim() : ""
    if (!uri) return
    for (const listener of Array.from(this.resourceUpdateListeners)) {
      listener({ serverName: this.serverName, uri })
    }
  }

  getTransportState() {
    return this.transport && typeof this.transport.getState === "function"
      ? this.transport.getState()
      : null
  }

  async recoverFromTransportError(error) {
    const message = error && error.message ? String(error.message) : String(error)
    if (!/session expired/i.test(message)) return false
    await this.disconnect()
    return true
  }

  async subscribeResource(uri, listener) {
    if (!this.initialized) throw new Error("MCP client not initialized")
    const resourceUri = typeof uri === "string" ? uri.trim() : ""
    if (!resourceUri) throw new Error("MCP resource uri is required")
    if (!supportsMcpResourceSubscribe(this.capabilities)) {
      const transportState = this.getTransportState() || {}
      return {
        ready: false,
        reason: "MCP server does not advertise resources.subscribe capability.",
        retryMode: transportState.retryMode,
        retryAfter: transportState.retryAfter,
        lastEventId: transportState.lastEventId,
        channelStatus: transportState.channelStatus,
        reconnectRequested: transportState.reconnectRequested === true,
        userActionRequired: transportState.userActionRequired === true,
        noAutoRetry: transportState.noAutoRetry === true,
        dispose: async () => {},
      }
    }
    const wrapped = (event) => {
      if (event.uri === resourceUri) listener(event)
    }
    try {
      await this.sendRequest("resources/subscribe", { uri: resourceUri })
    } catch (error) {
      await this.recoverFromTransportError(error)
      throw error
    }
    this.resourceUpdateListeners.add(wrapped)
    let disposed = false
    return {
      dispose: async () => {
        if (disposed) return
        disposed = true
        this.resourceUpdateListeners.delete(wrapped)
        try {
          await this.sendRequest("resources/unsubscribe", { uri: resourceUri })
        } catch {
          // best-effort cleanup mirrors VS Code's disposable watcher behavior
        }
      },
    }
  }

  async discoverTools() {
    try {
      const response = await this.sendRequest("tools/list", {})
      this.tools = Array.isArray(response?.tools) ? response.tools : []
    } catch (error) {
      if (await this.recoverFromTransportError(error)) throw error
      this.tools = []
    }
  }

  async callTool(toolName, args = {}) {
    if (!this.initialized) throw new Error("MCP client not initialized")
    let response
    try {
      response = await this.sendRequest("tools/call", {
        name: toolName,
        arguments: isRecord(args) ? args : {},
      })
    } catch (error) {
      await this.recoverFromTransportError(error)
      throw error
    }
    return response?.content || response
  }

  async listResources() {
    if (!this.initialized) throw new Error("MCP client not initialized")
    const resources = []
    let cursor
    do {
      const params = cursor ? { cursor } : {}
      let response
      try {
        response = await this.sendRequest("resources/list", params)
      } catch (error) {
        await this.recoverFromTransportError(error)
        throw error
      }
      if (Array.isArray(response?.resources)) resources.push(...response.resources)
      cursor = typeof response?.nextCursor === "string" && response.nextCursor ? response.nextCursor : null
    } while (cursor)
    return resources
  }

  async listResourceTemplates() {
    if (!this.initialized) throw new Error("MCP client not initialized")
    let response
    try {
      response = await this.sendRequest("resources/templates/list", {})
    } catch (error) {
      await this.recoverFromTransportError(error)
      throw error
    }
    return Array.isArray(response?.resourceTemplates) ? response.resourceTemplates : []
  }

  async readResource(uri) {
    if (!this.initialized) throw new Error("MCP client not initialized")
    const resourceUri = typeof uri === "string" ? uri.trim() : ""
    if (!resourceUri) throw new Error("MCP resource uri is required")
    let response
    try {
      response = await this.sendRequest("resources/read", { uri: resourceUri })
    } catch (error) {
      await this.recoverFromTransportError(error)
      throw error
    }
    return response?.contents || response
  }

  async complete(params = {}) {
    if (!this.initialized) throw new Error("MCP client not initialized")
    let response
    try {
      response = await this.sendRequest("completion/complete", params)
    } catch (error) {
      await this.recoverFromTransportError(error)
      throw error
    }
    return response?.completion || { values: [] }
  }

  getToolDefinitions() {
    return this.tools.map((tool) => ({
      name: tool.name,
      description: tool.description || "",
      arguments: tool.inputSchema?.properties || {},
      inputSchema: tool.inputSchema || null,
    }))
  }

  async disconnect() {
    this.initialized = false
    this.tools = []
    this.capabilities = null
    this.resourceUpdateListeners.clear()
    this.transportNotificationDisposable?.dispose?.()
    this.transportNotificationDisposable = null
    if (this.transport) {
      await this.transport.close()
      this.transport = null
    }
  }
}

function registerMcpServer(config, options = {}) {
  const serverName = String(config?.serverName || config?.name || "mcp-server").trim() || "mcp-server"
  let client = clientRegistry.get(serverName)
  const normalized = { ...config, serverName }
  if (!client) {
    client = new McpClient(normalized)
    clientRegistry.set(serverName, client)
  } else {
    client.configure(normalized)
  }
  if (options.profileScoped) profileClientNames.add(serverName)
  if (options.workspaceScoped) workspaceClientNames.add(serverName)
  if (options.installedScoped) installedClientNames.add(serverName)
  if (options.extensionScoped) extensionClientNames.add(serverName)
  if (options.collectionId) {
    const collectionId = String(options.collectionId).trim()
    if (collectionId) {
      mcpRegistryService.addServerToCollection(collectionId, serverName)
    }
  }
  return client
}

function findMcpCollectionForServer(serverName) {
  return mcpRegistryService.getCollectionForServer(serverName)
}

function toMcpServerDefinition(config) {
  return {
    id: String(config.definitionId || config.serverName || config.name || "mcp-server"),
    label: String(config.originalName || config.serverName || config.name || "mcp-server"),
    cacheNonce: config.cacheNonce,
    inputs: Array.isArray(config.inputs) ? config.inputs.map((input) => ({ ...input })) : undefined,
    launch: {
      type: config.transport === "http" ? 2 : 1,
      transport: config.transport,
      command: config.command,
      args: Array.isArray(config.args) ? [...config.args] : undefined,
      env: config.env ? { ...config.env } : undefined,
      cwd: config.cwd,
      uri: config.url || config.serverUrl,
      url: config.url || config.serverUrl,
      serverUrl: config.serverUrl || config.url,
      streamUrl: config.streamUrl,
      headers: config.headers ? { ...config.headers } : undefined,
    },
  }
}

async function waitForInitialMcpProviders() {
  await Promise.all(mcpRegistryService.getDelegates().map((delegate) => delegate.waitForInitialProviderPromises()))
}

async function resolveMcpConnection(config, options = {}) {
  const serverName = String(config?.serverName || config?.name || "").trim()
  if (!serverName) throw new Error("MCP server name is required")
  await waitForInitialMcpProviders()
  const collection = findMcpCollectionForServer(serverName) || {
    id: config.collectionId || "adhoc",
    label: config.sourceLabel || config.source || "MCP",
    source: config.source,
    scope: config.workspaceScoped ? "workspace" : config.extensionId ? "extension" : "profile",
  }
  const definition = toMcpServerDefinition(config)
  const delegate = mcpRegistryService.getDelegates().find((candidate) => candidate.canStart(collection, definition))
  if (!delegate) {
    throw new Error(`No MCP delegate can start server: ${serverName}`)
  }
  const launch = await delegate.substituteVariables(definition, definition.launch)
  const missingInputs = getUnresolvedMcpInputMetadata(definition, launch)
  if (missingInputs.length) {
    throw new McpInputRequiredError(serverName, missingInputs)
  }
  return delegate.start(collection, definition, launch, options)
}

async function clearProfileMcpServers() {
  const names = [...profileClientNames]
  profileClientNames.clear()
  for (const name of names) {
    const client = clientRegistry.get(name)
    if (client) {
      await client.disconnect()
      clientRegistry.delete(name)
    }
  }
  await mcpRegistryService.clearCollection("profile")
}

async function clearWorkspaceMcpServers() {
  const names = [...workspaceClientNames]
  workspaceClientNames.clear()
  for (const name of names) {
    const client = clientRegistry.get(name)
    if (client) {
      await client.disconnect()
      clientRegistry.delete(name)
    }
  }
  await mcpRegistryService.clearCollection("workspace")
}

async function clearInstalledMcpServers() {
  const names = [...installedClientNames]
  installedClientNames.clear()
  for (const name of names) {
    const client = clientRegistry.get(name)
    if (client) {
      await client.disconnect()
      clientRegistry.delete(name)
    }
  }
  await mcpRegistryService.clearCollection("installed")
}

async function clearMcpClientNames(names) {
  for (const name of names) {
    profileClientNames.delete(name)
    workspaceClientNames.delete(name)
    installedClientNames.delete(name)
    extensionClientNames.delete(name)
    mcpRegistryService.removeServer(name)
    const client = clientRegistry.get(name)
    if (client) {
      await client.disconnect()
      clientRegistry.delete(name)
    }
  }
}

async function clearExtensionMcpCollection(collectionId) {
  const id = String(collectionId || "").trim()
  if (!id) return
  const names = extensionCollectionClientNames.get(id)
  extensionCollectionClientNames.delete(id)
  if (names) await clearMcpClientNames(names)
  await clearMcpCollection(id)
}

async function clearExtensionMcpServers() {
  const names = [...extensionClientNames]
  extensionCollectionClientNames.clear()
  extensionClientNames.clear()
  await clearMcpClientNames(names)
}

async function applyProfileMcpServers(servers = [], key = "") {
  await clearProfileMcpServers()
  registerMcpCollection({
    id: "profile",
    label: "Profile MCP",
    source: "profile",
    scope: "profile",
    order: 0,
  }, { replace: true })
  for (const server of servers) {
    registerMcpServer(server, { profileScoped: true, collectionId: "profile" })
  }
  activeProfileKey = key
  return listConfiguredMcpServers().filter((server) => server.profileScoped)
}

async function applyWorkspaceMcpServers(servers = [], key = "") {
  await clearWorkspaceMcpServers()
  registerMcpCollection({
    id: "workspace",
    label: "Workspace MCP",
    source: "workspace",
    scope: "workspace",
    order: 10,
  }, { replace: true })
  const registered = []
  for (const server of servers) {
    const resolved = chooseWorkspaceServerName(server)
    registerMcpServer(resolved, { workspaceScoped: true, collectionId: "workspace" })
    registered.push(resolved)
  }
  activeWorkspaceKey = key
  return registered
}

function extensionMcpResourceContent(record) {
  if (!isRecord(record) || record.enabled === false) return ""
  const direct = isRecord(record.mcp) ? record.mcp : null
  const fromManifest = isRecord(record.manifest) && isRecord(record.manifest.contributes)
    ? record.manifest.contributes.mcp
    : undefined
  const resource = direct || fromManifest
  return resource ? JSON.stringify(resource) : ""
}

function installedGalleryServers(record) {
  try {
    return {
      servers: getInstallableMcpServersFromInstalledRecord(record)
        .map((server) => normalizeServerConfig(server.name, server))
        .filter(Boolean),
      errors: [],
    }
  } catch (error) {
    return {
      servers: [],
      errors: [error && error.message ? error.message : String(error)],
    }
  }
}

function installedServerCollisionSuffix(server) {
  const extensionId = String(server.extensionId || "").split(".").filter(Boolean).pop()
  return extensionId ? `installed-${extensionId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}` : "installed"
}

function chooseInstalledServerName(server) {
  const originalName = String(server.serverName || server.name || "mcp-server").trim() || "mcp-server"
  if (!clientRegistry.has(originalName)) {
    return { ...server, serverName: originalName, name: originalName, originalName }
  }
  const suffix = installedServerCollisionSuffix(server)
  let candidate = `${originalName}@${suffix}`
  let index = 2
  while (clientRegistry.has(candidate)) {
    candidate = `${originalName}@${suffix}-${index}`
    index += 1
  }
  return { ...server, serverName: candidate, name: candidate, originalName }
}

async function discoverInstalledMcpServers(projectRoot, options = {}) {
  const errors = []
  const sources = []
  const servers = []
  const keyParts = [normalizeProjectRoot(projectRoot), options.mcpAccess || "all", "installed-mcp"]
  const records = extensionInstallState.listExtensionInstallStates({ filePath: installedMcpStatePath })
  for (const record of records) {
    if (!record || record.enabled === false || (record.status && record.status === "failed")) continue
    const galleryResult = installedGalleryServers(record)
    errors.push(...galleryResult.errors.map((message) => `${record.id || "installed"}: ${message}`))
    const galleryServers = galleryResult.servers
    const content = extensionMcpResourceContent(record)
    if (!content && !galleryServers.length) continue
    keyParts.push(record.id || "", content, JSON.stringify(galleryServers))
    const parsed = content ? parseMcpProfileResource(content) : { servers: [], errors: [] }
    errors.push(...parsed.errors.map((message) => `${record.id || "installed"}: ${message}`))
    const parsedServers = [...galleryServers, ...parsed.servers]
    if (!parsedServers.length) continue
    const source = {
      source: "installed-mcp",
      label: "Installed MCP Servers",
      path: record.installPath || "",
      serverCount: parsedServers.length,
      extensionId: record.id || "",
    }
    sources.push(source)
    servers.push(...parsedServers.map((server) => ({
      ...server,
      source: source.source,
      sourceLabel: source.label,
      sourcePath: source.path,
      extensionId: source.extensionId,
      installedScoped: true,
    })))
  }
  return {
    key: keyParts.join("\0"),
    servers,
    sources,
    errors,
  }
}

async function applyInstalledMcpServers(servers = [], key = "") {
  await clearInstalledMcpServers()
  registerMcpCollection({
    id: "installed",
    label: "Installed MCP Servers",
    source: "installed-mcp",
    scope: "installed",
    order: 15,
  }, { replace: true })
  const registered = []
  for (const server of servers) {
    const resolved = chooseInstalledServerName(server)
    registerMcpServer(resolved, { installedScoped: true, collectionId: "installed" })
    registered.push(resolved)
  }
  return registered
}

function listWorkspaceMcpServerConfigs() {
  return [...workspaceClientNames]
    .map((name) => clientRegistry.get(name)?.config)
    .filter(Boolean)
    .map((config) => ({ ...config }))
}

function reviveUriComponents(uri) {
  if (!uri || typeof uri !== "object") return ""
  const scheme = String(uri.scheme || "").trim()
  const authority = String(uri.authority || "").trim()
  const rawPath = String(uri.path || uri.fsPath || "").trim()
  const query = String(uri.query || "").trim()
  const fragment = String(uri.fragment || "").trim()
  if (!scheme) return rawPath
  const pathPart = rawPath && !rawPath.startsWith("/") && authority ? `/${rawPath}` : rawPath
  const queryPart = query ? `?${query}` : ""
  const fragmentPart = fragment ? `#${fragment}` : ""
  if (authority) return `${scheme}://${authority}${pathPart}${queryPart}${fragmentPart}`
  return `${scheme}:${pathPart}${queryPart}${fragmentPart}`
}

function headerEntriesToMap(headers) {
  if (!Array.isArray(headers)) return undefined
  const entries = headers
    .filter((entry) => Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string")
    .map(([key, value]) => [key, value])
  return entries.length ? Object.fromEntries(entries) : undefined
}

function normalizeExtensionMcpCollection(collection) {
  if (!isRecord(collection)) return null
  const id = typeof collection.id === "string" && collection.id.trim() ? collection.id.trim() : ""
  const label = typeof collection.label === "string" && collection.label.trim() ? collection.label.trim() : id
  const extensionId = typeof collection.extensionId === "string" && collection.extensionId.trim()
    ? collection.extensionId.trim()
    : ""
  if (!id || !label) return null
  return {
    id,
    label,
    extensionId,
    source: extensionId ? `extension:${extensionId}` : "extension-mcp",
  }
}

function normalizeExtensionMcpServerDefinition(definition, collection) {
  if (!isRecord(definition) || !isRecord(definition.launch)) return null
  const launch = definition.launch
  const label = String(definition.label || definition.id || "mcp-server").trim() || "mcp-server"
  const base = {
    serverName: label,
    name: label,
    source: collection.source,
    sourceLabel: collection.label,
    extensionId: collection.extensionId || undefined,
    collectionId: collection.id,
    definitionId: typeof definition.id === "string" ? definition.id : undefined,
    cacheNonce: typeof definition.cacheNonce === "string" ? definition.cacheNonce : undefined,
  }
  if (launch.type === 2) {
    const url = reviveUriComponents(launch.uri)
    if (!url) return null
    return {
      ...base,
      type: "http",
      transport: "http",
      url,
      serverUrl: url,
      headers: headerEntriesToMap(launch.headers),
    }
  }
  if (launch.type === 1) {
    const command = typeof launch.command === "string" ? launch.command.trim() : ""
    if (!command) return null
    return {
      ...base,
      type: "stdio",
      transport: "stdio",
      command,
      args: Array.isArray(launch.args) ? launch.args.filter((arg) => typeof arg === "string") : undefined,
      env: stringMap(launch.env),
      cwd: typeof launch.cwd === "string" && launch.cwd.trim() ? launch.cwd : undefined,
      envFile: typeof launch.envFile === "string" && launch.envFile.trim() ? launch.envFile : undefined,
    }
  }
  return null
}

function extensionCollisionSuffix(server) {
  const extensionId = String(server.extensionId || "").split(".").filter(Boolean).pop()
  return extensionId ? `extension-${extensionId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}` : "extension"
}

function chooseExtensionServerName(server) {
  const originalName = String(server.serverName || server.name || "mcp-server").trim() || "mcp-server"
  if (!clientRegistry.has(originalName)) {
    return { ...server, serverName: originalName, name: originalName, originalName }
  }
  const suffix = extensionCollisionSuffix(server)
  let candidate = `${originalName}@${suffix}`
  let index = 2
  while (clientRegistry.has(candidate)) {
    candidate = `${originalName}@${suffix}-${index}`
    index += 1
  }
  return { ...server, serverName: candidate, name: candidate, originalName }
}

async function applyExtensionMcpCollection(collection, serverDefinitions = [], options = {}) {
  const normalizedCollection = normalizeExtensionMcpCollection(collection)
  if (!normalizedCollection) throw new Error("invalid extension MCP collection")
  await clearExtensionMcpCollection(normalizedCollection.id)
  const mcpAccess = options.mcpAccess || "all"
  if (mcpAccess !== "all") {
    return {
      collection: normalizedCollection,
      servers: [],
      skipped: true,
      reason: `chat.mcp.access=${mcpAccess}`,
    }
  }
  registerMcpCollection({
    ...normalizedCollection,
    scope: "extension",
    order: 20,
    lazy: options.lazy,
  }, { replace: true })
  const names = new Set()
  const registered = []
  for (const definition of Array.isArray(serverDefinitions) ? serverDefinitions : []) {
    const server = normalizeExtensionMcpServerDefinition(definition, normalizedCollection)
    if (!server) continue
    const resolved = chooseExtensionServerName(server)
    registerMcpServer(resolved, { extensionScoped: true, collectionId: normalizedCollection.id })
    names.add(resolved.serverName)
    registered.push(resolved)
  }
  if (names.size > 0) extensionCollectionClientNames.set(normalizedCollection.id, names)
  return {
    collection: normalizedCollection,
    servers: registered,
    skipped: false,
  }
}

async function applyWorkspaceMcpServersFromProject(projectRoot, options = {}) {
  const discovered = await discoverWorkspaceMcpServers(projectRoot, options)
  const inputMap = options.inputMap || {}
  const key = `${discovered.key}\0${stableMcpInputKey(inputMap)}`
  if (key === activeWorkspaceKey) {
    return { ...discovered, servers: listWorkspaceMcpServerConfigs(), reused: true }
  }
  const servers = discovered.servers.map((server) => resolveProjectServerConfig(server, projectRoot, { inputs: inputMap }))
  const registered = await applyWorkspaceMcpServers(servers, key)
  return { ...discovered, servers: registered, reused: false }
}

async function applyActiveProfileFromProject(projectRoot, options = {}) {
  const { activeProfileId, resource } = getActiveProfileResource(projectRoot)
  const mcpAccess = options.mcpAccess || "all"
  const inputMap = await readMcpInputMap(activeProfileId)
  const inputKey = stableMcpInputKey(inputMap)
  const key = `${projectRoot || ""}\0${activeProfileId}\0${resource || ""}\0${inputKey}`
  let profileResult
  if (key === activeProfileKey) {
    const parsed = parseMcpProfileResource(resource)
    const servers = parsed.servers.map((server) => resolveProjectServerConfig(server, projectRoot, { inputs: inputMap }))
    profileResult = {
      activeProfileId,
      reused: true,
      ...parsed,
      servers,
    }
  } else {
    const parsed = parseMcpProfileResource(resource)
    const servers = parsed.servers.map((server) => resolveProjectServerConfig(server, projectRoot, { inputs: inputMap }))
    await applyProfileMcpServers(servers, key)
    profileResult = { activeProfileId, reused: false, ...parsed, servers }
  }
  const installedResult = await discoverInstalledMcpServers(projectRoot, { mcpAccess })
  const installedServers = installedResult.servers.map((server) => resolveProjectServerConfig(server, projectRoot, { inputs: inputMap }))
  const installedKey = `${installedResult.key}\0${inputKey}`
  const registeredInstalledServers = mcpAccess === "none" ? [] : await applyInstalledMcpServers(installedServers, installedKey)
  const workspaceResult = await applyWorkspaceMcpServersFromProject(projectRoot, {
    mcpAccess,
    inputMap,
    workspaceFile: options.workspaceFile,
    workspaceResource: options.workspaceResource,
    mcpResourcePath: options.mcpResourcePath,
    resourcePath: options.resourcePath,
  })
  return {
    ...profileResult,
    reused: profileResult.reused && workspaceResult.reused,
    profileReused: profileResult.reused,
    workspaceReused: workspaceResult.reused,
    workspaceServers: workspaceResult.servers,
    workspaceSources: workspaceResult.sources,
    installedServers: registeredInstalledServers,
    installedSources: installedResult.sources,
    errors: [...(profileResult.errors || []), ...(installedResult.errors || []), ...(workspaceResult.errors || [])],
  }
}

function listConfiguredMcpServers() {
  return [...clientRegistry.values()].map((client) => ({
    serverName: client.serverName,
    initialized: client.initialized,
    capabilities: sanitizeMcpCapabilities(client.capabilities),
    transportState: client.getTransportState(),
    profileScoped: profileClientNames.has(client.serverName),
    workspaceScoped: workspaceClientNames.has(client.serverName),
    installedScoped: installedClientNames.has(client.serverName),
    extensionScoped: extensionClientNames.has(client.serverName),
    ...toAllowedState(client.config),
    config: redactedConfig(client.config),
    tools: client.getToolDefinitions(),
  }))
}

function sanitizeMcpCapabilities(capabilities) {
  return isRecord(capabilities) ? JSON.parse(JSON.stringify(capabilities)) : null
}

function supportsMcpResourceSubscribe(capabilities) {
  if (!isRecord(capabilities?.resources)) return false
  return capabilities.resources.subscribe === true || capabilities.resources.subscribe === {}
}

async function connectMcpServer(serverName) {
  const client = clientRegistry.get(serverName)
  if (!client) throw new Error(`MCP server not configured: ${serverName}`)
  const allowed = toAllowedState(client.config)
  if (!allowed.allowed) throw new Error(allowed.disabledReason)
  await client.connect()
  return client
}

async function disconnectMcpServer(serverName) {
  const client = clientRegistry.get(serverName)
  if (!client) throw new Error(`MCP server not configured: ${serverName}`)
  await client.disconnect()
  return client
}

async function restartMcpServer(serverName) {
  const client = clientRegistry.get(serverName)
  if (!client) throw new Error(`MCP server not configured: ${serverName}`)
  await client.disconnect()
  return connectMcpServer(serverName)
}

async function listMcpTools() {
  const tools = []
  for (const client of clientRegistry.values()) {
    if (!client.initialized) continue
    tools.push(...client.getToolDefinitions().map((tool) => ({
      ...tool,
      serverName: client.serverName,
      qualifiedName: `${client.serverName}.${tool.name}`,
    })))
  }
  return tools
}

async function listMcpResources(serverName) {
  const client = await connectMcpServer(serverName)
  return client.listResources()
}

async function listMcpResourceTemplates(serverName) {
  const client = await connectMcpServer(serverName)
  return client.listResourceTemplates()
}

async function readMcpResource(serverName, uri) {
  const client = await connectMcpServer(serverName)
  return client.readResource(uri)
}

async function subscribeMcpResource(serverName, uri, listener) {
  const client = await connectMcpServer(serverName)
  return client.subscribeResource(uri, typeof listener === "function" ? listener : () => {})
}

async function completeMcpResourceTemplate(serverName, request = {}) {
  const client = await connectMcpServer(serverName)
  const uri = typeof request.uriTemplate === "string" ? request.uriTemplate.trim() : ""
  const variable = typeof request.variable === "string" ? request.variable.trim() : ""
  const value = typeof request.value === "string" ? request.value : ""
  const context = isRecord(request.context) ? request.context : {}
  if (!uri) throw new Error("MCP resource template uri is required")
  if (!variable) throw new Error("MCP resource template variable is required")
  return client.complete({
    ref: { type: "ref/resource", uri },
    argument: { name: variable, value },
    context: {
      arguments: Object.fromEntries(Object.entries(context).map(([key, item]) => [
        key,
        Array.isArray(item) ? item.join("/") : String(item ?? ""),
      ])),
    },
  })
}

async function callMcpTool(serverName, toolName, args = {}) {
  const client = await connectMcpServer(serverName)
  return client.callTool(toolName, args)
}

module.exports = {
  applyActiveProfileFromProject,
  applyExtensionMcpCollection,
  applyInstalledMcpServers,
  applyProfileMcpServers,
  applyWorkspaceMcpServersFromProject,
  callMcpTool,
  clearExtensionMcpCollection,
  clearExtensionMcpServers,
  clearInstalledMcpServers,
  clearProfileMcpServers,
  clearWorkspaceMcpServers,
  discoverInstalledMcpServers,
  connectMcpServer,
  disconnectMcpServer,
  discoverWorkspaceMcpServers,
  getActiveProfileResource,
  listMcpDiscoverySources,
  listMcpCollections,
  listConfiguredMcpServers,
  listMcpResources,
  listMcpResourceTemplates,
  listMcpTools,
  completeMcpResourceTemplate,
  parseMcpProfileResource,
  onDidChangeMcpCollections,
  registerMcpDelegate,
  registerMcpDiscoverySource,
  registerMcpCollection,
  registerMcpServer,
  readMcpResource,
  subscribeMcpResource,
  restartMcpServer,
  clearMcpCollection,
  listMcpDelegates,
  resetMcpDiscoverySourcesForTest,
  resolveMcpConnection,
  resolveProjectServerConfig,
}
