import { debugState, type RunConfig, type StackFrame, type VariableNode } from "../components/debugState"
import { problemState, type Diagnostic } from "../components/problemState"
import { getDebugManager } from "../debug/debugManager"
import {
  createTerminal,
  createTerminalEnvironmentProjection,
  getActiveTerminal,
  getAllTerminals,
  getTerminalContractProjections,
  getTerminalByInstanceId,
  getTerminalProfiles,
  getTaskTerminalReuseRegistrySnapshot,
  onTerminalEvent,
  recordTaskTerminalReuse,
  resolveTerminalProfile,
  splitTerminal,
  canReuseTaskTerminal,
  canTerminateTerminalByInstanceId,
  reuseTaskTerminalForLaunchConfig,
  terminateTerminalByInstanceId,
  type TaskTerminalReuseRegistrySnapshot,
  type TerminalCommandBoundaryProjection,
  type TerminalOwnerTerminationResult,
  type TerminalTaskReuseOwnerEvidence,
  type TerminalPtyHostBridgeProjection,
  type ShellType,
  type TerminalEnvironmentProjection,
  type TerminalInstance,
  type TerminalProcessLifecycleProjection,
  type TerminalProfile,
} from "../terminal/terminalManager"
import { getOutputChannel } from "../utils/outputChannel"
import { Action2, MenuId, MenuRegistry, registerAction2 } from "../vscode-adapter/platform/actions/common/menuRegistry"
import type { Disposable } from "../vscode-adapter/platform/commands/common/commandsRegistry"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import { globalWorkbenchLayoutService, type IWorkbenchLayoutService } from "../vscode-adapter/workbench/services/layout/browser/layoutService"
import type { WorkbenchPaneCompositeSnapshot } from "./workbenchPaneCompositeModel"
import { buildTaskRunEvidence, createTaskRunPlan, runTaskPlan, type TaskCommandResult, type TaskRunEvidence, type TaskRunLifecycleEvent, type TaskRunStep, type TaskTerminalReuseLaunchHint } from "./taskRunner"
import { TASK_CONFIG_STATE_SOURCE, userTasksService, type TaskConfig } from "./userTasks"
import { applyTaskProblemDiagnostics } from "./taskProblems"
import { globalProblemsDiagnosticsService } from "./problemsDiagnosticsService"
import { registerView, registerViewContainer } from "./viewRegistry"
import { quickInputService, type QuickPickEntry } from "./quickInput"
import {
  globalOutputLogTelemetryService,
  normalizeOutputChannelName,
  type OutputLogEntry,
} from "./outputLogTelemetryService"

// VS Code source adapter.
// Source references:
// - src/vs/workbench/contrib/terminal/browser/terminal.ts
// - src/vs/workbench/services/output/common/output.ts
// - src/vs/workbench/contrib/debug/common/debug.ts
// - src/vs/workbench/contrib/tasks/common/taskService.ts
// - src/vs/workbench/contrib/markers/common/markers.ts
// - src/vs/workbench/services/panecomposite/browser/panecomposite.ts
//
// Codek keeps TerminalPanel/outputChannel/debugState/taskRunner as runtime state
// sources, while Problems snapshots read diagnostics from the VS Code-style
// MarkerService through ProblemsDiagnosticsService. problemState remains a
// compatibility outlet refreshed from marker events.

export const TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS = {
  Terminal: "workbench.panel.terminal",
  Output: "workbench.panel.output",
  ProblemsContainer: "workbench.panel.markers",
  Problems: "workbench.panel.markers.view",
} as const

export const DEBUG_WORKBENCH_VIEW_IDS = {
  Container: "workbench.view.debug",
  Variables: "workbench.debug.variablesView",
  Watch: "workbench.debug.watchExpressionsView",
  CallStack: "workbench.debug.callStackView",
  Breakpoints: "workbench.debug.breakPointsView",
  Console: "workbench.debug.repl",
} as const

export const TASK_WORKBENCH_VIEW_IDS = {
  Container: "workbench.view.tasks",
  Tasks: "workbench.tasks.list",
  ProblemMatchers: "workbench.tasks.problemMatchers",
} as const

export const TERMINAL_DEBUG_TASK_COMMAND_IDS = {
  TerminalToggle: "workbench.action.terminal.toggleTerminal",
  TerminalNew: "workbench.action.terminal.new",
  TerminalSplit: "workbench.action.terminal.split",
  TerminalClear: "workbench.action.terminal.clear",
  TerminalRunActiveFile: "workbench.action.terminal.runActiveFile",
  TerminalRunSelectedText: "workbench.action.terminal.runSelectedText",
  OutputShow: "workbench.action.output.showOutput",
  OutputClear: "workbench.output.action.clearOutput",
  DebugOpen: "workbench.view.debug",
  DebugStart: "workbench.action.debug.start",
  DebugStop: "workbench.action.debug.stop",
  TasksOpen: "workbench.action.tasks.openTasks",
  TasksRun: "workbench.action.tasks.runTask",
  TasksRerun: "workbench.action.tasks.reRunTask",
  TasksRerunActiveTerminal: "workbench.action.tasks.rerunTask",
  TasksTerminate: "workbench.action.tasks.terminate",
  TasksTerminateAll: "workbench.action.tasks.terminateAll",
  ProblemsToggle: "workbench.actions.view.toggleProblems",
  ProblemsFocus: "workbench.action.problems.focus",
} as const

export interface TerminalWorkbenchEvidence {
  serviceId: string
  stateSource: "terminalManager"
  terminalCount: number
  activeTerminalId: string
  activeTerminalName: string
  activeTerminalCwd: string
  visibleTerminalIds: string[]
  shellIntegrationCount: number
  recentCommandCount: number
  lastCreatedTerminalId: string
  profileCount: number
  activeProfileName: string
  environmentSource: "terminalProfileResolverService/terminalEnvironment"
  ptyHostBridge: {
    source: TerminalPtyHostBridgeProjection["source"]
    stateSource: "terminalManager"
    lifecycleSource: TerminalProcessLifecycleProjection["source"]
    attachedCount: number
    exitedCount: number
    activePtyId: string
    activePid: number | null
    sessions: TerminalPtyHostBridgeProjection[]
  }
  processLifecycle: {
    source: TerminalProcessLifecycleProjection["source"]
    stateSource: "terminalManager"
    runningCount: number
    exitedCount: number
    activeStatus: TerminalProcessLifecycleProjection["status"] | ""
    activeExitCode: number | null
    sessions: TerminalProcessLifecycleProjection[]
  }
  commandBoundary: {
    source: TerminalCommandBoundaryProjection["source"]
    stateSource: "terminalManager"
    shellIntegrationCount: number
    recentCommandCount: number
    activeCommandLine: string
    lastCommandLine: string
    lastExitCode: number | null
    requiresWorkspaceTrust: true
    writesGitIndex: false
  }
  taskTerminalReuseRegistry: TaskTerminalReuseRegistrySnapshot
}

export interface OutputWorkbenchSnapshot {
  serviceId: string
  stateSource: "outputLogTelemetryService"
  viewId: typeof TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output
  channelName: string
  activeChannelName: string
  visibleChannelName: string
  channelNames: string[]
  channelDescriptors: OutputChannelDescriptor[]
  entryCount: number
  warnCount: number
  errorCount: number
  updateMode: "append" | "replace" | "clear"
  preview: string
  ownerEvidence: ReturnType<typeof globalOutputLogTelemetryService.getOwnerEvidence>
}

export interface DebugSessionEvidence {
  serviceId: string
  stateSource: "debugState" | "debugState/debugRuntime"
  viewId: typeof DEBUG_WORKBENCH_VIEW_IDS.Container
  runtime: "debugState" | "debugRuntime"
  sessionId: string
  isRunning: boolean
  paused: boolean
  activeConfigId: string
  activeConfigName: string
  runConfigCount: number
  breakpointCount: number
  stackFrameCount: number
  variableCount: number
  watchCount: number
  consoleEntryCount: number
}

export interface OutputChannelDescriptor {
  id: string
  label: string
  viewId: typeof TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output
  stateSource: "outputLogTelemetryService"
  entryCount: number
  user: boolean
  source: string
}

export interface TaskProblemProjectionEvidence {
  total: number
  files: string[]
  matchedFiles: string[]
  clearedFiles: string[]
  taskIds: string[]
  stateSource: "problemsDiagnosticsService(globalMarkerService)"
  taskServiceOwner: "UserTasksService + TaskWorkbenchAdapterService"
  problemMatcherOwner: "ProblemMatcherRegistry"
  taskTerminalOwner: "TaskWorkbenchAdapterService taskRunner lifecycle"
  markerOwner: "globalMarkerService owner buckets (compiler/lint)"
  diagnosticSource: "taskProblems.applyTaskProblemDiagnostics -> compiler/lint"
  taskOutputSource: "taskRunner stdout/stderr command result"
  remainingUiOwnerGap: "Task terminal UI owner remains partial until TerminalTaskSystem/generic shell owner is wired"
  collectorOwner: "taskRunner command-output collector"
  registryOwner: "ProblemMatcherRegistry"
  vscodeOwner: "TerminalTaskSystem StartStopProblemCollector/WatchingProblemCollector + ProblemMatcherRegistry"
  currentOwner: "taskRunner command-output collector + taskProblems.applyTaskProblemDiagnostics + global marker lifecycle"
  vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts"
  currentSourcePath: "frontend/vite-project/src/workbench/taskRunner.ts"
  registrySourcePath: "frontend/vite-project/src/vscode-adapter/workbench/contrib/tasks/common/problemMatcher.ts"
  runtimeReference: false
}

export interface TaskSystemLifecycleProjection {
  source: "TaskSystemLifecycleProjection"
  stateSource: "taskRunner/TaskSystemLifecycleProjection"
  runId: string
  executionId: string
  activeTaskId: string
  activeTaskName: string
  terminalInstanceId: number | null
  processId: number | null
  lastEventType: TaskRunLifecycleEvent["type"] | ""
  lastAction: "run" | "rerun" | "terminate" | ""
  eventCount: number
  activeExecutionCount: number
  activeExecutionMap: TaskActiveExecutionProjection[]
  terminalLastTaskMap: TaskTerminalLastTaskProjection[]
  latestInstancePolicy: TaskInstancePolicyEvidence | null
  supportsRerun: true
  supportsTerminate: true
  supportsTerminateAll: boolean
  supportsRestartActiveTerminal: boolean
  supportsMultipleExecutions: true
}

export interface ProviderTaskExecutionEvidence {
  taskId: string
  taskName: string
  providerType: string
  runType: TaskRunLifecycleEvent["runType"]
  runId: string
  executionId: string
  terminalInstanceId: number | null
  processId: number | null
  lastTerminalInstanceId: number | null
  lastProcessId: number | null
  terminalOwnerCreated: boolean
  activeExecutionMapped: boolean
  terminalOwnerResolved: boolean
  terminalTaskOwner: TaskTerminalTaskOwnerEvidence
  blockedReason: string
  finishedRunTerminalOwnerBlockedReason: string
  missingOwner: string
  nextAuthorizedFiles: string[]
  stateSource: "taskRunner/TaskSystemLifecycleProjection"
}

export interface TaskActiveExecutionProjection {
  taskId: string
  taskName: string
  runId: string
  executionId: string
  runType: TaskRunLifecycleEvent["runType"]
  terminalInstanceId: number | null
  processId: number | null
  lastEventType: TaskRunLifecycleEvent["type"]
  status: TaskRunLifecycleEvent["status"]
  startedAt: number | null
  updatedAt: number
  endedAt: number | null
  stateSource: "taskRunner/activeExecutionMap"
}

export interface TaskTerminalLastTaskProjection {
  terminalInstanceId: number
  taskId: string
  taskName: string
  runId: string
  executionId: string
  runType: TaskRunLifecycleEvent["runType"]
  processId: number | null
  lastEventType: TaskRunLifecycleEvent["type"]
  status: "active" | "finished"
  updatedAt: number
  stateSource: "taskRunner/terminalLastTaskMap"
  vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts"
  currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts"
  runtimeReference: false
}

export interface TaskTerminalPhysicalReuseProjection {
  success: boolean
  terminalInstanceId: number | null
  taskId: string
  taskName: string
  commandLine: string
  cwd: string
  group: string
  reuseKind: "sameTask" | "idleTask"
  reason: string
  terminalOwner: TerminalTaskReuseOwnerEvidence | null
  stateSource: "taskRunner/terminalLastTaskMap"
  vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts"
  currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts"
  runtimeReference: false
}

export interface TaskTerminalTaskOwnerEvidence {
  status: "activeResolved" | "activeUnresolved" | "lastTaskOnly" | "missing"
  taskId: string | null
  taskName: string
  terminalInstanceId: number | null
  processId: number | null
  terminalOwnerResolved: boolean
  supportsTerminate: boolean
  supportsRerun: boolean
  stateSource: "taskRunner/activeExecutionMap" | "taskRunner/terminalLastTaskMap" | "taskRunner/TaskSystemLifecycleProjection"
  vscodeOwner: "TerminalTaskSystem._activeTasks + TerminalTaskSystem._terminals.lastTask + ITerminalInstance dispose/onDisposed"
  currentOwner: string
  missingOwner: string
  vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts"
  currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts"
  runtimeReference: false
}

export type TaskInstancePolicy = NonNullable<TaskConfig["runOptions"]>["instancePolicy"]

export interface TaskInstancePolicyEvidence {
  taskId: string
  taskName: string
  policy: TaskInstancePolicy
  action: "allow" | "prompt" | "terminateNewest" | "terminateOldest" | "silent" | "warn"
  status: "allowed" | "pendingPrompt" | "handled" | "blocked"
  instanceLimit: number
  sameTaskExecutionCount: number
  activeExecutionCount: number
  selectedExecutionId: string | null
  selectedTaskName: string | null
  terminalInstanceId: number | null
  processId: number | null
  quickPickOwner: "QuickInputService.pick" | null
  quickPickItemCount: number
  quickPickSelection: string | null
  reason: string
  stateSource: "taskRunner/instancePolicy"
  vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/abstractTaskService.ts"
  currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts"
  runtimeReference: false
}

export interface TaskSystemBlockedCapabilityEvidence {
  capability:
    | "terminalOwnership"
    | "terminateAll"
    | "restartActiveTerminal"
    | "multipleExecutions"
    | "extensionTaskProviderBridge"
  reason: string
  vscodeSourcePath: string
  currentSourcePath: string
  vscodeOwner: string
  currentOwner: string
  missingOwner: string
  nextAuthorizedFiles: string[]
  blocked: true
  runtimeReference: false
}

export interface TaskSystemOwnershipAuditEntry {
  capability:
    | "terminalProcessLifecycle"
    | "terminateAll"
    | "restartActiveTerminal"
    | "problemMatcher"
    | "multipleExecutions"
  status: "blocked" | "partial" | "available"
  vscodeOwner: string
  currentOwner: string
  missingOwner: string
  vscodeSourcePath: string
  currentSourcePath: string
  nextAuthorizedFiles: string[]
}

export interface ExtensionTaskProviderBridgeCapability {
  status: "blocked" | "partial" | "connected"
  providerTaskCount: number
  taskProjection: boolean
  rendererIpcConsumerConnected: boolean
  terminalTaskSystemExecution: boolean
  executionEvidence: ProviderTaskExecutionEvidence | null
  stateSource: "userTasksService/extensionProviderProjection"
  currentSourcePath: "frontend/vite-project/src/workbench/userTasks.ts"
  vscodeSourcePath: "src/vs/workbench/api/browser/mainThreadTask.ts"
}

export interface TaskSystemCapabilitySnapshot {
  source: "TaskSystemCapabilitySnapshot"
  stateSource: "taskRunner/TaskSystemLifecycleProjection"
  implementation: "lightweightTaskRunnerProjection"
  terminalOwnership: "blocked" | "partial" | "available"
  terminalInstanceId: number | null
  processId: number | null
  activeExecutionCount: number
  activeExecutionMap: TaskActiveExecutionProjection[]
  activeTerminalTaskOwner: TaskTerminalTaskOwnerEvidence
  terminalServiceLifecycle: TaskTerminalServiceLifecycleEvidence
  supportsRerun: true
  supportsTerminate: true
  supportsTerminateAll: boolean
  supportsRestartActiveTerminal: boolean
  terminalTabActions: TaskTerminalTabActionEvidence[]
  supportsMultipleExecutions: true
  supportsExtensionTaskProviderBridge: "blocked" | "partial" | "connected"
  extensionTaskProviderBridge: ExtensionTaskProviderBridgeCapability
  multipleExecutionsPolicy: "instanceLimit"
  latestInstancePolicy: TaskInstancePolicyEvidence | null
  latestPhysicalReuse: TaskTerminalPhysicalReuseProjection | null
  ownershipAudit: TaskSystemOwnershipAuditEntry[]
  blocked: TaskSystemBlockedCapabilityEvidence[]
  vscodeSourcePaths: string[]
  currentSourcePaths: string[]
  constraints: {
    noSecondTaskState: true
    noRuntimeSourceMirrorReference: true
    blockedEvidenceOnlyForUnmigratedTerminalSystem: true
  }
}

export interface TaskTerminalTabActionEvidence {
  id: typeof TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal | typeof TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll
  label: string
  available: boolean
  activeExecutionCount: number
  terminalInstanceId: number | null
  stateSource: "taskRunner/activeExecutionMap" | "taskRunner/terminalLastTaskMap"
  terminalTaskOwnerStatus: TaskTerminalTaskOwnerEvidence["status"]
  terminalOwnerResolved: boolean
  vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts"
  currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts"
  commandOwner: "TaskWorkbenchAdapterService"
}

export interface TaskTerminalShellLaunchConfigEvidence {
  type: "Task"
  cwd: string
  taskId: string
  taskName: string
  isFeatureTerminal: true
  useShellEnvironment: true
  tabActions: TaskTerminalTabActionEvidence[]
  reuseCount: number
  lastReuseTaskId: string
  stateSource: "TaskWorkbenchAdapterService/shellLaunchConfig"
  vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts"
  currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts"
  runtimeReference: false
}

export interface WorkbenchTerminalInstance extends TerminalInstance {
  shellLaunchConfig: TaskTerminalShellLaunchConfigEvidence | null
  reuseTerminal(shellLaunchConfig: TaskTerminalShellLaunchConfigEvidence): Promise<void>
}

export type TaskTerminalLifecycleConnectionStatus = "connected" | "partial" | "blocked"

export interface TaskTerminalLifecycleStepEvidence {
  status: TaskTerminalLifecycleConnectionStatus
  ownerConnected: boolean
  currentOwner: string
  vscodeOwner: string
  missingOwner: string
  stateSource:
    | "terminalManager"
    | "taskRunner/activeExecutionMap"
    | "taskRunner/terminalLastTaskMap"
    | "taskRunner/TaskSystemLifecycleProjection"
    | "commandRegistry/MenuRegistry"
}

export interface TaskTerminalServiceRegistryEvidence {
  status: TaskTerminalLifecycleConnectionStatus
  instanceCount: number
  activeInstanceId: number | null
  trackedTaskTerminalInstanceIds: number[]
  onDidCreateInstance: boolean
  onDidDisposeInstance: boolean
  stateSource: "terminalManager"
  vscodeOwner: "ITerminalService.instances + onDidCreateInstance/onDidDisposeInstance"
  currentOwner: string
  missingOwner: string
  vscodeSourcePath: "src/vs/workbench/contrib/terminal/browser/terminalService.ts"
  currentSourcePath: "frontend/vite-project/src/terminal/terminalManager.ts"
  runtimeReference: false
}

export interface TaskTerminalReuseRegistryEvidence {
  status: TaskTerminalLifecycleConnectionStatus
  reusableTerminalInstanceIds: number[]
  activeTerminalInstanceIds: number[]
  finishedTerminalInstanceIds: number[]
  sameTaskTerminalInstanceIds: number[]
  idleTaskTerminalInstanceIds: number[]
  supportsPhysicalReuse: false
  stateSource: "terminalManager/taskTerminalReuseRegistry"
  vscodeOwner: "TerminalTaskSystem._sameTaskTerminals/_idleTaskTerminals + ITerminalInstance.reuseTerminal"
  currentOwner: string
  missingOwner: string
  vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts"
  currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts"
  runtimeReference: false
}

