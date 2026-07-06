const assert = require("node:assert/strict")
const EventEmitter = require("node:events")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

class FakeServer extends EventEmitter {
  constructor() {
    super()
    this.handlers = new Map()
  }

  onRpc(method, handler) {
    this.handlers.set(method, handler)
  }

  callRpc(method, args) {
    const handler = this.handlers.get(method)
    if (!handler) throw new Error(`missing handler: ${method}`)
    return handler(args)
  }

  async call() {
    return undefined
  }
}

function loadMainThreadMcp() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-main-thread-mcp-"))
  const previous = process.env.CODEK_DATA
  process.env.CODEK_DATA = tempDir
  for (const modulePath of [
    "../../settings",
    "../../mcp/mcpAccess",
    "../../mcp/profileMcpAdapter",
    "./mainThreadMcp",
  ]) {
    delete require.cache[require.resolve(modulePath)]
  }
  const settings = require("../../settings")
  const mcpAdapter = require("../../mcp/profileMcpAdapter")
  const mainThreadMcp = require("./mainThreadMcp")
  if (previous == null) delete process.env.CODEK_DATA
  else process.env.CODEK_DATA = previous
  return { mainThreadMcp, mcpAdapter, settings, tempDir }
}

function sampleCollection() {
  return {
    id: "publisher.sample/sample-provider",
    label: "Sample MCP",
    extensionId: "publisher.sample",
    isTrustedByDefault: true,
    canResolveLaunch: false,
  }
}

test("MainThreadMcp registers VS Code extension MCP stdio and HTTP definitions in the shared adapter", async () => {
  const { mainThreadMcp, mcpAdapter } = loadMainThreadMcp()
  const server = new FakeServer()
  mainThreadMcp.register(server)

  await server.callRpc("$upsertMcpCollection", [
    sampleCollection(),
    [
      {
        id: "publisher.sample/local",
        label: "Local Tooling",
        cacheNonce: "v1",
        launch: {
          type: 1,
          command: "node",
          args: ["server.js"],
          env: { API_TOKEN: "stdio-secret" },
          cwd: "C:/workspace",
        },
      },
      {
        id: "publisher.sample/remote",
        label: "Remote Tooling",
        cacheNonce: "v2",
        launch: {
          type: 2,
          uri: { scheme: "http", authority: "127.0.0.1:4317", path: "/mcp", query: "workspace=1", fragment: "" },
          headers: [["Authorization", "http-secret"]],
        },
      },
    ],
  ])

  const listed = mcpAdapter.listConfiguredMcpServers()
  const local = listed.find((item) => item.serverName === "Local Tooling")
  const remote = listed.find((item) => item.serverName === "Remote Tooling")

  assert.ok(local)
  assert.ok(remote)
  assert.equal(local.extensionScoped, true)
  assert.equal(remote.extensionScoped, true)
  assert.equal(local.config.source, "extension:publisher.sample")
  assert.equal(local.config.sourceLabel, "Sample MCP")
  assert.equal(local.config.collectionId, "publisher.sample/sample-provider")
  assert.equal(local.config.definitionId, "publisher.sample/local")
  assert.deepEqual(local.config.envKeys, ["API_TOKEN"])
  assert.equal(remote.config.url, "http://127.0.0.1:4317/mcp?workspace=1")
  assert.deepEqual(remote.config.headerKeys, ["Authorization"])
  assert.equal(JSON.stringify(listed).includes("stdio-secret"), false)
  assert.equal(JSON.stringify(listed).includes("http-secret"), false)
})

