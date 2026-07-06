const { runAcceptance, saveAcceptanceReport } = require("../desktop/services/agentLoop/evals/realProjectAcceptance")

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const taskSetArg = argv.find((arg) => arg.startsWith("--task-set="))
  const scenarioArg = argv.find((arg) => arg.startsWith("--scenario="))
  return {
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : undefined,
    taskSet: taskSetArg ? taskSetArg.slice("--task-set=".length) : undefined,
    scenario: scenarioArg ? scenarioArg.slice("--scenario=".length) : undefined,
    noWrite: argv.includes("--no-write"),
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = await runAcceptance({
    reportDir: options.reportDir,
    taskSet: options.taskSet,
    scenario: options.scenario,
    writeLatest: false,
  })
  const saved = options.noWrite ? null : saveAcceptanceReport(report, { reportDir: options.reportDir })
  process.stdout.write(`${JSON.stringify({
    ok: report.ready,
    taskSet: report.taskSet,
    scenario: report.scenario,
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    runId: report.run?.id,
    strategy: report.run?.executionStrategy,
    routerRecommendation: report.routerData?.recommendation || null,
    longTaskReady: report.longTask?.ready ?? null,
    deliveryTrustScore: report.longTask?.deliveryTrust?.score ?? null,
    deliveryTrustStatus: report.longTask?.deliveryTrust?.status || null,
    nextAction: report.longTask?.deliveryTrust?.nextAction || null,
    longTaskChecks: report.longTask?.checks?.length ?? null,
    markdownPath: saved?.markdownPath || null,
    jsonPath: saved?.jsonPath || null,
    longTaskMarkdownPath: saved?.longTaskMarkdownPath || null,
  }, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`)
  process.exit(1)
})
