import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import ChatModelPicker from "./ChatModelPicker.vue"

const typeOptions = [
  { type: "ollama" as const, label: "Ollama" },
  { type: "openai" as const, label: "OpenAI" },
  { type: "claude" as const, label: "Anthropic" },
]

describe("ChatModelPicker", () => {
  it("sizes the model selector from the active model name and keeps Chinese empty states", () => {
    const wrapper = mount(ChatModelPicker, {
      props: {
        typeOptions,
        activeType: "ollama",
        activeModelName: "deepseek-v4:latest",
        currentModels: ["deepseek-v4:latest"],
        fetchingModels: false,
        providerEnabled: true,
      },
    })

    expect(wrapper.attributes("style")).toContain("--chat-model-select-ch: 18ch")
    expect(wrapper.find(".model-select-wrap").exists()).toBe(true)
    expect(wrapper.find(".refresh-btn").exists()).toBe(false)
    expect(wrapper.find(".model-select").attributes("title")).toBe("deepseek-v4:latest")
    expect(wrapper.text()).not.toContain("鏆")
  })

  it("renders disabled provider text in Chinese", () => {
    const wrapper = mount(ChatModelPicker, {
      props: {
        typeOptions,
        activeType: "ollama",
        activeModelName: "",
        currentModels: [],
        fetchingModels: false,
        providerEnabled: false,
      },
    })

    expect(wrapper.text()).toContain("未启用")
    expect(wrapper.find(".model-select").attributes("title")).toContain("请先在设置中启用")
  })
})
