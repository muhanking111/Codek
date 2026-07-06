// VS Code source adapter.
// Source reference:
// - D:\SourceMirror\vscode\src\vs\platform\markers\common\markers.ts
// - D:\SourceMirror\vscode\src\vs\platform\markers\common\markerService.ts

import { Emitter, type Event } from "../../../base/common/event"
import { URI } from "../../../base/common/uri"
import { InstantiationType, registerSingleton } from "../../instantiation/common/extensions"
import { createDecorator } from "../../instantiation/common/instantiation"

export enum MarkerSeverity {
  Hint = 1,
  Info = 2,
  Warning = 4,
  Error = 8,
}

export type CodekMarkerSeverity = "error" | "warning" | "info" | "ai"

export interface MarkerDataLike {
  source?: string
  code?: string | number | { value: string }
  message?: string
  startLineNumber?: number
  startColumn?: number
  endLineNumber?: number
  endColumn?: number
  severity?: MarkerSeverity | number | CodekMarkerSeverity | string
}

export interface NormalizedMarkerData {
  source?: string
  code?: string | number | { value: string }
  message: string
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  severity: MarkerSeverity
}

export interface MarkerStatistics {
  errors: number
  warnings: number
  infos: number
  unknowns: number
}

export interface IMarkerReadOptions {
  owner?: string
  resource?: URI
  severities?: number
  take?: number
  ignoreResourceFilters?: boolean
}

export interface IMarker extends NormalizedMarkerData {
  owner: string
  resource: URI
}

export interface IResourceMarker {
  resource: URI
  marker: IMarker
}

export interface MarkerOwnerEvidenceResource {
  resourcePreview: string
  markerCount: number
}

export interface MarkerOwnerEvidence {
  owner: string
  resourceCount: number
  markerCount: number
  resources: MarkerOwnerEvidenceResource[]
}

export interface MarkerServiceOwnerEvidenceSnapshot {
  serviceId: "markerService"
  stateSource: "markerService"
  readonlyEvidence: true
  ownerCount: number
  resourceCount: number
  markerCount: number
  owners: MarkerOwnerEvidence[]
}

export interface IMarkerService {
  readonly _serviceBrand: undefined
  readonly onMarkerChanged: Event<readonly URI[]>
  getStatistics(): MarkerStatistics
  getOwnerEvidenceSnapshot?(): MarkerServiceOwnerEvidenceSnapshot
  changeOne(owner: string, resource: URI, markers: readonly MarkerDataLike[]): void
  changeAll(owner: string, data: readonly [URI, readonly MarkerDataLike[]][]): void
  remove(owner: string, resources?: readonly URI[]): void
  read(filter?: IMarkerReadOptions): IMarker[]
  installResourceFilter?(filter: (resource: URI) => boolean): { dispose(): void }
}

export const IMarkerService = createDecorator<IMarkerService>("markerService")

export function compareMarkerSeverity(left: MarkerSeverity | number, right: MarkerSeverity | number): number {
  return right - left
}

export function toMarkerSeverity(severity?: MarkerDataLike["severity"]): MarkerSeverity {
  if (severity === MarkerSeverity.Error || severity === "error") return MarkerSeverity.Error
  if (severity === MarkerSeverity.Warning || severity === "warning") return MarkerSeverity.Warning
  if (severity === MarkerSeverity.Info || severity === "info") return MarkerSeverity.Info
  if (severity === MarkerSeverity.Hint || severity === "ai" || severity === "hint") return MarkerSeverity.Hint
  return MarkerSeverity.Error
}

export function toCodekSeverity(severity?: MarkerDataLike["severity"]): CodekMarkerSeverity {
  const markerSeverity = toMarkerSeverity(severity)
  if (markerSeverity === MarkerSeverity.Error) return "error"
  if (markerSeverity === MarkerSeverity.Warning) return "warning"
  if (markerSeverity === MarkerSeverity.Info) return "info"
  return "ai"
}

export function normalizeMarkerData(marker: MarkerDataLike): NormalizedMarkerData {
  const startLineNumber = Math.max(1, marker.startLineNumber || 1)
  const startColumn = Math.max(1, marker.startColumn || 1)
  return {
    source: marker.source,
    code: marker.code,
    message: String(marker.message || ""),
    startLineNumber,
    startColumn,
    endLineNumber: Math.max(startLineNumber, marker.endLineNumber || startLineNumber),
    endColumn: Math.max(1, marker.endColumn || startColumn + 1),
    severity: toMarkerSeverity(marker.severity),
  }
}

