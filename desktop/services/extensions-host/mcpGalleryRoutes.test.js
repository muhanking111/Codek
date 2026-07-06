const assert = require("node:assert/strict")
const test = require("node:test")

const router = require("../router")

function loadExtensionsHostWithGalleryMock(
  serviceMock,
  installMock = {},
  scannerMock = null,
  profileRegistryMock = null,
  inputStorageMock = null,
) {
  delete require.cache[require.resolve("../mcp/mcpGalleryServiceAdapter")]
  require.cache[require.resolve("../mcp/mcpGalleryServiceAdapter")] = {
    id: require.resolve("../mcp/mcpGalleryServiceAdapter"),
    filename: require.resolve("../mcp/mcpGalleryServiceAdapter"),
    loaded: true,
    exports: serviceMock,
  }
  delete require.cache[require.resolve("../mcp/mcpGalleryInstallAdapter")]
  require.cache[require.resolve("../mcp/mcpGalleryInstallAdapter")] = {
    id: require.resolve("../mcp/mcpGalleryInstallAdapter"),
    filename: require.resolve("../mcp/mcpGalleryInstallAdapter"),
    loaded: true,
    exports: {
      getInstalledGalleryMcpServers: () => [],
      canInstallGalleryMcpServer: () => true,
      installGalleryMcpServer: async () => ({}),
      updateGalleryMcpServerMetadata: async () => ({}),
      uninstallGalleryMcpServer: async () => ({ uninstalled: false }),
      ...installMock,
    },
  }
  delete require.cache[require.resolve("../mcp/mcpResourceScannerAdapter")]
  if (scannerMock) {
    require.cache[require.resolve("../mcp/mcpResourceScannerAdapter")] = {
      id: require.resolve("../mcp/mcpResourceScannerAdapter"),
      filename: require.resolve("../mcp/mcpResourceScannerAdapter"),
      loaded: true,
      exports: scannerMock,
    }
  }
  delete require.cache[require.resolve("../mcp/profileMcpAdapter")]
  if (profileRegistryMock) {
    require.cache[require.resolve("../mcp/profileMcpAdapter")] = {
      id: require.resolve("../mcp/profileMcpAdapter"),
      filename: require.resolve("../mcp/profileMcpAdapter"),
      loaded: true,
      exports: profileRegistryMock,
    }
  }
  delete require.cache[require.resolve("../mcp/mcpRegistryInputStorageAdapter")]
  if (inputStorageMock) {
    require.cache[require.resolve("../mcp/mcpRegistryInputStorageAdapter")] = {
      id: require.resolve("../mcp/mcpRegistryInputStorageAdapter"),
      filename: require.resolve("../mcp/mcpRegistryInputStorageAdapter"),
      loaded: true,
      exports: inputStorageMock,
    }
  }
  delete require.cache[require.resolve("./index")]
  return require("./index")
}

test("MCP gallery search route exposes VS Code-style first page", async () => {
  router.clearRoutes()
  const calls = []
  const extensionsHost = loadExtensionsHostWithGalleryMock({
    queryMcpGallery: async (query) => {
      calls.push(query)
      return {
        firstPage: { items: [{ name: "publisher.server" }], hasMore: true },
        getNextPage: async () => ({ items: [], hasMore: false }),
      }
    },
    getMcpServersFromGallery: async () => [],
    getMcpGalleryReadme: async () => "",
    isEnabled: () => "available",
  })
  extensionsHost.register(router)

  const result = await router.dispatch({
    method: "GET",
    path: "/extensions-host/mcp-gallery/search?q=git&pageSize=2",
  })

  assert.equal(result.ok, true)
  assert.deepEqual(calls, [{ text: "git", pageSize: 2 }])
  assert.deepEqual(result.data.servers, [{ name: "publisher.server" }])
  assert.equal(result.data.hasMore, true)
  assert.equal(result.data.status, "available")
})

