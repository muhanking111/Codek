import { reactive } from "vue"
import { DapClient, createCodekTransport } from "./dapClient"
import type { DapIpcTransport } from "./dapClient"
import type {
  Capabilities,
  Source,
  Thread,
  StackFrame as DapStackFrame,
  Scope,
  Variable as DapVariable,
  StoppedEventBody,
  Breakpoint as DapBreakpoint,
  OutputEventBody,
  ThreadEventBody,
  BreakpointEventBody,
  ContinuedEventBody,
  TerminatedEventBody,
} from "./dapProtocol"
import type {
  Breakpoint,
  StackFrame,
  VariableNode,
  ConsoleEntry,
  RunConfig,
  AdapterBreakpointUpdate,
} from "../components/debugState"
import {
  debugSessionService,
  debugState,
  debugWorkbenchModel,
  recordDebugActionEvidence,
  toggleBreakpoint,
} from "../components/debugState"
import { buildDapLaunchConfig } from "./launchConfig"

const MAX_STACK_FRAMES = 200
const MAX_VARIABLES = 1000
const INITIALIZED_TIMEOUT_MS = 10000
const CONSOLE_ID_PREFIX = "dap"

export type DebugSessionPhase =
  | "idle"
  | "initializing"
  | "configured"
  | "launching"
  | "running"
  | "paused"
  | "terminated"

export interface DebugSessionInfo {
  phase: DebugSessionPhase
  sessionId: string | null
  adapterType: string
  capabilities: Capabilities | null
  activeThreadId: number | null
  threads: Thread[]
  currentFrameId: number | null
  scopes: Scope[]
  variableCache: Map<number, DapVariable[]>
  sourceBreakpoints: Map<string, DapBreakpoint[]>
}

export class DebugManager {
  private client: DapClient | null = null
  private transport: DapIpcTransport
  private session = reactive<DebugSessionInfo>({
    phase: "idle",
    sessionId: null,
    adapterType: "",
    capabilities: null,
    activeThreadId: null,
    threads: [],
    currentFrameId: null,
    scopes: [],
    variableCache: new Map(),
    sourceBreakpoints: new Map(),
  })

  constructor(transport?: DapIpcTransport) {
    this.transport = transport ?? createCodekTransport()
  }

  get phase(): DebugSessionPhase {
    return this.session.phase
  }

  get sessionInfo(): DebugSessionInfo {
    return this.session
  }

  get isRunning(): boolean {
    return this.session.phase !== "idle" && this.session.phase !== "terminated"
  }

  get isPaused(): boolean {
    return this.session.phase === "paused"
  }

  async startSession(config: RunConfig): Promise<void> {
    if (this.isRunning) {
      await this.stopSession()
    }

    this.client = new DapClient(this.transport)
    this.session.phase = "initializing"
    this.session.adapterType = config.type
    this.resetSessionState()

    try {
      const launchConfig = buildDapLaunchConfig(config)
      launchConfig.confirmed = true
      const sid = await this.client.connect(config.type, launchConfig)
      this.session.sessionId = sid
      debugSessionService.startSession({
        sessionId: sid,
        adapterType: config.type,
        phase: "initializing",
      })
      recordDebugActionEvidence("start", { result: "succeeded" })

      const initializedPromise = this.createInitializedPromise()
      this.registerEventHandlers()

      const capabilities = await this.client.sendRequest("initialize", {
        clientID: "codek",
        clientName: "Codek IDE",
        adapterID: config.type,
        pathFormat: "file",
        linesStartAt1: true,
        columnsStartAt1: true,
        supportsVariableType: true,
        supportsVariablePaging: false,
        supportsRunInTerminalRequest: true,
        supportsProgressReporting: true,
        locale: "zh-CN",
      })
      this.session.capabilities = capabilities
      this.session.phase = "configured"
      debugSessionService.updateSession({
        capabilities: capabilities as unknown as Record<string, unknown>,
        phase: "configured",
      })

      await this.client.sendRequest("launch", {
        ...launchConfig,
        noDebug: false,
      })
      this.session.phase = "launching"
      debugSessionService.updateSession({ phase: "launching" })

      await this.raceWithTimeout(initializedPromise, INITIALIZED_TIMEOUT_MS)

      await this.sendInitialBreakpoints()

      if (capabilities.supportsConfigurationDoneRequest) {
        await this.client.sendRequest("configurationDone")
      }

      const phaseAfterConfiguration = this.session.phase as DebugSessionPhase
      if (phaseAfterConfiguration !== "paused") {
        this.session.phase = "running"
        debugSessionService.updateSession({ phase: "running", isRunning: true, paused: false })
      }
      debugState.isRunning.value = true
      this.appendConsole("system", `Debug session started (${config.type})`)
    } catch (error) {
      this.session.phase = "idle"
      debugSessionService.stopSession("idle")
      const msg = error instanceof Error ? error.message : "Unknown error"
      this.appendConsole("error", `Failed to start debug session: ${msg}`)
      recordDebugActionEvidence("start", { result: "failed", reason: msg })
      await this.cleanup()
    }
  }

