const assert = require("node:assert/strict")
const test = require("node:test")

const mainThreadCommands = require("./mainThreadCommands")

function createServer() {
  const handlers = new Map()
  const calls = []
  return {
    handlers,
    calls,
    onRpc(actorIdOrMethod, methodOrHandler, maybeHandler) {
      if (typeof actorIdOrMethod === "number") {
        handlers.set(`${actorIdOrMethod}:${methodOrHandler}`, maybeHandler)
        return
      }
      handlers.set(actorIdOrMethod, methodOrHandler)
    },
    async call(rpcId, method, args, timeoutMs) {
      calls.push({ rpcId, method, args, timeoutMs })
      return `${method}:ok`
    },
    callRpc(method, args) {
      const handler = handlers.get(`${mainThreadCommands.MAIN_THREAD_COMMANDS_NID}:${method}`) || handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [], { reqId: 7 })
    },
  }
}

test("MainThreadCommands registers, lists, and unregisters VS Code contributed commands", async () => {
  mainThreadCommands.clearRegisteredCommands()
  const server = createServer()
  mainThreadCommands.register(server)

  server.callRpc("$registerCommand", ["codek.sample.run", "Sample command"])
  server.callRpc("$registerCommand", ["_codek.internal", "Internal command"])

  assert.deepEqual(await server.callRpc("$getCommands", []), ["codek.sample.run", "_codek.internal"])
  assert.deepEqual(await mainThreadCommands.listRegisteredCommands({ includeInternal: false }), [{
    id: "codek.sample.run",
    description: "Sample command",
  }])

  server.callRpc("$unregisterCommand", ["codek.sample.run"])

  assert.deepEqual(await server.callRpc("$getCommands", []), ["_codek.internal"])
})

test("MainThreadCommands unwraps SerializableObjectWithBuffers and strips non-clone-safe payload", async () => {
  mainThreadCommands.clearRegisteredCommands()
  const server = createServer()
  mainThreadCommands.register(server)

  const circular = { label: "loop", run() {} }
  circular.self = circular
  const result = await server.callRpc("$executeCommand", [
    "codek.sample.clone",
    { value: [Buffer.from("abc", "utf8"), circular] },
    false,
  ])

  assert.equal(result, "$executeContributedCommand:ok")
  assert.deepEqual(server.calls.at(-1), {
    rpcId: mainThreadCommands.EXT_HOST_COMMANDS_NID,
    method: "$executeContributedCommand",
    args: [
      "codek.sample.clone",
      { type: "Buffer", data: [97, 98, 99] },
      { label: "loop", self: undefined },
    ],
    timeoutMs: 30000,
  })
})

test("MainThreadCommands fires onCommand activation through ExtHostExtensionService", async () => {
  mainThreadCommands.clearRegisteredCommands()
  const server = createServer()
  mainThreadCommands.register(server)

  await server.callRpc("$fireCommandActivationEvent", ["codek.sample.run"])

  assert.deepEqual(server.calls, [{
    rpcId: mainThreadCommands.EXT_HOST_EXTENSION_SERVICE_NID,
    method: "$activateByEvent",
    args: ["onCommand:codek.sample.run", mainThreadCommands.ActivationKind.Normal],
    timeoutMs: 30000,
  }])
})

test("MainThreadCommands executes contributed command through ExtHostCommands after activation retry", async () => {
  mainThreadCommands.clearRegisteredCommands()
  const server = createServer()
  mainThreadCommands.register(server)

  const result = await server.callRpc("$executeCommand", ["codek.sample.run", ["arg-a", 2], true])

  assert.equal(result, "$executeContributedCommand:ok")
  assert.deepEqual(server.calls, [
    {
      rpcId: mainThreadCommands.EXT_HOST_EXTENSION_SERVICE_NID,
      method: "$activateByEvent",
      args: ["onCommand:codek.sample.run", mainThreadCommands.ActivationKind.Normal],
      timeoutMs: 30000,
    },
    {
      rpcId: mainThreadCommands.EXT_HOST_COMMANDS_NID,
      method: "$executeContributedCommand",
      args: ["codek.sample.run", "arg-a", 2],
      timeoutMs: 30000,
    },
  ])
})
