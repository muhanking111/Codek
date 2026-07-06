import type { AgentEvidenceWorkbenchReport, AgentEvidenceWorkbenchStage, AgentEvidenceWorkbenchSummary } from "../agent/orchestratorClient"
import { Action2, MenuId, MenuRegistry, registerAction2 } from "../vscode-adapter/platform/actions/common/menuRegistry"
import type { Disposable } from "../vscode-adapter/platform/commands/common/commandsRegistry"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import { registerView, registerViewContainer } from "./viewRegistry"

// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\scm\browser\scmViewPane.ts
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\testing\common\testResult.ts
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\timeline\common\timeline.ts
// - D:\SourceMirror\vscode\src\vs\workbench\services\progress\browser\progressService.ts
// - D:\SourceMirror\vscode\src\vs\platform\notification\common\notification.ts
//
// Codek keeps release evidence as the only source of truth. This file only
// derives VS Code-style workbench surface models and contribution metadata.

export const AGENT_EVIDENCE_WORKBENCH_VIEW_IDS = {
  Container: "codek.view.agentEvidence",
  Timeline: "codek.agentEvidence.timeline",
  Progress: "codek.agentEvidence.progress",
  Notifications: "codek.agentEvidence.notifications",
  Scm: "codek.agentEvidence.scm",
  Testing: "codek.agentEvidence.testing",
} as const

export const AGENT_EVIDENCE_COMMAND_IDS = {
  OpenTimeline: "agent.evidence.openTimeline",
  OpenScm: "agent.evidence.openScm",
  OpenTesting: "agent.evidence.openTesting",
  OpenProgress: "agent.evidence.openProgress",
  OpenNotifications: "agent.evidence.openNotifications",
  OpenResource: "agent.evidence.openResource",
  DiffResource: "agent.evidence.diffResource",
  StageResource: "agent.evidence.stageResource",
  DiscardResource: "agent.evidence.discardResource",
  AttachResource: "agent.evidence.attachResource",
  CancelProgress: "agent.evidence.cancelProgress",
  DismissNotification: "agent.evidence.dismissNotification",
  ReviewTests: "agent.evidence.reviewTests",
  ReviewRollback: "agent.evidence.reviewRollback",
  ImportManualUiEvidence: "agent.evidence.importManualUiEvidence",
  OpenDetail: "agent.evidence.openDetail",
  ExportJson: "agent.evidence.exportJson",
  ExportMarkdown: "agent.evidence.exportMarkdown",
} as const

export type AgentEvidenceSurfaceKind = "timeline" | "scm" | "testing" | "progress" | "notifications"
export type AgentEvidenceSeverity = "info" | "warning" | "error"
export type AgentEvidenceTestState = "passed" | "failed" | "blocked" | "running" | "skipped" | "unknown"
export type AgentEvidencePhaseStatus = "active" | "completed" | "systemError" | "blocked" | "needs-validation" | "validated-pass" | "validated-fail" | "superseded"

export const AGENT_EVIDENCE_PHASE_STATUSES: AgentEvidencePhaseStatus[] = [
  "active",
  "completed",
  "systemError",
  "blocked",
  "needs-validation",
  "validated-pass",
  "validated-fail",
  "superseded",
]

export interface AgentEvidencePhaseLifecycleItem {
  id: string
  stage: string
  phaseName: string
  threadId: string
  status: AgentEvidencePhaseStatus
  validation: {
    status: string
    result: string
    command: string
    detail: string
    evidenceRefs: string[]
    checkedAt: number | null
  }
  failureRecovery: {
    status: AgentEvidencePhaseStatus
    action: string
    detail: string
    retryable: boolean
    recoveredAt: number | null
  }
  evidenceRefs: string[]
  updatedAt: number
}

export interface AgentEvidenceFailureCause {
  id: string
  severity: AgentEvidenceSeverity
  title: string
  detail: string
  source: string
  stage: string
}

export interface AgentEvidenceNextAction {
  id: string
  label: string
  surface: AgentEvidenceSurfaceKind
  stage: string
  priority: "high" | "medium" | "normal" | string
  commandId: string
}

export interface AgentEvidenceArtifact {
  id: string
  kind: string
  label: string
  path: string
  source: string
}

export interface AgentEvidenceCommandEvidence {
  command: string
  source: string
  status: string
  exitCode: number | null
  timedOut?: boolean
  artifactIds: string[]
  outputProjectionIds: string[]
  problemProjectionIds: string[]
  taskRunIds: string[]
}

export interface AgentEvidenceRunStateSchema {
  states: AgentEvidenceRunState[]
  transitions: Record<AgentEvidenceRunState, AgentEvidenceRunState[]>
}

export type AgentEvidenceRunState = "planned" | "assigned" | "running" | "review-ready" | "verified" | "blocked" | "accepted" | "rolled-back"

const AGENT_EVIDENCE_RUN_STATES: AgentEvidenceRunState[] = [
  "planned",
  "assigned",
  "running",
  "review-ready",
  "verified",
  "blocked",
  "accepted",
  "rolled-back",
]

export interface AgentEvidenceRunEvidence {
  id: string
  state: AgentEvidenceRunState
  stateLabel: string
  plannedAt: number | null
  assignedAt: number | null
  startedAt: number | null
  updatedAt: number | null
  completedAt: number | null
  plan: {
    summary: string
    goal: string
    steps: Array<{ id: string; title: string; status: string }>
    contextRefs: string[]
  }
  phases: Array<{
    id: string
    title: string
    status: string
    ready: boolean
    evidenceRefs: string[]
    nextAction: string
  }>
  changedFiles: string[]
  diffSummary: {
    filesChanged: number
    files: string[]
    summary: string
    source: string
  }
  validationCommands: Array<{
    command: string
    status: string
    exitCode: number | null
    source: string
    timedOut: boolean
  }>
  failureReasons: Array<{
    id: string
    stage: string
    severity: string
    detail: string
  }>
  rollbackRecommendation: {
    available: boolean
    action: string
    detail: string
    driftBlocked: boolean
  }
  costSummary: {
    available: boolean
    totalRequests: number
    inputTokens: number
    outputTokens: number
    totalTokens: number
    estimatedCostUsd: number
    currency: string
    estimated: boolean
    placeholder: boolean
  }
}

export interface AgentEvidenceProjectionIds {
  taskRunIds: string[]
  outputProjectionIds: string[]
  problemProjectionIds: string[]
  debugProjectionIds: string[]
  failureDiagnosisIds: string[]
  approvalBoundaryIds: string[]
}

export interface AgentEvidenceTaskRunProjection {
  id: string
  stage: string
  name: string
  status: string
  command: string
  exitCode: number | null
  durationMs: number | null
  outputProjectionIds: string[]
  problemProjectionIds: string[]
  artifactIds: string[]
  rerunCommandId: string
}

export interface AgentEvidenceOutputProjection {
  id: string
  stage: string
  channelName: string
  source: "outputLogTelemetryService" | string
  status: string
  entryCount: number
  warnCount: number
  errorCount: number
  preview: string
  artifactIds: string[]
  commandIds: string[]
}

export interface AgentEvidenceProblemProjection {
  id: string
  stage: string
  source: "problemsDiagnosticsService(globalMarkerService)" | string
  status: string
  total: number
  errorCount: number
  warningCount: number
  files: string[]
  sourceNames: string[]
  outputProjectionIds: string[]
  taskRunIds: string[]
}

export interface AgentEvidenceDebugProjection {
  id: string
  stage: string
  source: "debugState/debugRuntime" | string
  status: string
  sessionId: string
  activeConfigName: string
  breakpointCount: number
  consoleEntryCount: number
  outputProjectionIds: string[]
}

export interface AgentEvidenceApprovalBoundaryProjection {
  id: string
  stage: string
  status: string
  risk: string
  reason: string
  commandIds: string[]
  protected: boolean
}

export interface AgentEvidenceFailureDiagnosisProjection {
  id: string
  stage: string
  status: string
  title: string
  detail: string
  failureCauseIds: string[]
  nextActionIds: string[]
  taskRunIds: string[]
  outputProjectionIds: string[]
  problemProjectionIds: string[]
  debugProjectionIds: string[]
  approvalBoundaryIds: string[]
  workspaceChangeRefs: string[]
  rerunCommandIds: string[]
}

export interface AgentEvidenceExportSnapshotProjection {
  id: string
  path: string
  markdownPath: string
  redacted: boolean
  includes: string[]
}

export interface AgentEvidenceProjectionContract {
  taskRuns: AgentEvidenceTaskRunProjection[]
  outputs: AgentEvidenceOutputProjection[]
  problems: AgentEvidenceProblemProjection[]
  debug: AgentEvidenceDebugProjection[]
  approvalBoundaries: AgentEvidenceApprovalBoundaryProjection[]
  failureDiagnosis: AgentEvidenceFailureDiagnosisProjection[]
  exportSnapshot: AgentEvidenceExportSnapshotProjection
}

export interface AgentEvidenceReportContract {
  schemaVersion: 1
  source: "releaseEvidence"
  timestamp: number
  workspace: {
    root: string
    protected: boolean
    isolation: string
  }
  correlationId: string
  commands: AgentEvidenceCommandEvidence[]
  runStateSchema: AgentEvidenceRunStateSchema
  runs: AgentEvidenceRunEvidence[]
  artifacts: AgentEvidenceArtifact[]
  failureCauses: AgentEvidenceFailureCause[]
  nextActions: AgentEvidenceNextAction[]
  roleProfiles: {
    available: boolean
    ready: boolean
    status: string
    statusLabel: string
    requiredTrialCount: number
    trialCount: number
    completeTrials: number
    runtimeIntegrationRecommended: boolean
    recommendation: string
    decisionReason: string
    runtimeContract: {
      attachToExistingOrchestratorRun: boolean
      attachToAssignment: boolean
      attachToEventArtifactEvidence: boolean
      noSecondStateSource: boolean
    }
    trials: Array<{
      id: string
      taskId: string
      runId: string
      assignmentId: string
      role: string
      profileId: string
      profileSource: string
      selectionReason: string
      permissionScope: {
        readPaths: string[]
        writePaths: string[]
        allowedTools: string[]
        commandAllowlist: string[]
        network: boolean
        install: boolean
        externalTool: boolean
        destructive: boolean
      }
      validationAdvice: string[]
      benefit: string
      noise: string
      runtimeFit: string
      worthRuntimeIntegration: boolean
      evidenceRefs: string[]
    }>
  }
  projections: AgentEvidenceProjectionContract
  progress: Array<{
    id: string
    title: string
    message: string
    stage: string
    status: string
    correlationId: string
    total: number
    worked: number
    location: "window" | "notification"
    cancellable: boolean
  }>
  notifications: Array<{
    id: string
    severity: AgentEvidenceSeverity
    message: string
    source: string
    correlationId: string
    lifecycle: {
      state: "active" | "dismissed" | "updated" | string
      sticky: boolean
      updatedAt: number
      dismissible: boolean
    }
    actions: Array<{ id: string; label: string; surface: AgentEvidenceSurfaceKind }>
    focusTarget?: AgentEvidenceSurfaceKind
  }>
  phaseStatusSchema: {
    stageIds: string[]
    statuses: AgentEvidencePhaseStatus[]
  }
  phaseLifecycle: AgentEvidencePhaseLifecycleItem[]
}

export interface AgentEvidenceTimelineItem {
  handle: string
  source: "agentEvidence"
  label: string
  description: string
  timestamp: number
  stage: string
  status: string
  contextValue: string
  commandId: string
  evidenceRefs: string[]
  nextAction: string
  correlationId: string
  failureCauseIds: string[]
  nextActionIds: string[]
  projectionIds: AgentEvidenceProjectionIds
  threadId: string
  validationResult: string
  failureRecoveryStatus: string
  command: {
    id: string
    title: string
    arguments: Array<{ key: string; value: string }>
  }
  resource: {
    uri: string
    range: string
    source: string
  } | null
  link: {
    href: string
    label: string
  } | null
}

export interface AgentEvidenceScmResource {
  uri: string
  resourceUri: string
  status: "modified"
  contextValue: string
  openCommandId: string
  diffCommandId: string
  stageCommandId: string
  discardCommandId: string
  attachCommandId: string
  rollbackRiskLabel: string
  readonlyEvidence: true
  gitIndexMutation: false
  ownerEvidence: AgentEvidenceScmOwnerEvidence
  decorations: {
    tooltip: string
    strikeThrough: boolean
  }
}

export interface AgentEvidenceScmOwnerEvidence {
  kind: "provider" | "resourceGroup" | "resource" | "command"
  owner: "agentEvidenceWorkbenchService" | "agentEvidenceScmService"
  providerId: "agentEvidence"
  groupId?: string
  resourceUri?: string
  commandId?: string
  codekStateSource: "IAgentEvidenceWorkbenchService.getSurface().views.scm"
  vscodeSourcePaths: string[]
  readonlyEvidence: true
  gitIndexMutation: false
  connected: boolean
  remainingUiOwnerGap: string[]
}

export interface AgentEvidenceScmView {
  providerLabel: string
  providerId: "agentEvidence"
  ownerEvidence: AgentEvidenceScmOwnerEvidence
  summary: string
  resourceGroups: Array<{
    id: "agentEvidenceChanges"
    label: string
    ownerEvidence: AgentEvidenceScmOwnerEvidence
    resources: AgentEvidenceScmResource[]
  }>
  rollbackRisk: {
    rollbackAvailable: boolean
    mainWorkspaceProtected: boolean
    pendingBatchBlocked: boolean
    pendingHunkBlocked: boolean
    reviewDisplayBlocked: boolean
  }
  failureCauses: AgentEvidenceFailureCause[]
  nextActions: AgentEvidenceNextAction[]
}

export interface AgentEvidenceTestingView {
  runSummary: {
    total: number
    passed: number
    failed: number
    blocked: number
    running: number
    skipped: number
    problemDiagnostics: number
    qualityGateFailures: number
    state: AgentEvidenceTestState
  }
  items: Array<{
    id: string
    label: string
    state: AgentEvidenceTestState
    detail: string
    evidenceRefs: string[]
    commandIds: string[]
    artifactIds: string[]
    failureCauseIds: string[]
    nextActionIds: string[]
    projectionIds: AgentEvidenceProjectionIds
    rerunCommandId: string
    failureDetail: string
    resourceLinks: Array<{ uri: string; label: string; source: string }>
  }>
}

export interface AgentEvidenceProgressItem {
  id: string
  stage: string
  title: string
  message: string
  total: number
  worked: number
  infinite: boolean
  location: "window" | "notification"
  correlationId: string
  lifecycle: {
    state: "active" | "dismissed" | "updated" | string
    cancellable: boolean
  }
  aggregateStatus: string
  ariaLabel: string
  cancelCommandId: string
  failureCauseIds: string[]
  nextActionIds: string[]
  threadId: string
  validationResult: string
  failureRecoveryStatus: string
}

export interface AgentEvidenceNotificationItem {
  id: string
  severity: AgentEvidenceSeverity
  message: string
  source: string
  sticky: boolean
  correlationId: string
  lifecycle: {
    state: "active" | "dismissed" | "updated" | string
    sticky: boolean
    updatedAt: number
    dismissible: boolean
  }
  dedupeKey: string
  dismissCommandId: string
  focusTarget: AgentEvidenceSurfaceKind
  ariaLabel: string
  actions: Array<{ id: string; label: string; surface: AgentEvidenceSurfaceKind }>
  threadId: string
  validationResult: string
  failureRecoveryStatus: string
}

export interface AgentEvidenceServiceCommand {
  commandId: string
  title: string
  arguments: string[]
  enabled: boolean
}

export interface AgentEvidenceServiceOperation {
  surface: AgentEvidenceSurfaceKind
  commandId: string
  targetId: string
  handledBy: "agentEvidenceWorkbenchService"
  mutatesState: false
  readonlyEvidence: true
  gitIndexMutation: false
  ownerEvidence?: AgentEvidenceScmOwnerEvidence
}

export interface AgentEvidenceScmResourceActions {
  resourceUri: string
  groupId: string
  providerId: string
  readonlyEvidence: true
  gitIndexMutation: false
  open: AgentEvidenceServiceCommand
  diff: AgentEvidenceServiceCommand
  stage: AgentEvidenceServiceCommand
  discard: AgentEvidenceServiceCommand
  attach: AgentEvidenceServiceCommand
  ownerEvidence: {
    provider: AgentEvidenceScmOwnerEvidence
    resourceGroup: AgentEvidenceScmOwnerEvidence
    resource: AgentEvidenceScmOwnerEvidence
    actions: {
      open: AgentEvidenceScmOwnerEvidence
      diff: AgentEvidenceScmOwnerEvidence
      stage: AgentEvidenceScmOwnerEvidence
      discard: AgentEvidenceScmOwnerEvidence
      attach: AgentEvidenceScmOwnerEvidence
    }
  }
}

export interface AgentEvidenceScmRepository {
  id: "agentEvidence"
  providerLabel: string
  providerId: string
  input: {
    value: string
    placeholder: string
    enabled: false
  }
  resourceGroups: AgentEvidenceScmView["resourceGroups"]
  actionButton: AgentEvidenceServiceCommand
  readonlyEvidence: true
  gitIndexMutation: false
  ownerEvidence: AgentEvidenceScmOwnerEvidence
}

export interface AgentEvidenceProgressAggregate {
  total: number
  active: number
  updated: number
  dismissed: number
  cancellable: number
  failed: number
  blocked: number
  commandId: string
  readonlyEvidence: true
}

export interface AgentEvidenceWorkbenchListItem {
  id: string
  surface: AgentEvidenceSurfaceKind
  stage: string
  label: string
  description: string
  status: string
  severity: AgentEvidenceSeverity
  source: string
  commandId: string
  resourceUri: string
  artifactIds: string[]
  failureCauseIds: string[]
  nextActionIds: string[]
  threadId: string
  validationResult: string
  failureRecoveryStatus: string
  correlationId: string
  detail: string
  searchText: string
}

export interface AgentEvidenceWorkbenchFilter {
  surface?: AgentEvidenceSurfaceKind
  status?: string
  severity?: AgentEvidenceSeverity
  query?: string
}

export interface AgentEvidenceSurfaceBridgeAuditEntry {
  surface: AgentEvidenceSurfaceKind
  vscodeSourcePaths: string[]
  codekStateSource: string
  bridgeLevel: "adapter"
  bridgeStatus: "service-facade" | "view-contribution" | "ui-projection"
  serviceIds: string[]
  viewContainerIds: string[]
  viewIds: string[]
  commandIds: string[]
  menuIds: string[]
  uiSmokeSelectors: string[]
  smokeMetricKeys: string[]
  remainingGaps: string[]
}

export interface AgentEvidenceWorkbenchExportDescriptor {
  jsonCommandId: string
  markdownCommandId: string
  artifactPath: string
  markdownPath: string
  correlationId: string
  evidenceCount: number
  snapshotId: string
  redacted: boolean
  includes: string[]
}

