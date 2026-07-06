const MCP_TIMEOUT_MS = 10_000
const MAX_BUFFER_SIZE = 10 * 1024 * 1024

let globalClient = null
const clientRegistry = new Map()
const profileClientNames = new Set()

class JsonRpcError extends Error {
  constructor(code, message, data) {
    super(message)
    this.name = "JsonRpcError"
    this.code = code
    this.data = data
  }
}

class StdioTransport {
  constructor(command, args, env, cwd) {
    this.command = command
    this.args = args || []
    const baseEnv = typeof process !== "undefined" && process?.env ? process.env : {}
    this.env = { ...baseEnv, ...(env || {}) }
    this.cwd = cwd
    this.process = null
    this.buffer = ""
    this.messageCallbacks = new Map()
    this.nextCallbackId = 0
    this.readLoopRunning = false
  }

  async start() {
    if (typeof window !== "undefined" && window.codek?.spawnProcess) {
      this.process = await window.codek.spawnProcess(this.command, this.args, {
        cwd: this.cwd,
        env: this.env,
        onStdout: (chunk) => this._handleData(chunk),
        onStderr: () => {},
        onExit: () => this._handleClose(),
      })
    } else {
      this.process = { pid: -1, command: this.command, args: this.args }
    }
  }

  _handleData(chunk) {
    this.buffer += chunk
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer = this.buffer.slice(-MAX_BUFFER_SIZE)
    }

    const lines = this.buffer.split("\n")
    this.buffer = lines.pop() || ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const message = JSON.parse(trimmed)
        if (message.id !== undefined && this.messageCallbacks.has(message.id)) {
          const cb = this.messageCallbacks.get(message.id)
          this.messageCallbacks.delete(message.id)
          if (message.error) {
            cb.reject(new JsonRpcError(message.error.code, message.error.message, message.error.data))
          } else {
            cb.resolve(message.result)
          }
        }
      } catch {
        // skip non-JSON lines
      }
    }
  }

  _handleClose() {
    for (const [, cb] of this.messageCallbacks) {
      cb.reject(new Error("MCP server process closed"))
    }
    this.messageCallbacks.clear()
  }

  async send(message) {
    if (!this.process) {
      throw new Error("Transport not started")
    }

    return new Promise((resolve, reject) => {
      const idField = message.id !== undefined ? message.id : ++this.nextCallbackId
      this.messageCallbacks.set(idField, { resolve, reject })

      const msg = { ...message, id: idField }
      const raw = JSON.stringify(msg) + "\n"

      if (typeof window !== "undefined" && window.codek?.writeStdin) {
        window.codek.writeStdin(this.process.id || this.process.processId || this.process.pid, raw)
      }

      setTimeout(() => {
        if (this.messageCallbacks.has(idField)) {
          this.messageCallbacks.delete(idField)
          reject(new Error(`MCP request timeout: ${message.method}`))
        }
      }, MCP_TIMEOUT_MS)
    })
  }

  sendNotification(message) {
    const raw = JSON.stringify({ ...message, id: undefined }) + "\n"
    if (typeof window !== "undefined" && window.codek?.writeStdin) {
      window.codek.writeStdin(this.process.id || this.process.processId || this.process.pid, raw)
    }
  }

  async close() {
    this.messageCallbacks.clear()
    if (typeof window !== "undefined" && window.codek?.killProcess) {
      window.codek.killProcess(this.process.id || this.process.processId || this.process.pid)
    }
    this.process = null
  }
}

class HttpTransport {
  constructor(serverUrl, headers) {
    this.serverUrl = serverUrl.replace(/\/+$/, "")
    this.headers = headers || {}
  }

  async send(message) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS)

    try {
      const response = await fetch(this.serverUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...this.headers,
        },
        body: JSON.stringify(message),
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (!response.ok) {
        throw new Error(`MCP HTTP error: ${response.status} ${response.statusText}`)
      }

      const result = await response.json()
      if (result.error) {
        throw new JsonRpcError(result.error.code, result.error.message, result.error.data)
      }
      return result.result
    } catch (err) {
      clearTimeout(timer)
      if (err.name === "AbortError") {
        throw new Error(`MCP request timeout: ${message.method}`)
      }
      throw err
    }
  }

  async sendNotification(message) {
    try {
      await fetch(this.serverUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers },
        body: JSON.stringify(message),
      })
    } catch {
      // notifications are fire-and-forget
    }
  }

  async close() {}
}

export class McpClient {
  constructor(options = {}) {
    this.serverName = options.serverName || "unknown"
    this.transport = null
    this.requestId = 0
    this.tools = []
    this.toolDefs = []
    this._initialized = false
    this._config = null
  }

  configureMcpServer(config) {
    this.serverName = config.serverName || config.name || this.serverName
    this._config = { ...config, serverName: this.serverName }
  }

