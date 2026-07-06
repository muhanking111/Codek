import { beforeEach, describe, expect, it } from "vitest"
import { createBottomPanelState } from "./bottomPanelState"
import { clearCommands } from "./commandRegistry"
import { createEditorGroupState } from "./editorGroups"
import {
  DEBUG_WORKBENCH_VIEW_IDS,
  TASK_WORKBENCH_VIEW_IDS,
  TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS,
  buildTerminalDebugTaskWorkbenchContributionSurface,
  globalTerminalDebugTaskWorkbenchService,
  registerTerminalDebugTaskWorkbenchContributions,
} from "./terminalDebugTaskWorkbench"
import { clearViews, getViewContainers, getViews, registerDefaultWorkbenchViews } from "./viewRegistry"
import { createViewPaneShellOwnerAdapter } from "./genericShellOwnerContract"
import { EXTENSIONS_WORKBENCH_VIEW_IDS, registerExtensionWorkbenchContributions } from "../extensions/extensionsWorkbenchService"
import { registerTestingWorkbenchViews, TESTING_VIEW_IDS } from "../testing/testingService"
import { MenuRegistry } from "../vscode-adapter/platform/actions/common/menuRegistry"
import { WorkbenchLayoutService } from "../vscode-adapter/workbench/services/layout/browser/layoutService"
import { ViewsService } from "../vscode-adapter/workbench/services/views/common/viewsService"

