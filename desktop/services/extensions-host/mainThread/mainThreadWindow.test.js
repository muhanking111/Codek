const assert = require("node:assert/strict")
const test = require("node:test")

const mainThreadWindow = require("./mainThreadWindow")

function createServer() {
  const handlers = new Map()
  return {
    handlers,
    onRpc(actorIdOrMethod, methodOrHandler, maybeHandler) {
      if (typeof actorIdOrMethod === "number") {
        handlers.set(`${actorIdOrMethod}:${methodOrHandler}`, maybeHandler)
        return
      }
      handlers.set(actorIdOrMethod, methodOrHandler)
    },
    callRpc(method, args) {
      const handler = handlers.get(`${mainThreadWindow.MAIN_THREAD_WINDOW_NID}:${method}`) || handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [])
    },
  }
}

test("MainThreadWindow exposes mutable VS Code-style window focus state", async () => {
  const server = createServer()
  let setState
  mainThreadWindow.register(server, {
    setExtHostWindowState: (fn) => { setState = fn },
  })

  setState({ isFocused: false, isActive: true })

  assert.deepEqual(await server.callRpc("$getInitialState", []), {
    isFocused: false,
    isActive: true,
  })
})

test("MainThreadWindow bridges openUri and asExternalUri through renderer-safe payloads", async () => {
  const server = createServer()
  const rendererEvents = []
  mainThreadWindow.register(server, {
    sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
  })

  const uri = { scheme: "https", authority: "example.com", path: "/docs" }
  assert.equal(await server.callRpc("$openUri", [uri, "https://example.com/docs", { allowTunneling: false }]), true)
  assert.deepEqual(await server.callRpc("$asExternalUri", [uri, {}]), uri)
  assert.equal(rendererEvents.at(-1).channel, "ext-host:window-open-uri")
  assert.deepEqual(rendererEvents.at(-1).payload.uri, uri)
})
