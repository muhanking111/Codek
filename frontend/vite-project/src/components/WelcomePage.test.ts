import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import WelcomePage from "./WelcomePage.vue"
import { getWelcomePageProjection } from "../workbench/gettingStartedService"

describe("WelcomePage", () => {
  it("renders quick actions from the Getting Started service projection", () => {
    const wrapper = mount(WelcomePage)
    const labels = wrapper.findAll(".quick-action .action-label").map((item) => item.text())

    expect(wrapper.attributes("data-getting-started-state-source")).toBe("IGettingStartedService")
    expect(labels).toEqual(getWelcomePageProjection().primaryActions.map((action) => action.label))

    wrapper.unmount()
  })

  it("keeps the existing App.vue event contract for service-projected actions", async () => {
    const wrapper = mount(WelcomePage)
    const buttons = wrapper.findAll(".quick-action")

    await buttons[0].trigger("click")
    await buttons[1].trigger("click")
    await buttons[2].trigger("click")
    await buttons[3].trigger("click")
    await buttons[4].trigger("click")

    expect(wrapper.emitted("openProject")).toHaveLength(1)
    expect(wrapper.emitted("newProject")).toHaveLength(1)
    expect(wrapper.emitted("openCommandPalette")).toHaveLength(1)
    expect(wrapper.emitted("openChat")).toHaveLength(1)
    expect(wrapper.emitted("openLink")).toEqual([["remote"]])

    wrapper.unmount()
  })
})
