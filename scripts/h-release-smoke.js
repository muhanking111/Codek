const path = require("node:path")

const {
  defaultAcceptanceReportDir,
  runAcceptance,
  saveAcceptanceReport,
} = require("../desktop/services/agentLoop/evals/realProjectAcceptance")

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  return {
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultAcceptanceReportDir(),
    noWrite: argv.includes("--no-write"),
  }
}

function warningCatalog() {
  return [
    {
      id: "sqlite_experimental_warning",
      severity: "non_blocking",
      source: "Node.js test runner",
      note: "Node SQLite experimental warning，不影响 H 线 smoke 判定。",
    },
    {
      id: "vite_chunk_size_warning",
      severity: "non_blocking",
      source: "Vite build",
      note: "资源分包体积提示，build 退出码为 0 时记录为优化项。",
    },
    {
      id: "electron_dev_csp_warning",
      severity: "non_blocking",
      source: "Electron devtools",
      note: "开发态 CSP 提示，发布候选 smoke 只在失败退出码时阻断。",
    },
  ]
}

async function runReleaseSmoke(options) {
  const standard = await runAcceptance({
    taskSet: "standard",
    scenario: "acceptance",
    reportDir: options.reportDir,
    writeLatest: false,
  })
  const longTask = await runAcceptance({
    taskSet: "risk",
    scenario: "long-task",
    reportDir: options.reportDir,
    writeLatest: false,
  })
  const report = {
    createdAt: Date.now(),
    reportDir: path.resolve(options.reportDir),
    ready: Boolean(standard.ready && longTask.ready && longTask.longTask?.ready),
    standard: {
      ready: standard.ready,
      taskSet: standard.taskSet,
      total: standard.total,
      passed: standard.passed,
      failed: standard.failed,
      matrix: {
        total: standard.matrix?.total || 0,
        passed: standard.matrix?.passed || 0,
        failed: standard.matrix?.failed || 0,
      },
      permissionRecorded: standard.decisionSummary?.permissionRecorded === true,
    },
    longTask: {
      ready: longTask.ready,
      taskSet: longTask.taskSet,
      scenario: longTask.scenario,
      trialReady: longTask.longTask?.ready === true,
      phaseCount: longTask.longTask?.run?.phaseCount || 0,
      assignmentCount: longTask.longTask?.run?.assignmentCount || 0,
    },
    warnings: warningCatalog(),
  }
  if (!options.noWrite) {
    const saved = saveAcceptanceReport(standard, { reportDir: options.reportDir })
    report.standard.markdownPath = saved.markdownPath
    report.standard.jsonPath = saved.jsonPath
  }
  return report
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = await runReleaseSmoke(options)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err?.stack || err}\n`)
    process.exit(1)
  })
}

module.exports = {
  runReleaseSmoke,
  warningCatalog,
}
