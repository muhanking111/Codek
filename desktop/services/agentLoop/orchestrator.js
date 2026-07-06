const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const planner = require("./planner")
const planExecutor = require("./planExecutor")
const { chooseAgentStrategy } = require("./agentRouter")
const { assignRoles } = require("./roleAssigner")
const artifactStore = require("./artifactStore")
const {
  createAssignmentWorkspace,
  collectWorkspacePatch,
  cleanupWorkspaceLease,
} = require("./workspaceLease")
const integrator = require("./integrator")
const {
  applyPatchSet,
  collectSnapshotDrift,
  restoreApplySnapshot,
} = require("./patchApplier")
const { buildPatchScmAudit, collectScmAuditSnapshot } = require("./scmAudit")
const { runQualityGate } = require("./qualityGate")
const {
  createRecoveryAction,
  executeRecoveryAction,
  suggestRecoveryActions,
} = require("./recoveryActions")
const {
  getDefaultStore,
  configureDefaultStore,
  normalizeInterruptedRun,
} = require("./orchestratorStore")
const { normalizeRunRuntimeStatus } = require("./runtimeStatus")
const {
  createPermissionViolationMessage,
  validateCommandPermissions,
  validatePatchPermissions,
} = require("./permissionPolicy")
const { withProjectScope } = require("./projectScope")
const { buildRunReport, saveRunReport } = require("./runReport")
const { summarizeCommandAuthorization } = require("./commandAuthorization")
const {
  buildRealWorkspaceTrialRequest,
  normalizeRealWorkspaceTrialConfig,
} = require("./realWorkspaceTrial")
const { buildOrchestratorReadinessReport } = require("./readiness")
const { normalizeContextEvidence } = require("./contextEvidence")

const ACCEPT_BLOCK_REASON = "manual-change-detected-before-accept"
const ROLLBACK_BLOCK_REASON = "manual-change-detected-before-rollback"

const runs = new Map()
const controllers = new Map()
let persistentStore = null

function now() {
  return Date.now()
}

