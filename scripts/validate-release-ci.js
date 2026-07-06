const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const defaultReleaseEvidenceMaxAgeMs = 24 * 60 * 60 * 1000

function defaultWorkflowPath() {
  return path.join(root, ".github", "workflows", "release-gate.yml")
}

function defaultOpenSourceWorkflowPath() {
  return path.join(root, ".github", "workflows", "open-source-candidate.yml")
}

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function defaultReleaseEvidencePath() {
  return path.join(root, ".codek", "reports", "release-evidence-latest.json")
}

function makeCheck(id, label, passed, detail = "") {
  return {
    id,
    label,
    passed: Boolean(passed),
    detail,
  }
}

function makeWarning(id, label, detail = "") {
  return {
    id,
    label,
    detail,
    severity: "warning",
  }
}

function formatDurationMs(value) {
  const ms = Math.max(0, Number(value || 0))
  const hours = Math.floor(ms / (60 * 60 * 1000))
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const restHours = hours % 24
    return restHours > 0 ? `${days} 天 ${restHours} 小时` : `${days} 天`
  }
  if (hours > 0) return `${hours} 小时`
  const minutes = Math.floor(ms / (60 * 1000))
  return `${minutes} 分钟`
}

function readReleaseEvidenceLatest(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      exists: false,
      report: null,
      error: "",
    }
  }
  try {
    return {
      exists: true,
      report: JSON.parse(fs.readFileSync(filePath, "utf8")),
      error: "",
    }
  } catch (error) {
    return {
      exists: true,
      report: null,
      error: error && error.message ? error.message : String(error),
    }
  }
}

function validateReleaseEvidenceLatest(options = {}) {
  const evidencePath = options.releaseEvidencePath || defaultReleaseEvidencePath()
  const required = options.releaseEvidenceRequired === true
  const requireFresh = options.requireFreshReleaseEvidence === true || options.requireFresh === true
  const maxAgeMs = Number(options.maxAgeMs || defaultReleaseEvidenceMaxAgeMs)
  const now = Number(options.now || Date.now())
  const latest = readReleaseEvidenceLatest(evidencePath)
  const checks = []
  const warnings = []

  if (!latest.exists) {
    warnings.push(makeWarning(
      "release_evidence_latest_missing",
      "release evidence latest is not present",
      `${evidencePath}；发布前建议先在“发布与验收”导出证据链。`,
    ))
    return {
      ok: !required,
      evidencePath,
      exists: false,
      createdAt: 0,
      ageMs: 0,
      maxAgeMs,
      fresh: false,
      checks,
      warnings,
    }
  }

  checks.push(makeCheck("release_evidence_json_parse", "release evidence latest JSON parses", !latest.error, latest.error || evidencePath))
  const report = latest.report || {}
  checks.push(makeCheck("release_evidence_kind", "release evidence reportKind is valid", report.reportKind === "release-evidence", String(report.reportKind || "")))
  checks.push(makeCheck("release_evidence_created_at", "release evidence createdAt is valid", Number(report.createdAt || 0) > 0, String(report.createdAt || "")))
  checks.push(makeCheck("release_evidence_summary", "release evidence summary is valid", Boolean(report.summary) && Number(report.summary.total || 0) > 0 && Number(report.summary.available || 0) >= 0 && Number(report.summary.ready || 0) >= 0, JSON.stringify(report.summary || {})))
  checks.push(makeCheck("release_evidence_sections", "release evidence sections are present", Boolean(report.evidence && typeof report.evidence === "object"), report.evidence ? Object.keys(report.evidence).join(",") : ""))
  const createdAt = Number(report.createdAt || 0)
  const ageMs = createdAt > 0 ? Math.max(0, now - createdAt) : 0
  const fresh = createdAt > 0 && ageMs <= maxAgeMs
  if (createdAt > 0 && !fresh) {
    warnings.push(makeWarning(
      "release_evidence_latest_stale",
      "release evidence latest may be stale",
      `生成时间 ${new Date(createdAt).toISOString()}，距今 ${formatDurationMs(ageMs)}；建议发布前重新导出证据链。`,
    ))
  }
  checks.push(makeCheck(
    "release_evidence_fresh",
    "release evidence latest is fresh",
    !requireFresh || fresh,
    createdAt > 0 ? `age=${formatDurationMs(ageMs)}, max=${formatDurationMs(maxAgeMs)}` : "createdAt missing",
  ))

  return {
    ok: checks.every((check) => check.passed),
    evidencePath,
    exists: true,
    createdAt,
    ageMs,
    maxAgeMs,
    fresh,
    checks,
    warnings,
  }
}

