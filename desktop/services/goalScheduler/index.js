/**
 * Goal Scheduler — Codex-grade goal queue + concurrency control.
 *
 * - maxConcurrent goals run in parallel via child_process (so LLM SDKs work)
 * - queue persists to goalStore (SQLite); restart auto-resumes "queued"/"running"
 * - emits state events for tray + UI
 * - integrates with quota + file-lock services
 */

const { EventEmitter } = require("events")
const { fork } = require("child_process")
const path = require("path")
const goalStore = require("../goalStore")
const {
  buildGoalRuntimeHealth,
  readLatestGoalRuntimeHealth,
  saveGoalRuntimeHealth,
} = require("./stabilityHealth")
const {
  normalizePhaseLifecycleEntry,
  recordPhaseLifecycleEvent,
} = require("./phaseLifecycle")

const DEFAULT_MAX_CONCURRENT = 3

class GoalScheduler extends EventEmitter {
  constructor(opts = {}) {
    super()
    this.maxConcurrent = opts.maxConcurrent || DEFAULT_MAX_CONCURRENT
    this.workerPath = opts.workerPath || path.join(__dirname, "goalWorker.js")
    this.running = new Map() // goalId → child
    this.phaseLifecycle = new Map()
    this.paused = false
  }

  hasRunningGoals() {
    return this.running.size > 0
  }

  getState() {
    const goals = []
    for (const [id, child] of this.running) {
      goals.push({
        id,
        pid: child.pid,
        progress: child._progress || 0,
        title: child._title || id,
        currentPhase: child._currentPhase || "",
        threadId: child._threadId || "",
      })
    }
    return {
      runningGoals: this.running.size,
      paused: this.paused,
      goals,
      phaseLifecycle: this.getPhaseLifecycle(),
    }
  }

  getPhaseLifecycle() {
    return [...this.phaseLifecycle.values()]
      .map(normalizePhaseLifecycleEntry)
      .sort((a, b) => a.updatedAt - b.updatedAt)
  }

  pauseAll() {
    this.paused = true
    this.emit("state", this.getState())
  }

  resumeAll() {
    this.paused = false
    this.tick()
    this.emit("state", this.getState())
  }

  async enqueue(goalIdOrDescription, projectRoot, request) {
    let goalId = goalIdOrDescription
    let title = goalIdOrDescription
    if (goalIdOrDescription && typeof goalIdOrDescription === "object") {
      goalId = goalIdOrDescription.id
      title = goalIdOrDescription.description || goalId
    }
    if (!goalId || typeof goalId !== "string" || !goalId.startsWith("goal_")) {
      const created = goalStore.createGoal(String(goalIdOrDescription || ""), projectRoot)
      goalId = created.id
      title = created.description
    }
    try { goalStore.enqueueGoal(goalId) } catch {}
    if (request) this._pendingRequests.set(goalId, request)
    this._titles.set(goalId, title)
    this.emit("enqueued", { goalId })
    this.tick()
    return goalId
  }

  _pendingRequests = new Map()
  _titles = new Map()

  tick() {
    if (this.paused) return
    while (this.running.size < this.maxConcurrent) {
      const next = goalStore.getNextQueuedGoal()
      if (!next) break
      this._start(next.id, next.description, next.project_root)
    }
  }

