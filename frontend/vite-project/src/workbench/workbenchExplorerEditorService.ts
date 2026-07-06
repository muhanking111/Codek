import type { Event } from "../vscode-adapter/base/common/event"
import { Emitter } from "../vscode-adapter/base/common/event"
import type { IDisposable } from "../vscode-adapter/base/common/lifecycle"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import type { ExplorerItem, ExplorerModel, ExplorerViewState } from "../explorer/model/ExplorerModel"
import {
  buildBreadcrumbDisplayModel,
  type BreadcrumbDisplayInput,
  type BreadcrumbDisplayModel,
  type BreadcrumbPathInput,
  type BreadcrumbSymbolInput,
} from "./breadcrumbDisplay"
import {
  applyEditorGroupStateToOpenFiles,
  buildEditorGroupStateFromOpenFiles,
} from "./editorGroupPersistence"
import {
  createEditorOwnerEvidence,
  type EditorEntry,
  type EditorGroupState,
  type EditorOwnerEvidence,
  type OpenEditorOptions,
} from "./editorGroups"
import { globalEditorPartService, type EditorPartOverflowState } from "../vscode-adapter/workbench/services/editor/common/editorPartService"

export type WorkbenchExplorerEditorChangeKind = "explorer" | "editorGroups" | "openEditors" | "breadcrumbs"

export interface WorkbenchExplorerEditorChangeEvent {
  readonly kind: WorkbenchExplorerEditorChangeKind
  readonly reason?: string
}

export interface WorkbenchExplorerSnapshot {
  readonly source: "workbenchExplorerEditorService"
  readonly rootCount: number
  readonly itemCount: number
  readonly expandedUris: string[]
  readonly selectedUri: string
  readonly focusedUri: string
  readonly visibleUris: string[]
  readonly decorations: Record<string, WorkbenchExplorerDecoration>
  readonly workingTree: WorkbenchExplorerWorkingTreeVisibility
  readonly viewState?: ExplorerViewState
}

export interface WorkbenchExplorerDecoration {
  readonly label: string
  readonly status: "modified" | "ignored"
  readonly tooltip: string
}

export interface WorkbenchExplorerWorkingTreeVisibility {
  readonly visibleOpenUris: string[]
  readonly visibleDirtyUris: string[]
  readonly hiddenOpenUris: string[]
  readonly openCount: number
  readonly dirtyCount: number
}

export interface OpenEditorListEntry extends EditorEntry {
  readonly groupId: string
  readonly index: number
  readonly active: boolean
  readonly label: string
  readonly description: string
  readonly ownerEvidence: EditorOwnerEvidence
}

export interface OpenEditorsModel {
  readonly source: "workbenchExplorerEditorService"
  readonly activeGroupId: string
  readonly activeEditor: string | null
  readonly totalEditors: number
  readonly dirtyCount: number
  readonly pinnedCount: number
  readonly previewCount: number
  readonly ownerEvidence: EditorOwnerEvidence
  readonly entries: readonly OpenEditorListEntry[]
  readonly overflow: EditorPartOverflowState
}

export interface BreadcrumbsModel {
  readonly source: "workbenchExplorerEditorService"
  readonly activeEditor: string | null
  readonly path: readonly BreadcrumbPathInput[]
  readonly symbols: readonly BreadcrumbSymbolInput[]
  readonly activeDropdown: number | null
  readonly pathCount: number
  readonly symbolCount: number
  readonly displayModel: BreadcrumbDisplayModel
}

export interface WorkbenchEditorGroupStateInput {
  readonly openFiles: readonly string[]
  readonly activeFile?: string | null
  readonly pinnedTabs?: Iterable<string>
  readonly dirtyFiles?: (path: string) => boolean
  readonly closedEditors?: EditorEntry[]
  readonly split?: { open: boolean; file: string | null; ratio: number }
}

export interface WorkbenchEditorGroupApplyTarget {
  setOpenFiles: (paths: string[]) => void
  setActiveFile?: (path: string | null) => void
  pinnedTabs?: Set<string>
  closedEditors?: EditorEntry[]
}

