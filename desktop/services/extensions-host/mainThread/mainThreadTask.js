/**
 * MainThreadTask - lightweight VS Code task provider RPC bridge.
 *
 * This adapter records extension task provider registration and can ask
 * ExtHostTask for provideTasks/resolveTask evidence. It intentionally does not
 * create a second task execution state; execution is handed to the renderer
 * TaskWorkbenchAdapterService facade when that bridge is available.
 */

const crypto = require("crypto")
const { ExtHostContext } = require("../extHostServer")

const MAIN_THREAD_TASK_NID = 57
const EXT_HOST_TASK_NID = ExtHostContext.ExtHostTask

function onRpc(server, method, handler) {
  server.onRpc(MAIN_THREAD_TASK_NID, method, handler)
  server.onRpc(method, handler)
}

function getCallEh(server, opts = {}) {
  if (typeof opts.callEh === "function") return opts.callEh
  return (nid, method, args, timeoutMs, options) => server.call(nid, method, args, timeoutMs, options)
}

function register(server, opts = {}) {
  const { sendToRenderer } = opts
  const hasRendererTaskExecutionBridge = opts.rendererTaskExecutionBridge !== false
  const callEh = getCallEh(server, opts)
  const providers = new Map()
  const supportedExecutions = {
    custom: false,
    shell: false,
    process: false,
  }
  const taskSystems = new Map()

  const emit = (channel, payload) => {
    if (sendToRenderer) sendToRenderer(channel, payload)
  }

  onRpc(server, "$registerTaskProvider", (args) => {
    const [rawHandle, rawType] = args || []
    const handle = normalizeHandle(rawHandle)
    const type = normalizeType(rawType)
    if (handle === undefined || !type) return undefined

    providers.set(handle, {
      handle,
      type,
      registeredAt: Date.now(),
      provideCount: 0,
      resolveCount: 0,
    })
    emit("ext-host:task-provider-register", createProviderEvidence(providers.get(handle)))
    return undefined
  })

  onRpc(server, "$unregisterTaskProvider", (args) => {
    const [rawHandle] = args || []
    const handle = normalizeHandle(rawHandle)
    if (handle === undefined) return undefined
    const provider = providers.get(handle)
    providers.delete(handle)
    if (provider) {
      emit("ext-host:task-provider-unregister", createProviderEvidence(provider))
    }
    return undefined
  })

  onRpc(server, "$createTaskId", (args) => {
    const [task] = args || []
    return createTaskId(task)
  })

  onRpc(server, "$fetchTasks", async (args) => {
    const [filter] = args || []
    return fetchRegisteredProviderTasks({
      providers,
      callEh,
      filter,
      emit,
    })
  })

  onRpc(server, "$getTaskExecution", async (args) => {
    const [value] = args || []
    const task = await resolveTaskForRegisteredProvider({ providers, callEh, task: value, emit })
    return {
      id: createTaskId(task || value),
      task: task || value,
    }
  })

  onRpc(server, "$executeTask", async (args) => {
    const [value] = args || []
    const task = await resolveTaskForRegisteredProvider({ providers, callEh, task: value, emit })
    const execution = {
      id: createTaskId(task || value),
      task: task || value,
    }
    if (hasRendererTaskExecutionBridge) {
      emit("ext-host:task-provider-execute", {
        executionId: execution.id,
        taskType: getTaskType(task || value),
        task: execution.task,
        blocked: false,
        stateSource: "desktopExtensionHost/MainThreadTask.$executeTask",
        rendererTaskFacade: "TaskWorkbenchAdapterService.runTask",
        vscodeSourcePath: "src/vs/workbench/api/browser/mainThreadTask.ts",
        currentSourcePath: "desktop/services/extensions-host/mainThread/mainThreadTask.js",
        noSecondTaskState: true,
        runtimeReference: false,
      })
    } else {
      emit("ext-host:task-provider-execute-blocked", {
        executionId: execution.id,
        taskType: getTaskType(task || value),
        blocked: true,
        reason: "Renderer TaskWorkbenchAdapterService.runTask bridge is unavailable; keeping MainThreadTask.$executeTask blocked instead of creating a second Task state source.",
        runtimeReference: false,
      })
    }
    return execution
  })

  onRpc(server, "$terminateTask", (args) => {
    const [id] = args || []
    emit("ext-host:task-provider-terminate-blocked", {
      executionId: String(id || ""),
      blocked: true,
      reason: "Task termination still belongs to the lightweight taskRunner projection, not VS Code TerminalTaskSystem.",
      runtimeReference: false,
    })
    return undefined
  })

  onRpc(server, "$registerTaskSystem", (args) => {
    const [scheme, info] = args || []
    if (typeof scheme === "string" && scheme) {
      taskSystems.set(scheme, sanitizeObject(info))
      emit("ext-host:task-system-register", {
        scheme,
        info: sanitizeObject(info),
        source: "MainThreadTask",
        stateSource: "desktopExtensionHost/MainThreadTaskSystemRegistry",
        vscodeSourcePath: "src/vs/workbench/api/browser/mainThreadTask.ts",
        currentSourcePath: "desktop/services/extensions-host/mainThread/mainThreadTask.js",
        noSecondTaskState: true,
        runtimeReference: false,
      })
    }
    return undefined
  })

  onRpc(server, "$customExecutionComplete", (args) => {
    const [id, result] = args || []
    emit("ext-host:task-custom-execution-complete", {
      executionId: String(id || ""),
      result: Number.isFinite(Number(result)) ? Number(result) : undefined,
      source: "MainThreadTask",
    })
    return undefined
  })

  onRpc(server, "$registerSupportedExecutions", (args) => {
    const [custom, shell, process] = args || []
    supportedExecutions.custom = !!custom
    supportedExecutions.shell = !!shell
    supportedExecutions.process = !!process
    emit("ext-host:task-supported-executions", {
      ...supportedExecutions,
      source: "MainThreadTask",
    })
    return undefined
  })

  return {
    providers,
    supportedExecutions,
    taskSystems,
  }
}

