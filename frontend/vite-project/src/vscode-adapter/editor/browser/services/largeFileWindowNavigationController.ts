import {
  decideLargeFileWindowNavigationGuard,
  type LargeFileWindowDirection,
} from "./largeFileWindowNavigator"

export type { LargeFileWindowDirection }

export const LARGE_FILE_WINDOW_LOADING_STATUS = "正在载入大文件内容，请稍候"
export const LARGE_FILE_WINDOW_QUEUED_STATUS = "已排队载入大文件内容"
export const LARGE_FILE_WINDOW_PREVIOUS_STATUS = "载入上一段大文件内容"
export const LARGE_FILE_WINDOW_NEXT_STATUS = "载入下一段大文件内容"

export interface LargeFileWindowNavigationControllerOptions {
  readonly now?: () => number
  readonly setTimeout?: (handler: () => void, timeout: number) => unknown
  readonly clearTimeout?: (handle: unknown) => void
  readonly onStatusTextChange?: (statusText: string) => void
  readonly scrollRestoreSuppressMs?: number
  readonly queuedScrollSuppressMs?: number
}

export interface LargeFileWindowNavigationStartOptions {
  readonly force?: boolean
  readonly queuePending?: boolean
  readonly suppressScrollQueue?: boolean
}

export interface LargeFileWindowNavigationFinishOptions {
  readonly allowQueued?: boolean
  readonly clearStatusDelayMs?: number
}

export interface LargeFileWindowNavigationSnapshot {
  readonly busy: boolean
  readonly disposed: boolean
  readonly pendingDirection: LargeFileWindowDirection | null
  readonly lastNavigationAt: number
  readonly statusText: string
  readonly suppressScrollNavigationUntil: number
}

export type LargeFileWindowNavigationStartResult =
  | { allowed: true; direction: LargeFileWindowDirection; statusText: string }
  | {
    allowed: false
    reason: "busy" | "throttled" | "disposed"
    statusText: string
    queuedDirection?: LargeFileWindowDirection
  }

export interface LargeFileWindowNavigationFinishResult {
  readonly pendingDirection: LargeFileWindowDirection | null
}

export class LargeFileWindowNavigationController {
  private readonly now: () => number
  private readonly setTimer: (handler: () => void, timeout: number) => unknown
  private readonly clearTimer: (handle: unknown) => void
  private readonly onStatusTextChange: (statusText: string) => void
  private readonly scrollRestoreSuppressMs: number
  private readonly queuedScrollSuppressMs: number

  private busy = false
  private disposed = false
  private pendingDirection: LargeFileWindowDirection | null = null
  private lastNavigationAt = 0
  private statusText = ""
  private statusTimer: unknown = null
  private suppressScrollNavigationUntil = 0

  constructor(options: LargeFileWindowNavigationControllerOptions = {}) {
    this.now = options.now || (() => Date.now())
    this.setTimer = options.setTimeout || ((handler, timeout) => setTimeout(handler, timeout))
    this.clearTimer = options.clearTimeout || ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
    this.onStatusTextChange = options.onStatusTextChange || (() => undefined)
    this.scrollRestoreSuppressMs = Math.max(0, Number(options.scrollRestoreSuppressMs ?? 140))
    this.queuedScrollSuppressMs = Math.max(0, Number(options.queuedScrollSuppressMs ?? 1_200))
  }

  snapshot(): LargeFileWindowNavigationSnapshot {
    return {
      busy: this.busy,
      disposed: this.disposed,
      pendingDirection: this.pendingDirection,
      lastNavigationAt: this.lastNavigationAt,
      statusText: this.statusText,
      suppressScrollNavigationUntil: this.suppressScrollNavigationUntil,
    }
  }

  getStatusText(): string {
    return this.statusText
  }

  setStatusText(statusText: string): void {
    if (this.disposed) return
    this.cancelStatusTimer()
    this.statusText = statusText
    this.onStatusTextChange(statusText)
  }

  start(
    direction: LargeFileWindowDirection,
    options: LargeFileWindowNavigationStartOptions = {},
  ): LargeFileWindowNavigationStartResult {
    if (this.disposed) {
      return { allowed: false, reason: "disposed", statusText: LARGE_FILE_WINDOW_LOADING_STATUS }
    }
    if (this.busy) {
      if (options.queuePending !== false) {
        this.pendingDirection = direction
        this.setStatusText(LARGE_FILE_WINDOW_QUEUED_STATUS)
        return {
          allowed: false,
          reason: "busy",
          queuedDirection: direction,
          statusText: LARGE_FILE_WINDOW_QUEUED_STATUS,
        }
      }
      this.setStatusText(LARGE_FILE_WINDOW_LOADING_STATUS)
      return { allowed: false, reason: "busy", statusText: LARGE_FILE_WINDOW_LOADING_STATUS }
    }

    const guard = decideLargeFileWindowNavigationGuard({
      busy: this.busy,
      now: this.now(),
      lastNavigationAt: this.lastNavigationAt,
      throttleMs: options.force ? 0 : undefined,
    })
    this.setStatusText(guard.statusText)
    if (guard.allowed === false) {
      return { allowed: false, reason: guard.reason, statusText: guard.statusText }
    }

    this.busy = true
    this.lastNavigationAt = this.now()
    const statusText = getDirectionStatusText(direction)
    this.setStatusText(statusText)
    if (options.suppressScrollQueue) {
      this.suppressScrollNavigation(this.queuedScrollSuppressMs)
    }
    return { allowed: true, direction, statusText }
  }

  finish(options: LargeFileWindowNavigationFinishOptions = {}): LargeFileWindowNavigationFinishResult {
    if (this.disposed) {
      return { pendingDirection: null }
    }
    this.busy = false
    const pendingDirection = options.allowQueued ? this.pendingDirection : null
    this.pendingDirection = null
    this.scheduleStatusClear(Number(options.clearStatusDelayMs ?? 1_200))
    return { pendingDirection }
  }

  suppressScrollNavigation(durationMs = this.scrollRestoreSuppressMs): void {
    if (this.disposed) return
    this.suppressScrollNavigationUntil = this.now() + Math.max(0, Number(durationMs) || 0)
  }

  isScrollNavigationSuppressed(now = this.now()): boolean {
    return Number(now) < this.suppressScrollNavigationUntil
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.busy = false
    this.pendingDirection = null
    this.statusText = ""
    this.cancelStatusTimer()
  }

  private scheduleStatusClear(delayMs: number): void {
    this.cancelStatusTimer()
    const delay = Math.max(0, Number(delayMs) || 0)
    this.statusTimer = this.setTimer(() => {
      this.statusTimer = null
      if (!this.disposed) {
        this.statusText = ""
        this.onStatusTextChange("")
      }
    }, delay)
  }

  private cancelStatusTimer(): void {
    if (this.statusTimer == null) return
    this.clearTimer(this.statusTimer)
    this.statusTimer = null
  }
}

export function createLargeFileWindowNavigationController(
  options?: LargeFileWindowNavigationControllerOptions,
): LargeFileWindowNavigationController {
  return new LargeFileWindowNavigationController(options)
}

function getDirectionStatusText(direction: LargeFileWindowDirection): string {
  return direction === "previous" ? LARGE_FILE_WINDOW_PREVIOUS_STATUS : LARGE_FILE_WINDOW_NEXT_STATUS
}
