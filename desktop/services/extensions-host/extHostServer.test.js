const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildWorkspaceData,
  ExtHostContext,
  ExtensionHostServer,
  MainContext,
  decodeRpcMessage,
  makeFrame,
} = require("./extHostServer")

const HEADER_LEN = 13

function encodeMixedRequest(reqId, rpcId, method, args) {
  const methodBuf = Buffer.from(method, "utf8")
  const argParts = []
  for (const arg of args) {
    if (Buffer.isBuffer(arg)) {
      const part = Buffer.alloc(1 + 4 + arg.length)
      part[0] = 2
      part.writeUInt32BE(arg.length, 1)
      arg.copy(part, 5)
      argParts.push(part)
    } else if (arg === undefined) {
      argParts.push(Buffer.from([4]))
    } else {
      const jsonBuf = Buffer.from(JSON.stringify(arg), "utf8")
      const part = Buffer.alloc(1 + 4 + jsonBuf.length)
      part[0] = 1
      part.writeUInt32BE(jsonBuf.length, 1)
      jsonBuf.copy(part, 5)
      argParts.push(part)
    }
  }
  return Buffer.concat([
    Buffer.from([3]),
    Buffer.from([
      (reqId >>> 24) & 0xff,
      (reqId >>> 16) & 0xff,
      (reqId >>> 8) & 0xff,
      reqId & 0xff,
      rpcId,
      methodBuf.length,
    ]),
    methodBuf,
    Buffer.from([args.length]),
    ...argParts,
  ])
}

test("_initializeExtHostServices initializes configuration before workspace", async () => {
  const rootDir = path.join("D:\\", "Codek")
  const server = new ExtensionHostServer()
  const calls = []

  server._initData = { rootDir }
  server.call = async (rpcId, method, args, timeoutMs) => {
    calls.push({ rpcId, method, args, timeoutMs })
    return undefined
  }

  await server._initializeExtHostServices()

  assert.equal(calls.length, 2)
  assert.equal(calls[0].rpcId, ExtHostContext.ExtHostConfiguration)
  assert.equal(calls[0].method, "$initializeConfiguration")
  assert.equal(calls[0].timeoutMs, 10000)
  assert.equal(calls[0].args.length, 1)
  assert.ok(calls[0].args[0].defaults)

  assert.equal(calls[1].rpcId, ExtHostContext.ExtHostWorkspace)
  assert.equal(calls[1].method, "$initializeWorkspace")
  assert.equal(calls[1].timeoutMs, 10000)
  assert.equal(calls[1].args[1], true)
  assert.equal(calls[1].args[0].folders[0].uri.path, "/D:/Workspace")
  assert.equal(calls[1].args[0].folders[0].index, 0)
})

test("ExtHostContext constants match the bundled extension-host proxy identifiers", () => {
  const bundlePath = path.join(__dirname, "bundle", "extHost.bundle.mjs")
  const bundle = fs.readFileSync(bundlePath, "utf8")
  const proxyIds = new Map()
  const re = /createProxyIdentifier\("([^"]+)"\)/g
  let match
  let nid = 0
  while ((match = re.exec(bundle))) {
    nid += 1
    proxyIds.set(match[1], nid)
  }

  for (const [name, actual] of Object.entries(ExtHostContext)) {
    assert.equal(actual, proxyIds.get(name), `${name} nid should match extHost.bundle.mjs`)
  }
})

test("MainContext constants are one-based, unique, and match the bundled main-thread proxy identifiers", () => {
  const bundlePath = path.join(__dirname, "bundle", "extHost.bundle.mjs")
  const bundle = fs.readFileSync(bundlePath, "utf8")
  const proxyIdsByProperty = new Map()
  const re = /(\w+):\s*createProxyIdentifier\("([^"]+)"\)/g
  let match
  let nid = 0
  while ((match = re.exec(bundle))) {
    nid += 1
    proxyIdsByProperty.set(match[1], nid)
  }

  const seen = new Map()
  for (const [name, actual] of Object.entries(MainContext)) {
    assert.ok(actual > 0, `${name} nid should be one-based`)
    assert.equal(seen.has(actual), false, `${name} duplicates ${seen.get(actual)} nid ${actual}`)
    seen.set(actual, name)
    assert.equal(MainContext[name], proxyIdsByProperty.get(name), `${name} nid should match extHost.bundle.mjs`)
  }
})

