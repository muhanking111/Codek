import { createExplorerItem, ExplorerModel, normalizeExplorerUri } from "../model/ExplorerModel"
import type { ExplorerEditableData, ExplorerItem, ExplorerViewState } from "../model/ExplorerModel"
import { CodekAsyncDataTree } from "./CodekAsyncDataTree"
import { CodekListView } from "./CodekListView"
import { ExplorerDataSource } from "./ExplorerDataSource"
import type { ExplorerRawEntry } from "./ExplorerDataSource"
import { ExplorerRenderer, explorerRowDomId } from "./ExplorerRenderer"
import type { ExplorerRendererOptions } from "./ExplorerRenderer"
import type { LoadedFileIconTheme } from "../../extensions/iconThemes"
import type { IDisposable } from "../../vscode-adapter/base/common/lifecycle"
import { resolveListNavigationIndex } from "../../vscode-adapter/base/browser/ui/list/listNavigation"
import type { IFileService } from "../../vscode-adapter/platform/files/common/files"
import type { WorkbenchListOwnerSnapshot } from "../../vscode-adapter/platform/list/browser/listService"
import { globalWorkbenchListService } from "../../vscode-adapter/platform/list/browser/listService"
import { createExplorerItemComparator, type ISortOrderConfiguration } from "../../vscode-adapter/workbench/contrib/files/explorerFileSorter"
import { createCodekExplorerServiceFacade, type CodekExplorerServiceFacade } from "../../vscode-adapter/workbench/contrib/files/explorerService"
import { globalWorkbenchExplorerEditorService } from "../../workbench/workbenchExplorerEditorService"

type ExplorerPointerGesture = {
  uri: string
  isDirectory: boolean
  expandedOnPointerDown: boolean
  startX: number
  startY: number
  fallbackTimer: ReturnType<typeof setTimeout> | null
}


export interface ExplorerTreeHostOptions {
  container: HTMLElement
  rowHeight?: number
  readDir?: (uri: string) => Promise<ExplorerRawEntry[]>
  onInlineCreate?: (payload: {
    type: "file" | "folder"
    parentPath: string
    targetSnapshot?: unknown
    name: string
  }) => Promise<unknown> | unknown
  onRenameEntry?: (payload: {
    path: string
    newPath: string
    name: string
  }) => Promise<unknown> | unknown
  onOpenFile?: (path: string) => void
  onSelectDir?: (path: string) => void
  onCommand?: (command: string, path: string) => void
  onMoveEntry?: (path: string, targetDir: string) => void
  onContextMenu?: (event: MouseEvent, item: ExplorerItem | null) => void
  onRowsChanged?: (items: ExplorerItem[]) => void
}

export interface ExplorerTreeHostState {
  activeFile?: string
  selectedPath?: string
  selectedKind?: string
  projectRoot?: string
  workspaceRoots?: string[]
  workspaceRootLabels?: Record<string, string>
  workspaceScaleProfile?: {
    scale?: string
    pending?: boolean
  } | null
  gitDecorations?: Record<string, unknown>
  filterQuery?: string
  iconTheme?: LoadedFileIconTheme | null
  iconThemeId?: string
  iconThemeVersion?: number
  explorerSortOrderConfiguration?: Partial<ISortOrderConfiguration>
}

export interface ExplorerWorkbenchObjectTreeOwnerProjection {
  source: "codek.explorerWorkbenchObjectTreeOwner"
  status: "partial"
  stateSource: "ExplorerTreeHost.model + CodekAsyncDataTree + CodekListView"
  noSecondState: true
  runtimeReferenceToSourceMirror: false
  vscodeSourcePaths: readonly string[]
  currentSourcePaths: readonly string[]
  implementedOwners: readonly string[]
  missingOwners: readonly string[]
  widget: {
    role: string
    ariaLabel: string
    tabIndex: number
    rowCount: number
    renderedRowCount: number
    focusedUri: string
    activeDescendant: string
    isLastFocusedList: boolean
  }
  blockedReason: string
}

export class ExplorerTreeHost {
  readonly model = new ExplorerModel()
  private options: ExplorerTreeHostOptions
  private ownerDocument: Document
  private ownerWindow: Window | null
  private renderer: ExplorerRenderer
  private listView: CodekListView<ExplorerItem>
  private dataSource: ExplorerDataSource
  private tree: CodekAsyncDataTree
  private state: ExplorerTreeHostState = {}
  private viewState: ExplorerViewState | null = null
  private viewStatesByRootKey = new Map<string, ExplorerViewState>()
  private currentRendererOptions: ExplorerRendererOptions = {}
  private dragSourceUri = ""
  private lastNativeRootKey = ""
  private lastFilterQuery = ""
  private updateRevision = 0
  private pointerGesture: ExplorerPointerGesture | null = null
  private localSelectedUri = ""
  private pendingExpansionUris = new Set<string>()
  private editableItem: ExplorerItem | null = null
  private editableIsTemporary = false
  private editableFinishGeneration = 0
  private explorerServiceFacade: CodekExplorerServiceFacade | null = null
  private workbenchServiceBinding: IDisposable | null = null
  private listServiceBinding: IDisposable | null = null

  constructor(options: ExplorerTreeHostOptions) {
    this.options = options
    this.ownerDocument = options.container.ownerDocument || document
    this.ownerWindow = this.ownerDocument.defaultView || (typeof window !== "undefined" ? window : null)
    this.renderer = new ExplorerRenderer()
    this.dataSource = new ExplorerDataSource({
      roots: [],
      model: this.model,
      readDir: async () => [],
      maxConcurrentReads: this.directoryReadConcurrency(),
      sortOrderConfiguration: this.explorerSortOrderConfiguration(),
      onDidChangeItem: (item) => this.refreshChangedItem(item),
    })
    this.tree = new CodekAsyncDataTree({
      model: this.model,
      dataSource: this.dataSource,
      onDidChangeFlatItems: (items) => {
        const visible = this.applyFilter(items)
        this.listView.setItems(visible)
        this.syncActiveDescendant()
        this.options.onRowsChanged?.(visible)
      },
    })
    this.listView = new CodekListView(options.container, {
      ownerId: "objectTreeList",
      widgetKind: "objectTree",
      codekSourcePaths: [
        "frontend/vite-project/src/explorer/tree/CodekListView.ts",
        "frontend/vite-project/src/explorer/tree/ExplorerTreeHost.ts",
      ],
      factoryEvidence: "ExplorerTreeHost creates a reusable WorkbenchObjectTree owner through CodekListView + IListService",
      stateSource: "ExplorerModel.selectedUri/focusedUri + CodekAsyncDataTree flat item model",
      modelBacked: true,
      rowHeight: options.rowHeight || 24,
      overscan: 8,
      role: "tree",
      ariaLabel: "Files Explorer",
      createRow: () => this.renderer.createRow(),
      renderRow: (row, item, index) => this.renderer.renderElement(item, row, index),
    })
    this.listServiceBinding = globalWorkbenchListService.register(this.listView)
    options.container.addEventListener("pointerdown", this.handlePointerDown)
    options.container.addEventListener("pointerup", this.handlePointerUp)
    options.container.addEventListener("pointercancel", this.handlePointerCancel)
    options.container.addEventListener("click", this.handleClick)
    options.container.addEventListener("contextmenu", this.handleContextMenu)
    options.container.addEventListener("keydown", this.handleKeydown)
    options.container.addEventListener("dragstart", this.handleDragStart)
    options.container.addEventListener("dragover", this.handleDragOver)
    options.container.addEventListener("drop", this.handleDrop)
    this.ownerDocument.addEventListener("pointerdown", this.handleDocumentPointerDown, true)
    this.ownerDocument.addEventListener("focusin", this.handleDocumentFocusIn, true)
    this.ownerDocument.addEventListener("visibilitychange", this.handleVisibilityChange)
    this.ownerWindow?.addEventListener("blur", this.handleInteractionReset)
    this.workbenchServiceBinding = globalWorkbenchExplorerEditorService.bindExplorerModel(this.model)
  }

