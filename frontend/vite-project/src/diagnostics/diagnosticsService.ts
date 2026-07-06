import { buildProcessDiagnosticsText, type ProcessSnapshot } from "../workbench/processDiagnostics"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"

export interface DiagnosticsExtensionSummaryInput {
  id: string
  name?: string
  publisher?: string
  version?: string
  kind?: "theme" | "workspace" | "ui" | "web" | string
  enabled?: boolean
  activationEvents?: string[]
}

export interface DiagnosticsWorkspaceInput {
  roots?: string[]
  dirtyFiles?: string[]
}

export interface DiagnosticsApprovalInput {
  pending?: number
  blocked?: number
  latestReason?: string
}

export interface DiagnosticsAgentEvidenceInput {
  reports?: string[]
  ready?: boolean
  summary?: string
}

export interface DiagnosticsSnapshotInput {
  process?: ProcessSnapshot
  workspace?: DiagnosticsWorkspaceInput
  extensions?: DiagnosticsExtensionSummaryInput[]
  environment?: Record<string, unknown>
  approval?: DiagnosticsApprovalInput
  agentEvidence?: DiagnosticsAgentEvidenceInput
}

export interface DiagnosticsActionDescriptor {
  commandId: string
  title: string
  format: "json" | "text" | "markdown"
  targetPath: string
  readonlyEvidence: true
  gitIndexMutation: false
  shellExecution: false
  redacted: true
}

export interface DiagnosticsSnapshot {
  schemaVersion: 1
  serviceId: "diagnosticsService"
  stateSource: "diagnosticsService"
  generatedAt: number
  summary: {
    appName: string
    appVersion: string
    platform: string
    terminalSessions: number
    windows: number
    lspProcesses: number
    debugAdapters: number
    enabledExtensions: number
    workspaceRoots: number
    dirtyFiles: number
  }
  process: ProcessSnapshot
  environment: {
    keys: string[]
    valuesRedacted: true
  }
  extensions: {
    total: number
    enabled: number
    disabled: number
    theme: number
    nonTheme: number
    items: DiagnosticsExtensionSummaryInput[]
  }
  workspace: {
    rootCount: number
    dirtyFileCount: number
    roots: string[]
    dirtyFiles: string[]
    rootsRedacted: true
  }
  approval: {
    pending: number
    blocked: number
    latestReason: string
  }
  agentEvidence: {
    reportCount: number
    reports: string[]
    ready: boolean
    summary: string
  }
  privacy: {
    redacted: true
    secrets: true
    userPaths: true
    environmentValues: true
  }
  constraints: {
    noSecondDiagnosticsState: true
    evidenceSafeActionsOnly: true
    runtimeSelfContained: true
  }
}

export interface IDiagnosticsService {
  readonly _serviceBrand: undefined
  setEnvironment(environment: Record<string, unknown>): void
  setExtensions(extensions: DiagnosticsExtensionSummaryInput[]): void
  captureSnapshot(input?: DiagnosticsSnapshotInput): DiagnosticsSnapshot
  getSnapshot(): DiagnosticsSnapshot
  getDiagnosticsText(): string
  createExportDescriptor(format?: "json" | "markdown" | "text"): DiagnosticsActionDescriptor
  createCopyDescriptor(): DiagnosticsActionDescriptor
  reset(): void
}

export interface DiagnosticsServiceOptions {
  now?: () => number
}

export const IDiagnosticsService = createDecorator<IDiagnosticsService>("diagnosticsService")

export class CodekDiagnosticsService implements IDiagnosticsService {
  declare readonly _serviceBrand: undefined
  private readonly now: () => number
  private environment: Record<string, unknown> = {}
  private extensions: DiagnosticsExtensionSummaryInput[] = []
  private latestSnapshot: DiagnosticsSnapshot | null = null

  constructor(options: DiagnosticsServiceOptions = {}) {
    this.now = options.now ?? (() => Date.now())
  }

  setEnvironment(environment: Record<string, unknown>): void {
    this.environment = { ...(environment || {}) }
  }

  setExtensions(extensions: DiagnosticsExtensionSummaryInput[]): void {
    this.extensions = normalizeExtensions(extensions)
  }

  captureSnapshot(input: DiagnosticsSnapshotInput = {}): DiagnosticsSnapshot {
    if (input.environment) this.setEnvironment(input.environment)
    if (input.extensions) this.setExtensions(input.extensions)

    const process = redactValue(input.process || {}) as ProcessSnapshot
    const extensions = normalizeExtensions(this.extensions)
    const workspaceRoots = redactStrings(input.workspace?.roots || [])
    const dirtyFiles = redactStrings(input.workspace?.dirtyFiles || [])
    const snapshot: DiagnosticsSnapshot = {
      schemaVersion: 1,
      serviceId: "diagnosticsService",
      stateSource: "diagnosticsService",
      generatedAt: this.now(),
      summary: buildSummary(process, extensions, workspaceRoots, dirtyFiles),
      process,
      environment: {
        keys: Object.keys(this.environment),
        valuesRedacted: true,
      },
      extensions: buildExtensionsSummary(extensions),
      workspace: {
        rootCount: workspaceRoots.length,
        dirtyFileCount: dirtyFiles.length,
        roots: workspaceRoots,
        dirtyFiles,
        rootsRedacted: true,
      },
      approval: {
        pending: toNumber(input.approval?.pending),
        blocked: toNumber(input.approval?.blocked),
        latestReason: redactSensitiveString(input.approval?.latestReason || ""),
      },
      agentEvidence: {
        reportCount: input.agentEvidence?.reports?.length || 0,
        reports: redactStrings(input.agentEvidence?.reports || []),
        ready: input.agentEvidence?.ready === true,
        summary: redactSensitiveString(input.agentEvidence?.summary || ""),
      },
      privacy: {
        redacted: true,
        secrets: true,
        userPaths: true,
        environmentValues: true,
      },
      constraints: {
        noSecondDiagnosticsState: true,
        evidenceSafeActionsOnly: true,
        runtimeSelfContained: true,
      },
    }
    this.latestSnapshot = snapshot
    return snapshot
  }

