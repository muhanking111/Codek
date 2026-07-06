#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function loadLatest(reportDir, name) {
  const jsonPath = path.join(reportDir, name)
  const markdownPath = jsonPath.replace(/\.json$/i, ".md")
  return {
    report: readJson(jsonPath),
    jsonPath,
    markdownPath: fs.existsSync(markdownPath) ? markdownPath : "",
  }
}

function rel(filePath) {
  return filePath ? path.relative(root, filePath) : ""
}

function stage(id, title, latest, evaluate) {
  if (!latest.report) {
    return {
      id,
      title,
      status: "blocked",
      ready: false,
      publicBlocking: true,
      detail: `${rel(latest.jsonPath)} missing`,
      nextAction: "Generate the required latest report before open-source candidate delivery.",
      reportPath: rel(latest.jsonPath),
    }
  }
  const result = evaluate(latest.report)
  return {
    id,
    title,
    status: result.ready ? "ready" : "blocked",
    ready: Boolean(result.ready),
    publicBlocking: result.ready !== true,
    detail: result.detail || "",
    nextAction: result.ready ? "" : result.nextAction || "Fix this stage before open-source candidate delivery.",
    reportPath: rel(latest.markdownPath || latest.jsonPath),
  }
}

function betaTrialTaskCount(report) {
  if (Array.isArray(report?.tasks)) return report.tasks.length
  if (Array.isArray(report?.steps)) return report.steps.length
  return Number(report?.summary?.requiredTasks || 0)
}

function buildOpenSourceCandidateGate(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const reportDir = input.reportDir || defaultReportDir()
  const reports = {
    ay: input.ay || loadLatest(reportDir, "ay-public-candidate-gate-latest.json"),
    doctor: input.doctor || loadLatest(reportDir, "source-deploy-doctor-latest.json"),
    readiness: input.readiness || loadLatest(reportDir, "open-source-readiness-latest.json"),
    ci: input.ci || loadLatest(reportDir, "release-ci-readiness-latest.json"),
    crossPlatform: input.crossPlatform || loadLatest(reportDir, "cross-platform-package-plan-latest.json"),
    releaseDraft: input.releaseDraft || loadLatest(reportDir, "release-draft-latest.json"),
    beta: input.beta || loadLatest(reportDir, "beta-trial-plan-latest.json"),
  }
  const stages = [
    stage("ay_public_candidate", "AY public candidate gate", reports.ay, (report) => ({
      ready: report.ready === true && report.overallGrade === "public-candidate-ready",
      detail: `ready=${report.ready}; grade=${report.overallGrade || "-"}`,
      nextAction: "Run npm run ay:public-candidate.",
    })),
    stage("clean_clone_doctor", "Clean clone source deploy doctor", reports.doctor, (report) => ({
      ready: report.ready === true && report.cleanClone === true,
      detail: `ready=${report.ready}; cleanClone=${report.cleanClone}; failed=${report.summary?.failed ?? "-"}`,
      nextAction: "Run npm run doctor -- --clean-clone.",
    })),
    stage("open_source_readiness", "Open-source readiness", reports.readiness, (report) => ({
      ready: report.ready === true,
      detail: `ready=${report.ready}; failed=${report.summary?.failed ?? "-"}`,
      nextAction: "Run node scripts/open-source-readiness.js and fix blocked checks.",
    })),
    stage("ci_readiness", "GitHub Actions CI readiness", reports.ci, (report) => ({
      ready: report.ready === true,
      detail: `ready=${report.ready}; failed=${report.summary?.failed ?? "-"}`,
      nextAction: "Run npm run release:ci:check and fix workflow checks.",
    })),
    stage("cross_platform_package_plan", "Cross-platform package plan", reports.crossPlatform, (report) => ({
      ready: report.ready === true,
      detail: `ready=${report.ready}; failed=${report.summary?.failed ?? "-"}`,
      nextAction: "Run node scripts/cross-platform-package-plan.js and fix target strategy.",
    })),
    stage("release_draft", "Release draft", reports.releaseDraft, (report) => ({
      ready: report.ready === true && Boolean(report.draft),
      detail: `ready=${report.ready}; version=${report.version || "-"}`,
      nextAction: "Run node scripts/release-draft.js after AY evidence is ready.",
    })),
    stage("beta_trial", "Beta trial plan", reports.beta, (report) => ({
      ready: report.ready === true && betaTrialTaskCount(report) >= 10,
      detail: `ready=${report.ready}; tasks=${betaTrialTaskCount(report)}`,
      nextAction: "Run node scripts/beta-trial-plan.js and complete trial script.",
    })),
  ]
  const blocked = stages.filter((item) => item.publicBlocking)
  const summary = {
    total: stages.length,
    ready: stages.length - blocked.length,
    blocked: blocked.length,
    publicBlocking: blocked.length,
  }
  return {
    reportKind: "open-source-candidate-gate",
    createdAt,
    ready: blocked.length === 0,
    status: blocked.length === 0 ? "ready" : "blocked",
    overallGrade: blocked.length === 0 ? "open-source-candidate-ready" : "blocked",
    summary,
    stages,
    publicBlockers: blocked.map((item) => ({ id: item.id, title: item.title, nextAction: item.nextAction })),
    nextActions: blocked.map((item) => ({ id: item.id, title: item.title, action: item.nextAction })),
    scope: {
      pushes: false,
      publishes: false,
      uploadsInstallers: false,
      note: "Aggregates local BA readiness evidence only. It does not push, publish, upload installers, or create a GitHub Release.",
    },
  }
}

