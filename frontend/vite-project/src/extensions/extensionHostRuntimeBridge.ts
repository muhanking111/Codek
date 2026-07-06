import {
  quickInputService,
  type InputBoxOptions,
  type QuickInputService,
  type QuickPickController,
  type QuickPickEntry,
  type QuickPickItem,
  type QuickPickOptions,
} from "../workbench/quickInput"
import {
  globalWorkbenchNotificationService,
  globalWorkbenchProgressService,
  type IWorkbenchNotificationService,
  type IWorkbenchProgressService,
  ProgressLocation,
  type WorkbenchNotificationSeverity,
} from "../workbench/statusNotificationProgressService"
import {
  globalOutputLogTelemetryService,
  type CodekOutputLogTelemetryService,
  type OutputChannelUpdateMode,
} from "../workbench/outputLogTelemetryService"
import {
  globalTestingService,
  registerTestingCallbackCommands,
  type PublishedTestResultSnapshot,
  type TestCoverageFileSnapshot,
  type TestItemSnapshot,
  type TestResultState,
  type TestingService,
  type TestingTestMessageFollowup,
  type TestingTestMessageFollowupRequest,
  type TestRunProfileGroup,
  type TestRunProfileSnapshot,
  type TestRunRequestSnapshot,
  type TestRunTaskSnapshot,
} from "../testing/testingService"
import {
  globalTaskService,
  type TaskRunServiceOptions,
  type TaskWorkbenchService,
} from "../workbench/terminalDebugTaskWorkbench"
import {
  userTasksService,
  type ExtensionProviderTaskDto,
} from "../workbench/userTasks"
import type { RunConfig } from "../components/debugState"
import { debugState, type ConsoleEntry } from "../components/debugState"
import type { TaskCommandResult } from "../workbench/taskRunner"
import { attachPty, createTerminal, markExited, type ShellType } from "../terminal/terminalManager"

type Disposable = () => void

export interface ExtensionHostMessageCommand {
  title: string
  handle: number
  isCloseAffordance?: boolean
}

export interface ExtensionHostMessagePayload {
  requestId?: string
  severity?: string
  message?: string
  options?: Record<string, unknown>
  commands?: ExtensionHostMessageCommand[]
  actions?: string[]
}

export interface ExtensionHostQuickPickRawItem {
  handle?: number
  label?: string
  description?: string
  detail?: string
  picked?: boolean
  disabled?: boolean
  type?: string
  kind?: number
  [key: string]: unknown
}

export interface ExtensionHostQuickPickPayload {
  instance: number | string
  options?: Record<string, unknown>
  params?: Record<string, unknown>
  items?: ExtensionHostQuickPickRawItem[]
}

export interface ExtensionHostQuickPickItemsPayload {
  instance: number | string
  items?: ExtensionHostQuickPickRawItem[]
}

export interface ExtensionHostInputPayload {
  instanceId: string
  options?: Record<string, unknown>
  validateInput?: boolean
}

export interface ExtensionHostOutputRegisterPayload {
  channelId?: string
  label?: string
  languageId?: string
  file?: {
    scheme?: string
    path?: string
  }
}

export interface ExtensionHostOutputUpdatePayload {
  channelId?: string
  mode?: number | string
  till?: number
}

export interface ExtensionHostOutputContentPayload {
  channelId?: string
  content?: string
  mode?: number | string
  till?: number
}

export interface ExtensionHostOutputChannelPayload {
  channelId?: string
  preserveFocus?: boolean
}

export interface ExtensionHostProgressStartPayload {
  handle?: number | string
  location?: number | string
  title?: string
  source?: string
  cancellable?: boolean
  cancellableLabel?: string
  buttons?: string[]
  secondaryActions?: Array<{
    id?: string
    label?: string
    command?: string
    args?: readonly unknown[]
    keepOpen?: boolean
  }>
  extensionId?: string
}

export interface ExtensionHostProgressReportPayload {
  handle?: number | string
  message?: string | {
    message?: string
    increment?: number
    total?: number
    worked?: number
  }
}

export interface ExtensionHostProgressEndPayload {
  handle?: number | string
}

export interface ExtensionHostDebugConsoleAppendPayload {
  sessionId?: string
  entry?: {
    id?: string
    type?: string
    text?: string
    createdAt?: number
  }
}

export interface ExtensionHostTestingControllerPayload {
  controllerId?: string
  label?: string
}

export interface ExtensionHostTestingProfilePayload extends TestRunProfileSnapshot {}

export interface ExtensionHostTestingProfileUpdatePayload {
  controllerId?: string
  profileId?: number
  update?: Partial<TestRunProfileSnapshot>
}

export interface ExtensionHostTestingProfileRemovePayload {
  controllerId?: string
  profileId?: number
}

export interface ExtensionHostTestingItemPayload extends TestItemSnapshot {}

export interface ExtensionHostTestingItemRemovePayload {
  itemId?: string
}

export interface ExtensionHostTestingRunStartPayload extends TestRunRequestSnapshot {}

export interface ExtensionHostTestingRunTaskStartPayload {
  runId?: string
  task?: Partial<Omit<TestRunTaskSnapshot, "startedAt" | "completedAt">>
}

export interface ExtensionHostTestingRunTaskFinishPayload {
  runId?: string
  taskId?: string
}

export interface ExtensionHostTestingRunOutputPayload {
  runId?: string
  message?: string
  testId?: string
  locationUri?: string
}

export interface ExtensionHostTestingRunStatePayload {
  runId?: string
  testId?: string
  state?: TestResultState
  durationMs?: number
  messages?: string[]
}

export interface ExtensionHostTestingRunCompletePayload {
  runId?: string
  state?: TestResultState
}

export interface ExtensionHostTestingCoveragePayload {
  files?: TestCoverageFileSnapshot[]
}

export interface ExtensionHostTestingRetirePayload {
  testIds?: string[]
}

export interface ExtensionHostTestingCancelPayload {
  runId?: string
  taskId?: string
}

