const orchestrator = require("./orchestrator")
const artifactStore = require("./artifactStore")
const integrator = require("./integrator")
const { summarizeDiff } = require("./diffSummary")
const evalRunner = require("./evals/runner")
const evalReportStore = require("./evals/reportStore")
const acceptanceReport = require("./evals/realProjectAcceptance")
const { normalizeGoalRuntimeStatus } = require("./runtimeStatus")
const {
  buildOrchestratorReadinessReport,
  listReadinessActionAudits,
  listRunActionAudits,
  listReadinessReports,
  readLatestReadinessReport,
  saveReadinessActionAudit,
  saveRunActionAudit,
  saveReadinessReport,
} = require("./readiness")
const fs = require("node:fs")
const path = require("node:path")
const llmUsage = require("../llm/usage")
const { readLatestProviderHealthReport } = require("../llm/providerHealth")
const { readLatestDebugAdapterHealth } = require("../debug/adapterHealth")
const { readLatestExtensionEcosystemHealth } = require("../extensions-host/ecosystemHealth")
const { readLatestGoalRuntimeHealth } = require("../goalScheduler/stabilityHealth")
const runReport = require("./runReport")
const releaseEvidenceExport = require("./releaseEvidenceExport")
const { readLatestSandboxSecurityEvidence } = require("./sandboxSecurityEvidence")
const betaTrialPlan = require("../../../scripts/beta-trial-plan")
const betaTrialRun = require("../../../scripts/beta-trial-run")

const rootDir = path.resolve(__dirname, "..", "..", "..")

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function reportDirOrDefault(reportDir) {
  return reportDir || path.join(rootDir, ".codek", "reports")
}

function readLatestReportFile(reportDir, fileName, markdownName = fileName.replace(/\.json$/, ".md")) {
  const dir = reportDirOrDefault(reportDir)
  const jsonPath = path.join(dir, fileName)
  const markdownPath = path.join(dir, markdownName)
  return {
    report: readJsonSafe(jsonPath),
    markdown: fs.existsSync(markdownPath) ? fs.readFileSync(markdownPath, "utf8") : "",
    jsonPath,
    markdownPath,
  }
}

function requireSourceScript(relativePath) {
  try {
    return require(path.join(rootDir, relativePath))
  } catch (error) {
    const wrapped = new Error(
      "该操作需要在源码仓库中运行，当前安装态缺少发布诊断脚本。请在克隆的仓库里执行对应 npm 脚本。",
    )
    wrapped.statusCode = 501
    wrapped.code = "source_script_unavailable"
    wrapped.cause = error
    throw wrapped
  }
}

function releaseGateService() {
  try {
    return require(path.join(rootDir, "scripts", "release-gate"))
  } catch {
    return {
      defaultReportDir: () => path.join(rootDir, ".codek", "release-gate"),
      readLatestReport: (options = {}) => {
        const reportDir = options.reportDir || path.join(rootDir, ".codek", "release-gate")
        const jsonPath = path.join(reportDir, "release-gate-latest.json")
        return { report: readJsonSafe(jsonPath), jsonPath }
      },
      saveReport: (report, reportDir) => {
        fs.mkdirSync(reportDir, { recursive: true })
        const jsonPath = path.join(reportDir, "release-gate-latest.json")
        fs.writeFileSync(jsonPath, `${JSON.stringify({ ...report, jsonPath }, null, 2)}\n`, "utf8")
        return jsonPath
      },
      runReleaseGate: async () => {
        const error = new Error("该操作需要在源码仓库中运行，当前安装态无法直接执行 release gate。")
        error.statusCode = 501
        error.code = "source_script_unavailable"
        throw error
      },
    }
  }
}

function validateReleaseCiWorkflow() {
  return requireSourceScript("scripts/validate-release-ci").validateReleaseCiWorkflow()
}

function readLatestPerformanceBaseline(options = {}) {
  return readLatestReportFile(options.reportDir, "performance-baseline-latest.json")
}

function readLatestPackagingPreflight(options = {}) {
  return readLatestReportFile(options.reportDir, "packaging-preflight-latest.json")
}

function readLatestWorkbenchDeepSmoke(options = {}) {
  return readLatestReportFile(options.reportDir, "workbench-deep-smoke-latest.json")
}

