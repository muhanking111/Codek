export type LargeFileWindowDirection = "previous" | "next"

export interface LargeFileWindowState {
  mode?: string
  readOnly?: boolean
  hasPrevious?: boolean
  hasNext?: boolean
  size?: number
  offset?: number
  bytesRead?: number
  windowBytes?: number
}

export interface LargeFileScrollSnapshot {
  scrollTop: number
  scrollHeight: number
  height: number
  deltaY?: number
  explicitDirection?: LargeFileWindowDirection
}

export interface LargeFileWindowNavigationDecision {
  direction: LargeFileWindowDirection
  reason: "top-edge" | "bottom-edge" | "top-preload" | "bottom-preload"
  statusText: string
}

export interface LargeFileWindowScrollAnchorInput {
  direction: LargeFileWindowDirection
  phase: "before-load" | "after-load"
  scrollHeight: number
  height: number
  preserveEdge?: boolean
}

export interface LargeFileWindowAutoNavigationDisposable {
  dispose?: () => void
}

export interface LargeFileWindowAutoNavigationEditor {
  onDidScrollChange?: (listener: (event?: LargeFileWindowScrollChangeEvent) => void) => LargeFileWindowAutoNavigationDisposable | undefined
  getDomNode?: () => LargeFileWindowAutoNavigationElement | null | undefined
  getScrollTop?: () => number
  getScrollHeight?: () => number
  getLayoutInfo?: () => { height?: number } | null | undefined
  setScrollTop?: (scrollTop: number) => void
}

export interface LargeFileWindowScrollChangeEvent {
  scrollTop?: number
}

export interface LargeFileWindowAutoNavigationElement {
  addEventListener?: (type: "wheel", listener: (event: LargeFileWindowWheelEvent) => void, options?: AddEventListenerOptions) => void
  removeEventListener?: (type: "wheel", listener: (event: LargeFileWindowWheelEvent) => void) => void
}

export interface LargeFileWindowWheelEvent {
  deltaY?: number
}

export interface LargeFileWindowAutoNavigationRequest {
  deltaY?: number
  explicitDirection?: LargeFileWindowDirection
}

export interface LargeFileWindowAutoNavigationOptions {
  editor: LargeFileWindowAutoNavigationEditor | null | undefined
  navigate: (options?: LargeFileWindowAutoNavigationRequest) => unknown
}

export interface LargeFileWindowNavigationControllerLike {
  start: (
    direction: LargeFileWindowDirection,
    options?: {
      force?: boolean
      queuePending?: boolean
      suppressScrollQueue?: boolean
    },
  ) => { allowed: true; statusText: string } | { allowed: false; statusText: string }
  finish: (options?: { allowQueued?: boolean }) => { pendingDirection: LargeFileWindowDirection | null }
  snapshot: () => { busy: boolean }
  getStatusText: () => string
  suppressScrollNavigation: () => void
  isScrollNavigationSuppressed: () => boolean
}

export interface LargeFileWindowTransitionRunnerOptions {
  controller: LargeFileWindowNavigationControllerLike
  getEditor: () => LargeFileWindowAutoNavigationEditor | null | undefined
  getActiveFile: () => string | null | undefined
  getLargeFileState: (path: string) => LargeFileWindowState | null | undefined
  loadWindow: (direction: LargeFileWindowDirection, path: string) => Promise<boolean> | boolean
  syncEditorFromWorkspace: () => unknown
  nextTick: () => Promise<unknown> | unknown
  applyEditorOptions: () => unknown
  waitForEditorFrame: () => Promise<unknown> | unknown
  requestAnimationFrame: (handler: () => void) => unknown
  setTimeout: (handler: () => void, timeout: number) => unknown
  setStatusText: (statusText: string) => void
  reportStage?: (stage: string, detail?: Record<string, unknown>) => void
}

export interface LargeFileWindowLoadOptions extends LargeFileWindowAutoNavigationRequest {
  force?: boolean
  queuePending?: boolean
  suppressScrollQueue?: boolean
}

export interface LargeFileWindowTransitionRunner {
  getDecision: (options?: LargeFileWindowAutoNavigationRequest) => LargeFileWindowNavigationDecision | null
  loadByDirection: (direction: LargeFileWindowDirection, options?: LargeFileWindowLoadOptions) => Promise<boolean>
  navigateFromEditorScroll: (options?: LargeFileWindowLoadOptions) => Promise<boolean>
}

