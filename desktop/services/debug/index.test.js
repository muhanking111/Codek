const test = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const net = require("node:net")
const os = require("node:os")
const path = require("node:path")

const debug = require("./index")
const workspaceTrust = require("../workspaceTrust")

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function waitForEvent(events, predicate, timeoutMs = 1000) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const found = events.find(predicate)
      if (found) {
        clearInterval(timer)
        resolve(found)
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer)
        reject(new Error("Timed out waiting for DAP event"))
      }
    }, 10)
  })
}

function writeFramedDapMessage(socket, message) {
  const body = Buffer.from(JSON.stringify(message), "utf8")
  socket.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]))
}

function attachInitializeOnlyDapServer(socket) {
  let buffer = Buffer.alloc(0)
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n")
      if (headerEnd < 0) return
      const header = buffer.slice(0, headerEnd).toString("utf8")
      const match = /Content-Length:\s*(\d+)/i.exec(header)
      if (!match) return
      const length = Number(match[1])
      if (buffer.length < headerEnd + 4 + length) return
      const body = buffer.slice(headerEnd + 4, headerEnd + 4 + length).toString("utf8")
      buffer = buffer.slice(headerEnd + 4 + length)
      const request = JSON.parse(body)
      writeFramedDapMessage(socket, {
        seq: 1,
        type: "response",
        request_seq: request.seq,
        command: request.command,
        success: true,
        body: { adapterID: request.arguments?.adapterID || "fake" },
      })
    }
  })
}

function listen(server, ...args) {
  return new Promise((resolve, reject) => {
    server.once("listening", resolve)
    server.once("error", reject)
    server.listen(...args)
  })
}

test("debug output returns incremental chunks and running lifecycle", async () => {
  const command = process.platform === "win32" ? "cmd /c echo alpha" : "printf alpha"

  const started = debug.start({ command, workingDir: process.cwd(), confirmed: true })
  assert.equal(started.success, true)
  assert.ok(started.sessionId)

  await wait(120)
  const first = debug.getOutput(started.sessionId, 0)
  assert.equal(first.success, true)
  assert.match(first.output, /alpha/)
  assert.equal(typeof first.offset, "number")

  const second = debug.getOutput(started.sessionId, first.offset)
  assert.equal(second.success, true)
  assert.equal(second.output, "")
  assert.equal(second.offset, first.offset)

  await wait(120)
  const finalOutput = debug.getOutput(started.sessionId, second.offset)
  assert.equal(finalOutput.success, true)
  assert.equal(finalOutput.running, false)
  debug.stop(started.sessionId)
})

test("debug output reports missing session without throwing", () => {
  const output = debug.getOutput("missing-session", 0)
  assert.equal(output.success, false)
  assert.equal(output.output, "")
  assert.equal(output.running, false)
  assert.equal(output.message, "Session not found")
})

test("dapStart returns structured adapter error when adapter is missing", () => {
  const started = debug.dapStart({
    adapterId: "node",
    workingDir: process.cwd(),
    jsDebugPath: path.join(process.cwd(), "missing-debugServer.js"),
  })

  assert.equal(started.success, false)
  assert.equal(started.sessionId, "")
  assert.equal(started.adapter.adapterType, "node")
  assert.equal(started.adapter.available, false)
})

test("dapStart resolves explicit adapter path from nested launch config", () => {
  const missingAdapterPath = path.join(process.cwd(), "missing-nested-debugServer.js")
  const started = debug.dapStart({
    adapterId: "node",
    workingDir: process.cwd(),
    config: {
      jsDebugPath: missingAdapterPath,
    },
  })

  assert.equal(started.success, false)
  assert.equal(started.sessionId, "")
  assert.equal(started.adapter.adapterType, "node")
  assert.equal(started.adapter.available, false)
  assert.equal(started.adapter.adapterPath, missingAdapterPath)
  assert.equal(started.adapter.remediation.resolvedPath, missingAdapterPath)
})

test("dapStart passes env to custom adapter process", async () => {
  const script = path.join(os.tmpdir(), `codek-dap-env-${Date.now()}.js`)
  fs.writeFileSync(script, [
    "const body = JSON.stringify({seq:1,type:'event',event:'output',body:{output:process.env.CODEK_DAP_ENV_TEST || ''}})",
    "process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\\r\\n\\r\\n${body}`)",
    "setTimeout(() => process.exit(0), 80)",
  ].join("\n"), "utf8")

  const events = []
  const off = debug.onDapEvent("event", (event) => events.push(event))
  const started = debug.dapStart({
    command: process.execPath,
    args: [script],
    workingDir: process.cwd(),
    env: { CODEK_DAP_ENV_TEST: "env-ok" },
    adapterId: "custom",
    confirmed: true,
  })

  assert.equal(started.success, true)
  await wait(160)
  off()
  debug.dapStop(started.sessionId)

  assert.equal(events.some((event) => event.body?.output === "env-ok"), true)
})

