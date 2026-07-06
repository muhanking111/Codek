const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  canInstallGalleryMcpServer,
  getInstalledGalleryMcpServers,
  installGalleryMcpServer,
  onDidInstallMcpServers,
  onDidUninstallMcpServer,
  onDidUpdateMcpServers,
  onInstallMcpServer,
  onUninstallMcpServer,
  uninstallGalleryMcpServer,
  updateGalleryMcpServerMetadata,
} = require("./mcpGalleryInstallAdapter")
const installState = require("../extensions-host/extensionInstallState")

function tmpStateFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-mcp-gallery-install-"))
  return path.join(dir, "install-state.json")
}

function tmpMetadataRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codek-mcp-gallery-metadata-"))
}

function galleryServer(overrides = {}) {
  return {
    id: "gallery-id",
    name: "io.modelcontextprotocol.filesystem",
    displayName: "Filesystem MCP",
    description: "Filesystem tools",
    version: "1.0.0",
    galleryUrl: "https://modelcontextprotocol.io/server/filesystem",
    repositoryUrl: "https://github.com/modelcontextprotocol/servers",
    readme: "# Filesystem",
    configuration: {
      packages: [{
        registryType: "npm",
        identifier: "@modelcontextprotocol/server-filesystem",
        version: "1.0.0",
      }],
    },
    ...overrides,
  }
}

test("installs VS Code gallery MCP server into shared install state", async () => {
  const filePath = tmpStateFile()
  const metadataRoot = tmpMetadataRoot()

  const local = await installGalleryMcpServer(galleryServer(), {
    filePath,
    metadataRoot,
    now: () => "2026-06-21T00:00:00.000Z",
  })

  assert.equal(local.name, "io.modelcontextprotocol.filesystem")
  assert.equal(local.source, "gallery")
  assert.equal(local.config.command, "npx")
  assert.deepEqual(local.config.args, ["@modelcontextprotocol/server-filesystem@1.0.0"])

  const state = installState.readExtensionInstallState({ filePath })
  const record = state.extensions["mcp-gallery.io.modelcontextprotocol.filesystem"]
  assert.equal(record.status, "installed")
  assert.equal(record.source, "mcp-gallery")
  assert.equal(record.enabled, true)
  assert.equal(record.mcpGalleryServer.name, "io.modelcontextprotocol.filesystem")
  assert.equal(record.mcpGalleryServer.version, "1.0.0")
  assert.equal(record.mcpGalleryServerReadme, "# Filesystem")
  assert.equal(record.installPath, path.join(metadataRoot, "io.modelcontextprotocol.filesystem-1.0.0"))
  assert.equal(JSON.parse(fs.readFileSync(path.join(record.installPath, "manifest.json"), "utf8")).galleryId, "gallery-id")
  assert.equal(fs.readFileSync(path.join(record.installPath, "README.md"), "utf8"), "# Filesystem")
  assert.equal(local.location, record.installPath)
})

test("fetches README metadata during gallery MCP install when only readmeUrl is present", async () => {
  const filePath = tmpStateFile()
  const metadataRoot = tmpMetadataRoot()
  const calls = []

  await installGalleryMcpServer(galleryServer({
    readme: undefined,
    readmeUrl: "https://raw.githubusercontent.com/modelcontextprotocol/servers/main/README.md",
  }), {
    filePath,
    metadataRoot,
    getReadme: async (server) => {
      calls.push(server.name)
      return "# Remote README"
    },
  })

  const record = installState.getExtensionInstallRecord("mcp-gallery.io.modelcontextprotocol.filesystem", { filePath })
  assert.deepEqual(calls, ["io.modelcontextprotocol.filesystem"])
  assert.equal(record.mcpGalleryServerReadme, "# Remote README")
})

test("lists installed gallery MCP servers from the existing extension install state", async () => {
  const filePath = tmpStateFile()
  const metadataRoot = tmpMetadataRoot()
  await installGalleryMcpServer(galleryServer(), { filePath, metadataRoot })

  const installed = getInstalledGalleryMcpServers({ filePath })

  assert.equal(installed.length, 1)
  assert.equal(installed[0].name, "io.modelcontextprotocol.filesystem")
  assert.equal(installed[0].displayName, "Filesystem MCP")
  assert.equal(installed[0].source, "gallery")
})

test("updates gallery metadata without losing install config or existing record fields", async () => {
  const filePath = tmpStateFile()
  const metadataRoot = tmpMetadataRoot()
  await installGalleryMcpServer(galleryServer(), { filePath, metadataRoot })
  installState.updateExtensionInstallRecord("mcp-gallery.io.modelcontextprotocol.filesystem", {
    customFlag: "keep",
  }, { filePath })

  const updated = await updateGalleryMcpServerMetadata(
    { name: "io.modelcontextprotocol.filesystem" },
    galleryServer({
      version: "2.0.0",
      description: "Updated filesystem tools",
      configuration: {
        packages: [{
          registryType: "npm",
          identifier: "@modelcontextprotocol/server-filesystem",
          version: "2.0.0",
        }],
      },
      readme: "# Filesystem v2",
    }),
    { filePath, metadataRoot },
  )

  assert.equal(updated.version, "2.0.0")
  assert.deepEqual(updated.config.args, ["@modelcontextprotocol/server-filesystem@2.0.0"])

  const record = installState.getExtensionInstallRecord("mcp-gallery.io.modelcontextprotocol.filesystem", { filePath })
  assert.equal(record.customFlag, "keep")
  assert.equal(record.mcpGalleryServer.description, "Updated filesystem tools")
  assert.equal(record.mcpGalleryServerReadme, "# Filesystem v2")
  assert.equal(record.installPath, path.join(metadataRoot, "io.modelcontextprotocol.filesystem-2.0.0"))
  assert.equal(JSON.parse(fs.readFileSync(path.join(record.installPath, "manifest.json"), "utf8")).version, "2.0.0")
  assert.equal(fs.readFileSync(path.join(record.installPath, "README.md"), "utf8"), "# Filesystem v2")
})

