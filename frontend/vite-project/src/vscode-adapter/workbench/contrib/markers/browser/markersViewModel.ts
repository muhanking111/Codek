/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code:
 * - src/vs/workbench/contrib/markers/browser/markersModel.ts
 * - src/vs/workbench/contrib/markers/browser/markersTreeViewer.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import {
  MarkerSeverity,
  compareMarkerSeverity,
  normalizeMarkerData,
  toCodekSeverity,
  toMarkerSeverity,
  type CodekMarkerSeverity,
} from "../../../../platform/markers/common/markers"

export type ProblemDiagnosticSource = "monaco" | "lsp" | "lint" | "compiler"
export type ProblemDiagnosticSourceKey = ProblemDiagnosticSource | "other"

export interface ProblemDiagnosticLike {
  file: string
  line: number
  column: number
  message: string
  severity: CodekMarkerSeverity
  source?: string
  diagnosticSource?: ProblemDiagnosticSource
}

export interface ProblemFileGroup<TDiagnostic extends ProblemDiagnosticLike = ProblemDiagnosticLike> {
  id: string
  file: string
  name: string
  path: string
  errorCount: number
  warningCount: number
  infoCount: number
  aiCount: number
  total: number
  items: TDiagnostic[]
}

export interface ProblemSourceGroup<TDiagnostic extends ProblemDiagnosticLike = ProblemDiagnosticLike> {
  source: ProblemDiagnosticSourceKey
  label: string
  icon: string
  color: string
  items: TDiagnostic[]
  fileGroups: Array<ProblemFileGroup<TDiagnostic>>
}

export interface ProblemSeverityFilterDef {
  severity: CodekMarkerSeverity
  icon: string
  label: string
  count: number
}

export interface ProblemSourceFilterDef {
  source: ProblemDiagnosticSourceKey
  icon: string
  label: string
  color: string
  count: number
}

export interface ProblemMarkersFilterState {
  severities?: ReadonlySet<CodekMarkerSeverity>
  sources?: ReadonlySet<ProblemDiagnosticSourceKey>
}

export interface ProblemMarkersViewModel<TDiagnostic extends ProblemDiagnosticLike = ProblemDiagnosticLike> {
  total: number
  visibleTotal: number
  severityCounts: Record<CodekMarkerSeverity, number>
  sourceCounts: Record<ProblemDiagnosticSourceKey, number>
  sourceGroups: Array<ProblemSourceGroup<TDiagnostic>>
}

export const PROBLEM_SOURCE_ORDER: readonly ProblemDiagnosticSourceKey[] = [
  "compiler",
  "lsp",
  "lint",
  "monaco",
  "other",
]

const PROBLEM_SEVERITY_ORDER: readonly CodekMarkerSeverity[] = ["error", "warning", "info", "ai"]

export const problemSourceMetadata: Record<ProblemDiagnosticSourceKey, Omit<ProblemSourceFilterDef, "source" | "count">> = {
  compiler: {
    icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m10.5 11 1.8-1.8-1.8-1.8M5.5 11 3.7 9.2l1.8-1.8"/><rect x="2.5" y="3" width="11" height="10" rx="1.5"/></svg>',
    label: "Compiler",
    color: "#f87171",
  },
  lsp: {
    icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="2"/><path d="M8 2.5v2M8 11.5v2M2.5 8h2M11.5 8h2"/></svg>',
    label: "Language Server",
    color: "#a78bfa",
  },
  lint: {
    icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7.2 2.8h5.2L8.8 13.2H3.6L7.2 2.8Z"/><path d="M6.3 9.8h4.1"/></svg>',
    label: "检查器",
    color: "#f59e0b",
  },
  monaco: {
    icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="10" height="10" rx="1.5"/><path d="m6 6 4 4M10 6l-4 4"/></svg>',
    label: "编辑器",
    color: "#60a5fa",
  },
  other: {
    icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="4" cy="8" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="12" cy="8" r="1.1"/></svg>',
    label: "其他",
    color: "#6b7280",
  },
}

const problemSeverityMetadata: Record<CodekMarkerSeverity, Omit<ProblemSeverityFilterDef, "severity" | "count">> = {
  error: { icon: "\u2715", label: "错误" },
  warning: { icon: "\u26A0", label: "告警" },
  info: { icon: "\u24D8", label: "信息" },
  ai: { icon: "\u2728", label: "智能" },
}

