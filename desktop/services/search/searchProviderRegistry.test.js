const assert = require("assert")
const test = require("node:test")
const {
  SearchProviderRegistry,
  SearchProviderType,
  createDefaultSearchProviderRegistry,
} = require("./searchProviderRegistry")

test("SearchProviderRegistry registers and disposes providers by type and scheme", async () => {
  const registry = new SearchProviderRegistry()
  const provider = {
    textSearch: async ({ query }) => ({ engine: "custom-text", matches: [{ path: `${query}.txt` }] }),
  }

  const disposable = registry.registerSearchResultProvider("file", SearchProviderType.text, provider)
  assert.equal(registry.schemeHasProvider(SearchProviderType.text, "file"), true)
  assert.deepEqual(registry.providerSchemes(SearchProviderType.text), ["file"])

  const result = await registry.runSearch(SearchProviderType.text, "file", { query: "needle" })
  assert.equal(result.engine, "custom-text")
  assert.deepEqual(result.matches.map((match) => match.path), ["needle.txt"])

  disposable.dispose()
  assert.equal(registry.schemeHasProvider(SearchProviderType.text, "file"), false)
  assert.equal(await registry.runSearch(SearchProviderType.text, "file", { query: "needle" }), null)
})

test("SearchProviderRegistry keeps file and text providers separate", async () => {
  const registry = new SearchProviderRegistry()
  registry.registerSearchResultProvider("file", SearchProviderType.file, {
    fileSearch: async () => ({ engine: "file-provider", matches: [] }),
  })
  registry.registerSearchResultProvider("file", SearchProviderType.text, {
    textSearch: async () => ({ engine: "text-provider", matches: [] }),
  })

  assert.equal((await registry.runSearch(SearchProviderType.file, "file", {})).engine, "file-provider")
  assert.equal((await registry.runSearch(SearchProviderType.text, "file", {})).engine, "text-provider")
})

test("SearchProviderRegistry restores previous provider when temporary registration is disposed", async () => {
  const registry = new SearchProviderRegistry()
  const baseProvider = {
    textSearch: async () => ({ engine: "base-provider", matches: [{ path: "base.ts" }] }),
  }
  const temporaryProvider = {
    textSearch: async () => ({ engine: "temporary-provider", matches: [{ path: "temporary.ts" }] }),
  }

  const baseDisposable = registry.registerSearchResultProvider("file", SearchProviderType.text, baseProvider)
  const temporaryDisposable = registry.registerSearchResultProvider("file", SearchProviderType.text, temporaryProvider)

  assert.equal(registry.getSearchProvider(SearchProviderType.text, "file"), temporaryProvider)
  assert.equal((await registry.runSearch(SearchProviderType.text, "file", {})).engine, "temporary-provider")

  temporaryDisposable.dispose()
  temporaryDisposable.dispose()

  assert.equal(registry.getSearchProvider(SearchProviderType.text, "file"), baseProvider)
  assert.equal((await registry.runSearch(SearchProviderType.text, "file", {})).engine, "base-provider")

  baseDisposable.dispose()
  assert.equal(registry.getSearchProvider(SearchProviderType.text, "file"), null)
})

test("SearchProviderRegistry clearCache fans out once per provider instance", async () => {
  const registry = new SearchProviderRegistry()
  const calls = []
  const provider = {
    textSearch: async () => null,
    fileSearch: async () => null,
    clearCache: async (cacheKey) => calls.push(cacheKey),
  }
  registry.registerSearchResultProvider("file", SearchProviderType.text, provider)
  registry.registerSearchResultProvider("file", SearchProviderType.file, provider)

  await registry.clearCache("workspace-cache")

  assert.deepEqual(calls, ["workspace-cache"])
})

test("createDefaultSearchProviderRegistry exposes file scheme ripgrep providers", () => {
  const registry = createDefaultSearchProviderRegistry()

  assert.equal(registry.schemeHasProvider(SearchProviderType.text, "file"), true)
  assert.equal(registry.schemeHasProvider(SearchProviderType.file, "file"), true)
})
