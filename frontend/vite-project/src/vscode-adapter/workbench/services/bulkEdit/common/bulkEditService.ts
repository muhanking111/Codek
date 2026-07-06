/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code bulk edit service shape:
 * - src/vs/editor/browser/services/bulkEditService.ts
 * - src/vs/workbench/contrib/bulkEdit/browser/bulkEditService.ts
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, type CancellationToken as CancellationTokenShape } from "../../../../base/common/cancellation"
import type { IRange } from "../../../../editor/common/core/range"
import { createDecorator } from "../../../../platform/instantiation/common/instantiation"
import { InstantiationType, registerSingleton } from "../../../../platform/instantiation/common/extensions"
import {
  applyResourceTextEdits,
  CodekWorkspaceEditService,
  type WorkspaceEditProjection,
  type WorkspaceEditUndoRedoHandle,
} from "./workspaceEditService"

export interface IBulkEditService {
  readonly _serviceBrand: undefined
  apply(edit: WorkspaceEdit | ResourceTextEdit[] | ResourceTextEdit, options?: BulkEditOptions, token?: CancellationTokenShape): Promise<BulkEditResult>
}

export interface WorkspaceEdit {
  readonly edits: readonly ResourceTextEdit[]
}

export interface ResourceTextEdit {
  readonly resource: string
  readonly range: IRange
  readonly text: string
  readonly metadata?: Record<string, unknown>
}

export interface BulkEditOptions {
  readonly dryRun?: boolean
  readonly label?: string
  readonly source?: string
  readonly reason?: string
  readonly saveOptions?: Record<string, unknown>
  readonly throwOnFailure?: boolean
}

export interface BulkEditFailure {
  readonly resource: string
  readonly message: string
  readonly operation: "read" | "apply" | "save"
  readonly reason: "read-error" | "missing-resource" | "apply-error" | "save-rejected" | "save-error"
  readonly range?: IRange
  readonly match?: string
  readonly rollbackRisk: "none" | "partial-write"
}

export interface BulkEditSummary {
  readonly fileCount: number
  readonly editCount: number
  readonly changedFileCount: number
  readonly skippedFileCount: number
  readonly failureCount: number
  readonly changedFiles: string[]
  readonly skippedFiles: string[]
  readonly failures: BulkEditFailure[]
  readonly riskLevel: "safe" | "medium" | "high"
  readonly rollbackDescription: string
}

export interface BulkEditResult {
  readonly applied: boolean
  readonly dryRun: boolean
  readonly summary: BulkEditSummary
  readonly projection?: WorkspaceEditProjection
  readonly undoRedo?: WorkspaceEditUndoRedoHandle
}

export interface BulkEditWorkspaceAccess {
  readonly readFile: (path: string) => Promise<string | null | undefined> | string | null | undefined
  readonly saveFile: (path: string, content: string, options?: Record<string, unknown>) => Promise<boolean | void> | boolean | void
}

export const IBulkEditService = createDecorator<IBulkEditService>("bulkEditService")

export class CodekBulkEditService implements IBulkEditService {
  declare readonly _serviceBrand: undefined

  private readonly workspaceEditService: CodekWorkspaceEditService

  constructor(workspaceAccess: BulkEditWorkspaceAccess = createNoopWorkspaceAccess()) {
    this.workspaceEditService = new CodekWorkspaceEditService(workspaceAccess)
  }

  async apply(
    edit: WorkspaceEdit | ResourceTextEdit[] | ResourceTextEdit,
    options: BulkEditOptions = {},
    token: CancellationTokenShape = CancellationToken.None,
  ): Promise<BulkEditResult> {
    throwIfCancelled(token)
    const result = await this.workspaceEditService.apply(edit, {
      ...options,
      label: options.label || "bulk edit",
    }, token)
    const failures: BulkEditFailure[] = result.failures.map((failure) => ({ ...failure }))

    const summary = createBulkEditSummary({
      fileCount: result.fileCount,
      editCount: result.editCount,
      changedFiles: [...result.changedResources],
      skippedFiles: [...result.skippedResources],
      failures,
    })
    if (options.throwOnFailure && failures.length) {
      throw new Error(`Bulk edit failed: ${failures.map((failure) => `${failure.resource}: ${failure.message}`).join("; ")}`)
    }
    return {
      applied: result.applied,
      dryRun: result.dryRun,
      summary,
      projection: result.projection,
      undoRedo: result.undoRedo,
    }
  }
}

export const globalBulkEditService = new CodekBulkEditService()
registerSingleton(IBulkEditService, globalBulkEditService, InstantiationType.Delayed)

export { applyResourceTextEdits }

function createBulkEditSummary({
  fileCount,
  editCount,
  changedFiles,
  skippedFiles,
  failures,
}: {
  fileCount: number
  editCount: number
  changedFiles: string[]
  skippedFiles: string[]
  failures: BulkEditFailure[]
}): BulkEditSummary {
  const uniqueChanged = uniqueStrings(changedFiles)
  const uniqueSkipped = uniqueStrings(skippedFiles.filter((path) => !uniqueChanged.includes(path)))
  const riskLevel = failures.length > 0
    ? "high"
    : uniqueChanged.length > 1 || editCount > 1
      ? "medium"
      : "safe"
  return {
    fileCount,
    editCount,
    changedFileCount: uniqueChanged.length,
    skippedFileCount: uniqueSkipped.length,
    failureCount: failures.length,
    changedFiles: uniqueChanged,
    skippedFiles: uniqueSkipped,
    failures,
    riskLevel,
    rollbackDescription: describeRollbackRisk(uniqueChanged, failures),
  }
}

function describeRollbackRisk(changedFiles: readonly string[], failures: readonly BulkEditFailure[]): string {
  if (changedFiles.length && failures.length) {
    return `部分文件已经写入，必须先复核工作区 diff 再继续：已写入 ${changedFiles.join(", ")}；失败 ${failures.map((failure) => failure.resource).join(", ")}。可按保存前内容或 dry-run 摘要对已写入文件逐个回滚。`
  }
  if (changedFiles.length) {
    return "可通过保存前内容或 dry-run 摘要重新运行相反补丁；若已落盘，按工作区 diff 逐文件回滚。"
  }
  return "没有写入工作区；无需回滚。"
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function throwIfCancelled(token: CancellationTokenShape): void {
  if (!token?.isCancellationRequested) return
  const error = new Error("Bulk edit cancelled")
  error.name = "AbortError"
  throw error
}

function createNoopWorkspaceAccess(): BulkEditWorkspaceAccess {
  return {
    readFile: async () => null,
    saveFile: async () => false,
  }
}
