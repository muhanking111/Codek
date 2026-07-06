/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/workbench/contrib/tasks/common/problemMatcher.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { MarkerSeverity, toCodekSeverity } from "../../../../platform/markers/common/markers"

export enum FileLocationKind {
  Default = "default",
  Relative = "relative",
  Absolute = "absolute",
  AutoDetect = "autoDetect",
  Search = "search",
}

export namespace FileLocationKind {
  export function fromString(value: string | undefined): FileLocationKind | undefined {
    const normalized = String(value || "").toLowerCase()
    if (normalized === "absolute") return FileLocationKind.Absolute
    if (normalized === "relative") return FileLocationKind.Relative
    if (normalized === "autodetect") return FileLocationKind.AutoDetect
    if (normalized === "search") return FileLocationKind.Search
    return undefined
  }
}

export enum ProblemLocationKind {
  File = "file",
  Location = "location",
}

export namespace ProblemLocationKind {
  export function fromString(value: string | undefined): ProblemLocationKind | undefined {
    const normalized = String(value || "").toLowerCase()
    if (normalized === "file") return ProblemLocationKind.File
    if (normalized === "location") return ProblemLocationKind.Location
    return undefined
  }
}

export enum ApplyToKind {
  allDocuments = "allDocuments",
  openDocuments = "openDocuments",
  closedDocuments = "closedDocuments",
}

export namespace ApplyToKind {
  export function fromString(value: string | undefined): ApplyToKind | undefined {
    const normalized = String(value || "").toLowerCase()
    if (normalized === "alldocuments") return ApplyToKind.allDocuments
    if (normalized === "opendocuments") return ApplyToKind.openDocuments
    if (normalized === "closeddocuments") return ApplyToKind.closedDocuments
    return undefined
  }
}

export type TaskProblemSeverity = "error" | "warning" | "info" | "ai"

export interface ExternalProblemPattern {
  regexp: string | RegExp
  kind?: "file" | "location"
  file?: number
  location?: number
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  message?: number
  severity?: number
  code?: number
  loop?: boolean
}

export interface ExternalProblemMatcher {
  owner?: string
  source?: string
  applyTo?: "allDocuments" | "openDocuments" | "closedDocuments"
  fileLocation?: "absolute" | "relative" | "autoDetect" | "search" | ["absolute"] | ["relative" | "autoDetect", string] | ["search", SearchFileLocationArgs]
  pattern?: string | ExternalProblemPattern | ExternalProblemPattern[]
  base?: string
  background?: ExternalWatchingMatcher
  watching?: ExternalWatchingMatcher
  severity?: "error" | "warning" | "info"
}

export interface ExternalWatchingMatcher {
  activeOnStart?: boolean
  beginsPattern?: string | RegExp | ExternalWatchingPattern
  endsPattern?: string | RegExp | ExternalWatchingPattern
}

export interface ExternalWatchingPattern {
  regexp?: string | RegExp
  file?: number
}

export interface SearchFileLocationArgs {
  include?: string[]
  exclude?: string[]
}

export interface ProblemPattern {
  regexp: RegExp
  kind?: ProblemLocationKind
  file?: number
  message?: number
  location?: number
  line?: number
  column?: number
  character?: number
  endLine?: number
  endColumn?: number
  endCharacter?: number
  code?: number
  severity?: number
  loop?: boolean
}

export interface WatchingPattern {
  regexp: RegExp
  file?: number
}

export interface WatchingMatcher {
  activeOnStart: boolean
  beginsPattern?: WatchingPattern | RegExp
  endsPattern?: WatchingPattern | RegExp
}

export type ProblemMatcherFileLocation = FileLocationKind | "absolute" | "relative" | "autoDetect" | "search"

export interface TaskProblemMatcher {
  id: string
  owner: string
  source: string
  applyTo?: ApplyToKind
  fileLocation: ProblemMatcherFileLocation
  filePrefix?: string | SearchFileLocationArgs
  severity?: TaskProblemSeverity
  pattern: ProblemPattern | ProblemPattern[]
  background?: WatchingMatcher
}