export interface AgentEvidenceWorkbenchDetail {
  selectedId: string
  item: AgentEvidenceWorkbenchListItem | null
  editor: {
    id: string
    title: string
    resourceUri: string
    readonly: true
    languageId: "markdown"
    commandId: string
  }
  export: AgentEvidenceWorkbenchExportDescriptor
}

export interface AgentEvidenceWorkbenchContributionSummary {
  serviceId: string
  vscodeServiceIds: string[]
  stateSource: "agentEvidenceWorkbenchService"
  viewContainerIds: string[]
  viewIds: string[]
  commandIds: string[]
  actionIds: string[]
  menuIds: string[]
  surfaces: AgentEvidenceSurfaceKind[]
  constraints: {
    releaseEvidenceSingleSource: true
    action2MenuDriven: true
    scmStatusReadOnly: true
    testingRunEvidenceReadOnly: true
    progressNotificationLifecycleReadOnly: true
    noSecondEvidenceState: true
  }
}

export interface AgentEvidenceWorkbenchList {
  items: AgentEvidenceWorkbenchListItem[]
  filters: {
    surfaces: AgentEvidenceSurfaceKind[]
    statuses: string[]
    severities: AgentEvidenceSeverity[]
  }
  counts: Record<AgentEvidenceSurfaceKind | "total" | "errors" | "warnings", number>
  filtered: {
    all: AgentEvidenceWorkbenchListItem[]
    bySurface: Record<AgentEvidenceSurfaceKind, AgentEvidenceWorkbenchListItem[]>
    byStatus: Record<string, AgentEvidenceWorkbenchListItem[]>
    bySeverity: Record<AgentEvidenceSeverity, AgentEvidenceWorkbenchListItem[]>
    blocked: AgentEvidenceWorkbenchListItem[]
    errors: AgentEvidenceWorkbenchListItem[]
    warnings: AgentEvidenceWorkbenchListItem[]
    query: Record<string, AgentEvidenceWorkbenchListItem[]>
  }
}

export interface AgentEvidenceWorkbenchSurface {
  schemaVersion: 1
  source: "releaseEvidence"
  status: string
  ready: boolean
  generatedAt: number
  summary: string
  report: AgentEvidenceReportContract
  views: {
    timeline: { source: string; items: AgentEvidenceTimelineItem[] }
    scm: AgentEvidenceScmView
    testing: AgentEvidenceTestingView
    progress: { items: AgentEvidenceProgressItem[] }
    notifications: { items: AgentEvidenceNotificationItem[] }
  }
  list: AgentEvidenceWorkbenchList
  detail: AgentEvidenceWorkbenchDetail
  export: AgentEvidenceWorkbenchExportDescriptor
  contribution: AgentEvidenceWorkbenchContributionSummary
  actions: Array<{ id: string; label: string; surface: AgentEvidenceSurfaceKind; enabled: boolean; detail: string }>
}

export interface RegisterAgentEvidenceWorkbenchOptions {
  openSurface?: (surface: AgentEvidenceSurfaceKind) => void | Promise<void>
}

export interface IAgentEvidenceWorkbenchService {
  readonly _serviceBrand: undefined
  getSummary(): AgentEvidenceWorkbenchSummary | null
  getSurface(): AgentEvidenceWorkbenchSurface
  setSummary(summary: AgentEvidenceWorkbenchSummary | null | undefined, options?: { createdAt?: number }): AgentEvidenceWorkbenchSurface
  refresh(summary: AgentEvidenceWorkbenchSummary | null | undefined, options?: { createdAt?: number }): AgentEvidenceWorkbenchSurface
  openSurface(surface: AgentEvidenceSurfaceKind): AgentEvidenceWorkbenchSurface
  getEvidenceItems(filter?: AgentEvidenceWorkbenchFilter): AgentEvidenceWorkbenchListItem[]
  getEvidenceDetail(id?: string): AgentEvidenceWorkbenchDetail
  getExportDescriptor(): AgentEvidenceWorkbenchExportDescriptor
  getContributionSummary(): AgentEvidenceWorkbenchContributionSummary
}

export const IAgentEvidenceWorkbenchService = createDecorator<IAgentEvidenceWorkbenchService>("agentEvidenceWorkbenchService")

export interface IAgentEvidenceTimelineService {
  readonly _serviceBrand: undefined
  getSurface(): AgentEvidenceWorkbenchSurface
  getTimelineView(): AgentEvidenceWorkbenchSurface["views"]["timeline"]
  getTimelineItems(): AgentEvidenceTimelineItem[]
  getTimelineItem(handle: string): AgentEvidenceTimelineItem | null
  getTimelineItemCommand(handle: string): AgentEvidenceServiceCommand | null
  getTimelineItemResource(handle: string): AgentEvidenceTimelineItem["resource"] | null
}

export interface IAgentEvidenceScmService {
  readonly _serviceBrand: undefined
  getSurface(): AgentEvidenceWorkbenchSurface
  getScmView(): AgentEvidenceScmView
  getScmRepositories(): AgentEvidenceScmRepository[]
  getScmResourceGroups(): AgentEvidenceScmView["resourceGroups"]
  getScmResources(): AgentEvidenceScmResource[]
  getScmResourceActions(resourceUri: string): AgentEvidenceScmResourceActions | null
  openScmResource(resourceUri: string): AgentEvidenceServiceOperation | null
  diffScmResource(resourceUri: string): AgentEvidenceServiceOperation | null
  stageScmResource(resourceUri: string): AgentEvidenceServiceOperation | null
  discardScmResource(resourceUri: string): AgentEvidenceServiceOperation | null
}

export interface IAgentEvidenceTestingService {
  readonly _serviceBrand: undefined
  getSurface(): AgentEvidenceWorkbenchSurface
  getTestingView(): AgentEvidenceTestingView
  getTestingRunSummary(): AgentEvidenceTestingView["runSummary"]
  getTestingItems(): AgentEvidenceTestingView["items"]
  getTestResults(): AgentEvidenceTestingView["items"]
  rerunTests(testId?: string): (AgentEvidenceServiceOperation & { result: AgentEvidenceTestingView["items"][number] | null }) | null
}

export interface IAgentEvidenceProgressService {
  readonly _serviceBrand: undefined
  getSurface(): AgentEvidenceWorkbenchSurface
  getProgressItems(): AgentEvidenceProgressItem[]
  getProgressAggregate(): AgentEvidenceProgressAggregate
  cancelProgress(progressId?: string): AgentEvidenceServiceOperation | null
}

export interface IAgentEvidenceNotificationService {
  readonly _serviceBrand: undefined
  getSurface(): AgentEvidenceWorkbenchSurface
  getNotifications(): AgentEvidenceNotificationItem[]
  getNotificationSeverityCounts(): Record<AgentEvidenceSeverity, number>
  getNotificationActions(notificationId: string): AgentEvidenceNotificationItem["actions"]
  dismissNotification(notificationId: string): AgentEvidenceServiceOperation | null
}

export const IAgentEvidenceTimelineService = createDecorator<IAgentEvidenceTimelineService>("agentEvidenceTimelineService")
export const IAgentEvidenceScmService = createDecorator<IAgentEvidenceScmService>("agentEvidenceScmService")
export const IAgentEvidenceTestingService = createDecorator<IAgentEvidenceTestingService>("agentEvidenceTestingService")
export const IAgentEvidenceProgressService = createDecorator<IAgentEvidenceProgressService>("agentEvidenceProgressService")
export const IAgentEvidenceNotificationService = createDecorator<IAgentEvidenceNotificationService>("agentEvidenceNotificationService")

export const ITimelineService = createDecorator<IAgentEvidenceTimelineService>("timeline")
export const ISCMService = createDecorator<IAgentEvidenceScmService>("scm")
export const ITestService = createDecorator<IAgentEvidenceTestingService>("testService")
export const IProgressService = createDecorator<IAgentEvidenceProgressService>("progressService")
export const INotificationService = createDecorator<IAgentEvidenceNotificationService>("notificationService")

export const AGENT_EVIDENCE_VSCODE_SERVICE_IDS = [
  String(ITimelineService),
  String(ISCMService),
  String(ITestService),
  String(IProgressService),
  String(INotificationService),
] as const

export const AGENT_EVIDENCE_SURFACE_BRIDGE_AUDIT: AgentEvidenceSurfaceBridgeAuditEntry[] = [
  {
    surface: "scm",
    vscodeSourcePaths: [
      "src/vs/workbench/contrib/scm/common/scm.ts",
      "src/vs/workbench/contrib/scm/browser/scmViewPane.ts",
      "src/vs/workbench/contrib/scm/browser/menus.ts",
    ],
    codekStateSource: "IAgentEvidenceWorkbenchService.getSurface().views.scm",
    bridgeLevel: "adapter",
    bridgeStatus: "service-facade",
    serviceIds: [String(IAgentEvidenceScmService), String(ISCMService)],
    viewContainerIds: ["workbench.view.scm"],
    viewIds: [AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Scm],
    commandIds: [
      AGENT_EVIDENCE_COMMAND_IDS.OpenScm,
      AGENT_EVIDENCE_COMMAND_IDS.OpenResource,
      AGENT_EVIDENCE_COMMAND_IDS.DiffResource,
      AGENT_EVIDENCE_COMMAND_IDS.StageResource,
      AGENT_EVIDENCE_COMMAND_IDS.DiscardResource,
      AGENT_EVIDENCE_COMMAND_IDS.AttachResource,
      AGENT_EVIDENCE_COMMAND_IDS.ReviewRollback,
    ],
    menuIds: [MenuId.CommandPalette.id, MenuId.ViewTitle.id, MenuId.SCMTitle.id],
    uiSmokeSelectors: ['[data-agent-evidence-surface="scm"]', '[data-codek-smoke="agent-evidence-scm-files"]'],
    smokeMetricKeys: [
      "agentEvidenceScmVisible",
      "agentEvidenceScmOpenCommandIds",
      "agentEvidenceScmDiffCommandIds",
      "agentEvidenceScmDiscardCommandIds",
      "agentEvidenceScmAttachCommandIds",
    ],
    remainingGaps: ["完整 VS Code SCM provider runtime 和 diff editor 仍需人工 UI 验收"],
  },
  {
    surface: "timeline",
    vscodeSourcePaths: [
      "src/vs/workbench/contrib/timeline/common/timeline.ts",
      "src/vs/workbench/contrib/timeline/browser/timelinePane.ts",
      "src/vs/workbench/contrib/timeline/browser/timeline.contribution.ts",
      "src/vs/workbench/contrib/timeline/browser/timeline.service.contribution.ts",
    ],
    codekStateSource: "IAgentEvidenceWorkbenchService.getSurface().views.timeline",
    bridgeLevel: "adapter",
    bridgeStatus: "view-contribution",
    serviceIds: [String(IAgentEvidenceTimelineService), String(ITimelineService)],
    viewContainerIds: [AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Container],
    viewIds: [AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Timeline],
    commandIds: [AGENT_EVIDENCE_COMMAND_IDS.OpenTimeline, AGENT_EVIDENCE_COMMAND_IDS.OpenDetail],
    menuIds: [MenuId.CommandPalette.id, MenuId.ViewTitle.id, MenuId.AgentEvidenceTimeline.id],
    uiSmokeSelectors: ['[data-agent-evidence-surface="timeline"]', '[data-codek-smoke="agent-evidence-timeline"]'],
    smokeMetricKeys: [
      "agentEvidenceTimelineVisible",
      "agentEvidenceTimelineRows",
      "agentEvidenceTimelineCommandIds",
      "agentEvidenceTimelineLinks",
    ],
    remainingGaps: ["完整 VS Code Timeline provider pane 和树交互仍需人工 UI 验收"],
  },
  {
    surface: "testing",
    vscodeSourcePaths: [
      "src/vs/workbench/contrib/testing/common/testService.ts",
      "src/vs/workbench/contrib/testing/common/testResult.ts",
      "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
    ],
    codekStateSource: "IAgentEvidenceWorkbenchService.getSurface().views.testing",
    bridgeLevel: "adapter",
    bridgeStatus: "service-facade",
    serviceIds: [String(IAgentEvidenceTestingService), String(ITestService)],
    viewContainerIds: ["workbench.view.testing"],
    viewIds: [AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Testing],
    commandIds: [AGENT_EVIDENCE_COMMAND_IDS.OpenTesting, AGENT_EVIDENCE_COMMAND_IDS.ReviewTests],
    menuIds: [MenuId.CommandPalette.id, MenuId.ViewTitle.id, MenuId.TestItem.id],
    uiSmokeSelectors: ['[data-agent-evidence-surface="testing"]', '[data-codek-smoke="agent-evidence-testing-summary"]'],
    smokeMetricKeys: [
      "agentEvidenceTestingVisible",
      "agentEvidenceTestingState",
      "agentEvidenceTestingRerunCommandIds",
      "agentEvidenceTestingResourceLinks",
    ],
    remainingGaps: ["完整 VS Code Testing tree、test run provider 和结果 peek UI 仍需人工 UI 验收"],
  },
  {
    surface: "notifications",
    vscodeSourcePaths: [
      "src/vs/platform/notification/common/notification.ts",
      "src/vs/workbench/services/notification/common/notificationService.ts",
    ],
    codekStateSource: "IAgentEvidenceWorkbenchService.getSurface().views.notifications",
    bridgeLevel: "adapter",
    bridgeStatus: "ui-projection",
    serviceIds: [String(IAgentEvidenceNotificationService), String(INotificationService)],
    viewContainerIds: [AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Container],
    viewIds: [AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Notifications],
    commandIds: [AGENT_EVIDENCE_COMMAND_IDS.OpenNotifications, AGENT_EVIDENCE_COMMAND_IDS.DismissNotification],
    menuIds: [MenuId.CommandPalette.id, MenuId.ViewTitle.id],
    uiSmokeSelectors: ['[data-agent-evidence-surface="notifications"]', '[data-codek-smoke="agent-evidence-notifications"]'],
    smokeMetricKeys: [
      "agentEvidenceNotificationsVisible",
      "agentEvidenceNotificationDedupeKeys",
      "agentEvidenceNotificationDismissCommandIds",
      "agentEvidenceNotificationFocusTargets",
    ],
    remainingGaps: ["完整 VS Code Notification Center 视觉队列和 dismiss UX 仍需人工 UI 验收"],
  },
  {
    surface: "progress",
    vscodeSourcePaths: [
      "src/vs/platform/progress/common/progress.ts",
      "src/vs/workbench/services/progress/browser/progressService.ts",
      "src/vs/workbench/services/progress/browser/progressIndicator.ts",
    ],
    codekStateSource: "IAgentEvidenceWorkbenchService.getSurface().views.progress",
    bridgeLevel: "adapter",
    bridgeStatus: "ui-projection",
    serviceIds: [String(IAgentEvidenceProgressService), String(IProgressService)],
    viewContainerIds: [AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Container],
    viewIds: [AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Progress],
    commandIds: [
      AGENT_EVIDENCE_COMMAND_IDS.OpenProgress,
      AGENT_EVIDENCE_COMMAND_IDS.CancelProgress,
      AGENT_EVIDENCE_COMMAND_IDS.ImportManualUiEvidence,
    ],
    menuIds: [MenuId.CommandPalette.id, MenuId.ViewTitle.id],
    uiSmokeSelectors: ['[data-agent-evidence-surface="progress"]', '[data-codek-smoke="agent-evidence-progress"]'],
    smokeMetricKeys: [
      "agentEvidenceProgressVisible",
      "agentEvidenceProgressRows",
      "agentEvidenceProgressAggregateStatuses",
      "agentEvidenceProgressCancelCommandIds",
    ],
    remainingGaps: ["完整 VS Code window/activity progress indicator 和 cancellable UX 仍需人工 UI 验收"],
  },
]

export class AgentEvidenceWorkbenchService implements IAgentEvidenceWorkbenchService {
  declare readonly _serviceBrand: undefined

  private summary: AgentEvidenceWorkbenchSummary | null = null
  private surface: AgentEvidenceWorkbenchSurface = buildAgentEvidenceWorkbenchSurface(null)
  private selectedSurface: AgentEvidenceSurfaceKind = "timeline"

  getSummary(): AgentEvidenceWorkbenchSummary | null {
    return this.summary
  }

  getSurface(): AgentEvidenceWorkbenchSurface {
    return this.surface
  }

  setSummary(summary: AgentEvidenceWorkbenchSummary | null | undefined, options: { createdAt?: number } = {}): AgentEvidenceWorkbenchSurface {
    this.summary = summary || null
    this.surface = buildAgentEvidenceWorkbenchSurface(summary, options)
    return this.surface
  }

  refresh(summary: AgentEvidenceWorkbenchSummary | null | undefined, options: { createdAt?: number } = {}): AgentEvidenceWorkbenchSurface {
    return this.setSummary(summary, options)
  }

  openSurface(surface: AgentEvidenceSurfaceKind): AgentEvidenceWorkbenchSurface {
    this.selectedSurface = normalizeSurfaceKind(surface)
    return this.surface
  }

  getEvidenceItems(filter: AgentEvidenceWorkbenchFilter = {}): AgentEvidenceWorkbenchListItem[] {
    if (!filter.surface && !filter.status && !filter.severity && !filter.query) return this.surface.list.items
    return filterAgentEvidenceItems(this.surface.list.items, filter)
  }

  getEvidenceDetail(id?: string): AgentEvidenceWorkbenchDetail {
    if (!id || id === this.surface.detail.selectedId) return this.surface.detail
    return buildEvidenceDetail(this.surface.list.items, this.surface.export, id)
  }

  getExportDescriptor(): AgentEvidenceWorkbenchExportDescriptor {
    return this.surface.export
  }

  getContributionSummary(): AgentEvidenceWorkbenchContributionSummary {
    return this.surface.contribution
  }

  getSelectedSurface(): AgentEvidenceSurfaceKind {
    return this.selectedSurface
  }
}

export const globalAgentEvidenceWorkbenchService = new AgentEvidenceWorkbenchService()
registerSingleton(IAgentEvidenceWorkbenchService, globalAgentEvidenceWorkbenchService, InstantiationType.Delayed)

