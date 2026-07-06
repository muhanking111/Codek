import {
  createLargeFileWindowCache,
  type LargeFileWindowCache,
  type LargeFileWindowCacheEntry,
  type LargeFileWindowCacheOptions,
  type LargeFileWindowCacheSourceEntry,
} from "./largeFileWindowCache"

export type LargeFileWindowDirection = "previous" | "next"

export interface LargeFileWindowViewport {
  readonly offset: number
  readonly length: number
}

export interface LargeFileWindowReadOptions {
  readonly maxBytes: number
  readonly previewBytes: number
  readonly length: number
  readonly offset: number
  readonly fileSize?: number
  readonly size?: number
  readonly preview: true
}

export interface LargeFileWindowState {
  readonly mode?: string
  readonly size?: number
  readonly limit?: number
  readonly offset?: number
  readonly windowBytes?: number
  readonly bytesRead?: number
  readonly virtualStartLine?: number
  readonly sourceStartLine?: number
  readonly sourceLineAdvance?: number
  readonly renderedLineAdvance?: number
  readonly renderedLineCount?: number
  readonly hasPrevious?: boolean
  readonly hasNext?: boolean
}

export interface LargeFileWindowServiceOptions extends LargeFileWindowCacheOptions {
  readonly prefetchDelayMs?: number
  readonly clampWindow: (size: number, offset: number, length?: number) => LargeFileWindowViewport
  readonly getTargetOffset: (state: LargeFileWindowState, direction: LargeFileWindowDirection) => number
  readonly report?: (stage: string, detail?: Record<string, unknown>) => void
}

export interface LargeFileWindowReadInput {
  readonly path: string
  readonly size: number
  readonly window: LargeFileWindowViewport
  readonly state?: LargeFileWindowState | null
  readonly read: (path: string, options: LargeFileWindowReadOptions) => Promise<unknown> | unknown
}

export interface LargeFileWindowReadResult {
  readonly ok: boolean
  readonly entry: LargeFileWindowCacheEntry | null
  readonly fromCache: boolean
}

export interface LargeFileWindowPrefetchInput extends LargeFileWindowReadInput {
  readonly delayMs?: number
}

export interface LargeFileWindowAdjacentPrefetchInput {
  readonly path: string
  readonly state: LargeFileWindowState | null | undefined
  readonly direction?: LargeFileWindowDirection | null
  readonly read: (path: string, options: LargeFileWindowReadOptions) => Promise<unknown> | unknown
}

// VS Code source references:
// - D:\SourceMirror\vscode\src\vs\editor\browser\services\editorWorkerService.ts
// - D:\SourceMirror\vscode\src\vs\editor\common\services\textModelSync\textModelSync.impl.ts
//
// Codek cannot sync 50MB+ files into Monaco's worker model. This service keeps
// the VS Code-shaped async worker boundary: cached model windows, bounded read
// requests, idle prefetch, and fast fallback when a window cannot be populated.
export class LargeFileWindowService {
  private readonly cache: LargeFileWindowCache
  private readonly prefetchDelayMs: number
  private readonly clampWindow: (size: number, offset: number, length?: number) => LargeFileWindowViewport
  private readonly getWindowTargetOffset: (state: LargeFileWindowState, direction: LargeFileWindowDirection) => number
  private readonly report: (stage: string, detail?: Record<string, unknown>) => void

  constructor(options: LargeFileWindowServiceOptions) {
    this.cache = createLargeFileWindowCache(options)
    this.prefetchDelayMs = Math.max(0, Number(options.prefetchDelayMs || 0))
    this.clampWindow = options.clampWindow
    this.getWindowTargetOffset = options.getTargetOffset
    this.report = options.report || (() => undefined)
  }

  clear(path?: string | null): void {
    this.cache.clear(path)
  }

  remember(path: string, source: LargeFileWindowCacheSourceEntry): LargeFileWindowCacheEntry | null {
    return this.cache.remember(path, source)
  }

  get(path: string, size: number, offset: number, windowBytes: number): LargeFileWindowCacheEntry | null {
    return this.cache.get(path, size, offset, windowBytes)
  }

  resolveWindow(size: number, offset: number, windowBytes?: number): LargeFileWindowViewport {
    return this.clampWindow(size, offset, windowBytes)
  }

  targetOffset(state: LargeFileWindowState, direction: LargeFileWindowDirection): number {
    return this.getWindowTargetOffset(state, direction)
  }

