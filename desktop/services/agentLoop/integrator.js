function patchArtifacts(artifacts) {
  return (artifacts || []).filter((artifact) => artifact.type === "patch" && artifact.content)
}

function collectChangedFiles(assignments, artifacts) {
  const files = new Set()
  for (const assignment of assignments || []) {
    for (const file of assignment.lockedFiles || []) files.add(String(file))
    for (const file of assignment.writePaths || []) files.add(String(file))
  }
  for (const artifact of artifacts || []) {
    if (artifact.type === "patch" && artifact.path) files.add(String(artifact.path))
    const changed = artifact.metadata?.filesChanged
    if (Array.isArray(changed)) changed.forEach((file) => files.add(String(file)))
  }
  return [...files]
}

function detectConflicts(assignments, artifacts = []) {
  const owners = new Map()
  const conflicts = []

  const addOwner = (file, assignmentId) => {
    if (!file || !assignmentId) return
    const previous = owners.get(file)
    if (previous && previous !== assignmentId) {
      const existing = conflicts.find((item) => item.file === file)
      if (existing) {
        existing.assignments = [...new Set([...existing.assignments, assignmentId])]
      } else {
        conflicts.push({ file, assignments: [previous, assignmentId] })
      }
      return
    }
    owners.set(file, assignmentId)
  }

  for (const assignment of assignments || []) {
    for (const file of assignment.writePaths || []) addOwner(String(file), assignment.id)
  }

  for (const artifact of patchArtifacts(artifacts)) {
    const changed = Array.isArray(artifact.metadata?.filesChanged)
      ? artifact.metadata.filesChanged
      : artifact.path ? [artifact.path] : []
    for (const file of changed) addOwner(String(file), artifact.assignmentId)
  }

  return conflicts
}

function collectPatches(artifacts) {
  return patchArtifacts(artifacts).map((artifact) => ({
    artifactId: artifact.id,
    assignmentId: artifact.assignmentId,
    filesChanged: Array.isArray(artifact.metadata?.filesChanged) ? artifact.metadata.filesChanged : [],
    content: artifact.content,
  }))
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))]
}

function assignmentById(assignments = []) {
  return new Map(assignments.map((assignment) => [assignment.id, assignment]))
}

function normalizeWorktrees(assignments = []) {
  return assignments
    .filter((assignment) => assignment?.workspace)
    .map((assignment) => ({
      assignmentId: String(assignment.id || ""),
      phaseId: String(assignment.phaseId || ""),
      role: String(assignment.role || ""),
      id: String(assignment.workspace.id || assignment.id || ""),
      path: String(assignment.workspace.path || ""),
      isolation: String(assignment.workspace.isolation || ""),
      baseRef: String(assignment.workspace.baseRef || ""),
      headRef: String(assignment.workspace.headRef || ""),
      writePaths: Array.isArray(assignment.writePaths) ? assignment.writePaths.map(String) : [],
      lockedFiles: Array.isArray(assignment.lockedFiles) ? assignment.lockedFiles.map(String) : [],
    }))
}

function createConflictSummary(conflicts = [], assignments = []) {
  const assignmentMap = assignmentById(assignments)
  const files = uniqueStrings(conflicts.map((conflict) => conflict.file))
  return {
    status: files.length ? "conflicted" : "clear",
    total: files.length,
    files,
    conflicts: conflicts.map((conflict) => ({
      file: String(conflict.file || ""),
      assignments: uniqueStrings(conflict.assignments),
      worktrees: uniqueStrings((conflict.assignments || []).map((id) => {
        const assignment = assignmentMap.get(id)
        return assignment?.workspace?.id || assignment?.workspace?.path || ""
      })),
      requiresHumanResolution: true,
    })),
  }
}