test("MCP gallery search route advances the VS Code pager for requested pages", async () => {
  router.clearRoutes()
  const pageCalls = []
  const extensionsHost = loadExtensionsHostWithGalleryMock({
    queryMcpGallery: async (query) => {
      pageCalls.push(["query", query])
      return {
        firstPage: { items: [{ name: "publisher.first" }], hasMore: true },
        getNextPage: async () => {
          pageCalls.push(["next"])
          return { items: [{ name: "publisher.second" }], hasMore: false }
        },
      }
    },
    getMcpServersFromGallery: async () => [],
    getMcpGalleryReadme: async () => "",
    isEnabled: () => "available",
  })
  extensionsHost.register(router)

  const result = await router.dispatch({
    method: "GET",
    path: "/extensions-host/mcp-gallery/search?q=git&pageSize=1&page=2",
  })

  assert.equal(result.ok, true)
  assert.deepEqual(pageCalls, [["query", { text: "git", pageSize: 1 }], ["next"]])
  assert.deepEqual(result.data.servers, [{ name: "publisher.second" }])
  assert.equal(result.data.hasMore, false)
  assert.equal(result.data.page, 2)
})

test("MCP gallery servers route resolves by name/id without install side effects", async () => {
  router.clearRoutes()
  const calls = []
  const extensionsHost = loadExtensionsHostWithGalleryMock({
    queryMcpGallery: async () => ({ firstPage: { items: [], hasMore: false }, getNextPage: async () => ({ items: [], hasMore: false }) }),
    getMcpServersFromGallery: async (infos) => {
      calls.push(infos)
      return [{ name: infos[0].name, id: infos[0].id }]
    },
    getMcpGalleryReadme: async () => "",
    isEnabled: () => "available",
  })
  extensionsHost.register(router)

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/mcp-gallery/servers",
    body: { servers: [{ name: "publisher.server", id: "server-id" }] },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(calls, [[{ name: "publisher.server", id: "server-id" }]])
  assert.deepEqual(result.data.servers, [{ name: "publisher.server", id: "server-id" }])
})

test("MCP gallery readme route returns readme content for selected gallery server", async () => {
  router.clearRoutes()
  const calls = []
  const extensionsHost = loadExtensionsHostWithGalleryMock({
    queryMcpGallery: async () => ({ firstPage: { items: [], hasMore: false }, getNextPage: async () => ({ items: [], hasMore: false }) }),
    getMcpServersFromGallery: async () => [],
    getMcpGalleryReadme: async (gallery) => {
      calls.push(gallery)
      return "# README"
    },
    isEnabled: () => "available",
  })
  extensionsHost.register(router)

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/mcp-gallery/readme",
    body: { server: { name: "publisher.server", readmeUrl: "https://raw.githubusercontent.com/x/y/main/README.md" } },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(calls, [{ name: "publisher.server", readmeUrl: "https://raw.githubusercontent.com/x/y/main/README.md" }])
  assert.deepEqual(result.data, { readme: "# README" })
})