  async update(state: ExplorerTreeHostState): Promise<void> {
    const previousRendererOptions = this.currentRendererOptions
    this.state = { ...this.state, ...state }
    this.reconcileLocalSelection()
    const nextRendererOptions = this.rendererOptions()
    this.currentRendererOptions = nextRendererOptions
    this.renderer.updateOptions(nextRendererOptions)
    this.dataSource.setMaxConcurrentReads(this.directoryReadConcurrency())
    this.dataSource.updateSortOrderConfiguration(this.explorerSortOrderConfiguration())
    const nativeRoots = this.getNativeRootEntries()
    const nativeRootKey = nativeRoots.map((entry) => `${entry.path}\0${entry.name}`).join("\n")
    if (nativeRootKey === this.lastNativeRootKey) {
      this.refreshForStateOnlyUpdate(previousRendererOptions, nextRendererOptions)
      return
    }
    const previousNativeRootKey = this.lastNativeRootKey
    if (previousNativeRootKey) {
      this.viewStatesByRootKey.set(previousNativeRootKey, this.captureCurrentViewState())
    }
    this.localSelectedUri = ""
    this.clearPointerGesture()
    this.pendingExpansionUris.clear()
    this.lastFilterQuery = this.normalizedFilterQuery()
    this.lastNativeRootKey = nativeRootKey
    const updateRevision = this.updateRevision + 1
    this.updateRevision = updateRevision
    const roots = nativeRoots.map((entry) => this.fromNativeRootEntry(entry))
    this.tree.dispose()
    this.dataSource.dispose()
    this.dataSource = new ExplorerDataSource({
      roots,
      model: this.model,
      readDir: this.options.readDir || (async () => []),
      maxConcurrentReads: this.directoryReadConcurrency(),
      sortOrderConfiguration: this.explorerSortOrderConfiguration(),
      onDidChangeItem: (item) => {
        if (updateRevision !== this.updateRevision) return
        this.refreshChangedItem(item)
      },
    })
    this.tree = new CodekAsyncDataTree({
      model: this.model,
      dataSource: this.dataSource,
      onDidChangeFlatItems: (items) => {
        if (updateRevision !== this.updateRevision) return
        const visible = this.applyFilter(items)
        this.listView.setItems(visible)
        this.syncActiveDescendant()
        this.options.onRowsChanged?.(visible)
      },
    })
    const savedViewState = this.viewStatesByRootKey.get(nativeRootKey) || null
    const viewState = this.mergeViewState(roots, savedViewState)
    this.viewState = viewState
    await this.tree.setInput(roots, viewState)
    if (updateRevision !== this.updateRevision) return
    this.listView.scrollTo(viewState.scrollTop || 0)
    void this.prewarmVisibleRoots(roots, updateRevision)
  }

  private getNativeRootEntries(): Array<{ path: string; name: string }> {
    const roots = Array.isArray(this.state.workspaceRoots) && this.state.workspaceRoots.length
      ? this.state.workspaceRoots
      : this.state.projectRoot
        ? [this.state.projectRoot]
        : []
    const labels = this.state.workspaceRootLabels || {}
    return roots
      .map((root) => normalizeExplorerUri(root))
      .filter(Boolean)
      .map((root) => ({
        path: root,
        name: labels[root] || basename(root),
      }))
  }

  private fromNativeRootEntry(entry: { path: string; name: string }): ExplorerItem {
    return createExplorerItem({
      uri: entry.path,
      name: entry.name,
      isDirectory: true,
      isRoot: true,
      childrenLoaded: false,
      expanded: true,
    })
  }

  async expandPath(path: string): Promise<boolean> {
    const target = this.resolveTargetUri(path)
    const item = this.model.getItem(target)
    if (!item) return false
    await this.tree.expand(item)
    return true
  }

  collapsePath(path: string): boolean {
    const target = this.resolveTargetUri(path)
    const item = this.model.getItem(target)
    if (!item) return false
    this.tree.collapse(item)
    return true
  }

  async startCreate(type: "file" | "folder", parentPath = "", targetSnapshot?: unknown): Promise<boolean> {
    const targetParentUri = this.resolveTargetUri(parentPath || this.state.selectedPath || this.state.projectRoot || "")
    const parent = await this.resolveEditableParent(targetParentUri)
    if (!parent?.childrenLoaded) return false
    this.clearEditable(false)
    const uri = this.createTemporaryEditableUri(parent, type)
    const item = createExplorerItem({
      uri,
      name: type === "folder" ? "New Folder" : "New File",
      isDirectory: type === "folder",
      parent,
      childrenLoaded: type !== "folder",
      editable: {
        value: "",
        kind: type === "folder" ? "createFolder" : "createFile",
        placeholder: type === "folder" ? "文件夹名" : "文件名，例如 index.html",
        validationMessage: (value) => {
          if (!String(value || "").trim()) return null
          return null
        },
        onFinish: async (value, success) => {
          const generation = this.editableFinishGeneration + 1
          this.editableFinishGeneration = generation
          const trimmed = String(value || "").trim()
          if (!success || !trimmed) {
            this.cancelEditable(false)
            return
          }
          try {
            await this.options.onInlineCreate?.({
              type,
              parentPath: parent.uri,
              targetSnapshot,
              name: trimmed,
            })
          } catch {
            if (this.editableItem === item && this.editableFinishGeneration === generation) {
              item.editable = {
                ...item.editable!,
                value: trimmed,
              }
              this.refreshChangedItem(item)
            }
            return
          }
          if (this.editableItem === item && this.editableFinishGeneration === generation) this.cancelEditable(false)
        },
      },
    })
    await this.setEditable(item, item.editable, { temporary: true, reveal: false })
    this.model.setChildren(parent, [...parent.children, item].sort(this.compareExplorerItems()))
    if (parent.expanded) this.replaceVisibleChildren(parent)
    else await this.tree.expand(parent)
    const index = this.listView.getItems().findIndex((candidate) => candidate === item)
    if (index >= 0) this.listView.revealIndex(index)
    this.refreshChangedItem(item)
    return true
  }

