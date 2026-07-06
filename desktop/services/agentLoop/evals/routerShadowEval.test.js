const test = require("node:test")
const assert = require("node:assert/strict")

const {
  buildCandidateConfig,
  decideCandidateStrategy,
  summarizeRouterShadowEval,
} = require("./routerShadowEval")

function result(overrides = {}) {
  return {
    id: "task",
    actualStrategy: "multi-agent",
    recommendedStrategy: "multi-agent",
    comparison: {
      scores: {
        "single-agent": { score: 70 },
        "multi-agent": { score: 72 },
      },
      signals: {
        verification: false,
        fileCount: 1,
        risk: "safe",
      },
    },
    realRunComparison: {
      summary: {
        winner: "single-agent",
        totalConflicts: 0,
        totalQualityGateFailures: 0,
      },
    },
    ...overrides,
  }
}

test("buildCandidateConfig converts calibration suggestions into shadow weights", () => {
  const config = buildCandidateConfig({
    suggestions: {
      "lower-multi-agent-weight": 2,
      "increase-conflict-penalty": 1,
      "increase-verifier-weight": 1,
    },
  })

  assert.equal(config.multiAgentBias, -6)
  assert.equal(config.conflictPenaltyWeight, 2)
  assert.equal(config.verifierBonusWeight, 2)
})

test("candidate router can switch a marginal multi-agent task to single-agent", () => {
  const decision = decideCandidateStrategy(result(), {
    multiAgentBias: -6,
    conflictPenaltyWeight: 0,
    verifierBonusWeight: 0,
    minSwitchMargin: 1,
  })

  assert.equal(decision.currentStrategy, "multi-agent")
  assert.equal(decision.candidateStrategy, "single-agent")
  assert.equal(decision.realWinner, "single-agent")
  assert.equal(decision.improved, true)
  assert.equal(decision.regressed, false)
})

test("router shadow eval summarizes current versus candidate alignment", () => {
  const summary = summarizeRouterShadowEval([
    result({ id: "improved" }),
    result({
      id: "kept",
      actualStrategy: "single-agent",
      recommendedStrategy: "single-agent",
      comparison: {
        scores: {
          "single-agent": { score: 82 },
          "multi-agent": { score: 60 },
        },
        signals: { verification: false, fileCount: 1, risk: "safe" },
      },
      realRunComparison: { summary: { winner: "single-agent" } },
    }),
  ], {
    suggestions: { "lower-multi-agent-weight": 1 },
  }, {
    config: { minSamplesForPromotion: 2 },
  })

  assert.equal(summary.total, 2)
  assert.equal(summary.currentAligned, 1)
  assert.equal(summary.candidateAligned, 2)
  assert.equal(summary.improved, 1)
  assert.equal(summary.regressed, 0)
  assert.equal(summary.recommendation, "candidate-improves-shadow")
})
