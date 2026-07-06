/**
 * MainThreadDebugService records VS Code debug contributions registered by
 * extension-host extensions. It intentionally mirrors the VS Code RPC method
 * names used by ExtHostDebugService, so debuggers such as ms-vscode.js-debug
 * can activate and register their DebugAdapterDescriptorFactory.
 */

const debugTypes = new Set()
const configurationProviders = new Map()
const adapterFactories = new Map()
const sessions = new Map()
const { toFileUriComponents } = require("../uriComponents")
const { ExtHostContext, MainContext } = require("../extHostServer")
let nextSessionOrdinal = 1
let nextDebugConsoleOrdinal = 1
let focusedSessionId = null
const BRIDGE_EVIDENCE_LIMIT = 80
const bridgeEvidence = {
  messages: [],
  errors: [],
  exits: [],
}

const BRIDGE_OWNER_PATHS = {
  callStack: {
    capability: "callStack",
    vscodeOwner: "MainThreadDebugService.$acceptDAMessage -> ExtensionHostDebugAdapter.acceptMessage -> RawDebugSession.stackTrace",
    commands: ["threads", "stackTrace"],
    events: ["stopped"],
  },
  breakpoints: {
    capability: "breakpoints",
    vscodeOwner: "MainThreadDebugService.sendBreakpointsAndListen + RawDebugSession.setBreakpoints/configurationDone",
    commands: ["setBreakpoints", "configurationDone"],
    events: ["initialized", "breakpoint"],
  },
  variablesWatch: {
    capability: "variables/watch",
    vscodeOwner: "RawDebugSession.scopes/variables/evaluate over MainThreadDebugService DA bridge",
    commands: ["scopes", "variables", "evaluate"],
    events: ["stopped", "invalidated"],
  },
  executionControl: {
    capability: "executionControl",
    vscodeOwner: "RawDebugSession.continue/next/stepIn/stepOut/terminate over MainThreadDebugService DA bridge",
    commands: ["continue", "next", "stepIn", "stepOut", "terminate"],
    events: ["continued", "terminated"],
  },
}

function clone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function normalizeType(type) {
  return String(type || "").trim()
}

function pushBridgeEvidence(list, entry) {
  list.push({
    timestamp: Date.now(),
    ...entry,
  })
  if (list.length > BRIDGE_EVIDENCE_LIMIT) {
    list.splice(0, list.length - BRIDGE_EVIDENCE_LIMIT)
  }
}

function summarizeMessage(message = {}) {
  if (!message || typeof message !== "object") return {}
  if (message.type === "request") {
    return {
      seq: message.seq,
      type: "request",
      command: message.command,
      argumentKeys: message.arguments && typeof message.arguments === "object"
        ? Object.keys(message.arguments).sort()
        : [],
    }
  }
  if (message.type === "response") {
    return {
      seq: message.seq,
      requestSeq: message.request_seq,
      type: "response",
      command: message.command,
      success: message.success === true,
      bodyKeys: message.body && typeof message.body === "object" ? Object.keys(message.body).sort() : [],
    }
  }
  if (message.type === "event") {
    return {
      seq: message.seq,
      type: "event",
      event: message.event,
      bodyKeys: message.body && typeof message.body === "object" ? Object.keys(message.body).sort() : [],
    }
  }
  return {
    seq: message.seq,
    type: message.type,
  }
}

function recordBridgeMessage(handle, message) {
  pushBridgeEvidence(bridgeEvidence.messages, {
    handle: Number(handle),
    ...summarizeMessage(message),
  })
}

function latestMessage(predicate) {
  for (let i = bridgeEvidence.messages.length - 1; i >= 0; i -= 1) {
    if (predicate(bridgeEvidence.messages[i])) return bridgeEvidence.messages[i]
  }
  return null
}

function buildBridgeEvidence(pathConfig) {
  const requestsOrResponses = pathConfig.commands.map((command) => {
    const latest = latestMessage((entry) => entry.command === command)
    return {
      command,
      status: latest ? "available" : "blocked",
      latest,
    }
  })
  const events = pathConfig.events.map((event) => {
    const latest = latestMessage((entry) => entry.event === event)
    return {
      event,
      status: latest ? "available" : "blocked",
      latest,
    }
  })
  const available = [...requestsOrResponses, ...events].filter((entry) => entry.status === "available").length
  const total = requestsOrResponses.length + events.length
  return {
    capability: pathConfig.capability,
    status: available === total ? "available" : available > 0 ? "partial" : "blocked",
    vscodeOwner: pathConfig.vscodeOwner,
    currentOwner: "desktop/services/extensions-host/mainThread/mainThreadDebugService.js bridge metadata",
    commands: requestsOrResponses,
    events,
    missingOwner: available === total
      ? ""
      : "MainThreadDebugService has not observed all required DAP protocol messages through $acceptDAMessage.",
    nextAuthorizedFiles: [
      "desktop/services/extensions-host/mainThread/mainThreadDebugService.js",
      "desktop/services/debug/index.js",
      "frontend/vite-project/src/debug/debugManager.ts",
      "frontend/vite-project/src/components/debugState.ts",
    ],
  }
}

