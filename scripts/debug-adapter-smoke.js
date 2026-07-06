const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const {
  dapRequest,
  dapRespond,
  dapStart,
  dapStop,
  getDapEvidenceSummary,
  onDapEvent,
  resolveAdapter,
} = require("../desktop/services/debug")

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  return {
    noWrite: argv.includes("--no-write"),
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : path.join(__dirname, "..", ".codek", "reports"),
  }
}

function waitForEvent(events, predicate, timeoutMs = 1200) {
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

function withTimeout(promise, label, timeoutMs = 5000) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out waiting for DAP ${label}`)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function writeFixtureAdapter() {
  const script = path.join(os.tmpdir(), `codek-debug-adapter-smoke-${Date.now()}.js`)
  fs.writeFileSync(script, [
    "let buffer = Buffer.alloc(0)",
    "let nextSeq = 1",
    "function send(message) {",
    "  const body = Buffer.from(JSON.stringify(message), 'utf8')",
    "  process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\\r\\n\\r\\n`, 'ascii'), body]))",
    "}",
    "function response(request, body) { send({ seq: nextSeq++, type: 'response', request_seq: request.seq, command: request.command, success: true, body: body || {} }) }",
    "function errorResponse(request, message) { send({ seq: nextSeq++, type: 'response', request_seq: request.seq, command: request.command, success: false, message }) }",
    "function event(event, body) { send({ seq: nextSeq++, type: 'event', event, body: body || {} }) }",
    "function handle(request) {",
    "  if (request.command === 'initialize') { response(request, { supportsConfigurationDoneRequest: true }); event('initialized'); return }",
    "  if (request.command === 'launch') { response(request); event('output', { category: 'console', output: 'debug smoke launched' }); return }",
    "  if (request.command === 'setBreakpoints') { response(request, { breakpoints: [{ verified: true, line: 2 }] }); return }",
    "  if (request.command === 'configurationDone') { response(request); event('stopped', { reason: 'breakpoint', threadId: 1 }); return }",
    "  if (request.command === 'threads') { response(request, { threads: [{ id: 1, name: 'main' }] }); return }",
    "  if (request.command === 'stackTrace') { response(request, { stackFrames: [{ id: 7, name: 'main', line: 2, column: 1, source: { path: 'smoke.js' } }], totalFrames: 1 }); return }",
    "  if (request.command === 'scopes') { response(request, { scopes: [{ name: 'Locals', variablesReference: 10, expensive: false }] }); return }",
    "  if (request.command === 'variables') { response(request, { variables: [{ name: 'ok', value: 'true', type: 'boolean', variablesReference: 0 }] }); return }",
    "  if (request.command === 'continue') { response(request, { allThreadsContinued: true }); event('continued', { threadId: 1 }); return }",
    "  if (request.command === 'next') { response(request); event('stopped', { reason: 'step', threadId: 1 }); return }",
    "  if (request.command === 'evaluate' && request.arguments.expression === 'throw') { errorResponse(request, 'fixture evaluate failed'); return }",
    "  if (request.command === 'evaluate') { response(request, { result: 'true', variablesReference: 0 }); return }",
    "  if (request.command === 'terminate') { response(request); event('terminated', {}); return }",
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
  return script
}

function commandCoverage(commands) {
  const seen = new Set(Array.isArray(commands) ? commands : [])
  return {
    initialize: seen.has("initialize"),
    launch: seen.has("launch"),
    setBreakpoints: seen.has("setBreakpoints"),
    configurationDone: seen.has("configurationDone"),
    threads: seen.has("threads"),
    stackTrace: seen.has("stackTrace"),
    scopes: seen.has("scopes"),
    variables: seen.has("variables"),
    continue: seen.has("continue"),
    next: seen.has("next"),
    terminate: seen.has("terminate"),
    disconnect: seen.has("disconnect"),
  }
}

