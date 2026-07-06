const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  buildOpenSourceReadiness,
  readLatest,
  save,
  toMarkdown,
} = require("./open-source-readiness")

test("open-source readiness checks public release files, workflows, scripts, and secret scan", () => {
  const report = buildOpenSourceReadiness({ createdAt: 1 })

  assert.equal(report.reportKind, "open-source-readiness")
  assert.equal(report.scope.publishes, false)
  assert.equal(report.checks.some((item) => item.id === "readme"), true)
  assert.equal(report.checks.some((item) => item.id === "third_party_notices"), true)
  assert.equal(report.checks.some((item) => item.id === "github_workflows"), true)
  assert.equal(report.checks.some((item) => item.id === "secret_file_ignores"), true)
  assert.equal(report.checks.some((item) => item.id === "public_docs_secret_scan"), true)
})

test("open-source readiness saves latest and history artifacts", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-open-source-readiness-"))
  const report = buildOpenSourceReadiness({ createdAt: 1 })
  const saved = save(report, { reportDir })
  const latest = readLatest({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.reportKind, "open-source-readiness")
  assert.match(toMarkdown(report), /Open Source Readiness/)
})
