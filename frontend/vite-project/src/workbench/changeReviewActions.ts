import { revertChange } from "../workspace/changeHistory"
import {
  applyPendingBatch,
  applyPendingFile,
  applyPendingHunk,
  rejectPendingBatch,
  rejectPendingFile,
  rejectPendingHunk,
} from "../workspace/changeQueue"

export interface ChangeReviewActionContext {
  hasActiveWorkspaceFile: () => boolean
  refreshWorkspaceAnalysis: () => Promise<unknown>
  syncEditorFromWorkspace: () => void
  applyEditorDiagnostics: () => void
}

export async function revertReviewedChange(
  changeId: string,
  context: ChangeReviewActionContext,
): Promise<void> {
  const reverted = await revertChange(changeId)
  if (!reverted) return
  await refreshEditorAfterAppliedChange(context)
}

export async function applyPendingChanges(
  batchId: string,
  context: ChangeReviewActionContext,
): Promise<void> {
  const applied = await applyPendingBatch(batchId)
  if (!applied) return
  await refreshEditorAfterAppliedChange(context)
}

export function rejectPendingChanges(batchId: string): void {
  rejectPendingBatch(batchId)
}

export async function applyPendingChangeFile(
  batchId: string,
  path: string,
  context: ChangeReviewActionContext,
): Promise<void> {
  const applied = await applyPendingFile(batchId, path)
  if (!applied) return
  await refreshEditorAfterAppliedChange(context)
}

export function rejectPendingChangeFile(batchId: string, path: string): void {
  rejectPendingFile(batchId, path)
}

export async function applyPendingChangeHunk(
  batchId: string,
  path: string,
  hunkId: string,
  context: ChangeReviewActionContext,
): Promise<void> {
  const applied = await applyPendingHunk(batchId, path, hunkId)
  if (!applied) return
  await refreshEditorAfterAppliedChange(context)
}

export function rejectPendingChangeHunk(batchId: string, path: string, hunkId: string): void {
  rejectPendingHunk(batchId, path, hunkId)
}

async function refreshEditorAfterAppliedChange(context: ChangeReviewActionContext): Promise<void> {
  await context.refreshWorkspaceAnalysis()
  if (context.hasActiveWorkspaceFile()) {
    context.syncEditorFromWorkspace()
    context.applyEditorDiagnostics()
  }
}
