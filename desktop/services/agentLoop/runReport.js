const fs = require("node:fs")
const path = require("node:path")
const artifactStore = require("./artifactStore")
const { normalizeRunRuntimeStatus } = require("./runtimeStatus")
const { withProjectScope } = require("./projectScope")
const { summarizeCommandAuthorization } = require("./commandAuthorization")
const { buildRealWorkspaceTrialReport } = require("./realWorkspaceTrial")
const { normalizeContextEvidence } = require("./contextEvidence")

function listFiles(run) {
  return run?.integrationDecision?.proposedPatch?.filesChanged || []
}

function summarizePermissions(run) {
  const request = run?.permissionRequest
  if (!request) return []
  return [{
    id: request.id,
    status: request.status,
    risk: request.risk,
    readPaths: request.readPaths || [],
    writePaths: request.writePaths || [],
    commandAllowlist: request.commandAllowlist || [],
    network: Boolean(request.network),
    install: Boolean(request.install),
    externalTool: Boolean(request.externalTool),
    destructive: Boolean(request.destructive),
    reason: request.reason || "",
    decisionReason: request.decisionReason || "",
  }]
}

function summarizeQualityGate(run) {
  const gate = run?.integrationDecision?.qualityGate
  if (!gate) return { status: "not_run", summary: "未运行质量门", commandResults: [] }
  return {
    status: gate.status,
    summary: gate.summary || "",
    commandResults: gate.commandResults || [],
  }
}

function summarizeRecovery(run, recoveryActions = []) {
  return recoveryActions.map((action) => ({
    id: action.id,
    action: action.action,
    status: action.status,
    reason: action.reason,
    nextStatus: action.nextStatus || "",
    assignmentId: action.assignmentId || null,
    phaseId: action.phaseId || null,
  }))
}

function summarizeBudget(run) {
  const budget = run?.budget || {}
  return {
    token: finiteNumberOrNull(budget.token),
    cost: finiteNumberOrNull(budget.cost),
    timeMs: finiteNumberOrNull(budget.timeMs),
  }
}

function summarizeWorktreeMergeStrategy(run) {
  const strategy = run?.integrationDecision?.worktreeMergeStrategy
  if (!strategy || typeof strategy !== "object") return null
  const conflictSummary = strategy.conflictSummary || {}
  const validationMatrix = strategy.validationMatrix || {}
  const evidence = strategy.evidence || {}
  const mainThreadDecision = strategy.mainThreadDecision || {}
  return {
    status: String(strategy.status || ""),
    mode: String(strategy.mode || ""),
    stateSource: String(strategy.stateSource || "integrationDecision"),
    preservesSingleStateSource: strategy.preservesSingleStateSource === true,
    conflictSummary: {
      status: String(conflictSummary.status || ""),
      total: Number(conflictSummary.total || 0),
      files: Array.isArray(conflictSummary.files) ? conflictSummary.files.map(String) : [],
    },
    validationMatrix: {
      status: String(validationMatrix.status || ""),
      summary: {
        total: Number(validationMatrix.summary?.total || 0),
        passed: Number(validationMatrix.summary?.passed || 0),
        failed: Number(validationMatrix.summary?.failed || 0),
        notRun: Number(validationMatrix.summary?.notRun || 0),
      },
      commands: Array.isArray(validationMatrix.commands)
        ? validationMatrix.commands.map((item) => ({
          command: String(item.command || ""),
          status: String(item.status || ""),
          exitCode: Number.isFinite(Number(item.exitCode)) ? Number(item.exitCode) : null,
          timedOut: item.timedOut === true,
        }))
        : [],
    },
    evidence: {
      preMerge: {
        gitHead: String(evidence.preMerge?.gitHead || ""),
        status: String(evidence.preMerge?.status || ""),
        dirtyFiles: Array.isArray(evidence.preMerge?.dirtyFiles) ? evidence.preMerge.dirtyFiles.map(String) : [],
        stagedFiles: Array.isArray(evidence.preMerge?.stagedFiles) ? evidence.preMerge.stagedFiles.map(String) : [],
        reportRefs: Array.isArray(evidence.preMerge?.reportRefs) ? evidence.preMerge.reportRefs.map(String) : [],
      },
      postMerge: {
        status: String(evidence.postMerge?.status || ""),
        dirtyFiles: Array.isArray(evidence.postMerge?.dirtyFiles) ? evidence.postMerge.dirtyFiles.map(String) : [],
        stagedFiles: Array.isArray(evidence.postMerge?.stagedFiles) ? evidence.postMerge.stagedFiles.map(String) : [],
        reportRefs: Array.isArray(evidence.postMerge?.reportRefs) ? evidence.postMerge.reportRefs.map(String) : [],
      },
    },
    failureClassification: Array.isArray(strategy.failureClassification)
      ? strategy.failureClassification.map((item) => ({
        id: String(item.id || ""),
        category: String(item.category || ""),
        severity: String(item.severity || ""),
        stage: String(item.stage || ""),
        summary: String(item.summary || ""),
        requiresHumanDecision: item.requiresHumanDecision === true,
      }))
      : [],
    mainThreadDecision: {
      required: mainThreadDecision.required === true,
      recommendedAction: String(mainThreadDecision.recommendedAction || ""),
      allowedActions: Array.isArray(mainThreadDecision.allowedActions) ? mainThreadDecision.allowedActions.map(String) : [],
      requiredFields: Array.isArray(mainThreadDecision.requiredFields) ? mainThreadDecision.requiredFields.map(String) : [],
      decisionPrompt: String(mainThreadDecision.decisionPrompt || ""),
    },
  }
}

