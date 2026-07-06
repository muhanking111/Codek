const path = require("node:path")
const {
  commandRequiresInstall,
  commandRequiresNetwork,
  isCommandAllowed,
} = require("./permissionPolicy")

const DEFAULT_MAX_ASSIGNMENTS = 8
const MAX_ASSIGNMENTS_LIMIT = 16
const DEFAULT_MAX_DURATION_MS = 10 * 60 * 1000
const MIN_DURATION_MS = 30 * 1000
const MAX_DURATION_MS = 60 * 60 * 1000
const DEMO_REQUIRED_TASK_IDS = ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08"]

function clampNumber(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(number)))
}

function normalizeTrialPath(value) {
  const normalized = String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .trim()
  if (!normalized || normalized === "." || normalized.includes("..") || path.isAbsolute(normalized)) return ""
  return normalized
}

function normalizeCommand(value) {
  return String(value || "").trim().replace(/\s+/g, " ")
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function normalizeStringList(values = []) {
  return unique((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))
}

function normalizeTaskId(value) {
  const match = String(value || "").toUpperCase().match(/\bT0[1-8]\b/)
  return match ? match[0] : ""
}

function normalizeDemoTaskItem(item = {}) {
  const id = normalizeTaskId(item.id || item.taskId || item.coverageId)
  return {
    id,
    title: String(item.title || item.name || id || "").trim(),
    status: String(item.status || (item.passed === false ? "failed" : item.passed === true ? "passed" : "")).trim(),
    roleProfile: String(item.roleProfile || item.profile || item.role || "").trim(),
    evidenceRefs: normalizeStringList(item.evidenceRefs || item.evidence || item.artifacts),
    benefit: String(item.benefit || item.benefitSummary || "").trim(),
    noise: String(item.noise || item.noiseSummary || "").trim(),
    notes: String(item.notes || item.summary || "").trim(),
  }
}

function normalizeRoleProfile(item = {}) {
  return {
    id: String(item.id || item.profileId || item.name || "").trim(),
    label: String(item.label || item.name || item.id || "").trim(),
    assignmentIds: normalizeStringList(item.assignmentIds || item.assignments),
    benefit: String(item.benefit || item.benefitSummary || item.expectedBenefit || "").trim(),
    noise: String(item.noise || item.noiseSummary || item.observedNoise || "").trim(),
    recommendation: String(item.recommendation || item.decision || "").trim(),
  }
}

function normalizeRoleTrial(item = {}) {
  return {
    id: String(item.id || item.trialId || item.profileId || "").trim(),
    profileId: String(item.profileId || item.roleProfileId || item.roleProfile || "").trim(),
    status: String(item.status || "").trim(),
    assignmentId: String(item.assignmentId || "").trim(),
    baselineMinutes: Number.isFinite(Number(item.baselineMinutes)) ? Number(item.baselineMinutes) : null,
    trialMinutes: Number.isFinite(Number(item.trialMinutes)) ? Number(item.trialMinutes) : null,
    benefit: String(item.benefit || item.benefitSummary || "").trim(),
    noise: String(item.noise || item.noiseSummary || "").trim(),
  }
}

function normalizeDemoTaskReport(input = {}, run = {}) {
  const source = input && typeof input === "object" ? input : {}
  const tasks = (Array.isArray(source.tasks) ? source.tasks : [])
    .map(normalizeDemoTaskItem)
    .filter((item) => item.id || item.title)
  const explicitCoverage = normalizeStringList([
    ...(source.coveredTaskIds || []),
    ...(source.coverageIds || []),
    ...((Array.isArray(source.coverage) ? source.coverage : []).map((item) => typeof item === "string" ? item : item?.id || item?.taskId)),
  ]).map(normalizeTaskId)
  const coveredTasks = unique([
    ...explicitCoverage,
    ...tasks.map((item) => item.id),
  ]).filter((id) => DEMO_REQUIRED_TASK_IDS.includes(id))
  const missingTasks = DEMO_REQUIRED_TASK_IDS.filter((id) => !coveredTasks.includes(id))
  const roleProfiles = (Array.isArray(source.roleProfiles) ? source.roleProfiles : [])
    .map(normalizeRoleProfile)
    .filter((item) => item.id || item.label)
  const roleTrials = (Array.isArray(source.agentRoleTrials) ? source.agentRoleTrials : Array.isArray(source.roleTrials) ? source.roleTrials : [])
    .map(normalizeRoleTrial)
    .filter((item) => item.id || item.profileId)
  const qualityGate = source.qualityGate || run.integrationDecision?.qualityGate || {}
  const cost = source.costReview || source.cost || run.llmUsage?.cost || {}
  const manualReview = source.manualReview || source.reviewEffort || {}
  const failureReview = source.failureReview || source.failureRetrospective || {}
  const rollbackRecommendation = source.rollbackRecommendation || source.rollbackAdvice || run.recoveryRecommendation || {}
  const available = Boolean(source.available || tasks.length || coveredTasks.length || roleProfiles.length || roleTrials.length)
  const ready = available &&
    missingTasks.length === 0 &&
    (roleProfiles.length > 0 || roleTrials.length > 0) &&
    Boolean(qualityGate.status || qualityGate.summary) &&
    Boolean(cost.available || cost.estimatedCostUsd !== undefined || manualReview.minutes !== undefined)
  return {
    available,
    ready,
    status: source.status || (available ? ready ? "ready" : "needs_review" : "missing"),
    statusLabel: source.statusLabel || (available ? ready ? "Day 11-12 演示证据已就绪" : "Day 11-12 演示证据需复核" : "暂无 Day 11-12 演示证据"),
    requiredTasks: DEMO_REQUIRED_TASK_IDS,
    coveredTasks,
    missingTasks,
    taskCount: tasks.length,
    tasks,
    roleProfiles,
    roleTrials,
    roleBenefitSummary: String(source.roleBenefitSummary || source.benefitSummary || "").trim(),
    roleNoiseSummary: String(source.roleNoiseSummary || source.noiseSummary || "").trim(),
    qualityGate: {
      status: String(qualityGate.status || "").trim(),
      summary: String(qualityGate.summary || "").trim(),
      commandResults: Array.isArray(qualityGate.commandResults) ? qualityGate.commandResults.map((item) => ({
        command: String(item?.command || "").trim(),
        status: String(item?.status || "").trim(),
        exitCode: item?.exitCode ?? null,
      })) : [],
    },
    costReview: {
      available: Boolean(cost.available || cost.estimatedCostUsd !== undefined || manualReview.minutes !== undefined),
      estimatedCostUsd: Number.isFinite(Number(cost.estimatedCostUsd)) ? Number(cost.estimatedCostUsd) : 0,
      currency: String(cost.currency || "USD"),
      pricedRequests: Number.isFinite(Number(cost.pricedRequests)) ? Number(cost.pricedRequests) : 0,
      unpricedRequests: Number.isFinite(Number(cost.unpricedRequests)) ? Number(cost.unpricedRequests) : 0,
      manualReviewMinutes: Number.isFinite(Number(manualReview.minutes ?? manualReview.manualReviewMinutes)) ? Number(manualReview.minutes ?? manualReview.manualReviewMinutes) : 0,
    },
    failureReview: {
      summary: String(failureReview.summary || failureReview.reason || "").trim(),
      recommendation: String(failureReview.recommendation || "").trim(),
    },
    rollbackRecommendation: {
      action: String(rollbackRecommendation.action || "").trim(),
      reason: String(rollbackRecommendation.reason || "").trim(),
    },
    nextHumanAcceptance: normalizeStringList(source.nextHumanAcceptance || source.manualAcceptanceNextSteps || source.nextActions),
    artifacts: normalizeStringList(source.artifacts || source.evidenceRefs),
  }
}

function readSetting(settings = {}, key, fallback) {
  return Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback
}

function configFromSettings(settings = {}) {
  return {
    allowedPaths: readSetting(settings, "codek.agent.realWorkspaceTrial.allowedPaths", undefined),
    qualityGateCommands: readSetting(settings, "codek.agent.realWorkspaceTrial.qualityGateCommands", undefined),
    allowMainWorkspaceWrites: readSetting(settings, "codek.agent.realWorkspaceTrial.allowMainWorkspaceWrites", undefined),
    maxAssignments: readSetting(settings, "codek.agent.realWorkspaceTrial.maxAssignments", undefined),
    maxDurationMs: readSetting(settings, "codek.agent.realWorkspaceTrial.maxDurationMs", undefined),
    allowNetwork: readSetting(settings, "codek.agent.realWorkspaceTrial.allowNetwork", undefined),
    allowInstall: readSetting(settings, "codek.agent.realWorkspaceTrial.allowInstall", undefined),
  }
}

function normalizeRealWorkspaceTrialConfig(input = {}, context = {}) {
  const projectRoot = input.projectRoot || context.projectRoot || ""
  const allowedPaths = unique((Array.isArray(input.allowedPaths) ? input.allowedPaths : [])
    .map(normalizeTrialPath))
  const requestedCommands = unique((Array.isArray(input.qualityGateCommands) && input.qualityGateCommands.length
    ? input.qualityGateCommands
    : ["npm run typecheck"]).map(normalizeCommand))
  const qualityGateCommands = requestedCommands.filter((command) => isCommandAllowed(command, {}))
  const blockedQualityGateCommands = unique([
    ...requestedCommands.filter((command) => !isCommandAllowed(command, {})),
    ...(Array.isArray(input.blockedQualityGateCommands) ? input.blockedQualityGateCommands.map(normalizeCommand) : []),
  ])
  const allowMainWorkspaceWrites = input.allowMainWorkspaceWrites === true
  const allowNetwork = allowMainWorkspaceWrites && input.allowNetwork === true
  const allowInstall = allowNetwork && input.allowInstall === true
  return {
    projectRoot,
    enabled: input.enabled !== false,
    writeMode: allowMainWorkspaceWrites ? "requires_explicit_accept" : "proposed_patch_only",
    allowMainWorkspaceWrites,
    allowedPaths,
    requiresExplicitAllowedPaths: allowedPaths.length === 0,
    qualityGateCommands,
    blockedQualityGateCommands,
    maxAssignments: clampNumber(input.maxAssignments, DEFAULT_MAX_ASSIGNMENTS, 1, MAX_ASSIGNMENTS_LIMIT),
    maxDurationMs: clampNumber(input.maxDurationMs, DEFAULT_MAX_DURATION_MS, MIN_DURATION_MS, MAX_DURATION_MS),
    allowNetwork,
    allowInstall,
    allowExternalTool: false,
  }
}

function normalizeFiles(files = []) {
  return unique((Array.isArray(files) ? files : []).map(normalizeTrialPath))
}

function buildRealWorkspaceTrialRequest(input = {}) {
  const rawConfig = {
    ...configFromSettings(input.settings || {}),
    ...(input.config || {}),
    projectRoot: input.projectRoot,
  }
  const realWorkspaceTrial = normalizeRealWorkspaceTrialConfig(rawConfig, { projectRoot: input.projectRoot })
  return {
    projectRoot: input.projectRoot,
    visibleMode: "agent",
    userInput: String(input.userInput || input.goal || "").trim(),
    agentStrategy: input.agentStrategy === "single-agent" || input.agentStrategy === "multi-agent" ? input.agentStrategy : null,
    files: normalizeFiles(input.files),
    risk: input.risk || "medium",
    policyProfile: "real-workspace-trial",
    qualityGateCommands: realWorkspaceTrial.qualityGateCommands,
    realWorkspaceTrial,
    contextEvidence: input.contextEvidence || null,
    plan: input.plan || null,
    workspaceIsolation: input.workspaceIsolation || "auto",
  }
}

function summarizePermissionRequest(request) {
  if (!request) return null
  return {
    id: request.id || null,
    status: request.status || "not_requested",
    writePaths: request.writePaths || [],
    commandAllowlist: request.commandAllowlist || [],
    network: Boolean(request.network),
    install: Boolean(request.install),
    externalTool: Boolean(request.externalTool),
    destructive: Boolean(request.destructive),
    reason: request.reason || "",
  }
}

function buildRealWorkspaceTrialReport(run = {}, options = {}) {
  const config = normalizeRealWorkspaceTrialConfig(run.realWorkspaceTrial || {}, { projectRoot: run.projectRoot })
  const decision = run.integrationDecision || null
  const filesChanged = decision?.proposedPatch?.filesChanged || []
  const permission = summarizePermissionRequest(run.permissionRequest)
  const commands = run.qualityGateCommands || config.qualityGateCommands || []
  return {
    runId: run.id || null,
    workspaceRoot: run.projectRoot || config.projectRoot || "",
    status: run.status || "",
    visibleMode: run.visibleMode || "agent",
    executionStrategy: run.executionStrategy || "",
    routerReason: run.strategyReason || "",
    routerSignals: run.strategySignals || {},
    writeMode: config.writeMode,
    allowMainWorkspaceWrites: config.allowMainWorkspaceWrites,
    allowedPaths: config.allowedPaths,
    qualityGateCommands: commands,
    blockedQualityGateCommands: config.blockedQualityGateCommands,
    commandCapabilities: commands.map((command) => ({
      command,
      network: commandRequiresNetwork(command),
      install: commandRequiresInstall(command),
    })),
    decisionId: decision?.id || null,
    decisionStatus: decision?.status || null,
    filesChanged,
    mainWorkspaceUntouchedBeforeAccept: Boolean(
      decision?.rollbackResult ||
      (!decision?.applyResult && (run.status === "waiting_user" || decision?.status === "pending")),
    ),
    rollbackAvailable: Boolean(decision?.applySnapshot),
    permissionRequests: permission ? [permission] : [],
    recoveryActions: options.recoveryActions || [],
    demoTaskReport: normalizeDemoTaskReport(
      run.realWorkspaceTrial?.demoTaskReport || run.realWorkspaceTrial?.day1112DemoReport || run.demoTaskReport || {},
      run,
    ),
    reportKind: "real-workspace-trial",
  }
}

module.exports = {
  buildRealWorkspaceTrialReport,
  buildRealWorkspaceTrialRequest,
  configFromSettings,
  normalizeRealWorkspaceTrialConfig,
  normalizeDemoTaskReport,
}
