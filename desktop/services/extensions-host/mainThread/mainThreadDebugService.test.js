const assert = require("node:assert/strict")
const test = require("node:test")

const { ExtHostContext, MainContext } = require("../extHostServer")
const debugService = require("./mainThreadDebugService")

function createServer() {
  const handlers = new Map()
  return {
    handlers,
    onRpc(actorIdOrMethod, methodOrHandler, maybeHandler) {
      const key = typeof actorIdOrMethod === "number"
        ? `${actorIdOrMethod}:${methodOrHandler}`
        : actorIdOrMethod
      const handler = typeof actorIdOrMethod === "number" ? maybeHandler : methodOrHandler
      handlers.set(key, handler)
    },
    call(method, args) {
      const handler = handlers.get(`${MainContext.MainThreadDebugService}:${method}`) || handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [], { reqId: 1 })
    },
  }
}

test("MainThreadDebugService registers VS Code actor-specific handlers", () => {
  const server = createServer()
  debugService.register(server)

  assert.equal(server.handlers.has(`${MainContext.MainThreadDebugService}:$registerDebugTypes`), true)
  assert.equal(server.handlers.has(`${MainContext.MainThreadDebugService}:$startDebugging`), true)
  assert.equal(ExtHostContext.ExtHostDebugService, 89)
})

test("MainThreadDebugService records debug types and adapter factories", () => {
  debugService.resetDebugBridgeEvidenceForTests()
  const server = createServer()
  const snapshots = []
  debugService.register(server, { syncDebugState: (state) => snapshots.push(state) })

  server.call("$registerDebugTypes", [["pwa-node", "node"]])
  server.call("$registerDebugAdapterDescriptorFactory", ["pwa-node", 7])
  server.call("$registerDebugConfigurationProvider", ["pwa-node", 2, true, true, false, 3])

  const state = snapshots.at(-1)
  assert.deepEqual(state.debugTypes, ["node", "pwa-node"])
  assert.equal(state.adapterFactories[0].type, "pwa-node")
  assert.equal(state.adapterFactories[0].handle, 7)
  assert.equal(state.configurationProviders[0].hasProvide, true)
  assert.equal(debugService.hasAdapterFactory("pwa-node"), true)
  assert.equal(debugService.getAdapterFactory("pwa-node").handle, 7)
  assert.equal(state.debugBridgeEvidence.constraints.noSecondDebugState, true)
  assert.equal(state.debugBridgeEvidence.owners.callStack.status, "blocked")
})

test("MainThreadDebugService can create session DTOs for ExtHost debug calls", () => {
  const session = debugService.createSessionDto("pwa-node", {
    request: "launch",
    program: "D:/Workspace/app.js",
  }, {
    sessionId: "debug-1",
    rootDir: "D:/Workspace",
  })

  assert.equal(session.id, "debug-1")
  assert.equal(session.type, "pwa-node")
  assert.equal(session.configuration.program, "D:/Workspace/app.js")
  assert.equal(session.folderUri.scheme, "file")
  assert.equal(session.folderUri.path, "/D:/Workspace")
})

