import { beforeEach, describe, expect, it, vi } from "vitest"
import { createRequire } from "node:module"
import {
  acceptInputBox,
  acceptQuickPickMany,
  clearQuickPicks,
  quickInputService,
  quickInputState,
  type QuickPickItem,
} from "../workbench/quickInput"
import { WorkbenchNotificationProgressService } from "../workbench/statusNotificationProgressService"
import { createOutputLogTelemetryService } from "../workbench/outputLogTelemetryService"
import { clearCommands, registerCommand } from "../workbench/commandRegistry"
import { debugState } from "../components/debugState"
import {
  installExtensionHostRuntimeBridge,
  type ExtensionHostDebugConsoleAppendPayload,
  type ExtensionHostInputPayload,
  type ExtensionHostMessagePayload,
  type ExtensionHostOutputChannelPayload,
  type ExtensionHostOutputContentPayload,
  type ExtensionHostOutputRegisterPayload,
  type ExtensionHostOutputUpdatePayload,
  type ExtensionHostProgressEndPayload,
  type ExtensionHostProgressReportPayload,
  type ExtensionHostProgressStartPayload,
  type ExtensionHostQuickPickItemsPayload,
  type ExtensionHostQuickPickPayload,
  type ExtensionHostRuntimeIpc,
  type ExtensionHostTaskProviderEvidencePayload,
  type ExtensionHostTaskProviderProvidePayload,
} from "./extensionHostRuntimeBridge"
import { TestingService } from "../testing/testingService"
import { userTasksService } from "../workbench/userTasks"

const require = createRequire(import.meta.url)
const mainThreadOutputService = require("../../../../desktop/services/extensions-host/mainThread/mainThreadOutputService.js")
const mainThreadDebugService = require("../../../../desktop/services/extensions-host/mainThread/mainThreadDebugService.js")
const mainThreadProgress = require("../../../../desktop/services/extensions-host/mainThread/mainThreadProgress.js")
const mainThreadTask = require("../../../../desktop/services/extensions-host/mainThread/mainThreadTask.js")
const mainThreadTesting = require("../../../../desktop/services/extensions-host/mainThread/mainThreadTesting.js")

type Listener<T> = (payload: T) => void | Promise<void>

function createMainThreadTestingServer() {
  const handlers = new Map<string, (args?: unknown[]) => unknown>()
  const calls: Array<{ nid: number; method: string; args: unknown[]; timeoutMs?: number; options?: unknown }> = []
  return {
    calls,
    handlers,
    onRpc(actorIdOrMethod: number | string, methodOrHandler: string | ((args?: unknown[]) => unknown), maybeHandler?: (args?: unknown[]) => unknown) {
      const method = typeof actorIdOrMethod === "number" ? String(methodOrHandler) : actorIdOrMethod
      const handler = typeof actorIdOrMethod === "number" ? maybeHandler : methodOrHandler
      handlers.set(method, handler as (args?: unknown[]) => unknown)
    },
    callRpc(method: string, args?: unknown[]) {
      const handler = handlers.get(method)
      if (!handler) throw new Error(`missing handler ${method}`)
      return handler(args || [])
    },
    call(nid: number, method: string, args: unknown[], timeoutMs?: number, options?: unknown) {
      calls.push({ nid, method, args, timeoutMs, options })
      return Promise.resolve(undefined)
    },
  }
}

function createActorServer(mainThreadNid: number, handlersByMethod = false) {
  const handlers = new Map<string, (args?: unknown[]) => unknown>()
  const calls: Array<{ nid: number; method: string; args: unknown[]; timeoutMs?: number; options?: unknown }> = []
  return {
    calls,
    handlers,
    onRpc(actorIdOrMethod: number | string, methodOrHandler: string | ((args?: unknown[]) => unknown), maybeHandler?: (args?: unknown[]) => unknown) {
      const key = typeof actorIdOrMethod === "number"
        ? `${actorIdOrMethod}:${methodOrHandler}`
        : String(actorIdOrMethod)
      const handler = typeof actorIdOrMethod === "number" ? maybeHandler : methodOrHandler
      handlers.set(key, handler as (args?: unknown[]) => unknown)
      if (handlersByMethod && typeof actorIdOrMethod !== "number") {
        handlers.set(String(actorIdOrMethod), handler as (args?: unknown[]) => unknown)
      }
    },
    callRpc(method: string, args?: unknown[]) {
      const handler = handlers.get(`${mainThreadNid}:${method}`) || handlers.get(method)
      if (!handler) throw new Error(`missing handler ${method}`)
      return handler(args || [])
    },
    call(nid: number, method: string, args: unknown[], timeoutMs?: number, options?: unknown) {
      calls.push({ nid, method, args, timeoutMs, options })
      if (method === "$provideTasks") {
        return Promise.resolve({
          tasks: [{
            _id: "npm:bridge",
            name: "npm: bridge",
            source: "npm",
            definition: { type: "npm", script: "bridge" },
            execution: { process: "npm", args: ["run", "bridge"] },
          }],
          extension: { identifier: { value: "vscode.npm" } },
        })
      }
      if (method === "$resolveTask") {
        return Promise.resolve({
          _id: "npm:bridge:resolved",
          name: "npm: bridge",
          source: "npm",
          definition: { type: "npm", script: "bridge" },
          execution: { process: "npm", args: ["run", "bridge"] },
        })
      }
      return Promise.resolve(undefined)
    },
  }
}

