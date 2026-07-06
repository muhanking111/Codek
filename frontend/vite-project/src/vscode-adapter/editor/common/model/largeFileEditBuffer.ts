/*---------------------------------------------------------------------------------------------
 * VS Code source adapter.
 * Source references:
 * - D:\SourceMirror\vscode\src\vs\editor\common\model\textModel.ts
 * - D:\SourceMirror\vscode\src\vs\editor\common\model\editStack.ts
 * - D:\SourceMirror\vscode\src\vs\editor\common\model\pieceTreeTextBuffer\pieceTreeTextBuffer.ts
 *
 * Codek cannot feed 50MB+ files into a full Monaco TextModel without hitting the
 * same sync/heap limits VS Code protects. This adapter keeps a bounded window
 * as the editable text buffer and emits a single safe replace operation for the
 * real file segment, mirroring VS Code's "validate edits, apply one text
 * change, keep undo/redo data bounded" model at the range-window boundary.
 *--------------------------------------------------------------------------------------------*/

import { OffsetRange } from "../core/ranges/offsetRange"

export interface LargeFileSegmentState {
  readonly path: string
  readonly size: number
  readonly offset: number
  readonly bytesRead: number
  readonly windowBytes: number
  readonly content: string
  readonly fileVersionHash?: string | null
}

export interface LargeFileSegmentPatchPlan {
  readonly path: string
  readonly offset: number
  readonly deleteBytes: number
  readonly insertText: string
  readonly expectedSize: number
  readonly expectedHash: string
  readonly nextSize: number
  readonly safety: "safe-segment-replace"
}

export interface LargeFileSegmentPatchValidation {
  readonly ok: boolean
  readonly reason?: "path-mismatch" | "offset-mismatch" | "size-mismatch" | "hash-mismatch" | "unsafe-window"
  readonly message: string
}

export interface LargeFileEditBufferState extends LargeFileSegmentState {
  readonly previewBytes?: number
  readonly displayBytes?: number
  readonly displayHash?: string | null
  readonly displayTransformed?: boolean
}

export interface LargeFileSegmentEditSnapshot {
  readonly fileSize: number
  readonly segmentContent: string
  readonly rawWindowContent?: string
  readonly displayedContent?: string
  readonly previewBytes?: number
  readonly bytesRead?: number
  readonly windowBytes?: number
  readonly displayBytes?: number
  readonly displayHash?: string | null
  readonly fullWindowHash?: string | null
  readonly displayTransformed?: boolean
}

export interface LargeFileSegmentEditStackItem {
  readonly path: string
  readonly offset: number
  readonly before: LargeFileSegmentEditSnapshot
  readonly after: LargeFileSegmentEditSnapshot
  readonly beforeVersionId: string
  readonly afterVersionId: string
  readonly label: string
  readonly code: "largeFile.segmentEdit"
}

export interface LargeFileSegmentEditStack {
  readonly undo: readonly LargeFileSegmentEditStackItem[]
  readonly redo: readonly LargeFileSegmentEditStackItem[]
}

export interface LargeFileSegmentEditStackItemInput {
  readonly path: string
  readonly offset: number
  readonly before: LargeFileSegmentEditSnapshot
  readonly after: LargeFileSegmentEditSnapshot
  readonly label?: string
}

export interface LargeFileSegmentEditStackPlanInput {
  readonly stack: LargeFileSegmentEditStack
  readonly path: string
  readonly size: number
  readonly offset: number
  readonly currentSegmentContent: string
}

export type LargeFileSegmentEditStackPlanResult =
  | {
    readonly ok: true
    readonly item: LargeFileSegmentEditStackItem
    readonly target: LargeFileSegmentEditSnapshot
    readonly plan: LargeFileSegmentPatchPlan
    readonly nextStack: LargeFileSegmentEditStack
  }
  | {
    readonly ok: false
    readonly reason: "empty-stack" | "validation-failed"
    readonly message: string
    readonly validation?: LargeFileSegmentPatchValidation
  }

export interface LargeFileRememberedWindow {
  readonly rawContent?: string | null
  readonly displayRawContent?: string | null
}

export interface LargeFileEditBufferSaveInput {
  readonly state: LargeFileEditBufferState
  readonly currentEditorContent: string
  readonly nextEditorContent: string
  readonly rememberedWindow?: LargeFileRememberedWindow | null
  readonly normalizeDisplayContent?: (content: string) => string
  readonly displayRenderBytes?: number
}

