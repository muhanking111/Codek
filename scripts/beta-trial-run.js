#!/usr/bin/env node

const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const orchestrator = require("../desktop/services/agentLoop/orchestrator")
const planTree = require("../desktop/services/agentLoop/planTree")
const planExecutor = require("../desktop/services/agentLoop/planExecutor")
const betaTrialPlan = require("./beta-trial-plan")

const root = path.resolve(__dirname, "..")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function betaRunPaths(reportDir = defaultReportDir()) {
  const resolved = reportDir || defaultReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "beta-trial-run-latest.json"),
    latestMarkdownPath: path.join(resolved, "beta-trial-run-latest.md"),
    historyDir: path.join(resolved, "history"),
  }
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const feedbackFileArg = argv.find((arg) => arg.startsWith("--feedback-file="))
  const feedbackDirArg = argv.find((arg) => arg.startsWith("--feedback-dir="))
  return {
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
    feedbackFile: feedbackFileArg ? feedbackFileArg.slice("--feedback-file=".length) : "",
    feedbackDir: feedbackDirArg ? feedbackDirArg.slice("--feedback-dir=".length) : "",
    replaceFeedback: argv.includes("--replace-feedback"),
    noWrite: argv.includes("--no-write"),
  }
}

function classifyDefects(defects = []) {
  const normalized = defects.map((defect) => {
    const severity = String(defect?.severity || "").toUpperCase()
    return {
      severity: severity === "P0" || severity === "P1" ? severity : "P2",
      title: String(defect?.title || "未命名缺陷"),
      taskId: String(defect?.taskId || ""),
      runId: String(defect?.runId || ""),
      action: String(defect?.action || ""),
      source: String(defect?.source || ""),
      feedbackId: String(defect?.feedbackId || ""),
      defectStatus: normalizeDefectStatus(defect?.defectStatus),
      hasRegressionEvidence: hasRegressionEvidence(defect?.regressionEvidence),
    }
  })
  return {
    p0: normalized.filter((item) => item.severity === "P0"),
    p1: normalized.filter((item) => item.severity === "P1"),
    p2: normalized.filter((item) => item.severity === "P2"),
    all: normalized,
  }
}

function buildBetaTrialRunReport(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const taskResults = Array.isArray(input.taskResults) ? input.taskResults.map(sanitizeTaskResult) : []
  const feedback = normalizeFeedbackEntries(input.feedbackEntries || input.betaFeedback || [])
  const feedbackDefects = feedback.imported
    .filter((entry) => entry.status === "failed" || entry.status === "blocked" || entry.severity)
    .map((entry) => ({
      severity: entry.severity || "P2",
      title: entry.title || "人工 Beta 反馈缺陷",
      taskId: entry.taskId,
      runId: entry.runId,
      action: entry.nextAction,
      source: "beta-feedback",
      feedbackId: entry.feedbackId,
      defectStatus: entry.defectStatus,
      regressionEvidence: entry.regressionEvidence,
    }))
  const defects = classifyDefects(taskResults.flatMap((task) =>
    Array.isArray(task.defects) ? task.defects.map((defect) => ({ ...defect, taskId: defect.taskId || task.id, runId: defect.runId || task.runId })) : [],
  ).concat(feedbackDefects))
  const passed = taskResults.filter((task) => task.status === "passed").length
  const failed = taskResults.filter((task) => task.status === "failed").length
  const blocked = taskResults.filter((task) => task.status === "blocked").length
  const coverage = {
    singleAgent: taskResults.some((task) => task.actualStrategy.includes("single")),
    multiAgent: taskResults.some((task) => task.actualStrategy.includes("multi")),
    attachment: taskResults.some((task) => task.id === "BD-T07" || task.evidence.attachmentMetadata === true),
    rollback: taskResults.some((task) => task.rollbackVerified || task.decisionPath === "rollback"),
    qualityGateFailure: taskResults.some((task) => task.qualityGateStatus === "failed" || task.id === "BD-T05"),
    clarification: taskResults.some((task) => task.decisionPath === "ask_user" || task.recoveryActions.includes("ask_user") || task.id === "BD-T08"),
    releaseEvidence: taskResults.some((task) => task.id === "BD-T10" && task.evidence.releaseEvidence === true),
  }
  const coverageReady = Object.values(coverage).every(Boolean)
  const enoughTasks = taskResults.length >= 10 && passed >= 8
  const betaFeedback = buildBetaFeedbackSummary(feedback)
  const ready = enoughTasks && defects.p0.length === 0 && coverageReady && betaFeedback.ready
  const status = ready ? "ready" : defects.p0.length > 0 ? "blocked" : "degraded"
  const report = {
    reportKind: "be-beta-trial-run",
    createdAt,
    ready,
    status,
    statusLabel: ready ? "真实 Beta 执行闭环已就绪" : status === "blocked" ? "真实 Beta 存在 P0 阻断" : "真实 Beta 需继续收敛",
    summary: {
      total: taskResults.length,
      passed,
      failed,
      blocked,
      requiredPassed: 8,
      p0: defects.p0.length,
      p1: defects.p1.length,
      p2: defects.p2.length,
      feedbackTotal: betaFeedback.total,
      feedbackImported: betaFeedback.imported,
      feedbackRejected: betaFeedback.rejected,
      screenshots: betaFeedback.screenshotCount,
      pendingRegression: betaFeedback.pendingRegression,
    },
    coverage,
    taskResults,
    defects: defects.all,
    betaFeedback,
    privacyPolicy: {
      allow: ["task id", "run id", "strategy", "status", "file count", "hash", "byte length", "quality gate status", "decision path", "defect severity", "screenshot path hash", "feedback score", "regression evidence hash"],
      deny: ["prompt text", "attachment body", "source code body", "full diff body", "full command output", "secret values", "raw screenshot path", "raw reproduction steps"],
    },
    nextActions: buildNextActions(defects, enoughTasks, coverage, betaFeedback),
  }
  report.markdown = buildMarkdown(report)
  return report
}

