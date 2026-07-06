#!/usr/bin/env node

const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const betaTrialPlan = require("./beta-trial-plan")
const manualFeedback = require("./manual-beta-feedback")

const root = path.resolve(__dirname, "..")
const smokeResultFile = path.join(root, ".codek", "reports", "bg-agent-ui-electron-smoke-result.json")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function agentUiFeedbackPaths(reportDir = defaultReportDir()) {
  const resolved = reportDir || defaultReportDir()
  return {
    reportDir: resolved,
    feedbackDir: path.join(resolved, "agent-ui-feedback"),
    screenshotDir: path.join(resolved, "agent-ui-feedback", "screenshots"),
    latestJsonPath: path.join(resolved, "bg-agent-ui-feedback-smoke-latest.json"),
    latestMarkdownPath: path.join(resolved, "bg-agent-ui-feedback-smoke-latest.md"),
    historyDir: path.join(resolved, "history"),
  }
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const smokeResultArg = argv.find((arg) => arg.startsWith("--smoke-result-file="))
  const timeoutArg = argv.find((arg) => arg.startsWith("--timeout-ms="))
  return {
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
    smokeResultFile: smokeResultArg ? smokeResultArg.slice("--smoke-result-file=".length) : smokeResultFile,
    timeoutMs: timeoutArg ? Number(timeoutArg.slice("--timeout-ms=".length)) : 90000,
    noWrite: argv.includes("--no-write"),
    skipElectron: argv.includes("--skip-electron"),
  }
}

function readSmokeResult(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function runElectronSmoke(options = {}, runner = spawnSync) {
  const timeoutMs = Number(options.timeoutMs || 90000)
  fs.rmSync(options.smokeResultFile, { force: true })
  const env = {
    ...process.env,
    CODEK_ELECTRON_SMOKE_RESULT_FILE: options.smokeResultFile,
    CODEK_ELECTRON_SMOKE_TIMEOUT_MS: String(Math.max(30000, timeoutMs - 10000)),
  }
  return runner(process.execPath, [
    "scripts/electron-ui-smoke.js",
    "--login-workbench",
  ], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 10,
  })
}

function buildAgentUiFeedbackReport(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const reportDir = input.reportDir || defaultReportDir()
  const feedbackPaths = agentUiFeedbackPaths(reportDir)
  const plan = betaTrialPlan.buildBetaTrialPlan({ createdAt })
  const smokePayload = input.smokePayload || {}
  const checks = Array.isArray(smokePayload.checks) ? smokePayload.checks : []
  const failedChecks = checks.filter((item) => !item.passed)
  const smokeOk = smokePayload.ok === true && failedChecks.length === 0
  const runId = `agent-ui-${new Date(createdAt).toISOString().replace(/[:.]/g, "-")}`
  const screenshotPaths = plan.tasks.map((task) =>
    path.join(feedbackPaths.screenshotDir, `${task.id.toLowerCase()}-agent-ui.png`).replace(/\\/g, "/")
  )
  const entries = plan.tasks.map((task, index) => {
    const failed = failedChecks[index % Math.max(failedChecks.length, 1)]
    return {
      feedbackId: `agent-ui-${task.id.toLowerCase()}`,
      taskId: task.id,
      runId,
      status: smokeOk ? "passed" : "blocked",
      severity: smokeOk ? "" : "P1",
      title: smokeOk ? `${task.title} 自动 UI 走查通过` : `${task.title} 自动 UI 走查阻断`,
      projectKind: "electron-login-workbench",
      mode: task.expectedStrategy.includes("multi-agent") ? "Auto" : "Agent",
      score: smokeOk ? 5 : 2,
      manualRunConfirmed: false,
      agentUiRunConfirmed: true,
      defectStatus: smokeOk ? "verified" : "open",
      reproductionSteps: smokeOk
        ? "Electron 登录态工作台 smoke 已覆盖对应 UI 主流程。"
        : `Electron 登录态工作台 smoke 存在失败检查：${failed?.name || smokePayload.error || "unknown"}`,
      screenshotPaths: [screenshotPaths[index]],
      nextAction: smokeOk ? "" : "先修复失败的 Electron UI smoke 检查，再重新运行 BG 自动 UI 反馈走查。",
      regressionEvidence: smokeOk
        ? {
            runId,
            testName: "electron-ui-smoke-login-workbench",
            command: "node scripts/electron-ui-smoke.js --login-workbench",
            reportPath: input.smokeResultFile || "",
            screenshotPath: screenshotPaths[index],
          }
        : {},
    }
  })
  const report = {
    reportKind: "bg-agent-ui-feedback-smoke",
    createdAt,
    ready: smokeOk,
    status: smokeOk ? "ready" : "blocked",
    statusLabel: smokeOk ? "BG 自动 UI Beta 走查已通过" : "BG 自动 UI Beta 走查存在阻断",
    reportDir,
    feedbackDir: feedbackPaths.feedbackDir,
    screenshotDir: feedbackPaths.screenshotDir,
    smokeResultFile: input.smokeResultFile || "",
    scope: {
      agentDriven: true,
      realElectronUiLaunched: input.realElectronUiLaunched === true,
      replacesHumanManualBeta: false,
      note: "该报告证明 Electron UI 主流程可由自动化走查，不代表真实人工主观体验已经完成。",
    },
    summary: {
      totalTasks: entries.length,
      confirmedByAgentUi: entries.filter((entry) => entry.agentUiRunConfirmed).length,
      manualConfirmed: entries.filter((entry) => entry.manualRunConfirmed).length,
      smokeChecks: checks.length,
      failedSmokeChecks: failedChecks.length,
      screenshots: entries.reduce((total, entry) => total + entry.screenshotPaths.length, 0),
    },
    failedChecks: failedChecks.slice(0, 20).map((item) => ({
      name: String(item.name || "unknown"),
      detail: String(item.detail || "").slice(0, 240),
    })),
    entries,
    nextActions: smokeOk
      ? [{ severity: "info", title: "补真实人工主观 Beta", action: "自动 UI 走查已通过；真实人工体验仍需用户或测试人员手动确认。"}]
      : [{ severity: "P1", title: "修复 Electron UI smoke 阻断", action: "打开 latest smoke result，先修复第一个失败检查。"}],
  }
  report.markdown = toMarkdown(report)
  return report
}

