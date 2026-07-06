import { Emitter, type Event } from "../vscode-adapter/base/common/event"
import type { IDisposable } from "../vscode-adapter/base/common/lifecycle"
import { DisposableStore } from "../vscode-adapter/base/common/lifecycle"
import { URI } from "../vscode-adapter/base/common/uri"
import {
  FileChangeType,
  type FileChangesEvent,
  type IFileService,
  type IWatchOptions,
} from "../vscode-adapter/platform/files/common/files"

export interface WorkspaceFileWatcherFolder {
  readonly uri: URI
  readonly name: string
}

export interface WorkspaceFileWatcherConfiguration {
  readonly watcherExclude?: Record<string, boolean>
  readonly watcherInclude?: readonly string[]
}

export interface WorkspaceFileWatcherServiceOptions {
  readonly fileService: Pick<IFileService, "onDidFilesChange" | "watch">
  readonly workspaceFolders: readonly WorkspaceFileWatcherFolder[]
  readonly configuration?: WorkspaceFileWatcherConfiguration
  readonly recursive?: boolean
  readonly debounceMs?: number
}

export type WorkspaceFileEventType = "create" | "change" | "delete"

export interface WorkspaceFileEventProjection {
  readonly type: WorkspaceFileEventType
  readonly resource: string
  readonly workspaceFolder: string
  readonly workspaceFolderName: string
  readonly relativePath: string
  readonly evidenceSafe: true
}

export interface WorkspaceFileEventsBatch {
  readonly events: readonly WorkspaceFileEventProjection[]
}

export interface WorkspaceFileWatcherService extends IDisposable {
  readonly onDidChange: Event<WorkspaceFileEventsBatch>
  updateWorkspaceFolders(folders: readonly WorkspaceFileWatcherFolder[]): void
  updateConfiguration(configuration: WorkspaceFileWatcherConfiguration): void
  flush(): void
}

export function createWorkspaceFileWatcherService(options: WorkspaceFileWatcherServiceOptions): WorkspaceFileWatcherService {
  return new CodekWorkspaceFileWatcherService(options)
}

export function projectWorkspaceFileEvent(
  event: FileChangesEvent,
  folders: readonly WorkspaceFileWatcherFolder[],
): WorkspaceFileEventProjection[] {
  const projections: WorkspaceFileEventProjection[] = []
  for (const resource of event.rawAdded) {
    const projection = projectResourceChange("create", resource, folders)
    if (projection) projections.push(projection)
  }
  for (const resource of event.rawUpdated) {
    const projection = projectResourceChange("change", resource, folders)
    if (projection) projections.push(projection)
  }
  for (const resource of event.rawDeleted) {
    const projection = projectResourceChange("delete", resource, folders)
    if (projection) projections.push(projection)
  }
  return coalesceProjectedEvents(projections)
}

class CodekWorkspaceFileWatcherService implements WorkspaceFileWatcherService {
  private readonly onDidChangeEmitter = new Emitter<WorkspaceFileEventsBatch>()
  readonly onDidChange = this.onDidChangeEmitter.event
  private readonly watchDisposables = new DisposableStore()
  private readonly fileChangeListener: IDisposable
  private workspaceFolders: WorkspaceFileWatcherFolder[]
  private configuration: WorkspaceFileWatcherConfiguration
  private readonly recursive: boolean
  private readonly debounceMs: number
  private pendingEvents: WorkspaceFileEventProjection[] = []
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  constructor(private readonly options: WorkspaceFileWatcherServiceOptions) {
    this.workspaceFolders = [...options.workspaceFolders]
    this.configuration = options.configuration || {}
    this.recursive = options.recursive !== false
    this.debounceMs = Math.max(0, options.debounceMs ?? 50)
    this.fileChangeListener = options.fileService.onDidFilesChange((event) => this.acceptFileChanges(event))
    this.refreshWatchers()
  }

  updateWorkspaceFolders(folders: readonly WorkspaceFileWatcherFolder[]): void {
    if (this.disposed) return
    this.workspaceFolders = [...folders]
    this.refreshWatchers()
  }

  updateConfiguration(configuration: WorkspaceFileWatcherConfiguration): void {
    if (this.disposed) return
    this.configuration = configuration
    this.refreshWatchers()
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    if (this.pendingEvents.length === 0) return
    const events = coalesceProjectedEvents(this.pendingEvents)
    this.pendingEvents = []
    if (events.length > 0) this.onDidChangeEmitter.fire({ events })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    this.pendingEvents = []
    this.fileChangeListener.dispose()
    this.watchDisposables.dispose()
    this.onDidChangeEmitter.dispose()
  }