function normalizeCommandResult(result = {}) {
  const exitCode = Number.isFinite(Number(result.exitCode)) ? Number(result.exitCode) : null
  const timedOut = result.timedOut === true
  const explicitStatus = String(result.status || "").trim().toLowerCase()
  const status = explicitStatus
    || (timedOut ? "failed" : exitCode === null ? "unknown" : exitCode === 0 ? "passed" : "failed")
  return {
    command: String(result.command || ""),
    status,
    exitCode,
    timedOut,
    durationMs: Number.isFinite(Number(result.durationMs)) ? Number(result.durationMs) : null,
    artifactId: String(result.artifactId || ""),
    source: String(result.source || "qualityGate"),
  }
}

function buildValidationMatrix(qualityGate = null, validationCommands = []) {
  const gateResults = Array.isArray(qualityGate?.commandResults)
    ? qualityGate.commandResults.map(normalizeCommandResult)
    : []
  const byCommand = new Map(gateResults.map((result) => [result.command, result]))
  const commands = uniqueStrings([
    ...validationCommands,
    ...gateResults.map((result) => result.command),
  ]).map((command) => byCommand.get(command) || {
    command,
    status: "not_run",
    exitCode: null,
    timedOut: false,
    durationMs: null,
    artifactId: "",
    source: "requiredValidation",
  })
  const failed = commands.filter((result) =>
    result.status === "failed" || result.timedOut === true || (result.exitCode !== null && result.exitCode !== 0)
  ).length
  const notRun = commands.filter((result) => result.status === "not_run").length
  const passed = commands.filter((result) => result.status === "passed" || result.exitCode === 0).length
  const status = commands.length === 0
    ? (qualityGate?.status ? String(qualityGate.status) : "not_run")
    : failed > 0 ? "failed" : notRun > 0 ? "not_run" : "passed"
  return {
    status,
    summary: {
      total: commands.length,
      passed,
      failed,
      notRun,
    },
    commands,
  }
}

function normalizeEvidenceSnapshot(snapshot = {}) {
  return {
    status: String(snapshot.status || ""),
    gitHead: String(snapshot.gitHead || ""),
    baseRef: String(snapshot.baseRef || ""),
    targetRef: String(snapshot.targetRef || ""),
    dirtyFiles: Array.isArray(snapshot.dirtyFiles) ? uniqueStrings(snapshot.dirtyFiles) : [],
    stagedFiles: Array.isArray(snapshot.stagedFiles) ? uniqueStrings(snapshot.stagedFiles) : [],
    reportRefs: Array.isArray(snapshot.reportRefs) ? uniqueStrings(snapshot.reportRefs) : [],
    artifactRefs: Array.isArray(snapshot.artifactRefs) ? uniqueStrings(snapshot.artifactRefs) : [],
    collectedAt: Number.isFinite(Number(snapshot.collectedAt)) ? Number(snapshot.collectedAt) : null,
  }
}

function createMergeEvidence(mergeEvidence = {}) {
  return {
    preMerge: normalizeEvidenceSnapshot(mergeEvidence.preMerge),
    postMerge: normalizeEvidenceSnapshot(mergeEvidence.postMerge),
  }
}

function classifyFailures({ conflictSummary, validationMatrix, qualityGate }) {
  const failures = []
  if (conflictSummary.total > 0) {
    failures.push({
      id: "workspace_conflict",
      category: "conflict",
      severity: "high",
      stage: "merge",
      summary: `${conflictSummary.total} 个文件存在多 Agent worktree 写入冲突`,
      requiresHumanDecision: true,
    })
  }
  const gateFailed = String(qualityGate?.status || "").toLowerCase() === "failed"
    || validationMatrix.summary.failed > 0
  if (gateFailed) {
    failures.push({
      id: "quality_gate_failed",
      category: "validation",
      severity: "high",
      stage: "validation",
      summary: `${validationMatrix.summary.failed || 1} 个质量门命令失败`,
      requiresHumanDecision: true,
    })
  }
  if (validationMatrix.summary.notRun > 0) {
    failures.push({
      id: "validation_not_run",
      category: "validation",
      severity: "medium",
      stage: "validation",
      summary: `${validationMatrix.summary.notRun} 个必需验证命令尚未运行`,
      requiresHumanDecision: true,
    })
  }
  return failures
}