function readLatestWorkbenchRealProjectUi(options = {}) {
  return readLatestReportFile(options.reportDir, "workbench-real-project-ui-latest.json")
}

function readLatestExplorerFsParity(options = {}) {
  return readLatestReportFile(options.reportDir, "explorer-fs-parity-latest.json")
}

function readLatestShellIntegrationSmoke(options = {}) {
  return readLatestReportFile(options.reportDir, "shell-integration-smoke-latest.json")
}

function readLatestDebugAdapterSmoke(options = {}) {
  return readLatestReportFile(options.reportDir, "debug-adapter-smoke-latest.json")
}

function readLatestAgentChangeSafetySmoke(options = {}) {
  return readLatestReportFile(options.reportDir, "agent-change-safety-smoke-latest.json")
}

function readLatestRouterCalibrationSmoke(options = {}) {
  return readLatestReportFile(options.reportDir, "router-calibration-smoke-latest.json")
}

function readLatestProductGradeGate(options = {}) {
  return readLatestReportFile(options.reportDir, "au-product-grade-gate-latest.json")
}

function readLatestAxEnterpriseGapGate(options = {}) {
  return readLatestReportFile(options.reportDir, "ax-enterprise-gap-gate-latest.json")
}

function readLatestAtReleaseCandidatePreflight(options = {}) {
  const dir = reportDirOrDefault(options.reportDir)
  const latestJsonPath = path.join(dir, "at-release-candidate-preflight-latest.json")
  const latestMarkdownPath = path.join(dir, "at-release-candidate-preflight-latest.md")
  return {
    report: readJsonSafe(latestJsonPath),
    markdown: fs.existsSync(latestMarkdownPath) ? fs.readFileSync(latestMarkdownPath, "utf8") : "",
    latestJsonPath,
    latestMarkdownPath,
  }
}

function getGoalStore() {
  return require("../goalStore")
}

function normalizeGoalTask(goal) {
  const runtime = normalizeGoalRuntimeStatus(goal)
  return {
    id: goal.id,
    kind: "goal",
    title: goal.description || goal.id,
    status: goal.status || "pending",
    runtimeStatus: runtime.runtimeStatus,
    runtimeStatusLabel: runtime.runtimeStatusLabel,
    runtimeReason: runtime.runtimeReason,
    stage: goal.status || "pending",
    projectRoot: goal.project_root || goal.projectRoot || "",
    goalId: goal.id,
    runId: null,
    executionStrategy: "scheduler",
    routerDecision: null,
    blockingReason: "",
    recentEvent: "",
    nextAction: runtime.nextAction,
    createdAt: goal.created_at || goal.createdAt || 0,
    updatedAt: goal.updated_at || goal.updatedAt || goal.created_at || goal.createdAt || 0,
  }
}

function normalizeOrchestratorTask(task) {
  return {
    ...task,
    kind: "orchestrator",
    stage: task.status,
    projectRoot: "",
    goalId: task.id,
    recentEvent: "",
    nextAction: task.nextAction || (task.requiresConfirmation ? "确认权限或调整任务范围" : ""),
  }
}

function taskCenterSummary(tasks) {
  const runningStatuses = new Set(["planned", "assigned", "running", "planning", "recovering"])
  const blockedStatuses = new Set(["blocked", "failed"])
  return {
    total: tasks.length,
    running: tasks.filter((task) => runningStatuses.has(task.runtimeStatus || task.status)).length,
    blocked: tasks.filter((task) => blockedStatuses.has(task.runtimeStatus || task.status) || task.blockingReason).length,
    completed: tasks.filter((task) => (task.runtimeStatus || task.status) === "completed").length,
  }
}

function readLatestArHealthReports(reportDir) {
  return {
    provider: readLatestProviderHealthReport({ reportDir }).report,
    debug: readLatestDebugAdapterHealth({ reportDir }).report,
    extensions: readLatestExtensionEcosystemHealth({ reportDir }).report,
    goals: readLatestGoalRuntimeHealth({ reportDir }).report,
    performance: readLatestPerformanceBaseline({ reportDir }).report,
  }
}

function pickLatest(primary, fallback) {
  return primary?.report ? primary : fallback
}

