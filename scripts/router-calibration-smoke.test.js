const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  parseArgs,
  readLatestRouterCalibrationSmoke,
  runRouterCalibrationSmoke,
} = require("./router-calibration-smoke")

test("router calibration smoke parses report dir and min samples", () => {
  const parsed = parseArgs(["--no-write", "--report-dir=C:/tmp/router", "--min-samples=100"])

  assert.equal(parsed.noWrite, true)
  assert.equal(parsed.reportDir, "C:/tmp/router")
  assert.equal(parsed.minSamples, 100)
})

test("router calibration smoke produces 100+ samples and failure reports", () => {
  const report = runRouterCalibrationSmoke({ noWrite: true, minSamples: 100 })

  assert.equal(report.ready, true)
  assert.equal(report.summary.total >= 100, true)
  assert.equal(report.summary.sampleCountOk, true)
  assert.equal(report.summary.failureReportOk, true)
  assert.equal(report.summary.failureReports, report.summary.misaligned)
  assert.equal(report.calibration.total, report.summary.total)
  assert.match(report.markdown, /Router Calibration Smoke/)
  assert.match(report.markdown, /Failure Report/)
})

test("router calibration smoke saves latest json and markdown", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-router-calibration-"))
  const report = runRouterCalibrationSmoke({ reportDir, minSamples: 100 })
  const latest = readLatestRouterCalibrationSmoke({ reportDir })

  assert.equal(report.ready, true)
  assert.equal(fs.existsSync(path.join(reportDir, "router-calibration-smoke-latest.json")), true)
  assert.equal(fs.existsSync(path.join(reportDir, "router-calibration-smoke-latest.md")), true)
  assert.equal(latest.report.reportKind, "router-calibration-smoke")
  assert.equal(latest.report.summary.total >= 100, true)
})