const EDGE_THRESHOLD_PX = 96
export const LARGE_FILE_WINDOW_PRELOAD_MIN_PX = 512
export const LARGE_FILE_WINDOW_PRELOAD_VIEWPORT_RATIO = 3
export const LARGE_FILE_WINDOW_NAVIGATION_THROTTLE_MS = 80
const LARGE_FILE_WINDOW_EDGE_RETAIN_PX = 160
const LARGE_FILE_WINDOW_NEXT_RESTORE_PX = 80
const LARGE_FILE_WINDOW_RETAIN_VIEWPORT_RATIO = 0.35
const LARGE_FILE_WINDOW_NEXT_RESTORE_VIEWPORT_RATIO = 0.18

export interface LargeFileWindowNavigationGuard {
  busy?: boolean
  now?: number
  lastNavigationAt?: number
  throttleMs?: number
}

export type LargeFileWindowNavigationGuardDecision =
  | { allowed: true; statusText: string }
  | { allowed: false; reason: "busy" | "throttled"; statusText: string }

export function decideLargeFileWindowNavigationGuard(
  guard: LargeFileWindowNavigationGuard = {},
): LargeFileWindowNavigationGuardDecision {
  if (guard.busy) {
    return { allowed: false, reason: "busy", statusText: "正在载入大文件内容，请稍候" }
  }
  const now = Number(guard.now ?? Date.now())
  const lastNavigationAt = Number(guard.lastNavigationAt || 0)
  const throttleMs = Math.max(0, Number(guard.throttleMs ?? LARGE_FILE_WINDOW_NAVIGATION_THROTTLE_MS))
  if (lastNavigationAt > 0 && now - lastNavigationAt < throttleMs) {
    return { allowed: false, reason: "throttled", statusText: "滚动过快，已延迟载入下一段内容" }
  }
  return { allowed: true, statusText: "准备载入大文件内容" }
}

export function decideLargeFileWindowNavigation(
  state: LargeFileWindowState | null | undefined,
  snapshot: LargeFileScrollSnapshot,
): LargeFileWindowNavigationDecision | null {
  if (!state || state.mode !== "range") return null
  const scrollTop = Math.max(0, Number(snapshot.scrollTop) || 0)
  const scrollHeight = Math.max(0, Number(snapshot.scrollHeight) || 0)
  const height = Math.max(0, Number(snapshot.height) || 0)
  const maxScrollTop = Math.max(0, scrollHeight - height)
  const deltaY = Number(snapshot.deltaY || 0)
  const explicitDirection = snapshot.explicitDirection
  const preloadThreshold = getPreloadThreshold(height, maxScrollTop, state, deltaY)

  if (explicitDirection === "previous" && state.hasPrevious && scrollTop <= EDGE_THRESHOLD_PX) {
    return { direction: "previous", reason: "top-edge", statusText: "载入上一段大文件内容" }
  }

  if (explicitDirection === "previous" && state.hasPrevious && deltaY < 0 && preloadThreshold > EDGE_THRESHOLD_PX && scrollTop <= preloadThreshold) {
    return { direction: "previous", reason: "top-preload", statusText: "预载入上一段大文件内容" }
  }

  if (explicitDirection === "next" && state.hasNext && maxScrollTop - scrollTop <= EDGE_THRESHOLD_PX) {
    return { direction: "next", reason: "bottom-edge", statusText: "载入下一段大文件内容" }
  }

  if (explicitDirection === "next" && state.hasNext && deltaY > 0 && preloadThreshold > EDGE_THRESHOLD_PX && maxScrollTop - scrollTop <= preloadThreshold) {
    return { direction: "next", reason: "bottom-preload", statusText: "预载入下一段大文件内容" }
  }

  return null
}

export function resolveLargeFileWindowScrollTop(input: LargeFileWindowScrollAnchorInput): number {
  const scrollHeight = Math.max(0, Number(input.scrollHeight) || 0)
  const height = Math.max(0, Number(input.height) || 0)
  const maxScrollTop = Math.max(0, scrollHeight - height)
  if (maxScrollTop <= 0) return 0

  if (input.phase === "before-load") {
    return input.direction === "next"
      ? Math.max(0, maxScrollTop - getRetainedViewportInset(height))
      : Math.min(maxScrollTop, getRetainedViewportInset(height))
  }

  if (input.preserveEdge) {
    return input.direction === "next" ? maxScrollTop : 0
  }

  return input.direction === "previous"
    ? Math.max(0, maxScrollTop - getRetainedViewportInset(height))
    : Math.min(maxScrollTop, getNextWindowRestoreInset(height))
}

