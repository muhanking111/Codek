import { createExplorerItem, ExplorerModel, normalizeExplorerUri } from "../model/ExplorerModel"
import type { ExplorerItem } from "../model/ExplorerModel"
import { normalizeFileStat } from "../../vscode-adapter/platform/files/common/files"
import { createExplorerItemComparator, type ISortOrderConfiguration } from "../../vscode-adapter/workbench/contrib/files/explorerFileSorter"

export interface ExplorerRawEntry {
  name: string
  path?: string
  isDir?: boolean
  isDirectory?: boolean
  isFile?: boolean
  isSymbolicLink?: boolean
  type?: number
  size?: number
  mtime?: number
  mtimeMs?: number
}

export interface CancellationToken {
  readonly isCancellationRequested?: boolean
}

export interface ExplorerDataSourceOptions {
  roots: ExplorerItem[]
  model: ExplorerModel
  readDir?: (uri: string) => Promise<ExplorerRawEntry[]>
  heavyDirectories?: Set<string>
  maxConcurrentReads?: number
  onDidChangeItem?: (item: ExplorerItem) => void
  sortOrderConfiguration?: Partial<ISortOrderConfiguration>
}

export interface ExplorerPrewarmOptions {
  maxDirectories?: number
  maxDepth?: number
  concurrency?: number
}

export const DEFAULT_HEAVY_DIRECTORIES = new Set([
  ".git",
  "dist",
  "build",
  "target",
  "out",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "coverage",
  ".codek-cache",
  "__pycache__",
])

export class ExplorerDataSource {
  private compareExplorerItems = createExplorerItemComparator()
  private roots: ExplorerItem[]
  private model: ExplorerModel
  private readDir?: (uri: string) => Promise<ExplorerRawEntry[]>
  private heavyDirectories: Set<string>
  private inflight = new Map<string, { item: ExplorerItem; generation: number; promise: Promise<ExplorerItem[]> }>()
  private queuedReads: QueuedReadSlot[] = []
  private activeReadCount = 0
  private maxConcurrentReads = 2
  private generation = 0
  private disposed = false
  private onDidChangeItem?: (item: ExplorerItem) => void

  constructor(options: ExplorerDataSourceOptions) {
    this.roots = options.roots
    this.model = options.model
    this.readDir = options.readDir
    this.heavyDirectories = options.heavyDirectories || new Set()
    this.onDidChangeItem = options.onDidChangeItem
    this.updateSortOrderConfiguration(options.sortOrderConfiguration)
    this.setMaxConcurrentReads(options.maxConcurrentReads)
  }

  hasChildren(item: ExplorerItem): boolean {
    return item.isDirectory && !item.limited
  }

  async getChildren(item: ExplorerItem | null, token: CancellationToken = {}): Promise<ExplorerItem[]> {
    if (!item) return this.roots
    if (!this.hasChildren(item)) return []
    if (item.childrenLoaded && !item.stale) return item.children
    if (this.disposed || token.isCancellationRequested) return item.children

    const existing = this.inflight.get(item.uri)
    if (existing && existing.generation === this.generation) return existing.promise

    const generation = this.generation
    const request = this.loadChildren(item, token, generation).finally(() => {
      const current = this.inflight.get(item.uri)
      if (current?.promise === request) this.inflight.delete(item.uri)
    })
    this.inflight.set(item.uri, { item, generation, promise: request })
    return request
  }

  markStale(item: ExplorerItem): void {
    item.stale = true
  }

  updateSortOrderConfiguration(configuration: Partial<ISortOrderConfiguration> = {}): void {
    this.compareExplorerItems = createExplorerItemComparator(configuration)
  }

  setMaxConcurrentReads(value: unknown): void {
    if (value == null || value === "") {
      this.maxConcurrentReads = 2
      this.drainReadQueue()
      return
    }
    const numeric = Math.floor(Number(value || 0))
    this.maxConcurrentReads = Math.max(1, Math.min(8, Number.isFinite(numeric) ? numeric : 2))
    this.drainReadQueue()
  }

  dispose(): void {
    this.disposed = true
    this.generation += 1
    for (const request of this.inflight.values()) {
      request.item.loading = false
      this.notifyItemChanged(request.item)
    }
    this.inflight.clear()
    const queued = this.queuedReads.splice(0)
    for (const request of queued) request.resolve(false)
    this.activeReadCount = 0
  }

