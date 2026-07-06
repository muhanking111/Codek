import type { Diagnostic } from "../components/problemState"
import {
  applyTaskProblems,
  collectTaskProblems,
  type TaskProblemSink,
  type TaskDiagnosticLike,
} from "../vscode-adapter/workbench/contrib/tasks/common/problemCollector"
import type { ResolvedProblemMatcher } from "./problemMatcher"

type TaskDiagnostic = Diagnostic & TaskDiagnosticLike

export type TaskProblemStateLike = TaskProblemSink<TaskDiagnostic>

export interface TaskProblemApplyResult {
  total: number
  files: string[]
  clearedFiles?: string[]
}

export interface TaskProblemApplyOptions {
  clearFiles?: readonly string[]
}

export function collectTaskProblemDiagnostics(
  output: string,
  problemMatchers: ResolvedProblemMatcher[] | undefined,
): Diagnostic[] {
  return collectTaskProblems<TaskDiagnostic>(output, problemMatchers).diagnostics
}

export function applyTaskProblemDiagnostics(
  output: string,
  problemMatchers: ResolvedProblemMatcher[] | undefined,
  problemState: TaskProblemStateLike,
  options: TaskProblemApplyOptions = {},
): TaskProblemApplyResult {
  const result = applyTaskProblems<TaskDiagnostic>(output, problemMatchers, problemState, undefined, options)
  const projected: TaskProblemApplyResult = {
    total: result.total,
    files: result.files,
  }
  if (result.clearedFiles?.length) projected.clearedFiles = result.clearedFiles
  return projected
}
