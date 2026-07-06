const crypto = require("crypto")
const { spawn } = require("child_process")
const { EventEmitter } = require("events")
const net = require("net")
const path = require("path")
const { evaluateCommandExecution } = require("../workspaceTrust")
const {
  buildDebugAdapterHealth,
  readLatestDebugAdapterHealth,
  resolveAdapter,
  saveDebugAdapterHealth,
} = require("./adapterHealth")

const OUTPUT_BUFFER_CAPACITY = 64 * 1024

const sessions = new Map()
const dapSessions = new Map()
const dapEmitter = new EventEmitter()
const DAP_EVIDENCE_LIMIT = 80

const DAP_OWNER_PATHS = {
  callStack: {
    capability: "callStack",
    vscodeOwner: "RawDebugSession.stackTrace + DebugSession.fetchThreads/refreshTopOfCallstack",
    requiredRequests: ["threads", "stackTrace"],
    requiredEvents: ["stopped"],
  },
  breakpoints: {
    capability: "breakpoints",
    vscodeOwner: "DebugSession.sendBreakpoints + RawDebugSession.setBreakpoints/configurationDone",
    requiredRequests: ["setBreakpoints", "configurationDone"],
    requiredEvents: ["initialized"],
  },
  variablesWatch: {
    capability: "variables/watch",
    vscodeOwner: "StackFrame.getScopes + ExpressionContainer.fetchVariables + RawDebugSession.evaluate",
    requiredRequests: ["scopes", "variables", "evaluate"],
    requiredEvents: ["stopped"],
  },
  executionControl: {
    capability: "executionControl",
    vscodeOwner: "RawDebugSession.continue/next/stepIn/stepOut/terminate/disconnect",
    requiredRequests: ["continue", "next", "stepIn", "stepOut", "terminate"],
    requiredEvents: ["continued", "terminated"],
  },
}

const dapEvidence = {
  requests: [],
  responses: [],
  events: [],
  reverseRequests: [],
  exits: [],
  errors: [],
}

function start({ command, workingDir, confirmed }) {
  if (!command || !command.trim()) {
    return { success: false, message: "command is required", sessionId: "" }
  }
  const trustDecision = evaluateCommandExecution(workingDir || process.cwd(), command, {
    action: "启动调试进程",
    confirmed: confirmed === true,
  })
  if (!trustDecision.allowed) {
    return {
      success: false,
      message: trustDecision.message,
      sessionId: "",
      code: trustDecision.code,
      workspaceTrust: trustDecision.status,
    }
  }
  const sessionId = crypto.randomUUID()
  try {
    const parts = command.trim().split(/\s+/)
    const child = spawn(parts[0], parts.slice(1), {
      cwd: workingDir || process.cwd(),
      shell: false,
      windowsHide: true,
    })
    const state = {
      child,
      command,
      startedAt: Date.now(),
      buffer: "",
    }
    const append = (chunk) => {
      const s = chunk.toString("utf8")
      if (state.buffer.length + s.length > OUTPUT_BUFFER_CAPACITY) {
        state.buffer = state.buffer.slice(state.buffer.length / 4)
      }
      state.buffer += s
    }
    child.stdout.on("data", append)
    child.stderr.on("data", append)
    child.on("exit", () => { state.exited = true })
    sessions.set(sessionId, state)
    return { success: true, message: "Process started", sessionId }
  } catch (e) {
    return { success: false, message: "Failed to start process: " + e.message, sessionId }
  }
}

function input(sessionId, text) {
  const state = sessions.get(sessionId)
  if (!state || state.exited) {
    return { success: false, message: "Session not found or process terminated", sessionId }
  }
  try {
    state.child.stdin.write(text + "\n")
    return { success: true, message: "Input sent", sessionId }
  } catch (e) {
    return { success: false, message: "Failed to send input: " + e.message, sessionId }
  }
}

function stop(sessionId) {
  const state = sessions.get(sessionId)
  sessions.delete(sessionId)
  if (!state) return { success: false, message: "Session not found", sessionId }
  try { state.child.kill("SIGKILL") } catch {}
  return { success: true, message: "Process stopped", sessionId }
}