function summarizeContextEvidence(run) {
  return normalizeContextEvidence(run?.contextEvidence)
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function compactStrings(values) {
  return asArray(values).map((value) => String(value || "").trim()).filter(Boolean)
}

function normalizePermissionScope(source = {}, fallback = {}) {
  const scope = source.permissionScope || source.permissions || {}
  return {
    readPaths: compactStrings(scope.readPaths || source.readPaths || fallback.readPaths),
    writePaths: compactStrings(scope.writePaths || source.writePaths || source.lockedFiles || fallback.writePaths),
    allowedTools: compactStrings(scope.allowedTools || source.allowedTools),
    commandAllowlist: compactStrings(scope.commandAllowlist || source.commandAllowlist || fallback.commandAllowlist),
    network: scope.network === true || source.network === true || fallback.network === true,
    install: scope.install === true || source.install === true || fallback.install === true,
    externalTool: scope.externalTool === true || source.externalTool === true || fallback.externalTool === true,
    destructive: scope.destructive === true || source.destructive === true || fallback.destructive === true,
  }
}

function normalizeAgentRoleTrial(raw = {}, fallback = {}) {
  const role = String(raw.role || raw.agentRole || fallback.role || "").trim()
  const profileId = String(raw.profileId || raw.profile || raw.profileName || fallback.profileId || role || "").trim()
  return {
    id: String(raw.id || fallback.id || `${fallback.runId || "run"}:${fallback.assignmentId || role || profileId}`).trim(),
    taskId: String(raw.taskId || raw.subtaskId || raw.phaseId || fallback.taskId || "").trim(),
    runId: String(raw.runId || fallback.runId || "").trim(),
    assignmentId: String(raw.assignmentId || fallback.assignmentId || "").trim(),
    role,
    profileId,
    profileSource: String(raw.profileSource || raw.source || "external-agent-template").trim(),
    selectionReason: String(raw.selectionReason || raw.reason || raw.profileSelectionReason || "").trim(),
    permissionScope: normalizePermissionScope(raw, fallback.permissionScope || fallback),
    validationAdvice: compactStrings(raw.validationAdvice || raw.validationSuggestions || raw.verificationAdvice),
    benefit: String(raw.benefit || raw.trialBenefit || raw.expectedBenefit || "").trim(),
    noise: String(raw.noise || raw.trialNoise || raw.observedNoise || "").trim(),
    runtimeFit: String(raw.runtimeFit || raw.runtimeRecommendation || raw.runtimeIntegration || "").trim(),
    worthRuntimeIntegration: raw.worthRuntimeIntegration === true || raw.runtimeIntegrationRecommended === true,
    evidenceRefs: compactStrings(raw.evidenceRefs || raw.artifactIds || fallback.evidenceRefs),
  }
}

function summarizeAgentRoleTrials(run, artifacts = []) {
  const permissionFallback = run?.permissionRequest || {}
  const candidates = []
  for (const trial of asArray(run?.agentRoleTrials || run?.roleProfileTrials)) {
    candidates.push({ trial, fallback: { runId: run?.id, permissionScope: permissionFallback } })
  }
  for (const assignment of asArray(run?.assignments)) {
    const assignmentTrial = assignment.agentRoleTrial || assignment.roleProfileTrial || assignment.profileTrial
    if (!assignmentTrial && !assignment.profileId && !assignment.profileSource && !assignment.profileSelectionReason) continue
    candidates.push({
      trial: assignmentTrial || assignment,
      fallback: {
        id: assignment.id,
        runId: run?.id,
        assignmentId: assignment.id,
        taskId: assignment.phaseId,
        role: assignment.role,
        profileId: assignment.profileId,
        permissionScope: {
          ...permissionFallback,
          readPaths: assignment.readPaths || permissionFallback.readPaths,
          writePaths: assignment.writePaths || assignment.lockedFiles || permissionFallback.writePaths,
          allowedTools: assignment.allowedTools,
          commandAllowlist: permissionFallback.commandAllowlist,
        },
      },
    })
  }
  for (const artifact of asArray(artifacts)) {
    for (const trial of [
      artifact.metadata?.agentRoleTrial,
      ...asArray(artifact.metadata?.agentRoleTrials),
    ].filter(Boolean)) {
      candidates.push({
        trial,
        fallback: {
          runId: run?.id,
          assignmentId: artifact.assignmentId || "",
          evidenceRefs: [artifact.id],
          permissionScope: permissionFallback,
        },
      })
    }
  }

  const seen = new Set()
  const trials = candidates
    .map(({ trial, fallback }) => normalizeAgentRoleTrial(trial, fallback))
    .filter((trial) => {
      const key = `${trial.taskId}|${trial.assignmentId}|${trial.role}|${trial.profileId}`
      if (!trial.role && !trial.profileId) return false
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  const completeTrials = trials.filter((trial) =>
    trial.role && trial.profileId && trial.selectionReason && trial.validationAdvice.length > 0,
  ).length
  const requiredTrialCount = Number(run?.agentRoleTrialDecision?.requiredTrialCount || 2)
  const explicitRecommendation = run?.agentRoleTrialDecision?.recommendation
    || run?.runtimeProfileDecision?.recommendation
    || ""
  const runtimeIntegrationRecommended = typeof run?.agentRoleTrialDecision?.runtimeIntegrationRecommended === "boolean"
    ? run.agentRoleTrialDecision.runtimeIntegrationRecommended
    : trials.some((trial) => trial.worthRuntimeIntegration || /recommend|yes|worth|接入|值得/i.test(trial.runtimeFit))
  const ready = trials.length >= requiredTrialCount && completeTrials >= requiredTrialCount
  return {
    available: trials.length > 0,
    ready,
    status: trials.length === 0 ? "missing" : ready ? "ready" : "degraded",
    statusLabel: trials.length === 0
      ? "暂无角色 profile 试用证据"
      : ready ? `${completeTrials}/${requiredTrialCount} 角色 profile 试用证据已就绪` : `${completeTrials}/${requiredTrialCount} 角色 profile 试用证据需补齐`,
    requiredTrialCount,
    trialCount: trials.length,
    completeTrials,
    runtimeIntegrationRecommended,
    recommendation: explicitRecommendation || (runtimeIntegrationRecommended ? "recommend-runtime-integration" : "keep-as-template-only"),
    decisionReason: String(run?.agentRoleTrialDecision?.reason || run?.runtimeProfileDecision?.reason || "").trim(),
    runtimeContract: {
      attachToExistingOrchestratorRun: true,
      attachToAssignment: true,
      attachToEventArtifactEvidence: true,
      noSecondStateSource: true,
    },
    trials,
  }
}

function summarizeProposalOnlyDelivery(run, artifacts = []) {
  const delivery = run?.integrationDecision?.proposalOnlyDelivery
  if (delivery) return delivery
  const patches = run?.integrationDecision?.proposedPatch?.patches || []
  const filesChanged = listFiles(run)
  return {
    mode: "proposal-only",
    mainWorkspaceWrite: false,
    requiresAcceptBeforeApply: true,
    executionStrategy: run?.executionStrategy || "",
    plan: {
      available: Boolean(run?.plan),
      title: run?.plan?.title || "",
      summary: run?.plan?.summary || "",
      phaseCount: Array.isArray(run?.plan?.phases) ? run.plan.phases.length : 0,
      taskCount: (run?.plan?.phases || []).reduce((sum, phase) => sum + (Array.isArray(phase.tasks) ? phase.tasks.length : 0), 0),
    },
    proposedDiff: {
      available: patches.length > 0,
      fileCount: filesChanged.length,
      patchCount: patches.length,
      filesChanged,
    },
    artifacts: {
      total: artifacts.length,
      proposed: artifacts.map((artifact) => ({
        id: artifact.id,
        type: artifact.type,
        assignmentId: artifact.assignmentId || null,
        filesChanged: Array.isArray(artifact.metadata?.filesChanged) ? artifact.metadata.filesChanged : [],
      })),
    },
    verification: summarizeQualityGate(run),
    decisionEvidence: {
      availableActions: ["accepted", "rework_requested", "rejected", "rollback"],
      accept: { status: "requires_explicit_accept", writesMainWorkspace: true },
      rework: { status: "available", writesMainWorkspace: false },
      reject: { status: "available", writesMainWorkspace: false },
      rollback: { status: "available_after_accept", writesMainWorkspace: true },
    },
    blockedGaps: [],
  }
}

function buildRunReport(run, options = {}) {
  if (!run) return null
  const scopedRun = withProjectScope(run)
  const runtime = normalizeRunRuntimeStatus(scopedRun)
  const artifacts = options.artifacts || artifactStore.listArtifacts(run.id)
  const recoveryActions = options.recoveryActions || []
  const decisions = options.decisions || run.decisionLog || []
  const assignments = run.assignments || []
  const report = {
    runId: run.id,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    userGoal: run.userInput || run.summary || "",
    finalStatus: runtime.runtimeStatus,
    finalStatusLabel: runtime.runtimeStatusLabel,
    runtimeReason: runtime.runtimeReason,
    nextAction: runtime.nextAction,
    projectRoot: scopedRun.projectRoot,
    projectKind: scopedRun.projectKind,
    projectKindLabel: scopedRun.projectKindLabel,
    writeMode: scopedRun.writeMode,
    writeModeLabel: scopedRun.writeModeLabel,
    budget: summarizeBudget(run),
    router: {
      visibleMode: run.visibleMode,
      executionStrategy: run.executionStrategy,
      reason: run.strategyReason || "",
      signals: run.strategySignals || {},
    },
    fileScope: listFiles(run),
    contextEvidence: summarizeContextEvidence(run),
    agentRoleTrials: summarizeAgentRoleTrials(run, artifacts),
    permissions: summarizePermissions(run),
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      phaseId: assignment.phaseId,
      role: assignment.role,
      status: assignment.status,
      files: assignment.lockedFiles || [],
      workspaceIsolation: assignment.workspace?.isolation || "",
    })),
    changeSummary: {
      summary: run.integrationDecision?.proposedPatch?.summary || "",
      filesChanged: listFiles(run),
      proposedPatchCount: run.integrationDecision?.proposedPatch?.patches?.length || 0,
      applyResult: run.integrationDecision?.applyResult || null,
      rollbackResult: run.integrationDecision?.rollbackResult || null,
    },
    proposalOnlyDelivery: summarizeProposalOnlyDelivery(run, artifacts),
    worktreeMergeStrategy: summarizeWorktreeMergeStrategy(run),
    qualityGate: summarizeQualityGate(run),
    commandAuthorization: summarizeCommandAuthorization(run),
    realWorkspaceTrial: run.realWorkspaceTrial ? buildRealWorkspaceTrialReport(run, { recoveryActions }) : null,
    recoveryActions: summarizeRecovery(run, recoveryActions),
    recoveryRecommendation: run.recoveryRecommendation || null,
    decisions: decisions.map((entry) => ({
      type: entry.type,
      title: entry.title || "",
      status: entry.status || "",
      selectedOption: entry.selectedOption || "",
      reason: entry.reason || entry.blockingReason || "",
      createdAt: entry.createdAt,
    })),
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      assignmentId: artifact.assignmentId || null,
      summary: String(artifact.content || "").slice(0, 240),
      metadata: artifact.metadata || {},
    })),
  }
  report.markdown = toRunReportMarkdown(report)
  report.trialTaskReport = buildTrialTaskReport(report)
  return report
}