export type LargeFileEditBufferSaveResult =
  | {
    readonly ok: true
    readonly currentWindowContent: string
    readonly nextSegmentContent: string
    readonly nextDisplayedContent: string
    readonly nextDisplayTransformed: boolean
    readonly nextDisplayBytes: number
    readonly nextDisplayHash: string
    readonly nextRawWindowContent: string
    readonly nextWindowBytesRead: number
    readonly nextFullWindowHash: string
    readonly plan: LargeFileSegmentPatchPlan
  }
  | {
    readonly ok: false
    readonly reason: "unmappable-display" | "validation-failed"
    readonly message: string
    readonly validation?: LargeFileSegmentPatchValidation
  }

export function hashLargeFileSegment(content: string): string {
  const value = String(content ?? "")
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

export function getUtf8ByteLength(content: string): number {
  const value = String(content ?? "")
  let byteLength = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x80) {
      byteLength += 1
    } else if (code < 0x800) {
      byteLength += 2
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        byteLength += 4
        index += 1
      } else {
        byteLength += 3
      }
    } else {
      byteLength += 3
    }
  }
  return byteLength
}

export function buildLargeFileSegmentPatchPlan(
  state: LargeFileSegmentState,
  nextContent: string,
): LargeFileSegmentPatchPlan {
  const currentContent = String(state.content || "")
  const insertText = String(nextContent ?? "")
  const deleteBytes = Math.max(0, Number(state.bytesRead || getUtf8ByteLength(currentContent) || 0))
  const expectedSize = Math.max(0, Number(state.size || 0))
  return {
    path: state.path,
    offset: Math.max(0, Number(state.offset || 0)),
    deleteBytes,
    insertText,
    expectedSize,
    expectedHash: state.fileVersionHash || hashLargeFileSegment(currentContent),
    nextSize: Math.max(0, expectedSize - deleteBytes + getUtf8ByteLength(insertText)),
    safety: "safe-segment-replace",
  }
}

export function validateLargeFileSegmentPatchPlan(input: {
  plan: LargeFileSegmentPatchPlan
  path: string
  size: number
  offset: number
  currentWindowContent: string
  currentHash?: string | null
}): LargeFileSegmentPatchValidation {
  if (input.plan.path !== input.path) {
    return { ok: false, reason: "path-mismatch", message: "大文件分段保存失败：文件路径已经变化。" }
  }
  if (input.plan.offset !== Math.max(0, Number(input.offset || 0))) {
    return { ok: false, reason: "offset-mismatch", message: "大文件分段保存失败：当前窗口位置已经变化。" }
  }
  if (input.plan.expectedSize !== Math.max(0, Number(input.size || 0))) {
    return { ok: false, reason: "size-mismatch", message: "大文件分段保存失败：文件大小已经被外部修改。" }
  }
  const currentHash = input.currentHash || hashLargeFileSegment(input.currentWindowContent)
  if (input.plan.expectedHash !== currentHash) {
    return { ok: false, reason: "hash-mismatch", message: "大文件分段保存失败：当前窗口内容已经变化。" }
  }
  const fileRange = OffsetRange.ofLength(input.plan.expectedSize)
  const patchRange = OffsetRange.tryCreate(input.plan.offset, input.plan.offset + input.plan.deleteBytes)
  if (!patchRange || !fileRange.containsRange(patchRange)) {
    return { ok: false, reason: "unsafe-window", message: "大文件分段保存失败：写回范围不安全。" }
  }
  return { ok: true, message: "大文件分段保存计划可以安全写回。" }
}

export function applyLargeFileSegmentPatchToContent(content: string, plan: LargeFileSegmentPatchPlan): string {
  const value = String(content || "")
  const contentRange = OffsetRange.ofLength(value.length)
  const start = Math.max(0, Math.min(Math.floor(Number(plan.offset) || 0), value.length))
  const deleteBytes = Math.max(0, Math.floor(Number(plan.deleteBytes) || 0))
  const requestedRange = new OffsetRange(start, start + deleteBytes)
  const patchRange = requestedRange.intersect(contentRange) || OffsetRange.emptyAt(value.length)
  return `${value.slice(0, patchRange.start)}${plan.insertText}${value.slice(patchRange.endExclusive)}`
}