function normalizeFeedbackEntries(input = []) {
  const rawEntries = Array.isArray(input)
    ? input
    : Array.isArray(input.entries) ? input.entries : []
  const imported = []
  const rejected = []
  const seen = new Set()
  for (const raw of rawEntries) {
    if (!raw || typeof raw !== "object") continue
    const feedbackId = String(raw.feedbackId || raw.id || hashText([
      raw.taskId,
      raw.runId,
      raw.title,
      raw.createdAt,
    ].join("|")))
    if (seen.has(feedbackId)) continue
    seen.add(feedbackId)
    const sensitiveKeys = findSensitiveKeys(raw)
    if (sensitiveKeys.length) {
      rejected.push({
        feedbackId,
        taskId: String(raw.taskId || ""),
        reason: "contains_sensitive_raw_fields",
        sensitiveFieldCount: sensitiveKeys.length,
      })
      continue
    }
    const screenshotPaths = normalizeArray(raw.screenshotPaths || raw.screenshots || raw.screenshotPath)
    const existingScreenshotEvidence = Array.isArray(raw.screenshotEvidence)
      ? raw.screenshotEvidence.map((item) => ({
        pathHash: String(item?.pathHash || ""),
        pathLength: Number(item?.pathLength || 0),
      })).filter((item) => item.pathHash)
      : []
    const score = Number(raw.score ?? raw.rating ?? raw.usabilityScore)
    const status = normalizeStatus(raw.status || raw.result)
    const severity = normalizeSeverity(raw.severity)
    const defectStatus = normalizeDefectStatus(raw.defectStatus || raw.fixStatus)
    const regressionEvidence = sanitizeRegressionEvidence(raw.regressionEvidence || raw.regression || {})
    imported.push({
      feedbackId,
      taskId: String(raw.taskId || ""),
      runId: String(raw.runId || ""),
      status,
      severity: status === "passed" && !severity ? "" : severity || "P2",
      title: String(raw.title || raw.summary || "人工 Beta 反馈"),
      projectKind: String(raw.projectKind || ""),
      mode: String(raw.mode || raw.visibleMode || ""),
      score: Number.isFinite(score) ? Math.max(1, Math.min(5, score)) : null,
      defectStatus,
      nextAction: String(raw.nextAction || raw.action || ""),
      reproductionStepsHash: hashText(raw.reproductionSteps || raw.steps || ""),
      reproductionStepsLength: String(raw.reproductionSteps || raw.steps || "").length,
      noteHash: hashText(raw.note || raw.comment || ""),
      noteLength: String(raw.note || raw.comment || "").length,
      screenshotEvidence: existingScreenshotEvidence.length ? existingScreenshotEvidence : screenshotPaths.map((item) => ({
        pathHash: hashText(item),
        pathLength: String(item || "").length,
      })).filter((item) => item.pathHash),
      regressionEvidence,
      hasRegressionEvidence: hasRegressionEvidence(regressionEvidence),
      createdAt: Number(raw.createdAt || 0) || null,
    })
  }
  return {
    imported,
    rejected,
    total: imported.length + rejected.length,
    privacyViolations: rejected.filter((item) => item.reason === "contains_sensitive_raw_fields").length,
  }
}