function defaultRunReportDir() {
  if (process.env.CODEK_DATA) return path.join(process.env.CODEK_DATA, "reports")
  return path.resolve(process.cwd(), ".codek", "reports")
}

function safeReportId(value) {
  return String(value || "run").replace(/[^\w.-]+/g, "_").slice(0, 120)
}

function saveRunReport(report, options = {}) {
  if (!report?.runId) throw new Error("report.runId required")
  const reportDir = options.reportDir || defaultRunReportDir()
  fs.mkdirSync(reportDir, { recursive: true })
  const stamp = new Date(report.updatedAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const base = `${safeReportId(report.runId)}-${stamp}`
  const markdownPath = path.join(reportDir, `${base}.md`)
  const jsonPath = path.join(reportDir, `${base}.json`)
  fs.writeFileSync(markdownPath, `${report.markdown || toRunReportMarkdown(report)}\n`, "utf8")
  fs.writeFileSync(jsonPath, `${JSON.stringify({ ...report, markdownPath, jsonPath }, null, 2)}\n`, "utf8")
  const saved = {
    reportDir,
    markdownPath,
    jsonPath,
  }
  if (report.realWorkspaceTrial || options.writeRealWorkspaceTrialLatest) {
    Object.assign(saved, saveRealWorkspaceTrialReportArtifacts(report, reportDir, stamp))
  }
  if (report.realWorkspaceTrial || options.writeTrialTaskReportLatest) {
    Object.assign(saved, saveTrialTaskReportArtifacts(report, reportDir, stamp, options))
  }
  return saved
}

function realWorkspaceTrialLatestPaths(reportDir = defaultRunReportDir()) {
  const resolved = reportDir || defaultRunReportDir()
  return {
    reportDir: resolved,
    latestMarkdownPath: path.join(resolved, "real-workspace-trial-latest.md"),
    latestJsonPath: path.join(resolved, "real-workspace-trial-latest.json"),
    historyDir: path.join(resolved, "history"),
  }
}

function saveRealWorkspaceTrialReportArtifacts(report, reportDir, stamp) {
  const paths = realWorkspaceTrialLatestPaths(reportDir)
  fs.mkdirSync(paths.historyDir, { recursive: true })
  const historyBase = `real-workspace-trial-${stamp || new Date(report.updatedAt || Date.now()).toISOString().replace(/[:.]/g, "-")}`
  const historyMarkdownPath = path.join(paths.historyDir, `${historyBase}.md`)
  const historyJsonPath = path.join(paths.historyDir, `${historyBase}.json`)
  const payload = {
    ...report,
    markdownPath: paths.latestMarkdownPath,
    jsonPath: paths.latestJsonPath,
    historyMarkdownPath,
    historyJsonPath,
  }
  fs.writeFileSync(paths.latestMarkdownPath, `${report.markdown || toRunReportMarkdown(report)}\n`, "utf8")
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMarkdownPath, `${report.markdown || toRunReportMarkdown(report)}\n`, "utf8")
  fs.writeFileSync(historyJsonPath, `${JSON.stringify({ ...payload, markdownPath: historyMarkdownPath, jsonPath: historyJsonPath }, null, 2)}\n`, "utf8")
  return {
    realWorkspaceTrialMarkdownPath: paths.latestMarkdownPath,
    realWorkspaceTrialJsonPath: paths.latestJsonPath,
    realWorkspaceTrialHistoryMarkdownPath: historyMarkdownPath,
    realWorkspaceTrialHistoryJsonPath: historyJsonPath,
  }
}

function trialTaskReportLatestPaths(reportDir = defaultRunReportDir()) {
  const resolved = reportDir || defaultRunReportDir()
  return {
    reportDir: resolved,
    latestMarkdownPath: path.join(resolved, "trial-task-report-latest.md"),
    latestJsonPath: path.join(resolved, "trial-task-report-latest.json"),
    historyDir: path.join(resolved, "history"),
  }
}

