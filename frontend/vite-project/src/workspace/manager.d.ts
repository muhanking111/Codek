import type { ShallowRef } from "vue"

/** 文件树节点（简化类型，便于 TS 收窄） */
export interface FileTreeNode {
  name: string
  path: string
  isDir: boolean
  rootPath?: string
  rootLabel?: string
  children?: FileTreeNode[]
  open?: boolean
  size?: number
  oversized?: boolean
  ignored?: boolean
  virtual?: boolean
  truncated?: boolean
  limitReason?: string
  loaded?: boolean
  loading?: boolean
  loadError?: string
}

export interface FileTreeStats {
  nodeCount: number
  truncated: boolean
  ignoredCount: number
}

export interface LargeFileNotice {
  path: string
  size: number
  limit: number
  previewBytes?: number
  offset?: number
  windowBytes?: number
  hasPrevious?: boolean
  hasNext?: boolean
  virtualStartLine?: number
  sourceStartLine?: number
  fileVersionHash?: string | null
  fullWindowHash?: string | null
  displayBytes?: number
  displayHash?: string | null
  displayTransformed?: boolean
  sourceLineAdvance?: number
  renderedLineAdvance?: number
  renderedLineCount?: number
  mode?: "range" | "optimized"
  readOnly?: boolean
  truncated?: boolean
  reason: string
}

export interface LargeFileRangeState extends LargeFileNotice {
  mode: "range"
  readOnly: boolean
  truncated: boolean
}

export interface LargeFileOptimizedState extends LargeFileNotice {
  mode: "optimized"
  readOnly: boolean
  truncated: false
}

export type LargeFileState = LargeFileRangeState | LargeFileOptimizedState

export interface PendingWorkingCopyRestoration {
  path: string
  resource: string
  typeId?: string
  state: "dirty" | "conflict" | "orphan"
  choices: Array<"restore" | "discard" | "openAsConflict" | "openAsOrphan">
  meta?: Record<string, unknown>
  backupContentHash?: string
  diskContentHash?: string | null
}

export interface WorkingCopyRestoreAction {
  id: "restore" | "discard" | "openAsConflict" | "openAsOrphan"
  label: string
  description: string
  enabled: boolean
}

export interface WorkingCopyRestoreActionState {
  path: string
  resource: string
  state: PendingWorkingCopyRestoration["state"]
  message: string
  primaryAction: WorkingCopyRestoreAction | null
  actions: WorkingCopyRestoreAction[]
  backupContentHash?: string
  diskContentHash?: string | null
}

export interface EditorTabState {
  path: string
  dirty: boolean
  saving: boolean
  conflict: boolean
  orphan: boolean
  backupRestored: boolean
  badge: "dirty" | "saving" | "conflict" | "orphan" | "backup-restored" | null
  titleDecoration: EditorTabState["badge"]
  labelSuffix: string
  state: "saved" | "dirty" | "pendingSave" | "conflict" | "orphan" | "error"
  largeFileRange: boolean
}

export interface WorkingCopyHotExitStatus {
  phase: "backup" | "backupJoin" | "backupSkipped" | "restoreChoices" | "restoreChoicesUnavailable" | "restoreAttempt" | "backupCleanup" | "closeGuard" | "shutdownRisk"
  source?: string
  reason?: string
  error?: string
  timeoutMs?: number
  backedUp?: string[]
  kept?: string[]
  removed?: string[]
  cleanupOwner?: {
    source: string
    backupOwner: string
    dirtySource: string
    stateSource: string
    status: "connected" | "partial"
    blockedReason?: string
  }
  cleanupPolicy?: {
    keepDirty: boolean
    exceptCount: number
    hasCustomKeep: boolean
    readonly: true
    safeCleanup: true
  }
  cleanupDecisions?: Array<{
    path: string
    resource: string
    typeId: string
    decision: "keep" | "remove"
    reason: "explicitKeep" | "activeDirtyWorkingCopy" | "customKeepPolicy" | "staleBackup"
    readonly: true
    safeCleanup: true
    blockedReason?: string
  }>
  action?: WorkingCopyRestoreAction["id"] | "close" | "shutdown" | "save" | "revert"
  allowed?: boolean
  cancelled?: boolean
  restored?: string[]
  failed?: string[]
  failureCause?: string
  workspaceRoot?: string | null
  backupArtifactPaths?: string[]
  backupJoin?: {
    id: string
    label: string
    completed: boolean
    source?: string
    backedUp?: string[]
  }
  evidencePath?: string
  risk?: "none" | "dirty-working-copy" | "pending-backup" | "backup-unavailable" | "renderer-unavailable"
  dirtyCount?: number
  pending?: Array<{
    path: string
    state: PendingWorkingCopyRestoration["state"]
    choices: PendingWorkingCopyRestoration["choices"]
  }>
  dirty?: Array<{
    path: string
    state: string
    backedUp: boolean
    backupContentHash?: string
    diskContentHash?: string | null
  }>
  timestamp: number
}

