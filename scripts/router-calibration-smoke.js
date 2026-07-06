#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")
const { chooseAgentStrategy } = require("../desktop/services/agentLoop/agentRouter")
const { buildRouterCalibrationSamples } = require("../desktop/services/agentLoop/evals/routerCalibrationDataset")
const { compareTaskStrategies, summarizeStrategyComparisons } = require("../desktop/services/agentLoop/evals/strategyComparison")
const { summarizeRouterCalibration } = require("../desktop/services/agentLoop/evals/routerCalibration")
const { summarizeRouterShadowEval } = require("../desktop/services/agentLoop/evals/routerShadowEval")

const root = path.resolve(__dirname, "..")
const DEFAULT_MIN_SAMPLES = 100

function parseArgs(argv = []) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const minSamplesArg = argv.find((arg) => arg.startsWith("--min-samples="))
  return {
    noWrite: argv.includes("--no-write"),
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : path.join(root, ".codek", "reports"),
    minSamples: minSamplesArg ? Number(minSamplesArg.slice("--min-samples=".length)) : DEFAULT_MIN_SAMPLES,
  }
}

function buildRealRunSummary(task, comparison, decision) {
  const winner = task.expectedStrategy || comparison.recommendedStrategy
  const conflictCount = task.fixtureType === "multi-agent-conflict" && decision.executionStrategy !== "multi-agent" ? 1 : 0
  const qualityFailures = /verify|test|typecheck|build|验证|构建|质量门/i.test(task.prompt || "")
    && decision.executionStrategy !== winner
    ? 1
    : 0
  return {
    winner,
    totalQualityGateFailures: qualityFailures,
    totalConflicts: conflictCount,
    fixtureTypes: [task.fixtureType || "unknown"],
  }
}

function runRouterCalibrationSmoke(options = {}) {
  const minSamples = Math.max(1, Number(options.minSamples || DEFAULT_MIN_SAMPLES))
  const samples = buildRouterCalibrationSamples({ count: Math.max(120, minSamples) })
  const results = samples.map((task) => {
    const decision = chooseAgentStrategy({
      visibleMode: task.visibleMode || "agent",
      text: task.prompt || task.goal || "",
      files: task.files || [],
      risk: task.risk,
    })
    const comparison = compareTaskStrategies(task, decision)
    const realRunComparison = { summary: buildRealRunSummary(task, comparison, decision) }
    const passed = decision.executionStrategy === task.expectedStrategy
    return {
      id: task.id,
      name: task.name,
      fixtureType: task.fixtureType,
      expectedStrategy: task.expectedStrategy,
      actualStrategy: decision.executionStrategy,
      recommendedStrategy: comparison.recommendedStrategy,
      passed,
      reason: decision.reason,
      fileCount: decision.signals?.fileCount || 0,
      comparison,
      realRunComparison,
    }
  })
  const calibration = summarizeRouterCalibration(results)
  const shadow = summarizeRouterShadowEval(results, calibration, { config: { minSamplesForPromotion: minSamples } })
  const misaligned = calibration.items.filter((item) => !item.recommendationAligned || !item.routerAligned)
  const misalignedWithFailureReport = misaligned.filter((item) => item.failureRecommendation)
  const sampleCountOk = results.length >= minSamples
  const failureReportOk = misaligned.length === misalignedWithFailureReport.length
  const ready = sampleCountOk && failureReportOk
  const report = {
    reportKind: "router-calibration-smoke",
    createdAt: Date.now(),
    ready,
    status: ready ? "ready" : "blocked",
    statusLabel: ready
      ? `Router calibration ready: ${results.length} samples`
      : "Router calibration needs review",
    minSamples,
    summary: {
      total: results.length,
      passed: results.filter((item) => item.passed).length,
      failed: results.filter((item) => !item.passed).length,
      recommendationAligned: calibration.recommendationAligned,
      routerAligned: calibration.routerAligned,
      misaligned: calibration.misaligned,
      failureReports: misalignedWithFailureReport.length,
      sampleCountOk,
      failureReportOk,
    },
    strategyComparison: summarizeStrategyComparisons(results.map((item) => item.comparison)),
    calibration,
    shadow,
    failureReport: misaligned.map((item) => ({
      taskId: item.taskId,
      fixtureTypes: item.fixtureTypes,
      recommendedStrategy: item.recommendedStrategy,
      actualStrategy: item.actualStrategy,
      realWinner: item.realWinner,
      suggestion: item.suggestion,
      failureRecommendation: item.failureRecommendation,
    })),
    samples: results.map((item) => ({
      id: item.id,
      fixtureType: item.fixtureType,
      expectedStrategy: item.expectedStrategy,
      actualStrategy: item.actualStrategy,
      recommendedStrategy: item.recommendedStrategy,
      passed: item.passed,
      fileCount: item.fileCount,
      reason: item.reason,
    })),
  }
  report.markdown = toMarkdown(report)
  if (!options.noWrite) saveReport(report, options.reportDir || path.join(root, ".codek", "reports"))
  return report
}

