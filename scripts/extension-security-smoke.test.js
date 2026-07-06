const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildSecuritySmokeReport,
  parseArgs,
  readLatestSecuritySmoke,
  saveSecuritySmokeReport,
} = require("./extension-security-smoke")

test("extension security smoke parseArgs supports report dir and no-write", () => {
  const parsed = parseArgs(["--no-write", "--report-dir=D:/reports"])
  assert.equal(parsed.noWrite, true)
  assert.equal(parsed.reportDir, "D:/reports")
})

test("extension security smoke verifies trust, policy, and audit redaction", async () => {
  const report = await buildSecuritySmokeReport()

  assert.equal(report.ready, true)
  assert.equal(report.summary.failed, 0)
  assert.equal(report.checks.some((check) => check.id === "restricted_workspace_blocks_install" && check.status === "passed"), true)
  assert.equal(report.checks.some((check) => check.id === "unknown_workspace_requires_confirmation" && check.status === "passed"), true)
  assert.equal(report.checks.some((check) => check.id === "publisher_deny_policy" && check.status === "passed"), true)
  assert.equal(report.checks.some((check) => check.id === "audit_log_redacts_secrets" && check.status === "passed"), true)
})

test("extension security smoke saves latest json and markdown reports", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-extension-security-report-"))
  const report = await buildSecuritySmokeReport()
  const saved = saveSecuritySmokeReport(report, { reportDir })
  const latest = readLatestSecuritySmoke({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.reportKind, "extension-security-smoke")
  assert.equal(latest.report.ready, true)
})