test("dapStart connects DebugAdapterServer descriptor to existing DAP parser", async () => {
  const server = net.createServer(attachInitializeOnlyDapServer)
  await listen(server, 0, "127.0.0.1")
  const address = server.address()
  const started = debug.dapStart({
    adapterId: "fake-server",
    debugAdapterDescriptor: {
      type: "server",
      port: address.port,
      host: "127.0.0.1",
    },
  })
  assert.equal(started.success, true)
  try {
    const initialize = await debug.dapRequest(started.sessionId, "initialize", { adapterID: "fake-server" })
    assert.equal(initialize.command, "initialize")
    assert.equal(initialize.body.adapterID, "fake-server")
    assert.equal(debug.dapListSessions().find((session) => session.sessionId === started.sessionId).transport, "server")
  } finally {
    debug.dapStop(started.sessionId)
    await new Promise((resolve) => server.close(resolve))
  }
})

test("dapStart connects DebugAdapterNamedPipeServer descriptor to existing DAP parser", async () => {
  const pipeName = `codek-dap-${process.pid}-${crypto.randomBytes(6).toString("hex")}`
  const pipePath = process.platform === "win32"
    ? path.join("\\\\.\\pipe\\", pipeName)
    : path.join(os.tmpdir(), pipeName)
  const server = net.createServer(attachInitializeOnlyDapServer)
  await listen(server, pipePath)
  const started = debug.dapStart({
    adapterId: "fake-pipe",
    debugAdapterDescriptor: {
      type: "pipeServer",
      path: pipePath,
    },
  })
  assert.equal(started.success, true)
  try {
    const initialize = await debug.dapRequest(started.sessionId, "initialize", { adapterID: "fake-pipe" })
    assert.equal(initialize.command, "initialize")
    assert.equal(initialize.body.adapterID, "fake-pipe")
    assert.equal(debug.dapListSessions().find((session) => session.sessionId === started.sessionId).transport, "pipeServer")
  } finally {
    debug.dapStop(started.sessionId)
    await new Promise((resolve) => server.close(resolve))
  }
})