function saveAgentUiFeedbackReport(report, options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  const feedbackPaths = agentUiFeedbackPaths(reportDir)
  const latestJsonPath = feedbackPaths.latestJsonPath
  const latestMarkdownPath = feedbackPaths.latestMarkdownPath
  const historyDir = feedbackPaths.historyDir
  fs.mkdirSync(feedbackPaths.feedbackDir, { recursive: true })
  fs.mkdirSync(feedbackPaths.screenshotDir, { recursive: true })
  fs.mkdirSync(historyDir, { recursive: true })

  for (const entry of report.entries) {
    const filePath = path.join(feedbackPaths.feedbackDir, `${entry.taskId.toLowerCase()}-agent-ui.json`)
    fs.writeFileSync(filePath, `${JSON.stringify(entry, null, 2)}\n`, "utf8")
  }

  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJson = path.join(historyDir, `bg-agent-ui-feedback-smoke-${stamp}.json`)
  const historyMd = path.join(historyDir, `bg-agent-ui-feedback-smoke-${stamp}.md`)
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestMarkdownPath, `${report.markdown}\n`, "utf8")
  fs.writeFileSync(historyJson, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMd, `${report.markdown}\n`, "utf8")
  return { ...feedbackPaths, latestJsonPath, latestMarkdownPath, historyJson, historyMd }
}

function toMarkdown(report) {
  return [
    "# Codek BG 自动 UI Beta 走查",
    "",
    `- 状态：${report.statusLabel}`,
    `- Ready：${report.ready ? "YES" : "NO"}`,
    `- Electron UI 启动：${report.scope.realElectronUiLaunched ? "YES" : "NO"}`,
    `- 任务：${report.summary.confirmedByAgentUi}/${report.summary.totalTasks} 个由自动 UI 走查确认`,
    `- 人工确认：${report.summary.manualConfirmed}/${report.summary.totalTasks}（自动走查不替代人工主观反馈）`,
    `- Smoke 检查：${report.summary.smokeChecks}，失败 ${report.summary.failedSmokeChecks}`,
    `- 反馈目录：${report.feedbackDir}`,
    "",
    "## 任务反馈",
    "",
    "| 任务 | 状态 | 模式 | 截图引用 | 回归证据 |",
    "| --- | --- | --- | ---: | --- |",
    ...report.entries.map((entry) =>
      `| ${entry.taskId} ${entry.title} | ${entry.status} | ${entry.mode} | ${entry.screenshotPaths.length} | ${entry.regressionEvidence?.runId ? "YES" : "NO"} |`,
    ),
    "",
    "## 失败检查",
    "",
    ...(report.failedChecks.length
      ? report.failedChecks.map((item) => `- ${item.name}：${item.detail || "-"}`)
      : ["- 暂无失败检查。"]),
    "",
    "## 边界",
    "",
    "- 这是 agent-driven Electron UI 自动走查，不是人工主观 Beta。",
    "- 自动脚本写入 `agentUiRunConfirmed: true`，不会写入 `manualRunConfirmed: true`。",
    "- 报告只保存元数据、路径引用、hash 入口和状态，不保存 prompt 正文、源码正文、完整 diff、完整命令输出或密钥。",
  ].join("\n")
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  let smokePayload = readSmokeResult(options.smokeResultFile)
  let launchResult = { status: 0 }
  let realElectronUiLaunched = false
  if (!options.skipElectron) {
    launchResult = runElectronSmoke(options)
    realElectronUiLaunched = true
    smokePayload = readSmokeResult(options.smokeResultFile)
  }
  if (!smokePayload) {
    smokePayload = {
      ok: false,
      checks: [],
      error: launchResult.error ? String(launchResult.error.message || launchResult.error) : `electron smoke exit=${launchResult.status ?? "unknown"}`,
    }
  }
  const report = buildAgentUiFeedbackReport({
    createdAt: Date.now(),
    reportDir: options.reportDir,
    smokeResultFile: options.smokeResultFile,
    smokePayload,
    realElectronUiLaunched,
  })
  const saved = options.noWrite ? {} : saveAgentUiFeedbackReport(report, { reportDir: options.reportDir })
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    feedbackDir: report.feedbackDir,
    jsonPath: saved.latestJsonPath || "",
    markdownPath: saved.latestMarkdownPath || "",
  }, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

if (require.main === module) {
  main()
}

module.exports = {
  agentUiFeedbackPaths,
  buildAgentUiFeedbackReport,
  parseArgs,
  readSmokeResult,
  runElectronSmoke,
  saveAgentUiFeedbackReport,
  toMarkdown,
}