  async startRename(path = ""): Promise<boolean> {
    const target = this.resolveTargetUri(path || this.state.selectedPath || "")
    const item = target ? this.model.getItem(target) : null
    if (!item || item.isRoot || !item.parent) return false
    const parent = item.parent
    const originalUri = item.uri
    const originalName = item.name
    const editable: ExplorerEditableData = {
      value: originalName,
      kind: "rename",
      placeholder: originalName,
      validationMessage: (value) => this.validateRenameValue(item, value),
      onFinish: async (value, success) => {
        const generation = this.editableFinishGeneration + 1
        this.editableFinishGeneration = generation
        const trimmed = String(value || "").trim()
        if (!success || !trimmed || trimmed === originalName) {
          this.clearEditable(false)
          return
        }
        const validation = this.validateRenameValue(item, trimmed)
        if (validation?.severity === "error") {
          this.keepEditableValue(item, trimmed, generation)
          return
        }
        const newPath = `${parent.uri}/${trimmed}`
        try {
          await this.options.onRenameEntry?.({ path: originalUri, newPath, name: trimmed })
        } catch {
          this.keepEditableValue(item, trimmed, generation)
          return
        }
        if (this.editableItem !== item || this.editableFinishGeneration !== generation) return
        item.editable = null
        this.editableItem = null
        this.editableIsTemporary = false
        this.editableFinishGeneration += 1
        this.model.renameItem(item, newPath, trimmed)
        this.model.setChildren(parent, [...parent.children].sort(this.compareExplorerItems()))
        if (parent.expanded) this.replaceVisibleChildren(parent)
        await this.revealAndSelectItem(item)
      },
    }
    await this.setEditable(item, editable, { temporary: false, reveal: true })
    return true
  }

  cancelCreate(): void {
    this.clearEditable(true)
  }

  async setEditable(
    item: ExplorerItem,
    editable: ExplorerEditableData | null,
    options: { temporary?: boolean; reveal?: boolean } = {},
  ): Promise<void> {
    if (editable) {
      this.clearEditable(false)
      this.editableItem = item
      this.editableIsTemporary = Boolean(options.temporary)
      this.model.setEditable(item, editable)
      if (item.parent) await this.tree.expand(item.parent)
      if (options.reveal !== false) await this.revealAndSelectItem(item, false)
      this.refreshChangedItem(item)
      return
    }
    if (this.editableItem === item) this.clearEditable(false)
  }

  isEditable(item?: ExplorerItem | null): boolean {
    if (!this.editableItem) return false
    return item ? this.editableItem === item : true
  }

  getEditableData(item?: ExplorerItem | null): ExplorerEditableData | null {
    if (!this.editableItem || (item && this.editableItem !== item)) return null
    return this.editableItem.editable || null
  }

  clearEditable(focusTree = false): void {
    this.cancelEditable(focusTree)
  }

  async revealPath(path: string): Promise<boolean> {
    const target = this.resolveTargetUri(path)
    const item = this.model.getItem(target)
    if (!item) return false
    await this.tree.reveal(item)
    const index = this.tree.getFlatItems().indexOf(item)
    if (index >= 0) this.listView.scrollTo(Math.max(0, (index - 3) * (this.options.rowHeight || 24)))
    return index >= 0
  }

  getRenderedRowCount(): number {
    return this.listView.getRenderedRowCount()
  }

  getFlatItems(): ExplorerItem[] {
    return this.tree.getFlatItems()
  }

  getScrollTop(): number {
    return this.listView.getScrollTop()
  }

  getListOwnerSnapshot(): WorkbenchListOwnerSnapshot {
    return this.listView.getOwnerSnapshot()
  }

  getWorkbenchObjectTreeOwnerProjection(): ExplorerWorkbenchObjectTreeOwnerProjection {
    const focused = this.focusedKeyboardItem()
    const widget = this.listView.getHTMLElement()
    return {
      source: "codek.explorerWorkbenchObjectTreeOwner",
      status: "partial",
      stateSource: "ExplorerTreeHost.model + CodekAsyncDataTree + CodekListView",
      noSecondState: true,
      runtimeReferenceToSourceMirror: false,
      vscodeSourcePaths: [
        "src/vs/platform/list/browser/listService.ts",
        "src/vs/base/browser/ui/list/listWidget.ts",
        "src/vs/base/browser/ui/tree/objectTree.ts",
        "src/vs/base/browser/ui/tree/asyncDataTree.ts",
      ],
      currentSourcePaths: [
        "frontend/vite-project/src/vscode-adapter/platform/list/browser/listService.ts",
        "frontend/vite-project/src/explorer/tree/CodekListView.ts",
        "frontend/vite-project/src/explorer/tree/ExplorerTreeHost.ts",
      ],
      implementedOwners: [
        "IListService lastFocusedList registry",
        "WorkbenchListWidget getHTMLElement/onDidFocus/onDidDispose contract",
        "CodekListView virtualized row lifecycle",
        "ExplorerTreeHost keyboard navigation and aria-activedescendant projection",
      ],
      missingOwners: [
        "full VS Code WorkbenchObjectTree class inheritance",
        "scoped context key service for listFocus/listHasSelectionOrFocus",
        "configuration-backed list style and type navigation settings",
        "generic ObjectTree factory for TestingObjectTree/SettingsTree",
      ],
      widget: {
        role: widget.getAttribute("role") || "",
        ariaLabel: widget.getAttribute("aria-label") || "",
        tabIndex: widget.tabIndex,
        rowCount: this.listView.getItems().length,
        renderedRowCount: this.listView.getRenderedRowCount(),
        focusedUri: focused?.uri || "",
        activeDescendant: widget.getAttribute("aria-activedescendant") || "",
        isLastFocusedList: globalWorkbenchListService.lastFocusedList === this.listView,
      },
      blockedReason: "Explorer now registers its real CodekListView with a reusable IListService-style owner. Full WorkbenchObjectTree parity still needs a generic ObjectTree factory and scoped context-key/style owners before TestingObjectTree or SettingsTree can claim the same runtime owner.",
    }
  }

  refreshVisibleRows(): void {
    const visible = this.applyFilter(this.tree.getFlatItems())
    if (this.listView.getItems() !== visible) this.listView.setItems(visible)
    else this.listView.render(true)
  }

  async refresh(): Promise<void> {
    const expandedUris = this.collectCurrentExpandedUris()
    for (const root of this.model.roots) await this.refreshExpandedSubtree(root, expandedUris)
  }

  bindFileService(fileService: Pick<IFileService, "onDidRunOperation" | "onDidFilesChange"> | null | undefined): IDisposable {
    this.explorerServiceFacade?.dispose()
    this.explorerServiceFacade = null
    if (!fileService) return { dispose() {} }
    const facade = createCodekExplorerServiceFacade({
      fileService,
      host: {
        isEditable: () => this.isEditable(),
        hasKnownPath: (path) => Boolean(this.model.getItem(this.resolveTargetUri(path))),
        hasLoadedParentForPath: (path) => Boolean(this.findLoadedParentForTarget(this.resolveTargetUri(path))),
        applyFileOperationAsync: (payload) => this.applyFileOperationAsync(payload),
        refresh: () => this.refresh(),
      },
      normalizePath: (path) => this.normalizeFileServiceEventPath(path),
    })
    this.explorerServiceFacade = facade
    return {
      dispose: () => {
        if (this.explorerServiceFacade === facade) this.explorerServiceFacade = null
        facade.dispose()
      },
    }
  }

