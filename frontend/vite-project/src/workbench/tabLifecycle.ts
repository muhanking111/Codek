type UnsavedAction = "save" | "discard" | "cancel"

import {
  type EditorEntry,
  type EditorGroupState,
} from "./editorGroups"
import { buildEditorGroupStateFromOpenFiles } from "./editorGroupPersistence"
import {
  globalWorkbenchExplorerEditorService,
  type IWorkbenchExplorerEditorService,
} from "./workbenchExplorerEditorService"

interface WorkspaceLike {
  openFiles: string[]
  closeFile: (path: string) => void
}

interface UnsavedDialogState {
  visible: boolean
  path: string
  resolve: ((action: UnsavedAction) => void) | null
}

interface TabContextMenuState {
  visible: boolean
  x: number
  y: number
  path: string
}

interface TabDragState {
  draggedTab: string | null
}

export interface TabLifecycleContext {
  workspace: WorkspaceLike
  getOpenFiles: () => string[]
  getActiveFile?: () => string | null
  setActiveFile?: (path: string | null) => void
  pinnedTabs: Set<string>
  tabContextMenu: TabContextMenuState
  unsavedDialog: UnsavedDialogState
  dragState: TabDragState
  closedEditors?: EditorEntry[]
  isDirty: (path: string) => boolean
  saveFile: (path: string) => Promise<boolean>
  syncEditorFromWorkspace: () => void
  setDragOverTab: (path: string | null) => void
  openFile?: (path: string) => Promise<unknown> | unknown
  workbenchExplorerEditorService?: IWorkbenchExplorerEditorService
  reportTabLifecycleStage?: (stage: string, detail?: Record<string, unknown>) => void
}

export async function closeTab(path: string, context: TabLifecycleContext): Promise<void> {
  context.reportTabLifecycleStage?.("close:start", {
    path,
    pinned: context.pinnedTabs.has(path),
    dirty: context.isDirty(path),
    openCount: context.getOpenFiles().length,
  })
  if (context.pinnedTabs.has(path)) {
    context.reportTabLifecycleStage?.("close:pinned", { path })
    return
  }
  if (context.isDirty(path)) {
    context.reportTabLifecycleStage?.("close:unsaved-dialog:start", { path })
    const action = await showUnsavedDialog(path, context)
    context.reportTabLifecycleStage?.("close:unsaved-dialog:done", { path, action })
    if (action === "cancel") return
    if (action === "save") {
      context.reportTabLifecycleStage?.("close:save:start", { path })
      const ok = await context.saveFile(path)
      context.reportTabLifecycleStage?.("close:save:done", { path, ok })
      if (!ok) return
    }
  }
  context.reportTabLifecycleStage?.("close:create-state:start", { path })
  const state = createStateFromContext(context)
  const group = state.groups.find((entry) => entry.id === state.activeGroupId)
  context.reportTabLifecycleStage?.("close:create-state:done", { path, editors: group?.editors?.length ?? null })
  context.reportTabLifecycleStage?.("close:editor-group:start", { path })
  getWorkbenchExplorerEditorService(context).closeEditor(path)
  context.reportTabLifecycleStage?.("close:editor-group:done", { path })
  context.reportTabLifecycleStage?.("close:sync-state:start", { path })
  syncStateToContext(context)
  context.reportTabLifecycleStage?.("close:sync-state:done", { path, openCount: context.getOpenFiles().length })
  context.reportTabLifecycleStage?.("close:workspace:start", { path })
  context.workspace.closeFile(path)
  context.reportTabLifecycleStage?.("close:workspace:done", { path, openCount: context.getOpenFiles().length })
  context.pinnedTabs.delete(path)
  context.reportTabLifecycleStage?.("close:sync-editor:start", { path })
  context.syncEditorFromWorkspace()
  context.reportTabLifecycleStage?.("close:done", { path, activeFiles: context.getOpenFiles().length })
}

export function showUnsavedDialog(path: string, context: TabLifecycleContext): Promise<UnsavedAction> {
  return new Promise((resolve) => {
    context.unsavedDialog.visible = true
    context.unsavedDialog.path = path
    context.unsavedDialog.resolve = (action) => {
      context.unsavedDialog.visible = false
      context.unsavedDialog.path = ""
      context.unsavedDialog.resolve = null
      resolve(action)
    }
  })
}

export function openTabContextMenu(event: MouseEvent, path: string, context: TabLifecycleContext): void {
  context.tabContextMenu.x = event.clientX
  context.tabContextMenu.y = event.clientY
  context.tabContextMenu.path = path
  context.tabContextMenu.visible = true
}

export async function closeOtherTabs(keepPath: string, context: TabLifecycleContext): Promise<void> {
  const beforeFiles = context.getOpenFiles()
  const toClose = context.getOpenFiles().filter((path) => path !== keepPath && !context.pinnedTabs.has(path))
  for (const path of toClose) {
    const closed = await closeDirtyAwareTab(path, context)
    if (!closed) return
  }
  createStateFromContext(context, beforeFiles)
  getWorkbenchExplorerEditorService(context).closeOtherEditors(keepPath)
  syncStateToContext(context)
  context.syncEditorFromWorkspace()
}