export function makeMarkerKey(marker: MarkerDataLike, useMessage = true): string {
  const normalized = normalizeMarkerData(marker)
  const code = normalized.code && typeof normalized.code === "object" ? normalized.code.value : normalized.code
  return [
    "",
    escapeMarkerKeyPart(normalized.source || ""),
    escapeMarkerKeyPart(code == null ? "" : String(code)),
    useMessage ? escapeMarkerKeyPart(normalized.message) : "",
    String(normalized.startLineNumber),
    String(normalized.startColumn),
    String(normalized.endLineNumber),
    String(normalized.endColumn),
    "",
  ].join("¦")
}

export function sortMarkers<TMarker extends MarkerDataLike & { file?: string }>(markers: readonly TMarker[]): TMarker[] {
  return [...markers].sort((left, right) => {
    const severity = compareMarkerSeverity(toMarkerSeverity(left.severity), toMarkerSeverity(right.severity))
    if (severity !== 0) return severity
    const file = (left.file || "").localeCompare(right.file || "")
    if (file !== 0) return file
    const leftRange = normalizeMarkerData(left)
    const rightRange = normalizeMarkerData(right)
    return leftRange.startLineNumber - rightRange.startLineNumber || leftRange.startColumn - rightRange.startColumn
  })
}

export class MarkerService implements IMarkerService {
  declare readonly _serviceBrand: undefined

  private readonly onMarkerChangedEmitter = new Emitter<readonly URI[]>()
  readonly onMarkerChanged = this.onMarkerChangedEmitter.event

  private readonly markersByOwnerAndResource = new Map<string, Map<string, IMarker[]>>()
  private readonly resourceFilters = new Set<(resource: URI) => boolean>()
  private readonly pendingChangedResources = new Map<string, URI>()
  private markerChangeFlushScheduled = false

  getStatistics(): MarkerStatistics {
    const result: MarkerStatistics = { errors: 0, warnings: 0, infos: 0, unknowns: 0 }
    for (const marker of this.read({ ignoreResourceFilters: true })) {
      if (marker.severity === MarkerSeverity.Error) result.errors += 1
      else if (marker.severity === MarkerSeverity.Warning) result.warnings += 1
      else if (marker.severity === MarkerSeverity.Info) result.infos += 1
      else result.unknowns += 1
    }
    return result
  }