test("MainThreadDebugService records metadata-only DAP bridge evidence", () => {
  debugService.resetDebugBridgeEvidenceForTests()
  const server = createServer()
  const snapshots = []
  debugService.register(server, { syncDebugState: (state) => snapshots.push(state) })

  server.call("$acceptDAMessage", [7, { seq: 1, type: "event", event: "initialized", body: {} }])
  server.call("$acceptDAMessage", [7, {
    seq: 2,
    type: "request",
    command: "setBreakpoints",
    arguments: {
      source: { path: "D:/Workspace/secret-project/app.js" },
      breakpoints: [{ line: 9, condition: "token === 'secret'" }],
    },
  }])
  server.call("$acceptDAMessage", [7, { seq: 3, type: "response", request_seq: 2, command: "setBreakpoints", success: true, body: { breakpoints: [{ verified: true, line: 9 }] } }])
  server.call("$acceptDAMessage", [7, { seq: 31, type: "event", event: "breakpoint", body: { reason: "changed", breakpoint: { verified: true, line: 9 } } }])
  server.call("$acceptDAMessage", [7, { seq: 32, type: "request", command: "configurationDone", arguments: {} }])
  server.call("$acceptDAMessage", [7, { seq: 4, type: "event", event: "stopped", body: { reason: "breakpoint", threadId: 1 } }])
  server.call("$acceptDAMessage", [7, { seq: 5, type: "request", command: "threads", arguments: {} }])
  server.call("$acceptDAMessage", [7, { seq: 6, type: "request", command: "stackTrace", arguments: { threadId: 1, startFrame: 0, levels: 20 } }])
  server.call("$acceptDAMessage", [7, { seq: 7, type: "request", command: "scopes", arguments: { frameId: 11 } }])
  server.call("$acceptDAMessage", [7, { seq: 8, type: "request", command: "variables", arguments: { variablesReference: 100 } }])
  server.call("$acceptDAMessage", [7, { seq: 9, type: "request", command: "evaluate", arguments: { expression: "secretValue", context: "watch" } }])
  server.call("$acceptDAError", [7, "AdapterError", "secret failure detail", "stack trace"])
  server.call("$acceptDAExit", [7, 0, null])

  const evidence = debugService.getDebugBridgeEvidenceSummary()
  assert.equal(evidence.source, "mainThreadDebugService")
  assert.equal(evidence.owners.callStack.status, "available")
  assert.equal(evidence.owners.breakpoints.status, "available")
  assert.equal(evidence.owners.variablesWatch.status, "partial")
  assert.equal(evidence.constraints.metadataOnly, true)
  assert.equal(evidence.latest.errors[0].messageLength, "secret failure detail".length)
  assert.equal(JSON.stringify(evidence).includes("secret-project"), false)
  assert.equal(JSON.stringify(evidence).includes("secretValue"), false)
  assert.equal(snapshots.at(-1).debugBridgeEvidence.owners.callStack.status, "available")
})

test("MainThreadDebugService reports provideDebugAdapter bridge feasibility", async () => {
  const server = createServer()
  debugService.register(server)
  server.call("$registerDebugAdapterDescriptorFactory", ["codek-smoke-node", 31])

  const feasibility = debugService.getDebugAdapterBridgeFeasibility("codek-smoke-node", {
    rootDir: "D:/Workspace",
  })
  assert.equal(feasibility.factoryRegistered, true)
  assert.equal(feasibility.factoryHandle, 31)
  assert.equal(feasibility.extHostRpcId, ExtHostContext.ExtHostDebugService)
  assert.equal(feasibility.provideMethod, "$provideDebugAdapter")
  assert.equal(feasibility.descriptorTypes.server, "supported_via_desktop_dap_descriptor_transport")
  assert.equal(feasibility.descriptorTypes.pipeServer, "supported_via_desktop_dap_descriptor_transport")
  assert.equal(feasibility.blockedReasons.includes("missing_ext_host_rpc_call"), true)

  const rpcCalls = []
  const extHostServer = {
    call(rpcId, method, args, timeoutMs) {
      rpcCalls.push({ rpcId, method, args, timeoutMs })
      return Promise.resolve({ type: "pipeServer", path: "\\\\.\\pipe\\codek-js-debug" })
    },
  }
  const provided = await debugService.provideDebugAdapterDescriptor(extHostServer, "codek-smoke-node", {
    request: "launch",
    program: "D:/Workspace/app.js",
  }, {
    sessionId: "debug-bridge-1",
    rootDir: "D:/Workspace",
  })

  assert.equal(provided.status, "provided")
  assert.equal(provided.descriptor.type, "pipeServer")
  assert.equal(rpcCalls[0].rpcId, ExtHostContext.ExtHostDebugService)
  assert.equal(rpcCalls[0].method, "$provideDebugAdapter")
  assert.equal(rpcCalls[0].args[0], 31)
  assert.equal(rpcCalls[0].args[1].id, "debug-bridge-1")
  assert.equal(rpcCalls[0].args[1].configuration.program, "D:/Workspace/app.js")
})

