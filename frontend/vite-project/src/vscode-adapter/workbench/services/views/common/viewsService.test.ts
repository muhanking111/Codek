import { beforeEach, describe, expect, it } from "vitest"
import { ServiceCollection } from "../../../../platform/instantiation/common/serviceCollection"
import { createBottomPanelState } from "../../../../../workbench/bottomPanelState"
import { createEditorGroupState, openEditor } from "../../../../../workbench/editorGroups"
import { clearViews, registerDefaultWorkbenchViews } from "../../../../../workbench/viewRegistry"
import { WorkbenchLayoutService } from "../../layout/browser/layoutService"
import { globalViewsService, IViewsService, ViewsService } from "./viewsService"

describe("ViewsService", () => {
  beforeEach(() => {
    clearViews()
    registerDefaultWorkbenchViews()
  })

  it("registers a VS Code-style service identifier and resolves through ServiceCollection", () => {
    const service = new ViewsService()
    const collection = new ServiceCollection([IViewsService, service])

    const resolved = collection.get(IViewsService)

    expect(resolved).toBe(service)
    expect(resolved?._serviceBrand).toBeUndefined()
    expect(globalViewsService._serviceBrand).toBeUndefined()
  })

  it("proxies the existing view registry as the single source of truth", () => {
    const service = new ViewsService()

    service.registerViewContainer({
      id: "codek.view.layoutAudit",
      name: "布局审计",
      location: "activityBar",
      source: "codek",
      order: 15,
    })
    service.registerView({
      id: "codek.view.layoutAudit.surface",
      name: "布局 Surface",
      containerId: "codek.view.layoutAudit",
      when: "layoutAuditEnabled",
      order: 0,
    })

    expect(service.getVisibleViewContainers("activityBar", { layoutAuditEnabled: false }).map((item) => item.id))
      .not.toContain("codek.view.layoutAudit")
    expect(service.getVisibleViewContainers("activityBar", { layoutAuditEnabled: true }).map((item) => item.id))
      .toContain("codek.view.layoutAudit")
    expect(service.getVisibleViews("codek.view.layoutAudit", { layoutAuditEnabled: true }).map((item) => item.id))
      .toEqual(["codek.view.layoutAudit.surface"])
  })

  it("disposes contributed views through the shared registry lifecycle", () => {
    const service = new ViewsService()
    const container = service.registerViewContainer({
      id: "codek.view.disposable",
      name: "Disposable",
      location: "activityBar",
      source: "codek",
    })
    const view = service.registerView({
      id: "codek.view.disposable.surface",
      name: "Disposable Surface",
      containerId: "codek.view.disposable",
    })

    expect(service.getVisibleViewContainers("activityBar").map((item) => item.id)).toContain("codek.view.disposable")

    view.dispose()
    expect(service.getVisibleViewContainers("activityBar").map((item) => item.id)).not.toContain("codek.view.disposable")

    service.registerView({
      id: "codek.view.disposable.surface",
      name: "Disposable Surface",
      containerId: "codek.view.disposable",
    })
    expect(service.getVisibleViewContainers("activityBar").map((item) => item.id)).toContain("codek.view.disposable")

    container.dispose()
    expect(service.getVisibleViewContainers("activityBar").map((item) => item.id)).not.toContain("codek.view.disposable")
    expect(service.getVisibleViews("codek.view.disposable")).toHaveLength(0)
  })

  it("opens views and containers by mutating the existing sidebar state", () => {
    const layoutService = new WorkbenchLayoutService()
    const service = new ViewsService(layoutService)
    const state = { activeSidebarView: "files", sidebarVisible: false }

    const openedContainer = service.openViewContainer(state, "workbench.view.search")
    expect(openedContainer).toEqual(expect.objectContaining({
      opened: true,
      viewId: "workbench.view.search.default",
      containerId: "workbench.view.search",
      activeSidebarView: "search",
      location: "activityBar",
      visiblePaneCompositeIds: ["workbench.view.search"],
    }))
    expect(state).toEqual({ activeSidebarView: "search", sidebarVisible: true })
    expect(layoutService.getActivePaneComposite("sideBar")).toBe("workbench.view.search")

    const openedView = service.openView(state, "workbench.view.testing.default", { testingEnabled: true })
    expect(openedView).toEqual(expect.objectContaining({
      opened: false,
      viewId: "workbench.view.testing.default",
      containerId: null,
      activeSidebarView: "search",
      reason: "missing-view",
    }))
    expect(state).toEqual({ activeSidebarView: "search", sidebarVisible: true })
    expect(layoutService.createPaneCompositeSnapshot().locations.sideBar).toEqual(expect.objectContaining({
      activeCompositeId: "workbench.view.search",
      lastActiveCompositeId: "workbench.view.search",
      compositeIds: ["workbench.view.search"],
    }))
  })

  it("opens panel view containers through pane composite lifecycle without mutating sidebar state", () => {
    const layoutService = new WorkbenchLayoutService()
    const service = new ViewsService(layoutService)
    const state = { activeSidebarView: "files", sidebarVisible: false }
    service.registerViewContainer({
      id: "workbench.panel.lifecycle",
      name: "Lifecycle Panel",
      location: "panel",
      source: "vscode",
      order: 10,
    })
    service.registerView({
      id: "workbench.panel.lifecycle.surface",
      name: "Lifecycle Surface",
      containerId: "workbench.panel.lifecycle",
      location: "panel",
      source: "vscode",
      order: 0,
    })

    expect(service.openView(state, "workbench.panel.lifecycle.surface")).toEqual(expect.objectContaining({
      opened: true,
      viewId: "workbench.panel.lifecycle.surface",
      containerId: "workbench.panel.lifecycle",
      activeSidebarView: "files",
      location: "panel",
      visiblePaneCompositeIds: ["workbench.panel.lifecycle"],
    }))
    expect(state).toEqual({ activeSidebarView: "files", sidebarVisible: false })
    expect(layoutService.getActivePaneComposite("panel")).toBe("workbench.panel.lifecycle")
    expect(layoutService.createPaneCompositeSnapshot().locations.panel).toEqual(expect.objectContaining({
      visible: true,
      activeCompositeId: "workbench.panel.lifecycle",
      lastActiveCompositeId: "workbench.panel.lifecycle",
      compositeIds: ["workbench.panel.lifecycle"],
    }))
  })

  it("closes panel view containers through pane composite lifecycle only when they are active", () => {
    const layoutService = new WorkbenchLayoutService()
    const service = new ViewsService(layoutService)
    const state = { activeSidebarView: "search", sidebarVisible: true }
    layoutService.openPaneComposite("workbench.panel.output", "panel")

    expect(service.closeViewContainer(state, "workbench.panel.terminal")).toBe(false)
    expect(service.closeViewContainer(state, "workbench.panel.output")).toBe(true)
    expect(state).toEqual({ activeSidebarView: "search", sidebarVisible: true })
    expect(layoutService.getActivePaneComposite("panel")).toBeNull()
    expect(layoutService.getLastActivePaneCompositeId("panel")).toBe("workbench.panel.output")
  })

  it("keeps hidden views closed and reports why they were not opened", () => {
    const service = new ViewsService()
    const state = { activeSidebarView: "files", sidebarVisible: true }
    service.registerViewContainer({
      id: "codek.view.hidden",
      name: "Hidden",
      location: "activityBar",
    })
    service.registerView({
      id: "codek.view.hidden.surface",
      name: "Hidden Surface",
      containerId: "codek.view.hidden",
      when: "hiddenEnabled",
    })

    expect(service.isViewVisible("codek.view.hidden.surface", { hiddenEnabled: false })).toBe(false)
    expect(service.isViewContainerVisible("codek.view.hidden", { hiddenEnabled: false })).toBe(false)
    expect(service.openView(state, "codek.view.hidden.surface", { hiddenEnabled: false })).toEqual({
      opened: false,
      viewId: "codek.view.hidden.surface",
      containerId: null,
      activeSidebarView: "files",
      reason: "missing-view",
    })
    expect(service.openViewContainer(state, "missing.container")).toEqual({
      opened: false,
      viewId: null,
      containerId: null,
      activeSidebarView: "files",
      reason: "missing-container",
    })
    expect(state).toEqual({ activeSidebarView: "files", sidebarVisible: true })
  })

  it("creates a view projection from the layout shell contract without storing a second view state", () => {
    const layoutService = new WorkbenchLayoutService()
    const service = new ViewsService(layoutService)
    const editorGroups = createEditorGroupState()
    openEditor(editorGroups, "src/workbench.ts", { pinned: true })
    service.registerViewContainer({
      id: "workbench.panel.projection",
      name: "Projection Panel",
      location: "panel",
      source: "vscode",
      order: 10,
    })
    service.registerView({
      id: "workbench.panel.projection.surface",
      name: "Projection Surface",
      containerId: "workbench.panel.projection",
      location: "panel",
      source: "vscode",
      order: 0,
    })
    layoutService.openPaneComposite("workbench.panel.projection", "panel")

    const projection = service.createViewsProjection({
      activeSidebarView: "search",
      sidebarVisible: true,
      sidebarWidth: 312,
      bottomPanel: createBottomPanelState("output"),
      bottomPanelHeight: 250,
      editorGroups,
      context: { testingEnabled: true },
    })

    expect(projection).toEqual(expect.objectContaining({
      stateSource: "workbenchLayoutService",
      noSecondViewState: true,
    }))
    expect(projection.shell.active).toEqual(expect.objectContaining({
      sideBarView: "search",
      viewContainerId: "workbench.view.search",
      panelId: "output",
      editor: "src/workbench.ts",
    }))
    expect(projection.containers.find((container) => container.id === "workbench.view.search")).toEqual({
      id: "workbench.view.search",
      location: "activityBar",
      visible: true,
      active: true,
      activeViewId: "workbench.view.search.default",
      viewIds: ["workbench.view.search.default"],
      stateSource: "workbenchLayoutService",
    })
    expect(projection.containers.find((container) => container.id === "workbench.panel.projection")).toEqual({
      id: "workbench.panel.projection",
      location: "panel",
      visible: true,
      active: true,
      activeViewId: "workbench.panel.projection.surface",
      viewIds: ["workbench.panel.projection.surface"],
      stateSource: "workbenchLayoutService",
    })
  })

  it("projects VS Code-style owner evidence without starting tree providers or claiming shell UI ownership", () => {
    const service = new ViewsService()
    service.registerViewContainer({
      id: "codek.view.treeEvidence",
      name: "Tree Evidence",
      location: "activityBar",
      source: "extension",
    })
    service.registerView({
      id: "codek.view.treeEvidence.default",
      name: "Tree Evidence",
      containerId: "codek.view.treeEvidence",
      source: "extension",
    })

    const evidence = service.createOwnerEvidence()

    expect(evidence.vscodeSourceEntrypoints).toEqual({
      viewsService: "src/vs/workbench/services/views/common/viewsService.ts",
      viewsRegistry: "src/vs/workbench/common/views.ts",
      mainThreadTreeViews: "src/vs/workbench/api/browser/mainThreadTreeViews.ts",
    })
    expect(evidence.viewsServiceOwner).toEqual(expect.objectContaining({
      owner: "ViewsService",
      connected: true,
      stateSource: "workbenchLayoutService",
      noSecondViewState: true,
    }))
    expect(evidence.viewContainerOwner).toEqual(expect.objectContaining({
      owner: "workbench/viewRegistry",
      connected: true,
      stateSource: "workbench/viewRegistry",
      noSecondViewState: true,
    }))
    expect(evidence.viewContainerOwner.containerIds).toContain("codek.view.treeEvidence")
    expect(evidence.viewContainerOwner.viewIds).toContain("codek.view.treeEvidence.default")
    expect(evidence.treeViewBridgeOwner).toEqual(expect.objectContaining({
      owner: "desktop/services/extensions-host/mainThread/mainThreadTreeViews",
      connected: false,
      noSecondTreeState: true,
    }))
    expect(evidence.treeDataSourceOwner).toEqual(expect.objectContaining({
      owner: "ExtHostTreeViews.registerTreeDataProvider",
      connected: false,
      providerSideEffectsStarted: false,
    }))
    expect(evidence.activationOwner).toEqual(expect.objectContaining({
      owner: "WorkbenchLayoutService",
      connected: true,
      viewsUiOwnerConnected: false,
    }))
    expect(evidence.remainingViewsUiOwnerGap).toEqual([
      "ActivityBar/Views UI owner remains in App.vue/generic shell and is intentionally not wired by this backend evidence thread.",
    ])
    expect(evidence.constraints).toEqual({
      noSecondViewState: true,
      noSecondTreeState: true,
      runtimeSourceMirrorDependency: false,
      extensionTreeProviderSideEffectsStarted: false,
    })
  })

  it("collapses only the active view container without creating another visibility state", () => {
    const layoutService = new WorkbenchLayoutService()
    const service = new ViewsService(layoutService)
    const state = { activeSidebarView: "search", sidebarVisible: true }
    layoutService.openPaneComposite("workbench.view.search", "sideBar")

    expect(service.closeViewContainer(state, "workbench.view.explorer")).toBe(false)
    expect(state.sidebarVisible).toBe(true)
    expect(service.closeViewContainer(state, "workbench.view.search")).toBe(true)
    expect(state).toEqual({ activeSidebarView: "search", sidebarVisible: false })
    expect(layoutService.getActivePaneComposite("sideBar")).toBeNull()
    expect(layoutService.getLastActivePaneCompositeId("sideBar")).toBe("workbench.view.search")
    expect(service.closeViewContainer(state, "workbench.view.search")).toBe(false)
  })
})