  async stopSession(): Promise<void> {
    if (!this.client || this.session.phase === "idle") return

    try {
      if (this.session.capabilities?.supportsTerminateRequest) {
        await this.client.sendRequest("terminate", { restart: false })
      }
      await this.client.sendRequest("disconnect", {
        terminateDebuggee: true,
        restart: false,
      })
    } catch {
      // disconnect errors are non-critical
    }

    await this.cleanup()
    this.session.phase = "idle"
    debugSessionService.stopSession("idle")
    recordDebugActionEvidence("stop", { result: "succeeded" })
    this.appendConsole("system", "Debug session stopped")
  }

  async setBreakpointsForFile(file: string, breakpoints: readonly Breakpoint[]): Promise<void> {
    if (!this.client || this.session.phase === "idle") return

    const source: Source = { path: file }
    const sourceBps = breakpoints
      .filter((bp) => bp.enabled && bp.file === file)
      .map((bp) => ({
        line: bp.line,
        condition: bp.condition,
      }))

    const result = await this.client.sendRequest("setBreakpoints", {
      source,
      breakpoints: sourceBps.length > 0 ? sourceBps : undefined,
    })

    this.session.sourceBreakpoints.set(file, result.breakpoints)
    debugWorkbenchModel.updateBreakpointsFromAdapter(file, result.breakpoints.map((bp) => this.toAdapterBreakpointUpdate(bp)))
    recordDebugActionEvidence("setBreakpoints", {
      target: file,
      breakpointCount: sourceBps.length,
      result: "succeeded",
    })
  }

  async continue(): Promise<void> {
    const threadId = this.session.activeThreadId
    if (!this.client || threadId == null) return

    await this.client.sendRequest("continue", { threadId })
    this.session.phase = "running"
    debugState.paused.value = false
    recordDebugActionEvidence("continue", { threadId, result: "succeeded" })
  }

  async pause(): Promise<void> {
    const threadId = this.session.activeThreadId
    if (!this.client || threadId == null) return

    await this.client.sendRequest("pause", { threadId })
    recordDebugActionEvidence("pause", { threadId, result: "succeeded" })
  }

  async stepOver(): Promise<void> {
    const threadId = this.session.activeThreadId
    if (!this.client || threadId == null) return

    await this.client.sendRequest("next", { threadId })
    recordDebugActionEvidence("stepOver", { threadId, result: "succeeded" })
  }

  async stepIn(): Promise<void> {
    const threadId = this.session.activeThreadId
    if (!this.client || threadId == null) return

    await this.client.sendRequest("stepIn", { threadId })
    recordDebugActionEvidence("stepIn", { threadId, result: "succeeded" })
  }

  async stepOut(): Promise<void> {
    const threadId = this.session.activeThreadId
    if (!this.client || threadId == null) return

    await this.client.sendRequest("stepOut", { threadId })
    recordDebugActionEvidence("stepOut", { threadId, result: "succeeded" })
  }

