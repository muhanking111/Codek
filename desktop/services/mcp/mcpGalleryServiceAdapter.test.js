const assert = require("node:assert/strict")
const test = require("node:test")

const {
  createMcpGalleryManifest,
} = require("./mcpGalleryManifestAdapter")
const {
  toInstallableMcpServerFromGallery,
} = require("./mcpManagementAdapter")
const {
  getMcpGalleryReadme,
  getMcpServersFromGallery,
  queryMcpGallery,
  serializeGalleryServerResult,
} = require("./mcpGalleryServiceAdapter")

function createResponse(data, status = 200) {
  const text = typeof data === "string" ? data : JSON.stringify(data)
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    text: async () => text,
    json: async () => (typeof data === "string" ? JSON.parse(data) : data),
  }
}

function galleryManifest(version = "v0.1") {
  return createMcpGalleryManifest("https://gallery.example.com", version, {
    serviceUrl: "https://gallery.example.com",
    itemWebUrl: "https://gallery.example.com/items/{name}",
    publisherUrl: "https://gallery.example.com/publishers/{name}",
    supportUrl: "https://gallery.example.com/support",
    privacyPolicyUrl: "https://gallery.example.com/privacy",
    termsOfServiceUrl: "https://gallery.example.com/terms",
    reportUrl: "https://gallery.example.com/report/{name}",
  })
}

test("queries VS Code v0.1 MCP gallery servers with pager cursor", async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url.includes("cursor=next-1")) {
      return createResponse({
        metadata: { count: 3 },
        servers: [{
          server: {
            name: "io.modelcontextprotocol.git",
            description: "Git tools",
            version: "2.0.0",
            title: "Git MCP",
            packages: [{ registryType: "npm", identifier: "mcp-git", version: "2.0.0", transport: { type: "stdio" } }],
          },
          _meta: {
            "io.modelcontextprotocol.registry/official": {
              status: "active",
              isLatest: true,
              publishedAt: "2026-01-02T00:00:00Z",
            },
          },
        }],
      })
    }
    return createResponse({
      metadata: { count: 3, nextCursor: "next-1" },
      servers: [{
        server: {
          name: "io.modelcontextprotocol.filesystem",
          description: "Filesystem tools",
          version: "1.0.0",
          repository: { source: "github", url: "https://github.com/modelcontextprotocol/servers" },
          packages: [{ registryType: "npm", identifier: "@modelcontextprotocol/server-filesystem", version: "1.0.0", transport: { type: "stdio" } }],
          _meta: {
            "io.modelcontextprotocol.registry/publisher-provided": {
              github: {
                name: "server-filesystem",
                nameWithOwner: "modelcontextprotocol/server-filesystem",
                readme: "https://raw.githubusercontent.com/modelcontextprotocol/server-filesystem/main/README.md",
                stargazerCount: 42,
              },
            },
          },
        },
        _meta: {
          "io.modelcontextprotocol.registry/official": {
            status: "active",
            isLatest: true,
            publishedAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-03T00:00:00Z",
          },
        },
      }],
    })
  }

  const pager = await queryMcpGallery({ text: "filesystem", pageSize: 1 }, {
    fetchImpl,
    manifest: galleryManifest("v0.1"),
  })

  assert.equal(pager.firstPage.items.length, 1)
  assert.equal(pager.firstPage.hasMore, true)
  assert.equal(pager.firstPage.items[0].displayName, "Server Filesystem")
  assert.equal(pager.firstPage.items[0].webUrl, "https://gallery.example.com/items/io.modelcontextprotocol.filesystem")
  assert.equal(pager.firstPage.items[0].publisherUrl, "https://gallery.example.com/publishers/modelcontextprotocol")
  assert.equal(pager.firstPage.items[0].configuration.packages[0].identifier, "@modelcontextprotocol/server-filesystem")

  const next = await pager.getNextPage()
  assert.equal(next.items[0].name, "io.modelcontextprotocol.git")
  assert.equal(next.hasMore, false)
  assert.ok(calls[0].includes("limit=1"))
  assert.ok(calls[0].includes("version=latest"))
  assert.ok(calls[0].includes("search=filesystem"))
  assert.ok(calls[1].includes("cursor=next-1"))
  assert.equal(calls[1].includes("search="), false)
})

