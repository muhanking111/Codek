import type { TerminalCommandRecord } from "./shellIntegration"

export type ShellType = "bash" | "powershell" | "cmd" | "gitbash" | "wsl" | "zsh"

export interface TerminalInstance {
  id: string
  instanceId: number
  name: string
  shellType: ShellType
  cwd: string
  ptyId: string | null
  pid: number | null
  exited: boolean
  exitCode: number | null
  createdAt: number
  groupId: string
  shellIntegrationAvailable: boolean
  activeCommand: TerminalCommandRecord | null
  recentCommands: TerminalCommandRecord[]
  profile: TerminalProfile
  environment: TerminalEnvironmentProjection
  lastTaskReuse: TerminalTaskReuseOwnerEvidence | null
}

type TerminalEventType = "created" | "closed" | "switched" | "updated"
type TerminalEventCallback = (event: TerminalEventType, terminalId: string) => void

export type TerminalEnvironmentValue = string | null | undefined

export interface TerminalProfile {
  id: ShellType
  profileName: string
  path: string
  args: string[]
  icon: string
  isDefault: boolean
}

export interface TerminalEnvironmentProjection {
  cwd: string
  env: Record<string, string>
  strictEnv: boolean
  source: "terminalProfileResolverService/terminalEnvironment"
}

export interface TerminalPtyHostBridgeProjection {
  source: "ptyHostService/ptyHostBridge"
  stateSource: "terminalManager"
  ptyId: string
  pid: number | null
  status: "detached" | "attached" | "exited"
}

export interface TerminalProcessLifecycleProjection {
  source: "terminalProcessLifecycle"
  stateSource: "terminalManager"
  status: "created" | "running" | "exited"
  pid: number | null
  exitCode: number | null
  uptimeMs: number
}

export interface TerminalCommandBoundaryProjection {
  source: "terminalShellIntegration/evidenceSafeCommandBoundary"
  stateSource: "terminalManager"
  shellIntegrationAvailable: boolean
  activeCommandLine: string
  recentCommandCount: number
  lastCommandLine: string
  lastExitCode: number | null
  requiresWorkspaceTrust: true
  writesGitIndex: false
}

export interface TerminalContractProjection {
  terminalId: string
  stateSource: "terminalManager"
  ptyHostBridge: TerminalPtyHostBridgeProjection
  processLifecycle: TerminalProcessLifecycleProjection
  commandBoundary: TerminalCommandBoundaryProjection
}

export interface TerminalTaskLaunchConfig {
  taskId: string
  taskName: string
  commandLine: string
  cwd: string
  group?: string
  shellType?: ShellType
  env?: Record<string, TerminalEnvironmentValue>
  strictEnv?: boolean
  reuseKind: "sameTask" | "idleTask"
  source: "TerminalTaskSystem.reuseTerminal(launchConfigs)"
}

export interface TerminalTaskReuseOwnerEvidence {
  success: boolean
  terminalId: string
  terminalInstanceId: number | null
  taskId: string
  taskName: string
  commandLine: string
  cwd: string
  group: string
  reuseKind: TerminalTaskLaunchConfig["reuseKind"]
  ptyId: string
  pid: number | null
  reason: string
  stateSource: "terminalManager/taskTerminalReuseOwner"
  vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts"
  currentSourcePath: "frontend/vite-project/src/terminal/terminalManager.ts"
  runtimeReference: false
}

export type TaskTerminalReusePanelKind = "dedicated" | "shared"
export type TaskTerminalReuseEventType =
  | "start"
  | "processStarted"
  | "active"
  | "inactive"
  | "processEnded"
  | "end"
  | "terminated"
  | "problemMatcherUpdated"

export interface TaskTerminalReuseRecordInput {
  taskId: string
  taskName: string
  terminalInstanceId: number | null | undefined
  processId: number | null
  runId: string
  executionId: string
  runType: "singleRun" | "background"
  panelKind?: TaskTerminalReusePanelKind
  group?: string
  eventType: TaskTerminalReuseEventType
}

