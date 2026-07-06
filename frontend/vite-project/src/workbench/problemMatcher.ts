import type { Diagnostic } from "../components/problemState"
import {
  collectTaskProblemMatches,
  createBackgroundProblemState,
  normalizeProblemMatcherRefs,
  resolveTaskProblemMatchers,
  updateBackgroundProblemState,
  type ExternalProblemMatcher as ProblemMatcherConfig,
  type ExternalProblemPattern as ProblemPatternConfig,
  type ExternalWatchingMatcher as ProblemMatcherBackgroundConfig,
  type ProblemMatcherBackgroundState,
  type TaskProblemMatcher,
  type WatchingMatcher,
} from "../vscode-adapter/workbench/contrib/tasks/common/problemMatcher"

export type {
  ProblemMatcherBackgroundConfig,
  ProblemMatcherBackgroundState,
  ProblemMatcherConfig,
  ProblemPatternConfig,
}

export type ProblemMatcherRef = string | ProblemMatcherConfig | Array<string | ProblemMatcherConfig>
export type ResolvedProblemMatcher = TaskProblemMatcher
export type ResolvedProblemMatcherBackground = WatchingMatcher

export interface ResolvedProblemPattern extends Omit<ProblemPatternConfig, "regexp" | "column" | "endColumn"> {
  regexp: RegExp
  character?: number
  endCharacter?: number
}

export { createBackgroundProblemState, normalizeProblemMatcherRefs, updateBackgroundProblemState }

export function resolveProblemMatchers(
  value: ProblemMatcherRef | undefined,
  workspaceFolder = "${workspaceFolder}",
): ResolvedProblemMatcher[] {
  return resolveTaskProblemMatchers(value, workspaceFolder)
}

export function collectProblemDiagnostics(
  output: string,
  matchers: ResolvedProblemMatcher[],
): Diagnostic[] {
  return collectTaskProblemMatches(output, matchers).map(({ marker }) => ({
    file: marker.resource,
    line: marker.line,
    column: marker.column,
    message: marker.code ? `${marker.message} (${marker.code})` : marker.message,
    severity: marker.severity,
    source: marker.source,
    diagnosticSource: marker.source.toLowerCase().includes("eslint") ? "lint" : "compiler",
  }))
}
