import { ExplorerModel } from "../model/ExplorerModel"
import type { ExplorerItem, ExplorerViewState } from "../model/ExplorerModel"
import type { CancellationToken } from "./ExplorerDataSource"

export interface AsyncTreeDataSource {
  hasChildren(item: ExplorerItem): boolean
  getChildren(item: ExplorerItem | null, token?: CancellationToken): Promise<ExplorerItem[]>
}

export interface CodekAsyncDataTreeOptions {
  model: ExplorerModel
  dataSource: AsyncTreeDataSource
  onDidChangeFlatItems?: (items: ExplorerItem[]) => void
}

export class CodekAsyncDataTree {
  readonly model: ExplorerModel
  private dataSource: AsyncTreeDataSource
  private flatItems: ExplorerItem[] = []
  private onDidChangeFlatItems?: (items: ExplorerItem[]) => void
  private suspendPublish = false
  private publishPending = false
  private generation = 0
  private disposed = false
  private expandRequests = new Map<string, {
    item: ExplorerItem
    generation: number
    promise: Promise<void>
  }>()

  constructor(options: CodekAsyncDataTreeOptions) {
    this.model = options.model
    this.dataSource = options.dataSource
    this.onDidChangeFlatItems = options.onDidChangeFlatItems
  }

  async setInput(roots: ExplorerItem[], viewState?: Partial<ExplorerViewState> | null): Promise<void> {
    this.cancelAllRefreshes()
    const generation = this.generation
    const explicitExpandedUris = new Set<string>()
    for (const root of roots) this.collectExpandedUris(root, explicitExpandedUris)
    this.model.setRoots(roots)
    if (viewState) {
      this.model.applyViewState(viewState)
    } else {
      this.model.expandedUris = explicitExpandedUris
      this.model.viewState = {
        expandedUris: [...explicitExpandedUris],
        selectedUri: this.model.selectedUri,
        focusedUri: this.model.focusedUri,
        scrollTop: this.model.viewState.scrollTop,
      }
    }
    this.flatItems = [...roots]
    this.publish()
    this.suspendPublish = true
    const backgroundRestore: ExplorerItem[] = []
    for (const root of roots) {
      if (!this.isActive(generation)) break
      if (!this.shouldRestoreExpanded(root)) continue
      await this.expand(root, generation)
      this.collectCachedRestores(root, backgroundRestore, generation)
    }
    this.suspendPublish = false
    if (this.publishPending) {
      this.publishPending = false
      this.publish()
    }
    for (const item of backgroundRestore) void this.expandRestoredSubtree(item, generation)
  }

  async expand(item: ExplorerItem, generation = this.generation): Promise<void> {
    if (!this.dataSource.hasChildren(item)) return
    if (!this.isActive(generation)) return
    const existing = this.expandRequests.get(item.uri)
    if (existing && existing.generation === generation) return existing.promise
    const promise = this.doExpand(item, generation).finally(() => {
      const current = this.expandRequests.get(item.uri)
      if (current?.promise === promise) this.expandRequests.delete(item.uri)
    })
    this.expandRequests.set(item.uri, { item, generation, promise })
    return promise
  }

  cancelAllRefreshes(): void {
    this.generation += 1
    for (const request of this.expandRequests.values()) request.item.loading = false
    this.expandRequests.clear()
  }

  dispose(): void {
    this.disposed = true
    this.cancelAllRefreshes()
  }

  private async doExpand(item: ExplorerItem, generation: number): Promise<void> {
    if (!this.isActive(generation)) return
    item.expanded = true
    this.model.expandedUris.add(item.uri)
    let children: ExplorerItem[]
    if (item.childrenLoaded && !item.stale) {
      children = item.children
    } else {
      const token = this.createCancellationToken(generation)
      const childrenRequest = this.dataSource.getChildren(item, token)
      this.publish()
      children = await childrenRequest
    }
    if (!this.isActive(generation)) return
    if (!item.childrenLoaded || item.stale || item.children !== children) {
      this.model.setChildren(item, children)
    }
    if (!item.expanded) {
      this.publish()
      return
    }
    this.spliceChildren(item, children)
  }