test("uninstalls a gallery-only MCP server without deleting unrelated extension MCP metadata", async () => {
  const filePath = tmpStateFile()
  const metadataRoot = tmpMetadataRoot()
  await installGalleryMcpServer(galleryServer(), { filePath, metadataRoot })
  installState.updateExtensionInstallRecord("publisher.extension", {
    id: "publisher.extension",
    enabled: true,
    status: "installed",
    mcp: { servers: { legacy: { command: "node" } } },
    mcpGalleryServers: [galleryServer({ id: "other-gallery-id", name: "other.server" })],
  }, { filePath })

  const beforeUninstall = installState.getExtensionInstallRecord("mcp-gallery.io.modelcontextprotocol.filesystem", { filePath })
  assert.equal(fs.existsSync(beforeUninstall.installPath), true)

  const result = await uninstallGalleryMcpServer("io.modelcontextprotocol.filesystem", { filePath, metadataRoot })

  assert.equal(result.uninstalled, true)
  const galleryOnly = installState.getExtensionInstallRecord("mcp-gallery.io.modelcontextprotocol.filesystem", { filePath })
  assert.equal(galleryOnly.enabled, false)
  assert.equal(galleryOnly.status, "uninstalled")
  assert.equal(galleryOnly.mcpGalleryServer, undefined)
  assert.equal(fs.existsSync(beforeUninstall.installPath), false)

  const extensionRecord = installState.getExtensionInstallRecord("publisher.extension", { filePath })
  assert.deepEqual(extensionRecord.mcp, { servers: { legacy: { command: "node" } } })
  assert.equal(extensionRecord.mcpGalleryServers.length, 1)
})

test("respects chat.mcp.access when checking install permission", () => {
  const denied = canInstallGalleryMcpServer(galleryServer(), {
    allowedMcpServersService: {
      isAllowed: () => ({ value: "blocked by settings" }),
    },
  })
  assert.notEqual(denied, true)
  assert.match(denied.value, /blocked by settings/)

  assert.equal(canInstallGalleryMcpServer(galleryServer(), {
    allowedMcpServersService: { isAllowed: () => true },
  }), true)
})

test("emits VS Code-style MCP management lifecycle events for install update and uninstall", async () => {
  const filePath = tmpStateFile()
  const metadataRoot = tmpMetadataRoot()
  const events = []
  const disposables = [
    onInstallMcpServer((event) => events.push(["install:start", event.name, event.mcpResource])),
    onDidInstallMcpServers((results) => events.push(["install:did", results.map((result) => [result.name, Boolean(result.local), Boolean(result.error), result.mcpResource])])),
    onDidUpdateMcpServers((results) => events.push(["update:did", results.map((result) => [result.name, Boolean(result.local), Boolean(result.error), result.mcpResource])])),
    onUninstallMcpServer((event) => events.push(["uninstall:start", event.name, event.mcpResource])),
    onDidUninstallMcpServer((event) => events.push(["uninstall:did", event.name, Boolean(event.error), event.mcpResource])),
  ]

  try {
    await installGalleryMcpServer(galleryServer(), {
      filePath,
      metadataRoot,
      mcpResource: "D:\\Project\\demo.code-workspace",
    })
    await updateGalleryMcpServerMetadata(
      { name: "io.modelcontextprotocol.filesystem" },
      galleryServer({ version: "2.0.0" }),
      { filePath, metadataRoot, mcpResource: "D:\\Project\\demo.code-workspace" },
    )
    await uninstallGalleryMcpServer("io.modelcontextprotocol.filesystem", {
      filePath,
      metadataRoot,
      mcpResource: "D:\\Project\\demo.code-workspace",
    })
  } finally {
    for (const disposable of disposables) disposable.dispose()
  }

  assert.deepEqual(events, [
    ["install:start", "io.modelcontextprotocol.filesystem", "D:\\Project\\demo.code-workspace"],
    ["install:did", [["io.modelcontextprotocol.filesystem", true, false, "D:\\Project\\demo.code-workspace"]]],
    ["update:did", [["io.modelcontextprotocol.filesystem", true, false, "D:\\Project\\demo.code-workspace"]]],
    ["uninstall:start", "io.modelcontextprotocol.filesystem", "D:\\Project\\demo.code-workspace"],
    ["uninstall:did", "io.modelcontextprotocol.filesystem", false, "D:\\Project\\demo.code-workspace"],
  ])
})