export interface ExtensionHostTestingConfigureProfilePayload {
  controllerId: string
  profileId: number
}

export interface ExtensionHostTestingCoverageDetailsPayload {
  coverageId: string
  testId?: string
}

export interface ExtensionHostTestingFollowupRequestPayload extends TestingTestMessageFollowupRequest {}

export interface ExtensionHostTaskProviderEvidencePayload {
  handle?: number | string
  type?: string
  source?: string
  stateSource?: string
  taskCount?: number
  task?: ExtensionProviderTaskDto
  executionId?: string
}

export interface ExtensionHostTaskProviderProvidePayload extends ExtensionHostTaskProviderEvidencePayload {
  tasks?: ExtensionProviderTaskDto[]
}

export interface ExtensionHostTestingCallbacks {
  cancelRun(payload: ExtensionHostTestingCancelPayload): void
  configureProfile(payload: ExtensionHostTestingConfigureProfilePayload): void
  getCoverageDetails(payload: ExtensionHostTestingCoverageDetailsPayload): Promise<unknown[]>
  provideTestFollowups(payload: ExtensionHostTestingFollowupRequestPayload): Promise<TestingTestMessageFollowup[]>
  executeTestFollowup(id: number): Promise<void>
  disposeTestFollowups(ids: number[]): void
  syncTests(): Promise<boolean>
  refreshTests(payload: { controllerId: string }): Promise<boolean>
  expandTest(payload: { testId: string; levels?: number }): Promise<boolean>
  getCodeRelatedToTest(payload: { testId: string }): Promise<unknown[]>
  getTestsRelatedToCode(payload: { uri: unknown; position: unknown }): Promise<unknown[]>
  publishTestResults(results: PublishedTestResultSnapshot[]): void
}

export interface ExtensionHostRuntimeIpc {
  onExtHostMessage?: (callback: (payload: ExtensionHostMessagePayload) => void | Promise<void>) => Disposable
  sendExtHostMessageResult?: (payload: { requestId?: string; handle?: number }) => void
  onExtHostQuickPickShow?: (callback: (payload: ExtensionHostQuickPickPayload) => void | Promise<void>) => Disposable
  onExtHostQuickPickItems?: (callback: (payload: ExtensionHostQuickPickItemsPayload) => void) => Disposable
  onExtHostQuickPickUpdate?: (callback: (payload: ExtensionHostQuickPickPayload) => void) => Disposable
  onExtHostQuickPickError?: (callback: (payload: { instance: number | string; error?: string }) => void) => Disposable
  onExtHostQuickPickDispose?: (callback: (payload: { instance: number | string }) => void) => Disposable
  sendExtHostQuickPickResult?: (payload: { instance: number | string; result?: number | number[] }) => void
  onExtHostInputShow?: (callback: (payload: ExtensionHostInputPayload) => void | Promise<void>) => Disposable
  sendExtHostInputResult?: (payload: { instanceId: string; value?: string }) => void
  onExtHostOutputRegister?: (callback: (payload: ExtensionHostOutputRegisterPayload) => void) => Disposable
  onExtHostOutputContent?: (callback: (payload: ExtensionHostOutputContentPayload) => void) => Disposable
  onExtHostOutputUpdate?: (callback: (payload: ExtensionHostOutputUpdatePayload) => void) => Disposable
  onExtHostOutputReveal?: (callback: (payload: ExtensionHostOutputChannelPayload) => void) => Disposable
  onExtHostOutputClose?: (callback: (payload: ExtensionHostOutputChannelPayload) => void) => Disposable
  onExtHostOutputDispose?: (callback: (payload: ExtensionHostOutputChannelPayload) => void) => Disposable
  onExtHostDebugConsoleAppend?: (callback: (payload: ExtensionHostDebugConsoleAppendPayload) => void) => Disposable
  onExtHostProgressStart?: (callback: (payload: ExtensionHostProgressStartPayload) => void) => Disposable
  onExtHostProgressReport?: (callback: (payload: ExtensionHostProgressReportPayload) => void) => Disposable
  onExtHostProgressEnd?: (callback: (payload: ExtensionHostProgressEndPayload) => void) => Disposable
  sendExtHostProgressCancel?: (payload: { handle: number | string; choice?: unknown }) => void
  onExtHostTestingController?: (callback: (payload: ExtensionHostTestingControllerPayload) => void) => Disposable
  onExtHostTestingControllerRemove?: (callback: (payload: ExtensionHostTestingControllerPayload) => void) => Disposable
  onExtHostTestingProfile?: (callback: (payload: ExtensionHostTestingProfilePayload) => void) => Disposable
  onExtHostTestingProfileUpdate?: (callback: (payload: ExtensionHostTestingProfileUpdatePayload) => void) => Disposable
  onExtHostTestingProfileRemove?: (callback: (payload: ExtensionHostTestingProfileRemovePayload) => void) => Disposable
  onExtHostTestingItem?: (callback: (payload: ExtensionHostTestingItemPayload) => void) => Disposable
  onExtHostTestingItemRemove?: (callback: (payload: ExtensionHostTestingItemRemovePayload) => void) => Disposable
  onExtHostTestingRunStart?: (callback: (payload: ExtensionHostTestingRunStartPayload) => void) => Disposable
  onExtHostTestingRunTaskStart?: (callback: (payload: ExtensionHostTestingRunTaskStartPayload) => void) => Disposable
  onExtHostTestingRunTaskFinish?: (callback: (payload: ExtensionHostTestingRunTaskFinishPayload) => void) => Disposable
  onExtHostTestingRunOutput?: (callback: (payload: ExtensionHostTestingRunOutputPayload) => void) => Disposable
  onExtHostTestingRunState?: (callback: (payload: ExtensionHostTestingRunStatePayload) => void) => Disposable
  onExtHostTestingRunComplete?: (callback: (payload: ExtensionHostTestingRunCompletePayload) => void) => Disposable
  onExtHostTestingCoverage?: (callback: (payload: ExtensionHostTestingCoveragePayload) => void) => Disposable
  onExtHostTestingRetire?: (callback: (payload: ExtensionHostTestingRetirePayload) => void) => Disposable
  sendExtHostTestingCancel?: (payload: ExtensionHostTestingCancelPayload) => void
  sendExtHostTestingConfigureProfile?: (payload: ExtensionHostTestingConfigureProfilePayload) => void
  getExtHostTestingCoverageDetails?: (payload: ExtensionHostTestingCoverageDetailsPayload) => Promise<unknown[]>
  provideExtHostTestingFollowups?: (payload: ExtensionHostTestingFollowupRequestPayload) => Promise<TestingTestMessageFollowup[]>
  executeExtHostTestingFollowup?: (payload: { id: number }) => Promise<void> | void
  disposeExtHostTestingFollowups?: (payload: { ids: number[] }) => Promise<void> | void
  syncExtHostTesting?: () => Promise<boolean>
  refreshExtHostTesting?: (payload: { controllerId: string }) => Promise<boolean>
  expandExtHostTesting?: (payload: { testId: string; levels?: number }) => Promise<boolean>
  getExtHostTestingCodeRelatedToTest?: (payload: { testId: string }) => Promise<unknown[]>
  getExtHostTestingTestsRelatedToCode?: (payload: { uri: unknown; position: unknown }) => Promise<unknown[]>
  publishExtHostTestingResults?: (payload: { results: PublishedTestResultSnapshot[] }) => void
  onExtHostTaskProviderRegister?: (callback: (payload: ExtensionHostTaskProviderEvidencePayload) => void) => Disposable
  onExtHostTaskProviderUnregister?: (callback: (payload: ExtensionHostTaskProviderEvidencePayload) => void) => Disposable
  onExtHostTaskProviderProvide?: (callback: (payload: ExtensionHostTaskProviderProvidePayload) => void) => Disposable
  onExtHostTaskProviderResolve?: (callback: (payload: ExtensionHostTaskProviderEvidencePayload) => void) => Disposable
  onExtHostTaskProviderExecute?: (callback: (payload: ExtensionHostTaskProviderEvidencePayload) => void | Promise<void>) => Disposable
  onExtHostTaskProviderExecuteBlocked?: (callback: (payload: ExtensionHostTaskProviderEvidencePayload) => void) => Disposable
  onExtHostTaskProviderTerminateBlocked?: (callback: (payload: ExtensionHostTaskProviderEvidencePayload) => void) => Disposable
  runCommand?: (
    command: string,
    options?: { cwd?: string; env?: Record<string, string> },
  ) => Promise<{
    stdout?: string
    stderr?: string
    error?: string
    exitCode?: number
    timedOut?: boolean
    terminalInstanceId?: number | null
    terminalId?: number | null
    processId?: number | null
  }>
  pty?: {
    create?: (opts: {
      shellType?: ShellType
      cwd?: string
      cols?: number
      rows?: number
      env?: Record<string, string>
      confirmed?: boolean
    }) => Promise<{ ok?: boolean; id?: string; pid?: number | null; error?: string }>
    write?: (id: string, data: string) => Promise<boolean> | boolean
    dispose?: (id: string) => Promise<boolean> | boolean
    onData?: (callback: (payload: { id: string; data?: string }) => void) => Disposable
    onExit?: (callback: (payload: { id: string; exitCode?: number | null; code?: number | null }) => void) => Disposable
  }
}