function getOutput(sessionId, offset = 0) {
  const state = sessions.get(sessionId)
  if (!state) {
    return {
      success: false,
      output: "",
      offset: 0,
      running: false,
      message: "Session not found",
    }
  }
  const start = Math.max(0, Math.min(Number(offset) || 0, state.buffer.length))
  return {
    success: true,
    output: state.buffer.slice(start),
    offset: state.buffer.length,
    running: !state.exited,
  }
}

function listSessions() {
  const out = []
  for (const [id, s] of sessions.entries()) {
    out.push({
      sessionId: id,
      command: s.command,
      status: s.exited ? "terminated" : "running",
      startedAt: s.startedAt,
    })
  }
  return out
}

function pushEvidence(list, entry) {
  list.push({
    timestamp: Date.now(),
    ...entry,
  })
  if (list.length > DAP_EVIDENCE_LIMIT) {
    list.splice(0, list.length - DAP_EVIDENCE_LIMIT)
  }
}

function summarizeDapArguments(command, args = {}) {
  if (!args || typeof args !== "object") return {}
  if (command === "stackTrace") {
    return {
      threadId: args.threadId,
      startFrame: args.startFrame,
      levels: args.levels,
    }
  }
  if (command === "setBreakpoints") {
    return {
      sourcePathPresent: Boolean(args.source?.path),
      breakpointCount: Array.isArray(args.breakpoints) ? args.breakpoints.length : 0,
    }
  }
  if (command === "scopes") return { frameId: args.frameId }
  if (command === "variables") {
    return {
      variablesReference: args.variablesReference,
      filter: args.filter,
      start: args.start,
      count: args.count,
    }
  }
  if (command === "evaluate") {
    return {
      context: args.context,
      expressionLength: typeof args.expression === "string" ? args.expression.length : 0,
      frameId: args.frameId,
    }
  }
  if (["continue", "next", "stepIn", "stepOut", "pause", "terminate"].includes(command)) {
    return {
      threadId: args.threadId,
      restart: args.restart,
    }
  }
  if (command === "configurationDone" || command === "disconnect") return {}
  return {
    argumentKeys: Object.keys(args).sort(),
  }
}

function summarizeDapResponse(command, body = {}) {
  if (!body || typeof body !== "object") return {}
  if (command === "threads") {
    return { threadCount: Array.isArray(body.threads) ? body.threads.length : 0 }
  }
  if (command === "stackTrace") {
    return {
      frameCount: Array.isArray(body.stackFrames) ? body.stackFrames.length : 0,
      totalFrames: body.totalFrames,
    }
  }
  if (command === "setBreakpoints") {
    const breakpoints = Array.isArray(body.breakpoints) ? body.breakpoints : []
    return {
      breakpointCount: breakpoints.length,
      verifiedCount: breakpoints.filter((bp) => bp?.verified === true).length,
    }
  }
  if (command === "scopes") {
    return { scopeCount: Array.isArray(body.scopes) ? body.scopes.length : 0 }
  }
  if (command === "variables") {
    return { variableCount: Array.isArray(body.variables) ? body.variables.length : 0 }
  }
  if (command === "evaluate") {
    return {
      resultLength: typeof body.result === "string" ? body.result.length : 0,
      variablesReference: body.variablesReference,
    }
  }
  if (command === "continue") {
    return { allThreadsContinued: body.allThreadsContinued }
  }
  return {
    bodyKeys: Object.keys(body).sort(),
  }
}

function summarizeDapEvent(event, body = {}) {
  if (!body || typeof body !== "object") return {}
  if (event === "stopped") {
    return {
      reason: body.reason,
      threadId: body.threadId,
      hitBreakpointCount: Array.isArray(body.hitBreakpointIds) ? body.hitBreakpointIds.length : 0,
    }
  }
  if (event === "thread") return { reason: body.reason, threadId: body.threadId }
  if (event === "breakpoint") {
    return {
      reason: body.reason,
      verified: body.breakpoint?.verified,
      line: body.breakpoint?.line,
      sourcePathPresent: Boolean(body.breakpoint?.source?.path),
    }
  }
  if (event === "continued") return { threadId: body.threadId, allThreadsContinued: body.allThreadsContinued }
  if (event === "terminated") return { restart: Boolean(body.restart) }
  if (event === "output") {
    return {
      category: body.category,
      outputLength: typeof body.output === "string" ? body.output.length : 0,
    }
  }
  if (event === "invalidated") {
    return { areas: Array.isArray(body.areas) ? body.areas.slice().sort() : undefined }
  }
  return {
    bodyKeys: Object.keys(body).sort(),
  }
}