  collapse(item: ExplorerItem): void {
    const wasExpanded = item.expanded
    item.expanded = false
    this.model.expandedUris.delete(item.uri)
    const index = this.flatItems.indexOf(item)
    if (index < 0) return
    let deleteCount = 0
    for (let cursor = index + 1; cursor < this.flatItems.length; cursor += 1) {
      if (this.isDescendant(this.flatItems[cursor], item)) deleteCount += 1
      else break
    }
    if (deleteCount > 0) {
      this.flatItems.splice(index + 1, deleteCount)
      this.publish()
    } else if (wasExpanded) {
      this.publish()
    }
  }

  refresh(item: ExplorerItem): void {
    if (!item.expanded) {
      item.stale = true
      return
    }
    item.stale = true
    void this.expand(item)
  }

  async reveal(item: ExplorerItem): Promise<void> {
    const chain: ExplorerItem[] = []
    let current = item.parent
    while (current) {
      chain.unshift(current)
      current = current.parent
    }
    for (const parent of chain) {
      if (!this.flatItems.includes(parent)) continue
      if (!parent.expanded || parent.stale || !parent.childrenLoaded) {
        await this.expand(parent)
      }
    }
  }

  getFlatItems(): ExplorerItem[] {
    return this.flatItems
  }

  getViewState(): ExplorerViewState {
    return this.model.getViewState()
  }

  private spliceChildren(parent: ExplorerItem, children: ExplorerItem[]): void {
    const index = this.flatItems.indexOf(parent)
    if (index < 0) return
    let deleteCount = 0
    for (let cursor = index + 1; cursor < this.flatItems.length; cursor += 1) {
      if (this.isDescendant(this.flatItems[cursor], parent)) deleteCount += 1
      else break
    }
    this.flatItems.splice(index + 1, deleteCount, ...children)
    this.publish()
  }

  private isDescendant(item: ExplorerItem, parent: ExplorerItem): boolean {
    let current = item.parent
    while (current) {
      if (current === parent) return true
      current = current.parent
    }
    return false
  }

  private publish(): void {
    if (this.suspendPublish) {
      this.publishPending = true
      return
    }
    this.onDidChangeFlatItems?.(this.flatItems)
  }

  private collectExpandedUris(item: ExplorerItem, output: Set<string>): void {
    if (item.expanded) output.add(item.uri)
    for (const child of item.children) this.collectExpandedUris(child, output)
  }

  private async expandRestoredSubtree(item: ExplorerItem, generation: number): Promise<void> {
    if (!this.isActive(generation) || !this.shouldRestoreExpanded(item)) return
    await this.expand(item, generation)
    if (!this.isActive(generation)) return
    for (const child of item.children) await this.expandRestoredSubtree(child, generation)
  }

  private collectCachedRestores(item: ExplorerItem, backgroundRestore: ExplorerItem[], generation: number): void {
    if (!this.isActive(generation)) return
    for (const child of item.children) {
      if (!this.shouldRestoreExpanded(child)) continue
      if (child.childrenLoaded && !child.stale) {
        void this.expand(child, generation)
        this.collectCachedRestores(child, backgroundRestore, generation)
      } else {
        backgroundRestore.push(child)
      }
    }
  }

  private shouldRestoreExpanded(item: ExplorerItem): boolean {
    return this.model.expandedUris.has(item.uri) || item.expanded
  }

  private isActive(generation: number): boolean {
    return !this.disposed && generation === this.generation
  }

  private createCancellationToken(generation: number): CancellationToken {
    const tree = this
    return {
      get isCancellationRequested() {
        return tree.disposed || tree.generation !== generation
      },
    }
  }
}
