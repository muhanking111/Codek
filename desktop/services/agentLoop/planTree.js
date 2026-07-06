/**
 * PlanTree — data structure for B-line multi-phase agent execution.
 *
 * Shape:
 *   { id, goal, phases: [{ id, name, agent, agentRole, dependsOn,
 *                          parallelWith, risk, requiresConsensus,
 *                          consensusWith, consensusForStepId, status,
 *                          tasks: [{ id, description, tool?, files? }] }] }
 */

const STATUS = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
  SKIPPED: "skipped",
})

let counter = 0
function genId(prefix) {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`
}

function createPlan(goal, phases) {
  const plan = {
    id: genId("plan"),
    goal: String(goal || ""),
    createdAt: Date.now(),
    status: STATUS.PENDING,
    phases: (phases || []).map(normalizePhase),
  }
  validate(plan)
  return plan
}

function normalizePhase(raw, idx) {
  const phaseId = raw.id || `phase_${idx + 1}`
  const risk = normalizeRisk(raw.risk || raw.estimatedRisk)
  return {
    id: phaseId,
    name: String(raw.name || phaseId),
    agent: String(raw.agent || "main"),
    agentRole: normalizeAgentRole(raw.agentRole || raw.role),
    dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn.map(String) : [],
    parallelWith: Array.isArray(raw.parallel_with || raw.parallelWith)
      ? (raw.parallel_with || raw.parallelWith).map(String) : [],
    risk,
    estimatedRisk: risk,
    requiresConsensus: raw.requiresConsensus === true,
    consensusWith: Array.isArray(raw.consensusWith) ? raw.consensusWith.map(String) : [],
    consensusForStepId: typeof raw.consensusForStepId === "string"
      ? raw.consensusForStepId
      : typeof raw.consensusForPhaseId === "string"
        ? raw.consensusForPhaseId
        : null,
    status: STATUS.PENDING,
    tasks: (raw.tasks || []).map((t, i) => normalizeTask(phaseId, t, i)),
    result: null,
  }
}

function normalizeTask(phaseId, raw, idx) {
  return {
    id: raw.id || `${phaseId}.task_${idx + 1}`,
    description: String(raw.description || ""),
    instruction: typeof raw.instruction === "string" ? raw.instruction : "",
    tool: raw.tool || null,
    files: Array.isArray(raw.files) ? raw.files.map(String) : [],
    risk: normalizeRisk(raw.risk || raw.estimatedRisk),
    status: STATUS.PENDING,
    result: null,
  }
}

function normalizeRisk(value) {
  return value === "safe" || value === "medium" || value === "high" ? value : "medium"
}

function normalizeAgentRole(value) {
  return typeof value === "string" && value ? value : null
}

function validate(plan) {
  if (!plan || typeof plan !== "object") throw new Error("plan must be an object")
  if (!Array.isArray(plan.phases) || plan.phases.length === 0) {
    throw new Error("plan must have at least one phase")
  }
  const ids = new Set()
  for (const p of plan.phases) {
    if (!p.id) throw new Error("phase missing id")
    if (ids.has(p.id)) throw new Error(`duplicate phase id: ${p.id}`)
    ids.add(p.id)
    if (p.tasks.length > 8) throw new Error(`phase ${p.id} has >8 tasks; split it`)
  }
  for (const p of plan.phases) {
    for (const dep of p.dependsOn) {
      if (!ids.has(dep)) throw new Error(`phase ${p.id} depends on unknown phase ${dep}`)
    }
  }
  if (hasCycle(plan.phases)) throw new Error("phase dependency cycle detected")
  return true
}

function hasCycle(phases) {
  const graph = new Map(phases.map((p) => [p.id, p.dependsOn]))
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map([...graph.keys()].map((k) => [k, WHITE]))
  function dfs(node) {
    color.set(node, GRAY)
    for (const dep of graph.get(node) || []) {
      const c = color.get(dep)
      if (c === GRAY) return true
      if (c === WHITE && dfs(dep)) return true
    }
    color.set(node, BLACK)
    return false
  }
  for (const k of graph.keys()) {
    if (color.get(k) === WHITE && dfs(k)) return true
  }
  return false
}

/**
 * Topological grouping: returns an array of "waves" — phases in the same wave
 * have no dependency between them and can run in parallel.
 */
function topoWaves(plan) {
  const remaining = new Map(plan.phases.map((p) => [p.id, new Set(p.dependsOn)]))
  const byId = new Map(plan.phases.map((p) => [p.id, p]))
  const waves = []
  while (remaining.size > 0) {
    const ready = []
    for (const [id, deps] of remaining) {
      if (deps.size === 0) ready.push(id)
    }
    if (ready.length === 0) throw new Error("plan is not topologically sortable")
    waves.push(ready.map((id) => byId.get(id)))
    for (const id of ready) remaining.delete(id)
    for (const deps of remaining.values()) {
      for (const id of ready) deps.delete(id)
    }
  }
  return waves
}

function setPhaseStatus(plan, phaseId, status, result) {
  const phase = plan.phases.find((p) => p.id === phaseId)
  if (!phase) return
  phase.status = status
  if (result !== undefined) phase.result = result
}

function setTaskStatus(plan, phaseId, taskId, status, result) {
  const phase = plan.phases.find((p) => p.id === phaseId)
  if (!phase) return
  const task = phase.tasks.find((t) => t.id === taskId)
  if (!task) return
  task.status = status
  if (result !== undefined) task.result = result
}

function serialize(plan) {
  return JSON.stringify(plan)
}

function deserialize(json) {
  const obj = typeof json === "string" ? JSON.parse(json) : json
  validate(obj)
  return obj
}

/**
 * Best-effort JSON repair for LLM output:
 *   - strip markdown ```json fences
 *   - find outermost {...}
 *   - parse
 */
function extractJson(text) {
  if (!text) throw new Error("empty plan output")
  let s = String(text).trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const first = s.indexOf("{")
  const last = s.lastIndexOf("}")
  if (first < 0 || last < 0) throw new Error("no JSON object found")
  const slice = s.slice(first, last + 1)
  return JSON.parse(slice)
}

module.exports = {
  STATUS,
  createPlan,
  validate,
  topoWaves,
  setPhaseStatus,
  setTaskStatus,
  serialize,
  deserialize,
  extractJson,
}