  async flushFileServiceChanges(): Promise<boolean> {
    return Boolean(await this.explorerServiceFacade?.flushPendingFileChanges())
  }

  applyFileOperation(payload: {
    action?: unknown
    type?: unknown
    path?: unknown
    pathBefore?: unknown
    pathAfter?: unknown
  }): boolean {
    const action = String(payload.action || "")
    const type = String(payload.type || "")
    if (this.isCreateOrCopyOperation(action, type)) {
      return this.upsertKnownPath(String(payload.pathAfter || payload.path || ""), type === "create_folder")
    }
    if (action === "delete" || type === "delete_file") {
      return this.removeKnownPath(String(payload.pathBefore || payload.path || ""))
    }
    if (action === "rename" || type === "rename_move") {
      return this.renameOrMoveKnownPath(
        String(payload.pathBefore || ""),
        String(payload.pathAfter || payload.path || ""),
      )
    }
    return false
  }

  async applyFileOperationAsync(payload: {
    action?: unknown
    type?: unknown
    path?: unknown
    pathBefore?: unknown
    pathAfter?: unknown
  }): Promise<boolean> {
    if (this.applyFileOperation(payload)) return true
    const action = String(payload.action || "")
    const type = String(payload.type || "")
    if (this.isCreateOrCopyOperation(action, type)) {
      return this.upsertKnownPathAfterReveal(String(payload.pathAfter || payload.path || ""), type === "create_folder")
    }
    if (action === "rename" || type === "rename_move") {
      const applied = this.renameOrMoveKnownPath(
        String(payload.pathBefore || ""),
        String(payload.pathAfter || payload.path || ""),
      )
      if (applied) return true
      const beforeApplied = this.removeKnownPath(String(payload.pathBefore || ""))
      const afterApplied = await this.upsertKnownPathAfterReveal(String(payload.pathAfter || payload.path || ""), false)
      if (afterApplied) await this.revealPath(String(payload.pathAfter || payload.path || ""))
      return beforeApplied || afterApplied
    }
    return false
  }

  dispose(): void {
    this.updateRevision += 1
    this.pendingExpansionUris.clear()
    this.cancelEditable(false)
    this.clearPointerGesture()
    this.workbenchServiceBinding?.dispose()
    this.workbenchServiceBinding = null
    this.listServiceBinding?.dispose()
    this.listServiceBinding = null
    this.explorerServiceFacade?.dispose()
    this.explorerServiceFacade = null
    this.tree.dispose()
    this.dataSource.dispose()
    this.options.container.removeEventListener("pointerdown", this.handlePointerDown)
    this.options.container.removeEventListener("pointerup", this.handlePointerUp)
    this.options.container.removeEventListener("pointercancel", this.handlePointerCancel)
    this.options.container.removeEventListener("click", this.handleClick)
    this.options.container.removeEventListener("contextmenu", this.handleContextMenu)
    this.options.container.removeEventListener("keydown", this.handleKeydown)
    this.options.container.removeEventListener("dragstart", this.handleDragStart)
    this.options.container.removeEventListener("dragover", this.handleDragOver)
    this.options.container.removeEventListener("drop", this.handleDrop)
    this.ownerDocument.removeEventListener("pointerdown", this.handleDocumentPointerDown, true)
    this.ownerDocument.removeEventListener("focusin", this.handleDocumentFocusIn, true)
    this.ownerDocument.removeEventListener("visibilitychange", this.handleVisibilityChange)
    this.ownerWindow?.removeEventListener("blur", this.handleInteractionReset)
    this.listView.dispose()
  }

  private applyFilter(items: ExplorerItem[]): ExplorerItem[] {
    const query = this.normalizedFilterQuery()
    if (!query) return items
    return items.filter((item) => item.editable || item.name.toLowerCase().includes(query) || item.uri.toLowerCase().includes(query))
  }

  private rendererOptions(): ExplorerRendererOptions {
    return this.rendererOptionsForState(this.state)
  }

  private rendererOptionsForState(state: ExplorerTreeHostState): ExplorerRendererOptions {
    return {
      activeUri: this.resolveTargetUriForState(state, state.activeFile || ""),
      selectedUri: this.localSelectedUri || this.resolveTargetUriForState(state, state.selectedPath || ""),
      decorations: state.gitDecorations as Record<string, string>,
      iconTheme: state.iconTheme || null,
      iconThemeId: String(state.iconThemeId || state.iconTheme?.themeId || ""),
      iconThemeVersion: Number(state.iconThemeVersion || 0),
    }
  }

  private refreshForStateOnlyUpdate(
    previousOptions: ExplorerRendererOptions,
    nextOptions: ExplorerRendererOptions,
  ): void {
    const nextFilterQuery = this.normalizedFilterQuery()
    if (nextFilterQuery !== this.lastFilterQuery) {
      this.lastFilterQuery = nextFilterQuery
      this.refreshVisibleRows()
      return
    }

    const affectedUris = new Set([
      previousOptions.activeUri,
      previousOptions.selectedUri,
      nextOptions.activeUri,
      nextOptions.selectedUri,
    ].filter(Boolean) as string[])

    const decorationChanged = this.decorationsChanged(previousOptions, nextOptions)
    if (
      previousOptions.iconTheme !== nextOptions.iconTheme
      || previousOptions.iconThemeId !== nextOptions.iconThemeId
      || previousOptions.iconThemeVersion !== nextOptions.iconThemeVersion
    ) {
      this.listView.render(true)
      return
    }
    if (decorationChanged) {
      const visibleHasAffectedDecoration = this.listView.hasVisibleItem((item) => this.hasDecorationChange(item, previousOptions, nextOptions))
      if (visibleHasAffectedDecoration) this.listView.render(true)
      else if (affectedUris.size > 0) this.listView.renderVisibleItems((item) => affectedUris.has(item.uri))
      return
    }

    if (affectedUris.size === 0) return
    this.listView.renderVisibleItems((item) => affectedUris.has(item.uri))
    this.syncActiveDescendant()
  }

  private refreshChangedItem(item: ExplorerItem): void {
    if (!item?.uri) return
    const patched = this.listView.renderVisibleItems((visibleItem) => visibleItem.uri === item.uri)
    if (patched === 0 && this.listView.hasVisibleItem((visibleItem) => visibleItem.uri === item.uri)) {
      this.listView.render(true)
    }
  }

  private reconcileLocalSelection(): void {
    if (!this.localSelectedUri) return
    const roots = this.getNativeRootEntries().map((entry) => entry.path)
    if (roots.length > 0 && !this.isUriWithinRoots(this.localSelectedUri, roots)) {
      this.localSelectedUri = ""
      return
    }
    const selectedFromState = this.resolveTargetUriForState(this.state, this.state.selectedPath || "")
    if (selectedFromState === this.localSelectedUri) this.localSelectedUri = ""
  }

