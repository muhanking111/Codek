const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { execFileSync } = require("node:child_process")

const planTree = require("./planTree")
const orchestrator = require("./orchestrator")
const planExecutor = require("./planExecutor")
const artifactStore = require("./artifactStore")
const integrator = require("./integrator")
const routes = require("./orchestratorRoutes")
const router = require("../router")

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function createGitProject(prefix) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  git(["init"], projectRoot)
  git(["config", "user.email", "test@example.com"], projectRoot)
  git(["config", "user.name", "Codek Test"], projectRoot)
  return projectRoot
}

test("artifactStore records structured run artifacts", () => {
  artifactStore.reset()
  const artifact = artifactStore.addArtifact("run_a", {
    assignmentId: "assignment_1",
    type: "summary",
    content: "done",
  })

  assert.equal(artifact.runId, "run_a")
  assert.equal(artifact.type, "summary")
  assert.equal(artifactStore.listArtifacts("run_a").length, 1)
  assert.equal(artifactStore.listArtifacts("run_a", { type: "summary" })[0].content, "done")
})

test("integrator detects write conflicts and creates a decision", () => {
  const decision = integrator.createIntegrationDecision({
    runId: "run_conflict",
    assignments: [
      { id: "a1", writePaths: ["src/App.vue"] },
      { id: "a2", writePaths: ["src/App.vue"] },
    ],
    artifacts: [],
  })

  assert.equal(decision.status, "pending")
  assert.equal(decision.conflicts.length, 1)
  assert.equal(decision.proposedPatch.filesChanged[0], "src/App.vue")
})

test("orchestrator creates an observable run shell", () => {
  orchestrator.reset()
  const run = orchestrator.createRun({
    projectRoot: "D:/Workspace",
    visibleMode: "agent",
    userInput: "修复 src/App.vue",
  })

  assert.equal(run.visibleMode, "agent")
  assert.equal(run.executionStrategy, "single-agent")
  assert.equal(orchestrator.listRuns().length, 1)
  assert.equal(orchestrator.getRun(run.id).id, run.id)
})

test("orchestrator stores sanitized context evidence on run shells", () => {
  orchestrator.reset()
  const run = orchestrator.createRun({
    projectRoot: "D:/Workspace",
    visibleMode: "agent",
    userInput: "使用上下文证据链",
    contextEvidence: {
      attachments: [{
        name: "secret.txt",
        size: 20,
        type: "text/plain",
        kind: "text",
        status: "ready",
        content: "DO_NOT_STORE_ATTACHMENT",
        contentLength: 23,
      }],
      rules: [{ path: ".cursor/rules.md", title: "Rules", content: "DO_NOT_STORE_RULE", contentLength: 17 }],
      budget: { totalSources: 2, estimatedChars: 40 },
    },
  })

  assert.equal(run.contextEvidence.attachments[0].name, "secret.txt")
  assert.equal(run.contextEvidence.attachments[0].contentLength, 23)
  assert.equal(run.contextEvidence.rules[0].path, ".cursor/rules.md")
  assert.doesNotMatch(JSON.stringify(run.contextEvidence), /DO_NOT_STORE/)
})

test("orchestrator stores real workspace trial config on run shells", () => {
  orchestrator.reset()
  const run = orchestrator.createRun({
    projectRoot: "D:/SomeUserProject",
    visibleMode: "agent",
    userInput: "重构 src/app.js 并运行 typecheck",
    files: ["src/app.js"],
    realWorkspaceTrial: {
      allowedPaths: ["src", "../escape"],
      qualityGateCommands: ["npm run typecheck", "npm install"],
      maxAssignments: 4,
    },
  })

  assert.equal(run.policyProfile, "real-workspace-trial")
  assert.equal(run.realWorkspaceTrial.writeMode, "proposed_patch_only")
  assert.deepEqual(run.realWorkspaceTrial.allowedPaths, ["src"])
  assert.deepEqual(run.qualityGateCommands, ["npm run typecheck"])
  assert.deepEqual(run.realWorkspaceTrial.blockedQualityGateCommands, ["npm install"])
  assert.equal(run.decisionLog.some((item) => item.type === "real_workspace_trial_configured"), true)
})

test("orchestrator smoke fixture creates an isolated pending patch run", () => {
  orchestrator.reset()
  const previous = process.env.CODEK_ELECTRON_SMOKE
  process.env.CODEK_ELECTRON_SMOKE = "1"

  let run
  try {
    run = orchestrator.createSmokePendingRunFixture()
  } finally {
    if (previous == null) delete process.env.CODEK_ELECTRON_SMOKE
    else process.env.CODEK_ELECTRON_SMOKE = previous
  }

  assert.equal(run.status, "waiting_user")
  assert.match(run.projectRoot, /codek-orchestrator-smoke-/)
  assert.notEqual(path.resolve(run.projectRoot), path.resolve(__dirname, "..", "..", ".."))
  assert.equal(run.integrationDecision.status, "pending")
  assert.deepEqual(run.integrationDecision.proposedPatch.filesChanged, ["demo.js"])
  assert.match(run.integrationDecision.proposedPatch.patches[0].content, /smokeValue = 2/)
  assert.equal(fs.readFileSync(path.join(run.projectRoot, "demo.js"), "utf8"), "export const smokeValue = 1\n")
})

test("orchestrator smoke fixture supports accepted, rollback, and rejected decisions in isolation", () => {
  orchestrator.reset()
  const previous = process.env.CODEK_ELECTRON_SMOKE
  process.env.CODEK_ELECTRON_SMOKE = "1"

  try {
    const applyRun = orchestrator.createSmokePendingRunFixture()
    const accepted = orchestrator.applyDecision(applyRun.id, "accepted")
    assert.equal(accepted.status, "accepted")
    assert.equal(accepted.scmAudit.action, "apply")
    assert.equal(artifactStore.listArtifacts(applyRun.id, { type: "scm-audit" }).length, 1)
    assert.equal(orchestrator.readSmokeFixtureFile(applyRun.id).content.replace(/\r\n/g, "\n"), "export const smokeValue = 2\n")

    const rolledBack = orchestrator.applyDecision(applyRun.id, "rollback")
    assert.equal(rolledBack.status, "rolled_back")
    assert.equal(rolledBack.rollbackScmAudit.action, "rollback")
    assert.equal(artifactStore.listArtifacts(applyRun.id, { type: "scm-audit" }).length, 2)
    assert.equal(orchestrator.readSmokeFixtureFile(applyRun.id).content.replace(/\r\n/g, "\n"), "export const smokeValue = 1\n")

    const rejectRun = orchestrator.createSmokePendingRunFixture()
    const rejected = orchestrator.applyDecision(rejectRun.id, "rejected")
    assert.equal(rejected.status, "rejected")
    assert.equal(orchestrator.readSmokeFixtureFile(rejectRun.id).content.replace(/\r\n/g, "\n"), "export const smokeValue = 1\n")
  } finally {
    if (previous == null) delete process.env.CODEK_ELECTRON_SMOKE
    else process.env.CODEK_ELECTRON_SMOKE = previous
  }
})

