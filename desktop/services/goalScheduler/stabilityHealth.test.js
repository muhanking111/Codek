const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildGoalRuntimeHealth,
  readLatestGoalRuntimeHealth,
  saveGoalRuntimeHealth,
} = require("./stabilityHealth")

test("goal runtime health warns on running leftovers and missing audit", () => {
  const report = buildGoalRuntimeHealth({
    schedulerState: { runningGoals: 0 },
    incompleteGoals: [{ id: "goal_1", status: "running" }],
    auditHistory: [],
  })

  assert.equal(report.ready, false)
  assert.equal(report.summary.warning, 2)
})

test("goal runtime health persists latest report", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-goal-health-"))
  const report = buildGoalRuntimeHealth({
    schedulerState: { runningGoals: 1 },
    incompleteGoals: [],
    auditHistory: [{ id: "audit_1" }],
  })
  const saved = saveGoalRuntimeHealth(report, { reportDir })
  const latest = readLatestGoalRuntimeHealth({ reportDir })

  assert.equal(report.ready, true)
  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(latest.report.reportKind, "goal-runtime-health")
})

test("goal runtime health exposes scheduler phase lifecycle schema, validation and recovery evidence", () => {
  const report = buildGoalRuntimeHealth({
    schedulerState: {
      runningGoals: 1,
      phaseLifecycle: [
        {
          id: "phase:automation",
          stage: "automation",
          phaseName: "Agent Scheduler / Automation",
          threadId: "019ef8c0-10b4-7471-b69d-4c65d958776f",
          status: "validated-pass",
          validation: {
            result: "pass",
            command: "node --test desktop/services/goalScheduler/phaseLifecycle.test.js",
            detail: "focused lifecycle tests passed",
          },
          failureRecovery: {
            status: "completed",
            action: "continue manual scheduler flow",
            detail: "no external automation modified",
          },
        },
        {
          id: "phase:failure-recovery",
          stage: "failure-recovery",
          phaseName: "Failure Recovery",
          threadId: "019ef8c0-10b4-7471-b69d-4c65d958776f",
          status: "systemError",
          failureRecovery: {
            status: "blocked",
            action: "surface recovery state",
            detail: "requires operator retry",
            retryable: true,
          },
        },
      ],
    },
    incompleteGoals: [],
    auditHistory: [{ id: "audit_1" }],
  })

  assert.equal(report.phaseStatusSchema.statuses.includes("needs-validation"), true)
  assert.equal(report.phaseStatusSchema.statuses.includes("validated-fail"), true)
  assert.equal(report.phaseLifecycle.length, 2)
  assert.equal(report.phaseLifecycle[0].phaseName, "Agent Scheduler / Automation")
  assert.equal(report.phaseLifecycle[0].threadId, "019ef8c0-10b4-7471-b69d-4c65d958776f")
  assert.equal(report.phaseLifecycle[0].validation.status, "validated-pass")
  assert.equal(report.phaseLifecycle[1].failureRecovery.retryable, true)
  assert.equal(report.phaseLifecycleSummary.byStatus["validated-pass"], 1)
  assert.equal(report.phaseLifecycleSummary.byStatus.systemError, 1)
  assert.equal(report.checks.some((check) => check.id === "phase_lifecycle_visibility" && check.status === "passed"), true)
})