export class AgentEvidenceWorkbenchSurfaceFacadeService implements
  IAgentEvidenceTimelineService,
  IAgentEvidenceScmService,
  IAgentEvidenceTestingService,
  IAgentEvidenceProgressService,
  IAgentEvidenceNotificationService {
  declare readonly _serviceBrand: undefined

  constructor(private readonly agentEvidenceWorkbenchService: IAgentEvidenceWorkbenchService = globalAgentEvidenceWorkbenchService) {}

  getSurface(): AgentEvidenceWorkbenchSurface {
    return this.agentEvidenceWorkbenchService.getSurface()
  }

  getTimelineView(): AgentEvidenceWorkbenchSurface["views"]["timeline"] {
    return this.getSurface().views.timeline
  }

  getTimelineItems(): AgentEvidenceTimelineItem[] {
    return this.getTimelineView().items
  }

  getTimelineItem(handle: string): AgentEvidenceTimelineItem | null {
    return this.getTimelineItems().find((item) => item.handle === handle) || null
  }

  getTimelineItemCommand(handle: string): AgentEvidenceServiceCommand | null {
    const item = this.getTimelineItem(handle)
    if (!item) return null
    return buildServiceCommand(item.command.id, item.command.title, item.command.arguments.map((argument) => argument.value))
  }

  getTimelineItemResource(handle: string): AgentEvidenceTimelineItem["resource"] | null {
    return this.getTimelineItem(handle)?.resource || null
  }

  getScmView(): AgentEvidenceScmView {
    return this.getSurface().views.scm
  }

  getScmRepositories(): AgentEvidenceScmRepository[] {
    const scm = this.getScmView()
    return [{
      id: "agentEvidence",
      providerLabel: scm.providerLabel,
      providerId: "agentEvidence",
      input: {
        value: "",
        placeholder: "智能体证据 SCM 为只读",
        enabled: false,
      },
      resourceGroups: scm.resourceGroups,
      actionButton: buildServiceCommand(
        AGENT_EVIDENCE_COMMAND_IDS.ReviewRollback,
        "复核智能体回滚风险",
        ["rollback"],
        scm.nextActions.length > 0 || !scm.rollbackRisk.rollbackAvailable,
      ),
      readonlyEvidence: true,
      gitIndexMutation: false,
      ownerEvidence: scm.ownerEvidence,
    }]
  }

  getScmResourceGroups(): AgentEvidenceScmView["resourceGroups"] {
    return this.getScmView().resourceGroups
  }

  getScmResources(): AgentEvidenceScmResource[] {
    const groups = this.getScmView().resourceGroups
    if (groups.length === 1) return groups[0].resources
    return groups.flatMap((group) => group.resources)
  }

  getScmResourceActions(resourceUri: string): AgentEvidenceScmResourceActions | null {
    const match = findScmResourceWithGroup(this.getScmView(), resourceUri)
    if (!match) return null
    return {
      resourceUri: match.resource.resourceUri,
      groupId: match.group.id,
      providerId: "agentEvidence",
      readonlyEvidence: true,
      gitIndexMutation: false,
      open: buildServiceCommand(match.resource.openCommandId, "打开智能体变更资源", [match.resource.resourceUri]),
      diff: buildServiceCommand(match.resource.diffCommandId, "比较智能体变更资源", [match.resource.resourceUri]),
      stage: buildServiceCommand(match.resource.stageCommandId, "暂存智能体变更资源（只读 evidence，不写 Git index）", [match.resource.resourceUri], false),
      discard: buildServiceCommand(match.resource.discardCommandId, "丢弃智能体变更资源（只读 evidence，不改工作区）", [match.resource.resourceUri], false),
      attach: buildServiceCommand(match.resource.attachCommandId, "附加智能体变更资源", [match.resource.resourceUri]),
      ownerEvidence: {
        provider: this.getScmView().ownerEvidence,
        resourceGroup: match.group.ownerEvidence,
        resource: match.resource.ownerEvidence,
        actions: {
          open: buildScmOwnerEvidence("command", match.resource.resourceUri, {
            groupId: match.group.id,
            commandId: match.resource.openCommandId,
            connected: true,
          }),
          diff: buildScmOwnerEvidence("command", match.resource.resourceUri, {
            groupId: match.group.id,
            commandId: match.resource.diffCommandId,
            connected: true,
          }),
          stage: buildScmOwnerEvidence("command", match.resource.resourceUri, {
            groupId: match.group.id,
            commandId: match.resource.stageCommandId,
            connected: false,
          }),
          discard: buildScmOwnerEvidence("command", match.resource.resourceUri, {
            groupId: match.group.id,
            commandId: match.resource.discardCommandId,
            connected: false,
          }),
          attach: buildScmOwnerEvidence("command", match.resource.resourceUri, {
            groupId: match.group.id,
            commandId: match.resource.attachCommandId,
            connected: true,
          }),
        },
      },
    }
  }

  openScmResource(resourceUri: string): AgentEvidenceServiceOperation | null {
    const actions = this.getScmResourceActions(resourceUri)
    return actions
      ? buildServiceOperation("scm", AGENT_EVIDENCE_COMMAND_IDS.OpenResource, resourceUri, actions.ownerEvidence.actions.open)
      : null
  }

  diffScmResource(resourceUri: string): AgentEvidenceServiceOperation | null {
    const actions = this.getScmResourceActions(resourceUri)
    return actions
      ? buildServiceOperation("scm", AGENT_EVIDENCE_COMMAND_IDS.DiffResource, resourceUri, actions.ownerEvidence.actions.diff)
      : null
  }

  stageScmResource(resourceUri: string): AgentEvidenceServiceOperation | null {
    const actions = this.getScmResourceActions(resourceUri)
    return actions
      ? buildServiceOperation("scm", AGENT_EVIDENCE_COMMAND_IDS.StageResource, resourceUri, actions.ownerEvidence.actions.stage)
      : null
  }

  discardScmResource(resourceUri: string): AgentEvidenceServiceOperation | null {
    const actions = this.getScmResourceActions(resourceUri)
    return actions
      ? buildServiceOperation("scm", AGENT_EVIDENCE_COMMAND_IDS.DiscardResource, resourceUri, actions.ownerEvidence.actions.discard)
      : null
  }

  getTestingView(): AgentEvidenceTestingView {
    return this.getSurface().views.testing
  }

  getTestingRunSummary(): AgentEvidenceTestingView["runSummary"] {
    return this.getTestingView().runSummary
  }

  getTestingItems(): AgentEvidenceTestingView["items"] {
    return this.getTestingView().items
  }

  getTestResults(): AgentEvidenceTestingView["items"] {
    return this.getTestingItems()
  }

  rerunTests(testId = "agentEvidence.latestTask"): (AgentEvidenceServiceOperation & { result: AgentEvidenceTestingView["items"][number] | null }) | null {
    const result = this.getTestingItems().find((item) => item.id === testId) || this.getTestingItems()[0] || null
    if (!result) return null
    return {
      ...buildServiceOperation("testing", result.rerunCommandId, result.id),
      result,
    }
  }

  getProgressItems(): AgentEvidenceProgressItem[] {
    return this.getSurface().views.progress.items
  }

  getProgressAggregate(): AgentEvidenceProgressAggregate {
    const items = this.getProgressItems()
    return {
      total: items.length,
      active: items.filter((item) => item.lifecycle.state === "active").length,
      updated: items.filter((item) => item.lifecycle.state === "updated").length,
      dismissed: items.filter((item) => item.lifecycle.state === "dismissed").length,
      cancellable: items.filter((item) => item.lifecycle.cancellable).length,
      failed: items.filter((item) => item.aggregateStatus === "failed" || item.aggregateStatus === "systemError").length,
      blocked: items.filter((item) => item.aggregateStatus === "blocked").length,
      commandId: AGENT_EVIDENCE_COMMAND_IDS.CancelProgress,
      readonlyEvidence: true,
    }
  }

  cancelProgress(progressId?: string): AgentEvidenceServiceOperation | null {
    const target = progressId
      ? this.getProgressItems().find((item) => item.id === progressId)
      : this.getProgressItems().find((item) => item.lifecycle.cancellable) || this.getProgressItems()[0]
    return target ? buildServiceOperation("progress", target.cancelCommandId, target.id) : null
  }

  getNotifications(): AgentEvidenceNotificationItem[] {
    return this.getSurface().views.notifications.items
  }

  getNotificationSeverityCounts(): Record<AgentEvidenceSeverity, number> {
    return this.getNotifications().reduce((counts, item) => {
      counts[item.severity] += 1
      return counts
    }, { info: 0, warning: 0, error: 0 })
  }

  getNotificationActions(notificationId: string): AgentEvidenceNotificationItem["actions"] {
    return this.getNotifications().find((item) => item.id === notificationId)?.actions || []
  }

  dismissNotification(notificationId: string): AgentEvidenceServiceOperation | null {
    const target = this.getNotifications().find((item) => item.id === notificationId)
    return target ? buildServiceOperation("notifications", target.dismissCommandId, target.id) : null
  }

  getEvidenceItems(filter: AgentEvidenceWorkbenchFilter = {}): AgentEvidenceWorkbenchListItem[] {
    const surface = this.getSurface()
    if (!filter.surface && !filter.status && !filter.severity && !filter.query) return surface.list.items
    return filterAgentEvidenceItems(surface.list.items, filter)
  }

  getEvidenceDetail(id?: string): AgentEvidenceWorkbenchDetail {
    const surface = this.getSurface()
    if (!id || id === surface.detail.selectedId) return surface.detail
    return buildEvidenceDetail(surface.list.items, surface.export, id)
  }

  getExportDescriptor(): AgentEvidenceWorkbenchExportDescriptor {
    return this.getSurface().export
  }

  getContributionSummary(): AgentEvidenceWorkbenchContributionSummary {
    return this.getSurface().contribution
  }
}

export const globalAgentEvidenceWorkbenchSurfaceFacadeService = new AgentEvidenceWorkbenchSurfaceFacadeService(globalAgentEvidenceWorkbenchService)
export const globalAgentEvidenceTimelineService = globalAgentEvidenceWorkbenchSurfaceFacadeService
export const globalAgentEvidenceScmService = globalAgentEvidenceWorkbenchSurfaceFacadeService
export const globalAgentEvidenceTestingService = globalAgentEvidenceWorkbenchSurfaceFacadeService
export const globalAgentEvidenceProgressService = globalAgentEvidenceWorkbenchSurfaceFacadeService
export const globalAgentEvidenceNotificationService = globalAgentEvidenceWorkbenchSurfaceFacadeService

registerSingleton(IAgentEvidenceTimelineService, globalAgentEvidenceTimelineService, InstantiationType.Delayed)
registerSingleton(IAgentEvidenceScmService, globalAgentEvidenceScmService, InstantiationType.Delayed)
registerSingleton(IAgentEvidenceTestingService, globalAgentEvidenceTestingService, InstantiationType.Delayed)
registerSingleton(IAgentEvidenceProgressService, globalAgentEvidenceProgressService, InstantiationType.Delayed)
registerSingleton(IAgentEvidenceNotificationService, globalAgentEvidenceNotificationService, InstantiationType.Delayed)
registerSingleton(ITimelineService, globalAgentEvidenceTimelineService, InstantiationType.Delayed)
registerSingleton(ISCMService, globalAgentEvidenceScmService, InstantiationType.Delayed)
registerSingleton(ITestService, globalAgentEvidenceTestingService, InstantiationType.Delayed)
registerSingleton(IProgressService, globalAgentEvidenceProgressService, InstantiationType.Delayed)
registerSingleton(INotificationService, globalAgentEvidenceNotificationService, InstantiationType.Delayed)

function buildServiceCommand(
  commandId: string,
  title: string,
  args: string[] = [],
  enabled = true,
): AgentEvidenceServiceCommand {
  return {
    commandId: sanitizeString(commandId),
    title: sanitizeString(title),
    arguments: args.map(sanitizeString).filter(Boolean),
    enabled,
  }
}

function buildServiceOperation(
  surface: AgentEvidenceSurfaceKind,
  commandId: string,
  targetId: string,
  ownerEvidence?: AgentEvidenceScmOwnerEvidence,
): AgentEvidenceServiceOperation {
  return {
    surface,
    commandId: sanitizeString(commandId),
    targetId: sanitizeString(targetId),
    handledBy: "agentEvidenceWorkbenchService",
    mutatesState: false,
    readonlyEvidence: true as const,
    gitIndexMutation: false as const,
    ownerEvidence,
  }
}

function buildScmOwnerEvidence(
  kind: AgentEvidenceScmOwnerEvidence["kind"],
  resourceUri = "",
  options: {
    groupId?: string
    commandId?: string
    connected?: boolean
  } = {},
): AgentEvidenceScmOwnerEvidence {
  return {
    kind,
    owner: kind === "provider" ? "agentEvidenceWorkbenchService" : "agentEvidenceScmService",
    providerId: "agentEvidence",
    groupId: options.groupId,
    resourceUri: resourceUri ? sanitizeString(resourceUri) : undefined,
    commandId: options.commandId ? sanitizeString(options.commandId) : undefined,
    codekStateSource: "IAgentEvidenceWorkbenchService.getSurface().views.scm",
    vscodeSourcePaths: [
      "src/vs/workbench/contrib/scm/common/scm.ts",
      "src/vs/workbench/contrib/scm/browser/scmViewPane.ts",
      "src/vs/workbench/api/browser/mainThreadSCM.ts",
    ],
    readonlyEvidence: true as const,
    gitIndexMutation: false as const,
    connected: options.connected === true,
    remainingUiOwnerGap: ["App.vue/generic SCM shell owner 未在本后台线程接入"],
  }
}

function findScmResourceWithGroup(
  view: AgentEvidenceScmView,
  resourceUri: string,
): { group: AgentEvidenceScmView["resourceGroups"][number]; resource: AgentEvidenceScmResource } | null {
  const wanted = sanitizeString(resourceUri)
  for (const group of view.resourceGroups) {
    const resource = group.resources.find((item) => item.resourceUri === wanted || item.uri === wanted)
    if (resource) return { group, resource }
  }
  return null
}

export function setAgentEvidenceWorkbenchSummary(
  summary: AgentEvidenceWorkbenchSummary | null | undefined,
  options: { createdAt?: number } = {},
): AgentEvidenceWorkbenchSurface {
  return globalAgentEvidenceWorkbenchService.setSummary(summary, options)
}

export function getAgentEvidenceWorkbenchSurface(): AgentEvidenceWorkbenchSurface {
  return globalAgentEvidenceWorkbenchService.getSurface()
}

export function getAgentEvidenceWorkbenchContributionSummary(): AgentEvidenceWorkbenchContributionSummary {
  return globalAgentEvidenceWorkbenchService.getContributionSummary()
}

export function buildAgentEvidenceWorkbenchSurface(
  summary: AgentEvidenceWorkbenchSummary | null | undefined,
  options: { createdAt?: number } = {},
): AgentEvidenceWorkbenchSurface {
  const workbench = redactSummary(normalizeSummary(summary))
  const generatedAt = sanitizeTimestamp(options.createdAt)
  const report = normalizeReportContract(workbench, generatedAt)
  const timelineItems = buildTimelineItems(workbench, generatedAt, report)
  const testing = buildTestingView(workbench, report)
  const scm = buildScmView(workbench, report)
  const progressItems = buildProgressItems(workbench, report)
  const actions = buildSurfaceActions(workbench)
  const notifications = buildNotifications(workbench, testing, actions, report)
  const views = {
    timeline: { source: "agentEvidence", items: timelineItems },
    scm,
    testing,
    progress: { items: progressItems },
    notifications: { items: notifications },
  }
  const list = buildEvidenceList(views, report)
  const exportWithCount = buildEvidenceExportDescriptor(report, list.items.length)
  const detail = buildEvidenceDetail(list.items, exportWithCount)
  const contribution = buildContributionSummary()

  return {
    schemaVersion: 1,
    source: "releaseEvidence",
    status: workbench.status,
    ready: workbench.ready === true,
    generatedAt,
    summary: workbench.statusLabel || summarizeSurface(workbench),
    report,
    views,
    list,
    detail,
    export: exportWithCount,
    contribution,
    actions,
  }
}

function buildContributionSummary(): AgentEvidenceWorkbenchContributionSummary {
  return {
    serviceId: String(IAgentEvidenceWorkbenchService),
    vscodeServiceIds: [...AGENT_EVIDENCE_VSCODE_SERVICE_IDS],
    stateSource: "agentEvidenceWorkbenchService",
    viewContainerIds: [
      AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Container,
      "workbench.view.scm",
      "workbench.view.testing",
    ],
    viewIds: [
      AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Timeline,
      AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Progress,
      AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Notifications,
      AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Scm,
      AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Testing,
    ],
    commandIds: Object.values(AGENT_EVIDENCE_COMMAND_IDS),
    actionIds: Object.values(AGENT_EVIDENCE_COMMAND_IDS),
    menuIds: [
      MenuId.CommandPalette.id,
      MenuId.ViewTitle.id,
      MenuId.SCMTitle.id,
      MenuId.TestItem.id,
      MenuId.AgentEvidenceTimeline.id,
    ],
    surfaces: ["timeline", "scm", "testing", "progress", "notifications"],
    constraints: {
      releaseEvidenceSingleSource: true,
      action2MenuDriven: true,
      scmStatusReadOnly: true,
      testingRunEvidenceReadOnly: true,
      progressNotificationLifecycleReadOnly: true,
      noSecondEvidenceState: true,
    },
  }
}