function createFolderUri(rootDir) {
  return toFileUriComponents(rootDir || process.cwd())
}

function createSessionDto(type, configuration = {}, options = {}) {
  const sessionId = options.sessionId || `codek-debug-${Date.now()}-${nextSessionOrdinal++}`
  const resolvedType = normalizeType(type || configuration.type || "node")
  return {
    id: sessionId,
    type: resolvedType,
    name: configuration.name || `${resolvedType} 调试`,
    folderUri: options.folderUri || createFolderUri(options.rootDir),
    configuration: {
      type: resolvedType,
      request: configuration.request || "launch",
      name: configuration.name || `${resolvedType} 调试`,
      ...configuration,
    },
    parent: options.parent || undefined,
  }
}

function makeDebugState() {
  const debugSessions = Array.from(sessions.values())
  return {
    debugTypes: Array.from(debugTypes).sort(),
    configurationProviders: Array.from(configurationProviders.values()).sort((a, b) => a.handle - b.handle),
    adapterFactories: Array.from(adapterFactories.values()).sort((a, b) => a.handle - b.handle),
    sessions: debugSessions,
    focusedSessionId,
    debugConsole: {
      stateSource: "mainThreadDebugService.sessions",
      entries: debugSessions.flatMap((session) => Array.isArray(session.debugConsoleOutput)
        ? session.debugConsoleOutput.map((entry) => ({ sessionId: session.id, ...entry }))
        : []),
    },
    debugBridgeEvidence: getDebugBridgeEvidenceSummary(),
  }
}

function getDebugBridgeEvidenceSummary() {
  return {
    source: "mainThreadDebugService",
    serviceId: "MainThreadDebugService",
    stateSource: "extensionHostDebugBridge",
    vscodeServiceIds: ["MainThreadDebugService", "IDebugAdapter", "RawDebugSession"],
    owners: Object.fromEntries(Object.entries(BRIDGE_OWNER_PATHS).map(([key, value]) => [key, buildBridgeEvidence(value)])),
    latest: {
      messages: bridgeEvidence.messages.slice(-20),
      errors: bridgeEvidence.errors.slice(-10),
      exits: bridgeEvidence.exits.slice(-10),
    },
    constraints: {
      noSecondDebugState: true,
      metadataOnly: true,
      dapBoundaryOnly: true,
      preservesDapBehavior: true,
      redactsPayloadValues: true,
    },
  }
}

function resetDebugBridgeEvidenceForTests() {
  bridgeEvidence.messages.length = 0
  bridgeEvidence.errors.length = 0
  bridgeEvidence.exits.length = 0
}

function hasAdapterFactory(type) {
  const resolvedType = normalizeType(type)
  return Array.from(adapterFactories.values()).some((factory) => factory.type === resolvedType)
}

function getAdapterFactory(type) {
  const resolvedType = normalizeType(type)
  return Array.from(adapterFactories.values()).find((factory) => factory.type === resolvedType) || null
}

function onRpc(server, method, handler) {
  server.onRpc(MainContext.MainThreadDebugService, method, handler)
  server.onRpc(method, handler)
}

function getFocusedDebugSession() {
  if (focusedSessionId && sessions.has(focusedSessionId)) {
    return sessions.get(focusedSessionId)
  }
  const latest = Array.from(sessions.values()).at(-1) || null
  focusedSessionId = latest?.id || null
  return latest
}

function appendDebugConsole(value, opts = {}) {
  const text = String(value ?? "")
  const session = getFocusedDebugSession()
  const evidence = {
    source: "MainThreadDebugService.$appendDebugConsole",
    vscodeSource: "src/vs/workbench/api/browser/mainThreadDebugService.ts#$appendDebugConsole",
    stateSource: "mainThreadDebugService.sessions.debugConsoleOutput",
    evidenceSafe: true,
    valueLength: text.length,
    result: session ? "appended" : "blocked",
    reason: session ? "" : "missing_focused_debug_session",
  }
  if (!session) return evidence

  const entry = {
    id: `debug-console-${nextDebugConsoleOrdinal++}`,
    type: "extension",
    text,
    createdAt: Date.now(),
    evidenceSafe: true,
    valueLength: text.length,
  }
  session.debugConsoleOutput = Array.isArray(session.debugConsoleOutput) ? session.debugConsoleOutput : []
  session.debugConsoleOutput.push(entry)
  session.debugConsoleAppendEvidence = Array.isArray(session.debugConsoleAppendEvidence) ? session.debugConsoleAppendEvidence : []
  session.debugConsoleAppendEvidence.push(evidence)
  opts.sendToRenderer?.("ext-host:debug-console-append", { sessionId: session.id, entry })
  opts.syncDebugState?.(makeDebugState())
  return evidence
}

