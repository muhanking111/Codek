const assert = require("node:assert/strict")
const fs = require("node:fs")
const http = require("node:http")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

function loadModules() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-mcp-profile-"))
  const previous = process.env.CODEK_DATA
  process.env.CODEK_DATA = tempDir
  for (const modulePath of [
    "../settings",
    "../userDataProfile",
    "../extensions-host/extensionInstallState",
    "./mcpAccess",
    "./mcpGalleryManifestAdapter",
    "./mcpManagementAdapter",
    "./mcpRegistryInputStorageAdapter",
    "./profileMcpAdapter",
  ]) {
    delete require.cache[require.resolve(modulePath)]
  }
  const settings = require("../settings")
  const profileService = require("../userDataProfile")
  const extensionInstallState = require("../extensions-host/extensionInstallState")
  const inputStorage = require("./mcpRegistryInputStorageAdapter")
  const adapter = require("./profileMcpAdapter")
  if (previous == null) delete process.env.CODEK_DATA
  else process.env.CODEK_DATA = previous
  return { adapter, extensionInstallState, inputStorage, profileService, settings, tempDir }
}

function startMcpHttpServer() {
  const calls = []
  const messages = []
  const server = http.createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => { body += chunk })
    req.on("end", () => {
      const message = body ? JSON.parse(body) : {}
      calls.push(message.method)
      messages.push(message)
      res.setHeader("Content-Type", "application/json")
      if (message.method === "initialize") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { resources: {}, tools: {} },
          },
        }))
      } else if (message.method === "tools/list") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            tools: [
              {
                name: "echo",
                description: "Echo text",
                inputSchema: {
                  type: "object",
                  properties: { text: { type: "string" } },
                },
              },
            ],
          },
        }))
      } else if (message.method === "tools/call") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [{ type: "text", text: `echo:${message.params.arguments.text}` }] },
        }))
      } else if (message.method === "resources/list") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            resources: [{
              uri: "file:///workspace/readme.md",
              name: "readme.md",
              title: "README",
              description: "Workspace README",
              mimeType: "text/markdown",
            }],
          },
        }))
      } else if (message.method === "resources/templates/list") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            resourceTemplates: [{
              uriTemplate: "file:///workspace/{path}",
              name: "workspace-file",
              title: "Workspace File",
              description: "Open a workspace file",
            }],
          },
        }))
      } else if (message.method === "resources/read") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            contents: [{ uri: message.params.uri, mimeType: "text/markdown", text: "# README" }],
          },
        }))
      } else if (message.method === "completion/complete") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            completion: {
              values: ["src/main.ts", "src/App.vue"],
              total: 2,
              hasMore: false,
            },
          },
        }))
      } else {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }))
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port, calls, messages })
    })
  })
}

function startStreamingMcpHttpServer() {
  const calls = []
  const messages = []
  const requests = []
  const streamResponses = new Set()
  let sessionId = ""
  const server = http.createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => { body += chunk })
    req.on("end", () => {
      const message = body ? JSON.parse(body) : {}
      calls.push(message.method)
      messages.push(message)
      requests.push({
        method: req.method,
        rpc: message.method,
        sessionId: String(req.headers["mcp-session-id"] || ""),
        accept: String(req.headers.accept || ""),
      })
      const isStreamRequest = req.headers.accept
        && String(req.headers.accept).includes("text/event-stream")
        && (req.method === "GET" || message.method === "notifications/subscribe")
      if (isStreamRequest) {
        if (req.method === "GET" && sessionId && req.headers["mcp-session-id"] !== sessionId) {
          res.writeHead(400, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: 400, message: "Missing Mcp-Session-Id header" } }))
          return
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        })
        streamResponses.add(res)
        res.on("close", () => streamResponses.delete(res))
        return
      }
      res.setHeader("Content-Type", "application/json")
      if (message.method === "initialize") {
        sessionId = "session-stream-1"
        res.setHeader("Mcp-Session-Id", sessionId)
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { resources: { subscribe: true }, tools: {} },
          },
        }))
      } else if (message.method === "tools/list") {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [] } }))
      } else {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }))
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        port: server.address().port,
        calls,
        messages,
        requests,
        emit(message) {
          for (const response of streamResponses) {
            response.write(`event: message\n`)
            response.write(`data: ${JSON.stringify(message)}\n\n`)
          }
        },
        streamCount() {
          return streamResponses.size
        },
        sessionId() {
          return sessionId
        },
      })
    })
  })
}

function startExpiringStreamableMcpHttpServer() {
  const calls = []
  const requests = []
  const streamResponses = new Set()
  let sessionCounter = 0
  let activeSessionId = ""
  let expireNextSessionRequest = false
  const server = http.createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => { body += chunk })
    req.on("end", () => {
      const message = body ? JSON.parse(body) : {}
      calls.push(message.method)
      requests.push({
        method: req.method,
        rpc: message.method,
        sessionId: String(req.headers["mcp-session-id"] || ""),
        lastEventId: String(req.headers["last-event-id"] || ""),
        accept: String(req.headers.accept || ""),
      })
      const isStreamRequest = req.method === "GET" && String(req.headers.accept || "").includes("text/event-stream")
      if (isStreamRequest) {
        if (req.headers["mcp-session-id"] !== activeSessionId) {
          res.writeHead(404, { "Content-Type": "application/json", "Retry-After": "7" })
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: 404, message: "Session not found" } }))
          return
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        })
        streamResponses.add(res)
        res.on("close", () => streamResponses.delete(res))
        return
      }
      res.setHeader("Content-Type", "application/json")
      if (message.method !== "initialize" && expireNextSessionRequest) {
        expireNextSessionRequest = false
        res.writeHead(404, { "Content-Type": "application/json", "Retry-After": "5" })
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: 404, message: "Session expired" } }))
        return
      }
      if (message.method === "initialize") {
        activeSessionId = `session-${++sessionCounter}`
        res.setHeader("Mcp-Session-Id", activeSessionId)
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { resources: { subscribe: true }, tools: {} },
          },
        }))
      } else if (message.method === "tools/list") {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [] } }))
      } else {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }))
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        port: server.address().port,
        calls,
        requests,
        expireNext() {
          expireNextSessionRequest = true
        },
        emit(id, message) {
          for (const response of streamResponses) {
            if (id) response.write(`id: ${id}\n`)
            response.write("retry: 1500\n")
            response.write("event: message\n")
            response.write(`data: ${JSON.stringify(message)}\n\n`)
          }
        },
        activeSessionId() {
          return activeSessionId
        },
        streamCount() {
          return streamResponses.size
        },
      })
    })
  })
}

function startUnavailableBackchannelMcpHttpServer() {
  const calls = []
  const requests = []
  let activeSessionId = ""
  const server = http.createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => { body += chunk })
    req.on("end", () => {
      const message = body ? JSON.parse(body) : {}
      calls.push(message.method)
      requests.push({
        method: req.method,
        rpc: message.method,
        sessionId: String(req.headers["mcp-session-id"] || ""),
        accept: String(req.headers.accept || ""),
      })
      const isStreamRequest = req.method === "GET" && String(req.headers.accept || "").includes("text/event-stream")
      if (isStreamRequest) {
        res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "9" })
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: 503, message: "Backchannel down" } }))
        return
      }
      res.setHeader("Content-Type", "application/json")
      if (message.method === "initialize") {
        activeSessionId = "session-backchannel-down"
        res.setHeader("Mcp-Session-Id", activeSessionId)
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { resources: { subscribe: true }, tools: {} },
          },
        }))
      } else if (message.method === "tools/list") {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [] } }))
      } else {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }))
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port, calls, requests, activeSessionId: () => activeSessionId })
    })
  })
}

function startFlakyBackchannelMcpHttpServer({ closeFirstStream = true } = {}) {
  const calls = []
  const requests = []
  const streamResponses = new Set()
  let activeSessionId = ""
  let streamRequests = 0
  const server = http.createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => { body += chunk })
    req.on("end", () => {
      const message = body ? JSON.parse(body) : {}
      calls.push(message.method)
      requests.push({
        method: req.method,
        rpc: message.method,
        sessionId: String(req.headers["mcp-session-id"] || ""),
        lastEventId: String(req.headers["last-event-id"] || ""),
        accept: String(req.headers.accept || ""),
      })
      const isStreamRequest = req.method === "GET" && String(req.headers.accept || "").includes("text/event-stream")
      if (isStreamRequest) {
        streamRequests += 1
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        })
        streamResponses.add(res)
        res.on("close", () => streamResponses.delete(res))
        res.write(": connected\n\n")
        if (closeFirstStream && streamRequests === 1) {
          setTimeout(() => {
            res.write("id: 7\nretry: 30\nevent: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/resources/updated\",\"params\":{\"uri\":\"file:///workspace/readme.md\"}}\n\n")
            res.end()
          }, 10)
        }
        return
      }
      res.setHeader("Content-Type", "application/json")
      if (message.method === "initialize") {
        activeSessionId = "session-flaky"
        res.setHeader("Mcp-Session-Id", activeSessionId)
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { resources: { subscribe: true }, tools: {} },
          },
        }))
      } else if (message.method === "tools/list") {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [] } }))
      } else {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }))
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        port: server.address().port,
        calls,
        requests,
        activeSessionId: () => activeSessionId,
        streamCount: () => streamResponses.size,
        streamRequests: () => streamRequests,
        emit(message) {
          for (const response of streamResponses) {
            response.write(`event: message\n`)
            response.write(`data: ${JSON.stringify(message)}\n\n`)
          }
        },
      })
    })
  })
}