export function installLargeFileWindowAutoNavigation(
  options: LargeFileWindowAutoNavigationOptions,
): LargeFileWindowAutoNavigationDisposable {
  const editor = options.editor
  if (!editor?.onDidScrollChange) {
    return { dispose: () => undefined }
  }

  let lastScrollTop = Math.max(0, Number(editor.getScrollTop?.() || 0))
  const scrollDisposable = editor.onDidScrollChange((event) => {
    const scrollTop = Math.max(0, Number(event?.scrollTop ?? editor.getScrollTop?.() ?? lastScrollTop) || 0)
    const deltaY = scrollTop - lastScrollTop
    lastScrollTop = scrollTop
    if (!deltaY) {
      void options.navigate()
      return
    }
    void options.navigate({
      deltaY,
      explicitDirection: deltaY > 0 ? "next" : "previous",
    })
  })
  const container = editor.getDomNode?.()
  const wheelHandler = (event: LargeFileWindowWheelEvent) => {
    const deltaY = Number(event?.deltaY || 0)
    if (!deltaY) return
    void options.navigate({
      deltaY,
      explicitDirection: deltaY > 0 ? "next" : "previous",
    })
  }
  container?.addEventListener?.("wheel", wheelHandler, { passive: true })

  return {
    dispose: () => {
      scrollDisposable?.dispose?.()
      container?.removeEventListener?.("wheel", wheelHandler)
    },
  }
}

export function createLargeFileWindowTransitionRunner(
  runtime: LargeFileWindowTransitionRunnerOptions,
): LargeFileWindowTransitionRunner {
  const getDecision = (options: LargeFileWindowAutoNavigationRequest = {}) => {
    const editor = runtime.getEditor()
    const activeFile = runtime.getActiveFile()
    if (!editor || !activeFile) return null
    return decideLargeFileWindowNavigation(runtime.getLargeFileState(activeFile), getEditorScrollSnapshot(editor, options))
  }

  const setWindowScrollTop = (scrollTop: number) => {
    runtime.controller.suppressScrollNavigation()
    runtime.getEditor()?.setScrollTop?.(scrollTop)
  }

  const applyWindowScrollAnchor = (
    direction: LargeFileWindowDirection,
    phase: LargeFileWindowScrollAnchorInput["phase"],
    options: { preserveEdge?: boolean } = {},
  ) => {
    const editor = runtime.getEditor()
    if (!editor) return
    setWindowScrollTop(resolveLargeFileWindowScrollTop({
      direction,
      phase,
      preserveEdge: Boolean(options.preserveEdge),
      ...getEditorScrollMetrics(editor),
    }))
  }

  const loadByDirection = async (
    direction: LargeFileWindowDirection,
    options: LargeFileWindowLoadOptions = {},
  ): Promise<boolean> => {
    const editor = runtime.getEditor()
    const activeFile = runtime.getActiveFile()
    if (!editor || !activeFile) return false

    const queuePending = options.queuePending !== false
    const start = runtime.controller.start(direction, {
      force: Boolean(options.force),
      queuePending,
      suppressScrollQueue: Boolean(options.suppressScrollQueue),
    })
    runtime.setStatusText(start.statusText)
    if (!start.allowed) return false

    applyWindowScrollAnchor(direction, "before-load")
    try {
      runtime.reportStage?.("load-window:start", {
        activeFile,
        direction,
        queuePending,
        suppressScrollQueue: Boolean(options.suppressScrollQueue),
      })
      const ok = await runtime.loadWindow(direction, activeFile)
      if (!ok) return false

      runtime.syncEditorFromWorkspace()
      await runtime.nextTick()
      runtime.applyEditorOptions()
      await runtime.waitForEditorFrame()
      runtime.requestAnimationFrame(() => {
        applyWindowScrollAnchor(direction, "after-load", {
          preserveEdge: Boolean(options.explicitDirection),
        })
      })
      const state = runtime.getLargeFileState(activeFile)
      runtime.reportStage?.("load-window:done", {
        activeFile,
        direction,
        offset: Number(state?.offset || 0),
        bytesRead: Number(state?.bytesRead || 0),
      })
      return true
    } finally {
      runtime.setTimeout(() => {
        const { pendingDirection } = runtime.controller.finish({ allowQueued: queuePending })
        runtime.setStatusText(runtime.controller.getStatusText())
        if (runtime.getActiveFile() !== activeFile) return
        if (pendingDirection) {
          void loadByDirection(pendingDirection, {
            force: true,
            explicitDirection: pendingDirection,
          })
          return
        }
        if (queuePending) {
          const nextDecision = getDecision({
            explicitDirection: direction,
            deltaY: direction === "next" ? 1 : -1,
          })
          if (nextDecision?.direction === direction) {
            void loadByDirection(nextDecision.direction, {
              force: true,
              explicitDirection: nextDecision.direction,
            })
          }
        }
      }, 60)
    }
  }

  const navigateFromEditorScroll = async (options: LargeFileWindowLoadOptions = {}): Promise<boolean> => {
    if (runtime.controller.isScrollNavigationSuppressed()) return false
    if (runtime.controller.snapshot().busy) {
      if (options.queuePending === false) return false
      const decision = getDecision(options)
      if (decision) {
        const queued = runtime.controller.start(decision.direction, { queuePending: true })
        runtime.setStatusText(queued.statusText)
        applyWindowScrollAnchor(decision.direction, "before-load")
      }
      return false
    }

    const decision = getDecision(options)
    if (!decision) return false
    runtime.setStatusText(decision.statusText)
    return loadByDirection(decision.direction, { ...options, queuePending: true })
  }

  return {
    getDecision,
    loadByDirection,
    navigateFromEditorScroll,
  }
}

