/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code workspace/bulk edit service shape:
 * - src/vs/workbench/contrib/bulkEdit/browser/bulkEditService.ts
 * - src/vs/editor/common/services/modelEditOperation.ts
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, type CancellationToken as CancellationTokenShape } from "../../../../base/common/cancellation"
import { URI } from "../../../../base/common/uri"
import { Range } from "../../../../editor/common/core/range"
import { PositionOffsetTransformer } from "../../../../editor/common/core/text/positionToOffset"
import {
  CodekUndoRedoService,
  globalUndoRedoService,
  type IResourceUndoRedoElement,
  type IUndoRedoService as UndoRedoServiceShape,
  type IWorkspaceUndoRedoElement,
  UndoRedoElementType,
  UndoRedoGroup,
  UndoRedoSource,
} from "../../../../platform/undoRedo/common/undoRedo"
import { InstantiationType, registerSingleton } from "../../../../platform/instantiation/common/extensions"
import { createDecorator } from "../../../../platform/instantiation/common/instantiation"
import type { BulkEditOptions, BulkEditWorkspaceAccess, ResourceTextEdit, WorkspaceEdit } from "./bulkEditService"

export interface IWorkspaceEditService {
  readonly _serviceBrand: undefined
  apply(edit: WorkspaceEdit | ResourceTextEdit[] | ResourceTextEdit, options?: WorkspaceEditApplyOptions, token?: CancellationTokenShape): Promise<WorkspaceEditApplyResult>
}

export interface WorkspaceEditApplyOptions extends BulkEditOptions {
  readonly undoRedo?: boolean
}

export interface WorkspaceEditFailure {
  readonly resource: string
  readonly message: string
  readonly operation: "read" | "apply" | "save"
  readonly reason: "read-error" | "missing-resource" | "apply-error" | "save-rejected" | "save-error"
  readonly range?: Range
  readonly match?: string
  readonly rollbackRisk: "none" | "partial-write"
}

export interface WorkspaceEditResourceProjection {
  readonly resource: string
  readonly editCount: number
  readonly state: "changed" | "unchanged" | "failed"
  readonly beforePreview?: string
  readonly afterPreview?: string
  readonly failure?: WorkspaceEditFailure
  readonly rollbackAvailable: boolean
  readonly evidence: WorkspaceEditEvidence
}

export interface WorkspaceEditEvidence {
  readonly source: string
  readonly reason: string
  readonly label: string
  readonly match?: string
  readonly metadata?: Record<string, unknown>
}

export interface WorkspaceEditProjection {
  readonly source: "workspaceEditService"
  readonly bulkEditServiceOwner: "CodekBulkEditService"
  readonly workspaceEditOwner: "CodekWorkspaceEditService"
  readonly resourceEditSource: "WorkspaceEdit.edits"
  readonly textFileBridgeOwner: "BulkEditWorkspaceAccess.readFile/saveFile"
  readonly undoRedoOwner: "CodekUndoRedoService"
  readonly remainingEditorUiOwnerGap: "editor-ui-owner-gap"
  readonly label: string
  readonly dryRun: boolean
  readonly resources: readonly WorkspaceEditResourceProjection[]
  readonly changedResources: readonly string[]
  readonly skippedResources: readonly string[]
  readonly failedResources: readonly string[]
  readonly rollbackRisk: "none" | "partial-write"
}

export interface WorkspaceEditUndoRedoHandle {
  readonly source: UndoRedoSource
  readonly group: UndoRedoGroup
  readonly sourceId: number
  readonly groupId: number
  readonly resources: readonly string[]
}

export interface WorkspaceEditApplyResult {
  readonly applied: boolean
  readonly dryRun: boolean
  readonly fileCount: number
  readonly editCount: number
  readonly changedResources: readonly string[]
  readonly skippedResources: readonly string[]
  readonly failures: readonly WorkspaceEditFailure[]
  readonly projection: WorkspaceEditProjection
  readonly undoRedo?: WorkspaceEditUndoRedoHandle
}

interface PendingWorkspaceResourceEdit {
  readonly resource: string
  readonly edits: ResourceTextEdit[]
}

interface AppliedWorkspaceResourceEdit {
  readonly resource: string
  readonly before: string
  readonly after: string
}

