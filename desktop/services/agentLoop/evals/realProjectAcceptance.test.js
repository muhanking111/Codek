const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const {
  getAcceptanceReportPaths,
  listAcceptanceReports,
  matrixScenarios,
  runAcceptance,
  runAcceptanceMatrix,
  saveAcceptanceReport,
  toAcceptanceMarkdown,
  toLongTaskTrialMarkdown,
} = require("./realProjectAcceptance")

test("real project acceptance checks multi-agent run, apply, and recovery flow", async () => {
  const report = await runAcceptance()

  assert.equal(report.taskSet, "standard")
  assert.equal(report.ready, true)
  assert.equal(report.failed, 0)
  assert.ok(report.total >= 18)
  assert.equal(report.run.executionStrategy, "multi-agent")
  assert.equal(report.run.statusBeforeAccept, "waiting_user")
  assert.equal(report.run.runtimeStatusBeforeAccept, "waiting_decision")
  assert.equal(report.run.projectKind, "smoke-temp")
  assert.equal(report.run.writeModeBeforeAccept, "proposed_patch_only")
  assert.equal(report.run.statusAfterAccept, "completed")
  assert.equal(report.run.runtimeStatusAfterAccept, "completed")
  assert.equal(report.run.writeModeAfterAccept, "applied")
  assert.deepEqual(report.run.filesChanged.sort(), ["src/app.js", "src/state.js", "src/view.js"])
  assert.equal(report.recovery.executedAction, "retry")
  assert.equal(report.recovery.runStatus, "running")
  assert.ok(report.matrix.total >= 10)
  assert.equal(report.matrix.failed, 0)
  assert.equal(report.decisionSummary.permissionRecorded, true)
  assert.ok(report.decisionSummary.permissionRequests.some((item) => item.scenario === "destructive_request_blocked" && item.destructive))
  assert.ok(report.routerData.totalSamples >= 10)
  assert.ok(["keep-current-router", "switch-candidate-router", "needs-more-samples"].includes(report.routerData.recommendation))
  assert.ok(report.checks.some((item) => item.id === "main_project_unchanged_before_accept" && item.passed))
  assert.ok(report.checks.some((item) => item.id === "main_project_updated_after_accept" && item.passed))
})

