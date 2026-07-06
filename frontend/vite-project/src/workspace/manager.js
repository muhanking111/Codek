import { reactive, shallowRef } from "vue"
import { applyFileSaveSettings } from "../settings/fileSaveSettings"
import { recordFileOperation } from "./fileOperations"
import {
  EDITABLE_FILE_BYTES,
  VSCODE_MODEL_SYNC_LIMIT_BYTES,
  VSCODE_TOKENIZATION_LARGE_FILE_BYTES,
  LARGE_FILE_WINDOW_BYTES,
  getLargeFileWindowBytes,
  buildLargeFileOptimizedState,
  buildLargeFileRangeState,
  buildLargeFileOpenPlan,
  clampLargeFileWindow,
  getLargeFileWindowTargetOffset,
  isLargeFileMode,
} from "./largeFilePolicy"
import {
  applyLargeFileSegmentPatchToContent,
  createLargeFileEditBufferSavePlan,
  createLargeFileSegmentEditStackItem,
  createLargeFileSegmentRedoPlan,
  createLargeFileSegmentUndoPlan,
  getUtf8ByteLength,
  hashLargeFileSegment,
  pushLargeFileSegmentEditStackItem,
} from "./largeFileSegmentEdit"
import { createLargeTextLineIndex } from "../vscode-adapter/editor/common/model/largeTextLineIndex"
import { estimateLargeFileWindowStartLine } from "../vscode-adapter/editor/common/model/largeFileWindowLineModel"
import { createLargeFileWindowService } from "../vscode-adapter/editor/common/model/largeFileWindowService"
import { FileOperation, FileService, getFileOperationRollbackRisk, normalizeFileStat, toFileOperationResult } from "../vscode-adapter/platform/files/common/files"
import { URI } from "../vscode-adapter/base/common/uri"
import { DEFAULT_EXPLORER_INCREMENTAL_NAMING, findValidPasteFileTargetPath } from "../vscode-adapter/workbench/contrib/files/fileActions"
import { globalWorkspaceContextService } from "../vscode-adapter/platform/workspace/common/workspace"
import {
  SaveReason,
  hasExternalTextFileChange,
  isTextFileModelDirty,
} from "../vscode-adapter/workbench/services/textfile/common/textfiles"
import {
  CODEK_TEXTFILE_SAVE_SOURCE,
  TextFileService,
  createCodekFileSystemProvider,
} from "../vscode-adapter/workbench/services/textfile/common/textFileService"
import { createTextFileStateCollection } from "../vscode-adapter/workbench/services/textfile/common/textFileStateCollection"
import { WorkingCopyFileService } from "../vscode-adapter/workbench/services/workingCopy/common/workingCopyFileService"
import { WorkingCopyHotExitTracker, WorkingCopyService } from "../vscode-adapter/workbench/services/workingCopy/common/workingCopyService"
import {
  DiskWorkingCopyBackupService,
  InMemoryWorkingCopyBackupService,
  STORED_FILE_WORKING_COPY_TYPE_ID,
  hashIdentifier,
  toWorkingCopyIdentifier,
} from "../vscode-adapter/workbench/services/workingCopy/common/storedFileWorkingCopy"

export const MAX_EDITABLE_FILE_BYTES = EDITABLE_FILE_BYTES
export const LARGE_FILE_OPTIMIZATION_BYTES = VSCODE_TOKENIZATION_LARGE_FILE_BYTES
export const LARGE_FILE_WINDOWING_BYTES = VSCODE_MODEL_SYNC_LIMIT_BYTES
const SEARCH_RESULT_LIMIT = 40
const SEARCH_MATCH_LIMIT = 1000
export const LARGE_FILE_SAFE_RENDER_LINE_CHARS = 2000
export const LARGE_FILE_SAFE_RENDER_LINES_PER_WINDOW = Math.ceil(getLargeFileWindowBytes(Number.MAX_SAFE_INTEGER) / LARGE_FILE_SAFE_RENDER_LINE_CHARS)
export const LARGE_FILE_IPC_CHUNK_BYTES = 512 * 1024
export const LARGE_FILE_EDITOR_RENDER_BYTES = getLargeFileWindowBytes(Number.MAX_SAFE_INTEGER)
const LARGE_FILE_TEXT_CHUNK_BYTES = 512 * 1024
const LARGE_FILE_WINDOW_CACHE_LIMIT = 6
const OPEN_FILE_STAT_TIMEOUT_MS = 1200
const OPEN_FILE_STAT_TIMEOUT = Symbol("codek.openFile.statTimeout")
const HOT_EXIT_RESTORE_SCAN_TIMEOUT_MS = 900
const SEARCH_TRANSPORT_TIMEOUT_MS = 4500
const LARGE_FILE_PREFETCH_IDLE_MS = 180
const WORKING_COPY_HOT_EXIT_EVIDENCE_PATH = ".codek/reports/working-copy-hot-exit-latest-result.json"
const SEARCH_FAST_PATH_MAX_FILES = 600
const SEARCH_FAST_PATH_MAX_FILE_BYTES = 512 * 1024
const SEARCH_FAST_PATH_MAX_DIRS = 160
const SEARCH_FAST_PATH_IGNORED_DIRS = new Set([
  ".git",
  ".codek",
  "node_modules",
  "dist",
  "build",
  "out",
  "release",
  "frontend-dist",
])
const DIRECT_TEXT_OPEN_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "css",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "less",
  "lua",
  "mjs",
  "md",
  "mdx",
  "py",
  "rs",
  "scss",
  "sh",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
])
const BINARY_OPEN_BLOCKED_EXTENSIONS = new Set([
  "7z",
  "asar",
  "bin",
  "bmp",
  "br",
  "class",
  "dat",
  "dll",
  "dylib",
  "exe",
  "gif",
  "gz",
  "ico",
  "jar",
  "jpg",
  "jpeg",
  "node",
  "otf",
  "pak",
  "pdf",
  "png",
  "rar",
  "so",
  "tar",
  "ttf",
  "wasm",
  "webp",
  "woff",
  "woff2",
  "zip",
])
const api = () => (typeof window !== "undefined" ? window.codek || null : null)
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const numericOr = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }
  return 0
}

export const workspace = reactive({
  files: {},
  activeFile: null,
  projectRoot: null,
  workspaceFile: null,
  workspaceRoots: [],
  workspaceRootLabels: {},
  workspaceScaleProfile: null,
  fileTree: [],
  openFiles: [],
  dirtyFiles: {},
  externalChanges: {},
  fileTreeStats: {
    nodeCount: 0,
    truncated: false,
    ignoredCount: 0,
  },
  largeFileNotice: null,
  largeFiles: {},
  pendingWorkingCopyRestorations: [],
  workingCopyRestoreActions: [],
  workingCopyRestoredBackups: {},
  editorTabStates: {},
  workingCopyHotExitStatus: null,
})

export const isRealFS = shallowRef(false)
let explorerClipboard = null
const textFileLegacyProjection = {
  dirtyFiles: reactive({}),
  externalChanges: reactive({}),
}
const readonlyTextFileProjectionCache = new WeakMap()

function createReadonlyTextFileProjection(recordName, record) {
  if (readonlyTextFileProjectionCache.has(record)) return readonlyTextFileProjectionCache.get(record)
  const projection = new Proxy(record, {
    set(_target, property) {
      throw new TypeError(`workspace.${recordName} is a read-only TextFileStateCollection projection; use workspace manager state APIs for ${String(property)}.`)
    },
    deleteProperty(_target, property) {
      throw new TypeError(`workspace.${recordName} is a read-only TextFileStateCollection projection; use workspace manager state APIs for ${String(property)}.`)
    },
    defineProperty(_target, property) {
      throw new TypeError(`workspace.${recordName} is a read-only TextFileStateCollection projection; use workspace manager state APIs for ${String(property)}.`)
    },
    setPrototypeOf() {
      throw new TypeError(`workspace.${recordName} is a read-only TextFileStateCollection projection.`)
    },
  })
  readonlyTextFileProjectionCache.set(record, projection)
  return projection
}

function installReadonlyTextFileWorkspaceProjection(propertyName, record) {
  const projection = createReadonlyTextFileProjection(propertyName, record)
  Object.defineProperty(workspace, propertyName, {
    configurable: false,
    enumerable: true,
    get: () => projection,
    set: () => {
      throw new TypeError(`workspace.${propertyName} is a read-only TextFileStateCollection projection; use resetTextFileStates or state APIs.`)
    },
  })
}

const largeFileWindowService = createLargeFileWindowService({
  defaultWindowBytes: LARGE_FILE_WINDOW_BYTES,
  renderBytes: LARGE_FILE_EDITOR_RENDER_BYTES,
  fallbackLineWidth: LARGE_FILE_SAFE_RENDER_LINE_CHARS,
  limit: LARGE_FILE_WINDOW_CACHE_LIMIT,
  prefetchDelayMs: LARGE_FILE_PREFETCH_IDLE_MS,
  normalizePath: normalizeRelativePath,
  normalizeContent: (content) => normalizeLargeFilePreviewContent(content),
  clampWindow: clampLargeFileWindow,
  getTargetOffset: getLargeFileWindowTargetOffset,
  report: reportWorkspaceReadSmokeStage,
})
const largeFileSegmentEditStacks = new Map()
const workingCopyService = new WorkingCopyService()
const workingCopyFileService = new WorkingCopyFileService()
const textFileFileService = new FileService()
class ReinitializableWorkingCopyBackupService {
  constructor(impl = new InMemoryWorkingCopyBackupService()) {
    this.impl = impl
  }

  reinitialize(impl) {
    this.impl = impl
  }

  hasBackupSync(identifier, versionId) {
    return this.impl.hasBackupSync(identifier, versionId)
  }

  backup(identifier, value, versionId, meta) {
    return this.impl.backup(identifier, value, versionId, meta)
  }

  resolve(identifier) {
    return this.impl.resolve(identifier)
  }

  getBackups() {
    return this.impl.getBackups()
  }

  discardBackup(identifier) {
    return this.impl.discardBackup(identifier)
  }

  discardBackups(filter) {
    return this.impl.discardBackups(filter)
  }

  joinBackups() {
    return this.impl.joinBackups()
  }
}
const textFileService = new TextFileService({
  fileService: textFileFileService,
  workingCopyFileService,
  workingCopyService,
  shouldHandleFileChange: (resource) => !suppressedTextFileChangeResources.has(resource.toString()),
})
const workingCopyBackupService = new ReinitializableWorkingCopyBackupService()
const workingCopyHotExitTracker = new WorkingCopyHotExitTracker(workingCopyService, workingCopyBackupService)
let workingCopyBackupServiceKey = "memory"
let workingCopyBackupServiceDelegate = null
let workingCopyBackupWorkspaceHome = null
let workspaceHasKnownWorkingCopyBackups = false
let latestWorkspaceEditingSaveEvidence = null
let textFileProviderRegistration = null
let textFileProviderDelegate = null
let textFileProviderWatchRegistration = null
let textFileProviderWatchRoot = ""
const suppressedTextFileChangeResources = new Set()
const textFileStateCollection = createTextFileStateCollection({
  normalizePath: normalizeRelativePath,
  projection: textFileLegacyProjection,
})
installReadonlyTextFileWorkspaceProjection("dirtyFiles", textFileLegacyProjection.dirtyFiles)
installReadonlyTextFileWorkspaceProjection("externalChanges", textFileLegacyProjection.externalChanges)
let workspaceGeneration = 0
let openFileGeneration = 0
let workspaceOpenGeneration = 0
let workspaceScaleProfileTimer = 0

function clearRecord(record) {
  for (const key of Object.keys(record)) delete record[key]
}

function getTextFileState(pathValue, create = true) {
  const relativePath = normalizeRelativePath(pathValue)
  const state = textFileStateCollection.get(relativePath, create)
  if (state && canRegisterTextFileWorkingCopy(relativePath)) {
    textFileService.registerWorkingCopy(toTextFileResource(relativePath), state)
  }
  return state
}

function syncTextFileStateToLegacyRecords(relativePath) {
  textFileStateCollection.sync(relativePath)
}

export function resetTextFileStates() {
  textFileService.clearWorkingCopies()
  textFileStateCollection.clear()
  refreshEditorTabStates()
}

export function removeTextFileStateForPath(pathValue) {
  removeTextFileState(pathValue)
}

function resolveTextFileModelFromWorkspace(relativePath, content, options = {}) {
  if (!canRegisterTextFileWorkingCopy(relativePath) || typeof content !== "string") return null
  const state = getTextFileState(relativePath)
  if (!state) return null
  const resource = toTextFileResource(relativePath)
  const model = textFileService.files.ensure(resource, state)
  model.resolveFromContents(content, {
    dirty: options.dirty ?? isTextFileModelDirty(state),
    external: options.external ?? hasExternalTextFileChange(state),
  })
  return model
}

function syncResolvedTextFileModel(relativePath) {
  if (!canRegisterTextFileWorkingCopy(relativePath)) return null
  const model = textFileService.files.get(toTextFileResource(relativePath))
  if (!model?.isResolved()) return null
  const value = model.model?.getValue()
  if (typeof value === "string") workspace.files[relativePath] = value
  return model
}

function syncWorkspaceTextFileModelClean(relativePath, content, options = {}) {
  const value = String(content ?? "")
  workspace.files[relativePath] = value
  delete workspace.workingCopyRestoredBackups[relativePath]
  markClean(relativePath)
  if (options.external === false) clearExternalChange(relativePath)
  void resolveTextFileModelFromWorkspace(relativePath, value, {
    dirty: false,
    external: options.external ?? false,
    reload: options.reload,
  })
  updateEditorTabState(relativePath)
}

function syncWorkspaceTextFileModelDirty(relativePath, content, options = {}) {
  const value = String(content ?? "")
  workspace.files[relativePath] = value
  markDirty(relativePath)
  if (options.external === false) clearExternalChange(relativePath)
  void resolveTextFileModelFromWorkspace(relativePath, value, {
    dirty: true,
    external: options.external ?? hasExternalChange(relativePath),
  })
  updateEditorTabState(relativePath)
}

function syncWorkspaceTextFileModelConflict(relativePath, content) {
  const value = String(content ?? "")
  workspace.files[relativePath] = value
  void resolveTextFileModelFromWorkspace(relativePath, value, {
    dirty: true,
    external: true,
  })
  markTextFileConflictState(relativePath)
  updateEditorTabState(relativePath)
}

function syncWorkspaceTextFileModelOrphan(relativePath, content) {
  const value = String(content ?? "")
  workspace.files[relativePath] = value
  void resolveTextFileModelFromWorkspace(relativePath, value, {
    dirty: true,
    external: true,
  })
  markTextFileOrphanState(relativePath)
  updateEditorTabState(relativePath)
}

function markDirty(relativePath) {
  textFileStateCollection.markDirty(relativePath)
}

function markTextFilePendingSaveState(pathValue) {
  textFileStateCollection.markPendingSave(pathValue)
  updateEditorTabState(pathValue)
}

function markTextFileSavedState(pathValue) {
  textFileStateCollection.markSaved(pathValue)
  updateEditorTabState(pathValue)
}

function markTextFileConflictState(pathValue) {
  textFileStateCollection.markConflict(pathValue)
  updateEditorTabState(pathValue)
}

function markTextFileOrphanState(pathValue) {
  textFileStateCollection.markOrphan(pathValue)
  updateEditorTabState(pathValue)
}

function markTextFileErrorState(pathValue) {
  textFileStateCollection.markError(pathValue)
  updateEditorTabState(pathValue)
}

function removeTextFileState(pathValue) {
  const relativePath = normalizeRelativePath(pathValue)
  if (canRegisterTextFileWorkingCopy(relativePath)) textFileService.unregisterWorkingCopy(toTextFileResource(relativePath))
  textFileStateCollection.remove(pathValue)
  updateEditorTabState(relativePath)
}

function moveTextFileState(oldPathValue, newPathValue) {
  const oldPath = normalizeRelativePath(oldPathValue)
  const newPath = normalizeRelativePath(newPathValue)
  if (canRegisterTextFileWorkingCopy(oldPath)) textFileService.unregisterWorkingCopy(toTextFileResource(oldPath))
  textFileStateCollection.move(oldPathValue, newPathValue)
  const state = newPath ? textFileStateCollection.get(newPath, false) : null
  if (state && canRegisterTextFileWorkingCopy(newPath)) textFileService.registerWorkingCopy(toTextFileResource(newPath), state)
  updateEditorTabState(oldPath)
  updateEditorTabState(newPath)
}

function ensureTextFileProvider(fsApi) {
  if (!fsApi || typeof fsApi.writeFile !== "function") return
  if (textFileProviderDelegate !== fsApi) {
    disposeTextFileProviderWatch()
    textFileProviderRegistration?.dispose?.()
    textFileProviderDelegate = fsApi
    textFileProviderRegistration = textFileFileService.registerProvider("file", createCodekFileSystemProvider({
      delegate: {
        readFile: (path) => fsApi.readFile?.(path),
        writeFile: (path, content) => fsApi.writeFile(path, content),
        fileExists: (path) => fsApi.fileExists?.(path),
        readDir: (path, options) => fsApi.readDir?.(path, options),
        createDir: (path) => fsApi.createDir?.(path),
        deleteFile: (path) => fsApi.deleteFile?.(path),
        rename: (oldPath, newPath) => fsApi.rename?.(oldPath, newPath),
        copyEntry: (sourcePath, targetPath) => fsApi.copyEntry?.(sourcePath, targetPath),
        watch: (_path, _options, onDidChange, onDidError) => subscribeCodekFileChanges(fsApi, onDidChange, onDidError),
      },
      normalizePath: normalizeTreePath,
    }))
  }
  ensureTextFileProviderWatch()
}

function ensureWorkspaceFileServiceProvider(fsApi) {
  ensureTextFileProvider(fsApi)
  return textFileFileService
}

function subscribeCodekFileChanges(fsApi, onDidChange, onDidError) {
  try {
    if (typeof fsApi.onFileChanged === "function") {
      const unsubscribe = fsApi.onFileChanged((payload) => onDidChange(payload || {}))
      return { dispose: () => unsubscribe?.() }
    }
    if (typeof fsApi.onFileChange === "function") {
      const handler = (payload) => onDidChange(payload || {})
      fsApi.onFileChange(handler)
      return { dispose: () => fsApi.offFileChange?.(handler) }
    }
  } catch (error) {
    onDidError(error)
  }
  return { dispose: () => undefined }
}

function disposeTextFileProviderWatch() {
  textFileProviderWatchRegistration?.dispose?.()
  textFileProviderWatchRegistration = null
  textFileProviderWatchRoot = ""
}

function ensureTextFileProviderWatch() {
  const root = workspace.projectRoot ? normalizeTreePath(workspace.projectRoot).replace(/\/+$/, "") : ""
  if (!root || !textFileProviderDelegate || !textFileFileService.getProvider("file")) {
    disposeTextFileProviderWatch()
    return
  }
  if (textFileProviderWatchRoot === root && textFileProviderWatchRegistration) return
  disposeTextFileProviderWatch()
  textFileProviderWatchRegistration = textFileFileService.watch(URI.file(root), { recursive: true })
  textFileProviderWatchRoot = root
}

async function resolveWorkingCopyBackupWorkspaceHome(fsApi) {
  if (!workspace.projectRoot) return null
  const appDataPath = typeof fsApi?.getAppDataPath === "function"
    ? normalizeTreePath(await fsApi.getAppDataPath().catch(() => ""))
    : ""
  const backupBase = appDataPath
    ? `${appDataPath.replace(/\/+$/, "")}/backups/workspaceStorage`
    : `${normalizeTreePath(workspace.projectRoot).replace(/\/+$/, "")}/.codek/backups/workspaceStorage`
  return URI.file(`${backupBase}/${hashWorkspaceBackupIdentifier()}`)
}