export function registerAgentEvidenceWorkbenchContributions(
  options: RegisterAgentEvidenceWorkbenchOptions = {},
): Disposable {
  registerAgentEvidenceViews()
  const disposables: Disposable[] = [
    registerAgentEvidenceAction2(AGENT_EVIDENCE_COMMAND_IDS.OpenTimeline, "打开智能体证据时间线", "timeline", options, [
      { id: MenuId.ViewTitle, group: "navigation", order: 10, when: `view == ${AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Timeline}` },
      { id: MenuId.AgentEvidenceTimeline, group: "navigation", order: 10, when: "agentEvidenceAvailable" },
    ]),
    registerAgentEvidenceAction2(AGENT_EVIDENCE_COMMAND_IDS.OpenScm, "打开智能体变更证据", "scm", options, [
      { id: MenuId.ViewTitle, group: "navigation", order: 10, when: `view == ${AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Scm}` },
      { id: MenuId.SCMTitle, group: "navigation", order: 10, when: "agentEvidenceAvailable" },
    ]),
    registerAgentEvidenceAction2(AGENT_EVIDENCE_COMMAND_IDS.OpenTesting, "打开智能体测试证据", "testing", options, [
      { id: MenuId.ViewTitle, group: "navigation", order: 10, when: `view == ${AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Testing}` },
      { id: MenuId.TestItem, group: "navigation", order: 10, when: "agentEvidenceAvailable" },
    ]),
    registerAgentEvidenceAction2(AGENT_EVIDENCE_COMMAND_IDS.OpenProgress, "打开智能体进度证据", "progress", options, [
      { id: MenuId.ViewTitle, group: "navigation", order: 10, when: `view == ${AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Progress}` },
    ]),
    registerAgentEvidenceAction2(AGENT_EVIDENCE_COMMAND_IDS.OpenNotifications, "打开智能体证据通知", "notifications", options, [
      { id: MenuId.ViewTitle, group: "navigation", order: 10, when: `view == ${AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Notifications}` },
    ]),
    registerAgentEvidenceAction2(AGENT_EVIDENCE_COMMAND_IDS.OpenResource, "打开智能体变更资源", "scm", options, [
      { id: MenuId.SCMTitle, group: "inline", order: 20, when: "agentEvidenceAvailable" },
    ], [{ name: "resource", isOptional: true, constraint: "string", description: "智能体证据资源 URI" }]),
    registerAgentEvidenceAction2(AGENT_EVIDENCE_COMMAND_IDS.DiffResource, "比较智能体变更资源", "scm", options, [
      { id: MenuId.SCMTitle, group: "inline", order: 30, when: "agentEvidenceAvailable" },
    ], [{ name: "resource", isOptional: true, constraint: "string", description: "智能体证据资源 URI" }]),
    registerAgentEvidenceAction2(AGENT_EVIDENCE_COMMAND_IDS.StageResource, "记录智能体变更资源暂存意图（只读 evidence，不写 Git index）", "scm", options, [
      { id: MenuId.SCMTitle, group: "inline", order: 35, when: "agentEvidenceAvailable", precondition: null },
    ], [{ name: "resource", isOptional: true, constraint: "string", description: "智能体证据资源 URI" }]),
    registerAgentEvidenceAction2(AGENT_EVIDENCE_COMMAND_IDS.DiscardResource, "记录智能体变更资源丢弃意图（只读 evidence，不改工作区）", "scm", options, [
      { id: MenuId.SCMTitle, group: "inline", order: 37, when: "agentEvidenceAvailable", precondition: null },
    ], [{ name: "resource", isOptional: true, constraint: "string", description: "智能体证据资源 URI" }]),
    registerAgentEvidenceAction2(AGENT_EVIDENCE_COMMAND_IDS.AttachResource, "附加智能体变更资源", "scm", options, [
      { id: MenuId.SCMTitle, group: "inline", order: 40, when: "agentEvidenceAvailable" },
    ], [{ name: "resource", isOptional: true, constraint: "string", description: "智能体证据资源 URI" }]),
    registerAgentEvidenceAction2(AGENT_EVIDENCE_COMMAND_IDS.ReviewTests, "复核智能体测试证据", "testing", options, [
      { id: MenuId.TestItem, group: "inline", order: 20, when: "agentEvidenceAvailable" },
      { id: MenuId.ViewTitle, group: "navigation", order: 20, when: `view == ${AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Testing}` },
    ]),
    registerAgentEvidenceAction2(AGENT_EVIDENCE_COMMAND_IDS.CancelProgress, "取消智能体证据进度", "progress", options, [
      { id: MenuId.ViewTitle, group: "navigation", order: 20, when: `view == ${AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Progress}` },
    ], [{ name: "progressId", isOptional: true, constraint: "string", description: "智能体证据进度 id" }]),
    registerAgentEvidenceAction2(AGENT_EVIDENCE_COMMAND_IDS.DismissNotification, "关闭智能体证据通知", "notifications", options, [
      { id: MenuId.ViewTitle, group: "navigation", order: 20, when: `view == ${AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Notifications}` },
    ], [{ name: "notificationId", isOptional: true, constraint: "string", description: "智能体证据通知 id" }]),
    registerAgentEvidenceAction2(AGENT_EVIDENCE_COMMAND_IDS.ReviewRollback, "复核智能体回滚风险", "scm", options, [
      { id: MenuId.SCMTitle, group: "navigation", order: 50, when: "agentEvidenceAvailable" },
    ]),
    registerAgentEvidenceAction2(AGENT_EVIDENCE_COMMAND_IDS.ImportManualUiEvidence, "导入真实 UI 证据", "progress", options, [
      { id: MenuId.ViewTitle, group: "navigation", order: 30, when: `view == ${AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Progress}` },
    ]),
    registerAgentEvidenceWorkbenchAction2(AGENT_EVIDENCE_COMMAND_IDS.OpenDetail, "打开智能体证据详情", "timeline", options, [
      { id: MenuId.ViewTitle, group: "navigation", order: 20, when: `view == ${AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Timeline}` },
      { id: MenuId.AgentEvidenceTimeline, group: "navigation", order: 20, when: "agentEvidenceAvailable" },
    ]),
    registerAgentEvidenceWorkbenchAction2(AGENT_EVIDENCE_COMMAND_IDS.ExportJson, "导出智能体证据 JSON", "timeline", options),
    registerAgentEvidenceWorkbenchAction2(AGENT_EVIDENCE_COMMAND_IDS.ExportMarkdown, "导出智能体证据 Markdown", "timeline", options),
  ]
  return { dispose: () => disposables.forEach((disposable) => disposable.dispose()) }
}

function registerAgentEvidenceViews(): void {
  registerViewContainer({
    id: AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Container,
    name: "智能体证据",
    location: "activityBar",
    icon: "agent-evidence",
    source: "agent",
    order: 65,
  })
  registerViewContainer({
    id: "workbench.view.testing",
    name: "测试",
    location: "activityBar",
    icon: "testing",
    source: "vscode",
    order: 45,
  })
  registerView({
    id: AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Timeline,
    name: "证据时间线",
    containerId: AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Container,
    location: "sideBar",
    source: "agent",
    order: 10,
    when: "agentEvidenceAvailable",
  })
  registerView({
    id: AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Progress,
    name: "执行进度",
    containerId: AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Container,
    location: "sideBar",
    source: "agent",
    order: 20,
    when: "agentEvidenceAvailable",
  })
  registerView({
    id: AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Notifications,
    name: "阻断通知",
    containerId: AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Container,
    location: "sideBar",
    source: "agent",
    order: 30,
    when: "agentEvidenceAvailable",
  })
  registerView({
    id: AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Scm,
    name: "智能体变更证据",
    containerId: "workbench.view.scm",
    location: "sideBar",
    source: "agent",
    order: 80,
    when: "agentEvidenceAvailable",
  })
  registerView({
    id: AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Testing,
    name: "智能体测试证据",
    containerId: "workbench.view.testing",
    location: "sideBar",
    source: "agent",
    order: 80,
    when: "agentEvidenceAvailable",
  })
}

function registerAgentEvidenceAction2(
  id: string,
  title: string,
  surface: AgentEvidenceSurfaceKind,
  options: RegisterAgentEvidenceWorkbenchOptions,
  menu: Array<{ id: MenuId; group?: "navigation" | string; order?: number; when?: string; precondition?: string | null }> = [],
  args: Array<{ name: string; isOptional?: boolean; constraint?: "string" | "number" | "boolean" | "array" | "object" | "function"; description?: string }> = [],
): Disposable {
  return registerAction2(class AgentEvidenceSurfaceAction extends Action2 {
    constructor() {
      super({
        id,
        title,
        category: "智能体",
        source: "agent",
        f1: true,
        precondition: "agentEvidenceAvailable",
        menu,
        metadata: {
          description: title,
          ...(args.length ? { args } : {}),
        },
      })
    }

    async run(): Promise<void> {
      globalAgentEvidenceWorkbenchService.openSurface(surface)
      await options.openSurface?.(surface)
    }
  })
}

function registerAgentEvidenceWorkbenchAction2(
  id: string,
  title: string,
  fallbackSurface: AgentEvidenceSurfaceKind,
  options: RegisterAgentEvidenceWorkbenchOptions,
  menu: Array<{ id: MenuId; group?: "navigation" | string; order?: number; when?: string; precondition?: string | null }> = [],
): Disposable {
  return registerAction2(class AgentEvidenceWorkbenchAction extends Action2 {
    constructor() {
      super({
        id,
        title,
        category: "智能体",
        source: "agent",
        f1: true,
        precondition: "agentEvidenceAvailable",
        menu,
        metadata: { description: title },
      })
    }

    async run(): Promise<void> {
      const detailSurface = globalAgentEvidenceWorkbenchService.getEvidenceDetail().item?.surface || fallbackSurface
      globalAgentEvidenceWorkbenchService.openSurface(detailSurface)
      await options.openSurface?.(detailSurface)
    }
  })
}

function normalizeSummary(summary: AgentEvidenceWorkbenchSummary | null | undefined): AgentEvidenceWorkbenchSummary {
  if (summary) return summary
  return {
    schemaVersion: 1,
    available: false,
    ready: false,
    status: "missing",
    statusLabel: "暂无智能体证据工作台记录",
    stageStatusSchema: { stageIds: [], statuses: ["ready", "degraded", "blocked", "missing"] },
    stageCount: 0,
    readyStages: 0,
    availableStages: 0,
    timeline: [],
    testing: {
      taskRuns: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
      running: 0,
      skipped: 0,
      problemDiagnostics: 0,
      qualityGateStatus: "",
      qualityGateCommands: 0,
      qualityGateFailures: 0,
      latestTask: "",
    },
    failure: {
      blockingGaps: 0,
      highGaps: 0,
      mediumGaps: 0,
      taskRunIssues: 0,
      qualityGateFailures: 0,
      problemDiagnostics: 0,
      latestBlockingGap: null,
    },
    scm: {
      fileCount: 0,
      files: [],
      mainWorkspaceProtected: false,
      rollbackAvailable: false,
      pendingBatchBlocked: false,
      pendingHunkBlocked: false,
      reviewDisplayBlocked: false,
    },
    approval: {
      permissionStatus: "",
      permissionRisk: "",
      permissionApproved: false,
      writePathCount: 0,
      commandAllowlistCount: 0,
      commandAuthorizationBlocked: 0,
      commandAuthorizationNeedsPermission: 0,
      agentReviewBlocked: false,
      operationLogVisible: false,
    },
    rollback: {
      rollbackAvailable: false,
      mainWorkspaceProtected: false,
      agentRollbackDriftBlocked: false,
      operationLogVisible: false,
    },
    report: undefined,
    sourceEvidence: [],
  }
}

function normalizeReportContract(summary: AgentEvidenceWorkbenchSummary, generatedAt: number): AgentEvidenceReportContract {
  const existing = summary.report
  const correlationId = sanitizeString(existing?.correlationId) || `agent-evidence:${generatedAt}`
  const failureCauses = normalizeFailureCauses(existing?.failureCauses)
  const nextActions = normalizeNextActions(existing?.nextActions)
  const phaseLifecycle = normalizePhaseLifecycleItems(existing?.phaseLifecycle, generatedAt)
  const artifacts = normalizeArtifacts(existing?.artifacts)
  const projections = normalizeProjectionContract(existing?.projections, summary, correlationId, artifacts)
  return {
    schemaVersion: 1,
    source: "releaseEvidence",
    timestamp: typeof existing?.timestamp === "number" && Number.isFinite(existing.timestamp) ? existing.timestamp : generatedAt,
    workspace: {
      root: sanitizeString(existing?.workspace?.root),
      protected: existing?.workspace?.protected === true || summary.scm.mainWorkspaceProtected === true || summary.rollback.mainWorkspaceProtected === true,
      isolation: sanitizeString(existing?.workspace?.isolation),
    },
    correlationId,
    commands: normalizeCommands(existing?.commands, summary, projections),
    runStateSchema: normalizeRunStateSchema(existing?.runStateSchema),
    runs: normalizeRunEvidence(existing?.runs),
    artifacts,
    failureCauses: failureCauses.length ? failureCauses : deriveFailureCauses(summary),
    nextActions: nextActions.length ? nextActions : deriveNextActions(summary),
    roleProfiles: normalizeRoleProfiles(existing?.roleProfiles),
    projections,
    progress: normalizeProgressItems(existing?.progress, correlationId),
    notifications: normalizeNotificationItems(existing?.notifications, correlationId, generatedAt),
    phaseStatusSchema: normalizePhaseStatusSchema(existing?.phaseStatusSchema, phaseLifecycle),
    phaseLifecycle,
  }
}

function normalizeRunStateSchema(value: AgentEvidenceWorkbenchReport["runStateSchema"] | undefined): AgentEvidenceRunStateSchema {
  const transitions: Record<AgentEvidenceRunState, AgentEvidenceRunState[]> = {
    planned: ["assigned", "blocked"],
    assigned: ["running", "blocked"],
    running: ["review-ready", "verified", "blocked"],
    "review-ready": ["verified", "accepted", "blocked", "rolled-back"],
    verified: ["accepted", "blocked", "rolled-back"],
    blocked: ["planned", "assigned", "running", "rolled-back"],
    accepted: ["rolled-back"],
    "rolled-back": [],
  }
  if (!value || typeof value !== "object") {
    return { states: [...AGENT_EVIDENCE_RUN_STATES], transitions }
  }
  const incoming = value.transitions || {}
  for (const state of AGENT_EVIDENCE_RUN_STATES) {
    if (Array.isArray(incoming[state])) {
      transitions[state] = incoming[state].map(normalizeRunState).filter((item): item is AgentEvidenceRunState => Boolean(item))
    }
  }
  return {
    states: [...AGENT_EVIDENCE_RUN_STATES],
    transitions,
  }
}

function normalizeRunEvidence(values: AgentEvidenceWorkbenchReport["runs"] | undefined): AgentEvidenceRunEvidence[] {
  return Array.isArray(values)
    ? values.map((item, index) => ({
      id: sanitizeString(item.id || `agent-run-${index + 1}`),
      state: normalizeRunState(item.state) || "planned",
      stateLabel: userFacingEvidenceText(item.stateLabel || item.state),
      plannedAt: toNullableNumber(item.plannedAt),
      assignedAt: toNullableNumber(item.assignedAt),
      startedAt: toNullableNumber(item.startedAt),
      updatedAt: toNullableNumber(item.updatedAt),
      completedAt: toNullableNumber(item.completedAt),
      plan: {
        summary: userFacingEvidenceText(item.plan?.summary),
        goal: userFacingEvidenceText(item.plan?.goal),
        steps: Array.isArray(item.plan?.steps)
          ? item.plan.steps.map((step, stepIndex) => ({
            id: sanitizeString(step.id || `step-${stepIndex + 1}`),
            title: userFacingEvidenceText(step.title),
            status: sanitizeString(step.status || "planned"),
          })).filter((step) => step.id)
          : [],
        contextRefs: Array.isArray(item.plan?.contextRefs) ? item.plan.contextRefs.map(sanitizeString).filter(Boolean) : [],
      },
      phases: Array.isArray(item.phases)
        ? item.phases.map((phase) => ({
          id: sanitizeString(phase.id),
          title: userFacingEvidenceText(phase.title),
          status: sanitizeString(phase.status),
          ready: phase.ready === true,
          evidenceRefs: Array.isArray(phase.evidenceRefs) ? phase.evidenceRefs.map(sanitizeString).filter(Boolean) : [],
          nextAction: userFacingEvidenceText(phase.nextAction),
        })).filter((phase) => phase.id)
        : [],
      changedFiles: Array.isArray(item.changedFiles) ? uniqueStrings(item.changedFiles.map(sanitizeString)) : [],
      diffSummary: {
        filesChanged: toNumber(item.diffSummary?.filesChanged, Array.isArray(item.changedFiles) ? item.changedFiles.length : 0),
        files: Array.isArray(item.diffSummary?.files) ? uniqueStrings(item.diffSummary.files.map(sanitizeString)) : [],
        summary: userFacingEvidenceText(item.diffSummary?.summary),
        source: sanitizeString(item.diffSummary?.source || "releaseEvidence"),
      },
      validationCommands: Array.isArray(item.validationCommands)
        ? item.validationCommands.map((command) => ({
          command: sanitizeString(command.command),
          status: sanitizeString(command.status || "unknown"),
          exitCode: toNullableNumber(command.exitCode),
          source: sanitizeString(command.source || "qualityGate"),
          timedOut: command.timedOut === true,
        })).filter((command) => command.command)
        : [],
      failureReasons: Array.isArray(item.failureReasons)
        ? item.failureReasons.map((reason) => ({
          id: sanitizeString(reason.id),
          stage: sanitizeString(reason.stage),
          severity: sanitizeString(reason.severity),
          detail: userFacingEvidenceText(reason.detail),
        })).filter((reason) => reason.id)
        : [],
      rollbackRecommendation: {
        available: item.rollbackRecommendation?.available === true,
        action: userFacingEvidenceText(item.rollbackRecommendation?.action),
        detail: userFacingEvidenceText(item.rollbackRecommendation?.detail),
        driftBlocked: item.rollbackRecommendation?.driftBlocked === true,
      },
      costSummary: {
        available: item.costSummary?.available === true,
        totalRequests: toNumber(item.costSummary?.totalRequests, 0),
        inputTokens: toNumber(item.costSummary?.inputTokens, 0),
        outputTokens: toNumber(item.costSummary?.outputTokens, 0),
        totalTokens: toNumber(item.costSummary?.totalTokens, 0),
        estimatedCostUsd: toNumber(item.costSummary?.estimatedCostUsd, 0),
        currency: sanitizeString(item.costSummary?.currency || "USD"),
        estimated: item.costSummary?.estimated !== false,
        placeholder: item.costSummary?.placeholder === true,
      },
    })).filter((item) => item.id)
    : []
}

function normalizeRunState(value: string | undefined): AgentEvidenceRunState | null {
  const normalized = sanitizeString(value).toLowerCase().replace(/_/g, "-")
  return (AGENT_EVIDENCE_RUN_STATES as string[]).includes(normalized) ? normalized as AgentEvidenceRunState : null
}

function buildTimelineItems(summary: AgentEvidenceWorkbenchSummary, generatedAt: number, report: AgentEvidenceReportContract): AgentEvidenceTimelineItem[] {
  const lifecycleByStage = new Map(report.phaseLifecycle.map((item) => [item.stage, item]))
  const timelineItems: AgentEvidenceTimelineItem[] = (summary.timeline || []).map((stage, index) => {
    const artifact = findArtifactForStage(stage.stage, report)
    const commandId = commandForStage(stage.stage)
    const lifecycle = lifecycleByStage.get(stage.stage)
    const projectionIds = projectionIdsForStage(report, stage.stage)
    return {
      handle: `${stage.stage}:${index}`,
      source: "agentEvidence",
      label: userFacingEvidenceText(stage.title || stage.stage),
      description: userFacingEvidenceText(stage.summary || stage.nextAction || ""),
      timestamp: generatedAt + index,
      stage: stage.stage,
      status: stage.status,
      contextValue: `agentEvidence.${stage.status}`,
      commandId,
      evidenceRefs: Array.isArray(stage.evidenceRefs) ? [...stage.evidenceRefs] : [],
      nextAction: userFacingEvidenceText(stage.nextAction || ""),
      correlationId: report.correlationId,
      failureCauseIds: report.failureCauses.filter((item) => item.stage === stage.stage).map((item) => item.id),
      nextActionIds: report.nextActions.filter((item) => item.stage === stage.stage).map((item) => item.id),
      projectionIds,
      threadId: lifecycle?.threadId || "",
      validationResult: lifecycle?.validation.result || "",
      failureRecoveryStatus: lifecycle?.failureRecovery.status || "",
      command: {
        id: commandId,
        title: commandTitleForStage(stage.stage),
        arguments: [
          { key: "stage", value: stage.stage },
          { key: "correlationId", value: report.correlationId },
        ],
      },
      resource: artifact ? {
        uri: artifact.path,
        range: "",
        source: artifact.source,
      } : null,
      link: artifact ? {
        href: artifact.path,
        label: userFacingEvidenceText(artifact.label || artifact.path),
      } : null,
    }
  })
  const timelineStages = new Set(timelineItems.map((item) => item.stage))
  const lifecycleItems = report.phaseLifecycle
    .filter((item) => !timelineStages.has(item.stage))
    .map((item, index) => buildPhaseLifecycleTimelineItem(item, timelineItems.length + index, generatedAt + timelineItems.length + index, report))
  return [...timelineItems, ...lifecycleItems]
}

