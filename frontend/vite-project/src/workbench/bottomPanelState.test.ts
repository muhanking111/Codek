import { describe, expect, it } from "vitest"
import {
  closeBottomPanel,
  createBottomPanelState,
  isBottomPanelActive,
  isBottomPanelOpen,
  openBottomPanel,
  toggleBottomPanel,
} from "./bottomPanelState"

describe("bottomPanelState", () => {
  it("keeps bottom panel modes mutually exclusive", () => {
    const state = createBottomPanelState()

    openBottomPanel(state, "output")
    expect(isBottomPanelOpen(state)).toBe(true)
    expect(isBottomPanelActive(state, "output")).toBe(true)

    openBottomPanel(state, "terminal")
    expect(isBottomPanelActive(state, "output")).toBe(false)
    expect(isBottomPanelActive(state, "terminal")).toBe(true)

    openBottomPanel(state, "processExplorer")
    expect(state.active).toBe("processExplorer")

    openBottomPanel(state, "tasks")
    expect(isBottomPanelActive(state, "tasks")).toBe(true)
    expect(isBottomPanelActive(state, "processExplorer")).toBe(false)
  })

  it("toggles only the requested panel", () => {
    const state = createBottomPanelState("terminal")

    toggleBottomPanel(state, "terminal")
    expect(state.active).toBeNull()

    toggleBottomPanel(state, "output")
    expect(state.active).toBe("output")

    closeBottomPanel(state, "terminal")
    expect(state.active).toBe("output")

    closeBottomPanel(state, "output")
    expect(state.active).toBeNull()
  })
})
