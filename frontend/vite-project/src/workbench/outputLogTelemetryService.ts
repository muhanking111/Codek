import { Emitter, type Event } from "../vscode-adapter/base/common/event"
import {
  DEFAULT_LOG_LEVEL,
  LogLevel,
  LogLevelToString,
  canLog,
  type ILogger,
} from "../vscode-adapter/platform/log/common/log"
import {
  getTelemetryLevel,
  isTelemetryEventAllowed,
  type TelemetryLevel,
} from "../telemetry/telemetryPolicy"
import { redactTelemetryPayload } from "./telemetryEvidenceRedaction"

export type OutputEntryLevel = "trace" | "debug" | "info" | "warn" | "error"

export interface OutputLogEntry {
  id: string
  channelName: string
  level: OutputEntryLevel
  message: string
  timestamp: number
  source: string
}

export type OutputChannelListener = (entries: OutputLogEntry[]) => void

export interface OutputChannelDescriptor {
  id: string
  label: string
  stateSource: "outputLogTelemetryService"
  entryCount: number
  user: boolean
  source: string
  sources: string[]
  log: boolean
  hidden: boolean
  visible: boolean
  lifecycle: "registered" | "disposed"
  logLevel?: string
  rotating?: OutputLogRotatingMetadata
}

export interface OutputSnapshot {
  serviceId: "outputService"
  stateSource: "outputLogTelemetryService"
  channelName: string
  activeChannelName: string
  visibleChannelName: string
  channelNames: string[]
  channelDescriptors: OutputChannelDescriptor[]
  entryCount: number
  warnCount: number
  errorCount: number
  isVisible: boolean
  updateMode: OutputChannelUpdateMode
  preview: string
  ownerEvidence: OutputLogOwnerEvidence
}

export interface TelemetryEvidence {
  type: TelemetryLevel
  name: string
  timestamp: number
  payload: Record<string, unknown>
  transport: "localEvidenceOnly"
  classification: "SystemMetaData" | "CallstackOrException"
  redaction: {
    secrets: boolean
    userPaths: boolean
  }
}

export interface CrashReportInput {
  processType: string
  reason?: string
  exitCode?: number | null
  dumpPath?: string
  workspacePath?: string
  stack?: string
  metadata?: Record<string, unknown>
}

export interface CrashReportEvidence {
  type: "crash"
  name: string
  timestamp: number
  transport: "localEvidenceOnly"
  classification: "SystemMetaData"
  metadata: Record<string, unknown>
  redaction: {
    secrets: boolean
    userPaths: boolean
    dumps: boolean
    stacks: boolean
  }
}

export interface LogProjectionEntry {
  channelName: string
  level: OutputEntryLevel
  source: string
  message: string
  timestamp: number
}

export interface OutputLogTelemetryServiceOptions {
  now?: () => number
  idFactory?: () => string
  maxEntriesPerChannel?: number
  maxTelemetryEvents?: number
  maxActionEvents?: number
}

export type OutputChannelUpdateMode = "append" | "replace" | "clear"

export interface OutputLogRotatingMetadata {
  resource: string
  maxEntries: number
  rotatedEntries: number
}

export interface OutputLogActionProjection {
  id: string
  action: "register" | "append" | "replace" | "clear" | "show" | "hide" | "dispose" | "setVisibility" | "setLogLevel"
  channelName: string
  timestamp: number
  stateSource: "outputLogTelemetryService"
  source?: string
  level?: OutputEntryLevel
  messageLength?: number
  messagePreview?: string
  preserveFocus?: boolean
  visible?: boolean
  logLevel?: string
}

export interface OutputLogOwnerEvidence {
  owner: "outputLogTelemetryService"
  rendererOwner: "OutputPanel"
  mainThreadOwner: "MainThreadOutputService"
  stateSource: "outputLogTelemetryService"
  outputServiceId: "outputService"
  logChannelOwner: "outputLogTelemetryService.createLogger"
  channelName: string
  channelCount: number
  actionCount: number
  evidenceState: "partial"
  uiOwnerState: "partial"
  remainingGap: string
  nextAuthorizedFiles: string[]
  vscodeSourceReferences: string[]
}

