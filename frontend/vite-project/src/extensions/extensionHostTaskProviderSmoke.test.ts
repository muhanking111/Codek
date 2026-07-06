import { createRequire } from "node:module"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  installExtensionHostRuntimeBridge,
  type ExtensionHostRuntimeIpc,
  type ExtensionHostTaskProviderEvidencePayload,
  type ExtensionHostTaskProviderProvidePayload,
} from "./extensionHostRuntimeBridge"
import { userTasksService } from "../workbench/userTasks"
import { globalTaskService } from "../workbench/terminalDebugTaskWorkbench"
import { getOutputChannel } from "../utils/outputChannel"
import { attachPty, createTerminal, getTerminalByInstanceId, resetAll as resetAllTerminals } from "../terminal/terminalManager"

const require = createRequire(import.meta.url)
const mainThreadTask = require("../../../../desktop/services/extensions-host/mainThread/mainThreadTask.js")

type Listener<T> = (payload: T) => void | Promise<void>

function createServer() {
  const handlers = new Map<string, (args?: unknown[]) => unknown>()
  const calls: Array<{
    nid: number
    method: string
    args: unknown[]
    timeoutMs?: number
    options?: Record<string, unknown>
  }> = []
  return {
    calls,
    onRpc(actorIdOrMethod: number | string, methodOrHandler: string | ((args?: unknown[]) => unknown), maybeHandler?: (args?: unknown[]) => unknown) {
      const key = typeof actorIdOrMethod === "number"
        ? `${actorIdOrMethod}:${methodOrHandler}`
        : actorIdOrMethod
      const handler = typeof actorIdOrMethod === "number" ? maybeHandler : methodOrHandler
      handlers.set(key, handler as (args?: unknown[]) => unknown)
    },
    callRpc(method: string, args: unknown[] = []) {
      const actorKey = `${mainThreadTask.MAIN_THREAD_TASK_NID}:${method}`
      const handler = handlers.get(actorKey) || handlers.get(method)
      if (!handler) throw new Error(`missing handler ${method}`)
      return handler(args)
    },
    call(nid: number, method: string, args: unknown[], timeoutMs?: number, options?: Record<string, unknown>) {
      calls.push({ nid, method, args, timeoutMs, options })
      if (method === "$provideTasks") {
        return Promise.resolve({
          tasks: [{
            _id: "npm:smoke",
            name: "npm: smoke",
            source: "npm",
            definition: { type: "npm", script: "smoke" },
            execution: { process: "npm", args: ["run", "smoke"] },
          }],
          extension: { identifier: { value: "vscode.npm" } },
        })
      }
      return Promise.resolve(undefined)
    },
  }
}

function createTaskProviderRuntimeIpc() {
  const listeners = {
    register: [] as Listener<ExtensionHostTaskProviderEvidencePayload>[],
    unregister: [] as Listener<ExtensionHostTaskProviderEvidencePayload>[],
    provide: [] as Listener<ExtensionHostTaskProviderProvidePayload>[],
    resolve: [] as Listener<ExtensionHostTaskProviderEvidencePayload>[],
    execute: [] as Listener<ExtensionHostTaskProviderEvidencePayload>[],
    executeBlocked: [] as Listener<ExtensionHostTaskProviderEvidencePayload>[],
    terminateBlocked: [] as Listener<ExtensionHostTaskProviderEvidencePayload>[],
  }
  const remove = <T>(bucket: Listener<T>[], callback: Listener<T>) => () => {
    const index = bucket.indexOf(callback)
    if (index >= 0) bucket.splice(index, 1)
  }
  const emit = async <T>(bucket: Listener<T>[], payload: T) => {
    await Promise.all(bucket.map((listener) => listener(payload)))
  }
  const ipc: ExtensionHostRuntimeIpc = {
    onExtHostTaskProviderRegister: (callback) => {
      listeners.register.push(callback)
      return remove(listeners.register, callback)
    },
    onExtHostTaskProviderUnregister: (callback) => {
      listeners.unregister.push(callback)
      return remove(listeners.unregister, callback)
    },
    onExtHostTaskProviderProvide: (callback) => {
      listeners.provide.push(callback)
      return remove(listeners.provide, callback)
    },
    onExtHostTaskProviderResolve: (callback) => {
      listeners.resolve.push(callback)
      return remove(listeners.resolve, callback)
    },
    onExtHostTaskProviderExecute: (callback) => {
      listeners.execute.push(callback)
      return remove(listeners.execute, callback)
    },
    onExtHostTaskProviderExecuteBlocked: (callback) => {
      listeners.executeBlocked.push(callback)
      return remove(listeners.executeBlocked, callback)
    },
    onExtHostTaskProviderTerminateBlocked: (callback) => {
      listeners.terminateBlocked.push(callback)
      return remove(listeners.terminateBlocked, callback)
    },
  }
  const dispatchRendererEvent = (channel: string, payload: ExtensionHostTaskProviderEvidencePayload | ExtensionHostTaskProviderProvidePayload) => {
    const bucketByChannel: Record<string, Listener<any>[]> = {
      "ext-host:task-provider-register": listeners.register,
      "ext-host:task-provider-unregister": listeners.unregister,
      "ext-host:task-provider-provide": listeners.provide,
      "ext-host:task-provider-resolve": listeners.resolve,
      "ext-host:task-provider-execute": listeners.execute,
      "ext-host:task-provider-execute-blocked": listeners.executeBlocked,
      "ext-host:task-provider-terminate-blocked": listeners.terminateBlocked,
    }
    return emit(bucketByChannel[channel] || [], payload)
  }
  return { ipc, dispatchRendererEvent }
}

