const assert = require("node:assert/strict")
const test = require("node:test")

const {
  RegistryType,
  getInstallableMcpServersFromInstalledRecord,
  getMcpServerConfigurationFromManifest,
  toInstallableMcpServerFromGallery,
} = require("./mcpManagementAdapter")

test("converts VS Code gallery package manifest to installable stdio config", () => {
  const result = getMcpServerConfigurationFromManifest({
    packages: [{
      registryType: "npm",
      identifier: "@modelcontextprotocol/server-filesystem",
      version: "1.2.3",
      registryBaseUrl: "https://registry.npmjs.org",
      runtimeArguments: [{ type: "named", name: "--stdio" }],
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
  }, RegistryType.NODE)

  assert.equal(result.mcpServerConfiguration.config.type, "stdio")
  assert.equal(result.mcpServerConfiguration.config.command, "npx")
  assert.deepEqual(result.mcpServerConfiguration.config.args, [
    "--stdio",
    "--registry",
    "https://registry.npmjs.org",
    "@modelcontextprotocol/server-filesystem@1.2.3",
    "${input:root}",
  ])
  assert.deepEqual(result.mcpServerConfiguration.config.env, {
    API_TOKEN: "${input:API_TOKEN}",
  })
  assert.deepEqual(result.mcpServerConfiguration.inputs.map((input) => [input.id, input.password]), [
    ["API_TOKEN", true],
    ["root", false],
  ])
})

test("converts VS Code gallery remote manifest and strips Copilot authorization header", () => {
  const result = getMcpServerConfigurationFromManifest({
    remotes: [{
      type: "streamable-http",
      url: "https://api.githubcopilot.com/mcp/example",
      headers: [
        { name: "Authorization", value: "Bearer static" },
        {
          name: "X-Workspace",
          value: "{workspace}",
          variables: {
            workspace: { description: "Workspace", default: "${workspaceFolderBasename}" },
          },
        },
      ],
    }],
  }, RegistryType.REMOTE)

  assert.equal(result.mcpServerConfiguration.config.type, "http")
  assert.equal(result.mcpServerConfiguration.config.url, "https://api.githubcopilot.com/mcp/example")
  assert.deepEqual(result.mcpServerConfiguration.config.headers, {
    "X-Workspace": "${input:workspace}",
  })
  assert.deepEqual(result.mcpServerConfiguration.inputs.map((input) => input.id), ["workspace"])
})

test("builds installed-record MCP servers from VS Code gallery metadata", () => {
  const servers = getInstallableMcpServersFromInstalledRecord({
    id: "publisher.gallery-mcp",
    status: "installed",
    enabled: true,
    mcpGalleryServer: {
      id: "gallery-id",
      name: "io.modelcontextprotocol.filesystem",
      displayName: "Filesystem MCP",
      description: "Filesystem tools",
      version: "2.0.0",
      galleryUrl: "https://modelcontextprotocol.io/server/filesystem",
      configuration: {
        packages: [{
          registryType: "pypi",
          identifier: "mcp-server-filesystem",
          version: "2.0.0",
        }],
      },
    },
  })

  assert.equal(servers.length, 1)
  assert.equal(servers[0].name, "io.modelcontextprotocol.filesystem")
  assert.equal(servers[0].displayName, "Filesystem MCP")
  assert.equal(servers[0].galleryId, "gallery-id")
  assert.equal(servers[0].config.command, "uvx")
  assert.deepEqual(servers[0].config.args, ["mcp-server-filesystem@2.0.0"])
  assert.equal(servers[0].config.gallery, "https://modelcontextprotocol.io/server/filesystem")
})

test("derives gallery server web URL from VS Code MCP gallery manifest resources", () => {
  const servers = getInstallableMcpServersFromInstalledRecord({
    mcpGalleryServer: {
      id: "gallery-id",
      name: "io.modelcontextprotocol.filesystem",
      publisher: "io.modelcontextprotocol",
      version: "2.0.0",
      configuration: {
        packages: [{
          registryType: "npm",
          identifier: "@modelcontextprotocol/server-filesystem",
          version: "2.0.0",
        }],
      },
    },
  }, {
    productGallery: {
      serviceUrl: "https://gallery.example.com",
      itemWebUrl: "https://gallery.example.com/items/{publisher}/{name}/{version}",
      publisherUrl: "https://gallery.example.com/publishers/{publisher}",
      supportUrl: "https://gallery.example.com/support",
      privacyPolicyUrl: "https://gallery.example.com/privacy",
      termsOfServiceUrl: "https://gallery.example.com/terms",
      reportUrl: "https://gallery.example.com/report/{name}",
    },
  })

  assert.equal(servers.length, 1)
  assert.equal(
    servers[0].gallery,
    "https://gallery.example.com/items/io.modelcontextprotocol/io.modelcontextprotocol.filesystem/2.0.0",
  )
  assert.equal(servers[0].resourceGalleryUrl, servers[0].gallery)
  assert.equal(servers[0].config.gallery, servers[0].gallery)
})

test("returns null for gallery entries without installable configuration", () => {
  assert.equal(toInstallableMcpServerFromGallery({
    name: "missing-config",
    version: "1.0.0",
  }), null)
})
