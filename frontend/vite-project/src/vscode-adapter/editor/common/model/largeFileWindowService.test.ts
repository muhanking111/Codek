import { describe, expect, it, vi } from "vitest"
import {
  buildWindowReadOptions,
  createLargeFileWindowService,
  type LargeFileWindowReadOptions,
} from "./largeFileWindowService"

function createService() {
  const stages: Array<{ stage: string; detail?: Record<string, unknown> }> = []
  const service = createLargeFileWindowService({
    defaultWindowBytes: 8,
    renderBytes: 8,
    fallbackLineWidth: 8,
    limit: 3,
    prefetchDelayMs: 20,
    normalizePath: (path) => String(path || "").replace(/\\/g, "/"),
    normalizeContent: (content) => content,
    clampWindow: (size, offset, length = 8) => {
      const safeLength = Math.max(1, Math.min(Number(length) || 8, Number(size) || 8))
      const safeOffset = Math.max(0, Math.min(Number(offset) || 0, Math.max(0, Number(size) - safeLength)))
      return { offset: safeOffset, length: safeLength }
    },
    getTargetOffset: (state, direction) => direction === "next"
      ? Number(state.offset || 0) + Number(state.windowBytes || 8)
      : Number(state.offset || 0) - Number(state.windowBytes || 8),
    report: (stage, detail) => stages.push({ stage, detail }),
  })
  return { service, stages }
}

describe("largeFileWindowService", () => {
  it("builds bounded VS Code-style preview read options for a byte window", () => {
    expect(buildWindowReadOptions({ offset: 16, length: 8 })).toEqual({
      maxBytes: 8,
      previewBytes: 8,
      length: 8,
      offset: 16,
      preview: true,
    })
    expect(buildWindowReadOptions({ offset: 16, length: 8 }, 260)).toEqual({
      maxBytes: 8,
      previewBytes: 8,
      length: 8,
      offset: 16,
      fileSize: 260,
      size: 260,
      preview: true,
    })
  })

  it("reads a window once, remembers line state and serves the next request from cache", async () => {
    const { service, stages } = createService()
    const reads: LargeFileWindowReadOptions[] = []

    const first = await service.readAndRemember({
      path: "logs\\huge.log",
      size: 32,
      window: { offset: 0, length: 8 },
      state: null,
      read: (_path, options) => {
        reads.push(options)
        return {
          content: "one\ntwo\n",
          size: 32,
          bytesRead: 8,
          previewBytes: 8,
          offset: 0,
          truncated: true,
        }
      },
    })

    expect(first).toMatchObject({
      ok: true,
      fromCache: false,
      entry: {
        path: "logs/huge.log",
        offset: 0,
        rawContent: "one\ntwo\n",
        sourceLineAdvance: 2,
      },
    })
    expect(reads).toEqual([{
      maxBytes: 8,
      previewBytes: 8,
      length: 8,
      offset: 0,
      fileSize: 32,
      size: 32,
      preview: true,
    }])

    const cached = await service.readAndRemember({
      path: "logs/huge.log",
      size: 32,
      window: { offset: 0, length: 8 },
      state: null,
      read: () => {
        throw new Error("cache hit must not read")
      },
    })

    expect(cached.fromCache).toBe(true)
    expect(reads).toHaveLength(1)
    expect(stages.map((entry) => entry.stage)).toContain("large-file-window:cache-hit")
  })

  it("prefetches adjacent windows using the current range state and deduplicates pending reads", async () => {
    vi.useFakeTimers()
    try {
      const { service } = createService()
      const offsets: number[] = []
      service.prefetchAdjacent({
        path: "logs/next.log",
        state: {
          mode: "range",
          size: 24,
          offset: 8,
          windowBytes: 8,
          hasPrevious: true,
          hasNext: true,
        },
        direction: null,
        read: (_path, options) => {
          offsets.push(options.offset)
          return {
            content: options.offset === 0 ? "previous" : "next-win",
            size: 24,
            bytesRead: 8,
            previewBytes: 8,
            offset: options.offset,
            truncated: true,
          }
        },
      })
      service.prefetchAdjacent({
        path: "logs\\next.log",
        state: {
          mode: "range",
          size: 24,
          offset: 8,
          windowBytes: 8,
          hasPrevious: true,
          hasNext: true,
        },
        direction: null,
        read: () => {
          throw new Error("duplicate prefetch must be ignored")
        },
      })

      expect(service.prefetchSize()).toBe(2)
      vi.advanceTimersByTime(20)
      await vi.runAllTimersAsync()

      expect(offsets.sort((left, right) => left - right)).toEqual([0, 16])
      expect(service.prefetchSize()).toBe(0)
      expect(service.get("logs/next.log", 24, 0, 8)?.rawContent).toBe("previous")
      expect(service.get("logs/next.log", 24, 16, 8)?.rawContent).toBe("next-win")
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects empty EOF range reads instead of caching a blank next window", async () => {
    const { service } = createService()

    const result = await service.readAndRemember({
      path: "logs/eof.log",
      size: 16,
      window: { offset: 8, length: 8 },
      state: { mode: "range", size: 16, offset: 0, windowBytes: 8 },
      read: () => ({
        content: "",
        size: 8,
        bytesRead: 0,
        previewBytes: 8,
        offset: 8,
        truncated: false,
      }),
    })

    expect(result).toEqual({ ok: false, entry: null, fromCache: false })
    expect(service.get("logs/eof.log", 16, 8, 8)).toBeNull()
  })
})
