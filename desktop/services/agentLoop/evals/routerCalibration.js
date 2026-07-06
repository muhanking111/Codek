const { classifyComparisonFailure, summarizeFailureRecommendations } = require("./failureRecommendations")

function calibrateTask(result = {}) {
  const winner = result.realRunComparison?.summary?.winner || null
  const recommended = result.recommendedStrategy || null
  const actual = result.actualStrategy || null
  const fixtureTypes = result.realRunComparison?.summary?.fixtureTypes || []
  const qualityGateFailures = result.realRunComparison?.summary?.totalQualityGateFailures || 0
  const conflicts = result.realRunComparison?.summary?.totalConflicts || 0
  const recommendationAligned = Boolean(winner && recommended && winner === recommended)
  const routerAligned = Boolean(winner && actual && winner === actual)
  let suggestion = "keep"
  if (winner === "single-agent" && (recommended === "multi-agent" || actual === "multi-agent")) {
    suggestion = "lower-multi-agent-weight"
  } else if (winner === "multi-agent" && (recommended === "single-agent" || actual === "single-agent")) {
    suggestion = "raise-multi-agent-weight"
  }
  if (qualityGateFailures > 0) suggestion = "increase-verifier-weight"
  if (conflicts > 0) suggestion = "increase-conflict-penalty"
  const item = {
    taskId: result.id || null,
    fixtureTypes,
    recommendedStrategy: recommended,
    actualStrategy: actual,
    realWinner: winner,
    recommendationAligned,
    routerAligned,
    qualityGateFailures,
    conflicts,
    suggestion,
  }
  item.failureRecommendation = classifyComparisonFailure({
    recommendedStrategy: recommended,
    actualStrategy: actual,
    realWinner: winner,
    summary: result.realRunComparison?.summary,
  })
  return item
}

function summarizeRouterCalibration(results = []) {
  const items = results
    .filter((item) => item?.realRunComparison)
    .map(calibrateTask)
  const suggestions = {}
  for (const item of items) {
    suggestions[item.suggestion] = (suggestions[item.suggestion] || 0) + 1
  }
  return {
    total: items.length,
    recommendationAligned: items.filter((item) => item.recommendationAligned).length,
    routerAligned: items.filter((item) => item.routerAligned).length,
    misaligned: items.filter((item) => !item.recommendationAligned || !item.routerAligned).length,
    qualityGateFailureTasks: items.filter((item) => item.qualityGateFailures > 0).length,
    conflictTasks: items.filter((item) => item.conflicts > 0).length,
    suggestions,
    failureRecommendations: summarizeFailureRecommendations(items),
    items,
  }
}

module.exports = {
  calibrateTask,
  summarizeRouterCalibration,
}