function delay(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test("parses VS Code profile MCP resource and legacy server config", () => {
  const { adapter } = loadModules()
  const parsed = adapter.parseMcpProfileResource(JSON.stringify({
    mcp: `{
      // VS Code JSONC style profile MCP resource
      "servers": {
        "stdioServer": { "command": "node", "args": ["server.js"], },
        "remoteServer": { "type": "remote", "url": "http://127.0.0.1:3000/mcp" },
        "oldServer": { "config": { "command": "python", "args": ["server.py"] } }
      }
    }`,
  }))

  assert.deepEqual(parsed.servers.map((server) => server.serverName), ["stdioServer", "remoteServer", "oldServer"])
  assert.equal(parsed.servers[0].transport, "stdio")
  assert.equal(parsed.servers[1].transport, "http")
  assert.equal(parsed.servers[2].command, "python")
})

test("loads active workspace profile MCP resource and calls HTTP MCP tool", async () => {
  const { adapter, profileService, tempDir } = loadModules()
  const { server, port, calls } = await startMcpHttpServer()
  const workspace = path.join(tempDir, "workspace")
  const resource = JSON.stringify({
    mcp: JSON.stringify({
      servers: {
        profileHttp: {
          type: "remote",
          url: `http://127.0.0.1:${port}/mcp`,
          headers: { Authorization: "secret-token" },
        },
      },
    }),
  })

  try {
    profileService.writeWorkbenchProfileState({
      activeProfileId: "global-profile",
      profiles: [
        { id: "global-profile", name: "Global", settings: {}, resources: {} },
        { id: "workspace-profile", name: "Workspace", settings: {}, resources: { mcp: resource } },
      ],
    })
    profileService.setProfileForWorkspace(workspace, "workspace-profile")

    const applied = await adapter.applyActiveProfileFromProject(workspace)
    assert.equal(applied.activeProfileId, "workspace-profile")
    assert.equal(applied.servers.length, 1)

    const listed = adapter.listConfiguredMcpServers()
    assert.equal(listed[0].serverName, "profileHttp")
    assert.deepEqual(listed[0].config.headerKeys, ["Authorization"])
    assert.equal(JSON.stringify(listed).includes("secret-token"), false)

    const result = await adapter.callMcpTool("profileHttp", "echo", { text: "ok" })
    assert.deepEqual(result, [{ type: "text", text: "echo:ok" }])
    assert.ok(calls.includes("initialize"))
    assert.ok(calls.includes("tools/list"))
    assert.ok(calls.includes("tools/call"))
  } finally {
    await adapter.clearProfileMcpServers()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("lists and reads MCP resources through VS Code resource protocol methods", async () => {
  const { adapter, profileService, tempDir } = loadModules()
  const { server, port, calls, messages } = await startMcpHttpServer()
  const workspace = path.join(tempDir, "resource-workspace")
  const resource = JSON.stringify({
    mcp: JSON.stringify({
      servers: {
        profileHttp: {
          type: "remote",
          url: `http://127.0.0.1:${port}/mcp`,
        },
      },
    }),
  })
  profileService.writeWorkbenchProfileState({
    activeProfileId: "resource-profile",
    profiles: [
      { id: "resource-profile", name: "Resources", settings: {}, resources: { mcp: resource } },
    ],
  })
  profileService.setProfileForWorkspace(workspace, "resource-profile")

  try {
    await adapter.applyActiveProfileFromProject(workspace)
    const resources = await adapter.listMcpResources("profileHttp")
    const templates = await adapter.listMcpResourceTemplates("profileHttp")
    const contents = await adapter.readMcpResource("profileHttp", "file:///workspace/readme.md")
    const completion = await adapter.completeMcpResourceTemplate("profileHttp", {
      uriTemplate: "file:///workspace{/path*}{?q}",
      variable: "q",
      value: "to",
      context: { path: ["src", "main.ts"] },
    })

    assert.equal(resources[0].uri, "file:///workspace/readme.md")
    assert.equal(templates[0].uriTemplate, "file:///workspace/{path}")
    assert.deepEqual(contents, [{ uri: "file:///workspace/readme.md", mimeType: "text/markdown", text: "# README" }])
    assert.deepEqual(completion, { values: ["src/main.ts", "src/App.vue"], total: 2, hasMore: false })
    assert.ok(calls.includes("resources/list"))
    assert.ok(calls.includes("resources/templates/list"))
    assert.ok(calls.includes("resources/read"))
    assert.ok(calls.includes("completion/complete"))
    const completionRequest = messages.find((message) => message.method === "completion/complete")
    assert.deepEqual(completionRequest.params, {
      ref: { type: "ref/resource", uri: "file:///workspace{/path*}{?q}" },
      argument: { name: "q", value: "to" },
      context: { arguments: { path: "src/main.ts" } },
    })
    assert.equal(adapter.listConfiguredMcpServers()[0].capabilities.resources !== undefined, true)
  } finally {
    await adapter.clearProfileMcpServers()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("resolves VS Code MCP workspace variables without exposing secret values", async () => {
  const { adapter, profileService, tempDir } = loadModules()
  const workspace = path.join(tempDir, "workspace-root")
  const resource = JSON.stringify({
    mcp: JSON.stringify({
      servers: {
        profileStdio: {
          type: "local",
          command: "node",
          args: ["${workspaceFolderBasename}", "${userHome}", "${env:CODEK_MCP_TEST_ENV}"],
          cwd: "${workspaceFolder}",
          env: {
            WORKSPACE: "${workspaceFolder}",
            HOME_DIR: "${userHome}",
            SECRET_TOKEN: "secret-value",
          },
        },
        defaultCwd: {
          type: "local",
          command: "node",
          args: ["server.js"],
        },
      },
    }),
  })
  const previousEnv = process.env.CODEK_MCP_TEST_ENV
  process.env.CODEK_MCP_TEST_ENV = "resolved-env"

  try {
    profileService.writeWorkbenchProfileState({
      activeProfileId: "global-profile",
      profiles: [
        { id: "global-profile", name: "Global", settings: {}, resources: {} },
        { id: "workspace-profile", name: "Workspace", settings: {}, resources: { mcp: resource } },
      ],
    })
    profileService.setProfileForWorkspace(workspace, "workspace-profile")

    const applied = await adapter.applyActiveProfileFromProject(workspace)
    assert.equal(applied.servers[0].cwd, path.resolve(workspace))
    assert.deepEqual(applied.servers[0].args, ["workspace-root", os.homedir(), "resolved-env"])
    assert.equal(applied.servers[0].env.WORKSPACE, path.resolve(workspace))
    assert.equal(applied.servers[0].env.HOME_DIR, os.homedir())
    assert.equal(applied.servers[1].cwd, path.resolve(workspace))

    const listed = adapter.listConfiguredMcpServers()
    const firstConfig = listed.find((server) => server.serverName === "profileStdio").config
    const defaultConfig = listed.find((server) => server.serverName === "defaultCwd").config
    assert.equal(firstConfig.cwd, path.resolve(workspace))
    assert.deepEqual(firstConfig.envKeys, ["WORKSPACE", "HOME_DIR", "SECRET_TOKEN"])
    assert.equal(defaultConfig.cwd, path.resolve(workspace))
    assert.equal(JSON.stringify(listed).includes("secret-value"), false)

    const reused = await adapter.applyActiveProfileFromProject(workspace)
    assert.equal(reused.reused, true)
    assert.equal(reused.servers[0].cwd, path.resolve(workspace))
    assert.deepEqual(reused.servers[0].args, ["workspace-root", os.homedir(), "resolved-env"])
  } finally {
    if (previousEnv == null) delete process.env.CODEK_MCP_TEST_ENV
    else process.env.CODEK_MCP_TEST_ENV = previousEnv
    await adapter.clearProfileMcpServers()
  }
})

test("discovers VS Code workspace .mcp.json servers without starting them", async () => {
  const { adapter, tempDir } = loadModules()
  const workspace = path.join(tempDir, "workspace-dot-mcp")
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, ".mcp.json"), JSON.stringify({
    mcpServers: {
      workspaceServer: {
        command: "node",
        args: ["server.js", "${workspaceFolderBasename}"],
        env: { API_TOKEN: "workspace-secret" },
      },
    },
  }), "utf8")

  try {
    const applied = await adapter.applyActiveProfileFromProject(workspace)

    assert.equal(applied.workspaceServers.length, 1)
    assert.equal(applied.workspaceServers[0].serverName, "workspaceServer")
    assert.deepEqual(applied.workspaceServers[0].args, ["server.js", "workspace-dot-mcp"])
    assert.equal(applied.workspaceSources[0].source, "workspace-dot-mcp")

    const listed = adapter.listConfiguredMcpServers()
    const workspaceServer = listed.find((server) => server.serverName === "workspaceServer")
    assert.ok(workspaceServer)
    assert.equal(workspaceServer.initialized, false)
    assert.equal(workspaceServer.workspaceScoped, true)
    assert.equal(workspaceServer.profileScoped, false)
    assert.equal(workspaceServer.config.source, "workspace-dot-mcp")
    assert.equal(workspaceServer.config.sourceLabel, ".mcp.json")
    assert.equal(workspaceServer.config.cwd, path.resolve(workspace))
    assert.deepEqual(workspaceServer.config.envKeys, ["API_TOKEN"])
    assert.equal(JSON.stringify(listed).includes("workspace-secret"), false)
  } finally {
    await adapter.clearWorkspaceMcpServers()
  }
})

test("workspace MCP discovery uses VS Code-style registered discovery sources", async () => {
  const { adapter, tempDir } = loadModules()
  const workspace = path.join(tempDir, "registered-discovery-source")
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, "custom.mcp.json"), JSON.stringify({
    mcpServers: {
      customServer: { command: "node", args: ["custom-server.js"] },
    },
  }), "utf8")

  const disposable = adapter.registerMcpDiscoverySource({
    id: "custom-workspace-source",
    label: "custom.mcp.json",
    pathSegments: ["custom.mcp.json"],
    source: "custom-workspace",
    workspaceScoped: true,
  })

  try {
    const applied = await adapter.applyActiveProfileFromProject(workspace)

    assert.equal(applied.workspaceSources.some((source) => source.source === "custom-workspace"), true)
    const listed = adapter.listConfiguredMcpServers()
    const customServer = listed.find((server) => server.serverName === "customServer")
    assert.ok(customServer)
    assert.equal(customServer.workspaceScoped, true)
    assert.equal(customServer.config.source, "custom-workspace")
    assert.equal(customServer.config.sourceLabel, "custom.mcp.json")
  } finally {
    disposable.dispose()
    await adapter.clearWorkspaceMcpServers()
  }
})

test("discovers VS Code .code-workspace settings.mcp servers", async () => {
  const { adapter, tempDir } = loadModules()
  const workspace = path.join(tempDir, "workspace-settings-mcp")
  const workspaceFile = path.join(tempDir, "demo.code-workspace")
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(workspaceFile, JSON.stringify({
    folders: [{ path: workspace }],
    settings: {
      "editor.wordWrap": "on",
      mcp: {
        servers: {
          workspaceSettingsServer: {
            command: "node",
            args: ["server.js", "${workspaceFolderBasename}"],
            env: { API_TOKEN: "workspace-settings-secret" },
          },
        },
      },
    },
  }), "utf8")

  try {
    const applied = await adapter.applyActiveProfileFromProject(workspace, { workspaceFile })

    assert.equal(applied.workspaceServers.length, 1)
    assert.equal(applied.workspaceServers[0].serverName, "workspaceSettingsServer")
    assert.deepEqual(applied.workspaceServers[0].args, ["server.js", "workspace-settings-mcp"])
    assert.equal(applied.workspaceSources[0].source, "workspace-settings-mcp")
    assert.equal(applied.workspaceSources[0].label, ".code-workspace settings.mcp")

    const listed = adapter.listConfiguredMcpServers()
    const workspaceServer = listed.find((server) => server.serverName === "workspaceSettingsServer")
    assert.ok(workspaceServer)
    assert.equal(workspaceServer.workspaceScoped, true)
    assert.equal(workspaceServer.config.source, "workspace-settings-mcp")
    assert.equal(workspaceServer.config.sourceLabel, ".code-workspace settings.mcp")
    assert.equal(workspaceServer.config.sourcePath, workspaceFile)
    assert.equal(workspaceServer.config.cwd, path.resolve(workspace))
    assert.deepEqual(workspaceServer.config.envKeys, ["API_TOKEN"])
    assert.equal(JSON.stringify(listed).includes("workspace-settings-secret"), false)
  } finally {
    await adapter.clearWorkspaceMcpServers()
  }
})

test("MCP registry access skips non-gallery workspace discovery sources", async () => {
  const { adapter, tempDir } = loadModules()
  const workspace = path.join(tempDir, "registry-access-filter")
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, ".mcp.json"), JSON.stringify({
    mcpServers: {
      workspaceServer: { command: "node", args: ["server.js"] },
    },
  }), "utf8")

  const applied = await adapter.applyActiveProfileFromProject(workspace, { mcpAccess: "registry" })

  assert.deepEqual(applied.workspaceServers, [])
  assert.deepEqual(applied.workspaceSources, [])
  assert.deepEqual(adapter.listConfiguredMcpServers(), [])
})

test("MCP registry access loads installed gallery MCP discovery sources", async () => {
  const { adapter, extensionInstallState, tempDir } = loadModules()
  const workspace = path.join(tempDir, "registry-access-installed")
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, ".mcp.json"), JSON.stringify({
    mcpServers: {
      workspaceServer: { command: "node", args: ["workspace-server.js"] },
    },
  }), "utf8")

  extensionInstallState.updateExtensionInstallRecord("publisher.installed-mcp", {
    status: "installed",
    enabled: true,
    version: "1.0.0",
    mcp: {
      servers: {
        installedServer: {
          command: "node",
          args: ["installed-server.js", "${workspaceFolderBasename}"],
          env: { API_TOKEN: "installed-secret" },
        },
      },
    },
  }, { filePath: path.join(tempDir, "User", "extensions", "install-state.json") })

  try {
    const applied = await adapter.applyActiveProfileFromProject(workspace, { mcpAccess: "registry" })

    assert.deepEqual(applied.workspaceServers, [])
    assert.equal(applied.installedServers.length, 1)
    assert.equal(applied.installedServers[0].serverName, "installedServer")
    assert.deepEqual(applied.installedServers[0].args, ["installed-server.js", "registry-access-installed"])

    const listed = adapter.listConfiguredMcpServers()
    assert.equal(listed.some((server) => server.serverName === "workspaceServer"), false)
    const installedServer = listed.find((server) => server.serverName === "installedServer")
    assert.ok(installedServer)
    assert.equal(installedServer.installedScoped, true)
    assert.equal(installedServer.workspaceScoped, false)
    assert.equal(installedServer.config.source, "installed-mcp")
    assert.equal(installedServer.config.sourceLabel, "Installed MCP Servers")
    assert.deepEqual(installedServer.config.envKeys, ["API_TOKEN"])
    assert.equal(JSON.stringify(listed).includes("installed-secret"), false)
  } finally {
    await adapter.clearInstalledMcpServers()
    await adapter.clearWorkspaceMcpServers()
  }
})

