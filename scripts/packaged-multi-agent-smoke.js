#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function relativeOrEmpty(filePath) {
  if (!filePath) return ""
  return path.isAbsolute(filePath) ? path.relative(root, filePath) : filePath
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  return {
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
    noWrite: argv.includes("--no-write"),
  }
}

function check(id, title, passed, detail, nextAction = "", extra = {}) {
  return {
    id,
    title,
    status: passed ? "passed" : "failed",
    passed: Boolean(passed),
    detail,
    nextAction: passed ? "" : nextAction,
    ...extra,
  }
}

function loadLatest(reportDir, name) {
  const jsonPath = path.join(reportDir, name)
  const markdownPath = jsonPath.replace(/\.json$/i, ".md")
  return {
    report: readJsonSafe(jsonPath),
    jsonPath,
    markdownPath: fs.existsSync(markdownPath) ? markdownPath : "",
  }
}

function buildPackagedMultiAgentSmoke(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const reportDir = input.reportDir || defaultReportDir()
  const packaged = input.packagedAppSmoke || loadLatest(reportDir, "packaged-app-smoke-latest.json")
  const acceptance = input.acceptance || loadLatest(reportDir, "real-project-smoke-latest.json")
  const packagedReport = packaged.report
  const acceptanceReport = acceptance.report
  const run = acceptanceReport?.run || {}
  const matrix = acceptanceReport?.matrix || {}
  const multiScenario = Array.isArray(matrix.scenarios)
    ? matrix.scenarios.find((item) => item.id === "multi_file_success" || item.strategy === "multi-agent")
    : null
  const checks = [
    check(
      "packaged_app_smoke_ready",
      "真实 packaged app 已启动并通过 smoke",
      packagedReport?.ready === true &&
        packagedReport?.scope?.packagedEnvironment === true &&
        packagedReport?.scope?.realLaunchExecuted === true,
      packagedReport
        ? `ready=${Boolean(packagedReport.ready)} smokeChecks=${packagedReport.summary?.smokeChecks || 0}`
        : "packaged-app-smoke-latest.json missing",
      "Run npm run smoke:packaged:report after npm run pack:win.",
      { reportPath: relativeOrEmpty(packaged.markdownPath || packaged.jsonPath) },
    ),
    check(
      "acceptance_ready",
      "真实项目验收矩阵通过",
      acceptanceReport?.ready === true && Number(acceptanceReport?.failed || 0) === 0,
      acceptanceReport
        ? `passed=${acceptanceReport.passed}/${acceptanceReport.total}; taskSet=${acceptanceReport.taskSet}`
        : "real-project-smoke-latest.json missing",
      "Run npm run smoke:real-project -- --task-set=standard.",
      { reportPath: relativeOrEmpty(acceptance.markdownPath || acceptance.jsonPath) },
    ),
    check(
      "multi_agent_strategy",
      "Router/Orchestrator 使用 multi-agent",
      run.executionStrategy === "multi-agent" && acceptanceReport?.task?.expectedStrategy === "multi-agent",
      `executionStrategy=${run.executionStrategy || "-"} expected=${acceptanceReport?.task?.expectedStrategy || "-"}`,
      "Run standard real project acceptance and inspect Router strategy evidence.",
    ),
    check(
      "proposal_only_before_accept",
      "确认前保持 proposal-only",
      run.writeModeBeforeAccept === "proposed_patch_only" && run.statusBeforeAccept === "waiting_user",
      `statusBeforeAccept=${run.statusBeforeAccept || "-"} writeModeBeforeAccept=${run.writeModeBeforeAccept || "-"}`,
      "Ensure real project acceptance keeps main workspace unchanged before Accept.",
    ),
    check(
      "accept_applies_patch",
      "Accept 后 patch 写入并完成",
      run.statusAfterAccept === "completed" && run.writeModeAfterAccept === "applied",
      `statusAfterAccept=${run.statusAfterAccept || "-"} writeModeAfterAccept=${run.writeModeAfterAccept || "-"}`,
      "Fix orchestrator Accept flow and quality gate integration.",
    ),
    check(
      "quality_gate_and_artifacts",
      "质量门、artifact、diff 证据完整",
      Number(run.phaseCount || 0) >= 5 &&
        Number(run.assignmentCount || 0) >= 5 &&
        Number(run.artifactCount || 0) >= 5 &&
        Array.isArray(run.filesChanged) &&
        run.filesChanged.length >= 3,
      `phases=${run.phaseCount || 0} assignments=${run.assignmentCount || 0} artifacts=${run.artifactCount || 0} filesChanged=${(run.filesChanged || []).join(",")}`,
      "Regenerate multi-agent acceptance and verify artifact/diff collection.",
    ),
    check(
      "matrix_multi_agent_case",
      "矩阵包含 multi-agent 成功场景",
      Boolean(multiScenario?.passed) &&
        multiScenario?.strategy === "multi-agent" &&
        Number(multiScenario?.patchArtifactCount || 0) >= 3,
      multiScenario
        ? `scenario=${multiScenario.id}; strategy=${multiScenario.strategy}; patchArtifacts=${multiScenario.patchArtifactCount}`
        : "multi-agent scenario missing",
      "Ensure standard acceptance matrix includes multi_file_success.",
    ),
    check(
      "recovery_evidence",
      "恢复动作证据存在",
      Number(acceptanceReport?.recovery?.actionCount || 0) >= 1 &&
        Boolean(acceptanceReport?.recovery?.executedAction),
      acceptanceReport?.recovery
        ? `actionCount=${acceptanceReport.recovery.actionCount}; executed=${acceptanceReport.recovery.executedAction}`
        : "recovery evidence missing",
      "Run standard acceptance with recovery checks enabled.",
    ),
  ]
  const failed = checks.filter((item) => !item.passed)
  const summary = {
    total: checks.length,
    passed: checks.length - failed.length,
    warning: 0,
    failed: failed.length,
  }
  return {
    reportKind: "packaged-multi-agent-smoke",
    createdAt,
    ready: failed.length === 0,
    status: failed.length === 0 ? "ready" : "blocked",
    statusLabel: failed.length === 0 ? "packaged multi-agent evidence ready" : "packaged multi-agent evidence blocked",
    summary,
    checks,
    evidence: {
      packagedAppSmoke: {
        jsonPath: relativeOrEmpty(packaged.jsonPath),
        markdownPath: relativeOrEmpty(packaged.markdownPath),
        smokeChecks: packagedReport?.summary?.smokeChecks || 0,
        packagedEnvironment: packagedReport?.scope?.packagedEnvironment === true,
        realLaunchExecuted: packagedReport?.scope?.realLaunchExecuted === true,
      },
      realProjectAcceptance: {
        jsonPath: relativeOrEmpty(acceptance.jsonPath),
        markdownPath: relativeOrEmpty(acceptance.markdownPath),
        taskSet: acceptanceReport?.taskSet || "",
        total: acceptanceReport?.total || 0,
        passed: acceptanceReport?.passed || 0,
        executionStrategy: run.executionStrategy || "",
        writeModeBeforeAccept: run.writeModeBeforeAccept || "",
        writeModeAfterAccept: run.writeModeAfterAccept || "",
        phaseCount: run.phaseCount || 0,
        assignmentCount: run.assignmentCount || 0,
        artifactCount: run.artifactCount || 0,
        filesChanged: run.filesChanged || [],
      },
    },
    scope: {
      packagedEnvironment: packagedReport?.scope?.packagedEnvironment === true,
      realLaunchExecuted: packagedReport?.scope?.realLaunchExecuted === true,
      equivalentPackagedAgentEnvironment: true,
      note: "This report gates AY5 by combining a real packaged app launch smoke with the standard isolated multi-agent proposal-only acceptance matrix. It does not publish, sign, upload telemetry, or store prompt/response bodies.",
    },
    nextActions: failed.map((item) => ({ id: item.id, title: item.title, action: item.nextAction })),
  }
}

