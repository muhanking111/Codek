type CleanupResource = (() => void) | { cancel?: () => void; disconnect?: () => void; dispose?: () => void } | null | undefined

export type WorkbenchContributionPhase = "startup" | "ready" | "restored" | "eventually"
export type WorkbenchContributionSource = "codek" | "vscode" | "extension" | "agent"
export type WorkbenchContributionState = "registered" | "started" | "failed" | "disposed"
export type WorkbenchContributionDiagnosticSeverity = "info" | "warning" | "error"

export interface WorkbenchContributionContext {
  evidence?: Record<string, unknown>
  diagnostics?: WorkbenchContributionEvidenceDiagnostic[]
}

export interface WorkbenchContributionEvidenceDiagnostic {
  id: string
  severity: WorkbenchContributionDiagnosticSeverity
  message: string
  source?: string
  code?: string
}

export interface WorkbenchContributionEvidence {
  source?: string
  diagnostics?: WorkbenchContributionEvidenceDiagnostic[]
  data?: Record<string, unknown>
}

export interface WorkbenchContributionDescriptor {
  id: string
  phase: WorkbenchContributionPhase
  start: (context: WorkbenchContributionContext) => CleanupResource | void
  order?: number
  source?: WorkbenchContributionSource
  serviceIds?: string[]
  viewIds?: string[]
  commandIds?: string[]
  evidence?: WorkbenchContributionEvidence
}

export interface WorkbenchContributionRuntime {
  id: string
  phase: WorkbenchContributionPhase
  order: number
  source: WorkbenchContributionSource
  state: WorkbenchContributionState
  startedAt: number | null
  disposedAt: number | null
  durationMs: number | null
  serviceIds: string[]
  viewIds: string[]
  commandIds: string[]
  evidence: WorkbenchContributionEvidence
}

export interface WorkbenchContributionDiagnostic {
  id: string
  severity: WorkbenchContributionDiagnosticSeverity
  code: "duplicate-registration" | "start-failed" | "dispose-failed" | "evidence"
  message: string
  phase?: WorkbenchContributionPhase
  source?: string
}

export interface WorkbenchContributionRegistryProjection {
  schemaVersion: 1
  source: "workbenchContributionRegistry"
  lifecycle: {
    phase: WorkbenchContributionPhase | "idle" | "disposed"
    registered: number
    started: number
    disposed: number
    failed: number
    shutdownReason: string | null
  }
  startupOrder: string[]
  contributions: WorkbenchContributionRuntime[]
  diagnostics: WorkbenchContributionDiagnostic[]
}

export interface WorkbenchContributionStartOptions {
  throughPhase?: WorkbenchContributionPhase
  now?: () => number
}

export interface WorkbenchContributionDisposeOptions {
  reason?: string
  now?: () => number
}

export interface WorkbenchContributionDisposeResult {
  errors: unknown[]
}

interface ContributionRecord {
  descriptor: WorkbenchContributionDescriptor
  state: WorkbenchContributionState
  disposable: CleanupResource
  startedAt: number | null
  disposedAt: number | null
  durationMs: number | null
}

const PHASES: WorkbenchContributionPhase[] = ["startup", "ready", "restored", "eventually"]
const DEFAULT_ORDER = 100

export class WorkbenchContributionRegistry {
  private readonly contributions = new Map<string, ContributionRecord>()
  private readonly startupOrder: string[] = []
  private readonly diagnostics: WorkbenchContributionDiagnostic[] = []
  private currentPhase: WorkbenchContributionRegistryProjection["lifecycle"]["phase"] = "idle"
  private shutdownReason: string | null = null

  register(descriptor: WorkbenchContributionDescriptor): { dispose: () => void } {
    const id = normalizeId(descriptor.id)
    if (!id) throw new Error("Workbench contribution id is required")
    if (this.contributions.has(id)) {
      const diagnostic = this.addDiagnostic({
        id,
        severity: "error",
        code: "duplicate-registration",
        message: `Workbench contribution already registered: ${id}`,
        phase: descriptor.phase,
        source: descriptor.source,
      })
      throw new Error(diagnostic.message)
    }

    this.contributions.set(id, {
      descriptor: {
        ...descriptor,
        id,
        order: descriptor.order ?? DEFAULT_ORDER,
        source: descriptor.source ?? "codek",
        serviceIds: uniqueStrings(descriptor.serviceIds ?? []),
        viewIds: uniqueStrings(descriptor.viewIds ?? []),
        commandIds: uniqueStrings(descriptor.commandIds ?? []),
        evidence: normalizeEvidence(descriptor.evidence),
      },
      state: "registered",
      disposable: null,
      startedAt: null,
      disposedAt: null,
      durationMs: null,
    })

    return {
      dispose: () => this.unregister(id),
    }
  }