test("installed MCP discovery converts VS Code gallery metadata through management adapter", async () => {
  const { adapter, extensionInstallState, tempDir } = loadModules()
  const workspace = path.join(tempDir, "installed-gallery-metadata")
  fs.mkdirSync(workspace, { recursive: true })

  extensionInstallState.updateExtensionInstallRecord("publisher.gallery-mcp", {
    status: "installed",
    enabled: true,
    version: "2.0.0",
    installPath: path.join(tempDir, "extensions", "publisher.gallery-mcp"),
    mcpGalleryServer: {
      id: "gallery-server-id",
      name: "io.modelcontextprotocol.filesystem",
      displayName: "Filesystem MCP",
      description: "Filesystem tools",
      version: "2.0.0",
      galleryUrl: "https://modelcontextprotocol.io/server/filesystem",
      configuration: {
        packages: [{
          registryType: "npm",
          identifier: "@modelcontextprotocol/server-filesystem",
          version: "2.0.0",
          packageArguments: [{
            type: "positional",
            value: "{root}",
            variables: {
              root: {
                description: "Workspace root",
                default: "${workspaceFolder}",
              },
            },
          }],
          environmentVariables: [{
            name: "API_TOKEN",
            description: "Token",
            isSecret: true,
          }],
        }],
      },
    },
  }, { filePath: path.join(tempDir, "User", "extensions", "install-state.json") })

  try {
    const applied = await adapter.applyActiveProfileFromProject(workspace, { mcpAccess: "registry" })

    assert.equal(applied.installedServers.length, 1)
    assert.equal(applied.installedServers[0].serverName, "io.modelcontextprotocol.filesystem")
    assert.equal(applied.installedServers[0].command, "npx")
    assert.deepEqual(applied.installedServers[0].args, [
      "@modelcontextprotocol/server-filesystem@2.0.0",
      "${input:root}",
    ])
    assert.equal(applied.installedSources[0].serverCount, 1)

    const listed = adapter.listConfiguredMcpServers()
    const installedServer = listed.find((server) => server.serverName === "io.modelcontextprotocol.filesystem")
    assert.ok(installedServer)
    assert.equal(installedServer.installedScoped, true)
    assert.equal(installedServer.config.source, "installed-mcp")
    assert.equal(installedServer.config.sourcePath.endsWith("publisher.gallery-mcp"), true)
    assert.deepEqual(installedServer.config.envKeys, ["API_TOKEN"])
    assert.deepEqual(installedServer.config.inputs.map((input) => ({
      id: input.id,
      type: input.type,
      password: input.password,
      default: input.default,
    })), [
      { id: "API_TOKEN", type: "prompt", password: true, default: undefined },
      { id: "root", type: "prompt", password: false, default: "${workspaceFolder}" },
    ])
    assert.equal(JSON.stringify(listed).includes("Bearer static"), false)
  } finally {
    await adapter.clearInstalledMcpServers()
  }
})

