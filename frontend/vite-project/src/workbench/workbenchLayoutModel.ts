import type { BottomPanelId, BottomPanelState } from "./bottomPanelState"
import type { ContextKeyState } from "./contextKeys"
import type { EditorGroupState } from "./editorGroups"
import {
  cloneWorkbenchPaneCompositeSnapshot,
  createEmptyWorkbenchPaneCompositeSnapshot,
  hydrateWorkbenchPaneCompositeSnapshot,
  type WorkbenchPaneCompositeSnapshot,
} from "./workbenchPaneCompositeModel"
import { getViewContainers, getViews, type ViewContainerDescriptor, type ViewDescriptor } from "./viewRegistry"
import { globalEditorPartService, type EditorPartOverflowState } from "../vscode-adapter/workbench/services/editor/common/editorPartService"

// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\workbench\common\views.ts
// - D:\SourceMirror\vscode\src\vs\workbench\services\views\common\viewsService.ts
// - D:\SourceMirror\vscode\src\vs\workbench\browser\layout.ts
// - D:\SourceMirror\vscode\src\vs\workbench\browser\parts\{activitybar,sidebar,editor}
// - D:\SourceMirror\vscode\src\vs\workbench\browser\parts\{titlebar,statusbar}
// - D:\SourceMirror\vscode\src\vs\platform\{actions,commands}\common
//
// Codek keeps the existing Vue-rendered workbench state for now. This model is
// the first shared projection layer so Activity Bar, Sidebar, Panel,
// EditorPart, Title Bar, Status Bar, and Command surface state can be serialized
// and later wired to a richer VS Code-like layout service without duplicating UI
// state.

export type CodekSidebarViewId =
  | "files"
  | "search"
  | "symbols"
  | "changes"
  | "marketplace"
  | "remote"
  | "goals"
  | "settings"
  | "testing"
  | "agentEvidence"
  | string

export interface WorkbenchLayoutState {
  activeSidebarView: CodekSidebarViewId
  sidebarVisible: boolean
}

export interface WorkbenchLayoutSnapshotInput extends WorkbenchLayoutState {
  sidebarWidth?: number
  bottomPanel: BottomPanelState
  bottomPanelHeight?: number
  editorGroups: EditorGroupState
  context?: ContextKeyState
  titleBar?: Partial<WorkbenchTitleBarPartModel>
  statusBar?: Partial<WorkbenchStatusBarPartModel>
  commandSurface?: WorkbenchCommandSurfaceSnapshotInput
  paneComposite?: WorkbenchPaneCompositeSnapshot
}

export interface WorkbenchActivityContainerModel {
  containerId: string
  title: string
  tooltip: string
  active: boolean
  visible: boolean
  order: number
  source: ViewContainerDescriptor["source"]
  activeViewId: CodekSidebarViewId
  viewIds: string[]
  icon?: string
  codicon?: string
  badge?: number | string
  progress?: boolean | "loading" | "syncing"
}

export interface WorkbenchSidebarPartModel {
  visible: boolean
  activeContainerId: string | null
  activeViewId: CodekSidebarViewId | null
  title: string
  emptyStateTitle: string
  emptyStateDescription: string
  width: number | null
  views: Array<{
    id: string
    name: string
    description?: string
    source: ViewDescriptor["source"]
  }>
}

export interface WorkbenchPanelPartModel {
  visible: boolean
  activePanelId: BottomPanelId | null
  height: number | null
}

export interface WorkbenchEditorGroupPartModel {
  id: string
  active: boolean
  activeEditor: string | null
  editorCount: number
  dirtyCount: number
  pinnedCount: number
  previewCount: number
}

export interface WorkbenchEditorPartModel {
  activeGroupId: string
  activeEditor: string | null
  totalEditors: number
  dirtyCount: number
  pinnedCount: number
  previewCount: number
  groups: WorkbenchEditorGroupPartModel[]
  split: EditorGroupState["split"]
  overflow: EditorPartOverflowState
}

export interface WorkbenchTitleBarPartModel {
  visible: boolean
  projectName: string
  activeEditor: string | null
  activeViewId: CodekSidebarViewId | null
  agentMode: string
  sandboxMode: string
  goalCount: number
  diagnosticsErrorCount: number
  diagnosticsWarningCount: number
  commandPaletteHint: string
}

export interface WorkbenchStatusBarPartModel {
  visible: boolean
  activeViewId: CodekSidebarViewId | null
  activePanelId: BottomPanelId | null
  languageId: string
  line: number
  column: number
  branch: string
  errorCount: number
  warningCount: number
  encoding: string
  eol: string
}

export interface WorkbenchCommandSurfaceSnapshotInput {
  visible?: boolean
  commandIds?: string[]
  menuIds?: string[]
  menuEntryCount?: number
  commandPaletteCommandIds?: string[]
}

