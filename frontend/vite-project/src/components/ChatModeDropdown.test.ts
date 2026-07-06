import { mount } from "@vue/test-utils"
import { afterEach, describe, expect, it } from "vitest"
import ChatModeDropdown from "./ChatModeDropdown.vue"

describe("ChatModeDropdown", () => {
  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("opens from the current Plan mode and emits the selected mode", async () => {
    const wrapper = mount(ChatModeDropdown, {
      props: {
        modelValue: "plan",
        autoPermissionLevel: null,
      },
    })

    const trigger = wrapper.find('[data-codek-smoke="chat-mode-trigger"]')
    expect(trigger.text()).toContain("规划")
    expect(trigger.attributes("aria-expanded")).toBe("false")

    await trigger.trigger("click")

    expect(trigger.attributes("aria-expanded")).toBe("true")
    expect(wrapper.find(".mode-menu").exists()).toBe(true)

    await wrapper.find('[data-codek-smoke="chat-mode-agent"]').trigger("click")

    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["agent"])
    expect(wrapper.find(".mode-menu").exists()).toBe(false)
  })

  it("closes when clicking outside the dropdown", async () => {
    const outside = document.createElement("button")
    document.body.appendChild(outside)
    const wrapper = mount(ChatModeDropdown, {
      attachTo: document.body,
      props: {
        modelValue: "plan",
        autoPermissionLevel: null,
      },
    })

    await wrapper.find('[data-codek-smoke="chat-mode-trigger"]').trigger("click")
    expect(wrapper.find(".mode-menu").exists()).toBe(true)

    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find(".mode-menu").exists()).toBe(false)
  })

  it("closes when focus moves outside the dropdown", async () => {
    const outside = document.createElement("input")
    document.body.appendChild(outside)
    const wrapper = mount(ChatModeDropdown, {
      attachTo: document.body,
      props: {
        modelValue: "plan",
        autoPermissionLevel: null,
      },
    })

    await wrapper.find('[data-codek-smoke="chat-mode-trigger"]').trigger("click")
    expect(wrapper.find(".mode-menu").exists()).toBe(true)

    outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find(".mode-menu").exists()).toBe(false)
  })
})