function recordDapRequest(sessionId, message) {
  pushEvidence(dapEvidence.requests, {
    sessionId,
    seq: message.seq,
    command: message.command,
    metadata: summarizeDapArguments(message.command, message.arguments),
  })
}

function recordDapResponse(sessionId, message) {
  pushEvidence(dapEvidence.responses, {
    sessionId,
    seq: message.seq,
    requestSeq: message.request_seq,
    command: message.command,
    success: message.success === true,
    metadata: summarizeDapResponse(message.command, message.body),
  })
}

function recordDapEvent(sessionId, event, body) {
  pushEvidence(dapEvidence.events, {
    sessionId,
    event,
    metadata: summarizeDapEvent(event, body),
  })
}

function latestBy(list, predicate) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (predicate(list[i])) return list[i]
  }
  return null
}

function buildPathEvidence(commands, list, key, label) {
  return commands.map((command) => {
    const latest = latestBy(list, (entry) => entry[key] === command)
    return {
      [label]: command,
      status: latest ? "available" : "blocked",
      latest,
    }
  })
}

function summarizeOwnerPath(pathConfig) {
  const requestEvidence = buildPathEvidence(pathConfig.requiredRequests, dapEvidence.requests, "command", "command")
  const eventEvidence = buildPathEvidence(pathConfig.requiredEvents, dapEvidence.events, "event", "event")
  const available = [...requestEvidence, ...eventEvidence].filter((entry) => entry.status === "available").length
  const total = requestEvidence.length + eventEvidence.length
  return {
    capability: pathConfig.capability,
    status: available === total ? "available" : available > 0 ? "partial" : "blocked",
    vscodeOwner: pathConfig.vscodeOwner,
    currentOwner: "desktop/services/debug/index.js dapSessions metadata over existing dapRequest/handleDapMessage",
    requests: requestEvidence,
    events: eventEvidence,
    missingOwner: available === total
      ? ""
      : "Required DAP request/event has not been observed in this backend session evidence buffer.",
    nextAuthorizedFiles: [
      "desktop/services/debug/index.js",
      "frontend/vite-project/src/debug/debugManager.ts",
      "frontend/vite-project/src/components/debugState.ts",
    ],
  }
}

function getDapEvidenceSummary() {
  return {
    source: "desktopDebugService",
    serviceId: "debugService",
    stateSource: "dapSessions",
    vscodeReference: {
      mainThreadDebugService: "MainThreadDebugService",
      rawDebugSession: "RawDebugSession",
      debugSession: "DebugSession",
      debugModel: "DebugModel",
    },
    owners: Object.fromEntries(Object.entries(DAP_OWNER_PATHS).map(([key, value]) => [key, summarizeOwnerPath(value)])),
    latest: {
      requests: dapEvidence.requests.slice(-20),
      responses: dapEvidence.responses.slice(-20),
      events: dapEvidence.events.slice(-20),
      reverseRequests: dapEvidence.reverseRequests.slice(-10),
      exits: dapEvidence.exits.slice(-10),
      errors: dapEvidence.errors.slice(-10),
    },
    constraints: {
      noSecondDebugState: true,
      metadataOnly: true,
      dapBoundaryOnly: true,
      redactsCommandArguments: true,
      preservesDapBehavior: true,
    },
  }
}

function resetDapEvidenceForTests() {
  dapEvidence.requests.length = 0
  dapEvidence.responses.length = 0
  dapEvidence.events.length = 0
  dapEvidence.reverseRequests.length = 0
  dapEvidence.exits.length = 0
  dapEvidence.errors.length = 0
}

