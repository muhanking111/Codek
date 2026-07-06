import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import { Emitter, type Event } from "../vscode-adapter/base/common/event"
import { registerCommand } from "../workbench/commandRegistry"
import type { ContextKeyState } from "../workbench/contextKeys"
import { registerView, registerViewContainer } from "../workbench/viewRegistry"
import type { IDisposable } from "../vscode-adapter/base/common/lifecycle"

export type TestRunProfileGroup = "run" | "debug" | "coverage"
export type TestResultState = "queued" | "running" | "passed" | "failed" | "skipped" | "errored"
export type TestItemExpandState = "notExpandable" | "expandable" | "busyExpanding" | "expanded"

export interface TestControllerSnapshot {
  id: string
  label: string
}

export interface TestRunProfileSnapshot {
  controllerId: string
  profileId: number
  label: string
  group: TestRunProfileGroup
  isDefault: boolean
  tag?: string
  configureCommandId?: string
  supportsContinuousRun?: boolean
}

export interface TestResultSnapshot {
  id: string
  controllerId: string
  testId: string
  label: string
  state: TestResultState
  durationMs: number | null
  messages: string[]
  profileId?: number
  retired?: boolean
}

export interface TestItemSnapshot {
  controllerId: string
  id: string
  label: string
  parentId?: string
  uri?: string
  range?: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
  tags?: string[]
  busy?: boolean
  expand: TestItemExpandState
  description?: string
  error?: string
  sortText?: string
}

export interface TestItemProjection extends TestItemSnapshot {
  childrenIds: string[]
  depth: number
}

export interface TestRunRequestSnapshot {
  id: string
  controllerId: string
  profileId?: number
  group: TestRunProfileGroup
  testIds: string[]
  excludeIds?: string[]
  label?: string
  continuous?: boolean
}

export interface TestOutputMessageSnapshot {
  message: string
  offset: number
  length: number
  testId?: string
  locationUri?: string
}

export interface TestRunSnapshot extends TestRunRequestSnapshot {
  label: string
  state: TestResultState
  startedAt: number
  completedAt?: number
  output: TestOutputMessageSnapshot[]
  tasks: TestRunTaskSnapshot[]
}

export interface TestRunTaskSnapshot {
  id: string
  controllerId: string
  name: string
  running: boolean
  startedAt: number
  completedAt?: number
}

export interface PublishedTestResultSnapshot {
  id: string
  controllerId: string
  label: string
  startedAt: number
  completedAt: number
  state: TestResultState
  summary: TestRunSummary
  tests: TestResultSnapshot[]
  tasks: TestRunTaskSnapshot[]
  output: TestOutputMessageSnapshot[]
  source: "TestingService.completeRun()"
  vscodeSourcePath: "src/vs/workbench/api/browser/mainThreadTesting.ts"
  noSecondState: true
}

export interface TestCoverageFileSnapshot {
  id: string
  uri: string
  statement: {
    covered: number
    total: number
  }
  branch?: {
    covered: number
    total: number
  }
  declaration?: {
    covered: number
    total: number
  }
  testIds?: string[]
}

export interface TestCoverageProjection {
  status: "notAvailable" | "placeholder" | "available"
  reason?: string
  files: TestCoverageFileSnapshot[]
}

export interface TestResultPeekEntrySnapshot {
  id: string
  runId: string
  testId: string
  label: string
  state: TestResultState
  retired: boolean
  durationMs: number | null
  messages: string[]
  output: TestOutputMessageSnapshot[]
  locationUri?: string
  canCancel: boolean
  commandIds: TestingCommandId[]
  evidenceUri: string
}

export interface TestResultPeekProjection {
  status: "notAvailable" | "available"
  reason?: string
  latestRunId?: string
  entries: TestResultPeekEntrySnapshot[]
  adapter: {
    codekOwner: "TestingService.getResultPeekProjection()"
    vscodeSourcePaths: string[]
    blockedOwners: string[]
    noSecondState: true
  }
}

export interface TestingOpenResultPeekPayload {
  runId?: string
  testId?: string
  entryId?: string
}

export interface TestResultPeekOpenDescriptor {
  status: "notAvailable" | "ready"
  reason?: string
  commandId: TestingPeekCommandId
  targetUri?: string
  selectedEntry?: TestResultPeekEntrySnapshot
  projection: TestResultPeekProjection
  shellAdapter: {
    kind: "result-peek-shell-adapter"
    codekOwner: "TestingService.openResultPeek()"
    vscodeSourcePaths: string[]
    blockedOwners: string[]
    preservesAgentEvidence: true
    noSecondState: true
  }
}

export interface TestResultHistoryRunSnapshot {
  id: string
  controllerId: string
  label: string
  state: TestResultState
  group: TestRunProfileGroup
  profileId?: number
  continuous: boolean
  startedAt: number
  completedAt?: number
  testIds: string[]
  outputMessageCount: number
  resultIds: string[]
  summary: TestRunSummary
}

export interface TestResultServiceHistoryProjection {
  status: "notAvailable" | "available"
  reason?: string
  stateSource: "TestingService runs/results/output"
  vscodeSourcePaths: string[]
  retainedRunCount: number
  retainedResultCount: number
  hasAnyResults: boolean
  isRunning: boolean
  runs: TestResultHistoryRunSnapshot[]
  adapter: {
    kind: "test-result-service-history-projection"
    codekOwner: "TestingService.getResultHistoryProjection()"
    implementedOwners: string[]
    blockedOwners: string[]
    noSecondState: true
  }
}

export type TestResultServiceChangeEvent =
  | { completed: PublishedTestResultSnapshot }
  | { inserted: TestResultSnapshot }
  | { removed: TestResultSnapshot[] }

export interface TestResultServiceItemChangeEvent {
  result: TestResultSnapshot
  reason: "computedStateChange" | "newMessage" | "retired"
}

export interface TestResultServiceStorageProjection {
  status: "available" | "notAvailable"
  stateSource: "TestingService runs/results/output"
  storageKey: "storedTestResults"
  retainedResultIds: string[]
  serializedResults: PublishedTestResultSnapshot[]
  fileBackedOwnerMatrix: TestingOwnerGapMatrixEntry[]
  adapter: {
    kind: "test-result-storage-projection"
    codekOwner: "TestingService.getResultStorageProjection()"
    vscodeSourcePaths: string[]
    implementedOwners: string[]
    blockedOwners: string[]
    noSecondState: true
  }
  noSecondState: true
}

export interface TestResultsViewPaneShellRowProjection {
  id: string
  role: "treeitem"
  kind: "run" | "test"
  label: string
  depth: number
  state: TestResultState
  runId?: string
  testId?: string
  resultIds: string[]
  messageCount: number
  outputMessageCount: number
  locationUri?: string
  commandIds: TestingCommandId[]
  evidenceUri: string
}

export interface TestResultsViewPaneShellProjection {
  status: "notAvailable" | "available"
  reason?: string
  containerId: typeof TESTING_VIEW_IDS.ResultsContainer
  viewId: typeof TESTING_VIEW_IDS.Results
  stateSource: "TestingService.getResultHistoryProjection()+getResultPeekProjection()"
  runCount: number
  resultCount: number
  treeRowCount: number
  selectedRunId?: string
  selectedEntryId?: string
  rows: TestResultsViewPaneShellRowProjection[]
  commandIds: TestingCommandId[]
  domOwnerMatrix: TestingOwnerGapMatrixEntry[]
  adapter: {
    kind: "test-results-viewpane-shell"
    codekOwner: "App.vue:data-codek-smoke=\"testing-results-viewpane-shell-owner\""
    vscodeSourcePaths: string[]
    implementedOwners: string[]
    blockedOwners: string[]
    noSecondState: true
  }
  noSecondState: true
}

export interface TestCoverageTreeNodeSnapshot {
  id: string
  uri: string
  label: string
  statementPercent: number | null
  branchPercent: number | null
  declarationPercent: number | null
  statement: TestCoverageFileSnapshot["statement"]
  branch?: TestCoverageFileSnapshot["branch"]
  declaration?: TestCoverageFileSnapshot["declaration"]
  testIds: string[]
  detailsAvailable: boolean
  commandIds: TestingCommandId[]
  evidenceUri: string
}

export interface TestCoverageTreeProjection {
  status: TestCoverageProjection["status"]
  reason?: string
  nodes: TestCoverageTreeNodeSnapshot[]
  adapter: {
    codekOwner: "TestingService.getCoverageTreeProjection()"
    vscodeSourcePaths: string[]
    blockedOwners: string[]
    noSecondState: true
  }
}

export type TestCoverageSortOrder = "location" | "coverage" | "name"

export interface TestCoverageViewProjection {
  status: TestCoverageProjection["status"]
  reason?: string
  selectedCoverageId?: string
  filteredToTestId?: string
  showInline: boolean
  sortOrder: TestCoverageSortOrder
  nodes: TestCoverageTreeNodeSnapshot[]
  commandIds: TestingCommandId[]
  shellAdapter: {
    kind: "coverage-view-shell-adapter"
    codekOwner: "TestingService.getCoverageViewProjection()"
    vscodeSourcePaths: string[]
    implementedOwners: string[]
    blockedOwners: string[]
    noSecondState: true
  }
}

export interface TestCoverageEditorDecorationSnapshot {
  id: string
  uri: string
  label: string
  statementPercent: number | null
  branchPercent: number | null
  declarationPercent: number | null
  testIds: string[]
  filteredToTestId?: string
  showInline: boolean
  hasPerTestCoverage: boolean
  commandIds: TestingCommandId[]
  evidenceUri: string
}

export interface TestCoverageEditorRangeModelShell {
  kind: "coverage-details-range-model-shell"
  stateSource: "TestingService.getCoverageEditorDecorationsProjection()"
  coverageId: string
  uri: string
  lineRangeHint: {
    startLineNumber: number
    endLineNumber: number
  }
  detailAccessorCommandId: typeof TESTING_CALLBACK_COMMAND_IDS.CoverageDetails
  minimap: {
    projected: boolean
    blockedOwner: "ITextModel.deltaDecorations/MinimapPosition"
  }
  injectedText: {
    projected: boolean
    blockedOwner: "InjectedTextOptions"
  }
  overlayToolbar: {
    projected: boolean
    blockedOwner: "CoverageToolbarWidget"
  }
  blockedReason: string
  noSecondState: true
}

export interface TestCoverageGenericEditorShellContract {
  status: "blocked"
  stateSource: "TestingService.getCoverageEditorDecorationsProjection()"
  vscodeSourcePaths: string[]
  requiredEditorApis: string[]
  requiredTextModelApis: string[]
  expectedAdapterMethods: string[]
  wiringPrerequisites: string[]
  blockedReason: string
  noSecondState: true
}

export interface TestCoverageEditorDecorationsProjection {
  status: "notAvailable" | "available"
  reason?: string
  uri?: string
  selectedCoverageId?: string
  decoration?: TestCoverageEditorDecorationSnapshot
  rangeModelShell?: TestCoverageEditorRangeModelShell
  genericEditorShellContract: TestCoverageGenericEditorShellContract
  adapter: {
    kind: "coverage-editor-decoration-projection"
    codekOwner: "TestingService.getCoverageEditorDecorationsProjection()"
    vscodeSourcePaths: string[]
    implementedOwners: string[]
    blockedOwners: string[]
    noSecondState: true
  }
}

export interface TestCoverageRendererShellRowSnapshot extends TestCoverageTreeNodeSnapshot {
  role: "treeitem"
  selected: boolean
  ariaLabel: string
}

export interface TestCoverageRendererShellProjection {
  status: TestCoverageViewProjection["status"]
  reason?: string
  containerId: typeof TESTING_VIEW_IDS.Container
  viewId: typeof TESTING_VIEW_IDS.Coverage
  stateSource: "TestingService.getCoverageViewProjection()"
  selectedCoverageId?: string
  filteredToTestId?: string
  showInline: boolean
  sortOrder: TestCoverageSortOrder
  nodeCount: number
  rows: TestCoverageRendererShellRowSnapshot[]
  commandIds: TestingCommandId[]
  adapter: {
    kind: "coverage-renderer-shell"
    codekOwner: "App.vue:data-agent-evidence-surface=\"testing\""
    vscodeSourcePaths: string[]
    implementedOwners: string[]
    blockedOwners: string[]
    noSecondState: true
  }
}

export interface TestCoverageEditorContributionShellProjection {
  status: TestCoverageEditorDecorationsProjection["status"]
  reason?: string
  contributionId: "editor.contrib.coverageDecorations"
  stateSource: "TestingService.getCoverageEditorDecorationsProjection()"
  uri?: string
  selectedCoverageId?: string
  decoration?: TestCoverageEditorDecorationSnapshot
  rangeModelShell?: TestCoverageEditorRangeModelShell
  genericEditorShellContract: TestCoverageGenericEditorShellContract
  commandIds: TestingCommandId[]
  adapter: {
    kind: "coverage-editor-contribution-shell"
    codekOwner: "TestingService.getCoverageEditorContributionShellProjection()"
    vscodeSourcePaths: string[]
    implementedOwners: string[]
    blockedOwners: string[]
    noSecondState: true
  }
}

export interface TestCoverageOwnerFeasibilityAudit {
  status: TestingUiCapabilityStatus
  codekStateSource: "TestingService coverage projections"
  vscodeSourcePaths: string[]
  viewOwner: {
    status: TestingUiCapabilityStatus
    evidenceFrom: "TestingService.getCoverageRendererShellProjection()"
    implementedOwners: string[]
    blockedOwners: string[]
    requiredOwners: string[]
  }
  viewPaneOwnerContract: {
    status: TestingUiCapabilityStatus
    stateSource: "TestingService.getCoverageViewProjection()"
    codekCanProvide: string[]
    vscodeRequiredOwners: string[]
    blockedReason: string
  }
  editorContributionOwner: {
    status: TestingUiCapabilityStatus
    evidenceFrom: "TestingService.getCoverageEditorContributionShellProjection()"
    implementedOwners: string[]
    blockedOwners: string[]
    requiredOwners: string[]
    genericEditorShellContract: TestCoverageGenericEditorShellContract
  }
  fullOwnerMigration: {
    canClaimFullOwner: false
    viewPaneOwnerReady: false
    editorContributionOwnerReady: false
    blockedReason: string
  }
  remainingBlockers: string[]
  noSecondState: true
}

export interface TestRunActionDescriptor {
  commandId: TestingRunCommandId
  label: string
  controllerId?: string
  profileId?: number
  group: TestRunProfileGroup
  testIds: string[]
  enabled: boolean
  safeToExecute: boolean
  approvalRequired: boolean
  mutatesWorkspace: boolean
  mutatesGitIndex: boolean
  evidenceUri?: string
  reason?: string
}

export interface TestRunSummary {
  total: number
  passed: number
  failed: number
  running: number
  skipped: number
  errored: number
  state: TestResultState | "unknown"
}

export interface TestingContinuousContextKeyItemProjection {
  testId: string
  controllerId: string
  supportsContinuousRun: boolean
  isContinuousModeOn: boolean
  isParentRunningContinuously: boolean
  contextKeyState: ContextKeyState
}

export interface TestingContinuousContextKeyProjection {
  stateSource: "TestingService profiles+runs+items"
  vscodeSourcePaths: string[]
  serviceLevelKeys: ContextKeyState
  itemContextKeys: TestingContinuousContextKeyItemProjection[]
  implementedKeys: string[]
  menuOverlayBlockedKeys: string[]
  blockedKeys: string[]
  blockedReason: string
  noSecondState: true
}

export interface TestingContinuousRunRequest {
  controllerId?: string
  profileId?: number
  group?: TestRunProfileGroup
  testId?: string
}

export interface TestingRunCommandPayload {
  controllerId?: string
  profileId?: number
  group?: TestRunProfileGroup
  testId?: string
  testIds?: string[]
}

export interface TestingContinuousRunToggleResult {
  action: "started" | "stopped" | "blocked"
  reason?: string
  run?: TestRunSnapshot
  stoppedRuns: TestRunSnapshot[]
  contextKeys: TestingContinuousContextKeyProjection
  noSecondState: true
}

export interface TestingExplorerPersistedStateInput {
  expandedIds?: string[]
  selectedId?: string
  revealId?: string
  viewMode?: "tree" | "list"
  sorting?: "location" | "status" | "duration"
  filterText?: string
}

export interface TestingExplorerContractRowProjection {
  id: string
  controllerId: string
  label: string
  uri?: string
  parentId?: string
  depth: number
  prefixPath: string[]
  parentChain: string[]
  childIds: string[]
  expand: TestItemExpandState
  revealState: "none" | "ancestor" | "target"
  retired: boolean
  isRunningContinuously: boolean
  isParentRunningContinuously: boolean
  commandIds: TestingCommandId[]
  evidenceUri: string
}

export interface TestingOwnerEvidenceProjection {
  status: "partial"
  stateSource: "TestingService controllers/profiles/items/runs/results/output"
  vscodeSourcePaths: string[]
  testServiceOwner: {
    status: "partial"
    codekOwner: "TestingService"
    source: "TestingService controllers/profiles/items/runs/results/output"
    serviceIds: string[]
    implementedEvidence: string[]
    blockedOwners: string[]
    noSecondState: true
  }
  testControllerOwner: {
    status: "projected"
    codekOwner: "TestingService controllers/profiles/items"
    source: "MainThreadTesting controller/profile/item events -> TestingService"
    controllerIds: string[]
    profileIdsByController: Record<string, number[]>
    itemCountByController: Record<string, number>
    noSecondState: true
  }
  testExplorerOwner: {
    status: "partial"
    codekOwner: "TestingService.getTestingExplorerContractProjection()"
    source: "TestingService rows + commandRegistry action descriptors"
    visibleRowIds: string[]
    blockedOwners: string[]
    noSecondState: true
  }
  resultOwner: {
    status: "projected"
    codekOwner: "TestingService runs/results/output"
    source: "TestingService.startRun()/updateRunItemState()/completeRun()"
    retainedRunCount: number
    retainedResultCount: number
    runningRunIds: string[]
    completedRunIds: string[]
    noSecondState: true
  }
  runProfileOwner: {
    status: "projected"
    codekOwner: "TestingService profiles"
    source: "TestingService.addProfile()/updateProfile()"
    profileIdsByController: Record<string, number[]>
    defaultProfileIdsByControllerAndGroup: Record<string, Partial<Record<TestRunProfileGroup, number[]>>>
    noSecondState: true
  }
  testItemSource: {
    status: "projected"
    source: "TestingService.upsertItem()"
    rowCount: number
    rootIds: string[]
    sampleEvidenceUris: string[]
    noSecondState: true
  }
  remainingUiOwnerGap: {
    status: "blocked"
    blockedOwners: string[]
    blockedReason: string
    noSecondState: true
  }
  noSecondState: true
}

export interface TestingExplorerContractProjection {
  status: "partial"
  stateSource: "TestingService.getProjection().items/runs/profiles"
  vscodeSourcePaths: string[]
  ownerEvidence: TestingOwnerEvidenceProjection
  controllerOwner: {
    status: "projected"
    codekOwner: "TestingService controllers/profiles/items"
    vscodeSourcePath: "src/vs/workbench/api/browser/mainThreadTesting.ts"
    controllerIds: string[]
    profileIdsByController: Record<string, number[]>
    itemCountByController: Record<string, number>
    implementedEvidence: string[]
    blockedOwners: string[]
    noSecondState: true
  }
  rows: TestingExplorerContractRowProjection[]
  actionOwner: {
    status: "partial"
    codekOwner: "TestingService.createRunAction()+commandRegistry"
    vscodeSourcePaths: string[]
    actions: TestRunActionDescriptor[]
    commandExecution: {
      commandId: TestingRunCommandId
      status: "registered-command-facade" | "blocked"
      evidence: string
    }[]
    blockedOwners: string[]
    noSecondState: true
  }
  persistedState: {
    status: "projected"
    source: "external TestingExplorerView persistedState input"
    expandedIds: string[]
    selectedId?: string
    revealId?: string
    viewMode: "tree" | "list"
    sorting: "location" | "status" | "duration"
    blockedOwner: "IStorageService/StoredValue owned by VS Code TestingExplorerView"
  }
  viewModelAdapter: {
    status: "partial"
    codekOwner: "TestingService.getTestingExplorerContractProjection()"
    stateSource: "TestingService items/runs/profiles + persistedState input"
    vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts#TestingExplorerViewModel"
    projectionKind: "TreeProjection" | "ListProjection"
    viewMode: "tree" | "list"
    sorting: "location" | "status" | "duration"
    welcomeExperience: "none" | "workspace" | "document"
    hasPendingReveal: boolean
    revealId?: string
    selectedId?: string
    appliedRowIds: string[]
    implementedEvidence: string[]
    blockedOwners: string[]
    noSecondState: true
  }
  objectTreeAdapter: {
    status: "partial"
    codekOwner: "TestingService.getTestingExplorerContractProjection()"
    stateSource: "TestingService item parent/child links"
    vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/explorerProjections/testingObjectTree.ts"
    identityProvider: "TestingObjectTree element.treeId -> TestingService row.id"
    optimizedViewState: TestingExplorerOptimizedViewState
    visibleRowIds: string[]
    focusedRowId?: string
    selectedRowId?: string
    implementedEvidence: string[]
    blockedOwners: string[]
    noSecondState: true
  }
  filterActionAdapter: {
    status: "partial"
    codekOwner: "TestingService.getContinuousContextKeyProjection()+TestingService.createRunAction()"
    stateSource: "TestingService profiles/runs/items"
    vscodeSourcePaths: string[]
    filterTerms: {
      currentDoc: "blocked-dom-owner"
      openedFiles: "blocked-editor-owner"
      hidden: "projected"
      failed: "projected"
      executed: "projected"
      text: "blocked-filter-input-owner"
    }
    contextKeys: string[]
    actionRunner: "registered-command-facade"
    blockedOwners: string[]
    noSecondState: true
  }
  domOwnerAdapter: {
    status: "partial"
    codekOwner: "TestingService.getTestingExplorerContractProjection()"
    stateSource: "TestingService rows + filter/action adapter"
    vscodeSourcePaths: string[]
    containerSelector: "[data-codek-smoke=\"testing-explorer-viewpane-shell-owner\"]"
    treeSelector: "[data-testing-explorer-object-tree=\"true\"]"
    rowSelector: "[data-testing-explorer-row-id]"
    filterInputSelector: "[data-testing-explorer-filter-input=\"true\"]"
    storageKey: "testing.filterHistory2"
    rowCount: number
    visibleRowIds: string[]
    filterInput: {
      value: string
      placeholder: "Filter (e.g. text, !exclude, @tag)"
      includeTags: string[]
      excludeTags: string[]
      globList: { include: boolean; text: string }[]
      filterTerms: string[]
      blockedOwner: "TestingExplorerFilter input DOM + TestExplorerFilterState"
    }
    dataAttributes: {
      stateSource: "data-testing-explorer-state-source"
      rowId: "data-testing-explorer-row-id"
      rowDepth: "data-testing-explorer-row-depth"
      rowRevealState: "data-testing-explorer-row-reveal-state"
      rowRetired: "data-testing-explorer-row-retired"
      rowRunningContinuously: "data-testing-explorer-row-running-continuously"
      rowParentRunningContinuously: "data-testing-explorer-row-parent-running-continuously"
      rowCommandIds: "data-testing-explorer-row-command-ids"
      filterValue: "data-testing-explorer-filter-value"
      noSecondState: "data-testing-explorer-no-second-state"
    }
    implementedEvidence: string[]
    blockedOwners: string[]
    noSecondState: true
  }
  domOwnerMatrix: TestingOwnerGapMatrixEntry[]
  lifecycle: {
    activeContinuousRunIds: string[]
    prefixRunningRoots: string[]
    restartOnProfileChange: {
      status: "blocked"
      blockedOwner: "TestingContinuousRunService autorunIterableDelta + CancellationTokenSource"
      blockedReason: string
    }
    cancelOrder: {
      status: "projected"
      order: string[]
      evidence: string
    }
  }
  implementedEvidence: string[]
  blockedOwners: string[]
  blockedReason: string
  nextAuthorizedFiles: string[]
  noSecondState: true
}

export interface TestingExplorerContractProjectionOptions {
  controllerId?: string
  revealTestId?: string
  persistedState?: TestingExplorerPersistedStateInput
}

export interface TestingExplorerOptimizedViewState {
  collapsed?: boolean
  children?: Record<string, TestingExplorerOptimizedViewState>
}

export type TestingUiCapabilityStatus = "available" | "partial" | "blocked"

export interface TestingUiCapabilitySnapshot {
  status: TestingUiCapabilityStatus
  codekOwner: string
  vscodeSourcePaths: string[]
  codekStateSource: string
  commandIds: TestingCommandId[]
  reason: string
  missingOwnership: string[]
}

export interface TestingWorkbenchViewAudit {
  codekRegistration: "viewRegistry"
  vscodeSourcePaths: string[]
  genericWorkbenchShellFeasibility: {
    status: TestingUiCapabilityStatus
    shellSource: "viewRegistry+ViewsService+workbenchLayoutService"
    vscodeSourcePaths: string[]
    reusableOwners: string[]
    verifiedContracts: string[]
    missingOwners: string[]
    blockedReason: string
    nextAuthorizedFiles: string[]
    noSecondState: true
  }
  viewShellOwnerFeasibility: {
    status: TestingUiCapabilityStatus
    shellSource: "viewRegistry"
    treeStateSource: "TestingService.getProjection().items/actions/runSummary"
    vscodeSourcePaths: string[]
    canExpressShell: string[]
    canProjectTreeEvidence: string[]
    blockedOwners: string[]
    blockedReason: string
    noSecondState: true
  }
  actionOwnerFeasibility: {
    status: TestingUiCapabilityStatus
    shellSource: "viewRegistry"
    stateSource: "TestingService.getContinuousContextKeyProjection()"
    vscodeSourcePaths: string[]
    canExpressActionEvidence: string[]
    canProjectContextKeys: string[]
    blockedOwners: string[]
    blockedReason: string
    noSecondState: true
  }
  containers: {
    id: string
    vscodeId: string
    location: "activityBar" | "panel"
    codekOwner: "registerTestingWorkbenchViews"
    status: TestingUiCapabilityStatus
    reason: string
  }[]
  views: {
    id: string
    vscodeId: string
    containerId: string
    codekOwner: "TestingService.getProjection()" | "blocked-vscode-owner"
    status: TestingUiCapabilityStatus
    when?: string
    reason: string
  }[]
  editorContributions: {
    id: string
    vscodeSourcePath: string
    status: TestingUiCapabilityStatus
    codekOwner?: "TestingService.getCoverageEditorDecorationsProjection()"
    missingOwner: string
  }[]
  noSecondState: true
}

export interface TestingContractAudit {
  vscodeSourcePaths: string[]
  codekStateSource: string
  codekServiceIds: string[]
  vscodeServiceId: string
  viewContainerIds: string[]
  viewIds: string[]
  commandIds: TestingCommandId[]
  workbenchViews: TestingWorkbenchViewAudit
  uiBinding: {
    vscodeVisibleEntryPaths: string[]
    codekVisibleSurfacePath: string
    callbackCommandBinding: "commandRegistry"
    visibleActions: {
      commandId: TestingCommandId
      vscodeEntry: string
      codekBinding: "registered-command-facade" | "blocked-visible-ui"
      visibleInCodek: boolean
      reason?: string
    }[]
    blockedUiGaps: string[]
  }
  uiCapabilities: {
    treeProvider: TestingUiCapabilitySnapshot
    resultPeek: TestingUiCapabilitySnapshot
    coverageTree: TestingUiCapabilitySnapshot
  }
  serviceOwnerMatrix: TestingServiceOwnerContractAudit[]
  ownerContracts: {
    testExplorerTree: TestingOwnerContractAudit
    resultPeek: TestingOwnerContractAudit
    coverageEditor: TestingOwnerContractAudit
    continuousRun: TestingOwnerContractAudit
  }
  extensionHostBridge: {
    vscodeMainThreadPath: string
    vscodeExtHostPath: string
    codekMainThreadAdapter: string | null
    status: "missing-main-thread-adapter" | "connected"
    adapterEvidence: {
      rpcMethods: string[]
      rendererEventChannels: string[]
      backChannels: string[]
    }
    rpcMethodMatrix: {
      controllerAndItem: TestingBridgeRpcMethodAudit[]
      runProfile: TestingBridgeRpcMethodAudit[]
      runLifecycle: TestingBridgeRpcMethodAudit[]
      resultAndCoverage: TestingBridgeRpcMethodAudit[]
      extHostCallbacks: TestingBridgeRpcMethodAudit[]
    }
    callbacks: {
      cancellation: "connected" | "blocked"
      profileConfigure: "connected" | "blocked"
      coverageDetails: "connected" | "blocked"
      continuousRun: "projected" | "blocked"
    }
    coverageShellAudit: {
      status: "projected" | "blocked"
      stateSource: "TestingService coverage projections"
      implementedEvidence: string[]
      blockedOwners: string[]
      blockedReason: string
      noSecondState: true
    }
  }
  noSecondState: boolean
  remainingGaps: string[]
}

export interface TestingBridgeRpcMethodAudit {
  vscodeMethod: string
  vscodeOwner: "MainThreadTestingShape" | "ExtHostTestingShape"
  status: "projected" | "forwarded" | "stubbed" | "blocked"
  codekEvidence?: string
  rendererChannel?: string
  backChannel?: string
  blockedOwner?: string
  blockedReason?: string
}

export interface TestingOwnerGapMatrixEntry {
  capability: string
  status: "projected" | "partial" | "blocked"
  vscodeSourcePath: string
  codekProjection: string
  codekEvidence: string
  requiredOwner: string
  blockedReason: string
  nextAuthorizedFiles: string[]
}

export interface TestingServiceOwnerContractAudit {
  vscodeServiceId: "ITestService" | "ITestProfileService" | "ITestResultService" | "LiveTestResult" | "TestMessageFollowupProvider"
  decoratorId?: string
  status: "projected" | "partial" | "blocked"
  codekOwner: string
  codekStateSource: string
  vscodeSourcePaths: string[]
  implementedEvidence: string[]
  blockedOwners: string[]
  blockedReason: string
  noSecondState: true
}

export interface TestingOwnerContractAudit {
  status: "projected" | "blocked"
  codekStateSource: string
  vscodeSourcePaths: string[]
  codekCanProvide: string[]
  vscodeRequiredOwners: string[]
  availableEvidence?: {
    capability: string
    stateSource: string
    evidence: string
  }[]
  blockedMatrix?: {
    capability: string
    blockedOwner: string
    blockedReason: string
  }[]
  actionContextMatrix?: {
    surface: string
    vscodeEntry: string
    codekProjection: "projected" | "blocked"
    contextKeys: string[]
    evidence: string
    blockedOwner: string
    blockedReason: string
  }[]
  blockedReason: string
  noSecondState: true
}

