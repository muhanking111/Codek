import { getUtf8ByteLength, hashLargeFileSegment } from "./largeFileEditBuffer"
import { createLargeFileWindowLineState } from "./largeFileWindowLineModel"

export interface LargeFileWindowCacheOptions {
  readonly defaultWindowBytes: number
  readonly renderBytes: number
  readonly fallbackLineWidth: number
  readonly limit?: number
  readonly normalizePath?: (path: string) => string
  readonly normalizeContent?: (content: string) => string
}

export interface LargeFileWindowCacheSourceEntry {
  readonly size: number
  readonly limit?: number
  readonly previewBytes?: number
  readonly bytesRead?: number
  readonly offset?: number
  readonly windowBytes?: number
  readonly rawContent?: string
  readonly content?: string
  readonly displayRawContent?: string
  readonly normalizedContent?: string
  readonly previousLineState?: LargeFileWindowLineStateInput | null
  readonly fileVersionHash?: string | null
  readonly fullWindowHash?: string | null
  readonly displayBytes?: number
  readonly displayHash?: string | null
  readonly displayTransformed?: boolean
  readonly virtualStartLine?: number
  readonly sourceStartLine?: number
}

export interface LargeFileWindowLineStateInput {
  readonly offset?: number
  readonly windowBytes?: number
  readonly bytesRead?: number
  readonly virtualStartLine?: number
  readonly sourceStartLine?: number
  readonly sourceLineAdvance?: number
  readonly renderedLineAdvance?: number
  readonly renderedLineCount?: number
}

export interface LargeFileWindowCacheEntry {
  readonly path: string
  readonly size: number
  readonly limit: number
  readonly previewBytes: number
  readonly bytesRead: number
  readonly offset: number
  readonly windowBytes: number
  readonly rawContent: string
  readonly displayRawContent: string
  readonly normalizedContent: string
  readonly fileVersionHash: string
  readonly fullWindowHash: string
  readonly displayBytes: number
  readonly displayHash: string
  readonly displayTransformed: boolean
  readonly virtualStartLine: number
  readonly sourceStartLine: number
  readonly sourceLineAdvance: number
  readonly renderedLineAdvance: number
  readonly renderedLineCount: number
}

export interface LargeFileWindowPrefetchInput {
  readonly path: string
  readonly size: number
  readonly offset: number
  readonly windowBytes: number
  readonly delayMs: number
  readonly read: () => Promise<unknown> | unknown
}

type PendingPrefetch = {
  timer: ReturnType<typeof setTimeout> | null
  promise: Promise<unknown> | null
}

function numericOr(...values: Array<unknown>): number {
  for (const value of values) {
    const numberValue = Number(value)
    if (Number.isFinite(numberValue) && numberValue > 0) return numberValue
  }
  return 0
}

export class LargeFileWindowCache {
  private readonly cache = new Map<string, LargeFileWindowCacheEntry>()
  private readonly prefetches = new Map<string, PendingPrefetch>()
  private readonly limit: number
  private readonly defaultWindowBytes: number
  private readonly renderBytes: number
  private readonly fallbackLineWidth: number
  private readonly normalizePath: (path: string) => string
  private readonly normalizeContent: (content: string) => string

  constructor(options: LargeFileWindowCacheOptions) {
    this.limit = Math.max(1, Math.floor(Number(options.limit || 6)))
    this.defaultWindowBytes = Math.max(1, Math.floor(Number(options.defaultWindowBytes || 1)))
    this.renderBytes = Math.max(1, Math.floor(Number(options.renderBytes || this.defaultWindowBytes)))
    this.fallbackLineWidth = Math.max(1, Math.floor(Number(options.fallbackLineWidth || 2000)))
    this.normalizePath = options.normalizePath || ((path: string) => String(path || ""))
    this.normalizeContent = options.normalizeContent || ((content: string) => content)
  }

  key(path: string, size: number, offset: number, windowBytes: number): string {
    return [
      this.normalizePath(path),
      Math.max(0, Number(size) || 0),
      Math.max(0, Number(offset) || 0),
      Math.max(1, Number(windowBytes) || this.defaultWindowBytes),
    ].join("\u0000")
  }

