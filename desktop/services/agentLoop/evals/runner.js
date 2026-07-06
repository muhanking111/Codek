const fs = require("node:fs")
const path = require("node:path")
const { chooseAgentStrategy } = require("../agentRouter")
const { saveLatestReport } = require("./reportStore")
const { compareTaskStrategies, summarizeStrategyComparisons } = require("./strategyComparison")
const { runTaskRealComparison, summarizeTaskRealComparisons } = require("./realRunComparison")
const { summarizeRouterCalibration } = require("./routerCalibration")
const { summarizeRouterShadowEval } = require("./routerShadowEval")

function loadTasks(tasksDir) {
  const dir = tasksDir || path.resolve(process.cwd(), "evals", "multi-agent", "tasks")
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const fullPath = path.join(dir, file)
      return { id: path.basename(file, ".json"), ...JSON.parse(fs.readFileSync(fullPath, "utf8")) }
    })
}

function runTask(task) {
  const decision = chooseAgentStrategy({
    visibleMode: task.visibleMode || "agent",
    text: task.prompt || task.goal || "",
    files: task.files || [],
    risk: task.risk,
  })
  const comparison = compareTaskStrategies(task, decision)
  const passed = !task.expectedStrategy || decision.executionStrategy === task.expectedStrategy
  return {
    id: task.id,
    name: task.name || task.id,
    expectedStrategy: task.expectedStrategy || null,
    actualStrategy: decision.executionStrategy,
    recommendedStrategy: comparison.recommendedStrategy,
    routerAgreement: comparison.routerAgreement,
    passed,
    reason: decision.reason,
    fileCount: decision.signals?.fileCount || 0,
    comparison,
  }
}

async function runAsync(tasksDir, options = {}) {
  const tasks = loadTasks(tasksDir)
  const results = tasks.map(runTask)
  if (options.includeRealRuns) {
    for (const result of results) {
      const task = tasks.find((item) => item.id === result.id)
      result.realRunComparison = await runTaskRealComparison(task)
    }
  }
  const passed = results.filter((item) => item.passed).length
  const routerCalibration = options.includeRealRuns ? summarizeRouterCalibration(results) : null
  const report = {
    createdAt: Date.now(),
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
    strategyComparison: summarizeStrategyComparisons(results.map((item) => item.comparison)),
    realRunComparison: options.includeRealRuns
      ? summarizeTaskRealComparisons(results.map((item) => item.realRunComparison))
      : null,
    routerCalibration,
    routerShadowEval: options.includeRealRuns ? summarizeRouterShadowEval(results, routerCalibration) : null,
  }
  if (options.writeLatest) {
    saveLatestReport(report, { reportDir: options.reportDir })
  }
  return report
}

function run(tasksDir, options = {}) {
  if (options.includeRealRuns) {
    throw new Error("includeRealRuns requires runAsync")
  }
  const tasks = loadTasks(tasksDir)
  const results = tasks.map(runTask)
  const passed = results.filter((item) => item.passed).length
  const report = {
    createdAt: Date.now(),
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
    strategyComparison: summarizeStrategyComparisons(results.map((item) => item.comparison)),
    realRunComparison: null,
    routerCalibration: null,
    routerShadowEval: null,
  }
  if (options.writeLatest) {
    saveLatestReport(report, { reportDir: options.reportDir })
  }
  return report
}

if (require.main === module) {
  ;(async () => {
    const writeLatest = process.argv.includes("--write-latest")
    const includeRealRuns = process.argv.includes("--real-runs")
    const reportDirArg = process.argv.find((arg) => arg.startsWith("--report-dir="))
    const reportDir = reportDirArg ? reportDirArg.slice("--report-dir=".length) : undefined
    const tasksDir = process.argv.find((arg) => !arg.startsWith("--") && arg !== process.argv[0] && arg !== process.argv[1])
    const report = includeRealRuns
      ? await runAsync(tasksDir, { writeLatest, reportDir, includeRealRuns })
      : run(tasksDir, { writeLatest, reportDir })
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    process.exit(report.failed === 0 ? 0 : 1)
  })().catch((err) => {
    process.stderr.write(`${err?.stack || err}\n`)
    process.exit(1)
  })
}

module.exports = {
  loadTasks,
  runTask,
  runAsync,
  run,
}