export interface TestingUpperOwnerProjection {
  status: "partial"
  stateSource: "TestingService controllers/profiles/items/runs/results/output"
  vscodeSourcePaths: string[]
  collection: {
    status: "projected"
    controllerCount: number
    itemCount: number
    rootIds: string[]
    busyItemIds: string[]
    diffListener: {
      status: "blocked"
      forwardedBridge: "MainThreadTesting.$subscribeToDiffs -> ExtHostTesting.$syncTests"
      blockedOwner: "ITestService.collection onDidProcessDiff listener"
      blockedReason: string
    }
    noSecondState: true
  }
    resultService: {
      status: "projected"
      retainedRunCount: number
      retainedResultCount: number
      runningRunIds: string[]
      completedRunIds: string[]
      outputMessageCount: number
      retiredResultIds: string[]
      eventProjection: {
      onResultsChanged: "emitter-backed"
      onTestChanged: "emitter-backed"
      owner: "TestingService onResultsChanged/onTestChanged"
      }
      storage: {
      status: "projected"
      owner: "TestingService.getResultStorageProjection()"
      storageKey: "storedTestResults"
      blockedOwners: string[]
      fileBackedOwnerMatrix: TestingOwnerGapMatrixEntry[]
      blockedReason: string
      }
      noSecondState: true
    }
  liveResultLifecycle: {
    status: "partial"
    runningRunIds: string[]
    completedRunIds: string[]
    cancellableRunIds: string[]
    retiredResultIds: string[]
    retiredTestIds: string[]
    lifecycleMatrix: TestingOwnerGapMatrixEntry[]
    blockedOwners: string[]
    blockedReason: string
    noSecondState: true
  }
  profileDefaults: {
    status: "projected"
    defaultsByControllerAndGroup: Record<string, Partial<Record<TestRunProfileGroup, number[]>>>
    fallbackProfileIdsByControllerAndGroup: Record<string, Partial<Record<TestRunProfileGroup, number | undefined>>>
    blockedOwners: string[]
    blockedReason: string
    noSecondState: true
  }
  messageFollowups: {
    status: "partial" | "blocked"
    resultPeekEntryCount: number
    messageCount: number
    messagesWithLocationCount: number
    implementedOwners: string[]
    blockedOwners: string[]
    blockedReason: string
    noSecondState: true
  }
  uiOwners: {
    status: "blocked"
    testingExplorer: TestingOwnerContractAudit
    resultPeek: TestingOwnerContractAudit
    coverageEditor: TestingOwnerContractAudit
    noSecondState: true
  }
  noSecondState: true
}

export interface TestingProjection {
  controllers: TestControllerSnapshot[]
  profiles: TestRunProfileSnapshot[]
  items: TestItemProjection[]
  runs: TestRunSnapshot[]
  results: TestResultSnapshot[]
  runSummary: TestRunSummary
  resultHistory: TestResultServiceHistoryProjection
  resultStorage: TestResultServiceStorageProjection
  testResultsViewPaneShell: TestResultsViewPaneShellProjection
  coverage: TestCoverageProjection
  resultPeek: TestResultPeekProjection
  coverageTree: TestCoverageTreeProjection
  coverageView: TestCoverageViewProjection
  coverageDecorations: TestCoverageEditorDecorationsProjection
  coverageRendererShell: TestCoverageRendererShellProjection
  coverageEditorContributionShell: TestCoverageEditorContributionShellProjection
  coverageOwnerFeasibility: TestCoverageOwnerFeasibilityAudit
  continuousContextKeys: TestingContinuousContextKeyProjection
  testingExplorerContract: TestingExplorerContractProjection
  upperOwnerProjection: TestingUpperOwnerProjection
  actions: TestRunActionDescriptor[]
  contract: TestingContractAudit
}

export interface TestingCallbackCancelRunPayload {
  runId?: string
  taskId?: string
}

export interface TestingCallbackConfigureProfilePayload {
  controllerId: string
  profileId: number
}

export interface TestingCallbackCoverageDetailsPayload {
  coverageId: string
  testId?: string
}

export interface TestingTestMessageFollowupRequest {
  testId: string
  message: unknown
  resultId?: string
  taskId?: string
}

export interface TestingTestMessageFollowup {
  id: number
  title: string
  command?: string
  args?: unknown[]
}

export interface TestingExtensionHostCallbacks {
  cancelRun(payload: TestingCallbackCancelRunPayload): void
  configureProfile(payload: TestingCallbackConfigureProfilePayload): void
  getCoverageDetails(payload: TestingCallbackCoverageDetailsPayload): Promise<unknown[]>
  provideTestFollowups(payload: TestingTestMessageFollowupRequest): Promise<TestingTestMessageFollowup[]>
  executeTestFollowup(id: number): Promise<void>
  disposeTestFollowups(ids: number[]): void
  publishTestResults(results: PublishedTestResultSnapshot[]): void
}

export const TESTING_RUN_COMMAND_IDS = {
  Run: "testing.run",
  Debug: "testing.debug",
  Coverage: "testing.coverage",
  StartContinuousRun: "testing.startContinuousRun",
  StopContinuousRun: "testing.stopContinuousRun",
  ToggleContinuousRunForTest: "testing.toggleContinuousRunForTest",
} as const

export const TESTING_CALLBACK_COMMAND_IDS = {
  CancelRun: "testing.cancelRun",
  ConfigureProfile: "testing.configureProfile",
  CoverageDetails: "testing.coverageDetails",
} as const

export const TESTING_PEEK_COMMAND_IDS = {
  OpenOutputPeek: "testing.openOutputPeek",
} as const

export const TESTING_COVERAGE_COMMAND_IDS = {
  OpenCoverage: "testing.openCoverage",
  CloseCoverage: "testing.closeCoverage",
  ToggleInlineCoverage: "testing.toggleInlineCoverage",
  FilterToTest: "testing.coverageFilterToTest",
  GoToNextMissedLine: "testing.coverage.goToNextMissedLine",
  GoToPreviousMissedLine: "testing.coverage.goToPreviousMissedLine",
  ViewChangeSorting: "testing.coverageView.changeSorting",
  ViewCollapseAll: "testing.coverageView.collapseAll",
} as const

export const TESTING_VIEW_IDS = {
  Container: "workbench.view.testing",
  Default: "workbench.view.testing.default",
  Explorer: "workbench.view.testing.testExplorer",
  Coverage: "workbench.view.testing.coverage",
  ResultsContainer: "workbench.panel.testResults",
  Results: "workbench.panel.testResults.view",
} as const

export type TestingRunCommandId = typeof TESTING_RUN_COMMAND_IDS[keyof typeof TESTING_RUN_COMMAND_IDS]
export type TestingCallbackCommandId = typeof TESTING_CALLBACK_COMMAND_IDS[keyof typeof TESTING_CALLBACK_COMMAND_IDS]
export type TestingPeekCommandId = typeof TESTING_PEEK_COMMAND_IDS[keyof typeof TESTING_PEEK_COMMAND_IDS]
export type TestingCoverageCommandId = typeof TESTING_COVERAGE_COMMAND_IDS[keyof typeof TESTING_COVERAGE_COMMAND_IDS]
export type TestingCommandId = TestingRunCommandId | TestingCallbackCommandId | TestingPeekCommandId | TestingCoverageCommandId

export interface ITestingService {
  readonly _serviceBrand: undefined
  setExtensionHostCallbacks(callbacks: TestingExtensionHostCallbacks | null): void
  registerController(controller: TestControllerSnapshot): void
  unregisterController(controllerId: string): void
  addProfile(profile: TestRunProfileSnapshot): void
  updateProfile(controllerId: string, profileId: number, update: Partial<TestRunProfileSnapshot>): void
  removeProfile(controllerId: string, profileId?: number): void
  getControllerProfiles(controllerId: string): TestRunProfileSnapshot[]
  getGroupDefaultProfiles(group: TestRunProfileGroup, controllerId?: string): TestRunProfileSnapshot[]
  upsertItem(item: TestItemSnapshot): void
  removeItem(itemId: string): void
  getItems(controllerId?: string): TestItemProjection[]
  startRun(request: TestRunRequestSnapshot): TestRunSnapshot
  startRunTask(runId: string, task: Omit<TestRunTaskSnapshot, "startedAt" | "completedAt">): void
  finishRunTask(runId: string, taskId: string): void
  appendOutput(runId: string, message: string, options?: { testId?: string; locationUri?: string }): void
  updateRunItemState(runId: string, testId: string, state: TestResultState, durationMs?: number, messages?: string[]): void
  completeRun(runId: string, state?: TestResultState): void
  getRuns(controllerId?: string): TestRunSnapshot[]
  markResultsRetired(testIds?: string[]): void
  publishCoverage(files: TestCoverageFileSnapshot[]): void
  clearCoverage(): void
  getCoverage(): TestCoverageProjection
  getResultHistoryProjection(controllerId?: string): TestResultServiceHistoryProjection
  getResultStorageProjection(controllerId?: string): TestResultServiceStorageProjection
  getTestResultsViewPaneShellProjection(controllerId?: string): TestResultsViewPaneShellProjection
  getResultPeekProjection(controllerId?: string): TestResultPeekProjection
  openResultPeek(payload?: TestingOpenResultPeekPayload): TestResultPeekOpenDescriptor
  getCoverageTreeProjection(): TestCoverageTreeProjection
  openCoverage(coverageId?: string): TestCoverageViewProjection
  closeCoverage(): TestCoverageViewProjection
  setCoverageFilterToTest(testId?: string): TestCoverageViewProjection
  setCoverageInlineVisible(showInline: boolean): TestCoverageViewProjection
  setCoverageSortOrder(sortOrder: TestCoverageSortOrder): TestCoverageViewProjection
  getCoverageViewProjection(): TestCoverageViewProjection
  getCoverageEditorDecorationsProjection(uri?: string): TestCoverageEditorDecorationsProjection
  getCoverageRendererShellProjection(): TestCoverageRendererShellProjection
  getCoverageEditorContributionShellProjection(uri?: string): TestCoverageEditorContributionShellProjection
  getCoverageOwnerFeasibilityAudit(uri?: string): TestCoverageOwnerFeasibilityAudit
  getContinuousContextKeyProjection(controllerId?: string): TestingContinuousContextKeyProjection
  getTestingExplorerContractProjection(options?: TestingExplorerContractProjectionOptions): TestingExplorerContractProjection
  getUpperOwnerProjection(controllerId?: string): TestingUpperOwnerProjection
  startContinuousRun(request?: TestingContinuousRunRequest): TestRunSnapshot | undefined
  stopContinuousRun(request?: Pick<TestingContinuousRunRequest, "controllerId" | "profileId" | "testId">): TestRunSnapshot[]
  toggleContinuousRunForTest(testId: string, request?: Pick<TestingContinuousRunRequest, "controllerId" | "profileId" | "group">): TestingContinuousRunToggleResult
  cancelRun(payload: TestingCallbackCancelRunPayload): boolean
  configureProfile(payload: TestingCallbackConfigureProfilePayload): boolean
  requestCoverageDetails(payload: TestingCallbackCoverageDetailsPayload): Promise<unknown[]>
  provideTestFollowups(payload: TestingTestMessageFollowupRequest): Promise<TestingTestMessageFollowup[]>
  executeTestFollowup(id: number): Promise<boolean>
  disposeTestFollowups(ids: number[]): boolean
  createRunAction(request: { group: TestRunProfileGroup; testIds: string[]; controllerId?: string; profileId?: number }): TestRunActionDescriptor
  appendResult(result: TestResultSnapshot): void
  clearResults(controllerId?: string): void
  getResults(controllerId?: string): TestResultSnapshot[]
  readonly onResultsChanged: Event<TestResultServiceChangeEvent>
  readonly onTestChanged: Event<TestResultServiceItemChangeEvent>
  readonly resultsList: readonly TestResultSnapshot[]
  clear(): void
  push(result: TestResultSnapshot): TestResultSnapshot
  getResult(resultId: string): TestResultSnapshot | undefined
  getStateById(testId: string): [result: TestResultSnapshot, item: TestResultSnapshot] | undefined
  getRunSummary(controllerId?: string): TestRunSummary
  getProjection(controllerId?: string): TestingProjection
  getContractAudit(): TestingContractAudit
  reset(): void
}

export const ITestingService = createDecorator<ITestingService>("testingService")
export const ITestProfileService = createDecorator<ITestingService>("testProfileService")
export const ITestResultService = createDecorator<ITestingService>("testResultService")

export class TestingService implements ITestingService {
  declare readonly _serviceBrand: undefined

  private readonly controllers = new Map<string, TestControllerSnapshot>()
  private readonly profiles = new Map<string, TestRunProfileSnapshot[]>()
  private readonly items = new Map<string, TestItemSnapshot>()
  private readonly runs = new Map<string, TestRunSnapshot>()
  private readonly results = new Map<string, TestResultSnapshot>()
  private coverageFiles: TestCoverageFileSnapshot[] = []
  private selectedCoverageId: string | undefined
  private coverageFilterToTestId: string | undefined
  private coverageShowInline = false
  private coverageSortOrder: TestCoverageSortOrder = "location"
  private extensionHostCallbacks: TestingExtensionHostCallbacks | null = null
  private readonly onResultsChangedEmitter = new Emitter<TestResultServiceChangeEvent>()
  private readonly onTestChangedEmitter = new Emitter<TestResultServiceItemChangeEvent>()

  readonly onResultsChanged = this.onResultsChangedEmitter.event
  readonly onTestChanged = this.onTestChangedEmitter.event

  get resultsList(): readonly TestResultSnapshot[] {
    return this.getResults()
  }

  setExtensionHostCallbacks(callbacks: TestingExtensionHostCallbacks | null): void {
    this.extensionHostCallbacks = callbacks
  }

  registerController(controller: TestControllerSnapshot): void {
    if (!controller.id) return
    this.controllers.set(controller.id, { ...controller })
  }

  unregisterController(controllerId: string): void {
    this.controllers.delete(controllerId)
    this.profiles.delete(controllerId)
    for (const [id, item] of this.items) {
      if (item.controllerId === controllerId) this.items.delete(id)
    }
    for (const [id, run] of this.runs) {
      if (run.controllerId === controllerId) this.runs.delete(id)
    }
    for (const [id, result] of this.results) {
      if (result.controllerId === controllerId) this.results.delete(id)
    }
    this.coverageFiles = this.coverageFiles.filter((file) => !file.testIds?.some((testId) => getControllerIdFromTestId(testId) === controllerId))
  }

  addProfile(profile: TestRunProfileSnapshot): void {
    if (!profile.controllerId) return
    const profiles = this.profiles.get(profile.controllerId) || []
    const withoutExisting = profiles.filter((item) => item.profileId !== profile.profileId)
    withoutExisting.push({ ...profile })
    this.profiles.set(profile.controllerId, sortProfiles(withoutExisting))
  }

  updateProfile(controllerId: string, profileId: number, update: Partial<TestRunProfileSnapshot>): void {
    const profiles = this.profiles.get(controllerId) || []
    this.profiles.set(controllerId, sortProfiles(profiles.map((profile) =>
      profile.profileId === profileId ? { ...profile, ...update, controllerId, profileId } : profile,
    )))
  }

  removeProfile(controllerId: string, profileId?: number): void {
    if (profileId === undefined) {
      this.profiles.delete(controllerId)
      return
    }
    this.profiles.set(controllerId, (this.profiles.get(controllerId) || []).filter((profile) => profile.profileId !== profileId))
  }

  getControllerProfiles(controllerId: string): TestRunProfileSnapshot[] {
    return (this.profiles.get(controllerId) || []).map((profile) => ({ ...profile }))
  }

  getGroupDefaultProfiles(group: TestRunProfileGroup, controllerId?: string): TestRunProfileSnapshot[] {
    const profiles = this.getProfiles(controllerId).filter((profile) => profile.group === group)
    const defaults = profiles.filter((profile) => profile.isDefault)
    return defaults.length > 0 ? defaults : profiles.slice(0, 1)
  }

  upsertItem(item: TestItemSnapshot): void {
    if (!item.id || !item.controllerId) return
    this.items.set(item.id, cloneItem(item))
  }

  removeItem(itemId: string): void {
    const queue = [itemId]
    while (queue.length) {
      const current = queue.pop()
      if (!current) continue
      this.items.delete(current)
      for (const item of this.items.values()) {
        if (item.parentId === current) queue.push(item.id)
      }
    }
  }

  getItems(controllerId?: string): TestItemProjection[] {
    const childrenByParent = new Map<string, string[]>()
    for (const item of this.items.values()) {
      if (!item.parentId) continue
      const siblings = childrenByParent.get(item.parentId) || []
      siblings.push(item.id)
      childrenByParent.set(item.parentId, siblings)
    }
    for (const siblings of childrenByParent.values()) {
      siblings.sort((a, b) => compareItems(this.items.get(a), this.items.get(b)))
    }

    return [...this.items.values()]
      .filter((item) => !controllerId || item.controllerId === controllerId)
      .sort((a, b) => getDepth(this.items, a) - getDepth(this.items, b) || compareItems(a, b))
      .map((item) => ({
        ...cloneItem(item),
        childrenIds: [...(childrenByParent.get(item.id) || [])],
        depth: getDepth(this.items, item),
      }))
  }

  startRun(request: TestRunRequestSnapshot): TestRunSnapshot {
    const run: TestRunSnapshot = {
      ...cloneRunRequest(request),
      label: request.label || getDefaultRunLabel(request.group),
      state: "running",
      startedAt: Date.now(),
      output: [],
      tasks: [],
    }
    this.runs.set(run.id, run)

    const selectedTests = request.testIds.length > 0
      ? request.testIds
      : this.getItems(request.controllerId).map((item) => item.id)
    for (const testId of selectedTests) {
      const item = this.items.get(testId)
      this.appendResult({
        id: resultIdForRunItem(run.id, testId),
        controllerId: request.controllerId,
        testId,
        label: item?.label || testId,
        state: "queued",
        durationMs: null,
        messages: [],
        profileId: request.profileId,
      })
    }

    return cloneRun(run)
  }

  startRunTask(runId: string, task: Omit<TestRunTaskSnapshot, "startedAt" | "completedAt">): void {
    const run = this.runs.get(runId)
    if (!run || !task.id) return
    const existingIndex = run.tasks.findIndex((entry) => entry.id === task.id)
    const nextTask: TestRunTaskSnapshot = {
      ...task,
      controllerId: task.controllerId || run.controllerId,
      name: task.name || task.id,
      running: task.running !== false,
      startedAt: existingIndex >= 0 ? run.tasks[existingIndex].startedAt : Date.now(),
      completedAt: task.running === false ? Date.now() : undefined,
    }
    if (existingIndex >= 0) {
      run.tasks.splice(existingIndex, 1, nextTask)
    } else {
      run.tasks.push(nextTask)
    }
  }

  finishRunTask(runId: string, taskId: string): void {
    const run = this.runs.get(runId)
    if (!run || !taskId) return
    const existing = run.tasks.find((task) => task.id === taskId)
    if (existing) {
      existing.running = false
      existing.completedAt = Date.now()
      return
    }
    run.tasks.push({
      id: taskId,
      controllerId: run.controllerId,
      name: taskId,
      running: false,
      startedAt: Date.now(),
      completedAt: Date.now(),
    })
  }

  appendOutput(runId: string, message: string, options: { testId?: string; locationUri?: string } = {}): void {
    const run = this.runs.get(runId)
    if (!run) return
    const offset = run.output.reduce((sum, output) => sum + output.length, 0)
    const output: TestOutputMessageSnapshot = {
      message,
      offset,
      length: message.length,
      ...options,
    }
    run.output.push(output)
    if (options.testId) {
      const result = this.results.get(resultIdForRunItem(runId, options.testId))
      if (result) {
        result.messages.push(message)
        this.onTestChangedEmitter.fire({ result: cloneResult(result), reason: "newMessage" })
      }
    }
  }

  updateRunItemState(runId: string, testId: string, state: TestResultState, durationMs?: number, messages: string[] = []): void {
    const run = this.runs.get(runId)
    if (!run) return
    const resultId = resultIdForRunItem(runId, testId)
    const existing = this.results.get(resultId)
    const item = this.items.get(testId)
    const nextResult = {
      id: resultId,
      controllerId: run.controllerId,
      testId,
      label: item?.label || testId,
      state,
      durationMs: durationMs ?? existing?.durationMs ?? null,
      messages: [...(existing?.messages || []), ...messages],
      profileId: run.profileId,
      retired: existing?.retired === true,
    }
    this.results.set(resultId, nextResult)
    run.state = resolveRunState(this.getResultsForRun(runId))
    this.onTestChangedEmitter.fire({ result: cloneResult(nextResult), reason: "computedStateChange" })
  }

  completeRun(runId: string, state?: TestResultState): void {
    const run = this.runs.get(runId)
    if (!run) return
    run.state = state || resolveRunState(this.getResultsForRun(runId))
    run.completedAt = Date.now()
    const published = this.createPublishedResultSnapshot(run)
    this.onResultsChangedEmitter.fire({ completed: published })
    this.extensionHostCallbacks?.publishTestResults([published])
  }

  getRuns(controllerId?: string): TestRunSnapshot[] {
    return [...this.runs.values()]
      .filter((run) => !controllerId || run.controllerId === controllerId)
      .map(cloneRun)
      .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
  }

  markResultsRetired(testIds?: string[]): void {
    const requested = Array.isArray(testIds)
      ? testIds.map((id) => String(id || "")).filter(Boolean)
      : undefined
    for (const result of this.results.values()) {
      if (!requested || requested.some((id) => testIdMatchesRetireRequest(result.testId, id))) {
        result.retired = true
        this.onTestChangedEmitter.fire({ result: cloneResult(result), reason: "retired" })
      }
    }
  }

  publishCoverage(files: TestCoverageFileSnapshot[]): void {
    this.coverageFiles = files.map(cloneCoverageFile)
    if (this.selectedCoverageId && !this.coverageFiles.some((file) => file.id === this.selectedCoverageId)) {
      this.selectedCoverageId = undefined
      this.coverageFilterToTestId = undefined
    }
  }

  clearCoverage(): void {
    this.coverageFiles = []
    this.selectedCoverageId = undefined
    this.coverageFilterToTestId = undefined
  }

  getCoverage(): TestCoverageProjection {
    if (this.coverageFiles.length > 0) {
      return { status: "available", files: this.coverageFiles.map(cloneCoverageFile) }
    }
    const hasCoverageProfile = this.getProfiles().some((profile) => profile.group === "coverage")
    if (hasCoverageProfile) {
      return {
        status: "placeholder",
        reason: "coverage profile registered but no coverage data has been published",
        files: [],
      }
    }
    return {
      status: "notAvailable",
      reason: "no coverage profile registered",
      files: [],
    }
  }

