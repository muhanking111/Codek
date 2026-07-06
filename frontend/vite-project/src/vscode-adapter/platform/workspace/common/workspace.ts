/*---------------------------------------------------------------------------------------------
 * VS Code source adapter inspired by src/vs/platform/workspace/common/workspace.ts.
 * Keeps Codek workspace roots in one service-backed model for workbench, files,
 * labels, search, and legacy workspace manager projections.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from "../../../base/common/event"
import { extUriBiasedIgnorePathCase } from "../../../base/common/resources"
import { TernarySearchTree } from "../../../base/common/ternarySearchTree"
import { URI } from "../../../base/common/uri"
import { createDecorator } from "../../instantiation/common/instantiation"
import { InstantiationType, registerSingleton } from "../../instantiation/common/extensions"

export const IWorkspaceContextService = createDecorator<IWorkspaceContextService>("contextService")

export const enum WorkbenchState {
  EMPTY = 1,
  FOLDER = 2,
  WORKSPACE = 3,
}

export interface IWorkspaceFoldersWillChangeEvent {
  readonly changes: IWorkspaceFoldersChangeEvent
  readonly fromCache: boolean
  join(promise: Promise<void>): void
}

export interface IWorkspaceFoldersChangeEvent {
  readonly added: IWorkspaceFolder[]
  readonly removed: IWorkspaceFolder[]
  readonly changed: IWorkspaceFolder[]
}

export interface IWorkspace {
  readonly id: string
  readonly folders: IWorkspaceFolder[]
  readonly transient?: boolean
  readonly configuration?: URI | null
  readonly name?: string
}

export interface IWorkspaceFolderData {
  readonly uri: URI
  readonly name: string
  readonly index: number
}

export interface IWorkspaceFolder extends IWorkspaceFolderData {
  toResource(relativePath: string): URI
}

export interface ISingleFolderWorkspaceIdentifier {
  readonly id: string
  readonly uri: URI
}

export interface IWorkspaceIdentifier {
  readonly id: string
  readonly configPath: URI
}

export interface IWorkspaceContextService {
  readonly _serviceBrand: undefined
  readonly onDidChangeWorkbenchState: Event<WorkbenchState>
  readonly onDidChangeWorkspaceName: Event<void>
  readonly onWillChangeWorkspaceFolders: Event<IWorkspaceFoldersWillChangeEvent>
  readonly onDidChangeWorkspaceFolders: Event<IWorkspaceFoldersChangeEvent>
  getCompleteWorkspace(): Promise<IWorkspace>
  getWorkspace(): IWorkspace
  getWorkbenchState(): WorkbenchState
  getWorkspaceFolder(resource: URI): IWorkspaceFolder | null
  isCurrentWorkspace(workspaceIdOrFolder: IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | URI): boolean
  isInsideWorkspace(resource: URI): boolean
  hasWorkspaceData(): boolean
}

export interface CodekWorkspaceStateInput {
  readonly projectRoot?: string | null
  readonly workspaceFile?: string | null
  readonly path?: string | null
  readonly workspaceRoots?: readonly (string | null | undefined)[] | null
  readonly workspaceRootLabels?: Readonly<Record<string, string>> | null
  readonly name?: string | null
}

export interface CodekWorkspaceContextSnapshot {
  readonly id: string
  readonly projectRoot: string | null
  readonly workspaceFile: string | null
  readonly workspaceRoots: string[]
  readonly workspaceRootLabels: Record<string, string>
  readonly workbenchState: WorkbenchState
}

export interface WorkspaceRootInfo {
  readonly root: string
  readonly label: string
}

export class Workspace implements IWorkspace {
  private foldersMap = TernarySearchTree.forUris<WorkspaceFolder>(() => true)

  constructor(
    private workspaceId: string,
    private workspaceFolders: WorkspaceFolder[],
    private workspaceTransient: boolean,
    private workspaceConfiguration: URI | null,
    private readonly ignorePathCasing: (key: URI) => boolean,
    private workspaceName?: string,
  ) {
    this.updateFoldersMap()
  }

  get id(): string {
    return this.workspaceId
  }

  get folders(): WorkspaceFolder[] {
    return this.workspaceFolders
  }

  set folders(folders: WorkspaceFolder[]) {
    this.workspaceFolders = folders
    this.updateFoldersMap()
  }

  get transient(): boolean {
    return this.workspaceTransient
  }

  get configuration(): URI | null {
    return this.workspaceConfiguration
  }

  get name(): string | undefined {
    return this.workspaceName
  }

  update(workspace: Workspace): void {
    this.workspaceId = workspace.id
    this.workspaceTransient = workspace.transient
    this.workspaceConfiguration = workspace.configuration
    this.workspaceName = workspace.name
    this.folders = workspace.folders
  }

  getFolder(resource: URI): IWorkspaceFolder | null {
    return this.foldersMap.findSubstr(resource) || null
  }

  private updateFoldersMap(): void {
    this.foldersMap = TernarySearchTree.forUris<WorkspaceFolder>(this.ignorePathCasing, () => true)
    for (const folder of this.workspaceFolders) this.foldersMap.set(folder.uri, folder)
  }

  toJSON(): IWorkspace {
    return {
      id: this.id,
      folders: this.folders,
      transient: this.transient,
      configuration: this.configuration,
      name: this.name,
    }
  }
}

export class WorkspaceFolder implements IWorkspaceFolder {
  readonly uri: URI
  readonly name: string
  readonly index: number

  constructor(data: IWorkspaceFolderData, readonly raw?: { path?: string; uri?: string; name?: string }) {
    this.uri = data.uri
    this.name = data.name
    this.index = data.index
  }

  toResource(relativePath: string): URI {
    return URI.joinPath(this.uri, ...normalizeWorkspacePath(relativePath).split("/").filter(Boolean))
  }

  toJSON(): IWorkspaceFolderData {
    return {
      uri: this.uri,
      name: this.name,
      index: this.index,
    }
  }
}

export class CodekWorkspaceContextService implements IWorkspaceContextService {
  declare readonly _serviceBrand: undefined

  private readonly onDidChangeWorkbenchStateEmitter = new Emitter<WorkbenchState>()
  readonly onDidChangeWorkbenchState = this.onDidChangeWorkbenchStateEmitter.event

  private readonly onDidChangeWorkspaceNameEmitter = new Emitter<void>()
  readonly onDidChangeWorkspaceName = this.onDidChangeWorkspaceNameEmitter.event

  private readonly onWillChangeWorkspaceFoldersEmitter = new Emitter<IWorkspaceFoldersWillChangeEvent>()
  readonly onWillChangeWorkspaceFolders = this.onWillChangeWorkspaceFoldersEmitter.event

  private readonly onDidChangeWorkspaceFoldersEmitter = new Emitter<IWorkspaceFoldersChangeEvent>()
  readonly onDidChangeWorkspaceFolders = this.onDidChangeWorkspaceFoldersEmitter.event

  private workspace = new Workspace("empty-window", [], false, null, (uri) => extUriBiasedIgnorePathCase.ignorePathCasing(uri))
  private projectRoot: string | null = null
  private workspaceFile: string | null = null
  private workspaceRootLabels: Record<string, string> = {}

  getCompleteWorkspace(): Promise<IWorkspace> {
    return Promise.resolve(this.workspace)
  }

  getWorkspace(): IWorkspace {
    return this.workspace
  }

  getWorkbenchState(): WorkbenchState {
    if (!this.workspace.folders.length) return WorkbenchState.EMPTY
    return this.workspace.configuration || this.workspace.folders.length > 1 ? WorkbenchState.WORKSPACE : WorkbenchState.FOLDER
  }

  getWorkspaceFolder(resource: URI): IWorkspaceFolder | null {
    return this.workspace.getFolder(resource)
  }

  isCurrentWorkspace(workspaceIdOrFolder: IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | URI): boolean {
    if (URI.isUri(workspaceIdOrFolder)) {
      return this.workspace.folders.some((folder) => extUriBiasedIgnorePathCase.isEqual(folder.uri, workspaceIdOrFolder, true))
    }
    const candidate = workspaceIdOrFolder as Partial<IWorkspaceIdentifier & ISingleFolderWorkspaceIdentifier>
    if (candidate.id && candidate.id === this.workspace.id) return true
    if (candidate.uri) return this.isCurrentWorkspace(candidate.uri)
    if (candidate.configPath && this.workspace.configuration) {
      return extUriBiasedIgnorePathCase.isEqual(candidate.configPath, this.workspace.configuration, true)
    }
    return false
  }

  isInsideWorkspace(resource: URI): boolean {
    return Boolean(this.getWorkspaceFolder(resource))
  }

  hasWorkspaceData(): boolean {
    return this.workspace.folders.length > 0 || Boolean(this.workspace.configuration)
  }

  updateWorkspaceState(input: CodekWorkspaceStateInput = {}): CodekWorkspaceContextSnapshot {
    const projectRoot = normalizeWorkspacePath(input.projectRoot || firstRoot(input.workspaceRoots) || "")
    const workspaceRoots = normalizeWorkspaceRoots(input.workspaceRoots, projectRoot)
    const workspaceFile = normalizeWorkspacePath(input.workspaceFile || input.path || "")
    const labels = createWorkspaceRootLabels(workspaceRoots, input.workspaceRootLabels || undefined)
    const folders = workspaceRoots.map((root, index) => new WorkspaceFolder({
      uri: URI.file(root),
      name: labels[root] || basename(root),
      index,
    }, { path: root, name: labels[root] }))
    const nextWorkspace = new Workspace(
      createWorkspaceId({ projectRoot, workspaceFile, workspaceRoots }),
      folders,
      false,
      workspaceFile ? URI.file(workspaceFile) : null,
      (uri) => extUriBiasedIgnorePathCase.ignorePathCasing(uri),
      input.name || (workspaceFile ? basename(workspaceFile) : undefined),
    )
    const previousState = this.getWorkbenchState()
    const previousName = this.workspace.name
    const changes = diffWorkspaceFolders(this.workspace.folders, nextWorkspace.folders)

    if (changes.added.length || changes.removed.length || changes.changed.length) {
      const joiners: Promise<void>[] = []
      this.onWillChangeWorkspaceFoldersEmitter.fire({
        changes,
        fromCache: false,
        join(promise) {
          joiners.push(Promise.resolve(promise))
        },
      })
    }

    this.workspace = nextWorkspace
    this.projectRoot = projectRoot || null
    this.workspaceFile = workspaceFile || null
    this.workspaceRootLabels = labels

    if (previousState !== this.getWorkbenchState()) this.onDidChangeWorkbenchStateEmitter.fire(this.getWorkbenchState())
    if (previousName !== this.workspace.name) this.onDidChangeWorkspaceNameEmitter.fire()
    if (changes.added.length || changes.removed.length || changes.changed.length) this.onDidChangeWorkspaceFoldersEmitter.fire(changes)

    return this.getCodekWorkspaceState()
  }

  clear(): void {
    this.updateWorkspaceState({})
  }

  getCodekWorkspaceState(): CodekWorkspaceContextSnapshot {
    return {
      id: this.workspace.id,
      projectRoot: this.projectRoot,
      workspaceFile: this.workspaceFile,
      workspaceRoots: this.workspace.folders.map((folder) => workspaceFolderPath(folder)),
      workspaceRootLabels: { ...this.workspaceRootLabels },
      workbenchState: this.getWorkbenchState(),
    }
  }

  getWorkspaceRootLabel(root: string): string {
    const normalized = normalizeWorkspacePath(root)
    return this.workspaceRootLabels[normalized] || basename(normalized)
  }

  getVirtualRootKey(root: string): string {
    const normalized = normalizeWorkspacePath(root)
    const label = this.getWorkspaceRootLabel(normalized)
    return label ? `/${label}` : ""
  }

  createWorkspaceRootLabels(roots: readonly string[], labels?: Readonly<Record<string, string>>): Record<string, string> {
    return createWorkspaceRootLabels(roots, labels)
  }

  isVirtualWorkspacePath(pathValue: unknown): boolean {
    const normalized = normalizeWorkspacePath(String(pathValue || ""))
    if (!normalized.startsWith("/")) return false
    return this.workspace.folders.some((folder) => {
      const root = workspaceFolderPath(folder)
      const key = this.getVirtualRootKey(root)
      return normalized === key || normalized.startsWith(`${key}/`)
    })
  }

  resolveVirtualWorkspacePath(pathValue: unknown): string {
    const normalized = normalizePathSeparators(String(pathValue || ""))
    for (const folder of this.workspace.folders) {
      const root = workspaceFolderPath(folder)
      const key = this.getVirtualRootKey(root)
      if (normalized === key) return root
      if (normalized.startsWith(`${key}/`)) return `${root}/${normalized.slice(key.length + 1)}`
    }
    return normalized
  }

  resolveWorkspaceFullPath(pathValue: unknown): string | null {
    const normalized = normalizeWorkspacePath(String(pathValue || ""))
    const roots = this.workspace.folders.map((folder) => workspaceFolderPath(folder)).sort((left, right) => right.length - left.length)
    const lowerNormalized = normalized.toLowerCase()
    for (const root of roots) {
      const lowerRoot = root.toLowerCase()
      if (lowerNormalized === lowerRoot) return this.getVirtualRootKey(root)
      if (lowerNormalized.startsWith(`${lowerRoot}/`)) return `${this.getVirtualRootKey(root)}/${normalized.slice(root.length + 1)}`
    }
    return null
  }

  getWorkspaceRootInfo(pathValue: unknown): WorkspaceRootInfo | null {
    const root = this.getRootForPath(pathValue)
    if (!root) return null
    return {
      root,
      label: this.getWorkspaceRootLabel(root),
    }
  }

  normalizeRelativePath(pathValue: unknown): string {
    const raw = String(pathValue || "")
    if (this.isVirtualWorkspacePath(raw)) return normalizePathSeparators(raw)
    const normalized = normalizePathSeparators(raw).replace(/^\.?\//, "")
    if (normalized.split("/").includes("..")) {
      throw new Error(`[security] path traversal rejected: ${raw}`)
    }
    const workspaceRootPath = this.resolveWorkspaceFullPath(normalized)
    if (workspaceRootPath) {
      return this.workspace.folders.length > 1 ? workspaceRootPath : workspaceRootPath.replace(/^\/[^/]+\/?/, "")
    }
    if (!this.projectRoot) return normalized
    const root = normalizeWorkspacePath(this.projectRoot)
    const lowerNormalized = normalized.toLowerCase()
    const lowerRoot = root.toLowerCase()
    if (lowerNormalized === lowerRoot) return ""
    if (lowerNormalized.startsWith(`${lowerRoot}/`)) return normalized.slice(root.length + 1)
    return normalized
  }

  resolveFsPath(pathValue: unknown): string {
    if (this.isVirtualWorkspacePath(pathValue)) return this.resolveVirtualWorkspacePath(pathValue)
    const relative = this.normalizeRelativePath(pathValue)
    const root = normalizeWorkspacePath(this.projectRoot || "")
    return relative && root ? `${root}/${relative}` : root || relative
  }

  private getRootForPath(pathValue: unknown): string | null {
    const roots = this.workspace.folders.map((folder) => workspaceFolderPath(folder)).sort((left, right) => right.length - left.length)
    const normalizedInput = normalizeWorkspacePath(String(pathValue || ""))
    const lowerInput = normalizedInput.toLowerCase()
    const directRoot = roots.find((root) => lowerInput === root.toLowerCase() || lowerInput.startsWith(`${root.toLowerCase()}/`))
    if (directRoot) return directRoot
    const fullPath = this.isVirtualWorkspacePath(pathValue)
      ? this.resolveVirtualWorkspacePath(pathValue)
      : this.resolveFsPath(pathValue)
    const normalizedFullPath = normalizeWorkspacePath(fullPath)
    const lowerFullPath = normalizedFullPath.toLowerCase()
    return roots.find((root) => lowerFullPath === root.toLowerCase() || lowerFullPath.startsWith(`${root.toLowerCase()}/`)) || null
  }
}

export const globalWorkspaceContextService = new CodekWorkspaceContextService()
registerSingleton(IWorkspaceContextService, globalWorkspaceContextService, InstantiationType.Delayed)

export function toWorkspaceFolder(resource: URI): WorkspaceFolder {
  return new WorkspaceFolder({ uri: resource, index: 0, name: extUriBiasedIgnorePathCase.basenameOrAuthority(resource) }, { uri: resource.toString() })
}

export function normalizeWorkspacePath(pathValue: unknown): string {
  return normalizePathSeparators(String(pathValue || "")).replace(/^\/([A-Za-z]:)/, "$1").replace(/\/+$/, "")
}

export function normalizePathSeparators(pathValue: string): string {
  return String(pathValue || "").replace(/\\/g, "/")
}

function normalizeWorkspaceRoots(roots: CodekWorkspaceStateInput["workspaceRoots"], projectRoot: string): string[] {
  const values = Array.isArray(roots) && roots.length ? roots : (projectRoot ? [projectRoot] : [])
  const seen = new Set<string>()
  const normalizedRoots: string[] = []
  for (const root of values) {
    const normalized = normalizeWorkspacePath(root || "")
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    normalizedRoots.push(normalized)
  }
  return normalizedRoots
}

function firstRoot(roots: CodekWorkspaceStateInput["workspaceRoots"]): string {
  return Array.isArray(roots) ? String(roots.find((root) => Boolean(root)) || "") : ""
}

function createWorkspaceRootLabels(roots: readonly string[], existing?: Readonly<Record<string, string>>): Record<string, string> {
  const normalizedRoots = roots.map((root) => normalizeWorkspacePath(root)).filter(Boolean)
  const labels: Record<string, string> = {}
  const baseCounts = new Map<string, number>()
  for (const root of normalizedRoots) {
    const explicit = existing?.[root]
    const label = explicit || basename(root)
    baseCounts.set(label.toLowerCase(), (baseCounts.get(label.toLowerCase()) || 0) + 1)
  }
  const used = new Set<string>()
  for (const root of normalizedRoots) {
    const explicit = existing?.[root]
    let label = explicit || basename(root)
    if (!explicit && (baseCounts.get(label.toLowerCase()) || 0) > 1) {
      const parent = normalizeWorkspacePath(root).split("/").filter(Boolean).slice(-2, -1)[0]
      if (parent) label = `${label} (${parent})`
    }
    const original = label
    let index = 2
    while (used.has(label.toLowerCase())) {
      label = `${original} ${index}`
      index += 1
    }
    used.add(label.toLowerCase())
    labels[root] = label
  }
  return labels
}

function basename(pathValue: string): string {
  const normalized = normalizeWorkspacePath(pathValue)
  return normalized.split("/").filter(Boolean).pop() || normalized
}

function uriToWorkspacePath(uri: URI): string {
  return normalizeWorkspacePath(uri.scheme === "file" ? uri.path : uri.path || uri.toString())
}

function workspaceFolderPath(folder: IWorkspaceFolder): string {
  const rawPath = (folder as WorkspaceFolder).raw?.path
  return normalizeWorkspacePath(rawPath || uriToWorkspacePath(folder.uri))
}

function createWorkspaceId(input: { projectRoot: string; workspaceFile: string; workspaceRoots: readonly string[] }): string {
  const source = JSON.stringify(input)
  let hash = 0
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0
  }
  return `codek-${Math.abs(hash).toString(36) || "empty"}`
}

function diffWorkspaceFolders(previous: readonly IWorkspaceFolder[], next: readonly IWorkspaceFolder[]): IWorkspaceFoldersChangeEvent {
  const previousByKey = new Map(previous.map((folder) => [folderKey(folder), folder]))
  const nextByKey = new Map(next.map((folder) => [folderKey(folder), folder]))
  const added: IWorkspaceFolder[] = []
  const removed: IWorkspaceFolder[] = []
  const changed: IWorkspaceFolder[] = []
  for (const folder of next) {
    const existing = previousByKey.get(folderKey(folder))
    if (!existing) added.push(folder)
    else if (existing.name !== folder.name || existing.index !== folder.index) changed.push(folder)
  }
  for (const folder of previous) {
    if (!nextByKey.has(folderKey(folder))) removed.push(folder)
  }
  return { added, removed, changed }
}

function folderKey(folder: IWorkspaceFolder): string {
  return extUriBiasedIgnorePathCase.getComparisonKey(folder.uri, true)
}
