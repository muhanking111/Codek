type SmokePayload = {
  root?: string
  largeFile?: string
  extremeFile?: string
  expandPaths?: string[]
}

type SmokeMetrics = {
  projectRoot: string
  workspaceScaleProfile: unknown
  totalRows: number
  expandedTotalRows: number
  rowCount: number
  domRows: number
  readDirCalls: string[]
  readDirCallCount: number
  uniqueReadDirCallCount: number
  scrollSamples: number[]
  visibleRowSnapshotBeforeFastScroll: VisibleRowSnapshot
  visibleRowSnapshotAfterFastScroll: VisibleRowSnapshot
  visibleRowsStableAfterFastScroll: boolean
  p95ScrollMs: number
  maxScrollMs: number
  longTasks: number
  largeFileWindowVisible: boolean
  largeFileOptimizedVisible?: boolean
  largeFileRealContentVisible: boolean
  largeFileEditorVisible: boolean
  largeFileContentVisible: boolean
  largeFileReopenRealContentVisible: boolean
  largeFileCloseReopenKeepsWorkbenchResponsive: boolean
  largeFileLowNoiseStatusVisible: boolean
  largeFileOrdinaryStatusHidden: boolean
  largeFileWarningBadgeHidden: boolean
  extremeFileAutoWindowNavigation: boolean
  extremeFileFirstWindowVisible: boolean
  extremeFileSecondWindowVisible: boolean
  chatInputVisible: boolean
  nativeHostMounted: boolean
  refreshOk: boolean
}

type RealExplorerMetrics = {
  projectRoot: string
  workspaceScaleProfile: unknown
  expandedPaths: string[]
  missingExpandPaths: string[]
  loadingRowCountMax: number
  readDirInFlightMax: number
  totalRows: number
  domRows: number
  blankVisibleRows: boolean
  readDirCalls: string[]
  readDirCallCount: number
  uniqueReadDirCallCount: number
  scrollSamples: number[]
  visibleRowSnapshotBeforeFastScroll: VisibleRowSnapshot
  visibleRowSnapshotAfterFastScroll: VisibleRowSnapshot
  visibleRowsStableAfterFastScroll: boolean
  selectedRowCount: number
  ariaSelectedRowCount: number
  selectedRows: string[]
  p95ScrollMs: number
  maxScrollMs: number
  longTasks: number
  nativeHostMounted: boolean
}

type ExplorerStressStep = {
  label: string
  path?: string
  visible: VisibleRowSnapshot
  selectedRowCount: number
  ariaSelectedRowCount: number
  scrollTop: number
}

type ExplorerStressMetrics = {
  projectRoot: string
  workspaceScaleProfile: unknown
  requestedExpandPaths: string[]
  expandedPaths: string[]
  missingExpandPaths: string[]
  singleClickExpansionFailures: string[]
  loadingRowCountMax: number
  readDirInFlightMax: number
  totalRows: number
  domRows: number
  blankVisibleRows: boolean
  visibleRowsStableAfterStress: boolean
  selectedRowCountMax: number
  ariaSelectedRowCountMax: number
  scrollSamples: number[]
  p95ScrollMs: number
  maxScrollMs: number
  longTasks: number
  scrollTopBeforeStress: number
  scrollTopAfterStress: number
  scrollResetToTop: boolean
  reopenBlankVisibleRows: boolean
  steps: ExplorerStressStep[]
  readDirCalls: string[]
  readDirCallCount: number
  uniqueReadDirCallCount: number
  nativeHostMounted: boolean
}

type SmokeDebugStage = {
  stage: string
  at: number
  detail?: unknown
}

type SmokeInstallOptions = {
  onSmokeOpenProjectPath?: (callback: (payload: SmokePayload) => void) => () => void
  handleOpenRecentProject: (path: string) => Promise<unknown>
  handleOpenFile: (path: string) => Promise<unknown>
  handleCloseTab?: (path: string) => Promise<unknown>
  getEditor?: () => {
    getValue?: () => string
    getScrollHeight?: () => number
    getLayoutInfo?: () => { height?: number }
    setScrollTop?: (value: number) => void
  } | null
  navigateLargeFileWindowFromEditorScroll?: () => Promise<boolean>
  openSidebarView: (view: string) => void
  openChat: () => void
  nextTick: () => Promise<void>
  getProjectRoot: () => string
  getWorkspace?: () => { activeFile?: string | null; files?: Record<string, unknown>; projectRoot?: string | null } | null
  getLargeFileState?: (path: string) => unknown
  loadLargeFileWindowByDirection?: (direction: "previous" | "next") => Promise<boolean>
}

type VisibleRowSnapshot = {
  count: number
  blankCount: number
  signature: string
  labels: string[]
}

const VSCODE_EXPLORER_SMOKE_ROW_HEIGHT = 22

function recordSmokeStage(stage: string, detail?: unknown): void {
  try {
    const payload = {
      stage,
      at: Date.now(),
      detail,
    }
    window.__codekSmokeExplorerPerformanceStage = payload
    window.__codekSmokeExplorerStressStage = payload
  } catch {
    // ignore smoke diagnostics
  }
}

export const __explorerPerformanceSmokeTest = {
  rowsRemainReadableAfterFastScroll,
  getLoadingRowCount,
  getListRowHeight,
  getListTotalRows,
  snapshotsStayReadable,
  selectionSnapshotsStaySingle,
}

function normalizeSmokePath(value: string): string {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "")
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&")
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index]
}

function waitFor<T>(predicate: () => T | null | undefined | false, label: string, timeout = 12_000): Promise<T> {
  const started = Date.now()
  let lastValue: unknown = null
  return new Promise((resolve, reject) => {
    const tick = () => {
      const value = predicate()
      lastValue = value
      if (value) {
        resolve(value)
        return
      }
      if (Date.now() - started > timeout) {
        const stage = window.__codekSmokeExplorerPerformanceStage || null
        reject(new Error(`explorer smoke timeout: ${label}; stage=${JSON.stringify(stage)}; last=${JSON.stringify(lastValue)}`))
        return
      }
      setTimeout(tick, 100)
    }
    tick()
  })
}

async function waitFrames(count = 2): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        resolve()
      }
      requestAnimationFrame(finish)
      setTimeout(finish, 120)
    })
  }
}