// ---------------- DAP (Debug Adapter Protocol) ----------------
// Wire format: `Content-Length: <N>\r\n\r\n<json-body>` framed messages
// on both stdin (writes) and stdout (reads).

const HEADER_TERMINATOR = "\r\n\r\n"

function createDapParser(onMessage, onError) {
  let buffer = Buffer.alloc(0)
  let contentLength = -1

  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (contentLength < 0) {
        const headerEnd = buffer.indexOf(HEADER_TERMINATOR)
        if (headerEnd < 0) return
        const headerText = buffer.slice(0, headerEnd).toString("utf8")
        const match = /Content-Length:\s*(\d+)/i.exec(headerText)
        if (!match) {
          onError(new Error("DAP header missing Content-Length: " + headerText))
          buffer = buffer.slice(headerEnd + HEADER_TERMINATOR.length)
          continue
        }
        contentLength = parseInt(match[1], 10)
        buffer = buffer.slice(headerEnd + HEADER_TERMINATOR.length)
      }
      if (buffer.length < contentLength) return
      const body = buffer.slice(0, contentLength).toString("utf8")
      buffer = buffer.slice(contentLength)
      contentLength = -1
      try {
        onMessage(JSON.parse(body))
      } catch (err) {
        onError(err)
      }
    }
  }
}

function writeDapMessage(child, message) {
  writeDapMessageToStream(child.stdin, message)
}

function writeDapMessageToStream(stream, message) {
  const json = JSON.stringify(message)
  const payload = Buffer.from(json, "utf8")
  const header = Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "ascii")
  stream.write(Buffer.concat([header, payload]))
}

function normalizeDapStartOptions(options = {}) {
  const nestedConfig = options.config && typeof options.config === "object" && !Array.isArray(options.config)
    ? options.config
    : {}
  const { config, ...topLevel } = options
  return { ...nestedConfig, ...topLevel }
}

function normalizeDebugAdapterDescriptor(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  const descriptor = input.debugAdapterDescriptor || input.adapterDescriptor || input.descriptor
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) return null
  const descriptorType = String(descriptor.type || descriptor.kind || "").trim()
  if (descriptorType === "server") {
    const port = Number(descriptor.port)
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      return { ok: false, message: "DebugAdapterServer descriptor requires a valid port", descriptorType }
    }
    return {
      ok: true,
      descriptor: {
        type: "server",
        host: typeof descriptor.host === "string" && descriptor.host.trim() ? descriptor.host.trim() : "127.0.0.1",
        port,
      },
    }
  }
  if (descriptorType === "pipeServer" || descriptorType === "namedPipe" || descriptorType === "pipe") {
    const pipePath = String(descriptor.path || descriptor.pipeName || descriptor.pipePath || "").trim()
    if (!pipePath) {
      return { ok: false, message: "DebugAdapterNamedPipeServer descriptor requires a path", descriptorType }
    }
    return { ok: true, descriptor: { type: "pipeServer", path: pipePath } }
  }
  return {
    ok: false,
    message: `Unsupported debug adapter descriptor type: ${descriptorType || "unknown"}`,
    descriptorType: descriptorType || "unknown",
  }
}

function rejectPendingRequests(state, message) {
  for (const { reject } of state.pending.values()) {
    reject(new Error(message))
  }
  state.pending.clear()
}

function markDapSessionExited(sessionId, state, code, message) {
  state.exited = true
  state.exitCode = code
  rejectPendingRequests(state, message || "Debug adapter exited")
  pushEvidence(dapEvidence.exits, { sessionId, exitCode: code })
  dapEmitter.emit("exit", { sessionId, exitCode: code })
}