export interface TaskTerminalServiceLifecycleEvidence {
  status: TaskTerminalLifecycleConnectionStatus
  terminalInstanceId: number | null
  taskId: string | null
  taskName: string
  registry: TaskTerminalServiceRegistryEvidence
  reuseRegistry: TaskTerminalReuseRegistryEvidence
  create: TaskTerminalLifecycleStepEvidence
  reuse: TaskTerminalLifecycleStepEvidence
  dispose: TaskTerminalLifecycleStepEvidence
  onExit: TaskTerminalLifecycleStepEvidence
  tabActions: TaskTerminalLifecycleStepEvidence
  stateSource: "taskRunner/TaskSystemLifecycleProjection"
  vscodeOwner: "TerminalTaskSystem + ITerminalService + ITerminalInstance lifecycle"
  currentOwner: "TaskWorkbenchAdapterService + terminalManager"
  vscodeSourcePaths: readonly [
    "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
    "src/vs/workbench/contrib/tasks/browser/abstractTaskService.ts",
    "src/vs/workbench/contrib/tasks/common/tasks.ts",
    "src/vs/workbench/contrib/terminal/browser/terminalService.ts",
  ]
  currentSourcePaths: readonly [
    "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
    "frontend/vite-project/src/workbench/taskRunner.ts",
    "frontend/vite-project/src/terminal/terminalManager.ts",
  ]
  blocked: Array<{
    capability: "create" | "reuse" | "dispose" | "onExit" | "tabActions"
    missingOwner: string
    vscodeOwner: string
    currentOwner: string
  }>
  runtimeReference: false
}

export interface TaskTerminateProjection {
  success: boolean
  taskId: string
  taskName: string
  action: "terminate"
  runId: string
  executionId: string
  terminalInstanceId: number | null
  processId: number | null
  activeExecutionCount: number
  stateSource: "taskRunner/TaskSystemLifecycleProjection"
  terminalOwner?: TerminalOwnerTerminationResult
}

export interface TaskTerminateAllProjection {
  success: boolean
  action: "terminateAll"
  terminatedCount: number
  activeExecutionCount: number
  results: TaskTerminateProjection[]
  blocked: TaskSystemBlockedCapabilityEvidence[]
  stateSource: "taskRunner/TaskSystemLifecycleProjection"
}

export interface TaskRestartActiveTerminalProjection {
  success: boolean
  action: "restartActiveTerminal"
  taskId: string
  taskName: string
  runId: string
  executionId: string
  terminalInstanceId: number | null
  processId: number | null
  activeExecutionCount: number
  reason?: string
  terminate?: TaskTerminateProjection
  run?: TaskRunEvidence
  terminalLastTask?: TaskTerminalLastTaskProjection
  stateSource: "taskRunner/TaskSystemLifecycleProjection"
}

export interface TaskRunServiceOptions {
  workspaceFolder?: string
  activeFile?: string
  inputs?: Record<string, string>
  runCommand?: (config: RunConfig & { taskTerminalReuse?: TaskTerminalReuseLaunchHint }) => Promise<TaskCommandResult | null | undefined>
}

export interface DebugRuntimeStartResult {
  sessionId?: string
  paused?: boolean
  consoleOutput?: string
  stackFrames?: StackFrame[]
  variables?: VariableNode[]
}

export interface DebugRuntimeStopResult {
  consoleOutput?: string
}

export interface DebugRuntime {
  start(config: RunConfig | undefined): Promise<DebugRuntimeStartResult | void>
  stop(sessionId: string | null): Promise<DebugRuntimeStopResult | void>
}

export interface ProblemsWorkbenchSnapshot {
  serviceId: string
  stateSource: "problemsDiagnosticsService(globalMarkerService)"
  containerId: typeof TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer
  viewId: typeof TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems
  diagnosticCount: number
  errorCount: number
  warningCount: number
  infoCount: number
  aiCount: number
  fileCount: number
  sourceNames: string[]
  diagnostics: Diagnostic[]
}

export interface PaneCompositePartEvidence {
  serviceId: string
  stateSource: "workbenchLayoutService"
  lastOpenedPanelId: string
  lastToggledPanelId: string
  lastOpenedDebugViewId: string
  lastOpenedTaskViewId: string
  problemsOpened: boolean
  openCount: number
  toggleCount: number
}

export interface TerminalDebugTaskWorkbenchSurfaceSnapshot {
  source: "terminalDebugTaskWorkbenchService"
  serviceId: string
  vscodeServiceIds: string[]
  viewIds: string[]
  commandIds: string[]
  stateSource: "facade"
  contributionSurface: TerminalDebugTaskWorkbenchContributionSurface
  terminal: TerminalWorkbenchEvidence
  output: OutputWorkbenchSnapshot
  debug: DebugSessionEvidence
  tasks: {
    serviceId: string
    stateSource: typeof TASK_CONFIG_STATE_SOURCE
    viewId: typeof TASK_WORKBENCH_VIEW_IDS.Container
    runConfigCount: number
    activeTaskId: string
    latestEvidence: TaskRunEvidence | null
    latestProblemProjection: TaskProblemProjectionEvidence | null
    lifecycle: TaskSystemLifecycleProjection
    capabilities: TaskSystemCapabilitySnapshot
  }
  problems: ProblemsWorkbenchSnapshot
  paneComposite: PaneCompositePartEvidence
  constraints: {
    noSecondTerminalState: true
    noSecondOutputState: true
    noSecondDebugState: true
    noSecondTaskState: true
    problemsReadOnlyBridge: true
    preservesAgentEvidenceProgress: true
    viewActionMenuDriven: true
    evidenceSafeCommandBoundary: true
  }
}

export interface TerminalService {
  readonly _serviceBrand: undefined
  readonly instances: readonly WorkbenchTerminalInstance[]
  createTerminal(shellType?: ShellType, cwd?: string): WorkbenchTerminalInstance
  splitTerminal(shellType?: ShellType, cwd?: string): WorkbenchTerminalInstance
  getActiveTerminal(): WorkbenchTerminalInstance | null
  getTerminals(): WorkbenchTerminalInstance[]
  onDidCreateInstance(listener: (instance: WorkbenchTerminalInstance) => void): Disposable
  onDidDisposeInstance(listener: (instance: WorkbenchTerminalInstance) => void): Disposable
  getProfiles(): TerminalProfile[]
  resolveProfile(shellType?: ShellType): TerminalProfile
  createEnvironment(options?: {
    shellType?: ShellType
    cwd?: string
    baseEnv?: Record<string, string | null | undefined>
    env?: Record<string, string | null | undefined>
    strictEnv?: boolean
  }): TerminalEnvironmentProjection
  getTaskTerminalReuseRegistry(): TaskTerminalReuseRegistrySnapshot
  getEvidence(): TerminalWorkbenchEvidence
}

export interface CodekOutputService {
  readonly _serviceBrand: undefined
  showChannel(name?: string, preserveFocus?: boolean): void
  append(name: string, message: string): void
  appendLine(name: string, message: string): void
  clearChannel(name?: string): void
  getActiveChannelName(): string
  getChannelDescriptor(name: string): OutputChannelDescriptor | undefined
  getChannelDescriptors(): OutputChannelDescriptor[]
  getOutputSnapshot(name?: string): OutputWorkbenchSnapshot
}

export interface DebugWorkbenchService {
  readonly _serviceBrand: undefined
  setRuntime(runtime?: DebugRuntime): void
  start(configId?: string): Promise<DebugSessionEvidence>
  stop(): Promise<DebugSessionEvidence>
  getSessionEvidence(): DebugSessionEvidence
}

export interface TaskWorkbenchService {
  readonly _serviceBrand: undefined
  openTasks(): void
  runTask(
    taskIdOrName?: string,
    options?: TaskRunServiceOptions,
  ): Promise<TaskRunEvidence>
  rerunTask(options?: TaskRunServiceOptions): Promise<TaskRunEvidence>
  terminateTask(taskIdOrName?: string): Promise<TaskTerminateProjection>
  terminateAllTasks(): Promise<TaskTerminateAllProjection>
  restartActiveTerminal(terminalInstanceId: number): Promise<TaskRestartActiveTerminalProjection>
  getTasks(): TaskConfig[]
  getLatestEvidence(): TaskRunEvidence | null
  getLifecycleEvents(): TaskRunLifecycleEvent[]
  getTaskSnapshot(): TerminalDebugTaskWorkbenchSurfaceSnapshot["tasks"]
  clearEvidence(): void
}

export interface ProblemsWorkbenchService {
  readonly _serviceBrand: undefined
  getProblemsSnapshot(): ProblemsWorkbenchSnapshot
}

export interface PaneCompositePartService {
  readonly _serviceBrand: undefined
  setBridge(bridge?: TerminalDebugTaskWorkbenchUiBridge): void
  openPaneComposite(id: string, focus?: boolean): Promise<void>
  togglePaneComposite(id: string): Promise<void>
  openDebugView(id?: string): Promise<void>
  openTasks(id?: string): Promise<void>
  openProblems(): Promise<void>
  getEvidence(): PaneCompositePartEvidence
  clearEvidence(): void
  clear(): void
}

export interface TerminalDebugTaskWorkbenchServiceFacade {
  readonly _serviceBrand: undefined
  getSurfaceSnapshot(): TerminalDebugTaskWorkbenchSurfaceSnapshot
  clearEvidence(): void
}

export interface TerminalDebugTaskWorkbenchUiBridge {
  openPanel?: (panelId: string) => void | Promise<void>
  togglePanel?: (panelId: string) => void | Promise<void>
  openDebugView?: (viewId: string) => void | Promise<void>
  openTasks?: (viewId: string) => void | Promise<void>
  openProblems?: (viewId: string) => void | Promise<void>
  onEvidence?: (event: { source: string; action: string; detail: Record<string, unknown> }) => void
}

export interface RegisterTerminalDebugTaskWorkbenchOptions extends TerminalDebugTaskWorkbenchUiBridge {
  service?: TerminalDebugTaskWorkbenchServiceFacade
  registerDebugActivityView?: boolean
}

export interface TerminalDebugTaskWorkbenchContributionSurface {
  source: "vscode-adapted"
  services: Array<{ id: string; source: "vscode"; stateSource: string }>
  viewsByArea: Record<"terminal" | "output" | "debug" | "tasks" | "problems", string[]>
  commandsByArea: Record<"terminal" | "output" | "debug" | "tasks" | "problems", string[]>
  commands: Array<{
    id: string
    category: string
    serviceId: string
    menus: Array<{ id: string; group?: string; order?: number; when?: string }>
  }>
  stateSources: {
    terminal: "terminalManager"
    output: "outputLogTelemetryService"
    debug: "debugState/debugRuntime"
    tasks: typeof TASK_CONFIG_STATE_SOURCE
    problems: "problemsDiagnosticsService(globalMarkerService)"
    paneComposite: "workbenchLayoutService"
  }
}

export const ITerminalService = createDecorator<TerminalService>("terminalService")
export const IOutputService = createDecorator<CodekOutputService>("outputService")
export const ICodekOutputService = createDecorator<CodekOutputService>("codekOutputService")
export const IDebugService = createDecorator<DebugWorkbenchService>("debugService")
export const ITaskService = createDecorator<TaskWorkbenchService>("taskService")
export const IProblemsWorkbenchService = createDecorator<ProblemsWorkbenchService>("problemsWorkbenchService")
export const IPaneCompositePartService = createDecorator<PaneCompositePartService>("paneCompositePartService")
export const ITerminalDebugTaskWorkbenchService = createDecorator<TerminalDebugTaskWorkbenchServiceFacade>("terminalDebugTaskWorkbenchService")

class TerminalWorkbenchAdapterService implements TerminalService {
  declare readonly _serviceBrand: undefined
  private lastCreatedTerminalId = ""
  private readonly createListeners = new Set<(instance: WorkbenchTerminalInstance) => void>()
  private readonly disposeListeners = new Set<(instance: WorkbenchTerminalInstance) => void>()
  private readonly workbenchInstances = new Map<number, WorkbenchTerminalInstance>()

  constructor() {
    onTerminalEvent((type, terminalId) => {
      const terminal = getAllTerminals().find((entry) => entry.id === terminalId)
      if (type === "created" && terminal) {
        const instance = this.decorateTerminalInstance(terminal)
        for (const listener of this.createListeners) listener(instance)
      }
      if (type === "closed") {
        const instance = terminal
          ? this.decorateTerminalInstance(terminal)
          : [...this.workbenchInstances.values()].find((entry) => entry.id === terminalId)
        if (!instance) return
        this.workbenchInstances.delete(instance.instanceId)
        for (const listener of this.disposeListeners) listener(instance)
      }
    })
  }

  get instances(): readonly WorkbenchTerminalInstance[] {
    return this.getTerminals()
  }

  createTerminal(shellType: ShellType = "powershell", cwd = ""): WorkbenchTerminalInstance {
    const terminal = createTerminal(shellType, cwd)
    this.lastCreatedTerminalId = terminal.id
    return this.decorateTerminalInstance(terminal)
  }

  splitTerminal(shellType: ShellType = "powershell", cwd = ""): WorkbenchTerminalInstance {
    const terminal = splitTerminal(shellType, cwd)
    this.lastCreatedTerminalId = terminal.id
    return this.decorateTerminalInstance(terminal)
  }

  getActiveTerminal(): WorkbenchTerminalInstance | null {
    const terminal = getActiveTerminal()
    return terminal ? this.decorateTerminalInstance(terminal) : null
  }

  getTerminals(): WorkbenchTerminalInstance[] {
    return getAllTerminals().map((terminal) => this.decorateTerminalInstance(terminal))
  }

  onDidCreateInstance(listener: (instance: WorkbenchTerminalInstance) => void): Disposable {
    this.createListeners.add(listener)
    return { dispose: () => this.createListeners.delete(listener) }
  }

  onDidDisposeInstance(listener: (instance: WorkbenchTerminalInstance) => void): Disposable {
    this.disposeListeners.add(listener)
    return { dispose: () => this.disposeListeners.delete(listener) }
  }

  getProfiles(): TerminalProfile[] {
    return getTerminalProfiles()
  }

  resolveProfile(shellType: ShellType = "powershell"): TerminalProfile {
    return resolveTerminalProfile(shellType)
  }

  createEnvironment(options: Parameters<TerminalService["createEnvironment"]>[0] = {}): TerminalEnvironmentProjection {
    return createTerminalEnvironmentProjection(options)
  }

  getTaskTerminalReuseRegistry(): TaskTerminalReuseRegistrySnapshot {
    return getTaskTerminalReuseRegistrySnapshot()
  }

  getEvidence(): TerminalWorkbenchEvidence {
    return buildTerminalWorkbenchEvidence(this.lastCreatedTerminalId)
  }

  private decorateTerminalInstance(terminal: TerminalInstance): WorkbenchTerminalInstance {
    const existing = this.workbenchInstances.get(terminal.instanceId)
    if (existing) {
      const shellLaunchConfig = existing.id === terminal.id ? existing.shellLaunchConfig : null
      Object.assign(existing, terminal)
      existing.shellLaunchConfig = shellLaunchConfig
      return existing
    }
    const instance = Object.assign(terminal, {
      shellLaunchConfig: null,
      reuseTerminal: async (shellLaunchConfig: TaskTerminalShellLaunchConfigEvidence) => {
        instance.shellLaunchConfig = {
          ...shellLaunchConfig,
          tabActions: shellLaunchConfig.tabActions.map((action) => ({ ...action })),
          reuseCount: (instance.shellLaunchConfig?.reuseCount ?? 0) + 1,
          lastReuseTaskId: shellLaunchConfig.taskId,
        }
      },
    }) as WorkbenchTerminalInstance
    this.workbenchInstances.set(instance.instanceId, instance)
    return instance
  }
}

class OutputWorkbenchAdapterService implements CodekOutputService {
  declare readonly _serviceBrand: undefined

  showChannel(name = this.getActiveChannelName(), preserveFocus = true): void {
    globalOutputLogTelemetryService.showChannel(name, preserveFocus)
  }

  append(name: string, message: string): void {
    globalOutputLogTelemetryService.append(name, String(message ?? ""))
  }

  appendLine(name: string, message: string): void {
    globalOutputLogTelemetryService.appendLine(name, String(message ?? ""))
  }

  clearChannel(name = this.getActiveChannelName()): void {
    globalOutputLogTelemetryService.clearChannel(name)
  }

  getActiveChannelName(): string {
    return globalOutputLogTelemetryService.getActiveChannelName()
  }

  getChannelDescriptor(name: string): OutputChannelDescriptor | undefined {
    const channelName = normalizeOutputChannelName(name)
    const descriptor = globalOutputLogTelemetryService.getChannelDescriptor(channelName)
    if (!descriptor) return undefined
    return {
      id: descriptor.id,
      label: descriptor.label,
      viewId: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output,
      stateSource: descriptor.stateSource,
      entryCount: descriptor.entryCount,
      user: descriptor.user,
      source: descriptor.source,
    }
  }

  getChannelDescriptors(): OutputChannelDescriptor[] {
    return globalOutputLogTelemetryService.getAllChannelNames()
      .map((name) => this.getChannelDescriptor(name))
      .filter((descriptor): descriptor is OutputChannelDescriptor => Boolean(descriptor))
  }

  getOutputSnapshot(name = this.getActiveChannelName()): OutputWorkbenchSnapshot {
    const channelName = normalizeOutputChannelName(name)
    const entries = globalOutputLogTelemetryService.getEntries(channelName)
    return buildOutputWorkbenchSnapshot(
      channelName,
      this.getActiveChannelName(),
      globalOutputLogTelemetryService.getVisibleChannelName(),
      entries,
      this.getChannelDescriptors(),
    )
  }
}

class DebugWorkbenchAdapterService implements DebugWorkbenchService {
  declare readonly _serviceBrand: undefined
  private runtime: DebugRuntime | undefined
  private runtimeMode: DebugSessionEvidence["runtime"] = "debugState"

  setRuntime(runtime?: DebugRuntime): void {
    this.runtime = runtime
    this.runtimeMode = runtime ? "debugRuntime" : "debugState"
  }

  async start(configId = debugState.activeConfigId.value): Promise<DebugSessionEvidence> {
    const candidate = configId || debugState.runConfigs[0]?.id || ""
    if (candidate) debugState.activeConfigId.value = candidate
    const config = debugState.activeConfig.value

    if (this.runtime) {
      const result = await this.runtime.start(config) || {}
      this.runtimeMode = "debugRuntime"
      debugState.isRunning.value = true
      debugState.paused.value = Boolean(result?.paused)
      debugState.sessionId.value = result?.sessionId || debugState.sessionId.value || `debug-${Date.now()}`
      if (result?.stackFrames) debugState.stackFrames.value = result.stackFrames
      if (result?.variables) debugState.variables.value = result.variables
      appendDebugConsole("system", result?.consoleOutput || "Debug session started from workbench contribution")
      return buildDebugSessionEvidence("debugRuntime")
    }

    if (!config) {
      appendDebugConsole("error", "无法启动调试：缺少调试配置")
      this.runtimeMode = "debugState"
      return buildDebugSessionEvidence()
    }

    await getDebugManager().startSession(config)
    if (debugState.sessionId.value || debugState.isRunning.value) {
      this.runtimeMode = "debugRuntime"
      return buildDebugSessionEvidence("debugRuntime")
    }

    this.runtimeMode = "debugState"
    return buildDebugSessionEvidence()
  }

  async stop(): Promise<DebugSessionEvidence> {
    if (this.runtime) {
      const result = await this.runtime.stop(debugState.sessionId.value) || {}
      this.runtimeMode = "debugRuntime"
      clearDebugRuntimeState()
      appendDebugConsole("system", result?.consoleOutput || "Debug session stopped from workbench contribution")
      return buildDebugSessionEvidence("debugRuntime")
    }

    if (this.runtimeMode === "debugRuntime") {
      await getDebugManager().stopSession()
      return buildDebugSessionEvidence("debugRuntime")
    }

    debugState.isRunning.value = false
    debugState.paused.value = false
    debugState.sessionId.value = null
    debugState.stackFrames.value = []
    debugState.variables.value = []
    debugState.currentFrameId.value = null
    appendDebugConsole("system", "Debug session stopped from workbench contribution")
    return buildDebugSessionEvidence()
  }

  getSessionEvidence(): DebugSessionEvidence {
    return buildDebugSessionEvidence(this.runtimeMode)
  }
}

