/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code workbench layout service contracts:
 * - src/vs/workbench/browser/layout.ts
 * - src/vs/workbench/services/layout/browser/layoutService.ts
 *--------------------------------------------------------------------------------------------*/

import type { ContextKeyState } from "../../../../../workbench/contextKeys"
import type { BottomPanelId, BottomPanelState } from "../../../../../workbench/bottomPanelState"
import type { EditorGroupState } from "../../../../../workbench/editorGroups"
import {
  WorkbenchPaneCompositeLifecycleModel,
  paneCompositeLocationFromViewLocation,
  type WorkbenchPaneCompositeLifecycleEvent,
  type WorkbenchPaneCompositeLocation,
  type WorkbenchPaneCompositeSnapshot,
} from "../../../../../workbench/workbenchPaneCompositeModel"
import {
  activateWorkbenchViewContainer,
  buildWorkbenchLayoutSnapshot,
  deserializeWorkbenchLayoutSnapshot,
  restoreWorkbenchLayoutStateFromSnapshot,
  serializeWorkbenchLayoutSnapshot,
  type CodekSidebarViewId,
  type RestoreWorkbenchLayoutResult,
  type RestoreWorkbenchLayoutTarget,
  type WorkbenchLayoutSnapshot,
  type WorkbenchLayoutState,
} from "../../../../../workbench/workbenchLayoutModel"
import { InstantiationType, registerSingleton } from "../../../../platform/instantiation/common/extensions"
import { createDecorator } from "../../../../platform/instantiation/common/instantiation"

export const enum WorkbenchParts {
  ACTIVITYBAR_PART = "workbench.parts.activitybar",
  SIDEBAR_PART = "workbench.parts.sidebar",
  PANEL_PART = "workbench.parts.panel",
  EDITOR_PART = "workbench.parts.editor",
  TITLEBAR_PART = "workbench.parts.titlebar",
  STATUSBAR_PART = "workbench.parts.statusbar",
}

export interface WorkbenchLayoutSnapshotRequest extends WorkbenchLayoutState {
  sidebarWidth?: number
  bottomPanel: BottomPanelState
  bottomPanelHeight?: number
  editorGroups: EditorGroupState
  context?: ContextKeyState
}

export interface WorkbenchPartSize {
  width: number
  height: number
}

export interface WorkbenchPartProjection {
  part: WorkbenchParts
  visible: boolean
  size: WorkbenchPartSize
  previousVisiblePart?: WorkbenchParts
  nextVisiblePart?: WorkbenchParts
}

export interface WorkbenchShellLayoutProjection {
  stateSource: "workbenchLayoutService"
  noSecondLayoutState: true
  snapshot: WorkbenchLayoutSnapshot
  parts: Record<WorkbenchParts, WorkbenchPartProjection>
  active: {
    sideBarView: CodekSidebarViewId | null
    viewContainerId: string | null
    panelId: BottomPanelId | null
    editor: string | null
    paneComposites: Record<WorkbenchPaneCompositeLocation, string | null>
  }
  paneComposite: {
    visibleIds: Record<WorkbenchPaneCompositeLocation, string[]>
    lastActiveIds: Record<WorkbenchPaneCompositeLocation, string | null>
  }
  stateSources: {
    viewRegistry: "viewRegistry"
    editorGroups: "editorGroups"
    paneComposite: "workbenchLayoutService"
  }
}

