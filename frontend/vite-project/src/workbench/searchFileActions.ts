import { openLocation } from "./navigationService"
import {
  areSearchRangesEqual,
  normalizeSearchSelectionRange,
  searchMatchRangeFromLocation,
} from "../vscode-adapter/workbench/contrib/search/searchMatchRange"
import { CodekReplaceService } from "../vscode-adapter/workbench/contrib/search/browser/replaceService"
import { CodekSearchWorkbenchService, createSearchWorkbenchOwnerEvidence } from "../vscode-adapter/workbench/contrib/search/searchWorkbenchService"
import { CodekBulkEditService, type BulkEditResult } from "../vscode-adapter/workbench/services/bulkEdit/common/bulkEditService"

interface EditorLike {
  getValue?: () => string
  getSelection?: () => {
    startLineNumber?: number
    startColumn?: number
    endLineNumber?: number
    endColumn?: number
    selectionStartLineNumber?: number
    selectionStartColumn?: number
    positionLineNumber?: number
    positionColumn?: number
  } | null
  setPosition?: (position: { lineNumber: number; column: number }) => void
  setSelection?: (selection: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }) => void
  revealLineInCenter?: (lineNumber: number) => void
  revealLineInCenterIfOutsideViewport?: (lineNumber: number) => void
  revealPosition?: (position: { lineNumber: number; column: number }) => void
  revealPositionInCenter?: (position: { lineNumber: number; column: number }) => void
  revealPositionInCenterIfOutsideViewport?: (position: { lineNumber: number; column: number }) => void
  revealRangeInCenter?: (range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }) => void
  revealRangeInCenterIfOutsideViewport?: (range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }) => void
  focus?: () => void
}

interface WorkspaceLike {
  activeFile: string | null
  files: Record<string, unknown>
}

interface WorkspaceManagerLike {
  getAllFiles: () => Record<string, unknown>
  updateFile: (path: string, content: string, options?: Record<string, unknown>) => void
  readProjectFile?: (path: string) => Promise<string | null>
  saveFile?: (path: string, content: string, options?: Record<string, unknown>) => Promise<boolean>
  getRelativePath: (path: string) => string
  isDirty: (path: string) => boolean
  markChangedExternally: (path: string) => void
  reloadFile: (path: string) => Promise<boolean>
  closeFile?: (path: string) => void
  refreshFileTree?: () => Promise<void>
  isBinaryEditorBlockedFile?: (path: string, content?: unknown) => boolean
  removeBinaryEditorState?: (path: string) => void
}

interface GrepMatch {
  line: number
  column?: number
  matchLength?: number
  text?: string
  occurrences?: Array<{ column: number; matchLength: number }>
}

interface GrepGroup {
  path: string
  content?: string
  matches: GrepMatch[]
}

interface SearchReplaceRunOptions {
  dryRun?: boolean
}

const SEARCH_OPEN_LOAD_TIMEOUT_MS = 1500
const SEARCH_OPEN_LOAD_POLL_MS = 16
const SEARCH_SELECTION_VERIFY_TIMEOUT_MS = 2500
const SEARCH_SELECTION_VERIFY_POLL_MS = 16
const SEARCH_SELECTION_STABLE_READS = 3
const SEARCH_SELECTION_REAPPLY_AFTER_MS = 96
const SEARCH_SELECTION_FINAL_STABLE_GRACE_MS = 250
const SEARCH_EDITOR_CONTENT_MOUNT_TIMEOUT_MS = 1500
const SEARCH_EDITOR_READY_TIMEOUT_MS = 10_000
const SEARCH_OPEN_FILE_TIMEOUT_MS = 5000
const SEARCH_READ_FILE_TIMEOUT_MS = 5000
const SEARCH_ACTIVE_FILE_SETTLE_TIMEOUT_MS = 1200
const SEARCH_ACTIVE_FILE_SETTLE_POLL_MS = 16

export interface SearchFileActionContext {
  workspace: WorkspaceLike
  workspaceManager: WorkspaceManagerLike
  getEditor: () => EditorLike | null
  getSearchQuery: () => string
  getReplaceQuery: () => string
  getGrepResults: () => GrepGroup[]
  createSearchPattern: () => RegExp | null
  openFile: (path: string) => Promise<boolean>
  syncEditorFromWorkspace: () => void
  refreshSearchResults: (query: string) => Promise<void>
  refreshActiveAnalysis: (path: string) => Promise<unknown>
  keepSearchViewActive?: () => void | Promise<void>
  showOpenError?: (message: string, path: string) => void
  ensureEditorReady?: (timeoutMs?: number) => Promise<boolean>
  prepareEditorRuntime?: (reason?: string) => void | Promise<void>
  reportNavigationStage?: (stage: string, detail?: Record<string, unknown>) => void
  openFileTimeoutMs?: number
  readProjectFileTimeoutMs?: number
}