function buildScmView(summary: AgentEvidenceWorkbenchSummary, report: AgentEvidenceReportContract): AgentEvidenceScmView {
  const providerOwnerEvidence = buildScmOwnerEvidence("provider", "", { connected: true })
  const groupOwnerEvidence = buildScmOwnerEvidence("resourceGroup", "", { groupId: "agentEvidenceChanges", connected: true })
  const resources = uniqueStrings(summary.scm.files || []).map((file) => ({
    uri: file,
    resourceUri: file,
    status: "modified" as const,
    contextValue: `agentEvidence.scm.modified.${summary.scm.rollbackAvailable ? "rollbackCovered" : "rollbackMissing"}`,
    openCommandId: AGENT_EVIDENCE_COMMAND_IDS.OpenResource,
    diffCommandId: AGENT_EVIDENCE_COMMAND_IDS.DiffResource,
    stageCommandId: AGENT_EVIDENCE_COMMAND_IDS.StageResource,
    discardCommandId: AGENT_EVIDENCE_COMMAND_IDS.DiscardResource,
    attachCommandId: AGENT_EVIDENCE_COMMAND_IDS.AttachResource,
    rollbackRiskLabel: summary.scm.rollbackAvailable ? "已覆盖" : "需复核",
    readonlyEvidence: true as const,
    gitIndexMutation: false as const,
    ownerEvidence: buildScmOwnerEvidence("resource", file, { groupId: "agentEvidenceChanges", connected: true }),
    decorations: {
      tooltip: `智能体证据变更文件 · 回滚${summary.scm.rollbackAvailable ? "已覆盖" : "需复核"}`,
      strikeThrough: false,
    },
  }))
  return {
    providerLabel: "Codek 智能体证据",
    providerId: "agentEvidence",
    ownerEvidence: providerOwnerEvidence,
    summary: `${resources.length} 个文件 · 主工作区保护 ${summary.scm.mainWorkspaceProtected ? "是" : "否"} · 回滚 ${summary.scm.rollbackAvailable ? "可用" : "缺失"}`,
    resourceGroups: [{
      id: "agentEvidenceChanges",
      label: "智能体拟议变更",
      ownerEvidence: groupOwnerEvidence,
      resources,
    }],
    rollbackRisk: {
      rollbackAvailable: summary.scm.rollbackAvailable === true,
      mainWorkspaceProtected: summary.scm.mainWorkspaceProtected === true,
      pendingBatchBlocked: summary.scm.pendingBatchBlocked === true,
      pendingHunkBlocked: summary.scm.pendingHunkBlocked === true,
      reviewDisplayBlocked: summary.scm.reviewDisplayBlocked === true,
    },
    failureCauses: report.failureCauses.filter((item) => item.stage === "workspace-diff" || item.stage === "rollback"),
    nextActions: report.nextActions.filter((item) => item.surface === "scm"),
  }
}

function buildPhaseLifecycleTimelineItem(
  phase: AgentEvidencePhaseLifecycleItem,
  index: number,
  timestamp: number,
  report: AgentEvidenceReportContract,
): AgentEvidenceTimelineItem {
  const commandId = commandForStage(phase.stage)
  const projectionIds = projectionIdsForStage(report, phase.stage)
  return {
    handle: `${phase.stage}:${index}`,
    source: "agentEvidence",
    label: userFacingEvidenceText(phase.phaseName || phase.stage),
    description: phaseLifecycleDescription(phase),
    timestamp,
    stage: phase.stage,
    status: phase.status,
    contextValue: `agentEvidence.${phase.status}`,
    commandId,
    evidenceRefs: phase.evidenceRefs,
    nextAction: userFacingEvidenceText(phase.failureRecovery.action || phase.validation.detail || ""),
    correlationId: report.correlationId,
    failureCauseIds: report.failureCauses.filter((item) => item.stage === phase.stage).map((item) => item.id),
    nextActionIds: report.nextActions.filter((item) => item.stage === phase.stage).map((item) => item.id),
    projectionIds,
    threadId: phase.threadId,
    validationResult: phase.validation.result,
    failureRecoveryStatus: phase.failureRecovery.status,
    command: {
      id: commandId,
      title: commandTitleForStage(phase.stage),
      arguments: [
        { key: "stage", value: phase.stage },
        { key: "threadId", value: phase.threadId },
        { key: "correlationId", value: report.correlationId },
      ],
    },
    resource: null,
    link: null,
  }
}

function buildTestingView(summary: AgentEvidenceWorkbenchSummary, report: AgentEvidenceReportContract): AgentEvidenceTestingView {
  const state = resolveTestState(summary)
  const latestTask = summary.testing.latestTask || "智能体证据质量门"
  const testingCommands = report.commands.filter((item) => item.source === "qualityGate" || item.source === "taskRuns")
  const testingFailureCauseIds = report.failureCauses.filter((item) => item.stage === "tests").map((item) => item.id)
  const testingNextActionIds = report.nextActions.filter((item) => item.stage === "tests").map((item) => item.id)
  const projectionIds = projectionIdsForStage(report, "tests")
  return {
    runSummary: {
      total: summary.testing.taskRuns,
      passed: summary.testing.passed,
      failed: summary.testing.failed,
      blocked: summary.testing.blocked,
      running: summary.testing.running,
      skipped: summary.testing.skipped,
      problemDiagnostics: summary.testing.problemDiagnostics,
      qualityGateFailures: summary.testing.qualityGateFailures,
      state,
    },
    items: [{
      id: "agentEvidence.latestTask",
      label: latestTask,
      state,
      detail: `${summary.testing.passed}/${summary.testing.taskRuns} 个任务通过 · 诊断 ${summary.testing.problemDiagnostics} · 质量门 ${summary.testing.qualityGateStatus || "-"}`,
      evidenceRefs: ["taskRuns", "sandboxSecurity"],
      commandIds: testingCommands.map((item) => item.command),
      artifactIds: uniqueStrings(testingCommands.flatMap((item) => item.artifactIds)),
      failureCauseIds: testingFailureCauseIds,
      nextActionIds: testingNextActionIds,
      projectionIds,
      rerunCommandId: "agent.evidence.reviewTests",
      failureDetail: report.failureCauses.find((item) => item.stage === "tests")?.detail || "",
      resourceLinks: resourceLinksForArtifactIds(uniqueStrings(testingCommands.flatMap((item) => item.artifactIds)), report),
    }],
  }
}

function buildProgressItems(summary: AgentEvidenceWorkbenchSummary, report: AgentEvidenceReportContract): AgentEvidenceProgressItem[] {
  const reportProgressByStage = new Map(report.progress.map((item) => [item.stage, item]))
  const progressItems = (summary.timeline || [])
    .filter((stage) => stage.available && !stage.ready)
    .map((stage) => {
      const progress = reportProgressByStage.get(stage.stage)
      const lifecycle = report.phaseLifecycle.find((item) => item.stage === stage.stage)
      const status = progress?.status || stage.status
      return {
        id: `agentEvidence.progress.${stage.stage}`,
        stage: stage.stage,
        title: userFacingEvidenceText(stage.title),
        message: userFacingEvidenceText(progress?.message || stage.nextAction || stage.summary),
        total: progress?.total ?? 1,
        worked: progress?.worked ?? (stage.status === "degraded" ? 0.5 : 0),
        infinite: stage.status === "blocked" && !isTerminalProgressStatus(status),
        location: normalizeProgressLocation(progress?.location, status),
        correlationId: progress?.correlationId || report.correlationId,
        lifecycle: {
          state: progressLifecycleState(status),
          cancellable: progress?.cancellable === true && canCancelProgressStatus(status),
        },
        aggregateStatus: normalizeAggregateStatus(status),
        ariaLabel: userFacingEvidenceText(`${stage.title}: ${progress?.message || stage.nextAction || stage.summary}`),
        cancelCommandId: AGENT_EVIDENCE_COMMAND_IDS.CancelProgress,
        failureCauseIds: report.failureCauses.filter((item) => item.stage === stage.stage).map((item) => item.id),
        nextActionIds: report.nextActions.filter((item) => item.stage === stage.stage).map((item) => item.id),
        threadId: lifecycle?.threadId || "",
        validationResult: lifecycle?.validation.result || "",
        failureRecoveryStatus: lifecycle?.failureRecovery.status || "",
      }
    })
  const progressStages = new Set(progressItems.map((item) => item.stage))
  const lifecycleProgressItems = report.phaseLifecycle
    .filter((phase) => !progressStages.has(phase.stage) && shouldSurfacePhaseLifecycleProgress(phase))
    .map((phase) => buildPhaseLifecycleProgressItem(phase, report))
  return [...progressItems, ...lifecycleProgressItems]
}

function buildPhaseLifecycleProgressItem(
  phase: AgentEvidencePhaseLifecycleItem,
  report: AgentEvidenceReportContract,
): AgentEvidenceProgressItem {
  const status = phase.status
  return {
    id: `agentEvidence.progress.${phase.stage}`,
    stage: phase.stage,
    title: userFacingEvidenceText(phase.phaseName || phase.stage),
    message: phaseLifecycleDescription(phase),
    total: 1,
    worked: phase.status === "completed" || phase.status === "validated-pass" ? 1 : 0,
    infinite: phase.status === "active" || phase.status === "needs-validation",
    location: normalizeProgressLocation(undefined, status),
    correlationId: report.correlationId,
    lifecycle: {
      state: progressLifecycleState(status),
      cancellable: false,
    },
    aggregateStatus: normalizeAggregateStatus(status),
    ariaLabel: userFacingEvidenceText(`${phase.phaseName || phase.stage}: ${phaseLifecycleDescription(phase)}`),
    cancelCommandId: AGENT_EVIDENCE_COMMAND_IDS.CancelProgress,
    failureCauseIds: report.failureCauses.filter((item) => item.stage === phase.stage).map((item) => item.id),
    nextActionIds: report.nextActions.filter((item) => item.stage === phase.stage).map((item) => item.id),
    threadId: phase.threadId,
    validationResult: phase.validation.result,
    failureRecoveryStatus: phase.failureRecovery.status,
  }
}

function buildNotifications(
  summary: AgentEvidenceWorkbenchSummary,
  testing: AgentEvidenceTestingView,
  actions: AgentEvidenceWorkbenchSurface["actions"],
  report: AgentEvidenceReportContract,
): AgentEvidenceNotificationItem[] {
  const notifications: AgentEvidenceNotificationItem[] = []
  for (const notification of report.notifications) {
    const lifecycle = report.phaseLifecycle.find((phase) => phase.stage === notification.focusTarget || phase.id === notification.id)
    notifications.push({
      id: notification.id,
      severity: normalizeSeverity(notification.severity),
      message: userFacingEvidenceText(notification.message),
      source: notification.source || "智能体证据",
      sticky: notification.lifecycle.sticky,
      correlationId: notification.correlationId || report.correlationId,
      lifecycle: notification.lifecycle,
      dedupeKey: dedupeKeyForNotification(notification.id, notification.message),
      dismissCommandId: AGENT_EVIDENCE_COMMAND_IDS.DismissNotification,
      focusTarget: notification.focusTarget || "notifications",
      ariaLabel: userFacingEvidenceText(`${normalizeSeverity(notification.severity)}: ${notification.message}`),
      actions: normalizeNotificationActions(notification.actions, actions),
      threadId: lifecycle?.threadId || "",
      validationResult: lifecycle?.validation.result || "",
      failureRecoveryStatus: lifecycle?.failureRecovery.status || "",
    })
  }
  for (const phase of report.phaseLifecycle) {
    if (!shouldNotifyForPhaseLifecycle(phase)) continue
    pushUniqueNotification(notifications, {
      id: `agentEvidence.phase.${phase.stage}`,
      severity: severityForPhaseLifecycle(phase),
      message: userFacingEvidenceText(`${phase.phaseName || phase.stage}: ${phaseLifecycleDescription(phase)}`),
      source: "智能体证据",
      sticky: phase.status === "systemError" || phase.status === "blocked" || phase.status === "validated-fail",
      correlationId: report.correlationId,
      lifecycle: defaultNotificationLifecycle(severityForPhaseLifecycle(phase), phase.updatedAt, phase.status !== "needs-validation"),
      actions: pickActions(actions, surfaceForStage(phase.stage)),
      threadId: phase.threadId,
      validationResult: phase.validation.result,
      failureRecoveryStatus: phase.failureRecovery.status,
    })
  }
  if (summary.failure.blockingGaps > 0 || summary.failure.highGaps > 0) {
    const gap = summary.failure.latestBlockingGap
    pushUniqueNotification(notifications, {
      id: "agentEvidence.failure",
      severity: "error",
      message: gap ? userFacingEvidenceText(`${gap.title}: ${gap.status}`) : `${summary.failure.blockingGaps} 个阻断缺口`,
      source: "智能体证据",
      sticky: true,
      correlationId: report.correlationId,
      lifecycle: defaultNotificationLifecycle("error", report.timestamp),
      actions: pickActions(actions, "timeline", "progress"),
      threadId: "",
      validationResult: "",
      failureRecoveryStatus: "",
    })
  }
  if (testing.runSummary.failed > 0 || testing.runSummary.qualityGateFailures > 0) {
    pushUniqueNotification(notifications, {
      id: "agentEvidence.testing",
      severity: "error",
      message: `${summary.testing.latestTask || "测试与质量门"} 需要处理：失败 ${testing.runSummary.failed}，质量门失败 ${testing.runSummary.qualityGateFailures}`,
      source: "智能体证据",
      sticky: true,
      correlationId: report.correlationId,
      lifecycle: defaultNotificationLifecycle("error", report.timestamp),
      actions: pickActions(actions, "testing"),
      threadId: "",
      validationResult: "",
      failureRecoveryStatus: "",
    })
  }
  if (!summary.rollback.rollbackAvailable || !summary.scm.rollbackAvailable) {
    pushUniqueNotification(notifications, {
      id: "agentEvidence.rollback",
      severity: "warning",
      message: "回滚证据缺失或不可用，交付前需要补齐 rollback 快照和风险说明。",
      source: "智能体证据",
      sticky: true,
      correlationId: report.correlationId,
      lifecycle: defaultNotificationLifecycle("warning", report.timestamp),
      actions: pickActions(actions, "scm"),
      threadId: "",
      validationResult: "",
      failureRecoveryStatus: "",
    })
  }
  if (!summary.ready && notifications.length === 0) {
    pushUniqueNotification(notifications, {
      id: "agentEvidence.degraded",
      severity: "warning",
      message: userFacingEvidenceText(summary.statusLabel) || "智能体证据工作台尚未全部就绪。",
      source: "智能体证据",
      sticky: false,
      correlationId: report.correlationId,
      lifecycle: defaultNotificationLifecycle("warning", report.timestamp, false),
      actions: pickActions(actions, "timeline"),
      threadId: "",
      validationResult: "",
      failureRecoveryStatus: "",
    })
  }
  return notifications
}

function buildEvidenceList(
  views: AgentEvidenceWorkbenchSurface["views"],
  report: AgentEvidenceReportContract,
): AgentEvidenceWorkbenchList {
  const items: AgentEvidenceWorkbenchListItem[] = [
    ...views.timeline.items.map((item) => buildTimelineEvidenceListItem(item, report)),
    ...views.scm.resourceGroups.flatMap((group) => group.resources.map((item) => buildScmEvidenceListItem(item, group.label, report))),
    ...views.testing.items.map((item) => buildTestingEvidenceListItem(item, report)),
    ...views.progress.items.map((item) => buildProgressEvidenceListItem(item, report)),
    ...views.notifications.items.map((item) => buildNotificationEvidenceListItem(item, report)),
  ]
  const surfaces: AgentEvidenceSurfaceKind[] = ["timeline", "scm", "testing", "progress", "notifications"]
  const statuses = uniqueStrings(items.map((item) => item.status))
  const severities = uniqueSeverities(items.map((item) => item.severity))
  const bySurface = surfaces.reduce((result, surface) => {
    result[surface] = items.filter((item) => item.surface === surface)
    return result
  }, {} as Record<AgentEvidenceSurfaceKind, AgentEvidenceWorkbenchListItem[]>)
  const byStatus = groupEvidenceItemsBy(items, (item) => item.status)
  const bySeverity = {
    info: items.filter((item) => item.severity === "info"),
    warning: items.filter((item) => item.severity === "warning"),
    error: items.filter((item) => item.severity === "error"),
  }
  return {
    items,
    filters: {
      surfaces,
      statuses,
      severities,
    },
    counts: {
      total: items.length,
      timeline: bySurface.timeline.length,
      scm: bySurface.scm.length,
      testing: bySurface.testing.length,
      progress: bySurface.progress.length,
      notifications: bySurface.notifications.length,
      errors: bySeverity.error.length,
      warnings: bySeverity.warning.length,
    },
    filtered: {
      all: items,
      bySurface,
      byStatus,
      bySeverity,
      blocked: items.filter((item) => item.status === "blocked"),
      errors: bySeverity.error,
      warnings: bySeverity.warning,
      query: {
        "typecheck output": filterAgentEvidenceItems(items, { query: "typecheck output" }),
        "src/search.ts": filterAgentEvidenceItems(items, { query: "src/search.ts" }),
      },
    },
  }
}

function buildTimelineEvidenceListItem(
  item: AgentEvidenceTimelineItem,
  report: AgentEvidenceReportContract,
): AgentEvidenceWorkbenchListItem {
  const artifactIds = artifactIdsForTimelineItem(item, report)
  const severity = severityForStatus(item.status, item.failureCauseIds, report)
  return normalizeEvidenceListItem({
    id: `timeline:${item.handle}`,
    surface: "timeline",
    stage: item.stage,
    label: item.label,
    description: item.description || item.nextAction,
    status: item.status,
    severity,
    source: item.source,
    commandId: item.command.id,
    resourceUri: item.resource?.uri || item.link?.href || "",
    artifactIds,
    failureCauseIds: item.failureCauseIds,
    nextActionIds: item.nextActionIds,
    threadId: item.threadId,
    validationResult: item.validationResult,
    failureRecoveryStatus: item.failureRecoveryStatus,
    correlationId: item.correlationId,
    detail: item.link?.label || item.description || item.nextAction,
  })
}