test("buildWorkspaceData preserves multi-root workspace folders and workspace file metadata", () => {
  const workspaceData = buildWorkspaceData({
    rootDir: path.join("D:\\", "Codek"),
    workspaceRoots: [
      path.join("D:\\", "Codek"),
      path.join("D:\\", "Libraries"),
    ],
    workspaceFile: path.join("D:\\", "codek.code-workspace"),
  })

  assert.equal(workspaceData.transient, false)
  assert.equal(workspaceData.name, "codek")
  assert.equal(workspaceData.configuration.path, "/D:/codek.code-workspace")
  assert.deepEqual(workspaceData.folders.map((folder) => folder.name), ["Codek", "Libraries"])
  assert.equal(workspaceData.folders[1].index, 1)
})

test("decodeRpcMessage restores VS Code mixed args with VSBuffer payloads", () => {
  const content = Buffer.from("hello from extension", "utf8")
  const message = encodeMixedRequest(42, 95, "$writeFile", [
    { scheme: "file", path: "/D:/Workspace/a.txt" },
    content,
    undefined,
  ])

  const decoded = decodeRpcMessage(message)

  assert.equal(decoded.reqId, 42)
  assert.equal(decoded.rpcId, 95)
  assert.equal(decoded.method, "$writeFile")
  assert.deepEqual(decoded.args[0], { scheme: "file", path: "/D:/Workspace/a.txt" })
  assert.ok(Buffer.isBuffer(decoded.args[1]))
  assert.equal(decoded.args[1].toString("utf8"), "hello from extension")
  assert.equal(decoded.args[2], undefined)
})

test("sendReply serializes Buffer results as ReplyOKVSBuffer frames", () => {
  const server = new ExtensionHostServer()
  const frames = []
  server._running = true
  server._socket = { destroyed: false }
  server._msgId = 1
  server._lastReceivedId = 11
  server._writeBuffered = (frame) => frames.push(frame)

  server.sendReply(7, Buffer.from("workspace data", "utf8"))

  assert.equal(frames.length, 1)
  const body = frames[0].slice(HEADER_LEN)
  assert.equal(body[0], 8)
  assert.equal(body.readUInt32BE(1), 7)
  const len = body.readUInt32BE(5)
  assert.equal(len, "workspace data".length)
  assert.equal(body.slice(9, 9 + len).toString("utf8"), "workspace data")
})

test("sendReply serializes undefined results as ReplyOKEmpty frames", () => {
  const server = new ExtensionHostServer()
  const frames = []
  server._running = true
  server._socket = { destroyed: false }
  server._msgId = 1
  server._lastReceivedId = 11
  server._writeBuffered = (frame) => frames.push(frame)

  server.sendReply(9, undefined)

  assert.equal(frames.length, 1)
  const body = frames[0].slice(HEADER_LEN)
  assert.equal(body[0], 7)
  assert.equal(body.readUInt32BE(1), 9)
  assert.equal(body.length, 5)
})

test("_handleReply decodes ReplyOKVSBuffer responses", async () => {
  const server = new ExtensionHostServer()
  server._running = true
  server._socket = { destroyed: false }
  server._writeBuffered = (frame) => {
    const reqId = frame.slice(HEADER_LEN).readUInt32BE(1)
    const payload = Buffer.from("from extension", "utf8")
    const body = Buffer.alloc(1 + 4 + 4 + payload.length)
    body[0] = 8
    body.writeUInt32BE(reqId, 1)
    body.writeUInt32BE(payload.length, 5)
    payload.copy(body, 9)
    server._onFrame({
      type: 1,
      id: 2,
      ack: 1,
      data: body,
      dataLen: body.length,
    })
  }

  const result = await server.call(86, "$bufferEcho", [])

  assert.ok(Buffer.isBuffer(result))
  assert.equal(result.toString("utf8"), "from extension")
})

test("whenInstalledExtensionsRegistered resolves immediately after extensions are registered", async () => {
  const server = new ExtensionHostServer()
  server._running = true
  server._installedExtensionsRegistered = true

  await server.whenInstalledExtensionsRegistered()
})

