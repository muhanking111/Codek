import { computed, reactive, ref } from "vue"
import { discoverRunConfigsFromFiles, parseVsCodeProfileTasksResource } from "../workbench/taskDiscovery"
import type { ResolvedProblemMatcher } from "../workbench/problemMatcher"

const BREAKPOINTS_KEY = "codek.debugBreakpoints.v1"
const CONFIGS_KEY = "codek.debugConfigs.v1"

export interface Breakpoint {
  id: string
  file: string
  line: number
  enabled: boolean
  condition?: string
  hitCondition?: string
  logMessage?: string
  verified?: boolean
  adapterData?: unknown
  source?: "debugState"
}

export interface RunConfig {
  id: string
  name: string
  type: "node" | "java" | "python" | "custom"
  command: string
  workingDir: string
  source?: "default" | "workspace" | "profile" | "user"
  group?: string
  dependsOn?: string[]
  dependsOrder?: "sequence" | "parallel"
  isBackground?: boolean
  backgroundStatus?: "inactive" | "active" | "ended"
  problemMatchers?: ResolvedProblemMatcher[]
  env?: Record<string, string>
  inputs?: Record<string, string>
}

export interface VariableNode {
  name: string
  value: string
  type: "string" | "number" | "boolean" | "object" | "array" | "function" | "undefined" | "null"
  variablesReference?: number
  evaluateName?: string
  children?: VariableNode[]
}

export interface WatchEntry {
  id: string
  expression: string
  value: string
  type: string
  variablesReference?: number
  evaluateName?: string
}

export interface StackFrame {
  id: number
  threadId?: number
  name: string
  file: string
  line: number
  column: number
}

export interface ConsoleEntry {
  id: string
  type: "input" | "output" | "error" | "system"
  text: string
  timestamp: number
}

export type DebugSessionPhase = "idle" | "initializing" | "configured" | "launching" | "running" | "paused" | "terminated"

export interface DebugThreadProjection {
  id: number
  name: string
  stopped: boolean
  frames: StackFrame[]
}

export interface DebugSessionProjection {
  sessionId: string | null
  adapterType: string
  phase: DebugSessionPhase
  capabilities: Record<string, unknown> | null
  activeThreadId: number | null
  threads: Array<{ id: number; name: string; stopped?: boolean }>
  currentFrameId: number | null
  stoppedReason?: string
  isRunning: boolean
  paused: boolean
  stateSource: "debugState"
}

export interface DebugActionEvidence {
  id: string
  action: "start" | "stop" | "setBreakpoints" | "continue" | "pause" | "stepOver" | "stepIn" | "stepOut" | "evaluate"
  timestamp: number
  sessionId: string | null
  phase: DebugSessionPhase
  adapterType: string
  stateSource: "debugState"
  evidenceSafe: true
  target?: string
  breakpointCount?: number
  threadId?: number | null
  allThreadsContinued?: boolean
  expressionLength?: number
  result?: "requested" | "succeeded" | "failed"
  reason?: string
}

export type DebugOwnerEvidenceArea = "callStack" | "breakpoints" | "watch" | "variables"

export type DebugOwnerEvidenceStatus = "connected" | "partial" | "blocked"

export interface DebugExternalEvidenceMetadata {
  source?: string
  serviceId?: string
  stateSource?: string
  sessions?: unknown[]
  debugTypes?: unknown[]
  adapterFactories?: unknown[]
  configurationProviders?: unknown[]
  constraints?: Record<string, unknown>
  [key: string]: unknown
}

export interface DebugExternalEvidenceUpdate {
  dapEvidence?: DebugExternalEvidenceMetadata | null
  bridgeEvidence?: DebugExternalEvidenceMetadata | null
}

export interface DebugOwnerEvidenceProjection {
  area: DebugOwnerEvidenceArea
  status: DebugOwnerEvidenceStatus
  owner: string
  viewOwner: string
  stateSource: "debugState"
  dapEvidenceSource: string
  bridgeEvidenceSource: string
  missingOwner: string
  fallbackProjection: boolean
  serviceConnected: boolean
  bridgeConnected: boolean
  itemCount: number
  viewId: string
  vscodeSourcePath: string
  currentSourcePath: "frontend/vite-project/src/components/debugState.ts"
  runtimeReference: false
}

export interface DebugBreakpointsOwnerEvidence {
  debugServiceOwner: "DebugWorkbenchModel"
  breakpointModelOwner: "debugState.breakpoints"
  breakpointSource: "debugState"
  debugSessionOwner: "debugSessionService"
  viewOwner: "运行调试证据投影"
  resourceUriKind: "file-path-string"
  remainingUiOwnerGap: string[]
  vscodeSourcePaths: {
    debugService: "src/vs/workbench/contrib/debug/browser/debugService.ts"
    debugModel: "src/vs/workbench/contrib/debug/common/debugModel.ts"
    breakpointsView: "src/vs/workbench/contrib/debug/browser/breakpointsView.ts"
    debugServiceInterface: "src/vs/workbench/contrib/debug/common/debug.ts"
  }
  currentSourcePath: "frontend/vite-project/src/components/debugState.ts"
  runtimeReference: false
}