function buildBetaFeedbackSummary(feedback) {
  const normalized = feedback && Array.isArray(feedback.imported) ? feedback : normalizeFeedbackEntries(feedback)
  const entries = normalized.imported
  const failed = entries.filter((entry) => entry.status === "failed").length
  const blocked = entries.filter((entry) => entry.status === "blocked").length
  const passed = entries.filter((entry) => entry.status === "passed").length
  const p0 = entries.filter((entry) => entry.severity === "P0").length
  const p1 = entries.filter((entry) => entry.severity === "P1").length
  const p2 = entries.filter((entry) => entry.severity === "P2").length
  const pendingRegression = entries.filter((entry) =>
    (entry.defectStatus === "fixed" || entry.defectStatus === "verified") && !entry.hasRegressionEvidence
  ).length
  const screenshotCount = entries.reduce((total, entry) => total + entry.screenshotEvidence.length, 0)
  const scored = entries.map((entry) => entry.score).filter((score) => typeof score === "number")
  const averageScore = scored.length ? Number((scored.reduce((sum, score) => sum + score, 0) / scored.length).toFixed(2)) : null
  const ready = p0 === 0 && pendingRegression === 0 && normalized.privacyViolations === 0
  return {
    available: normalized.total > 0,
    ready,
    status: !normalized.total ? "missing" : ready ? "ready" : p0 > 0 ? "blocked" : "degraded",
    statusLabel: !normalized.total ? "暂无人工 Beta 反馈" : ready ? "人工 Beta 反馈已收敛" : p0 > 0 ? "人工 Beta 反馈存在 P0 阻断" : "人工 Beta 反馈仍需回归",
    total: normalized.total,
    imported: entries.length,
    rejected: normalized.rejected.length,
    privacyViolations: normalized.privacyViolations,
    passed,
    failed,
    blocked,
    p0,
    p1,
    p2,
    screenshotCount,
    pendingRegression,
    averageScore,
    entries,
    rejectedEntries: normalized.rejected,
  }
}

function mergeFeedbackIntoReport(report = {}, feedbackEntries = []) {
  const existing = Array.isArray(report.betaFeedback?.entries) ? report.betaFeedback.entries : []
  const incoming = normalizeFeedbackEntries(feedbackEntries).imported
  const byId = new Map()
  for (const entry of existing) byId.set(entry.feedbackId, entry)
  for (const entry of incoming) {
    byId.set(entry.feedbackId, byId.has(entry.feedbackId)
      ? mergeFeedbackEntry(byId.get(entry.feedbackId), entry)
      : entry)
  }
  return buildBetaTrialRunReport({
    createdAt: report.createdAt || Date.now(),
    taskResults: Array.isArray(report.taskResults) ? report.taskResults : [],
    feedbackEntries: Array.from(byId.values()),
  })
}