  async fetchThreads(): Promise<void> {
    if (!this.client) return

    const result = await this.client.sendRequest("threads")
    this.session.threads = result.threads

    if (this.session.activeThreadId == null && result.threads.length > 0) {
      this.session.activeThreadId = result.threads[0].id
    }
    debugSessionService.setThreads(
      result.threads.map((thread) => ({
        id: thread.id,
        name: thread.name,
        stopped: this.session.phase === "paused" && thread.id === this.session.activeThreadId,
      })),
      this.session.activeThreadId,
    )
  }

  async fetchStackTrace(threadId: number): Promise<void> {
    if (!this.client) return

    const result = await this.client.sendRequest("stackTrace", {
      threadId,
      startFrame: 0,
      levels: MAX_STACK_FRAMES,
    })

    debugWorkbenchModel.setStackFrames(result.stackFrames.map((f) => this.convertStackFrame(f)), threadId)

    if (result.stackFrames.length > 0) {
      const topFrame = result.stackFrames[0]
      this.session.currentFrameId = topFrame.id
      debugSessionService.updateSession({ currentFrameId: topFrame.id })
      await this.fetchScopes(topFrame.id)
    }
  }

  async fetchScopes(frameId: number): Promise<void> {
    if (!this.client) return

    const result = await this.client.sendRequest("scopes", { frameId })
    this.session.scopes = result.scopes

    const allVariables: VariableNode[] = []
    for (const scope of result.scopes) {
      const node = await this.buildVariableNode(scope.name, scope.variablesReference)
      allVariables.push(node)
    }

    debugWorkbenchModel.setVariables(allVariables)
    await this.refreshWatchExpressions(frameId)
  }

  async fetchVariables(variablesReference: number): Promise<DapVariable[]> {
    if (!this.client) return []

    const cached = this.session.variableCache.get(variablesReference)
    if (cached) return cached

    const result = await this.client.sendRequest("variables", {
      variablesReference,
      count: MAX_VARIABLES,
    })

    this.session.variableCache.set(variablesReference, result.variables)
    return result.variables
  }

  async evaluate(expression: string, frameId?: number): Promise<string> {
    const trimmedExpression = expression.trim()
    if (!trimmedExpression) return ""

    this.appendConsole("input", trimmedExpression)

    if (!this.client) {
      const message = "Error: not connected"
      this.appendConsole("error", message)
      recordDebugActionEvidence("evaluate", { expressionLength: trimmedExpression.length, result: "failed", reason: "not connected" })
      return message
    }

    try {
      const result = await this.client.sendRequest("evaluate", {
        expression: trimmedExpression,
        frameId: frameId ?? this.session.currentFrameId ?? undefined,
        context: "repl",
      })
      const output = result.result
      this.appendConsole("output", output)
      recordDebugActionEvidence("evaluate", { expressionLength: trimmedExpression.length, result: "succeeded" })
      return result.result
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Evaluation failed"
      const output = `Error: ${msg}`
      this.appendConsole("error", output)
      recordDebugActionEvidence("evaluate", { expressionLength: trimmedExpression.length, result: "failed", reason: msg })
      return output
    }
  }

  async evaluateWatch(expression: string, frameId?: number): Promise<string> {
    if (!this.client) return "..."

    try {
      const result = await this.client.sendRequest("evaluate", {
        expression,
        frameId: frameId ?? this.session.currentFrameId ?? undefined,
        context: "watch",
      })
      return result.result
    } catch {
      return "<error>"
    }
  }

  selectFrame(frameId: number): void {
    this.session.currentFrameId = frameId
    debugSessionService.updateSession({ currentFrameId: frameId })
    void this.fetchScopes(frameId)
  }

  handleBreakpointToggle(file: string, line: number): void {
    toggleBreakpoint(file, line)

    if (this.client && this.isRunning) {
      const fileBps = debugState.breakpoints.value.filter((bp) => bp.file === file)
      void this.setBreakpointsForFile(file, fileBps)
    }
  }

