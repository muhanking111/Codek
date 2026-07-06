export interface ExplorerItemInit {
  uri: string
  name: string
  isDirectory: boolean
  parent?: ExplorerItem | null
  children?: ExplorerItem[]
  childrenLoaded?: boolean
  loading?: boolean
  stale?: boolean
  error?: string
  ignored?: boolean
  limited?: boolean
  size?: number
  mtime?: number
  isRoot?: boolean
  expanded?: boolean
  depth?: number
  editable?: ExplorerEditableData | null
}

export interface ExplorerItem {
  id: string
  uri: string
  name: string
  isDirectory: boolean
  parent: ExplorerItem | null
  children: ExplorerItem[]
  childrenLoaded: boolean
  loading: boolean
  stale: boolean
  error: string
  ignored: boolean
  limited: boolean
  size: number
  mtime: number
  isRoot: boolean
  expanded: boolean
  depth: number
  editable: ExplorerEditableData | null
}

export interface ExplorerViewState {
  expandedUris: string[]
  selectedUri: string
  focusedUri: string
  scrollTop: number
}

export interface ExplorerEditableValidation {
  content: string
  severity?: "info" | "warning" | "error"
}

export interface ExplorerEditableData {
  value: string
  placeholder?: string
  kind: "createFile" | "createFolder" | "rename"
  validationMessage?: (value: string) => ExplorerEditableValidation | string | null | undefined
  onFinish?: (value: string, success: boolean) => void | Promise<void>
}

type ExplorerModelEvent = "roots" | "node" | "selection" | "decoration"
type ExplorerModelListener = (item?: ExplorerItem | null) => void

export function normalizeExplorerUri(value: string): string {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "")
}

export function createExplorerItem(init: ExplorerItemInit): ExplorerItem {
  const uri = normalizeExplorerUri(init.uri)
  return {
    id: uri,
    uri,
    name: init.name || basename(uri),
    isDirectory: Boolean(init.isDirectory),
    parent: init.parent || null,
    children: init.children || [],
    childrenLoaded: Boolean(init.childrenLoaded),
    loading: Boolean(init.loading),
    stale: Boolean(init.stale),
    error: init.error || "",
    ignored: Boolean(init.ignored),
    limited: Boolean(init.limited),
    size: Number(init.size || 0),
    mtime: Number(init.mtime || 0),
    isRoot: Boolean(init.isRoot),
    expanded: Boolean(init.expanded),
    depth: Number(init.depth ?? (init.parent ? init.parent.depth + 1 : 0)),
    editable: init.editable || null,
  }
}

export class ExplorerModel {
  roots: ExplorerItem[] = []
  itemsByUri = new Map<string, ExplorerItem>()
  expandedUris = new Set<string>()
  selectedUri = ""
  focusedUri = ""
  viewState: ExplorerViewState = { expandedUris: [], selectedUri: "", focusedUri: "", scrollTop: 0 }

  private listeners = new Map<ExplorerModelEvent, Set<ExplorerModelListener>>()

  on(event: ExplorerModelEvent, listener: ExplorerModelListener): () => void {
    const listeners = this.listeners.get(event) || new Set<ExplorerModelListener>()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return () => {
      listeners.delete(listener)
    }
  }

  setRoots(roots: ExplorerItem[]): void {
    this.roots = roots
    this.itemsByUri.clear()
    for (const root of roots) {
      root.parent = null
      root.isRoot = true
      root.depth = 0
      this.indexSubtree(root)
    }
    this.emit("roots")
  }

  setChildren(parent: ExplorerItem, children: ExplorerItem[]): void {
    const nextUris = new Set(children.map((child) => child.uri))
    for (const child of parent.children) {
      if (!nextUris.has(child.uri)) this.deleteSubtree(child)
    }
    parent.children = children
    parent.childrenLoaded = true
    parent.stale = false
    for (const child of children) {
      child.parent = parent
      child.depth = parent.depth + 1
      this.indexSubtree(child)
    }
    this.emit("node", parent)
  }

  deleteSubtree(item: ExplorerItem): void {
    for (const child of item.children) this.deleteSubtree(child)
    this.itemsByUri.delete(item.uri)
    this.expandedUris.delete(item.uri)
    if (this.selectedUri === item.uri) this.selectedUri = ""
    if (this.focusedUri === item.uri) this.focusedUri = ""
  }

  getItem(uri: string): ExplorerItem | null {
    return this.itemsByUri.get(normalizeExplorerUri(uri)) || null
  }

