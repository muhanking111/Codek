/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/workbench/contrib/tasks/common/problemCollectors.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { makeMarkerKey, sortMarkers } from "../../../../platform/markers/common/markers"
import type { TaskProblemMatcher } from "./problemMatcher"
import { collectTaskProblemMatches, type TaskProblemMarker } from "./problemMatcher"

export type TaskDiagnosticSource = "lint" | "compiler"

export interface TaskDiagnosticLike {
  file: string
  line: number
  column: number
  message: string
  severity: "error" | "warning" | "info" | "ai"
  source?: string
  diagnosticSource?: TaskDiagnosticSource
}

export interface TaskProblemSink<TDiagnostic extends TaskDiagnosticLike> {
  addCompilerDiagnostics: (filePath: string, diagnostics: TDiagnostic[]) => void
  addLintDiagnostics: (filePath: string, diagnostics: TDiagnostic[]) => void
}

export interface TaskProblemCollectorResult<TDiagnostic extends TaskDiagnosticLike> {
  diagnostics: TDiagnostic[]
  byFile: Map<string, TDiagnostic[]>
  byFileAndSource: Map<string, Map<TaskDiagnosticSource, TDiagnostic[]>>
  total: number
  files: string[]
  clearedFiles?: string[]
}

export interface TaskProblemApplyOptions {
  clearFiles?: readonly string[]
}

function sourceKindFromMarker(marker: TaskProblemMarker): TaskDiagnosticSource {
  return marker.source.toLowerCase().includes("eslint") ? "lint" : "compiler"
}

function markerToDiagnostic(marker: TaskProblemMarker): TaskDiagnosticLike {
  const diagnosticSource = sourceKindFromMarker(marker)
  return {
    file: marker.resource,
    line: marker.line,
    column: marker.column,
    message: marker.code ? `${marker.message} (${marker.code})` : marker.message,
    severity: marker.severity,
    source: marker.source,
    diagnosticSource,
  }
}

function markerKey(diagnostic: TaskDiagnosticLike): string {
  return `${diagnostic.file}:${makeMarkerKey({
    source: diagnostic.source || diagnostic.diagnosticSource,
    message: diagnostic.message,
    severity: diagnostic.severity,
    startLineNumber: diagnostic.line,
    startColumn: diagnostic.column,
  })}`
}

function uniqueSortedDiagnostics<TDiagnostic extends TaskDiagnosticLike>(diagnostics: TDiagnostic[]): TDiagnostic[] {
  const seen = new Set<string>()
  const result: TDiagnostic[] = []
  for (const diagnostic of sortMarkers(diagnostics.map((item) => ({
    ...item,
    startLineNumber: item.line,
    startColumn: item.column,
  })))) {
    const key = markerKey(diagnostic)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(diagnostic)
  }
  return result
}

export function collectTaskProblems<TDiagnostic extends TaskDiagnosticLike = TaskDiagnosticLike>(
  output: string,
  problemMatchers: readonly TaskProblemMatcher[] | undefined,
  mapDiagnostic?: (diagnostic: TaskDiagnosticLike) => TDiagnostic,
): TaskProblemCollectorResult<TDiagnostic> {
  if (!problemMatchers?.length) {
    return {
      diagnostics: [],
      byFile: new Map(),
      byFileAndSource: new Map(),
      total: 0,
      files: [],
    }
  }

  const mapper = mapDiagnostic || ((diagnostic: TaskDiagnosticLike) => diagnostic as TDiagnostic)
  const diagnostics = uniqueSortedDiagnostics(
    collectTaskProblemMatches(output, problemMatchers).map(({ marker }) => mapper(markerToDiagnostic(marker))),
  )
  const byFile = new Map<string, TDiagnostic[]>()
  const byFileAndSource = new Map<string, Map<TaskDiagnosticSource, TDiagnostic[]>>()

  for (const diagnostic of diagnostics) {
    const fileGroup = byFile.get(diagnostic.file) || []
    fileGroup.push(diagnostic)
    byFile.set(diagnostic.file, fileGroup)

    const source = diagnostic.diagnosticSource === "lint" ? "lint" : "compiler"
    const sourceGroups = byFileAndSource.get(diagnostic.file) || new Map<TaskDiagnosticSource, TDiagnostic[]>()
    const sourceGroup = sourceGroups.get(source) || []
    sourceGroup.push(diagnostic)
    sourceGroups.set(source, sourceGroup)
    byFileAndSource.set(diagnostic.file, sourceGroups)
  }

  return {
    diagnostics,
    byFile,
    byFileAndSource,
    total: diagnostics.length,
    files: Array.from(byFile.keys()).sort(),
  }
}

export function applyTaskProblems<TDiagnostic extends TaskDiagnosticLike>(
  output: string,
  problemMatchers: readonly TaskProblemMatcher[] | undefined,
  sink: TaskProblemSink<TDiagnostic>,
  mapDiagnostic?: (diagnostic: TaskDiagnosticLike) => TDiagnostic,
  options: TaskProblemApplyOptions = {},
): TaskProblemCollectorResult<TDiagnostic> {
  const result = collectTaskProblems(output, problemMatchers, mapDiagnostic)
  const clearedFiles = uniqueSortedFiles(options.clearFiles || [])
  for (const file of clearedFiles) {
    sink.addLintDiagnostics(file, [])
    sink.addCompilerDiagnostics(file, [])
  }
  for (const [file, sourceGroups] of result.byFileAndSource) {
    const lintItems = sourceGroups.get("lint") || []
    const compilerItems = sourceGroups.get("compiler") || []
    if (lintItems.length > 0) sink.addLintDiagnostics(file, lintItems)
    if (compilerItems.length > 0) sink.addCompilerDiagnostics(file, compilerItems)
  }
  if (clearedFiles.length > 0) result.clearedFiles = clearedFiles
  return result
}

function uniqueSortedFiles(files: readonly string[]): string[] {
  return [...new Set(files.map((file) => String(file || "").trim()).filter(Boolean))].sort()
}
