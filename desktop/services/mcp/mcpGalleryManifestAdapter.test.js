const assert = require("node:assert/strict")
const test = require("node:test")

const {
  McpGalleryManifestStatus,
  McpGalleryResourceType,
  SUPPORTED_VERSIONS,
  createMcpGalleryManifest,
  getConfiguredMcpGalleryProduct,
  getMcpGalleryManifestResourceUri,
  getMcpGalleryManifestStatus,
  normalizeServiceUrl,
  resolveMcpGalleryServerResourceUri,
} = require("./mcpGalleryManifestAdapter")

test("creates VS Code-style MCP gallery manifest resources for product service", () => {
  const manifest = createMcpGalleryManifest("https://gallery.example.com/", "v0", {
    serviceUrl: "https://gallery.example.com",
    itemWebUrl: "https://gallery.example.com/items/{name}/{version}",
    publisherUrl: "https://gallery.example.com/publishers/{publisher}",
    supportUrl: "https://gallery.example.com/support",
    privacyPolicyUrl: "https://gallery.example.com/privacy",
    termsOfServiceUrl: "https://gallery.example.com/terms",
    reportUrl: "https://gallery.example.com/report/{name}",
  })

  assert.deepEqual(SUPPORTED_VERSIONS, ["v0.1", "v0"])
  assert.equal(manifest.version, "v0")
  assert.equal(manifest.url, "https://gallery.example.com")
  assert.equal(
    getMcpGalleryManifestResourceUri(manifest, McpGalleryResourceType.McpServersQueryService),
    "https://gallery.example.com/v0/servers",
  )
  assert.equal(
    getMcpGalleryManifestResourceUri(manifest, McpGalleryResourceType.McpServerIdUri),
    "https://gallery.example.com/v0/servers/{id}",
  )
  assert.ok(manifest.resources.find((resource) => resource.type === McpGalleryResourceType.McpServerWebUri))
  assert.ok(manifest.resources.find((resource) => resource.type === McpGalleryResourceType.PublisherUriTemplate))
})

test("matches MCP gallery manifest resources by optional version suffix", () => {
  const manifest = {
    version: "v0.1",
    url: "https://gallery.example.com",
    resources: [
      { id: "https://gallery.example.com/v0.1/servers", type: `${McpGalleryResourceType.McpServersQueryService}/v0.1` },
      { id: "https://gallery.example.com/v0/servers", type: `${McpGalleryResourceType.McpServersQueryService}/v0` },
    ],
  }

  assert.equal(
    getMcpGalleryManifestResourceUri(manifest, `${McpGalleryResourceType.McpServersQueryService}/v0.1`),
    "https://gallery.example.com/v0.1/servers",
  )
  assert.equal(
    getMcpGalleryManifestResourceUri(manifest, McpGalleryResourceType.McpServersQueryService),
    "https://gallery.example.com/v0.1/servers",
  )
})

test("resolves MCP gallery server resource URI templates without leaking unknown placeholders", () => {
  const manifest = createMcpGalleryManifest("https://gallery.example.com", "v0.1", {
    serviceUrl: "https://gallery.example.com",
    itemWebUrl: "https://gallery.example.com/items/{publisher}/{name}/{version}",
  })

  const uri = resolveMcpGalleryServerResourceUri(manifest, McpGalleryResourceType.McpServerWebUri, {
    id: "server-id",
    name: "server-name",
    publisher: "publisher",
    version: "1.2.3",
  })

  assert.equal(uri, "https://gallery.example.com/items/publisher/server-name/1.2.3")
})

test("reads MCP gallery service config from settings and env with VS Code-style status", () => {
  assert.equal(normalizeServiceUrl("https://gallery.example.com///"), "https://gallery.example.com")
  assert.equal(getMcpGalleryManifestStatus({ settings: {}, env: {} }), McpGalleryManifestStatus.Unavailable)

  const fromSettings = getConfiguredMcpGalleryProduct({
    settings: {
      "chat.mcp.gallery.enabled": true,
      "chat.mcp.gallery.serviceUrl": "https://settings.example.com/",
      "chat.mcp.gallery.itemWebUrl": "https://settings.example.com/items/{name}",
    },
    env: {},
  })
  assert.equal(fromSettings.serviceUrl, "https://settings.example.com")
  assert.equal(fromSettings.itemWebUrl, "https://settings.example.com/items/{name}")
  assert.equal(getMcpGalleryManifestStatus({ productGallery: fromSettings }), McpGalleryManifestStatus.Available)

  const disabled = getConfiguredMcpGalleryProduct({
    settings: { "chat.mcp.gallery.enabled": false, "chat.mcp.gallery.serviceUrl": "https://settings.example.com" },
    env: { CODEK_MCP_GALLERY_SERVICE_URL: "https://env.example.com" },
  })
  assert.equal(disabled, null)

  const fromEnv = getConfiguredMcpGalleryProduct({
    settings: {},
    env: { CODEK_MCP_GALLERY_SERVICE_URL: "https://env.example.com/" },
  })
  assert.equal(fromEnv.serviceUrl, "https://env.example.com")
})