interface ChannelState {
  id: string
  label: string
  user: boolean
  sources: string[]
  log: boolean
  hidden: boolean
  lifecycle: "registered" | "disposed"
  logLevel?: LogLevel
  rotating?: OutputLogRotatingMetadata
}

interface CreateOutputChannelOptions {
  source?: string
  sources?: string[]
  user?: boolean
  log?: boolean
  hidden?: boolean
  logLevel?: LogLevel
  rotating?: OutputLogRotatingMetadata
}

interface CreateLoggerOptions {
  source?: string
  logLevel?: LogLevel
  hidden?: boolean
  rotating?: OutputLogRotatingMetadata
  user?: boolean
}

interface OutputLogFileEntry {
  timestamp: number
  logLevel: LogLevel
  level: OutputEntryLevel
  message: string
  source: string
}

export class CodekOutputChannel {
  private readonly listeners = new Set<OutputChannelListener>()

  constructor(
    readonly name: string,
    private readonly service: CodekOutputLogTelemetryService,
  ) {}

  get id(): string {
    return this.name
  }

  get label(): string {
    return this.name
  }

  append(message: string): void {
    this.service.append(this.name, message)
  }

  appendLine(message: string): void {
    this.service.appendLine(this.name, message)
  }

  replace(message: string): void {
    this.service.replaceChannel(this.name, String(message ?? ""))
  }

  trace(message: string): void {
    this.service.write(this.name, "trace", message)
  }

  debug(message: string): void {
    this.service.write(this.name, "debug", message)
  }

  info(message: string): void {
    this.service.write(this.name, "info", message)
  }

  warn(message: string): void {
    this.service.write(this.name, "warn", message)
  }

  error(message: string): void {
    this.service.write(this.name, "error", message)
  }

  clear(): void {
    this.service.clearChannel(this.name)
  }

  show(preserveFocus = true): void {
    this.service.showChannel(this.name, preserveFocus)
  }

  hide(): void {
    this.service.hideChannel(this.name)
  }

  update(mode: "append" | "replace" | "clear", till?: number): void {
    this.service.updateChannel(this.name, mode, till)
  }

  getEntries(): OutputLogEntry[] {
    return this.service.getEntries(this.name)
  }

  getLogEntries(): OutputLogFileEntry[] {
    return this.getEntries().map((entry) => ({
      timestamp: entry.timestamp,
      logLevel: fromEntryLevel(entry.level),
      level: entry.level,
      message: entry.message,
      source: entry.source,
    }))
  }

  dispose(): void {
    this.service.disposeChannel(this.name)
  }

  subscribe(listener: OutputChannelListener): () => void {
    this.listeners.add(listener)
    listener(this.getEntries())
    return () => { this.listeners.delete(listener) }
  }

  notify(entries: OutputLogEntry[]): void {
    const snapshot = [...entries]
    for (const listener of this.listeners) listener(snapshot)
  }
}

export class CodekOutputLogger implements ILogger {
  private readonly onDidChangeLogLevelEmitter = new Emitter<LogLevel>()
  readonly onDidChangeLogLevel: Event<LogLevel> = this.onDidChangeLogLevelEmitter.event
  private level: LogLevel

  constructor(
    private readonly service: CodekOutputLogTelemetryService,
    private readonly channelName: string,
    private readonly source: string,
    level: LogLevel = DEFAULT_LOG_LEVEL,
  ) {
    this.level = level
  }

  getLevel(): LogLevel {
    return this.level
  }

  setLevel(level: LogLevel): void {
    if (this.level === level) return
    this.level = level
    this.service.setChannelLogLevel(this.channelName, level)
    this.onDidChangeLogLevelEmitter.fire(level)
  }

