const assert = require("node:assert/strict")
const test = require("node:test")

const mainThreadSearch = require("./mainThreadSearch")
const { SearchProviderRegistry, SearchProviderType } = require("../../search/searchProviderRegistry")

function createServer() {
  const handlers = new Map()
  const events = new Map()
  return {
    handlers,
    isRunning: false,
    onRpc(method, handler) {
      handlers.set(method, handler)
    },
    on(event, handler) {
      const listeners = events.get(event) || []
      listeners.push(handler)
      events.set(event, listeners)
    },
    emit(event) {
      for (const listener of events.get(event) || []) listener()
    },
    call(method, args) {
      const handler = handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [], { reqId: 1 })
    },
  }
}

test("MainThreadSearch registers and unregisters extension text providers", async () => {
  const server = createServer()
  const registry = new SearchProviderRegistry()
  const calls = []
  mainThreadSearch.register(server, {
    searchProviderRegistry: registry,
    callEh: async (...args) => {
      calls.push(args)
      return { limitHit: true, messages: ["done"], stats: { type: "text" } }
    },
  })

  server.call("$registerTextSearchProvider", [7, "file"])
  const provider = registry.getSearchProvider(SearchProviderType.text, "file")
  assert.equal(typeof provider.textSearch, "function")

  const search = provider.textSearch({
    root: "D:/Workspace",
    query: "needle",
    folderQueries: [{ folder: { scheme: "file", path: "/D:/Workspace" } }],
  })
  server.call("$handleTextMatch", [7, 1, [{
    resource: { scheme: "file", authority: "", path: "/D:/Workspace/src/app.ts", query: "", fragment: "" },
    results: [{
      previewText: "const needle = true",
      rangeLocations: [{
        source: { startLineNumber: 3, startColumn: 7, endLineNumber: 3, endColumn: 13 },
        preview: { startLineNumber: 0, startColumn: 7, endLineNumber: 0, endColumn: 13 },
      }],
    }],
  }]])

  const result = await search
  const searchCall = calls.find((call) => call[1] === "$provideTextSearchResults")
  assert.equal(searchCall[0], mainThreadSearch.EXT_HOST_SEARCH_NID)
  assert.deepEqual(searchCall[2].slice(0, 2), [7, 1])
  assert.equal(searchCall[2][2].type, mainThreadSearch.QueryType.Text)
  assert.equal(searchCall[2][2].folderQueries[0].folder.$mid, 1)
  assert.equal(searchCall[2][2].folderQueries[0].folder.fsPath.toLowerCase(), "d:\\codek")
  assert.equal(searchCall[2].length, 3)
  assert.deepEqual(searchCall[4], { usesCancellationToken: true })
  assert.equal(result.engine, "extension-search")
  assert.equal(result.truncated, true)
  assert.equal(result.messages[0], "done")
  assert.deepEqual(result.matches, [{
    path: "src/app.ts",
    line: 3,
    column: 7,
    matchLength: 6,
    preview: "const needle = true",
  }])

  server.call("$unregisterProvider", [7])
  assert.equal(registry.getSearchProvider(SearchProviderType.text, "file"), null)
})

test("MainThreadSearch registers file providers and forwards file matches", async () => {
  const server = createServer()
  const registry = new SearchProviderRegistry()
  const calls = []
  mainThreadSearch.register(server, {
    searchProviderRegistry: registry,
    callEh: async (...args) => {
      calls.push(args)
      return { messages: [], stats: { type: "file" } }
    },
  })

  server.call("$registerFileSearchProvider", [9, "file"])
  const provider = registry.getSearchProvider(SearchProviderType.file, "file")
  const search = provider.fileSearch({
    root: "D:/Workspace",
    filePattern: "app",
    folderQueries: [{ folder: { scheme: "file", path: "/D:/Workspace" } }],
  })
  const searchCall = calls.find((call) => call[1] === "$provideFileSearchResults")
  const session = searchCall[2][1]
  server.call("$handleFileMatch", [9, session, [
    { scheme: "file", authority: "", path: "/D:/Workspace/src/app.ts", query: "", fragment: "" },
    { scheme: "file", authority: "", path: "/D:/Workspace/package.json", query: "", fragment: "" },
  ]])

  const result = await search
  assert.equal(searchCall[0], mainThreadSearch.EXT_HOST_SEARCH_NID)
  assert.equal(searchCall[2][2].type, mainThreadSearch.QueryType.File)
  assert.equal(searchCall[2][2].folderQueries[0].folder.$mid, 1)
  assert.equal(searchCall[2][2].folderQueries[0].folder.fsPath.toLowerCase(), "d:\\codek")
  assert.equal(searchCall[2].length, 3)
  assert.deepEqual(searchCall[4], { usesCancellationToken: true })
  assert.deepEqual(result.matches.map((match) => match.path), ["src/app.ts", "package.json"])
  assert.equal(result.visitedFiles, 2)
})

