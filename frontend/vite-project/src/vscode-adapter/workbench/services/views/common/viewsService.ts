/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code workbench view service contracts:
 * - src/vs/workbench/common/views.ts
 * - src/vs/workbench/services/views/common/viewsService.ts
 *--------------------------------------------------------------------------------------------*/

import type { ContextKeyState } from "../../../../../workbench/contextKeys"
import {
  sidebarViewToContainerId,
  type CodekSidebarViewId,
  type WorkbenchLayoutState,
} from "../../../../../workbench/workbenchLayoutModel"
import {
  getViewContainers,
  getViews,
  registerView,
  registerViewContainer,
  type ViewContainerDescriptor,
  type ViewDescriptor,
  type ViewLocation,
} from "../../../../../workbench/viewRegistry"
import type { IDisposable } from "../../../../base/common/lifecycle"
import { InstantiationType, registerSingleton } from "../../../../platform/instantiation/common/extensions"
import { createDecorator } from "../../../../platform/instantiation/common/instantiation"
import {
  WorkbenchParts,
  globalWorkbenchLayoutService,
  type IWorkbenchLayoutService,
  type WorkbenchShellLayoutProjection,
} from "../../layout/browser/layoutService"

export interface OpenWorkbenchViewResult {
  opened: boolean
  viewId: string | null
  containerId: string | null
  activeSidebarView: CodekSidebarViewId | null
  location?: ViewLocation
  visiblePaneCompositeIds?: string[]
  reason?: "missing-view" | "missing-container"
}

export interface WorkbenchViewContainerProjection {
  id: string
  location: ViewLocation
  visible: boolean
  active: boolean
  activeViewId: string | null
  viewIds: string[]
  stateSource: "workbenchLayoutService"
}

export interface WorkbenchViewsProjection {
  stateSource: "workbenchLayoutService"
  noSecondViewState: true
  shell: WorkbenchShellLayoutProjection
  containers: WorkbenchViewContainerProjection[]
}

export interface WorkbenchViewsOwnerEvidence {
  schemaVersion: 1
  source: "viewsService"
  vscodeSourceEntrypoints: {
    viewsService: "src/vs/workbench/services/views/common/viewsService.ts"
    viewsRegistry: "src/vs/workbench/common/views.ts"
    mainThreadTreeViews: "src/vs/workbench/api/browser/mainThreadTreeViews.ts"
  }
  viewsServiceOwner: {
    owner: "ViewsService"
    connected: true
    stateSource: "workbenchLayoutService"
    lifecycle: Array<"openViewContainer" | "openView" | "closeViewContainer">
    noSecondViewState: true
  }
  viewContainerOwner: {
    owner: "workbench/viewRegistry"
    connected: true
    stateSource: "workbench/viewRegistry"
    containerIds: string[]
    viewIds: string[]
    noSecondViewState: true
  }
  treeViewBridgeOwner: {
    owner: "desktop/services/extensions-host/mainThread/mainThreadTreeViews"
    connected: false
    stateSource: "desktop mainThreadTreeViews"
    reason: string
    noSecondTreeState: true
  }
  treeDataSourceOwner: {
    owner: "ExtHostTreeViews.registerTreeDataProvider"
    connected: false
    stateSource: "extension host RPC"
    providerSideEffectsStarted: false
    reason: string
  }
  activationOwner: {
    owner: "WorkbenchLayoutService"
    connected: true
    viewsUiOwnerConnected: false
    stateSource: "workbenchLayoutService"
    noSecondViewState: true
  }
  remainingViewsUiOwnerGap: string[]
  constraints: {
    noSecondViewState: true
    noSecondTreeState: true
    runtimeSourceMirrorDependency: false
    extensionTreeProviderSideEffectsStarted: false
  }
}

