import { describe, expect, it } from "vitest"
import { groupTextSearchMatches, groupTextSearchMatchesFromContent } from "./searchModel"

describe("VS Code search model adapter", () => {
  it("groups service matches by file and collapses same-line occurrences", () => {
    expect(groupTextSearchMatches([
      { path: "src/a.ts", line: 3, column: 5, matchLength: 4, preview: "const mark = mark" },
      { path: "src/a.ts", line: 3, column: 14, matchLength: 4, preview: "const mark = mark" },
      { path: "src/b.ts", line: 1, column: 1, matchLength: 4, preview: "mark" },
    ])).toEqual([
      {
        path: "src/a.ts",
        matches: [{
          id: "src/a.ts:3:5:4:0",
          line: 3,
          text: "const mark = mark",
          column: 5,
          matchLength: 4,
          count: 2,
          occurrences: [
            { column: 5, matchLength: 4 },
            { column: 14, matchLength: 4 },
          ],
        }],
      },
      {
        path: "src/b.ts",
        matches: [{
          id: "src/b.ts:1:1:4:0",
          line: 1,
          text: "mark",
          column: 1,
          matchLength: 4,
          count: 1,
          occurrences: [{ column: 1, matchLength: 4 }],
        }],
      },
    ])
  })

  it("preserves service-provided occurrences and file content", () => {
    expect(groupTextSearchMatches([
      {
        path: "src/a.ts",
        line: 2,
        column: 1,
        matchLength: 5,
        preview: "token token",
        occurrences: [{ column: 1, matchLength: 5 }, { column: 7, matchLength: 5 }],
      },
    ], { fileContents: { "src/a.ts": "token token" } })).toEqual([
      {
        path: "src/a.ts",
        content: "token token",
        matches: [{
          id: "src/a.ts:2:1:5:0",
          line: 2,
          text: "token token",
          column: 1,
          matchLength: 5,
          count: 2,
          occurrences: [{ column: 1, matchLength: 5 }, { column: 7, matchLength: 5 }],
        }],
      },
    ])
  })

  it("builds grouped matches from cached file contents", () => {
    const pattern = /json/gi
    expect(groupTextSearchMatchesFromContent({
      "settings.json": "{\n  \"jsonNeedle\": \"json value\"\n}",
      "ignored.ts": "json",
    }, pattern, (path) => path.endsWith(".json"))).toEqual([
      {
        path: "settings.json",
        matches: [{
          id: "settings.json:2:4:4:0",
          line: 2,
          text: "\"jsonNeedle\": \"json value\"",
          column: 4,
          matchLength: 4,
          count: 2,
          occurrences: [{ column: 4, matchLength: 4 }, { column: 18, matchLength: 4 }],
        }],
      },
    ])
  })
  it("orders search result files and matches with VS Code-style resource comparers", () => {
    expect(groupTextSearchMatches([
      { path: "src/file10.ts", line: 9, column: 4, matchLength: 6, preview: "late needle" },
      { path: "src/file2.ts", line: 7, column: 3, matchLength: 6, preview: "second needle" },
      { path: "src/file2.ts", line: 2, column: 8, matchLength: 6, preview: "first needle" },
      { path: "README.md", line: 1, column: 1, matchLength: 6, preview: "needle" },
      { path: "src\\alpha.ts", line: 1, column: 2, matchLength: 6, preview: " needle" },
    ])).toEqual([
      {
        path: "README.md",
        matches: [{
          id: "README.md:1:1:6:0",
          line: 1,
          text: "needle",
          column: 1,
          matchLength: 6,
          count: 1,
          occurrences: [{ column: 1, matchLength: 6 }],
        }],
      },
      {
        path: "src\\alpha.ts",
        matches: [{
          id: "src\\alpha.ts:1:2:6:0",
          line: 1,
          text: "needle",
          column: 2,
          matchLength: 6,
          count: 1,
          occurrences: [{ column: 2, matchLength: 6 }],
        }],
      },
      {
        path: "src/file2.ts",
        matches: [
          {
            id: "src/file2.ts:2:8:6:1",
            line: 2,
            text: "first needle",
            column: 8,
            matchLength: 6,
            count: 1,
            occurrences: [{ column: 8, matchLength: 6 }],
          },
          {
            id: "src/file2.ts:7:3:6:0",
            line: 7,
            text: "second needle",
            column: 3,
            matchLength: 6,
            count: 1,
            occurrences: [{ column: 3, matchLength: 6 }],
          },
        ],
      },
      {
        path: "src/file10.ts",
        matches: [{
          id: "src/file10.ts:9:4:6:0",
          line: 9,
          text: "late needle",
          column: 4,
          matchLength: 6,
          count: 1,
          occurrences: [{ column: 4, matchLength: 6 }],
        }],
      },
    ])
  })
})