function getDebugAdapterBridgeFeasibility(type, options = {}) {
  const factory = getAdapterFactory(type)
  const session = createSessionDto(type, options.configuration || {}, {
    sessionId: options.sessionId || "codek-debug-bridge-feasibility",
    rootDir: options.rootDir,
    folderUri: options.folderUri,
  })
  const canCallExtHost = Boolean(options.server && typeof options.server.call === "function")
  const blockedReasons = []
  if (!factory) blockedReasons.push("missing_debug_adapter_descriptor_factory")
  if (!canCallExtHost) blockedReasons.push("missing_ext_host_rpc_call")

  return {
    adapterType: session.type,
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    factoryRegistered: Boolean(factory),
    factoryHandle: factory?.handle ?? null,
    extHostRpcId: ExtHostContext.ExtHostDebugService,
    provideMethod: "$provideDebugAdapter",
    providePath: factory && canCallExtHost ? "callable" : "blocked",
    sessionDtoFields: Object.keys(session).sort(),
    descriptorTypes: {
      executable: "supported_after_descriptor",
      server: "supported_via_desktop_dap_descriptor_transport",
      pipeServer: "supported_via_desktop_dap_descriptor_transport",
      implementation: "blocked_inline_adapter_not_supported",
    },
    blockedReasons,
  }
}

async function provideDebugAdapterDescriptor(server, type, configuration = {}, options = {}) {
  const factory = getAdapterFactory(type)
  if (!factory) {
    return {
      status: "blocked",
      descriptor: null,
      reason: "missing_debug_adapter_descriptor_factory",
      feasibility: getDebugAdapterBridgeFeasibility(type, { ...options, configuration, server }),
    }
  }
  if (!server || typeof server.call !== "function") {
    return {
      status: "blocked",
      descriptor: null,
      reason: "missing_ext_host_rpc_call",
      feasibility: getDebugAdapterBridgeFeasibility(type, { ...options, configuration, server }),
    }
  }
  const session = createSessionDto(type, configuration, options)
  try {
    const descriptor = await server.call(
      ExtHostContext.ExtHostDebugService,
      "$provideDebugAdapter",
      [factory.handle, session],
      options.timeoutMs || 5000,
    )
    return {
      status: descriptor ? "provided" : "blocked",
      descriptor: descriptor || null,
      reason: descriptor ? "" : "empty_debug_adapter_descriptor",
      session,
    }
  } catch (error) {
    return {
      status: "blocked",
      descriptor: null,
      reason: error?.message || String(error),
      session,
    }
  }
}

async function startDebugSession(server, configuration = {}, options = {}, opts = {}) {
  const session = createSessionDto(configuration?.type, configuration || {}, {
    rootDir: opts.rootDir,
    parent: options?.parentSession?.id,
  })
  const descriptorResult = await provideDebugAdapterDescriptor(
    { call: opts.callEh || server.call?.bind(server) },
    session.type,
    session.configuration,
    {
      rootDir: opts.rootDir,
      folderUri: session.folderUri,
      sessionId: session.id,
      timeoutMs: opts.debugAdapterDescriptorTimeoutMs,
    },
  )
  let dapStartResult = null
  if (descriptorResult.status === "provided" && descriptorResult.descriptor) {
    const dapStart = typeof opts.dapStart === "function"
      ? opts.dapStart
      : (() => {
        try { return require("../../debug").dapStart } catch { return null }
      })()
    if (typeof dapStart !== "function") {
      throw new Error("Desktop debug service dapStart is not available")
    }
    dapStartResult = dapStart({
      adapterId: session.type,
      type: session.type,
      workingDir: opts.rootDir,
      config: session.configuration,
      debugAdapterDescriptor: descriptorResult.descriptor,
      confirmed: options?.confirmed === true,
    })
    if (!dapStartResult?.success) {
      throw new Error(dapStartResult?.message || "Failed to start DAP adapter from debug adapter descriptor")
    }
  } else if (descriptorResult.status === "blocked" && descriptorResult.reason && descriptorResult.reason !== "missing_debug_adapter_descriptor_factory") {
    throw new Error(descriptorResult.reason)
  }

  sessions.set(session.id, clone({
    ...session,
    dapSessionId: dapStartResult?.sessionId,
    debugConsoleOutput: [],
    debugConsoleAppendEvidence: [],
    debugAdapterDescriptor: descriptorResult.descriptor
      ? {
        type: descriptorResult.descriptor.type,
        host: descriptorResult.descriptor.host,
        port: descriptorResult.descriptor.port,
        path: descriptorResult.descriptor.path,
      }
      : undefined,
  }))
  focusedSessionId = session.id
  opts.syncDebugState?.(makeDebugState())
  return true
}

