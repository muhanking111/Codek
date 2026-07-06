import { describe, expect, it, vi } from "vitest"
import { createReferencesModel } from "./referencesModel"

describe("CodekReferencesModel", () => {
  it("groups, sorts, deduplicates, and projects references for peek-safe UI", () => {
    const model = createReferencesModel([
      {
        uri: "src/b.ts",
        range: { startLineNumber: 5, startColumn: 2, endLineNumber: 5, endColumn: 5 },
        preview: "  call runner()  ",
      },
      {
        uri: "src/a.ts",
        range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 4 },
      },
      {
        uri: "src/a.ts",
        range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 4 },
      },
    ], "run references")

    expect(model.toReferenceData()).toEqual({
      total: 2,
      files: [
        { path: "src/a.ts", count: 1 },
        { path: "src/b.ts", count: 1 },
      ],
    })
    expect(model.toPeekModel()).toMatchObject({
      title: "run references",
      total: 2,
      isEmpty: false,
      ariaMessage: "Found 2 references in 2 files",
    })
    expect(model.firstReference()).toMatchObject({ path: "src/b.ts", isProviderFirst: true, preview: "call runner()" })
  })

  it("finds next, nearest, and exact references without requiring a peek widget", () => {
    const model = createReferencesModel([
      { uri: "src/a.ts", range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 } },
      { uri: "src/b.ts", range: { startLineNumber: 10, startColumn: 2, endLineNumber: 10, endColumn: 5 } },
    ])
    const first = model.references[0]

    expect(model.nextOrPreviousReference(first, true)).toMatchObject({ path: "src/b.ts" })
    expect(model.nextOrPreviousReference(first, false)).toMatchObject({ path: "src/b.ts" })
    expect(model.nearestReference("src/b.ts", 11, 2)).toMatchObject({ path: "src/b.ts" })
    expect(model.referenceAt("src/a.ts", 1, 2)).toBe(first)
  })

  it("opens references through evidence-safe navigation actions", async () => {
    const model = createReferencesModel([
      { uri: "src/a.ts", range: { startLineNumber: 3, startColumn: 4, endLineNumber: 3, endColumn: 7 } },
    ])
    const editor = {
      setSelection: vi.fn(),
      revealPositionInCenter: vi.fn(),
      focus: vi.fn(),
    }
    const workspace = { activeFile: "src/current.ts" }
    const openFile = vi.fn(async (path: string) => {
      workspace.activeFile = path
      return true
    })

    await expect(model.openReference(model.references[0], {
      getEditor: () => editor,
      getActiveFile: () => workspace.activeFile,
      openFile,
    })).resolves.toBe(true)

    expect(openFile).toHaveBeenCalledWith("src/a.ts")
    expect(editor.setSelection).toHaveBeenCalledWith({
      startLineNumber: 3,
      startColumn: 4,
      endLineNumber: 3,
      endColumn: 7,
    })
    expect(editor.focus).toHaveBeenCalled()
  })
})