  getSnapshot(): DiagnosticsSnapshot {
    return this.latestSnapshot || this.captureSnapshot()
  }

  getDiagnosticsText(): string {
    return JSON.stringify(this.getSnapshot(), null, 2)
  }

  getProcessDiagnosticsText(): string {
    return buildProcessDiagnosticsText(this.getSnapshot().process)
  }

  createExportDescriptor(format: "json" | "markdown" | "text" = "json"): DiagnosticsActionDescriptor {
    return {
      commandId: "workbench.action.diagnostics.export",
      title: "Diagnostics: Export Local Report",
      format,
      targetPath: format === "markdown" ? ".codek/reports/diagnostics-latest.md" : ".codek/reports/diagnostics-latest.json",
      readonlyEvidence: true,
      gitIndexMutation: false,
      shellExecution: false,
      redacted: true,
    }
  }

  createCopyDescriptor(): DiagnosticsActionDescriptor {
    return {
      commandId: "workbench.action.diagnostics.copy",
      title: "Diagnostics: Copy Redacted Snapshot",
      format: "text",
      targetPath: "clipboard://diagnostics",
      readonlyEvidence: true,
      gitIndexMutation: false,
      shellExecution: false,
      redacted: true,
    }
  }

  reset(): void {
    this.environment = {}
    this.extensions = []
    this.latestSnapshot = null
  }
}

export function createDiagnosticsService(options?: DiagnosticsServiceOptions): CodekDiagnosticsService {
  return new CodekDiagnosticsService(options)
}

export const globalDiagnosticsService = new CodekDiagnosticsService()
registerSingleton(IDiagnosticsService, globalDiagnosticsService, InstantiationType.Delayed)

function buildSummary(
  process: ProcessSnapshot,
  extensions: DiagnosticsExtensionSummaryInput[],
  roots: string[],
  dirtyFiles: string[],
): DiagnosticsSnapshot["summary"] {
  return {
    appName: process.app?.name || "Codek",
    appVersion: process.app?.version || "",
    platform: [process.app?.platform, process.app?.arch].filter(Boolean).join(" "),
    terminalSessions: process.pty?.sessions?.length || 0,
    windows: process.windows?.length || 0,
    lspProcesses: process.lsp?.length || 0,
    debugAdapters: process.dap?.length || 0,
    enabledExtensions: extensions.filter((extension) => extension.enabled !== false).length,
    workspaceRoots: roots.length,
    dirtyFiles: dirtyFiles.length,
  }
}

function buildExtensionsSummary(extensions: DiagnosticsExtensionSummaryInput[]): DiagnosticsSnapshot["extensions"] {
  const theme = extensions.filter((extension) => extension.kind === "theme").length
  const enabled = extensions.filter((extension) => extension.enabled !== false).length
  return {
    total: extensions.length,
    enabled,
    disabled: extensions.length - enabled,
    theme,
    nonTheme: extensions.length - theme,
    items: extensions.map((extension) => ({
      id: sanitizeToken(extension.id),
      name: sanitizeToken(extension.name || extension.id),
      publisher: sanitizeToken(extension.publisher || ""),
      version: sanitizeToken(extension.version || ""),
      kind: sanitizeToken(extension.kind || "") as DiagnosticsExtensionSummaryInput["kind"],
      enabled: extension.enabled !== false,
      activationEvents: (extension.activationEvents || []).map(redactSensitiveString),
    })),
  }
}

function normalizeExtensions(extensions: DiagnosticsExtensionSummaryInput[] | undefined): DiagnosticsExtensionSummaryInput[] {
  return Array.isArray(extensions)
    ? extensions.map((extension) => ({
      id: sanitizeToken(extension.id),
      name: sanitizeToken(extension.name || extension.id),
      publisher: sanitizeToken(extension.publisher || ""),
      version: sanitizeToken(extension.version || ""),
      kind: sanitizeToken(extension.kind || "") as DiagnosticsExtensionSummaryInput["kind"],
      enabled: extension.enabled !== false,
      activationEvents: (extension.activationEvents || []).map(redactSensitiveString),
    })).filter((extension) => extension.id)
    : []
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveString(value)
  if (Array.isArray(value)) return value.map(redactValue)
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) result[key] = redactValue(item)
    return result
  }
  return value
}

function redactStrings(values: string[]): string[] {
  return values.map(redactSensitiveString).filter(Boolean)
}

export function redactSensitiveString(value: string): string {
  return String(value || "")
    .replace(/\bsk-[A-Za-z0-9_-]{3,}\b/g, "[redacted]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]{6,}/gi, "$1[redacted]")
    .replace(/\b(api[_-]?key|token|password|secret|authorization)\s*[:=]\s*[^,\s;]+/gi, "$1=[redacted]")
    .replace(/[A-Za-z]:[\\/](Users|用户)[\\/][^\\/]+/gi, "[USER_PATH]")
    .replace(/[A-Za-z]:[\\/](Codek|Workspace)[\\/][^\\/\s]+/gi, "D:/Workspace/[workspace-path-redacted]")
    .replace(/\\/g, "/")
}

function sanitizeToken(value: unknown): string {
  return redactSensitiveString(String(value || "").trim())
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}