function createRuntimeIpc() {
  const listeners = {
    message: [] as Listener<ExtensionHostMessagePayload>[],
    quickPickShow: [] as Listener<ExtensionHostQuickPickPayload>[],
    quickPickItems: [] as Listener<ExtensionHostQuickPickItemsPayload>[],
    quickPickUpdate: [] as Listener<ExtensionHostQuickPickPayload>[],
    quickPickError: [] as Listener<{ instance: number | string; error?: string }>[],
    quickPickDispose: [] as Listener<{ instance: number | string }>[],
    inputShow: [] as Listener<ExtensionHostInputPayload>[],
    outputRegister: [] as Listener<ExtensionHostOutputRegisterPayload>[],
    outputContent: [] as Listener<ExtensionHostOutputContentPayload>[],
    outputUpdate: [] as Listener<ExtensionHostOutputUpdatePayload>[],
    outputReveal: [] as Listener<ExtensionHostOutputChannelPayload>[],
    outputClose: [] as Listener<ExtensionHostOutputChannelPayload>[],
    outputDispose: [] as Listener<ExtensionHostOutputChannelPayload>[],
    debugConsoleAppend: [] as Listener<ExtensionHostDebugConsoleAppendPayload>[],
    progressStart: [] as Listener<ExtensionHostProgressStartPayload>[],
    progressReport: [] as Listener<ExtensionHostProgressReportPayload>[],
    progressEnd: [] as Listener<ExtensionHostProgressEndPayload>[],
    testingController: [] as Listener<any>[],
    testingControllerRemove: [] as Listener<any>[],
    testingProfile: [] as Listener<any>[],
    testingProfileUpdate: [] as Listener<any>[],
    testingProfileRemove: [] as Listener<any>[],
    testingItem: [] as Listener<any>[],
    testingItemRemove: [] as Listener<any>[],
    testingRunStart: [] as Listener<any>[],
    testingRunTaskStart: [] as Listener<any>[],
    testingRunTaskFinish: [] as Listener<any>[],
    testingRunOutput: [] as Listener<any>[],
    testingRunState: [] as Listener<any>[],
    testingRunComplete: [] as Listener<any>[],
    testingCoverage: [] as Listener<any>[],
    testingRetire: [] as Listener<any>[],
    taskProviderRegister: [] as Listener<ExtensionHostTaskProviderEvidencePayload>[],
    taskProviderUnregister: [] as Listener<ExtensionHostTaskProviderEvidencePayload>[],
    taskProviderProvide: [] as Listener<ExtensionHostTaskProviderProvidePayload>[],
    taskProviderResolve: [] as Listener<ExtensionHostTaskProviderEvidencePayload>[],
    taskProviderExecute: [] as Listener<ExtensionHostTaskProviderEvidencePayload>[],
    taskProviderExecuteBlocked: [] as Listener<ExtensionHostTaskProviderEvidencePayload>[],
    taskProviderTerminateBlocked: [] as Listener<ExtensionHostTaskProviderEvidencePayload>[],
  }
  const remove = <T>(bucket: Listener<T>[], callback: Listener<T>) => () => {
    const index = bucket.indexOf(callback)
    if (index >= 0) bucket.splice(index, 1)
  }
  const ipc: ExtensionHostRuntimeIpc = {
    onExtHostMessage: (callback) => {
      listeners.message.push(callback)
      return remove(listeners.message, callback)
    },
    sendExtHostMessageResult: vi.fn(),
    onExtHostQuickPickShow: (callback) => {
      listeners.quickPickShow.push(callback)
      return remove(listeners.quickPickShow, callback)
    },
    onExtHostQuickPickItems: (callback) => {
      listeners.quickPickItems.push(callback)
      return remove(listeners.quickPickItems, callback)
    },
    onExtHostQuickPickUpdate: (callback) => {
      listeners.quickPickUpdate.push(callback)
      return remove(listeners.quickPickUpdate, callback)
    },
    onExtHostQuickPickError: (callback) => {
      listeners.quickPickError.push(callback)
      return remove(listeners.quickPickError, callback)
    },
    onExtHostQuickPickDispose: (callback) => {
      listeners.quickPickDispose.push(callback)
      return remove(listeners.quickPickDispose, callback)
    },
    sendExtHostQuickPickResult: vi.fn(),
    onExtHostInputShow: (callback) => {
      listeners.inputShow.push(callback)
      return remove(listeners.inputShow, callback)
    },
    sendExtHostInputResult: vi.fn(),
    sendExtHostProgressCancel: vi.fn(),
    sendExtHostTestingCancel: vi.fn(),
    sendExtHostTestingConfigureProfile: vi.fn(),
    getExtHostTestingCoverageDetails: vi.fn(async () => [{ type: "statement", executed: 1, count: 1 }]),
    provideExtHostTestingFollowups: vi.fn(async () => [{ id: 9, title: "Explain failure" }]),
    executeExtHostTestingFollowup: vi.fn(async () => {}),
    disposeExtHostTestingFollowups: vi.fn(),
    syncExtHostTesting: vi.fn(async () => true),
    refreshExtHostTesting: vi.fn(async () => true),
    expandExtHostTesting: vi.fn(async () => true),
    getExtHostTestingCodeRelatedToTest: vi.fn(async () => [{ uri: "file:///workspace/src/test.ts" }]),
    getExtHostTestingTestsRelatedToCode: vi.fn(async () => ["vitest\u0000suite"]),
    publishExtHostTestingResults: vi.fn(),
    onExtHostOutputRegister: (callback) => {
      listeners.outputRegister.push(callback)
      return remove(listeners.outputRegister, callback)
    },
    onExtHostOutputContent: (callback) => {
      listeners.outputContent.push(callback)
      return remove(listeners.outputContent, callback)
    },
    onExtHostOutputUpdate: (callback) => {
      listeners.outputUpdate.push(callback)
      return remove(listeners.outputUpdate, callback)
    },
    onExtHostOutputReveal: (callback) => {
      listeners.outputReveal.push(callback)
      return remove(listeners.outputReveal, callback)
    },
    onExtHostOutputClose: (callback) => {
      listeners.outputClose.push(callback)
      return remove(listeners.outputClose, callback)
    },
    onExtHostOutputDispose: (callback) => {
      listeners.outputDispose.push(callback)
      return remove(listeners.outputDispose, callback)
    },
    onExtHostDebugConsoleAppend: (callback) => {
      listeners.debugConsoleAppend.push(callback)
      return remove(listeners.debugConsoleAppend, callback)
    },
    onExtHostProgressStart: (callback) => {
      listeners.progressStart.push(callback)
      return remove(listeners.progressStart, callback)
    },
    onExtHostProgressReport: (callback) => {
      listeners.progressReport.push(callback)
      return remove(listeners.progressReport, callback)
    },
    onExtHostProgressEnd: (callback) => {
      listeners.progressEnd.push(callback)
      return remove(listeners.progressEnd, callback)
    },
    onExtHostTestingController: (callback) => {
      listeners.testingController.push(callback)
      return remove(listeners.testingController, callback)
    },
    onExtHostTestingControllerRemove: (callback) => {
      listeners.testingControllerRemove.push(callback)
      return remove(listeners.testingControllerRemove, callback)
    },
    onExtHostTestingProfile: (callback) => {
      listeners.testingProfile.push(callback)
      return remove(listeners.testingProfile, callback)
    },
    onExtHostTestingProfileUpdate: (callback) => {
      listeners.testingProfileUpdate.push(callback)
      return remove(listeners.testingProfileUpdate, callback)
    },
    onExtHostTestingProfileRemove: (callback) => {
      listeners.testingProfileRemove.push(callback)
      return remove(listeners.testingProfileRemove, callback)
    },
    onExtHostTestingItem: (callback) => {
      listeners.testingItem.push(callback)
      return remove(listeners.testingItem, callback)
    },
    onExtHostTestingItemRemove: (callback) => {
      listeners.testingItemRemove.push(callback)
      return remove(listeners.testingItemRemove, callback)
    },
    onExtHostTestingRunStart: (callback) => {
      listeners.testingRunStart.push(callback)
      return remove(listeners.testingRunStart, callback)
    },
    onExtHostTestingRunTaskStart: (callback) => {
      listeners.testingRunTaskStart.push(callback)
      return remove(listeners.testingRunTaskStart, callback)
    },
    onExtHostTestingRunTaskFinish: (callback) => {
      listeners.testingRunTaskFinish.push(callback)
      return remove(listeners.testingRunTaskFinish, callback)
    },
    onExtHostTestingRunOutput: (callback) => {
      listeners.testingRunOutput.push(callback)
      return remove(listeners.testingRunOutput, callback)
    },
    onExtHostTestingRunState: (callback) => {
      listeners.testingRunState.push(callback)
      return remove(listeners.testingRunState, callback)
    },
    onExtHostTestingRunComplete: (callback) => {
      listeners.testingRunComplete.push(callback)
      return remove(listeners.testingRunComplete, callback)
    },
    onExtHostTestingCoverage: (callback) => {
      listeners.testingCoverage.push(callback)
      return remove(listeners.testingCoverage, callback)
    },
    onExtHostTestingRetire: (callback) => {
      listeners.testingRetire.push(callback)
      return remove(listeners.testingRetire, callback)
    },
    onExtHostTaskProviderRegister: (callback) => {
      listeners.taskProviderRegister.push(callback)
      return remove(listeners.taskProviderRegister, callback)
    },
    onExtHostTaskProviderUnregister: (callback) => {
      listeners.taskProviderUnregister.push(callback)
      return remove(listeners.taskProviderUnregister, callback)
    },
    onExtHostTaskProviderProvide: (callback) => {
      listeners.taskProviderProvide.push(callback)
      return remove(listeners.taskProviderProvide, callback)
    },
    onExtHostTaskProviderResolve: (callback) => {
      listeners.taskProviderResolve.push(callback)
      return remove(listeners.taskProviderResolve, callback)
    },
    onExtHostTaskProviderExecute: (callback) => {
      listeners.taskProviderExecute.push(callback)
      return remove(listeners.taskProviderExecute, callback)
    },
    onExtHostTaskProviderExecuteBlocked: (callback) => {
      listeners.taskProviderExecuteBlocked.push(callback)
      return remove(listeners.taskProviderExecuteBlocked, callback)
    },
    onExtHostTaskProviderTerminateBlocked: (callback) => {
      listeners.taskProviderTerminateBlocked.push(callback)
      return remove(listeners.taskProviderTerminateBlocked, callback)
    },
  }
  const emit = async <T>(bucket: Listener<T>[], payload: T) => {
    await Promise.all(bucket.map((listener) => listener(payload)))
  }
  return {
    ipc,
    listeners,
    emitMessage: (payload: ExtensionHostMessagePayload) => emit(listeners.message, payload),
    emitQuickPickShow: (payload: ExtensionHostQuickPickPayload) => emit(listeners.quickPickShow, payload),
    emitQuickPickItems: (payload: ExtensionHostQuickPickItemsPayload) => emit(listeners.quickPickItems, payload),
    emitInputShow: (payload: ExtensionHostInputPayload) => emit(listeners.inputShow, payload),
    emitOutputRegister: (payload: ExtensionHostOutputRegisterPayload) => emit(listeners.outputRegister, payload),
    emitOutputContent: (payload: ExtensionHostOutputContentPayload) => emit(listeners.outputContent, payload),
    emitOutputUpdate: (payload: ExtensionHostOutputUpdatePayload) => emit(listeners.outputUpdate, payload),
    emitOutputReveal: (payload: ExtensionHostOutputChannelPayload) => emit(listeners.outputReveal, payload),
    emitOutputClose: (payload: ExtensionHostOutputChannelPayload) => emit(listeners.outputClose, payload),
    emitOutputDispose: (payload: ExtensionHostOutputChannelPayload) => emit(listeners.outputDispose, payload),
    emitDebugConsoleAppend: (payload: ExtensionHostDebugConsoleAppendPayload) => emit(listeners.debugConsoleAppend, payload),
    emitProgressStart: (payload: ExtensionHostProgressStartPayload) => emit(listeners.progressStart, payload),
    emitProgressReport: (payload: ExtensionHostProgressReportPayload) => emit(listeners.progressReport, payload),
    emitProgressEnd: (payload: ExtensionHostProgressEndPayload) => emit(listeners.progressEnd, payload),
    emitTestingController: (payload: any) => emit(listeners.testingController, payload),
    emitTestingControllerRemove: (payload: any) => emit(listeners.testingControllerRemove, payload),
    emitTestingProfile: (payload: any) => emit(listeners.testingProfile, payload),
    emitTestingProfileUpdate: (payload: any) => emit(listeners.testingProfileUpdate, payload),
    emitTestingProfileRemove: (payload: any) => emit(listeners.testingProfileRemove, payload),
    emitTestingItem: (payload: any) => emit(listeners.testingItem, payload),
    emitTestingItemRemove: (payload: any) => emit(listeners.testingItemRemove, payload),
    emitTestingRunStart: (payload: any) => emit(listeners.testingRunStart, payload),
    emitTestingRunTaskStart: (payload: any) => emit(listeners.testingRunTaskStart, payload),
    emitTestingRunTaskFinish: (payload: any) => emit(listeners.testingRunTaskFinish, payload),
    emitTestingRunOutput: (payload: any) => emit(listeners.testingRunOutput, payload),
    emitTestingRunState: (payload: any) => emit(listeners.testingRunState, payload),
    emitTestingRunComplete: (payload: any) => emit(listeners.testingRunComplete, payload),
    emitTestingCoverage: (payload: any) => emit(listeners.testingCoverage, payload),
    emitTestingRetire: (payload: any) => emit(listeners.testingRetire, payload),
    emitTaskProviderRegister: (payload: ExtensionHostTaskProviderEvidencePayload) => emit(listeners.taskProviderRegister, payload),
    emitTaskProviderUnregister: (payload: ExtensionHostTaskProviderEvidencePayload) => emit(listeners.taskProviderUnregister, payload),
    emitTaskProviderProvide: (payload: ExtensionHostTaskProviderProvidePayload) => emit(listeners.taskProviderProvide, payload),
    emitTaskProviderResolve: (payload: ExtensionHostTaskProviderEvidencePayload) => emit(listeners.taskProviderResolve, payload),
    emitTaskProviderExecute: (payload: ExtensionHostTaskProviderEvidencePayload) => emit(listeners.taskProviderExecute, payload),
    emitTaskProviderExecuteBlocked: (payload: ExtensionHostTaskProviderEvidencePayload) => emit(listeners.taskProviderExecuteBlocked, payload),
    emitTaskProviderTerminateBlocked: (payload: ExtensionHostTaskProviderEvidencePayload) => emit(listeners.taskProviderTerminateBlocked, payload),
  }
}

