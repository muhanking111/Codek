import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"
import { DebugManager } from "./debugManager"
import type { DapIpcTransport } from "./dapClient"
import {
  addWatch,
  debugState,
  debugWorkbenchModel,
  getDebugServiceContractSnapshot,
  type Breakpoint,
} from "../components/debugState"

class FakeDapTransport implements DapIpcTransport {
  readonly requests: Array<{ command: string; arguments?: Record<string, unknown> }> = []
  private callback: ((message: string) => void) | null = null

  async start(_adapterType: string, config: Record<string, unknown>): Promise<string> {
    this.requests.push({ command: "transport.start", arguments: config })
    return "fake-dap-1"
  }

  async stop(): Promise<void> {
    return undefined
  }

  async send(_sessionId: string, message: string): Promise<void> {
    const request = JSON.parse(message) as {
      seq: number
      command: string
      arguments?: Record<string, unknown>
    }
    this.requests.push({ command: request.command, arguments: request.arguments })

    this.emitResponse(request.seq, request.command, this.responseBodyFor(request.command, request.arguments))

    if (request.command === "launch") {
      this.emitEvent("initialized")
    }

    if (request.command === "configurationDone") {
      this.emitEvent("stopped", {
        reason: "breakpoint",
        threadId: 1,
        description: "命中断点",
      })
    }
  }

  onEvent(callback: (message: string) => void): () => void {
    this.callback = callback
    return () => {
      this.callback = null
    }
  }

  emitAdapterEvent(event: string, body?: Record<string, unknown>): void {
    this.emitEvent(event, body)
  }

  private emitResponse(requestSeq: number, command: string, body?: Record<string, unknown>): void {
    queueMicrotask(() => {
      if (body?.__error) {
        this.callback?.(JSON.stringify({
          seq: requestSeq + 1000,
          type: "response",
          request_seq: requestSeq,
          success: false,
          command,
          message: String(body.__error),
        }))
        return
      }
      this.callback?.(JSON.stringify({
        seq: requestSeq + 1000,
        type: "response",
        request_seq: requestSeq,
        success: true,
        command,
        body,
      }))
    })
  }

  private emitEvent(event: string, body?: Record<string, unknown>): void {
    queueMicrotask(() => {
      this.callback?.(JSON.stringify({
        seq: Date.now(),
        type: "event",
        event,
        body,
      }))
    })
  }

  private responseBodyFor(command: string, args?: Record<string, unknown>): Record<string, unknown> {
    if (command === "initialize") {
      return { supportsConfigurationDoneRequest: true, supportsTerminateRequest: true }
    }
    if (command === "setBreakpoints") {
      const breakpoints = Array.isArray(args?.breakpoints) ? args.breakpoints : []
      return {
        breakpoints: breakpoints.map((bp, index) => ({
          id: index + 1,
          verified: true,
          source: args?.source,
          line: (bp as { line?: number }).line,
        })),
      }
    }
    if (command === "threads") {
      return { threads: [{ id: 1, name: "主线程" }] }
    }
    if (command === "stackTrace") {
      return {
        stackFrames: [{
          id: 11,
          name: "main",
          source: { path: "D:/Workspace/src/main.ts" },
          line: 7,
          column: 3,
        }],
        totalFrames: 1,
      }
    }
    if (command === "scopes") {
      return {
        scopes: [{ name: "局部变量", variablesReference: 101, expensive: false }],
      }
    }
    if (command === "variables") {
      return {
        variables: [
          { name: "answer", value: "42", type: "number", variablesReference: 0 },
          { name: "label", value: "\"codek\"", type: "string", variablesReference: 0 },
        ],
      }
    }
    if (command === "evaluate") {
      if (args?.expression === "throwInRepl") {
        return { __error: "fixture evaluate failed" }
      }
      return { result: "42", type: "number", variablesReference: 0 }
    }
    if (command === "continue") {
      queueMicrotask(() => {
        this.callback?.(JSON.stringify({
          seq: Date.now(),
          type: "event",
          event: "continued",
          body: { allThreadsContinued: true },
        }))
      })
      return { allThreadsContinued: true }
    }
    if (command === "pause") {
      queueMicrotask(() => {
        this.callback?.(JSON.stringify({
          seq: Date.now(),
          type: "event",
          event: "stopped",
          body: { reason: "pause", threadId: 1 },
        }))
      })
      return {}
    }
    return {}
  }
}

