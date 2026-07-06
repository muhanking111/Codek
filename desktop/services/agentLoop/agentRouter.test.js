const test = require("node:test")
const assert = require("node:assert/strict")

const { chooseAgentStrategy, extractMentionedPaths } = require("./agentRouter")

test("ask and plan modes stay read-only", () => {
  for (const visibleMode of ["ask", "plan"]) {
    const decision = chooseAgentStrategy({
      visibleMode,
      text: "修改 src/App.vue 并运行测试",
    })

    assert.equal(decision.visibleMode, visibleMode)
    assert.equal(decision.executionStrategy, "none")
    assert.match(decision.reason, /只读/)
  }
})

test("simple single-file task routes to single agent", () => {
  const decision = chooseAgentStrategy({
    visibleMode: "agent",
    text: "修复 src/components/ChatPanel.vue 里的一个按钮文案",
  })

  assert.equal(decision.executionStrategy, "single-agent")
  assert.equal(decision.signals.fileCount, 1)
})

test("multi-file refactor with verification routes to multi agent", () => {
  const decision = chooseAgentStrategy({
    visibleMode: "agent",
    text: "重构 frontend/src/App.vue、frontend/src/components/ChatPanel.vue、desktop/services/router.js，并运行 build 和 typecheck",
  })

  assert.equal(decision.executionStrategy, "multi-agent")
  assert.equal(decision.signals.risk, "medium")
  assert.ok(decision.signals.fileCount >= 3)
})

test("high risk auto task routes to multi agent", () => {
  const decision = chooseAgentStrategy({
    visibleMode: "auto",
    text: "调整认证权限和数据库迁移，最后跑端到端测试",
  })

  assert.equal(decision.executionStrategy, "multi-agent")
  assert.equal(decision.signals.risk, "high")
})

test("advanced strategy override is respected without exposing a visible mode", () => {
  const decision = chooseAgentStrategy({
    visibleMode: "agent",
    agentStrategy: "single-agent",
    text: "跨模块重构并运行所有测试",
  })

  assert.equal(decision.visibleMode, "agent")
  assert.equal(decision.executionStrategy, "single-agent")
  assert.equal(decision.signals.overridden, true)
})

test("extractMentionedPaths normalizes explicit files", () => {
  assert.deepEqual(
    extractMentionedPaths("修改 src\\App.vue 和 desktop/services/router.js", ["docs/PLAN_E.md"]),
    ["src/App.vue", "desktop/services/router.js", "docs/PLAN_E.md"],
  )
})