export interface InstallExtensionHostRuntimeBridgeOptions {
  ipc?: ExtensionHostRuntimeIpc | null
  quickInput?: QuickInputService
  notificationService?: IWorkbenchNotificationService
  outputService?: CodekOutputLogTelemetryService
  progressService?: IWorkbenchProgressService
  testingService?: TestingService
  taskService?: TaskWorkbenchService
}

interface QuickPickSession {
  controller: QuickPickController<number>
}

interface ProgressSession {
  report(step: { message?: string; increment?: number; total?: number }): void
  attach?(report: (step: { message?: string; increment?: number; total?: number }) => void): void
  resolve(): void
}

interface RuntimeBridgeInstallation {
  testingCallbacks: ExtensionHostTestingCallbacks
  dispose(): void
}

let activeInstallation: RuntimeBridgeInstallation | null = null

export function installExtensionHostRuntimeBridge(
  options: InstallExtensionHostRuntimeBridgeOptions = {},
): RuntimeBridgeInstallation {
  if (activeInstallation) return activeInstallation

  const ipc = options.ipc ?? getDefaultRuntimeIpc()
  if (!ipc) {
    return {
      testingCallbacks: createNoopTestingCallbacks(),
      dispose: () => {},
    }
  }

  const quickInput = options.quickInput ?? quickInputService
  const notificationService = options.notificationService ?? globalWorkbenchNotificationService
  const outputService = options.outputService ?? globalOutputLogTelemetryService
  const progressService = options.progressService ?? globalWorkbenchProgressService
  const testingService = options.testingService ?? globalTestingService
  const taskService = options.taskService ?? globalTaskService
  const disposables: Disposable[] = []
  const quickPicks = new Map<number | string, QuickPickSession>()
  const outputChannels = new Map<string, string>()
  const progressHandles = new Map<number | string, ProgressSession>()
  const testingCallbacks: ExtensionHostTestingCallbacks = {
    cancelRun(payload) {
      ipc.sendExtHostTestingCancel?.(payload)
    },
    configureProfile(payload) {
      ipc.sendExtHostTestingConfigureProfile?.(payload)
    },
    async getCoverageDetails(payload) {
      return await ipc.getExtHostTestingCoverageDetails?.(payload) ?? []
    },
    async provideTestFollowups(payload) {
      return await ipc.provideExtHostTestingFollowups?.(payload) ?? []
    },
    async executeTestFollowup(id) {
      await ipc.executeExtHostTestingFollowup?.({ id })
    },
    disposeTestFollowups(ids) {
      ipc.disposeExtHostTestingFollowups?.({ ids })
    },
    async syncTests() {
      return await ipc.syncExtHostTesting?.() ?? false
    },
    async refreshTests(payload) {
      return await ipc.refreshExtHostTesting?.(payload) ?? false
    },
    async expandTest(payload) {
      return await ipc.expandExtHostTesting?.(payload) ?? false
    },
    async getCodeRelatedToTest(payload) {
      return await ipc.getExtHostTestingCodeRelatedToTest?.(payload) ?? []
    },
    async getTestsRelatedToCode(payload) {
      return await ipc.getExtHostTestingTestsRelatedToCode?.(payload) ?? []
    },
    publishTestResults(results) {
      ipc.publishExtHostTestingResults?.({ results })
    },
  }
  testingService.setExtensionHostCallbacks(testingCallbacks)
  const testingCommandRegistration = registerTestingCallbackCommands(testingService)
  disposables.push(() => testingCommandRegistration.dispose())

  const addDisposable = (dispose: Disposable | undefined) => {
    if (typeof dispose === "function") disposables.push(dispose)
  }

  addDisposable(ipc.onExtHostMessage?.(async (payload) => {
    const severity = normalizeNotificationSeverity(payload?.severity)
    const message = String(payload?.message || "")
    if (message) {
      notificationService.notify({
        severity,
        message,
        duration: 0,
        source: "extensionHost",
        dedupeKey: payload?.requestId ? `extensionHost:${payload.requestId}` : undefined,
      })
    }

    const commands = normalizeMessageCommands(payload?.commands)
    if (commands.length === 0) {
      ipc.sendExtHostMessageResult?.({ requestId: payload?.requestId })
      return
    }

    const selected = await quickInput.showQuickPick(
      commands.map((command) => ({
        label: command.title,
        description: command.isCloseAffordance ? "Close" : undefined,
        value: command.handle,
      })),
      {
        title: message,
        placeHolder: "Select an action",
        ignoreFocusOut: payload?.options?.modal === true,
      },
    )
    ipc.sendExtHostMessageResult?.({
      requestId: payload?.requestId,
      handle: Array.isArray(selected) ? selected[0]?.value : selected?.value,
    })
  }))

  addDisposable(ipc.onExtHostQuickPickShow?.(async (payload) => {
    if (payload?.instance == null) return
    const session = getQuickPickSession(payload.instance, payload.options || payload.params, payload.items)
    try {
      const selected = await session.controller.show()
      ipc.sendExtHostQuickPickResult?.({
        instance: payload.instance,
        result: toQuickPickHandleResult(selected),
      })
    } finally {
      quickPicks.delete(payload.instance)
    }
  }))

  addDisposable(ipc.onExtHostQuickPickItems?.((payload) => {
    if (payload?.instance == null) return
    const session = getQuickPickSession(payload.instance)
    session.controller.setItems(normalizeQuickPickItems(payload.items))
  }))

  addDisposable(ipc.onExtHostQuickPickUpdate?.((payload) => {
    if (payload?.instance == null) return
    const session = getQuickPickSession(payload.instance, payload.params || payload.options)
    applyQuickPickOptions(session.controller, payload.params || payload.options)
  }))

  addDisposable(ipc.onExtHostQuickPickError?.((payload) => {
    if (payload?.instance == null) return
    const session = quickPicks.get(payload.instance)
    session?.controller.setValidationMessage(payload.error || undefined, payload.error ? "error" : "ignore")
  }))

  addDisposable(ipc.onExtHostQuickPickDispose?.((payload) => {
    if (payload?.instance == null) return
    const session = quickPicks.get(payload.instance)
    session?.controller.dispose()
    quickPicks.delete(payload.instance)
  }))

  addDisposable(ipc.onExtHostInputShow?.(async (payload) => {
    const instanceId = String(payload?.instanceId || "")
    if (!instanceId) return
    const value = await quickInput.showInputBox(normalizeInputOptions(payload.options))
    ipc.sendExtHostInputResult?.({ instanceId, value })
  }))

  addDisposable(ipc.onExtHostOutputRegister?.((payload) => {
    const channelId = String(payload?.channelId || "")
    const label = String(payload?.label || "").trim()
    if (!channelId || !label) return
    outputChannels.set(channelId, label)
    outputService.createOutputChannel(label, {
      source: "extensionHost",
      sources: ["extensionHost", channelId],
      user: true,
    })
  }))

  addDisposable(ipc.onExtHostOutputContent?.((payload) => {
    const label = getOutputLabel(payload?.channelId)
    if (!label) return
    const content = String(payload?.content ?? "")
    const mode = normalizeOutputUpdateMode(payload?.mode)
    if (mode === "clear") {
      outputService.clearChannel(label)
      return
    }
    if (!content) {
      outputService.updateChannel(label, mode)
      return
    }
    if (mode === "replace") {
      outputService.replaceChannel(label, content, "extensionHost")
      return
    }
    outputService.write(label, "info", content, "extensionHost")
  }))

  addDisposable(ipc.onExtHostOutputUpdate?.((payload) => {
    const label = getOutputLabel(payload?.channelId)
    if (!label) return
    outputService.updateChannel(label, normalizeOutputUpdateMode(payload?.mode))
  }))

  addDisposable(ipc.onExtHostOutputReveal?.((payload) => {
    const label = getOutputLabel(payload?.channelId)
    if (!label) return
    outputService.showChannel(label, payload?.preserveFocus !== false)
  }))

  addDisposable(ipc.onExtHostOutputClose?.((payload) => {
    const label = getOutputLabel(payload?.channelId)
    if (!label) return
    outputService.hideChannel(label)
  }))

  addDisposable(ipc.onExtHostOutputDispose?.((payload) => {
    const channelId = String(payload?.channelId || "")
    const label = getOutputLabel(channelId)
    if (!label) return
    outputService.disposeChannel(label)
    outputChannels.delete(channelId)
  }))

  addDisposable(ipc.onExtHostDebugConsoleAppend?.((payload) => {
    const entry = normalizeDebugConsoleEntry(payload)
    if (!entry) return
    debugState.consoleOutput.value.push(entry)
  }))

  addDisposable(ipc.onExtHostProgressStart?.((payload) => {
    const handle = normalizeProgressHandle(payload?.handle)
    if (handle === undefined) return
    let resolveTask: (() => void) | undefined
    let attachedReport: ((step: { message?: string; increment?: number; total?: number }) => void) | undefined
    const pendingSteps: { message?: string; increment?: number; total?: number }[] = []
    progressHandles.set(handle, {
      attach(report) {
        attachedReport = report
        while (pendingSteps.length) report(pendingSteps.shift()!)
      },
      report(step) {
        if (attachedReport) attachedReport(step)
        else pendingSteps.push(step)
      },
      resolve() {
        resolveTask?.()
      },
    })
    const taskPromise = progressService.withProgress(
      {
        location: normalizeProgressLocation(payload?.location),
        title: String(payload?.title || ""),
        source: String(payload?.source || payload?.extensionId || "extensionHost"),
        cancellable: payload?.cancellableLabel || payload?.cancellable === true,
        buttons: normalizeProgressButtons(payload?.buttons),
        secondaryActions: normalizeProgressSecondaryActions(payload?.secondaryActions),
      },
      async (progress) => new Promise<void>((resolve) => {
        resolveTask = resolve
        progressHandles.get(handle)?.attach?.(progress.report.bind(progress))
      }),
      (choice) => {
        ipc.sendExtHostProgressCancel?.({ handle, choice })
      },
    )
    taskPromise.catch(() => {})
  }))

  addDisposable(ipc.onExtHostProgressReport?.((payload) => {
    const handle = normalizeProgressHandle(payload?.handle)
    if (handle === undefined) return
    const entry = progressHandles.get(handle)
    entry?.report?.(normalizeProgressStep(payload?.message))
  }))

  addDisposable(ipc.onExtHostProgressEnd?.((payload) => {
    const handle = normalizeProgressHandle(payload?.handle)
    if (handle === undefined) return
    const entry = progressHandles.get(handle)
    entry?.resolve?.()
    progressHandles.delete(handle)
  }))

  addDisposable(ipc.onExtHostTestingController?.((payload) => {
    const controllerId = String(payload?.controllerId || "")
    if (!controllerId) return
    testingService.registerController({
      id: controllerId,
      label: String(payload?.label || controllerId),
    })
  }))

  addDisposable(ipc.onExtHostTestingControllerRemove?.((payload) => {
    const controllerId = String(payload?.controllerId || "")
    if (controllerId) testingService.unregisterController(controllerId)
  }))

  addDisposable(ipc.onExtHostTestingProfile?.((payload) => {
    const profile = normalizeTestingProfile(payload)
    if (profile) testingService.addProfile(profile)
  }))

  addDisposable(ipc.onExtHostTestingProfileUpdate?.((payload) => {
    const controllerId = String(payload?.controllerId || "")
    const profileId = Number(payload?.profileId)
    if (!controllerId || !Number.isFinite(profileId)) return
    testingService.updateProfile(controllerId, profileId, payload.update || {})
  }))

  addDisposable(ipc.onExtHostTestingProfileRemove?.((payload) => {
    const controllerId = String(payload?.controllerId || "")
    if (!controllerId) return
    testingService.removeProfile(controllerId, numberOrUndefined(payload.profileId))
  }))

  addDisposable(ipc.onExtHostTestingItem?.((payload) => {
    if (!payload?.id || !payload.controllerId) return
    testingService.upsertItem(payload)
  }))

  addDisposable(ipc.onExtHostTestingItemRemove?.((payload) => {
    const itemId = String(payload?.itemId || "")
    if (itemId) testingService.removeItem(itemId)
  }))

  addDisposable(ipc.onExtHostTestingRunStart?.((payload) => {
    const request = normalizeTestingRunStart(payload)
    if (request) testingService.startRun(request)
  }))

  addDisposable(ipc.onExtHostTestingRunTaskStart?.((payload) => {
    const runId = String(payload?.runId || "")
    const task = normalizeTestingRunTask(payload?.task)
    if (runId && task) testingService.startRunTask(runId, task)
  }))

  addDisposable(ipc.onExtHostTestingRunTaskFinish?.((payload) => {
    const runId = String(payload?.runId || "")
    const taskId = String(payload?.taskId || "")
    if (runId && taskId) testingService.finishRunTask(runId, taskId)
  }))

  addDisposable(ipc.onExtHostTestingRunOutput?.((payload) => {
    const runId = String(payload?.runId || "")
    if (!runId) return
    testingService.appendOutput(runId, String(payload?.message || ""), {
      testId: payload?.testId,
      locationUri: payload?.locationUri,
    })
  }))

  addDisposable(ipc.onExtHostTestingRunState?.((payload) => {
    const runId = String(payload?.runId || "")
    const testId = String(payload?.testId || "")
    const state = normalizeTestingState(payload?.state)
    if (!runId || !testId || !state) return
    testingService.updateRunItemState(runId, testId, state, payload?.durationMs, payload?.messages)
  }))

  addDisposable(ipc.onExtHostTestingRunComplete?.((payload) => {
    const runId = String(payload?.runId || "")
    if (!runId) return
    testingService.completeRun(runId, normalizeTestingState(payload?.state))
  }))

  addDisposable(ipc.onExtHostTestingCoverage?.((payload) => {
    testingService.publishCoverage(Array.isArray(payload?.files) ? payload.files : [])
  }))

  addDisposable(ipc.onExtHostTestingRetire?.((payload) => {
    testingService.markResultsRetired(Array.isArray(payload?.testIds) ? payload.testIds : undefined)
  }))

  addDisposable(ipc.onExtHostTaskProviderRegister?.(() => {
    userTasksService.markExtensionProviderRendererIpcConsumerConnected(true)
  }))

  addDisposable(ipc.onExtHostTaskProviderUnregister?.(() => {
    userTasksService.markExtensionProviderRendererIpcConsumerConnected(true)
    userTasksService.replaceExtensionProviderTasks([])
  }))

  addDisposable(ipc.onExtHostTaskProviderProvide?.((payload) => {
    userTasksService.markExtensionProviderRendererIpcConsumerConnected(true)
    userTasksService.replaceExtensionProviderTasks(Array.isArray(payload?.tasks) ? payload.tasks : [])
  }))

  addDisposable(ipc.onExtHostTaskProviderResolve?.(() => {
    userTasksService.markExtensionProviderRendererIpcConsumerConnected(true)
  }))

  addDisposable(ipc.onExtHostTaskProviderExecute?.(async (payload) => {
    userTasksService.markExtensionProviderRendererIpcConsumerConnected(true)
    const taskId = ensureExtensionProviderTaskProjected(payload?.task)
    await taskService.runTask(taskId, createExtensionHostTaskRunOptions())
  }))

  addDisposable(ipc.onExtHostTaskProviderExecuteBlocked?.(() => {
    userTasksService.markExtensionProviderRendererIpcConsumerConnected(true)
  }))

  addDisposable(ipc.onExtHostTaskProviderTerminateBlocked?.(() => {
    userTasksService.markExtensionProviderRendererIpcConsumerConnected(true)
  }))

  activeInstallation = {
    testingCallbacks,
    dispose() {
      for (const session of quickPicks.values()) {
        session.controller.dispose()
      }
      quickPicks.clear()
      progressHandles.forEach((entry) => entry.resolve())
      progressHandles.clear()
      while (disposables.length) {
        disposables.pop()?.()
      }
      testingService.setExtensionHostCallbacks(null)
      if (activeInstallation === this) activeInstallation = null
    },
  }
  return activeInstallation

  function getQuickPickSession(
    instance: number | string,
    options?: Record<string, unknown>,
    items?: ExtensionHostQuickPickRawItem[],
  ): QuickPickSession {
    let session = quickPicks.get(instance)
    if (!session) {
      session = {
        controller: quickInput.createQuickPick<number>(
          normalizeQuickPickItems(items),
          normalizeQuickPickOptions(options),
        ),
      }
      quickPicks.set(instance, session)
    } else {
      if (items) session.controller.setItems(normalizeQuickPickItems(items))
      applyQuickPickOptions(session.controller, options)
    }
    return session
  }

  function getOutputLabel(channelId: unknown): string | undefined {
    const id = String(channelId || "")
    if (!id) return undefined
    return outputChannels.get(id)
  }
}

