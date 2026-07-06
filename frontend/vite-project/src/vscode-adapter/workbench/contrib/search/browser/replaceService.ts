/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code search replace service shape:
 * - src/vs/workbench/contrib/search/browser/replaceService.ts
 * - src/vs/editor/browser/services/bulkEditService.ts
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, type CancellationToken as CancellationTokenShape } from "../../../../base/common/cancellation"
import { Position } from "../../../../editor/common/core/position"
import type { Range } from "../../../../editor/common/core/range"
import { PositionOffsetTransformer } from "../../../../editor/common/core/text/positionToOffset"
import { createDecorator } from "../../../../platform/instantiation/common/instantiation"
import { InstantiationType, registerSingleton } from "../../../../platform/instantiation/common/extensions"
import {
  CodekBulkEditService,
  type BulkEditOptions,
  type BulkEditResult,
  type IBulkEditService,
  type ResourceTextEdit,
} from "../../../services/bulkEdit/common/bulkEditService"
import {
  createSearchReplacementEdit,
  type CodekSearchReplacementMatch,
} from "../searchReplaceModel"
import { searchMatchRangeFromLocation } from "../searchMatchRange"

export interface IReplaceService {
  readonly _serviceBrand: undefined
  replaceOne(request: CodekReplaceRequest, token?: CancellationTokenShape): Promise<BulkEditResult>
  replaceAll(request: CodekReplaceRequest, token?: CancellationTokenShape): Promise<BulkEditResult>
}

export interface CodekReplaceFileGroup {
  readonly path: string
  readonly matches: readonly CodekSearchReplacementMatch[]
}

export interface CodekReplaceRequest {
  readonly pattern: RegExp
  readonly replaceText: string
  readonly matches: readonly CodekReplaceFileGroup[]
  readonly dryRun?: boolean
  readonly saveOptions?: Record<string, unknown>
}

export const IReplaceService = createDecorator<IReplaceService>("replaceService")

export class CodekReplaceService implements IReplaceService {
  declare readonly _serviceBrand: undefined

  constructor(
    private readonly options: {
      readonly bulkEditService: IBulkEditService
      readonly readFile?: (path: string) => Promise<string | null | undefined> | string | null | undefined
    } = { bulkEditService: new CodekBulkEditService() },
  ) {}

  async replaceOne(request: CodekReplaceRequest, token: CancellationTokenShape = CancellationToken.None): Promise<BulkEditResult> {
    const firstGroup = request.matches.find((group) => group.matches.length > 0)
    const firstMatch = firstGroup?.matches[0]
    const edits = firstGroup && firstMatch ? await this.createEditsForMatches(firstGroup.path, [firstMatch], request, true) : []
    return this.applyEditsOrSkip(edits, request, token, firstGroup?.path)
  }

  async replaceAll(request: CodekReplaceRequest, token: CancellationTokenShape = CancellationToken.None): Promise<BulkEditResult> {
    const editGroups = await Promise.all(
      request.matches.map((group) => this.createEditsForMatches(group.path, group.matches, request, false)),
    )
    return this.applyEditsOrSkip(editGroups.flat(), request, token)
  }

  private async createEditsForMatches(
    resource: string,
    matches: readonly CodekSearchReplacementMatch[],
    request: CodekReplaceRequest,
    firstOnly: boolean,
  ): Promise<ResourceTextEdit[]> {
    const edits: ResourceTextEdit[] = []
    const sourceMatches = firstOnly ? matches.slice(0, 1) : matches
    for (const match of sourceMatches) {
      const occurrenceRanges = replacementRangesForMatch(match, firstOnly)
      for (const range of occurrenceRanges) {
        edits.push({
          resource,
          range,
          text: request.replaceText,
          metadata: { source: "searchReplace", line: match.line },
        })
      }
      if (shouldReadLinePattern(match, occurrenceRanges, firstOnly)) {
        const content = await this.options.readFile?.(resource)
        if (typeof content === "string") {
          const ranges = linePatternRanges(content, match.line, request.pattern)
          const selectedRanges = firstOnly ? ranges.slice(0, 1) : ranges
          for (const range of selectedRanges) {
            edits.push({
              resource,
              range,
              text: request.replaceText,
              metadata: { source: "searchReplacePattern", line: match.line },
            })
          }
        }
      }
    }
    if (edits.length > 0) return dedupeEdits(edits)

    return sourceMatches.map((match) => ({
      resource,
      match,
    })).flatMap(({ match }) => {
      const edit = createSearchReplacementEdit({
        content: "",
        match,
        replaceText: request.replaceText,
        pattern: request.pattern,
      })
      return edit ? [{
        resource,
        range: edit.range,
        text: request.replaceText,
        metadata: { source: "searchReplace", line: match.line },
      }] : []
    })
  }