test("real project acceptance matrix covers success, failure, conflict, and recovery scenarios", async () => {
  assert.ok(matrixScenarios().length >= 9)

  const matrix = await runAcceptanceMatrix()
  const byId = Object.fromEntries(matrix.scenarios.map((scenario) => [scenario.id, scenario]))

  assert.ok(matrix.total >= 10)
  assert.equal(matrix.passed, matrix.total)
  assert.equal(matrix.failed, 0)
  assert.equal(byId.single_file_success.status, "completed")
  assert.equal(byId.multi_file_success.qualityGateStatus, "passed")
  assert.equal(byId.refactor_flow_success.status, "completed")
  assert.equal(byId.refactor_flow_success.qualityGateStatus, "passed")
  assert.deepEqual(byId.refactor_flow_success.filesChanged.sort(), ["src/app.js", "src/model.js", "src/service.js"])
  assert.equal(byId.ui_component_change.qualityGateStatus, "passed")
  assert.equal(byId.backend_api_change.qualityGateStatus, "passed")
  assert.equal(byId.settings_schema_change.qualityGateStatus, "passed")
  assert.equal(byId.extension_flow_change.qualityGateStatus, "passed")
  assert.equal(byId.dependency_upgrade_change.qualityGateStatus, "passed")
  assert.deepEqual(byId.dependency_upgrade_change.filesChanged.sort(), ["package.json", "src/deps.js"])
  assert.equal(byId.cross_language_change.qualityGateStatus, "passed")
  assert.deepEqual(byId.cross_language_change.filesChanged.sort(), ["README.md", "python/worker.py", "src/bridge.js"])
  assert.equal(byId.large_refactor_guarded.qualityGateStatus, "passed")
  assert.equal(byId.quality_gate_failure.status, "waiting_user")
  assert.equal(byId.quality_gate_failure.qualityGateStatus, "failed")
  assert.equal(byId.quality_gate_failure.failureRecommendation.category, "quality_gate")
  assert.ok(byId.quality_gate_failure.checks.some((item) => item.id === "quality_gate_failure_rework_requested" && item.passed))
  assert.equal(byId.conflict_blocked.status, "waiting_user")
  assert.ok(byId.conflict_blocked.conflictCount > 0)
  assert.equal(byId.conflict_blocked.failureRecommendation.category, "integration_conflict")
  assert.ok(byId.conflict_blocked.checks.some((item) => item.id === "conflict_blocked_not_applied" && item.passed))
  assert.equal(byId.extension_conflict_blocked.status, "waiting_user")
  assert.ok(byId.extension_conflict_blocked.conflictCount > 0)
  assert.equal(byId.extension_conflict_blocked.failureRecommendation.category, "extension_conflict")
  assert.ok(byId.extension_conflict_blocked.checks.some((item) => item.id === "extension_conflict_blocked_not_applied" && item.passed))
  assert.equal(byId.long_background_recovery.status, "running")
  assert.equal(byId.long_background_recovery.recoveryAction.action, "rewind")
  assert.equal(byId.long_background_recovery.checkpoint.resumed, true)
  assert.ok(byId.long_background_recovery.checks.some((item) => item.id === "long_background_recovery_checkpoint_resumed" && item.passed))
  assert.equal(byId.ambiguous_requirement.status, "blocked")
  assert.equal(byId.ambiguous_requirement.failureRecommendation.category, "requirement_ambiguity")
  assert.equal(byId.destructive_request_blocked.status, "blocked")
  assert.equal(byId.destructive_request_blocked.failureRecommendation.category, "destructive_permission")
  assert.equal(byId.permission_scope_violation.status, "blocked")
  assert.equal(byId.permission_scope_violation.failureRecommendation.category, "permission_scope")
  assert.ok(byId.permission_scope_violation.checks.some((item) => item.id === "permission_scope_violation_permission_audit" && item.passed))
  assert.ok(byId.permission_scope_violation.checks.some((item) => item.id === "permission_scope_violation_main_project_unchanged" && item.passed))
  assert.equal(byId.recovery_action.status, "running")
})

test("real project acceptance supports quick and risk task sets", async () => {
  const quick = await runAcceptance({ taskSet: "quick" })
  const quickScenarioIds = quick.matrix.scenarios.map((scenario) => scenario.id)

  assert.equal(quick.taskSet, "quick")
  assert.equal(quick.ready, true)
  assert.equal(quick.run.executionStrategy, "multi-agent")
  assert.deepEqual(quickScenarioIds, ["single_file_success", "multi_file_success"])
  assert.equal(quick.recovery.skipped, true)

  const risk = await runAcceptance({ taskSet: "risk" })
  const riskScenarioIds = risk.matrix.scenarios.map((scenario) => scenario.id)

  assert.equal(risk.taskSet, "risk")
  assert.equal(risk.ready, true)
  assert.equal(risk.run, null)
  assert.equal(risk.recovery.executedAction, "retry")
  assert.deepEqual(riskScenarioIds, ["quality_gate_failure", "conflict_blocked", "extension_conflict_blocked", "long_background_recovery", "ambiguous_requirement", "destructive_request_blocked", "permission_scope_violation", "recovery_action"])
})

