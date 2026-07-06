const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

function loadAgentTools() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-agent-tools-"))
  const previous = process.env.CODEK_DATA
  process.env.CODEK_DATA = tempDir
  for (const modulePath of [
    "../settings",
    "../userDataProfile",
    "../mcp/mcpAccess",
    "../mcp/profileMcpAdapter",
    "./tools",
  ]) {
    delete require.cache[require.resolve(modulePath)]
  }
  const settings = require("../settings")
  const profileService = require("../userDataProfile")
  const mcpAdapter = require("../mcp/profileMcpAdapter")
  const tools = require("./tools")
  if (previous == null) delete process.env.CODEK_DATA
  else process.env.CODEK_DATA = previous
  return { mcpAdapter, profileService, settings, tempDir, tools }
}

test("agent tools expose profile MCP list and call tools with policy flags", () => {
  const { tools } = loadAgentTools()
  const schemas = tools.listSchemas()
  const listSchema = schemas.find((schema) => schema.name === "mcp_list_tools")
  const callSchema = schemas.find((schema) => schema.name === "mcp_call_tool")

  assert.equal(listSchema.autoAuthorize, true)
  assert.deepEqual(listSchema.flags, { mutates: false, network: false, pathArgs: [] })
  assert.equal(callSchema.autoAuthorize, false)
  assert.equal(callSchema.flags.mutates, true)
  assert.equal(callSchema.flags.network, true)
})

test("mcp_list_tools reads active profile and workspace servers without leaking env or header values", async () => {
  const { profileService, tempDir, tools } = loadAgentTools()
  const workspace = path.join(tempDir, "workspace")
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, ".mcp.json"), JSON.stringify({
    mcpServers: {
      workspaceServer: {
        type: "remote",
        url: "http://127.0.0.1:4317/mcp",
        headers: { Authorization: "workspace-secret" },
      },
    },
  }), "utf8")
  const resource = JSON.stringify({
    mcp: JSON.stringify({
      servers: {
        profileServer: {
          command: "node",
          args: ["server.js"],
          env: { API_TOKEN: "secret" },
        },
      },
    }),
  })
  profileService.writeWorkbenchProfileState({
    activeProfileId: "active",
    profiles: [{ id: "active", name: "Active", settings: {}, resources: { mcp: resource } }],
  })

  const result = await tools.getTool("mcp_list_tools").execute({}, { projectRoot: workspace })

  assert.equal(result.structured.activeProfileId, "active")
  const profileServer = result.structured.servers.find((server) => server.serverName === "profileServer")
  const workspaceServer = result.structured.servers.find((server) => server.serverName === "workspaceServer")
  assert.ok(profileServer)
  assert.ok(workspaceServer)
  assert.deepEqual(profileServer.config.envKeys, ["API_TOKEN"])
  assert.equal(workspaceServer.workspaceScoped, true)
  assert.equal(workspaceServer.config.source, "workspace-dot-mcp")
  assert.deepEqual(workspaceServer.config.headerKeys, ["Authorization"])
  assert.equal(JSON.stringify(result).includes("secret"), false)
})

