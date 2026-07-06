type FocusRegion = "editor" | "sidebar" | "bottomPanel" | "statusBar"

interface EditorLike {
  focus?: () => void
}

interface CommandPaletteLike {
  visible?: boolean
  close?: () => void
}

interface FocusRegionContext {
  getEditor: () => EditorLike | null
  getOutputPanelOpen: () => boolean
  getActiveView: () => string
  setActiveView: (view: string) => void
  getCommandPalette: () => CommandPaletteLike | null | undefined
  nextTick: (callback: () => void) => void
  querySelector: (selector: string) => Element | null
}

const FOCUS_REGIONS: FocusRegion[] = ["editor", "sidebar", "bottomPanel", "statusBar"]

export function createFocusRegionController(context: FocusRegionContext) {
  let currentFocusRegion = 0

  function focusEditor(): void {
    context.getEditor()?.focus?.()
  }

  function focusSidebar(): void {
    focusFirstMatching(".sidebar", "input, button, [tabindex]")
  }

  function focusBottomPanel(): void {
    if (context.getOutputPanelOpen()) {
      if (focusFirstMatching(".output-panel", "input, textarea, [tabindex]")) return
    }
  }

  function focusFirstMatching(containerSelector: string, focusableSelector: string): boolean {
    const container = context.querySelector(containerSelector)
    const focusable = container?.querySelector(focusableSelector)
    if (focusable instanceof HTMLElement) {
      focusable.focus()
      return true
    }
    return false
  }

  function focusRegion(region: FocusRegion): void {
    switch (region) {
      case "editor":
        focusEditor()
        break
      case "sidebar":
        focusSidebar()
        break
      case "bottomPanel":
        focusBottomPanel()
        break
      case "statusBar":
        {
          const statusBar = context.querySelector(".status-bar")
          if (statusBar instanceof HTMLElement) {
            statusBar.focus()
          }
        }
        break
    }
  }

  function focusNextRegion(): void {
    currentFocusRegion = (currentFocusRegion + 1) % FOCUS_REGIONS.length
    focusRegion(FOCUS_REGIONS[currentFocusRegion])
  }

  function focusPrevRegion(): void {
    currentFocusRegion = (currentFocusRegion - 1 + FOCUS_REGIONS.length) % FOCUS_REGIONS.length
    focusRegion(FOCUS_REGIONS[currentFocusRegion])
  }

  function handleAccessibilityKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return

    const commandPalette = context.getCommandPalette()
    if (commandPalette?.visible) {
      commandPalette.close?.()
      return
    }

    const activeView = context.getActiveView()
    if (activeView === "search" || activeView === "settings") {
      context.setActiveView("files")
    }
  }

  return {
    focusNextRegion,
    focusPrevRegion,
    handleAccessibilityKeydown,
  }
}
