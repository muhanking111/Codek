const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const orchestrator = require("../orchestrator")
const {
  createFixtureProject,
  createPlanForTask,
  runStrategyFixture,
  runTaskRealComparison,
  summarizeTaskRealComparisons,
  fixtureType,
} = require("./realRunComparison")

test("real run fixture project is created inside temp dir", () => {
  const root = createFixtureProject({ id: "fixture" }, "single-agent")

  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
  assert.ok(fs.existsSync(path.join(root, "demo.js")))
  assert.ok(fs.existsSync(path.join(root, "package.json")))
})

test("real run fixture plan has different shapes per strategy", () => {
  const single = createPlanForTask({ id: "task", goal: "修改 demo.js" }, "single-agent")
  const multi = createPlanForTask({ id: "task", goal: "修改 demo.js" }, "multi-agent")

  assert.equal(single.phases.length, 1)
  assert.equal(multi.phases.length, 3)
  assert.equal(multi.phases[1].dependsOn[0], "phase_plan")
})

test("multi-file fixture creates src files and multi-phase plan", () => {
  const root = createFixtureProject({ id: "multi", fixtureType: "multi-file" }, "multi-agent")
  const plan = createPlanForTask({ id: "multi", fixtureType: "multi-file", goal: "多文件修改" }, "multi-agent")

  assert.equal(fixtureType({ fixtureType: "multi-file" }), "multi-file")
  assert.ok(fs.existsSync(path.join(root, "src", "app.js")))
  assert.ok(fs.existsSync(path.join(root, "src", "state.js")))
  assert.ok(fs.existsSync(path.join(root, "src", "view.js")))
  assert.equal(plan.phases.length, 5)
})

test("refactor-flow fixture creates layered src files and multi-phase plan", () => {
  const root = createFixtureProject({ id: "refactor", fixtureType: "refactor-flow" }, "multi-agent")
  const plan = createPlanForTask({ id: "refactor", fixtureType: "refactor-flow", goal: "重构模型和服务入口" }, "multi-agent")

  assert.equal(fixtureType({ fixtureType: "refactor-flow" }), "refactor-flow")
  assert.ok(fs.existsSync(path.join(root, "src", "model.js")))
  assert.ok(fs.existsSync(path.join(root, "src", "service.js")))
  assert.ok(fs.existsSync(path.join(root, "src", "app.js")))
  assert.equal(plan.phases.length, 5)
  assert.deepEqual(plan.phases.map((phase) => phase.id), ["phase_plan", "phase_model", "phase_service", "phase_app", "phase_verify"])
})

test("enterprise fixtures cover dependency upgrade, cross-language, and extension conflict shapes", () => {
  const dependencyRoot = createFixtureProject({ id: "dependency", fixtureType: "dependency-upgrade" }, "multi-agent")
  const crossLanguageRoot = createFixtureProject({ id: "cross", fixtureType: "cross-language" }, "multi-agent")
  const extensionConflictRoot = createFixtureProject({ id: "extension_conflict", fixtureType: "extension-conflict" }, "multi-agent")
  const dependencyPlan = createPlanForTask({ id: "dependency", fixtureType: "dependency-upgrade", goal: "升级依赖并验证兼容" }, "multi-agent")
  const crossLanguagePlan = createPlanForTask({ id: "cross", fixtureType: "cross-language", goal: "同步 JS 和 Python 桥接契约" }, "multi-agent")
  const extensionConflictPlan = createPlanForTask({ id: "extension_conflict", fixtureType: "extension-conflict", goal: "检测扩展版本冲突" }, "multi-agent")

  assert.equal(fixtureType({ fixtureType: "dependency-upgrade" }), "dependency-upgrade")
  assert.equal(fixtureType({ fixtureType: "cross-language" }), "cross-language")
  assert.equal(fixtureType({ fixtureType: "extension-conflict" }), "extension-conflict")
  assert.ok(fs.existsSync(path.join(dependencyRoot, "src", "deps.js")))
  assert.ok(fs.existsSync(path.join(crossLanguageRoot, "src", "bridge.js")))
  assert.ok(fs.existsSync(path.join(crossLanguageRoot, "python", "worker.py")))
  assert.ok(fs.existsSync(path.join(extensionConflictRoot, "src", "extensions", "manifest.js")))
  assert.deepEqual(dependencyPlan.phases.map((phase) => phase.id), ["phase_plan", "phase_file_1", "phase_file_2", "phase_verify"])
  assert.deepEqual(crossLanguagePlan.phases.map((phase) => phase.id), ["phase_plan", "phase_file_1", "phase_file_2", "phase_file_3", "phase_verify"])
  assert.deepEqual(extensionConflictPlan.phases.map((phase) => phase.id), ["phase_alpha", "phase_beta"])
})