function paths(reportDir = defaultReportDir()) {
  const resolved = reportDir || defaultReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "open-source-candidate-latest.json"),
    latestMarkdownPath: path.join(resolved, "open-source-candidate-latest.md"),
    historyDir: path.join(resolved, "history"),
  }
}

function escape(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function toMarkdown(report) {
  const rows = (report.stages || []).map((item) =>
    `| ${escape(item.title)} | ${item.status} | ${escape(item.detail)} | ${escape(item.nextAction || "-")} | ${escape(item.reportPath || "-")} |`,
  )
  return [
    "# Open Source Candidate Gate",
    "",
    `- Grade: ${report.overallGrade}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Created At: ${new Date(report.createdAt).toISOString()}`,
    `- Summary: ${report.summary.ready}/${report.summary.total} ready, blocked=${report.summary.blocked}`,
    "",
    "## Stages",
    "",
    "| Stage | Status | Detail | Next Action | Report |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## Boundaries",
    "",
    "- Does not push, publish, upload installers, or create GitHub Release.",
    "- Requires AY public candidate evidence and BA public delivery evidence.",
  ].join("\n")
}

function save(report, options = {}) {
  const p = paths(options.reportDir)
  fs.mkdirSync(p.reportDir, { recursive: true })
  fs.mkdirSync(p.historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJson = path.join(p.historyDir, `open-source-candidate-${stamp}.json`)
  const historyMd = path.join(p.historyDir, `open-source-candidate-${stamp}.md`)
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
    report: readJson(p.latestJsonPath),
    markdown: fs.existsSync(p.latestMarkdownPath) ? fs.readFileSync(p.latestMarkdownPath, "utf8") : "",
    ...p,
  }
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const reportDirArg = args.find((arg) => arg.startsWith("--report-dir="))
  const noWrite = args.includes("--no-write")
  const reportDir = reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir()
  const report = buildOpenSourceCandidateGate({ reportDir })
  const saved = noWrite ? { latestJsonPath: "", latestMarkdownPath: "" } : save(report, { reportDir })
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    overallGrade: report.overallGrade,
    summary: report.summary,
    publicBlockers: report.publicBlockers,
    jsonPath: saved.latestJsonPath || "",
    markdownPath: saved.latestMarkdownPath || "",
  }, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

module.exports = {
  buildOpenSourceCandidateGate,
  betaTrialTaskCount,
  defaultReportDir,
  readLatest,
  save,
  toMarkdown,
}