class TaskWorkbenchAdapterService implements TaskWorkbenchService {
  declare readonly _serviceBrand: undefined
  private latestEvidence: TaskRunEvidence | null = null
  private latestProblemProjection: TaskProblemProjectionEvidence | null = null
  private lifecycleEvents: TaskRunLifecycleEvent[] = []
  private activeExecutions = new Map<string, TaskActiveExecutionProjection>()
  private terminalLastTaskMap = new Map<number, TaskTerminalLastTaskProjection>()
  private lastTaskId = ""
  private lastRunOptions: TaskRunServiceOptions | undefined
  private providerTaskExecutionEvidence: ProviderTaskExecutionEvidence | null = null
  private latestInstancePolicy: TaskInstancePolicyEvidence | null = null
  private latestPhysicalReuse: TaskTerminalPhysicalReuseProjection | null = null
  private lifecycleProjection = createEmptyTaskSystemLifecycleProjection()

  openTasks(): void {
    getOutputChannel("Tasks")
  }

  async runTask(
    taskIdOrName = getDefaultTaskIdFromUserTasks(),
    options: TaskRunServiceOptions = {},
  ): Promise<TaskRunEvidence> {
    const task = findTaskConfig(taskIdOrName)
    if (!task) {
      const evidence = buildMissingTaskEvidence(taskIdOrName)
      this.latestEvidence = evidence
      this.latestProblemProjection = null
      getOutputChannel("Tasks").error(`${evidence.summary}\n`)
      return evidence
    }

    const instancePolicyDecision = await this.handleInstancePolicy(task)
    if (instancePolicyDecision.blockedEvidence) {
      this.latestEvidence = instancePolicyDecision.blockedEvidence
      this.latestProblemProjection = null
      userTasksService.setActiveTask(task.id)
      getOutputChannel("Tasks").error(`${instancePolicyDecision.blockedEvidence.summary}\n`)
      return instancePolicyDecision.blockedEvidence
    }

    userTasksService.setActiveTask(task.id)
    const plan = createTaskRunPlan(
      userTasksService.getTasks().map(toExecutableRunConfig),
      toExecutableRunConfig(task),
    )
    const runner = options.runCommand || defaultNoopTaskRunner
    const runId = createTaskLifecycleRunId()
    const physicalReuse = this.prepareTaskTerminalPhysicalReuse(task, options)
    this.latestPhysicalReuse = physicalReuse
    this.lastTaskId = task.id
    this.lastRunOptions = options
    this.lifecycleProjection = {
      ...createEmptyTaskSystemLifecycleProjection(),
      runId,
      activeTaskId: task.id,
      activeTaskName: task.name,
      activeExecutionCount: this.activeExecutions.size,
      activeExecutionMap: this.getActiveExecutions(),
      terminalLastTaskMap: this.getTerminalLastTasks(),
      latestInstancePolicy: this.latestInstancePolicy,
      lastAction: this.lifecycleProjection.lastAction === "rerun" ? "rerun" : "run",
    }
    await runTaskPlan(plan, {
      workspaceFolder: options.workspaceFolder || task.workingDir || "",
      activeFile: options.activeFile || "",
      inputs: options.inputs,
      runCommand: runner,
      runId,
      taskTerminalReuse: physicalReuse?.success && typeof physicalReuse.terminalInstanceId === "number"
        ? {
          terminalInstanceId: physicalReuse.terminalInstanceId,
          taskId: physicalReuse.taskId,
          taskName: physicalReuse.taskName,
          commandLine: physicalReuse.commandLine,
          cwd: physicalReuse.cwd,
          group: physicalReuse.group,
          reuseKind: physicalReuse.reuseKind,
          source: "TerminalTaskSystem.reuseTerminal(launchConfigs)",
          stateSource: "terminalManager/taskTerminalReuseOwner",
          vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
          currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
          runtimeReference: false,
        }
        : null,
      onDidStateChange: (event) => {
        this.lifecycleEvents.push(event)
        this.lifecycleEvents = this.lifecycleEvents.slice(-50)
        this.updateActiveExecutionMap(event)
        this.lifecycleProjection = buildTaskLifecycleProjection(
          this.lifecycleEvents,
          this.lifecycleProjection.lastAction,
          this.getActiveExecutions(),
          this.latestInstancePolicy,
          this.getTerminalLastTasks(),
        )
      },
    })
    this.latestProblemProjection = projectTaskProblems(plan.steps, this.latestProblemProjection)
    const evidence = buildTaskRunEvidence(plan)
    this.latestEvidence = evidence
    this.attachShellLaunchConfigToLatestTerminal(task)
    this.updateProviderTaskExecutionEvidence(task)
    writeTaskEvidenceToOutput(evidence)
    return evidence
  }

  async rerunTask(options: TaskRunServiceOptions = {}): Promise<TaskRunEvidence> {
    const taskId = this.lastTaskId || this.latestEvidence?.id || userTasksService.getContractSnapshot().activeTaskId
    this.lifecycleProjection = {
      ...this.lifecycleProjection,
      lastAction: "rerun",
    }
    return this.runTask(taskId, {
      ...(this.lastRunOptions || {}),
      ...options,
    })
  }

  async terminateTask(taskIdOrName = this.lifecycleProjection.activeTaskId || this.lastTaskId): Promise<TaskTerminateProjection> {
    const task = findTaskConfig(taskIdOrName) || (this.lastTaskId ? findTaskConfig(this.lastTaskId) : undefined)
    const existingExecution = findActiveExecution(this.activeExecutions, task?.id || String(taskIdOrName || ""))
    const runId = this.lifecycleProjection.runId || createTaskLifecycleRunId()
    const taskId = task?.id || String(taskIdOrName || "")
    const taskName = task?.name || taskId || "No active task"
    const terminalOwner = typeof existingExecution?.terminalInstanceId === "number"
      ? await terminateTerminalByInstanceId(existingExecution.terminalInstanceId)
      : undefined
    if (existingExecution && terminalOwner && !terminalOwner.success) {
      return buildTerminateProjectionFromExecution(existingExecution, terminalOwner, this.activeExecutions.size)
    }
    const event: TaskRunLifecycleEvent = {
      taskId,
      taskName,
      stepId: taskId,
      stepName: taskName,
      type: "terminated",
      status: "cancelled",
      exitCode: terminalOwner?.exitCode ?? null,
      runId: existingExecution?.runId || runId,
      executionId: existingExecution?.executionId || (taskId ? `${taskId}:${runId}` : runId),
      runType: task?.isBackground ? "background" : "singleRun",
      terminalId: existingExecution?.terminalInstanceId ?? this.lifecycleProjection.terminalInstanceId,
      processId: existingExecution?.processId ?? this.lifecycleProjection.processId,
      timestamp: Date.now(),
      source: "taskRunner",
    }
    this.lifecycleEvents.push(event)
    this.lifecycleEvents = this.lifecycleEvents.slice(-50)
    this.updateActiveExecutionMap(event)
    this.lifecycleProjection = buildTaskLifecycleProjection(this.lifecycleEvents, "terminate", this.getActiveExecutions(), this.latestInstancePolicy, this.getTerminalLastTasks())
    this.lastTaskId = ""
    userTasksService.setActiveTask("")
    return {
      success: existingExecution ? terminalOwner?.success === true : Boolean(taskId),
      taskId,
      taskName,
      action: "terminate",
      runId: event.runId,
      executionId: event.executionId,
      terminalInstanceId: event.terminalId,
      processId: event.processId,
      activeExecutionCount: this.activeExecutions.size,
      stateSource: "taskRunner/TaskSystemLifecycleProjection",
      terminalOwner,
    }
  }

  async terminateAllTasks(): Promise<TaskTerminateAllProjection> {
    const activeExecutions = this.getActiveExecutions()
    if (!canTerminateAllActiveExecutions(activeExecutions)) {
      return {
        success: false,
        action: "terminateAll",
        terminatedCount: 0,
        activeExecutionCount: activeExecutions.length,
        results: [],
        blocked: buildTerminateAllBlockedEvidence(activeExecutions),
        stateSource: "taskRunner/TaskSystemLifecycleProjection",
      }
    }

    const results: TaskTerminateProjection[] = []
    for (const execution of activeExecutions) {
      const owner = await terminateTerminalByInstanceId(execution.terminalInstanceId!)
      if (owner.success) {
        const event: TaskRunLifecycleEvent = {
          taskId: execution.taskId,
          taskName: execution.taskName,
          stepId: execution.taskId,
          stepName: execution.taskName,
          type: "terminated",
          status: "cancelled",
          exitCode: owner.exitCode,
          runId: execution.runId,
          executionId: execution.executionId,
          runType: execution.runType,
          terminalId: execution.terminalInstanceId,
          processId: execution.processId,
          timestamp: Date.now(),
          source: "taskRunner",
        }
        this.lifecycleEvents.push(event)
        this.lifecycleEvents = this.lifecycleEvents.slice(-50)
        this.updateActiveExecutionMap(event)
      }
      results.push(buildTerminateProjectionFromExecution(execution, owner, this.activeExecutions.size))
    }

    this.lifecycleProjection = buildTaskLifecycleProjection(this.lifecycleEvents, "terminate", this.getActiveExecutions(), this.latestInstancePolicy, this.getTerminalLastTasks())
    this.lastTaskId = ""
    userTasksService.setActiveTask("")
    return {
      success: results.length > 0 && results.every((result) => result.success),
      action: "terminateAll",
      terminatedCount: results.filter((result) => result.success).length,
      activeExecutionCount: this.activeExecutions.size,
      results,
      blocked: [],
      stateSource: "taskRunner/TaskSystemLifecycleProjection",
    }
  }

  async restartActiveTerminal(terminalInstanceId: number): Promise<TaskRestartActiveTerminalProjection> {
    const execution = findActiveExecutionByTerminalInstanceId(this.activeExecutions, terminalInstanceId)
    if (!execution) {
      const terminalLastTask = findTerminalLastTaskByInstanceId(this.terminalLastTaskMap, terminalInstanceId)
      if (!terminalLastTask) {
        return buildBlockedRestartActiveTerminalProjection(
          terminalInstanceId,
          "activeExecutionMap 中找不到该 terminalInstanceId 对应的运行中 task，terminalLastTaskMap 也没有 VS Code getTaskForTerminal 可用的 lastTask 回退",
          this.activeExecutions.size,
        )
      }
      const task = findTaskConfig(terminalLastTask.taskId)
      if (!task) {
        return buildBlockedRestartActiveTerminalProjection(
          terminalInstanceId,
          "terminalLastTaskMap 能定位 terminal 的 lastTask，但找不到可重新运行的 task definition",
          this.activeExecutions.size,
        )
      }
      this.lifecycleProjection = {
        ...this.lifecycleProjection,
        lastAction: "rerun",
        terminalLastTaskMap: this.getTerminalLastTasks(),
      }
      await this.reuseTerminalForTask(terminalInstanceId, task)
      const run = await this.runTask(task.id, this.lastRunOptions || {})
      return {
        success: run.status !== "failed",
        action: "restartActiveTerminal",
        taskId: task.id,
        taskName: task.name,
        runId: this.lifecycleProjection.runId,
        executionId: this.lifecycleProjection.executionId,
        terminalInstanceId: this.lifecycleProjection.terminalInstanceId,
        processId: this.lifecycleProjection.processId,
        activeExecutionCount: this.activeExecutions.size,
        terminalLastTask,
        run,
        stateSource: "taskRunner/TaskSystemLifecycleProjection",
      }
    }

    const task = findTaskConfig(execution.taskId)
    if (!task) {
      return buildBlockedRestartActiveTerminalProjection(
        terminalInstanceId,
        "activeExecutionMap 能定位 terminal，但找不到可重新运行的 task definition",
        this.activeExecutions.size,
        execution,
      )
    }

    if (!canTerminateTerminalByInstanceId(execution.terminalInstanceId)) {
      return buildBlockedRestartActiveTerminalProjection(
        terminalInstanceId,
        "该 terminalInstanceId 未解析到可 dispose/onExit 的真实 pty owner",
        this.activeExecutions.size,
        execution,
      )
    }

    const owner = await terminateTerminalByInstanceId(terminalInstanceId)
    if (!owner.success) {
      return {
        success: false,
        action: "restartActiveTerminal",
        taskId: execution.taskId,
        taskName: execution.taskName,
        runId: execution.runId,
        executionId: execution.executionId,
        terminalInstanceId,
        processId: execution.processId,
        activeExecutionCount: this.activeExecutions.size,
        reason: owner.reason || "terminal-owned terminate failed before rerun",
        terminate: buildTerminateProjectionFromExecution(execution, owner, this.activeExecutions.size),
        stateSource: "taskRunner/TaskSystemLifecycleProjection",
      }
    }

    const event: TaskRunLifecycleEvent = {
      taskId: execution.taskId,
      taskName: execution.taskName,
      stepId: execution.taskId,
      stepName: execution.taskName,
      type: "terminated",
      status: "cancelled",
      exitCode: owner.exitCode,
      runId: execution.runId,
      executionId: execution.executionId,
      runType: execution.runType,
      terminalId: execution.terminalInstanceId,
      processId: execution.processId,
      timestamp: Date.now(),
      source: "taskRunner",
    }
    this.lifecycleEvents.push(event)
    this.lifecycleEvents = this.lifecycleEvents.slice(-50)
    this.updateActiveExecutionMap(event)
    const terminateProjection = buildTerminateProjectionFromExecution(execution, owner, this.activeExecutions.size)
    this.lifecycleProjection = buildTaskLifecycleProjection(this.lifecycleEvents, "terminate", this.getActiveExecutions(), this.latestInstancePolicy, this.getTerminalLastTasks())

    this.lifecycleProjection = {
      ...this.lifecycleProjection,
      lastAction: "rerun",
    }
    await this.reuseTerminalForTask(terminalInstanceId, task)
    const run = await this.runTask(task.id, this.lastRunOptions || {})
    return {
      success: true,
      action: "restartActiveTerminal",
      taskId: task.id,
      taskName: task.name,
      runId: this.lifecycleProjection.runId,
      executionId: this.lifecycleProjection.executionId,
      terminalInstanceId: this.lifecycleProjection.terminalInstanceId,
      processId: this.lifecycleProjection.processId,
      activeExecutionCount: this.activeExecutions.size,
      terminate: terminateProjection,
      run,
      stateSource: "taskRunner/TaskSystemLifecycleProjection",
    }
  }

  getLatestEvidence(): TaskRunEvidence | null {
    return this.latestEvidence
  }

  getTasks(): TaskConfig[] {
    return userTasksService.getTasks()
  }

  clearEvidence(): void {
    this.latestEvidence = null
    this.latestProblemProjection = null
    this.lifecycleEvents = []
    this.activeExecutions.clear()
    this.terminalLastTaskMap.clear()
    this.lastTaskId = ""
    this.lastRunOptions = undefined
    this.providerTaskExecutionEvidence = null
    this.latestInstancePolicy = null
    this.latestPhysicalReuse = null
    this.lifecycleProjection = createEmptyTaskSystemLifecycleProjection()
  }

  getLifecycleEvents(): TaskRunLifecycleEvent[] {
    return this.lifecycleEvents.map((event) => ({ ...event }))
  }

  getTaskSnapshot(): TerminalDebugTaskWorkbenchSurfaceSnapshot["tasks"] {
    const contract = userTasksService.getContractSnapshot()
    return {
      serviceId: String(ITaskService),
      stateSource: TASK_CONFIG_STATE_SOURCE,
      viewId: TASK_WORKBENCH_VIEW_IDS.Container,
      runConfigCount: contract.counts.total,
      activeTaskId: contract.activeTaskId,
      latestEvidence: this.latestEvidence,
      latestProblemProjection: this.latestProblemProjection,
      lifecycle: this.lifecycleProjection,
      capabilities: buildTaskSystemCapabilitySnapshot(
        this.lifecycleProjection,
        this.getActiveExecutions(),
        this.providerTaskExecutionEvidence,
        this.latestProblemProjection,
        this.latestInstancePolicy,
        this.latestPhysicalReuse,
        this.getTerminalLastTasks(),
      ),
    }
  }

  private getActiveExecutions(): TaskActiveExecutionProjection[] {
    return [...this.activeExecutions.values()].map((execution) => ({ ...execution }))
  }

  private getTerminalLastTasks(): TaskTerminalLastTaskProjection[] {
    return [...this.terminalLastTaskMap.values()].map((entry) => ({ ...entry }))
  }

  private updateActiveExecutionMap(event: TaskRunLifecycleEvent): void {
    updateActiveExecutionMap(this.activeExecutions, event)
    updateTerminalLastTaskMap(this.terminalLastTaskMap, event)
    recordTaskTerminalReuseFromLifecycleEvent(event)
  }

  private updateProviderTaskExecutionEvidence(task: TaskConfig): void {
    if (task.source !== "extensionProvider") return
    const activeExecutionMapped = this.lifecycleProjection.activeExecutionMap.some((execution) => execution.taskId === task.id)
    const terminalTaskOwner = resolveTaskTerminalTaskOwnerEvidence(
      this.getActiveExecutions(),
      this.getTerminalLastTasks(),
      task.id,
    )
    const lastOwnerEvent = [...this.lifecycleEvents]
      .reverse()
      .find((event) => event.taskId === task.id && (typeof event.terminalId === "number" || typeof event.processId === "number"))
    const terminalOwnerResolved = terminalTaskOwner.terminalOwnerResolved
    const finishedRunTerminalOwnerBlockedReason = buildFinishedRunTerminalOwnerBlockedReason(
      this.lifecycleProjection,
      activeExecutionMapped,
      terminalOwnerResolved,
    )
    const lastTerminalInstanceId = typeof lastOwnerEvent?.terminalId === "number"
      ? lastOwnerEvent.terminalId
      : this.lifecycleProjection.terminalInstanceId
    const lastProcessId = typeof lastOwnerEvent?.processId === "number"
      ? lastOwnerEvent.processId
      : this.lifecycleProjection.processId
    this.providerTaskExecutionEvidence = {
      taskId: task.id,
      taskName: task.name,
      providerType: task.providerType || task.type,
      runType: this.lifecycleProjection.activeExecutionMap.find((execution) => execution.taskId === task.id)?.runType || "singleRun",
      runId: this.lifecycleProjection.runId,
      executionId: this.lifecycleProjection.executionId,
      terminalInstanceId: this.lifecycleProjection.terminalInstanceId,
      processId: this.lifecycleProjection.processId,
      lastTerminalInstanceId,
      lastProcessId,
      terminalOwnerCreated: typeof lastTerminalInstanceId === "number",
      activeExecutionMapped,
      terminalOwnerResolved,
      terminalTaskOwner,
      blockedReason: terminalOwnerResolved
        ? ""
        : buildProviderTaskExecutionOwnerBlockedReason(this.lifecycleProjection, activeExecutionMapped),
      finishedRunTerminalOwnerBlockedReason,
      missingOwner: terminalOwnerResolved
        ? ""
        : "terminalManager pty dispose/onExit owner returned by the provider task execution bridge",
      nextAuthorizedFiles: [
        "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
        "frontend/vite-project/src/workbench/taskRunner.ts",
        "frontend/vite-project/src/terminal/terminalManager.ts",
        "desktop/services/extensions-host/mainThread/mainThreadTask.js",
      ],
      stateSource: "taskRunner/TaskSystemLifecycleProjection",
    }
  }

  private attachShellLaunchConfigToLatestTerminal(task: TaskConfig): void {
    const terminalInstanceId = this.lifecycleProjection.terminalInstanceId
    const terminal = typeof terminalInstanceId === "number"
      ? globalTerminalService.instances.find((instance) => instance.instanceId === terminalInstanceId)
      : null
    if (!terminal) return
    terminal.shellLaunchConfig = this.createShellLaunchConfig(task, terminal)
  }

  private async reuseTerminalForTask(terminalInstanceId: number, task: TaskConfig): Promise<void> {
    const terminal = globalTerminalService.instances.find((instance) => instance.instanceId === terminalInstanceId)
    if (!terminal) return
    await terminal.reuseTerminal(this.createShellLaunchConfig(task, terminal))
  }

  private prepareTaskTerminalPhysicalReuse(
    task: TaskConfig,
    options: TaskRunServiceOptions,
  ): TaskTerminalPhysicalReuseProjection | null {
    const candidate = selectTaskTerminalReuseCandidate(this.terminalLastTaskMap, task)
    if (!candidate) return null
    const cwd = options.workspaceFolder || task.workingDir || ""
    const terminalOwner = reuseTaskTerminalForLaunchConfig(candidate.entry.terminalInstanceId, {
      taskId: task.id,
      taskName: task.name,
      commandLine: task.command,
      cwd,
      group: task.group || "",
      reuseKind: candidate.reuseKind,
      source: "TerminalTaskSystem.reuseTerminal(launchConfigs)",
    })
    return {
      success: terminalOwner.success,
      terminalInstanceId: terminalOwner.terminalInstanceId,
      taskId: task.id,
      taskName: task.name,
      commandLine: task.command,
      cwd,
      group: task.group || "",
      reuseKind: candidate.reuseKind,
      reason: terminalOwner.reason,
      terminalOwner,
      stateSource: "taskRunner/terminalLastTaskMap",
      vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
      currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
      runtimeReference: false,
    }
  }

