const STATUS_LABELS = Object.freeze({
  planned: "已计划",
  assigned: "已分配",
  running: "运行中",
  "review-ready": "待审阅",
  verified: "已验证",
  blocked: "已阻断",
  accepted: "已接受",
  "rolled-back": "已回滚",
})

const AGENT_RUN_STATES = Object.freeze([
  "planned",
  "assigned",
  "running",
  "review-ready",
  "verified",
  "blocked",
  "accepted",
  "rolled-back",
])

const AGENT_RUN_STATE_TRANSITIONS = Object.freeze({
  planned: ["assigned", "blocked"],
  assigned: ["running", "blocked"],
  running: ["review-ready", "verified", "blocked"],
  "review-ready": ["verified", "accepted", "blocked", "rolled-back"],
  verified: ["accepted", "blocked", "rolled-back"],
  blocked: ["planned", "assigned", "running", "rolled-back"],
  accepted: ["rolled-back"],
  "rolled-back": [],
})

function hasPendingPermission(run) {
  return run?.permissionRequest?.status === "waiting_user"
}

function hasPendingDecision(run) {
  return run?.integrationDecision?.status === "pending"
}

function hasReworkDecision(run) {
  return run?.integrationDecision?.status === "rework_requested"
}

function normalizeGoalRuntimeStatus(goal = {}) {
  const status = goal.status || "pending"
  if (status === "queued") return buildStatus("queued", "任务正在队列中等待执行", "等待调度器启动")
  if (status === "pending") return buildStatus("queued", "任务已创建，等待进入队列", "加入队列或继续执行")
  if (status === "running") return buildStatus("running", "调度器正在执行任务", "等待当前步骤完成")
  if (status === "failed") return buildStatus("failed", "任务执行失败", "查看失败原因或继续执行")
  if (status === "completed") return buildStatus("completed", "任务已完成", "")
  if (status === "cancelled") return buildStatus("cancelled", "任务已取消", "")
  return buildStatus("queued", "任务等待处理", "加入队列或继续执行")
}

function normalizeRunRuntimeStatus(run = {}) {
  const runtimeState = normalizeRunState(run)
  if (runtimeState === "planned") return buildStatus(runtimeState, run.summary || "Agent run 已进入计划队列", "分配执行者或继续计划")
  if (runtimeState === "assigned") return buildStatus(runtimeState, run.summary || "Agent run 已分配到执行者", "启动受控执行")
  if (runtimeState === "running") return buildStatus(runtimeState, runningReason(run), "等待当前阶段完成")
  if (runtimeState === "review-ready") return buildStatus(runtimeState, run.integrationDecision?.reason || run.summary || "变更和证据已准备审阅", "接受、返工、阻断或回滚")
  if (runtimeState === "verified") return buildStatus(runtimeState, run.summary || "验证命令已通过，等待验收", "接受或回滚")
  if (runtimeState === "accepted") return buildStatus(runtimeState, run.summary || "Agent run 已被接受", "")
  if (runtimeState === "rolled-back") return buildStatus(runtimeState, run.summary || "Agent run 已回滚", "")
  if (run.status === "waiting_user") {
    if (hasPendingPermission(run)) {
      return buildStatus("blocked", run.permissionRequest?.reason || run.blockingReason || "需要确认沙箱权限", "确认权限、缩小范围或取消任务")
    }
    if (hasReworkDecision(run)) {
      return buildStatus("blocked", run.integrationDecision?.reason || run.summary || "质量门失败，需要处理", "查看质量门结果并选择返工或回滚")
    }
    return buildStatus("blocked", run.blockingReason || run.summary || "任务等待用户处理", "补充信息、确认风险或取消任务")
  }
  return buildStatus("blocked", run.blockingReason || run.summary || "任务状态需要人工复核", "补充信息、确认风险或回滚")
}

function normalizeRunState(run = {}) {
  const status = String(run.status || "planning").toLowerCase().replace(/_/g, "-")
  const integrationStatus = String(run.integrationDecision?.status || "").toLowerCase().replace(/_/g, "-")
  const rollbackStatus = String(run.integrationDecision?.rollbackResult?.status || run.rollbackResult?.status || "").toLowerCase().replace(/_/g, "-")
  const qualityGateStatus = String(run.integrationDecision?.qualityGate?.status || run.qualityGate?.status || "").toLowerCase().replace(/_/g, "-")

  if (status === "rolled-back" || rollbackStatus === "success" || rollbackStatus === "rolled-back") return "rolled-back"
  if (status === "accepted" || integrationStatus === "accepted" || integrationStatus === "applied") return "accepted"
  if (status === "verified" || qualityGateStatus === "passed") return "verified"
  if (status === "review-ready" || hasPendingDecision(run)) return "review-ready"
  if (["assigned", "dispatched"].includes(status)) return "assigned"
  if (["running", "integrating", "applying", "verifying", "recovering"].includes(status)) return "running"
  if (["planned", "planning", "queued", "pending", "paused", "completed"].includes(status)) return "planned"
  return "blocked"
}

function runningReason(run = {}) {
  const status = String(run.status || "").toLowerCase()
  if (status === "applying") return "正在应用变更"
  if (status === "verifying") return "正在运行质量门"
  if (status === "integrating") return "正在整合 Agent 产物"
  if (status === "recovering") return "正在执行恢复动作"
  return run.summary || "Agent 正在执行任务"
}

function buildStatus(runtimeStatus, reason, nextAction) {
  return {
    runtimeStatus,
    runtimeStatusLabel: STATUS_LABELS[runtimeStatus] || runtimeStatus || "未知",
    runtimeReason: reason || "",
    nextAction: nextAction || "",
  }
}

module.exports = {
  AGENT_RUN_STATES,
  AGENT_RUN_STATE_TRANSITIONS,
  STATUS_LABELS,
  normalizeGoalRuntimeStatus,
  normalizeRunState,
  normalizeRunRuntimeStatus,
}
