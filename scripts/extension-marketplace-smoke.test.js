const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildMarketplaceSmokeReport,
  parseArgs,
  readLatestMarketplaceSmoke,
  saveMarketplaceSmokeReport,
} = require("./extension-marketplace-smoke")

function makeExtMgr() {
  return {
    async searchMarketplace(query) {
      return [{ id: `${query}.sample`, namespace: query, name: "sample", displayName: `${query} sample` }]
    },
    async getExtensionDetails(namespace, name) {
      return { id: `${namespace}.${name}`, namespace, name, displayName: name, version: "1.0.0" }
    },
    async getExtensionReadme(namespace, name) {
      return { id: `${namespace}.${name}`, readme: "# README", available: true }
    },
    async getExtensionVersions(namespace, name) {
      return { id: `${namespace}.${name}`, versions: [{ version: "1.0.0" }] }
    },
    async buildMarketplaceInstallPlan(input) {
      return { id: input.extensionId, readyToInstall: true, dependencies: [], extensionPack: [], warnings: [] }
    },
  }
}

test("marketplace smoke parseArgs supports query and extension inputs", () => {
  const parsed = parseArgs([
    "--no-write",
    "--report-dir=D:/reports",
    "--queries=python,eslint",
    "--extensions=ms-python.python,dbaeumer.vscode-eslint",
    "--page-size=2",
  ])

  assert.equal(parsed.noWrite, true)
  assert.equal(parsed.reportDir, "D:/reports")
  assert.deepEqual(parsed.queries, ["python", "eslint"])
  assert.deepEqual(parsed.extensions, ["ms-python.python", "dbaeumer.vscode-eslint"])
  assert.equal(parsed.pageSize, 2)
})

test("marketplace smoke verifies search, details, readme, versions, and install plans", async () => {
  const report = await buildMarketplaceSmokeReport({
    queries: ["python"],
    extensions: ["ms-python.python"],
    pageSize: 5,
  }, makeExtMgr())

  assert.equal(report.ready, true)
  assert.equal(report.summary.failed, 0)
  assert.equal(report.checks.find((check) => check.id === "marketplace_search").status, "passed")
  assert.equal(report.inspected.some((item) => item.id === "ms-python.python" && item.installPlanReady), true)
})

test("marketplace smoke saves latest json and markdown", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-marketplace-smoke-"))
  const report = await buildMarketplaceSmokeReport({ queries: ["python"], pageSize: 1 }, makeExtMgr())
  const saved = saveMarketplaceSmokeReport(report, { reportDir })
  const latest = readLatestMarketplaceSmoke({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.reportKind, "extension-marketplace-smoke")
})
