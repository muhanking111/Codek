import { URI } from "../vscode-adapter/base/common/uri"
import {
  globalMarkerService,
  makeMarkerKey,
  sortMarkers,
  toCodekSeverity,
  type IMarker,
  type IMarkerService,
  type MarkerServiceOwnerEvidenceSnapshot,
  type MarkerDataLike,
} from "../vscode-adapter/platform/markers/common/markers"
import {
  createProblemMarkersViewModel,
  getProblemDiagnosticSourceKey,
  type ProblemDiagnosticSourceKey,
  type ProblemMarkersFilterState,
  type ProblemMarkersViewModel,
} from "../vscode-adapter/workbench/contrib/markers/browser/markersViewModel"

export type DiagnosticSource = "monaco" | "lsp" | "lint" | "compiler"

export interface Diagnostic {
  file: string
  line: number
  column: number
  message: string
  severity: "error" | "warning" | "info" | "ai"
  source?: string
  code?: MarkerDataLike["code"]
  diagnosticSource?: DiagnosticSource
  owner?: string
  endLine?: number
  endColumn?: number
}

export interface ProblemsDiagnosticsSummary {
  diagnosticCount: number
  errorCount: number
  warningCount: number
  infoCount: number
  aiCount: number
  fileCount: number
  sourceNames: string[]
}

export interface ProblemsVisibleProjection {
  diagnostics: Diagnostic[]
  viewModel: ProblemMarkersViewModel<Diagnostic>
  summary: ProblemsDiagnosticsSummary
}

export interface ProblemResourceMarker extends Diagnostic {
  markerKey: string
  owner: string
  sourceKey: ProblemDiagnosticSourceKey
  resource: string
}

export interface ProblemResourceMarkerGroup {
  id: string
  file: string
  resource: string
  name: string
  path: string
  errorCount: number
  warningCount: number
  infoCount: number
  aiCount: number
  total: number
  markers: ProblemResourceMarker[]
}

export interface ProblemNavigationTarget {
  file: string
  resource: string
  line: number
  column: number
  selection: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
  evidence: ProblemActionEvidenceBase
}

export interface ProblemActionEvidenceBase {
  markerKey: string
  owner: string
  source?: string
  sourceKey: ProblemDiagnosticSourceKey
  severity: Diagnostic["severity"]
  message: string
}

export interface ProblemActionEvidence extends ProblemActionEvidenceBase {
  id: "problems.open" | "problems.quickFix"
  title: string
  boundary: "navigation-target-only" | "evidence-only"
  mutatesWorkspace: false
  requiresApproval: boolean
  target?: ProblemNavigationTarget
}

export interface ProblemOwnerEvidenceAction {
  id: ProblemActionEvidence["id"] | "problems.diff"
  owner: string
  status: "projected" | "blocked"
  boundary: ProblemActionEvidence["boundary"] | "not-wired"
  mutatesWorkspace: false
  requiresApproval: boolean
}

export interface ProblemOwnerEvidenceMarkerDetail {
  markerKey: string
  owner: string
  source?: string
  sourceKey: ProblemDiagnosticSourceKey
  severity: Diagnostic["severity"]
  messagePreview: string
  resourcePreview: string
  line: number
  column: number
}

export interface ProblemsOwnerEvidenceSnapshot {
  serviceId: "problemsDiagnosticsService"
  stateSource: "markerService"
  markerServiceOwner: MarkerServiceOwnerEvidenceSnapshot
  problemsViewOwner: {
    owner: "ProblemsPanel"
    status: "partial"
    connectedStateSource: "problemState.diagnostics"
    vscodeReference: "MarkersView"
  }
  resourceGroupOwner: {
    owner: "ProblemsDiagnosticsService.createResourceMarkerModel"
    status: "connected"
    resourceCount: number
    markerCount: number
  }
  listOwner: {
    owner: "ProblemsPanel"
    status: "partial"
    sourceGroupCount: number
    visibleCount: number
  }
  detailOwner: {
    owner: "ProblemsDiagnosticsService.createActionEvidence"
    status: "projected"
    markerDetails: ProblemOwnerEvidenceMarkerDetail[]
  }
  actions: ProblemOwnerEvidenceAction[]
  readonlyEvidence: true
  remainingUiOwnerGap: string[]
}

const codekAnalysisOwner = "codek-analysis"
const diagnosticSourceOwners: readonly DiagnosticSource[] = ["monaco", "lsp", "lint", "compiler"]
const previewLimit = 160

