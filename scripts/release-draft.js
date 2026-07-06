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

function rel(filePath) {
  return path.relative(root, filePath)
}

function artifactSummary(reportDir, options = {}) {
  const packageArtifacts = readJson(path.join(reportDir, "package-artifacts-latest.json"))
  const ayGate = readJson(path.join(reportDir, "ay-public-candidate-gate-latest.json"))
  const releaseGate = readJson(path.join(reportDir, "release-gate-latest.json"))
  const releaseGateSteps = Array.isArray(releaseGate?.steps) ? releaseGate.steps : []
  const livePassedStepIds = Array.isArray(options.passedStepIds) ? options.passedStepIds : []
  const releaseGatePassedStepIds = new Set([
    ...releaseGateSteps.filter((step) => step?.passed).map((step) => step.id),
    ...livePassedStepIds,
  ].filter(Boolean))
  const draftPrerequisitesPassed = [
    "typecheck",
    "i_j_smoke_tests",
    "smoke_j",
    "real_workspace_trial_smoke",
    "build",
    "ba_clean_clone_doctor",
    "ba_open_source_readiness",
    "ba_ci_readiness",
    "ba_cross_platform_package_plan",
  ].every((id) => releaseGatePassedStepIds.has(id))
  return {
    packageArtifactsReady: packageArtifacts?.ready === true,
    ayReady: ayGate?.ready === true,
    ayGrade: ayGate?.overallGrade || "",
    releaseGateReady: releaseGate?.ready === true,
    releaseGateStatus: releaseGate?.ready === true ? "ready" : draftPrerequisitesPassed ? "in_progress_prerequisites_passed" : "not_ready",
    draftPrerequisitesPassed,
    installerCount: Array.isArray(packageArtifacts?.artifacts)
      ? packageArtifacts.artifacts.filter((item) => item.kind === "installer").length
      : 0,
    portableCount: Array.isArray(packageArtifacts?.artifacts)
      ? packageArtifacts.artifacts.filter((item) => item.kind === "portable" || String(item.path || "").includes("win-unpacked")).length
      : 0,
  }
}

function buildReleaseDraft(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const reportDir = input.reportDir || defaultReportDir()
  const version = input.version || (readJson(path.join(root, "package.json")) || {}).version || "0.0.0"
  const artifacts = artifactSummary(reportDir, { passedStepIds: input.passedStepIds })
  const releaseGateAcceptable = artifacts.releaseGateReady || (input.gateInProgress === true && artifacts.draftPrerequisitesPassed)
  const checks = [
    { id: "ay_gate", passed: artifacts.ayReady, detail: `grade=${artifacts.ayGrade || "-"}` },
    {
      id: "release_gate",
      passed: releaseGateAcceptable,
      detail: `ready=${artifacts.releaseGateReady}; status=${artifacts.releaseGateStatus}`,
    },
    { id: "package_artifacts", passed: artifacts.packageArtifactsReady, detail: `installer=${artifacts.installerCount}; portable=${artifacts.portableCount}` },
  ].map((item) => ({
    ...item,
    status: item.passed ? "passed" : "failed",
    nextAction: item.passed ? "" : "Run AY public candidate gate and package artifact checks before drafting a release.",
  }))
  const failed = checks.filter((item) => !item.passed)
  const releaseName = `Codek ${version} Open Source Candidate`
  const markdown = [
    `# ${releaseName}`,
    "",
    "> Draft only. Do not publish until the maintainer authorizes GitHub Release upload, signing, and distribution.",
    "",
    "## Summary",
    "",
    "- Codek desktop workbench with VS Code-style editing surfaces and autonomous multi-agent orchestration.",
    "- Proposal-only task execution remains the default safety boundary before Accept.",
    "- Public candidate evidence should be regenerated on the release machine before upload.",
    "",
    "## Artifacts To Attach",
    "",
    "- Windows installer: `desktop/release/Codek-Setup-${version}-x64.exe`",
    "- Windows portable candidate: `desktop/release/win-unpacked/Codek.exe` or zipped `win-unpacked` directory",
    "- SHA256 checksums from `package-artifacts-latest.json`",
    "",
    "## Verification Required Before Publish",
    "",
    "- `npm run release:gate -- --open-source-candidate --report-dir=.codek/reports`",
    "- `npm run smoke:packaged:report -- --report-dir=.codek/reports`",
    "- `npm run smoke:packaged:multi-agent -- --report-dir=.codek/reports`",
    "- Manual Beta trial from `docs/BETA_TRIAL.md`",
    "",
    "## Rollback",
    "",
    "- Remove or mark the draft release as pre-release if artifacts fail post-upload verification.",
    "- Keep the previous release available until the new installer passes startup and Beta smoke.",
    "- Tell users how to clear `%APPDATA%/Codek` only when they need a clean profile.",
    "",
    "## Signing And Distribution",
    "",
    "- Windows signing is not automatic in BA and requires maintainer authorization.",
    "- macOS notarization requires Apple Developer ID authorization.",
    "- Do not upload telemetry or private local reports.",
  ].join("\n")

  return {
    reportKind: "release-draft",
    createdAt,
    ready: failed.length === 0,
    status: failed.length === 0 ? "ready" : "blocked",
    statusLabel: failed.length === 0 ? "Release draft ready" : "Release draft blocked",
    version,
    releaseName,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      warning: 0,
      failed: failed.length,
    },
    checks,
    draft: markdown,
    evidence: {
      reportDir: rel(reportDir),
      gateInProgress: input.gateInProgress === true,
      artifacts,
    },
    nextActions: failed.map((item) => ({ id: item.id, action: item.nextAction })),
  }
}

function paths(reportDir = defaultReportDir()) {
  const resolved = reportDir || defaultReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "release-draft-latest.json"),
    latestMarkdownPath: path.join(resolved, "release-draft-latest.md"),
    historyDir: path.join(resolved, "history"),
  }
}

function save(report, options = {}) {
  const p = paths(options.reportDir)
  fs.mkdirSync(p.reportDir, { recursive: true })
  fs.mkdirSync(p.historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJson = path.join(p.historyDir, `release-draft-${stamp}.json`)
  const historyMd = path.join(p.historyDir, `release-draft-${stamp}.md`)
  fs.writeFileSync(p.latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(p.latestMarkdownPath, `${report.draft}\n`, "utf8")
  fs.writeFileSync(historyJson, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMd, `${report.draft}\n`, "utf8")
  return { ...p, historyJson, historyMd, markdown: report.draft }
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
  const gateInProgress = args.includes("--gate-in-progress")
  const passedStepIdsArg = args.find((arg) => arg.startsWith("--passed-step-ids="))
  const passedStepIds = passedStepIdsArg
    ? passedStepIdsArg.slice("--passed-step-ids=".length).split(",").map((id) => id.trim()).filter(Boolean)
    : []
  const reportDir = reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir()
  const report = buildReleaseDraft({ reportDir, gateInProgress, passedStepIds })
  const saved = noWrite ? { latestJsonPath: "", latestMarkdownPath: "" } : save(report, { reportDir })
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
  buildReleaseDraft,
  defaultReportDir,
  readLatest,
  save,
}