export interface TaskTerminalReuseRegistryEntry {
  taskId: string
  taskName: string
  terminalId: string
  terminalInstanceId: number
  runId: string
  executionId: string
  runType: "singleRun" | "background"
  processId: number | null
  ptyId: string
  pid: number | null
  exitCode: number | null
  status: "active" | "idle" | "disposed"
  panelKind: TaskTerminalReusePanelKind
  group: string
  lastEventType: TaskTerminalReuseEventType
  updatedAt: number
  ownerSource: "terminalManager"
  stateSource: "terminalManager/taskTerminalReuseRegistry"
  shellLaunchConfig: {
    type: "Task"
    taskId: string
    taskName: string
    cwd: string
    shellType: ShellType
    tabActions: true
  }
  vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts"
  currentSourcePath: "frontend/vite-project/src/terminal/terminalManager.ts"
  runtimeReference: false
}

export interface TaskTerminalReuseRegistrySnapshot {
  source: "TaskTerminalReuseRegistry"
  stateSource: "terminalManager/taskTerminalReuseRegistry"
  sameTaskTerminals: TaskTerminalReuseRegistryEntry[]
  idleTaskTerminals: TaskTerminalReuseRegistryEntry[]
  sameTaskCount: number
  idleTaskCount: number
  supportsPhysicalReuse: false
  missingPhysicalReuseOwner: "terminal shell owner with reuseTerminal(launchConfigs)"
  constraints: {
    noSecondTaskState: true
    noExternalVscodeSourceReference: true
    runtimeReference: false
  }
  vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts"
  currentSourcePath: "frontend/vite-project/src/terminal/terminalManager.ts"
}

const MAX_TERMINALS = 5
const DEFAULT_SHELL: ShellType = "powershell"
const DEFAULT_TERMINAL_ENV = {
  TERM_PROGRAM: "codek",
  TERM_PROGRAM_VERSION: "codek-workbench",
  COLORTERM: "truecolor",
}

let terminals: TerminalInstance[] = []
let activeTerminalId = ""
let activeGroupId = "group-1"
let nextIdCounter = 0
let nextInstanceIdCounter = 0
const listeners: TerminalEventCallback[] = []
const sameTaskTerminals = new Map<string, TaskTerminalReuseRegistryEntry>()
const idleTaskTerminals = new Map<string, TaskTerminalReuseRegistryEntry>()

function makeTerminalId(): string {
  nextIdCounter += 1
  return `term-${Date.now()}-${nextIdCounter}`
}

function emitEvent(type: TerminalEventType, terminalId: string): void {
  for (const cb of listeners) {
    cb(type, terminalId)
  }
}

export function createTerminal(
  shellType: ShellType = DEFAULT_SHELL,
  cwd: string = "",
): TerminalInstance {
  if (terminals.length >= MAX_TERMINALS) {
    const oldest = terminals.reduce((prev, curr) =>
      curr.createdAt < prev.createdAt ? curr : prev,
    )
    closeTerminal(oldest.id)
  }

  const id = makeTerminalId()
  const index = terminals.filter((t) => t.shellType === shellType).length + 1
  const name = `${shellType} #${index}`

  const terminal: TerminalInstance = {
    id,
    instanceId: ++nextInstanceIdCounter,
    name,
    shellType,
    cwd,
    ptyId: null,
    pid: null,
    exited: false,
    exitCode: null,
    createdAt: Date.now(),
    groupId: activeGroupId,
    shellIntegrationAvailable: false,
    activeCommand: null,
    recentCommands: [],
    profile: resolveTerminalProfile(shellType),
    environment: createTerminalEnvironmentProjection({
      shellType,
      cwd,
    }),
    lastTaskReuse: null,
  }

  terminals.push(terminal)
  activeTerminalId = id
  emitEvent("created", id)
  return terminal
}

export function splitTerminal(
  shellType: ShellType = DEFAULT_SHELL,
  cwd: string = "",
): TerminalInstance {
  const active = getActiveTerminal()
  const terminal = createTerminal(shellType, cwd || active?.cwd || "")
  terminal.groupId = active?.groupId || activeGroupId
  activeGroupId = terminal.groupId
  emitEvent("updated", terminal.id)
  return terminal
}

