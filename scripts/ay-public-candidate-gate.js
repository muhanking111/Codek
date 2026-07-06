#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")

const sourceDoctor = require("./source-deploy-doctor")
const at3 = require("./at3-package-artifacts-check")
const at4 = require("./at4-install-smoke")
const at5 = require("./at5-functional-smoke")
const at6 = require("./at6-release-candidate-evidence")
const at7 = require("./at7-release-candidate-runbook")
const packagedSmoke = require("./packaged-app-smoke")
const packagedMultiAgentSmoke = require("./packaged-multi-agent-smoke")

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

function loadLatest(reportDir, fileName) {
  const jsonPath = path.join(reportDir, fileName)
  const markdownPath = jsonPath.replace(/\.json$/i, ".md")
  const report = readJsonSafe(jsonPath)
  return {
    available: Boolean(report),
    jsonPath,
    markdownPath: fs.existsSync(markdownPath) ? markdownPath : "",
    report,
  }
}

function normalizeStage(key, title, stage, evaluator) {
  if (!stage?.report) {
    return {
      key,
      title,
      status: "missing",
      ready: false,
      publicBlocking: true,
      internalBlocking: false,
      detail: "latest report missing",
      nextAction: "Run the matching AY/AT script to regenerate this report.",
      jsonPath: stage?.jsonPath || "",
      markdownPath: stage?.markdownPath || "",
    }
  }
  return {
    key,
    title,
    jsonPath: stage.jsonPath,
    markdownPath: stage.markdownPath,
    ...evaluator(stage.report),
  }
}

function statusFromSummary(report) {
  if (report.summary?.failed > 0 || report.ready === false && report.status === "blocked") return "blocked"
  if (report.summary?.warning > 0 || report.status === "degraded") return "degraded"
  return report.ready === false ? "blocked" : "ready"
}