function connectMainThreadTestingToRuntime(runtime: ReturnType<typeof createRuntimeIpc>) {
  const pending: Promise<void>[] = []
  const dispatch = (runner: () => Promise<void>) => {
    pending.push(runner())
  }
  return {
    sendToRenderer(channel: string, payload: unknown) {
      switch (channel) {
        case "ext-host:testing-controller":
          dispatch(() => runtime.emitTestingController(payload))
          break
        case "ext-host:testing-controller-remove":
          dispatch(() => runtime.emitTestingControllerRemove(payload))
          break
        case "ext-host:testing-profile":
          dispatch(() => runtime.emitTestingProfile(payload))
          break
        case "ext-host:testing-profile-update":
          dispatch(() => runtime.emitTestingProfileUpdate(payload))
          break
        case "ext-host:testing-profile-remove":
          dispatch(() => runtime.emitTestingProfileRemove(payload))
          break
        case "ext-host:testing-item":
          dispatch(() => runtime.emitTestingItem(payload))
          break
        case "ext-host:testing-item-remove":
          dispatch(() => runtime.emitTestingItemRemove(payload))
          break
        case "ext-host:testing-run-start":
          dispatch(() => runtime.emitTestingRunStart(payload))
          break
        case "ext-host:testing-run-task-start":
          dispatch(() => runtime.emitTestingRunTaskStart(payload))
          break
        case "ext-host:testing-run-task-finish":
          dispatch(() => runtime.emitTestingRunTaskFinish(payload))
          break
        case "ext-host:testing-run-output":
          dispatch(() => runtime.emitTestingRunOutput(payload))
          break
        case "ext-host:testing-run-state":
          dispatch(() => runtime.emitTestingRunState(payload))
          break
        case "ext-host:testing-run-complete":
          dispatch(() => runtime.emitTestingRunComplete(payload))
          break
        case "ext-host:testing-coverage":
          dispatch(() => runtime.emitTestingCoverage(payload))
          break
        case "ext-host:testing-retire":
          dispatch(() => runtime.emitTestingRetire(payload))
          break
        default:
          throw new Error(`unhandled MainThreadTesting renderer channel ${channel}`)
      }
    },
    async flush() {
      await Promise.all(pending.splice(0))
    },
  }
}

