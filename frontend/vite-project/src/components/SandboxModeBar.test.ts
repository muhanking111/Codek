import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import SandboxModeBar from "./SandboxModeBar.vue"

const mocks = vi.hoisted(() => ({
  api: vi.fn(async (method: string, path: string) => {
    if (method === "GET" && path.startsWith("/agent/policy")) {
      return {
        ok: true,
        data: {
          policy: {
            sandboxMode: "workspace-write",
            approvalMode: "on-request",
            networkAllowed: false,
          },
          trust: { status: "unknown" },
        },
      }
    }
    return { ok: true, data: {} }
  }),
}))

vi.mock("../workspace/manager.js", () => ({
  workspace: {
    projectRoot: "D:/Workspace",
  },
}))

describe("SandboxModeBar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).codek = {
      api: mocks.api,
    }
  })

  it("renders a compact policy summary and opens the policy popover", async () => {
    const wrapper = mount(SandboxModeBar)
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    const trigger = wrapper.find('[data-codek-smoke="sandbox-policy-trigger"]')
    expect(trigger.exists()).toBe(true)
    expect(trigger.text()).toContain("未确认")
    expect(trigger.text()).toContain("工作区写入")
    expect(trigger.text()).toContain("请求时询问")
    expect(trigger.text()).toContain("网络关闭")
    expect(wrapper.find(".smb-popover").exists()).toBe(false)

    await trigger.trigger("click")

    expect(trigger.attributes("aria-expanded")).toBe("true")
    expect(wrapper.find(".smb-popover").exists()).toBe(true)
    expect(wrapper.find(".smb-popover").text()).toContain("智能体执行策略")
  })

  it("persists policy changes from the popover", async () => {
    const wrapper = mount(SandboxModeBar)
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-codek-smoke="sandbox-policy-trigger"]').trigger("click")
    const network = wrapper.find('input[type="checkbox"]')
    await network.setValue(true)

    expect(mocks.api).toHaveBeenCalledWith(
      "POST",
      "/agent/policy",
      expect.objectContaining({ networkAllowed: true }),
    )
    expect(mocks.api).toHaveBeenCalledWith(
      "POST",
      "/workspace/trust",
      expect.objectContaining({ root: "D:/Workspace", status: "unknown" }),
    )
  })
})
