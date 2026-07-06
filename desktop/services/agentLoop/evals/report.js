function summarize(report) {
  const total = report.total || 0
  const passed = report.passed || 0
  const failed = report.failed || 0
  const rate = total ? Math.round((passed / total) * 100) : 0
  const runMetrics = report.runMetrics || null
  const strategyComparison = report.strategyComparison || null
  const realRunComparison = report.realRunComparison || null
  const routerCalibration = report.routerCalibration || null
  const routerShadowEval = report.routerShadowEval || null
  return {
    total,
    passed,
    failed,
    successRate: rate,
    runMetrics,
    strategyComparison,
    realRunComparison,
    routerCalibration,
    routerShadowEval,
    ready: failed === 0,
  }
}

function toMarkdown(report) {
  const summary = summarize(report)
  const rows = (report.results || []).map((item) =>
    `| ${item.id} | ${item.expectedStrategy || "-"} | ${item.actualStrategy} | ${item.recommendedStrategy || "-"} | ${item.passed ? "PASS" : "FAIL"} | ${item.reason} |`,
  )
  return [
    "# Multi-Agent Eval Report",
    "",
    `- Total: ${summary.total}`,
    `- Passed: ${summary.passed}`,
    `- Failed: ${summary.failed}`,
    `- Success Rate: ${summary.successRate}%`,
    ...(summary.runMetrics ? [
      "",
      "## Orchestrator Metrics",
      "",
      `- Runs: ${summary.runMetrics.totalRuns}`,
      `- Completed Runs: ${summary.runMetrics.completedRuns}`,
      `- Failed Runs: ${summary.runMetrics.failedRuns}`,
      `- Total Duration: ${summary.runMetrics.totalDurationMs} ms`,
      `- Conflicts: ${summary.runMetrics.totalConflicts}`,
      `- Approvals: ${summary.runMetrics.totalApprovals}`,
      `- Recovery Actions: ${summary.runMetrics.totalRecoveryActions}`,
      `- Quality Gate Failures: ${summary.runMetrics.totalQualityGateFailures}`,
    ] : []),
    ...(summary.strategyComparison ? [
      "",
      "## Strategy Comparison",
      "",
      `- Recommended Single Agent: ${summary.strategyComparison.recommendedSingleAgent}`,
      `- Recommended Multi Agent: ${summary.strategyComparison.recommendedMultiAgent}`,
      `- Router Agreement: ${summary.strategyComparison.routerAgreement}/${summary.strategyComparison.total} (${summary.strategyComparison.routerAgreementRate}%)`,
      `- Average Single Score: ${summary.strategyComparison.averageSingleScore}`,
      `- Average Multi Score: ${summary.strategyComparison.averageMultiScore}`,
      `- Average Recommended Score: ${summary.strategyComparison.averageRecommendedScore}`,
      `- Average Success Probability: ${summary.strategyComparison.averageSuccessProbability}%`,
      `- Average Estimated Duration: ${summary.strategyComparison.averageEstimatedDurationMs} ms`,
      `- Average Conflict Risk: ${summary.strategyComparison.averageConflictRisk}%`,
      `- Average Quality Gate Risk: ${summary.strategyComparison.averageQualityGateRisk}%`,
    ] : []),
    ...(summary.realRunComparison ? [
      "",
      "## Real Run Comparison",
      "",
      `- Tasks: ${summary.realRunComparison.totalTasks}`,
      `- Runs: ${summary.realRunComparison.completedRuns}/${summary.realRunComparison.totalRuns} completed`,
      `- Single Agent Wins: ${summary.realRunComparison.singleAgentWins}`,
      `- Multi Agent Wins: ${summary.realRunComparison.multiAgentWins}`,
      `- Average Duration: ${summary.realRunComparison.averageDurationMs} ms`,
      `- Quality Gate Failures: ${summary.realRunComparison.totalQualityGateFailures}`,
      `- Conflicts: ${summary.realRunComparison.totalConflicts}`,
    ] : []),
    ...(summary.routerCalibration ? [
      "",
      "## Router Calibration",
      "",
      `- Tasks: ${summary.routerCalibration.total}`,
      `- Recommendation Aligned: ${summary.routerCalibration.recommendationAligned}/${summary.routerCalibration.total}`,
      `- Router Aligned: ${summary.routerCalibration.routerAligned}/${summary.routerCalibration.total}`,
      `- Misaligned: ${summary.routerCalibration.misaligned}`,
      `- Quality Gate Failure Tasks: ${summary.routerCalibration.qualityGateFailureTasks}`,
      `- Conflict Tasks: ${summary.routerCalibration.conflictTasks}`,
      `- Suggestions: ${formatSuggestions(summary.routerCalibration.suggestions)}`,
    ] : []),
    ...(summary.routerShadowEval ? [
      "",
      "## Router Shadow Eval",
      "",
      `- Tasks: ${summary.routerShadowEval.total}`,
      `- Current Aligned: ${summary.routerShadowEval.currentAligned}/${summary.routerShadowEval.total}`,
      `- Candidate Aligned: ${summary.routerShadowEval.candidateAligned}/${summary.routerShadowEval.total}`,
      `- Current Misaligned: ${summary.routerShadowEval.currentMisaligned}`,
      `- Candidate Misaligned: ${summary.routerShadowEval.candidateMisaligned}`,
      `- Improved: ${summary.routerShadowEval.improved}`,
      `- Regressed: ${summary.routerShadowEval.regressed}`,
      `- Switched: ${summary.routerShadowEval.switched}`,
      `- Recommendation: ${summary.routerShadowEval.recommendation}`,
      `- Candidate Config: ${formatCandidateConfig(summary.routerShadowEval.config)}`,
    ] : []),
    "",
    "| Task | Expected | Actual | Recommended | Result | Reason |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n")
}

function formatSuggestions(suggestions = {}) {
  const entries = Object.entries(suggestions)
  if (!entries.length) return "-"
  return entries.map(([key, value]) => `${key}=${value}`).join(", ")
}

function formatCandidateConfig(config = {}) {
  const entries = Object.entries(config)
  if (!entries.length) return "-"
  return entries.map(([key, value]) => `${key}=${value}`).join(", ")
}

module.exports = {
  summarize,
  toMarkdown,
}