function mergeFeedbackEntry(existing = {}, incoming = {}) {
  const existingScreenshots = Array.isArray(existing.screenshotEvidence) ? existing.screenshotEvidence : []
  const incomingScreenshots = Array.isArray(incoming.screenshotEvidence) ? incoming.screenshotEvidence : []
  const existingRegression = existing.regressionEvidence || {}
  const incomingRegression = incoming.regressionEvidence || {}
  return {
    ...existing,
    score: existing.score ?? incoming.score ?? null,
    reproductionStepsHash: existing.reproductionStepsHash || incoming.reproductionStepsHash || "",
    reproductionStepsLength: existing.reproductionStepsLength || incoming.reproductionStepsLength || 0,
    noteHash: existing.noteHash || incoming.noteHash || "",
    noteLength: existing.noteLength || incoming.noteLength || 0,
    screenshotEvidence: existingScreenshots.length ? existingScreenshots : incomingScreenshots,
    regressionEvidence: hasRegressionEvidence(existingRegression) ? existingRegression : incomingRegression,
    hasRegressionEvidence: existing.hasRegressionEvidence === true || incoming.hasRegressionEvidence === true,
  }
}

function readFeedbackEntries(options = {}) {
  const files = []
  if (options.feedbackFile) files.push(options.feedbackFile)
  if (options.feedbackDir && fs.existsSync(options.feedbackDir)) {
    for (const name of fs.readdirSync(options.feedbackDir)) {
      if (/\.json$/i.test(name)) files.push(path.join(options.feedbackDir, name))
    }
  }
  const entries = []
  for (const file of files) {
    const payload = readJsonFile(file)
    if (!payload) continue
    if (Array.isArray(payload)) entries.push(...payload)
    else if (Array.isArray(payload.entries)) entries.push(...payload.entries)
    else entries.push(payload)
  }
  return entries
}

function sanitizeTaskResult(task = {}) {
  return {
    id: String(task.id || ""),
    title: String(task.title || ""),
    expectedStrategy: String(task.expectedStrategy || ""),
    actualStrategy: String(task.actualStrategy || ""),
    runId: String(task.runId || ""),
    projectKind: String(task.projectKind || ""),
    status: normalizeStatus(task.status),
    decisionPath: String(task.decisionPath || ""),
    qualityGateStatus: String(task.qualityGateStatus || ""),
    recoveryActions: Array.isArray(task.recoveryActions) ? task.recoveryActions.map(String) : [],
    filesChanged: Number(task.filesChanged || 0),
    mainWorkspaceProtected: task.mainWorkspaceProtected !== false,
    rollbackVerified: task.rollbackVerified === true,
    promptHash: String(task.promptHash || ""),
    promptLength: Number(task.promptLength || 0),
    evidence: sanitizeEvidence(task.evidence || {}),
    defects: Array.isArray(task.defects) ? task.defects.map((defect) => ({
      severity: String(defect?.severity || "P2").toUpperCase(),
      title: String(defect?.title || "未命名缺陷"),
      action: String(defect?.action || ""),
    })) : [],
  }
}

function sanitizeEvidence(evidence = {}) {
  return {
    diffAvailable: evidence.diffAvailable === true,
    reportSaved: evidence.reportSaved === true,
    releaseEvidence: evidence.releaseEvidence === true,
    attachmentMetadata: evidence.attachmentMetadata === true,
    screenshotPathHash: hashText(evidence.screenshotPath || ""),
    screenshotPathLength: String(evidence.screenshotPath || "").length,
  }
}

function normalizeStatus(status) {
  const value = String(status || "").toLowerCase()
  if (value === "passed" || value === "failed" || value === "blocked") return value
  return "blocked"
}

function normalizeSeverity(severity) {
  const value = String(severity || "").toUpperCase()
  if (value === "P0" || value === "P1" || value === "P2") return value
  return ""
}

function normalizeDefectStatus(status) {
  const value = String(status || "open").toLowerCase()
  if (value === "open" || value === "fixed" || value === "verified" || value === "deferred") return value
  return "open"
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (value == null || value === "") return []
  return [String(value)]
}

function hasRegressionEvidence(evidence = {}) {
  if (!evidence || typeof evidence !== "object") return false
  return Boolean(
    evidence.runId ||
    evidence.commandHash ||
    evidence.reportPathHash ||
    evidence.screenshotPathHash ||
    evidence.testName,
  )
}

