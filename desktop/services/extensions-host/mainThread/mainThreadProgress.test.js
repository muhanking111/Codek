const assert = require("node:assert/strict")
const test = require("node:test")

const mainThreadProgress = require("./mainThreadProgress")
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
      const handler = handlers.get(`${mainThreadProgress.MAIN_THREAD_PROGRESS_NID}:${method}`) || handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [])
    },
    call(nid, method, args, timeoutMs) {
      calls.push({ nid, method, args, timeoutMs })
      return Promise.resolve(undefined)
    },
  }
}

test("MainThreadProgress uses bundled VS Code MainContext and ExtHostContext actor ids", () => {
  assert.equal(mainThreadProgress.MAIN_THREAD_PROGRESS_NID, MainContext.MainThreadProgress)
  assert.equal(mainThreadProgress.EXT_HOST_PROGRESS_NID, ExtHostContext.ExtHostProgress)
})

function createIpcMain() {
  const listeners = new Map()
  return {
    listeners,
    on(channel, handler) {
      listeners.set(channel, handler)
    },
    emitPayload(channel, payload) {
      const handler = listeners.get(channel)
      assert.equal(typeof handler, "function", `missing listener ${channel}`)
      handler({}, payload)
    },
  }
}

test("MainThreadProgress projects VS Code progress lifecycle to renderer events", () => {
  const server = createServer()
  const rendererEvents = []
  mainThreadProgress.register(server, {
    sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
  })

  server.callRpc("$startProgress", [7, { location: 10, title: "Build", cancellable: true, source: "Tests" }, "ms.test"])
  server.callRpc("$progressReport", [7, { message: "running", increment: 1 }])
  server.callRpc("$progressEnd", [7])

  assert.deepEqual(rendererEvents, [
    {
      channel: "ext-host:progress-start",
      payload: {
        handle: 7,
        location: 10,
        title: "Build",
        source: "Tests",
        cancellable: true,
        cancellableLabel: undefined,
        buttons: [],
        secondaryActions: [],
        extensionId: "ms.test",
        ownerEvidence: mainThreadProgress.buildProgressBridgeOwnerEvidence(),
      },
    },
    {
      channel: "ext-host:progress-report",
      payload: {
        handle: 7,
        message: { message: "running", increment: 1 },
        ownerEvidence: mainThreadProgress.buildProgressBridgeOwnerEvidence(),
      },
    },
    {
      channel: "ext-host:progress-end",
      payload: { handle: 7, ownerEvidence: mainThreadProgress.buildProgressBridgeOwnerEvidence() },
    },
  ])
})

test("MainThreadProgress forwards notification buttons/actions and bridges cancel back to ExtHostProgress", async () => {
  const server = createServer()
  const ipcMain = createIpcMain()
  const rendererEvents = []
  mainThreadProgress.register(server, {
    ipcMain,
    sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
  })

  server.callRpc("$startProgress", [
    9,
    {
      location: 15,
      title: "Authenticate",
      cancellable: "Stop",
      buttons: ["Use Browser"],
      secondaryActions: [{ id: "custom.details", label: "Details" }],
    },
    "ms.auth",
  ])
  ipcMain.emitPayload("ext-host:progress-cancel", { handle: 9, choice: 0 })
  await Promise.resolve()

  assert.deepEqual(rendererEvents, [
    {
      channel: "ext-host:progress-start",
      payload: {
        handle: 9,
        location: 15,
        title: "Authenticate",
        source: undefined,
        cancellable: true,
        cancellableLabel: "Stop",
        buttons: ["Use Browser"],
        secondaryActions: [
          { id: "custom.details", label: "Details" },
          {
            id: "workbench.extensions.manage",
            label: "Manage Extension",
            command: "_extensions.manage",
            args: ["ms.auth"],
            keepOpen: true,
          },
        ],
        extensionId: "ms.auth",
        ownerEvidence: mainThreadProgress.buildProgressBridgeOwnerEvidence(),
      },
    },
  ])
  assert.deepEqual(server.calls, [
    {
      nid: mainThreadProgress.EXT_HOST_PROGRESS_NID,
      method: "$acceptProgressCanceled",
      args: [9, 0],
      timeoutMs: 30000,
    },
  ])
})

test("MainThreadProgress owner evidence points to the shared renderer progress service", () => {
  assert.deepEqual(mainThreadProgress.buildProgressBridgeOwnerEvidence(), {
    owner: "MainThreadProgress",
    status: "connected",
    stateSource: "ExtHostProgressShape -> ext-host:progress-* renderer events",
    rendererStateSource: "workbenchStatusNotificationProgressService.progressTasks",
    notificationStateSource: "workbenchStatusNotificationProgressService.notifications",
    noSecondProgressState: true,
    vscodeSource: "src/vs/platform/progress/common/progress.ts",
    cancelBridge: "ext-host:progress-cancel -> ExtHostProgress.$acceptProgressCanceled",
  })
})
