export type GenericShellOwnerStatus = "available" | "partial" | "blocked"

export type GenericShellOwnerId =
  | "viewPaneContainer"
  | "viewPane"
  | "editorPane"
  | "objectTreeList"
  | "workbenchTable"
  | "accessibleView"
  | "appShell"

export interface GenericShellOwnerCapability {
  readonly id: GenericShellOwnerId
  readonly status: GenericShellOwnerStatus
  readonly vscodeEntrypoints: readonly string[]
  readonly currentCodekSurfaces: readonly string[]
  readonly reusableLayer: readonly string[]
  readonly missingOwners: readonly string[]
  readonly lowConflictAdapterPossible: boolean
  readonly requiresAppVueOrGenericShellRewrite: boolean
  readonly blockedReason: string
}

export interface GenericShellOwnerAdapterPlan {
  readonly source: "codek.genericShellOwnerContract"
  readonly status: "blocked"
  readonly noSecondWorkbenchState: true
  readonly runtimeReferenceToSourceMirror: false
  readonly currentAdapter: {
    readonly kind: "capability-map+blocked-owner-adapters"
    readonly files: readonly string[]
    readonly reason: string
  }
  readonly minimumSafeAdapter: {
    readonly kind: "generic-shell-owner-contract"
    readonly files: readonly string[]
    readonly verifies: readonly string[]
  }
  readonly blockedImplementation: {
    readonly owner: "Generic Workbench Shell / App.vue"
    readonly reason: string
    readonly mustNotFakeWith: readonly string[]
  }
}

export interface GenericShellOwnerThreadPlan {
  readonly owner: GenericShellOwnerId
  readonly threadName: string
  readonly files: readonly string[]
  readonly acceptance: readonly string[]
}

export interface GenericShellOwnerProjection {
  readonly source: "codek.genericShellOwnerContract"
  readonly status: "blocked"
  readonly noSecondWorkbenchState: true
  readonly runtimeReferenceToSourceMirror: false
  readonly capabilityMap: readonly GenericShellOwnerCapability[]
  readonly adapterPlan: GenericShellOwnerAdapterPlan
  readonly nextOwnerThreads: readonly GenericShellOwnerThreadPlan[]
}

export type ViewPaneShellOwnerLocation = "activityBar" | "sideBar" | "panel" | "auxiliaryBar"
export type ViewPaneShellPaneCompositeLocation = "sideBar" | "panel" | "auxiliaryBar"

export interface ViewPaneShellOwnerOpenResult {
  readonly opened: boolean
  readonly viewId: string | null
  readonly containerId: string | null
  readonly activeSidebarView: string | null
  readonly location?: ViewPaneShellOwnerLocation
  readonly visiblePaneCompositeIds?: readonly string[]
  readonly reason?: string
}

export interface ViewPaneShellOwnerProjectionInput {
  readonly stateSource: "workbenchLayoutService"
  readonly noSecondViewState: true
  readonly shell: {
    readonly stateSource: "workbenchLayoutService"
    readonly noSecondLayoutState: true
    readonly active: {
      readonly sideBarView: string | null
      readonly viewContainerId: string | null
      readonly panelId: string | null
      readonly editor: string | null
      readonly paneComposites: Record<ViewPaneShellPaneCompositeLocation, string | null>
    }
    readonly paneComposite: {
      readonly visibleIds: Record<ViewPaneShellPaneCompositeLocation, readonly string[]>
      readonly lastActiveIds: Record<ViewPaneShellPaneCompositeLocation, string | null>
    }
  }
  readonly containers: readonly {
    readonly id: string
    readonly location: ViewPaneShellOwnerLocation
    readonly visible: boolean
    readonly active: boolean
    readonly activeViewId: string | null
    readonly viewIds: readonly string[]
    readonly stateSource: "workbenchLayoutService"
  }[]
}

export interface ViewPaneShellOwnerAdapterInput {
  readonly projection: ViewPaneShellOwnerProjectionInput
  readonly opened: readonly ViewPaneShellOwnerOpenResult[]
}