export interface WorkbenchCommandSurfacePartModel {
  visible: boolean
  commandCount: number
  commandIds: string[]
  menuIds: string[]
  menuEntryCount: number
  commandPaletteCommandIds: string[]
}

export interface WorkbenchLayoutSnapshot {
  version: 1
  parts: {
    activityBar: {
      visible: boolean
      activeContainerId: string | null
      containers: WorkbenchActivityContainerModel[]
    }
    sideBar: WorkbenchSidebarPartModel
    panel: WorkbenchPanelPartModel
    editorPart: WorkbenchEditorPartModel
    titleBar: WorkbenchTitleBarPartModel
    statusBar: WorkbenchStatusBarPartModel
    commandSurface: WorkbenchCommandSurfacePartModel
    paneComposite: WorkbenchPaneCompositeSnapshot
  }
}

export interface RestoreWorkbenchLayoutTarget {
  setActiveSidebarView?: (viewId: CodekSidebarViewId) => void
  setSidebarVisible?: (visible: boolean) => void
  setSidebarWidth?: (width: number) => void
  setBottomPanel?: (panelId: BottomPanelId | null) => void
  setBottomPanelHeight?: (height: number) => void
  setSplitOpen?: (open: boolean) => void
  setSplitFile?: (path: string | null) => void
  setSplitRatio?: (ratio: number) => void
}

export interface RestoreWorkbenchLayoutResult {
  restored: boolean
  reason?: "missing-snapshot" | "incompatible-version"
}

export interface ActivateWorkbenchViewContainerResult {
  activated: boolean
  viewId: CodekSidebarViewId
  containerId: string | null
}

const DEFAULT_SIDEBAR_WIDTH = 280
const DEFAULT_PANEL_HEIGHT = 240
const DEFAULT_VISIBLE_EDITOR_TABS = 8

const SIDEBAR_TO_CONTAINER_ID: Record<string, string> = {
  files: "workbench.view.explorer",
  search: "workbench.view.search",
  symbols: "codek.view.symbols",
  changes: "workbench.view.scm",
  debug: "workbench.view.debug",
  marketplace: "workbench.view.extensions",
  mcp: "workbench.view.mcp",
  remote: "codek.view.remote",
  goals: "codek.view.agent",
  automation: "codek.view.automation",
  settings: "workbench.view.settings",
  testing: "workbench.view.testing",
  agentEvidence: "codek.view.agentEvidence",
}

const CONTAINER_TO_SIDEBAR_ID: Record<string, CodekSidebarViewId> = Object.fromEntries(
  Object.entries(SIDEBAR_TO_CONTAINER_ID).map(([viewId, containerId]) => [containerId, viewId]),
) as Record<string, CodekSidebarViewId>

export function buildWorkbenchLayoutSnapshot(input: WorkbenchLayoutSnapshotInput): WorkbenchLayoutSnapshot {
  const context = input.context || {}
  const containers = getViewContainers("activityBar", context)
  const activeContainerId = resolveVisibleContainerId(input.activeSidebarView, containers)
  const activeSidebarView = activeContainerId ? containerIdToSidebarView(activeContainerId) : null
  const activeContainer = activeContainerId ? containers.find((container) => container.id === activeContainerId) || null : null
  const activeViews = activeContainerId ? getViews(activeContainerId, context) : []
  const sideBar: WorkbenchSidebarPartModel = {
    visible: input.sidebarVisible && Boolean(activeContainerId),
    activeContainerId,
    activeViewId: activeSidebarView,
    title: activeContainer?.name || "",
    emptyStateTitle: activeContainer?.emptyStateTitle || activeContainer?.name || "视图",
    emptyStateDescription: activeContainer?.emptyStateDescription || "",
    width: input.sidebarVisible ? sanitizeDimension(input.sidebarWidth, DEFAULT_SIDEBAR_WIDTH) : null,
    views: activeViews.map((view) => ({
      id: view.id,
      name: view.name,
      description: view.userDescription,
      source: view.source,
    })),
  }
  const panel: WorkbenchPanelPartModel = {
    visible: input.bottomPanel.active !== null,
    activePanelId: input.bottomPanel.active,
    height: input.bottomPanel.active ? sanitizeDimension(input.bottomPanelHeight, DEFAULT_PANEL_HEIGHT) : null,
  }
  const editorPart = buildEditorPartModel(input.editorGroups)

  return {
    version: 1,
    parts: {
      activityBar: {
        visible: containers.length > 0,
        activeContainerId,
        containers: containers.map((container) => buildActivityContainerModel(container, activeContainerId, context)),
      },
      sideBar,
      panel,
      editorPart,
      titleBar: buildTitleBarPart(input.titleBar, sideBar, editorPart),
      statusBar: buildStatusBarPart(input.statusBar, sideBar, panel),
      commandSurface: buildCommandSurfacePart(input.commandSurface),
      paneComposite: input.paneComposite
        ? cloneWorkbenchPaneCompositeSnapshot(input.paneComposite)
        : createEmptyWorkbenchPaneCompositeSnapshot(),
    },
  }
}

