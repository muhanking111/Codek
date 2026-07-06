const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildExtensionBaselineReport,
  parseArgs,
  readLatestExtensionBaseline,
  saveExtensionBaseline,
  summarizeGitStatus,
} = require("./extension-baseline")

test("extension baseline parseArgs supports report dir, no-network, no-write, and queries", () => {
  const parsed = parseArgs([
    "--no-write",
    "--no-network",
    "--report-dir=D:/reports",
    "--queries=python,java,eslint",
  ])

  assert.equal(parsed.noWrite, true)
  assert.equal(parsed.noNetwork, true)
  assert.equal(parsed.reportDir, "D:/reports")
  assert.deepEqual(parsed.queries, ["python", "java", "eslint"])
})

test("summarizeGitStatus counts modified, deleted, and untracked files without exposing full diff", () => {
  const summary = summarizeGitStatus(" M a.js\nD  old.js\n?? new.js\n")

  assert.deepEqual(summary, {
    dirty: true,
    total: 3,
    modified: 1,
    deleted: 1,
    untracked: 1,
    renamed: 0,
  })
})

test("buildExtensionBaselineReport marks marketplace catalog evidence as ready when samples resolve", () => {
  const report = buildExtensionBaselineReport({
    branch: "master",
    gitStatus: { dirty: true, total: 99, modified: 80, deleted: 2, untracked: 17, renamed: 0 },
    installed: [
      { id: "codek.json", isBuiltin: true },
      { id: "ms-python.python", isBuiltin: false },
    ],
    marketplaceSamples: [
      { query: "python", count: 3, top: [{ id: "ms-python.python" }] },
      { query: "eslint", count: 2, top: [{ id: "dbaeumer.vscode-eslint" }] },
    ],
    dependencySnapshot: {
      "extract-zip": { available: true },
      "@vscode/vsce": { available: false },
    },
    mainThreadProxySnapshot: { count: 25, proxies: ["mainThreadCommands.js"] },
    capabilities: {
      marketplaceDetails: true,
      marketplaceDetailsPayload: true,
      marketplaceReadme: true,
      marketplaceVersions: true,
      installPlan: true,
      compatibilityReport: true,
      installState: true,
      auditLog: true,
      rollback: true,
    },
  })

  assert.equal(report.ready, true)
  assert.equal(report.extensionInventory.total, 2)
  assert.equal(report.extensionInventory.userInstalled, 1)
  assert.equal(report.checks.find((check) => check.id === "vsce_optional").status, "warning")
})

test("extension baseline saves latest json and markdown reports", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-baseline-"))
  const report = buildExtensionBaselineReport({
    installed: [],
    marketplaceSamples: [],
    dependencySnapshot: {},
    mainThreadProxySnapshot: { count: 0, proxies: [] },
    capabilities: {},
  })
  const saved = saveExtensionBaseline(report, { reportDir })
  const latest = readLatestExtensionBaseline({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.reportKind, "extension-enterprise-baseline")
})