export interface DebugOwnerEvidenceSnapshot {
  source: "codek.debug.ownerEvidenceProjection"
  stateSource: "debugState"
  dapEvidenceSource: string
  bridgeEvidenceSource: string
  serviceConnected: boolean
  bridgeConnected: boolean
  remainingUiGap: string
  debugServiceOwner: DebugBreakpointsOwnerEvidence["debugServiceOwner"]
  breakpointModelOwner: DebugBreakpointsOwnerEvidence["breakpointModelOwner"]
  breakpointSource: DebugBreakpointsOwnerEvidence["breakpointSource"]
  debugSessionOwner: DebugBreakpointsOwnerEvidence["debugSessionOwner"]
  viewOwner: DebugBreakpointsOwnerEvidence["viewOwner"]
  resourceUriKind: DebugBreakpointsOwnerEvidence["resourceUriKind"]
  remainingUiOwnerGap: DebugBreakpointsOwnerEvidence["remainingUiOwnerGap"]
  breakpointsOwnerEvidence: DebugBreakpointsOwnerEvidence
  callStack: DebugOwnerEvidenceProjection
  breakpoints: DebugOwnerEvidenceProjection
  watch: DebugOwnerEvidenceProjection
  variables: DebugOwnerEvidenceProjection
  constraints: {
    noSecondDebugState: true
    metadataOnlyEvidenceCannotConnectViewContainer: true
    noRuntimeSourceMirrorReference: true
  }
}

export interface DebugServiceContractSnapshot {
  source: "debugWorkbenchModel"
  serviceId: "debugService"
  vscodeServiceIds: ["IDebugService", "IDebugModel", "IConfigurationResolverService"]
  stateSource: "debugState"
  session: DebugSessionProjection
  breakpoints: {
    stateSource: "debugState"
    total: number
    enabled: number
    disabled: number
    verified: number
    files: string[]
    groups: ReturnType<DebugWorkbenchModel["getBreakpointGroups"]>
  }
  callStack: {
    stateSource: "debugState"
    threadCount: number
    frameCount: number
    activeThreadId: number | null
    currentFrameId: number | null
    threads: DebugThreadProjection[]
  }
  watches: {
    stateSource: "debugState"
    count: number
    evaluated: number
  }
  variables: {
    stateSource: "debugState"
    count: number
  }
  ownerEvidence: DebugOwnerEvidenceSnapshot
  actions: DebugActionEvidence[]
  constraints: {
    noSecondDebugState: true
    vscodeStyleServiceContract: true
    dapBoundaryOnly: true
    evidenceSafeActions: true
    preservesAgentEvidenceSafety: true
  }
}

export interface DebugModelProjectionUpdate {
  session?: Partial<Omit<DebugSessionProjection, "stateSource" | "isRunning" | "paused">> & {
    isRunning?: boolean
    paused?: boolean
  }
  stackFrames?: StackFrame[]
  variables?: VariableNode[]
  watches?: Array<Partial<WatchEntry> & { expression: string }>
}

export interface BreakpointRegistryOptions {
  enabled?: boolean
  condition?: string
  hitCondition?: string
  logMessage?: string
  verified?: boolean
  adapterData?: unknown
}

export interface AdapterBreakpointUpdate {
  line?: number
  verified?: boolean
  [key: string]: unknown
}