  getResultHistoryProjection(controllerId?: string): TestResultServiceHistoryProjection {
    const runs = this.getRuns(controllerId)
    const results = this.getResults(controllerId)
    const runIds = runs.map((run) => run.id).sort((a, b) => b.length - a.length || a.localeCompare(b))
    const resultsByRunId = new Map<string, TestResultSnapshot[]>()
    for (const result of results) {
      const runId = getRunIdForResult(result.id, runIds)
      if (!runId) continue
      const runResults = resultsByRunId.get(runId) || []
      runResults.push(result)
      resultsByRunId.set(runId, runResults)
    }
    const runHistory = runs
      .map((run) => {
        const runResults = (resultsByRunId.get(run.id) || [])
          .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
        return {
          id: run.id,
          controllerId: run.controllerId,
          label: run.label,
          state: run.state,
          group: run.group,
          profileId: run.profileId,
          continuous: run.continuous === true,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          testIds: [...run.testIds],
          outputMessageCount: run.output.length,
          resultIds: runResults.map((result) => result.id),
          summary: summarizeResults(runResults),
        }
      })
      .sort((a, b) => {
        const aCompleted = a.completedAt ?? Number.POSITIVE_INFINITY
        const bCompleted = b.completedAt ?? Number.POSITIVE_INFINITY
        return bCompleted - aCompleted || b.startedAt - a.startedAt || a.id.localeCompare(b.id)
      })

    return {
      status: runHistory.length > 0 || results.length > 0 ? "available" : "notAvailable",
      reason: runHistory.length > 0 || results.length > 0 ? undefined : "no retained test results are available",
      stateSource: "TestingService runs/results/output",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/testing/common/testResultService.ts",
        "src/vs/workbench/contrib/testing/common/testResultStorage.ts",
        "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsViewContent.ts",
        "src/vs/workbench/contrib/testing/browser/testingOutputPeek.ts",
      ],
      retainedRunCount: runHistory.length,
      retainedResultCount: results.length,
      hasAnyResults: results.length > 0,
      isRunning: runHistory.some((run) => run.state === "running" || run.state === "queued"),
      runs: runHistory,
      adapter: cloneResultHistoryAdapter(),
    }
  }

  getResultStorageProjection(controllerId?: string): TestResultServiceStorageProjection {
    const runs = this.getRuns(controllerId)
    const serializedResults = runs
      .filter((run) => run.completedAt !== undefined)
      .map((run) => this.createPublishedResultSnapshot(run))
      .sort((a, b) => b.completedAt - a.completedAt || a.id.localeCompare(b.id))
    return cloneResultStorageProjection({
      status: serializedResults.length > 0 ? "available" : "notAvailable",
      stateSource: "TestingService runs/results/output",
      storageKey: "storedTestResults",
      retainedResultIds: serializedResults.map((result) => result.id),
      serializedResults,
      fileBackedOwnerMatrix: cloneOwnerGapMatrix(FILE_BACKED_RESULT_STORAGE_OWNER_MATRIX),
      adapter: cloneResultStorageAdapter(),
      noSecondState: true,
    })
  }

  getTestResultsViewPaneShellProjection(controllerId?: string): TestResultsViewPaneShellProjection {
    const history = this.getResultHistoryProjection(controllerId)
    const peek = this.getResultPeekProjection(controllerId)
    const resultsById = new Map(this.getResults(controllerId).map((result) => [result.id, result]))
    const peekEntriesByResultId = new Map(peek.entries.map((entry) => [entry.id, entry]))
    const rows: TestResultsViewPaneShellRowProjection[] = []

    for (const run of history.runs) {
      rows.push({
        id: run.id,
        role: "treeitem",
        kind: "run",
        label: run.label,
        depth: 0,
        state: run.state,
        runId: run.id,
        resultIds: [...run.resultIds],
        messageCount: run.summary.total,
        outputMessageCount: run.outputMessageCount,
        commandIds: [
          TESTING_RUN_COMMAND_IDS.Run,
          TESTING_RUN_COMMAND_IDS.Debug,
          TESTING_PEEK_COMMAND_IDS.OpenOutputPeek,
        ],
        evidenceUri: `codek-testing://test-results-view/${encodeURIComponent(run.id)}`,
      })

      for (const resultId of run.resultIds) {
        const result = resultsById.get(resultId)
        if (!result) continue
        const peekEntry = peekEntriesByResultId.get(resultId)
        rows.push({
          id: result.id,
          role: "treeitem",
          kind: "test",
          label: result.label,
          depth: 1,
          state: result.state,
          runId: run.id,
          testId: result.testId,
          resultIds: [result.id],
          messageCount: result.messages.length,
          outputMessageCount: peekEntry?.output.length || 0,
          locationUri: peekEntry?.locationUri || this.items.get(result.testId)?.uri,
          commandIds: [
            TESTING_RUN_COMMAND_IDS.Run,
            TESTING_RUN_COMMAND_IDS.Debug,
            TESTING_PEEK_COMMAND_IDS.OpenOutputPeek,
            TESTING_CALLBACK_COMMAND_IDS.CancelRun,
          ],
          evidenceUri: `codek-testing://test-results-view/${encodeURIComponent(run.id)}/${encodeURIComponent(result.testId)}`,
        })
      }
    }

    return {
      status: history.status,
      reason: history.reason,
      containerId: TESTING_VIEW_IDS.ResultsContainer,
      viewId: TESTING_VIEW_IDS.Results,
      stateSource: "TestingService.getResultHistoryProjection()+getResultPeekProjection()",
      runCount: history.retainedRunCount,
      resultCount: history.retainedResultCount,
      treeRowCount: rows.length,
      selectedRunId: peek.latestRunId,
      selectedEntryId: peek.entries[0]?.id,
      rows,
      commandIds: [
        TESTING_RUN_COMMAND_IDS.Run,
        TESTING_RUN_COMMAND_IDS.Debug,
        TESTING_PEEK_COMMAND_IDS.OpenOutputPeek,
        TESTING_CALLBACK_COMMAND_IDS.CancelRun,
      ],
      domOwnerMatrix: cloneOwnerGapMatrix(TEST_RESULTS_VIEW_CONTENT_DOM_OWNER_MATRIX),
      adapter: cloneTestResultsViewPaneShellAdapter(),
      noSecondState: true,
    }
  }

  getResultPeekProjection(controllerId?: string): TestResultPeekProjection {
    const runs = this.getRuns(controllerId)
    const latestRun = [...runs].sort((a, b) => (b.startedAt - a.startedAt) || b.id.localeCompare(a.id))[0]
    if (!latestRun) {
      return {
        status: "notAvailable",
        reason: "no test run has been recorded",
        entries: [],
        adapter: cloneResultPeekAdapter(),
      }
    }

    const entries = this.getResults(controllerId)
      .filter((result) => latestRun.testIds.includes(result.testId) || result.id.startsWith(`${latestRun.id}:`))
      .map((result) => {
        const output = latestRun.output.filter((message) => !message.testId || message.testId === result.testId)
        return {
          id: result.id,
          runId: latestRun.id,
          testId: result.testId,
          label: result.label,
          state: result.state,
          retired: result.retired === true,
          durationMs: result.durationMs,
          messages: [...result.messages],
          output: output.map((message) => ({ ...message })),
          locationUri: output.find((message) => message.locationUri)?.locationUri || this.items.get(result.testId)?.uri,
          canCancel: latestRun.completedAt === undefined,
          commandIds: [
            TESTING_RUN_COMMAND_IDS.Run,
            TESTING_RUN_COMMAND_IDS.Debug,
            TESTING_PEEK_COMMAND_IDS.OpenOutputPeek,
            TESTING_CALLBACK_COMMAND_IDS.CancelRun,
          ],
          evidenceUri: `codek-testing://${latestRun.controllerId}/result-peek/${encodeURIComponent(latestRun.id)}/${encodeURIComponent(result.testId)}`,
        }
      })

    return {
      status: entries.length > 0 ? "available" : "notAvailable",
      reason: entries.length > 0 ? undefined : "latest test run has no result items",
      latestRunId: latestRun.id,
      entries,
      adapter: cloneResultPeekAdapter(),
    }
  }

  openResultPeek(payload: TestingOpenResultPeekPayload = {}): TestResultPeekOpenDescriptor {
    const projection = this.getResultPeekProjection()
    if (projection.status !== "available") {
      return createResultPeekOpenDescriptor(projection, undefined, projection.reason || "no test result peek entry is available")
    }

    const selectedEntry = selectResultPeekEntry(projection.entries, payload)
    if (!selectedEntry) {
      return createResultPeekOpenDescriptor(projection, undefined, "requested test result peek entry was not found")
    }

    return createResultPeekOpenDescriptor(projection, selectedEntry)
  }

  getCoverageTreeProjection(): TestCoverageTreeProjection {
    const coverage = this.getCoverage()
    return {
      status: coverage.status,
      reason: coverage.reason,
      nodes: buildCoverageTreeNodes(coverage.files, this.coverageFilterToTestId, this.coverageSortOrder),
      adapter: cloneCoverageTreeAdapter(),
    }
  }

  openCoverage(coverageId?: string): TestCoverageViewProjection {
    const coverage = this.getCoverage()
    const requested = coverageId ? coverage.files.find((file) => file.id === coverageId) : undefined
    const fallback = coverage.files[0]
    this.selectedCoverageId = requested?.id || fallback?.id
    if (!this.selectedCoverageId) {
      this.coverageFilterToTestId = undefined
    }
    return this.getCoverageViewProjection()
  }

  closeCoverage(): TestCoverageViewProjection {
    this.selectedCoverageId = undefined
    this.coverageFilterToTestId = undefined
    return this.getCoverageViewProjection()
  }

  setCoverageFilterToTest(testId?: string): TestCoverageViewProjection {
    const value = String(testId || "")
    this.coverageFilterToTestId = value || undefined
    return this.getCoverageViewProjection()
  }

  setCoverageInlineVisible(showInline: boolean): TestCoverageViewProjection {
    this.coverageShowInline = Boolean(showInline)
    return this.getCoverageViewProjection()
  }

  setCoverageSortOrder(sortOrder: TestCoverageSortOrder): TestCoverageViewProjection {
    if (sortOrder === "location" || sortOrder === "coverage" || sortOrder === "name") {
      this.coverageSortOrder = sortOrder
    }
    return this.getCoverageViewProjection()
  }

  getCoverageViewProjection(): TestCoverageViewProjection {
    const coverage = this.getCoverage()
    const selected = this.getSelectedCoverageFile(coverage.files)
    const status = selected ? "available" : coverage.status
    return {
      status,
      reason: selected ? undefined : coverage.reason,
      selectedCoverageId: selected?.id,
      filteredToTestId: this.coverageFilterToTestId,
      showInline: this.coverageShowInline,
      sortOrder: this.coverageSortOrder,
      nodes: buildCoverageTreeNodes(coverage.files, this.coverageFilterToTestId, this.coverageSortOrder),
      commandIds: [
        TESTING_COVERAGE_COMMAND_IDS.OpenCoverage,
        TESTING_COVERAGE_COMMAND_IDS.CloseCoverage,
        TESTING_COVERAGE_COMMAND_IDS.ToggleInlineCoverage,
        TESTING_COVERAGE_COMMAND_IDS.FilterToTest,
        TESTING_COVERAGE_COMMAND_IDS.ViewChangeSorting,
        TESTING_COVERAGE_COMMAND_IDS.ViewCollapseAll,
        TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
      ],
      shellAdapter: cloneCoverageViewShellAdapter(),
    }
  }

  getCoverageEditorDecorationsProjection(uri?: string): TestCoverageEditorDecorationsProjection {
    const coverage = this.getCoverage()
    const selected = uri
      ? coverage.files.find((file) => normalizeCoverageUri(file.uri) === normalizeCoverageUri(uri))
      : this.getSelectedCoverageFile(coverage.files)
    if (!selected) {
      return {
        status: "notAvailable",
        reason: uri ? "no coverage file matches the requested editor uri" : "no selected coverage file is open",
        uri,
        selectedCoverageId: this.selectedCoverageId,
        genericEditorShellContract: cloneCoverageGenericEditorShellContract(),
        adapter: cloneCoverageDecorationsAdapter(),
      }
    }
    const node = createCoverageTreeNode(selected, this.coverageFilterToTestId)
    return {
      status: "available",
      uri: selected.uri,
      selectedCoverageId: selected.id,
      decoration: {
        id: selected.id,
        uri: selected.uri,
        label: node.label,
        statementPercent: node.statementPercent,
        branchPercent: node.branchPercent,
        declarationPercent: node.declarationPercent,
        testIds: node.testIds,
        filteredToTestId: this.coverageFilterToTestId,
        showInline: this.coverageShowInline,
        hasPerTestCoverage: Boolean(selected.testIds?.length),
        commandIds: [
          TESTING_COVERAGE_COMMAND_IDS.ToggleInlineCoverage,
          TESTING_COVERAGE_COMMAND_IDS.FilterToTest,
          TESTING_COVERAGE_COMMAND_IDS.GoToNextMissedLine,
          TESTING_COVERAGE_COMMAND_IDS.GoToPreviousMissedLine,
          TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
        ],
        evidenceUri: `codek-testing://coverage-decorations/${encodeURIComponent(selected.id)}`,
      },
      rangeModelShell: createCoverageEditorRangeModelShell(selected),
      genericEditorShellContract: cloneCoverageGenericEditorShellContract(),
      adapter: cloneCoverageDecorationsAdapter(),
    }
  }

  getCoverageRendererShellProjection(): TestCoverageRendererShellProjection {
    const coverageView = this.getCoverageViewProjection()
    const rows = coverageView.nodes.map((node) => createCoverageRendererShellRow(node, coverageView.selectedCoverageId))
    return {
      status: coverageView.status,
      reason: coverageView.reason,
      containerId: TESTING_VIEW_IDS.Container,
      viewId: TESTING_VIEW_IDS.Coverage,
      stateSource: "TestingService.getCoverageViewProjection()",
      selectedCoverageId: coverageView.selectedCoverageId,
      filteredToTestId: coverageView.filteredToTestId,
      showInline: coverageView.showInline,
      sortOrder: coverageView.sortOrder,
      nodeCount: rows.length,
      rows,
      commandIds: [...coverageView.commandIds],
      adapter: cloneCoverageRendererShellAdapter(),
    }
  }

  getCoverageEditorContributionShellProjection(uri?: string): TestCoverageEditorContributionShellProjection {
    const projection = this.getCoverageEditorDecorationsProjection(uri)
    return {
      status: projection.status,
      reason: projection.reason,
      contributionId: "editor.contrib.coverageDecorations",
      stateSource: "TestingService.getCoverageEditorDecorationsProjection()",
      uri: projection.uri,
      selectedCoverageId: projection.selectedCoverageId,
      decoration: projection.decoration ? cloneCoverageEditorDecoration(projection.decoration) : undefined,
      rangeModelShell: projection.rangeModelShell ? cloneCoverageEditorRangeModelShell(projection.rangeModelShell) : undefined,
      genericEditorShellContract: cloneCoverageGenericEditorShellContract(),
      commandIds: projection.decoration ? [...projection.decoration.commandIds] : [],
      adapter: cloneCoverageEditorContributionShellAdapter(),
    }
  }

  getCoverageOwnerFeasibilityAudit(uri?: string): TestCoverageOwnerFeasibilityAudit {
    const renderer = this.getCoverageRendererShellProjection()
    const editorContribution = this.getCoverageEditorContributionShellProjection(uri)
    return {
      status: "partial",
      codekStateSource: "TestingService coverage projections",
      vscodeSourcePaths: [...COVERAGE_OWNER_FEASIBILITY_AUDIT.vscodeSourcePaths],
      viewOwner: {
        status: "partial",
        evidenceFrom: "TestingService.getCoverageRendererShellProjection()",
        implementedOwners: [...renderer.adapter.implementedOwners],
        blockedOwners: [...renderer.adapter.blockedOwners],
        requiredOwners: [...COVERAGE_OWNER_FEASIBILITY_AUDIT.viewOwner.requiredOwners],
      },
      viewPaneOwnerContract: {
        ...COVERAGE_OWNER_FEASIBILITY_AUDIT.viewPaneOwnerContract,
        codekCanProvide: [...COVERAGE_OWNER_FEASIBILITY_AUDIT.viewPaneOwnerContract.codekCanProvide],
        vscodeRequiredOwners: [...COVERAGE_OWNER_FEASIBILITY_AUDIT.viewPaneOwnerContract.vscodeRequiredOwners],
      },
      editorContributionOwner: {
        status: "partial",
        evidenceFrom: "TestingService.getCoverageEditorContributionShellProjection()",
        implementedOwners: [...editorContribution.adapter.implementedOwners],
        blockedOwners: [...editorContribution.adapter.blockedOwners],
        requiredOwners: [...COVERAGE_OWNER_FEASIBILITY_AUDIT.editorContributionOwner.requiredOwners],
        genericEditorShellContract: cloneCoverageGenericEditorShellContract(),
      },
      fullOwnerMigration: {
        ...COVERAGE_OWNER_FEASIBILITY_AUDIT.fullOwnerMigration,
      },
      remainingBlockers: [...COVERAGE_OWNER_FEASIBILITY_AUDIT.remainingBlockers],
      noSecondState: true,
    }
  }

  cancelRun(payload: TestingCallbackCancelRunPayload): boolean {
    const runId = String(payload?.runId || "")
    if (!runId || !this.runs.has(runId) || !this.extensionHostCallbacks) return false
    this.extensionHostCallbacks.cancelRun({
      runId,
      taskId: payload?.taskId,
    })
    return true
  }

  configureProfile(payload: TestingCallbackConfigureProfilePayload): boolean {
    const controllerId = String(payload?.controllerId || "")
    const profileId = Number(payload?.profileId)
    if (!controllerId || !Number.isFinite(profileId) || !this.extensionHostCallbacks) return false
    const profile = this.getProfiles(controllerId).find((candidate) => candidate.profileId === profileId)
    if (!profile) return false
    this.extensionHostCallbacks.configureProfile({ controllerId, profileId })
    return true
  }

  async requestCoverageDetails(payload: TestingCallbackCoverageDetailsPayload): Promise<unknown[]> {
    const coverageId = String(payload?.coverageId || "")
    if (!coverageId || !this.extensionHostCallbacks) return []
    const file = this.coverageFiles.find((candidate) => candidate.id === coverageId)
    if (!file) return []
    return await this.extensionHostCallbacks.getCoverageDetails({
      coverageId,
      testId: payload?.testId,
    })
  }

  async provideTestFollowups(payload: TestingTestMessageFollowupRequest): Promise<TestingTestMessageFollowup[]> {
    const testId = String(payload?.testId || "")
    if (!testId || !this.extensionHostCallbacks) return []
    const followups = await this.extensionHostCallbacks.provideTestFollowups({
      testId,
      resultId: payload?.resultId,
      taskId: payload?.taskId,
      message: payload?.message,
    })
    return followups
      .filter((followup) => Number.isFinite(Number(followup?.id)) && String(followup?.title || "").trim())
      .map((followup) => ({
        id: Number(followup.id),
        title: String(followup.title),
        command: followup.command,
        args: Array.isArray(followup.args) ? [...followup.args] : undefined,
      }))
  }

  async executeTestFollowup(id: number): Promise<boolean> {
    const followupId = Number(id)
    if (!Number.isFinite(followupId) || !this.extensionHostCallbacks) return false
    await this.extensionHostCallbacks.executeTestFollowup(followupId)
    return true
  }

  disposeTestFollowups(ids: number[]): boolean {
    const followupIds = (Array.isArray(ids) ? ids : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id))
    if (followupIds.length === 0 || !this.extensionHostCallbacks) return false
    this.extensionHostCallbacks.disposeTestFollowups(followupIds)
    return true
  }

  createRunAction(request: { group: TestRunProfileGroup; testIds: string[]; controllerId?: string; profileId?: number }): TestRunActionDescriptor {
    const controllerId = request.controllerId || getControllerIdFromTestId(request.testIds[0]) || [...this.controllers.keys()][0]
    const profile = request.profileId !== undefined
      ? this.getProfiles(controllerId).find((item) => item.profileId === request.profileId && item.group === request.group)
      : this.getGroupDefaultProfiles(request.group, controllerId)[0]
    const commandId = getCommandIdForGroup(request.group)
    const enabled = Boolean(controllerId && profile)
    return {
      commandId,
      label: getActionLabel(request.group, profile),
      controllerId,
      profileId: profile?.profileId,
      group: request.group,
      testIds: [...request.testIds],
      enabled,
      safeToExecute: false,
      approvalRequired: request.group === "debug" || request.group === "coverage",
      mutatesWorkspace: false,
      mutatesGitIndex: false,
      evidenceUri: controllerId ? `codek-testing://${controllerId}/${request.group}/${encodeURIComponent(request.testIds.join(","))}` : undefined,
      reason: enabled ? undefined : `No default ${request.group} profile is registered for the selected tests`,
    }
  }

  appendResult(result: TestResultSnapshot): void {
    this.push(result)
  }

  clearResults(controllerId?: string): void {
    const removed: TestResultSnapshot[] = []
    if (!controllerId) {
      removed.push(...this.getResults())
      this.results.clear()
      if (removed.length > 0) this.onResultsChangedEmitter.fire({ removed })
      return
    }
    for (const [id, result] of this.results) {
      if (result.controllerId === controllerId) {
        removed.push(cloneResult(result))
        this.results.delete(id)
      }
    }
    if (removed.length > 0) this.onResultsChangedEmitter.fire({ removed })
  }

  getResults(controllerId?: string): TestResultSnapshot[] {
    return [...this.results.values()]
      .filter((result) => !controllerId || result.controllerId === controllerId)
      .map((result) => ({ ...result, messages: [...result.messages], retired: result.retired === true }))
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
  }

  clear(): void {
    this.clearResults()
  }

  push(result: TestResultSnapshot): TestResultSnapshot {
    if (!result.id) return cloneResult(result)
    const cloned = { ...result, messages: [...result.messages], retired: result.retired === true }
    this.results.set(cloned.id, cloned)
    this.onResultsChangedEmitter.fire({ inserted: cloneResult(cloned) })
    this.onTestChangedEmitter.fire({ result: cloneResult(cloned), reason: "computedStateChange" })
    return cloneResult(cloned)
  }

  getResult(resultId: string): TestResultSnapshot | undefined {
    const result = this.results.get(resultId)
    return result ? cloneResult(result) : undefined
  }

  getStateById(testId: string): [result: TestResultSnapshot, item: TestResultSnapshot] | undefined {
    const runIds = [...this.runs.keys()]
    const result = this.getResults()
      .sort((a, b) => {
        const aRun = getRunIdForResult(a.id, runIds)
        const bRun = getRunIdForResult(b.id, runIds)
        const aCompleted = aRun ? this.runs.get(aRun)?.completedAt ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY
        const bCompleted = bRun ? this.runs.get(bRun)?.completedAt ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY
        return bCompleted - aCompleted || a.id.localeCompare(b.id)
      })
      .find((item) => item.testId === testId && item.state !== "queued")
    return result ? [cloneResult(result), cloneResult(result)] : undefined
  }

  getRunSummary(controllerId?: string): TestRunSummary {
    const results = this.getResults(controllerId)
    return {
      total: results.length,
      passed: results.filter((result) => result.state === "passed").length,
      failed: results.filter((result) => result.state === "failed").length,
      running: results.filter((result) => result.state === "running" || result.state === "queued").length,
      skipped: results.filter((result) => result.state === "skipped").length,
      errored: results.filter((result) => result.state === "errored").length,
      state: resolveSummaryState(results),
    }
  }

  getProjection(controllerId?: string): TestingProjection {
    const controllers = [...this.controllers.values()]
      .filter((controller) => !controllerId || controller.id === controllerId)
      .map((controller) => ({ ...controller }))
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    return {
      controllers,
      profiles: this.getProfiles(controllerId),
      items: this.getItems(controllerId),
      runs: this.getRuns(controllerId),
      results: this.getResults(controllerId),
      runSummary: this.getRunSummary(controllerId),
      resultHistory: this.getResultHistoryProjection(controllerId),
      resultStorage: this.getResultStorageProjection(controllerId),
      testResultsViewPaneShell: this.getTestResultsViewPaneShellProjection(controllerId),
      coverage: this.getCoverage(),
      resultPeek: this.getResultPeekProjection(controllerId),
      coverageTree: this.getCoverageTreeProjection(),
      coverageView: this.getCoverageViewProjection(),
      coverageDecorations: this.getCoverageEditorDecorationsProjection(),
      coverageRendererShell: this.getCoverageRendererShellProjection(),
      coverageEditorContributionShell: this.getCoverageEditorContributionShellProjection(),
      coverageOwnerFeasibility: this.getCoverageOwnerFeasibilityAudit(),
      continuousContextKeys: this.getContinuousContextKeyProjection(controllerId),
      testingExplorerContract: this.getTestingExplorerContractProjection({ controllerId }),
      upperOwnerProjection: this.getUpperOwnerProjection(controllerId),
      actions: this.createDefaultActions(controllerId),
      contract: this.getContractAudit(),
    }
  }

  getContractAudit(): TestingContractAudit {
    return cloneContractAudit(TESTING_CONTRACT_AUDIT)
  }

  getUpperOwnerProjection(controllerId?: string): TestingUpperOwnerProjection {
    const items = this.getItems(controllerId)
    const runs = this.getRuns(controllerId)
    const results = this.getResults(controllerId)
    const profiles = this.getProfiles(controllerId)
    const history = this.getResultHistoryProjection(controllerId)
    const storage = this.getResultStorageProjection(controllerId)
    const resultPeek = this.getResultPeekProjection(controllerId)
    const ownerContracts = this.getContractAudit().ownerContracts
    const outputMessageCount = runs.reduce((count, run) => count + run.output.length, 0)
    const runningRuns = runs.filter((run) => run.completedAt === undefined)
    const completedRuns = runs.filter((run) => run.completedAt !== undefined)
    const defaultsByControllerAndGroup: Record<string, Partial<Record<TestRunProfileGroup, number[]>>> = {}
    const fallbackProfileIdsByControllerAndGroup: Record<string, Partial<Record<TestRunProfileGroup, number | undefined>>> = {}
    for (const profile of profiles) {
      defaultsByControllerAndGroup[profile.controllerId] ||= {}
      fallbackProfileIdsByControllerAndGroup[profile.controllerId] ||= {}
      if (profile.isDefault) {
        const defaults = defaultsByControllerAndGroup[profile.controllerId][profile.group] || []
        defaults.push(profile.profileId)
        defaultsByControllerAndGroup[profile.controllerId][profile.group] = defaults.sort((a, b) => a - b)
      }
    }
    for (const controllerId of [...new Set(profiles.map((profile) => profile.controllerId))].sort((a, b) => a.localeCompare(b))) {
      for (const group of ["run", "debug", "coverage"] as const) {
        const fallback = this.getGroupDefaultProfiles(group, controllerId)[0]
        fallbackProfileIdsByControllerAndGroup[controllerId][group] = fallback?.profileId
      }
    }
    const messageCount = resultPeek.entries.reduce((count, entry) => count + entry.messages.length, 0)
    const messagesWithLocationCount = resultPeek.entries.reduce((count, entry) => count + (entry.locationUri ? entry.messages.length : 0), 0)
    const retiredResults = results.filter((result) => result.retired === true)
    const retiredResultIds = retiredResults.map((result) => result.id).sort((a, b) => a.localeCompare(b))
    const retiredTestIds = [...new Set(retiredResults.map((result) => result.testId))].sort((a, b) => a.localeCompare(b))

    return cloneUpperOwnerProjection({
      status: "partial",
      stateSource: "TestingService controllers/profiles/items/runs/results/output",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/testing/common/testService.ts",
        "src/vs/workbench/contrib/testing/common/testServiceImpl.ts",
        "src/vs/workbench/contrib/testing/common/testResultService.ts",
        "src/vs/workbench/contrib/testing/common/testResult.ts",
        "src/vs/workbench/contrib/testing/common/testProfileService.ts",
        "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
        "src/vs/workbench/contrib/testing/browser/testingOutputPeek.ts",
        "src/vs/workbench/contrib/testing/browser/testCoverageView.ts",
        "src/vs/workbench/contrib/testing/browser/codeCoverageDecorations.ts",
      ],
      collection: {
        status: "projected",
        controllerCount: controllerId ? (this.controllers.has(controllerId) ? 1 : 0) : this.controllers.size,
        itemCount: items.length,
        rootIds: items.filter((item) => !item.parentId).map((item) => item.id).sort((a, b) => a.localeCompare(b)),
        busyItemIds: items.filter((item) => item.busy === true).map((item) => item.id).sort((a, b) => a.localeCompare(b)),
        diffListener: {
          status: "blocked",
          forwardedBridge: "MainThreadTesting.$subscribeToDiffs -> ExtHostTesting.$syncTests",
          blockedOwner: "ITestService.collection onDidProcessDiff listener",
          blockedReason: "TestingService can expose collection snapshots and busy item evidence, while VS Code's disposable onDidProcessDiff listener remains owned by TestService/MainThreadTestCollection.",
        },
        noSecondState: true,
      },
      resultService: {
        status: history.status === "available" ? "projected" : "projected",
        retainedRunCount: history.retainedRunCount,
        retainedResultCount: history.retainedResultCount,
        runningRunIds: runningRuns.map((run) => run.id).sort((a, b) => a.localeCompare(b)),
        completedRunIds: completedRuns.map((run) => run.id).sort((a, b) => a.localeCompare(b)),
        outputMessageCount,
        retiredResultIds,
        eventProjection: {
          onResultsChanged: "emitter-backed",
          onTestChanged: "emitter-backed",
          owner: "TestingService onResultsChanged/onTestChanged",
        },
        storage: {
          status: "projected",
          owner: "TestingService.getResultStorageProjection()",
          storageKey: storage.storageKey,
          blockedOwners: [...storage.adapter.blockedOwners],
          fileBackedOwnerMatrix: cloneOwnerGapMatrix(storage.fileBackedOwnerMatrix),
          blockedReason: "TestingService can serialize retained completed results through getResultStorageProjection() using the same runs/results/output maps and VS Code storedTestResults key evidence. It still does not own VS Code's file-service-backed TestResultStorage cleanup/output-stream implementation.",
        },
        noSecondState: true,
      },
      liveResultLifecycle: {
        status: "partial",
        runningRunIds: runningRuns.map((run) => run.id).sort((a, b) => a.localeCompare(b)),
        completedRunIds: completedRuns.map((run) => run.id).sort((a, b) => a.localeCompare(b)),
        cancellableRunIds: resultPeek.entries.filter((entry) => entry.canCancel).map((entry) => entry.runId).filter((id, index, ids) => ids.indexOf(id) === index).sort((a, b) => a.localeCompare(b)),
        retiredResultIds,
        retiredTestIds,
        lifecycleMatrix: cloneOwnerGapMatrix(LIVE_TEST_RESULT_LIFECYCLE_MATRIX),
        blockedOwners: [
          "LiveTestResult task model",
          "LiveTestResult onChange/onComplete events",
          "dispose/telemetry lifecycle",
        ],
        blockedReason: "TestingService tracks run snapshots, completion timestamps, output, cancellable peek entries, and retired result evidence, but it does not own VS Code LiveTestResult task objects, emitters, disposal, or telemetry.",
        noSecondState: true,
      },
      profileDefaults: {
        status: "projected",
        defaultsByControllerAndGroup,
        fallbackProfileIdsByControllerAndGroup,
        blockedOwners: [
          "TestProfileService StoredValue preferred-profile persistence",
          "TestProfileService onDidChange default synchronization",
          "ExtHostTesting.$setDefaultRunProfiles",
        ],
        blockedReason: "TestingService can compute effective default profiles from profile snapshots, including VS Code-style first-profile fallback, but it does not own persisted preferred defaults or default-profile back-propagation to ExtHostTesting.",
        noSecondState: true,
      },
      messageFollowups: {
        status: "partial",
        resultPeekEntryCount: resultPeek.entries.length,
        messageCount,
        messagesWithLocationCount,
        implementedOwners: [
          "TestingService.provideTestFollowups provider facade",
          "TestingService.executeTestFollowup execution facade",
          "TestingService.disposeTestFollowups handle disposal facade",
          "ExtHostTesting.$provideTestFollowups/$executeTestFollowup/$disposeTestFollowups bridge",
        ],
        blockedOwners: [
          "TestingOutputPeekController/PeekViewWidget owner for visible message reveal",
          "OutputPeekTree/TestMessageElement owner for selecting a TestMessage subject",
          "TestResultsViewContent FollowupActionWidget owner for requesting, rendering, executing, and disposing followup handles",
        ],
        blockedReason: "TestingService can bridge provider/execute/dispose callbacks through the extension host, but Codek only has a result-peek shell descriptor. It does not own the VS Code TestingOutputPeekController/PeekViewWidget, OutputPeekTree/TestMessageElement, or TestResultsViewContent FollowupActionWidget that make a TestMessage visible, request followups for it, render actions, execute selections, and dispose handles when the visible subject changes.",
        noSecondState: true,
      },
      uiOwners: {
        status: "blocked",
        testingExplorer: ownerContracts.testExplorerTree,
        resultPeek: ownerContracts.resultPeek,
        coverageEditor: ownerContracts.coverageEditor,
        noSecondState: true,
      },
      noSecondState: true,
    })
  }

  reset(): void {
    this.controllers.clear()
    this.profiles.clear()
    this.items.clear()
    this.runs.clear()
    this.results.clear()
    this.coverageFiles = []
    this.selectedCoverageId = undefined
    this.coverageFilterToTestId = undefined
    this.coverageShowInline = false
    this.coverageSortOrder = "location"
    this.extensionHostCallbacks = null
  }

  private getSelectedCoverageFile(files: TestCoverageFileSnapshot[]): TestCoverageFileSnapshot | undefined {
    if (this.selectedCoverageId) {
      const selected = files.find((file) => file.id === this.selectedCoverageId)
      if (selected) return selected
    }
    return files[0]
  }

  private getProfiles(controllerId?: string): TestRunProfileSnapshot[] {
    const profiles = controllerId
      ? this.profiles.get(controllerId) || []
      : [...this.profiles.values()].flat()
    return sortProfiles(profiles).map((profile) => ({ ...profile }))
  }

  getContinuousContextKeyProjection(controllerId?: string): TestingContinuousContextKeyProjection {
    const profiles = this.getProfiles(controllerId)
    const runs = this.getRuns(controllerId)
    const items = this.getItems(controllerId)
    const supportsContinuousRun = profiles.some((profile) => profile.supportsContinuousRun === true)
    const activeContinuousRuns = runs.filter((run) => run.continuous === true && (run.state === "running" || run.state === "queued"))
    const continuousRunTestIds = new Set<string>()
    let isContinuousModeOn = false
    for (const run of activeContinuousRuns) {
      if (run.testIds.length === 0) {
        isContinuousModeOn = true
        continue
      }
      for (const testId of run.testIds) {
        continuousRunTestIds.add(testId)
      }
    }
    if (continuousRunTestIds.size > 0) isContinuousModeOn = true

    const serviceLevelKeys: ContextKeyState = {
      "testing.supportsContinuousRun": supportsContinuousRun,
      "testing.isContinuousModeOn": isContinuousModeOn,
    }
    const itemContextKeys = items.map((item) => {
      const itemSupportsContinuousRun = profiles.some((profile) =>
        profile.supportsContinuousRun === true && profile.controllerId === item.controllerId,
      )
      const itemContinuous = isTestIdOrDescendantOfAny(item.id, continuousRunTestIds)
      const parentContinuous = isParentContinuous(item, this.items, continuousRunTestIds)
      return {
        testId: item.id,
        controllerId: item.controllerId,
        supportsContinuousRun: itemSupportsContinuousRun,
        isContinuousModeOn: itemSupportsContinuousRun && itemContinuous,
        isParentRunningContinuously: itemSupportsContinuousRun && parentContinuous,
        contextKeyState: {
          "testing.supportsContinuousRun": itemSupportsContinuousRun,
          "testing.isContinuousModeOn": itemSupportsContinuousRun && itemContinuous,
          "testing.isParentRunningContinuously": itemSupportsContinuousRun && parentContinuous,
        },
      }
    })

    return {
      stateSource: "TestingService profiles+runs+items",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/testing/common/testingContextKeys.ts",
        "src/vs/workbench/contrib/testing/common/testingContinuousRunService.ts",
        "src/vs/workbench/contrib/testing/common/testProfileService.ts",
        "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
      ],
      serviceLevelKeys,
      itemContextKeys,
      implementedKeys: [
        "testing.supportsContinuousRun",
        "testing.isContinuousModeOn",
        "testing.isParentRunningContinuously",
      ],
      menuOverlayBlockedKeys: [
        "testing.isParentRunningContinuously",
      ],
      blockedKeys: [],
      blockedReason: "TestingService can derive service-level and item-level continuous context-key evidence from the single profiles/runs/items projection, including testing.isParentRunningContinuously. The remaining blocked owner is the TestingExplorerView/MenuId.TestItem overlay and action runner that would bind those item keys to visible Explorer DOM actions.",
      noSecondState: true,
    }
  }

  getTestingExplorerContractProjection(options: TestingExplorerContractProjectionOptions = {}): TestingExplorerContractProjection {
    const rows = this.getItems(options.controllerId)
    const controllerSnapshots = [...this.controllers.values()]
      .filter((controller) => !options.controllerId || controller.id === options.controllerId)
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    const profiles = this.getProfiles(options.controllerId)
    const actions = this.createDefaultActions(options.controllerId)
    const profileIdsByController: Record<string, number[]> = {}
    const itemCountByController: Record<string, number> = {}
    for (const controller of controllerSnapshots) {
      profileIdsByController[controller.id] = profiles
        .filter((profile) => profile.controllerId === controller.id)
        .map((profile) => profile.profileId)
        .sort((a, b) => a - b)
      itemCountByController[controller.id] = rows.filter((item) => item.controllerId === controller.id).length
    }
    const itemsById = new Map(rows.map((item) => [item.id, item]))
    const retiredTestIds = new Set(this.getResults(options.controllerId).filter((result) => result.retired === true).map((result) => result.testId))
    const revealId = options.revealTestId || options.persistedState?.revealId || options.persistedState?.selectedId
    const revealAncestors = new Set(revealId ? getParentChainIds(revealId, this.items) : [])
    const continuousContext = this.getContinuousContextKeyProjection(options.controllerId)
    const continuousById = new Map(continuousContext.itemContextKeys.map((item) => [item.testId, item]))
    const activeContinuousRuns = this.getRuns(options.controllerId)
      .filter((run) => run.continuous === true && (run.state === "running" || run.state === "queued"))
    const runs = this.getRuns(options.controllerId)
    const results = this.getResults(options.controllerId)
    const runningRuns = runs.filter((run) => run.completedAt === undefined)
    const completedRuns = runs.filter((run) => run.completedAt !== undefined)
    const prefixRunningRoots = [...new Set(activeContinuousRuns.flatMap((run) => run.testIds.length ? run.testIds : [run.controllerId]))]
      .sort((a, b) => a.localeCompare(b))
    const persistedExpandedIds = [...new Set(options.persistedState?.expandedIds || rows.filter((item) => item.expand === "expanded").map((item) => item.id))]
    const persistedViewMode = options.persistedState?.viewMode || "tree"
    const persistedSorting = options.persistedState?.sorting || "location"
    const selectedId = options.persistedState?.selectedId || revealId
    const visibleRows = applyTestingExplorerProjection(rows, persistedViewMode, persistedSorting)
    const visibleRowIds = visibleRows.map((item) => item.id)
    const appliedRowIds = rows.map((item) => item.id)

    const projection: TestingExplorerContractProjection = {
      status: "partial",
      stateSource: "TestingService.getProjection().items/runs/profiles",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
        "src/vs/workbench/contrib/testing/browser/explorerProjections/treeProjection.ts",
        "src/vs/workbench/contrib/testing/browser/explorerProjections/testingObjectTree.ts",
        "src/vs/workbench/contrib/testing/browser/testingViewPaneContainer.ts",
        "src/vs/workbench/contrib/testing/browser/testExplorerActions.ts",
        "src/vs/workbench/contrib/testing/browser/testingExplorerFilter.ts",
        "src/vs/workbench/contrib/testing/common/testExplorerFilterState.ts",
        "src/vs/workbench/contrib/testing/common/testService.ts",
        "src/vs/workbench/contrib/testing/common/testingContinuousRunService.ts",
        "src/vs/workbench/contrib/testing/common/storedValue.ts",
      ],
      ownerEvidence: {
        status: "partial",
        stateSource: "TestingService controllers/profiles/items/runs/results/output",
        vscodeSourcePaths: [
          "src/vs/workbench/contrib/testing/common/testService.ts",
          "src/vs/workbench/contrib/testing/common/testServiceImpl.ts",
          "src/vs/workbench/api/common/extHostTesting.ts",
          "src/vs/workbench/api/browser/mainThreadTesting.ts",
          "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
          "src/vs/workbench/contrib/testing/browser/explorerProjections/testingObjectTree.ts",
        ],
        testServiceOwner: {
          status: "partial",
          codekOwner: "TestingService",
          source: "TestingService controllers/profiles/items/runs/results/output",
          serviceIds: [String(ITestingService), String(ITestProfileService), String(ITestResultService)],
          implementedEvidence: [
            "ITestService/ITestProfileService/ITestResultService aliases register the same globalTestingService instance",
            "TestingService holds controller/profile/item/run/result/output maps as the only renderer Testing state source",
            "MainThreadTesting bridge forwards VS Code Testing RPC events into the same TestingService facade",
          ],
          blockedOwners: [
            "VS Code TestService/MainThreadTestCollection disposable diff-listener owner",
            "full TestProfileService preferred-profile persistence owner",
            "LiveTestResult/TestResultService file-backed storage owner",
          ],
          noSecondState: true,
        },
        testControllerOwner: {
          status: "projected",
          codekOwner: "TestingService controllers/profiles/items",
          source: "MainThreadTesting controller/profile/item events -> TestingService",
          controllerIds: controllerSnapshots.map((controller) => controller.id),
          profileIdsByController,
          itemCountByController,
          noSecondState: true,
        },
        testExplorerOwner: {
          status: "partial",
          codekOwner: "TestingService.getTestingExplorerContractProjection()",
          source: "TestingService rows + commandRegistry action descriptors",
          visibleRowIds,
          blockedOwners: [
            "TestingExplorerView ViewPane instance",
            "TestingObjectTree WorkbenchObjectTree DOM virtualization",
            "TestingExplorerFilter input DOM + TestExplorerFilterState owner",
            "MenuId.TestItem/MenuId.ViewTitle action bars",
          ],
          noSecondState: true,
        },
        resultOwner: {
          status: "projected",
          codekOwner: "TestingService runs/results/output",
          source: "TestingService.startRun()/updateRunItemState()/completeRun()",
          retainedRunCount: runs.length,
          retainedResultCount: results.length,
          runningRunIds: runningRuns.map((run) => run.id).sort((a, b) => a.localeCompare(b)),
          completedRunIds: completedRuns.map((run) => run.id).sort((a, b) => a.localeCompare(b)),
          noSecondState: true,
        },
        runProfileOwner: {
          status: "projected",
          codekOwner: "TestingService profiles",
          source: "TestingService.addProfile()/updateProfile()",
          profileIdsByController,
          defaultProfileIdsByControllerAndGroup: buildDefaultProfileIdsByControllerAndGroup(profiles),
          noSecondState: true,
        },
        testItemSource: {
          status: "projected",
          source: "TestingService.upsertItem()",
          rowCount: rows.length,
          rootIds: rows.filter((item) => !item.parentId).map((item) => item.id).sort((a, b) => a.localeCompare(b)),
          sampleEvidenceUris: rows.slice(0, 5).map((item) => `codek-testing://explorer/${encodeURIComponent(item.id)}`),
          noSecondState: true,
        },
        remainingUiOwnerGap: {
          status: "blocked",
          blockedOwners: [
            "TestingExplorerView ViewPane renderBody lifecycle",
            "TestingObjectTree DOM owner and renderer action bar",
            "TestResultsViewContent/TestingOutputPeek visible result owner",
            "generic workbench shell/App.vue wiring outside this TestingService-only lane",
          ],
          blockedReason: "TestingService can project owner/source evidence for TestService, controllers, profiles, items, runs, and results. Full Test Explorer UI owner remains blocked until the real ViewPane/ObjectTree/filter/action-bar owners are migrated in the workbench shell; this projection must not mark that UI owner connected.",
          noSecondState: true,
        },
        noSecondState: true,
      },
      controllerOwner: {
        status: "projected",
        codekOwner: "TestingService controllers/profiles/items",
        vscodeSourcePath: "src/vs/workbench/api/browser/mainThreadTesting.ts",
        controllerIds: controllerSnapshots.map((controller) => controller.id),
        profileIdsByController,
        itemCountByController,
        implementedEvidence: [
          "controller snapshots from TestingService.registerController()",
          "profile snapshots from TestingService.addProfile()/updateProfile()",
          "test item rows from TestingService.upsertItem()",
          "MainThreadTesting bridge event channels feed the same TestingService state",
        ],
        blockedOwners: [
          "VS Code IMainThreadTestController object identity and observable capabilities",
          "Full ITestService.registerTestController ownership alias",
        ],
        noSecondState: true,
      },
      rows: rows.map((item) => {
        const continuous = continuousById.get(item.id)
        return {
          id: item.id,
          controllerId: item.controllerId,
          label: item.label,
          uri: item.uri,
          parentId: item.parentId,
          depth: item.depth,
          prefixPath: getTestIdPrefixPath(item.id),
          parentChain: getParentChainIds(item.id, this.items),
          childIds: [...item.childrenIds],
          expand: item.expand,
          revealState: item.id === revealId ? "target" : revealAncestors.has(item.id) ? "ancestor" : "none",
          retired: isTestOrDescendantRetired(item.id, retiredTestIds),
          isRunningContinuously: continuous?.isContinuousModeOn === true,
          isParentRunningContinuously: continuous?.isParentRunningContinuously === true,
          commandIds: [
            TESTING_RUN_COMMAND_IDS.Run,
            TESTING_RUN_COMMAND_IDS.Debug,
            TESTING_RUN_COMMAND_IDS.Coverage,
            TESTING_CALLBACK_COMMAND_IDS.ConfigureProfile,
            TESTING_RUN_COMMAND_IDS.ToggleContinuousRunForTest,
          ],
          evidenceUri: `codek-testing://explorer/${encodeURIComponent(item.id)}`,
        }
      }),
      actionOwner: {
        status: "partial",
        codekOwner: "TestingService.createRunAction()+commandRegistry",
        vscodeSourcePaths: [
          "src/vs/workbench/contrib/testing/browser/testExplorerActions.ts",
          "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
          "src/vs/workbench/contrib/testing/common/testService.ts",
        ],
        actions,
        commandExecution: [
          {
            commandId: TESTING_RUN_COMMAND_IDS.Run,
            status: "registered-command-facade",
            evidence: "testing.run resolves through commandRegistry to TestingService.createRunAction({ group: 'run' }) and TestingService.startRun().",
          },
          {
            commandId: TESTING_RUN_COMMAND_IDS.Debug,
            status: "registered-command-facade",
            evidence: "testing.debug resolves through commandRegistry to TestingService.createRunAction({ group: 'debug' }) and TestingService.startRun().",
          },
          {
            commandId: TESTING_RUN_COMMAND_IDS.Coverage,
            status: "registered-command-facade",
            evidence: "testing.coverage resolves through commandRegistry to TestingService.createRunAction({ group: 'coverage' }) and TestingService.startRun().",
          },
        ],
        blockedOwners: [
          "TestingExplorerView runInView visible action runner",
          "MenuId.TestItem/TestItemGutter action overlay",
          "MenuId.ViewTitle action runner scoped to Testing.ExplorerViewId",
          "profile picker and action-bar UI ownership",
        ],
        noSecondState: true,
      },
      persistedState: {
        status: "projected",
        source: "external TestingExplorerView persistedState input",
        expandedIds: persistedExpandedIds,
        selectedId,
        revealId,
        viewMode: persistedViewMode,
        sorting: persistedSorting,
        blockedOwner: "IStorageService/StoredValue owned by VS Code TestingExplorerView",
      },
      viewModelAdapter: {
        status: "partial",
        codekOwner: "TestingService.getTestingExplorerContractProjection()",
        stateSource: "TestingService items/runs/profiles + persistedState input",
        vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts#TestingExplorerViewModel",
        projectionKind: persistedViewMode === "list" ? "ListProjection" : "TreeProjection",
        viewMode: persistedViewMode,
        sorting: persistedSorting,
        welcomeExperience: rows.length > 0 ? "none" : "workspace",
        hasPendingReveal: Boolean(revealId && !itemsById.has(revealId)),
        revealId,
        selectedId,
        appliedRowIds,
        implementedEvidence: [
          "projection mode and sorting are derived from persistedState input, matching TestingExplorerViewModel viewMode/viewSorting storage reads",
          "applied rows are derived from TestingService.getItems() and not a second tree store",
          "reveal pending state is derived from revealId existence in TestingService items",
          "VS Code TestingExplorerView renderBody creates TestingExplorerViewModel over .test-explorer-tree; Codek only projects the model inputs and row ids",
        ],
        blockedOwners: [
          "TestingExplorerViewModel MutableDisposable<ITestTreeProjection> lifecycle",
          "RunOnceScheduler applyProjectionChanges/refilter timing",
          "NoTestsForDocumentWidget and editor-resource filter subscriptions",
          "ITestResultService.onTestChanged follow-running reveal listener",
        ],
        noSecondState: true,
      },
      objectTreeAdapter: {
        status: "partial",
        codekOwner: "TestingService.getTestingExplorerContractProjection()",
        stateSource: "TestingService item parent/child links",
        vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/explorerProjections/testingObjectTree.ts",
        identityProvider: "TestingObjectTree element.treeId -> TestingService row.id",
        optimizedViewState: buildTestingExplorerOptimizedViewState(rows, persistedExpandedIds),
        visibleRowIds,
        focusedRowId: selectedId && visibleRowIds.includes(selectedId) ? selectedId : undefined,
        selectedRowId: selectedId && visibleRowIds.includes(selectedId) ? selectedId : undefined,
        implementedEvidence: [
          "optimized view state is derived from TestingService row ids using the VS Code TestId local-id shape",
          "visible row ids use the same TestingService rows with tree/list ordering applied",
          "selection/focus evidence is projected from persistedState selectedId/revealId",
        ],
        blockedOwners: [
          "TestingObjectTree extends WorkbenchObjectTree DOM virtualization and element lifecycle",
          "TestingObjectTree.getOptimizedViewState live collapse-state saver",
          "TreeRenderer/TestItemRenderer action bar rendering",
          "IdentityProvider/ListAccessibilityProvider keyboard navigation bindings",
        ],
        noSecondState: true,
      },
      filterActionAdapter: {
        status: "partial",
        codekOwner: "TestingService.getContinuousContextKeyProjection()+TestingService.createRunAction()",
        stateSource: "TestingService profiles/runs/items",
        vscodeSourcePaths: [
          "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts#TestsFilter",
          "src/vs/workbench/contrib/testing/browser/testingExplorerFilter.ts",
          "src/vs/workbench/contrib/testing/common/testExplorerFilterState.ts",
          "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts#getActionableElementActions",
          "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts#TestExplorerActionRunner",
          "src/vs/workbench/contrib/testing/common/testingContextKeys.ts",
        ],
        filterTerms: {
          currentDoc: "blocked-dom-owner",
          openedFiles: "blocked-editor-owner",
          hidden: "projected",
          failed: "projected",
          executed: "projected",
          text: "blocked-filter-input-owner",
        },
        contextKeys: [
          ...continuousContext.implementedKeys,
          "view == workbench.view.testing",
          "testing.canRefreshTests",
          "testing.testItemIsHidden",
          "testing.testResultOutdated",
          "testing.testResultState",
        ],
        actionRunner: "registered-command-facade",
        blockedOwners: [
          "TestingExplorerFilter input and TestExplorerFilterState glob/text owner",
          "MenuId.TestItem context overlay creation per visible tree element",
          "TestExplorerActionRunner selection/context routing for MenuItemAction",
          "MenuId.ViewTitle action runner scoped to Testing.ExplorerViewId",
          "ViewTitle action bar refresh through TestingExplorerView.updateActions()",
        ],
        noSecondState: true,
      },
      domOwnerAdapter: {
        status: "partial",
        codekOwner: "TestingService.getTestingExplorerContractProjection()",
        stateSource: "TestingService rows + filter/action adapter",
        vscodeSourcePaths: [
          "src/vs/workbench/contrib/testing/browser/testing.contribution.ts",
          "src/vs/workbench/contrib/testing/browser/testingViewPaneContainer.ts",
          "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
          "src/vs/workbench/contrib/testing/browser/explorerProjections/testingObjectTree.ts",
          "src/vs/workbench/contrib/testing/browser/testingExplorerFilter.ts",
          "src/vs/workbench/contrib/testing/common/testExplorerFilterState.ts",
        ],
        containerSelector: '[data-codek-smoke="testing-explorer-viewpane-shell-owner"]',
        treeSelector: '[data-testing-explorer-object-tree="true"]',
        rowSelector: "[data-testing-explorer-row-id]",
        filterInputSelector: '[data-testing-explorer-filter-input="true"]',
        storageKey: "testing.filterHistory2",
        rowCount: visibleRowIds.length,
        visibleRowIds,
        filterInput: {
          ...parseTestingExplorerFilterText(options.persistedState?.filterText || ""),
          placeholder: "Filter (e.g. text, !exclude, @tag)",
          blockedOwner: "TestingExplorerFilter input DOM + TestExplorerFilterState",
        },
        dataAttributes: {
          stateSource: "data-testing-explorer-state-source",
          rowId: "data-testing-explorer-row-id",
          rowDepth: "data-testing-explorer-row-depth",
          rowRevealState: "data-testing-explorer-row-reveal-state",
          rowRetired: "data-testing-explorer-row-retired",
          rowRunningContinuously: "data-testing-explorer-row-running-continuously",
          rowParentRunningContinuously: "data-testing-explorer-row-parent-running-continuously",
          rowCommandIds: "data-testing-explorer-row-command-ids",
          filterValue: "data-testing-explorer-filter-value",
          noSecondState: "data-testing-explorer-no-second-state",
        },
        implementedEvidence: [
          "App.vue Testing Explorer DOM hook renders shell/filter/object-tree attributes from TestingService rows/filter/action projections.",
          "row data attributes map directly to TestingExplorerContractProjection.rows without a second tree store.",
          "filter input text is parsed with VS Code-compatible @term/@controller:tag/glob evidence for contract tests.",
          "ViewPaneContainer/TestingViewPaneContainer evidence is represented as a DOM shell selector only; Codek does not claim the VS Code container instance.",
          "IStorageService evidence is limited to external persistedState input and storage-key reporting; Codek does not write VS Code StoredValue state.",
          "MenuId.TestItem/MenuId.ViewTitle evidence is limited to command ids and context-key projections; visible action runner ownership remains blocked.",
        ],
        blockedOwners: [
          "TestingExplorerView extends ViewPane renderBody/layoutBody/focus",
          "TestingViewPaneContainer sidebar container DOM owner",
          "TestingObjectTree extends WorkbenchObjectTree DOM virtualization and element lifecycle",
          "TestingExplorerFilter input widget, suggest history, and dropdown action bar",
          "IStorageService/StoredValue-backed filter history, fuzzy state, view mode, sorting, and collapse persistence",
          "MenuId.TestItem/MenuId.ViewTitle visible action runner",
        ],
        noSecondState: true,
      },
      domOwnerMatrix: cloneOwnerGapMatrix(TESTING_EXPLORER_DOM_OWNER_MATRIX),
      lifecycle: {
        activeContinuousRunIds: activeContinuousRuns.map((run) => run.id).sort((a, b) => a.localeCompare(b)),
        prefixRunningRoots,
        restartOnProfileChange: {
          status: "blocked",
          blockedOwner: "TestingContinuousRunService autorunIterableDelta + CancellationTokenSource",
          blockedReason: "TestingService can project active continuous runs, but it does not own VS Code's profile-change autorun restart loop or CancellationTokenSource cancellation lifecycle.",
        },
        cancelOrder: {
          status: "projected",
          order: getContinuousCancelOrder(prefixRunningRoots, itemsById),
          evidence: "Order is derived from TestingService parent/child links so descendants are listed before running roots, matching VS Code's child-before-parent cancellation intent without owning CancellationTokenSource handles.",
        },
      },
      implementedEvidence: [
        "parent-child rows from TestingService.getItems()",
        "prefix paths from VS Code TestId delimiter-compatible ids",
        "reveal target/ancestor state from caller input plus TestingService parent links",
        "active continuous run ids and parent-running evidence from TestingService runs",
        "TestingExplorerViewModel/ObjectTree adapter evidence from the same rows/context-key projection",
        "ViewPaneContainer/WorkbenchObjectTree/IStorageService/MenuId owner evidence is recorded as partial projection plus explicit blocked owner matrix",
      ],
      blockedOwners: [
        "TestingExplorerView ViewPane DOM/layout/focus owner",
        "TestingViewPaneContainer sidebar container owner",
        "TestingExplorerViewModel and TestingObjectTree lifecycle",
        "WorkbenchObjectTree DOM virtualization and keyboard accessibility owner",
        "IStorageService/StoredValue-backed TestingExplorerView view mode/sorting/filter/collapse persistence",
        "MenuId.TestItem/MenuId.ViewTitle visible action runner owner",
        "TestingContinuousRunService WellDefinedPrefixTree and CancellationTokenSource restart/cancel handles",
      ],
      blockedReason: "TestingService can project the Testing Explorer tree, reveal target, persisted-state payload, and continuous run lifecycle evidence from one state source. Claiming the full VS Code owner still requires TestingExplorerView/ViewPaneContainer DOM, TestingExplorerViewModel/WorkbenchObjectTree lifecycle, IStorageService/StoredValue persistence, MenuId.TestItem/ViewTitle action runner, WellDefinedPrefixTree, and CancellationTokenSource ownership.",
      nextAuthorizedFiles: [
        "frontend/vite-project/src/testing/testingService.ts",
        "frontend/vite-project/src/testing/testingService.test.ts",
        "frontend/vite-project/src/workbench/viewRegistry.ts",
        "frontend/vite-project/src/vscode-adapter/platform/actions/common/menuService.ts",
      ],
      noSecondState: true,
    }

    return cloneTestingExplorerContractProjection(projection)
  }

  startContinuousRun(request: TestingContinuousRunRequest = {}): TestRunSnapshot | undefined {
    const controllerId = request.controllerId || getControllerIdFromTestId(request.testId) || [...this.controllers.keys()][0]
    if (!controllerId) return undefined
    const group = request.group || "run"
    const profile = request.profileId !== undefined
      ? this.getProfiles(controllerId).find((candidate) =>
        candidate.profileId === request.profileId && candidate.group === group && candidate.supportsContinuousRun === true,
      )
      : this.getGroupDefaultProfiles(group, controllerId).find((candidate) => candidate.supportsContinuousRun === true)
    if (!profile) return undefined
    const testIds = request.testId ? [request.testId] : [controllerId]
    const id = getContinuousRunId(controllerId, profile.profileId, testIds)
    const existing = this.runs.get(id)
    if (existing && existing.continuous === true && (existing.state === "running" || existing.state === "queued")) {
      return cloneRun(existing)
    }
    return this.startRun({
      id,
      controllerId,
      profileId: profile.profileId,
      group: profile.group,
      testIds,
      label: profile.label || "Continuous run",
      continuous: true,
    })
  }

  stopContinuousRun(request: Pick<TestingContinuousRunRequest, "controllerId" | "profileId" | "testId"> = {}): TestRunSnapshot[] {
    const stopped: TestRunSnapshot[] = []
    const root = request.testId
    for (const run of this.runs.values()) {
      if (run.continuous !== true) continue
      if (run.state !== "running" && run.state !== "queued") continue
      if (request.controllerId && run.controllerId !== request.controllerId) continue
      if (request.profileId !== undefined && run.profileId !== request.profileId) continue
      if (root && !run.testIds.some((testId) => testId === root || testId.startsWith(`${root}\u0000`))) continue
      run.state = "skipped"
      run.completedAt = Date.now()
      stopped.push(cloneRun(run))
    }
    return stopped.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
  }

  toggleContinuousRunForTest(testId: string, request: Pick<TestingContinuousRunRequest, "controllerId" | "profileId" | "group"> = {}): TestingContinuousRunToggleResult {
    const stoppedRuns = this.stopContinuousRun({
      controllerId: request.controllerId || getControllerIdFromTestId(testId),
      profileId: request.profileId,
      testId,
    })
    if (stoppedRuns.length > 0) {
      return {
        action: "stopped",
        stoppedRuns,
        contextKeys: this.getContinuousContextKeyProjection(request.controllerId),
        noSecondState: true,
      }
    }

    const run = this.startContinuousRun({ ...request, testId })
    if (!run) {
      return {
        action: "blocked",
        reason: "No continuous-run-capable profile is registered for the selected test.",
        stoppedRuns: [],
        contextKeys: this.getContinuousContextKeyProjection(request.controllerId),
        noSecondState: true,
      }
    }
    return {
      action: "started",
      run,
      stoppedRuns: [],
      contextKeys: this.getContinuousContextKeyProjection(request.controllerId),
      noSecondState: true,
    }
  }

  private getResultsForRun(runId: string): TestResultSnapshot[] {
    const prefix = `${runId}:`
    return [...this.results.values()].filter((result) => result.id.startsWith(prefix))
  }

  private createPublishedResultSnapshot(run: TestRunSnapshot): PublishedTestResultSnapshot {
    const tests = this.getResultsForRun(run.id).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    return {
      id: run.id,
      controllerId: run.controllerId,
      label: run.label,
      startedAt: run.startedAt,
      completedAt: run.completedAt ?? Date.now(),
      state: run.state,
      summary: summarizeResults(tests),
      tests: tests.map(cloneResult),
      tasks: run.tasks.map((task) => ({ ...task })),
      output: run.output.map((output) => ({ ...output })),
      source: "TestingService.completeRun()",
      vscodeSourcePath: "src/vs/workbench/api/browser/mainThreadTesting.ts",
      noSecondState: true,
    }
  }

  private createDefaultActions(controllerId?: string): TestRunActionDescriptor[] {
    const controllers = controllerId ? [controllerId] : [...this.controllers.keys()]
    const actions: TestRunActionDescriptor[] = []
    for (const currentControllerId of controllers) {
      const testIds = this.getItems(currentControllerId)
        .filter((item) => item.expand === "notExpandable")
        .map((item) => item.id)
      for (const group of ["run", "debug", "coverage"] as const) {
        const profile = this.getGroupDefaultProfiles(group, currentControllerId)[0]
        if (profile) {
          actions.push(this.createRunAction({ group, controllerId: currentControllerId, testIds }))
        }
      }
    }
    return actions
  }
}

