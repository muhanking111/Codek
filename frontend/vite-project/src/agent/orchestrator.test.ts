/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Agent } from "./agent"
import { AgentPool } from "./agentPool"
import { Orchestrator } from "./orchestrator"
import type { TaskPlan, TaskStep } from "./taskPlanner"
import { buildMemoryContextAsync, clearMemory, resetMemoryProviderForTests } from "./agentMemory"
import { settingsStore } from "../settings/settingsStore"

vi.mock("./taskPlanner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./taskPlanner")>()
  return {
    ...actual,
    topologicalSort: (steps: TaskStep[]) => {
      const remaining = [...steps]
      const layers: TaskStep[][] = []
      while (remaining.length > 0) {
        const layer = remaining.filter((candidate) =>
          candidate.dependsOn.every((depId) => !remaining.some((other) => other.id === depId))
        )
        if (layer.length === 0) return [remaining]
        layers.push(layer)
        for (const item of layer) {
          remaining.splice(remaining.indexOf(item), 1)
        }
      }
      return layers
    },
  }
})

function step(overrides: Partial<TaskStep>): TaskStep {
  return {
    id: overrides.id || "impl",
    description: overrides.description || "Implement high-risk auth change",
    instruction: overrides.instruction || "Edit auth.ts",
    dependsOn: overrides.dependsOn || [],
    estimatedRisk: overrides.estimatedRisk || "high",
    agentRole: overrides.agentRole || "coder",
    status: overrides.status || "pending",
    ...overrides,
  }
}

function plan(steps: TaskStep[]): TaskPlan {
  return {
    id: "plan-1",
    goal: "Ship high-risk change",
    steps,
    projectRoot: "D:/Workspace",
    continueOnError: false,
    createdAt: 1,
  }
}

function poolFor(outputs: string[]): AgentPool {
  let index = 0
  return new AgentPool({
    maxConcurrency: 1,
    agentFactory: () => ({
      send: vi.fn(async () => outputs[index++] || "done"),
      reset: vi.fn(),
    }) as unknown as Agent,
  })
}

describe("Orchestrator consensus gating", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    settingsStore.reset()
    clearMemory()
    resetMemoryProviderForTests()
  })

  it("lets consensus pass only when verdict is pass", async () => {
    const orchestrator = new Orchestrator({ pool: poolFor([
      "implementation complete",
      `{ "verdict": "pass", "reason": "tests passed", "evidence": ["npm test"] }`,
      `{ "verdict": "pass", "reason": "review passed", "evidence": ["diff checked"] }`,
      `{ "verdict": "pass", "reason": "security ok", "evidence": ["no secrets"] }`,
    ]) })

    const results = await orchestrator.execute(plan([
      step({ id: "impl", estimatedRisk: "high", agentRole: "coder" }),
    ]))

    expect(results).toHaveLength(4)
    expect(results.every((result) => result.status === "completed")).toBe(true)
  })

  it("fails the plan when consensus verdict is fail", async () => {
    const onPlanDone = vi.fn()
    const onPlanAborted = vi.fn()
    const orchestrator = new Orchestrator({
      pool: poolFor([
        "implementation complete",
        `{ "verdict": "fail", "reason": "missing test", "evidence": ["npm test failed"] }`,
      ]),
      onPlanDone,
      onPlanAborted,
    })

    const results = await orchestrator.execute(plan([
      step({ id: "impl", estimatedRisk: "high", agentRole: "coder" }),
    ]))

    const failed = results.find((result) => result.step.id === "impl-reviewer-consensus")
    expect(failed).toEqual(expect.objectContaining({
      status: "failed",
      error: expect.stringContaining("Consensus fail"),
    }))
    expect(onPlanDone).not.toHaveBeenCalled()
    expect(onPlanAborted).toHaveBeenCalled()
  })

  it("fails the plan when consensus verdict is needs-fix", async () => {
    const orchestrator = new Orchestrator({ pool: poolFor([
      "implementation complete",
      "```json\n{\"verdict\":\"needs-fix\",\"reason\":\"typecheck failed\",\"evidence\":[\"npm run build\"]}\n```",
    ]) })

    const results = await orchestrator.execute(plan([
      step({ id: "impl", estimatedRisk: "high", agentRole: "coder" }),
    ]))

    const failed = results.find((result) => result.step.id === "impl-reviewer-consensus")
    expect(failed?.status).toBe("failed")
    expect(failed?.error).toContain("needs-fix")
    expect(results.some((result) => result.status === "failed")).toBe(true)
  })

  it("does not silently pass unparseable high-risk consensus output", async () => {
    const orchestrator = new Orchestrator({ pool: poolFor([
      "implementation complete",
      "looks fine to me",
    ]) })

    const results = await orchestrator.execute(plan([
      step({ id: "impl", estimatedRisk: "high", agentRole: "coder" }),
    ]))

    const failed = results.find((result) => result.step.id === "impl-reviewer-consensus")
    expect(failed?.status).toBe("failed")
    expect(failed?.error).toContain("unparseable")
  })

  it("writes required memory evidence for evidence-gated steps", async () => {
    const orchestrator = new Orchestrator({ pool: poolFor(["docs audit complete"]) })

    await orchestrator.execute(plan([
      step({
        id: "docs-audit",
        description: "Audit docs against real verification evidence",
        instruction: "Check README and runbook and record verification evidence",
        estimatedRisk: "safe",
        agentRole: "docs",
        requiresMemoryEvidence: true,
        memoryTypes: ["decision", "verification"],
      }),
    ]))

    await vi.waitFor(async () => {
      const context = await buildMemoryContextAsync("docs-audit verification evidence", {
        types: ["decision", "verification"],
      })
      expect(context).toContain("Required evidence")
      expect(context).toContain("docs-audit")
    })
  })
})
