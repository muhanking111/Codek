import { Emitter, type Event } from "../../vscode-adapter/base/common/event"
import {
  createWorkbenchListOwnerSnapshot,
  type WorkbenchListOwnerKind,
  type WorkbenchListOwnerSnapshot,
  type WorkbenchListOwnerWidget,
} from "../../vscode-adapter/platform/list/browser/listService"

export interface CodekListViewOptions<T> {
  ownerId?: string
  widgetKind?: WorkbenchListOwnerKind
  codekSourcePaths?: readonly string[]
  factoryEvidence?: string
  stateSource?: string
  modelBacked?: boolean
  rowHeight?: number
  overscan?: number
  role?: string
  ariaLabel?: string
  createRow?: () => HTMLElement
  renderRow: (row: HTMLElement, item: T, index: number) => void
}

export class CodekListView<T> implements WorkbenchListOwnerWidget {
  readonly ownerId: string
  readonly widgetKind: WorkbenchListOwnerKind
  private host: HTMLElement
  private ownerDocument: Document
  private ownerWindow: Window | null
  private scrollElement: HTMLElement
  private contentElement: HTMLElement
  private options: Required<CodekListViewOptions<T>>
  private readonly codekSourcePaths: readonly string[]
  private readonly factoryEvidence: string
  private readonly stateSource: string
  private readonly modelBacked: boolean
  private items: T[] = []
  private rows: HTMLElement[] = []
  private firstRenderedIndex = 0
  private renderedStartIndex = -1
  private renderedEndIndex = -1
  private renderedViewportHeight = -1
  private lastViewportHeight = 360
  private disposed = false
  private frame = 0
  private scheduledForceLayout = false
  private recoveryFrame = 0
  private recoveryPassesRemaining = 0
  private needsFocusRefresh = false
  private effectiveScrollTop = 0
  private clippedScrollTop: number | null = null
  private domScrollSyncBlocked = false
  private resizeObserver: ResizeObserver | null = null
  private readonly onDidFocusEmitter = new Emitter<void>()
  private readonly onDidDisposeEmitter = new Emitter<void>()

  readonly onDidFocus: Event<void> = this.onDidFocusEmitter.event
  readonly onDidDispose: Event<void> = this.onDidDisposeEmitter.event

