const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { parseArgs, runRealWorkspaceSmoke } = require("./i-real-workspace-smoke")

test("parseArgs keeps I smoke report output inside an explicit report dir", () => {
  const parsed = parseArgs(["--no-write", "--report-dir=C:/tmp/codek-i"])

  assert.equal(parsed.noWrite, true)
  assert.equal(parsed.requireJ, false)
  assert.equal(parsed.reportDir, "C:/tmp/codek-i")
})

test("I real workspace smoke verifies diff, command authorization, report archive, and recovery recommendation", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-i-smoke-test-"))
  const report = await runRealWorkspaceSmoke({ reportDir, noWrite: true })

  assert.equal(report.ready, true)
  assert.equal(report.checks.length, 4)
  assert.equal(report.checks.every((check) => check.passed), true)
  assert.equal(report.jReady, true)
  assert.equal(report.jChecks.length, 4)
  assert.equal(report.jChecks.every((check) => check.passed), true)
  assert.equal(report.diffSummary.totalFiles, 1)
  assert.equal(report.commandAuthorization.allowed, 1)
  assert.equal(fs.existsSync(report.savedReport.markdownPath), true)
  assert.equal(report.savedReport.markdownPath.startsWith(reportDir), true)
  assert.equal(report.recoveryRecommendation.action, "retry")
})