  clear(path?: string | null): void {
    if (!path) {
      this.cache.clear()
      for (const pending of this.prefetches.values()) {
        if (pending.timer) clearTimeout(pending.timer)
      }
      this.prefetches.clear()
      return
    }
    const normalized = this.normalizePath(path)
    const prefix = `${normalized}\u0000`
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(prefix)) this.cache.delete(key)
    }
    for (const key of Array.from(this.prefetches.keys())) {
      if (!key.startsWith(prefix)) continue
      const pending = this.prefetches.get(key)
      if (pending?.timer) clearTimeout(pending.timer)
      this.prefetches.delete(key)
    }
  }

  has(path: string, size: number, offset: number, windowBytes: number): boolean {
    return this.cache.has(this.key(path, size, offset, windowBytes))
  }

  remember(path: string, source: LargeFileWindowCacheSourceEntry): LargeFileWindowCacheEntry | null {
    const normalized = this.normalizePath(path)
    if (!normalized || !source) return null
    const size = Math.max(0, Number(source.size) || 0)
    const offset = Math.max(0, Number(source.offset) || 0)
    const windowBytes = Math.max(1, numericOr(source.windowBytes, source.previewBytes, this.defaultWindowBytes))
    const rawContent = String(source.rawContent ?? source.content ?? "")
    const displayRawContent = typeof source.displayRawContent === "string"
      ? source.displayRawContent
      : rawContent.slice(0, Math.min(rawContent.length, this.renderBytes))
    const normalizedContent = String(source.normalizedContent ?? this.normalizeContent(displayRawContent))
    const displayBytes = Math.max(0, Number(source.displayBytes || getUtf8ByteLength(displayRawContent)))
    const fullWindowHash = source.fullWindowHash || source.fileVersionHash || hashLargeFileSegment(rawContent)
    const displayHash = source.displayHash || hashLargeFileSegment(displayRawContent)
    const bytesRead = Math.max(0, numericOr(source.bytesRead, source.previewBytes, getUtf8ByteLength(rawContent)))
    const lineState = createLargeFileWindowLineState({
      offset,
      windowBytes,
      bytesRead,
      rawContent,
      renderedContent: normalizedContent,
      previous: source.previousLineState || null,
      fallbackLineWidth: this.fallbackLineWidth,
    })
    const entry: LargeFileWindowCacheEntry = {
      path: normalized,
      size,
      limit: Number(source.limit || this.defaultWindowBytes),
      previewBytes: Math.max(0, numericOr(source.previewBytes, bytesRead)),
      bytesRead,
      offset,
      windowBytes,
      rawContent,
      displayRawContent,
      normalizedContent,
      fileVersionHash: fullWindowHash,
      fullWindowHash,
      displayBytes,
      displayHash,
      displayTransformed: Boolean(source.displayTransformed ?? (normalizedContent !== displayRawContent || displayBytes < getUtf8ByteLength(rawContent))),
      virtualStartLine: Number(source.virtualStartLine || lineState.virtualStartLine),
      sourceStartLine: Number(source.sourceStartLine || lineState.sourceStartLine),
      sourceLineAdvance: lineState.sourceLineAdvance,
      renderedLineAdvance: lineState.renderedLineAdvance,
      renderedLineCount: lineState.renderedLineCount,
    }

    this.cache.set(this.key(normalized, size, offset, windowBytes), entry)
    this.trim()
    return entry
  }

  get(path: string, size: number, offset: number, windowBytes: number): LargeFileWindowCacheEntry | null {
    const key = this.key(path, size, offset, windowBytes)
    const entry = this.cache.get(key)
    if (!entry) return null
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry
  }

  schedulePrefetch(input: LargeFileWindowPrefetchInput): boolean {
    const key = this.key(input.path, input.size, input.offset, input.windowBytes)
    if (this.cache.has(key) || this.prefetches.has(key)) return false
    const delayMs = Math.max(0, Number(input.delayMs) || 0)
    const timer = setTimeout(() => {
      const pending = this.prefetches.get(key)
      if (!pending || pending.timer !== timer) return
      const promise = Promise.resolve()
        .then(() => input.read())
        .catch(() => null)
        .finally(() => {
          this.prefetches.delete(key)
        })
      this.prefetches.set(key, { promise, timer: null })
    }, delayMs)
    this.prefetches.set(key, { promise: null, timer })
    return true
  }

  cacheSize(): number {
    return this.cache.size
  }

  prefetchSize(): number {
    return this.prefetches.size
  }

  private trim(): void {
    while (this.cache.size > this.limit) {
      const oldestKey = this.cache.keys().next().value
      if (!oldestKey) break
      this.cache.delete(oldestKey)
    }
  }
}

export function createLargeFileWindowCache(options: LargeFileWindowCacheOptions): LargeFileWindowCache {
  return new LargeFileWindowCache(options)
}