function connectMainThreadAdapterToRuntime(runtime: ReturnType<typeof createRuntimeIpc>) {
  const pending: Promise<void>[] = []
  const dispatch = (runner: () => Promise<void>) => {
    pending.push(runner())
  }
  return {
    sendToRenderer(channel: string, payload: unknown) {
      switch (channel) {
        case "ext-host:output-register":
          dispatch(() => runtime.emitOutputRegister(payload as ExtensionHostOutputRegisterPayload))
          break
        case "ext-host:output-content":
          dispatch(() => runtime.emitOutputContent(payload as ExtensionHostOutputContentPayload))
          break
        case "ext-host:output-update":
          dispatch(() => runtime.emitOutputUpdate(payload as ExtensionHostOutputUpdatePayload))
          break
        case "ext-host:output-reveal":
          dispatch(() => runtime.emitOutputReveal(payload as ExtensionHostOutputChannelPayload))
          break
        case "ext-host:output-close":
          dispatch(() => runtime.emitOutputClose(payload as ExtensionHostOutputChannelPayload))
          break
        case "ext-host:output-dispose":
          dispatch(() => runtime.emitOutputDispose(payload as ExtensionHostOutputChannelPayload))
          break
        case "ext-host:debug-console-append":
          dispatch(() => runtime.emitDebugConsoleAppend(payload as ExtensionHostDebugConsoleAppendPayload))
          break
        case "ext-host:progress-start":
          dispatch(() => runtime.emitProgressStart(payload as ExtensionHostProgressStartPayload))
          break
        case "ext-host:progress-report":
          dispatch(() => runtime.emitProgressReport(payload as ExtensionHostProgressReportPayload))
          break
        case "ext-host:progress-end":
          dispatch(() => runtime.emitProgressEnd(payload as ExtensionHostProgressEndPayload))
          break
        case "ext-host:task-provider-register":
          dispatch(() => runtime.emitTaskProviderRegister(payload as ExtensionHostTaskProviderEvidencePayload))
          break
        case "ext-host:task-provider-unregister":
          dispatch(() => runtime.emitTaskProviderUnregister(payload as ExtensionHostTaskProviderEvidencePayload))
          break
        case "ext-host:task-provider-provide":
          dispatch(() => runtime.emitTaskProviderProvide(payload as ExtensionHostTaskProviderProvidePayload))
          break
        case "ext-host:task-provider-resolve":
          dispatch(() => runtime.emitTaskProviderResolve(payload as ExtensionHostTaskProviderEvidencePayload))
          break
        case "ext-host:task-provider-execute":
          dispatch(() => runtime.emitTaskProviderExecute(payload as ExtensionHostTaskProviderEvidencePayload))
          break
        case "ext-host:task-provider-execute-blocked":
          dispatch(() => runtime.emitTaskProviderExecuteBlocked(payload as ExtensionHostTaskProviderEvidencePayload))
          break
        case "ext-host:task-provider-terminate-blocked":
          dispatch(() => runtime.emitTaskProviderTerminateBlocked(payload as ExtensionHostTaskProviderEvidencePayload))
          break
        default:
          throw new Error(`unhandled MainThread adapter renderer channel ${channel}`)
      }
    },
    async flush() {
      await Promise.all(pending.splice(0))
    },
  }
}