  _start(goalId, description, projectRoot) {
    const req = this._pendingRequests.get(goalId) || {}
    const child = fork(this.workerPath, [], {
      env: { ...process.env, CODEK_GOAL_ID: goalId },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      detached: false,
    })
    child._progress = 0
    child._title = description
    child._threadId = req.sourceThreadId || req.source_thread_id || req.threadId || req.runId || goalId
    this.running.set(goalId, child)

    child.send({
      type: "start",
      goalId, description, projectRoot,
      request: req,
    })

    child.on("message", (msg) => {
      if (!msg) return
      if (msg.type === "progress") {
        child._progress = msg.percent || 0
      }
      if (msg.phaseId) child._currentPhase = msg.phaseId
      this._recordWorkerLifecycle(goalId, msg, child)
      this.emit("workerEvent", { goalId, ...msg })
      this.emit("state", this.getState())
    })

    child.on("exit", (code) => {
      this.running.delete(goalId)
      this._pendingRequests.delete(goalId)
      this._recordWorkerLifecycle(goalId, {
        type: code === 0 ? "done" : "error",
        status: code === 0 ? "completed" : "systemError",
        failureRecovery: code === 0 ? { status: "completed" } : { status: "systemError", action: "inspect worker event log", detail: `worker exited with code ${code}` },
      }, child)
      try { goalStore.updateGoalStatus(goalId, code === 0 ? "completed" : "failed") } catch {}
      this.emit("goalEnd", { goalId, code })
      this.emit("state", this.getState())
      this.tick()
    })
  }

  cancel(goalId) {
    const child = this.running.get(goalId)
    if (child) {
      try { child.kill("SIGTERM") } catch {}
      this._recordWorkerLifecycle(goalId, {
        type: "cancelled",
        status: "superseded",
        failureRecovery: { status: "superseded", action: "manual cancellation", detail: "running goal was cancelled by operator" },
      }, child)
      try { goalStore.updateGoalStatus(goalId, "cancelled") } catch {}
      return true
    }
    try {
      goalStore.dequeueGoal(goalId)
      goalStore.updateGoalStatus(goalId, "cancelled")
      return true
    } catch {}
    return false
  }

  resumeFromDb() {
    // On startup, requeue anything left in 'running' (likely crashed)
    try {
      const incomplete = goalStore.getIncompleteGoals()
      for (const g of incomplete) {
        if (g.status === "running") {
          try { goalStore.enqueueGoal(g.id) } catch {}
          this._recordWorkerLifecycle(g.id, {
            type: "phase_blocked",
            phaseId: "failure-recovery",
            name: "Failure Recovery",
            status: "blocked",
            failureRecovery: {
              status: "blocked",
              action: "requeue interrupted running goal",
              detail: "startup detected a running goal left by a previous process",
              retryable: true,
            },
          }, { _title: g.description || g.id, _threadId: g.thread_id || g.id })
        }
      }
    } catch {}
    this.tick()
  }

  buildRuntimeHealth(input = {}) {
    return buildGoalRuntimeHealth({
      schedulerState: this.getState(),
      phaseLifecycle: input.phaseLifecycle || this.getPhaseLifecycle(),
      incompleteGoals: input.incompleteGoals || goalStore.getIncompleteGoals(),
      auditHistory: input.auditHistory || [],
    })
  }

  _recordWorkerLifecycle(goalId, msg = {}, child = {}) {
    const type = String(msg.type || "")
    if (!msg.phaseId && !["goal_start", "plan_done", "done", "error", "cancelled", "quota_exceeded"].includes(type)) return
    const stage = msg.phaseId || msg.stage || "goal"
    const key = `${goalId}:${stage}`
    const previous = this.phaseLifecycle.get(key)
    const phaseName = msg.phaseName || msg.name || msg.title || (stage === "goal" ? child._title : undefined)
    const threadId = msg.threadId || msg.sourceThreadId || child._threadId || previous?.threadId || goalId
    const entry = recordPhaseLifecycleEvent(previous, {
      ...msg,
      phaseId: stage,
      phaseName,
      threadId,
      evidenceRefs: msg.evidenceRefs || [`goal:${goalId}`],
    })
    this.phaseLifecycle.set(key, entry)
  }
}

let _instance = null
function getScheduler() {
  if (!_instance) _instance = new GoalScheduler()
  return _instance
}

module.exports = {
  GoalScheduler,
  buildGoalRuntimeHealth,
  getScheduler,
  readLatestGoalRuntimeHealth,
  saveGoalRuntimeHealth,
}
