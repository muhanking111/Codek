const VALID_ACTIONS = new Set(["retry", "rewind", "split", "ask_user", "abort"])

function now() {
  return Date.now()
}

function makeId(prefix) {
  return `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createRecoveryAction(input = {}) {
  if (!input.runId) throw new Error("runId required")
  if (!VALID_ACTIONS.has(input.action)) throw new Error("invalid recovery action")
  return {
    id: input.id || makeId("recovery"),
    runId: input.runId,
    assignmentId: input.assignmentId || null,
    phaseId: input.phaseId || null,
    action: input.action,
    status: input.status || "suggested",
    reason: input.reason || defaultReason(input.action),
    payload: input.payload || {},
    createdAt: input.createdAt || now(),
    completedAt: input.completedAt || null,
  }
}

function defaultReason(action) {
  switch (action) {
    case "retry": return "重新执行失败的 assignment"
    case "rewind": return "回退到指定 phase 前重新规划"
    case "split": return "将失败 phase 拆成更小任务"
    case "ask_user": return "需要用户补充信息或确认风险"
    case "abort": return "终止当前 run"
    default: return "恢复动作"
  }
}

function suggestRecoveryActions({ run, assignment, error } = {}) {
  const runId = run?.id
  const assignmentId = assignment?.id || null
  const phaseId = assignment?.phaseId || null
  const reason = error ? `失败原因: ${String(error).slice(0, 240)}` : "assignment 执行失败"
  return [
    createRecoveryAction({ runId, assignmentId, phaseId, action: "retry", reason }),
    createRecoveryAction({
      runId,
      assignmentId,
      phaseId,
      action: "split",
      reason: "当前 phase 可能过大，建议拆小后继续",
      payload: { tasks: assignment?.tasks || [] },
    }),
    createRecoveryAction({
      runId,
      assignmentId,
      phaseId,
      action: "ask_user",
      reason: "需要用户确认失败原因或补充上下文",
      payload: { question: "这个任务失败了，需要你确认下一步处理方式。" },
    }),
    createRecoveryAction({ runId, assignmentId, phaseId, action: "abort", reason: "取消当前 run" }),
  ]
}

function findAssignment(run, action) {
  return (run.assignments || []).find((assignment) => assignment.id === action.assignmentId || assignment.phaseId === action.phaseId)
}

function findPhase(run, action) {
  return (run.plan?.phases || []).find((phase) => phase.id === action.phaseId)
}

function completeAction(action) {
  action.status = "completed"
  action.completedAt = now()
  return action
}

function markRecoveryRunning(run, action) {
  run.status = "recovering"
  action.status = "running"
  action.startedAt = now()
  return run
}

function executeRetry(run, action) {
  const assignment = findAssignment(run, action)
  if (!assignment) throw new Error("assignment not found for retry")
  assignment.status = "queued"
  assignment.completedAt = null
  assignment.startedAt = null
  assignment.retryCount = (assignment.retryCount || 0) + 1
  const phase = findPhase(run, action)
  if (phase) {
    phase.status = "queued"
    phase.result = null
  }
  run.status = "running"
  return {
    artifact: {
      type: "recovery",
      content: `已将 ${assignment.id} 重置为 queued，等待重新执行`,
      metadata: { action: "retry", assignmentId: assignment.id, retryCount: assignment.retryCount },
    },
  }
}

function executeAskUser(run, action) {
  const response = String(action.payload?.userResponse || "").trim()
  if (response) {
    const assignment = findAssignment(run, action)
    if (assignment) {
      assignment.status = "queued"
      assignment.completedAt = null
    }
    const phase = findPhase(run, action)
    if (phase) {
      phase.status = "queued"
      phase.result = null
    }
    run.status = "running"
    run.userRecoveryResponse = response
    return {
      artifact: {
        type: "recovery",
        content: `已收到用户补充信息，任务可继续执行: ${response}`,
        metadata: { action: "ask_user", assignmentId: action.assignmentId, phaseId: action.phaseId, userResponse: response },
      },
    }
  }
  run.status = "waiting_user"
  return {
    artifact: {
      type: "question",
      content: action.payload?.question || action.reason || "需要用户确认",
      metadata: { action: "ask_user", assignmentId: action.assignmentId, phaseId: action.phaseId },
    },
  }
}

function executeAbort(run, action) {
  run.status = "cancelled"
  return {
    artifact: {
      type: "recovery",
      content: action.reason || "已取消 run",
      metadata: { action: "abort" },
    },
  }
}

function executeSplit(run, action) {
  const tasks = Array.isArray(action.payload?.tasks) && action.payload.tasks.length
    ? action.payload.tasks
    : ["重新读取上下文", "执行更小范围修改"]
  const childPhases = tasks.map((task, index) => ({
    id: `${action.phaseId || "phase"}_split_${index + 1}`,
    name: `拆分任务 ${index + 1}`,
    status: "queued",
    tasks: [{ description: typeof task === "string" ? task : task.description || String(task) }],
  }))
  run.status = "waiting_user"
  return {
    artifact: {
      type: "split",
      content: "已生成拆分任务草案，等待用户确认或后续编排接入",
      metadata: { action: "split", phaseId: action.phaseId, childPhases },
    },
  }
}

function executeRewind(run, action) {
  const phaseId = action.phaseId
  const phases = run.plan?.phases || []
  const index = phases.findIndex((phase) => phase.id === phaseId)
  if (index < 0) throw new Error("phase not found for rewind")
  for (let i = index; i < phases.length; i += 1) {
    phases[i].status = "queued"
    phases[i].result = null
  }
  for (const assignment of run.assignments || []) {
    const phaseIndex = phases.findIndex((phase) => phase.id === assignment.phaseId)
    if (phaseIndex >= index) {
      assignment.status = "queued"
      assignment.completedAt = null
    }
  }
  run.status = "running"
  return {
    artifact: {
      type: "recovery",
      content: `已回退到 ${phaseId}`,
      metadata: { action: "rewind", phaseId },
    },
  }
}

function executeRecoveryAction({ run, action }) {
  if (!run) throw new Error("run required")
  const nextRun = clone(run)
  const nextAction = { ...action }
  markRecoveryRunning(nextRun, nextAction)
  let result
  if (action.action === "retry") result = executeRetry(nextRun, nextAction)
  else if (action.action === "ask_user") result = executeAskUser(nextRun, nextAction)
  else if (action.action === "abort") result = executeAbort(nextRun, nextAction)
  else if (action.action === "split") result = executeSplit(nextRun, nextAction)
  else if (action.action === "rewind") result = executeRewind(nextRun, nextAction)
  else throw new Error("invalid recovery action")

  completeAction(nextAction)
  nextAction.nextStatus = nextRun.status
  return {
    run: nextRun,
    action: nextAction,
    artifact: result.artifact,
  }
}

module.exports = {
  createRecoveryAction,
  executeRecoveryAction,
  suggestRecoveryActions,
}
