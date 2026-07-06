/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code MainThreadMcp:
 * - D:\SourceMirror\vscode\src\vs\workbench\api\browser\mainThreadMcp.ts
 * - D:\SourceMirror\vscode\src\vs\workbench\api\common\extHostMcp.ts
 *--------------------------------------------------------------------------------------------*/

const {
  applyExtensionMcpCollection,
  clearExtensionMcpCollection,
  clearExtensionMcpServers,
  listConfiguredMcpServers,
  registerMcpDelegate,
} = require("../../mcp/profileMcpAdapter")
const { getMcpAccessValue } = require("../../mcp/mcpAccess")

const EXT_HOST_MCP_NID = 158
let nextMcpServerId = 1
const extensionHostTransports = new Map()

function register(server, opts = {}) {
  const callEh = typeof opts.callEh === "function"
    ? opts.callEh
    : (nid, method, args, timeoutMs) => server.call(nid, method, args, timeoutMs)

  const delegate = registerMcpDelegate({
    priority: 1,
    waitForInitialProviderPromises: () => callEh(EXT_HOST_MCP_NID, "$waitForInitialCollectionProviders", [], 30000),
    canStart(collection) {
      return collection?.scope === "extension"
    },
    substituteVariables: async (_definition, launch) => {
      return callEh(EXT_HOST_MCP_NID, "$substituteVariables", [undefined, launch], 30000)
        .then((resolved) => resolved || launch)
    },
    start: async (_collection, definition, launch, options = {}) => {
      const id = nextMcpServerId++
      const transport = new ExtensionHostMcpTransport(id, definition, callEh)
      extensionHostTransports.set(id, transport)
      await callEh(EXT_HOST_MCP_NID, "$startMcp", [id, {
        launch,
        defaultCwd: undefined,
        errorOnUserInteraction: !!options.errorOnUserInteraction,
      }], 30000)
      return transport
    },
  })

  server.onRpc("$upsertMcpCollection", async (args) => {
    const [collection, servers] = args || []
    const mcpAccess = getMcpAccessValue()
    const resolvedServers = mcpAccess === "all"
      ? await resolveServerDefinitions(collection, servers, callEh)
      : servers
    const result = await applyExtensionMcpCollection(collection, resolvedServers, { mcpAccess })
    await publishServerDefinitions(callEh)
    return result
  })

  server.onRpc("$deleteMcpCollection", async (args) => {
    const [collectionId] = args || []
    await clearExtensionMcpCollection(collectionId)
    await publishServerDefinitions(callEh)
    return undefined
  })

  server.onRpc("$onDidChangeState", (args) => {
    const [id, state] = args || []
    extensionHostTransports.get(Number(id))?.setState(state)
    return undefined
  })
  server.onRpc("$onDidPublishLog", (args) => {
    const [id, level, message] = args || []
    extensionHostTransports.get(Number(id))?.pushLog(level, message)
    return undefined
  })
  server.onRpc("$onDidReceiveMessage", (args) => {
    const [id, message] = args || []
    extensionHostTransports.get(Number(id))?.pushMessage(message)
    return undefined
  })
  server.onRpc("$getTokenForProviderId", () => undefined)
  server.onRpc("$getTokenFromServerMetadata", () => undefined)
  server.onRpc("$logMcpAuthSetup", () => undefined)
  server.onRpc("$startMcpGateway", () => undefined)
  server.onRpc("$disposeMcpGateway", () => undefined)

  const clear = () => {
    delegate.dispose()
    for (const [id, transport] of extensionHostTransports) {
      transport.forceClose()
      extensionHostTransports.delete(id)
    }
    clearExtensionMcpServers().catch?.(() => undefined)
  }
  if (typeof server.on === "function") {
    server.on("stopped", clear)
    server.on("exit", clear)
  }
}

class ExtensionHostMcpTransport {
  constructor(id, definition, callEh) {
    this.id = id
    this.definition = definition
    this.callEh = callEh
    this.callbacks = new Map()
    this.closed = false
  }

  setState(state) {
    if (!state || typeof state !== "object") return
    if (state.state === "stopped" || state.state === 3 || state.state === "error" || state.state === 4) {
      this.forceClose(new Error(state.message || `MCP extension host server stopped: ${this.definition.label}`))
    }
  }

  pushLog() {}