function ensureExtensionProviderTaskProjected(task: ExtensionProviderTaskDto | undefined): string | undefined {
  if (!task) return undefined
  return userTasksService.upsertExtensionProviderTask(task).id
}

function createExtensionHostTaskRunOptions(): TaskRunServiceOptions {
  return {
    runCommand: runExtensionHostTaskCommand,
  }
}

async function runExtensionHostTaskCommand(
  config: RunConfig,
): Promise<TaskCommandResult> {
  const codek = typeof window !== "undefined"
    ? (window as unknown as { codek?: ExtensionHostRuntimeIpc }).codek
    : undefined
  const ptyResult = await runExtensionHostTaskCommandInTerminal(config, codek)
  if (ptyResult) return ptyResult
  const runCommand = codek?.runCommand
  if (typeof runCommand !== "function") {
    return {
      stdout: `Task ${config.name} routed from MainThreadTask.$executeTask to TaskWorkbenchAdapterService.runTask.\n`,
      exitCode: 0,
    }
  }
  const result = await runCommand(config.command, {
    cwd: config.workingDir && config.workingDir !== "${workspaceFolder}" ? config.workingDir : undefined,
    env: config.env,
  })
  return {
    stdout: result?.stdout || "",
    stderr: result?.stderr || result?.error || "",
    exitCode: typeof result?.exitCode === "number" ? result.exitCode : 0,
    timedOut: result?.timedOut === true,
    error: result?.error,
    terminalInstanceId: typeof result?.terminalInstanceId === "number" || result?.terminalInstanceId === null ? result.terminalInstanceId : undefined,
    terminalId: typeof result?.terminalId === "number" || result?.terminalId === null ? result.terminalId : undefined,
    processId: typeof result?.processId === "number" || result?.processId === null ? result.processId : undefined,
  }
}

