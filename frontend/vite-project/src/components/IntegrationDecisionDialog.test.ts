import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import type { IntegrationDecision } from "../agent/orchestratorClient"
import IntegrationDecisionDialog from "./IntegrationDecisionDialog.vue"

const dialogStub = {
  props: ["visible", "title", "width"],
  emits: ["close"],
  template: `
    <section v-if="visible" data-testid="dialog">
      <header>{{ title }}</header>
      <slot />
      <footer><slot name="footer" /></footer>
    </section>
  `,
}

function makeDecision(overrides: Partial<IntegrationDecision> = {}): IntegrationDecision {
  return {
    id: "decision-1",
    runId: "run-1",
    status: "pending",
    conflicts: [],
    proposedPatch: {
      summary: "更新 ChatAI 入口",
      filesChanged: ["src/App.vue"],
    },
    qualityGate: {
      status: "passed",
      summary: "typecheck passed",
    },
    applyResult: null,
    rollbackResult: null,
    reason: "等待用户确认",
    ...overrides,
  }
}

function mountDecision(decision: IntegrationDecision) {
  return mount(IntegrationDecisionDialog, {
    props: { decision },
    global: {
      stubs: {
        CodekDialog: dialogStub,
      },
    },
  })
}

describe("IntegrationDecisionDialog", () => {
  it("disables accept when the quality gate failed", () => {
    const wrapper = mountDecision(
      makeDecision({
        qualityGate: {
          status: "failed",
          summary: "typecheck failed",
        },
      }),
    )

    expect(wrapper.find('[data-codek-smoke="decision-product-panel"]').text()).toContain("质量门失败")
    expect(wrapper.find('[data-codek-smoke="decision-accept"]').attributes("disabled")).toBeDefined()
  })

  it("disables accept when conflicts are present", () => {
    const wrapper = mountDecision(
      makeDecision({
        conflicts: [{ file: "src/App.vue", assignments: ["assignment-1", "assignment-2"] }],
      }),
    )

    expect(wrapper.find('[data-codek-smoke="decision-product-panel"]').text()).toContain("先处理冲突")
    expect(wrapper.find('[data-codek-smoke="decision-accept"]').attributes("disabled")).toBeDefined()
  })

  it("enables rollback only after a patch has been applied", async () => {
    const wrapper = mountDecision(
      makeDecision({
        status: "accepted",
        applyResult: {
          status: "applied",
          filesChanged: ["src/App.vue"],
          appliedAt: Date.now(),
        },
      }),
    )

    const rollback = wrapper.find('[data-codek-smoke="decision-rollback"]')
    expect(rollback.attributes("disabled")).toBeUndefined()

    await rollback.trigger("click")

    expect(wrapper.emitted("decide")?.[0]).toEqual(["rollback"])
  })
})