export interface ViewPaneShellOwnerAdapter {
  readonly source: "codek.viewPaneShellOwnerAdapter"
  readonly status: "partial"
  readonly shellSource: "viewRegistry+ViewsService+workbenchLayoutService"
  readonly noSecondWorkbenchState: true
  readonly runtimeReferenceToSourceMirror: false
  readonly vscodeEntrypoints: readonly string[]
  readonly codekSurfaces: readonly string[]
  readonly implementedOwners: readonly string[]
  readonly blockedOwners: readonly string[]
  readonly openedContainers: readonly {
    readonly opened: boolean
    readonly containerId: string | null
    readonly viewId: string | null
    readonly location: ViewPaneShellOwnerLocation | null
    readonly activeSidebarView: string | null
    readonly visiblePaneCompositeIds: readonly string[]
  }[]
  readonly openedContainerIds: readonly string[]
  readonly activePaneComposites: Record<ViewPaneShellPaneCompositeLocation, string | null>
  readonly visiblePaneCompositeIds: Record<ViewPaneShellPaneCompositeLocation, readonly string[]>
  readonly blockedReason: string
}

export interface WorkbenchTableRowModelEvidence {
  readonly tableOwnerId: string
  readonly sourceClass: string
  readonly stateSource: string
  readonly tableUpdateSignal: string
  readonly rowCount: number
  readonly eventCount: number
  readonly status: "partial" | "blocked"
  readonly vscodeSourcePaths: readonly string[]
  readonly currentSourcePaths: readonly string[]
  readonly coveredSignals: readonly string[]
  readonly blockedSignals: readonly string[]
  readonly missingOwners: readonly string[]
}

export interface WorkbenchTableShellOwnerAdapter {
  readonly source: "codek.workbenchTableShellOwnerAdapter"
  readonly status: "blocked"
  readonly shellSource: "feature-row-model+genericShellOwnerContract"
  readonly noSecondWorkbenchState: true
  readonly runtimeReference: false
  readonly tableOwnerId: string
  readonly rowModelStatus: "partial" | "blocked"
  readonly vscodeEntrypoints: readonly string[]
  readonly codekSurfaces: readonly string[]
  readonly implementedOwners: readonly string[]
  readonly blockedOwners: readonly string[]
  readonly rowModel: {
    readonly sourceClass: string
    readonly stateSource: string
    readonly tableUpdateSignal: string
    readonly rowCount: number
    readonly eventCount: number
  }
  readonly lowConflictAdapterPossible: true
  readonly requiresAppVueOrGenericShellRewrite: true
  readonly blockedReason: string
}

export interface WorkbenchObjectTreeOwnerEvidence {
  readonly treeOwnerId: string
  readonly source: string
  readonly status: "partial"
  readonly stateSource: string
  readonly noSecondState: true
  readonly runtimeReferenceToSourceMirror: false
  readonly vscodeSourcePaths: readonly string[]
  readonly currentSourcePaths: readonly string[]
  readonly implementedOwners: readonly string[]
  readonly missingOwners: readonly string[]
  readonly widget: {
    readonly role: string
    readonly ariaLabel: string
    readonly tabIndex: number
    readonly rowCount: number
    readonly renderedRowCount: number
    readonly focusedUri: string
    readonly activeDescendant: string
    readonly isLastFocusedList: boolean
  }
  readonly blockedReason: string
}

export interface WorkbenchObjectTreeShellOwnerAdapter {
  readonly source: "codek.workbenchObjectTreeShellOwnerAdapter"
  readonly status: "partial"
  readonly shellSource: "explorer-workbench-object-tree+genericShellOwnerContract"
  readonly noSecondWorkbenchState: true
  readonly runtimeReference: false
  readonly treeOwnerId: string
  readonly treeOwnerStatus: "partial"
  readonly stateSource: string
  readonly vscodeEntrypoints: readonly string[]
  readonly codekSurfaces: readonly string[]
  readonly implementedOwners: readonly string[]
  readonly blockedOwners: readonly string[]
  readonly widget: WorkbenchObjectTreeOwnerEvidence["widget"]
  readonly lowConflictAdapterPossible: true
  readonly requiresAppVueOrGenericShellRewrite: false
  readonly blockedReason: string
}