test("MainThreadMcp resolves lazy VS Code extension MCP launches through ExtHostMcp", async () => {
  const { mainThreadMcp, mcpAdapter } = loadMainThreadMcp()
  const server = new FakeServer()
  const calls = []
  mainThreadMcp.register(server, {
    callEh: async (...args) => {
      calls.push(args)
      return { type: 1, command: "node", args: ["resolved-server.js"], env: { RESOLVED_TOKEN: "secret" } }
    },
  })

  await server.callRpc("$upsertMcpCollection", [
    { ...sampleCollection(), canResolveLaunch: true },
    [{
      id: "publisher.sample/lazy",
      label: "Lazy Tooling",
      cacheNonce: "lazy-v1",
      launch: {},
    }],
  ])

  const listed = mcpAdapter.listConfiguredMcpServers()
  const resolveCalls = calls.filter(([, method]) => method === "$resolveMcpLaunch")
  assert.equal(resolveCalls.length, 1)
  assert.deepEqual(resolveCalls[0], [
    mainThreadMcp.EXT_HOST_MCP_NID,
    "$resolveMcpLaunch",
    ["publisher.sample/sample-provider", "Lazy Tooling"],
    30000,
  ])
  assert.equal(listed.length, 1)
  assert.equal(listed[0].serverName, "Lazy Tooling")
  assert.equal(listed[0].config.command, "node")
  assert.deepEqual(listed[0].config.args, ["resolved-server.js"])
  assert.deepEqual(listed[0].config.envKeys, ["RESOLVED_TOKEN"])
  assert.equal(JSON.stringify(listed).includes("secret"), false)
})

test("MainThreadMcp removes extension MCP clients when VS Code deletes the collection", async () => {
  const { mainThreadMcp, mcpAdapter } = loadMainThreadMcp()
  const server = new FakeServer()
  mainThreadMcp.register(server)

  await server.callRpc("$upsertMcpCollection", [
    sampleCollection(),
    [{
      id: "publisher.sample/local",
      label: "Local Tooling",
      cacheNonce: "v1",
      launch: { type: 1, command: "node", args: ["server.js"], env: {} },
    }],
  ])
  assert.equal(mcpAdapter.listConfiguredMcpServers().length, 1)

  await server.callRpc("$deleteMcpCollection", ["publisher.sample/sample-provider"])

  assert.deepEqual(mcpAdapter.listConfiguredMcpServers(), [])
})

test("MainThreadMcp publishes VS Code-style MCP server definition changes to ExtHostMcp", async () => {
  const { mainThreadMcp } = loadMainThreadMcp()
  const server = new FakeServer()
  const published = []
  mainThreadMcp.register(server, {
    callEh: async (nid, method, args) => {
      if (method === "$onDidChangeMcpServerDefinitions") {
        published.push({ nid, servers: args[0] })
      }
      return undefined
    },
  })

  await server.callRpc("$upsertMcpCollection", [
    sampleCollection(),
    [
      {
        id: "publisher.sample/local",
        label: "Local Tooling",
        cacheNonce: "v1",
        launch: {
          type: 1,
          command: "node",
          args: ["server.js"],
          env: { API_TOKEN: "stdio-secret" },
          cwd: "C:/workspace",
        },
      },
      {
        id: "publisher.sample/remote",
        label: "Remote Tooling",
        cacheNonce: "v2",
        launch: {
          type: 2,
          uri: { scheme: "http", authority: "127.0.0.1:4317", path: "/mcp", query: "", fragment: "" },
          headers: [["Authorization", "http-secret"]],
        },
      },
    ],
  ])

  const latest = published.at(-1)
  assert.equal(latest.nid, mainThreadMcp.EXT_HOST_MCP_NID)
  assert.deepEqual(latest.servers.map((definition) => definition.label), ["Local Tooling", "Remote Tooling"])
  assert.deepEqual(latest.servers[0], {
    id: "publisher.sample/local",
    label: "Local Tooling",
    cacheNonce: "v1",
    launch: {
      type: 1,
      command: "node",
      args: ["server.js"],
      cwd: "C:/workspace",
      env: {},
      envFile: undefined,
      sandbox: undefined,
    },
  })
  assert.deepEqual(latest.servers[1], {
    id: "publisher.sample/remote",
    label: "Remote Tooling",
    cacheNonce: "v2",
    launch: {
      type: 2,
      uri: { scheme: "http", authority: "127.0.0.1:4317", path: "/mcp", query: "", fragment: "" },
      headers: [],
    },
  })
  assert.equal(JSON.stringify(latest.servers).includes("stdio-secret"), false)
  assert.equal(JSON.stringify(latest.servers).includes("http-secret"), false)

  await server.callRpc("$deleteMcpCollection", ["publisher.sample/sample-provider"])

  assert.deepEqual(published.at(-1).servers, [])
})