test("orchestrator routes are registered", () => {
  router.clearRoutes()
  routes.register(router)

  const registered = router.listRoutes()
  assert.ok(registered.includes("POST /api/orchestrator/tasks"))
  assert.ok(registered.includes("GET /api/orchestrator/tasks"))
  assert.ok(registered.includes("POST /api/orchestrator/runs"))
  assert.ok(registered.includes("POST /api/orchestrator/real-workspace-trial/run"))
  assert.ok(registered.includes("GET /api/orchestrator/real-workspace-trial/latest"))
  assert.ok(registered.includes("POST /api/orchestrator/readiness/check"))
  assert.ok(registered.includes("GET /api/orchestrator/readiness/latest"))
  assert.ok(registered.includes("POST /api/orchestrator/readiness/actions/audit"))
  assert.ok(registered.includes("GET /api/orchestrator/readiness/actions/audit"))
  assert.ok(registered.includes("POST /api/orchestrator/run-actions/audit"))
  assert.ok(registered.includes("GET /api/orchestrator/run-actions/audit"))
  assert.ok(registered.includes("GET /api/orchestrator/evals/latest"))
  assert.ok(registered.includes("POST /api/orchestrator/evals/run"))
  assert.ok(registered.includes("GET /api/orchestrator/acceptance/latest"))
  assert.ok(registered.includes("POST /api/orchestrator/acceptance/run"))
  assert.ok(registered.includes("GET /api/orchestrator/release-gate/latest"))
  assert.ok(registered.includes("GET /api/orchestrator/release-ci/check"))
  assert.ok(registered.includes("POST /api/orchestrator/release-gate/run"))
  assert.ok(registered.includes("GET /api/orchestrator/release-evidence/latest"))
  assert.ok(registered.includes("GET /api/orchestrator/product-grade/latest"))
  assert.ok(registered.includes("POST /api/orchestrator/release-evidence/export"))
  assert.ok(registered.includes("GET /api/orchestrator/runs/:id/artifacts"))
  assert.ok(registered.includes("GET /api/orchestrator/runs/:id/events"))
  assert.ok(registered.includes("GET /api/orchestrator/runs/:id/decisions"))
  assert.ok(registered.includes("GET /api/orchestrator/runs/:id/report"))
  assert.ok(registered.includes("POST /api/orchestrator/runs/:id/report/save"))
  assert.ok(registered.includes("GET /api/orchestrator/runs/:id/command-authorization"))
  assert.ok(registered.includes("POST /api/orchestrator/runs/:id/decision"))
  assert.ok(registered.includes("POST /api/orchestrator/runs/:id/permission"))
})

