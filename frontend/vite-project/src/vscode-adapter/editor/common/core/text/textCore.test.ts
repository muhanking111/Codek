import { describe, expect, it } from "vitest"
import { countEOL, StringEOL } from "../misc/eolCounter"
import { Position } from "../position"
import { Range } from "../range"
import { OffsetRange, OffsetRangeSet } from "../ranges/offsetRange"
import { PositionOffsetTransformer } from "./positionToOffset"
import { TextLength } from "./textLength"

describe("VS Code editor text core adapter", () => {
  it("merges offset ranges using VS Code touching semantics", () => {
    const ranges = [new OffsetRange(0, 3), new OffsetRange(8, 10)]

    OffsetRange.addRange(new OffsetRange(3, 8), ranges)

    expect(ranges.map((range) => range.toString())).toEqual(["[0, 10)"])
    expect(new OffsetRange(5, 10).clipCyclic(11)).toBe(6)
    expect(new OffsetRange(5, 10).intersect(new OffsetRange(10, 12))?.toString()).toBe("[10, 10)")
  })

  it("tracks range sets and intersection lengths", () => {
    const set = new OffsetRangeSet()
    set.addRange(new OffsetRange(0, 5))
    set.addRange(new OffsetRange(10, 15))

    expect(set.intersectsStrict(new OffsetRange(5, 10))).toBe(false)
    expect(set.intersectsStrict(new OffsetRange(4, 11))).toBe(true)
    expect(set.intersectWithRangeLength(new OffsetRange(3, 12))).toBe(4)
  })

  it("counts LF, CRLF, and invalid CR endings", () => {
    expect(countEOL("abc")).toEqual([0, 3, 3, StringEOL.Unknown])
    expect(countEOL("a\nbc\r\nd\r")).toEqual([3, 1, 0, StringEOL.Invalid])
  })

  it("computes text lengths and applies them to positions and ranges", () => {
    const length = TextLength.ofText("abc\nde")

    expect(length.toString()).toBe("1,2")
    expect(length.createRange(new Position(2, 4)).toJSON()).toEqual({ startLineNumber: 2, startColumn: 4, endLineNumber: 3, endColumn: 3 })
    expect(TextLength.ofRange(new Range(1, 2, 3, 4)).toString()).toBe("2,3")
  })

  it("converts between VS Code positions and offsets with CRLF-aware line ends", () => {
    const transformer = new PositionOffsetTransformer("one\r\ntwo\nthree")

    expect(transformer.getOffset(new Position(2, 1))).toBe(5)
    expect(transformer.getPosition(9).toJSON()).toEqual({ lineNumber: 3, column: 1 })
    expect(transformer.getOffsetRange(new Range(1, 1, 2, 4)).toString()).toBe("[0, 8)")
    expect(transformer.getRange(new OffsetRange(5, 8)).toJSON()).toEqual({ startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 4 })
    expect(transformer.getLineLength(1)).toBe(3)
    expect(transformer.textLength.toString()).toBe("2,5")
  })
})
