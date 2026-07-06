import { Emitter, type Event } from "../vscode-adapter/base/common/event"

// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\workbench\browser\parts\paneCompositePartService.ts
// - D:\SourceMirror\vscode\src\vs\workbench\browser\parts\paneCompositePart.ts
// - D:\SourceMirror\vscode\src\vs\workbench\browser\panecomposite.ts
//
// Codek keeps Vue-rendered parts as the runtime surface. This model captures the
// VS Code-style pane composite lifecycle so callers share one active/last-active
// chain instead of recording panel/sidebar opens in isolated adapters.

export type WorkbenchPaneCompositeLocation = "sideBar" | "panel" | "auxiliaryBar"
export type WorkbenchPaneCompositeAction = "open" | "close" | "toggle"

export interface WorkbenchPaneCompositeLocationModel {
  location: WorkbenchPaneCompositeLocation
  visible: boolean
  activeCompositeId: string | null
  lastActiveCompositeId: string | null
  compositeIds: string[]
  openCount: number
  closeCount: number
  toggleCount: number
}

export interface WorkbenchPaneCompositeLifecycleEvent {
  action: WorkbenchPaneCompositeAction
  id: string
  location: WorkbenchPaneCompositeLocation
  focus: boolean
  previousActiveCompositeId: string | null
  activeCompositeId: string | null
  visible: boolean
  sequence: number
}

export interface WorkbenchPaneCompositeSnapshot {
  stateSource: "workbenchLayoutService"
  locations: Record<WorkbenchPaneCompositeLocation, WorkbenchPaneCompositeLocationModel>
  events: WorkbenchPaneCompositeLifecycleEvent[]
}

export interface WorkbenchPaneCompositeOpenOptions {
  focus?: boolean
  toggle?: boolean
}

const WORKBENCH_PANE_COMPOSITE_LOCATIONS: WorkbenchPaneCompositeLocation[] = ["sideBar", "panel", "auxiliaryBar"]
const LEGACY_PANEL_COMPOSITE_IDS = new Map<string, string>([
  ["terminal", "workbench.panel.terminal"],
  ["output", "workbench.panel.output"],
  ["problems", "workbench.panel.markers"],
  ["markers", "workbench.panel.markers"],
  ["tasks", "workbench.view.tasks"],
  ["processExplorer", "workbench.panel.processExplorer"],
  ["visualEditor", "workbench.panel.visualEditor"],
])

export class WorkbenchPaneCompositeLifecycleModel {
  private readonly onDidOpenEmitter = new Emitter<WorkbenchPaneCompositeLifecycleEvent>()
  private readonly onDidCloseEmitter = new Emitter<WorkbenchPaneCompositeLifecycleEvent>()
  private snapshot = createEmptyWorkbenchPaneCompositeSnapshot()
  private sequence = 0

  readonly onDidPaneCompositeOpen: Event<WorkbenchPaneCompositeLifecycleEvent> = this.onDidOpenEmitter.event
  readonly onDidPaneCompositeClose: Event<WorkbenchPaneCompositeLifecycleEvent> = this.onDidCloseEmitter.event

  openPaneComposite(
    id: string | undefined,
    location: WorkbenchPaneCompositeLocation,
    options: WorkbenchPaneCompositeOpenOptions = {},
  ): WorkbenchPaneCompositeLifecycleEvent | undefined {
    const compositeId = normalizePaneCompositeId(id, location)
    if (!compositeId) return undefined

    const locationState = this.snapshot.locations[location]
    const previousActiveCompositeId = locationState.activeCompositeId
    locationState.visible = true
    locationState.activeCompositeId = compositeId
    locationState.lastActiveCompositeId = compositeId
    locationState.openCount += 1
    if (options.toggle) locationState.toggleCount += 1
    if (!locationState.compositeIds.includes(compositeId)) locationState.compositeIds.push(compositeId)

    const event = this.createEvent(options.toggle ? "toggle" : "open", compositeId, location, {
      focus: options.focus !== false,
      previousActiveCompositeId,
    })
    this.snapshot.events.push(event)
    this.onDidOpenEmitter.fire(event)
    return event
  }