  private decorationsChanged(previousOptions: ExplorerRendererOptions, nextOptions: ExplorerRendererOptions): boolean {
    return previousOptions.decorations !== nextOptions.decorations
  }

  private hasDecorationChange(
    item: ExplorerItem,
    previousOptions: ExplorerRendererOptions,
    nextOptions: ExplorerRendererOptions,
  ): boolean {
    return decorationValue(previousOptions.decorations, item.uri) !== decorationValue(nextOptions.decorations, item.uri)
  }

  private mergeViewState(
    roots: ExplorerItem[],
    current: ExplorerViewState | null,
  ): ExplorerViewState {
    const rootUris = roots.map((root) => root.uri).filter(Boolean)
    const expandedUris = new Set<string>()
    if (this.shouldRestoreSavedExpandedState()) {
      for (const uri of current?.expandedUris || []) {
        const normalized = normalizeExplorerUri(uri)
        if (this.isUriWithinRoots(normalized, rootUris)) expandedUris.add(normalized)
      }
    }
    for (const root of roots) expandedUris.add(root.uri)
    const selectedFromState = this.resolveTargetUri(this.state.selectedPath || "")
    const selectedFromSaved = normalizeExplorerUri(current?.selectedUri || "")
    const focusedFromSaved = normalizeExplorerUri(current?.focusedUri || "")
    return {
      expandedUris: [...expandedUris],
      selectedUri: this.filterUriForRoots(selectedFromState || selectedFromSaved, rootUris),
      focusedUri: this.filterUriForRoots(focusedFromSaved, rootUris),
      scrollTop: Math.max(0, Number(current?.scrollTop || 0)),
    }
  }

  private captureCurrentViewState(): ExplorerViewState {
    const viewState = this.tree.getViewState()
    return {
      expandedUris: viewState.expandedUris,
      selectedUri: viewState.selectedUri,
      focusedUri: viewState.focusedUri,
      scrollTop: this.listView.getScrollTop(),
    }
  }

  private filterUriForRoots(uri: string, roots: string[]): string {
    const normalized = normalizeExplorerUri(uri)
    return this.isUriWithinRoots(normalized, roots) ? normalized : ""
  }

  private isUriWithinRoots(uri: string, roots: string[]): boolean {
    if (!uri) return false
    const comparableUri = normalizeExplorerUri(uri).toLowerCase()
    return roots.some((root) => {
      const comparableRoot = normalizeExplorerUri(root).toLowerCase()
      return comparableUri === comparableRoot || comparableUri.startsWith(`${comparableRoot}/`)
    })
  }

  private resolveTargetUri(path: string): string {
    return this.resolveTargetUriForState(this.state, path)
  }

  private upsertKnownPath(path: string, isDirectoryHint = false): boolean {
    const target = this.resolveTargetUri(path)
    return this.upsertResolvedTarget(target, isDirectoryHint)
  }

  private async upsertKnownPathAfterReveal(path: string, isDirectoryHint = false): Promise<boolean> {
    const target = this.resolveTargetUri(path)
    if (!target || this.model.getItem(target)) return false
    await this.expandParentChainForTarget(target)
    return this.upsertResolvedTarget(target, isDirectoryHint)
  }

  private upsertResolvedTarget(target: string, isDirectoryHint = false): boolean {
    if (!target || this.model.getItem(target)) return false
    const parent = this.findLoadedParentForTarget(target)
    if (!parent?.childrenLoaded) return false
    const name = target.split("/").filter(Boolean).pop() || target
    const child = createExplorerItem({
      uri: target,
      name,
      isDirectory: isDirectoryHint,
      parent,
      childrenLoaded: isDirectoryHint ? false : true,
      children: [],
    })
    this.model.setChildren(parent, [...parent.children, child].sort(this.compareExplorerItems()))
    if (parent.expanded) this.replaceVisibleChildren(parent)
    this.revealAndSelectVisibleItem(child)
    return true
  }

  private async expandParentChainForTarget(target: string): Promise<boolean> {
    const parentUris = this.getParentChainUris(target)
    let lastParent: ExplorerItem | null = null
    for (const parentUri of parentUris) {
      const parent = this.model.getItem(parentUri)
      if (!parent) return false
      if (!parent.isDirectory) return false
      await this.tree.expand(parent)
      lastParent = parent
    }
    return Boolean(lastParent?.childrenLoaded)
  }

  private getParentChainUris(target: string): string[] {
    const rootUris = this.model.roots.map((root) => root.uri).sort((left, right) => right.length - left.length)
    const root = rootUris.find((uri) => target === uri || target.startsWith(`${uri}/`))
    if (!root || target === root) return []
    const relative = target.slice(root.length + 1).split("/").filter(Boolean)
    relative.pop()
    const parents: string[] = [root]
    let current = root
    for (const segment of relative) {
      current = `${current}/${segment}`
      parents.push(current)
    }
    return parents
  }

  private removeKnownPath(path: string): boolean {
    const target = this.resolveTargetUri(path)
    const item = target ? this.model.getItem(target) : null
    const parent = item?.parent
    if (!item || !parent?.childrenLoaded) return false
    const previousVisibleItems = this.listView.getItems()
    const previousVisibleIndex = previousVisibleItems.indexOf(item)
    this.model.deleteSubtree(item)
    this.model.setChildren(parent, parent.children.filter((child) => child !== item))
    if (parent.expanded) this.replaceVisibleChildren(parent)
    this.focusAfterRemovedVisibleItem(previousVisibleIndex)
    return true
  }

  private renameOrMoveKnownPath(pathBefore: string, pathAfter: string): boolean {
    const before = this.resolveTargetUri(pathBefore)
    const after = this.resolveTargetUri(pathAfter)
    if (!before || !after || before === after) return false
    const item = this.model.getItem(before)
    if (!item) return false
    const oldParent = item.parent
    const newParent = this.findLoadedParentForTarget(after)
    if (!oldParent?.childrenLoaded || !newParent?.childrenLoaded) return false
    const wasExpanded = item.expanded || this.model.expandedUris.has(item.uri)
    const wasSelected = this.model.selectedUri === item.uri || this.model.selectedUri.startsWith(`${item.uri}/`)
    const wasFocused = this.model.focusedUri === item.uri || this.model.focusedUri.startsWith(`${item.uri}/`)
    if (oldParent === newParent) {
      this.model.renameItem(item, after, basename(after))
      this.restoreMovedItemViewState(item, wasExpanded, wasSelected, wasFocused)
      this.model.setChildren(oldParent, [...oldParent.children].sort(this.compareExplorerItems()))
      if (oldParent.expanded) this.replaceVisibleChildren(oldParent)
      this.revealAndSelectVisibleItem(this.getMovedRevealItem(item))
      return true
    }
    this.detachKnownItemForMove(item, oldParent)
    if (oldParent.expanded) this.replaceVisibleChildren(oldParent)
    item.parent = newParent
    this.model.renameItem(item, after, basename(after))
    this.restoreMovedItemViewState(item, wasExpanded, wasSelected, wasFocused)
    this.model.setChildren(newParent, [...newParent.children, item].sort(this.compareExplorerItems()))
    if (newParent.expanded) this.replaceVisibleChildren(newParent)
    this.revealAndSelectVisibleItem(this.getMovedRevealItem(item))
    return true
  }