function createDapSessionState(sessionId, input = {}) {
  const state = {
    command: input.command || "",
    adapterId: input.adapterId || "unknown",
    transport: input.transport || "stdio",
    descriptor: input.descriptor || undefined,
    startedAt: Date.now(),
    nextSeq: 1,
    pending: new Map(),
    exited: false,
    exitCode: null,
    stderrBuffer: "",
    ready: input.ready || Promise.resolve(),
    write(message) {
      writeDapMessageToStream(input.writable, message)
    },
    dispose: input.dispose || (() => undefined),
  }
  const parse = createDapParser(
    (msg) => handleDapMessage(sessionId, state, msg),
    (err) => {
      pushEvidence(dapEvidence.errors, { sessionId, messageLength: String(err.message || "").length })
      dapEmitter.emit("error", { sessionId, message: err.message })
    },
  )
  input.readable.on("data", parse)
  input.readable.on("error", (err) => {
    pushEvidence(dapEvidence.errors, { sessionId, messageLength: String(err.message || "").length })
    dapEmitter.emit("error", { sessionId, message: err.message })
  })
  if (input.writable && input.writable !== input.readable) {
    input.writable.on?.("error", (err) => {
      pushEvidence(dapEvidence.errors, { sessionId, messageLength: String(err.message || "").length })
      dapEmitter.emit("error", { sessionId, message: err.message })
    })
  }
  return state
}

function dapStartFromDescriptor(sessionId, descriptor, adapterId) {
  const socket = descriptor.type === "server"
    ? net.createConnection(descriptor.port, descriptor.host)
    : net.createConnection(descriptor.path)
  const ready = new Promise((resolve, reject) => {
    socket.once("connect", resolve)
    socket.once("error", reject)
  })
  ready.catch(() => undefined)
  const state = createDapSessionState(sessionId, {
    adapterId,
    command: descriptor.type === "server" ? `${descriptor.host}:${descriptor.port}` : descriptor.path,
    transport: descriptor.type,
    descriptor,
    readable: socket,
    writable: socket,
    ready,
    dispose: () => socket.end(),
  })
  socket.on("close", () => {
    if (!state.exited) markDapSessionExited(sessionId, state, null, "Debug adapter connection closed")
  })
  socket.on("error", (err) => {
    if (!state.exited) {
      pushEvidence(dapEvidence.errors, { sessionId, messageLength: String(err.message || "").length })
      dapEmitter.emit("error", { sessionId, message: err.message })
      rejectPendingRequests(state, err.message || "Debug adapter connection error")
    }
  })
  dapSessions.set(sessionId, state)
  return { success: true, message: "DAP adapter transport connected", sessionId, descriptor }
}

function dapStart(options = {}) {
  const normalizedOptions = normalizeDapStartOptions(options)
  const { command, args, workingDir, cwd, env, adapterId, adapterType, type, confirmed, ...adapterConfig } = normalizedOptions
  const resolvedAdapterId = adapterId || adapterType || type
  const resolvedWorkingDir = workingDir || cwd
  const descriptorResult = normalizeDebugAdapterDescriptor(normalizedOptions)
  if (descriptorResult) {
    if (!descriptorResult.ok) {
      return { success: false, message: descriptorResult.message, sessionId: "", descriptorType: descriptorResult.descriptorType }
    }
    const sessionId = crypto.randomUUID()
    return dapStartFromDescriptor(sessionId, descriptorResult.descriptor, resolvedAdapterId || "descriptor")
  }
  let resolvedCommand = command
  let resolvedArgs = args
  let resolvedEnv = env
  if (!resolvedCommand && resolvedAdapterId) {
    const resolved = resolveAdapter(resolvedAdapterId, { ...adapterConfig, workingDir: resolvedWorkingDir, cwd: resolvedWorkingDir })
    if (!resolved.available) {
      return { success: false, message: resolved.message, sessionId: "", adapter: resolved }
    }
    if (!resolved.command || !resolved.command.trim()) {
      return {
        success: false,
        message: "resolved adapter does not expose a direct stdio command",
        sessionId: "",
        adapter: resolved,
      }
    }
    resolvedCommand = resolved.command
    resolvedArgs = resolved.args
    resolvedEnv = resolved.env ? { ...resolved.env, ...env } : env
  }
  if (!resolvedCommand || !resolvedCommand.trim()) {
    return { success: false, message: "command is required", sessionId: "" }
  }
  const trustDecision = evaluateCommandExecution(resolvedWorkingDir || process.cwd(), [resolvedCommand, ...(Array.isArray(resolvedArgs) ? resolvedArgs : [])].join(" "), {
    action: "启动调试适配器",
    confirmed: confirmed === true,
  })
  if (!trustDecision.allowed) {
    return {
      success: false,
      message: trustDecision.message,
      sessionId: "",
      code: trustDecision.code,
      workspaceTrust: trustDecision.status,
    }
  }
  const sessionId = crypto.randomUUID()
  try {
    const child = spawn(resolvedCommand, Array.isArray(resolvedArgs) ? resolvedArgs : [], {
      cwd: resolvedWorkingDir || process.cwd(),
      env: resolvedEnv ? { ...process.env, ...resolvedEnv } : process.env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    })

    const state = createDapSessionState(sessionId, {
      command: resolvedCommand,
      adapterId: resolvedAdapterId || "unknown",
      transport: "stdio",
      readable: child.stdout,
      writable: child.stdin,
      dispose: () => child.kill(),
    })
    state.child = child
    child.stderr.on("data", (chunk) => {
      const s = chunk.toString("utf8")
      if (state.stderrBuffer.length + s.length > OUTPUT_BUFFER_CAPACITY) {
        state.stderrBuffer = state.stderrBuffer.slice(state.stderrBuffer.length / 4)
      }
      state.stderrBuffer += s
      dapEmitter.emit("stderr", { sessionId, data: s })
    })
    child.on("exit", (code) => {
      markDapSessionExited(sessionId, state, code, "Debug adapter exited")
    })
    child.on("error", (err) => {
      pushEvidence(dapEvidence.errors, { sessionId, messageLength: String(err.message || "").length })
      dapEmitter.emit("error", { sessionId, message: err.message })
    })

    dapSessions.set(sessionId, state)
    return { success: true, message: "DAP adapter started", sessionId }
  } catch (e) {
    return { success: false, message: "Failed to start DAP adapter: " + e.message, sessionId }
  }
}