export interface WorkspaceState {
  files: Record<string, unknown>
  activeFile: string | null
  projectRoot: string | null
  workspaceFile: string | null
  workspaceRoots: string[]
  workspaceRootLabels: Record<string, string>
  workspaceScaleProfile: unknown | null
  fileTree: FileTreeNode[]
  openFiles: string[]
  readonly dirtyFiles: Readonly<Record<string, unknown>>
  readonly externalChanges: Readonly<Record<string, unknown>>
  fileTreeStats: FileTreeStats
  largeFileNotice: LargeFileNotice | null
  largeFiles: Record<string, LargeFileState>
  pendingWorkingCopyRestorations: PendingWorkingCopyRestoration[]
  workingCopyRestoreActions: WorkingCopyRestoreActionState[]
  workingCopyRestoredBackups: Record<string, {
    state: PendingWorkingCopyRestoration["state"]
    restoredAt: number
    backupContentHash?: string
  }>
  editorTabStates: Record<string, EditorTabState>
  workingCopyHotExitStatus: WorkingCopyHotExitStatus | null
}

export const MAX_EDITABLE_FILE_BYTES: number
export const LARGE_FILE_OPTIMIZATION_BYTES: number
export const LARGE_FILE_WINDOWING_BYTES: number
export const LARGE_FILE_IPC_CHUNK_BYTES: number
export const LARGE_FILE_EDITOR_RENDER_BYTES: number
export const LARGE_FILE_SAFE_RENDER_LINE_CHARS: number
export const LARGE_FILE_SAFE_RENDER_LINES_PER_WINDOW: number
export const workspace: WorkspaceState
export const isRealFS: ShallowRef<boolean>
export function resetTextFileStates(): void
export function removeTextFileStateForPath(pathValue: unknown): void

export interface WorkspaceRootInfo {
  root: string
  label: string
}

export interface WorkspaceSearchResult {
  path: string
  root: string
  rootLabel: string
  score?: number
  snippet?: string
}

export interface WorkspaceTextSearchOptions {
  include?: string[]
  exclude?: string[]
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
  maxResults?: number
  searchLargeFiles?: boolean
  searchMaxFileBytes?: number
  includeContentForSmallFiles?: boolean
  contentMaxFileBytes?: number
  contentMaxTotalBytes?: number
}

export interface WorkspaceTextMatch {
  path: string
  line: number
  column: number
  matchLength: number
  preview: string
  root?: string
  rootLabel?: string
}

export interface WorkspaceTextSearchResult {
  matches: WorkspaceTextMatch[]
  truncated: boolean
  fileContents?: Record<string, string>
}

export interface WorkspaceFileOperationOptions {
  recordOperation?: boolean
  source?: string
  agentId?: string | null
  runId?: string | null
  reason?: string
  saveReason?: number
  saveSource?: string
  openAfterCreate?: boolean
  force?: boolean
  ignoreModifiedSince?: boolean
  overwrite?: boolean
  allowInMemorySegmentPatch?: boolean
  fullContent?: string
}