export function attachPty(terminalId: string, ptyId: string, pid: number | null): void {
  const term = terminals.find((t) => t.id === terminalId)
  if (!term) return
  term.ptyId = ptyId
  term.pid = pid
  term.exited = false
  term.exitCode = null
  emitEvent("updated", terminalId)
}

export function markExited(terminalId: string, exitCode: number | null): void {
  const term = terminals.find((t) => t.id === terminalId)
  if (!term) return
  term.exited = true
  term.exitCode = exitCode
  emitEvent("updated", terminalId)
}

export function updateCwd(terminalId: string, cwd: string): void {
  const term = terminals.find((t) => t.id === terminalId)
  if (!term) return
  term.cwd = cwd
  emitEvent("updated", terminalId)
}

export function updateShellIntegration(
  terminalId: string,
  update: {
    available?: boolean
    cwd?: string
    activeCommand?: TerminalCommandRecord | null
    recentCommands?: TerminalCommandRecord[]
  },
): void {
  const term = terminals.find((t) => t.id === terminalId)
  if (!term) return
  if (typeof update.available === "boolean") term.shellIntegrationAvailable = update.available
  if (typeof update.cwd === "string") {
    term.cwd = update.cwd
    term.environment = createTerminalEnvironmentProjection({
      shellType: term.shellType,
      cwd: update.cwd,
      env: term.environment.env,
      strictEnv: term.environment.strictEnv,
    })
  }
  if ("activeCommand" in update) term.activeCommand = update.activeCommand ?? null
  if (update.recentCommands) term.recentCommands = update.recentCommands.slice(-20)
  emitEvent("updated", terminalId)
}

export function closeTerminal(terminalId: string): void {
  const index = terminals.findIndex((t) => t.id === terminalId)
  if (index < 0) return

  terminals.splice(index, 1)
  deleteTaskTerminalReuseEntriesByTerminalId(terminalId)

  if (activeTerminalId === terminalId) {
    if (terminals.length > 0) {
      const newActive = terminals[Math.min(index, terminals.length - 1)]
      activeTerminalId = newActive.id
      emitEvent("switched", newActive.id)
    } else {
      activeTerminalId = ""
    }
  }

  emitEvent("closed", terminalId)
}

export function switchTerminal(terminalId: string): void {
  const terminal = terminals.find((t) => t.id === terminalId)
  if (!terminal) return
  activeTerminalId = terminalId
  emitEvent("switched", terminalId)
}

export function getActiveTerminal(): TerminalInstance | null {
  return terminals.find((t) => t.id === activeTerminalId) ?? null
}

export function getActiveTerminalId(): string {
  return activeTerminalId
}

export function getVisibleTerminalIds(): string[] {
  const active = getActiveTerminal()
  const groupId = active?.groupId || activeGroupId
  return terminals.filter((t) => t.groupId === groupId).map((t) => t.id)
}

export function getAllTerminals(): TerminalInstance[] {
  return [...terminals]
}

export function getTerminalById(terminalId: string): TerminalInstance | null {
  return terminals.find((t) => t.id === terminalId) ?? null
}

export function getTerminalByInstanceId(instanceId: number | null | undefined): TerminalInstance | null {
  if (typeof instanceId !== "number") return null
  return terminals.find((t) => t.instanceId === instanceId) ?? null
}

export function canReuseTaskTerminal(
  instanceId: number | null | undefined,
  launchConfig?: Partial<TerminalTaskLaunchConfig>,
): boolean {
  const terminal = getTerminalByInstanceId(instanceId)
  if (!terminal || terminal.exited) return false
  if (launchConfig?.shellType && terminal.shellType !== launchConfig.shellType) return false
  return true
}