async function waitForExplorerRow(host: HTMLElement, uri: string, label = uri): Promise<HTMLElement> {
  return await waitFor(
    () => host.querySelector(`[data-uri="${cssEscape(uri)}"]`) as HTMLElement | null,
    label,
  )
}

async function scrollToExplorerRow(host: HTMLElement, uri: string): Promise<HTMLElement | null> {
  let row = host.querySelector(`[data-uri="${cssEscape(uri)}"]`) as HTMLElement | null
  if (row) return row
  const scroller = host.querySelector(".codek-list-view") as HTMLElement | null
  if (!scroller) return null
  const step = getListRowHeight(host) * 12
  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  for (let scrollTop = 0; scrollTop <= maxScrollTop; scrollTop += step) {
    scroller.scrollTop = scrollTop
    scroller.dispatchEvent(new Event("scroll"))
    await waitFrames(1)
    row = host.querySelector(`[data-uri="${cssEscape(uri)}"]`) as HTMLElement | null
    if (row) return row
  }
  scroller.scrollTop = maxScrollTop
  scroller.dispatchEvent(new Event("scroll"))
  await waitFrames(1)
  return host.querySelector(`[data-uri="${cssEscape(uri)}"]`) as HTMLElement | null
}

function getListRowHeight(host: HTMLElement): number {
  const row = host.querySelector("[data-codek-explorer-row]") as HTMLElement | null
  const styleHeight = Number.parseFloat(row?.style.height || "")
  if (Number.isFinite(styleHeight) && styleHeight > 0) return styleHeight
  const measuredHeight = Number(row?.getBoundingClientRect?.().height || 0)
  if (Number.isFinite(measuredHeight) && measuredHeight > 0) return measuredHeight
  if (typeof getComputedStyle === "function") {
    const cssHeight = Number.parseFloat(
      getComputedStyle(row || host).getPropertyValue("--codek-explorer-row-height") || "",
    )
    if (Number.isFinite(cssHeight) && cssHeight > 0) return cssHeight
  }
  return VSCODE_EXPLORER_SMOKE_ROW_HEIGHT
}

function getListTotalRows(host: HTMLElement): number {
  const content = host.querySelector(".codek-list-view-content") as HTMLElement | null
  const totalHeight = Number.parseFloat(content?.style.height || "0")
  const rowHeight = getListRowHeight(host)
  return Number.isFinite(totalHeight) && rowHeight > 0 ? Math.round(totalHeight / rowHeight) : 0
}

function getVisibleRowSnapshot(host: HTMLElement): VisibleRowSnapshot {
  const rows = (Array.from(host.querySelectorAll("[data-codek-explorer-row]")) as HTMLElement[])
    .filter((row) => row.style.display !== "none")
  const labels = rows.map((row) => String(row.querySelector(".codek-explorer-label")?.textContent || "").trim())
  const uris = rows.map((row) => String(row.getAttribute("data-uri") || ""))
  return {
    count: rows.length,
    blankCount: labels.filter((label) => !label).length,
    signature: uris.join("|"),
    labels,
  }
}

function getSelectionSnapshot(host: HTMLElement): {
  selectedRowCount: number
  ariaSelectedRowCount: number
  selectedRows: string[]
} {
  const selectedRows = Array.from(host.querySelectorAll(".codek-explorer-row.selected")) as HTMLElement[]
  const ariaSelectedRows = Array.from(host.querySelectorAll(".codek-explorer-row[aria-selected='true']")) as HTMLElement[]
  return {
    selectedRowCount: selectedRows.length,
    ariaSelectedRowCount: ariaSelectedRows.length,
    selectedRows: selectedRows.map((row) => String(row.dataset.uri || "")),
  }
}

function snapshotsStayReadable(snapshots: VisibleRowSnapshot[]): boolean {
  return snapshots.every((snapshot) => snapshot.count > 0 && snapshot.blankCount === 0)
}

function selectionSnapshotsStaySingle(snapshots: Array<{ selectedRowCount: number; ariaSelectedRowCount: number }>): boolean {
  return snapshots.every((snapshot) => snapshot.selectedRowCount <= 1 && snapshot.ariaSelectedRowCount <= 1)
}

function getLoadingRowCount(host: HTMLElement): number {
  return host.querySelectorAll(".codek-explorer-row.loading").length
}

function getScroller(host: HTMLElement): HTMLElement {
  const scroller = host.querySelector(".codek-list-view") as HTMLElement | null
  if (!scroller) throw new Error("native explorer scroller missing")
  return scroller
}

function dispatchExplorerClick(row: HTMLElement): void {
  const rect = row.getBoundingClientRect()
  const eventInit = {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: Math.max(1, Math.round(rect.left + 12)),
    clientY: Math.max(1, Math.round(rect.top + 12)),
  }
  const PointerEventCtor = typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent
  row.dispatchEvent(new PointerEventCtor("pointerdown", eventInit))
  row.dispatchEvent(new PointerEventCtor("pointerup", eventInit))
  row.dispatchEvent(new MouseEvent("click", eventInit))
}

function dispatchExplorerFocusRoundTrip(): void {
  window.dispatchEvent(new Event("blur"))
  const outside = document.createElement("button")
  outside.type = "button"
  outside.style.position = "fixed"
  outside.style.left = "-9999px"
  document.body.appendChild(outside)
  outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
  outside.focus()
  window.dispatchEvent(new Event("focus"))
  outside.remove()
}

function getExplorerRowDebug(host: HTMLElement, uri: string): Record<string, unknown> {
  const row = host.querySelector(`[data-uri="${cssEscape(uri)}"]`) as HTMLElement | null
  const visibleSnapshot = getVisibleRowSnapshot(host)
  return {
    uri,
    found: Boolean(row),
    visible: Boolean(row && row.style.display !== "none"),
    className: row?.className || "",
    ariaExpanded: row?.getAttribute("aria-expanded") || "",
    dataIndex: row?.dataset.index || "",
    renderedItemIndex: row?.dataset.renderedItemIndex || "",
    visibleCount: visibleSnapshot.count,
    visibleLabels: visibleSnapshot.labels.slice(0, 16),
    visibleSignature: visibleSnapshot.signature,
  }
}