export const IWorkspaceEditService = createDecorator<IWorkspaceEditService>("workspaceEditService")

export class CodekWorkspaceEditService implements IWorkspaceEditService {
  declare readonly _serviceBrand: undefined

  private readonly undoRedoService: UndoRedoServiceShape

  constructor(
    private readonly workspaceAccess: BulkEditWorkspaceAccess,
    options: { readonly undoRedoService?: UndoRedoServiceShape } = {},
  ) {
    this.undoRedoService = options.undoRedoService || globalUndoRedoService || new CodekUndoRedoService()
  }

  async apply(
    edit: WorkspaceEdit | ResourceTextEdit[] | ResourceTextEdit,
    options: WorkspaceEditApplyOptions = {},
    token: CancellationTokenShape = CancellationToken.None,
  ): Promise<WorkspaceEditApplyResult> {
    throwIfCancelled(token)
    const edits = normalizeWorkspaceEdits(edit)
    const grouped = groupWorkspaceTextEdits(edits)
    const changedResources: string[] = []
    const skippedResources: string[] = []
    const failures: WorkspaceEditFailure[] = []
    const projections: WorkspaceEditResourceProjection[] = []
    const applied: AppliedWorkspaceResourceEdit[] = []
    const label = options.label || options.reason || "workspace edit"

    for (const group of grouped) {
      throwIfCancelled(token)
      let current: string | null | undefined
      try {
        current = await this.workspaceAccess.readFile(group.resource)
      } catch (error) {
        const failure = createWorkspaceEditFailure(group, "read", "read-error", errorMessage(error), changedResources)
        failures.push(failure)
        projections.push(createFailedProjection(group, failure, options, label))
        continue
      }
      if (typeof current !== "string") {
        const failure = createWorkspaceEditFailure(group, "read", "missing-resource", `Cannot read ${group.resource}`, changedResources)
        failures.push(failure)
        projections.push(createFailedProjection(group, failure, options, label))
        continue
      }

      let next: string
      try {
        next = applyResourceTextEdits(current, group.edits)
      } catch (error) {
        const failure = createWorkspaceEditFailure(group, "apply", "apply-error", errorMessage(error), changedResources)
        failures.push(failure)
        projections.push(createFailedProjection(group, failure, options, label, current))
        continue
      }

      if (next === current) {
        skippedResources.push(group.resource)
        projections.push(createProjection(group, current, next, "unchanged", options, label))
        continue
      }

      if (options.dryRun === true) {
        changedResources.push(group.resource)
        projections.push(createProjection(group, current, next, "changed", options, label))
        continue
      }

      try {
        const saved = await this.workspaceAccess.saveFile(group.resource, next, {
          source: options.source || "user",
          reason: options.reason || label,
          ...(options.saveOptions || {}),
        })
        if (saved === false) {
          const failure = createWorkspaceEditFailure(group, "save", "save-rejected", `Save rejected ${group.resource}`, changedResources)
          failures.push(failure)
          projections.push(createFailedProjection(group, failure, options, label, current, next))
          continue
        }
        changedResources.push(group.resource)
        applied.push({ resource: group.resource, before: current, after: next })
        projections.push(createProjection(group, current, next, "changed", options, label))
      } catch (error) {
        const failure = createWorkspaceEditFailure(group, "save", "save-error", errorMessage(error), changedResources)
        failures.push(failure)
        projections.push(createFailedProjection(group, failure, options, label, current, next))
      }
    }

    const uniqueChanged = uniqueStrings(changedResources)
    const uniqueSkipped = uniqueStrings(skippedResources.filter((path) => !uniqueChanged.includes(path)))
    const failedResources = uniqueStrings(failures.map((failure) => failure.resource))
    const rollbackRisk = uniqueChanged.length && failures.length ? "partial-write" : "none"
    const undoRedo = !options.dryRun && !failures.length && applied.length && options.undoRedo !== false
      ? this.pushUndoRedoElement(applied, label, options)
      : undefined

    return {
      applied: options.dryRun === true ? false : uniqueChanged.length > 0 && failures.length === 0,
      dryRun: options.dryRun === true,
      fileCount: grouped.length,
      editCount: edits.length,
      changedResources: uniqueChanged,
      skippedResources: uniqueSkipped,
      failures,
      projection: {
        source: "workspaceEditService",
        bulkEditServiceOwner: "CodekBulkEditService",
        workspaceEditOwner: "CodekWorkspaceEditService",
        resourceEditSource: "WorkspaceEdit.edits",
        textFileBridgeOwner: "BulkEditWorkspaceAccess.readFile/saveFile",
        undoRedoOwner: "CodekUndoRedoService",
        remainingEditorUiOwnerGap: "editor-ui-owner-gap",
        label,
        dryRun: options.dryRun === true,
        resources: projections,
        changedResources: uniqueChanged,
        skippedResources: uniqueSkipped,
        failedResources,
        rollbackRisk,
      },
      undoRedo,
    }
  }

