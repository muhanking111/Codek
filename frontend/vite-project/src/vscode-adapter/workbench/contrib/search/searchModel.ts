/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { compareFileNamesDefault } from "../../../base/common/comparers"

export interface CodekSearchOccurrence {
  column: number
  matchLength: number
}

export interface CodekRawTextMatch {
  path: string
  line: number
  column?: number
  matchLength?: number
  preview?: string
  occurrences?: CodekSearchOccurrence[]
}

export interface CodekSearchMatch {
  id: string
  line: number
  text: string
  column: number
  matchLength: number
  count: number
  occurrences: CodekSearchOccurrence[]
}

export interface CodekSearchFileMatch {
  path: string
  content?: string
  matches: CodekSearchMatch[]
}

export interface CodekSearchFileContents {
  [path: string]: string
}

export function addTextSearchMatch(
  grouped: Map<string, CodekSearchFileMatch>,
  rawMatch: CodekRawTextMatch,
  fileContents: CodekSearchFileContents = {},
): void {
  const path = String(rawMatch.path || "")
  if (!path) return
  const line = normalizePositiveInteger(rawMatch.line, 1)
  const text = String(rawMatch.preview || "").trim()
  const fallbackColumn = normalizePositiveInteger(rawMatch.column, 1)
  const fallbackLength = normalizeNonNegativeInteger(rawMatch.matchLength, 0)
  const occurrences = normalizeOccurrences(rawMatch.occurrences, fallbackColumn, fallbackLength)
  const primary = occurrences[0] || { column: fallbackColumn, matchLength: fallbackLength }
  const content = fileContents[path]
  const fileMatch = grouped.get(path) ?? {
    path,
    ...(typeof content === "string" ? { content } : {}),
    matches: [],
  }
  if (typeof content === "string" && typeof fileMatch.content !== "string") fileMatch.content = content

  const existing = fileMatch.matches.find((match) => match.line === line && match.text === text)
  if (existing) {
    existing.occurrences = [...existing.occurrences, ...occurrences]
    existing.count = existing.occurrences.length
  } else {
    fileMatch.matches.push({
      id: `${path}:${line}:${primary.column}:${primary.matchLength}:${fileMatch.matches.length}`,
      line,
      text,
      column: primary.column,
      matchLength: primary.matchLength,
      count: occurrences.length,
      occurrences,
    })
  }
  grouped.set(path, fileMatch)
}

export function groupTextSearchMatches(
  rawMatches: readonly CodekRawTextMatch[],
  options: { fileContents?: CodekSearchFileContents; includeMatch?: (path: string) => boolean } = {},
): CodekSearchFileMatch[] {
  const grouped = new Map<string, CodekSearchFileMatch>()
  for (const rawMatch of rawMatches || []) {
    const path = String(rawMatch?.path || "")
    if (!path || (options.includeMatch && !options.includeMatch(path))) continue
    addTextSearchMatch(grouped, rawMatch, options.fileContents || {})
  }
  return sortSearchFileMatches(Array.from(grouped.values()))
}

export function sortSearchFileMatches(fileMatches: CodekSearchFileMatch[]): CodekSearchFileMatch[] {
  return [...fileMatches]
    .map((fileMatch) => ({
      ...fileMatch,
      matches: sortSearchMatches(fileMatch.matches),
    }))
    .sort(compareSearchFileMatches)
}

export function compareSearchFileMatches(first: CodekSearchFileMatch, second: CodekSearchFileMatch): number {
  const pathComparison = compareSearchResourcePath(first.path, second.path)
  if (pathComparison !== 0) return pathComparison
  return first.path.localeCompare(second.path)
}

export function compareSearchResourcePath(firstPath: string, secondPath: string): number {
  const firstSegments = normalizeSearchPath(firstPath).split("/").filter(Boolean)
  const secondSegments = normalizeSearchPath(secondPath).split("/").filter(Boolean)
  const count = Math.min(firstSegments.length, secondSegments.length)
  for (let index = 0; index < count; index += 1) {
    const segmentComparison = compareFileNamesDefault(firstSegments[index], secondSegments[index])
    if (segmentComparison !== 0) return segmentComparison
  }
  if (firstSegments.length !== secondSegments.length) return firstSegments.length - secondSegments.length
  return compareFileNamesDefault(firstPath, secondPath)
}

function sortSearchMatches(matches: CodekSearchMatch[]): CodekSearchMatch[] {
  return [...matches].sort((first, second) => {
    if (first.line !== second.line) return first.line - second.line
    if (first.column !== second.column) return first.column - second.column
    if (first.matchLength !== second.matchLength) return first.matchLength - second.matchLength
    return first.text.localeCompare(second.text)
  })
}

function normalizeSearchPath(path: string): string {
  return String(path || "").replace(/\\+/g, "/")
}

export function groupTextSearchMatchesFromContent(
  files: Record<string, unknown>,
  pattern: RegExp,
  includeMatch: (path: string) => boolean = () => true,
): CodekSearchFileMatch[] {
  const rawMatches: CodekRawTextMatch[] = []
  for (const [path, content] of Object.entries(files || {})) {
    if (typeof content !== "string") continue
    if (!includeMatch(path)) continue
    const lines = content.split("\n")
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      const occurrences: CodekSearchOccurrence[] = []
      while ((match = pattern.exec(line)) !== null) {
        occurrences.push({ column: match.index + 1, matchLength: match[0].length })
        if (match.index === pattern.lastIndex) pattern.lastIndex += 1
      }
      if (occurrences.length) {
        rawMatches.push({
          path,
          line: index + 1,
          column: occurrences[0].column,
          matchLength: occurrences[0].matchLength,
          preview: line,
          occurrences,
        })
      }
    }
  }
  return groupTextSearchMatches(rawMatches)
}

function normalizeOccurrences(
  occurrences: CodekSearchOccurrence[] | undefined,
  fallbackColumn: number,
  fallbackLength: number,
): CodekSearchOccurrence[] {
  if (!Array.isArray(occurrences) || !occurrences.length) {
    return [{ column: fallbackColumn, matchLength: fallbackLength }]
  }
  return occurrences.map((occurrence) => ({
    column: normalizePositiveInteger(occurrence?.column, fallbackColumn),
    matchLength: normalizeNonNegativeInteger(occurrence?.matchLength, fallbackLength),
  }))
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const numeric = Math.trunc(Number(value))
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  const numeric = Math.trunc(Number(value))
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback
}