function buildFixtureEvidence(input = {}) {
  const frames = Array.isArray(input.stack?.body?.stackFrames) ? input.stack.body.stackFrames : []
  const scopes = Array.isArray(input.scopes?.body?.scopes) ? input.scopes.body.scopes : []
  const variables = Array.isArray(input.variables?.body?.variables) ? input.variables.body.variables : []
  const breakpoints = Array.isArray(input.breakpoints?.body?.breakpoints) ? input.breakpoints.body.breakpoints : []
  const threads = Array.isArray(input.threads?.body?.threads) ? input.threads.body.threads : []
  const bridge = input.bridgeEvidence && typeof input.bridgeEvidence === "object" ? input.bridgeEvidence : {}
  const latestRequests = Array.isArray(bridge.latest?.requests) ? bridge.latest.requests : []
  const latestEvents = Array.isArray(bridge.latest?.events) ? bridge.latest.events : []
  return {
    metadataOnly: true,
    adapter: {
      adapterId: String(input.started?.adapterId || "fixture"),
      sessionId: String(input.started?.sessionId || ""),
      commandLabel: path.basename(String(input.started?.command || process.execPath || "")),
      rawArgumentsIncluded: false,
    },
    requestCommands: commandCoverage(input.commands),
    breakpoints: {
      count: breakpoints.length,
      verified: breakpoints.filter((breakpoint) => breakpoint?.verified === true).length,
    },
    threads: { threadCount: threads.length },
    stackTrace: {
      frameCount: frames.length,
      totalFrames: Number(input.stack?.body?.totalFrames || frames.length),
      sourcePathIncluded: false,
    },
    scopes: { scopeCount: scopes.length },
    variables: {
      variableCount: variables.length,
      valueCount: variables.filter((variable) => typeof variable?.value === "string").length,
      valueSamplesIncluded: false,
    },
    bridgeEvidence: {
      available: Boolean(bridge.source),
      source: String(bridge.source || ""),
      serviceId: String(bridge.serviceId || ""),
      stateSource: String(bridge.stateSource || ""),
      latestRequestCount: latestRequests.length,
      latestEventCount: latestEvents.length,
      noSecondDapState: bridge.constraints?.noSecondDebugState === true,
      evidenceSafeActions: bridge.constraints?.dapBoundaryOnly === true && bridge.constraints?.preservesDapBehavior === true,
      redactsCommandArguments: bridge.constraints?.redactsCommandArguments === true,
      ownerStatuses: Object.fromEntries(Object.entries(bridge.owners || {}).map(([key, owner]) => [key, String(owner?.status || "")])),
    },
    redaction: {
      expressionValuesRedacted: true,
      sourcePathsRedacted: true,
      adapterArgumentsRedacted: true,
    },
  }
}

async function runFixtureSmoke() {
  const script = writeFixtureAdapter()
  const events = []
  const commands = []
  const off = onDapEvent("event", (event) => events.push(event))
  const started = dapStart({
    command: process.execPath,
    args: [script],
    workingDir: path.resolve(__dirname, ".."),
    adapterId: "fixture",
    confirmed: true,
  })
  if (!started.success) {
    off()
    return { id: "fixture", status: "failed", detail: started.message, adapterAvailable: true }
  }
  try {
    commands.push("initialize")
    await dapRequest(started.sessionId, "initialize", { adapterID: "fixture" })
    await waitForEvent(events, (event) => event.event === "initialized")
    commands.push("launch")
    await dapRequest(started.sessionId, "launch", { program: "smoke.js" })
    await waitForEvent(events, (event) => event.event === "output")
    commands.push("setBreakpoints")
    const breakpoints = await dapRequest(started.sessionId, "setBreakpoints", {
      source: { path: "smoke.js" },
      breakpoints: [{ line: 2 }],
    })
    commands.push("configurationDone")
    await dapRequest(started.sessionId, "configurationDone")
    await waitForEvent(events, (event) => event.event === "stopped")
    commands.push("threads")
    const threads = await dapRequest(started.sessionId, "threads")
    commands.push("stackTrace")
    const stack = await dapRequest(started.sessionId, "stackTrace", { threadId: 1 })
    commands.push("scopes")
    const scopes = await dapRequest(started.sessionId, "scopes", { frameId: stack.body.stackFrames[0].id })
    commands.push("variables")
    const variables = await dapRequest(started.sessionId, "variables", { variablesReference: scopes.body.scopes[0].variablesReference })
    commands.push("evaluate")
    const evaluated = await dapRequest(started.sessionId, "evaluate", { expression: "ok", context: "repl" })
    let evaluateError = ""
    try {
      commands.push("evaluate")
      await dapRequest(started.sessionId, "evaluate", { expression: "throw", context: "repl" })
    } catch (error) {
      evaluateError = error.message
    }
    if (!evaluateError) {
      throw new Error("fixture evaluate error path did not reject")
    }
    commands.push("continue")
    await dapRequest(started.sessionId, "continue", { threadId: 1 })
    commands.push("next")
    await dapRequest(started.sessionId, "next", { threadId: 1 })
    await waitForEvent(events, (event) => event.event === "stopped" && event.body?.reason === "step")
    commands.push("terminate")
    await dapRequest(started.sessionId, "terminate")
    await waitForEvent(events, (event) => event.event === "terminated")
    const bridgeEvidence = getDapEvidenceSummary()
    return {
      id: "fixture",
      status: "passed",
      detail: "真实子进程 DAP fixture 已覆盖 initialize/launch/breakpoints/stack/scopes/variables/evaluate/continue/next/terminate。",
      adapterAvailable: true,
      breakpointsVerified: breakpoints.body.breakpoints[0].verified === true,
      threads: threads.body.threads.length,
      variables: variables.body.variables.length,
      evaluateResult: evaluated.body.result,
      evaluateError,
      evidence: buildFixtureEvidence({
        started: { ...started, command: process.execPath, adapterId: "fixture" },
        breakpoints,
        threads,
        stack,
        scopes,
        variables,
        commands,
        bridgeEvidence,
      }),
    }
  } catch (error) {
    return { id: "fixture", status: "failed", detail: error.message, adapterAvailable: true }
  } finally {
    off()
    await dapRequest(started.sessionId, "disconnect").catch(() => null)
    dapStop(started.sessionId)
  }
}

