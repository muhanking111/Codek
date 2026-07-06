const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const { buildProviderHealthReport, saveProviderHealthReport } = require("../desktop/services/llm/providerHealth")
const { getConfig } = require("../desktop/services/llm/config")
const { buildDebugAdapterHealth, saveDebugAdapterHealth } = require("../desktop/services/debug/adapterHealth")
const { buildExtensionEcosystemHealth, saveExtensionEcosystemHealth } = require("../desktop/services/extensions-host/ecosystemHealth")
const { saveExtensionCompatibilityReport } = require("../desktop/services/extensions-host/extensionCompatibility")
const { getInstalledExtensions, readActivationReport, buildInstalledCompatibilityReport } = require("../desktop/services/extensions-host/extensionManager")
const { buildGoalRuntimeHealth, saveGoalRuntimeHealth } = require("../desktop/services/goalScheduler/stabilityHealth")
const goalStore = require("../desktop/services/goalStore")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function defaultFrontendDistDir() {
  return path.join(root, "frontend", "vite-project", "dist")
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function collectBuildStatsFromDist(distDir = defaultFrontendDistDir()) {
  const assetsDir = path.join(distDir, "assets")
  if (!fs.existsSync(assetsDir)) return { chunks: [], source: assetsDir, missing: true }
  const chunks = fs.readdirSync(assetsDir)
    .filter((name) => /\.js$/i.test(name))
    .map((name) => {
      const filePath = path.join(assetsDir, name)
      const stat = fs.statSync(filePath)
      return { name, sizeKb: Number((stat.size / 1024).toFixed(2)), filePath }
    })
    .sort((a, b) => Number(b.sizeKb || 0) - Number(a.sizeKb || 0))
  return { chunks, source: assetsDir, missing: false }
}

function buildPerformanceBaseline(input = {}) {
  const buildStats = input.buildStats || collectBuildStatsFromDist(input.distDir)
  const strict = input.strict === true
  const budgets = {
    mainChunkKb: Number(input.mainChunkKb || 350),
    lazyChunkKb: Number(input.lazyChunkKb || 4300),
    workerChunkKb: Number(input.workerChunkKb || 6500),
  }
  const chunks = Array.isArray(buildStats.chunks) ? buildStats.chunks : []
  const main = chunks.find((chunk) => /index|main/i.test(chunk.name || "")) || chunks[0] || null
  const workerChunks = chunks.filter((chunk) => /\.worker-/i.test(chunk.name || "") || /\.worker\.js$/i.test(chunk.name || ""))
  const appChunks = chunks.filter((chunk) => !workerChunks.includes(chunk))
  const largest = appChunks.slice().sort((a, b) => Number(b.sizeKb || 0) - Number(a.sizeKb || 0))[0] || null
  const largestWorker = workerChunks.slice().sort((a, b) => Number(b.sizeKb || 0) - Number(a.sizeKb || 0))[0] || null
  const mainOverBudget = main && Number(main.sizeKb || 0) > budgets.mainChunkKb
  const largestOverBudget = largest && Number(largest.sizeKb || 0) > budgets.lazyChunkKb
  const workerOverBudget = largestWorker && Number(largestWorker.sizeKb || 0) > budgets.workerChunkKb

  const checks = [
    {
      id: "main_chunk_budget",
      title: "首屏 chunk 预算",
      status: mainOverBudget && strict ? "failed" : mainOverBudget ? "warning" : "passed",
      detail: main ? `主入口 ${Number(main.sizeKb || 0)}KB，预算 ${budgets.mainChunkKb}KB。` : "暂无 chunk 样本，使用静态预算兜底。",
      nextAction: "继续保持 Monaco、analysis 和扩展面板懒加载。",
      warningCategory: mainOverBudget ? "budget" : "",
    },
    {
      id: "largest_chunk_budget",
      title: "最大业务 lazy chunk 预算",
      status: largestOverBudget && strict ? "failed" : largestOverBudget ? "warning" : "passed",
      detail: largest ? `最大业务 chunk ${largest.name || "-"} ${Number(largest.sizeKb || 0)}KB，预算 ${budgets.lazyChunkKb}KB。` : "暂无业务 lazy chunk 样本。",
      nextAction: "Vite chunk 警告必须进入预算记录，避免业务代码无边界增长。",
      warningCategory: largestOverBudget ? "budget" : "",
    },
    {
      id: "worker_chunk_budget",
      title: "Monaco worker chunk 预算",
      status: workerOverBudget && strict ? "failed" : workerOverBudget ? "warning" : "passed",
      detail: largestWorker ? `最大 worker ${largestWorker.name || "-"} ${Number(largestWorker.sizeKb || 0)}KB，预算 ${budgets.workerChunkKb}KB。` : "暂无 worker chunk 样本。",
      nextAction: "Monaco/TypeScript worker 单独记录预算，不与业务 lazy chunk 混算。",
      warningCategory: workerOverBudget ? "budget" : "",
    },
  ]
  const summary = summarizeChecks(checks)
  const status = summary.failed > 0 ? "blocked" : summary.warning > 0 ? "degraded" : "ready"
  return {
    reportKind: "performance-baseline",
    createdAt: Number(input.createdAt || Date.now()),
    status,
    statusLabel: status === "ready" ? "性能基线达标" : status === "degraded" ? "性能基线需关注" : "性能基线阻断",
    ready: status === "ready",
    summary,
    checks,
    budgets,
    budgetPolicy: { strict, blocking: { quick: false, full: false, strict: true } },
    chunkEvidence: {
      mainChunk: main ? withBudgetEvidence(main, budgets.mainChunkKb) : null,
      largestChunk: largest ? withBudgetEvidence(largest, budgets.lazyChunkKb) : null,
      largestWorkerChunk: largestWorker ? withBudgetEvidence(largestWorker, budgets.workerChunkKb) : null,
    },
    warningPolicy: checks
      .filter((check) => check.status === "warning" || check.status === "failed")
      .map((check) => ({
        id: check.id,
        category: check.warningCategory || "budget",
        severity: check.status === "failed" ? "high" : "warning",
        blocking: { quick: false, full: false, strict: true },
        nextAction: check.nextAction,
      })),
    buildStatsSource: buildStats.source || "",
    buildStatsMissing: buildStats.missing === true,
  }
}

function summarizeChecks(checks) {
  return {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    warning: checks.filter((check) => check.status === "warning").length,
    failed: checks.filter((check) => check.status === "failed").length,
  }
}

function buildPerformanceBaselineProductGrade(input = {}) {
  const buildStats = input.buildStats || collectBuildStatsFromDist(input.distDir)
  const strict = input.strict === true
  const budgets = {
    mainChunkKb: Number(input.mainChunkKb || 350),
    lazyChunkKb: Number(input.lazyChunkKb || 1500),
    monacoChunkKb: Number(input.monacoChunkKb || 4300),
    analysisChunkKb: Number(input.analysisChunkKb || 1200),
    typescriptCompilerChunkKb: Number(input.typescriptCompilerChunkKb || 4300),
    workerChunkKb: Number(input.workerChunkKb || 6500),
  }
  const chunks = Array.isArray(buildStats.chunks) ? buildStats.chunks : []
  const main = chunks.find((chunk) => /index|main/i.test(chunk.name || "")) || chunks[0] || null
  const workerChunks = chunks.filter((chunk) => isWorkerChunk(chunk.name))
  const monacoChunks = chunks.filter((chunk) => isMonacoChunk(chunk.name))
  const analysisChunks = chunks.filter((chunk) => isAnalysisChunk(chunk.name))
  const typescriptCompilerChunks = chunks.filter((chunk) => isTypeScriptCompilerChunk(chunk.name))
  const specialChunks = new Set([...workerChunks, ...monacoChunks, ...analysisChunks, ...typescriptCompilerChunks])
  const businessChunks = chunks.filter((chunk) => !specialChunks.has(chunk))
  const largestBusiness = largestBySize(businessChunks)
  const largestMonaco = largestBySize(monacoChunks)
  const largestAnalysis = largestBySize(analysisChunks)
  const largestTypeScriptCompiler = largestBySize(typescriptCompilerChunks)
  const largestWorker = largestBySize(workerChunks)
  const checks = [
    budgetCheck({
      id: "main_chunk_budget",
      title: "首屏 chunk 预算",
      chunk: main,
      budgetKb: budgets.mainChunkKb,
      strict,
      detailPrefix: "主入口",
      nextAction: "继续保持 Monaco、analysis、终端和扩展面板按需加载。",
    }),
    budgetCheck({
      id: "largest_business_chunk_budget",
      title: "最大业务 lazy chunk 预算",
      chunk: largestBusiness,
      budgetKb: budgets.lazyChunkKb,
      strict,
      detailPrefix: "最大业务 chunk",
      nextAction: "继续拆分设置、聊天、扩展、Git 等业务面板，避免普通业务代码无边界增长。",
    }),
    budgetCheck({
      id: "monaco_chunk_budget",
      title: "Monaco 主包预算",
      chunk: largestMonaco,
      budgetKb: budgets.monacoChunkKb,
      strict,
      detailPrefix: "最大 Monaco chunk",
      nextAction: "Monaco 是 IDE 核心依赖，必须单独记录预算；若持续增长，再拆语言默认值和编辑器贡献。",
    }),
    budgetCheck({
      id: "analysis_chunk_budget",
      title: "工作区 analysis chunk 预算",
      chunk: largestAnalysis,
      budgetKb: budgets.analysisChunkKb,
      strict,
      detailPrefix: "最大 analysis chunk",
      nextAction: "analysis 不应静态包含 TypeScript 编译器；超预算时优先检查动态导入和索引器拆分。",
    }),
    budgetCheck({
      id: "typescript_compiler_chunk_budget",
      title: "TypeScript 编译器 lazy chunk 预算",
      chunk: largestTypeScriptCompiler,
      budgetKb: budgets.typescriptCompilerChunkKb,
      strict,
      detailPrefix: "TypeScript 编译器 chunk",
      nextAction: "TypeScript 编译器允许作为按需加载的 IDE 依赖存在，但不能重新并入首屏或普通业务 chunk。",
    }),
    budgetCheck({
      id: "worker_chunk_budget",
      title: "Monaco worker chunk 预算",
      chunk: largestWorker,
      budgetKb: budgets.workerChunkKb,
      strict,
      detailPrefix: "最大 worker",
      nextAction: "Monaco/TypeScript worker 单独记录预算，不与业务 lazy chunk 混算。",
    }),
  ]
  const summary = summarizeChecks(checks)
  const status = summary.failed > 0 ? "blocked" : summary.warning > 0 ? "degraded" : "ready"
  return {
    reportKind: "performance-baseline",
    createdAt: Number(input.createdAt || Date.now()),
    status,
    statusLabel: status === "ready" ? "性能基线达标" : status === "degraded" ? "性能基线需关注" : "性能基线阻断",
    ready: status === "ready",
    summary,
    checks,
    budgets,
    budgetPolicy: { strict, blocking: { quick: false, full: false, strict: true } },
    chunkEvidence: {
      mainChunk: main ? withBudgetEvidence(main, budgets.mainChunkKb) : null,
      largestChunk: largestBusiness ? withBudgetEvidence(largestBusiness, budgets.lazyChunkKb) : null,
      largestBusinessChunk: largestBusiness ? withBudgetEvidence(largestBusiness, budgets.lazyChunkKb) : null,
      largestMonacoChunk: largestMonaco ? withBudgetEvidence(largestMonaco, budgets.monacoChunkKb) : null,
      largestAnalysisChunk: largestAnalysis ? withBudgetEvidence(largestAnalysis, budgets.analysisChunkKb) : null,
      largestTypeScriptCompilerChunk: largestTypeScriptCompiler ? withBudgetEvidence(largestTypeScriptCompiler, budgets.typescriptCompilerChunkKb) : null,
      largestWorkerChunk: largestWorker ? withBudgetEvidence(largestWorker, budgets.workerChunkKb) : null,
    },
    warningPolicy: checks
      .filter((check) => check.status === "warning" || check.status === "failed")
      .map((check) => ({
        id: check.id,
        category: check.warningCategory || "budget",
        severity: check.status === "failed" ? "high" : "warning",
        blocking: { quick: false, full: false, strict: true },
        nextAction: check.nextAction,
      })),
    buildStatsSource: buildStats.source || "",
    buildStatsMissing: buildStats.missing === true,
  }
}

function isWorkerChunk(name = "") {
  return /\.worker-/i.test(name) || /\.worker\.js$/i.test(name)
}

function isMonacoChunk(name = "") {
  return /vendor-monaco|monaco/i.test(name) && !isWorkerChunk(name)
}

function isAnalysisChunk(name = "") {
  return /^analysis(?:[-.])/i.test(name) || /analysisWorkspaceSmoke/i.test(name)
}

function isTypeScriptCompilerChunk(name = "") {
  return /^typescript(?:[-.])/i.test(name)
}

function largestBySize(chunks = []) {
  return chunks.slice().sort((a, b) => Number(b.sizeKb || 0) - Number(a.sizeKb || 0))[0] || null
}

function budgetCheck({ id, title, chunk, budgetKb, strict, detailPrefix, nextAction }) {
  const overBudget = chunk && Number(chunk.sizeKb || 0) > budgetKb
  return {
    id,
    title,
    status: overBudget && strict ? "failed" : overBudget ? "warning" : "passed",
    detail: chunk ? `${detailPrefix} ${chunk.name || "-"} ${Number(chunk.sizeKb || 0)}KB，预算 ${budgetKb}KB。` : `暂无 ${detailPrefix} 样本。`,
    nextAction,
    warningCategory: overBudget ? "budget" : "",
  }
}

function withBudgetEvidence(chunk, budgetKb) {
  const sizeKb = Number(chunk.sizeKb || 0)
  const overBudgetKb = Number(Math.max(0, sizeKb - budgetKb).toFixed(2))
  const filePath = chunk.filePath ? path.relative(root, chunk.filePath).replace(/\\/g, "/") : ""
  return {
    name: chunk.name || "",
    sizeKb,
    budgetKb,
    overBudgetKb,
    overBudgetRatio: budgetKb ? Number((sizeKb / budgetKb).toFixed(2)) : 0,
    filePath,
  }
}

function buildProviderConfigSnapshot(config = getConfig()) {
  const providerEntries = [
    {
      provider: "ollama",
      model: "local",
      ok: Boolean(config.ollama?.host),
      usageSource: "local-estimate",
      error: config.ollama?.host ? null : new Error("Ollama host not configured"),
    },
    {
      provider: "openai",
      model: config.openai?.model || "configured in request",
      ok: true,
      usageSource: "provider-or-estimate",
      note: config.openai?.apiKey ? "configured" : "optional provider not configured",
    },
    {
      provider: "anthropic",
      model: config.anthropic?.model || "configured in request",
      ok: true,
      usageSource: "provider-or-estimate",
      note: config.anthropic?.apiKey ? "configured" : "optional provider not configured",
    },
  ]
  const shared = config["codex-shared"]
  if (shared?.providerName || shared?.model || shared?.baseUrl) {
    providerEntries.push({
      provider: "codex-shared",
      model: shared.model || "unknown",
      ok: Boolean(shared.baseUrl && (shared.apiKey || shared.providerName)),
      usageSource: "provider-or-estimate",
      error: shared.error ? new Error(shared.error) : null,
    })
  }
  return providerEntries
}

function buildExtensionSnapshot() {
  const installed = getInstalledExtensions()
  const iconCache = {}
  const searchResults = installed.slice(0, 20).map((extension) => ({
    id: extension.id,
    name: extension.name,
    publisher: extension.publisher,
    displayName: extension.displayName,
    description: extension.description,
    installCount: extension.isBuiltin ? 1 : 0,
    iconUrl: extension.icon ? `file://${path.join(extension.installPath || "", extension.icon).replace(/\\/g, "/")}` : "",
    iconCacheUrl: extension.icon ? extension.id : "",
  }))
  for (const extension of installed) {
    const dataUrl = readInstalledIconDataUrl(extension)
    if (dataUrl) iconCache[extension.id] = dataUrl
  }
  return {
    installed,
    searchResults,
    query: searchResults[0]?.id || "",
    iconCache,
    activationReport: readActivationReport(),
    installResults: installed.length ? [{ success: true, source: "installed-scan" }] : [],
  }
}

function readInstalledIconDataUrl(extension = {}) {
  if (!extension.icon || !extension.installPath) return ""
  const installPath = path.resolve(extension.installPath)
  const iconPath = path.resolve(installPath, extension.icon)
  if (iconPath !== installPath && !iconPath.startsWith(`${installPath}${path.sep}`)) return ""
  try {
    const stat = fs.statSync(iconPath)
    if (!stat.isFile() || stat.size > 1024 * 1024) return ""
    const ext = path.extname(iconPath).toLowerCase()
    const mime = ext === ".svg" ? "image/svg+xml"
      : ext === ".webp" ? "image/webp"
        : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
          : "image/png"
    return `data:${mime};base64,${fs.readFileSync(iconPath).toString("base64")}`
  } catch {
    return ""
  }
}

function buildArHealthReports(options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  const provider = buildProviderHealthReport({ providers: options.providers || buildProviderConfigSnapshot() })
  const debug = buildDebugAdapterHealth(options.debug || {})
  const extensionSnapshot = options.extensions || buildExtensionSnapshot()
  const extensions = buildExtensionEcosystemHealth(extensionSnapshot)
  const compatibility = options.compatibility || buildInstalledCompatibilityReport({
    extensions: extensionSnapshot.installed,
    activationReport: extensionSnapshot.activationReport,
  })
  const goals = buildGoalRuntimeHealth({
    schedulerState: options.schedulerState || { runningGoals: 0 },
    incompleteGoals: options.incompleteGoals || goalStore.getIncompleteGoals(),
    auditHistory: options.auditHistory || readRecentAuditHistory(reportDir),
  })
  const performance = buildPerformanceBaselineProductGrade(options.performance || {})
  return { reportDir, provider, debug, extensions, compatibility, goals, performance }
}

function writeArHealthReports(reports, reportDir = reports.reportDir || defaultReportDir()) {
  const saved = {
    provider: saveProviderHealthReport(reports.provider, { reportDir }),
    debug: saveDebugAdapterHealth(reports.debug, { reportDir }),
    extensions: saveExtensionEcosystemHealth(reports.extensions, { reportDir }),
    compatibility: saveExtensionCompatibilityReport(reports.compatibility, { reportDir }),
    goals: saveGoalRuntimeHealth(reports.goals, { reportDir }),
    performance: writeReport(reports.performance, reportDir),
  }
  return { reportDir, reports, saved }
}

function readRecentAuditHistory(reportDir = defaultReportDir()) {
  const historyDir = path.join(reportDir, "history")
  if (!fs.existsSync(historyDir)) return []
  return fs.readdirSync(historyDir)
    .filter((name) => /\.json$/i.test(name))
    .slice(0, 20)
    .map((name) => ({ id: name }))
}

function writeReport(report, reportDir = defaultReportDir()) {
  fs.mkdirSync(reportDir, { recursive: true })
  const jsonPath = path.join(reportDir, "performance-baseline-latest.json")
  const markdownPath = path.join(reportDir, "performance-baseline-latest.md")
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(markdownPath, `${toMarkdown(report)}\n`, "utf8")
  return { report, jsonPath, markdownPath }
}

function toMarkdown(report) {
  const rows = (report.checks || []).map((check) =>
    `| ${check.title} | ${check.status} | ${String(check.detail || "").replace(/\|/g, "\\|")} | ${String(check.nextAction || "").replace(/\|/g, "\\|")} |`,
  )
  return [
    "# 性能基线报告",
    "",
    `- 状态: ${report.statusLabel || report.status}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    "",
    "| 检查项 | 状态 | 详情 | 下一步 |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
}

function readLatestPerformanceBaseline(options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  const jsonPath = path.join(reportDir, "performance-baseline-latest.json")
  return { report: readJsonSafe(jsonPath), jsonPath }
}

function parseCliArgs(argv) {
  const readArg = (prefix) => argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  return {
    reportDir: readArg("--report-dir=") || defaultReportDir(),
    distDir: readArg("--dist-dir=") || undefined,
    mainChunkKb: readArg("--main-chunk-kb=") ? Number(readArg("--main-chunk-kb=")) : undefined,
    lazyChunkKb: readArg("--lazy-chunk-kb=") ? Number(readArg("--lazy-chunk-kb=")) : undefined,
    monacoChunkKb: readArg("--monaco-chunk-kb=") ? Number(readArg("--monaco-chunk-kb=")) : undefined,
    analysisChunkKb: readArg("--analysis-chunk-kb=") ? Number(readArg("--analysis-chunk-kb=")) : undefined,
    typescriptCompilerChunkKb: readArg("--typescript-compiler-chunk-kb=") ? Number(readArg("--typescript-compiler-chunk-kb=")) : undefined,
    workerChunkKb: readArg("--worker-chunk-kb=") ? Number(readArg("--worker-chunk-kb=")) : undefined,
    strict: argv.includes("--strict"),
  }
}

if (require.main === module) {
  const args = parseCliArgs(process.argv.slice(2))
  const reports = buildArHealthReports({
    reportDir: args.reportDir,
    performance: {
      distDir: args.distDir,
      mainChunkKb: args.mainChunkKb,
      lazyChunkKb: args.lazyChunkKb,
      monacoChunkKb: args.monacoChunkKb,
      analysisChunkKb: args.analysisChunkKb,
      typescriptCompilerChunkKb: args.typescriptCompilerChunkKb,
      workerChunkKb: args.workerChunkKb,
      strict: args.strict,
    },
  })
  const saved = writeArHealthReports(reports, args.reportDir)
  const summary = {
    reportKind: "ar-health",
    createdAt: Date.now(),
    reportDir: args.reportDir,
    ready: Object.values(reports)
      .filter((report) => report && typeof report === "object" && report.reportKind)
      .every((report) => report.ready === true),
    reports: {
      provider: reports.provider,
      debug: reports.debug,
      extensions: reports.extensions,
      compatibility: reports.compatibility,
      goals: reports.goals,
      performance: reports.performance,
    },
    paths: {
      provider: saved.saved.provider.latestJsonPath,
      debug: saved.saved.debug.latestJsonPath,
      extensions: saved.saved.extensions.latestJsonPath,
      compatibility: saved.saved.compatibility.latestJsonPath,
      goals: saved.saved.goals.latestJsonPath,
      performance: saved.saved.performance.jsonPath,
    },
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  process.exit(Object.values(summary.reports).some((report) => report.status === "blocked") ? 1 : 0)
}

module.exports = {
  buildArHealthReports,
  buildExtensionSnapshot,
  buildPerformanceBaseline: buildPerformanceBaselineProductGrade,
  buildPerformanceBaselineLegacy: buildPerformanceBaseline,
  buildProviderConfigSnapshot,
  collectBuildStatsFromDist,
  defaultFrontendDistDir,
  defaultReportDir,
  parseCliArgs,
  readInstalledIconDataUrl,
  readLatestPerformanceBaseline,
  writeArHealthReports,
  writeReport,
}
