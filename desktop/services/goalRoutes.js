/**
 * Goal API Routes — persistent goals with SQLite storage.
 */

const goalStore = require("./goalStore")

function register(router) {
  router.register("POST", "/api/goals/create", async ({ body }) => {
    const { description, projectRoot } = body || {}
    if (!description) throw new Error("description required")
    const goal = goalStore.createGoal(description, projectRoot)
    return { ...goal }
  })

  router.register("GET", "/api/goals/list", async ({ body }) => {
    const status = body?.status || null
    const goals = status ? goalStore.listGoals(status) : goalStore.listGoals()
    return { goals }
  })

  router.register("GET", "/api/goals/incomplete", async () => {
    const goals = goalStore.getIncompleteGoals()
    return { goals }
  })

  router.register("GET", "/api/goals/queue", async () => {
    return { queue: goalStore.listQueue() }
  })

  router.register("POST", "/api/goals/queue/next", async () => {
    const goal = goalStore.getNextQueuedGoal()
    return { goal }
  })

  router.register("GET", "/api/goals/:id", async ({ params }) => {
    const goal = goalStore.getGoal(params.id)
    if (!goal) throw new Error("Goal not found")
    return { ...goal }
  })

  router.register("POST", "/api/goals/:id/status", async ({ params, body }) => {
    const { status } = body || {}
    if (!status) throw new Error("status required")
    goalStore.updateGoalStatus(params.id, status)
    return { success: true }
  })

  router.register("POST", "/api/goals/:id/checkpoint", async ({ params, body }) => {
    const { stepIndex, conversationSnapshot } = body || {}
    goalStore.saveCheckpoint(params.id, stepIndex || 0, conversationSnapshot || "")
    return { success: true }
  })

  router.register("POST", "/api/goals/:id/resume", async ({ params }) => {
    const goal = goalStore.getGoal(params.id)
    if (!goal) throw new Error("Goal not found")
    const checkpoint = goalStore.getLastCheckpoint(params.id)
    goalStore.updateGoalStatus(params.id, "running")
    return { status: "running", checkpoint }
  })

  router.register("DELETE", "/api/goals/:id", async ({ params }) => {
    goalStore.deleteGoal(params.id)
    return { success: true }
  })

  router.register("POST", "/api/goals/:id/queue", async ({ params }) => {
    const result = goalStore.enqueueGoal(params.id)
    return { success: true, ...result }
  })

  router.register("POST", "/api/goals/:id/dequeue", async ({ params }) => {
    const result = goalStore.dequeueGoal(params.id)
    return { success: true, ...result }
  })

  // ── C-line scheduler integration ─────────────────────────────────────
  let _scheduler = null
  function scheduler() {
    if (_scheduler) return _scheduler
    try { _scheduler = require("./goalScheduler").getScheduler() } catch {}
    return _scheduler
  }

  router.register("POST", "/api/goals/:id/start", async ({ params, body }) => {
    const s = scheduler()
    if (!s) return { success: false, error: "scheduler unavailable" }
    await s.enqueue(params.id, body?.projectRoot, body?.request)
    return { success: true }
  })

  router.register("POST", "/api/goals/:id/cancel", async ({ params }) => {
    const s = scheduler()
    if (!s) return { success: false, error: "scheduler unavailable" }
    const ok = s.cancel(params.id)
    return { success: ok }
  })

  router.register("GET", "/api/goals/:id/logs", async ({ params }) => {
    const goal = goalStore.getGoal(params.id)
    if (!goal) return { logs: [] }
    const lines = []
    for (const step of goal.steps || []) {
      lines.push(`[${step.status}] ${step.description}`)
      if (step.result) lines.push(`  → ${step.result}`)
    }
    return { logs: lines }
  })

  router.register("GET", "/api/scheduler/state", async () => {
    const s = scheduler()
    if (!s) return { running: false }
    return { running: true, ...s.getState() }
  })

  router.register("GET", "/api/scheduler/runtime-health", async ({ query }) => {
    const {
      readLatestGoalRuntimeHealth,
    } = require("./goalScheduler")
    const latest = readLatestGoalRuntimeHealth({ reportDir: query?.reportDir })
    return latest.report || {
      reportKind: "goal-runtime-health",
      status: "missing",
      statusLabel: "暂无长时间运行健康报告",
      ready: false,
      jsonPath: latest.latestJsonPath,
      markdownPath: latest.latestMarkdownPath,
    }
  })

  router.register("POST", "/api/scheduler/runtime-health/run", async ({ body }) => {
    const s = scheduler()
    const {
      buildGoalRuntimeHealth,
      saveGoalRuntimeHealth,
    } = require("./goalScheduler")
    const report = s
      ? s.buildRuntimeHealth(body || {})
      : buildGoalRuntimeHealth({
        schedulerState: {},
        incompleteGoals: goalStore.getIncompleteGoals(),
        auditHistory: body?.auditHistory || [],
      })
    if (body?.write === false) return report
    saveGoalRuntimeHealth(report, { reportDir: body?.reportDir })
    return report
  })

  router.register("GET", "/api/daemon/status", async () => {
    const s = scheduler()
    return {
      running: true,
      pid: process.pid,
      scheduler: s ? s.getState() : null,
    }
  })

  router.register("POST", "/api/daemon/stop", async () => {
    setTimeout(() => {
      try { require("electron").app.quit() } catch { process.exit(0) }
    }, 100)
    return { success: true }
  })

  // ── Notification mode (PLAN_C §W3.1) ──────────────────────────────
  router.register("POST", "/api/notifications/mode", async ({ body }) => {
    const { mode } = body || {}
    if (!["off", "failures-only", "all"].includes(mode)) {
      throw new Error("mode must be one of: off | failures-only | all")
    }
    try { require("./notifications").setMode(mode) } catch {}
    return { success: true, mode }
  })
}

module.exports = { register }