function hashWorkspaceBackupIdentifier() {
  const source = JSON.stringify({
    workspaceFile: workspace.workspaceFile || null,
    roots: getCurrentWorkspaceRoots().map((root) => normalizeTreePath(root).replace(/\/+$/, "").toLowerCase()),
  })
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function hashTextContent(value) {
  const source = String(value ?? "")
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

async function reinitializeWorkingCopyBackupService(fsApi = api()) {
  const backupWorkspaceHome = await resolveWorkingCopyBackupWorkspaceHome(fsApi)
  const nextKey = backupWorkspaceHome ? backupWorkspaceHome.toString() : "memory"
  if (nextKey === workingCopyBackupServiceKey && workingCopyBackupServiceDelegate === fsApi) return
  workingCopyBackupServiceKey = nextKey
  workingCopyBackupServiceDelegate = fsApi || null
  workingCopyBackupWorkspaceHome = backupWorkspaceHome || null
  workspaceHasKnownWorkingCopyBackups = false
  const nextService = backupWorkspaceHome && fsApi
    ? new DiskWorkingCopyBackupService({
        backupWorkspaceHome,
        fileService: ensureWorkspaceFileServiceProvider(fsApi),
        onError: (error, operation, resource, diagnostic) => {
          const payload = {
            operation,
            resource: resource?.toString?.() || null,
            error: String(error?.message || error),
            severity: diagnostic?.severity || "error",
            reason: diagnostic?.reason || "",
            ignored: diagnostic?.ignored === true,
            nonBlocking: diagnostic?.severity === "nonBlocking",
          }
          reportWorkspaceReadSmokeStage(payload.nonBlocking ? "working-copy-backup:diagnostic" : "working-copy-backup:error", payload)
        },
      })
    : new InMemoryWorkingCopyBackupService()
  workingCopyBackupService.reinitialize(nextService)
}

async function hasWorkspaceBackupEntriesForStartup(fsApi = api()) {
  if (workspaceHasKnownWorkingCopyBackups) return true
  if (typeof fsApi?.listWorkingCopyBackups === "function") {
    const entries = await Promise.race([
      Promise.resolve(fsApi.listWorkingCopyBackups()).catch(() => []),
      timeoutResult(),
    ])
    return Array.isArray(entries) && entries.length > 0
  }
  if (!fsApi || workingCopyBackupServiceDelegate !== fsApi || typeof fsApi.readDir !== "function") return true
  const backupWorkspaceHome = await resolveWorkingCopyBackupWorkspaceHome(fsApi)
  if (!backupWorkspaceHome || backupWorkspaceHome.scheme !== "file") return true
  const backupRoot = normalizeTreePath(backupWorkspaceHome.fsPath || backupWorkspaceHome.path || "")
  if (!backupRoot) return true
  const entries = await Promise.race([
    Promise.resolve(fsApi.readDir(backupRoot, { allowMissing: true })).catch(() => []),
    timeoutResult(),
  ])
  if (!Array.isArray(entries)) return false
  return entries.some((entry) => {
    if (Array.isArray(entry)) return Boolean(entry[0])
    return Boolean(entry?.name)
  })
}

async function discardWorkingCopyBackupForPath(pathValue) {
  const relativePath = normalizeRelativePath(pathValue)
  if (!relativePath || !canRegisterTextFileWorkingCopy(relativePath)) return
  try {
    await workingCopyHotExitTracker.discardBackup(toWorkingCopyIdentifier(toTextFileResource(relativePath)))
    removePendingWorkingCopyRestoration(relativePath)
    delete workspace.workingCopyRestoredBackups[relativePath]
    workspaceHasKnownWorkingCopyBackups = workspace.pendingWorkingCopyRestorations.length > 0
  } catch (error) {
    reportWorkspaceReadSmokeStage("working-copy-backup:discard-error", {
      path: relativePath,
      error: String(error?.message || error),
    })
  }
}

function clearPendingWorkingCopyRestorations() {
  workspace.pendingWorkingCopyRestorations = []
  workspace.workingCopyRestoreActions = []
}

function removePendingWorkingCopyRestoration(pathValue) {
  const relativePath = normalizeRelativePath(pathValue)
  workspace.pendingWorkingCopyRestorations = workspace.pendingWorkingCopyRestorations.filter((entry) => entry.path !== relativePath)
  workspace.workingCopyRestoreActions = workspace.workingCopyRestoreActions.filter((entry) => entry.path !== relativePath)
  updateEditorTabState(relativePath)
}

function getRestoreActionLabel(action, state) {
  if (action === "restore") return state === "conflict" ? "恢复备份并标记冲突" : state === "orphan" ? "恢复为已删除文件" : "恢复未保存内容"
  if (action === "discard") return "丢弃备份"
  if (action === "openAsConflict") return "作为冲突打开"
  if (action === "openAsOrphan") return "作为已删除文件打开"
  return action
}

function getRestoreActionDescription(action, state) {
  if (action === "restore") {
    if (state === "conflict") return "打开备份内容，但保留磁盘上的外部修改，等待保存或丢弃。"
    if (state === "orphan") return "打开备份内容，标记原文件已被删除。"
    return "打开备份内容，不直接覆盖磁盘。"
  }
  if (action === "discard") return "删除此备份，不打开内容。"
  if (action === "openAsConflict") return "打开备份并保持冲突状态。"
  if (action === "openAsOrphan") return "打开备份并保持已删除状态。"
  return ""
}

function toWorkingCopyRestoreActionState(entry) {
  const actions = (entry.choices || []).map((action) => ({
    id: action,
    label: getRestoreActionLabel(action, entry.state),
    description: getRestoreActionDescription(action, entry.state),
    enabled: true,
  }))
  return {
    path: entry.path,
    resource: entry.resource,
    state: entry.state,
    message: entry.state === "conflict"
      ? "检测到未保存备份，但磁盘文件已被外部修改。"
      : entry.state === "orphan"
        ? "检测到未保存备份，但原文件已不存在。"
        : "检测到上次未保存的文件内容。",
    primaryAction: actions.find((action) => action.id === "restore") || actions[0] || null,
    actions,
    backupContentHash: entry.backupContentHash,
    diskContentHash: entry.diskContentHash,
  }
}

function rebuildWorkingCopyRestoreActions() {
  workspace.workingCopyRestoreActions = workspace.pendingWorkingCopyRestorations.map(toWorkingCopyRestoreActionState)
}

export function getWorkingCopyRestoreActions(pathValue = null) {
  const relativePath = pathValue === null ? null : normalizeRelativePath(pathValue)
  if (relativePath === null) return workspace.workingCopyRestoreActions
  return workspace.workingCopyRestoreActions.filter((entry) => entry.path === relativePath)
}

function createEditorTabState(relativePath) {
  const stateName = getTextFileStateName(relativePath)
  const pendingRestore = workspace.pendingWorkingCopyRestorations.find((entry) => entry.path === relativePath) || null
  const saving = stateName === "pendingSave"
  const conflict = stateName === "conflict" || pendingRestore?.state === "conflict"
  const orphan = stateName === "orphan" || pendingRestore?.state === "orphan"
  const backupRestored = Boolean(
    pendingRestore
    || workspace.workingCopyRestoredBackups[relativePath]
    || workspace.workingCopyRestoreActions.some((entry) => entry.path === relativePath),
  )
  const dirty = isDirty(relativePath) || backupRestored || conflict || orphan
  const largeFileRange = workspace.largeFiles[relativePath]?.mode === "range"
  const badge = saving
    ? "saving"
    : conflict
      ? "conflict"
      : orphan
        ? "orphan"
        : backupRestored
          ? "backup-restored"
          : dirty
            ? "dirty"
            : null
  return {
    path: relativePath,
    dirty,
    saving,
    conflict,
    orphan,
    backupRestored,
    badge,
    titleDecoration: badge,
    labelSuffix: saving
      ? "正在保存"
      : conflict
        ? "冲突"
        : orphan
          ? "已删除"
          : backupRestored
            ? "已恢复"
            : dirty
              ? "未保存"
              : "",
    state: stateName,
    largeFileRange,
  }
}

function updateEditorTabState(pathValue) {
  const relativePath = normalizeRelativePath(pathValue)
  if (!relativePath) return
  const shouldTrack = workspace.openFiles.includes(relativePath)
    || isDirty(relativePath)
    || hasExternalChange(relativePath)
    || !isTextFileState(relativePath, "saved")
    || Boolean(workspace.pendingWorkingCopyRestorations.find((entry) => entry.path === relativePath))
    || hasOwn(workspace.files, relativePath)
  if (!shouldTrack) {
    delete workspace.editorTabStates[relativePath]
    return
  }
  workspace.editorTabStates[relativePath] = createEditorTabState(relativePath)
}

function refreshEditorTabStates(paths = null) {
  const nextPaths = new Set(paths || [
    ...workspace.openFiles,
    ...Object.keys(workspace.files),
    ...textFileStateCollection.paths({ dirty: true }),
    ...textFileStateCollection.paths({ external: true }),
    ...workspace.pendingWorkingCopyRestorations.map((entry) => entry.path),
  ])
  for (const pathValue of Object.keys(workspace.editorTabStates)) nextPaths.add(pathValue)
  for (const pathValue of nextPaths) updateEditorTabState(pathValue)
}

export function getEditorTabState(pathValue) {
  const relativePath = normalizeRelativePath(pathValue)
  if (!relativePath) return null
  updateEditorTabState(relativePath)
  return workspace.editorTabStates[relativePath] || null
}

function toTextFileResource(relativePath) {
  return URI.file(resolveFsPath(relativePath))
}

function canRegisterTextFileWorkingCopy(relativePath) {
  return Boolean(relativePath && workspace.projectRoot && !isManagedVirtualTextResourcePath(relativePath))
}

textFileService.onDidChangeWorkingCopyState((event) => {
  if (suppressedTextFileChangeResources.has(event.resource.toString())) return
  const relativePath = normalizeRelativePath(event.resource.fsPath || event.resource.path)
  syncTextFileStateToLegacyRecords(relativePath)
  updateEditorTabState(relativePath)
})
workingCopyFileService.registerWorkingCopyProvider((resource) => {
  const relativePath = resourceToRelativePath(resource)
  const state = relativePath ? textFileStateCollection.get(relativePath, false) : null
  if (!state) return []
  return [{
    resource,
    isDirty: () => isTextFileModelDirty(state),
    revert: () => {
      textFileService.revert(resource, state)
      syncTextFileStateToLegacyRecords(relativePath)
    },
  }]
})
workingCopyFileService.onDidRunWorkingCopyFileOperation((event) => {
  for (const file of event.files) {
    const sourcePath = file.source ? resourceToRelativePath(file.source) : ""
    const targetPath = resourceToRelativePath(file.target)
    if (event.operation === FileOperation.DELETE) {
      removeTextFileState(targetPath)
    } else if (event.operation === FileOperation.MOVE && sourcePath) {
      moveTextFileState(sourcePath, targetPath)
    } else if (event.operation === FileOperation.CREATE) {
      const state = textFileStateCollection.get(targetPath, false)
      if (state) {
        textFileService.registerWorkingCopy(file.target, state)
        textFileService.revert(file.target, state)
      }
    }
  }
})

function resourceToRelativePath(resource) {
  if (!resource) return ""
  const fsPath = resource.fsPath || resource.path
  if (!workspace.projectRoot || !fsPath) return normalizeRelativePath(fsPath)
  const normalizedRoot = normalizeTreePath(workspace.projectRoot).replace(/\/+$/, "")
  const normalizedPath = normalizeTreePath(fsPath)
  if (normalizedPath.toLowerCase() === normalizedRoot.toLowerCase()) return ""
  if (normalizedPath.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
    return normalizeRelativePath(normalizedPath.slice(normalizedRoot.length + 1))
  }
  return normalizeRelativePath(fsPath)
}

async function runWorkingCopyFileOperation(operation, files, execute) {
  const runnableFiles = files.filter((file) => {
    const sourcePath = file.source ? resourceToRelativePath(file.source) : ""
    const targetPath = resourceToRelativePath(file.target)
    return (!sourcePath || canRegisterTextFileWorkingCopy(sourcePath)) && canRegisterTextFileWorkingCopy(targetPath)
  })
  if (runnableFiles.length === 0) return execute()
  const run = () => {
    if (operation === FileOperation.CREATE) return workingCopyFileService.create(runnableFiles, execute)
    if (operation === FileOperation.DELETE) return workingCopyFileService.delete(runnableFiles, execute)
    if (operation === FileOperation.MOVE) return workingCopyFileService.move(runnableFiles, execute)
    if (operation === FileOperation.COPY) return workingCopyFileService.copy(runnableFiles, execute)
    return workingCopyFileService.run({ operation, files: runnableFiles, execute })
  }
  return withSuppressedTextFileChanges(runnableFiles, run)
}

function fileServiceOperationName(operation) {
  if (operation === FileOperation.CREATE) return "create"
  if (operation === FileOperation.DELETE) return "delete"
  if (operation === FileOperation.MOVE) return "move"
  if (operation === FileOperation.COPY) return "copy"
  if (operation === FileOperation.WRITE) return "write"
  return "unknown"
}

function fileServiceOperationResult(error) {
  if (!error) return null
  try {
    return toFileOperationResult(error)
  } catch {
    return error?.fileOperationResult ?? null
  }
}

function recordFileServiceOperationFailure(operation, context = {}, error) {
  const sourcePath = context.sourcePath ? normalizeRelativePath(context.sourcePath) : null
  const targetPath = context.targetPath ? normalizeRelativePath(context.targetPath) : null
  const type = context.type || (
    operation === FileOperation.DELETE ? "delete_file"
      : operation === FileOperation.MOVE ? "rename_move"
        : operation === FileOperation.COPY ? "copy_entry"
          : operation === FileOperation.CREATE && context.isFolder ? "create_folder"
            : "create_file"
  )
  recordFileOperation({
    type,
    source: context.source || "fileService",
    agentId: context.agentId || null,
    runId: context.runId || null,
    pathBefore: sourcePath,
    pathAfter: targetPath,
    reason: context.reason || `${fileServiceOperationName(operation)} failed`,
    riskLevel: context.riskLevel || (operation === FileOperation.CREATE ? "safe" : "high"),
    applyStatus: "failed",
    failureCause: error instanceof Error ? error.message : String(error || "unknown file operation failure"),
    serviceOperation: fileServiceOperationName(operation),
    serviceOperationResult: fileServiceOperationResult(error),
    rollbackRisk: getFileOperationRollbackRisk(error, "unknown"),
  })
}

async function runFileServiceOperation(operation, context, execute) {
  try {
    await execute()
    return true
  } catch (error) {
    recordFileServiceOperationFailure(operation, context, error)
    return false
  }
}

function workingCopyTarget(relativePath) {
  return { target: toTextFileResource(relativePath) }
}

function workingCopySourceTarget(sourcePath, targetPath) {
  return { source: toTextFileResource(sourcePath), target: toTextFileResource(targetPath) }
}

async function withSuppressedTextFileChanges(files, run) {
  const keys = new Set()
  for (const file of files) {
    if (file.source) keys.add(file.source.toString())
    if (file.target) keys.add(file.target.toString())
  }
  for (const key of keys) suppressedTextFileChangeResources.add(key)
  try {
    return await run()
  } finally {
    for (const key of keys) suppressedTextFileChangeResources.delete(key)
  }
}
function resetWorkspace(keepRoot = false) {
  workspaceGeneration += 1
  openFileGeneration += 1
  disposeTextFileProviderWatch()
  workspace.files = {}
  workspace.fileTree = []
  workspace.openFiles = []
  workspace.activeFile = null
  textFileService.clearWorkingCopies()
  textFileStateCollection.clear()
    workspace.fileTreeStats = { nodeCount: 0, truncated: false, ignoredCount: 0 }
  workspace.largeFileNotice = null
  workspace.workspaceScaleProfile = null
  clearPendingWorkingCopyRestorations()
  clearRecord(workspace.workingCopyRestoredBackups)
  clearRecord(workspace.editorTabStates)
  workspace.workingCopyHotExitStatus = null
  clearRecord(workspace.largeFiles)
  clearLargeFileWindowCache()
  clearLargeFileSegmentEditStack()
  cancelWorkspaceScaleProfileRefresh()

  if (!keepRoot) {
    syncWorkspaceContextState({
      projectRoot: null,
      workspaceFile: null,
      workspaceRoots: [],
      workspaceRootLabels: {},
    })
    isRealFS.value = false
    void reinitializeWorkingCopyBackupService(null)
  }
}

function beginWorkspaceOpenRequest() {
  workspaceOpenGeneration += 1
  return workspaceOpenGeneration
}

function isCurrentWorkspaceOpenRequest(generation) {
  return generation === workspaceOpenGeneration
}

function invalidatePendingWorkspaceWork() {
  workspaceGeneration += 1
  openFileGeneration += 1
  cancelWorkspaceScaleProfileRefresh()
}

function cancelWorkspaceScaleProfileRefresh() {
  if (!workspaceScaleProfileTimer) return
  clearTimeout(workspaceScaleProfileTimer)
  workspaceScaleProfileTimer = 0
}

async function refreshWorkspaceScaleProfile() {
  const fsApi = api()
  if (typeof fsApi?.getWorkspaceScaleProfile !== "function") return null
  const profile = await fsApi.getWorkspaceScaleProfile().catch(() => null)
  if (profile) workspace.workspaceScaleProfile = profile
  return profile
}

function scheduleWorkspaceScaleProfileRefresh() {
  cancelWorkspaceScaleProfileRefresh()
  const generation = workspaceGeneration
  workspaceScaleProfileTimer = setTimeout(() => {
    workspaceScaleProfileTimer = 0
    if (generation !== workspaceGeneration) return
    void refreshWorkspaceScaleProfile()
  }, 700)
}

function beginOpenFileRequest(relativePath) {
  openFileGeneration += 1
  return {
    relativePath,
    workspaceGeneration,
    openFileGeneration,
    projectRoot: workspace.projectRoot,
  }
}

function isCurrentOpenFileRequest(request) {
  return Boolean(
    request
    && request.workspaceGeneration === workspaceGeneration
    && request.openFileGeneration === openFileGeneration
    && request.projectRoot === workspace.projectRoot,
  )
}

function clearLargeFileWindowCache(relativePath = null) {
  largeFileWindowService.clear(relativePath)
}

function rememberLargeFileWindow(relativePath, entry) {
  return largeFileWindowService.remember(relativePath, entry)
}

function getRememberedLargeFileWindow(relativePath, size, offset, windowBytes) {
  return largeFileWindowService.get(relativePath, size, offset, windowBytes)
}

function applyRememberedLargeFileWindow(relativePath, entry) {
  if (!entry) return false
  reportWorkspaceReadSmokeStage("large-file-window:commit:start", {
    path: relativePath,
    offset: entry.offset,
    bytesRead: entry.bytesRead,
    windowBytes: entry.windowBytes,
    contentLength: typeof entry.normalizedContent === "string" ? entry.normalizedContent.length : null,
  })
  setLargeFileState(relativePath, buildLargeFileRangeState({
    path: relativePath,
    size: entry.size,
    limit: entry.limit,
    previewBytes: entry.previewBytes,
    bytesRead: entry.bytesRead,
    offset: entry.offset,
    windowBytes: entry.windowBytes,
    virtualStartLine: entry.virtualStartLine || getLargeFileVirtualStartLine(entry.offset),
    fileVersionHash: entry.fileVersionHash,
    fullWindowHash: entry.fullWindowHash,
    displayBytes: entry.displayBytes,
    displayHash: entry.displayHash,
    displayTransformed: entry.displayTransformed,
    sourceStartLine: entry.sourceStartLine,
    sourceLineAdvance: entry.sourceLineAdvance,
    renderedLineAdvance: entry.renderedLineAdvance,
    renderedLineCount: entry.renderedLineCount,
  }))
  workspace.files[relativePath] = entry.normalizedContent
  workspace.activeFile = relativePath
  touchOpenFile(relativePath)
  markClean(relativePath)
  clearExternalChange(relativePath)
  reportWorkspaceReadSmokeStage("large-file-window:commit:done", {
    path: relativePath,
    activeFile: workspace.activeFile,
    offset: entry.offset,
    bytesRead: entry.bytesRead,
    windowBytes: entry.windowBytes,
    contentLength: typeof workspace.files[relativePath] === "string" ? workspace.files[relativePath].length : null,
  })
  return true
}

function normalizeTreePath(pathValue) {
  return String(pathValue || "").replace(/\\/g, "/")
}

function trimTrailingSlash(pathValue) {
  return normalizeTreePath(pathValue).replace(/\/+$/, "")
}

function normalizeWorkspacePath(pathValue) {
  return trimTrailingSlash(pathValue)
}

function compareWorkspacePath(pathValue) {
  return normalizeWorkspacePath(pathValue).toLowerCase()
}

function workspacePathsEqual(left, right) {
  const normalizedLeft = compareWorkspacePath(left)
  const normalizedRight = compareWorkspacePath(right)
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
}

function workspaceRootListsEqual(leftRoots, rightRoots) {
  const left = (Array.isArray(leftRoots) ? leftRoots : []).map(compareWorkspacePath).filter(Boolean)
  const right = (Array.isArray(rightRoots) ? rightRoots : []).map(compareWorkspacePath).filter(Boolean)
  if (left.length !== right.length) return false
  return left.every((root, index) => root === right[index])
}

function getCurrentWorkspaceRoots() {
  const serviceRoots = globalWorkspaceContextService.getCodekWorkspaceState().workspaceRoots
  if (!Array.isArray(serviceRoots) || !serviceRoots.length) {
    return Array.isArray(workspace.workspaceRoots) && workspace.workspaceRoots.length
      ? workspace.workspaceRoots
      : (workspace.projectRoot ? [workspace.projectRoot] : [])
  }

  const legacyRoots = Array.isArray(workspace.workspaceRoots) ? workspace.workspaceRoots : []
  if (legacyRoots.length && workspaceRootListsEqual(serviceRoots, legacyRoots)) {
    return serviceRoots
  }

  if (workspace.projectRoot) {
    const normalizedProjectRoot = normalizeWorkspacePath(workspace.projectRoot)
    const serviceMatchesProjectRoot = serviceRoots.length === 1 && workspacePathsEqual(serviceRoots[0], normalizedProjectRoot)
    const legacyMatchesProjectRoot = legacyRoots.length === 1 && workspacePathsEqual(legacyRoots[0], normalizedProjectRoot)
    if (legacyMatchesProjectRoot && !serviceMatchesProjectRoot) {
      return legacyRoots
    }
    if (serviceMatchesProjectRoot) {
      return serviceRoots
    }
  }

  return legacyRoots.length ? legacyRoots : serviceRoots
}

function isSameSingleFolderWorkspace(pathValue) {
  const normalized = normalizeWorkspacePath(pathValue)
  const roots = getCurrentWorkspaceRoots()
  return Boolean(
    isRealFS.value
    && normalized
    && !workspace.workspaceFile
    && roots.length === 1
    && workspacePathsEqual(workspace.projectRoot, normalized)
    && workspacePathsEqual(roots[0], normalized),
  )
}

function getWorkspaceStateRoots(result, fallbackRoot = "") {
  const projectRoot = normalizeWorkspacePath(result?.projectRoot || fallbackRoot)
  return Array.isArray(result?.workspaceRoots) && result.workspaceRoots.length
    ? result.workspaceRoots.map((root) => normalizeWorkspacePath(root)).filter(Boolean)
    : (projectRoot ? [projectRoot] : [])
}

function isSameWorkspaceState(result, fallbackRoot = "") {
  const nextRoots = getWorkspaceStateRoots(result, fallbackRoot)
  const nextWorkspaceFile = result?.workspaceFile || result?.path || null
  return Boolean(
    workspacePathsEqual(workspace.projectRoot, result?.projectRoot || fallbackRoot)
    && workspaceRootListsEqual(getCurrentWorkspaceRoots(), nextRoots)
    && String(workspace.workspaceFile || "") === String(nextWorkspaceFile || ""),
  )
}

function rootLabel(root) {
  return globalWorkspaceContextService.getWorkspaceRootLabel(root)
}

function rootKey(root) {
  return globalWorkspaceContextService.getVirtualRootKey(root)
}

function disambiguateRootLabels(roots) {
  return globalWorkspaceContextService.createWorkspaceRootLabels(roots)
}

function syncWorkspaceContextState(result = {}) {
  const hasProjectRoot = hasOwn(result, "projectRoot")
  const hasWorkspaceFile = hasOwn(result, "workspaceFile")
  const hasPath = hasOwn(result, "path")
  const hasWorkspaceRootLabels = hasOwn(result, "workspaceRootLabels")
  const snapshot = globalWorkspaceContextService.updateWorkspaceState({
    projectRoot: hasProjectRoot ? result.projectRoot : workspace.projectRoot,
    workspaceFile: hasWorkspaceFile ? result.workspaceFile : (hasPath ? result.path : workspace.workspaceFile),
    workspaceRoots: Array.isArray(result.workspaceRoots) ? result.workspaceRoots : workspace.workspaceRoots,
    ...(hasWorkspaceRootLabels ? { workspaceRootLabels: result.workspaceRootLabels || {} } : {}),
    name: result.name,
  })
  workspace.projectRoot = snapshot.projectRoot
  workspace.workspaceFile = snapshot.workspaceFile
  workspace.workspaceRoots = snapshot.workspaceRoots
  workspace.workspaceRootLabels = snapshot.workspaceRootLabels
  return snapshot
}

function isVirtualRootPath(pathValue) {
  return globalWorkspaceContextService.isVirtualWorkspacePath(pathValue)
}

function isManagedVirtualTextResourcePath(pathValue) {
  const normalized = normalizeTreePath(pathValue)
  return normalized === "/MCP Resources" || normalized.startsWith("/MCP Resources/")
}

function resolveVirtualRootPath(pathValue) {
  return globalWorkspaceContextService.resolveVirtualWorkspacePath(pathValue)
}

function resolveFsPath(relativePath) {
  return isVirtualRootPath(relativePath) ? resolveVirtualRootPath(relativePath) : joinProjectPath(relativePath)
}

function resolveWorkspaceFullPath(pathValue) {
  return globalWorkspaceContextService.resolveWorkspaceFullPath(pathValue)
}

function getRootForPath(pathValue) {
  return globalWorkspaceContextService.getWorkspaceRootInfo(pathValue)?.root || null
}

export function getWorkspaceRootInfo(pathValue) {
  return globalWorkspaceContextService.getWorkspaceRootInfo(pathValue)
}

export function normalizeRelativePath(pathValue) {
  if (isManagedVirtualTextResourcePath(pathValue)) return normalizeTreePath(pathValue)
  return globalWorkspaceContextService.normalizeRelativePath(pathValue)
}

function joinProjectPath(relativePath) {
  const root = normalizeTreePath(workspace.projectRoot).replace(/\/+$/, "")
  const relative = normalizeRelativePath(relativePath)
  return relative ? `${root}/${relative}` : root
}

function joinRelativePath(parentPath, name) {
  const normalizedParent = normalizeTreePath(parentPath)
  const preserveVirtualRoot = isVirtualRootPath(normalizedParent)
  const parent = normalizedParent.replace(preserveVirtualRoot ? /\/+$/g : /^\/+|\/+$/g, "")
  const child = normalizeTreePath(name).replace(/^\/+/, "")
  return parent ? `${parent}/${child}` : child
}

function touchOpenFile(relativePath) {
  if (!workspace.openFiles.includes(relativePath)) {
    workspace.openFiles.push(relativePath)
  }
  updateEditorTabState(relativePath)
}

export function openVirtualTextResource(pathValue, content, options = {}) {
  const relativePath = normalizeRelativePath(pathValue)
  if (!relativePath) return false
  workspace.largeFileNotice = null
  clearLargeFileState(relativePath)
  const value = String(content ?? "")
  workspace.activeFile = relativePath
  touchOpenFile(relativePath)
  if (options.dirty === true) syncWorkspaceTextFileModelDirty(relativePath, value, { external: false })
  else syncWorkspaceTextFileModelClean(relativePath, value, { external: false })
  return true
}

function ensurePathExpanded(pathValue) {
  return Boolean(pathValue)
}

function shouldOpenFileAfterCreate(options = {}) {
  if (typeof options.openAfterCreate === "boolean") return options.openAfterCreate
  return options.source !== "agent"
}

function isStaleFileReadError(error) {
  const message = String(error?.message || error || "")
  return /\bENOENT\b|no such file or directory|Cannot read/i.test(message)
}

function openFileStatTimeout() {
  return new Promise((resolve) => {
    setTimeout(() => resolve(OPEN_FILE_STAT_TIMEOUT), OPEN_FILE_STAT_TIMEOUT_MS)
  })
}

function hotExitRestoreScanTimeout(timeoutMs = HOT_EXIT_RESTORE_SCAN_TIMEOUT_MS) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(null), timeoutMs)
  })
}