export function normalizeRelativePath(pathValue: string): string
export function applyWorkspaceState(result: {
  projectRoot: string
  workspaceFile?: string | null
  workspaceRoots?: string[]
}, options?: {
  preserveProfile?: boolean
}): void
export function getWorkspaceRootInfo(pathValue: string): WorkspaceRootInfo | null
export function openProject(): Promise<boolean>
export function openProjectPath(dir: string): Promise<boolean>
export function openWorkspaceFile(): Promise<boolean>
export function addFolderToWorkspace(): Promise<boolean>
export function saveWorkspaceAs(): Promise<boolean>
export function refreshFileTree(): Promise<void>
export function getOpenFiles(): string[]
export function restoreOpenFiles(paths?: string[], activePath?: string | null): Promise<void>
export function getLargeFileState(pathValue: string): LargeFileState | null
export function normalizeLargeFilePreviewContent(content: string): string
export function isBinaryEditorBlockedFile(pathValue: string, content?: unknown): boolean
export function removeBinaryEditorState(pathValue: string): void
export function loadLargeFileWindow(pathValue: string, offset: number): Promise<boolean>
export function loadNextLargeFileWindow(pathValue: string): Promise<boolean>
export function loadPreviousLargeFileWindow(pathValue: string): Promise<boolean>
export function isReadOnlyFile(pathValue: string): boolean
export function canEditLargeFileSegment(pathValue: string): boolean
export function canUndoLargeFileSegmentEdit(pathValue: string): boolean
export function canRedoLargeFileSegmentEdit(pathValue: string): boolean
export function isDirty(pathValue: string): boolean
export function hasExternalChange(pathValue: string): boolean
export function getTextFileStateName(pathValue: string): "saved" | "dirty" | "pendingSave" | "conflict" | "orphan" | "error"
export function isTextFileState(pathValue: string, stateName: "saved" | "dirty" | "pendingSave" | "conflict" | "orphan" | "error"): boolean
export function markChangedExternally(pathValue: string): void
export function clearExternalChange(pathValue: string): void
export function markClean(pathValue: string): void
export function addTextFileSaveParticipant(participant: unknown): { dispose(): void }
export interface WorkspaceEditingSaveParticipantStep {
  ordinal: number
  index: number
  status: "ran" | "skipped" | "failed"
  error?: string
}
export interface WorkspaceEditingSaveEvidence {
  path: string
  resource: string
  phase: "saved" | "saveFailed"
  success: boolean
  state: "saved" | "dirty" | "pendingSave" | "conflict" | "orphan" | "error"
  dirty: boolean
  external: boolean
  reason: number
  source: string
  beforeContentHash: string | null
  requestedContentHash: string
  afterContentHash: string | null
  participant: {
    participantCount: number
    failed: boolean
    cancelled: boolean
    error?: string
    steps: WorkspaceEditingSaveParticipantStep[]
  }
}
export function getWorkspaceEditingSaveEvidence(): WorkspaceEditingSaveEvidence | null
export function backupDirtyWorkingCopies(paths?: string[]): Promise<string[]>
export function backupDirtyWorkingCopiesForLifecycle(source?: string): Promise<string[]>
export function refreshWorkingCopyRestorations(): Promise<PendingWorkingCopyRestoration[]>
export function getWorkingCopyRestoreActions(pathValue?: string | null): WorkingCopyRestoreActionState[]
export function getEditorTabState(pathValue: string): EditorTabState | null
export function applyWorkingCopyRestoration(
  pathValue: string,
  action?: "restore" | "discard" | "openAsConflict" | "openAsOrphan",
): Promise<boolean>
export function restoreWorkingCopyBackups(): Promise<string[]>
export function cleanupWorkingCopyBackups(options?: {
  keepPaths?: string[]
  keepDirty?: boolean
  source?: string
  uiOwnerConnected?: boolean
  uiOwnerBlockedReason?: string
}): Promise<string[]>
export function resolveTextFileConflict(
  pathValue: string,
  content?: string,
  options?: WorkspaceFileOperationOptions,
): Promise<boolean>
export function restoreOrphanedTextFile(
  pathValue: string,
  content?: string,
  options?: WorkspaceFileOperationOptions,
): Promise<boolean>
export function closeFile(pathValue: string): void
export function requestCloseFile(pathValue: string, options?: { force?: boolean; source?: string }): boolean
export function buildWorkingCopyHotExitEvidence(source?: string): WorkingCopyHotExitStatus
export function getWorkingCopyHotExitEvidence(): WorkingCopyHotExitStatus | null
export function openVirtualTextResource(
  pathValue: string,
  content: string,
  options?: { dirty?: boolean },
): boolean
export function openFile(pathValue: string): Promise<boolean>
export function readProjectFile(pathValue: string): Promise<string | null>
export function reloadFile(pathValue: string): Promise<boolean>
export function saveFile(pathValue: string, content: string, options?: WorkspaceFileOperationOptions): Promise<boolean>
export function undoLargeFileSegmentEdit(pathValue: string, options?: WorkspaceFileOperationOptions): Promise<boolean>
export function redoLargeFileSegmentEdit(pathValue: string, options?: WorkspaceFileOperationOptions): Promise<boolean>
export function deleteFile(pathValue: string, options?: WorkspaceFileOperationOptions): Promise<boolean>
export function renameEntry(
  oldPathValue: string,
  newPathValue: string,
  options?: WorkspaceFileOperationOptions,
): Promise<boolean>
export function copyEntry(pathValue: string): boolean
export function cutEntry(pathValue: string): boolean
export function pasteEntry(targetDirValue: string): Promise<string | null>
export function addFile(pathValue: string, content?: string): void
export function createFile(
  relativePath: string,
  content?: string,
  options?: WorkspaceFileOperationOptions,
): Promise<boolean>
export function createDir(relativePath: string, options?: WorkspaceFileOperationOptions): Promise<boolean>
export function updateFile(pathValue: string, content: string, options?: Record<string, unknown>): void
export function revealPath(pathValue: string): Promise<boolean>
export function showItemInFolder(pathValue: string): Promise<boolean>
export function getFile(pathValue: string): unknown | undefined
export function getAllFiles(): Record<string, unknown>
export function getRelativePath(fullPath: string): string
export function readLines(
  pathValue: string,
  startLine?: number,
  endLine?: number,
): Promise<{ content: string; totalLines: number } | null>
export function searchTextInProject(
  query: string,
  options?: WorkspaceTextSearchOptions,
): Promise<WorkspaceTextSearchResult | null>
export function findInProject(
  query: string,
  options?: Record<string, unknown>,
): Promise<WorkspaceSearchResult[]>