export interface IWorkbenchExplorerEditorService {
  readonly _serviceBrand: undefined
  readonly onDidChange: Event<WorkbenchExplorerEditorChangeEvent>
  bindExplorerModel(model: ExplorerModel | null): IDisposable
  getExplorerModel(): ExplorerModel | null
  getExplorerSnapshot(): WorkbenchExplorerSnapshot
  replaceEditorGroupState(state: EditorGroupState): EditorGroupState
  replaceEditorGroupStateFromOpenFiles(input: WorkbenchEditorGroupStateInput): EditorGroupState
  getEditorGroupState(): EditorGroupState
  applyEditorGroupStateToTarget(target: WorkbenchEditorGroupApplyTarget): void
  openEditor(path: string, options?: OpenEditorOptions): EditorEntry
  focusEditor(path: string): boolean
  closeEditor(path: string): boolean
  closeOtherEditors(keepPath: string): void
  closeRightEditors(anchorPath: string): void
  closeSavedEditors(): void
  reopenClosedEditor(): EditorEntry | null
  moveEditor(draggedPath: string, targetPath: string): void
  togglePinned(path: string): void
  markDirty(path: string, dirty: boolean): void
  setSplitOpen(open: boolean, file?: string | null, ratio?: number): void
  getOpenEditorsModel(options?: { visibleEditors?: number }): OpenEditorsModel
  updateBreadcrumbs(input: BreadcrumbDisplayInput): BreadcrumbsModel
  setActiveBreadcrumbDropdown(index: number | null): BreadcrumbsModel
  clearBreadcrumbs(): BreadcrumbsModel
  getBreadcrumbs(): BreadcrumbsModel
}

export const IWorkbenchExplorerEditorService = createDecorator<IWorkbenchExplorerEditorService>("workbenchExplorerEditorService")

export class WorkbenchExplorerEditorService implements IWorkbenchExplorerEditorService {
  declare readonly _serviceBrand: undefined

  private readonly onDidChangeEmitter = new Emitter<WorkbenchExplorerEditorChangeEvent>()
  readonly onDidChange = this.onDidChangeEmitter.event

  private editorGroupState = globalEditorPartService.createState()
  private explorerModel: ExplorerModel | null = null
  private explorerDisposables: IDisposable[] = []
  private breadcrumbs: BreadcrumbsModel = createBreadcrumbsModel(null, {})

  bindExplorerModel(model: ExplorerModel | null): IDisposable {
    this.clearExplorerBinding()
    this.explorerModel = model
    if (model) {
      this.explorerDisposables = [
        model.on("roots", () => this.emit("explorer", "roots")),
        model.on("node", () => this.emit("explorer", "node")),
        model.on("selection", () => this.emit("explorer", "selection")),
        model.on("decoration", () => this.emit("explorer", "decoration")),
      ].map((dispose) => ({ dispose }))
    }
    this.emit("explorer", model ? "bind" : "unbind")
    return {
      dispose: () => {
        if (this.explorerModel === model) {
          this.clearExplorerBinding()
          this.emit("explorer", "unbind")
        }
      },
    }
  }

  getExplorerModel(): ExplorerModel | null {
    return this.explorerModel
  }

  getExplorerSnapshot(): WorkbenchExplorerSnapshot {
    const model = this.explorerModel
    if (!model) {
      return {
        source: "workbenchExplorerEditorService",
        rootCount: 0,
        itemCount: 0,
        expandedUris: [],
        selectedUri: "",
        focusedUri: "",
        visibleUris: [],
        decorations: {},
        workingTree: {
          visibleOpenUris: [],
          visibleDirtyUris: [],
          hiddenOpenUris: [],
          openCount: 0,
          dirtyCount: 0,
        },
      }
    }
    const visibleUris = collectExplorerUris(model.roots)
    const visibleSet = new Set(visibleUris.map(normalizeResourceKey))
    const openEditors = this.getOpenEditorsModel()
    const visibleOpenUris: string[] = []
    const visibleDirtyUris: string[] = []
    const hiddenOpenUris: string[] = []
    const decorations: Record<string, WorkbenchExplorerDecoration> = {}

    for (const entry of openEditors.entries) {
      const key = normalizeResourceKey(entry.path)
      if (visibleSet.has(key)) {
        visibleOpenUris.push(entry.path)
        if (entry.dirty) {
          visibleDirtyUris.push(entry.path)
          decorations[entry.path] = {
            label: "M",
            status: "modified",
            tooltip: "Modified working tree file",
          }
        }
      } else {
        hiddenOpenUris.push(entry.path)
      }
    }
    for (const item of model.itemsByUri.values()) {
      if (!item.ignored) continue
      decorations[item.uri] = {
        label: "",
        status: "ignored",
        tooltip: "Ignored by workspace visibility rules",
      }
    }
    return {
      source: "workbenchExplorerEditorService",
      rootCount: model.roots.length,
      itemCount: model.itemsByUri.size,
      expandedUris: [...model.expandedUris],
      selectedUri: model.selectedUri,
      focusedUri: model.focusedUri,
      visibleUris,
      decorations,
      workingTree: {
        visibleOpenUris,
        visibleDirtyUris,
        hiddenOpenUris,
        openCount: openEditors.totalEditors,
        dirtyCount: openEditors.dirtyCount,
      },
      viewState: model.getViewState(),
    }
  }

