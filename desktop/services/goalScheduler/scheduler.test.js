const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")

test("GoalScheduler starts at most maxConcurrent queued goals", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-scheduler-"))
  process.env.CODEK_DATA = dataDir

  const goalStorePath = require.resolve("../goalStore")
  const schedulerPath = require.resolve("./index")
  delete require.cache[goalStorePath]
  delete require.cache[schedulerPath]

  const goalStore = require("../goalStore")
  const { GoalScheduler } = require("./index")

  const started = []
  const scheduler = new GoalScheduler({ maxConcurrent: 2 })
  scheduler._start = function start(goalId) {
    started.push(goalId)
    this.running.set(goalId, { pid: started.length, _progress: 0, _title: goalId })
  }

  const ids = [
    goalStore.createGoal("任务 1", dataDir).id,
    goalStore.createGoal("任务 2", dataDir).id,
    goalStore.createGoal("任务 3", dataDir).id,
  ]
  ids.forEach((id) => goalStore.enqueueGoal(id))

  scheduler.tick()

  assert.equal(started.length, 2)
  assert.equal(scheduler.running.size, 2)
  assert.equal(goalStore.listQueue().length, 1)
})

test("GoalScheduler cancel marks queued goals as cancelled", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-scheduler-"))
  process.env.CODEK_DATA = dataDir

  const goalStorePath = require.resolve("../goalStore")
  const schedulerPath = require.resolve("./index")
  delete require.cache[goalStorePath]
  delete require.cache[schedulerPath]

  const goalStore = require("../goalStore")
  const { GoalScheduler } = require("./index")

  const scheduler = new GoalScheduler({ maxConcurrent: 1 })
  const id = goalStore.createGoal("等待取消", dataDir).id
  goalStore.enqueueGoal(id)

  assert.equal(scheduler.cancel(id), true)
  assert.equal(goalStore.getGoal(id).status, "cancelled")
})

test("GoalScheduler resumeFromDb requeues interrupted running goals and keeps queued goals", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-scheduler-resume-"))
  process.env.CODEK_DATA = dataDir

  const goalStorePath = require.resolve("../goalStore")
  const schedulerPath = require.resolve("./index")
  delete require.cache[goalStorePath]
  delete require.cache[schedulerPath]

  const goalStore = require("../goalStore")
  const { GoalScheduler } = require("./index")

  const runningId = goalStore.createGoal("运行中断任务", dataDir).id
  const queuedId = goalStore.createGoal("排队任务", dataDir).id
  goalStore.updateGoalStatus(runningId, "running")
  goalStore.enqueueGoal(queuedId)

  const started = []
  const scheduler = new GoalScheduler({ maxConcurrent: 1 })
  scheduler._start = function start(goalId) {
    started.push(goalId)
    this.running.set(goalId, { pid: started.length, _progress: 0, _title: goalId })
  }

  scheduler.resumeFromDb()

  assert.deepEqual(started, [queuedId])
  assert.equal(goalStore.listQueue().some((goal) => goal.id === runningId), true)
})

test("GoalScheduler records phase lifecycle from worker events without changing scheduling mode", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-scheduler-lifecycle-"))
  process.env.CODEK_DATA = dataDir

  const goalStorePath = require.resolve("../goalStore")
  const schedulerPath = require.resolve("./index")
  delete require.cache[goalStorePath]
  delete require.cache[schedulerPath]

  const goalStore = require("../goalStore")
  const { GoalScheduler } = require("./index")

  const scheduler = new GoalScheduler({ maxConcurrent: 1 })
  const id = goalStore.createGoal("生命周期任务", dataDir).id

  scheduler._recordWorkerLifecycle(id, {
    type: "phase_start",
    phaseId: "automation",
    name: "Agent Scheduler / Automation",
    threadId: "019ef8c0-10b4-7471-b69d-4c65d958776f",
  }, { _title: "生命周期任务" })
  scheduler._recordWorkerLifecycle(id, {
    type: "validation_pass",
    phaseId: "automation",
    validation: {
      result: "pass",
      command: "node --test desktop/services/goalScheduler/scheduler.test.js",
    },
    failureRecovery: {
      status: "completed",
      action: "keep manual scheduler flow",
      detail: "no Codex app automation changed",
    },
  }, { _title: "生命周期任务" })

  const state = scheduler.getState()
  const report = scheduler.buildRuntimeHealth({ auditHistory: [{ id: "audit_1" }] })

  assert.equal(state.phaseLifecycle[0].status, "validated-pass")
  assert.equal(state.phaseLifecycle[0].phaseName, "Agent Scheduler / Automation")
  assert.equal(state.phaseLifecycle[0].threadId, "019ef8c0-10b4-7471-b69d-4c65d958776f")
  assert.equal(report.phaseLifecycleSummary.byStatus["validated-pass"], 1)
  assert.equal(report.phaseStatusSchema.statuses.includes("superseded"), true)
})