  closePaneComposite(
    location: WorkbenchPaneCompositeLocation,
    id?: string,
    options: WorkbenchPaneCompositeOpenOptions = {},
  ): WorkbenchPaneCompositeLifecycleEvent | undefined {
    const locationState = this.snapshot.locations[location]
    const normalizedId = normalizePaneCompositeId(id, location)
    const compositeId = normalizedId || locationState.activeCompositeId
    if (!compositeId || !locationState.visible) return undefined
    if (normalizedId && locationState.activeCompositeId !== compositeId) return undefined

    const previousActiveCompositeId = locationState.activeCompositeId
    locationState.visible = false
    locationState.activeCompositeId = null
    locationState.lastActiveCompositeId = compositeId
    locationState.closeCount += 1
    if (options.toggle) locationState.toggleCount += 1
    if (!locationState.compositeIds.includes(compositeId)) locationState.compositeIds.push(compositeId)

    const event = this.createEvent(options.toggle ? "toggle" : "close", compositeId, location, {
      focus: options.focus !== false,
      previousActiveCompositeId,
    })
    this.snapshot.events.push(event)
    this.onDidCloseEmitter.fire(event)
    return event
  }

  togglePaneComposite(
    id: string | undefined,
    location: WorkbenchPaneCompositeLocation,
    options: WorkbenchPaneCompositeOpenOptions = {},
  ): WorkbenchPaneCompositeLifecycleEvent | undefined {
    const compositeId = normalizePaneCompositeId(id, location)
    if (!compositeId) return undefined
    const locationState = this.snapshot.locations[location]
    if (locationState.visible && locationState.activeCompositeId === compositeId) {
      return this.closePaneComposite(location, compositeId, { ...options, toggle: true })
    }
    return this.openPaneComposite(compositeId, location, { ...options, toggle: true })
  }

  getActivePaneComposite(location: WorkbenchPaneCompositeLocation): string | null {
    return this.snapshot.locations[location].activeCompositeId
  }

  getLastActivePaneCompositeId(location: WorkbenchPaneCompositeLocation): string | null {
    return this.snapshot.locations[location].lastActiveCompositeId
  }

  createSnapshot(): WorkbenchPaneCompositeSnapshot {
    return cloneWorkbenchPaneCompositeSnapshot(this.snapshot)
  }

  restore(snapshot: WorkbenchPaneCompositeSnapshot | undefined): void {
    this.snapshot = hydrateWorkbenchPaneCompositeSnapshot(snapshot)
    this.sequence = this.snapshot.events.reduce((max, event) => Math.max(max, sanitizeCount(event.sequence)), 0)
  }

  clear(): void {
    this.snapshot = createEmptyWorkbenchPaneCompositeSnapshot()
    this.sequence = 0
  }

  dispose(): void {
    this.onDidOpenEmitter.dispose()
    this.onDidCloseEmitter.dispose()
  }

  private createEvent(
    action: WorkbenchPaneCompositeAction,
    id: string,
    location: WorkbenchPaneCompositeLocation,
    options: { focus: boolean; previousActiveCompositeId: string | null },
  ): WorkbenchPaneCompositeLifecycleEvent {
    const locationState = this.snapshot.locations[location]
    this.sequence += 1
    return {
      action,
      id,
      location,
      focus: options.focus,
      previousActiveCompositeId: options.previousActiveCompositeId,
      activeCompositeId: locationState.activeCompositeId,
      visible: locationState.visible,
      sequence: this.sequence,
    }
  }
}

export function createEmptyWorkbenchPaneCompositeSnapshot(): WorkbenchPaneCompositeSnapshot {
  return {
    stateSource: "workbenchLayoutService",
    locations: {
      sideBar: createLocationModel("sideBar"),
      panel: createLocationModel("panel"),
      auxiliaryBar: createLocationModel("auxiliaryBar"),
    },
    events: [],
  }
}

