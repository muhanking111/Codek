const test = require("node:test")
const assert = require("node:assert/strict")

const { summarize, toMarkdown } = require("./report")

test("eval report includes orchestrator run metrics when present", () => {
  const report = {
    total: 1,
    passed: 1,
    failed: 0,
    results: [
      { id: "task_1", expectedStrategy: "multi-agent", actualStrategy: "multi-agent", passed: true, reason: "ok" },
    ],
    runMetrics: {
      totalRuns: 2,
      completedRuns: 1,
      failedRuns: 1,
      totalDurationMs: 30,
      totalConflicts: 1,
      totalApprovals: 1,
      totalRecoveryActions: 2,
      totalQualityGateFailures: 1,
    },
  }

  assert.equal(summarize(report).runMetrics.totalRecoveryActions, 2)
  const markdown = toMarkdown(report)
  assert.match(markdown, /## Orchestrator Metrics/)
  assert.match(markdown, /Recovery Actions: 2/)
  assert.match(markdown, /Quality Gate Failures: 1/)
})

test("eval report includes strategy comparison when present", () => {
  const report = {
    total: 2,
    passed: 2,
    failed: 0,
    results: [
      {
        id: "small",
        expectedStrategy: "single-agent",
        actualStrategy: "single-agent",
        recommendedStrategy: "single-agent",
        passed: true,
        reason: "small",
      },
      {
        id: "wide",
        expectedStrategy: "multi-agent",
        actualStrategy: "multi-agent",
        recommendedStrategy: "multi-agent",
        passed: true,
        reason: "wide",
      },
    ],
    strategyComparison: {
      total: 2,
      recommendedSingleAgent: 1,
      recommendedMultiAgent: 1,
      routerAgreement: 2,
      routerAgreementRate: 100,
      averageSingleScore: 70,
      averageMultiScore: 75,
      averageRecommendedScore: 82,
      averageSuccessProbability: 91,
      averageEstimatedDurationMs: 120000,
      averageConflictRisk: 20,
      averageQualityGateRisk: 15,
    },
  }

  assert.equal(summarize(report).strategyComparison.recommendedMultiAgent, 1)
  const markdown = toMarkdown(report)
  assert.match(markdown, /## Strategy Comparison/)
  assert.match(markdown, /Recommended Multi Agent: 1/)
  assert.match(markdown, /\| Task \| Expected \| Actual \| Recommended \| Result \| Reason \|/)
})

test("eval report includes real run comparison when present", () => {
  const report = {
    total: 1,
    passed: 1,
    failed: 0,
    results: [
      { id: "real", expectedStrategy: "single-agent", actualStrategy: "single-agent", passed: true, reason: "ok" },
    ],
    realRunComparison: {
      totalTasks: 1,
      totalRuns: 2,
      completedRuns: 2,
      singleAgentWins: 1,
      multiAgentWins: 0,
      averageDurationMs: 120,
      totalQualityGateFailures: 0,
      totalConflicts: 0,
    },
  }

  assert.equal(summarize(report).realRunComparison.totalRuns, 2)
  const markdown = toMarkdown(report)
  assert.match(markdown, /## Real Run Comparison/)
  assert.match(markdown, /Runs: 2\/2 completed/)
})

test("eval report includes router calibration when present", () => {
  const report = {
    total: 1,
    passed: 1,
    failed: 0,
    results: [
      { id: "calibrated", expectedStrategy: "single-agent", actualStrategy: "single-agent", passed: true, reason: "ok" },
    ],
    routerCalibration: {
      total: 1,
      recommendationAligned: 1,
      routerAligned: 1,
      misaligned: 0,
      qualityGateFailureTasks: 0,
      conflictTasks: 0,
      suggestions: { keep: 1 },
    },
  }

  assert.equal(summarize(report).routerCalibration.routerAligned, 1)
  const markdown = toMarkdown(report)
  assert.match(markdown, /## Router Calibration/)
  assert.match(markdown, /Suggestions: keep=1/)
})

test("eval report includes router shadow eval when present", () => {
  const report = {
    total: 1,
    passed: 1,
    failed: 0,
    results: [
      { id: "shadow", expectedStrategy: "single-agent", actualStrategy: "multi-agent", passed: true, reason: "ok" },
    ],
    routerShadowEval: {
      total: 1,
      currentAligned: 0,
      candidateAligned: 1,
      currentMisaligned: 1,
      candidateMisaligned: 0,
      improved: 1,
      regressed: 0,
      switched: 1,
      recommendation: "needs-more-samples",
      config: { multiAgentBias: -3 },
    },
  }

  assert.equal(summarize(report).routerShadowEval.candidateAligned, 1)
  const markdown = toMarkdown(report)
  assert.match(markdown, /## Router Shadow Eval/)
  assert.match(markdown, /Candidate Aligned: 1\/1/)
  assert.match(markdown, /multiAgentBias=-3/)
})