  private acceptFileChanges(event: FileChangesEvent): void {
    const projected = projectWorkspaceFileEvent(event, this.workspaceFolders)
    if (projected.length === 0) return
    this.pendingEvents.push(...projected)
    if (this.debounceMs === 0) {
      this.flush()
      return
    }
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => this.flush(), this.debounceMs)
  }

  private refreshWatchers(): void {
    this.watchDisposables.clear()
    const excludes = getWatcherExcludes(this.configuration)
    const seen = new Set<string>()
    for (const folder of this.workspaceFolders) {
      for (const resource of getWorkspaceWatchResources(folder, this.configuration)) {
        const key = resource.toString()
        if (seen.has(key)) continue
        seen.add(key)
        const options: IWatchOptions = {
          recursive: this.recursive,
          excludes,
        }
        this.watchDisposables.add(this.options.fileService.watch(resource, options) as IDisposable)
      }
    }
  }
}

export function getWorkspaceWatchResources(
  folder: WorkspaceFileWatcherFolder,
  configuration: WorkspaceFileWatcherConfiguration = {},
): URI[] {
  const resources = new Map<string, URI>()
  resources.set(folder.uri.toString(), folder.uri)
  for (const includePath of configuration.watcherInclude || []) {
    const normalizedInclude = normalizeRelativePath(includePath)
    if (!normalizedInclude) continue
    const resource = isAbsoluteFsPath(normalizedInclude)
      ? URI.file(normalizedInclude).with({ scheme: folder.uri.scheme })
      : joinUriPath(folder.uri, normalizedInclude)
    if (getRelativePath(folder.uri, resource).startsWith("../")) continue
    resources.set(resource.toString(), resource)
  }
  return Array.from(resources.values())
}

export function getWatcherExcludes(configuration: WorkspaceFileWatcherConfiguration = {}): string[] {
  return Object.entries(configuration.watcherExclude || {})
    .filter(([pattern, enabled]) => Boolean(pattern) && enabled === true)
    .map(([pattern]) => pattern)
}

function projectResourceChange(
  type: WorkspaceFileEventType,
  resource: URI,
  folders: readonly WorkspaceFileWatcherFolder[],
): WorkspaceFileEventProjection | undefined {
  const folder = findWorkspaceFolder(resource, folders)
  if (!folder) return undefined
  return {
    type,
    resource: resource.toString(),
    workspaceFolder: folder.uri.toString(),
    workspaceFolderName: folder.name,
    relativePath: getRelativePath(folder.uri, resource),
    evidenceSafe: true,
  }
}

function findWorkspaceFolder(resource: URI, folders: readonly WorkspaceFileWatcherFolder[]): WorkspaceFileWatcherFolder | undefined {
  let best: WorkspaceFileWatcherFolder | undefined
  for (const folder of folders) {
    const relativePath = getRelativePath(folder.uri, resource)
    if (relativePath.startsWith("../")) continue
    if (!best || folder.uri.fsPath.length > best.uri.fsPath.length) best = folder
  }
  return best
}

function coalesceProjectedEvents(events: readonly WorkspaceFileEventProjection[]): WorkspaceFileEventProjection[] {
  const byResource = new Map<string, WorkspaceFileEventProjection>()
  for (const event of events) {
    const previous = byResource.get(event.resource)
    byResource.set(event.resource, previous ? coalesceProjectedEvent(previous, event) : event)
  }
  return Array.from(byResource.values())
}

function coalesceProjectedEvent(
  previous: WorkspaceFileEventProjection,
  next: WorkspaceFileEventProjection,
): WorkspaceFileEventProjection {
  if (next.type === "delete") return { ...next, type: "delete" }
  if (previous.type === "delete" && next.type === "create") return { ...next, type: "change" }
  if (previous.type === "create" && next.type === "change") return previous
  return next
}

function getRelativePath(folder: URI, resource: URI): string {
  const folderPath = normalizeFsPath(folder.fsPath)
  const resourcePath = normalizeFsPath(resource.fsPath)
  if (resourcePath === folderPath) return ""
  const prefix = folderPath.endsWith("/") ? folderPath : `${folderPath}/`
  if (!resourcePath.startsWith(prefix)) return "../"
  return resourcePath.slice(prefix.length)
}

function joinUriPath(base: URI, relativePath: string): URI {
  const basePath = normalizeFsPath(base.fsPath)
  const segments = relativePath.split(/[\\/]+/).filter(Boolean)
  const stack = basePath.split("/").filter(Boolean)
  const drivePrefix = /^[A-Za-z]:$/.test(stack[0] || "") ? stack.shift() : undefined
  for (const segment of segments) {
    if (segment === ".") continue
    if (segment === "..") stack.pop()
    else stack.push(segment)
  }
  const joinedPath = `${drivePrefix ? `${drivePrefix}/` : "/"}${stack.join("/")}`
  return URI.file(joinedPath)
}

function normalizeRelativePath(path: string): string {
  return String(path || "").trim().replace(/\\/g, "/")
}

function normalizeFsPath(path: string): string {
  return String(path || "").replace(/\\/g, "/").replace(/\/+$/, "")
}

function isAbsoluteFsPath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path) || path.startsWith("/")
}