export interface IWorkbenchLayoutService {
  readonly _serviceBrand: undefined
  readonly onDidPaneCompositeOpen: (listener: (event: WorkbenchPaneCompositeLifecycleEvent) => unknown) => { dispose(): void }
  readonly onDidPaneCompositeClose: (listener: (event: WorkbenchPaneCompositeLifecycleEvent) => unknown) => { dispose(): void }
  createSnapshot(input: WorkbenchLayoutSnapshotRequest): WorkbenchLayoutSnapshot
  createShellProjection(input: WorkbenchLayoutSnapshotRequest): WorkbenchShellLayoutProjection
  serializeSnapshot(snapshot: WorkbenchLayoutSnapshot): string
  deserializeSnapshot(raw: unknown): WorkbenchLayoutSnapshot | null
  activateViewContainer(state: WorkbenchLayoutState, containerId: string, context?: ContextKeyState): boolean
  openPaneComposite(id: string | undefined, location: WorkbenchPaneCompositeLocation, focus?: boolean): WorkbenchPaneCompositeLifecycleEvent | undefined
  togglePaneComposite(id: string | undefined, location: WorkbenchPaneCompositeLocation, focus?: boolean): WorkbenchPaneCompositeLifecycleEvent | undefined
  closePaneComposite(location: WorkbenchPaneCompositeLocation, id?: string): WorkbenchPaneCompositeLifecycleEvent | undefined
  getActivePaneComposite(location: WorkbenchPaneCompositeLocation): string | null
  getLastActivePaneCompositeId(location: WorkbenchPaneCompositeLocation): string | null
  getVisiblePaneCompositeIds(location: WorkbenchPaneCompositeLocation): string[]
  createPaneCompositeSnapshot(): WorkbenchPaneCompositeSnapshot
  clearPaneCompositeLifecycle(): void
  restoreFromSnapshot(snapshot: WorkbenchLayoutSnapshot | null | undefined, target: RestoreWorkbenchLayoutTarget): RestoreWorkbenchLayoutResult
  isVisible(part: WorkbenchParts, snapshot: WorkbenchLayoutSnapshot): boolean
  hasFocus(part: WorkbenchParts, focusedPart: WorkbenchParts | null | undefined): boolean
  focusPart(part: WorkbenchParts, snapshot: WorkbenchLayoutSnapshot, target: { focus?: (part: WorkbenchParts) => void }): boolean
  getSize(part: WorkbenchParts, snapshot: WorkbenchLayoutSnapshot): WorkbenchPartSize
  getVisibleNeighborPart(part: WorkbenchParts, snapshot: WorkbenchLayoutSnapshot, direction: "previous" | "next"): WorkbenchParts | undefined
  getActivePanel(snapshot: WorkbenchLayoutSnapshot): BottomPanelId | null
  getActiveSideBarView(snapshot: WorkbenchLayoutSnapshot): CodekSidebarViewId | null
  getPaneCompositeLocationFromViewLocation(location: string | undefined): WorkbenchPaneCompositeLocation
}

export const IWorkbenchLayoutService = createDecorator<IWorkbenchLayoutService>("workbenchLayoutService")

export class WorkbenchLayoutService implements IWorkbenchLayoutService {
  declare readonly _serviceBrand: undefined
  private readonly paneCompositeModel = new WorkbenchPaneCompositeLifecycleModel()

  readonly onDidPaneCompositeOpen = this.paneCompositeModel.onDidPaneCompositeOpen
  readonly onDidPaneCompositeClose = this.paneCompositeModel.onDidPaneCompositeClose

  createSnapshot(input: WorkbenchLayoutSnapshotRequest): WorkbenchLayoutSnapshot {
    return buildWorkbenchLayoutSnapshot({
      ...input,
      paneComposite: this.paneCompositeModel.createSnapshot(),
    })
  }

  createShellProjection(input: WorkbenchLayoutSnapshotRequest): WorkbenchShellLayoutProjection {
    const snapshot = this.createSnapshot(input)
    const paneComposite = snapshot.parts.paneComposite
    return {
      stateSource: "workbenchLayoutService",
      noSecondLayoutState: true,
      snapshot,
      parts: this.createPartProjections(snapshot),
      active: {
        sideBarView: this.getActiveSideBarView(snapshot),
        viewContainerId: snapshot.parts.sideBar.activeContainerId,
        panelId: this.getActivePanel(snapshot),
        editor: snapshot.parts.editorPart.activeEditor,
        paneComposites: {
          sideBar: paneComposite.locations.sideBar.activeCompositeId,
          panel: paneComposite.locations.panel.activeCompositeId,
          auxiliaryBar: paneComposite.locations.auxiliaryBar.activeCompositeId,
        },
      },
      paneComposite: {
        visibleIds: {
          sideBar: getVisiblePaneCompositeIdsFromSnapshot(paneComposite, "sideBar"),
          panel: getVisiblePaneCompositeIdsFromSnapshot(paneComposite, "panel"),
          auxiliaryBar: getVisiblePaneCompositeIdsFromSnapshot(paneComposite, "auxiliaryBar"),
        },
        lastActiveIds: {
          sideBar: paneComposite.locations.sideBar.lastActiveCompositeId,
          panel: paneComposite.locations.panel.lastActiveCompositeId,
          auxiliaryBar: paneComposite.locations.auxiliaryBar.lastActiveCompositeId,
        },
      },
      stateSources: {
        viewRegistry: "viewRegistry",
        editorGroups: "editorGroups",
        paneComposite: "workbenchLayoutService",
      },
    }
  }