test("whenInstalledExtensionsRegistered waits for ready before resolving", async () => {
  const server = new ExtensionHostServer()
  let resolved = false
  const pending = server.whenInstalledExtensionsRegistered().then(() => {
    resolved = true
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(resolved, false)

  server._running = true
  server._installedExtensionsRegistered = true
  server.emit("ready")
  await pending
  assert.equal(resolved, true)
})

test("stop drops stale batched writes before a restart can attach a new socket", async () => {
  const server = new ExtensionHostServer()
  const oldWrites = []
  const newWrites = []
  const oldSocket = {
    destroyed: false,
    write: (frame) => oldWrites.push(frame),
    end: () => {},
    destroy: () => {
      oldSocket.destroyed = true
    },
  }
  const newSocket = {
    destroyed: false,
    write: (frame) => newWrites.push(frame),
  }

  server._running = true
  server._socket = oldSocket
  server._writeBuffered(Buffer.from("stale-frame"))
  server.stop()
  server._socket = newSocket

  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(oldWrites.length, 1)
  assert.equal(newWrites.length, 0)
  assert.equal(server._writeBatch.length, 0)
  assert.equal(server._writeScheduled, false)
})

test("start resets protocol session state before reusing an ExtensionHostServer", async () => {
  const server = new ExtensionHostServer()
  let pendingTimeoutCleared = false
  server._socket = { stale: true }
  server._parser = () => {}
  server._msgId = 42
  server._lastReceivedId = 41
  server._callId = 7
  server._pendingCalls = {
    7: {
      timeout: {
        [Symbol.toPrimitive]: () => 0,
      },
    },
  }
  const originalClearTimeout = global.clearTimeout
  global.clearTimeout = (timeout) => {
    if (timeout === server._pendingCalls[7]?.timeout) pendingTimeoutCleared = true
    return originalClearTimeout(timeout)
  }
  server._writeBatch = [Buffer.from("stale")]
  server._writeScheduled = true
  server._createPipeServer = async () => {}
  server._spawnBundle = async () => {}
  server._performHandshake = async () => {}
  server._initializeExtHostServices = async () => {}

  try {
    await server.start({ rootDir: path.join("D:\\", "Codek") })
  } finally {
    global.clearTimeout = originalClearTimeout
  }

  assert.equal(pendingTimeoutCleared, true)
  assert.equal(server._socket, null)
  assert.equal(server._parser, null)
  assert.equal(server._msgId, 1)
  assert.equal(server._lastReceivedId, 0)
  assert.equal(server._callId, 0)
  assert.deepEqual(server._pendingCalls, {})
  assert.deepEqual(server._writeBatch, [])
  assert.equal(server._writeScheduled, false)
})

test("old extension-host process exit does not clear a restarted child process", async () => {
  const server = new ExtensionHostServer()
  const oldChild = new (require("node:events").EventEmitter)()
  const newChild = new (require("node:events").EventEmitter)()
  server._process = oldChild
  server._running = true

  oldChild.on("exit", (code) => {
    const isCurrentProcess = server._process === oldChild
    if (isCurrentProcess) {
      server._process = null
      server._running = false
    }
    if (isCurrentProcess && !server._stopping) {
      server.emit("exit", code)
    }
  })
  server._process = newChild
  oldChild.emit("exit", null)

  assert.equal(server._process, newChild)
  assert.equal(server._running, true)
})

test("_sendInitData scans an isolated extensionsDir when provided", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-host-root-"))
  const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-host-exts-"))
  const extensionDir = path.join(extensionsDir, "codek-smoke-memento")
  fs.mkdirSync(extensionDir, { recursive: true })
  fs.writeFileSync(path.join(extensionDir, "package.json"), `${JSON.stringify({
    name: "memento-storage-smoke",
    publisher: "codek-smoke",
    version: "1.0.0",
    engines: { vscode: "*" },
    activationEvents: ["onStartupFinished"],
    main: "./extension.js",
  })}\n`, "utf8")
  fs.writeFileSync(path.join(extensionDir, "extension.js"), "module.exports = { activate() {} }\n", "utf8")

  const server = new ExtensionHostServer()
  const frames = []
  server._initData = { rootDir, extensionsDir }
  server._msgId = 1
  server._lastReceivedId = 0
  server._writeBuffered = (frame) => frames.push(frame)

  server._sendInitData()

  assert.equal(frames.length, 1)
  const headerLength = 13
  const payload = JSON.parse(frames[0].slice(headerLength).toString("utf8"))
  const ids = payload.extensions.allExtensions.map((extension) => extension.id)
  assert.deepEqual(ids, ["codek-smoke.memento-storage-smoke"])
  assert.deepEqual(payload.extensions.activationEvents["codek-smoke.memento-storage-smoke"], ["onStartupFinished"])
})

test("_sendInitData omits extensions removed by VS Code dependency loop detection", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-host-root-"))
  const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-host-loop-exts-"))

  for (const manifest of [
    {
      dir: "codek.loop-a",
      name: "loop-a",
      publisher: "codek",
      extensionDependencies: ["codek.loop-b"],
      activationEvents: ["onCommand:loop.a"],
    },
    {
      dir: "codek.loop-b",
      name: "loop-b",
      publisher: "codek",
      extensionDependencies: ["codek.loop-a"],
      activationEvents: ["onCommand:loop.b"],
    },
    {
      dir: "codek.good",
      name: "good",
      publisher: "codek",
      activationEvents: ["onCommand:good.run"],
    },
  ]) {
    const extensionDir = path.join(extensionsDir, manifest.dir)
    fs.mkdirSync(extensionDir, { recursive: true })
    fs.writeFileSync(path.join(extensionDir, "package.json"), `${JSON.stringify({
      name: manifest.name,
      publisher: manifest.publisher,
      version: "1.0.0",
      engines: { vscode: "*" },
      main: "./extension.js",
      activationEvents: manifest.activationEvents,
      extensionDependencies: manifest.extensionDependencies,
    })}\n`, "utf8")
    fs.writeFileSync(path.join(extensionDir, "extension.js"), "module.exports = { activate() {} }\n", "utf8")
  }

  const server = new ExtensionHostServer()
  const frames = []
  server._initData = { rootDir, extensionsDir }
  server._msgId = 1
  server._lastReceivedId = 0
  server._writeBuffered = (frame) => frames.push(frame)

  server._sendInitData()

  assert.equal(frames.length, 1)
  const headerLength = 13
  const payload = JSON.parse(frames[0].slice(headerLength).toString("utf8"))
  assert.deepEqual(payload.extensions.allExtensions.map((extension) => extension.id), ["codek.good"])
  assert.deepEqual(payload.extensions.activationEvents["codek.good"], ["onCommand:good.run"])
  assert.equal(payload.extensions.activationEvents["codek.loop-a"], undefined)
  assert.deepEqual(payload.extensions.myExtensions, [{ value: "codek.good", _lower: "codek.good" }])
})