  pushMessage(raw) {
    if (this.closed) return
    let parsed
    try {
      parsed = typeof raw === "string" ? JSON.parse(raw) : raw
    } catch {
      return
    }
    const messages = Array.isArray(parsed) ? parsed : [parsed]
    for (const message of messages) {
      if (!message || message.id === undefined || !this.callbacks.has(message.id)) continue
      const callback = this.callbacks.get(message.id)
      this.callbacks.delete(message.id)
      clearTimeout(callback.timer)
      if (message.error) {
        callback.reject(new Error(message.error.message || "MCP extension host transport error"))
      } else {
        callback.resolve(message.result)
      }
    }
  }

  send(message) {
    if (this.closed) return Promise.reject(new Error("MCP extension host transport closed"))
    const id = message.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.callbacks.delete(id)) {
          reject(new Error(`MCP request timeout: ${message.method}`))
        }
      }, 10000)
      this.callbacks.set(id, { resolve, reject, timer })
      Promise.resolve(this.callEh(EXT_HOST_MCP_NID, "$sendMessage", [this.id, JSON.stringify(message)], 10000))
        .catch((error) => {
          if (this.callbacks.delete(id)) {
            clearTimeout(timer)
            reject(error)
          }
        })
    })
  }

  sendNotification(message) {
    if (this.closed) return
    void this.callEh(EXT_HOST_MCP_NID, "$sendMessage", [this.id, JSON.stringify(message)], 10000)
  }

  async close() {
    this.forceClose()
    extensionHostTransports.delete(this.id)
    await this.callEh(EXT_HOST_MCP_NID, "$stopMcp", [this.id], 10000)
  }

  forceClose(error) {
    this.closed = true
    for (const callback of this.callbacks.values()) {
      clearTimeout(callback.timer)
      callback.reject(error || new Error("MCP extension host transport closed"))
    }
    this.callbacks.clear()
  }
}

async function resolveServerDefinitions(collection, servers, callEh) {
  if (!collection?.canResolveLaunch || !Array.isArray(servers)) return servers
  const resolved = []
  for (const definition of servers) {
    if (hasUsableLaunch(definition?.launch) || !definition?.label) {
      resolved.push(definition)
      continue
    }
    const launch = await callEh(EXT_HOST_MCP_NID, "$resolveMcpLaunch", [collection.id, definition.label], 30000)
    resolved.push(launch ? { ...definition, launch } : definition)
  }
  return resolved
}

function hasUsableLaunch(launch) {
  if (!launch || typeof launch !== "object") return false
  if (launch.type === 1) return typeof launch.command === "string" && launch.command.trim().length > 0
  if (launch.type === 2) return Boolean(launch.uri)
  return false
}

async function publishServerDefinitions(callEh) {
  const definitions = listConfiguredMcpServers()
    .map((server) => serializeConfiguredServer(server.config))
    .filter(Boolean)
  await callEh(EXT_HOST_MCP_NID, "$onDidChangeMcpServerDefinitions", [definitions], 30000)
}

function serializeConfiguredServer(config) {
  if (!config || typeof config !== "object") return null
  const id = String(config.definitionId || config.serverName || "mcp-server").trim()
  const label = String(config.originalName || config.serverName || "mcp-server").trim()
  if (!id || !label) return null
  const launch = serializeLaunch(config)
  if (!launch) return null
  return {
    id,
    label,
    cacheNonce: typeof config.cacheNonce === "string" ? config.cacheNonce : "$$NONE",
    launch,
  }
}

function serializeLaunch(config) {
  if (config.transport === "http" || config.type === "http") {
    const uri = parseUriComponents(config.url || config.serverUrl)
    if (!uri) return null
    return {
      type: 2,
      uri,
      headers: [],
    }
  }
  if (config.transport === "stdio" || config.type === "stdio") {
    const command = typeof config.command === "string" ? config.command.trim() : ""
    if (!command) return null
    return {
      type: 1,
      command,
      args: Array.isArray(config.args) ? config.args.filter((arg) => typeof arg === "string") : [],
      cwd: typeof config.cwd === "string" ? config.cwd : undefined,
      env: {},
      envFile: undefined,
      sandbox: undefined,
    }
  }
  return null
}

function parseUriComponents(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null
  try {
    const parsed = new URL(raw)
    return {
      scheme: parsed.protocol.replace(/:$/, ""),
      authority: parsed.host,
      path: parsed.pathname,
      query: parsed.search ? parsed.search.slice(1) : "",
      fragment: parsed.hash ? parsed.hash.slice(1) : "",
    }
  } catch {
    return null
  }
}

module.exports = {
  EXT_HOST_MCP_NID,
  register,
  resolveServerDefinitions,
  serializeConfiguredServer,
}
