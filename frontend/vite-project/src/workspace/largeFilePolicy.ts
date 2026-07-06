export const VSCODE_TOKENIZATION_LARGE_FILE_BYTES = 20 * 1024 * 1024
export const VSCODE_MODEL_SYNC_LIMIT_BYTES = 50 * 1024 * 1024
export const LARGE_FILE_LINE_COUNT = 300_000
export const LARGE_FILE_HEAP_OPERATION_BYTES = 256 * 1024 * 1024
export const LOCAL_LARGE_FILE_CONFIRMATION_BYTES = 1024 * 1024 * 1024
export const EDITABLE_FILE_BYTES = LOCAL_LARGE_FILE_CONFIRMATION_BYTES
export const LARGE_FILE_PREVIEW_BYTES = 8 * 1024 * 1024
export const LARGE_FILE_MAX_WINDOW_BYTES = 32 * 1024 * 1024
export const LARGE_FILE_HARD_BYTES = LOCAL_LARGE_FILE_CONFIRMATION_BYTES
export const LARGE_FILE_WINDOW_BYTES = LARGE_FILE_PREVIEW_BYTES

export type LargeFileMode = "normal" | "optimized" | "range"

export interface LargeFileDecision {
  readonly mode: LargeFileMode
  readonly readOnly: boolean
  readonly maxBytes: number
  readonly readBytes: number
  readonly previewBytes: number
  readonly truncated: boolean
  readonly reason: "normal" | "optimized-full-read" | "range-read"
}

export interface LargeFileWindow {
  readonly offset: number
  readonly length: number
}

export interface LargeFileRangeState {
  readonly path: string
  readonly size: number
  readonly limit: number
  readonly previewBytes: number
  readonly bytesRead: number
  readonly offset: number
  readonly windowBytes: number
  readonly hasPrevious: boolean
  readonly hasNext: boolean
  readonly virtualStartLine: number
  readonly sourceStartLine?: number
  readonly fileVersionHash?: string | null
  readonly fullWindowHash?: string | null
  readonly displayBytes?: number
  readonly displayHash?: string | null
  readonly displayTransformed?: boolean
  readonly sourceLineAdvance?: number
  readonly renderedLineAdvance?: number
  readonly renderedLineCount?: number
  readonly mode: "range"
  readonly readOnly: boolean
  readonly truncated: boolean
  readonly reason: "range-read"
}

export interface LargeFileOptimizedState {
  readonly path: string
  readonly size: number
  readonly limit: number
  readonly previewBytes: number
  readonly bytesRead: number
  readonly offset: 0
  readonly windowBytes: number
  readonly hasPrevious: false
  readonly hasNext: false
  readonly virtualStartLine: 1
  readonly mode: "optimized"
  readonly readOnly: boolean
  readonly truncated: false
  readonly reason: "optimized-full-read"
}

export interface LargeFileReadOptions {
  readonly maxBytes: number
  readonly preview?: boolean
  readonly previewBytes?: number
  readonly length?: number
  readonly offset?: number
}

export interface LargeFileOpenPlan {
  readonly decision: LargeFileDecision
  readonly readOptions: LargeFileReadOptions
  readonly editorMode: "editable-full-content" | "optimized-full-content" | "editable-byte-window"
  readonly userVisibleKind: "normal-text-editor" | "range-text-editor"
}

export function buildLargeFileReadOptions(decision: LargeFileDecision): LargeFileReadOptions {
  if (decision.mode !== "range") {
    return {
      maxBytes: decision.maxBytes,
    }
  }
  return {
    maxBytes: decision.maxBytes,
    previewBytes: decision.previewBytes,
    length: decision.previewBytes,
    offset: 0,
    preview: true,
  }
}

export function buildLargeFileOpenPlan(size: number): LargeFileOpenPlan {
  const decision = decideLargeFileOpen(size)
  return {
    decision,
    readOptions: buildLargeFileReadOptions(decision),
    editorMode: decision.mode === "range"
      ? "editable-byte-window"
      : (decision.mode === "optimized" ? "optimized-full-content" : "editable-full-content"),
    userVisibleKind: decision.mode === "range" ? "range-text-editor" : "normal-text-editor",
  }
}

export function decideLargeFileOpen(size: number): LargeFileDecision {
  const safeSize = Math.max(0, Number(size) || 0)
  if (safeSize > VSCODE_MODEL_SYNC_LIMIT_BYTES) {
    const windowBytes = getLargeFileWindowBytes(safeSize)
    return {
      mode: "range",
      readOnly: false,
      maxBytes: windowBytes,
      readBytes: windowBytes,
      previewBytes: windowBytes,
      truncated: true,
      reason: "range-read",
    }
  }
  if (safeSize > VSCODE_TOKENIZATION_LARGE_FILE_BYTES) {
    return {
      mode: "optimized",
      readOnly: false,
      maxBytes: EDITABLE_FILE_BYTES,
      readBytes: safeSize,
      previewBytes: safeSize,
      truncated: false,
      reason: "optimized-full-read",
    }
  }
  return {
    mode: "normal",
    readOnly: false,
    maxBytes: EDITABLE_FILE_BYTES,
    readBytes: safeSize,
    previewBytes: safeSize,
    truncated: false,
    reason: "normal",
  }
}