  start(context: WorkbenchContributionContext = {}, options: WorkbenchContributionStartOptions = {}): WorkbenchContributionRegistryProjection {
    const now = options.now ?? Date.now
    const throughPhase = options.throughPhase ?? "eventually"
    const phases = PHASES.slice(0, PHASES.indexOf(throughPhase) + 1)

    for (const phase of phases) {
      this.currentPhase = phase
      for (const record of this.recordsForPhase(phase)) {
        this.startContribution(record, context, now)
      }
    }

    this.projectContextDiagnostics(context)
    return this.getProjection()
  }

  dispose(options: WorkbenchContributionDisposeOptions = {}): WorkbenchContributionDisposeResult {
    const now = options.now ?? Date.now
    const errors: unknown[] = []
    this.shutdownReason = options.reason ?? this.shutdownReason ?? "dispose"

    for (const id of [...this.startupOrder].reverse()) {
      const record = this.contributions.get(id)
      if (!record || record.state === "disposed") continue
      try {
        disposeCleanup(record.disposable)
      } catch (error) {
        errors.push(error)
        this.addDiagnostic({
          id,
          severity: "error",
          code: "dispose-failed",
          message: error instanceof Error ? error.message : String(error),
          phase: record.descriptor.phase,
          source: record.descriptor.source,
        })
      } finally {
        record.state = "disposed"
        record.disposedAt = now()
      }
    }

    this.currentPhase = "disposed"
    return { errors }
  }

  getProjection(): WorkbenchContributionRegistryProjection {
    const contributions = [...this.contributions.values()].map((record): WorkbenchContributionRuntime => ({
      id: record.descriptor.id,
      phase: record.descriptor.phase,
      order: record.descriptor.order ?? DEFAULT_ORDER,
      source: record.descriptor.source ?? "codek",
      state: record.state,
      startedAt: record.startedAt,
      disposedAt: record.disposedAt,
      durationMs: record.durationMs,
      serviceIds: [...(record.descriptor.serviceIds ?? [])],
      viewIds: [...(record.descriptor.viewIds ?? [])],
      commandIds: [...(record.descriptor.commandIds ?? [])],
      evidence: cloneEvidence(record.descriptor.evidence),
    })).sort(compareRuntime)

    return {
      schemaVersion: 1,
      source: "workbenchContributionRegistry",
      lifecycle: {
        phase: this.currentPhase,
        registered: contributions.length,
        started: contributions.filter((item) => item.state === "started").length,
        disposed: contributions.filter((item) => item.state === "disposed").length,
        failed: contributions.filter((item) => item.state === "failed").length,
        shutdownReason: this.shutdownReason,
      },
      startupOrder: [...this.startupOrder],
      contributions,
      diagnostics: [...this.diagnostics],
    }
  }

  reset(): void {
    this.contributions.clear()
    this.startupOrder.length = 0
    this.diagnostics.length = 0
    this.currentPhase = "idle"
    this.shutdownReason = null
  }

  private unregister(id: string): void {
    const record = this.contributions.get(id)
    if (!record) return
    if (record.state === "started") {
      try {
        disposeCleanup(record.disposable)
      } catch (error) {
        this.addDiagnostic({
          id,
          severity: "error",
          code: "dispose-failed",
          message: error instanceof Error ? error.message : String(error),
          phase: record.descriptor.phase,
          source: record.descriptor.source,
        })
      }
    }
    this.contributions.delete(id)
    const index = this.startupOrder.indexOf(id)
    if (index >= 0) this.startupOrder.splice(index, 1)
  }

  private recordsForPhase(phase: WorkbenchContributionPhase): ContributionRecord[] {
    return [...this.contributions.values()]
      .filter((record) => record.descriptor.phase === phase && record.state === "registered")
      .sort(compareRecords)
  }