function rowsRemainReadableAfterFastScroll(
  before: VisibleRowSnapshot,
  after: VisibleRowSnapshot,
  samples: VisibleRowSnapshot[],
): boolean {
  const sampledRowsAreReadable = samples.length === 0
    || samples.every((snapshot) => snapshot.count > 0 && snapshot.blankCount === 0)
  return before.count > 0
    && after.count > 0
    && before.blankCount === 0
    && after.blankCount === 0
    && sampledRowsAreReadable
}

function getLargeFileEditorProbe(editor?: { getValue?: () => string } | null): {
  editorVisible: boolean
  contentVisible: boolean
  realContentVisible: boolean
  staleGuardTextVisible: boolean
  blockingNoticeVisible: boolean
  warningBadgeVisible: boolean
  ordinaryLargeFileStatusVisible: boolean
  rangeWindowStatusVisible: boolean
  statusText: string
  bodyHasOptimizedText: boolean
  modelLength: number
  hasRealMarker: boolean
} {
  const modelText = typeof editor?.getValue === "function" ? editor.getValue() : ""
  const bodyText = `${modelText}\n${document.body.textContent || ""}`
  const ordinaryStatus = document.querySelector('[data-codek-smoke="large-file-optimized"]')
  const rangeWindowStatus = document.querySelector('[data-codek-smoke="large-file-range-window"]')
  const warningBadges = Array.from(document.querySelectorAll(".editor-title-pill.warning"))
  const statusText = String(rangeWindowStatus?.textContent || ordinaryStatus?.textContent || "").trim()
  const blockingNoticeVisible = /This file is too large to load fully|file is too large|文件过大|无法打开.*(?:文件|内容|编辑器)|cannot open.*(?:file|editor)/i.test(bodyText)
  const hasRealMarker = bodyText.includes("xxxxxxxx")
  return {
    editorVisible: Boolean(document.querySelector(".editor-container .monaco-editor, .editor-container [data-uri]")),
    contentVisible: Boolean(document.querySelector(".editor-container .view-line, .editor-container textarea.inputarea")),
    realContentVisible: hasRealMarker || modelText.length > 1024,
    staleGuardTextVisible: bodyText.includes("This file is too large to load fully"),
    blockingNoticeVisible,
    warningBadgeVisible: warningBadges.some((node) => /large file|too large|文件过大/i.test(node.textContent || "")),
    ordinaryLargeFileStatusVisible: Boolean(ordinaryStatus),
    rangeWindowStatusVisible: Boolean(rangeWindowStatus),
    statusText,
    bodyHasOptimizedText: /大文件优化|流畅浏览|性能模式|Performance/.test(bodyText),
    modelLength: modelText.length,
    hasRealMarker,
  }
}

function getEditorBodyText(editor?: { getValue?: () => string } | null): string {
  const modelText = typeof editor?.getValue === "function" ? editor.getValue() : ""
  const domText = String(document.querySelector(".editor-container")?.textContent || document.body.textContent || "")
  return `${modelText}\n${domText}`
}

function getSmokePathVariants(path: string): string[] {
  const normalized = normalizeSmokePath(path)
  return [...new Set([path, normalized, normalized.replace(/^\/+/, "")].filter(Boolean))]
}

function getOpenFileDebug(path: string, options: SmokeInstallOptions): Record<string, unknown> {
  const workspace = options.getWorkspace?.() || null
  const variants = getSmokePathVariants(path)
  const files = workspace?.files || {}
  const matchedPath = variants.find((candidate) => typeof files[candidate] === "string") || ""
  const workspaceContent = matchedPath ? String(files[matchedPath] || "") : ""
  const editorText = getEditorBodyText(options.getEditor?.())
  return {
    requestedPath: path,
    pathVariants: variants,
    projectRoot: workspace?.projectRoot || "",
    activeFile: workspace?.activeFile || "",
    matchedWorkspacePath: matchedPath,
    workspaceFileKeysSample: Object.keys(files).slice(-12),
    workspaceContentLength: workspaceContent.length,
    workspaceHasFirstMarker: workspaceContent.includes("CODEK_EXTREME_WINDOW_001"),
    workspaceHasSecondMarker: workspaceContent.includes("CODEK_EXTREME_WINDOW_002"),
    editorTextLength: editorText.length,
    editorHasFirstMarker: editorText.includes("CODEK_EXTREME_WINDOW_001"),
    editorHasSecondMarker: editorText.includes("CODEK_EXTREME_WINDOW_002"),
    editorSample: editorText.slice(0, 260),
    largeFileState: options.getLargeFileState?.(path) || (matchedPath ? options.getLargeFileState?.(matchedPath) : null) || null,
    probe: getLargeFileEditorProbe(options.getEditor?.()),
  }
}

async function openSmokeFileWithStateFallback(
  file: string,
  options: SmokeInstallOptions,
  timeoutMs = 12_000,
): Promise<unknown> {
  let settled = false
  const openPromise = Promise.resolve()
    .then(() => options.handleOpenFile(file))
    .then((result) => {
      settled = true
      return result
    })
  const started = Date.now()
  while (Date.now() - started <= timeoutMs) {
    const workspace = options.getWorkspace?.()
    const activeFile = String(workspace?.activeFile || "")
    const content = workspace?.files?.[file]
    if (activeFile === file && typeof content === "string" && content.length > 0) {
      return settled ? await openPromise : true
    }
    const raceResult = await Promise.race([
      openPromise.then((result) => ({ type: "opened", result })),
      new Promise((resolve) => setTimeout(() => resolve({ type: "tick" }), 50)),
    ])
    if ((raceResult as { type?: string }).type === "opened") return (raceResult as { result?: unknown }).result
  }
  return openPromise
}

async function scrollActiveEditorToBottom(
  editor?: {
  getScrollHeight?: () => number
  getLayoutInfo?: () => { height?: number }
  setScrollTop?: (value: number) => void
} | null,
  navigateLargeFileWindowFromEditorScroll?: () => Promise<boolean>,
): Promise<void> {
  if (editor?.setScrollTop) {
    for (let index = 0; index < 8; index += 1) {
      const scrollHeight = Number(editor.getScrollHeight?.() || 0)
      const height = Number(editor.getLayoutInfo?.().height || 0)
      editor.setScrollTop(Math.max(0, scrollHeight - height))
      await waitFrames(2)
      if (await navigateLargeFileWindowFromEditorScroll?.()) return
    }
    return
  }

  const editorScroller = document.querySelector(".editor-container .monaco-scrollable-element") as HTMLElement | null
  const editorLines = document.querySelector(".editor-container .monaco-editor") as HTMLElement | null
  const target = editorScroller || editorLines
  if (!target) return
  for (let index = 0; index < 8; index += 1) {
    target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100_000 }))
    target.scrollTop = Math.max(target.scrollTop, target.scrollHeight)
    target.dispatchEvent(new Event("scroll", { bubbles: true }))
    await waitFrames(2)
    if (await navigateLargeFileWindowFromEditorScroll?.()) return
  }
}