async function runExtensionHostTaskCommandInTerminal(
  config: RunConfig,
  codek: ExtensionHostRuntimeIpc | undefined,
): Promise<TaskCommandResult | null> {
  const pty = codek?.pty
  if (typeof pty?.create !== "function" || typeof pty.write !== "function") return null
  const cwd = config.workingDir && config.workingDir !== "${workspaceFolder}" ? config.workingDir : ""
  const terminal = createTerminal("powershell", cwd)
  const result = await pty.create({
    shellType: terminal.shellType,
    cwd,
    cols: 80,
    rows: 24,
    env: config.env,
    confirmed: true,
  })
  if (!result?.ok || !result.id) {
    return {
      stdout: "",
      stderr: result?.error || "启动 provider task terminal 失败",
      error: result?.error,
      exitCode: -1,
      terminalInstanceId: terminal.instanceId,
      processId: result?.pid ?? null,
    }
  }
  attachPty(terminal.id, result.id, result.pid ?? null)
  const command = config.command.trim()
  if (command) {
    const completion = config.isBackground ? null : waitForPtyCommandCompletion(pty, result.id, terminal.id)
    await pty.write(result.id, `${buildPtyTaskCommand(command, terminal.shellType, config.isBackground === true)}\r`)
    if (completion) {
      const completed = await completion
      return {
        stdout: completed.stdout || `Task ${config.name} routed from MainThreadTask.$executeTask to terminalManager pty owner ${result.id}.\n`,
        stderr: completed.stderr,
        exitCode: completed.exitCode,
        terminalInstanceId: terminal.instanceId,
        processId: result.pid ?? null,
      }
    }
  }
  return {
    stdout: `Task ${config.name} routed from MainThreadTask.$executeTask to terminalManager pty owner ${result.id}.\n`,
    exitCode: 0,
    terminalInstanceId: terminal.instanceId,
    processId: result.pid ?? null,
  }
}