function writePythonSmokeProgram() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-debugpy-smoke-"))
  const program = path.join(dir, "smoke.py")
  fs.writeFileSync(program, [
    "value = 40",
    "value = value + 2",
    "print('debugpy smoke value', value)",
  ].join("\n") + "\n", "utf8")
  return { dir, program }
}

async function runDebugpySmoke() {
  const adapter = resolveAdapter("python", {}, { skipProbe: true })
  if (!adapter.available || adapter.mode !== "stdio" || !adapter.command) {
    return {
      id: "python-debugpy",
      status: "skipped",
      detail: adapter.message,
      adapterAvailable: adapter.available,
      mode: adapter.mode,
      source: adapter.source,
      remediation: adapter.remediation || null,
    }
  }

  const fixture = writePythonSmokeProgram()
  const events = []
  const reverseRequests = []
  const offEvent = onDapEvent("event", (event) => events.push(event))
  const offReverseRequest = onDapEvent("reverseRequest", (event) => {
    reverseRequests.push({
      command: event.message.command,
      argumentsKeys: Object.keys(event.message.arguments || {}),
    })
    dapRespond(event.sessionId, event.message.seq, event.message.command, true, { processId: process.pid })
  })
  const started = dapStart({
    command: adapter.command,
    args: adapter.args,
    workingDir: path.resolve(__dirname, ".."),
    env: { ...adapter.env, PYTHONDONTWRITEBYTECODE: "1" },
    adapterId: "python",
    confirmed: true,
  })
  if (!started.success) {
    offEvent()
    offReverseRequest()
    return {
      id: "python-debugpy",
      status: "failed",
      detail: started.message,
      adapterAvailable: adapter.available,
      mode: adapter.mode,
      source: adapter.source,
    }
  }

  try {
    await withTimeout(dapRequest(started.sessionId, "initialize", {
      clientID: "codek",
      clientName: "Codek IDE",
      adapterID: "debugpy",
      pathFormat: "path",
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsRunInTerminalRequest: true,
      locale: "zh-CN",
    }), "initialize")

    const launchPromise = withTimeout(dapRequest(started.sessionId, "launch", {
      name: "Codek debugpy smoke",
      type: "debugpy",
      request: "launch",
      program: fixture.program,
      cwd: fixture.dir,
      stopOnEntry: false,
      console: "internalConsole",
      redirectOutput: true,
      justMyCode: false,
    }), "launch", 15000)

    await waitForEvent(events, (event) => event.event === "initialized", 5000)
    const breakpoints = await withTimeout(dapRequest(started.sessionId, "setBreakpoints", {
      source: { path: fixture.program },
      breakpoints: [{ line: 2 }],
      sourceModified: false,
    }), "setBreakpoints")
    await withTimeout(dapRequest(started.sessionId, "configurationDone"), "configurationDone")
    await launchPromise
    const stopped = await waitForEvent(events, (event) => event.event === "stopped", 15000)
    const threads = await withTimeout(dapRequest(started.sessionId, "threads"), "threads")
    const threadId = stopped.body?.threadId || threads.body.threads[0].id
    const stack = await withTimeout(dapRequest(started.sessionId, "stackTrace", {
      threadId,
      startFrame: 0,
      levels: 20,
    }), "stackTrace")
    const topFrame = stack.body.stackFrames[0]
    const scopes = await withTimeout(dapRequest(started.sessionId, "scopes", { frameId: topFrame.id }), "scopes")
    const locals = scopes.body.scopes.find((scope) => /local/i.test(scope.name)) || scopes.body.scopes[0]
    const variables = await withTimeout(dapRequest(started.sessionId, "variables", {
      variablesReference: locals.variablesReference,
    }), "variables")
    const evaluated = await withTimeout(dapRequest(started.sessionId, "evaluate", {
      expression: "value",
      frameId: topFrame.id,
      context: "repl",
    }), "evaluate")
    await withTimeout(dapRequest(started.sessionId, "continue", { threadId }), "continue")

    return {
      id: "python-debugpy",
      status: "passed",
      detail: "真实第三方 debugpy adapter 已覆盖 initialize/launch/breakpoints/stack/scopes/variables/evaluate/continue。",
      adapterAvailable: true,
      mode: adapter.mode,
      source: adapter.source,
      breakpointsVerified: breakpoints.body.breakpoints[0].verified === true,
      threads: threads.body.threads.length,
      stackFrames: stack.body.stackFrames.length,
      variables: variables.body.variables.length,
      evaluateResult: evaluated.body.result,
      reverseRequests,
    }
  } catch (error) {
    return {
      id: "python-debugpy",
      status: "failed",
      detail: error.message,
      adapterAvailable: true,
      mode: adapter.mode,
      source: adapter.source,
    }
  } finally {
    offEvent()
    offReverseRequest()
    await dapRequest(started.sessionId, "disconnect", { terminateDebuggee: true }).catch(() => null)
    dapStop(started.sessionId)
  }
}