export class ProblemsDiagnosticsService {
  constructor(private readonly markerService: IMarkerService = globalMarkerService) {}

  getMarkerService(): IMarkerService {
    return this.markerService
  }

  getDiagnostics(): Diagnostic[] {
    return this.markerService.read({ ignoreResourceFilters: true }).map(toDiagnostic)
  }

  addDiagnostics(diags: readonly Diagnostic[]): void {
    const byOwnerAndResource = groupDiagnosticsByOwnerAndResource(diags)
    for (const group of byOwnerAndResource.values()) {
      const existing = this.markerService.read({ owner: group.owner, resource: group.resource, ignoreResourceFilters: true })
      this.markerService.changeOne(group.owner, group.resource, [...existing, ...group.markers])
    }
  }

  replaceSourceDiagnosticsForFile(filePath: string, source: DiagnosticSource, diags: readonly Diagnostic[]): void {
    const resource = toDiagnosticResource(filePath)
    const tagged = diags.map((diag) => ({ ...diag, file: filePath, diagnosticSource: source }))
    this.markerService.changeOne(source, resource, tagged.map((diag) => toMarkerData(diag, source)))
  }

  clear(): void {
    const owners = new Set(this.markerService.read({ ignoreResourceFilters: true }).map((marker) => marker.owner))
    for (const owner of owners) {
      this.markerService.remove(owner)
    }
  }

  clearForFile(file: string): void {
    const normalizedFile = normalizeDiagnosticFile(file)
    const byOwner = new Map<string, Map<string, URI>>()
    for (const marker of this.markerService.read({ ignoreResourceFilters: true })) {
      if (normalizeDiagnosticFile(fileFromResource(marker.resource)) !== normalizedFile) continue
      const ownerResources = byOwner.get(marker.owner) || new Map<string, URI>()
      ownerResources.set(marker.resource.toString(), marker.resource)
      byOwner.set(marker.owner, ownerResources)
    }

    for (const [owner, resources] of byOwner) {
      this.markerService.remove(owner, [...resources.values()])
    }
  }

  clearAiForFile(file: string): void {
    this.replaceMatchingMarkers((marker) => {
      return normalizeDiagnosticFile(fileFromResource(marker.resource)) === normalizeDiagnosticFile(file) && toCodekSeverity(marker.severity) === "ai"
    })
  }

  clearSourceDiagnostics(source: DiagnosticSource): void {
    this.markerService.remove(source)
  }

  getSummary(diagnostics = this.getDiagnostics()): ProblemsDiagnosticsSummary {
    return {
      diagnosticCount: diagnostics.length,
      errorCount: diagnostics.filter((diag) => diag.severity === "error").length,
      warningCount: diagnostics.filter((diag) => diag.severity === "warning").length,
      infoCount: diagnostics.filter((diag) => diag.severity === "info").length,
      aiCount: diagnostics.filter((diag) => diag.severity === "ai").length,
      fileCount: new Set(diagnostics.map((diag) => diag.file)).size,
      sourceNames: [...new Set(diagnostics.map((diag) => diag.source || diag.diagnosticSource || "").filter(Boolean))],
    }
  }

  createViewModel(
    filters: ProblemMarkersFilterState = {},
    diagnostics = this.getDiagnostics(),
  ): ProblemMarkersViewModel<Diagnostic> {
    return createProblemMarkersViewModel(diagnostics, filters)
  }

  createVisibleProjection(
    filters: ProblemMarkersFilterState = {},
    diagnostics = this.getDiagnostics(),
  ): ProblemsVisibleProjection {
    return {
      diagnostics,
      viewModel: this.createViewModel(filters, diagnostics),
      summary: this.getSummary(diagnostics),
    }
  }