function waitForPtyCommandCompletion(
  pty: NonNullable<ExtensionHostRuntimeIpc["pty"]>,
  ptyId: string,
  terminalId: string,
  timeoutMs = 10000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    let settled = false
    let stdout = ""
    let stderr = ""
    let unsubscribeData: Disposable | undefined
    let unsubscribeExit: Disposable | undefined
    const finish = (exitCode: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribeData?.()
      unsubscribeExit?.()
      resolve({ stdout, stderr, exitCode })
    }
    const timer = setTimeout(() => {
      stderr = stderr || "provider task pty execution timed out"
      finish(-1)
    }, timeoutMs)
    unsubscribeData = pty.onData?.((payload) => {
      if (payload.id !== ptyId) return
      stdout += payload.data || ""
    })
    unsubscribeExit = pty.onExit?.((payload) => {
      if (payload.id !== ptyId) return
      const exitCode = payload.exitCode ?? payload.code ?? 0
      markExited(terminalId, exitCode)
      finish(exitCode)
    })
    if (!unsubscribeExit) finish(0)
  })
}

function buildPtyTaskCommand(command: string, shellType: ShellType, isBackground: boolean): string {
  if (isBackground) return command
  if (shellType === "powershell") return `${command}; exit $LASTEXITCODE`
  if (shellType === "cmd") return `${command} & exit /b %ERRORLEVEL%`
  return `${command}; exit $?`
}