test("orchestrator release evidence route exports local markdown summary", async () => {
  router.clearRoutes()
  routes.register(router)
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-evidence-route-"))
  fs.writeFileSync(path.join(reportDir, "workbench-real-project-ui-latest.json"), `${JSON.stringify({
    reportKind: "workbench-real-project-ui-smoke-evidence",
    ready: true,
    status: "ready",
    projectRoot: "D:/Workspace",
    latestMarkdownPath: path.join(reportDir, "workbench-real-project-ui-latest.md"),
    latestScreenshotPath: path.join(reportDir, "workbench-real-project-ui-latest.png"),
    metrics: {
      projectRoot: "D:/Workspace",
      domRows: 50,
      totalRows: 97,
      p95ScrollMs: 12,
      maxScrollMs: 24,
      longTasks: 0,
      idleLightbulbCount: 0,
      searchQuery: "json",
      searchMatchPath: "package.json",
      createTargetDir: "src",
    },
    acceptance: {
      opensConfiguredRoot: true,
      nativeExplorerMounted: true,
      explorerRowsVirtualizedAndNonBlank: true,
      scrollP95WithinCursorGradeBudget: true,
      scrollMaxAvoidsHalfSecondStalls: true,
      normalEditorContentVisible: true,
      idleFakeLightbulbHidden: true,
      searchResultOpensNonBlankEditor: true,
      sameLineSearchDuplicatesCollapsed: true,
      sameLineSearchOccurrencesAccurate: true,
      searchViewRemainsActive: true,
      chatInputUsable: true,
      createTargetDisplayMatchesDisk: true,
      continuousCreateRemainsUsable: true,
      staleCreateSnapshotRejected: true,
    },
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "workbench-real-project-ui-latest.md"), "# Workbench UI\n", "utf8")
  fs.writeFileSync(path.join(reportDir, "workbench-real-project-ui-latest.png"), Buffer.from("png"))
  fs.writeFileSync(path.join(reportDir, "explorer-fs-parity-latest.json"), `${JSON.stringify({
    reportKind: "explorer-fs-parity",
    ready: true,
    status: "ready",
    projectPath: "D:/Workspace",
    checkCount: 4,
    passed: 4,
    latestJsonPath: path.join(reportDir, "explorer-fs-parity-latest.json"),
    latestMarkdownPath: path.join(reportDir, "explorer-fs-parity-latest.md"),
    checks: [
      { id: "root", path: "D:/Workspace", source: "explorer", status: "passed", fsCount: 38, codekCount: 38, truncated: false, sentinelCount: 0, missing: [], extra: [], typeMismatches: [] },
      { id: "frontend", path: "D:/Workspace/frontend", source: "explorer", status: "passed", fsCount: 2, codekCount: 2, truncated: false, sentinelCount: 0, missing: [], extra: [], typeMismatches: [] },
      { id: "frontend_vite-project", path: "D:/Workspace/frontend/vite-project", source: "explorer", status: "passed", fsCount: 22, codekCount: 22, truncated: false, sentinelCount: 0, missing: [], extra: [], typeMismatches: [] },
      { id: "scripts", path: "D:/Workspace/scripts", source: "explorer", status: "passed", fsCount: 120, codekCount: 120, truncated: false, sentinelCount: 0, missing: [], extra: [], typeMismatches: [] },
    ],
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "explorer-fs-parity-latest.md"), "# Explorer FS Parity\n", "utf8")
  fs.writeFileSync(path.join(reportDir, "shell-integration-smoke-latest.json"), `${JSON.stringify({
    reportKind: "shell-integration-smoke",
    ready: true,
    status: "ready",
    summary: { total: 2, passed: 2, skipped: 0, failed: 0 },
    checks: [
      { shellType: "powershell", ok: true, skipped: false, durationMs: 1 },
      { shellType: "cmd", ok: true, skipped: false, durationMs: 1 },
    ],
    latestMarkdownPath: path.join(reportDir, "shell-integration-smoke-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "shell-integration-smoke-latest.md"), "# Shell\n", "utf8")
  fs.writeFileSync(path.join(reportDir, "debug-adapter-smoke-latest.json"), `${JSON.stringify({
    reportKind: "debug-adapter-smoke",
    ready: true,
    status: "ready",
    summary: { total: 3, passed: 1, skipped: 2, failed: 0 },
    checks: [
      { id: "fixture", status: "passed", adapterAvailable: true },
      { id: "node", status: "skipped", adapterAvailable: false },
      { id: "python", status: "skipped", adapterAvailable: false },
    ],
    latestMarkdownPath: path.join(reportDir, "debug-adapter-smoke-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "debug-adapter-smoke-latest.md"), "# Debug\n", "utf8")
  fs.writeFileSync(path.join(reportDir, "agent-change-safety-smoke-latest.json"), `${JSON.stringify({
    reportKind: "agent-change-safety-smoke",
    ready: true,
    status: "ready",
    summary: { total: 5, passed: 5, failed: 0 },
    evidence: {
      pendingBatch: {
        blockReason: "manual-change-detected",
        reviewDisplay: {
          status: "blocked",
          firstFileCanApply: false,
          firstFileCanReject: true,
        },
      },
      pendingHunk: { blockReason: "manual-change-detected" },
      rollback: {
        rollbackError: "manual-change-detected",
        operationLog: {
          title: "Agent Change Set",
          statusLabel: "Rollback blocked",
          rollbackBlocked: true,
          canRevert: false,
          isGitDiff: false,
        },
      },
    },
    latestMarkdownPath: path.join(reportDir, "agent-change-safety-smoke-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "agent-change-safety-smoke-latest.md"), "# Agent Safety\n", "utf8")
  fs.writeFileSync(path.join(reportDir, "router-calibration-smoke-latest.json"), `${JSON.stringify({
    reportKind: "router-calibration-smoke",
    ready: true,
    status: "ready",
    minSamples: 100,
    summary: {
      total: 120,
      passed: 120,
      failed: 0,
      routerAligned: 120,
      recommendationAligned: 120,
      misaligned: 0,
      failureReports: 0,
      sampleCountOk: true,
      failureReportOk: true,
    },
    shadow: { recommendation: "keep-current-router" },
    latestMarkdownPath: path.join(reportDir, "router-calibration-smoke-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "router-calibration-smoke-latest.md"), "# Router\n", "utf8")
  fs.writeFileSync(path.join(reportDir, "beta-trial-plan-latest.json"), `${JSON.stringify({
    reportKind: "bd-user-trial-plan",
    ready: true,
    status: "ready",
    statusLabel: "BD 真实用户试运行计划已就绪",
    summary: { total: 7, passed: 7, failed: 0, requiredTasks: 10, startupChecks: 5, screenshotItems: 8 },
    checks: [
      { id: "bd_task_count", status: "passed", passed: true },
      { id: "single_agent_tasks", status: "passed", passed: true },
      { id: "multi_agent_tasks", status: "passed", passed: true },
      { id: "attachment_task", status: "passed", passed: true },
      { id: "accept_rollback_task", status: "passed", passed: true },
      { id: "quality_gate_failure_task", status: "passed", passed: true },
      { id: "privacy_boundary", status: "passed", passed: true },
    ],
    tasks: [
      { id: "BD-T01", title: "单文件文案修复", expectedStrategy: "single-agent", required: true },
      { id: "BD-T02", title: "单文件 bug 修复", expectedStrategy: "single-agent", required: true },
      { id: "BD-T03", title: "多文件 UI 整改", expectedStrategy: "multi-agent", required: true },
      { id: "BD-T04", title: "工作台行为修复", expectedStrategy: "multi-agent", required: true },
      { id: "BD-T05", title: "质量门失败恢复", expectedStrategy: "single-agent", requiredResult: "质量门失败分类", required: true },
      { id: "BD-T06", title: "回滚验证", expectedStrategy: "single-agent", requiredResult: "rollback", required: true },
      { id: "BD-T07", title: "附件输入", expectedStrategy: "single-agent", required: true },
      { id: "BD-T08", title: "用户澄清", expectedStrategy: "single-agent", required: true },
      { id: "BD-T09", title: "隐私边界", expectedStrategy: "single-agent", required: true },
      { id: "BD-T10", title: "发布证据链", expectedStrategy: "multi-agent", required: true },
    ],
    privacyPolicy: {
      allow: ["task id", "run id", "strategy", "status", "file count", "hash"],
      deny: ["prompt text", "attachment body", "source code body", "full command output", "secret values"],
    },
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "beta-trial-plan-latest.md"), "# Beta Plan\n", "utf8")
  fs.writeFileSync(path.join(reportDir, "beta-trial-run-latest.json"), `${JSON.stringify({
    reportKind: "be-beta-trial-run",
    ready: true,
    status: "ready",
    statusLabel: "真实 Beta 执行闭环已就绪",
    summary: { total: 10, passed: 10, failed: 0, blocked: 0, p0: 0, p1: 0, p2: 0 },
    coverage: {
      singleAgent: true,
      multiAgent: true,
      attachment: true,
      rollback: true,
      qualityGateFailure: true,
      clarification: true,
      releaseEvidence: true,
    },
    defects: [],
    betaFeedback: {
      available: true,
      ready: true,
      status: "ready",
      statusLabel: "人工 Beta 反馈已收敛",
      total: 10,
      imported: 10,
      rejected: 0,
      privacyViolations: 0,
      screenshotCount: 4,
      pendingRegression: 0,
      p0: 0,
      p1: 0,
      p2: 0,
      entries: [
        { feedbackId: "fb-1", taskId: "BD-T01", status: "passed", score: 5, hasRegressionEvidence: true },
      ],
    },
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "beta-trial-run-latest.md"), "# Beta Run\n", "utf8")

  const result = await router.dispatch({
    method: "POST",
    path: "/api/orchestrator/release-evidence/export",
    body: { reportDir },
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.report.reportKind, "release-evidence")
  assert.equal(result.data.report.evidence.workbenchRealProjectUi.ready, true)
  assert.equal(result.data.report.evidence.explorerFsParity.ready, true)
  assert.equal(result.data.report.evidence.explorerFsParity.passed, 4)
  assert.equal(result.data.report.evidence.shellIntegration.ready, true)
  assert.equal(result.data.report.evidence.debugAdapterSmoke.ready, true)
  assert.equal(result.data.report.evidence.agentChangeSafety.ready, true)
  assert.equal(result.data.report.evidence.routerCalibration.ready, true)
  assert.equal(result.data.report.evidence.bdUserTrial.ready, true)
  assert.equal(result.data.report.evidence.betaTrialRun.ready, true)
  assert.equal(result.data.report.evidence.betaFeedback.ready, true)
  assert.equal(result.data.report.gaps.some((gap) => gap.id === "workbench_real_project_ui"), false)
  assert.equal(result.data.report.gaps.some((gap) => gap.id === "explorer_fs_parity"), false)
  assert.equal(result.data.report.gaps.some((gap) => gap.id === "shell_integration_smoke"), false)
  assert.equal(result.data.report.gaps.some((gap) => gap.id === "debug_adapter_smoke"), false)
  assert.equal(result.data.report.gaps.some((gap) => gap.id === "agent_change_safety_smoke"), false)
  assert.equal(result.data.report.gaps.some((gap) => gap.id === "router_calibration_smoke"), false)
  assert.equal(result.data.report.gaps.some((gap) => gap.id === "bd_user_trial"), false)
  assert.equal(result.data.report.gaps.some((gap) => gap.id === "be_beta_trial_run"), false)
  assert.equal(result.data.report.gaps.some((gap) => gap.id === "bf_beta_feedback"), false)
  assert.match(result.data.markdownPath, /release-evidence-latest\.md$/)
  assert.match(result.data.jsonPath, /release-evidence-latest\.json$/)
  assert.equal(fs.existsSync(result.data.markdownPath), true)
  assert.match(result.data.markdown, /发布验收证据链摘要/)

  const latest = await router.dispatch({
    method: "GET",
    path: `/api/orchestrator/release-evidence/latest?reportDir=${encodeURIComponent(reportDir)}`,
  })
  assert.equal(latest.ok, true)
  assert.equal(latest.data.report.reportKind, "release-evidence")
  assert.equal(latest.data.history.length, 1)
})

test("orchestrator product-grade route exposes latest AU gate report", async () => {
  router.clearRoutes()
  routes.register(router)
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-product-grade-route-"))
  const { buildProductGradeGate, saveProductGradeGate } = require("../../../scripts/au-product-grade-gate")
  const report = buildProductGradeGate({
    createdAt: 100,
    reportDir,
    releaseGate: { ready: true, mode: "product-grade" },
    releaseEvidence: { ready: true, summary: { total: 8, ready: 8 } },
    workbenchDeep: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
    extensions: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
    provider: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
    performance: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
    acceptance: {
      ready: true,
      passed: 10,
      total: 10,
      matrix: { passed: 10, total: 10, failed: 0 },
      routerData: { recommendation: "keep-current-router" },
      failureRecommendations: { total: 0 },
    },
    readiness: { ready: true, summary: { passed: 1, total: 1 } },
    realTrial: { realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    securityEvidence: {
      ready: true,
      summary: { total: 4, passed: 4, warning: 0, failed: 0 },
      checks: [
        { id: "permission_policy", status: "passed" },
        { id: "workspace_lease", status: "passed" },
        { id: "proposal_only_trial", status: "passed" },
        { id: "sandbox_security_release_evidence", status: "passed" },
      ],
    },
    usage: { totalRequests: 1 },
  })
  saveProductGradeGate(report, { reportDir })

  const latest = await router.dispatch({
    method: "GET",
    path: `/api/orchestrator/product-grade/latest?reportDir=${encodeURIComponent(reportDir)}`,
  })

  assert.equal(latest.ok, true)
  assert.equal(latest.data.report.reportKind, "au-product-grade-gate")
  assert.equal(latest.data.report.ready, true)
  assert.match(latest.data.markdown, /AU 产品级/)
})

test("orchestrator readiness route reports enterprise preflight status", async () => {
  orchestrator.reset()
  router.clearRoutes()
  routes.register(router)

  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-readiness-route-"))
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true })
  const result = await router.dispatch({
    method: "POST",
    path: "/api/orchestrator/readiness/check",
    body: {
      projectRoot,
      settings: {
        "codek.agent.realWorkspaceTrial.allowedPaths": ["src"],
        "codek.agent.realWorkspaceTrial.qualityGateCommands": ["npm run typecheck"],
      },
      reportDir: fs.mkdtempSync(path.join(os.tmpdir(), "codek-readiness-route-reports-")),
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.report.reportKind, "orchestrator-readiness")
  assert.equal(result.data.report.projectRoot, projectRoot)
  assert.match(result.data.markdownPath, /orchestrator-readiness-latest\.md$/)
  assert.equal(Array.isArray(result.data.history), true)
  assert.ok(["ready", "degraded"].includes(result.data.report.status))
  assert.ok(result.data.report.checks.some((check) => check.id === "workspace_root" && check.status === "passed"))
  assert.equal(Array.isArray(result.data.report.remediations), true)
})

test("orchestrator readiness action audit route records applied remediation", async () => {
  router.clearRoutes()
  routes.register(router)
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-readiness-action-route-"))

  const saved = await router.dispatch({
    method: "POST",
    path: "/api/orchestrator/readiness/actions/audit",
    body: {
      reportDir,
      actionId: "apply_safe_defaults",
      title: "应用安全默认配置",
      status: "applied",
      projectRoot: "D:/Workspace",
      summary: "写入安全默认配置",
      settingKeys: ["codek.agent.realWorkspaceTrial.allowedPaths"],
    },
  })
  const latest = await router.dispatch({
    method: "GET",
    path: `/api/orchestrator/readiness/actions/audit?reportDir=${encodeURIComponent(reportDir)}`,
  })

  assert.equal(saved.ok, true)
  assert.equal(saved.data.entry.actionId, "apply_safe_defaults")
  assert.match(saved.data.auditPath, /orchestrator-readiness-actions\.jsonl$/)
  assert.equal(latest.ok, true)
  assert.equal(latest.data.history.length, 1)
  assert.equal(latest.data.history[0].projectRoot, "D:/Workspace")
})

test("orchestrator run action audit route records primary control actions", async () => {
  router.clearRoutes()
  routes.register(router)
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-run-action-route-"))

  const saved = await router.dispatch({
    method: "POST",
    path: "/api/orchestrator/run-actions/audit",
    body: {
      reportDir,
      startedAt: 1000,
      finishedAt: 1125,
      runId: "run_primary",
      actionId: "start-trial",
      title: "发起试运行",
      status: "success",
      projectRoot: "D:/Workspace",
      summary: "proposal-only 真实工作区试运行已发起",
      metadata: { source: "orchestrator-run-control" },
    },
  })
  const latest = await router.dispatch({
    method: "GET",
    path: `/api/orchestrator/run-actions/audit?reportDir=${encodeURIComponent(reportDir)}`,
  })

  assert.equal(saved.ok, true)
  assert.equal(saved.data.entry.actionId, "start-trial")
  assert.equal(saved.data.entry.durationMs, 125)
  assert.match(saved.data.auditPath, /orchestrator-run-actions\.jsonl$/)
  assert.equal(latest.ok, true)
  assert.equal(latest.data.history.length, 1)
  assert.equal(latest.data.history[0].runId, "run_primary")
})

test("orchestrator task route creates an auditable agent run", async () => {
  orchestrator.reset()
  router.clearRoutes()
  routes.register(router)

  const result = await router.dispatch({
    method: "POST",
    path: "/api/orchestrator/tasks",
    body: {
      message: "修复 frontend/vite-project/src/App.vue 并运行 typecheck",
      mode: "agent",
      projectRoot: "D:/Workspace",
      files: ["frontend/vite-project/src/App.vue"],
    },
  })

  assert.equal(result.ok, true)
  assert.match(result.data.task.id, /^task_/)
  assert.match(result.data.task.runId, /^run_/)
  assert.equal(result.data.task.status, "planning")
  assert.equal(result.data.task.visibleMode, "agent")
  assert.equal(result.data.task.routerDecision.visibleMode, "agent")
  assert.equal(result.data.task.routerDecision.executionStrategy, result.data.run.executionStrategy)
  assert.equal(result.data.task.requiresConfirmation, false)
  assert.equal(result.data.run.id, result.data.task.runId)
  assert.equal(result.data.run.goalId, result.data.task.id)
  assert.equal(result.data.run.userInput, "修复 frontend/vite-project/src/App.vue 并运行 typecheck")
  assert.ok(result.data.run.strategyReason)
  assert.equal(Array.isArray(result.data.run.decisionLog), true)
  assert.equal(result.data.run.decisionLog[0].type, "router")
  assert.equal(result.data.run.decisionLog[0].selectedOption, result.data.run.executionStrategy)
  assert.equal(result.data.run.decisionLog[0].reason, result.data.run.strategyReason)

  const listed = await router.dispatch({ method: "GET", path: "/api/orchestrator/tasks" })
  assert.equal(listed.ok, true)
  assert.equal(listed.data.tasks[0].id, result.data.task.id)
  assert.equal(listed.data.tasks[0].runId, result.data.task.runId)
})

test("orchestrator task route blocks high risk agent requests for confirmation", async () => {
  orchestrator.reset()
  router.clearRoutes()
  routes.register(router)

  const result = await router.dispatch({
    method: "POST",
    path: "/api/orchestrator/tasks",
    body: {
      message: "删除 src 目录并发布到生产环境",
      mode: "agent",
      projectRoot: "D:/Workspace",
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.task.status, "waiting_user")
  assert.equal(result.data.task.requiresConfirmation, true)
  assert.match(result.data.task.blockingReason, /确认/)
  assert.equal(result.data.run.status, "waiting_user")
  assert.equal(result.data.run.strategySignals.risk, "high")
  assert.equal(result.data.run.integrationDecision, null)
  assert.equal(result.data.run.decisionLog.some((item) => item.type === "permission_block"), true)
  const permissionBlock = result.data.run.decisionLog.find((item) => item.type === "permission_block")
  assert.equal(permissionBlock.risk, "high")
  assert.equal(permissionBlock.userConfirmed, false)
})

test("task center route aggregates goals and orchestrator runs", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-task-center-"))
  process.env.CODEK_DATA = dataDir
  const goalStorePath = require.resolve("../goalStore")
  delete require.cache[goalStorePath]
  const goalStore = require("../goalStore")

  orchestrator.reset()
  router.clearRoutes()
  routes.register(router)
  require("../goalRoutes").register(router)

  const goal = goalStore.createGoal("后台目标任务", dataDir)
  const created = await router.dispatch({
    method: "POST",
    path: "/api/orchestrator/tasks",
    body: {
      message: "修复 ChatAI Agent 入口",
      mode: "agent",
      projectRoot: dataDir,
    },
  })

  const center = await router.dispatch({ method: "GET", path: "/api/tasks/center" })

  assert.equal(created.ok, true)
  assert.equal(center.ok, true)
  assert.equal(center.data.summary.total >= 2, true)
  assert.equal(center.data.tasks.some((task) => task.kind === "goal" && task.id === goal.id), true)
  assert.equal(center.data.tasks.some((task) => task.kind === "orchestrator" && task.runId === created.data.run.id), true)
  assert.equal(center.data.tasks.find((task) => task.runId === created.data.run.id).routerDecision.executionStrategy, created.data.run.executionStrategy)
  assert.equal(center.data.tasks.find((task) => task.runId === created.data.run.id).runtimeStatus, "planned")
  assert.equal(center.data.tasks.find((task) => task.kind === "goal" && task.id === goal.id).runtimeStatus, "queued")
})

test("orchestrator exposes checkpoints for waiting user runs and resume", async () => {
  orchestrator.reset()
  router.clearRoutes()
  routes.register(router)

  const created = await router.dispatch({
    method: "POST",
    path: "/api/orchestrator/tasks",
    body: {
      message: "删除 src 目录",
      mode: "agent",
      projectRoot: "D:/Workspace",
    },
  })
  const runId = created.data.run.id

  const checkpoints = await router.dispatch({
    method: "GET",
    path: `/api/orchestrator/runs/${encodeURIComponent(runId)}/checkpoints`,
  })
  assert.equal(checkpoints.ok, true)
  assert.equal(checkpoints.data.checkpoints.length >= 1, true)
  assert.equal(checkpoints.data.checkpoints[0].canResume, true)
  assert.equal(checkpoints.data.latest.id, checkpoints.data.checkpoints[0].id)

  const resumed = await router.dispatch({
    method: "POST",
    path: `/api/orchestrator/runs/${encodeURIComponent(runId)}/resume`,
  })
  assert.equal(resumed.ok, true)
  assert.equal(resumed.data.resumed, true)
  assert.equal(resumed.data.checkpoint.id, checkpoints.data.latest.id)
  assert.equal(resumed.data.run.status, "waiting_user")
  assert.equal(resumed.data.run.decisionLog.some((item) => item.type === "checkpoint_resumed"), true)
})

test("orchestrator pause route persists a resumable checkpoint and resume restores runtime state", async () => {
  orchestrator.reset()
  router.clearRoutes()
  routes.register(router)

  const run = orchestrator.createRun({
    projectRoot: "D:/Workspace",
    visibleMode: "agent",
    userInput: "long running task",
  })
  const mutable = orchestrator._unsafeGetMutableRunForTest(run.id)
  mutable.status = "running"
  mutable.summary = "background task"

  const paused = await router.dispatch({
    method: "POST",
    path: `/api/orchestrator/runs/${encodeURIComponent(run.id)}/pause`,
    body: { reason: "pause for smoke" },
  })
  assert.equal(paused.ok, true)
  assert.equal(paused.data.paused, true)
  assert.equal(paused.data.run.status, "paused")
  assert.equal(paused.data.checkpoint.canResume, true)
  assert.equal(paused.data.checkpoint.previousStatus, "running")

  const resumed = await router.dispatch({
    method: "POST",
    path: `/api/orchestrator/runs/${encodeURIComponent(run.id)}/resume`,
  })
  assert.equal(resumed.ok, true)
  assert.equal(resumed.data.resumed, true)
  assert.equal(resumed.data.run.status, "running")
  assert.equal(resumed.data.run.decisionLog.some((item) => item.type === "run_paused"), true)
  assert.equal(resumed.data.run.decisionLog.some((item) => item.type === "checkpoint_resumed"), true)
})

test("orchestrator exposes decision audit log route and records user decisions", async () => {
  orchestrator.reset()
  router.clearRoutes()
  routes.register(router)

  const created = await router.dispatch({
    method: "POST",
    path: "/api/orchestrator/tasks",
    body: {
      message: "删除 src 目录",
      mode: "agent",
      projectRoot: "D:/Workspace",
    },
  })
  const runId = created.data.run.id

  const rejected = await router.dispatch({
    method: "POST",
    path: `/api/orchestrator/runs/${encodeURIComponent(runId)}/decision`,
    body: { decision: "rejected", reason: "风险过高" },
  })
  assert.equal(rejected.ok, true)
  assert.equal(rejected.data.run.status, "cancelled")
  assert.equal(rejected.data.run.decisionLog.some((item) => item.type === "user_decision" && item.selectedOption === "rejected"), true)

  const audit = await router.dispatch({
    method: "GET",
    path: `/api/orchestrator/runs/${encodeURIComponent(runId)}/decisions`,
  })
  assert.equal(audit.ok, true)
  assert.equal(audit.data.decisions.length >= 3, true)
  assert.equal(audit.data.decisions.some((item) => item.type === "router"), true)
  assert.equal(audit.data.decisions.some((item) => item.type === "user_decision"), true)
})

test("orchestrator creates and resolves sandbox permission requests", async () => {
  orchestrator.reset()
  router.clearRoutes()
  routes.register(router)

  const created = await router.dispatch({
    method: "POST",
    path: "/api/orchestrator/tasks",
    body: {
      message: "删除 src 目录并安装依赖后发布",
      mode: "auto",
      projectRoot: "D:/Workspace",
      files: ["src"],
    },
  })
  assert.equal(created.ok, true)
  assert.equal(created.data.run.status, "waiting_user")
  assert.equal(created.data.run.runtimeStatus, "blocked")
  assert.equal(created.data.run.permissionRequest.status, "waiting_user")
  assert.equal(created.data.run.permissionRequest.destructive, true)
  assert.equal(created.data.run.permissionRequest.network, true)
  assert.deepEqual(created.data.run.permissionRequest.writePaths, ["src"])

  const allowed = await router.dispatch({
    method: "POST",
    path: `/api/orchestrator/runs/${encodeURIComponent(created.data.run.id)}/permission`,
    body: { decision: "approved", reason: "允许在 src 范围内继续" },
  })
  assert.equal(allowed.ok, true)
  assert.equal(allowed.data.run.status, "planning")
  assert.equal(allowed.data.run.runtimeStatus, "planned")
  assert.equal(allowed.data.run.permissionRequest.status, "approved")
  assert.equal(allowed.data.run.decisionLog.some((item) => item.type === "permission_decision" && item.selectedOption === "approved"), true)

  const deniedTask = await router.dispatch({
    method: "POST",
    path: "/api/orchestrator/tasks",
    body: {
      message: "删除 dist 目录",
      mode: "agent",
      projectRoot: "D:/Workspace",
      files: ["dist"],
    },
  })
  const denied = await router.dispatch({
    method: "POST",
    path: `/api/orchestrator/runs/${encodeURIComponent(deniedTask.data.run.id)}/permission`,
    body: { decision: "rejected", reason: "不允许删除" },
  })
  assert.equal(denied.ok, true)
  assert.equal(denied.data.run.status, "cancelled")
  assert.equal(denied.data.run.runtimeStatus, "blocked")
  assert.equal(denied.data.run.permissionRequest.status, "rejected")
})

test("orchestrator acceptance routes expose latest and run reports", async () => {
  router.clearRoutes()
  routes.register(router)
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-acceptance-route-"))

  const empty = await router.dispatch({
    method: "GET",
    path: `/api/orchestrator/acceptance/latest?reportDir=${encodeURIComponent(reportDir)}`,
  })
  assert.equal(empty.ok, true)
  assert.equal(empty.data.report, null)

  const run = await router.dispatch({
    method: "POST",
    path: "/api/orchestrator/acceptance/run",
    body: { reportDir },
  })
  assert.equal(run.ok, true)
  assert.equal(run.data.report.ready, true)
  assert.ok(run.data.report.matrix.total >= 10)
  assert.equal(run.data.report.matrix.failed, 0)
  assert.equal(run.data.report.routerData.recommendation, "keep-current-router")
  assert.equal(run.data.history.length, 1)
  assert.ok(run.data.history[0].matrix.total >= 10)
  assert.match(run.data.markdownPath, /real-project-smoke-latest\.md$/)

  const latest = await router.dispatch({
    method: "GET",
    path: `/api/orchestrator/acceptance/latest?reportDir=${encodeURIComponent(reportDir)}`,
  })
  assert.equal(latest.ok, true)
  assert.equal(latest.data.report.total, run.data.report.total)
  assert.equal(latest.data.history.length, 1)
  assert.match(latest.data.markdown, /## Matrix/)
  assert.match(latest.data.markdown, /## Scenario Groups/)
  assert.match(latest.data.markdown, /## Router Data/)
})

test("orchestrator release gate routes expose latest and run reports", async () => {
  router.clearRoutes()
  routes.register(router)
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-gate-route-"))

  const empty = await router.dispatch({
    method: "GET",
    path: `/api/orchestrator/release-gate/latest?reportDir=${encodeURIComponent(reportDir)}`,
  })
  assert.equal(empty.ok, true)
  assert.equal(empty.data.report, null)
  assert.match(empty.data.jsonPath, /release-gate-latest\.json$/)

  const run = await router.dispatch({
    method: "POST",
    path: "/api/orchestrator/release-gate/run",
    body: { reportDir, mode: "quick" },
  })
  assert.equal(run.ok, true)
  assert.equal(run.data.report.ready, true)
  assert.equal(run.data.report.mode, "quick")
  assert.deepEqual(run.data.report.plannedSteps, ["typecheck", "i_j_smoke_tests", "smoke_j", "real_workspace_trial_smoke"])
  assert.match(run.data.jsonPath, /release-gate-latest\.json$/)

  const latest = await router.dispatch({
    method: "GET",
    path: `/api/orchestrator/release-gate/latest?reportDir=${encodeURIComponent(reportDir)}`,
  })
  assert.equal(latest.ok, true)
  assert.equal(latest.data.report.ready, true)
  assert.equal(latest.data.report.mode, "quick")
})

test("orchestrator release ci route exposes workflow and evidence checks", async () => {
  router.clearRoutes()
  routes.register(router)

  const result = await router.dispatch({
    method: "GET",
    path: "/api/orchestrator/release-ci/check",
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.ok, true)
  assert.equal(result.data.checks.some((check) => check.id === "no_full_mode"), true)
  assert.equal(typeof result.data.releaseEvidence.evidencePath, "string")
})

test("orchestrator run report route returns Chinese task report markdown", async () => {
  orchestrator.reset()
  router.clearRoutes()
  routes.register(router)
  const run = orchestrator.createRun({
    projectRoot: os.tmpdir(),
    visibleMode: "agent",
    userInput: "生成任务报告",
    strategyDecision: {
      visibleMode: "agent",
      executionStrategy: "multi-agent",
      reason: "测试报告",
      signals: { risk: "medium" },
    },
  })
  const rawRun = orchestrator._unsafeGetMutableRunForTest(run.id)
  rawRun.status = "waiting_user"
  rawRun.integrationDecision = {
    id: "decision_report",
    runId: run.id,
    status: "pending",
    conflicts: [],
    proposedPatch: { summary: "报告 patch", filesChanged: ["demo.js"], patches: [] },
    reason: "等待确认",
  }

  const report = await router.dispatch({
    method: "GET",
    path: `/api/orchestrator/runs/${encodeURIComponent(run.id)}/report`,
  })

  assert.equal(report.ok, true)
  assert.equal(report.data.report.userGoal, "生成任务报告")
  assert.equal(report.data.report.writeMode, "proposed_patch_only")
  assert.match(report.data.markdown, /Codek 自主 Agent 任务报告/)
  assert.match(report.data.markdown, /## Router 选择/)
  assert.match(report.data.markdown, /## 决策审计/)
})

test("orchestrator assigns isolated snapshot workspaces to phases in non-git projects", async () => {
  orchestrator.reset()
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-orchestrator-"))
  fs.writeFileSync(path.join(projectRoot, "demo.js"), "export const value = 1\n", "utf8")
  const plan = planTree.createPlan("demo", [
    { id: "phase_1", name: "实现改动", tasks: [{ description: "修改 demo.js", files: ["demo.js"] }] },
  ])
  const originalExecute = planExecutor.execute
  planExecutor.execute = async ({ plan, emit }) => {
    assert.match(plan.phases[0].workspaceRoot, /\.codek[\\/]snapshots/)
    fs.writeFileSync(path.join(plan.phases[0].workspaceRoot, "demo.js"), "export const value = 2\n", "utf8")
    emit({ type: "phase_start", phaseId: "phase_1" })
    emit({ type: "phase_done", phaseId: "phase_1", summary: "done", filesChanged: ["demo.js"] })
    return { plan, summary: "done" }
  }

  let run
  try {
    run = await orchestrator.startRun({
      projectRoot,
      visibleMode: "agent",
      userInput: "修改 demo.js",
      plan,
      workspaceIsolation: "auto",
    })
  } finally {
    planExecutor.execute = originalExecute
  }

  assert.equal(run.status, "waiting_user")
  assert.equal(run.assignments[0].workspace.isolation, "snapshot")
  assert.match(run.assignments[0].workspace.root, /\.codek[\\/]snapshots/)
  assert.notEqual(run.assignments[0].workspace.root, projectRoot)
  assert.equal(run.integrationDecision.proposedPatch.patches.length, 1)
  assert.deepEqual(run.integrationDecision.proposedPatch.filesChanged, ["demo.js"])
  assert.equal(fs.readFileSync(path.join(projectRoot, "demo.js"), "utf8"), "export const value = 1\n")
})

test("orchestrator real workspace trial entry creates proposal-only runs", async () => {
  orchestrator.reset()
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-real-trial-"))
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, "src", "app.js"), "export const value = 1\n", "utf8")
  const plan = planTree.createPlan("real trial", [
    { id: "phase_1", name: "实现真实工作区试运行改动", tasks: [{ description: "修改 src/app.js", files: ["src/app.js"] }] },
  ])
  const originalExecute = planExecutor.execute
  planExecutor.execute = async ({ plan, emit }) => {
    fs.writeFileSync(path.join(plan.phases[0].workspaceRoot, "src", "app.js"), "export const value = 2\n", "utf8")
    emit({ type: "phase_start", phaseId: "phase_1" })
    emit({ type: "phase_done", phaseId: "phase_1", summary: "done", filesChanged: ["src/app.js"] })
    return { plan, summary: "done" }
  }

  let run
  try {
    run = await orchestrator.startRealWorkspaceTrial({
      projectRoot,
      userInput: "真实项目试运行修改 src/app.js",
      files: ["src/app.js"],
      plan,
      settings: {
        "codek.agent.realWorkspaceTrial.allowedPaths": ["src"],
        "codek.agent.realWorkspaceTrial.qualityGateCommands": ["npm run typecheck", "npm install"],
      },
    })
  } finally {
    planExecutor.execute = originalExecute
  }

  assert.equal(run.status, "waiting_user")
  assert.equal(run.policyProfile, "real-workspace-trial")
  assert.equal(run.realWorkspaceTrial.writeMode, "proposed_patch_only")
  assert.deepEqual(run.realWorkspaceTrial.allowedPaths, ["src"])
  assert.deepEqual(run.qualityGateCommands, ["npm run typecheck"])
  assert.deepEqual(run.realWorkspaceTrial.blockedQualityGateCommands, ["npm install"])
  assert.deepEqual(run.integrationDecision.proposedPatch.filesChanged, ["src/app.js"])
  assert.equal(fs.readFileSync(path.join(projectRoot, "src", "app.js"), "utf8"), "export const value = 1\n")

  const report = orchestrator.getRunReport(run.id)
  assert.equal(report.realWorkspaceTrial.mainWorkspaceUntouchedBeforeAccept, true)
  assert.match(report.markdown, /Real Workspace Trial/)
})

test("orchestrator real workspace trial blocks when enterprise readiness has hard failures", async () => {
  orchestrator.reset()
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-real-trial-readiness-"))
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, "src", "app.js"), "export const value = 1\n", "utf8")

  const run = await orchestrator.startRealWorkspaceTrial({
    projectRoot,
    userInput: "真实试运行但未配置允许路径",
    settings: {
      "codek.agent.realWorkspaceTrial.allowedPaths": [],
      "codek.agent.realWorkspaceTrial.qualityGateCommands": ["npm run typecheck"],
    },
  })

  assert.equal(run.status, "waiting_user")
  assert.equal(run.assignments.length, 0)
  assert.match(run.blockingReason, /允许路径/)
  assert.equal(run.decisionLog.some((item) => item.type === "readiness_block"), true)
  assert.equal(run.events.some((item) => item.type === "orchestrator:readiness_blocked"), true)
})

test("orchestrator accepted decision applies patch and passes quality gate", async () => {
  orchestrator.reset()
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-apply-ok-"))
  fs.writeFileSync(path.join(projectRoot, "demo.js"), "export const value = 1\n", "utf8")
  const plan = planTree.createPlan("demo", [
    { id: "phase_1", name: "实现改动", tasks: [{ description: "修改 demo.js", files: ["demo.js"] }] },
  ])
  const originalExecute = planExecutor.execute
  planExecutor.execute = async ({ plan, emit }) => {
    fs.writeFileSync(path.join(plan.phases[0].workspaceRoot, "demo.js"), "export const value = 2\n", "utf8")
    emit({ type: "phase_start", phaseId: "phase_1" })
    emit({ type: "phase_done", phaseId: "phase_1", summary: "done", filesChanged: ["demo.js"] })
    return { plan, summary: "done" }
  }

  let run
  try {
    run = await orchestrator.startRun({
      projectRoot,
      visibleMode: "agent",
      userInput: "修改 demo.js",
      plan,
      workspaceIsolation: "auto",
      qualityGateCommands: ["node --test"],
    })
  } finally {
    planExecutor.execute = originalExecute
  }

  assert.equal(run.status, "waiting_user")
  const decision = orchestrator.applyDecision(run.id, "accepted")
  assert.equal(decision.status, "accepted")
  const updated = orchestrator.getRun(run.id)
  assert.equal(updated.status, "completed")
  assert.equal(fs.readFileSync(path.join(projectRoot, "demo.js"), "utf8").replace(/\r\n/g, "\n"), "export const value = 2\n")
  assert.equal(artifactStore.listArtifacts(run.id, { type: "quality-gate" }).length, 1)
})

test("orchestrator accept blocks when protected file has manual changes", async () => {
  orchestrator.reset()
  const projectRoot = createGitProject("codek-accept-conflict-")
  fs.writeFileSync(path.join(projectRoot, "demo.js"), "export const value = 1\n", "utf8")
  git(["add", "demo.js"], projectRoot)
  git(["commit", "-m", "init"], projectRoot)
  const plan = planTree.createPlan("demo", [
    { id: "phase_1", name: "实现改动", tasks: [{ description: "修改 demo.js", files: ["demo.js"] }] },
  ])
  const originalExecute = planExecutor.execute
  planExecutor.execute = async ({ plan, emit }) => {
    fs.writeFileSync(path.join(plan.phases[0].workspaceRoot, "demo.js"), "export const value = 2\n", "utf8")
    emit({ type: "phase_start", phaseId: "phase_1" })
    emit({ type: "phase_done", phaseId: "phase_1", summary: "done", filesChanged: ["demo.js"] })
    return { plan, summary: "done" }
  }

  let run
  try {
    run = await orchestrator.startRun({
      projectRoot,
      visibleMode: "agent",
      userInput: "修改 demo.js",
      plan,
      workspaceIsolation: "auto",
    })
  } finally {
    planExecutor.execute = originalExecute
  }

  fs.writeFileSync(path.join(projectRoot, "demo.js"), "export const value = 99\n", "utf8")
  const decision = orchestrator.applyDecision(run.id, "accepted")

  assert.equal(decision.status, "rework_requested")
  assert.match(decision.reason, /Accept blocked/)
  assert.equal(decision.conflictProtection.reason, "manual-change-detected-before-accept")
  assert.deepEqual(decision.conflictProtection.dirtyFiles.map((item) => item.path), ["demo.js"])
  assert.equal(fs.readFileSync(path.join(projectRoot, "demo.js"), "utf8"), "export const value = 99\n")
  assert.equal(orchestrator.listDecisions(run.id).some((item) => item.type === "conflict_protection"), true)
})

test("orchestrator blocks proposed patch outside approved permission write paths", async () => {
  orchestrator.reset()
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-permission-path-"))
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, "src", "app.js"), "export const value = 1\n", "utf8")
  fs.writeFileSync(path.join(projectRoot, "package.json"), "{\"name\":\"demo\"}\n", "utf8")
  const plan = planTree.createPlan("demo", [
    { id: "phase_1", name: "实现改动", tasks: [{ description: "修改 src/app.js", files: ["src/app.js"] }] },
  ])
  const originalExecute = planExecutor.execute
  planExecutor.execute = async ({ plan, emit }) => {
    fs.writeFileSync(path.join(plan.phases[0].workspaceRoot, "package.json"), "{\"name\":\"changed\"}\n", "utf8")
    emit({ type: "phase_start", phaseId: "phase_1" })
    emit({ type: "phase_done", phaseId: "phase_1", summary: "done", filesChanged: ["package.json"] })
    return { plan, summary: "done" }
  }

  let run
  try {
    run = await orchestrator.startRun({
      projectRoot,
      visibleMode: "agent",
      userInput: "修改 src/app.js",
      plan,
      workspaceIsolation: "auto",
    })
  } finally {
    planExecutor.execute = originalExecute
  }
  const rawRun = orchestrator._unsafeGetMutableRunForTest(run.id)
  rawRun.permissionRequest = {
    id: "permission_test",
    runId: run.id,
    status: "approved",
    risk: "high",
    readPaths: ["src"],
    writePaths: ["src"],
    commandAllowlist: [],
    network: false,
    install: false,
    externalTool: false,
    destructive: false,
    reason: "只允许 src",
    createdAt: Date.now(),
  }

  const decision = orchestrator.applyDecision(run.id, "accepted")
  assert.equal(decision.status, "rework_requested")
  assert.match(decision.reason, /未授权写路径/)
  assert.equal(orchestrator.getRun(run.id).runtimeStatus, "blocked")
  assert.equal(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"), "{\"name\":\"demo\"}\n")
  assert.equal(orchestrator.listDecisions(run.id).some((item) => item.type === "permission_violation"), true)
})

test("orchestrator blocks quality gate commands outside approved permission allowlist", async () => {
  orchestrator.reset()
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-permission-command-"))
  fs.writeFileSync(path.join(projectRoot, "demo.js"), "export const value = 1\n", "utf8")
  const plan = planTree.createPlan("demo", [
    { id: "phase_1", name: "实现改动", tasks: [{ description: "修改 demo.js", files: ["demo.js"] }] },
  ])
  const originalExecute = planExecutor.execute
  planExecutor.execute = async ({ plan, emit }) => {
    fs.writeFileSync(path.join(plan.phases[0].workspaceRoot, "demo.js"), "export const value = 2\n", "utf8")
    emit({ type: "phase_start", phaseId: "phase_1" })
    emit({ type: "phase_done", phaseId: "phase_1", summary: "done", filesChanged: ["demo.js"] })
    return { plan, summary: "done" }
  }

  let run
  try {
    run = await orchestrator.startRun({
      projectRoot,
      visibleMode: "agent",
      userInput: "修改 demo.js",
      plan,
      workspaceIsolation: "auto",
      qualityGateCommands: ["npm install"],
    })
  } finally {
    planExecutor.execute = originalExecute
  }
  const rawRun = orchestrator._unsafeGetMutableRunForTest(run.id)
  rawRun.permissionRequest = {
    id: "permission_test_command",
    runId: run.id,
    status: "approved",
    risk: "high",
    readPaths: ["demo.js"],
    writePaths: ["demo.js"],
    commandAllowlist: ["npm run build"],
    network: true,
    install: false,
    externalTool: false,
    destructive: false,
    reason: "只允许构建",
    createdAt: Date.now(),
  }

  const decision = orchestrator.applyDecision(run.id, "accepted")
  assert.equal(decision.status, "rework_requested")
  assert.match(decision.reason, /权限越界/)
  assert.equal(fs.readFileSync(path.join(projectRoot, "demo.js"), "utf8"), "export const value = 1\n")
  assert.equal(orchestrator.listDecisions(run.id).some((item) => item.type === "permission_violation"), true)
})

test("orchestrator quality gate failure requests rework and rollback restores files", async () => {
  orchestrator.reset()
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-apply-fail-"))
  fs.writeFileSync(path.join(projectRoot, "demo.js"), "export const value = 1\n", "utf8")
  const plan = planTree.createPlan("demo", [
    { id: "phase_1", name: "实现改动", tasks: [{ description: "修改 demo.js", files: ["demo.js"] }] },
  ])
  const originalExecute = planExecutor.execute
  planExecutor.execute = async ({ plan, emit }) => {
    fs.writeFileSync(path.join(plan.phases[0].workspaceRoot, "demo.js"), "export const value = 2\n", "utf8")
    emit({ type: "phase_start", phaseId: "phase_1" })
    emit({ type: "phase_done", phaseId: "phase_1", summary: "done", filesChanged: ["demo.js"] })
    return { plan, summary: "done" }
  }

  let run
  try {
    run = await orchestrator.startRun({
      projectRoot,
      visibleMode: "agent",
      userInput: "修改 demo.js",
      plan,
      workspaceIsolation: "auto",
      qualityGateCommands: ["node --test missing-test-file.js"],
    })
  } finally {
    planExecutor.execute = originalExecute
  }

  const decision = orchestrator.applyDecision(run.id, "accepted")
  assert.equal(decision.status, "rework_requested")
  assert.equal(orchestrator.getRun(run.id).status, "waiting_user")
  assert.equal(fs.readFileSync(path.join(projectRoot, "demo.js"), "utf8").replace(/\r\n/g, "\n"), "export const value = 2\n")

  const rollbackDecision = orchestrator.applyDecision(run.id, "rollback")
  assert.equal(rollbackDecision.status, "rolled_back")
  assert.equal(fs.readFileSync(path.join(projectRoot, "demo.js"), "utf8"), "export const value = 1\n")
})

test("orchestrator rollback blocks when applied file drifted after accept", async () => {
  orchestrator.reset()
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-rollback-conflict-"))
  fs.writeFileSync(path.join(projectRoot, "demo.js"), "export const value = 1\n", "utf8")
  const plan = planTree.createPlan("demo", [
    { id: "phase_1", name: "实现改动", tasks: [{ description: "修改 demo.js", files: ["demo.js"] }] },
  ])
  const originalExecute = planExecutor.execute
  planExecutor.execute = async ({ plan, emit }) => {
    fs.writeFileSync(path.join(plan.phases[0].workspaceRoot, "demo.js"), "export const value = 2\n", "utf8")
    emit({ type: "phase_start", phaseId: "phase_1" })
    emit({ type: "phase_done", phaseId: "phase_1", summary: "done", filesChanged: ["demo.js"] })
    return { plan, summary: "done" }
  }

  let run
  try {
    run = await orchestrator.startRun({
      projectRoot,
      visibleMode: "agent",
      userInput: "修改 demo.js",
      plan,
      workspaceIsolation: "auto",
      qualityGateCommands: ["node --test missing-test-file.js"],
    })
  } finally {
    planExecutor.execute = originalExecute
  }

  const decision = orchestrator.applyDecision(run.id, "accepted")
  assert.equal(decision.status, "rework_requested")
  fs.writeFileSync(path.join(projectRoot, "demo.js"), "export const value = 3\n", "utf8")

  const rollbackDecision = orchestrator.applyDecision(run.id, "rollback")
  assert.equal(rollbackDecision.status, "rework_requested")
  assert.match(rollbackDecision.reason, /Rollback blocked/)
  assert.equal(rollbackDecision.rollbackProtection.reason, "manual-change-detected-before-rollback")
  assert.deepEqual(rollbackDecision.rollbackProtection.drift.map((item) => item.file), ["demo.js"])
  assert.equal(fs.readFileSync(path.join(projectRoot, "demo.js"), "utf8"), "export const value = 3\n")
  assert.equal(orchestrator.listDecisions(run.id).some((item) => item.type === "conflict_protection"), true)
})

test("orchestrator hydrates persisted runs, artifacts, and decisions from store", () => {
  orchestrator.reset()
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "codek-orch-db-")), "orchestrator.db")
  const store = orchestrator.configureStore({ dbPath: dbFile })
  const run = orchestrator.createRun({
    projectRoot: "D:/Workspace",
    visibleMode: "agent",
    userInput: "修改 src/a.js",
  })
  run.status = "waiting_user"
  run.integrationDecision = {
    id: "decision_hydrate",
    runId: run.id,
    status: "pending",
    conflicts: [],
    proposedPatch: { summary: "1 file", filesChanged: ["src/a.js"], patches: [] },
    reason: "等待确认",
  }
  store.saveRun(run)
  artifactStore.addArtifact(run.id, {
    id: "artifact_hydrate",
    type: "summary",
    content: "persisted",
  })

  orchestrator.reset()
  orchestrator.configureStore({ dbPath: dbFile })
  const hydrated = orchestrator.hydrateFromStore()

  assert.equal(hydrated.length, 1)
  assert.equal(orchestrator.getRun(run.id).integrationDecision.status, "pending")
  assert.equal(artifactStore.listArtifacts(run.id)[0].content, "persisted")
})

test("orchestrator hydrate marks interrupted running runs as failed", () => {
  orchestrator.reset()
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "codek-orch-db-")), "orchestrator.db")
  orchestrator.configureStore({ dbPath: dbFile })
  const run = orchestrator.createRun({
    projectRoot: "D:/Workspace",
    visibleMode: "agent",
    userInput: "长任务",
  })
  run.status = "running"

  orchestrator.reset()
  orchestrator.configureStore({ dbPath: dbFile })
  orchestrator.hydrateFromStore()

  const recovered = orchestrator.getRun(run.id)
  assert.equal(recovered.status, "failed")
  assert.match(recovered.summary, /应用重启/)
  assert.equal(artifactStore.listArtifacts(run.id, { type: "recovery" }).length, 1)
})

test("orchestrator exposes incremental persisted events", () => {
  orchestrator.reset()
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "codek-events-db-")), "orchestrator.db")
  orchestrator.configureStore({ dbPath: dbFile })
  const run = orchestrator.createRun({
    projectRoot: "D:/Workspace",
    visibleMode: "agent",
    userInput: "查看事件",
  })
  const first = { runId: run.id, type: "orchestrator:first", createdAt: Date.now() - 10 }
  const second = { runId: run.id, type: "orchestrator:second", createdAt: Date.now() + 10 }
  run.events = [first, second]
  const store = orchestrator.configureStore({ dbPath: dbFile })
  store.saveRun(run)

  orchestrator.reset()
  orchestrator.configureStore({ dbPath: dbFile })

  const events = orchestrator.listEvents(run.id)
  assert.equal(events.length, 2)
  assert.equal(events[0].type, "orchestrator:first")

  const newer = orchestrator.listEvents(run.id, { since: first.createdAt })
  assert.deepEqual(newer.map((event) => event.type), ["orchestrator:second"])
})

test("orchestrator suggests and executes recovery actions", async () => {
  orchestrator.reset()
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "codek-recovery-db-")), "orchestrator.db")
  orchestrator.configureStore({ dbPath: dbFile })
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-recovery-"))
  const plan = planTree.createPlan("demo", [
    { id: "phase_1", name: "失败任务", tasks: [{ description: "失败", files: ["demo.js"] }] },
  ])
  const originalExecute = planExecutor.execute
  planExecutor.execute = async ({ emit }) => {
    emit({ type: "phase_start", phaseId: "phase_1" })
    emit({ type: "phase_failed", phaseId: "phase_1", error: "boom" })
    throw new Error("boom")
  }

  let run
  try {
    run = await orchestrator.startRun({
      projectRoot,
      visibleMode: "agent",
      userInput: "失败任务",
      plan,
      workspaceIsolation: "auto",
    })
  } finally {
    planExecutor.execute = originalExecute
  }

  assert.equal(run.status, "failed")
  const actions = orchestrator.listRecoveryActions(run.id)
  assert.deepEqual(actions.map((item) => item.action), ["retry", "split", "ask_user", "abort"])

  const retry = actions.find((item) => item.action === "retry")
  const result = orchestrator.executeRecoveryAction(run.id, retry.id)
  assert.equal(result.action.status, "completed")
  assert.equal(result.run.status, "running")
  assert.equal(result.run.assignments[0].status, "queued")

  const ask = orchestrator.createRecoveryAction(run.id, {
    action: "ask_user",
    assignmentId: result.run.assignments[0].id,
    phaseId: "phase_1",
    payload: { question: "继续吗？" },
  })
  const askResult = orchestrator.executeRecoveryAction(run.id, ask.id)
  assert.equal(askResult.run.status, "waiting_user")
  assert.equal(artifactStore.listArtifacts(run.id, { type: "question" }).length, 1)

  const abort = orchestrator.createRecoveryAction(run.id, { action: "abort" })
  const abortResult = orchestrator.executeRecoveryAction(run.id, abort.id)
  assert.equal(abortResult.run.status, "cancelled")
})
