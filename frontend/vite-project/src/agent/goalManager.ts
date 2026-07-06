/**
 * Persistent Goal System — inspired by Codex CLI's /goal command.
 *
 * Goals persist via sessionStorage so they survive page refreshes.
 * Each goal has: description, steps, status, checkpoint data.
 */

const STORAGE_KEY = "codek.goals.v1"

export interface GoalStep {
  id: string
  description: string
  status: "pending" | "running" | "completed" | "failed"
  result?: string
}

export interface Goal {
  id: string
  description: string
  createdAt: number
  updatedAt: number
  status: "pending" | "running" | "completed" | "failed"
  steps: GoalStep[]
  currentStepIdx: number
  sessionSnapshot?: string // saved conversation context
}

let goals: Goal[] = []
let loaded = false

function load() {
  if (loaded) return
  loaded = true
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) goals = JSON.parse(raw)
  } catch {
    goals = []
  }
}

function save() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(goals))
  } catch {
    // storage full — trim oldest
    goals = goals.slice(-5)
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(goals))
    } catch {}
  }
}

export function createGoal(description: string, steps: string[] = []): Goal {
  load()
  const goal: Goal = {
    id: `goal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "pending",
    steps: steps.map((s, i) => ({
      id: `step-${i + 1}`,
      description: s,
      status: "pending" as const,
    })),
    currentStepIdx: 0,
  }
  goals.unshift(goal)
  save()
  return goal
}

export function updateGoal(id: string, patch: Partial<Goal>): Goal | null {
  load()
  const goal = goals.find((g) => g.id === id)
  if (!goal) return null
  Object.assign(goal, patch, { updatedAt: Date.now() })
  save()
  return goal
}

export function startStep(goalId: string): GoalStep | null {
  load()
  const goal = goals.find((g) => g.id === goalId)
  if (!goal) return null
  const step = goal.steps[goal.currentStepIdx]
  if (!step) return null
  step.status = "running"
  goal.updatedAt = Date.now()
  save()
  return step
}

export function completeStep(goalId: string, result?: string): GoalStep | null {
  load()
  const goal = goals.find((g) => g.id === goalId)
  if (!goal) return null
  const step = goal.steps[goal.currentStepIdx]
  if (!step) return null
  step.status = "completed"
  step.result = result
  goal.currentStepIdx++
  goal.updatedAt = Date.now()
  // Check if all steps done
  if (goal.currentStepIdx >= goal.steps.length) {
    goal.status = "completed"
  }
  save()
  return step
}

export function failStep(goalId: string, error?: string): GoalStep | null {
  load()
  const goal = goals.find((g) => g.id === goalId)
  if (!goal) return null
  const step = goal.steps[goal.currentStepIdx]
  if (!step) return null
  step.status = "failed"
  step.result = error
  goal.status = "failed"
  goal.updatedAt = Date.now()
  save()
  return step
}

export function getGoals(): Goal[] {
  load()
  return [...goals]
}

export function getActiveGoal(): Goal | undefined {
  load()
  return goals.find((g) => g.status === "running" || g.status === "pending")
}

export function clearGoals(): void {
  goals = []
  try { sessionStorage.removeItem(STORAGE_KEY) } catch {}
}