function workflowContent(filePath) {
  const exists = fs.existsSync(filePath)
  return {
    exists,
    content: exists ? fs.readFileSync(filePath, "utf8") : "",
  }
}

function validateReleaseCiWorkflow(options = {}) {
  const workflowPath = options.workflowPath || defaultWorkflowPath()
  const openSourceWorkflowPath = options.openSourceWorkflowPath || defaultOpenSourceWorkflowPath()
  const releaseWorkflow = workflowContent(workflowPath)
  const openSourceWorkflow = workflowContent(openSourceWorkflowPath)
  const content = releaseWorkflow.content
  const openSourceContent = openSourceWorkflow.content
  const checks = [
    makeCheck("workflow_exists", "release gate workflow exists", releaseWorkflow.exists, workflowPath),
    makeCheck("pull_request_trigger", "pull_request trigger is configured", /\bpull_request\s*:/.test(content) || /\bon\s*:\s*\[[^\]]*pull_request/.test(content)),
    makeCheck("push_trigger", "push trigger is configured", /\bpush\s*:/.test(content) || /\bon\s*:\s*\[[^\]]*push/.test(content)),
    makeCheck("workflow_dispatch_trigger", "workflow_dispatch trigger is configured", /\bworkflow_dispatch\s*:/.test(content) || /\bon\s*:\s*\[[^\]]*workflow_dispatch/.test(content)),
    makeCheck("npm_ci", "npm ci is used for deterministic install", /\bnpm\s+ci\b/.test(content)),
    makeCheck(
      "include_build_gate",
      "CI runs release gate with build mode",
      /npm\s+run\s+release:gate\s+--\s+--include-build\s+--no-write/.test(content),
    ),
    makeCheck("no_full_mode", "CI does not run Electron full smoke by default", !content.includes("--full")),
    makeCheck("open_source_workflow_exists", "open-source candidate workflow exists", openSourceWorkflow.exists, openSourceWorkflowPath),
    makeCheck("open_source_matrix", "open-source workflow uses OS matrix", /strategy\s*:[\s\S]*matrix\s*:[\s\S]*os\s*:/.test(openSourceContent)),
    makeCheck("open_source_windows_job", "open-source workflow includes Windows", /windows-latest/.test(openSourceContent)),
    makeCheck("open_source_macos_job", "open-source workflow includes macOS", /macos-latest/.test(openSourceContent)),
    makeCheck("open_source_linux_job", "open-source workflow includes Linux", /ubuntu-latest/.test(openSourceContent)),
    makeCheck("open_source_readiness_step", "open-source workflow checks public readiness", /npm\s+run\s+ba:open-source-readiness\s+--\s+--no-write/.test(openSourceContent)),
    makeCheck("open_source_package_plan_step", "open-source workflow checks package strategy", /npm\s+run\s+ba:cross-platform-package-plan\s+--\s+--no-write/.test(openSourceContent)),
    makeCheck("open_source_unit_tests", "open-source workflow runs BA unit tests", /node\s+--test[\s\S]*open-source-readiness\.test\.js[\s\S]*open-source-candidate-gate\.test\.js/.test(openSourceContent)),
    makeCheck("open_source_build_gate", "open-source workflow runs CI-safe release gate", /npm\s+run\s+release:gate\s+--\s+--include-build\s+--no-write/.test(openSourceContent)),
  ]
  const releaseEvidence = validateReleaseEvidenceLatest({
    releaseEvidencePath: options.releaseEvidencePath,
    releaseEvidenceRequired: options.releaseEvidenceRequired,
    requireFreshReleaseEvidence: options.requireFreshReleaseEvidence,
    maxAgeMs: options.releaseEvidenceMaxAgeMs,
    now: options.now,
  })
  return {
    ok: checks.every((check) => check.passed) && releaseEvidence.ok,
    ready: checks.every((check) => check.passed) && releaseEvidence.ok,
    reportKind: "release-ci-readiness",
    createdAt: Number(options.now || Date.now()),
    workflowPath,
    openSourceWorkflowPath,
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.passed).length,
      failed: checks.filter((check) => !check.passed).length,
      warning: releaseEvidence.warnings.length,
    },
    releaseEvidence,
    checks,
    warnings: releaseEvidence.warnings,
  }
}

