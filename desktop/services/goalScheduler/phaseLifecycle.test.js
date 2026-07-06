const assert = require("node:assert/strict")
const test = require("node:test")

const {
  PHASE_STATUS_MODEL,
  buildPhaseLifecycleSummary,
  normalizePhaseLifecycleEntry,
  normalizePhaseStatus,
  recordPhaseLifecycleEvent,
} = require("./phaseLifecycle")

test("phase lifecycle normalizes the product status model and common scheduler aliases", () => {
  assert.deepEqual(PHASE_STATUS_MODEL, [
    "active",
    "completed",
    "systemError",
    "blocked",
    "needs-validation",
    "validated-pass",
    "validated-fail",
    "superseded",
  ])
  assert.equal(normalizePhaseStatus("running"), "active")
  assert.equal(normalizePhaseStatus("done"), "completed")
  assert.equal(normalizePhaseStatus("error"), "systemError")
  assert.equal(normalizePhaseStatus("validation_failed"), "validated-fail")
  assert.equal(normalizePhaseStatus("cancelled"), "superseded")
})

test("recordPhaseLifecycleEvent preserves phase name, thread id, validation and recovery state", () => {
  const started = recordPhaseLifecycleEvent(null, {
    type: "phase_start",
    phaseId: "automation",
    name: "Agent Scheduler / Automation",
    threadId: "019ef8c0-10b4-7471-b69d-4c65d958776f",
  })

  const validation = recordPhaseLifecycleEvent(started, {
    type: "validation_fail",
    phaseId: "automation",
    validation: {
      command: "node --test desktop/services/goalScheduler/phaseLifecycle.test.js",
      result: "fail",
      detail: "focused lifecycle validation failed",
    },
    failureRecovery: {
      status: "blocked",
      detail: "requires operator decision before retry",
    },
  })

  assert.equal(validation.stage, "automation")
  assert.equal(validation.phaseName, "Agent Scheduler / Automation")
  assert.equal(validation.threadId, "019ef8c0-10b4-7471-b69d-4c65d958776f")
  assert.equal(validation.status, "validated-fail")
  assert.equal(validation.validation.status, "validated-fail")
  assert.equal(validation.validation.result, "fail")
  assert.equal(validation.failureRecovery.status, "blocked")
  assert.equal(validation.failureRecovery.detail, "requires operator decision before retry")
})

test("phase lifecycle summary counts every status and missing validation/recovery evidence", () => {
  const entries = [
    normalizePhaseLifecycleEntry({ id: "phase:active", stage: "active", status: "active" }),
    normalizePhaseLifecycleEntry({ id: "phase:done", stage: "done", status: "completed" }),
    normalizePhaseLifecycleEntry({ id: "phase:error", stage: "error", status: "systemError" }),
    normalizePhaseLifecycleEntry({ id: "phase:blocked", stage: "blocked", status: "blocked" }),
    normalizePhaseLifecycleEntry({ id: "phase:needs-validation", stage: "needs-validation", status: "needs-validation" }),
    normalizePhaseLifecycleEntry({ id: "phase:pass", stage: "pass", status: "validated-pass", validation: { result: "pass" } }),
    normalizePhaseLifecycleEntry({ id: "phase:fail", stage: "fail", status: "validated-fail" }),
    normalizePhaseLifecycleEntry({ id: "phase:superseded", stage: "superseded", status: "superseded" }),
  ]
  const summary = buildPhaseLifecycleSummary(entries)

  assert.equal(summary.total, 8)
  assert.equal(summary.byStatus.active, 1)
  assert.equal(summary.byStatus["validated-pass"], 1)
  assert.equal(summary.byStatus["validated-fail"], 1)
  assert.equal(summary.validationVisible, 1)
  assert.equal(summary.validationMissing, 2)
  assert.equal(summary.failureRecoveryMissing, 2)
})
