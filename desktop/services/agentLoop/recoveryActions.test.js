const test = require("node:test")
const assert = require("node:assert/strict")

const {
  createRecoveryAction,
  executeRecoveryAction,
  suggestRecoveryActions,
} = require("./recoveryActions")

function sampleRun() {
  return {
    id: "run_recovery",
    status: "failed",
    assignments: [
      { id: "a1", phaseId: "phase_1", status: "failed", retryCount: 0 },
      { id: "a2", phaseId: "phase_2", status: "completed", retryCount: 0 },
    ],
    plan: {
      phases: [
        { id: "phase_1", status: "failed", tasks: [{ description: "Fix bug" }] },
        { id: "phase_2", status: "done", tasks: [{ description: "Verify" }] },
      ],
    },
    events: [],
  }
}

test("createRecoveryAction normalizes action shape", () => {
  const action = createRecoveryAction({
    runId: "run_1",
    assignmentId: "a1",
    phaseId: "phase_1",
    action: "retry",
    reason: "test",
  })

  assert.equal(action.runId, "run_1")
  assert.equal(action.action, "retry")
  assert.equal(action.status, "suggested")
  assert.ok(action.id.startsWith("recovery_"))
})

test("suggestRecoveryActions recommends retry, split, ask_user, and abort for failed assignment", () => {
  const actions = suggestRecoveryActions({
    run: sampleRun(),
    assignment: { id: "a1", phaseId: "phase_1", status: "failed" },
    error: "test failure",
  })

  assert.deepEqual(actions.map((item) => item.action), ["retry", "split", "ask_user", "abort"])
  assert.equal(actions[0].assignmentId, "a1")
})

test("executeRecoveryAction retry resets assignment and phase to queued", () => {
  const run = sampleRun()
  const action = createRecoveryAction({
    runId: run.id,
    assignmentId: "a1",
    phaseId: "phase_1",
    action: "retry",
  })

  const result = executeRecoveryAction({ run, action })
  assert.equal(result.run.status, "running")
  assert.equal(result.run.assignments[0].status, "queued")
  assert.equal(result.run.assignments[0].retryCount, 1)
  assert.equal(result.action.status, "completed")
  assert.equal(result.action.startedAt > 0, true)
  assert.equal(result.action.nextStatus, "running")
})

test("executeRecoveryAction ask_user moves run to waiting_user", () => {
  const run = sampleRun()
  const action = createRecoveryAction({
    runId: run.id,
    assignmentId: "a1",
    phaseId: "phase_1",
    action: "ask_user",
    payload: { question: "需要哪个文件？" },
  })

  const result = executeRecoveryAction({ run, action })
  assert.equal(result.run.status, "waiting_user")
  assert.equal(result.action.status, "completed")
  assert.equal(result.artifact.type, "question")
  assert.equal(result.action.nextStatus, "waiting_user")
})

test("executeRecoveryAction abort cancels the run", () => {
  const run = sampleRun()
  const action = createRecoveryAction({ runId: run.id, action: "abort" })
  const result = executeRecoveryAction({ run, action })

  assert.equal(result.run.status, "cancelled")
  assert.equal(result.action.status, "completed")
})

test("executeRecoveryAction split creates split artifact and queued child phase draft", () => {
  const run = sampleRun()
  const action = createRecoveryAction({
    runId: run.id,
    assignmentId: "a1",
    phaseId: "phase_1",
    action: "split",
    payload: { tasks: ["Read file", "Patch file"] },
  })

  const result = executeRecoveryAction({ run, action })
  assert.equal(result.run.status, "waiting_user")
  assert.equal(result.artifact.type, "split")
  assert.equal(result.artifact.metadata.childPhases.length, 2)
})

test("executeRecoveryAction ask_user with user response resumes the run", () => {
  const run = sampleRun()
  run.status = "waiting_user"
  const action = createRecoveryAction({
    runId: run.id,
    assignmentId: "a1",
    phaseId: "phase_1",
    action: "ask_user",
    status: "waiting_user",
    payload: { userResponse: "只处理 phase_1，继续执行" },
  })

  const result = executeRecoveryAction({ run, action })
  assert.equal(result.run.status, "running")
  assert.equal(result.run.assignments[0].status, "queued")
  assert.equal(result.action.status, "completed")
  assert.equal(result.action.nextStatus, "running")
  assert.equal(result.artifact.type, "recovery")
})