  getOwnerEvidenceSnapshot(): MarkerServiceOwnerEvidenceSnapshot {
    const owners: MarkerOwnerEvidence[] = []
    const resources = new Set<string>()
    let markerCount = 0

    for (const [owner, resourceMarkers] of [...this.markersByOwnerAndResource.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const ownerResources: MarkerOwnerEvidenceResource[] = []
      for (const [resource, markers] of [...resourceMarkers.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        resources.add(resource)
        markerCount += markers.length
        ownerResources.push({
          resourcePreview: createMarkerEvidencePreview(resource),
          markerCount: markers.length,
        })
      }
      owners.push({
        owner,
        resourceCount: ownerResources.length,
        markerCount: ownerResources.reduce((total, resource) => total + resource.markerCount, 0),
        resources: ownerResources,
      })
    }

    return {
      serviceId: "markerService",
      stateSource: "markerService",
      readonlyEvidence: true,
      ownerCount: owners.length,
      resourceCount: resources.size,
      markerCount,
      owners,
    }
  }

  changeOne(owner: string, resource: URI, markers: readonly MarkerDataLike[]): void {
    const resourceMarkers = this.getOwnerMarkers(owner, true)
    const resourceKey = markerResourceKey(resource)
    if (markers.length) {
      resourceMarkers.set(resourceKey, this.toMarkers(owner, resource, markers))
    } else {
      if (!resourceMarkers.delete(resourceKey)) return
    }
    if (resourceMarkers.size === 0) this.markersByOwnerAndResource.delete(owner)
    this.queueMarkerChanged([resource])
  }

  changeAll(owner: string, data: readonly [URI, readonly MarkerDataLike[]][]): void {
    const previous = this.getOwnerMarkers(owner, false)
    const changedResources = new Map<string, URI>()
    for (const markers of previous?.values() || []) {
      const resource = markers[0]?.resource
      if (resource) changedResources.set(markerResourceKey(resource), resource)
    }

    const next = new Map<string, IMarker[]>()
    for (const [resource, markers] of data) {
      changedResources.set(markerResourceKey(resource), resource)
      if (markers.length) next.set(markerResourceKey(resource), this.toMarkers(owner, resource, markers))
    }

    if (next.size) this.markersByOwnerAndResource.set(owner, next)
    else this.markersByOwnerAndResource.delete(owner)
    this.queueMarkerChanged([...changedResources.values()])
  }

  remove(owner: string, resources?: readonly URI[]): void {
    const ownerMarkers = this.getOwnerMarkers(owner, false)
    if (!ownerMarkers) return

    const changedResources: URI[] = []
    if (!resources) {
      for (const markers of ownerMarkers.values()) {
        const resource = markers[0]?.resource
        if (resource) changedResources.push(resource)
      }
      this.markersByOwnerAndResource.delete(owner)
    } else {
      for (const resource of resources) {
        if (ownerMarkers.delete(markerResourceKey(resource))) changedResources.push(resource)
      }
      if (ownerMarkers.size === 0) this.markersByOwnerAndResource.delete(owner)
    }

    if (changedResources.length) this.queueMarkerChanged(changedResources)
  }

  read(filter: IMarkerReadOptions = {}): IMarker[] {
    const result: IMarker[] = []
    const ownerEntries = filter.owner
      ? ([[filter.owner, this.getOwnerMarkers(filter.owner, false)]] as Array<[string, Map<string, IMarker[]> | undefined]>)
      : [...this.markersByOwnerAndResource.entries()]
    const resourceKey = filter.resource ? markerResourceKey(filter.resource) : undefined

    for (const [, resources] of ownerEntries) {
      if (!resources) continue
      const resourceEntries = resourceKey ? [[resourceKey, resources.get(resourceKey)] as const] : [...resources.entries()]
      for (const [, markers] of resourceEntries) {
        if (!markers) continue
        for (const marker of markers) {
          if (!this.acceptMarker(marker, filter)) continue
          result.push(marker)
          if (filter.take && result.length >= filter.take) return result
        }
      }
    }

    return sortMarkers(result.map((marker) => ({ ...marker, file: marker.resource.toString() }))).map(({ file: _file, ...marker }) => marker)
  }

  installResourceFilter(filter: (resource: URI) => boolean): { dispose(): void } {
    this.resourceFilters.add(filter)
    return {
      dispose: () => {
        this.resourceFilters.delete(filter)
      },
    }
  }

  dispose(): void {
    this.onMarkerChangedEmitter.dispose()
    this.resourceFilters.clear()
    this.markersByOwnerAndResource.clear()
    this.pendingChangedResources.clear()
    this.markerChangeFlushScheduled = false
  }

  private queueMarkerChanged(resources: readonly URI[]): void {
    for (const resource of resources) {
      this.pendingChangedResources.set(markerResourceKey(resource), resource)
    }
    if (this.markerChangeFlushScheduled) return
    this.markerChangeFlushScheduled = true
    queueMicrotask(() => {
      this.markerChangeFlushScheduled = false
      if (!this.pendingChangedResources.size) return
      const changedResources = [...this.pendingChangedResources.values()]
      this.pendingChangedResources.clear()
      this.onMarkerChangedEmitter.fire(changedResources)
    })
  }

  private getOwnerMarkers(owner: string, create: true): Map<string, IMarker[]>
  private getOwnerMarkers(owner: string, create: false): Map<string, IMarker[]> | undefined
  private getOwnerMarkers(owner: string, create: boolean): Map<string, IMarker[]> | undefined {
    const existing = this.markersByOwnerAndResource.get(owner)
    if (existing || !create) return existing
    const markers = new Map<string, IMarker[]>()
    this.markersByOwnerAndResource.set(owner, markers)
    return markers
  }

  private toMarkers(owner: string, resource: URI, markers: readonly MarkerDataLike[]): IMarker[] {
    return sortMarkers(markers.map((marker) => ({ owner, resource, ...normalizeMarkerData(marker) })))
  }

  private acceptMarker(marker: IMarker, filter: IMarkerReadOptions): boolean {
    if (filter.resource && markerResourceKey(marker.resource) !== markerResourceKey(filter.resource)) return false
    if (filter.severities !== undefined && (marker.severity & filter.severities) === 0) return false
    if (!filter.ignoreResourceFilters) {
      for (const resourceFilter of this.resourceFilters) {
        if (!resourceFilter(marker.resource)) return false
      }
    }
    return true
  }
}

export const globalMarkerService = new MarkerService()

registerSingleton(IMarkerService, globalMarkerService, InstantiationType.Eager)

function markerResourceKey(resource: URI): string {
  return resource.toString()
}

function escapeMarkerKeyPart(value: string): string {
  return value.replace(/¦/g, "\\¦")
}

function createMarkerEvidencePreview(value: string): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim()
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized
}