  private createShellLaunchConfig(
    task: TaskConfig,
    terminal: WorkbenchTerminalInstance,
  ): TaskTerminalShellLaunchConfigEvidence {
    return {
      type: "Task",
      cwd: task.workingDir || terminal.cwd || "",
      taskId: task.id,
      taskName: task.name,
      isFeatureTerminal: true,
      useShellEnvironment: true,
      tabActions: buildTaskTerminalTabActionEvidence(this.getActiveExecutions(), this.getTerminalLastTasks()),
      reuseCount: terminal.shellLaunchConfig?.reuseCount ?? 0,
      lastReuseTaskId: terminal.shellLaunchConfig?.lastReuseTaskId || "",
      stateSource: "TaskWorkbenchAdapterService/shellLaunchConfig",
      vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
      currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
      runtimeReference: false,
    }
  }

  private async handleInstancePolicy(task: TaskConfig): Promise<{ blockedEvidence?: TaskRunEvidence }> {
    const decision = getActiveRunInstancePolicyDecision(this.activeExecutions, task)
    this.latestInstancePolicy = decision.evidence
    this.lifecycleProjection = {
      ...this.lifecycleProjection,
      latestInstancePolicy: this.latestInstancePolicy,
      activeExecutionCount: this.activeExecutions.size,
      activeExecutionMap: this.getActiveExecutions(),
      supportsMultipleExecutions: true,
    }

    if (decision.action === "allow") return {}

    if (decision.action === "prompt") {
      const selectedExecution = await promptTaskInstanceSelection(task, decision.evidence, decision.sameTaskExecutions)
      if (!selectedExecution) {
        return { blockedEvidence: buildInstancePolicyBlockedEvidence(task, decision.evidence) }
      }
      await this.applyInstancePolicyTermination(selectedExecution, decision.evidence)
      return {}
    }

    if (decision.action === "warn" || decision.action === "silent") {
      return { blockedEvidence: buildInstancePolicyBlockedEvidence(task, decision.evidence) }
    }

    if (decision.target) {
      await this.applyInstancePolicyTermination(decision.target, decision.evidence)
    }

    return {}
  }

  private async applyInstancePolicyTermination(
    execution: TaskActiveExecutionProjection,
    evidence: TaskInstancePolicyEvidence,
  ): Promise<void> {
    const terminalOwner = await terminateTerminalByInstanceId(execution.terminalInstanceId)
    const event = buildTerminateEventFromExecution(execution, terminalOwner.exitCode)
    this.lifecycleEvents.push(event)
    this.lifecycleEvents = this.lifecycleEvents.slice(-50)
    this.updateActiveExecutionMap(event)
    this.latestInstancePolicy = {
      ...evidence,
      status: "handled",
      selectedExecutionId: execution.executionId,
      selectedTaskName: execution.taskName,
      terminalInstanceId: execution.terminalInstanceId,
      processId: execution.processId,
      quickPickSelection: evidence.action === "prompt" ? execution.executionId : evidence.quickPickSelection,
      reason: terminalOwner.success
        ? evidence.reason
        : `${evidence.reason}; terminal owner unresolved, taskRunner active execution projection was cleared only`,
    }
    this.lifecycleProjection = buildTaskLifecycleProjection(this.lifecycleEvents, "terminate", this.getActiveExecutions(), this.latestInstancePolicy, this.getTerminalLastTasks())
  }
}

class ProblemsWorkbenchAdapterService implements ProblemsWorkbenchService {
  declare readonly _serviceBrand: undefined

  getProblemsSnapshot(): ProblemsWorkbenchSnapshot {
    return buildProblemsWorkbenchSnapshot()
  }
}

class PaneCompositePartAdapterService implements PaneCompositePartService {
  declare readonly _serviceBrand: undefined
  private bridge: TerminalDebugTaskWorkbenchUiBridge = {}

  constructor(private readonly layoutService: IWorkbenchLayoutService = globalWorkbenchLayoutService) {}

  setBridge(bridge: TerminalDebugTaskWorkbenchUiBridge = {}): void {
    this.bridge = bridge
  }

  async openPaneComposite(id: string, focus = true): Promise<void> {
    this.layoutService.openPaneComposite(id, "panel", focus)
    this.bridge.onEvidence?.({ source: "paneCompositePartService", action: "openPanel", detail: { id } })
    await this.bridge.openPanel?.(id)
  }

  async togglePaneComposite(id: string): Promise<void> {
    this.layoutService.togglePaneComposite(id, "panel", true)
    this.bridge.onEvidence?.({ source: "paneCompositePartService", action: "togglePanel", detail: { id } })
    await this.bridge.togglePanel?.(id)
  }

  async openDebugView(id = DEBUG_WORKBENCH_VIEW_IDS.Container): Promise<void> {
    this.layoutService.openPaneComposite(id, "sideBar", true)
    this.bridge.onEvidence?.({ source: "paneCompositePartService", action: "openDebugView", detail: { id } })
    await this.bridge.openDebugView?.(id)
  }

  async openTasks(id = TASK_WORKBENCH_VIEW_IDS.Container): Promise<void> {
    this.layoutService.openPaneComposite(id, "sideBar", true)
    this.bridge.onEvidence?.({ source: "paneCompositePartService", action: "openTasks", detail: { id } })
    await this.bridge.openTasks?.(id)
  }

  async openProblems(): Promise<void> {
    this.layoutService.openPaneComposite(TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer, "panel", true)
    this.bridge.onEvidence?.({
      source: "paneCompositePartService",
      action: "openProblems",
      detail: { id: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems },
    })
    await this.bridge.openProblems?.(TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems)
  }

  getEvidence(): PaneCompositePartEvidence {
    return createPaneCompositeEvidenceFromLayout(this.layoutService.createPaneCompositeSnapshot())
  }

  clearEvidence(): void {
    this.layoutService.clearPaneCompositeLifecycle()
  }

  clear(): void {
    this.bridge = {}
    this.clearEvidence()
  }
}

export class TerminalDebugTaskWorkbenchService implements TerminalDebugTaskWorkbenchServiceFacade {
  declare readonly _serviceBrand: undefined
  private readonly terminalService: TerminalService
  private readonly outputService: CodekOutputService
  private readonly debugService: DebugWorkbenchService
  private readonly taskService: TaskWorkbenchService
  private readonly problemsService: ProblemsWorkbenchService
  private readonly paneCompositePartService: PaneCompositePartService

  constructor(services: {
    terminalService?: TerminalService
    outputService?: CodekOutputService
    debugService?: DebugWorkbenchService
    taskService?: TaskWorkbenchService
    problemsService?: ProblemsWorkbenchService
    paneCompositePartService?: PaneCompositePartService
  } = {}) {
    this.terminalService = services.terminalService || globalTerminalService
    this.outputService = services.outputService || globalCodekOutputService
    this.debugService = services.debugService || globalDebugService
    this.taskService = services.taskService || globalTaskService
    this.problemsService = services.problemsService || globalProblemsWorkbenchService
    this.paneCompositePartService = services.paneCompositePartService || globalPaneCompositePartService
  }

  getSurfaceSnapshot(): TerminalDebugTaskWorkbenchSurfaceSnapshot {
    return {
      source: "terminalDebugTaskWorkbenchService",
      serviceId: String(ITerminalDebugTaskWorkbenchService),
      vscodeServiceIds: [
        String(ITerminalService),
        String(IOutputService),
        String(IDebugService),
        String(ITaskService),
        String(IProblemsWorkbenchService),
        String(IPaneCompositePartService),
      ],
      viewIds: [
        TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal,
        TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output,
        TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer,
        TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems,
        DEBUG_WORKBENCH_VIEW_IDS.Container,
        DEBUG_WORKBENCH_VIEW_IDS.Variables,
        DEBUG_WORKBENCH_VIEW_IDS.Watch,
        DEBUG_WORKBENCH_VIEW_IDS.CallStack,
        DEBUG_WORKBENCH_VIEW_IDS.Breakpoints,
        DEBUG_WORKBENCH_VIEW_IDS.Console,
        TASK_WORKBENCH_VIEW_IDS.Container,
        TASK_WORKBENCH_VIEW_IDS.Tasks,
        TASK_WORKBENCH_VIEW_IDS.ProblemMatchers,
      ],
      commandIds: Object.values(TERMINAL_DEBUG_TASK_COMMAND_IDS),
      stateSource: "facade",
      contributionSurface: buildTerminalDebugTaskWorkbenchContributionSurface(),
      terminal: this.terminalService.getEvidence(),
      output: this.outputService.getOutputSnapshot(),
      debug: this.debugService.getSessionEvidence(),
      tasks: this.taskService.getTaskSnapshot(),
      problems: this.problemsService.getProblemsSnapshot(),
      paneComposite: this.paneCompositePartService.getEvidence(),
      constraints: {
        noSecondTerminalState: true,
        noSecondOutputState: true,
        noSecondDebugState: true,
        noSecondTaskState: true,
        problemsReadOnlyBridge: true,
        preservesAgentEvidenceProgress: true,
        viewActionMenuDriven: true,
        evidenceSafeCommandBoundary: true,
      },
    }
  }

  clearEvidence(): void {
    this.paneCompositePartService.clearEvidence()
    this.taskService.clearEvidence()
  }
}

export const globalTerminalService = new TerminalWorkbenchAdapterService()
export const globalCodekOutputService = new OutputWorkbenchAdapterService()
export const globalDebugService = new DebugWorkbenchAdapterService()
export const globalTaskService = new TaskWorkbenchAdapterService()
export const globalProblemsWorkbenchService = new ProblemsWorkbenchAdapterService()
export const globalPaneCompositePartService = new PaneCompositePartAdapterService()
export const globalTerminalDebugTaskWorkbenchService = new TerminalDebugTaskWorkbenchService({
  terminalService: globalTerminalService,
  outputService: globalCodekOutputService,
  debugService: globalDebugService,
  taskService: globalTaskService,
  problemsService: globalProblemsWorkbenchService,
  paneCompositePartService: globalPaneCompositePartService,
})

registerSingleton(ITerminalService, globalTerminalService, InstantiationType.Delayed)
registerSingleton(IOutputService, globalCodekOutputService, InstantiationType.Delayed)
registerSingleton(ICodekOutputService, globalCodekOutputService, InstantiationType.Delayed)
registerSingleton(IDebugService, globalDebugService, InstantiationType.Delayed)
registerSingleton(ITaskService, globalTaskService, InstantiationType.Delayed)
registerSingleton(IProblemsWorkbenchService, globalProblemsWorkbenchService, InstantiationType.Delayed)
registerSingleton(IPaneCompositePartService, globalPaneCompositePartService, InstantiationType.Delayed)
registerSingleton(ITerminalDebugTaskWorkbenchService, globalTerminalDebugTaskWorkbenchService, InstantiationType.Delayed)

let registrations: Disposable[] = []

export function registerTerminalDebugTaskWorkbenchContributions(
  options: RegisterTerminalDebugTaskWorkbenchOptions = {},
): Disposable {
  disposeTerminalDebugTaskWorkbenchContributions()
  globalPaneCompositePartService.setBridge(options)
  registerTerminalDebugTaskWorkbenchViews({ debugActivityView: options.registerDebugActivityView !== false })

  const service = options.service || globalTerminalDebugTaskWorkbenchService
  void service
  registrations = [
    registerAction2(class ToggleTerminalAction extends Action2 {
      constructor() {
        super({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalToggle,
          title: "终端：切换终端",
          category: "终端",
          f1: true,
          source: "vscode",
          menu: [
            { id: MenuId.MenubarViewMenu, group: "4_panel", order: 20 },
            { id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal}`, group: "navigation", order: 10 },
          ],
        })
      }

      async run(): Promise<void> {
        await globalPaneCompositePartService.togglePaneComposite(TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal)
      }
    }),
    registerAction2(class NewTerminalAction extends Action2 {
      constructor() {
        super({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalNew,
          title: "终端：新建终端",
          category: "终端",
          f1: true,
          source: "vscode",
          menu: { id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal}`, group: "navigation", order: 20 },
        })
      }

      async run(): Promise<void> {
        globalTerminalService.createTerminal("powershell", "")
        await globalPaneCompositePartService.openPaneComposite(TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal)
      }
    }),
    registerAction2(class SplitTerminalAction extends Action2 {
      constructor() {
        super({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalSplit,
          title: "终端：拆分终端",
          category: "终端",
          f1: true,
          source: "vscode",
          menu: { id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal}`, group: "navigation", order: 30 },
        })
      }

      async run(): Promise<void> {
        globalTerminalService.splitTerminal("powershell", "")
        await globalPaneCompositePartService.openPaneComposite(TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal)
      }
    }),
    registerAction2(class ClearTerminalAction extends Action2 {
      constructor() {
        super({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalClear,
          title: "终端：清空",
          category: "终端",
          f1: true,
          source: "vscode",
          menu: { id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal}`, group: "navigation", order: 40 },
        })
      }

      run(): void {
        globalCodekOutputService.appendLine("Terminal", "Terminal clear requested")
      }
    }),
    registerAction2(class RunActiveFileInTerminalAction extends Action2 {
      constructor() {
        super({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalRunActiveFile,
          title: "终端：运行当前文件",
          category: "终端",
          f1: true,
          source: "vscode",
        })
      }

      run(): void {
        globalCodekOutputService.appendLine("Terminal", "Run active file requested from workbench command")
      }
    }),
    registerAction2(class RunSelectedTextInTerminalAction extends Action2 {
      constructor() {
        super({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalRunSelectedText,
          title: "终端：运行选中文本",
          category: "终端",
          f1: true,
          source: "vscode",
        })
      }

      run(): void {
        globalCodekOutputService.appendLine("Terminal", "Run selected text requested from workbench command")
      }
    }),
    registerAction2(class ShowOutputAction extends Action2 {
      constructor() {
        super({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputShow,
          title: "输出：显示输出",
          category: "输出",
          f1: true,
          source: "vscode",
          menu: [
            { id: MenuId.MenubarViewMenu, group: "4_panel", order: 30 },
            { id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output}`, group: "navigation", order: 10 },
          ],
        })
      }

      async run(_accessor: unknown, channelName?: unknown): Promise<void> {
        globalCodekOutputService.showChannel(typeof channelName === "string" ? channelName : undefined)
        await globalPaneCompositePartService.openPaneComposite(TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output)
      }
    }),
    registerAction2(class ClearOutputAction extends Action2 {
      constructor() {
        super({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputClear,
          title: "输出：清空输出",
          category: "输出",
          f1: true,
          source: "vscode",
          menu: { id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output}`, group: "navigation", order: 20 },
        })
      }

      run(_accessor: unknown, channelName?: unknown): void {
        globalCodekOutputService.clearChannel(typeof channelName === "string" ? channelName : undefined)
      }
    }),
    registerAction2(class OpenDebugAction extends Action2 {
      constructor() {
        super({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugOpen,
          title: "调试：打开运行和调试",
          category: "调试",
          f1: true,
          source: "vscode",
          menu: { id: MenuId.MenubarViewMenu, group: "1_views", order: 130 },
        })
      }

      async run(): Promise<void> {
        await globalPaneCompositePartService.openDebugView(DEBUG_WORKBENCH_VIEW_IDS.Container)
      }
    }),
    registerAction2(class StartDebugAction extends Action2 {
      constructor() {
        super({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugStart,
          title: "调试：开始调试",
          category: "调试",
          f1: true,
          source: "vscode",
          menu: { id: MenuId.ViewTitle, when: `view == ${DEBUG_WORKBENCH_VIEW_IDS.Container}`, group: "navigation", order: 10 },
        })
      }

      async run(_accessor: unknown, configId?: unknown): Promise<void> {
        await globalDebugService.start(typeof configId === "string" ? configId : undefined)
      }
    }),
    registerAction2(class StopDebugAction extends Action2 {
      constructor() {
        super({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugStop,
          title: "调试：停止",
          category: "调试",
          f1: true,
          source: "vscode",
          menu: { id: MenuId.ViewTitle, when: `view == ${DEBUG_WORKBENCH_VIEW_IDS.Container}`, group: "navigation", order: 20 },
        })
      }

      async run(): Promise<void> {
        await globalDebugService.stop()
      }
    }),
    registerAction2(class OpenTasksAction extends Action2 {
      constructor() {
        super({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksOpen,
          title: "任务：打开任务",
          category: "任务",
          f1: true,
          source: "vscode",
          menu: { id: MenuId.MenubarViewMenu, group: "1_views", order: 135 },
        })
      }

      async run(): Promise<void> {
        globalTaskService.openTasks()
        await globalPaneCompositePartService.openTasks(TASK_WORKBENCH_VIEW_IDS.Container)
      }
    }),
    registerAction2(class RunTaskAction extends Action2 {
      constructor() {
        super({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRun,
          title: "任务：运行任务",
          category: "任务",
          f1: true,
          source: "vscode",
          menu: { id: MenuId.ViewTitle, when: `view == ${TASK_WORKBENCH_VIEW_IDS.Container}`, group: "navigation", order: 10 },
        })
      }

      async run(_accessor: unknown, taskIdOrName?: unknown): Promise<void> {
        await globalTaskService.runTask(typeof taskIdOrName === "string" ? taskIdOrName : undefined)
      }
    }),
    registerAction2(class RerunTaskAction extends Action2 {
      constructor() {
        super({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerun,
          title: "任务：重新运行任务",
          category: "任务",
          f1: true,
          source: "vscode",
          menu: { id: MenuId.ViewTitle, when: `view == ${TASK_WORKBENCH_VIEW_IDS.Container}`, group: "navigation", order: 20 },
        })
      }

      async run(): Promise<void> {
        await globalTaskService.rerunTask()
      }
    }),
    registerAction2(class RerunTaskForActiveTerminalAction extends Action2 {
      constructor() {
        super({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal,
          title: "任务：在当前终端重新运行任务",
          category: "任务",
          f1: true,
          source: "vscode",
          menu: { id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal}`, group: "navigation", order: 50 },
        })
      }

      async run(_accessor: unknown, terminalInstanceId?: unknown): Promise<void> {
        const instanceId = typeof terminalInstanceId === "number"
          ? terminalInstanceId
          : globalTaskService.getTaskSnapshot().lifecycle.terminalInstanceId
        if (typeof instanceId === "number") {
          await globalTaskService.restartActiveTerminal(instanceId)
          return
        }
        await globalTaskService.rerunTask()
      }
    }),
    registerAction2(class TerminateTaskAction extends Action2 {
      constructor() {
        super({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminate,
          title: "任务：终止任务",
          category: "任务",
          f1: true,
          source: "vscode",
          menu: { id: MenuId.ViewTitle, when: `view == ${TASK_WORKBENCH_VIEW_IDS.Container}`, group: "navigation", order: 30 },
        })
      }

      async run(_accessor: unknown, taskIdOrName?: unknown): Promise<void> {
        await globalTaskService.terminateTask(typeof taskIdOrName === "string" ? taskIdOrName : undefined)
      }
    }),
    registerAction2(class TerminateAllTasksAction extends Action2 {
      constructor() {
        super({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll,
          title: "任务：终止全部任务",
          category: "任务",
          f1: true,
          source: "vscode",
          menu: { id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal}`, group: "navigation", order: 60 },
        })
      }

      async run(): Promise<void> {
        await globalTaskService.terminateAllTasks()
      }
    }),
    registerAction2(class ToggleProblemsAction extends Action2 {
      constructor() {
        super({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.ProblemsToggle,
          title: "问题：切换问题面板",
          category: "问题",
          f1: true,
          source: "vscode",
          menu: [
            { id: MenuId.MenubarViewMenu, group: "4_panel", order: 40 },
            { id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems}`, group: "navigation", order: 10 },
          ],
        })
      }

      async run(): Promise<void> {
        await globalPaneCompositePartService.openProblems()
      }
    }),
    registerAction2(class FocusProblemsAction extends Action2 {
      constructor() {
        super({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.ProblemsFocus,
          title: "问题：聚焦问题面板",
          category: "问题",
          f1: true,
          source: "vscode",
          menu: { id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems}`, group: "navigation", order: 20 },
        })
      }

      async run(): Promise<void> {
        await globalPaneCompositePartService.openProblems()
      }
    }),
  ]

  return { dispose: disposeTerminalDebugTaskWorkbenchContributions }
}

