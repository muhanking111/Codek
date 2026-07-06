import { describe, expect, it } from "vitest"
import {
  createLargeFileWindowLineState,
  estimateLargeFileWindowStartLine,
  getLargeFileWindowRenderedLineCount,
  getLargeFileWindowRenderedLineAdvance,
  getLargeFileWindowSourceLineAdvance,
} from "./largeFileWindowLineModel"

describe("largeFileWindowLineModel", () => {
  it("uses source newlines rather than byte offsets for adjacent next-window start lines", () => {
    const firstWindow = Array.from({ length: 130_000 }, (_value, index) => `line ${index + 1}`).join("\n")
    const previous = createLargeFileWindowLineState({
      offset: 0,
      windowBytes: firstWindow.length,
      bytesRead: firstWindow.length,
      rawContent: firstWindow,
      renderedContent: firstWindow,
    })

    const next = createLargeFileWindowLineState({
      offset: firstWindow.length,
      windowBytes: 1024,
      bytesRead: 1024,
      rawContent: "next window marker\n",
      renderedContent: "next window marker\n",
      previous,
    })

    expect(previous.sourceLineAdvance).toBe(129_999)
    expect(previous.sourceStartLine).toBe(1)
    expect(next.virtualStartLine).toBe(130_000)
    expect(next.sourceStartLine).toBe(130_000)
    expect(next.virtualStartLine).toBeGreaterThan(estimateLargeFileWindowStartLine(firstWindow.length))
  })

  it("keeps source and rendered starts separate when a single source line is safety-wrapped", () => {
    const rendered = "x".repeat(2000) + "\n" + "x".repeat(2000)
    const previous = createLargeFileWindowLineState({
      offset: 0,
      windowBytes: 4000,
      bytesRead: 4000,
      rawContent: "x".repeat(4000),
      renderedContent: rendered,
    })
    const next = createLargeFileWindowLineState({
      offset: 4000,
      windowBytes: 4000,
      bytesRead: 4000,
      rawContent: "y".repeat(4000),
      renderedContent: rendered.replace(/x/g, "y"),
      previous,
    })

    expect(previous.sourceLineAdvance).toBe(0)
    expect(previous.renderedLineAdvance).toBe(2)
    expect(previous.renderedLineCount).toBe(2)
    expect(next.sourceStartLine).toBe(1)
    expect(next.virtualStartLine).toBe(3)
    expect(getLargeFileWindowRenderedLineAdvance("x".repeat(4000), 2000)).toBe(2)
  })

  it("can resolve the previous adjacent window from the current source-line state", () => {
    const previousRaw = "a\nb\nc\n"
    const current = {
      offset: previousRaw.length,
      windowBytes: 10,
      bytesRead: 10,
      virtualStartLine: 4,
      sourceStartLine: 4,
      sourceLineAdvance: 1,
      renderedLineAdvance: 1,
      renderedLineCount: 2,
    }

    const previous = createLargeFileWindowLineState({
      offset: 0,
      windowBytes: previousRaw.length,
      bytesRead: previousRaw.length,
      rawContent: previousRaw,
      renderedContent: previousRaw,
      previous: current,
    })

    expect(getLargeFileWindowSourceLineAdvance(previousRaw)).toBe(3)
    expect(getLargeFileWindowRenderedLineCount(previousRaw)).toBe(4)
    expect(previous.virtualStartLine).toBe(1)
    expect(previous.sourceStartLine).toBe(1)
  })
})