function buildScmEvidenceListItem(
  item: AgentEvidenceScmResource,
  groupLabel: string,
  report: AgentEvidenceReportContract,
): AgentEvidenceWorkbenchListItem {
  const failureCauseIds = report.failureCauses
    .filter((cause) => cause.stage === "workspace-diff" || cause.stage === "rollback")
    .map((cause) => cause.id)
  const nextActionIds = report.nextActions
    .filter((action) => action.surface === "scm")
    .map((action) => action.id)
  return normalizeEvidenceListItem({
    id: `scm:${item.resourceUri}`,
    surface: "scm",
    stage: "workspace-diff",
    label: item.resourceUri,
    description: `${groupLabel} · rollback ${item.rollbackRiskLabel}`,
    status: item.status,
    severity: item.rollbackRiskLabel === "需复核" ? "warning" : "info",
    source: "agentEvidence.scm",
    commandId: item.openCommandId,
    resourceUri: item.resourceUri,
    artifactIds: [],
    failureCauseIds,
    nextActionIds,
    threadId: "",
    validationResult: "",
    failureRecoveryStatus: "",
    correlationId: report.correlationId,
    detail: item.decorations.tooltip,
  })
}

function buildTestingEvidenceListItem(
  item: AgentEvidenceTestingView["items"][number],
  report: AgentEvidenceReportContract,
): AgentEvidenceWorkbenchListItem {
  return normalizeEvidenceListItem({
    id: `testing:${item.id}`,
    surface: "testing",
    stage: "tests",
    label: item.label,
    description: item.detail,
    status: item.state,
    severity: severityForStatus(item.state, item.failureCauseIds, report),
    source: "agentEvidence.testing",
    commandId: item.rerunCommandId,
    resourceUri: item.resourceLinks[0]?.uri || "",
    artifactIds: uniqueStrings([...item.artifactIds, ...artifactIdsForProjectionIds(item.projectionIds, report)]),
    failureCauseIds: item.failureCauseIds,
    nextActionIds: item.nextActionIds,
    threadId: "",
    validationResult: "",
    failureRecoveryStatus: "",
    correlationId: report.correlationId,
    detail: [
      item.failureDetail,
      item.detail,
      item.resourceLinks.map((link) => `${link.label} ${link.uri}`).join(", "),
      projectionSearchText(item.projectionIds),
    ]
      .map(sanitizeString)
      .filter(Boolean)
      .join(" · "),
  })
}

function buildProgressEvidenceListItem(
  item: AgentEvidenceProgressItem,
  report: AgentEvidenceReportContract,
): AgentEvidenceWorkbenchListItem {
  return normalizeEvidenceListItem({
    id: `progress:${item.id}`,
    surface: "progress",
    stage: item.stage,
    label: item.title,
    description: item.message,
    status: item.aggregateStatus,
    severity: severityForStatus(item.aggregateStatus, item.failureCauseIds, report),
    source: "agentEvidence.progress",
    commandId: item.cancelCommandId,
    resourceUri: "",
    artifactIds: [],
    failureCauseIds: item.failureCauseIds,
    nextActionIds: item.nextActionIds,
    threadId: item.threadId,
    validationResult: item.validationResult,
    failureRecoveryStatus: item.failureRecoveryStatus,
    correlationId: item.correlationId,
    detail: item.ariaLabel,
  })
}

function buildNotificationEvidenceListItem(
  item: AgentEvidenceNotificationItem,
  report: AgentEvidenceReportContract,
): AgentEvidenceWorkbenchListItem {
  return normalizeEvidenceListItem({
    id: `notifications:${item.id}`,
    surface: "notifications",
    stage: item.focusTarget === "notifications" ? "failure-diagnostics" : item.focusTarget,
    label: item.message,
    description: item.actions.map((action) => action.label).join(", "),
    status: item.lifecycle.state,
    severity: item.severity,
    source: item.source,
    commandId: item.dismissCommandId,
    resourceUri: "",
    artifactIds: [],
    failureCauseIds: report.failureCauses.filter((cause) => cause.severity === item.severity).map((cause) => cause.id),
    nextActionIds: item.actions.map((action) => action.id),
    threadId: item.threadId,
    validationResult: item.validationResult,
    failureRecoveryStatus: item.failureRecoveryStatus,
    correlationId: item.correlationId,
    detail: item.ariaLabel,
  })
}

function normalizeEvidenceListItem(
  item: Omit<AgentEvidenceWorkbenchListItem, "searchText">,
): AgentEvidenceWorkbenchListItem {
  const normalized = {
    ...item,
    id: sanitizeString(item.id),
    stage: sanitizeString(item.stage),
    label: sanitizeString(item.label),
    description: sanitizeString(item.description),
    status: normalizeAggregateStatus(item.status),
    severity: normalizeSeverity(item.severity),
    source: sanitizeString(item.source),
    commandId: sanitizeString(item.commandId),
    resourceUri: sanitizeString(item.resourceUri),
    artifactIds: uniqueStrings(item.artifactIds || []),
    failureCauseIds: uniqueStrings(item.failureCauseIds || []),
    nextActionIds: uniqueStrings(item.nextActionIds || []),
    threadId: sanitizeString(item.threadId),
    validationResult: sanitizeString(item.validationResult),
    failureRecoveryStatus: sanitizeString(item.failureRecoveryStatus),
    correlationId: sanitizeString(item.correlationId),
    detail: sanitizeString(item.detail),
  }
  return {
    ...normalized,
    searchText: [
      normalized.id,
      normalized.surface,
      normalized.stage,
      normalized.label,
      normalized.description,
      normalized.status,
      normalized.severity,
      normalized.source,
      normalized.commandId,
      normalized.resourceUri,
      normalized.artifactIds.join(" "),
      normalized.failureCauseIds.join(" "),
      normalized.nextActionIds.join(" "),
      normalized.threadId,
      normalized.validationResult,
      normalized.failureRecoveryStatus,
      normalized.detail,
    ].join(" ").toLowerCase(),
  }
}

function filterAgentEvidenceItems(
  items: AgentEvidenceWorkbenchListItem[],
  filter: AgentEvidenceWorkbenchFilter = {},
): AgentEvidenceWorkbenchListItem[] {
  const status = sanitizeString(filter.status).toLowerCase()
  const query = sanitizeString(filter.query).toLowerCase()
  return items.filter((item) => {
    if (filter.surface && item.surface !== filter.surface) return false
    if (status && item.status.toLowerCase() !== status) return false
    if (filter.severity && item.severity !== filter.severity) return false
    if (query && !item.searchText.includes(query)) return false
    return true
  })
}

function buildEvidenceDetail(
  items: AgentEvidenceWorkbenchListItem[],
  exportDescriptor: AgentEvidenceWorkbenchExportDescriptor,
  selectedId?: string,
): AgentEvidenceWorkbenchDetail {
  const item = selectEvidenceDetailItem(items, selectedId)
  const surface = item?.surface || "timeline"
  const stableId = sanitizeString(item?.id || selectedId || "empty")
  const detailKey = stableId.replace(new RegExp(`^${surface}:`), "")
  const editorKey = detailKey.replace(/[^A-Za-z0-9_.-]+/g, "-")
  return {
    selectedId: item?.id || "",
    item,
    editor: {
      id: `agentEvidence.detail.${surface}.${editorKey || "empty"}`,
      title: item?.label || "智能体证据详情",
      resourceUri: `agent-evidence://${surface}/${encodeURIComponent(detailKey || "empty")}`,
      readonly: true,
      languageId: "markdown",
      commandId: AGENT_EVIDENCE_COMMAND_IDS.OpenDetail,
    },
    export: exportDescriptor,
  }
}

function selectEvidenceDetailItem(
  items: AgentEvidenceWorkbenchListItem[],
  selectedId?: string,
): AgentEvidenceWorkbenchListItem | null {
  if (!items.length) return null
  if (selectedId) return items.find((item) => item.id === selectedId) || items[0]
  return items.find((item) => item.surface === "notifications" && item.severity === "error")
    || items.find((item) => item.surface === "testing" && item.severity === "error")
    || items.find((item) => item.severity === "error")
    || items.find((item) => item.surface === "notifications" && item.severity === "warning")
    || items.find((item) => item.surface === "testing" && item.severity === "warning")
    || items.find((item) => item.severity === "warning")
    || items[0]
}

function buildEvidenceExportDescriptor(
  report: AgentEvidenceReportContract,
  evidenceCount: number,
): AgentEvidenceWorkbenchExportDescriptor {
  const snapshot = report.projections.exportSnapshot
  return {
    jsonCommandId: AGENT_EVIDENCE_COMMAND_IDS.ExportJson,
    markdownCommandId: AGENT_EVIDENCE_COMMAND_IDS.ExportMarkdown,
    artifactPath: snapshot.path || ".codek/reports/agent-evidence-workbench-latest.json",
    markdownPath: snapshot.markdownPath || ".codek/reports/agent-evidence-workbench-latest.md",
    correlationId: report.correlationId,
    evidenceCount,
    snapshotId: snapshot.id,
    redacted: snapshot.redacted,
    includes: snapshot.includes,
  }
}

function groupEvidenceItemsBy(
  items: AgentEvidenceWorkbenchListItem[],
  selector: (item: AgentEvidenceWorkbenchListItem) => string,
): Record<string, AgentEvidenceWorkbenchListItem[]> {
  const result: Record<string, AgentEvidenceWorkbenchListItem[]> = {}
  for (const item of items) {
    const key = sanitizeString(selector(item))
    if (!key) continue
    if (!result[key]) result[key] = []
    result[key].push(item)
  }
  return result
}

function artifactIdsForTimelineItem(item: AgentEvidenceTimelineItem, report: AgentEvidenceReportContract): string[] {
  if (!item.resource?.uri && !item.link?.href) return []
  const uri = item.resource?.uri || item.link?.href || ""
  return uniqueStrings([
    ...report.artifacts.filter((artifact) => artifact.path === uri).map((artifact) => artifact.id),
    ...artifactIdsForProjectionIds(item.projectionIds, report),
  ])
}

function artifactIdsForProjectionIds(ids: AgentEvidenceProjectionIds, report: AgentEvidenceReportContract): string[] {
  const outputIds = new Set(ids.outputProjectionIds)
  const taskIds = new Set(ids.taskRunIds)
  return uniqueStrings([
    ...report.projections.outputs.filter((item) => outputIds.has(item.id)).flatMap((item) => item.artifactIds),
    ...report.projections.taskRuns.filter((item) => taskIds.has(item.id)).flatMap((item) => item.artifactIds),
  ])
}

function projectionSearchText(ids: AgentEvidenceProjectionIds): string {
  return [
    ...ids.taskRunIds,
    ...ids.outputProjectionIds,
    ...ids.problemProjectionIds,
    ...ids.debugProjectionIds,
    ...ids.failureDiagnosisIds,
    ...ids.approvalBoundaryIds,
  ].join(" ")
}

function severityForStatus(
  status: string,
  failureCauseIds: string[],
  report: AgentEvidenceReportContract,
): AgentEvidenceSeverity {
  const explicit = report.failureCauses.find((cause) => failureCauseIds.includes(cause.id))
  if (explicit) return normalizeSeverity(explicit.severity)
  const normalized = normalizeAggregateStatus(status)
  if (normalized === "failed" || normalized === "blocked") return "error"
  if (normalized === "degraded" || normalized === "missing" || normalized === "cancelled") return "warning"
  return "info"
}

function uniqueSeverities(values: AgentEvidenceSeverity[]): AgentEvidenceSeverity[] {
  const order: AgentEvidenceSeverity[] = ["info", "warning", "error"]
  const present = new Set(values)
  return order.filter((severity) => present.has(severity))
}

function buildSurfaceActions(summary: AgentEvidenceWorkbenchSummary): AgentEvidenceWorkbenchSurface["actions"] {
  const actions: AgentEvidenceWorkbenchSurface["actions"] = [
    {
      id: "agent.evidence.openTimeline",
      label: "打开证据时间线",
      surface: "timeline",
      enabled: summary.available === true,
      detail: "查看计划、执行、测试、真实 UI、审批和回滚阶段。",
    },
    {
      id: "agent.evidence.openScm",
      label: "查看变更和回滚风险",
      surface: "scm",
      enabled: summary.scm.fileCount > 0 || summary.scm.rollbackAvailable || summary.rollback.operationLogVisible,
      detail: "按 SCM 资源组查看智能体修改文件和回滚保护。",
    },
    {
      id: "agent.evidence.stageResource",
      label: "记录暂存意图",
      surface: "scm",
      enabled: false,
      detail: "只读证据动作；不调用 Git，不写暂存区，不创建第二套 SCM 状态。",
    },
    {
      id: "agent.evidence.reviewTests",
      label: "复核测试与质量门",
      surface: "testing",
      enabled: summary.testing.taskRuns > 0 || summary.testing.qualityGateFailures > 0,
      detail: "查看任务运行、诊断、质量门失败和保存拒绝。",
    },
  ]
  if ((summary.timeline || []).some((stage) => stage.stage === "real-ui" && !stage.ready)) {
    actions.push({
      id: "agent.evidence.importManualUiEvidence",
      label: "导入真实 UI 证据",
      surface: "progress",
      enabled: true,
      detail: "补齐人工手感、截图和真实 UI 验收证据。",
    })
  }
  if (!summary.rollback.rollbackAvailable || !summary.scm.rollbackAvailable) {
    actions.push({
      id: "agent.evidence.reviewRollback",
      label: "复核回滚风险",
      surface: "scm",
      enabled: true,
      detail: "确认可回滚快照、主工作区保护和漂移阻断。",
    })
  }
  return actions
}

function resolveTestState(summary: AgentEvidenceWorkbenchSummary): AgentEvidenceTestState {
  if (summary.testing.running > 0) return "running"
  if (summary.testing.failed > 0 || summary.testing.qualityGateFailures > 0) return "failed"
  if (summary.testing.blocked > 0) return "blocked"
  if (summary.testing.skipped > 0 && summary.testing.passed === 0) return "skipped"
  if (summary.testing.taskRuns > 0 && summary.testing.passed === summary.testing.taskRuns) return "passed"
  return "unknown"
}

function commandForStage(stage: string): string {
  if (stage === "tests") return AGENT_EVIDENCE_COMMAND_IDS.OpenTesting
  if (stage === "workspace-diff" || stage === "rollback") return AGENT_EVIDENCE_COMMAND_IDS.OpenScm
  if (stage === "approval" || stage === "failure-diagnostics") return AGENT_EVIDENCE_COMMAND_IDS.OpenNotifications
  return AGENT_EVIDENCE_COMMAND_IDS.OpenTimeline
}

function pickActions(
  actions: AgentEvidenceWorkbenchSurface["actions"],
  ...surfaces: AgentEvidenceSurfaceKind[]
): AgentEvidenceNotificationItem["actions"] {
  const wanted = new Set(surfaces)
  return actions
    .filter((action) => action.enabled && wanted.has(action.surface))
    .slice(0, 2)
    .map((action) => ({ id: action.id, label: action.label, surface: action.surface }))
}

function findArtifactForStage(stage: string, report: AgentEvidenceReportContract): AgentEvidenceArtifact | null {
  const stageSource = sourceForEvidenceId(stage)
  const bySource = report.artifacts.find((artifact) => artifact.source === stageSource)
  if (bySource) return bySource
  if (stage === "tests") {
    const artifactIds = new Set(report.commands
      .filter((command) => command.source === "qualityGate" || command.source === "taskRuns")
      .flatMap((command) => command.artifactIds))
    return report.artifacts.find((artifact) => artifactIds.has(artifact.id)) || null
  }
  if (stage === "real-ui") return report.artifacts.find((artifact) => artifact.source === "workbenchRealProjectUi" || artifact.source === "manualRealUiEvidence") || null
  if (stage === "workspace-diff" || stage === "rollback") return report.artifacts.find((artifact) => artifact.source === "realWorkspaceTrial" || artifact.source === "agentChangeSafety") || null
  if (stage === "approval") return report.artifacts.find((artifact) => artifact.source === "sandboxSecurity") || null
  return report.artifacts[0] || null
}

function resourceLinksForArtifactIds(artifactIds: string[], report: AgentEvidenceReportContract): Array<{ uri: string; label: string; source: string }> {
  const wanted = new Set(artifactIds)
  return report.artifacts
    .filter((artifact) => wanted.has(artifact.id))
    .map((artifact) => ({ uri: artifact.path, label: artifact.label || artifact.path, source: artifact.source }))
}

function commandTitleForStage(stage: string): string {
  if (stage === "tests") return "打开智能体测试证据"
  if (stage === "workspace-diff" || stage === "rollback") return "打开智能体变更证据"
  if (stage === "approval" || stage === "failure-diagnostics") return "打开智能体证据通知"
  return "打开智能体证据时间线"
}

function normalizePhaseStatus(status: string | undefined, fallback: AgentEvidencePhaseStatus = "active"): AgentEvidencePhaseStatus {
  const raw = sanitizeString(status)
  if ((AGENT_EVIDENCE_PHASE_STATUSES as string[]).includes(raw)) return raw as AgentEvidencePhaseStatus
  const normalized = raw.toLowerCase().replace(/_/g, "-")
  if (normalized === "running" || normalized === "started" || normalized === "in-progress" || normalized === "pending") return "active"
  if (normalized === "done" || normalized === "complete" || normalized === "completed" || normalized === "success" || normalized === "succeeded") return "completed"
  if (normalized === "error" || normalized === "failed" || normalized === "failure" || normalized === "crashed" || normalized === "system-error") return "systemError"
  if (normalized === "blocked" || normalized === "waiting-user" || normalized === "waiting-for-user") return "blocked"
  if (normalized === "needs-validation" || normalized === "validation-needed" || normalized === "validating") return "needs-validation"
  if (normalized === "validated-pass" || normalized === "validation-pass" || normalized === "validation-passed" || normalized === "passed") return "validated-pass"
  if (normalized === "validated-fail" || normalized === "validation-fail" || normalized === "validation-failed") return "validated-fail"
  if (normalized === "superseded" || normalized === "cancelled" || normalized === "canceled" || normalized === "skipped") return "superseded"
  return fallback
}

function normalizeAggregateStatus(status: string | undefined): string {
  const normalized = sanitizeString(status).toLowerCase()
  if (!normalized) return "unknown"
  if (normalized === "systemerror" || normalized === "system-error") return "systemError"
  if (normalized === "needs-validation" || normalized === "validated-pass" || normalized === "validated-fail" || normalized === "superseded" || normalized === "active") return normalized
  if (normalized === "completed" || normalized === "complete" || normalized === "success" || normalized === "succeeded") return "done"
  if (normalized === "canceled") return "cancelled"
  if (normalized === "failure" || normalized === "error") return "failed"
  return normalized
}

function dedupeKeyForNotification(id: string, message: string): string {
  const raw = sanitizeString(id || message)
    .replace(/^notification:/, "")
    .replace(/^agentEvidence\./, "")
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `agentEvidence.notification.${raw || "message"}`
}