function handleDapMessage(sessionId, state, msg) {
  if (msg.type === "response") {
    recordDapResponse(sessionId, msg)
    const pending = state.pending.get(msg.request_seq)
    if (pending) {
      state.pending.delete(msg.request_seq)
      if (msg.success) pending.resolve(msg)
      else pending.reject(new Error(msg.message || "DAP request failed"))
    }
    dapEmitter.emit("response", { sessionId, message: msg })
  } else if (msg.type === "event") {
    recordDapEvent(sessionId, msg.event, msg.body)
    dapEmitter.emit("event", { sessionId, event: msg.event, body: msg.body, message: msg })
  } else if (msg.type === "request") {
    // Reverse request from adapter (e.g. runInTerminal). Surface to UI.
    pushEvidence(dapEvidence.reverseRequests, {
      sessionId,
      seq: msg.seq,
      command: msg.command,
      metadata: summarizeDapArguments(msg.command, msg.arguments),
    })
    dapEmitter.emit("reverseRequest", { sessionId, message: msg })
  }
}

function dapRequest(sessionId, command, args) {
  return new Promise((resolve, reject) => {
    const state = dapSessions.get(sessionId)
    if (!state) return reject(new Error("DAP session not found"))
    if (state.exited) return reject(new Error("DAP session terminated"))
    const seq = state.nextSeq++
    const message = {
      seq,
      type: "request",
      command,
      arguments: args || {},
    }
    state.pending.set(seq, { resolve, reject })
    Promise.resolve(state.ready).then(() => {
      if (state.exited) {
        state.pending.delete(seq)
        reject(new Error("DAP session terminated"))
        return
      }
      recordDapRequest(sessionId, message)
      state.write(message)
    }).catch((err) => {
      state.pending.delete(seq)
      reject(err)
    })
  })
}

function dapRespond(sessionId, requestSeq, command, success, body, message) {
  const state = dapSessions.get(sessionId)
  if (!state || state.exited) return false
  const response = {
    seq: state.nextSeq++,
    type: "response",
    request_seq: requestSeq,
    command,
    success: !!success,
    message: message || undefined,
    body: body || undefined,
  }
  try {
    state.write(response)
    return true
  } catch {
    return false
  }
}

function dapStop(sessionId) {
  const state = dapSessions.get(sessionId)
  dapSessions.delete(sessionId)
  if (!state) return { success: false, message: "Session not found", sessionId }
  try { state.dispose() } catch {}
  return { success: true, message: "DAP adapter stopped", sessionId }
}