test("MCP gallery installed route reads VS Code-style management adapter", async () => {
  router.clearRoutes()
  const extensionsHost = loadExtensionsHostWithGalleryMock({
    queryMcpGallery: async () => ({ firstPage: { items: [], hasMore: false }, getNextPage: async () => ({ items: [], hasMore: false }) }),
    getMcpServersFromGallery: async () => [],
    getMcpGalleryReadme: async () => "",
    isEnabled: () => "available",
  }, {
    getInstalledGalleryMcpServers: () => [{ name: "publisher.server", source: "gallery" }],
  })
  extensionsHost.register(router)

  const result = await router.dispatch({
    method: "GET",
    path: "/extensions-host/mcp-gallery/installed",
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, {
    status: "available",
    servers: [{ name: "publisher.server", source: "gallery" }],
  })
})

test("MCP registry route exposes VS Code-style registry snapshots for Workbench consumers", async () => {
  router.clearRoutes()
  const extensionsHost = loadExtensionsHostWithGalleryMock({
    queryMcpGallery: async () => ({ firstPage: { items: [], hasMore: false }, getNextPage: async () => ({ items: [], hasMore: false }) }),
    getMcpServersFromGallery: async () => [],
    getMcpGalleryReadme: async () => "",
    isEnabled: () => "available",
  }, {}, null, {
    listMcpCollections: () => [{
      id: "profile",
      label: "Profile MCP",
      source: "profile",
      scope: "profile",
      order: 0,
      serverNames: ["profileServer"],
    }],
    listConfiguredMcpServers: () => [{
      serverName: "profileServer",
      allowed: true,
      initialized: false,
      config: { source: "profile" },
      tools: [],
    }],
    listMcpDelegates: () => [{ priority: 10 }],
  })
  extensionsHost.register(router)

  const result = await router.dispatch({
    method: "GET",
    path: "/extensions-host/mcp-registry",
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.collections.map((collection) => collection.id), ["profile"])
  assert.deepEqual(result.data.servers.map((server) => server.serverName), ["profileServer"])
  assert.deepEqual(result.data.delegates, [{ priority: 10 }])
})

test("MCP registry server lifecycle routes map VS Code command actions to profile registry", async () => {
  router.clearRoutes()
  const calls = []
  let initialized = false
  const profileRegistryMock = {
    listMcpCollections: () => [],
    listMcpDelegates: () => [],
    listConfiguredMcpServers: () => [{
      serverName: "profileServer",
      initialized,
      allowed: true,
      config: { source: "profile" },
      tools: initialized ? [{ name: "echo" }] : [],
    }],
    connectMcpServer: async (serverName) => {
      calls.push(["start", serverName])
      initialized = true
      return { serverName }
    },
    disconnectMcpServer: async (serverName) => {
      calls.push(["stop", serverName])
      initialized = false
      return { serverName }
    },
    restartMcpServer: async (serverName) => {
      calls.push(["restart", serverName])
      initialized = true
      return { serverName }
    },
  }
  const extensionsHost = loadExtensionsHostWithGalleryMock({
    queryMcpGallery: async () => ({ firstPage: { items: [], hasMore: false }, getNextPage: async () => ({ items: [], hasMore: false }) }),
    getMcpServersFromGallery: async () => [],
    getMcpGalleryReadme: async () => "",
    isEnabled: () => "available",
  }, {}, null, profileRegistryMock)
  extensionsHost.register(router)

  const started = await router.dispatch({
    method: "POST",
    path: "/extensions-host/mcp-registry/servers/profileServer/start",
  })
  const stopped = await router.dispatch({
    method: "POST",
    path: "/extensions-host/mcp-registry/servers/profileServer/stop",
  })
  const restarted = await router.dispatch({
    method: "POST",
    path: "/extensions-host/mcp-registry/servers/profileServer/restart",
  })

  assert.equal(started.ok, true)
  assert.equal(started.data.server.initialized, true)
  assert.equal(stopped.data.server.initialized, false)
  assert.equal(restarted.data.server.initialized, true)
  assert.deepEqual(calls, [
    ["start", "profileServer"],
    ["stop", "profileServer"],
    ["restart", "profileServer"],
  ])
})

test("MCP registry resource routes expose VS Code resource list/template/read actions", async () => {
  router.clearRoutes()
  const calls = []
  const profileRegistryMock = {
    listMcpCollections: () => [],
    listMcpDelegates: () => [],
    listConfiguredMcpServers: () => [{ serverName: "profileServer", initialized: true }],
    listMcpResources: async (serverName) => {
      calls.push(["resources", serverName])
      return [{ uri: "file:///workspace/readme.md", name: "readme.md" }]
    },
    listMcpResourceTemplates: async (serverName) => {
      calls.push(["templates", serverName])
      return [{ uriTemplate: "file:///workspace/{path}", name: "workspace-file" }]
    },
    readMcpResource: async (serverName, uri) => {
      calls.push(["read", serverName, uri])
      return [{ uri, text: "# README" }]
    },
    completeMcpResourceTemplate: async (serverName, request) => {
      calls.push(["complete", serverName, request])
      return { values: ["src/main.ts"], total: 1, hasMore: false }
    },
  }
  const extensionsHost = loadExtensionsHostWithGalleryMock({
    queryMcpGallery: async () => ({ firstPage: { items: [], hasMore: false }, getNextPage: async () => ({ items: [], hasMore: false }) }),
    getMcpServersFromGallery: async () => [],
    getMcpGalleryReadme: async () => "",
    isEnabled: () => "available",
  }, {}, null, profileRegistryMock)
  extensionsHost.register(router)

  const resources = await router.dispatch({
    method: "GET",
    path: "/extensions-host/mcp-registry/servers/profileServer/resources",
  })
  const templates = await router.dispatch({
    method: "GET",
    path: "/extensions-host/mcp-registry/servers/profileServer/resource-templates",
  })
  const read = await router.dispatch({
    method: "POST",
    path: "/extensions-host/mcp-registry/servers/profileServer/read-resource",
    body: { uri: "file:///workspace/readme.md" },
  })
  const completion = await router.dispatch({
    method: "POST",
    path: "/extensions-host/mcp-registry/servers/profileServer/resource-template-completions",
    body: {
      uriTemplate: "file:///workspace/{path}",
      variable: "path",
      value: "src",
      context: {},
    },
  })

  assert.equal(resources.ok, true)
  assert.deepEqual(resources.data.resources, [{ uri: "file:///workspace/readme.md", name: "readme.md" }])
  assert.deepEqual(templates.data.resourceTemplates, [{ uriTemplate: "file:///workspace/{path}", name: "workspace-file" }])
  assert.deepEqual(read.data.contents, [{ uri: "file:///workspace/readme.md", text: "# README" }])
  assert.deepEqual(completion.data.completion, { values: ["src/main.ts"], total: 1, hasMore: false })
  assert.deepEqual(calls, [
    ["resources", "profileServer"],
    ["templates", "profileServer"],
    ["read", "profileServer", "file:///workspace/readme.md"],
    ["complete", "profileServer", {
      uriTemplate: "file:///workspace/{path}",
      variable: "path",
      value: "src",
      context: {},
    }],
  ])
})

test("MCP registry input storage routes expose VS Code-style plain and secret input persistence", async () => {
  router.clearRoutes()
  const calls = []
  class MockInputStorage {
    constructor(options) {
      calls.push(["constructor", options.profileId])
    }

    async getMap() {
      calls.push(["getMap"])
      return { root: { value: "D:/Workspace" }, token: { value: "secret-token" } }
    }

    async setPlainText(values) {
      calls.push(["setPlainText", values])
    }

    async setSecrets(values) {
      calls.push(["setSecrets", values])
    }

    async clear(inputKey) {
      calls.push(["clear", inputKey])
    }

    async clearAll() {
      calls.push(["clearAll"])
    }
  }
  const extensionsHost = loadExtensionsHostWithGalleryMock({
    queryMcpGallery: async () => ({ firstPage: { items: [], hasMore: false }, getNextPage: async () => ({ items: [], hasMore: false }) }),
    getMcpServersFromGallery: async () => [],
    getMcpGalleryReadme: async () => "",
    isEnabled: () => "available",
  }, {}, null, null, {
    McpRegistryInputStorageAdapter: MockInputStorage,
  })
  extensionsHost.register(router)

  const read = await router.dispatch({
    method: "GET",
    path: "/extensions-host/mcp-registry/inputs?profileId=active",
  })
  const write = await router.dispatch({
    method: "PUT",
    path: "/extensions-host/mcp-registry/inputs",
    body: {
      profileId: "active",
      values: { root: { value: "D:/Workspace" } },
      secrets: { token: { value: "secret-token" } },
    },
  })
  const clearOne = await router.dispatch({
    method: "DELETE",
    path: "/extensions-host/mcp-registry/inputs/token",
    body: { profileId: "active" },
  })
  const clearAll = await router.dispatch({
    method: "DELETE",
    path: "/extensions-host/mcp-registry/inputs",
    body: { profileId: "active" },
  })

  assert.equal(read.ok, true)
  assert.deepEqual(read.data.inputs, { root: { value: "D:/Workspace" }, token: { value: "secret-token" } })
  assert.deepEqual(write.data, { success: true, inputs: { root: { value: "D:/Workspace" }, token: { value: "secret-token" } } })
  assert.deepEqual(clearOne.data, { success: true })
  assert.deepEqual(clearAll.data, { success: true })
  assert.deepEqual(calls, [
    ["constructor", "active"],
    ["getMap"],
    ["constructor", "active"],
    ["setPlainText", { root: { value: "D:/Workspace" } }],
    ["setSecrets", { token: { value: "secret-token" } }],
    ["getMap"],
    ["constructor", "active"],
    ["clear", "token"],
    ["constructor", "active"],
    ["clearAll"],
  ])
})

test("MCP gallery install route delegates to management adapter without profile resource side effects by default", async () => {
  router.clearRoutes()
  const calls = []
  const scannerCalls = []
  const extensionsHost = loadExtensionsHostWithGalleryMock({
    queryMcpGallery: async () => ({ firstPage: { items: [], hasMore: false }, getNextPage: async () => ({ items: [], hasMore: false }) }),
    getMcpServersFromGallery: async () => [],
    getMcpGalleryReadme: async () => "",
    isEnabled: () => "available",
  }, {
    installGalleryMcpServer: async (server, options) => {
      calls.push({ server, options })
      return { name: server.name, source: "gallery" }
    },
  }, {
    addProfileMcpServers: (...args) => scannerCalls.push(args),
    removeProfileMcpServers: (...args) => scannerCalls.push(args),
  })
  extensionsHost.register(router)

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/mcp-gallery/install",
    body: { server: { name: "publisher.server" }, packageType: "npm" },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(calls.map((call) => ({ server: call.server, packageType: call.options.packageType })), [
    { server: { name: "publisher.server" }, packageType: "npm" },
  ])
  assert.equal(typeof calls[0].options.getReadme, "function")
  assert.deepEqual(result.data, { success: true, server: { name: "publisher.server", source: "gallery" } })
  assert.deepEqual(scannerCalls, [])
})

test("MCP gallery install route persists provided VS Code input values after successful install", async () => {
  router.clearRoutes()
  const inputCalls = []
  class MockInputStorage {
    constructor(options) {
      inputCalls.push(["constructor", options.profileId])
    }

    async setPlainText(values) {
      inputCalls.push(["setPlainText", values])
    }

    async setSecrets(values) {
      inputCalls.push(["setSecrets", values])
    }
  }
  const extensionsHost = loadExtensionsHostWithGalleryMock({
    queryMcpGallery: async () => ({ firstPage: { items: [], hasMore: false }, getNextPage: async () => ({ items: [], hasMore: false }) }),
    getMcpServersFromGallery: async () => [],
    getMcpGalleryReadme: async () => "",
    isEnabled: () => "available",
  }, {
    installGalleryMcpServer: async (server) => ({
      name: server.name,
      inputs: [{ id: "root" }, { id: "token", password: true }],
      source: "gallery",
    }),
  }, null, null, {
    McpRegistryInputStorageAdapter: MockInputStorage,
  })
  extensionsHost.register(router)

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/mcp-gallery/install",
    body: {
      server: { name: "publisher.server" },
      profileId: "work",
      values: { root: { value: "D:/Project" } },
      secrets: { token: { value: "secret-token" } },
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(inputCalls, [
    ["constructor", "work"],
    ["setPlainText", { root: { value: "D:/Project" } }],
    ["setSecrets", { token: { value: "secret-token" } }],
  ])
  assert.deepEqual(result.data.savedInputs, {
    profileId: "work",
    values: ["root"],
    secrets: ["token"],
  })
  assert.equal(JSON.stringify(result.data.savedInputs).includes("secret-token"), false)
})

test("MCP gallery install and uninstall routes write profile MCP resource for explicit target", async () => {
  router.clearRoutes()
  const calls = []
  const scannerCalls = []
  const extensionsHost = loadExtensionsHostWithGalleryMock({
    queryMcpGallery: async () => ({ firstPage: { items: [], hasMore: false }, getNextPage: async () => ({ items: [], hasMore: false }) }),
    getMcpServersFromGallery: async () => [],
    getMcpGalleryReadme: async () => "",
    isEnabled: () => "available",
  }, {
    installGalleryMcpServer: async (server) => {
      calls.push(["install", server])
      return {
        name: server.name,
        config: { type: "local", command: "npx", args: ["server"] },
        inputs: [{ id: "root", type: "prompt" }],
        source: "gallery",
      }
    },
    uninstallGalleryMcpServer: async (name) => {
      calls.push(["uninstall", name])
      return { uninstalled: true, id: "mcp-gallery.publisher.server" }
    },
  }, {
    addMcpServers: (servers, options) => {
      scannerCalls.push(["add", servers, options])
      return { profileId: options.profileId, resource: "{\"servers\":{}}\n" }
    },
    removeMcpServers: (names, options) => {
      scannerCalls.push(["remove", names, options])
      return { profileId: options.profileId, resource: "" }
    },
  })
  extensionsHost.register(router)

  const installed = await router.dispatch({
    method: "POST",
    path: "/extensions-host/mcp-gallery/install",
    body: {
      server: { name: "publisher.server" },
      workspace: "D:\\Project",
      profileId: "work",
    },
  })
  const uninstalled = await router.dispatch({
    method: "POST",
    path: "/extensions-host/mcp-gallery/uninstall",
    body: {
      name: "publisher.server",
      workspace: "D:\\Project",
      profileId: "work",
    },
  })

  assert.equal(installed.ok, true)
  assert.equal(uninstalled.ok, true)
  assert.deepEqual(calls, [
    ["install", { name: "publisher.server" }],
    ["uninstall", "publisher.server"],
  ])
  assert.deepEqual(scannerCalls.map(([kind, payload, options]) => [kind, payload, {
    target: options.target,
    workspace: options.workspace,
    profileId: options.profileId,
    changeReason: options.changeReason,
  }]), [
    ["add", [{
      name: "publisher.server",
      config: { type: "local", command: "npx", args: ["server"] },
      inputs: [{ id: "root", type: "prompt" }],
      source: "gallery",
    }], { target: "user", workspace: "D:\\Project", profileId: "work", changeReason: "mcp-gallery:resource" }],
    ["remove", ["publisher.server"], { target: "user", workspace: "D:\\Project", profileId: "work", changeReason: "mcp-gallery:resource" }],
  ])
  assert.equal(installed.data.profileResource.profileId, "work")
  assert.equal(uninstalled.data.profileResource.resource, "")
})

test("MCP gallery install route passes explicit VS Code workspace target to resource scanner", async () => {
  router.clearRoutes()
  const scannerCalls = []
  const extensionsHost = loadExtensionsHostWithGalleryMock({
    queryMcpGallery: async () => ({ firstPage: { items: [], hasMore: false }, getNextPage: async () => ({ items: [], hasMore: false }) }),
    getMcpServersFromGallery: async () => [],
    getMcpGalleryReadme: async () => "",
    isEnabled: () => "available",
  }, {
    installGalleryMcpServer: async (server) => ({
      name: server.name,
      config: { type: "local", command: "npx" },
    }),
  }, {
    addMcpServers: (servers, options) => {
      scannerCalls.push(["add", servers, options])
      return { target: options.target, path: options.workspace }
    },
    removeMcpServers: () => {
      throw new Error("unexpected remove")
    },
  })
  extensionsHost.register(router)

  const installed = await router.dispatch({
    method: "POST",
    path: "/extensions-host/mcp-gallery/install",
    body: {
      server: { name: "publisher.server" },
      mcpTarget: "workspace",
      workspace: "D:\\Project\\demo.code-workspace",
    },
  })

  assert.equal(installed.ok, true)
  assert.deepEqual(scannerCalls.map(([kind, servers, options]) => [kind, servers[0].name, options.target, options.workspace]), [
    ["add", "publisher.server", "workspace", "D:\\Project\\demo.code-workspace"],
  ])
  assert.equal(installed.data.profileResource.target, "workspace")
})

test("MCP gallery install route infers VS Code workspace target from .code-workspace resource", async () => {
  router.clearRoutes()
  const scannerCalls = []
  const extensionsHost = loadExtensionsHostWithGalleryMock({
    queryMcpGallery: async () => ({ firstPage: { items: [], hasMore: false }, getNextPage: async () => ({ items: [], hasMore: false }) }),
    getMcpServersFromGallery: async () => [],
    getMcpGalleryReadme: async () => "",
    isEnabled: () => "available",
  }, {
    installGalleryMcpServer: async (server) => ({
      name: server.name,
      config: { type: "local", command: "npx" },
    }),
  }, {
    addMcpServers: (servers, options) => {
      scannerCalls.push(["add", servers, options])
      return { target: options.target, path: options.workspaceFile }
    },
    removeMcpServers: () => {
      throw new Error("unexpected remove")
    },
  })
  extensionsHost.register(router)

  const installed = await router.dispatch({
    method: "POST",
    path: "/extensions-host/mcp-gallery/install",
    body: {
      server: { name: "publisher.server" },
      workspaceFile: "D:\\Project\\demo.code-workspace",
    },
  })

  assert.equal(installed.ok, true)
  assert.deepEqual(scannerCalls.map(([kind, servers, options]) => [kind, servers[0].name, options.target, options.workspaceFile]), [
    ["add", "publisher.server", "workspace", "D:\\Project\\demo.code-workspace"],
  ])
  assert.equal(installed.data.profileResource.target, "workspace")
})

test("MCP gallery update and uninstall routes delegate to management adapter", async () => {
  router.clearRoutes()
  const calls = []
  const extensionsHost = loadExtensionsHostWithGalleryMock({
    queryMcpGallery: async () => ({ firstPage: { items: [], hasMore: false }, getNextPage: async () => ({ items: [], hasMore: false }) }),
    getMcpServersFromGallery: async () => [],
    getMcpGalleryReadme: async () => "",
    isEnabled: () => "available",
  }, {
    updateGalleryMcpServerMetadata: async (local, server, options) => {
      calls.push(["update", local, server, options])
      return { name: server.name, version: server.version }
    },
    uninstallGalleryMcpServer: async (name) => {
      calls.push(["uninstall", name])
      return { uninstalled: true, id: "mcp-gallery.publisher.server" }
    },
  })
  extensionsHost.register(router)

  const updated = await router.dispatch({
    method: "POST",
    path: "/extensions-host/mcp-gallery/update-metadata",
    body: { name: "publisher.server", server: { name: "publisher.server", version: "2.0.0" } },
  })
  const uninstalled = await router.dispatch({
    method: "POST",
    path: "/extensions-host/mcp-gallery/uninstall",
    body: { name: "publisher.server" },
  })

  assert.equal(updated.ok, true)
  assert.equal(uninstalled.ok, true)
  assert.deepEqual(calls.map((call) => call[0] === "update"
    ? [call[0], call[1], call[2], { packageType: call[3].packageType, hasGetReadme: typeof call[3].getReadme === "function" }]
    : call), [
    ["update", "publisher.server", { name: "publisher.server", version: "2.0.0" }, { packageType: undefined, hasGetReadme: true }],
    ["uninstall", "publisher.server"],
  ])
  assert.deepEqual(updated.data, { success: true, server: { name: "publisher.server", version: "2.0.0" } })
  assert.deepEqual(uninstalled.data, { success: true, uninstalled: true, id: "mcp-gallery.publisher.server" })
})
