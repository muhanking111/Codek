import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it } from "vitest"
import SchemaSettingsSection from "./SchemaSettingsSection.vue"
import { settingsStore } from "../settings/settingsStore"

describe("SchemaSettingsSection", () => {
  beforeEach(() => {
    settingsStore.reset()
  })

  it("renders settings for a schema group", () => {
    const wrapper = mount(SchemaSettingsSection, {
      props: { group: "editor" },
    })

    expect(wrapper.text()).toContain("编辑器字号")
    expect(wrapper.text()).not.toContain("editor.fontSize")
    expect(wrapper.find(".schema-settings-key").exists()).toBe(false)
  })

  it("writes changed number values to the settings store", async () => {
    const wrapper = mount(SchemaSettingsSection, {
      props: { group: "editor" },
    })
    const input = wrapper.find('input[type="number"]')

    await input.setValue("18")
    await input.trigger("change")

    expect(settingsStore.get("editor.fontSize")).toBe(18)
  })

  it("renders boolean settings as styled switches and toggles values", async () => {
    const wrapper = mount(SchemaSettingsSection, {
      props: { group: "editor" },
    })
    const toggle = wrapper.find('[role="switch"][aria-label="显示 minimap"]')

    expect(toggle.exists()).toBe(true)
    expect(toggle.classes()).toContain("schema-settings-toggle")
    expect(toggle.find(".schema-settings-toggle-track").exists()).toBe(true)
    expect(toggle.find(".schema-settings-toggle-knob").exists()).toBe(true)
    expect(toggle.attributes("aria-checked")).toBe("true")

    await toggle.trigger("click")

    expect(settingsStore.get("editor.minimap.enabled")).toBe(false)
    expect(toggle.attributes("aria-checked")).toBe("false")
    expect(toggle.text()).toContain("关闭")
  })

  it("writes toggles back to workspace scope when a workspace override is active", async () => {
    settingsStore.set("editor.insertSpaces", true, "workspace")
    const wrapper = mount(SchemaSettingsSection, {
      props: { group: "editor" },
    })
    const toggle = wrapper.find('[role="switch"][aria-label="插入空格"]')

    expect(toggle.attributes("aria-checked")).toBe("true")

    await toggle.trigger("click")

    expect(settingsStore.getWorkspaceSettings()["editor.insertSpaces"]).toBe(false)
    expect(settingsStore.get("editor.insertSpaces")).toBe(false)
    expect(toggle.attributes("aria-checked")).toBe("false")
    expect(toggle.text()).toContain("关闭")
  })

  it("renders appearance settings as active controls", () => {
    const wrapper = mount(SchemaSettingsSection, {
      props: { group: "appearance" },
    })

    expect(wrapper.text()).toContain("图标主题")
    expect(wrapper.text()).toContain("显示活动栏")
    expect(wrapper.text()).toContain("侧边栏位置")
    expect(wrapper.findAll(".settings-pill")).toHaveLength(0)
  })

  it("renders ready privacy settings from the unified schema", () => {
    const wrapper = mount(SchemaSettingsSection, {
      props: { group: "privacy" },
    })

    expect(wrapper.text()).toContain("隐私模式")
    expect(wrapper.text()).not.toContain("codek.privacy.enabled")
    expect(wrapper.find(".schema-settings-key").exists()).toBe(false)
    expect(wrapper.text()).toContain("遥测级别")
    expect(wrapper.text()).toContain("日志脱敏")
    expect(wrapper.findAll(".settings-pill")).toHaveLength(0)
  })

  it("renders agent, rules-memory and indexing settings from the unified schema", () => {
    const agent = mount(SchemaSettingsSection, {
      props: { group: "agent" },
    })
    const rules = mount(SchemaSettingsSection, {
      props: { group: "rules-memory" },
    })
    const indexing = mount(SchemaSettingsSection, {
      props: { group: "indexing" },
    })

    expect(agent.text()).toContain("智能体审批模式")
    expect(rules.text()).toContain("启用规则")
    expect(rules.text()).toContain("启用智能体记忆")
    expect(rules.text()).toContain("记忆供应商")
    expect(rules.text()).toContain("本机记忆服务地址")
    expect(rules.text()).toContain("本机记忆服务不可用时回退")
    expect(indexing.text()).toContain("代码库索引")
    expect(indexing.text()).toContain("Web 搜索供应商")
  })
})
