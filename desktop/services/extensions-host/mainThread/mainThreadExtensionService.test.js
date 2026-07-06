const assert = require("node:assert/strict")
const test = require("node:test")

const mainThreadExtensionService = require("./mainThreadExtensionService")

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
      const handler = handlers.get(`${mainThreadExtensionService.MAIN_THREAD_EXTENSION_SERVICE_NID}:${method}`) || handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [])
    },
  }
}

test("MainThreadExtensionService tracks activation lifecycle on actor-specific RPC methods", () => {
  const server = createServer()
  const audit = []

  mainThreadExtensionService.resetLifecycleState()
  mainThreadExtensionService.register(server, {
    auditApiInvocation: (entry) => audit.push(entry),
  })

  assert.equal(typeof server.handlers.get(`${mainThreadExtensionService.MAIN_THREAD_EXTENSION_SERVICE_NID}:$onWillActivateExtension`), "function")

  server.callRpc("$onWillActivateExtension", [{ value: "sample.publisher" }])
  assert.deepEqual(mainThreadExtensionService.getLifecycleState().activating, ["sample.publisher"])

  server.callRpc("$onDidActivateExtension", [{ value: "sample.publisher" }])
  assert.deepEqual(mainThreadExtensionService.getLifecycleState().activated, ["sample.publisher"])
  assert.deepEqual(mainThreadExtensionService.getLifecycleState().activating, [])
  assert.equal(audit.at(-1).action, "extensionHost.lifecycle.didActivate")
  assert.equal(audit.at(-1).extensionId, "sample.publisher")
})

test("MainThreadExtensionService records activation and runtime errors without leaking raw stacks", () => {
  const server = createServer()
  const audit = []

  mainThreadExtensionService.resetLifecycleState()
  mainThreadExtensionService.register(server, {
    auditApiInvocation: (entry) => audit.push(entry),
  })

  server.callRpc("$onExtensionActivationError", [
    { value: "bad.extension" },
    { message: "failed with token sk-test-secretvalue", stack: "secret stack" },
  ])
  server.callRpc("$onExtensionRuntimeError", [
    { value: "bad.extension" },
    { message: "runtime exploded" },
  ])

  const state = mainThreadExtensionService.getLifecycleState()
  assert.equal(state.activationErrors[0].id, "bad.extension")
  assert.match(state.activationErrors[0].message, /\[redacted\]/)
  assert.equal(state.runtimeErrors[0].message, "runtime exploded")
  assert.deepEqual(audit.map((entry) => entry.action), [
    "extensionHost.lifecycle.activationError",
    "extensionHost.lifecycle.runtimeError",
  ])
  assert.equal(audit[0].status, "failed")
  assert.equal(audit[0].metadata.errorHash.length, 16)
})