  private startContribution(record: ContributionRecord, context: WorkbenchContributionContext, now: () => number): void {
    const startedAt = now()
    record.startedAt = startedAt
    this.startupOrder.push(record.descriptor.id)
    try {
      const disposable = record.descriptor.start(context)
      record.disposable = toCleanupResource(disposable)
      record.state = "started"
    } catch (error) {
      record.state = "failed"
      this.addDiagnostic({
        id: record.descriptor.id,
        severity: "error",
        code: "start-failed",
        message: error instanceof Error ? error.message : String(error),
        phase: record.descriptor.phase,
        source: record.descriptor.source,
      })
    } finally {
      record.durationMs = Math.max(0, now() - startedAt)
      this.projectContributionEvidence(record)
    }
  }

  private projectContributionEvidence(record: ContributionRecord): void {
    for (const diagnostic of record.descriptor.evidence?.diagnostics ?? []) {
      this.addDiagnostic({
        id: diagnostic.id || record.descriptor.id,
        severity: diagnostic.severity,
        code: "evidence",
        message: diagnostic.message,
        phase: record.descriptor.phase,
        source: diagnostic.source || record.descriptor.evidence?.source || record.descriptor.source,
      })
    }
  }

  private projectContextDiagnostics(context: WorkbenchContributionContext): void {
    for (const diagnostic of context.diagnostics ?? []) {
      this.addDiagnostic({
        id: diagnostic.id,
        severity: diagnostic.severity,
        code: "evidence",
        message: diagnostic.message,
        source: diagnostic.source,
      })
    }
  }

  private addDiagnostic(diagnostic: WorkbenchContributionDiagnostic): WorkbenchContributionDiagnostic {
    this.diagnostics.push(diagnostic)
    return diagnostic
  }
}

const globalWorkbenchContributionRegistry = new WorkbenchContributionRegistry()

export function createWorkbenchContributionRegistry(): WorkbenchContributionRegistry {
  return new WorkbenchContributionRegistry()
}

export function registerWorkbenchContribution(descriptor: WorkbenchContributionDescriptor): { dispose: () => void } {
  return globalWorkbenchContributionRegistry.register(descriptor)
}

export function startWorkbenchContributionRegistry(
  context: WorkbenchContributionContext = {},
  options: WorkbenchContributionStartOptions = {},
): WorkbenchContributionRegistryProjection {
  return globalWorkbenchContributionRegistry.start(context, options)
}

export function shutdownWorkbenchContributionRegistry(
  options: WorkbenchContributionDisposeOptions = {},
): WorkbenchContributionDisposeResult {
  return globalWorkbenchContributionRegistry.dispose(options)
}

export function getWorkbenchContributionRegistryProjection(): WorkbenchContributionRegistryProjection {
  return globalWorkbenchContributionRegistry.getProjection()
}

export function resetWorkbenchContributionRegistry(): void {
  globalWorkbenchContributionRegistry.dispose({ reason: "reset" })
  globalWorkbenchContributionRegistry.reset()
}

function compareRecords(left: ContributionRecord, right: ContributionRecord): number {
  return compareDescriptor(left.descriptor, right.descriptor)
}

function compareRuntime(left: WorkbenchContributionRuntime, right: WorkbenchContributionRuntime): number {
  const phaseDiff = PHASES.indexOf(left.phase) - PHASES.indexOf(right.phase)
  if (phaseDiff !== 0) return phaseDiff
  return left.order - right.order || left.id.localeCompare(right.id)
}

function compareDescriptor(left: WorkbenchContributionDescriptor, right: WorkbenchContributionDescriptor): number {
  return (left.order ?? DEFAULT_ORDER) - (right.order ?? DEFAULT_ORDER) || left.id.localeCompare(right.id)
}

function normalizeId(id: string): string {
  return String(id || "").trim()
}

function normalizeEvidence(evidence: WorkbenchContributionEvidence | undefined): WorkbenchContributionEvidence {
  return {
    source: evidence?.source,
    diagnostics: [...(evidence?.diagnostics ?? [])],
    data: evidence?.data ? { ...evidence.data } : undefined,
  }
}

function cloneEvidence(evidence: WorkbenchContributionEvidence | undefined): WorkbenchContributionEvidence {
  return normalizeEvidence(evidence)
}

function disposeCleanup(resource: CleanupResource): void {
  if (!resource) return
  if (typeof resource === "function") {
    resource()
    return
  }
  resource.dispose?.()
  resource.cancel?.()
  resource.disconnect?.()
}

function toCleanupResource(resource: CleanupResource | void): CleanupResource {
  if (resource === undefined) return null
  return resource as CleanupResource
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)))
}