export interface AccessibleViewTrueOwnerReadinessEvidence {
  readonly ownerId: "AccessibleView"
  readonly source: string
  readonly status: "blocked"
  readonly noSecondAccessibilityState: true
  readonly domShellReadinessStatus: "partial"
  readonly toolbarQuickPickFocusInvocationStatus: "blocked"
  readonly currentSourcePaths: readonly string[]
  readonly vscodeSourcePaths: readonly string[]
  readonly availableEvidence: readonly string[]
  readonly blockedOwners: readonly string[]
  readonly requiredTrueOwners: readonly string[]
  readonly blockedReason: string
}

export interface AccessibleViewTrueOwnerShellAdapter {
  readonly source: "codek.accessibleViewTrueOwnerShellAdapter"
  readonly status: "blocked"
  readonly shellSource: "accessibleViewService+genericShellOwnerContract"
  readonly noSecondWorkbenchState: true
  readonly noSecondAccessibilityState: true
  readonly runtimeReference: false
  readonly ownerId: "AccessibleView"
  readonly readiness: {
    readonly domShell: "partial"
    readonly toolbarQuickPickFocusInvocation: "blocked"
    readonly trueOwner: "blocked"
  }
  readonly vscodeEntrypoints: readonly string[]
  readonly codekSurfaces: readonly string[]
  readonly availableEvidence: readonly string[]
  readonly blockedOwners: readonly string[]
  readonly requiredTrueOwners: readonly string[]
  readonly lowConflictAdapterPossible: false
  readonly requiresAppVueOrGenericShellRewrite: true
  readonly blockedReason: string
}

const VSCODE_OWNER_ENTRYPOINTS = {
  viewPaneContainer: [
    "src/vs/workbench/browser/parts/views/viewPaneContainer.ts",
    "src/vs/workbench/browser/parts/views/viewPane.ts",
  ],
  editorPane: [
    "src/vs/workbench/browser/parts/editor/editorPane.ts",
    "src/vs/workbench/services/editor/browser/editorPaneService.ts",
    "src/vs/workbench/services/editor/common/editorPaneService.ts",
  ],
  list: [
    "src/vs/platform/list/browser/listService.ts",
    "src/vs/base/browser/ui/list/listWidget.ts",
    "src/vs/base/browser/ui/table/tableWidget.ts",
  ],
  accessibleView: [
    "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts",
    "src/vs/workbench/contrib/accessibility/browser/accessibleViewActions.ts",
  ],
} as const

const FOCUSED_VERIFICATION = [
  "npm run test -- src/workbench/genericShellOwnerContract.test.ts src/workbench/workbenchViewsSidebarPanelIntegration.test.ts",
  "npm run test -- src/testing/testingService.test.ts src/workbench/extensionTrustRemoteAuthWorkbench.test.ts src/accessibility/accessibleViewService.test.ts src/explorer/tree/ExplorerTreeHost.test.ts",
  "npm run typecheck",
  "npm run check:vscode-source-boundary",
  "git diff --check",
  "git diff --cached --name-status",
] as const