export function disposeTerminalDebugTaskWorkbenchContributions(): void {
  for (const disposable of registrations) disposable.dispose()
  registrations = []
}

function registerTerminalDebugTaskWorkbenchViews(options: { debugActivityView?: boolean } = {}): void {
  registerViewContainer({
    id: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal,
    name: "Terminal",
    location: "panel",
    icon: "terminal",
    source: "vscode",
    order: 10,
  })
  registerView({
    id: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal,
    name: "Terminal",
    containerId: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal,
    location: "panel",
    source: "vscode",
    order: 10,
  })
  registerViewContainer({
    id: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output,
    name: "Output",
    location: "panel",
    icon: "output",
    source: "vscode",
    order: 20,
  })
  registerView({
    id: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output,
    name: "Output",
    containerId: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output,
    location: "panel",
    source: "vscode",
    order: 20,
  })
  registerViewContainer({
    id: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer,
    name: "Problems",
    location: "panel",
    icon: "warning",
    source: "vscode",
    order: 30,
  })
  registerView({
    id: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems,
    name: "Problems",
    containerId: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer,
    location: "panel",
    source: "vscode",
    order: 30,
  })
  if (options.debugActivityView !== false) {
    registerViewContainer({
      id: DEBUG_WORKBENCH_VIEW_IDS.Container,
      name: "运行和调试",
      location: "activityBar",
      icon: "debug",
      source: "vscode",
      order: 40,
    })
    registerView({ id: DEBUG_WORKBENCH_VIEW_IDS.Variables, name: "变量", containerId: DEBUG_WORKBENCH_VIEW_IDS.Container, location: "sideBar", source: "vscode", order: 10 })
    registerView({ id: DEBUG_WORKBENCH_VIEW_IDS.Watch, name: "监视", containerId: DEBUG_WORKBENCH_VIEW_IDS.Container, location: "sideBar", source: "vscode", order: 20 })
    registerView({ id: DEBUG_WORKBENCH_VIEW_IDS.CallStack, name: "调用栈", containerId: DEBUG_WORKBENCH_VIEW_IDS.Container, location: "sideBar", source: "vscode", order: 30 })
    registerView({ id: DEBUG_WORKBENCH_VIEW_IDS.Breakpoints, name: "断点", containerId: DEBUG_WORKBENCH_VIEW_IDS.Container, location: "sideBar", source: "vscode", order: 40 })
    registerView({ id: DEBUG_WORKBENCH_VIEW_IDS.Console, name: "调试控制台", containerId: DEBUG_WORKBENCH_VIEW_IDS.Container, location: "panel", source: "vscode", order: 50 })
  }
  registerViewContainer({
    id: TASK_WORKBENCH_VIEW_IDS.Container,
    name: "任务",
    location: "panel",
    icon: "tasklist",
    source: "vscode",
    order: 40,
  })
  registerView({ id: TASK_WORKBENCH_VIEW_IDS.Tasks, name: "任务", containerId: TASK_WORKBENCH_VIEW_IDS.Container, location: "panel", source: "vscode", order: 10 })
  registerView({ id: TASK_WORKBENCH_VIEW_IDS.ProblemMatchers, name: "问题匹配器", containerId: TASK_WORKBENCH_VIEW_IDS.Container, location: "panel", source: "vscode", order: 20 })
}

export function buildTerminalWorkbenchEvidence(lastCreatedTerminalId = ""): TerminalWorkbenchEvidence {
  const terminals = getAllTerminals()
  const activeTerminal = getActiveTerminal()
  const contracts = getTerminalContractProjections()
  const activeContract = contracts.find((contract) => contract.terminalId === activeTerminal?.id)
  const latestCommandContract = [...contracts].reverse().find((contract) => contract.commandBoundary.lastCommandLine)
  return {
    serviceId: String(ITerminalService),
    stateSource: "terminalManager",
    terminalCount: terminals.length,
    activeTerminalId: activeTerminal?.id || "",
    activeTerminalName: activeTerminal?.name || "",
    activeTerminalCwd: activeTerminal?.cwd || "",
    visibleTerminalIds: terminals.filter((terminal) => terminal.groupId === (activeTerminal?.groupId || terminal.groupId)).map((terminal) => terminal.id),
    shellIntegrationCount: terminals.filter((terminal) => terminal.shellIntegrationAvailable).length,
    recentCommandCount: terminals.reduce((total, terminal) => total + terminal.recentCommands.length, 0),
    lastCreatedTerminalId,
    profileCount: getTerminalProfiles().length,
    activeProfileName: activeTerminal?.profile.profileName || "",
    environmentSource: "terminalProfileResolverService/terminalEnvironment",
    ptyHostBridge: {
      source: "ptyHostService/ptyHostBridge",
      stateSource: "terminalManager",
      lifecycleSource: "terminalProcessLifecycle",
      attachedCount: contracts.filter((contract) => contract.ptyHostBridge.ptyId).length,
      exitedCount: contracts.filter((contract) => contract.ptyHostBridge.status === "exited").length,
      activePtyId: activeContract?.ptyHostBridge.ptyId || "",
      activePid: activeContract?.ptyHostBridge.pid ?? null,
      sessions: contracts.map((contract) => contract.ptyHostBridge),
    },
    processLifecycle: {
      source: "terminalProcessLifecycle",
      stateSource: "terminalManager",
      runningCount: contracts.filter((contract) => contract.processLifecycle.status === "running").length,
      exitedCount: contracts.filter((contract) => contract.processLifecycle.status === "exited").length,
      activeStatus: activeContract?.processLifecycle.status || "",
      activeExitCode: activeContract?.processLifecycle.exitCode ?? null,
      sessions: contracts.map((contract) => contract.processLifecycle),
    },
    commandBoundary: {
      source: "terminalShellIntegration/evidenceSafeCommandBoundary",
      stateSource: "terminalManager",
      shellIntegrationCount: terminals.filter((terminal) => terminal.shellIntegrationAvailable).length,
      recentCommandCount: terminals.reduce((total, terminal) => total + terminal.recentCommands.length, 0),
      activeCommandLine: activeContract?.commandBoundary.activeCommandLine || "",
      lastCommandLine: latestCommandContract?.commandBoundary.lastCommandLine || "",
      lastExitCode: latestCommandContract?.commandBoundary.lastExitCode ?? null,
      requiresWorkspaceTrust: true,
      writesGitIndex: false,
    },
    taskTerminalReuseRegistry: getTaskTerminalReuseRegistrySnapshot(),
  }
}

export function buildDebugSessionEvidence(runtime: DebugSessionEvidence["runtime"] = "debugState"): DebugSessionEvidence {
  const activeConfig = debugState.activeConfig.value
  return {
    serviceId: String(IDebugService),
    stateSource: runtime === "debugRuntime" ? "debugState/debugRuntime" : "debugState",
    viewId: DEBUG_WORKBENCH_VIEW_IDS.Container,
    runtime,
    sessionId: debugState.sessionId.value || "",
    isRunning: debugState.isRunning.value,
    paused: debugState.paused.value,
    activeConfigId: debugState.activeConfigId.value,
    activeConfigName: activeConfig?.name || "",
    runConfigCount: debugState.runConfigs.length,
    breakpointCount: debugState.breakpoints.value.length,
    stackFrameCount: debugState.stackFrames.value.length,
    variableCount: debugState.variables.value.length,
    watchCount: debugState.watchEntries.value.length,
    consoleEntryCount: debugState.consoleOutput.value.length,
  }
}

export function buildProblemsWorkbenchSnapshot(): ProblemsWorkbenchSnapshot {
  const diagnostics = globalProblemsDiagnosticsService.getDiagnostics()
  const summary = globalProblemsDiagnosticsService.getSummary(diagnostics)
  return {
    serviceId: String(IProblemsWorkbenchService),
    stateSource: "problemsDiagnosticsService(globalMarkerService)",
    containerId: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer,
    viewId: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems,
    diagnosticCount: summary.diagnosticCount,
    errorCount: summary.errorCount,
    warningCount: summary.warningCount,
    infoCount: summary.infoCount,
    aiCount: summary.aiCount,
    fileCount: summary.fileCount,
    sourceNames: summary.sourceNames,
    diagnostics,
  }
}

function buildOutputWorkbenchSnapshot(
  channelName: string,
  activeChannelName: string,
  visibleChannelName: string,
  entries: OutputLogEntry[],
  channelDescriptors: OutputChannelDescriptor[] = buildOutputChannelDescriptors(),
): OutputWorkbenchSnapshot {
  const telemetrySnapshot = globalOutputLogTelemetryService.getOutputSnapshot(channelName)
  return {
    serviceId: String(IOutputService),
    stateSource: "outputLogTelemetryService",
    viewId: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output,
    channelName,
    activeChannelName,
    visibleChannelName,
    channelNames: globalOutputLogTelemetryService.getAllChannelNames(),
    channelDescriptors,
    entryCount: entries.length,
    warnCount: entries.filter((entry) => entry.level === "warn").length,
    errorCount: entries.filter((entry) => entry.level === "error").length,
    updateMode: telemetrySnapshot.updateMode,
    preview: entries.map((entry) => entry.message).join("").slice(0, 2000),
    ownerEvidence: telemetrySnapshot.ownerEvidence,
  }
}

function buildOutputChannelDescriptors(): OutputChannelDescriptor[] {
  return globalCodekOutputService.getChannelDescriptors()
}

const TASK_PROBLEM_LIFECYCLE_EVIDENCE = {
  taskServiceOwner: "UserTasksService + TaskWorkbenchAdapterService",
  problemMatcherOwner: "ProblemMatcherRegistry",
  taskTerminalOwner: "TaskWorkbenchAdapterService taskRunner lifecycle",
  markerOwner: "globalMarkerService owner buckets (compiler/lint)",
  diagnosticSource: "taskProblems.applyTaskProblemDiagnostics -> compiler/lint",
  taskOutputSource: "taskRunner stdout/stderr command result",
  remainingUiOwnerGap: "Task terminal UI owner remains partial until TerminalTaskSystem/generic shell owner is wired",
  collectorOwner: "taskRunner command-output collector",
  registryOwner: "ProblemMatcherRegistry",
  vscodeOwner: "TerminalTaskSystem StartStopProblemCollector/WatchingProblemCollector + ProblemMatcherRegistry",
  currentOwner: "taskRunner command-output collector + taskProblems.applyTaskProblemDiagnostics + global marker lifecycle",
  vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
  currentSourcePath: "frontend/vite-project/src/workbench/taskRunner.ts",
  registrySourcePath: "frontend/vite-project/src/vscode-adapter/workbench/contrib/tasks/common/problemMatcher.ts",
  runtimeReference: false,
} satisfies Pick<
  TaskProblemProjectionEvidence,
  | "taskServiceOwner"
  | "problemMatcherOwner"
  | "taskTerminalOwner"
  | "markerOwner"
  | "diagnosticSource"
  | "taskOutputSource"
  | "remainingUiOwnerGap"
  | "collectorOwner"
  | "registryOwner"
  | "vscodeOwner"
  | "currentOwner"
  | "vscodeSourcePath"
  | "currentSourcePath"
  | "registrySourcePath"
  | "runtimeReference"
>

function projectTaskProblems(
  steps: TaskRunStep[],
  previousProjection: TaskProblemProjectionEvidence | null = null,
): TaskProblemProjectionEvidence | null {
  let total = 0
  const files = new Set<string>()
  const clearedFiles = new Set(previousProjection?.files || [])
  const taskIds = new Set<string>()
  for (const step of steps) {
    if (!step.config.problemMatchers?.length) continue
    taskIds.add(step.config.id)
    const output = `${step.stdout || ""}\n${step.stderr || step.error || ""}`
    const result = applyTaskProblemDiagnostics(output, step.config.problemMatchers, problemState, {
      clearFiles: [...clearedFiles],
    })
    clearedFiles.clear()
    total += result.total
    for (const file of result.files) files.add(file)
  }

  if (total === 0 && clearedFiles.size === 0 && taskIds.size === 0) return null
  return {
    total,
    files: [...files].sort(),
    matchedFiles: [...files].sort(),
    clearedFiles: [...new Set(previousProjection?.files || [])].filter((file) => !files.has(file)).sort(),
    taskIds: [...taskIds].sort(),
    stateSource: "problemsDiagnosticsService(globalMarkerService)",
    ...TASK_PROBLEM_LIFECYCLE_EVIDENCE,
  }
}

