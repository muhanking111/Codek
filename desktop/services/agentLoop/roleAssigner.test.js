const test = require("node:test")
const assert = require("node:assert/strict")

const planTree = require("./planTree")
const { assignRoles, inferRole } = require("./roleAssigner")

test("roleAssigner maps phases to Codek native roles and safe policies", () => {
  const plan = planTree.createPlan("demo", [
    { id: "phase_1", name: "规划方案", tasks: [{ description: "分析需求" }] },
    { id: "phase_2", name: "实现功能", tasks: [{ description: "修改 src/App.vue", files: ["src/App.vue"] }] },
    { id: "phase_3", name: "运行测试", tasks: [{ description: "npm run typecheck" }] },
    { id: "phase_4", name: "更新依赖", agent: "implementer", tasks: [{ description: "更新 package.json 和 tsconfig.json" }] },
  ])
  const assignments = assignRoles({ runId: "run_1", plan, projectRoot: "D:/Workspace", executionStrategy: "multi-agent" })

  assert.equal(assignments[0].role, "planner")
  assert.equal(assignments[0].sandboxMode, "read-only")
  assert.equal(assignments[1].role, "coder")
  assert.deepEqual(assignments[1].writePaths, ["src/App.vue"])
  assert.equal(assignments[2].role, "tester")
  assert.deepEqual(assignments[3].writePaths, ["package.json", "tsconfig.json"])
  assert.equal(inferRole({ name: "审查 patch", tasks: [] }, 1, 3), "reviewer")
})

test("roleAssigner annotates high-risk coder phases with consensus metadata", () => {
  const plan = planTree.createPlan("secure change", [
    {
      id: "phase_auth",
      name: "修改认证权限逻辑",
      tasks: [{ description: "修改 src/auth.ts，处理 token 和 permission 校验", files: ["src/auth.ts"] }],
      risk: "high",
    },
    {
      id: "phase_security",
      name: "Security review",
      tasks: [{ description: "审查 phase_auth 是否泄漏 secret 或破坏权限边界" }],
      consensusForStepId: "phase_auth",
    },
  ])

  const assignments = assignRoles({ runId: "run_secure", plan, projectRoot: "D:/Workspace", executionStrategy: "multi-agent" })
  const auth = assignments.find((assignment) => assignment.phaseId === "phase_auth")
  const security = assignments.find((assignment) => assignment.phaseId === "phase_security")

  assert.equal(auth.role, "coder")
  assert.equal(auth.requiresConsensus, true)
  assert.deepEqual(auth.consensusWith, ["reviewer", "tester", "security"])
  assert.deepEqual(auth.writePaths, ["src/auth.ts"])
  assert.equal(security.role, "security")
  assert.equal(security.consensusForStepId, "phase_auth")
  assert.equal(security.sandboxMode, "read-only")
})

test("planTree preserves native role, risk, consensus, and file metadata", () => {
  const plan = planTree.createPlan("metadata", [
    {
      id: "phase_1",
      name: "实现认证变更",
      agentRole: "coder",
      risk: "high",
      requiresConsensus: true,
      consensusWith: ["reviewer", "tester", "security"],
      tasks: [{ description: "修改认证", files: ["src/auth.ts"], risk: "high" }],
    },
  ])

  assert.equal(plan.phases[0].agentRole, "coder")
  assert.equal(plan.phases[0].risk, "high")
  assert.equal(plan.phases[0].estimatedRisk, "high")
  assert.equal(plan.phases[0].requiresConsensus, true)
  assert.deepEqual(plan.phases[0].consensusWith, ["reviewer", "tester", "security"])
  assert.deepEqual(plan.phases[0].tasks[0].files, ["src/auth.ts"])
  assert.equal(plan.phases[0].tasks[0].risk, "high")
})
