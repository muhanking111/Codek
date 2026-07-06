import { beforeEach, describe, expect, it } from "vitest"
import { ServiceCollection } from "../../../../platform/instantiation/common/serviceCollection"
import { createBottomPanelState } from "../../../../../workbench/bottomPanelState"
import { createEditorGroupState, openEditor } from "../../../../../workbench/editorGroups"
import { clearViews, registerDefaultWorkbenchViews } from "../../../../../workbench/viewRegistry"
import {
  globalWorkbenchLayoutService,
  IWorkbenchLayoutService,
  WorkbenchLayoutService,
  WorkbenchParts,
} from "./layoutService"

describe("WorkbenchLayoutService", () => {
  beforeEach(() => {
    clearViews()
    registerDefaultWorkbenchViews()
  })

  it("registers a VS Code-style service identifier and resolves through ServiceCollection", () => {
    const service = new WorkbenchLayoutService()
    const collection = new ServiceCollection([IWorkbenchLayoutService, service])

    const resolved = collection.get(IWorkbenchLayoutService)

    expect(resolved).toBe(service)
    expect(resolved?._serviceBrand).toBeUndefined()
    expect(globalWorkbenchLayoutService._serviceBrand).toBeUndefined()
  })

  it("creates snapshots from the existing layout model instead of storing a second state source", () => {
    const service = new WorkbenchLayoutService()
    const editorGroups = createEditorGroupState()
    openEditor(editorGroups, "src/app.ts", { dirty: true, pinned: true })

    const snapshot = service.createSnapshot({
      activeSidebarView: "search",
      sidebarVisible: true,
      sidebarWidth: 320,
      bottomPanel: createBottomPanelState("output"),
      bottomPanelHeight: 260,
      editorGroups,
      context: { workspaceFolderCount: 1, testingEnabled: true },
    })

    expect(service.isVisible(WorkbenchParts.ACTIVITYBAR_PART, snapshot)).toBe(true)
    expect(service.isVisible(WorkbenchParts.SIDEBAR_PART, snapshot)).toBe(true)
    expect(service.isVisible(WorkbenchParts.PANEL_PART, snapshot)).toBe(true)
    expect(service.isVisible(WorkbenchParts.TITLEBAR_PART, snapshot)).toBe(true)
    expect(service.isVisible(WorkbenchParts.STATUSBAR_PART, snapshot)).toBe(true)
    expect(service.getActiveSideBarView(snapshot)).toBe("search")
    expect(service.getActivePanel(snapshot)).toBe("output")
    expect(snapshot.parts.editorPart.groups[0]).toEqual(expect.objectContaining({
      activeEditor: "src/app.ts",
      dirtyCount: 1,
      pinnedCount: 1,
    }))
  })

  it("creates a shell projection that unifies activity, sidebar, panel, editor, and pane composites", () => {
    const service = new WorkbenchLayoutService()
    const editorGroups = createEditorGroupState()
    openEditor(editorGroups, "src/app.ts", { dirty: true, pinned: true })
    service.openPaneComposite("workbench.panel.output", "panel", true)

    const projection = service.createShellProjection({
      activeSidebarView: "search",
      sidebarVisible: true,
      sidebarWidth: 320,
      bottomPanel: createBottomPanelState("output"),
      bottomPanelHeight: 260,
      editorGroups,
      context: { workspaceFolderCount: 1, testingEnabled: true },
    })

    expect(projection).toEqual(expect.objectContaining({
      stateSource: "workbenchLayoutService",
      noSecondLayoutState: true,
      stateSources: {
        viewRegistry: "viewRegistry",
        editorGroups: "editorGroups",
        paneComposite: "workbenchLayoutService",
      },
    }))
    expect(projection.active).toEqual({
      sideBarView: "search",
      viewContainerId: "workbench.view.search",
      panelId: "output",
      editor: "src/app.ts",
      paneComposites: {
        sideBar: null,
        panel: "workbench.panel.output",
        auxiliaryBar: null,
      },
    })
    expect(projection.parts[WorkbenchParts.SIDEBAR_PART]).toEqual(expect.objectContaining({
      visible: true,
      size: { width: 320, height: 0 },
      previousVisiblePart: WorkbenchParts.ACTIVITYBAR_PART,
      nextVisiblePart: WorkbenchParts.EDITOR_PART,
    }))
    expect(projection.parts[WorkbenchParts.EDITOR_PART]).toEqual(expect.objectContaining({
      visible: true,
      previousVisiblePart: WorkbenchParts.SIDEBAR_PART,
      nextVisiblePart: WorkbenchParts.PANEL_PART,
    }))
    expect(projection.paneComposite.visibleIds.panel).toEqual(["workbench.panel.output"])
    expect(projection.paneComposite.lastActiveIds.panel).toBe("workbench.panel.output")
    expect(projection.snapshot.parts.editorPart.activeEditor).toBe("src/app.ts")
  })

  it("activates VS Code view containers by mutating the existing Codek sidebar state", () => {
    const service = new WorkbenchLayoutService()
    const state = { activeSidebarView: "files", sidebarVisible: false }

    expect(service.activateViewContainer(state, "workbench.view.testing", { testingEnabled: true })).toBe(false)
    expect(state).toEqual({ activeSidebarView: "files", sidebarVisible: false })
    expect(service.getActivePaneComposite("sideBar")).toBeNull()
    expect(service.getLastActivePaneCompositeId("sideBar")).toBeNull()
    expect(service.activateViewContainer(state, "missing.container")).toBe(false)
    expect(state).toEqual({ activeSidebarView: "files", sidebarVisible: false })
  })

  it("tracks pane composite open, close, toggle, active, and last-active lifecycle from layout service", () => {
    const service = new WorkbenchLayoutService()
    const events: string[] = []
    service.onDidPaneCompositeOpen((event) => events.push(`open:${event.location}:${event.id}:${event.sequence}`))
    service.onDidPaneCompositeClose((event) => events.push(`close:${event.location}:${event.id}:${event.sequence}`))

    expect(service.openPaneComposite("workbench.panel.output", "panel", true)).toEqual(expect.objectContaining({
      action: "open",
      id: "workbench.panel.output",
      location: "panel",
      activeCompositeId: "workbench.panel.output",
      visible: true,
      sequence: 1,
    }))
    expect(service.togglePaneComposite("workbench.panel.terminal", "panel", true)).toEqual(expect.objectContaining({
      action: "toggle",
      id: "workbench.panel.terminal",
      previousActiveCompositeId: "workbench.panel.output",
      activeCompositeId: "workbench.panel.terminal",
      sequence: 2,
    }))
    expect(service.togglePaneComposite("workbench.panel.terminal", "panel", true)).toEqual(expect.objectContaining({
      action: "toggle",
      id: "workbench.panel.terminal",
      previousActiveCompositeId: "workbench.panel.terminal",
      activeCompositeId: null,
      visible: false,
      sequence: 3,
    }))

    expect(events).toEqual([
      "open:panel:workbench.panel.output:1",
      "open:panel:workbench.panel.terminal:2",
      "close:panel:workbench.panel.terminal:3",
    ])
    expect(service.getActivePaneComposite("panel")).toBeNull()
    expect(service.getLastActivePaneCompositeId("panel")).toBe("workbench.panel.terminal")
    expect(service.createPaneCompositeSnapshot().locations.panel).toEqual(expect.objectContaining({
      visible: false,
      activeCompositeId: null,
      lastActiveCompositeId: "workbench.panel.terminal",
      compositeIds: ["workbench.panel.output", "workbench.panel.terminal"],
      openCount: 2,
      closeCount: 1,
      toggleCount: 2,
    }))
  })

  it("restores pane composite lifecycle state into the service model from persisted snapshots", () => {
    const service = new WorkbenchLayoutService()
    const source = new WorkbenchLayoutService()
    source.openPaneComposite("workbench.view.search", "sideBar", true)
    source.openPaneComposite("workbench.panel.output", "panel", true)
    const snapshot = source.createSnapshot({
      activeSidebarView: "search",
      sidebarVisible: true,
      sidebarWidth: 320,
      bottomPanel: createBottomPanelState("output"),
      bottomPanelHeight: 260,
      editorGroups: createEditorGroupState(),
    })

    const result = service.restoreFromSnapshot(snapshot, {})

    expect(result.restored).toBe(true)
    expect(service.getActivePaneComposite("sideBar")).toBe("workbench.view.search")
    expect(service.getActivePaneComposite("panel")).toBe("workbench.panel.output")
    expect(service.getLastActivePaneCompositeId("panel")).toBe("workbench.panel.output")
    expect(service.createPaneCompositeSnapshot().locations.panel).toEqual(expect.objectContaining({
      visible: true,
      activeCompositeId: "workbench.panel.output",
      lastActiveCompositeId: "workbench.panel.output",
      compositeIds: ["workbench.panel.output"],
      openCount: 1,
    }))
  })

  it("normalizes old panel entry ids through a single pane composite proxy", () => {
    const service = new WorkbenchLayoutService()

    expect(service.openPaneComposite("terminal", "panel", true)).toEqual(expect.objectContaining({
      id: "workbench.panel.terminal",
      location: "panel",
      activeCompositeId: "workbench.panel.terminal",
    }))
    expect(service.getActivePaneComposite("panel")).toBe("workbench.panel.terminal")
    expect(service.getVisiblePaneCompositeIds("panel")).toEqual(["workbench.panel.terminal"])
    expect(service.closePaneComposite("panel", "terminal")).toEqual(expect.objectContaining({
      id: "workbench.panel.terminal",
      activeCompositeId: null,
    }))
    expect(service.getVisiblePaneCompositeIds("panel")).toEqual([])
    expect(service.getLastActivePaneCompositeId("panel")).toBe("workbench.panel.terminal")
  })

  it("restores persisted layout snapshots through the model restore helper", () => {
    const service = new WorkbenchLayoutService()
    const editorGroups = createEditorGroupState()
    editorGroups.split = { open: true, file: "src/app.ts", ratio: 64 }
    const snapshot = service.createSnapshot({
      activeSidebarView: "symbols",
      sidebarVisible: true,
      sidebarWidth: 360,
      bottomPanel: createBottomPanelState("terminal"),
      bottomPanelHeight: 280,
      editorGroups,
    })
    const calls: string[] = []

    const result = service.restoreFromSnapshot(snapshot, {
      setActiveSidebarView: (view) => calls.push(`view:${view}`),
      setSidebarVisible: (visible) => calls.push(`sidebar:${visible}`),
      setSidebarWidth: (width) => calls.push(`width:${width}`),
      setBottomPanel: (panel) => calls.push(`panel:${panel}`),
      setBottomPanelHeight: (height) => calls.push(`height:${height}`),
      setSplitOpen: (open) => calls.push(`split:${open}`),
      setSplitFile: (file) => calls.push(`file:${file}`),
      setSplitRatio: (ratio) => calls.push(`ratio:${ratio}`),
    })

    expect(result.restored).toBe(true)
    expect(calls).toEqual([
      "view:symbols",
      "sidebar:true",
      "width:360",
      "panel:terminal",
      "height:280",
      "split:true",
      "file:src/app.ts",
      "ratio:64",
    ])
  })

  it("exposes VS Code-style focus, size, and visible neighbor contracts from the same snapshot", () => {
    const service = new WorkbenchLayoutService()
    const editorGroups = createEditorGroupState({
      editors: [{ path: "src/layout.ts", permanent: true }],
      activeEditor: "src/layout.ts",
    })
    const snapshot = service.createSnapshot({
      activeSidebarView: "search",
      sidebarVisible: true,
      sidebarWidth: 340,
      bottomPanel: createBottomPanelState("output"),
      bottomPanelHeight: 260,
      editorGroups,
    })
    const focusedParts: WorkbenchParts[] = []

    expect(service.focusPart(WorkbenchParts.SIDEBAR_PART, snapshot, { focus: (part) => focusedParts.push(part) })).toBe(true)
    expect(service.focusPart(WorkbenchParts.PANEL_PART, snapshot, { focus: (part) => focusedParts.push(part) })).toBe(true)
    expect(service.hasFocus(WorkbenchParts.PANEL_PART, focusedParts[focusedParts.length - 1])).toBe(true)
    expect(focusedParts).toEqual([WorkbenchParts.SIDEBAR_PART, WorkbenchParts.PANEL_PART])
    expect(service.getSize(WorkbenchParts.SIDEBAR_PART, snapshot)).toEqual({ width: 340, height: 0 })
    expect(service.getSize(WorkbenchParts.PANEL_PART, snapshot)).toEqual({ width: 0, height: 260 })
    expect(service.getVisibleNeighborPart(WorkbenchParts.SIDEBAR_PART, snapshot, "next")).toBe(WorkbenchParts.EDITOR_PART)
    expect(service.getVisibleNeighborPart(WorkbenchParts.EDITOR_PART, snapshot, "previous")).toBe(WorkbenchParts.SIDEBAR_PART)
    expect(service.getVisibleNeighborPart(WorkbenchParts.EDITOR_PART, snapshot, "next")).toBe(WorkbenchParts.PANEL_PART)

    const restored = service.restoreFromSnapshot(snapshot, {})
    expect(restored.restored).toBe(true)
    expect(service.getActiveSideBarView(snapshot)).toBe("search")
    expect(snapshot.parts.paneComposite.stateSource).toBe("workbenchLayoutService")
  })

  it("refuses to focus hidden parts and reports zero size for them", () => {
    const service = new WorkbenchLayoutService()
    const snapshot = service.createSnapshot({
      activeSidebarView: "search",
      sidebarVisible: false,
      sidebarWidth: 340,
      bottomPanel: createBottomPanelState(),
      bottomPanelHeight: 260,
      editorGroups: createEditorGroupState(),
    })

    expect(service.isVisible(WorkbenchParts.SIDEBAR_PART, snapshot)).toBe(false)
    expect(service.focusPart(WorkbenchParts.SIDEBAR_PART, snapshot, { focus: () => { throw new Error("hidden part focused") } })).toBe(false)
    expect(service.getSize(WorkbenchParts.SIDEBAR_PART, snapshot)).toEqual({ width: 0, height: 0 })
    expect(service.getSize(WorkbenchParts.PANEL_PART, snapshot)).toEqual({ width: 0, height: 0 })
  })

  it("serializes and deserializes persisted layout snapshots through the same model helpers", () => {
    const service = new WorkbenchLayoutService()
    const snapshot = service.createSnapshot({
      activeSidebarView: "search",
      sidebarVisible: false,
      sidebarWidth: 333,
      bottomPanel: createBottomPanelState(),
      editorGroups: createEditorGroupState({
        editors: [{ path: "src/layout.ts", dirty: true, pinned: true }],
      }),
    })

    const serialized = service.serializeSnapshot(snapshot)
    const restored = service.deserializeSnapshot(serialized)

    expect(restored).toEqual(snapshot)
    expect(service.deserializeSnapshot("{not-json")).toBeNull()
    expect(service.deserializeSnapshot({ version: 99 })).toBeNull()
  })
})