  constructor(host: HTMLElement, options: CodekListViewOptions<T>) {
    this.host = host
    this.ownerId = options.ownerId || "codekListView"
    this.widgetKind = options.widgetKind || "list"
    this.codekSourcePaths = options.codekSourcePaths?.length
      ? options.codekSourcePaths
      : ["frontend/vite-project/src/explorer/tree/CodekListView.ts"]
    this.factoryEvidence = options.factoryEvidence || "new CodekListView(host, options)"
    this.stateSource = options.stateSource || "CodekListView caller-provided item model"
    this.modelBacked = options.modelBacked !== false
    this.ownerDocument = host.ownerDocument || document
    this.ownerWindow = this.ownerDocument.defaultView || (typeof window !== "undefined" ? window : null)
    this.options = {
      ownerId: this.ownerId,
      widgetKind: this.widgetKind,
      codekSourcePaths: this.codekSourcePaths,
      factoryEvidence: this.factoryEvidence,
      stateSource: this.stateSource,
      modelBacked: this.modelBacked,
      rowHeight: Math.max(1, Number(options.rowHeight || 24)),
      overscan: Math.max(12, Number(options.overscan || 12)),
      role: options.role || "list",
      ariaLabel: options.ariaLabel || "",
      createRow: options.createRow || (() => this.ownerDocument.createElement("div")),
      renderRow: options.renderRow,
    }
    this.scrollElement = this.ownerDocument.createElement("div")
    this.scrollElement.className = "codek-list-view"
    this.scrollElement.setAttribute("role", this.options.role || "list")
    this.scrollElement.dataset.workbenchListOwnerKind = this.widgetKind
    this.scrollElement.dataset.workbenchListNoSecondState = "true"
    if (this.options.ariaLabel) this.scrollElement.setAttribute("aria-label", this.options.ariaLabel)
    this.scrollElement.tabIndex = 0
    this.scrollElement.style.cssText = [
      "position:relative",
      "height:100%",
      "overflow:auto",
      "contain:layout paint style",
    ].join(";")
    this.contentElement = this.ownerDocument.createElement("div")
    this.contentElement.className = "codek-list-view-content"
    this.contentElement.style.cssText = "position:relative;width:100%;"
    this.scrollElement.appendChild(this.contentElement)
    this.host.appendChild(this.scrollElement)
    this.scrollElement.addEventListener("scroll", this.onScroll)
    this.scrollElement.addEventListener("pointerdown", this.onPointerDown, true)
    this.scrollElement.addEventListener("focusin", this.onFocusIn)
    this.ownerWindow?.addEventListener("blur", this.onWindowBlur)
    this.ownerWindow?.addEventListener("focus", this.onWindowFocus)
    this.ownerDocument.addEventListener("visibilitychange", this.onVisibilityChange)
    this.ownerWindow?.addEventListener("resize", this.onWindowResize)
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.scheduleLayout(false))
      this.resizeObserver.observe(this.host)
      this.resizeObserver.observe(this.scrollElement)
    }
  }

  setItems(items: T[]): void {
    this.adoptDomScrollTopIfUserMoved()
    const previousScrollTop = this.getEffectiveScrollTop()
    this.items = items || []
    this.contentElement.style.height = `${this.getTotalHeight()}px`
    this.restoreClippedScrollTop()
    if (this.clampScrollTop() && previousScrollTop > this.getEffectiveScrollTop()) {
      this.clippedScrollTop = Math.max(this.clippedScrollTop || 0, previousScrollTop)
    }
    this.syncDomScrollTop()
    this.render(true)
  }

  getItems(): T[] {
    return this.items
  }

  getHTMLElement(): HTMLElement {
    return this.scrollElement
  }

  getOwnerSnapshot(): WorkbenchListOwnerSnapshot {
    return createWorkbenchListOwnerSnapshot({
      ownerId: this.ownerId,
      widgetKind: this.widgetKind,
      codekSourcePaths: this.codekSourcePaths,
      factoryEvidence: this.factoryEvidence,
      modelBacked: this.modelBacked,
      stateSource: this.stateSource,
      focused: this.ownerDocument.activeElement === this.scrollElement || this.scrollElement.contains(this.ownerDocument.activeElement),
      disposed: this.disposed,
      classNames: this.scrollElement.className.split(/\s+/).filter(Boolean),
    })
  }

  scrollTo(scrollTop: number): void {
    this.clippedScrollTop = null
    this.setScrollTop(this.clampScrollTopValue(scrollTop))
    this.render()
  }

  getScrollTop(): number {
    return this.getEffectiveScrollTop()
  }

  getTotalHeight(): number {
    return this.items.length * this.options.rowHeight
  }

  getViewportItemCount(): number {
    return Math.max(1, Math.floor(this.getViewportHeight() / this.options.rowHeight))
  }

  getRenderedRowCount(): number {
    return this.rows.length
  }

  getFirstRenderedIndex(): number {
    return this.firstRenderedIndex
  }

  revealIndex(index: number): void {
    if (!this.items.length) return
    const targetIndex = Math.max(0, Math.min(Math.trunc(Number(index || 0)), this.items.length - 1))
    const viewportHeight = this.getViewportHeight()
    const viewportTop = this.getEffectiveScrollTop()
    const viewportBottom = viewportTop + viewportHeight
    const itemTop = targetIndex * this.options.rowHeight
    const itemBottom = itemTop + this.options.rowHeight
    if (itemTop < viewportTop) this.scrollTo(itemTop)
    else if (itemBottom > viewportBottom) this.scrollTo(itemBottom - viewportHeight)
    else this.render()
  }

  hasVisibleItem(predicate: (item: T, index: number) => boolean): boolean {
    for (let rowIndex = 0; rowIndex < this.rows.length; rowIndex += 1) {
      const itemIndex = this.firstRenderedIndex + rowIndex
      if (itemIndex >= this.items.length) continue
      if (predicate(this.items[itemIndex], itemIndex)) return true
    }
    return false
  }

  renderVisibleItems(predicate: (item: T, index: number) => boolean): number {
    if (this.disposed) return 0
    let rendered = 0
    for (let rowIndex = 0; rowIndex < this.rows.length; rowIndex += 1) {
      const itemIndex = this.firstRenderedIndex + rowIndex
      if (itemIndex >= this.items.length) continue
      const row = this.rows[rowIndex]
      if (row.style.display === "none") continue
      const item = this.items[itemIndex]
      if (!predicate(item, itemIndex)) continue
      this.options.renderRow(row, item, itemIndex)
      rendered += 1
    }
    return rendered
  }

  setActiveDescendant(id: string): void {
    if (id) this.scrollElement.setAttribute("aria-activedescendant", id)
    else this.scrollElement.removeAttribute("aria-activedescendant")
  }

  render(force = false): void {
    if (this.disposed) return
    const viewportHeight = this.getViewportHeight()
    this.adoptDomScrollTopIfUserMoved(viewportHeight)
    this.clampScrollTop(viewportHeight)
    this.syncDomScrollTop()
    const visibleCount = Math.ceil(viewportHeight / this.options.rowHeight) + this.getEffectiveOverscan(viewportHeight) * 2 + 1
    const startIndex = this.getRenderStartIndex(viewportHeight, visibleCount)
    const endIndex = Math.min(this.items.length, startIndex + visibleCount)
    const sameRenderWindow = startIndex === this.renderedStartIndex &&
      endIndex === this.renderedEndIndex &&
      viewportHeight === this.renderedViewportHeight
    if (
      !force &&
      sameRenderWindow &&
      this.isRenderedWindowHealthy(startIndex, endIndex)
    ) {
      return
    }
    force = force || (sameRenderWindow && !this.isRenderedWindowHealthy(startIndex, endIndex))
    this.firstRenderedIndex = startIndex
    this.ensureRows(Math.max(0, endIndex - startIndex))
    this.renderedStartIndex = startIndex
    this.renderedEndIndex = endIndex
    this.renderedViewportHeight = viewportHeight

    for (let index = 0; index < this.rows.length; index += 1) {
      const itemIndex = startIndex + index
      const row = this.rows[index]
      if (itemIndex >= endIndex) {
        this.clearRow(row)
        continue
      }
      const item = this.items[itemIndex]
      if (row.parentElement !== this.contentElement) this.contentElement.appendChild(row)
      row.style.display = ""
      row.style.transform = `translate3d(0, ${itemIndex * this.options.rowHeight}px, 0)`
      row.style.height = `${this.options.rowHeight}px`
      row.dataset.index = String(itemIndex)
      if (!force && row.dataset.renderedItemIndex === String(itemIndex) && (row as any).__codekRenderedItem === item) {
        continue
      }
      this.options.renderRow(row, item, itemIndex)
      row.dataset.renderedItemIndex = String(itemIndex)
      ;(row as any).__codekRenderedItem = item
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.scrollElement.removeEventListener("scroll", this.onScroll)
    this.scrollElement.removeEventListener("pointerdown", this.onPointerDown, true)
    this.scrollElement.removeEventListener("focusin", this.onFocusIn)
    this.ownerWindow?.removeEventListener("blur", this.onWindowBlur)
    this.ownerWindow?.removeEventListener("focus", this.onWindowFocus)
    this.ownerDocument.removeEventListener("visibilitychange", this.onVisibilityChange)
    this.ownerWindow?.removeEventListener("resize", this.onWindowResize)
    this.resizeObserver?.disconnect()
    if (this.frame) cancelAnimationFrame(this.frame)
    if (this.recoveryFrame) cancelAnimationFrame(this.recoveryFrame)
    this.renderedStartIndex = -1
    this.renderedEndIndex = -1
    this.renderedViewportHeight = -1
    this.onDidDisposeEmitter.fire()
    this.onDidFocusEmitter.dispose()
    this.onDidDisposeEmitter.dispose()
    if (this.scrollElement.parentElement === this.host) this.host.removeChild(this.scrollElement)
    this.rows = []
  }

  layout(force = false): void {
    if (this.disposed) return
    this.adoptDomScrollTopIfUserMoved()
    this.contentElement.style.height = `${this.getTotalHeight()}px`
    this.clampScrollTop()
    this.syncDomScrollTop()
    this.render(force)
  }

  private ensureRows(count: number): void {
    while (this.rows.length < count) {
      const row = this.options.createRow()
      row.dataset.codekExplorerRow = "true"
      row.style.cssText = [
        row.style.cssText,
        "position:absolute",
        "left:0",
        "right:0",
        "top:0",
        "will-change:transform",
        "contain:layout style paint",
      ].join(";")
      this.contentElement.appendChild(row)
      this.rows.push(row)
    }
  }

  private onScroll = () => {
    const domScrollTop = Number(this.scrollElement.scrollTop || 0)
    const nextScrollTop = this.clampScrollTopValue(domScrollTop)
    this.effectiveScrollTop = nextScrollTop
    this.domScrollSyncBlocked = false
    this.clippedScrollTop = null
    if (domScrollTop !== nextScrollTop) this.syncDomScrollTop()
    if (this.frame) {
      cancelAnimationFrame(this.frame)
      this.frame = 0
      this.scheduledForceLayout = false
    }
    this.render()
    this.scheduleRenderHealthCheck(2)
  }

  private onPointerDown = () => {
    if (!this.needsFocusRefresh && this.isCurrentRenderWindowHealthy() && !this.isVisibleWindowBlank()) return
    this.recoverRenderWindow()
  }

  private onFocusIn = () => {
    this.onDidFocusEmitter.fire()
    if (this.needsFocusRefresh) this.recoverRenderWindow()
  }

  private onWindowBlur = () => {
    this.needsFocusRefresh = true
  }

  private onWindowFocus = () => {
    if (this.needsFocusRefresh) this.recoverRenderWindow()
  }

  private onVisibilityChange = () => {
    if (this.ownerDocument.visibilityState === "hidden") {
      this.needsFocusRefresh = true
      return
    }
    this.recoverRenderWindow()
  }

  private onWindowResize = () => {
    this.scheduleLayout(false)
  }

  private recoverRenderWindow(): void {
    if (this.disposed) return
    this.needsFocusRefresh = false
    const healthy = this.isCurrentRenderWindowHealthy() && !this.isVisibleWindowBlank()
    this.layout(!healthy)
    this.scheduleRenderHealthCheck(healthy ? 1 : 3)
  }

  private scheduleLayout(force: boolean): void {
    if (this.disposed) return
    this.scheduledForceLayout = this.scheduledForceLayout || force
    if (this.frame) return
    const requestFrame = this.ownerWindow?.requestAnimationFrame?.bind(this.ownerWindow) || requestAnimationFrame
    this.frame = requestFrame(() => {
      const shouldForce = this.scheduledForceLayout
      this.frame = 0
      this.scheduledForceLayout = false
      this.layout(shouldForce)
    })
  }

  private scheduleRenderHealthCheck(passes = 1): void {
    if (this.disposed) return
    this.recoveryPassesRemaining = Math.max(this.recoveryPassesRemaining, passes)
    if (this.recoveryFrame) return
    const requestFrame = this.ownerWindow?.requestAnimationFrame?.bind(this.ownerWindow) || requestAnimationFrame
    this.recoveryFrame = requestFrame(() => {
      this.recoveryFrame = 0
      if (this.disposed) return
      const healthy = this.isCurrentRenderWindowHealthy() && !this.isVisibleWindowBlank()
      if (!healthy) this.layout(true)
      this.recoveryPassesRemaining -= 1
      if (this.recoveryPassesRemaining > 0) this.scheduleRenderHealthCheck(this.recoveryPassesRemaining)
      else this.recoveryPassesRemaining = 0
    })
  }

  private getViewportHeight(): number {
    const measuredHeight = this.scrollElement.clientHeight || this.host.clientHeight
    if (measuredHeight > 0) {
      this.lastViewportHeight = measuredHeight
      return measuredHeight
    }
    return this.lastViewportHeight || 360
  }

  private getEffectiveOverscan(viewportHeight = this.getViewportHeight()): number {
    const viewportRows = Math.ceil(viewportHeight / this.options.rowHeight)
    return Math.max(this.options.overscan, viewportRows)
  }

  private isCurrentRenderWindowHealthy(): boolean {
    const viewportHeight = this.getViewportHeight()
    const effectiveOverscan = this.getEffectiveOverscan(viewportHeight)
    const visibleCount = Math.ceil(viewportHeight / this.options.rowHeight) + effectiveOverscan * 2 + 1
    const startIndex = this.getRenderStartIndex(viewportHeight, visibleCount)
    const endIndex = Math.min(this.items.length, startIndex + visibleCount)
    return startIndex === this.renderedStartIndex &&
      endIndex === this.renderedEndIndex &&
      viewportHeight === this.renderedViewportHeight &&
      this.isRenderedWindowHealthy(startIndex, endIndex)
  }

  private isVisibleWindowBlank(): boolean {
    if (!this.items.length) return false
    const viewportHeight = this.getViewportHeight()
    const viewportTop = this.getEffectiveScrollTop()
    const viewportBottom = viewportTop + viewportHeight
    const expectedVisibleRows = Math.min(this.items.length, Math.max(1, Math.ceil(viewportHeight / this.options.rowHeight)))
    if (expectedVisibleRows <= 0) return false
    let visibleRows = 0
    for (const row of this.rows) {
      const rowTop = this.getRowTop(row)
      const rowBottom = rowTop + this.options.rowHeight
      if (
        row.style.display !== "none" &&
        row.parentElement === this.contentElement &&
        row.dataset.renderedItemIndex &&
        rowBottom > viewportTop &&
        rowTop < viewportBottom &&
        row.textContent?.trim()
      ) {
        visibleRows += 1
      }
    }
    return visibleRows === 0
  }

  private isRenderedWindowHealthy(startIndex: number, endIndex: number): boolean {
    const expectedRows = Math.max(0, endIndex - startIndex)
    if (expectedRows === 0) return true
    if (this.rows.length < expectedRows) return false
    for (let rowIndex = 0; rowIndex < expectedRows; rowIndex += 1) {
      if (!this.isRowHealthy(this.rows[rowIndex], startIndex + rowIndex)) return false
    }
    return true
  }

  private isRowHealthy(row: HTMLElement | undefined, itemIndex: number): boolean {
    if (!row || itemIndex < 0 || itemIndex >= this.items.length) return false
    return row.style.display !== "none" &&
      row.parentElement === this.contentElement &&
      row.dataset.index === String(itemIndex) &&
      row.dataset.renderedItemIndex === String(itemIndex) &&
      this.getRowTop(row) === itemIndex * this.options.rowHeight &&
      (row as any).__codekRenderedItem === this.items[itemIndex]
  }

  private getMaxScrollTop(viewportHeight = this.getViewportHeight()): number {
    return Math.max(0, this.getTotalHeight() - viewportHeight)
  }

  private clampScrollTop(viewportHeight = this.getViewportHeight()): boolean {
    const previousScrollTop = this.getEffectiveScrollTop()
    const nextScrollTop = this.clampScrollTopValue(previousScrollTop, viewportHeight)
    this.setScrollTop(nextScrollTop)
    return previousScrollTop !== nextScrollTop
  }

  private clampScrollTopValue(scrollTop: number, viewportHeight = this.getViewportHeight()): number {
    const numericScrollTop = Math.max(0, Number(scrollTop || 0))
    return Math.min(numericScrollTop, this.getMaxScrollTop(viewportHeight))
  }

  private restoreClippedScrollTop(): void {
    if (this.clippedScrollTop == null) return
    const restoredScrollTop = this.clampScrollTopValue(this.clippedScrollTop)
    if (restoredScrollTop <= this.getEffectiveScrollTop()) return
    this.setScrollTop(restoredScrollTop)
    if (restoredScrollTop === this.clippedScrollTop) this.clippedScrollTop = null
  }

  private getRenderStartIndex(viewportHeight: number, visibleCount: number): number {
    const maxStartIndex = Math.max(0, this.items.length - Math.max(1, visibleCount))
    const rawStartIndex = Math.floor(this.getEffectiveScrollTop() / this.options.rowHeight) - this.getEffectiveOverscan(viewportHeight)
    return Math.max(0, Math.min(rawStartIndex, maxStartIndex))
  }

  private getEffectiveScrollTop(): number {
    return Math.max(0, Number(this.effectiveScrollTop || 0))
  }

  private setScrollTop(scrollTop: number): void {
    const nextScrollTop = this.clampScrollTopValue(scrollTop)
    this.effectiveScrollTop = nextScrollTop
    this.syncDomScrollTop()
  }

  private syncDomScrollTop(): void {
    const expected = this.getEffectiveScrollTop()
    if (Number(this.scrollElement.scrollTop || 0) === expected) {
      this.domScrollSyncBlocked = false
      return
    }
    this.scrollElement.scrollTop = expected
    this.domScrollSyncBlocked = Number(this.scrollElement.scrollTop || 0) !== expected
  }

  private adoptDomScrollTopIfUserMoved(viewportHeight = this.getViewportHeight()): void {
    if (this.domScrollSyncBlocked) return
    const domScrollTop = this.clampScrollTopValue(Number(this.scrollElement.scrollTop || 0), viewportHeight)
    if (domScrollTop === this.getEffectiveScrollTop()) return
    this.effectiveScrollTop = domScrollTop
    this.clippedScrollTop = null
  }

  private getRowTop(row: HTMLElement): number {
    const transform = String(row.style.transform || "")
    const match = /translate3d\(\s*0(?:px)?\s*,\s*(-?\d+(?:\.\d+)?)px/.exec(transform)
    if (match) return Number(match[1])
    const itemIndex = Number(row.dataset.index || row.dataset.renderedItemIndex || -1)
    if (Number.isFinite(itemIndex) && itemIndex >= 0) return itemIndex * this.options.rowHeight
    return -1
  }

  private clearRow(row: HTMLElement): void {
    row.style.display = "none"
    row.style.transform = "translate3d(0, -999999px, 0)"
    row.dataset.renderedItemIndex = ""
    row.dataset.index = ""
    delete row.dataset.uri
    delete row.dataset.isDirectory
    row.className = "codek-explorer-row"
    row.draggable = false
    row.removeAttribute("aria-expanded")
    row.removeAttribute("aria-selected")
    row.removeAttribute("aria-level")
    row.removeAttribute("id")
    const twistie = row.querySelector(".codek-explorer-twistie") as HTMLElement | null
    if (twistie) twistie.textContent = ""
    const label = row.querySelector(".codek-explorer-label") as HTMLElement | null
    if (label) label.textContent = ""
    const decoration = row.querySelector(".codek-explorer-decoration") as HTMLElement | null
    if (decoration) {
      decoration.textContent = ""
      decoration.title = ""
    }
    const token = row.querySelector(".codek-explorer-fallback-token") as HTMLElement | null
    if (token) {
      token.textContent = ""
      token.style.display = "none"
    }
    ;(row as any).__codekRenderedItem = undefined
  }
}