export interface TaskProblemMarker {
  resource: string
  owner: string
  source: string
  severity: TaskProblemSeverity
  line: number
  column: number
  endLine?: number
  endColumn?: number
  message: string
  code?: string
}

export interface TaskProblemMatch {
  marker: TaskProblemMarker
  description: TaskProblemMatcher
}

export interface ProblemMatcherBackgroundState {
  active: boolean
  beginsMatched: boolean
  endsMatched: boolean
}

interface ProblemData {
  kind?: ProblemLocationKind
  file?: string
  location?: string
  line?: string
  character?: string
  endLine?: string
  endCharacter?: string
  message?: string
  severity?: string
  code?: string
}

interface LocationData {
  startLineNumber: number
  startCharacter: number
  endLineNumber: number
  endCharacter: number
}

interface HandleResult {
  match: TaskProblemMatch | null
  continue: boolean
}

interface LineMatcher {
  readonly matchLength: number
  handle(lines: string[], start?: number): HandleResult
  next(line: string): TaskProblemMatch | null
}

const endOfLine = "\n"

function compileRegExp(value: string | RegExp | undefined): RegExp | undefined {
  if (!value) return undefined
  if (value instanceof RegExp) return value
  try {
    return new RegExp(value)
  } catch {
    return undefined
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function groupValue(matches: RegExpExecArray, index?: number, trim = true): string | undefined {
  if (index === undefined || index >= matches.length) return undefined
  const value = matches[index]
  if (value === undefined) return undefined
  return trim ? String(value).trim() : String(value)
}

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, "/")
}

