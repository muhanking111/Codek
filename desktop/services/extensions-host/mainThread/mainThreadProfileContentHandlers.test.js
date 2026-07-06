const assert = require("node:assert/strict")
const test = require("node:test")

const mainThreadProfileContentHandlers = require("./mainThreadProfileContentHandlers")

function createServer() {
  const handlers = new Map()
  const events = new Map()
  return {
    handlers,
    onRpc(method, handler) {
      handlers.set(method, handler)
    },
    on(event, handler) {
      const listeners = events.get(event) || []
      listeners.push(handler)
      events.set(event, listeners)
    },
    emit(event) {
      for (const listener of events.get(event) || []) listener()
    },
    call(method, args) {
      const handler = handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [], { reqId: 1 })
    },
  }
}

test.afterEach(() => {
  mainThreadProfileContentHandlers.clearProfileContentHandlers()
})

test("MainThreadProfileContentHandlers targets the VS Code ExtHostProfileContentHandlers actor", () => {
  assert.equal(mainThreadProfileContentHandlers.EXT_HOST_PROFILE_CONTENT_HANDLERS_NID, 129)
})

test("MainThreadProfileContentHandlers registers extension handlers", () => {
  const server = createServer()
  mainThreadProfileContentHandlers.register(server, { callEh: async () => undefined })

  server.call("$registerProfileContentHandler", ["cloud", "Cloud Profiles", "Remote profile store", "publisher.cloud"])

  assert.deepEqual(mainThreadProfileContentHandlers.listProfileContentHandlers(), [{
    id: "cloud",
    name: "Cloud Profiles",
    description: "Remote profile store",
    extensionId: "publisher.cloud",
  }])
})

test("MainThreadProfileContentHandlers rejects duplicate handler ids", () => {
  const server = createServer()
  mainThreadProfileContentHandlers.register(server, { callEh: async () => undefined })

  server.call("$registerProfileContentHandler", ["cloud", "Cloud Profiles", undefined, "publisher.cloud"])

  assert.throws(
    () => server.call("$registerProfileContentHandler", ["cloud", "Cloud Profiles", undefined, "publisher.cloud"]),
    /already registered/,
  )
})

test("remote profile content handler reads and saves through ExtHostProfileContentHandlers", async () => {
  const server = createServer()
  const calls = []
  mainThreadProfileContentHandlers.register(server, {
    callEh: async (...args) => {
      calls.push(args)
      if (args[1] === "$readProfile") {
        return JSON.stringify({ name: "Cloud Work", settings: "{}" })
      }
      return { id: "cloud:work", filePath: "cloud:work", bytesWritten: 64 }
    },
    timeoutMs: 4321,
  })

  server.call("$registerProfileContentHandler", ["cloud", "Cloud Profiles", undefined, "publisher.cloud"])
  const content = await mainThreadProfileContentHandlers.readProfileContent("cloud", "cloud:work")
  const saved = await mainThreadProfileContentHandlers.saveProfileContent("cloud", "Cloud Work", content)

  assert.equal(content, JSON.stringify({ name: "Cloud Work", settings: "{}" }))
  assert.deepEqual(saved, { id: "cloud:work", filePath: "cloud:work", link: undefined, bytesWritten: 64 })
  assert.deepEqual(calls, [
    [
      mainThreadProfileContentHandlers.EXT_HOST_PROFILE_CONTENT_HANDLERS_NID,
      "$readProfile",
      ["cloud", "cloud:work", { isCancellationRequested: false }],
      4321,
    ],
    [
      mainThreadProfileContentHandlers.EXT_HOST_PROFILE_CONTENT_HANDLERS_NID,
      "$saveProfile",
      ["cloud", "Cloud Work", content, { isCancellationRequested: false }],
      4321,
    ],
  ])
})

test("MainThreadProfileContentHandlers unregisters and clears on EH stop", () => {
  const server = createServer()
  mainThreadProfileContentHandlers.register(server, { callEh: async () => undefined })

  server.call("$registerProfileContentHandler", ["cloud", "Cloud Profiles", undefined, "publisher.cloud"])
  assert.equal(mainThreadProfileContentHandlers.listProfileContentHandlers().length, 1)

  server.call("$unregisterProfileContentHandler", ["cloud"])
  assert.deepEqual(mainThreadProfileContentHandlers.listProfileContentHandlers(), [])

  server.call("$registerProfileContentHandler", ["cloud", "Cloud Profiles", undefined, "publisher.cloud"])
  server.emit("stopped")
  assert.deepEqual(mainThreadProfileContentHandlers.listProfileContentHandlers(), [])
})
