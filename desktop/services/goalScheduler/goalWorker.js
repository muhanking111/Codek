/**
 * Goal Worker — child_process running one goal.
 *
 * Receives a "start" IPC message with { goalId, description, projectRoot, request }
 * Loads the B-line planExecutor and reports progress back via process.send.
 */

const planner = require("../agentLoop/planner")
const executor = require("../agentLoop/planExecutor")
const memory = require("../agentLoop/memory")
const goalStore = require("../goalStore")
const quota = require("./quota")

function emit(payload) {
  if (process.send) {
    try { process.send(payload) } catch {}
  }
}

async function runGoal({ goalId, description, projectRoot, request }) {
  emit({ type: "goal_start", goalId })
  try {
    goalStore.updateGoalStatus(goalId, "running")
  } catch {}

  const rules = memory.buildContextBlock(projectRoot)
  const initialQuota = await quota.check(goalId)
  if (!initialQuota.ok) {
    throw new Error(`quota exceeded before planning: ${initialQuota.reason}`)
  }

  const plan = await planner.generate({
    userInput: description,
    provider: request?.provider || "openai",
    model: request?.model,
    apiKey: request?.apiKey,
    baseUrl: request?.baseUrl,
    projectSummary: request?.projectSummary || "",
    rules,
  })
  const afterPlanQuota = await quota.chargeEstimate(goalId, {
    description,
    rules,
    plan,
  })
  if (!afterPlanQuota.ok) {
    throw new Error(`quota exceeded after planning: ${afterPlanQuota.reason}`)
  }
  if (afterPlanQuota.warn) emit({ type: "quota_warn", goalId, warning: afterPlanQuota.warn })
  emit({ type: "plan", goalId, plan: { id: plan.id, phaseCount: plan.phases.length } })

  const total = plan.phases.length || 1
  let done = 0

  await executor.execute({
    plan,
    parentRequest: {
      provider: request?.provider || "openai",
      model: request?.model,
      apiKey: request?.apiKey,
      baseUrl: request?.baseUrl,
      projectRoot,
      temperature: request?.temperature,
      topP: request?.topP,
      maxTokens: request?.maxTokens,
    },
    goalId,
    sharedContext: rules,
    emit: (ev) => {
      if (ev.type === "phase_done") {
        done += 1
        emit({ type: "progress", goalId, percent: Math.round((done / total) * 100) })
        quota.chargeEstimate(goalId, ev).then((q) => {
          if (q.warn) emit({ type: "quota_warn", goalId, warning: q.warn })
          if (!q.ok) emit({ type: "quota_exceeded", goalId, reason: q.reason })
        }).catch(() => {})
      }
      emit({ ...ev, goalId })
    },
  })

  emit({ type: "done", goalId, success: true })
}

process.on("message", (msg) => {
  if (!msg || msg.type !== "start") return
  const goalId = msg.goalId

  runGoal(msg)
    .then(() => {
      try { goalStore.updateGoalStatus(goalId, "completed") } catch {}
      process.exit(0)
    })
    .catch((err) => {
      emit({ type: "error", goalId, error: err?.message || String(err) })
      try { goalStore.updateGoalStatus(goalId, "failed") } catch {}
      process.exit(1)
    })
})

process.on("SIGTERM", () => {
  emit({ type: "cancelled" })
  process.exit(2)
})
