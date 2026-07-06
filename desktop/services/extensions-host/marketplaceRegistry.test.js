const assert = require("node:assert/strict")
const test = require("node:test")

const {
  buildMarketplaceDetailsUrl,
  buildMarketplaceSearchUrl,
  getMarketplaceReadme,
  getMarketplaceVersions,
  getMarketplaceDetails,
  normalizeOpenVsxExtension,
  parseMarketplaceSources,
  searchMarketplaceRegistry,
} = require("./marketplaceRegistry")

test("parseMarketplaceSources supports default Open VSX and named enterprise registries", () => {
  assert.deepEqual(parseMarketplaceSources("", "https://open-vsx.org/api"), [
    { name: "open-vsx", baseUrl: "https://open-vsx.org/api", kind: "open-vsx" },
  ])

  assert.deepEqual(parseMarketplaceSources("corp=https://registry.example/api,https://mirror.example/api"), [
    { name: "corp", baseUrl: "https://registry.example/api", kind: "open-vsx" },
    { name: "mirror-2", baseUrl: "https://mirror.example/api", kind: "open-vsx" },
  ])
})

test("buildMarketplaceSearchUrl encodes query, size, category, and offset", () => {
  const url = buildMarketplaceSearchUrl(
    { baseUrl: "https://registry.example/api/" },
    "python lint",
    { size: 25, category: "Linters", offset: 50 },
  )

  assert.equal(
    url,
    "https://registry.example/api/-/search?query=python+lint&size=25&offset=50&category=Linters",
  )
})

test("buildMarketplaceDetailsUrl supports VS Code target platform details", () => {
  const source = { baseUrl: "https://registry.example/api/" }

  assert.equal(
    buildMarketplaceDetailsUrl(source, "ms-python", "debugpy", "2026.6.0", { targetPlatform: "win32-x64" }),
    "https://registry.example/api/ms-python/debugpy/win32-x64/2026.6.0",
  )
  assert.equal(
    buildMarketplaceDetailsUrl(source, "ms-python", "debugpy", "2026.6.0"),
    "https://registry.example/api/ms-python/debugpy/2026.6.0",
  )
})

test("normalizeOpenVsxExtension preserves enterprise metadata used by install plans", () => {
  const normalized = normalizeOpenVsxExtension({
    namespace: "ms-python",
    name: "python",
    version: "2026.4.0",
    targetPlatform: "win32-x64",
    displayName: "Python",
    files: { download: "https://example.test/python.vsix", readme: "https://example.test/readme" },
    properties: {
      dependencies: ["ms-python.debugpy"],
      extensionPack: "ms-python.vscode-pylance",
      engine: "^1.90.0",
      enabledApiProposals: ["notebookVariableProvider"],
    },
  }, { name: "open-vsx" })

  assert.equal(normalized.id, "ms-python.python")
  assert.deepEqual(normalized.extensionDependencies, ["ms-python.debugpy"])
  assert.deepEqual(normalized.extensionPack, ["ms-python.vscode-pylance"])
  assert.equal(normalized.engines.vscode, "^1.90.0")
  assert.deepEqual(normalized.enabledApiProposals, ["notebookVariableProvider"])
  assert.equal(normalized.targetPlatform, "win32-x64")
  assert.equal(normalized.source, "open-vsx")
})

test("searchMarketplaceRegistry merges multiple sources and keeps source evidence", async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        extensions: [{
          namespace: url.includes("corp") ? "corp" : "oss",
          name: "python",
          version: "1.0.0",
          downloadCount: url.includes("corp") ? 10 : 20,
        }],
      }),
    }
  }

  const report = await searchMarketplaceRegistry("python", {
    sources: parseMarketplaceSources("corp=https://corp.example/api,oss=https://oss.example/api"),
    size: 5,
    fetchImpl,
  })

  assert.equal(calls.length, 2)
  assert.deepEqual(report.extensions.map((item) => item.id), ["oss.python", "corp.python"])
  assert.deepEqual(report.sources.map((item) => item.name), ["corp", "oss"])
  assert.equal(report.errors.length, 0)
})

test("getMarketplaceReadme and getMarketplaceVersions fall back to metadata when remote assets are unavailable", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/ms-python/python")) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({
          namespace: "ms-python",
          name: "python",
          version: "2026.4.0",
          files: { readme: "https://asset.example/readme.md" },
          allVersions: {
            "2026.4.0": "https://open-vsx.org/api/ms-python/python/2026.4.0",
            "2026.2.0": "https://open-vsx.org/api/ms-python/python/2026.2.0",
          },
        }),
      }
    }
    return { ok: false, status: 503, headers: new Map(), text: async () => "" }
  }

  const source = { name: "open-vsx", baseUrl: "https://open-vsx.org/api", kind: "open-vsx" }
  const readme = await getMarketplaceReadme("ms-python", "python", { source, fetchImpl })
  const versions = await getMarketplaceVersions("ms-python", "python", { source, fetchImpl })

  assert.equal(readme.id, "ms-python.python")
  assert.equal(readme.readme, "")
  assert.equal(readme.available, false)
  assert.deepEqual(versions.versions.map((item) => item.version), ["2026.4.0", "2026.2.0"])
})

test("getMarketplaceDetails requests target platform compatible Open VSX details", async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({
        namespace: "ms-python",
        name: "debugpy",
        version: "2026.6.0",
        targetPlatform: "win32-x64",
        files: {
          download: "https://open-vsx.org/api/ms-python/debugpy/win32-x64/2026.6.0/file/ms-python.debugpy-2026.6.0@win32-x64.vsix",
        },
      }),
    }
  }

  const details = await getMarketplaceDetails("ms-python", "debugpy", {
    source: { name: "open-vsx", baseUrl: "https://open-vsx.org/api", kind: "open-vsx" },
    version: "2026.6.0",
    targetPlatform: "win32-x64",
    fetchImpl,
  })

  assert.deepEqual(calls, ["https://open-vsx.org/api/ms-python/debugpy/win32-x64/2026.6.0"])
  assert.equal(details.targetPlatform, "win32-x64")
  assert.match(details.downloadUrl, /@win32-x64\.vsix$/)
})