function paths(reportDir = defaultReportDir()) {
  const resolved = reportDir || defaultReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "packaged-multi-agent-smoke-latest.json"),
    latestMarkdownPath: path.join(resolved, "packaged-multi-agent-smoke-latest.md"),
    historyDir: path.join(resolved, "history"),
  }
}

function escape(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function toMarkdown(report) {
  const rows = (report.checks || []).map((item) =>
    `| ${escape(item.title)} | ${item.status} | ${escape(item.detail)} | ${escape(item.nextAction || "-")} |`,
  )
  return [
    "# Packaged Multi-Agent Smoke",
    "",
    `- Status: ${report.statusLabel}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Created At: ${new Date(report.createdAt).toISOString()}`,
    `- Summary: ${report.summary.passed}/${report.summary.total} passed, failed=${report.summary.failed}`,
    "",
    "## Checks",
    "",
    "| Check | Status | Detail | Next Action |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "## Evidence",
    "",
    `- Packaged smoke: ${report.evidence.packagedAppSmoke.markdownPath || report.evidence.packagedAppSmoke.jsonPath || "-"}`,
    `- Real project acceptance: ${report.evidence.realProjectAcceptance.markdownPath || report.evidence.realProjectAcceptance.jsonPath || "-"}`,
    `- Execution strategy: ${report.evidence.realProjectAcceptance.executionStrategy || "-"}`,
    `- Write mode: ${report.evidence.realProjectAcceptance.writeModeBeforeAccept || "-"} -> ${report.evidence.realProjectAcceptance.writeModeAfterAccept || "-"}`,
    "",
    "## Boundaries",
    "",
    "- Reads local latest evidence and writes a local AY5 aggregate report.",
    "- Does not publish, sign, upload telemetry, or store prompt/response bodies.",
  ].join("\n")
}

function save(report, options = {}) {
  const p = paths(options.reportDir)
  fs.mkdirSync(p.reportDir, { recursive: true })
  fs.mkdirSync(p.historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJson = path.join(p.historyDir, `packaged-multi-agent-smoke-${stamp}.json`)
  const historyMd = path.join(p.historyDir, `packaged-multi-agent-smoke-${stamp}.md`)
  const md = toMarkdown(report)
  fs.writeFileSync(p.latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(p.latestMarkdownPath, `${md}\n`, "utf8")
  fs.writeFileSync(historyJson, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMd, `${md}\n`, "utf8")
  return { ...p, historyJson, historyMd, markdown: md }
}

function readLatest(options = {}) {
  const p = paths(options.reportDir)
  if (!fs.existsSync(p.latestJsonPath)) return { report: null, markdown: "", ...p }
  return {
    report: readJsonSafe(p.latestJsonPath),
    markdown: fs.existsSync(p.latestMarkdownPath) ? fs.readFileSync(p.latestMarkdownPath, "utf8") : "",
    ...p,
  }
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2))
  const report = buildPackagedMultiAgentSmoke({ reportDir: options.reportDir })
  const saved = options.noWrite ? { latestJsonPath: "", latestMarkdownPath: "" } : save(report, options)
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    nextActions: report.nextActions,
    jsonPath: saved.latestJsonPath || "",
    markdownPath: saved.latestMarkdownPath || "",
  }, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

module.exports = {
  buildPackagedMultiAgentSmoke,
  defaultReportDir,
  parseArgs,
  readLatest,
  save,
  toMarkdown,
}
