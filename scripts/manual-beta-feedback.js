#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")

const betaTrialPlan = require("./beta-trial-plan")
const betaTrialRun = require("./beta-trial-run")

const root = path.resolve(__dirname, "..")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function manualFeedbackPaths(reportDir = defaultReportDir()) {
  const resolved = reportDir || defaultReportDir()
  return {
    reportDir: resolved,
    feedbackDir: path.join(resolved, "manual-feedback"),
    screenshotDir: path.join(resolved, "manual-feedback", "screenshots"),
    indexPath: path.join(resolved, "manual-feedback", "README.md"),
    latestJsonPath: path.join(resolved, "manual-beta-feedback-latest.json"),
    latestMarkdownPath: path.join(resolved, "manual-beta-feedback-latest.md"),
    historyDir: path.join(resolved, "history"),
  }
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const feedbackDirArg = argv.find((arg) => arg.startsWith("--feedback-dir="))
  return {
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
    feedbackDir: feedbackDirArg ? feedbackDirArg.slice("--feedback-dir=".length) : "",
    init: argv.includes("--init"),
    noWrite: argv.includes("--no-write"),
  }
}

function buildManualFeedbackPlan(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const plan = betaTrialPlan.buildBetaTrialPlan({ createdAt })
  const tasks = plan.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    expectedStrategy: task.expectedStrategy,
    requiredResult: task.requiredResult,
    evidence: task.evidence,
    templateFile: `${task.id.toLowerCase()}.json`,
  }))
  return {
    reportKind: "bg-manual-beta-feedback-plan",
    createdAt,
    ready: tasks.length >= 10,
    status: tasks.length >= 10 ? "ready" : "missing",
    statusLabel: tasks.length >= 10 ? "真实人工 Beta 反馈模板已就绪" : "真实人工 Beta 任务模板不足",
    summary: {
      totalTasks: tasks.length,
      requiredTasks: tasks.filter((task) => task.id.startsWith("BD-T")).length,
    },
    tasks,
    privacyPolicy: {
      allow: ["taskId", "runId", "status", "severity", "score", "screenshotPaths", "regressionEvidence metadata"],
      deny: ["promptBody", "attachmentBody", "sourceCode", "diffBody", "commandOutput", "stdout", "stderr", "token", "cookie", "privateKey", "secret", "password", "apiKey"],
    },
  }
}

function initManualFeedbackWorkspace(options = {}) {
  const paths = manualFeedbackPaths(options.reportDir)
  const plan = buildManualFeedbackPlan({ createdAt: options.createdAt })
  fs.mkdirSync(paths.feedbackDir, { recursive: true })
  fs.mkdirSync(paths.screenshotDir, { recursive: true })
  const templatePaths = []
  for (const task of plan.tasks) {
    const filePath = path.join(paths.feedbackDir, task.templateFile)
    const template = buildFeedbackTemplate(task, paths.screenshotDir)
    fs.writeFileSync(filePath, `${JSON.stringify(template, null, 2)}\n`, "utf8")
    templatePaths.push(filePath)
  }
  const markdown = buildIndexMarkdown(plan, paths)
  fs.writeFileSync(paths.indexPath, `${markdown}\n`, "utf8")
  return {
    ...paths,
    plan,
    templatePaths,
    markdown,
  }
}

function buildFeedbackTemplate(task, screenshotDir) {
  const screenshotPath = path.join(screenshotDir, `${task.id.toLowerCase()}.png`).replace(/\\/g, "/")
  return {
    feedbackId: `manual-${task.id.toLowerCase()}`,
    taskId: task.id,
    runId: "",
    status: "blocked",
    severity: "P2",
    title: task.title,
    projectKind: "",
    mode: "Agent",
    score: 3,
    manualRunConfirmed: false,
    defectStatus: "open",
    reproductionSteps: "只写复现摘要，不粘贴源码、完整日志、完整 diff 或 prompt 正文。",
    screenshotPaths: [screenshotPath],
    nextAction: "",
    regressionEvidence: {
      runId: "",
      testName: "",
      command: "",
      reportPath: "",
      screenshotPath: "",
    },
  }
}

