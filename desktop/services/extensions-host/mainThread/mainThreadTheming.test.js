const assert = require("node:assert/strict")
const test = require("node:test")

const theming = require("./mainThreadTheming")

function createServer() {
  const handlers = new Map()
  return {
    handlers,
    onRpc(method, handler) {
      handlers.set(method, handler)
    },
  }
}

test("MainThreadTheming projects color and file icon theme changes through configuration bridge", () => {
  const server = createServer()
  const rendererMessages = []
  const updates = []
  theming.register(server, {
    sendToRenderer(channel, payload) {
      rendererMessages.push({ channel, payload })
    },
    updateConfiguration(key, value, target) {
      updates.push({ key, value, target })
    },
  })

  server.handlers.get("$setColorTheme")(["Default Light Modern", 2])
  server.handlers.get("$setFileIconTheme")(["minimal", 2])

  assert.deepEqual(updates, [
    { key: "workbench.colorTheme", value: "Default Light Modern", target: 2 },
    { key: "workbench.iconTheme", value: "minimal", target: 2 },
  ])
  assert.deepEqual(rendererMessages, [
    { channel: "ext-host:theme", payload: { theme: "Default Light Modern" } },
    { channel: "ext-host:fileIconTheme", payload: { iconTheme: "minimal" } },
  ])
})