function getDefaultRuntimeIpc(): ExtensionHostRuntimeIpc | null {
  if (typeof window === "undefined") return null
  return (window as unknown as { codek?: ExtensionHostRuntimeIpc }).codek ?? null
}

function createNoopTestingCallbacks(): ExtensionHostTestingCallbacks {
  return {
    cancelRun() {},
    configureProfile() {},
    async getCoverageDetails() {
      return []
    },
    async provideTestFollowups() {
      return []
    },
    async executeTestFollowup() {},
    disposeTestFollowups() {},
    async syncTests() {
      return false
    },
    async refreshTests() {
      return false
    },
    async expandTest() {
      return false
    },
    async getCodeRelatedToTest() {
      return []
    },
    async getTestsRelatedToCode() {
      return []
    },
    publishTestResults() {},
  }
}

function normalizeNotificationSeverity(value: unknown): WorkbenchNotificationSeverity {
  const severity = String(value || "info").toLowerCase()
  if (severity === "warn") return "warning"
  if (severity === "warning" || severity === "error" || severity === "success") return severity
  return "info"
}

function normalizeOutputUpdateMode(value: unknown): OutputChannelUpdateMode {
  if (value === 2 || value === "replace") return "replace"
  if (value === 3 || value === "clear") return "clear"
  return "append"
}

function normalizeProgressHandle(value: unknown): number | string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value) return value
  return undefined
}

function normalizeProgressLocation(value: unknown): ProgressLocation | string {
  if (value === ProgressLocation.Notification || value === "notification") return ProgressLocation.Notification
  if (value === ProgressLocation.Dialog || value === "dialog") return ProgressLocation.Dialog
  if (value === ProgressLocation.Explorer || value === "explorer") return ProgressLocation.Explorer
  if (value === ProgressLocation.Scm || value === "scm") return ProgressLocation.Scm
  if (value === ProgressLocation.Extensions || value === "extensions") return ProgressLocation.Extensions
  if (typeof value === "string" && value) return value
  return ProgressLocation.Window
}

function normalizeProgressStep(value: ExtensionHostProgressReportPayload["message"]): {
  message?: string
  increment?: number
  total?: number
} {
  if (typeof value === "string") return { message: value }
  return {
    message: stringOrUndefined(value?.message),
    increment: numberOrUndefined(value?.increment ?? value?.worked),
    total: numberOrUndefined(value?.total),
  }
}

function normalizeProgressButtons(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((button) => String(button || "").trim())
    .filter(Boolean)
}

function normalizeProgressSecondaryActions(value: unknown): {
  id: string
  label: string
  command?: string
  args?: readonly unknown[]
  keepOpen: boolean
}[] {
  if (!Array.isArray(value)) return []
  return value
    .map((action) => {
      const command = normalizeProgressActionCommand(action?.command)
      return {
        id: command || String(action?.id || "").trim(),
        label: String(action?.label || action?.id || command || "").trim(),
        command,
        args: Array.isArray(action?.args) ? [...action.args] : undefined,
        keepOpen: action?.keepOpen !== false,
      }
    })
    .filter((action) => action.id && action.label)
}

function normalizeProgressActionCommand(command: unknown): string | undefined {
  const id = String(command || "").trim()
  if (!id) return undefined
  if (id === "_extensions.manage") return "workbench.extensions.manage"
  return id
}