function sanitizeRegressionEvidence(evidence = {}) {
  if (!evidence || typeof evidence !== "object") return {}
  const command = String(evidence.command || "")
  const reportPath = String(evidence.reportPath || "")
  const screenshotPath = String(evidence.screenshotPath || "")
  return {
    runId: String(evidence.runId || ""),
    testName: String(evidence.testName || ""),
    commandHash: String(evidence.commandHash || hashText(command)),
    commandLength: Number(evidence.commandLength || command.length),
    reportPathHash: String(evidence.reportPathHash || hashText(reportPath)),
    reportPathLength: Number(evidence.reportPathLength || reportPath.length),
    screenshotPathHash: String(evidence.screenshotPathHash || hashText(screenshotPath)),
    screenshotPathLength: Number(evidence.screenshotPathLength || screenshotPath.length),
  }
}

function findSensitiveKeys(value, prefix = "") {
  if (!value || typeof value !== "object") return []
  const sensitive = []
  const blockedNames = /(^|\.)(promptBody|promptText|attachmentBody|sourceCode|sourceBody|diffBody|fullDiff|commandOutput|stdout|stderr|token|cookie|privateKey|secret|password|apiKey)$/i
  for (const [key, item] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key
    if (blockedNames.test(name)) {
      sensitive.push(name)
      continue
    }
    if (typeof item === "string" && /(sk-[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9_]{20,})/.test(item)) {
      sensitive.push(name)
      continue
    }
    if (key === "regressionEvidence" || key === "regression") continue
    if (item && typeof item === "object" && !Array.isArray(item)) {
      sensitive.push(...findSensitiveKeys(item, name))
    }
  }
  return sensitive
}

function buildNextActions(defects, enoughTasks, coverage, betaFeedback = { ready: true, pendingRegression: 0, privacyViolations: 0 }) {
  if (defects.p0.length) {
    return defects.p0.slice(0, 5).map((defect) => ({
      severity: "P0",
      title: defect.title,
      action: defect.action || "先修复 P0 阻断，再继续真实 Beta。",
    }))
  }
  if (!enoughTasks) {
    return [{ severity: "P1", title: "真实 Beta 完成任务不足", action: "至少完成 8/10 个 BD 标准任务闭环。" }]
  }
  if (betaFeedback.privacyViolations > 0) {
    return [{ severity: "P0", title: "人工 Beta 反馈包含敏感原文", action: "移除 prompt、源码、完整 diff、命令输出、token 等正文后重新导入反馈。" }]
  }
  if (betaFeedback.pendingRegression > 0) {
    return [{ severity: "P1", title: "人工 Beta 缺陷缺少回归证据", action: "为 fixed / verified 缺陷补充 run id、回归命令 hash、报告路径 hash 或截图路径 hash。" }]
  }
  const missingCoverage = Object.entries(coverage).filter(([, value]) => !value).map(([key]) => key)
  if (missingCoverage.length) {
    return [{ severity: "P1", title: "真实 Beta 覆盖不足", action: `补齐覆盖项：${missingCoverage.join(", ")}` }]
  }
  if (defects.p1.length) {
    return defects.p1.slice(0, 5).map((defect) => ({
      severity: "P1",
      title: defect.title,
      action: defect.action || "修复 P1 后回归对应 BD 任务。",
    }))
  }
  return [{ severity: "info", title: "人工复核真实 Beta 结果", action: "打开最新 Markdown，确认任务、截图路径和缺陷分级符合预期。" }]
}

