import { shouldRestoreWorkspace } from "../settings/windowSettings"
import { addRecentProject } from "../utils/recentProjects"
import * as ws from "../workspace/manager.js"
import { isRealFS } from "../workspace/manager.js"

interface WorkspaceLike {
  projectRoot?: string | null
  workspaceFile?: string | null
  workspaceRoots?: string[]
}

interface ProjectLifecycleContext {
  workspace: WorkspaceLike
  codek?: {
    getProjectRoot?: () => Promise<string | null | undefined>
    getWorkspaceState?: () => Promise<{ projectRoot?: string | null; workspaceFile?: string | null; workspaceRoots?: string[] }>
  } | null
  maybeSaveCurrentFile: () => Promise<boolean>
  resetTreeSelection: () => void
  syncEditorFromWorkspace: () => void
  clearSelectedSymbol: () => void
  loadWorkspaceSettings: (root: string) => void
  applyWorkbenchSettings: () => void
  applyEditorOptions: () => void
  openExplorerView: () => void
  refreshWorkspaceAnalysisRuntime: () => Promise<unknown>
  applyEditorDiagnostics: () => void
  startWorkspaceAiRuntime: (root: string | null | undefined) => void | Promise<void>
  scheduleWorkspaceWarmup?: (root: string | null | undefined) => void
  syncSessionAgentsProjectRoot: (root: string | null | undefined) => void
}

export async function openProjectFromDialog(context: ProjectLifecycleContext): Promise<boolean> {
  const saved = await context.maybeSaveCurrentFile()
  if (!saved) return false

  const ok = await ws.openProject()
  if (!ok) return false

  await finalizeProjectOpen(context, context.workspace.projectRoot)
  return true
}

export async function openRecentProject(path: string, context: ProjectLifecycleContext): Promise<boolean> {
  const saved = await context.maybeSaveCurrentFile()
  if (!saved) return false

  const ok = await ws.openProjectPath(path)
  if (!ok) return false

  await finalizeProjectOpen(context, context.workspace.projectRoot || path)
  return true
}

export async function restoreElectronWorkspace(context: ProjectLifecycleContext): Promise<boolean> {
  const state = await context.codek?.getWorkspaceState?.()
  const root = state?.projectRoot || await context.codek?.getProjectRoot?.()
  if (!root || !shouldRestoreWorkspace()) return false

  ws.applyWorkspaceState({
    projectRoot: root,
    workspaceFile: state?.workspaceFile || null,
    workspaceRoots: Array.isArray(state?.workspaceRoots) && state.workspaceRoots.length
      ? state.workspaceRoots
      : [root],
  })
  context.loadWorkspaceSettings(root)
  context.applyWorkbenchSettings()
  context.openExplorerView()
  isRealFS.value = true
  await ws.refreshFileTree()
  context.syncEditorFromWorkspace()
  context.applyEditorOptions()
  rememberProject(root)
  context.scheduleWorkspaceWarmup?.(root)
  context.syncSessionAgentsProjectRoot(root)
  return true
}

async function finalizeProjectOpen(context: ProjectLifecycleContext, root: string | null | undefined): Promise<void> {
  context.resetTreeSelection()
  context.openExplorerView()
  context.syncEditorFromWorkspace()
  context.clearSelectedSymbol()
  rememberProject(root)
  context.scheduleWorkspaceWarmup?.(root)
  context.syncSessionAgentsProjectRoot(context.workspace.projectRoot)
}

function rememberProject(path: string | null | undefined): void {
  if (!path) return
  const normalized = String(path).replace(/\\/g, "/").replace(/\/+$/, "")
  const name = basename(normalized) || normalized
  addRecentProject(name, normalized)
}

function basename(path: string): string {
  const normalized = String(path || "").replace(/\\/g, "/")
  return normalized.split("/").filter(Boolean).pop() || normalized
}
