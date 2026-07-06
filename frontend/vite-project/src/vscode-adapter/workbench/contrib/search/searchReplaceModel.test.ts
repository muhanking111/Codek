import { describe, expect, it } from "vitest"
import { applySingleSearchReplacement, createSearchReplacementEdit } from "./searchReplaceModel"

describe("searchReplaceModel", () => {
  it("creates a VS Code-style range edit from the first collapsed occurrence", () => {
    const edit = createSearchReplacementEdit({
      content: "const value = needle + needle\n",
      match: {
        line: 1,
        column: 15,
        matchLength: 6,
        occurrences: [
          { column: 15, matchLength: 6 },
          { column: 24, matchLength: 6 },
        ],
      },
      replaceText: "haystack",
      pattern: /needle/g,
    })

    expect(edit?.range.toString()).toBe("[1,15 -> 1,21]")
    expect(edit?.offsetRange.toString()).toBe("[14, 20)")
    expect(edit?.text).toBe("haystack")
  })

  it("applies a precise single replacement without normalizing CRLF content", () => {
    const next = applySingleSearchReplacement({
      content: "first needle\r\nsecond needle\r\n",
      match: {
        line: 2,
        column: 8,
        matchLength: 6,
        occurrences: [{ column: 8, matchLength: 6 }],
      },
      replaceText: "haystack",
      pattern: /needle/g,
    })

    expect(next).toBe("first needle\r\nsecond haystack\r\n")
  })

  it("falls back to a single line-scoped pattern replacement when precise metadata is missing", () => {
    const next = applySingleSearchReplacement({
      content: "first needle\r\nsecond needle\r\n",
      match: { line: 2 },
      replaceText: "haystack",
      pattern: /needle/g,
    })

    expect(next).toBe("first needle\r\nsecond haystack\r\n")
  })
})
