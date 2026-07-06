export type BottomPanelId = "output" | "terminal" | "tasks" | "processExplorer" | "visualEditor"

export interface BottomPanelState {
  active: BottomPanelId | null
}

export function createBottomPanelState(initial: BottomPanelId | null = null): BottomPanelState {
  return { active: initial }
}

export function isBottomPanelOpen(state: BottomPanelState): boolean {
  return state.active !== null
}

export function openBottomPanel(state: BottomPanelState, panel: BottomPanelId): void {
  state.active = panel
}

export function closeBottomPanel(state: BottomPanelState, panel?: BottomPanelId): void {
  if (!panel || state.active === panel) {
    state.active = null
  }
}

export function toggleBottomPanel(state: BottomPanelState, panel: BottomPanelId): void {
  state.active = state.active === panel ? null : panel
}

export function isBottomPanelActive(state: BottomPanelState, panel: BottomPanelId): boolean {
  return state.active === panel
}