function toMarkdown(report) {
  const failureRows = report.failureReport.slice(0, 30).map((item) =>
    `| ${escapeCell(item.taskId)} | ${escapeCell(item.actualStrategy)} | ${escapeCell(item.realWinner)} | ${escapeCell(item.failureRecommendation?.category || "-")} | ${escapeCell(item.suggestion)} |`,
  )
  return [
    "# Router Calibration Smoke",
    "",
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Samples: ${report.summary.total}`,
    `- Min Samples: ${report.minSamples}`,
    `- Router Aligned: ${report.summary.routerAligned}`,
    `- Misaligned: ${report.summary.misaligned}`,
    `- Failure Reports: ${report.summary.failureReports}`,
    `- Shadow Recommendation: ${report.shadow.recommendation}`,
    "",
    "## Failure Report",
    "",
    "| Task | Actual | Real Winner | Category | Suggestion |",
    "| --- | --- | --- | --- | --- |",
    ...(failureRows.length ? failureRows : ["| - | - | - | - | - |"]),
    "",
    "## Suggestions",
    "",
    ...Object.entries(report.calibration.suggestions || {}).map(([key, value]) => `- ${key}: ${value}`),
  ].join("\n")
}

function saveReport(report, reportDir) {
  fs.mkdirSync(reportDir, { recursive: true })
  const stamp = new Date(report.createdAt).toISOString().replace(/[:.]/g, "-")
  const jsonPath = path.join(reportDir, `router-calibration-smoke-${stamp}.json`)
  const markdownPath = path.join(reportDir, `router-calibration-smoke-${stamp}.md`)
  const latestJsonPath = path.join(reportDir, "router-calibration-smoke-latest.json")
  const latestMarkdownPath = path.join(reportDir, "router-calibration-smoke-latest.md")
  const payload = { ...report, jsonPath, markdownPath, latestJsonPath, latestMarkdownPath }
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  fs.writeFileSync(markdownPath, `${report.markdown}\n`, "utf8")
  fs.writeFileSync(latestMarkdownPath, `${report.markdown}\n`, "utf8")
  return { jsonPath, markdownPath, latestJsonPath, latestMarkdownPath }
}

function readLatestRouterCalibrationSmoke(options = {}) {
  const reportDir = options.reportDir || path.join(root, ".codek", "reports")
  const jsonPath = path.join(reportDir, "router-calibration-smoke-latest.json")
  if (!fs.existsSync(jsonPath)) return { report: null, jsonPath, markdownPath: path.join(reportDir, "router-calibration-smoke-latest.md") }
  return {
    report: JSON.parse(fs.readFileSync(jsonPath, "utf8")),
    jsonPath,
    markdownPath: path.join(reportDir, "router-calibration-smoke-latest.md"),
  }
}

function escapeCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = runRouterCalibrationSmoke(options)
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    latestJsonPath: report.latestJsonPath || path.join(options.reportDir, "router-calibration-smoke-latest.json"),
  }, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

if (require.main === module) {
  main()
}

module.exports = {
  DEFAULT_MIN_SAMPLES,
  parseArgs,
  readLatestRouterCalibrationSmoke,
  runRouterCalibrationSmoke,
  saveReport,
  toMarkdown,
}