test("custom DAP adapter fixture covers breakpoints, stepping, stack, variables, and console output", async () => {
  debug.resetDapEvidenceForTests()
  const script = path.join(os.tmpdir(), `codek-dap-fixture-${Date.now()}.js`)
  fs.writeFileSync(script, [
    "let buffer = Buffer.alloc(0)",
    "let nextSeq = 1",
    "function send(message) {",
    "  const body = Buffer.from(JSON.stringify(message), 'utf8')",
    "  process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\\r\\n\\r\\n`, 'ascii'), body]))",
    "}",
    "function response(request, body) { send({ seq: nextSeq++, type: 'response', request_seq: request.seq, command: request.command, success: true, body: body || {} }) }",
    "function event(event, body) { send({ seq: nextSeq++, type: 'event', event, body: body || {} }) }",
    "function handle(request) {",
    "  if (request.command === 'initialize') { response(request, { supportsConfigurationDoneRequest: true, supportsStepBack: false }); event('initialized'); return }",
    "  if (request.command === 'launch') { response(request); event('output', { category: 'console', output: 'fixture launched' }); return }",
    "  if (request.command === 'setBreakpoints') { response(request, { breakpoints: [{ verified: true, line: 3 }] }); return }",
    "  if (request.command === 'configurationDone') { response(request); event('stopped', { reason: 'breakpoint', threadId: 1 }); return }",
    "  if (request.command === 'threads') { response(request, { threads: [{ id: 1, name: 'main' }] }); return }",
    "  if (request.command === 'stackTrace') { response(request, { stackFrames: [{ id: 11, name: 'main', line: 3, column: 1, source: { path: 'fixture.js' } }], totalFrames: 1 }); return }",
    "  if (request.command === 'scopes') { response(request, { scopes: [{ name: 'Locals', variablesReference: 100, expensive: false }] }); return }",
    "  if (request.command === 'variables') { response(request, { variables: [{ name: 'answer', value: '42', type: 'number', variablesReference: 0 }] }); return }",
    "  if (request.command === 'continue') { response(request, { allThreadsContinued: true }); event('continued', { threadId: 1 }); return }",
    "  if (request.command === 'next' || request.command === 'stepIn' || request.command === 'stepOut') { response(request); event('stopped', { reason: 'step', threadId: 1 }); return }",
    "  if (request.command === 'evaluate') { response(request, { result: '42', variablesReference: 0 }); return }",
    "  if (request.command === 'disconnect') { response(request); process.exit(0); return }",
    "  response(request)",
    "}",
    "process.stdin.on('data', (chunk) => {",
    "  buffer = Buffer.concat([buffer, chunk])",
    "  while (true) {",
    "    const headerEnd = buffer.indexOf('\\r\\n\\r\\n')",
    "    if (headerEnd < 0) return",
    "    const header = buffer.slice(0, headerEnd).toString('utf8')",
    "    const match = /Content-Length:\\s*(\\d+)/i.exec(header)",
    "    if (!match) return",
    "    const length = Number(match[1])",
    "    if (buffer.length < headerEnd + 4 + length) return",
    "    const body = buffer.slice(headerEnd + 4, headerEnd + 4 + length).toString('utf8')",
    "    buffer = buffer.slice(headerEnd + 4 + length)",
    "    handle(JSON.parse(body))",
    "  }",
    "})",
  ].join("\n"), "utf8")

  const events = []
  const off = debug.onDapEvent("event", (event) => events.push(event))
  const started = debug.dapStart({
    command: process.execPath,
    args: [script],
    workingDir: process.cwd(),
    adapterId: "fixture",
    confirmed: true,
  })
  assert.equal(started.success, true)

  try {
    const initialize = await debug.dapRequest(started.sessionId, "initialize", { adapterID: "fixture" })
    assert.equal(initialize.body.supportsConfigurationDoneRequest, true)
    await waitForEvent(events, (event) => event.event === "initialized")

    await debug.dapRequest(started.sessionId, "launch", { program: "fixture.js" })
    await waitForEvent(events, (event) => event.event === "output" && event.body?.output === "fixture launched")

    const breakpoints = await debug.dapRequest(started.sessionId, "setBreakpoints", {
      source: { path: "fixture.js" },
      breakpoints: [{ line: 3 }],
    })
    assert.equal(breakpoints.body.breakpoints[0].verified, true)

    await debug.dapRequest(started.sessionId, "configurationDone")
    await waitForEvent(events, (event) => event.event === "stopped" && event.body?.reason === "breakpoint")

    const threads = await debug.dapRequest(started.sessionId, "threads")
    assert.equal(threads.body.threads[0].name, "main")
    const stack = await debug.dapRequest(started.sessionId, "stackTrace", { threadId: 1 })
    assert.equal(stack.body.stackFrames[0].name, "main")
    const scopes = await debug.dapRequest(started.sessionId, "scopes", { frameId: 11 })
    assert.equal(scopes.body.scopes[0].name, "Locals")
    const variables = await debug.dapRequest(started.sessionId, "variables", { variablesReference: 100 })
    assert.equal(variables.body.variables[0].value, "42")

    const continued = await debug.dapRequest(started.sessionId, "continue", { threadId: 1 })
    assert.equal(continued.body.allThreadsContinued, true)
    await waitForEvent(events, (event) => event.event === "continued")
    await debug.dapRequest(started.sessionId, "next", { threadId: 1 })
    await debug.dapRequest(started.sessionId, "stepIn", { threadId: 1 })
    await debug.dapRequest(started.sessionId, "stepOut", { threadId: 1 })
    const evaluated = await debug.dapRequest(started.sessionId, "evaluate", { expression: "answer" })
    assert.equal(evaluated.body.result, "42")
    assert.equal(events.filter((event) => event.event === "stopped" && event.body?.reason === "step").length >= 3, true)

    const evidence = debug.getDapEvidenceSummary()
    assert.equal(evidence.constraints.noSecondDebugState, true)
    assert.equal(evidence.constraints.metadataOnly, true)
    assert.equal(evidence.owners.callStack.status, "available")
    assert.equal(evidence.owners.breakpoints.status, "available")
    assert.equal(evidence.owners.variablesWatch.status, "available")
    assert.equal(evidence.owners.executionControl.status, "partial")
    assert.equal(evidence.latest.requests.some((entry) => entry.command === "stackTrace" && entry.metadata.threadId === 1), true)
    assert.equal(evidence.latest.requests.some((entry) => entry.command === "setBreakpoints" && entry.metadata.breakpointCount === 1), true)
    assert.equal(evidence.latest.responses.some((entry) => entry.command === "variables" && entry.metadata.variableCount === 1), true)
    assert.equal(evidence.latest.requests.some((entry) => entry.command === "evaluate" && entry.metadata.expressionLength === "answer".length), true)
    assert.equal(JSON.stringify(evidence).includes("fixture.js"), false)
    assert.equal(JSON.stringify(evidence).includes("answer"), false)
  } finally {
    off()
    await debug.dapRequest(started.sessionId, "disconnect").catch(() => null)
    debug.dapStop(started.sessionId)
  }
})

