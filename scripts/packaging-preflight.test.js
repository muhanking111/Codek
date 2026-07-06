const assert = require("node:assert/strict")
const test = require("node:test")

const { buildPackagingPreflight } = require("./packaging-preflight")

test("packaging preflight reports packaging checks with warning policy", () => {
  const report = buildPackagingPreflight({ createdAt: 123 })

  assert.equal(report.reportKind, "packaging-preflight")
  assert.equal(report.createdAt, 123)
  assert.equal(report.summary.total > 0, true)
  assert.equal(report.checks.some((check) => check.id === "pack_win_script"), true)
  assert.equal(Array.isArray(report.warningPolicy), true)
})
