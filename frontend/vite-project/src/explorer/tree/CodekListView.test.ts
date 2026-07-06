import { afterEach, describe, expect, it, vi } from "vitest"
import { CodekListView } from "./CodekListView"
import { ListService } from "../../vscode-adapter/platform/list/browser/listService"

function makeRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `row-${index}`, label: `row-${index}` }))
}

describe("CodekListView", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders only a bounded DOM row pool for 100k rows", () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 480, configurable: true })
    const renderer = vi.fn((row: HTMLElement, item: { label: string }) => {
      row.textContent = item.label
    })
    const list = new CodekListView(host, { rowHeight: 24, overscan: 8, renderRow: renderer })

    list.setItems(makeRows(100_000))

    expect(host.querySelectorAll("[data-codek-explorer-row]").length).toBeLessThanOrEqual(120)
    expect(host.querySelector("[data-codek-explorer-row]")?.textContent).toBe("row-0")
    expect(list.getRenderedRowCount()).toBeLessThanOrEqual(120)
    expect(list.getTotalHeight()).toBe(100_000 * 24)

    list.dispose()
  })

  it("projects VS Code-style widget role, label, focusability, and active descendant", () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 240, configurable: true })
    const list = new CodekListView(host, {
      rowHeight: 24,
      overscan: 4,
      role: "tree",
      ariaLabel: "Files Explorer",
      renderRow: (row, item: { id: string; label: string }) => {
        row.id = item.id
        row.textContent = item.label
      },
    })

    list.setItems(makeRows(3))
    list.setActiveDescendant("row-1")

    const widget = host.querySelector(".codek-list-view") as HTMLElement
    expect(widget.getAttribute("role")).toBe("tree")
    expect(widget.getAttribute("aria-label")).toBe("Files Explorer")
    expect(widget.tabIndex).toBe(0)
    expect(widget.getAttribute("aria-activedescendant")).toBe("row-1")

    list.setActiveDescendant("")
    expect(widget.hasAttribute("aria-activedescendant")).toBe(false)

    list.dispose()
  })

  it("registers reusable list owner evidence with IListService", () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 240, configurable: true })
    const listService = new ListService()
    const list = new CodekListView(host, {
      ownerId: "secondaryTreeOwner",
      widgetKind: "objectTree",
      rowHeight: 24,
      overscan: 4,
      role: "tree",
      ariaLabel: "Secondary Tree",
      stateSource: "secondary tree model focus/selection",
      factoryEvidence: "secondary workbench tree factory",
      renderRow: (row, item: { label: string }) => {
        row.textContent = item.label
      },
    })
    const registration = listService.register(list)

    const widget = list.getHTMLElement()
    widget.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))

    const snapshot = list.getOwnerSnapshot()
    expect(widget.dataset.workbenchListOwner).toBe("secondaryTreeOwner")
    expect(widget.dataset.workbenchListServiceId).toBe("listService")
    expect(widget.dataset.workbenchListNoSecondState).toBe("true")
    expect(listService.lastFocusedList).toBe(list)
    expect(listService.getOwnerSnapshot("secondaryTreeOwner")).toEqual(snapshot)
    expect(snapshot).toMatchObject({
      serviceId: "listService",
      ownerId: "secondaryTreeOwner",
      widgetKind: "objectTree",
      reusableByWorkbenchTrees: true,
      modelBacked: true,
      noSecondState: true,
      factoryEvidence: "secondary workbench tree factory",
    })
    expect(snapshot.capabilities.selection.stateSource).toBe("secondary tree model focus/selection")
    expect(snapshot.vscodeSourcePaths).toEqual([
      "src/vs/platform/list/browser/listService.ts",
      "src/vs/workbench/browser/actions/listCommands.ts",
      "src/vs/base/browser/ui/tree/objectTree.ts",
    ])

    list.dispose()

    expect(listService.lastFocusedList).toBeUndefined()
    expect(listService.getOwnerSnapshot("secondaryTreeOwner")).toBeUndefined()
    expect(list.getOwnerSnapshot().disposed).toBe(true)

    registration.dispose()
  })

  it("reuses existing DOM rows while scrolling", () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 240, configurable: true })
    const list = new CodekListView(host, {
      rowHeight: 24,
      overscan: 4,
      renderRow: (row, item: { label: string }) => {
        row.textContent = item.label
      },
    })

    list.setItems(makeRows(1_000))
    const firstRows = [...host.querySelectorAll("[data-codek-explorer-row]")]

    list.scrollTo(24 * 500)
    const secondRows = [...host.querySelectorAll("[data-codek-explorer-row]")]

    expect(secondRows.length).toBe(firstRows.length)
    expect(secondRows.every((row, index) => row === firstRows[index])).toBe(true)
    expect(secondRows[0].textContent).toContain("row-")

    list.dispose()
  })

  it("does not traverse tree structures on scroll", () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 240, configurable: true })
    const renderRow = vi.fn((row: HTMLElement, item: { label: string }) => {
      row.textContent = item.label
    })
    const list = new CodekListView(host, { rowHeight: 24, overscan: 4, renderRow })

    list.setItems(makeRows(10_000))
    renderRow.mockClear()
    list.scrollTo(24 * 300)

    expect(renderRow.mock.calls.length).toBeLessThanOrEqual(40)

    list.dispose()
  })

  it("renders synchronously on native scroll events so fast wheel movement cannot leave blank rows", () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 240, configurable: true })
    const list = new CodekListView(host, {
      rowHeight: 24,
      overscan: 4,
      renderRow: (row, item: { label: string }) => {
        row.textContent = item.label
      },
    })

    list.setItems(makeRows(10_000))
    const scrollElement = host.querySelector(".codek-list-view") as HTMLElement
    scrollElement.scrollTop = 24 * 700
    scrollElement.dispatchEvent(new Event("scroll"))

    const visibleRows = [...host.querySelectorAll("[data-codek-explorer-row]")]
      .map((row) => row as HTMLElement)
      .filter((row) => row.style.display !== "none")

    expect(list.getFirstRenderedIndex()).toBeGreaterThanOrEqual(680)
    expect(visibleRows[0].textContent).toContain("row-")
    expect(visibleRows.some((row) => row.textContent === "row-700")).toBe(true)

    list.dispose()
  })

  it("adopts the DOM scroll offset on the next render so a deep wheel scroll cannot leave the viewport blank", () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 360, configurable: true })
    const list = new CodekListView(host, {
      rowHeight: 24,
      overscan: 4,
      renderRow: (row, item: { label: string }) => {
        row.textContent = item.label
      },
    })

    list.setItems(makeRows(10_000))
    const scrollElement = host.querySelector(".codek-list-view") as HTMLElement
    scrollElement.scrollTop = 24 * 750

    list.render()

    const visibleRows = [...host.querySelectorAll("[data-codek-explorer-row]")]
      .map((row) => row as HTMLElement)
      .filter((row) => row.style.display !== "none")
    const visibleIndexes = visibleRows.map((row) => Number(row.dataset.index || -1))

    expect(list.getFirstRenderedIndex()).toBeGreaterThanOrEqual(720)
    expect(visibleRows.length).toBeGreaterThanOrEqual(Math.ceil(360 / 24))
    expect(visibleRows.some((row) => row.textContent === "row-750")).toBe(true)
    expect(visibleIndexes.every((index) => index >= 0)).toBe(true)

    list.dispose()
  })

  it("skips redundant renders when the visible window does not change", () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 240, configurable: true })
    const renderRow = vi.fn((row: HTMLElement, item: { label: string }) => {
      row.textContent = item.label
    })
    const list = new CodekListView(host, { rowHeight: 24, overscan: 4, renderRow })

    list.setItems(makeRows(10_000))
    renderRow.mockClear()

    list.render()
    list.scrollTo(0)

    expect(renderRow).not.toHaveBeenCalled()

    list.render(true)

    expect(renderRow).toHaveBeenCalled()

    list.dispose()
  })

  it("repairs the rendered window when focus returns after rows were detached", () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 240, configurable: true })
    const list = new CodekListView(host, {
      rowHeight: 24,
      overscan: 4,
      renderRow: (row, item: { label: string }) => {
        row.textContent = item.label
      },
    })

    list.setItems(makeRows(10_000))
    list.scrollTo(24 * 700)

    const row = host.querySelector("[data-codek-explorer-row]") as HTMLElement
    row.remove()

    window.dispatchEvent(new Event("blur"))
    window.dispatchEvent(new Event("focus"))

    const visibleRows = [...host.querySelectorAll("[data-codek-explorer-row]")]
      .map((element) => element as HTMLElement)
      .filter((element) => element.style.display !== "none")

    expect(visibleRows.length).toBeGreaterThan(0)
    expect(visibleRows[0].parentElement?.className).toBe("codek-list-view-content")
    expect(visibleRows.some((element) => element.textContent === "row-700")).toBe(true)

    list.dispose()
  })

  it("does not force rerender healthy rows on window focus recovery", async () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 240, configurable: true })
    const renderRow = vi.fn((row: HTMLElement, item: { label: string }) => {
      row.textContent = item.label
    })
    const list = new CodekListView(host, {
      rowHeight: 24,
      overscan: 4,
      renderRow,
    })

    list.setItems(makeRows(10_000))
    renderRow.mockClear()

    window.dispatchEvent(new Event("blur"))
    window.dispatchEvent(new Event("focus"))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(renderRow).not.toHaveBeenCalled()

    list.dispose()
  })

  it("repairs a stale visible row before handling the first pointer after refocus", () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 240, configurable: true })
    const list = new CodekListView(host, {
      rowHeight: 24,
      overscan: 4,
      renderRow: (row, item: { label: string }) => {
        row.textContent = item.label
      },
    })

    list.setItems(makeRows(10_000))
    list.scrollTo(24 * 500)

    const visibleRowsBefore = [...host.querySelectorAll("[data-codek-explorer-row]")]
      .map((element) => element as HTMLElement)
      .filter((element) => element.style.display !== "none")
    visibleRowsBefore[0].style.display = "none"
    visibleRowsBefore[visibleRowsBefore.length - 1].dataset.renderedItemIndex = "stale"

    window.dispatchEvent(new Event("blur"))
    visibleRowsBefore[0].dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))

    const visibleRowsAfter = [...host.querySelectorAll("[data-codek-explorer-row]")]
      .map((element) => element as HTMLElement)
      .filter((element) => element.style.display !== "none")

    expect(visibleRowsAfter[0].style.display).toBe("")
    expect(visibleRowsAfter.some((element) => element.textContent === "row-500")).toBe(true)
    expect(visibleRowsAfter[visibleRowsAfter.length - 1].dataset.renderedItemIndex).not.toBe("stale")

    list.dispose()
  })

  it("repairs hidden interior rows when the render window otherwise looks unchanged", () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 360, configurable: true })
    const list = new CodekListView(host, {
      rowHeight: 24,
      overscan: 4,
      renderRow: (row, item: { label: string }) => {
        row.textContent = item.label
      },
    })

    list.setItems(makeRows(10_000))
    list.scrollTo(24 * 500)

    const visibleRowsBefore = [...host.querySelectorAll("[data-codek-explorer-row]")]
      .map((element) => element as HTMLElement)
      .filter((element) => element.style.display !== "none")
    const hiddenInteriorRow = visibleRowsBefore[Math.floor(visibleRowsBefore.length / 2)]
    const hiddenItemIndex = hiddenInteriorRow.dataset.index || ""
    hiddenInteriorRow.style.display = "none"

    list.render()

    const repairedRow = [...host.querySelectorAll("[data-codek-explorer-row]")]
      .map((element) => element as HTMLElement)
      .find((element) => element.dataset.index === hiddenItemIndex)

    expect(repairedRow?.style.display).toBe("")
    expect(repairedRow?.textContent).toBe(`row-${hiddenItemIndex}`)

    list.dispose()
  })

  it("repairs a blank deep-scroll window on the post-scroll health frame", async () => {
    vi.useFakeTimers()
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 360, configurable: true })
    const list = new CodekListView(host, {
      rowHeight: 24,
      overscan: 4,
      renderRow: (row, item: { label: string }) => {
        row.textContent = item.label
      },
    })

    list.setItems(makeRows(10_000))
    const scrollElement = host.querySelector(".codek-list-view") as HTMLElement
    scrollElement.scrollTop = 24 * 800
    scrollElement.dispatchEvent(new Event("scroll"))

    const visibleRowsBefore = [...host.querySelectorAll("[data-codek-explorer-row]")]
      .map((element) => element as HTMLElement)
      .filter((element) => element.style.display !== "none")
    for (const row of visibleRowsBefore) {
      row.style.display = "none"
      row.dataset.renderedItemIndex = "stale"
    }

    await vi.advanceTimersByTimeAsync(20)

    const visibleRowsAfter = [...host.querySelectorAll("[data-codek-explorer-row]")]
      .map((element) => element as HTMLElement)
      .filter((element) => element.style.display !== "none")

    expect(visibleRowsAfter.length).toBeGreaterThan(0)
    expect(visibleRowsAfter.some((element) => element.textContent === "row-800")).toBe(true)
    expect(visibleRowsAfter.every((element) => element.dataset.renderedItemIndex !== "stale")).toBe(true)

    list.dispose()
    vi.useRealTimers()
  })

  it("repairs a fully detached deep-scroll window before the next pointer interaction", () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 360, configurable: true })
    const list = new CodekListView(host, {
      rowHeight: 24,
      overscan: 4,
      renderRow: (row, item: { label: string }) => {
        row.textContent = item.label
      },
    })

    list.setItems(makeRows(10_000))
    list.scrollTo(24 * 900)

    const rows = [...host.querySelectorAll("[data-codek-explorer-row]")]
      .map((element) => element as HTMLElement)
    for (const row of rows) {
      row.remove()
      row.style.display = "none"
      row.dataset.renderedItemIndex = "stale"
    }

    const scrollElement = host.querySelector(".codek-list-view") as HTMLElement
    scrollElement.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))

    const visibleRows = [...host.querySelectorAll("[data-codek-explorer-row]")]
      .map((element) => element as HTMLElement)
      .filter((element) => element.style.display !== "none")

    expect(visibleRows.length).toBeGreaterThan(0)
    expect(visibleRows[0].parentElement?.className).toBe("codek-list-view-content")
    expect(visibleRows.some((element) => element.textContent === "row-900")).toBe(true)
    expect(visibleRows.every((element) => element.dataset.renderedItemIndex !== "stale")).toBe(true)

    list.dispose()
  })

  it("patches only matching visible rows", () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 240, configurable: true })
    const renderRow = vi.fn((row: HTMLElement, item: { id: string; label: string }) => {
      row.dataset.id = item.id
      row.textContent = item.label
    })
    const list = new CodekListView(host, { rowHeight: 24, overscan: 0, renderRow })

    list.setItems(makeRows(1_000))
    renderRow.mockClear()

    const patched = list.renderVisibleItems((item) => item.id === "row-4")

    expect(patched).toBe(1)
    expect(renderRow).toHaveBeenCalledTimes(1)
    expect(renderRow.mock.calls[0][1]).toMatchObject({ id: "row-4" })
    expect(list.hasVisibleItem((item) => item.id === "row-4")).toBe(true)
    expect(list.hasVisibleItem((item) => item.id === "row-900")).toBe(false)

    list.dispose()
  })

  it("clamps stale scroll offsets when the item set shrinks", () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 240, configurable: true })
    const renderRow = vi.fn((row: HTMLElement, item: { label: string }) => {
      row.textContent = item.label
    })
    const list = new CodekListView(host, { rowHeight: 24, overscan: 0, renderRow })

    list.setItems(makeRows(1_000))
    list.scrollTo(24 * 900)

    expect(list.getScrollTop()).toBeGreaterThan(0)

    list.setItems(makeRows(5))

    const visibleRows = [...host.querySelectorAll("[data-codek-explorer-row]")]
      .filter((row) => (row as HTMLElement).style.display !== "none")

    expect(list.getScrollTop()).toBe(0)
    expect(visibleRows.map((row) => row.textContent)).toEqual([
      "row-0",
      "row-1",
      "row-2",
      "row-3",
      "row-4",
    ])

    list.dispose()
  })

  it("fills the viewport when the browser keeps a stale deep scroll offset after filtering to a tiny item set", () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 480, configurable: true })
    const list = new CodekListView(host, {
      rowHeight: 24,
      overscan: 0,
      renderRow: (row, item: { label: string }) => {
        row.textContent = item.label
      },
    })

    list.setItems(makeRows(10_000))
    list.scrollTo(24 * 9_600)

    const scrollElement = host.querySelector(".codek-list-view") as HTMLElement
    Object.defineProperty(scrollElement, "scrollTop", {
      configurable: true,
      get: () => 24 * 9_600,
      set: () => {},
    })

    list.setItems(makeRows(8))

    const visibleRows = [...host.querySelectorAll("[data-codek-explorer-row]")]
      .map((row) => row as HTMLElement)
      .filter((row) => row.style.display !== "none")

    expect(list.getFirstRenderedIndex()).toBe(0)
    expect(visibleRows.map((row) => row.textContent)).toEqual([
      "row-0",
      "row-1",
      "row-2",
      "row-3",
      "row-4",
      "row-5",
      "row-6",
      "row-7",
    ])

    list.dispose()
  })

  it("keeps rendering from the internal scroll model when DOM scrollTop refuses programmatic writes", () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 480, configurable: true })
    const list = new CodekListView(host, {
      rowHeight: 24,
      overscan: 0,
      renderRow: (row, item: { label: string }) => {
        row.textContent = item.label
      },
    })

    list.setItems(makeRows(10_000))
    const scrollElement = host.querySelector(".codek-list-view") as HTMLElement
    let domScrollTop = 24 * 9_600
    Object.defineProperty(scrollElement, "scrollTop", {
      configurable: true,
      get: () => domScrollTop,
      set: () => {},
    })

    list.scrollTo(24 * 120)
    list.render()

    const visibleRows = [...host.querySelectorAll("[data-codek-explorer-row]")]
      .map((row) => row as HTMLElement)
      .filter((row) => row.style.display !== "none")

    expect(domScrollTop).toBe(24 * 9_600)
    expect(list.getFirstRenderedIndex()).toBeLessThanOrEqual(120)
    expect(visibleRows.some((row) => row.textContent === "row-120")).toBe(true)

    list.dispose()
  })

  it("restores a clipped scroll offset when a transiently shortened item set grows again", () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 240, configurable: true })
    const list = new CodekListView(host, {
      rowHeight: 24,
      overscan: 0,
      renderRow: (row, item: { label: string }) => {
        row.textContent = item.label
      },
    })

    list.setItems(makeRows(1_000))
    list.scrollTo(24 * 800)
    const deepScrollTop = list.getScrollTop()

    list.setItems(makeRows(5))

    expect(list.getScrollTop()).toBe(0)

    list.setItems(makeRows(1_000))

    expect(list.getScrollTop()).toBe(deepScrollTop)
    expect(host.querySelector("[data-codek-explorer-row]")?.textContent).toContain("row-")

    list.dispose()
  })

  it("does not restore a clipped scroll offset after an explicit scroll command", () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 240, configurable: true })
    const list = new CodekListView(host, {
      rowHeight: 24,
      overscan: 0,
      renderRow: (row, item: { label: string }) => {
        row.textContent = item.label
      },
    })

    list.setItems(makeRows(1_000))
    list.scrollTo(24 * 800)
    list.setItems(makeRows(5))
    list.scrollTo(0)
    list.setItems(makeRows(1_000))

    expect(list.getScrollTop()).toBe(0)

    list.dispose()
  })

  it("clears recycled row labels and interaction state when rows become hidden", () => {
    const host = document.createElement("div")
    Object.defineProperty(host, "clientHeight", { value: 240, configurable: true })
    const list = new CodekListView(host, {
      rowHeight: 24,
      overscan: 0,
      createRow: () => {
        const row = document.createElement("div")
        row.className = "codek-explorer-row"
        row.innerHTML = [
          '<span class="codek-explorer-twistie"></span>',
          '<span class="codek-explorer-label"></span>',
          '<span class="codek-explorer-decoration"></span>',
        ].join("")
        return row
      },
      renderRow: (row, item: { id: string; label: string }, index) => {
        row.dataset.uri = item.id
        row.dataset.isDirectory = "true"
        row.dataset.index = String(index)
        row.className = "codek-explorer-row expanded selected"
        row.draggable = true
        row.setAttribute("aria-expanded", "true")
        row.setAttribute("aria-selected", "true")
        row.setAttribute("aria-level", "2")
        const label = row.querySelector(".codek-explorer-label") as HTMLElement
        label.textContent = item.label
        const decoration = row.querySelector(".codek-explorer-decoration") as HTMLElement
        decoration.textContent = "M"
        decoration.title = "modified"
      },
    })

    list.setItems(makeRows(20))
    list.setItems(makeRows(2))

    const hiddenRows = [...host.querySelectorAll("[data-codek-explorer-row]")]
      .map((row) => row as HTMLElement)
      .filter((row) => row.style.display === "none")

    expect(hiddenRows.length).toBeGreaterThan(0)
    for (const row of hiddenRows) {
      expect(row.dataset.uri).toBeUndefined()
      expect(row.dataset.isDirectory).toBeUndefined()
      expect(row.querySelector(".codek-explorer-label")?.textContent).toBe("")
      expect(row.querySelector(".codek-explorer-decoration")?.textContent).toBe("")
      expect(row.className).toBe("codek-explorer-row")
      expect(row.draggable).toBe(false)
      expect(row.hasAttribute("aria-expanded")).toBe(false)
      expect(row.hasAttribute("aria-selected")).toBe(false)
    }

    list.dispose()
  })
})