function buildAyPublicCandidateGate(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const reportDir = input.reportDir || defaultReportDir()
  const stages = {
    sourceDoctor: input.sourceDoctor || loadLatest(reportDir, "source-deploy-doctor-latest.json"),
    packageArtifacts: input.packageArtifacts || loadLatest(reportDir, "package-artifacts-latest.json"),
    installSmoke: input.installSmoke || loadLatest(reportDir, "at4-install-smoke-latest.json"),
    packagedAppSmoke: input.packagedAppSmoke || loadLatest(reportDir, "packaged-app-smoke-latest.json"),
    packagedMultiAgentSmoke: input.packagedMultiAgentSmoke || loadLatest(reportDir, "packaged-multi-agent-smoke-latest.json"),
    functionalSmoke: input.functionalSmoke || loadLatest(reportDir, "at5-functional-smoke-latest.json"),
    releaseCandidateEvidence: input.releaseCandidateEvidence || loadLatest(reportDir, "at6-release-candidate-evidence-latest.json"),
    releaseCandidateRunbook: input.releaseCandidateRunbook || loadLatest(reportDir, "at7-release-candidate-runbook-latest.json"),
    productGradeGate: input.productGradeGate || loadLatest(reportDir, "au-product-grade-gate-latest.json"),
    axGate: input.axGate || loadLatest(reportDir, "ax-enterprise-gap-gate-latest.json"),
    releaseEvidence: input.releaseEvidence || loadLatest(reportDir, "release-evidence-latest.json"),
  }

  const stageResults = [
    normalizeStage("source_doctor", "源码部署诊断", stages.sourceDoctor, (report) => {
      const status = statusFromSummary(report)
      return {
        status,
        ready: report.ready !== false,
        publicBlocking: status === "blocked",
        internalBlocking: status === "blocked",
        detail: report.statusLabel || status,
        nextAction: report.nextActions?.[0]?.action || "",
        summary: report.summary,
      }
    }),
    normalizeStage("package_artifacts", "安装包/便携包产物", stages.packageArtifacts, (report) => {
      const installer = (report.artifacts || []).some((item) => item.type === "installer" && /setup/i.test(item.name || ""))
      const unpacked = (report.artifacts || []).some((item) => item.type === "unpacked")
      const status = !unpacked ? "blocked" : installer ? "ready" : "degraded"
      return {
        status,
        ready: Boolean(unpacked),
        publicBlocking: !installer || !unpacked,
        internalBlocking: !unpacked,
        detail: installer ? "NSIS installer and win-unpacked are present" : unpacked ? "win-unpacked is present, NSIS installer missing" : "no runnable packaged artifact",
        nextAction: installer ? "" : "Run npm run pack:win and regenerate package artifact evidence.",
        summary: report.summary,
      }
    }),
    normalizeStage("install_smoke", "安装后首次启动契约", stages.installSmoke, (report) => {
      const status = statusFromSummary(report)
      const nsis = (report.checks || []).find((item) => item.id === "nsis_installer")
      return {
        status,
        ready: report.ready !== false,
        publicBlocking: status === "blocked" || nsis?.status !== "passed",
        internalBlocking: status === "blocked",
        detail: report.statusLabel || status,
        nextAction: status === "blocked" ? report.nextActions?.[0]?.action || "Fix failed install smoke checks." : nsis?.status !== "passed" ? "Generate NSIS installer before public distribution." : "",
        summary: report.summary,
      }
    }),
    normalizeStage("packaged_app_smoke", "真实打包应用启动 smoke", stages.packagedAppSmoke, (report) => {
      const status = statusFromSummary(report)
      const packaged = report.scope?.packagedEnvironment === true
      const launched = report.scope?.realLaunchExecuted === true
      return {
        status,
        ready: report.ready === true && packaged && launched,
        publicBlocking: status !== "ready" || !packaged || !launched,
        internalBlocking: status === "blocked",
        detail: report.ready
          ? `packaged launch passed; smokeChecks=${report.summary?.smokeChecks || 0}`
          : report.statusLabel || "packaged launch smoke failed",
        nextAction: report.ready ? "" : "Run npm run smoke:packaged:report and fix the first failed packaged startup check.",
        summary: report.summary,
      }
    }),
    normalizeStage("packaged_multi_agent_smoke", "安装包多 Agent 验收", stages.packagedMultiAgentSmoke, (report) => {
      const status = statusFromSummary(report)
      const packaged = report.scope?.packagedEnvironment === true
      const launched = report.scope?.realLaunchExecuted === true
      const equivalent = report.scope?.equivalentPackagedAgentEnvironment === true
      return {
        status,
        ready: report.ready === true && packaged && launched && equivalent,
        publicBlocking: status !== "ready" || !packaged || !launched || !equivalent,
        internalBlocking: status === "blocked",
        detail: report.ready
          ? `multi-agent packaged evidence passed; checks=${report.summary?.passed || 0}/${report.summary?.total || 0}`
          : report.statusLabel || "packaged multi-agent smoke failed",
        nextAction: report.ready ? "" : "Run npm run smoke:packaged:multi-agent after packaged app smoke and standard real project acceptance.",
        summary: report.summary,
      }
    }),
    normalizeStage("functional_smoke", "发布候选功能契约", stages.functionalSmoke, (report) => {
      const status = statusFromSummary(report)
      return {
        status,
        ready: report.ready !== false,
        publicBlocking: status === "blocked",
        internalBlocking: status === "blocked",
        detail: report.statusLabel || status,
        nextAction: report.nextActions?.[0]?.action || "",
        summary: report.summary,
      }
    }),
    normalizeStage("release_candidate_evidence", "AT6 发布候选证据", stages.releaseCandidateEvidence, (report) => {
      const grade = report.overall?.grade || "unknown"
      return {
        status: grade === "production-blocked" ? "blocked" : grade === "release-ready" ? "ready" : "degraded",
        ready: grade !== "production-blocked",
        publicBlocking: grade !== "release-ready",
        internalBlocking: grade === "production-blocked" && !report.overall?.hasUnpacked,
        detail: `overall=${grade}`,
        nextAction: report.productionBlocked?.[0]?.action || report.reviewItems?.[0]?.action || "",
        summary: report.overall,
      }
    }),
    normalizeStage("release_candidate_runbook", "AT7 回滚与分发说明", stages.releaseCandidateRunbook, (report) => {
      const hasRollback = Array.isArray(report.sections?.sourceFallback) && report.sections.sourceFallback.length > 0
      const hasCleanup = Array.isArray(report.sections?.cleanup) && report.sections.cleanup.length > 0
      const ok = hasRollback && hasCleanup
      return {
        status: ok ? "ready" : "blocked",
        ready: ok,
        publicBlocking: !ok,
        internalBlocking: !ok,
        detail: ok ? "rollback and cleanup instructions are present" : "rollback or cleanup instructions missing",
        nextAction: ok ? "" : "Regenerate AT7 runbook.",
        summary: report.evidenceSummary,
      }
    }),
    normalizeStage("product_grade_gate", "AU 产品级门禁", stages.productGradeGate, (report) => ({
      status: report.ready ? "ready" : "blocked",
      ready: Boolean(report.ready),
      publicBlocking: !report.ready,
      internalBlocking: !report.ready,
      detail: report.ready ? "AU product-grade gate ready" : "AU product-grade gate not ready",
      nextAction: report.nextActions?.[0] || "",
      summary: report.summary,
    })),
    normalizeStage("ax_gate", "AX 企业缺口门禁", stages.axGate, (report) => ({
      status: report.ready ? "ready" : "blocked",
      ready: Boolean(report.ready),
      publicBlocking: !report.ready,
      internalBlocking: !report.ready,
      detail: report.ready ? "AX enterprise gate ready" : "AX enterprise gate not ready",
      nextAction: report.nextActions?.[0] || "",
      summary: report.summary,
    })),
    normalizeStage("release_evidence", "Release evidence", stages.releaseEvidence, (report) => ({
      status: report.ready ? "ready" : "blocked",
      ready: Boolean(report.ready),
      publicBlocking: !report.ready || (report.gaps || []).some((gap) => gap?.severity !== "low" && gap?.severity !== "info"),
      internalBlocking: !report.ready,
      detail: report.ready ? `ready ${report.summary?.ready || 0}/${report.summary?.total || 0}` : "release evidence not ready",
      nextAction: report.nextActions?.[0] || "",
      summary: report.summary,
    })),
  ]

  const summary = {
    total: stageResults.length,
    ready: stageResults.filter((item) => item.status === "ready").length,
    degraded: stageResults.filter((item) => item.status === "degraded").length,
    blocked: stageResults.filter((item) => item.status === "blocked" || item.status === "missing").length,
    publicBlocking: stageResults.filter((item) => item.publicBlocking).length,
    internalBlocking: stageResults.filter((item) => item.internalBlocking).length,
  }

  const publicBlockers = stageResults
    .filter((item) => item.publicBlocking)
    .map((item) => ({
      id: item.key,
      title: item.title,
      status: item.status,
      detail: item.detail,
      action: item.nextAction || "Review the linked report and regenerate evidence.",
    }))
  const internalBlockers = stageResults
    .filter((item) => item.internalBlocking)
    .map((item) => ({
      id: item.key,
      title: item.title,
      status: item.status,
      detail: item.detail,
      action: item.nextAction || "Review the linked report and regenerate evidence.",
    }))
  const warnings = stageResults
    .filter((item) => item.status === "degraded" && !item.publicBlocking)
    .map((item) => ({
      id: item.key,
      title: item.title,
      detail: item.detail,
      action: item.nextAction || "",
    }))

  const overallGrade = publicBlockers.length === 0
    ? "public-candidate-ready"
    : internalBlockers.length === 0
      ? "internal-only"
      : "blocked"

  return {
    reportKind: "ay-public-candidate-gate",
    createdAt,
    ready: overallGrade === "public-candidate-ready",
    status: overallGrade === "blocked" ? "blocked" : overallGrade === "internal-only" ? "degraded" : "ready",
    overallGrade,
    summary,
    stages: stageResults,
    publicBlockers,
    internalBlockers,
    warnings,
    nextActions: publicBlockers.length > 0
      ? publicBlockers.map((item) => item.action)
      : warnings.map((item) => item.action).filter(Boolean),
    scope: {
      realPublishExecuted: false,
      uploadExecuted: false,
      signingExecuted: false,
      note: "AY gate aggregates local evidence only; it does not publish, sign, upload, create PRs, or store prompt/response bodies.",
    },
  }
}

