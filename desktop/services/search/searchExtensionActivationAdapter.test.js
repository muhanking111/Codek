const assert = require("node:assert/strict")
const test = require("node:test")

const {
  ActivationKind,
  EXT_HOST_EXTENSION_SERVICE_NID,
  createExtensionHostSearchActivationAdapter,
  createNoopSearchExtensionActivationAdapter,
  searchActivationEvents,
} = require("./searchExtensionActivationAdapter")

test("searchActivationEvents mirrors VS Code onSearch scheme activation order", () => {
  assert.deepEqual(searchActivationEvents(["file"]), ["onSearch:file"])
  assert.deepEqual(searchActivationEvents(["codek", "file", "codek"]), ["onSearch:codek", "onSearch:file"])
  assert.deepEqual(searchActivationEvents([]), ["onSearch:file"])
})

test("createExtensionHostSearchActivationAdapter calls ExtHostExtensionService $activateByEvent", async () => {
  const calls = []
  const host = { isRunning: true }
  const activate = createExtensionHostSearchActivationAdapter({
    getHost: () => host,
    callEh: async (...args) => {
      calls.push(args)
    },
    timeoutMs: 1234,
  })

  await activate({ schemes: ["codek"] })

  assert.deepEqual(calls, [
    [host, EXT_HOST_EXTENSION_SERVICE_NID, "$activateByEvent", ["onSearch:codek", ActivationKind.Normal], 1234],
    [host, EXT_HOST_EXTENSION_SERVICE_NID, "$activateByEvent", ["onSearch:file", ActivationKind.Normal], 1234],
  ])
})

test("createExtensionHostSearchActivationAdapter waits for installed extensions after activation", async () => {
  const calls = []
  const host = {
    isRunning: true,
    whenInstalledExtensionsRegistered: async () => {
      calls.push(["wait"])
    },
  }
  const activate = createExtensionHostSearchActivationAdapter({
    getHost: () => host,
    callEh: async (...args) => {
      calls.push(args)
    },
  })

  await activate({ schemes: ["codek"] })

  assert.deepEqual(calls, [
    [host, EXT_HOST_EXTENSION_SERVICE_NID, "$activateByEvent", ["onSearch:codek", ActivationKind.Normal], 30000],
    [host, EXT_HOST_EXTENSION_SERVICE_NID, "$activateByEvent", ["onSearch:file", ActivationKind.Normal], 30000],
    ["wait"],
  ])
})

test("createExtensionHostSearchActivationAdapter is a no-op when extension host is not running", async () => {
  let callCount = 0
  const activate = createExtensionHostSearchActivationAdapter({
    getHost: () => ({ isRunning: false }),
    callEh: async () => {
      callCount += 1
    },
  })

  await activate({ schemes: ["file"] })

  assert.equal(callCount, 0)
})

test("createExtensionHostSearchActivationAdapter rejects cancellation before calling EH", async () => {
  let callCount = 0
  const controller = new AbortController()
  controller.abort()
  const activate = createExtensionHostSearchActivationAdapter({
    getHost: () => ({ isRunning: true }),
    callEh: async () => {
      callCount += 1
    },
  })

  await assert.rejects(
    activate({ schemes: ["file"], signal: controller.signal }),
    { name: "AbortError" },
  )
  assert.equal(callCount, 0)
})

test("createNoopSearchExtensionActivationAdapter preserves explicit no-op injection", async () => {
  await createNoopSearchExtensionActivationAdapter()({ schemes: ["file"] })
})
