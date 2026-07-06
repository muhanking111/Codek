const fs = require("node:fs")
const path = require("node:path")
const { defaultReadinessReportDir } = require("../agentLoop/readiness")
const {
  PHASE_STATUS_MODEL,
  buildPhaseLifecycleSummary,
  normalizePhaseLifecycleEntry,
} = require("./phaseLifecycle")

function buildGoalRuntimeHealth(input = {}) {
  const schedulerState = input.schedulerState || {}
  const incompleteGoals = Array.isArray(input.incompleteGoals) ? input.incompleteGoals : []
  const auditHistory = Array.isArray(input.auditHistory) ? input.auditHistory : []
  const phaseLifecycle = normalizePhaseLifecycleEntries(input.phaseLifecycle || schedulerState.phaseLifecycle)
  const phaseLifecycleSummary = buildPhaseLifecycleSummary(phaseLifecycle)
  const checks = [
    {
      id: "running_state",
      title: "运行中任务状态",
      status: Number(schedulerState.runningGoals || 0) >= 0 ? "passed" : "failed",
      detail: `当前运行任务 ${Number(schedulerState.runningGoals || 0)} 个。`,
      nextAction: "保持 scheduler state 可读，供托盘和恢复视图展示。",
    },
    {
      id: "crash_requeue",
      title: "崩溃后任务重排",
      status: incompleteGoals.some((goal) => goal.status === "running") ? "warning" : "passed",
      detail: incompleteGoals.some((goal) => goal.status === "running")
        ? "存在 running 残留，启动时应重新排队。"
        : "未发现 running 残留。",
      nextAction: "启动时调用 resumeFromDb，把 running 残留重新入队并留下恢复记录。",
    },
    {
      id: "audit_continuity",
      title: "审计历史连续性",
      status: auditHistory.length ? "passed" : "warning",
      detail: auditHistory.length ? `已有 ${auditHistory.length} 条恢复/主操作审计。` : "暂无恢复或主操作审计样本。",
      nextAction: "长时间运行和恢复动作应写入本地 history，便于发布前复盘。",
    },
    {
      id: "phase_lifecycle_visibility",
      title: "阶段生命周期可观察",
      status: phaseLifecycle.length === 0 || (phaseLifecycleSummary.validationMissing === 0 && phaseLifecycleSummary.failureRecoveryMissing === 0) ? "passed" : "warning",
      detail: phaseLifecycle.length > 0
        ? `${phaseLifecycle.length} 个阶段，验证缺口 ${phaseLifecycleSummary.validationMissing} 个，恢复缺口 ${phaseLifecycleSummary.failureRecoveryMissing} 个。`
        : "暂无运行中阶段；状态模型已注册，等待 scheduler 事件填充。",
      nextAction: "scheduler/evidence lifecycle 应持续提供阶段名、thread id、验证结果和失败恢复状态。",
    },
  ]
  const summary = {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    warning: checks.filter((check) => check.status === "warning").length,
    failed: checks.filter((check) => check.status === "failed").length,
  }
  const status = summary.failed > 0 ? "blocked" : summary.warning > 0 ? "degraded" : "ready"
  return {
    reportKind: "goal-runtime-health",
    createdAt: Number(input.createdAt || Date.now()),
    status,
    statusLabel: status === "ready" ? "长时间运行稳定" : status === "degraded" ? "长时间运行需补证据" : "长时间运行阻断",
    ready: status === "ready",
    phaseStatusSchema: {
      stageIds: phaseLifecycle.map((entry) => entry.stage),
      statuses: [...PHASE_STATUS_MODEL],
    },
    phaseLifecycle,
    phaseLifecycleSummary,
    summary,
    checks,
  }
}

function normalizePhaseLifecycleEntries(values) {
  if (!Array.isArray(values)) return []
  return values.map(normalizePhaseLifecycleEntry)
}

function goalRuntimeHealthPaths(reportDir = defaultReadinessReportDir()) {
  const resolved = reportDir || defaultReadinessReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "goal-runtime-health-latest.json"),
    latestMarkdownPath: path.join(resolved, "goal-runtime-health-latest.md"),
  }
}

function saveGoalRuntimeHealth(report, options = {}) {
  const paths = goalRuntimeHealthPaths(options.reportDir)
  fs.mkdirSync(paths.reportDir, { recursive: true })
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${toGoalRuntimeHealthMarkdown(report)}\n`, "utf8")
  return { ...paths, report }
}

function readLatestGoalRuntimeHealth(options = {}) {
  const paths = goalRuntimeHealthPaths(options.reportDir)
  if (!fs.existsSync(paths.latestJsonPath)) return { report: null, ...paths }
  return { report: JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8")), ...paths }
}

function toGoalRuntimeHealthMarkdown(report) {
  const rows = (report.checks || []).map((check) =>
    `| ${check.title} | ${check.status} | ${String(check.detail || "").replace(/\|/g, "\\|")} | ${String(check.nextAction || "").replace(/\|/g, "\\|")} |`,
  )
  const lifecycleRows = (report.phaseLifecycle || []).map((entry) =>
    `| ${entry.phaseName || entry.stage} | ${entry.threadId || "-"} | ${entry.status} | ${entry.validation?.result || "-"} | ${entry.failureRecovery?.status || "-"} |`,
  )
  return [
    "# 长时间运行健康报告",
    "",
    `- 状态: ${report.statusLabel || report.status}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    "",
    "| 检查项 | 状态 | 详情 | 下一步 |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "## 阶段 Lifecycle",
    "",
    "| 阶段 | Thread | 状态 | 验证 | 恢复 |",
    "| --- | --- | --- | --- | --- |",
    ...(lifecycleRows.length ? lifecycleRows : ["| - | - | - | - | - |"]),
  ].join("\n")
}

module.exports = {
  buildGoalRuntimeHealth,
  goalRuntimeHealthPaths,
  readLatestGoalRuntimeHealth,
  saveGoalRuntimeHealth,
  toGoalRuntimeHealthMarkdown,
}