test("mcp_list_tools reads VS Code .code-workspace settings.mcp through tool context", async () => {
  const { tempDir, tools } = loadAgentTools()
  const workspace = path.join(tempDir, "workspace-settings-tool")
  const workspaceFile = path.join(tempDir, "demo.code-workspace")
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(workspaceFile, JSON.stringify({
    folders: [{ path: workspace }],
    settings: {
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

  const result = await tools.getTool("mcp_list_tools").execute({}, { projectRoot: workspace, workspaceFile })

  const workspaceServer = result.structured.servers.find((server) => server.serverName === "workspaceSettingsServer")
  assert.ok(workspaceServer)
  assert.equal(workspaceServer.workspaceScoped, true)
  assert.equal(workspaceServer.config.source, "workspace-settings-mcp")
  assert.equal(workspaceServer.config.sourcePath, workspaceFile)
  assert.deepEqual(workspaceServer.config.envKeys, ["API_TOKEN"])
  assert.equal(JSON.stringify(result).includes("workspace-settings-secret"), false)
})

test("mcp_list_tools honors VS Code chat.mcp.access none without loading configured servers", async () => {
  const { mcpAdapter, profileService, settings, tempDir, tools } = loadAgentTools()
  const workspace = path.join(tempDir, "workspace-disabled")
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, ".mcp.json"), JSON.stringify({
    mcpServers: {
      workspaceServer: {
        command: "node",
        args: ["server.js"],
        env: { API_TOKEN: "workspace-secret" },
      },
    },
  }), "utf8")
  profileService.writeWorkbenchProfileState({
    activeProfileId: "active",
    profiles: [{
      id: "active",
      name: "Active",
      settings: {},
      resources: {
        mcp: JSON.stringify({
          mcp: JSON.stringify({
            servers: {
              profileServer: { command: "node", args: ["profile-server.js"] },
            },
          }),
        }),
      },
    }],
  })
  settings.writeUserSettings({ "chat.mcp.access": "none" })
  await mcpAdapter.applyExtensionMcpCollection({
    id: "publisher.sample/sample-provider",
    label: "Sample MCP",
    extensionId: "publisher.sample",
  }, [{
    id: "publisher.sample/local",
    label: "Local Tooling",
    cacheNonce: "v1",
    launch: { type: 1, command: "node", args: ["server.js"], env: { API_TOKEN: "extension-secret" } },
  }])
  assert.equal(mcpAdapter.listConfiguredMcpServers().some((server) => server.extensionScoped), true)

  const result = await tools.getTool("mcp_list_tools").execute({}, { projectRoot: workspace })

  assert.equal(result.structured.mcpAccess, "none")
  assert.deepEqual(result.structured.servers, [])
  assert.deepEqual(result.structured.tools, [])
  assert.match(result.content, /chat\.mcp\.access/)
  assert.equal(JSON.stringify(result).includes("workspace-secret"), false)
  assert.equal(JSON.stringify(result).includes("extension-secret"), false)
  assert.deepEqual(mcpAdapter.listConfiguredMcpServers(), [])
})

test("mcp_list_tools honors VS Code chat.mcp.access registry by skipping workspace discovery", async () => {
  const { mcpAdapter, settings, tempDir, tools } = loadAgentTools()
  const workspace = path.join(tempDir, "workspace-registry-access")
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, ".mcp.json"), JSON.stringify({
    mcpServers: {
      workspaceServer: {
        command: "node",
        args: ["server.js"],
      },
    },
  }), "utf8")
  await mcpAdapter.applyExtensionMcpCollection({
    id: "publisher.sample/sample-provider",
    label: "Sample MCP",
    extensionId: "publisher.sample",
  }, [{
    id: "publisher.sample/local",
    label: "Local Tooling",
    cacheNonce: "v1",
    launch: { type: 1, command: "node", args: ["server.js"], env: {} },
  }])
  assert.equal(mcpAdapter.listConfiguredMcpServers().some((server) => server.extensionScoped), true)
  settings.writeUserSettings({ "chat.mcp.access": "registry" })

  const result = await tools.getTool("mcp_list_tools").execute({}, { projectRoot: workspace })

  assert.equal(result.structured.mcpAccess, "registry")
  assert.deepEqual(result.structured.servers, [])
  assert.deepEqual(result.structured.tools, [])
  assert.deepEqual(mcpAdapter.listConfiguredMcpServers(), [])
})

test("mcp_call_tool honors VS Code chat.mcp.access registry by not resolving workspace MCP servers", async () => {
  const { mcpAdapter, settings, tempDir, tools } = loadAgentTools()
  const workspace = path.join(tempDir, "workspace-registry-call")
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, ".mcp.json"), JSON.stringify({
    mcpServers: {
      workspaceServer: {
        command: "node",
        args: ["server.js"],
      },
    },
  }), "utf8")
  settings.writeUserSettings({ "chat.mcp.access": "registry" })

  await assert.rejects(
    () => tools.getTool("mcp_call_tool").execute({
      serverName: "workspaceServer",
      toolName: "echo",
    }, { projectRoot: workspace }),
    /not configured/,
  )
  assert.deepEqual(mcpAdapter.listConfiguredMcpServers(), [])
})

test("mcp_call_tool honors VS Code chat.mcp.access none when called outside policy router", async () => {
  const { mcpAdapter, settings, tools } = loadAgentTools()
  settings.writeUserSettings({ "chat.mcp.access": "none" })
  mcpAdapter.registerMcpServer({
    serverName: "blockedServer",
    type: "http",
    transport: "http",
    url: "http://127.0.0.1:1/mcp",
  }, { profileScoped: true })

  await assert.rejects(
    () => tools.getTool("mcp_call_tool").execute({
      serverName: "blockedServer",
      toolName: "echo",
      arguments: { text: "blocked" },
    }, { projectRoot: process.cwd() }),
    /chat\.mcp\.access/,
  )
  assert.deepEqual(mcpAdapter.listConfiguredMcpServers(), [])
})

test("mcp_call_tool returns VS Code MCP input metadata with active profile scope", async () => {
  const { tools } = loadAgentTools()
  const error = new Error("MCP input required")
  error.code = "MCP_INPUT_REQUIRED"
  error.missingInputs = [{ id: "root", password: false }]

  const result = tools.buildMcpInputRequiredResult(error, {
    serverName: "fs",
    toolName: "read_file",
    activeProfileId: "profile-a",
  })

  assert.equal(result.isError, true)
  assert.deepEqual(result.structured, {
    code: "MCP_INPUT_REQUIRED",
    serverName: "fs",
    toolName: "read_file",
    profileId: "profile-a",
    activeProfileId: "profile-a",
    missingInputs: [{ id: "root", password: false }],
  })
})