function normalizeLargeFileEditSnapshot(snapshot: LargeFileSegmentEditSnapshot): LargeFileSegmentEditSnapshot {
  const segmentContent = String(snapshot.segmentContent ?? "")
  const rawWindowContent = typeof snapshot.rawWindowContent === "string" ? snapshot.rawWindowContent : segmentContent
  const displayedContent = typeof snapshot.displayedContent === "string" ? snapshot.displayedContent : segmentContent
  const bytesRead = Math.max(0, Number(snapshot.bytesRead ?? getUtf8ByteLength(rawWindowContent)))
  const displayBytes = Math.max(0, Number(snapshot.displayBytes ?? getUtf8ByteLength(segmentContent)))
  const fullWindowHash = snapshot.fullWindowHash || hashLargeFileSegment(rawWindowContent)
  const displayHash = snapshot.displayHash || hashLargeFileSegment(segmentContent)
  return {
    fileSize: Math.max(0, Number(snapshot.fileSize || 0)),
    segmentContent,
    rawWindowContent,
    displayedContent,
    previewBytes: Math.max(0, Number(snapshot.previewBytes ?? bytesRead)),
    bytesRead,
    windowBytes: Math.max(0, Number(snapshot.windowBytes ?? bytesRead)),
    displayBytes,
    displayHash,
    fullWindowHash,
    displayTransformed: Boolean(snapshot.displayTransformed ?? (displayedContent !== segmentContent || displayBytes < bytesRead)),
  }
}

function snapshotVersionId(snapshot: LargeFileSegmentEditSnapshot): string {
  return [
    Math.max(0, Number(snapshot.fileSize || 0)),
    hashLargeFileSegment(snapshot.segmentContent),
    snapshot.fullWindowHash || hashLargeFileSegment(snapshot.rawWindowContent || snapshot.segmentContent),
    snapshot.displayHash || hashLargeFileSegment(snapshot.displayedContent || snapshot.segmentContent),
  ].join(":")
}

export function createLargeFileSegmentEditStackItem(input: LargeFileSegmentEditStackItemInput): LargeFileSegmentEditStackItem {
  const before = normalizeLargeFileEditSnapshot(input.before)
  const after = normalizeLargeFileEditSnapshot(input.after)
  return {
    path: String(input.path || ""),
    offset: Math.max(0, Number(input.offset || 0)),
    before,
    after,
    beforeVersionId: snapshotVersionId(before),
    afterVersionId: snapshotVersionId(after),
    label: input.label || "Large File Segment Edit",
    code: "largeFile.segmentEdit",
  }
}

export function pushLargeFileSegmentEditStackItem(
  stack: LargeFileSegmentEditStack,
  item: LargeFileSegmentEditStackItem,
  maxDepth = 100,
): LargeFileSegmentEditStack {
  const undo = [...(stack.undo || []), item]
  const limit = Math.max(1, Math.floor(Number(maxDepth) || 100))
  return {
    undo: undo.slice(Math.max(0, undo.length - limit)),
    redo: [],
  }
}

function createLargeFileSegmentStackPatchPlan(input: {
  readonly item: LargeFileSegmentEditStackItem
  readonly from: LargeFileSegmentEditSnapshot
  readonly to: LargeFileSegmentEditSnapshot
  readonly path: string
  readonly size: number
  readonly offset: number
  readonly currentSegmentContent: string
}): LargeFileSegmentEditStackPlanResult {
  const plan = buildLargeFileSegmentPatchPlan({
    path: input.item.path,
    size: input.from.fileSize,
    offset: input.item.offset,
    bytesRead: getUtf8ByteLength(input.from.segmentContent),
    windowBytes: input.from.windowBytes || getUtf8ByteLength(input.from.segmentContent),
    content: input.from.segmentContent,
    fileVersionHash: hashLargeFileSegment(input.from.segmentContent),
  }, input.to.segmentContent)
  const validation = validateLargeFileSegmentPatchPlan({
    plan,
    path: input.path,
    size: input.size,
    offset: input.offset,
    currentWindowContent: input.currentSegmentContent,
  })
  if (!validation.ok) {
    return {
      ok: false,
      reason: "validation-failed",
      message: validation.message,
      validation,
    }
  }
  return {
    ok: true,
    item: input.item,
    target: input.to,
    plan,
    nextStack: { undo: [], redo: [] },
  }
}

export function createLargeFileSegmentUndoPlan(input: LargeFileSegmentEditStackPlanInput): LargeFileSegmentEditStackPlanResult {
  const undoStack = [...(input.stack.undo || [])]
  const item = undoStack.pop()
  if (!item) {
    return { ok: false, reason: "empty-stack", message: "大文件分段撤销失败：没有可撤销的分段编辑。" }
  }
  const result = createLargeFileSegmentStackPatchPlan({
    item,
    from: item.after,
    to: item.before,
    path: input.path,
    size: input.size,
    offset: input.offset,
    currentSegmentContent: input.currentSegmentContent,
  })
  if (!result.ok) return result
  return {
    ...result,
    nextStack: {
      undo: undoStack,
      redo: [item, ...(input.stack.redo || [])],
    },
  }
}