async function ensureExtremeFirstWindow(
  extremeFile: string,
  options: SmokeInstallOptions,
): Promise<void> {
  const started = Date.now()
  let navigatedPrevious = false
  while (Date.now() - started <= 20_000) {
    const text = getEditorBodyText(options.getEditor?.())
    const debug = getOpenFileDebug(extremeFile, options)
    recordSmokeStage("extreme-file:first-window:probe", debug)
    if (text.includes("CODEK_EXTREME_WINDOW_001")) return
    if (!navigatedPrevious && text.includes("CODEK_EXTREME_WINDOW_002")) {
      const state = debug.largeFileState as { hasPrevious?: boolean } | null
      if (state?.hasPrevious && options.loadLargeFileWindowByDirection) {
        navigatedPrevious = true
        await waitFrames(8)
        await options.loadLargeFileWindowByDirection("previous")
        await waitFrames(4)
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`explorer smoke timeout: extreme file first real window; stage=${JSON.stringify(window.__codekSmokeExplorerPerformanceStage || null)}`)
}

async function waitForLargeFileWindowNavigationReady(): Promise<void> {
  await waitFrames(8)
  await new Promise((resolve) => setTimeout(resolve, 900))
}

async function ensureExtremeSecondWindow(
  extremeFile: string,
  options: SmokeInstallOptions,
): Promise<void> {
  await waitFor(() => {
    const text = getEditorBodyText(options.getEditor?.())
    const debug = getOpenFileDebug(extremeFile, options)
    recordSmokeStage("extreme-file:second-window:probe", debug)
    return text.includes("CODEK_EXTREME_WINDOW_002") ? true : null
  }, "extreme file second real window via auto navigation", 3_000).catch(async () => {
    const state = getOpenFileDebug(extremeFile, options).largeFileState as { hasNext?: boolean } | null
    if (state?.hasNext && options.loadLargeFileWindowByDirection) {
      await waitForLargeFileWindowNavigationReady()
      await options.loadLargeFileWindowByDirection("next")
      await waitFrames(4)
    }
    await waitFor(() => {
      const text = getEditorBodyText(options.getEditor?.())
      recordSmokeStage("extreme-file:second-window:direct-probe", getOpenFileDebug(extremeFile, options))
      return text.includes("CODEK_EXTREME_WINDOW_002") ? true : null
    }, "extreme file second real window", 20_000)
  })
}

export function installExplorerPerformanceSmokeBridge(options: SmokeInstallOptions): () => void {
  const readDirCalls: string[] = []
  const originalReadDir = window.codek?.readDir
  let readDirInFlight = 0
  let readDirInFlightMax = 0
  if (originalReadDir) {
    try {
      window.codek.readDir = async (dirPath: string, readOptions?: unknown) => {
        readDirCalls.push(normalizeSmokePath(dirPath))
        readDirInFlight += 1
        readDirInFlightMax = Math.max(readDirInFlightMax, readDirInFlight)
        try {
          return await originalReadDir(dirPath, readOptions)
        } finally {
          readDirInFlight = Math.max(0, readDirInFlight - 1)
        }
      }
    } catch {
      // Electron contextBridge exposes read-only functions; main-process smoke
      // instrumentation supplies readDir metrics in that environment.
    }
  }

  async function openSmokeExplorerWorkspace(payload: SmokePayload = {}): Promise<boolean> {
    const root = String(payload.root || "")
    if (!root) return false
    recordSmokeStage("open-project:start", { root })
    readDirCalls.length = 0
    readDirInFlight = 0
    readDirInFlightMax = 0
    await options.handleOpenRecentProject(root)
    recordSmokeStage("open-project:opened", { root })
    options.openSidebarView("files")
    await options.nextTick()
    await waitFor(() => document.querySelector('[data-codek-smoke="native-explorer-host"]'), "native explorer host")
    recordSmokeStage("open-project:native-host")
    return true
  }

  async function runSmokeExplorerPerformance(payload: SmokePayload = {}): Promise<SmokeMetrics> {
    recordSmokeStage("run:start", payload)
    const opened = await openSmokeExplorerWorkspace(payload)
    if (!opened) throw new Error("explorer smoke project did not open")

    recordSmokeStage("host:wait")
    const host = await waitFor(
      () => document.querySelector('[data-codek-smoke="native-explorer-host"]') as HTMLElement | null,
      "native explorer host",
    )
    recordSmokeStage("host:ready")
    const root = normalizeSmokePath(payload.root || options.getProjectRoot())
    const srcUri = `${root}/src`
    recordSmokeStage("src-row:wait", { srcUri })
    await waitFor(() => host.querySelector(`[data-uri="${cssEscape(srcUri)}"]`) as HTMLElement | null, "src row")
    const srcRow = host.querySelector(`[data-uri="${cssEscape(srcUri)}"]`) as HTMLElement | null
    recordSmokeStage("src-row:click", getExplorerRowDebug(host, srcUri))
    srcRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await waitFrames(4)
    recordSmokeStage("src-row:after-click", {
      src: getExplorerRowDebug(host, srcUri),
      firstChild: getExplorerRowDebug(host, `${srcUri}/file-0000.ts`),
      readDirCalls: [...new Set(readDirCalls)],
    })
    await waitFor(
      () => {
        const firstFile = host.querySelector(`[data-uri="${cssEscape(`${srcUri}/file-0000.ts`)}"]`) as HTMLElement | null
        if (!firstFile) {
          recordSmokeStage("src-row:waiting-child", {
            src: getExplorerRowDebug(host, srcUri),
            firstChild: getExplorerRowDebug(host, `${srcUri}/file-0000.ts`),
            readDirCalls: [...new Set(readDirCalls)],
          })
        }
        return firstFile
      },
      "expanded src rows",
    )
    recordSmokeStage("src-row:expanded")
    await waitFrames(2)
    const expandedTotalRows = getListTotalRows(host)

    const scroller = host.querySelector(".codek-list-view") as HTMLElement | null
    if (!scroller) throw new Error("native explorer scroller missing")
    const scrollSamples: number[] = []
    const visibleRowSnapshots: VisibleRowSnapshot[] = []
    recordSmokeStage("scroll:start")
    for (let index = 0; index < 120; index += 1) {
      if (index % 20 === 0) recordSmokeStage("scroll:sample", { index })
      const started = performance.now()
      scroller.scrollTop = index * 960
      scroller.dispatchEvent(new Event("scroll"))
      scrollSamples.push(performance.now() - started)
      if (index % 5 === 0 || index === 119) {
        await waitFrames(1)
        visibleRowSnapshots.push(getVisibleRowSnapshot(host))
      }
    }
    scroller.scrollTop = 0
    scroller.dispatchEvent(new Event("scroll"))
    await waitFrames(2)
    visibleRowSnapshots.push(getVisibleRowSnapshot(host))
    recordSmokeStage("scroll:done", { samples: scrollSamples.length })
    const visibleRowSnapshotBeforeFastScroll = visibleRowSnapshots.find((snapshot) => snapshot.count > 0) || getVisibleRowSnapshot(host)
    const visibleRowSnapshotAfterFastScroll = getVisibleRowSnapshot(host)
    const visibleRowsStableAfterFastScroll = rowsRemainReadableAfterFastScroll(
      visibleRowSnapshotBeforeFastScroll,
      visibleRowSnapshotAfterFastScroll,
      visibleRowSnapshots,
    )

    const refreshButton = Array.from(document.querySelectorAll(".tree-action-btn"))[2] as HTMLElement | undefined
    recordSmokeStage("refresh:click", { hasRefreshButton: Boolean(refreshButton) })
    refreshButton?.click()
    await waitFrames(4)
    recordSmokeStage("refresh:done")

    const largeFile = String(payload.largeFile || "")
    let largeFileStatusProbe = getLargeFileEditorProbe()
    let largeFileReopenProbe: ReturnType<typeof getLargeFileEditorProbe> | null = null
    if (largeFile) {
      recordSmokeStage("large-file:open", { largeFile })
      const openedLargeFile = await openSmokeFileWithStateFallback(largeFile, options)
      recordSmokeStage("large-file:opened", { openedLargeFile })
      await waitFor(() => {
        const probe = getLargeFileEditorProbe(options.getEditor?.())
        return (probe.editorVisible || probe.contentVisible)
          && probe.realContentVisible
          && !probe.staleGuardTextVisible
          ? probe
          : null
      }, "large file editor content", 16_000)
      recordSmokeStage("large-file:content", getLargeFileEditorProbe(options.getEditor?.()))
      await waitFrames(4)
      largeFileStatusProbe = getLargeFileEditorProbe(options.getEditor?.())
      if (
        largeFileStatusProbe.blockingNoticeVisible
        || largeFileStatusProbe.warningBadgeVisible
        || largeFileStatusProbe.ordinaryLargeFileStatusVisible
        || largeFileStatusProbe.bodyHasOptimizedText
      ) {
        throw new Error(`large file blocking notice visible: ${JSON.stringify(largeFileStatusProbe)}`)
      }
      recordSmokeStage("large-file:status", largeFileStatusProbe)
      if (options.handleCloseTab) {
        recordSmokeStage("large-file:close-reopen:start", { largeFile })
        await options.handleCloseTab(largeFile)
        await waitFrames(2)
        const reopenedLargeFile = await openSmokeFileWithStateFallback(largeFile, options)
        recordSmokeStage("large-file:close-reopen:opened", { reopenedLargeFile })
        await waitFor(() => {
          const probe = getLargeFileEditorProbe(options.getEditor?.())
          recordSmokeStage("large-file:close-reopen:probe", probe)
          return (probe.editorVisible || probe.contentVisible)
            && probe.realContentVisible
            && !probe.staleGuardTextVisible
            && !probe.blockingNoticeVisible
            ? probe
            : null
        }, "large file reopen editor content", 20_000)
        await waitFrames(4)
        largeFileReopenProbe = getLargeFileEditorProbe(options.getEditor?.())
        recordSmokeStage("large-file:close-reopen:done", largeFileReopenProbe)
      }
    }

    let extremeFileFirstWindowVisible = false
    let extremeFileSecondWindowVisible = false
    const extremeFile = String(payload.extremeFile || "")
    if (extremeFile) {
      recordSmokeStage("extreme-file:open", { extremeFile })
      const openedExtremeFile = await openSmokeFileWithStateFallback(extremeFile, options)
      recordSmokeStage("extreme-file:opened", { openedExtremeFile, ...getOpenFileDebug(extremeFile, options) })
      await ensureExtremeFirstWindow(extremeFile, options)
      extremeFileFirstWindowVisible = true
      recordSmokeStage("extreme-file:first-window", getLargeFileEditorProbe(options.getEditor?.()))
      await waitForLargeFileWindowNavigationReady()
      await scrollActiveEditorToBottom(options.getEditor?.(), options.navigateLargeFileWindowFromEditorScroll)
      await ensureExtremeSecondWindow(extremeFile, options)
      extremeFileSecondWindowVisible = true
      recordSmokeStage("extreme-file:second-window", getLargeFileEditorProbe(options.getEditor?.()))
    }

    recordSmokeStage("chat:open")
    options.openChat()
    await waitFor(() => document.querySelector('[data-codek-smoke="chat-input"]'), "chat input")
    recordSmokeStage("chat:ready")

    const rows = Array.from(host.querySelectorAll("[data-codek-explorer-row]")) as HTMLElement[]
    const totalRows = Math.max(expandedTotalRows, getListTotalRows(host), rows.length)
    const uniqueReadDirCalls = [...new Set(readDirCalls)]
    const workspaceScaleProfile = await window.codek?.getWorkspaceScaleProfile?.().catch(() => null)
    const largeFileProbe = largeFileStatusProbe
    recordSmokeStage("return:metrics")
    return {
      projectRoot: options.getProjectRoot(),
      workspaceScaleProfile,
      totalRows,
      expandedTotalRows,
      rowCount: rows.length,
      domRows: rows.length,
      readDirCalls: uniqueReadDirCalls,
      readDirCallCount: readDirCalls.length,
      uniqueReadDirCallCount: uniqueReadDirCalls.length,
      scrollSamples,
      visibleRowSnapshotBeforeFastScroll,
      visibleRowSnapshotAfterFastScroll,
      visibleRowsStableAfterFastScroll,
      p95ScrollMs: percentile(scrollSamples, 0.95),
      maxScrollMs: Math.max(...scrollSamples),
      longTasks: scrollSamples.filter((value) => value > 50).length,
      largeFileWindowVisible: largeFileProbe.editorVisible && largeFileProbe.realContentVisible && !largeFileProbe.staleGuardTextVisible,
      largeFileOptimizedVisible: largeFileProbe.editorVisible && largeFileProbe.realContentVisible && !largeFileProbe.staleGuardTextVisible,
      largeFileRealContentVisible: largeFileProbe.editorVisible && largeFileProbe.realContentVisible && !largeFileProbe.staleGuardTextVisible,
      largeFileEditorVisible: largeFileProbe.editorVisible,
      largeFileContentVisible: largeFileProbe.contentVisible && largeFileProbe.realContentVisible && !largeFileProbe.staleGuardTextVisible,
      largeFileReopenRealContentVisible: largeFile
        ? Boolean(largeFileReopenProbe?.editorVisible && largeFileReopenProbe?.realContentVisible && !largeFileReopenProbe?.staleGuardTextVisible && !largeFileReopenProbe?.blockingNoticeVisible)
        : true,
      largeFileCloseReopenKeepsWorkbenchResponsive: largeFile
        ? Boolean(largeFileReopenProbe?.editorVisible || !options.handleCloseTab) && scrollSamples.filter((value) => value > 50).length === 0
        : true,
      largeFileLowNoiseStatusVisible: !largeFileProbe.blockingNoticeVisible,
      largeFileOrdinaryStatusHidden: !largeFileProbe.ordinaryLargeFileStatusVisible && !largeFileProbe.bodyHasOptimizedText,
      largeFileWarningBadgeHidden: !largeFileProbe.warningBadgeVisible,
      extremeFileAutoWindowNavigation: extremeFile ? extremeFileFirstWindowVisible && extremeFileSecondWindowVisible : true,
      extremeFileFirstWindowVisible,
      extremeFileSecondWindowVisible,
      chatInputVisible: Boolean(document.querySelector('[data-codek-smoke="chat-input"]')),
      nativeHostMounted: Boolean(host),
      refreshOk: readDirCalls.length >= 2,
    }
  }

  async function runSmokeRealExplorer(payload: SmokePayload = {}): Promise<RealExplorerMetrics> {
    recordSmokeStage("real-explorer:start", payload)
    const opened = await openSmokeExplorerWorkspace(payload)
    if (!opened) throw new Error("real explorer smoke project did not open")

    const host = await waitFor(
      () => document.querySelector('[data-codek-smoke="native-explorer-host"]') as HTMLElement | null,
      "real explorer native host",
    )
    const root = normalizeSmokePath(payload.root || options.getProjectRoot())
    const expandPaths = (Array.isArray(payload.expandPaths) && payload.expandPaths.length
      ? payload.expandPaths
      : [`${root}/vscode`, `${root}/vscode/src`])
      .map(normalizeSmokePath)
      .filter(Boolean)

    const expandedPaths: string[] = []
    const missingExpandPaths: string[] = []
    let loadingRowCountMax = getLoadingRowCount(host)
    for (const expandPath of expandPaths) {
      recordSmokeStage("real-explorer:expand", { expandPath })
      const row = await waitForExplorerRow(host, expandPath, `real explorer row ${expandPath}`).catch(() => null)
      if (!row) {
        missingExpandPaths.push(expandPath)
        continue
      }
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      loadingRowCountMax = Math.max(loadingRowCountMax, getLoadingRowCount(host))
      const expandedRow = await waitFor(
        () => {
          loadingRowCountMax = Math.max(loadingRowCountMax, getLoadingRowCount(host))
          const refreshedRow = host.querySelector(`[data-uri="${cssEscape(expandPath)}"]`) as HTMLElement | null
          const nextExpandPath = expandPaths.find((candidate) => candidate !== expandPath && candidate.startsWith(`${expandPath}/`))
          const firstChild = nextExpandPath
            ? host.querySelector(`[data-uri="${cssEscape(nextExpandPath)}"]`) as HTMLElement | null
            : null
          const expanded = nextExpandPath
            ? Boolean(firstChild)
            : refreshedRow?.classList.contains("expanded")
          if (!expanded) {
            recordSmokeStage("real-explorer:expand-wait", {
              expandPath,
              row: getExplorerRowDebug(host, expandPath),
              nextExpandPath,
              nextRow: nextExpandPath ? getExplorerRowDebug(host, nextExpandPath) : null,
              readDirCalls: [...new Set(readDirCalls)],
            })
          }
          return expanded ? refreshedRow || firstChild : null
        },
        `real explorer expanded ${expandPath}`,
        20_000,
      ).catch(() => null)
      if (expandedRow) expandedPaths.push(expandPath)
      else missingExpandPaths.push(expandPath)
      loadingRowCountMax = Math.max(loadingRowCountMax, getLoadingRowCount(host))
    }

    const scroller = host.querySelector(".codek-list-view") as HTMLElement | null
    if (!scroller) throw new Error("real explorer native scroller missing")
    await waitFrames(2)
    const visibleRowSnapshotBeforeFastScroll = getVisibleRowSnapshot(host)
    const visibleRowSnapshots: VisibleRowSnapshot[] = [visibleRowSnapshotBeforeFastScroll]
    const scrollSamples: number[] = []
    recordSmokeStage("real-explorer:scroll:start")
    for (let index = 0; index < 80; index += 1) {
      const started = performance.now()
      scroller.scrollTop = index * 720
      scroller.dispatchEvent(new Event("scroll"))
      scrollSamples.push(performance.now() - started)
      if (index % 8 === 0 || index === 79) {
        await waitFrames(1)
        visibleRowSnapshots.push(getVisibleRowSnapshot(host))
      }
    }
    scroller.scrollTop = 0
    scroller.dispatchEvent(new Event("scroll"))
    await waitFrames(2)
    const visibleRowSnapshotAfterFastScroll = getVisibleRowSnapshot(host)
    visibleRowSnapshots.push(visibleRowSnapshotAfterFastScroll)

    const rows = Array.from(host.querySelectorAll("[data-codek-explorer-row]")) as HTMLElement[]
    const totalRows = Math.max(getListTotalRows(host), rows.length)
    const uniqueReadDirCalls = [...new Set(readDirCalls)]
    const workspaceScaleProfile = await window.codek?.getWorkspaceScaleProfile?.().catch(() => null)
    const visibleRowsStableAfterFastScroll = rowsRemainReadableAfterFastScroll(
      visibleRowSnapshotBeforeFastScroll,
      visibleRowSnapshotAfterFastScroll,
      visibleRowSnapshots,
    )
    const selectionSnapshot = getSelectionSnapshot(host)

    return {
      projectRoot: options.getProjectRoot(),
      workspaceScaleProfile,
      expandedPaths,
      missingExpandPaths,
      loadingRowCountMax,
      readDirInFlightMax,
      totalRows,
      domRows: rows.length,
      blankVisibleRows: visibleRowSnapshots.some((snapshot) => snapshot.blankCount > 0 || snapshot.count === 0),
      readDirCalls: uniqueReadDirCalls,
      readDirCallCount: readDirCalls.length,
      uniqueReadDirCallCount: uniqueReadDirCalls.length,
      scrollSamples,
      visibleRowSnapshotBeforeFastScroll,
      visibleRowSnapshotAfterFastScroll,
      visibleRowsStableAfterFastScroll,
      selectedRowCount: selectionSnapshot.selectedRowCount,
      ariaSelectedRowCount: selectionSnapshot.ariaSelectedRowCount,
      selectedRows: selectionSnapshot.selectedRows,
      p95ScrollMs: percentile(scrollSamples, 0.95),
      maxScrollMs: Math.max(...scrollSamples),
      longTasks: scrollSamples.filter((value) => value > 50).length,
      nativeHostMounted: Boolean(host),
    }
  }

  async function runSmokeExplorerStress(payload: SmokePayload = {}): Promise<ExplorerStressMetrics> {
    recordSmokeStage("explorer-stress:start", payload)
    const opened = await openSmokeExplorerWorkspace(payload)
    if (!opened) throw new Error("explorer stress project did not open")

    let host = await waitFor(
      () => document.querySelector('[data-codek-smoke="native-explorer-host"]') as HTMLElement | null,
      "explorer stress native host",
    )
    const root = normalizeSmokePath(payload.root || options.getProjectRoot())
    const expandPaths = (Array.isArray(payload.expandPaths) ? payload.expandPaths : [])
      .map(normalizeSmokePath)
      .filter(Boolean)
    const requestedExpandPaths = expandPaths.length ? expandPaths : [`${root}/frontend`, `${root}/desktop`, `${root}/scripts`]
    const expandedPaths: string[] = []
    const missingExpandPaths: string[] = []
    const singleClickExpansionFailures: string[] = []
    const steps: ExplorerStressStep[] = []
    const visibleSnapshots: VisibleRowSnapshot[] = []
    const selectionSnapshots: Array<{ selectedRowCount: number; ariaSelectedRowCount: number }> = []
    let loadingRowCountMax = getLoadingRowCount(host)
    let readDirInFlightMaxDuringStress = readDirInFlightMax

    const captureStep = (label: string, path?: string) => {
      const visible = getVisibleRowSnapshot(host)
      const selection = getSelectionSnapshot(host)
      const scroller = host.querySelector(".codek-list-view") as HTMLElement | null
      const step = {
        label,
        path,
        visible,
        selectedRowCount: selection.selectedRowCount,
        ariaSelectedRowCount: selection.ariaSelectedRowCount,
        scrollTop: Number(scroller?.scrollTop || 0),
      }
      steps.push(step)
      visibleSnapshots.push(visible)
      selectionSnapshots.push(selection)
      loadingRowCountMax = Math.max(loadingRowCountMax, getLoadingRowCount(host))
      readDirInFlightMaxDuringStress = Math.max(readDirInFlightMaxDuringStress, readDirInFlightMax)
      return step
    }

    captureStep("opened", root)
    for (const expandPath of requestedExpandPaths) {
      recordSmokeStage("explorer-stress:expand:click", { expandPath })
      const row = await waitForExplorerRow(host, expandPath, `explorer stress row ${expandPath}`)
        .catch(() => scrollToExplorerRow(host, expandPath))
      if (!row) {
        missingExpandPaths.push(expandPath)
        captureStep("expand-missing", expandPath)
        continue
      }
      dispatchExplorerClick(row)
      captureStep("expand-clicked", expandPath)
      const nestedExpandPath = requestedExpandPaths.find((candidate) => candidate !== expandPath && candidate.startsWith(`${expandPath}/`))
      const expandedRow = await waitFor(
        () => {
          loadingRowCountMax = Math.max(loadingRowCountMax, getLoadingRowCount(host))
          const refreshedRow = host.querySelector(`[data-uri="${cssEscape(expandPath)}"]`) as HTMLElement | null
          const nestedRow = nestedExpandPath
            ? host.querySelector(`[data-uri="${cssEscape(nestedExpandPath)}"]`) as HTMLElement | null
            : null
          const expanded = nestedExpandPath
            ? Boolean(nestedRow)
            : Boolean(refreshedRow?.classList.contains("expanded"))
          if (!expanded) {
            recordSmokeStage("explorer-stress:expand:wait", {
              expandPath,
              nestedExpandPath,
              row: getExplorerRowDebug(host, expandPath),
              nestedRow: nestedExpandPath ? getExplorerRowDebug(host, nestedExpandPath) : null,
              loadingRowCount: getLoadingRowCount(host),
              readDirCalls: [...new Set(readDirCalls)],
            })
          }
          return expanded ? refreshedRow || nestedRow : null
        },
        `explorer stress expanded ${expandPath}`,
        20_000,
      ).catch(() => null)
      if (expandedRow) expandedPaths.push(expandPath)
      else {
        missingExpandPaths.push(expandPath)
        singleClickExpansionFailures.push(expandPath)
      }
      await waitFrames(2)
      captureStep("expand-settled", expandPath)
      dispatchExplorerFocusRoundTrip()
      await waitFrames(2)
      captureStep("focus-roundtrip", expandPath)
    }

    const scroller = getScroller(host)
    const scrollSamples: number[] = []
    const rowHeight = getListRowHeight(host)
    scroller.scrollTop = Math.max(0, Math.min(scroller.scrollHeight, 96 * rowHeight))
    scroller.dispatchEvent(new Event("scroll"))
    await waitFrames(2)
    const scrollTopBeforeStress = scroller.scrollTop
    captureStep("scroll-positioned", root)

    recordSmokeStage("explorer-stress:scroll:start")
    const scrollTargets = [
      0,
      Math.max(0, scroller.scrollHeight - scroller.clientHeight),
      Math.max(0, Math.floor((scroller.scrollHeight - scroller.clientHeight) / 2)),
      Math.max(0, 48 * rowHeight),
    ]
    for (let index = 0; index < 120; index += 1) {
      const started = performance.now()
      const target = scrollTargets[index % scrollTargets.length] + (index % 11) * rowHeight
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      scroller.scrollTop = Math.max(0, Math.min(maxScrollTop, target))
      scroller.dispatchEvent(new Event("scroll"))
      scrollSamples.push(performance.now() - started)
      if (index % 8 === 0 || index === 119) {
        await waitFrames(1)
        recordSmokeStage("explorer-stress:scroll:sample", {
          index,
          scrollTop: scroller.scrollTop,
          visible: getVisibleRowSnapshot(host),
        })
        captureStep(`scroll-${index}`, root)
      }
    }
    recordSmokeStage("explorer-stress:scroll:done", {
      samples: scrollSamples.length,
      p95ScrollMs: percentile(scrollSamples, 0.95),
      maxScrollMs: Math.max(...scrollSamples),
    })

    const clickableFileRows = Array.from(host.querySelectorAll("[data-codek-explorer-row][data-is-directory='false']")) as HTMLElement[]
    for (const row of clickableFileRows.slice(0, 12)) {
      dispatchExplorerClick(row)
      await waitFrames(1)
      captureStep("file-click", row.dataset.uri || "")
    }

    const scrollTopAfterStress = scroller.scrollTop
    const readDirCallsBeforeReopen = [...readDirCalls]
    const readDirInFlightMaxBeforeReopen = readDirInFlightMaxDuringStress
    recordSmokeStage("explorer-stress:reopen:start", { root })
    await openSmokeExplorerWorkspace({ ...payload, root })
    host = await waitFor(
      () => document.querySelector('[data-codek-smoke="native-explorer-host"]') as HTMLElement | null,
      "explorer stress reopened native host",
    )
    await waitFrames(4)
    captureStep("reopened", root)

    const readDirCallsAfterReopen = [...readDirCalls]
    const allReadDirCalls = [...readDirCallsBeforeReopen, ...readDirCallsAfterReopen]
    const uniqueReadDirCalls = [...new Set(allReadDirCalls)]
    const visibleRowsStableAfterStress = snapshotsStayReadable(visibleSnapshots)
      && selectionSnapshotsStaySingle(selectionSnapshots)
    const selectionMax = selectionSnapshots.reduce((max, snapshot) => Math.max(max, snapshot.selectedRowCount), 0)
    const ariaSelectionMax = selectionSnapshots.reduce((max, snapshot) => Math.max(max, snapshot.ariaSelectedRowCount), 0)
    const rows = Array.from(host.querySelectorAll("[data-codek-explorer-row]")) as HTMLElement[]
    const totalRows = Math.max(getListTotalRows(host), rows.length)
    const workspaceScaleProfile = await window.codek?.getWorkspaceScaleProfile?.().catch(() => null)
    const reopenSnapshot = steps[steps.length - 1]?.visible || getVisibleRowSnapshot(host)

    return {
      projectRoot: options.getProjectRoot(),
      workspaceScaleProfile,
      requestedExpandPaths,
      expandedPaths,
      missingExpandPaths,
      singleClickExpansionFailures,
      loadingRowCountMax,
      readDirInFlightMax: Math.max(readDirInFlightMaxBeforeReopen, readDirInFlightMax),
      totalRows,
      domRows: rows.length,
      blankVisibleRows: visibleSnapshots.some((snapshot) => snapshot.blankCount > 0 || snapshot.count === 0),
      visibleRowsStableAfterStress,
      selectedRowCountMax: selectionMax,
      ariaSelectedRowCountMax: ariaSelectionMax,
      scrollSamples,
      p95ScrollMs: percentile(scrollSamples, 0.95),
      maxScrollMs: Math.max(...scrollSamples),
      longTasks: scrollSamples.filter((value) => value > 50).length,
      scrollTopBeforeStress,
      scrollTopAfterStress,
      scrollResetToTop: scrollTopBeforeStress > 0 && scrollTopAfterStress === 0,
      reopenBlankVisibleRows: reopenSnapshot.count === 0 || reopenSnapshot.blankCount > 0,
      steps,
      readDirCalls: uniqueReadDirCalls,
      readDirCallCount: allReadDirCalls.length,
      uniqueReadDirCallCount: uniqueReadDirCalls.length,
      nativeHostMounted: Boolean(host),
    }
  }

  window.__codekSmokeOpenExplorerWorkspace = openSmokeExplorerWorkspace
  window.__codekSmokeExplorerPerformance = runSmokeExplorerPerformance
  window.__codekSmokeRealExplorer = runSmokeRealExplorer
  window.__codekSmokeExplorerStress = runSmokeExplorerStress
  const removeListener = options.onSmokeOpenProjectPath?.((payload) => {
    void openSmokeExplorerWorkspace(payload)
  })

  return () => {
    removeListener?.()
    if (originalReadDir && window.codek) window.codek.readDir = originalReadDir
    if (window.__codekSmokeOpenExplorerWorkspace === openSmokeExplorerWorkspace) {
      delete window.__codekSmokeOpenExplorerWorkspace
    }
    if (window.__codekSmokeExplorerPerformance === runSmokeExplorerPerformance) {
      delete window.__codekSmokeExplorerPerformance
    }
    if (window.__codekSmokeRealExplorer === runSmokeRealExplorer) {
      delete window.__codekSmokeRealExplorer
    }
    if (window.__codekSmokeExplorerStress === runSmokeExplorerStress) {
      delete window.__codekSmokeExplorerStress
    }
  }
}