  private pushUndoRedoElement(
    applied: readonly AppliedWorkspaceResourceEdit[],
    label: string,
    options: WorkspaceEditApplyOptions,
  ): WorkspaceEditUndoRedoHandle {
    const group = new UndoRedoGroup()
    const source = new UndoRedoSource()
    const writeAll = async (kind: "undo" | "redo") => {
      const resources = kind === "undo" ? [...applied].reverse() : [...applied]
      for (const item of resources) {
        const content = kind === "undo" ? item.before : item.after
        await this.workspaceAccess.saveFile(item.resource, content, {
          source: "undoRedo",
          reason: `${kind} ${options.reason || label}`,
        })
      }
    }
    const resources = applied.map((item) => toResourceUri(item.resource))
    const element: IResourceUndoRedoElement | IWorkspaceUndoRedoElement = applied.length === 1
      ? {
        type: UndoRedoElementType.Resource,
        resource: resources[0],
        label,
        code: "workspaceEdit",
        undo: () => writeAll("undo"),
        redo: () => writeAll("redo"),
      } satisfies IResourceUndoRedoElement
      : {
        type: UndoRedoElementType.Workspace,
        resources,
        label,
        code: "workspaceEdit",
        undo: () => writeAll("undo"),
        redo: () => writeAll("redo"),
        split: () => applied.map((item): IResourceUndoRedoElement => ({
          type: UndoRedoElementType.Resource,
          resource: toResourceUri(item.resource),
          label,
          code: "workspaceEdit",
          undo: async () => { await this.workspaceAccess.saveFile(item.resource, item.before, { source: "undoRedo", reason: `undo ${options.reason || label}` }) },
          redo: async () => { await this.workspaceAccess.saveFile(item.resource, item.after, { source: "undoRedo", reason: `redo ${options.reason || label}` }) },
        })),
      }
    this.undoRedoService.pushElement(element, group, source)
    return {
      source,
      group,
      sourceId: source.id,
      groupId: group.id,
      resources: applied.map((item) => item.resource),
    }
  }
}

export const globalWorkspaceEditService = new CodekWorkspaceEditService({
  readFile: async () => null,
  saveFile: async () => false,
}, { undoRedoService: globalUndoRedoService })
registerSingleton(IWorkspaceEditService, globalWorkspaceEditService, InstantiationType.Delayed)

export function applyResourceTextEdits(content: string, edits: readonly ResourceTextEdit[]): string {
  if (!edits.length) return content
  const transformer = new PositionOffsetTransformer(content)
  const sorted = edits
    .map((edit, index) => ({
      edit,
      index,
      offsetRange: transformer.getOffsetRange(Range.lift(edit.range) || new Range(1, 1, 1, 1)),
    }))
    .sort((left, right) => {
      if (right.offsetRange.start !== left.offsetRange.start) return right.offsetRange.start - left.offsetRange.start
      return right.index - left.index
    })

  let next = content
  for (const item of sorted) {
    next = `${next.slice(0, item.offsetRange.start)}${item.edit.text}${next.slice(item.offsetRange.endExclusive)}`
  }
  return next
}

export function normalizeWorkspaceEdits(edit: WorkspaceEdit | ResourceTextEdit[] | ResourceTextEdit): ResourceTextEdit[] {
  if (Array.isArray(edit)) return edit.filter(isResourceTextEdit)
  if (isResourceTextEdit(edit)) return [edit]
  if (Array.isArray(edit?.edits)) return edit.edits.filter(isResourceTextEdit)
  return []
}