export async function openFileAtLocation(
  path: string,
  location: { line: number; column?: number; matchLength?: number },
  context: SearchFileActionContext,
): Promise<void> {
  reportSearchNavigationStage(context, "open-file:load:start", { path, line: location.line, column: location.column })
  try {
    void context.prepareEditorRuntime?.("search-navigation")
  } catch (error) {
    reportSearchNavigationStage(context, "open-file:runtime-preload:error", {
      path,
      error: String((error as Error)?.message || error),
    })
  }
  const loaded = await ensureSearchResultFileLoaded(path, context)
  reportSearchNavigationStage(context, "open-file:load:done", { path, loaded })
  if (!loaded) {
    const message = `无法打开搜索结果：${path}。文件内容没有成功加载，已阻止空白编辑器状态。`
    context.showOpenError?.(message, path)
    throw new Error(message)
  }
  reportSearchNavigationStage(context, "open-file:mount:start", { path })
  const contentMounted = await ensureEditorContentMounted(path, context)
  reportSearchNavigationStage(context, "open-file:mount:done", { path, contentMounted })
  if (!contentMounted) {
    const message = `无法打开搜索结果：${path}。编辑器没有挂载真实文件内容，已阻止空白编辑器状态。`
    context.showOpenError?.(message, path)
    throw new Error(message)
  }

  reportSearchNavigationStage(context, "open-file:settle:start", { path })
  const activeFileSettled = await waitForActiveEditorContent(path, context)
  reportSearchNavigationStage(context, "open-file:settle:done", { path, activeFileSettled })
  if (!activeFileSettled) {
    const message = `无法打开搜索结果：${path}。编辑器活动文件仍在切换，已阻止错误定位。`
    context.showOpenError?.(message, path)
    throw new Error(message)
  }

  reportSearchNavigationStage(context, "open-location:start", { path, line: location.line, column: location.column, matchLength: location.matchLength })
  reportSearchNavigationStage(context, "owner:search-navigation", {
    path,
    line: location.line,
    column: location.column,
    matchLength: location.matchLength,
    ...createSearchFileActionOwnerEvidence(),
  })
  const opened = await openLocation(
    {
      path,
      line: location.line,
      column: location.column,
      matchLength: location.matchLength,
      reveal: "center",
    },
    {
      getEditor: context.getEditor,
      getActiveFile: () => context.workspace.activeFile,
      openFile: async () => true,
    },
  )
  reportSearchNavigationStage(context, "open-location:done", { path, opened })
  if (!opened || !hasLoadedEditorContent(path, context)) {
    const message = `无法打开搜索结果：${path}。文件内容没有成功加载，已阻止空白编辑器状态。`
    context.showOpenError?.(message, path)
    throw new Error(message)
  }
  reportSearchNavigationStage(context, "selection:start", { path, line: location.line, column: location.column, matchLength: location.matchLength })
  const selectionApplied = await ensureSearchSelectionApplied(location, context, path)
  reportSearchNavigationStage(context, "selection:done", { path, selectionApplied })
  if (!selectionApplied) {
    const message = `无法打开搜索结果：${path}。编辑器没有稳定跳转到匹配位置，已阻止错误定位。`
    context.showOpenError?.(message, path)
    throw new Error(message)
  }
  reportSearchNavigationStage(context, "keep-search-view:start", { path })
  await context.keepSearchViewActive?.()
  reportSearchNavigationStage(context, "keep-search-view:done", { path })
}

export async function openGrepMatch(path: string, match: GrepMatch | number, context: SearchFileActionContext): Promise<void> {
  const location = typeof match === "number" ? { line: match } : match
  await openFileAtLocation(path, location, context)
}