test("MainThreadMcp skips extension MCP collections outside VS Code all access", async () => {
  const { mainThreadMcp, mcpAdapter, settings } = loadMainThreadMcp()
  const server = new FakeServer()
  let resolveCalls = 0
  mainThreadMcp.register(server, {
    callEh: async (_nid, method) => {
      if (method === "$resolveMcpLaunch") resolveCalls += 1
      return { type: 1, command: "node" }
    },
  })
  settings.writeUserSettings({ "chat.mcp.access": "registry" })

  const result = await server.callRpc("$upsertMcpCollection", [
    { ...sampleCollection(), canResolveLaunch: true },
    [{
      id: "publisher.sample/local",
      label: "Local Tooling",
      cacheNonce: "v1",
      launch: {},
    }],
  ])

  assert.equal(result.skipped, true)
  assert.match(result.reason, /chat\.mcp\.access=registry/)
  assert.equal(resolveCalls, 0)
  assert.deepEqual(mcpAdapter.listConfiguredMcpServers(), [])
})

test("MainThreadMcp starts extension MCP servers through VS Code host delegate transport", async () => {
  const { mainThreadMcp, mcpAdapter } = loadMainThreadMcp()
  const server = new FakeServer()
  const calls = []
  mainThreadMcp.register(server, {
    callEh: async (_nid, method, args) => {
      calls.push({ method, args })
      if (method === "$sendMessage") {
        const [id, raw] = args
        const message = JSON.parse(raw)
        if (message.method === "initialize") {
          setImmediate(() => server.callRpc("$onDidReceiveMessage", [
            id,
            JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05" } }),
          ]))
        } else if (message.method === "tools/list") {
          setImmediate(() => server.callRpc("$onDidReceiveMessage", [
            id,
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: {
                tools: [{
                  name: "extensionTool",
                  description: "From extension host",
                  inputSchema: { type: "object", properties: {} },
                }],
              },
            }),
          ]))
        } else if (message.method === "tools/call") {
          setImmediate(() => server.callRpc("$onDidReceiveMessage", [
            id,
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { content: [{ type: "text", text: "ok" }] },
            }),
          ]))
        }
      }
      return undefined
    },
  })

  await server.callRpc("$upsertMcpCollection", [
    sampleCollection(),
    [{
      id: "publisher.sample/remote",
      label: "Remote Tooling",
      cacheNonce: "v1",
      launch: {
        type: 2,
        uri: { scheme: "http", authority: "127.0.0.1:4317", path: "/mcp", query: "", fragment: "" },
      },
    }],
  ])

  const client = await mcpAdapter.connectMcpServer("Remote Tooling")
  assert.equal(client.initialized, true)
  assert.deepEqual(client.getToolDefinitions().map((tool) => tool.name), ["extensionTool"])
  const result = await mcpAdapter.callMcpTool("Remote Tooling", "extensionTool", {})
  assert.deepEqual(result, [{ type: "text", text: "ok" }])
  assert.equal(calls.some((call) => call.method === "$startMcp"), true)
  assert.equal(calls.some((call) => call.method === "$sendMessage"), true)
  assert.equal(calls.some((call) => call.method === "$resolveMcpLaunch"), false)

  await mcpAdapter.clearExtensionMcpServers()
  assert.equal(calls.some((call) => call.method === "$stopMcp"), true)
})
