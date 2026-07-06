import { describe, expect, it, vi } from "vitest"
import { createLargeFileWindowCache } from "./largeFileWindowCache"

function createCache(limit = 2) {
  return createLargeFileWindowCache({
    defaultWindowBytes: 8,
    renderBytes: 4,
    fallbackLineWidth: 4,
    limit,
    normalizePath: (path) => String(path || "").replace(/\\/g, "/"),
    normalizeContent: (content) => content,
  })
}

describe("largeFileWindowCache", () => {
  it("normalizes keys, computes line state and promotes cache hits for LRU eviction", () => {
    const cache = createCache(2)

    cache.remember("logs\\huge.log", {
      size: 30,
      offset: 0,
      windowBytes: 8,
      rawContent: "one\ntwo\n",
      displayRawContent: "one\ntwo\n",
      normalizedContent: "one\ntwo\n",
    })
    cache.remember("logs/huge.log", {
      size: 30,
      offset: 8,
      windowBytes: 8,
      rawContent: "three\n",
      displayRawContent: "three\n",
      normalizedContent: "three\n",
    })

    const first = cache.get("logs/huge.log", 30, 0, 8)
    expect(first).toMatchObject({
      path: "logs/huge.log",
      offset: 0,
      sourceLineAdvance: 2,
      renderedLineAdvance: 2,
    })

    cache.remember("logs/huge.log", {
      size: 30,
      offset: 16,
      windowBytes: 8,
      rawContent: "four\n",
      displayRawContent: "four\n",
      normalizedContent: "four\n",
    })

    expect(cache.get("logs/huge.log", 30, 8, 8)).toBeNull()
    expect(cache.get("logs/huge.log", 30, 0, 8)?.rawContent).toBe("one\ntwo\n")
  })

  it("keeps raw and displayed slices separate for large safe-render windows", () => {
    const cache = createCache()
    const entry = cache.remember("logs/long.log", {
      size: 100,
      offset: 0,
      windowBytes: 16,
      rawContent: "abcdefghijklmnop",
    })

    expect(entry).toMatchObject({
      rawContent: "abcdefghijklmnop",
      displayRawContent: "abcd",
      normalizedContent: "abcd",
      displayBytes: 4,
      displayTransformed: true,
    })
  })

  it("deduplicates scheduled prefetches and clears pending timers by path", () => {
    vi.useFakeTimers()
    try {
      const cache = createCache()
      let reads = 0

      expect(cache.schedulePrefetch({
        path: "logs/pending.log",
        size: 100,
        offset: 8,
        windowBytes: 8,
        delayMs: 50,
        read: () => {
          reads += 1
        },
      })).toBe(true)
      expect(cache.schedulePrefetch({
        path: "logs\\pending.log",
        size: 100,
        offset: 8,
        windowBytes: 8,
        delayMs: 50,
        read: () => {
          reads += 1
        },
      })).toBe(false)

      cache.clear("logs/pending.log")
      vi.advanceTimersByTime(50)

      expect(reads).toBe(0)
      expect(cache.prefetchSize()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("runs a scheduled prefetch once and removes the pending entry after completion", async () => {
    vi.useFakeTimers()
    try {
      const cache = createCache()
      let reads = 0

      cache.schedulePrefetch({
        path: "logs/next.log",
        size: 100,
        offset: 8,
        windowBytes: 8,
        delayMs: 10,
        read: async () => {
          reads += 1
          cache.remember("logs/next.log", {
            size: 100,
            offset: 8,
            windowBytes: 8,
            rawContent: "next\n",
          })
        },
      })

      vi.advanceTimersByTime(10)
      await vi.runAllTimersAsync()

      expect(reads).toBe(1)
      expect(cache.prefetchSize()).toBe(0)
      expect(cache.get("logs/next.log", 100, 8, 8)?.rawContent).toBe("next\n")
    } finally {
      vi.useRealTimers()
    }
  })
})