export function reuseTaskTerminalForLaunchConfig(
  instanceId: number,
  launchConfig: TerminalTaskLaunchConfig,
): TerminalTaskReuseOwnerEvidence {
  const terminal = getTerminalByInstanceId(instanceId)
  if (!terminal) {
    return unavailableTaskReuseOwnerResult(instanceId, launchConfig, "terminal instance not found")
  }
  if (!canReuseTaskTerminal(instanceId, launchConfig)) {
    return unavailableTaskReuseOwnerResult(instanceId, launchConfig, "terminal instance is not available for task reuse", terminal)
  }

  terminal.cwd = launchConfig.cwd || terminal.cwd
  if (launchConfig.shellType) {
    terminal.shellType = launchConfig.shellType
    terminal.profile = resolveTerminalProfile(launchConfig.shellType)
  }
  terminal.environment = createTerminalEnvironmentProjection({
    shellType: terminal.shellType,
    cwd: terminal.cwd,
    env: launchConfig.env ?? terminal.environment.env,
    strictEnv: launchConfig.strictEnv ?? terminal.environment.strictEnv,
  })
  activeTerminalId = terminal.id

  const evidence: TerminalTaskReuseOwnerEvidence = {
    success: true,
    terminalId: terminal.id,
    terminalInstanceId: terminal.instanceId,
    taskId: launchConfig.taskId,
    taskName: launchConfig.taskName,
    commandLine: launchConfig.commandLine,
    cwd: terminal.cwd,
    group: launchConfig.group || "",
    reuseKind: launchConfig.reuseKind,
    ptyId: terminal.ptyId || "",
    pid: terminal.pid,
    reason: "terminalManager reused the existing terminal instance for VS Code-style task launch config",
    stateSource: "terminalManager/taskTerminalReuseOwner",
    vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
    currentSourcePath: "frontend/vite-project/src/terminal/terminalManager.ts",
    runtimeReference: false,
  }
  terminal.lastTaskReuse = evidence
  emitEvent("updated", terminal.id)
  emitEvent("switched", terminal.id)
  return evidence
}