test("dap service exposes evidence-safe session lifecycle snapshot", async () => {
  debug.resetDapEvidenceForTests()
  const script = path.join(os.tmpdir(), `codek-dap-snapshot-${Date.now()}.js`)
  fs.writeFileSync(script, [
    "setTimeout(() => process.exit(0), 1000)",
  ].join("\n"), "utf8")

  const started = debug.dapStart({
    command: process.execPath,
    args: [script, "--token", "raw-secret-value"],
    workingDir: process.cwd(),
    adapterId: "snapshot",
    confirmed: true,
  })
  assert.equal(started.success, true)

  const snapshot = debug.getDapServiceContractSnapshot()
  try {
    assert.equal(snapshot.source, "desktopDebugService")
    assert.equal(snapshot.serviceId, "debugService")
    assert.deepEqual(snapshot.vscodeServiceIds, ["IDebugAdapter", "IDebugAdapterDescriptorFactory"])
    assert.equal(snapshot.stateSource, "dapSessions")
    assert.equal(snapshot.constraints.noSecondDapState, true)
    assert.equal(snapshot.constraints.evidenceSafeActions, true)
    assert.equal(snapshot.sessions.some((session) => session.sessionId === started.sessionId), true)
    assert.deepEqual(snapshot.sessions.find((session) => session.sessionId === started.sessionId), {
      sessionId: started.sessionId,
      adapterId: "snapshot",
      status: "running",
      startedAt: snapshot.sessions.find((session) => session.sessionId === started.sessionId).startedAt,
      exitCode: null,
      pendingRequestCount: 0,
      stderrLength: 0,
      commandLabel: path.basename(process.execPath),
      transport: "stdio",
    })
    assert.equal(JSON.stringify(snapshot).includes("raw-secret-value"), false)
    assert.equal(JSON.stringify(snapshot).includes(script), false)
    assert.equal(snapshot.evidence.source, "desktopDebugService")
    assert.equal(snapshot.evidence.owners.callStack.status, "blocked")
    assert.equal(snapshot.evidence.owners.breakpoints.status, "blocked")
    assert.equal(snapshot.evidence.owners.variablesWatch.status, "blocked")
    assert.equal(snapshot.evidence.constraints.preservesDapBehavior, true)
  } finally {
    debug.dapStop(started.sessionId)
  }
})

test("restricted workspace blocks debug process and dap adapter startup", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-restricted-debug-"))
  workspaceTrust.setWorkspaceTrust(root, { status: "restricted" })

  const processStart = debug.start({
    command: process.platform === "win32" ? "cmd /c echo blocked" : "printf blocked",
    workingDir: root,
    confirmed: true,
  })
  assert.equal(processStart.success, false)
  assert.equal(processStart.code, "workspace_trust_restricted")

  const dapStart = debug.dapStart({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 1000)"],
    workingDir: root,
    adapterId: "custom",
    confirmed: true,
  })
  assert.equal(dapStart.success, false)
  assert.equal(dapStart.code, "workspace_trust_restricted")
})

test("unknown workspace requires confirmation before debug process startup", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-unknown-debug-"))

  const processStart = debug.start({
    command: process.platform === "win32" ? "cmd /c echo prompt" : "printf prompt",
    workingDir: root,
  })
  assert.equal(processStart.success, false)
  assert.equal(processStart.code, "workspace_trust_confirmation_required")

  const dapStart = debug.dapStart({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 1000)"],
    workingDir: root,
    adapterId: "custom",
  })
  assert.equal(dapStart.success, false)
  assert.equal(dapStart.code, "workspace_trust_confirmation_required")
})