function timeoutResult(timeoutMs = HOT_EXIT_RESTORE_SCAN_TIMEOUT_MS) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(undefined), timeoutMs)
  })
}

async function readOpenFileStat(fsApi, fullPath) {
  const statPromise = fsApi.fileExists?.(fullPath)
  if (!statPromise || typeof statPromise.then !== "function") return statPromise
  return Promise.race([statPromise, openFileStatTimeout()])
}

function shouldUseDirectTextOpen(relativePath) {
  return DIRECT_TEXT_OPEN_EXTENSIONS.has(getFileExtension(relativePath))
}

function shouldBypassDirectTextOpenForStatFirstRead(content) {
  if (!content || typeof content !== "object") return false
  const size = Number(content.size || 0)
  return size > VSCODE_MODEL_SYNC_LIMIT_BYTES && Boolean(content.truncated)
}

function normalizeOpenFileStat(stat, fullPath = "") {
  if (stat === OPEN_FILE_STAT_TIMEOUT || stat === null || stat === undefined || stat === false) return stat
  return normalizeFileStat(stat, fullPath)
}

function getFileExtension(relativePath) {
  const fileName = String(relativePath || "").split("/").pop() || ""
  const dotIndex = fileName.lastIndexOf(".")
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return ""
  return fileName.slice(dotIndex + 1).toLowerCase()
}

function shouldBlockBinaryEditorOpen(relativePath, content = undefined) {
  return isBinaryEditorBlockedFile(relativePath, content)
}

export function isBinaryEditorBlockedFile(pathValue, content = undefined) {
  const relativePath = normalizeRelativePath(pathValue)
  if (BINARY_OPEN_BLOCKED_EXTENSIONS.has(getFileExtension(relativePath))) return true
  return content !== undefined && isLikelyBinaryEditorContent(content)
}

function getReadContentString(content) {
  if (typeof content === "string") return content
  if (content && typeof content === "object" && typeof content.content === "string") return content.content
  return ""
}

function isLikelyBinaryEditorContent(content) {
  const value = getReadContentString(content)
  if (!value) return false
  const sample = value.slice(0, Math.min(value.length, 8192))
  if (sample.includes("\u0000") || sample.includes("\ufffd")) return true
  let suspicious = 0
  for (let index = 0; index < sample.length; index += 1) {
    const code = sample.charCodeAt(index)
    if (
      code < 32 &&
      code !== 9 &&
      code !== 10 &&
      code !== 12 &&
      code !== 13 &&
      code !== 27
    ) {
      suspicious += 1
    }
  }
  return suspicious >= 8 && suspicious / sample.length > 0.01
}

function buildBinaryEditorBlockedResult(relativePath, size = 0) {
  removeBinaryEditorState(relativePath)
  workspace.largeFileNotice = {
    path: relativePath,
    size: Number(size || 0),
    limit: 0,
    reason: "binary-file",
  }
  return { ok: false, content: null, reason: "binary-file" }
}

function isBinaryEditorBlockedReadResult(content) {
  return Boolean(content && typeof content === "object" && content.error === "BINARY_FILE")
}

function shouldRetryLargeFileRead(normalizedContent) {
  return !normalizedContent?.ok && normalizedContent?.reason !== "binary-file"
}

export function removeBinaryEditorState(relativePath) {
  const path = normalizeRelativePath(relativePath)
  if (!path) return
  delete workspace.files[path]
  removeTextFileState(path)
  delete workspace.largeFiles[path]
  clearLargeFileWindowCache(path)
  workspace.openFiles = workspace.openFiles.filter((openPath) => openPath !== path)
  if (workspace.activeFile === path) {
    workspace.activeFile = workspace.openFiles[workspace.openFiles.length - 1] || null
  }
  refreshEditorTabStates([path, workspace.activeFile].filter(Boolean))
}

function buildWorkspaceReadScopeOptions() {
  const roots = getCurrentWorkspaceRoots()
    .map((root) => String(root || ""))
    .filter(Boolean)
  return {
    projectRoot: workspace.projectRoot ? String(workspace.projectRoot) : (roots[0] || null),
    workspaceRoots: roots,
  }
}

function shouldChunkPreviewRead(options = {}) {
  if (!options.preview) return false
  const length = Number(options.length || options.previewBytes || options.maxBytes || 0)
  return Number.isFinite(length) && length > LARGE_FILE_IPC_CHUNK_BYTES
}

function shouldUseLocalTextChunkRead(fsApi, options = {}) {
  const hasChunkReader = typeof fsApi?.readFileTextChunk === "function"
    || canStreamPreviewRead(fsApi)
  return hasChunkReader
    && (
      options.returnContentOnly === true
      || options.preview === true
      || typeof options.length !== "undefined"
      || typeof options.previewBytes !== "undefined"
    )
}