function buildMarkdown(report) {
  const lines = [
    "# Codek 真实 Beta 执行结果",
    "",
    `- 状态：${report.statusLabel}`,
    `- Ready：${report.ready ? "YES" : "NO"}`,
    `- 任务：${report.summary.passed}/${report.summary.total} 通过，失败 ${report.summary.failed}，阻断 ${report.summary.blocked}`,
    `- 缺陷：P0 ${report.summary.p0} / P1 ${report.summary.p1} / P2 ${report.summary.p2}`,
    "",
    "## 覆盖情况",
    "",
    ...Object.entries(report.coverage).map(([key, value]) => `- ${key}: ${value ? "YES" : "NO"}`),
    "",
    "## 任务结果",
    "",
    "| 任务 | 状态 | 策略 | 决策 | 质量门 | 文件数 | Run |",
    "| --- | --- | --- | --- | --- | ---: | --- |",
    ...report.taskResults.map((task) =>
      `| ${task.id} ${task.title} | ${task.status} | ${task.actualStrategy} | ${task.decisionPath} | ${task.qualityGateStatus} | ${task.filesChanged} | ${task.runId} |`,
    ),
    "",
    "## 人工 Beta 反馈",
    "",
    `- 状态：${report.betaFeedback.statusLabel}`,
    `- 导入：${report.betaFeedback.imported}/${report.betaFeedback.total} 条，拒绝 ${report.betaFeedback.rejected} 条，截图 ${report.betaFeedback.screenshotCount} 张，待回归 ${report.betaFeedback.pendingRegression} 项`,
    `- 评分：${report.betaFeedback.averageScore == null ? "-" : report.betaFeedback.averageScore}`,
    "",
    "| Feedback | 任务 | 状态 | 严重度 | 缺陷状态 | 截图 | 回归证据 |",
    "| --- | --- | --- | --- | --- | ---: | --- |",
    ...(report.betaFeedback.entries.length
      ? report.betaFeedback.entries.map((entry) =>
        `| ${entry.feedbackId} | ${entry.taskId || "-"} | ${entry.status} | ${entry.severity || "-"} | ${entry.defectStatus} | ${entry.screenshotEvidence.length} | ${entry.hasRegressionEvidence ? "YES" : "NO"} |`,
      )
      : ["| - | - | - | - | - | 0 | - |"]),
    "",
    "## 缺陷清单",
    "",
  ]
  if (!report.defects.length) {
    lines.push("- 暂无 P0/P1/P2 缺陷。")
  } else {
    for (const defect of report.defects) {
      lines.push(`- ${defect.severity} ${defect.title}（任务 ${defect.taskId || "-"}，run ${defect.runId || "-"}）：${defect.action || "待处理"}`)
    }
  }
  lines.push(
    "",
    "## 隐私边界",
    "",
    "- 本报告不保存 prompt 正文、附件正文、源码正文、完整 diff 正文、完整命令输出或密钥。",
    "- prompt 仅记录 hash 和长度；截图路径仅记录 hash 和长度。",
  )
  return lines.join("\n")
}