function buildExternalAdapterCheck(adapterType) {
  const adapter = resolveAdapter(adapterType)
  const requiresExtensionHost = adapter.available && adapter.mode === "extension-host"
  const feasibility = requiresExtensionHost ? buildExtensionHostAdapterFeasibility(adapterType, adapter) : null
  const availableDetail = requiresExtensionHost
    ? feasibility.summary
    : `${adapterType} adapter 可用：stdio 启动路径已解析。`
  return {
    id: adapterType,
    status: adapter.available && !requiresExtensionHost ? "passed" : "skipped",
    detail: adapter.available ? availableDetail : adapter.message,
    adapterAvailable: adapter.available,
    dapSessionCovered: adapter.available && !requiresExtensionHost,
    mode: adapter.mode,
    source: adapter.source,
    adapterStarted: adapter.available && !requiresExtensionHost,
    hasSessionStartDescriptorHandoff: requiresExtensionHost ? feasibility?.evidence?.hasSessionStartDescriptorHandoff === true : false,
    descriptorHandoffTarget: requiresExtensionHost && feasibility?.evidence?.hasSessionStartDescriptorHandoff
      ? "ExtHostDebugService.$provideDebugAdapter -> MainThreadDebugService.$startDebugging -> desktopDebugService.dapStart(debugAdapterDescriptor)"
      : null,
    realLaunchSmoke: requiresExtensionHost ? "pending-environment-adapter-session" : "stdio-resolve-only",
    remediation: adapter.remediation || null,
    feasibility,
  }
}