  replaceEditorGroupState(state: EditorGroupState): EditorGroupState {
    this.editorGroupState = state
    this.updateBreadcrumbActiveEditor()
    this.emitEditorGroups()
    return this.editorGroupState
  }

  replaceEditorGroupStateFromOpenFiles(input: WorkbenchEditorGroupStateInput): EditorGroupState {
    return this.replaceEditorGroupState(buildEditorGroupStateFromOpenFiles({
      openFiles: input.openFiles.map(String),
      activeFile: input.activeFile,
      pinnedTabs: input.pinnedTabs,
      dirtyFiles: input.dirtyFiles,
      closedEditors: input.closedEditors,
      split: input.split,
    }))
  }

  getEditorGroupState(): EditorGroupState {
    return this.editorGroupState
  }

  applyEditorGroupStateToTarget(target: WorkbenchEditorGroupApplyTarget): void {
    applyEditorGroupStateToOpenFiles(this.editorGroupState, target)
  }

  openEditor(path: string, options: OpenEditorOptions = {}): EditorEntry {
    const editor = globalEditorPartService.openEditor(this.editorGroupState, path, options)
    this.updateBreadcrumbActiveEditor()
    this.emitEditorGroups()
    return editor
  }

  focusEditor(path: string): boolean {
    const focused = globalEditorPartService.focusEditor(this.editorGroupState, path)
    if (focused) {
      this.updateBreadcrumbActiveEditor()
      this.emitEditorGroups()
    }
    return focused
  }

  closeEditor(path: string): boolean {
    const closed = globalEditorPartService.closeEditor(this.editorGroupState, path)
    if (closed) {
      this.updateBreadcrumbActiveEditor()
      this.emitEditorGroups()
    }
    return closed
  }

  closeOtherEditors(keepPath: string): void {
    globalEditorPartService.closeOtherEditors(this.editorGroupState, keepPath)
    this.updateBreadcrumbActiveEditor()
    this.emitEditorGroups()
  }

  closeRightEditors(anchorPath: string): void {
    globalEditorPartService.closeRightEditors(this.editorGroupState, anchorPath)
    this.updateBreadcrumbActiveEditor()
    this.emitEditorGroups()
  }

  closeSavedEditors(): void {
    globalEditorPartService.closeSavedEditors(this.editorGroupState)
    this.updateBreadcrumbActiveEditor()
    this.emitEditorGroups()
  }

  reopenClosedEditor(): EditorEntry | null {
    const reopened = globalEditorPartService.reopenClosedEditor(this.editorGroupState)
    if (reopened) {
      this.updateBreadcrumbActiveEditor()
      this.emitEditorGroups()
    }
    return reopened
  }

  moveEditor(draggedPath: string, targetPath: string): void {
    globalEditorPartService.moveEditor(this.editorGroupState, draggedPath, targetPath)
    this.emitEditorGroups()
  }

  togglePinned(path: string): void {
    globalEditorPartService.togglePinned(this.editorGroupState, path)
    this.emitEditorGroups()
  }

  markDirty(path: string, dirty: boolean): void {
    globalEditorPartService.markDirty(this.editorGroupState, path, dirty)
    this.emitEditorGroups()
  }

  setSplitOpen(open: boolean, file: string | null = null, ratio?: number): void {
    globalEditorPartService.setSplitOpen(this.editorGroupState, open, file, ratio)
    this.emitEditorGroups()
  }

  getOpenEditorsModel(options: { visibleEditors?: number } = {}): OpenEditorsModel {
    const summary = globalEditorPartService.getSummary(this.editorGroupState, options)
    const entries = this.editorGroupState.groups.flatMap((group) => {
      return group.editors.map((editor, index): OpenEditorListEntry => ({
        ...editor,
        groupId: group.id,
        index,
        active: group.id === this.editorGroupState.activeGroupId && group.activeEditor === editor.path,
        label: basename(editor.path),
        description: dirname(editor.path),
        ownerEvidence: createEditorOwnerEvidence(this.editorGroupState, editor.path),
      }))
    })
    return {
      source: "workbenchExplorerEditorService",
      activeGroupId: summary.activeGroupId,
      activeEditor: summary.activeEditor,
      totalEditors: summary.totalEditors,
      dirtyCount: summary.dirtyCount,
      pinnedCount: summary.pinnedCount,
      previewCount: summary.previewCount,
      ownerEvidence: summary.ownerEvidence,
      entries,
      overflow: summary.overflow,
    }
  }