test("real project acceptance report writes latest and history files", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-acceptance-report-"))
  const report = await runAcceptance()
  const saved = saveAcceptanceReport(report, { reportDir })
  const paths = getAcceptanceReportPaths(reportDir)

  assert.equal(saved.jsonPath, paths.jsonPath)
  assert.equal(fs.existsSync(paths.jsonPath), true)
  assert.equal(fs.existsSync(paths.markdownPath), true)
  assert.equal(fs.existsSync(saved.historyJsonPath), true)
  assert.equal(fs.existsSync(saved.historyMarkdownPath), true)

  const stored = JSON.parse(fs.readFileSync(paths.jsonPath, "utf8"))
  assert.equal(stored.ready, true)
  assert.equal(stored.taskSet, "standard")
  assert.ok(stored.matrix.total >= 10)
  assert.equal(stored.comparison.taskSet, "standard")
  assert.ok(stored.routerData.totalSamples >= 10)
  assert.match(fs.readFileSync(paths.markdownPath, "utf8"), /Real Project Multi-Agent Smoke Report/)
  assert.match(fs.readFileSync(paths.markdownPath, "utf8"), /Task Set: standard/)
  assert.match(fs.readFileSync(paths.markdownPath, "utf8"), /## Matrix/)
  assert.match(fs.readFileSync(paths.markdownPath, "utf8"), /Runtime Before Accept/)
  assert.match(fs.readFileSync(paths.markdownPath, "utf8"), /Write Mode Before Accept/)
  assert.match(fs.readFileSync(paths.markdownPath, "utf8"), /Project Kind/)
  assert.match(fs.readFileSync(paths.markdownPath, "utf8"), /## Scenario Groups/)
  assert.match(fs.readFileSync(paths.markdownPath, "utf8"), /## Router Data/)
  assert.match(fs.readFileSync(paths.markdownPath, "utf8"), /## Failure Recommendations/)
  assert.match(fs.readFileSync(paths.markdownPath, "utf8"), /## Decision Audit/)
  assert.match(fs.readFileSync(paths.markdownPath, "utf8"), /## Sandbox Permission/)
  assert.match(fs.readFileSync(paths.markdownPath, "utf8"), /## Recovery Actions/)
  assert.match(fs.readFileSync(paths.markdownPath, "utf8"), /## Comparison Export/)
  assert.ok(stored.decisionSummary.recoveryActions.some((item) => item.scenario === "long_background_recovery" && item.action === "rewind"))
  assert.ok(stored.failureRecommendations.total >= 5)
  assert.equal(stored.failureRecommendations.byCategory.quality_gate >= 1, true)
})

test("real project acceptance supports a long task trial report", async () => {
  const report = await runAcceptance({ scenario: "long-task" })

  assert.equal(report.scenario, "long-task")
  assert.equal(report.ready, true)
  assert.equal(report.failed, 0)
  assert.ok(report.checks.some((item) => item.id === "long_task_quality_gate_passed"))
  assert.equal(report.longTask.ready, true)
  assert.equal(report.longTask.deliveryTrust.status, "trusted")
  assert.equal(report.longTask.deliveryTrust.score, 100)
  assert.match(report.longTask.deliveryTrust.nextAction, /接受变更/)
  assert.equal(report.longTask.evidenceChain.ready, true)
  assert.equal(report.longTask.evidenceChain.workspace.isolated, true)
  assert.equal(report.longTask.evidenceChain.router.matchedExpected, true)
  assert.equal(report.longTask.evidenceChain.qualityGate.status, "passed")
  assert.equal(report.longTask.evidenceChain.attachmentContext.status, "simulated")
  assert.ok(report.longTask.evidenceChain.diff.changedAfterAccept.length >= 4)
  assert.ok(report.longTask.evidenceChain.diff.beforeAcceptSnapshot["src/app.js"].sha256)
  assert.ok(report.longTask.evidenceChain.diff.afterAcceptSnapshot["src/app.js"].sha256)
  assert.equal(report.longTask.routerDecision.executionStrategy, "multi-agent")
  assert.ok(report.longTask.run.phaseCount >= 5)
  assert.ok(report.longTask.run.assignmentCount >= 5)
  assert.ok(report.longTask.run.filesChanged.length >= 4)
  assert.ok(report.longTask.checks.every((item) => item.passed))

  const markdown = toAcceptanceMarkdown(report)
  const trialMarkdown = toLongTaskTrialMarkdown(report)
  assert.match(markdown, /Trial Record: real-project-long-task-latest\.md/)
  assert.match(trialMarkdown, /真实项目 Agent 长任务试用记录/)
  assert.match(trialMarkdown, /可信交付摘要/)
  assert.match(trialMarkdown, /端到端证据链/)
  assert.match(trialMarkdown, /Accept 前 SHA-256/)
  assert.match(trialMarkdown, /可信分数: 100\/100/)
  assert.match(trialMarkdown, /Router 决策/)
  assert.match(trialMarkdown, /long_task_quality_gate_passed/)
})

test("real project acceptance writes a dedicated long task trial record", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-long-task-report-"))
  const report = await runAcceptance({ scenario: "long-task" })
  const saved = saveAcceptanceReport(report, { reportDir })

  assert.equal(fs.existsSync(saved.longTaskMarkdownPath), true)
  assert.equal(fs.existsSync(saved.longTaskHistoryMarkdownPath), true)
  assert.match(fs.readFileSync(saved.longTaskMarkdownPath, "utf8"), /真实项目 Agent 长任务试用记录/)
  assert.match(fs.readFileSync(saved.longTaskMarkdownPath, "utf8"), /可信交付摘要/)
  assert.match(fs.readFileSync(saved.markdownPath, "utf8"), /Long Task Trial/)
  assert.match(fs.readFileSync(saved.markdownPath, "utf8"), /Delivery Trust:/)
})

test("real project acceptance history lists real project reports newest first", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-acceptance-history-"))
  const oldReport = {
    createdAt: 1000,
    total: 10,
    passed: 8,
    failed: 2,
    ready: false,
    durationMs: 120,
    taskSet: "risk",
    matrix: { total: 5, passed: 4, failed: 1, scenarios: [] },
    run: { id: "run_old" },
    recovery: {},
    checks: [],
  }
  const newReport = {
    createdAt: 2000,
    total: 12,
    passed: 12,
    failed: 0,
    ready: true,
    durationMs: 90,
    taskSet: "quick",
    matrix: { total: 5, passed: 5, failed: 0, scenarios: [] },
    run: { id: "run_new" },
    recovery: {},
    checks: [],
  }

  saveAcceptanceReport(oldReport, { reportDir })
  saveAcceptanceReport(newReport, { reportDir })
  fs.writeFileSync(
    path.join(getAcceptanceReportPaths(reportDir).historyDir, "multi-agent-ignored.json"),
    `${JSON.stringify({ createdAt: 3000, total: 1, passed: 1, failed: 0 })}\n`,
    "utf8",
  )

  const history = listAcceptanceReports({ reportDir })

  assert.equal(history.length, 2)
  assert.equal(history[0].createdAt, 2000)
  assert.equal(history[0].taskSet, "quick")
  assert.equal(history[0].successRate, 100)
  assert.equal(history[0].matrix.total, 5)
  assert.equal(history[0].matrix.passed, 5)
  assert.match(history[0].markdownPath, /real-project-smoke-.*\.md$/)
  assert.equal(history[1].createdAt, 1000)
  assert.equal(history[1].taskSet, "risk")
  assert.equal(history[1].successRate, 80)
})

test("real project acceptance markdown includes run and recovery sections", async () => {
  const report = await runAcceptance()
  const markdown = toAcceptanceMarkdown(report)

  assert.match(markdown, /## Run/)
  assert.match(markdown, /## Recovery/)
  assert.match(markdown, /## Matrix/)
  assert.match(markdown, /## Failure Recommendations/)
  assert.match(markdown, /## Decision Audit/)
  assert.match(markdown, /## Sandbox Permission/)
  assert.match(markdown, /## Comparison Export/)
  assert.match(markdown, /Task Set: standard/)
  assert.match(markdown, /quality_gate_failure/)
  assert.match(markdown, /conflict_blocked/)
  assert.match(markdown, /refactor_flow_success/)
  assert.match(markdown, /ui_component_change/)
  assert.match(markdown, /destructive_request_blocked/)
  assert.match(markdown, /permission_scope_violation/)
  assert.match(markdown, /dependency_upgrade_change/)
  assert.match(markdown, /cross_language_change/)
  assert.match(markdown, /extension_conflict_blocked/)
  assert.match(markdown, /long_background_recovery/)
  assert.match(markdown, /router_multi_agent/)
  assert.match(markdown, /Router Data/)
  assert.match(markdown, /quality_gate/)
  assert.match(markdown, /permission_scope/)
  assert.match(markdown, /recovery_action_executed/)
})