test("MainThreadSearch treats Windows drive letter casing as filesystem equivalent", async () => {
  const server = createServer()
  const registry = new SearchProviderRegistry()
  const calls = []
  mainThreadSearch.register(server, {
    searchProviderRegistry: registry,
    callEh: async (...args) => {
      calls.push(args)
      return { messages: [], stats: { type: "file", filesWalked: 1 } }
    },
  })

  server.call("$registerFileSearchProvider", [10, "file"])
  const provider = registry.getSearchProvider(SearchProviderType.file, "file")
  const search = provider.fileSearch({
    root: "D:/Workspace",
    filePattern: "app",
    folderQueries: [{ folder: { scheme: "file", path: "/D:/Workspace" } }],
  })
  const searchCall = calls.find((call) => call[1] === "$provideFileSearchResults")
  const session = searchCall[2][1]
  server.call("$handleFileMatch", [10, session, [
    { scheme: "file", authority: "", path: "/D:/Workspace/src/App.ts", fsPath: "d:\\Workspace\\src\\App.ts", query: "", fragment: "" },
  ]])

  const result = await search

  assert.equal(searchCall[2][2].folderQueries[0].folder.fsPath, "d:\\Workspace")
  assert.deepEqual(result.matches.map((match) => match.path), ["src/App.ts"])
})

test("MainThreadSearch fans clearCache through extension host", async () => {
  const server = createServer()
  const registry = new SearchProviderRegistry()
  const calls = []
  mainThreadSearch.register(server, {
    searchProviderRegistry: registry,
    callEh: async (...args) => {
      calls.push(args)
      return args[1] === "$provideTextSearchResults" ? { messages: [] } : undefined
    },
  })

  server.call("$registerTextSearchProvider", [11, "codek"])
  await registry.clearCache("workspace-cache")

  assert.deepEqual(
    calls.filter((call) => call[1] === "$clearCache"),
    [[mainThreadSearch.EXT_HOST_SEARCH_NID, "$clearCache", ["workspace-cache"]]],
  )
})

test("MainThreadSearch restores the previous scheme provider after extension unregister", async () => {
  const server = createServer()
  const registry = new SearchProviderRegistry()
  const baseProvider = {
    textSearch: async () => ({ engine: "base-provider", matches: [{ path: "base.ts" }] }),
  }
  registry.registerSearchResultProvider("file", SearchProviderType.text, baseProvider)
  mainThreadSearch.register(server, {
    searchProviderRegistry: registry,
    callEh: async () => ({ messages: [], stats: { type: "text" } }),
  })

  server.call("$registerTextSearchProvider", [13, "file"])

  assert.notEqual(registry.getSearchProvider(SearchProviderType.text, "file"), baseProvider)

  server.call("$unregisterProvider", [13])

  assert.equal(registry.getSearchProvider(SearchProviderType.text, "file"), baseProvider)
  assert.equal((await registry.runSearch(SearchProviderType.text, "file", {})).engine, "base-provider")
})

test("MainThreadSearch replacing the same handle only disposes that temporary provider", async () => {
  const server = createServer()
  const registry = new SearchProviderRegistry()
  const baseProvider = {
    textSearch: async () => ({ engine: "base-provider", matches: [{ path: "base.ts" }] }),
  }
  registry.registerSearchResultProvider("file", SearchProviderType.text, baseProvider)
  mainThreadSearch.register(server, {
    searchProviderRegistry: registry,
    callEh: async () => ({ messages: [], stats: { type: "text" } }),
  })

  server.call("$registerTextSearchProvider", [14, "file"])
  const firstTemporary = registry.getSearchProvider(SearchProviderType.text, "file")
  server.call("$registerTextSearchProvider", [14, "file"])
  const secondTemporary = registry.getSearchProvider(SearchProviderType.text, "file")

  assert.notEqual(firstTemporary, secondTemporary)
  assert.notEqual(secondTemporary, baseProvider)

  server.call("$unregisterProvider", [14])

  assert.equal(registry.getSearchProvider(SearchProviderType.text, "file"), baseProvider)
})

test("MainThreadSearch enables native EH search after the extension host is ready", () => {
  const server = createServer()
  const registry = new SearchProviderRegistry()
  const calls = []
  mainThreadSearch.register(server, {
    searchProviderRegistry: registry,
    callEh: async (...args) => {
      calls.push(args)
    },
  })

  assert.deepEqual(calls, [])
  server.isRunning = true
  server.emit("ready")

  assert.deepEqual(calls, [[mainThreadSearch.EXT_HOST_SEARCH_NID, "$enableExtensionHostSearch", []]])
})

test("MainThreadSearch aborts searches without accepting stale progress", async () => {
  const server = createServer()
  const registry = new SearchProviderRegistry()
  let releaseEh
  mainThreadSearch.register(server, {
    searchProviderRegistry: registry,
    callEh: () => new Promise((resolve) => { releaseEh = resolve }),
  })

  server.call("$registerTextSearchProvider", [12, "file"])
  const provider = registry.getSearchProvider(SearchProviderType.text, "file")
  const controller = new AbortController()
  const search = provider.textSearch({
    root: "D:/Workspace",
    query: "needle",
    folderQueries: [{ folder: { scheme: "file", path: "/D:/Workspace" } }],
    signal: controller.signal,
  })
  controller.abort()
  releaseEh({ messages: [] })

  await assert.rejects(search, { name: "AbortError" })
  server.call("$handleTextMatch", [12, 1, [{
    resource: { scheme: "file", authority: "", path: "/D:/Workspace/src/app.ts", query: "", fragment: "" },
    results: [],
  }]])
})