test("runStrategyFixture completes a single-agent temporary run", async () => {
  orchestrator.reset()
  const result = await runStrategyFixture({
    id: "single_real",
    goal: "修改 demo.js 并运行 node --check",
    risk: "safe",
  }, "single-agent")

  assert.equal(result.strategy, "single-agent")
  assert.equal(result.metrics.status, "completed")
  assert.equal(result.metrics.assignmentCount, 1)
  assert.equal(result.metrics.patchArtifactCount, 1)
  assert.equal(result.metrics.qualityGate.status, "passed")
  assert.equal(fs.readFileSync(path.join(result.projectRoot, "demo.js"), "utf8").includes("single-agent"), true)
})

test("runStrategyFixture completes a refactor-flow multi-agent temporary run", async () => {
  orchestrator.reset()
  const result = await runStrategyFixture({
    id: "refactor_real",
    goal: "跨模型、服务和入口完成重构并运行 node --check",
    fixtureType: "refactor-flow",
    risk: "medium",
  }, "multi-agent")

  assert.equal(result.strategy, "multi-agent")
  assert.equal(result.fixtureType, "refactor-flow")
  assert.equal(result.metrics.status, "completed")
  assert.equal(result.metrics.assignmentCount, 5)
  assert.equal(result.metrics.patchArtifactCount >= 3, true)
  assert.equal(result.metrics.qualityGate.status, "passed")
  assert.equal(fs.readFileSync(path.join(result.projectRoot, "src", "model.js"), "utf8").includes("version: 2"), true)
  assert.equal(fs.readFileSync(path.join(result.projectRoot, "src", "service.js"), "utf8").includes("createViewModel"), true)
  assert.equal(fs.readFileSync(path.join(result.projectRoot, "src", "app.js"), "utf8").includes("createViewModel"), true)
})

test("runTaskRealComparison runs both strategies and aggregates metrics", async () => {
  orchestrator.reset()
  const comparison = await runTaskRealComparison({
    id: "both_real",
    goal: "用临时 fixture 对照单 Agent 和多 Agent",
    risk: "medium",
  })

  assert.equal(comparison.runs.length, 2)
  assert.equal(comparison.summary.totalRuns, 2)
  assert.equal(comparison.summary.completedRuns, 2)
  assert.equal(comparison.summary.totalQualityGateFailures, 0)
  assert.ok(["single-agent", "multi-agent"].includes(comparison.summary.winner))

  const summary = summarizeTaskRealComparisons([comparison])
  assert.equal(summary.totalTasks, 1)
  assert.equal(summary.totalRuns, 2)
  assert.equal(summary.completedRuns, 2)
})

test("quality-fail fixture records quality gate failures", async () => {
  orchestrator.reset()
  const comparison = await runTaskRealComparison({
    id: "quality_fail",
    goal: "生成语法错误 patch",
    fixtureType: "quality-fail",
    risk: "medium",
  })

  assert.equal(comparison.summary.totalRuns, 2)
  assert.equal(comparison.summary.totalQualityGateFailures, 2)
  assert.equal(comparison.summary.failureRecommendation.category, "quality_gate")
  assert.ok(comparison.runs.every((item) => item.metrics.status === "waiting_user"))
})