  createOwnerEvidenceSnapshot(
    filters: ProblemMarkersFilterState = {},
    diagnostics = this.getDiagnostics(),
  ): ProblemsOwnerEvidenceSnapshot {
    const projection = this.createVisibleProjection(filters, diagnostics)
    const resources = this.createResourceMarkerModel(diagnostics)
    const markerDetails = resources.flatMap((resource) => resource.markers).slice(0, 25).map((marker) => ({
      markerKey: marker.markerKey,
      owner: marker.owner,
      source: marker.source,
      sourceKey: marker.sourceKey,
      severity: marker.severity,
      messagePreview: createEvidencePreview(marker.message),
      resourcePreview: createEvidencePreview(marker.resource),
      line: marker.line,
      column: marker.column,
    }))

    return {
      serviceId: "problemsDiagnosticsService",
      stateSource: "markerService",
      markerServiceOwner: this.markerService.getOwnerEvidenceSnapshot?.() ?? createFallbackMarkerOwnerEvidence(this.markerService),
      problemsViewOwner: {
        owner: "ProblemsPanel",
        status: "partial",
        connectedStateSource: "problemState.diagnostics",
        vscodeReference: "MarkersView",
      },
      resourceGroupOwner: {
        owner: "ProblemsDiagnosticsService.createResourceMarkerModel",
        status: "connected",
        resourceCount: resources.length,
        markerCount: resources.reduce((total, resource) => total + resource.total, 0),
      },
      listOwner: {
        owner: "ProblemsPanel",
        status: "partial",
        sourceGroupCount: projection.viewModel.sourceGroups.length,
        visibleCount: projection.viewModel.visibleTotal,
      },
      detailOwner: {
        owner: "ProblemsDiagnosticsService.createActionEvidence",
        status: "projected",
        markerDetails,
      },
      actions: [
        {
          id: "problems.open",
          owner: "ProblemsDiagnosticsService.createNavigationTarget",
          status: "projected",
          boundary: "navigation-target-only",
          mutatesWorkspace: false,
          requiresApproval: false,
        },
        {
          id: "problems.quickFix",
          owner: "ProblemsDiagnosticsService.createActionEvidence",
          status: "blocked",
          boundary: "evidence-only",
          mutatesWorkspace: false,
          requiresApproval: true,
        },
        {
          id: "problems.diff",
          owner: "ProblemsPanel",
          status: "blocked",
          boundary: "not-wired",
          mutatesWorkspace: false,
          requiresApproval: true,
        },
      ],
      readonlyEvidence: true,
      remainingUiOwnerGap: [
        "Full VS Code Problems tree owner is not wired without App.vue/generic shell integration.",
        "Quick Fix execution requires editor/code action owner wiring and remains evidence-only.",
        "Diff action UI owner is not wired in the current ProblemsPanel boundary.",
      ],
    }
  }

  createResourceMarkerModel(diagnostics = this.getDiagnostics()): ProblemResourceMarkerGroup[] {
    const groups = new Map<string, ProblemResourceMarkerGroup>()

    for (const diagnostic of sortDiagnostics(diagnostics)) {
      const marker = toResourceMarker(diagnostic)
      let group = groups.get(marker.file)
      if (!group) {
        group = {
          id: marker.resource,
          file: marker.file,
          resource: marker.resource,
          name: basename(marker.file),
          path: marker.file,
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          aiCount: 0,
          total: 0,
          markers: [],
        }
        groups.set(marker.file, group)
      }

      if (group.markers.some((existing) => existing.markerKey === marker.markerKey)) continue

      group.markers.push(marker)
      group.total += 1
      if (marker.severity === "error") group.errorCount += 1
      else if (marker.severity === "warning") group.warningCount += 1
      else if (marker.severity === "info") group.infoCount += 1
      else group.aiCount += 1
    }

    return [...groups.values()].sort(compareResourceMarkerGroups)
  }

  createNavigationTarget(diagnostic: Diagnostic): ProblemNavigationTarget {
    const line = asPositivePosition(diagnostic.line)
    const column = asPositivePosition(diagnostic.column)
    const endLine = Math.max(line, asPositivePosition(diagnostic.endLine ?? diagnostic.line))
    const endColumn = Math.max(1, asPositivePosition(diagnostic.endColumn ?? diagnostic.column + 1))
    return {
      file: normalizeDiagnosticFile(diagnostic.file),
      resource: toDiagnosticResource(diagnostic.file).toString(),
      line,
      column,
      selection: {
        startLineNumber: line,
        startColumn: column,
        endLineNumber: endLine,
        endColumn,
      },
      evidence: createActionEvidenceBase(diagnostic),
    }
  }

  createActionEvidence(diagnostic: Diagnostic): ProblemActionEvidence[] {
    const base = createActionEvidenceBase(diagnostic)
    const target = this.createNavigationTarget(diagnostic)
    return [
      {
        ...base,
        id: "problems.open",
        title: "打开问题位置",
        boundary: "navigation-target-only",
        mutatesWorkspace: false,
        requiresApproval: false,
        target,
      },
      {
        ...base,
        id: "problems.quickFix",
        title: "查看快速修复证据",
        boundary: "evidence-only",
        mutatesWorkspace: false,
        requiresApproval: true,
      },
    ]
  }