function buildIndexMarkdown(plan, paths) {
  return [
    "# Codek BG 真实人工 Beta 反馈目录",
    "",
    "这个目录用于真实人工执行 BD-T01 到 BD-T10 后填写反馈。模板不是通过证据；只有把 `manualRunConfirmed` 改为 `true`，并按真实结果填写状态、截图、评分和回归证据后，才算真实人工反馈。",
    "",
    "自动 UI 走查会使用独立的 `agentUiRunConfirmed` 字段，不会替代 `manualRunConfirmed`。",
    "",
    "## 使用命令",
    "",
    "```powershell",
    `node scripts/manual-beta-feedback.js --init --report-dir=${paths.reportDir}`,
    `node scripts/manual-beta-feedback.js --report-dir=${paths.reportDir}`,
    `node scripts/beta-trial-run.js --feedback-dir=${paths.feedbackDir} --report-dir=${paths.reportDir}`,
    "```",
    "",
    "## 任务模板",
    "",
    "| 任务 | 模板 | 预期策略 |",
    "| --- | --- | --- |",
    ...plan.tasks.map((task) => `| ${task.id} ${task.title} | ${task.templateFile} | ${task.expectedStrategy} |`),
    "",
    "## 隐私边界",
    "",
    "- 不要填写 prompt 正文、附件正文、源码正文、完整 diff、完整命令输出、token、cookie、私钥或个人隐私。",
    "- 截图路径可以填写；报告只保存 hash 和长度。",
    "- 回归命令可以填写；报告只保存 hash 和长度。",
  ].join("\n")
}

function validateManualFeedbackWorkspace(options = {}) {
  const paths = manualFeedbackPaths(options.reportDir)
  const feedbackDir = options.feedbackDir || paths.feedbackDir
  const feedbackEntries = betaTrialRun.readFeedbackEntries({ feedbackDir })
  const normalized = betaTrialRun.normalizeFeedbackEntries(feedbackEntries)
  const imported = normalized.imported
  const taskIds = new Set(imported.map((entry) => entry.taskId).filter(Boolean))
  const confirmed = feedbackEntries.filter((entry) => entry && entry.manualRunConfirmed === true)
  const agentUiConfirmed = feedbackEntries.filter((entry) => entry && entry.agentUiRunConfirmed === true)
  const p0 = imported.filter((entry) => entry.severity === "P0").length
  const pendingRegression = imported.filter((entry) =>
    (entry.defectStatus === "fixed" || entry.defectStatus === "verified") && !entry.hasRegressionEvidence
  ).length
  const screenshotCount = imported.reduce((total, entry) => total + entry.screenshotEvidence.length, 0)
  const gaps = []
  if (imported.length < 10) gaps.push(gap("manual_feedback_count", "真实反馈不足 10 条", "按 BD-T01 到 BD-T10 补齐反馈 JSON。"))
  if (taskIds.size < 10) gaps.push(gap("manual_feedback_coverage", "BD 任务覆盖不足", "确认每个 BD-T01 到 BD-T10 都有反馈条目。"))
  if (confirmed.length < 10) gaps.push(gap("manual_feedback_not_real", "反馈仍未确认真实人工执行", "把实际人工执行过的模板 `manualRunConfirmed` 改为 true，并按真实结果填写。"))
  if (screenshotCount < 10) gaps.push(gap("manual_feedback_screenshots", "截图证据不足", "为每个任务填写截图路径，或在反馈摘要中说明无截图原因。", "low"))
  if (p0 > 0) gaps.push(gap("manual_feedback_p0", "真实人工反馈存在 P0", "先修复 P0 并绑定回归证据。", "high"))
  if (pendingRegression > 0) gaps.push(gap("manual_feedback_regression", "已修缺陷缺少回归证据", "为 fixed / verified 缺陷补充 run id、命令、报告或截图证据。", "high"))
  if (normalized.privacyViolations > 0) gaps.push(gap("manual_feedback_privacy", "反馈包含敏感原文字段", "移除 prompt/source/diff/output/token 等字段后重新校验。", "high"))
  const ready = gaps.filter((item) => item.severity !== "low").length === 0
  const report = {
    reportKind: "bg-manual-beta-feedback",
    createdAt: Date.now(),
    ready,
    status: ready ? "ready" : "degraded",
    statusLabel: ready ? "真实人工 Beta 反馈已就绪" : "真实人工 Beta 反馈需补齐",
    feedbackDir,
    screenshotDir: paths.screenshotDir,
    summary: {
      totalFiles: feedbackEntries.length,
      imported: imported.length,
      rejected: normalized.rejected.length,
      privacyViolations: normalized.privacyViolations,
      coveredTasks: taskIds.size,
      confirmed: confirmed.length,
      agentUiConfirmed: agentUiConfirmed.length,
      screenshotCount,
      p0,
      p1: imported.filter((entry) => entry.severity === "P1").length,
      p2: imported.filter((entry) => entry.severity === "P2").length,
      pendingRegression,
    },
    gaps,
    nextActions: gaps.slice(0, 5).map((item) => ({ id: item.id, title: item.title, action: item.action })),
  }
  report.markdown = buildValidationMarkdown(report)
  return report
}