test("MainThreadDebugService startDebugging requests adapter descriptor and starts desktop DAP", async () => {
  const server = createServer()
  const calls = []
  const dapStarts = []
  const snapshots = []
  debugService.register(server, {
    rootDir: "D:/Workspace",
    syncDebugState: (state) => snapshots.push(state),
    callEh: async (actorId, method, args, timeoutMs) => {
      calls.push({ actorId, method, args, timeoutMs })
      return { type: "server", host: "127.0.0.1", port: 4711 }
    },
    dapStart: (options) => {
      dapStarts.push(options)
      return { success: true, sessionId: "dap-1", message: "DAP adapter started" }
    },
  })

  server.call("$registerDebugAdapterDescriptorFactory", ["pwa-node", 7])
  const started = await server.call("$startDebugging", [undefined, {
    type: "pwa-node",
    request: "launch",
    name: "Launch Program",
    program: "D:/Workspace/app.js",
  }, { noDebug: false }])

  assert.equal(started, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].actorId, ExtHostContext.ExtHostDebugService)
  assert.equal(calls[0].method, "$provideDebugAdapter")
  assert.equal(calls[0].args[0], 7)
  assert.equal(calls[0].args[1].type, "pwa-node")
  assert.equal(calls[0].args[1].configuration.program, "D:/Workspace/app.js")
  assert.equal(dapStarts.length, 1)
  assert.deepEqual(dapStarts[0].debugAdapterDescriptor, { type: "server", host: "127.0.0.1", port: 4711 })
  assert.equal(dapStarts[0].adapterId, "pwa-node")
  assert.equal(dapStarts[0].workingDir, "D:/Workspace")
  assert.equal(dapStarts[0].config.program, "D:/Workspace/app.js")

  const state = debugService.makeDebugState()
  assert.equal(state.sessions.length, 1)
  assert.equal(state.sessions[0].dapSessionId, "dap-1")
  assert.deepEqual(state.sessions[0].debugAdapterDescriptor, { type: "server", host: "127.0.0.1", port: 4711 })
  assert.equal(snapshots.at(-1).focusedSessionId, state.sessions[0].id)
  assert.equal(snapshots.at(-1).debugConsole.stateSource, "mainThreadDebugService.sessions")
})

test("MainThreadDebugService appends extension debug console output to the focused session", async () => {
  const server = createServer()
  const rendererEvents = []
  const snapshots = []
  debugService.register(server, {
    rootDir: "D:/Workspace",
    syncDebugState: (state) => snapshots.push(state),
    sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
    callEh: async () => ({ type: "server", host: "127.0.0.1", port: 4711 }),
    dapStart: () => ({ success: true, sessionId: "dap-console-1" }),
  })

  server.call("$registerDebugAdapterDescriptorFactory", ["pwa-node", 11])
  await server.call("$startDebugging", [undefined, {
    type: "pwa-node",
    request: "launch",
    name: "Console Session",
  }, {}])
  server.call("$appendDebugConsole", ["extension console output\n"])

  const state = debugService.makeDebugState()
  const session = state.sessions.find((item) => item.name === "Console Session")
  assert.equal(session.debugConsoleOutput[0].text, "extension console output\n")
  assert.equal(session.debugConsoleOutput[0].type, "extension")
  assert.equal(session.debugConsoleOutput[0].valueLength, "extension console output\n".length)
  assert.deepEqual(session.debugConsoleAppendEvidence[0], {
    source: "MainThreadDebugService.$appendDebugConsole",
    vscodeSource: "src/vs/workbench/api/browser/mainThreadDebugService.ts#$appendDebugConsole",
    stateSource: "mainThreadDebugService.sessions.debugConsoleOutput",
    evidenceSafe: true,
    valueLength: "extension console output\n".length,
    result: "appended",
    reason: "",
  })
  assert.equal(state.debugConsole.entries[0].sessionId, session.id)
  assert.equal(JSON.stringify(session.debugConsoleAppendEvidence).includes("extension console output"), false)
  assert.equal(rendererEvents[0].channel, "ext-host:debug-console-append")
  assert.equal(snapshots.at(-1).debugConsole.entries.length, 1)
})

test("MainThreadDebugService reports blocked debug console append when no focused session exists", () => {
  const server = createServer()
  debugService.register(server)
  server.call("$stopDebugging", [])
  const evidence = debugService.appendDebugConsole("orphan output")

  assert.deepEqual(evidence, {
    source: "MainThreadDebugService.$appendDebugConsole",
    vscodeSource: "src/vs/workbench/api/browser/mainThreadDebugService.ts#$appendDebugConsole",
    stateSource: "mainThreadDebugService.sessions.debugConsoleOutput",
    evidenceSafe: true,
    valueLength: "orphan output".length,
    result: "blocked",
    reason: "missing_focused_debug_session",
  })
})

test("MainThreadDebugService propagates descriptor provider failures", async () => {
  const server = createServer()
  debugService.register(server, {
    callEh: async () => {
      throw new Error("descriptor timeout")
    },
    dapStart: () => {
      throw new Error("dapStart should not be called")
    },
  })

  server.call("$registerDebugAdapterDescriptorFactory", ["pwa-node", 9])
  await assert.rejects(
    server.call("$startDebugging", [undefined, { type: "pwa-node", request: "launch" }, {}]),
    /descriptor timeout/,
  )
})
