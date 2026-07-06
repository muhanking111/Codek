#!/usr/bin/env node

const releaseGate = require("./release-gate")

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const modeArg = argv.find((arg) => arg.startsWith("--mode="))
  const completedArg = argv.find((arg) => arg.startsWith("--completed="))
  return {
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : releaseGate.defaultReportDir(),
    mode: modeArg ? modeArg.slice("--mode=".length) : "current",
    completed: completedArg ? completedArg.slice("--completed=".length).split(",").filter(Boolean) : [],
  }
}

function buildCurrentSnapshot(options = {}) {
  const completed = Array.isArray(options.completed) ? options.completed : []
  return {
    createdAt: Date.now(),
    mode: options.mode || "current",
    ready: true,
    upstreamReady: true,
    status: "upstream-ready",
    durationMs: 0,
    plannedSteps: completed,
    steps: completed.map((id) => ({
      id,
      label: id,
      command: "",
      cwd: "",
      exitCode: 0,
      passed: true,
      durationMs: 0,
      error: "",
    })),
    warnings: [{
      id: "current_run_snapshot",
      severity: "info",
      note: "这是 release gate 当前运行的上游步骤快照；最终 release-gate-latest 会在整条门禁结束后覆盖。",
    }],
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = buildCurrentSnapshot(options)
  const jsonPath = releaseGate.saveReport(report, options.reportDir)
  process.stdout.write(`${JSON.stringify({
    reportKind: "release-gate-current-snapshot",
    ready: report.ready,
    upstreamReady: report.upstreamReady,
    mode: report.mode,
    completed: report.plannedSteps.length,
    jsonPath,
  }, null, 2)}\n`)
}

if (require.main === module) {
  main()
}

module.exports = {
  buildCurrentSnapshot,
  parseArgs,
}
