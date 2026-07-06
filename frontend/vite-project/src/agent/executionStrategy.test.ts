import { describe, expect, it } from "vitest"
import { applyConsensusPolicy, decideAgentExecutionStrategy, getRolePolicy } from "./executionStrategy"
import type { TaskStep } from "./taskPlanner"

describe("decideAgentExecutionStrategy", () => {
  it("keeps ask and plan out of execution routing", () => {
    expect(decideAgentExecutionStrategy({ visibleMode: "ask", text: "修改 src/App.vue" }).executionStrategy).toBe("none")
    expect(decideAgentExecutionStrategy({ visibleMode: "plan", text: "实现功能" }).executionStrategy).toBe("none")
  })

  it("routes simple single-file work to single agent", () => {
    const decision = decideAgentExecutionStrategy({
      visibleMode: "agent",
      text: "修复 src/components/ChatPanel.vue 的按钮样式",
    })

    expect(decision.executionStrategy).toBe("single-agent")
    expect(decision.signals.fileCount).toBe(1)
  })

  it("routes complex verified work to multi agent internally", () => {
    const decision = decideAgentExecutionStrategy({
      visibleMode: "auto",
      text: "重构 frontend/src/App.vue、frontend/src/components/ChatPanel.vue、desktop/services/router.js，并运行 typecheck 和 build",
    })

    expect(decision.executionStrategy).toBe("multi-agent")
    expect(decision.signals.fileCount).toBeGreaterThanOrEqual(3)
  })
})

describe("applyConsensusPolicy", () => {
  function step(overrides: Partial<TaskStep>): TaskStep {
    return {
      id: overrides.id || "step-1",
      description: overrides.description || "实现功能",
      instruction: overrides.instruction || overrides.description || "实现功能",
      dependsOn: overrides.dependsOn || [],
      estimatedRisk: overrides.estimatedRisk || "medium",
      status: overrides.status || "pending",
      ...overrides,
    }
  }

  it("exposes a named RolePolicy for role, consensus, and memory evidence decisions", () => {
    const policy = getRolePolicy(step({
      id: "release",
      description: "执行 release gate 并验证交付证据",
      instruction: "运行 release gate、记录 verification evidence，并复核输出。",
      estimatedRisk: "high",
      agentRole: "release",
    }))

    expect(policy).toEqual({
      agentRole: "release",
      requiresConsensus: true,
      consensusWith: ["reviewer", "tester", "security"],
      requiresMemoryEvidence: true,
      memoryTypes: ["verification", "success"],
    })
  })

  it("keeps ordinary DAG steps unchanged except for inferred roles", () => {
    const steps = applyConsensusPolicy([
      step({ id: "read", description: "阅读代码", estimatedRisk: "safe" }),
      step({ id: "impl", description: "修改 src/App.vue", estimatedRisk: "medium", dependsOn: ["read"] }),
    ])

    expect(steps).toHaveLength(2)
    expect(steps.map((s) => s.agentRole)).toEqual(["planner", "coder"])
    expect(steps[1].dependsOn).toEqual(["read"])
  })

  it("adds reviewer and tester gates for high-risk coder steps", () => {
    const steps = applyConsensusPolicy([
      step({
        id: "impl",
        description: "重构认证权限逻辑",
        instruction: "修改 auth.ts 并更新权限校验",
        estimatedRisk: "high",
        agentRole: "coder",
      }),
    ])

    expect(steps.map((s) => s.id)).toEqual([
      "impl",
      "impl-reviewer-consensus",
      "impl-tester-consensus",
      "impl-security-consensus",
    ])
    expect(steps[0]).toEqual(expect.objectContaining({
      requiresConsensus: true,
      consensusWith: ["reviewer", "tester", "security"],
    }))
    expect(steps.slice(1).map((s) => s.dependsOn)).toEqual([["impl"], ["impl"], ["impl"]])
    expect(steps.slice(1).map((s) => s.agentRole)).toEqual(["reviewer", "tester", "security"])
  })

  it("keeps auth write work on coder while adding security consensus", () => {
    const steps = applyConsensusPolicy([
      step({
        id: "auth",
        description: "修改认证权限逻辑",
        instruction: "编辑 src/auth.ts，更新 token 和 permission 校验",
        estimatedRisk: "high",
      }),
    ])

    expect(steps[0]).toEqual(expect.objectContaining({
      agentRole: "coder",
      requiresConsensus: true,
      consensusWith: ["reviewer", "tester", "security"],
    }))
    expect(steps.some((s) => s.agentRole === "security" && s.consensusForStepId === "auth")).toBe(true)
  })

  it("does not create duplicate consensus gates when they already exist", () => {
    const steps = applyConsensusPolicy([
      step({ id: "impl", estimatedRisk: "high", agentRole: "coder", requiresConsensus: true, consensusWith: ["reviewer"] }),
      step({ id: "existing-review", dependsOn: ["impl"], agentRole: "reviewer", description: "Review impl" }),
    ])

    expect(steps.filter((s) => s.agentRole === "reviewer")).toHaveLength(1)
  })

  it("materializes explicit consensusWith roles even for medium-risk coder steps", () => {
    const steps = applyConsensusPolicy([
      step({
        id: "impl",
        description: "修改 src/App.vue 的交互逻辑",
        estimatedRisk: "medium",
        agentRole: "coder",
        consensusWith: ["tester"],
      }),
    ])

    expect(steps[0]).toEqual(expect.objectContaining({
      requiresConsensus: true,
      consensusWith: ["tester"],
    }))
    expect(steps).toContainEqual(expect.objectContaining({
      id: "impl-tester-consensus",
      agentRole: "tester",
      consensusForStepId: "impl",
      dependsOn: ["impl"],
    }))
  })

  it("does not add second-order consensus gates to consensus validation steps", () => {
    const steps = applyConsensusPolicy([
      step({
        id: "impl",
        description: "修改 src/auth.ts",
        estimatedRisk: "high",
        agentRole: "coder",
      }),
      step({
        id: "impl-security-consensus",
        description: "Security review: 修改 src/auth.ts",
        instruction: "检查步骤 impl 是否触碰权限、密钥或 token 边界。",
        dependsOn: ["impl"],
        estimatedRisk: "safe",
        agentRole: "security",
        consensusForStepId: "impl",
      }),
    ])

    expect(steps.filter((s) => s.id.includes("security-consensus"))).toHaveLength(1)
    expect(steps.some((s) => s.id === "impl-security-consensus-reviewer-consensus")).toBe(false)
  })

  it("requires decision and verification memory evidence for doc audit work", () => {
    const steps = applyConsensusPolicy([
      step({
        id: "docs-audit",
        description: "对照文档审计实现是否完成",
        instruction: "检查 README 和 runbook，并用真实 evidence 复核验收结果。",
        estimatedRisk: "safe",
      }),
    ])

    expect(steps[0]).toEqual(expect.objectContaining({
      agentRole: "docs",
      requiresMemoryEvidence: true,
      memoryTypes: ["decision", "verification"],
    }))
  })

  it("requires verification and success memory evidence for release work", () => {
    const steps = applyConsensusPolicy([
      step({
        id: "release-gate",
        description: "执行发布候选质量门",
        instruction: "运行 release gate 并记录交付证据。",
        estimatedRisk: "medium",
      }),
    ])

    expect(steps[0]).toEqual(expect.objectContaining({
      agentRole: "release",
      requiresMemoryEvidence: true,
      memoryTypes: ["verification", "success"],
    }))
  })
})