function getTasksOutputPreview(): string {
  return getOutputChannel("Tasks").getEntries().map((entry) => entry.message).join("\n")
}

describe("extension host task provider smoke", () => {
  beforeEach(() => {
    userTasksService.reset()
    globalTaskService.clearEvidence()
    getOutputChannel("Tasks").clear()
    resetAllTerminals()
    delete (globalThis as { codek?: unknown }).codek
  })

  it("projects MainThreadTask $fetchTasks provider DTOs through the renderer bridge into userTasksService", async () => {
    const server = createServer()
    const runtime = createTaskProviderRuntimeIpc()
    const pendingRendererEvents: Promise<void>[] = []
    const bridge = installExtensionHostRuntimeBridge({ ipc: runtime.ipc })

    mainThreadTask.register(server, {
      sendToRenderer: (channel: string, payload: ExtensionHostTaskProviderEvidencePayload | ExtensionHostTaskProviderProvidePayload) => {
        pendingRendererEvents.push(runtime.dispatchRendererEvent(channel, payload))
      },
    })

    await server.callRpc("$registerTaskProvider", [7, "npm"])
    await Promise.all(pendingRendererEvents.splice(0))
    expect(userTasksService.getContractSnapshot().providerBridge).toEqual(expect.objectContaining({
      status: "blocked",
      providerTaskCount: 0,
      rendererIpcConsumerConnected: true,
      terminalTaskSystemExecution: false,
    }))

    const fetchedTasks = await server.callRpc("$fetchTasks", [{ type: "npm" }])
    await Promise.all(pendingRendererEvents.splice(0))

    expect(server.calls).toEqual([expect.objectContaining({
      nid: mainThreadTask.EXT_HOST_TASK_NID,
      method: "$provideTasks",
      args: [7, { npm: true }],
      timeoutMs: 30000,
      options: { usesCancellationToken: true },
    })])
    expect(fetchedTasks).toEqual([expect.objectContaining({
      _id: "npm:smoke",
      definition: { type: "npm", script: "smoke" },
    })])
    expect(userTasksService.getTasks("extensionProvider")).toEqual([
      expect.objectContaining({
        id: "extension-provider-task-npm-smoke",
        name: "npm: smoke",
        source: "extensionProvider",
        providerType: "npm",
        command: "npm run smoke",
      }),
    ])
    expect(userTasksService.getContractSnapshot().providerBridge).toEqual(expect.objectContaining({
      status: "partial",
      providerTaskCount: 1,
      rendererIpcConsumerConnected: true,
      stateSource: "userTasksService/extensionProviderProjection",
      terminalTaskSystemExecution: false,
    }))

    bridge.dispose()
  })

  it("runs MainThreadTask $executeTask through the renderer TaskWorkbenchAdapterService lifecycle", async () => {
    const server = createServer()
    const runtime = createTaskProviderRuntimeIpc()
    const pendingRendererEvents: Promise<void>[] = []
    const runCommandCalls: Array<{ command: string; cwd?: string; env?: Record<string, string> }> = []
    ;(globalThis as { codek?: ExtensionHostRuntimeIpc }).codek = {
      runCommand: async (command, options) => {
        runCommandCalls.push({ command, cwd: options?.cwd, env: options?.env })
        return {
          stdout: `electron-shell-output:${command}`,
          exitCode: 0,
          terminalId: 91,
          processId: 9191,
        }
      },
    }
    const bridge = installExtensionHostRuntimeBridge({ ipc: runtime.ipc })

    mainThreadTask.register(server, {
      sendToRenderer: (channel: string, payload: ExtensionHostTaskProviderEvidencePayload | ExtensionHostTaskProviderProvidePayload) => {
        pendingRendererEvents.push(runtime.dispatchRendererEvent(channel, payload))
      },
    })

    await server.callRpc("$registerTaskProvider", [7, "npm"])
    await server.callRpc("$executeTask", [{
      name: "npm: smoke",
      source: "npm",
      definition: { type: "npm", script: "smoke" },
      execution: { process: "npm", args: ["run", "smoke"] },
      presentationOptions: { reveal: 1 },
      isBackground: true,
      problemMatchers: [{
        id: "watch",
        owner: "typescript",
        source: "TypeScript",
        fileLocation: "relative",
        filePrefix: "D:/Workspace",
        pattern: {
          regexp: /^(.*)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/,
          file: 1,
          line: 2,
          column: 3,
          severity: 4,
          code: 5,
          message: 6,
        },
        background: {
          activeOnStart: true,
          beginsPattern: /routed from MainThreadTask/,
          endsPattern: /never-matches/,
        },
      }],
    }])
    await Promise.all(pendingRendererEvents.splice(0))

    const providerTask = userTasksService.getTasks("extensionProvider")[0]
    const snapshot = globalTaskService.getTaskSnapshot()

    expect(providerTask).toEqual(expect.objectContaining({
      id: "extension-provider-task-npm-npm-smoke",
      source: "extensionProvider",
      providerType: "npm",
      command: "npm run smoke",
    }))
    expect(runCommandCalls).toEqual([{
      command: "npm run smoke",
      cwd: undefined,
      env: undefined,
    }])
    expect(globalTaskService.getLatestEvidence()).toEqual(expect.objectContaining({
      id: providerTask.id,
      steps: [
        expect.objectContaining({
          id: providerTask.id,
          outputPreview: "electron-shell-output:npm run smoke",
        }),
      ],
    }))
    expect(globalTaskService.getLifecycleEvents().map((event) => event.taskId)).toEqual(
      expect.arrayContaining([providerTask.id]),
    )
    expect(snapshot.lifecycle).toEqual(expect.objectContaining({
      activeTaskId: providerTask.id,
      activeExecutionCount: 1,
      activeExecutionMap: [
        expect.objectContaining({
          taskId: providerTask.id,
          taskName: "npm: smoke",
          runType: "background",
          terminalInstanceId: 91,
          processId: 9191,
          stateSource: "taskRunner/activeExecutionMap",
        }),
      ],
      stateSource: "taskRunner/TaskSystemLifecycleProjection",
    }))
    expect(snapshot.capabilities.extensionTaskProviderBridge).toEqual(expect.objectContaining({
      status: "partial",
      providerTaskCount: 1,
      rendererIpcConsumerConnected: true,
      terminalTaskSystemExecution: true,
      executionEvidence: expect.objectContaining({
        taskId: providerTask.id,
        providerType: "npm",
        terminalInstanceId: 91,
        processId: 9191,
        activeExecutionMapped: true,
        stateSource: "taskRunner/TaskSystemLifecycleProjection",
      }),
    }))
    expect(getTasksOutputPreview()).toContain("[passed] npm: smoke")
    expect(getTasksOutputPreview()).toContain("- npm: smoke: passed 0")
    expect(getTasksOutputPreview()).toContain("output: electron-shell-output:npm run smoke")
    expect(snapshot.capabilities.blocked).toEqual(expect.not.arrayContaining([
      expect.objectContaining({
        capability: "extensionTaskProviderBridge",
        missingOwner: expect.stringContaining("MainThreadTask.$executeTask"),
      }),
    ]))

    bridge.dispose()
  })

  it("collects single-run provider task output from the pty owner path", async () => {
    const server = createServer()
    const runtime = createTaskProviderRuntimeIpc()
    const pendingRendererEvents: Promise<void>[] = []
    let dataListener: ((payload: { id: string; data?: string }) => void) | undefined
    let exitListener: ((payload: { id: string; exitCode?: number | null }) => void) | undefined
    const ptyWriteCalls: Array<{ id: string; data: string }> = []
    ;(globalThis as { codek?: ExtensionHostRuntimeIpc }).codek = {
      pty: {
        create: async () => ({ ok: true, id: "pty-single-run-provider", pid: 9393 }),
        write: async (id, data) => {
          ptyWriteCalls.push({ id, data })
          queueMicrotask(() => {
            dataListener?.({ id, data: "electron-provider-output" })
            exitListener?.({ id, exitCode: 0 })
          })
          return true
        },
        onData: (listener) => {
          dataListener = listener
          return () => {
            dataListener = undefined
          }
        },
        onExit: (listener) => {
          exitListener = listener
          return () => {
            exitListener = undefined
          }
        },
        dispose: async () => true,
      },
    }
    const bridge = installExtensionHostRuntimeBridge({ ipc: runtime.ipc })

    mainThreadTask.register(server, {
      sendToRenderer: (channel: string, payload: ExtensionHostTaskProviderEvidencePayload | ExtensionHostTaskProviderProvidePayload) => {
        pendingRendererEvents.push(runtime.dispatchRendererEvent(channel, payload))
      },
    })

    await server.callRpc("$registerTaskProvider", [7, "npm"])
    await server.callRpc("$executeTask", [{
      name: "npm: electron provider smoke",
      source: "npm",
      definition: { type: "npm", script: "electron-provider-smoke" },
      execution: { process: "node", args: ["-e", "\"process.stdout.write('electron-provider-output')\""] },
      isBackground: false,
    }])
    await Promise.all(pendingRendererEvents.splice(0))

    expect(ptyWriteCalls).toEqual([
      {
        id: "pty-single-run-provider",
        data: "node -e \"process.stdout.write('electron-provider-output')\"; exit $LASTEXITCODE\r",
      },
    ])
    expect(globalTaskService.getLatestEvidence()).toEqual(expect.objectContaining({
      status: "passed",
      steps: [
        expect.objectContaining({
          outputPreview: "electron-provider-output",
          exitCode: 0,
        }),
      ],
    }))
    expect(getTasksOutputPreview()).toContain("output: electron-provider-output")
    expect(globalTaskService.getTaskSnapshot().capabilities.extensionTaskProviderBridge.executionEvidence).toEqual(expect.objectContaining({
      terminalOwnerCreated: true,
      lastTerminalInstanceId: expect.any(Number),
      lastProcessId: 9393,
      terminalOwnerResolved: false,
      activeExecutionMapped: false,
      finishedRunTerminalOwnerBlockedReason: "provider single-run 已触发 terminal owner 并正常结束；按 VS Code TerminalTaskSystem.getActiveTasks/activeTasks 语义，结束后的 single-run 不再是 running task，不能保留 activeExecutionMap entry 给 terminateAll/restartActiveTerminal。若要支持从已结束 terminal rerun，需要迁移 TerminalTaskSystem.getTaskForTerminal 的 terminal lastTask 回退，而不是伪造 active owner。",
      nextAuthorizedFiles: [
        "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
        "frontend/vite-project/src/workbench/taskRunner.ts",
        "frontend/vite-project/src/terminal/terminalManager.ts",
        "desktop/services/extensions-host/mainThread/mainThreadTask.js",
      ],
    }))
    const finishedSnapshot = globalTaskService.getTaskSnapshot()
    const terminalInstanceId = finishedSnapshot.capabilities.extensionTaskProviderBridge.executionEvidence?.lastTerminalInstanceId
    expect(finishedSnapshot.lifecycle).toEqual(expect.objectContaining({
      activeExecutionCount: 0,
      activeExecutionMap: [],
      supportsTerminateAll: false,
      supportsRestartActiveTerminal: true,
      terminalLastTaskMap: [
        expect.objectContaining({
          terminalInstanceId,
          taskId: expect.stringContaining("electron-provider-smoke"),
          status: "finished",
          stateSource: "taskRunner/terminalLastTaskMap",
        }),
      ],
    }))
    expect(finishedSnapshot.capabilities.terminalTabActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "workbench.action.tasks.rerunTask",
        available: true,
        terminalInstanceId,
        stateSource: "taskRunner/terminalLastTaskMap",
      }),
      expect.objectContaining({
        id: "workbench.action.tasks.terminateAll",
        available: false,
        stateSource: "taskRunner/activeExecutionMap",
      }),
    ]))

    bridge.dispose()
  })

  it("resolves MainThreadTask $executeTask terminal owner when the provider bridge returns terminalInstanceId", async () => {
    const server = createServer()
    const runtime = createTaskProviderRuntimeIpc()
    const pendingRendererEvents: Promise<void>[] = []
    const terminal = createTerminal("powershell", "D:/Workspace")
    attachPty(terminal.id, "pty-provider-smoke", 8181)
    ;(globalThis as { codek?: ExtensionHostRuntimeIpc & { pty: { dispose: () => Promise<boolean>; onExit: () => () => void } } }).codek = {
      runCommand: async (command) => ({
        stdout: `electron-shell-output:${command}`,
        exitCode: 0,
        terminalInstanceId: terminal.instanceId,
        processId: 8181,
      }),
      pty: {
        dispose: async () => true,
        onExit: () => () => {},
      },
    }
    const bridge = installExtensionHostRuntimeBridge({ ipc: runtime.ipc })

    mainThreadTask.register(server, {
      sendToRenderer: (channel: string, payload: ExtensionHostTaskProviderEvidencePayload | ExtensionHostTaskProviderProvidePayload) => {
        pendingRendererEvents.push(runtime.dispatchRendererEvent(channel, payload))
      },
    })

    await server.callRpc("$registerTaskProvider", [7, "npm"])
    await server.callRpc("$executeTask", [{
      name: "npm: owner",
      source: "npm",
      definition: { type: "npm", script: "owner" },
      execution: { process: "npm", args: ["run", "owner"] },
      isBackground: true,
      problemMatchers: [{
        id: "watch",
        owner: "typescript",
        source: "TypeScript",
        fileLocation: "relative",
        filePrefix: "D:/Workspace",
        pattern: {
          regexp: /^(.*)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/,
          file: 1,
          line: 2,
          column: 3,
          severity: 4,
          code: 5,
          message: 6,
        },
        background: {
          activeOnStart: true,
          beginsPattern: /electron-shell-output/,
          endsPattern: /never-matches/,
        },
      }],
    }])
    await Promise.all(pendingRendererEvents.splice(0))

    const providerTask = userTasksService.getTasks("extensionProvider")[0]
    const snapshot = globalTaskService.getTaskSnapshot()
    expect(providerTask).toEqual(expect.objectContaining({
      id: "extension-provider-task-npm-npm-owner",
      source: "extensionProvider",
      providerType: "npm",
      command: "npm run owner",
    }))
    expect(snapshot.lifecycle).toEqual(expect.objectContaining({
      activeTaskId: providerTask.id,
      terminalInstanceId: terminal.instanceId,
      processId: 8181,
      activeExecutionCount: 1,
      supportsTerminateAll: true,
      supportsRestartActiveTerminal: true,
    }))
    expect(snapshot.capabilities.extensionTaskProviderBridge).toEqual(expect.objectContaining({
      terminalTaskSystemExecution: true,
      executionEvidence: expect.objectContaining({
        taskId: providerTask.id,
        terminalInstanceId: terminal.instanceId,
        processId: 8181,
        lastTerminalInstanceId: terminal.instanceId,
        lastProcessId: 8181,
        terminalOwnerCreated: true,
        activeExecutionMapped: true,
        terminalOwnerResolved: true,
        blockedReason: "",
        missingOwner: "",
      }),
    }))
    expect(snapshot.capabilities.blocked).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ capability: "extensionTaskProviderBridge" }),
      expect.objectContaining({ capability: "terminalOwnership" }),
    ]))

    bridge.dispose()
  })

  it("creates a terminalManager pty owner for MainThreadTask $executeTask when the provider bridge can use pty", async () => {
    const server = createServer()
    const runtime = createTaskProviderRuntimeIpc()
    const pendingRendererEvents: Promise<void>[] = []
    const ptyCreateCalls: Array<{ shellType?: string; cwd?: string; env?: Record<string, string>; confirmed?: boolean }> = []
    const ptyWriteCalls: Array<{ id: string; data: string }> = []
    const ptyDisposeCalls: string[] = []
    const ptyExitListeners: Array<(payload: { id: string; exitCode: number | null }) => void> = []
    ;(globalThis as { codek?: ExtensionHostRuntimeIpc }).codek = {
      pty: {
        create: async (options) => {
          ptyCreateCalls.push(options)
          return { ok: true, id: "pty-created-provider-owner", pid: 9292 }
        },
        write: async (id, data) => {
          ptyWriteCalls.push({ id, data })
          return true
        },
        dispose: async (id) => {
          ptyDisposeCalls.push(id)
          queueMicrotask(() => {
            for (const listener of ptyExitListeners) listener({ id, exitCode: 143 })
          })
          return true
        },
        onExit: (listener) => {
          ptyExitListeners.push(listener)
          return () => {
            const index = ptyExitListeners.indexOf(listener)
            if (index >= 0) ptyExitListeners.splice(index, 1)
          }
        },
      },
    }
    const bridge = installExtensionHostRuntimeBridge({ ipc: runtime.ipc })

    mainThreadTask.register(server, {
      sendToRenderer: (channel: string, payload: ExtensionHostTaskProviderEvidencePayload | ExtensionHostTaskProviderProvidePayload) => {
        pendingRendererEvents.push(runtime.dispatchRendererEvent(channel, payload))
      },
    })

    await server.callRpc("$registerTaskProvider", [7, "npm"])
    await server.callRpc("$executeTask", [{
      name: "npm: pty owner",
      source: "npm",
      definition: { type: "npm", script: "pty-owner" },
      execution: { process: "npm", args: ["run", "pty-owner"] },
      isBackground: true,
      problemMatchers: [{
        id: "watch",
        owner: "typescript",
        source: "TypeScript",
        fileLocation: "relative",
        filePrefix: "D:/Workspace",
        pattern: {
          regexp: /^(.*)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/,
          file: 1,
          line: 2,
          column: 3,
          severity: 4,
          code: 5,
          message: 6,
        },
        background: {
          activeOnStart: true,
          beginsPattern: /terminalManager pty owner/,
          endsPattern: /never-matches/,
        },
      }],
    }])
    await Promise.all(pendingRendererEvents.splice(0))

    const providerTask = userTasksService.getTasks("extensionProvider")[0]
    const snapshot = globalTaskService.getTaskSnapshot()
    const terminalInstanceId = snapshot.lifecycle.terminalInstanceId

    expect(ptyCreateCalls).toEqual([
      expect.objectContaining({
        shellType: "powershell",
        confirmed: true,
      }),
    ])
    expect(ptyWriteCalls).toEqual([
      { id: "pty-created-provider-owner", data: "npm run pty-owner\r" },
    ])
    expect(typeof terminalInstanceId).toBe("number")
    expect(getTerminalByInstanceId(terminalInstanceId)).toEqual(expect.objectContaining({
      ptyId: "pty-created-provider-owner",
      pid: 9292,
    }))
    expect(snapshot.lifecycle).toEqual(expect.objectContaining({
      activeTaskId: providerTask.id,
      processId: 9292,
      activeExecutionCount: 1,
      supportsTerminateAll: true,
      supportsRestartActiveTerminal: true,
    }))
    expect(snapshot.capabilities.extensionTaskProviderBridge).toEqual(expect.objectContaining({
      terminalTaskSystemExecution: true,
      executionEvidence: expect.objectContaining({
        taskId: providerTask.id,
        terminalInstanceId,
        processId: 9292,
        lastTerminalInstanceId: terminalInstanceId,
        lastProcessId: 9292,
        terminalOwnerCreated: true,
        activeExecutionMapped: true,
        terminalOwnerResolved: true,
        blockedReason: "",
        missingOwner: "",
      }),
    }))
    expect(snapshot.capabilities.blocked).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ capability: "extensionTaskProviderBridge" }),
      expect.objectContaining({ capability: "terminalOwnership" }),
    ]))

    const terminateAll = await globalTaskService.terminateAllTasks()

    expect(terminateAll).toEqual(expect.objectContaining({
      success: true,
      action: "terminateAll",
      terminatedCount: 1,
      activeExecutionCount: 0,
      results: [
        expect.objectContaining({
          success: true,
          taskId: providerTask.id,
          terminalInstanceId,
          processId: 9292,
          terminalOwner: expect.objectContaining({
            success: true,
            ptyId: "pty-created-provider-owner",
            exitCode: 143,
            stateSource: "terminalManager/terminalOwnerApi",
          }),
        }),
      ],
    }))
    expect(ptyDisposeCalls).toEqual(["pty-created-provider-owner"])
    expect(globalTaskService.getTaskSnapshot().lifecycle).toEqual(expect.objectContaining({
      activeTaskId: "",
      activeExecutionCount: 0,
      activeExecutionMap: [],
      supportsTerminateAll: false,
      stateSource: "taskRunner/TaskSystemLifecycleProjection",
    }))

    bridge.dispose()
  })

  it("keeps MainThreadTask $executeTask current smoke blocked when runCommand returns no terminal owner", async () => {
    const server = createServer()
    const runtime = createTaskProviderRuntimeIpc()
    const pendingRendererEvents: Promise<void>[] = []
    const bridge = installExtensionHostRuntimeBridge({ ipc: runtime.ipc })

    mainThreadTask.register(server, {
      sendToRenderer: (channel: string, payload: ExtensionHostTaskProviderEvidencePayload | ExtensionHostTaskProviderProvidePayload) => {
        pendingRendererEvents.push(runtime.dispatchRendererEvent(channel, payload))
      },
    })

    await server.callRpc("$registerTaskProvider", [7, "npm"])
    await server.callRpc("$executeTask", [{
      name: "npm: current",
      source: "npm",
      definition: { type: "npm", script: "current" },
      execution: { process: "npm", args: ["run", "current"] },
      presentationOptions: { reveal: 1 },
    }])
    await Promise.all(pendingRendererEvents.splice(0))

    const providerTask = userTasksService.getTasks("extensionProvider")[0]
    const snapshot = globalTaskService.getTaskSnapshot()

    expect(providerTask).toEqual(expect.objectContaining({
      id: "extension-provider-task-npm-npm-current",
      source: "extensionProvider",
      providerType: "npm",
      command: "npm run current",
    }))
    expect(globalTaskService.getLatestEvidence()).toEqual(expect.objectContaining({
      id: providerTask.id,
      status: "passed",
      steps: [
        expect.objectContaining({
          id: providerTask.id,
          outputPreview: "Task npm: current routed from MainThreadTask.$executeTask to TaskWorkbenchAdapterService.runTask.",
        }),
      ],
    }))
    expect(snapshot.lifecycle).toEqual(expect.objectContaining({
      activeTaskId: providerTask.id,
      activeExecutionCount: 0,
      activeExecutionMap: [],
      terminalInstanceId: null,
      processId: null,
      supportsTerminateAll: false,
      supportsRestartActiveTerminal: false,
      stateSource: "taskRunner/TaskSystemLifecycleProjection",
    }))
    expect(snapshot.capabilities.extensionTaskProviderBridge).toEqual(expect.objectContaining({
      status: "partial",
      providerTaskCount: 1,
      rendererIpcConsumerConnected: true,
      terminalTaskSystemExecution: true,
      executionEvidence: expect.objectContaining({
        taskId: providerTask.id,
        providerType: "npm",
        runType: "singleRun",
        terminalInstanceId: null,
        processId: null,
        activeExecutionMapped: false,
        terminalOwnerResolved: false,
        blockedReason: "provider task 已进入 taskRunner execution，但 current/single-run 执行结束后没有保留 activeExecutionMap entry；没有 active terminal owner 可用于 terminateAll/restartActiveTerminal。",
        missingOwner: "terminalManager pty dispose/onExit owner returned by the provider task execution bridge",
      }),
    }))
    expect(snapshot.capabilities.blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "extensionTaskProviderBridge",
        currentOwner: "userTasksService extensionProvider projection + TaskWorkbenchAdapterService.runTask/taskRunner lifecycle",
        missingOwner: "terminalManager pty dispose/onExit owner returned by the provider task execution bridge",
      }),
      expect.objectContaining({
        capability: "terminalOwnership",
        missingOwner: "active task terminal instance that resolves through terminalManager pty dispose/onExit",
      }),
      expect.objectContaining({
        capability: "terminateAll",
        missingOwner: "terminalManager pty dispose/onExit owner for every active execution",
      }),
      expect.objectContaining({
        capability: "restartActiveTerminal",
        missingOwner: "active terminal task execution that resolves through terminalManager pty dispose/onExit",
      }),
    ]))
    expect(getTasksOutputPreview()).toContain("[passed] npm: current")
    expect(getTasksOutputPreview()).toContain("routed from MainThreadTask.$executeTask to TaskWorkbenchAdapterService.runTask")

    bridge.dispose()
  })
})