function saveTrialTaskReportArtifacts(report, reportDir, stamp, options = {}) {
  const trialTaskReport = buildTrialTaskReport(report, options.trialTaskReport || {})
  const paths = trialTaskReportLatestPaths(reportDir)
  fs.mkdirSync(paths.historyDir, { recursive: true })
  const historyBase = `trial-task-report-${stamp || new Date(report.updatedAt || Date.now()).toISOString().replace(/[:.]/g, "-")}`
  const historyMarkdownPath = path.join(paths.historyDir, `${historyBase}.md`)
  const historyJsonPath = path.join(paths.historyDir, `${historyBase}.json`)
  const payload = {
    ...trialTaskReport,
    markdownPath: paths.latestMarkdownPath,
    jsonPath: paths.latestJsonPath,
    historyMarkdownPath,
    historyJsonPath,
  }
  fs.writeFileSync(paths.latestMarkdownPath, `${trialTaskReport.markdown}\n`, "utf8")
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMarkdownPath, `${trialTaskReport.markdown}\n`, "utf8")
  fs.writeFileSync(historyJsonPath, `${JSON.stringify({ ...payload, markdownPath: historyMarkdownPath, jsonPath: historyJsonPath }, null, 2)}\n`, "utf8")
  return {
    trialTaskReportMarkdownPath: paths.latestMarkdownPath,
    trialTaskReportJsonPath: paths.latestJsonPath,
    trialTaskReportHistoryMarkdownPath: historyMarkdownPath,
    trialTaskReportHistoryJsonPath: historyJsonPath,
  }
}

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function readLatestRealWorkspaceTrialReport(options = {}) {
  const paths = realWorkspaceTrialLatestPaths(options.reportDir)
  const report = readJsonFile(paths.latestJsonPath)
  const markdown = fs.existsSync(paths.latestMarkdownPath) ? fs.readFileSync(paths.latestMarkdownPath, "utf8") : ""
  return {
    report,
    markdown,
    jsonPath: report ? paths.latestJsonPath : "",
    markdownPath: markdown ? paths.latestMarkdownPath : "",
  }
}

function readLatestTrialTaskReport(options = {}) {
  const paths = trialTaskReportLatestPaths(options.reportDir)
  const report = readJsonFile(paths.latestJsonPath)
  const markdown = fs.existsSync(paths.latestMarkdownPath) ? fs.readFileSync(paths.latestMarkdownPath, "utf8") : ""
  return {
    report,
    markdown,
    jsonPath: report ? paths.latestJsonPath : "",
    markdownPath: markdown ? paths.latestMarkdownPath : "",
  }
}

