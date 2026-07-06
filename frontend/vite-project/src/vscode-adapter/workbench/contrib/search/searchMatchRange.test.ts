import { describe, expect, it } from "vitest"
import { areSearchRangesEqual, normalizeSearchSelectionRange, searchMatchRangeFromLocation } from "./searchMatchRange"

describe("VS Code search match range adapter", () => {
  it("creates one-based editor ranges from search match locations", () => {
    expect(searchMatchRangeFromLocation({ line: 7, column: 3, matchLength: 5 })?.toJSON()).toEqual({
      startLineNumber: 7,
      startColumn: 3,
      endLineNumber: 7,
      endColumn: 8,
    })
    expect(searchMatchRangeFromLocation({ line: 7, column: 3, matchLength: 0 })).toBeNull()
  })

  it("normalizes Monaco selection objects through VS Code Range semantics", () => {
    expect(normalizeSearchSelectionRange({ startLineNumber: 4, startColumn: 9, endLineNumber: 2, endColumn: 1 })?.toJSON()).toEqual({
      startLineNumber: 2,
      startColumn: 1,
      endLineNumber: 4,
      endColumn: 9,
    })
    expect(normalizeSearchSelectionRange({ selectionStartLineNumber: 9, selectionStartColumn: 5, positionLineNumber: 9, positionColumn: 2 })?.toJSON()).toEqual({
      startLineNumber: 9,
      startColumn: 2,
      endLineNumber: 9,
      endColumn: 5,
    })
  })

  it("compares normalized search ranges", () => {
    const expected = searchMatchRangeFromLocation({ line: 3, column: 4, matchLength: 2 })
    const selection = normalizeSearchSelectionRange({ startLineNumber: 3, startColumn: 6, endLineNumber: 3, endColumn: 4 })

    expect(areSearchRangesEqual(selection, expected)).toBe(true)
  })
})