  private replaceMatchingMarkers(shouldRemove: (marker: IMarker) => boolean): void {
    const groups = new Map<string, { owner: string; resource: URI; markers: IMarker[] }>()
    let removed = false
    for (const marker of this.markerService.read({ ignoreResourceFilters: true })) {
      const key = `${marker.owner}:${marker.resource.toString()}`
      const group = groups.get(key) || { owner: marker.owner, resource: marker.resource, markers: [] }
      if (!shouldRemove(marker)) group.markers.push(marker)
      else removed = true
      groups.set(key, group)
    }

    if (!removed) return
    for (const group of groups.values()) {
      this.markerService.changeOne(group.owner, group.resource, group.markers)
    }
  }
}

export const globalProblemsDiagnosticsService = new ProblemsDiagnosticsService(globalMarkerService)

export function makeProblemMarkerKey(diag: Diagnostic): string {
  return `${diag.file}:${makeMarkerKey({
    source: diag.source || diag.diagnosticSource,
    message: diag.message,
    severity: diag.severity,
    startLineNumber: diag.line,
    startColumn: diag.column,
  })}`
}

export function toDiagnosticResource(file: string): URI {
  const normalized = normalizeDiagnosticFile(file)
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("//")) {
    return URI.file(normalized)
  }
  return URI.from({ scheme: "codek", path: `/${normalized.replace(/^\/+/, "")}` })
}

export function fileFromResource(resource: URI): string {
  if (resource.scheme === "codek") return resource.path.replace(/^\/+/, "")
  if (resource.scheme === "file") return normalizeDiagnosticFile(resource.fsPath)
  return normalizeDiagnosticFile(resource.path || resource.toString())
}

export function normalizeDiagnosticFile(file: string): string {
  return String(file || "").replace(/\\/g, "/")
}

function groupDiagnosticsByOwnerAndResource(diags: readonly Diagnostic[]): Map<string, { owner: string; resource: URI; markers: MarkerDataLike[] }> {
  const groups = new Map<string, { owner: string; resource: URI; markers: MarkerDataLike[] }>()
  for (const diag of diags) {
    const owner = ownerFromDiagnostic(diag)
    const resource = toDiagnosticResource(diag.file)
    const key = `${owner}:${resource.toString()}`
    const group = groups.get(key) || { owner, resource, markers: [] }
    group.markers.push(toMarkerData(diag, owner))
    groups.set(key, group)
  }
  return groups
}

function toMarkerData(diag: Diagnostic, owner: string): MarkerDataLike {
  return {
    source: diag.source || owner,
    code: diag.code,
    message: diag.message,
    severity: diag.severity,
    startLineNumber: diag.line,
    startColumn: diag.column,
    endLineNumber: diag.endLine ?? diag.line,
    endColumn: diag.endColumn ?? diag.column + 1,
  }
}

function toDiagnostic(marker: IMarker): Diagnostic {
  const diagnostic: Diagnostic = {
    file: fileFromResource(marker.resource),
    line: marker.startLineNumber,
    column: marker.startColumn,
    message: marker.message,
    severity: toCodekSeverity(marker.severity),
    source: marker.source,
    code: marker.code,
    owner: marker.owner,
    endLine: marker.endLineNumber,
    endColumn: marker.endColumn,
  }
  const source = diagnosticSourceFromOwner(marker.owner) || diagnosticSourceFromMarker(marker)
  if (source) diagnostic.diagnosticSource = source
  return diagnostic
}

function ownerFromDiagnostic(diag: Diagnostic): string {
  return diag.diagnosticSource || codekAnalysisOwner
}

function diagnosticSourceFromOwner(owner: string): DiagnosticSource | undefined {
  return diagnosticSourceOwners.includes(owner as DiagnosticSource) ? owner as DiagnosticSource : undefined
}

function diagnosticSourceFromMarker(marker: IMarker): DiagnosticSource | undefined {
  const sourceKey = getProblemDiagnosticSourceKey({
    file: fileFromResource(marker.resource),
    line: marker.startLineNumber,
    column: marker.startColumn,
    message: marker.message,
    severity: toCodekSeverity(marker.severity),
    source: marker.source || marker.owner,
  })
  return sourceKey === "other" ? undefined : sourceKey
}