export async function replaceOne(context: SearchFileActionContext, options: SearchReplaceRunOptions = {}): Promise<BulkEditResult | null> {
  const replaceQuery = context.getReplaceQuery()
  const grepResults = context.getGrepResults()
  if (!replaceQuery || grepResults.length === 0) return null

  const firstGroup = grepResults[0]
  if (!firstGroup || firstGroup.matches.length === 0) return null

  const firstMatch = firstGroup.matches[0]
  const filePath = firstGroup.path

  const pattern = context.createSearchPattern()
  if (!pattern) return null

  const searchWorkbenchService = createSearchWorkbenchService(context)
  reportSearchNavigationStage(context, "owner:replace-preview", {
    mode: "one",
    fileCount: 1,
    matchCount: 1,
    ...createSearchFileActionOwnerEvidence(),
  })
  const preview = await searchWorkbenchService.previewReplace({
    mode: "one",
    request: {
      pattern,
      replaceText: replaceQuery,
      matches: [{ path: filePath, matches: [firstMatch] }],
    },
  })
  if (options.dryRun === true) return preview.result
  const result = await searchWorkbenchService.applyReplacePreview(preview)
  reportSearchNavigationStage(context, "owner:replace-apply", {
    mode: "one",
    changedFiles: result.summary.changedFiles,
    ...createSearchFileActionOwnerEvidence(),
  })
  if (!result.summary.changedFileCount) return result
  syncChangedSearchFiles(result.summary.changedFiles, context)

  await context.refreshSearchResults(context.getSearchQuery())
  await context.keepSearchViewActive?.()
  return result
}

export async function replaceAll(context: SearchFileActionContext, options: SearchReplaceRunOptions = {}): Promise<BulkEditResult | null> {
  const replaceQuery = context.getReplaceQuery()
  const grepResults = context.getGrepResults()
  if (!replaceQuery || grepResults.length === 0) return null

  const pattern = context.createSearchPattern()
  if (!pattern) return null

  const searchWorkbenchService = createSearchWorkbenchService(context)
  reportSearchNavigationStage(context, "owner:replace-preview", {
    mode: "all",
    fileCount: grepResults.length,
    matchCount: grepResults.reduce((count, group) => count + group.matches.length, 0),
    ...createSearchFileActionOwnerEvidence(),
  })
  const preview = await searchWorkbenchService.previewReplace({
    mode: "all",
    request: {
      pattern,
      replaceText: replaceQuery,
      matches: grepResults,
    },
  })
  if (options.dryRun === true) return preview.result
  const result = await searchWorkbenchService.applyReplacePreview(preview)
  reportSearchNavigationStage(context, "owner:replace-apply", {
    mode: "all",
    changedFiles: result.summary.changedFiles,
    ...createSearchFileActionOwnerEvidence(),
  })
  if (!result.summary.changedFileCount) return result
  syncChangedSearchFiles(result.summary.changedFiles, context)

  await context.refreshSearchResults(context.getSearchQuery())
  await context.keepSearchViewActive?.()
  return result
}

async function readSearchFileContent(path: string, context: SearchFileActionContext): Promise<string | null> {
  const cached = context.workspaceManager.getAllFiles()[path]
  if (typeof cached === "string") return cached
  if (context.workspaceManager.readProjectFile) {
    return withTimeout(
      context.workspaceManager.readProjectFile(path),
      context.readProjectFileTimeoutMs ?? SEARCH_READ_FILE_TIMEOUT_MS,
      `read project file ${path}`,
    )
  }
  return null
}

function hasLoadedEditorContent(path: string, context: SearchFileActionContext): boolean {
  const activeFile = context.workspace.activeFile
  if (activeFile !== path) return false
  return typeof context.workspace.files[path] === "string"
}