const DEFAULT_CONFIGS: RunConfig[] = [
  { id: "cfg-node-default", name: "Node.js: Launch Program", type: "node", command: "node ${file}", workingDir: "${workspaceFolder}", source: "default" },
  { id: "cfg-python-default", name: "Python: Current File", type: "python", command: "python ${file}", workingDir: "${workspaceFolder}", source: "default" },
  { id: "cfg-java-default", name: "Java: Launch", type: "java", command: "java ${fileBasenameNoExtension}", workingDir: "${workspaceFolder}", source: "default" },
]

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function loadBreakpoints(): Breakpoint[] {
  try {
    const raw = localStorage.getItem(BREAKPOINTS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persistBreakpoints(): void {
  try {
    localStorage.setItem(BREAKPOINTS_KEY, JSON.stringify(breakpoints.value))
  } catch {
    // ignore
  }
}

function loadConfigs(): RunConfig[] {
  try {
    const raw = localStorage.getItem(CONFIGS_KEY)
    const configs = raw ? JSON.parse(raw) as RunConfig[] : DEFAULT_CONFIGS
    return configs.map((config) => ({
      ...config,
      source: config.source || (config.id.startsWith("cfg-") ? "default" : "user"),
    }))
  } catch {
    return DEFAULT_CONFIGS
  }
}

function persistConfigs(): void {
  try {
    localStorage.setItem(CONFIGS_KEY, JSON.stringify(runConfigs))
  } catch {
    // ignore
  }
}

function findBreakpointIndex(file: string, line: number): number {
  return breakpoints.value.findIndex((bp) => bp.file === file && bp.line === line)
}

export const breakpoints = ref<Breakpoint[]>(loadBreakpoints())

export const runConfigs = reactive<RunConfig[]>(loadConfigs())

const activeConfigId = ref<string>("")

const sessionId = ref<string | null>(null)

const isRunning = ref<boolean>(false)

const variables = ref<VariableNode[]>([])

const watchEntries = ref<WatchEntry[]>([])

const stackFrames = ref<StackFrame[]>([])

const consoleOutput = ref<ConsoleEntry[]>([])

const actionEvidence = ref<DebugActionEvidence[]>([])

const externalEvidence = reactive<{
  dapEvidence: DebugExternalEvidenceMetadata | null
  bridgeEvidence: DebugExternalEvidenceMetadata | null
}>({
  dapEvidence: null,
  bridgeEvidence: null,
})

const paused = ref<boolean>(false)

const currentFrameId = ref<number | null>(null)

const sessionProjection = reactive<Omit<DebugSessionProjection, "isRunning" | "paused" | "stateSource">>({
  sessionId: null,
  adapterType: "",
  phase: "idle",
  capabilities: null,
  activeThreadId: null,
  threads: [],
  currentFrameId: null,
})

export const activeConfig = computed<RunConfig | undefined>(() =>
  runConfigs.find((c) => c.id === activeConfigId.value),
)

export const debugState = {
  breakpoints,
  runConfigs,
  activeConfigId,
  sessionId,
  isRunning,
  variables,
  watchEntries,
  stackFrames,
  consoleOutput,
  actionEvidence,
  paused,
  currentFrameId,
  activeConfig,
  sessionProjection,
  externalEvidence,
}

function normalizeBreakpoint(bp: Breakpoint): Breakpoint {
  return {
    ...bp,
    enabled: bp.enabled !== false,
    source: "debugState",
  }
}

function normalizeFrame(frame: StackFrame, fallbackThreadId: number | null = sessionProjection.activeThreadId): StackFrame {
  return {
    ...frame,
    threadId: frame.threadId ?? fallbackThreadId ?? undefined,
  }
}

function evidenceSource(evidence: DebugExternalEvidenceMetadata | null, fallback: string): string {
  if (!evidence) return ""
  const source = typeof evidence.source === "string" && evidence.source ? evidence.source : fallback
  const stateSource = typeof evidence.stateSource === "string" && evidence.stateSource ? evidence.stateSource : ""
  return stateSource ? `${source}/${stateSource}` : source
}

function hasEvidencePayload(evidence: DebugExternalEvidenceMetadata | null): boolean {
  if (!evidence) return false
  if (Array.isArray(evidence.sessions) && evidence.sessions.length >= 0) return true
  if (Array.isArray(evidence.debugTypes) && evidence.debugTypes.length >= 0) return true
  if (Array.isArray(evidence.adapterFactories) && evidence.adapterFactories.length >= 0) return true
  if (Array.isArray(evidence.configurationProviders) && evidence.configurationProviders.length >= 0) return true
  return Object.keys(evidence).length > 0
}

function ownerItemCount(area: DebugOwnerEvidenceArea, callStack: DebugThreadProjection[], breakpointList: Breakpoint[]): number {
  switch (area) {
    case "callStack":
      return callStack.reduce((count, thread) => count + thread.frames.length, 0)
    case "breakpoints":
      return breakpointList.length
    case "watch":
      return watchEntries.value.length
    case "variables":
      return variables.value.length
  }
}

function buildOwnerProjection(
  area: DebugOwnerEvidenceArea,
  options: {
    owner: string
    viewId: string
    vscodeSourcePath: string
    itemCount: number
    serviceConnected: boolean
    bridgeConnected: boolean
    dapEvidenceSource: string
    bridgeEvidenceSource: string
  },
): DebugOwnerEvidenceProjection {
  const hasExternalEvidence = options.serviceConnected || options.bridgeConnected
  const hasLocalProjection = options.itemCount > 0
  const status: DebugOwnerEvidenceStatus = hasLocalProjection && !hasExternalEvidence
    ? "connected"
    : hasExternalEvidence
      ? "partial"
      : "blocked"
  const missingOwner = status === "connected" ? "" : "Debug View Container UI owner"
  const viewOwner = status === "connected" ? options.owner : "Debug View Container UI owner"
  return {
    area,
    status,
    owner: options.owner,
    viewOwner,
    stateSource: "debugState",
    dapEvidenceSource: options.dapEvidenceSource,
    bridgeEvidenceSource: options.bridgeEvidenceSource,
    missingOwner,
    fallbackProjection: status !== "connected",
    serviceConnected: options.serviceConnected,
    bridgeConnected: options.bridgeConnected,
    itemCount: options.itemCount,
    viewId: options.viewId,
    vscodeSourcePath: options.vscodeSourcePath,
    currentSourcePath: "frontend/vite-project/src/components/debugState.ts",
    runtimeReference: false,
  }
}

const DEBUG_BREAKPOINTS_OWNER_EVIDENCE: DebugBreakpointsOwnerEvidence = {
  debugServiceOwner: "DebugWorkbenchModel",
  breakpointModelOwner: "debugState.breakpoints",
  breakpointSource: "debugState",
  debugSessionOwner: "debugSessionService",
  viewOwner: "运行调试证据投影",
  resourceUriKind: "file-path-string",
  remainingUiOwnerGap: [
    "Debug View Container / BreakpointsView owner 未在本后台线程接入",
    "App.vue/generic shell owner 未在本后台线程接入",
  ],
  vscodeSourcePaths: {
    debugService: "src/vs/workbench/contrib/debug/browser/debugService.ts",
    debugModel: "src/vs/workbench/contrib/debug/common/debugModel.ts",
    breakpointsView: "src/vs/workbench/contrib/debug/browser/breakpointsView.ts",
    debugServiceInterface: "src/vs/workbench/contrib/debug/common/debug.ts",
  },
  currentSourcePath: "frontend/vite-project/src/components/debugState.ts",
  runtimeReference: false,
}

function clearRuntimeProjection(phase: DebugSessionPhase): void {
  sessionProjection.sessionId = null
  sessionProjection.adapterType = ""
  sessionProjection.phase = phase
  sessionProjection.capabilities = null
  sessionProjection.activeThreadId = null
  sessionProjection.threads = []
  sessionProjection.currentFrameId = null
  delete sessionProjection.stoppedReason
  sessionId.value = null
  isRunning.value = false
  paused.value = false
  currentFrameId.value = null
  stackFrames.value = []
  variables.value = []
}

function upsertWatchExpression(update: Partial<WatchEntry> & { expression: string }): WatchEntry {
  const expression = update.expression.trim()
  const existing = watchEntries.value.find((entry) => entry.expression === expression)
  if (existing) {
    Object.assign(existing, update, { expression })
    return existing
  }
  const created: WatchEntry = {
    id: update.id || makeId("watch"),
    expression,
    value: update.value ?? "...",
    type: update.type ?? "any",
    variablesReference: update.variablesReference,
    evaluateName: update.evaluateName,
  }
  watchEntries.value.push(created)
  return created
}

class DebugWorkbenchModel {
  getSession(): DebugSessionProjection {
    return {
      ...sessionProjection,
      threads: sessionProjection.threads.map((thread) => ({ ...thread })),
      capabilities: sessionProjection.capabilities ? { ...sessionProjection.capabilities } : null,
      currentFrameId: currentFrameId.value,
      isRunning: isRunning.value,
      paused: paused.value,
      stateSource: "debugState",
    }
  }

  startSession(update: {
    sessionId: string
    adapterType: string
    phase?: DebugSessionPhase
    capabilities?: Record<string, unknown> | null
    activeThreadId?: number | null
    threads?: Array<{ id: number; name: string; stopped?: boolean }>
  }): DebugSessionProjection {
    sessionProjection.sessionId = update.sessionId
    sessionProjection.adapterType = update.adapterType
    sessionProjection.phase = update.phase ?? "initializing"
    sessionProjection.capabilities = update.capabilities ?? null
    sessionProjection.activeThreadId = update.activeThreadId ?? null
    sessionProjection.threads = update.threads ? update.threads.map((thread) => ({ ...thread })) : []
    sessionProjection.currentFrameId = null
    delete sessionProjection.stoppedReason
    sessionId.value = update.sessionId
    isRunning.value = true
    paused.value = false
    currentFrameId.value = null
    return this.getSession()
  }

  updateSession(update: DebugModelProjectionUpdate["session"] = {}): DebugSessionProjection {
    if (Object.prototype.hasOwnProperty.call(update, "sessionId")) {
      sessionProjection.sessionId = update.sessionId ?? null
      sessionId.value = update.sessionId ?? null
    }
    if (update.adapterType !== undefined) sessionProjection.adapterType = update.adapterType
    if (update.phase !== undefined) sessionProjection.phase = update.phase
    if (update.capabilities !== undefined) sessionProjection.capabilities = update.capabilities
    if (Object.prototype.hasOwnProperty.call(update, "activeThreadId")) sessionProjection.activeThreadId = update.activeThreadId ?? null
    if (update.threads !== undefined) sessionProjection.threads = update.threads.map((thread) => ({ ...thread }))
    if (Object.prototype.hasOwnProperty.call(update, "currentFrameId")) {
      sessionProjection.currentFrameId = update.currentFrameId ?? null
      currentFrameId.value = update.currentFrameId ?? null
    }
    if (update.stoppedReason !== undefined) sessionProjection.stoppedReason = update.stoppedReason
    if (update.isRunning !== undefined) isRunning.value = update.isRunning
    if (update.paused !== undefined) paused.value = update.paused
    return this.getSession()
  }

  pauseSession(update: {
    threadId?: number | null
    reason?: string
    stackFrames?: StackFrame[]
    variables?: VariableNode[]
  }): DebugSessionProjection {
    if (update.threadId != null) sessionProjection.activeThreadId = update.threadId
    sessionProjection.phase = "paused"
    sessionProjection.stoppedReason = update.reason
    isRunning.value = true
    paused.value = true

    sessionProjection.threads = sessionProjection.threads.map((thread) => ({
      ...thread,
      stopped: update.threadId == null || thread.id === update.threadId,
    }))
    if (update.threadId != null && !sessionProjection.threads.some((thread) => thread.id === update.threadId)) {
      sessionProjection.threads.push({ id: update.threadId, name: `Thread ${update.threadId}`, stopped: true })
    }

    if (update.stackFrames) this.setStackFrames(update.stackFrames, update.threadId ?? sessionProjection.activeThreadId)
    if (update.variables) this.setVariables(update.variables)
    return this.getSession()
  }

  continueSession(update: { allThreadsContinued?: boolean } = {}): DebugSessionProjection {
    sessionProjection.phase = "running"
    isRunning.value = true
    paused.value = false
    delete sessionProjection.stoppedReason
    sessionProjection.threads = sessionProjection.threads.map((thread) => ({ ...thread, stopped: false }))
    if (update.allThreadsContinued !== false) {
      stackFrames.value = []
      variables.value = []
      currentFrameId.value = null
      sessionProjection.currentFrameId = null
    }
    return this.getSession()
  }

  stopSession(phase: DebugSessionPhase = "idle"): DebugSessionProjection {
    clearRuntimeProjection(phase)
    return this.getSession()
  }

  setThreads(threads: Array<{ id: number; name: string; stopped?: boolean }>, activeThreadId = sessionProjection.activeThreadId): void {
    sessionProjection.threads = threads.map((thread) => ({ ...thread }))
    sessionProjection.activeThreadId = activeThreadId ?? threads[0]?.id ?? null
  }

  addBreakpoint(file: string, line: number, options: BreakpointRegistryOptions = {}): Breakpoint {
    const existing = breakpoints.value[findBreakpointIndex(file, line)]
    if (existing) return this.updateBreakpoint(existing.id, options) ?? normalizeBreakpoint(existing)
    const breakpoint = normalizeBreakpoint({
      id: makeId("bp"),
      file,
      line,
      enabled: options.enabled !== false,
      condition: options.condition,
      hitCondition: options.hitCondition,
      logMessage: options.logMessage,
      verified: options.verified,
      adapterData: options.adapterData,
    })
    breakpoints.value.push(breakpoint)
    persistBreakpoints()
    return breakpoint
  }

  toggleBreakpoint(file: string, line: number, options: BreakpointRegistryOptions = {}): Breakpoint | null {
    const idx = findBreakpointIndex(file, line)
    if (idx >= 0) {
      breakpoints.value.splice(idx, 1)
      persistBreakpoints()
      return null
    }
    return this.addBreakpoint(file, line, options)
  }

  updateBreakpoint(id: string, updates: BreakpointRegistryOptions): Breakpoint | null {
    const breakpoint = breakpoints.value.find((bp) => bp.id === id)
    if (!breakpoint) return null
    Object.assign(breakpoint, updates, { source: "debugState" as const })
    persistBreakpoints()
    return normalizeBreakpoint(breakpoint)
  }

  removeBreakpoint(id: string): boolean {
    const idx = breakpoints.value.findIndex((bp) => bp.id === id)
    if (idx < 0) return false
    breakpoints.value.splice(idx, 1)
    persistBreakpoints()
    return true
  }

  getBreakpoints(filter: { file?: string; enabledOnly?: boolean } = {}): Breakpoint[] {
    return breakpoints.value
      .filter((bp) => !filter.file || bp.file === filter.file)
      .filter((bp) => !filter.enabledOnly || bp.enabled)
      .map(normalizeBreakpoint)
      .sort((first, second) => first.file.localeCompare(second.file) || first.line - second.line)
  }

  updateBreakpointsFromAdapter(file: string, adapterBreakpoints: AdapterBreakpointUpdate[]): void {
    const localBreakpoints = this.getBreakpoints({ file, enabledOnly: true })
    adapterBreakpoints.forEach((adapterBreakpoint, index) => {
      const line = typeof adapterBreakpoint.line === "number" ? adapterBreakpoint.line : undefined
      const localBreakpoint = line != null
        ? localBreakpoints.find((bp) => bp.line === line)
        : localBreakpoints[index]
      if (!localBreakpoint) return
      this.updateBreakpoint(localBreakpoint.id, {
        verified: adapterBreakpoint.verified === true,
        adapterData: adapterBreakpoint,
      })
    })
  }

  getBreakpointGroups(): Array<{ file: string; breakpoints: Breakpoint[]; enabledCount: number; disabledCount: number }> {
    const groups = new Map<string, Breakpoint[]>()
    for (const breakpoint of this.getBreakpoints()) {
      const group = groups.get(breakpoint.file) ?? []
      group.push(breakpoint)
      groups.set(breakpoint.file, group)
    }
    return [...groups.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([file, group]) => ({
        file,
        breakpoints: group.sort((first, second) => first.line - second.line),
        enabledCount: group.filter((bp) => bp.enabled).length,
        disabledCount: group.filter((bp) => !bp.enabled).length,
      }))
  }

  setStackFrames(frames: StackFrame[], threadId = sessionProjection.activeThreadId): void {
    stackFrames.value = frames.map((frame) => normalizeFrame(frame, threadId))
    const topFrame = stackFrames.value[0]
    currentFrameId.value = topFrame?.id ?? null
    sessionProjection.currentFrameId = currentFrameId.value
  }

  getCallStack(): DebugThreadProjection[] {
    const threads = sessionProjection.threads.length
      ? sessionProjection.threads
      : sessionProjection.activeThreadId != null
        ? [{ id: sessionProjection.activeThreadId, name: `Thread ${sessionProjection.activeThreadId}`, stopped: paused.value }]
        : []
    return threads.map((thread) => ({
      id: thread.id,
      name: thread.name,
      stopped: thread.stopped ?? (paused.value && thread.id === sessionProjection.activeThreadId),
      frames: stackFrames.value.filter((frame) => frame.threadId === thread.id || (frame.threadId == null && thread.id === sessionProjection.activeThreadId)),
    }))
  }

  setVariables(nextVariables: VariableNode[]): void {
    variables.value = nextVariables
  }

  getVariables(): VariableNode[] {
    return variables.value
  }

  addWatchExpression(expression: string): WatchEntry | null {
    const normalized = expression.trim()
    if (!normalized) return null
    return upsertWatchExpression({ expression: normalized })
  }

  updateWatchExpression(id: string, updates: Partial<Omit<WatchEntry, "id" | "expression">>): WatchEntry | null {
    const watch = watchEntries.value.find((entry) => entry.id === id)
    if (!watch) return null
    Object.assign(watch, updates)
    return watch
  }

  removeWatchExpression(id: string): boolean {
    const idx = watchEntries.value.findIndex((w) => w.id === id)
    if (idx < 0) return false
    watchEntries.value.splice(idx, 1)
    return true
  }

  setWatchExpressions(updates: Array<Partial<WatchEntry> & { expression: string }>): void {
    watchEntries.value = []
    for (const update of updates) {
      upsertWatchExpression(update)
    }
  }

  getWatchExpressions(): WatchEntry[] {
    return watchEntries.value
  }

  recordActionEvidence(action: DebugActionEvidence["action"], detail: Partial<Omit<DebugActionEvidence, "id" | "action" | "timestamp" | "sessionId" | "phase" | "adapterType" | "stateSource" | "evidenceSafe">> = {}): DebugActionEvidence {
    const evidence: DebugActionEvidence = {
      id: makeId("debug-action"),
      action,
      timestamp: Date.now(),
      sessionId: sessionProjection.sessionId,
      phase: sessionProjection.phase,
      adapterType: sessionProjection.adapterType,
      stateSource: "debugState",
      evidenceSafe: true,
      ...detail,
    }
    actionEvidence.value.push(evidence)
    if (actionEvidence.value.length > 100) {
      actionEvidence.value = actionEvidence.value.slice(-100)
    }
    return evidence
  }

  getContractSnapshot(): DebugServiceContractSnapshot {
    const breakpointGroups = this.getBreakpointGroups()
    const breakpointList = this.getBreakpoints()
    const callStack = this.getCallStack()
    return {
      source: "debugWorkbenchModel",
      serviceId: "debugService",
      vscodeServiceIds: ["IDebugService", "IDebugModel", "IConfigurationResolverService"],
      stateSource: "debugState",
      session: this.getSession(),
      breakpoints: {
        stateSource: "debugState",
        total: breakpointList.length,
        enabled: breakpointList.filter((bp) => bp.enabled).length,
        disabled: breakpointList.filter((bp) => !bp.enabled).length,
        verified: breakpointList.filter((bp) => bp.verified).length,
        files: breakpointGroups.map((group) => group.file),
        groups: breakpointGroups,
      },
      callStack: {
        stateSource: "debugState",
        threadCount: callStack.length,
        frameCount: callStack.reduce((count, thread) => count + thread.frames.length, 0),
        activeThreadId: sessionProjection.activeThreadId,
        currentFrameId: currentFrameId.value,
        threads: callStack,
      },
      watches: {
        stateSource: "debugState",
        count: watchEntries.value.length,
        evaluated: watchEntries.value.filter((watch) => watch.value && watch.value !== "...").length,
      },
      variables: {
        stateSource: "debugState",
        count: variables.value.length,
      },
      ownerEvidence: getDebugOwnerEvidenceProjection(),
      actions: actionEvidence.value.map((action) => ({ ...action })),
      constraints: {
        noSecondDebugState: true,
        vscodeStyleServiceContract: true,
        dapBoundaryOnly: true,
        evidenceSafeActions: true,
        preservesAgentEvidenceSafety: true,
      },
    }
  }
}

export const debugWorkbenchModel = new DebugWorkbenchModel()

export const debugSessionService = {
  startSession: (update: Parameters<DebugWorkbenchModel["startSession"]>[0]) => debugWorkbenchModel.startSession(update),
  updateSession: (update?: DebugModelProjectionUpdate["session"]) => debugWorkbenchModel.updateSession(update),
  pauseSession: (update: Parameters<DebugWorkbenchModel["pauseSession"]>[0]) => debugWorkbenchModel.pauseSession(update),
  continueSession: (update?: Parameters<DebugWorkbenchModel["continueSession"]>[0]) => debugWorkbenchModel.continueSession(update),
  stopSession: (phase?: DebugSessionPhase) => debugWorkbenchModel.stopSession(phase),
  setThreads: (threads: Array<{ id: number; name: string; stopped?: boolean }>, activeThreadId?: number | null) => debugWorkbenchModel.setThreads(threads, activeThreadId),
}

export function recordDebugActionEvidence(action: DebugActionEvidence["action"], detail?: Parameters<DebugWorkbenchModel["recordActionEvidence"]>[1]): DebugActionEvidence {
  return debugWorkbenchModel.recordActionEvidence(action, detail)
}

export function getDebugServiceContractSnapshot(): DebugServiceContractSnapshot {
  return debugWorkbenchModel.getContractSnapshot()
}

export function updateDebugExternalEvidenceMetadata(update: DebugExternalEvidenceUpdate): DebugOwnerEvidenceSnapshot {
  if (Object.prototype.hasOwnProperty.call(update, "dapEvidence")) {
    externalEvidence.dapEvidence = update.dapEvidence ? { ...update.dapEvidence } : null
  }
  if (Object.prototype.hasOwnProperty.call(update, "bridgeEvidence")) {
    externalEvidence.bridgeEvidence = update.bridgeEvidence ? { ...update.bridgeEvidence } : null
  }
  return getDebugOwnerEvidenceProjection()
}

export function getDebugOwnerEvidenceProjection(): DebugOwnerEvidenceSnapshot {
  const callStack = debugWorkbenchModel.getCallStack()
  const breakpointList = debugWorkbenchModel.getBreakpoints()
  const dapEvidenceSource = evidenceSource(externalEvidence.dapEvidence, "desktopDebugService")
  const bridgeEvidenceSource = evidenceSource(externalEvidence.bridgeEvidence, "mainThreadDebugService")
  const serviceConnected = hasEvidencePayload(externalEvidence.dapEvidence)
  const bridgeConnected = hasEvidencePayload(externalEvidence.bridgeEvidence)
  const common = {
    serviceConnected,
    bridgeConnected,
    dapEvidenceSource,
    bridgeEvidenceSource,
  }
  return {
    source: "codek.debug.ownerEvidenceProjection",
    stateSource: "debugState",
    dapEvidenceSource,
    bridgeEvidenceSource,
    serviceConnected,
    bridgeConnected,
    remainingUiGap: "Debug View Container UI is not wired in this projection; metadata-only DAP/bridge evidence keeps debug views partial until the view owner is migrated.",
    debugServiceOwner: DEBUG_BREAKPOINTS_OWNER_EVIDENCE.debugServiceOwner,
    breakpointModelOwner: DEBUG_BREAKPOINTS_OWNER_EVIDENCE.breakpointModelOwner,
    breakpointSource: DEBUG_BREAKPOINTS_OWNER_EVIDENCE.breakpointSource,
    debugSessionOwner: DEBUG_BREAKPOINTS_OWNER_EVIDENCE.debugSessionOwner,
    viewOwner: DEBUG_BREAKPOINTS_OWNER_EVIDENCE.viewOwner,
    resourceUriKind: DEBUG_BREAKPOINTS_OWNER_EVIDENCE.resourceUriKind,
    remainingUiOwnerGap: [...DEBUG_BREAKPOINTS_OWNER_EVIDENCE.remainingUiOwnerGap],
    breakpointsOwnerEvidence: {
      ...DEBUG_BREAKPOINTS_OWNER_EVIDENCE,
      remainingUiOwnerGap: [...DEBUG_BREAKPOINTS_OWNER_EVIDENCE.remainingUiOwnerGap],
      vscodeSourcePaths: { ...DEBUG_BREAKPOINTS_OWNER_EVIDENCE.vscodeSourcePaths },
    },
    callStack: buildOwnerProjection("callStack", {
      ...common,
      owner: "DebugWorkbenchModel.getCallStack",
      viewId: "workbench.debug.callStackView",
      vscodeSourcePath: "src/vs/workbench/contrib/debug/browser/callStackView.ts",
      itemCount: ownerItemCount("callStack", callStack, breakpointList),
    }),
    breakpoints: buildOwnerProjection("breakpoints", {
      ...common,
      owner: "DebugWorkbenchModel.getBreakpoints",
      viewId: "workbench.debug.breakPointsView",
      vscodeSourcePath: "src/vs/workbench/contrib/debug/browser/breakpointsView.ts",
      itemCount: ownerItemCount("breakpoints", callStack, breakpointList),
    }),
    watch: buildOwnerProjection("watch", {
      ...common,
      owner: "DebugWorkbenchModel.getWatchExpressions",
      viewId: "workbench.debug.watchExpressionsView",
      vscodeSourcePath: "src/vs/workbench/contrib/debug/common/debugModel.ts",
      itemCount: ownerItemCount("watch", callStack, breakpointList),
    }),
    variables: buildOwnerProjection("variables", {
      ...common,
      owner: "DebugWorkbenchModel.getVariables",
      viewId: "workbench.debug.variablesView",
      vscodeSourcePath: "src/vs/workbench/contrib/debug/common/debugModel.ts",
      itemCount: ownerItemCount("variables", callStack, breakpointList),
    }),
    constraints: {
      noSecondDebugState: true,
      metadataOnlyEvidenceCannotConnectViewContainer: true,
      noRuntimeSourceMirrorReference: true,
    },
  }
}

export function setDebugModelProjection(update: DebugModelProjectionUpdate): void {
  if (update.session) debugWorkbenchModel.updateSession(update.session)
  if (update.stackFrames) debugWorkbenchModel.setStackFrames(update.stackFrames, update.session?.activeThreadId ?? sessionProjection.activeThreadId)
  if (update.variables) debugWorkbenchModel.setVariables(update.variables)
  if (update.watches) debugWorkbenchModel.setWatchExpressions(update.watches)
}

export function toggleBreakpoint(file: string, line: number, options: BreakpointRegistryOptions = {}): Breakpoint | null {
  return debugWorkbenchModel.toggleBreakpoint(file, line, options)
}

export function setBreakpointEnabled(id: string, enabled: boolean): void {
  debugWorkbenchModel.updateBreakpoint(id, { enabled })
}

export function removeBreakpoint(id: string): void {
  debugWorkbenchModel.removeBreakpoint(id)
}

export function addWatch(expression: string): WatchEntry | null {
  return debugWorkbenchModel.addWatchExpression(expression)
}

export function removeWatch(id: string): void {
  debugWorkbenchModel.removeWatchExpression(id)
}

export function addConfig(config: Omit<RunConfig, "id">): void {
  runConfigs.push({ ...config, source: config.source || "user", id: makeId("cfg") })
  persistConfigs()
}

export function mergeWorkspaceRunConfigs(configs: RunConfig[]): number {
  return mergeDiscoveredRunConfigs("workspace", configs)
}

export function mergeProfileRunConfigs(configs: RunConfig[]): number {
  return mergeDiscoveredRunConfigs("profile", configs)
}

export function applyProfileRunConfigsFromResource(tasksResource: string | undefined | null): number {
  return mergeProfileRunConfigs(parseVsCodeProfileTasksResource(tasksResource))
}

function mergeDiscoveredRunConfigs(source: "workspace" | "profile", configs: RunConfig[]): number {
  const previousActiveConfigId = activeConfigId.value
  for (let index = runConfigs.length - 1; index >= 0; index -= 1) {
    if (runConfigs[index].source === source) {
      runConfigs.splice(index, 1)
    }
  }

  const existingIds = new Set(runConfigs.map((config) => config.id))
  let added = 0
  for (const config of configs) {
    const id = source === "profile" && !config.id.startsWith("profile-") ? `profile-${config.id}` : config.id
    if (existingIds.has(id)) continue
    runConfigs.push({ ...config, id, source })
    existingIds.add(id)
    added += 1
  }

  if (previousActiveConfigId && runConfigs.some((config) => config.id === previousActiveConfigId)) {
    activeConfigId.value = previousActiveConfigId
  } else if (!activeConfigId.value && runConfigs[0]) {
    activeConfigId.value = runConfigs[0].id
  }
  persistConfigs()
  return added
}

export async function discoverWorkspaceRunConfigs(
  readFile: (path: string) => Promise<string | null | undefined>,
): Promise<RunConfig[]> {
  const configs = await discoverRunConfigsFromFiles(readFile)
  mergeWorkspaceRunConfigs(configs)
  return configs
}

export function updateConfig(id: string, updates: Partial<Omit<RunConfig, "id">>): void {
  const idx = runConfigs.findIndex((c) => c.id === id)
  if (idx >= 0) {
    Object.assign(runConfigs[idx], updates)
    persistConfigs()
  }
}

export function removeConfig(id: string): void {
  const idx = runConfigs.findIndex((c) => c.id === id)
  if (idx >= 0) {
    runConfigs.splice(idx, 1)
    if (activeConfigId.value === id) activeConfigId.value = ""
    persistConfigs()
  }
}

export function setActiveConfig(id: string): void {
  activeConfigId.value = id
}

export function selectFrame(frameId: number): void {
  currentFrameId.value = frameId
  sessionProjection.currentFrameId = frameId
}