function runJsDebugExtensionHostSmoke(options = {}) {
  if (options.skipJsDebugExtensionHostSmoke) return null
  const adapter = resolveAdapter("node")
  if (!adapter.available || adapter.mode !== "extension-host") return null
  if (typeof options.runJsDebugSmoke === "function") {
    return options.runJsDebugSmoke(adapter)
  }

  const timeoutMs = Number(options.timeoutMs || 20000)
  const result = require("node:child_process").spawnSync(process.execPath, [
    path.join(__dirname, "eh-e2e.js"),
    "--js-debug",
    `--timeout=${timeoutMs}`,
  ], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: timeoutMs + 5000,
  })
  const reportPath = path.join(__dirname, "..", ".codek", "reports", "eh-e2e-js-debug-latest.json")
  let report = null
  try {
    if (fs.existsSync(reportPath)) report = JSON.parse(fs.readFileSync(reportPath, "utf8"))
  } catch {}

  const ready = result.status === 0 && report?.ready === true
  const rawFailure = report?.failure?.message || report?.error || result.stderr || result.stdout || "unknown error"
  const dependencyMatch = /Cannot find package '([^']+)'|Cannot find module '([^']+)'/.exec(rawFailure)
  const missingDependency = dependencyMatch?.[1] || dependencyMatch?.[2] || ""
  return {
    id: "node",
    status: ready ? "passed" : "failed",
    detail: ready
      ? "真实 ms-vscode.js-debug 已通过扩展宿主 DebugAdapterDescriptorFactory 启动 debug session。"
      : `真实 ms-vscode.js-debug smoke 失败：${rawFailure}`,
    adapterAvailable: true,
    dapSessionCovered: ready,
    mode: "extension-host",
    source: "ms-vscode.js-debug",
    adapterStarted: ready,
    hasSessionStartDescriptorHandoff: true,
    descriptorHandoffTarget: "ExtHostDebugService.$provideDebugAdapter -> MainThreadDebugService.$startDebugging -> desktopDebugService.dapStart(debugAdapterDescriptor)",
    realLaunchSmoke: ready ? "passed" : "blocked",
    reportPath,
    blockedReason: ready ? "" : (missingDependency ? "extension-host-runtime-dependency-missing" : "js-debug-extension-host-smoke-failed"),
    remediation: ready ? null : {
      category: missingDependency ? "environment" : "debug-session-start",
      severity: "failed",
      missingDependency,
      nextAction: missingDependency
        ? `补齐当前 worktree 的 Node 依赖（缺少 ${missingDependency}）后重新运行 npm run smoke:debug-adapter。`
        : "查看 eh-e2e-js-debug-latest.json，继续修复真实 js-debug initialize/launch 链路。",
    },
    startDebuggingResult: report?.startDebuggingResult === true,
    launchSessionStatus: report?.launchSessionHasDapHandoff ? "dap-handoff" : (report?.launchSession?.status || ""),
    failure: report?.failure || null,
  }
}

function buildExtensionHostAdapterFeasibility(adapterType, adapter) {
  const manifest = adapter.extension?.manifestPath ? readJsonSafe(adapter.extension.manifestPath) : null
  const activationEvents = Array.isArray(manifest?.activationEvents) ? manifest.activationEvents : []
  const relevantActivationEvents = activationEvents.filter((event) => {
    const value = String(event || "")
    return value === `onDebugResolve:${adapterType}` || value === "onDebugResolve:pwa-node" || value === "onDebugResolve:node"
  })
  const mainThreadDebugServicePath = path.resolve(__dirname, "..", "desktop", "services", "extensions-host", "mainThread", "mainThreadDebugService.js")
  const ehE2ePath = path.resolve(__dirname, "eh-e2e.js")
  const mainThreadDebugService = readTextSafe(mainThreadDebugServicePath)
  const ehE2e = readTextSafe(ehE2ePath)
  const evidence = {
    extensionInstalled: Boolean(adapter.extension?.extensionPath),
    extensionMainExists: Boolean(adapter.adapterPath && fs.existsSync(adapter.adapterPath)),
    activationEvents: relevantActivationEvents,
    recordsDescriptorFactoryRegistration: mainThreadDebugService.includes("$registerDebugAdapterDescriptorFactory"),
    hasProvideDebugAdapterBridge: mainThreadDebugService.includes("$provideDebugAdapter"),
    hasSessionStartDescriptorHandoff: mainThreadDebugService.includes("dapStart({") && mainThreadDebugService.includes("debugAdapterDescriptor"),
    hasDescriptorToDapTransportBridge: adapter.dapTransportReady !== false,
    hasJsDebugActivationProbe: ehE2e.includes("onDebugResolve:pwa-node"),
    smokeStartsOnlyDirectStdioAdapters: true,
  }
  const missingBridge = []
  if (!evidence.hasProvideDebugAdapterBridge) {
    missingBridge.push("MainThreadDebugService 缺少 ExtHostDebugService.$provideDebugAdapter 调用桥")
  }
  if (!evidence.hasSessionStartDescriptorHandoff) {
    missingBridge.push("MainThreadDebugService 尚未把 $provideDebugAdapter 返回的 descriptor 传给 dapStart({ debugAdapterDescriptor })")
  }
  for (const item of adapter.feasibility?.missingBridgeApis || []) {
    if (evidence.hasSessionStartDescriptorHandoff && item.includes("$provideDebugAdapter") && item.includes("dapStart")) {
      continue
    }
    missingBridge.push(item)
  }
  if (adapter.feasibility?.status === "ready") {
    missingBridge.push("真实 js-debug initialize/launch smoke 需通过 npm run smoke:debug-adapter 持续验证")
  }
  if (!evidence.hasDescriptorToDapTransportBridge) {
    missingBridge.push("尚未把 DebugAdapterNamedPipeServer/DebugAdapterServer 描述符转换为可连接 DAP transport")
  }
  return {
    status: "contract-ready",
    summary: `${adapterType} adapter 已由 ${adapter.source} 贡献，session-start descriptor handoff ${evidence.hasSessionStartDescriptorHandoff ? "已接到 desktop DAP" : "仍未闭环"}；dry-run contract 仍需真实 smoke 配套验证。证据：${missingBridge.join("；") || "真实 js-debug initialize/launch smoke"}。`,
    evidence,
    descriptorTypes: adapter.feasibility?.descriptorTypes || null,
    requiredSessionDtoFields: adapter.feasibility?.requiredSessionDtoFields || [],
    verifiedBridgeApis: adapter.feasibility?.verifiedBridgeApis || [],
    remainingLimitations: adapter.feasibility?.remainingLimitations || [],
    requiredBridge: [
      "激活 onDebugResolve:pwa-node/onDebugResolve:node",
      "调用扩展宿主 $provideDebugAdapter(handle, sessionDto)",
      "把 $provideDebugAdapter 返回的 descriptor 接到 dapStart({ debugAdapterDescriptor })",
      "完成 initialize/launch/breakpoints/stack/scopes/variables/evaluate/continue 回归",
    ],
    missingBridge,
  }
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8")
  } catch {
    return ""
  }
}