function makeId(prefix) {
  return `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function withRuntimeStatus(run) {
  if (!run) return run
  return withProjectScope({
    ...run,
    ...normalizeRunRuntimeStatus(run),
  })
}

function setRun(run) {
  run.updatedAt = now()
  runs.set(run.id, run)
  if (persistentStore?.saveRun) {
    try { persistentStore.saveRun(run) } catch {}
  }
  return run
}

function getMutableRun(id) {
  const cached = runs.get(id)
  if (cached && !cached.__summaryOnly) return cached
  const stored = persistentStore?.getRun?.(id)
  if (stored) {
    delete stored.__summaryOnly
    runs.set(id, stored)
    artifactStore.hydrateRun(id, persistentStore?.listArtifacts?.(id) || [])
    return stored
  }
  return cached || null
}

function getRun(id) {
  const run = getMutableRun(id)
  return run ? clone(withRuntimeStatus(run)) : null
}

function listRuns() {
  const byId = new Map()
  for (const run of persistentStore?.listRuns?.({ includeDetails: false, includeDecision: true }) || []) {
    byId.set(run.id, { ...run, __summaryOnly: true })
  }
  for (const run of runs.values()) byId.set(run.id, run)
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).map((run) => clone(withRuntimeStatus(run)))
}

function emitRunEvent(run, emit, event) {
  const payload = {
    runId: run.id,
    visibleMode: run.visibleMode,
    executionStrategy: run.executionStrategy,
    ...event,
  }
  run.events.push({ ...payload, createdAt: now() })
  setRun(run)
  if (typeof emit === "function") emit(payload)
}

function createDecisionEntry(run, entry = {}) {
  return {
    id: entry.id || makeId("audit"),
    runId: run.id,
    type: entry.type || "decision",
    title: entry.title || "",
    reason: entry.reason || "",
    inputSignals: entry.inputSignals || null,
    options: entry.options || [],
    selectedOption: entry.selectedOption || "",
    risk: entry.risk || null,
    userConfirmed: entry.userConfirmed === true,
    status: entry.status || "recorded",
    blockingReason: entry.blockingReason || "",
    metadata: entry.metadata || {},
    createdAt: entry.createdAt || now(),
  }
}

function recordDecision(run, entry = {}) {
  if (!run?.id) return null
  run.decisionLog = Array.isArray(run.decisionLog) ? run.decisionLog : []
  const item = createDecisionEntry(run, entry)
  run.decisionLog.push(item)
  setRun(run)
  return item
}

function buildPermissionRequest(run, request = {}) {
  const text = String(request.message || request.userInput || request.goal || run.userInput || "")
  const files = Array.isArray(request.files) ? request.files.map((file) => String(file).replace(/\\/g, "/")) : []
  const destructive = /\b(delete|drop|remove|reset|rebase|overwrite)\b/i.test(text) || /(删除|清空|覆盖|回滚|重置)/.test(text)
  const network = /\b(install|download|publish|deploy|push|npm|pnpm|yarn|pip|cargo)\b/i.test(text) || /(安装|下载|发布|部署|推送)/.test(text)
  const commandAllowlist = []
  if (/\b(typecheck|lint|test|build)\b/i.test(text) || /(测试|构建|类型检查)/.test(text)) {
    commandAllowlist.push("npm run typecheck", "npm run build", "npm test")
  }
  if (/\b(install|npm|pnpm|yarn)\b/i.test(text) || /(安装|依赖)/.test(text)) {
    commandAllowlist.push("npm install")
  }
  return {
    id: makeId("permission"),
    runId: run.id,
    status: "waiting_user",
    risk: run.strategySignals?.risk || "high",
    readPaths: files.length ? files : ["当前工作区"],
    writePaths: files,
    commandAllowlist: [...new Set(commandAllowlist)],
    network,
    install: network && (/\b(install|npm|pnpm|yarn|pip|cargo)\b/i.test(text) || /(安装|依赖)/.test(text)),
    externalTool: /\b(push|publish|deploy)\b/i.test(text) || /(发布|部署|推送)/.test(text),
    destructive,
    reason: run.blockingReason || "高风险任务需要确认沙箱权限边界",
    createdAt: now(),
    decidedAt: null,
    decisionReason: "",
  }
}

function createRun({
  goalId = null,
  projectRoot,
  visibleMode = "agent",
  userInput,
  strategyDecision,
  agentStrategy = null,
  files = [],
  attachments = [],
  contextEvidence = null,
  risk = null,
  policyProfile = "default",
  qualityGateCommands = [],
  realWorkspaceTrial = null,
}) {
  const trialConfig = realWorkspaceTrial
    ? normalizeRealWorkspaceTrialConfig(realWorkspaceTrial, { projectRoot })
    : null
  const decision = strategyDecision || chooseAgentStrategy({
    visibleMode,
    text: userInput,
    agentStrategy,
    files,
    risk,
  })
  const run = {
    id: makeId("run"),
    goalId,
    projectRoot: projectRoot || process.cwd(),
    status: "planning",
    visibleMode: decision.visibleMode,
    executionStrategy: decision.executionStrategy === "none" ? "single-agent" : decision.executionStrategy,
    strategyReason: decision.reason,
    strategySignals: decision.signals,
    userInput: userInput || "",
    attachments: Array.isArray(attachments) ? attachments : [],
    contextEvidence: normalizeContextEvidence(contextEvidence),
    blockingReason: "",
    createdAt: now(),
    updatedAt: now(),
    summary: "",
    activeWave: 0,
    budget: { token: null, cost: null, timeMs: null },
    policyProfile: trialConfig ? "real-workspace-trial" : policyProfile,
    qualityGateCommands: trialConfig ? trialConfig.qualityGateCommands : qualityGateCommands,
    realWorkspaceTrial: trialConfig,
    plan: null,
    assignments: [],
    integrationDecision: null,
    events: [],
    decisionLog: [],
    permissionRequest: null,
  }
  recordDecision(run, {
    type: "router",
    title: "路由决策",
    reason: decision.reason,
    inputSignals: decision.signals,
    options: ["single-agent", "multi-agent"],
    selectedOption: run.executionStrategy,
    risk: decision.signals?.risk || null,
    status: "selected",
    metadata: {
      visibleMode: run.visibleMode,
      requestedAgentStrategy: agentStrategy || null,
    },
  })
  if (trialConfig) {
    recordDecision(run, {
      type: "real_workspace_trial_configured",
      title: "真实工作区试运行配置",
      reason: "真实工作区试运行默认 proposal-only，并限制质量门与写入范围",
      inputSignals: {
        allowedPaths: trialConfig.allowedPaths,
        qualityGateCommands: trialConfig.qualityGateCommands,
        blockedQualityGateCommands: trialConfig.blockedQualityGateCommands,
      },
      selectedOption: trialConfig.writeMode,
      risk: decision.signals?.risk || null,
      status: "configured",
      metadata: trialConfig,
    })
  }
  return setRun(run)
}

function taskFromRun(run) {
  const signals = run.strategySignals || {}
  const runtime = normalizeRunRuntimeStatus(run)
  const requiresConfirmation = run.status === "waiting_user"
    && (run.permissionRequest?.status === "waiting_user" || run.integrationDecision?.status === "pending")
  return {
    id: run.goalId || run.id,
    runId: run.id,
    title: String(run.userInput || run.summary || "Agent 任务").split(/\r?\n/)[0].slice(0, 80),
    status: run.status,
    runtimeStatus: runtime.runtimeStatus,
    runtimeStatusLabel: runtime.runtimeStatusLabel,
    runtimeReason: runtime.runtimeReason,
    visibleMode: run.visibleMode,
    executionStrategy: run.executionStrategy,
    routerDecision: {
      visibleMode: run.visibleMode,
      executionStrategy: run.executionStrategy,
      reason: run.strategyReason,
      signals,
    },
    requiresConfirmation,
    blockingReason: run.blockingReason || runtime.runtimeReason || "",
    nextAction: runtime.nextAction,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  }
}

function createTask(request = {}, emit) {
  const message = String(request.message || request.userInput || request.goal || "").trim()
  if (!message) {
    const err = new Error("message is required")
    err.statusCode = 400
    err.code = "bad_request"
    throw err
  }

  const taskId = makeId("task")
  const run = createRun({
    goalId: taskId,
    projectRoot: request.projectRoot,
    visibleMode: request.mode || request.visibleMode || "agent",
    userInput: message,
    agentStrategy: request.agentStrategy,
    files: request.files || [],
    attachments: request.attachments || [],
    contextEvidence: request.contextEvidence || null,
    risk: request.risk,
    policyProfile: request.policyProfile || "default",
    qualityGateCommands: request.qualityGateCommands || [],
    realWorkspaceTrial: request.realWorkspaceTrial || null,
  })

  emitRunEvent(run, emit, {
    type: "orchestrator:task_created",
    status: run.status,
    taskId,
  })
  emitRunEvent(run, emit, {
    type: "orchestrator:strategy_selected",
    decision: {
      visibleMode: run.visibleMode,
      executionStrategy: run.executionStrategy,
      reason: run.strategyReason,
      signals: run.strategySignals,
    },
  })

  if (run.strategySignals?.risk === "high") {
    run.status = "waiting_user"
    run.blockingReason = "高风险任务需要用户确认后才能继续执行"
    run.summary = run.blockingReason
    run.permissionRequest = buildPermissionRequest(run, request)
    recordDecision(run, {
      type: "permission_block",
      title: "权限确认",
      reason: run.blockingReason,
      inputSignals: run.strategySignals,
      options: ["等待用户确认", "缩小任务范围", "拒绝执行"],
      selectedOption: "等待用户确认",
      risk: "high",
      userConfirmed: false,
      status: "blocked",
      blockingReason: run.blockingReason,
      metadata: { permissionRequestId: run.permissionRequest.id },
    })
    emitRunEvent(run, emit, {
      type: "orchestrator:user_confirmation_required",
      status: run.status,
      reason: run.blockingReason,
    })
    saveRunCheckpoint(run, {
      stage: "waiting_user",
      summary: run.blockingReason,
      canResume: true,
    })
  } else {
    setRun(run)
  }

  const fresh = getRun(run.id)
  return {
    task: taskFromRun(fresh),
    run: fresh,
  }
}

function saveRunCheckpoint(run, patch = {}) {
  if (!run?.id) return null
  try {
    ensureStore()
    const artifacts = artifactStore.listArtifacts(run.id)
    const recoveryActions = persistentStore?.listRecoveryActions?.(run.id) || []
    const checkpoint = persistentStore?.saveCheckpoint?.(run.id, {
      stage: patch.stage || run.status,
      summary: patch.summary || run.summary || run.blockingReason || "",
      plan: run.plan || null,
      assignments: run.assignments || [],
      artifactIds: artifacts.map((artifact) => artifact.id),
      qualityGate: run.integrationDecision?.qualityGate || null,
      recoveryActionIds: recoveryActions.map((action) => action.id),
      canResume: patch.canResume !== false,
      ...patch,
    })
    if (checkpoint) {
      run.latestCheckpointId = checkpoint.id
      run.checkpointStatus = checkpoint.canResume ? "resumable" : "snapshot"
      recordDecision(run, {
        type: "checkpoint_saved",
        title: "保存 checkpoint",
        reason: checkpoint.summary || "已保存可恢复状态",
        selectedOption: checkpoint.canResume ? "可恢复" : "仅快照",
        status: checkpoint.canResume ? "resumable" : "snapshot",
        metadata: { checkpointId: checkpoint.id, stage: checkpoint.stage },
      })
      setRun(run)
    }
    return checkpoint
  } catch (err) {
    run.checkpointStatus = "unavailable"
    run.checkpointError = err instanceof Error ? err.message : String(err)
    setRun(run)
    return null
  }
}

function listCheckpoints(runId) {
  if (!runId) return []
  ensureStore()
  return persistentStore?.listCheckpoints?.(runId) || []
}

function getLatestCheckpoint(runId) {
  if (!runId) return null
  ensureStore()
  return persistentStore?.getLatestCheckpoint?.(runId) || null
}

function resumeRunFromCheckpoint(runId) {
  const run = getMutableRun(runId)
  if (!run) return null
  const checkpoint = getLatestCheckpoint(runId)
  if (!checkpoint || checkpoint.canResume === false) {
    return { run: getRun(runId), checkpoint: null, resumed: false, reason: "没有可恢复 checkpoint" }
  }
  run.status = run.status === "failed"
    ? "waiting_user"
    : run.status === "paused"
      ? (checkpoint.previousStatus || "running")
      : run.status
  run.latestCheckpointId = checkpoint.id
  run.checkpointStatus = "resumable"
  run.summary = run.summary || checkpoint.summary || ""
  recordDecision(run, {
    type: "checkpoint_resumed",
    title: "恢复 checkpoint",
    reason: "已恢复到最近 checkpoint",
    selectedOption: checkpoint.id,
    status: "resumed",
    metadata: { checkpointId: checkpoint.id, stage: checkpoint.stage },
  })
  emitRunEvent(run, null, {
    type: "orchestrator:checkpoint_resumed",
    status: run.status,
    checkpointId: checkpoint.id,
  })
  setRun(run)
  return { run: getRun(runId), checkpoint, resumed: true, reason: "已恢复到最近 checkpoint" }
}

function pauseRun(runId, reason = "") {
  const run = getMutableRun(runId)
  if (!run) return null
  const previousStatus = run.status || "planning"
  run.status = "paused"
  run.pausedAt = now()
  run.pauseRequested = true
  run.summary = reason || run.summary || "Task paused at a resumable checkpoint"
  const checkpoint = saveRunCheckpoint(run, {
    stage: "paused",
    summary: run.summary,
    previousStatus,
    canResume: true,
  })
  recordDecision(run, {
    type: "run_paused",
    title: "Pause run",
    reason: run.summary,
    selectedOption: "pause",
    status: "paused",
    metadata: { checkpointId: checkpoint?.id || null, previousStatus },
  })
  emitRunEvent(run, null, {
    type: "orchestrator:run_paused",
    status: run.status,
    checkpointId: checkpoint?.id || null,
    previousStatus,
  })
  const controller = controllers.get(runId)
  if (controller) controller.abort()
  setRun(run)
  return { run: getRun(runId), checkpoint, paused: true, previousStatus }
}

function listTasks() {
  return listRuns()
    .filter((run) => String(run.goalId || "").startsWith("task_"))
    .map(taskFromRun)
}

function createSmokePendingRunFixture() {
  if (process.env.CODEK_ELECTRON_SMOKE !== "1") {
    const err = new Error("smoke fixture is disabled")
    err.statusCode = 404
    err.code = "not_found"
    throw err
  }

  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-orchestrator-smoke-"))
  fs.writeFileSync(path.join(projectRoot, "demo.js"), "export const smokeValue = 1\n", "utf8")

  const run = createRun({
    projectRoot,
    visibleMode: "agent",
    userInput: "smoke pending patch fixture",
    strategyDecision: {
      visibleMode: "agent",
      executionStrategy: "single-agent",
      reason: "Electron smoke fixture uses one isolated agent run",
      signals: { smoke: true },
    },
  })

  const createdAt = now()
  const phase = {
    id: "phase_smoke_patch",
    name: "Create isolated smoke patch",
    tasks: [
      { description: "Update demo.js inside a temp project", files: ["demo.js"] },
    ],
    status: "completed",
  }
  const assignment = {
    id: "assignment_smoke_patch",
    runId: run.id,
    phaseId: phase.id,
    role: "implementer",
    status: "completed",
    sandboxMode: "workspace-write",
    readPaths: ["demo.js"],
    writePaths: ["demo.js"],
    lockedFiles: ["demo.js"],
    createdAt,
    startedAt: createdAt,
    completedAt: createdAt,
  }

  run.plan = {
    id: "plan_smoke_patch",
    title: "Electron smoke patch fixture",
    summary: "Isolated pending patch used by the Electron UI smoke test.",
    phases: [phase],
  }
  run.assignments = [assignment]
  run.status = "waiting_user"
  run.summary = "Isolated smoke run waiting for an integration decision."
  run.events = [
    ...(run.events || []),
    { runId: run.id, type: "orchestrator:smoke_fixture_created", status: run.status, createdAt },
  ]

  const patch = [
    "diff --git a/demo.js b/demo.js",
    "--- a/demo.js",
    "+++ b/demo.js",
    "@@ -1 +1 @@",
    "-export const smokeValue = 1",
    "+export const smokeValue = 2",
    "",
  ].join("\n")

  artifactStore.addArtifact(run.id, {
    assignmentId: assignment.id,
    type: "patch",
    content: patch,
    metadata: {
      filesChanged: ["demo.js"],
      fixture: "electron-smoke",
      projectRoot,
    },
  })

  run.integrationDecision = integrator.createIntegrationDecision({
    runId: run.id,
    assignments: run.assignments,
    artifacts: artifactStore.listArtifacts(run.id),
    qualityGate: null,
    plan: run.plan,
    executionStrategy: run.executionStrategy,
  })

  setRun(run)
  return getRun(run.id)
}

function readSmokeFixtureFile(runId, file = "demo.js") {
  if (process.env.CODEK_ELECTRON_SMOKE !== "1") {
    const err = new Error("smoke fixture is disabled")
    err.statusCode = 404
    err.code = "not_found"
    throw err
  }
  const run = getMutableRun(runId)
  if (!run) return null
  const root = path.resolve(run.projectRoot || "")
  const expectedPrefix = path.resolve(os.tmpdir())
  if (root !== expectedPrefix && !root.startsWith(expectedPrefix + path.sep)) {
    const err = new Error("run is not an isolated smoke fixture")
    err.statusCode = 403
    err.code = "forbidden"
    throw err
  }
  const target = path.resolve(root, normalizeSmokeFixturePath(file))
  if (target !== root && !target.startsWith(root + path.sep)) {
    const err = new Error("file escapes smoke fixture root")
    err.statusCode = 400
    err.code = "bad_request"
    throw err
  }
  return {
    runId,
    file,
    exists: fs.existsSync(target),
    content: fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "",
  }
}

function normalizeSmokeFixturePath(file) {
  return String(file || "demo.js").replace(/\\/g, "/").replace(/^\/+/, "")
}

function updateAssignment(run, phaseId, patch) {
  const assignment = run.assignments.find((item) => item.phaseId === phaseId)
  if (!assignment) return null
  Object.assign(assignment, patch)
  setRun(run)
  return assignment
}

function attachWorkspaceLeases(run, isolation = "overlay") {
  run.assignments = run.assignments.map((assignment) => {
    const lease = createAssignmentWorkspace({
      runId: run.id,
      assignmentId: assignment.id,
      projectRoot: run.projectRoot,
      isolation,
    })
    return {
      ...assignment,
      workspaceId: lease.id,
      workspace: lease,
    }
  })
  if (run.plan?.phases) {
    for (const phase of run.plan.phases) {
      const assignment = run.assignments.find((item) => item.phaseId === phase.id)
      if (assignment?.workspace) {
        phase.workspace = assignment.workspace
        phase.workspaceRoot = assignment.workspace.root
      }
    }
  }
  setRun(run)
}

function releaseWorkspaceLeases(run) {
  run.assignments = run.assignments.map((assignment) => ({
    ...assignment,
    workspace: assignment.workspace ? cleanupWorkspaceLease(assignment.workspace, { remove: false }) : null,
  }))
  setRun(run)
}

function collectAssignmentPatch(run, assignment) {
  if (!assignment?.workspace) return null
  const patchResult = collectWorkspacePatch(assignment.workspace)
  if (!patchResult.patch || !patchResult.filesChanged.length) return null
  const artifact = artifactStore.addArtifact(run.id, {
    assignmentId: assignment.id,
    type: "patch",
    content: patchResult.patch,
    metadata: {
      filesChanged: patchResult.filesChanged,
      workspaceId: assignment.workspaceId,
      isolation: assignment.workspace.isolation,
    },
  })
  assignment.lockedFiles = [...new Set([...(assignment.lockedFiles || []), ...patchResult.filesChanged])]
  setRun(run)
  return artifact
}

async function startRun(request, emit) {
  const run = createRun({
    goalId: request.goalId || null,
    projectRoot: request.projectRoot,
    visibleMode: request.visibleMode || "agent",
    userInput: request.userInput || request.goal || "",
    agentStrategy: request.agentStrategy,
    files: request.files || [],
    attachments: request.attachments || [],
    contextEvidence: request.contextEvidence || null,
    risk: request.risk,
    policyProfile: request.policyProfile || "default",
    qualityGateCommands: request.qualityGateCommands || [],
    realWorkspaceTrial: request.realWorkspaceTrial || null,
  })
  const controller = new AbortController()
  controllers.set(run.id, controller)

  emitRunEvent(run, emit, {
    type: "orchestrator:run_started",
    status: run.status,
  })
  emitRunEvent(run, emit, {
    type: "orchestrator:strategy_selected",
    decision: {
      visibleMode: run.visibleMode,
      executionStrategy: run.executionStrategy,
      reason: run.strategyReason,
      signals: run.strategySignals,
    },
  })

  try {
    const userInput = request.userInput || request.goal || ""
    const plan = request.plan || await planner.generate({
      userInput,
      provider: request.provider,
      model: request.model,
      apiKey: request.apiKey,
      baseUrl: request.baseUrl,
      projectSummary: request.projectSummary,
      rules: request.rules,
      signal: controller.signal,
    })

    run.plan = plan
    run.status = "running"
    run.assignments = assignRoles({
      runId: run.id,
      plan,
      projectRoot: run.projectRoot,
      executionStrategy: run.executionStrategy,
    })
    attachWorkspaceLeases(run, request.workspaceIsolation || "overlay")
    emitRunEvent(run, emit, { type: "orchestrator:plan_created", plan })

    const executorEmit = (event) => {
      if (!event) return
      if (event.phaseId && event.type === "phase_start") {
        const assignment = updateAssignment(run, event.phaseId, { status: "running", startedAt: now() })
        if (assignment) emitRunEvent(run, emit, { type: "orchestrator:assignment_started", assignment })
      }
      if (event.type === "sub_agent_sandbox" && event.phaseId) {
        updateAssignment(run, event.phaseId, {
          sandboxId: event.sandboxId,
          sandboxMode: event.sandboxMode,
        })
      }
      if (event.phaseId && event.type === "phase_blocked") {
        updateAssignment(run, event.phaseId, { status: "waiting_lock" })
        emitRunEvent(run, emit, { type: "orchestrator:lock_waiting", phaseId: event.phaseId, conflicts: event.conflicts || [] })
      }
      if (event.phaseId && event.type === "phase_done") {
        const assignment = updateAssignment(run, event.phaseId, {
          status: "completed",
          completedAt: now(),
          lockedFiles: event.filesChanged || [],
        })
        const patchArtifact = collectAssignmentPatch(run, assignment)
        if (patchArtifact) {
          emitRunEvent(run, emit, { type: "orchestrator:assignment_artifact", artifact: patchArtifact })
        }
        const artifact = artifactStore.addArtifact(run.id, {
          assignmentId: assignment?.id,
          type: "summary",
          content: event.summary || "",
          metadata: { filesChanged: event.filesChanged || [] },
        })
        emitRunEvent(run, emit, { type: "orchestrator:assignment_artifact", artifact })
        if (assignment) emitRunEvent(run, emit, { type: "orchestrator:assignment_completed", assignment })
      }
      if (event.phaseId && event.type === "phase_failed") {
        const assignment = updateAssignment(run, event.phaseId, {
          status: "failed",
          completedAt: now(),
        })
        suggestForAssignmentFailure(run, assignment, event.error)
        emitRunEvent(run, emit, { type: "orchestrator:assignment_failed", assignment, error: event.error })
      }
      if (typeof emit === "function") emit(event)
    }

    const result = await planExecutor.execute({
      plan,
      parentRequest: request,
      emit: executorEmit,
      signal: controller.signal,
      goalId: request.goalId,
      sharedContext: request.rules || request.projectSummary || "",
    })

    run.status = "integrating"
    run.summary = result.summary || ""
    emitRunEvent(run, emit, { type: "orchestrator:integration_started" })
    const artifacts = artifactStore.listArtifacts(run.id)
    run.integrationDecision = integrator.createIntegrationDecision({
      runId: run.id,
      assignments: run.assignments,
      artifacts,
      qualityGate: null,
      plan: run.plan,
      executionStrategy: run.executionStrategy,
    })
    run.status = run.integrationDecision.status === "pending" ? "waiting_user" : "completed"
    releaseWorkspaceLeases(run)
    emitRunEvent(run, emit, { type: "orchestrator:quality_gate_completed", qualityGate: null })
    if (run.status === "waiting_user") {
      saveRunCheckpoint(run, {
        stage: "waiting_user",
        summary: run.summary || "等待用户确认集成结果",
        canResume: true,
      })
      emitRunEvent(run, emit, { type: "orchestrator:user_decision_required", decision: run.integrationDecision })
    } else {
      emitRunEvent(run, emit, { type: "orchestrator:run_completed", decision: run.integrationDecision })
    }
    controllers.delete(run.id)
    return getRun(run.id)
  } catch (err) {
    if (controller.signal.aborted && run.pauseRequested) {
      run.status = "paused"
      releaseWorkspaceLeases(run)
      setRun(run)
      emitRunEvent(run, emit, { type: "orchestrator:run_paused", status: run.status })
      controllers.delete(run.id)
      return getRun(run.id)
    }
    run.status = controller.signal.aborted ? "cancelled" : "failed"
    run.summary = err instanceof Error ? err.message : String(err)
    releaseWorkspaceLeases(run)
    saveRunCheckpoint(run, {
      stage: run.status,
      summary: run.summary,
      canResume: run.status === "failed",
    })
    emitRunEvent(run, emit, { type: "orchestrator:run_failed", error: run.summary })
    controllers.delete(run.id)
    return getRun(run.id)
  }
}

async function startRealWorkspaceTrial(request = {}, emit) {
  const runRequest = buildRealWorkspaceTrialRequest(request)
  const readiness = buildOrchestratorReadinessReport({
    projectRoot: runRequest.projectRoot,
    settings: request.settings || {},
    config: runRequest.realWorkspaceTrial,
    runs: listRuns(),
  })
  if (readiness.status === "blocked") {
    return createReadinessBlockedRun(runRequest, readiness, emit)
  }
  return startRun(runRequest, emit)
}

function createReadinessBlockedRun(runRequest, readiness, emit) {
  const run = createRun(runRequest)
  run.status = "waiting_user"
  run.blockingReason = readiness.nextAction || "企业级运行预检未通过"
  run.summary = `企业级运行预检阻断：${run.blockingReason}`
  run.readinessReport = readiness
  run.assignments = []
  recordDecision(run, {
    type: "readiness_block",
    title: "企业级运行预检阻断",
    reason: run.blockingReason,
    inputSignals: {
      status: readiness.status,
      summary: readiness.summary,
      failedChecks: readiness.checks.filter((check) => check.status === "failed").map((check) => check.id),
    },
    options: ["修正设置后重试", "打开发布与验收页查看预检", "取消任务"],
    selectedOption: "修正设置后重试",
    risk: "high",
    userConfirmed: false,
    status: "blocked",
    blockingReason: run.blockingReason,
    metadata: { readiness },
  })
  addDecisionArtifact(run, "readiness", "企业级运行预检阻断真实工作区试运行", readiness)
  saveRunCheckpoint(run, {
    stage: "waiting_user",
    summary: run.summary,
    canResume: true,
  })
  emitRunEvent(run, emit, {
    type: "orchestrator:readiness_blocked",
    status: run.status,
    reason: run.blockingReason,
    readiness,
  })
  setRun(run)
  return getRun(run.id)
}

function cancelRun(runId) {
  const controller = controllers.get(runId)
  if (controller) controller.abort()
  const run = getMutableRun(runId)
  if (run) {
    run.status = "cancelled"
    setRun(run)
  }
  return Boolean(run || controller)
}

function addDecisionArtifact(run, type, content, metadata = {}) {
  return artifactStore.addArtifact(run.id, {
    assignmentId: null,
    type,
    content,
    metadata,
  })
}

function saveRecoveryAction(action) {
  if (persistentStore?.saveRecoveryAction) {
    try { persistentStore.saveRecoveryAction(action) } catch {}
  }
  return action
}

function suggestForAssignmentFailure(run, assignment, error) {
  if (!assignment) return []
  const actions = suggestRecoveryActions({ run, assignment, error })
  for (const action of actions) saveRecoveryAction(action)
  addDecisionArtifact(run, "recovery", "已生成失败恢复建议", {
    assignmentId: assignment.id,
    actions: actions.map((item) => item.action),
  })
  return actions
}

function blockPermissionViolation(run, decision, message, metadata = {}) {
  run.status = "waiting_user"
  run.blockingReason = message
  run.summary = message
  if (decision) {
    decision.status = "rework_requested"
    decision.reason = message
  }
  recordDecision(run, {
    type: "permission_violation",
    title: "权限越界阻断",
    reason: message,
    options: ["缩小变更范围", "重新申请权限", "取消任务"],
    selectedOption: "阻断",
    risk: run.strategySignals?.risk || run.permissionRequest?.risk || null,
    userConfirmed: false,
    status: "blocked",
    blockingReason: message,
    metadata,
  })
  addDecisionArtifact(run, "permission-violation", message, metadata)
  saveRunCheckpoint(run, {
    stage: "waiting_user",
    summary: message,
    canResume: true,
  })
  setRun(run)
  return clone(decision)
}

function isDirtyScmEntry(entry) {
  if (!entry?.path) return false
  return entry.status !== ""
}

function buildConflictProtectionEvidence({ projectRoot, files, phase }) {
  if (!Array.isArray(files) || files.length === 0) {
    return {
      phase,
      ok: true,
      reason: "",
      protectedFiles: [],
      dirtyFiles: [],
      scm: collectScmAuditSnapshot({ projectRoot, files: [], phase }),
      checkedAt: now(),
    }
  }
  const scm = collectScmAuditSnapshot({ projectRoot, files, phase })
  const dirtyFiles = (scm.entries || []).filter(isDirtyScmEntry).map((entry) => ({
    path: entry.path,
    oldPath: entry.oldPath || "",
    status: entry.status,
    staged: entry.staged === true,
    reason: phase === "before-rollback" ? ROLLBACK_BLOCK_REASON : ACCEPT_BLOCK_REASON,
  }))
  return {
    phase,
    ok: dirtyFiles.length === 0,
    reason: dirtyFiles.length
      ? (phase === "before-rollback" ? ROLLBACK_BLOCK_REASON : ACCEPT_BLOCK_REASON)
      : "",
    protectedFiles: files,
    dirtyFiles,
    scm,
    checkedAt: now(),
  }
}

function blockConflictProtection(run, decision, evidence, action) {
  const label = action === "rollback" ? "Rollback" : "Accept"
  const files = evidence.dirtyFiles.map((item) => item.path).filter(Boolean)
  const message = files.length
    ? `${label} blocked: protected files have manual changes (${files.join(", ")})`
    : `${label} blocked: conflict protection failed`
  run.status = "waiting_user"
  run.blockingReason = message
  run.summary = message
  decision.status = "rework_requested"
  decision.reason = message
  decision.conflictProtection = evidence
  if (action === "rollback") decision.rollbackProtection = evidence
  recordDecision(run, {
    type: "conflict_protection",
    title: `${label} 冲突保护`,
    reason: message,
    options: ["保留用户改动", "重新生成 patch", "人工复核"],
    selectedOption: "阻断",
    risk: run.strategySignals?.risk || null,
    userConfirmed: false,
    status: "blocked",
    blockingReason: evidence.reason || message,
    metadata: evidence,
  })
  addDecisionArtifact(run, "conflict-protection", message, evidence)
  saveRunCheckpoint(run, {
    stage: "waiting_user",
    summary: message,
    canResume: true,
  })
  setRun(run)
  return clone(decision)
}

function applyAcceptedDecision(run, reason = "") {
  const decision = run.integrationDecision
  if (!decision) throw new Error("decision required")
  const patchPermission = validatePatchPermissions(run, decision.proposedPatch?.filesChanged || [])
  if (!patchPermission.ok) {
    return blockPermissionViolation(run, decision, createPermissionViolationMessage(patchPermission.violations, "patch"), {
      violationType: "patch",
      files: patchPermission.violations,
      writePaths: run.permissionRequest?.writePaths || [],
    })
  }
  const commandPermission = validateCommandPermissions(run, run.qualityGateCommands || [])
  if (!commandPermission.ok) {
    return blockPermissionViolation(run, decision, createPermissionViolationMessage(commandPermission.violations, "command"), {
      violationType: "command",
      commands: commandPermission.violations,
      commandAllowlist: run.permissionRequest?.commandAllowlist || [],
    })
  }
  const filesForAudit = decision.proposedPatch?.filesChanged || []
  const acceptProtection = buildConflictProtectionEvidence({
    projectRoot: run.projectRoot,
    files: filesForAudit,
    phase: "before-accept",
  })
  decision.conflictProtection = acceptProtection
  if (!acceptProtection.ok) {
    return blockConflictProtection(run, decision, acceptProtection, "accept")
  }
  run.status = "applying"
  decision.status = "applying"
  decision.userDecision = "accepted"
  decision.reason = reason || "用户确认应用 patch，正在写入主工作区"
  setRun(run)

  let applyResult
  const beforeScm = collectScmAuditSnapshot({
    projectRoot: run.projectRoot,
    files: filesForAudit,
    phase: "before-apply",
  })
  try {
    applyResult = applyPatchSet({
      projectRoot: run.projectRoot,
      patches: decision.proposedPatch?.patches || [],
    })
    decision.applySnapshot = applyResult.snapshot
    decision.applyResult = {
      status: applyResult.status,
      filesChanged: applyResult.filesChanged,
      appliedAt: applyResult.appliedAt,
      conflictProtection: acceptProtection,
    }
    decision.appliedSnapshot = applyResult.appliedSnapshot
    addDecisionArtifact(run, "patch-apply", `Patch 应用${applyResult.status === "applied" ? "完成" : "跳过"}`, decision.applyResult)
    decision.scmAudit = buildPatchScmAudit({
      projectRoot: run.projectRoot,
      filesChanged: applyResult.filesChanged || filesForAudit,
      before: beforeScm,
      after: collectScmAuditSnapshot({
        projectRoot: run.projectRoot,
        files: applyResult.filesChanged || filesForAudit,
        phase: "after-apply",
      }),
      action: "apply",
    })
    addDecisionArtifact(run, "scm-audit", "SCM 状态快照已记录", decision.scmAudit)
  } catch (err) {
    run.status = "waiting_user"
    decision.status = "rework_requested"
    decision.reason = err instanceof Error ? err.message : String(err)
    addDecisionArtifact(run, "patch-apply", decision.reason, { status: "failed" })
    decision.scmAudit = buildPatchScmAudit({
      projectRoot: run.projectRoot,
      filesChanged: filesForAudit,
      before: beforeScm,
      after: collectScmAuditSnapshot({
        projectRoot: run.projectRoot,
        files: filesForAudit,
        phase: "after-apply-failed",
      }),
      action: "apply_failed",
    })
    addDecisionArtifact(run, "scm-audit", "SCM 状态快照已记录，patch 应用失败", decision.scmAudit)
    setRun(run)
    return clone(decision)
  }

  run.status = "verifying"
  decision.status = "verifying"
  setRun(run)

  const qualityGate = runQualityGate({
    projectRoot: run.projectRoot,
    commands: run.qualityGateCommands || [],
  })
  decision.qualityGate = qualityGate
  addDecisionArtifact(run, "quality-gate", qualityGate.summary, qualityGate)

  if (qualityGate.status === "failed") {
    run.status = "waiting_user"
    decision.status = "rework_requested"
    decision.reason = "质量门失败，需要返工或回滚"
  } else {
    run.status = "completed"
    decision.status = "accepted"
    decision.reason = qualityGate.status === "skipped"
      ? "Patch 已应用，未配置质量门命令"
      : "Patch 已应用且质量门通过"
  }
  decision.decidedAt = now()
  setRun(run)
  return clone(decision)
}

function rollbackDecision(run, reason = "") {
  const decision = run.integrationDecision
  if (!decision?.applySnapshot) {
    throw new Error("no apply snapshot available for rollback")
  }
  const filesForAudit = decision.applyResult?.filesChanged || decision.proposedPatch?.filesChanged || []
  const rollbackProtection = buildConflictProtectionEvidence({
    projectRoot: run.projectRoot,
    files: filesForAudit,
    phase: "before-rollback",
  })
  rollbackProtection.ok = true
  rollbackProtection.reason = ""
  rollbackProtection.dirtyFiles = []
  let drift = []
  if (decision.appliedSnapshot) {
    drift = collectSnapshotDrift(decision.appliedSnapshot)
  }
  if (drift.length) {
    rollbackProtection.ok = false
    rollbackProtection.reason = ROLLBACK_BLOCK_REASON
    rollbackProtection.drift = drift
    rollbackProtection.dirtyFiles = drift.map((item) => ({
      path: item.file,
      oldPath: "",
      status: "modified-after-apply",
      staged: false,
      reason: item.reason,
    }))
  }
  decision.rollbackProtection = rollbackProtection
  if (!rollbackProtection.ok) {
    return blockConflictProtection(run, decision, rollbackProtection, "rollback")
  }
  const beforeScm = collectScmAuditSnapshot({
    projectRoot: run.projectRoot,
    files: filesForAudit,
    phase: "before-rollback",
  })
  const rollback = restoreApplySnapshot(decision.applySnapshot)
  decision.rollbackResult = rollback
  decision.rollbackScmAudit = buildPatchScmAudit({
    projectRoot: run.projectRoot,
    filesChanged: rollback.filesChanged || filesForAudit,
    before: beforeScm,
    after: collectScmAuditSnapshot({
      projectRoot: run.projectRoot,
      files: rollback.filesChanged || filesForAudit,
      phase: "after-rollback",
    }),
    action: "rollback",
  })
  decision.status = "rolled_back"
  decision.userDecision = "rollback"
  decision.reason = reason || "已回滚到应用 patch 前的文件状态"
  decision.decidedAt = now()
  run.status = "waiting_user"
  addDecisionArtifact(run, "rollback", decision.reason, rollback)
  addDecisionArtifact(run, "scm-audit", "Rollback SCM 状态快照已记录", decision.rollbackScmAudit)
  setRun(run)
  return clone(decision)
}

function applyDecision(runId, userDecision, reason = "") {
  const run = getMutableRun(runId)
  if (!run) return null
  if (!run.integrationDecision) {
    recordDecision(run, {
      type: "user_decision",
      title: "用户决策",
      reason: reason || "用户处理等待确认的任务",
      options: ["accepted", "rejected", "rework_requested", "rollback"],
      selectedOption: userDecision,
      risk: run.strategySignals?.risk || null,
      userConfirmed: userDecision === "accepted",
      status: userDecision,
    })
    run.status = userDecision === "accepted" ? "planning" : userDecision === "rejected" ? "cancelled" : "waiting_user"
    run.summary = reason || run.summary || run.blockingReason || ""
    setRun(run)
    return {
      id: makeId("decision"),
      runId,
      status: userDecision,
      conflicts: [],
      proposedPatch: { summary: "", filesChanged: [], patches: [] },
      reason: run.summary,
    }
  }
  if (userDecision === "rollback") {
    recordDecision(run, {
      type: "user_decision",
      title: "用户决策",
      reason: reason || "用户要求回滚",
      options: ["rollback"],
      selectedOption: "rollback",
      risk: run.strategySignals?.risk || null,
      userConfirmed: false,
      status: "rollback",
    })
    return rollbackDecision(run, reason)
  }
  if (userDecision === "accepted") {
    recordDecision(run, {
      type: "user_decision",
      title: "用户决策",
      reason: reason || "用户确认应用 patch",
      options: ["accepted", "rejected", "rework_requested", "rollback"],
      selectedOption: "accepted",
      risk: run.strategySignals?.risk || null,
      userConfirmed: true,
      status: "accepted",
    })
    return applyAcceptedDecision(run, reason)
  }
  run.integrationDecision = integrator.applyUserDecision(run.integrationDecision, userDecision, reason)
  recordDecision(run, {
    type: "user_decision",
    title: "用户决策",
    reason: reason || run.integrationDecision?.reason || "",
    options: ["accepted", "rejected", "rework_requested", "rollback"],
    selectedOption: userDecision,
    risk: run.strategySignals?.risk || null,
    userConfirmed: userDecision === "accepted",
    status: userDecision,
  })
  run.status = userDecision === "accepted" ? "completed" : userDecision === "rejected" ? "cancelled" : "waiting_user"
  if (run.status === "waiting_user") {
    saveRunCheckpoint(run, {
      stage: "waiting_user",
      summary: run.integrationDecision?.reason || run.summary || "等待用户下一步决策",
      canResume: true,
    })
  }
  setRun(run)
  return clone(run.integrationDecision)
}

function resolvePermissionRequest(runId, decision, reason = "") {
  const run = getMutableRun(runId)
  if (!run) return null
  if (!run.permissionRequest) {
    const err = new Error("permission request not found")
    err.statusCode = 404
    err.code = "not_found"
    throw err
  }
  const approved = decision === "approved" || decision === "accepted"
  run.permissionRequest = {
    ...run.permissionRequest,
    status: approved ? "approved" : "rejected",
    decidedAt: now(),
    decisionReason: reason || "",
  }
  run.status = approved ? "planning" : "cancelled"
  run.blockingReason = approved ? "" : (reason || run.blockingReason || "用户拒绝权限请求")
  run.summary = approved ? "权限已确认，任务可继续执行" : run.blockingReason
  recordDecision(run, {
    type: "permission_decision",
    title: "权限决策",
    reason: reason || (approved ? "用户批准权限请求" : "用户拒绝权限请求"),
    options: ["approved", "rejected"],
    selectedOption: approved ? "approved" : "rejected",
    risk: run.permissionRequest.risk || run.strategySignals?.risk || null,
    userConfirmed: approved,
    status: approved ? "approved" : "rejected",
    metadata: { permissionRequestId: run.permissionRequest.id },
  })
  setRun(run)
  return getRun(runId)
}

function listRecoveryActions(runId, filter = {}) {
  if (!runId) return []
  ensureStore()
  return persistentStore?.listRecoveryActions?.(runId, filter) || []
}

function listEvents(runId, filter = {}) {
  if (!runId) return []
  const run = runs.get(runId)
  if (run?.events?.length && !run.__summaryOnly) {
    const since = Number(filter.since || 0)
    const limit = Number(filter.limit || 0)
    let events = run.events
    if (since > 0) events = events.filter((event) => Number(event.createdAt || 0) > since)
    if (filter.type) events = events.filter((event) => event.type === filter.type)
    if (limit > 0) events = events.slice(-limit)
    return clone(events)
  }
  ensureStore()
  return persistentStore?.listEvents?.(runId, filter) || []
}

function listDecisions(runId) {
  if (!runId) return []
  const run = getMutableRun(runId)
  return clone(Array.isArray(run?.decisionLog) ? run.decisionLog : [])
}

function getRunReport(runId) {
  const run = getMutableRun(runId)
  if (!run) return null
  return buildRunReport(withRuntimeStatus(run), {
    artifacts: artifactStore.listArtifacts(runId),
    recoveryActions: listRecoveryActions(runId),
    decisions: listDecisions(runId),
  })
}

function saveReportForRun(runId, options = {}) {
  const report = getRunReport(runId)
  if (!report) return null
  const saved = saveRunReport(report, options)
  return {
    ...saved,
    report,
  }
}

function getRunCommandAuthorization(runId) {
  const run = getMutableRun(runId)
  if (!run) return null
  return summarizeCommandAuthorization(run)
}

function createRunRecoveryAction(runId, input = {}) {
  const run = getMutableRun(runId)
  if (!run) return null
  const action = createRecoveryAction({ ...input, runId })
  saveRecoveryAction(action)
  recordDecision(run, {
    type: "recovery_action_created",
    title: "创建恢复动作",
    reason: action.reason || `已创建恢复动作 ${action.action}`,
    options: ["retry", "rewind", "split", "ask_user", "abort"],
    selectedOption: action.action,
    risk: run.strategySignals?.risk || null,
    status: action.status || "suggested",
    metadata: { actionId: action.id, assignmentId: action.assignmentId || null, phaseId: action.phaseId || null },
  })
  addDecisionArtifact(run, "recovery", `已创建恢复动作: ${action.action}`, { actionId: action.id, action: action.action })
  saveRunCheckpoint(run, {
    stage: run.status,
    summary: `已创建恢复动作: ${action.action}`,
    canResume: true,
  })
  setRun(run)
  return clone(action)
}

function executeRunRecoveryAction(runId, actionId) {
  const run = getMutableRun(runId)
  if (!run) return null
  ensureStore()
  const action = persistentStore?.getRecoveryAction?.(runId, actionId)
  if (!action) return null
  run.status = "recovering"
  run.summary = action.reason || `正在执行恢复动作 ${action.action}`
  setRun(run)
  recordDecision(run, {
    type: "recovery_action_started",
    title: "开始恢复动作",
    reason: run.summary,
    options: ["retry", "rewind", "split", "ask_user", "abort"],
    selectedOption: action.action,
    risk: run.strategySignals?.risk || null,
    status: "running",
    metadata: { actionId: action.id, assignmentId: action.assignmentId || null, phaseId: action.phaseId || null },
  })
  const result = executeRecoveryAction({ run, action })
  runs.set(runId, result.run)
  saveRecoveryAction(result.action)
  recordDecision(result.run, {
    type: "recovery_action_executed",
    title: "执行恢复动作",
    reason: result.action.reason || `已执行恢复动作 ${result.action.action}`,
    options: ["retry", "rewind", "split", "ask_user", "abort"],
    selectedOption: result.action.action,
    risk: result.run.strategySignals?.risk || null,
    status: result.action.status || "completed",
    metadata: { actionId: result.action.id, assignmentId: result.action.assignmentId || null, phaseId: result.action.phaseId || null },
  })
  artifactStore.addArtifact(runId, {
    assignmentId: result.action.assignmentId,
    type: result.artifact.type,
    content: result.artifact.content,
    metadata: result.artifact.metadata,
  })
  saveRunCheckpoint(result.run, {
    stage: result.run.status,
    summary: result.action.reason || `已执行恢复动作: ${result.action.action}`,
    canResume: result.run.status !== "completed" && result.run.status !== "cancelled",
  })
  setRun(result.run)
  return {
    action: clone(result.action),
    run: getRun(runId),
    artifacts: artifactStore.listArtifacts(runId),
  }
}

function reset() {
  for (const controller of controllers.values()) controller.abort()
  controllers.clear()
  runs.clear()
  artifactStore.reset()
}

function unsafeGetMutableRunForTest(runId) {
  return getMutableRun(runId)
}

function configureStore(options = {}) {
  persistentStore = options.store || configureDefaultStore(options)
  artifactStore.configureStore(persistentStore)
  return persistentStore
}

function ensureStore() {
  if (!persistentStore) {
    persistentStore = getDefaultStore()
    artifactStore.configureStore(persistentStore)
  }
  return persistentStore
}

function hydrateFromStore() {
  const store = ensureStore()
  const hydrated = []
  for (const stored of store.listRuns({ includeDetails: false, includeDecision: true, limit: 20 })) {
    const normalized = normalizeInterruptedRun(stored)
    normalized.__summaryOnly = true
    runs.set(normalized.id, normalized)
    if (normalized.status !== stored.status || JSON.stringify(normalized.integrationDecision) !== JSON.stringify(stored.integrationDecision)) {
      const artifact = artifactStore.addArtifact(normalized.id, {
        assignmentId: null,
        type: "recovery",
        content: "应用重启后恢复 Orchestrator 状态",
        metadata: { fromStatus: stored.status, toStatus: normalized.status },
      })
      normalized.events = [
        ...(normalized.events || []),
        { runId: normalized.id, type: "orchestrator:recovered", artifactId: artifact.id, createdAt: now() },
      ]
      setRun(normalized)
    }
    hydrated.push(clone(normalized))
  }
  return hydrated
}

module.exports = {
  startRun,
  startRealWorkspaceTrial,
  createTask,
  listTasks,
  createRun,
  createSmokePendingRunFixture,
  readSmokeFixtureFile,
  getRun,
  listRuns,
  pauseRun,
  cancelRun,
  applyDecision,
  resolvePermissionRequest,
  listEvents,
  listDecisions,
  getRunReport,
  saveReportForRun,
  getRunCommandAuthorization,
  listCheckpoints,
  getLatestCheckpoint,
  resumeRunFromCheckpoint,
  listRecoveryActions,
  createRecoveryAction: createRunRecoveryAction,
  executeRecoveryAction: executeRunRecoveryAction,
  configureStore,
  hydrateFromStore,
  reset,
  _unsafeGetMutableRunForTest: unsafeGetMutableRunForTest,
}