export function activateWorkbenchViewContainer(
  state: WorkbenchLayoutState,
  containerId: string,
  context: ContextKeyState = {},
): ActivateWorkbenchViewContainerResult {
  const containers = getViewContainers("activityBar", context)
  if (!containers.some((container) => container.id === containerId)) {
    return { activated: false, viewId: state.activeSidebarView, containerId: null }
  }

  const viewId = containerIdToSidebarView(containerId)
  state.activeSidebarView = viewId
  state.sidebarVisible = true
  return { activated: true, viewId, containerId }
}

export function serializeWorkbenchLayoutSnapshot(snapshot: WorkbenchLayoutSnapshot): string {
  return JSON.stringify(snapshot)
}

export function deserializeWorkbenchLayoutSnapshot(raw: unknown): WorkbenchLayoutSnapshot | null {
  if (!raw) return null
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!isWorkbenchLayoutSnapshot(value)) return null
    return hydrateWorkbenchLayoutSnapshot(value)
  } catch {
    return null
  }
}

export function restoreWorkbenchLayoutStateFromSnapshot(
  snapshot: WorkbenchLayoutSnapshot | null | undefined,
  target: RestoreWorkbenchLayoutTarget,
): RestoreWorkbenchLayoutResult {
  if (!snapshot) return { restored: false, reason: "missing-snapshot" }
  if (snapshot.version !== 1) return { restored: false, reason: "incompatible-version" }

  const sideBar = snapshot.parts.sideBar
  if (sideBar.activeViewId) target.setActiveSidebarView?.(sideBar.activeViewId)
  target.setSidebarVisible?.(sideBar.visible)
  if (typeof sideBar.width === "number") target.setSidebarWidth?.(sideBar.width)

  const panel = snapshot.parts.panel
  target.setBottomPanel?.(panel.activePanelId)
  if (typeof panel.height === "number") target.setBottomPanelHeight?.(panel.height)

  const split = snapshot.parts.editorPart.split
  target.setSplitOpen?.(split.open)
  target.setSplitFile?.(split.file)
  target.setSplitRatio?.(split.ratio)

  return { restored: true }
}

export function sidebarViewToContainerId(viewId: CodekSidebarViewId): string {
  return SIDEBAR_TO_CONTAINER_ID[viewId] || String(viewId)
}

export function containerIdToSidebarView(containerId: string): CodekSidebarViewId {
  return CONTAINER_TO_SIDEBAR_ID[containerId] || containerId
}

function resolveVisibleContainerId(activeSidebarView: CodekSidebarViewId, containers: ViewContainerDescriptor[]): string | null {
  if (!containers.length) return null
  const requestedContainerId = sidebarViewToContainerId(activeSidebarView)
  if (containers.some((container) => container.id === requestedContainerId)) return requestedContainerId
  return containers[0].id
}

function buildActivityContainerModel(
  container: ViewContainerDescriptor,
  activeContainerId: string | null,
  context: ContextKeyState,
): WorkbenchActivityContainerModel {
  const views = getViews(container.id, context)
  return {
    containerId: container.id,
    title: container.name,
    tooltip: container.userTooltip || container.name,
    active: container.id === activeContainerId,
    visible: true,
    order: container.order || 0,
    source: container.source,
    activeViewId: containerIdToSidebarView(container.id),
    viewIds: views.map((view) => view.id),
    icon: container.icon,
    codicon: container.productIcon?.codicon,
    badge: resolveActivityContainerBadge(views),
    progress: resolveActivityContainerProgress(views),
  }
}

function resolveActivityContainerBadge(views: ViewDescriptor[]): number | string | undefined {
  const badges = views
    .map((view) => view.badge)
    .filter((badge): badge is number | string => badge !== undefined && badge !== null && badge !== "")
  if (!badges.length) return undefined
  const numericTotal = badges
    .filter((badge): badge is number => typeof badge === "number")
    .reduce((total, badge) => total + badge, 0)
  if (numericTotal > 0) return numericTotal
  return badges.find((badge) => typeof badge === "string") || undefined
}

function resolveActivityContainerProgress(views: ViewDescriptor[]): boolean | "loading" | "syncing" | undefined {
  const progress = views
    .map((view) => view.progress)
    .find((value): value is boolean | "loading" | "syncing" => value === true || value === "loading" || value === "syncing")
  return progress || undefined
}

