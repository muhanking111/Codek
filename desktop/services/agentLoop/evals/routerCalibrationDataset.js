const SAMPLE_COUNT = 120

const SINGLE_FIXTURES = [
  {
    title: "单文件文案修复",
    prompt: "Fix typo and copy label in src/components/WelcomePage.vue",
    files: ["src/components/WelcomePage.vue"],
    risk: "safe",
    expectedStrategy: "single-agent",
    fixtureType: "single-file-copy",
  },
  {
    title: "局部样式微调",
    prompt: "小改按钮样式，只调整 frontend/vite-project/src/components/MenuBar.vue",
    files: ["frontend/vite-project/src/components/MenuBar.vue"],
    risk: "safe",
    expectedStrategy: "single-agent",
    fixtureType: "single-file-style",
  },
  {
    title: "单测试修复",
    prompt: "Fix failing assertion in desktop/services/search/index.test.js",
    files: ["desktop/services/search/index.test.js"],
    risk: "safe",
    expectedStrategy: "single-agent",
    fixtureType: "single-test-fix",
  },
  {
    title: "配置默认值小改",
    prompt: "Update one setting default in frontend/vite-project/src/settings/settingsStore.ts",
    files: ["frontend/vite-project/src/settings/settingsStore.ts"],
    risk: "safe",
    expectedStrategy: "single-agent",
    fixtureType: "single-config-fix",
  },
]

const MULTI_FIXTURES = [
  {
    title: "跨模块 Workbench 重构",
    prompt: "Refactor workbench command menu keybinding integration and verify typecheck build",
    files: [
      "frontend/vite-project/src/workbench/commandRegistry.ts",
      "frontend/vite-project/src/workbench/menuActions.ts",
      "frontend/vite-project/src/keybindings.ts",
      "frontend/vite-project/src/settings/settingsStore.ts",
    ],
    risk: "medium",
    expectedStrategy: "multi-agent",
    fixtureType: "cross-module-refactor",
  },
  {
    title: "Search 导航端到端修复",
    prompt: "Fix search navigation across frontend backend desktop integration and run tests",
    files: [
      "frontend/vite-project/src/workbench/searchFileActions.ts",
      "frontend/vite-project/src/composables/useWorkspaceSearch.ts",
      "desktop/services/search/index.js",
      "scripts/electron-ui-smoke.js",
    ],
    risk: "medium",
    expectedStrategy: "multi-agent",
    fixtureType: "search-integration",
  },
  {
    title: "权限沙箱高风险任务",
    prompt: "Update auth permission sandbox policy and verifier gates before deleting unsafe writes",
    files: [
      "desktop/services/agentLoop/permissionPolicy.js",
      "desktop/services/sandbox/index.js",
      "desktop/services/agentLoop/orchestrator.js",
    ],
    risk: "high",
    expectedStrategy: "multi-agent",
    fixtureType: "high-risk-policy",
  },
  {
    title: "真实 UI 回归矩阵",
    prompt: "Implement explorer editor search real UI regression with electron smoke and build verification",
    files: [
      "frontend/vite-project/src/App.vue",
      "frontend/vite-project/src/components/FileTree.vue",
      "frontend/vite-project/src/workspace/manager.js",
      "scripts/electron-ui-smoke.js",
    ],
    risk: "medium",
    expectedStrategy: "multi-agent",
    fixtureType: "real-ui-regression",
  },
  {
    title: "多 Agent 冲突修复",
    prompt: "Resolve multi-agent file lock conflict and add verifier plus rollback tests",
    files: [
      "desktop/services/agentLoop/orchestrator.js",
      "desktop/services/agentLoop/planExecutor.js",
      "frontend/vite-project/src/workspace/changeQueue.js",
      "scripts/agent-change-safety-smoke.js",
    ],
    risk: "high",
    expectedStrategy: "multi-agent",
    fixtureType: "multi-agent-conflict",
  },
]

function withVariant(base, index) {
  const suffix = String(index + 1).padStart(3, "0")
  const extraPrompt = index % 5 === 0
    ? " Please include tests and release evidence."
    : index % 5 === 1
      ? " 需要验证、构建和失败恢复记录。"
      : index % 5 === 2
        ? " Keep user changes safe."
        : index % 5 === 3
          ? " 保持 Cursor/VS Code 行为兼容。"
          : " Produce a concise failure report if routing is wrong."
  return {
    ...base,
    id: `router-calibration-${suffix}`,
    name: `${base.title} #${suffix}`,
    prompt: `${base.prompt}.${extraPrompt}`,
    goal: `${base.title} ${suffix}`,
    visibleMode: index % 11 === 0 ? "auto" : "agent",
  }
}

function buildRouterCalibrationSamples(options = {}) {
  const count = Math.max(1, Number(options.count || SAMPLE_COUNT))
  const fixtures = []
  for (let index = 0; index < count; index += 1) {
    const pool = index % 4 === 0 ? SINGLE_FIXTURES : MULTI_FIXTURES
    fixtures.push(withVariant(pool[index % pool.length], index))
  }
  return fixtures
}

module.exports = {
  SAMPLE_COUNT,
  buildRouterCalibrationSamples,
}
