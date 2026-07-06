const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildMigrationSmokeReport,
  parseArgs,
  readLatestMigrationSmoke,
  saveMigrationSmokeReport,
} = require("./extension-migration-smoke")

test("extension migration smoke parseArgs supports source, dry-run, and report dir", () => {
  const parsed = parseArgs(["--source=cursor", "--dry-run", "--report-dir=D:/reports"])
  assert.equal(parsed.source, "cursor")
  assert.equal(parsed.dryRun, true)
  assert.equal(parsed.reportDir, "D:/reports")
})

test("extension migration smoke proves dry-run imports a user-confirmed queue only", () => {
  const report = buildMigrationSmokeReport({ source: "cursor", dryRun: true })

  assert.equal(report.ready, true)
  assert.equal(report.summary.failed, 0)
  assert.equal(report.evidence.preview.extensionsCount, 3)
  assert.equal(report.evidence.queue.total, 3)
  assert.equal(report.evidence.queue.installed, 0)
  assert.equal(report.evidence.queue.installPolicy, "user-confirmed")
  assert.equal(report.checks.some((check) => check.id === "dry_run_no_auto_install" && check.status === "passed"), true)
})

test("extension migration smoke saves latest json and markdown reports", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-extension-migration-report-"))
  const report = buildMigrationSmokeReport({ source: "vscode", dryRun: true })
  const saved = saveMigrationSmokeReport(report, { reportDir })
  const latest = readLatestMigrationSmoke({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.reportKind, "extension-migration-smoke")
  assert.equal(latest.report.ready, true)
})
