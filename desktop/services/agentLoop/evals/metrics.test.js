const test = require("node:test")
const assert = require("node:assert/strict")

const { summarizeRunMetrics, summarizeRunMetricsCollection } = require("./metrics")

test("summarizeRunMetrics records quality gate, approval, conflict, and recovery metrics", () => {
  const run = {
    id: "run_metrics",
    status: "completed",
    createdAt: 100,
    updatedAt: 450,
    assignments: [{ id: "a1" }, { id: "a2" }],
    integrationDecision: {
      userDecision: "accepted",
      conflicts: [{ file: "src/App.vue", assignments: ["a1", "a2"] }],
      proposedPatch: { filesChanged: ["src/App.vue", "src/main.ts"] },
      qualityGate: {
        status: "failed",
        commandResults: [
          { command: "npm run typecheck", exitCode: 0, durationMs: 120 },
          { command: "npm test", exitCode: 1, durationMs: 80 },
        ],
      },
    },
  }
  const artifacts = [
    { type: "patch" },
    { type: "summary" },
  ]
  const recoveryActions = [
    { action: "retry", status: "completed" },
    { action: "split", status: "suggested" },
  ]

  const metrics = summarizeRunMetrics({ run, artifacts, recoveryActions })

  assert.equal(metrics.durationMs, 350)
  assert.equal(metrics.assignmentCount, 2)
  assert.equal(metrics.patchArtifactCount, 1)
  assert.equal(metrics.filesChanged, 2)
  assert.equal(metrics.conflictCount, 1)
  assert.equal(metrics.approvalCount, 1)
  assert.equal(metrics.qualityGate.failedCommandCount, 1)
  assert.equal(metrics.qualityGate.durationMs, 200)
  assert.deepEqual(metrics.recovery.byAction, { retry: 1, split: 1 })
})

test("summarizeRunMetricsCollection aggregates run metrics", () => {
  const collection = summarizeRunMetricsCollection([
    {
      run: {
        id: "run_ok",
        status: "completed",
        createdAt: 0,
        updatedAt: 10,
        integrationDecision: {
          userDecision: "accepted",
          conflicts: [],
          proposedPatch: { filesChanged: [] },
          qualityGate: { commandResults: [] },
        },
      },
      artifacts: [],
      recoveryActions: [{ action: "retry", status: "completed" }],
    },
    {
      run: {
        id: "run_failed",
        status: "failed",
        createdAt: 0,
        updatedAt: 20,
        integrationDecision: {
          conflicts: [{ file: "a.js", assignments: [] }],
          proposedPatch: { filesChanged: ["a.js"] },
          qualityGate: { commandResults: [{ exitCode: 2 }] },
        },
      },
      artifacts: [],
      recoveryActions: [],
    },
  ])

  assert.equal(collection.totalRuns, 2)
  assert.equal(collection.completedRuns, 1)
  assert.equal(collection.failedRuns, 1)
  assert.equal(collection.totalDurationMs, 30)
  assert.equal(collection.totalConflicts, 1)
  assert.equal(collection.totalApprovals, 1)
  assert.equal(collection.totalRecoveryActions, 1)
  assert.equal(collection.totalQualityGateFailures, 1)
})
