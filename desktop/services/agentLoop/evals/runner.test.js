const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { run, runAsync, runTask } = require("./runner")

test("eval runner attaches strategy comparison to each task", () => {
  const result = runTask({
    id: "small_fix",
    goal: "修复 src/App.vue 文案",
    files: ["src/App.vue"],
    risk: "safe",
    expectedStrategy: "single-agent",
  })

  assert.equal(result.actualStrategy, "single-agent")
  assert.equal(result.recommendedStrategy, "single-agent")
  assert.equal(result.routerAgreement, true)
  assert.equal(result.comparison.scores["single-agent"].strategy, "single-agent")
  assert.equal(result.comparison.scores["multi-agent"].strategy, "multi-agent")
})

test("eval runner writes aggregate strategy comparison", () => {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-eval-tasks-"))
  fs.writeFileSync(path.join(tasksDir, "small.json"), JSON.stringify({
    name: "small",
    goal: "修复 src/App.vue 文案",
    files: ["src/App.vue"],
    risk: "safe",
    expectedStrategy: "single-agent",
  }), "utf8")
  fs.writeFileSync(path.join(tasksDir, "wide.json"), JSON.stringify({
    name: "wide",
    goal: "重构设置 UI、桌面端 settings 服务并运行 typecheck",
    files: ["frontend/src/App.vue", "frontend/src/components/SettingsPanel.vue", "desktop/services/settings/index.js"],
    risk: "medium",
    expectedStrategy: "multi-agent",
  }), "utf8")

  const report = run(tasksDir)

  assert.equal(report.total, 2)
  assert.equal(report.strategyComparison.total, 2)
  assert.equal(report.strategyComparison.recommendedSingleAgent, 1)
  assert.equal(report.strategyComparison.recommendedMultiAgent, 1)
  assert.equal(report.strategyComparison.routerAgreementRate, 100)
})

test("eval runner can include isolated real run comparison explicitly", async () => {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-eval-real-tasks-"))
  fs.writeFileSync(path.join(tasksDir, "real.json"), JSON.stringify({
    name: "real",
    goal: "修改 demo.js 并运行 node --check",
    files: ["demo.js"],
    risk: "safe",
    expectedStrategy: "single-agent",
  }), "utf8")

  const report = await runAsync(tasksDir, { includeRealRuns: true })

  assert.equal(report.total, 1)
  assert.equal(report.realRunComparison.totalTasks, 1)
  assert.equal(report.realRunComparison.totalRuns, 2)
  assert.equal(report.realRunComparison.completedRuns, 2)
  assert.equal(report.results[0].realRunComparison.summary.totalQualityGateFailures, 0)
})

test("eval runner keeps route baseline separate from calibration disagreement", async () => {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-eval-calibration-tasks-"))
  fs.writeFileSync(path.join(tasksDir, "conflict.json"), JSON.stringify({
    name: "conflict",
    goal: "两个实现分支同时修改 demo.js",
    files: ["demo.js"],
    risk: "medium",
    fixtureType: "conflict",
    expectedStrategy: "single-agent",
  }), "utf8")

  const report = await runAsync(tasksDir, { includeRealRuns: true })

  assert.equal(report.failed, 0)
  assert.equal(report.results[0].actualStrategy, "single-agent")
  assert.equal(report.routerCalibration.conflictTasks, 1)
  assert.equal(report.routerCalibration.suggestions["increase-conflict-penalty"], 1)
  assert.equal(report.routerShadowEval.total, 1)
  assert.equal(typeof report.routerShadowEval.recommendation, "string")
})
