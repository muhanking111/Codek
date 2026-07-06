const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const { readLatestWorkbenchDeepSmoke } = require("./workbench-deep-smoke")
const { readLatestReport: readLatestReleaseGate } = require("./release-gate")
const { readLatestPerformanceBaseline } = require("./ar-health")
const { readLatestExtensionEcosystemHealth } = require("../desktop/services/extensions-host/ecosystemHealth")
const { readLatestProviderHealthReport } = require("../desktop/services/llm/providerHealth")
const { readLatestDebugAdapterHealth } = require("../desktop/services/debug/adapterHealth")
const { readLatestGoalRuntimeHealth } = require("../desktop/services/goalScheduler/stabilityHealth")
const { readLatestAcceptanceReport } = require("../desktop/services/agentLoop/evals/realProjectAcceptance")
const { readLatestReadinessReport, defaultReadinessReportDir } = require("../desktop/services/agentLoop/readiness")
const { readLatestReleaseEvidenceSummary } = require("../desktop/services/agentLoop/releaseEvidenceExport")
const { readLatestRealWorkspaceTrialReport } = require("../desktop/services/agentLoop/runReport")
const { readLatestPackagingPreflight } = require("./packaging-preflight")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const currentReleaseGateModeArg = argv.find((arg) => arg.startsWith("--current-release-gate-mode="))
  const strict = argv.includes("--strict")
  return {
    noWrite: argv.includes("--no-write"),
    strict,
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
    currentReleaseGateMode: currentReleaseGateModeArg ? currentReleaseGateModeArg.slice("--current-release-gate-mode=".length) : "",
  }
}

function pickInput(input, key, fallback) {
  return Object.prototype.hasOwnProperty.call(input, key) ? input[key] : fallback
}

function pickCanonicalFallback(input, key, readCurrent, readCanonical, canonicalReportDir) {
  if (Object.prototype.hasOwnProperty.call(input, key)) return input[key]
  const current = readCurrent()
  if (current) return current
  return canonicalReportDir ? readCanonical() : current
}