  private detachKnownItemForMove(item: ExplorerItem, oldParent: ExplorerItem): void {
    this.unindexMovedSubtree(item)
    oldParent.children = oldParent.children.filter((child) => child !== item)
  }

  private unindexMovedSubtree(item: ExplorerItem): void {
    this.model.itemsByUri.delete(item.uri)
    this.model.expandedUris.delete(item.uri)
    for (const child of item.children) this.unindexMovedSubtree(child)
  }

  private restoreMovedItemViewState(
    item: ExplorerItem,
    wasExpanded: boolean,
    wasSelected: boolean,
    wasFocused: boolean,
  ): void {
    if (wasExpanded && item.isDirectory) {
      item.expanded = true
      this.model.expandedUris.add(item.uri)
    }
    if (wasSelected && !this.model.selectedUri.startsWith(`${item.uri}/`)) this.model.setSelected(item)
    if (wasFocused && !this.model.focusedUri.startsWith(`${item.uri}/`)) this.model.setFocused(item)
  }

  private getMovedRevealItem(item: ExplorerItem): ExplorerItem {
    const selected = this.model.selectedUri ? this.model.getItem(this.model.selectedUri) : null
    if (selected && (selected === item || this.isDescendantOf(selected, item))) return selected
    const focused = this.model.focusedUri ? this.model.getItem(this.model.focusedUri) : null
    if (focused && (focused === item || this.isDescendantOf(focused, item))) return focused
    return item
  }

  private isCreateOrCopyOperation(action: string, type: string): boolean {
    return action === "create" ||
      action === "copy" ||
      type === "create_file" ||
      type === "create_folder" ||
      type === "copy_file" ||
      type === "copy_folder"
  }

  private async resolveEditableParent(targetParentUri: string): Promise<ExplorerItem | null> {
    const candidate = this.model.getItem(targetParentUri)
    if (candidate?.isDirectory) {
      await this.tree.expand(candidate)
      return candidate
    }
    const parentUri = targetParentUri.replace(/\/[^/]+$/, "")
    const parent = parentUri ? this.model.getItem(parentUri) : null
    if (parent?.isDirectory) {
      await this.tree.expand(parent)
      return parent
    }
    const root = this.model.roots[0] || null
    if (root) await this.tree.expand(root)
    return root
  }

  private cancelEditable(focusTree: boolean): void {
    const item = this.editableItem
    const temporary = this.editableIsTemporary
    this.editableItem = null
    this.editableIsTemporary = false
    this.editableFinishGeneration += 1
    if (!item) return
    const parent = item.parent
    item.editable = null
    if (temporary && parent?.childrenLoaded) {
      this.model.deleteSubtree(item)
      this.model.setChildren(parent, parent.children.filter((child) => child !== item))
      if (parent.expanded) this.replaceVisibleChildren(parent)
    } else {
      this.refreshVisibleRows()
    }
    if (focusTree) this.options.container.focus({ preventScroll: true })
  }

  private createTemporaryEditableUri(parent: ExplorerItem, type: "file" | "folder"): string {
    let index = 0
    let uri = ""
    do {
      index += 1
      uri = `${parent.uri}/__codek_new_${type}_${index}__`
    } while (this.model.getItem(uri))
    return uri
  }

  private keepEditableValue(item: ExplorerItem, value: string, generation: number): void {
    if (this.editableItem !== item || this.editableFinishGeneration !== generation || !item.editable) return
    item.editable = {
      ...item.editable,
      value,
    }
    this.refreshChangedItem(item)
  }

