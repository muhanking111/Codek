import { describe, expect, it } from "vitest"
import { QuickWidget } from "./quickWidget"

interface TestItem {
  label: string
}

describe("QuickWidget", () => {
  it("tracks QuickTree active and selected items as the shared source of truth", () => {
    const alpha = { label: "Alpha" }
    const beta = { label: "Beta" }
    const widget = new QuickWidget<TestItem, TestItem>([alpha, beta], { busy: false })
    const activeEvents: string[][] = []
    const selectionEvents: string[][] = []

    widget.tree.onDidChangeActive((items) => activeEvents.push(items.map((item) => item.label)))
    widget.tree.onDidChangeSelection((items) => selectionEvents.push(items.map((item) => item.label)))

    widget.setActiveItems([beta])
    widget.setSelectedItems([alpha, beta])
    widget.setActiveItems([beta])

    expect(widget.activeItems).toEqual([beta])
    expect(widget.selectedItems).toEqual([alpha, beta])
    expect(activeEvents).toEqual([["Beta"]])
    expect(selectionEvents).toEqual([["Alpha", "Beta"]])
  })

  it("keeps widget options in the VS Code-style controller model", () => {
    const widget = new QuickWidget([], { enabled: true })

    widget.setBusy(true)
    widget.setEnabled(false)
    widget.setButtons([{ id: "back" }])
    widget.setValidationMessage("Select an item", "warning")

    expect(widget.options).toEqual({
      enabled: false,
      busy: true,
      buttons: [{ id: "back" }],
      validationMessage: "Select an item",
      severity: "warning",
    })
  })

  it("clears transient busy and validation state when reset after hide", () => {
    const widget = new QuickWidget([], {
      busy: true,
      enabled: false,
      validationMessage: "Loading",
      severity: "info",
    })

    widget.resetTransientState()

    expect(widget.options).toEqual({
      enabled: false,
      busy: false,
      validationMessage: undefined,
      severity: "ignore",
    })
  })

  it("tracks a bounded render window around the active item for large lists", () => {
    const items = Array.from({ length: 200 }, (_, index) => ({ label: `Item ${index}` }))
    const widget = new QuickWidget<TestItem, TestItem>(items, { renderLimit: 20, renderOverscan: 2 })

    expect(widget.renderWindow).toEqual({ start: 0, end: 20 })

    widget.setActiveItems([items[150]])

    expect(widget.renderWindow.start).toBeLessThanOrEqual(150)
    expect(widget.renderWindow.end).toBeGreaterThan(150)
    expect(widget.renderWindow.end - widget.renderWindow.start).toBeLessThanOrEqual(20)
    expect(widget.getVisibleItems()).toHaveLength(20)
    expect(widget.getVisibleItems()).toContain(items[150])
  })

  it("derives a VS Code-style virtual window from scroll offset and row metrics", () => {
    const items = Array.from({ length: 200 }, (_, index) => ({ label: `Item ${index}` }))
    const widget = new QuickWidget<TestItem, TestItem>(items, {
      rowHeight: 10,
      viewportHeight: 50,
      renderOverscan: 2,
    })

    widget.setScrollTop(300)

    expect(widget.renderWindow).toEqual({ start: 28, end: 37 })
    expect(widget.getVisibleItems().map((item) => item.label)).toEqual([
      "Item 28",
      "Item 29",
      "Item 30",
      "Item 31",
      "Item 32",
      "Item 33",
      "Item 34",
      "Item 35",
      "Item 36",
    ])
  })

  it("scrolls the active item into view without selection or option state resetting the window", () => {
    const items = Array.from({ length: 200 }, (_, index) => ({ label: `Item ${index}` }))
    const widget = new QuickWidget<TestItem, TestItem>(items, {
      rowHeight: 10,
      viewportHeight: 50,
      renderOverscan: 1,
    })

    widget.setScrollTop(500)
    expect(widget.renderWindow).toEqual({ start: 49, end: 56 })

    widget.setSelectedItems([items[2]])
    widget.setButtons([{ id: "refresh" }])
    widget.setValidationMessage("Still valid", "info")
    expect(widget.renderWindow).toEqual({ start: 49, end: 56 })

    widget.setActiveItems([items[70]])

    expect(widget.scrollTop).toBe(660)
    expect(widget.renderWindow.start).toBeLessThanOrEqual(70)
    expect(widget.renderWindow.end).toBeGreaterThan(70)
    expect(widget.getVisibleItems()).toContain(items[70])
  })
})
