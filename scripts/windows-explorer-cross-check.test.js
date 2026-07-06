const assert = require("node:assert/strict")
const test = require("node:test")

const {
  buildWindowsExplorerCrossCheck,
  extractCreateTargetFixture,
  parseArgs,
} = require("./windows-explorer-cross-check")

test("parseArgs accepts report and smoke paths", () => {
  const parsed = parseArgs(["--report-dir=C:/tmp/reports", "--smoke-file=C:/tmp/smoke.json", "--no-write"])

  assert.equal(parsed.reportDir, "C:/tmp/reports")
  assert.equal(parsed.smokeFile, "C:/tmp/smoke.json")
  assert.equal(parsed.noWrite, true)
})

test("extractCreateTargetFixture reads selected target fixture from smoke detail", () => {
  const fixture = extractCreateTargetFixture({
    checks: [{
      name: "multi-root create smoke selected directory controls target",
      detail: JSON.stringify({ fixture: { selectedFile: "C:/repo/src/a.ts", selectedFolder: "C:/repo/src/generated" } }),
    }],
  })

  assert.deepEqual(fixture, { selectedFile: "C:/repo/src/a.ts", selectedFolder: "C:/repo/src/generated" })
})

test("buildWindowsExplorerCrossCheck reports missing fixture as blocked", () => {
  const report = buildWindowsExplorerCrossCheck({ smoke: { checks: [] }, createdAt: 1 })

  assert.equal(report.ready, false)
  assert.equal(report.status, "blocked")
  assert.equal(report.checkCount, 0)
})
