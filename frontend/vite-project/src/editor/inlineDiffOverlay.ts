// @ts-nocheck
import type * as Monaco from "monaco-editor"

import { computeHunks, type DiffHunk } from "./lineDiff"
import {
  pendingChangeState,
  applyPendingHunk,
  rejectPendingHunk,
  applyPendingBatch,
  rejectPendingBatch,
} from "../workspace/changeQueue"

interface PendingChange {
  path: string
  beforeContent: string | null
  afterContent: string | null
  action: string
}

interface PendingBatch {
  id: string
  title: string
  source: string
  action: string
  createdAt: number
  changes: PendingChange[]
}

interface OverlayState {
  editor: Monaco.editor.IStandaloneCodeEditor
  monaco: typeof Monaco
  decorationIds: string[]
  viewZoneIds: number[]
  currentPath: string | null
}

let state: OverlayState | null = null

export function attachInlineDiffOverlay(
  editor: Monaco.editor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
): () => void {
  state = {
    editor,
    monaco,
    decorationIds: [],
    viewZoneIds: [],
    currentPath: null,
  }
  return () => {
    clearOverlay()
    state = null
  }
}

export function refreshInlineDiff(filePath: string | null): void {
  if (!state) return
  state.currentPath = filePath
  clearOverlay()

  if (!filePath) return
  const batch = findBatchForPath(filePath)
  if (!batch) return
  const change = batch.changes.find((c) => c.path === filePath)
  if (!change) return

  const hunks = computeHunks(change.beforeContent ?? "", change.afterContent ?? "")
  if (hunks.length === 0) return

  renderHunks(batch, change, hunks)
}

function findBatchForPath(filePath: string): PendingBatch | null {
  const batches = pendingChangeState.batches as PendingBatch[]
  for (const batch of batches) {
    if (batch.changes.some((c) => c.path === filePath)) return batch
  }
  return null
}

function clearOverlay(): void {
  if (!state) return
  if (state.decorationIds.length > 0) {
    state.editor.deltaDecorations(state.decorationIds, [])
    state.decorationIds = []
  }
  state.editor.changeViewZones((accessor) => {
    for (const id of state!.viewZoneIds) accessor.removeZone(id)
  })
  state.viewZoneIds = []
}

function renderHunks(batch: PendingBatch, change: PendingChange, hunks: DiffHunk[]): void {
  if (!state) return
  const monaco = state.monaco
  const editor = state.editor

  const decorations: Monaco.editor.IModelDeltaDecoration[] = []

  editor.changeViewZones((accessor) => {
    for (const hunk of hunks) {
      if (hunk.afterLines.length > 0) {
        const start = Math.max(hunk.afterStart, 1)
        const end = Math.max(hunk.afterEnd, start)
        decorations.push({
          range: new monaco.Range(start, 1, end, 1),
          options: {
            isWholeLine: true,
            className: "inline-diff-added-line",
            linesDecorationsClassName: "inline-diff-gutter-added",
            overviewRuler: {
              color: "#34d399",
              position: monaco.editor.OverviewRulerLane.Left,
            },
          },
        })
      }

      if (hunk.beforeLines.length > 0) {
        const removedDom = buildRemovedZone(hunk.beforeLines)
        const zoneId = accessor.addZone({
          afterLineNumber: Math.max(hunk.afterStart - 1, 0),
          heightInLines: hunk.beforeLines.length,
          domNode: removedDom,
        })
        state!.viewZoneIds.push(zoneId)
      }

      const actionsLine = Math.max(hunk.afterStart - 1, 0)
      const actionZoneId = accessor.addZone({
        afterLineNumber: actionsLine,
        heightInLines: 1,
        domNode: buildActionsZone(batch.id, change.path, hunk),
      })
      state!.viewZoneIds.push(actionZoneId)
    }
  })

  state.decorationIds = editor.deltaDecorations([], decorations)
}

function buildRemovedZone(lines: string[]): HTMLElement {
  const root = document.createElement("div")
  root.className = "inline-diff-removed-zone"
  for (const line of lines) {
    const row = document.createElement("div")
    row.className = "inline-diff-removed-line"
    const marker = document.createElement("span")
    marker.className = "inline-diff-marker"
    marker.textContent = "-"
    const text = document.createElement("span")
    text.className = "inline-diff-text"
    text.textContent = line
    row.appendChild(marker)
    row.appendChild(text)
    root.appendChild(row)
  }
  return root
}

function buildActionsZone(batchId: string, path: string, hunk: DiffHunk): HTMLElement {
  const root = document.createElement("div")
  root.className = "inline-diff-actions"

  const label = document.createElement("span")
  label.className = "inline-diff-label"
  const removed = hunk.beforeLines.length
  const added = hunk.afterLines.length
  const parts: string[] = []
  if (added > 0) parts.push(`+${added}`)
  if (removed > 0) parts.push(`-${removed}`)
  label.textContent = `智能改动 ${parts.join(" ")}`
  root.appendChild(label)

  const acceptBtn = document.createElement("button")
  acceptBtn.className = "inline-diff-btn accept"
  acceptBtn.textContent = "采纳 ⌘↵"
  acceptBtn.addEventListener("click", (event) => {
    event.stopPropagation()
    void onAcceptHunk(batchId, path, hunk.id)
  })

  const rejectBtn = document.createElement("button")
  rejectBtn.className = "inline-diff-btn reject"
  rejectBtn.textContent = "拒绝 ⌘⌫"
  rejectBtn.addEventListener("click", (event) => {
    event.stopPropagation()
    void onRejectHunk(batchId, path, hunk.id)
  })

  root.appendChild(acceptBtn)
  root.appendChild(rejectBtn)
  return root
}

async function onAcceptHunk(batchId: string, path: string, hunkId: string): Promise<void> {
  const ok = await applyPendingHunk(batchId, path, hunkId)
  if (ok) refreshInlineDiff(state?.currentPath ?? null)
}

function onRejectHunk(batchId: string, path: string, hunkId: string): void {
  const ok = rejectPendingHunk(batchId, path, hunkId)
  if (ok) refreshInlineDiff(state?.currentPath ?? null)
}

export async function acceptAllForPath(path: string): Promise<void> {
  const batch = findBatchForPath(path)
  if (!batch) return
  await applyPendingBatch(batch.id)
  refreshInlineDiff(state?.currentPath ?? null)
}

export function rejectAllForPath(path: string): void {
  const batch = findBatchForPath(path)
  if (!batch) return
  rejectPendingBatch(batch.id)
  refreshInlineDiff(state?.currentPath ?? null)
}