function register(server, opts = {}) {
  onRpc(server, "$registerDebugTypes", (args) => {
    for (const type of args?.[0] || []) {
      const normalized = normalizeType(type)
      if (normalized) debugTypes.add(normalized)
    }
    opts.syncDebugState?.(makeDebugState())
    return undefined
  })

  onRpc(server, "$registerDebugConfigurationProvider", (args) => {
    const [type, triggerKind, hasProvide, hasResolve, hasResolveWithSubstitutedVariables, handle] = args || []
    const normalized = normalizeType(type)
    if (normalized && handle != null) {
      configurationProviders.set(Number(handle), {
        type: normalized,
        triggerKind,
        hasProvide: Boolean(hasProvide),
        hasResolve: Boolean(hasResolve),
        hasResolveWithSubstitutedVariables: Boolean(hasResolveWithSubstitutedVariables),
        handle: Number(handle),
      })
    }
    opts.syncDebugState?.(makeDebugState())
    return undefined
  })

  onRpc(server, "$unregisterDebugConfigurationProvider", (args) => {
    const [handle] = args || []
    configurationProviders.delete(Number(handle))
    opts.syncDebugState?.(makeDebugState())
    return undefined
  })

  onRpc(server, "$registerDebugAdapterDescriptorFactory", (args) => {
    const [type, handle] = args || []
    const normalized = normalizeType(type)
    if (normalized && handle != null) {
      adapterFactories.set(Number(handle), { type: normalized, handle: Number(handle) })
    }
    opts.syncDebugState?.(makeDebugState())
    return undefined
  })

  onRpc(server, "$unregisterDebugAdapterDescriptorFactory", (args) => {
    const [handle] = args || []
    adapterFactories.delete(Number(handle))
    opts.syncDebugState?.(makeDebugState())
    return undefined
  })

  onRpc(server, "$startDebugging", async (args) => {
    const [_folder, configuration, options] = args || []
    return startDebugSession(server, configuration || {}, options || {}, opts)
  })

  onRpc(server, "$stopDebugging", (args) => {
    const [sessionId] = args || []
    if (sessionId) {
      sessions.delete(sessionId)
      if (focusedSessionId === sessionId) focusedSessionId = null
    } else {
      sessions.clear()
      focusedSessionId = null
    }
    opts.syncDebugState?.(makeDebugState())
    return true
  })

  onRpc(server, "$sessionCached", (args) => {
    const [sessionId] = args || []
    if (sessionId && !sessions.has(sessionId)) {
      sessions.set(sessionId, { id: sessionId, cached: true })
      opts.syncDebugState?.(makeDebugState())
    }
    return undefined
  })

  onRpc(server, "$acceptDAMessage", (args) => {
    const [handle, message] = args || []
    if (handle != null && message && typeof message === "object") {
      recordBridgeMessage(handle, message)
      opts.syncDebugState?.(makeDebugState())
    }
    return undefined
  })
  onRpc(server, "$acceptDAError", (args) => {
    const [handle, name, message, stack] = args || []
    pushBridgeEvidence(bridgeEvidence.errors, {
      handle: Number(handle),
      name: String(name || ""),
      messageLength: String(message || "").length,
      stackLength: String(stack || "").length,
    })
    opts.syncDebugState?.(makeDebugState())
    return undefined
  })
  onRpc(server, "$acceptDAExit", (args) => {
    const [handle, code, signal] = args || []
    pushBridgeEvidence(bridgeEvidence.exits, {
      handle: Number(handle),
      code,
      signal,
    })
    opts.syncDebugState?.(makeDebugState())
    return undefined
  })
  onRpc(server, "$appendDebugConsole", (args) => appendDebugConsole(args?.[0], opts))
}

module.exports = {
  appendDebugConsole,
  createFolderUri,
  createSessionDto,
  getDebugAdapterBridgeFeasibility,
  getAdapterFactory,
  getDebugBridgeEvidenceSummary,
  hasAdapterFactory,
  makeDebugState,
  provideDebugAdapterDescriptor,
  register,
  resetDebugBridgeEvidenceForTests,
  startDebugSession,
}