// Runs a minimal DAP adapter as a real child process over stdin/stdout framing.
class ExternalAdapterProcessTransport implements DapIpcTransport {
  readonly observedRequests: Array<{ command: string; arguments?: Record<string, unknown> }> = []
  adapterPid: number | null = null
  private callback: ((message: string) => void) | null = null
  private child: ChildProcessWithoutNullStreams | null = null
  private rawData = Buffer.alloc(0)
  private contentLength = -1

  async start(_adapterType: string, config: Record<string, unknown>): Promise<string> {
    this.observedRequests.push({ command: "transport.start", arguments: config })
    this.child = spawn(process.execPath, ["-e", EXTERNAL_DAP_ADAPTER_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    this.adapterPid = this.child.pid ?? null
    this.child.stdout.on("data", (chunk: Buffer) => this.handleAdapterData(chunk))
    this.child.on("exit", () => {
      this.child = null
    })
    return `external-dap-${this.adapterPid ?? "unknown"}`
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) return
    await new Promise<void>((resolve) => {
      let resolved = false
      const done = () => {
        if (resolved) return
        resolved = true
        resolve()
      }
      child.once("exit", done)
      child.kill()
      setTimeout(done, 500).unref?.()
    })
  }

  async send(_sessionId: string, message: string): Promise<void> {
    const request = JSON.parse(message) as {
      command: string
      arguments?: Record<string, unknown>
    }
    this.observedRequests.push({ command: request.command, arguments: request.arguments })
    this.child?.stdin.write(toDapFrame(message))
  }

  onEvent(callback: (message: string) => void): () => void {
    this.callback = callback
    return () => {
      this.callback = null
    }
  }

  private handleAdapterData(chunk: Buffer): void {
    this.rawData = Buffer.concat([this.rawData, chunk])

    while (true) {
      if (this.contentLength >= 0) {
        if (this.rawData.length < this.contentLength) break
        const message = this.rawData.toString("utf8", 0, this.contentLength)
        this.rawData = this.rawData.subarray(this.contentLength)
        this.contentLength = -1
        this.callback?.(message)
        continue
      }

      const headerEnd = this.rawData.indexOf("\r\n\r\n")
      if (headerEnd === -1) break
      const header = this.rawData.toString("utf8", 0, headerEnd)
      const match = /Content-Length:\s*(\d+)/i.exec(header)
      this.contentLength = match ? Number(match[1]) : -1
      this.rawData = this.rawData.subarray(headerEnd + 4)
    }
  }
}

function toDapFrame(message: string): string {
  return `Content-Length: ${Buffer.byteLength(message, "utf8")}\r\n\r\n${message}`
}

const EXTERNAL_DAP_ADAPTER_SCRIPT = String.raw`
const TWO_CRLF = "\r\n\r\n";
let rawData = Buffer.alloc(0);
let contentLength = -1;
let seq = 1000;

function write(message) {
  const json = JSON.stringify(message);
  process.stdout.write("Content-Length: " + Buffer.byteLength(json, "utf8") + TWO_CRLF + json);
}

function sendResponse(request, body) {
  write({
    seq: seq++,
    type: "response",
    request_seq: request.seq,
    success: true,
    command: request.command,
    body: body || {},
  });
}

function sendEvent(event, body) {
  write({
    seq: seq++,
    type: "event",
    event,
    body: body || {},
  });
}

function handleRequest(request) {
  if (request.command === "initialize") {
    sendResponse(request, { supportsConfigurationDoneRequest: true, supportsTerminateRequest: true });
    return;
  }
  if (request.command === "launch") {
    sendResponse(request, {});
    sendEvent("initialized", {});
    return;
  }
  if (request.command === "configurationDone") {
    sendResponse(request, {});
    sendEvent("stopped", { reason: "breakpoint", threadId: 77, description: "external adapter process" });
    return;
  }
  if (request.command === "threads") {
    sendResponse(request, { threads: [{ id: 77, name: "adapter-process-thread" }] });
    return;
  }
  if (request.command === "stackTrace") {
    sendResponse(request, {
      stackFrames: [{
        id: 7701,
        name: "externalEvaluateFrame",
        source: { path: "D:/Workspace/src/external-adapter.ts" },
        line: 12,
        column: 1,
      }],
      totalFrames: 1,
    });
    return;
  }
  if (request.command === "scopes") {
    sendResponse(request, { scopes: [{ name: "adapter process scope", variablesReference: 7702, expensive: false }] });
    return;
  }
  if (request.command === "variables") {
    sendResponse(request, { variables: [{ name: "adapterPid", value: String(process.pid), type: "number", variablesReference: 0 }] });
    return;
  }
  if (request.command === "evaluate") {
    const expression = request.arguments && request.arguments.expression;
    const frameId = request.arguments && request.arguments.frameId;
    sendResponse(request, {
      result: "external-adapter-evaluate:" + expression + ":frame=" + frameId,
      type: "string",
      variablesReference: 0,
    });
    return;
  }
  sendResponse(request, {});
}

function acceptData(chunk) {
  rawData = Buffer.concat([rawData, chunk]);
  while (true) {
    if (contentLength >= 0) {
      if (rawData.length < contentLength) break;
      const message = rawData.toString("utf8", 0, contentLength);
      rawData = rawData.subarray(contentLength);
      contentLength = -1;
      handleRequest(JSON.parse(message));
      continue;
    }
    const headerEnd = rawData.indexOf(TWO_CRLF);
    if (headerEnd === -1) break;
    const header = rawData.toString("utf8", 0, headerEnd);
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    contentLength = match ? Number(match[1]) : -1;
    rawData = rawData.subarray(headerEnd + TWO_CRLF.length);
  }
}

process.stdin.on("data", acceptData);
process.stdin.resume();
`

describe("DebugManager", () => {
  afterEach(() => {
    debugState.breakpoints.value = []
    debugState.stackFrames.value = []
    debugState.variables.value = []
    debugState.watchEntries.value = []
    debugState.consoleOutput.value = []
    debugState.actionEvidence.value = []
    debugState.isRunning.value = false
    debugState.paused.value = false
    debugState.currentFrameId.value = null
    debugState.sessionId.value = null
  })

  it("runs the VS Code DAP launch, breakpoint, stopped, stack, scopes, and variables flow", async () => {
    debugState.breakpoints.value = [{
      id: "bp-1",
      file: "D:/Workspace/src/main.ts",
      line: 7,
      enabled: true,
    } satisfies Breakpoint]

    const transport = new FakeDapTransport()
    const manager = new DebugManager(transport)

    await manager.startSession({
      id: "cfg-node",
      name: "Node",
      type: "node",
      command: "node src/main.ts",
      workingDir: "D:/Workspace",
      env: { NODE_ENV: "test" },
    })

    await waitFor(() => debugState.variables.value.length > 0)

    expect(transport.requests.map((request) => request.command)).toEqual([
      "transport.start",
      "initialize",
      "launch",
      "setBreakpoints",
      "configurationDone",
      "threads",
      "stackTrace",
      "scopes",
      "variables",
    ])
    expect(transport.requests.find((request) => request.command === "launch")?.arguments).toMatchObject({
      type: "node",
      cwd: "D:/Workspace",
      runtimeExecutable: "node",
      program: "src/main.ts",
      env: { NODE_ENV: "test" },
    })
    expect(transport.requests.find((request) => request.command === "transport.start")?.arguments).toMatchObject({
      confirmed: true,
    })
    expect(debugState.paused.value).toBe(true)
    expect(debugState.stackFrames.value[0]).toMatchObject({
      id: 11,
      name: "main",
      file: "D:/Workspace/src/main.ts",
      line: 7,
    })
    expect(debugState.variables.value[0]).toMatchObject({
      name: "局部变量",
      children: [
        { name: "answer", value: "42", type: "number" },
        { name: "label", value: "\"codek\"", type: "string" },
      ],
    })
    expect(debugWorkbenchModel.getBreakpoints({ file: "D:/Workspace/src/main.ts" })[0]).toMatchObject({
      verified: true,
      adapterData: expect.objectContaining({ id: 1, line: 7 }),
      source: "debugState",
    })

    await manager.continue()
    expect(debugState.paused.value).toBe(false)
  })

  it("projects DAP lifecycle into the VS Code-style debug model contract", async () => {
    const watch = addWatch("answer")
    const transport = new FakeDapTransport()
    const manager = new DebugManager(transport)

    await manager.startSession({
      id: "cfg-node",
      name: "Node",
      type: "node",
      command: "node src/main.ts",
      workingDir: "D:/Workspace",
    })
    await waitFor(() => debugWorkbenchModel.getVariables().length > 0)

    expect(debugWorkbenchModel.getSession()).toEqual(expect.objectContaining({
      sessionId: "fake-dap-1",
      adapterType: "node",
      phase: "paused",
      activeThreadId: 1,
      currentFrameId: 11,
      stoppedReason: "breakpoint",
      capabilities: expect.objectContaining({ supportsTerminateRequest: true }),
    }))
    expect(debugWorkbenchModel.getCallStack()).toEqual([
      expect.objectContaining({
        id: 1,
        name: "主线程",
        stopped: true,
        frames: [expect.objectContaining({
          id: 11,
          threadId: 1,
          file: "D:/Workspace/src/main.ts",
          line: 7,
        })],
      }),
    ])
    expect(debugWorkbenchModel.getVariables()[0]).toEqual(expect.objectContaining({
      name: "局部变量",
      variablesReference: 101,
      children: expect.arrayContaining([expect.objectContaining({ name: "answer", variablesReference: 0 })]),
    }))
    expect(debugWorkbenchModel.getWatchExpressions()).toEqual([
      expect.objectContaining({
        id: watch.id,
        expression: "answer",
        value: "42",
        type: "number",
      }),
    ])

    await manager.continue()
    expect(debugWorkbenchModel.getSession()).toEqual(expect.objectContaining({
      phase: "running",
      paused: false,
    }))
    expect(debugWorkbenchModel.getCallStack()[0]?.frames).toEqual([])

    await manager.stopSession()
    expect(debugWorkbenchModel.getSession()).toEqual(expect.objectContaining({
      phase: "idle",
      sessionId: null,
      isRunning: false,
    }))
    expect(debugWorkbenchModel.getVariables()).toEqual([])
  })

  it("exposes a VS Code-style debug service contract without a second state source", async () => {
    debugState.breakpoints.value = [{
      id: "bp-contract",
      file: "D:/Workspace/src/main.ts",
      line: 7,
      enabled: true,
    }]
    const transport = new FakeDapTransport()
    const manager = new DebugManager(transport)

    await manager.startSession({
      id: "cfg-node",
      name: "Node",
      type: "node",
      command: "node src/main.ts",
      workingDir: "D:/Workspace",
    })
    await waitFor(() => debugWorkbenchModel.getCallStack()[0]?.frames.length === 1)

    await manager.evaluate("secretToken")
    await manager.continue()
    await waitFor(() => debugWorkbenchModel.getSession().phase === "running")
    await manager.pause()
    await waitFor(() => debugWorkbenchModel.getSession().phase === "paused")

    const snapshot = getDebugServiceContractSnapshot()
    expect(snapshot).toMatchObject({
      source: "debugWorkbenchModel",
      serviceId: "debugService",
      vscodeServiceIds: ["IDebugService", "IDebugModel", "IConfigurationResolverService"],
      stateSource: "debugState",
      constraints: {
        noSecondDebugState: true,
        evidenceSafeActions: true,
        preservesAgentEvidenceSafety: true,
      },
      session: expect.objectContaining({
        sessionId: "fake-dap-1",
        phase: "paused",
        stateSource: "debugState",
      }),
      breakpoints: expect.objectContaining({
        stateSource: "debugState",
      }),
      callStack: expect.objectContaining({
        stateSource: "debugState",
      }),
    })
    expect(snapshot.actions.map((action) => action.action)).toEqual(expect.arrayContaining([
      "start",
      "setBreakpoints",
      "evaluate",
      "continue",
      "pause",
    ]))
    expect(snapshot.actions.find((action) => action.action === "evaluate")).toMatchObject({
      evidenceSafe: true,
      expressionLength: "secretToken".length,
    })
    expect(JSON.stringify(snapshot.actions)).not.toContain("secretToken")
  })

  it("adds REPL input and evaluate results to the shared debug console model", async () => {
    const transport = new FakeDapTransport()
    const manager = new DebugManager(transport)

    await manager.startSession({
      id: "cfg-node",
      name: "Node",
      type: "node",
      command: "node src/main.ts",
      workingDir: "D:/Workspace",
    })
    await waitFor(() => debugWorkbenchModel.getCallStack()[0]?.frames.length === 1)
    debugState.consoleOutput.value = []

    const result = await manager.evaluate("answer")

    expect(result).toBe("42")
    expect(transport.requests.find((request) => request.command === "evaluate")?.arguments).toMatchObject({
      expression: "answer",
      frameId: 11,
      context: "repl",
    })
    expect(debugState.consoleOutput.value.map((entry) => `${entry.type}:${entry.text}`)).toEqual([
      "input:answer",
      "output:42",
    ])
    expect(debugState.actionEvidence.value.find((action) => action.action === "evaluate")).toEqual(expect.objectContaining({
      evidenceSafe: true,
      expressionLength: "answer".length,
      result: "succeeded",
    }))
  })

  it("adds REPL input and evaluate errors to the shared debug console model without double append", async () => {
    const transport = new FakeDapTransport()
    const manager = new DebugManager(transport)

    await manager.startSession({
      id: "cfg-node",
      name: "Node",
      type: "node",
      command: "node src/main.ts",
      workingDir: "D:/Workspace",
    })
    await waitFor(() => debugWorkbenchModel.getCallStack()[0]?.frames.length === 1)
    debugState.consoleOutput.value = []
    debugState.actionEvidence.value = []

    const result = await manager.evaluate("throwInRepl")

    expect(result).toBe("Error: fixture evaluate failed")
    expect(transport.requests.find((request) => request.command === "evaluate")?.arguments).toMatchObject({
      expression: "throwInRepl",
      frameId: 11,
      context: "repl",
    })
    expect(debugState.consoleOutput.value.map((entry) => `${entry.type}:${entry.text}`)).toEqual([
      "input:throwInRepl",
      "error:Error: fixture evaluate failed",
    ])
    expect(debugState.consoleOutput.value.filter((entry) => entry.type === "input" && entry.text === "throwInRepl")).toHaveLength(1)
    expect(debugState.consoleOutput.value.filter((entry) => entry.type === "error" && entry.text === "Error: fixture evaluate failed")).toHaveLength(1)
    expect(debugState.actionEvidence.value.find((action) => action.action === "evaluate")).toEqual(expect.objectContaining({
      evidenceSafe: true,
      expressionLength: "throwInRepl".length,
      result: "failed",
      reason: "fixture evaluate failed",
    }))
    expect(JSON.stringify(debugState.actionEvidence.value)).not.toContain("throwInRepl")
  })

  it("evaluates through a real external DAP adapter process before writing to debug console", async () => {
    const transport = new ExternalAdapterProcessTransport()
    const manager = new DebugManager(transport)

    try {
      await manager.startSession({
        id: "cfg-external-dap",
        name: "External DAP",
        type: "node",
        command: "node src/external-adapter.ts",
        workingDir: "D:/Workspace",
      })
      await waitFor(() => debugWorkbenchModel.getCallStack()[0]?.frames.length === 1)
      debugState.consoleOutput.value = []

      const result = await manager.evaluate("adapterBoundary")

      expect(transport.adapterPid).toEqual(expect.any(Number))
      expect(result).toBe("external-adapter-evaluate:adapterBoundary:frame=7701")
      expect(transport.observedRequests.find((request) => request.command === "evaluate")?.arguments).toMatchObject({
        expression: "adapterBoundary",
        frameId: 7701,
        context: "repl",
      })
      expect(debugState.consoleOutput.value.map((entry) => `${entry.type}:${entry.text}`)).toEqual([
        "input:adapterBoundary",
        "output:external-adapter-evaluate:adapterBoundary:frame=7701",
      ])
      expect(debugState.actionEvidence.value.find((action) => action.action === "evaluate")).toEqual(expect.objectContaining({
        evidenceSafe: true,
        expressionLength: "adapterBoundary".length,
        result: "succeeded",
      }))
    } finally {
      await manager.stopSession()
    }
  })

  it("projects DAP output events into the same debug console model", async () => {
    const transport = new FakeDapTransport()
    const manager = new DebugManager(transport)

    await manager.startSession({
      id: "cfg-node",
      name: "Node",
      type: "node",
      command: "node src/main.ts",
      workingDir: "D:/Workspace",
    })
    await waitFor(() => debugWorkbenchModel.getCallStack()[0]?.frames.length === 1)
    debugState.consoleOutput.value = []

    transport.emitAdapterEvent("output", { category: "stdout", output: "hello from adapter\n" })
    transport.emitAdapterEvent("output", { category: "stderr", output: "adapter error\n" })
    await waitFor(() => debugState.consoleOutput.value.length === 2)

    expect(debugState.consoleOutput.value.map((entry) => `${entry.type}:${entry.text}`)).toEqual([
      "output:hello from adapter\n",
      "error:adapter error\n",
    ])
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition")
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
