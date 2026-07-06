/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/editor/common/core/text/positionToOffsetImpl.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Position } from "../position"
import { Range } from "../range"
import { OffsetRange } from "../ranges/offsetRange"
import { TextLength } from "./textLength"

export abstract class PositionOffsetTransformerBase {
  abstract getOffset(position: Position): number

  getOffsetRange(range: Range): OffsetRange {
    return new OffsetRange(this.getOffset(range.getStartPosition()), this.getOffset(range.getEndPosition()))
  }

  abstract getPosition(offset: number): Position

  getRange(offsetRange: OffsetRange): Range {
    return Range.fromPositions(this.getPosition(offsetRange.start), this.getPosition(offsetRange.endExclusive))
  }
}

function findLastIndexLessThanOrEqual(values: readonly number[], offset: number): number {
  let low = 0
  let high = values.length - 1
  let result = 0
  while (low <= high) {
    const middle = (low + high) >> 1
    if (values[middle] <= offset) {
      result = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return result
}

export class PositionOffsetTransformer extends PositionOffsetTransformerBase {
  private lineStartOffsets: number[] | undefined
  private lineEndOffsets: number[] | undefined

  constructor(readonly text: string) {
    super()
  }

  private ensureLineOffsets(): void {
    if (this.lineStartOffsets && this.lineEndOffsets) return
    const starts = [0]
    const ends: number[] = []
    for (let index = 0; index < this.text.length; index += 1) {
      if (this.text.charAt(index) === "\n") {
        starts.push(index + 1)
        ends.push(index > 0 && this.text.charAt(index - 1) === "\r" ? index - 1 : index)
      }
    }
    ends.push(this.text.length)
    this.lineStartOffsets = starts
    this.lineEndOffsets = ends
  }

  private get starts(): number[] {
    this.ensureLineOffsets()
    return this.lineStartOffsets!
  }

  private get ends(): number[] {
    this.ensureLineOffsets()
    return this.lineEndOffsets!
  }

  override getOffset(position: Position): number {
    const valid = this.validatePosition(position)
    return this.starts[valid.lineNumber - 1] + valid.column - 1
  }

  private validatePosition(position: Position): Position {
    if (position.lineNumber < 1) return new Position(1, 1)
    const lineCount = this.textLength.lineCount + 1
    if (position.lineNumber > lineCount) {
      const lineLength = this.getLineLength(lineCount)
      return new Position(lineCount, lineLength + 1)
    }
    if (position.column < 1) return new Position(position.lineNumber, 1)
    const lineLength = this.getLineLength(position.lineNumber)
    if (position.column - 1 > lineLength) return new Position(position.lineNumber, lineLength + 1)
    return position
  }

  override getPosition(offset: number): Position {
    const safeOffset = Math.max(0, Math.min(offset, this.text.length))
    const index = findLastIndexLessThanOrEqual(this.starts, safeOffset)
    return new Position(index + 1, safeOffset - this.starts[index] + 1)
  }

  getTextLength(offsetRange: OffsetRange): TextLength {
    return TextLength.ofRange(this.getRange(offsetRange))
  }

  get textLength(): TextLength {
    const lastLineIndex = this.starts.length - 1
    return new TextLength(lastLineIndex, this.text.length - this.starts[lastLineIndex])
  }

  getLineLength(lineNumber: number): number {
    const index = Math.max(0, Math.min(lineNumber - 1, this.ends.length - 1))
    return this.ends[index] - this.starts[index]
  }
}