  async prewarmChildren(items: ExplorerItem[], options: ExplorerPrewarmOptions = {}): Promise<void> {
    if (this.disposed) return
    const maxDirectories = Math.max(0, Math.floor(options.maxDirectories ?? 32))
    const maxDepth = Math.max(1, Math.floor(options.maxDepth ?? 1))
    const concurrency = Math.max(1, Math.min(8, Math.floor(options.concurrency ?? 2)))
    const queue = items.map((item) => ({ item, depth: 1 }))
    let scheduled = 0

    const worker = async () => {
      while (!this.disposed && scheduled < maxDirectories) {
        const entry = queue.shift()
        if (!entry) return
        const { item, depth } = entry
        if (!this.hasChildren(item) || this.shouldAvoidPrewarm(item) || (item.childrenLoaded && !item.stale)) continue

        scheduled += 1
        const children = await this.getChildren(item)
        if (this.disposed || depth >= maxDepth) continue
        for (const child of children) {
          if (child.isDirectory && this.hasChildren(child) && !this.shouldAvoidPrewarm(child)) queue.push({ item: child, depth: depth + 1 })
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, worker))
  }

  private async loadChildren(item: ExplorerItem, token: CancellationToken, generation: number): Promise<ExplorerItem[]> {
    if (!this.isActive(generation, token)) return item.children
    item.loading = true
    item.error = ""
    this.notifyItemChanged(item)
    const slotAcquired = this.tryAcquireReadSlot() || await this.waitForReadSlot(generation, token)
    if (!slotAcquired || !this.isActive(generation, token)) {
      item.loading = false
      this.notifyItemChanged(item)
      return item.children
    }
    try {
      const entries = this.readDir ? await this.readDir(item.uri) : []
      if (!this.isActive(generation, token)) return item.children
      const children = entries
        .filter((entry) => entry.name && entry.name !== ".DS_Store" && entry.name !== "Thumbs.db")
        .map((entry) => this.toExplorerItem(item, entry))
        .sort(this.compareExplorerItems)
      this.model.setChildren(item, children)
      return children
    } catch (error) {
      if (!this.isActive(generation, token)) return item.children
      item.error = error instanceof Error ? error.message : String(error)
      item.children = []
      item.childrenLoaded = false
      return []
    } finally {
      item.loading = false
      this.notifyItemChanged(item)
      this.releaseReadSlot()
    }
  }

  private notifyItemChanged(item: ExplorerItem): void {
    if (this.disposed) return
    this.onDidChangeItem?.(item)
  }

  private isActive(generation: number, token: CancellationToken): boolean {
    return !this.disposed && generation === this.generation && !token.isCancellationRequested
  }

  private tryAcquireReadSlot(): boolean {
    if (this.disposed) return false
    if (this.activeReadCount >= this.maxConcurrentReads) return false
    this.activeReadCount += 1
    return true
  }

  private waitForReadSlot(generation: number, token: CancellationToken): Promise<boolean> {
    if (!this.isActive(generation, token)) return Promise.resolve(false)
    return new Promise((resolve) => {
      this.queuedReads.push({ generation, token, resolve })
      this.drainReadQueue()
    })
  }

  private releaseReadSlot(): void {
    this.activeReadCount = Math.max(0, this.activeReadCount - 1)
    this.drainReadQueue()
  }

  private drainReadQueue(): void {
    if (this.disposed) {
      const queued = this.queuedReads.splice(0)
      for (const request of queued) request.resolve(false)
      return
    }
    while (this.activeReadCount < this.maxConcurrentReads && this.queuedReads.length > 0) {
      const request = this.queuedReads.shift()
      if (!request) return
      if (!this.isActive(request.generation, request.token)) {
        request.resolve(false)
        continue
      }
      this.activeReadCount += 1
      request.resolve(true)
    }
  }


  private shouldAvoidPrewarm(item: ExplorerItem): boolean {
    return item.isDirectory && this.heavyDirectories.has(item.name) && !item.expanded
  }

  private toExplorerItem(parent: ExplorerItem, entry: ExplorerRawEntry): ExplorerItem {
    const uri = normalizeExplorerUri(entry.path || `${parent.uri}/${entry.name}`)
    const fileStat = normalizeFileStat({
      ...entry,
      resource: uri,
      mtime: entry.mtime ?? entry.mtimeMs,
    }, uri)
    const isDirectory = fileStat.isDirectory
    const existing = this.model.getItem(uri)
    if (existing && existing.parent === parent) {
      const wasDirectory = existing.isDirectory
      existing.name = fileStat.name || entry.name
      existing.isDirectory = isDirectory
      existing.ignored = false
      existing.limited = false
      existing.size = Number(fileStat.size || 0)
      existing.mtime = Number(fileStat.mtime || 0)
      if (!isDirectory) {
        for (const child of existing.children) this.model.deleteSubtree(child)
        existing.children = []
        existing.childrenLoaded = false
        existing.expanded = false
        existing.loading = false
        existing.error = ""
      } else if (!wasDirectory) {
        existing.children = []
        existing.childrenLoaded = false
        existing.expanded = false
        existing.loading = false
        existing.error = ""
      }
      return existing
    }
    return createExplorerItem({
      uri,
      name: fileStat.name || entry.name,
      isDirectory,
      parent,
      ignored: false,
      childrenLoaded: false,
      size: fileStat.size,
      mtime: fileStat.mtime,
    })
  }
}

type QueuedReadSlot = {
  generation: number
  token: CancellationToken
  resolve: (acquired: boolean) => void
}