function recommendMainThreadAction(failures) {
  if (failures.some((failure) => failure.id === "workspace_conflict" || failure.id === "quality_gate_failed")) return "rework"
  if (failures.some((failure) => failure.id === "validation_not_run")) return "verify"
  return "accept"
}

function buildMainThreadDecision(strategy) {
  const recommendedAction = recommendMainThreadAction(strategy.failureClassification)
  return {
    required: strategy.patches.length > 0 || strategy.conflictSummary.total > 0,
    recommendedAction,
    allowedActions: ["accept", "rework", "reject"],
    requiredFields: [
      "conflictSummary",
      "validationMatrix",
      "preMergeEvidence",
      "postMergeEvidence",
      "failureClassification",
      "proposedPatch",
    ],
    decisionPrompt: recommendedAction === "accept"
      ? "补充人工确认后可接受合入；Accept 前仍不得写真实主工作区。"
      : recommendedAction === "verify"
        ? "缺少必需验证命令结果，主线程应先补跑质量门再决定 Accept/Rework/Reject。"
        : "存在冲突或质量门失败，主线程应要求对应 worktree 返工或人工拆解合入。",
  }
}

function buildWorktreeMergeStrategy({ assignments = [], artifacts = [], qualityGate = null, validationCommands = [], mergeEvidence = {}, patches = [], conflicts = [] }) {
  const conflictSummary = createConflictSummary(conflicts, assignments)
  const validationMatrix = buildValidationMatrix(qualityGate, validationCommands)
  const evidence = createMergeEvidence(mergeEvidence)
  const failureClassification = classifyFailures({ conflictSummary, validationMatrix, qualityGate })
  const strategy = {
    status: failureClassification.some((failure) => failure.severity === "high")
      ? "blocked"
      : failureClassification.length > 0 ? "needs_verification" : patches.length > 0 ? "ready_for_accept" : "no_changes",
    mode: "proposal-only",
    stateSource: "integrationDecision",
    preservesSingleStateSource: true,
    worktrees: normalizeWorktrees(assignments),
    patches: patches.map((patch) => ({
      artifactId: patch.artifactId,
      assignmentId: patch.assignmentId,
      filesChanged: Array.isArray(patch.filesChanged) ? patch.filesChanged.map(String) : [],
    })),
    conflictSummary,
    validationMatrix,
    evidence,
    failureClassification,
    rollbackRecommendation: failureClassification.length
      ? "保持 proposal-only，不写主工作区；要求冲突 worktree 返工或由主线程人工拆分 patch。"
      : "Accept 前保存 pre-merge evidence；Accept 后记录 post-merge evidence 与可回滚快照。",
    costSummary: {
      assignmentCount: Array.isArray(assignments) ? assignments.length : 0,
      worktreeCount: normalizeWorktrees(assignments).length,
      patchCount: patches.length,
      changedFileCount: uniqueStrings(patches.flatMap((patch) => patch.filesChanged || [])).length,
      validationCommandCount: validationMatrix.summary.total,
      failedValidationCount: validationMatrix.summary.failed,
    },
  }
  strategy.mainThreadDecision = buildMainThreadDecision(strategy)
  return strategy
}

function countPlanTasks(plan) {
  return (plan?.phases || []).reduce((sum, phase) => sum + (Array.isArray(phase.tasks) ? phase.tasks.length : 0), 0)
}

function summarizePlan(plan) {
  return {
    available: Boolean(plan),
    title: plan?.title || "",
    summary: plan?.summary || "",
    phaseCount: Array.isArray(plan?.phases) ? plan.phases.length : 0,
    taskCount: countPlanTasks(plan),
  }
}

function summarizeArtifacts(artifacts = []) {
  return {
    total: artifacts.length,
    proposed: artifacts.map((artifact) => ({
      id: artifact.id,
      type: artifact.type || "artifact",
      assignmentId: artifact.assignmentId || null,
      filesChanged: Array.isArray(artifact.metadata?.filesChanged) ? artifact.metadata.filesChanged : [],
      summary: artifact.metadata?.summary || String(artifact.content || "").slice(0, 120),
    })),
  }
}

