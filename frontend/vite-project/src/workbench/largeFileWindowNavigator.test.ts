import { describe, expect, it, vi } from "vitest"
import {
  createLargeFileWindowTransitionRunner,
  decideLargeFileWindowNavigation,
  decideLargeFileWindowNavigationGuard,
  installLargeFileWindowAutoNavigation,
  resolveLargeFileWindowScrollTop,
} from "./largeFileWindowNavigator"

describe("largeFileWindowNavigator", () => {
  it("does not paginate normal or optimized files", () => {
    expect(decideLargeFileWindowNavigation(
      { mode: "optimized", readOnly: false, hasNext: true },
      { scrollTop: 10_000, scrollHeight: 20_000, height: 500 },
    )).toBeNull()
  })

  it("loads the previous real byte window when a range editor reaches the top edge", () => {
    expect(decideLargeFileWindowNavigation(
      { mode: "range", readOnly: false, hasPrevious: true, hasNext: true },
      { scrollTop: 24, scrollHeight: 20_000, height: 500, explicitDirection: "previous" },
    )).toEqual({ direction: "previous", reason: "top-edge", statusText: "载入上一段大文件内容" })
  })

  it("does not auto-paginate when ordinary scrolling reaches a range edge", () => {
    expect(decideLargeFileWindowNavigation(
      { mode: "range", readOnly: false, hasPrevious: true, hasNext: true },
      { scrollTop: 24, scrollHeight: 20_000, height: 500 },
    )).toBeNull()
    expect(decideLargeFileWindowNavigation(
      { mode: "range", readOnly: false, hasPrevious: true, hasNext: true },
      { scrollTop: 19_450, scrollHeight: 20_000, height: 500 },
    )).toBeNull()
  })

  it("loads the next real byte window when a range editor reaches the bottom edge", () => {
    expect(decideLargeFileWindowNavigation(
      { mode: "range", readOnly: false, hasPrevious: true, hasNext: true },
      { scrollTop: 19_450, scrollHeight: 20_000, height: 500, explicitDirection: "next" },
    )).toEqual({ direction: "next", reason: "bottom-edge", statusText: "载入下一段大文件内容" })
  })

  it("preloads the next real byte window before a fast wheel reaches blank bottom space", () => {
    expect(decideLargeFileWindowNavigation(
      { mode: "range", readOnly: false, hasPrevious: true, hasNext: true },
      { scrollTop: 17_600, scrollHeight: 20_000, height: 600, deltaY: 900, explicitDirection: "next" },
    )).toEqual({ direction: "next", reason: "bottom-preload", statusText: "预载入下一段大文件内容" })
  })

  it("uses wheel direction to load the next window before the rendered range reaches the edge", () => {
    expect(decideLargeFileWindowNavigation(
      {
        mode: "range",
        readOnly: false,
        hasPrevious: true,
        hasNext: true,
        size: 64 * 1024 * 1024,
        offset: 0,
        bytesRead: 16 * 1024 * 1024,
        windowBytes: 16 * 1024 * 1024,
      },
      { scrollTop: 15_000, scrollHeight: 20_000, height: 600, deltaY: 1200, explicitDirection: "next" },
    )).toEqual({ direction: "next", reason: "bottom-preload", statusText: "预载入下一段大文件内容" })
  })

  it("preloads a 64MB range before the user reaches the last 32MB window edge", () => {
    expect(decideLargeFileWindowNavigation(
      {
        mode: "range",
        readOnly: false,
        hasPrevious: false,
        hasNext: true,
        size: 64 * 1024 * 1024,
        offset: 0,
        bytesRead: 32 * 1024 * 1024,
        windowBytes: 32 * 1024 * 1024,
      },
      { scrollTop: 10_300, scrollHeight: 20_000, height: 600, deltaY: 600, explicitDirection: "next" },
    )).toEqual({ direction: "next", reason: "bottom-preload", statusText: "预载入下一段大文件内容" })
  })

  it("preloads a 260MiB file window during scrollbar drag before the bottom edge", () => {
    expect(decideLargeFileWindowNavigation(
      {
        mode: "range",
        readOnly: false,
        hasPrevious: true,
        hasNext: true,
        size: 260 * 1024 * 1024,
        offset: 32 * 1024 * 1024,
        bytesRead: 32 * 1024 * 1024,
        windowBytes: 32 * 1024 * 1024,
      },
      { scrollTop: 1_672_066, scrollHeight: 2_490_585, height: 769, deltaY: 53_686, explicitDirection: "next" },
    )).toEqual({ direction: "next", reason: "bottom-preload", statusText: "预载入下一段大文件内容" })
  })

  it("preloads the previous real byte window before a fast wheel reaches blank top space", () => {
    expect(decideLargeFileWindowNavigation(
      { mode: "range", readOnly: false, hasPrevious: true, hasNext: true },
      { scrollTop: 1_800, scrollHeight: 20_000, height: 600, deltaY: -900, explicitDirection: "previous" },
    )).toEqual({ direction: "previous", reason: "top-preload", statusText: "预载入上一段大文件内容" })
  })

  it("does not treat programmatic post-window restore near the top as a previous-window request", () => {
    expect(decideLargeFileWindowNavigation(
      {
        mode: "range",
        readOnly: false,
        hasPrevious: true,
        hasNext: true,
        size: 256 * 1024 * 1024,
        offset: 32 * 1024 * 1024,
        bytesRead: 32 * 1024 * 1024,
        windowBytes: 32 * 1024 * 1024,
      },
      { scrollTop: 180, scrollHeight: 20_000, height: 1_000 },
    )).toBeNull()
  })

  it("does not treat programmatic post-window restore near the bottom as a next-window request", () => {
    expect(decideLargeFileWindowNavigation(
      {
        mode: "range",
        readOnly: false,
        hasPrevious: true,
        hasNext: true,
        size: 256 * 1024 * 1024,
        offset: 32 * 1024 * 1024,
        bytesRead: 32 * 1024 * 1024,
        windowBytes: 32 * 1024 * 1024,
      },
      { scrollTop: 18_650, scrollHeight: 20_000, height: 1_000 },
    )).toBeNull()
  })
  it("does not paginate when the adjacent window is unavailable", () => {
    expect(decideLargeFileWindowNavigation(
      { mode: "range", readOnly: false, hasPrevious: false, hasNext: true },
      { scrollTop: 0, scrollHeight: 20_000, height: 500, explicitDirection: "previous" },
    )).toBeNull()
    expect(decideLargeFileWindowNavigation(
      { mode: "range", readOnly: false, hasPrevious: true, hasNext: false },
      { scrollTop: 19_500, scrollHeight: 20_000, height: 500, explicitDirection: "next" },
    )).toBeNull()
  })

  it("blocks repeated range-window navigation while busy or inside the throttle window with Chinese status text", () => {
    expect(decideLargeFileWindowNavigationGuard({ busy: true, now: 1000, lastNavigationAt: 0 })).toEqual({
      allowed: false,
      reason: "busy",
      statusText: "正在载入大文件内容，请稍候",
    })
    expect(decideLargeFileWindowNavigationGuard({ now: 1080, lastNavigationAt: 1000, throttleMs: 160 })).toEqual({
      allowed: false,
      reason: "throttled",
      statusText: "滚动过快，已延迟载入下一段内容",
    })
    expect(decideLargeFileWindowNavigationGuard({ now: 1160, lastNavigationAt: 1000, throttleMs: 160 })).toEqual({
      allowed: true,
      statusText: "准备载入大文件内容",
    })
  })

  it("resolves VS Code-style scroll anchors around large-file window transitions", () => {
    const metrics = { scrollHeight: 20_000, height: 1_000 }

    expect(resolveLargeFileWindowScrollTop({ direction: "next", phase: "before-load", ...metrics })).toBe(18_650)
    expect(resolveLargeFileWindowScrollTop({ direction: "next", phase: "after-load", ...metrics })).toBe(180)
    expect(resolveLargeFileWindowScrollTop({ direction: "previous", phase: "before-load", ...metrics })).toBe(350)
    expect(resolveLargeFileWindowScrollTop({ direction: "previous", phase: "after-load", ...metrics })).toBe(18_650)
  })

  it("clamps scroll anchors when the editor viewport is taller than the rendered window", () => {
    const metrics = { scrollHeight: 500, height: 1_000 }

    expect(resolveLargeFileWindowScrollTop({ direction: "next", phase: "before-load", ...metrics })).toBe(0)
    expect(resolveLargeFileWindowScrollTop({ direction: "previous", phase: "after-load", ...metrics })).toBe(0)
  })

  it("preserves the bottom edge after explicit next-window loads so continuous scrolling can keep paging", () => {
    const metrics = { scrollHeight: 20_000, height: 1_000 }

    expect(resolveLargeFileWindowScrollTop({ direction: "next", phase: "after-load", preserveEdge: true, ...metrics })).toBe(19_000)
    expect(resolveLargeFileWindowScrollTop({ direction: "previous", phase: "after-load", preserveEdge: true, ...metrics })).toBe(0)
  })

  it("installs VS Code-style scroll and wheel auto-navigation listeners", () => {
    const navigate = vi.fn()
    const scrollDispose = vi.fn()
    let scrollTop = 0
    let scrollListener: ((event?: { scrollTop?: number }) => void) | null = null
    let wheelListener: ((event: { deltaY?: number }) => void) | null = null
    const container = {
      addEventListener: vi.fn((type: string, listener: (event: { deltaY?: number }) => void, options?: unknown) => {
        expect(type).toBe("wheel")
        expect(options).toEqual({ passive: true })
        wheelListener = listener
      }),
      removeEventListener: vi.fn((type: string, listener: (event: { deltaY?: number }) => void) => {
        expect(type).toBe("wheel")
        expect(listener).toBe(wheelListener)
      }),
    }
    const editor = {
      onDidScrollChange: vi.fn((listener: (event?: { scrollTop?: number }) => void) => {
        scrollListener = listener
        return { dispose: scrollDispose }
      }),
      getDomNode: vi.fn(() => container),
      getScrollTop: vi.fn(() => scrollTop),
    }

    const disposable = installLargeFileWindowAutoNavigation({ editor, navigate })

    scrollTop = 500
    scrollListener?.({ scrollTop })
    scrollTop = 120
    scrollListener?.({ scrollTop })
    wheelListener?.({ deltaY: 320 })
    wheelListener?.({ deltaY: -160 })
    wheelListener?.({ deltaY: 0 })

    expect(navigate).toHaveBeenNthCalledWith(1, { deltaY: 500, explicitDirection: "next" })
    expect(navigate).toHaveBeenNthCalledWith(2, { deltaY: -380, explicitDirection: "previous" })
    expect(navigate).toHaveBeenNthCalledWith(3, { deltaY: 320, explicitDirection: "next" })
    expect(navigate).toHaveBeenNthCalledWith(4, { deltaY: -160, explicitDirection: "previous" })
    expect(navigate).toHaveBeenCalledTimes(4)

    disposable.dispose?.()

    expect(scrollDispose).toHaveBeenCalledTimes(1)
    expect(container.removeEventListener).toHaveBeenCalledTimes(1)
  })

  it("falls back to the editor scrollTop when a VS Code scroll event omits it", () => {
    const navigate = vi.fn()
    let scrollTop = 0
    let scrollListener: ((event?: { scrollTop?: number }) => void) | null = null
    const editor = {
      onDidScrollChange: vi.fn((listener: (event?: { scrollTop?: number }) => void) => {
        scrollListener = listener
        return { dispose: vi.fn() }
      }),
      getDomNode: vi.fn(() => null),
      getScrollTop: vi.fn(() => scrollTop),
    }

    installLargeFileWindowAutoNavigation({ editor, navigate })

    scrollTop = 720
    scrollListener?.({})

    expect(navigate).toHaveBeenCalledWith({ deltaY: 720, explicitDirection: "next" })
  })

  it("returns a noop disposable when the editor cannot emit scroll events", () => {
    const navigate = vi.fn()
    const disposable = installLargeFileWindowAutoNavigation({ editor: null, navigate })

    disposable.dispose?.()

    expect(navigate).not.toHaveBeenCalled()
  })

  it("runs a VS Code-style window transition through load, sync, restore, and finish", async () => {
    let scrollTop = 19_450
    let offset = 0
    let statusText = ""
    const timers: Array<() => void> = []
    const animationFrames: Array<() => void> = []
    const scrollWrites: number[] = []
    const stages: string[] = []
    const controller = createControllerStub()
    const editor = createEditorStub({
      getScrollTop: () => scrollTop,
      setScrollTop: (value) => {
        scrollTop = value
        scrollWrites.push(value)
      },
    })
    const runner = createLargeFileWindowTransitionRunner({
      controller,
      getEditor: () => editor,
      getActiveFile: () => "huge.log",
      getLargeFileState: () => ({
        mode: "range",
        hasPrevious: offset > 0,
        hasNext: true,
        offset,
        bytesRead: 32 * 1024 * 1024,
        windowBytes: 32 * 1024 * 1024,
      }),
      loadWindow: async (direction, path) => {
        expect(direction).toBe("next")
        expect(path).toBe("huge.log")
        offset = 32 * 1024 * 1024
        return true
      },
      syncEditorFromWorkspace: vi.fn(),
      nextTick: vi.fn(),
      applyEditorOptions: vi.fn(),
      waitForEditorFrame: vi.fn(),
      requestAnimationFrame: (handler) => {
        animationFrames.push(handler)
      },
      setTimeout: (handler) => {
        timers.push(handler)
      },
      setStatusText: (value) => {
        statusText = value
      },
      reportStage: (stage) => {
        stages.push(stage)
      },
    })

    await expect(runner.loadByDirection("next", { force: true })).resolves.toBe(true)

    expect(controller.started).toEqual([{ direction: "next", force: true, queuePending: true, suppressScrollQueue: false }])
    expect(scrollWrites[0]).toBe(18_650)
    expect(animationFrames).toHaveLength(1)
    animationFrames[0]()
    expect(scrollWrites.at(-1)).toBe(180)
    expect(stages).toEqual(["load-window:start", "load-window:done"])
    expect(timers).toHaveLength(1)

    timers[0]()

    expect(controller.finished).toEqual([{ allowQueued: true }])
    expect(statusText).toBe("")
  })

  it("continues explicit bottom-edge paging after a successful next-window transition", async () => {
    let scrollTop = 19_450
    let offset = 0
    const timers: Array<() => void> = []
    const animationFrames: Array<() => void> = []
    const scrollWrites: number[] = []
    const controller = createControllerStub()
    const editor = createEditorStub({
      getScrollTop: () => scrollTop,
      setScrollTop: (value) => {
        scrollTop = value
        scrollWrites.push(value)
      },
    })
    const loadWindow = vi.fn(async (direction: "previous" | "next") => {
      expect(direction).toBe("next")
      offset += 32 * 1024 * 1024
      return true
    })
    const runner = createLargeFileWindowTransitionRunner({
      controller,
      getEditor: () => editor,
      getActiveFile: () => "huge.log",
      getLargeFileState: () => ({
        mode: "range",
        hasPrevious: offset > 0,
        hasNext: offset < 96 * 1024 * 1024,
        offset,
        bytesRead: 32 * 1024 * 1024,
        windowBytes: 32 * 1024 * 1024,
        size: 128 * 1024 * 1024,
      }),
      loadWindow,
      syncEditorFromWorkspace: vi.fn(),
      nextTick: vi.fn(),
      applyEditorOptions: vi.fn(),
      waitForEditorFrame: vi.fn(),
      requestAnimationFrame: (handler) => {
        animationFrames.push(handler)
      },
      setTimeout: (handler) => {
        timers.push(handler)
      },
      setStatusText: vi.fn(),
    })

    await expect(runner.navigateFromEditorScroll({ deltaY: 900, explicitDirection: "next" })).resolves.toBe(true)
    expect(loadWindow).toHaveBeenCalledTimes(1)
    animationFrames.shift()?.()
    expect(scrollWrites.at(-1)).toBe(19_000)

    timers.shift()?.()
    await flushPromises()
    expect(loadWindow).toHaveBeenCalledTimes(2)
    animationFrames.shift()?.()
    expect(scrollWrites.at(-1)).toBe(19_000)

    timers.shift()?.()
    await flushPromises()
    expect(loadWindow).toHaveBeenCalledTimes(3)
    animationFrames.shift()?.()
    timers.shift()?.()

    expect(controller.started.map((entry) => entry.direction)).toEqual(["next", "next", "next"])
    expect(offset).toBe(96 * 1024 * 1024)
  })

  it("queues a matching busy scroll decision without starting a duplicate load", async () => {
    let statusText = ""
    const controller = createControllerStub({ busy: true })
    const editor = createEditorStub({ getScrollTop: () => 19_450 })
    const loadWindow = vi.fn()
    const runner = createLargeFileWindowTransitionRunner({
      controller,
      getEditor: () => editor,
      getActiveFile: () => "huge.log",
      getLargeFileState: () => ({
        mode: "range",
        hasPrevious: true,
        hasNext: true,
      }),
      loadWindow,
      syncEditorFromWorkspace: vi.fn(),
      nextTick: vi.fn(),
      applyEditorOptions: vi.fn(),
      waitForEditorFrame: vi.fn(),
      requestAnimationFrame: vi.fn(),
      setTimeout: vi.fn(),
      setStatusText: (value) => {
        statusText = value
      },
    })

    await expect(runner.navigateFromEditorScroll({ deltaY: 900, explicitDirection: "next" })).resolves.toBe(false)

    expect(controller.started).toEqual([{ direction: "next", queuePending: true }])
    expect(statusText).toBe("queued")
    expect(loadWindow).not.toHaveBeenCalled()
  })
})