function normalizeFailureCauses(values: AgentEvidenceWorkbenchReport["failureCauses"] | undefined): AgentEvidenceFailureCause[] {
  return Array.isArray(values)
    ? values.map((item) => ({
      id: sanitizeString(item.id),
      severity: normalizeSeverity(item.severity),
      title: userFacingEvidenceText(item.title || item.id),
      detail: userFacingEvidenceText(item.detail),
      source: userFacingEvidenceText(item.source),
      stage: sanitizeString(item.stage || stageForEvidenceId(item.id)),
    })).filter((item) => item.id)
    : []
}

function normalizeNextActions(values: AgentEvidenceWorkbenchReport["nextActions"] | undefined): AgentEvidenceNextAction[] {
  return Array.isArray(values)
    ? values.map((item) => ({
      id: sanitizeString(item.id),
      label: userFacingEvidenceText(item.label || item.id),
      surface: normalizeSurfaceKind(item.surface, surfaceForStage(item.stage)),
      stage: sanitizeString(item.stage || stageForEvidenceId(item.id)),
      priority: sanitizeString(item.priority || "normal"),
      commandId: sanitizeString(item.commandId || commandForStage(item.stage)),
    })).filter((item) => item.id)
    : []
}

function normalizeArtifacts(values: AgentEvidenceWorkbenchReport["artifacts"] | undefined): AgentEvidenceArtifact[] {
  return Array.isArray(values)
    ? values.map((item) => ({
      id: sanitizeString(item.id),
      kind: sanitizeString(item.kind),
      label: userFacingEvidenceText(item.label || item.path),
      path: sanitizeString(item.path),
      source: sanitizeString(item.source),
    })).filter((item) => item.id && item.path)
    : []
}

function normalizeProjectionContract(
  value: AgentEvidenceWorkbenchReport["projections"] | undefined,
  summary: AgentEvidenceWorkbenchSummary,
  correlationId: string,
  artifacts: AgentEvidenceArtifact[],
): AgentEvidenceProjectionContract {
  const taskRuns = normalizeTaskRunProjections(value?.taskRuns)
  const outputs = normalizeOutputProjections(value?.outputs)
  const problems = normalizeProblemProjections(value?.problems)
  const debug = normalizeDebugProjections(value?.debug)
  const approvalBoundaries = normalizeApprovalBoundaryProjections(value?.approvalBoundaries)
  const fallback = deriveProjectionContract(summary, correlationId, artifacts)
  const contract: AgentEvidenceProjectionContract = {
    taskRuns: taskRuns.length ? taskRuns : fallback.taskRuns,
    outputs: outputs.length ? outputs : fallback.outputs,
    problems: problems.length ? problems : fallback.problems,
    debug: debug.length ? debug : fallback.debug,
    approvalBoundaries: approvalBoundaries.length ? approvalBoundaries : fallback.approvalBoundaries,
    failureDiagnosis: [],
    exportSnapshot: normalizeExportSnapshotProjection(value?.exportSnapshot, fallback.exportSnapshot),
  }
  const failureDiagnosis = normalizeFailureDiagnosisProjections(value?.failureDiagnosis)
  contract.failureDiagnosis = failureDiagnosis.length ? failureDiagnosis : deriveFailureDiagnosisProjections(summary, contract)
  return contract
}

function deriveProjectionContract(
  summary: AgentEvidenceWorkbenchSummary,
  _correlationId: string,
  artifacts: AgentEvidenceArtifact[],
): AgentEvidenceProjectionContract {
  const command = summary.testing.latestTask
  const hasTask = Boolean(command)
  const outputId = "output:tasks"
  const problemId = "problems:task-run"
  const taskId = "task:latest"
  const artifactIds = artifacts
    .filter((artifact) => artifact.source === "taskRuns" || artifact.source === "qualityGate")
    .map((artifact) => artifact.id)
  const taskRuns: AgentEvidenceTaskRunProjection[] = hasTask ? [{
    id: taskId,
    stage: "tests",
    name: command,
    status: summary.testing.failed > 0 || summary.testing.qualityGateFailures > 0 ? "failed" : "passed",
    command,
    exitCode: null,
    durationMs: null,
    outputProjectionIds: [outputId],
    problemProjectionIds: summary.testing.problemDiagnostics > 0 ? [problemId] : [],
    artifactIds,
    rerunCommandId: AGENT_EVIDENCE_COMMAND_IDS.ReviewTests,
  }] : []
  const outputs: AgentEvidenceOutputProjection[] = hasTask ? [{
    id: outputId,
    stage: "tests",
    channelName: "Tasks",
    source: "outputLogTelemetryService",
    status: summary.testing.failed > 0 || summary.testing.qualityGateFailures > 0 ? "failed" : "passed",
    entryCount: summary.testing.qualityGateCommands || summary.testing.taskRuns,
    warnCount: 0,
    errorCount: summary.testing.failed + summary.testing.qualityGateFailures,
    preview: command,
    artifactIds,
    commandIds: [command],
  }] : []
  const problems: AgentEvidenceProblemProjection[] = summary.testing.problemDiagnostics > 0 ? [{
    id: problemId,
    stage: "tests",
    source: "problemsDiagnosticsService(globalMarkerService)",
    status: summary.testing.failed > 0 || summary.testing.qualityGateFailures > 0 ? "failed" : "open",
    total: summary.testing.problemDiagnostics,
    errorCount: summary.testing.problemDiagnostics,
    warningCount: 0,
    files: [],
    sourceNames: [],
    outputProjectionIds: hasTask ? [outputId] : [],
    taskRunIds: hasTask ? [taskId] : [],
  }] : []
  const approvalBoundaries: AgentEvidenceApprovalBoundaryProjection[] =
    summary.approval.commandAuthorizationBlocked > 0 || summary.approval.commandAuthorizationNeedsPermission > 0 || summary.approval.permissionApproved !== true
      ? [{
        id: "approval:command-authorization",
        stage: "approval",
        status: summary.approval.permissionStatus || "pending",
        risk: summary.approval.permissionRisk,
        reason: `blocked ${summary.approval.commandAuthorizationBlocked}, needs ${summary.approval.commandAuthorizationNeedsPermission}`,
        commandIds: outputs.flatMap((item) => item.commandIds),
        protected: summary.scm.mainWorkspaceProtected || summary.rollback.mainWorkspaceProtected,
      }]
      : []
  return {
    taskRuns,
    outputs,
    problems,
    debug: [],
    approvalBoundaries,
    failureDiagnosis: [],
    exportSnapshot: defaultExportSnapshotProjection(),
  }
}

function deriveFailureDiagnosisProjections(
  summary: AgentEvidenceWorkbenchSummary,
  projections: AgentEvidenceProjectionContract,
): AgentEvidenceFailureDiagnosisProjection[] {
  const items: AgentEvidenceFailureDiagnosisProjection[] = []
  const add = (cause: AgentEvidenceFailureCause): void => {
    const ids = projectionIdsForStage({ projections } as AgentEvidenceReportContract, cause.stage)
    items.push({
      id: `diagnosis:${cause.id}`,
      stage: cause.stage,
      status: cause.severity === "error" ? "open" : "needs-review",
      title: cause.title,
      detail: cause.detail,
      failureCauseIds: [cause.id],
      nextActionIds: [],
      taskRunIds: ids.taskRunIds,
      outputProjectionIds: ids.outputProjectionIds,
      problemProjectionIds: ids.problemProjectionIds,
      debugProjectionIds: ids.debugProjectionIds,
      approvalBoundaryIds: ids.approvalBoundaryIds,
      workspaceChangeRefs: cause.stage === "workspace-diff" || cause.stage === "rollback" ? uniqueStrings(summary.scm.files || []) : [],
      rerunCommandIds: cause.stage === "tests" ? [AGENT_EVIDENCE_COMMAND_IDS.ReviewTests] : [commandForStage(cause.stage)],
    })
  }
  for (const cause of deriveFailureCauses(summary)) add(cause)
  return items
}

function normalizeTaskRunProjections(values: AgentEvidenceWorkbenchReport["projections"]["taskRuns"] | undefined): AgentEvidenceTaskRunProjection[] {
  return Array.isArray(values)
    ? values.map((item) => ({
      id: sanitizeString(item.id),
      stage: sanitizeString(item.stage || "tests"),
      name: sanitizeString(item.name || item.command || item.id),
      status: sanitizeString(item.status || "unknown"),
      command: sanitizeString(item.command),
      exitCode: typeof item.exitCode === "number" && Number.isFinite(item.exitCode) ? item.exitCode : null,
      durationMs: typeof item.durationMs === "number" && Number.isFinite(item.durationMs) ? item.durationMs : null,
      outputProjectionIds: uniqueStrings(item.outputProjectionIds || []),
      problemProjectionIds: uniqueStrings(item.problemProjectionIds || []),
      artifactIds: uniqueStrings(item.artifactIds || []),
      rerunCommandId: sanitizeString(item.rerunCommandId || AGENT_EVIDENCE_COMMAND_IDS.ReviewTests),
    })).filter((item) => item.id)
    : []
}

function normalizeOutputProjections(values: AgentEvidenceWorkbenchReport["projections"]["outputs"] | undefined): AgentEvidenceOutputProjection[] {
  return Array.isArray(values)
    ? values.map((item) => ({
      id: sanitizeString(item.id),
      stage: sanitizeString(item.stage || "tests"),
      channelName: sanitizeString(item.channelName || "Tasks"),
      source: sanitizeString(item.source || "outputLogTelemetryService"),
      status: sanitizeString(item.status || "unknown"),
      entryCount: toNumber(item.entryCount, 0),
      warnCount: toNumber(item.warnCount, 0),
      errorCount: toNumber(item.errorCount, 0),
      preview: sanitizeString(item.preview),
      artifactIds: uniqueStrings(item.artifactIds || []),
      commandIds: uniqueStrings(item.commandIds || []),
    })).filter((item) => item.id)
    : []
}

function normalizeProblemProjections(values: AgentEvidenceWorkbenchReport["projections"]["problems"] | undefined): AgentEvidenceProblemProjection[] {
  return Array.isArray(values)
    ? values.map((item) => ({
      id: sanitizeString(item.id),
      stage: sanitizeString(item.stage || "tests"),
      source: sanitizeString(item.source || "problemsDiagnosticsService(globalMarkerService)"),
      status: sanitizeString(item.status || "unknown"),
      total: toNumber(item.total, 0),
      errorCount: toNumber(item.errorCount, 0),
      warningCount: toNumber(item.warningCount, 0),
      files: uniqueStrings(item.files || []),
      sourceNames: uniqueStrings(item.sourceNames || []),
      outputProjectionIds: uniqueStrings(item.outputProjectionIds || []),
      taskRunIds: uniqueStrings(item.taskRunIds || []),
    })).filter((item) => item.id)
    : []
}

function normalizeDebugProjections(values: AgentEvidenceWorkbenchReport["projections"]["debug"] | undefined): AgentEvidenceDebugProjection[] {
  return Array.isArray(values)
    ? values.map((item) => ({
      id: sanitizeString(item.id),
      stage: sanitizeString(item.stage || "failure-diagnostics"),
      source: sanitizeString(item.source || "debugState/debugRuntime"),
      status: sanitizeString(item.status || "unknown"),
      sessionId: sanitizeString(item.sessionId),
      activeConfigName: sanitizeString(item.activeConfigName),
      breakpointCount: toNumber(item.breakpointCount, 0),
      consoleEntryCount: toNumber(item.consoleEntryCount, 0),
      outputProjectionIds: uniqueStrings(item.outputProjectionIds || []),
    })).filter((item) => item.id)
    : []
}

function normalizeApprovalBoundaryProjections(values: AgentEvidenceWorkbenchReport["projections"]["approvalBoundaries"] | undefined): AgentEvidenceApprovalBoundaryProjection[] {
  return Array.isArray(values)
    ? values.map((item) => ({
      id: sanitizeString(item.id),
      stage: sanitizeString(item.stage || "approval"),
      status: sanitizeString(item.status || "pending"),
      risk: sanitizeString(item.risk),
      reason: sanitizeString(item.reason),
      commandIds: uniqueStrings(item.commandIds || []),
      protected: item.protected === true,
    })).filter((item) => item.id)
    : []
}

function normalizeFailureDiagnosisProjections(values: AgentEvidenceWorkbenchReport["projections"]["failureDiagnosis"] | undefined): AgentEvidenceFailureDiagnosisProjection[] {
  return Array.isArray(values)
    ? values.map((item) => ({
      id: sanitizeString(item.id),
      stage: sanitizeString(item.stage || stageForEvidenceId(item.id)),
      status: sanitizeString(item.status || "open"),
      title: sanitizeString(item.title || item.id),
      detail: sanitizeString(item.detail),
      failureCauseIds: uniqueStrings(item.failureCauseIds || []),
      nextActionIds: uniqueStrings(item.nextActionIds || []),
      taskRunIds: uniqueStrings(item.taskRunIds || []),
      outputProjectionIds: uniqueStrings(item.outputProjectionIds || []),
      problemProjectionIds: uniqueStrings(item.problemProjectionIds || []),
      debugProjectionIds: uniqueStrings(item.debugProjectionIds || []),
      approvalBoundaryIds: uniqueStrings(item.approvalBoundaryIds || []),
      workspaceChangeRefs: uniqueStrings(item.workspaceChangeRefs || []),
      rerunCommandIds: uniqueStrings(item.rerunCommandIds || []),
    })).filter((item) => item.id)
    : []
}

function normalizeExportSnapshotProjection(
  value: AgentEvidenceWorkbenchReport["projections"]["exportSnapshot"] | undefined,
  fallback: AgentEvidenceExportSnapshotProjection,
): AgentEvidenceExportSnapshotProjection {
  return {
    id: sanitizeString(value?.id || fallback.id),
    path: sanitizeString(value?.path || fallback.path),
    markdownPath: sanitizeString(value?.markdownPath || fallback.markdownPath),
    redacted: value?.redacted !== false,
    includes: uniqueStrings(value?.includes || fallback.includes),
  }
}

function defaultExportSnapshotProjection(): AgentEvidenceExportSnapshotProjection {
  return {
    id: "snapshot:agent-evidence",
    path: ".codek/reports/agent-evidence-workbench-latest.json",
    markdownPath: ".codek/reports/agent-evidence-workbench-latest.md",
    redacted: true,
    includes: ["timeline", "tasks", "output", "problems", "debug", "approval", "failureDiagnosis"],
  }
}

function projectionIdsForStage(report: Pick<AgentEvidenceReportContract, "projections">, stage: string): AgentEvidenceProjectionIds {
  const matchesStage = (item: { stage: string }) => item.stage === stage
  return {
    taskRunIds: report.projections.taskRuns.filter(matchesStage).map((item) => item.id),
    outputProjectionIds: report.projections.outputs.filter(matchesStage).map((item) => item.id),
    problemProjectionIds: report.projections.problems.filter(matchesStage).map((item) => item.id),
    debugProjectionIds: report.projections.debug.filter(matchesStage).map((item) => item.id),
    failureDiagnosisIds: report.projections.failureDiagnosis.filter(matchesStage).map((item) => item.id),
    approvalBoundaryIds: report.projections.approvalBoundaries.filter(matchesStage).map((item) => item.id),
  }
}

function normalizeCommands(
  values: AgentEvidenceWorkbenchReport["commands"] | undefined,
  summary: AgentEvidenceWorkbenchSummary,
  projections: AgentEvidenceProjectionContract,
): AgentEvidenceCommandEvidence[] {
  const commands = Array.isArray(values)
    ? values.map((item) => ({
      command: sanitizeString(item.command),
      source: sanitizeString(item.source || "qualityGate"),
      status: sanitizeString(item.status || "unknown"),
      exitCode: typeof item.exitCode === "number" && Number.isFinite(item.exitCode) ? item.exitCode : null,
      timedOut: item.timedOut === true,
      artifactIds: Array.isArray(item.artifactIds) ? item.artifactIds.map(sanitizeString).filter(Boolean) : [],
      outputProjectionIds: uniqueStrings(item.outputProjectionIds || outputProjectionIdsForCommand(item.command, projections)),
      problemProjectionIds: uniqueStrings(item.problemProjectionIds || problemProjectionIdsForCommand(item.command, projections)),
      taskRunIds: uniqueStrings(item.taskRunIds || taskRunIdsForCommand(item.command, projections)),
    })).filter((item) => item.command)
    : []
  if (commands.length > 0) return commands
  if (!summary.testing.latestTask) return []
  return [{
    command: summary.testing.latestTask,
    source: "taskRuns",
    status: summary.testing.failed > 0 || summary.testing.qualityGateFailures > 0 ? "failed" : "passed",
    exitCode: null,
    timedOut: false,
    artifactIds: projections.taskRuns[0]?.artifactIds || [],
    outputProjectionIds: projections.outputs.map((item) => item.id),
    problemProjectionIds: projections.problems.map((item) => item.id),
    taskRunIds: projections.taskRuns.map((item) => item.id),
  }]
}

function outputProjectionIdsForCommand(command: string, projections: AgentEvidenceProjectionContract): string[] {
  const value = sanitizeString(command)
  return projections.outputs.filter((item) => item.commandIds.includes(value)).map((item) => item.id)
}

function problemProjectionIdsForCommand(command: string, projections: AgentEvidenceProjectionContract): string[] {
  const outputIds = new Set(outputProjectionIdsForCommand(command, projections))
  return projections.problems.filter((item) => item.outputProjectionIds.some((id) => outputIds.has(id))).map((item) => item.id)
}

function taskRunIdsForCommand(command: string, projections: AgentEvidenceProjectionContract): string[] {
  const value = sanitizeString(command)
  return projections.taskRuns.filter((item) => item.command === value).map((item) => item.id)
}

function normalizeProgressItems(
  values: AgentEvidenceWorkbenchReport["progress"] | undefined,
  correlationId: string,
): AgentEvidenceReportContract["progress"] {
  return Array.isArray(values)
    ? values.map((item) => ({
      id: sanitizeString(item.id),
      title: userFacingEvidenceText(item.title),
      message: userFacingEvidenceText(item.message),
      stage: sanitizeString(item.stage),
      status: sanitizeString(item.status),
      correlationId: sanitizeString(item.correlationId || correlationId),
      total: toNumber(item.total, 1),
      worked: toNumber(item.worked, 0),
      location: normalizeProgressLocation(item.location, item.status),
      cancellable: item.cancellable === true,
    })).filter((item) => item.id && item.stage)
    : []
}