export interface IViewsService {
  readonly _serviceBrand: undefined
  getVisibleViewContainers(location?: ViewLocation, context?: ContextKeyState): ViewContainerDescriptor[]
  getVisibleViews(containerId?: string, context?: ContextKeyState): ViewDescriptor[]
  registerViewContainer(container: ViewContainerDescriptor): IDisposable
  registerView(view: ViewDescriptor): IDisposable
  isViewContainerVisible(containerId: string, context?: ContextKeyState): boolean
  isViewVisible(viewId: string, context?: ContextKeyState): boolean
  createOwnerEvidence(context?: ContextKeyState): WorkbenchViewsOwnerEvidence
  createViewsProjection(request: Parameters<IWorkbenchLayoutService["createShellProjection"]>[0], context?: ContextKeyState): WorkbenchViewsProjection
  openViewContainer(state: WorkbenchLayoutState, containerId: string, context?: ContextKeyState): OpenWorkbenchViewResult
  openView(state: WorkbenchLayoutState, viewId: string, context?: ContextKeyState): OpenWorkbenchViewResult
  closeViewContainer(state: WorkbenchLayoutState, containerId?: string): boolean
}

export const IViewsService = createDecorator<IViewsService>("viewsService")

export class ViewsService implements IViewsService {
  declare readonly _serviceBrand: undefined

  constructor(private readonly layoutService: IWorkbenchLayoutService = globalWorkbenchLayoutService) {}

  getVisibleViewContainers(location?: ViewLocation, context: ContextKeyState = {}): ViewContainerDescriptor[] {
    return getViewContainers(location, context)
  }

  getVisibleViews(containerId?: string, context: ContextKeyState = {}): ViewDescriptor[] {
    return getViews(containerId, context)
  }

  registerViewContainer(container: ViewContainerDescriptor): IDisposable {
    return registerViewContainer(container)
  }

  registerView(view: ViewDescriptor): IDisposable {
    return registerView(view)
  }

  isViewContainerVisible(containerId: string, context: ContextKeyState = {}): boolean {
    return this.getVisibleViewContainers(undefined, context).some((container) => container.id === containerId)
  }

  isViewVisible(viewId: string, context: ContextKeyState = {}): boolean {
    return this.getVisibleViews(undefined, context).some((view) => view.id === viewId)
  }

  createOwnerEvidence(context: ContextKeyState = {}): WorkbenchViewsOwnerEvidence {
    const containers = this.getVisibleViewContainers(undefined, context)
    const views = this.getVisibleViews(undefined, context)
    return {
      schemaVersion: 1,
      source: "viewsService",
      vscodeSourceEntrypoints: {
        viewsService: "src/vs/workbench/services/views/common/viewsService.ts",
        viewsRegistry: "src/vs/workbench/common/views.ts",
        mainThreadTreeViews: "src/vs/workbench/api/browser/mainThreadTreeViews.ts",
      },
      viewsServiceOwner: {
        owner: "ViewsService",
        connected: true,
        stateSource: "workbenchLayoutService",
        lifecycle: ["openViewContainer", "openView", "closeViewContainer"],
        noSecondViewState: true,
      },
      viewContainerOwner: {
        owner: "workbench/viewRegistry",
        connected: true,
        stateSource: "workbench/viewRegistry",
        containerIds: containers.map((container) => container.id),
        viewIds: views.map((view) => view.id),
        noSecondViewState: true,
      },
      treeViewBridgeOwner: {
        owner: "desktop/services/extensions-host/mainThread/mainThreadTreeViews",
        connected: false,
        stateSource: "desktop mainThreadTreeViews",
        reason: "Tree view bridge owner evidence is exported by desktop mainThreadTreeViews; renderer ViewsService does not own provider state.",
        noSecondTreeState: true,
      },
      treeDataSourceOwner: {
        owner: "ExtHostTreeViews.registerTreeDataProvider",
        connected: false,
        stateSource: "extension host RPC",
        providerSideEffectsStarted: false,
        reason: "ViewsService only projects registered view descriptors and layout activation; it does not start extension tree providers.",
      },
      activationOwner: {
        owner: "WorkbenchLayoutService",
        connected: true,
        viewsUiOwnerConnected: false,
        stateSource: "workbenchLayoutService",
        noSecondViewState: true,
      },
      remainingViewsUiOwnerGap: [
        "ActivityBar/Views UI owner remains in App.vue/generic shell and is intentionally not wired by this backend evidence thread.",
      ],
      constraints: {
        noSecondViewState: true,
        noSecondTreeState: true,
        runtimeSourceMirrorDependency: false,
        extensionTreeProviderSideEffectsStarted: false,
      },
    }
  }

