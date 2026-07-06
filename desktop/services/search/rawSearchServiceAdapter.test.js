const assert = require("assert")
const test = require("node:test")
const {
  RawSearchProviderStatus,
  RAW_FILE_SEARCH_BATCH_SIZE,
  createRawSearchServiceState,
  normalizeRawFileSearchResult,
  normalizeRawSearchResult,
  runRawSearchProvider,
} = require("./rawSearchServiceAdapter")
const { SearchProviderType } = require("./searchProviderRegistry")

test("runRawSearchProvider dispatches through registry and normalizes provider results", async () => {
  const progressEvents = []
  const registry = {
    schemeHasProvider: (type, scheme) => type === SearchProviderType.text && scheme === "file",
    runSearch: async (_type, _scheme, request) => ({
      engine: "custom-rg",
      matches: [{ path: request.query, line: 1 }],
      visitedFiles: 2,
    }),
  }

  const result = await runRawSearchProvider({
    providerRegistry: registry,
    type: SearchProviderType.text,
    scheme: "file",
    request: { query: "needle.ts" },
    progress: { provider: (event) => progressEvents.push(event) },
  })

  assert.equal(result.status, RawSearchProviderStatus.success)
  assert.equal(result.result.engine, "custom-rg")
  assert.deepEqual(result.result.matches, [{ path: "needle.ts", line: 1 }])
  assert.equal(result.result.truncated, false)
  assert.equal(result.result.visitedFiles, 2)
  assert.deepEqual(progressEvents, [{ engine: "ripgrep", type: SearchProviderType.text, scheme: "file" }])
})

test("runRawSearchProvider reports missing when registry has no scheme provider", async () => {
  let called = false
  const result = await runRawSearchProvider({
    providerRegistry: {
      schemeHasProvider: () => false,
      runSearch: async () => {
        called = true
        return null
      },
    },
    type: SearchProviderType.file,
    scheme: "file",
  })

  assert.equal(called, false)
  assert.equal(result.status, RawSearchProviderStatus.missing)
  assert.equal(result.result, null)
})

test("runRawSearchProvider returns error status for provider failures", async () => {
  const error = new Error("rg failed")
  const providerErrors = []
  const result = await runRawSearchProvider({
    providerRegistry: {
      schemeHasProvider: () => true,
      runSearch: async () => {
        throw error
      },
    },
    type: SearchProviderType.text,
    scheme: "file",
    progress: {
      providerError: (event) => providerErrors.push(event),
    },
  })

  assert.equal(result.status, RawSearchProviderStatus.error)
  assert.equal(result.error, error)
  assert.equal(result.result, null)
  assert.deepEqual(providerErrors, [{
    engine: "ripgrep",
    type: SearchProviderType.text,
    scheme: "file",
    error: "rg failed",
    errorName: "Error",
  }])
})

test("runRawSearchProvider propagates cancellation and emits cancelled progress", async () => {
  const controller = new AbortController()
  const events = []

  await assert.rejects(
    runRawSearchProvider({
      providerRegistry: {
        schemeHasProvider: () => true,
        runSearch: async () => {
          controller.abort()
          const error = new Error("Search cancelled")
          error.name = "AbortError"
          throw error
        },
      },
      type: SearchProviderType.file,
      scheme: "file",
      signal: controller.signal,
      progress: { cancelled: (event) => events.push(event) },
    }),
    /Search cancelled/,
  )
  assert.equal(events.length, 1)
  assert.equal(events[0].engine, "ripgrep-files")
})

test("normalizeRawSearchResult supplies stable defaults", () => {
  assert.deepEqual(normalizeRawSearchResult({}, "fallback"), {
    matches: [],
    truncated: false,
    visitedFiles: 0,
    visitedDirs: 0,
    skippedLargeFiles: 0,
    engine: "fallback",
  })
})

test("normalizeRawFileSearchResult filters, sorts, and limits provider file results", () => {
  const result = normalizeRawFileSearchResult({
    matches: [
      { path: "a-first.txt" },
      { path: "packages/foo/src/special-target.ts" },
      { path: "src/special-target.ts" },
    ],
    truncated: false,
    visitedFiles: 3,
    visitedDirs: 0,
    skippedLargeFiles: 0,
    engine: "custom-files",
  }, {
    filePattern: "specialtarget",
    maxResults: 1,
    sortByScore: true,
  })

  assert.deepEqual(result.matches.map((match) => match.path), ["src/special-target.ts"])
  assert.equal(result.truncated, true)
})

