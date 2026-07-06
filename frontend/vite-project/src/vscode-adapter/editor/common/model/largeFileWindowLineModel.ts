/*---------------------------------------------------------------------------------------------
 * VS Code source adapter built on src/vs/editor/common/model/prefixSumComputer.ts.
 * Keeps Codek large-file byte windows on VS Code's indexed line semantics
 * instead of scattering offset/line estimates through workspace code.
 *--------------------------------------------------------------------------------------------*/

import { createLargeTextLineIndex } from "./largeTextLineIndex"

export interface LargeFileWindowLineState {
  readonly offset: number
  readonly bytesRead: number
  readonly windowBytes: number
  readonly virtualStartLine: number
  readonly sourceStartLine: number
  readonly sourceLineAdvance: number
  readonly renderedLineAdvance: number
  readonly renderedLineCount: number
}

export interface LargeFileWindowPreviousLineState {
  readonly offset?: number
  readonly bytesRead?: number
  readonly windowBytes?: number
  readonly virtualStartLine?: number
  readonly sourceStartLine?: number
  readonly sourceLineAdvance?: number
  readonly renderedLineAdvance?: number
  readonly renderedLineCount?: number
}

export interface LargeFileWindowLineStateInput {
  readonly offset?: number
  readonly windowBytes?: number
  readonly bytesRead?: number
  readonly rawContent: string
  readonly renderedContent?: string
  readonly previous?: LargeFileWindowPreviousLineState | null
  readonly fallbackLineWidth?: number
}

export function createLargeFileWindowLineState(input: LargeFileWindowLineStateInput): LargeFileWindowLineState {
  const offset = Math.max(0, Number(input.offset || 0))
  const bytesRead = Math.max(0, Number(input.bytesRead || 0))
  const windowBytes = Math.max(1, Number(input.windowBytes || input.bytesRead || 1))
  const fallbackLineWidth = Math.max(1, Number(input.fallbackLineWidth || 2000))
  const sourceLineAdvance = getLargeFileWindowSourceLineAdvance(input.rawContent)
  const renderedLineCount = getLargeFileWindowRenderedLineCount(input.renderedContent ?? input.rawContent)
  const renderedLineAdvance = getLargeFileWindowRenderedLineAdvance(input.rawContent, fallbackLineWidth)
  return {
    offset,
    bytesRead,
    windowBytes,
    virtualStartLine: resolveLargeFileWindowStartLine({
      offset,
      windowBytes,
      bytesRead,
      currentAdvance: renderedLineAdvance,
      previousAdvance: getPreviousRenderedLineAdvance(input.previous),
      previousStartLine: input.previous?.virtualStartLine,
      previous: input.previous,
      fallbackLineWidth,
    }),
    sourceStartLine: resolveLargeFileWindowStartLine({
      offset,
      windowBytes,
      bytesRead,
      currentAdvance: sourceLineAdvance,
      previousAdvance: getPreviousSourceLineAdvance(input.previous),
      previousStartLine: input.previous?.sourceStartLine,
      previous: input.previous,
      fallbackLineWidth,
    }),
    sourceLineAdvance,
    renderedLineAdvance,
    renderedLineCount,
  }
}

export function getLargeFileWindowSourceLineAdvance(rawContent: string): number {
  const lineCount = createLargeTextLineIndex(normalizeLineBreaks(rawContent)).lineCount
  return Math.max(0, lineCount - 1)
}

export function getLargeFileWindowRenderedLineCount(renderedContent: string): number {
  return createLargeTextLineIndex(normalizeLineBreaks(renderedContent)).lineCount
}

export function getLargeFileWindowRenderedLineAdvance(rawContent: string, fallbackLineWidth = 2000): number {
  const safeLineWidth = Math.max(1, Number(fallbackLineWidth || 2000))
  const value = normalizeLineBreaks(rawContent)
  let advance = 0
  let column = 0
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) {
      advance += 1
      column = 0
      continue
    }
    column += 1
    if (column >= safeLineWidth) {
      advance += 1
      column = 0
    }
  }
  return advance
}

export function estimateLargeFileWindowStartLine(offset: number, fallbackLineWidth = 2000): number {
  const safeOffset = Math.max(0, Number(offset || 0))
  const safeLineWidth = Math.max(1, Number(fallbackLineWidth || 2000))
  return Math.max(1, Math.floor(safeOffset / safeLineWidth) + 1)
}

function resolveLargeFileWindowStartLine(input: {
  readonly offset: number
  readonly windowBytes?: number
  readonly bytesRead?: number
  readonly currentAdvance: number
  readonly previousAdvance: number | null
  readonly previousStartLine?: number
  readonly previous?: LargeFileWindowPreviousLineState | null
  readonly fallbackLineWidth?: number
}): number {
  if (input.offset <= 0) return 1
  const previous = input.previous
  if (!previous) return estimateLargeFileWindowStartLine(input.offset, input.fallbackLineWidth)

  const previousOffset = Math.max(0, Number(previous.offset || 0))
  const previousStartLine = Math.max(1, Number(input.previousStartLine || previous.virtualStartLine || 1))
  const previousSpan = getWindowSpan(previous)
  const currentSpan = Math.max(1, Number(input.windowBytes || input.bytesRead || 1))

  if (input.offset > previousOffset && isAdjacent(previousOffset + previousSpan, input.offset)) {
    const previousAdvance = Math.max(0, Number(input.previousAdvance || 0))
    return Math.max(1, previousStartLine + previousAdvance)
  }

  if (input.offset < previousOffset && isAdjacent(input.offset + currentSpan, previousOffset)) {
    return Math.max(1, previousStartLine - Math.max(0, Number(input.currentAdvance || 0)))
  }

  return estimateLargeFileWindowStartLine(input.offset, input.fallbackLineWidth)
}

function getWindowSpan(state: LargeFileWindowPreviousLineState): number {
  return Math.max(1, Number(state.windowBytes || 0), Number(state.bytesRead || 0))
}

function isAdjacent(expected: number, actual: number): boolean {
  return Math.abs(Math.max(0, expected) - Math.max(0, actual)) <= 1
}

function getPreviousSourceLineAdvance(previous: LargeFileWindowPreviousLineState | null | undefined): number | null {
  if (!previous) return null
  return Math.max(0, Number(previous.sourceLineAdvance || 0))
}

function getPreviousRenderedLineAdvance(previous: LargeFileWindowPreviousLineState | null | undefined): number | null {
  if (!previous) return null
  const explicitAdvance = Number(previous.renderedLineAdvance)
  if (Number.isFinite(explicitAdvance)) return Math.max(0, explicitAdvance)
  if (previous.renderedLineCount !== undefined) {
    const renderedLineCount = Number(previous.renderedLineCount)
    if (Number.isFinite(renderedLineCount)) return Math.max(0, renderedLineCount - 1)
  }
  return Math.max(0, Number(previous.sourceLineAdvance || 0))
}

function normalizeLineBreaks(content: string): string {
  return String(content ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}