function appendDebugConsole(type: "system" | "output" | "error" | "input", text: string): void {
  debugState.consoleOutput.value.push({
    id: `debug-console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    text,
    timestamp: Date.now(),
  })
}

function clearDebugRuntimeState(): void {
  debugState.isRunning.value = false
  debugState.paused.value = false
  debugState.sessionId.value = null
  debugState.stackFrames.value = []
  debugState.variables.value = []
  debugState.currentFrameId.value = null
}

function findTaskConfig(idOrName: string): TaskConfig | undefined {
  return userTasksService.findTask(idOrName)
}

function getDefaultTaskIdFromUserTasks(): string {
  const activeTaskId = userTasksService.getContractSnapshot().activeTaskId
  if (activeTaskId) return activeTaskId
  return userTasksService.getTasks()[0]?.id || ""
}

function toExecutableRunConfig(task: TaskConfig): RunConfig {
  const { providerType: _providerType, ...config } = task
  return {
    ...config,
    source: task.source === "extensionProvider" ? "workspace" : task.source,
  }
}

async function defaultNoopTaskRunner(config: RunConfig): Promise<TaskCommandResult> {
  return {
    stdout: `Task ${config.name} routed through workbench taskService facade.\n`,
    exitCode: 0,
  }
}

function selectTaskTerminalReuseCandidate(
  terminalLastTaskMap: Map<number, TaskTerminalLastTaskProjection>,
  task: TaskConfig,
): { entry: TaskTerminalLastTaskProjection; reuseKind: "sameTask" | "idleTask" } | null {
  const finished = [...terminalLastTaskMap.values()].filter((entry) =>
    entry.status === "finished" && canReuseTaskTerminal(entry.terminalInstanceId)
  )
  const sameTask = finished
    .filter((entry) => entry.taskId === task.id)
    .sort((first, second) => second.updatedAt - first.updatedAt)
    .at(0)
  if (sameTask) return { entry: { ...sameTask }, reuseKind: "sameTask" }

  const sameGroup = finished
    .filter((entry) => {
      const previousTask = findTaskConfig(entry.taskId)
      return (previousTask?.group || "") === (task.group || "")
    })
    .sort((first, second) => first.updatedAt - second.updatedAt)
    .at(0)
  return sameGroup ? { entry: { ...sameGroup }, reuseKind: "idleTask" } : null
}

function buildMissingTaskEvidence(taskIdOrName: string): TaskRunEvidence {
  return {
    id: String(taskIdOrName || ""),
    name: String(taskIdOrName || "No active task"),
    status: "blocked",
    blocked: [`找不到任务: ${taskIdOrName || "active task"}`],
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    steps: [],
    summary: `任务未运行：找不到任务 ${taskIdOrName || "active task"}`,
  }
}

function buildInstancePolicyBlockedEvidence(task: TaskConfig, policy: TaskInstancePolicyEvidence): TaskRunEvidence {
  const reason = policy.reason
  return {
    id: task.id,
    name: task.name,
    status: "blocked",
    blocked: [reason],
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    steps: [],
    summary: `任务未运行：${reason}`,
  }
}

function createEmptyTaskSystemLifecycleProjection(): TaskSystemLifecycleProjection {
  return {
    source: "TaskSystemLifecycleProjection",
    stateSource: "taskRunner/TaskSystemLifecycleProjection",
    runId: "",
    executionId: "",
    activeTaskId: "",
    activeTaskName: "",
    lastEventType: "",
    lastAction: "",
    eventCount: 0,
    terminalInstanceId: null,
    processId: null,
    activeExecutionCount: 0,
    activeExecutionMap: [],
    terminalLastTaskMap: [],
    latestInstancePolicy: null,
    supportsRerun: true,
    supportsTerminate: true,
    supportsTerminateAll: false,
    supportsRestartActiveTerminal: false,
    supportsMultipleExecutions: true,
  }
}

function buildTaskLifecycleProjection(
  events: TaskRunLifecycleEvent[],
  action: TaskSystemLifecycleProjection["lastAction"],
  activeExecutions: TaskActiveExecutionProjection[] = [],
  latestInstancePolicy: TaskInstancePolicyEvidence | null = null,
  terminalLastTaskMap: TaskTerminalLastTaskProjection[] = [],
): TaskSystemLifecycleProjection {
  const latest = events.at(-1)
  return {
    source: "TaskSystemLifecycleProjection",
    stateSource: "taskRunner/TaskSystemLifecycleProjection",
    runId: latest?.runId || "",
    executionId: latest?.executionId || "",
    activeTaskId: latest?.type === "terminated" ? "" : latest?.taskId || "",
    activeTaskName: latest?.type === "terminated" ? "" : latest?.taskName || "",
    terminalInstanceId: latest?.terminalId ?? null,
    processId: latest?.processId ?? null,
    activeExecutionCount: activeExecutions.length,
    activeExecutionMap: activeExecutions.map((execution) => ({ ...execution })),
    terminalLastTaskMap: terminalLastTaskMap.map((entry) => ({ ...entry })),
    latestInstancePolicy,
    lastEventType: latest?.type || "",
    lastAction: action,
    eventCount: events.length,
    supportsRerun: true,
    supportsTerminate: true,
    supportsTerminateAll: canTerminateAllActiveExecutions(activeExecutions),
    supportsRestartActiveTerminal: canRestartActiveTerminal(activeExecutions) || canRerunTerminalLastTask(terminalLastTaskMap),
    supportsMultipleExecutions: true,
  }
}

function updateActiveExecutionMap(
  activeExecutions: Map<string, TaskActiveExecutionProjection>,
  event: TaskRunLifecycleEvent,
): void {
  if (!event.executionId) return
  if (event.type === "terminated" || event.type === "end" || event.type === "processEnded") {
    const existing = activeExecutions.get(event.executionId)
    if (existing) {
      activeExecutions.set(event.executionId, {
        ...existing,
        terminalInstanceId: event.terminalId ?? existing.terminalInstanceId,
        processId: event.processId ?? existing.processId,
        lastEventType: event.type,
        status: event.status,
        updatedAt: event.timestamp,
        endedAt: event.timestamp,
      })
    }
    if (event.type === "terminated" || (event.type === "end" && event.runType === "singleRun")) {
      activeExecutions.delete(event.executionId)
    }
    return
  }

  const existing = activeExecutions.get(event.executionId)
  activeExecutions.set(event.executionId, {
    taskId: event.taskId,
    taskName: event.taskName,
    runId: event.runId,
    executionId: event.executionId,
    runType: event.runType,
    terminalInstanceId: event.terminalId ?? existing?.terminalInstanceId ?? null,
    processId: event.processId ?? existing?.processId ?? null,
    lastEventType: event.type,
    status: event.status,
    startedAt: existing?.startedAt ?? event.timestamp,
    updatedAt: event.timestamp,
    endedAt: null,
    stateSource: "taskRunner/activeExecutionMap",
  })
}

function updateTerminalLastTaskMap(
  terminalLastTaskMap: Map<number, TaskTerminalLastTaskProjection>,
  event: TaskRunLifecycleEvent,
): void {
  if (typeof event.terminalId !== "number" || !event.taskId) return
  terminalLastTaskMap.set(event.terminalId, {
    terminalInstanceId: event.terminalId,
    taskId: event.taskId,
    taskName: event.taskName,
    runId: event.runId,
    executionId: event.executionId,
    runType: event.runType,
    processId: event.processId ?? null,
    lastEventType: event.type,
    status: (event.type === "end" && event.runType === "singleRun") || event.type === "processEnded" || event.type === "terminated" ? "finished" : "active",
    updatedAt: event.timestamp,
    stateSource: "taskRunner/terminalLastTaskMap",
    vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
    currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
    runtimeReference: false,
  })
}

function recordTaskTerminalReuseFromLifecycleEvent(event: TaskRunLifecycleEvent): void {
  if (typeof event.terminalId !== "number" || !event.taskId) return
  recordTaskTerminalReuse({
    taskId: event.taskId,
    taskName: event.taskName,
    terminalInstanceId: event.terminalId,
    processId: event.processId ?? null,
    runId: event.runId,
    executionId: event.executionId,
    runType: event.runType,
    panelKind: event.runType === "background" ? "dedicated" : "shared",
    eventType: event.type,
  }, event.timestamp)
}

function findActiveExecution(
  activeExecutions: Map<string, TaskActiveExecutionProjection>,
  taskId: string,
): TaskActiveExecutionProjection | undefined {
  if (!taskId) return [...activeExecutions.values()].at(-1)
  return [...activeExecutions.values()].find((execution) => execution.taskId === taskId)
}

interface ActiveRunInstancePolicyDecision {
  action: TaskInstancePolicyEvidence["action"]
  evidence: TaskInstancePolicyEvidence
  target?: TaskActiveExecutionProjection
  sameTaskExecutions: TaskActiveExecutionProjection[]
}

interface ActiveRunInstancePolicyBlocker {
  activeExecutionCount: number
  sameTaskExecutionCount: number
  instanceLimit: number
  instancePolicy: TaskInstancePolicy
  sameTaskExecutions: TaskActiveExecutionProjection[]
}

function getActiveRunInstancePolicyDecision(
  activeExecutions: Map<string, TaskActiveExecutionProjection>,
  task: TaskConfig,
): ActiveRunInstancePolicyDecision {
  const executions = [...activeExecutions.values()]
  const sameTaskExecutions = executions.filter((execution) => execution.taskId === task.id)
  const instanceLimit = normalizeTaskInstanceLimit(task.runOptions?.instanceLimit)
  const policy = normalizeTaskInstancePolicy(task.runOptions?.instancePolicy)
  const allowedEvidence = buildTaskInstancePolicyEvidence(task, {
    activeExecutionCount: executions.length,
    sameTaskExecutionCount: sameTaskExecutions.length,
    instanceLimit,
    instancePolicy: policy,
    sameTaskExecutions,
  }, "allow", "allowed")
  if (sameTaskExecutions.length < instanceLimit) {
    return { action: "allow", evidence: allowedEvidence, sameTaskExecutions }
  }
  const blocker: ActiveRunInstancePolicyBlocker = {
    activeExecutionCount: executions.length,
    sameTaskExecutionCount: sameTaskExecutions.length,
    instanceLimit,
    instancePolicy: policy,
    sameTaskExecutions,
  }
  if (policy === "terminateNewest") {
    return {
      action: "terminateNewest",
      evidence: buildTaskInstancePolicyEvidence(task, blocker, "terminateNewest", "handled", selectNewestExecution(sameTaskExecutions)),
      target: selectNewestExecution(sameTaskExecutions),
      sameTaskExecutions,
    }
  }
  if (policy === "terminateOldest") {
    return {
      action: "terminateOldest",
      evidence: buildTaskInstancePolicyEvidence(task, blocker, "terminateOldest", "handled", selectOldestExecution(sameTaskExecutions)),
      target: selectOldestExecution(sameTaskExecutions),
      sameTaskExecutions,
    }
  }
  if (policy === "warn") {
    return { action: "warn", evidence: buildTaskInstancePolicyEvidence(task, blocker, "warn", "blocked"), sameTaskExecutions }
  }
  if (policy === "silent") {
    return { action: "silent", evidence: buildTaskInstancePolicyEvidence(task, blocker, "silent", "blocked"), sameTaskExecutions }
  }
  return { action: "prompt", evidence: buildTaskInstancePolicyEvidence(task, blocker, "prompt", "pendingPrompt"), sameTaskExecutions }
}

async function promptTaskInstanceSelection(
  task: TaskConfig,
  evidence: TaskInstancePolicyEvidence,
  executions: TaskActiveExecutionProjection[],
): Promise<TaskActiveExecutionProjection | undefined> {
  const items: QuickPickEntry<TaskActiveExecutionProjection>[] = executions.map((execution, index) => ({
    id: execution.executionId,
    label: execution.taskName || task.name,
    description: buildTaskInstanceQuickPickDescription(execution, index),
    detail: execution.executionId,
    value: execution,
  }))
  const selected = await quickInputService.pick<TaskActiveExecutionProjection>(items, {
    title: "Task instance limit reached",
    placeHolder: "Select an instance to terminate",
    matchOnDescription: true,
    matchOnDetail: true,
  })
  const selectedItem = Array.isArray(selected) ? selected[0] : selected
  const selectedExecution = selectedItem?.value
  evidence.quickPickOwner = "QuickInputService.pick"
  evidence.quickPickItemCount = items.length
  evidence.quickPickSelection = selectedExecution?.executionId || null
  return selectedExecution
}

function buildTaskInstanceQuickPickDescription(execution: TaskActiveExecutionProjection, index: number): string {
  const terminal = typeof execution.terminalInstanceId === "number" ? `terminal ${execution.terminalInstanceId}` : "terminal owner unresolved"
  const process = typeof execution.processId === "number" ? `pid ${execution.processId}` : "pid unknown"
  return `instance ${index + 1} - ${terminal} - ${process}`
}

function getActiveRunInstancePolicyBlocker(
  activeExecutions: Map<string, TaskActiveExecutionProjection>,
  task: TaskConfig,
): ActiveRunInstancePolicyBlocker | null {
  const executions = [...activeExecutions.values()]
  if (executions.length === 0) return null
  const sameTaskExecutionCount = executions.filter((execution) => execution.taskId === task.id).length
  if (sameTaskExecutionCount === 0) return null
  const instanceLimit = normalizeTaskInstanceLimit(task.runOptions?.instanceLimit)
  if (sameTaskExecutionCount >= instanceLimit) {
    return {
      activeExecutionCount: executions.length,
      sameTaskExecutionCount,
      instanceLimit,
      instancePolicy: normalizeTaskInstancePolicy(task.runOptions?.instancePolicy),
      sameTaskExecutions: executions.filter((execution) => execution.taskId === task.id),
    }
  }
  return null
}

function normalizeTaskInstanceLimit(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
}

function normalizeTaskInstancePolicy(value: TaskInstancePolicy | undefined): TaskInstancePolicy {
  return value || "prompt"
}

function selectNewestExecution(executions: TaskActiveExecutionProjection[]): TaskActiveExecutionProjection | undefined {
  return [...executions].sort((a, b) => b.startedAt! - a.startedAt! || b.updatedAt - a.updatedAt).at(0)
}

function selectOldestExecution(executions: TaskActiveExecutionProjection[]): TaskActiveExecutionProjection | undefined {
  return [...executions].sort((a, b) => a.startedAt! - b.startedAt! || a.updatedAt - b.updatedAt).at(0)
}

function buildTaskInstancePolicyEvidence(
  task: TaskConfig,
  blocker: ActiveRunInstancePolicyBlocker,
  action: TaskInstancePolicyEvidence["action"],
  status: TaskInstancePolicyEvidence["status"],
  selectedExecution?: TaskActiveExecutionProjection,
): TaskInstancePolicyEvidence {
  const reason = buildInstancePolicyReason(task, blocker, action, status)
  return {
    taskId: task.id,
    taskName: task.name,
    policy: blocker.instancePolicy,
    action,
    status,
    instanceLimit: blocker.instanceLimit,
    sameTaskExecutionCount: blocker.sameTaskExecutionCount,
    activeExecutionCount: blocker.activeExecutionCount,
    selectedExecutionId: selectedExecution?.executionId || null,
    selectedTaskName: selectedExecution?.taskName || null,
    terminalInstanceId: selectedExecution?.terminalInstanceId ?? null,
    processId: selectedExecution?.processId ?? null,
    quickPickOwner: action === "prompt" ? "QuickInputService.pick" : null,
    quickPickItemCount: action === "prompt" ? blocker.sameTaskExecutions.length : 0,
    quickPickSelection: selectedExecution?.executionId || null,
    reason,
    stateSource: "taskRunner/instancePolicy",
    vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/abstractTaskService.ts",
    currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
    runtimeReference: false,
  }
}

function buildInstancePolicyReason(
  task: TaskConfig,
  blocker: ActiveRunInstancePolicyBlocker,
  action: TaskInstancePolicyEvidence["action"],
  status: TaskInstancePolicyEvidence["status"],
): string {
  if (action === "allow") {
    return `允许启动新的任务实例: ${task.name} (active=${blocker.sameTaskExecutionCount}, instanceLimit=${blocker.instanceLimit})`
  }
  if (action === "terminateNewest") {
    return `任务实例数已达到限制，按 VS Code terminateNewest 策略终止最新实例后启动新实例: ${task.name} (instanceLimit=${blocker.instanceLimit})`
  }
  if (action === "terminateOldest") {
    return `任务实例数已达到限制，按 VS Code terminateOldest 策略终止最早实例后启动新实例: ${task.name} (instanceLimit=${blocker.instanceLimit})`
  }
  if (status === "pendingPrompt") {
    return `任务实例数已达到限制，需要选择要终止的实例: ${task.name} (instanceLimit=${blocker.instanceLimit}, policy=prompt)`
  }
  return `任务实例数已达到限制: ${task.name} (instanceLimit=${blocker.instanceLimit}, policy=${blocker.instancePolicy})`
}

function buildTerminateEventFromExecution(
  execution: TaskActiveExecutionProjection,
  exitCode: number | null | undefined,
): TaskRunLifecycleEvent {
  return {
    taskId: execution.taskId,
    taskName: execution.taskName,
    stepId: execution.taskId,
    stepName: execution.taskName,
    type: "terminated",
    status: "cancelled",
    exitCode: exitCode ?? null,
    runId: execution.runId,
    executionId: execution.executionId,
    runType: execution.runType,
    terminalId: execution.terminalInstanceId,
    processId: execution.processId,
    timestamp: Date.now(),
    source: "taskRunner",
  }
}

function buildInstancePolicyBlockedReason(task: TaskConfig, blocker: ActiveRunInstancePolicyBlocker): string {
  const evidence = buildTaskInstancePolicyEvidence(task, blocker, blocker.instancePolicy === "prompt" ? "prompt" : blocker.instancePolicy, blocker.instancePolicy === "prompt" ? "pendingPrompt" : "blocked")
  return evidence.reason
}

function findActiveExecutionByTerminalInstanceId(
  activeExecutions: Map<string, TaskActiveExecutionProjection>,
  terminalInstanceId: number | null | undefined,
): TaskActiveExecutionProjection | undefined {
  if (typeof terminalInstanceId !== "number") return undefined
  return [...activeExecutions.values()].find((execution) => execution.terminalInstanceId === terminalInstanceId)
}

function findTerminalLastTaskByInstanceId(
  terminalLastTaskMap: Map<number, TaskTerminalLastTaskProjection>,
  terminalInstanceId: number | null | undefined,
): TaskTerminalLastTaskProjection | undefined {
  if (typeof terminalInstanceId !== "number") return undefined
  const entry = terminalLastTaskMap.get(terminalInstanceId)
  return entry ? { ...entry } : undefined
}

function buildTerminateAllBlockedEvidence(
  activeExecutions: TaskActiveExecutionProjection[],
): TaskSystemBlockedCapabilityEvidence[] {
  const unresolved = activeExecutions.filter((execution) => !canTerminateTerminalByInstanceId(execution.terminalInstanceId))
  const missingOwner = activeExecutions.length === 0
    ? "TerminalTaskSystem._activeTasks active task terminal entries"
    : unresolved
      .map((execution) => {
        const terminalRef = typeof execution.terminalInstanceId === "number"
          ? `terminalInstanceId=${execution.terminalInstanceId}`
          : "terminalInstanceId=null"
        return `${execution.taskId}:${terminalRef}`
      })
      .join(", ")
  const reason = activeExecutions.length === 0
    ? "没有 VS Code TerminalTaskSystem._activeTasks 等价的 active execution，terminateAll 没有可终止对象。"
    : "至少一个 active execution 缺少可解析的 terminalManager pty dispose/onExit owner；为避免部分终止造成状态漂移，terminateAll 保持 blocked。"
  return [{
    capability: "terminateAll",
    reason,
    vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
    currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
    vscodeOwner: "TerminalTaskSystem.terminateAll over _activeTasks with ITerminalInstance.dispose/onExit",
    currentOwner: "TaskWorkbenchAdapterService activeExecutionMap + terminalManager pty dispose/onExit owner gate",
    missingOwner,
    nextAuthorizedFiles: [
      "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
      "frontend/vite-project/src/terminal/terminalManager.ts",
      "desktop/services/extensions-host/mainThread/mainThreadTask.js",
    ],
    blocked: true,
    runtimeReference: false,
  }]
}

function canTerminateAllActiveExecutions(activeExecutions: TaskActiveExecutionProjection[]): boolean {
  return activeExecutions.length > 0 && activeExecutions.every((execution) =>
    canTerminateTerminalByInstanceId(execution.terminalInstanceId)
  )
}

function canRestartActiveTerminal(activeExecutions: TaskActiveExecutionProjection[]): boolean {
  return activeExecutions.some((execution) =>
    Boolean(findTaskConfig(execution.taskId)) && canTerminateTerminalByInstanceId(execution.terminalInstanceId)
  )
}

function canRerunTerminalLastTask(terminalLastTaskMap: TaskTerminalLastTaskProjection[]): boolean {
  return terminalLastTaskMap.some((entry) => entry.status === "finished" && Boolean(findTaskConfig(entry.taskId)))
}

function resolveTaskTerminalTaskOwnerEvidence(
  activeExecutions: TaskActiveExecutionProjection[],
  terminalLastTaskMap: TaskTerminalLastTaskProjection[] = [],
  taskId?: string,
): TaskTerminalTaskOwnerEvidence {
  const active = activeExecutions.find((execution) =>
    (!taskId || execution.taskId === taskId) && typeof execution.terminalInstanceId === "number"
  )
  if (active) {
    const ownerResolved = canTerminateTerminalByInstanceId(active.terminalInstanceId)
    return {
      status: ownerResolved ? "activeResolved" : "activeUnresolved",
      taskId: active.taskId,
      taskName: active.taskName,
      terminalInstanceId: active.terminalInstanceId,
      processId: active.processId,
      terminalOwnerResolved: ownerResolved,
      supportsTerminate: ownerResolved,
      supportsRerun: ownerResolved && Boolean(findTaskConfig(active.taskId)),
      stateSource: "taskRunner/activeExecutionMap",
      vscodeOwner: "TerminalTaskSystem._activeTasks + TerminalTaskSystem._terminals.lastTask + ITerminalInstance dispose/onDisposed",
      currentOwner: ownerResolved
        ? "TaskWorkbenchAdapterService activeExecutionMap + terminalManager pty dispose/onExit owner"
        : "TaskWorkbenchAdapterService activeExecutionMap without terminalManager pty dispose/onExit owner",
      missingOwner: ownerResolved ? "" : "terminalManager pty dispose/onExit owner for active terminal task",
      vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
      currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
      runtimeReference: false,
    }
  }

  const lastTask = terminalLastTaskMap.find((entry) =>
    (!taskId || entry.taskId === taskId) && entry.status === "finished" && Boolean(findTaskConfig(entry.taskId))
  )
  if (lastTask) {
    return {
      status: "lastTaskOnly",
      taskId: lastTask.taskId,
      taskName: lastTask.taskName,
      terminalInstanceId: lastTask.terminalInstanceId,
      processId: lastTask.processId,
      terminalOwnerResolved: false,
      supportsTerminate: false,
      supportsRerun: true,
      stateSource: "taskRunner/terminalLastTaskMap",
      vscodeOwner: "TerminalTaskSystem._activeTasks + TerminalTaskSystem._terminals.lastTask + ITerminalInstance dispose/onDisposed",
      currentOwner: "TaskWorkbenchAdapterService terminalLastTaskMap fallback matching TerminalTaskSystem.getTaskForTerminal",
      missingOwner: "active task terminal instance; finished lastTask fallback only supports rerun",
      vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
      currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
      runtimeReference: false,
    }
  }

  return {
    status: "missing",
    taskId: taskId || null,
    taskName: "",
    terminalInstanceId: null,
    processId: null,
    terminalOwnerResolved: false,
    supportsTerminate: false,
    supportsRerun: false,
    stateSource: "taskRunner/TaskSystemLifecycleProjection",
    vscodeOwner: "TerminalTaskSystem._activeTasks + TerminalTaskSystem._terminals.lastTask + ITerminalInstance dispose/onDisposed",
    currentOwner: "TaskWorkbenchAdapterService taskRunner lifecycle projection",
    missingOwner: "activeExecutionMap entry or terminalLastTaskMap fallback for the terminal task",
    vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
    currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
    runtimeReference: false,
  }
}

function buildProviderTaskExecutionOwnerBlockedReason(
  lifecycle: TaskSystemLifecycleProjection,
  activeExecutionMapped: boolean,
): string {
  if (!activeExecutionMapped) {
    return "provider task 已进入 taskRunner execution，但 current/single-run 执行结束后没有保留 activeExecutionMap entry；没有 active terminal owner 可用于 terminateAll/restartActiveTerminal。"
  }
  if (typeof lifecycle.terminalInstanceId !== "number") {
    return "provider task 已进入 taskRunner execution/lifecycle，但 runCommand 没有返回 terminalInstanceId；当前 provider single-run/current smoke 无法解析 active terminal owner。"
  }
  return "provider task 已进入 taskRunner execution/lifecycle，但 terminalInstanceId 未解析到 terminalManager pty dispose/onExit owner。"
}

function buildFinishedRunTerminalOwnerBlockedReason(
  lifecycle: TaskSystemLifecycleProjection,
  activeExecutionMapped: boolean,
  terminalOwnerResolved: boolean,
): string {
  if (terminalOwnerResolved || activeExecutionMapped) return ""
  if (lifecycle.lastEventType === "end" && typeof lifecycle.terminalInstanceId === "number") {
    return "provider single-run 已触发 terminal owner 并正常结束；按 VS Code TerminalTaskSystem.getActiveTasks/activeTasks 语义，结束后的 single-run 不再是 running task，不能保留 activeExecutionMap entry 给 terminateAll/restartActiveTerminal。若要支持从已结束 terminal rerun，需要迁移 TerminalTaskSystem.getTaskForTerminal 的 terminal lastTask 回退，而不是伪造 active owner。"
  }
  return ""
}

function buildTerminateProjectionFromExecution(
  execution: TaskActiveExecutionProjection,
  terminalOwner: TerminalOwnerTerminationResult,
  activeExecutionCount: number,
): TaskTerminateProjection {
  return {
    success: terminalOwner.success,
    taskId: execution.taskId,
    taskName: execution.taskName,
    action: "terminate",
    runId: execution.runId,
    executionId: execution.executionId,
    terminalInstanceId: execution.terminalInstanceId,
    processId: execution.processId,
    activeExecutionCount,
    stateSource: "taskRunner/TaskSystemLifecycleProjection",
    terminalOwner,
  }
}

function buildBlockedRestartActiveTerminalProjection(
  terminalInstanceId: number,
  reason: string,
  activeExecutionCount: number,
  execution?: TaskActiveExecutionProjection,
): TaskRestartActiveTerminalProjection {
  return {
    success: false,
    action: "restartActiveTerminal",
    taskId: execution?.taskId || "",
    taskName: execution?.taskName || "",
    runId: execution?.runId || "",
    executionId: execution?.executionId || "",
    terminalInstanceId,
    processId: execution?.processId ?? null,
    activeExecutionCount,
    reason,
    stateSource: "taskRunner/TaskSystemLifecycleProjection",
  }
}

const TASK_SYSTEM_VSCODE_SOURCE_PATHS = [
  "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
  "src/vs/workbench/contrib/tasks/browser/abstractTaskService.ts",
  "src/vs/workbench/contrib/tasks/common/tasks.ts",
  "src/vs/workbench/contrib/tasks/common/taskSystem.ts",
  "src/vs/workbench/contrib/tasks/common/taskService.ts",
  "src/vs/workbench/api/browser/mainThreadTask.ts",
  "src/vs/workbench/api/common/extHostTask.ts",
  "src/vs/workbench/contrib/tasks/common/taskDefinitionRegistry.ts",
] as const

const TASK_SYSTEM_CURRENT_SOURCE_PATHS = [
  "desktop/services/extensions-host/mainThread/mainThreadTask.js",
  "desktop/services/extensions-host/extHostServer.js",
  "frontend/vite-project/src/terminal/terminalManager.ts",
  "frontend/vite-project/src/workbench/taskRunner.ts",
  "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
  "frontend/vite-project/src/workbench/userTasks.ts",
  "frontend/vite-project/src/workbench/taskDiscovery.ts",
  "frontend/vite-project/src/workbench/taskProblems.ts",
] as const

function buildTaskSystemOwnershipAudit(
  terminateAllAvailable = false,
  restartActiveTerminalAvailable = false,
  problemMatcherCollectorAvailable = false,
): TaskSystemOwnershipAuditEntry[] {
  return [
    {
      capability: "terminalProcessLifecycle",
      status: terminateAllAvailable && restartActiveTerminalAvailable ? "available" : "partial",
      vscodeOwner: "TerminalTaskSystem._activeTasks/_terminals + ITerminalInstance.processReady/onExit",
      currentOwner: terminateAllAvailable && restartActiveTerminalAvailable
        ? "taskRunner activeExecutionMap + terminalManager instanceId -> pty dispose/onExit owner"
        : "taskRunner activeExecutionMap + terminalManager owner API, waiting for active task terminal instance evidence",
      missingOwner: terminateAllAvailable && restartActiveTerminalAvailable
        ? ""
        : "active task terminal instance that resolves through terminalManager pty dispose/onExit",
      vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
      currentSourcePath: "frontend/vite-project/src/workbench/taskRunner.ts",
      nextAuthorizedFiles: [
        "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
        "frontend/vite-project/src/workbench/taskRunner.ts",
        "frontend/vite-project/src/terminal/terminalManager.ts",
      ],
    },
    {
      capability: "terminateAll",
      status: terminateAllAvailable ? "available" : "partial",
      vscodeOwner: "TerminalTaskSystem.terminateAll over _activeTasks",
      currentOwner: terminateAllAvailable
        ? "TaskWorkbenchAdapterService activeExecutionMap + terminalManager instanceId -> pty dispose/onExit owner"
        : "TaskWorkbenchAdapterService activeExecutionMap selection + terminate projection",
      missingOwner: terminateAllAvailable
        ? ""
        : "terminalManager pty dispose/onExit owner for every active execution",
      vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
      currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
      nextAuthorizedFiles: [
        "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
        "frontend/vite-project/src/workbench/taskRunner.ts",
      ],
    },
    {
      capability: "restartActiveTerminal",
      status: restartActiveTerminalAvailable ? "available" : "partial",
      vscodeOwner: "AbstractTaskService.rerun(terminalInstanceId) + TerminalTaskSystem.getTaskForTerminal(activeTasks/_terminals.lastTask)",
      currentOwner: restartActiveTerminalAvailable
        ? "TaskWorkbenchAdapterService activeExecutionMap terminalInstanceId lookup or terminalLastTaskMap fallback + runTask"
        : "TaskWorkbenchAdapterService activeExecutionMap terminal/process owner lookup + terminalLastTaskMap rerun projection",
      missingOwner: restartActiveTerminalAvailable
        ? ""
        : "active terminal task execution that resolves through terminalManager pty dispose/onExit",
      vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/abstractTaskService.ts",
      currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
      nextAuthorizedFiles: [
        "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
        "frontend/vite-project/src/workbench/taskRunner.ts",
      ],
    },
    {
      capability: "problemMatcher",
      status: problemMatcherCollectorAvailable ? "available" : "partial",
      vscodeOwner: "TerminalTaskSystem WatchingProblemCollector/StartStopProblemCollector + ProblemMatcherRegistry",
      currentOwner: problemMatcherCollectorAvailable
        ? "taskRunner command-output collector + taskProblems.applyTaskProblemDiagnostics + global marker lifecycle"
        : "taskRunner problemMatcher projection + userTasksService ProblemMatcherRegistry evidence",
      missingOwner: problemMatcherCollectorAvailable
        ? ""
        : "taskRunner command-output collector evidence from a real task run with problemMatchers",
      vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
      currentSourcePath: "frontend/vite-project/src/workbench/taskRunner.ts",
      nextAuthorizedFiles: [
        "frontend/vite-project/src/workbench/taskRunner.ts",
        "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
      ],
    },
    {
      capability: "multipleExecutions",
      status: "available",
      vscodeOwner: "AbstractTaskService._handleInstancePolicy + TerminalTaskSystem instance maps",
      currentOwner: "TaskWorkbenchAdapterService activeExecutionMap + runOptions.instanceLimit/instancePolicy prompt/terminateNewest/terminateOldest/allow evidence",
      missingOwner: "",
      vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/abstractTaskService.ts",
      currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
      nextAuthorizedFiles: [
        "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
        "frontend/vite-project/src/workbench/taskRunner.ts",
      ],
    },
  ]
}

function buildTaskSystemCapabilitySnapshot(
  lifecycle: TaskSystemLifecycleProjection,
  activeExecutions: TaskActiveExecutionProjection[] = lifecycle.activeExecutionMap,
  providerTaskExecutionEvidence: ProviderTaskExecutionEvidence | null = null,
  problemProjectionEvidence: TaskProblemProjectionEvidence | null = null,
  latestInstancePolicy: TaskInstancePolicyEvidence | null = lifecycle.latestInstancePolicy,
  latestPhysicalReuse: TaskTerminalPhysicalReuseProjection | null = null,
  terminalLastTaskMap: TaskTerminalLastTaskProjection[] = lifecycle.terminalLastTaskMap,
): TaskSystemCapabilitySnapshot {
  const providerBridge = userTasksService.getContractSnapshot().providerBridge
  const terminateAllAvailable = canTerminateAllActiveExecutions(activeExecutions)
  const restartActiveTerminalAvailable = canRestartActiveTerminal(activeExecutions) || canRerunTerminalLastTask(terminalLastTaskMap)
  const activeTerminalTaskOwner = resolveTaskTerminalTaskOwnerEvidence(activeExecutions, terminalLastTaskMap)
  const problemMatcherCollectorAvailable = hasProblemMatcherCollectorEvidence(problemProjectionEvidence)
  const providerExecutionObserved = providerBridge.providerTaskCount > 0 && providerTaskExecutionEvidence !== null
  const providerTerminalOwnerResolved = providerTaskExecutionEvidence?.terminalOwnerResolved === true
  const extensionTaskProviderBridgeStatus = deriveExtensionTaskProviderBridgeStatus(
    providerBridge.status,
    providerBridge.rendererIpcConsumerConnected,
    providerExecutionObserved,
    providerTerminalOwnerResolved,
  )
  const ownershipAudit = buildTaskSystemOwnershipAudit(
    terminateAllAvailable,
    restartActiveTerminalAvailable,
    problemMatcherCollectorAvailable,
  )
  const terminalTabActions = buildTaskTerminalTabActionEvidence(activeExecutions, terminalLastTaskMap, activeTerminalTaskOwner)
  const terminalServiceLifecycle = buildTaskTerminalServiceLifecycleEvidence(activeExecutions, terminalLastTaskMap, activeTerminalTaskOwner, terminalTabActions)
  const extensionTaskProviderBridge: ExtensionTaskProviderBridgeCapability = {
    status: extensionTaskProviderBridgeStatus,
    providerTaskCount: providerBridge.providerTaskCount,
    taskProjection: providerBridge.providerTaskCount > 0,
    rendererIpcConsumerConnected: providerBridge.rendererIpcConsumerConnected,
    terminalTaskSystemExecution: providerExecutionObserved,
    executionEvidence: providerTaskExecutionEvidence,
    stateSource: providerBridge.stateSource,
    currentSourcePath: providerBridge.currentSourcePath,
    vscodeSourcePath: providerBridge.vscodeSourcePath,
  }
  return {
    source: "TaskSystemCapabilitySnapshot",
    stateSource: "taskRunner/TaskSystemLifecycleProjection",
    implementation: "lightweightTaskRunnerProjection",
    terminalOwnership: terminateAllAvailable && restartActiveTerminalAvailable
      ? "available"
      : terminateAllAvailable || restartActiveTerminalAvailable
        ? "partial"
        : "blocked",
    terminalInstanceId: lifecycle.terminalInstanceId,
    processId: lifecycle.processId,
    activeExecutionCount: activeExecutions.length,
    activeExecutionMap: activeExecutions.map((execution) => ({ ...execution })),
    activeTerminalTaskOwner,
    terminalServiceLifecycle,
    supportsRerun: true,
    supportsTerminate: true,
    supportsTerminateAll: terminateAllAvailable,
    supportsRestartActiveTerminal: restartActiveTerminalAvailable,
    terminalTabActions,
    supportsMultipleExecutions: true,
    supportsExtensionTaskProviderBridge: extensionTaskProviderBridgeStatus,
    extensionTaskProviderBridge,
    multipleExecutionsPolicy: "instanceLimit",
    latestInstancePolicy,
    latestPhysicalReuse,
    ownershipAudit,
    blocked: [
      ...(!terminateAllAvailable ? [{
        capability: "terminalOwnership",
        reason: "terminalManager 已提供真实 pty dispose/onExit owner API；当前没有可解析到该 owner 的 active task terminal instance，因此 terminateAll/restartActiveTerminal 仍保持 blocked。",
        vscodeSourcePath: ownershipAudit[0].vscodeSourcePath,
        currentSourcePath: ownershipAudit[0].currentSourcePath,
        vscodeOwner: ownershipAudit[0].vscodeOwner,
        currentOwner: ownershipAudit[0].currentOwner,
        missingOwner: ownershipAudit[0].missingOwner,
        nextAuthorizedFiles: ownershipAudit[0].nextAuthorizedFiles,
        blocked: true,
        runtimeReference: false,
      } satisfies TaskSystemBlockedCapabilityEvidence] : []),
      ...(!terminateAllAvailable ? [{
        capability: "terminateAll",
        reason: "TaskWorkbenchAdapterService 会逐个调用 terminalManager pty dispose/onExit owner；当前至少一个 active execution 没有可解析的 terminal owner，因此不能执行 terminateAll。",
        vscodeSourcePath: ownershipAudit[1].vscodeSourcePath,
        currentSourcePath: ownershipAudit[1].currentSourcePath,
        vscodeOwner: ownershipAudit[1].vscodeOwner,
        currentOwner: ownershipAudit[1].currentOwner,
        missingOwner: ownershipAudit[1].missingOwner,
        nextAuthorizedFiles: ownershipAudit[1].nextAuthorizedFiles,
        blocked: true,
        runtimeReference: false,
      } satisfies TaskSystemBlockedCapabilityEvidence] : []),
      ...(!restartActiveTerminalAvailable ? [{
        capability: "restartActiveTerminal",
        reason: "restartActiveTerminal 已按 AbstractTaskService.rerun(terminalInstanceId)/TerminalTaskSystem.getTaskForTerminal 走 activeExecutionMap 或 finished terminalLastTaskMap；当前没有可重新运行的 task owner。",
        vscodeSourcePath: ownershipAudit[2].vscodeSourcePath,
        currentSourcePath: ownershipAudit[2].currentSourcePath,
        vscodeOwner: ownershipAudit[2].vscodeOwner,
        currentOwner: ownershipAudit[2].currentOwner,
        missingOwner: ownershipAudit[2].missingOwner,
        nextAuthorizedFiles: ownershipAudit[2].nextAuthorizedFiles,
        blocked: true,
        runtimeReference: false,
      } satisfies TaskSystemBlockedCapabilityEvidence] : []),
      ...(latestInstancePolicy?.status === "pendingPrompt" ? [{
        capability: "multipleExecutions",
        reason: latestInstancePolicy.quickPickOwner
          ? "已迁移 VS Code _handleInstancePolicy 的 prompt 策略并接入 QuickInputService.pick；当前没有选择要终止的实例，因此保持 pendingPrompt，不自动终止实例。"
          : "已迁移 VS Code _handleInstancePolicy 的 prompt 策略证据；当前缺少 QuickPick-style 实例选择 UI，因此保持 pendingPrompt，不自动终止实例。",
        vscodeSourcePath: ownershipAudit[4].vscodeSourcePath,
        currentSourcePath: ownershipAudit[4].currentSourcePath,
        vscodeOwner: ownershipAudit[4].vscodeOwner,
        currentOwner: ownershipAudit[4].currentOwner,
        missingOwner: latestInstancePolicy.quickPickOwner ? "user QuickPick selection" : "interactive QuickPick-style instance selection UI",
        nextAuthorizedFiles: ownershipAudit[4].nextAuthorizedFiles,
        blocked: true,
        runtimeReference: false,
      } satisfies TaskSystemBlockedCapabilityEvidence] : []),
      ...(providerBridge.providerTaskCount > 0
      && providerExecutionObserved
      && !providerTerminalOwnerResolved
      && providerTaskExecutionEvidence?.activeExecutionMapped === false ? [{
        capability: "extensionTaskProviderBridge",
        reason: providerTaskExecutionEvidence?.blockedReason || "provider task 已进入 taskRunner execution/lifecycle，但当前 runCommand 没有返回可解析的 terminalInstanceId/processId；不能把 provider single-run/current smoke 判定为 terminal owner 缺失以外的逻辑缺失。",
        vscodeSourcePath: "src/vs/workbench/api/browser/mainThreadTask.ts",
        currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
        vscodeOwner: "MainThreadTask/ExtHostTask provider bridge + TerminalTaskSystem terminal instance owner",
        currentOwner: "userTasksService extensionProvider projection + TaskWorkbenchAdapterService.runTask/taskRunner lifecycle",
        missingOwner: providerTaskExecutionEvidence?.missingOwner || "terminalManager pty dispose/onExit owner returned by the provider task execution bridge",
        nextAuthorizedFiles: [
          "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
          "frontend/vite-project/src/workbench/taskRunner.ts",
          "frontend/vite-project/src/terminal/terminalManager.ts",
        ],
        blocked: true,
        runtimeReference: false,
      } satisfies TaskSystemBlockedCapabilityEvidence] : []),
      ...(!providerExecutionObserved ? [{
        capability: "extensionTaskProviderBridge",
        reason: providerBridge.providerTaskCount > 0
            ? "renderer userTasksService 已可投影 extension provider tasks；但尚未观察到 provider task 进入 taskRunner execution/lifecycle/activeExecutionMap，不能声明 provider task 可真实执行。"
            : "desktop MainThreadTask 已接入 registerTaskProvider/provideTasks/resolveTask evidence；但 renderer 仍未收到 extension provider task projection，不能声明完整 bridge。",
        vscodeSourcePath: "src/vs/workbench/api/browser/mainThreadTask.ts",
        currentSourcePath: providerBridge.providerTaskCount > 0
          ? "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts"
          : "desktop/services/extensions-host/mainThread/mainThreadTask.js",
        vscodeOwner: "MainThreadTask/ExtHostTask provider bridge + AbstractTaskService.run",
        currentOwner: providerExecutionObserved
          ? "userTasksService extensionProvider projection + TaskWorkbenchAdapterService.runTask/taskRunner lifecycle"
          : providerBridge.providerTaskCount > 0
            ? "userTasksService extensionProvider projection"
          : "desktop mainThreadTask provider evidence",
        missingOwner: providerExecutionObserved
          ? "MainThreadTask.$executeTask to renderer TaskWorkbenchAdapterService.runTask command bridge and terminal tab action wiring"
          : "TerminalTaskSystem execution owner for provider-backed tasks",
        nextAuthorizedFiles: [
          "frontend/vite-project/src/workbench/userTasks.ts",
          "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
          "frontend/vite-project/src/workbench/taskRunner.ts",
        ],
        blocked: true,
        runtimeReference: false,
      } satisfies TaskSystemBlockedCapabilityEvidence] : []),
    ],
    vscodeSourcePaths: [...TASK_SYSTEM_VSCODE_SOURCE_PATHS],
    currentSourcePaths: [...TASK_SYSTEM_CURRENT_SOURCE_PATHS],
    constraints: {
      noSecondTaskState: true,
      noRuntimeSourceMirrorReference: true,
      blockedEvidenceOnlyForUnmigratedTerminalSystem: true,
    },
  }
}

function hasProblemMatcherCollectorEvidence(
  projection: TaskProblemProjectionEvidence | null,
): boolean {
  return Boolean(projection && projection.taskIds.length > 0)
}

function deriveExtensionTaskProviderBridgeStatus(
  projectionStatus: "blocked" | "partial",
  rendererIpcConsumerConnected: boolean,
  providerExecutionObserved: boolean,
  providerTerminalOwnerResolved: boolean,
): ExtensionTaskProviderBridgeCapability["status"] {
  if (
    projectionStatus === "partial"
    && rendererIpcConsumerConnected
    && providerExecutionObserved
    && providerTerminalOwnerResolved
  ) {
    return "connected"
  }
  if (projectionStatus === "partial" || providerExecutionObserved) return "partial"
  return "blocked"
}

function buildTaskTerminalTabActionEvidence(
  activeExecutions: TaskActiveExecutionProjection[],
  terminalLastTaskMap: TaskTerminalLastTaskProjection[] = [],
  terminalTaskOwner = resolveTaskTerminalTaskOwnerEvidence(activeExecutions, terminalLastTaskMap),
): TaskTerminalTabActionEvidence[] {
  const activeWithTerminal = activeExecutions.find((execution) => typeof execution.terminalInstanceId === "number")
  const lastTaskWithTerminal = terminalLastTaskMap.find((entry) => entry.status === "finished" && Boolean(findTaskConfig(entry.taskId)))
  const activeExecutionCount = activeExecutions.length
  const terminalInstanceId = activeWithTerminal?.terminalInstanceId ?? lastTaskWithTerminal?.terminalInstanceId ?? null
  const restartAvailable = terminalTaskOwner.supportsRerun
  const common = {
    activeExecutionCount,
    terminalInstanceId,
    terminalTaskOwnerStatus: terminalTaskOwner.status,
    terminalOwnerResolved: terminalTaskOwner.terminalOwnerResolved,
    vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts" as const,
    currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts" as const,
    commandOwner: "TaskWorkbenchAdapterService" as const,
  }
  return [
    {
      ...common,
      id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal,
      label: "Rerun Task",
      available: restartAvailable,
      stateSource: (activeWithTerminal ? "taskRunner/activeExecutionMap" : "taskRunner/terminalLastTaskMap") as TaskTerminalTabActionEvidence["stateSource"],
    },
    {
      ...common,
      id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll,
      label: "Terminate All Tasks",
      available: canTerminateAllActiveExecutions(activeExecutions),
      stateSource: "taskRunner/activeExecutionMap",
    },
  ]
}

function buildTaskTerminalServiceLifecycleEvidence(
  activeExecutions: TaskActiveExecutionProjection[],
  terminalLastTaskMap: TaskTerminalLastTaskProjection[] = [],
  terminalTaskOwner = resolveTaskTerminalTaskOwnerEvidence(activeExecutions, terminalLastTaskMap),
  terminalTabActions = buildTaskTerminalTabActionEvidence(activeExecutions, terminalLastTaskMap, terminalTaskOwner),
): TaskTerminalServiceLifecycleEvidence {
  const activeWithTerminal = activeExecutions.find((execution) => typeof execution.terminalInstanceId === "number")
  const lastTaskWithTerminal = terminalLastTaskMap.find((entry) => entry.status === "finished" && Boolean(findTaskConfig(entry.taskId)))
  const terminalInstanceId = activeWithTerminal?.terminalInstanceId ?? lastTaskWithTerminal?.terminalInstanceId ?? terminalTaskOwner.terminalInstanceId
  const terminal = typeof terminalInstanceId === "number" ? getTerminalByInstanceId(terminalInstanceId) : null
  const registry = buildTaskTerminalServiceRegistryEvidence(activeExecutions, terminalLastTaskMap)
  const reuseRegistry = buildTaskTerminalReuseRegistryEvidence(terminalLastTaskMap)
  const hasTerminalManagerInstance = Boolean(terminal)
  const hasPtyDisposeOnExitOwner = typeof terminalInstanceId === "number" && canTerminateTerminalByInstanceId(terminalInstanceId)
  const hasReusableTerminalOwner = typeof terminalInstanceId === "number"
    && Boolean(globalTerminalService.instances.find((instance) => instance.instanceId === terminalInstanceId)?.reuseTerminal)
  const hasTabActionCommands = terminalTabActions.some((action) => action.id === TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal)
    && terminalTabActions.some((action) => action.id === TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll)
  const hasShellLaunchConfigTabActions = globalTerminalService.instances.some((instance) =>
    instance.shellLaunchConfig?.type === "Task"
    && instance.shellLaunchConfig.tabActions.some((action) => action.id === TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal)
    && instance.shellLaunchConfig.tabActions.some((action) => action.id === TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll),
  )
  const create = buildTerminalLifecycleStep({
    ownerConnected: hasTerminalManagerInstance,
    stateSource: hasTerminalManagerInstance ? "terminalManager" : terminalTaskOwner.stateSource,
    currentOwner: hasTerminalManagerInstance
      ? "terminalManager.createTerminal/getTerminalByInstanceId instance registry projection"
      : "taskRunner lifecycle returned terminalInstanceId without terminalManager instance registry",
    vscodeOwner: "ITerminalService.createTerminal + TerminalTaskSystem._doCreateTerminal",
    missingOwner: hasTerminalManagerInstance
      ? ""
      : "service-level ITerminalService.createTerminal instance registry wired to task execution",
    partialWhenDisconnected: typeof terminalInstanceId === "number",
  })
  const reuse = buildTerminalLifecycleStep({
    ownerConnected: hasReusableTerminalOwner,
    stateSource: hasReusableTerminalOwner ? "terminalManager" : terminalTaskOwner.stateSource,
    currentOwner: hasReusableTerminalOwner
      ? "TerminalWorkbenchAdapterService decorated instance reuseTerminal + TaskWorkbenchAdapterService terminalLastTaskMap"
      : "TaskWorkbenchAdapterService activeExecutionMap without reusable idle terminal registry",
    vscodeOwner: "TerminalTaskSystem._sameTaskTerminals/_idleTaskTerminals + reuseTerminal",
    missingOwner: hasReusableTerminalOwner
      ? ""
      : "TerminalTaskSystem idle/shared terminal reuse registry",
    partialWhenDisconnected: reuseRegistry.reusableTerminalInstanceIds.length > 0,
  })
  const dispose = buildTerminalLifecycleStep({
    ownerConnected: hasPtyDisposeOnExitOwner,
    stateSource: hasPtyDisposeOnExitOwner ? "terminalManager" : terminalTaskOwner.stateSource,
    currentOwner: hasPtyDisposeOnExitOwner
      ? "terminalManager canTerminateTerminalByInstanceId -> codek.pty.dispose"
      : "TaskWorkbenchAdapterService terminate projection without resolved pty dispose owner",
    vscodeOwner: "ITerminalInstance.dispose + TerminalTaskSystem._deleteTaskAndTerminal",
    missingOwner: hasPtyDisposeOnExitOwner
      ? ""
      : "terminalManager pty dispose owner for active task terminal instance",
  })
  const onExit = buildTerminalLifecycleStep({
    ownerConnected: hasPtyDisposeOnExitOwner,
    stateSource: hasPtyDisposeOnExitOwner ? "terminalManager" : terminalTaskOwner.stateSource,
    currentOwner: hasPtyDisposeOnExitOwner
      ? "terminalManager terminateTerminalByInstanceId waits for codek.pty.onExit"
      : "taskRunner lifecycle events without resolved codek.pty.onExit owner",
    vscodeOwner: "ITerminalInstance.onDisposed/onExit + TaskEvent.terminated/processEnded",
    missingOwner: hasPtyDisposeOnExitOwner
      ? ""
      : "terminalManager pty onExit owner for active task terminal instance",
  })
  const tabActions = buildTerminalLifecycleStep({
    ownerConnected: hasTabActionCommands && hasShellLaunchConfigTabActions,
    stateSource: hasShellLaunchConfigTabActions ? "terminalManager" : "commandRegistry/MenuRegistry",
    currentOwner: hasShellLaunchConfigTabActions
      ? "TaskWorkbenchAdapterService shellLaunchConfig.tabActions on decorated terminal instances"
      : "TaskWorkbenchAdapterService terminalTabActions command projection",
    vscodeOwner: "TerminalTaskSystem._terminalTabActions + shellLaunchConfig.tabActions",
    missingOwner: hasTabActionCommands && hasShellLaunchConfigTabActions
      ? ""
      : "terminal tab action command projection",
    partialWhenDisconnected: hasTabActionCommands,
  })
  const steps = { create, reuse, dispose, onExit, tabActions }
  const blocked = lifecycleBlockedSteps(steps)
  const connectedCount = Object.values(steps).filter((step) => step.status === "connected").length
  const status: TaskTerminalLifecycleConnectionStatus = blocked.length === 0
    ? "connected"
    : connectedCount > 0 || Object.values(steps).some((step) => step.status === "partial")
      ? "partial"
      : "blocked"

  return {
    status,
    terminalInstanceId,
    taskId: terminalTaskOwner.taskId,
    taskName: terminalTaskOwner.taskName,
    registry,
    reuseRegistry,
    create,
    reuse,
    dispose,
    onExit,
    tabActions,
    stateSource: "taskRunner/TaskSystemLifecycleProjection",
    vscodeOwner: "TerminalTaskSystem + ITerminalService + ITerminalInstance lifecycle",
    currentOwner: "TaskWorkbenchAdapterService + terminalManager",
    vscodeSourcePaths: [
      "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
      "src/vs/workbench/contrib/tasks/browser/abstractTaskService.ts",
      "src/vs/workbench/contrib/tasks/common/tasks.ts",
      "src/vs/workbench/contrib/terminal/browser/terminalService.ts",
    ],
    currentSourcePaths: [
      "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
      "frontend/vite-project/src/workbench/taskRunner.ts",
      "frontend/vite-project/src/terminal/terminalManager.ts",
    ],
    blocked,
    runtimeReference: false,
  }
}

function buildTaskTerminalServiceRegistryEvidence(
  activeExecutions: TaskActiveExecutionProjection[],
  terminalLastTaskMap: TaskTerminalLastTaskProjection[],
): TaskTerminalServiceRegistryEvidence {
  const terminals = globalTerminalService.getTerminals()
  const terminalInstanceIds = new Set(terminals.map((terminal) => terminal.instanceId))
  const trackedTaskTerminalInstanceIds = [
    ...activeExecutions.map((execution) => execution.terminalInstanceId),
    ...terminalLastTaskMap.map((entry) => entry.terminalInstanceId),
  ].filter((id): id is number => typeof id === "number" && terminalInstanceIds.has(id))
  const activeTerminal = globalTerminalService.getActiveTerminal()
  const hasRegistry = terminals.length > 0
  const hasCreateEventFacade = typeof globalTerminalService.onDidCreateInstance === "function"
  const hasDisposeEventFacade = typeof globalTerminalService.onDidDisposeInstance === "function"
  return {
    status: hasRegistry && hasCreateEventFacade && hasDisposeEventFacade ? "connected" : hasRegistry ? "partial" : "blocked",
    instanceCount: terminals.length,
    activeInstanceId: activeTerminal?.instanceId ?? null,
    trackedTaskTerminalInstanceIds: Array.from(new Set(trackedTaskTerminalInstanceIds)),
    onDidCreateInstance: hasRegistry && hasCreateEventFacade,
    onDidDisposeInstance: hasRegistry && hasDisposeEventFacade,
    stateSource: "terminalManager",
    vscodeOwner: "ITerminalService.instances + onDidCreateInstance/onDidDisposeInstance",
    currentOwner: hasRegistry
      ? "TerminalWorkbenchAdapterService instances + terminalManager onTerminalEvent facade"
      : "terminalManager without observed task terminal instances",
    missingOwner: hasRegistry && hasCreateEventFacade && hasDisposeEventFacade
      ? ""
      : "ITerminalService.instances registry wired to task terminal creation",
    vscodeSourcePath: "src/vs/workbench/contrib/terminal/browser/terminalService.ts",
    currentSourcePath: "frontend/vite-project/src/terminal/terminalManager.ts",
    runtimeReference: false,
  }
}

function buildTaskTerminalReuseRegistryEvidence(
  terminalLastTaskMap: TaskTerminalLastTaskProjection[],
): TaskTerminalReuseRegistryEvidence {
  const terminalReuseRegistry = getTaskTerminalReuseRegistrySnapshot()
  const sameTaskTerminalInstanceIds = terminalReuseRegistry.sameTaskTerminals.map((entry) => entry.terminalInstanceId)
  const idleTaskTerminalInstanceIds = terminalReuseRegistry.idleTaskTerminals.map((entry) => entry.terminalInstanceId)
  const reusableTerminalInstanceIds = terminalLastTaskMap
    .filter((entry) => entry.status === "finished" && Boolean(findTaskConfig(entry.taskId)))
    .map((entry) => entry.terminalInstanceId)
  const activeTerminalInstanceIds = terminalLastTaskMap
    .filter((entry) => entry.status === "active")
    .map((entry) => entry.terminalInstanceId)
  const finishedTerminalInstanceIds = terminalLastTaskMap
    .filter((entry) => entry.status === "finished")
    .map((entry) => entry.terminalInstanceId)
  const hasTerminalReuseRegistry = terminalReuseRegistry.sameTaskCount > 0 || terminalReuseRegistry.idleTaskCount > 0
  const hasTerminalLastTaskReuseCandidate = reusableTerminalInstanceIds.length > 0
  return {
    status: hasTerminalReuseRegistry || hasTerminalLastTaskReuseCandidate ? "partial" : "blocked",
    reusableTerminalInstanceIds: Array.from(new Set(reusableTerminalInstanceIds)),
    activeTerminalInstanceIds: Array.from(new Set(activeTerminalInstanceIds)),
    finishedTerminalInstanceIds: Array.from(new Set(finishedTerminalInstanceIds)),
    sameTaskTerminalInstanceIds: Array.from(new Set(sameTaskTerminalInstanceIds)),
    idleTaskTerminalInstanceIds: Array.from(new Set(idleTaskTerminalInstanceIds)),
    supportsPhysicalReuse: terminalReuseRegistry.supportsPhysicalReuse,
    stateSource: "terminalManager/taskTerminalReuseRegistry",
    vscodeOwner: "TerminalTaskSystem._sameTaskTerminals/_idleTaskTerminals + ITerminalInstance.reuseTerminal",
    currentOwner: hasTerminalReuseRegistry
      ? "terminalManager TaskTerminalReuseRegistry same/idle task terminal owner + TaskWorkbenchAdapterService lifecycle events"
      : "TaskWorkbenchAdapterService lifecycle without observed terminalManager same/idle reuse registry entries",
    missingOwner: hasTerminalReuseRegistry
      ? terminalReuseRegistry.missingPhysicalReuseOwner
      : "TerminalTaskSystem._sameTaskTerminals/_idleTaskTerminals owner",
    vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
    currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
    runtimeReference: false,
  }
}

function buildTerminalLifecycleStep(options: {
  ownerConnected: boolean
  currentOwner: string
  vscodeOwner: string
  missingOwner: string
  stateSource: TaskTerminalLifecycleStepEvidence["stateSource"]
  partialWhenDisconnected?: boolean
}): TaskTerminalLifecycleStepEvidence {
  return {
    status: options.ownerConnected
      ? options.missingOwner ? "partial" : "connected"
      : options.partialWhenDisconnected ? "partial" : "blocked",
    ownerConnected: options.ownerConnected,
    currentOwner: options.currentOwner,
    vscodeOwner: options.vscodeOwner,
    missingOwner: options.missingOwner,
    stateSource: options.stateSource,
  }
}

function lifecycleBlockedSteps(
  steps: Record<"create" | "reuse" | "dispose" | "onExit" | "tabActions", TaskTerminalLifecycleStepEvidence>,
): TaskTerminalServiceLifecycleEvidence["blocked"] {
  return (Object.entries(steps) as Array<["create" | "reuse" | "dispose" | "onExit" | "tabActions", TaskTerminalLifecycleStepEvidence]>)
    .filter(([, step]) => step.status !== "connected")
    .map(([capability, step]) => ({
      capability,
      missingOwner: step.missingOwner,
      vscodeOwner: step.vscodeOwner,
      currentOwner: step.currentOwner,
    }))
}

function createTaskLifecycleRunId(): string {
  return `task-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function writeTaskEvidenceToOutput(evidence: TaskRunEvidence): void {
  const channel = getOutputChannel("Tasks")
  channel.appendLine(`[${evidence.status}] ${evidence.name}: ${evidence.summary}`)
  for (const step of evidence.steps) {
    channel.appendLine(`- ${step.name}: ${step.status} ${step.exitCode ?? ""}`.trim())
    if (step.outputPreview) {
      channel.appendLine(`  output: ${step.outputPreview}`)
    }
    if (step.errorPreview) {
      channel.appendLine(`  error: ${step.errorPreview}`)
    }
  }
}

function createEmptyPaneCompositeEvidence(): PaneCompositePartEvidence {
  return {
    serviceId: String(IPaneCompositePartService),
    stateSource: "workbenchLayoutService",
    lastOpenedPanelId: "",
    lastToggledPanelId: "",
    lastOpenedDebugViewId: "",
    lastOpenedTaskViewId: "",
    problemsOpened: false,
    openCount: 0,
    toggleCount: 0,
  }
}

export function buildTerminalDebugTaskWorkbenchContributionSurface(): TerminalDebugTaskWorkbenchContributionSurface {
  const commandsByArea: TerminalDebugTaskWorkbenchContributionSurface["commandsByArea"] = {
    terminal: [
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalToggle,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalNew,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalSplit,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalClear,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalRunActiveFile,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalRunSelectedText,
    ],
    output: [
      TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputShow,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputClear,
    ],
    debug: [
      TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugOpen,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugStart,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugStop,
    ],
    tasks: [
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksOpen,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRun,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerun,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminate,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll,
    ],
    problems: [
      TERMINAL_DEBUG_TASK_COMMAND_IDS.ProblemsToggle,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.ProblemsFocus,
    ],
  }
  const serviceByArea: Record<keyof typeof commandsByArea, string> = {
    terminal: String(ITerminalService),
    output: String(IOutputService),
    debug: String(IDebugService),
    tasks: String(ITaskService),
    problems: String(IProblemsWorkbenchService),
  }

  return {
    source: "vscode-adapted",
    services: [
      { id: String(ITerminalService), source: "vscode", stateSource: "terminalManager" },
      { id: String(IOutputService), source: "vscode", stateSource: "outputLogTelemetryService" },
      { id: String(IDebugService), source: "vscode", stateSource: "debugState/debugRuntime" },
      { id: String(ITaskService), source: "vscode", stateSource: TASK_CONFIG_STATE_SOURCE },
      { id: String(IProblemsWorkbenchService), source: "vscode", stateSource: "problemsDiagnosticsService(globalMarkerService)" },
      { id: String(IPaneCompositePartService), source: "vscode", stateSource: "workbenchLayoutService" },
      { id: String(ITerminalDebugTaskWorkbenchService), source: "vscode", stateSource: "facade" },
    ],
    viewsByArea: {
      terminal: [TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal],
      output: [TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output],
      debug: [
        DEBUG_WORKBENCH_VIEW_IDS.Container,
        DEBUG_WORKBENCH_VIEW_IDS.Variables,
        DEBUG_WORKBENCH_VIEW_IDS.Watch,
        DEBUG_WORKBENCH_VIEW_IDS.CallStack,
        DEBUG_WORKBENCH_VIEW_IDS.Breakpoints,
        DEBUG_WORKBENCH_VIEW_IDS.Console,
      ],
      tasks: [
        TASK_WORKBENCH_VIEW_IDS.Container,
        TASK_WORKBENCH_VIEW_IDS.Tasks,
        TASK_WORKBENCH_VIEW_IDS.ProblemMatchers,
      ],
      problems: [
        TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer,
        TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems,
      ],
    },
    commandsByArea,
    commands: Object.entries(commandsByArea).flatMap(([area, ids]) =>
      ids.map((id) => ({
        id,
        category: commandCategoryForArea(area),
        serviceId: serviceByArea[area as keyof typeof commandsByArea],
        menus: commandMenus(id).map((menu) => ({
          id: menu.id.id,
          group: menu.group,
          order: menu.order,
          when: menu.when,
        })),
      })),
    ),
    stateSources: {
      terminal: "terminalManager",
      output: "outputLogTelemetryService",
      debug: "debugState/debugRuntime",
      tasks: TASK_CONFIG_STATE_SOURCE,
      problems: "problemsDiagnosticsService(globalMarkerService)",
      paneComposite: "workbenchLayoutService",
    },
  }
}

function createPaneCompositeEvidenceFromLayout(snapshot: WorkbenchPaneCompositeSnapshot): PaneCompositePartEvidence {
  const events = snapshot.events
  const lastOpenedPanel = findLastPaneCompositeEvent(events, "panel", "open", undefined, [
    TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer,
    TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems,
  ])
  const lastToggledPanel = findLastPaneCompositeEvent(events, "panel", "toggle")
  const lastOpenedDebugView = findLastPaneCompositeEvent(events, "sideBar", "open", DEBUG_WORKBENCH_VIEW_IDS.Container)
  const lastOpenedTaskView = findLastPaneCompositeEvent(events, "sideBar", "open", TASK_WORKBENCH_VIEW_IDS.Container)
  const problemsOpened = events.some((event) =>
    event.location === "panel"
      && event.action === "open"
      && (event.id === TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer
        || event.id === TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems),
  )
  return {
    serviceId: String(IPaneCompositePartService),
    stateSource: "workbenchLayoutService",
    lastOpenedPanelId: lastOpenedPanel?.id || "",
    lastToggledPanelId: lastToggledPanel?.id || "",
    lastOpenedDebugViewId: lastOpenedDebugView?.id || "",
    lastOpenedTaskViewId: lastOpenedTaskView?.id || "",
    problemsOpened,
    openCount: events.filter((event) => event.action === "open" && (event.location === "panel" || event.location === "sideBar")).length,
    toggleCount: events.filter((event) => event.action === "toggle" && (event.location === "panel" || event.location === "sideBar")).length,
  }
}

function findLastPaneCompositeEvent(
  events: WorkbenchPaneCompositeSnapshot["events"],
  location: "panel" | "sideBar",
  action: "open" | "toggle",
  id?: string,
  excludeIds: string[] = [],
): WorkbenchPaneCompositeSnapshot["events"][number] | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.location !== location || event.action !== action) continue
    if (id && event.id !== id) continue
    if (excludeIds.includes(event.id)) continue
    return event
  }
  return undefined
}