  serializeSnapshot(snapshot: WorkbenchLayoutSnapshot): string {
    return serializeWorkbenchLayoutSnapshot(snapshot)
  }

  deserializeSnapshot(raw: unknown): WorkbenchLayoutSnapshot | null {
    return deserializeWorkbenchLayoutSnapshot(raw)
  }

  activateViewContainer(state: WorkbenchLayoutState, containerId: string, context: ContextKeyState = {}): boolean {
    const result = activateWorkbenchViewContainer(state, containerId, context)
    if (result.activated) this.openPaneComposite(containerId, "sideBar", true)
    return result.activated
  }

  openPaneComposite(
    id: string | undefined,
    location: WorkbenchPaneCompositeLocation,
    focus = true,
  ): WorkbenchPaneCompositeLifecycleEvent | undefined {
    return this.paneCompositeModel.openPaneComposite(id, location, { focus })
  }

  togglePaneComposite(
    id: string | undefined,
    location: WorkbenchPaneCompositeLocation,
    focus = true,
  ): WorkbenchPaneCompositeLifecycleEvent | undefined {
    return this.paneCompositeModel.togglePaneComposite(id, location, { focus })
  }

  closePaneComposite(location: WorkbenchPaneCompositeLocation, id?: string): WorkbenchPaneCompositeLifecycleEvent | undefined {
    return this.paneCompositeModel.closePaneComposite(location, id)
  }

  getActivePaneComposite(location: WorkbenchPaneCompositeLocation): string | null {
    return this.paneCompositeModel.getActivePaneComposite(location)
  }

  getLastActivePaneCompositeId(location: WorkbenchPaneCompositeLocation): string | null {
    return this.paneCompositeModel.getLastActivePaneCompositeId(location)
  }

  getVisiblePaneCompositeIds(location: WorkbenchPaneCompositeLocation): string[] {
    return getVisiblePaneCompositeIdsFromSnapshot(this.paneCompositeModel.createSnapshot(), location)
  }

  createPaneCompositeSnapshot(): WorkbenchPaneCompositeSnapshot {
    return this.paneCompositeModel.createSnapshot()
  }

  clearPaneCompositeLifecycle(): void {
    this.paneCompositeModel.clear()
  }

  restoreFromSnapshot(
    snapshot: WorkbenchLayoutSnapshot | null | undefined,
    target: RestoreWorkbenchLayoutTarget,
  ): RestoreWorkbenchLayoutResult {
    const result = restoreWorkbenchLayoutStateFromSnapshot(snapshot, target)
    if (result.restored) this.paneCompositeModel.restore(snapshot?.parts.paneComposite)
    return result
  }

  isVisible(part: WorkbenchParts, snapshot: WorkbenchLayoutSnapshot): boolean {
    switch (part) {
      case WorkbenchParts.ACTIVITYBAR_PART:
        return snapshot.parts.activityBar.visible
      case WorkbenchParts.SIDEBAR_PART:
        return snapshot.parts.sideBar.visible
      case WorkbenchParts.PANEL_PART:
        return snapshot.parts.panel.visible
      case WorkbenchParts.EDITOR_PART:
        return snapshot.parts.editorPart.groups.length > 0
      case WorkbenchParts.TITLEBAR_PART:
        return snapshot.parts.titleBar.visible
      case WorkbenchParts.STATUSBAR_PART:
        return snapshot.parts.statusBar.visible
      default:
        return false
    }
  }

  hasFocus(part: WorkbenchParts, focusedPart: WorkbenchParts | null | undefined): boolean {
    return part === focusedPart
  }

  focusPart(part: WorkbenchParts, snapshot: WorkbenchLayoutSnapshot, target: { focus?: (part: WorkbenchParts) => void }): boolean {
    if (!this.isVisible(part, snapshot)) return false
    target.focus?.(part)
    return true
  }

