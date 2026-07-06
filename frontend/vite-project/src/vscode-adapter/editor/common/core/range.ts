/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/editor/common/core/range.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { type IPosition, Position } from "./position"

export interface IRange {
  readonly startLineNumber: number
  readonly startColumn: number
  readonly endLineNumber: number
  readonly endColumn: number
}

export class Range implements IRange {
  readonly startLineNumber: number
  readonly startColumn: number
  readonly endLineNumber: number
  readonly endColumn: number

  constructor(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) {
    if (startLineNumber > endLineNumber || (startLineNumber === endLineNumber && startColumn > endColumn)) {
      this.startLineNumber = endLineNumber
      this.startColumn = endColumn
      this.endLineNumber = startLineNumber
      this.endColumn = startColumn
    } else {
      this.startLineNumber = startLineNumber
      this.startColumn = startColumn
      this.endLineNumber = endLineNumber
      this.endColumn = endColumn
    }
  }

  isEmpty(): boolean {
    return Range.isEmpty(this)
  }

  static isEmpty(range: IRange): boolean {
    return range.startLineNumber === range.endLineNumber && range.startColumn === range.endColumn
  }

  containsPosition(position: IPosition): boolean {
    return Range.containsPosition(this, position)
  }

  static containsPosition(range: IRange, position: IPosition): boolean {
    if (position.lineNumber < range.startLineNumber || position.lineNumber > range.endLineNumber) return false
    if (position.lineNumber === range.startLineNumber && position.column < range.startColumn) return false
    if (position.lineNumber === range.endLineNumber && position.column > range.endColumn) return false
    return true
  }

  static strictContainsPosition(range: IRange, position: IPosition): boolean {
    if (position.lineNumber < range.startLineNumber || position.lineNumber > range.endLineNumber) return false
    if (position.lineNumber === range.startLineNumber && position.column <= range.startColumn) return false
    if (position.lineNumber === range.endLineNumber && position.column >= range.endColumn) return false
    return true
  }

  containsRange(range: IRange): boolean {
    return Range.containsRange(this, range)
  }

  static containsRange(range: IRange, otherRange: IRange): boolean {
    if (otherRange.startLineNumber < range.startLineNumber || otherRange.endLineNumber < range.startLineNumber) return false
    if (otherRange.startLineNumber > range.endLineNumber || otherRange.endLineNumber > range.endLineNumber) return false
    if (otherRange.startLineNumber === range.startLineNumber && otherRange.startColumn < range.startColumn) return false
    if (otherRange.endLineNumber === range.endLineNumber && otherRange.endColumn > range.endColumn) return false
    return true
  }

  strictContainsRange(range: IRange): boolean {
    return Range.strictContainsRange(this, range)
  }

  static strictContainsRange(range: IRange, otherRange: IRange): boolean {
    return Range.containsRange(range, otherRange) && !Range.equalsRange(range, otherRange)
  }

  plusRange(range: IRange): Range {
    return Range.plusRange(this, range)
  }

  static plusRange(a: IRange, b: IRange): Range {
    const start =
      b.startLineNumber < a.startLineNumber || (b.startLineNumber === a.startLineNumber && b.startColumn < a.startColumn)
        ? { lineNumber: b.startLineNumber, column: b.startColumn }
        : { lineNumber: a.startLineNumber, column: a.startColumn }
    const end =
      b.endLineNumber > a.endLineNumber || (b.endLineNumber === a.endLineNumber && b.endColumn > a.endColumn)
        ? { lineNumber: b.endLineNumber, column: b.endColumn }
        : { lineNumber: a.endLineNumber, column: a.endColumn }
    return new Range(start.lineNumber, start.column, end.lineNumber, end.column)
  }

  intersectRanges(range: IRange): Range | null {
    return Range.intersectRanges(this, range)
  }

  static intersectRanges(a: IRange, b: IRange): Range | null {
    const startLineNumber = Math.max(a.startLineNumber, b.startLineNumber)
    const endLineNumber = Math.min(a.endLineNumber, b.endLineNumber)
    const startColumn =
      a.startLineNumber === b.startLineNumber ? Math.max(a.startColumn, b.startColumn) : startLineNumber === a.startLineNumber ? a.startColumn : b.startColumn
    const endColumn =
      a.endLineNumber === b.endLineNumber ? Math.min(a.endColumn, b.endColumn) : endLineNumber === a.endLineNumber ? a.endColumn : b.endColumn
    if (startLineNumber > endLineNumber || (startLineNumber === endLineNumber && startColumn > endColumn)) return null
    return new Range(startLineNumber, startColumn, endLineNumber, endColumn)
  }