function paths(reportDir = defaultReportDir()) {
  const resolved = reportDir || defaultReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "ay-public-candidate-gate-latest.json"),
    latestMarkdownPath: path.join(resolved, "ay-public-candidate-gate-latest.md"),
    historyDir: path.join(resolved, "history"),
  }
}

function escape(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function relativeOrDash(value) {
  if (!value) return "-"
  return path.isAbsolute(value) ? path.relative(root, value) : value
}

function toMarkdown(report) {
  const stageRows = (report.stages || []).map((item) =>
    `| ${escape(item.title)} | ${item.status} | ${item.publicBlocking ? "YES" : "NO"} | ${item.internalBlocking ? "YES" : "NO"} | ${escape(item.detail)} | ${escape(relativeOrDash(item.markdownPath || item.jsonPath))} |`,
  )
  const blockerRows = (report.publicBlockers || []).map((item) =>
    `| ${escape(item.title)} | ${item.status} | ${escape(item.detail)} | ${escape(item.action)} |`,
  )
  const internalRows = (report.internalBlockers || []).map((item) =>
    `| ${escape(item.title)} | ${item.status} | ${escape(item.detail)} | ${escape(item.action)} |`,
  )
  return [
    "# AY Public Candidate Gate",
    "",
    `- Grade: **${report.overallGrade}**`,
    `- Status: ${report.status}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Created At: ${new Date(report.createdAt).toISOString()}`,
    `- Summary: ready=${report.summary.ready}/${report.summary.total}, degraded=${report.summary.degraded}, blocked=${report.summary.blocked}, publicBlocking=${report.summary.publicBlocking}, internalBlocking=${report.summary.internalBlocking}`,
    "",
    "## Stages",
    "",
    "| Stage | Status | Public Blocking | Internal Blocking | Detail | Report |",
    "| --- | --- | --- | --- | --- | --- |",
    ...stageRows,
    "",
    "## Public Distribution Blockers",
    "",
    "| Item | Status | Detail | Next Action |",
    "| --- | --- | --- | --- |",
    ...(blockerRows.length ? blockerRows : ["| None | - | - | - |"]),
    "",
    "## Internal Candidate Blockers",
    "",
    "| Item | Status | Detail | Next Action |",
    "| --- | --- | --- | --- |",
    ...(internalRows.length ? internalRows : ["| None | - | - | - |"]),
    "",
    "## Boundaries",
    "",
    "- This gate reads and writes local evidence only.",
    "- It does not publish, sign, notarize, upload telemetry, push Git changes, or create PRs.",
    "- Public release still requires explicit human approval for signing and distribution.",
  ].join("\n")
}

function save(report, options = {}) {
  const p = paths(options.reportDir)
  fs.mkdirSync(p.reportDir, { recursive: true })
  fs.mkdirSync(p.historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJson = path.join(p.historyDir, `ay-public-candidate-gate-${stamp}.json`)
  const historyMd = path.join(p.historyDir, `ay-public-candidate-gate-${stamp}.md`)
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

function ensureBaseReports(reportDir) {
  const doctorReport = sourceDoctor.buildSourceDeployDoctor()
  sourceDoctor.save(doctorReport, { reportDir })
  const packageReport = at3.buildPackageArtifactsReport()
  at3.writePackageArtifactsReport(packageReport, reportDir)
  const installReport = at4.buildAt4InstallSmoke()
  at4.save(installReport, { reportDir })
  const functionalReport = at5.buildAt5FunctionalSmoke()
  at5.save(functionalReport, { reportDir })
  let packagedReport = packagedSmoke.readLatest({ reportDir }).report
  if (!packagedReport) {
    packagedReport = {
      reportKind: "packaged-app-smoke",
      createdAt: Date.now(),
      ready: false,
      status: "blocked",
      statusLabel: "packaged app smoke has not run",
      summary: { total: 1, passed: 0, warning: 0, failed: 1, smokeChecks: 0, failedSmokeChecks: 1 },
      checks: [{
        id: "packaged_smoke_missing",
        title: "packaged app smoke report",
        status: "failed",
        detail: "packaged-app-smoke-latest.json missing",
        nextAction: "Run npm run smoke:packaged:report after npm run pack:win.",
      }],
      scope: {
        realInstallExecuted: false,
        realLaunchExecuted: false,
        packagedEnvironment: false,
        note: "Placeholder generated by AY gate because the real packaged smoke has not been executed.",
      },
    }
    packagedSmoke.save(packagedReport, { reportDir })
  }
  let packagedMultiAgentReport = packagedMultiAgentSmoke.readLatest({ reportDir }).report
  if (!packagedMultiAgentReport) {
    packagedMultiAgentReport = packagedMultiAgentSmoke.buildPackagedMultiAgentSmoke({ reportDir })
    packagedMultiAgentSmoke.save(packagedMultiAgentReport, { reportDir })
  }
  const evidenceReport = at6.buildAt6Evidence({ reportDir })
  at6.save(evidenceReport, { reportDir })
  const runbookReport = at7.buildAt7Runbook({ reportDir })
  at7.save(runbookReport, { reportDir })
  return { doctorReport, packageReport, installReport, packagedReport, packagedMultiAgentReport, functionalReport, evidenceReport, runbookReport }
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const reportDirArg = args.find((arg) => arg.startsWith("--report-dir="))
  const noWrite = args.includes("--no-write")
  const skipRefresh = args.includes("--skip-refresh")
  const reportDir = reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir()
  if (!skipRefresh && !noWrite) {
    ensureBaseReports(reportDir)
  }
  const report = buildAyPublicCandidateGate({ reportDir })
  const saved = noWrite ? { latestJsonPath: "", latestMarkdownPath: "" } : save(report, { reportDir })
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    overallGrade: report.overallGrade,
    summary: report.summary,
    publicBlockers: report.publicBlockers.map((item) => item.title),
    internalBlockers: report.internalBlockers.map((item) => item.title),
    nextActions: report.nextActions,
    jsonPath: saved.latestJsonPath || "",
    markdownPath: saved.latestMarkdownPath || "",
  }, null, 2)}\n`)
  process.exit(report.status === "blocked" ? 1 : 0)
}

module.exports = {
  buildAyPublicCandidateGate,
  defaultReportDir,
  ensureBaseReports,
  readLatest,
  save,
  toMarkdown,
}