export function createGenericShellOwnerCapabilityMap(): readonly GenericShellOwnerCapability[] {
  return [
    {
      id: "viewPaneContainer",
      status: "partial",
      vscodeEntrypoints: VSCODE_OWNER_ENTRYPOINTS.viewPaneContainer,
      currentCodekSurfaces: [
        "frontend/vite-project/src/workbench/viewRegistry.ts",
        "frontend/vite-project/src/workbench/workbenchLayoutModel.ts",
        "frontend/vite-project/src/workbench/workbenchLayoutUiAdapter.ts",
        "frontend/vite-project/src/vscode-adapter/workbench/services/views/common/viewsService.ts",
      ],
      reusableLayer: [
        "View/container registry",
        "Pane-composite layout projection",
        "Activity/sidebar/panel UI model",
      ],
      missingOwners: [
        "ViewPaneContainer DOM lifecycle",
        "ViewPane header/body/action lifecycle",
        "generic pane focus/visibility owner",
      ],
      lowConflictAdapterPossible: true,
      requiresAppVueOrGenericShellRewrite: true,
      blockedReason: "ViewsService can open and project containers, but App.vue still owns the actual sidebar DOM branches.",
    },
    {
      id: "viewPane",
      status: "blocked",
      vscodeEntrypoints: VSCODE_OWNER_ENTRYPOINTS.viewPaneContainer,
      currentCodekSurfaces: [
        "frontend/vite-project/src/App.vue",
        "frontend/vite-project/src/components/Marketplace.vue",
        "frontend/vite-project/src/components/TaskWorkbenchPanel.vue",
      ],
      reusableLayer: [
        "Per-feature service projections",
        "View registry metadata",
      ],
      missingOwners: [
        "shared ViewPane class boundary",
        "generic view actions toolbar owner",
        "generic view content mount/dispose lifecycle",
      ],
      lowConflictAdapterPossible: false,
      requiresAppVueOrGenericShellRewrite: true,
      blockedReason: "Feature panes are mounted directly by App.vue or feature components, so a complete ViewPane owner needs shell extraction.",
    },
    {
      id: "editorPane",
      status: "partial",
      vscodeEntrypoints: VSCODE_OWNER_ENTRYPOINTS.editorPane,
      currentCodekSurfaces: [
        "frontend/vite-project/src/workbench/editorGroups.ts",
        "frontend/vite-project/src/vscode-adapter/workbench/services/editor/common/editorPartService.ts",
        "frontend/vite-project/src/App.vue",
      ],
      reusableLayer: [
        "Editor group/tab lifecycle model",
        "EditorPartService summary and actions",
        "WorkingCopy/TextFile lifecycle projection",
      ],
      missingOwners: [
        "EditorPane DOM lifecycle",
        "EditorPaneService registration/lookup owner",
        "generic editor focus/restore owner",
      ],
      lowConflictAdapterPossible: true,
      requiresAppVueOrGenericShellRewrite: true,
      blockedReason: "EditorPartService owns state transitions, but App.vue still renders and focuses the editor shell.",
    },
    {
      id: "objectTreeList",
      status: "partial",
      vscodeEntrypoints: VSCODE_OWNER_ENTRYPOINTS.list,
      currentCodekSurfaces: [
        "frontend/vite-project/src/vscode-adapter/platform/list/browser/listService.ts",
        "frontend/vite-project/src/explorer/tree/CodekListView.ts",
        "frontend/vite-project/src/explorer/tree/ExplorerTreeHost.ts",
      ],
      reusableLayer: [
        "IListService lastFocusedList registry",
        "Virtualized row rendering",
        "Explorer model-backed selection/focus",
        "ARIA active-descendant projection",
      ],
      missingOwners: [
        "scoped context-key/style registry",
        "generic WorkbenchObjectTree factory",
        "generic tree/list owner reusable outside Explorer",
      ],
      lowConflictAdapterPossible: true,
      requiresAppVueOrGenericShellRewrite: false,
      blockedReason: "Explorer now has a reusable IListService-style registry for its real list widget, but TestingObjectTree/SettingsTree still need a generic WorkbenchObjectTree factory and scoped context-key/style owners.",
    },
    {
      id: "workbenchTable",
      status: "blocked",
      vscodeEntrypoints: VSCODE_OWNER_ENTRYPOINTS.list,
      currentCodekSurfaces: [
        "frontend/vite-project/src/workbench/extensionTrustRemoteAuthWorkbench.ts",
        "frontend/vite-project/src/components/SettingsPanel.vue",
      ],
      reusableLayer: [
        "Feature-level table/list projections",
        "WorkspaceTrust trusted URI row model evidence",
      ],
      missingOwners: [
        "WorkbenchTable wrapper",
        "IListService-backed table focus/style owner",
        "shared table renderer lifecycle",
      ],
      lowConflictAdapterPossible: true,
      requiresAppVueOrGenericShellRewrite: true,
      blockedReason: "A low-conflict blocked adapter can record the feature row-model handoff, but current table-like surfaces are not a shared WorkbenchTable widget owner.",
    },
    {
      id: "accessibleView",
      status: "blocked",
      vscodeEntrypoints: VSCODE_OWNER_ENTRYPOINTS.accessibleView,
      currentCodekSurfaces: [
        "frontend/vite-project/src/accessibility/accessibleViewService.ts",
        "frontend/vite-project/src/App.vue",
        "frontend/vite-project/src/workbench/quickInput.ts",
      ],
      reusableLayer: [
        "AccessibleView service contract projection",
        "command/menu/context-key registrations",
        "readonly DOM shell evidence",
        "generic quick input infrastructure",
      ],
      missingOwners: [
        "CodeEditorWidget-backed content owner",
        "IContextViewService/ILayoutService placement owner",
        "WorkbenchToolBar + MenuId.AccessibleView owner",
        "IQuickInputService.createQuickPick symbol owner",
        "IEditorService/CodeEditorWidget.focus invocation owner",
      ],
      lowConflictAdapterPossible: false,
      requiresAppVueOrGenericShellRewrite: true,
      blockedReason: "AccessibleView projections correctly expose missing owners; completing them requires real workbench/editor shell owners.",
    },
    {
      id: "appShell",
      status: "blocked",
      vscodeEntrypoints: [
        "src/vs/workbench/browser/layout.ts",
        "src/vs/workbench/services/layout/browser/layoutService.ts",
      ],
      currentCodekSurfaces: [
        "frontend/vite-project/src/App.vue",
        "frontend/vite-project/src/workbench/workbenchLayoutUiAdapter.ts",
        "frontend/vite-project/src/vscode-adapter/workbench/services/layout/browser/layoutService.ts",
      ],
      reusableLayer: [
        "WorkbenchLayoutService shell projection",
        "WorkbenchLayoutUiAdapter UI model",
      ],
      missingOwners: [
        "generic shell mount slots for ViewPane/EditorPane/List/Table/AccessibleView",
        "single DOM owner for activity/sidebar/editor/panel part lifecycle",
        "cross-owner focus restoration",
      ],
      lowConflictAdapterPossible: true,
      requiresAppVueOrGenericShellRewrite: true,
      blockedReason: "A contract adapter can map capabilities, but complete ownership requires a coordinated App.vue/generic shell extraction.",
    },
  ]
}