function gap(id, title, action, severity = "medium") {
  return { id, title, severity, action }
}

function buildValidationMarkdown(report) {
  return [
    "# Codek BG 真实人工 Beta 反馈校验",
    "",
    `- 状态：${report.statusLabel}`,
    `- Ready：${report.ready ? "YES" : "NO"}`,
    `- 反馈：${report.summary.imported}/${report.summary.totalFiles} 条，覆盖 ${report.summary.coveredTasks}/10，确认真实人工执行 ${report.summary.confirmed}/10`,
    `- 自动 UI 走查确认：${report.summary.agentUiConfirmed}/10（不等同于真实人工确认）`,
    `- 缺陷：P0 ${report.summary.p0} / P1 ${report.summary.p1} / P2 ${report.summary.p2}，待回归 ${report.summary.pendingRegression}`,
    `- 截图：${report.summary.screenshotCount}`,
    "",
    "## 缺口",
    "",
    ...(report.gaps.length ? report.gaps.map((item) => `- ${item.severity} ${item.title}：${item.action}`) : ["- 暂无阻断缺口。"]),
  ].join("\n")
}

function saveManualFeedbackValidation(report, options = {}) {
  const paths = manualFeedbackPaths(options.reportDir)
  fs.mkdirSync(paths.historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJson = path.join(paths.historyDir, `manual-beta-feedback-${stamp}.json`)
  const historyMd = path.join(paths.historyDir, `manual-beta-feedback-${stamp}.md`)
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${report.markdown}\n`, "utf8")
  fs.writeFileSync(historyJson, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMd, `${report.markdown}\n`, "utf8")
  return { ...paths, historyJson, historyMd }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.init) {
    const saved = initManualFeedbackWorkspace(options)
    process.stdout.write(`${JSON.stringify({
      reportKind: saved.plan.reportKind,
      ready: saved.plan.ready,
      feedbackDir: saved.feedbackDir,
      screenshotDir: saved.screenshotDir,
      templates: saved.templatePaths.length,
      indexPath: saved.indexPath,
    }, null, 2)}\n`)
    return
  }
  const report = validateManualFeedbackWorkspace(options)
  const saved = options.noWrite ? {} : saveManualFeedbackValidation(report, options)
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    gaps: report.gaps.map((item) => item.id),
    jsonPath: saved.latestJsonPath || "",
    markdownPath: saved.latestMarkdownPath || "",
  }, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

if (require.main === module) {
  main()
}

module.exports = {
  buildFeedbackTemplate,
  buildIndexMarkdown,
  buildManualFeedbackPlan,
  initManualFeedbackWorkspace,
  manualFeedbackPaths,
  parseArgs,
  saveManualFeedbackValidation,
  validateManualFeedbackWorkspace,
}
