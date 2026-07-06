/*---------------------------------------------------------------------------------------------
 * VS Code-style references result model adapted for Codek navigation.
 * Source reference:
 * - D:\SourceMirror\vscode\src\vs\editor\contrib\gotoSymbol\browser\referencesModel.ts
 *--------------------------------------------------------------------------------------------*/

import { openLocation, type NavigationServiceContext } from "../../workbench/navigationService"
import type { CodekRange } from "../workspaceSymbols/workspaceSymbolRegistry"

export interface CodekReferenceLocation {
  uri: string
  range: CodekRange
  preview?: string
  source?: string
}

export interface CodekReferenceProjection {
  id: string
  path: string
  line: number
  column: number
  endLine: number
  endColumn: number
  preview: string
  isProviderFirst: boolean
}

export interface CodekReferenceFileGroup {
  path: string
  count: number
  references: CodekReferenceProjection[]
}

export interface CodekReferencesPeekModel {
  title: string
  total: number
  isEmpty: boolean
  files: CodekReferenceFileGroup[]
  references: CodekReferenceProjection[]
  ariaMessage: string
}

export interface SymbolReferenceFile {
  path: string
  count: number
}

export interface SymbolReferenceData {
  total: number
  files: SymbolReferenceFile[]
}

export class CodekReferencesModel {
  readonly files: CodekReferenceFileGroup[]
  readonly references: CodekReferenceProjection[]

  constructor(
    readonly locations: readonly CodekReferenceLocation[],
    readonly title = "References",
  ) {
    const first = locations[0]
    const files = new Map<string, CodekReferenceFileGroup>()
    const references: CodekReferenceProjection[] = []

    for (const location of [...locations].sort(compareLocations)) {
      const normalized = normalizeLocation(location)
      const group = files.get(normalized.uri) || {
        path: normalized.uri,
        count: 0,
        references: [],
      }
      if (!files.has(normalized.uri)) files.set(normalized.uri, group)

      const previous = group.references[group.references.length - 1]
      if (previous && previous.line === normalized.range.startLineNumber && previous.column === normalized.range.startColumn) {
        continue
      }

      const projected: CodekReferenceProjection = {
        id: `${normalized.uri}:${normalized.range.startLineNumber}:${normalized.range.startColumn}`,
        path: normalized.uri,
        line: normalized.range.startLineNumber,
        column: normalized.range.startColumn,
        endLine: normalized.range.endLineNumber,
        endColumn: normalized.range.endColumn,
        preview: normalizePreview(normalized.preview),
        isProviderFirst: first === location,
      }
      group.references.push(projected)
      group.count = group.references.length
      references.push(projected)
    }

    this.files = [...files.values()]
    this.references = references
  }

  get isEmpty(): boolean {
    return this.references.length === 0
  }

  get total(): number {
    return this.references.length
  }

  toReferenceData(): SymbolReferenceData {
    return {
      total: this.total,
      files: this.files.map((file) => ({ path: file.path, count: file.count })),
    }
  }

  toPeekModel(): CodekReferencesPeekModel {
    return {
      title: this.title,
      total: this.total,
      isEmpty: this.isEmpty,
      files: this.files,
      references: this.references,
      ariaMessage: this.ariaMessage,
    }
  }

  get ariaMessage(): string {
    if (this.isEmpty) return "No references found"
    if (this.references.length === 1) return `Found 1 reference in ${this.references[0].path}`
    if (this.files.length === 1) return `Found ${this.references.length} references in ${this.files[0].path}`
    return `Found ${this.references.length} references in ${this.files.length} files`
  }

  firstReference(): CodekReferenceProjection | undefined {
    return this.references.find((reference) => reference.isProviderFirst) || this.references[0]
  }

  nextOrPreviousReference(
    reference: CodekReferenceProjection,
    next: boolean,
  ): CodekReferenceProjection | undefined {
    const index = this.references.findIndex((candidate) => candidate.id === reference.id)
    if (index === -1 || this.references.length === 0) return undefined
    const offset = next ? 1 : -1
    return this.references[(index + offset + this.references.length) % this.references.length]
  }

  nearestReference(path: string, line: number, column: number): CodekReferenceProjection | undefined {
    return this.references
      .map((reference) => ({
        reference,
        prefixLen: commonPrefixLength(reference.path, path),
        offsetDist: Math.abs(reference.line - line) * 100 + Math.abs(reference.column - column),
      }))
      .sort((a, b) => b.prefixLen - a.prefixLen || a.offsetDist - b.offsetDist)[0]?.reference
  }

  referenceAt(path: string, line: number, column: number): CodekReferenceProjection | undefined {
    return this.references.find((reference) => reference.path === path
      && line >= reference.line
      && line <= reference.endLine
      && (line > reference.line || column >= reference.column)
      && (line < reference.endLine || column <= reference.endColumn))
  }

  async openReference(
    reference: CodekReferenceProjection,
    context: NavigationServiceContext,
    options: { preserveFocus?: boolean } = {},
  ): Promise<boolean> {
    return openLocation({
      path: reference.path,
      line: reference.line,
      column: reference.column,
      endLine: reference.endLine,
      endColumn: reference.endColumn,
      preserveFocus: options.preserveFocus,
    }, context)
  }
}

export function createReferencesModel(
  locations: readonly CodekReferenceLocation[],
  title?: string,
): CodekReferencesModel {
  return new CodekReferencesModel(locations, title)
}

function normalizeLocation(location: CodekReferenceLocation): CodekReferenceLocation {
  const line = asPositiveNumber(location.range?.startLineNumber, 1)
  const column = asPositiveNumber(location.range?.startColumn, 1)
  const endLine = asPositiveNumber(location.range?.endLineNumber, line)
  const endColumn = asPositiveNumber(location.range?.endColumn, column)
  return {
    uri: String(location.uri || ""),
    range: {
      startLineNumber: line,
      startColumn: column,
      endLineNumber: Math.max(line, endLine),
      endColumn: endLine === line ? Math.max(column, endColumn) : endColumn,
    },
    preview: normalizePreview(location.preview),
    source: String(location.source || ""),
  }
}

function compareLocations(left: CodekReferenceLocation, right: CodekReferenceLocation): number {
  const l = normalizeLocation(left)
  const r = normalizeLocation(right)
  return l.uri.localeCompare(r.uri)
    || l.range.startLineNumber - r.range.startLineNumber
    || l.range.startColumn - r.range.startColumn
}

function commonPrefixLength(left: string, right: string): number {
  let index = 0
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1
  return index
}

function normalizePreview(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""
}

function asPositiveNumber(value: unknown, fallback: number): number {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(1, numberValue)
}