export function cloneWorkbenchPaneCompositeSnapshot(snapshot: WorkbenchPaneCompositeSnapshot): WorkbenchPaneCompositeSnapshot {
  return {
    stateSource: "workbenchLayoutService",
    locations: {
      sideBar: cloneLocationModel(snapshot.locations.sideBar, "sideBar"),
      panel: cloneLocationModel(snapshot.locations.panel, "panel"),
      auxiliaryBar: cloneLocationModel(snapshot.locations.auxiliaryBar, "auxiliaryBar"),
    },
    events: Array.isArray(snapshot.events)
      ? snapshot.events.map((event) => ({ ...event }))
      : [],
  }
}

export function hydrateWorkbenchPaneCompositeSnapshot(snapshot: WorkbenchPaneCompositeSnapshot | undefined): WorkbenchPaneCompositeSnapshot {
  if (!snapshot?.locations) return createEmptyWorkbenchPaneCompositeSnapshot()
  return {
    stateSource: "workbenchLayoutService",
    locations: {
      sideBar: cloneLocationModel(snapshot.locations.sideBar, "sideBar"),
      panel: cloneLocationModel(snapshot.locations.panel, "panel"),
      auxiliaryBar: cloneLocationModel(snapshot.locations.auxiliaryBar, "auxiliaryBar"),
    },
    events: Array.isArray(snapshot.events)
      ? snapshot.events.map((event): WorkbenchPaneCompositeLifecycleEvent => ({
        action: sanitizePaneCompositeAction(event.action),
        id: String(event.id || ""),
        location: isPaneCompositeLocation(event.location) ? event.location : "panel",
        focus: event.focus !== false,
        previousActiveCompositeId: event.previousActiveCompositeId || null,
        activeCompositeId: event.activeCompositeId || null,
        visible: Boolean(event.visible),
        sequence: sanitizeCount(event.sequence),
      })).filter((event) => event.id)
      : [],
  }
}

export function normalizeWorkbenchPaneCompositeId(
  id: string | undefined,
  location: WorkbenchPaneCompositeLocation = "sideBar",
): string {
  return normalizePaneCompositeId(id, location)
}

export function paneCompositeLocationFromViewLocation(location: string | undefined): WorkbenchPaneCompositeLocation {
  if (location === "panel") return "panel"
  if (location === "auxiliaryBar") return "auxiliaryBar"
  return "sideBar"
}

function createLocationModel(location: WorkbenchPaneCompositeLocation): WorkbenchPaneCompositeLocationModel {
  return {
    location,
    visible: false,
    activeCompositeId: null,
    lastActiveCompositeId: null,
    compositeIds: [],
    openCount: 0,
    closeCount: 0,
    toggleCount: 0,
  }
}

function cloneLocationModel(
  locationModel: WorkbenchPaneCompositeLocationModel | undefined,
  location: WorkbenchPaneCompositeLocation,
): WorkbenchPaneCompositeLocationModel {
  return {
    location,
    visible: Boolean(locationModel?.visible),
    activeCompositeId: locationModel?.activeCompositeId || null,
    lastActiveCompositeId: locationModel?.lastActiveCompositeId || null,
    compositeIds: sanitizeStringList(locationModel?.compositeIds),
    openCount: sanitizeCount(locationModel?.openCount),
    closeCount: sanitizeCount(locationModel?.closeCount),
    toggleCount: sanitizeCount(locationModel?.toggleCount),
  }
}

function normalizePaneCompositeId(id: string | undefined, location: WorkbenchPaneCompositeLocation): string {
  const value = String(id || "").trim()
  if (!value) return ""
  return location === "panel" ? LEGACY_PANEL_COMPOSITE_IDS.get(value) || value : value
}

function isPaneCompositeLocation(location: unknown): location is WorkbenchPaneCompositeLocation {
  return WORKBENCH_PANE_COMPOSITE_LOCATIONS.includes(location as WorkbenchPaneCompositeLocation)
}

function sanitizePaneCompositeAction(action: unknown): WorkbenchPaneCompositeAction {
  return action === "close" || action === "toggle" ? action : "open"
}

function sanitizeStringList(values: string[] | undefined): string[] {
  return Array.isArray(values) ? values.map((value) => String(value || "").trim()).filter(Boolean) : []
}

function sanitizeCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0
}
