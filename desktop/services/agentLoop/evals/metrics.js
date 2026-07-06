function summarizeRunMetrics({ run, artifacts = [], recoveryActions = [] } = {}) {
  const decision = run?.integrationDecision || null
  const qualityGate = decision?.qualityGate || null
  const commandResults = qualityGate?.commandResults || []
  const hasTimestamps = Number.isFinite(Number(run?.createdAt)) && Number.isFinite(Number(run?.updatedAt))
  const recoveryByAction = {}
  for (const action of recoveryActions || []) {
    recoveryByAction[action.action] = (recoveryByAction[action.action] || 0) + 1
  }
  return {
    runId: run?.id || null,
    status: run?.status || null,
    durationMs: hasTimestamps ? Math.max(0, Number(run.updatedAt) - Number(run.createdAt)) : 0,
    assignmentCount: run?.assignments?.length || 0,
    artifactCount: artifacts.length,
    patchArtifactCount: artifacts.filter((artifact) => artifact.type === "patch").length,
    filesChanged: decision?.proposedPatch?.filesChanged?.length || 0,
    conflictCount: decision?.conflicts?.length || 0,
    approvalCount: decision?.userDecision ? 1 : 0,
    qualityGate: {
      status: qualityGate?.status || "not_run",
      commandCount: commandResults.length,
      failedCommandCount: commandResults.filter((item) => item.exitCode !== 0).length,
      durationMs: commandResults.reduce((sum, item) => sum + Number(item.durationMs || 0), 0),
    },
    recovery: {
      total: recoveryActions.length,
      completed: recoveryActions.filter((action) => action.status === "completed").length,
      byAction: recoveryByAction,
    },
  }
}

function summarizeRunMetricsCollection(items = []) {
  const runs = items.map((item) => summarizeRunMetrics(item))
  return {
    totalRuns: runs.length,
    completedRuns: runs.filter((item) => item.status === "completed").length,
    failedRuns: runs.filter((item) => item.status === "failed").length,
    totalDurationMs: runs.reduce((sum, item) => sum + item.durationMs, 0),
    totalConflicts: runs.reduce((sum, item) => sum + item.conflictCount, 0),
    totalApprovals: runs.reduce((sum, item) => sum + item.approvalCount, 0),
    totalRecoveryActions: runs.reduce((sum, item) => sum + item.recovery.total, 0),
    totalQualityGateFailures: runs.reduce((sum, item) => sum + item.qualityGate.failedCommandCount, 0),
    runs,
  }
}

module.exports = {
  summarizeRunMetrics,
  summarizeRunMetricsCollection,
}
