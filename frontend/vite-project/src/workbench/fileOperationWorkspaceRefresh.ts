import {
  getWorkspaceOperationRefreshPaths,
  isWorkspaceOperationPathAffected,
  type CodekWorkspaceFileOperationPayload,
  type NormalizeOperationPath,
} from "../vscode-adapter/workbench/contrib/files/fileOperationRefreshModel"
export {
  createWorkspaceOperationFileChangesEvent,
  getWorkspaceOperationFileChanges,
  getWorkspaceOperationRefreshPaths,
  normalizeWorkspaceOperationPath,
} from "../vscode-adapter/workbench/contrib/files/fileOperationRefreshModel"

export type WorkspaceFileOperationRefreshPayload = CodekWorkspaceFileOperationPayload

export interface WorkspaceFileOperationRefreshPlan {
  paths: string[]
  refreshExplorer: boolean
  activeFileAffected: boolean
}

export interface WorkspaceOperationRefreshSchedulerContext {
  getActiveFile: () => string | null | undefined
  getProjectRoot: () => string | null | undefined
  getFiles: () => Record<string, unknown>
  isDirty: (path: string) => boolean
  normalizePath?: NormalizeOperationPath
  refreshWorkspaceTree: () => Promise<unknown> | unknown
  refreshExplorerHost: () => Promise<unknown> | unknown
  applyFileOperationToExplorer?: (payload: WorkspaceFileOperationRefreshPayload) => boolean | Promise<boolean>
  reloadFile: (path: string) => Promise<unknown> | unknown
  syncEditorFromWorkspace: () => void
  refreshActiveAnalysis: (path: string) => Promise<unknown> | unknown
  refreshScmEditorDecorations: () => void
  refreshInlineDiff: (path: string | null) => void
  setDebugState?: (state: Record<string, unknown>) => void
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}

export interface WorkspaceOperationRefreshScheduler {
  schedule: (payload?: WorkspaceFileOperationRefreshPayload) => void
  cancel: () => void
}

export const WORKSPACE_OPERATION_STRUCTURAL_REFRESH_DELAY_MS = 40
export const WORKSPACE_OPERATION_UPDATE_REFRESH_DELAY_MS = 40

export function getWorkspaceOperationAnalysisPaths(
  payload: WorkspaceFileOperationRefreshPayload = {},
  normalizePath?: NormalizeOperationPath,
): string[] {
  const type = String(payload.type || "")
  if (type === "create_folder") return []
  return getWorkspaceOperationRefreshPaths(payload, normalizePath)
}

export function shouldRefreshExplorerForWorkspaceOperation(
  payload: WorkspaceFileOperationRefreshPayload = {},
): boolean {
  const type = String(payload.type || "")
  const action = String(payload.action || "")
  return (
    action === "create"
    || action === "delete"
    || action === "rename"
    || type === "create_file"
    || type === "create_folder"
    || type === "delete_file"
    || type === "rename_move"
  )
}

export function isActiveFileAffectedByWorkspaceOperation(
  activeFile: unknown,
  operationPaths: string[],
  normalizePath?: NormalizeOperationPath,
  payload?: WorkspaceFileOperationRefreshPayload,
): boolean {
  return isWorkspaceOperationPathAffected({
    targetPath: activeFile,
    operationPaths,
    normalizePath,
    payload,
  })
}

export function createWorkspaceOperationRefreshPlan(
  payload: WorkspaceFileOperationRefreshPayload = {},
  activeFile?: unknown,
  normalizePath?: NormalizeOperationPath,
): WorkspaceFileOperationRefreshPlan {
  const paths = getWorkspaceOperationRefreshPaths(payload, normalizePath)
  const editorPaths = getWorkspaceOperationAnalysisPaths(payload, normalizePath)
  return {
    paths,
    refreshExplorer: shouldRefreshExplorerForWorkspaceOperation(payload),
    activeFileAffected: isActiveFileAffectedByWorkspaceOperation(activeFile, editorPaths, normalizePath, payload),
  }
}

export function getWorkspaceOperationRefreshDelay(
  plan: Pick<WorkspaceFileOperationRefreshPlan, "refreshExplorer">,
): number {
  return plan.refreshExplorer
    ? WORKSPACE_OPERATION_STRUCTURAL_REFRESH_DELAY_MS
    : WORKSPACE_OPERATION_UPDATE_REFRESH_DELAY_MS
}

