const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const {
  buildOrchestratorReadinessReport,
  listReadinessActionAudits,
  listRunActionAudits,
  listReadinessReports,
  readLatestReadinessReport,
  saveRunActionAudit,
  saveReadinessActionAudit,
  saveReadinessReport,
} = require("./readiness")

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-readiness-"))
  fs.mkdirSync(path.join(root, "src"), { recursive: true })
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { typecheck: "node --check src/app.js" } }), "utf8")
  fs.writeFileSync(path.join(root, "src", "app.js"), "export const ok = true\n", "utf8")
  return root
}

test("readiness reports ready when project, safety config, latest reports, and runs are healthy", () => {
  const projectRoot = makeProject()
  const report = buildOrchestratorReadinessReport({
    projectRoot,
    settings: {
      "codek.agent.realWorkspaceTrial.allowedPaths": ["src"],
      "codek.agent.realWorkspaceTrial.qualityGateCommands": ["npm run typecheck"],
    },
    runs: [{ id: "run_done", status: "completed" }],
    releaseGateReport: { ready: true },
    acceptanceReport: { ready: true, passed: 10, total: 10 },
    realTrialReport: {
      realWorkspaceTrial: {
        mainWorkspaceUntouchedBeforeAccept: true,
        rollbackAvailable: true,
        filesChanged: ["src/app.js"],
      },
    },
    now: 100,
  })

  assert.equal(report.status, "ready")
  assert.equal(report.ready, true)
  assert.equal(report.summary.blocked, 0)
  assert.equal(report.summary.failed, 0)
  assert.ok(report.checks.every((check) => check.status !== "failed"))
})

test("readiness blocks real runs without project root, allowed paths, or quality gates", () => {
  const report = buildOrchestratorReadinessReport({
    projectRoot: "",
    settings: {
      "codek.agent.realWorkspaceTrial.allowedPaths": [],
      "codek.agent.realWorkspaceTrial.qualityGateCommands": ["npm install"],
    },
    releaseGateReport: null,
    acceptanceReport: null,
    realTrialReport: null,
  })

  assert.equal(report.status, "blocked")
  assert.equal(report.ready, false)
  assert.ok(report.checks.some((check) => check.id === "workspace_root" && check.status === "failed"))
  assert.ok(report.checks.some((check) => check.id === "allowed_paths" && check.status === "failed"))
  assert.ok(report.checks.some((check) => check.id === "quality_gates" && check.status === "failed"))
  assert.match(report.nextAction, /项目根目录|允许路径|质量门/)
  assert.ok(report.remediations.some((action) => action.id === "apply_safe_defaults" && action.canApplyInUi === true))
  assert.ok(report.remediations.some((action) => action.id === "open_project" && action.canApplyInUi === false))
})

test("readiness degrades when evidence is missing or runs need user action", () => {
  const projectRoot = makeProject()
  const report = buildOrchestratorReadinessReport({
    projectRoot,
    settings: {
      "codek.agent.realWorkspaceTrial.allowedPaths": ["src"],
      "codek.agent.realWorkspaceTrial.qualityGateCommands": ["npm run typecheck", "npm install"],
    },
    runs: [
      { id: "run_waiting", status: "waiting_user", permissionRequest: { status: "waiting_user" } },
      { id: "run_running", status: "running" },
    ],
    releaseGateReport: { ready: false },
    acceptanceReport: null,
    realTrialReport: null,
  })

  assert.equal(report.status, "degraded")
  assert.equal(report.ready, false)
  assert.equal(report.summary.warning > 0, true)
  assert.ok(report.checks.some((check) => check.id === "blocked_runs" && check.status === "warning"))
  assert.ok(report.checks.some((check) => check.id === "blocked_quality_gate_commands" && check.status === "warning"))
  assert.ok(report.checks.some((check) => check.id === "release_gate_latest" && check.status === "warning"))
})

test("readiness keeps historical blocked runs as review evidence without blocking current release", () => {
  const projectRoot = makeProject()
  const report = buildOrchestratorReadinessReport({
    projectRoot,
    settings: {
      "codek.agent.realWorkspaceTrial.allowedPaths": ["src"],
      "codek.agent.realWorkspaceTrial.qualityGateCommands": ["npm run typecheck"],
    },
    runs: [{
      id: "run_old_waiting",
      status: "waiting_user",
      updatedAt: 100,
      permissionRequest: { status: "waiting_user" },
    }],
    releaseGateReport: { ready: true },
    acceptanceReport: { ready: true, passed: 10, total: 10 },
    realTrialReport: {
      realWorkspaceTrial: {
        mainWorkspaceUntouchedBeforeAccept: true,
        rollbackAvailable: true,
        filesChanged: ["src/app.js"],
      },
    },
    now: 100 + (7 * 60 * 60 * 1000),
  })

  const blockedRuns = report.checks.find((check) => check.id === "blocked_runs")
  assert.equal(report.status, "ready")
  assert.equal(report.ready, true)
  assert.equal(blockedRuns.status, "passed")
  assert.equal(blockedRuns.data.historicalBlocked, 1)
})