function buildEditorPartModel(state: EditorGroupState): WorkbenchEditorPartModel {
  const summary = globalEditorPartService.getSummary(state, { visibleEditors: DEFAULT_VISIBLE_EDITOR_TABS })
  return {
    activeGroupId: summary.activeGroupId,
    activeEditor: summary.activeEditor,
    totalEditors: summary.totalEditors,
    dirtyCount: summary.dirtyCount,
    pinnedCount: summary.pinnedCount,
    previewCount: summary.previewCount,
    groups: state.groups.map((group) => ({
      id: group.id,
      active: group.id === state.activeGroupId,
      activeEditor: group.activeEditor,
      editorCount: group.editors.length,
      dirtyCount: group.editors.filter((editor) => editor.dirty).length,
      pinnedCount: group.editors.filter((editor) => editor.pinned).length,
      previewCount: group.editors.filter((editor) => editor.preview).length,
    })),
    split: { ...state.split },
    overflow: summary.overflow,
  }
}

function buildTitleBarPart(
  input: Partial<WorkbenchTitleBarPartModel> | undefined,
  sideBar: WorkbenchSidebarPartModel,
  editorPart: WorkbenchEditorPartModel,
): WorkbenchTitleBarPartModel {
  return {
    visible: input?.visible ?? true,
    projectName: input?.projectName ?? "",
    activeEditor: input?.activeEditor ?? editorPart.activeEditor,
    activeViewId: input?.activeViewId ?? sideBar.activeViewId,
    agentMode: input?.agentMode ?? "",
    sandboxMode: input?.sandboxMode ?? "",
    goalCount: sanitizeCount(input?.goalCount),
    diagnosticsErrorCount: sanitizeCount(input?.diagnosticsErrorCount),
    diagnosticsWarningCount: sanitizeCount(input?.diagnosticsWarningCount),
    commandPaletteHint: input?.commandPaletteHint ?? "Ctrl+Shift+P",
  }
}

function buildStatusBarPart(
  input: Partial<WorkbenchStatusBarPartModel> | undefined,
  sideBar: WorkbenchSidebarPartModel,
  panel: WorkbenchPanelPartModel,
): WorkbenchStatusBarPartModel {
  return {
    visible: input?.visible ?? true,
    activeViewId: input?.activeViewId ?? sideBar.activeViewId,
    activePanelId: input?.activePanelId ?? panel.activePanelId,
    languageId: input?.languageId ?? "plaintext",
    line: sanitizeCount(input?.line, 1),
    column: sanitizeCount(input?.column, 1),
    branch: input?.branch ?? "",
    errorCount: sanitizeCount(input?.errorCount),
    warningCount: sanitizeCount(input?.warningCount),
    encoding: input?.encoding ?? "UTF-8",
    eol: input?.eol ?? "LF",
  }
}

function buildCommandSurfacePart(input: WorkbenchCommandSurfaceSnapshotInput | undefined): WorkbenchCommandSurfacePartModel {
  const commandIds = sanitizeStringList(input?.commandIds)
  return {
    visible: input?.visible ?? commandIds.length > 0,
    commandCount: commandIds.length,
    commandIds,
    menuIds: sanitizeStringList(input?.menuIds),
    menuEntryCount: sanitizeCount(input?.menuEntryCount),
    commandPaletteCommandIds: sanitizeStringList(input?.commandPaletteCommandIds),
  }
}

function hydrateWorkbenchLayoutSnapshot(snapshot: WorkbenchLayoutSnapshot): WorkbenchLayoutSnapshot {
  return {
    version: 1,
    parts: {
      ...snapshot.parts,
      titleBar: snapshot.parts.titleBar ?? buildTitleBarPart(undefined, snapshot.parts.sideBar, snapshot.parts.editorPart),
      statusBar: snapshot.parts.statusBar ?? buildStatusBarPart(undefined, snapshot.parts.sideBar, snapshot.parts.panel),
      commandSurface: snapshot.parts.commandSurface ?? buildCommandSurfacePart(undefined),
      paneComposite: hydrateWorkbenchPaneCompositeSnapshot(snapshot.parts.paneComposite),
    },
  }
}

function sanitizeDimension(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
}

function sanitizeCount(value: number | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback
}

function sanitizeStringList(values: string[] | undefined): string[] {
  return Array.isArray(values) ? values.map((value) => String(value || "")).filter(Boolean) : []
}

function isWorkbenchLayoutSnapshot(value: unknown): value is WorkbenchLayoutSnapshot {
  if (!value || typeof value !== "object") return false
  const snapshot = value as WorkbenchLayoutSnapshot
  return snapshot.version === 1
    && Boolean(snapshot.parts?.activityBar)
    && Boolean(snapshot.parts?.sideBar)
    && Boolean(snapshot.parts?.panel)
    && Boolean(snapshot.parts?.editorPart)
}