describe("extension host runtime bridge", () => {
  beforeEach(() => {
    clearCommands()
    clearQuickPicks()
    debugState.consoleOutput.value = []
    userTasksService.reset()
  })

  it("projects window messages to workbench notifications and returns the selected command handle", async () => {
    const runtime = createRuntimeIpc()
    const notifications = new WorkbenchNotificationProgressService({
      playSound: () => {},
    })
    const bridge = installExtensionHostRuntimeBridge({
      ipc: runtime.ipc,
      notificationService: notifications,
      quickInput: quickInputService,
    })

    const messagePromise = runtime.emitMessage({
      requestId: "message-1",
      severity: "warning",
      message: "Pick an action",
      commands: [
        { title: "Run", handle: 42 },
        { title: "Cancel", handle: 7, isCloseAffordance: true },
      ],
    })

    expect(notifications.getNotifications()[0]).toMatchObject({
      severity: "warning",
      message: "Pick an action",
      source: "extensionHost",
    })
    expect(quickInputService.currentQuickInput?.type).toBe("quickPick")
    const request = quickInputState.queue[0]
    acceptQuickPickMany(request.id, [request.items[0] as QuickPickItem<number>])
    await messagePromise

    expect(runtime.ipc.sendExtHostMessageResult).toHaveBeenCalledWith({
      requestId: "message-1",
      handle: 42,
    })
    bridge.dispose()
  })

  it("bridges extension host quick pick show/items to the shared quick input service", async () => {
    const runtime = createRuntimeIpc()
    const bridge = installExtensionHostRuntimeBridge({
      ipc: runtime.ipc,
      quickInput: quickInputService,
    })

    const showPromise = runtime.emitQuickPickShow({
      instance: 11,
      options: { canPickMany: true, placeHolder: "Pick" },
      items: [],
    })
    expect(quickInputService.currentQuickInput?.type).toBe("quickPick")

    await runtime.emitQuickPickItems({
      instance: 11,
      items: [
        { handle: 1, label: "One" },
        { handle: 2, label: "Two" },
      ],
    })

    const request = quickInputState.queue[0]
    expect(request.options.placeHolder).toBe("Pick")
    expect(request.items.map((item) => item.label)).toEqual(["One", "Two"])
    acceptQuickPickMany(request.id, request.items as QuickPickItem<number>[])
    await showPromise

    expect(runtime.ipc.sendExtHostQuickPickResult).toHaveBeenCalledWith({
      instance: 11,
      result: [1, 2],
    })
    bridge.dispose()
  })

  it("bridges extension host input boxes to the shared quick input service", async () => {
    const runtime = createRuntimeIpc()
    const bridge = installExtensionHostRuntimeBridge({
      ipc: runtime.ipc,
      quickInput: quickInputService,
    })

    const inputPromise = runtime.emitInputShow({
      instanceId: "input-1",
      options: { prompt: "Name", value: "initial" },
    })

    expect(quickInputService.currentQuickInput?.type).toBe("inputBox")
    const request = quickInputState.inputQueue[0]
    expect(request.options.prompt).toBe("Name")
    await acceptInputBox(request.id, "typed value")
    await inputPromise

    expect(runtime.ipc.sendExtHostInputResult).toHaveBeenCalledWith({
      instanceId: "input-1",
      value: "typed value",
    })
    bridge.dispose()
  })

  it("projects extension host output channel lifecycle into the unified output service", async () => {
    const runtime = createRuntimeIpc()
    const outputService = createOutputLogTelemetryService({ now: () => 1000, idFactory: () => "output-action" })
    const bridge = installExtensionHostRuntimeBridge({
      ipc: runtime.ipc,
      outputService,
    })

    await runtime.emitOutputRegister({
      channelId: "extension-output-ms.test-#1-Test",
      label: "Test",
      languageId: "log",
    })
    await runtime.emitOutputContent({
      channelId: "extension-output-ms.test-#1-Test",
      content: "first\n",
      mode: 1,
    })
    await runtime.emitOutputUpdate({ channelId: "extension-output-ms.test-#1-Test", mode: 1 })
    await runtime.emitOutputReveal({ channelId: "extension-output-ms.test-#1-Test", preserveFocus: false })

    expect(outputService.getOutputSnapshot("Test")).toEqual(expect.objectContaining({
      serviceId: "outputService",
      stateSource: "outputLogTelemetryService",
      channelName: "Test",
      visibleChannelName: "Test",
      isVisible: true,
      updateMode: "append",
      preview: "first\n",
    }))
    expect(outputService.getChannelDescriptor("Test")).toEqual(expect.objectContaining({
      stateSource: "outputLogTelemetryService",
      user: true,
      source: "extensionHost",
      sources: expect.arrayContaining(["extensionHost", "extension-output-ms.test-#1-Test"]),
      lifecycle: "registered",
    }))

    await runtime.emitOutputUpdate({ channelId: "extension-output-ms.test-#1-Test", mode: 3 })
    expect(outputService.getOutputSnapshot("Test")).toEqual(expect.objectContaining({
      entryCount: 0,
      updateMode: "clear",
    }))

    await runtime.emitOutputClose({ channelId: "extension-output-ms.test-#1-Test" })
    expect(outputService.getOutputSnapshot("Test").isVisible).toBe(false)

    await runtime.emitOutputDispose({ channelId: "extension-output-ms.test-#1-Test" })
    expect(outputService.getChannelDescriptor("Test")).toEqual(expect.objectContaining({
      lifecycle: "disposed",
    }))
    bridge.dispose()
  })

  it("projects extension host backing file content into the unified output service", async () => {
    const runtime = createRuntimeIpc()
    const outputService = createOutputLogTelemetryService({ now: () => 1000, idFactory: () => "output-content" })
    const bridge = installExtensionHostRuntimeBridge({
      ipc: runtime.ipc,
      outputService,
    })

    await runtime.emitOutputRegister({
      channelId: "extension-output-ms.test-#2-Test",
      label: "Test",
      languageId: "log",
    })
    await runtime.emitOutputContent({ channelId: "extension-output-ms.test-#2-Test", content: "first\n", mode: 1 })
    await runtime.emitOutputContent({ channelId: "extension-output-ms.test-#2-Test", content: "second\n", mode: 1 })

    expect(outputService.getOutputSnapshot("Test")).toEqual(expect.objectContaining({
      entryCount: 2,
      preview: "first\nsecond\n",
      updateMode: "append",
    }))
    expect(outputService.getEntries("Test")).toEqual([
      expect.objectContaining({ source: "extensionHost", message: "first\n" }),
      expect.objectContaining({ source: "extensionHost", message: "second\n" }),
    ])

    await runtime.emitOutputContent({ channelId: "extension-output-ms.test-#2-Test", content: "replacement\n", mode: 2 })
    expect(outputService.getOutputSnapshot("Test")).toEqual(expect.objectContaining({
      entryCount: 1,
      preview: "replacement\n",
      updateMode: "replace",
    }))

    await runtime.emitOutputContent({ channelId: "extension-output-ms.test-#2-Test", content: "", mode: 3 })
    expect(outputService.getOutputSnapshot("Test")).toEqual(expect.objectContaining({
      entryCount: 0,
      preview: "",
      updateMode: "clear",
    }))
    bridge.dispose()
  })

  it("routes MainThreadOutputService adapter events into the unified output service", async () => {
    const runtime = createRuntimeIpc()
    const outputService = createOutputLogTelemetryService({ now: () => 1100, idFactory: () => "output-adapter" })
    const bridge = installExtensionHostRuntimeBridge({
      ipc: runtime.ipc,
      outputService,
    })
    const server = createActorServer(mainThreadOutputService.MAIN_THREAD_OUTPUT_SERVICE_NID)
    const renderer = connectMainThreadAdapterToRuntime(runtime)
    try {
      mainThreadOutputService.register(server, { sendToRenderer: renderer.sendToRenderer })
      const channelId = server.callRpc("$register", ["Adapter Output", undefined, "log", "ms.adapter"])
      await server.callRpc("$update", [channelId, 1])
      server.callRpc("$reveal", [channelId, false])
      await renderer.flush()

      expect(server.handlers.has(`${mainThreadOutputService.MAIN_THREAD_OUTPUT_SERVICE_NID}:$register`)).toBe(true)
      expect(outputService.getOutputSnapshot("Adapter Output")).toEqual(expect.objectContaining({
        updateMode: "append",
        isVisible: true,
      }))
      expect(outputService.getChannelDescriptor("Adapter Output")).toEqual(expect.objectContaining({
        lifecycle: "registered",
        sources: expect.arrayContaining(["extensionHost", channelId]),
      }))
    } finally {
      bridge.dispose()
    }
  })

  it("routes MainThreadDebugService console append events into the shared debug console model", async () => {
    const runtime = createRuntimeIpc()
    const renderer = connectMainThreadAdapterToRuntime(runtime)
    const server = createActorServer(mainThreadDebugService.MainContext?.MainThreadDebugService ?? 15)
    const bridge = installExtensionHostRuntimeBridge({
      ipc: runtime.ipc,
    })
    const snapshots: unknown[] = []
    try {
      mainThreadDebugService.register(server, {
        rootDir: "D:/Workspace",
        syncDebugState: (state: unknown) => snapshots.push(state),
        sendToRenderer: renderer.sendToRenderer,
        callEh: async () => ({ type: "server", host: "127.0.0.1", port: 4711 }),
        dapStart: () => ({ success: true, sessionId: "dap-debug-console-1" }),
      })
      server.callRpc("$registerDebugAdapterDescriptorFactory", ["pwa-node", 17])
      await server.callRpc("$startDebugging", [undefined, {
        type: "pwa-node",
        request: "launch",
        name: "Debug Console Bridge",
      }, {}])
      server.callRpc("$appendDebugConsole", ["extension console output\n"])
      await renderer.flush()

      expect(debugState.consoleOutput.value).toEqual([
        expect.objectContaining({
          type: "output",
          text: "extension console output\n",
        }),
      ])
      expect(snapshots.at(-1)).toEqual(expect.objectContaining({
        debugConsole: expect.objectContaining({
          stateSource: "mainThreadDebugService.sessions",
          entries: [expect.objectContaining({
            text: "extension console output\n",
            type: "extension",
            evidenceSafe: true,
            valueLength: "extension console output\n".length,
          })],
        }),
      }))
      const state = mainThreadDebugService.makeDebugState()
      expect(JSON.stringify(state.sessions[0].debugConsoleAppendEvidence)).not.toContain("extension console output")
    } finally {
      bridge.dispose()
    }
  })

  it("projects extension host progress lifecycle into the shared workbench progress service", async () => {
    const runtime = createRuntimeIpc()
    const progressService = new WorkbenchNotificationProgressService({
      playSound: () => {},
      createId: (prefix) => `${prefix}-1`,
      now: () => 2000,
    })
    const bridge = installExtensionHostRuntimeBridge({
      ipc: runtime.ipc,
      progressService,
    })

    await runtime.emitProgressStart({
      handle: 7,
      location: 10,
      title: "Extension task",
      source: "Tests",
      cancellable: true,
      extensionId: "ms.test",
    })
    await runtime.emitProgressReport({
      handle: 7,
      message: { message: "running", increment: 2, total: 4 },
    })

    expect(progressService.getProgressTasks()).toEqual([
      expect.objectContaining({
        location: 10,
        title: "Extension task",
        source: "Tests",
        message: "running",
        total: 4,
        worked: 2,
        status: "active",
        cancellable: true,
      }),
    ])
    expect(progressService.getStatusbarEntries()).toEqual([
      expect.objectContaining({
        id: "status.progress",
        text: "Extension task: running",
        showProgress: true,
      }),
    ])

    await runtime.emitProgressEnd({ handle: 7 })
    await Promise.resolve()
    expect(progressService.getProgressTasks()).toEqual([])
    expect(progressService.getStatusbarEntries()).toEqual([])
    bridge.dispose()
  })

  it("bridges notification progress button cancellation back to the extension host", async () => {
    const runtime = createRuntimeIpc()
    const progressService = new WorkbenchNotificationProgressService({
      playSound: () => {},
      createId: (prefix) => `${prefix}-2`,
      now: () => 3000,
    })
    const managedExtensions: unknown[][] = []
    registerCommand({
      id: "workbench.extensions.manage",
      title: "Manage Extension",
      handler: (...args) => {
        managedExtensions.push(args)
      },
    })
    const bridge = installExtensionHostRuntimeBridge({
      ipc: runtime.ipc,
      progressService,
    })

    await runtime.emitProgressStart({
      handle: 12,
      location: 15,
      title: "Extension auth",
      cancellable: true,
      cancellableLabel: "Stop",
      buttons: ["Use Browser"],
      secondaryActions: [{
        id: "ms.auth",
        label: "Manage Extension",
        command: "_extensions.manage",
        args: ["ms.auth"],
      }],
      extensionId: "ms.auth",
    })

    const notification = progressService.getNotificationQueue()[0]
    expect(notification.actions).toEqual({
      primary: [
        expect.objectContaining({ id: "progress.button.0", label: "Use Browser", isSecondary: false }),
        expect.objectContaining({ id: "progress.cancel", label: "Stop", isSecondary: false }),
      ],
      secondary: [
        expect.objectContaining({ id: "workbench.extensions.manage", label: "Manage Extension", isSecondary: true }),
      ],
    })

    await expect(progressService.invokeNotificationAction(notification.id, "workbench.extensions.manage")).resolves.toBe(true)
    expect(managedExtensions).toEqual([["ms.auth"]])
    expect(progressService.getNotificationQueue()).toHaveLength(1)
    expect(runtime.ipc.sendExtHostProgressCancel).not.toHaveBeenCalled()

    await expect(progressService.invokeNotificationAction(notification.id, "progress.button.0")).resolves.toBe(true)
    expect(runtime.ipc.sendExtHostProgressCancel).toHaveBeenCalledWith({ handle: 12, choice: 0 })

    await runtime.emitProgressEnd({ handle: 12 })
    await Promise.resolve()
    expect(progressService.getProgressTasks()).toEqual([])

    await runtime.emitProgressStart({
      handle: 13,
      location: 15,
      title: "Extension cancel",
      cancellable: true,
      extensionId: "ms.auth",
    })
    const cancelNotification = progressService.getNotificationQueue()[0]
    expect(cancelNotification.actions.primary).toEqual([
      expect.objectContaining({ id: "progress.cancel", label: "Cancel", isSecondary: false }),
    ])

    await expect(progressService.invokeNotificationAction(cancelNotification.id, "progress.cancel")).resolves.toBe(true)
    expect(runtime.ipc.sendExtHostProgressCancel).toHaveBeenCalledWith({ handle: 13, choice: undefined })

    await runtime.emitProgressEnd({ handle: 13 })
    await Promise.resolve()
    expect(progressService.getProgressTasks()).toEqual([])
    bridge.dispose()
  })

  it("routes MainThreadProgress adapter events into the shared progress service", async () => {
    const runtime = createRuntimeIpc()
    const progressService = new WorkbenchNotificationProgressService({
      playSound: () => {},
      createId: (prefix) => `${prefix}-adapter`,
      now: () => 4000,
    })
    const bridge = installExtensionHostRuntimeBridge({
      ipc: runtime.ipc,
      progressService,
    })
    const server = createActorServer(mainThreadProgress.MAIN_THREAD_PROGRESS_NID)
    const renderer = connectMainThreadAdapterToRuntime(runtime)
    try {
      mainThreadProgress.register(server, { sendToRenderer: renderer.sendToRenderer })
      server.callRpc("$startProgress", [99, { location: 15, title: "Adapter progress", cancellable: true }, "ms.adapter"])
      server.callRpc("$progressReport", [99, { message: "halfway", increment: 1, total: 2 }])
      await renderer.flush()

      expect(server.handlers.has(`${mainThreadProgress.MAIN_THREAD_PROGRESS_NID}:$startProgress`)).toBe(true)
      expect(progressService.getNotificationQueue()).toEqual([
        expect.objectContaining({
          message: "Adapter progress",
          source: "ms.adapter",
          progress: expect.objectContaining({
            worked: 1,
            total: 2,
          }),
        }),
      ])

      const notification = progressService.getNotificationQueue()[0]
      await expect(progressService.invokeNotificationAction(notification.id, "progress.cancel")).resolves.toBe(true)
      expect(runtime.ipc.sendExtHostProgressCancel).toHaveBeenCalledWith({ handle: 99, choice: undefined })

      server.callRpc("$progressEnd", [99])
      await renderer.flush()
      await Promise.resolve()
      expect(progressService.getProgressTasks()).toEqual([])
    } finally {
      bridge.dispose()
    }
  })

  it("projects extension host testing lifecycle into the unified testing service", async () => {
    const runtime = createRuntimeIpc()
    const testingService = new TestingService()
    const bridge = installExtensionHostRuntimeBridge({
      ipc: runtime.ipc,
      testingService,
    })

    await runtime.emitTestingController({ controllerId: "vitest", label: "Vitest" })
    await runtime.emitTestingProfile({ controllerId: "vitest", profileId: 1, label: "Run", group: "run", isDefault: true })
    await runtime.emitTestingItem({ controllerId: "vitest", id: "vitest", label: "Vitest", expand: "expanded" })
    await runtime.emitTestingItem({
      controllerId: "vitest",
      id: "vitest\u0000suite",
      parentId: "vitest",
      label: "suite",
      expand: "notExpandable",
    })
    await runtime.emitTestingRunStart({
      id: "run:1",
      controllerId: "vitest",
      profileId: 1,
      group: "run",
      testIds: ["vitest\u0000suite"],
      label: "Extension test run",
    })
    await runtime.emitTestingRunTaskStart({
      runId: "run:1",
      task: { id: "task:1", controllerId: "vitest", name: "Vitest task", running: true },
    })
    await runtime.emitTestingRunOutput({ runId: "run:1", testId: "vitest\u0000suite", message: "collected 1 test" })
    await runtime.emitTestingRunState({ runId: "run:1", testId: "vitest\u0000suite", state: "passed", durationMs: 10 })
    await runtime.emitTestingRunTaskFinish({ runId: "run:1", taskId: "task:1" })
    await runtime.emitTestingCoverage({
      files: [{
        id: "coverage:1",
        uri: "file:///workspace/src/test.ts",
        statement: { covered: 1, total: 1 },
        testIds: ["vitest\u0000suite"],
      }],
    })
    await runtime.emitTestingRetire({ testIds: ["vitest\u0000suite"] })
    await runtime.emitTestingRunComplete({ runId: "run:1" })

    expect(testingService.getProjection()).toEqual(expect.objectContaining({
      controllers: [{ id: "vitest", label: "Vitest" }],
      profiles: [expect.objectContaining({ controllerId: "vitest", profileId: 1 })],
      items: expect.arrayContaining([
        expect.objectContaining({ id: "vitest\u0000suite", depth: 1 }),
      ]),
      runs: [expect.objectContaining({
        id: "run:1",
        state: "passed",
        tasks: [expect.objectContaining({ id: "task:1", running: false })],
        output: [expect.objectContaining({ message: "collected 1 test" })],
      })],
      results: [expect.objectContaining({
        testId: "vitest\u0000suite",
        state: "passed",
        retired: true,
        durationMs: 10,
        messages: ["collected 1 test"],
      })],
      coverage: expect.objectContaining({ status: "available" }),
      resultPeek: expect.objectContaining({
        entries: [expect.objectContaining({
          testId: "vitest\u0000suite",
          retired: true,
        })],
      }),
      testingExplorerContract: expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({
            id: "vitest\u0000suite",
            retired: true,
          }),
        ]),
      }),
    }))
    expect(runtime.ipc.publishExtHostTestingResults).toHaveBeenCalledWith({
      results: [expect.objectContaining({
        id: "run:1",
        controllerId: "vitest",
        state: "passed",
        source: "TestingService.completeRun()",
        noSecondState: true,
        tests: [expect.objectContaining({
          testId: "vitest\u0000suite",
          state: "passed",
          retired: true,
        })],
      })],
    })

    await runtime.emitTestingItemRemove({ itemId: "vitest\u0000suite" })
    expect(testingService.getItems().map((item) => item.id)).toEqual(["vitest"])

    bridge.testingCallbacks.cancelRun({ runId: "run:1", taskId: "task:1" })
    bridge.testingCallbacks.configureProfile({ controllerId: "vitest", profileId: 1 })
    await expect(bridge.testingCallbacks.getCoverageDetails({
      coverageId: "coverage:1",
      testId: "vitest\u0000suite",
    })).resolves.toEqual([{ type: "statement", executed: 1, count: 1 }])
    await expect(bridge.testingCallbacks.provideTestFollowups({
      testId: "vitest\u0000suite",
      resultId: "run:1",
      taskId: "task:1",
      message: { message: "failed" },
    })).resolves.toEqual([{ id: 9, title: "Explain failure" }])
    await expect(bridge.testingCallbacks.executeTestFollowup(9)).resolves.toBeUndefined()
    bridge.testingCallbacks.disposeTestFollowups([9])
    await expect(bridge.testingCallbacks.syncTests()).resolves.toBe(true)
    await expect(bridge.testingCallbacks.refreshTests({ controllerId: "vitest" })).resolves.toBe(true)
    await expect(bridge.testingCallbacks.expandTest({ testId: "vitest\u0000suite", levels: 1 })).resolves.toBe(true)
    await expect(bridge.testingCallbacks.getCodeRelatedToTest({ testId: "vitest\u0000suite" })).resolves.toEqual([{ uri: "file:///workspace/src/test.ts" }])
    await expect(bridge.testingCallbacks.getTestsRelatedToCode({
      uri: { scheme: "file", path: "/workspace/src/test.ts" },
      position: { lineNumber: 1, column: 1 },
    })).resolves.toEqual(["vitest\u0000suite"])
    expect(runtime.ipc.sendExtHostTestingCancel).toHaveBeenCalledWith({ runId: "run:1", taskId: "task:1" })
    expect(runtime.ipc.sendExtHostTestingConfigureProfile).toHaveBeenCalledWith({ controllerId: "vitest", profileId: 1 })
    expect(runtime.ipc.getExtHostTestingCoverageDetails).toHaveBeenCalledWith({
      coverageId: "coverage:1",
      testId: "vitest\u0000suite",
    })
    expect(runtime.ipc.provideExtHostTestingFollowups).toHaveBeenCalledWith({
      testId: "vitest\u0000suite",
      resultId: "run:1",
      taskId: "task:1",
      message: { message: "failed" },
    })
    expect(runtime.ipc.executeExtHostTestingFollowup).toHaveBeenCalledWith({ id: 9 })
    expect(runtime.ipc.disposeExtHostTestingFollowups).toHaveBeenCalledWith({ ids: [9] })
    expect(runtime.ipc.syncExtHostTesting).toHaveBeenCalledWith()
    expect(runtime.ipc.refreshExtHostTesting).toHaveBeenCalledWith({ controllerId: "vitest" })
    expect(runtime.ipc.expandExtHostTesting).toHaveBeenCalledWith({ testId: "vitest\u0000suite", levels: 1 })
    expect(runtime.ipc.getExtHostTestingCodeRelatedToTest).toHaveBeenCalledWith({ testId: "vitest\u0000suite" })
    expect(runtime.ipc.getExtHostTestingTestsRelatedToCode).toHaveBeenCalledWith({
      uri: { scheme: "file", path: "/workspace/src/test.ts" },
      position: { lineNumber: 1, column: 1 },
    })

    await runtime.emitTestingControllerRemove({ controllerId: "vitest" })
    expect(testingService.getProjection().controllers).toEqual([])
    bridge.dispose()
  })

  it("routes VS Code MainThreadTesting adapter events into the renderer TestingService without a second state source", async () => {
    const runtime = createRuntimeIpc()
    const testingService = new TestingService()
    const bridge = installExtensionHostRuntimeBridge({
      ipc: runtime.ipc,
      testingService,
    })
    const server = createMainThreadTestingServer()
    const renderer = connectMainThreadTestingToRuntime(runtime)
    try {
      mainThreadTesting.register(server, { sendToRenderer: renderer.sendToRenderer })

      server.callRpc("$registerTestController", ["vitest", "Vitest", 0])
      server.callRpc("$publishTestRunProfile", [{
        controllerId: "vitest",
        profileId: 1,
        label: "Run",
        group: 1,
        isDefault: true,
      }])
      server.callRpc("$publishDiff", ["vitest", [
        {
          op: 0,
          item: {
            expand: 3,
            item: {
              extId: "vitest",
              label: "Vitest",
              uri: { scheme: "file", path: "/workspace" },
            },
          },
        },
        {
          op: 0,
          item: {
            expand: 0,
            item: {
              extId: "vitest\u0000suite",
              label: "suite",
              uri: { scheme: "file", path: "/workspace/src/test.ts" },
            },
          },
        },
      ]])
      server.callRpc("$startedExtensionTestRun", [{
        id: "run:adapter",
        include: ["vitest\u0000suite"],
        controllerId: "vitest",
        profile: { id: 1, group: 1 },
      }])
      server.callRpc("$startedTestRunTask", ["run:adapter", {
        id: "task:adapter",
        ctrlId: "vitest",
        name: "Adapter task",
        running: true,
      }])
      server.callRpc("$appendOutputToRun", [
        "run:adapter",
        "task:1",
        Buffer.from("adapter output"),
        { uri: { scheme: "file", path: "/workspace/src/test.ts" } },
        "vitest\u0000suite",
      ])
      server.callRpc("$appendTestMessagesInRun", ["run:adapter", "task:1", "vitest\u0000suite", [
        { message: "expected true", type: 0 },
      ]])
      server.callRpc("$updateTestStateInRun", ["run:adapter", "task:1", "vitest\u0000suite", 4, 25])
      server.callRpc("$appendCoverage", ["run:adapter", "task:1", {
        id: "coverage:adapter",
        uri: { scheme: "file", path: "/workspace/src/test.ts" },
        statement: { covered: 1, total: 2 },
        testIds: ["vitest\u0000suite"],
      }])
      server.callRpc("$markTestRetired", [["vitest\u0000suite"]])
      server.callRpc("$finishedTestRunTask", ["run:adapter", "task:adapter"])
      server.callRpc("$finishedExtensionTestRun", ["run:adapter"])
      await renderer.flush()

      const projection = testingService.getProjection()
      expect(projection.controllers).toEqual([{ id: "vitest", label: "Vitest" }])
      expect(projection.profiles).toEqual([expect.objectContaining({ controllerId: "vitest", profileId: 1, group: "run" })])
      expect(projection.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "vitest", depth: 0 }),
        expect.objectContaining({ id: "vitest\u0000suite", parentId: "vitest", depth: 1 }),
      ]))
      expect(projection.runs).toEqual([expect.objectContaining({
        id: "run:adapter",
        controllerId: "vitest",
        state: "failed",
        tasks: [expect.objectContaining({
          id: "task:adapter",
          controllerId: "vitest",
          name: "Adapter task",
          running: false,
        })],
        output: [expect.objectContaining({ message: "adapter output" })],
      })])
      expect(projection.results).toEqual([expect.objectContaining({
        id: "run:adapter:vitest\u0000suite",
        testId: "vitest\u0000suite",
        state: "failed",
        retired: true,
        durationMs: 25,
        messages: expect.arrayContaining(["adapter output", "expected true"]),
      })])
      expect(projection.coverage).toEqual(expect.objectContaining({ status: "available" }))
      expect(projection.resultPeek.entries).toEqual([expect.objectContaining({
        testId: "vitest\u0000suite",
        retired: true,
      })])
      expect(projection.testingExplorerContract.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "vitest\u0000suite",
          retired: true,
        }),
      ]))
      expect(projection.resultHistory).toEqual(expect.objectContaining({
        stateSource: "TestingService runs/results/output",
        retainedRunCount: 1,
        retainedResultCount: 1,
        adapter: expect.objectContaining({ noSecondState: true }),
      }))
      expect(testingService.getContractAudit().extensionHostBridge.status).toBe("connected")
      expect(testingService.getContractAudit().extensionHostBridge.adapterEvidence.rendererEventChannels).toEqual(expect.arrayContaining([
        "ext-host:testing-controller",
        "ext-host:testing-item",
        "ext-host:testing-run-start",
        "ext-host:testing-run-task-start",
        "ext-host:testing-run-task-finish",
        "ext-host:testing-run-state",
        "ext-host:testing-coverage",
        "ext-host:testing-retire",
      ]))
    } finally {
      bridge.dispose()
    }
  })

  it("projects extension task provider IPC events into the single userTasksService source", async () => {
    const runtime = createRuntimeIpc()
    const bridge = installExtensionHostRuntimeBridge({ ipc: runtime.ipc })

    await runtime.emitTaskProviderRegister({
      handle: 7,
      type: "npm",
      stateSource: "desktopExtensionHost/MainThreadTaskProviderRegistry",
    })
    expect(userTasksService.getContractSnapshot().providerBridge).toEqual(expect.objectContaining({
      status: "blocked",
      providerTaskCount: 0,
      rendererIpcConsumerConnected: true,
      terminalTaskSystemExecution: false,
    }))

    await runtime.emitTaskProviderProvide({
      handle: 7,
      type: "npm",
      taskCount: 1,
      tasks: [{
        _id: "npm:lint",
        name: "npm: lint",
        source: "npm",
        definition: { type: "npm", script: "lint" },
        execution: { process: "npm", args: ["run", "lint"] },
      }],
    })

    expect(userTasksService.getTasks("extensionProvider")).toEqual([
      expect.objectContaining({
        id: "extension-provider-task-npm-lint",
        source: "extensionProvider",
        providerType: "npm",
        command: "npm run lint",
      }),
    ])
    expect(userTasksService.getContractSnapshot().providerBridge).toEqual(expect.objectContaining({
      status: "partial",
      providerTaskCount: 1,
      rendererIpcConsumerConnected: true,
      terminalTaskSystemExecution: false,
      stateSource: "userTasksService/extensionProviderProjection",
    }))

    const taskRuns: Array<{ taskId?: string; options?: unknown }> = []
    const taskService = {
      _serviceBrand: undefined,
      openTasks: vi.fn(),
      runTask: vi.fn(async (taskId?: string, options?: unknown) => {
        taskRuns.push({ taskId, options })
        return {
          id: taskId || "",
          name: "npm: build",
          status: "passed" as const,
          blocked: [],
          startedAt: 1,
          finishedAt: 2,
          durationMs: 1,
          steps: [],
          summary: "passed",
        }
      }),
      rerunTask: vi.fn(),
      terminateTask: vi.fn(),
      terminateAllTasks: vi.fn(),
      restartActiveTerminal: vi.fn(),
      getLatestEvidence: vi.fn(),
      getTasks: vi.fn(),
      clearEvidence: vi.fn(),
      getLifecycleEvents: vi.fn(),
      getTaskSnapshot: vi.fn(),
    }
    bridge.dispose()
    const executeBridge = installExtensionHostRuntimeBridge({
      ipc: runtime.ipc,
      taskService,
    })

    await runtime.emitTaskProviderExecute({
      handle: 7,
      type: "npm",
      executionId: "codek-extension-task-build",
      task: {
        _id: "npm:build",
        name: "npm: build",
        source: "npm",
        definition: { type: "npm", script: "build" },
        execution: { process: "npm", args: ["run", "build"] },
      },
    })

    expect(taskService.runTask).toHaveBeenCalledWith(
      "extension-provider-task-npm-build",
      expect.objectContaining({ runCommand: expect.any(Function) }),
    )
    expect(userTasksService.getTasks("extensionProvider")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "extension-provider-task-npm-build",
        source: "extensionProvider",
        providerType: "npm",
        command: "npm run build",
      }),
    ]))
    expect(userTasksService.getContractSnapshot().providerBridge).toEqual(expect.objectContaining({
      status: "partial",
      providerTaskCount: 2,
      rendererIpcConsumerConnected: true,
    }))

    executeBridge.dispose()
    const blockedBridge = installExtensionHostRuntimeBridge({ ipc: runtime.ipc })
    await runtime.emitTaskProviderExecuteBlocked({ handle: 7, type: "npm" })
    expect(userTasksService.getContractSnapshot().providerBridge.terminalTaskSystemExecution).toBe(false)

    await runtime.emitTaskProviderUnregister({ handle: 7, type: "npm" })
    expect(userTasksService.getContractSnapshot().providerBridge).toEqual(expect.objectContaining({
      status: "blocked",
      providerTaskCount: 0,
      rendererIpcConsumerConnected: true,
    }))

    blockedBridge.dispose()
    await runtime.emitTaskProviderProvide({
      handle: 7,
      type: "npm",
      taskCount: 1,
      tasks: [{ _id: "npm:test", name: "npm: test", definition: { type: "npm" } }],
    })
    expect(userTasksService.getContractSnapshot().providerBridge.providerTaskCount).toBe(0)
  })

  it("routes MainThreadTask adapter execution through the renderer task facade", async () => {
    const runtime = createRuntimeIpc()
    const server = createActorServer(mainThreadTask.MAIN_THREAD_TASK_NID)
    const renderer = connectMainThreadAdapterToRuntime(runtime)
    const taskRuns: Array<{ taskId?: string; options?: unknown }> = []
    const taskService = {
      _serviceBrand: undefined,
      openTasks: vi.fn(),
      runTask: vi.fn(async (taskId?: string, options?: unknown) => {
        taskRuns.push({ taskId, options })
        return {
          id: taskId || "",
          name: "npm: bridge",
          status: "passed" as const,
          blocked: [],
          startedAt: 1,
          finishedAt: 2,
          durationMs: 1,
          steps: [],
          summary: "passed",
        }
      }),
      rerunTask: vi.fn(),
      terminateTask: vi.fn(),
      terminateAllTasks: vi.fn(),
      restartActiveTerminal: vi.fn(),
      getLatestEvidence: vi.fn(),
      getTasks: vi.fn(),
      clearEvidence: vi.fn(),
      getLifecycleEvents: vi.fn(),
      getTaskSnapshot: vi.fn(),
    }
    const bridge = installExtensionHostRuntimeBridge({
      ipc: runtime.ipc,
      taskService,
    })
    try {
      mainThreadTask.register(server, { sendToRenderer: renderer.sendToRenderer })
      await server.callRpc("$registerTaskProvider", [7, "npm"])
      await server.callRpc("$fetchTasks", [{ type: "npm" }])
      await server.callRpc("$executeTask", [{
        name: "npm: bridge",
        definition: { type: "npm", script: "bridge" },
      }])
      await renderer.flush()

      expect(server.handlers.has(`${mainThreadTask.MAIN_THREAD_TASK_NID}:$executeTask`)).toBe(true)
      expect(server.calls.map((call) => call.method)).toEqual(["$provideTasks", "$resolveTask"])
      expect(taskService.runTask).toHaveBeenCalledWith(
        "extension-provider-task-npm-bridge-resolved",
        expect.objectContaining({ runCommand: expect.any(Function) }),
      )
      expect(taskRuns[0].taskId).toBe("extension-provider-task-npm-bridge-resolved")
      expect(userTasksService.getTasks("extensionProvider")).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "extension-provider-task-npm-bridge" }),
        expect.objectContaining({ id: "extension-provider-task-npm-bridge-resolved" }),
      ]))
      expect(userTasksService.getContractSnapshot().providerBridge).toEqual(expect.objectContaining({
        status: "partial",
        providerTaskCount: 2,
        rendererIpcConsumerConnected: true,
      }))
    } finally {
      bridge.dispose()
    }
  })
})
