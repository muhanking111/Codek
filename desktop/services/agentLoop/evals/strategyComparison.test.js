const test = require("node:test")
const assert = require("node:assert/strict")

const {
  collectSignals,
  compareTaskStrategies,
  summarizeStrategyComparisons,
} = require("./strategyComparison")

test("strategy comparison recommends single agent for local small fixes", () => {
  const comparison = compareTaskStrategies({
    id: "copy_fix",
    goal: "修复 src/components/ChatPanel.vue 中一个按钮文案错误",
    files: ["src/components/ChatPanel.vue"],
    risk: "safe",
  }, { executionStrategy: "single-agent" })

  assert.equal(comparison.recommendedStrategy, "single-agent")
  assert.equal(comparison.routerAgreement, true)
  assert.ok(comparison.scores["single-agent"].score > comparison.scores["multi-agent"].score)
})

test("strategy comparison recommends multi agent for cross-module verified tasks", () => {
  const comparison = compareTaskStrategies({
    id: "settings_e2e",
    goal: "接入新的设置字段，更新设置 UI、持久化服务和验证用例，并运行 typecheck",
    files: [
      "frontend/src/components/SettingsPanel.vue",
      "frontend/src/settings/settingsStore.ts",
      "desktop/services/settings/index.js",
    ],
    risk: "medium",
  }, { executionStrategy: "multi-agent" })

  assert.equal(comparison.recommendedStrategy, "multi-agent")
  assert.equal(comparison.routerAgreement, true)
  assert.ok(comparison.signals.verification)
  assert.ok(comparison.scores["multi-agent"].score > comparison.scores["single-agent"].score)
})

test("strategy comparison summary aggregates recommendation and agreement", () => {
  const summary = summarizeStrategyComparisons([
    compareTaskStrategies({ id: "small", goal: "修复 a.js 文案", files: ["a.js"] }, { executionStrategy: "single-agent" }),
    compareTaskStrategies({
      id: "wide",
      goal: "重构前端、后端和桌面端并运行 build",
      files: ["a.ts", "b.ts", "c.js"],
      risk: "medium",
    }, { executionStrategy: "multi-agent" }),
  ])

  assert.equal(summary.total, 2)
  assert.equal(summary.recommendedSingleAgent, 1)
  assert.equal(summary.recommendedMultiAgent, 1)
  assert.equal(summary.routerAgreement, 2)
  assert.equal(summary.routerAgreementRate, 100)
  assert.ok(summary.averageRecommendedScore > 0)
})

test("collectSignals detects verification and cross-module cues", () => {
  const signals = collectSignals({
    goal: "跨模块迁移 frontend、desktop 并运行 test 和 typecheck",
    files: ["a.ts", "b.ts", "c.ts"],
    risk: "medium",
  })

  assert.equal(signals.fileCount, 3)
  assert.equal(signals.verification, true)
  assert.equal(signals.crossModule, true)
  assert.equal(signals.risk, "medium")
})