export function createProblemMarkersViewModel<TDiagnostic extends ProblemDiagnosticLike>(
  diagnostics: readonly TDiagnostic[],
  filters: ProblemMarkersFilterState = {},
): ProblemMarkersViewModel<TDiagnostic> {
  const allDiagnostics = buildProblemResourceMarkers(diagnostics)
  const severityCounts = createEmptySeverityCounts()
  const sourceCounts = createEmptySourceCounts()

  for (const diagnostic of allDiagnostics) {
    severityCounts[diagnostic.severity] += 1
    sourceCounts[getProblemDiagnosticSourceKey(diagnostic)] += 1
  }

  const sourceGroups: Array<ProblemSourceGroup<TDiagnostic>> = []
  const sourceDiagnostics = new Map<ProblemDiagnosticSourceKey, TDiagnostic[]>()

  for (const diagnostic of allDiagnostics) {
    if (filters.severities && !filters.severities.has(diagnostic.severity)) continue

    const source = getProblemDiagnosticSourceKey(diagnostic)
    if (filters.sources && !filters.sources.has(source)) continue

    const existing = sourceDiagnostics.get(source)
    if (existing) existing.push(diagnostic)
    else sourceDiagnostics.set(source, [diagnostic])
  }

  for (const source of PROBLEM_SOURCE_ORDER) {
    const items = sourceDiagnostics.get(source)
    if (!items?.length) continue

    sourceGroups.push({
      source,
      ...problemSourceMetadata[source],
      items,
      fileGroups: createProblemFileGroups(items),
    })
  }

  return {
    total: allDiagnostics.length,
    visibleTotal: sourceGroups.reduce((total, group) => total + group.items.length, 0),
    severityCounts,
    sourceCounts,
    sourceGroups,
  }
}

export function createProblemSeverityFilterDefs(counts: Record<CodekMarkerSeverity, number>): ProblemSeverityFilterDef[] {
  return PROBLEM_SEVERITY_ORDER.map((severity) => ({
    severity,
    ...problemSeverityMetadata[severity],
    count: counts[severity],
  }))
}

export function createProblemSourceFilterDefs(
  counts: Record<ProblemDiagnosticSourceKey, number>,
): ProblemSourceFilterDef[] {
  return PROBLEM_SOURCE_ORDER.map((source) => ({
    source,
    ...problemSourceMetadata[source],
    count: counts[source],
  }))
}

export function getProblemDiagnosticSourceKey(diag: ProblemDiagnosticLike): ProblemDiagnosticSourceKey {
  if (diag.diagnosticSource) return diag.diagnosticSource

  const source = diag.source?.trim().toLowerCase()
  if (!source) return "monaco"
  if (source === "ai" || source === "智能扫描" || source === "智能") return "other"
  if (source === "linter" || source.includes("lint") || source.includes("eslint") || source.includes("stylelint")) return "lint"
  if (source === "language server" || source === "lsp" || source.includes("typescript") || source.includes("tsserver")) return "lsp"
  if (source.includes("compiler") || source.includes("tsc") || source.includes("vue-tsc")) return "compiler"
  return "monaco"
}

function buildProblemResourceMarkers<TDiagnostic extends ProblemDiagnosticLike>(
  diagnostics: readonly TDiagnostic[],
): TDiagnostic[] {
  const byFile = new Map<string, TDiagnostic[]>()

  for (const diagnostic of sortProblemDiagnostics(diagnostics)) {
    const markerKey = makeProblemMarkerIdentity(diagnostic)
    const fileMarkers = byFile.get(diagnostic.file) || []
    if (!fileMarkers.some((existing) => makeProblemMarkerIdentity(existing) === markerKey)) {
      fileMarkers.push(diagnostic)
      byFile.set(diagnostic.file, fileMarkers)
    }
  }

  return [...byFile.entries()]
    .sort((left, right) => compareResourceMarkerGroups(left[1], right[1], left[0], right[0]))
    .flatMap(([, markers]) => markers)
}

function createProblemFileGroups<TDiagnostic extends ProblemDiagnosticLike>(
  diagnostics: readonly TDiagnostic[],
): Array<ProblemFileGroup<TDiagnostic>> {
  const groupsByFile = new Map<string, ProblemFileGroup<TDiagnostic>>()

  for (const diagnostic of diagnostics) {
    let group = groupsByFile.get(diagnostic.file)
    if (!group) {
      group = {
        id: diagnostic.file,
        file: diagnostic.file,
        name: basename(diagnostic.file),
        path: diagnostic.file,
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
        aiCount: 0,
        total: 0,
        items: [],
      }
      groupsByFile.set(diagnostic.file, group)
    }

    group.items.push(diagnostic)
    group.total += 1
    if (diagnostic.severity === "error") group.errorCount += 1
    else if (diagnostic.severity === "warning") group.warningCount += 1
    else if (diagnostic.severity === "info") group.infoCount += 1
    else group.aiCount += 1
  }

  return [...groupsByFile.values()]
}