function createEditorStub(overrides: {
  getScrollTop?: () => number
  setScrollTop?: (value: number) => void
} = {}) {
  return {
    getScrollTop: overrides.getScrollTop || (() => 0),
    getScrollHeight: () => 20_000,
    getLayoutInfo: () => ({ height: 1_000 }),
    setScrollTop: overrides.setScrollTop || (() => undefined),
  }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

function createControllerStub(options: { busy?: boolean; pendingDirection?: "previous" | "next" | null } = {}) {
  let busy = Boolean(options.busy)
  let pendingDirection = options.pendingDirection ?? null
  return {
    started: [] as Array<Record<string, unknown>>,
    finished: [] as Array<Record<string, unknown>>,
    start(direction: "previous" | "next", startOptions: Record<string, unknown> = {}) {
      this.started.push({ direction, ...startOptions })
      if (busy) {
        pendingDirection = direction
        return { allowed: false, statusText: "queued" }
      }
      busy = true
      return { allowed: true, statusText: direction === "next" ? "载入下一段大文件内容" : "载入上一段大文件内容" }
    },
    finish(finishOptions: Record<string, unknown> = {}) {
      this.finished.push(finishOptions)
      busy = false
      const direction = pendingDirection
      pendingDirection = null
      return { pendingDirection: direction }
    },
    snapshot: () => ({ busy }),
    getStatusText: () => "",
    suppressScrollNavigation: vi.fn(),
    isScrollNavigationSuppressed: () => false,
  }
}
