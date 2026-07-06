interface CodekApiLike {
  api?: (method: string, path: string, body?: unknown) => Promise<any>
}

interface GoalResultActionContext {
  codek?: CodekApiLike | null
  getProjectRoot: () => string | null | undefined
  getSelectedGoalResult: () => any
  setSelectedGoalResult: (goal: any) => void
  setGoalResultVisible: (visible: boolean) => void
  warn: (message: string, error: unknown) => void
}

export async function openGoalResult(goalId: string, context: GoalResultActionContext): Promise<void> {
  if (!goalId || !context.codek?.api) return
  try {
    const result = await context.codek.api("GET", `/api/goals/${goalId}`)
    const goal = result?.data || result?.goal || result
    const mapped = mapGoalToResult(goal)
    context.setSelectedGoalResult(mapped)
    context.setGoalResultVisible(Boolean(mapped))
  } catch (err) {
    context.warn("[goal-result] open failed:", err)
  }
}

export function closeGoalResult(context: GoalResultActionContext): void {
  context.setGoalResultVisible(false)
}

export async function retryGoal(goalId: string, context: GoalResultActionContext): Promise<void> {
  if (!goalId || !context.codek?.api) return
  await context.codek.api("POST", `/api/goals/${goalId}/resume`)
  closeGoalResult(context)
}

export async function continueGoal(goalId: string, context: GoalResultActionContext): Promise<void> {
  if (!goalId || !context.codek?.api) return
  await context.codek.api("POST", `/api/goals/${goalId}/start`, {
    projectRoot: context.getProjectRoot(),
    request: context.getSelectedGoalResult()?.description || "",
  })
  closeGoalResult(context)
}

function mapGoalToResult(goal: any): any {
  if (!goal) return null
  const steps = Array.isArray(goal.steps) ? goal.steps : []
  return {
    id: goal.id,
    description: goal.description || goal.id,
    status: goal.status || "unknown",
    startedAt: goal.created_at,
    finishedAt: goal.updated_at,
    durationMs: goal.created_at && goal.updated_at ? Math.max(0, goal.updated_at - goal.created_at) : undefined,
    tokensUsed: goal.tokens_used || 0,
    tokenLimit: goal.token_limit || 0,
    costUsed: goal.cost_used || 0,
    costLimit: goal.cost_limit || 0,
    phases: steps.map((step, index) => ({
      id: step.id || `step_${index + 1}`,
      name: step.description || `Step ${index + 1}`,
      status: step.status === "completed" ? "done" : step.status,
      summary: step.result || "",
    })),
    error: goal.status === "failed" ? (steps.find((step) => step.status === "failed")?.result || "") : "",
  }
}