function getPreloadThreshold(height: number, maxScrollTop: number, state: LargeFileWindowState, deltaY = 0): number {
  if (maxScrollTop <= 0) return EDGE_THRESHOLD_PX
  const viewportThreshold = height * LARGE_FILE_WINDOW_PRELOAD_VIEWPORT_RATIO
  const windowRatio = getWindowProgressRatio(state)
  const windowThreshold = maxScrollTop * windowRatio
  const wheelThreshold = Math.abs(Number(deltaY) || 0) * 2
  const threshold = Math.max(EDGE_THRESHOLD_PX, LARGE_FILE_WINDOW_PRELOAD_MIN_PX, viewportThreshold, windowThreshold, wheelThreshold)
  return Math.min(threshold, Math.max(EDGE_THRESHOLD_PX, maxScrollTop / 2))
}

function getWindowProgressRatio(state: LargeFileWindowState): number {
  const size = Math.max(0, Number(state.size || 0))
  const windowBytes = Math.max(0, Number(state.windowBytes || state.bytesRead || 0))
  if (!size || !windowBytes) return 0
  const windowRatio = windowBytes / size
  const multiWindowRatio = size / windowBytes >= 4 ? 0.35 : 0.18
  return Math.max(multiWindowRatio, Math.min(0.5, windowRatio))
}

function getRetainedViewportInset(height: number): number {
  return Math.max(LARGE_FILE_WINDOW_EDGE_RETAIN_PX, Math.floor(height * LARGE_FILE_WINDOW_RETAIN_VIEWPORT_RATIO))
}

function getNextWindowRestoreInset(height: number): number {
  return Math.max(LARGE_FILE_WINDOW_NEXT_RESTORE_PX, Math.floor(height * LARGE_FILE_WINDOW_NEXT_RESTORE_VIEWPORT_RATIO))
}

function getEditorScrollSnapshot(
  editor: LargeFileWindowAutoNavigationEditor,
  options: LargeFileWindowAutoNavigationRequest = {},
): LargeFileScrollSnapshot {
  return {
    ...getEditorScrollMetrics(editor),
    scrollTop: Math.max(0, Number(editor.getScrollTop?.() || 0)),
    deltaY: Number(options.deltaY || 0),
    explicitDirection: options.explicitDirection,
  }
}

function getEditorScrollMetrics(editor: LargeFileWindowAutoNavigationEditor): Pick<LargeFileScrollSnapshot, "scrollHeight" | "height"> {
  const layout = editor.getLayoutInfo?.() || {}
  return {
    scrollHeight: Math.max(0, Number(editor.getScrollHeight?.() || 0)),
    height: Math.max(0, Number(layout.height || 0)),
  }
}