function register(router) {
  setTimeout(() => {
    const startedAt = Date.now()
    try {
      const hydrated = orchestrator.hydrateFromStore()
      if (Date.now() - startedAt >= 250) {
        console.log(`[orchestrator] hydrated ${hydrated.length} runs in ${Date.now() - startedAt}ms`)
      }
    } catch (error) {
      console.warn("[orchestrator] background hydrate failed:", error?.message || error)
    }
  }, 0)
  const releaseGate = releaseGateService()

  router.register("POST", "/api/orchestrator/tasks", async ({ body, sender }) => {
    const channel = "agent:event"
    const emit = (payload) => {
      try { sender?.send?.(channel, payload) } catch {}
    }
    return orchestrator.createTask(body || {}, emit)
  })

  router.register("GET", "/api/orchestrator/tasks", async () => ({
    tasks: orchestrator.listTasks(),
  }))

  router.register("GET", "/api/tasks/center", async () => {
    const goals = getGoalStore().listGoals().map(normalizeGoalTask)
    const orchestratorTasks = orchestrator.listTasks().map(normalizeOrchestratorTask)
    const tasks = [...orchestratorTasks, ...goals]
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    return {
      tasks,
      summary: taskCenterSummary(tasks),
    }
  })

  router.register("POST", "/api/orchestrator/runs", async ({ body, sender }) => {
    const channel = "agent:event"
    const emit = (payload) => {
      try { sender?.send?.(channel, payload) } catch {}
    }
    const run = await orchestrator.startRun(body || {}, emit)
    return { run }
  })

  router.register("POST", "/api/orchestrator/real-workspace-trial/run", async ({ body, sender }) => {
    const channel = "agent:event"
    const emit = (payload) => {
      try { sender?.send?.(channel, payload) } catch {}
    }
    const run = await orchestrator.startRealWorkspaceTrial(body || {}, emit)
    return { run }
  })

  router.register("GET", "/api/orchestrator/real-workspace-trial/latest", async ({ query }) => {
    const latest = runReport.readLatestRealWorkspaceTrialReport({ reportDir: query?.reportDir })
    return {
      report: latest.report,
      markdown: latest.markdown,
      jsonPath: latest.jsonPath,
      markdownPath: latest.markdownPath,
      history: runReport.listRealWorkspaceTrialReports({ reportDir: query?.reportDir }),
    }
  })

  router.register("POST", "/api/orchestrator/readiness/check", async ({ body }) => {
    const reportDir = body?.reportDir
    const releaseLatest = pickLatest(
      releaseGate.readLatestReport({ reportDir }),
      releaseGate.readLatestReport(),
    )
    const acceptanceLatest = pickLatest(
      acceptanceReport.readLatestAcceptanceReport({ reportDir }),
      acceptanceReport.readLatestAcceptanceReport(),
    )
    const realTrialLatest = runReport.readLatestRealWorkspaceTrialReport({ reportDir })
    const report = buildOrchestratorReadinessReport({
      projectRoot: body?.projectRoot,
      settings: body?.settings || {},
      config: body?.config || {},
      runs: orchestrator.listRuns(),
      releaseGateReport: releaseLatest.report,
      acceptanceReport: acceptanceLatest.report,
      realTrialReport: realTrialLatest.report,
    })
    const saved = body?.writeLatest === false ? null : saveReadinessReport(report, { reportDir })
    return {
      report,
      ...(saved || {}),
      history: listReadinessReports({ reportDir }),
    }
  })

  router.register("GET", "/api/orchestrator/readiness/latest", async ({ query }) => {
    const latest = readLatestReadinessReport({ reportDir: query?.reportDir })
    return {
      report: latest.report,
      markdown: latest.markdown,
      jsonPath: latest.jsonPath,
      markdownPath: latest.markdownPath,
      history: listReadinessReports({ reportDir: query?.reportDir }),
    }
  })

  router.register("POST", "/api/orchestrator/readiness/actions/audit", async ({ body }) => {
    const saved = saveReadinessActionAudit(body || {}, { reportDir: body?.reportDir })
    return {
      ...saved,
      history: listReadinessActionAudits({ reportDir: body?.reportDir }).slice(0, 20),
    }
  })

  router.register("GET", "/api/orchestrator/readiness/actions/audit", async ({ query }) => ({
    history: listReadinessActionAudits({ reportDir: query?.reportDir }).slice(0, 20),
  }))

  router.register("POST", "/api/orchestrator/run-actions/audit", async ({ body }) => {
    const saved = saveRunActionAudit(body || {}, { reportDir: body?.reportDir })
    return {
      ...saved,
      history: listRunActionAudits({ reportDir: body?.reportDir }).slice(0, 20),
    }
  })

  router.register("GET", "/api/orchestrator/run-actions/audit", async ({ query }) => ({
    history: listRunActionAudits({ reportDir: query?.reportDir }).slice(0, 20),
  }))

  if (process.env.CODEK_ELECTRON_SMOKE === "1") {
    router.register("POST", "/api/orchestrator/smoke/fixture", async () => ({
      run: orchestrator.createSmokePendingRunFixture(),
    }))
    router.register("POST", "/api/orchestrator/smoke/recovery-fixture", async () => {
      const run = orchestrator.createSmokePendingRunFixture()
      const mutable = orchestrator._unsafeGetMutableRunForTest(run.id)
      if (mutable) {
        mutable.status = "failed"
        mutable.integrationDecision = null
        mutable.recoveryRecommendation = {
          action: "retry",
          reason: "smoke 验证推荐恢复动作展示",
          createdAt: Date.now(),
        }
      }
      return { run: orchestrator.getRun(run.id) }
    })
    router.register("GET", "/api/orchestrator/smoke/fixture/:id/file", async ({ params, query }) => ({
      file: orchestrator.readSmokeFixtureFile(params.id, query?.file || "demo.js"),
    }))
    router.register("POST", "/api/orchestrator/smoke/release-gate-fixture", async ({ body }) => {
      const reportDir = body?.reportDir || releaseGate.defaultReportDir()
      const report = {
        createdAt: Date.now(),
        mode: "quick",
        ready: true,
        durationMs: 123,
        plannedSteps: ["typecheck", "i_j_smoke_tests", "smoke_j", "real_workspace_trial_smoke"],
        steps: [
          {
            id: "typecheck",
            label: "前端类型检查",
            command: "npm run typecheck",
            exitCode: 0,
            passed: true,
            durationMs: 41,
            error: "",
          },
          {
            id: "i_j_smoke_tests",
            label: "I/J smoke 单测",
            command: "node --test scripts/i-real-workspace-smoke.test.js",
            exitCode: 0,
            passed: true,
            durationMs: 32,
            error: "",
          },
          {
            id: "smoke_j",
            label: "J 线数据契约 smoke",
            command: "npm run smoke:j -- --no-write",
            exitCode: 0,
            passed: true,
            durationMs: 50,
            error: "",
          },
          {
            id: "real_workspace_trial_smoke",
            label: "Q 线真实工作区试运行 smoke",
            command: "npm run smoke:real-workspace-trial",
            exitCode: 0,
            passed: true,
            durationMs: 50,
            error: "",
          },
        ],
        warnings: [
          {
            id: "electron_smoke_fixture",
            severity: "info",
            note: "Electron smoke 使用轻量 fixture 验证发布质量门 UI 接线。",
          },
        ],
      }
      const jsonPath = releaseGate.saveReport(report, reportDir)
      return {
        report: { ...report, jsonPath },
        jsonPath,
      }
    })
  }

  router.register("GET", "/api/orchestrator/runs", async () => ({
    runs: orchestrator.listRuns(),
  }))

  router.register("GET", "/api/orchestrator/evals/latest", async () => {
    const latest = evalReportStore.readLatestReport()
    return {
      report: latest.report,
      markdown: latest.markdown,
      jsonPath: latest.jsonPath,
      markdownPath: latest.markdownPath,
      history: evalReportStore.listReports(),
    }
  })

  router.register("POST", "/api/orchestrator/evals/run", async ({ body }) => {
    const report = evalRunner.run(body?.tasksDir, { writeLatest: true, reportDir: body?.reportDir })
    const latest = evalReportStore.readLatestReport({ reportDir: body?.reportDir })
    return {
      report,
      jsonPath: latest.jsonPath,
      markdownPath: latest.markdownPath,
      history: evalReportStore.listReports({ reportDir: body?.reportDir }),
    }
  })

  router.register("GET", "/api/orchestrator/acceptance/latest", async ({ query }) => {
    const latest = acceptanceReport.readLatestAcceptanceReport({ reportDir: query?.reportDir })
    return {
      report: latest.report,
      markdown: latest.markdown,
      jsonPath: latest.jsonPath,
      markdownPath: latest.markdownPath,
      history: acceptanceReport.listAcceptanceReports({ reportDir: query?.reportDir }),
      taskSets: acceptanceReport.listAcceptanceTaskSets(),
    }
  })

  router.register("GET", "/api/orchestrator/release-gate/latest", async ({ query }) => {
    const latest = releaseGate.readLatestReport({ reportDir: query?.reportDir })
    return {
      report: latest.report,
      jsonPath: latest.jsonPath,
    }
  })

  router.register("GET", "/api/orchestrator/release-ci/check", async () => validateReleaseCiWorkflow())

  router.register("GET", "/api/orchestrator/release-evidence/latest", async ({ query }) => {
    const latest = releaseEvidenceExport.readLatestReleaseEvidenceSummary({ reportDir: query?.reportDir })
    return {
      report: latest.report,
      markdown: latest.markdown,
      jsonPath: latest.jsonPath,
      markdownPath: latest.markdownPath,
      history: releaseEvidenceExport.listReleaseEvidenceSummaries({ reportDir: query?.reportDir }),
    }
  })

  router.register("GET", "/api/orchestrator/product-grade/latest", async ({ query }) => {
    const latest = readLatestProductGradeGate({ reportDir: query?.reportDir })
    return {
      report: latest.report,
      markdown: latest.markdown,
      jsonPath: latest.jsonPath,
      markdownPath: latest.markdownPath,
    }
  })

  router.register("POST", "/api/orchestrator/release-evidence/export", async ({ body }) => {
    const reportDir = body?.reportDir
    const releaseLatest = pickLatest(
      releaseGate.readLatestReport({ reportDir }),
      releaseGate.readLatestReport(),
    )
    const acceptanceLatest = pickLatest(
      acceptanceReport.readLatestAcceptanceReport({ reportDir }),
      acceptanceReport.readLatestAcceptanceReport(),
    )
    const realTrialLatest = runReport.readLatestRealWorkspaceTrialReport({ reportDir })
    const readinessLatest = readLatestReadinessReport({ reportDir })
    const workbenchDeepLatest = readLatestWorkbenchDeepSmoke({ reportDir })
    const workbenchRealProjectUiLatest = readLatestWorkbenchRealProjectUi({ reportDir })
    const explorerFsParityLatest = readLatestExplorerFsParity({ reportDir })
    const shellIntegrationLatest = readLatestShellIntegrationSmoke({ reportDir })
    const debugAdapterLatest = readLatestDebugAdapterSmoke({ reportDir })
    const agentChangeSafetyLatest = readLatestAgentChangeSafetySmoke({ reportDir })
    const routerCalibrationLatest = readLatestRouterCalibrationSmoke({ reportDir })
    const bdUserTrialLatest = betaTrialPlan.readLatest({ reportDir })
    const betaTrialRunLatest = betaTrialRun.readLatestBetaTrialRun({ reportDir })
    const report = releaseEvidenceExport.buildReleaseEvidenceSummary({
      createdAt: Date.now(),
      releaseGateReport: releaseLatest.report,
      releaseGateJsonPath: releaseLatest.jsonPath,
      acceptanceReport: acceptanceLatest.report,
      acceptanceMarkdownPath: acceptanceLatest.markdownPath,
      acceptanceHistory: acceptanceReport.listAcceptanceReports({ reportDir }),
      readinessReport: readinessLatest.report,
      readinessMarkdownPath: readinessLatest.markdownPath,
      readinessHistory: listReadinessReports({ reportDir }),
      realTrialReport: realTrialLatest.report,
      realTrialMarkdownPath: realTrialLatest.markdownPath,
      realTrialHistory: runReport.listRealWorkspaceTrialReports({ reportDir }),
      bdUserTrialReport: bdUserTrialLatest.report,
      bdUserTrialMarkdownPath: bdUserTrialLatest.markdownPath,
      bdUserTrialHistory: betaTrialPlan.listBetaTrialPlans({ reportDir }),
      betaTrialRunReport: betaTrialRunLatest.report,
      betaTrialRunMarkdownPath: betaTrialRunLatest.markdownPath,
      betaTrialRunHistory: betaTrialRun.listBetaTrialRuns({ reportDir }),
      runActionAudits: listRunActionAudits({ reportDir }),
      usageSummary: llmUsage.summarizeUsageAudits({ reportDir }),
      arHealth: readLatestArHealthReports(reportDir),
      packagingPreflight: readLatestPackagingPreflight({ reportDir }).report,
      sandboxSecurityReport: readLatestSandboxSecurityEvidence({ reportDir }).report,
      workbenchDeep: workbenchDeepLatest.report,
      workbenchRealProjectUi: workbenchRealProjectUiLatest.report,
      workbenchRealProjectUiJsonPath: workbenchRealProjectUiLatest.jsonPath,
      workbenchRealProjectUiMarkdownPath: workbenchRealProjectUiLatest.report?.latestMarkdownPath || workbenchRealProjectUiLatest.markdownPath,
      workbenchRealProjectUiScreenshotPath: workbenchRealProjectUiLatest.report?.latestScreenshotPath || path.join(reportDirOrDefault(reportDir), "workbench-real-project-ui-latest.png"),
      explorerFsParity: explorerFsParityLatest.report,
      explorerFsParityJsonPath: explorerFsParityLatest.jsonPath,
      explorerFsParityMarkdownPath: explorerFsParityLatest.report?.latestMarkdownPath || explorerFsParityLatest.markdownPath,
      shellIntegration: shellIntegrationLatest.report,
      shellIntegrationJsonPath: shellIntegrationLatest.jsonPath,
      shellIntegrationMarkdownPath: shellIntegrationLatest.report?.latestMarkdownPath || shellIntegrationLatest.markdownPath,
      debugAdapterSmoke: debugAdapterLatest.report,
      debugAdapterSmokeJsonPath: debugAdapterLatest.jsonPath,
      debugAdapterSmokeMarkdownPath: debugAdapterLatest.report?.latestMarkdownPath || debugAdapterLatest.markdownPath,
      agentChangeSafety: agentChangeSafetyLatest.report,
      agentChangeSafetyJsonPath: agentChangeSafetyLatest.jsonPath,
      agentChangeSafetyMarkdownPath: agentChangeSafetyLatest.report?.latestMarkdownPath || agentChangeSafetyLatest.markdownPath,
      routerCalibration: routerCalibrationLatest.report,
      routerCalibrationJsonPath: routerCalibrationLatest.jsonPath,
      routerCalibrationMarkdownPath: routerCalibrationLatest.report?.latestMarkdownPath || routerCalibrationLatest.markdownPath,
      taskRunEvidence: workbenchDeepLatest.report?.taskRunEvidence,
      productGradeGate: readLatestProductGradeGate({ reportDir }).report,
      axEnterpriseGate: readLatestAxEnterpriseGapGate({ reportDir }).report,
      atPreflight: readLatestAtReleaseCandidatePreflight({ reportDir }).report,
      reportDir,
      runs: orchestrator.listRuns(),
    })
    const saved = releaseEvidenceExport.saveReleaseEvidenceSummary(report, { reportDir })
    return {
      report: saved.report,
      markdown: saved.markdown,
      jsonPath: saved.jsonPath,
      markdownPath: saved.markdownPath,
      history: releaseEvidenceExport.listReleaseEvidenceSummaries({ reportDir }),
    }
  })

  router.register("POST", "/api/orchestrator/release-gate/run", async ({ body }) => {
    const mode = body?.mode === "full" ? "full" : body?.mode === "build" ? "build" : "quick"
    const report = await releaseGate.runReleaseGate({
      reportDir: body?.reportDir,
      includeBuild: mode === "build" || mode === "full",
      full: mode === "full",
    })
    const latest = releaseGate.readLatestReport({ reportDir: body?.reportDir })
    return {
      report,
      jsonPath: report.jsonPath || latest.jsonPath,
    }
  })

  router.register("POST", "/api/orchestrator/acceptance/run", async ({ body }) => {
    const report = await acceptanceReport.runAcceptance({
      writeLatest: true,
      reportDir: body?.reportDir,
      taskSet: body?.taskSet,
    })
    const latest = acceptanceReport.readLatestAcceptanceReport({ reportDir: body?.reportDir })
    return {
      report,
      jsonPath: latest.jsonPath,
      markdownPath: latest.markdownPath,
      history: acceptanceReport.listAcceptanceReports({ reportDir: body?.reportDir }),
      taskSets: acceptanceReport.listAcceptanceTaskSets(),
    }
  })

  router.register("GET", "/api/orchestrator/runs/:id", async ({ params }) => {
    const run = orchestrator.getRun(params.id)
    if (!run) throw new Error("run not found")
    return { run }
  })

  router.register("POST", "/api/orchestrator/runs/:id/cancel", async ({ params }) => ({
    success: orchestrator.cancelRun(params.id),
  }))

  router.register("POST", "/api/orchestrator/runs/:id/pause", async ({ params, body }) => {
    const result = orchestrator.pauseRun(params.id, body?.reason || "")
    if (!result) throw new Error("run not found")
    return result
  })

  router.register("POST", "/api/orchestrator/runs/:id/resume", async ({ params }) => {
    const result = orchestrator.resumeRunFromCheckpoint(params.id)
    if (!result) throw new Error("run not found")
    return result
  })

  router.register("POST", "/api/orchestrator/runs/:id/decision", async ({ params, body }) => {
    const decision = orchestrator.applyDecision(params.id, body?.decision, body?.reason || "")
    if (!decision) throw new Error("run not found")
    return {
      decision,
      run: orchestrator.getRun(params.id),
      artifacts: artifactStore.listArtifacts(params.id),
    }
  })

  router.register("POST", "/api/orchestrator/runs/:id/permission", async ({ params, body }) => {
    const run = orchestrator.resolvePermissionRequest(params.id, body?.decision, body?.reason || "")
    if (!run) throw new Error("run not found")
    return { run }
  })

  router.register("GET", "/api/orchestrator/runs/:id/recovery-actions", async ({ params, query }) => ({
    actions: orchestrator.listRecoveryActions(params.id, query || {}),
  }))

  router.register("GET", "/api/orchestrator/runs/:id/events", async ({ params, query }) => ({
    events: orchestrator.listEvents(params.id, query || {}),
  }))

  router.register("GET", "/api/orchestrator/runs/:id/decisions", async ({ params }) => ({
    decisions: orchestrator.listDecisions(params.id),
  }))

  router.register("GET", "/api/orchestrator/runs/:id/report", async ({ params }) => {
    const report = orchestrator.getRunReport(params.id)
    if (!report) throw new Error("run not found")
    return { report, markdown: report.markdown }
  })

  router.register("POST", "/api/orchestrator/runs/:id/report/save", async ({ params, body }) => {
    const saved = orchestrator.saveReportForRun(params.id, { reportDir: body?.reportDir })
    if (!saved) throw new Error("run not found")
    return saved
  })

  router.register("GET", "/api/orchestrator/runs/:id/command-authorization", async ({ params }) => {
    const authorization = orchestrator.getRunCommandAuthorization(params.id)
    return { authorization }
  })

  router.register("GET", "/api/orchestrator/runs/:id/checkpoints", async ({ params }) => ({
    checkpoints: orchestrator.listCheckpoints(params.id),
    latest: orchestrator.getLatestCheckpoint(params.id),
  }))

  router.register("POST", "/api/orchestrator/runs/:id/recovery-actions", async ({ params, body }) => {
    const action = orchestrator.createRecoveryAction(params.id, body || {})
    if (!action) throw new Error("run not found")
    return { action }
  })

  router.register("POST", "/api/orchestrator/runs/:id/recovery-actions/:actionId/execute", async ({ params }) => {
    const result = orchestrator.executeRecoveryAction(params.id, params.actionId)
    if (!result) throw new Error("recovery action not found")
    return result
  })

  router.register("GET", "/api/orchestrator/runs/:id/artifacts", async ({ params, query }) => ({
    artifacts: artifactStore.listArtifacts(params.id, query || {}),
  }))

  router.register("GET", "/api/orchestrator/runs/:id/diff", async ({ params }) => {
    const run = orchestrator.getRun(params.id)
    if (!run) throw new Error("run not found")
    const artifacts = artifactStore.listArtifacts(params.id)
    const decision = integrator.createIntegrationDecision({
      runId: params.id,
      assignments: run.assignments,
      artifacts,
      qualityGate: run.integrationDecision?.qualityGate || null,
    })
    return {
      diff: {
        ...decision.proposedPatch,
        summaryDetails: summarizeDiff(decision.proposedPatch, run),
      },
    }
  })
}

module.exports = { register }
