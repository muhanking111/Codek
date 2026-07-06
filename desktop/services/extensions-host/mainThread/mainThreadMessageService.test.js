const assert = require("node:assert/strict")
const { EventEmitter } = require("node:events")
const test = require("node:test")

const mainThreadMessageService = require("./mainThreadMessageService")

function createServer() {
  const handlers = new Map()
  return {
    handlers,
    onRpc(method, handler) {
      handlers.set(method, handler)
    },
    callRpc(method, args) {
      const handler = handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [])
    },
  }
}

test("MainThreadMessageService projects VS Code message commands and returns selected handle", async () => {
  const server = createServer()
  const rendererEvents = []
  mainThreadMessageService.register(server, {
    sendToRenderer: (channel, payload) => {
      rendererEvents.push({ channel, payload })
      return 42
    },
  })

  const result = await server.callRpc("$showMessage", [
    1,
    "Pick an action",
    { modal: true, detail: "details" },
    [
      { title: "Run", handle: 42, isCloseAffordance: false },
      { title: "Cancel", handle: 7, isCloseAffordance: true },
    ],
  ])

  assert.equal(result, 42)
  assert.equal(rendererEvents.length, 1)
  assert.equal(rendererEvents[0].channel, "ext-host:message")
  assert.equal(rendererEvents[0].payload.severity, "info")
  assert.deepEqual(rendererEvents[0].payload.commands.map((command) => command.handle), [42, 7])
  assert.equal(rendererEvents[0].payload.options.modal, true)
})

test("MainThreadMessageService waits for renderer selected message handle", async () => {
  const server = createServer()
  const ipcMain = new EventEmitter()
  const rendererEvents = []
  mainThreadMessageService.register(server, {
    ipcMain,
    sendToRenderer: (channel, payload) => {
      rendererEvents.push({ channel, payload })
      setImmediate(() => ipcMain.emit("ext-host:message-result", {}, {
        requestId: payload.requestId,
        handle: 7,
      }))
    },
  })

  const result = await server.callRpc("$showMessage", [
    2,
    "Pick an action",
    {},
    [
      { title: "Retry", handle: 1, isCloseAffordance: false },
      { title: "Dismiss", handle: 7, isCloseAffordance: true },
    ],
  ])

  assert.equal(result, 7)
  assert.equal(rendererEvents[0].channel, "ext-host:message")
  assert.match(rendererEvents[0].payload.requestId, /^message-/)
})

test("MainThreadMessageService does not wait for renderer response when message has no commands", async () => {
  const server = createServer()
  const ipcMain = new EventEmitter()
  const rendererEvents = []
  mainThreadMessageService.register(server, {
    ipcMain,
    sendToRenderer: (channel, payload) => {
      rendererEvents.push({ channel, payload })
    },
  })

  const result = await server.callRpc("$showMessage", [1, "No action", {}, []])

  assert.equal(result, undefined)
  assert.equal(rendererEvents[0].channel, "ext-host:message")
  assert.deepEqual(rendererEvents[0].payload.commands, [])
})

test("MainThreadMessageService falls back to close affordance when renderer has no selection", async () => {
  const server = createServer()
  mainThreadMessageService.register(server)

  const result = await server.callRpc("$showMessage", [
    2,
    "No renderer",
    {},
    [
      { title: "Retry", handle: 1, isCloseAffordance: false },
      { title: "Dismiss", handle: 9, isCloseAffordance: true },
    ],
  ])

  assert.equal(result, undefined)
})
