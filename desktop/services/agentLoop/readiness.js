const fs = require("node:fs")
const path = require("node:path")
const { normalizeRealWorkspaceTrialConfig, configFromSettings } = require("./realWorkspaceTrial")

const STATUS_LABELS = Object.freeze({
  ready: "企业级就绪",
  degraded: "需要补证据",
  blocked: "运行前阻断",
})

const CHECK_LABELS = Object.freeze({
  passed: "通过",
  warning: "需处理",
  failed: "阻断",
})

const CURRENT_RUN_BLOCKING_WINDOW_MS = 6 * 60 * 60 * 1000

function defaultReadinessReportDir() {
  if (process.env.CODEK_DATA) return path.join(process.env.CODEK_DATA, "reports")
  return path.resolve(process.cwd(), ".codek", "reports")
}

function buildOrchestratorReadinessReport(input = {}) {
  const now = Number(input.now || Date.now())
  const projectRoot = String(input.projectRoot || "").trim()
  const config = normalizeRealWorkspaceTrialConfig({
    ...configFromSettings(input.settings || {}),
    ...(input.realWorkspaceTrial || input.config || {}),
    projectRoot,
  }, { projectRoot })
  const runs = Array.isArray(input.runs) ? input.runs : []
  const checks = [
    checkWorkspaceRoot(projectRoot),
    checkAllowedPaths(config),
    checkQualityGates(config),
    checkWritePolicy(config),
    checkBlockedQualityCommands(config),
    checkRunQueue(runs, now, projectRoot),
    checkReleaseGate(input.releaseGateReport),
    checkAcceptance(input.acceptanceReport),
    checkRealTrial(input.realTrialReport),
  ]
  const summary = summarizeChecks(checks)
  const status = summary.failed > 0 ? "blocked" : summary.warning > 0 ? "degraded" : "ready"
  const next = checks.find((check) => check.status === "failed") || checks.find((check) => check.status === "warning")
  const remediations = buildReadinessRemediations(checks)
  return {
    reportKind: "orchestrator-readiness",
    createdAt: now,
    status,
    statusLabel: STATUS_LABELS[status],
    ready: status === "ready",
    projectRoot,
    realWorkspaceTrial: config,
    summary,
    checks,
    remediations,
    nextAction: next ? `${next.title}: ${next.nextAction || next.detail}` : "可以发起真实工作区 Agent 试运行",
  }
}

function readinessLatestPaths(reportDir = defaultReadinessReportDir()) {
  const resolved = reportDir || defaultReadinessReportDir()
  return {
    reportDir: resolved,
    latestMarkdownPath: path.join(resolved, "orchestrator-readiness-latest.md"),
    latestJsonPath: path.join(resolved, "orchestrator-readiness-latest.json"),
    historyDir: path.join(resolved, "history"),
  }
}