  private createInitializedPromise(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.client) {
        resolve()
        return
      }
      const unsub = this.client.on("initialized", () => {
        unsub()
        resolve()
      })
    })
  }

  private registerEventHandlers(): void {
    if (!this.client) return

    this.client.on("stopped", (body) => this.handleStopped(body as StoppedEventBody))
    this.client.on("continued", (body) => this.handleContinued(body as ContinuedEventBody))
    this.client.on("terminated", (body) => this.handleTerminated(body as TerminatedEventBody))
    this.client.on("exited", () => {
      this.session.phase = "terminated"
    })
    this.client.on("thread", (body) => this.handleThreadEvent(body as ThreadEventBody))
    this.client.on("breakpoint", (body) => this.handleBreakpointEvent(body as BreakpointEventBody))
    this.client.on("output", (body) => this.handleOutput(body as OutputEventBody))
  }

  private async handleStopped(body: StoppedEventBody): Promise<void> {
    this.session.phase = "paused"

    if (body.threadId != null) {
      this.session.activeThreadId = body.threadId
    }
    debugSessionService.pauseSession({
      threadId: this.session.activeThreadId,
      reason: body.reason,
    })

    await this.fetchThreads()

    if (this.session.activeThreadId != null) {
      await this.fetchStackTrace(this.session.activeThreadId)
    }

    const desc = body.description ? ` - ${body.description}` : ""
    this.appendConsole("system", `Paused: ${body.reason}${desc}`)
  }

  private handleContinued(body: ContinuedEventBody): void {
    this.session.phase = "running"
    debugSessionService.continueSession({ allThreadsContinued: body.allThreadsContinued })
  }

  private async handleTerminated(body: TerminatedEventBody): Promise<void> {
    if (body.restart) {
      this.appendConsole("system", "Debug session restarting...")
      return
    }

    this.session.phase = "terminated"
    debugSessionService.stopSession("terminated")

    await this.cleanup()
    this.appendConsole("system", "Debug session terminated")
  }

  private handleThreadEvent(body: ThreadEventBody): void {
    void this.fetchThreads()
    if (body.reason === "started" && this.session.activeThreadId == null) {
      this.session.activeThreadId = body.threadId
      debugSessionService.updateSession({ activeThreadId: body.threadId })
    }
  }

  private handleBreakpointEvent(body: BreakpointEventBody): void {
    const bp = body.breakpoint
    const path = bp.source?.path
    if (!path) return

    const existing = this.session.sourceBreakpoints.get(path) ?? []

    if (body.reason === "new") {
      this.session.sourceBreakpoints.set(path, [...existing, bp])
    } else if (body.reason === "removed") {
      this.session.sourceBreakpoints.set(
        path,
        existing.filter((b) => b.id !== bp.id),
      )
    } else if (body.reason === "changed") {
      this.session.sourceBreakpoints.set(
        path,
        existing.map((b) => (b.id === bp.id ? bp : b)),
      )
    }
    debugWorkbenchModel.updateBreakpointsFromAdapter(path, [this.toAdapterBreakpointUpdate(bp)])
  }

  private handleOutput(body: OutputEventBody): void {
    const type: ConsoleEntry["type"] = body.category === "stderr" ? "error" : "output"
    this.appendConsole(type, body.output)
  }

  private async sendInitialBreakpoints(): Promise<void> {
    const fileGroups = this.groupBreakpointsByFile()

    for (const [file, bps] of fileGroups) {
      await this.setBreakpointsForFile(file, bps)
    }
  }

  private groupBreakpointsByFile(): Map<string, Breakpoint[]> {
    const groups = new Map<string, Breakpoint[]>()
    for (const bp of debugState.breakpoints.value) {
      const group = groups.get(bp.file) ?? []
      group.push(bp)
      groups.set(bp.file, group)
    }
    return groups
  }

  private async refreshWatchExpressions(frameId?: number): Promise<void> {
    for (const watch of debugState.watchEntries.value) {
      if (!watch.expression.trim()) continue
      try {
        const result = await this.client?.sendRequest("evaluate", {
          expression: watch.expression,
          frameId: frameId ?? this.session.currentFrameId ?? undefined,
          context: "watch",
        })
        debugWorkbenchModel.updateWatchExpression(watch.id, {
          value: result?.result ?? "...",
          type: result?.type ?? watch.type,
          variablesReference: result?.variablesReference ?? watch.variablesReference,
        })
      } catch {
        debugWorkbenchModel.updateWatchExpression(watch.id, {
          value: "<error>",
          type: "error",
        })
      }
    }
  }

  private async buildVariableNode(name: string, variablesReference: number): Promise<VariableNode> {
    const variables = await this.fetchVariables(variablesReference)
    return {
      name,
      value: `{${variables.length} items}`,
      type: "object",
      variablesReference,
      children: variables.map((v) => this.convertVariable(v)),
    }
  }

  private convertVariable(variable: DapVariable): VariableNode {
    const hasChildren = variable.variablesReference > 0
    return {
      name: variable.name,
      value: variable.value,
      type: this.inferVariableType(variable),
      variablesReference: variable.variablesReference,
      evaluateName: variable.evaluateName,
      children: hasChildren ? [] : undefined,
    }
  }

  private inferVariableType(variable: DapVariable): VariableNode["type"] {
    if (variable.type) {
      return this.inferTypeFromDapType(variable.type)
    }
    return this.inferTypeFromValue(variable.value, variable.variablesReference)
  }

  private inferTypeFromDapType(dapType: string): VariableNode["type"] {
    const lower = dapType.toLowerCase()
    if (lower.includes("string")) return "string"
    if (lower.includes("int") || lower.includes("float") || lower.includes("double") || lower.includes("number")) return "number"
    if (lower.includes("bool")) return "boolean"
    if (lower.includes("array") || lower.includes("list") || lower.includes("tuple")) return "array"
    if (lower.includes("func") || lower.includes("method") || lower.includes("lambda")) return "function"
    if (lower === "null" || lower === "none") return "null"
    if (lower === "undefined") return "undefined"
    if (lower.includes("map") || lower.includes("dict") || lower.includes("object") || lower.includes("class")) return "object"
    return "string"
  }

  private inferTypeFromValue(value: string, variablesReference: number): VariableNode["type"] {
    if (value === "null" || value === "None") return "null"
    if (value === "undefined") return "undefined"
    if (value.startsWith('"') || value.startsWith("'")) return "string"
    if (value.startsWith("[") || value.startsWith("(")) return "array"
    if (value.startsWith("{") || value.startsWith("Object")) return "object"
    if (value === "true" || value === "false") return "boolean"
    if (variablesReference > 0) return "object"
    if (!Number.isNaN(Number(value)) && value.trim() !== "") return "number"
    return "string"
  }

  private convertStackFrame(frame: DapStackFrame): StackFrame {
    return {
      id: frame.id,
      name: frame.name,
      file: frame.source?.path ?? frame.source?.name ?? "<unknown>",
      line: frame.line,
      column: frame.column,
    }
  }

  private toAdapterBreakpointUpdate(breakpoint: DapBreakpoint): AdapterBreakpointUpdate {
    return {
      id: breakpoint.id,
      line: breakpoint.line,
      verified: breakpoint.verified,
      source: breakpoint.source,
      message: breakpoint.message,
      adapterData: breakpoint,
    }
  }

  private async raceWithTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
    await Promise.race([promise, timeout])
  }

  private appendConsole(type: ConsoleEntry["type"], text: string): void {
    debugState.consoleOutput.value.push({
      id: `${CONSOLE_ID_PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      text,
      timestamp: Date.now(),
    })
  }

  private resetSessionState(): void {
    this.session.activeThreadId = null
    this.session.threads = []
    this.session.currentFrameId = null
    this.session.scopes = []
    this.session.variableCache.clear()
    this.session.sourceBreakpoints.clear()
  }

  private async cleanup(): Promise<void> {
    const finalPhase = this.session.phase === "terminated" ? "terminated" : "idle"
    if (this.client) {
      await this.client.disconnect()
      this.client = null
    }

    this.session.sessionId = null
    this.session.capabilities = null
    this.resetSessionState()
    debugSessionService.stopSession(finalPhase)
  }
}

let managerInstance: DebugManager | null = null

export function getDebugManager(): DebugManager {
  if (!managerInstance) {
    managerInstance = new DebugManager()
  }
  return managerInstance
}

export function resetDebugManager(): void {
  if (managerInstance) {
    void managerInstance.stopSession()
  }
  managerInstance = null
}
