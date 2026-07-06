import { describe, expect, it } from "vitest"
import { buildActiveEditorTitleModel, buildTabDisplayModels, shortReadableLabel } from "./tabDisplay"

describe("tabDisplay", () => {
  it("keeps an explicit short label so overflowed tabs never render blank", () => {
    expect(shortReadableLabel("package.json")).toBe("pack")
    expect(shortReadableLabel("a.ts")).toBe("a.ts")
    expect(shortReadableLabel("")).toBe("?")
  })

  it("builds VS Code-style display metadata for all open tabs", () => {
    const models = buildTabDisplayModels(["src/index.ts", "tests/index.ts", "README.md"])

    expect(models["src/index.ts"]).toMatchObject({
      basename: "index.ts",
      shortLabel: "inde",
      duplicate: true,
      description: "src",
      tooltip: "index.ts - src",
    })
    expect(models["tests/index.ts"]).toMatchObject({
      description: "tests",
      tooltip: "index.ts - tests",
    })
    expect(models["README.md"]).toMatchObject({
      duplicate: false,
      description: "",
      tooltip: "README.md",
    })
  })

  it("carries active dirty and pinned state into the tab label model", () => {
    const models = buildTabDisplayModels(["src/app.ts", "src/other.ts"], {
      activeFile: "src/app.ts",
      dirtyFiles: { "src/app.ts": true },
      pinnedTabs: new Set(["src/app.ts"]),
    })

    expect(models["src/app.ts"]).toMatchObject({
      active: true,
      dirty: true,
      pinned: true,
      ariaLabel: "app.ts, unsaved, pinned",
      stateLabel: "unsaved, pinned",
      stateClass: "unsaved pinned",
    })
    expect(models["src/other.ts"]).toMatchObject({
      active: false,
      dirty: false,
      pinned: false,
      ariaLabel: "other.ts",
      stateLabel: "",
      stateClass: "",
    })
  })

  it("builds the active editor title from the same VS Code-style label model", () => {
    const model = buildActiveEditorTitleModel({
      path: "src/workbench/App.vue",
      projectName: "Codek",
      dirtyFiles: ["src/workbench/App.vue"],
      pinnedTabs: new Set(["src/workbench/App.vue"]),
      largeFile: true,
    })

    expect(model).toMatchObject({
      name: "App.vue",
      rootLabel: "Codek",
      relativePath: "src/workbench/App.vue",
      dirty: true,
      pinned: true,
      largeFile: true,
      tooltip: "src/workbench/App.vue",
      ariaLabel: "App.vue, unsaved, pinned",
      stateLabel: "unsaved, pinned",
      stateClass: "unsaved pinned",
    })
  })

  it("returns an empty active editor title model when no file is active", () => {
    expect(buildActiveEditorTitleModel({ path: "", projectName: "Codek" })).toMatchObject({
      name: "",
      rootLabel: "Codek",
      relativePath: "",
      dirty: false,
      pinned: false,
      largeFile: false,
      tooltip: "",
      ariaLabel: "",
      stateLabel: "",
      stateClass: "",
    })
  })
})