export const globalTestingService = new TestingService()
registerSingleton(ITestingService, globalTestingService, InstantiationType.Delayed)
registerSingleton(ITestProfileService, globalTestingService, InstantiationType.Delayed)
registerSingleton(ITestResultService, globalTestingService, InstantiationType.Delayed)

const TESTING_CONTRACT_AUDIT: TestingContractAudit = {
  vscodeSourcePaths: [
    "src/vs/workbench/contrib/testing/common/testService.ts",
    "src/vs/workbench/contrib/testing/common/testServiceImpl.ts",
    "src/vs/workbench/contrib/testing/common/testProfileService.ts",
    "src/vs/workbench/contrib/testing/common/testResultService.ts",
    "src/vs/workbench/contrib/testing/common/testItemCollection.ts",
    "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
    "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsTree.ts",
    "src/vs/workbench/contrib/testing/browser/testCoverageView.ts",
    "src/vs/workbench/contrib/testing/browser/codeCoverageDecorations.ts",
    "src/vs/workbench/contrib/testing/common/testCoverageService.ts",
    "src/vs/workbench/contrib/testing/common/testingContinuousRunService.ts",
    "src/vs/workbench/api/browser/mainThreadTesting.ts",
    "src/vs/workbench/api/common/extHostTesting.ts",
  ],
  codekStateSource: "TestingService.getProjection()",
  codekServiceIds: [String(ITestingService), String(ITestProfileService), String(ITestResultService)],
  vscodeServiceId: "testService",
  viewContainerIds: ["workbench.view.testing"],
  viewIds: ["testing"],
  commandIds: [
	    TESTING_RUN_COMMAND_IDS.Run,
	    TESTING_RUN_COMMAND_IDS.Debug,
	    TESTING_RUN_COMMAND_IDS.Coverage,
	    TESTING_RUN_COMMAND_IDS.StartContinuousRun,
	    TESTING_RUN_COMMAND_IDS.StopContinuousRun,
	    TESTING_RUN_COMMAND_IDS.ToggleContinuousRunForTest,
	    TESTING_PEEK_COMMAND_IDS.OpenOutputPeek,
	    TESTING_CALLBACK_COMMAND_IDS.CancelRun,
    TESTING_CALLBACK_COMMAND_IDS.ConfigureProfile,
    TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
  ],
  workbenchViews: {
    codekRegistration: "viewRegistry",
    vscodeSourcePaths: [
      "src/vs/workbench/contrib/testing/browser/testing.contribution.ts",
      "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
      "src/vs/workbench/contrib/testing/browser/testCoverageView.ts",
      "src/vs/workbench/contrib/testing/browser/testingOutputPeek.ts",
      "src/vs/workbench/contrib/testing/browser/codeCoverageDecorations.ts",
      "src/vs/workbench/contrib/testing/common/constants.ts",
    ],
    genericWorkbenchShellFeasibility: {
      status: "partial",
      shellSource: "viewRegistry+ViewsService+workbenchLayoutService",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/testing/browser/testing.contribution.ts",
        "src/vs/workbench/contrib/testing/browser/testingViewPaneContainer.ts",
        "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsViewContent.ts",
        "src/vs/workbench/browser/parts/views/viewPaneContainer.ts",
        "src/vs/workbench/services/views/common/viewsService.ts",
        "src/vs/workbench/services/layout/browser/layoutService.ts",
      ],
      reusableOwners: [
        "viewRegistry descriptor registration for Testing sidebar and Test Results panel containers",
        "ViewsService openView/openViewContainer routing onto the shared WorkbenchLayoutService",
        "WorkbenchLayoutService pane-composite active/visible state without a second view state",
        "TestingService-backed context values for testingProviderCount/testingHasResults/testingCoverageOpen",
      ],
      verifiedContracts: [
        "workbenchViewsSidebarPanelIntegration opens TESTING_VIEW_IDS.Explorer through ViewsService",
        "workbenchViewsSidebarPanelIntegration opens panel containers through the same pane-composite lifecycle",
        "TestingService.getContractAudit().workbenchViews exposes the descriptor-level shell as partial only",
      ],
      missingOwners: [
        "VS Code SyncDescriptor(TestingViewPaneContainer) instance construction",
        "TestingExplorerView extends ViewPane renderBody/layoutBody/focus lifecycle",
        "TestingObjectTree extends WorkbenchObjectTree/ListService DOM virtualization and keyboard owner",
        "TestResultsViewContent SplitView/OutputPeekTree/FollowupActionWidget DOM owner",
        "generic App.vue/workbench shell slot that mounts registered ViewPane descriptors",
      ],
      blockedReason: "Codek has a reusable descriptor and pane-composite shell through viewRegistry, ViewsService, and WorkbenchLayoutService, but that shell does not instantiate VS Code ViewPaneContainer/ViewPane/ObjectTree classes. A real Testing owner adapter now requires a generic workbench shell/App.vue lane to mount registered view descriptors and list owners.",
      nextAuthorizedFiles: [
        "frontend/vite-project/src/workbench/workbenchLayoutUiAdapter.ts",
        "frontend/vite-project/src/vscode-adapter/workbench/services/views/common/viewsService.ts",
        "frontend/vite-project/src/App.vue",
      ],
      noSecondState: true,
    },
    viewShellOwnerFeasibility: {
      status: "partial",
      shellSource: "viewRegistry",
      treeStateSource: "TestingService.getProjection().items/actions/runSummary",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/testing/browser/testing.contribution.ts",
        "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
        "src/vs/workbench/contrib/testing/browser/explorerProjections/index.ts",
      ],
      canExpressShell: [
        "Testing activity container registration",
        "Test Explorer view descriptor visibility keyed by testingProviderCount",
        "coverage/results view descriptor visibility keyed by TestingService-derived context",
      ],
      canProjectTreeEvidence: [
        "tree-shaped TestItemProjection rows",
        "Testing Explorer prefix/reveal/storage lifecycle contract projection",
        "run/debug/coverage command descriptors",
        "run summary and result state evidence",
      ],
      blockedOwners: [
        "TestingExplorerView extends ViewPane",
        "TestingExplorerViewModel and TestingObjectTree",
        "TestingExplorerFilter and action bars",
        "ViewAction runInView selection/action runner",
      ],
      blockedReason: "viewRegistry can express the Testing view shell and TestingService can project tree evidence, but Codek has not migrated the VS Code TestingExplorerView ViewPane, TestingObjectTree, filter/action bars, or ViewAction owner required for the real Test Explorer tree.",
      noSecondState: true,
    },
    actionOwnerFeasibility: {
      status: "partial",
      shellSource: "viewRegistry",
      stateSource: "TestingService.getContinuousContextKeyProjection()",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/testing/browser/testExplorerActions.ts",
        "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
        "src/vs/workbench/contrib/testing/common/testingContextKeys.ts",
      ],
      canExpressActionEvidence: [
        "Test Explorer view descriptor visibility keyed by testingProviderCount",
        "MenuService can evaluate MenuId.ViewTitle and MenuId.TestItem when/toggled metadata from context keys",
        "TestingService run/debug/coverage command descriptor evidence",
        "continuous-run service-level context-key evidence for ViewTitle gating",
        "continuous-run item context-key evidence for MenuId.TestItem gating",
      ],
      canProjectContextKeys: [
        "testing.supportsContinuousRun",
        "testing.isContinuousModeOn",
        "testing.isParentRunningContinuously",
      ],
	      blockedOwners: [
	        "TestingExplorerView.updateActions() refresh owner",
	        "TestingExplorerViewModel getActionableElementActions context overlay",
	      ],
	      blockedReason: "viewRegistry can carry Testing Explorer descriptors, MenuService can evaluate ViewTitle/TestItem action metadata, and TestingService now owns a minimal continuous run start/stop facade. Executing visible TestItem/ViewTitle actions still requires VS Code TestingExplorerView action refresh and item context overlay ownership.",
      noSecondState: true,
    },
    containers: [
      {
        id: TESTING_VIEW_IDS.Container,
        vscodeId: "Testing.ViewletId/workbench.view.extension.test with ExplorerViewId=workbench.view.testing",
        location: "activityBar",
        codekOwner: "registerTestingWorkbenchViews",
        status: "partial",
        reason: "Codek registers the Testing activity container in viewRegistry, but the visible pane still renders the Agent Evidence testing surface rather than VS Code TestingViewPaneContainer.",
      },
      {
        id: TESTING_VIEW_IDS.ResultsContainer,
        vscodeId: "Testing.ResultsPanelId/workbench.panel.testResults",
        location: "panel",
        codekOwner: "registerTestingWorkbenchViews",
        status: "blocked",
        reason: "The Test Results panel container can be registered for shell visibility, but Codek has no TestResultsView/TestResultsViewContent owner yet.",
      },
    ],
    views: [
      {
        id: TESTING_VIEW_IDS.Explorer,
        vscodeId: "Testing.ExplorerViewId/workbench.view.testing",
        containerId: TESTING_VIEW_IDS.Container,
        codekOwner: "TestingService.getProjection()",
        status: "partial",
        when: "testingEnabled && testingProviderCount != 0",
        reason: "Codek has a projection-backed Test Explorer contract for controllers/items/actions, but not the VS Code TestingExplorerView model, filter state, action runner, or TestingObjectTree.",
      },
      {
        id: TESTING_VIEW_IDS.Coverage,
        vscodeId: "Testing.CoverageViewId/workbench.view.testCoverage",
        containerId: TESTING_VIEW_IDS.Container,
        codekOwner: "TestingService.getProjection()",
        status: "partial",
        when: "testingEnabled && testingCoverageOpen",
        reason: "Codek registers a projection-backed coverage view shell from TestingService coverage state, while the VS Code TestCoverageView DOM tree remains unmigrated.",
      },
      {
        id: TESTING_VIEW_IDS.Results,
        vscodeId: "Testing.ResultsViewId/workbench.panel.testResults.view",
        containerId: TESTING_VIEW_IDS.ResultsContainer,
        codekOwner: "blocked-vscode-owner",
        status: "blocked",
        when: "testingEnabled && testingHasResults",
        reason: "Results view registration is hidden until TestResultService/TestResultsViewContent/result peek ownership exists.",
      },
    ],
    editorContributions: [
      {
        id: "editor.contrib.testingOutputPeek",
        vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/testingOutputPeek.ts",
        status: "blocked",
        missingOwner: "TestingOutputPeekController plus PeekViewWidget/editor contribution registration.",
      },
      {
        id: "editor.contrib.testingDecorations",
        vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/testingDecorations.ts",
        status: "blocked",
        missingOwner: "TestingDecorations editor contribution and decoration service ownership.",
      },
      {
        id: "editor.contrib.coverageDecorations",
        vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/codeCoverageDecorations.ts",
        status: "partial",
        codekOwner: "TestingService.getCoverageEditorDecorationsProjection()",
        missingOwner: "Full CodeCoverageDecorations editor contribution, CoverageDetailsModel ranges, minimap decorations, and overlay toolbar.",
      },
    ],
    noSecondState: true,
  },
  uiBinding: {
    vscodeVisibleEntryPaths: [
      "src/vs/workbench/contrib/testing/browser/testExplorerActions.ts",
      "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
      "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsTree.ts",
      "src/vs/workbench/contrib/testing/browser/codeCoverageDecorations.ts",
      "src/vs/workbench/contrib/testing/common/testCoverage.ts",
    ],
    codekVisibleSurfacePath: "frontend/vite-project/src/App.vue:data-agent-evidence-surface=\"testing\"",
    callbackCommandBinding: "commandRegistry",
    visibleActions: [
      {
        commandId: TESTING_CALLBACK_COMMAND_IDS.CancelRun,
        vscodeEntry: "testExplorerActions.ts CancelTestRunAction and testResultsTree.ts output peek cancel action",
        codekBinding: "registered-command-facade",
        visibleInCodek: false,
        reason: "Codek exposes testing.cancelRun through commandRegistry, but the current Agent Evidence testing surface does not render a dedicated cancel button.",
      },
      {
        commandId: TESTING_PEEK_COMMAND_IDS.OpenOutputPeek,
        vscodeEntry: "testExplorerActions.ts OpenOutputPeek -> ITestingPeekOpener.open()",
        codekBinding: "registered-command-facade",
        visibleInCodek: false,
        reason: "Codek exposes testing.openOutputPeek through a TestingService shell adapter descriptor, but the current Agent Evidence testing surface does not render the VS Code peek widget.",
      },
      {
        commandId: TESTING_CALLBACK_COMMAND_IDS.ConfigureProfile,
        vscodeEntry: "testExplorerActions.ts ConfigureTestProfilesAction and testingExplorerView.ts configure profile welcome/action",
        codekBinding: "registered-command-facade",
        visibleInCodek: false,
        reason: "Codek exposes testing.configureProfile through commandRegistry, but the current Agent Evidence testing surface does not render VS Code Test Explorer profile configuration controls.",
      },
      {
        commandId: TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
        vscodeEntry: "testCoverage.ts getCoverageDetails accessor and codeCoverageDecorations.ts CoverageDetailsModel",
        codekBinding: "registered-command-facade",
        visibleInCodek: false,
        reason: "Codek exposes testing.coverageDetails through commandRegistry and TestingService coverage projections, but the current Agent Evidence testing surface does not render the VS Code coverage tree or inline detail controls.",
      },
    ],
    blockedUiGaps: [
      "No standalone Codek Test Explorer component currently renders testing.cancelRun/testing.configureProfile/testing.coverageDetails visible controls.",
      "App.vue currently exposes Agent Evidence testing rerun/failure/resource evidence, not VS Code result peek or coverage tree action UI.",
      "A complete visible callback closeout requires migrating or adapting VS Code TestingExplorerView, testResultsTree output peek actions, and coverage decorations/tree UI.",
    ],
  },
  uiCapabilities: {
    treeProvider: {
      status: "partial",
      codekOwner: "TestingService",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
        "src/vs/workbench/contrib/testing/browser/explorerProjections/index.ts",
        "src/vs/workbench/contrib/testing/common/testService.ts",
        "src/vs/workbench/contrib/testing/common/testProfileService.ts",
        "src/vs/workbench/contrib/testing/common/testResultService.ts",
        "src/vs/workbench/contrib/testing/common/testingContinuousRunService.ts",
      ],
      codekStateSource: "TestingService.getProjection().items/actions/runSummary",
      commandIds: [
        TESTING_RUN_COMMAND_IDS.Run,
        TESTING_RUN_COMMAND_IDS.Debug,
        TESTING_RUN_COMMAND_IDS.Coverage,
        TESTING_CALLBACK_COMMAND_IDS.ConfigureProfile,
      ],
      reason: "Codek projects controller/profile/item/run evidence into TestingService, but it does not own a VS Code TestingExplorerView tree model, view model, filter state, menu action runner, or continuous-run UI service.",
      missingOwnership: [
        "TestingExplorerViewModel and Tree/List projections",
        "TestExplorerFilterState and context-key driven sorting/filtering",
        "TestingContinuousRunService UI ownership",
        "VS Code menu/action runner integration for visible tree actions",
      ],
    },
    resultPeek: {
      status: "partial",
      codekOwner: "TestingService",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsTree.ts",
        "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsViewContent.ts",
        "src/vs/workbench/contrib/testing/browser/testingOutputPeek.ts",
        "src/vs/workbench/contrib/testing/common/testResultService.ts",
        "src/vs/workbench/contrib/testing/common/testingPeekOpener.ts",
      ],
      codekStateSource: "TestingService.getResultHistoryProjection()+getResultPeekProjection()",
      commandIds: [
        TESTING_RUN_COMMAND_IDS.Run,
        TESTING_RUN_COMMAND_IDS.Debug,
        TESTING_PEEK_COMMAND_IDS.OpenOutputPeek,
        TESTING_CALLBACK_COMMAND_IDS.CancelRun,
      ],
      reason: "Codek exposes TestResultService service-level event/storage evidence, result history, result peek adapter projection, and a TestingService.openResultPeek() shell adapter descriptor from TestingService runs/results/output, but it still lacks OutputPeekTree, TestingOutputPeekController, and visible PeekViewWidget UI.",
      missingOwnership: [
        "OutputPeekTree and Test Results View content",
        "TestingOutputPeekController editor contribution and PeekViewWidget",
        "LiveTestResult object lifecycle and file-backed TestResultStorage output persistence",
        "Visible cancel/rerun/debug actions inside result peek",
      ],
    },
    coverageTree: {
      status: "partial",
      codekOwner: "TestingService",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/testing/browser/testCoverageView.ts",
        "src/vs/workbench/contrib/testing/browser/codeCoverageDecorations.ts",
        "src/vs/workbench/contrib/testing/common/testCoverage.ts",
        "src/vs/workbench/contrib/testing/common/testCoverageService.ts",
      ],
      codekStateSource: "TestingService.getCoverageTreeProjection()",
      commandIds: [
        TESTING_RUN_COMMAND_IDS.Coverage,
        TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
        TESTING_COVERAGE_COMMAND_IDS.OpenCoverage,
        TESTING_COVERAGE_COMMAND_IDS.CloseCoverage,
        TESTING_COVERAGE_COMMAND_IDS.ToggleInlineCoverage,
        TESTING_COVERAGE_COMMAND_IDS.FilterToTest,
      ],
      reason: "Codek exposes coverage view and editor decoration shell projections from TestingService coverage files, selected coverage, filter-to-test, and inline state, but it still lacks the full VS Code TestCoverageView/TestCoverageTree DOM owner and CodeCoverageDecorations renderer.",
      missingOwnership: [
        "Full TestCoverageService observable integration",
        "Full TestCoverageView/TestCoverageTree DOM owner",
        "Full CodeCoverageDecorations editor contribution",
        "Full TestCoverageView/TestCoverageTree ViewPane owner",
        "Full CodeCoverageDecorations ICodeEditor contribution",
        "CoverageDetailsModel range mapping/minimap/injected text/overlay toolbar",
      ],
    },
  },
  serviceOwnerMatrix: [
    {
      vscodeServiceId: "ITestService",
      decoratorId: "testService",
      status: "projected",
      codekOwner: "TestingService",
      codekStateSource: "TestingService controllers/items/runs/profiles",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/testing/common/testService.ts",
        "src/vs/workbench/contrib/testing/common/testServiceImpl.ts",
        "src/vs/workbench/api/browser/mainThreadTesting.ts",
      ],
      implementedEvidence: [
        "ITestingService singleton uses the same TestingService instance",
        "MainThreadTesting controller/item/run RPCs project into TestingService",
        "renderer run/cancel/configure/coverage callbacks reuse TestingService command facades",
      ],
      blockedOwners: [
        "ITestService.collection diff listener and busy provider model",
        "ITestService.registerExtHost followup provider owner",
        "full TestingExplorerView tree/action consumer",
      ],
      blockedReason: "Codek exposes a single TestingService facade for VS Code-style controller/item/run evidence, but it does not yet own the full VS Code ITestService collection, provider registry, followup provider registration, or Testing Explorer consumer lifecycle.",
      noSecondState: true,
    },
    {
      vscodeServiceId: "ITestProfileService",
      decoratorId: "testProfileService",
      status: "projected",
      codekOwner: "TestingService",
      codekStateSource: "TestingService profiles map",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/testing/common/testProfileService.ts",
        "src/vs/workbench/api/browser/mainThreadTesting.ts",
      ],
      implementedEvidence: [
        "ITestProfileService singleton aliases the same TestingService instance",
        "add/update/remove profile RPCs project into TestingService profile snapshots",
        "getGroupDefaultProfiles derives defaults from the same profile snapshots",
      ],
      blockedOwners: [
        "TestProfileService StoredValue preferred-profile persistence",
        "context-key refresh for profile capabilities",
        "ExtHostTesting.$setDefaultRunProfiles synchronization",
      ],
      blockedReason: "TestingService can provide profile snapshot/default-profile evidence without a second state source, but it does not own VS Code persisted defaults, profile capability context keys, or default-profile back-propagation.",
      noSecondState: true,
    },
    {
      vscodeServiceId: "ITestResultService",
      decoratorId: "testResultService",
      status: "projected",
      codekOwner: "TestingService result service facade",
      codekStateSource: "TestingService runs/results/output",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/testing/common/testResultService.ts",
        "src/vs/workbench/contrib/testing/common/testResultStorage.ts",
        "src/vs/workbench/contrib/testing/common/testResult.ts",
        "src/vs/workbench/api/browser/mainThreadTesting.ts",
      ],
      implementedEvidence: [
        "ITestResultService singleton aliases the same TestingService instance for result service evidence",
        "TestingService.onResultsChanged emits inserted/completed/removed result events",
        "TestingService.onTestChanged emits computed state, message, and retired result item events",
        "TestingService.getResult/getStateById/clear/push expose the ITestResultService read/clear surface over the same results map",
        "TestingService.getResultStorageProjection serializes completed results with storedTestResults key evidence",
        "TestingService.getResultStorageProjection exposes file-backed storage owner matrix while keeping file-service ownership blocked",
        "getResultHistoryProjection derives retained run/result summaries from TestingService maps",
        "result peek projections reuse the same run/result/output state",
      ],
      blockedOwners: [
        "LiveTestResult create/push/clear/dispose lifecycle",
        "TestResultStorage workspaceStorageHome file owner and output stream persistence",
      ],
      blockedReason: "Codek now exposes service-level result events, lookup, clear/push, completed-result serialization, and $publishTestResults evidence through the single TestingService facade. It still cannot claim VS Code LiveTestResult object lifecycle or TestResultStorage file/output-stream ownership.",
      noSecondState: true,
    },
    {
      vscodeServiceId: "LiveTestResult",
      status: "blocked",
      codekOwner: "TestingService run/result snapshots",
      codekStateSource: "TestingService runs/results/output",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/testing/common/testResult.ts",
        "src/vs/workbench/contrib/testing/common/testResultService.ts",
        "src/vs/workbench/api/browser/mainThreadTesting.ts",
      ],
      implementedEvidence: [
        "run start/state/output/complete events update TestingService snapshots",
        "run task start/finish and output append evidence is retained on TestRunSnapshot",
        "computed-state/new-message/retired item events are emitted from TestingService result snapshots",
        "per-run result summaries are projected for result history and result peek",
      ],
      blockedOwners: [
        "LiveTestResult task model",
        "LiveTestResult onChange/onComplete events",
        "LiveTestResult dispose/telemetry lifecycle",
        "coverage detail lookup by result/task owner",
      ],
      blockedReason: "TestingService snapshots preserve user-visible run/result and retired-state evidence, but Codek does not own the VS Code LiveTestResult object lifecycle, task list, event emitters, or coverage detail lookup.",
      noSecondState: true,
    },
    {
      vscodeServiceId: "TestMessageFollowupProvider",
      status: "partial",
      codekOwner: "TestingService followup provider bridge",
      codekStateSource: "TestingService extensionHostCallbacks",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/testing/common/testService.ts",
        "src/vs/workbench/contrib/testing/common/testServiceImpl.ts",
        "src/vs/workbench/api/browser/mainThreadTesting.ts",
        "src/vs/workbench/api/common/extHostTesting.ts",
        "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsViewContent.ts",
        "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsTree.ts",
      ],
      implementedEvidence: [
        "TestingService.provideTestFollowups forwards TestMessage followup requests to extensionHostCallbacks",
        "TestingService.executeTestFollowup forwards selected followup ids to extensionHostCallbacks",
        "TestingService.disposeTestFollowups forwards handle disposal to extensionHostCallbacks",
        "extensionHostRuntimeBridge exposes provider/execute/dispose callbacks to renderer IPC",
        "desktop MainThreadTesting forwards followup IPC to ExtHostTesting VS Code RPC methods",
        "result peek shell can expose messages from TestingService result snapshots",
      ],
      blockedOwners: [
        "TestingOutputPeekController/PeekViewWidget owner for visible message reveal",
        "OutputPeekTree/TestMessageElement owner for selecting a TestMessage subject",
        "TestResultsViewContent FollowupActionWidget owner for requesting, rendering, executing, and disposing followup handles",
      ],
      blockedReason: "Provider, execute, and dispose callbacks are bridged through the existing TestingService chain, but Codek still lacks the VS Code TestingOutputPeekController/PeekViewWidget, OutputPeekTree/TestMessageElement, and TestResultsViewContent FollowupActionWidget owners that request followups when a message becomes visible and dispose handles when that UI changes.",
      noSecondState: true,
    },
  ],
  ownerContracts: {
    testExplorerTree: {
      status: "projected",
      codekStateSource: "TestingService.getProjection().items/actions/runSummary",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
        "src/vs/workbench/contrib/testing/browser/testingViewPaneContainer.ts",
        "src/vs/workbench/contrib/testing/browser/explorerProjections/treeProjection.ts",
        "src/vs/workbench/contrib/testing/browser/explorerProjections/testingObjectTree.ts",
        "src/vs/workbench/contrib/testing/browser/testingExplorerFilter.ts",
        "src/vs/workbench/contrib/testing/common/testingContinuousRunService.ts",
      ],
      codekCanProvide: [
        "controller/profile snapshots",
        "parent-child test item projections",
        "prefix-path and reveal target/ancestor evidence",
        "external persisted view-state payload evidence",
        "DOM shell selector, row attributes, and filter value projection evidence",
        "TestingObjectTree optimized view-state projection evidence",
        "run/debug/coverage command descriptors and commandRegistry execution entrypoints",
        "run summary and latest result state",
      ],
      vscodeRequiredOwners: [
        "TestingExplorerView extends ViewPane renderBody/layoutBody/focus",
        "TestingExplorerViewModel and TestingObjectTree lifecycle",
        "TestingExplorerFilter input/action bar and context keys",
        "TestingViewPaneContainer sidebar container owner",
        "WorkbenchObjectTree DOM virtualization and keyboard accessibility owner",
        "MenuId.TestItem/TestItemGutter/TestPeekElement action runner",
      ],
      availableEvidence: [
        {
          capability: "Testing Explorer DOM projection",
          stateSource: "TestingService.getTestingExplorerContractProjection().domOwnerAdapter",
          evidence: "Codek projects shell selectors, row attributes, and visible row ids from TestingService rows without a second tree store.",
        },
        {
          capability: "WorkbenchObjectTree data contract",
          stateSource: "TestingService.getTestingExplorerContractProjection().objectTreeAdapter",
          evidence: "Object tree identity, optimized view state, focused row, and selected row are derived from TestingService parent/child links.",
        },
      ],
      blockedMatrix: [
        {
          capability: "TestingExplorerView pane shell",
          blockedOwner: "TestingExplorerView extends ViewPane renderBody/layoutBody/focus owner",
          blockedReason: "Codek has shell evidence only; claiming ViewPane ownership requires the real workbench view owner and would cross into App.vue or generic shell wiring.",
        },
        {
          capability: "TestingViewPaneContainer sidebar owner",
          blockedOwner: "TestingViewPaneContainer extends ViewPaneContainer instance and sidebar DOM lifecycle",
          blockedReason: "The registry descriptor is not the container instance; real ownership needs the generic workbench container shell.",
        },
        {
          capability: "WorkbenchObjectTree virtualization",
          blockedOwner: "TestingObjectTree extends WorkbenchObjectTree DOM virtualization, keyboard, and optimized-view-state saver",
          blockedReason: "Codek provides the tree data contract but not the WorkbenchObjectTree DOM/keyboard/lifecycle owner.",
        },
        {
          capability: "TestingExplorerFilter and menu action runner",
          blockedOwner: "TestingExplorerFilter input widget, TestExplorerFilterState, MenuId.TestItem/ViewTitle action runner",
          blockedReason: "The parser/projection is available, but visible input history, context-key overlay, and action runner ownership require the real TestingExplorerView UI.",
        },
      ],
      blockedReason: "TestingService can project a tree-shaped testing model, but Codek does not own the VS Code TestingExplorerView ViewPane, TestingObjectTree, filter input, context-key actions, or tree action runner required to claim the Test Explorer tree owner.",
      noSecondState: true,
    },
    resultPeek: {
      status: "projected",
      codekStateSource: "TestingService.getResultHistoryProjection()/getResultPeekProjection()/openResultPeek()",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/testing/common/testResultService.ts",
        "src/vs/workbench/contrib/testing/common/testResultStorage.ts",
        "src/vs/workbench/contrib/testing/common/testResult.ts",
        "src/vs/workbench/contrib/testing/browser/testingOutputPeek.ts",
        "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsViewContent.ts",
        "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsTree.ts",
        "src/vs/workbench/contrib/testing/common/testingPeekOpener.ts",
      ],
      codekCanProvide: [
        "retained run/result history snapshots and per-run summaries",
        "latest run id and result entries",
        "per-test messages and output slices",
        "Test Results view pane shell rows from result history and result peek projections",
        "testing.openOutputPeek descriptor",
        "cancel/run/debug command id evidence",
      ],
      vscodeRequiredOwners: [
        "LiveTestResult object lifecycle and file-backed TestResultStorage output persistence",
        "TestingPeekOpener editor service/code editor service integration",
        "TestingOutputPeekController and PeekViewWidget editor contribution",
        "TestResultsViewContent/TestResultsTree DOM and action runner",
      ],
      availableEvidence: [
        {
          capability: "retained result history projection",
          stateSource: "TestingService.getResultHistoryProjection()",
          evidence: "Runs, results, per-run summaries, hasAnyResults, and isRunning are derived from the same TestingService run/result/output maps used by result peek.",
        },
        {
          capability: "TestResultService events",
          stateSource: "TestingService onResultsChanged/onTestChanged",
          evidence: "TestingService emits inserted/completed/removed result events plus computed-state/message/retired item events from the same results map.",
        },
        {
          capability: "result storage persistence",
          stateSource: "TestingService.getResultStorageProjection()",
          evidence: "Completed runs serialize to PublishedTestResultSnapshot records with storedTestResults key evidence and no second result state.",
        },
        {
          capability: "TestResultsViewContent shell rows",
          stateSource: "TestingService.getTestResultsViewPaneShellProjection()",
          evidence: "Run and test rows are derived from TestingService result history plus result peek entries without a second result tree.",
        },
      ],
      blockedMatrix: [
        {
          capability: "Test Results panel shell rows",
          blockedOwner: "TestResultsViewContent SplitView/TestResultsTree render owner",
          blockedReason: "Codek can project the rows but does not own the VS Code SplitView, tree renderer, or layout lifecycle.",
        },
        {
          capability: "live result output refresh",
          blockedOwner: "LiveTestResult.onComplete/onChange listeners inside TestResultsViewContent/TestResultsTree",
          blockedReason: "Codek snapshots expose running/completed state, but there is no TestResultsViewContent owner waiting on LiveTestResult.onComplete or refreshing tree subjects.",
        },
        {
          capability: "message followup actions",
          blockedOwner: "FollowupActionWidget request/render/execute/dispose owner",
          blockedReason: "The bridge exists, but visible followup UI requires the VS Code TestResultsViewContent widget lifecycle.",
        },
        {
          capability: "LiveTestResult lifecycle",
          blockedOwner: "LiveTestResult object/disposable/telemetry owner",
          blockedReason: "Codek service events are backed by TestingService snapshots, not VS Code LiveTestResult instances.",
        },
        {
          capability: "file-backed result output persistence",
          blockedOwner: "TestResultStorage workspaceStorageHome/output stream owner",
          blockedReason: "Codek exposes storage serialization evidence but not the VS Code file-service cleanup and output stream owner.",
        },
        {
          capability: "visible result peek UI",
          blockedOwner: "TestingOutputPeekController/PeekViewWidget/TestResultsViewContent",
          blockedReason: "History data is available, but Codek still lacks the editor contribution and DOM owners required for a real result peek UI.",
        },
      ],
      blockedReason: "TestingService can provide retained result history, service-level event/storage evidence, result lifecycle evidence, and a shell descriptor, but Codek does not own LiveTestResult instances, file-backed output persistence, TestingOutputPeekController, PeekViewWidget, or TestResultsViewContent DOM needed for real result peek UI.",
      noSecondState: true,
    },
    coverageEditor: {
      status: "projected",
      codekStateSource: "TestingService.getCoverageEditorDecorationsProjection()/getCoverageEditorContributionShellProjection()",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/testing/browser/codeCoverageDecorations.ts",
        "src/vs/workbench/contrib/testing/browser/testCoverageView.ts",
        "src/vs/workbench/contrib/testing/common/testCoverage.ts",
        "src/vs/workbench/contrib/testing/common/testCoverageService.ts",
      ],
      codekCanProvide: [
        "selected coverage file lookup",
        "inline/filter-to-test/sort state",
        "coverage detail command evidence",
        "CoverageDetailsModel range model shell",
      ],
      vscodeRequiredOwners: [
        "CodeCoverageDecorations registered as editor.contrib.coverageDecorations",
        "ICodeEditor model/configuration/mouse/decorations/view zones/overlay widget APIs",
        "CoverageDetailsModel statement/branch range mapping",
        "CoverageToolbarWidget and minimap/injected text decorations",
      ],
      blockedReason: "TestingService can project coverage editor evidence, but Codek does not own the generic ICodeEditor/TextModel contribution shell required for owner-scoped decorations, CoverageDetailsModel ranges, minimap/injected text, and coverage toolbar overlay.",
      noSecondState: true,
    },
    continuousRun: {
      status: "projected",
	      codekStateSource: "TestingService continuous run facade -> TestingService.startRun projection",
      vscodeSourcePaths: [
        "src/vs/workbench/contrib/testing/common/testingContinuousRunService.ts",
        "src/vs/workbench/contrib/testing/common/testService.ts",
        "src/vs/workbench/contrib/testing/common/testServiceImpl.ts",
        "src/vs/workbench/contrib/testing/browser/testExplorerActions.ts",
        "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
        "src/vs/workbench/contrib/testing/common/testingContextKeys.ts",
        "src/vs/workbench/api/browser/mainThreadTesting.ts",
      ],
      codekCanProvide: [
	        "$startContinuousRun bridge event evidence",
	        "TestingService.startContinuousRun/stopContinuousRun/toggleContinuousRunForTest executable facade",
	        "run-start projection with continuous request metadata",
	        "profile ids and test ids passed through the TestingService run model",
	        "service-level testing.supportsContinuousRun/testing.isContinuousModeOn context-key evidence derived from profiles+runs",
      ],
      vscodeRequiredOwners: [
        "TestingContinuousRunService prefix-tree running state",
        "lastContinuousRunProfileIds workspace storage",
        "profile default-change restart via CancellationTokenSource",
        "selectContinuousRunProfiles quick pick and last-run profile preselection",
        "TestingExplorerView item context overlay for testing.isParentRunningContinuously and action refresh",
      ],
      availableEvidence: [
        {
          capability: "ExtHost continuous run bridge",
          stateSource: "desktop mainThreadTesting.$startContinuousRun",
          evidence: "$startContinuousRun is listed in extensionHostBridge.adapterEvidence.rpcMethods and can project into TestingService.startRun({ continuous: true }).",
        },
        {
          capability: "continuous run request metadata",
          stateSource: "TestingService.startRun()/getRuns()",
          evidence: "TestRunSnapshot preserves request.continuous, profileId, group, and testIds without creating a second continuous-run store.",
        },
        {
          capability: "single service projection",
          stateSource: "TestingService.getProjection().runs",
          evidence: "Continuous run evidence is read from the same TestingService run map used by result peek and coverage projections.",
        },
	        {
	          capability: "service-level start/stop continuous run facade",
	          stateSource: "TestingService.startContinuousRun()/stopContinuousRun()",
	          evidence: "TestingService can start, stop, and toggle continuous run projections through the single TestingService run map without creating a second continuous-run state source.",
	        },
	        {
	          capability: "service-level continuous context keys",
	          stateSource: "TestingService.getContinuousContextKeyProjection()",
	          evidence: "testing.supportsContinuousRun is derived from registered profiles and testing.isContinuousModeOn is derived from active continuous runs in the same TestingService projection.",
        },
        {
          capability: "item-level parent continuous context key evidence",
          stateSource: "TestingService.getContinuousContextKeyProjection().itemContextKeys",
          evidence: "testing.isParentRunningContinuously is derived from TestingService test item parent links and active continuous run test ids without creating a second continuous-run store.",
        },
        {
          capability: "Testing Explorer prefix/reveal/storage lifecycle contract",
          stateSource: "TestingService.getTestingExplorerContractProjection()",
          evidence: "Codek can project Testing Explorer rows, prefix paths, reveal target/ancestor state, external persisted view-state payload, active continuous run ids, and child-before-parent cancel order from TestingService state.",
        },
      ],
      blockedMatrix: [
	        {
	          capability: "global/test-specific running state",
	          blockedOwner: "TestingContinuousRunService running WellDefinedPrefixTree",
	          blockedReason: "TestingService owns a minimal executable start/stop facade over run projections, but it does not own VS Code's WellDefinedPrefixTree semantics or onDidChange event source.",
        },
        {
          capability: "last-run profile persistence",
          blockedOwner: "StoredValue<Set<number>> lastContinuousRunProfileIds",
          blockedReason: "Codek has no TestingContinuousRunService workspace storage owner for last profile ids or quick-pick preselection.",
        },
        {
          capability: "restart/cancel on profile changes",
          blockedOwner: "CancellationTokenSource plus testProfileService.onDidChange autorun",
          blockedReason: "TestingService does not own VS Code's continuous restart loop or cancellation-token lifecycle when default profiles change.",
        },
        {
          capability: "visible explorer actions and context keys",
          blockedOwner: "TestingExplorerView/testExplorerActions/TestingContextKeys",
          blockedReason: "The current scope does not migrate TestingExplorerView, continuous-run dropdowns, TestItem menus, or the DOM action refresh that consumes item-scoped continuous context-key evidence.",
        },
      ],
      actionContextMatrix: [
        {
          surface: "continuous run request metadata",
          vscodeEntry: "testingContinuousRunService.ts start() -> testService.startContinuousRun({ continuous: true })",
          codekProjection: "projected",
          contextKeys: [],
          evidence: "TestingService.startRun({ continuous: true }) preserves continuous/profile/test metadata in getProjection().runs.",
          blockedOwner: "none",
          blockedReason: "No separate owner required for read-only run metadata projection.",
        },
	        {
	          surface: "Test Explorer item toggle continuous run",
	          vscodeEntry: "testExplorerActions.ts ContinuousRunTestAction/ContinuousRunUsingProfileTestAction",
	          codekProjection: "projected",
          contextKeys: [
            "testing.supportsContinuousRun",
            "testing.isContinuousModeOn",
            "testing.isParentRunningContinuously",
          ],
	          evidence: "TestingService.toggleContinuousRunForTest() can start/stop item continuous run projections and refresh item context-key evidence from the same service state.",
	          blockedOwner: "TestingExplorerView + MenuId.TestItem visible action runner",
	          blockedReason: "Codek has not migrated VS Code TestItem context overlay, visible continuous-run item actions, or TestingExplorerView action refresh.",
	        },
        {
	          surface: "Test Explorer view title start/stop continuous run",
	          vscodeEntry: "testExplorerActions.ts StartContinuousRunAction/StopContinuousRunAction",
	          codekProjection: "projected",
          contextKeys: [
            "view == workbench.view.testing",
            "testing.supportsContinuousRun",
            "testing.isContinuousModeOn",
          ],
	          evidence: "TestingService.startContinuousRun/stopContinuousRun can back service-level continuous run start/stop projections and service-level context keys.",
	          blockedOwner: "ViewTitle menu + TestingExplorerView action refresh",
	          blockedReason: "Codek does not own the visible ViewTitle menu command wiring or TestingExplorerView.updateActions() refresh semantics.",
        },
        {
          surface: "continuous run profile selection",
          vscodeEntry: "testExplorerActions.ts selectContinuousRunProfiles()",
          codekProjection: "projected",
          contextKeys: [
            "testing.supportsContinuousRun",
            "testing.isContinuousModeOn",
          ],
          evidence: "TestingService keeps profile ids on run projections but does not persist or preselect last continuous profiles.",
          blockedOwner: "IQuickInputService + StoredValue<Set<number>> lastContinuousRunProfileIds",
          blockedReason: "Codek has no TestingContinuousRunService storage owner or quick-pick owner for continuous profile selection.",
        },
        {
          surface: "Testing context keys",
          vscodeEntry: "testingContextKeys.ts isContinuousModeOn/supportsContinuousRun/isParentRunningContinuously",
          codekProjection: "projected",
          contextKeys: [
            "testing.isContinuousModeOn",
            "testing.supportsContinuousRun",
            "testing.isParentRunningContinuously",
          ],
          evidence: "TestingService.getContinuousContextKeyProjection() exposes service-level supports/is-on keys and itemContextKeys for isParentRunningContinuously from the same profiles/runs/items source.",
          blockedOwner: "TestingExplorerView context overlay consumer",
          blockedReason: "The key values are projected, but Codek has no TestingExplorerView context overlay to consume them during visible TestItem menu creation.",
        },
      ],
	      blockedReason: "TestingService now owns a minimal continuous run start/stop/toggle facade over the existing run projection and can derive service-level plus item-level context-key evidence. Codek still does not own VS Code continuous-run storage, cancellation-token restart, item overlay consumer, or Explorer action refresh semantics.",
      noSecondState: true,
    },
  },
  extensionHostBridge: {
    vscodeMainThreadPath: "src/vs/workbench/api/browser/mainThreadTesting.ts",
    vscodeExtHostPath: "src/vs/workbench/api/common/extHostTesting.ts",
    codekMainThreadAdapter: "desktop/services/extensions-host/mainThread/mainThreadTesting.js",
    status: "connected",
    adapterEvidence: {
      rpcMethods: [
        "$registerTestController",
        "$updateController",
        "$unregisterTestController",
        "$publishTestRunProfile",
        "$updateTestRunConfig",
        "$removeTestProfile",
        "$publishDiff",
        "$addTestsToRun",
        "$startedExtensionTestRun",
        "$startedTestRunTask",
        "$finishedTestRunTask",
        "$appendOutputToRun",
        "$appendTestMessagesInRun",
        "$updateTestStateInRun",
        "$appendCoverage",
        "$finishedExtensionTestRun",
        "$markTestRetired",
        "$subscribeToDiffs",
        "$unsubscribeFromDiffs",
        "$getCoverageDetails",
        "$runTests",
        "$startContinuousRun",
      ],
      rendererEventChannels: [
        "ext-host:testing-controller",
        "ext-host:testing-controller-remove",
        "ext-host:testing-profile",
        "ext-host:testing-profile-update",
        "ext-host:testing-profile-remove",
        "ext-host:testing-item",
        "ext-host:testing-item-remove",
        "ext-host:testing-run-start",
        "ext-host:testing-run-task-start",
        "ext-host:testing-run-task-finish",
        "ext-host:testing-run-output",
        "ext-host:testing-run-state",
        "ext-host:testing-coverage",
        "ext-host:testing-run-complete",
        "ext-host:testing-retire",
      ],
      backChannels: [
        "ext-host:testing-cancel -> ExtHostTesting.$cancelExtensionTestRun",
        "ext-host:testing-configure-profile -> ExtHostTesting.$configureRunProfile",
        "ext-host:testing-coverage-details -> ExtHostTesting.$getCoverageDetails",
        "ext-host:testing-sync-tests -> ExtHostTesting.$syncTests",
        "ext-host:testing-refresh-tests -> ExtHostTesting.$refreshTests",
        "ext-host:testing-expand-test -> ExtHostTesting.$expandTest",
        "ext-host:testing-code-related-to-test -> ExtHostTesting.$getCodeRelatedToTest",
        "ext-host:testing-tests-related-to-code -> ExtHostTesting.$getTestsRelatedToCode",
        "ext-host:testing-provide-followups -> ExtHostTesting.$provideTestFollowups",
        "ext-host:testing-execute-followup -> ExtHostTesting.$executeTestFollowup",
        "ext-host:testing-dispose-followups -> ExtHostTesting.$disposeTestFollowups",
        "ext-host:testing-publish-results -> ExtHostTesting.$publishTestResults",
      ],
    },
    rpcMethodMatrix: {
      controllerAndItem: [
        {
          vscodeMethod: "$registerTestController",
          vscodeOwner: "MainThreadTestingShape",
          status: "projected",
          codekEvidence: "desktop mainThreadTesting emits ext-host:testing-controller; TestingService.registerController consumes the same controller snapshot source.",
          rendererChannel: "ext-host:testing-controller",
        },
        {
          vscodeMethod: "$updateController",
          vscodeOwner: "MainThreadTestingShape",
          status: "projected",
          codekEvidence: "desktop mainThreadTesting emits ext-host:testing-controller with label/capability patch projection.",
          rendererChannel: "ext-host:testing-controller",
        },
        {
          vscodeMethod: "$unregisterTestController",
          vscodeOwner: "MainThreadTestingShape",
          status: "projected",
          codekEvidence: "desktop mainThreadTesting clears known test items for the controller and emits ext-host:testing-controller-remove.",
          rendererChannel: "ext-host:testing-controller-remove",
        },
        {
          vscodeMethod: "$publishDiff",
          vscodeOwner: "MainThreadTestingShape",
          status: "projected",
          codekEvidence: "desktop mainThreadTesting normalizes add/update/remove TestsDiff operations into TestingService item snapshots.",
          rendererChannel: "ext-host:testing-item / ext-host:testing-item-remove",
        },
        {
          vscodeMethod: "$subscribeToDiffs",
          vscodeOwner: "MainThreadTestingShape",
          status: "forwarded",
          codekEvidence: "desktop mainThreadTesting.$subscribeToDiffs forwards to ExtHostTesting.$syncTests so pending extension diffs can flush on demand.",
          backChannel: "MainThreadTesting.$subscribeToDiffs -> ExtHostTesting.$syncTests",
        },
        {
          vscodeMethod: "$unsubscribeFromDiffs",
          vscodeOwner: "MainThreadTestingShape",
          status: "stubbed",
          blockedOwner: "VS Code ITestService.collection diff listener",
          blockedReason: "Codek adapter has no VS Code diff listener to dispose until the real TestService owner is migrated.",
        },
      ],
      runProfile: [
        {
          vscodeMethod: "$publishTestRunProfile",
          vscodeOwner: "MainThreadTestingShape",
          status: "projected",
          codekEvidence: "desktop mainThreadTesting emits ext-host:testing-profile for TestingService.addProfile.",
          rendererChannel: "ext-host:testing-profile",
        },
        {
          vscodeMethod: "$updateTestRunConfig",
          vscodeOwner: "MainThreadTestingShape",
          status: "projected",
          codekEvidence: "desktop mainThreadTesting emits ext-host:testing-profile-update for TestingService.updateProfile.",
          rendererChannel: "ext-host:testing-profile-update",
        },
        {
          vscodeMethod: "$removeTestProfile",
          vscodeOwner: "MainThreadTestingShape",
          status: "projected",
          codekEvidence: "desktop mainThreadTesting emits ext-host:testing-profile-remove.",
          rendererChannel: "ext-host:testing-profile-remove",
        },
        {
          vscodeMethod: "$configureRunProfile",
          vscodeOwner: "ExtHostTestingShape",
          status: "forwarded",
          codekEvidence: "TestingService command facade sends profile configuration through the desktop back-channel.",
          backChannel: "ext-host:testing-configure-profile -> ExtHostTesting.$configureRunProfile",
        },
        {
          vscodeMethod: "$setDefaultRunProfiles",
          vscodeOwner: "ExtHostTestingShape",
          status: "blocked",
          blockedOwner: "VS Code TestProfileService active/default profile synchronization",
          blockedReason: "Codek projects default profiles from TestingService snapshots but does not yet push main-thread default profile changes back into ExtHostTesting.",
        },
      ],
      runLifecycle: [
        {
          vscodeMethod: "$runTests",
          vscodeOwner: "MainThreadTestingShape",
          status: "forwarded",
          codekEvidence: "desktop mainThreadTesting projects a run start and forwards controller requests to ExtHostTesting.$runControllerTests.",
          rendererChannel: "ext-host:testing-run-start",
          backChannel: "MainThreadTesting.$runTests -> ExtHostTesting.$runControllerTests",
        },
        {
          vscodeMethod: "$startContinuousRun",
          vscodeOwner: "MainThreadTestingShape",
          status: "forwarded",
          codekEvidence: "desktop mainThreadTesting projects a continuous run start and forwards controller requests to ExtHostTesting.$startContinuousRun.",
          rendererChannel: "ext-host:testing-run-start",
          backChannel: "MainThreadTesting.$startContinuousRun -> ExtHostTesting.$startContinuousRun",
        },
        {
          vscodeMethod: "$startedExtensionTestRun",
          vscodeOwner: "MainThreadTestingShape",
          status: "projected",
          codekEvidence: "desktop mainThreadTesting emits ext-host:testing-run-start for extension-provided run requests.",
          rendererChannel: "ext-host:testing-run-start",
        },
        {
          vscodeMethod: "$addTestsToRun",
          vscodeOwner: "MainThreadTestingShape",
          status: "projected",
          codekEvidence: "desktop mainThreadTesting normalizes serialized test chains into item snapshot events.",
          rendererChannel: "ext-host:testing-item",
        },
        {
          vscodeMethod: "$startedTestRunTask",
          vscodeOwner: "MainThreadTestingShape",
          status: "projected",
          codekEvidence: "desktop mainThreadTesting emits ext-host:testing-run-task-start and TestingService records task evidence on the owning run snapshot.",
          rendererChannel: "ext-host:testing-run-task-start",
        },
        {
          vscodeMethod: "$finishedTestRunTask",
          vscodeOwner: "MainThreadTestingShape",
          status: "projected",
          codekEvidence: "desktop mainThreadTesting emits ext-host:testing-run-task-finish and TestingService marks the task evidence completed without creating a second result owner.",
          rendererChannel: "ext-host:testing-run-task-finish",
        },
        {
          vscodeMethod: "$finishedExtensionTestRun",
          vscodeOwner: "MainThreadTestingShape",
          status: "projected",
          codekEvidence: "desktop mainThreadTesting emits ext-host:testing-run-complete.",
          rendererChannel: "ext-host:testing-run-complete",
        },
        {
          vscodeMethod: "$cancelExtensionTestRun",
          vscodeOwner: "ExtHostTestingShape",
          status: "forwarded",
          codekEvidence: "TestingService cancellation facade sends run/task cancellation through the desktop back-channel.",
          backChannel: "ext-host:testing-cancel -> ExtHostTesting.$cancelExtensionTestRun",
        },
      ],
      resultAndCoverage: [
        {
          vscodeMethod: "$appendOutputToRun",
          vscodeOwner: "MainThreadTestingShape",
          status: "projected",
          codekEvidence: "desktop mainThreadTesting emits ext-host:testing-run-output.",
          rendererChannel: "ext-host:testing-run-output",
        },
        {
          vscodeMethod: "$appendTestMessagesInRun",
          vscodeOwner: "MainThreadTestingShape",
          status: "projected",
          codekEvidence: "desktop mainThreadTesting emits ext-host:testing-run-state with message snapshots.",
          rendererChannel: "ext-host:testing-run-state",
        },
        {
          vscodeMethod: "$updateTestStateInRun",
          vscodeOwner: "MainThreadTestingShape",
          status: "projected",
          codekEvidence: "desktop mainThreadTesting maps VS Code TestResultState into TestingService result snapshots.",
          rendererChannel: "ext-host:testing-run-state",
        },
        {
          vscodeMethod: "$appendCoverage",
          vscodeOwner: "MainThreadTestingShape",
          status: "projected",
          codekEvidence: "desktop mainThreadTesting emits ext-host:testing-coverage for TestingService coverage projections.",
          rendererChannel: "ext-host:testing-coverage",
        },
        {
          vscodeMethod: "$getCoverageDetails",
          vscodeOwner: "MainThreadTestingShape",
          status: "stubbed",
          blockedOwner: "VS Code TestCoverage/LiveTestResult coverage detail lookup",
          blockedReason: "Codek exposes a renderer-to-ExtHost coverage detail back-channel, but the main-thread adapter cannot resolve VS Code resultId/taskIndex/uri details without the full TestResultService owner.",
        },
        {
          vscodeMethod: "$getCoverageDetails",
          vscodeOwner: "ExtHostTestingShape",
          status: "forwarded",
          codekEvidence: "TestingService coverage shell can ask the extension host for detail rows through the desktop IPC handler.",
          backChannel: "ext-host:testing-coverage-details -> ExtHostTesting.$getCoverageDetails",
        },
        {
          vscodeMethod: "$markTestRetired",
          vscodeOwner: "MainThreadTestingShape",
          status: "projected",
          codekEvidence: "desktop mainThreadTesting emits ext-host:testing-retire; extensionHostRuntimeBridge calls TestingService.markResultsRetired() so result peek and Testing Explorer row evidence share one retired flag source.",
          rendererChannel: "ext-host:testing-retire",
        },
        {
          vscodeMethod: "$publishTestResults",
          vscodeOwner: "ExtHostTestingShape",
          status: "forwarded",
          codekEvidence: "TestingService.completeRun() serializes completed run/result/output snapshots from the existing TestingService maps, extensionHostRuntimeBridge can call publishExtHostTestingResults when the preload API exists, and desktop mainThreadTesting has an ext-host:testing-publish-results handler for ExtHostTesting.$publishTestResults.",
          backChannel: "TestingService.completeRun -> extensionHostRuntimeBridge.publishExtHostTestingResults -> desktop mainThreadTesting ext-host:testing-publish-results -> ExtHostTesting.$publishTestResults",
        },
      ],
      extHostCallbacks: [
        {
          vscodeMethod: "$refreshTests",
          vscodeOwner: "ExtHostTestingShape",
          status: "forwarded",
          codekEvidence: "desktop IPC handler ext-host:testing-refresh-tests dispatches to ExtHostTesting.$refreshTests for a controller.",
          backChannel: "ext-host:testing-refresh-tests -> ExtHostTesting.$refreshTests",
        },
        {
          vscodeMethod: "$expandTest",
          vscodeOwner: "ExtHostTestingShape",
          status: "forwarded",
          codekEvidence: "desktop IPC handler ext-host:testing-expand-test dispatches to ExtHostTesting.$expandTest with the requested level count.",
          backChannel: "ext-host:testing-expand-test -> ExtHostTesting.$expandTest",
        },
        {
          vscodeMethod: "$syncTests",
          vscodeOwner: "ExtHostTestingShape",
          status: "forwarded",
          codekEvidence: "desktop IPC handler ext-host:testing-sync-tests dispatches to ExtHostTesting.$syncTests.",
          backChannel: "ext-host:testing-sync-tests -> ExtHostTesting.$syncTests",
        },
        {
          vscodeMethod: "$getTestsRelatedToCode",
          vscodeOwner: "ExtHostTestingShape",
          status: "forwarded",
          codekEvidence: "desktop IPC handler ext-host:testing-tests-related-to-code dispatches to ExtHostTesting.$getTestsRelatedToCode.",
          backChannel: "ext-host:testing-tests-related-to-code -> ExtHostTesting.$getTestsRelatedToCode",
        },
        {
          vscodeMethod: "$getCodeRelatedToTest",
          vscodeOwner: "ExtHostTestingShape",
          status: "forwarded",
          codekEvidence: "desktop IPC handler ext-host:testing-code-related-to-test dispatches to ExtHostTesting.$getCodeRelatedToTest.",
          backChannel: "ext-host:testing-code-related-to-test -> ExtHostTesting.$getCodeRelatedToTest",
        },
        {
          vscodeMethod: "$provideTestFollowups",
          vscodeOwner: "ExtHostTestingShape",
          status: "forwarded",
          codekEvidence: "TestingService.provideTestFollowups dispatches message followup requests through the desktop IPC handler.",
          backChannel: "ext-host:testing-provide-followups -> ExtHostTesting.$provideTestFollowups",
        },
        {
          vscodeMethod: "$executeTestFollowup",
          vscodeOwner: "ExtHostTestingShape",
          status: "forwarded",
          codekEvidence: "TestingService.executeTestFollowup dispatches selected followup handles through the desktop IPC handler.",
          backChannel: "ext-host:testing-execute-followup -> ExtHostTesting.$executeTestFollowup",
        },
        {
          vscodeMethod: "$disposeTestFollowups",
          vscodeOwner: "ExtHostTestingShape",
          status: "forwarded",
          codekEvidence: "TestingService.disposeTestFollowups dispatches handle disposal through the desktop IPC handler.",
          backChannel: "ext-host:testing-dispose-followups -> ExtHostTesting.$disposeTestFollowups",
        },
        {
          vscodeMethod: "$disposeRun",
          vscodeOwner: "ExtHostTestingShape",
          status: "blocked",
          blockedOwner: "VS Code extension-host run lifetime",
          blockedReason: "TestingService can clear local run/result projections, but it does not call ExtHostTesting.$disposeRun for extension-host run cleanup.",
        },
      ],
    },
    callbacks: {
      cancellation: "connected",
      profileConfigure: "connected",
      coverageDetails: "connected",
      continuousRun: "projected",
    },
    coverageShellAudit: {
      status: "projected",
      stateSource: "TestingService coverage projections",
      implementedEvidence: [
        "TestingService.getCoverageTreeProjection()",
        "TestingService.getCoverageViewProjection()",
        "TestingService.getCoverageEditorDecorationsProjection()",
        "TestingService.getCoverageEditorContributionShellProjection()",
        "TestingService.getCoverageOwnerFeasibilityAudit()",
      ],
      blockedOwners: [
        "Full TestCoverageView/TestCoverageTree ViewPane owner",
        "Full CodeCoverageDecorations ICodeEditor contribution",
        "CoverageDetailsModel range mapping/minimap/injected text/overlay toolbar",
      ],
      blockedReason: "Coverage shell evidence is projected from the single TestingService state source; real CodeCoverageDecorations requires the generic editor shell/App.vue ownership that is outside this Testing bridge audit.",
      noSecondState: true,
    },
  },
  noSecondState: true,
  remainingGaps: [
    "The VS Code original testService identifier is currently used by the Agent Evidence testing facade, so main-thread testing bridge ownership needs a main-thread decision before aliasing.",
    "MainThreadTesting now projects ExtHost TestController/TestItem/TestRun events into TestingService and forwards discovery callbacks for sync/refresh/expand/related-code, but full VS Code TestService ownership is not aliased to avoid replacing the Agent Evidence facade.",
    "Renderer-to-desktop-to-ExtHostTesting callbacks are exposed through TestingService command facades for run cancellation, profile configure, and coverage details; TestingService now exposes TestResultService service-level event/storage evidence, result history, result peek, a testing.openOutputPeek shell adapter descriptor, coverage tree/view/editor decoration shell projections, a Testing Explorer prefix/reveal/storage lifecycle contract projection, and a full coverage owner feasibility audit, but full VS Code Test Explorer/result peek UI remains partial.",
    "$publishTestResults has service serialization, renderer bridge, preload IPC, desktop handler evidence, and TestingService result event/storage projection evidence; full LiveTestResult object lifecycle and file-backed TestResultStorage output persistence remain partial.",
    "Continuous run can be projected to ExtHostTesting, but Codek still lacks the VS Code TestingContinuousRunService ownership and restart semantics.",
    "TestingService models controller/profile/item/run/result/history/resultPeek/coverageTree/coverageView/coverageDecorations/coverageOwnerFeasibility projection and service-level TestResultService events/storage evidence, but full VS Code Testing tree provider, LiveTestResult owner, TestProfileService, coverage ViewPane/TestCoverageTree owner, CodeCoverageDecorations ICodeEditor contribution, and result peek UI remain partial.",
  ],
}

