const test = require("node:test")
const assert = require("node:assert/strict")
const {
  classifyComparisonFailure,
  classifyScenarioFailure,
  summarizeFailureRecommendations,
} = require("./failureRecommendations")

test("failure recommendations classify quality gate and conflict scenarios", () => {
  const quality = classifyScenarioFailure({
    id: "quality_gate_failure",
    qualityGateStatus: "failed",
    qualityGateFailures: 1,
  })
  const conflict = classifyScenarioFailure({
    id: "conflict_blocked",
    conflictCount: 2,
    filesChanged: ["demo.js"],
  })

  assert.equal(quality.category, "quality_gate")
  assert.equal(quality.severity, "high")
  assert.ok(quality.actions.some((item) => item.includes("质量门")))
  assert.equal(conflict.category, "integration_conflict")
  assert.equal(conflict.details.conflictCount, 2)
})

test("failure recommendations classify extension, permission, and ambiguity cases", () => {
  assert.equal(classifyScenarioFailure({ id: "extension_conflict_blocked", fixtureType: "extension-conflict" }).category, "extension_conflict")
  assert.equal(classifyScenarioFailure({ id: "ambiguous_requirement", status: "blocked" }).category, "requirement_ambiguity")
  assert.equal(classifyScenarioFailure({ id: "destructive_request_blocked", permissionRequest: { destructive: true } }).category, "destructive_permission")
  assert.equal(classifyScenarioFailure({
    id: "permission_scope_violation",
    permissionRequest: { violation: true, writePaths: ["src"] },
    filesChanged: ["package.json"],
  }).category, "permission_scope")
})

test("comparison failure recommendations feed router calibration", () => {
  const quality = classifyComparisonFailure({
    summary: { totalQualityGateFailures: 1, totalConflicts: 0, fixtureTypes: ["quality-fail"] },
  })
  const router = classifyComparisonFailure({
    recommendedStrategy: "multi-agent",
    actualStrategy: "multi-agent",
    summary: { winner: "single-agent", totalQualityGateFailures: 0, totalConflicts: 0, fixtureTypes: ["single-file"] },
  })

  assert.equal(quality.category, "quality_gate")
  assert.equal(router.category, "router_misalignment")
  assert.equal(router.details.winner, "single-agent")
})

test("failure recommendation summary aggregates categories and severities", () => {
  const summary = summarizeFailureRecommendations([
    { id: "quality_gate_failure", qualityGateStatus: "failed" },
    { id: "conflict_blocked", conflictCount: 1 },
    { id: "permission_scope_violation", permissionRequest: { violation: true } },
  ])

  assert.equal(summary.total, 3)
  assert.equal(summary.byCategory.quality_gate, 1)
  assert.equal(summary.byCategory.integration_conflict, 1)
  assert.equal(summary.byCategory.permission_scope, 1)
  assert.equal(summary.bySeverity.critical, 1)
})