function commandCategoryForArea(area: string): string {
  if (area === "tasks") return "Tasks"
  return area.charAt(0).toUpperCase() + area.slice(1)
}

function commandMenus(id: string): Array<{ id: MenuId; group?: string; order?: number; when?: string }> {
  switch (id) {
    case TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalToggle:
      return [
        { id: MenuId.MenubarViewMenu, group: "4_panel", order: 20 },
        { id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal}`, group: "navigation", order: 10 },
      ]
    case TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalNew:
      return [{ id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal}`, group: "navigation", order: 20 }]
    case TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalSplit:
      return [{ id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal}`, group: "navigation", order: 30 }]
    case TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalClear:
      return [{ id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal}`, group: "navigation", order: 40 }]
    case TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputShow:
      return [
        { id: MenuId.MenubarViewMenu, group: "4_panel", order: 30 },
        { id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output}`, group: "navigation", order: 10 },
      ]
    case TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputClear:
      return [{ id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output}`, group: "navigation", order: 20 }]
    case TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugOpen:
      return [{ id: MenuId.MenubarViewMenu, group: "1_views", order: 130 }]
    case TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugStart:
      return [{ id: MenuId.ViewTitle, when: `view == ${DEBUG_WORKBENCH_VIEW_IDS.Container}`, group: "navigation", order: 10 }]
    case TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugStop:
      return [{ id: MenuId.ViewTitle, when: `view == ${DEBUG_WORKBENCH_VIEW_IDS.Container}`, group: "navigation", order: 20 }]
    case TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksOpen:
      return [{ id: MenuId.MenubarViewMenu, group: "1_views", order: 135 }]
    case TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRun:
      return [{ id: MenuId.ViewTitle, when: `view == ${TASK_WORKBENCH_VIEW_IDS.Container}`, group: "navigation", order: 10 }]
    case TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerun:
      return [{ id: MenuId.ViewTitle, when: `view == ${TASK_WORKBENCH_VIEW_IDS.Container}`, group: "navigation", order: 20 }]
    case TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal:
      return [{ id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal}`, group: "navigation", order: 50 }]
    case TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminate:
      return [{ id: MenuId.ViewTitle, when: `view == ${TASK_WORKBENCH_VIEW_IDS.Container}`, group: "navigation", order: 30 }]
    case TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll:
      return [{ id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal}`, group: "navigation", order: 60 }]
    case TERMINAL_DEBUG_TASK_COMMAND_IDS.ProblemsToggle:
      return [
        { id: MenuId.MenubarViewMenu, group: "4_panel", order: 40 },
        { id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems}`, group: "navigation", order: 10 },
      ]
    case TERMINAL_DEBUG_TASK_COMMAND_IDS.ProblemsFocus:
      return [{ id: MenuId.ViewTitle, when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems}`, group: "navigation", order: 20 }]
    default:
      return []
  }
}
