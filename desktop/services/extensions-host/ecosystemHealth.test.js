const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildExtensionEcosystemHealth,
  rankMarketplaceResults,
  readLatestExtensionEcosystemHealth,
  saveExtensionEcosystemHealth,
} = require("./ecosystemHealth")

test("rankMarketplaceResults keeps exact extension id match first", () => {
  const results = rankMarketplaceResults([
    { id: "foo.theme-plus", name: "theme-plus", displayName: "Theme Plus", downloadCount: 999999 },
    { id: "ms-python.python", publisher: "ms-python", name: "python", displayName: "Python", downloadCount: 10 },
  ], "ms-python.python")

  assert.equal(results[0].id, "ms-python.python")
})

test("extension ecosystem health reports names, icons, installs, activation, and conflicts", () => {
  const report = buildExtensionEcosystemHealth({
    query: "ms-python.python",
    installed: [{ id: "ms-python.python", displayName: "Python", name: "python", publisher: "ms-python" }],
    searchResults: [
      { id: "theme.popular", name: "popular", displayName: "Popular Theme", downloadCount: 1000000, iconUrl: "https://example.test/a.png" },
      { id: "ms-python.python", name: "python", displayName: "Python", publisher: "ms-python", downloadCount: 100, iconUrl: "https://example.test/python.png" },
    ],
    iconCache: { "ms-python.python": "data:image/png;base64,AA==", "theme.popular": "data:image/png;base64,AA==" },
    installResults: [{ id: "ms-python.python", success: true }],
    activationReport: { runtimeErrors: [] },
  })

  assert.equal(report.ready, true)
  assert.equal(report.summary.failed, 0)
  assert.equal(report.rankedResults[0].id, "ms-python.python")
  assert.equal(report.iconEvidence.withIcon, 2)
  assert.equal(report.iconEvidence.cached, 2)
  assert.equal(report.iconEvidence.missingIconSamples, 0)
  assert.equal(report.warningPolicy.find((item) => item.id === "icon_cache"), undefined)
})

test("extension ecosystem health includes a Top N contribution compatibility matrix", () => {
  const report = buildExtensionEcosystemHealth({
    topN: 2,
    query: "ms-python.python",
    installed: [
      {
        id: "ms-python.python",
        displayName: "Python",
        name: "python",
        publisher: "ms-python",
        contributes: {
          commands: [{ command: "python.run", title: "Run Python" }],
          configuration: { properties: { "python.analysis.typeCheckingMode": { default: "basic" } } },
          keybindings: [{ command: "python.run", key: "ctrl+f5" }],
          languages: [{ id: "python", extensions: [".py"] }],
          debuggers: [{ type: "python", label: "Python" }],
        },
      },
      {
        id: "theme.popular",
        displayName: "Popular Theme",
        name: "popular",
        publisher: "theme",
        contributes: {
          themes: [{ id: "popular-dark", label: "Popular Dark" }],
          menus: { "explorer/context": [{ command: "popular.open" }] },
        },
      },
      {
        id: "ignored.third",
        displayName: "Ignored",
        name: "ignored",
        publisher: "ignored",
        contributes: {
          commands: [{ command: "ignored.run", title: "Ignored" }],
        },
      },
    ],
    searchResults: [
      { id: "ms-python.python", name: "python", displayName: "Python", publisher: "ms-python", downloadCount: 100, iconUrl: "https://example.test/python.png" },
      { id: "theme.popular", name: "popular", displayName: "Popular Theme", publisher: "theme", downloadCount: 90, iconUrl: "https://example.test/theme.png" },
      { id: "ignored.third", name: "ignored", displayName: "Ignored", publisher: "ignored", downloadCount: 80, iconUrl: "https://example.test/ignored.png" },
    ],
    iconCache: {
      "ms-python.python": "data:image/png;base64,AA==",
      "theme.popular": "data:image/png;base64,AA==",
      "ignored.third": "data:image/png;base64,AA==",
    },
    installResults: [{ id: "ms-python.python", success: true }],
    activationReport: { runtimeErrors: [] },
  })

  assert.equal(report.compatibilityMatrix.topN, 2)
  assert.equal(report.compatibilityMatrix.extensions.length, 2)
  assert.deepEqual(report.compatibilityMatrix.summary, {
    sampledExtensions: 2,
    supportedContributionPoints: 4,
    partialContributionPoints: 2,
    unsupportedContributionPoints: 1,
    totalContributionPoints: 7,
  })
  assert.equal(report.compatibilityMatrix.extensions[0].id, "ms-python.python")
  assert.equal(report.compatibilityMatrix.extensions[0].supportLevel, "partial")
  assert.deepEqual(report.compatibilityMatrix.extensions[0].partialContributionPoints, ["debuggers"])
  assert.deepEqual(report.compatibilityMatrix.extensions[0].unsupportedContributionPoints, [])
  assert.deepEqual(report.compatibilityMatrix.extensions[1].unsupportedContributionPoints, ["themes"])
  assert.equal(report.checks.some((check) => check.id === "top_n_compatibility_matrix" && check.status === "passed"), true)
})

test("extension ecosystem health explains missing icon samples without failing installs", () => {
  const report = buildExtensionEcosystemHealth({
    query: "codek.sample",
    installed: [{ id: "codek.sample", displayName: "Sample", name: "sample", publisher: "codek" }],
    searchResults: [{ id: "codek.sample", name: "sample", displayName: "Sample", publisher: "codek", downloadCount: 10 }],
    installResults: [{ id: "codek.sample", success: true }],
    activationReport: { runtimeErrors: [] },
  })

  const iconCheck = report.checks.find((check) => check.id === "icon_cache")
  assert.equal(iconCheck.status, "warning")
  assert.equal(report.summary.failed, 0)
  assert.equal(report.iconEvidence.missingIconSamples, 1)
  assert.equal(report.iconEvidence.placeholderStrategy, "stable-initials")
})

test("extension ecosystem health persists latest markdown and json", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-health-"))
  const report = buildExtensionEcosystemHealth({
    installed: [],
    searchResults: [],
  })
  const saved = saveExtensionEcosystemHealth(report, { reportDir })
  const latest = readLatestExtensionEcosystemHealth({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.reportKind, "extension-ecosystem-health")
})