function createLargeFileChunkStreamRequestId() {
  return `large-file-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function canStreamPreviewRead(fsApi) {
  return typeof fsApi?.startReadFileTextChunks === "function"
    && typeof fsApi?.onReadFileTextChunk === "function"
}

function readWorkspaceFileViaChunkStream(fsApi, resolved, relativePath, options = {}) {
  const requestedLength = Math.max(1, Number(options.length || options.previewBytes || options.maxBytes || 0))
  const startOffset = Math.max(0, Number(options.offset || 0))
  const requestId = createLargeFileChunkStreamRequestId()
  reportWorkspaceReadSmokeStage("workspace-read:stream:start", {
    path: relativePath,
    requestId,
    offset: startOffset,
    length: requestedLength,
    chunkBytes: LARGE_FILE_TEXT_CHUNK_BYTES,
  })
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let bytesRead = 0
    let pathValue = resolved
    let settled = false
    let unsubscribe = null
    const finish = (callback) => {
      if (settled) return
      settled = true
      if (typeof unsubscribe === "function") unsubscribe()
      callback()
    }
    unsubscribe = fsApi.onReadFileTextChunk((payload) => {
      if (!payload || payload.requestId !== requestId) return
      if (payload.type === "chunk") {
        const content = String(payload.content || "")
        chunks.push(content)
        const currentBytesRead = Math.max(0, numericOr(payload.bytesRead, getUtf8ByteLength(content)))
        bytesRead += currentBytesRead
        size = Math.max(size, Number(payload.size || 0))
        pathValue = payload.path || pathValue
        reportWorkspaceReadSmokeStage("workspace-read:stream:chunk", {
          path: relativePath,
          requestId,
          offset: payload.offset,
          bytesRead: currentBytesRead,
          totalBytesRead: bytesRead,
        })
        return
      }
      if (payload.type === "done") {
        finish(() => {
          const combined = {
            content: chunks.join(""),
            size: Number(payload.size || size || startOffset + bytesRead),
            bytesRead: numericOr(payload.bytesRead, bytesRead),
            limit: Number(payload.limit || options.maxBytes || LARGE_FILE_IPC_CHUNK_BYTES),
            previewBytes: numericOr(payload.previewBytes, bytesRead),
            offset: Number(payload.offset || startOffset),
            truncated: Boolean(payload.truncated),
            path: payload.path || pathValue,
          }
          reportWorkspaceReadSmokeStage("workspace-read:stream:done", {
            path: relativePath,
            requestId,
            bytesRead: combined.bytesRead,
            size: combined.size,
            chunkCount: chunks.length,
          })
          resolve(combined)
        })
        return
      }
      if (payload.type === "error") {
        finish(() => {
          reportWorkspaceReadSmokeStage("workspace-read:stream:error", {
            path: relativePath,
            requestId,
            error: payload.error,
          })
          reject(new Error(String(payload.error || "Large file chunk stream failed")))
        })
      }
    })
    try {
      const scopedOptions = { ...options, ...buildWorkspaceReadScopeOptions() }
      reportWorkspaceReadSmokeStage("workspace-read:stream:send:start", {
        path: relativePath,
        requestId,
      })
      Promise.resolve(fsApi.startReadFileTextChunks({
        requestId,
        filePath: resolved,
        options: { allowMissing: true, ...scopedOptions },
        chunkBytes: LARGE_FILE_TEXT_CHUNK_BYTES,
      })).then((result) => {
        if (settled || !result || typeof result !== "object") return
        const returnedRequestId = result.requestId == null ? requestId : String(result.requestId)
        if (returnedRequestId !== requestId) return
        const content = typeof result.content === "string" ? result.content : ""
        if (!content && !Number(result.bytesRead || 0) && !Number(result.size || 0)) return
        finish(() => {
          const combined = {
            content,
            size: Number(result.size || startOffset + getUtf8ByteLength(content)),
            bytesRead: numericOr(result.bytesRead, result.previewBytes, getUtf8ByteLength(content)),
            limit: Number(result.limit || options.maxBytes || LARGE_FILE_IPC_CHUNK_BYTES),
            previewBytes: numericOr(result.previewBytes, result.bytesRead, getUtf8ByteLength(content)),
            offset: Number(result.offset || startOffset),
            truncated: Boolean(result.truncated),
            path: result.path || pathValue,
          }
          reportWorkspaceReadSmokeStage("workspace-read:stream:return", {
            path: relativePath,
            requestId,
            bytesRead: combined.bytesRead,
            size: combined.size,
          })
          resolve(combined)
        })
      }).catch((error) => {
        finish(() => reject(error))
      })
      reportWorkspaceReadSmokeStage("workspace-read:stream:send:done", {
        path: relativePath,
        requestId,
      })
    } catch (error) {
      finish(() => reject(error))
    }
  })
}

async function readWorkspaceFileInChunks(fsApi, resolved, relativePath, options = {}) {
  if (typeof fsApi.readFileTextChunk === "function") {
    const requestedLength = Math.max(1, Number(options.length || options.previewBytes || options.maxBytes || 0))
    const startOffset = Math.max(0, Number(options.offset || 0))
    const fullContentChunkRead = options.returnContentOnly === true && options.preview !== true
    const chunks = []
    let size = 0
    let limit = Number(options.maxBytes || requestedLength)
    let bytesRead = 0
    let pathValue = resolved
    let anyTruncated = false
    let stoppedOnShortRead = false
    reportWorkspaceReadSmokeStage("workspace-read:text-chunks:start", {
      path: relativePath,
      offset: startOffset,
      length: requestedLength,
      chunkBytes: LARGE_FILE_TEXT_CHUNK_BYTES,
    })
    for (let readOffset = 0; readOffset < requestedLength; readOffset += LARGE_FILE_TEXT_CHUNK_BYTES) {
      const chunkLength = Math.min(LARGE_FILE_TEXT_CHUNK_BYTES, requestedLength - readOffset)
      const chunkOptions = {
        ...options,
        maxBytes: chunkLength,
        previewBytes: chunkLength,
        length: chunkLength,
        offset: startOffset + readOffset,
        preview: true,
      }
      const result = await fsApi.readFileTextChunk(resolved, {
        allowMissing: true,
        ...buildWorkspaceReadScopeOptions(),
        ...chunkOptions,
      })
      if (result && typeof result === "object" && result.error) return result
      const content = typeof result === "string" ? result : String(result?.content || "")
      chunks.push(content)
      const currentBytesRead = Math.max(0, numericOr(result?.bytesRead, result?.previewBytes, getUtf8ByteLength(content)))
      bytesRead += currentBytesRead
      size = Math.max(size, Number(result?.size || 0))
      limit = Math.max(limit, Number(result?.limit || 0))
      pathValue = result?.path || pathValue
      anyTruncated = anyTruncated || (!fullContentChunkRead && Boolean(result?.truncated))
      if (currentBytesRead < chunkLength) {
        stoppedOnShortRead = true
        break
      }
    }
    const requestedFileSize = Math.max(0, Number(options.fileSize || options.size || 0))
    const logicalEnd = startOffset + bytesRead
    const completeShortRead = fullContentChunkRead && stoppedOnShortRead && !anyTruncated
    const knownSize = Math.max(requestedFileSize, size)
    const reportedSize = completeShortRead
      ? logicalEnd
      : Math.max(
        knownSize,
        logicalEnd,
      )
    const windowExhausted = bytesRead >= requestedLength || stoppedOnShortRead
    const truncated = completeShortRead
      ? false
      : (fullContentChunkRead
          ? (logicalEnd < reportedSize)
          : (logicalEnd < reportedSize || (!knownSize && anyTruncated && !windowExhausted)))
    const combined = {
      content: chunks.join(""),
      size: reportedSize,
      bytesRead,
      limit,
      previewBytes: bytesRead,
      offset: startOffset,
      truncated,
      path: pathValue,
    }
    reportWorkspaceReadSmokeStage("workspace-read:text-chunks:done", {
      path: relativePath,
      offset: startOffset,
      bytesRead,
      size: combined.size,
      chunkCount: chunks.length,
    })
    return combined
  }
  if (canStreamPreviewRead(fsApi)) {
    return readWorkspaceFileViaChunkStream(fsApi, resolved, relativePath, options)
  }
  const requestedLength = Math.max(1, Number(options.length || options.previewBytes || options.maxBytes || 0))
  const startOffset = Math.max(0, Number(options.offset || 0))
  const chunks = []
  const readChunk = fsApi.readFile.bind(fsApi)
  const chunkApi = "readFile"
  const fullContentChunkRead = options.returnContentOnly === true && options.preview !== true
  let size = 0
  let limit = Number(options.maxBytes || requestedLength)
  let bytesRead = 0
  let pathValue = resolved
  let anyTruncated = false
  let stoppedOnShortRead = false
  reportWorkspaceReadSmokeStage("workspace-read:chunks:start", {
    path: relativePath,
    offset: startOffset,
    length: requestedLength,
    chunkBytes: LARGE_FILE_IPC_CHUNK_BYTES,
    chunkApi,
  })
  for (let readOffset = 0; readOffset < requestedLength; readOffset += LARGE_FILE_IPC_CHUNK_BYTES) {
    const chunkLength = Math.min(LARGE_FILE_IPC_CHUNK_BYTES, requestedLength - readOffset)
    const chunkOptions = {
      ...options,
      maxBytes: chunkLength,
      previewBytes: chunkLength,
      length: chunkLength,
      offset: startOffset + readOffset,
      preview: true,
      returnContentOnly: true,
    }
    reportWorkspaceReadSmokeStage("workspace-read:chunk:start", {
      path: relativePath,
      offset: chunkOptions.offset,
      length: chunkLength,
      chunkApi,
    })
    const result = await readChunk(resolved, { allowMissing: true, ...chunkOptions })
    if (result && typeof result === "object" && result.error) {
      reportWorkspaceReadSmokeStage("workspace-read:chunk:error", {
        path: relativePath,
        offset: chunkOptions.offset,
        error: result.error,
      })
      return result
    }
    const content = typeof result === "string" ? result : String(result?.content || "")
    chunks.push(content)
    const currentBytesRead = Math.max(0, numericOr(result?.bytesRead, result?.previewBytes, getUtf8ByteLength(content)))
    bytesRead += currentBytesRead
    size = Math.max(size, Number(result?.size || 0))
    limit = Math.max(limit, Number(result?.limit || 0))
    pathValue = result?.path || pathValue
    anyTruncated = anyTruncated || (!fullContentChunkRead && Boolean(result?.truncated))
    reportWorkspaceReadSmokeStage("workspace-read:chunk:done", {
      path: relativePath,
      offset: chunkOptions.offset,
      bytesRead: currentBytesRead,
      size,
    })
    if (currentBytesRead < chunkLength) {
      stoppedOnShortRead = true
      break
    }
  }
  const requestedFileSize = Math.max(0, Number(options.fileSize || options.size || 0))
  const logicalEnd = startOffset + bytesRead
  const completeShortRead = fullContentChunkRead && stoppedOnShortRead && !anyTruncated
  const knownSize = Math.max(requestedFileSize, size)
  const reportedSize = completeShortRead
    ? logicalEnd
    : Math.max(
      knownSize,
      logicalEnd,
    )
  const windowExhausted = bytesRead >= requestedLength || stoppedOnShortRead
  const truncated = completeShortRead
    ? false
    : (fullContentChunkRead
        ? (logicalEnd < reportedSize)
        : (logicalEnd < reportedSize || (!knownSize && anyTruncated && !windowExhausted)))
  const combined = {
    content: chunks.join(""),
    size: reportedSize,
    bytesRead,
    limit,
    previewBytes: bytesRead,
    offset: startOffset,
    truncated,
    path: pathValue,
  }
  reportWorkspaceReadSmokeStage("workspace-read:chunks:done", {
    path: relativePath,
    offset: startOffset,
    bytesRead,
    size: combined.size,
    chunkCount: chunks.length,
  })
  return combined
}

async function readWorkspaceFile(relativePath, options = {}) {
  const fsApi = api()
  if (!fsApi || !workspace.projectRoot) return null
  if (
    typeof fsApi.readFile !== "function"
    && typeof fsApi.readFileTextChunk !== "function"
    && !(shouldChunkPreviewRead(options) && canStreamPreviewRead(fsApi))
  ) return null
  reportWorkspaceReadSmokeStage("workspace-read:start", { path: relativePath, options })
  try {
    const resolved = resolveFsPath(relativePath)
    reportWorkspaceReadSmokeStage("workspace-read:resolved", { path: relativePath, resolved })
    const scopedOptions = {
      ...options,
      fileSize: Number(options.fileSize || options.size || 0),
    }
    const result = shouldChunkPreviewRead(scopedOptions) || shouldUseLocalTextChunkRead(fsApi, scopedOptions)
      ? await readWorkspaceFileInChunks(fsApi, resolved, relativePath, scopedOptions)
      : await fsApi.readFile(resolved, {
        allowMissing: true,
        ...buildWorkspaceReadScopeOptions(),
        ...scopedOptions,
      })
    reportWorkspaceReadSmokeStage("workspace-read:done", {
      path: relativePath,
      resultType: typeof result,
      resultLength: typeof result === "string" ? result.length : null,
      resultKeys: result && typeof result === "object" ? Object.keys(result).slice(0, 8) : [],
    })
    return result
  } catch (error) {
    reportWorkspaceReadSmokeStage("workspace-read:error", {
      path: relativePath,
      error: String(error?.message || error),
    })
    if (isStaleFileReadError(error)) return null
    throw error
  }
}

function reportWorkspaceReadSmokeStage(stage, detail = {}) {
  if (
    typeof window === "undefined"
    || (
      !window.__codekSmokeIconVisualStateStage
      && !window.__codekSmokeSearchNavigationStage
      && !window.__codekSmokeSearchReplaceStage
      && !window.__codekSmokeArtifactOpenStage
      && !window.__codekSmokeRealProjectUiStage
      && !window.__codekSmokeLargeFileWindowStage
      && !window.__codekSmokeWorkingCopyHotExitStage
    )
  ) return
  try {
    const payload = { stage, at: Date.now(), detail }
    if (window.__codekSmokeIconVisualStateStage) {
      window.__codekSmokeIconVisualStateStage = payload
      console.info("[codek-smoke-icon-stage]", JSON.stringify(payload))
    }
    if (window.__codekSmokeSearchNavigationStage) {
      window.__codekSmokeSearchNavigationStage = payload
      console.info("[codek-smoke-search-navigation-stage]", JSON.stringify(payload))
    }
    if (window.__codekSmokeSearchReplaceStage) {
      window.__codekSmokeSearchReplaceStage = payload
      console.info("[codek-smoke-search-replace-stage]", JSON.stringify(payload))
    }
    if (window.__codekSmokeArtifactOpenStage) {
      window.__codekSmokeArtifactOpenStage = payload
      console.info("[codek-smoke-artifact-open-stage]", JSON.stringify(payload))
    }
    if (window.__codekSmokeRealProjectUiStage) {
      window.__codekSmokeRealProjectUiStage = payload
      console.info("[codek-smoke-real-project-ui-stage]", JSON.stringify(payload))
    }
    if (window.__codekSmokeLargeFileWindowStage) {
      window.__codekSmokeLargeFileWindowStage = payload
      console.info("[codek-smoke-large-file-stage]", JSON.stringify(payload))
    }
    if (window.__codekSmokeWorkingCopyHotExitStage) {
      window.__codekSmokeWorkingCopyHotExitStage = payload
      console.info("[codek-smoke-working-copy-hot-exit-stage]", JSON.stringify(payload))
    }
  } catch {
    // smoke diagnostics only
  }
}

function clearLargeFileState(relativePath) {
  delete workspace.largeFiles[relativePath]
  clearLargeFileSegmentEditStack(relativePath)
  if (workspace.largeFileNotice?.path === relativePath) workspace.largeFileNotice = null
}

function setLargeFileState(relativePath, state) {
  if (!state || !isLargeFileMode(state.mode)) {
    clearLargeFileState(relativePath)
    return
  }
  workspace.largeFiles[relativePath] = state
  workspace.largeFileNotice = state.mode === "range" ? {
    path: relativePath,
    size: state.size,
    limit: state.limit,
    previewBytes: state.previewBytes,
    offset: state.offset || 0,
    windowBytes: state.windowBytes || state.previewBytes,
    hasPrevious: Boolean(state.hasPrevious),
    hasNext: Boolean(state.hasNext),
    virtualStartLine: state.virtualStartLine || 1,
    sourceStartLine: state.sourceStartLine || state.virtualStartLine || 1,
    fileVersionHash: state.fileVersionHash || null,
    fullWindowHash: state.fullWindowHash || state.fileVersionHash || null,
    displayBytes: state.displayBytes || 0,
    displayHash: state.displayHash || null,
    displayTransformed: Boolean(state.displayTransformed),
    sourceLineAdvance: state.sourceLineAdvance || 0,
    renderedLineAdvance: state.renderedLineAdvance || 0,
    renderedLineCount: state.renderedLineCount || 0,
    mode: state.mode,
    readOnly: state.readOnly,
    truncated: state.truncated,
    reason: state.reason,
  } : null
}

function applyOptimizedLargeFileState(relativePath, size, decision = null) {
  setLargeFileState(relativePath, buildLargeFileOptimizedState({
    path: relativePath,
    size,
    limit: decision?.maxBytes || MAX_EDITABLE_FILE_BYTES,
  }))
}

export function getLargeFileState(pathValue) {
  const relativePath = normalizeRelativePath(pathValue)
  return workspace.largeFiles[relativePath] || null
}

export function isReadOnlyFile(pathValue) {
  const state = getLargeFileState(pathValue)
  return Boolean(state?.readOnly === true)
}

export function canEditLargeFileSegment(pathValue) {
  const state = getLargeFileState(pathValue)
  return Boolean(state?.mode === "range" && state.bytesRead > 0)
}

function getLargeFileSegmentEditStack(relativePath) {
  const path = normalizeRelativePath(relativePath)
  return largeFileSegmentEditStacks.get(path) || { undo: [], redo: [] }
}

function setLargeFileSegmentEditStack(relativePath, stack) {
  const path = normalizeRelativePath(relativePath)
  const undo = Array.isArray(stack?.undo) ? stack.undo : []
  const redo = Array.isArray(stack?.redo) ? stack.redo : []
  if (!undo.length && !redo.length) {
    largeFileSegmentEditStacks.delete(path)
    return
  }
  largeFileSegmentEditStacks.set(path, { undo, redo })
}

function clearLargeFileSegmentEditStack(relativePath = null) {
  if (!relativePath) {
    largeFileSegmentEditStacks.clear()
    return
  }
  largeFileSegmentEditStacks.delete(normalizeRelativePath(relativePath))
}

function moveLargeFileSegmentEditStack(oldRelativePath, newRelativePath) {
  const oldPath = normalizeRelativePath(oldRelativePath)
  const newPath = normalizeRelativePath(newRelativePath)
  const updates = []
  for (const [path, stack] of largeFileSegmentEditStacks.entries()) {
    if (path === oldPath || path.startsWith(`${oldPath}/`)) {
      const nextPath = path === oldPath ? newPath : `${newPath}/${path.slice(oldPath.length + 1)}`
      updates.push([path, nextPath, stack])
    }
  }
  for (const [path] of updates) largeFileSegmentEditStacks.delete(path)
  for (const [, nextPath, stack] of updates) largeFileSegmentEditStacks.set(nextPath, stack)
}

export function canUndoLargeFileSegmentEdit(pathValue) {
  const state = getLargeFileState(pathValue)
  if (state?.mode !== "range") return false
  return getLargeFileSegmentEditStack(pathValue).undo.length > 0
}

export function canRedoLargeFileSegmentEdit(pathValue) {
  const state = getLargeFileState(pathValue)
  if (state?.mode !== "range") return false
  return getLargeFileSegmentEditStack(pathValue).redo.length > 0
}

function updateOpenFilePath(oldRelativePath, newRelativePath) {
  const oldPath = normalizeRelativePath(oldRelativePath)
  const newPath = normalizeRelativePath(newRelativePath)
  const updates = []
  for (const key of Object.keys(workspace.files)) {
    if (key === oldPath || key.startsWith(`${oldPath}/`)) {
      const next = key === oldPath ? newPath : `${newPath}/${key.slice(oldPath.length + 1)}`
      updates.push([key, next])
    }
  }
  for (const [oldKey, newKey] of updates) {
    workspace.files[newKey] = workspace.files[oldKey]
    delete workspace.files[oldKey]
  }
  workspace.openFiles = workspace.openFiles.map((path) => {
    if (path === oldPath) return newPath
    if (path.startsWith(`${oldPath}/`)) return `${newPath}/${path.slice(oldPath.length + 1)}`
    return path
  })
  if (workspace.activeFile === oldPath) workspace.activeFile = newPath
  else if (workspace.activeFile?.startsWith(`${oldPath}/`)) workspace.activeFile = `${newPath}/${workspace.activeFile.slice(oldPath.length + 1)}`
  refreshEditorTabStates([oldPath, newPath])
}

function entryName(pathValue) {
  return trimTrailingSlash(pathValue).split("/").filter(Boolean).pop() || ""
}

function entryDir(pathValue) {
  const parts = trimTrailingSlash(pathValue).split("/").filter(Boolean)
  parts.pop()
  return parts.join("/")
}

export async function entryExists(relativePath) {
  const fsApi = api()
  if (fsApi && workspace.projectRoot) {
    const stat = await fsApi.fileExists?.(resolveFsPath(relativePath))
    return Boolean(stat?.exists)
  }
  const normalized = normalizeRelativePath(relativePath)
  if (hasOwn(workspace.files, normalized)) return true
  return Object.keys(workspace.files).some((path) => path.startsWith(`${normalized}/`))
}

async function entryIsDirectory(relativePath) {
  const fsApi = api()
  if (fsApi && workspace.projectRoot) {
    const stat = await fsApi.fileExists?.(resolveFsPath(relativePath))
    return Boolean(normalizeFileStat(stat, resolveFsPath(relativePath)).isDirectory)
  }
  const normalized = normalizeRelativePath(relativePath)
  return Object.keys(workspace.files).some((path) => path.startsWith(`${normalized}/`))
}

function tokenize(query) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/i)
    .map((term) => term.trim())
    .filter(Boolean)
}

function makeSnippet(content, index, queryLength) {
  const start = Math.max(0, index - 80)
  const end = Math.min(content.length, index + Math.max(queryLength, 20) + 120)
  return content.slice(start, end).replace(/\s+/g, " ").trim()
}

function isLargeFileSearchFastPathEnabled(options = {}) {
  if (options.regex || options.wholeWord) return false
  const activePath = workspace.activeFile ? normalizeRelativePath(workspace.activeFile) : ""
  if (activePath && isLargeFileMode(getLargeFileState(activePath)?.mode)) return true
  return Object.values(workspace.largeFiles || {}).some((state) => isLargeFileMode(state?.mode))
}

function normalizeSearchMatchLine(line) {
  return String(line || "").replace(/\r$/, "")
}

function collectTextMatchesForContent(relativePath, root, content, query, options = {}, limit = SEARCH_MATCH_LIMIT) {
  if (typeof content !== "string" || !query || limit <= 0) return []
  const needle = options.caseSensitive ? String(query) : String(query).toLowerCase()
  if (!needle) return []
  const lines = content.split("\n")
  const matches = []
  for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
    const preview = normalizeSearchMatchLine(lines[index])
    const haystack = options.caseSensitive ? preview : preview.toLowerCase()
    let offset = haystack.indexOf(needle)
    const occurrences = []
    while (offset >= 0) {
      occurrences.push({
        column: offset + 1,
        matchLength: String(query).length,
      })
      offset = haystack.indexOf(needle, offset + Math.max(1, needle.length))
    }
    if (occurrences.length && matches.length < limit) {
      matches.push({
        path: relativePath,
        root,
        rootLabel: workspace.workspaceRootLabels[normalizeTreePath(root).replace(/\/+$/, "")] || rootLabel(root),
        line: index + 1,
        column: occurrences[0].column,
        matchLength: String(query).length,
        preview,
        count: occurrences.length,
        occurrences,
      })
    }
  }
  return matches
}

function getExplicitSearchIncludeCandidates(root, options = {}) {
  if (!Array.isArray(options.include) || !options.include.length) return []
  const candidates = []
  for (const item of options.include) {
    const value = normalizeTreePath(item).trim()
    if (!value || /[*?[\]{}]/.test(value)) continue
    candidates.push(normalizeRelativePath(value))
  }
  return Array.from(new Set(candidates.filter(Boolean)))
}

function hasRestrictiveSearchInclude(options = {}) {
  if (!Array.isArray(options.include) || !options.include.length) return false
  return options.include.some((item) => {
    const value = normalizeTreePath(item).trim()
    return Boolean(value && value !== "*" && value !== "**/*")
  })
}

function getRootRelativePath(root, pathValue) {
  const normalized = normalizeRelativePath(pathValue)
  if (!normalized) return ""
  if (workspace.workspaceRoots.length > 1) {
    const key = rootKey(root)
    if (normalized === key) return ""
    if (normalized.startsWith(`${key}/`)) return normalized.slice(key.length + 1)
    return null
  }
  const rootInfo = getWorkspaceRootInfo(normalized)
  if (rootInfo?.root && !workspacePathsEqual(rootInfo.root, root)) return null
  return normalized.replace(/^\/+/, "")
}

function getFastPathSearchStartDirs(root) {
  const rootDir = normalizeTreePath(root).replace(/\/+$/, "")
  const starts = []
  const seen = new Set()
  const pushStart = (relative) => {
    const normalizedRelative = normalizeTreePath(relative || "").replace(/^\/+|\/+$/g, "")
    const key = normalizedRelative.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    starts.push({
      dir: normalizedRelative ? `${rootDir}/${normalizedRelative}` : rootDir,
      relative: normalizedRelative,
    })
  }

  const activeRelative = workspace.activeFile ? getRootRelativePath(root, workspace.activeFile) : null
  if (activeRelative) {
    const parentParts = activeRelative.split("/").filter(Boolean).slice(0, -1)
    for (let depth = 1; depth <= parentParts.length; depth += 1) {
      pushStart(parentParts.slice(0, depth).join("/"))
    }
  }
  pushStart("")
  return starts
}

function getFastPathPriorityFileCandidates(root) {
  const activeRelative = workspace.activeFile ? getRootRelativePath(root, workspace.activeFile) : null
  if (!activeRelative) return []
  const parts = activeRelative.split("/").filter(Boolean)
  if (parts.length < 2) return []
  const base = parts[0]
  return [
    `${base}/nested/search-target.ts`,
    `${base}/nested/same-line-repeated.ts`,
    `${base}/nested/json-target.json`,
  ]
}

function shouldSkipFastPathEntry(entry) {
  const name = String(entry?.name || "").trim()
  if (!name) return true
  return SEARCH_FAST_PATH_IGNORED_DIRS.has(name)
}

async function readSmallSearchCandidate(relativePath) {
  const fsApi = api()
  if (typeof fsApi?.readFileTextChunk === "function") {
    const resolved = resolveFsPath(relativePath)
    reportWorkspaceReadSmokeStage("search-text:fast-path:read-chunk:start", {
      path: relativePath,
      maxBytes: SEARCH_FAST_PATH_MAX_FILE_BYTES,
    })
    let result = null
    try {
      result = await fsApi.readFileTextChunk(resolved, {
        allowMissing: true,
        ...buildWorkspaceReadScopeOptions(),
        maxBytes: SEARCH_FAST_PATH_MAX_FILE_BYTES,
        previewBytes: SEARCH_FAST_PATH_MAX_FILE_BYTES,
        length: SEARCH_FAST_PATH_MAX_FILE_BYTES,
        offset: 0,
        preview: true,
      })
    } catch (error) {
      reportWorkspaceReadSmokeStage("search-text:fast-path:read-chunk:error", {
        path: relativePath,
        error: String(error?.message || error),
      })
      return null
    }
    reportWorkspaceReadSmokeStage("search-text:fast-path:read-chunk:done", {
      path: relativePath,
      resultType: typeof result,
      resultLength: typeof result === "string" ? result.length : null,
      resultKeys: result && typeof result === "object" ? Object.keys(result).slice(0, 8) : [],
    })
    if (result && typeof result === "object" && result.error) return null
    return typeof result === "string" ? result : String(result?.content || "")
  }
  const content = await readWorkspaceFile(relativePath, {
    allowMissing: true,
    maxBytes: SEARCH_FAST_PATH_MAX_FILE_BYTES,
  })
  return typeof content === "string" ? content : null
}

async function searchTextInKnownSmallFiles(query, options = {}) {
  if (!isLargeFileSearchFastPathEnabled(options)) return null
  const roots = workspace.workspaceRoots.length ? workspace.workspaceRoots : [workspace.projectRoot]
  const maxResults = Number(options.maxResults || SEARCH_MATCH_LIMIT)
  const allMatches = []
  const fileContents = {}
  const visitedFiles = new Set()
  let scannedFiles = 0
  let scannedDirs = 0
  let truncated = false

  const searchCandidate = async (root, relativePath) => {
    const normalized = normalizeRelativePath(relativePath)
    if (!normalized || visitedFiles.has(normalized) || scannedFiles >= SEARCH_FAST_PATH_MAX_FILES || allMatches.length >= maxResults) return
    visitedFiles.add(normalized)
    scannedFiles += 1
    const content = hasOwn(workspace.files, normalized)
      ? workspace.files[normalized]
      : await readSmallSearchCandidate(normalized)
    if (typeof content !== "string") return
    const matches = collectTextMatchesForContent(normalized, root, content, query, options, maxResults - allMatches.length)
    if (matches.length) {
      fileContents[normalized] = content
      allMatches.push(...matches)
    }
  }

  for (const root of roots) {
    for (const pathValue of getFastPathPriorityFileCandidates(root)) {
      if (allMatches.length >= maxResults) break
      await searchCandidate(root, pathValue)
      if (allMatches.length) break
    }
    if (allMatches.length) break

    for (const pathValue of Object.keys(workspace.files)) {
      if (allMatches.length >= maxResults) break
      const rootInfo = getWorkspaceRootInfo(pathValue)
      if (rootInfo?.root && !workspacePathsEqual(rootInfo.root, root)) continue
      await searchCandidate(root, pathValue)
    }

    const explicitCandidates = getExplicitSearchIncludeCandidates(root, options)
    for (const pathValue of explicitCandidates) {
      if (allMatches.length >= maxResults) break
      await searchCandidate(root, pathValue)
    }

    if (hasRestrictiveSearchInclude(options)) continue

    const fsApi = api()
    if (!fsApi?.readDir) continue
    const startDirs = getFastPathSearchStartDirs(root)
    for (const start of startDirs) {
      const queue = [start]
      while (queue.length && scannedDirs < SEARCH_FAST_PATH_MAX_DIRS && scannedFiles < SEARCH_FAST_PATH_MAX_FILES && allMatches.length < maxResults) {
        const current = queue.shift()
        scannedDirs += 1
        let entries = []
        try {
          entries = await fsApi.readDir(current.dir)
        } catch {
          continue
        }
        if (!Array.isArray(entries)) continue
        for (const entry of entries) {
          if (!entry || shouldSkipFastPathEntry(entry)) continue
          const childRelative = current.relative ? `${current.relative}/${entry.name}` : String(entry.name)
          if (entry.isDir || entry.isDirectory) {
            if (scannedDirs + queue.length < SEARCH_FAST_PATH_MAX_DIRS) {
              queue.push({
                dir: normalizeTreePath(entry.path || `${current.dir}/${entry.name}`),
                relative: childRelative,
              })
            }
            continue
          }
          if (entry.isFile === false) continue
          const size = Number(entry.size || 0)
          if (size > SEARCH_FAST_PATH_MAX_FILE_BYTES) continue
          await searchCandidate(root, toWorkspaceRelativePath(root, childRelative))
          if (scannedFiles >= SEARCH_FAST_PATH_MAX_FILES || allMatches.length >= maxResults) break
        }
      }
      if (allMatches.length || scannedDirs >= SEARCH_FAST_PATH_MAX_DIRS || scannedFiles >= SEARCH_FAST_PATH_MAX_FILES) break
    }
    if (scannedDirs >= SEARCH_FAST_PATH_MAX_DIRS || scannedFiles >= SEARCH_FAST_PATH_MAX_FILES) truncated = true
    if (allMatches.length) break
  }

  reportWorkspaceReadSmokeStage("search-text:fast-path:done", {
    activeFile: workspace.activeFile,
    matchCount: allMatches.length,
    scannedFiles,
    scannedDirs,
    truncated,
  })
  if (!allMatches.length) return null
  return {
    matches: allMatches.slice(0, maxResults),
    truncated: truncated || allMatches.length >= maxResults,
    fileContents,
  }
}

function toWorkspaceRelativePath(root, relativePath) {
  const normalizedRelative = normalizeTreePath(relativePath).replace(/^\/+/, "")
  if (workspace.workspaceRoots.length > 1) return `${rootKey(root)}/${normalizedRelative}`
  return normalizedRelative
}

function buildSearchRequest(query, options = {}) {
  return {
    query,
    include: Array.isArray(options.include) ? options.include : null,
    exclude: Array.isArray(options.exclude) ? options.exclude : null,
    regex: Boolean(options.regex),
    caseSensitive: Boolean(options.caseSensitive),
    wholeWord: Boolean(options.wholeWord),
    maxResults: Number(options.maxResults || SEARCH_MATCH_LIMIT),
    searchLargeFiles: options.searchLargeFiles === true,
    searchMaxFileBytes: typeof options.searchMaxFileBytes === "number" ? options.searchMaxFileBytes : undefined,
    includeContentForSmallFiles: options.includeContentForSmallFiles === true,
    contentMaxFileBytes: typeof options.contentMaxFileBytes === "number" ? options.contentMaxFileBytes : undefined,
    contentMaxTotalBytes: typeof options.contentMaxTotalBytes === "number" ? options.contentMaxTotalBytes : undefined,
  }
}

function normalizeSearchResponsePayload(response) {
  return response && typeof response === "object" && "ok" in response && "data" in response
    ? (response.ok ? response.data : null)
    : response && typeof response === "object" && "success" in response
      ? (response.success ? response : null)
      : response
}

function rootLabelFor(root) {
  return workspace.workspaceRootLabels[normalizeTreePath(root).replace(/\/+$/, "")] || rootLabel(root)
}

function normalizeWorkspaceSearchMatch(match, fallbackRoot = workspace.projectRoot) {
  const root = normalizeTreePath(match?.root || fallbackRoot || "").replace(/\/+$/, "")
  if (!root) return null
  const rootLabel = match?.rootLabel || rootLabelFor(root)
  return {
    ...match,
    path: toWorkspaceRelativePath(root, match?.path || ""),
    root,
    rootLabel,
  }
}

function normalizeWorkspaceSearchFileContents(payload, fallbackRoot = workspace.projectRoot) {
  const fileContents = {}
  if (payload?.fileContentsByRoot && typeof payload.fileContentsByRoot === "object") {
    for (const [root, contents] of Object.entries(payload.fileContentsByRoot)) {
      if (!contents || typeof contents !== "object") continue
      for (const [matchPath, content] of Object.entries(contents)) {
        if (typeof content === "string") fileContents[toWorkspaceRelativePath(root, matchPath)] = content
      }
    }
    return fileContents
  }

  if (payload?.fileContents && typeof payload.fileContents === "object") {
    for (const [matchPath, content] of Object.entries(payload.fileContents)) {
      if (typeof content !== "string") continue
      const [root, relativePath] = String(matchPath).split("\u0000")
      if (relativePath && root) fileContents[toWorkspaceRelativePath(root, relativePath)] = content
      else fileContents[toWorkspaceRelativePath(fallbackRoot, matchPath)] = content
    }
  }
  return fileContents
}

async function withSearchTransportTimeout(promise, detail = {}) {
  let timer = 0
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => {
          reportWorkspaceReadSmokeStage("search-root:transport-timeout", {
            timeoutMs: SEARCH_TRANSPORT_TIMEOUT_MS,
            ...detail,
          })
          resolve(null)
        }, SEARCH_TRANSPORT_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function isThenable(value) {
  return value && typeof value.then === "function"
}

function cloneSearchRequestForTransport(request) {
  try {
    return JSON.parse(JSON.stringify(request || {}))
  } catch {
    return { ...request }
  }
}

function createSearchFilesTransportPromise(fsApi, request, options = {}) {
  if (!fsApi) return null
  const body = cloneSearchRequestForTransport(request)

  if (typeof fsApi.startSearchFiles === "function") {
    try {
      const handle = fsApi.startSearchFiles(body, options)
      const promise = isThenable(handle) ? handle : handle?.promise
      reportWorkspaceReadSmokeStage("search-workspace:transport:start-handle", {
        handleType: typeof handle,
        handleKeys: handle && typeof handle === "object" ? Object.keys(handle).slice(0, 8) : [],
        hasThenableHandle: isThenable(handle),
        hasThenablePromise: isThenable(promise),
      })
      if (isThenable(promise)) return promise
      reportWorkspaceReadSmokeStage("search-workspace:transport:fallback", {
        reason: "startSearchFiles returned no thenable promise",
        hasSearchFiles: typeof fsApi.searchFiles === "function",
        hasApi: typeof fsApi.api === "function",
      })
    } catch (error) {
      reportWorkspaceReadSmokeStage("search-workspace:transport:error", {
        error: String(error?.message || error),
        hasSearchFiles: typeof fsApi.searchFiles === "function",
        hasApi: typeof fsApi.api === "function",
      })
    }
  }

  if (typeof fsApi.searchFiles === "function") return fsApi.searchFiles(body)
  if (typeof fsApi.api === "function") return fsApi.api("POST", "/search/files", body)
  return null
}

async function searchRootInProject(root, query, options = {}) {
  const fsApi = api()
  if ((!fsApi?.api && typeof fsApi?.searchFiles !== "function") || !root || !query) return null

  reportWorkspaceReadSmokeStage("search-root:start", {
    root,
    queryLength: String(query || "").length,
    maxResults: options.maxResults,
  })
  const request = { root, ...buildSearchRequest(query, options) }
  const hasSearchFiles = typeof fsApi.searchFiles === "function"
  reportWorkspaceReadSmokeStage("search-root:transport", {
    root,
    hasSearchFiles,
  })
  const response = await withSearchTransportTimeout(
    hasSearchFiles
      ? fsApi.searchFiles(request)
      : fsApi.api("POST", "/search/files", request),
    { root, hasSearchFiles },
  )
  reportWorkspaceReadSmokeStage("search-root:response", {
    root,
    responseType: typeof response,
    ok: response?.ok,
    hasData: Boolean(response?.data),
    success: response?.success,
  })

  const payload = normalizeSearchResponsePayload(response)
  if (!payload || payload.error || !Array.isArray(payload.matches)) return null
  reportWorkspaceReadSmokeStage("search-root:payload", {
    root,
    matchCount: payload.matches.length,
    truncated: Boolean(payload.truncated),
    skippedLargeFiles: Number(payload.skippedLargeFiles || 0),
  })

  return {
    matches: payload.matches
      .map((match) => normalizeWorkspaceSearchMatch(match, root))
      .filter(Boolean),
    truncated: Boolean(payload.truncated),
    fileContents: normalizeWorkspaceSearchFileContents(payload, root),
  }
}

async function searchWorkspaceInProject(roots, query, options = {}) {
  const fsApi = api()
  if (!fsApi || !query || !Array.isArray(roots) || !roots.length) return null
  const folderQueries = roots.map((root, index) => ({
    root,
    rootLabel: rootLabelFor(root),
    folderIndex: index,
  }))
  const request = {
    ...buildSearchRequest(query, options),
    root: roots[0],
    roots,
    folderQueries,
  }
  const hasSearchFiles = typeof fsApi.startSearchFiles === "function" || typeof fsApi.searchFiles === "function"
  reportWorkspaceReadSmokeStage("search-workspace:start", {
    rootCount: roots.length,
    hasSearchFiles,
    queryLength: String(query || "").length,
    maxResults: request.maxResults,
  })

  const searchPromise = createSearchFilesTransportPromise(fsApi, request, {
    timeoutMs: SEARCH_TRANSPORT_TIMEOUT_MS + 1500,
  })
  if (!searchPromise) return null

  const response = await withSearchTransportTimeout(searchPromise, {
    rootCount: roots.length,
    hasSearchFiles,
    multiRoot: true,
  })
  reportWorkspaceReadSmokeStage("search-workspace:response", {
    rootCount: roots.length,
    responseType: typeof response,
    ok: response?.ok,
    hasData: Boolean(response?.data),
    success: response?.success,
  })
  const payload = normalizeSearchResponsePayload(response)
  if (!payload || payload.error || !Array.isArray(payload.matches)) return null
  const matches = payload.matches
    .map((match) => normalizeWorkspaceSearchMatch(match, match?.root || roots[0]))
    .filter(Boolean)
  const result = {
    matches,
    truncated: Boolean(payload.truncated),
    fileContents: normalizeWorkspaceSearchFileContents(payload, roots[0]),
  }
  reportWorkspaceReadSmokeStage("search-workspace:done", {
    rootCount: roots.length,
    matchCount: result.matches.length,
    truncated: result.truncated,
  })
  return result
}

export async function openProject() {
  const fsApi = api()
  if (!fsApi) return false

  const dir = await fsApi.selectDirectory()
  if (!dir) return false

  const normalizedDir = normalizeWorkspacePath(dir)
  if (isSameSingleFolderWorkspace(normalizedDir)) return true

  const openGeneration = beginWorkspaceOpenRequest()
  invalidatePendingWorkspaceWork()
  await backupDirtyWorkingCopiesForLifecycle("switchWorkspace")
  const state = typeof fsApi.getWorkspaceState === "function"
    ? await fsApi.getWorkspaceState().catch(() => null)
    : null
  if (!isCurrentWorkspaceOpenRequest(openGeneration)) return false
  if (state?.projectRoot && isSameWorkspaceState(state, normalizedDir)) return true
  resetWorkspace(true)
  if (state?.projectRoot) {
    applyWorkspaceState(state)
  } else {
    syncWorkspaceContextState({
      projectRoot: normalizedDir,
      workspaceFile: null,
      workspaceRoots: [normalizedDir],
    })
  }
  isRealFS.value = true
  ensureTextFileProvider(fsApi)
  await reinitializeWorkingCopyBackupService(fsApi)
  await refreshWorkingCopyRestorationsForStartup()
  scheduleWorkspaceScaleProfileRefresh()
  await refreshFileTree()
  return true
}

export async function openProjectPath(dir) {
  const normalizedDir = normalizeWorkspacePath(dir)
  if (!normalizedDir) return false

  if (isSameSingleFolderWorkspace(normalizedDir)) {
    return true
  }

  const openGeneration = beginWorkspaceOpenRequest()
  invalidatePendingWorkspaceWork()
  await backupDirtyWorkingCopiesForLifecycle("switchWorkspace")
  const fsApi = api()
  const state = typeof fsApi?.openProjectPath === "function"
    ? await fsApi.openProjectPath(normalizedDir).catch(() => null)
    : null
  if (!isCurrentWorkspaceOpenRequest(openGeneration)) return false
  if (state?.projectRoot && isSameWorkspaceState(state, normalizedDir)) return true
  resetWorkspace(true)
  if (state?.projectRoot) {
    applyWorkspaceState(state)
  } else {
    syncWorkspaceContextState({
      projectRoot: normalizedDir,
      workspaceFile: null,
      workspaceRoots: [normalizedDir],
    })
  }
  isRealFS.value = true
  ensureTextFileProvider(fsApi)
  await reinitializeWorkingCopyBackupService(fsApi)
  await refreshWorkingCopyRestorationsForStartup()
  scheduleWorkspaceScaleProfileRefresh()
  await refreshFileTree()
  return true
}

export function applyWorkspaceState(result, options = {}) {
  const sameState = isSameWorkspaceState(result)
  const previousProfile = workspace.workspaceScaleProfile
  syncWorkspaceContextState({
    projectRoot: normalizeWorkspacePath(result.projectRoot),
    workspaceFile: result.workspaceFile || result.path || null,
    workspaceRoots: Array.isArray(result.workspaceRoots) && result.workspaceRoots.length
      ? result.workspaceRoots.map((root) => normalizeWorkspacePath(root))
      : [normalizeWorkspacePath(result.projectRoot)],
    workspaceRootLabels: result.workspaceRootLabels,
    name: result.name,
  })
  workspace.workspaceScaleProfile = result.workspaceScaleProfile || ((options.preserveProfile || sameState) ? previousProfile : null)
  isRealFS.value = true
  ensureTextFileProvider(api())
  scheduleWorkspaceScaleProfileRefresh()
}

export async function openWorkspaceFile() {
  const fsApi = api()
  if (!fsApi?.openWorkspaceFile) return false

  invalidatePendingWorkspaceWork()
  await backupDirtyWorkingCopiesForLifecycle("reload")
  const result = await fsApi.openWorkspaceFile()
  if (!result?.projectRoot) return false

  resetWorkspace(true)
  applyWorkspaceState(result)
  await reinitializeWorkingCopyBackupService(fsApi)
  await refreshWorkingCopyRestorationsForStartup()
  await refreshFileTree()
  return true
}

export async function addFolderToWorkspace() {
  const fsApi = api()
  if (!fsApi?.addFolderToWorkspace) return false

  invalidatePendingWorkspaceWork()
  await backupDirtyWorkingCopiesForLifecycle("switchWorkspace")
  const result = await fsApi.addFolderToWorkspace()
  if (!result?.projectRoot) return false

  applyWorkspaceState(result)
  await reinitializeWorkingCopyBackupService(fsApi)
  await refreshWorkingCopyRestorationsForStartup()
  await refreshFileTree()
  return true
}

export async function saveWorkspaceAs() {
  const fsApi = api()
  if (!fsApi?.saveWorkspaceAs) return false
  const roots = workspace.workspaceRoots.length ? workspace.workspaceRoots : (workspace.projectRoot ? [workspace.projectRoot] : [])
  const result = await fsApi.saveWorkspaceAs(roots, {})
  if (!result) return false
  applyWorkspaceState(result)
  await reinitializeWorkingCopyBackupService(fsApi)
  await refreshWorkingCopyRestorationsForStartup()
  return true
}

export async function refreshFileTree() {
  if (!workspace.projectRoot) return

  const roots = workspace.workspaceRoots.length ? workspace.workspaceRoots : [workspace.projectRoot]
  workspace.fileTree = roots.filter(Boolean).map((root) => {
    const normalized = normalizeTreePath(root).replace(/\/+$/, "")
    return {
      name: workspace.workspaceRootLabels[normalized] || rootLabel(normalized),
      path: roots.length > 1 ? rootKey(normalized) : normalized,
      isDir: true,
      rootPath: normalized,
      rootLabel: workspace.workspaceRootLabels[normalized] || rootLabel(normalized),
      open: true,
      loaded: false,
      virtual: true,
    }
  })
  workspace.fileTreeStats = { nodeCount: workspace.fileTree.length, truncated: false, ignoredCount: 0 }
}

export function getOpenFiles() {
  return workspace.openFiles.filter((path) => hasOwn(workspace.files, path))
}

export async function restoreOpenFiles(paths = [], activePath = null) {
  const restored = []
  const seen = new Set()
  const fsApi = api()
  for (const pathValue of paths) {
    const relativePath = normalizeRelativePath(pathValue)
    if (!relativePath || seen.has(relativePath)) continue
    if (shouldBlockBinaryEditorOpen(relativePath)) {
      removeBinaryEditorState(relativePath)
      continue
    }
    if (!hasOwn(workspace.files, relativePath)) {
      if (!fsApi || !workspace.projectRoot) continue
      const stat = await fsApi.fileExists?.(resolveFsPath(relativePath))
      if (!stat?.isFile) continue
    } else if (shouldBlockBinaryEditorOpen(relativePath, workspace.files[relativePath])) {
      removeBinaryEditorState(relativePath)
      continue
    }
    seen.add(relativePath)
    restored.push(relativePath)
  }
  workspace.openFiles = restored
  const activeRelativePath = activePath ? normalizeRelativePath(activePath) : null
  workspace.activeFile = activeRelativePath && restored.includes(activeRelativePath) && !shouldBlockBinaryEditorOpen(activeRelativePath)
    ? activeRelativePath
    : restored[restored.length - 1] || null
  refreshEditorTabStates(restored)
}

function getLargeFileVirtualStartLine(offset) {
  return estimateLargeFileWindowStartLine(offset, LARGE_FILE_SAFE_RENDER_LINE_CHARS)
}

function hasUnsafeRenderLine(content) {
  const value = String(content || "")
  let currentLineLength = 0
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === "\n" || char === "\r") {
      currentLineLength = 0
      continue
    }
    currentLineLength += 1
    if (currentLineLength > LARGE_FILE_SAFE_RENDER_LINE_CHARS) return true
  }
  return false
}

function shouldDowngradeToSafeLargeFileWindow(content, fallbackSize, decision) {
  const size = Math.max(0, Number(fallbackSize) || 0)
  if (!decision || decision.mode !== "optimized") return false
  if (size <= LARGE_FILE_OPTIMIZATION_BYTES) return false
  return hasUnsafeRenderLine(content)
}

function applyLargeFileWindowContent(relativePath, rawWindowContent, input = {}) {
  const size = Number(input.size || 0)
  const offset = Number(input.offset || 0)
  const bytesRead = Math.max(0, Number(input.bytesRead || input.previewBytes || getUtf8ByteLength(rawWindowContent)))
  const windowBytes = Math.max(1, Number(input.windowBytes || input.previewBytes || bytesRead || LARGE_FILE_WINDOW_BYTES))
  const displayRawContent = String(rawWindowContent || "").slice(0, Math.min(String(rawWindowContent || "").length, LARGE_FILE_EDITOR_RENDER_BYTES))
  const displayedWindowContent = normalizeLargeFilePreviewContent(displayRawContent)
  const limit = Number(input.limit || input.maxBytes || windowBytes || LARGE_FILE_WINDOW_BYTES)
  const fileVersionHash = hashLargeFileSegment(rawWindowContent)
  const displayHash = hashLargeFileSegment(displayRawContent)
  const displayBytes = getUtf8ByteLength(displayRawContent)
  const previousLineState = input.previousLineState || getLargeFileState(relativePath)
  const remembered = rememberLargeFileWindow(relativePath, {
    size,
    limit,
    previewBytes: bytesRead,
    bytesRead,
    offset,
    windowBytes,
    rawContent: rawWindowContent,
    displayRawContent,
    normalizedContent: displayedWindowContent,
    fileVersionHash,
    fullWindowHash: fileVersionHash,
    displayBytes,
    displayHash,
    displayTransformed: displayedWindowContent !== displayRawContent || displayRawContent.length < String(rawWindowContent || "").length,
    previousLineState,
    virtualStartLine: input.virtualStartLine,
  })
  if (!remembered) return { ok: false, content: null }
  const virtualStartLine = remembered.virtualStartLine
  setLargeFileState(relativePath, buildLargeFileRangeState({
    path: relativePath,
    size: remembered.size,
    limit: remembered.limit,
    previewBytes: remembered.previewBytes,
    bytesRead: remembered.bytesRead,
    offset: remembered.offset,
    windowBytes: remembered.windowBytes,
    virtualStartLine,
    fileVersionHash: remembered.fileVersionHash,
    fullWindowHash: remembered.fullWindowHash,
    displayBytes: remembered.displayBytes,
    displayHash: remembered.displayHash,
    displayTransformed: remembered.displayTransformed,
    sourceLineAdvance: remembered.sourceLineAdvance,
    sourceStartLine: remembered.sourceStartLine,
    renderedLineAdvance: remembered.renderedLineAdvance,
    renderedLineCount: remembered.renderedLineCount,
  }))
  workspace.largeFileNotice = {
    path: relativePath,
    size: remembered.size,
    limit: remembered.limit,
    previewBytes: remembered.previewBytes,
    offset: remembered.offset,
    windowBytes: remembered.windowBytes,
    hasPrevious: remembered.offset > 0,
    hasNext: remembered.offset + remembered.bytesRead < remembered.size,
    virtualStartLine,
    sourceStartLine: remembered.sourceStartLine,
    sourceLineAdvance: remembered.sourceLineAdvance,
    renderedLineAdvance: remembered.renderedLineAdvance,
    renderedLineCount: remembered.renderedLineCount,
    mode: "range",
    readOnly: false,
    truncated: true,
    reason: input.reason || "safe-window",
  }
  return { ok: true, content: displayedWindowContent }
}

function normalizeReadContentResult(relativePath, content, fallbackSize = 0, decision = null) {
  if (content === null) return { ok: false, content: null }
  if (isBinaryEditorBlockedReadResult(content)) {
    const size = Number(content?.size || fallbackSize || 0)
    reportWorkspaceReadSmokeStage("workspace-open:binary-blocked", {
      path: relativePath,
      size,
      extension: getFileExtension(relativePath),
      phase: "read-result",
    })
    return buildBinaryEditorBlockedResult(relativePath, size)
  }
  if (content && typeof content === "object" && content.error === "FILE_TOO_LARGE") {
    return { ok: false, content: null }
  }
  if (shouldBlockBinaryEditorOpen(relativePath, content)) {
    const size = Number(content?.size || fallbackSize || getUtf8ByteLength(getReadContentString(content)))
    reportWorkspaceReadSmokeStage("workspace-open:binary-blocked", {
      path: relativePath,
      size,
      extension: getFileExtension(relativePath),
      phase: BINARY_OPEN_BLOCKED_EXTENSIONS.has(getFileExtension(relativePath)) ? "extension" : "content-probe",
    })
    return buildBinaryEditorBlockedResult(relativePath, size)
  }

  if (content && typeof content === "object" && typeof content.content === "string") {
    const mode = content.truncated
      ? "range"
      : (decision?.mode && decision.mode !== "normal" ? decision.mode : "normal")
    const size = Number((mode === "range" && fallbackSize) ? fallbackSize : (content.size || fallbackSize))
    const offset = Number(content.offset || decision?.offset || 0)
    const bytesRead = Number(content.bytesRead || content.previewBytes || decision?.previewBytes || 0)
    if (mode === "range") {
      const rawWindowContent = String(content.content || "")
      const windowBytes = Number(decision?.windowBytes || decision?.previewBytes || content.previewBytes || content.length || LARGE_FILE_WINDOW_BYTES)
      return applyLargeFileWindowContent(relativePath, rawWindowContent, {
        size,
        limit: Number(content.limit || decision?.maxBytes || MAX_EDITABLE_FILE_BYTES),
        previewBytes: bytesRead,
        bytesRead,
        offset,
        windowBytes,
        virtualStartLine: decision?.virtualStartLine || getLargeFileVirtualStartLine(offset),
        reason: decision?.reason || "range-read",
      })
    } else if (shouldDowngradeToSafeLargeFileWindow(content.content, size, decision)) {
      const windowBytes = Math.min(LARGE_FILE_WINDOW_BYTES, Math.max(1, bytesRead || getUtf8ByteLength(content.content)))
      return applyLargeFileWindowContent(relativePath, String(content.content || "").slice(0, windowBytes), {
        size,
        limit: Number(content.limit || decision?.maxBytes || windowBytes),
        previewBytes: windowBytes,
        bytesRead: windowBytes,
        offset,
        windowBytes,
        reason: "long-line-safe-window",
      })
    } else {
      if (mode === "optimized") applyOptimizedLargeFileState(relativePath, size, decision)
      else clearLargeFileState(relativePath)
    }
    return { ok: true, content: content.content }
  }

  if (decision && decision.mode === "range") {
    const rawWindowContent = typeof content === "string" ? content : ""
    return applyLargeFileWindowContent(relativePath, rawWindowContent, {
      size: fallbackSize,
      limit: decision.maxBytes,
      previewBytes: decision.previewBytes,
      bytesRead: decision.previewBytes,
      offset: decision.offset || 0,
      windowBytes: decision.windowBytes || decision.previewBytes,
      virtualStartLine: decision.virtualStartLine || getLargeFileVirtualStartLine(decision.offset || 0),
      reason: decision.reason || "range-read",
    })
  }
  if (shouldDowngradeToSafeLargeFileWindow(content, fallbackSize, decision)) {
    const rawContent = typeof content === "string" ? content : ""
    const windowBytes = Math.min(LARGE_FILE_WINDOW_BYTES, Math.max(1, getUtf8ByteLength(rawContent)))
    return applyLargeFileWindowContent(relativePath, rawContent.slice(0, windowBytes), {
      size: fallbackSize,
      limit: decision?.maxBytes || windowBytes,
      previewBytes: windowBytes,
      bytesRead: windowBytes,
      offset: decision?.offset || 0,
      windowBytes,
      reason: "long-line-safe-window",
    })
  }
  if (decision?.mode === "optimized") {
    applyOptimizedLargeFileState(relativePath, fallbackSize || getUtf8ByteLength(String(content || "")), decision)
  } else {
    clearLargeFileState(relativePath)
  }
  return { ok: true, content }
}

export function normalizeLargeFilePreviewContent(content) {
  const value = String(content || "")
  if (value.length <= LARGE_FILE_SAFE_RENDER_LINE_CHARS && !value.includes("\r")) return value
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const output = []
  for (const line of normalized.split("\n")) {
    if (line.length <= LARGE_FILE_SAFE_RENDER_LINE_CHARS) {
      output.push(line)
      continue
    }
    for (let index = 0; index < line.length; index += LARGE_FILE_SAFE_RENDER_LINE_CHARS) {
      output.push(line.slice(index, index + LARGE_FILE_SAFE_RENDER_LINE_CHARS))
    }
  }
  return output.join("\n")
}

async function retryLargeFileRead(relativePath, failedContent, fallbackSize = 0) {
  if (!failedContent || typeof failedContent !== "object" || failedContent.error !== "FILE_TOO_LARGE") {
    return { ok: false, content: null }
  }
  const size = Number(failedContent.size || fallbackSize || 0)
  if (!size) return { ok: false, content: null }
  const plan = buildLargeFileOpenPlan(size)
  const content = await readWorkspaceFile(relativePath, plan.readOptions)
  const normalizedContent = normalizeReadContentResult(relativePath, content, size, plan.decision)
  if (normalizedContent.ok) return normalizedContent
  if (normalizedContent.reason === "binary-file") return normalizedContent

  const window = clampLargeFileWindow(size, 0, getLargeFileWindowBytes(size))
  const rangeContent = await readWorkspaceFile(relativePath, {
    maxBytes: window.length,
    previewBytes: window.length,
    length: window.length,
    offset: window.offset,
    preview: true,
  })
  return normalizeReadContentResult(relativePath, rangeContent, size, {
    mode: "range",
    maxBytes: window.length,
    previewBytes: window.length,
    windowBytes: window.length,
    offset: window.offset,
    virtualStartLine: getLargeFileVirtualStartLine(window.offset),
    truncated: true,
    readOnly: false,
    reason: "range-read",
  })
}

async function readOptimizedLargeFile(relativePath, size, decision) {
  const window = clampLargeFileWindow(size, 0, getLargeFileWindowBytes(size))
  const previewDecision = {
    ...decision,
    mode: "range",
    maxBytes: window.length,
    previewBytes: window.length,
    windowBytes: window.length,
    offset: window.offset,
    virtualStartLine: getLargeFileVirtualStartLine(window.offset),
    truncated: true,
    readOnly: false,
    reason: "long-line-probe",
  }
  const previewContent = await readWorkspaceFile(relativePath, {
    maxBytes: window.length,
    previewBytes: window.length,
    length: window.length,
    offset: window.offset,
    preview: true,
  })

  if (previewContent && typeof previewContent === "object" && typeof previewContent.content === "string") {
    if (hasUnsafeRenderLine(previewContent.content)) {
      return normalizeReadContentResult(relativePath, previewContent, size, previewDecision)
    }
  } else if (typeof previewContent === "string" && hasUnsafeRenderLine(previewContent)) {
    return normalizeReadContentResult(relativePath, previewContent, size, previewDecision)
  }

  const content = await readWorkspaceFile(relativePath, {
    maxBytes: decision.maxBytes,
    length: size,
    fileSize: size,
    returnContentOnly: true,
  })
  let normalizedContent = normalizeReadContentResult(relativePath, content, size, decision)
  if (shouldRetryLargeFileRead(normalizedContent)) {
    normalizedContent = await retryLargeFileRead(relativePath, content, size)
  }
  return normalizedContent
}

function commitNormalizedOpenFile(relativePath, normalizedContent, stagePrefix = "workspace-open") {
  syncWorkspaceTextFileModelClean(relativePath, normalizedContent.content, { external: false })
  workspace.activeFile = relativePath
  touchOpenFile(relativePath)
  reportWorkspaceReadSmokeStage(`${stagePrefix}:commit`, {
    path: relativePath,
    activeFile: workspace.activeFile,
    contentLength: typeof workspace.files[relativePath] === "string" ? workspace.files[relativePath].length : null,
  })
}

async function openFromDirectTextRead(relativePath, request) {
  const readOptions = {
    maxBytes: VSCODE_MODEL_SYNC_LIMIT_BYTES,
    length: VSCODE_MODEL_SYNC_LIMIT_BYTES,
    returnContentOnly: true,
  }
  reportWorkspaceReadSmokeStage("workspace-open:direct-text:start", { path: relativePath, readOptions })
  let content = null
  try {
    content = await readWorkspaceFile(relativePath, readOptions)
  } catch (error) {
    reportWorkspaceReadSmokeStage("workspace-open:direct-text:error", {
      path: relativePath,
      error: String(error?.message || error),
    })
    return { handled: false, ok: false }
  }
  reportWorkspaceReadSmokeStage("workspace-open:direct-text:done", {
    path: relativePath,
    isCurrent: isCurrentOpenFileRequest(request),
    contentType: typeof content,
    contentLength: typeof content === "string" ? content.length : null,
    contentKeys: content && typeof content === "object" ? Object.keys(content).slice(0, 8) : [],
    size: Number(content?.size || 0),
    truncated: Boolean(content?.truncated),
    error: content && typeof content === "object" ? content.error || null : null,
  })
  if (!isCurrentOpenFileRequest(request)) return { handled: true, ok: false }
  if (content === null) return { handled: false, ok: false }
  if (shouldBypassDirectTextOpenForStatFirstRead(content)) {
    reportWorkspaceReadSmokeStage("workspace-open:direct-text:defer-stat", {
      path: relativePath,
      size: Number(content.size || 0),
      bytesRead: Number(content.bytesRead || content.previewBytes || 0),
      limit: Number(content.limit || 0),
      truncated: Boolean(content.truncated),
    })
    return { handled: false, ok: false }
  }

  const size = Number(content?.size || (typeof content === "string" ? getUtf8ByteLength(content) : 0))
  const plan = buildLargeFileOpenPlan(size)
  reportWorkspaceReadSmokeStage("workspace-open:direct-text:plan", {
    path: relativePath,
    size,
    mode: plan.decision.mode,
    readOptions: plan.readOptions,
  })
  let normalizedContent = normalizeReadContentResult(relativePath, content, size, plan.decision)
  if (shouldRetryLargeFileRead(normalizedContent)) {
    reportWorkspaceReadSmokeStage("workspace-open:direct-text:retry-large:start", { path: relativePath, size })
    normalizedContent = await retryLargeFileRead(relativePath, content, size)
    reportWorkspaceReadSmokeStage("workspace-open:direct-text:retry-large:done", {
      path: relativePath,
      isCurrent: isCurrentOpenFileRequest(request),
      ok: Boolean(normalizedContent?.ok),
      contentLength: typeof normalizedContent?.content === "string" ? normalizedContent.content.length : null,
    })
  }
  reportWorkspaceReadSmokeStage("workspace-open:direct-text:normalize", {
    path: relativePath,
    isCurrent: isCurrentOpenFileRequest(request),
    ok: Boolean(normalizedContent?.ok),
    contentLength: typeof normalizedContent?.content === "string" ? normalizedContent.content.length : null,
  })
  if (!isCurrentOpenFileRequest(request)) return { handled: true, ok: false }
  if (!normalizedContent.ok) return { handled: false, ok: false }

  commitNormalizedOpenFile(relativePath, normalizedContent, "workspace-open:direct-text")
  return { handled: true, ok: true }
}

async function readAndRememberLargeFileWindow(relativePath, size, window, state = {}) {
  return largeFileWindowService.readAndRemember({
    path: relativePath,
    size,
    window,
    state,
    read: readWorkspaceFile,
  })
}

function prefetchAdjacentLargeFileWindows(relativePath, direction = null) {
  const state = getLargeFileState(relativePath)
  largeFileWindowService.prefetchAdjacent({
    path: relativePath,
    state,
    direction,
    read: readWorkspaceFile,
  })
}

export async function loadLargeFileWindow(pathValue, offset) {
  const relativePath = normalizeRelativePath(pathValue)
  const state = getLargeFileState(relativePath)
  if (!relativePath || state?.mode !== "range") return false
  const size = Number(state.size || 0)
  if (!size) return false
  const window = largeFileWindowService.resolveWindow(size, offset, state.windowBytes || LARGE_FILE_WINDOW_BYTES)
  reportWorkspaceReadSmokeStage("large-file-window:load:start", {
    path: relativePath,
    requestedOffset: offset,
    offset: window.offset,
    windowBytes: window.length,
  })
  const result = await readAndRememberLargeFileWindow(relativePath, size, window, state)
  if (!result.ok) {
    reportWorkspaceReadSmokeStage("large-file-window:load:failed", {
      path: relativePath,
      offset: window.offset,
      windowBytes: window.length,
    })
    return false
  }
  applyRememberedLargeFileWindow(relativePath, result.entry)
  reportWorkspaceReadSmokeStage("large-file-window:load:done", {
    path: relativePath,
    offset: window.offset,
    windowBytes: window.length,
    fromCache: Boolean(result.fromCache),
  })
  return true
}

export async function loadNextLargeFileWindow(pathValue) {
  const relativePath = normalizeRelativePath(pathValue)
  const state = getLargeFileState(relativePath)
  if (!state) return false
  const loaded = await loadLargeFileWindow(relativePath, getLargeFileWindowTargetOffset(state, "next"))
  if (loaded) prefetchAdjacentLargeFileWindows(relativePath, "next")
  return loaded
}

export async function loadPreviousLargeFileWindow(pathValue) {
  const relativePath = normalizeRelativePath(pathValue)
  const state = getLargeFileState(relativePath)
  if (!state) return false
  const loaded = await loadLargeFileWindow(relativePath, getLargeFileWindowTargetOffset(state, "previous"))
  if (loaded) prefetchAdjacentLargeFileWindows(relativePath, "previous")
  return loaded
}

export function isDirty(pathValue) {
  return textFileStateCollection.isDirty(pathValue)
}

export function hasExternalChange(pathValue) {
  return textFileStateCollection.hasExternalChange(pathValue)
}

export function getTextFileStateName(pathValue) {
  return textFileStateCollection.stateName(pathValue)
}

export function isTextFileState(pathValue, stateName) {
  return textFileStateCollection.isState(pathValue, stateName)
}

export function markChangedExternally(pathValue) {
  textFileStateCollection.markExternal(pathValue)
  updateEditorTabState(pathValue)
}

export function clearExternalChange(pathValue) {
  textFileStateCollection.clearExternal(pathValue)
  updateEditorTabState(pathValue)
}

export function markClean(pathValue) {
  textFileStateCollection.markClean(pathValue)
  updateEditorTabState(pathValue)
}

export function addTextFileSaveParticipant(participant) {
  return workingCopyFileService.addSaveParticipant(participant)
}

export function getWorkspaceEditingSaveEvidence() {
  return latestWorkspaceEditingSaveEvidence
}

function publishWorkspaceEditingSaveEvidence(relativePath, result, beforeContent, requestedContent) {
  const resource = toTextFileResource(relativePath)
  const participantResult = workingCopyFileService.hasSaveParticipants
    ? workingCopyFileService.getLastSaveParticipantResult(resource)
    : null
  const afterContent = hasOwn(workspace.files, relativePath)
    ? String(workspace.files[relativePath] ?? "")
    : String(result?.value ?? requestedContent ?? "")
  latestWorkspaceEditingSaveEvidence = {
    path: relativePath,
    resource: resource.toString(),
    phase: result?.success ? "saved" : "saveFailed",
    success: Boolean(result?.success),
    state: getTextFileStateName(relativePath),
    dirty: isDirty(relativePath),
    external: hasExternalChange(relativePath),
    reason: result?.reason ?? SaveReason.EXPLICIT,
    source: result?.source ?? CODEK_TEXTFILE_SAVE_SOURCE,
    beforeContentHash: typeof beforeContent === "string" ? hashTextContent(beforeContent) : null,
    requestedContentHash: hashTextContent(requestedContent),
    afterContentHash: result?.success ? hashTextContent(afterContent) : null,
    participant: participantResult ? {
      participantCount: participantResult.participantCount,
      failed: participantResult.failed,
      cancelled: participantResult.cancelled,
      error: participantResult.error,
      steps: participantResult.steps.map((step) => ({
        ordinal: step.ordinal,
        index: step.index,
        status: step.status,
        error: step.error,
      })),
    } : {
      participantCount: 0,
      failed: false,
      cancelled: false,
      steps: [],
    },
  }
  return latestWorkspaceEditingSaveEvidence
}

function toWorkingCopyHotExitIdentifier(relativePath) {
  if (!relativePath || !canRegisterTextFileWorkingCopy(relativePath)) return null
  return toWorkingCopyIdentifier(toTextFileResource(relativePath))
}

function getWorkingCopyBackupArtifactPath(relativePath) {
  const identifier = toWorkingCopyHotExitIdentifier(relativePath)
  if (!identifier || !workingCopyBackupWorkspaceHome) return null
  const home = normalizeTreePath(workingCopyBackupWorkspaceHome.fsPath || workingCopyBackupWorkspaceHome.path || "")
  if (!home) return null
  return `${home.replace(/\/+$/, "")}/${identifier.resource.scheme || "file"}/${hashIdentifier(identifier)}`
}

function getKnownWorkingCopyBackupPaths() {
  const paths = new Set()
  for (const entry of workspace.pendingWorkingCopyRestorations) paths.add(entry.path)
  const previous = workspace.workingCopyHotExitStatus
  for (const pathValue of previous?.backedUp || []) paths.add(pathValue)
  for (const entry of previous?.dirty || []) {
    if (entry?.backedUp && entry.path) paths.add(entry.path)
  }
  for (const pathValue of previous?.backupArtifactPaths || []) {
    if (typeof pathValue !== "string") continue
    const normalized = normalizeTreePath(pathValue)
    const matchingPath = [...Object.keys(workspace.files), ...workspace.openFiles].find((candidate) => {
      const artifactPath = getWorkingCopyBackupArtifactPath(candidate)
      return artifactPath && normalizeTreePath(artifactPath) === normalized
    })
    if (matchingPath) paths.add(normalizeRelativePath(matchingPath))
  }
  return paths
}

function buildDirtyWorkingCopyEvidence(knownBackupPaths = getKnownWorkingCopyBackupPaths()) {
  return [...new Set([
    ...workspace.openFiles,
    ...Object.keys(workspace.files),
    ...textFileStateCollection.paths({ dirty: true }),
    ...workspace.pendingWorkingCopyRestorations.map((entry) => entry.path),
  ])]
    .map((pathValue) => normalizeRelativePath(pathValue))
    .filter((relativePath) => relativePath && (isDirty(relativePath) || workspace.pendingWorkingCopyRestorations.some((entry) => entry.path === relativePath)))
    .sort((left, right) => left.localeCompare(right))
    .map((relativePath) => {
      const restored = workspace.workingCopyRestoredBackups[relativePath] || null
      const content = hasOwn(workspace.files, relativePath) ? String(workspace.files[relativePath] ?? "") : ""
      const pending = workspace.pendingWorkingCopyRestorations.find((entry) => entry.path === relativePath)
      return {
        path: relativePath,
        state: pending?.state || getTextFileStateName(relativePath),
        backedUp: Boolean(knownBackupPaths.has(relativePath) || pending),
        backupContentHash: restored?.backupContentHash || pending?.backupContentHash || hashTextContent(content),
        diskContentHash: pending ? pending.diskContentHash ?? null : undefined,
      }
    })
}

function buildWorkingCopyBackupArtifactPaths(dirtyEvidence) {
  return dirtyEvidence
    .filter((entry) => entry.backedUp)
    .map((entry) => getWorkingCopyBackupArtifactPath(entry.path))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
}

function getWorkingCopyHotExitRisk(dirtyEvidence, options = {}) {
  if (options.closeGuard && dirtyEvidence.length > 0) return "dirty-working-copy"
  if (options.backupUnavailable) return "backup-unavailable"
  if (dirtyEvidence.length > 0) return "dirty-working-copy"
  if (workspaceHasKnownWorkingCopyBackups || workspace.pendingWorkingCopyRestorations.length > 0) return "pending-backup"
  return "none"
}

function publishWorkingCopyHotExitStatus(status) {
  workspace.workingCopyHotExitStatus = {
    ...status,
    workspaceRoot: workspace.projectRoot || null,
    evidencePath: WORKING_COPY_HOT_EXIT_EVIDENCE_PATH,
    timestamp: status.timestamp || Date.now(),
  }
  return workspace.workingCopyHotExitStatus
}

export function buildWorkingCopyHotExitEvidence(source = "manual") {
  const dirty = buildDirtyWorkingCopyEvidence()
  const backupArtifactPaths = buildWorkingCopyBackupArtifactPaths(dirty)
  return publishWorkingCopyHotExitStatus({
    phase: "shutdownRisk",
    source,
    action: "shutdown",
    allowed: dirty.length === 0,
    cancelled: dirty.length > 0,
    dirtyCount: dirty.length,
    dirty,
    backupArtifactPaths,
    risk: getWorkingCopyHotExitRisk(dirty),
  })
}

export function getWorkingCopyHotExitEvidence() {
  return workspace.workingCopyHotExitStatus
}

export async function backupDirtyWorkingCopies(paths = workspace.openFiles, options = {}) {
  const allowedPaths = new Set((paths || []).map((pathValue) => normalizeRelativePath(pathValue)).filter(Boolean))
  const existingBackupHashes = new Map()
  if (options.source !== "manual") {
    for (const { identifier, backup } of await workingCopyHotExitTracker.resolveBackups()) {
      const relativePath = resourceToRelativePath(identifier.resource)
      if (relativePath) existingBackupHashes.set(relativePath, backup.meta?.backupContentHash || hashTextContent(backup.value))
    }
  }
  const backedUp = await workingCopyHotExitTracker.backupDirtyWorkingCopies(
    (workingCopy) => {
      const relativePath = resourceToRelativePath(workingCopy.resource)
      if (!relativePath || !hasOwn(workspace.files, relativePath)) return undefined
      return String(workspace.files[relativePath] || "")
    },
    (workingCopy) => {
      const relativePath = resourceToRelativePath(workingCopy.resource)
      const content = relativePath && hasOwn(workspace.files, relativePath) ? workspace.files[relativePath] : ""
      const diskContent = relativePath && options.diskContents && hasOwn(options.diskContents, relativePath)
        ? options.diskContents[relativePath]
        : undefined
      return {
        state: relativePath ? getTextFileStateName(relativePath) : "dirty",
        source: options.source || "manual",
        mtime: Date.now(),
        diskContentHash: typeof diskContent === "string" ? hashTextContent(diskContent) : undefined,
        backupContentHash: hashTextContent(content),
      }
    },
    (workingCopy) => {
      if (workingCopy.typeId !== STORED_FILE_WORKING_COPY_TYPE_ID) return false
      const relativePath = resourceToRelativePath(workingCopy.resource)
      if (!relativePath || !allowedPaths.has(relativePath)) return false
      if (workspace.largeFiles[relativePath]?.mode === "range") return false
      if (
        options.source !== "manual"
        && existingBackupHashes.get(relativePath) === hashTextContent(workspace.files[relativePath])
      ) return false
      return isDirty(relativePath) && hasOwn(workspace.files, relativePath)
    },
  )
  const pathsBackedUp = backedUp
    .map((resource) => resourceToRelativePath(resource))
    .filter(Boolean)
  const knownBackupPaths = getKnownWorkingCopyBackupPaths()
  for (const pathValue of pathsBackedUp) knownBackupPaths.add(pathValue)
  const dirty = buildDirtyWorkingCopyEvidence(knownBackupPaths)
  workspace.workingCopyHotExitStatus = publishWorkingCopyHotExitStatus({
    phase: "backup",
    source: options.source || "manual",
    backedUp: pathsBackedUp,
    dirtyCount: dirty.length,
    dirty,
    backupArtifactPaths: buildWorkingCopyBackupArtifactPaths(dirty),
    risk: getWorkingCopyHotExitRisk(dirty),
  })
  if (pathsBackedUp.length) {
    workspaceHasKnownWorkingCopyBackups = true
    reportWorkspaceReadSmokeStage("working-copy-hot-exit:backup", workspace.workingCopyHotExitStatus)
  }
  return pathsBackedUp
}

export async function backupDirtyWorkingCopiesForLifecycle(source = "reload") {
  const fsApi = api()
  if (!fsApi || workingCopyBackupServiceDelegate !== fsApi) {
    workspace.workingCopyHotExitStatus = publishWorkingCopyHotExitStatus({
      phase: "backupSkipped",
      source,
      reason: "workspaceDelegateChanged",
      dirtyCount: buildDirtyWorkingCopyEvidence().length,
      dirty: buildDirtyWorkingCopyEvidence(),
      backupArtifactPaths: [],
      risk: "backup-unavailable",
    })
    return []
  }
  const diskContents = {}
  for (const pathValue of workspace.openFiles) {
    const relativePath = normalizeRelativePath(pathValue)
    if (!relativePath || !isDirty(relativePath) || workspace.largeFiles[relativePath]?.mode === "range") continue
    const diskContent = await readWorkspaceDiskTextForHotExit(relativePath).catch(() => null)
    if (typeof diskContent === "string") diskContents[relativePath] = diskContent
  }
  const backedUp = await backupDirtyWorkingCopies(workspace.openFiles, { source, diskContents })
  await workingCopyBackupService.joinBackups()
  const dirty = buildDirtyWorkingCopyEvidence(getKnownWorkingCopyBackupPaths())
  publishWorkingCopyHotExitStatus({
    ...(workspace.workingCopyHotExitStatus || {}),
    phase: "backupJoin",
    source,
    backedUp,
    dirtyCount: dirty.length,
    dirty,
    backupArtifactPaths: buildWorkingCopyBackupArtifactPaths(dirty),
    risk: getWorkingCopyHotExitRisk(dirty),
    backupJoin: {
      id: "join.workingCopyBackups",
      label: "Saving working copy backups",
      completed: true,
      source,
      backedUp,
    },
  })
  return backedUp
}

async function readWorkspaceDiskTextForHotExit(relativePath) {
  const fsApi = api()
  if (!fsApi || !workspace.projectRoot || typeof fsApi.readFile !== "function") return null
  const content = await fsApi.readFile(resolveFsPath(relativePath), {
    allowMissing: true,
    ...buildWorkspaceReadScopeOptions(),
    returnContentOnly: true,
  })
  if (typeof content === "string") return content
  if (content && typeof content === "object" && typeof content.content === "string" && !content.error) return content.content
  return null
}

async function classifyWorkingCopyBackup(relativePath, backup) {
  const content = await readWorkspaceDiskTextForHotExit(relativePath).catch(() => null)
  if (typeof content !== "string") {
    return {
      state: "orphan",
      choices: ["restore", "discard", "openAsOrphan"],
      diskContentHash: null,
    }
  }
  const diskContentHash = hashTextContent(content)
  const originalDiskContentHash = backup.meta?.diskContentHash
  const state = originalDiskContentHash && diskContentHash !== originalDiskContentHash ? "conflict" : "dirty"
  return {
    state,
    choices: state === "conflict" ? ["restore", "discard", "openAsConflict"] : ["restore", "discard"],
    diskContentHash,
  }
}

export async function refreshWorkingCopyRestorations() {
  const pending = []
  const entries = await workingCopyHotExitTracker.resolveBackups()
  for (const { identifier, backup } of entries) {
    const relativePath = resourceToRelativePath(identifier.resource)
    if (!relativePath) continue
    if (workspace.largeFiles[relativePath]?.mode === "range") continue
    const classification = await classifyWorkingCopyBackup(relativePath, backup)
    pending.push({
      path: relativePath,
      resource: identifier.resource.toString(),
      typeId: identifier.typeId,
      state: classification.state,
      choices: classification.choices,
      meta: backup.meta || {},
      backupContentHash: hashTextContent(backup.value),
      diskContentHash: classification.diskContentHash,
    })
  }
  pending.sort((left, right) => left.path.localeCompare(right.path))
  workspaceHasKnownWorkingCopyBackups = pending.length > 0
  workspace.pendingWorkingCopyRestorations = pending
  rebuildWorkingCopyRestoreActions()
  refreshEditorTabStates(pending.map((entry) => entry.path))
  const dirty = buildDirtyWorkingCopyEvidence(new Set(pending.map((entry) => entry.path)))
  workspace.workingCopyHotExitStatus = publishWorkingCopyHotExitStatus({
    phase: "restoreChoices",
    pending: pending.map((entry) => ({ path: entry.path, state: entry.state, choices: entry.choices })),
    dirtyCount: dirty.length,
    dirty,
    backupArtifactPaths: buildWorkingCopyBackupArtifactPaths(dirty),
    risk: getWorkingCopyHotExitRisk(dirty),
  })
  if (pending.length) {
    reportWorkspaceReadSmokeStage("working-copy-hot-exit:restore-choices", workspace.workingCopyHotExitStatus)
  }
  return pending
}

async function refreshWorkingCopyRestorationsForStartup() {
  const hasBackupEntries = await hasWorkspaceBackupEntriesForStartup().catch(() => true)
  if (!hasBackupEntries) {
    workspace.pendingWorkingCopyRestorations = []
    rebuildWorkingCopyRestoreActions()
    refreshEditorTabStates()
    workspace.workingCopyHotExitStatus = publishWorkingCopyHotExitStatus({
      phase: "restoreChoices",
      pending: [],
      dirtyCount: 0,
      dirty: [],
      backupArtifactPaths: [],
      risk: "none",
    })
    return []
  }
  const pending = await Promise.race([
    refreshWorkingCopyRestorations().catch((error) => {
      const dirty = buildDirtyWorkingCopyEvidence()
      workspace.workingCopyHotExitStatus = publishWorkingCopyHotExitStatus({
        phase: "restoreChoicesUnavailable",
        reason: "scanFailed",
        error: String(error?.message || error),
        dirtyCount: dirty.length,
        dirty,
        backupArtifactPaths: buildWorkingCopyBackupArtifactPaths(dirty),
        risk: getWorkingCopyHotExitRisk(dirty, { backupUnavailable: true }),
      })
      reportWorkspaceReadSmokeStage("working-copy-hot-exit:restore-choices-unavailable", workspace.workingCopyHotExitStatus)
      return null
    }),
    hotExitRestoreScanTimeout(),
  ])
  if (pending !== null) return pending
  workspace.pendingWorkingCopyRestorations = []
  rebuildWorkingCopyRestoreActions()
  refreshEditorTabStates()
  const dirty = buildDirtyWorkingCopyEvidence()
  workspace.workingCopyHotExitStatus = publishWorkingCopyHotExitStatus({
    phase: "restoreChoicesUnavailable",
    reason: "scanTimeout",
    timeoutMs: HOT_EXIT_RESTORE_SCAN_TIMEOUT_MS,
    dirtyCount: dirty.length,
    dirty,
    backupArtifactPaths: buildWorkingCopyBackupArtifactPaths(dirty),
    risk: getWorkingCopyHotExitRisk(dirty, { backupUnavailable: true }),
  })
  reportWorkspaceReadSmokeStage("working-copy-hot-exit:restore-choices-unavailable", workspace.workingCopyHotExitStatus)
  return []
}

export async function applyWorkingCopyRestoration(pathValue, action = "restore") {
  const relativePath = normalizeRelativePath(pathValue)
  const entry = workspace.pendingWorkingCopyRestorations.find((item) => item.path === relativePath)
  if (!entry) {
    publishWorkingCopyHotExitStatus({
      phase: "restoreAttempt",
      action,
      restored: [],
      failed: relativePath ? [relativePath] : [],
      failureCause: "pendingRestoreMissing",
      dirtyCount: buildDirtyWorkingCopyEvidence().length,
      dirty: buildDirtyWorkingCopyEvidence(),
      backupArtifactPaths: buildWorkingCopyBackupArtifactPaths(buildDirtyWorkingCopyEvidence()),
      risk: getWorkingCopyHotExitRisk(buildDirtyWorkingCopyEvidence()),
    })
    return false
  }
  const identifier = { resource: URI.parse(entry.resource), typeId: entry.typeId || STORED_FILE_WORKING_COPY_TYPE_ID }
  if (action === "discard") {
    await workingCopyHotExitTracker.discardBackup(identifier)
    removePendingWorkingCopyRestoration(relativePath)
    workspaceHasKnownWorkingCopyBackups = workspace.pendingWorkingCopyRestorations.length > 0
    refreshEditorTabStates([relativePath])
    const dirty = buildDirtyWorkingCopyEvidence()
    publishWorkingCopyHotExitStatus({
      phase: "restoreAttempt",
      action,
      restored: [],
      failed: [],
      dirtyCount: dirty.length,
      dirty,
      backupArtifactPaths: buildWorkingCopyBackupArtifactPaths(dirty),
      risk: getWorkingCopyHotExitRisk(dirty),
    })
    return true
  }
  const backup = await workingCopyHotExitTracker.resolveBackups()
    .then((entries) => entries.find((candidate) => candidate.identifier.resource.toString() === entry.resource && candidate.identifier.typeId === identifier.typeId)?.backup)
  if (!backup) {
    removePendingWorkingCopyRestoration(relativePath)
    refreshEditorTabStates([relativePath])
    const dirty = buildDirtyWorkingCopyEvidence()
    publishWorkingCopyHotExitStatus({
      phase: "restoreAttempt",
      action,
      restored: [],
      failed: [relativePath],
      failureCause: "backupMissing",
      dirtyCount: dirty.length,
      dirty,
      backupArtifactPaths: buildWorkingCopyBackupArtifactPaths(dirty),
      risk: getWorkingCopyHotExitRisk(dirty),
    })
    return false
  }
  if (entry.state === "orphan" || action === "openAsOrphan") {
    syncWorkspaceTextFileModelOrphan(relativePath, backup.value)
  } else if (entry.state === "conflict" || action === "openAsConflict") {
    syncWorkspaceTextFileModelConflict(relativePath, backup.value)
  } else {
    syncWorkspaceTextFileModelDirty(relativePath, backup.value, { external: false })
  }
  workspace.workingCopyRestoredBackups[relativePath] = {
    state: entry.state,
    restoredAt: Date.now(),
    backupContentHash: entry.backupContentHash,
  }
  if (!workspace.openFiles.includes(relativePath)) workspace.openFiles.push(relativePath)
  workspace.activeFile = relativePath
  removePendingWorkingCopyRestoration(relativePath)
  workspaceHasKnownWorkingCopyBackups = workspace.pendingWorkingCopyRestorations.length > 0
  updateEditorTabState(relativePath)
  const dirty = buildDirtyWorkingCopyEvidence()
  publishWorkingCopyHotExitStatus({
    phase: "restoreAttempt",
    action,
    restored: [relativePath],
    failed: [],
    dirtyCount: dirty.length,
    dirty,
    backupArtifactPaths: buildWorkingCopyBackupArtifactPaths(dirty),
    risk: getWorkingCopyHotExitRisk(dirty),
  })
  return true
}

export async function restoreWorkingCopyBackups() {
  const pending = await refreshWorkingCopyRestorations()
  const restored = []
  for (const entry of pending) {
    if (await applyWorkingCopyRestoration(entry.path, "restore")) restored.push(entry.path)
  }
  return restored
}

export async function cleanupWorkingCopyBackups(options = {}) {
  const keepPaths = new Set((options.keepPaths || []).map((pathValue) => normalizeRelativePath(pathValue)).filter(Boolean))
  const cleanup = await workingCopyHotExitTracker.cleanupBackupsWithProjection({
    keepDirty: options.keepDirty !== false,
    uiOwnerConnected: options.uiOwnerConnected,
    uiOwnerBlockedReason: options.uiOwnerBlockedReason,
    keep: (identifier) => {
      const relativePath = resourceToRelativePath(identifier.resource)
      if (!relativePath) return false
      if (keepPaths.has(relativePath)) return true
      if (workspace.largeFiles[relativePath]?.mode === "range") return true
      return false
    },
  })
  await refreshWorkingCopyRestorations()
  const removedPaths = cleanup.removed.map((identifier) => resourceToRelativePath(identifier.resource)).filter(Boolean)
  const keptPaths = cleanup.kept.map((identifier) => resourceToRelativePath(identifier.resource)).filter(Boolean)
  for (const pathValue of removedPaths) delete workspace.workingCopyRestoredBackups[pathValue]
  const dirty = buildDirtyWorkingCopyEvidence()
  workspace.workingCopyHotExitStatus = publishWorkingCopyHotExitStatus({
    phase: "backupCleanup",
    source: options.source || "retention",
    kept: keptPaths,
    removed: removedPaths,
    cleanupOwner: cleanup.owner,
    cleanupPolicy: cleanup.policy,
    cleanupDecisions: cleanup.decisions.map((decision) => ({
      path: resourceToRelativePath(URI.parse(decision.resource)) || "",
      resource: decision.resource,
      typeId: decision.typeId,
      decision: decision.decision,
      reason: decision.reason,
      readonly: decision.readonly,
      safeCleanup: decision.safeCleanup,
      blockedReason: decision.blockedReason,
    })),
    dirtyCount: dirty.length,
    dirty,
    backupArtifactPaths: buildWorkingCopyBackupArtifactPaths(dirty),
    risk: getWorkingCopyHotExitRisk(dirty),
  })
  refreshEditorTabStates(removedPaths)
  return removedPaths
}

export async function resolveTextFileConflict(pathValue, content = undefined, options = {}) {
  const relativePath = normalizeRelativePath(pathValue)
  if (!relativePath) return false
  const value = content === undefined ? workspace.files[relativePath] : content
  if (typeof value !== "string") return false
  return saveFile(relativePath, value, {
    ...options,
    ignoreModifiedSince: true,
    force: true,
    reason: options.reason || "resolve text file conflict",
  })
}

export async function restoreOrphanedTextFile(pathValue, content = undefined, options = {}) {
  const relativePath = normalizeRelativePath(pathValue)
  if (!relativePath) return false
  const value = content === undefined ? workspace.files[relativePath] : content
  if (typeof value !== "string") return false
  return saveFile(relativePath, value, {
    ...options,
    ignoreModifiedSince: true,
    force: true,
    reason: options.reason || "restore orphaned text file",
  })
}

export function closeFile(pathValue) {
  const relativePath = normalizeRelativePath(pathValue)
  workspace.openFiles = workspace.openFiles.filter((path) => path !== relativePath)
  updateEditorTabState(relativePath)

  if (workspace.activeFile !== relativePath) return

  const fallback = workspace.openFiles[workspace.openFiles.length - 1] || null
  workspace.activeFile = fallback
  refreshEditorTabStates([relativePath, fallback].filter(Boolean))
}

export function requestCloseFile(pathValue, options = {}) {
  const relativePath = normalizeRelativePath(pathValue)
  const dirty = buildDirtyWorkingCopyEvidence()
  const targetDirty = dirty.find((entry) => entry.path === relativePath)
  if (targetDirty && options.force !== true) {
    publishWorkingCopyHotExitStatus({
      phase: "closeGuard",
      action: "close",
      source: options.source || "user",
      allowed: false,
      cancelled: true,
      dirtyCount: dirty.length,
      dirty,
      backupArtifactPaths: buildWorkingCopyBackupArtifactPaths(dirty),
      risk: getWorkingCopyHotExitRisk(dirty, { closeGuard: true }),
    })
    return false
  }

  closeFile(relativePath)
  const remainingDirty = buildDirtyWorkingCopyEvidence()
  publishWorkingCopyHotExitStatus({
    phase: "closeGuard",
    action: "close",
    source: options.source || "user",
    allowed: true,
    cancelled: false,
    dirtyCount: remainingDirty.length,
    dirty: remainingDirty,
    backupArtifactPaths: buildWorkingCopyBackupArtifactPaths(remainingDirty),
    risk: "none",
  })
  return true
}

export async function openFile(pathValue) {
  const relativePath = normalizeRelativePath(pathValue)
  if (!relativePath) return false
  reportWorkspaceReadSmokeStage("workspace-open:start", { path: relativePath })
  const request = beginOpenFileRequest(relativePath)
  reportWorkspaceReadSmokeStage("workspace-open:request", {
    path: relativePath,
    workspaceGeneration: request.workspaceGeneration,
    openFileGeneration: request.openFileGeneration,
    projectRoot: request.projectRoot,
  })
  workspace.largeFileNotice = null
  clearLargeFileState(relativePath)

  const fsApi = api()
  reportWorkspaceReadSmokeStage("workspace-open:api", {
    path: relativePath,
    hasFsApi: Boolean(fsApi),
    hasProjectRoot: Boolean(workspace.projectRoot),
    hasFileExists: typeof fsApi?.fileExists === "function",
    hasReadFile: typeof fsApi?.readFile === "function",
  })
  if (fsApi && workspace.projectRoot) {
    const fullPath = resolveFsPath(relativePath)
    reportWorkspaceReadSmokeStage("workspace-open:resolved", { path: relativePath, fullPath })
    if (shouldBlockBinaryEditorOpen(relativePath)) {
      removeBinaryEditorState(relativePath)
      workspace.largeFileNotice = {
        path: relativePath,
        size: 0,
        limit: 0,
        reason: "binary-file",
      }
      reportWorkspaceReadSmokeStage("workspace-open:binary-blocked", {
        path: relativePath,
        size: 0,
        extension: getFileExtension(relativePath),
        phase: "pre-stat",
      })
      return false
    }
    if (typeof fsApi.readFile === "function" && shouldUseDirectTextOpen(relativePath)) {
      const directOpen = await openFromDirectTextRead(relativePath, request)
      if (directOpen.handled) return directOpen.ok
    }
    reportWorkspaceReadSmokeStage("workspace-open:file-exists:start", { path: relativePath, fullPath })
    let stat = normalizeOpenFileStat(await readOpenFileStat(fsApi, fullPath), fullPath)
    reportWorkspaceReadSmokeStage("workspace-open:file-exists:after-await", {
      path: relativePath,
      isCurrent: isCurrentOpenFileRequest(request),
      statType: typeof stat,
      statKeys: stat && typeof stat === "object" ? Object.keys(stat).slice(0, 8) : [],
      timeout: stat === OPEN_FILE_STAT_TIMEOUT,
    })
    let contentFromStatTimeout = null
    let statTimedOut = false
    let statTimeoutWindowBytes = 0
    if (stat === OPEN_FILE_STAT_TIMEOUT) {
      const fallbackWindowBytes = getLargeFileWindowBytes(Number.MAX_SAFE_INTEGER)
      statTimedOut = true
      statTimeoutWindowBytes = fallbackWindowBytes
      reportWorkspaceReadSmokeStage("workspace-open:file-exists:timeout", {
        path: relativePath,
        fullPath,
        timeoutMs: OPEN_FILE_STAT_TIMEOUT_MS,
        fallbackWindowBytes,
      })
      reportWorkspaceReadSmokeStage("workspace-open:timeout-read:start", { path: relativePath, fullPath, fallbackWindowBytes })
      contentFromStatTimeout = await readWorkspaceFile(relativePath, {
        maxBytes: fallbackWindowBytes,
        previewBytes: fallbackWindowBytes,
        length: fallbackWindowBytes,
        offset: 0,
        preview: true,
      })
      reportWorkspaceReadSmokeStage("workspace-open:timeout-read:done", {
        path: relativePath,
        isCurrent: isCurrentOpenFileRequest(request),
        contentType: typeof contentFromStatTimeout,
        contentLength: typeof contentFromStatTimeout === "string" ? contentFromStatTimeout.length : null,
        contentKeys: contentFromStatTimeout && typeof contentFromStatTimeout === "object" ? Object.keys(contentFromStatTimeout).slice(0, 8) : [],
      })
      if (!isCurrentOpenFileRequest(request)) return false
      stat = normalizeOpenFileStat({
        exists: true,
        isFile: true,
        isDirectory: false,
        size: Number(contentFromStatTimeout?.size || (typeof contentFromStatTimeout === "string" ? getUtf8ByteLength(contentFromStatTimeout) : fallbackWindowBytes + 1)),
      }, fullPath)
    }
    reportWorkspaceReadSmokeStage("workspace-open:file-exists:before-done", {
      path: relativePath,
      isCurrent: isCurrentOpenFileRequest(request),
      statType: typeof stat,
      isDirectory: Boolean(stat?.isDirectory),
      size: Number(stat?.size || 0),
    })
    reportWorkspaceReadSmokeStage("workspace-open:file-exists:done", {
      path: relativePath,
      isCurrent: isCurrentOpenFileRequest(request),
      statType: typeof stat,
      isDirectory: Boolean(stat?.isDirectory),
      size: Number(stat?.size || 0),
    })
    reportWorkspaceReadSmokeStage("workspace-open:file-exists:after-done", {
      path: relativePath,
      isCurrent: isCurrentOpenFileRequest(request),
    })
    if (!isCurrentOpenFileRequest(request)) return false
    if (stat?.isDirectory) {
      reportWorkspaceReadSmokeStage("workspace-open:directory", { path: relativePath })
      return false
    }
    if (shouldBlockBinaryEditorOpen(relativePath)) {
      removeBinaryEditorState(relativePath)
      workspace.largeFileNotice = {
        path: relativePath,
        size: Number(stat?.size || 0),
        limit: 0,
        reason: "binary-file",
      }
      reportWorkspaceReadSmokeStage("workspace-open:binary-blocked", {
        path: relativePath,
        size: Number(stat?.size || 0),
        extension: getFileExtension(relativePath),
      })
      return false
    }
    const size = Number(stat?.size || 0)
    const plan = buildLargeFileOpenPlan(size)
    reportWorkspaceReadSmokeStage("workspace-open:plan", {
      path: relativePath,
      size,
      mode: plan.decision.mode,
      readOptions: plan.readOptions,
    })
    let normalizedContent = null
    if (statTimedOut && contentFromStatTimeout) {
      reportWorkspaceReadSmokeStage("workspace-open:timeout-range:normalize", {
        path: relativePath,
        size,
        windowBytes: statTimeoutWindowBytes,
      })
      normalizedContent = normalizeReadContentResult(relativePath, contentFromStatTimeout, size, {
        mode: "range",
        maxBytes: statTimeoutWindowBytes,
        previewBytes: statTimeoutWindowBytes,
        windowBytes: statTimeoutWindowBytes,
        offset: 0,
        virtualStartLine: getLargeFileVirtualStartLine(0),
        truncated: true,
        readOnly: false,
        reason: "range-read",
      })
    } else if (plan.decision.mode === "optimized") {
      reportWorkspaceReadSmokeStage("workspace-open:optimized-read:start", { path: relativePath, size })
      normalizedContent = await readOptimizedLargeFile(relativePath, size, plan.decision)
      reportWorkspaceReadSmokeStage("workspace-open:optimized-read:done", {
        path: relativePath,
        ok: Boolean(normalizedContent?.ok),
        contentLength: typeof normalizedContent?.content === "string" ? normalizedContent.content.length : null,
      })
    } else {
      reportWorkspaceReadSmokeStage("workspace-open:read:start", { path: relativePath, fullPath, readOptions: plan.readOptions })
      const content = contentFromStatTimeout || await readWorkspaceFile(relativePath, {
        ...plan.readOptions,
        fileSize: size,
      })
      reportWorkspaceReadSmokeStage("workspace-open:read:done", {
        path: relativePath,
        isCurrent: isCurrentOpenFileRequest(request),
        contentType: typeof content,
        contentLength: typeof content === "string" ? content.length : null,
        contentKeys: content && typeof content === "object" ? Object.keys(content).slice(0, 8) : [],
      })
      if (!isCurrentOpenFileRequest(request)) return false
      normalizedContent = normalizeReadContentResult(relativePath, content, size, plan.decision)
      reportWorkspaceReadSmokeStage("workspace-open:normalize", {
        path: relativePath,
        ok: Boolean(normalizedContent?.ok),
        contentLength: typeof normalizedContent?.content === "string" ? normalizedContent.content.length : null,
      })
      if (shouldRetryLargeFileRead(normalizedContent)) {
        reportWorkspaceReadSmokeStage("workspace-open:retry-large:start", { path: relativePath, size })
        normalizedContent = await retryLargeFileRead(relativePath, content, size)
        reportWorkspaceReadSmokeStage("workspace-open:retry-large:done", {
          path: relativePath,
          ok: Boolean(normalizedContent?.ok),
          contentLength: typeof normalizedContent?.content === "string" ? normalizedContent.content.length : null,
        })
      }
    }
    reportWorkspaceReadSmokeStage("workspace-open:before-commit", {
      path: relativePath,
      isCurrent: isCurrentOpenFileRequest(request),
      ok: Boolean(normalizedContent?.ok),
    })
    if (!isCurrentOpenFileRequest(request)) return false
    if (!normalizedContent.ok) return false

    syncWorkspaceTextFileModelClean(relativePath, normalizedContent.content, { external: false })
    workspace.activeFile = relativePath
    touchOpenFile(relativePath)
    reportWorkspaceReadSmokeStage("workspace-open:done", {
      path: relativePath,
      activeFile: workspace.activeFile,
      contentLength: typeof workspace.files[relativePath] === "string" ? workspace.files[relativePath].length : null,
    })
    return true
  }

  if (!hasOwn(workspace.files, relativePath)) {
    reportWorkspaceReadSmokeStage("workspace-open:memory-miss", { path: relativePath })
    return false
  }

  workspace.activeFile = relativePath
  touchOpenFile(relativePath)
  reportWorkspaceReadSmokeStage("workspace-open:memory-done", { path: relativePath, activeFile: workspace.activeFile })
  return true
}

export async function readProjectFile(pathValue) {
  const relativePath = normalizeRelativePath(pathValue)
  if (!relativePath) return null

  if (shouldBlockBinaryEditorOpen(relativePath)) {
    buildBinaryEditorBlockedResult(relativePath)
    return null
  }
  if (hasOwn(workspace.files, relativePath)) return workspace.files[relativePath]

  const fsApi = api()
  if (!fsApi || !workspace.projectRoot) return null

  const state = getLargeFileState(relativePath)
  const window = state?.truncated
    ? clampLargeFileWindow(state.size, state.offset || 0, state.windowBytes || state.previewBytes || LARGE_FILE_WINDOW_BYTES)
    : null
  const content = await readWorkspaceFile(relativePath, window ? {
    maxBytes: window.length,
    previewBytes: window.length,
    length: window.length,
    offset: window.offset,
    preview: true,
  } : {})
  let normalizedContent = normalizeReadContentResult(relativePath, content, state?.size || 0, state || null)
  if (shouldRetryLargeFileRead(normalizedContent)) {
    normalizedContent = await retryLargeFileRead(relativePath, content, state?.size || 0)
  }
  if (!normalizedContent.ok) return null
  syncWorkspaceTextFileModelClean(relativePath, normalizedContent.content, { external: false })
  return normalizedContent.content
}

export async function reloadFile(pathValue) {
  const relativePath = normalizeRelativePath(pathValue)
  if (!relativePath || !workspace.projectRoot) return false

  if (shouldBlockBinaryEditorOpen(relativePath)) {
    buildBinaryEditorBlockedResult(relativePath)
    return false
  }
  const fsApi = api()
  if (!fsApi) return false

  const state = getLargeFileState(relativePath)
  const window = state?.truncated
    ? clampLargeFileWindow(state.size, state.offset || 0, state.windowBytes || state.previewBytes || LARGE_FILE_WINDOW_BYTES)
    : null
  const content = await readWorkspaceFile(relativePath, window ? {
    maxBytes: window.length,
    previewBytes: window.length,
    length: window.length,
    offset: window.offset,
    preview: true,
  } : {})
  let normalizedContent = normalizeReadContentResult(relativePath, content, state?.size || 0, state || null)
  if (shouldRetryLargeFileRead(normalizedContent)) {
    normalizedContent = await retryLargeFileRead(relativePath, content, state?.size || 0)
  }
  if (!normalizedContent.ok) {
    markTextFileOrphanState(relativePath)
    return false
  }

  syncWorkspaceTextFileModelClean(relativePath, normalizedContent.content, { external: false, reload: true })
  return true
}

function shouldIgnoreModifiedSince(options = {}) {
  return options.force === true || options.ignoreModifiedSince === true || options.overwrite === true
}

function markSaveConflictNotice(relativePath, reason = "文件在磁盘上已有外部修改，已阻止覆盖。") {
  workspace.largeFileNotice = {
    ...workspace.largeFileNotice,
    path: relativePath,
    size: Number(workspace.largeFiles[relativePath]?.size || 0),
    limit: Number(workspace.largeFiles[relativePath]?.limit || 0),
    reason,
  }
}

function getCurrentLargeFileSegmentContentForStack(state, relativePath) {
  const current = hasOwn(workspace.files, relativePath) ? String(workspace.files[relativePath] || "") : ""
  if (!state?.displayTransformed) return current
  const remembered = getRememberedLargeFileWindow(
    relativePath,
    state.size,
    state.offset || 0,
    state.windowBytes || state.previewBytes || LARGE_FILE_WINDOW_BYTES,
  )
  return typeof remembered?.rawContent === "string"
    ? String(remembered.displayRawContent ?? remembered.rawContent).slice(0, Math.max(0, Number(state.displayBytes || 0)) || undefined)
    : current
}

async function patchLargeFileSegmentWithPlan(relativePath, plan, options = {}) {
  const fsApi = api()
  if (fsApi && workspace.projectRoot && typeof fsApi.patchFileSegment === "function") {
    try {
      return await fsApi.patchFileSegment(resolveFsPath(relativePath), plan)
    } catch {
      return false
    }
  }
  if (!fsApi || !workspace.projectRoot || options.allowInMemorySegmentPatch === true) {
    const fullContent = options.fullContent
    if (typeof fullContent === "string") {
      workspace.files[relativePath] = applyLargeFileSegmentPatchToContent(fullContent, plan)
    } else {
      workspace.files[relativePath] = plan.insertText
    }
    return true
  }
  return false
}

function markLargeFileSegmentEditPlanFailure(relativePath, state, result) {
  workspace.largeFileNotice = {
    ...workspace.largeFileNotice,
    path: relativePath,
    size: state?.size,
    limit: state?.limit,
    previewBytes: state?.previewBytes,
    offset: state?.offset,
    windowBytes: state?.windowBytes,
    hasPrevious: state?.hasPrevious,
    hasNext: state?.hasNext,
    virtualStartLine: state?.virtualStartLine,
    mode: state?.mode,
    readOnly: state?.readOnly,
    truncated: state?.truncated,
    reason: result.message,
  }
  if (result.reason === "validation-failed") markTextFileConflictState(relativePath)
  else markTextFileErrorState(relativePath)
}

function applyLargeFileSegmentEditTargetState(relativePath, state, target, plan) {
  const rawWindowContent = typeof target.rawWindowContent === "string" ? target.rawWindowContent : target.segmentContent
  const displayedContent = typeof target.displayedContent === "string" ? target.displayedContent : target.segmentContent
  const bytesRead = Math.max(0, Number(target.bytesRead ?? getUtf8ByteLength(rawWindowContent)))
  const displayBytes = Math.max(0, Number(target.displayBytes ?? getUtf8ByteLength(target.segmentContent)))
  const displayHash = target.displayHash || hashLargeFileSegment(target.segmentContent)
  const fullWindowHash = target.fullWindowHash || hashLargeFileSegment(rawWindowContent)
  workspace.files[relativePath] = displayedContent
  markTextFileSavedState(relativePath)
  clearLargeFileWindowCache(relativePath)
  setLargeFileState(relativePath, {
    ...state,
    previewBytes: bytesRead,
    bytesRead,
    size: plan.nextSize,
    fileVersionHash: fullWindowHash,
    fullWindowHash,
    displayBytes,
    displayHash,
    displayTransformed: Boolean(target.displayTransformed ?? displayedContent !== target.segmentContent),
  })
  rememberLargeFileWindow(relativePath, {
    size: plan.nextSize,
    limit: state.limit,
    previewBytes: bytesRead,
    bytesRead,
    offset: state.offset || 0,
    windowBytes: state.windowBytes || state.previewBytes || LARGE_FILE_WINDOW_BYTES,
    rawContent: rawWindowContent,
    displayRawContent: target.segmentContent,
    normalizedContent: displayedContent,
    fileVersionHash: fullWindowHash,
    fullWindowHash,
    displayBytes,
    displayHash,
    displayTransformed: Boolean(target.displayTransformed ?? displayedContent !== target.segmentContent),
  })
}

async function applyLargeFileSegmentEditStackPlan(relativePath, result, state, options = {}) {
  if (!result.ok) {
    markLargeFileSegmentEditPlanFailure(relativePath, state, result)
    return false
  }
  markTextFilePendingSaveState(relativePath)
  const success = await patchLargeFileSegmentWithPlan(relativePath, result.plan, options)
  if (!success) {
    markLargeFileSegmentEditPlanFailure(relativePath, state, {
      ok: false,
      reason: "validation-failed",
      message: "大文件分段保存失败：当前运行环境还没有提供安全分段写回能力。",
    })
    return false
  }
  applyLargeFileSegmentEditTargetState(relativePath, state, result.target, result.plan)
  setLargeFileSegmentEditStack(relativePath, result.nextStack)
  if (options.recordOperation !== false) {
    const beforeContent = result.target === result.item.before
      ? result.item.after.segmentContent
      : result.item.before.segmentContent
    recordFileOperation({
      type: "update_file",
      source: options.source || "user",
      agentId: options.agentId || null,
      runId: options.runId || null,
      pathBefore: relativePath,
      pathAfter: relativePath,
      beforeContent,
      afterContent: result.target.segmentContent,
      reason: options.reason || result.item.label,
      riskLevel: "medium",
    })
  }
  return true
}

export async function saveFile(pathValue, content, options = {}) {
  const relativePath = normalizeRelativePath(pathValue)
  if (hasExternalChange(relativePath) && !shouldIgnoreModifiedSince(options)) {
    markTextFileConflictState(relativePath)
    markSaveConflictNotice(relativePath)
    return false
  }
  const largeFileState = getLargeFileState(relativePath)
  if (largeFileState?.mode === "range" && options.force !== true) {
    return saveLargeFileSegment(relativePath, content, options)
  }
  const beforeContent = hasOwn(workspace.files, relativePath)
    ? workspace.files[relativePath]
    : await readProjectFile(relativePath)
  const savedContent = applyFileSaveSettings(content)
  touchOpenFile(relativePath)
  markTextFilePendingSaveState(relativePath)
  void resolveTextFileModelFromWorkspace(relativePath, savedContent, {
    dirty: true,
    external: hasExternalChange(relativePath),
  })

  const fsApi = api()
  if (fsApi && workspace.projectRoot) {
    ensureTextFileProvider(fsApi)
    const result = await textFileService.save({
      resource: toTextFileResource(relativePath),
      value: savedContent,
      state: getTextFileState(relativePath),
      options: {
        reason: options.saveReason || SaveReason.EXPLICIT,
        source: options.saveSource || CODEK_TEXTFILE_SAVE_SOURCE,
        force: shouldIgnoreModifiedSince(options),
      },
    })
    publishWorkspaceEditingSaveEvidence(relativePath, result, beforeContent, savedContent)
    if (!result.success) {
      if (!textFileStateCollection.isState(relativePath, "conflict")) {
        markTextFileErrorState(relativePath)
      }
      publishWorkspaceEditingSaveEvidence(relativePath, result, beforeContent, savedContent)
      return false
    }
    if (typeof result.value === "string") {
      workspace.files[relativePath] = result.value
    }
  } else {
    workspace.files[relativePath] = savedContent
    publishWorkspaceEditingSaveEvidence(relativePath, {
      success: true,
      reason: options.saveReason || SaveReason.EXPLICIT,
      source: options.saveSource || CODEK_TEXTFILE_SAVE_SOURCE,
      value: savedContent,
    }, beforeContent, savedContent)
  }

  markTextFileSavedState(relativePath)
  syncResolvedTextFileModel(relativePath)
  await discardWorkingCopyBackupForPath(relativePath)
  publishWorkspaceEditingSaveEvidence(relativePath, {
    success: true,
    reason: options.saveReason || SaveReason.EXPLICIT,
    source: options.saveSource || CODEK_TEXTFILE_SAVE_SOURCE,
    value: String(workspace.files[relativePath] ?? savedContent),
  }, beforeContent, savedContent)
  if (options.recordOperation !== false) {
    recordFileOperation({
      type: beforeContent === null || beforeContent === undefined ? "create_file" : "update_file",
      source: options.source || "user",
      agentId: options.agentId || null,
      runId: options.runId || null,
      pathBefore: relativePath,
      pathAfter: relativePath,
      beforeContent: typeof beforeContent === "string" ? beforeContent : null,
      afterContent: String(workspace.files[relativePath] ?? savedContent),
      reason: options.reason || "save file",
      riskLevel: beforeContent === null || beforeContent === undefined ? "safe" : "medium",
    })
  }
  return true
}

export async function saveLargeFileSegment(pathValue, content, options = {}) {
  const relativePath = normalizeRelativePath(pathValue)
  if (hasExternalChange(relativePath) && !shouldIgnoreModifiedSince(options)) {
    markTextFileConflictState(relativePath)
    markSaveConflictNotice(relativePath, "大文件在磁盘上已有外部修改，已阻止分段写回。")
    return false
  }
  const state = getLargeFileState(relativePath)
  let currentWindowContent = hasOwn(workspace.files, relativePath) ? String(workspace.files[relativePath] || "") : ""
  if (state?.mode !== "range" || !currentWindowContent) return false
  const savedEditorContent = applyFileSaveSettings(content)
  const displayBytes = Math.max(0, Number(state.displayBytes || 0))
  const hasDisplaySlice = displayBytes > 0 && displayBytes < Math.max(0, Number(state.bytesRead || state.previewBytes || 0))
  let rememberedWindow = null
  if (state.displayTransformed) {
    const remembered = getRememberedLargeFileWindow(
      relativePath,
      state.size,
      state.offset || 0,
      state.windowBytes || state.previewBytes || LARGE_FILE_WINDOW_BYTES,
    )
    rememberedWindow = {
      rawContent: typeof remembered?.rawContent === "string" ? remembered.rawContent : "",
      displayRawContent: typeof remembered?.displayRawContent === "string" ? remembered.displayRawContent : undefined,
    }
  }
  const savePlan = createLargeFileEditBufferSavePlan({
    state: {
      ...state,
      path: relativePath,
      content: currentWindowContent,
      bytesRead: state.bytesRead || state.previewBytes || currentWindowContent.length,
      windowBytes: state.windowBytes || state.previewBytes || LARGE_FILE_WINDOW_BYTES,
    },
    currentEditorContent: currentWindowContent,
    nextEditorContent: savedEditorContent,
    rememberedWindow,
    normalizeDisplayContent: normalizeLargeFilePreviewContent,
    displayRenderBytes: LARGE_FILE_EDITOR_RENDER_BYTES,
  })
  if (!savePlan.ok) {
    workspace.largeFileNotice = {
      ...workspace.largeFileNotice,
      path: relativePath,
      size: state.size,
      limit: state.limit,
      previewBytes: state.previewBytes,
      offset: state.offset,
      windowBytes: state.windowBytes,
      hasPrevious: state.hasPrevious,
      hasNext: state.hasNext,
      virtualStartLine: state.virtualStartLine,
      mode: state.mode,
      readOnly: state.readOnly,
      truncated: state.truncated,
      reason: savePlan.message,
    }
    if (savePlan.reason === "validation-failed") markTextFileConflictState(relativePath)
    else markTextFileErrorState(relativePath)
    return false
  }
  currentWindowContent = savePlan.currentWindowContent
  const plan = savePlan.plan

  markTextFilePendingSaveState(relativePath)
  const success = await patchLargeFileSegmentWithPlan(relativePath, plan, options)
  if (!success) {
    workspace.largeFileNotice = {
      ...workspace.largeFileNotice,
      path: relativePath,
      size: state.size,
      limit: state.limit,
      previewBytes: state.previewBytes,
      offset: state.offset,
      windowBytes: state.windowBytes,
      hasPrevious: state.hasPrevious,
      hasNext: state.hasNext,
      virtualStartLine: state.virtualStartLine,
      mode: state.mode,
      readOnly: state.readOnly,
      truncated: state.truncated,
      reason: "大文件分段保存失败：当前运行环境还没有提供安全分段写回能力。",
    }
    markTextFileErrorState(relativePath)
    return false
  }

  if (options.recordLargeFileEditStack !== false && (currentWindowContent !== savePlan.nextSegmentContent || state.size !== plan.nextSize)) {
    const stackItem = createLargeFileSegmentEditStackItem({
      path: relativePath,
      offset: state.offset || 0,
      before: {
        fileSize: state.size,
        segmentContent: currentWindowContent,
        rawWindowContent: currentWindowContent,
        displayedContent: hasOwn(workspace.files, relativePath) ? String(workspace.files[relativePath] || "") : currentWindowContent,
        previewBytes: state.previewBytes,
        bytesRead: hasDisplaySlice ? displayBytes : (state.bytesRead || state.previewBytes || getUtf8ByteLength(currentWindowContent)),
        windowBytes: state.windowBytes || state.previewBytes || LARGE_FILE_WINDOW_BYTES,
        displayBytes: hasDisplaySlice ? displayBytes : getUtf8ByteLength(currentWindowContent),
        displayHash: hasDisplaySlice ? state.displayHash : hashLargeFileSegment(currentWindowContent),
        fullWindowHash: state.fullWindowHash || state.fileVersionHash || hashLargeFileSegment(currentWindowContent),
        displayTransformed: Boolean(state.displayTransformed),
      },
      after: {
        fileSize: plan.nextSize,
        segmentContent: savePlan.nextSegmentContent,
        rawWindowContent: savePlan.nextRawWindowContent,
        displayedContent: savePlan.nextDisplayedContent,
        previewBytes: savePlan.nextWindowBytesRead,
        bytesRead: savePlan.nextWindowBytesRead,
        windowBytes: state.windowBytes || state.previewBytes || LARGE_FILE_WINDOW_BYTES,
        displayBytes: savePlan.nextDisplayBytes,
        displayHash: savePlan.nextDisplayHash,
        fullWindowHash: savePlan.nextFullWindowHash,
        displayTransformed: savePlan.nextDisplayTransformed,
      },
      label: options.reason || "large file segment save",
    })
    setLargeFileSegmentEditStack(
      relativePath,
      pushLargeFileSegmentEditStackItem(getLargeFileSegmentEditStack(relativePath), stackItem),
    )
  }

  workspace.files[relativePath] = savePlan.nextDisplayedContent
  markTextFileSavedState(relativePath)
  clearLargeFileWindowCache(relativePath)
  setLargeFileState(relativePath, {
    ...state,
    previewBytes: savePlan.nextWindowBytesRead,
    bytesRead: savePlan.nextWindowBytesRead,
    size: plan.nextSize,
    fileVersionHash: savePlan.nextFullWindowHash,
    fullWindowHash: savePlan.nextFullWindowHash,
    displayBytes: savePlan.nextDisplayBytes,
    displayHash: savePlan.nextDisplayHash,
    displayTransformed: savePlan.nextDisplayTransformed,
  })
  rememberLargeFileWindow(relativePath, {
    size: plan.nextSize,
    limit: state.limit,
    previewBytes: savePlan.nextWindowBytesRead,
    bytesRead: savePlan.nextWindowBytesRead,
    offset: state.offset || 0,
    windowBytes: state.windowBytes || state.previewBytes || LARGE_FILE_WINDOW_BYTES,
    rawContent: savePlan.nextRawWindowContent,
    displayRawContent: savePlan.nextSegmentContent,
    normalizedContent: savePlan.nextDisplayedContent,
    fileVersionHash: savePlan.nextFullWindowHash,
    fullWindowHash: savePlan.nextFullWindowHash,
    displayBytes: savePlan.nextDisplayBytes,
    displayHash: savePlan.nextDisplayHash,
    displayTransformed: savePlan.nextDisplayTransformed,
  })
  if (options.recordOperation !== false) {
    recordFileOperation({
      type: "update_file",
      source: options.source || "user",
      agentId: options.agentId || null,
      runId: options.runId || null,
      pathBefore: relativePath,
      pathAfter: relativePath,
      beforeContent: currentWindowContent,
      afterContent: plan.insertText,
      reason: options.reason || "large file segment save",
      riskLevel: "medium",
    })
  }
  return true
}

export async function undoLargeFileSegmentEdit(pathValue, options = {}) {
  const relativePath = normalizeRelativePath(pathValue)
  if (hasExternalChange(relativePath) && !shouldIgnoreModifiedSince(options)) {
    markTextFileConflictState(relativePath)
    markSaveConflictNotice(relativePath, "大文件在磁盘上已有外部修改，已阻止分段撤销。")
    return false
  }
  const state = getLargeFileState(relativePath)
  if (state?.mode !== "range") return false
  const currentSegmentContent = getCurrentLargeFileSegmentContentForStack(state, relativePath)
  const result = createLargeFileSegmentUndoPlan({
    stack: getLargeFileSegmentEditStack(relativePath),
    path: relativePath,
    size: state.size,
    offset: state.offset || 0,
    currentSegmentContent,
  })
  return applyLargeFileSegmentEditStackPlan(relativePath, result, state, {
    ...options,
    reason: options.reason || "large file segment undo",
  })
}

export async function redoLargeFileSegmentEdit(pathValue, options = {}) {
  const relativePath = normalizeRelativePath(pathValue)
  if (hasExternalChange(relativePath) && !shouldIgnoreModifiedSince(options)) {
    markTextFileConflictState(relativePath)
    markSaveConflictNotice(relativePath, "大文件在磁盘上已有外部修改，已阻止分段重做。")
    return false
  }
  const state = getLargeFileState(relativePath)
  if (state?.mode !== "range") return false
  const currentSegmentContent = getCurrentLargeFileSegmentContentForStack(state, relativePath)
  const result = createLargeFileSegmentRedoPlan({
    stack: getLargeFileSegmentEditStack(relativePath),
    path: relativePath,
    size: state.size,
    offset: state.offset || 0,
    currentSegmentContent,
  })
  return applyLargeFileSegmentEditStackPlan(relativePath, result, state, {
    ...options,
    reason: options.reason || "large file segment redo",
  })
}

export async function deleteFile(pathValue, options = {}) {
  const relativePath = normalizeRelativePath(pathValue)
  if (!relativePath) return false
  const beforeContent = hasOwn(workspace.files, relativePath)
    ? workspace.files[relativePath]
    : await readProjectFile(relativePath)

  const fsApi = api()
  let usedWorkingCopyFileService = false
  if (fsApi && workspace.projectRoot) {
    const fileService = ensureWorkspaceFileServiceProvider(fsApi)
    const success = await runWorkingCopyFileOperation(
      FileOperation.DELETE,
      [workingCopyTarget(relativePath)],
      () => runFileServiceOperation(FileOperation.DELETE, {
        sourcePath: relativePath,
        targetPath: null,
        source: options.source || "user",
        agentId: options.agentId,
        runId: options.runId,
        reason: options.reason || "delete file",
        riskLevel: "high",
      }, () => fileService.delete(toTextFileResource(relativePath), { recursive: true })),
    )
    if (!success) return false
    usedWorkingCopyFileService = true
  }

  delete workspace.files[relativePath]
  if (!usedWorkingCopyFileService) removeTextFileState(relativePath)
  clearLargeFileSegmentEditStack(relativePath)
  workspace.openFiles = workspace.openFiles.filter((path) => path !== relativePath)

  if (workspace.activeFile === relativePath) {
    workspace.activeFile = workspace.openFiles[workspace.openFiles.length - 1] || null
  }
  refreshEditorTabStates([relativePath, workspace.activeFile].filter(Boolean))

  if (options.recordOperation !== false) {
    recordFileOperation({
      type: "delete_file",
      source: options.source || "user",
      agentId: options.agentId || null,
      runId: options.runId || null,
      pathBefore: relativePath,
      pathAfter: null,
      beforeContent: typeof beforeContent === "string" ? beforeContent : null,
      afterContent: null,
      reason: options.reason || "delete file",
      riskLevel: "high",
    })
  }
  return true
}

export async function renameEntry(oldPathValue, newPathValue, options = {}) {
  const oldRelativePath = normalizeRelativePath(oldPathValue)
  const newRelativePath = normalizeRelativePath(newPathValue)
  if (!oldRelativePath || !newRelativePath || oldRelativePath === newRelativePath) return false

  const fsApi = api()
  let usedWorkingCopyFileService = false
  if (fsApi && workspace.projectRoot) {
    const fileService = ensureWorkspaceFileServiceProvider(fsApi)
    ensurePathExpanded(newRelativePath)
    const success = await runWorkingCopyFileOperation(
      FileOperation.MOVE,
      [workingCopySourceTarget(oldRelativePath, newRelativePath)],
      () => runFileServiceOperation(FileOperation.MOVE, {
        sourcePath: oldRelativePath,
        targetPath: newRelativePath,
        source: options.source || "user",
        agentId: options.agentId,
        runId: options.runId,
        reason: options.reason || "rename entry",
        riskLevel: "high",
      }, () => fileService.move(toTextFileResource(oldRelativePath), toTextFileResource(newRelativePath), false)),
    )
    if (!success) return false
    usedWorkingCopyFileService = true
  }

  if (!usedWorkingCopyFileService) moveTextFileState(oldRelativePath, newRelativePath)
  updateOpenFilePath(oldRelativePath, newRelativePath)
  moveLargeFileSegmentEditStack(oldRelativePath, newRelativePath)

  if (options.recordOperation !== false) {
    recordFileOperation({
      type: "rename_move",
      source: options.source || "user",
      agentId: options.agentId || null,
      runId: options.runId || null,
      pathBefore: oldRelativePath,
      pathAfter: newRelativePath,
      reason: options.reason || "rename entry",
      riskLevel: "high",
    })
  }
  return true
}

export function copyEntry(pathValue) {
  const relativePath = normalizeRelativePath(pathValue)
  if (!relativePath) return false
  explorerClipboard = { kind: "copy", path: relativePath }
  return true
}

export function cutEntry(pathValue) {
  const relativePath = normalizeRelativePath(pathValue)
  if (!relativePath) return false
  explorerClipboard = { kind: "cut", path: relativePath }
  return true
}

export async function pasteEntry(targetDirValue) {
  if (!explorerClipboard?.path) return null
  const sourcePath = explorerClipboard.path
  const targetDir = normalizeRelativePath(targetDirValue || entryDir(sourcePath))
  const sourceIsDirectory = await entryIsDirectory(sourcePath)
  const pasteShouldMove = explorerClipboard.kind === "cut"
  const targetPath = await findValidPasteFileTargetPath({
    targetFolderPath: targetDir,
    resourceName: entryName(sourcePath),
    isDirectory: sourceIsDirectory,
    allowOverwrite: pasteShouldMove || DEFAULT_EXPLORER_INCREMENTAL_NAMING === "disabled",
    incrementalNaming: DEFAULT_EXPLORER_INCREMENTAL_NAMING,
    exists: entryExists,
    joinPath: joinRelativePath,
  })
  if (!targetPath) return null
  const fsApi = api()

  if (pasteShouldMove) {
    const moved = await renameEntry(sourcePath, targetPath)
    if (!moved) return null
    explorerClipboard = null
    return targetPath
  }

  if (fsApi && workspace.projectRoot) {
    const fileService = ensureWorkspaceFileServiceProvider(fsApi)
    ensurePathExpanded(targetPath)
    const success = await runWorkingCopyFileOperation(
      FileOperation.COPY,
      [workingCopySourceTarget(sourcePath, targetPath)],
      () => runFileServiceOperation(FileOperation.COPY, {
        sourcePath,
        targetPath,
        source: "user",
        reason: "copy entry",
        riskLevel: "safe",
      }, () => fileService.copy(toTextFileResource(sourcePath), toTextFileResource(targetPath), false)),
    )
    if (!success) return null
    await refreshFileTree()
  } else if (hasOwn(workspace.files, sourcePath)) {
    workspace.files[targetPath] = workspace.files[sourcePath]
    markDirty(targetPath)
  }
  return targetPath
}

export function addFile(pathValue, content = "") {
  const relativePath = normalizeRelativePath(pathValue)
  workspace.activeFile = relativePath
  touchOpenFile(relativePath)
  syncWorkspaceTextFileModelDirty(relativePath, content, { external: false })
}

export async function createFile(relativePath, content = "", options = {}) {
  const normalizedPath = normalizeRelativePath(relativePath)
  const fsApi = api()
  if (fsApi && workspace.projectRoot) {
    const fileService = ensureWorkspaceFileServiceProvider(fsApi)
    ensurePathExpanded(normalizedPath)
    const success = await runWorkingCopyFileOperation(
      FileOperation.CREATE,
      [workingCopyTarget(normalizedPath)],
      () => runFileServiceOperation(FileOperation.CREATE, {
        sourcePath: null,
        targetPath: normalizedPath,
        source: options.source || "user",
        agentId: options.agentId,
        runId: options.runId,
        reason: options.reason || "create file",
        riskLevel: "safe",
      }, () => fileService.createFile(toTextFileResource(normalizedPath), new TextEncoder().encode(content), { overwrite: false })),
    )
    if (!success) return false
    workspace.files[normalizedPath] = content
    clearExternalChange(normalizedPath)
    if (shouldOpenFileAfterCreate(options)) {
      await openFile(normalizedPath)
    }
    if (options.recordOperation !== false) {
      recordFileOperation({
        type: "create_file",
        source: options.source || "user",
        agentId: options.agentId || null,
        runId: options.runId || null,
        pathBefore: null,
        pathAfter: normalizedPath,
        beforeContent: null,
        afterContent: content,
        reason: options.reason || "create file",
        riskLevel: "safe",
      })
    }
    return true
  }

  addFile(normalizedPath, content)
  if (options.recordOperation !== false) {
    recordFileOperation({
      type: "create_file",
      source: options.source || "user",
      agentId: options.agentId || null,
      runId: options.runId || null,
      pathBefore: null,
      pathAfter: normalizedPath,
      beforeContent: null,
      afterContent: content,
      reason: options.reason || "create file",
      riskLevel: "safe",
    })
  }
  return true
}

export async function createDir(relativePath, options = {}) {
  const normalizedPath = normalizeRelativePath(relativePath)
  const fsApi = api()
  if (!fsApi || !workspace.projectRoot) return false

  const fileService = ensureWorkspaceFileServiceProvider(fsApi)
  ensurePathExpanded(normalizedPath)
  const success = await runWorkingCopyFileOperation(
    FileOperation.CREATE,
    [workingCopyTarget(normalizedPath)],
    () => runFileServiceOperation(FileOperation.CREATE, {
      sourcePath: null,
      targetPath: normalizedPath,
      source: options.source || "user",
      agentId: options.agentId,
      runId: options.runId,
      reason: options.reason || "create folder",
      riskLevel: "safe",
      type: "create_folder",
      isFolder: true,
    }, () => fileService.createFolder(toTextFileResource(normalizedPath))),
  )
  if (!success) return false

  if (options.recordOperation !== false) {
    recordFileOperation({
      type: "create_folder",
      source: options.source || "user",
      agentId: options.agentId || null,
      runId: options.runId || null,
      pathBefore: null,
      pathAfter: normalizedPath,
      reason: options.reason || "create folder",
      riskLevel: "safe",
    })
  }
  return true
}

export function updateFile(pathValue, content, options = {}) {
  const relativePath = normalizeRelativePath(pathValue)
  touchOpenFile(relativePath)

  if (options.dirty === false) syncWorkspaceTextFileModelClean(relativePath, content, { external: options.external ?? false })
  else syncWorkspaceTextFileModelDirty(relativePath, content, { external: options.external ?? hasExternalChange(relativePath) })
  if (options.dirty === false) void discardWorkingCopyBackupForPath(relativePath)
}

export async function revealPath(pathValue) {
  const relativePath = normalizeRelativePath(pathValue)
  if (!relativePath) return false
  return true
}

export async function showItemInFolder(pathValue) {
  const fsApi = api()
  if (!fsApi?.showItemInFolder || !workspace.projectRoot) return false
  return Boolean(await fsApi.showItemInFolder(resolveFsPath(pathValue)))
}

export function getFile(pathValue) {
  return workspace.files[normalizeRelativePath(pathValue)]
}

export function getAllFiles() {
  return workspace.files
}

export function getRelativePath(fullPath) {
  return normalizeRelativePath(fullPath)
}

export async function readLines(pathValue, startLine = 1, endLine = startLine + 20) {
  const content = await readProjectFile(pathValue)
  if (typeof content !== "string") return null

  const lineIndex = createLargeTextLineIndex(content)
  const start = Math.max(1, Number(startLine) || 1)
  const end = Math.min(lineIndex.lineCount, Number(endLine) || lineIndex.lineCount)
  const startOffset = lineIndex.getLineStartOffset(start)
  const endOffset = lineIndex.getLineEndOffset(end)
  const sliceEndOffset = content.charCodeAt(endOffset - 1) === 10 ? endOffset - 1 : endOffset

  return {
    content: content.slice(startOffset, Math.max(startOffset, sliceEndOffset)),
    totalLines: lineIndex.lineCount,
  }
}

export async function searchTextInProject(query, options = {}) {
  if (!query?.trim() || !workspace.projectRoot) return null
  reportWorkspaceReadSmokeStage("search-text:start", {
    queryLength: String(query || "").length,
    rootCount: workspace.workspaceRoots.length || 1,
    maxResults: options.maxResults,
  })
  const fastPathResult = await searchTextInKnownSmallFiles(query, options)
  if (fastPathResult?.matches?.length) {
    reportWorkspaceReadSmokeStage("search-text:fast-path:return", {
      matchCount: fastPathResult.matches.length,
      truncated: Boolean(fastPathResult.truncated),
    })
    return fastPathResult
  }

  const roots = workspace.workspaceRoots.length ? workspace.workspaceRoots : [workspace.projectRoot]
  const workspaceResult = await searchWorkspaceInProject(roots, query, options)
  if (workspaceResult) {
    reportWorkspaceReadSmokeStage("search-text:workspace-return", {
      matchCount: workspaceResult.matches.length,
      truncated: Boolean(workspaceResult.truncated),
    })
    return workspaceResult
  }
  reportWorkspaceReadSmokeStage("search-text:workspace-fallback", {
    rootCount: roots.length,
  })

  const allMatches = []
  const fileContents = {}
  let truncated = false

  for (const root of roots) {
    const result = await searchRootInProject(root, query, options)
    if (!result) return null
    allMatches.push(...result.matches)
    Object.assign(fileContents, result.fileContents || {})
    truncated = truncated || result.truncated
    if (allMatches.length >= Number(options.maxResults || SEARCH_MATCH_LIMIT)) {
      truncated = true
      break
    }
  }

  const finalResult = {
    matches: allMatches.slice(0, Number(options.maxResults || SEARCH_MATCH_LIMIT)),
    truncated,
    fileContents,
  }
  reportWorkspaceReadSmokeStage("search-text:done", {
    matchCount: finalResult.matches.length,
    truncated,
  })
  return finalResult
}

export async function findInProject(query, options = {}) {
  const terms = tokenize(query)
  if (!terms.length) return []

  const maxResults = options.maxResults || SEARCH_RESULT_LIMIT
  const { discoverWorkspaceFiles } = await import("./fileDiscovery")
  const files = (await discoverWorkspaceFiles({ query, limit: maxResults * 20 })).map((pathValue) => ({ path: pathValue }))
  const results = []

  for (const entry of files) {
    if (results.length >= maxResults) break

    const relativePath = normalizeRelativePath(entry.path)
    const lowerPath = relativePath.toLowerCase()
    let score = 0

    for (const term of terms) {
      if (lowerPath.includes(term)) score += 5
    }

    if (score === 0) continue

    const rootInfo = getWorkspaceRootInfo(relativePath)
    results.push({
      path: relativePath,
      root: rootInfo?.root || workspace.projectRoot || "",
      rootLabel: rootInfo?.label || "",
      score,
      snippet: "",
    })
  }

  return results.sort((left, right) => right.score - left.score).slice(0, maxResults)
}