async function ensureSearchSelectionApplied(
  location: { line: number; column?: number; matchLength?: number },
  context: SearchFileActionContext,
  activePath: string,
): Promise<boolean> {
  const expected = searchMatchRangeFromLocation(location)
  if (!expected) return true

  const started = Date.now()
  const firstEditor = context.getEditor()
  if (!firstEditor?.setSelection) return false
  applySearchSelection(firstEditor, expected, context, "initial", started)

  let lastApplyAt = 0
  let stableReads = 0
  while (Date.now() - started <= SEARCH_SELECTION_VERIFY_TIMEOUT_MS) {
    const editor = context.getEditor()
    if (!editor?.setSelection) return false
    const now = Date.now()
    const currentSelection = readSearchSelection(editor, context, "verify")
    if (isSelectionEqual(currentSelection, expected)) {
      stableReads += 1
      if (stableReads >= SEARCH_SELECTION_STABLE_READS) {
        queueSearchSelectionReplay(expected, context, activePath, started)
        return true
      }
      await waitSearchSelectionStableRead()
      continue
    }
    stableReads = 0
    if (!lastApplyAt || now - lastApplyAt >= SEARCH_SELECTION_REAPPLY_AFTER_MS) {
      applySearchSelection(editor, expected, context, "retry", started)
      lastApplyAt = now
    }
    await delay(SEARCH_SELECTION_VERIFY_POLL_MS)
  }
  const finalStarted = Date.now()
  while (Date.now() - finalStarted <= SEARCH_SELECTION_FINAL_STABLE_GRACE_MS) {
    const editor = context.getEditor()
    if (!editor?.setSelection) return false
    const currentSelection = readSearchSelection(editor, context, "final-verify")
    if (isSelectionEqual(currentSelection, expected)) {
      stableReads += 1
      if (stableReads >= SEARCH_SELECTION_STABLE_READS) {
        queueSearchSelectionReplay(expected, context, activePath, started)
        return true
      }
      await waitSearchSelectionStableRead()
      continue
    }
    stableReads = 0
    await delay(SEARCH_SELECTION_VERIFY_POLL_MS)
  }
  return false
}

function applySearchSelection(
  editor: EditorLike,
  expected: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number },
  context: SearchFileActionContext,
  reason: string,
  started: number,
): boolean {
  reportSearchNavigationStage(context, "selection:apply", {
    reason,
    line: expected.startLineNumber,
    column: expected.startColumn,
    matchLength: expected.endColumn - expected.startColumn,
    elapsedMs: Date.now() - started,
  })
  try {
    editor.setSelection?.(expected)
    revealSearchMatch(editor, expected)
    editor.focus?.()
    return true
  } catch (error) {
    reportSearchNavigationStage(context, "selection:apply-error", {
      reason,
      error: String((error as Error)?.message || error),
    })
    return false
  }
}

function queueSearchSelectionReplay(
  expected: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number },
  context: SearchFileActionContext,
  activePath: string,
  started: number,
): void {
  const replay = (reason: string) => {
    if (context.workspace.activeFile !== activePath) return
    const editor = context.getEditor()
    if (!editor?.setSelection) return
    applySearchSelection(editor, expected, context, `replay:${reason}`, started)
  }
  setTimeout(() => replay("post-frame"), 32)
  setTimeout(() => replay("post-activation"), 120)
}

async function waitSearchSelectionStableRead(): Promise<void> {
  await Promise.resolve()
}

function revealSearchMatch(
  editor: EditorLike,
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number },
): void {
  if (editor.revealRangeInCenterIfOutsideViewport) {
    editor.revealRangeInCenterIfOutsideViewport(range)
    return
  }
  if (editor.revealRangeInCenter) {
    editor.revealRangeInCenter(range)
    return
  }
  const lineNumber = range.startLineNumber
  const column = range.startColumn
  const position = { lineNumber, column }
  if (editor.revealPositionInCenterIfOutsideViewport) {
    editor.revealPositionInCenterIfOutsideViewport(position)
    return
  }
  if (editor.revealLineInCenterIfOutsideViewport) {
    editor.revealLineInCenterIfOutsideViewport(lineNumber)
    return
  }
  if (editor.revealPositionInCenter) {
    editor.revealPositionInCenter(position)
    return
  }
  if (editor.revealPosition) {
    editor.revealPosition(position)
    return
  }
  editor.revealLineInCenter?.(lineNumber)
}

function reportSearchNavigationStage(
  context: SearchFileActionContext,
  stage: string,
  detail: Record<string, unknown> = {},
): void {
  context.reportNavigationStage?.(stage, detail)
}

export function createSearchFileActionOwnerEvidence(): ReturnType<typeof createSearchWorkbenchOwnerEvidence> & {
  readonly actionOwner: "SearchFileActions"
  readonly currentMatchOwner: "searchModel.resultTree"
  readonly openFileOwner: "navigationService.openLocation"
} {
  return {
    ...createSearchWorkbenchOwnerEvidence(),
    actionOwner: "SearchFileActions",
    currentMatchOwner: "searchModel.resultTree",
    openFileOwner: "navigationService.openLocation",
  }
}

