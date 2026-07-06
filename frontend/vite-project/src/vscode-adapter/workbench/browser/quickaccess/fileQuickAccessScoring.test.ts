import { describe, expect, it } from "vitest"
import { filterFileQuickAccess, scoreFileQuickAccess } from "./fileQuickAccessScoring"

describe("file quick access scoring", () => {
  it("prefers exact basename matches over path fuzzy matches", () => {
    const results = filterFileQuickAccess([
      { path: "src/components/App.vue" },
      { path: "docs/app-notes.md" },
      { path: "App.vue" },
    ], "App.vue")

    expect(results.map((entry) => entry.file.path)).toEqual(["App.vue", "src/components/App.vue"])
  })

  it("returns highlight indices for path subsequence matches", () => {
    const result = scoreFileQuickAccess("src/workbench/editorGroups.ts", "wbed")

    expect(result.score).toBeGreaterThan(0)
    expect(result.indices.map((index) => "src/workbench/editorGroups.ts"[index]).join("").toLowerCase()).toBe("wbed")
  })

  it("normalizes Windows separators before scoring", () => {
    expect(scoreFileQuickAccess("src\\components\\CommandPalette.vue", "components/command").score).toBeGreaterThan(0)
  })
})