test("installed MCP discovery resolves saved VS Code input values at apply time without leaking secrets", async () => {
  const { adapter, extensionInstallState, inputStorage, profileService, tempDir } = loadModules()
  const workspace = path.join(tempDir, "installed-gallery-saved-inputs")
  fs.mkdirSync(workspace, { recursive: true })
  profileService.writeWorkbenchProfileState({
    activeProfileId: "input-profile",
    profiles: [{ id: "input-profile", name: "Inputs", settings: {}, resources: {} }],
  })
  profileService.setProfileForWorkspace(workspace, "input-profile")
  const storage = new inputStorage.McpRegistryInputStorageAdapter({ profileId: "input-profile" })
  await storage.setPlainText({ root: { value: path.resolve(workspace) } })
  await storage.setSecrets({ API_TOKEN: { value: "saved-secret-token" } })

  extensionInstallState.updateExtensionInstallRecord("publisher.gallery-mcp", {
    status: "installed",
    enabled: true,
    version: "2.0.0",
    installPath: path.join(tempDir, "extensions", "publisher.gallery-mcp"),
    mcpGalleryServer: {
      id: "gallery-server-id",
      name: "io.modelcontextprotocol.filesystem",
      displayName: "Filesystem MCP",
      version: "2.0.0",
      configuration: {
        packages: [{
          registryType: "npm",
          identifier: "@modelcontextprotocol/server-filesystem",
          version: "2.0.0",
          packageArguments: [{
            type: "positional",
            value: "{root}",
            variables: {
              root: {
                description: "Workspace root",
                default: "${workspaceFolder}",
              },
            },
          }, {
            type: "positional",
            value: "{missing}",
            variables: {
              missing: {
                description: "Missing saved input",
              },
            },
          }],
          environmentVariables: [{
            name: "API_TOKEN",
            description: "Token",
            isSecret: true,
          }],
        }],
      },
    },
  }, { filePath: path.join(tempDir, "User", "extensions", "install-state.json") })

  try {
    const applied = await adapter.applyActiveProfileFromProject(workspace, { mcpAccess: "registry" })

    assert.equal(applied.installedServers.length, 1)
    assert.deepEqual(applied.installedServers[0].args, [
      "@modelcontextprotocol/server-filesystem@2.0.0",
      path.resolve(workspace),
      "${input:missing}",
    ])
    assert.equal(applied.installedServers[0].env.API_TOKEN, "saved-secret-token")

    const listed = adapter.listConfiguredMcpServers()
    const installedServer = listed.find((server) => server.serverName === "io.modelcontextprotocol.filesystem")
    assert.ok(installedServer)
    assert.deepEqual(installedServer.config.args, [
      "@modelcontextprotocol/server-filesystem@2.0.0",
      path.resolve(workspace),
      "${input:missing}",
    ])
    assert.deepEqual(installedServer.config.envKeys, ["API_TOKEN"])
    assert.equal(JSON.stringify(listed).includes("saved-secret-token"), false)
  } finally {
    await adapter.clearInstalledMcpServers()
  }
})

test("unresolved VS Code MCP inputs block non-interactive launch before starting delegates", async () => {
  const { adapter, extensionInstallState, tempDir } = loadModules()
  const workspace = path.join(tempDir, "installed-gallery-missing-inputs")
  fs.mkdirSync(workspace, { recursive: true })
  let delegateStarted = false

  extensionInstallState.updateExtensionInstallRecord("publisher.gallery-missing-input", {
    status: "installed",
    enabled: true,
    version: "2.0.0",
    installPath: path.join(tempDir, "extensions", "publisher.gallery-missing-input"),
    mcpGalleryServer: {
      id: "gallery-server-id",
      name: "io.modelcontextprotocol.filesystem",
      displayName: "Filesystem MCP",
      version: "2.0.0",
      configuration: {
        packages: [{
          registryType: "npm",
          identifier: "@modelcontextprotocol/server-filesystem",
          version: "2.0.0",
          packageArguments: [{
            type: "positional",
            value: "{root}",
            variables: {
              root: {
                description: "Workspace root",
                default: "${workspaceFolder}",
              },
            },
          }],
        }],
      },
    },
  }, { filePath: path.join(tempDir, "User", "extensions", "install-state.json") })

  const delegate = adapter.registerMcpDelegate({
    priority: 100,
    waitForInitialProviderPromises: async () => {},
    canStart: () => true,
    substituteVariables: async (_definition, launch) => launch,
    start: async () => {
      delegateStarted = true
      throw new Error("delegate should not start while inputs are unresolved")
    },
  })

  try {
    const applied = await adapter.applyActiveProfileFromProject(workspace, { mcpAccess: "registry" })
    assert.equal(applied.installedServers.length, 1)
    assert.deepEqual(applied.installedServers[0].args, [
      "@modelcontextprotocol/server-filesystem@2.0.0",
      "${input:root}",
    ])

    const listed = adapter.listConfiguredMcpServers()
    const installedServer = listed.find((server) => server.serverName === "io.modelcontextprotocol.filesystem")
    assert.ok(installedServer)
    assert.deepEqual(installedServer.config.inputs.map((input) => ({
      id: input.id,
      password: input.password,
      default: input.default,
    })), [
      { id: "root", password: false, default: "${workspaceFolder}" },
    ])

    await assert.rejects(
      () => adapter.connectMcpServer("io.modelcontextprotocol.filesystem"),
      (error) => {
        assert.equal(error.code, "MCP_INPUT_REQUIRED")
        assert.match(error.message, /MCP input required/)
        assert.match(error.message, /root/)
        assert.deepEqual(error.missingInputs.map((input) => ({
          id: input.id,
          password: input.password,
          default: input.default,
        })), [
          { id: "root", password: false, default: "${workspaceFolder}" },
        ])
        return true
      },
    )
    assert.equal(delegateStarted, false)
  } finally {
    delegate.dispose()
    await adapter.clearInstalledMcpServers()
  }
})

test("installed MCP discovery reports invalid gallery metadata without dropping contribution fallback", async () => {
  const { adapter, extensionInstallState, tempDir } = loadModules()
  const workspace = path.join(tempDir, "installed-gallery-invalid")
  fs.mkdirSync(workspace, { recursive: true })

  extensionInstallState.updateExtensionInstallRecord("publisher.invalid-gallery-mcp", {
    status: "installed",
    enabled: true,
    mcpGalleryServer: {
      name: "invalid.gallery",
      version: "1.0.0",
      configuration: { packages: [] },
    },
    mcp: {
      servers: {
        fallbackServer: {
          command: "node",
          args: ["fallback.js"],
        },
      },
    },
  }, { filePath: path.join(tempDir, "User", "extensions", "install-state.json") })

  try {
    const applied = await adapter.applyActiveProfileFromProject(workspace, { mcpAccess: "registry" })

    assert.equal(applied.installedServers.length, 1)
    assert.equal(applied.installedServers[0].serverName, "fallbackServer")
    assert.ok(applied.errors.some((message) => message.includes("No server package found")))
  } finally {
    await adapter.clearInstalledMcpServers()
  }
})

test("installed MCP discovery carries VS Code gallery manifest web resources", async () => {
  const { adapter, extensionInstallState, settings, tempDir } = loadModules()
  const workspace = path.join(tempDir, "installed-gallery-resource-url")
  fs.mkdirSync(workspace, { recursive: true })
  settings.writeUserSettings({
    "chat.mcp.gallery.enabled": true,
    "chat.mcp.gallery.serviceUrl": "https://gallery.example.com",
    "chat.mcp.gallery.itemWebUrl": "https://gallery.example.com/items/{publisher}/{name}/{version}",
  })

  extensionInstallState.updateExtensionInstallRecord("publisher.gallery-resource", {
    status: "installed",
    enabled: true,
    installPath: path.join(tempDir, "extensions", "publisher.gallery-resource"),
    mcpGalleryServer: {
      id: "gallery-resource-id",
      name: "publisher.server",
      publisher: "publisher",
      version: "3.1.4",
      configuration: {
        packages: [{
          registryType: "npm",
          identifier: "publisher-server",
          version: "3.1.4",
        }],
      },
    },
  }, { filePath: path.join(tempDir, "User", "extensions", "install-state.json") })

  try {
    const applied = await adapter.applyActiveProfileFromProject(workspace, { mcpAccess: "registry" })

    assert.equal(applied.installedServers.length, 1)
    assert.equal(
      applied.installedServers[0].gallery,
      "https://gallery.example.com/items/publisher/publisher.server/3.1.4",
    )

    const listed = adapter.listConfiguredMcpServers()
    const installedServer = listed.find((server) => server.serverName === "publisher.server")
    assert.ok(installedServer)
    assert.equal(installedServer.config.gallery, "https://gallery.example.com/items/publisher/publisher.server/3.1.4")
  } finally {
    await adapter.clearInstalledMcpServers()
  }
})

test("discovers Cursor workspace .cursor/mcp.json servers", async () => {
  const { adapter, tempDir } = loadModules()
  const workspace = path.join(tempDir, "cursor-workspace")
  fs.mkdirSync(path.join(workspace, ".cursor"), { recursive: true })
  fs.writeFileSync(path.join(workspace, ".cursor", "mcp.json"), JSON.stringify({
    mcpServers: {
      cursorServer: {
        type: "remote",
        url: "http://127.0.0.1:4317/mcp",
        headers: { Authorization: "cursor-secret" },
      },
    },
  }), "utf8")

  try {
    const applied = await adapter.applyActiveProfileFromProject(workspace)

    assert.equal(applied.workspaceServers.length, 1)
    assert.equal(applied.workspaceServers[0].serverName, "cursorServer")
    assert.equal(applied.workspaceSources[0].source, "cursor-workspace")

    const listed = adapter.listConfiguredMcpServers()
    const cursorServer = listed.find((server) => server.serverName === "cursorServer")
    assert.ok(cursorServer)
    assert.equal(cursorServer.workspaceScoped, true)
    assert.equal(cursorServer.config.source, "cursor-workspace")
    assert.equal(cursorServer.config.sourceLabel, ".cursor/mcp.json")
    assert.equal(cursorServer.config.url, "http://127.0.0.1:4317/mcp")
    assert.deepEqual(cursorServer.config.headerKeys, ["Authorization"])
    assert.equal(JSON.stringify(listed).includes("cursor-secret"), false)
  } finally {
    await adapter.clearWorkspaceMcpServers()
  }
})