export function getLargeFileWindowBytes(size: number): number {
  const safeSize = Math.max(0, Number(size) || 0)
  if (!safeSize) return LARGE_FILE_WINDOW_BYTES
  const proportionalWindow = Math.ceil(safeSize / 2)
  return Math.max(
    LARGE_FILE_WINDOW_BYTES,
    Math.min(LARGE_FILE_MAX_WINDOW_BYTES, proportionalWindow, safeSize),
  )
}

export function clampLargeFileWindow(size: number, offset: number, length?: number): LargeFileWindow {
  const safeSize = Math.max(0, Number(size) || 0)
  const defaultLength = getLargeFileWindowBytes(safeSize)
  const safeLength = Math.max(1, Math.min(Number(length) || defaultLength, LARGE_FILE_MAX_WINDOW_BYTES, safeSize || defaultLength))
  const maxOffset = Math.max(0, safeSize - safeLength)
  const safeOffset = Math.max(0, Math.min(Math.floor(Number(offset) || 0), maxOffset))
  return {
    offset: safeOffset,
    length: safeLength,
  }
}

export function buildLargeFileRangeState(input: {
  path: string
  size: number
  limit?: number
  previewBytes?: number
  bytesRead?: number
  offset?: number
  windowBytes?: number
  virtualStartLine?: number
  sourceStartLine?: number
  fileVersionHash?: string | null
  fullWindowHash?: string | null
  displayBytes?: number
  displayHash?: string | null
  displayTransformed?: boolean
  sourceLineAdvance?: number
  renderedLineAdvance?: number
  renderedLineCount?: number
}): LargeFileRangeState {
  const size = Math.max(0, Number(input.size) || 0)
  const offset = Math.max(0, Number(input.offset) || 0)
  const bytesRead = Math.max(0, Number(input.bytesRead || input.previewBytes || 0))
  const windowBytes = Math.max(1, Number(input.windowBytes || input.previewBytes || LARGE_FILE_WINDOW_BYTES))
  return {
    path: input.path,
    size,
    limit: Number(input.limit || LARGE_FILE_PREVIEW_BYTES),
    previewBytes: bytesRead,
    bytesRead,
    offset,
    windowBytes,
    hasPrevious: offset > 0,
    hasNext: offset + bytesRead < size,
    virtualStartLine: Math.max(1, Math.floor(Number(input.virtualStartLine || 1))),
    sourceStartLine: Math.max(1, Math.floor(Number(input.sourceStartLine || input.virtualStartLine || 1))),
    fileVersionHash: input.fileVersionHash || null,
    fullWindowHash: input.fullWindowHash || input.fileVersionHash || null,
    displayBytes: Math.max(0, Number(input.displayBytes || 0)),
    displayHash: input.displayHash || null,
    displayTransformed: Boolean(input.displayTransformed),
    sourceLineAdvance: Math.max(0, Math.floor(Number(input.sourceLineAdvance || 0))),
    renderedLineAdvance: Math.max(0, Math.floor(Number(input.renderedLineAdvance || 0))),
    renderedLineCount: Math.max(0, Math.floor(Number(input.renderedLineCount || 0))),
    mode: "range",
    readOnly: false,
    truncated: true,
    reason: "range-read",
  }
}

export function buildLargeFileOptimizedState(input: {
  path: string
  size: number
  limit?: number
}): LargeFileOptimizedState {
  const size = Math.max(0, Number(input.size) || 0)
  const limit = Math.max(size, Number(input.limit || LOCAL_LARGE_FILE_CONFIRMATION_BYTES))
  return {
    path: input.path,
    size,
    limit,
    previewBytes: size,
    bytesRead: size,
    offset: 0,
    windowBytes: size,
    hasPrevious: false,
    hasNext: false,
    virtualStartLine: 1,
    mode: "optimized",
    readOnly: false,
    truncated: false,
    reason: "optimized-full-read",
  }
}

export function getLargeFileWindowTargetOffset(
  state: Pick<LargeFileRangeState, "offset" | "windowBytes" | "size"> | null | undefined,
  direction: "previous" | "next",
): number {
  if (!state) return 0
  const offset = Number(state.offset || 0)
  const windowBytes = Number(state.windowBytes || LARGE_FILE_WINDOW_BYTES)
  const nextOffset = direction === "previous" ? offset - windowBytes : offset + windowBytes
  return clampLargeFileWindow(Number(state.size || 0), nextOffset, windowBytes).offset
}

export function isLargeFileMode(mode: string | null | undefined): boolean {
  return mode === "range" || mode === "optimized"
}