  setSelected(item: ExplorerItem | null): void {
    this.selectedUri = item?.uri || ""
    this.viewState.selectedUri = this.selectedUri
    this.emit("selection", item)
  }

  setFocused(item: ExplorerItem | null): void {
    this.focusedUri = item?.uri || ""
    this.viewState.focusedUri = this.focusedUri
  }

  setEditable(item: ExplorerItem | null, editable: ExplorerEditableData | null): void {
    if (item) item.editable = editable
    this.emit("node", item)
  }

  renameItem(item: ExplorerItem, nextUri: string, nextName = basename(nextUri)): void {
    const oldUri = item.uri
    const normalizedUri = normalizeExplorerUri(nextUri)
    if (!oldUri || !normalizedUri || oldUri === normalizedUri) return
    this.unindexSubtree(item)
    item.uri = normalizedUri
    item.id = normalizedUri
    item.name = nextName || basename(normalizedUri)
    this.rebaseChildUris(item)
    this.indexSubtree(item)
    this.expandedUris = replaceUriSetPrefix(this.expandedUris, oldUri, normalizedUri)
    if (this.selectedUri) this.selectedUri = replaceUriPrefix(this.selectedUri, oldUri, normalizedUri)
    if (this.focusedUri) this.focusedUri = replaceUriPrefix(this.focusedUri, oldUri, normalizedUri)
    this.viewState = {
      ...this.viewState,
      expandedUris: [...this.expandedUris],
      selectedUri: this.selectedUri,
      focusedUri: this.focusedUri,
    }
    this.emit("node", item.parent || item)
  }

  applyViewState(state: Partial<ExplorerViewState> | null | undefined): void {
    if (!state) {
      this.expandedUris = new Set(this.roots.slice(0, 5).map((root) => root.uri))
      this.selectedUri = ""
      this.focusedUri = ""
      this.viewState = {
        expandedUris: [...this.expandedUris],
        selectedUri: "",
        focusedUri: "",
        scrollTop: 0,
      }
      return
    }

    this.expandedUris = new Set((state.expandedUris || []).map(normalizeExplorerUri).filter(Boolean))
    this.selectedUri = normalizeExplorerUri(state.selectedUri || "")
    this.focusedUri = normalizeExplorerUri(state.focusedUri || "")
    this.viewState = {
      expandedUris: [...this.expandedUris],
      selectedUri: this.selectedUri,
      focusedUri: this.focusedUri,
      scrollTop: Math.max(0, Number(state.scrollTop || 0)),
    }
  }

  getViewState(): ExplorerViewState {
    return {
      expandedUris: [...this.expandedUris],
      selectedUri: this.selectedUri,
      focusedUri: this.focusedUri,
      scrollTop: this.viewState.scrollTop,
    }
  }

  markDecorationsChanged(): void {
    this.emit("decoration")
  }

  private indexSubtree(item: ExplorerItem): void {
    this.itemsByUri.set(item.uri, item)
    for (const child of item.children) {
      child.parent = item
      child.depth = item.depth + 1
      this.indexSubtree(child)
    }
  }

  private unindexSubtree(item: ExplorerItem): void {
    this.itemsByUri.delete(item.uri)
    for (const child of item.children) this.unindexSubtree(child)
  }

  private rebaseChildUris(item: ExplorerItem): void {
    for (const child of item.children) {
      child.parent = item
      child.depth = item.depth + 1
      child.uri = normalizeExplorerUri(`${item.uri}/${child.name}`)
      child.id = child.uri
      this.rebaseChildUris(child)
    }
  }

  private emit(event: ExplorerModelEvent, item?: ExplorerItem | null): void {
    for (const listener of this.listeners.get(event) || []) {
      listener(item)
    }
  }
}

function basename(value: string): string {
  return normalizeExplorerUri(value).split("/").filter(Boolean).pop() || value
}

function replaceUriSetPrefix(values: Set<string>, oldUri: string, nextUri: string): Set<string> {
  const next = new Set<string>()
  for (const value of values) next.add(replaceUriPrefix(value, oldUri, nextUri))
  return next
}

function replaceUriPrefix(value: string, oldUri: string, nextUri: string): string {
  const normalizedValue = normalizeExplorerUri(value)
  const normalizedOld = normalizeExplorerUri(oldUri)
  const normalizedNext = normalizeExplorerUri(nextUri)
  if (normalizedValue === normalizedOld) return normalizedNext
  if (normalizedValue.startsWith(`${normalizedOld}/`)) return `${normalizedNext}${normalizedValue.slice(normalizedOld.length)}`
  return normalizedValue
}
