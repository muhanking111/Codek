import { Range, type IRange } from "../../../editor/common/core/range"

// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\search\browser\searchTreeModel\searchModel.ts
// - D:\SourceMirror\vscode\src\vs\editor\common\core\range.ts
//
// Search matches are editor ranges. Keep Codek's search service and UI data
// shape, but normalize match locations through the migrated VS Code Range
// semantics so SearchPanel, navigation and selection verification do not each
// maintain their own range math.

export interface SearchMatchLocation {
  line: number
  column?: number
  matchLength?: number
}

export interface SearchSelectionLike {
  startLineNumber?: number
  startColumn?: number
  endLineNumber?: number
  endColumn?: number
  selectionStartLineNumber?: number
  selectionStartColumn?: number
  positionLineNumber?: number
  positionColumn?: number
}

export function searchMatchRangeFromLocation(location: SearchMatchLocation): Range | null {
  const line = normalizePositiveInteger(location.line, 1)
  const column = normalizePositiveInteger(location.column, 1)
  const matchLength = normalizeNonNegativeInteger(location.matchLength, 0)
  if (!matchLength) return null
  return new Range(line, column, line, column + matchLength)
}

export function normalizeSearchSelectionRange(selection: SearchSelectionLike | null | undefined): Range | null {
  if (!selection) return null
  return rangeFromNumbers(selection.startLineNumber, selection.startColumn, selection.endLineNumber, selection.endColumn)
    || rangeFromNumbers(
      selection.selectionStartLineNumber,
      selection.selectionStartColumn,
      selection.positionLineNumber,
      selection.positionColumn,
    )
}

export function areSearchRangesEqual(a: IRange | null | undefined, b: IRange | null | undefined): boolean {
  return Boolean(a && b && Range.equalsRange(a, b))
}

function rangeFromNumbers(
  startLineNumber: unknown,
  startColumn: unknown,
  endLineNumber: unknown,
  endColumn: unknown,
): Range | null {
  const startLine = Number(startLineNumber)
  const startCol = Number(startColumn)
  const endLine = Number(endLineNumber)
  const endCol = Number(endColumn)
  if (![startLine, startCol, endLine, endCol].every(Number.isFinite)) return null
  return new Range(startLine, startCol, endLine, endCol)
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const numeric = Math.trunc(Number(value))
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  const numeric = Math.trunc(Number(value))
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback
}