function saveReadinessReport(report, options = {}) {
  if (!report) throw new Error("readiness report required")
  const paths = readinessLatestPaths(options.reportDir)
  fs.mkdirSync(paths.historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyBase = `orchestrator-readiness-${stamp}`
  const historyMarkdownPath = path.join(paths.historyDir, `${historyBase}.md`)
  const historyJsonPath = path.join(paths.historyDir, `${historyBase}.json`)
  const markdown = toReadinessMarkdown(report)
  const latestPayload = {
    ...report,
    markdownPath: paths.latestMarkdownPath,
    jsonPath: paths.latestJsonPath,
    historyMarkdownPath,
    historyJsonPath,
  }
  const historyPayload = {
    ...latestPayload,
    markdownPath: historyMarkdownPath,
    jsonPath: historyJsonPath,
  }
  fs.writeFileSync(paths.latestMarkdownPath, `${markdown}\n`, "utf8")
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(latestPayload, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMarkdownPath, `${markdown}\n`, "utf8")
  fs.writeFileSync(historyJsonPath, `${JSON.stringify(historyPayload, null, 2)}\n`, "utf8")
  return {
    reportDir: paths.reportDir,
    markdownPath: paths.latestMarkdownPath,
    jsonPath: paths.latestJsonPath,
    historyMarkdownPath,
    historyJsonPath,
  }
}

function readLatestReadinessReport(options = {}) {
  const paths = readinessLatestPaths(options.reportDir)
  const report = readJsonFile(paths.latestJsonPath)
  const markdown = fs.existsSync(paths.latestMarkdownPath) ? fs.readFileSync(paths.latestMarkdownPath, "utf8") : ""
  return {
    report,
    markdown,
    jsonPath: report ? paths.latestJsonPath : "",
    markdownPath: markdown ? paths.latestMarkdownPath : "",
  }
}

function listReadinessReports(options = {}) {
  const paths = readinessLatestPaths(options.reportDir)
  if (!fs.existsSync(paths.historyDir)) return []
  return fs.readdirSync(paths.historyDir)
    .filter((name) => /^orchestrator-readiness-.*\.json$/.test(name))
    .map((name) => {
      const jsonPath = path.join(paths.historyDir, name)
      const report = readJsonFile(jsonPath)
      if (!report) return null
      return {
        createdAt: report.createdAt || 0,
        status: report.status || "",
        statusLabel: report.statusLabel || "",
        ready: report.ready === true,
        projectRoot: report.projectRoot || "",
        summary: report.summary || { total: 0, passed: 0, warning: 0, failed: 0 },
        nextAction: report.nextAction || "",
        jsonPath,
        markdownPath: jsonPath.replace(/\.json$/, ".md"),
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

function readinessActionAuditPath(reportDir = defaultReadinessReportDir()) {
  const paths = readinessLatestPaths(reportDir)
  return path.join(paths.reportDir, "orchestrator-readiness-actions.jsonl")
}

function saveReadinessActionAudit(entry = {}, options = {}) {
  const filePath = readinessActionAuditPath(options.reportDir)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const record = {
    id: entry.id || `readiness_action_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Number(entry.createdAt || Date.now()),
    actionId: String(entry.actionId || "unknown"),
    title: String(entry.title || "预检修复动作"),
    status: String(entry.status || "applied"),
    projectRoot: String(entry.projectRoot || ""),
    summary: String(entry.summary || ""),
    settingKeys: Array.isArray(entry.settingKeys) ? entry.settingKeys.map(String).filter(Boolean) : [],
    metadata: isPlainObject(entry.metadata) ? entry.metadata : {},
  }
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8")
  return { entry: record, auditPath: filePath }
}

function listReadinessActionAudits(options = {}) {
  const filePath = readinessActionAuditPath(options.reportDir)
  if (!fs.existsSync(filePath)) return []
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) } catch { return null }
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
}

function runActionAuditPath(reportDir = defaultReadinessReportDir()) {
  const paths = readinessLatestPaths(reportDir)
  return path.join(paths.reportDir, "orchestrator-run-actions.jsonl")
}

function saveRunActionAudit(entry = {}, options = {}) {
  const filePath = runActionAuditPath(options.reportDir)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const startedAt = Number(entry.startedAt || entry.createdAt || Date.now())
  const finishedAt = Number(entry.finishedAt || Date.now())
  const record = {
    id: entry.id || `run_action_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Number(entry.createdAt || finishedAt || Date.now()),
    startedAt,
    finishedAt,
    durationMs: Math.max(0, Number(entry.durationMs || (finishedAt - startedAt) || 0)),
    runId: String(entry.runId || ""),
    actionId: String(entry.actionId || "unknown"),
    title: String(entry.title || "企业运行主操作"),
    status: String(entry.status || "unknown"),
    projectRoot: String(entry.projectRoot || ""),
    summary: truncateText(entry.summary, 240),
    error: truncateText(entry.error, 240),
    metadata: sanitizeRunActionMetadata(entry.metadata),
  }
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8")
  return { entry: record, auditPath: filePath }
}

function listRunActionAudits(options = {}) {
  const filePath = runActionAuditPath(options.reportDir)
  if (!fs.existsSync(filePath)) return []
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) } catch { return null }
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.createdAt || b.finishedAt || 0) - Number(a.createdAt || a.finishedAt || 0))
}

function sanitizeRunActionMetadata(metadata) {
  if (!isPlainObject(metadata)) return {}
  const allowed = {}
  for (const key of ["source", "mode", "reason"]) {
    if (metadata[key] != null) allowed[key] = truncateText(metadata[key], 120)
  }
  return allowed
}

function checkWorkspaceRoot(projectRoot) {
  if (!projectRoot) {
    return failed("workspace_root", "项目根目录", "尚未打开项目，无法进行真实工作区试运行。", "先打开一个真实项目")
  }
  const exists = fs.existsSync(projectRoot)
  if (!exists) {
    return failed("workspace_root", "项目根目录", `项目根目录不存在：${projectRoot}`, "重新打开项目或修正 workspaceRoot")
  }
  const stat = safeStat(projectRoot)
  if (!stat?.isDirectory()) {
    return failed("workspace_root", "项目根目录", `项目根目录不是文件夹：${projectRoot}`, "选择一个项目文件夹")
  }
  return passed("workspace_root", "项目根目录", `已打开：${projectRoot}`)
}

function checkAllowedPaths(config) {
  if (!config.allowedPaths.length) {
    return failed("allowed_paths", "允许路径", "真实试运行未配置允许路径，Agent 无法证明写入边界。", "在 Agent 设置中配置允许路径，例如 src")
  }
  return passed("allowed_paths", "允许路径", `允许 ${config.allowedPaths.length} 个路径：${config.allowedPaths.join(", ")}`)
}

function checkQualityGates(config) {
  if (!config.qualityGateCommands.length) {
    return failed("quality_gates", "质量门", "没有可执行的安全质量门命令。", "配置 npm run typecheck、node --test 等安全质量门")
  }
  return passed("quality_gates", "质量门", `已配置 ${config.qualityGateCommands.length} 条安全命令`)
}

function checkWritePolicy(config) {
  if (config.allowMainWorkspaceWrites) {
    return warning("write_policy", "写入策略", "已允许显式 Accept 后写主工作区，仍需人工审批。", "确认团队是否允许真实写入主工作区")
  }
  return passed("write_policy", "写入策略", "默认 proposal-only，不会自动写主工作区")
}

function checkBlockedQualityCommands(config) {
  if (!config.blockedQualityGateCommands.length) {
    return passed("blocked_quality_gate_commands", "阻断命令", "未发现被拦截的质量门命令")
  }
  return warning(
    "blocked_quality_gate_commands",
    "阻断命令",
    `已拦截 ${config.blockedQualityGateCommands.length} 条高风险命令：${config.blockedQualityGateCommands.join(", ")}`,
    "移除安装、联网或破坏性命令，改用安全质量门",
  )
}

function checkRunQueue(runs, now = Date.now(), projectRoot = "") {
  const blocked = runs.filter((run) => isBlockedRun(run))
  const scopedBlocked = blocked.filter((run) => isRunInProjectScope(run, projectRoot))
  const outOfScopeBlocked = blocked.filter((run) => !isRunInProjectScope(run, projectRoot))
  const interruptedRecovered = scopedBlocked.filter((run) => isAutoRecoveredInterruptedRun(run))
  const actionableBlocked = scopedBlocked.filter((run) => !isAutoRecoveredInterruptedRun(run))
  const currentBlocked = actionableBlocked.filter((run) => isCurrentRunBlocker(run, now))
  const running = runs.filter((run) => ["planning", "running", "integrating", "applying", "verifying", "recovering"].includes(run.status))
  if (currentBlocked.length) {
    return warning("blocked_runs", "当前任务", `${currentBlocked.length} 个当前 run 正在等待用户处理或失败。`, "先处理当前阻塞 run，再发起新的企业级试运行", {
      blockedRunIds: currentBlocked.map((run) => run.id).filter(Boolean),
      historicalBlocked: Math.max(0, actionableBlocked.length - currentBlocked.length),
      interruptedRecovered: interruptedRecovered.length,
      interruptedRecoveredRunIds: interruptedRecovered.slice(0, 20).map((run) => run.id).filter(Boolean),
      outOfScopeBlocked: outOfScopeBlocked.length,
      outOfScopeBlockedRunIds: outOfScopeBlocked.slice(0, 20).map((run) => run.id).filter(Boolean),
      running: running.length,
    })
  }
  const reviewBlockedCount = actionableBlocked.length + interruptedRecovered.length + outOfScopeBlocked.length
  const historicalDetail = reviewBlockedCount
    ? `；另有 ${reviewBlockedCount} 个历史、重启中断或项目外阻塞 run 已归档为复核信息，不阻断当前发布证据`
    : ""
  return passed("blocked_runs", "当前任务", running.length ? `${running.length} 个 run 正在运行，未发现当前阻塞项${historicalDetail}` : `当前没有阻塞 run${historicalDetail}`, {
    running: running.length,
    historicalBlocked: actionableBlocked.length,
    historicalBlockedRunIds: actionableBlocked.slice(0, 20).map((run) => run.id).filter(Boolean),
    interruptedRecovered: interruptedRecovered.length,
    interruptedRecoveredRunIds: interruptedRecovered.slice(0, 20).map((run) => run.id).filter(Boolean),
    outOfScopeBlocked: outOfScopeBlocked.length,
    outOfScopeBlockedRunIds: outOfScopeBlocked.slice(0, 20).map((run) => run.id).filter(Boolean),
  })
}

function isCurrentRunBlocker(run = {}, now = Date.now()) {
  const timestamp = Number(run.updatedAt || run.createdAt || 0)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return true
  return now - timestamp <= CURRENT_RUN_BLOCKING_WINDOW_MS
}

function isRunInProjectScope(run = {}, projectRoot = "") {
  const root = normalizePathForScope(projectRoot)
  if (!root) return true
  const runRoot = normalizePathForScope(run.projectRoot || run.workspaceRoot || run.realWorkspaceTrial?.workspaceRoot || "")
  if (!runRoot) return true
  return runRoot === root || runRoot.startsWith(`${root}/`)
}

function normalizePathForScope(value) {
  const text = String(value || "").trim()
  if (!text) return ""
  return path.resolve(text).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

function isAutoRecoveredInterruptedRun(run = {}) {
  if (run.status !== "failed") return false
  if (run.permissionRequest?.status === "waiting_user") return false
  if (run.integrationDecision?.status) return false
  if (run.blockingReason) return false
  const events = Array.isArray(run.events) ? run.events : []
  if (events.some((event) => event?.type === "orchestrator:recovered_interrupted")) return true
  const summary = String(run.summary || "")
  const recommendation = [
    run.recoveryRecommendation?.reason,
    run.recoveryRecommendation?.action,
  ].map((item) => String(item || "")).join(" ")
  return /应用重启|中断运行|recovered_interrupted|interrupted/i.test(`${summary} ${recommendation}`)
}

function checkReleaseGate(report) {
  if (!report) {
    return warning("release_gate_latest", "发布质量门", "尚未生成 release gate latest 报告。", "运行快速门或发布质量门，补齐发布证据")
  }
  if (report.ready !== true) {
    return warning("release_gate_latest", "发布质量门", "最近一次 release gate 未就绪。", "查看失败步骤并修复后重跑")
  }
  return passed("release_gate_latest", "发布质量门", "最近一次 release gate 已就绪")
}

function checkAcceptance(report) {
  if (!report) {
    return warning("acceptance_latest", "发布验收", "尚未生成发布验收 latest 报告。", "运行发布验收矩阵，补齐真实任务集证据")
  }
  if (report.ready !== true) {
    return warning("acceptance_latest", "发布验收", `发布验收未就绪：${Number(report.passed || 0)}/${Number(report.total || 0)} 通过。`, "处理失败场景后重跑验收")
  }
  return passed("acceptance_latest", "发布验收", `发布验收已就绪：${Number(report.passed || 0)}/${Number(report.total || 0)} 通过`)
}

function checkRealTrial(report) {
  const trial = report?.realWorkspaceTrial
  if (!trial) {
    return warning("real_trial_latest", "真实试运行", "尚未生成真实工作区试运行 latest 报告。", "先在 Agent 面板发起 proposal-only 试运行")
  }
  if (!trial.mainWorkspaceUntouchedBeforeAccept) {
    return warning("real_trial_latest", "真实试运行", "最近一次真实试运行无法证明确认前主工作区未污染。", "复核报告并重新运行 proposal-only 试运行")
  }
  return passed("real_trial_latest", "真实试运行", trial.rollbackAvailable ? "真实试运行证据完整，且可 Rollback" : "真实试运行证据存在，但缺少 Rollback 能力", {
    rollbackAvailable: Boolean(trial.rollbackAvailable),
    filesChanged: Array.isArray(trial.filesChanged) ? trial.filesChanged.length : 0,
  })
}

function isBlockedRun(run = {}) {
  if (run.status === "failed" || run.status === "blocked") return true
  if (run.status !== "waiting_user") return false
  if (run.permissionRequest?.status === "waiting_user") return true
  if (run.integrationDecision?.status === "pending") return true
  if (run.integrationDecision?.status === "rework_requested") return true
  return Boolean(run.blockingReason)
}

function summarizeChecks(checks) {
  const summary = checks.reduce((current, check) => {
    current.total += 1
    current[check.status] = (current[check.status] || 0) + 1
    return current
  }, { total: 0, passed: 0, warning: 0, failed: 0 })
  summary.blocked = summary.failed
  return summary
}

function buildReadinessRemediations(checks = []) {
  const actions = new Map()
  const add = (action) => {
    if (!action?.id || actions.has(action.id)) return
    actions.set(action.id, action)
  }
  for (const check of checks) {
    if (!check || check.status === "passed") continue
    if (["allowed_paths", "quality_gates", "blocked_quality_gate_commands", "write_policy"].includes(check.id)) {
      add({
        id: "apply_safe_defaults",
        checkIds: ["allowed_paths", "quality_gates", "blocked_quality_gate_commands", "write_policy"],
        title: "应用安全默认配置",
        detail: "写入 workspace settings：允许路径、npm run typecheck 质量门，并关闭主工作区写入、联网和安装依赖。",
        scope: "workspace-settings",
        risk: "safe",
        canApplyInUi: true,
        auditEvent: "readiness_safe_defaults_applied",
        settingKeys: [
          "codek.agent.realWorkspaceTrial.allowedPaths",
          "codek.agent.realWorkspaceTrial.qualityGateCommands",
          "codek.agent.realWorkspaceTrial.allowMainWorkspaceWrites",
          "codek.agent.realWorkspaceTrial.allowNetwork",
          "codek.agent.realWorkspaceTrial.allowInstall",
        ],
      })
    } else if (check.id === "workspace_root") {
      add({
        id: "open_project",
        checkIds: ["workspace_root"],
        title: "打开真实项目",
        detail: "先通过文件菜单打开一个真实项目根目录，再重新运行预检。",
        scope: "workspace",
        risk: "safe",
        canApplyInUi: false,
        auditEvent: "readiness_open_project_required",
      })
    } else if (check.id === "release_gate_latest") {
      add({
        id: "run_release_gate",
        checkIds: ["release_gate_latest"],
        title: "运行发布质量门",
        detail: "运行快速门或发布质量门，补齐 release gate latest 证据。",
        scope: "local-report",
        risk: "safe",
        canApplyInUi: false,
        auditEvent: "readiness_release_gate_required",
        command: "npm run release:gate -- --no-write",
      })
    } else if (check.id === "acceptance_latest") {
      add({
        id: "run_acceptance_matrix",
        checkIds: ["acceptance_latest"],
        title: "运行发布验收矩阵",
        detail: "运行发布验收任务集，补齐真实任务场景证据。",
        scope: "local-report",
        risk: "safe",
        canApplyInUi: false,
        auditEvent: "readiness_acceptance_required",
      })
    } else if (check.id === "real_trial_latest") {
      add({
        id: "start_real_workspace_trial",
        checkIds: ["real_trial_latest"],
        title: "发起 proposal-only 真实试运行",
        detail: "在 Orchestrator 面板发起真实工作区试运行，生成 latest/history 证据。",
        scope: "orchestrator-run",
        risk: "medium",
        canApplyInUi: false,
        auditEvent: "readiness_real_trial_required",
      })
    } else if (check.id === "blocked_runs") {
      add({
        id: "review_blocked_runs",
        checkIds: ["blocked_runs"],
        title: "处理阻塞任务",
        detail: "先处理等待权限、等待审批、失败或阻断的 run，再发起新的企业级试运行。",
        scope: "orchestrator-run",
        risk: "safe",
        canApplyInUi: false,
        auditEvent: "readiness_blocked_runs_required",
      })
    }
  }
  return [...actions.values()]
}

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function toReadinessMarkdown(report) {
  const checks = Array.isArray(report.checks) ? report.checks : []
  const remediations = Array.isArray(report.remediations) ? report.remediations : []
  const rows = checks.map((check) =>
    `| ${check.title} | ${check.statusLabel || check.status} | ${escapeCell(check.detail)} | ${escapeCell(check.nextAction || "-")} |`,
  )
  const remediationRows = remediations.map((action) =>
    `| ${escapeCell(action.title)} | ${escapeCell(action.scope)} | ${escapeCell(action.risk)} | ${action.canApplyInUi ? "可在入口执行" : "需人工执行"} | ${escapeCell(action.detail)} |`,
  )
  const config = report.realWorkspaceTrial || {}
  return [
    "# 企业级 Agent 运行预检",
    "",
    `- 状态: ${report.statusLabel || report.status}`,
    `- Project Root: ${report.projectRoot || "-"}`,
    `- Created At: ${new Date(report.createdAt || Date.now()).toISOString()}`,
    `- Summary: ${report.summary?.passed || 0}/${report.summary?.total || 0} 通过，${report.summary?.warning || 0} 个需处理，${report.summary?.failed || 0} 个阻断`,
    `- Next Action: ${report.nextAction || "-"}`,
    "",
    "## 真实工作区边界",
    "",
    `- Write Mode: ${config.writeMode || "-"}`,
    `- Allowed Paths: ${formatList(config.allowedPaths)}`,
    `- Quality Gate Commands: ${formatList(config.qualityGateCommands)}`,
    `- Blocked Commands: ${formatList(config.blockedQualityGateCommands)}`,
    `- Main Workspace Writes: ${config.allowMainWorkspaceWrites ? "允许显式 Accept 后写入" : "默认禁止"}`,
    "",
    "## 检查项",
    "",
    "| 检查 | 状态 | 详情 | 下一步 |",
    "| --- | --- | --- | --- |",
    ...(rows.length ? rows : ["| - | - | - | - |"]),
    "",
    "## 修复建议",
    "",
    "| 建议 | 范围 | 风险 | 执行方式 | 详情 |",
    "| --- | --- | --- | --- | --- |",
    ...(remediationRows.length ? remediationRows : ["| - | - | - | - | - |"]),
  ].join("\n")
}

function escapeCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function formatList(values) {
  return Array.isArray(values) && values.length ? values.join(", ") : "无"
}

function safeStat(value) {
  try {
    return fs.statSync(path.resolve(value))
  } catch {
    return null
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function truncateText(value, maxLength) {
  const text = String(value || "")
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

function passed(id, title, detail, data) {
  return check(id, title, "passed", detail, "", data)
}

function warning(id, title, detail, nextAction, data) {
  return check(id, title, "warning", detail, nextAction, data)
}

function failed(id, title, detail, nextAction, data) {
  return check(id, title, "failed", detail, nextAction, data)
}

function check(id, title, status, detail, nextAction = "", data = undefined) {
  return {
    id,
    title,
    status,
    statusLabel: CHECK_LABELS[status],
    detail,
    nextAction,
    ...(data ? { data } : {}),
  }
}

module.exports = {
  STATUS_LABELS,
  buildOrchestratorReadinessReport,
  defaultReadinessReportDir,
  listReadinessActionAudits,
  listRunActionAudits,
  listReadinessReports,
  readLatestReadinessReport,
  readinessActionAuditPath,
  runActionAuditPath,
  saveReadinessReport,
  saveReadinessActionAudit,
  saveRunActionAudit,
  toReadinessMarkdown,
}