function readSearchSelection(
  editor: EditorLike,
  context: SearchFileActionContext,
  reason: string,
): ReturnType<NonNullable<EditorLike["getSelection"]>> | null {
  try {
    return editor.getSelection?.() ?? null
  } catch (error) {
    reportSearchNavigationStage(context, "selection:read-error", {
      reason,
      error: String((error as Error)?.message || error),
    })
    return null
  }
}

function readEditorValue(editor: EditorLike, context: SearchFileActionContext, reason: string): string | null {
  try {
    return editor.getValue?.() ?? null
  } catch (error) {
    reportSearchNavigationStage(context, "open-file:editor-value-error", {
      reason,
      error: String((error as Error)?.message || error),
    })
    return null
  }
}

function isSelectionEqual(
  selection: ReturnType<NonNullable<EditorLike["getSelection"]>> | null | undefined,
  expected: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  },
): boolean {
  return areSearchRangesEqual(normalizeSearchSelectionRange(selection), expected)
}

async function waitForLoadedEditorContent(path: string, context: SearchFileActionContext): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started <= SEARCH_OPEN_LOAD_TIMEOUT_MS) {
    if (hasLoadedEditorContent(path, context)) return true
    await delay(SEARCH_OPEN_LOAD_POLL_MS)
  }
  return false
}

async function ensureSearchResultFileLoaded(path: string, context: SearchFileActionContext): Promise<boolean> {
  if (hasLoadedEditorContent(path, context)) return true

  const activeFile = context.workspace.activeFile
  const hasDirtyActiveFile = Boolean(activeFile && activeFile !== path && context.workspaceManager.isDirty(activeFile))
  if (!hasDirtyActiveFile) {
    reportSearchNavigationStage(context, "open-file:cached-direct-load:start", { path, activeFile })
    if (loadSearchResultFromContentCache(path, context)) {
      reportSearchNavigationStage(context, "open-file:cached-direct-load:done", {
        path,
        activeFile: context.workspace.activeFile,
        hasContent: typeof context.workspace.files[path] === "string",
      })
      return true
    }
    reportSearchNavigationStage(context, "open-file:cached-direct-load:miss", { path, activeFile })
  }

  if (!hasDirtyActiveFile && !context.getEditor()) {
    reportSearchNavigationStage(context, "open-file:cold-direct-load:start", { path, activeFile })
    if (await forceLoadSearchResultFile(path, context) || loadSearchResultFromWorkspaceCache(path, context)) {
      reportSearchNavigationStage(context, "open-file:cold-direct-load:done", { path, activeFile: context.workspace.activeFile })
      return true
    }
    reportSearchNavigationStage(context, "open-file:cold-direct-load:miss", { path, activeFile })
  }

  let opened = false
  try {
    reportSearchNavigationStage(context, "open-file:normal-open:start", { path, activeFile })
    opened = await withTimeout(
      context.openFile(path),
      context.openFileTimeoutMs ?? SEARCH_OPEN_FILE_TIMEOUT_MS,
      `open search result ${path}`,
    )
    reportSearchNavigationStage(context, "open-file:normal-open:done", {
      path,
      opened,
      activeFile: context.workspace.activeFile,
      hasContent: typeof context.workspace.files[path] === "string",
    })
  } catch (error) {
    reportSearchNavigationStage(context, "open-file:normal-open:error", {
      path,
      activeFile: context.workspace.activeFile,
      error: String((error as Error)?.message || error),
    })
    const activeFile = context.workspace.activeFile
    if (activeFile && context.workspaceManager.isDirty(activeFile)) {
      throw error
    }
  }
  if (opened && hasLoadedEditorContent(path, context)) return true

  const waited = opened && await waitForLoadedEditorContent(path, context)
  if (waited) return true
  if (!hasDirtyActiveFile) {
    reportSearchNavigationStage(context, "open-file:direct-load:start", { path, activeFile: context.workspace.activeFile })
    if (await forceLoadSearchResultFile(path, context) || loadSearchResultFromWorkspaceCache(path, context)) {
      reportSearchNavigationStage(context, "open-file:direct-load:done", { path, activeFile: context.workspace.activeFile })
      return true
    }
    reportSearchNavigationStage(context, "open-file:direct-load:miss", { path, activeFile: context.workspace.activeFile })
  }
  return false
}