export function createLargeFileSegmentRedoPlan(input: LargeFileSegmentEditStackPlanInput): LargeFileSegmentEditStackPlanResult {
  const redoStack = [...(input.stack.redo || [])]
  const item = redoStack.shift()
  if (!item) {
    return { ok: false, reason: "empty-stack", message: "大文件分段重做失败：没有可重做的分段编辑。" }
  }
  const result = createLargeFileSegmentStackPatchPlan({
    item,
    from: item.before,
    to: item.after,
    path: input.path,
    size: input.size,
    offset: input.offset,
    currentSegmentContent: input.currentSegmentContent,
  })
  if (!result.ok) return result
  return {
    ...result,
    nextStack: {
      undo: [...(input.stack.undo || []), item],
      redo: redoStack,
    },
  }
}

export function createLargeFileEditBufferSavePlan(input: LargeFileEditBufferSaveInput): LargeFileEditBufferSaveResult {
  const state = input.state
  const normalizeDisplayContent = input.normalizeDisplayContent || ((content: string) => content)
  const displayRenderBytes = Math.max(1, Number(input.displayRenderBytes || Number.MAX_SAFE_INTEGER))
  const displayBytes = Math.max(0, Number(state.displayBytes || 0))
  const displayHash = state.displayHash || null
  const bytesRead = Math.max(0, Number(state.bytesRead || state.previewBytes || 0))
  const hasDisplaySlice = displayBytes > 0 && displayBytes < bytesRead

  let currentWindowContent = String(input.currentEditorContent || "")
  let nextSegmentContent = String(input.nextEditorContent ?? "")
  let nextDisplayedContent = nextSegmentContent
  let nextDisplayTransformed = false
  let rawWindowContentForSave = ""

  if (state.displayTransformed) {
    const rawWindowContent = String(input.rememberedWindow?.rawContent || "")
    const displayRawContent = typeof input.rememberedWindow?.displayRawContent === "string"
      ? String(input.rememberedWindow.displayRawContent)
      : rawWindowContent.slice(0, displayBytes || displayRenderBytes)
    if (!rawWindowContent || (!hasDisplaySlice && /[\r\n]/.test(rawWindowContent))) {
      return {
        ok: false,
        reason: "unmappable-display",
        message: "大文件分段保存失败：当前窗口经过安全换行显示，且无法无损映射回原始文件。",
      }
    }
    rawWindowContentForSave = rawWindowContent
    currentWindowContent = hasDisplaySlice ? displayRawContent : rawWindowContent
    const shouldStripSyntheticLineBreaks = !/[\r\n]/.test(displayRawContent)
    nextSegmentContent = shouldStripSyntheticLineBreaks
      ? nextSegmentContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "")
      : nextSegmentContent
    nextDisplayedContent = normalizeDisplayContent(nextSegmentContent)
    nextDisplayTransformed = nextDisplayedContent !== nextSegmentContent || hasDisplaySlice
  }

  const plan = buildLargeFileSegmentPatchPlan({
    path: state.path,
    size: state.size,
    offset: state.offset || 0,
    bytesRead: hasDisplaySlice ? displayBytes : (state.bytesRead || state.previewBytes || currentWindowContent.length),
    windowBytes: state.windowBytes || state.previewBytes || 1,
    content: currentWindowContent,
    fileVersionHash: hasDisplaySlice ? displayHash : (state.fileVersionHash || null),
  }, nextSegmentContent)

  const validation = validateLargeFileSegmentPatchPlan({
    plan,
    path: state.path,
    size: state.size,
    offset: state.offset || 0,
    currentWindowContent,
    currentHash: hasDisplaySlice ? displayHash : (state.fileVersionHash || null),
  })
  if (!validation.ok) {
    return {
      ok: false,
      reason: "validation-failed",
      message: validation.message,
      validation,
    }
  }

  const nextDisplayBytes = getUtf8ByteLength(nextSegmentContent)
  const nextDisplayHash = hashLargeFileSegment(nextSegmentContent)
  const nextRawWindowContent = hasDisplaySlice && rawWindowContentForSave
    ? applyLargeFileSegmentPatchToContent(rawWindowContentForSave, { ...plan, offset: 0 })
    : plan.insertText
  const nextWindowBytesRead = getUtf8ByteLength(nextRawWindowContent)
  const nextFullWindowHash = hashLargeFileSegment(nextRawWindowContent)

  return {
    ok: true,
    currentWindowContent,
    nextSegmentContent,
    nextDisplayedContent,
    nextDisplayTransformed,
    nextDisplayBytes,
    nextDisplayHash,
    nextRawWindowContent,
    nextWindowBytesRead,
    nextFullWindowHash,
    plan,
  }
}
