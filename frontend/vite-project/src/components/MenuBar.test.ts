import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it } from "vitest"
import { nextTick } from "vue"
import { MenuId, MenuRegistry } from "../vscode-adapter/platform/actions/common/menuRegistry"
import MenuBar from "./MenuBar.vue"

describe("MenuBar contribution model", () => {
  beforeEach(() => {
    MenuRegistry.clear()
    document.body.innerHTML = ""
  })

  it("renders VS Code-style menu contributions through the existing menubar", async () => {
    MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
      command: {
        id: "agent.evidence.openTimeline",
        title: "打开智能体证据时间线",
        precondition: "agentEvidenceAvailable",
      },
      group: "navigation",
      order: -1,
      when: "hasWorkspace",
    })

    const wrapper = mount(MenuBar, {
      attachTo: document.body,
      props: {
        hasWorkspace: true,
        isElectron: true,
      },
    })

    await wrapper.findAll(".menu-item")[3].trigger("click")
    await nextTick()

    expect(wrapper.text()).toContain("打开智能体证据时间线")
    const contributed = wrapper.findAll(".menu-dropdown-item").find((button) =>
      button.text().includes("打开智能体证据时间线"),
    )
    expect(contributed?.attributes("disabled")).toBeDefined()

    wrapper.unmount()
  })
})