function sortProblemDiagnostics<TDiagnostic extends ProblemDiagnosticLike>(
  diagnostics: readonly TDiagnostic[],
): TDiagnostic[] {
  return [...diagnostics].sort((left, right) => compareProblemDiagnostics(left, right))
}

function compareProblemDiagnostics(left: ProblemDiagnosticLike, right: ProblemDiagnosticLike): number {
  const severity = compareMarkerSeverity(toMarkerSeverity(left.severity), toMarkerSeverity(right.severity))
  if (severity !== 0) return severity

  const resource = left.file.localeCompare(right.file)
  if (resource !== 0) return resource

  const leftRange = normalizeMarkerData({
    severity: left.severity,
    message: left.message,
    source: left.source,
    startLineNumber: left.line,
    startColumn: left.column,
  })
  const rightRange = normalizeMarkerData({
    severity: right.severity,
    message: right.message,
    source: right.source,
    startLineNumber: right.line,
    startColumn: right.column,
  })

  return leftRange.startLineNumber - rightRange.startLineNumber || leftRange.startColumn - rightRange.startColumn
}

function compareResourceMarkerGroups<TDiagnostic extends ProblemDiagnosticLike>(
  leftMarkers: readonly TDiagnostic[],
  rightMarkers: readonly TDiagnostic[],
  leftFile: string,
  rightFile: string,
): number {
  const leftFirst = leftMarkers[0]
  const rightFirst = rightMarkers[0]
  if (leftFirst && rightFirst) {
    const severity = compareMarkerSeverity(toMarkerSeverity(leftFirst.severity), toMarkerSeverity(rightFirst.severity))
    if (severity !== 0) return severity
  }
  return leftFile.localeCompare(rightFile) || basename(leftFile).localeCompare(basename(rightFile))
}

function makeProblemMarkerIdentity(diagnostic: ProblemDiagnosticLike): string {
  return `${diagnostic.file}:${makeMarkersModelKey({
    source: diagnostic.source || diagnostic.diagnosticSource,
    message: diagnostic.message,
    severity: toMarkerSeverity(diagnostic.severity),
    startLineNumber: diagnostic.line,
    startColumn: diagnostic.column,
  })}:${diagnostic.file}`
}

function makeMarkersModelKey(marker: {
  source?: string
  message: string
  severity: MarkerSeverity
  startLineNumber: number
  startColumn: number
  endLineNumber?: number
  endColumn?: number
  code?: string | number | { value: string }
}): string {
  const normalized = normalizeMarkerData(marker)
  const code = normalized.code && typeof normalized.code === "object" ? normalized.code.value : normalized.code
  return [
    "",
    escapeMarkerKeyPart(normalized.source || ""),
    escapeMarkerKeyPart(code == null ? "" : String(code)),
    markerSeverityLabel(normalized.severity),
    escapeMarkerKeyPart(normalized.message),
    String(normalized.startLineNumber),
    String(normalized.startColumn),
    String(normalized.endLineNumber),
    String(normalized.endColumn),
    "",
  ].join("¦")
}

function markerSeverityLabel(severity: MarkerSeverity): string {
  if (severity === MarkerSeverity.Error) return "Error"
  if (severity === MarkerSeverity.Warning) return "Warning"
  if (severity === MarkerSeverity.Info) return "Info"
  return ""
}

function escapeMarkerKeyPart(value: string): string {
  return value.replace(/¦/g, "\\¦")
}

function createEmptySeverityCounts(): Record<CodekMarkerSeverity, number> {
  return {
    error: 0,
    warning: 0,
    info: 0,
    ai: 0,
  }
}

function createEmptySourceCounts(): Record<ProblemDiagnosticSourceKey, number> {
  return {
    compiler: 0,
    lsp: 0,
    lint: 0,
    monaco: 0,
    other: 0,
  }
}

function basename(file: string): string {
  const normalized = file.replace(/\\/g, "/")
  const index = normalized.lastIndexOf("/")
  return index >= 0 ? normalized.slice(index + 1) : normalized
}

export { MarkerSeverity, toCodekSeverity }