test("_handleRpcRequest prefers actor-specific handlers before legacy method handlers", () => {
  const server = new ExtensionHostServer()
  const replies = []
  server.sendReply = (reqId, value) => replies.push({ reqId, value })
  server.onRpc("$dispose", () => "legacy")
  server.onRpc(MainContext.MainThreadTreeViews, "$dispose", () => "tree")

  server._handleRpcRequest({
    reqId: 31,
    rpcId: MainContext.MainThreadTreeViews,
    method: "$dispose",
    args: [],
  })
  server._handleRpcRequest({
    reqId: 32,
    rpcId: MainContext.MainThreadQuickOpen,
    method: "$dispose",
    args: [],
  })

  assert.deepEqual(replies, [
    { reqId: 31, value: "tree" },
    { reqId: 32, value: "legacy" },
  ])
})

test("_handleRpcRequest emits evidence-safe RPC audit entries without raw argument values", () => {
  const audit = []
  const server = new ExtensionHostServer({
    auditApiInvocation: (entry) => audit.push(entry),
  })
  const replies = []
  server.sendReply = (reqId, value) => replies.push({ reqId, value })
  server.onRpc(MainContext.MainThreadCommands, "$executeCommand", () => "ok")

  server._handleRpcRequest({
    reqId: 41,
    rpcId: MainContext.MainThreadCommands,
    method: "$executeCommand",
    args: ["secret.command", { apiKey: "sk-test-secretvalue" }],
  })

  assert.deepEqual(replies, [{ reqId: 41, value: "ok" }])
  assert.equal(audit.length, 1)
  assert.equal(audit[0].action, "extensionHost.rpc")
  assert.equal(audit[0].metadata.actorId, MainContext.MainThreadCommands)
  assert.equal(audit[0].metadata.method, "$executeCommand")
  assert.deepEqual(audit[0].metadata.argShapes, ["string", "object"])
  assert.equal(JSON.stringify(audit).includes("secret.command"), false)
  assert.equal(JSON.stringify(audit).includes("sk-test"), false)
})

test("_handleRpcRequest records handler errors and propagates ReplyErrError", () => {
  const audit = []
  const errors = []
  const server = new ExtensionHostServer({
    auditApiInvocation: (entry) => audit.push(entry),
  })
  server.sendError = (reqId, err) => errors.push({ reqId, message: err.message })
  server.onRpc(MainContext.MainThreadCommands, "$explode", () => {
    throw new Error("boom sk-test-secretvalue")
  })

  server._handleRpcRequest({
    reqId: 42,
    rpcId: MainContext.MainThreadCommands,
    method: "$explode",
    args: [{ password: "secret" }],
  })

  assert.deepEqual(errors, [{ reqId: 42, message: "boom sk-test-secretvalue" }])
  assert.equal(audit.length, 1)
  assert.equal(audit[0].status, "failed")
  assert.equal(audit[0].metadata.errorHash.length, 16)
  assert.equal(JSON.stringify(audit).includes("sk-test"), false)
  assert.equal(JSON.stringify(audit).includes("password"), false)
})