export function createGenericShellOwnerProjection(): GenericShellOwnerProjection {
  return {
    source: "codek.genericShellOwnerContract",
    status: "blocked",
    noSecondWorkbenchState: true,
    runtimeReferenceToSourceMirror: false,
    capabilityMap: createGenericShellOwnerCapabilityMap(),
    adapterPlan: createGenericShellOwnerAdapterPlan(),
    nextOwnerThreads: createGenericShellOwnerThreadPlan(),
  }
}

export function createViewPaneShellOwnerAdapter(input: ViewPaneShellOwnerAdapterInput): ViewPaneShellOwnerAdapter {
  const openedContainers = input.opened.map((result) => ({
    opened: result.opened,
    containerId: result.containerId,
    viewId: result.viewId,
    location: result.location || null,
    activeSidebarView: result.activeSidebarView,
    visiblePaneCompositeIds: [...(result.visiblePaneCompositeIds || [])],
  }))
  const openedContainerIds = Array.from(new Set(openedContainers
    .map((result) => result.containerId)
    .filter((containerId): containerId is string => Boolean(containerId))))

  return {
    source: "codek.viewPaneShellOwnerAdapter",
    status: "partial",
    shellSource: "viewRegistry+ViewsService+workbenchLayoutService",
    noSecondWorkbenchState: true,
    runtimeReferenceToSourceMirror: false,
    vscodeEntrypoints: [
      "src/vs/workbench/services/views/common/viewsService.ts",
      "src/vs/workbench/services/views/browser/viewsService.ts",
      "src/vs/workbench/browser/panecomposite.ts",
      "src/vs/workbench/browser/parts/views/viewPaneContainer.ts",
      "src/vs/workbench/browser/parts/views/viewPane.ts",
    ],
    codekSurfaces: [
      "frontend/vite-project/src/workbench/viewRegistry.ts",
      "frontend/vite-project/src/vscode-adapter/workbench/services/views/common/viewsService.ts",
      "frontend/vite-project/src/vscode-adapter/workbench/services/layout/browser/layoutService.ts",
      "frontend/vite-project/src/workbench/workbenchLayoutUiAdapter.ts",
    ],
    implementedOwners: [
      "View/container registry",
      "ViewsService openView/openViewContainer routing",
      "PaneComposite layout lifecycle projection",
      "shared WorkbenchLayoutService state source",
    ],
    blockedOwners: [
      "IPaneComposite instance returned from ViewsService.openViewContainer",
      "IViewPaneContainer.getView/openView instance lifecycle",
      "ViewPane renderBody/layoutBody/focus DOM owner",
      "generic App.vue shell slot for registered ViewPane descriptors",
    ],
    openedContainers,
    openedContainerIds,
    activePaneComposites: { ...input.projection.shell.active.paneComposites },
    visiblePaneCompositeIds: {
      sideBar: [...input.projection.shell.paneComposite.visibleIds.sideBar],
      panel: [...input.projection.shell.paneComposite.visibleIds.panel],
      auxiliaryBar: [...input.projection.shell.paneComposite.visibleIds.auxiliaryBar],
    },
    blockedReason: "Codek can route registered containers through ViewsService and WorkbenchLayoutService without a second state source, but real ViewPaneContainer/ViewPane ownership still requires a generic App.vue workbench shell slot.",
  }
}