export async function closeRightTabs(anchorPath: string, context: TabLifecycleContext): Promise<void> {
  const beforeFiles = context.getOpenFiles()
  const idx = context.getOpenFiles().indexOf(anchorPath)
  if (idx < 0) return
  const toClose = context.getOpenFiles().slice(idx + 1).filter((path) => !context.pinnedTabs.has(path))
  for (const path of toClose) {
    const closed = await closeDirtyAwareTab(path, context)
    if (!closed) return
  }
  createStateFromContext(context, beforeFiles)
  getWorkbenchExplorerEditorService(context).closeRightEditors(anchorPath)
  syncStateToContext(context)
  context.syncEditorFromWorkspace()
}

export function closeAllSavedTabs(context: TabLifecycleContext): void {
  createStateFromContext(context)
  getWorkbenchExplorerEditorService(context).closeSavedEditors()
  syncStateToContext(context)
  const toClose = context.getOpenFiles().filter((path) => !context.isDirty(path) && !context.pinnedTabs.has(path))
  for (const path of toClose) {
    context.workspace.closeFile(path)
  }
  context.syncEditorFromWorkspace()
}

export function togglePinTab(path: string, context: TabLifecycleContext): void {
  createStateFromContext(context)
  getWorkbenchExplorerEditorService(context).togglePinned(path)
  if (context.pinnedTabs.has(path)) {
    context.pinnedTabs.delete(path)
  } else {
    context.pinnedTabs.add(path)
  }
  syncStateToContext(context)
}

export function onTabDragStart(event: DragEvent, path: string, context: TabLifecycleContext): void {
  context.dragState.draggedTab = path
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = "move"
  event.dataTransfer.setData("text/plain", path)
}

export function onTabDragOver(event: DragEvent, path: string, context: TabLifecycleContext): void {
  if (context.dragState.draggedTab && context.dragState.draggedTab !== path) {
    context.setDragOverTab(path)
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move"
    }
  }
}

export function onTabDragLeave(context: TabLifecycleContext): void {
  context.setDragOverTab(null)
}

export function onTabDrop(targetPath: string, context: TabLifecycleContext): void {
  context.setDragOverTab(null)
  const draggedTab = context.dragState.draggedTab
  if (!draggedTab || draggedTab === targetPath) return
  const files = [...context.workspace.openFiles]
  const fromIdx = files.indexOf(draggedTab)
  const toIdx = files.indexOf(targetPath)
  if (fromIdx < 0 || toIdx < 0) return
  createStateFromContext(context)
  getWorkbenchExplorerEditorService(context).moveEditor(draggedTab, targetPath)
  syncStateToContext(context)
  files.splice(fromIdx, 1)
  files.splice(toIdx, 0, draggedTab)
  context.workspace.openFiles = files
  context.dragState.draggedTab = null
}

export function onTabDragEnd(context: TabLifecycleContext): void {
  context.setDragOverTab(null)
  context.dragState.draggedTab = null
}

async function closeDirtyAwareTab(path: string, context: TabLifecycleContext): Promise<boolean> {
  if (context.isDirty(path)) {
    const action = await showUnsavedDialog(path, context)
    if (action === "cancel") return false
    if (action === "save") {
      await context.saveFile(path)
    }
  }
  context.workspace.closeFile(path)
  return true
}

export async function reopenClosedTab(context: TabLifecycleContext): Promise<string | null> {
  createStateFromContext(context)
  const reopened = getWorkbenchExplorerEditorService(context).reopenClosedEditor()
  if (!reopened) return null
  syncStateToContext(context)
  if (context.openFile) await context.openFile(reopened.path)
  context.syncEditorFromWorkspace()
  return reopened.path
}

function createStateFromContext(context: TabLifecycleContext, openFiles = context.getOpenFiles()): EditorGroupState {
  const state = buildEditorGroupStateFromOpenFiles({
    openFiles,
    activeFile: context.getActiveFile?.() ?? null,
    pinnedTabs: context.pinnedTabs,
    dirtyFiles: context.isDirty,
    closedEditors: context.closedEditors,
  })
  getWorkbenchExplorerEditorService(context).replaceEditorGroupState(state)
  return state
}

function syncStateToContext(context: TabLifecycleContext): void {
  getWorkbenchExplorerEditorService(context).applyEditorGroupStateToTarget({
    setOpenFiles: (paths) => {
      context.workspace.openFiles = paths
    },
    setActiveFile: (path) => {
      context.setActiveFile?.(path)
    },
    pinnedTabs: context.pinnedTabs,
    closedEditors: context.closedEditors,
  })
}

function getWorkbenchExplorerEditorService(context: TabLifecycleContext): IWorkbenchExplorerEditorService {
  return context.workbenchExplorerEditorService || globalWorkbenchExplorerEditorService
}