function loadSearchResultFromContentCache(path: string, context: SearchFileActionContext): boolean {
  if (isSearchResultBinaryBlocked(path, context)) return false
  const targetDirty = context.workspaceManager.isDirty(path)
  const workspaceCached = getWorkspaceCachedContent(path, context)
  if (typeof workspaceCached === "string") {
    if (isSearchResultBinaryBlocked(path, context, workspaceCached)) return false
    activateCachedSearchResultFile(path, workspaceCached, context, targetDirty)
    return true
  }

  if (targetDirty) return false
  const searchCached = getSearchResultCachedContent(path, context)
  if (typeof searchCached !== "string") return false
  if (isSearchResultBinaryBlocked(path, context, searchCached)) return false
  activateCachedSearchResultFile(path, searchCached, context, false)
  return true
}

function getWorkspaceCachedContent(path: string, context: SearchFileActionContext): string | null {
  const workspaceContent = context.workspace.files[path]
  if (typeof workspaceContent === "string") return workspaceContent
  const managerContent = context.workspaceManager.getAllFiles()[path]
  return typeof managerContent === "string" ? managerContent : null
}

function getSearchResultCachedContent(path: string, context: SearchFileActionContext): string | null {
  const group = context.getGrepResults().find((item) => item.path === path)
  return typeof group?.content === "string" ? group.content : null
}

function activateCachedSearchResultFile(
  path: string,
  content: string,
  context: SearchFileActionContext,
  dirty: boolean,
): void {
  context.workspace.files[path] = content
  context.workspace.activeFile = path
  context.workspaceManager.updateFile(path, content, { dirty: !dirty ? false : true, external: false })
}

async function ensureEditorContentMounted(path: string, context: SearchFileActionContext): Promise<boolean> {
  if (!context.getEditor()) {
    reportSearchNavigationStage(context, "open-file:mount:ensure-ready:start", { path, timeoutMs: SEARCH_EDITOR_READY_TIMEOUT_MS })
    const editorReady = await context.ensureEditorReady?.(SEARCH_EDITOR_READY_TIMEOUT_MS)
    reportSearchNavigationStage(context, "open-file:mount:ensure-ready:done", {
      path,
      editorReady,
      editorValueLength: context.getEditor()?.getValue?.()?.length ?? null,
    })
    if (editorReady === false || !context.getEditor()) return false
  }

  const started = Date.now()
  let attempts = 0
  while (Date.now() - started <= SEARCH_EDITOR_CONTENT_MOUNT_TIMEOUT_MS) {
    attempts += 1
    reportSearchNavigationStage(context, "open-file:mount:sync", { path, attempts, elapsedMs: Date.now() - started })
    context.syncEditorFromWorkspace()
    reportSearchNavigationStage(context, "open-file:mount:sync:done", {
      path,
      attempts,
      elapsedMs: Date.now() - started,
      editorValueLength: context.getEditor()?.getValue?.()?.length ?? null,
    })
    if (hasMountedEditorContent(path, context)) return true
    await delay(SEARCH_OPEN_LOAD_POLL_MS)
  }
  reportSearchNavigationStage(context, "open-file:mount:timeout", {
    path,
    attempts,
    elapsedMs: Date.now() - started,
    editorValueLength: context.getEditor()?.getValue?.()?.length ?? null,
  })
  return false
}

function hasMountedEditorContent(path: string, context: SearchFileActionContext): boolean {
  if (!hasLoadedEditorContent(path, context)) return false
  const workspaceContent = context.workspace.files[path]
  if (typeof workspaceContent !== "string") return false
  const editor = context.getEditor()
  if (!editor?.getValue) return true
  return readEditorValue(editor, context, "mounted-content") === workspaceContent
}

async function forceLoadSearchResultFile(path: string, context: SearchFileActionContext): Promise<boolean> {
  const readProjectFile = context.workspaceManager.readProjectFile
  if (!readProjectFile) return false
  reportSearchNavigationStage(context, "open-file:force-read:start", { path })
  let content: string | null
  try {
    const contentPromise = Promise.resolve().then(() => readProjectFile(path))
    content = await withTimeout(
      contentPromise,
      context.readProjectFileTimeoutMs ?? SEARCH_READ_FILE_TIMEOUT_MS,
      `read project file ${path}`,
    )
  } catch (error) {
    reportSearchNavigationStage(context, "open-file:force-read:error", {
      path,
      error: String((error as Error)?.message || error),
    })
    throw error
  }
  reportSearchNavigationStage(context, "open-file:force-read:done", {
    path,
    contentType: typeof content,
    contentLength: typeof content === "string" ? content.length : null,
  })
  if (typeof content !== "string") return false
  if (isSearchResultBinaryBlocked(path, context, content)) return false
  reportSearchNavigationStage(context, "open-file:update-cache:start", { path })
  context.workspace.files[path] = content
  context.workspace.activeFile = path
  context.workspaceManager.updateFile(path, content, { dirty: false, external: false })
  reportSearchNavigationStage(context, "open-file:update-cache:done", { path, activeFile: context.workspace.activeFile })
  return true
}

