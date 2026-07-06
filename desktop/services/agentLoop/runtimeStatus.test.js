const assert = require("node:assert/strict")
const test = require("node:test")
const {
  AGENT_RUN_STATES,
  AGENT_RUN_STATE_TRANSITIONS,
  normalizeGoalRuntimeStatus,
  normalizeRunRuntimeStatus,
  normalizeRunState,
} = require("./runtimeStatus")

test("runtime status maps orchestrator run states into user-facing states", () => {
  assert.deepEqual(AGENT_RUN_STATES, [
    "planned",
    "assigned",
    "running",
    "review-ready",
    "verified",
    "blocked",
    "accepted",
    "rolled-back",
  ])
  assert.deepEqual(AGENT_RUN_STATE_TRANSITIONS.planned, ["assigned", "blocked"])
  assert.equal(normalizeRunRuntimeStatus({ status: "planning" }).runtimeStatus, "planned")
  assert.equal(normalizeRunRuntimeStatus({ status: "assigned" }).runtimeStatus, "assigned")
  assert.equal(normalizeRunRuntimeStatus({ status: "running" }).runtimeStatus, "running")
  assert.equal(normalizeRunRuntimeStatus({ status: "integrating" }).runtimeStatus, "running")
  assert.equal(normalizeRunRuntimeStatus({ status: "completed", integrationDecision: { qualityGate: { status: "passed" } } }).runtimeStatus, "verified")
  assert.equal(normalizeRunRuntimeStatus({ status: "accepted" }).runtimeStatus, "accepted")
  assert.equal(normalizeRunRuntimeStatus({ status: "rolled_back" }).runtimeStatus, "rolled-back")
  assert.equal(normalizeRunRuntimeStatus({ status: "failed", summary: "boom" }).runtimeStatus, "blocked")
  assert.equal(normalizeRunRuntimeStatus({ status: "cancelled" }).runtimeStatus, "blocked")
})

test("runtime status separates permission, integration decision, and blocked user waits", () => {
  const permission = normalizeRunRuntimeStatus({
    status: "waiting_user",
    permissionRequest: { status: "waiting_user", reason: "需要删除权限" },
  })
  assert.equal(permission.runtimeStatus, "blocked")
  assert.equal(permission.runtimeStatusLabel, "已阻断")
  assert.match(permission.nextAction, /权限/)

  const decision = normalizeRunRuntimeStatus({
    status: "waiting_user",
    integrationDecision: { status: "pending", reason: "等待 patch 审批" },
  })
  assert.equal(decision.runtimeStatus, "review-ready")
  assert.equal(decision.runtimeStatusLabel, "待审阅")
  assert.match(decision.nextAction, /接受/)

  const rework = normalizeRunRuntimeStatus({
    status: "waiting_user",
    integrationDecision: { status: "rework_requested", reason: "质量门失败" },
  })
  assert.equal(rework.runtimeStatus, "blocked")
  assert.match(rework.runtimeReason, /质量门/)

  const blocked = normalizeRunRuntimeStatus({ status: "waiting_user", blockingReason: "需求不清" })
  assert.equal(blocked.runtimeStatus, "blocked")
  assert.match(blocked.nextAction, /补充信息/)
})

test("normalizes legacy orchestrator statuses into MVP run states", () => {
  assert.equal(normalizeRunState({ status: "queued" }), "planned")
  assert.equal(normalizeRunState({ status: "dispatched" }), "assigned")
  assert.equal(normalizeRunState({ status: "applying" }), "running")
  assert.equal(normalizeRunState({ status: "waiting_user", integrationDecision: { status: "pending" } }), "review-ready")
  assert.equal(normalizeRunState({ status: "completed", integrationDecision: { qualityGate: { status: "passed" } } }), "verified")
  assert.equal(normalizeRunState({ status: "completed", integrationDecision: { status: "accepted" } }), "accepted")
  assert.equal(normalizeRunState({ status: "completed", integrationDecision: { rollbackResult: { status: "success" } } }), "rolled-back")
})

test("runtime status maps goal scheduler states consistently", () => {
  assert.equal(normalizeGoalRuntimeStatus({ status: "pending" }).runtimeStatus, "queued")
  assert.equal(normalizeGoalRuntimeStatus({ status: "queued" }).runtimeStatus, "queued")
  assert.equal(normalizeGoalRuntimeStatus({ status: "running" }).runtimeStatus, "running")
  assert.equal(normalizeGoalRuntimeStatus({ status: "failed" }).runtimeStatus, "failed")
  assert.equal(normalizeGoalRuntimeStatus({ status: "completed" }).runtimeStatus, "completed")
  assert.equal(normalizeGoalRuntimeStatus({ status: "cancelled" }).runtimeStatus, "cancelled")
})
