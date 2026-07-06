import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import CodekInput from "./CodekInput.vue"
import CodekSelect from "./CodekSelect.vue"
import CodekTextarea from "./CodekTextarea.vue"
import CodekComboBox from "./CodekComboBox.vue"
import CodekSegmented from "./CodekSegmented.vue"

describe("settings controls", () => {
  it("emits CodekInput updates and keeps secret inputs masked by default", async () => {
    const wrapper = mount(CodekInput, {
      props: { modelValue: "", variant: "secret" },
    })
    const input = wrapper.get("input")

    expect(input.attributes("type")).toBe("password")
    await input.setValue("sk-test")

    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["sk-test"])
  })

  it("emits CodekSelect changes", async () => {
    const wrapper = mount(CodekSelect, {
      props: {
        modelValue: "off",
        options: [
          { value: "off", label: "关闭" },
          { value: "on", label: "开启" },
        ],
      },
    })

    await wrapper.get("select").setValue("on")

    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["on"])
    expect(wrapper.emitted("change")?.at(-1)).toEqual(["on"])
  })

  it("emits CodekTextarea content changes", async () => {
    const wrapper = mount(CodekTextarea, {
      props: { modelValue: "", variant: "code" },
    })

    await wrapper.get("textarea").setValue("npm run typecheck")

    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["npm run typecheck"])
  })

  it("filters CodekComboBox options and prioritizes exact matches", async () => {
    const wrapper = mount(CodekComboBox, {
      props: {
        modelValue: "",
        options: [
          { value: "qwen2.5-coder:1.5b", label: "qwen2.5-coder:1.5b" },
          { value: "qwen2.5-coder:3b", label: "qwen2.5-coder:3b" },
          { value: "qwen2.5-coder:0.5b", label: "qwen2.5-coder:0.5b" },
        ],
      },
    })

    await wrapper.get("input").setValue("qwen2.5-coder:3b")
    const labels = wrapper.findAll(".codek-combo-option-label").map((item) => item.text())

    expect(labels[0]).toBe("qwen2.5-coder:3b")
  })

  it("allows manual CodekComboBox model ids", async () => {
    const wrapper = mount(CodekComboBox, {
      props: {
        modelValue: "",
        options: [{ value: "gpt-4o-mini", label: "gpt-4o-mini" }],
      },
    })

    await wrapper.get("input").setValue("custom-model-id")
    await wrapper.get("input").trigger("keydown", { key: "Enter" })

    expect(wrapper.emitted("change")?.at(-1)).toEqual(["custom-model-id"])
  })

  it("emits CodekSegmented changes and supports arrow navigation", async () => {
    const wrapper = mount(CodekSegmented, {
      props: {
        modelValue: "ask",
        options: [
          { value: "ask", label: "问答" },
          { value: "plan", label: "计划" },
          { value: "agent", label: "智能体" },
        ],
      },
    })

    await wrapper.findAll("button")[0].trigger("keydown", { key: "ArrowRight" })

    expect(wrapper.emitted("change")?.at(-1)).toEqual(["plan"])
  })
})
