import { describe, expect, it } from "vitest"
import {
  createGenericShellOwnerAdapterPlan,
  createGenericShellOwnerCapabilityMap,
  createGenericShellOwnerProjection,
  createGenericShellOwnerThreadPlan,
  createAccessibleViewTrueOwnerShellAdapter,
  createViewPaneShellOwnerAdapter,
  createWorkbenchObjectTreeShellOwnerAdapter,
  createWorkbenchTableShellOwnerAdapter,
} from "./genericShellOwnerContract"

describe("generic shell owner contract", () => {
  it("maps VS Code owner entrypoints to current Codek reusable layers without claiming full shell ownership", () => {
    const projection = createGenericShellOwnerProjection()
    const byId = Object.fromEntries(projection.capabilityMap.map((item) => [item.id, item]))

    expect(projection).toEqual(expect.objectContaining({
      source: "codek.genericShellOwnerContract",
      status: "blocked",
      noSecondWorkbenchState: true,
      runtimeReferenceToSourceMirror: false,
    }))
    expect(byId.viewPaneContainer).toEqual(expect.objectContaining({
      status: "partial",
      lowConflictAdapterPossible: true,
      requiresAppVueOrGenericShellRewrite: true,
      vscodeEntrypoints: expect.arrayContaining([
        "src/vs/workbench/browser/parts/views/viewPaneContainer.ts",
        "src/vs/workbench/browser/parts/views/viewPane.ts",
      ]),
      currentCodekSurfaces: expect.arrayContaining([
        "frontend/vite-project/src/vscode-adapter/workbench/services/views/common/viewsService.ts",
      ]),
      missingOwners: expect.arrayContaining([
        "ViewPaneContainer DOM lifecycle",
        "ViewPane header/body/action lifecycle",
      ]),
    }))
    expect(byId.editorPane).toEqual(expect.objectContaining({
      status: "partial",
      lowConflictAdapterPossible: true,
      requiresAppVueOrGenericShellRewrite: true,
      currentCodekSurfaces: expect.arrayContaining([
        "frontend/vite-project/src/vscode-adapter/workbench/services/editor/common/editorPartService.ts",
      ]),
      missingOwners: expect.arrayContaining([
        "EditorPane DOM lifecycle",
        "EditorPaneService registration/lookup owner",
      ]),
    }))
    expect(byId.objectTreeList).toEqual(expect.objectContaining({
      status: "partial",
      requiresAppVueOrGenericShellRewrite: false,
      currentCodekSurfaces: expect.arrayContaining([
        "frontend/vite-project/src/vscode-adapter/platform/list/browser/listService.ts",
        "frontend/vite-project/src/explorer/tree/CodekListView.ts",
        "frontend/vite-project/src/explorer/tree/ExplorerTreeHost.ts",
      ]),
      reusableLayer: expect.arrayContaining([
        "IListService lastFocusedList registry",
      ]),
      missingOwners: expect.arrayContaining([
        "scoped context-key/style registry",
        "generic WorkbenchObjectTree factory",
      ]),
    }))
    expect(byId.workbenchTable).toEqual(expect.objectContaining({
      status: "blocked",
      lowConflictAdapterPossible: true,
      requiresAppVueOrGenericShellRewrite: true,
      reusableLayer: expect.arrayContaining([
        "WorkspaceTrust trusted URI row model evidence",
      ]),
      missingOwners: expect.arrayContaining([
        "WorkbenchTable wrapper",
        "IListService-backed table focus/style owner",
        "shared table renderer lifecycle",
      ]),
    }))
    expect(byId.accessibleView).toEqual(expect.objectContaining({
      status: "blocked",
      lowConflictAdapterPossible: false,
      requiresAppVueOrGenericShellRewrite: true,
      missingOwners: expect.arrayContaining([
        "CodeEditorWidget-backed content owner",
        "WorkbenchToolBar + MenuId.AccessibleView owner",
        "IQuickInputService.createQuickPick symbol owner",
        "IEditorService/CodeEditorWidget.focus invocation owner",
      ]),
    }))
    expect(byId.appShell.blockedReason).toContain("App.vue")
  })

  it("keeps the minimal adapter as a capability map and blocks broad App.vue rewrites", () => {
    const adapterPlan = createGenericShellOwnerAdapterPlan()

    expect(adapterPlan).toEqual(expect.objectContaining({
      status: "blocked",
      noSecondWorkbenchState: true,
      runtimeReferenceToSourceMirror: false,
      currentAdapter: expect.objectContaining({
        kind: "capability-map+blocked-owner-adapters",
        reason: expect.stringContaining("Explorer WorkbenchObjectTree partial ownership"),
      }),
      blockedImplementation: expect.objectContaining({
        owner: "Generic Workbench Shell / App.vue",
        mustNotFakeWith: expect.arrayContaining([
          "smoke DOM selectors",
          "service-level evidence only",
          "feature-local component state",
        ]),
      }),
    }))
    expect(adapterPlan.minimumSafeAdapter.verifies).toEqual(expect.arrayContaining([
      "npm run typecheck",
      "npm run check:vscode-source-boundary",
      "git diff --cached --name-status",
    ]))
    expect(adapterPlan.minimumSafeAdapter.files).toEqual(expect.arrayContaining([
      "frontend/vite-project/src/vscode-adapter/platform/list/browser/listService.ts",
      "frontend/vite-project/src/explorer/tree/CodekListView.ts",
      "frontend/vite-project/src/accessibility/accessibleViewService.ts",
    ]))
  })

  it("splits follow-up work into concrete owner threads with acceptance gates", () => {
    const threads = createGenericShellOwnerThreadPlan()
    const owners = threads.map((thread) => thread.owner)

    expect(owners).toEqual(["viewPaneContainer", "editorPane", "objectTreeList", "workbenchTable", "accessibleView"])
    expect(threads.find((thread) => thread.owner === "viewPaneContainer")).toEqual(expect.objectContaining({
      threadName: "ViewPaneContainer/ViewPane shell owner",
      files: expect.arrayContaining([
        "frontend/vite-project/src/App.vue",
        "frontend/vite-project/src/vscode-adapter/workbench/services/views/common/viewsService.ts",
      ]),
      acceptance: expect.arrayContaining([
        "shared ViewPane mount/dispose/action lifecycle exists",
      ]),
    }))
    expect(threads.find((thread) => thread.owner === "accessibleView")).toEqual(expect.objectContaining({
      acceptance: expect.arrayContaining([
        "toolbar uses WorkbenchToolBar/MenuId.AccessibleView owner",
      ]),
    }))
    expect(threads.find((thread) => thread.owner === "workbenchTable")).toEqual(expect.objectContaining({
      threadName: "WorkbenchTable/ListService owner",
      files: expect.arrayContaining([
        "frontend/vite-project/src/App.vue",
        "frontend/vite-project/src/workbench/extensionTrustRemoteAuthWorkbench.ts",
      ]),
      acceptance: expect.arrayContaining([
        "feature row-model evidence is not used as a substitute for the DOM/widget owner",
      ]),
    }))
  })

  it("keeps all VS Code references as relative source paths, not runtime SourceMirror imports", () => {
    const serialized = JSON.stringify({
      capabilityMap: createGenericShellOwnerCapabilityMap(),
      adapterPlan: createGenericShellOwnerAdapterPlan(),
      threadPlan: createGenericShellOwnerThreadPlan(),
    })

    expect(serialized).not.toContain("D:\\SourceMirror")
    expect(serialized).not.toContain("SourceMirror/vscode")
    expect(serialized).toContain("src/vs/workbench/browser/parts/views/viewPaneContainer.ts")
  })

  it("projects the minimum ViewPaneContainer shell adapter without claiming ViewPane instances", () => {
    const adapter = createViewPaneShellOwnerAdapter({
      projection: {
        stateSource: "workbenchLayoutService",
        noSecondViewState: true,
        shell: {
          stateSource: "workbenchLayoutService",
          noSecondLayoutState: true,
          active: {
            sideBarView: "testing",
            viewContainerId: "workbench.view.testing",
            panelId: "problems",
            editor: null,
            paneComposites: {
              sideBar: "workbench.view.testing",
              panel: "workbench.panel.problems",
              auxiliaryBar: null,
            },
          },
          paneComposite: {
            visibleIds: {
              sideBar: ["workbench.view.testing"],
              panel: ["workbench.panel.problems"],
              auxiliaryBar: [],
            },
            lastActiveIds: {
              sideBar: "workbench.view.testing",
              panel: "workbench.panel.problems",
              auxiliaryBar: null,
            },
          },
        },
        containers: [
          {
            id: "workbench.view.testing",
            location: "activityBar",
            visible: true,
            active: true,
            activeViewId: "workbench.view.testing.explorer",
            viewIds: ["workbench.view.testing.explorer"],
            stateSource: "workbenchLayoutService",
          },
        ],
      },
      opened: [
        {
          opened: true,
          viewId: "workbench.view.testing.explorer",
          containerId: "workbench.view.testing",
          activeSidebarView: "testing",
          location: "activityBar",
          visiblePaneCompositeIds: ["workbench.view.testing"],
        },
      ],
    })

    expect(adapter).toEqual(expect.objectContaining({
      source: "codek.viewPaneShellOwnerAdapter",
      status: "partial",
      shellSource: "viewRegistry+ViewsService+workbenchLayoutService",
      noSecondWorkbenchState: true,
      runtimeReferenceToSourceMirror: false,
      implementedOwners: expect.arrayContaining([
        "View/container registry",
        "ViewsService openView/openViewContainer routing",
        "PaneComposite layout lifecycle projection",
      ]),
      blockedOwners: expect.arrayContaining([
        "IPaneComposite instance returned from ViewsService.openViewContainer",
        "IViewPaneContainer.getView/openView instance lifecycle",
        "ViewPane renderBody/layoutBody/focus DOM owner",
      ]),
    }))
    expect(adapter.openedContainers).toEqual([
      {
        opened: true,
        containerId: "workbench.view.testing",
        viewId: "workbench.view.testing.explorer",
        location: "activityBar",
        activeSidebarView: "testing",
        visiblePaneCompositeIds: ["workbench.view.testing"],
      },
    ])
    expect(adapter.activePaneComposites).toEqual({
      sideBar: "workbench.view.testing",
      panel: "workbench.panel.problems",
      auxiliaryBar: null,
    })
    expect(adapter.blockedReason).toContain("App.vue")
  })

  it("projects an Explorer WorkbenchObjectTree partial owner without treating it as a generic tree owner", () => {
    const adapter = createWorkbenchObjectTreeShellOwnerAdapter({
      treeOwnerId: "ExplorerWorkbenchObjectTree",
      source: "codek.explorerWorkbenchObjectTreeOwner",
      status: "partial",
      stateSource: "ExplorerTreeHost.model + CodekAsyncDataTree + CodekListView",
      noSecondState: true,
      runtimeReferenceToSourceMirror: false,
      vscodeSourcePaths: [
        "src/vs/platform/list/browser/listService.ts",
        "src/vs/base/browser/ui/list/listWidget.ts",
        "src/vs/base/browser/ui/tree/objectTree.ts",
        "src/vs/base/browser/ui/tree/asyncDataTree.ts",
      ],
      currentSourcePaths: [
        "frontend/vite-project/src/vscode-adapter/platform/list/browser/listService.ts",
        "frontend/vite-project/src/explorer/tree/CodekListView.ts",
        "frontend/vite-project/src/explorer/tree/ExplorerTreeHost.ts",
      ],
      implementedOwners: [
        "IListService lastFocusedList registry",
        "WorkbenchListWidget getHTMLElement/onDidFocus/onDidDispose contract",
        "CodekListView virtualized row lifecycle",
      ],
      missingOwners: [
        "generic ObjectTree factory for TestingObjectTree/SettingsTree",
        "scoped context key service for listFocus/listHasSelectionOrFocus",
      ],
      widget: {
        role: "tree",
        ariaLabel: "Files Explorer",
        tabIndex: 0,
        rowCount: 3,
        renderedRowCount: 3,
        focusedUri: "D:/repo/README.md",
        activeDescendant: "codek-explorer-row-1",
        isLastFocusedList: true,
      },
      blockedReason: "Explorer owns the concrete list widget, not a reusable WorkbenchObjectTree factory.",
    })

    expect(adapter).toEqual(expect.objectContaining({
      source: "codek.workbenchObjectTreeShellOwnerAdapter",
      status: "partial",
      shellSource: "explorer-workbench-object-tree+genericShellOwnerContract",
      noSecondWorkbenchState: true,
      runtimeReference: false,
      treeOwnerId: "ExplorerWorkbenchObjectTree",
      treeOwnerStatus: "partial",
      lowConflictAdapterPossible: true,
      requiresAppVueOrGenericShellRewrite: false,
      vscodeEntrypoints: expect.arrayContaining([
        "src/vs/base/browser/ui/tree/objectTree.ts",
      ]),
      codekSurfaces: expect.arrayContaining([
        "frontend/vite-project/src/explorer/tree/ExplorerTreeHost.ts",
      ]),
      implementedOwners: expect.arrayContaining([
        "IListService lastFocusedList registry",
        "CodekListView virtualized row lifecycle",
      ]),
      blockedOwners: expect.arrayContaining([
        "generic WorkbenchObjectTree factory outside Explorer",
        "scoped list/tree context-key owner",
        "generic ObjectTree factory for TestingObjectTree/SettingsTree",
      ]),
    }))
    expect(adapter.widget).toEqual(expect.objectContaining({
      role: "tree",
      ariaLabel: "Files Explorer",
      isLastFocusedList: true,
    }))
    expect(adapter.blockedReason).toContain("remains partial")
  })

  it("projects a blocked WorkbenchTable shell adapter from row-model evidence without claiming widget ownership", () => {
    const adapter = createWorkbenchTableShellOwnerAdapter({
      tableOwnerId: "WorkspaceTrust",
      sourceClass: "WorkspaceTrustedUrisTable",
      stateSource: "WorkspaceTrustWorkbenchService",
      tableUpdateSignal: "WorkspaceTrustedUrisTable.updateTable -> WorkbenchTable.splice",
      rowCount: 2,
      eventCount: 1,
      status: "partial",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/workspace/browser/workspaceTrustEditor.ts",
        "src/vs/platform/list/browser/listService.ts",
        "src/vs/base/browser/ui/table/table.ts",
      ],
      currentSourcePaths: [
        "frontend/vite-project/src/workbench/extensionTrustRemoteAuthWorkbench.ts",
      ],
      coveredSignals: [
        "WorkspaceTrustWorkbenchService.getTrustedUris",
      ],
      blockedSignals: [
        "WorkbenchTable DOM owner",
        "TrustedUri table column renderers",
      ],
      missingOwners: [
        "WorkbenchTable",
        "IInstantiationService",
        "IStorageService",
      ],
    })

    expect(adapter).toEqual(expect.objectContaining({
      source: "codek.workbenchTableShellOwnerAdapter",
      status: "blocked",
      shellSource: "feature-row-model+genericShellOwnerContract",
      noSecondWorkbenchState: true,
      runtimeReference: false,
      tableOwnerId: "WorkspaceTrust",
      rowModelStatus: "partial",
      lowConflictAdapterPossible: true,
      requiresAppVueOrGenericShellRewrite: true,
      vscodeEntrypoints: expect.arrayContaining([
        "src/vs/platform/list/browser/listService.ts",
        "src/vs/base/browser/ui/table/tableWidget.ts",
      ]),
      implementedOwners: expect.arrayContaining([
        "WorkspaceTrustedUrisTable row model",
        "WorkspaceTrustedUrisTable.updateTable -> WorkbenchTable.splice",
      ]),
      blockedOwners: expect.arrayContaining([
        "WorkbenchTable widget construction",
        "TableListRenderer cell template lifecycle",
        "IListService focus/style/context-key registration",
        "Table.domFocus/layout/dispose owner",
        "storage-backed table column state",
        "TrustedUri table column renderers",
      ]),
    }))
    expect(adapter.rowModel).toEqual({
      sourceClass: "WorkspaceTrustedUrisTable",
      stateSource: "WorkspaceTrustWorkbenchService",
      tableUpdateSignal: "WorkspaceTrustedUrisTable.updateTable -> WorkbenchTable.splice",
      rowCount: 2,
      eventCount: 1,
    })
    expect(adapter.blockedReason).toContain("full VS Code WorkbenchTable ownership requires the table widget")
  })

  it("projects AccessibleView true-owner readiness as blocked even when DOM readiness is partial", () => {
    const adapter = createAccessibleViewTrueOwnerShellAdapter({
      ownerId: "AccessibleView",
      source: "codek.accessibleView.trueOwnerFollowUp",
      status: "blocked",
      noSecondAccessibilityState: true,
      domShellReadinessStatus: "partial",
      toolbarQuickPickFocusInvocationStatus: "blocked",
      currentSourcePaths: [
        "frontend/vite-project/src/accessibility/accessibleViewService.ts",
        "frontend/vite-project/src/workbench/quickInput.ts",
      ],
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts",
        "src/vs/workbench/contrib/accessibility/browser/accessibleViewActions.ts",
        "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts",
      ],
      availableEvidence: [
        "provider lifecycle projection",
        "readonly DOM shell readiness selectors",
        "generic quick input surface",
      ],
      blockedOwners: [
        "AccessibleViewSymbolQuickPick owner backed by IQuickInputService.createQuickPick",
      ],
      requiredTrueOwners: [
        "CodeEditorWidget",
        "IContextViewService/ILayoutService",
        "WorkbenchToolBar + MenuId.AccessibleView",
        "IQuickInputService.createQuickPick",
        "IEditorService/CodeEditorWidget.focus",
      ],
      blockedReason: "DOM shell and quick input evidence do not form the AccessibleView workbench/editor owner.",
    })

    expect(adapter).toEqual(expect.objectContaining({
      source: "codek.accessibleViewTrueOwnerShellAdapter",
      status: "blocked",
      shellSource: "accessibleViewService+genericShellOwnerContract",
      noSecondWorkbenchState: true,
      noSecondAccessibilityState: true,
      runtimeReference: false,
      ownerId: "AccessibleView",
      readiness: {
        domShell: "partial",
        toolbarQuickPickFocusInvocation: "blocked",
        trueOwner: "blocked",
      },
      lowConflictAdapterPossible: false,
      requiresAppVueOrGenericShellRewrite: true,
      availableEvidence: expect.arrayContaining([
        "readonly DOM shell readiness selectors",
        "generic quick input surface",
      ]),
      blockedOwners: expect.arrayContaining([
        "CodeEditorWidget-backed AccessibleView content owner",
        "WorkbenchToolBar + MenuId.AccessibleView render owner",
        "IEditorService/CodeEditorWidget.focus invocation owner",
      ]),
      requiredTrueOwners: expect.arrayContaining([
        "CodeEditorWidget",
        "IQuickInputService.createQuickPick",
      ]),
    }))
    expect(adapter.blockedReason).toContain("service-backed and partial")
    expect(JSON.stringify(adapter)).not.toContain("D:\\SourceMirror")
  })
})
