const assert = require("node:assert/strict")
const { EventEmitter } = require("node:events")
const test = require("node:test")

const mainThreadQuickOpen = require("./mainThreadQuickOpen")

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

test("MainThreadQuickOpen projects quick pick contents and returns selected handles", async () => {
  const server = createServer()
  const ipcMain = new EventEmitter()
  const rendererEvents = []
  mainThreadQuickOpen.register(server, {
    ipcMain,
    sendToRenderer: (channel, payload) => {
      rendererEvents.push({ channel, payload })
      if (channel === "ext-host:quickpick-show") {
        setImmediate(() => ipcMain.emit("ext-host:quickpick-result", {}, {
          instance: payload.instance,
          result: [2],
        }))
      }
    },
  })

  const pickPromise = server.callRpc("$show", [11, { canPickMany: true, placeHolder: "Pick" }])
  await server.callRpc("$setItems", [11, [
    { handle: 1, label: "One" },
    { handle: 2, label: "Two" },
  ]])

  assert.deepEqual(await pickPromise, [2])
  assert.equal(rendererEvents[0].channel, "ext-host:quickpick-show")
  assert.equal(rendererEvents[0].payload.options.placeHolder, "Pick")
  assert.deepEqual(rendererEvents[1].payload.items.map((item) => item.handle), [1, 2])
})

test("MainThreadQuickOpen projects input boxes with validateInput flag", async () => {
  const server = createServer()
  const ipcMain = new EventEmitter()
  const rendererEvents = []
  mainThreadQuickOpen.register(server, {
    ipcMain,
    sendToRenderer: (channel, payload) => {
      rendererEvents.push({ channel, payload })
      if (channel === "ext-host:input-show") {
        setImmediate(() => ipcMain.emit("ext-host:input-result", {}, {
          instanceId: payload.instanceId,
          value: "typed value",
        }))
      }
    },
  })

  const result = await server.callRpc("$input", [{ prompt: "Name", value: "initial" }, true])

  assert.equal(result, "typed value")
  assert.equal(rendererEvents[0].channel, "ext-host:input-show")
  assert.equal(rendererEvents[0].payload.options.prompt, "Name")
  assert.equal(rendererEvents[0].payload.validateInput, true)
})