  private async applyEditsOrSkip(
    edits: ResourceTextEdit[],
    request: CodekReplaceRequest,
    token: CancellationTokenShape,
    skippedPath?: string,
  ): Promise<BulkEditResult> {
    if (!edits.length) {
      return {
        applied: false,
        dryRun: request.dryRun === true,
        summary: {
          fileCount: skippedPath ? 1 : 0,
          editCount: 0,
          changedFileCount: 0,
          skippedFileCount: skippedPath ? 1 : 0,
          failureCount: 0,
          changedFiles: [],
          skippedFiles: skippedPath ? [skippedPath] : [],
          failures: [],
          riskLevel: "safe",
          rollbackDescription: "没有写入工作区；无需回滚。",
        },
      }
    }
    const options: BulkEditOptions = {
      dryRun: request.dryRun === true,
      label: "search replace",
      source: "user",
      reason: "search replace",
      saveOptions: {
        source: "user",
        reason: "search replace",
        ...(request.saveOptions || {}),
      },
    }
    return this.options.bulkEditService.apply({ edits }, options, token)
  }
}

export const globalReplaceService = new CodekReplaceService()
registerSingleton(IReplaceService, globalReplaceService, InstantiationType.Delayed)

function replacementRangesForMatch(match: CodekSearchReplacementMatch, firstOnly: boolean): Range[] {
  const occurrences = Array.isArray(match.occurrences) && match.occurrences.length
    ? match.occurrences
    : [{ column: match.column, matchLength: match.matchLength }]
  const selected = firstOnly ? occurrences.slice(0, 1) : occurrences
  return selected
    .map((occurrence) => searchMatchRangeFromLocation({
      line: match.line,
      column: occurrence.column,
      matchLength: occurrence.matchLength,
    }))
    .filter((range): range is Range => Boolean(range))
}

function shouldReadLinePattern(
  match: CodekSearchReplacementMatch,
  occurrenceRanges: readonly Range[],
  firstOnly: boolean,
): boolean {
  if (!occurrenceRanges.length) return true
  return (
    !firstOnly
    && !Array.isArray(match.occurrences)
    && Number((match as { count?: unknown }).count || 0) > occurrenceRanges.length
  )
}

function linePatternRanges(content: string, lineNumber: number, pattern: RegExp): Range[] {
  const transformer = new PositionOffsetTransformer(content)
  const safeLine = Math.max(1, Math.trunc(Number(lineNumber) || 1))
  const lineLength = transformer.getLineLength(safeLine)
  const lineStart = transformer.getOffset(new Position(safeLine, 1))
  const lineText = content.slice(lineStart, lineStart + lineLength)
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`
  const globalPattern = new RegExp(pattern.source, flags)
  const ranges: Range[] = []
  let match: RegExpExecArray | null
  while ((match = globalPattern.exec(lineText))) {
    const matched = match[0]
    if (!matched.length) {
      globalPattern.lastIndex += 1
      continue
    }
    const startColumn = match.index + 1
    const edit = createSearchReplacementEdit({
      content,
      match: {
        line: safeLine,
        column: startColumn,
        matchLength: matched.length,
      },
      replaceText: "",
      pattern,
    })
    if (edit) ranges.push(edit.range)
  }
  return ranges
}

function dedupeEdits(edits: readonly ResourceTextEdit[]): ResourceTextEdit[] {
  const seen = new Set<string>()
  const result: ResourceTextEdit[] = []
  for (const edit of edits) {
    const key = `${edit.resource}:${edit.range.startLineNumber}:${edit.range.startColumn}:${edit.range.endLineNumber}:${edit.range.endColumn}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(edit)
  }
  return result
}
