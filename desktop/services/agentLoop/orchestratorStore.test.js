const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const {
  createOrchestratorStore,
  normalizeInterruptedRun,
} = require("./orchestratorStore")

function dbPath(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `codek-${name}-`))
  return path.join(dir, "orchestrator.db")
}

function sampleRun(status = "waiting_user") {
  return {
    id: "run_1",
    goalId: null,
    projectRoot: "D:/Workspace",
    status,
    visibleMode: "agent",
    executionStrategy: "multi-agent",
    strategyReason: "测试",
    strategySignals: ["multi-file"],
    createdAt: 100,
    updatedAt: 200,
    summary: "summary",
    activeWave: 0,
    budget: { token: null, cost: null, timeMs: null },
    policyProfile: "default",
    qualityGateCommands: ["npm run typecheck"],
    plan: { id: "plan_1" },
    assignments: [
      {
        id: "assignment_1",
        runId: "run_1",
        phaseId: "phase_1",
        role: "implementer",
        status: "completed",
        writePaths: ["src/a.js"],
      },
    ],
    integrationDecision: {
      id: "decision_1",
      runId: "run_1",
      status: "pending",
      conflicts: [],
      proposedPatch: { summary: "1 file", filesChanged: ["src/a.js"], patches: [] },
      reason: "等待确认",
      createdAt: 150,
    },
    events: [
      { runId: "run_1", type: "orchestrator:run_started", createdAt: 101 },
    ],
  }
}

test("orchestratorStore persists and reloads run, assignments, decision, artifacts, and events", () => {
  const file = dbPath("orchestrator-store")
  const store = createOrchestratorStore({ dbPath: file })
  const run = sampleRun()
  store.saveRun(run)
  store.saveArtifact({
    id: "artifact_1",
    runId: run.id,
    assignmentId: "assignment_1",
    type: "patch",
    path: null,
    content: "diff --git a/src/a.js b/src/a.js\n",
    metadata: { filesChanged: ["src/a.js"] },
    createdAt: 300,
  })
  store.saveRecoveryAction({
    id: "recovery_1",
    runId: run.id,
    assignmentId: "assignment_1",
    phaseId: "phase_1",
    action: "retry",
    status: "suggested",
    reason: "retry it",
    payload: {},
    createdAt: 320,
  })
  store.appendEvent(run.id, { type: "orchestrator:assignment_completed", phaseId: "phase_1", createdAt: 250 })
  store.close()

  const reopened = createOrchestratorStore({ dbPath: file })
  const loaded = reopened.getRun(run.id)
  assert.equal(loaded.status, "waiting_user")
  assert.equal(loaded.assignments.length, 1)
  assert.equal(loaded.integrationDecision.status, "pending")
  assert.equal(loaded.events.length, 2)
  assert.equal(reopened.listArtifacts(run.id)[0].type, "patch")
  assert.equal(reopened.listRecoveryActions(run.id)[0].action, "retry")
  assert.equal(reopened.listRuns()[0].id, run.id)
  reopened.close()
})

test("orchestratorStore persists resumable checkpoints", () => {
  const file = dbPath("orchestrator-checkpoint")
  const store = createOrchestratorStore({ dbPath: file })
  const run = sampleRun("waiting_user")
  store.saveRun(run)
  const checkpoint = store.saveCheckpoint(run.id, {
    stage: "waiting_user",
    summary: "等待用户确认 patch",
    plan: run.plan,
    assignments: run.assignments,
    artifactIds: ["artifact_1"],
    qualityGate: { status: "pending" },
    recoveryActionIds: ["recovery_1"],
    canResume: true,
    previousStatus: "running",
  })
  assert.match(checkpoint.id, /^checkpoint_/)
  assert.equal(checkpoint.runId, run.id)
  assert.equal(checkpoint.canResume, true)
  store.close()

  const reopened = createOrchestratorStore({ dbPath: file })
  const checkpoints = reopened.listCheckpoints(run.id)
  assert.equal(checkpoints.length, 1)
  assert.equal(checkpoints[0].stage, "waiting_user")
  assert.equal(checkpoints[0].artifactIds[0], "artifact_1")
  assert.equal(checkpoints[0].previousStatus, "running")
  assert.equal(reopened.getLatestCheckpoint(run.id).id, checkpoint.id)
  reopened.close()
})

test("normalizeInterruptedRun makes mid-flight states recoverable", () => {
  const running = normalizeInterruptedRun(sampleRun("running"))
  assert.equal(running.status, "failed")
  assert.equal(running.recoveryRecommendation.action, "retry")
  assert.match(running.summary, /应用重启/)

  const applying = normalizeInterruptedRun(sampleRun("applying"))
  assert.equal(applying.status, "waiting_user")
  assert.equal(applying.recoveryRecommendation.action, "ask_user")
  assert.equal(applying.integrationDecision.status, "rework_requested")
  assert.match(applying.integrationDecision.reason, /应用重启/)

  assert.equal(normalizeInterruptedRun(sampleRun("completed")).status, "completed")
})