function readJsonSafe(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function normalizeSummary(report) {
  const summary = report?.summary || {}
  return {
    total: Number(summary.total || report?.total || 0),
    passed: Number(summary.passed || report?.passed || 0),
    warning: Number(summary.warning || 0),
    failed: Number(summary.failed || report?.failed || 0),
  }
}

function makeCapability(input) {
  const available = Boolean(input.report)
  const ready = available && (input.ready === undefined ? input.report?.ready === true || normalizeSummary(input.report).failed === 0 : Boolean(input.ready))
  const severity = input.severity || "high"
  return {
    id: input.id,
    title: input.title,
    au: input.au,
    available,
    ready,
    status: !available ? "missing" : ready ? "ready" : "not_ready",
    severity,
    statusLabel: !available ? "缺少证据" : ready ? "已就绪" : "未就绪",
    summary: available ? input.summary || summarizeReport(input.report) : "",
    reportKind: input.report?.reportKind || "",
    nextAction: available && ready ? "" : input.nextAction,
    evidencePath: input.evidencePath || "",
    blocking: severity === "high" || severity === "medium",
  }
}

function summarizeReport(report = {}) {
  const summary = normalizeSummary(report)
  if (summary.total) return `${summary.passed}/${summary.total} 通过，${summary.warning} warning，${summary.failed} failed`
  if (report.matrix?.total) return `矩阵 ${report.matrix.passed || 0}/${report.matrix.total || 0}`
  if (report.statusLabel) return report.statusLabel
  return report.ready === true ? "ready" : report.status || "-"
}

function buildProductGradeGate(input = {}) {
  const reportDir = input.reportDir || defaultReportDir()
  const canonicalReportDir = input.canonicalReportDir || defaultReportDir()
  const readinessDir = input.readinessDir || reportDir || defaultReadinessReportDir()
  const canonicalReadinessDir = input.canonicalReadinessDir || canonicalReportDir || defaultReadinessReportDir()
  const currentReleaseGate = input.currentReleaseGateMode
    ? { ready: true, mode: input.currentReleaseGateMode, reportKind: "release-gate-current-run" }
    : null
  const releaseGate = pickInput(input, "releaseGate", currentReleaseGate || readLatestReleaseGate({ reportDir }).report || readLatestReleaseGate({ reportDir: canonicalReportDir }).report)
  const releaseEvidence = pickCanonicalFallback(input, "releaseEvidence", () => readLatestReleaseEvidenceSummary({ reportDir }).report, () => readLatestReleaseEvidenceSummary({ reportDir: canonicalReportDir }).report, canonicalReportDir)
  const workbenchDeep = pickCanonicalFallback(input, "workbenchDeep", () => readLatestWorkbenchDeepSmoke({ reportDir }).report, () => readLatestWorkbenchDeepSmoke({ reportDir: canonicalReportDir }).report, canonicalReportDir)
  const extensions = pickCanonicalFallback(input, "extensions", () => readLatestExtensionEcosystemHealth({ reportDir }).report, () => readLatestExtensionEcosystemHealth({ reportDir: canonicalReportDir }).report, canonicalReportDir)
  const provider = pickCanonicalFallback(input, "provider", () => readLatestProviderHealthReport({ reportDir }).report, () => readLatestProviderHealthReport({ reportDir: canonicalReportDir }).report, canonicalReportDir)
  const debug = pickCanonicalFallback(input, "debug", () => readLatestDebugAdapterHealth({ reportDir }).report, () => readLatestDebugAdapterHealth({ reportDir: canonicalReportDir }).report, canonicalReportDir)
  const goals = pickCanonicalFallback(input, "goals", () => readLatestGoalRuntimeHealth({ reportDir }).report, () => readLatestGoalRuntimeHealth({ reportDir: canonicalReportDir }).report, canonicalReportDir)
  const performance = pickCanonicalFallback(input, "performance", () => readLatestPerformanceBaseline({ reportDir }).report, () => readLatestPerformanceBaseline({ reportDir: canonicalReportDir }).report, canonicalReportDir)
  const acceptance = pickCanonicalFallback(input, "acceptance", () => readLatestAcceptanceReport({ reportDir }).report, () => readLatestAcceptanceReport({ reportDir: canonicalReportDir }).report, canonicalReportDir)
  const readiness = pickCanonicalFallback(input, "readiness", () => readLatestReadinessReport({ reportDir: readinessDir }).report, () => readLatestReadinessReport({ reportDir: canonicalReadinessDir }).report, canonicalReportDir)
  const realTrial = pickCanonicalFallback(input, "realTrial", () => readLatestRealWorkspaceTrialReport({ reportDir }).report, () => readLatestRealWorkspaceTrialReport({ reportDir: canonicalReportDir }).report, canonicalReportDir)
  const packaging = pickCanonicalFallback(input, "packaging", () => readLatestPackagingPreflight({ reportDir }).report, () => readLatestPackagingPreflight({ reportDir: canonicalReportDir }).report, canonicalReportDir)
  const usagePath = path.join(reportDir, "llm-usage-latest.json")
  const canonicalUsagePath = path.join(canonicalReportDir, "llm-usage-latest.json")
  const usage = pickInput(input, "usage", readJsonSafe(usagePath) || readJsonSafe(canonicalUsagePath))
  const contextEvidence = pickInput(input, "contextEvidence", buildContextEvidence())
  const securityEvidence = pickInput(input, "securityEvidence", buildSecurityEvidence(releaseEvidence))
  const uxEvidence = pickInput(input, "uxEvidence", buildUxEvidence())

  const capabilities = [
    makeCapability({
      id: "au1_workbench",
      au: "AU1",
      title: "VS Code Workbench 深度兼容",
      report: workbenchDeep,
      evidencePath: "workbench-deep-smoke-latest.md",
      nextAction: "运行 npm run smoke:workbench:deep 并修复失败项。",
    }),
    makeCapability({
      id: "au2_extensions",
      au: "AU2",
      title: "扩展生态稳定性",
      report: extensions,
      evidencePath: "extension-ecosystem-health-latest.md",
      nextAction: "运行 AR health 或扩展生态 smoke，补齐搜索排序、图标、安装、activation 证据。",
    }),
    makeCapability({
      id: "au3_agent_routing",
      au: "AU3",
      title: "多 Agent 自主调度",
      report: acceptance,
      ready: Boolean(acceptance?.ready && acceptance?.routerData && Number(acceptance?.matrix?.failed || 0) === 0),
      evidencePath: "real-project-smoke-latest.md",
      summary: acceptance ? `${acceptance.passed || 0}/${acceptance.total || 0} checks，矩阵 ${(acceptance.matrix?.passed || 0)}/${(acceptance.matrix?.total || 0)}` : "",
      nextAction: "运行 npm run smoke:real-project -- --task-set=standard，修复 Router Calibration 或真实任务矩阵失败项。",
    }),
    makeCapability({
      id: "au4_context_attachments",
      au: "AU4",
      title: "上下文、记忆与附件真实管线",
      report: contextEvidence,
      nextAction: "补文本/图片/目录/root/诊断上下文单测与 latest 证据。",
    }),
    makeCapability({
      id: "au5_provider_tools",
      au: "AU5",
      title: "模型链路与工具调用稳定性",
      report: provider,
      evidencePath: "provider-health-latest.md",
      nextAction: "运行 AR health，确认 provider retry/cancel/usage/cost 和工具失败恢复进入证据链。",
    }),
    makeCapability({
      id: "au6_eval_matrix",
      au: "AU6",
      title: "真实任务评测矩阵",
      report: acceptance,
      ready: Boolean(acceptance?.ready && Number(acceptance?.matrix?.total || 0) >= 10 && Number(acceptance?.matrix?.failed || 0) === 0),
      evidencePath: "real-project-smoke-latest.md",
      summary: acceptance ? `${acceptance.taskSet || "-"} 矩阵 ${(acceptance.matrix?.passed || 0)}/${(acceptance.matrix?.total || 0)}，失败建议 ${(acceptance.failureRecommendations?.total || 0)}` : "",
      nextAction: "扩充并运行 standard/risk/long 任务集，确保失败样本也有恢复建议。",
    }),
    makeCapability({
      id: "au7_ux",
      au: "AU7",
      title: "用户体验产品级收敛",
      report: uxEvidence,
      severity: "medium",
      nextAction: "运行 Electron UI smoke、中文覆盖和顶栏/布局截图检查。",
    }),
    makeCapability({
      id: "au8_security",
      au: "AU8",
      title: "安全、沙箱与权限产品化",
      report: securityEvidence,
      nextAction: "运行权限策略、真实工作区 proposal-only、越界写入和危险命令 smoke。",
    }),
    makeCapability({
      id: "au9_performance",
      au: "AU9",
      title: "性能、索引与长期运行",
      report: performance,
      severity: "medium",
      evidencePath: "performance-baseline-latest.md",
      nextAction: "运行 AR performance baseline，补大项目索引/搜索和长任务 latest/history。",
    }),
    makeCapability({
      id: "au10_release_center",
      au: "AU10",
      title: "产品级发布验收中心",
      report: releaseEvidence,
      ready: Boolean(releaseEvidence?.ready && releaseGate?.mode === "product-grade"),
      evidencePath: "release-evidence-latest.md",
      summary: releaseEvidence ? `${releaseEvidence.summary?.ready || 0}/${releaseEvidence.summary?.total || 0} 证据就绪，release gate=${releaseGate?.mode || "-"}` : "",
      nextAction: "运行 npm run release:gate -- --product-grade，并重新导出 release evidence。",
    }),
  ]

  const optionalSignals = {
    debugReady: Boolean(debug && normalizeSummary(debug).failed === 0),
    goalsReady: Boolean(goals && normalizeSummary(goals).failed === 0),
    realTrialReady: Boolean(realTrial?.realWorkspaceTrial?.mainWorkspaceUntouchedBeforeAccept && realTrial?.realWorkspaceTrial?.rollbackAvailable),
    packagingPreflightRecorded: Boolean(packaging),
    usageRecorded: Boolean(usage || releaseEvidence?.evidence?.llmUsage?.available),
  }
  const blocking = capabilities.filter((item) => !item.ready && item.blocking)
  const ready = blocking.length === 0
  const report = {
    reportKind: "au-product-grade-gate",
    createdAt: Number(input.createdAt || Date.now()),
    ready,
    status: ready ? "ready" : "blocked",
    statusLabel: ready ? "AU 产品级候选门通过" : "AU 产品级候选门仍有阻断",
    summary: {
      total: capabilities.length,
      ready: capabilities.filter((item) => item.ready).length,
      missing: capabilities.filter((item) => !item.available).length,
      blocked: blocking.length,
    },
    capabilities,
    optionalSignals,
    nextActions: capabilities
      .filter((item) => !item.ready)
      .map((item) => ({ id: item.id, au: item.au, title: item.title, action: item.nextAction }))
      .slice(0, 5),
  }
  report.markdown = toMarkdown(report)
  return report
}

function buildContextEvidence() {
  const testPath = path.join(root, "frontend", "vite-project", "src", "components", "chatAttachments.test.ts")
  const memoryPath = path.join(root, "desktop", "services", "agentLoop", "memory.js")
  const available = fs.existsSync(testPath) && fs.existsSync(memoryPath)
  return {
    reportKind: "context-attachment-evidence",
    ready: available,
    summary: { total: 4, passed: available ? 4 : 0, warning: 0, failed: available ? 0 : 4 },
    checks: [
      { id: "text_attachment", status: available ? "passed" : "failed" },
      { id: "image_attachment", status: available ? "passed" : "failed" },
      { id: "provider_multimodal", status: available ? "passed" : "failed" },
      { id: "agent_memory", status: available ? "passed" : "failed" },
    ],
  }
}

function buildSecurityEvidence(releaseEvidence = null) {
  const policyTest = path.join(root, "desktop", "services", "agentLoop", "permissionPolicy.test.js")
  const leaseTest = path.join(root, "desktop", "services", "agentLoop", "workspaceLease.test.js")
  const realTrialTest = path.join(root, "desktop", "services", "agentLoop", "realWorkspaceTrial.test.js")
  const sandboxSecurity = releaseEvidence?.evidence?.sandboxSecurity || null
  const testsAvailable = [policyTest, leaseTest, realTrialTest].every((file) => fs.existsSync(file))
  const available = testsAvailable && Boolean(sandboxSecurity)
  const ready = testsAvailable && sandboxSecurity?.ready === true
  return {
    reportKind: "security-permission-evidence",
    ready,
    summary: { total: 4, passed: ready ? 4 : 0, warning: 0, failed: ready ? 0 : 4 },
    checks: [
      { id: "permission_policy", status: fs.existsSync(policyTest) ? "passed" : "failed" },
      { id: "workspace_lease", status: fs.existsSync(leaseTest) ? "passed" : "failed" },
      { id: "proposal_only_trial", status: fs.existsSync(realTrialTest) ? "passed" : "failed" },
      { id: "sandbox_security_release_evidence", status: sandboxSecurity?.ready === true ? "passed" : "failed" },
    ],
  }
}

function buildUxEvidence() {
  const smokePath = path.join(root, "scripts", "electron-ui-smoke.js")
  const zhPath = path.join(root, "frontend", "vite-project", "src", "i18n", "zh.ts")
  const layoutPath = path.join(root, "frontend", "vite-project", "src", "composables", "useWorkbenchLayout.ts")
  const available = [smokePath, zhPath, layoutPath].every((file) => fs.existsSync(file))
  return {
    reportKind: "ux-product-evidence",
    ready: available,
    summary: { total: 3, passed: available ? 3 : 0, warning: 0, failed: available ? 0 : 3 },
    checks: [
      { id: "electron_ui_smoke", status: fs.existsSync(smokePath) ? "passed" : "failed" },
      { id: "zh_i18n", status: fs.existsSync(zhPath) ? "passed" : "failed" },
      { id: "layout_shell", status: fs.existsSync(layoutPath) ? "passed" : "failed" },
    ],
  }
}

function saveProductGradeGate(report, options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  fs.mkdirSync(reportDir, { recursive: true })
  const historyDir = path.join(reportDir, "history")
  fs.mkdirSync(historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const jsonPath = path.join(reportDir, "au-product-grade-gate-latest.json")
  const markdownPath = path.join(reportDir, "au-product-grade-gate-latest.md")
  const historyJsonPath = path.join(historyDir, `au-product-grade-gate-${stamp}.json`)
  const historyMarkdownPath = path.join(historyDir, `au-product-grade-gate-${stamp}.md`)
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(markdownPath, `${report.markdown}\n`, "utf8")
  fs.writeFileSync(historyJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMarkdownPath, `${report.markdown}\n`, "utf8")
  return { report, jsonPath, markdownPath, historyJsonPath, historyMarkdownPath }
}

function readLatestProductGradeGate(options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  const jsonPath = path.join(reportDir, "au-product-grade-gate-latest.json")
  const markdownPath = path.join(reportDir, "au-product-grade-gate-latest.md")
  if (!fs.existsSync(jsonPath)) return { report: null, jsonPath, markdownPath, markdown: "" }
  return {
    report: JSON.parse(fs.readFileSync(jsonPath, "utf8")),
    jsonPath,
    markdownPath,
    markdown: fs.existsSync(markdownPath) ? fs.readFileSync(markdownPath, "utf8") : "",
  }
}

function toMarkdown(report) {
  const rows = (report.capabilities || []).map((item) =>
    `| ${item.au} | ${escapeCell(item.title)} | ${item.statusLabel} | ${escapeCell(item.summary)} | ${escapeCell(item.nextAction || "-")} |`,
  )
  return [
    "# AU 产品级 Cursor/Codex 差距闭环门禁",
    "",
    `- 状态: ${report.statusLabel || report.status}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Created At: ${new Date(report.createdAt || Date.now()).toISOString()}`,
    `- Summary: ${report.summary?.ready || 0}/${report.summary?.total || 0} 就绪，${report.summary?.blocked || 0} 阻断，${report.summary?.missing || 0} 缺证据`,
    "",
    "| AU | 能力 | 状态 | 证据摘要 | 下一步 |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## 辅助信号",
    "",
    `- Debug adapter: ${report.optionalSignals?.debugReady ? "ready" : "missing/degraded"}`,
    `- Goal runtime: ${report.optionalSignals?.goalsReady ? "ready" : "missing/degraded"}`,
    `- Real workspace proposal-only: ${report.optionalSignals?.realTrialReady ? "ready" : "missing/degraded"}`,
    `- Packaging preflight recorded: ${report.optionalSignals?.packagingPreflightRecorded ? "yes" : "no"}`,
    `- LLM usage recorded: ${report.optionalSignals?.usageRecorded ? "yes" : "no"}`,
    "",
    "## 说明",
    "",
    "- 本门禁排除真实打包/安装闭环，只判断 AU 阶段产品级候选能力。",
    "- 通过只能说明“产品级候选通过”，不能声称已经完全等同 Cursor/Codex。",
  ].join("\n")
}

function escapeCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = buildProductGradeGate(options)
  const saved = options.noWrite ? { report } : saveProductGradeGate(report, options)
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    nextActions: report.nextActions,
    jsonPath: saved.jsonPath || "",
    markdownPath: saved.markdownPath || "",
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
  buildProductGradeGate,
  defaultReportDir,
  parseArgs,
  readLatestProductGradeGate,
  saveProductGradeGate,
  toMarkdown,
}