test("query results can flow into MCP management installable config adapter", async () => {
  const fetchImpl = async () => createResponse({
    metadata: { count: 1 },
    servers: [{
      server: {
        name: "io.modelcontextprotocol.filesystem",
        description: "Filesystem tools",
        version: "1.0.0",
        packages: [{
          registryType: "npm",
          identifier: "@modelcontextprotocol/server-filesystem",
          version: "1.0.0",
          transport: { type: "stdio" },
        }],
      },
      _meta: { "io.modelcontextprotocol.registry/official": { status: "active", isLatest: true } },
    }],
  })

  const pager = await queryMcpGallery({ pageSize: 1 }, {
    fetchImpl,
    manifest: galleryManifest("v0.1"),
  })
  const installable = toInstallableMcpServerFromGallery(pager.firstPage.items[0], { productGallery: null })

  assert.equal(installable.name, "io.modelcontextprotocol.filesystem")
  assert.equal(installable.config.command, "npx")
  assert.deepEqual(installable.config.args, ["@modelcontextprotocol/server-filesystem@1.0.0"])
})

test("serializes VS Code v0 registry schema server result", () => {
  const result = serializeGalleryServerResult({
    metadata: { count: 1, next_cursor: "cursor-2" },
    servers: [{
      $schema: "https://static.modelcontextprotocol.io/schemas/2025-07-09/server.schema.json",
      name: "io.modelcontextprotocol.remote",
      description: "Remote tools",
      version: "3.0.0",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      remotes: [{ transport_type: "sse", url: "https://remote.example.com/mcp" }],
      _meta: {
        "io.modelcontextprotocol.registry/official": {
          id: "server-id",
          is_latest: true,
          published_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
        },
      },
    }],
  }, galleryManifest("v0"))

  assert.equal(result.metadata.nextCursor, "cursor-2")
  assert.equal(result.servers[0].id, "server-id")
  assert.equal(result.servers[0].remotes[0].type, "sse")
})

test("gets MCP gallery servers by latest, by-name, then by-id", async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url.endsWith("/versions/latest")) return createResponse({}, 404)
    if (url.includes("/by-name/")) {
      return createResponse({
        server: {
          name: "publisher.server",
          description: "Named server",
          version: "1.0.0",
          packages: [{ registryType: "npm", identifier: "publisher-server", version: "1.0.0", transport: { type: "stdio" } }],
        },
        _meta: { "io.modelcontextprotocol.registry/official": { status: "active", isLatest: true } },
      })
    }
    return createResponse({}, 500)
  }

  const servers = await getMcpServersFromGallery([{ name: "publisher.server", id: "server-id" }], {
    fetchImpl,
    manifest: galleryManifest("v0.1"),
  })

  assert.equal(servers.length, 1)
  assert.equal(servers[0].name, "publisher.server")
  assert.ok(calls[0].endsWith("/publisher.server/versions/latest"))
  assert.ok(calls[1].endsWith("/by-name/publisher.server"))
})

test("reads MCP gallery README from raw GitHub and links non-raw README in browser", async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, "https://raw.githubusercontent.com/example/server/main/README.md")
    return createResponse("# Server README")
  }

  assert.equal(await getMcpGalleryReadme({
    readmeUrl: "https://raw.githubusercontent.com/example/server/main/README.md",
  }, { fetchImpl }), "# Server README")

  assert.equal(
    await getMcpGalleryReadme({ readmeUrl: "https://github.com/example/server#readme" }),
    "You can find information about this server [here](https://github.com/example/server#readme)",
  )

  assert.equal(await getMcpGalleryReadme({}), "No README available")
})
