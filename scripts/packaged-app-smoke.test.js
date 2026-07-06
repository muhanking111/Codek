const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  buildReportFromResult,
  parseSmokeOutput,
  readSmokeResultFile,
  readLatest,
  save,
  toMarkdown,
} = require("./packaged-app-smoke")

test("parseSmokeOutput extracts the final smoke JSON payload", () => {
  const output = [
    "noise",
    "[electron-smoke] {",
    "  \"ok\": true,",
    "  \"checks\": [{ \"name\": \"app shell\", \"passed\": true }]",
    "}",
  ].join("\n")

  const parsed = parseSmokeOutput(output)

  assert.equal(parsed.ok, true)
  assert.equal(parsed.checks.length, 1)
  assert.equal(parsed.checks[0].name, "app shell")
})

test("packaged app smoke report blocks on failed launch", () => {
  const report = buildReportFromResult({
    status: 1,
    stdout: "",
    stderr: "boom",
  }, { createdAt: 1 })

  assert.equal(report.reportKind, "packaged-app-smoke")
  assert.equal(report.ready, false)
  assert.equal(report.status, "blocked")
  assert.equal(report.scope.realLaunchExecuted, true)
})

test("packaged app smoke saves latest and history artifacts", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-packaged-smoke-"))
  const report = buildReportFromResult({
    status: 0,
    stdout: '[electron-smoke] {"ok":true,"checks":[{"name":"preload","passed":true}]}',
    stderr: "",
  }, { createdAt: 1 })
  const saved = save(report, { reportDir })
  const latest = readLatest({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.reportKind, "packaged-app-smoke")
  assert.match(toMarkdown(report), /Packaged App Smoke/)
})

test("packaged app smoke can read payload from result file", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-packaged-payload-"))
  const resultFile = path.join(reportDir, "result.json")
  fs.writeFileSync(resultFile, JSON.stringify({
    ok: true,
    checks: [{ name: "packaged bridge", passed: true }],
  }), "utf8")

  const payload = readSmokeResultFile(resultFile)
  const report = buildReportFromResult({
    status: 0,
    stdout: "",
    stderr: "",
  }, { createdAt: 1, smokeResultFile: resultFile, smokePayload: payload })

  assert.equal(report.ready, true)
  assert.equal(report.summary.smokeChecks, 1)
  assert.match(report.checks.find((item) => item.id === "packaged_smoke_payload").detail, /result file/)
})