describe("workbench views/sidebar/panel integration", () => {
  beforeEach(() => {
    clearCommands()
    clearViews()
    MenuRegistry.clear()
    globalTerminalDebugTaskWorkbenchService.clearEvidence()
    registerDefaultWorkbenchViews()
  })

  it("keeps activity, sidebar, and panel containers on the shared view registry with pane-composite layout state", () => {
    registerExtensionWorkbenchContributions()
    registerTestingWorkbenchViews()
    registerTerminalDebugTaskWorkbenchContributions()

    const activityContext = {
      testingEnabled: true,
      testingProviderCount: 1,
      testingDefaultPlaceholderVisible: true,
      testingWorkbenchAdapterDisabled: true,
    }
    const activityContainers = getViewContainers("activityBar", activityContext).map((container) => container.id)
    expect(activityContainers).toEqual(expect.arrayContaining([
      "workbench.view.search",
      "workbench.view.scm",
      DEBUG_WORKBENCH_VIEW_IDS.Container,
      EXTENSIONS_WORKBENCH_VIEW_IDS.Container,
      TESTING_VIEW_IDS.Container,
    ]))

    const panelContainers = getViewContainers("panel", {
      testingEnabled: true,
      testingHasResults: true,
    }).map((container) => container.id)
    expect(panelContainers).toEqual(expect.arrayContaining([
      TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal,
      TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output,
      TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer,
      TASK_WORKBENCH_VIEW_IDS.Container,
      TESTING_VIEW_IDS.ResultsContainer,
    ]))

    expect(getViews(EXTENSIONS_WORKBENCH_VIEW_IDS.Container).map((view) => view.id)).toEqual([
      EXTENSIONS_WORKBENCH_VIEW_IDS.Marketplace,
      EXTENSIONS_WORKBENCH_VIEW_IDS.Installed,
      EXTENSIONS_WORKBENCH_VIEW_IDS.Editor,
    ])
    expect(getViews(EXTENSIONS_WORKBENCH_VIEW_IDS.Container, {
      extensionsWorkbenchAdapterDisabled: true,
    }).map((view) => view.id)).toEqual([
      EXTENSIONS_WORKBENCH_VIEW_IDS.Marketplace,
      EXTENSIONS_WORKBENCH_VIEW_IDS.Installed,
      EXTENSIONS_WORKBENCH_VIEW_IDS.Editor,
      "workbench.view.extensions.default",
    ])
    expect(getViews(TESTING_VIEW_IDS.Container, {
      testingEnabled: true,
      testingProviderCount: 1,
      testingCoverageOpen: true,
    }).map((view) => view.id)).toEqual([
      TESTING_VIEW_IDS.Explorer,
      TESTING_VIEW_IDS.Coverage,
    ])
    expect(getViews(TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer).map((view) => view.id)).toEqual([
      TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems,
    ])
  })

  it("opens sidebar and panel views through ViewsService without creating a second view state", () => {
    registerExtensionWorkbenchContributions()
    registerTestingWorkbenchViews()
    registerTerminalDebugTaskWorkbenchContributions()

    const layoutService = new WorkbenchLayoutService()
    const service = new ViewsService(layoutService)
    const state = { activeSidebarView: "files", sidebarVisible: false }
    const context = {
      testingEnabled: true,
      testingProviderCount: 1,
      testingHasResults: true,
      testingCoverageOpen: true,
    }

    expect(service.openViewContainer(state, EXTENSIONS_WORKBENCH_VIEW_IDS.Container, context)).toEqual(expect.objectContaining({
      opened: true,
      containerId: EXTENSIONS_WORKBENCH_VIEW_IDS.Container,
      activeSidebarView: "marketplace",
      location: "activityBar",
      visiblePaneCompositeIds: [EXTENSIONS_WORKBENCH_VIEW_IDS.Container],
    }))
    expect(service.openView(state, TESTING_VIEW_IDS.Explorer, context)).toEqual(expect.objectContaining({
      opened: true,
      containerId: TESTING_VIEW_IDS.Container,
      viewId: TESTING_VIEW_IDS.Explorer,
      activeSidebarView: "testing",
      visiblePaneCompositeIds: [TESTING_VIEW_IDS.Container],
    }))
    expect(service.openView(state, TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems, context)).toEqual(expect.objectContaining({
      opened: true,
      containerId: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer,
      viewId: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems,
      activeSidebarView: "testing",
      location: "panel",
      visiblePaneCompositeIds: [TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer],
    }))

    const projection = service.createViewsProjection({
      activeSidebarView: state.activeSidebarView,
      sidebarVisible: state.sidebarVisible,
      bottomPanel: createBottomPanelState("tasks"),
      bottomPanelHeight: 260,
      editorGroups: createEditorGroupState(),
      context,
    })

    expect(projection).toEqual(expect.objectContaining({
      stateSource: "workbenchLayoutService",
      noSecondViewState: true,
    }))
    expect(projection.shell).toEqual(expect.objectContaining({
      stateSource: "workbenchLayoutService",
      noSecondLayoutState: true,
    }))
    expect(projection.containers.find((container) => container.id === TESTING_VIEW_IDS.Container)).toEqual(expect.objectContaining({
      active: true,
      activeViewId: TESTING_VIEW_IDS.Explorer,
      stateSource: "workbenchLayoutService",
      viewIds: expect.arrayContaining([TESTING_VIEW_IDS.Explorer, TESTING_VIEW_IDS.Coverage]),
    }))
    expect(projection.containers.find((container) => container.id === TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer)).toEqual({
      id: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer,
      location: "panel",
      visible: true,
      active: true,
      activeViewId: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems,
      viewIds: [TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems],
      stateSource: "workbenchLayoutService",
    })
    expect(projection.shell.active.paneComposites).toEqual(expect.objectContaining({
      sideBar: TESTING_VIEW_IDS.Container,
      panel: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer,
    }))

    const adapter = createViewPaneShellOwnerAdapter({
      projection,
      opened: [
        service.openViewContainer(state, EXTENSIONS_WORKBENCH_VIEW_IDS.Container, context),
        service.openView(state, TESTING_VIEW_IDS.Explorer, context),
        service.openView(state, TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems, context),
      ],
    })

    expect(adapter).toEqual(expect.objectContaining({
      status: "partial",
      shellSource: "viewRegistry+ViewsService+workbenchLayoutService",
      noSecondWorkbenchState: true,
      openedContainerIds: expect.arrayContaining([
        EXTENSIONS_WORKBENCH_VIEW_IDS.Container,
        TESTING_VIEW_IDS.Container,
        TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer,
      ]),
      activePaneComposites: expect.objectContaining({
        sideBar: TESTING_VIEW_IDS.Container,
        panel: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer,
      }),
      blockedOwners: expect.arrayContaining([
        "IPaneComposite instance returned from ViewsService.openViewContainer",
        "ViewPane renderBody/layoutBody/focus DOM owner",
      ]),
    }))
    expect(adapter.implementedOwners).toEqual(expect.arrayContaining([
      "ViewsService openView/openViewContainer routing",
      "PaneComposite layout lifecycle projection",
    ]))
  })

  it("keeps terminal, output, task, and problems contribution surfaces service-backed", () => {
    registerTerminalDebugTaskWorkbenchContributions()

    const snapshot = globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot()
    const surface = buildTerminalDebugTaskWorkbenchContributionSurface()

    expect(snapshot).toEqual(expect.objectContaining({
      source: "terminalDebugTaskWorkbenchService",
      serviceId: "terminalDebugTaskWorkbenchService",
      stateSource: "facade",
      constraints: expect.objectContaining({
        noSecondTerminalState: true,
        noSecondOutputState: true,
        noSecondDebugState: true,
        noSecondTaskState: true,
        problemsReadOnlyBridge: true,
        viewActionMenuDriven: true,
      }),
    }))
    expect(surface.viewsByArea).toEqual(expect.objectContaining({
      terminal: [TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal],
      output: [TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output],
      tasks: [
        TASK_WORKBENCH_VIEW_IDS.Container,
        TASK_WORKBENCH_VIEW_IDS.Tasks,
        TASK_WORKBENCH_VIEW_IDS.ProblemMatchers,
      ],
      problems: [
        TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer,
        TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems,
      ],
    }))
    expect(snapshot.problems).toEqual(expect.objectContaining({
      serviceId: "problemsWorkbenchService",
      stateSource: "problemsDiagnosticsService(globalMarkerService)",
      containerId: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer,
      viewId: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems,
    }))
    expect(snapshot.paneComposite.stateSource).toBe("workbenchLayoutService")
  })
})