  updateBreadcrumbs(input: BreadcrumbDisplayInput): BreadcrumbsModel {
    this.breadcrumbs = createBreadcrumbsModel(this.getActiveEditor(), input)
    this.emit("breadcrumbs", "update")
    return this.breadcrumbs
  }

  setActiveBreadcrumbDropdown(index: number | null): BreadcrumbsModel {
    this.breadcrumbs = createBreadcrumbsModel(this.getActiveEditor(), {
      path: this.breadcrumbs.path,
      symbols: this.breadcrumbs.symbols,
      activeDropdown: index,
    })
    this.emit("breadcrumbs", "dropdown")
    return this.breadcrumbs
  }

  clearBreadcrumbs(): BreadcrumbsModel {
    this.breadcrumbs = createBreadcrumbsModel(this.getActiveEditor(), {})
    this.emit("breadcrumbs", "clear")
    return this.breadcrumbs
  }

  getBreadcrumbs(): BreadcrumbsModel {
    return this.breadcrumbs
  }

  private updateBreadcrumbActiveEditor(): void {
    if (this.breadcrumbs.activeEditor === this.getActiveEditor()) return
    this.breadcrumbs = createBreadcrumbsModel(this.getActiveEditor(), {
      path: this.breadcrumbs.path,
      symbols: this.breadcrumbs.symbols,
      activeDropdown: this.breadcrumbs.activeDropdown,
    })
    this.emit("breadcrumbs", "activeEditor")
  }

  private getActiveEditor(): string | null {
    return this.getOpenEditorsModel().activeEditor
  }

  private emitEditorGroups(): void {
    this.emit("editorGroups")
    this.emit("openEditors")
  }

  private emit(kind: WorkbenchExplorerEditorChangeKind, reason?: string): void {
    this.onDidChangeEmitter.fire({ kind, reason })
  }

  private clearExplorerBinding(): void {
    for (const disposable of this.explorerDisposables.splice(0)) disposable.dispose()
    this.explorerModel = null
  }
}

function createBreadcrumbsModel(activeEditor: string | null, input: BreadcrumbDisplayInput): BreadcrumbsModel {
  const path = sanitizePath(input.path)
  const symbols = sanitizeSymbols(input.symbols)
  const activeDropdown = typeof input.activeDropdown === "number" ? input.activeDropdown : null
  return {
    source: "workbenchExplorerEditorService",
    activeEditor,
    path,
    symbols,
    activeDropdown,
    pathCount: path.length,
    symbolCount: symbols.length,
    displayModel: buildBreadcrumbDisplayModel({ path, symbols, activeDropdown }),
  }
}

function sanitizePath(path: BreadcrumbDisplayInput["path"]): BreadcrumbPathInput[] {
  return Array.isArray(path) ? path.map((item) => ({ ...item })) : []
}

function sanitizeSymbols(symbols: BreadcrumbDisplayInput["symbols"]): BreadcrumbSymbolInput[] {
  return Array.isArray(symbols) ? symbols.map(cloneSymbol) : []
}

function cloneSymbol(symbol: BreadcrumbSymbolInput): BreadcrumbSymbolInput {
  return {
    ...symbol,
    range: symbol.range ? { ...symbol.range } : undefined,
    children: Array.isArray(symbol.children) ? symbol.children.map(cloneSymbol) : undefined,
  }
}

function basename(path: string): string {
  return String(path || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || path
}

function dirname(path: string): string {
  const parts = String(path || "").replace(/\\/g, "/").split("/").filter(Boolean)
  parts.pop()
  return parts.join("/")
}

function collectExplorerUris(items: readonly ExplorerItem[]): string[] {
  const result: string[] = []
  const visit = (item: ExplorerItem) => {
    result.push(item.uri)
    for (const child of item.children) visit(child)
  }
  for (const item of items) visit(item)
  return result
}

function normalizeResourceKey(value: string): string {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

export const globalWorkbenchExplorerEditorService = new WorkbenchExplorerEditorService()
registerSingleton(IWorkbenchExplorerEditorService, globalWorkbenchExplorerEditorService, InstantiationType.Delayed)
