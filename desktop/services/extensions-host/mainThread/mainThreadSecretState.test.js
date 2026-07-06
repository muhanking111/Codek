const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

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
      return undefined
    },
    callRpc(method, args) {
      const handler = handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [])
    },
  }
}

function loadSecretState() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-secrets-"))
  process.env.CODEK_DATA = tempDir
  const modulePath = path.resolve(__dirname, "mainThreadSecretState.js")
  delete require.cache[modulePath]
  return {
    tempDir,
    secretState: require(modulePath),
  }
}

test("MainThreadSecretState stores, lists, and deletes extension-scoped secrets", async () => {
  const { secretState } = loadSecretState()
  const server = createServer()
  secretState.register(server)

  await server.callRpc("$setPassword", ["publisher.one", "token", "secret-one"])
  await server.callRpc("$setPassword", ["publisher.two", "token", "secret-two"])

  assert.equal(await server.callRpc("$getPassword", ["publisher.one", "token"]), "secret-one")
  assert.equal(await server.callRpc("$getPassword", ["publisher.two", "token"]), "secret-two")
  assert.deepEqual(await server.callRpc("$getKeys", ["publisher.one"]), ["token"])

  await server.callRpc("$deletePassword", ["publisher.one", "token"])

  assert.equal(await server.callRpc("$getPassword", ["publisher.one", "token"]), undefined)
  assert.deepEqual(await server.callRpc("$getKeys", ["publisher.one"]), [])
})

test("MainThreadSecretState persists encrypted values without leaking plaintext", async () => {
  const { tempDir, secretState } = loadSecretState()
  const server = createServer()
  secretState.register(server)

  await server.callRpc("$setPassword", ["publisher.secure", "apiKey", "plaintext-secret"])

  const raw = fs.readFileSync(path.join(tempDir, "extension-secrets.json"), "utf8")
  assert.equal(raw.includes("plaintext-secret"), false)
  assert.equal(await server.callRpc("$getPassword", ["publisher.secure", "apiKey"]), "plaintext-secret")
})

test("MainThreadSecretState notifies ExtHostSecretState when a password changes", async () => {
  const { secretState } = loadSecretState()
  const server = createServer()
  secretState.register(server)

  await server.callRpc("$setPassword", ["publisher.one", "token", "secret-one"])
  await server.callRpc("$deletePassword", ["publisher.one", "token"])

  assert.deepEqual(server.calls, [
    {
      rpcId: secretState.EXT_HOST_SECRET_STATE_NID,
      method: "$onDidChangePassword",
      args: [{ extensionId: "publisher.one", key: "token" }],
      timeoutMs: 30000,
    },
    {
      rpcId: secretState.EXT_HOST_SECRET_STATE_NID,
      method: "$onDidChangePassword",
      args: [{ extensionId: "publisher.one", key: "token" }],
      timeoutMs: 30000,
    },
  ])
})