async function fetchRegisteredProviderTasks({ providers, callEh, filter, emit }) {
  const validTypes = buildValidTypes(providers, filter)
  const tasks = []
  for (const provider of providers.values()) {
    if (Object.keys(validTypes).length > 0 && !validTypes[provider.type]) continue
    const result = await callEh(
      EXT_HOST_TASK_NID,
      "$provideTasks",
      [provider.handle, validTypes],
      30000,
      { usesCancellationToken: true },
    )
    provider.provideCount += 1
    const providedTasks = Array.isArray(result?.tasks) ? result.tasks : []
    tasks.push(...providedTasks)
    emit?.("ext-host:task-provider-provide", {
      ...createProviderEvidence(provider),
      taskCount: providedTasks.length,
      tasks: providedTasks,
      extensionId: result?.extension?.identifier?.value || result?.extension?.identifier?.id || undefined,
    })
  }
  return tasks
}

async function resolveTaskForRegisteredProvider({ providers, callEh, task, emit }) {
  const type = getTaskType(task)
  if (!type) return undefined
  const provider = [...providers.values()].find((entry) => entry.type === type)
  if (!provider) return undefined
  const resolved = await callEh(
    EXT_HOST_TASK_NID,
    "$resolveTask",
    [provider.handle, task],
    30000,
    { usesCancellationToken: true },
  )
  provider.resolveCount += 1
  emit?.("ext-host:task-provider-resolve", {
    ...createProviderEvidence(provider),
    taskId: createTaskId(resolved || task),
    resolved: !!resolved,
  })
  return resolved
}

function buildValidTypes(providers, filter) {
  const requestedType = normalizeType(filter?.type)
  if (requestedType) return { [requestedType]: true }
  const validTypes = {}
  for (const provider of providers.values()) {
    validTypes[provider.type] = true
  }
  return validTypes
}

function createProviderEvidence(provider) {
  return {
    handle: provider.handle,
    type: provider.type,
    source: "MainThreadTask",
    vscodeSourcePath: "src/vs/workbench/api/browser/mainThreadTask.ts",
    currentSourcePath: "desktop/services/extensions-host/mainThread/mainThreadTask.js",
    registeredAt: provider.registeredAt,
    provideCount: provider.provideCount,
    resolveCount: provider.resolveCount,
    stateSource: "desktopExtensionHost/MainThreadTaskProviderRegistry",
    noSecondTaskState: true,
    runtimeReference: false,
  }
}

function createTaskId(task) {
  const stable = JSON.stringify({
    type: getTaskType(task),
    name: task?.name,
    label: task?.label,
    source: task?.source,
    definition: task?.definition,
    workspaceFolder: task?.workspaceFolder,
  })
  return `codek-extension-task-${crypto.createHash("sha1").update(stable).digest("hex").slice(0, 12)}`
}

function getTaskType(task) {
  return normalizeType(task?.definition?.type || task?.type)
}

function normalizeHandle(value) {
  const handle = Number(value)
  return Number.isInteger(handle) && handle >= 0 ? handle : undefined
}

function normalizeType(value) {
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

function sanitizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return { ...value }
}

module.exports = {
  MAIN_THREAD_TASK_NID,
  EXT_HOST_TASK_NID,
  register,
  _test: {
    buildValidTypes,
    createTaskId,
    fetchRegisteredProviderTasks,
    resolveTaskForRegisteredProvider,
  },
}