export function createWorkbenchTableShellOwnerAdapter(input: WorkbenchTableRowModelEvidence): WorkbenchTableShellOwnerAdapter {
  return {
    source: "codek.workbenchTableShellOwnerAdapter",
    status: "blocked",
    shellSource: "feature-row-model+genericShellOwnerContract",
    noSecondWorkbenchState: true,
    runtimeReference: false,
    tableOwnerId: input.tableOwnerId,
    rowModelStatus: input.status,
    vscodeEntrypoints: [
      "src/vs/platform/list/browser/listService.ts",
      "src/vs/base/browser/ui/table/table.ts",
      "src/vs/base/browser/ui/table/tableWidget.ts",
    ],
    codekSurfaces: [...input.currentSourcePaths],
    implementedOwners: [
      `${input.sourceClass} row model`,
      input.tableUpdateSignal,
      "feature service state source",
    ],
    blockedOwners: [
      "WorkbenchTable widget construction",
      "TableListRenderer cell template lifecycle",
      "IListService focus/style/context-key registration",
      "Table.domFocus/layout/dispose owner",
      "storage-backed table column state",
      ...input.missingOwners,
      ...input.blockedSignals,
    ],
    rowModel: {
      sourceClass: input.sourceClass,
      stateSource: input.stateSource,
      tableUpdateSignal: input.tableUpdateSignal,
      rowCount: input.rowCount,
      eventCount: input.eventCount,
    },
    lowConflictAdapterPossible: true,
    requiresAppVueOrGenericShellRewrite: true,
    blockedReason: "Codek can attach feature row-model evidence to a shared WorkbenchTable shell contract without a second state source, but full VS Code WorkbenchTable ownership requires the table widget, column renderers, ListService focus/context-key registration, layout, and dispose lifecycle outside this boundary.",
  }
}