test("keeps profile MCP server name authoritative when workspace server collides", async () => {
  const { adapter, profileService, tempDir } = loadModules()
  const workspace = path.join(tempDir, "workspace-name-collision")
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, ".mcp.json"), JSON.stringify({
    mcpServers: {
      sameName: { command: "node", args: ["workspace-server.js"] },
    },
  }), "utf8")
  const resource = JSON.stringify({
    mcp: JSON.stringify({
      servers: {
        sameName: { command: "node", args: ["profile-server.js"] },
      },
    }),
  })
  profileService.writeWorkbenchProfileState({
    activeProfileId: "active",
    profiles: [{ id: "active", name: "Active", settings: {}, resources: { mcp: resource } }],
  })

  try {
    const applied = await adapter.applyActiveProfileFromProject(workspace)

    assert.equal(applied.servers[0].serverName, "sameName")
    assert.equal(applied.workspaceServers[0].serverName, "sameName@workspace")
    assert.equal(applied.workspaceServers[0].originalName, "sameName")

    const listed = adapter.listConfiguredMcpServers()
    const profileServer = listed.find((server) => server.serverName === "sameName")
    const workspaceServer = listed.find((server) => server.serverName === "sameName@workspace")
    assert.ok(profileServer)
    assert.ok(workspaceServer)
    assert.equal(profileServer.profileScoped, true)
    assert.equal(profileServer.workspaceScoped, false)
    assert.equal(workspaceServer.profileScoped, false)
    assert.equal(workspaceServer.workspaceScoped, true)
    assert.equal(workspaceServer.config.originalName, "sameName")

    const reused = await adapter.applyActiveProfileFromProject(workspace)
    assert.equal(reused.reused, true)
    assert.equal(reused.workspaceServers[0].serverName, "sameName@workspace")
  } finally {
    await adapter.clearProfileMcpServers()
    await adapter.clearWorkspaceMcpServers()
  }
})

test("reports invalid workspace MCP JSON without clearing profile servers", async () => {
  const { adapter, profileService, tempDir } = loadModules()
  const workspace = path.join(tempDir, "invalid-workspace-json")
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, ".mcp.json"), "{ invalid json", "utf8")
  const resource = JSON.stringify({
    mcp: JSON.stringify({
      servers: {
        profileServer: { command: "node", args: ["profile-server.js"] },
      },
    }),
  })
  profileService.writeWorkbenchProfileState({
    activeProfileId: "active",
    profiles: [{ id: "active", name: "Active", settings: {}, resources: { mcp: resource } }],
  })

  try {
    const applied = await adapter.applyActiveProfileFromProject(workspace)

    assert.equal(applied.servers.length, 1)
    assert.equal(applied.workspaceServers.length, 0)
    assert.ok(applied.errors.some((message) => message.startsWith(".mcp.json:")))

    const listed = adapter.listConfiguredMcpServers()
    assert.ok(listed.find((server) => server.serverName === "profileServer"))
  } finally {
    await adapter.clearProfileMcpServers()
    await adapter.clearWorkspaceMcpServers()
  }
})

test("registers extension MCP servers through VS Code-style collection lifecycle", async () => {
  const { adapter } = loadModules()
  const events = []
  const listener = adapter.onDidChangeMcpCollections((event) => events.push(event))

  try {
    const first = await adapter.applyExtensionMcpCollection({
      id: "publisher.sample/sample-provider",
      label: "Sample MCP",
      extensionId: "publisher.sample",
    }, [{
      id: "publisher.sample/one",
      label: "One",
      launch: { type: 1, command: "node", args: ["one.js"] },
    }])

    assert.equal(first.servers.length, 1)
    assert.equal(adapter.listMcpCollections().length, 1)
    assert.deepEqual(adapter.listMcpCollections()[0].serverNames, ["One"])
    assert.ok(adapter.listConfiguredMcpServers().find((server) => server.serverName === "One"))
    assert.equal(events.some((event) => event.reason === "add-server" && event.serverName === "One"), true)

    const second = await adapter.applyExtensionMcpCollection({
      id: "publisher.sample/sample-provider",
      label: "Sample MCP",
      extensionId: "publisher.sample",
    }, [{
      id: "publisher.sample/two",
      label: "Two",
      launch: { type: 1, command: "node", args: ["two.js"] },
    }])

    assert.equal(second.servers.length, 1)
    assert.equal(adapter.listConfiguredMcpServers().some((server) => server.serverName === "One"), false)
    assert.ok(adapter.listConfiguredMcpServers().find((server) => server.serverName === "Two"))
    assert.deepEqual(adapter.listMcpCollections()[0].serverNames, ["Two"])
    assert.equal(events.some((event) => event.reason === "remove-collection"), true)
  } finally {
    listener.dispose()
    await adapter.clearExtensionMcpServers()
  }
})

test("extension MCP collection honors access gate before registering collection", async () => {
  const { adapter } = loadModules()

  const skipped = await adapter.applyExtensionMcpCollection({
    id: "publisher.sample/sample-provider",
    label: "Sample MCP",
    extensionId: "publisher.sample",
  }, [{
    id: "publisher.sample/one",
    label: "One",
    launch: { type: 1, command: "node", args: ["one.js"] },
  }], { mcpAccess: "registry" })

  assert.equal(skipped.skipped, true)
  assert.deepEqual(skipped.servers, [])
  assert.deepEqual(adapter.listConfiguredMcpServers(), [])
  assert.deepEqual(adapter.listMcpCollections(), [])
})

test("MCP registry resolves connections through VS Code-style host delegates by priority", async () => {
  const { adapter } = loadModules()
  const calls = []
  let lowDelegateStarted = false
  let highDelegateClosed = false

  adapter.registerMcpCollection({
    id: "profile",
    label: "Profile MCP",
    source: "profile",
    scope: "profile",
  }, { replace: true })
  adapter.registerMcpServer({
    serverName: "delegateServer",
    type: "http",
    transport: "http",
    url: "http://127.0.0.1:1/mcp",
  }, { profileScoped: true, collectionId: "profile" })

  const low = adapter.registerMcpDelegate({
    priority: 1,
    waitForInitialProviderPromises: async () => calls.push("low:wait"),
    canStart: () => true,
    substituteVariables: async (_definition, launch) => launch,
    start: async () => {
      lowDelegateStarted = true
      throw new Error("low delegate should not start")
    },
  })
  const high = adapter.registerMcpDelegate({
    priority: 10,
    waitForInitialProviderPromises: async () => calls.push("high:wait"),
    canStart: (collection, definition) => {
      calls.push(`high:canStart:${collection.id}:${definition.id}`)
      return true
    },
    substituteVariables: async (definition, launch) => {
      calls.push(`high:substitute:${definition.label}`)
      return { ...launch, substituted: true }
    },
    start: async (collection, definition, launch) => {
      calls.push(`high:start:${collection.id}:${definition.id}:${launch.substituted}`)
      return {
        async send(message) {
          calls.push(`send:${message.method}`)
          if (message.method === "initialize") {
            return { protocolVersion: "2024-11-05" }
          }
          if (message.method === "tools/list") {
            return {
              tools: [{
                name: "delegated",
                description: "Delegated tool",
                inputSchema: { type: "object", properties: {} },
              }],
            }
          }
          return {}
        },
        sendNotification(message) {
          calls.push(`notify:${message.method}`)
        },
        async close() {
          highDelegateClosed = true
        },
      }
    },
  })

  try {
    const client = await adapter.connectMcpServer("delegateServer")

    assert.equal(client.initialized, true)
    assert.equal(lowDelegateStarted, false)
    assert.deepEqual(client.getToolDefinitions().map((tool) => tool.name), ["delegated"])
    assert.deepEqual(calls, [
      "high:wait",
      "low:wait",
      "high:canStart:profile:delegateServer",
      "high:substitute:delegateServer",
      "high:start:profile:delegateServer:true",
      "send:initialize",
      "notify:notifications/initialized",
      "send:tools/list",
    ])
  } finally {
    low.dispose()
    high.dispose()
    await adapter.clearProfileMcpServers()
  }

  assert.equal(highDelegateClosed, true)
})

