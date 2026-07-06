const assert = require("node:assert/strict")
const test = require("node:test")

const mainThreadAuthentication = require("./mainThreadAuthentication")

function createServer() {
  const handlers = new Map()
  const calls = []
  return {
    handlers,
    calls,
    onRpc(method, handler) {
      handlers.set(method, handler)
    },
    async call(rpcId, method, args, timeoutMs) {
      calls.push({ rpcId, method, args, timeoutMs })
      if (method === "$createSession") {
        return {
          id: "created-session",
          account: { id: "created-account", label: "Created Account" },
          scopes: args[1],
          accessToken: "created-token",
        }
      }
      if (method === "$getSessions") return []
      return undefined
    },
    callRpc(method, args) {
      const handler = handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [])
    },
  }
}

test("MainThreadAuthentication registers providers and bridges create/get session calls to ExtHostAuthentication", async () => {
  mainThreadAuthentication.clearAuthenticationProviders()
  const server = createServer()
  mainThreadAuthentication.register(server)

  await server.callRpc("$registerAuthenticationProvider", [{
    id: "codek-auth",
    label: "Codek Auth",
    supportsMultipleAccounts: true,
  }])

  const created = await server.callRpc("$getSession", [
    "codek-auth",
    ["profile"],
    "publisher.consumer",
    "Consumer Extension",
    { createIfNone: true },
  ])

  assert.equal(created.id, "created-session")
  assert.equal(created.accessToken, "created-token")
  assert.deepEqual(server.calls, [{
    rpcId: mainThreadAuthentication.EXT_HOST_AUTHENTICATION_NID,
    method: "$createSession",
    args: ["codek-auth", ["profile"], { createIfNone: true }],
    timeoutMs: 30000,
  }])
  assert.deepEqual(await server.callRpc("$getAccounts", ["codek-auth"]), [{
    id: "created-account",
    label: "Created Account",
  }])
})

test("MainThreadAuthentication activates provider contributions before getSession", async () => {
  mainThreadAuthentication.clearAuthenticationProviders()
  const server = createServer()
  mainThreadAuthentication.register(server)

  await server.callRpc("$ensureProvider", ["github"])

  assert.deepEqual(server.calls, [{
    rpcId: mainThreadAuthentication.EXT_HOST_EXTENSION_SERVICE_NID,
    method: "$activateByEvent",
    args: ["onAuthenticationRequest:github", mainThreadAuthentication.ActivationKind.Immediate],
    timeoutMs: 30000,
  }])
})

test("MainThreadAuthentication sends session change notifications to ExtHostAuthentication", async () => {
  mainThreadAuthentication.clearAuthenticationProviders()
  const server = createServer()
  mainThreadAuthentication.register(server)
  await server.callRpc("$registerAuthenticationProvider", [{
    id: "codek-auth",
    label: "Codek Auth",
  }])

  await server.callRpc("$sendDidChangeSessions", ["codek-auth", {
    added: [],
    removed: [],
    changed: [],
  }])
  await server.callRpc("$unregisterAuthenticationProvider", ["codek-auth"])

  assert.deepEqual(server.calls, [
    {
      rpcId: mainThreadAuthentication.EXT_HOST_AUTHENTICATION_NID,
      method: "$onDidChangeAuthenticationSessions",
      args: ["codek-auth", "Codek Auth"],
      timeoutMs: 30000,
    },
    {
      rpcId: mainThreadAuthentication.EXT_HOST_AUTHENTICATION_NID,
      method: "$onDidUnregisterAuthenticationProvider",
      args: ["codek-auth"],
      timeoutMs: 30000,
    },
  ])
})