export function createWorkbenchObjectTreeShellOwnerAdapter(input: WorkbenchObjectTreeOwnerEvidence): WorkbenchObjectTreeShellOwnerAdapter {
  return {
    source: "codek.workbenchObjectTreeShellOwnerAdapter",
    status: "partial",
    shellSource: "explorer-workbench-object-tree+genericShellOwnerContract",
    noSecondWorkbenchState: true,
    runtimeReference: false,
    treeOwnerId: input.treeOwnerId,
    treeOwnerStatus: input.status,
    stateSource: input.stateSource,
    vscodeEntrypoints: [...input.vscodeSourcePaths],
    codekSurfaces: [...input.currentSourcePaths],
    implementedOwners: [...input.implementedOwners],
    blockedOwners: [
      "generic WorkbenchObjectTree factory outside Explorer",
      "scoped list/tree context-key owner",
      "configuration-backed list style/type-navigation owner",
      ...input.missingOwners,
    ],
    widget: { ...input.widget },
    lowConflictAdapterPossible: true,
    requiresAppVueOrGenericShellRewrite: false,
    blockedReason: `Explorer exposes a real IListService-backed list widget and model-backed tree projection without a second state source, but ${input.treeOwnerId} remains partial until the generic WorkbenchObjectTree factory and scoped list/tree owners exist. ${input.blockedReason}`,
  }
}

export function createAccessibleViewTrueOwnerShellAdapter(input: AccessibleViewTrueOwnerReadinessEvidence): AccessibleViewTrueOwnerShellAdapter {
  return {
    source: "codek.accessibleViewTrueOwnerShellAdapter",
    status: "blocked",
    shellSource: "accessibleViewService+genericShellOwnerContract",
    noSecondWorkbenchState: true,
    noSecondAccessibilityState: true,
    runtimeReference: false,
    ownerId: input.ownerId,
    readiness: {
      domShell: input.domShellReadinessStatus,
      toolbarQuickPickFocusInvocation: input.toolbarQuickPickFocusInvocationStatus,
      trueOwner: input.status,
    },
    vscodeEntrypoints: [...input.vscodeSourcePaths],
    codekSurfaces: [...input.currentSourcePaths],
    availableEvidence: [...input.availableEvidence],
    blockedOwners: [
      "CodeEditorWidget-backed AccessibleView content owner",
      "IContextViewService/ILayoutService context view owner",
      "WorkbenchToolBar + MenuId.AccessibleView render owner",
      "IQuickInputService.createQuickPick AccessibleViewSymbolQuickPick owner",
      "IEditorService/CodeEditorWidget.focus invocation owner",
      ...input.blockedOwners,
    ],
    requiredTrueOwners: [...input.requiredTrueOwners],
    lowConflictAdapterPossible: false,
    requiresAppVueOrGenericShellRewrite: true,
    blockedReason: `AccessibleView DOM/readiness evidence stays service-backed and partial; full owner parity is blocked until one workbench/editor lifecycle owns content, placement, toolbar, symbol quick pick, and focus restore. ${input.blockedReason}`,
  }
}

export function createGenericShellOwnerAdapterPlan(): GenericShellOwnerAdapterPlan {
  return {
    source: "codek.genericShellOwnerContract",
    status: "blocked",
    noSecondWorkbenchState: true,
    runtimeReferenceToSourceMirror: false,
    currentAdapter: {
      kind: "capability-map+blocked-owner-adapters",
      files: [
        "frontend/vite-project/src/workbench/genericShellOwnerContract.ts",
        "frontend/vite-project/src/workbench/genericShellOwnerContract.test.ts",
        "frontend/vite-project/src/explorer/tree/ExplorerTreeHost.ts",
        "frontend/vite-project/src/explorer/tree/ExplorerTreeHost.test.ts",
        "frontend/vite-project/src/accessibility/accessibleViewService.ts",
        "frontend/vite-project/src/accessibility/accessibleViewService.test.ts",
        "frontend/vite-project/src/workbench/extensionTrustRemoteAuthWorkbench.ts",
        "frontend/vite-project/src/workbench/extensionTrustRemoteAuthWorkbench.test.ts",
      ],
      reason: "These adapters record owner capability evidence, Explorer WorkbenchObjectTree partial ownership, AccessibleView true-owner readiness gaps, and blocked WorkbenchTable row-model handoffs without changing central App.vue shell ownership.",
    },
    minimumSafeAdapter: {
      kind: "generic-shell-owner-contract",
      files: [
        "frontend/vite-project/src/workbench/workbenchLayoutUiAdapter.ts",
        "frontend/vite-project/src/vscode-adapter/workbench/services/views/common/viewsService.ts",
        "frontend/vite-project/src/vscode-adapter/workbench/services/editor/common/editorPartService.ts",
        "frontend/vite-project/src/vscode-adapter/platform/list/browser/listService.ts",
        "frontend/vite-project/src/explorer/tree/CodekListView.ts",
        "frontend/vite-project/src/explorer/tree/ExplorerTreeHost.ts",
        "frontend/vite-project/src/accessibility/accessibleViewService.ts",
      ],
      verifies: FOCUSED_VERIFICATION,
    },
    blockedImplementation: {
      owner: "Generic Workbench Shell / App.vue",
      reason: "Full owner parity crosses the central shell DOM and must be split into dedicated owner threads before editing App.vue broadly.",
      mustNotFakeWith: [
        "smoke DOM selectors",
        "service-level evidence only",
        "feature-local component state",
      ],
    },
  }
}