export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return sortMarkers(diagnostics.map(toMarkerSortableDiagnostic))
}

function toMarkerSortableDiagnostic<TDiagnostic extends Diagnostic>(diag: TDiagnostic): TDiagnostic & {
  startLineNumber: number
  startColumn: number
} {
  return {
    ...diag,
    startLineNumber: diag.line,
    startColumn: diag.column,
  }
}

function toResourceMarker(diagnostic: Diagnostic): ProblemResourceMarker {
  const normalized: Diagnostic = {
    ...diagnostic,
    file: normalizeDiagnosticFile(diagnostic.file),
    line: asPositivePosition(diagnostic.line),
    column: asPositivePosition(diagnostic.column),
    endLine: Math.max(asPositivePosition(diagnostic.line), asPositivePosition(diagnostic.endLine ?? diagnostic.line)),
    endColumn: asPositivePosition(diagnostic.endColumn ?? diagnostic.column + 1),
    owner: diagnostic.owner || ownerFromDiagnostic(diagnostic),
  }
  const sourceKey = getProblemDiagnosticSourceKey(normalized)
  return {
    ...normalized,
    owner: normalized.owner || ownerFromDiagnostic(normalized),
    sourceKey,
    markerKey: makeProblemMarkerKey(normalized),
    resource: toDiagnosticResource(normalized.file).toString(),
  }
}

function createActionEvidenceBase(diagnostic: Diagnostic): ProblemActionEvidenceBase {
  const normalized = toResourceMarker(diagnostic)
  return {
    markerKey: normalized.markerKey,
    owner: normalized.owner,
    source: normalized.source,
    sourceKey: normalized.sourceKey,
    severity: normalized.severity,
    message: normalized.message,
  }
}

function createEvidencePreview(value: string): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim()
  return normalized.length > previewLimit ? `${normalized.slice(0, previewLimit - 3)}...` : normalized
}

function createFallbackMarkerOwnerEvidence(markerService: IMarkerService): MarkerServiceOwnerEvidenceSnapshot {
  const byOwner = new Map<string, Map<string, number>>()
  for (const marker of markerService.read({ ignoreResourceFilters: true })) {
    const ownerResources = byOwner.get(marker.owner) || new Map<string, number>()
    const resource = marker.resource.toString()
    ownerResources.set(resource, (ownerResources.get(resource) || 0) + 1)
    byOwner.set(marker.owner, ownerResources)
  }

  const owners = [...byOwner.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([owner, resources]) => {
      const resourceEntries = [...resources.entries()].sort(([left], [right]) => left.localeCompare(right))
      return {
        owner,
        resourceCount: resourceEntries.length,
        markerCount: resourceEntries.reduce((total, [, count]) => total + count, 0),
      resources: resourceEntries.map(([resource, markerCount]) => ({ resourcePreview: createEvidencePreview(resource), markerCount })),
      }
    })

  return {
    serviceId: "markerService",
    stateSource: "markerService",
    readonlyEvidence: true,
    ownerCount: owners.length,
    resourceCount: new Set(owners.flatMap((owner) => owner.resources.map((resource) => resource.resourcePreview))).size,
    markerCount: owners.reduce((total, owner) => total + owner.markerCount, 0),
    owners,
  }
}

function compareResourceMarkerGroups(left: ProblemResourceMarkerGroup, right: ProblemResourceMarkerGroup): number {
  const leftFirst = left.markers[0]
  const rightFirst = right.markers[0]
  if (leftFirst && rightFirst) {
    const severity = compareDiagnosticSeverity(leftFirst.severity, rightFirst.severity)
    if (severity !== 0) return severity
  }
  return left.path.localeCompare(right.path) || left.name.localeCompare(right.name)
}

function compareDiagnosticSeverity(left: Diagnostic["severity"], right: Diagnostic["severity"]): number {
  const weights: Record<Diagnostic["severity"], number> = {
    error: 8,
    warning: 4,
    info: 2,
    ai: 1,
  }
  return weights[right] - weights[left]
}

function asPositivePosition(value: number | undefined): number {
  return Math.max(1, Number.isFinite(value) ? Math.trunc(value || 1) : 1)
}

function basename(file: string): string {
  const normalized = normalizeDiagnosticFile(file)
  const index = normalized.lastIndexOf("/")
  return index >= 0 ? normalized.slice(index + 1) : normalized
}