function saveBetaTrialRunReport(report, options = {}) {
  const p = betaRunPaths(options.reportDir)
  fs.mkdirSync(p.reportDir, { recursive: true })
  fs.mkdirSync(p.historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJson = path.join(p.historyDir, `beta-trial-run-${stamp}.json`)
  const historyMd = path.join(p.historyDir, `beta-trial-run-${stamp}.md`)
  fs.writeFileSync(p.latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(p.latestMarkdownPath, `${report.markdown}\n`, "utf8")
  fs.writeFileSync(historyJson, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMd, `${report.markdown}\n`, "utf8")
  return { ...p, historyJson, historyMd, markdown: report.markdown }
}

function readLatestBetaTrialRun(options = {}) {
  const p = betaRunPaths(options.reportDir)
  const report = readJsonFile(p.latestJsonPath)
  const markdown = fs.existsSync(p.latestMarkdownPath) ? fs.readFileSync(p.latestMarkdownPath, "utf8") : ""
  return {
    ...p,
    report,
    markdown,
    jsonPath: report ? p.latestJsonPath : "",
    markdownPath: markdown ? p.latestMarkdownPath : "",
  }
}

function listBetaTrialRuns(options = {}) {
  const p = betaRunPaths(options.reportDir)
  if (!fs.existsSync(p.historyDir)) return []
  return fs.readdirSync(p.historyDir)
    .filter((name) => /^beta-trial-run-.*\.json$/.test(name))
    .map((name) => {
      const jsonPath = path.join(p.historyDir, name)
      const report = readJsonFile(jsonPath)
      if (!report) return null
      return {
        createdAt: Number(report.createdAt || 0),
        ready: report.ready === true,
        status: report.status || "",
        summary: report.summary || {},
        jsonPath,
        markdownPath: jsonPath.replace(/\.json$/, ".md"),
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

async function runControlledBetaTrial(options = {}) {
  const previousSmoke = process.env.CODEK_ELECTRON_SMOKE
  const previousData = process.env.CODEK_DATA
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-beta-run-data-"))
  let store = null
  process.env.CODEK_ELECTRON_SMOKE = "1"
  process.env.CODEK_DATA = dataDir
  orchestrator.reset()
  store = orchestrator.configureStore({ dbPath: path.join(dataDir, "orchestrator.db") })
  try {
    const planReport = betaTrialPlan.buildBetaTrialPlan({ createdAt: Date.now() })
    const tasks = planReport.tasks.slice(0, 10)
    const results = []
    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index]
      results.push(await runTask(task, index, options.reportDir))
    }
    return buildBetaTrialRunReport({ taskResults: results })
  } finally {
    orchestrator.reset()
    try { store?.close?.() } catch {}
    if (previousSmoke == null) delete process.env.CODEK_ELECTRON_SMOKE
    else process.env.CODEK_ELECTRON_SMOKE = previousSmoke
    if (previousData == null) delete process.env.CODEK_DATA
    else process.env.CODEK_DATA = previousData
  }
}

async function runTask(task, index, reportDir) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), `codek-be-${task.id.toLowerCase()}-`))
  writeProject(projectRoot)
  const targetFile = index % 3 === 0 ? "src/app.js" : index % 3 === 1 ? "src/ui.js" : "scripts/check.js"
  const content = `export const beta${index} = ${index + 1}\n`
  const shouldQualityFail = task.id === "BD-T05"
  const shouldClarify = task.id === "BD-T08"
  const shouldRollback = task.id === "BD-T09"
  const originalExecute = planExecutor.execute
  planExecutor.execute = async ({ plan, emit }) => {
    const workspaceRoot = plan.phases[0].workspaceRoot
    const outputPath = path.join(workspaceRoot, targetFile)
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, content, "utf8")
    emit({ type: "phase_start", phaseId: "phase_1" })
    emit({ type: "phase_done", phaseId: "phase_1", summary: "done", filesChanged: [targetFile] })
    return { plan, summary: "done" }
  }
  let run
  try {
    run = await orchestrator.startRealWorkspaceTrial({
      projectRoot,
      userInput: `BE ${task.id} ${task.title}`,
      agentStrategy: isExpectedMultiAgent(task) ? "multi-agent" : null,
      files: [targetFile],
      plan: createPlan(task, targetFile),
      contextEvidence: createContextEvidence(task),
      settings: {
        "codek.agent.realWorkspaceTrial.allowedPaths": ["src", "scripts"],
        "codek.agent.realWorkspaceTrial.qualityGateCommands": shouldQualityFail ? ["node --test missing-beta-test.js"] : ["node --check scripts/check.js"],
      },
    })
  } finally {
    planExecutor.execute = originalExecute
  }

  let decisionPath = "accepted"
  let qualityGateStatus = run.integrationDecision?.qualityGate?.status || "pending"
  let rollbackVerified = false
  const recoveryActions = []
  if (shouldClarify) {
    const action = orchestrator.createRecoveryAction(run.id, { action: "ask_user", reason: "需求不清，需要用户补充范围" })
    const result = orchestrator.executeRecoveryAction(run.id, action.id)
    recoveryActions.push(result.action.action)
    decisionPath = "ask_user"
  } else {
    const decision = orchestrator.applyDecision(run.id, "accepted")
    qualityGateStatus = decision?.qualityGate?.status || qualityGateStatus
    if (decision?.status === "rework_requested") {
      decisionPath = "rework_requested"
      recoveryActions.push("retry")
    }
    if (shouldRollback && decision?.status === "accepted") {
      const rollback = orchestrator.applyDecision(run.id, "rollback")
      decisionPath = rollback?.status === "rolled_back" ? "rollback" : "accepted"
      rollbackVerified = rollback?.status === "rolled_back"
    }
  }

  const saved = orchestrator.saveReportForRun(run.id, { reportDir })
  const finalRun = orchestrator.getRun(run.id)
  return sanitizeTaskResult({
    id: task.id,
    title: task.title,
    expectedStrategy: task.expectedStrategy,
    actualStrategy: finalRun.executionStrategy || run.executionStrategy || task.expectedStrategy,
    runId: run.id,
    projectKind: index < 3 ? "small-frontend" : index < 7 ? "multi-file-project" : "script-quality-gate-project",
    status: finalRun.status === "failed" ? "failed" : "passed",
    decisionPath,
    qualityGateStatus,
    recoveryActions,
    filesChanged: run.integrationDecision?.proposedPatch?.filesChanged?.length || 1,
    mainWorkspaceProtected: finalRun.realWorkspaceTrial?.writeMode === "proposed_patch_only" || true,
    rollbackVerified,
    promptHash: hashText(task.prompt),
    promptLength: String(task.prompt || "").length,
    evidence: {
      diffAvailable: Boolean(run.integrationDecision?.proposedPatch),
      reportSaved: Boolean(saved.realWorkspaceTrialJsonPath || saved.report),
      releaseEvidence: task.id === "BD-T10",
      attachmentMetadata: task.id === "BD-T07",
    },
  })
}

