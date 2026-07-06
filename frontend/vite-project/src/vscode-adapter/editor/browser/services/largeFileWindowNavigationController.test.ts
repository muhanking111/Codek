import { describe, expect, it, vi } from "vitest"
import {
  createLargeFileWindowNavigationController,
  LARGE_FILE_WINDOW_LOADING_STATUS,
  LARGE_FILE_WINDOW_QUEUED_STATUS,
} from "./largeFileWindowNavigationController"

describe("largeFileWindowNavigationController", () => {
  it("starts navigation with Chinese loading status and suppresses scroll queue when requested", () => {
    const clock = vi.fn(() => 1_000)
    const controller = createLargeFileWindowNavigationController({ now: clock, setTimeout: immediateTimeout })

    const result = controller.start("next", { suppressScrollQueue: true })

    expect(result.allowed).toBe(true)
    expect(result.statusText).toBe("载入下一段大文件内容")
    expect(controller.snapshot()).toMatchObject({
      busy: true,
      lastNavigationAt: 1_000,
      statusText: "载入下一段大文件内容",
      suppressScrollNavigationUntil: 2_200,
    })
  })

  it("queues the newest pending direction while a window is already loading", () => {
    const controller = createLargeFileWindowNavigationController({ now: () => 1_000, setTimeout: immediateTimeout })

    expect(controller.start("next").allowed).toBe(true)
    const queued = controller.start("previous", { queuePending: true })

    expect(queued).toEqual({
      allowed: false,
      reason: "busy",
      queuedDirection: "previous",
      statusText: LARGE_FILE_WINDOW_QUEUED_STATUS,
    })
    expect(controller.snapshot()).toMatchObject({
      busy: true,
      pendingDirection: "previous",
      statusText: LARGE_FILE_WINDOW_QUEUED_STATUS,
    })
  })

  it("does not queue while busy when queuePending is false", () => {
    const controller = createLargeFileWindowNavigationController({ now: () => 1_000, setTimeout: immediateTimeout })

    expect(controller.start("next").allowed).toBe(true)
    const blocked = controller.start("previous", { queuePending: false })

    expect(blocked).toEqual({
      allowed: false,
      reason: "busy",
      statusText: "正在载入大文件内容，请稍候",
    })
    expect(controller.snapshot().pendingDirection).toBeNull()
  })

  it("returns pending direction on finish and clears status with the delayed scheduler", () => {
    const timers: Array<() => void> = []
    const controller = createLargeFileWindowNavigationController({
      now: () => 1_000,
      setTimeout: (handler) => {
        timers.push(handler)
        return timers.length
      },
      clearTimeout: vi.fn(),
    })

    expect(controller.start("next").allowed).toBe(true)
    expect(controller.start("previous", { queuePending: true }).allowed).toBe(false)

    const finish = controller.finish({ allowQueued: true, clearStatusDelayMs: 1_200 })

    expect(finish.pendingDirection).toBe("previous")
    expect(controller.snapshot()).toMatchObject({
      busy: false,
      pendingDirection: null,
      statusText: LARGE_FILE_WINDOW_QUEUED_STATUS,
    })
    expect(timers).toHaveLength(1)

    timers[0]()

    expect(controller.snapshot().statusText).toBe("")
  })

  it("blocks repeated navigation inside the throttle window without English status text", () => {
    let now = 1_000
    const controller = createLargeFileWindowNavigationController({ now: () => now, setTimeout: immediateTimeout })

    expect(controller.start("next").allowed).toBe(true)
    controller.finish({ clearStatusDelayMs: 0 })
    now = 1_040

    const throttled = controller.start("next")

    expect(throttled).toEqual({
      allowed: false,
      reason: "throttled",
      statusText: "滚动过快，已延迟载入下一段内容",
    })
    expect(controller.snapshot().statusText).toBe("滚动过快，已延迟载入下一段内容")
    expect(controller.snapshot().statusText).not.toMatch(/Loading|queued|window/i)
  })

  it("tracks and clears programmatic scroll suppression", () => {
    let now = 1_000
    const controller = createLargeFileWindowNavigationController({ now: () => now, setTimeout: immediateTimeout })

    controller.suppressScrollNavigation(140)
    expect(controller.isScrollNavigationSuppressed()).toBe(true)

    now = 1_140
    expect(controller.isScrollNavigationSuppressed()).toBe(false)
  })

  it("disposes timers and rejects work after disposal", () => {
    const clearTimeout = vi.fn()
    const controller = createLargeFileWindowNavigationController({
      now: () => 1_000,
      setTimeout: () => 42,
      clearTimeout,
    })

    expect(controller.start("next").allowed).toBe(true)
    controller.finish({ clearStatusDelayMs: 1_200 })
    controller.dispose()

    expect(clearTimeout).toHaveBeenCalledWith(42)
    expect(controller.start("next")).toEqual({
      allowed: false,
      reason: "disposed",
      statusText: LARGE_FILE_WINDOW_LOADING_STATUS,
    })
  })
})

function immediateTimeout(handler: () => void): unknown {
  handler()
  return 0
}
