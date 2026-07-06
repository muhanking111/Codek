/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TaskPlan } from "./taskPlanner"
import { buildMemoryContext, clearMemory, resetMemoryProviderForTests } from "./agentMemory"
import { settingsStore } from "../settings/settingsStore"

const runnerMocks = vi.hoisted(() => ({
  generatePlan: vi.fn(),
  execute: vi.fn(),
  verifyAndDiagnose: vi.fn(),
  notify: vi.fn(),
  playSound: vi.fn(),
}))

vi.mock("./taskPlanner", () => {
  return {
    generatePlan: runnerMocks.generatePlan,
    createAgentPlan: ({ goal, projectRoot, continueOnError = false }: {
      goal: string
      projectRoot: string
      continueOnError?: boolean
    }) => ({
      id: "plan-test",
      goal,
      steps: [],
      projectRoot,
      continueOnError,
      createdAt: 1,
    }),
  }
})

vi.mock("./orchestrator", () => ({
  Orchestrator: vi.fn().mockImplementation(() => ({
    abort: vi.fn(),
    execute: runnerMocks.execute,
  })),
}))

vi.mock("./buildVerifier", () => ({
  verifyAndDiagnose: runnerMocks.verifyAndDiagnose,
}))

vi.mock("../utils/notifications", () => ({
  notify: runnerMocks.notify,
}))

vi.mock("../utils/soundNotifier", () => ({
  playSound: runnerMocks.playSound,
}))

describe("AutoRunner verification memory integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    settingsStore.reset()
    clearMemory()
    resetMemoryProviderForTests()
    runnerMocks.generatePlan.mockResolvedValue([
      {
        id: "step-1",
        description: "实现修复",
        instruction: "实现修复",
        dependsOn: [],
        estimatedRisk: "safe",
        status: "pending",
      },
    ])
    runnerMocks.execute.mockImplementation(async (plan: TaskPlan) =>
      plan.steps.map((step, index) => ({
        stepIndex: index,
        step,
        status: "completed",
        output: "done",
      })),
    )
    runnerMocks.verifyAndDiagnose.mockResolvedValue({
      passed: false,
      failingStage: "test",
      guidance: "Vitest failed: assertion mismatch",
      steps: [
        {
          command: "npm test",
          stage: "test",
          success: false,
          output: "expected true to be false",
          error: "assertion mismatch",
        },
      ],
    })
  })

  it("writes failed verification evidence to memory from the AutoRunner flow", async () => {
    const { AutoRunner } = await import("./autoRunner")
    const runner = new AutoRunner({
      goal: "修复测试失败",
      projectRoot: "D:/Workspace",
      maxFixRounds: 0,
    })

    const result = await runner.run()

    expect(result.success).toBe(false)
    expect(result.verification?.failingStage).toBe("test")
    await vi.waitFor(() => {
      const context = buildMemoryContext("Vitest failed npm test")
      expect(context).toContain("Verification Evidence")
      expect(context).toContain("npm test")
      expect(context).toContain("Vitest failed")
    })
  })

  it("does not report success when orchestrator consensus gates fail", async () => {
    runnerMocks.execute.mockResolvedValue([
      {
        stepIndex: 0,
        step: {
          id: "step-1-reviewer-consensus",
          description: "Review step",
          instruction: "Review step",
          dependsOn: ["step-1"],
          estimatedRisk: "safe",
          status: "failed",
        },
        status: "failed",
        error: "Consensus fail for step-1: missing tests",
      },
    ])
    runnerMocks.verifyAndDiagnose.mockResolvedValue({
      passed: true,
      steps: [],
    })

    const { AutoRunner } = await import("./autoRunner")
    const runner = new AutoRunner({
      goal: "高风险修改",
      projectRoot: "D:/Workspace",
    })

    const result = await runner.run()

    expect(result.success).toBe(false)
    expect(runnerMocks.verifyAndDiagnose).not.toHaveBeenCalled()
    expect(runnerMocks.notify).toHaveBeenCalledWith("error", expect.stringContaining("Consensus fail"))
  })
})
