import { describe, expect, it } from "vitest"
import { createSearchPreviewParts, groupSearchPanelMatches } from "./searchResultView"

describe("search result view adapter", () => {
  it("groups panel matches through the search model", () => {
    expect(groupSearchPanelMatches([
      { path: "src/a.ts", line: 1, column: 1, matchLength: 4, preview: "mark mark" },
      { path: "src/a.ts", line: 1, column: 6, matchLength: 4, preview: "mark mark" },
      { path: "src/b.ts", line: 2, column: 3, matchLength: 2, preview: "  ok" },
    ])).toEqual([
      {
        path: "src/a.ts",
        list: [{
          path: "src/a.ts",
          line: 1,
          column: 1,
          matchLength: 4,
          preview: "mark mark",
          previewParts: { before: "", hit: "mark", after: " mark" },
        }],
      },
      {
        path: "src/b.ts",
        list: [{
          path: "src/b.ts",
          line: 2,
          column: 3,
          matchLength: 2,
          preview: "ok",
          previewParts: { before: "ok", hit: "", after: "" },
        }],
      },
    ])
  })

  it("creates preview highlight parts from VS Code-style search ranges", () => {
    expect(createSearchPreviewParts("const value = 1", { line: 1, column: 7, matchLength: 5 })).toEqual({
      before: "const ",
      hit: "value",
      after: " = 1",
    })
  })
})