function sortProfiles(profiles: TestRunProfileSnapshot[]): TestRunProfileSnapshot[] {
  return [...profiles].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return a.label.localeCompare(b.label) || a.profileId - b.profileId
  })
}

function resolveSummaryState(results: TestResultSnapshot[]): TestRunSummary["state"] {
  if (results.length === 0) return "unknown"
  if (results.some((result) => result.state === "running" || result.state === "queued")) return "running"
  if (results.some((result) => result.state === "errored")) return "errored"
  if (results.some((result) => result.state === "failed")) return "failed"
  if (results.every((result) => result.state === "skipped")) return "skipped"
  return "passed"
}

function resolveRunState(results: TestResultSnapshot[]): TestResultState {
  const state = resolveSummaryState(results)
  return state === "unknown" ? "skipped" : state
}

function summarizeResults(results: TestResultSnapshot[]): TestRunSummary {
  return {
    total: results.length,
    passed: results.filter((result) => result.state === "passed").length,
    failed: results.filter((result) => result.state === "failed").length,
    running: results.filter((result) => result.state === "running" || result.state === "queued").length,
    skipped: results.filter((result) => result.state === "skipped").length,
    errored: results.filter((result) => result.state === "errored").length,
    state: resolveSummaryState(results),
  }
}

function getRunIdForResult(resultId: string, runIds: string[]): string | undefined {
  return runIds.find((runId) => resultId.startsWith(`${runId}:`))
}