test("runRawSearchProvider applies filePattern model to alternate file providers", async () => {
  const result = await runRawSearchProvider({
    providerRegistry: {
      schemeHasProvider: () => true,
      runSearch: async (_type, _scheme, request) => ({
        engine: "custom-files",
        matches: [
          { path: "a-first.txt" },
          { path: `src/${request.filePattern}-target.ts` },
        ],
      }),
    },
    type: SearchProviderType.file,
    scheme: "file",
    request: {
      filePattern: "special",
      maxResults: 1,
      sortByScore: true,
    },
  })

  assert.equal(result.status, RawSearchProviderStatus.success)
  assert.deepEqual(result.result.matches.map((match) => match.path), ["src/special-target.ts"])
})

test("runRawSearchProvider reuses VS Code-style sorted file search cache for narrowed filePattern", async () => {
  const serviceState = createRawSearchServiceState()
  let providerCalls = 0
  const registry = {
    schemeHasProvider: () => true,
    runSearch: async () => {
      providerCalls += 1
      return {
        engine: "custom-files",
        matches: [
          { path: "src/spectrum.ts" },
          { path: "src/special-target.ts" },
          { path: "docs/spec-notes.md" },
        ],
        visitedFiles: 3,
      }
    },
  }

  const first = await runRawSearchProvider({
    providerRegistry: registry,
    type: SearchProviderType.file,
    scheme: "file",
    serviceState,
    request: {
      cacheKey: "workspace-cache",
      filePattern: "spe",
      maxResults: 10,
      sortByScore: true,
    },
  })
  const second = await runRawSearchProvider({
    providerRegistry: registry,
    type: SearchProviderType.file,
    scheme: "file",
    serviceState,
    request: {
      cacheKey: "workspace-cache",
      filePattern: "specialtarget",
      maxResults: 1,
      sortByScore: true,
    },
  })

  assert.equal(first.status, RawSearchProviderStatus.success)
  assert.equal(second.status, RawSearchProviderStatus.success)
  assert.equal(providerCalls, 1)
  assert.equal(second.result.rawSearchCache.fromCache, true)
  assert.deepEqual(second.result.matches.map((match) => match.path), ["src/special-target.ts"])
})

test("runRawSearchProvider does not reuse non-path cache for path-qualified filePattern", async () => {
  const serviceState = createRawSearchServiceState()
  let providerCalls = 0
  const registry = {
    schemeHasProvider: () => true,
    runSearch: async () => {
      providerCalls += 1
      return {
        engine: "custom-files",
        matches: [{ path: "src/special-target.ts" }],
        visitedFiles: 1,
      }
    },
  }

  await runRawSearchProvider({
    providerRegistry: registry,
    type: SearchProviderType.file,
    scheme: "file",
    serviceState,
    request: {
      cacheKey: "workspace-cache",
      filePattern: "spe",
      sortByScore: true,
    },
  })
  const result = await runRawSearchProvider({
    providerRegistry: registry,
    type: SearchProviderType.file,
    scheme: "file",
    serviceState,
    request: {
      cacheKey: "workspace-cache",
      filePattern: "src/special",
      sortByScore: true,
    },
  })

  assert.equal(result.status, RawSearchProviderStatus.success)
  assert.equal(providerCalls, 2)
  assert.equal(result.result.rawSearchCache?.fromCache, false)
})

test("runRawSearchProvider emits file result progress in RawSearchService batch sizes", async () => {
  const progressBatches = []
  const matches = Array.from({ length: RAW_FILE_SEARCH_BATCH_SIZE + 1 }, (_value, index) => ({
    path: `src/file-${String(index).padStart(4, "0")}.ts`,
  }))

  const result = await runRawSearchProvider({
    providerRegistry: {
      schemeHasProvider: () => true,
      runSearch: async () => ({
        engine: "custom-files",
        matches,
        visitedFiles: matches.length,
      }),
    },
    type: SearchProviderType.file,
    scheme: "file",
    progress: {
      resultBatch: (event) => progressBatches.push(event),
    },
    request: {
      maxResults: matches.length,
      sortByScore: true,
    },
  })

  assert.equal(result.status, RawSearchProviderStatus.success)
  assert.deepEqual(progressBatches.map((event) => event.count), [RAW_FILE_SEARCH_BATCH_SIZE, 1])
  assert.deepEqual(progressBatches.map((event) => event.total), [matches.length, matches.length])
})
