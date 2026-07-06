/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code search replace flow:
 * - D:\SourceMirror\vscode\src\vs\workbench\contrib\search\browser\replaceService.ts
 * - D:\SourceMirror\vscode\src\vs\workbench\contrib\search\browser\searchTreeModel\match.ts
 *--------------------------------------------------------------------------------------------*/

import { Position } from "../../../editor/common/core/position"
import { Range } from "../../../editor/common/core/range"
import { OffsetRange } from "../../../editor/common/core/ranges/offsetRange"
import { PositionOffsetTransformer } from "../../../editor/common/core/text/positionToOffset"
import { searchMatchRangeFromLocation } from "./searchMatchRange"

export interface CodekSearchReplacementMatch {
  line: number
  column?: number
  matchLength?: number
  occurrences?: Array<{ column?: number; matchLength?: number }>
}

export interface SearchReplacementEdit {
  range: Range
  offsetRange: OffsetRange
  text: string
}

export interface SearchReplacementOptions {
  content: string
  match: CodekSearchReplacementMatch
  replaceText: string
  pattern: RegExp
}

export function createSearchReplacementEdit(options: SearchReplacementOptions): SearchReplacementEdit | null {
  const range = preciseRangeFromMatch(options.match) || lineScopedPatternRange(options)
  if (!range) return null
  const transformer = new PositionOffsetTransformer(options.content)
  return {
    range,
    offsetRange: transformer.getOffsetRange(range),
    text: options.replaceText,
  }
}

export function applySingleSearchReplacement(options: SearchReplacementOptions): string {
  const edit = createSearchReplacementEdit(options)
  if (!edit) return options.content
  return `${options.content.slice(0, edit.offsetRange.start)}${edit.text}${options.content.slice(edit.offsetRange.endExclusive)}`
}

function preciseRangeFromMatch(match: CodekSearchReplacementMatch): Range | null {
  const occurrence = Array.isArray(match.occurrences) && match.occurrences.length > 0
    ? match.occurrences[0]
    : null
  return searchMatchRangeFromLocation({
    line: match.line,
    column: occurrence?.column ?? match.column,
    matchLength: occurrence?.matchLength ?? match.matchLength,
  })
}

function lineScopedPatternRange(options: SearchReplacementOptions): Range | null {
  const transformer = new PositionOffsetTransformer(options.content)
  const lineNumber = Math.max(1, Math.trunc(Number(options.match.line) || 1))
  const lineLength = transformer.getLineLength(lineNumber)
  const lineStart = transformer.getOffset(new Position(lineNumber, 1))
  const lineText = options.content.slice(lineStart, lineStart + lineLength)
  const singlePattern = new RegExp(options.pattern.source, options.pattern.flags.replace(/g/g, ""))
  const match = singlePattern.exec(lineText)
  if (!match) return null
  const startColumn = match.index + 1
  return new Range(lineNumber, startColumn, lineNumber, startColumn + match[0].length)
}
