const test = require("node:test")
const assert = require("node:assert/strict")

const { buildDeliveryTrustSummary } = require("./deliveryTrustSummary")

test("buildDeliveryTrustSummary marks complete long task evidence as trusted", () => {
  const summary = buildDeliveryTrustSummary({
    task: { expectedStrategy: "multi-agent" },
    routerDecision: { executionStrategy: "multi-agent" },
    run: {
      executionStrategy: "multi-agent",
      phaseCount: 5,
      assignmentCount: 5,
      filesChanged: ["src/app.js", "src/store.js"],
    },
    checks: [
      { id: "long_task_workspace_isolated", passed: true },
      { id: "long_task_waits_for_user", passed: true },
      { id: "long_task_quality_gate_passed", passed: true },
      { id: "long_task_main_project_updated", passed: true },
    ],
  })

  assert.equal(summary.status, "trusted")
  assert.equal(summary.score, 100)
  assert.match(summary.nextAction, /接受变更/)
  assert.equal(summary.risks.length, 0)
  assert.ok(summary.evidence.some((item) => item.includes("隔离 workspace")))
})

test("buildDeliveryTrustSummary blocks when quality gate or confirmation evidence is missing", () => {
  const summary = buildDeliveryTrustSummary({
    task: { expectedStrategy: "multi-agent" },
    routerDecision: { executionStrategy: "single-agent" },
    run: {
      executionStrategy: "single-agent",
      phaseCount: 1,
      assignmentCount: 1,
      filesChanged: ["src/app.js"],
    },
    checks: [
      { id: "long_task_workspace_isolated", passed: false, label: "workspace 未隔离" },
      { id: "long_task_quality_gate_passed", passed: false, label: "质量门失败" },
    ],
    qualityGate: { status: "failed" },
  })

  assert.equal(summary.status, "blocked")
  assert.ok(summary.score < 70)
  assert.ok(summary.risks.some((item) => item.includes("质量门失败")))
  assert.ok(summary.failedChecks.some((item) => item.id === "long_task_quality_gate_passed"))
})
