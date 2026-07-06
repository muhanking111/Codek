const assert = require("node:assert/strict")
const test = require("node:test")

const mainThreadTask = require("./mainThreadTask")
const { ExtHostContext, MainContext } = require("../extHostServer")

function createServer() {
  const handlers = new Map()
  const calls = []
  return {
    calls,
    handlers,
    onRpc(actorIdOrMethod, methodOrHandler, maybeHandler) {
      const key = typeof actorIdOrMethod === "number"
        ? `${actorIdOrMethod}:${methodOrHandler}`
        : actorIdOrMethod
      const handler = typeof actorIdOrMethod === "number" ? maybeHandler : methodOrHandler
      handlers.set(key, handler)
    },
    callRpc(method, args) {
      const actorKey = `${mainThreadTask.MAIN_THREAD_TASK_NID}:${method}`
      const handler = handlers.get(actorKey) || handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [])
    },
    call(nid, method, args, timeoutMs, options) {
      calls.push({ nid, method, args, timeoutMs, options })
      if (method === "$provideTasks") {
        return Promise.resolve({
          tasks: [{
            _id: "npm:build",
            name: "npm: build",
            source: "npm",
            definition: { type: "npm", script: "build" },
            execution: { process: "npm", args: ["run", "build"] },
          }],
          extension: { identifier: { value: "vscode.npm" } },
        })
      }
      if (method === "$resolveTask") {
        return Promise.resolve({
          _id: "npm:build:resolved",
          name: "npm: build",
          source: "npm",
          definition: { type: "npm", script: "build" },
          execution: { process: "npm", args: ["run", "build"] },
        })
      }
      return Promise.resolve(undefined)
    },
  }
}

test("MainThreadTask uses bundled VS Code MainContext and ExtHostContext actor ids", () => {
  assert.equal(mainThreadTask.MAIN_THREAD_TASK_NID, MainContext.MainThreadTask)
  assert.equal(mainThreadTask.EXT_HOST_TASK_NID, ExtHostContext.ExtHostTask)
})

test("MainThreadTask registers extension task providers and fetches tasks through ExtHostTask", async () => {
  const server = createServer()
  const rendererEvents = []
  const registry = mainThreadTask.register(server, {
    sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
  })

  await server.callRpc("$registerTaskProvider", [7, "npm"])
  const tasks = await server.callRpc("$fetchTasks", [{ type: "npm" }])

  assert.equal(registry.providers.size, 1)
  assert.equal(tasks.length, 1)
  assert.deepEqual(server.calls[0], {
    nid: mainThreadTask.EXT_HOST_TASK_NID,
    method: "$provideTasks",
    args: [7, { npm: true }],
    timeoutMs: 30000,
    options: { usesCancellationToken: true },
  })
  assert.deepEqual(rendererEvents.map((event) => event.channel), [
    "ext-host:task-provider-register",
    "ext-host:task-provider-provide",
  ])
  assert.equal(rendererEvents[0].payload.noSecondTaskState, true)
  assert.equal(rendererEvents[1].payload.taskCount, 1)
  assert.deepEqual(rendererEvents[1].payload.tasks, tasks)
})

test("MainThreadTask bridges $executeTask to renderer TaskWorkbenchAdapterService.runTask", async () => {
  const server = createServer()
  const rendererEvents = []
  mainThreadTask.register(server, {
    sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
  })

  await server.callRpc("$registerTaskProvider", [8, "npm"])
  const execution = await server.callRpc("$executeTask", [{
    name: "npm: build",
    definition: { type: "npm", script: "build" },
  }])

  assert.equal(server.calls[0].method, "$resolveTask")
  assert.equal(execution.task._id, "npm:build:resolved")
  assert.match(execution.id, /^codek-extension-task-/)
  assert.deepEqual(rendererEvents.map((event) => event.channel), [
    "ext-host:task-provider-register",
    "ext-host:task-provider-resolve",
    "ext-host:task-provider-execute",
  ])
  assert.equal(rendererEvents[2].payload.blocked, false)
  assert.equal(rendererEvents[2].payload.rendererTaskFacade, "TaskWorkbenchAdapterService.runTask")
  assert.equal(rendererEvents[2].payload.noSecondTaskState, true)
  assert.deepEqual(rendererEvents[2].payload.task, execution.task)
})

test("MainThreadTask keeps $executeTask blocked when renderer runTask bridge is unavailable", async () => {
  const server = createServer()
  const rendererEvents = []
  mainThreadTask.register(server, {
    rendererTaskExecutionBridge: false,
    sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
  })

  await server.callRpc("$registerTaskProvider", [8, "npm"])
  const execution = await server.callRpc("$executeTask", [{
    name: "npm: build",
    definition: { type: "npm", script: "build" },
  }])

  assert.equal(server.calls[0].method, "$resolveTask")
  assert.equal(execution.task._id, "npm:build:resolved")
  assert.deepEqual(rendererEvents.map((event) => event.channel), [
    "ext-host:task-provider-register",
    "ext-host:task-provider-resolve",
    "ext-host:task-provider-execute-blocked",
  ])
  assert.equal(rendererEvents[2].payload.blocked, true)
  assert.match(rendererEvents[2].payload.reason, /TaskWorkbenchAdapterService\.runTask bridge is unavailable/)
})

test("MainThreadTask unregisters providers and records supported execution evidence", async () => {
  const server = createServer()
  const rendererEvents = []
  const registry = mainThreadTask.register(server, {
    sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
  })

  await server.callRpc("$registerTaskProvider", [9, "typescript"])
  await server.callRpc("$registerSupportedExecutions", [true, true, false])
  await server.callRpc("$unregisterTaskProvider", [9])

  assert.equal(registry.providers.size, 0)
  assert.deepEqual(registry.supportedExecutions, {
    custom: true,
    shell: true,
    process: false,
  })
  assert.deepEqual(rendererEvents.map((event) => event.channel), [
    "ext-host:task-provider-register",
    "ext-host:task-supported-executions",
    "ext-host:task-provider-unregister",
  ])
})

test("MainThreadTask records registered TaskSystem without creating a second execution state", async () => {
  const server = createServer()
  const rendererEvents = []
  const registry = mainThreadTask.register(server, {
    sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
  })

  await server.callRpc("$registerTaskSystem", ["file", {
    scheme: "file",
    provider: "terminalTaskSystem",
    state: {
      activeTasks: 1,
    },
  }])

  assert.equal(registry.taskSystems.size, 1)
  assert.deepEqual(registry.taskSystems.get("file"), {
    scheme: "file",
    provider: "terminalTaskSystem",
    state: {
      activeTasks: 1,
    },
  })
  assert.deepEqual(rendererEvents, [{
    channel: "ext-host:task-system-register",
    payload: {
      scheme: "file",
      info: {
        scheme: "file",
        provider: "terminalTaskSystem",
        state: {
          activeTasks: 1,
        },
      },
      source: "MainThreadTask",
      stateSource: "desktopExtensionHost/MainThreadTaskSystemRegistry",
      vscodeSourcePath: "src/vs/workbench/api/browser/mainThreadTask.ts",
      currentSourcePath: "desktop/services/extensions-host/mainThread/mainThreadTask.js",
      noSecondTaskState: true,
      runtimeReference: false,
    },
  }])
})