export function groupWorkspaceTextEdits(edits: readonly ResourceTextEdit[]): PendingWorkspaceResourceEdit[] {
  const groups = new Map<string, ResourceTextEdit[]>()
  for (const edit of edits) {
    const resource = normalizeResourcePath(edit.resource)
    if (!resource) continue
    const group = groups.get(resource) || []
    group.push({ ...edit, resource })
    groups.set(resource, group)
  }
  return [...groups.entries()].map(([resource, groupEdits]) => ({ resource, edits: groupEdits }))
}

export function normalizeResourcePath(value: string): string {
  return String(value || "").replace(/\\/g, "/").replace(/^file:\/\//, "").replace(/^\/([a-zA-Z]:\/)/, "$1")
}

function createProjection(
  group: PendingWorkspaceResourceEdit,
  before: string,
  after: string,
  state: WorkspaceEditResourceProjection["state"],
  options: WorkspaceEditApplyOptions,
  label: string,
): WorkspaceEditResourceProjection {
  return {
    resource: group.resource,
    editCount: group.edits.length,
    state,
    beforePreview: previewText(before),
    afterPreview: previewText(after),
    rollbackAvailable: state === "changed",
    evidence: createEvidence(group, options, label),
  }
}

function createFailedProjection(
  group: PendingWorkspaceResourceEdit,
  failure: WorkspaceEditFailure,
  options: WorkspaceEditApplyOptions,
  label: string,
  before?: string,
  after?: string,
): WorkspaceEditResourceProjection {
  return {
    resource: group.resource,
    editCount: group.edits.length,
    state: "failed",
    beforePreview: typeof before === "string" ? previewText(before) : undefined,
    afterPreview: typeof after === "string" ? previewText(after) : undefined,
    failure,
    rollbackAvailable: false,
    evidence: createEvidence(group, options, label),
  }
}

function createEvidence(
  group: PendingWorkspaceResourceEdit,
  options: WorkspaceEditApplyOptions,
  label: string,
): WorkspaceEditEvidence {
  const firstEdit = group.edits[0]
  const match = getMatchEvidence(firstEdit)
  return {
    source: options.source || String(firstEdit?.metadata?.source || "user"),
    reason: options.reason || label,
    label,
    match,
    metadata: firstEdit?.metadata,
  }
}

function createWorkspaceEditFailure(
  group: PendingWorkspaceResourceEdit,
  operation: WorkspaceEditFailure["operation"],
  reason: WorkspaceEditFailure["reason"],
  message: string,
  changedResources: readonly string[],
): WorkspaceEditFailure {
  const firstEdit = group.edits[0]
  const liftedRange = Range.lift(firstEdit?.range)
  return {
    resource: group.resource,
    message,
    operation,
    reason,
    range: liftedRange ?? undefined,
    match: getMatchEvidence(firstEdit),
    rollbackRisk: changedResources.length ? "partial-write" : "none",
  }
}

function isResourceTextEdit(value: unknown): value is ResourceTextEdit {
  const candidate = value as ResourceTextEdit | null
  return Boolean(
    candidate &&
    typeof candidate.resource === "string" &&
    Range.isIRange(candidate.range) &&
    typeof candidate.text === "string",
  )
}

function getMatchEvidence(edit: ResourceTextEdit | undefined): string | undefined {
  const metadata = edit?.metadata
  const value = metadata?.match ?? metadata?.preview ?? metadata?.originalText
  return typeof value === "string" && value ? value : undefined
}

function previewText(value: string): string {
  return value.replace(/\r\n/g, "\n").split("\n")[0].slice(0, 200)
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function throwIfCancelled(token: CancellationTokenShape): void {
  if (!token?.isCancellationRequested) return
  const error = new Error("Workspace edit cancelled")
  error.name = "AbortError"
  throw error
}

function errorMessage(error: unknown): string {
  return String((error as Error)?.message || error)
}

function toResourceUri(resource: string): URI {
  const normalized = normalizeResourcePath(resource)
  return /^\w[\w\d+.-]*:/.test(normalized) ? URI.parse(normalized) : URI.file(normalized)
}
