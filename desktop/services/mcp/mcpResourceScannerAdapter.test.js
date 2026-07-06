const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

function loadModules() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-mcp-resource-scanner-"))
  const previous = process.env.CODEK_DATA
  process.env.CODEK_DATA = tempDir
  for (const modulePath of [
    "../userDataProfile",
    "../settings",
    "../extensions-host/extensionInstallState",
    "./mcpAccess",
    "./mcpManagementAdapter",
    "./profileMcpAdapter",
    "./mcpResourceScannerAdapter",
  ]) {
    delete require.cache[require.resolve(modulePath)]
  }
  const profileService = require("../userDataProfile")
  const profileAdapter = require("./profileMcpAdapter")
  const scanner = require("./mcpResourceScannerAdapter")
  if (previous == null) delete process.env.CODEK_DATA
  else process.env.CODEK_DATA = previous
  return { profileAdapter, profileService, scanner, tempDir }
}

test("adds VS Code-style installable MCP servers to profile resource and active registry", async () => {
  const { profileAdapter, profileService, scanner, tempDir } = loadModules()
  const workspace = path.join(tempDir, "workspace")
  profileService.writeWorkbenchProfileState({
    activeProfileId: "active",
    profiles: [{
      id: "active",
      name: "Active",
      settings: {},
      resources: {
        mcp: JSON.stringify({
          servers: {
            existing: { command: "node", args: ["existing.js"] },
          },
          inputs: [{ id: "root", type: "prompt", description: "Old root" }],
        }),
      },
    }],
  })

  scanner.addProfileMcpServers([{
    name: "galleryServer",
    config: {
      type: "local",
      command: "npx",
      args: ["@modelcontextprotocol/server-filesystem", "${input:root}"],
      env: { API_TOKEN: "${input:token}" },
      gallery: "https://gallery.example.com/items/filesystem",
      version: "1.0.0",
    },
    inputs: [
      { id: "root", type: "prompt", description: "Workspace root" },
      { id: "token", type: "prompt", password: true, description: "API token" },
    ],
  }], { workspace })

  const state = profileService.readWorkbenchProfileState({ workspace })
  const profile = state.profiles.find((entry) => entry.id === "active")
  const resource = JSON.parse(profile.resources.mcp)
  assert.deepEqual(Object.keys(resource.servers), ["existing", "galleryServer"])
  assert.deepEqual(resource.inputs.map((input) => input.id), ["root", "token"])
  assert.equal(resource.servers.galleryServer.gallery, "https://gallery.example.com/items/filesystem")

  const applied = await profileAdapter.applyActiveProfileFromProject(workspace)
  assert.equal(applied.servers.length, 2)
  const listed = profileAdapter.listConfiguredMcpServers()
  const gallery = listed.find((server) => server.serverName === "galleryServer")
  assert.ok(gallery)
  assert.equal(gallery.profileScoped, true)
  assert.equal(gallery.config.gallery, "https://gallery.example.com/items/filesystem")
  assert.deepEqual(gallery.config.envKeys, ["API_TOKEN"])
  await profileAdapter.clearProfileMcpServers()
})

test("removes MCP servers from profile resource and clears empty resource", () => {
  const { profileService, scanner, tempDir } = loadModules()
  const workspace = path.join(tempDir, "workspace")
  profileService.writeWorkbenchProfileState({
    activeProfileId: "active",
    profiles: [{
      id: "active",
      name: "Active",
      settings: {},
      resources: {
        mcp: JSON.stringify({
          servers: {
            onlyServer: { command: "node", args: ["server.js"] },
          },
        }),
      },
    }],
  })

  const result = scanner.removeProfileMcpServers(["onlyServer"], { workspace })

  assert.equal(result.resource, "")
  const state = profileService.readWorkbenchProfileState({ workspace })
  assert.equal(state.profiles[0].resources.mcp, undefined)
})

test("updates profile MCP sandbox config without dropping servers", () => {
  const { profileService, scanner, tempDir } = loadModules()
  const workspace = path.join(tempDir, "workspace")
  profileService.writeWorkbenchProfileState({
    activeProfileId: "active",
    profiles: [{
      id: "active",
      name: "Active",
      settings: {},
      resources: {
        mcp: JSON.stringify({
          servers: {
            server: { command: "node" },
          },
        }),
      },
    }],
  })

  scanner.updateProfileMcpSandboxConfig((data) => ({
    ...data,
    sandbox: { enabled: true, permissions: ["read"] },
  }), { workspace })

  const scanned = scanner.scanProfileMcpServers({ workspace }).scanned
  assert.deepEqual(Object.keys(scanned.servers), ["server"])
  assert.deepEqual(scanned.sandbox, { enabled: true, permissions: ["read"] })
})

test("writes VS Code workspace target settings.mcp without dropping existing workspace settings", () => {
  const { scanner, tempDir } = loadModules()
  const workspaceFile = path.join(tempDir, "demo.code-workspace")
  fs.writeFileSync(workspaceFile, JSON.stringify({
    folders: [{ path: "app" }],
    settings: {
      "editor.tabSize": 2,
      mcp: {
        servers: {
          existing: { command: "node", args: ["existing.js"] },
        },
      },
    },
  }, null, 2), "utf8")

  const added = scanner.addMcpServers([{
    name: "galleryServer",
    config: { type: "local", command: "npx", args: ["server"] },
    inputs: [{ id: "root", type: "prompt" }],
  }], { target: "workspace", workspace: workspaceFile })

  const afterAdd = JSON.parse(fs.readFileSync(workspaceFile, "utf8"))
  assert.equal(afterAdd.settings["editor.tabSize"], 2)
  assert.deepEqual(Object.keys(afterAdd.settings.mcp.servers), ["existing", "galleryServer"])
  assert.deepEqual(afterAdd.settings.mcp.inputs.map((input) => input.id), ["root"])
  assert.equal(added.target, "workspace")

  const removed = scanner.removeMcpServers(["galleryServer"], { target: "workspace", workspace: workspaceFile })
  const afterRemove = JSON.parse(fs.readFileSync(workspaceFile, "utf8"))
  assert.deepEqual(Object.keys(afterRemove.settings.mcp.servers), ["existing"])
  assert.equal(removed.target, "workspace")
})

test("writes VS Code workspace folder MCP resource as raw scanned servers", () => {
  const { scanner, tempDir } = loadModules()
  const workspace = path.join(tempDir, "workspace")
  fs.mkdirSync(workspace, { recursive: true })
  const resourcePath = path.join(workspace, ".mcp.json")

  scanner.addMcpServers([{
    name: "folderServer",
    config: { command: "node", args: ["folder.js"] },
  }], { target: "workspaceFolder", workspace })

  const resource = JSON.parse(fs.readFileSync(resourcePath, "utf8"))
  assert.deepEqual(Object.keys(resource.servers), ["folderServer"])
  assert.equal(resource.servers.folderServer.type, "local")
})