function testIdMatchesRetireRequest(testId: string, requestedId: string): boolean {
  return testId === requestedId || testId.startsWith(`${requestedId}\u0000`)
}

function isTestOrDescendantRetired(testId: string, retiredTestIds: Set<string>): boolean {
  for (const retiredId of retiredTestIds) {
    if (retiredId === testId || retiredId.startsWith(`${testId}\u0000`)) return true
  }
  return false
}

function cloneItem(item: TestItemSnapshot): TestItemSnapshot {
  return {
    ...item,
    range: item.range ? { ...item.range } : undefined,
    tags: item.tags ? [...item.tags] : undefined,
  }
}

function cloneRunRequest(request: TestRunRequestSnapshot): TestRunRequestSnapshot {
  return {
    ...request,
    testIds: [...request.testIds],
    excludeIds: request.excludeIds ? [...request.excludeIds] : undefined,
  }
}

function cloneRun(run: TestRunSnapshot): TestRunSnapshot {
  return {
    ...run,
    testIds: [...run.testIds],
    excludeIds: run.excludeIds ? [...run.excludeIds] : undefined,
    tasks: run.tasks.map((task) => ({ ...task })),
    output: run.output.map((output) => ({ ...output })),
  }
}

function cloneResult(result: TestResultSnapshot): TestResultSnapshot {
  return {
    ...result,
    messages: [...result.messages],
  }
}

function clonePublishedResult(result: PublishedTestResultSnapshot): PublishedTestResultSnapshot {
  return {
    ...result,
    summary: { ...result.summary },
    tests: result.tests.map(cloneResult),
    tasks: result.tasks.map((task) => ({ ...task })),
    output: result.output.map((output) => ({ ...output })),
  }
}

function cloneCoverageFile(file: TestCoverageFileSnapshot): TestCoverageFileSnapshot {
  return {
    ...file,
    statement: { ...file.statement },
    branch: file.branch ? { ...file.branch } : undefined,
    declaration: file.declaration ? { ...file.declaration } : undefined,
    testIds: file.testIds ? [...file.testIds] : undefined,
  }
}

const RESULT_PEEK_ADAPTER: TestResultPeekProjection["adapter"] = {
  codekOwner: "TestingService.getResultPeekProjection()",
  vscodeSourcePaths: [
    "src/vs/workbench/contrib/testing/browser/testingOutputPeek.ts",
    "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsViewContent.ts",
    "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsTree.ts",
    "src/vs/workbench/contrib/testing/common/testingPeekOpener.ts",
  ],
  blockedOwners: [
    "TestingOutputPeekController",
    "TestResultsViewContent DOM tree",
    "OutputPeekTree context menu/action runner",
    "PeekViewWidget/editor contribution integration",
  ],
  noSecondState: true,
}

const RESULT_PEEK_SHELL_ADAPTER: TestResultPeekOpenDescriptor["shellAdapter"] = {
  kind: "result-peek-shell-adapter",
  codekOwner: "TestingService.openResultPeek()",
  vscodeSourcePaths: [
    "src/vs/workbench/contrib/testing/browser/testingOutputPeek.ts",
    "src/vs/workbench/contrib/testing/browser/testExplorerActions.ts",
    "src/vs/workbench/contrib/testing/common/testingPeekOpener.ts",
  ],
  blockedOwners: [
    "TestingOutputPeekController editor contribution",
    "PeekViewWidget ownership",
    "OutputPeekTree action runner and TestResultsViewContent DOM tree",
  ],
  preservesAgentEvidence: true,
  noSecondState: true,
}

const RESULT_HISTORY_ADAPTER: TestResultServiceHistoryProjection["adapter"] = {
  kind: "test-result-service-history-projection",
  codekOwner: "TestingService.getResultHistoryProjection()",
  implementedOwners: [
    "retained run list from TestingService.getRuns()",
    "retained result list from TestingService.getResults()",
    "isRunning/hasAnyResults context evidence",
    "per-run output message counts",
    "ITestResultService onResultsChanged event source",
    "ITestResultService onTestChanged event source",
    "ITestResultStorage storedTestResults serialization evidence",
  ],
  blockedOwners: [
    "LiveTestResult disposable lifecycle and telemetry",
    "TestResultStorage file-service cleanup/output-stream owner",
  ],
  noSecondState: true,
}

const RESULT_STORAGE_ADAPTER: TestResultServiceStorageProjection["adapter"] = {
  kind: "test-result-storage-projection",
  codekOwner: "TestingService.getResultStorageProjection()",
  vscodeSourcePaths: [
    "src/vs/workbench/contrib/testing/common/testResultStorage.ts",
    "src/vs/workbench/contrib/testing/common/testResultService.ts",
    "src/vs/workbench/contrib/testing/common/storedValue.ts",
  ],
  implementedOwners: [
    "storedTestResults key evidence",
    "completed result serialization from TestingService.createPublishedResultSnapshot()",
    "retained result ids derived from TestingService runs/results/output",
  ],
  blockedOwners: [
    "TestResultStorage workspaceStorageHome file owner",
    "BaseTestResultStorage byte budget cleanup",
    "result output stream persistence",
  ],
  noSecondState: true,
}

const FILE_BACKED_RESULT_STORAGE_OWNER_MATRIX: TestingOwnerGapMatrixEntry[] = [
  {
    capability: "storedTestResults manifest",
    status: "projected",
    vscodeSourcePath: "src/vs/workbench/contrib/testing/common/testResultStorage.ts",
    codekProjection: "TestingService.getResultStorageProjection().retainedResultIds",
    codekEvidence: "Completed runs serialize into PublishedTestResultSnapshot records and expose the VS Code storedTestResults key from the same TestingService runs/results/output maps.",
    requiredOwner: "BaseTestResultStorage StoredValue<storedTestResults> manifest owner",
    blockedReason: "Codek projects the manifest payload but does not own the VS Code StoredValue instance or storage service write lifecycle.",
    nextAuthorizedFiles: ["frontend/vite-project/src/testing/testingService.ts", "frontend/vite-project/src/testing/testingService.test.ts"],
  },
  {
    capability: "workspaceStorageHome result files",
    status: "blocked",
    vscodeSourcePath: "src/vs/workbench/contrib/testing/common/testResultStorage.ts",
    codekProjection: "blocked",
    codekEvidence: "No runtime code writes test result JSON files under workspaceStorageHome.",
    requiredOwner: "TestResultStorage directory/readForResultId/writeForResultId/deleteResult owner",
    blockedReason: "Claiming this requires a file-service-backed TestResultStorage migration; a service projection would be false ownership.",
    nextAuthorizedFiles: ["frontend/vite-project/src/testing/testingService.ts", "frontend/vite-project/src/testing/testingService.test.ts"],
  },
  {
    capability: "raw output stream persistence",
    status: "partial",
    vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsOutput.ts",
    codekProjection: "TestingService runs.output",
    codekEvidence: "TestingService stores output message slices and exposes them through result history/result peek rows.",
    requiredOwner: "LiveTestResult TaskRawOutput stream and file-backed output replay owner",
    blockedReason: "Output slices are retained in the TestingService snapshot only; Codek does not own VS Code's task raw-output append/read stream.",
    nextAuthorizedFiles: ["frontend/vite-project/src/testing/testingService.ts", "frontend/vite-project/src/testing/testingService.test.ts"],
  },
]

const TEST_RESULTS_VIEWPANE_SHELL_ADAPTER: TestResultsViewPaneShellProjection["adapter"] = {
  kind: "test-results-viewpane-shell",
  codekOwner: "App.vue:data-codek-smoke=\"testing-results-viewpane-shell-owner\"",
  vscodeSourcePaths: [
    "src/vs/workbench/contrib/testing/browser/testing.contribution.ts",
    "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsViewContent.ts",
    "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsTree.ts",
    "src/vs/workbench/contrib/testing/common/testResultService.ts",
  ],
  implementedOwners: [
    "Test Results panel container DOM evidence",
    "read-only result tree rows from TestingService result history",
    "selected TestResultPeek entry evidence",
  ],
  blockedOwners: [
    "VS Code TestResultsViewContent SplitView DOM owner",
    "VS Code OutputPeekTree WorkbenchCompressibleObjectTree owner",
    "TestResultsViewContent FollowupActionWidget owner",
  ],
  noSecondState: true,
}

const TEST_RESULTS_VIEW_CONTENT_DOM_OWNER_MATRIX: TestingOwnerGapMatrixEntry[] = [
  {
    capability: "Test Results panel shell rows",
    status: "partial",
    vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsViewContent.ts",
    codekProjection: "TestingService.getTestResultsViewPaneShellProjection().rows",
    codekEvidence: "Rows are derived from result history and result peek entries without a second result tree store.",
    requiredOwner: "TestResultsViewContent SplitView/TestResultsTree render owner",
    blockedReason: "Codek can project the rows but does not own the VS Code SplitView, tree renderer, or layout lifecycle.",
    nextAuthorizedFiles: ["frontend/vite-project/src/testing/testingService.ts", "frontend/vite-project/src/testing/testingService.test.ts"],
  },
  {
    capability: "live result output refresh",
    status: "partial",
    vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsViewContent.ts",
    codekProjection: "TestingService.getResultPeekProjection()",
    codekEvidence: "Running results remain visible through cancellable peek entries and output message counts.",
    requiredOwner: "LiveTestResult.onComplete/onChange listeners inside TestResultsViewContent/TestResultsTree",
    blockedReason: "Codek snapshots expose running/completed state, but there is no TestResultsViewContent owner waiting on LiveTestResult.onComplete or refreshing tree subjects.",
    nextAuthorizedFiles: ["frontend/vite-project/src/testing/testingService.ts", "frontend/vite-project/src/testing/testingService.test.ts"],
  },
  {
    capability: "message followup actions",
    status: "blocked",
    vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsViewContent.ts",
    codekProjection: "TestingService.provideTestFollowups/executeTestFollowup/disposeTestFollowups",
    codekEvidence: "Provider callbacks are bridged through TestingService and mainThreadTesting.",
    requiredOwner: "FollowupActionWidget request/render/execute/dispose owner",
    blockedReason: "The bridge exists, but visible followup UI requires the VS Code TestResultsViewContent widget lifecycle.",
    nextAuthorizedFiles: ["frontend/vite-project/src/testing/testingService.ts", "frontend/vite-project/src/testing/testingService.test.ts"],
  },
]