function normalizeProblemPath(value: string): string {
  const normalized = normalizePathSeparators(value).replace(/^file:\/\//, "")
  const isAbsolute = /^\/|^[a-zA-Z]:\//.test(normalized)
  const segments: string[] = []
  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === ".." && segments.length > 0 && segments[segments.length - 1] !== "..") {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  const joined = segments.join("/")
  return isAbsolute && !/^[a-zA-Z]:/.test(joined) ? `/${joined}` : joined
}

function joinPath(prefix: string, file: string): string {
  const normalizedPrefix = normalizeProblemPath(prefix).replace(/\/+$/, "")
  const normalizedFile = normalizeProblemPath(file).replace(/^\/+/, "")
  return normalizeProblemPath(`${normalizedPrefix}/${normalizedFile}`)
}

function resolveFilePath(file: string, matcher: TaskProblemMatcher): string {
  const normalized = normalizeProblemPath(file)
  if (matcher.fileLocation === FileLocationKind.Absolute) return normalized
  if (typeof matcher.filePrefix !== "string") return normalized.replace(/^\$\{workspaceFolder\}\//, "")
  const prefix = normalizeProblemPath(matcher.filePrefix)
  if (!prefix || prefix === "${workspaceFolder}") return normalized.replace(/^\$\{workspaceFolder\}\//, "")
  return joinPath(prefix, normalized)
}

function parseLocationInfo(value: string | undefined): LocationData | null {
  if (!value || !/^\d+(,\d+){0,3}$/.test(value)) return null
  const parts = value.split(",").map((item) => Number.parseInt(item, 10))
  if (!Number.isFinite(parts[0])) return null
  const startLine = Math.max(1, parts[0])
  const startColumn = Number.isFinite(parts[1]) ? Math.max(1, parts[1]) : 1
  if (parts.length > 3) {
    return {
      startLineNumber: startLine,
      startCharacter: startColumn,
      endLineNumber: Math.max(startLine, parts[2] || startLine),
      endCharacter: Math.max(1, parts[3] || startColumn),
    }
  }
  return {
    startLineNumber: startLine,
    startCharacter: startColumn,
    endLineNumber: startLine,
    endCharacter: startColumn,
  }
}

function createLocation(data: ProblemData): LocationData | null {
  if (data.kind === ProblemLocationKind.File) {
    return { startLineNumber: 1, startCharacter: 1, endLineNumber: 1, endCharacter: 1 }
  }
  const location = parseLocationInfo(data.location)
  if (location) return location
  if (!data.line) return null
  const startLine = Number.parseInt(data.line, 10)
  if (!Number.isFinite(startLine)) return null
  const startColumn = data.character ? Number.parseInt(data.character, 10) : 1
  const endLine = data.endLine ? Number.parseInt(data.endLine, 10) : startLine
  const endColumn = data.endCharacter ? Number.parseInt(data.endCharacter, 10) : startColumn
  return {
    startLineNumber: Math.max(1, startLine),
    startCharacter: Number.isFinite(startColumn) ? Math.max(1, startColumn) : 1,
    endLineNumber: Number.isFinite(endLine) ? Math.max(1, endLine) : Math.max(1, startLine),
    endCharacter: Number.isFinite(endColumn) ? Math.max(1, endColumn) : 1,
  }
}

function markerSeverityFromTaskSeverity(severity?: TaskProblemSeverity): MarkerSeverity {
  if (severity === "warning") return MarkerSeverity.Warning
  if (severity === "info") return MarkerSeverity.Info
  if (severity === "ai") return MarkerSeverity.Hint
  return MarkerSeverity.Error
}

function normalizeSeverity(value: string | undefined, fallback?: TaskProblemSeverity): TaskProblemSeverity {
  const normalized = String(value || "").toLowerCase()
  if (normalized === "e" || normalized.includes("error") || normalized.includes("fatal")) return "error"
  if (normalized === "w" || normalized.includes("warn")) return "warning"
  if (normalized === "i" || normalized.includes("info") || normalized.includes("hint") || normalized.includes("note")) return "info"
  return toCodekSeverity(markerSeverityFromTaskSeverity(fallback))
}

abstract class AbstractLineMatcher implements LineMatcher {
  constructor(protected readonly matcher: TaskProblemMatcher) {}

  handle(_lines: string[], _start = 0): HandleResult {
    return { match: null, continue: false }
  }

  next(_line: string): TaskProblemMatch | null {
    return null
  }

  abstract get matchLength(): number

  protected regexpExec(regexp: RegExp, line: string): RegExpExecArray | null {
    regexp.lastIndex = 0
    return regexp.exec(line)
  }

  protected fillProblemData(data: ProblemData | undefined, pattern: ProblemPattern, matches: RegExpExecArray): data is ProblemData {
    if (!data) return false
    this.fillProperty(data, "file", pattern, matches, true)
    this.appendProperty(data, "message", pattern, matches, true)
    this.fillProperty(data, "code", pattern, matches, true)
    this.fillProperty(data, "severity", pattern, matches, true)
    this.fillProperty(data, "location", pattern, matches, true)
    this.fillProperty(data, "line", pattern, matches)
    this.fillProperty(data, "character", pattern, matches, false, "column")
    this.fillProperty(data, "endLine", pattern, matches)
    this.fillProperty(data, "endCharacter", pattern, matches, false, "endColumn")
    return true
  }

  private appendProperty(data: ProblemData, property: keyof ProblemData, pattern: ProblemPattern, matches: RegExpExecArray, trim = false): void {
    const patternProperty = pattern[property as keyof ProblemPattern] as number | undefined
    if (data[property] === undefined) {
      this.fillProperty(data, property, pattern, matches, trim)
    } else if (patternProperty !== undefined && patternProperty < matches.length) {
      const value = groupValue(matches, patternProperty, trim)
      if (value !== undefined) {
        data[property] = `${data[property]}${endOfLine}${value}` as never
      }
    }
  }

  private fillProperty(
    data: ProblemData,
    property: keyof ProblemData,
    pattern: ProblemPattern,
    matches: RegExpExecArray,
    trim = false,
    fallbackPatternProperty?: keyof ProblemPattern,
  ): void {
    const patternProperty = pattern[property as keyof ProblemPattern] as number | undefined
      ?? (fallbackPatternProperty ? pattern[fallbackPatternProperty] as number | undefined : undefined)
    if (data[property] !== undefined || patternProperty === undefined || patternProperty >= matches.length) return
    const value = groupValue(matches, patternProperty, trim)
    if (value !== undefined) data[property] = value as never
  }

  protected getMarkerMatch(data: ProblemData): TaskProblemMatch | null {
    const location = createLocation(data)
    if (!data.file || !location || !data.message) return null
    const severity = normalizeSeverity(data.severity, this.matcher.severity)
    return {
      description: this.matcher,
      marker: {
        resource: resolveFilePath(data.file, this.matcher),
        owner: this.matcher.owner,
        source: this.matcher.source,
        severity,
        line: location.startLineNumber,
        column: location.startCharacter,
        endLine: location.endLineNumber,
        endColumn: location.endCharacter,
        message: data.message,
        code: data.code,
      },
    }
  }
}

class SingleLineMatcher extends AbstractLineMatcher {
  private readonly pattern: ProblemPattern

  constructor(matcher: TaskProblemMatcher) {
    super(matcher)
    this.pattern = matcher.pattern as ProblemPattern
  }

  get matchLength(): number {
    return 1
  }

  override handle(lines: string[], start = 0): HandleResult {
    if (lines.length - start !== 1) return { match: null, continue: false }
    const data: ProblemData = {}
    if (this.pattern.kind !== undefined) data.kind = this.pattern.kind
    const matches = this.regexpExec(this.pattern.regexp, lines[start])
    if (!matches) return { match: null, continue: false }
    this.fillProblemData(data, this.pattern, matches)
    if (data.kind === ProblemLocationKind.Location && !data.location && !data.line && data.file) {
      data.kind = ProblemLocationKind.File
    }
    return { match: this.getMarkerMatch(data), continue: false }
  }
}

class MultiLineMatcher extends AbstractLineMatcher {
  private readonly patterns: ProblemPattern[]
  private data: ProblemData | undefined

  constructor(matcher: TaskProblemMatcher) {
    super(matcher)
    this.patterns = matcher.pattern as ProblemPattern[]
  }

  get matchLength(): number {
    return this.patterns.length
  }

  override handle(lines: string[], start = 0): HandleResult {
    if (lines.length - start !== this.patterns.length) return { match: null, continue: false }
    this.data = {}
    let data = this.data
    data.kind = this.patterns[0].kind
    for (let index = 0; index < this.patterns.length; index += 1) {
      const pattern = this.patterns[index]
      const matches = this.regexpExec(pattern.regexp, lines[index + start])
      if (!matches) return { match: null, continue: false }
      if (pattern.loop && index === this.patterns.length - 1) {
        data = deepClone(data)
      }
      this.fillProblemData(data, pattern, matches)
    }
    const loop = this.patterns[this.patterns.length - 1]?.loop === true
    if (!loop) this.data = undefined
    return { match: this.getMarkerMatch(data), continue: loop }
  }

  override next(line: string): TaskProblemMatch | null {
    const pattern = this.patterns[this.patterns.length - 1]
    if (!pattern?.loop || !this.data) return null
    const matches = this.regexpExec(pattern.regexp, line)
    if (!matches) {
      this.data = undefined
      return null
    }
    const data = deepClone(this.data)
    if (!this.fillProblemData(data, pattern, matches)) return null
    return this.getMarkerMatch(data)
  }
}

function createLineMatcher(matcher: TaskProblemMatcher): LineMatcher {
  return Array.isArray(matcher.pattern) ? new MultiLineMatcher(matcher) : new SingleLineMatcher(matcher)
}

export function collectTaskProblemMatches(output: string, matchers: readonly TaskProblemMatcher[]): TaskProblemMatch[] {
  const lineMatchers = matchers.map(createLineMatcher)
  if (lineMatchers.length === 0) return []
  const byLength = new Map<number, LineMatcher[]>()
  let bufferLength = 1
  for (const matcher of lineMatchers) {
    bufferLength = Math.max(bufferLength, matcher.matchLength)
    const group = byLength.get(matcher.matchLength) || []
    group.push(matcher)
    byLength.set(matcher.matchLength, group)
  }

  const results: TaskProblemMatch[] = []
  let activeMatcher: LineMatcher | null = null
  let buffer: string[] = []

  for (const line of String(output || "").split(/\r?\n/)) {
    if (activeMatcher) {
      const match = activeMatcher.next(line)
      if (match) {
        results.push(match)
        continue
      }
      activeMatcher = null
      buffer = []
    }

    if (buffer.length < bufferLength) {
      buffer.push(line)
    } else {
      buffer = [...buffer.slice(1), line]
    }

    for (let startIndex = 0; startIndex < buffer.length; startIndex += 1) {
      const candidates = byLength.get(buffer.length - startIndex)
      if (!candidates) continue
      for (const candidate of candidates) {
        const result = candidate.handle(buffer, startIndex)
        if (result.match) {
          results.push(result.match)
          buffer = []
          if (result.continue) activeMatcher = candidate
          break
        }
      }
      if (activeMatcher || buffer.length === 0) break
    }
  }

  return results
}

function patternFromExternal(value: ExternalProblemPattern, setDefaults: boolean): ProblemPattern | null {
  const regexp = compileRegExp(value.regexp)
  if (!regexp) return null
  const pattern: ProblemPattern = { regexp }
  if (value.kind) pattern.kind = ProblemLocationKind.fromString(value.kind)
  if (typeof value.file === "number") pattern.file = value.file
  if (typeof value.location === "number") pattern.location = value.location
  if (typeof value.line === "number") pattern.line = value.line
  if (typeof value.column === "number") pattern.character = value.column
  if (typeof value.endLine === "number") pattern.endLine = value.endLine
  if (typeof value.endColumn === "number") pattern.endCharacter = value.endColumn
  if (typeof value.severity === "number") pattern.severity = value.severity
  if (typeof value.code === "number") pattern.code = value.code
  if (typeof value.message === "number") pattern.message = value.message
  if (typeof value.loop === "boolean") pattern.loop = value.loop
  if (setDefaults) {
    if (pattern.location || pattern.kind === ProblemLocationKind.File) {
      if (pattern.file === undefined) pattern.file = 1
      if (pattern.message === undefined) pattern.message = 0
    } else {
      if (pattern.file === undefined) pattern.file = 1
      if (pattern.line === undefined) pattern.line = 2
      if (pattern.character === undefined) pattern.character = 3
      if (pattern.message === undefined) pattern.message = 0
    }
  }
  if (pattern.kind === undefined) pattern.kind = ProblemLocationKind.Location
  return pattern
}

function clonePattern(pattern: ProblemPattern): ProblemPattern {
  return { ...pattern, regexp: new RegExp(pattern.regexp.source, pattern.regexp.flags) }
}

function clonePatterns(pattern: ProblemPattern | ProblemPattern[]): ProblemPattern | ProblemPattern[] {
  return Array.isArray(pattern) ? pattern.map(clonePattern) : clonePattern(pattern)
}

const patternRegistry: Record<string, ProblemPattern | ProblemPattern[]> = {
  msCompile: {
    regexp: /^\s*(?:\s*\d+>)?(\S.*?)(?:\((\d+|\d+,\d+|\d+,\d+,\d+,\d+)\))?\s*:\s+(?:(\S+)\s+)?((?:fatal +)?error|warning|info)\s+(\w+\d+)?\s*:\s*(.*)$/,
    kind: ProblemLocationKind.Location,
    file: 1,
    location: 2,
    severity: 4,
    code: 5,
    message: 6,
  },
  "gulp-tsc": {
    regexp: /^([^\s].*)\((\d+|\d+,\d+|\d+,\d+,\d+,\d+)\):\s+(\d+)\s+(.*)$/,
    kind: ProblemLocationKind.Location,
    file: 1,
    location: 2,
    code: 3,
    message: 4,
  },
  tsc: {
    regexp: /^(.*)\((\d+|\d+,\d+|\d+,\d+,\d+,\d+)\):\s+(error|warning|info)\s+(TS\d+):\s*(.*)$/,
    kind: ProblemLocationKind.Location,
    file: 1,
    location: 2,
    severity: 3,
    code: 4,
    message: 5,
  },
  "eslint-compact": {
    regexp: /^(.+):\sline\s(\d+),\scol\s(\d+),\s(Error|Warning|Info)\s-\s(.+)\s\((.+)\)$/,
    kind: ProblemLocationKind.Location,
    file: 1,
    line: 2,
    character: 3,
    severity: 4,
    message: 5,
    code: 6,
  },
  "eslint-stylish": [
    {
      regexp: /^((?:[a-zA-Z]:)*[./\\]+.*?)$/,
      kind: ProblemLocationKind.Location,
      file: 1,
    },
    {
      regexp: /^\s+(\d+):(\d+)\s+(error|warning|info)\s+(.+?)(?:\s\s+(.*))?$/,
      line: 1,
      character: 2,
      severity: 3,
      message: 4,
      code: 5,
      loop: true,
    },
  ],
  go: {
    regexp: /^([^:]*: )?((.:)?[^:]*):(\d+)(:(\d+))?: (.*)$/,
    kind: ProblemLocationKind.Location,
    file: 2,
    line: 4,
    character: 6,
    message: 7,
  },
  python: {
    regexp: /^(.+\.py):(\d+):(\d+):\s+(error|warning|info):\s+(.*)$/,
    kind: ProblemLocationKind.Location,
    file: 1,
    line: 2,
    character: 3,
    severity: 4,
    message: 5,
  },
  maven: {
    regexp: /^\[ERROR\]\s+(.+):\[(\d+),(\d+)\]\s+(.*)$/,
    kind: ProblemLocationKind.Location,
    file: 1,
    line: 2,
    character: 3,
    message: 4,
  },
  rustc: {
    regexp: /^\s*-->\s+(.+):(\d+):(\d+)$/,
    kind: ProblemLocationKind.Location,
    file: 1,
    line: 2,
    character: 3,
    message: 0,
  },
}

interface BuiltinMatcherSeed {
  owner: string
  source: string
  applyTo?: ApplyToKind
  fileLocation?: FileLocationKind
  filePrefix?: string
  pattern: string
  severity?: TaskProblemSeverity
}

const matcherRegistry: Record<string, BuiltinMatcherSeed> = {
  msCompile: { owner: "msCompile", source: "cpp", applyTo: ApplyToKind.allDocuments, fileLocation: FileLocationKind.Absolute, pattern: "msCompile" },
  "gulp-tsc": { owner: "typescript", source: "ts", applyTo: ApplyToKind.closedDocuments, fileLocation: FileLocationKind.Relative, filePrefix: "${workspaceFolder}", pattern: "gulp-tsc" },
  tsc: { owner: "typescript", source: "TypeScript", applyTo: ApplyToKind.allDocuments, fileLocation: FileLocationKind.Relative, filePrefix: "${workspaceFolder}", pattern: "tsc" },
  "eslint-compact": { owner: "eslint", source: "ESLint", applyTo: ApplyToKind.allDocuments, fileLocation: FileLocationKind.Absolute, pattern: "eslint-compact" },
  "eslint-stylish": { owner: "eslint", source: "ESLint", applyTo: ApplyToKind.allDocuments, fileLocation: FileLocationKind.Relative, filePrefix: "${workspaceFolder}", pattern: "eslint-stylish" },
  go: { owner: "go", source: "Go", applyTo: ApplyToKind.allDocuments, fileLocation: FileLocationKind.Relative, filePrefix: "${workspaceFolder}", pattern: "go" },
  python: { owner: "python", source: "Python", applyTo: ApplyToKind.allDocuments, fileLocation: FileLocationKind.Relative, filePrefix: "${workspaceFolder}", pattern: "python" },
  maven: { owner: "maven", source: "Maven", applyTo: ApplyToKind.allDocuments, fileLocation: FileLocationKind.Relative, filePrefix: "${workspaceFolder}", pattern: "maven", severity: "error" },
  rustc: { owner: "rustc", source: "Rust", applyTo: ApplyToKind.allDocuments, fileLocation: FileLocationKind.Relative, filePrefix: "${workspaceFolder}", pattern: "rustc", severity: "error" },
}

function normalizeRefName(name: string): string {
  return name.replace(/^\$/, "")
}

function resolvePattern(value: string | ExternalProblemPattern | ExternalProblemPattern[] | undefined): ProblemPattern | ProblemPattern[] | null {
  if (!value) return null
  if (typeof value === "string") {
    const registered = patternRegistry[normalizeRefName(value)]
    return registered ? clonePatterns(registered) : null
  }
  if (Array.isArray(value)) {
    const patterns = value.map((entry, index) => patternFromExternal(entry, false))
    if (patterns.some((entry) => !entry)) return null
    const resolved = patterns as ProblemPattern[]
    if (resolved[0] && resolved[0].kind === undefined) resolved[0].kind = ProblemLocationKind.Location
    for (let index = 0; index < resolved.length - 1; index += 1) {
      if (resolved[index].loop) resolved[index].loop = false
    }
    return resolved
  }
  return patternFromExternal(value, true)
}

function resolveWatchingPattern(value: string | RegExp | ExternalWatchingPattern | undefined): WatchingPattern | undefined {
  if (!value) return undefined
  if (typeof value === "string" || value instanceof RegExp) {
    const regexp = compileRegExp(value)
    return regexp ? { regexp } : undefined
  }
  const regexp = compileRegExp(value.regexp)
  return regexp ? { regexp, file: value.file } : undefined
}

function resolveWatchingMatcher(value: ExternalWatchingMatcher | undefined): WatchingMatcher | undefined {
  if (!value) return undefined
  const beginsPattern = resolveWatchingPattern(value.beginsPattern)
  const endsPattern = resolveWatchingPattern(value.endsPattern)
  if (!beginsPattern && !endsPattern && value.activeOnStart !== true) return undefined
  return {
    activeOnStart: value.activeOnStart === true,
    beginsPattern,
    endsPattern,
  }
}

function normalizeFileLocation(
  value: ExternalProblemMatcher["fileLocation"],
  workspaceFolder: string,
): { kind: FileLocationKind; prefix?: string | SearchFileLocationArgs } | null {
  if (value === undefined) return { kind: FileLocationKind.Relative, prefix: workspaceFolder }
  if (typeof value === "string") {
    const kind = FileLocationKind.fromString(value)
    if (!kind) return null
    if (kind === FileLocationKind.Relative || kind === FileLocationKind.AutoDetect) return { kind, prefix: workspaceFolder }
    if (kind === FileLocationKind.Search) return { kind, prefix: { include: [workspaceFolder] } }
    return { kind }
  }
  if (Array.isArray(value) && value.length > 0) {
    const kind = FileLocationKind.fromString(String(value[0]))
    if (!kind) return null
    if (kind === FileLocationKind.Absolute) return { kind }
    if (kind === FileLocationKind.Relative || kind === FileLocationKind.AutoDetect) {
      return { kind, prefix: typeof value[1] === "string" ? value[1] : workspaceFolder }
    }
    if (kind === FileLocationKind.Search) return { kind, prefix: (value[1] as SearchFileLocationArgs | undefined) || { include: [workspaceFolder] } }
  }
  return null
}

function createFromSeed(name: string, workspaceFolder: string): TaskProblemMatcher | null {
  const seed = matcherRegistry[normalizeRefName(name)]
  if (!seed) return null
  const pattern = resolvePattern(seed.pattern)
  if (!pattern) return null
  return {
    id: `$${normalizeRefName(name)}`,
    owner: seed.owner,
    source: seed.source,
    applyTo: seed.applyTo || ApplyToKind.allDocuments,
    fileLocation: seed.fileLocation || FileLocationKind.Relative,
    filePrefix: seed.filePrefix === "${workspaceFolder}" ? workspaceFolder : seed.filePrefix,
    severity: seed.severity,
    pattern,
  }
}

function resolveExternalMatcher(input: ExternalProblemMatcher, workspaceFolder: string): TaskProblemMatcher | null {
  const base = typeof input.base === "string" ? createFromSeed(input.base, workspaceFolder) : null
  const fileLocation = input.fileLocation !== undefined ? normalizeFileLocation(input.fileLocation, workspaceFolder) : null
  const pattern = input.pattern !== undefined ? resolvePattern(input.pattern) : null
  const inheritedPattern = pattern || base?.pattern
  const inheritedFileLocation = fileLocation?.kind || base?.fileLocation || FileLocationKind.Relative
  const inheritedFilePrefix = fileLocation?.prefix !== undefined ? fileLocation.prefix : base?.filePrefix ?? workspaceFolder
  if (!inheritedPattern) return null
  return {
    id: input.owner || input.source || base?.id || "custom",
    owner: input.owner || base?.owner || "external",
    source: input.source || base?.source || input.owner || "Task",
    applyTo: ApplyToKind.fromString(input.applyTo) || base?.applyTo || ApplyToKind.allDocuments,
    fileLocation: inheritedFileLocation,
    filePrefix: inheritedFilePrefix,
    severity: input.severity || base?.severity,
    pattern: inheritedPattern,
    background: resolveWatchingMatcher(input.background || input.watching) || base?.background,
  }
}

export type ProblemMatcherRef = string | ExternalProblemMatcher | Array<string | ExternalProblemMatcher>

export function normalizeProblemMatcherRefs(value: ProblemMatcherRef | undefined): Array<string | ExternalProblemMatcher> {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export function resolveTaskProblemMatchers(
  value: ProblemMatcherRef | undefined,
  workspaceFolder = "${workspaceFolder}",
): TaskProblemMatcher[] {
  return normalizeProblemMatcherRefs(value).flatMap((entry) => {
    const resolved = typeof entry === "string" ? createFromSeed(entry, workspaceFolder) : resolveExternalMatcher(entry, workspaceFolder)
    return resolved ? [resolved] : []
  })
}

export function createBackgroundProblemState(matchers: readonly TaskProblemMatcher[]): ProblemMatcherBackgroundState {
  return {
    active: matchers.some((matcher) => matcher.background?.activeOnStart === true),
    beginsMatched: false,
    endsMatched: false,
  }
}

export function updateBackgroundProblemState(
  output: string,
  matchers: readonly TaskProblemMatcher[],
  state: ProblemMatcherBackgroundState,
): ProblemMatcherBackgroundState {
  const next = { ...state }
  for (const line of String(output || "").split(/\r?\n/)) {
    for (const matcher of matchers) {
      const background = matcher.background
      if (!background) continue
      const beginsPattern = getWatchingRegExp(background.beginsPattern)
      const endsPattern = getWatchingRegExp(background.endsPattern)
      if (beginsPattern?.test(line)) {
        beginsPattern.lastIndex = 0
        next.active = true
        next.beginsMatched = true
      }
      if (endsPattern?.test(line)) {
        endsPattern.lastIndex = 0
        next.active = false
        next.endsMatched = true
      }
    }
  }
  return next
}

function getWatchingRegExp(pattern: WatchingPattern | RegExp | undefined): RegExp | undefined {
  if (!pattern) return undefined
  if (pattern instanceof RegExp) return pattern
  return pattern.regexp
}