export function createGenericShellOwnerThreadPlan(): readonly GenericShellOwnerThreadPlan[] {
  return [
    {
      owner: "viewPaneContainer",
      threadName: "ViewPaneContainer/ViewPane shell owner",
      files: [
        "frontend/vite-project/src/workbench/viewRegistry.ts",
        "frontend/vite-project/src/workbench/workbenchLayoutUiAdapter.ts",
        "frontend/vite-project/src/vscode-adapter/workbench/services/views/common/viewsService.ts",
        "frontend/vite-project/src/App.vue",
      ],
      acceptance: [
        "workbench view container opens through ViewsService",
        "shared ViewPane mount/dispose/action lifecycle exists",
        "feature panes no longer mount as unrelated App.vue branches",
      ],
    },
    {
      owner: "editorPane",
      threadName: "EditorPane/EditorPaneService owner",
      files: [
        "frontend/vite-project/src/workbench/editorGroups.ts",
        "frontend/vite-project/src/vscode-adapter/workbench/services/editor/common/editorPartService.ts",
        "frontend/vite-project/src/App.vue",
      ],
      acceptance: [
        "EditorPane registration/focus/restore owner exists",
        "active editor state still comes from editorGroups/TextFile/WorkingCopy",
        "AccessibleView focus restore can target the editor owner",
      ],
    },
    {
      owner: "objectTreeList",
      threadName: "IListService/WorkbenchObjectTree owner",
      files: [
        "frontend/vite-project/src/explorer/tree/CodekListView.ts",
        "frontend/vite-project/src/explorer/tree/ExplorerTreeHost.ts",
        "frontend/vite-project/src/vscode-adapter/platform/list/browser/listService.ts",
      ],
      acceptance: [
        "ExplorerTreeHost remains model-backed",
        "generic ListService owner handles keyboard/style/focus contracts",
        "other workbench trees can reuse the same owner",
      ],
    },
    {
      owner: "workbenchTable",
      threadName: "WorkbenchTable/ListService owner",
      files: [
        "frontend/vite-project/src/workbench/genericShellOwnerContract.ts",
        "frontend/vite-project/src/workbench/extensionTrustRemoteAuthWorkbench.ts",
        "frontend/vite-project/src/App.vue",
      ],
      acceptance: [
        "WorkspaceTrust trusted URI rows are rendered through a shared WorkbenchTable wrapper",
        "column renderers, focus, layout, and dispose are owned by the table shell",
        "feature row-model evidence is not used as a substitute for the DOM/widget owner",
      ],
    },
    {
      owner: "accessibleView",
      threadName: "AccessibleView true workbench/editor owner",
      files: [
        "frontend/vite-project/src/accessibility/accessibleViewService.ts",
        "frontend/vite-project/src/workbench/quickInput.ts",
        "frontend/vite-project/src/App.vue",
      ],
      acceptance: [
        "AccessibleView content is CodeEditorWidget-backed or equivalent",
        "toolbar uses WorkbenchToolBar/MenuId.AccessibleView owner",
        "go-to-symbol quick pick and focus restore are true owners, not projections",
      ],
    },
  ]
}
