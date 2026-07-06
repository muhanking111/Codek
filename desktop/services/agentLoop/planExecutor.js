/**
 * PlanExecutor — orchestrates a PlanTree:
 *   - topological waves (parallel where allowed)
 *   - sub-agent per phase (main runs in current context, others via subAgent.runSubAgent)
 *   - file-lock to prevent two phases writing the same file
 *   - reflector hook on failure (retry / rewind / ask_user)
 *   - checkpoint after each phase via goalStore
 */

const planTree = require("./planTree")
const { runSubAgent } = require("./subAgent")
const reflector = require("./reflector")
const goalStore = require("../goalStore")
let crossGoalLocks = null
try { crossGoalLocks = require("../goalScheduler/fileLocks") } catch {}

const fileLocks = new Map() // path → phaseId (in-process)
const phaseToGoal = new Map() // phaseId → goalId (for cross-goal release)

const LOCK_RETRY_MS = 250
const LOCK_TIMEOUT_MS = 30_000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function lockFiles(phaseId, files, goalId) {
  const conflicts = []
  for (const f of files || []) {
    const holder = fileLocks.get(f)
    if (holder && holder !== phaseId) conflicts.push({ file: f, holder })
  }
  if (conflicts.length) return { ok: false, conflicts }
  if (crossGoalLocks && goalId && files && files.length) {
    const res = crossGoalLocks.acquire(goalId, files)
    if (!res.ok) return { ok: false, conflicts: [{ file: res.conflictWith.file, holder: res.conflictWith.goalId }] }
  }
  for (const f of files || []) fileLocks.set(f, phaseId)
  if (goalId) phaseToGoal.set(phaseId, goalId)
  return { ok: true }
}

function unlockFiles(phaseId) {
  const held = []
  for (const [f, holder] of [...fileLocks.entries()]) {
    if (holder === phaseId) { fileLocks.delete(f); held.push(f) }
  }
  const goalId = phaseToGoal.get(phaseId)
  phaseToGoal.delete(phaseId)
  if (crossGoalLocks && goalId && held.length) {
    try { crossGoalLocks.release(goalId, held) } catch {}
  }
}

async function waitForFileLocks(phaseId, files, goalId, emit, signal, timeoutMs = LOCK_TIMEOUT_MS) {
  const startedAt = Date.now()
  let lastConflictKey = ""
  while (true) {
    if (signal?.aborted) {
      throw new Error(`phase ${phaseId} aborted while waiting for file locks`)
    }

    const lock = lockFiles(phaseId, files, goalId)
    if (lock.ok) return lock

    const conflictKey = JSON.stringify(lock.conflicts || [])
    if (conflictKey !== lastConflictKey && typeof emit === "function") {
      emit({ type: "phase_blocked", phaseId, conflicts: lock.conflicts || [] })
      lastConflictKey = conflictKey
    }

    if (Date.now() - startedAt > timeoutMs) {
      return { ok: false, conflicts: lock.conflicts || [], timedOut: true }
    }

    await sleep(LOCK_RETRY_MS)
  }
}

async function runPhase({ phase, plan, parentRequest, emit, signal, sharedContext }) {
  emit({ type: "phase_start", phaseId: phase.id, name: phase.name, agent: phase.agent })
  planTree.setPhaseStatus(plan, phase.id, planTree.STATUS.RUNNING)

  const evidence = []
  const subEmit = (ev) => {
    if (ev && ev.type === "tool_result") {
      evidence.push({ tool: ev.toolName || "(tool)", isError: !!ev.isError, content: String(ev.content || "").slice(0, 500) })
    }
    if (typeof emit === "function") emit(ev)
  }

  let attempt = 0
  while (attempt < reflector.MAX_REFLECTIONS_PER_PHASE + 1) {
    attempt += 1
    try {
      const result = await runSubAgent({
        phase, sharedContext, parentRequest, emit: subEmit, signal,
      })
      planTree.setPhaseStatus(plan, phase.id, planTree.STATUS.DONE, result)
      emit({ type: "phase_done", phaseId: phase.id, summary: result.summary, filesChanged: result.filesChanged })
      return result
    } catch (err) {
      const recentErrors = evidence.filter((e) => e.isError).length
      const decision = reflector.shouldReflect({ phaseId: phase.id, recentErrors, gaveUp: true })
        ? await reflector.reflect({
            phase, evidence,
            provider: parentRequest.provider, model: parentRequest.model,
            signal,
          })
        : { action: "ask_user", reason: err.message }

      emit({ type: "reflection", phaseId: phase.id, decision })

      if (decision.action === "retry" && Array.isArray(decision.new_plan)) {
        phase.tasks = decision.new_plan.map((t, i) => ({
          id: `${phase.id}.task_${i + 1}_r${attempt}`,
          description: String(t.description || ""),
          tool: t.tool || null,
          status: planTree.STATUS.PENDING,
          result: null,
        }))
        continue
      }
      if (decision.action === "rewind") {
        planTree.setPhaseStatus(plan, phase.id, planTree.STATUS.FAILED, { error: err.message, decision })
        return { phaseId: phase.id, success: false, rewind: true }
      }
      // ask_user
      planTree.setPhaseStatus(plan, phase.id, planTree.STATUS.FAILED, { error: err.message })
      emit({ type: "phase_failed", phaseId: phase.id, error: err.message })
      throw err
    }
  }
  throw new Error(`phase ${phase.id} exceeded reflection budget`)
}

async function execute({ plan, parentRequest, emit, signal, goalId, sharedContext = "" }) {
  emit({ type: "plan", plan })

  const waves = planTree.topoWaves(plan)
  let accumulatedSummary = sharedContext

  for (const wave of waves) {
    const promises = wave.map(async (phase) => {
      const planned = (phase.tasks || []).flatMap((t) => (t.files || []))
      const lock = await waitForFileLocks(phase.id, planned, goalId, emit, signal)
      if (!lock.ok) {
        emit({ type: "phase_failed", phaseId: phase.id, error: "file lock timeout", conflicts: lock.conflicts })
        throw new Error(`phase ${phase.id} timed out waiting for file locks`)
      }
      try {
        const r = await runPhase({ phase, plan, parentRequest, emit, signal, sharedContext: accumulatedSummary })
        return r
      } finally {
        unlockFiles(phase.id)
      }
    })

    const results = await Promise.allSettled(promises)
    for (const r of results) {
      if (r.status === "fulfilled" && r.value?.summary) {
        accumulatedSummary += `\n\n[${r.value.phaseId}] ${r.value.summary}`
      }
    }
    // Checkpoint after each wave
    try {
      if (goalId) {
        goalStore.saveCheckpoint(goalId, waves.indexOf(wave), {
          plan, accumulatedSummary,
        })
      }
    } catch {}

    const anyHardFail = results.find((r) => r.status === "rejected")
    if (anyHardFail) {
      throw anyHardFail.reason
    }
  }

  plan.status = planTree.STATUS.DONE
  emit({ type: "plan_done", planId: plan.id })
  return { plan, summary: accumulatedSummary }
}

module.exports = { execute, runPhase, lockFiles, unlockFiles, waitForFileLocks }