test("conflict fixture records multi-agent conflicts without applying patch", async () => {
  orchestrator.reset()
  const comparison = await runTaskRealComparison({
    id: "conflict",
    goal: "两个实现分支同时修改 demo.js",
    fixtureType: "conflict",
    risk: "medium",
  })

  const multi = comparison.runs.find((item) => item.strategy === "multi-agent")
  assert.ok(multi.metrics.conflictCount > 0)
  assert.equal(multi.metrics.qualityGate.status, "not_run")
  assert.equal(comparison.summary.totalConflicts > 0, true)
  assert.equal(comparison.summary.failureRecommendation.category, "integration_conflict")
})

test("new enterprise fixtures run through isolated strategy fixtures", async () => {
  orchestrator.reset()
  const dependency = await runStrategyFixture({
    id: "dependency_upgrade",
    goal: "升级 Vite/Electron 相关依赖并更新兼容检测",
    fixtureType: "dependency-upgrade",
    risk: "medium",
  }, "multi-agent")

  assert.equal(dependency.fixtureType, "dependency-upgrade")
  assert.equal(dependency.metrics.status, "completed")
  assert.equal(dependency.metrics.qualityGate.status, "passed")
  assert.deepEqual([...new Set(dependency.artifacts.flatMap((artifact) => artifact.metadata?.filesChanged || []))].sort(), ["package.json", "src/deps.js"])
  assert.ok(fs.readFileSync(path.join(dependency.projectRoot, "src", "deps.js"), "utf8").includes("5.4.0"))
  assert.ok(fs.readFileSync(path.join(dependency.projectRoot, "package.json"), "utf8").includes("@vitejs/plugin-vue"))

  orchestrator.reset()
  const crossLanguage = await runStrategyFixture({
    id: "cross_language",
    goal: "同步 JS bridge 和 Python worker 的跨语言契约",
    fixtureType: "cross-language",
    risk: "medium",
  }, "multi-agent")

  assert.equal(crossLanguage.fixtureType, "cross-language")
  assert.equal(crossLanguage.metrics.status, "completed")
  assert.equal(crossLanguage.metrics.qualityGate.status, "passed")
  assert.ok(fs.readFileSync(path.join(crossLanguage.projectRoot, "src", "bridge.js"), "utf8").includes("bridgeReady"))
  assert.ok(fs.readFileSync(path.join(crossLanguage.projectRoot, "python", "worker.py"), "utf8").includes("\"ok\": True"))

  orchestrator.reset()
  const extensionConflict = await runStrategyFixture({
    id: "extension_conflict",
    goal: "两个扩展来源同时升级同一个 manifest 时应阻断",
    fixtureType: "extension-conflict",
    risk: "high",
  }, "multi-agent")

  assert.equal(extensionConflict.fixtureType, "extension-conflict")
  assert.equal(extensionConflict.metrics.status, "waiting_user")
  assert.ok(extensionConflict.metrics.conflictCount > 0)
  assert.equal(extensionConflict.metrics.qualityGate.status, "not_run")
})

test("partial-failure fixture preserves completed sub-agent artifacts and exposes recovery actions", async () => {
  orchestrator.reset()
  const result = await runStrategyFixture({
    id: "partial_failure",
    goal: "一个子 agent 失败时保留其他子 agent 的结果并给出恢复动作",
    fixtureType: "partial-failure",
    risk: "medium",
  }, "multi-agent")

  assert.equal(result.fixtureType, "partial-failure")
  assert.equal(result.metrics.status, "failed")
  assert.equal(result.metrics.assignmentCount, 2)
  assert.equal(result.metrics.patchArtifactCount, 1)
  assert.equal(result.metrics.recovery.total >= 4, true)
  assert.deepEqual(result.metrics.recovery.byAction, {
    abort: 1,
    ask_user: 1,
    retry: 1,
    split: 1,
  })
  assert.equal(fs.readFileSync(path.join(result.projectRoot, "src", "safe.js"), "utf8").includes("safe-agent-result"), false)

  const patchArtifacts = result.artifacts.filter((artifact) => artifact.type === "patch")
  assert.equal(patchArtifacts.length, 1)
  assert.deepEqual(patchArtifacts[0].metadata.filesChanged, ["src/safe.js"])
})
