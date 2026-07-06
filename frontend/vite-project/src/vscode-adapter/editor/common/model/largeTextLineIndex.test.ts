import { describe, expect, it } from "vitest"
import { createLargeTextLineIndex } from "./largeTextLineIndex"

describe("LargeTextLineIndex", () => {
  it("uses prefix sums to map offsets to line and column", () => {
    const index = createLargeTextLineIndex("abc\ndef\nxy")

    expect(index.lineCount).toBe(3)
    expect(index.getLineStartOffset(2)).toBe(4)
    expect(index.getLineEndOffset(2)).toBe(8)
    expect(index.getPositionAt(5)).toEqual({ lineNumber: 2, column: 2, offset: 5 })
  })

  it("handles thousands of lines without scanning per lookup", () => {
    const content = Array.from({ length: 2500 }, (_, index) => `line-${index}`).join("\n")
    const lineIndex = createLargeTextLineIndex(content)
    const line2001Start = lineIndex.getLineStartOffset(2001)
    const position = lineIndex.getPositionAt(line2001Start + 3)

    expect(lineIndex.lineCount).toBe(2500)
    expect(position.lineNumber).toBe(2001)
    expect(position.column).toBe(4)
  })
})

