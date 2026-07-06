import { describe, expect, it } from "vitest"
import { buildEditorLabelModels, buildEditorTitleModel, shortReadableLabel } from "./editorLabels"

describe("VS Code editor label adapter", () => {
  it("uses basename labels and only adds parent descriptions for duplicates", () => {
    const labels = buildEditorLabelModels([
      "src/index.ts",
      "tests/index.ts",
      "README.md",
    ])

    expect(labels["src/index.ts"]).toMatchObject({
      name: "index.ts",
      duplicate: true,
      description: "src",
      title: "index.ts - src",
    })
    expect(labels["tests/index.ts"]).toMatchObject({
      name: "index.ts",
      duplicate: true,
      description: "tests",
      title: "index.ts - tests",
    })
    expect(labels["README.md"]).toMatchObject({
      name: "README.md",
      duplicate: false,
      description: "",
      title: "README.md",
    })
  })

  it("keeps active dirty and pinned state in the label model", () => {
    const labels = buildEditorLabelModels([{
      path: "src/App.vue",
      active: true,
      dirty: true,
      pinned: true,
    }])

    expect(labels["src/App.vue"]).toMatchObject({
      active: true,
      dirty: true,
      pinned: true,
      ariaLabel: "App.vue, unsaved, pinned",
      stateLabel: "unsaved, pinned",
      stateClass: "unsaved pinned",
    })
  })

  it("builds title labels from the same tab label semantics", () => {
    expect(buildEditorTitleModel({ path: "frontend/vite-project/src/App.vue", dirty: true })).toMatchObject({
      path: "frontend/vite-project/src/App.vue",
      name: "App.vue",
      title: "frontend/vite-project/src/App.vue",
      ariaLabel: "App.vue, unsaved",
    })
    expect(buildEditorTitleModel(null)).toBeNull()
  })

  it("returns stable short labels for cramped tab layouts", () => {
    expect(shortReadableLabel("package.json")).toBe("pack")
    expect(shortReadableLabel("a.ts")).toBe("a.ts")
    expect(shortReadableLabel("")).toBe("?")
  })
})
