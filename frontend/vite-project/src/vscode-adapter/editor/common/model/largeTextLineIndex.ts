/*---------------------------------------------------------------------------------------------
 * VS Code source adapter built on src/vs/editor/common/model/prefixSumComputer.ts.
 * Provides Codek large-file line/offset indexing without reintroducing custom
 * prefix-sum logic in workspace large-file modules.
 *--------------------------------------------------------------------------------------------*/

import { PrefixSumComputer } from "./prefixSumComputer"

export interface LargeTextLinePosition {
  readonly lineNumber: number
  readonly column: number
  readonly offset: number
}

export class LargeTextLineIndex {
  private readonly lineLengths: Uint32Array
  private readonly prefixSums: PrefixSumComputer

  constructor(content: string) {
    const lengths: number[] = []
    let currentLength = 0
    for (let index = 0; index < content.length; index += 1) {
      currentLength += 1
      if (content.charCodeAt(index) === 10) {
        lengths.push(currentLength)
        currentLength = 0
      }
    }
    lengths.push(currentLength)
    this.lineLengths = new Uint32Array(lengths)
    this.prefixSums = new PrefixSumComputer(this.lineLengths)
  }

  get lineCount(): number {
    return this.lineLengths.length
  }

  getTotalLength(): number {
    return this.prefixSums.getTotalSum()
  }

  getLineStartOffset(lineNumber: number): number {
    const index = clampLineIndex(lineNumber, this.lineCount)
    if (index <= 0) return 0
    return this.prefixSums.getPrefixSum(index - 1)
  }

  getLineEndOffset(lineNumber: number): number {
    const index = clampLineIndex(lineNumber, this.lineCount)
    return this.prefixSums.getPrefixSum(index)
  }

  getPositionAt(offset: number): LargeTextLinePosition {
    const safeOffset = Math.max(0, Math.min(Math.floor(offset), this.getTotalLength()))
    const result = this.prefixSums.getIndexOf(safeOffset)
    return {
      lineNumber: result.index + 1,
      column: result.remainder + 1,
      offset: safeOffset,
    }
  }
}

export function createLargeTextLineIndex(content: string): LargeTextLineIndex {
  return new LargeTextLineIndex(String(content ?? ""))
}

function clampLineIndex(lineNumber: number, lineCount: number): number {
  return Math.max(0, Math.min(Math.floor(lineNumber || 1) - 1, Math.max(0, lineCount - 1)))
}