function listRealWorkspaceTrialReports(options = {}) {
  const paths = realWorkspaceTrialLatestPaths(options.reportDir)
  if (!fs.existsSync(paths.historyDir)) return []
  return fs.readdirSync(paths.historyDir)
    .filter((name) => /^real-workspace-trial-.*\.json$/.test(name))
    .map((name) => {
      const jsonPath = path.join(paths.historyDir, name)
      const report = readJsonFile(jsonPath)
      if (!report) return null
      return {
        runId: report.runId,
        createdAt: report.createdAt || 0,
        updatedAt: report.updatedAt || 0,
        finalStatus: report.finalStatus || "",
        executionStrategy: report.router?.executionStrategy || report.realWorkspaceTrial?.executionStrategy || "",
        filesChanged: report.realWorkspaceTrial?.filesChanged || report.fileScope || [],
        jsonPath,
        markdownPath: jsonPath.replace(/\.json$/, ".md"),
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
}

function listTrialTaskReports(options = {}) {
  const paths = trialTaskReportLatestPaths(options.reportDir)
  if (!fs.existsSync(paths.historyDir)) return []
  return fs.readdirSync(paths.historyDir)
    .filter((name) => /^trial-task-report-.*\.json$/.test(name))
    .map((name) => {
      const jsonPath = path.join(paths.historyDir, name)
      const report = readJsonFile(jsonPath)
      if (!report) return null
      return {
        runId: report.runId,
        createdAt: report.createdAt || 0,
        updatedAt: report.updatedAt || 0,
        status: report.status || "",
        ready: report.ready === true,
        filesChanged: report.diffSummary?.filesChanged || [],
        jsonPath,
        markdownPath: jsonPath.replace(/\.json$/, ".md"),
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
}

function buildTrialTaskReport(report, options = {}) {
  if (!report?.runId) throw new Error("report.runId required")
  const commandResults = Array.isArray(report.qualityGate?.commandResults) ? report.qualityGate.commandResults : []
  const filesChanged = uniqueStrings([
    ...(Array.isArray(report.fileScope) ? report.fileScope : []),
    ...(Array.isArray(report.changeSummary?.filesChanged) ? report.changeSummary.filesChanged : []),
    ...(Array.isArray(report.changeSummary?.applyResult?.filesChanged) ? report.changeSummary.applyResult.filesChanged : []),
    ...(Array.isArray(report.changeSummary?.rollbackResult?.filesChanged) ? report.changeSummary.rollbackResult.filesChanged : []),
  ])
  const executionSteps = buildTrialExecutionSteps(report, commandResults)
  const failureItems = buildTrialFailures(report)
  const status = failureItems.some((item) => item.severity === "error") ? "blocked" : report.finalStatus || "unknown"
  const ready = Boolean(report.userGoal) && filesChanged.length > 0 && (report.qualityGate?.status === "passed" || report.finalStatus === "waiting_decision")
  const trialReport = {
    reportKind: "trial-task-report",
    schemaVersion: 1,
    runId: report.runId,
    createdAt: report.createdAt || 0,
    updatedAt: report.updatedAt || report.createdAt || 0,
    ready,
    status,
    task: {
      goal: safeText(report.userGoal),
      finalStatus: report.finalStatus || "",
      finalStatusLabel: report.finalStatusLabel || "",
      nextAction: safeText(report.nextAction || ""),
      projectRoot: safeText(report.projectRoot || ""),
      visibleMode: report.router?.visibleMode || "",
      executionStrategy: report.router?.executionStrategy || report.realWorkspaceTrial?.executionStrategy || "",
      routerReason: safeText(report.router?.reason || report.realWorkspaceTrial?.routerReason || ""),
      writeMode: report.realWorkspaceTrial?.writeMode || report.writeMode || "",
      proposalOnlyBeforeAccept: report.realWorkspaceTrial ? report.realWorkspaceTrial.mainWorkspaceUntouchedBeforeAccept === true : false,
    },
    executionSteps,
    diffSummary: {
      summary: safeText(report.changeSummary?.summary || ""),
      filesChanged,
      fileCount: filesChanged.length,
      appliedFiles: uniqueStrings(report.changeSummary?.applyResult?.filesChanged || []),
      rolledBackFiles: uniqueStrings(report.changeSummary?.rollbackResult?.filesChanged || []),
      diffBodyIncluded: false,
    },
    validation: {
      status: report.qualityGate?.status || "not_run",
      summary: safeText(report.qualityGate?.summary || ""),
      commands: commandResults.map((item) => ({
        command: normalizeCommandForReport(item.command),
        status: safeText(item.status || statusFromExitCode(item.exitCode)),
        exitCode: typeof item.exitCode === "number" && Number.isFinite(item.exitCode) ? item.exitCode : null,
        timedOut: item.timedOut === true,
        durationMs: finiteNumberOrNull(item.durationMs),
      })),
    },
    cost: {
      durationMs: Math.max(0, Number(report.updatedAt || 0) - Number(report.createdAt || 0)),
      budgetTimeMs: finiteNumberOrNull(report.budget?.timeMs),
      token: finiteNumberOrNull(report.budget?.token),
      cost: finiteNumberOrNull(report.budget?.cost),
      currency: report.budget?.cost == null ? "" : "USD",
    },
    failures: failureItems,
    rollback: {
      available: report.realWorkspaceTrial?.rollbackAvailable === true || Boolean(report.changeSummary?.rollbackResult),
      applied: Boolean(report.changeSummary?.rollbackResult),
      recommendation: buildRollbackRecommendation(report),
      rollbackResult: report.changeSummary?.rollbackResult ? {
        status: safeText(report.changeSummary.rollbackResult.status || ""),
        filesChanged: uniqueStrings(report.changeSummary.rollbackResult.filesChanged || []),
      } : null,
    },
    humanAcceptance: normalizeHumanAcceptance(options.humanAcceptance),
    evidenceRefs: {
      runReport: `${safeText(report.runId)}.json`,
      realWorkspaceTrial: report.realWorkspaceTrial ? "real-workspace-trial-latest.json" : "",
      releaseEvidence: "release-evidence-latest.json",
    },
    privacyPolicy: {
      diffBodyIncluded: false,
      commandOutputIncluded: false,
      rawPromptIncluded: false,
      sourceBodyIncluded: false,
    },
  }
  trialReport.markdown = toTrialTaskReportMarkdown(trialReport)
  return trialReport
}

function buildTrialExecutionSteps(report, commandResults) {
  const steps = []
  if (report.router?.executionStrategy || report.realWorkspaceTrial?.executionStrategy) {
    steps.push({
      id: "router",
      title: "路由与策略选择",
      status: "completed",
      summary: safeText(report.router?.reason || report.realWorkspaceTrial?.routerReason || "已选择执行策略"),
    })
  }
  for (const assignment of Array.isArray(report.assignments) ? report.assignments : []) {
    steps.push({
      id: `assignment:${assignment.phaseId || assignment.id}`,
      title: `执行阶段 ${assignment.phaseId || assignment.id || "-"}`,
      status: safeText(assignment.status || "unknown"),
      summary: `${safeText(assignment.role || "-")} · 文件 ${formatList(assignment.files || [])}`,
    })
  }
  if (commandResults.length || report.qualityGate?.status) {
    steps.push({
      id: "quality_gate",
      title: "质量门验证",
      status: report.qualityGate?.status || "not_run",
      summary: report.qualityGate?.summary || `${commandResults.length} 条验证命令`,
    })
  }
  if (report.changeSummary?.rollbackResult) {
    steps.push({
      id: "rollback",
      title: "回滚验证",
      status: safeText(report.changeSummary.rollbackResult.status || "completed"),
      summary: `回滚文件 ${formatList(report.changeSummary.rollbackResult.filesChanged || [])}`,
    })
  }
  return steps
}

function buildTrialFailures(report) {
  const failures = []
  if (report.qualityGate?.status === "failed") {
    failures.push({
      id: "quality_gate_failed",
      severity: "error",
      title: "质量门失败",
      detail: safeText(report.qualityGate.summary || "验证命令失败"),
      recommendation: "先查看失败命令，修复后重跑同一质量门；若已写入主工作区，优先使用 rollback 恢复。",
    })
  }
  if (report.commandAuthorization && report.commandAuthorization.ok === false) {
    failures.push({
      id: "command_authorization_blocked",
      severity: "warning",
      title: "命令授权未完全通过",
      detail: `blocked ${report.commandAuthorization.blocked || 0}, needs ${report.commandAuthorization.needsPermission || 0}`,
      recommendation: "缩小命令范围或由用户显式授权后再执行。",
    })
  }
  for (const action of Array.isArray(report.recoveryActions) ? report.recoveryActions : []) {
    failures.push({
      id: `recovery:${action.id || action.action}`,
      severity: "info",
      title: `恢复建议：${safeText(action.action || "-")}`,
      detail: safeText(action.reason || ""),
      recommendation: safeText(action.nextStatus || action.reason || "按恢复动作继续处理。"),
    })
  }
  if (!failures.length) {
    failures.push({
      id: "none",
      severity: "info",
      title: "未记录阻断失败",
      detail: "当前报告未发现质量门或授权阻断。",
      recommendation: "人工验收时复核 diff、验证命令和回滚证据。",
    })
  }
  return failures
}

function buildRollbackRecommendation(report) {
  if (report.changeSummary?.rollbackResult) {
    return "已执行 rollback；人工验收时复核回滚文件和 SCM 状态。"
  }
  if (report.realWorkspaceTrial?.rollbackAvailable || report.changeSummary?.applyResult) {
    return "可按 rollbackResult 或 applySnapshot 回滚；人工验收前请保留报告与快照证据。"
  }
  if (report.realWorkspaceTrial?.mainWorkspaceUntouchedBeforeAccept) {
    return "Accept 前主工作区未写入；如不验收，直接拒绝或要求返工即可。"
  }
  return "缺少可自动回滚证据；人工验收前先备份并复核变更文件。"
}

function normalizeHumanAcceptance(value = {}) {
  return {
    status: safeText(value.status || "pending"),
    conclusion: safeText(value.conclusion || "待人工验收：确认计划、diff、质量门、回滚建议和成本摘要后填写。"),
    reviewer: safeText(value.reviewer || ""),
    reviewedAt: finiteNumberOrNull(value.reviewedAt),
    notes: safeText(value.notes || ""),
  }
}

function toTrialTaskReportMarkdown(report) {
  const stepRows = report.executionSteps.map((item) =>
    `| ${escapeCell(item.title)} | ${escapeCell(item.status)} | ${escapeCell(item.summary)} |`,
  )
  const commandRows = report.validation.commands.map((item) =>
    `| ${escapeCell(item.command)} | ${escapeCell(item.status)} | ${item.exitCode === null ? "-" : item.exitCode} | ${item.timedOut ? "YES" : "NO"} | ${item.durationMs === null ? "-" : item.durationMs} |`,
  )
  const failureRows = report.failures.map((item) =>
    `| ${escapeCell(item.severity)} | ${escapeCell(item.title)} | ${escapeCell(item.detail)} | ${escapeCell(item.recommendation)} |`,
  )
  return [
    "# Codek 试用任务验收报告",
    "",
    `- Run ID: ${report.runId}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- 任务目标: ${report.task.goal || "-"}`,
    `- 最终状态: ${report.task.finalStatusLabel || report.task.finalStatus || "-"}`,
    `- 执行策略: ${report.task.visibleMode || "-"} / ${report.task.executionStrategy || "-"}`,
    `- 写入边界: ${report.task.writeMode || "-"}；Accept 前主工作区未写入: ${report.task.proposalOnlyBeforeAccept ? "YES" : "NO"}`,
    `- 下一步: ${report.task.nextAction || "-"}`,
    "",
    "## 步骤摘要",
    "",
    "| 步骤 | 状态 | 摘要 |",
    "| --- | --- | --- |",
    ...(stepRows.length ? stepRows : ["| - | - | - |"]),
    "",
    "## Diff / 文件变更摘要",
    "",
    `- 摘要: ${report.diffSummary.summary || "-"}`,
    `- 文件数: ${report.diffSummary.fileCount}`,
    `- 变更文件: ${formatList(report.diffSummary.filesChanged)}`,
    `- 已写入文件: ${formatList(report.diffSummary.appliedFiles)}`,
    `- 已回滚文件: ${formatList(report.diffSummary.rolledBackFiles)}`,
    `- Full diff body: ${report.diffSummary.diffBodyIncluded ? "included" : "not included"}`,
    "",
    "## 验证命令与结果",
    "",
    `- 状态: ${report.validation.status}`,
    `- 摘要: ${report.validation.summary || "-"}`,
    "",
    "| 命令 | 状态 | Exit Code | Timeout | Duration(ms) |",
    "| --- | --- | --- | --- | --- |",
    ...(commandRows.length ? commandRows : ["| 未运行 | not_run | - | NO | - |"]),
    "",
    "## 成本与耗时",
    "",
    `- Run duration: ${report.cost.durationMs}ms`,
    `- Budget time: ${report.cost.budgetTimeMs === null ? "-" : `${report.cost.budgetTimeMs}ms`}`,
    `- Tokens: ${report.cost.token === null ? "-" : report.cost.token}`,
    `- Cost: ${report.cost.cost === null ? "-" : `${report.cost.cost} ${report.cost.currency || ""}`.trim()}`,
    "",
    "## 失败与回滚建议",
    "",
    `- Rollback available: ${report.rollback.available ? "YES" : "NO"}`,
    `- Rollback applied: ${report.rollback.applied ? "YES" : "NO"}`,
    `- 建议: ${report.rollback.recommendation}`,
    "",
    "| 严重度 | 标题 | 详情 | 建议 |",
    "| --- | --- | --- | --- |",
    ...failureRows,
    "",
    "## 人工验收结论",
    "",
    `- 状态: ${report.humanAcceptance.status}`,
    `- 结论: ${report.humanAcceptance.conclusion || "-"}`,
    `- 验收人: ${report.humanAcceptance.reviewer || "-"}`,
    `- 验收时间: ${report.humanAcceptance.reviewedAt || "-"}`,
    `- 备注: ${report.humanAcceptance.notes || "-"}`,
    "",
    "## 隐私与证据边界",
    "",
    "- 本报告只保存结构化摘要，不保存 prompt 正文、源码正文、完整 diff 正文或完整命令输出。",
    "- 运行时状态继续来自现有 run report / realWorkspaceTrial / release evidence，不新增第二套任务状态源。",
  ].join("\n")
}

function formatList(values) {
  return Array.isArray(values) && values.length ? values.join(", ") : "无"
}

function formatUsd(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return "$0.0000"
  return `$${number.toFixed(4)}`
}

function escapeCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))]
}

function finiteNumberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizeCommandForReport(value) {
  return safeText(value).replace(/\s+/g, " ")
}

function statusFromExitCode(exitCode) {
  if (typeof exitCode !== "number" || !Number.isFinite(exitCode)) return "unknown"
  return exitCode === 0 ? "passed" : "failed"
}

function safeText(value) {
  return String(value || "")
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, "[redacted]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1[redacted]")
    .replace(/\b(api[_-]?key|token|password|secret|authorization)\s*[:=]\s*[^,\s;]+/gi, "$1=[redacted]")
    .replace(/\r?\n/g, " ")
    .trim()
}

function toRunReportMarkdown(report) {
  const permissionRows = report.permissions.map((item) =>
    `| ${item.status} | ${item.risk || "-"} | ${formatList(item.writePaths)} | ${formatList(item.commandAllowlist)} | ${item.network ? "是" : "否"} | ${item.destructive ? "是" : "否"} |`,
  )
  const assignmentRows = report.assignments.map((item) =>
    `| ${item.phaseId} | ${item.role} | ${item.status} | ${formatList(item.files)} | ${item.workspaceIsolation || "-"} |`,
  )
  const recoveryRows = report.recoveryActions.map((item) =>
    `| ${item.action} | ${item.status} | ${item.nextStatus || "-"} | ${item.reason || "-"} |`,
  )
  const decisionRows = report.decisions.map((item) =>
    `| ${item.type} | ${item.status || "-"} | ${item.selectedOption || "-"} | ${item.reason || "-"} |`,
  )
  const commandRows = (report.commandAuthorization?.commands || []).map((item) =>
    `| ${item.command} | ${item.status} | ${item.capabilities.network ? "是" : "否"} | ${item.capabilities.install ? "是" : "否"} | ${item.capabilities.externalTool ? "是" : "否"} | ${formatList(item.reasons)} |`,
  )
  const worktreeStrategy = report.worktreeMergeStrategy || null
  const worktreeCommandRows = (worktreeStrategy?.validationMatrix.commands || []).map((item) =>
    `| ${item.command} | ${item.status} | ${item.exitCode === null ? "-" : item.exitCode} | ${item.timedOut ? "是" : "否"} |`,
  )
  const worktreeFailureRows = (worktreeStrategy?.failureClassification || []).map((item) =>
    `| ${item.id} | ${item.category} | ${item.severity} | ${item.stage} | ${item.requiresHumanDecision ? "是" : "否"} | ${item.summary || "-"} |`,
  )
  const contextEvidence = report.contextEvidence || null
  const mentionRows = (contextEvidence?.mentions || []).map((item) =>
    `| ${item.type || "-"} | ${item.label || "-"} | ${item.detail || item.id || "-"} | ${item.resolved ? "是" : "否"} |`,
  )
  const attachmentRows = (contextEvidence?.attachments || []).map((item) =>
    `| ${item.kind || "-"} | ${item.name || "-"} | ${item.size || 0} | ${item.status || "-"} | ${item.truncated ? "是" : "否"} |`,
  )
  const ruleRows = (contextEvidence?.rules || []).map((item) =>
    `| ${item.path || "-"} | ${item.title || "-"} | ${item.glob || "-"} | ${item.priority || 0} |`,
  )
  const workspaceRows = (contextEvidence?.workspaceSources || []).map((item) =>
    `| ${item.type || "-"} | ${item.label || "-"} | ${item.path || item.detail || "-"} | ${item.count ?? "-"} | ${item.contentLength || 0} | ${item.truncated ? "是" : "否"} |`,
  )
  const agentRoleTrials = report.agentRoleTrials || { trials: [] }
  const agentRoleTrialRows = (agentRoleTrials.trials || []).map((item) =>
    `| ${item.taskId || item.assignmentId || "-"} | ${item.role || "-"} | ${item.profileId || "-"} | ${escapeCell(item.selectionReason || "-")} | ${formatList(item.permissionScope?.writePaths)} | ${formatList(item.validationAdvice)} | ${escapeCell(item.benefit || "-")} | ${escapeCell(item.noise || "-")} | ${item.worthRuntimeIntegration ? "是" : "否"} |`,
  )
  const indexStatus = contextEvidence?.indexStatus || null
  const budgetPolicy = contextEvidence?.budget?.policy || null
  const realTrialLines = report.realWorkspaceTrial ? [
    "",
    "## Real Workspace Trial",
    "",
    `- Mode: ${report.realWorkspaceTrial.writeMode === "proposed_patch_only" ? "proposal-only" : report.realWorkspaceTrial.writeMode}`,
    `- Workspace Root: ${report.realWorkspaceTrial.workspaceRoot || "-"}`,
    `- Allowed Paths: ${formatList(report.realWorkspaceTrial.allowedPaths)}`,
    `- Quality Gate Commands: ${formatList(report.realWorkspaceTrial.qualityGateCommands)}`,
    `- Blocked Commands: ${formatList(report.realWorkspaceTrial.blockedQualityGateCommands)}`,
    `- Main Workspace Untouched Before Accept: ${report.realWorkspaceTrial.mainWorkspaceUntouchedBeforeAccept ? "YES" : "NO"}`,
    `- Rollback Available: ${report.realWorkspaceTrial.rollbackAvailable ? "YES" : "NO"}`,
    `- Decision ID: ${report.realWorkspaceTrial.decisionId || "-"}`,
  ] : []
  const demo = report.realWorkspaceTrial?.demoTaskReport || null
  const demoTaskRows = (demo?.tasks || []).map((item) =>
    `| ${item.id || "-"} | ${escapeCell(item.title || "-")} | ${item.status || "-"} | ${item.roleProfile || "-"} | ${escapeCell(item.benefit || "-")} | ${escapeCell(item.noise || "-")} |`,
  )
  const roleProfileRows = (demo?.roleProfiles || []).map((item) =>
    `| ${item.id || item.label || "-"} | ${escapeCell(item.label || "-")} | ${formatList(item.assignmentIds)} | ${escapeCell(item.benefit || "-")} | ${escapeCell(item.noise || "-")} | ${escapeCell(item.recommendation || "-")} |`,
  )
  const roleTrialRows = (demo?.roleTrials || []).map((item) =>
    `| ${item.id || "-"} | ${item.profileId || "-"} | ${item.status || "-"} | ${item.assignmentId || "-"} | ${item.baselineMinutes ?? "-"} | ${item.trialMinutes ?? "-"} | ${escapeCell(item.benefit || "-")} | ${escapeCell(item.noise || "-")} |`,
  )
  const demoLines = demo?.available ? [
    "",
    "## Day 11-12 非玩具演示任务报告",
    "",
    `- 状态: ${demo.statusLabel || demo.status || "-"}`,
    `- 覆盖任务: ${formatList(demo.coveredTasks)} / 缺失: ${formatList(demo.missingTasks)}`,
    `- Role Profiles: ${demo.roleProfiles.length} 个 / Role Trials: ${demo.roleTrials.length} 条`,
    `- 角色收益: ${demo.roleBenefitSummary || "-"}`,
    `- 角色噪音: ${demo.roleNoiseSummary || "-"}`,
    `- 质量门: ${demo.qualityGate.status || "-"} - ${demo.qualityGate.summary || "-"}`,
    `- 成本/复核: ${formatUsd(demo.costReview.estimatedCostUsd)} ${demo.costReview.currency || "USD"} · 人工复核 ${demo.costReview.manualReviewMinutes || 0} 分钟 · 未定价请求 ${demo.costReview.unpricedRequests || 0}`,
    `- 失败复盘: ${demo.failureReview.summary || "-"}`,
    `- 回滚建议: ${demo.rollbackRecommendation.action || "-"} - ${demo.rollbackRecommendation.reason || "-"}`,
    `- 人工验收下一步: ${formatList(demo.nextHumanAcceptance)}`,
    "",
    "| T 项 | 标题 | 状态 | Role Profile | 收益 | 噪音 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(demoTaskRows.length ? demoTaskRows : ["| 无 | - | - | - | - | - |"]),
    "",
    "| Role Profile | 名称 | Assignment | 收益 | 噪音 | 建议 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(roleProfileRows.length ? roleProfileRows : ["| 无 | - | - | - | - | - |"]),
    "",
    "| Role Trial | Profile | 状态 | Assignment | 基线分钟 | 试用分钟 | 收益 | 噪音 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...(roleTrialRows.length ? roleTrialRows : ["| 无 | - | - | - | - | - | - | - |"]),
  ] : []
  const proposal = report.proposalOnlyDelivery || {}
  const proposalLines = [
    "",
    "## Proposal-only 交付包",
    "",
    `- Mode: ${proposal.mode || "-"}`,
    `- 内部策略: ${proposal.executionStrategy || "-"}`,
    `- Accept 前写入主工作区: ${proposal.mainWorkspaceWrite ? "YES" : "NO"}`,
    `- 需要 Accept 后应用: ${proposal.requiresAcceptBeforeApply ? "YES" : "NO"}`,
    `- Plan: ${proposal.plan?.available ? "YES" : "NO"} / phases ${proposal.plan?.phaseCount || 0} / tasks ${proposal.plan?.taskCount || 0}`,
    `- Proposed diff: ${proposal.proposedDiff?.available ? "YES" : "NO"} / files ${proposal.proposedDiff?.fileCount || 0} / patches ${proposal.proposedDiff?.patchCount || 0}`,
    `- Artifacts: ${proposal.artifacts?.total || 0}`,
    `- Verification: ${proposal.verification?.status || "-"} / ${proposal.verification?.summary || "-"}`,
    `- Decision actions: ${formatList(proposal.decisionEvidence?.availableActions || [])}`,
    `- Accept evidence: ${proposal.decisionEvidence?.accept?.status || "-"}`,
    `- Rework evidence: ${proposal.decisionEvidence?.rework?.status || "-"}`,
    `- Reject evidence: ${proposal.decisionEvidence?.reject?.status || "-"}`,
    `- Rollback evidence: ${proposal.decisionEvidence?.rollback?.status || "-"}`,
  ]
  const worktreeStrategyLines = worktreeStrategy ? [
    "",
    "## Worktree 合入策略",
    "",
    `- 状态: ${worktreeStrategy.status || "-"}`,
    `- 模式: ${worktreeStrategy.mode || "-"}`,
    `- 状态源: ${worktreeStrategy.stateSource || "-"}`,
    `- 未新增第二状态源: ${worktreeStrategy.preservesSingleStateSource ? "是" : "否"}`,
    `- 冲突: ${worktreeStrategy.conflictSummary.status || "-"} / ${worktreeStrategy.conflictSummary.total} 个文件 / ${formatList(worktreeStrategy.conflictSummary.files)}`,
    `- 验证矩阵: ${worktreeStrategy.validationMatrix.status || "-"} / ${worktreeStrategy.validationMatrix.summary.passed}/${worktreeStrategy.validationMatrix.summary.total} 通过 / ${worktreeStrategy.validationMatrix.summary.failed} 失败 / ${worktreeStrategy.validationMatrix.summary.notRun} 未运行`,
    `- 合入前证据: head ${worktreeStrategy.evidence.preMerge.gitHead || "-"} / staged ${formatList(worktreeStrategy.evidence.preMerge.stagedFiles)} / reports ${formatList(worktreeStrategy.evidence.preMerge.reportRefs)}`,
    `- 合入后证据: ${worktreeStrategy.evidence.postMerge.status || "-"} / staged ${formatList(worktreeStrategy.evidence.postMerge.stagedFiles)} / reports ${formatList(worktreeStrategy.evidence.postMerge.reportRefs)}`,
    `- 主线程建议: ${worktreeStrategy.mainThreadDecision.recommendedAction || "-"} / 必填 ${formatList(worktreeStrategy.mainThreadDecision.requiredFields)}`,
    `- 决策提示: ${worktreeStrategy.mainThreadDecision.decisionPrompt || "-"}`,
    "",
    "| 验证命令 | 状态 | Exit Code | 超时 |",
    "| --- | --- | --- | --- |",
    ...(worktreeCommandRows.length ? worktreeCommandRows : ["| 无 | - | - | - |"]),
    "",
    "| 失败分类 | 类别 | 严重度 | 阶段 | 需人工 | 摘要 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(worktreeFailureRows.length ? worktreeFailureRows : ["| 无 | - | - | - | - | - |"]),
  ] : []
  return [
    "# Codek 自主 Agent 任务报告",
    "",
    `- Run ID: ${report.runId}`,
    `- 用户目标: ${report.userGoal || "-"}`,
    `- 最终状态: ${report.finalStatusLabel}`,
    `- 下一步: ${report.nextAction || "无"}`,
    `- 项目类型: ${report.projectKindLabel}`,
    `- 写入模式: ${report.writeModeLabel}`,
    `- 项目路径: ${report.projectRoot}`,
    "",
    "## Router 选择",
    "",
    `- 可见模式: ${report.router.visibleMode}`,
    `- 内部策略: ${report.router.executionStrategy}`,
    `- 原因: ${report.router.reason || "-"}`,
    "",
    "## 文件范围",
    "",
    `- 变更文件: ${formatList(report.fileScope)}`,
    "",
    "## 上下文证据链",
    "",
    `- 来源数量: ${contextEvidence?.budget?.totalSources || 0}`,
    `- 估算字符: ${contextEvidence?.budget?.estimatedChars || 0}`,
    `- 工作台上下文字符: ${contextEvidence?.budget?.workspaceContextChars || 0}`,
    `- 截断来源: ${contextEvidence?.budget?.truncatedSources || 0}`,
    `- 附件提示: ${contextEvidence?.budget?.warningCount || 0}`,
    `- 预算策略: ${budgetPolicy ? `${budgetPolicy.taskType || "general"} / ${budgetPolicy.riskLevel || "normal"} / 可用 ${budgetPolicy.availableContextChars || 0} / 溢出 ${budgetPolicy.overflowChars || 0}` : "未记录"}`,
    `- 索引状态: ${indexStatus ? `${indexStatus.state || "unknown"} / ${indexStatus.freshness || "unknown"} / ${indexStatus.indexedFiles || 0}/${indexStatus.indexableFiles || 0} / 排除 ${indexStatus.excludedFiles || 0}` : "未记录"}`,
    "",
    "| Mention 类型 | 名称 | 来源 | 已解析 |",
    "| --- | --- | --- | --- |",
    ...(mentionRows.length ? mentionRows : ["| 无 | - | - | - |"]),
    "",
    "| 附件类型 | 名称 | 字节 | 状态 | 已截断 |",
    "| --- | --- | --- | --- | --- |",
    ...(attachmentRows.length ? attachmentRows : ["| 无 | - | 0 | - | - |"]),
    "",
    "| 规则文件 | 标题 | Glob | 优先级 |",
    "| --- | --- | --- | --- |",
    ...(ruleRows.length ? ruleRows : ["| 无 | - | - | - |"]),
    "",
    "| 工作台来源 | 名称 | 路径/说明 | 数量 | 字符 | 已截断 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(workspaceRows.length ? workspaceRows : ["| 无 | - | - | - | 0 | - |"]),
    "",
    "## Agent 角色 Profile 试用",
    "",
    `- 状态: ${agentRoleTrials.statusLabel || "-"}`,
    `- 运行时接入建议: ${agentRoleTrials.runtimeIntegrationRecommended ? "建议接入" : "暂不接入"}`,
    `- 决策: ${agentRoleTrials.recommendation || "-"}`,
    `- 原因: ${agentRoleTrials.decisionReason || "按试用完整度与噪音收益判断"}`,
    `- 接入契约: ${agentRoleTrials.runtimeContract?.noSecondStateSource ? "复用现有 orchestrator run / assignment / event / artifact / evidence 链路，不新增第二状态源" : "-"}`,
    "",
    "| 子任务 | Role | Profile | 选择理由 | 写权限范围 | 验证建议 | 收益 | 噪音 | 建议接入 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...(agentRoleTrialRows.length ? agentRoleTrialRows : ["| 无 | - | - | - | - | - | - | - | - |"]),
    "",
    "## 权限请求与审批",
    "",
    "| 状态 | 风险 | 写入路径 | 命令 | 网络 | 破坏性 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(permissionRows.length ? permissionRows : ["| 无 | - | - | - | 否 | 否 |"]),
    "",
    "## Agent 分工",
    "",
    "| Phase | Role | 状态 | 文件 | Workspace |",
    "| --- | --- | --- | --- | --- |",
    ...(assignmentRows.length ? assignmentRows : ["| 无 | - | - | - | - |"]),
    "",
    "## 变更摘要",
    "",
    `- 摘要: ${report.changeSummary.summary || "-"}`,
    `- Proposed patch 数量: ${report.changeSummary.proposedPatchCount || 0}`,
    `- 已写入文件: ${formatList(report.changeSummary.applyResult?.filesChanged || [])}`,
    `- 已回滚文件: ${formatList(report.changeSummary.rollbackResult?.filesChanged || [])}`,
    "",
    "## 质量门",
    "",
    `- 状态: ${report.qualityGate.status}`,
    `- 摘要: ${report.qualityGate.summary}`,
    "",
    "## 命令授权",
    "",
    `- 状态: ${report.commandAuthorization?.ok ? "通过" : "存在阻断"}`,
    `- 允许/阻断/需授权: ${report.commandAuthorization?.allowed || 0}/${report.commandAuthorization?.blocked || 0}/${report.commandAuthorization?.needsPermission || 0}`,
    "",
    "| 命令 | 状态 | 网络 | 安装 | 外部工具 | 原因 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(commandRows.length ? commandRows : ["| 无 | - | 否 | 否 | 否 | - |"]),
    "",
    "## 恢复动作",
    "",
    `- 推荐: ${report.recoveryRecommendation ? `${report.recoveryRecommendation.action} - ${report.recoveryRecommendation.reason}` : "无"}`,
    "",
    "| 动作 | 状态 | 后续状态 | 原因 |",
    "| --- | --- | --- | --- |",
    ...(recoveryRows.length ? recoveryRows : ["| 无 | - | - | - |"]),
    "",
    "## 决策审计",
    "",
    "| 类型 | 状态 | 选择 | 原因 |",
    "| --- | --- | --- | --- |",
    ...(decisionRows.length ? decisionRows : ["| 无 | - | - | - |"]),
    "",
    ...proposalLines,
    ...worktreeStrategyLines,
    ...realTrialLines,
    ...demoLines,
  ].join("\n")
}

module.exports = {
  buildTrialTaskReport,
  buildRunReport,
  defaultRunReportDir,
  listRealWorkspaceTrialReports,
  listTrialTaskReports,
  readLatestRealWorkspaceTrialReport,
  readLatestTrialTaskReport,
  saveRunReport,
  toTrialTaskReportMarkdown,
  toRunReportMarkdown,
}