  equalsRange(other: IRange | null | undefined): boolean {
    return Range.equalsRange(this, other)
  }

  static equalsRange(a: IRange | null | undefined, b: IRange | null | undefined): boolean {
    if (!a && !b) return true
    return Boolean(
      a &&
      b &&
      a.startLineNumber === b.startLineNumber &&
      a.startColumn === b.startColumn &&
      a.endLineNumber === b.endLineNumber &&
      a.endColumn === b.endColumn,
    )
  }

  getEndPosition(): Position {
    return Range.getEndPosition(this)
  }

  static getEndPosition(range: IRange): Position {
    return new Position(range.endLineNumber, range.endColumn)
  }

  getStartPosition(): Position {
    return Range.getStartPosition(this)
  }

  static getStartPosition(range: IRange): Position {
    return new Position(range.startLineNumber, range.startColumn)
  }

  toString(): string {
    return `[${this.startLineNumber},${this.startColumn} -> ${this.endLineNumber},${this.endColumn}]`
  }

  setEndPosition(endLineNumber: number, endColumn: number): Range {
    return new Range(this.startLineNumber, this.startColumn, endLineNumber, endColumn)
  }

  setStartPosition(startLineNumber: number, startColumn: number): Range {
    return new Range(startLineNumber, startColumn, this.endLineNumber, this.endColumn)
  }

  collapseToStart(): Range {
    return Range.collapseToStart(this)
  }

  static collapseToStart(range: IRange): Range {
    return new Range(range.startLineNumber, range.startColumn, range.startLineNumber, range.startColumn)
  }

  collapseToEnd(): Range {
    return Range.collapseToEnd(this)
  }

  static collapseToEnd(range: IRange): Range {
    return new Range(range.endLineNumber, range.endColumn, range.endLineNumber, range.endColumn)
  }

  delta(lineCount: number): Range {
    return new Range(this.startLineNumber + lineCount, this.startColumn, this.endLineNumber + lineCount, this.endColumn)
  }

  isSingleLine(): boolean {
    return this.startLineNumber === this.endLineNumber
  }

  static fromPositions(start: IPosition, end: IPosition = start): Range {
    return new Range(start.lineNumber, start.column, end.lineNumber, end.column)
  }

  static lift(range: undefined | null): null
  static lift(range: IRange): Range
  static lift(range: IRange | undefined | null): Range | null
  static lift(range: IRange | undefined | null): Range | null {
    return range ? new Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn) : null
  }

  static isIRange(value: unknown): value is IRange {
    const candidate = value as IRange | null
    return Boolean(
      candidate &&
      typeof candidate.startLineNumber === "number" &&
      typeof candidate.startColumn === "number" &&
      typeof candidate.endLineNumber === "number" &&
      typeof candidate.endColumn === "number",
    )
  }

  static areIntersectingOrTouching(a: IRange, b: IRange): boolean {
    if (a.endLineNumber < b.startLineNumber || (a.endLineNumber === b.startLineNumber && a.endColumn < b.startColumn)) return false
    if (b.endLineNumber < a.startLineNumber || (b.endLineNumber === a.startLineNumber && b.endColumn < a.startColumn)) return false
    return true
  }

  static areIntersecting(a: IRange, b: IRange): boolean {
    if (a.endLineNumber < b.startLineNumber || (a.endLineNumber === b.startLineNumber && a.endColumn <= b.startColumn)) return false
    if (b.endLineNumber < a.startLineNumber || (b.endLineNumber === a.startLineNumber && b.endColumn <= a.startColumn)) return false
    return true
  }

  static compareRangesUsingStarts(a: IRange | null | undefined, b: IRange | null | undefined): number {
    if (a && b) {
      const start = Position.compare({ lineNumber: a.startLineNumber, column: a.startColumn }, { lineNumber: b.startLineNumber, column: b.startColumn })
      if (start !== 0) return start
      return Position.compare({ lineNumber: a.endLineNumber, column: a.endColumn }, { lineNumber: b.endLineNumber, column: b.endColumn })
    }
    return (a ? 1 : 0) - (b ? 1 : 0)
  }

  static compareRangesUsingEnds(a: IRange, b: IRange): number {
    const end = Position.compare({ lineNumber: a.endLineNumber, column: a.endColumn }, { lineNumber: b.endLineNumber, column: b.endColumn })
    if (end !== 0) return end
    return Position.compare({ lineNumber: a.startLineNumber, column: a.startColumn }, { lineNumber: b.startLineNumber, column: b.startColumn })
  }

  static spansMultipleLines(range: IRange): boolean {
    return range.endLineNumber > range.startLineNumber
  }

  toJSON(): IRange {
    return this
  }
}
