const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildCompatibilityMatrixReport,
  parseArgs,
  readLatestCompatibilityMatrix,
  saveCompatibilityMatrixReport,
} = require("./extension-compatibility-matrix")

function makeExtMgr() {
  return {
    getInstalledExtensions() {
      return [{
        id: "codek.fixture",
        displayName: "Fixture",
        contributes: { commands: [{ command: "fixture.run" }] },
        isBuiltin: false,
      }]
    },
    readActivationReport() {
      return { runtimeErrors: [] }
    },
    async searchMarketplace() {
      return [{
        id: "ms-python.python",
        namespace: "ms-python",
        name: "python",
        displayName: "Python",
        contributes: { languages: [{ id: "python" }], debuggers: [{ type: "python" }] },
      }]
    },
    async getExtensionDetails(namespace, name) {
      return {
        id: `${namespace}.${name}`,
        namespace,
        name,
        displayName: name,
        contributes: { languages: [{ id: name }], debuggers: [{ type: name }] },
      }
    },
  }
}

test("compatibility matrix parseArgs supports top, sample file, and no-network", () => {
  const parsed = parseArgs([
    "--no-write",
    "--no-network",
    "--top=50",
    "--sample-file=docs/top.json",
    "--report-dir=D:/reports",
  ])

  assert.equal(parsed.noWrite, true)
  assert.equal(parsed.noNetwork, true)
  assert.equal(parsed.top, 50)
  assert.equal(parsed.sampleFile, "docs/top.json")
  assert.equal(parsed.reportDir, "D:/reports")
})

test("compatibility matrix samples marketplace and installed extensions", async () => {
  const report = await buildCompatibilityMatrixReport({ top: 10, queries: ["python"] }, makeExtMgr())

  assert.equal(report.ready, true)
  assert.equal(report.summary.sampled, 2)
  assert.equal(report.extensions.some((item) => item.id === "ms-python.python" && item.status === "degraded"), true)
  assert.equal(report.extensions.some((item) => item.id === "codek.fixture" && item.status === "compatible"), true)
})

test("compatibility matrix saves latest reports", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-compat-matrix-"))
  const report = await buildCompatibilityMatrixReport({ top: 10, queries: ["python"] }, makeExtMgr())
  const saved = saveCompatibilityMatrixReport(report, { reportDir })
  const latest = readLatestCompatibilityMatrix({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.reportKind, "extension-compatibility-matrix")
})
