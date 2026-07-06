/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/platform/quickinput/browser/quickInput.ts and quickInputTree.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from "../../../base/common/event"
import type { IDisposable } from "../../../base/common/lifecycle"

export interface QuickWidgetOptions<TButton = unknown> {
  value?: string
  buttons?: TButton[]
  busy?: boolean
  enabled?: boolean
  validationMessage?: string
  severity?: string
  renderLimit?: number
  renderOverscan?: number
  rowHeight?: number
  viewportHeight?: number
}

export interface QuickWidgetRenderWindow {
  start: number
  end: number
}

export class QuickTree<TItem> implements IDisposable {
  private readonly onDidChangeActiveEmitter = new Emitter<TItem[]>()
  private readonly onDidChangeSelectionEmitter = new Emitter<TItem[]>()
  readonly onDidChangeActive: Event<TItem[]> = this.onDidChangeActiveEmitter.event
  readonly onDidChangeSelection: Event<TItem[]> = this.onDidChangeSelectionEmitter.event
  private _activeItems: TItem[] = []
  private _selectedItems: TItem[] = []

  get activeItems(): TItem[] {
    return [...this._activeItems]
  }

  get selectedItems(): TItem[] {
    return [...this._selectedItems]
  }

  setActiveItems(items: readonly TItem[]): void {
    const next = [...items]
    if (sameItems(this._activeItems, next)) return
    this._activeItems = next
    this.onDidChangeActiveEmitter.fire(this.activeItems)
  }

  setSelectedItems(items: readonly TItem[]): void {
    const next = [...items]
    if (sameItems(this._selectedItems, next)) return
    this._selectedItems = next
    this.onDidChangeSelectionEmitter.fire(this.selectedItems)
  }

  dispose(): void {
    this.onDidChangeActiveEmitter.dispose()
    this.onDidChangeSelectionEmitter.dispose()
  }
}

export class QuickWidget<TItem, TEntry, TButton = unknown> implements IDisposable {
  readonly tree = new QuickTree<TItem>()
  private _items: TEntry[]
  private _options: QuickWidgetOptions<TButton>
  private _renderWindow: QuickWidgetRenderWindow = { start: 0, end: 0 }
  private _scrollTop = 0

  constructor(items: readonly TEntry[] = [], options: QuickWidgetOptions<TButton> = {}) {
    this._items = [...items]
    this._options = { ...options }
    this.updateRenderWindow()
  }

  get items(): TEntry[] {
    return this._items
  }

  get options(): QuickWidgetOptions<TButton> {
    return this._options
  }

  get activeItems(): TItem[] {
    return this.tree.activeItems
  }

  get selectedItems(): TItem[] {
    return this.tree.selectedItems
  }

  get renderWindow(): QuickWidgetRenderWindow {
    return { ...this._renderWindow }
  }

  get scrollTop(): number {
    return this._scrollTop
  }

  getVisibleItems(): TEntry[] {
    return this._items.slice(this._renderWindow.start, this._renderWindow.end)
  }

  setItems(items: readonly TEntry[]): void {
    this._items = [...items]
    this.updateRenderWindow()
  }

  setScrollTop(scrollTop: number): void {
    this._scrollTop = normalizeNonNegativeNumber(scrollTop)
    this.updateRenderWindow()
  }

  setViewportHeight(viewportHeight: number | undefined): void {
    this._options.viewportHeight = viewportHeight
    this.updateRenderWindow()
  }

  setValue(value: string): void {
    this._options.value = value
  }

  setBusy(busy: boolean): void {
    this._options.busy = busy
  }

  setButtons(buttons: readonly TButton[]): void {
    this._options.buttons = [...buttons]
  }

  setEnabled(enabled: boolean): void {
    this._options.enabled = enabled
  }

  setValidationMessage(message: string | undefined, severity?: string): void {
    this._options.validationMessage = message
    this._options.severity = severity
  }

  resetTransientState(): void {
    this._options.busy = false
    this._options.validationMessage = undefined
    this._options.severity = "ignore"
  }

  setActiveItems(items: readonly TItem[]): void {
    this.tree.setActiveItems(items)
    this.reveal(items[0])
    this.updateRenderWindow(items[0])
  }

  setSelectedItems(items: readonly TItem[]): void {
    this.tree.setSelectedItems(items)
  }

  dispose(): void {
    this.tree.dispose()
  }

  private updateRenderWindow(activeItem: TItem | undefined = this.activeItems[0]): void {
    const total = this._items.length
    const rowHeight = normalizePositiveInteger(this._options.rowHeight)
    const viewportHeight = normalizePositiveInteger(this._options.viewportHeight)
    const visibleRows = rowHeight && viewportHeight
      ? Math.max(1, Math.ceil(viewportHeight / rowHeight))
      : undefined
    const limit = visibleRows
      ? visibleRows + ((normalizePositiveInteger(this._options.renderOverscan) || 0) * 2)
      : normalizePositiveInteger(this._options.renderLimit)
    if (!limit || total <= limit) {
      this._renderWindow = { start: 0, end: total }
      return
    }
    const overscan = normalizePositiveInteger(this._options.renderOverscan) || 0
    const scrollIndex = rowHeight ? Math.floor(this._scrollTop / rowHeight) : this._renderWindow.start
    if (rowHeight && viewportHeight) {
      const start = Math.min(Math.max(0, scrollIndex - overscan), Math.max(0, total - limit))
      this._renderWindow = { start, end: Math.min(total, start + limit) }
      return
    }
    const activeIndex = activeItem ? this._items.indexOf(activeItem as unknown as TEntry) : -1
    const anchor = activeIndex >= 0 ? activeIndex : scrollIndex
    let start = Math.max(0, rowHeight ? scrollIndex - overscan : anchor - overscan)
    if (activeIndex >= 0 && activeIndex < start) start = Math.max(0, activeIndex - overscan)
    if (activeIndex >= 0 && activeIndex >= start + limit) start = activeIndex - limit + 1
    start = Math.min(start, Math.max(0, total - limit))
    this._renderWindow = { start, end: Math.min(total, start + limit) }
  }

  private reveal(activeItem: TItem | undefined): void {
    const rowHeight = normalizePositiveInteger(this._options.rowHeight)
    const viewportHeight = normalizePositiveInteger(this._options.viewportHeight)
    if (!activeItem || !rowHeight || !viewportHeight) return
    const activeIndex = this._items.indexOf(activeItem as unknown as TEntry)
    if (activeIndex < 0) return

    const itemTop = activeIndex * rowHeight
    const itemBottom = itemTop + rowHeight
    const viewportBottom = this._scrollTop + viewportHeight
    if (itemTop < this._scrollTop) {
      this._scrollTop = itemTop
    } else if (itemBottom > viewportBottom) {
      this._scrollTop = Math.max(0, itemBottom - viewportHeight)
    }
  }
}

function sameItems<TItem>(left: readonly TItem[], right: readonly TItem[]): boolean {
  if (left.length !== right.length) return false
  return left.every((item, index) => item === right[index])
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const normalized = Math.trunc(Number(value))
  return Number.isFinite(normalized) && normalized > 0 ? normalized : undefined
}

function normalizeNonNegativeNumber(value: unknown): number {
  const normalized = Number(value)
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 0
}