function summarizeVerification(qualityGate) {
  if (!qualityGate) {
    return {
      status: "not_run",
      summary: "Accept 前不运行写入后质量门",
      commandCount: 0,
      failedCommandCount: 0,
    }
  }
  const commandResults = Array.isArray(qualityGate.commandResults) ? qualityGate.commandResults : []
  return {
    status: qualityGate.status || "unknown",
    summary: qualityGate.summary || "",
    commandCount: commandResults.length,
    failedCommandCount: commandResults.filter((item) => Number(item.exitCode || 0) !== 0).length,
  }
}

function buildDecisionEvidence() {
  return {
    availableActions: ["accepted", "rework_requested", "rejected", "rollback"],
    accept: {
      status: "requires_explicit_accept",
      writesMainWorkspace: true,
    },
    rework: {
      status: "available",
      writesMainWorkspace: false,
    },
    reject: {
      status: "available",
      writesMainWorkspace: false,
    },
    rollback: {
      status: "available_after_accept",
      writesMainWorkspace: true,
    },
  }
}

function buildProposalOnlyDelivery({
  executionStrategy = "",
  plan = null,
  artifacts = [],
  patches = [],
  filesChanged = [],
  qualityGate = null,
} = {}) {
  return {
    mode: "proposal-only",
    mainWorkspaceWrite: false,
    requiresAcceptBeforeApply: true,
    executionStrategy,
    plan: summarizePlan(plan),
    proposedDiff: {
      available: patches.length > 0,
      fileCount: filesChanged.length,
      patchCount: patches.length,
      filesChanged,
    },
    artifacts: summarizeArtifacts(artifacts),
    verification: summarizeVerification(qualityGate),
    decisionEvidence: buildDecisionEvidence(),
    blockedGaps: [],
  }
}

function createIntegrationDecision({
  runId,
  assignments,
  artifacts,
  qualityGate = null,
  plan = null,
  executionStrategy = "",
  validationCommands = [],
  mergeEvidence = {},
}) {
  const patches = collectPatches(artifacts)
  const conflicts = detectConflicts(assignments, artifacts)
  const filesChanged = collectChangedFiles(assignments, artifacts)
  const worktreeMergeStrategy = buildWorktreeMergeStrategy({
    assignments,
    artifacts,
    qualityGate,
    validationCommands,
    mergeEvidence,
    patches,
    conflicts,
  })
  return {
    id: `decision_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    runId,
    status: patches.length || conflicts.length ? "pending" : "accepted",
    conflicts,
    proposedPatch: {
      summary: filesChanged.length
        ? `候选变更涉及 ${filesChanged.length} 个文件`
        : "暂无可合并 patch",
      filesChanged,
      patches,
    },
    qualityGate,
    worktreeMergeStrategy,
    proposalOnlyDelivery: buildProposalOnlyDelivery({
      executionStrategy,
      plan,
      artifacts,
      patches,
      filesChanged,
      qualityGate,
    }),
    userDecision: null,
    reason: conflicts.length
      ? "检测到多个 assignment 修改同一文件，需要用户或 Integrator 决策"
      : "未检测到写入冲突，可进入质量门或最终确认",
    createdAt: Date.now(),
  }
}

function applyUserDecision(decision, userDecision, reason = "") {
  if (!decision) throw new Error("decision required")
  if (!["accepted", "rejected", "rework_requested"].includes(userDecision)) {
    throw new Error("userDecision must be accepted | rejected | rework_requested")
  }
  return {
    ...decision,
    status: userDecision,
    userDecision,
    reason: reason || decision.reason,
    decidedAt: Date.now(),
  }
}

module.exports = {
  buildValidationMatrix,
  buildWorktreeMergeStrategy,
  collectChangedFiles,
  collectPatches,
  detectConflicts,
  buildProposalOnlyDelivery,
  createIntegrationDecision,
  applyUserDecision,
}
