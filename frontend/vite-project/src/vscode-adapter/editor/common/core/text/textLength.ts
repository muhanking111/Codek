/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/editor/common/core/text/textLength.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Position } from "../position"
import { Range } from "../range"
import { OffsetRange } from "../ranges/offsetRange"

export class TextLength {
  static zero = new TextLength(0, 0)

  static lengthDiffNonNegative(start: TextLength, end: TextLength): TextLength {
    if (end.isLessThan(start)) return TextLength.zero
    if (start.lineCount === end.lineCount) return new TextLength(0, end.columnCount - start.columnCount)
    return new TextLength(end.lineCount - start.lineCount, end.columnCount)
  }

  static betweenPositions(first: Position, second: Position): TextLength {
    if (first.lineNumber === second.lineNumber) return new TextLength(0, second.column - first.column)
    return new TextLength(second.lineNumber - first.lineNumber, second.column - 1)
  }

  static fromPosition(position: Position): TextLength {
    return new TextLength(position.lineNumber - 1, position.column - 1)
  }

  static ofRange(range: Range): TextLength {
    return TextLength.betweenPositions(range.getStartPosition(), range.getEndPosition())
  }

  static ofText(text: string): TextLength {
    let line = 0
    let column = 0
    for (const char of text) {
      if (char === "\n") {
        line += 1
        column = 0
      } else {
        column += 1
      }
    }
    return new TextLength(line, column)
  }

  static ofSubstr(value: string, range: OffsetRange): TextLength {
    return TextLength.ofText(range.substring(value))
  }

  static sum<T>(fragments: readonly T[], getLength: (fragment: T) => TextLength): TextLength {
    return fragments.reduce((accumulator, fragment) => accumulator.add(getLength(fragment)), TextLength.zero)
  }

  constructor(readonly lineCount: number, readonly columnCount: number) {}

  isZero(): boolean {
    return this.lineCount === 0 && this.columnCount === 0
  }

  isLessThan(other: TextLength): boolean {
    return this.lineCount !== other.lineCount ? this.lineCount < other.lineCount : this.columnCount < other.columnCount
  }

  isGreaterThan(other: TextLength): boolean {
    return this.lineCount !== other.lineCount ? this.lineCount > other.lineCount : this.columnCount > other.columnCount
  }

  isGreaterThanOrEqualTo(other: TextLength): boolean {
    return this.lineCount !== other.lineCount ? this.lineCount > other.lineCount : this.columnCount >= other.columnCount
  }

  equals(other: TextLength): boolean {
    return this.lineCount === other.lineCount && this.columnCount === other.columnCount
  }

  compare(other: TextLength): number {
    return this.lineCount !== other.lineCount ? this.lineCount - other.lineCount : this.columnCount - other.columnCount
  }

  add(other: TextLength): TextLength {
    if (other.lineCount === 0) return new TextLength(this.lineCount, this.columnCount + other.columnCount)
    return new TextLength(this.lineCount + other.lineCount, other.columnCount)
  }

  createRange(startPosition: Position): Range {
    if (this.lineCount === 0) {
      return new Range(startPosition.lineNumber, startPosition.column, startPosition.lineNumber, startPosition.column + this.columnCount)
    }
    return new Range(startPosition.lineNumber, startPosition.column, startPosition.lineNumber + this.lineCount, this.columnCount + 1)
  }

  toRange(): Range {
    return new Range(1, 1, this.lineCount + 1, this.columnCount + 1)
  }

  addToPosition(position: Position): Position {
    if (this.lineCount === 0) return new Position(position.lineNumber, position.column + this.columnCount)
    return new Position(position.lineNumber + this.lineCount, this.columnCount + 1)
  }

  addToRange(range: Range): Range {
    return Range.fromPositions(this.addToPosition(range.getStartPosition()), this.addToPosition(range.getEndPosition()))
  }

  toString(): string {
    return `${this.lineCount},${this.columnCount}`
  }
}
