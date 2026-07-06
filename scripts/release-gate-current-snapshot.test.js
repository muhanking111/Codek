const assert = require("node:assert/strict")
const { test } = require("node:test")

const { buildCurrentSnapshot, parseArgs } = require("./release-gate-current-snapshot")

test("parseArgs supports report dir, mode, and completed steps", () => {
  const parsed = parseArgs(["--report-dir=C:/tmp/codek", "--mode=public-candidate-upstream", "--completed=typecheck,build"])

  assert.equal(parsed.reportDir, "C:/tmp/codek")
  assert.equal(parsed.mode, "public-candidate-upstream")
  assert.deepEqual(parsed.completed, ["typecheck", "build"])
})

test("buildCurrentSnapshot creates an upstream-ready release gate report", () => {
  const report = buildCurrentSnapshot({
    mode: "public-candidate-upstream",
    completed: ["typecheck", "build"],
  })

  assert.equal(report.ready, true)
  assert.equal(report.upstreamReady, true)
  assert.equal(report.mode, "public-candidate-upstream")
  assert.deepEqual(report.plannedSteps, ["typecheck", "build"])
  assert.equal(report.steps.every((step) => step.passed), true)
})