export function createWorkspaceOperationRefreshScheduler(
  context: WorkspaceOperationRefreshSchedulerContext,
): WorkspaceOperationRefreshScheduler {
  const setTimeoutFn = context.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = context.clearTimeoutFn ?? clearTimeout
  let timer: ReturnType<typeof setTimeout> | null = null
  let refreshPaths = new Set<string>()
  let analysisPaths = new Set<string>()
  let refreshExplorer = false
  let optimisticExplorerApplied = false

  const cancel = () => {
    if (timer) clearTimeoutFn(timer)
    timer = null
    refreshPaths = new Set()
    analysisPaths = new Set()
    refreshExplorer = false
    optimisticExplorerApplied = false
  }

  const schedule = (payload: WorkspaceFileOperationRefreshPayload = {}) => {
    const plan = createWorkspaceOperationRefreshPlan(payload, context.getActiveFile(), context.normalizePath)
    const refreshDelayMs = getWorkspaceOperationRefreshDelay(plan)
    for (const path of plan.paths) refreshPaths.add(path)
    for (const path of getWorkspaceOperationAnalysisPaths(payload, context.normalizePath)) analysisPaths.add(path)
    refreshExplorer = refreshExplorer || plan.refreshExplorer
    syncLoadedActiveFileForWorkspaceOperation(plan.paths, context, payload)
    if (plan.refreshExplorer) {
      void Promise.resolve(context.applyFileOperationToExplorer?.(payload)).then((applied) => {
        optimisticExplorerApplied = optimisticExplorerApplied || Boolean(applied)
        context.setDebugState?.({
          optimisticExplorerApplied,
          optimisticExplorerAppliedAt: Date.now(),
        })
      })
    }
    context.setDebugState?.({
      lastPayload: payload,
      lastPlan: plan,
      refreshDelayMs,
      optimisticExplorerApplied,
      scheduledAt: Date.now(),
    })

    if (timer) clearTimeoutFn(timer)
    timer = setTimeoutFn(async () => {
      const paths = Array.from(refreshPaths)
      const pathsForAnalysis = Array.from(analysisPaths)
      const shouldRefreshExplorer = refreshExplorer
      refreshPaths = new Set()
      analysisPaths = new Set()
      refreshExplorer = false
      timer = null

      context.setDebugState?.({
        optimisticExplorerApplied,
        optimisticExplorerConfirmedAt: Date.now(),
      })

      if (shouldRefreshExplorer && context.getProjectRoot()) {
        await context.refreshWorkspaceTree()
        context.setDebugState?.({
          refreshExplorerStartedAt: Date.now(),
          refreshPaths: paths,
        })
        await context.refreshExplorerHost()
        context.setDebugState?.({
          refreshExplorerFinishedAt: Date.now(),
          hasFileTreeRef: true,
        })
      }

      const activeFile = context.getActiveFile()
      if (isActiveFileAffectedByWorkspaceOperation(activeFile, pathsForAnalysis, context.normalizePath, payload) && activeFile) {
        const files = context.getFiles()
        if (typeof files[activeFile] === "string") {
          context.syncEditorFromWorkspace()
        } else if (!context.isDirty(activeFile)) {
          await context.reloadFile(activeFile)
          context.syncEditorFromWorkspace()
        }
      }

      for (const path of pathsForAnalysis) {
        void context.refreshActiveAnalysis(path)
      }
      context.refreshScmEditorDecorations()
      context.refreshInlineDiff(context.getActiveFile() || null)
    }, refreshDelayMs)
  }

  return { schedule, cancel }
}

function syncLoadedActiveFileForWorkspaceOperation(
  paths: string[],
  context: WorkspaceOperationRefreshSchedulerContext,
  payload?: WorkspaceFileOperationRefreshPayload,
): void {
  const activeFile = context.getActiveFile()
  if (!isActiveFileAffectedByWorkspaceOperation(activeFile, paths, context.normalizePath, payload) || !activeFile) return
  const files = context.getFiles()
  if (typeof files[activeFile] !== "string") return
  context.syncEditorFromWorkspace()
  context.refreshInlineDiff(activeFile)
}