  createViewsProjection(
    request: Parameters<IWorkbenchLayoutService["createShellProjection"]>[0],
    context: ContextKeyState = request.context || {},
  ): WorkbenchViewsProjection {
    const shell = this.layoutService.createShellProjection({ ...request, context })
    return {
      stateSource: "workbenchLayoutService",
      noSecondViewState: true,
      shell,
      containers: this.getVisibleViewContainers(undefined, context).map((container) => {
        const location = container.location
        const paneLocation = this.layoutService.getPaneCompositeLocationFromViewLocation(location)
        const views = this.getVisibleViews(container.id, context)
        const activePaneCompositeId = shell.active.paneComposites[paneLocation]
        const activeSideBarContainerId = shell.active.viewContainerId
        const active = paneLocation === "sideBar"
          ? activeSideBarContainerId === container.id && shell.parts[WorkbenchParts.SIDEBAR_PART].visible
          : activePaneCompositeId === container.id
        return {
          id: container.id,
          location,
          visible: views.length > 0,
          active,
          activeViewId: active ? views[0]?.id || null : null,
          viewIds: views.map((view) => view.id),
          stateSource: "workbenchLayoutService",
        }
      }),
    }
  }

  openViewContainer(
    state: WorkbenchLayoutState,
    containerId: string,
    context: ContextKeyState = {},
  ): OpenWorkbenchViewResult {
    const container = this.getVisibleViewContainers(undefined, context).find((candidate) => candidate.id === containerId)
    if (!container) {
      return {
        opened: false,
        viewId: null,
        containerId: null,
        activeSidebarView: state.activeSidebarView,
        reason: "missing-container",
      }
    }

    const views = this.getVisibleViews(containerId, context)
    const location = this.layoutService.getPaneCompositeLocationFromViewLocation(container.location)
    if (location !== "sideBar") {
      const event = this.layoutService.openPaneComposite(containerId, location, true)
      return {
        opened: Boolean(event),
        viewId: views[0]?.id || null,
        containerId: event ? containerId : null,
        activeSidebarView: state.activeSidebarView,
        location: container.location,
        visiblePaneCompositeIds: this.layoutService.getVisiblePaneCompositeIds(location),
      }
    }

    const opened = this.layoutService.activateViewContainer(state, containerId, context)
    return {
      opened,
      viewId: views[0]?.id || null,
      containerId: opened ? containerId : null,
      activeSidebarView: state.activeSidebarView,
      location: container.location,
      visiblePaneCompositeIds: this.layoutService.getVisiblePaneCompositeIds("sideBar"),
    }
  }

  openView(state: WorkbenchLayoutState, viewId: string, context: ContextKeyState = {}): OpenWorkbenchViewResult {
    const view = this.getVisibleViews(undefined, context).find((candidate) => candidate.id === viewId)
    if (!view) {
      return {
        opened: false,
        viewId,
        containerId: null,
        activeSidebarView: state.activeSidebarView,
        reason: "missing-view",
      }
    }

    const result = this.openViewContainer(state, view.containerId, context)
    return {
      ...result,
      viewId,
      containerId: result.containerId || view.containerId,
    }
  }

  closeViewContainer(state: WorkbenchLayoutState, containerId?: string): boolean {
    if (containerId) {
      const container = this.getVisibleViewContainers().find((candidate) => candidate.id === containerId)
      const location = this.layoutService.getPaneCompositeLocationFromViewLocation(
        container?.location || inferViewContainerLocation(containerId),
      )
      if (location !== "sideBar") return Boolean(this.layoutService.closePaneComposite(location, containerId))
    }

    const activeContainerId = sidebarViewToContainerId(state.activeSidebarView)
    if (containerId && activeContainerId !== containerId) return false
    if (!state.sidebarVisible) return false
    state.sidebarVisible = false
    this.layoutService.closePaneComposite("sideBar", activeContainerId)
    return true
  }
}

function inferViewContainerLocation(containerId: string): ViewLocation | undefined {
  return String(containerId || "").startsWith("workbench.panel.") ? "panel" : undefined
}

export const globalViewsService = new ViewsService()
registerSingleton(IViewsService, globalViewsService, InstantiationType.Delayed)
