import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ProblemsPanel from "./ProblemsPanel.vue"
import { problemState } from "./problemState"

vi.mock("../workspace/manager", () => ({
  workspace: {
    activeFile: "",
    files: {},
  },
}))

vi.mock("../i18n/index", () => ({
  useI18n: () => i18n,
}))

const i18n = {
  t: (key: string) => ({
    "problems.noProblems": "No problems",
    "problems.errors": "errors",
    "problems.warnings": "warnings",
    "problems.info": "info",
  }[key] || key),
}

describe("ProblemsPanel", () => {
  beforeEach(() => {
    problemState.clear()
  })

  it("hides zero-count filter controls when there are no diagnostics", () => {
    const wrapper = mount(ProblemsPanel, {
      props: { visible: true },
    })

    expect(wrapper.find(".toolbar-severity-filters").exists()).toBe(false)
    expect(wrapper.find(".toolbar-source-filters").exists()).toBe(false)
    expect(wrapper.find(".problems-empty").text()).toBe("No problems")
    expect(wrapper.text()).not.toContain("0")
  })

  it("renders marker-service backed Problems projection by source and file without local diagnostic state", async () => {
    problemState.addCompilerDiagnostics("src/App.vue", [
      { line: 2, column: 3, message: "template compile failed", severity: "error", source: "vue-tsc" },
    ])
    problemState.addLintDiagnostics("src/Panel.vue", [
      { line: 7, column: 1, message: "unused import", severity: "warning", source: "ESLint" },
    ])

    const wrapper = mount(ProblemsPanel, {
      props: { visible: true },
    })

    expect(wrapper.attributes("data-codek-smoke")).toBe("problems-panel")
    expect(wrapper.text()).toContain("Compiler")
    expect(wrapper.text()).toContain("检查器")
    expect(wrapper.text()).not.toContain("信息0")
    expect(wrapper.text()).not.toContain("智能0")
    expect(wrapper.text()).toContain("src/App.vue")
    expect(wrapper.text()).toContain("src/Panel.vue")
    expect(wrapper.text()).toContain("template compile failed")
    expect(wrapper.text()).toContain("unused import")
    expect(wrapper.find(".problems-footer").text()).toBe("1 errors, 1 warnings")

    await wrapper.findAll(".source-filter-btn")[0].trigger("click")
    expect(wrapper.text()).not.toContain("template compile failed")
    expect(wrapper.text()).toContain("unused import")
  })

  it("emits navigation target evidence without opening files directly", async () => {
    problemState.addCompilerDiagnostics("src/App.vue", [
      { line: 4, column: 5, message: "bad prop", severity: "error", source: "vue-tsc" },
    ])
    const wrapper = mount(ProblemsPanel, {
      props: { visible: true },
    })

    await wrapper.find(".problems-item").trigger("click")

    expect(wrapper.emitted("openFile")).toEqual([[
      { file: "src/App.vue", line: 4, column: 5 },
    ]])
  })
})