function dapListSessions() {
  const out = []
  for (const [id, s] of dapSessions.entries()) {
    out.push({
      sessionId: id,
      adapterId: s.adapterId,
      command: s.command,
      status: s.exited ? "terminated" : "running",
      startedAt: s.startedAt,
      exitCode: s.exitCode,
      transport: s.transport,
    })
  }
  return out
}

function getDapServiceContractSnapshot() {
  return {
    source: "desktopDebugService",
    serviceId: "debugService",
    vscodeServiceIds: ["IDebugAdapter", "IDebugAdapterDescriptorFactory"],
    stateSource: "dapSessions",
    sessions: dapListSessions().map((session) => {
      const state = dapSessions.get(session.sessionId)
      return {
        sessionId: session.sessionId,
        adapterId: session.adapterId,
        status: session.status,
        startedAt: session.startedAt,
        exitCode: session.exitCode,
        pendingRequestCount: state?.pending?.size || 0,
        stderrLength: state?.stderrBuffer?.length || 0,
        commandLabel: path.basename(session.command || ""),
        transport: session.transport || "stdio",
      }
    }),
    constraints: {
      noSecondDapState: true,
      dapBoundaryOnly: true,
      workspaceTrustBeforeSpawn: true,
      evidenceSafeActions: true,
      redactsCommandArguments: true,
    },
    evidence: getDapEvidenceSummary(),
  }
}

function onDapEvent(name, handler) {
  dapEmitter.on(name, handler)
  return () => dapEmitter.off(name, handler)
}

function register(router) {
  router.register("POST", "/debug/start", async ({ body }) => start(body || {}))
  router.register("POST", "/debug/input", async ({ body }) => input(body.sessionId, body.text || ""))
  router.register("POST", "/debug/stop", async ({ body }) => stop(body.sessionId))
  router.register("POST", "/debug/output", async ({ body }) => getOutput(body.sessionId, body.offset))
  router.register("GET", "/debug/sessions", async () => ({ success: true, sessions: listSessions() }))

  router.register("POST", "/debug/dap/start", async ({ body }) => dapStart(body || {}))
  router.register("GET", "/debug/adapter-health", async ({ query }) => {
    const latest = readLatestDebugAdapterHealth({ reportDir: query?.reportDir })
    return latest.report || {
      reportKind: "debug-adapter-health",
      status: "missing",
      statusLabel: "暂无调试器健康报告",
      ready: false,
      jsonPath: latest.latestJsonPath,
      markdownPath: latest.latestMarkdownPath,
    }
  })
  router.register("POST", "/debug/adapter-health/run", async ({ body }) => {
    const report = buildDebugAdapterHealth(body || {})
    if (body?.write === false) return report
    saveDebugAdapterHealth(report, { reportDir: body?.reportDir })
    return report
  })
  router.register("POST", "/debug/dap/request", async ({ body }) => {
    try {
      const response = await dapRequest(body.sessionId, body.command, body.arguments)
      return { success: true, response }
    } catch (err) {
      return { success: false, message: err.message }
    }
  })
  router.register("POST", "/debug/dap/respond", async ({ body }) => ({
    success: dapRespond(body.sessionId, body.requestSeq, body.command, body.ok, body.body, body.message),
  }))
  router.register("POST", "/debug/dap/stop", async ({ body }) => dapStop(body.sessionId))
  router.register("GET", "/debug/dap/sessions", async () => ({ success: true, sessions: dapListSessions() }))
  router.register("GET", "/debug/dap/evidence", async () => ({ success: true, evidence: getDapEvidenceSummary() }))
}

module.exports = {
  register,
  start,
  input,
  stop,
  getOutput,
  listSessions,
  dapStart,
  dapRequest,
  dapRespond,
  dapStop,
  dapListSessions,
  getDapEvidenceSummary,
  getDapServiceContractSnapshot,
  onDapEvent,
  buildDebugAdapterHealth,
  readLatestDebugAdapterHealth,
  resolveAdapter,
  saveDebugAdapterHealth,
  resetDapEvidenceForTests,
}