export function onTerminalEvent(callback: TerminalEventCallback): () => void {
  listeners.push(callback)
  return () => {
    const idx = listeners.indexOf(callback)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}

export function getShellTypes(): ShellType[] {
  return ["powershell", "cmd", "gitbash", "wsl", "bash", "zsh"]
}

export function getShellLabel(shellType: ShellType): string {
  const labels: Record<ShellType, string> = {
    bash: "Bash",
    powershell: "PowerShell",
    cmd: "CMD",
    gitbash: "Git Bash",
    wsl: "WSL",
    zsh: "Zsh",
  }
  return labels[shellType]
}

export function getTerminalProfiles(): TerminalProfile[] {
  return getShellTypes().map(resolveTerminalProfile)
}

export function resolveTerminalProfile(shellType: ShellType = DEFAULT_SHELL): TerminalProfile {
  const pathByShell: Record<ShellType, string> = {
    bash: "bash",
    powershell: "powershell.exe",
    cmd: "cmd.exe",
    gitbash: "C:/Program Files/Git/bin/bash.exe",
    wsl: "wsl.exe",
    zsh: "zsh",
  }
  const argsByShell: Record<ShellType, string[]> = {
    bash: ["--login"],
    powershell: ["-NoLogo"],
    cmd: [],
    gitbash: ["--login", "-i"],
    wsl: [],
    zsh: ["-l"],
  }
  return {
    id: shellType,
    profileName: getShellLabel(shellType),
    path: pathByShell[shellType],
    args: argsByShell[shellType],
    icon: shellType === "powershell" ? "terminal-powershell" : "terminal",
    isDefault: shellType === DEFAULT_SHELL,
  }
}

export function createTerminalEnvironmentProjection(options: {
  shellType?: ShellType
  cwd?: string
  baseEnv?: Record<string, TerminalEnvironmentValue>
  env?: Record<string, TerminalEnvironmentValue>
  strictEnv?: boolean
} = {}): TerminalEnvironmentProjection {
  const env: Record<string, string> = {}
  if (!options.strictEnv) mergeEnvironment(env, options.baseEnv || DEFAULT_TERMINAL_ENV)
  mergeEnvironment(env, options.env)
  env.TERM_PROGRAM = env.TERM_PROGRAM || DEFAULT_TERMINAL_ENV.TERM_PROGRAM
  env.COLORTERM = env.COLORTERM || DEFAULT_TERMINAL_ENV.COLORTERM
  env.CODEK_TERMINAL_PROFILE = options.shellType || DEFAULT_SHELL
  return {
    cwd: options.cwd || "",
    env,
    strictEnv: options.strictEnv === true,
    source: "terminalProfileResolverService/terminalEnvironment",
  }
}

function mergeEnvironment(target: Record<string, string>, source?: Record<string, TerminalEnvironmentValue>): void {
  if (!source) return
  for (const [key, value] of Object.entries(source)) {
    if (!key) continue
    if (typeof value === "string") target[key] = value
    else if (value === null) delete target[key]
  }
}

export function createTerminalContractProjection(
  terminal: TerminalInstance,
  now = Date.now(),
): TerminalContractProjection {
  const recentCommands = terminal.recentCommands || []
  const lastCommand = recentCommands[recentCommands.length - 1] || terminal.activeCommand
  const hasPty = Boolean(terminal.ptyId)
  const ptyStatus: TerminalPtyHostBridgeProjection["status"] = terminal.exited
    ? "exited"
    : hasPty
      ? "attached"
      : "detached"
  const processStatus: TerminalProcessLifecycleProjection["status"] = terminal.exited
    ? "exited"
    : terminal.pid
      ? "running"
      : "created"

  return {
    terminalId: terminal.id,
    stateSource: "terminalManager",
    ptyHostBridge: {
      source: "ptyHostService/ptyHostBridge",
      stateSource: "terminalManager",
      ptyId: terminal.ptyId || "",
      pid: terminal.pid,
      status: ptyStatus,
    },
    processLifecycle: {
      source: "terminalProcessLifecycle",
      stateSource: "terminalManager",
      status: processStatus,
      pid: terminal.pid,
      exitCode: terminal.exitCode,
      uptimeMs: Math.max(0, now - terminal.createdAt),
    },
    commandBoundary: {
      source: "terminalShellIntegration/evidenceSafeCommandBoundary",
      stateSource: "terminalManager",
      shellIntegrationAvailable: terminal.shellIntegrationAvailable,
      activeCommandLine: terminal.activeCommand?.commandLine || "",
      recentCommandCount: recentCommands.length,
      lastCommandLine: lastCommand?.commandLine || "",
      lastExitCode: lastCommand?.exitCode ?? null,
      requiresWorkspaceTrust: true,
      writesGitIndex: false,
    },
  }
}

export function getTerminalContractProjections(now = Date.now()): TerminalContractProjection[] {
  return terminals.map((terminal) => createTerminalContractProjection(terminal, now))
}

export function recordTaskTerminalReuse(input: TaskTerminalReuseRecordInput, now = Date.now()): TaskTerminalReuseRegistryEntry | null {
  const terminal = getTerminalByInstanceId(input.terminalInstanceId)
  if (!terminal || !input.taskId) return null
  const panelKind = input.panelKind || (input.runType === "background" ? "dedicated" : "shared")
  const status = input.eventType === "terminated"
    ? "disposed"
    : input.eventType === "end" || input.eventType === "processEnded" || input.eventType === "inactive" || terminal.exited
      ? "idle"
      : "active"
  const entry: TaskTerminalReuseRegistryEntry = {
    taskId: input.taskId,
    taskName: input.taskName,
    terminalId: terminal.id,
    terminalInstanceId: terminal.instanceId,
    runId: input.runId,
    executionId: input.executionId,
    runType: input.runType,
    processId: input.processId ?? null,
    ptyId: terminal.ptyId || "",
    pid: terminal.pid,
    exitCode: terminal.exitCode,
    status,
    panelKind,
    group: input.group || terminal.groupId || "",
    lastEventType: input.eventType,
    updatedAt: now,
    ownerSource: "terminalManager",
    stateSource: "terminalManager/taskTerminalReuseRegistry",
    shellLaunchConfig: {
      type: "Task",
      taskId: input.taskId,
      taskName: input.taskName,
      cwd: terminal.cwd,
      shellType: terminal.shellType,
      tabActions: true,
    },
    vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
    currentSourcePath: "frontend/vite-project/src/terminal/terminalManager.ts",
    runtimeReference: false,
  }

  deleteTaskTerminalReuseEntriesByTerminalId(terminal.id)
  deleteTaskTerminalReuseEntriesByTaskId(input.taskId)
  if (status === "disposed") return entry
  if (panelKind === "dedicated") {
    sameTaskTerminals.set(input.taskId, entry)
  } else {
    idleTaskTerminals.set(input.taskId, entry)
  }
  return { ...entry, shellLaunchConfig: { ...entry.shellLaunchConfig } }
}

export function getTaskTerminalReuseRegistrySnapshot(): TaskTerminalReuseRegistrySnapshot {
  refreshTaskTerminalReuseEntries()
  const sameTask = copyTaskTerminalReuseEntries([...sameTaskTerminals.values()])
  const idleTask = copyTaskTerminalReuseEntries([...idleTaskTerminals.values()])
  return {
    source: "TaskTerminalReuseRegistry",
    stateSource: "terminalManager/taskTerminalReuseRegistry",
    sameTaskTerminals: sameTask,
    idleTaskTerminals: idleTask,
    sameTaskCount: sameTask.length,
    idleTaskCount: idleTask.length,
    supportsPhysicalReuse: false,
    missingPhysicalReuseOwner: "terminal shell owner with reuseTerminal(launchConfigs)",
    constraints: {
      noSecondTaskState: true,
      noExternalVscodeSourceReference: true,
      runtimeReference: false,
    },
    vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
    currentSourcePath: "frontend/vite-project/src/terminal/terminalManager.ts",
  }
}

function refreshTaskTerminalReuseEntries(): void {
  for (const [taskId, entry] of [...sameTaskTerminals.entries()]) {
    const terminal = getTerminalById(entry.terminalId)
    if (!terminal) {
      sameTaskTerminals.delete(taskId)
      continue
    }
    sameTaskTerminals.set(taskId, syncTaskTerminalReuseEntry(entry, terminal))
  }
  for (const [taskId, entry] of [...idleTaskTerminals.entries()]) {
    const terminal = getTerminalById(entry.terminalId)
    if (!terminal) {
      idleTaskTerminals.delete(taskId)
      continue
    }
    idleTaskTerminals.set(taskId, syncTaskTerminalReuseEntry(entry, terminal))
  }
}

function syncTaskTerminalReuseEntry(
  entry: TaskTerminalReuseRegistryEntry,
  terminal: TerminalInstance,
): TaskTerminalReuseRegistryEntry {
  return {
    ...entry,
    ptyId: terminal.ptyId || "",
    pid: terminal.pid,
    exitCode: terminal.exitCode,
    status: terminal.exited ? "idle" : entry.status,
    shellLaunchConfig: {
      ...entry.shellLaunchConfig,
      cwd: terminal.cwd,
      shellType: terminal.shellType,
    },
  }
}

function deleteTaskTerminalReuseEntriesByTerminalId(terminalId: string): void {
  for (const [taskId, entry] of [...sameTaskTerminals.entries()]) {
    if (entry.terminalId === terminalId) sameTaskTerminals.delete(taskId)
  }
  for (const [taskId, entry] of [...idleTaskTerminals.entries()]) {
    if (entry.terminalId === terminalId) idleTaskTerminals.delete(taskId)
  }
}

function deleteTaskTerminalReuseEntriesByTaskId(taskId: string): void {
  sameTaskTerminals.delete(taskId)
  idleTaskTerminals.delete(taskId)
}

function copyTaskTerminalReuseEntries(entries: TaskTerminalReuseRegistryEntry[]): TaskTerminalReuseRegistryEntry[] {
  return entries.map((entry) => ({
    ...entry,
    shellLaunchConfig: { ...entry.shellLaunchConfig },
  }))
}

export interface TerminalOwnerTerminationResult {
  success: boolean
  terminalId: string
  terminalInstanceId: number | null
  ptyId: string
  pid: number | null
  exitCode: number | null
  reason?: string
  stateSource: "terminalManager/terminalOwnerApi"
}

interface TerminalPtyApi {
  dispose: (id: string) => boolean | Promise<boolean>
  onExit: (callback: (payload: { id: string; exitCode?: number | null; code?: number | null }) => void) => () => void
}

function getTerminalPtyApi(): TerminalPtyApi | null {
  const api = (globalThis as { codek?: { pty?: Partial<TerminalPtyApi> } }).codek?.pty
  if (!api || typeof api.dispose !== "function" || typeof api.onExit !== "function") return null
  return api as TerminalPtyApi
}

export function canTerminateTerminalByInstanceId(instanceId: number | null | undefined): boolean {
  const terminal = getTerminalByInstanceId(instanceId)
  return Boolean(terminal?.ptyId && !terminal.exited && getTerminalPtyApi())
}

export async function terminateTerminalByInstanceId(
  instanceId: number,
  timeoutMs = 5000,
): Promise<TerminalOwnerTerminationResult> {
  const terminal = getTerminalByInstanceId(instanceId)
  if (!terminal) {
    return unavailableTerminalOwnerResult(instanceId, "terminal instance not found")
  }
  if (!terminal.ptyId || terminal.exited) {
    return unavailableTerminalOwnerResult(instanceId, "terminal instance has no running pty owner", terminal)
  }

  const api = getTerminalPtyApi()
  if (!api) {
    return unavailableTerminalOwnerResult(instanceId, "window.codek.pty dispose/onExit owner API unavailable", terminal)
  }

  return new Promise<TerminalOwnerTerminationResult>((resolve) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let unsubscribe = () => {}
    const finish = (result: TerminalOwnerTerminationResult) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      unsubscribe()
      resolve(result)
    }

    unsubscribe = api.onExit((payload) => {
      if (payload.id !== terminal.ptyId) return
      const exitCode = payload.exitCode ?? payload.code ?? null
      markExited(terminal.id, exitCode)
      closeTerminal(terminal.id)
      finish({
        success: true,
        terminalId: terminal.id,
        terminalInstanceId: terminal.instanceId,
        ptyId: terminal.ptyId || "",
        pid: terminal.pid,
        exitCode,
        stateSource: "terminalManager/terminalOwnerApi",
      })
    })

    timeout = setTimeout(() => {
      finish(unavailableTerminalOwnerResult(instanceId, "terminal dispose did not resolve onExit before timeout", terminal))
    }, timeoutMs)

    Promise.resolve(api.dispose(terminal.ptyId)).then((disposed) => {
      if (disposed === false) {
        finish(unavailableTerminalOwnerResult(instanceId, "terminal pty dispose returned false", terminal))
      }
    }).catch((error) => {
      finish(unavailableTerminalOwnerResult(
        instanceId,
        error instanceof Error ? error.message : String(error),
        terminal,
      ))
    })
  })
}