const TESTING_EXPLORER_DOM_OWNER_MATRIX: TestingOwnerGapMatrixEntry[] = [
  {
    capability: "TestingExplorerView pane shell",
    status: "partial",
    vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
    codekProjection: "TestingService.getTestingExplorerContractProjection().domOwnerAdapter",
    codekEvidence: "The projection exposes shell selectors, row selectors, filter value attributes, and command ids derived from TestingService rows.",
    requiredOwner: "TestingExplorerView extends ViewPane renderBody/layoutBody/focus owner",
    blockedReason: "Codek has shell evidence only; claiming ViewPane ownership requires the real workbench view owner and would cross into App.vue or generic shell wiring.",
    nextAuthorizedFiles: ["frontend/vite-project/src/testing/testingService.ts", "frontend/vite-project/src/testing/testingService.test.ts"],
  },
  {
    capability: "TestingViewPaneContainer sidebar owner",
    status: "blocked",
    vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/testingViewPaneContainer.ts",
    codekProjection: "viewRegistry container descriptor",
    codekEvidence: "registerTestingWorkbenchViews can register workbench.view.testing descriptors.",
    requiredOwner: "TestingViewPaneContainer extends ViewPaneContainer instance and sidebar DOM lifecycle",
    blockedReason: "The registry descriptor is not the container instance; real ownership needs the generic workbench container shell.",
    nextAuthorizedFiles: ["frontend/vite-project/src/testing/testingService.ts", "frontend/vite-project/src/testing/testingService.test.ts", "frontend/vite-project/src/workbench/viewRegistry.ts"],
  },
  {
    capability: "WorkbenchObjectTree virtualization",
    status: "partial",
    vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/explorerProjections/testingObjectTree.ts",
    codekProjection: "TestingService.getTestingExplorerContractProjection().objectTreeAdapter",
    codekEvidence: "Object tree ids, optimized view state, focused row, selected row, and visible row ids are projected from TestingService parent/child links.",
    requiredOwner: "TestingObjectTree extends WorkbenchObjectTree DOM virtualization, keyboard, and optimized-view-state saver",
    blockedReason: "Codek provides the tree data contract but not the WorkbenchObjectTree DOM/keyboard/lifecycle owner.",
    nextAuthorizedFiles: ["frontend/vite-project/src/testing/testingService.ts", "frontend/vite-project/src/testing/testingService.test.ts"],
  },
  {
    capability: "TestingExplorerFilter and menu action runner",
    status: "partial",
    vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/testingExplorerFilter.ts",
    codekProjection: "TestingService.getTestingExplorerContractProjection().filterActionAdapter",
    codekEvidence: "Filter text is parsed into tags/globs and commandRegistry action ids are exposed without a second tree state.",
    requiredOwner: "TestingExplorerFilter input widget, TestExplorerFilterState, MenuId.TestItem/ViewTitle action runner",
    blockedReason: "The parser/projection is available, but visible input history, context-key overlay, and action runner ownership require the real TestingExplorerView UI.",
    nextAuthorizedFiles: ["frontend/vite-project/src/testing/testingService.ts", "frontend/vite-project/src/testing/testingService.test.ts", "frontend/vite-project/src/vscode-adapter/platform/actions/common/menuService.ts"],
  },
]

const LIVE_TEST_RESULT_LIFECYCLE_MATRIX: TestingOwnerGapMatrixEntry[] = [
  {
    capability: "run insertion and completion",
    status: "projected",
    vscodeSourcePath: "src/vs/workbench/contrib/testing/common/testResultService.ts",
    codekProjection: "TestingService.startRun()/completeRun()",
    codekEvidence: "Runs enter the TestingService map, emit result events, and keep startedAt/completedAt snapshots.",
    requiredOwner: "ITestResultService.push(new LiveTestResult(...)) and onComplete scheduling",
    blockedReason: "Codek projects equivalent user-visible state but does not instantiate VS Code LiveTestResult objects.",
    nextAuthorizedFiles: ["frontend/vite-project/src/testing/testingService.ts", "frontend/vite-project/src/testing/testingService.test.ts"],
  },
  {
    capability: "task lifecycle and raw output",
    status: "partial",
    vscodeSourcePath: "src/vs/workbench/contrib/testing/common/testResult.ts",
    codekProjection: "TestingService.startRunTask()/finishRunTask()/appendOutput()",
    codekEvidence: "Task snapshots and output slices are retained on the same TestRunSnapshot used by history and peek projections.",
    requiredOwner: "LiveTestResult task list, TaskRawOutput append/read stream, and task-level change events",
    blockedReason: "Codek stores task snapshots, but not VS Code LiveTestResult task objects or raw output stream emitters.",
    nextAuthorizedFiles: ["frontend/vite-project/src/testing/testingService.ts", "frontend/vite-project/src/testing/testingService.test.ts"],
  },
  {
    capability: "item change and retire events",
    status: "projected",
    vscodeSourcePath: "src/vs/workbench/contrib/testing/common/testResult.ts",
    codekProjection: "TestingService.updateRunItemState()/markResultsRetired()",
    codekEvidence: "TestingService emits computedStateChange, newMessage, and retired item events over the same result snapshots.",
    requiredOwner: "LiveTestResult.onChange event source and TestResultItemChangeReason ownership",
    blockedReason: "The event contract is projected from snapshots; Codek does not own LiveTestResult's internal emitter/disposal lifecycle.",
    nextAuthorizedFiles: ["frontend/vite-project/src/testing/testingService.ts", "frontend/vite-project/src/testing/testingService.test.ts"],
  },
  {
    capability: "dispose and telemetry",
    status: "blocked",
    vscodeSourcePath: "src/vs/workbench/contrib/testing/common/testResult.ts",
    codekProjection: "blocked",
    codekEvidence: "No TestingService path owns LiveTestResult disposal or telemetry.",
    requiredOwner: "LiveTestResult DisposableStore and telemetry owner",
    blockedReason: "This requires migrating the VS Code LiveTestResult object lifecycle; adding fields to snapshots would be false ownership.",
    nextAuthorizedFiles: ["frontend/vite-project/src/testing/testingService.ts", "frontend/vite-project/src/testing/testingService.test.ts"],
  },
]

const COVERAGE_TREE_ADAPTER: TestCoverageTreeProjection["adapter"] = {
  codekOwner: "TestingService.getCoverageTreeProjection()",
  vscodeSourcePaths: [
    "src/vs/workbench/contrib/testing/common/testCoverageService.ts",
    "src/vs/workbench/contrib/testing/browser/testCoverageView.ts",
    "src/vs/workbench/contrib/testing/browser/codeCoverageDecorations.ts",
  ],
  blockedOwners: [
    "TestCoverageView/TestCoverageTree DOM owner",
    "Full CodeCoverageDecorations editor contribution",
  ],
  noSecondState: true,
}

const COVERAGE_VIEW_SHELL_ADAPTER: TestCoverageViewProjection["shellAdapter"] = {
  kind: "coverage-view-shell-adapter",
  codekOwner: "TestingService.getCoverageViewProjection()",
  vscodeSourcePaths: [
    "src/vs/workbench/contrib/testing/common/testCoverageService.ts",
    "src/vs/workbench/contrib/testing/browser/testCoverageView.ts",
    "src/vs/workbench/contrib/testing/common/testCoverage.ts",
  ],
  implementedOwners: [
    "selected coverage id",
    "filter-to-test id",
    "inline coverage visibility",
    "coverage sort order",
  ],
  blockedOwners: [
    "TestCoverageView ViewPane DOM",
    "WorkbenchCompressibleObjectTree/TestCoverageTree renderer",
    "ResourceLabels/ActionBar/menu runner integration",
  ],
  noSecondState: true,
}

const COVERAGE_DECORATIONS_ADAPTER: TestCoverageEditorDecorationsProjection["adapter"] = {
  kind: "coverage-editor-decoration-projection",
  codekOwner: "TestingService.getCoverageEditorDecorationsProjection()",
  vscodeSourcePaths: [
    "src/vs/workbench/contrib/testing/browser/codeCoverageDecorations.ts",
    "src/vs/workbench/contrib/testing/common/testCoverage.ts",
    "src/vs/workbench/contrib/testing/common/testCoverageService.ts",
  ],
  implementedOwners: [
    "selected coverage file lookup",
    "filter-to-test projection",
    "inline coverage state projection",
    "coverage detail command evidence",
    "CoverageDetailsModel range model shell evidence",
  ],
  blockedOwners: [
    "ICodeEditor contribution registration",
    "CoverageDetailsModel statement/branch ranges",
    "model decorations/minimap/injected text",
    "coverage toolbar overlay widget",
  ],
  noSecondState: true,
}

const COVERAGE_RENDERER_SHELL_ADAPTER: TestCoverageRendererShellProjection["adapter"] = {
  kind: "coverage-renderer-shell",
  codekOwner: "App.vue:data-agent-evidence-surface=\"testing\"",
  vscodeSourcePaths: [
    "src/vs/workbench/contrib/testing/browser/testCoverageView.ts",
    "src/vs/workbench/contrib/testing/common/testCoverage.ts",
    "src/vs/workbench/contrib/testing/common/testCoverageService.ts",
  ],
  implementedOwners: [
    "projection-backed coverage row DOM smoke",
    "selected coverage row evidence",
    "sort/filter/inline state data attributes",
    "coverage command id evidence",
  ],
  blockedOwners: [
    "ViewPane lifecycle and layout owner",
    "WorkbenchCompressibleObjectTree/TestCoverageTree virtualization",
    "ResourceLabels and ActionBar/menu runner integration",
  ],
  noSecondState: true,
}

const COVERAGE_EDITOR_CONTRIBUTION_SHELL_ADAPTER: TestCoverageEditorContributionShellProjection["adapter"] = {
  kind: "coverage-editor-contribution-shell",
  codekOwner: "TestingService.getCoverageEditorContributionShellProjection()",
  vscodeSourcePaths: [
    "src/vs/workbench/contrib/testing/browser/codeCoverageDecorations.ts",
    "src/vs/workbench/contrib/testing/common/testCoverage.ts",
    "src/vs/workbench/contrib/testing/common/testCoverageService.ts",
  ],
  implementedOwners: [
    "selected editor coverage lookup evidence",
    "inline toggle/filter command evidence",
    "per-test coverage capability flag",
    "CoverageDetailsModel range model shell evidence",
  ],
  blockedOwners: [
    "ICodeEditor contribution registration",
    "CoverageDetailsModel statement/branch ranges",
    "model decorations/minimap/injected text",
    "coverage toolbar overlay widget",
  ],
  noSecondState: true,
}

const COVERAGE_GENERIC_EDITOR_SHELL_CONTRACT: TestCoverageGenericEditorShellContract = {
  status: "blocked",
  stateSource: "TestingService.getCoverageEditorDecorationsProjection()",
  vscodeSourcePaths: [
    "src/vs/workbench/contrib/testing/browser/codeCoverageDecorations.ts",
    "src/vs/editor/browser/editorBrowser.ts",
    "src/vs/editor/common/model/textModel.ts",
  ],
  requiredEditorApis: [
    "ICodeEditor.getModel()/onDidChangeModel/onWillChangeModel",
    "ICodeEditor.onDidChangeConfiguration(EditorOption.lineHeight)",
    "ICodeEditor.onMouseMove/onMouseLeave",
    "ICodeEditor.changeDecorations/create owner-scoped decorations",
    "ICodeEditor.addOverlayWidget/removeOverlayWidget",
    "ICodeEditor.changeViewZones",
    "ICodeEditor.getContribution(editor.contrib.coverageDecorations)",
  ],
  requiredTextModelApis: [
    "ITextModel.changeDecorations/deltaDecorations",
    "ITextModel.getDecorationsInRange",
    "ITextModel.getAllDecorations",
    "ITextModel.getValueInRange",
    "IModelDecorationOptions.minimap MinimapPosition.Gutter",
    "InjectedTextOptions before/after inline text",
  ],
  expectedAdapterMethods: [
    "registerEditorContribution(CodeCoverageDecorations.ID)",
    "resolveActiveCodeEditorModelUri()",
    "applyCoverageDecorations(uri, ranges, showInline, showMinimap)",
    "registerCoverageToolbarOverlay(uri)",
    "wireCoverageNavigationCommands(goToNextMissedLine/goToPreviousMissedLine)",
    "syncDecorationRangesBeforeModelChange()",
  ],
  wiringPrerequisites: [
    "generic editor shell owner/adapter authorized by main thread",
    "Testing coverage projection wired to the active Codek editor model uri",
    "TestingService.requestCoverageDetails() result mapped into CoverageDetailsModel-compatible ranges",
    "context keys for hasCoverageInFile/hasPerTestCoverage/hasInlineCoverageDetails",
    "toolbar/menu command routing for toggle inline, filter-to-test, rerun, and missed-line navigation",
  ],
  blockedReason: "Codek has TestingService coverage projection evidence, but no authorized generic ICodeEditor/TextModel shell adapter for owner-scoped decorations, minimap/injected text, overlay widgets, view zones, model-change sync, and editor contribution registration.",
  noSecondState: true,
}

const COVERAGE_OWNER_FEASIBILITY_AUDIT: Omit<TestCoverageOwnerFeasibilityAudit, "viewOwner" | "editorContributionOwner"> & {
  viewOwner: Pick<TestCoverageOwnerFeasibilityAudit["viewOwner"], "requiredOwners">
  editorContributionOwner: Pick<TestCoverageOwnerFeasibilityAudit["editorContributionOwner"], "requiredOwners">
} = {
  status: "partial",
  codekStateSource: "TestingService coverage projections",
  vscodeSourcePaths: [
    "src/vs/workbench/contrib/testing/browser/testCoverageView.ts",
    "src/vs/workbench/contrib/testing/browser/codeCoverageDecorations.ts",
    "src/vs/workbench/contrib/testing/common/testCoverageService.ts",
    "src/vs/workbench/contrib/testing/common/testCoverage.ts",
  ],
  viewOwner: {
    requiredOwners: [
      "TestCoverageView extends ViewPane",
      "TestCoverageTree wraps WorkbenchCompressibleObjectTree",
      "ResourceLabels-backed file coverage renderer",
      "ActionBar/menu runner for filtered-to-test and tree actions",
    ],
  },
  viewPaneOwnerContract: {
    status: "blocked",
    stateSource: "TestingService.getCoverageViewProjection()",
    codekCanProvide: [
      "selected coverage id",
      "filter-to-test id",
      "inline coverage visibility",
      "coverage sort order",
      "coverage tree row snapshots and command ids",
      "CoverageDetailsModel range model shell evidence",
    ],
    vscodeRequiredOwners: [
      "TestCoverageView extends ViewPane renderBody/layoutBody/collapseAll",
      "TestCoverageTree WorkbenchCompressibleObjectTree virtualization and identity provider",
      "ResourceLabels file/folder label rendering with decorations",
      "ActionBar/MenuId.TestCoverageFilterItem and ViewTitle action runner",
    ],
    blockedReason: "TestingService can supply coverage projection data, but Codek does not own the VS Code ViewPane/TestCoverageTree DOM lifecycle, ResourceLabels, or ActionBar/menu runner required to claim the full coverage view owner.",
  },
  editorContributionOwner: {
    requiredOwners: [
      "CodeCoverageDecorations registered as editor.contrib.coverageDecorations",
      "CoverageDetailsModel ranges",
      "model decorations/minimap/injected text",
      "CoverageToolbarWidget overlay widget",
    ],
  },
  fullOwnerMigration: {
    canClaimFullOwner: false,
    viewPaneOwnerReady: false,
    editorContributionOwnerReady: false,
    blockedReason: "ViewPane/TestCoverageTree and ICodeEditor CodeCoverageDecorations owners are still represented by TestingService projections, not migrated VS Code owners.",
  },
  remainingBlockers: [
    "Full TestCoverageView/TestCoverageTree ViewPane owner is not migrated.",
    "Full CodeCoverageDecorations ICodeEditor contribution is not registered.",
    "CoverageDetailsModel range mapping/minimap/injected text/overlay toolbar are still blocked.",
  ],
  noSecondState: true,
}

function cloneResultPeekAdapter(): TestResultPeekProjection["adapter"] {
  return {
    ...RESULT_PEEK_ADAPTER,
    vscodeSourcePaths: [...RESULT_PEEK_ADAPTER.vscodeSourcePaths],
    blockedOwners: [...RESULT_PEEK_ADAPTER.blockedOwners],
  }
}

function cloneResultPeekShellAdapter(): TestResultPeekOpenDescriptor["shellAdapter"] {
  return {
    ...RESULT_PEEK_SHELL_ADAPTER,
    vscodeSourcePaths: [...RESULT_PEEK_SHELL_ADAPTER.vscodeSourcePaths],
    blockedOwners: [...RESULT_PEEK_SHELL_ADAPTER.blockedOwners],
  }
}

function cloneResultHistoryAdapter(): TestResultServiceHistoryProjection["adapter"] {
  return {
    ...RESULT_HISTORY_ADAPTER,
    implementedOwners: [...RESULT_HISTORY_ADAPTER.implementedOwners],
    blockedOwners: [...RESULT_HISTORY_ADAPTER.blockedOwners],
  }
}

function cloneResultStorageAdapter(): TestResultServiceStorageProjection["adapter"] {
  return {
    ...RESULT_STORAGE_ADAPTER,
    vscodeSourcePaths: [...RESULT_STORAGE_ADAPTER.vscodeSourcePaths],
    implementedOwners: [...RESULT_STORAGE_ADAPTER.implementedOwners],
    blockedOwners: [...RESULT_STORAGE_ADAPTER.blockedOwners],
  }
}

function cloneResultStorageProjection(projection: TestResultServiceStorageProjection): TestResultServiceStorageProjection {
  return {
    ...projection,
    retainedResultIds: [...projection.retainedResultIds],
    serializedResults: projection.serializedResults.map(clonePublishedResult),
    fileBackedOwnerMatrix: cloneOwnerGapMatrix(projection.fileBackedOwnerMatrix),
    adapter: {
      ...projection.adapter,
      vscodeSourcePaths: [...projection.adapter.vscodeSourcePaths],
      implementedOwners: [...projection.adapter.implementedOwners],
      blockedOwners: [...projection.adapter.blockedOwners],
    },
  }
}

function cloneTestResultsViewPaneShellAdapter(): TestResultsViewPaneShellProjection["adapter"] {
  return {
    ...TEST_RESULTS_VIEWPANE_SHELL_ADAPTER,
    vscodeSourcePaths: [...TEST_RESULTS_VIEWPANE_SHELL_ADAPTER.vscodeSourcePaths],
    implementedOwners: [...TEST_RESULTS_VIEWPANE_SHELL_ADAPTER.implementedOwners],
    blockedOwners: [...TEST_RESULTS_VIEWPANE_SHELL_ADAPTER.blockedOwners],
  }
}

function cloneTestResultsViewPaneShellProjection(projection: TestResultsViewPaneShellProjection): TestResultsViewPaneShellProjection {
  return {
    ...projection,
    rows: projection.rows.map((row) => ({
      ...row,
      resultIds: [...row.resultIds],
      commandIds: [...row.commandIds],
    })),
    commandIds: [...projection.commandIds],
    domOwnerMatrix: cloneOwnerGapMatrix(projection.domOwnerMatrix),
    adapter: cloneTestResultsViewPaneShellAdapter(),
  }
}

function cloneCoverageTreeAdapter(): TestCoverageTreeProjection["adapter"] {
  return {
    ...COVERAGE_TREE_ADAPTER,
    vscodeSourcePaths: [...COVERAGE_TREE_ADAPTER.vscodeSourcePaths],
    blockedOwners: [...COVERAGE_TREE_ADAPTER.blockedOwners],
  }
}

function cloneCoverageViewShellAdapter(): TestCoverageViewProjection["shellAdapter"] {
  return {
    ...COVERAGE_VIEW_SHELL_ADAPTER,
    vscodeSourcePaths: [...COVERAGE_VIEW_SHELL_ADAPTER.vscodeSourcePaths],
    implementedOwners: [...COVERAGE_VIEW_SHELL_ADAPTER.implementedOwners],
    blockedOwners: [...COVERAGE_VIEW_SHELL_ADAPTER.blockedOwners],
  }
}

function cloneCoverageDecorationsAdapter(): TestCoverageEditorDecorationsProjection["adapter"] {
  return {
    ...COVERAGE_DECORATIONS_ADAPTER,
    vscodeSourcePaths: [...COVERAGE_DECORATIONS_ADAPTER.vscodeSourcePaths],
    implementedOwners: [...COVERAGE_DECORATIONS_ADAPTER.implementedOwners],
    blockedOwners: [...COVERAGE_DECORATIONS_ADAPTER.blockedOwners],
  }
}

function cloneCoverageRendererShellAdapter(): TestCoverageRendererShellProjection["adapter"] {
  return {
    ...COVERAGE_RENDERER_SHELL_ADAPTER,
    vscodeSourcePaths: [...COVERAGE_RENDERER_SHELL_ADAPTER.vscodeSourcePaths],
    implementedOwners: [...COVERAGE_RENDERER_SHELL_ADAPTER.implementedOwners],
    blockedOwners: [...COVERAGE_RENDERER_SHELL_ADAPTER.blockedOwners],
  }
}

function cloneCoverageEditorContributionShellAdapter(): TestCoverageEditorContributionShellProjection["adapter"] {
  return {
    ...COVERAGE_EDITOR_CONTRIBUTION_SHELL_ADAPTER,
    vscodeSourcePaths: [...COVERAGE_EDITOR_CONTRIBUTION_SHELL_ADAPTER.vscodeSourcePaths],
    implementedOwners: [...COVERAGE_EDITOR_CONTRIBUTION_SHELL_ADAPTER.implementedOwners],
    blockedOwners: [...COVERAGE_EDITOR_CONTRIBUTION_SHELL_ADAPTER.blockedOwners],
  }
}

function cloneCoverageGenericEditorShellContract(): TestCoverageGenericEditorShellContract {
  return {
    ...COVERAGE_GENERIC_EDITOR_SHELL_CONTRACT,
    vscodeSourcePaths: [...COVERAGE_GENERIC_EDITOR_SHELL_CONTRACT.vscodeSourcePaths],
    requiredEditorApis: [...COVERAGE_GENERIC_EDITOR_SHELL_CONTRACT.requiredEditorApis],
    requiredTextModelApis: [...COVERAGE_GENERIC_EDITOR_SHELL_CONTRACT.requiredTextModelApis],
    expectedAdapterMethods: [...COVERAGE_GENERIC_EDITOR_SHELL_CONTRACT.expectedAdapterMethods],
    wiringPrerequisites: [...COVERAGE_GENERIC_EDITOR_SHELL_CONTRACT.wiringPrerequisites],
  }
}

function cloneUpperOwnerProjection(projection: TestingUpperOwnerProjection): TestingUpperOwnerProjection {
  return {
    ...projection,
    vscodeSourcePaths: [...projection.vscodeSourcePaths],
    collection: {
      ...projection.collection,
      rootIds: [...projection.collection.rootIds],
      busyItemIds: [...projection.collection.busyItemIds],
      diffListener: { ...projection.collection.diffListener },
    },
    resultService: {
      ...projection.resultService,
      runningRunIds: [...projection.resultService.runningRunIds],
      completedRunIds: [...projection.resultService.completedRunIds],
      retiredResultIds: [...projection.resultService.retiredResultIds],
      eventProjection: { ...projection.resultService.eventProjection },
      storage: {
        ...projection.resultService.storage,
        blockedOwners: [...projection.resultService.storage.blockedOwners],
        fileBackedOwnerMatrix: cloneOwnerGapMatrix(projection.resultService.storage.fileBackedOwnerMatrix),
      },
    },
    liveResultLifecycle: {
      ...projection.liveResultLifecycle,
      runningRunIds: [...projection.liveResultLifecycle.runningRunIds],
      completedRunIds: [...projection.liveResultLifecycle.completedRunIds],
      cancellableRunIds: [...projection.liveResultLifecycle.cancellableRunIds],
      retiredResultIds: [...projection.liveResultLifecycle.retiredResultIds],
      retiredTestIds: [...projection.liveResultLifecycle.retiredTestIds],
      lifecycleMatrix: cloneOwnerGapMatrix(projection.liveResultLifecycle.lifecycleMatrix),
      blockedOwners: [...projection.liveResultLifecycle.blockedOwners],
    },
    profileDefaults: {
      ...projection.profileDefaults,
      defaultsByControllerAndGroup: cloneProfileGroupRecord(projection.profileDefaults.defaultsByControllerAndGroup),
      fallbackProfileIdsByControllerAndGroup: cloneProfileFallbackRecord(projection.profileDefaults.fallbackProfileIdsByControllerAndGroup),
      blockedOwners: [...projection.profileDefaults.blockedOwners],
    },
    messageFollowups: {
      ...projection.messageFollowups,
      blockedOwners: [...projection.messageFollowups.blockedOwners],
    },
    uiOwners: {
      ...projection.uiOwners,
      testingExplorer: cloneOwnerContractAudit(projection.uiOwners.testingExplorer),
      resultPeek: cloneOwnerContractAudit(projection.uiOwners.resultPeek),
      coverageEditor: cloneOwnerContractAudit(projection.uiOwners.coverageEditor),
    },
  }
}

function cloneOwnerGapMatrix(matrix: TestingOwnerGapMatrixEntry[]): TestingOwnerGapMatrixEntry[] {
  return matrix.map((entry) => ({
    ...entry,
    nextAuthorizedFiles: [...entry.nextAuthorizedFiles],
  }))
}

function cloneProfileGroupRecord(record: Record<string, Partial<Record<TestRunProfileGroup, number[]>>>): Record<string, Partial<Record<TestRunProfileGroup, number[]>>> {
  const clone: Record<string, Partial<Record<TestRunProfileGroup, number[]>>> = {}
  for (const [controllerId, groups] of Object.entries(record)) {
    clone[controllerId] = {}
    for (const group of ["run", "debug", "coverage"] as const) {
      const ids = groups[group]
      if (ids) clone[controllerId][group] = [...ids]
    }
  }
  return clone
}

function cloneProfileFallbackRecord(record: Record<string, Partial<Record<TestRunProfileGroup, number | undefined>>>): Record<string, Partial<Record<TestRunProfileGroup, number | undefined>>> {
  const clone: Record<string, Partial<Record<TestRunProfileGroup, number | undefined>>> = {}
  for (const [controllerId, groups] of Object.entries(record)) {
    clone[controllerId] = { ...groups }
  }
  return clone
}

function getCoveragePercent(metric?: { covered: number; total: number }): number | null {
  if (!metric || metric.total <= 0) return null
  return Math.round((metric.covered / metric.total) * 1000) / 10
}

function createCoverageTreeNode(file: TestCoverageFileSnapshot, filteredToTestId?: string): TestCoverageTreeNodeSnapshot {
  const testIds = file.testIds ? [...file.testIds] : []
  return {
    id: file.id,
    uri: file.uri,
    label: getBasenameFromUri(file.uri),
    statementPercent: getCoveragePercent(file.statement),
    branchPercent: getCoveragePercent(file.branch),
    declarationPercent: getCoveragePercent(file.declaration),
    statement: { ...file.statement },
    branch: file.branch ? { ...file.branch } : undefined,
    declaration: file.declaration ? { ...file.declaration } : undefined,
    testIds,
    detailsAvailable: Boolean(testIds.length) && (!filteredToTestId || testIds.includes(filteredToTestId)),
    commandIds: [
      TESTING_RUN_COMMAND_IDS.Coverage,
      TESTING_COVERAGE_COMMAND_IDS.OpenCoverage,
      TESTING_COVERAGE_COMMAND_IDS.FilterToTest,
      TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
    ],
    evidenceUri: `codek-testing://coverage-tree/${encodeURIComponent(file.id)}`,
  }
}

function buildCoverageTreeNodes(files: TestCoverageFileSnapshot[], filteredToTestId: string | undefined, sortOrder: TestCoverageSortOrder): TestCoverageTreeNodeSnapshot[] {
  const nodes = files
    .filter((file) => !filteredToTestId || file.testIds?.includes(filteredToTestId))
    .map((file) => createCoverageTreeNode(file, filteredToTestId))
  return nodes.sort((a, b) => compareCoverageNodes(a, b, sortOrder))
}

function createCoverageRendererShellRow(node: TestCoverageTreeNodeSnapshot, selectedCoverageId?: string): TestCoverageRendererShellRowSnapshot {
  const statement = node.statementPercent === null ? "no statement coverage" : `${node.statementPercent}% statements`
  const branch = node.branchPercent === null ? "no branch coverage" : `${node.branchPercent}% branches`
  return {
    ...node,
    statement: { ...node.statement },
    branch: node.branch ? { ...node.branch } : undefined,
    declaration: node.declaration ? { ...node.declaration } : undefined,
    testIds: [...node.testIds],
    commandIds: [...node.commandIds],
    role: "treeitem",
    selected: node.id === selectedCoverageId,
    ariaLabel: `${node.label}, ${statement}, ${branch}`,
  }
}

function cloneCoverageEditorDecoration(decoration: TestCoverageEditorDecorationSnapshot): TestCoverageEditorDecorationSnapshot {
  return {
    ...decoration,
    testIds: [...decoration.testIds],
    commandIds: [...decoration.commandIds],
  }
}

function createCoverageEditorRangeModelShell(file: TestCoverageFileSnapshot): TestCoverageEditorRangeModelShell {
  const totalStatements = Math.max(0, file.statement.total)
  return {
    kind: "coverage-details-range-model-shell",
    stateSource: "TestingService.getCoverageEditorDecorationsProjection()",
    coverageId: file.id,
    uri: file.uri,
    lineRangeHint: {
      startLineNumber: totalStatements > 0 ? 1 : 0,
      endLineNumber: totalStatements,
    },
    detailAccessorCommandId: TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
    minimap: {
      projected: false,
      blockedOwner: "ITextModel.deltaDecorations/MinimapPosition",
    },
    injectedText: {
      projected: false,
      blockedOwner: "InjectedTextOptions",
    },
    overlayToolbar: {
      projected: false,
      blockedOwner: "CoverageToolbarWidget",
    },
    blockedReason: "TestingService can identify the selected coverage file and detail accessor, but real range mapping, minimap decorations, injected text, and overlay toolbar require the VS Code ICodeEditor/TextModel owner.",
    noSecondState: true,
  }
}

function cloneCoverageEditorRangeModelShell(shell: TestCoverageEditorRangeModelShell): TestCoverageEditorRangeModelShell {
  return {
    ...shell,
    lineRangeHint: { ...shell.lineRangeHint },
    minimap: { ...shell.minimap },
    injectedText: { ...shell.injectedText },
    overlayToolbar: { ...shell.overlayToolbar },
  }
}

function compareCoverageNodes(a: TestCoverageTreeNodeSnapshot, b: TestCoverageTreeNodeSnapshot, sortOrder: TestCoverageSortOrder): number {
  if (sortOrder === "coverage") {
    return (b.statementPercent ?? -1) - (a.statementPercent ?? -1) || a.uri.localeCompare(b.uri) || a.id.localeCompare(b.id)
  }
  if (sortOrder === "name") {
    return a.label.localeCompare(b.label) || a.uri.localeCompare(b.uri) || a.id.localeCompare(b.id)
  }
  return a.uri.localeCompare(b.uri) || a.id.localeCompare(b.id)
}

