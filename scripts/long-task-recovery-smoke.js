#!/usr/bin/env node

const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const orchestrator = require("../desktop/services/agentLoop/orchestrator")
const artifactStore = require("../desktop/services/agentLoop/artifactStore")

const root = path.resolve(__dirname, "..")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  return {
    noWrite: argv.includes("--no-write"),
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
  }
}

function check(id, passed, detail = "") {
  return { id, passed: Boolean(passed), detail }
}

function saveReport(report, reportDir) {
  fs.mkdirSync(reportDir, { recursive: true })
  const stamp = new Date(report.createdAt).toISOString().replace(/[:.]/g, "-")
  const jsonPath = path.join(reportDir, `long-task-recovery-smoke-${stamp}.json`)
  const markdownPath = path.join(reportDir, `long-task-recovery-smoke-${stamp}.md`)
  const latestJsonPath = path.join(reportDir, "long-task-recovery-smoke-latest.json")
  const latestMarkdownPath = path.join(reportDir, "long-task-recovery-smoke-latest.md")
  const withPaths = { ...report, jsonPath, markdownPath, latestJsonPath, latestMarkdownPath }
  fs.writeFileSync(jsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(markdownPath, toMarkdown(withPaths), "utf8")
  fs.writeFileSync(latestMarkdownPath, toMarkdown(withPaths), "utf8")
  return withPaths
}

function toMarkdown(report) {
  return [
    "# Long Task Recovery Smoke",
    "",
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Status: ${report.status}`,
    `- Run: ${report.runId}`,
    `- Crash run: ${report.crashRunId}`,
    "",
    "## Checks",
    "",
    "| Check | Status | Detail |",
    "| --- | --- | --- |",
    ...report.checks.map((item) => `| ${item.id} | ${item.passed ? "passed" : "failed"} | ${String(item.detail || "").replace(/\|/g, "/")} |`),
    "",
  ].join("\n")
}

async function runSmoke(options = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-long-task-recovery-"))
  const dbPath = path.join(projectRoot, ".codek", "orchestrator.db")
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  orchestrator.reset()
  orchestrator.configureStore({ dbPath })

  const run = orchestrator.createRun({
    projectRoot,
    visibleMode: "agent",
    userInput: "enterprise long task recovery smoke",
  })
  const mutable = orchestrator._unsafeGetMutableRunForTest(run.id)
  mutable.status = "running"
  mutable.summary = "background long task is running"
  mutable.plan = {
    id: "plan_long_task_smoke",
    phases: [{ id: "phase_1", name: "long task", status: "running", tasks: [{ description: "simulate long work" }] }],
  }
  mutable.assignments = [{
    id: "assignment_1",
    runId: run.id,
    phaseId: "phase_1",
    role: "implementer",
    status: "running",
    lockedFiles: ["src/demo.ts"],
    workspace: { id: "workspace_1", isolation: "snapshot", root: projectRoot },
  }]

  const paused = orchestrator.pauseRun(run.id, "smoke paused long task")
  orchestrator.reset()
  orchestrator.configureStore({ dbPath })
  const hydratedPaused = orchestrator.hydrateFromStore().find((item) => item.id === run.id)
  const resumed = orchestrator.resumeRunFromCheckpoint(run.id)

  const crashRun = orchestrator.createRun({
    projectRoot,
    visibleMode: "agent",
    userInput: "enterprise crash recovery smoke",
  })
  const crashMutable = orchestrator._unsafeGetMutableRunForTest(crashRun.id)
  crashMutable.status = "running"
  crashMutable.summary = "simulated crash while running"
  crashMutable.plan = {
    id: "plan_crash_smoke",
    phases: [{ id: "phase_crash", name: "crash phase", status: "running", tasks: [{ description: "simulate crash" }] }],
  }
  crashMutable.assignments = [{
    id: "assignment_crash",
    runId: crashRun.id,
    phaseId: "phase_crash",
    role: "implementer",
    status: "running",
    lockedFiles: ["src/crash.ts"],
  }]
  orchestrator.configureStore({ dbPath }).saveRun(crashMutable)
  orchestrator.reset()
  orchestrator.configureStore({ dbPath })
  orchestrator.hydrateFromStore()
  const recoveredCrash = orchestrator.getRun(crashRun.id)
  const retry = orchestrator.createRecoveryAction(crashRun.id, {
    action: "retry",
    assignmentId: "assignment_crash",
    phaseId: "phase_crash",
    reason: "smoke retry after crash interruption",
  })
  const retryResult = orchestrator.executeRecoveryAction(crashRun.id, retry.id)
  const report = {
    reportKind: "long-task-recovery-smoke",
    createdAt: Date.now(),
    runId: run.id,
    crashRunId: crashRun.id,
    dbPath,
    checks: [
      check("background_run_persisted", Boolean(paused?.run?.id), paused?.run?.status || ""),
      check("pause_saved_resumable_checkpoint", paused?.checkpoint?.canResume === true && paused?.run?.status === "paused", paused?.checkpoint?.id || ""),
      check("reopen_hydrates_paused_run", hydratedPaused?.status === "paused", hydratedPaused?.status || ""),
      check("resume_restores_previous_runtime_state", resumed?.resumed === true && resumed?.run?.status === "running", resumed?.run?.status || ""),
      check("crash_marks_interrupted_failed", recoveredCrash?.status === "failed" && recoveredCrash?.recoveryRecommendation?.action === "retry", recoveredCrash?.summary || ""),
      check("crash_recovery_artifact_written", artifactStore.listArtifacts(crashRun.id, { type: "recovery" }).length >= 1, String(artifactStore.listArtifacts(crashRun.id, { type: "recovery" }).length)),
      check("recovery_action_retry_executable", retryResult?.action?.status === "completed" && retryResult?.run?.status === "running", retryResult?.run?.status || ""),
    ],
  }
  report.ready = report.checks.every((item) => item.passed)
  report.status = report.ready ? "ready" : "blocked"
  return options.noWrite ? report : saveReport(report, options.reportDir || defaultReportDir())
}

async function main() {
  const report = await runSmoke(parseArgs(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`)
    process.exit(1)
  })
}

module.exports = {
  parseArgs,
  runSmoke,
}
