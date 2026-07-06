const STRATEGIES = ["single-agent", "multi-agent"]

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function normalizeRisk(risk) {
  const value = String(risk || "").toLowerCase()
  if (value === "high" || value === "medium" || value === "safe") return value
  return "safe"
}

function taskText(task = {}) {
  return [task.name, task.prompt, task.goal, task.description].filter(Boolean).join(" ")
}

function collectSignals(task = {}) {
  const files = Array.isArray(task.files) ? task.files.filter(Boolean) : []
  const text = taskText(task)
  const risk = normalizeRisk(task.risk)
  const verification = /\b(test|typecheck|lint|build|verify|e2e|playwright)\b/i.test(text)
    || /(测试|类型检查|构建|验证|端到端)/.test(text)
  const crossModule = files.length >= 3
    || /\b(refactor|migrate|migration|architecture|integration|workspace|orchestrator|frontend|backend|desktop|api|database)\b/i.test(text)
    || /(重构|迁移|架构|跨模块|联调|编排|工作区|前端|后端|桌面端|数据库)/.test(text)
  const localizedSmallFix = /(文案|样式|改名|小改|单文件|按钮)/.test(text)
  const smallFix = files.length <= 1
    && (/\b(fix|bug|typo|rename|copy|label|style|small|simple)\b/i.test(text) || localizedSmallFix)
  const complexity = clamp(
    files.length
      + (verification ? 2 : 0)
      + (crossModule ? 2 : 0)
      + (risk === "high" ? 3 : risk === "medium" ? 1 : 0)
      - (smallFix ? 2 : 0),
    0,
    10,
  )
  return {
    files,
    fileCount: files.length,
    risk,
    verification,
    crossModule,
    smallFix,
    complexity,
  }
}

function scoreSingleAgent(signals) {
  const successProbability = clamp(91 - signals.complexity * 4 - (signals.verification ? 4 : 0), 45, 96)
  const estimatedDurationMs = clamp(70_000 + signals.complexity * 24_000 + signals.fileCount * 7_000, 50_000, 420_000)
  const conflictRisk = clamp(6 + Math.max(0, signals.fileCount - 1) * 5 + (signals.crossModule ? 8 : 0), 2, 70)
  const qualityGateRisk = clamp(8 + signals.complexity * 5 + (signals.verification ? 6 : 0), 4, 76)
  const coordinationCost = clamp(4 + signals.fileCount * 2, 4, 32)
  const score = clamp(
    successProbability
      - estimatedDurationMs / 18_000
      - conflictRisk * 0.22
      - qualityGateRisk * 0.18
      - coordinationCost * 0.08,
    0,
    100,
  )
  return {
    strategy: "single-agent",
    successProbability,
    estimatedDurationMs,
    conflictRisk,
    qualityGateRisk,
    coordinationCost,
    score,
  }
}

function scoreMultiAgent(signals) {
  const complexityBenefit = signals.complexity >= 4 ? 9 : -5
  const successProbability = clamp(78 + complexityBenefit + signals.complexity * 2 + (signals.verification ? 5 : 0), 48, 97)
  const estimatedDurationMs = clamp(
    115_000 + Math.max(0, signals.complexity - 3) * 13_000 + signals.fileCount * 5_000,
    85_000,
    360_000,
  )
  const conflictRisk = clamp(11 + signals.fileCount * 7 + (signals.crossModule ? 10 : 0), 8, 82)
  const qualityGateRisk = clamp(9 + signals.complexity * 3 + (signals.verification ? -3 : 2), 3, 66)
  const coordinationCost = clamp(20 + signals.fileCount * 5 + (signals.crossModule ? 8 : 0), 18, 78)
  const score = clamp(
    successProbability
      - estimatedDurationMs / 22_000
      - conflictRisk * 0.2
      - qualityGateRisk * 0.15
      - coordinationCost * 0.16,
    0,
    100,
  )
  return {
    strategy: "multi-agent",
    successProbability,
    estimatedDurationMs,
    conflictRisk,
    qualityGateRisk,
    coordinationCost,
    score,
  }
}

function explainRecommendation(signals, recommendedStrategy, margin) {
  if (recommendedStrategy === "multi-agent") {
    if (signals.verification && signals.crossModule) return "任务跨模块且需要独立验证，适合拆分给多 Agent 协作"
    if (signals.risk !== "safe") return "任务风险较高，多 Agent 可以保留规划、实现和验证分工"
    return `多 Agent 综合得分高 ${margin} 分，适合并行处理`
  }
  if (signals.smallFix) return "任务范围较小，单 Agent 直接处理更快且协作成本更低"
  return `单 Agent 综合得分高 ${margin} 分，当前拆分收益不足`
}

function compareTaskStrategies(task = {}, routerDecision = {}) {
  const signals = collectSignals(task)
  const scores = {
    "single-agent": scoreSingleAgent(signals),
    "multi-agent": scoreMultiAgent(signals),
  }
  const recommendedStrategy = scores["multi-agent"].score > scores["single-agent"].score
    ? "multi-agent"
    : "single-agent"
  const margin = Math.abs(scores["multi-agent"].score - scores["single-agent"].score)
  const routerStrategy = routerDecision.executionStrategy || task.actualStrategy || null
  return {
    taskId: task.id || null,
    signals,
    scores,
    recommendedStrategy,
    recommendationReason: explainRecommendation(signals, recommendedStrategy, margin),
    margin,
    routerStrategy,
    routerAgreement: STRATEGIES.includes(routerStrategy) ? routerStrategy === recommendedStrategy : null,
  }
}

function average(items, pick) {
  if (!items.length) return 0
  return clamp(items.reduce((sum, item) => sum + Number(pick(item) || 0), 0) / items.length, 0, 1_000_000)
}

function summarizeStrategyComparisons(comparisons = []) {
  const items = comparisons.filter(Boolean)
  const recommended = items.map((item) => item.scores[item.recommendedStrategy])
  const agreed = items.filter((item) => item.routerAgreement === true).length
  const comparable = items.filter((item) => item.routerAgreement !== null).length
  return {
    total: items.length,
    recommendedSingleAgent: items.filter((item) => item.recommendedStrategy === "single-agent").length,
    recommendedMultiAgent: items.filter((item) => item.recommendedStrategy === "multi-agent").length,
    routerAgreement: agreed,
    routerAgreementRate: comparable ? clamp((agreed / comparable) * 100, 0, 100) : 0,
    averageSingleScore: average(items, (item) => item.scores["single-agent"].score),
    averageMultiScore: average(items, (item) => item.scores["multi-agent"].score),
    averageRecommendedScore: average(recommended, (item) => item.score),
    averageSuccessProbability: average(recommended, (item) => item.successProbability),
    averageEstimatedDurationMs: average(recommended, (item) => item.estimatedDurationMs),
    averageConflictRisk: average(recommended, (item) => item.conflictRisk),
    averageQualityGateRisk: average(recommended, (item) => item.qualityGateRisk),
  }
}

module.exports = {
  collectSignals,
  compareTaskStrategies,
  summarizeStrategyComparisons,
}