  private validateRenameValue(item: ExplorerItem, value: string): { content: string; severity: "error" } | null {
    const trimmed = String(value || "").trim()
    if (!trimmed) return { content: "A file or folder name must be provided.", severity: "error" }
    if (/[<>:\"|?*]/.test(trimmed) || trimmed.includes("/") || trimmed.includes("\\")) {
      return { content: "The name is not valid.", severity: "error" }
    }
    if (trimmed === "." || trimmed === "..") return { content: "The name is not valid.", severity: "error" }
    if (trimmed === item.name) return null
    const parent = item.parent
    const duplicate = parent?.children.some((child) => child !== item && child.name.toLowerCase() === trimmed.toLowerCase())
    return duplicate ? { content: "A file or folder with this name already exists.", severity: "error" } : null
  }

  private async revealAndSelectItem(item: ExplorerItem, updateRenderer = true): Promise<void> {
    await this.tree.reveal(item)
    const index = this.tree.getFlatItems().indexOf(item)
    if (index >= 0) this.listView.revealIndex(index)
    this.model.setSelected(item)
    this.model.setFocused(item)
    this.localSelectedUri = item.uri
    this.currentRendererOptions = {
      ...this.currentRendererOptions,
      selectedUri: item.uri,
      focusedUri: item.uri,
    }
    if (updateRenderer) {
      this.renderer.updateOptions(this.currentRendererOptions)
      this.refreshChangedItem(item)
    }
  }

  private revealAndSelectVisibleItem(item: ExplorerItem): void {
    const index = this.listView.getItems().indexOf(item)
    if (index >= 0) this.listView.revealIndex(index)
    this.model.setSelected(item)
    this.model.setFocused(item)
    this.localSelectedUri = item.uri
    this.currentRendererOptions = {
      ...this.currentRendererOptions,
      selectedUri: item.uri,
      focusedUri: item.uri,
    }
    this.renderer.updateOptions(this.currentRendererOptions)
    this.refreshChangedItem(item)
  }

  private focusAfterRemovedVisibleItem(previousVisibleIndex: number): void {
    if (previousVisibleIndex < 0) return
    const visibleItems = this.listView.getItems()
    const nextItem = visibleItems[Math.min(previousVisibleIndex, visibleItems.length - 1)] ||
      visibleItems[Math.max(0, previousVisibleIndex - 1)] ||
      null
    if (nextItem) this.revealAndSelectVisibleItem(nextItem)
    else {
      this.model.setSelected(null)
      this.model.setFocused(null)
      this.localSelectedUri = ""
      this.currentRendererOptions = {
        ...this.currentRendererOptions,
        selectedUri: "",
        focusedUri: "",
      }
      this.renderer.updateOptions(this.currentRendererOptions)
      this.refreshVisibleRows()
      this.syncActiveDescendant()
    }
  }

  private findLoadedParentForTarget(target: string): ExplorerItem | null {
    const parentUri = target.replace(/\/[^/]+$/, "")
    if (!parentUri || parentUri === target) return null
    const parent = this.model.getItem(parentUri)
    return parent?.childrenLoaded ? parent : null
  }

  private replaceVisibleChildren(parent: ExplorerItem): void {
    const flatItems = this.tree.getFlatItems()
    const index = flatItems.indexOf(parent)
    if (index < 0) return
    let deleteCount = 0
    for (let cursor = index + 1; cursor < flatItems.length; cursor += 1) {
      if (this.isDescendantOf(flatItems[cursor], parent)) deleteCount += 1
      else break
    }
    flatItems.splice(index + 1, deleteCount, ...this.getVisibleChildrenForFlatList(parent))
    this.refreshVisibleRows()
  }

  private getVisibleChildrenForFlatList(parent: ExplorerItem): ExplorerItem[] {
    const result: ExplorerItem[] = []
    for (const child of parent.children) {
      result.push(child)
      if (child.expanded && child.childrenLoaded) result.push(...this.getVisibleChildrenForFlatList(child))
    }
    return result
  }

  private isDescendantOf(item: ExplorerItem, parent: ExplorerItem): boolean {
    let current = item.parent
    while (current) {
      if (current === parent) return true
      current = current.parent
    }
    return false
  }

  private collectCurrentExpandedUris(): Set<string> {
    const expandedUris = new Set(this.model.expandedUris)
    for (const item of this.tree.getFlatItems()) {
      if (item.expanded) expandedUris.add(item.uri)
    }
    for (const root of this.model.roots) {
      if (root.expanded || root.isRoot) expandedUris.add(root.uri)
      this.collectExpandedUrisFromItem(root, expandedUris)
    }
    return expandedUris
  }

  private collectExpandedUrisFromItem(item: ExplorerItem, expandedUris: Set<string>): void {
    if (item.expanded) expandedUris.add(item.uri)
    for (const child of item.children) this.collectExpandedUrisFromItem(child, expandedUris)
  }

  private resolveTargetUriForState(state: ExplorerTreeHostState, path: string): string {
    const normalized = normalizeExplorerUri(path)
    if (!normalized) return ""
    if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")) return normalized
    const root = normalizeExplorerUri(state.projectRoot || "")
    return root ? `${root}/${normalized}` : normalized
  }

  private normalizeFileServiceEventPath(path: string): string {
    const normalizedPath = normalizeExplorerUri(path)
    const root = normalizeExplorerUri(this.state.projectRoot || "")
    if (!root) return normalizedPath
    if (normalizedPath.toLowerCase() === root.toLowerCase()) return root
    if (normalizedPath.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
      return normalizedPath.slice(root.length + 1)
    }
    return normalizedPath
  }

  private normalizedFilterQuery(): string {
    return String(this.state.filterQuery || "").trim().toLowerCase()
  }

  private itemFromEvent(event: Event): ExplorerItem | null {
    const target = event.target as HTMLElement | null
    const row = target?.closest?.("[data-uri]") as HTMLElement | null
    if (!row?.dataset.uri) return null
    return this.model.getItem(row.dataset.uri)
  }

  private commitDirectoryExpansion(item: ExplorerItem): Promise<void> {
    this.pendingExpansionUris.add(item.uri)
    const expandRequest = this.tree.expand(item).finally(() => {
      this.pendingExpansionUris.delete(item.uri)
    })
    this.commitSelection(item)
    return expandRequest
  }

  private handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    this.clearPointerGesture()
    const item = this.itemFromEvent(event)
    if (!item) return
    const gesture: ExplorerPointerGesture = {
      uri: item.uri,
      isDirectory: item.isDirectory,
      expandedOnPointerDown: false,
      startX: Number(event.clientX || 0),
      startY: Number(event.clientY || 0),
      fallbackTimer: null,
    }
    this.pointerGesture = gesture
    if (!item.isDirectory || item.expanded || item.loading) return
    gesture.expandedOnPointerDown = true
    void this.commitDirectoryExpansion(item)
  }

  private handlePointerUp = (event: PointerEvent) => {
    if (event.button !== 0) return
    const gesture = this.pointerGesture
    if (!gesture) return
    const item = this.itemFromEvent(event)
    if (!item || item.uri !== gesture.uri || this.pointerMoved(gesture, event)) {
      this.clearPointerGesture()
      return
    }
    this.schedulePointerFallback(gesture)
  }

  private handlePointerCancel = () => {
    this.clearPointerGesture()
  }

  private handleDocumentPointerDown = (event: PointerEvent) => {
    if (this.options.container.contains(event.target as Node | null)) return
    this.handleInteractionReset()
  }

  private handleDocumentFocusIn = (event: FocusEvent) => {
    if (this.options.container.contains(event.target as Node | null)) return
    this.handleInteractionReset()
  }

  private handleVisibilityChange = () => {
    if (this.ownerDocument.visibilityState === "hidden") this.handleInteractionReset()
  }

  private handleInteractionReset = () => {
    this.clearPointerGesture()
    this.dragSourceUri = ""
  }

  private handleClick = async (event: MouseEvent) => {
    const item = this.itemFromEvent(event)
    if (!item) {
      this.clearPointerGesture()
      return
    }
    if (item.isDirectory) {
      if (this.pointerGesture?.uri === item.uri && this.pointerGesture.expandedOnPointerDown) {
        this.clearPointerGesture()
        return
      }
      this.clearPointerGesture()
      if (item.expanded) {
        this.commitSelection(item)
        if (item.loading || this.pendingExpansionUris.has(item.uri)) return
        this.tree.collapse(item)
      } else {
        await this.commitDirectoryExpansion(item)
      }
      return
    }
    this.clearPointerGesture()
    this.commitSelection(item)
    this.options.onOpenFile?.(item.uri)
  }

