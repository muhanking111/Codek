import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import type { RecoveryAction } from "../agent/orchestratorClient"
import AgentRecoveryActions from "./AgentRecoveryActions.vue"

function action(overrides: Partial<RecoveryAction>): RecoveryAction {
  return {
    id: "recovery-1",
    runId: "run-1",
    action: "retry",
    status: "pending",
    reason: "quality gate typecheck failed",
    createdAt: Date.now(),
    ...overrides,
  }
}

describe("AgentRecoveryActions", () => {
  it("labels quality gate and conflict recovery actions for users", () => {
    const wrapper = mount(AgentRecoveryActions, {
      props: {
        actions: [
          action({ id: "quality", action: "retry", reason: "quality gate typecheck failed" }),
          action({ id: "conflict", action: "rewind", reason: "conflict detected in src/App.vue" }),
          action({ id: "clarify", action: "ask_user", reason: "需求不清，需要用户补充范围" }),
        ],
      },
    })

    const text = wrapper.text()
    expect(text).toContain("质量门失败")
    expect(text).toContain("冲突")
    expect(text).toContain("需求不清")
  })

  it("emits execute for pending actions and disables completed actions", async () => {
    const wrapper = mount(AgentRecoveryActions, {
      props: {
        actions: [
          action({ id: "pending", action: "retry", status: "pending" }),
          action({ id: "done", action: "abort", status: "completed" }),
        ],
      },
    })

    const buttons = wrapper.findAll("button")
    expect(buttons[0].attributes("disabled")).toBeUndefined()
    expect(buttons[1].attributes("disabled")).toBeDefined()

    await buttons[0].trigger("click")

    expect(wrapper.emitted("execute")?.[0]).toEqual(["pending"])
  })
})