function normalizeDebugConsoleEntry(payload: ExtensionHostDebugConsoleAppendPayload | undefined): ConsoleEntry | null {
  const text = String(payload?.entry?.text ?? "")
  if (!text) return null
  return {
    id: String(payload?.entry?.id || `ext-debug-console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    type: normalizeDebugConsoleEntryType(payload?.entry?.type),
    text,
    timestamp: numberOrUndefined(payload?.entry?.createdAt) ?? Date.now(),
  }
}

function normalizeDebugConsoleEntryType(value: unknown): ConsoleEntry["type"] {
  const type = String(value || "").toLowerCase()
  if (type === "error" || type === "stderr") return "error"
  if (type === "input") return "input"
  if (type === "system") return "system"
  return "output"
}

function normalizeMessageCommands(commands: unknown): ExtensionHostMessageCommand[] {
  if (!Array.isArray(commands)) return []
  return commands
    .map((command) => ({
      title: String(command?.title || ""),
      handle: Number(command?.handle),
      isCloseAffordance: command?.isCloseAffordance === true,
    }))
    .filter((command) => command.title && Number.isFinite(command.handle))
}

function normalizeQuickPickOptions(input: Record<string, unknown> | undefined): QuickPickOptions {
  if (!input) return {}
  return {
    title: stringOrUndefined(input.title),
    placeHolder: stringOrUndefined(input.placeHolder) || stringOrUndefined(input.placeholder),
    value: stringOrUndefined(input.value),
    canPickMany: input.canPickMany === true,
    matchOnDescription: input.matchOnDescription === true,
    matchOnDetail: input.matchOnDetail === true,
    ignoreFocusOut: input.ignoreFocusOut === true,
    step: numberOrUndefined(input.step),
    totalSteps: numberOrUndefined(input.totalSteps),
    busy: input.busy === true,
    enabled: input.enabled === undefined ? undefined : input.enabled !== false,
  }
}

function applyQuickPickOptions(controller: QuickPickController<number>, input: Record<string, unknown> | undefined): void {
  if (!input) return
  if ("value" in input) controller.setValue(String(input.value ?? ""))
  if ("busy" in input) controller.setBusy(input.busy === true)
  if ("enabled" in input) controller.setEnabled(input.enabled !== false)
  const validationMessage = stringOrUndefined(input.validationMessage)
  if (validationMessage) controller.setValidationMessage(validationMessage, normalizeQuickInputSeverity(input.severity))
}

function normalizeInputOptions(input: Record<string, unknown> | undefined): InputBoxOptions {
  if (!input) return {}
  return {
    title: stringOrUndefined(input.title),
    prompt: stringOrUndefined(input.prompt),
    placeHolder: stringOrUndefined(input.placeHolder) || stringOrUndefined(input.placeholder),
    value: stringOrUndefined(input.value),
    password: input.password === true,
    ignoreFocusOut: input.ignoreFocusOut === true,
    step: numberOrUndefined(input.step),
    totalSteps: numberOrUndefined(input.totalSteps),
    enabled: input.enabled === undefined ? undefined : input.enabled !== false,
  }
}

function normalizeQuickPickItems(items: unknown): QuickPickEntry<number>[] {
  if (!Array.isArray(items)) return []
  return items.map((item, index) => normalizeQuickPickItem(item, index))
}

function normalizeQuickPickItem(item: ExtensionHostQuickPickRawItem, index: number): QuickPickEntry<number> {
  const label = String(item?.label || "")
  if (item?.type === "separator" || item?.kind === -1) {
    return {
      type: "separator",
      label,
      description: stringOrUndefined(item.description),
    }
  }
  const handle = Number(item?.handle ?? index)
  return {
    id: Number.isFinite(handle) ? String(handle) : String(index),
    type: "item",
    label,
    description: stringOrUndefined(item?.description),
    detail: stringOrUndefined(item?.detail),
    picked: item?.picked === true,
    disabled: item?.disabled === true,
    value: Number.isFinite(handle) ? handle : index,
  }
}

function toQuickPickHandleResult(
  selected: QuickPickItem<number> | QuickPickItem<number>[] | undefined,
): number | number[] | undefined {
  if (!selected) return undefined
  if (Array.isArray(selected)) {
    return selected
      .map((item) => item.value)
      .filter((handle): handle is number => Number.isFinite(handle))
  }
  return Number.isFinite(selected.value) ? selected.value : undefined
}

function normalizeQuickInputSeverity(value: unknown): "ignore" | "info" | "warning" | "error" {
  const severity = String(value || "").toLowerCase()
  if (severity === "error" || value === 3) return "error"
  if (severity === "warning" || value === 2) return "warning"
  if (severity === "info" || value === 1) return "info"
  return "ignore"
}

function stringOrUndefined(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return String(value)
}

function numberOrUndefined(value: unknown): number | undefined {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function normalizeTestingProfile(value: ExtensionHostTestingProfilePayload | undefined): TestRunProfileSnapshot | undefined {
  const controllerId = String(value?.controllerId || "")
  const profileId = Number(value?.profileId)
  if (!controllerId || !Number.isFinite(profileId)) return undefined
  return {
    controllerId,
    profileId,
    label: String(value?.label || "Run"),
    group: normalizeTestingGroup(value?.group),
    isDefault: value?.isDefault === true,
    tag: value?.tag,
    configureCommandId: value?.configureCommandId,
  }
}

function normalizeTestingRunStart(value: ExtensionHostTestingRunStartPayload | undefined): TestRunRequestSnapshot | undefined {
  const id = String(value?.id || "")
  const controllerId = String(value?.controllerId || "")
  if (!id || !controllerId) return undefined
  return {
    id,
    controllerId,
    profileId: numberOrUndefined(value?.profileId),
    group: normalizeTestingGroup(value?.group),
    testIds: Array.isArray(value?.testIds) ? value.testIds : [],
    excludeIds: Array.isArray(value?.excludeIds) ? value.excludeIds : undefined,
    label: value?.label,
    continuous: value?.continuous === true,
  }
}

function normalizeTestingRunTask(value: ExtensionHostTestingRunTaskStartPayload["task"] | undefined): Omit<TestRunTaskSnapshot, "startedAt" | "completedAt"> | undefined {
  const id = String(value?.id || "")
  if (!id) return undefined
  return {
    id,
    controllerId: String(value?.controllerId || ""),
    name: String(value?.name || id),
    running: value?.running !== false,
  }
}

function normalizeTestingGroup(value: unknown): TestRunProfileGroup {
  if (value === "debug") return "debug"
  if (value === "coverage") return "coverage"
  return "run"
}

function normalizeTestingState(value: unknown): TestResultState | undefined {
  if (value === "queued" || value === "running" || value === "passed" || value === "failed" || value === "skipped" || value === "errored") {
    return value
  }
  return undefined
}