test("subscribes to MCP resource updates through VS Code resources/subscribe notifications", async () => {
  const { adapter } = loadModules()
  const calls = []
  const listeners = new Set()

  adapter.registerMcpCollection({
    id: "profile",
    label: "Profile MCP",
    source: "profile",
    scope: "profile",
  }, { replace: true })
  adapter.registerMcpServer({
    serverName: "resourceWatchServer",
    type: "http",
    transport: "http",
    url: "http://127.0.0.1:1/mcp",
  }, { profileScoped: true, collectionId: "profile" })

  const delegate = adapter.registerMcpDelegate({
    priority: 20,
    waitForInitialProviderPromises: async () => {},
    canStart: () => true,
    substituteVariables: async (_definition, launch) => launch,
    start: async () => ({
      async send(message) {
        calls.push(`send:${message.method}:${message.params?.uri || ""}`)
        if (message.method === "initialize") {
          return {
            protocolVersion: "2024-11-05",
            capabilities: { resources: { subscribe: true } },
          }
        }
        if (message.method === "tools/list") return { tools: [] }
        return {}
      },
      sendNotification(message) {
        calls.push(`notify:${message.method}`)
      },
      onNotification(listener) {
        listeners.add(listener)
        return { dispose: () => listeners.delete(listener) }
      },
      async close() {},
    }),
  })

  const updated = []
  try {
    const subscription = await adapter.subscribeMcpResource(
      "resourceWatchServer",
      "file:///workspace/readme.md",
      (event) => updated.push(event),
    )
    for (const listener of listeners) {
      listener({
        jsonrpc: "2.0",
        method: "notifications/resources/updated",
        params: { uri: "file:///workspace/readme.md" },
      })
      listener({
        jsonrpc: "2.0",
        method: "notifications/resources/updated",
        params: { uri: "file:///workspace/other.md" },
      })
    }

    assert.deepEqual(updated, [{ serverName: "resourceWatchServer", uri: "file:///workspace/readme.md" }])
    assert.ok(calls.includes("send:resources/subscribe:file:///workspace/readme.md"))

    await subscription.dispose()
    for (const listener of listeners) {
      listener({
        jsonrpc: "2.0",
        method: "notifications/resources/updated",
        params: { uri: "file:///workspace/readme.md" },
      })
    }

    assert.equal(updated.length, 1)
    assert.ok(calls.includes("send:resources/unsubscribe:file:///workspace/readme.md"))
  } finally {
    delegate.dispose()
    await adapter.clearProfileMcpServers()
  }
})