  async connect(command, args = [], options = {}) {
    if (this._initialized) return

    const configured = this._config || {}
    const requested = { ...configured, ...options }
    const transport = requested.transport || requested.type
    const url = requested.serverUrl || requested.url
    const resolvedCommand = requested.command || command
    const resolvedArgs = Array.isArray(requested.args) ? requested.args : (Array.isArray(args) ? args : [])
    const config = transport === "http" || transport === "sse" || url
      ? { ...requested, transport: "http", serverUrl: url }
      : { ...requested, transport: "stdio", command: resolvedCommand, args: resolvedArgs }

    this._config = config

    try {
      if (config.transport === "http" && config.serverUrl) {
        this.transport = new HttpTransport(config.serverUrl, config.headers)
      } else {
        if (!resolvedCommand) {
          throw new Error("MCP stdio server command is required")
        }
        this.transport = new StdioTransport(resolvedCommand, resolvedArgs, config.env, config.cwd)
        await this.transport.start()
      }

      const initResponse = await this._sendRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "codek", version: "1.0.0" },
      })

      if (initResponse) {
        await this._sendNotification("notifications/initialized", {})
        await this._discoverTools()
        this._initialized = true
      }
    } catch (error) {
      await this.disconnect()
      throw new Error(`MCP connect failed: ${error.message}`)
    }
  }

  async _sendRequest(method, params) {
    if (!this.transport) {
      throw new Error("MCP transport not available")
    }

    const id = ++this.requestId
    const request = { jsonrpc: "2.0", id, method, params }

    return this.transport.send(request)
  }

  async _sendNotification(method, params) {
    if (!this.transport) return

    const message = { jsonrpc: "2.0", method, params }
    await this.transport.sendNotification(message)
  }

  async _discoverTools() {
    try {
      const response = await this._sendRequest("tools/list", {})
      if (response?.tools) {
        this.tools = response.tools
        this.toolDefs = response.tools.map((tool) => ({
          name: tool.name,
          description: tool.description || "",
          arguments: tool.inputSchema?.properties || {},
        }))
      }
    } catch {
      // Server may not support tool discovery
    }
  }

  async callTool(name, args) {
    if (!this._initialized) {
      throw new Error("MCP client not initialized")
    }

    try {
      const response = await this._sendRequest("tools/call", {
        name,
        arguments: args,
      })
      return response?.content || response
    } catch (error) {
      throw new Error(`MCP tool call failed: ${error.message}`)
    }
  }

  getToolDefinitions() {
    return this.toolDefs
  }

  async disconnect() {
    this._initialized = false
    this.tools = []
    this.toolDefs = []

    if (this.transport) {
      await this.transport.close()
      this.transport = null
    }
  }
}

export function createMcpToolAdapter(mcpClient) {
  return mcpClient.getToolDefinitions().map((def) => ({
    ...def,
    execute: async (args) => {
      return mcpClient.callTool(def.name, args)
    },
  }))
}

export function configureMcpServer(config) {
  return registerMcpServer(config)
}

export async function listMcpTools() {
  const tools = []
  for (const client of clientRegistry.values()) {
    if (!client._initialized) continue
    tools.push(...client.getToolDefinitions().map((tool) => ({
      ...tool,
      serverName: client.serverName,
      qualifiedName: `${client.serverName}.${tool.name}`,
    })))
  }
  return tools
}

export function registerMcpServer(config, options = {}) {
  const serverName = String(config?.serverName || config?.name || "mcp-server").trim() || "mcp-server"
  let client = clientRegistry.get(serverName)
  if (!client) {
    client = new McpClient({ serverName })
    clientRegistry.set(serverName, client)
  }
  client.configureMcpServer({ ...config, serverName })
  if (options.profileScoped) profileClientNames.add(serverName)
  if (!globalClient) globalClient = client
  return client
}

export function listConfiguredMcpServers() {
  return Array.from(clientRegistry.values()).map((client) => ({
    serverName: client.serverName,
    initialized: client._initialized,
    config: client._config ? { ...client._config } : null,
    tools: client.getToolDefinitions(),
    profileScoped: profileClientNames.has(client.serverName),
  }))
}

export async function clearProfileMcpServers() {
  const names = Array.from(profileClientNames)
  profileClientNames.clear()
  for (const name of names) {
    const client = clientRegistry.get(name)
    if (client) {
      await client.disconnect()
      clientRegistry.delete(name)
    }
  }
  if (globalClient && !clientRegistry.has(globalClient.serverName)) {
    globalClient = clientRegistry.values().next().value || null
  }
}

export async function applyProfileMcpServers(servers = []) {
  await clearProfileMcpServers()
  for (const server of servers) {
    registerMcpServer(server, { profileScoped: true })
  }
  return listConfiguredMcpServers().filter((server) => server.profileScoped)
}

export async function connectMcpServer(serverName) {
  const client = clientRegistry.get(serverName)
  if (!client) throw new Error(`MCP server not configured: ${serverName}`)
  await client.connect()
  return client
}

export async function ensureMcpServerConnected(serverName) {
  const client = await connectMcpServer(serverName)
  return client
}

export async function callMcpTool(serverName, toolName, args = {}) {
  const client = await ensureMcpServerConnected(serverName)
  return client.callTool(toolName, args)
}