  trace(message: string, ...args: unknown[]): void {
    this.write(LogLevel.Trace, message, args)
  }

  debug(message: string, ...args: unknown[]): void {
    this.write(LogLevel.Debug, message, args)
  }

  info(message: string, ...args: unknown[]): void {
    this.write(LogLevel.Info, message, args)
  }

  warn(message: string, ...args: unknown[]): void {
    this.write(LogLevel.Warning, message, args)
  }

  error(message: string | Error, ...args: unknown[]): void {
    this.write(LogLevel.Error, message instanceof Error ? message.message : message, args)
  }

  flush(): void {}

  dispose(): void {
    this.onDidChangeLogLevelEmitter.dispose()
  }

  private write(level: LogLevel, message: string, args: unknown[]): void {
    if (!canLog(this.level, level)) return
    this.service.write(this.channelName, toEntryLevel(level), formatLogMessage(message, args), this.source)
  }
}

export class CodekOutputLogTelemetryService {
  private readonly channels = new Map<string, CodekOutputChannel>()
  private readonly channelStates = new Map<string, ChannelState>()
  private readonly entries = new Map<string, OutputLogEntry[]>()
  private readonly serviceListeners = new Set<() => void>()
  private readonly telemetryEvidence: TelemetryEvidence[] = []
  private readonly crashReports: CrashReportEvidence[] = []
  private readonly actionProjection: OutputLogActionProjection[] = []
  private readonly lastUpdateMode = new Map<string, OutputChannelUpdateMode>()
  private readonly now: () => number
  private readonly idFactory: () => string
  private readonly maxEntriesPerChannel: number
  private readonly maxTelemetryEvents: number
  private readonly maxActionEvents: number
  private activeChannelName = "Workbench"
  private visibleChannelName = ""

  constructor(options: OutputLogTelemetryServiceOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.idFactory = options.idFactory ?? (() => `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    this.maxEntriesPerChannel = options.maxEntriesPerChannel ?? 5000
    this.maxTelemetryEvents = options.maxTelemetryEvents ?? 200
    this.maxActionEvents = options.maxActionEvents ?? 200
  }

  createOutputChannel(name: string, options: CreateOutputChannelOptions = {}): CodekOutputChannel {
    const channelName = normalizeOutputChannelName(name)
    const existing = this.channels.get(channelName)
    if (existing) {
      this.mergeChannelState(channelName, options)
      return existing
    }

    const channel = new CodekOutputChannel(channelName, this)
    this.channels.set(channelName, channel)
    if (!this.entries.has(channelName)) this.entries.set(channelName, [])
    this.channelStates.set(channelName, this.createChannelState(channelName, options))
    this.lastUpdateMode.set(channelName, this.lastUpdateMode.get(channelName) ?? "append")
    this.recordAction("register", channelName, { source: primarySource(options) })
    this.emitServiceChange()
    return channel
  }

  getOutputChannel(name: string): CodekOutputChannel {
    return this.createOutputChannel(name)
  }

  getChannel(name: string): CodekOutputChannel | undefined {
    return this.channels.get(normalizeOutputChannelName(name))
  }

  onDidChange(listener: () => void): () => void {
    this.serviceListeners.add(listener)
    listener()
    return () => { this.serviceListeners.delete(listener) }
  }

  getAllChannelNames(): string[] {
    return [...this.channels.keys()]
  }

  showChannel(name = this.activeChannelName, preserveFocus = true): void {
    const channelName = normalizeOutputChannelName(name)
    this.createOutputChannel(channelName)
    this.activeChannelName = channelName
    if (!preserveFocus) this.visibleChannelName = channelName
    this.recordAction("show", channelName, { preserveFocus })
    this.emitServiceChange()
  }

  hideChannel(name = this.visibleChannelName): void {
    const channelName = normalizeOutputChannelName(name)
    if (this.visibleChannelName === channelName) {
      this.visibleChannelName = ""
    }
    this.recordAction("hide", channelName)
    this.emitServiceChange()
  }

  append(name: string, message: string): void {
    this.write(name, "info", String(message ?? ""))
  }

  appendLine(name: string, message: string): void {
    this.write(name, "info", `${String(message ?? "")}\n`)
  }

  clearChannel(name = this.activeChannelName): void {
    const channelName = normalizeOutputChannelName(name)
    this.createOutputChannel(channelName)
    this.entries.set(channelName, [])
    this.lastUpdateMode.set(channelName, "clear")
    this.recordAction("clear", channelName)
    this.notify(channelName)
    this.emitServiceChange()
  }

  write(name: string, level: OutputEntryLevel, message: string, source = "outputChannel"): void {
    const channelName = normalizeOutputChannelName(name)
    this.createOutputChannel(channelName, { source })
    const entries = this.entries.get(channelName) ?? []
    entries.push({
      id: this.idFactory(),
      channelName,
      level,
      message,
      timestamp: this.now(),
      source,
    })
    this.entries.set(channelName, entries.slice(-this.maxEntriesPerChannel))
    this.lastUpdateMode.set(channelName, "append")
    this.recordAction("append", channelName, {
      source,
      level,
      messageLength: message.length,
      messagePreview: truncateMessagePreview(message),
    })
    this.notify(channelName)
    this.emitServiceChange()
  }

  replaceChannel(name: string, message: string, source = "outputChannel"): void {
    const channelName = normalizeOutputChannelName(name)
    this.createOutputChannel(channelName, { source })
    this.entries.set(channelName, [{
      id: this.idFactory(),
      channelName,
      level: "info",
      message,
      timestamp: this.now(),
      source,
    }])
    this.lastUpdateMode.set(channelName, "replace")
    this.recordAction("replace", channelName, {
      source,
      level: "info",
      messageLength: message.length,
      messagePreview: truncateMessagePreview(message),
    })
    this.notify(channelName)
    this.emitServiceChange()
  }

  updateChannel(name: string, mode: OutputChannelUpdateMode, till?: number): void {
    const channelName = normalizeOutputChannelName(name)
    this.createOutputChannel(channelName)
    if (mode === "clear") {
      this.clearChannel(channelName)
      return
    }
    if (mode === "replace" && typeof till === "number") {
      this.entries.set(channelName, this.getEntries(channelName).slice(0, till))
      this.notify(channelName)
    }
    this.lastUpdateMode.set(channelName, mode)
  }

  disposeChannel(name: string): void {
    const channelName = normalizeOutputChannelName(name)
    this.channels.delete(channelName)
    this.entries.set(channelName, [])
    const state = this.ensureChannelState(channelName)
    state.lifecycle = "disposed"
    this.channelStates.set(channelName, state)
    if (this.activeChannelName === channelName) this.activeChannelName = "Workbench"
    if (this.visibleChannelName === channelName) this.visibleChannelName = ""
    this.recordAction("dispose", channelName)
    this.emitServiceChange()
  }

  createLogger(
    channelName: string,
    options: CreateLoggerOptions = {},
  ): CodekOutputLogger {
    this.createOutputChannel(channelName, {
      source: options.source || normalizeOutputChannelName(channelName),
      user: options.user,
      log: true,
      hidden: options.hidden,
      logLevel: options.logLevel ?? DEFAULT_LOG_LEVEL,
      rotating: options.rotating,
    })
    return new CodekOutputLogger(
      this,
      normalizeOutputChannelName(channelName),
      options.source || normalizeOutputChannelName(channelName),
      options.logLevel ?? DEFAULT_LOG_LEVEL,
    )
  }

  getActiveChannelName(): string {
    return this.activeChannelName
  }

  getVisibleChannelName(): string {
    return this.visibleChannelName
  }

  getEntries(name: string): OutputLogEntry[] {
    return [...(this.entries.get(normalizeOutputChannelName(name)) ?? [])]
  }

  setChannelVisibility(name: string, visible: boolean): void {
    const channelName = normalizeOutputChannelName(name)
    const state = this.ensureChannelState(channelName)
    state.hidden = !visible
    state.lifecycle = "registered"
    this.channelStates.set(channelName, state)
    this.recordAction("setVisibility", channelName, { visible })
  }

  setChannelLogLevel(name: string, level: LogLevel): void {
    const channelName = normalizeOutputChannelName(name)
    const state = this.ensureChannelState(channelName)
    state.logLevel = level
    this.channelStates.set(channelName, state)
    this.recordAction("setLogLevel", channelName, { logLevel: LogLevelToString(level) })
  }

  getChannelDescriptor(name: string): OutputChannelDescriptor | undefined {
    const channelName = normalizeOutputChannelName(name)
    const state = this.channelStates.get(channelName)
    if (!state) return undefined
    const entries = this.entries.get(channelName) ?? []
    return {
      id: channelName,
      label: state.label,
      stateSource: "outputLogTelemetryService",
      entryCount: entries.length,
      user: state.user,
      source: latestSource(entries),
      sources: state.sources,
      log: state.log,
      hidden: state.hidden,
      visible: !state.hidden,
      lifecycle: state.lifecycle,
      logLevel: state.logLevel === undefined ? undefined : LogLevelToString(state.logLevel),
      rotating: state.rotating ? { ...state.rotating } : undefined,
    }
  }

  getChannelDescriptors(): OutputChannelDescriptor[] {
    return this.getAllChannelNames()
      .map((name) => this.getChannelDescriptor(name))
      .filter((descriptor): descriptor is OutputChannelDescriptor => Boolean(descriptor))
  }

  getOutputSnapshot(name = this.activeChannelName): OutputSnapshot {
    const channelName = normalizeOutputChannelName(name)
    const entries = this.getEntries(channelName)
    return {
      serviceId: "outputService",
      stateSource: "outputLogTelemetryService",
      channelName,
      activeChannelName: this.activeChannelName,
      visibleChannelName: this.visibleChannelName,
      channelNames: this.getAllChannelNames(),
      channelDescriptors: this.getChannelDescriptors(),
      entryCount: entries.length,
      warnCount: entries.filter((entry) => entry.level === "warn").length,
      errorCount: entries.filter((entry) => entry.level === "error").length,
      isVisible: this.visibleChannelName === channelName,
      updateMode: this.lastUpdateMode.get(channelName) ?? "append",
      preview: entries.map((entry) => entry.message).join("").slice(0, 2000),
      ownerEvidence: this.getOwnerEvidence(channelName),
    }
  }

  getOwnerEvidence(name = this.activeChannelName): OutputLogOwnerEvidence {
    const channelName = normalizeOutputChannelName(name)
    return {
      owner: "outputLogTelemetryService",
      rendererOwner: "OutputPanel",
      mainThreadOwner: "MainThreadOutputService",
      stateSource: "outputLogTelemetryService",
      outputServiceId: "outputService",
      logChannelOwner: "outputLogTelemetryService.createLogger",
      channelName,
      channelCount: this.getAllChannelNames().length,
      actionCount: this.actionProjection.length,
      evidenceState: "partial",
      uiOwnerState: "partial",
      remainingGap: "Full VS Code Output view ownership still requires App.vue/bottom-panel shell wiring; this evidence only proves the existing OutputPanel/read-only facade path.",
      nextAuthorizedFiles: [
        "frontend/vite-project/src/components/OutputPanel.vue",
        "frontend/vite-project/src/workbench/outputLogTelemetryService.ts",
        "desktop/services/extensions-host/mainThread/mainThreadOutputService.js",
        "scripts/electron-ui-smoke.js",
      ],
      vscodeSourceReferences: [
        "src/vs/workbench/services/output/common/output.ts",
        "src/vs/workbench/services/output/common/delayedLogChannel.ts",
        "src/vs/workbench/api/browser/mainThreadOutputService.ts",
        "src/vs/workbench/api/common/extHostOutput.ts",
      ],
    }
  }

  getLogProjection(): LogProjectionEntry[] {
    return this.getAllChannelNames().flatMap((name) =>
      this.getEntries(name).map((entry) => ({
        channelName: entry.channelName,
        level: entry.level,
        source: entry.source,
        message: entry.message,
        timestamp: entry.timestamp,
      })),
    )
  }

  recordTelemetryEvent(
    eventType: TelemetryLevel,
    name: string,
    payload: Record<string, unknown> = {},
  ): boolean {
    const level = getTelemetryLevel()
    if (!isTelemetryEventAllowed(level, eventType)) return false
    const evidence: TelemetryEvidence = {
      type: eventType,
      name,
      timestamp: this.now(),
      payload: redactTelemetryPayload(payload),
      transport: "localEvidenceOnly",
      classification: "SystemMetaData",
      redaction: {
        secrets: true,
        userPaths: true,
      },
    }
    this.telemetryEvidence.push(evidence)
    if (this.telemetryEvidence.length > this.maxTelemetryEvents) {
      this.telemetryEvidence.splice(0, this.telemetryEvidence.length - this.maxTelemetryEvents)
    }
    return true
  }

  recordCrashReport(input: CrashReportInput): boolean {
    const processType = sanitizeTelemetryToken(input.processType || "unknown")
    const metadata = redactTelemetryPayload({
      ...(input.metadata ?? {}),
      processType,
      reason: sanitizeTelemetryToken(input.reason || "unknown"),
      exitCode: typeof input.exitCode === "number" ? input.exitCode : undefined,
      dumpAvailable: Boolean(input.dumpPath),
      dumpPath: input.dumpPath ? "[REDACTED_DUMP_PATH]" : undefined,
      workspace: input.workspacePath ? "[WORKSPACE_PATH_REDACTED]" : undefined,
    })
    const allowed = this.recordTelemetryEvent("crash", `crash.${processType}`, metadata)
    if (!allowed) return false
    const evidence: CrashReportEvidence = {
      type: "crash",
      name: `crash.${processType}`,
      timestamp: this.now(),
      transport: "localEvidenceOnly",
      classification: "SystemMetaData",
      metadata,
      redaction: {
        secrets: true,
        userPaths: true,
        dumps: true,
        stacks: true,
      },
    }
    this.crashReports.push(evidence)
    if (this.crashReports.length > this.maxTelemetryEvents) {
      this.crashReports.splice(0, this.crashReports.length - this.maxTelemetryEvents)
    }
    return true
  }

  getTelemetryEvidence(): TelemetryEvidence[] {
    return this.telemetryEvidence.map((entry) => ({
      ...entry,
      payload: cloneRecord(entry.payload),
      redaction: { ...entry.redaction },
    }))
  }

  getCrashReports(): CrashReportEvidence[] {
    return this.crashReports.map((entry) => ({
      ...entry,
      metadata: cloneRecord(entry.metadata),
      redaction: { ...entry.redaction },
    }))
  }

  getActionProjection(): OutputLogActionProjection[] {
    return this.actionProjection.map((entry) => ({ ...entry }))
  }

  getEvidenceActionProjection(): OutputLogActionProjection[] {
    return this.actionProjection.map((entry) => ({
      ...entry,
      messagePreview: entry.messagePreview ? "[REDACTED]" : undefined,
    }))
  }

  reset(): void {
    this.channels.clear()
    this.channelStates.clear()
    this.entries.clear()
    this.telemetryEvidence.splice(0, this.telemetryEvidence.length)
    this.crashReports.splice(0, this.crashReports.length)
    this.actionProjection.splice(0, this.actionProjection.length)
    this.lastUpdateMode.clear()
    this.activeChannelName = "Workbench"
    this.visibleChannelName = ""
    this.emitServiceChange()
  }

  private notify(channelName: string): void {
    this.channels.get(channelName)?.notify(this.getEntries(channelName))
  }

  private emitServiceChange(): void {
    this.serviceListeners.forEach((listener) => listener())
  }

  private createChannelState(channelName: string, options: CreateOutputChannelOptions): ChannelState {
    const sources = normalizeSources(options)
    return {
      id: channelName,
      label: channelName,
      user: Boolean(options.user),
      sources,
      log: Boolean(options.log),
      hidden: Boolean(options.hidden),
      lifecycle: "registered",
      logLevel: options.logLevel,
      rotating: options.rotating ? { ...options.rotating } : undefined,
    }
  }

  private mergeChannelState(channelName: string, options: CreateOutputChannelOptions): void {
    const state = this.ensureChannelState(channelName)
    const sources = normalizeSources(options)
    if (sources.length) state.sources = [...new Set([...state.sources, ...sources])]
    if (options.user !== undefined) state.user = options.user
    if (options.log !== undefined) state.log = options.log
    if (options.hidden !== undefined) state.hidden = options.hidden
    if (options.logLevel !== undefined) state.logLevel = options.logLevel
    if (options.rotating) state.rotating = { ...options.rotating }
    state.lifecycle = "registered"
    this.channelStates.set(channelName, state)
  }

  private ensureChannelState(channelName: string): ChannelState {
    const existing = this.channelStates.get(channelName)
    if (existing) return { ...existing, sources: [...existing.sources], rotating: existing.rotating ? { ...existing.rotating } : undefined }
    return this.createChannelState(channelName, {})
  }

  private recordAction(
    action: OutputLogActionProjection["action"],
    channelName: string,
    extra: Partial<OutputLogActionProjection> = {},
  ): void {
    this.actionProjection.push({
      id: this.idFactory(),
      action,
      channelName,
      timestamp: this.now(),
      stateSource: "outputLogTelemetryService",
      ...extra,
    })
    if (this.actionProjection.length > this.maxActionEvents) {
      this.actionProjection.splice(0, this.actionProjection.length - this.maxActionEvents)
    }
  }
}

export function createOutputLogTelemetryService(
  options?: OutputLogTelemetryServiceOptions,
): CodekOutputLogTelemetryService {
  return new CodekOutputLogTelemetryService(options)
}

export const globalOutputLogTelemetryService = new CodekOutputLogTelemetryService()

export function normalizeOutputChannelName(value: string | undefined): string {
  return String(value || "Workbench").trim() || "Workbench"
}

function toEntryLevel(level: LogLevel): OutputEntryLevel {
  const label = LogLevelToString(level)
  return label === "warning" ? "warn" : label as OutputEntryLevel
}

function fromEntryLevel(level: OutputEntryLevel): LogLevel {
  switch (level) {
    case "trace": return LogLevel.Trace
    case "debug": return LogLevel.Debug
    case "info": return LogLevel.Info
    case "warn": return LogLevel.Warning
    case "error": return LogLevel.Error
  }
}

function formatLogMessage(message: string, args: unknown[]): string {
  if (!args.length) return message
  return [message, ...args.map(formatLogArg)].join(" ")
}

function formatLogArg(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function latestSource(entries: OutputLogEntry[]): string {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const source = entries[index]?.source
    if (source) return source
  }
  return "outputChannel"
}

function normalizeSources(options: CreateOutputChannelOptions): string[] {
  const values = [
    ...(options.sources ?? []),
    ...(options.source ? [options.source] : []),
  ]
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))]
}

function primarySource(options: CreateOutputChannelOptions): string | undefined {
  return normalizeSources(options)[0]
}

function truncateMessagePreview(message: string): string {
  return message.slice(0, 120)
}

function sanitizeTelemetryToken(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "unknown"
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}