  async readAndRemember(input: LargeFileWindowReadInput): Promise<LargeFileWindowReadResult> {
    const cached = this.cache.get(input.path, input.size, input.window.offset, input.window.length)
    if (cached) {
      this.report("large-file-window:cache-hit", {
        path: input.path,
        offset: input.window.offset,
        windowBytes: input.window.length,
      })
      return { ok: true, entry: cached, fromCache: true }
    }

    this.report("large-file-window:read:start", {
      path: input.path,
      offset: input.window.offset,
      windowBytes: input.window.length,
    })
    const content = await input.read(input.path, buildWindowReadOptions(input.window, input.size))
    const entry = this.rememberReadResult(input.path, content, input.size, input.window, input.state)
    this.report("large-file-window:read:remember", {
      path: input.path,
      offset: input.window.offset,
      windowBytes: input.window.length,
      ok: Boolean(entry),
      contentLength: typeof entry?.normalizedContent === "string" ? entry.normalizedContent.length : null,
    })
    return entry ? { ok: true, entry, fromCache: false } : { ok: false, entry: null, fromCache: false }
  }

  schedulePrefetch(input: LargeFileWindowPrefetchInput): boolean {
    return this.cache.schedulePrefetch({
      path: input.path,
      size: input.size,
      offset: input.window.offset,
      windowBytes: input.window.length,
      delayMs: input.delayMs ?? this.prefetchDelayMs,
      read: () => this.readAndRemember(input),
    })
  }

  prefetchAdjacent(input: LargeFileWindowAdjacentPrefetchInput): void {
    const state = input.state
    if (state?.mode !== "range") return
    const size = Math.max(0, Number(state.size || 0))
    if (!size) return
    const offsets: number[] = []
    if ((!input.direction || input.direction === "previous") && state.hasPrevious) {
      offsets.push(this.getWindowTargetOffset(state, "previous"))
    }
    if ((!input.direction || input.direction === "next") && state.hasNext) {
      offsets.push(this.getWindowTargetOffset(state, "next"))
    }
    for (const offset of offsets) {
      const window = this.clampWindow(size, offset, state.windowBytes)
      this.schedulePrefetch({
        path: input.path,
        size,
        window,
        state,
        read: input.read,
      })
    }
  }

  cacheSize(): number {
    return this.cache.cacheSize()
  }

  prefetchSize(): number {
    return this.cache.prefetchSize()
  }

  private rememberReadResult(
    path: string,
    content: unknown,
    size: number,
    window: LargeFileWindowViewport,
    state: LargeFileWindowState | null | undefined,
  ): LargeFileWindowCacheEntry | null {
    if (!content) return null
    if (typeof content === "object" && typeof (content as { content?: unknown }).content === "string") {
      const result = content as {
        content: string
        size?: number
        limit?: number
        bytesRead?: number
        previewBytes?: number
        offset?: number
      }
      const rawContent = String(result.content || "")
      const explicitBytesRead = Number(result.bytesRead)
      if (Number.isFinite(explicitBytesRead) && explicitBytesRead <= 0 && rawContent.length === 0) return null
      const bytesRead = numericOr(result.bytesRead, result.previewBytes, rawContent.length)
      if (bytesRead <= 0 && rawContent.length === 0) return null
      return this.cache.remember(path, {
        size: Number(result.size || size || 0),
        limit: Number(result.limit || state?.limit || window.length),
        previewBytes: bytesRead,
        bytesRead,
        offset: Number(result.offset ?? window.offset),
        windowBytes: window.length,
        rawContent,
        previousLineState: state || null,
      })
    }

    if (typeof content === "string") {
      const rawContent = content
      if (!rawContent) return null
      return this.cache.remember(path, {
        size,
        limit: Number(state?.limit || window.length),
        previewBytes: rawContent.length,
        bytesRead: rawContent.length,
        offset: window.offset,
        windowBytes: window.length,
        rawContent,
        previousLineState: state || null,
      })
    }

    return null
  }
}

export function createLargeFileWindowService(options: LargeFileWindowServiceOptions): LargeFileWindowService {
  return new LargeFileWindowService(options)
}

export function buildWindowReadOptions(window: LargeFileWindowViewport, size = 0): LargeFileWindowReadOptions {
  const safeSize = Math.max(0, Number(size) || 0)
  const options: LargeFileWindowReadOptions = {
    maxBytes: window.length,
    previewBytes: window.length,
    length: window.length,
    offset: window.offset,
    preview: true,
  }
  if (!safeSize) return options
  return {
    ...options,
    fileSize: safeSize,
    size: safeSize,
  }
}

function numericOr(...values: Array<unknown>): number {
  for (const value of values) {
    const numberValue = Number(value)
    if (Number.isFinite(numberValue) && numberValue > 0) return numberValue
  }
  return 0
}