function unavailableTerminalOwnerResult(
  instanceId: number,
  reason: string,
  terminal?: TerminalInstance,
): TerminalOwnerTerminationResult {
  return {
    success: false,
    terminalId: terminal?.id || "",
    terminalInstanceId: terminal?.instanceId ?? instanceId,
    ptyId: terminal?.ptyId || "",
    pid: terminal?.pid ?? null,
    exitCode: terminal?.exitCode ?? null,
    reason,
    stateSource: "terminalManager/terminalOwnerApi",
  }
}

function unavailableTaskReuseOwnerResult(
  instanceId: number,
  launchConfig: TerminalTaskLaunchConfig,
  reason: string,
  terminal?: TerminalInstance,
): TerminalTaskReuseOwnerEvidence {
  return {
    success: false,
    terminalId: terminal?.id || "",
    terminalInstanceId: terminal?.instanceId ?? instanceId,
    taskId: launchConfig.taskId,
    taskName: launchConfig.taskName,
    commandLine: launchConfig.commandLine,
    cwd: launchConfig.cwd,
    group: launchConfig.group || "",
    reuseKind: launchConfig.reuseKind,
    ptyId: terminal?.ptyId || "",
    pid: terminal?.pid ?? null,
    reason,
    stateSource: "terminalManager/taskTerminalReuseOwner",
    vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
    currentSourcePath: "frontend/vite-project/src/terminal/terminalManager.ts",
    runtimeReference: false,
  }
}

export function resetAll(): void {
  terminals = []
  activeTerminalId = ""
  activeGroupId = "group-1"
  nextIdCounter = 0
  nextInstanceIdCounter = 0
  sameTaskTerminals.clear()
  idleTaskTerminals.clear()
}
