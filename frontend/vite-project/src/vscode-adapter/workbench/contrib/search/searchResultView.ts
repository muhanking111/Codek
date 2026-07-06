// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\search\browser\searchTreeModel\searchModel.ts
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\search\browser\anythingQuickAccess.ts

import { searchMatchRangeFromLocation, type SearchMatchLocation } from "./searchMatchRange"
import { groupTextSearchMatches, type CodekRawTextMatch } from "./searchModel"

export interface SearchPreviewParts {
  before: string
  hit: string
  after: string
}

export type SearchPanelMatchView<TMatch extends CodekRawTextMatch> = TMatch & {
  previewParts: SearchPreviewParts
}

export function groupSearchPanelMatches<TMatch extends CodekRawTextMatch>(
  matches: readonly TMatch[],
): Array<{ path: string; list: Array<SearchPanelMatchView<TMatch>> }> {
  return groupTextSearchMatches([...matches]).map((group) => ({
    path: group.path,
    list: group.matches.map((match) => ({
      path: group.path,
      line: match.line,
      column: match.column,
      matchLength: match.matchLength,
      preview: match.text,
      previewParts: createSearchPreviewParts(match.text, {
        line: match.line,
        column: match.column,
        matchLength: match.matchLength,
      }),
    } as SearchPanelMatchView<TMatch>)),
  }))
}

export function createSearchPreviewParts(line: string, location: SearchMatchLocation): SearchPreviewParts {
  const range = searchMatchRangeFromLocation(location)
  if (!range) return { before: line, hit: "", after: "" }
  const start = Math.max(0, range.startColumn - 1)
  const end = Math.max(start, range.endColumn - 1)
  return {
    before: line.slice(0, start),
    hit: line.slice(start, end),
    after: line.slice(end),
  }
}