function normalizeNotificationItems(
  values: AgentEvidenceWorkbenchReport["notifications"] | undefined,
  correlationId: string,
  generatedAt: number,
): AgentEvidenceReportContract["notifications"] {
  return Array.isArray(values)
    ? values.map((item) => ({
      id: sanitizeString(item.id),
      severity: normalizeSeverity(item.severity),
      message: userFacingEvidenceText(item.message),
      source: userFacingEvidenceText(item.source || "智能体证据"),
      correlationId: sanitizeString(item.correlationId || correlationId),
      lifecycle: {
        state: sanitizeString(item.lifecycle?.state || "active"),
        sticky: item.lifecycle?.sticky === true,
        updatedAt: typeof item.lifecycle?.updatedAt === "number" && Number.isFinite(item.lifecycle.updatedAt) ? item.lifecycle.updatedAt : generatedAt,
        dismissible: item.lifecycle?.dismissible !== false,
      },
      actions: Array.isArray(item.actions)
        ? item.actions.map((action) => ({
          id: sanitizeString(action.id),
          label: userFacingEvidenceText(action.label || action.id),
          surface: normalizeSurfaceKind(action.surface),
        })).filter((action) => action.id)
        : [],
      focusTarget: normalizeSurfaceKind(item.focusTarget, "notifications"),
    })).filter((item) => item.id && item.message)
    : []
}

function normalizeRoleProfiles(
  value: AgentEvidenceWorkbenchReport["roleProfiles"] | undefined,
): AgentEvidenceReportContract["roleProfiles"] {
  const trials = Array.isArray(value?.trials)
    ? value.trials.map((trial) => ({
      id: sanitizeString(trial.id),
      taskId: sanitizeString(trial.taskId),
      runId: sanitizeString(trial.runId),
      assignmentId: sanitizeString(trial.assignmentId),
      role: sanitizeString(trial.role),
      profileId: sanitizeString(trial.profileId),
      profileSource: sanitizeString(trial.profileSource),
      selectionReason: sanitizeString(trial.selectionReason),
      permissionScope: {
        readPaths: Array.isArray(trial.permissionScope?.readPaths) ? trial.permissionScope.readPaths.map(sanitizeString).filter(Boolean) : [],
        writePaths: Array.isArray(trial.permissionScope?.writePaths) ? trial.permissionScope.writePaths.map(sanitizeString).filter(Boolean) : [],
        allowedTools: Array.isArray(trial.permissionScope?.allowedTools) ? trial.permissionScope.allowedTools.map(sanitizeString).filter(Boolean) : [],
        commandAllowlist: Array.isArray(trial.permissionScope?.commandAllowlist) ? trial.permissionScope.commandAllowlist.map(sanitizeString).filter(Boolean) : [],
        network: trial.permissionScope?.network === true,
        install: trial.permissionScope?.install === true,
        externalTool: trial.permissionScope?.externalTool === true,
        destructive: trial.permissionScope?.destructive === true,
      },
      validationAdvice: Array.isArray(trial.validationAdvice) ? trial.validationAdvice.map(sanitizeString).filter(Boolean) : [],
      benefit: sanitizeString(trial.benefit),
      noise: sanitizeString(trial.noise),
      runtimeFit: sanitizeString(trial.runtimeFit),
      worthRuntimeIntegration: trial.worthRuntimeIntegration === true,
      evidenceRefs: Array.isArray(trial.evidenceRefs) ? trial.evidenceRefs.map(sanitizeString).filter(Boolean) : [],
    })).filter((trial) => trial.role || trial.profileId)
    : []
  const requiredTrialCount = toNumber(value?.requiredTrialCount, 2)
  const completeTrials = toNumber(value?.completeTrials, trials.filter((trial) =>
    trial.role && trial.profileId && trial.selectionReason && trial.validationAdvice.length > 0,
  ).length)
  const ready = value?.ready === true || (trials.length >= requiredTrialCount && completeTrials >= requiredTrialCount)
  return {
    available: value?.available === true || trials.length > 0,
    ready,
    status: sanitizeString(value?.status || (trials.length === 0 ? "missing" : ready ? "ready" : "degraded")),
    statusLabel: sanitizeString(value?.statusLabel || (trials.length === 0 ? "暂无角色 profile 试用证据" : `${completeTrials}/${requiredTrialCount} 角色 profile 试用证据`)),
    requiredTrialCount,
    trialCount: toNumber(value?.trialCount, trials.length),
    completeTrials,
    runtimeIntegrationRecommended: value?.runtimeIntegrationRecommended === true,
    recommendation: sanitizeString(value?.recommendation),
    decisionReason: sanitizeString(value?.decisionReason),
    runtimeContract: {
      attachToExistingOrchestratorRun: value?.runtimeContract?.attachToExistingOrchestratorRun !== false,
      attachToAssignment: value?.runtimeContract?.attachToAssignment !== false,
      attachToEventArtifactEvidence: value?.runtimeContract?.attachToEventArtifactEvidence !== false,
      noSecondStateSource: value?.runtimeContract?.noSecondStateSource !== false,
    },
    trials,
  }
}

function normalizePhaseStatusSchema(
  value: AgentEvidenceWorkbenchReport["phaseStatusSchema"] | undefined,
  phaseLifecycle: AgentEvidencePhaseLifecycleItem[],
): AgentEvidenceReportContract["phaseStatusSchema"] {
  const stageIds = uniqueStrings([
    ...(Array.isArray(value?.stageIds) ? value.stageIds.map(sanitizeString) : []),
    ...phaseLifecycle.map((item) => item.stage),
  ])
  return {
    stageIds,
    statuses: [...AGENT_EVIDENCE_PHASE_STATUSES],
  }
}

function normalizePhaseLifecycleItems(
  values: AgentEvidenceWorkbenchReport["phaseLifecycle"] | undefined,
  generatedAt: number,
): AgentEvidencePhaseLifecycleItem[] {
  if (!Array.isArray(values)) return []
  return values.map((item, index) => {
    const stage = sanitizeString(item.stage || item.id || `phase-${index + 1}`)
    const status = normalizePhaseStatus(item.status)
    return {
      id: sanitizeString(item.id || `phase:${stage}`),
      stage,
      phaseName: sanitizeString(item.phaseName || stage),
      threadId: sanitizeString(item.threadId),
      status,
      validation: {
        status: sanitizeString(item.validation?.status || status),
        result: sanitizeString(item.validation?.result),
        command: sanitizeString(item.validation?.command),
        detail: sanitizeString(item.validation?.detail),
        evidenceRefs: Array.isArray(item.validation?.evidenceRefs) ? item.validation.evidenceRefs.map(sanitizeString).filter(Boolean) : [],
        checkedAt: typeof item.validation?.checkedAt === "number" && Number.isFinite(item.validation.checkedAt) ? item.validation.checkedAt : null,
      },
      failureRecovery: {
        status: normalizePhaseStatus(item.failureRecovery?.status, status),
        action: sanitizeString(item.failureRecovery?.action),
        detail: sanitizeString(item.failureRecovery?.detail),
        retryable: item.failureRecovery?.retryable === true,
        recoveredAt: typeof item.failureRecovery?.recoveredAt === "number" && Number.isFinite(item.failureRecovery.recoveredAt) ? item.failureRecovery.recoveredAt : null,
      },
      evidenceRefs: Array.isArray(item.evidenceRefs) ? item.evidenceRefs.map(sanitizeString).filter(Boolean) : [],
      updatedAt: typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) ? item.updatedAt : generatedAt + index,
    }
  }).filter((item) => item.id && item.stage)
}

function deriveFailureCauses(summary: AgentEvidenceWorkbenchSummary): AgentEvidenceFailureCause[] {
  const causes: AgentEvidenceFailureCause[] = []
  const addCause = (cause: AgentEvidenceFailureCause): void => {
    if (!cause.id || causes.some((item) => item.id === cause.id)) return
    causes.push(cause)
  }
  const gap = summary.failure.latestBlockingGap
  if (gap) {
    addCause({
      id: gap.id,
      severity: normalizeSeverity(gap.severity),
      title: gap.title,
      detail: gap.status,
      source: sourceForEvidenceId(gap.id),
      stage: stageForEvidenceId(gap.id),
    })
  }
  if (summary.failure.taskRunIssues > 0) {
    addCause({
      id: "task_run_issues",
      severity: "error",
      title: "任务运行存在失败、阻断或跳过",
      detail: `${summary.failure.taskRunIssues} 个任务运行问题`,
      source: "taskRuns",
      stage: "tests",
    })
  }
  if (summary.failure.qualityGateFailures > 0 || summary.testing.qualityGateFailures > 0) {
    addCause({
      id: "quality_gate_failures",
      severity: "error",
      title: "质量门失败",
      detail: `${summary.testing.qualityGateFailures || summary.failure.qualityGateFailures} 个质量门失败`,
      source: "sandboxSecurity",
      stage: "tests",
    })
  }
  if (!summary.rollback.rollbackAvailable || !summary.scm.rollbackAvailable) {
    addCause({
      id: "rollback_unavailable",
      severity: "warning",
      title: "回滚证据缺失或不可用",
      detail: "补齐 rollback 快照和风险说明。",
      source: "realWorkspaceTrial",
      stage: "rollback",
    })
  }
  if (summary.approval.commandAuthorizationBlocked > 0 || summary.approval.commandAuthorizationNeedsPermission > 0 || summary.approval.permissionApproved !== true) {
    addCause({
      id: "approval_pending",
      severity: "warning",
      title: "审批或命令授权待处理",
      detail: `blocked ${summary.approval.commandAuthorizationBlocked}, needs ${summary.approval.commandAuthorizationNeedsPermission}`,
      source: "sandboxSecurity",
      stage: "approval",
    })
  }
  return causes
}

function deriveNextActions(summary: AgentEvidenceWorkbenchSummary): AgentEvidenceNextAction[] {
  const actions: AgentEvidenceNextAction[] = []
  const addAction = (id: string, label: string, stage: string, priority: "high" | "medium" | "normal" = "medium"): void => {
    if (!id || actions.some((item) => item.id === id)) return
    actions.push({
      id,
      label,
      stage,
      surface: surfaceForStage(stage),
      priority,
      commandId: commandForStage(stage),
    })
  }
  const gap = summary.failure.latestBlockingGap
  if (gap) {
    addAction(gap.id, gap.title || gap.id, stageForEvidenceId(gap.id), normalizeSeverity(gap.severity) === "error" ? "high" : "medium")
  }
  for (const stage of summary.timeline || []) {
    if (stage.available && !stage.ready) {
      addAction(`stage:${stage.stage}`, stage.nextAction || stage.summary || stage.title, stage.stage, stage.status === "blocked" ? "high" : "medium")
    }
  }
  return actions
}

function normalizeNotificationActions(
  values: Array<{ id: string; label: string; surface: string }>,
  actions: AgentEvidenceWorkbenchSurface["actions"],
): AgentEvidenceNotificationItem["actions"] {
  const actionById = new Map(actions.map((action) => [action.id, action]))
  return values.slice(0, 2).map((item) => {
    const registered = actionById.get(item.id)
    return {
      id: item.id,
      label: item.label || registered?.label || item.id,
      surface: normalizeSurfaceKind(item.surface || registered?.surface),
    }
  })
}

function pushUniqueNotification(
  notifications: AgentEvidenceNotificationItem[],
  item: Omit<AgentEvidenceNotificationItem, "dedupeKey" | "dismissCommandId" | "focusTarget" | "ariaLabel"> & Partial<Pick<AgentEvidenceNotificationItem, "dedupeKey" | "dismissCommandId" | "focusTarget" | "ariaLabel">>,
): void {
  const dedupeKey = item.dedupeKey || dedupeKeyForNotification(item.id, item.message)
  if (notifications.some((notification) => notification.dedupeKey === dedupeKey || notification.id === item.id)) return
  notifications.push({
    ...item,
    dedupeKey,
    dismissCommandId: item.dismissCommandId || AGENT_EVIDENCE_COMMAND_IDS.DismissNotification,
    focusTarget: item.focusTarget || "notifications",
    ariaLabel: item.ariaLabel || `${item.severity}: ${item.message}`,
  })
}

function defaultNotificationLifecycle(
  severity: AgentEvidenceSeverity,
  updatedAt: number,
  sticky = true,
): AgentEvidenceNotificationItem["lifecycle"] {
  return {
    state: "active",
    sticky: sticky && severity !== "info",
    updatedAt,
    dismissible: true,
  }
}

function normalizeSeverity(value: string | undefined): AgentEvidenceSeverity {
  const normalized = String(value || "").toLowerCase()
  if (normalized === "error" || normalized === "high") return "error"
  if (normalized === "warning" || normalized === "medium" || normalized === "low") return "warning"
  return "info"
}

function normalizeSurfaceKind(value: string | undefined, fallback: AgentEvidenceSurfaceKind = "timeline"): AgentEvidenceSurfaceKind {
  if (value === "scm" || value === "testing" || value === "progress" || value === "notifications" || value === "timeline") return value
  return fallback
}

function normalizeProgressLocation(value: string | undefined, status: string | undefined): "window" | "notification" {
  if (value === "window" || value === "notification") return value
  return status === "blocked" ? "notification" : "window"
}

function progressLifecycleState(status: string | undefined): "active" | "dismissed" | "updated" {
  const normalized = sanitizeString(status).toLowerCase()
  if (isTerminalProgressStatus(normalized)) return "dismissed"
  if (normalized === "updated" || normalized === "degraded" || normalized === "failed" || normalized === "failure" || normalized === "error" || normalized === "systemerror" || normalized === "system-error" || normalized === "validated-fail") return "updated"
  return "active"
}

function canCancelProgressStatus(status: string | undefined): boolean {
  const normalized = sanitizeString(status).toLowerCase()
  return !isTerminalProgressStatus(normalized) && normalized !== "failed" && normalized !== "failure" && normalized !== "error"
}

function isTerminalProgressStatus(status: string | undefined): boolean {
  const normalized = sanitizeString(status).toLowerCase()
  return normalized === "done"
    || normalized === "completed"
    || normalized === "complete"
    || normalized === "success"
    || normalized === "succeeded"
    || normalized === "passed"
    || normalized === "validated-pass"
    || normalized === "cancelled"
    || normalized === "canceled"
    || normalized === "superseded"
}

function shouldSurfacePhaseLifecycleProgress(phase: AgentEvidencePhaseLifecycleItem): boolean {
  return phase.status === "active"
    || phase.status === "systemError"
    || phase.status === "blocked"
    || phase.status === "needs-validation"
    || phase.status === "validated-fail"
    || phase.failureRecovery.status === "blocked"
}

function shouldNotifyForPhaseLifecycle(phase: AgentEvidencePhaseLifecycleItem): boolean {
  return phase.status === "systemError"
    || phase.status === "blocked"
    || phase.status === "needs-validation"
    || phase.status === "validated-fail"
    || phase.failureRecovery.status === "blocked"
}

function severityForPhaseLifecycle(phase: AgentEvidencePhaseLifecycleItem): AgentEvidenceSeverity {
  if (phase.status === "systemError" || phase.status === "validated-fail") return "error"
  if (phase.status === "blocked" || phase.status === "needs-validation" || phase.failureRecovery.status === "blocked") return "warning"
  return "info"
}

function phaseLifecycleDescription(phase: AgentEvidencePhaseLifecycleItem): string {
  return [
    `状态 ${phase.status}`,
    phase.threadId ? `线程 ${phase.threadId}` : "",
    phase.validation.result ? `验证 ${phase.validation.result}` : phase.validation.status ? `验证 ${phase.validation.status}` : "",
    phase.failureRecovery.status ? `恢复 ${phase.failureRecovery.status}` : "",
    userFacingEvidenceText(phase.failureRecovery.detail || phase.validation.detail || phase.failureRecovery.action),
  ].map(sanitizeString).filter(Boolean).join(" · ")
}

function stageForEvidenceId(id: string | undefined): string {
  const value = sanitizeString(id)
  if (value.includes("manual_real_ui") || value.includes("workbench_real_project_ui")) return "real-ui"
  if (value.includes("task") || value.includes("quality_gate")) return "tests"
  if (value.includes("approval") || value.includes("permission") || value.includes("authorization") || value.includes("sandbox")) return "approval"
  if (value.includes("rollback")) return "rollback"
  if (value.includes("real_workspace")) return "workspace-diff"
  if (value.includes("context") || value.includes("readiness")) return "plan"
  return "failure-diagnostics"
}

function sourceForEvidenceId(id: string | undefined): string {
  const value = sanitizeString(id)
  if (value.includes("manual_real_ui")) return "manualRealUiEvidence"
  if (value.includes("workbench_real_project_ui")) return "workbenchRealProjectUi"
  if (value.includes("task") || value.includes("quality_gate")) return "taskRuns"
  if (value.includes("approval") || value.includes("permission") || value.includes("authorization") || value.includes("sandbox")) return "sandboxSecurity"
  if (value.includes("rollback") || value.includes("real_workspace")) return "realWorkspaceTrial"
  if (value.includes("agent_change")) return "agentChangeSafety"
  return "releaseEvidence"
}

function surfaceForStage(stage: string | undefined): AgentEvidenceSurfaceKind {
  const value = sanitizeString(stage)
  if (value === "tests") return "testing"
  if (value === "workspace-diff" || value === "rollback") return "scm"
  if (value === "approval" || value === "failure-diagnostics") return "notifications"
  return "progress"
}

function summarizeSurface(summary: AgentEvidenceWorkbenchSummary): string {
  return `${summary.readyStages}/${summary.stageCount} 阶段就绪 · ${summary.availableStages} 阶段可观察`
}

function redactSummary(summary: AgentEvidenceWorkbenchSummary): AgentEvidenceWorkbenchSummary {
  return redactValue(summary) as AgentEvidenceWorkbenchSummary
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveString(value)
  if (Array.isArray(value)) return value.map(redactValue)
  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      redacted[key] = redactValue(item)
    }
    return redacted
  }
  return value
}

function redactSensitiveString(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, "[redacted]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1[redacted]")
    .replace(/\b(api[_-]?key|token|password|secret|authorization)\s*[:=]\s*[^,\s;]+/gi, "$1=[redacted]")
    .replace(/\b(rawContent)\s*=\s*[^,\s;]+/gi, "$1=[redacted]")
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)))
}

function sanitizeString(value: unknown): string {
  return String(value || "").trim()
}

function userFacingEvidenceText(value: unknown): string {
  const text = sanitizeString(value)
  if (!text) return ""
  return text
    .replace(/\bAgent Scheduler\s*\/\s*Automation\b/gi, "智能体调度 / 自动化")
    .replace(/\bAgent Evidence\b/gi, "智能体证据")
    .replace(/\bAgent run evidence\b/gi, "智能体运行证据")
    .replace(/\bAgent\b/g, "智能体")
    .replace(/\bevidence\b/gi, "证据")
    .replace(/\bquality gate\b/gi, "质量门")
    .replace(/\btask run\b/gi, "任务运行")
    .replace(/\btasks passed\b/gi, "个任务通过")
    .replace(/\bdiagnostics\b/gi, "诊断")
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function sanitizeTimestamp(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now()
}