function saveReport(report, options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  fs.mkdirSync(reportDir, { recursive: true })
  fs.mkdirSync(path.join(reportDir, "history"), { recursive: true })
  const latestJsonPath = path.join(reportDir, "release-ci-readiness-latest.json")
  const latestMarkdownPath = path.join(reportDir, "release-ci-readiness-latest.md")
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJson = path.join(reportDir, "history", `release-ci-readiness-${stamp}.json`)
  const historyMd = path.join(reportDir, "history", `release-ci-readiness-${stamp}.md`)
  const rows = report.checks.map((check) => `| ${check.label} | ${check.passed ? "passed" : "failed"} | ${String(check.detail || "").replace(/\|/g, "\\|")} |`)
  const md = [
    "# Release CI Readiness",
    "",
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Summary: ${report.summary.passed}/${report.summary.total} passed, failed=${report.summary.failed}, warning=${report.summary.warning}`,
    "",
    "| Check | Status | Detail |",
    "| --- | --- | --- |",
    ...rows,
  ].join("\n")
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestMarkdownPath, `${md}\n`, "utf8")
  fs.writeFileSync(historyJson, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMd, `${md}\n`, "utf8")
  return { latestJsonPath, latestMarkdownPath, historyJson, historyMd }
}

function main() {
  const workflowArg = process.argv.find((arg) => arg.startsWith("--workflow="))
  const openSourceWorkflowArg = process.argv.find((arg) => arg.startsWith("--open-source-workflow="))
  const releaseEvidenceArg = process.argv.find((arg) => arg.startsWith("--release-evidence="))
  const releaseEvidenceMaxAgeArg = process.argv.find((arg) => arg.startsWith("--release-evidence-max-age-ms="))
  const reportDirArg = process.argv.find((arg) => arg.startsWith("--report-dir="))
  const noWrite = process.argv.includes("--no-write")
  const releaseEvidenceRequired = Boolean(releaseEvidenceArg)
  const result = validateReleaseCiWorkflow({
    workflowPath: workflowArg ? workflowArg.slice("--workflow=".length) : undefined,
    openSourceWorkflowPath: openSourceWorkflowArg ? openSourceWorkflowArg.slice("--open-source-workflow=".length) : undefined,
    releaseEvidencePath: releaseEvidenceArg ? releaseEvidenceArg.slice("--release-evidence=".length) : undefined,
    releaseEvidenceRequired,
    requireFreshReleaseEvidence: process.argv.includes("--require-fresh-release-evidence"),
    releaseEvidenceMaxAgeMs: releaseEvidenceMaxAgeArg ? Number(releaseEvidenceMaxAgeArg.slice("--release-evidence-max-age-ms=".length)) : undefined,
  })
  const saved = noWrite ? {} : saveReport(result, {
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : undefined,
  })
  process.stdout.write(`${JSON.stringify({ ...result, ...saved }, null, 2)}\n`)
  process.exit(result.ok ? 0 : 1)
}

if (require.main === module) {
  main()
}

module.exports = {
  defaultReleaseEvidenceMaxAgeMs,
  defaultReleaseEvidencePath,
  defaultOpenSourceWorkflowPath,
  defaultReportDir,
  defaultWorkflowPath,
  saveReport,
  validateReleaseEvidenceLatest,
  validateReleaseCiWorkflow,
}