  private handleContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    this.options.onContextMenu?.(event, this.itemFromEvent(event))
  }

  private handleKeydown = (event: KeyboardEvent) => {
    const items = this.listView.getItems()
    const focused = this.focusedKeyboardItem(items)
    const navigationIndex = resolveListNavigationIndex({
      key: event.key,
      currentIndex: focused ? items.indexOf(focused) : this.listView.getFirstRenderedIndex(),
      itemCount: items.length,
      viewportItemCount: this.listView.getViewportItemCount(),
    })
    if (navigationIndex != null) {
      event.preventDefault()
      const next = items[navigationIndex]
      if (next) {
        this.commitSelection(next)
        this.listView.revealIndex(navigationIndex)
      }
      return
    }
    if (!focused) return
    if (event.key === "Enter") {
      event.preventDefault()
      if (focused.isDirectory) {
        if (focused.expanded) {
          this.commitSelection(focused)
          if (focused.loading || this.pendingExpansionUris.has(focused.uri)) return
          this.tree.collapse(focused)
        } else {
          void this.commitDirectoryExpansion(focused)
        }
      } else {
        this.commitSelection(focused)
        this.options.onOpenFile?.(focused.uri)
      }
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      if (!focused.isDirectory) return
      this.commitSelection(focused)
      if (!focused.expanded && !focused.loading && !this.pendingExpansionUris.has(focused.uri)) {
        void this.commitDirectoryExpansion(focused)
        return
      }
      const firstChild = items[items.indexOf(focused) + 1]
      if (firstChild?.parent === focused) {
        this.commitSelection(firstChild)
        this.listView.revealIndex(items.indexOf(firstChild))
      }
    } else if (event.key === "ArrowLeft") {
      event.preventDefault()
      if (focused.isDirectory && focused.expanded && !focused.loading) {
        this.commitSelection(focused)
        this.tree.collapse(focused)
        return
      }
      if (focused.parent) {
        this.commitSelection(focused.parent)
        this.listView.revealIndex(items.indexOf(focused.parent))
      }
    } else if (event.key === " ") {
      event.preventDefault()
      if (focused.isDirectory && !focused.loading) {
        this.commitSelection(focused)
        if (focused.expanded) this.tree.collapse(focused)
        else void this.commitDirectoryExpansion(focused)
      }
    } else if (event.key === "F2") {
      event.preventDefault()
      this.options.onCommand?.("explorer.rename", focused.uri)
    } else if (event.key === "Delete") {
      event.preventDefault()
      this.options.onCommand?.("explorer.delete", focused.uri)
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      event.preventDefault()
      this.options.onCommand?.("explorer.copy", focused.uri)
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x") {
      event.preventDefault()
      this.options.onCommand?.("explorer.cut", focused.uri)
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
      event.preventDefault()
      this.options.onCommand?.("explorer.paste", focused.isDirectory ? focused.uri : this.state.projectRoot || "")
    }
  }

  private focusedKeyboardItem(items = this.listView.getItems()): ExplorerItem | null {
    if (!items.length) return null
    const focusedUri = this.currentRendererOptions.focusedUri || this.currentRendererOptions.selectedUri || this.localSelectedUri || ""
    if (focusedUri) {
      const focused = items.find((item) => item.uri === focusedUri)
      if (focused) return focused
    }
    return items[this.listView.getFirstRenderedIndex()] || items[0] || null
  }

  private handleDragStart = (event: DragEvent) => {
    const item = this.itemFromEvent(event)
    if (!item) return
    this.clearPointerGesture()
    this.dragSourceUri = item.uri
    event.dataTransfer?.setData?.("text/plain", item.uri)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
  }

  private handleDragOver = (event: DragEvent) => {
    const item = this.itemFromEvent(event)
    if (!this.dragSourceUri || !item?.isDirectory) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
  }

  private handleDrop = (event: DragEvent) => {
    const target = this.itemFromEvent(event)
    const source = this.dragSourceUri || event.dataTransfer?.getData?.("text/plain") || ""
    this.dragSourceUri = ""
    if (!source || !target?.isDirectory || source === target.uri) return
    event.preventDefault()
    this.options.onMoveEntry?.(source, target.uri)
  }

  private commitSelection(item: ExplorerItem): void {
    const previousSelectedUri = this.currentRendererOptions.selectedUri || ""
    this.localSelectedUri = item.uri
    this.model.setSelected(item)
    this.model.setFocused(item)
    this.currentRendererOptions = {
      ...this.currentRendererOptions,
      selectedUri: item.uri,
      focusedUri: item.uri,
    }
    this.renderer.updateOptions(this.currentRendererOptions)
    this.listView.renderVisibleItems((visibleItem) => {
      return visibleItem.uri === item.uri || visibleItem.uri === previousSelectedUri
    })
    this.syncActiveDescendant(item)
    if (item.isDirectory) this.options.onSelectDir?.(item.uri)
  }

  private syncActiveDescendant(item = this.focusedKeyboardItem()): void {
    this.listView.setActiveDescendant(item ? explorerRowDomId(item) : "")
  }

  private schedulePointerFallback(gesture: ExplorerPointerGesture): void {
    if (gesture.fallbackTimer) clearTimeout(gesture.fallbackTimer)
    gesture.fallbackTimer = setTimeout(() => {
      if (this.pointerGesture !== gesture) return
      const item = this.model.getItem(gesture.uri)
      this.pointerGesture = null
      if (!item) return
      if (item.isDirectory) {
        if (gesture.expandedOnPointerDown) return
        if (item.expanded) {
          this.commitSelection(item)
          if (!item.loading && !this.pendingExpansionUris.has(item.uri)) this.tree.collapse(item)
        } else {
          void this.commitDirectoryExpansion(item)
        }
        return
      }
      this.commitSelection(item)
      this.options.onOpenFile?.(item.uri)
    }, 0)
  }

  private clearPointerGesture(): void {
    const gesture = this.pointerGesture
    if (gesture?.fallbackTimer) clearTimeout(gesture.fallbackTimer)
    this.pointerGesture = null
  }

  private pointerMoved(gesture: ExplorerPointerGesture, event: PointerEvent): boolean {
    const deltaX = Math.abs(Number(event.clientX || 0) - gesture.startX)
    const deltaY = Math.abs(Number(event.clientY || 0) - gesture.startY)
    return deltaX > 6 || deltaY > 6
  }

  private async refreshExpandedSubtree(item: ExplorerItem, expandedUris: Set<string>): Promise<void> {
    item.stale = true
    await this.tree.expand(item)
    for (const child of item.children) {
      if (expandedUris.has(child.uri)) await this.refreshExpandedSubtree(child, expandedUris)
    }
  }

  private async prewarmVisibleRoots(roots: ExplorerItem[], updateRevision: number): Promise<void> {
    if (!this.shouldPrewarmVisibleRoots()) return
    const visibleTopLevelDirs = roots
      .filter((root) => root.childrenLoaded && root.expanded)
      .flatMap((root) => root.children)
      .filter((item) => item.isDirectory)
      .slice(0, 12)
    if (!visibleTopLevelDirs.length || updateRevision !== this.updateRevision) return
    await this.dataSource.prewarmChildren(visibleTopLevelDirs, {
      maxDirectories: 12,
      maxDepth: 1,
      concurrency: 2,
    })
  }

  private shouldRestoreSavedExpandedState(): boolean {
    const profile = this.state.workspaceScaleProfile
    if (!profile) return false
    if (profile?.pending) return false
    return profile?.scale !== "huge"
  }

  private shouldPrewarmVisibleRoots(): boolean {
    const profile = this.state.workspaceScaleProfile
    if (!profile) return false
    if (profile?.pending) return false
    return profile?.scale !== "huge"
  }

  private explorerSortOrderConfiguration(): Partial<ISortOrderConfiguration> {
    return this.state.explorerSortOrderConfiguration || {}
  }

  private compareExplorerItems(): (first: ExplorerItem, second: ExplorerItem) => number {
    return createExplorerItemComparator(this.explorerSortOrderConfiguration())
  }

  private directoryReadConcurrency(): number {
    const profile = this.state.workspaceScaleProfile
    if (!profile || profile?.pending || profile?.scale === "huge") return 1
    return 2
  }
}

function decorationValue(decorations: ExplorerRendererOptions["decorations"], uri: string): unknown {
  return decorations?.[uri] || decorations?.[relativeDecorationKey(uri)]
}

function relativeDecorationKey(uri: string): string {
  return String(uri || "").replace(/\\/g, "/").split("/").slice(-3).join("/")
}

function basename(uri: string): string {
  return normalizeExplorerUri(uri).split("/").filter(Boolean).pop() || uri
}