test("readiness keeps auto-recovered interrupted runs as review evidence without blocking current release", () => {
  const projectRoot = makeProject()
  const report = buildOrchestratorReadinessReport({
    projectRoot,
    settings: {
      "codek.agent.realWorkspaceTrial.allowedPaths": ["src"],
      "codek.agent.realWorkspaceTrial.qualityGateCommands": ["npm run typecheck"],
    },
    runs: [{
      id: "run_interrupted",
      status: "failed",
      projectRoot,
      summary: "应用重启，中断运行。",
      updatedAt: 1000,
      recoveryRecommendation: {
        action: "retry",
        reason: "应用重启中断了执行，建议重试。",
      },
      events: [{ type: "orchestrator:recovered_interrupted", createdAt: 1000 }],
    }],
    releaseGateReport: { ready: true },
    acceptanceReport: { ready: true, passed: 10, total: 10 },
    realTrialReport: {
      realWorkspaceTrial: {
        mainWorkspaceUntouchedBeforeAccept: true,
        rollbackAvailable: true,
        filesChanged: ["src/app.js"],
      },
    },
    now: 1100,
  })

  const blockedRuns = report.checks.find((check) => check.id === "blocked_runs")
  assert.equal(report.status, "ready")
  assert.equal(report.ready, true)
  assert.equal(blockedRuns.status, "passed")
  assert.equal(blockedRuns.data.interruptedRecovered, 1)
  assert.deepEqual(blockedRuns.data.interruptedRecoveredRunIds, ["run_interrupted"])
})

test("readiness ignores current blocked runs outside the requested project scope", () => {
  const projectRoot = makeProject()
  const unrelatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-unrelated-"))
  const report = buildOrchestratorReadinessReport({
    projectRoot,
    settings: {
      "codek.agent.realWorkspaceTrial.allowedPaths": ["src"],
      "codek.agent.realWorkspaceTrial.qualityGateCommands": ["npm run typecheck"],
    },
    runs: [{
      id: "run_unrelated_waiting",
      status: "waiting_user",
      projectRoot: unrelatedRoot,
      updatedAt: 1000,
      permissionRequest: { status: "waiting_user" },
    }],
    releaseGateReport: { ready: true },
    acceptanceReport: { ready: true, passed: 10, total: 10 },
    realTrialReport: {
      realWorkspaceTrial: {
        mainWorkspaceUntouchedBeforeAccept: true,
        rollbackAvailable: true,
        filesChanged: ["src/app.js"],
      },
    },
    now: 1100,
  })

  const blockedRuns = report.checks.find((check) => check.id === "blocked_runs")
  assert.equal(report.status, "ready")
  assert.equal(report.ready, true)
  assert.equal(blockedRuns.status, "passed")
  assert.equal(blockedRuns.data.outOfScopeBlocked, 1)
  assert.deepEqual(blockedRuns.data.outOfScopeBlockedRunIds, ["run_unrelated_waiting"])
})

test("readiness reports save latest markdown, latest json, and history", () => {
  const projectRoot = makeProject()
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-readiness-reports-"))
  const report = buildOrchestratorReadinessReport({
    projectRoot,
    settings: {
      "codek.agent.realWorkspaceTrial.allowedPaths": ["src"],
      "codek.agent.realWorkspaceTrial.qualityGateCommands": ["npm run typecheck"],
    },
    releaseGateReport: { ready: true },
    acceptanceReport: { ready: true, passed: 1, total: 1 },
    realTrialReport: {
      realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true, filesChanged: [] },
    },
    now: 123,
  })

  const saved = saveReadinessReport(report, { reportDir })
  assert.equal(fs.existsSync(saved.markdownPath), true)
  assert.equal(fs.existsSync(saved.jsonPath), true)
  assert.equal(fs.existsSync(saved.historyMarkdownPath), true)
  assert.equal(fs.existsSync(saved.historyJsonPath), true)
  assert.match(fs.readFileSync(saved.markdownPath, "utf8"), /企业级 Agent 运行预检/)

  const latest = readLatestReadinessReport({ reportDir })
  const history = listReadinessReports({ reportDir })
  assert.equal(latest.report.status, "ready")
  assert.equal(latest.markdownPath, saved.markdownPath)
  assert.equal(history.length, 1)
  assert.equal(history[0].status, "ready")
  assert.equal(history[0].jsonPath, saved.historyJsonPath)
  assert.match(fs.readFileSync(saved.markdownPath, "utf8"), /修复建议/)
})

test("readiness action audit saves local jsonl history", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-readiness-audit-"))
  const saved = saveReadinessActionAudit({
    createdAt: 456,
    actionId: "apply_safe_defaults",
    title: "应用安全默认配置",
    status: "applied",
    projectRoot: "D:/Workspace",
    summary: "写入安全默认配置",
    settingKeys: ["codek.agent.realWorkspaceTrial.allowedPaths"],
    metadata: { source: "test" },
  }, { reportDir })

  assert.equal(fs.existsSync(saved.auditPath), true)
  const history = listReadinessActionAudits({ reportDir })
  assert.equal(history.length, 1)
  assert.equal(history[0].actionId, "apply_safe_defaults")
  assert.equal(history[0].projectRoot, "D:/Workspace")
  assert.deepEqual(history[0].settingKeys, ["codek.agent.realWorkspaceTrial.allowedPaths"])
})

test("run action audit saves sanitized local jsonl history", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-run-action-audit-"))
  const saved = saveRunActionAudit({
    startedAt: 100,
    finishedAt: 160,
    runId: "run_1",
    actionId: "run-release-gate",
    title: "运行快速门",
    status: "success",
    projectRoot: "D:/Workspace",
    summary: "快速发布门已运行",
    error: "x".repeat(600),
    metadata: { source: "test", stdout: "should-not-be-used-as-output" },
  }, { reportDir })

  assert.equal(fs.existsSync(saved.auditPath), true)
  assert.match(saved.auditPath, /orchestrator-run-actions\.jsonl$/)
  const history = listRunActionAudits({ reportDir })
  assert.equal(history.length, 1)
  assert.equal(history[0].runId, "run_1")
  assert.equal(history[0].actionId, "run-release-gate")
  assert.equal(history[0].durationMs, 60)
  assert.equal(history[0].error.length <= 240, true)
  assert.deepEqual(history[0].metadata, { source: "test" })
})