function loadSearchResultFromWorkspaceCache(path: string, context: SearchFileActionContext): boolean {
  if (isSearchResultBinaryBlocked(path, context)) return false
  const cached = context.workspaceManager.getAllFiles()[path]
  if (typeof cached !== "string") return false
  if (isSearchResultBinaryBlocked(path, context, cached)) return false
  context.workspace.files[path] = cached
  context.workspace.activeFile = path
  context.workspaceManager.updateFile(path, cached, { dirty: false, external: false })
  return true
}

function isSearchResultBinaryBlocked(path: string, context: SearchFileActionContext, content?: unknown): boolean {
  if (!context.workspaceManager.isBinaryEditorBlockedFile?.(path, content)) return false
  reportSearchNavigationStage(context, "open-file:binary-blocked", {
    path,
    hasContentProbe: content !== undefined,
  })
  context.workspaceManager.removeBinaryEditorState?.(path)
  delete context.workspace.files[path]
  if (context.workspace.activeFile === path) context.workspace.activeFile = null
  context.showOpenError?.(`无法打开搜索结果：${path}。这是二进制文件，已阻止进入文本编辑器。`, path)
  return true
}

async function waitForActiveEditorContent(path: string, context: SearchFileActionContext): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started <= SEARCH_ACTIVE_FILE_SETTLE_TIMEOUT_MS) {
    if (hasMountedEditorContent(path, context)) return true
    context.syncEditorFromWorkspace()
    if (hasMountedEditorContent(path, context)) return true
    await delay(SEARCH_ACTIVE_FILE_SETTLE_POLL_MS)
  }
  return false
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function writeSearchFileContent(path: string, content: string, context: SearchFileActionContext): Promise<boolean | void> {
  if (context.workspaceManager.saveFile) {
    return context.workspaceManager.saveFile(path, content, {
      source: "user",
      reason: "search replace",
    })
  }
  context.workspaceManager.updateFile(path, content, { dirty: true, external: false })
}

function createSearchReplaceService(context: SearchFileActionContext): CodekReplaceService {
  const bulkEditService = new CodekBulkEditService({
    readFile: (path) => readSearchFileContent(path, context),
    saveFile: (path, content, options) => writeSearchFileContent(path, content, {
      ...context,
      workspaceManager: {
        ...context.workspaceManager,
        saveFile: context.workspaceManager.saveFile
          ? (targetPath: string, targetContent: string) => context.workspaceManager.saveFile!(targetPath, targetContent, options)
          : undefined,
      },
    }),
  })
  return new CodekReplaceService({
    bulkEditService,
    readFile: (path) => readSearchFileContent(path, context),
  })
}

function createSearchWorkbenchService(context: SearchFileActionContext): CodekSearchWorkbenchService {
  return new CodekSearchWorkbenchService({
    replaceService: createSearchReplaceService(context),
  })
}

function syncChangedSearchFiles(changedFiles: readonly string[], context: SearchFileActionContext): void {
  if (!changedFiles.includes(context.workspace.activeFile || "")) return
  context.syncEditorFromWorkspace()
}

export async function handleExternalFileChange(payload: { path?: string; type?: string } | null | undefined, context: SearchFileActionContext): Promise<void> {
  const relativePath = context.workspaceManager.getRelativePath(payload?.path || "")
  if (!relativePath || !Object.prototype.hasOwnProperty.call(context.workspace.files, relativePath)) return

  if (payload?.type === "unlink") {
    context.workspaceManager.closeFile?.(relativePath)
    await context.workspaceManager.refreshFileTree?.()
    return
  }

  if (context.workspaceManager.isDirty(relativePath)) {
    context.workspaceManager.markChangedExternally(relativePath)
    return
  }

  const reloaded = await context.workspaceManager.reloadFile(relativePath)
  if (!reloaded) return

  if (context.workspace.activeFile === relativePath) {
    context.syncEditorFromWorkspace()
  }
  await context.refreshActiveAnalysis(relativePath)
}