  getSize(part: WorkbenchParts, snapshot: WorkbenchLayoutSnapshot): WorkbenchPartSize {
    switch (part) {
      case WorkbenchParts.ACTIVITYBAR_PART:
        return snapshot.parts.activityBar.visible ? { width: 48, height: 0 } : { width: 0, height: 0 }
      case WorkbenchParts.SIDEBAR_PART:
        return snapshot.parts.sideBar.visible ? { width: snapshot.parts.sideBar.width || 0, height: 0 } : { width: 0, height: 0 }
      case WorkbenchParts.PANEL_PART:
        return snapshot.parts.panel.visible ? { width: 0, height: snapshot.parts.panel.height || 0 } : { width: 0, height: 0 }
      case WorkbenchParts.EDITOR_PART:
        return { width: 0, height: 0 }
      case WorkbenchParts.TITLEBAR_PART:
        return snapshot.parts.titleBar.visible ? { width: 0, height: 35 } : { width: 0, height: 0 }
      case WorkbenchParts.STATUSBAR_PART:
        return snapshot.parts.statusBar.visible ? { width: 0, height: 24 } : { width: 0, height: 0 }
      default:
        return { width: 0, height: 0 }
    }
  }

  getVisibleNeighborPart(part: WorkbenchParts, snapshot: WorkbenchLayoutSnapshot, direction: "previous" | "next"): WorkbenchParts | undefined {
    const visibleParts = [
      WorkbenchParts.TITLEBAR_PART,
      WorkbenchParts.ACTIVITYBAR_PART,
      WorkbenchParts.SIDEBAR_PART,
      WorkbenchParts.EDITOR_PART,
      WorkbenchParts.PANEL_PART,
      WorkbenchParts.STATUSBAR_PART,
    ].filter((candidate) => this.isVisible(candidate, snapshot))
    const index = visibleParts.indexOf(part)
    if (index < 0) return undefined
    return direction === "previous" ? visibleParts[index - 1] : visibleParts[index + 1]
  }

  getActivePanel(snapshot: WorkbenchLayoutSnapshot): BottomPanelId | null {
    return snapshot.parts.panel.activePanelId
  }

  getActiveSideBarView(snapshot: WorkbenchLayoutSnapshot): CodekSidebarViewId | null {
    return snapshot.parts.sideBar.activeViewId
  }

  getPaneCompositeLocationFromViewLocation(location: string | undefined): WorkbenchPaneCompositeLocation {
    return paneCompositeLocationFromViewLocation(location)
  }

  private createPartProjections(snapshot: WorkbenchLayoutSnapshot): Record<WorkbenchParts, WorkbenchPartProjection> {
    return {
      [WorkbenchParts.ACTIVITYBAR_PART]: this.createPartProjection(WorkbenchParts.ACTIVITYBAR_PART, snapshot),
      [WorkbenchParts.SIDEBAR_PART]: this.createPartProjection(WorkbenchParts.SIDEBAR_PART, snapshot),
      [WorkbenchParts.PANEL_PART]: this.createPartProjection(WorkbenchParts.PANEL_PART, snapshot),
      [WorkbenchParts.EDITOR_PART]: this.createPartProjection(WorkbenchParts.EDITOR_PART, snapshot),
      [WorkbenchParts.TITLEBAR_PART]: this.createPartProjection(WorkbenchParts.TITLEBAR_PART, snapshot),
      [WorkbenchParts.STATUSBAR_PART]: this.createPartProjection(WorkbenchParts.STATUSBAR_PART, snapshot),
    }
  }

  private createPartProjection(part: WorkbenchParts, snapshot: WorkbenchLayoutSnapshot): WorkbenchPartProjection {
    return {
      part,
      visible: this.isVisible(part, snapshot),
      size: this.getSize(part, snapshot),
      previousVisiblePart: this.getVisibleNeighborPart(part, snapshot, "previous"),
      nextVisiblePart: this.getVisibleNeighborPart(part, snapshot, "next"),
    }
  }
}

function getVisiblePaneCompositeIdsFromSnapshot(
  snapshot: WorkbenchPaneCompositeSnapshot,
  location: WorkbenchPaneCompositeLocation,
): string[] {
  const locationState = snapshot.locations[location]
  return locationState.visible && locationState.activeCompositeId ? [locationState.activeCompositeId] : []
}

export const globalWorkbenchLayoutService = new WorkbenchLayoutService()
registerSingleton(IWorkbenchLayoutService, globalWorkbenchLayoutService, InstantiationType.Delayed)
