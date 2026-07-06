const STRATEGIES = new Set(["single-agent", "multi-agent"])

const DEFAULT_CANDIDATE_CONFIG = {
  multiAgentBias: 0,
  conflictPenaltyWeight: 0,
  verifierBonusWeight: 0,
  minSwitchMargin: 1,
  minSamplesForPromotion: 4,
}

function countSuggestion(calibration, key) {
  return Number(calibration?.suggestions?.[key] || 0)
}

function buildCandidateConfig(calibration = {}, overrides = {}) {
  return {
    ...DEFAULT_CANDIDATE_CONFIG,
    multiAgentBias:
      countSuggestion(calibration, "raise-multi-agent-weight") * 3
      - countSuggestion(calibration, "lower-multi-agent-weight") * 3,
    conflictPenaltyWeight: countSuggestion(calibration, "increase-conflict-penalty") * 2,
    verifierBonusWeight: countSuggestion(calibration, "increase-verifier-weight") * 2,
    ...overrides,
  }
}

function scoreCandidate(result = {}, config = DEFAULT_CANDIDATE_CONFIG) {
  const scores = result.comparison?.scores || {}
  const signals = result.comparison?.signals || {}
  const singleBase = Number(scores["single-agent"]?.score || 0)
  const multiBase = Number(scores["multi-agent"]?.score || 0)
  const conflictPenalty = Math.max(0, Number(signals.fileCount || 0) - 1) * Number(config.conflictPenaltyWeight || 0)
  const riskPenalty = signals.risk === "high" ? Number(config.conflictPenaltyWeight || 0) : 0
  const realizedConflicts = Number(result.realRunComparison?.summary?.totalConflicts || 0)
  const realizedQualityFailures = Number(result.realRunComparison?.summary?.totalQualityGateFailures || 0)
  const realizedConflictPenalty = realizedConflicts * Number(config.conflictPenaltyWeight || 0) * 16
  const realizedQualityPenalty = realizedQualityFailures * Number(config.verifierBonusWeight || 0) * 5
  const verifierBonus = signals.verification && realizedQualityFailures === 0
    ? Number(config.verifierBonusWeight || 0)
    : 0
  return {
    "single-agent": singleBase,
    "multi-agent": multiBase
      + Number(config.multiAgentBias || 0)
      - conflictPenalty
      - riskPenalty
      - realizedConflictPenalty
      - realizedQualityPenalty
      + verifierBonus,
  }
}

function decideCandidateStrategy(result = {}, config = DEFAULT_CANDIDATE_CONFIG) {
  const currentStrategy = STRATEGIES.has(result.actualStrategy) ? result.actualStrategy : result.recommendedStrategy
  const candidateScores = scoreCandidate(result, config)
  const candidateStrategy = candidateScores["multi-agent"] > candidateScores["single-agent"]
    ? "multi-agent"
    : "single-agent"
  const realWinner = result.realRunComparison?.summary?.winner || null
  const currentAligned = Boolean(realWinner && currentStrategy === realWinner)
  const candidateAligned = Boolean(realWinner && candidateStrategy === realWinner)
  const scoreDelta = Math.abs(candidateScores["multi-agent"] - candidateScores["single-agent"])
  const switched = currentStrategy !== candidateStrategy && scoreDelta >= Number(config.minSwitchMargin || 0)
  return {
    taskId: result.id || null,
    currentStrategy,
    candidateStrategy,
    realWinner,
    currentAligned,
    candidateAligned,
    improved: !currentAligned && candidateAligned,
    regressed: currentAligned && !candidateAligned,
    switched,
    scoreDelta: Math.round(scoreDelta),
    candidateScores,
    reason: explainDecision({ switched, candidateStrategy, currentStrategy, scoreDelta, config }),
  }
}

function explainDecision({ switched, candidateStrategy, currentStrategy, scoreDelta, config }) {
  if (!switched) return "候选权重未达到切换阈值，保持当前路由观察"
  const bias = Number(config.multiAgentBias || 0)
  if (candidateStrategy === "single-agent" && bias < 0) return `候选权重降低多 Agent 倾向，切换 ${currentStrategy} -> single-agent`
  if (candidateStrategy === "multi-agent" && bias > 0) return `候选权重提高多 Agent 倾向，切换 ${currentStrategy} -> multi-agent`
  return `候选分数差 ${Math.round(scoreDelta)}，切换 ${currentStrategy} -> ${candidateStrategy}`
}

function summarizeRouterShadowEval(results = [], calibration = {}, options = {}) {
  const config = buildCandidateConfig(calibration, options.config)
  const items = results
    .filter((item) => item?.realRunComparison && item?.comparison)
    .map((item) => decideCandidateStrategy(item, config))
  const currentAligned = items.filter((item) => item.currentAligned).length
  const candidateAligned = items.filter((item) => item.candidateAligned).length
  const improved = items.filter((item) => item.improved).length
  const regressed = items.filter((item) => item.regressed).length
  const switched = items.filter((item) => item.switched).length
  return {
    total: items.length,
    config,
    currentAligned,
    candidateAligned,
    currentMisaligned: items.length - currentAligned,
    candidateMisaligned: items.length - candidateAligned,
    improved,
    regressed,
    switched,
    recommendation: recommend({ total: items.length, currentAligned, candidateAligned, improved, regressed, config }),
    items,
  }
}

function recommend({ total, currentAligned, candidateAligned, improved, regressed, config }) {
  if (total < Number(config.minSamplesForPromotion || 0)) return "needs-more-samples"
  if (candidateAligned > currentAligned && improved > regressed) return "candidate-improves-shadow"
  if (candidateAligned < currentAligned || regressed > improved) return "candidate-regresses-shadow"
  return "keep-current-router"
}

module.exports = {
  DEFAULT_CANDIDATE_CONFIG,
  buildCandidateConfig,
  decideCandidateStrategy,
  scoreCandidate,
  summarizeRouterShadowEval,
}