test("subscribes to MCP resource updates from HTTP SSE streaming transport", async () => {
  const { adapter, profileService, tempDir } = loadModules()
  const { server, port, calls, requests, emit, streamCount, sessionId } = await startStreamingMcpHttpServer()
  const workspace = path.join(tempDir, "streaming-resource-workspace")
  const resource = JSON.stringify({
    mcp: JSON.stringify({
      servers: {
        streamingHttp: {
          type: "remote",
          url: `http://127.0.0.1:${port}/mcp`,
          streamUrl: `http://127.0.0.1:${port}/mcp`,
        },
      },
    }),
  })

  profileService.writeWorkbenchProfileState({
    activeProfileId: "stream-profile",
    profiles: [
      { id: "stream-profile", name: "Stream", settings: {}, resources: { mcp: resource } },
    ],
  })
  profileService.setProfileForWorkspace(workspace, "stream-profile")

  const updated = []
  try {
    await adapter.applyActiveProfileFromProject(workspace)
    const subscription = await adapter.subscribeMcpResource(
      "streamingHttp",
      "file:///workspace/readme.md",
      (event) => updated.push(event),
    )

    await new Promise((resolve) => {
      const startedAt = Date.now()
      const poll = () => {
        if (streamCount() > 0 || Date.now() - startedAt > 1000) return resolve()
        setTimeout(poll, 10)
      }
      poll()
    })
    assert.equal(streamCount(), 1)
    emit({
      jsonrpc: "2.0",
      method: "notifications/resources/updated",
      params: { uri: "file:///workspace/readme.md" },
    })
    emit({
      jsonrpc: "2.0",
      method: "notifications/resources/updated",
      params: { uri: "file:///workspace/other.md" },
    })
    await delay()

    assert.deepEqual(updated, [{ serverName: "streamingHttp", uri: "file:///workspace/readme.md" }])
    assert.ok(calls.includes("resources/subscribe"))
    assert.equal(requests.find((request) => request.rpc === "notifications/initialized")?.sessionId, sessionId())
    assert.equal(requests.find((request) => request.rpc === "tools/list")?.sessionId, sessionId())
    assert.equal(requests.find((request) => request.rpc === "resources/subscribe")?.sessionId, sessionId())

    await subscription.dispose()
    emit({
      jsonrpc: "2.0",
      method: "notifications/resources/updated",
      params: { uri: "file:///workspace/readme.md" },
    })
    await delay()

    assert.equal(updated.length, 1)
    assert.ok(calls.includes("resources/unsubscribe"))
  } finally {
    await adapter.clearProfileMcpServers()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("uses VS Code Streamable HTTP session id for GET backchannel and fanout", async () => {
  const { adapter, profileService, tempDir } = loadModules()
  const { server, port, calls, requests, emit, streamCount, sessionId } = await startStreamingMcpHttpServer()
  const workspace = path.join(tempDir, "streamable-http-workspace")
  const resource = JSON.stringify({
    mcp: JSON.stringify({
      servers: {
        streamableHttp: {
          type: "remote",
          transport: "streamable-http",
          url: `http://127.0.0.1:${port}/mcp`,
        },
      },
    }),
  })

  profileService.writeWorkbenchProfileState({
    activeProfileId: "streamable-profile",
    profiles: [
      { id: "streamable-profile", name: "Streamable", settings: {}, resources: { mcp: resource } },
    ],
  })
  profileService.setProfileForWorkspace(workspace, "streamable-profile")

  const first = []
  const second = []
  try {
    await adapter.applyActiveProfileFromProject(workspace)
    const subscriptionA = await adapter.subscribeMcpResource(
      "streamableHttp",
      "file:///workspace/readme.md",
      (event) => first.push(event),
    )
    const subscriptionB = await adapter.subscribeMcpResource(
      "streamableHttp",
      "file:///workspace/readme.md",
      (event) => second.push(event),
    )

    await new Promise((resolve) => {
      const startedAt = Date.now()
      const poll = () => {
        if (streamCount() > 0 || Date.now() - startedAt > 1000) return resolve()
        setTimeout(poll, 10)
      }
      poll()
    })

    assert.equal(streamCount(), 1)
    assert.equal(requests.find((request) => request.rpc === "notifications/initialized")?.sessionId, sessionId())
    assert.equal(requests.find((request) => request.method === "GET" && request.accept.includes("text/event-stream"))?.sessionId, sessionId())
    assert.ok(calls.filter((call) => call === "resources/subscribe").length >= 2)

    emit({
      jsonrpc: "2.0",
      method: "notifications/resources/updated",
      params: { uri: "file:///workspace/readme.md" },
    })
    await delay()

    assert.deepEqual(first, [{ serverName: "streamableHttp", uri: "file:///workspace/readme.md" }])
    assert.deepEqual(second, [{ serverName: "streamableHttp", uri: "file:///workspace/readme.md" }])

    await subscriptionA.dispose()
    emit({
      jsonrpc: "2.0",
      method: "notifications/resources/updated",
      params: { uri: "file:///workspace/readme.md" },
    })
    await delay()
    assert.equal(first.length, 1)
    assert.equal(second.length, 2)

    await subscriptionB.dispose()
    await delay()
    assert.ok(calls.includes("resources/unsubscribe"))

    await adapter.disconnectMcpServer("streamableHttp")
    await delay()
    assert.equal(streamCount(), 0)
  } finally {
    await adapter.clearProfileMcpServers()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("cleans up expired Streamable HTTP session and allows the next explicit initialize", async () => {
  const { adapter, profileService, tempDir } = loadModules()
  const serverState = await startExpiringStreamableMcpHttpServer()
  const { server, port, calls, requests, expireNext, streamCount } = serverState
  const workspace = path.join(tempDir, "streamable-expired-session-workspace")
  const resource = JSON.stringify({
    mcp: JSON.stringify({
      servers: {
        expiringHttp: {
          type: "remote",
          transport: "streamable-http",
          url: `http://127.0.0.1:${port}/mcp`,
        },
      },
    }),
  })

  profileService.writeWorkbenchProfileState({
    activeProfileId: "expired-session-profile",
    profiles: [
      { id: "expired-session-profile", name: "Expired", settings: {}, resources: { mcp: resource } },
    ],
  })
  profileService.setProfileForWorkspace(workspace, "expired-session-profile")

  try {
    await adapter.applyActiveProfileFromProject(workspace)
    const subscription = await adapter.subscribeMcpResource("expiringHttp", "file:///workspace/readme.md", () => {})
    await new Promise((resolve) => {
      const startedAt = Date.now()
      const poll = () => {
        if (streamCount() > 0 || Date.now() - startedAt > 1000) return resolve()
        setTimeout(poll, 10)
      }
      poll()
    })
    assert.equal(adapter.listConfiguredMcpServers()[0].initialized, true)
    assert.equal(streamCount(), 1)

    expireNext()
    await assert.rejects(
      () => adapter.readMcpResource("expiringHttp", "file:///workspace/readme.md"),
      /session expired/i,
    )
    await delay()

    const afterExpired = adapter.listConfiguredMcpServers()[0]
    assert.equal(afterExpired.initialized, false)
    assert.equal(afterExpired.transportState, null)
    assert.equal(streamCount(), 0)

    await adapter.connectMcpServer("expiringHttp")
    const afterReconnect = adapter.listConfiguredMcpServers()[0]
    assert.equal(afterReconnect.initialized, true)
    assert.equal(calls.filter((call) => call === "initialize").length, 2)
    const secondInitialize = requests.filter((request) => request.rpc === "initialize")[1]
    assert.equal(secondInitialize.sessionId, "")
    assert.notEqual(serverState.activeSessionId(), "")

    await subscription.dispose()
  } finally {
    await adapter.clearProfileMcpServers()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("records Streamable HTTP backchannel retry state without automatic reconnect", async () => {
  const { adapter, profileService, tempDir } = loadModules()
  const serverState = await startExpiringStreamableMcpHttpServer()
  const { server, port, requests, emit, streamCount } = serverState
  const workspace = path.join(tempDir, "streamable-manual-reconnect-workspace")
  const resource = JSON.stringify({
    mcp: JSON.stringify({
      servers: {
        retryBoundaryHttp: {
          type: "remote",
          transport: "streamable-http",
          url: `http://127.0.0.1:${port}/mcp`,
        },
      },
    }),
  })

  profileService.writeWorkbenchProfileState({
    activeProfileId: "manual-retry-profile",
    profiles: [
      { id: "manual-retry-profile", name: "Manual Retry", settings: {}, resources: { mcp: resource } },
    ],
  })
  profileService.setProfileForWorkspace(workspace, "manual-retry-profile")

  try {
    await adapter.applyActiveProfileFromProject(workspace)
    const subscription = await adapter.subscribeMcpResource("retryBoundaryHttp", "file:///workspace/readme.md", () => {})
    await new Promise((resolve) => {
      const startedAt = Date.now()
      const poll = () => {
        if (streamCount() > 0 || Date.now() - startedAt > 1000) return resolve()
        setTimeout(poll, 10)
      }
      poll()
    })
    emit("42", {
      jsonrpc: "2.0",
      method: "notifications/resources/updated",
      params: { uri: "file:///workspace/readme.md" },
    })
    await delay()
    const withEventId = adapter.listConfiguredMcpServers()[0]
    assert.equal(withEventId.transportState.lastEventId, "42")
    assert.equal(withEventId.transportState.retryAfter, "1500")
    assert.equal(withEventId.transportState.channelStatus, "open")
    assert.equal(withEventId.transportState.reconnectRequested, false)
    assert.equal(withEventId.transportState.userActionRequired, false)
    assert.equal(withEventId.transportState.noAutoRetry, false)
    assert.equal(requests.some((request) => request.lastEventId === "42"), false)

    await adapter.disconnectMcpServer("retryBoundaryHttp")
    await adapter.connectMcpServer("retryBoundaryHttp")
    const afterManualReconnect = adapter.listConfiguredMcpServers()[0]
    assert.equal(afterManualReconnect.initialized, true)
    assert.equal(afterManualReconnect.transportState.lastEventId, "")

    await subscription.dispose()
  } finally {
    await adapter.clearProfileMcpServers()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("exposes Streamable HTTP manual reconnect state without auto retrying the remote channel", async () => {
  const { adapter, profileService, tempDir } = loadModules()
  const serverState = await startUnavailableBackchannelMcpHttpServer()
  const { server, port, calls, requests } = serverState
  const workspace = path.join(tempDir, "streamable-remote-channel-state-workspace")
  const resource = JSON.stringify({
    mcp: JSON.stringify({
      servers: {
        remoteChannelHttp: {
          type: "remote",
          transport: "streamable-http",
          url: `http://127.0.0.1:${port}/mcp`,
        },
      },
    }),
  })

  profileService.writeWorkbenchProfileState({
    activeProfileId: "remote-channel-state-profile",
    profiles: [
      { id: "remote-channel-state-profile", name: "Remote Channel", settings: {}, resources: { mcp: resource } },
    ],
  })
  profileService.setProfileForWorkspace(workspace, "remote-channel-state-profile")

  try {
    await adapter.applyActiveProfileFromProject(workspace)
    await adapter.subscribeMcpResource("remoteChannelHttp", "file:///workspace/readme.md", () => {})
    await delay()

    const listed = adapter.listConfiguredMcpServers()[0]
    assert.equal(listed.initialized, true)
    assert.equal(listed.transportState.channelStatus, "error")
    assert.equal(listed.transportState.retryMode, "manual")
    assert.equal(listed.transportState.retryAfter, "9")
    assert.equal(listed.transportState.reconnectRequested, true)
    assert.equal(listed.transportState.userActionRequired, true)
    assert.equal(listed.transportState.noAutoRetry, true)
    assert.match(listed.transportState.lastBackchannelError, /503/)
    assert.equal(calls.filter((call) => call === "initialize").length, 1)
    assert.equal(requests.filter((request) => request.method === "GET").length, 1)

    await adapter.connectMcpServer("remoteChannelHttp")
    assert.equal(calls.filter((call) => call === "initialize").length, 1)
  } finally {
    await adapter.clearProfileMcpServers()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("auto reconnects transient Streamable HTTP backchannel disconnect with observable retry state", async () => {
  const { adapter, profileService, tempDir } = loadModules()
  const serverState = await startFlakyBackchannelMcpHttpServer()
  const { server, port, requests, streamRequests, streamCount } = serverState
  const workspace = path.join(tempDir, "streamable-auto-reconnect-workspace")
  const resource = JSON.stringify({
    mcp: JSON.stringify({
      servers: {
        flakyHttp: {
          type: "remote",
          transport: "streamable-http",
          url: `http://127.0.0.1:${port}/mcp`,
        },
      },
    }),
  })

  profileService.writeWorkbenchProfileState({
    activeProfileId: "auto-reconnect-profile",
    profiles: [
      { id: "auto-reconnect-profile", name: "Auto Reconnect", settings: {}, resources: { mcp: resource } },
    ],
  })
  profileService.setProfileForWorkspace(workspace, "auto-reconnect-profile")

  try {
    await adapter.applyActiveProfileFromProject(workspace)
    const subscription = await adapter.subscribeMcpResource("flakyHttp", "file:///workspace/readme.md", () => {})
    await new Promise((resolve) => {
      const startedAt = Date.now()
      const poll = () => {
        const state = adapter.listConfiguredMcpServers()[0].transportState || {}
        if (state.retryMode === "reconnecting" || Date.now() - startedAt > 1000) return resolve()
        setTimeout(poll, 10)
      }
      poll()
    })
    const reconnecting = adapter.listConfiguredMcpServers()[0].transportState
    assert.equal(reconnecting.retryMode, "reconnecting")
    assert.equal(reconnecting.retryAttempt, 1)
    assert.equal(reconnecting.retryBudget, 3)
    assert.equal(typeof reconnecting.nextRetryAt, "number")
    assert.match(reconnecting.lastError, /disconnected/i)
    assert.equal(reconnecting.channelStatus, "reconnecting")

    await new Promise((resolve) => {
      const startedAt = Date.now()
      const poll = () => {
        const state = adapter.listConfiguredMcpServers()[0].transportState || {}
        if ((streamRequests() >= 2 && state.channelStatus === "open") || Date.now() - startedAt > 1200) return resolve()
        setTimeout(poll, 10)
      }
      poll()
    })
    const recovered = adapter.listConfiguredMcpServers()[0].transportState
    assert.equal(streamRequests() >= 2, true)
    assert.equal(recovered.retryMode, "active")
    assert.equal(recovered.channelStatus, "open")
    assert.equal(recovered.nextRetryAt, undefined)
    assert.equal(requests.some((request) => request.method === "GET" && request.lastEventId === "7"), true)

    await subscription.dispose()
    await adapter.disconnectMcpServer("flakyHttp")
    await delay()
    assert.equal(streamCount(), 0)
  } finally {
    await adapter.clearProfileMcpServers()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("discards stale Streamable HTTP reconnect after unsubscribe and disconnect", async () => {
  const { adapter, profileService, tempDir } = loadModules()
  const serverState = await startFlakyBackchannelMcpHttpServer()
  const { server, port, streamRequests } = serverState
  const workspace = path.join(tempDir, "streamable-stale-reconnect-workspace")
  const resource = JSON.stringify({
    mcp: JSON.stringify({
      servers: {
        staleHttp: {
          type: "remote",
          transport: "streamable-http",
          url: `http://127.0.0.1:${port}/mcp`,
        },
      },
    }),
  })

  profileService.writeWorkbenchProfileState({
    activeProfileId: "stale-reconnect-profile",
    profiles: [
      { id: "stale-reconnect-profile", name: "Stale Reconnect", settings: {}, resources: { mcp: resource } },
    ],
  })
  profileService.setProfileForWorkspace(workspace, "stale-reconnect-profile")

  try {
    await adapter.applyActiveProfileFromProject(workspace)
    const subscription = await adapter.subscribeMcpResource("staleHttp", "file:///workspace/readme.md", () => {})
    await new Promise((resolve) => {
      const startedAt = Date.now()
      const poll = () => {
        const state = adapter.listConfiguredMcpServers()[0].transportState || {}
        if (state.retryMode === "reconnecting" || Date.now() - startedAt > 1000) return resolve()
        setTimeout(poll, 10)
      }
      poll()
    })
    await subscription.dispose()
    await adapter.disconnectMcpServer("staleHttp")
    const firstStreamRequests = streamRequests()
    await delay(120)

    assert.equal(streamRequests(), firstStreamRequests)
    assert.equal(adapter.listConfiguredMcpServers()[0].transportState, null)
  } finally {
    await adapter.clearProfileMcpServers()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("manual reconnect resets retry state without bypassing allowed server or OAuth checks", async () => {
  const { adapter, profileService, settings, tempDir } = loadModules()
  const serverState = await startFlakyBackchannelMcpHttpServer()
  const { server, port, streamRequests } = serverState
  const workspace = path.join(tempDir, "streamable-manual-reset-workspace")
  const resource = JSON.stringify({
    mcp: JSON.stringify({
      servers: {
        manualHttp: {
          type: "remote",
          transport: "streamable-http",
          url: `http://127.0.0.1:${port}/mcp`,
        },
        authBlockedHttp: {
          type: "remote",
          transport: "streamable-http",
          provider: "gateway",
          gateway: true,
          authRequired: true,
          authState: "pending",
          authorizationUrl: "https://gateway.example.test/oauth/authorize",
          url: `http://127.0.0.1:${port}/mcp`,
        },
      },
    }),
  })

  profileService.writeWorkbenchProfileState({
    activeProfileId: "manual-reset-profile",
    profiles: [
      { id: "manual-reset-profile", name: "Manual Reset", settings: {}, resources: { mcp: resource } },
    ],
  })
  profileService.setProfileForWorkspace(workspace, "manual-reset-profile")

  try {
    await adapter.applyActiveProfileFromProject(workspace)
    const subscription = await adapter.subscribeMcpResource("manualHttp", "file:///workspace/readme.md", () => {})
    await new Promise((resolve) => {
      const startedAt = Date.now()
      const poll = () => {
        const state = adapter.listConfiguredMcpServers().find((item) => item.serverName === "manualHttp")?.transportState || {}
        if (state.retryMode === "reconnecting" || Date.now() - startedAt > 1000) return resolve()
        setTimeout(poll, 10)
      }
      poll()
    })
    await adapter.restartMcpServer?.("manualHttp")
    await adapter.disconnectMcpServer("manualHttp")
    await adapter.connectMcpServer("manualHttp")
    const restarted = adapter.listConfiguredMcpServers().find((item) => item.serverName === "manualHttp")
    assert.equal(restarted.transportState.retryAttempt, 0)
    assert.equal(restarted.transportState.retryMode, "active")
    assert.equal(streamRequests() >= 2, true)

    settings.writeUserSettings({ "chat.mcp.access": "none" })
    await assert.rejects(() => adapter.restartMcpServer("manualHttp"), /chat\.mcp\.access/)
    settings.writeUserSettings({ "chat.mcp.access": "all" })
    await assert.rejects(() => adapter.restartMcpServer("authBlockedHttp"), /OAuth authorization/)

    await subscription.dispose()
  } finally {
    await adapter.clearProfileMcpServers()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("keeps non-streaming HTTP POST MCP subscribe as no-op fallback when server lacks subscribe capability", async () => {
  const { adapter, profileService, tempDir } = loadModules()
  const { server, port, calls } = await startMcpHttpServer()
  const workspace = path.join(tempDir, "http-post-resource-workspace")
  const resource = JSON.stringify({
    mcp: JSON.stringify({
      servers: {
        postOnlyHttp: {
          type: "remote",
          url: `http://127.0.0.1:${port}/mcp`,
        },
      },
    }),
  })

  profileService.writeWorkbenchProfileState({
    activeProfileId: "post-profile",
    profiles: [
      { id: "post-profile", name: "Post", settings: {}, resources: { mcp: resource } },
    ],
  })
  profileService.setProfileForWorkspace(workspace, "post-profile")

  const updated = []
  try {
    await adapter.applyActiveProfileFromProject(workspace)
    const subscription = await adapter.subscribeMcpResource(
      "postOnlyHttp",
      "file:///workspace/readme.md",
      (event) => updated.push(event),
    )
    await subscription.dispose()

    assert.equal(updated.length, 0)
    assert.equal(calls.includes("resources/subscribe"), false)
    assert.equal(calls.includes("resources/unsubscribe"), false)
  } finally {
    await adapter.clearProfileMcpServers()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("expresses MCP Gateway OAuth boundary without marking unauthorized server ready", async () => {
  const { adapter, profileService, tempDir } = loadModules()
  const workspace = path.join(tempDir, "gateway-auth-workspace")
  const resource = JSON.stringify({
    mcp: JSON.stringify({
      servers: {
        gatewayRemote: {
          type: "remote",
          transport: "streamable-http",
          provider: "gateway",
          gateway: true,
          authRequired: true,
          authState: "unauthorized",
          authorizationUrl: "https://gateway.example.test/oauth/authorize",
          authActionHint: "Sign in to Gateway",
          url: "https://gateway.example.test/mcp",
        },
        expiredGateway: {
          type: "remote",
          transport: "streamable-http",
          provider: "gateway",
          authRequired: true,
          authState: "expired",
          authorizationUrl: "https://gateway.example.test/oauth/authorize",
          url: "https://gateway.example.test/mcp",
        },
        authorizedGateway: {
          type: "remote",
          transport: "streamable-http",
          provider: "gateway",
          authRequired: true,
          authState: "authorized",
          url: "http://127.0.0.1:1/mcp",
        },
      },
    }),
  })

  profileService.writeWorkbenchProfileState({
    activeProfileId: "gateway-profile",
    profiles: [
      { id: "gateway-profile", name: "Gateway", settings: {}, resources: { mcp: resource } },
    ],
  })
  profileService.setProfileForWorkspace(workspace, "gateway-profile")

  await adapter.applyActiveProfileFromProject(workspace)

  const listed = adapter.listConfiguredMcpServers()
  const unauthorized = listed.find((server) => server.serverName === "gatewayRemote")
  const expired = listed.find((server) => server.serverName === "expiredGateway")
  const authorized = listed.find((server) => server.serverName === "authorizedGateway")
  assert.equal(unauthorized.initialized, false)
  assert.equal(unauthorized.allowed, false)
  assert.match(unauthorized.disabledReason, /OAuth authorization/)
  assert.equal(unauthorized.config.transportType, "streamable-http")
  assert.equal(unauthorized.config.gateway, true)
  assert.equal(unauthorized.config.authRequired, true)
  assert.equal(unauthorized.config.authState, "unauthorized")
  assert.equal(unauthorized.config.authorizationUrl, "https://gateway.example.test/oauth/authorize")
  assert.equal(unauthorized.config.authActionHint, "Sign in to Gateway")
  assert.equal(expired.allowed, false)
  assert.equal(expired.config.authState, "expired")
  assert.equal(expired.config.authorizationUrl, "https://gateway.example.test/oauth/authorize")
  assert.equal(authorized.allowed, true)
  assert.equal(authorized.config.authState, "authorized")

  await assert.rejects(
    () => adapter.connectMcpServer("gatewayRemote"),
    /OAuth authorization/,
  )
  await assert.rejects(
    () => adapter.readMcpResource("expiredGateway", "file:///workspace/readme.md"),
    /OAuth authorization/,
  )
  await assert.rejects(
    () => adapter.callMcpTool("gatewayRemote", "echo", { text: "blocked" }),
    /OAuth authorization/,
  )
  await adapter.clearProfileMcpServers()
})

test("allows Gateway reconnect after OAuth state changes to authorized", async () => {
  const { adapter, profileService, tempDir } = loadModules()
  const { server, port, calls } = await startMcpHttpServer()
  const workspace = path.join(tempDir, "gateway-auth-state-change-workspace")
  const resourceForState = (authState) => JSON.stringify({
    mcp: JSON.stringify({
      servers: {
        gatewayRemote: {
          type: "remote",
          transport: "streamable-http",
          provider: "gateway",
          gateway: true,
          authRequired: true,
          authState,
          authorizationUrl: "https://gateway.example.test/oauth/authorize",
          url: `http://127.0.0.1:${port}/mcp`,
        },
      },
    }),
  })

  try {
    profileService.writeWorkbenchProfileState({
      activeProfileId: "gateway-state-profile",
      profiles: [
        { id: "gateway-state-profile", name: "Gateway State", settings: {}, resources: { mcp: resourceForState("unauthorized") } },
      ],
    })
    profileService.setProfileForWorkspace(workspace, "gateway-state-profile")
    await adapter.applyActiveProfileFromProject(workspace)
    await assert.rejects(() => adapter.connectMcpServer("gatewayRemote"), /OAuth authorization/)
    assert.equal(calls.includes("initialize"), false)

    profileService.writeWorkbenchProfileState({
      activeProfileId: "gateway-state-profile-authorized",
      profiles: [
        { id: "gateway-state-profile-authorized", name: "Gateway State", settings: {}, resources: { mcp: resourceForState("authorized") } },
      ],
    })
    profileService.setProfileForWorkspace(workspace, "gateway-state-profile-authorized")
    await adapter.applyActiveProfileFromProject(workspace)
    await adapter.connectMcpServer("gatewayRemote")

    assert.equal(adapter.listConfiguredMcpServers()[0].initialized, true)
    assert.equal(calls.includes("initialize"), true)
  } finally {
    await adapter.clearProfileMcpServers()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("VS Code AllowedMcpServers service marks and blocks configured servers when access is none", async () => {
  const { adapter, settings } = loadModules()
  settings.writeUserSettings({ "chat.mcp.access": "none" })
  adapter.registerMcpServer({
    serverName: "blockedByAccess",
    type: "http",
    transport: "http",
    url: "http://127.0.0.1:1/mcp",
  }, { profileScoped: true, collectionId: "profile" })

  const listed = adapter.listConfiguredMcpServers()
  assert.equal(listed[0].allowed, false)
  assert.match(listed[0].disabledReason, /chat\.mcp\.access/)

  await assert.rejects(() => adapter.connectMcpServer("blockedByAccess"), /chat\.mcp\.access/)
  await adapter.clearProfileMcpServers()
})