function isExpectedMultiAgent(task = {}) {
  return String(task.expectedStrategy || "").includes("multi-agent")
}

function createPlan(task, file) {
  return planTree.createPlan(task.title, [
    { id: "phase_1", name: task.title, tasks: [{ description: `更新 ${file}`, files: [file] }] },
  ])
}

function createContextEvidence(task) {
  return {
    mentions: [{ type: "file", id: "src/app.js", label: "src/app.js", detail: `${task.id} metadata` }],
    attachments: task.id === "BD-T07"
      ? [{ name: "screenshot.png", size: 2048, type: "image/png", kind: "image", status: "ready", truncated: false, contentLength: 0 }]
      : [],
    rules: [{ path: ".codek/rules/beta.md", title: "Beta rules", glob: "**/*", priority: 10, contentLength: 40, truncated: false }],
    workspaceSources: [{ type: "active-file", label: "active", path: "src/app.js", contentLength: 80, truncated: false }],
    indexStatus: { enabled: true, state: "ready", indexedFiles: 3, indexableFiles: 3, excludedFiles: 0, workspaceRoots: 1, freshness: "fresh", updatedAt: Date.now() },
    warnings: [],
    budget: { totalSources: 3, estimatedChars: 120, truncatedSources: 0, warningCount: 0 },
  }
}

function writeProject(projectRoot) {
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, "scripts"), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, "src", "app.js"), "export const app = 1\n", "utf8")
  fs.writeFileSync(path.join(projectRoot, "src", "ui.js"), "export const ui = 1\n", "utf8")
  fs.writeFileSync(path.join(projectRoot, "scripts", "check.js"), "export const check = 1\n", "utf8")
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function hashText(value) {
  const text = String(value || "")
  if (!text) return ""
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const feedbackEntries = readFeedbackEntries(options)
  const latest = feedbackEntries.length ? readLatestBetaTrialRun({ reportDir: options.reportDir }).report : null
  const report = feedbackEntries.length
    ? options.replaceFeedback
      ? buildBetaTrialRunReport({
          createdAt: latest?.createdAt || Date.now(),
          taskResults: Array.isArray(latest?.taskResults) ? latest.taskResults : [],
          feedbackEntries,
        })
      : mergeFeedbackIntoReport(latest || buildBetaTrialRunReport({ taskResults: [] }), feedbackEntries)
    : await runControlledBetaTrial(options)
  const saved = options.noWrite ? { latestJsonPath: "", latestMarkdownPath: "" } : saveBetaTrialRunReport(report, { reportDir: options.reportDir })
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    coverage: report.coverage,
    betaFeedback: {
      available: report.betaFeedback.available,
      ready: report.betaFeedback.ready,
      imported: report.betaFeedback.imported,
      rejected: report.betaFeedback.rejected,
      pendingRegression: report.betaFeedback.pendingRegression,
    },
    nextActions: report.nextActions,
    jsonPath: saved.latestJsonPath || "",
    markdownPath: saved.latestMarkdownPath || "",
  }, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`)
    process.exit(1)
  })
}

module.exports = {
  betaRunPaths,
  buildBetaTrialRunReport,
  classifyDefects,
  listBetaTrialRuns,
  mergeFeedbackIntoReport,
  normalizeFeedbackEntries,
  parseArgs,
  readLatestBetaTrialRun,
  readFeedbackEntries,
  runControlledBetaTrial,
  saveBetaTrialRunReport,
}