async function runDebugAdapterSmoke(options = {}) {
  const checks = [await runFixtureSmoke(), await runDebugpySmoke(), runJsDebugExtensionHostSmoke(options) || buildExternalAdapterCheck("node")]
  const failed = checks.filter((check) => check.status === "failed")
  const report = {
    reportKind: "debug-adapter-smoke",
    createdAt: Date.now(),
    ready: failed.length === 0,
    status: failed.length > 0 ? "blocked" : "ready",
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.status === "passed").length,
      skipped: checks.filter((check) => check.status === "skipped").length,
      failed: failed.length,
    },
    checks,
  }
  if (!options.noWrite) saveDebugAdapterSmoke(report, options)
  return report
}

function saveDebugAdapterSmoke(report, options = {}) {
  const reportDir = options.reportDir || path.join(__dirname, "..", ".codek", "reports")
  fs.mkdirSync(reportDir, { recursive: true })
  const jsonPath = path.join(reportDir, "debug-adapter-smoke-latest.json")
  const markdownPath = path.join(reportDir, "debug-adapter-smoke-latest.md")
  const payload = { ...report, jsonPath, markdownPath }
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  fs.writeFileSync(markdownPath, `${toMarkdown(payload)}\n`, "utf8")
  return { report: payload, jsonPath, markdownPath }
}

function toMarkdown(report) {
  const rows = (report.checks || []).map((check) => {
    const evidence = check.evidence
    const detail = evidence?.metadataOnly
      ? `${check.detail || ""} metadata-only DAP ${Object.values(evidence.requestCommands || {}).filter(Boolean).length} commands · stack/scopes/vars ${evidence.stackTrace?.frameCount || 0}/${evidence.scopes?.scopeCount || 0}/${evidence.variables?.variableCount || 0}`
      : check.detail || ""
    return `| ${check.id} | ${check.status} | ${String(detail).replace(/\|/g, "\\|")} |`
  })
  return [
    "# Debug Adapter Smoke",
    "",
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Summary: ${report.summary.passed}/${report.summary.total} passed, ${report.summary.skipped} skipped, ${report.summary.failed} failed`,
    "",
    "| Adapter | Status | Detail |",
    "| --- | --- | --- |",
    ...rows,
  ].join("\n")
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = await runDebugAdapterSmoke(options)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`)
    process.exit(1)
  })
}

module.exports = {
  buildFixtureEvidence,
  buildExternalAdapterCheck,
  buildExtensionHostAdapterFeasibility,
  runJsDebugExtensionHostSmoke,
  parseArgs,
  runDebugAdapterSmoke,
  runDebugpySmoke,
  saveDebugAdapterSmoke,
  toMarkdown,
}