function normalizeCoverageUri(uri: string): string {
  return String(uri || "").split(/[?#]/)[0].toLowerCase()
}

function getBasenameFromUri(uri: string): string {
  const normalized = uri.replace(/\\/g, "/")
  const withoutQuery = normalized.split(/[?#]/)[0]
  const segment = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1)
  return decodeURIComponent(segment || uri)
}

function selectResultPeekEntry(entries: TestResultPeekEntrySnapshot[], payload: TestingOpenResultPeekPayload): TestResultPeekEntrySnapshot | undefined {
  if (payload.entryId) {
    return entries.find((entry) => entry.id === payload.entryId)
  }
  if (payload.runId || payload.testId) {
    return entries.find((entry) =>
      (!payload.runId || entry.runId === payload.runId)
      && (!payload.testId || entry.testId === payload.testId)
    )
  }
  return entries.find((entry) => entry.state === "failed" || entry.state === "errored") || entries[0]
}

function cloneResultPeekEntry(entry: TestResultPeekEntrySnapshot): TestResultPeekEntrySnapshot {
  return {
    ...entry,
    messages: [...entry.messages],
    output: entry.output.map((message) => ({ ...message })),
    commandIds: [...entry.commandIds],
  }
}

function createResultPeekOpenDescriptor(
  projection: TestResultPeekProjection,
  selectedEntry?: TestResultPeekEntrySnapshot,
  reason?: string,
): TestResultPeekOpenDescriptor {
  const clonedEntry = selectedEntry ? cloneResultPeekEntry(selectedEntry) : undefined
  return {
    status: clonedEntry ? "ready" : "notAvailable",
    reason,
    commandId: TESTING_PEEK_COMMAND_IDS.OpenOutputPeek,
    targetUri: clonedEntry?.locationUri || clonedEntry?.evidenceUri,
    selectedEntry: clonedEntry,
    projection: {
      ...projection,
      entries: projection.entries.map(cloneResultPeekEntry),
      adapter: {
        ...projection.adapter,
        vscodeSourcePaths: [...projection.adapter.vscodeSourcePaths],
        blockedOwners: [...projection.adapter.blockedOwners],
      },
    },
    shellAdapter: cloneResultPeekShellAdapter(),
  }
}

function cloneTestingExplorerContractProjection(projection: TestingExplorerContractProjection): TestingExplorerContractProjection {
  return {
    ...projection,
    vscodeSourcePaths: [...projection.vscodeSourcePaths],
    ownerEvidence: {
      ...projection.ownerEvidence,
      vscodeSourcePaths: [...projection.ownerEvidence.vscodeSourcePaths],
      testServiceOwner: {
        ...projection.ownerEvidence.testServiceOwner,
        serviceIds: [...projection.ownerEvidence.testServiceOwner.serviceIds],
        implementedEvidence: [...projection.ownerEvidence.testServiceOwner.implementedEvidence],
        blockedOwners: [...projection.ownerEvidence.testServiceOwner.blockedOwners],
      },
      testControllerOwner: {
        ...projection.ownerEvidence.testControllerOwner,
        controllerIds: [...projection.ownerEvidence.testControllerOwner.controllerIds],
        profileIdsByController: Object.fromEntries(
          Object.entries(projection.ownerEvidence.testControllerOwner.profileIdsByController).map(([controllerId, profileIds]) => [controllerId, [...profileIds]]),
        ),
        itemCountByController: { ...projection.ownerEvidence.testControllerOwner.itemCountByController },
      },
      testExplorerOwner: {
        ...projection.ownerEvidence.testExplorerOwner,
        visibleRowIds: [...projection.ownerEvidence.testExplorerOwner.visibleRowIds],
        blockedOwners: [...projection.ownerEvidence.testExplorerOwner.blockedOwners],
      },
      resultOwner: {
        ...projection.ownerEvidence.resultOwner,
        runningRunIds: [...projection.ownerEvidence.resultOwner.runningRunIds],
        completedRunIds: [...projection.ownerEvidence.resultOwner.completedRunIds],
      },
      runProfileOwner: {
        ...projection.ownerEvidence.runProfileOwner,
        profileIdsByController: Object.fromEntries(
          Object.entries(projection.ownerEvidence.runProfileOwner.profileIdsByController).map(([controllerId, profileIds]) => [controllerId, [...profileIds]]),
        ),
        defaultProfileIdsByControllerAndGroup: cloneProfileIdsByControllerAndGroup(projection.ownerEvidence.runProfileOwner.defaultProfileIdsByControllerAndGroup),
      },
      testItemSource: {
        ...projection.ownerEvidence.testItemSource,
        rootIds: [...projection.ownerEvidence.testItemSource.rootIds],
        sampleEvidenceUris: [...projection.ownerEvidence.testItemSource.sampleEvidenceUris],
      },
      remainingUiOwnerGap: {
        ...projection.ownerEvidence.remainingUiOwnerGap,
        blockedOwners: [...projection.ownerEvidence.remainingUiOwnerGap.blockedOwners],
      },
    },
    controllerOwner: {
      ...projection.controllerOwner,
      controllerIds: [...projection.controllerOwner.controllerIds],
      profileIdsByController: Object.fromEntries(
        Object.entries(projection.controllerOwner.profileIdsByController).map(([controllerId, profileIds]) => [controllerId, [...profileIds]]),
      ),
      itemCountByController: { ...projection.controllerOwner.itemCountByController },
      implementedEvidence: [...projection.controllerOwner.implementedEvidence],
      blockedOwners: [...projection.controllerOwner.blockedOwners],
    },
    rows: projection.rows.map((row) => ({
      ...row,
      prefixPath: [...row.prefixPath],
      parentChain: [...row.parentChain],
      childIds: [...row.childIds],
      commandIds: [...row.commandIds],
    })),
    actionOwner: {
      ...projection.actionOwner,
      vscodeSourcePaths: [...projection.actionOwner.vscodeSourcePaths],
      actions: projection.actionOwner.actions.map((action) => ({
        ...action,
        testIds: [...action.testIds],
      })),
      commandExecution: projection.actionOwner.commandExecution.map((entry) => ({ ...entry })),
      blockedOwners: [...projection.actionOwner.blockedOwners],
    },
    persistedState: {
      ...projection.persistedState,
      expandedIds: [...projection.persistedState.expandedIds],
    },
    viewModelAdapter: {
      ...projection.viewModelAdapter,
      appliedRowIds: [...projection.viewModelAdapter.appliedRowIds],
      implementedEvidence: [...projection.viewModelAdapter.implementedEvidence],
      blockedOwners: [...projection.viewModelAdapter.blockedOwners],
    },
    objectTreeAdapter: {
      ...projection.objectTreeAdapter,
      optimizedViewState: cloneTestingExplorerOptimizedViewState(projection.objectTreeAdapter.optimizedViewState),
      visibleRowIds: [...projection.objectTreeAdapter.visibleRowIds],
      implementedEvidence: [...projection.objectTreeAdapter.implementedEvidence],
      blockedOwners: [...projection.objectTreeAdapter.blockedOwners],
    },
    filterActionAdapter: {
      ...projection.filterActionAdapter,
      vscodeSourcePaths: [...projection.filterActionAdapter.vscodeSourcePaths],
      filterTerms: { ...projection.filterActionAdapter.filterTerms },
      contextKeys: [...projection.filterActionAdapter.contextKeys],
      blockedOwners: [...projection.filterActionAdapter.blockedOwners],
    },
    domOwnerAdapter: {
      ...projection.domOwnerAdapter,
      vscodeSourcePaths: [...projection.domOwnerAdapter.vscodeSourcePaths],
      visibleRowIds: [...projection.domOwnerAdapter.visibleRowIds],
      filterInput: {
        ...projection.domOwnerAdapter.filterInput,
        includeTags: [...projection.domOwnerAdapter.filterInput.includeTags],
        excludeTags: [...projection.domOwnerAdapter.filterInput.excludeTags],
        globList: projection.domOwnerAdapter.filterInput.globList.map((entry) => ({ ...entry })),
        filterTerms: [...projection.domOwnerAdapter.filterInput.filterTerms],
      },
      dataAttributes: { ...projection.domOwnerAdapter.dataAttributes },
      implementedEvidence: [...projection.domOwnerAdapter.implementedEvidence],
      blockedOwners: [...projection.domOwnerAdapter.blockedOwners],
    },
    domOwnerMatrix: cloneOwnerGapMatrix(projection.domOwnerMatrix),
    lifecycle: {
      activeContinuousRunIds: [...projection.lifecycle.activeContinuousRunIds],
      prefixRunningRoots: [...projection.lifecycle.prefixRunningRoots],
      restartOnProfileChange: { ...projection.lifecycle.restartOnProfileChange },
      cancelOrder: {
        ...projection.lifecycle.cancelOrder,
        order: [...projection.lifecycle.cancelOrder.order],
      },
    },
    implementedEvidence: [...projection.implementedEvidence],
    blockedOwners: [...projection.blockedOwners],
    nextAuthorizedFiles: [...projection.nextAuthorizedFiles],
  }
}

function applyTestingExplorerProjection(
  rows: TestItemProjection[],
  viewMode: "tree" | "list",
  sorting: "location" | "status" | "duration",
): TestItemProjection[] {
  const sorted = [...rows].sort((a, b) => compareTestingExplorerRows(a, b, sorting))
  if (viewMode === "list") return sorted
  return sorted.sort((a, b) => a.depth - b.depth || compareTestingExplorerRows(a, b, sorting))
}

function compareTestingExplorerRows(a: TestItemProjection, b: TestItemProjection, sorting: "location" | "status" | "duration"): number {
  if (sorting === "location") {
    return (a.uri || "").localeCompare(b.uri || "") || a.label.localeCompare(b.label) || a.id.localeCompare(b.id)
  }
  if (sorting === "status") {
    return a.label.localeCompare(b.label) || a.id.localeCompare(b.id)
  }
  return a.id.localeCompare(b.id)
}

function buildTestingExplorerOptimizedViewState(
  rows: TestItemProjection[],
  expandedIds: string[],
): TestingExplorerOptimizedViewState {
  const expanded = new Set(expandedIds)
  const root: TestingExplorerOptimizedViewState = { children: {} }
  for (const row of rows) {
    const parts = getTestIdPrefixPath(row.id)
    let current = root
    for (let index = 0; index < parts.length; index++) {
      current.children ??= {}
      const localId = parts[index]
      current.children[localId] ??= {}
      current = current.children[localId]
      if (index === parts.length - 1) {
        current.collapsed = !expanded.has(row.id)
      }
    }
  }
  return root
}

function parseTestingExplorerFilterText(text: string): {
  value: string
  includeTags: string[]
  excludeTags: string[]
  globList: { include: boolean; text: string }[]
  filterTerms: string[]
} {
  const includeTags = new Set<string>()
  const excludeTags = new Set<string>()
  const filterTerms = new Set<string>()
  let globText = ""
  let lastIndex = 0
  const tagPattern = /!?@([^ ,:]+)/g
  const knownTerms = new Set(["@failed", "@executed", "@doc", "@openedFiles", "@hidden"])

  for (const match of text.matchAll(tagPattern)) {
    let nextIndex = (match.index || 0) + match[0].length
    const tag = match[0]
    const isFilterTerm = knownTerms.has(tag)
    if (isFilterTerm) {
      filterTerms.add(tag)
    }

    let isTag = false
    if (text[nextIndex] === ":") {
      isTag = true
      nextIndex++
      let delimiter = text[nextIndex]
      if (delimiter !== "\"" && delimiter !== "'") {
        delimiter = " "
      } else {
        nextIndex++
      }

      let tagId = ""
      while (nextIndex < text.length && text[nextIndex] !== delimiter) {
        if (text[nextIndex] === "\\") {
          tagId += text[nextIndex + 1] || ""
          nextIndex += 2
        } else {
          tagId += text[nextIndex]
          nextIndex++
        }
      }

      const namespaced = `${match[1]}\u0000${tagId}`
      if (match[0].startsWith("!")) {
        excludeTags.add(namespaced)
      } else {
        includeTags.add(namespaced)
      }
      nextIndex++
    }

    if (!isFilterTerm && !isTag) {
      continue
    }

    globText += text.slice(lastIndex, match.index)
    lastIndex = nextIndex
  }

  globText += text.slice(lastIndex).trim()
  const globList = globText
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.startsWith("!")
      ? { include: false, text: value.slice(1).toLowerCase() }
      : { include: true, text: value.toLowerCase() })

  return {
    value: text,
    includeTags: [...includeTags].sort((a, b) => a.localeCompare(b)),
    excludeTags: [...excludeTags].sort((a, b) => a.localeCompare(b)),
    globList,
    filterTerms: [...filterTerms].sort((a, b) => a.localeCompare(b)),
  }
}

function cloneTestingExplorerOptimizedViewState(state: TestingExplorerOptimizedViewState): TestingExplorerOptimizedViewState {
  return {
    collapsed: state.collapsed,
    children: state.children
      ? Object.fromEntries(
        Object.entries(state.children).map(([key, child]) => [key, cloneTestingExplorerOptimizedViewState(child)]),
      )
      : undefined,
  }
}

function buildDefaultProfileIdsByControllerAndGroup(profiles: TestRunProfileSnapshot[]): Record<string, Partial<Record<TestRunProfileGroup, number[]>>> {
  const defaults: Record<string, Partial<Record<TestRunProfileGroup, number[]>>> = {}
  for (const profile of profiles) {
    defaults[profile.controllerId] ||= {}
    if (!profile.isDefault) continue
    const groupDefaults = defaults[profile.controllerId][profile.group] || []
    groupDefaults.push(profile.profileId)
    defaults[profile.controllerId][profile.group] = groupDefaults.sort((a, b) => a - b)
  }
  return defaults
}

function cloneProfileIdsByControllerAndGroup(input: Record<string, Partial<Record<TestRunProfileGroup, number[]>>>): Record<string, Partial<Record<TestRunProfileGroup, number[]>>> {
  return Object.fromEntries(
    Object.entries(input).map(([controllerId, groups]) => [
      controllerId,
      Object.fromEntries(
        Object.entries(groups).map(([group, ids]) => [group, ids ? [...ids] : ids]),
      ) as Partial<Record<TestRunProfileGroup, number[]>>,
    ]),
  )
}

function cloneContractAudit(contract: TestingContractAudit): TestingContractAudit {
  return {
    ...contract,
    vscodeSourcePaths: [...contract.vscodeSourcePaths],
    codekServiceIds: [...contract.codekServiceIds],
    viewContainerIds: [...contract.viewContainerIds],
    viewIds: [...contract.viewIds],
    commandIds: [...contract.commandIds],
    uiBinding: {
      ...contract.uiBinding,
      vscodeVisibleEntryPaths: [...contract.uiBinding.vscodeVisibleEntryPaths],
      visibleActions: contract.uiBinding.visibleActions.map((action) => ({ ...action })),
      blockedUiGaps: [...contract.uiBinding.blockedUiGaps],
    },
    uiCapabilities: {
      treeProvider: cloneUiCapabilitySnapshot(contract.uiCapabilities.treeProvider),
      resultPeek: cloneUiCapabilitySnapshot(contract.uiCapabilities.resultPeek),
      coverageTree: cloneUiCapabilitySnapshot(contract.uiCapabilities.coverageTree),
    },
    serviceOwnerMatrix: contract.serviceOwnerMatrix.map((entry) => ({
      ...entry,
      vscodeSourcePaths: [...entry.vscodeSourcePaths],
      implementedEvidence: [...entry.implementedEvidence],
      blockedOwners: [...entry.blockedOwners],
    })),
    ownerContracts: {
      testExplorerTree: cloneOwnerContractAudit(contract.ownerContracts.testExplorerTree),
      resultPeek: cloneOwnerContractAudit(contract.ownerContracts.resultPeek),
      coverageEditor: cloneOwnerContractAudit(contract.ownerContracts.coverageEditor),
      continuousRun: cloneOwnerContractAudit(contract.ownerContracts.continuousRun),
    },
    extensionHostBridge: {
      ...contract.extensionHostBridge,
      adapterEvidence: {
        rpcMethods: [...contract.extensionHostBridge.adapterEvidence.rpcMethods],
        rendererEventChannels: [...contract.extensionHostBridge.adapterEvidence.rendererEventChannels],
        backChannels: [...contract.extensionHostBridge.adapterEvidence.backChannels],
      },
      rpcMethodMatrix: {
        controllerAndItem: contract.extensionHostBridge.rpcMethodMatrix.controllerAndItem.map((method) => ({ ...method })),
        runProfile: contract.extensionHostBridge.rpcMethodMatrix.runProfile.map((method) => ({ ...method })),
        runLifecycle: contract.extensionHostBridge.rpcMethodMatrix.runLifecycle.map((method) => ({ ...method })),
        resultAndCoverage: contract.extensionHostBridge.rpcMethodMatrix.resultAndCoverage.map((method) => ({ ...method })),
        extHostCallbacks: contract.extensionHostBridge.rpcMethodMatrix.extHostCallbacks.map((method) => ({ ...method })),
      },
      callbacks: { ...contract.extensionHostBridge.callbacks },
      coverageShellAudit: {
        ...contract.extensionHostBridge.coverageShellAudit,
        implementedEvidence: [...contract.extensionHostBridge.coverageShellAudit.implementedEvidence],
        blockedOwners: [...contract.extensionHostBridge.coverageShellAudit.blockedOwners],
      },
    },
    remainingGaps: [...contract.remainingGaps],
    workbenchViews: {
      ...contract.workbenchViews,
      vscodeSourcePaths: [...contract.workbenchViews.vscodeSourcePaths],
      viewShellOwnerFeasibility: {
        ...contract.workbenchViews.viewShellOwnerFeasibility,
        vscodeSourcePaths: [...contract.workbenchViews.viewShellOwnerFeasibility.vscodeSourcePaths],
        canExpressShell: [...contract.workbenchViews.viewShellOwnerFeasibility.canExpressShell],
        canProjectTreeEvidence: [...contract.workbenchViews.viewShellOwnerFeasibility.canProjectTreeEvidence],
        blockedOwners: [...contract.workbenchViews.viewShellOwnerFeasibility.blockedOwners],
      },
      actionOwnerFeasibility: {
        ...contract.workbenchViews.actionOwnerFeasibility,
        vscodeSourcePaths: [...contract.workbenchViews.actionOwnerFeasibility.vscodeSourcePaths],
        canExpressActionEvidence: [...contract.workbenchViews.actionOwnerFeasibility.canExpressActionEvidence],
        canProjectContextKeys: [...contract.workbenchViews.actionOwnerFeasibility.canProjectContextKeys],
        blockedOwners: [...contract.workbenchViews.actionOwnerFeasibility.blockedOwners],
      },
      containers: contract.workbenchViews.containers.map((container) => ({ ...container })),
      views: contract.workbenchViews.views.map((view) => ({ ...view })),
      editorContributions: contract.workbenchViews.editorContributions.map((contribution) => ({ ...contribution })),
    },
  }
}

function cloneUiCapabilitySnapshot(snapshot: TestingUiCapabilitySnapshot): TestingUiCapabilitySnapshot {
  return {
    ...snapshot,
    vscodeSourcePaths: [...snapshot.vscodeSourcePaths],
    commandIds: [...snapshot.commandIds],
    missingOwnership: [...snapshot.missingOwnership],
  }
}

function cloneOwnerContractAudit(contract: TestingOwnerContractAudit): TestingOwnerContractAudit {
  return {
    ...contract,
    vscodeSourcePaths: [...contract.vscodeSourcePaths],
    codekCanProvide: [...contract.codekCanProvide],
    vscodeRequiredOwners: [...contract.vscodeRequiredOwners],
    availableEvidence: contract.availableEvidence?.map((entry) => ({ ...entry })),
    blockedMatrix: contract.blockedMatrix?.map((entry) => ({ ...entry })),
    actionContextMatrix: contract.actionContextMatrix?.map((entry) => ({
      ...entry,
      contextKeys: [...entry.contextKeys],
    })),
  }
}

function compareItems(a?: TestItemSnapshot, b?: TestItemSnapshot): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return (a.sortText || a.label).localeCompare(b.sortText || b.label) || a.id.localeCompare(b.id)
}

function getDepth(items: Map<string, TestItemSnapshot>, item: TestItemSnapshot): number {
  let depth = 0
  let parentId = item.parentId
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = items.get(parentId)
    if (!parent) break
    depth += 1
    parentId = parent.parentId
  }
  return depth
}

function getControllerIdFromTestId(testId?: string): string | undefined {
  if (!testId) return undefined
  return testId.split("\u0000")[0]
}

function getTestIdPrefixPath(testId: string): string[] {
  return String(testId || "").split("\u0000").filter(Boolean)
}

function getParentChainIds(testId: string, items: Map<string, TestItemSnapshot>): string[] {
  const chain: string[] = []
  let parentId = items.get(testId)?.parentId
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    chain.unshift(parentId)
    parentId = items.get(parentId)?.parentId
  }
  return chain
}

function getContinuousCancelOrder(prefixRunningRoots: string[], itemsById: Map<string, TestItemProjection>): string[] {
  const order: string[] = []
  const visit = (id: string) => {
    const item = itemsById.get(id)
    for (const childId of item?.childrenIds || []) visit(childId)
    order.push(id)
  }
  for (const root of prefixRunningRoots) visit(root)
  return [...new Set(order)]
}

function isTestIdOrDescendantOfAny(testId: string, roots: Set<string>): boolean {
  if (roots.has(testId)) return true
  for (const root of roots) {
    if (testId.startsWith(`${root}\u0000`)) return true
  }
  return false
}

function isParentContinuous(item: TestItemSnapshot, items: Map<string, TestItemSnapshot>, roots: Set<string>): boolean {
  let parentId = item.parentId
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    if (roots.has(parentId)) return true
    parentId = items.get(parentId)?.parentId
  }
  return false
}

function resultIdForRunItem(runId: string, testId: string): string {
  return `${runId}:${testId}`
}

function getDefaultRunLabel(group: TestRunProfileGroup): string {
  switch (group) {
    case "debug":
      return "Debug tests"
    case "coverage":
      return "Run tests with coverage"
    default:
      return "Run tests"
  }
}

function getCommandIdForGroup(group: TestRunProfileGroup): TestRunActionDescriptor["commandId"] {
  switch (group) {
    case "debug":
      return TESTING_RUN_COMMAND_IDS.Debug
    case "coverage":
      return TESTING_RUN_COMMAND_IDS.Coverage
    default:
      return TESTING_RUN_COMMAND_IDS.Run
  }
}

function getContinuousRunId(controllerId: string, profileId: number, testIds: string[]): string {
  const scope = testIds.length > 0 ? testIds.join("\u0000") : controllerId
  return `continuous:${controllerId}:${profileId}:${encodeURIComponent(scope)}`
}

function getActionLabel(group: TestRunProfileGroup, profile?: TestRunProfileSnapshot): string {
  if (profile) return profile.label
  return getDefaultRunLabel(group)
}

export function registerTestingCallbackCommands(service: ITestingService = globalTestingService): { dispose(): void } {
  const disposables = [
    registerCommand({
      id: TESTING_RUN_COMMAND_IDS.Run,
      title: "运行测试",
      category: "测试",
      source: "vscode",
      handler: (payload?: TestingRunCommandPayload | string) => {
        executeTestingRunCommand(service, payload, "run")
      },
    }),
    registerCommand({
      id: TESTING_RUN_COMMAND_IDS.Debug,
      title: "调试测试",
      category: "测试",
      source: "vscode",
      handler: (payload?: TestingRunCommandPayload | string) => {
        executeTestingRunCommand(service, payload, "debug")
      },
    }),
    registerCommand({
      id: TESTING_RUN_COMMAND_IDS.Coverage,
      title: "运行测试并收集覆盖率",
      category: "测试",
      source: "vscode",
      handler: (payload?: TestingRunCommandPayload | string) => {
        executeTestingRunCommand(service, payload, "coverage")
      },
    }),
    registerCommand({
      id: TESTING_RUN_COMMAND_IDS.StartContinuousRun,
      title: "开始持续运行测试",
      category: "测试",
      source: "vscode",
      when: "testing.supportsContinuousRun && testing.isContinuousModeOn == false",
      handler: (payload?: TestingContinuousRunRequest | string) => {
        const input = typeof payload === "string" ? { testId: payload } : payload || {}
        service.startContinuousRun(input)
      },
    }),
    registerCommand({
      id: TESTING_RUN_COMMAND_IDS.StopContinuousRun,
      title: "停止持续运行测试",
      category: "测试",
      source: "vscode",
      when: "testing.supportsContinuousRun && testing.isContinuousModeOn == true",
      handler: (payload?: Pick<TestingContinuousRunRequest, "controllerId" | "profileId" | "testId"> | string) => {
        const input = typeof payload === "string" ? { testId: payload } : payload || {}
        service.stopContinuousRun(input)
      },
    }),
    registerCommand({
      id: TESTING_RUN_COMMAND_IDS.ToggleContinuousRunForTest,
      title: "为此测试开启持续运行",
      category: "测试",
      source: "vscode",
      when: "testing.supportsContinuousRun && (testing.isContinuousModeOn == true || testing.isParentRunningContinuously == false)",
      handler: (payload?: TestingContinuousRunRequest | string) => {
        const input = typeof payload === "string" ? { testId: payload } : payload
        if (input?.testId) service.toggleContinuousRunForTest(input.testId, input)
      },
    }),
    registerCommand({
      id: TESTING_PEEK_COMMAND_IDS.OpenOutputPeek,
      title: "查看测试输出",
      category: "测试",
      source: "vscode",
      when: "testingHasResults",
      handler: (payload?: TestingOpenResultPeekPayload | string, testId?: string) => {
        const input = typeof payload === "string" ? { runId: payload, testId } : payload
        service.openResultPeek(input)
      },
    }),
    registerCommand({
      id: TESTING_CALLBACK_COMMAND_IDS.CancelRun,
      title: "取消测试运行",
      category: "测试",
      source: "vscode",
      handler: (payload?: TestingCallbackCancelRunPayload | string, taskId?: string) => {
        const input = typeof payload === "string" ? { runId: payload, taskId } : payload || {}
        service.cancelRun(input)
      },
    }),
    registerCommand({
      id: TESTING_CALLBACK_COMMAND_IDS.ConfigureProfile,
      title: "配置测试配置",
      category: "测试",
      source: "vscode",
      handler: (payload?: TestingCallbackConfigureProfilePayload | string, profileId?: number) => {
        const input = typeof payload === "string" ? { controllerId: payload, profileId: Number(profileId) } : payload
        if (input) service.configureProfile(input)
      },
    }),
    registerCommand({
      id: TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
      title: "加载测试覆盖率详情",
      category: "测试",
      source: "vscode",
      handler: async (payload?: TestingCallbackCoverageDetailsPayload | string, testId?: string) => {
        const input = typeof payload === "string" ? { coverageId: payload, testId } : payload
        if (input) await service.requestCoverageDetails(input)
      },
    }),
    registerCommand({
      id: TESTING_COVERAGE_COMMAND_IDS.OpenCoverage,
      title: "打开测试覆盖率",
      category: "测试",
      source: "vscode",
      when: "testingCoverageOpen",
      handler: (coverageId?: string) => {
        service.openCoverage(coverageId)
      },
    }),
    registerCommand({
      id: TESTING_COVERAGE_COMMAND_IDS.CloseCoverage,
      title: "关闭测试覆盖率",
      category: "测试",
      source: "vscode",
      when: "testingCoverageOpen",
      handler: () => {
        service.closeCoverage()
      },
    }),
    registerCommand({
      id: TESTING_COVERAGE_COMMAND_IDS.ToggleInlineCoverage,
      title: "切换行内覆盖率",
      category: "测试",
      source: "vscode",
      when: "testingCoverageOpen",
      handler: () => {
        service.setCoverageInlineVisible(!service.getCoverageViewProjection().showInline)
      },
    }),
    registerCommand({
      id: TESTING_COVERAGE_COMMAND_IDS.FilterToTest,
      title: "按测试筛选覆盖率",
      category: "测试",
      source: "vscode",
      when: "testingCoverageOpen",
      handler: (testId?: string) => {
        service.setCoverageFilterToTest(testId)
      },
    }),
    registerCommand({
      id: TESTING_COVERAGE_COMMAND_IDS.GoToNextMissedLine,
      title: "转到下一处未覆盖行",
      category: "测试",
      source: "vscode",
      when: "testingCoverageOpen",
      handler: () => {
        service.getCoverageEditorDecorationsProjection()
      },
    }),
    registerCommand({
      id: TESTING_COVERAGE_COMMAND_IDS.GoToPreviousMissedLine,
      title: "转到上一处未覆盖行",
      category: "测试",
      source: "vscode",
      when: "testingCoverageOpen",
      handler: () => {
        service.getCoverageEditorDecorationsProjection()
      },
    }),
    registerCommand({
      id: TESTING_COVERAGE_COMMAND_IDS.ViewChangeSorting,
      title: "更改测试覆盖率排序",
      category: "测试",
      source: "vscode",
      when: "testingCoverageOpen",
      handler: (sortOrder?: TestCoverageSortOrder) => {
        if (sortOrder) service.setCoverageSortOrder(sortOrder)
      },
    }),
    registerCommand({
      id: TESTING_COVERAGE_COMMAND_IDS.ViewCollapseAll,
      title: "折叠全部覆盖率",
      category: "测试",
      source: "vscode",
      when: "testingCoverageOpen",
      handler: () => {
        service.getCoverageViewProjection()
      },
    }),
  ]
  return {
    dispose() {
      for (const disposable of disposables.splice(0).reverse()) disposable.dispose()
    },
  }
}

function executeTestingRunCommand(service: ITestingService, payload: TestingRunCommandPayload | string | undefined, fallbackGroup: TestRunProfileGroup): void {
  const input = normalizeTestingRunCommandPayload(payload, fallbackGroup)
  const action = service.createRunAction(input)
  if (!action.enabled || !action.controllerId || action.profileId === undefined) return
  service.startRun({
    id: getGeneratedRunId(action),
    controllerId: action.controllerId,
    profileId: action.profileId,
    group: action.group,
    testIds: action.testIds,
  })
}

function normalizeTestingRunCommandPayload(payload: TestingRunCommandPayload | string | undefined, fallbackGroup: TestRunProfileGroup): {
  group: TestRunProfileGroup
  testIds: string[]
  controllerId?: string
  profileId?: number
} {
  const input = typeof payload === "string" ? { testId: payload } : payload || {}
  const testIds = input.testIds?.length ? input.testIds : input.testId ? [input.testId] : []
  return {
    group: input.group || fallbackGroup,
    testIds,
    controllerId: input.controllerId,
    profileId: input.profileId,
  }
}

function getGeneratedRunId(action: TestRunActionDescriptor): string {
  const scope = action.testIds.length ? action.testIds.join("\u0000") : action.controllerId || "workspace"
  return `run:${action.group}:${action.controllerId || "unknown"}:${action.profileId ?? "default"}:${encodeURIComponent(scope)}`
}

export function registerTestingWorkbenchViews(): IDisposable {
  const disposables = [
    registerViewContainer({
      id: TESTING_VIEW_IDS.Container,
      name: "测试",
      location: "activityBar",
      icon: "testing",
      order: 85,
      source: "vscode",
      emptyStateTitle: "测试",
      emptyStateDescription: "发现测试后会在这里显示测试树和运行结果。",
    }),
    registerView({
      id: TESTING_VIEW_IDS.Default,
      name: "测试",
      containerId: TESTING_VIEW_IDS.Container,
      location: "activityBar",
      source: "vscode",
      order: 999,
      when: "testingDefaultPlaceholderVisible && testingWorkbenchAdapterDisabled",
      userDescription: "默认测试占位视图会在发现真实测试后自动隐藏。",
    }),
    registerView({
      id: TESTING_VIEW_IDS.Explorer,
      name: "测试资源管理器",
      containerId: TESTING_VIEW_IDS.Container,
      location: "activityBar",
      source: "vscode",
      order: -999,
      when: "testingEnabled && testingProviderCount != 0",
      userDescription: "显示测试控制器、测试项、运行记录和覆盖率证据。",
    }),
    registerView({
      id: TESTING_VIEW_IDS.Coverage,
      name: "测试覆盖率",
      containerId: TESTING_VIEW_IDS.Container,
      location: "activityBar",
      source: "vscode",
      order: -998,
      when: "testingEnabled && testingCoverageOpen",
      userDescription: "显示测试覆盖率树、文件覆盖率和打开状态。",
    }),
    registerViewContainer({
      id: TESTING_VIEW_IDS.ResultsContainer,
      name: "测试结果",
      location: "panel",
      icon: "testing",
      order: 30,
      source: "vscode",
      emptyStateTitle: "测试结果",
      emptyStateDescription: "运行测试后会在这里显示结果历史和输出。",
    }),
    registerView({
      id: TESTING_VIEW_IDS.Results,
      name: "测试结果",
      containerId: TESTING_VIEW_IDS.ResultsContainer,
      location: "panel",
      source: "vscode",
      order: 0,
      when: "testingEnabled && testingHasResults",
      userDescription: "显示测试结果历史、失败消息和结果预览。",
    }),
  ]
  return {
    dispose() {
      for (const disposable of disposables.splice(0).reverse()) disposable.dispose()
    },
  }
}
