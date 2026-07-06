const test = require("node:test")
const assert = require("node:assert/strict")

const { calibrateTask, summarizeRouterCalibration } = require("./routerCalibration")

test("router calibration keeps aligned recommendations", () => {
  const item = calibrateTask({
    id: "aligned",
    recommendedStrategy: "single-agent",
    actualStrategy: "single-agent",
    realRunComparison: {
      summary: {
        winner: "single-agent",
        totalQualityGateFailures: 0,
        totalConflicts: 0,
        fixtureTypes: ["single-file"],
      },
    },
  })

  assert.equal(item.recommendationAligned, true)
  assert.equal(item.routerAligned, true)
  assert.equal(item.suggestion, "keep")
})

test("router calibration prioritizes conflict and quality signals", () => {
  const quality = calibrateTask({
    id: "quality",
    recommendedStrategy: "multi-agent",
    actualStrategy: "multi-agent",
    realRunComparison: { summary: { winner: "single-agent", totalQualityGateFailures: 1, totalConflicts: 0 } },
  })
  const conflict = calibrateTask({
    id: "conflict",
    recommendedStrategy: "multi-agent",
    actualStrategy: "multi-agent",
    realRunComparison: { summary: { winner: "single-agent", totalQualityGateFailures: 0, totalConflicts: 1 } },
  })

  assert.equal(quality.suggestion, "increase-verifier-weight")
  assert.equal(quality.failureRecommendation.category, "quality_gate")
  assert.equal(conflict.suggestion, "increase-conflict-penalty")
  assert.equal(conflict.failureRecommendation.category, "integration_conflict")
})

test("router calibration summarizes alignment and suggestions", () => {
  const summary = summarizeRouterCalibration([
    {
      id: "a",
      recommendedStrategy: "single-agent",
      actualStrategy: "single-agent",
      realRunComparison: { summary: { winner: "single-agent", totalQualityGateFailures: 0, totalConflicts: 0 } },
    },
    {
      id: "b",
      recommendedStrategy: "multi-agent",
      actualStrategy: "multi-agent",
      realRunComparison: { summary: { winner: "single-agent", totalQualityGateFailures: 0, totalConflicts: 0 } },
    },
  ])

  assert.equal(summary.total, 2)
  assert.equal(summary.recommendationAligned, 1)
  assert.equal(summary.routerAligned, 1)
  assert.equal(summary.misaligned, 1)
  assert.equal(summary.suggestions["lower-multi-agent-weight"], 1)
  assert.equal(summary.failureRecommendations.total, 1)
  assert.equal(summary.failureRecommendations.byCategory.router_misalignment, 1)
})
