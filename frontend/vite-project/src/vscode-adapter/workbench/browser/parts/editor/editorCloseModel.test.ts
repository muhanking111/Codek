import { describe, expect, it } from "vitest"
import { planEditorClose, type EditorCloseEntry } from "./editorCloseModel"

function paths(editors: EditorCloseEntry[]): string[] {
  return editors.map((editor) => editor.path)
}

describe("planEditorClose", () => {
  it("closes one editor and activates the previous sequential editor", () => {
    const plan = planEditorClose({
      editors: [{ path: "a.ts" }, { path: "b.ts" }, { path: "c.ts" }],
      activeEditor: "b.ts",
      kind: "single",
      targetPath: "b.ts",
    })

    expect(paths(plan.closing)).toEqual(["b.ts"])
    expect(paths(plan.editors)).toEqual(["a.ts", "c.ts"])
    expect(plan.activeEditor).toBe("a.ts")
  })

  it("keeps pinned editors when closing others or right", () => {
    const editors = [{ path: "a.ts" }, { path: "b.ts", pinned: true }, { path: "c.ts" }, { path: "d.ts" }]

    expect(paths(planEditorClose({ editors, activeEditor: "c.ts", kind: "others", targetPath: "c.ts" }).editors)).toEqual([
      "b.ts",
      "c.ts",
    ])
    expect(paths(planEditorClose({ editors, activeEditor: "c.ts", kind: "right", targetPath: "a.ts" }).editors)).toEqual([
      "a.ts",
      "b.ts",
    ])
  })

  it("closes saved editors while preserving dirty and pinned entries", () => {
    const plan = planEditorClose({
      editors: [{ path: "a.ts" }, { path: "b.ts", dirty: true }, { path: "c.ts", pinned: true }],
      activeEditor: "a.ts",
      kind: "saved",
    })

    expect(paths(plan.closing)).toEqual(["a.ts"])
    expect(paths(plan.editors)).toEqual(["b.ts", "c.ts"])
    expect(plan.activeEditor).toBe("c.ts")
  })
})
