import { describe, expect, it } from "vitest"
import { Position } from "./position"
import { Range } from "./range"
import { Selection, SelectionDirection } from "./selection"

describe("VS Code editor/common/core adapter", () => {
  it("orders and compares positions with one-based editor coordinates", () => {
    const position = new Position(10, 4)

    expect(position.delta(-20, -20).toJSON()).toEqual({ lineNumber: 1, column: 1 })
    expect(Position.isBefore(new Position(2, 1), new Position(2, 2))).toBe(true)
    expect(Position.compare(new Position(3, 1), new Position(2, 99))).toBeGreaterThan(0)
    expect(Position.lift({ lineNumber: 7, column: 3 }).toString()).toBe("(7,3)")
  })

  it("normalizes reversed ranges and keeps containment semantics", () => {
    const range = new Range(5, 10, 3, 2)

    expect(range.toJSON()).toEqual({ startLineNumber: 3, startColumn: 2, endLineNumber: 5, endColumn: 10 })
    expect(range.containsPosition(new Position(4, 1))).toBe(true)
    expect(range.containsPosition(new Position(5, 11))).toBe(false)
    expect(range.intersectRanges(new Range(4, 1, 6, 1))?.toJSON()).toEqual({
      startLineNumber: 4,
      startColumn: 1,
      endLineNumber: 5,
      endColumn: 10,
    })
  })

  it("combines, collapses, and sorts ranges like VS Code", () => {
    const first = new Range(2, 3, 4, 5)
    const second = new Range(1, 9, 2, 4)

    expect(first.plusRange(second).toJSON()).toEqual({ startLineNumber: 1, startColumn: 9, endLineNumber: 4, endColumn: 5 })
    expect(first.collapseToStart().isEmpty()).toBe(true)
    expect(Range.compareRangesUsingStarts(first, second)).toBeGreaterThan(0)
    expect(Range.areIntersecting(new Range(1, 1, 1, 2), new Range(1, 2, 1, 3))).toBe(false)
    expect(Range.areIntersectingOrTouching(new Range(1, 1, 1, 2), new Range(1, 2, 1, 3))).toBe(true)
  })

  it("preserves selection direction separately from normalized range", () => {
    const rtl = new Selection(5, 8, 3, 2)
    const ltr = Selection.fromRange(new Range(1, 1, 1, 5), SelectionDirection.LTR)

    expect(rtl.startLineNumber).toBe(3)
    expect(rtl.selectionStartLineNumber).toBe(5)
    expect(rtl.positionLineNumber).toBe(3)
    expect(rtl.getDirection()).toBe(SelectionDirection.RTL)
    expect(rtl.setEndPosition(2, 1).toString()).toBe("[2,1 -> 3,2]")
    expect(ltr.getDirection()).toBe(SelectionDirection.LTR)
    expect(Selection.selectionsArrEqual([ltr], [Selection.liftSelection(ltr)])).toBe(true)
  })
})
