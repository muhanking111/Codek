const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  dialog,
  Menu,
  nativeImage,
  net,
  protocol,
  screen,
  shell,
  safeStorage,
} = require("electron")
const path = require("path")
const fs = require("fs")
const http = require("http")
const { pathToFileURL } = require("url")
const { spawn, execFileSync } = require("child_process")
require("./services/localEnv").loadLocalEnv({ baseDir: __dirname })
const security = require("./services/security")
const ptyManager = require("./services/pty/ptyManager")
const { evaluateCommandExecution } = require("./services/workspaceTrust")
const {
  shouldKeepAliveOnWindowClosed,
  shouldPreventWindowCloseForWorkingCopies,
} = require("./lifecycle")
const {
  buildWorkspaceContent,
  parseWorkspaceContent,
  normalizePath: normalizeWorkspacePath,
} = require("./services/workspace/workspaceFile")
const {
  buildWatcherOptions,
  createWorkspaceScaleProfile,
  shouldAutoWatchExpandedDirectory,
  shouldStartRecursiveWatcher,
  shouldWatchExpandedDirectories,
} = require("./services/workspace/workspaceScaleProfile")
const { resolveListDirEntryBudget } = require("./services/workspace/listDirBudget")
const {
  createDirectoryEntryLimitSentinel,
  mapDirentsToFileServiceEntries,
  mapStatToFileServiceEntry,
} = require("./services/workspace/fileServiceEntryAdapter")
const {
  DEFAULT_MAX_RENDERER_PREVIEW_FILE_BYTES,
  DEFAULT_MAX_RENDERER_READ_FILE_BYTES,
  patchRendererTextFileSegment,
  readRendererTextFile,
  readRendererTextFileChunk,
} = require("./services/workspace/largeFileReader")
const { fileUriPathToFsPath } = require("./services/extensions-host/uriComponents")
const {
  buildRealProjectUiGateAttribution,
  formatRealProjectUiManualAcceptanceContractMarkdown,
  formatRealProjectUiGateAttributionMarkdown,
} = require("./services/smoke/realProjectUiGateAttribution")
const {
  isWorkbenchPanelSnapshotVisible,
} = require("./services/smoke/realProjectUiSmokeAcceptance")

try {
  protocol.registerSchemesAsPrivileged([{
    scheme: "codek-extension-resource",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  }])
} catch {
  // Electron requires privileged schemes to be registered before app ready.
}

function resolveSource(meta) {
  if (meta && typeof meta === "object" && (meta.source === "user" || meta.source === "agent")) {
    return meta.source
  }
  return "user"
}

function guardFsPath(filePath, meta, opts = {}) {
  const source = resolveSource(meta)
  if (source === "user") return { ok: true, resolved: filePath }
  if (!currentProjectRoot) {
    return { ok: false, code: "BLOCKED", message: "no project root open; agent fs calls are denied" }
  }
  return security.pathGuard.validatePath(currentProjectRoot, filePath, {
    allowAbsolute: true,
    ...opts,
  })
}

function recordElectronSmokeExplorerReadDirSample(dirPath, entries) {
  if (!isExplorerPerformanceSmoke && !isRealExplorerSmoke && !isExplorerStressSmoke) return
  const normalized = String(dirPath || "").replace(/\\/g, "/").replace(/\/+$/, "")
  const names = entries.slice(0, 40).map((entry) => ({
    name: entry.name,
    isDirectory: Boolean(entry.isDirectory),
    isFile: Boolean(entry.isFile),
  }))
  const existing = electronSmokeExplorerReadDirSamples.find((sample) => sample.path === normalized)
  if (existing) {
    existing.count = entries.length
    existing.names = names
    return
  }
  electronSmokeExplorerReadDirSamples.push({
    path: normalized,
    count: entries.length,
    names,
  })
  if (electronSmokeExplorerReadDirSamples.length > 20) electronSmokeExplorerReadDirSamples.shift()
}

const isSmoke = process.env.CODEK_ELECTRON_SMOKE === "1"
const isStartupSmoke = process.env.CODEK_ELECTRON_SMOKE_STARTUP_ONLY === "1"
const isExplorerPerformanceSmoke = process.env.CODEK_ELECTRON_SMOKE_EXPLORER_PERFORMANCE === "1"
const isRealExplorerSmoke = process.env.CODEK_ELECTRON_SMOKE_REAL_EXPLORER === "1"
const isExplorerStressSmoke = process.env.CODEK_ELECTRON_SMOKE_EXPLORER_STRESS === "1"
const isFileOperationVisibilitySmoke = process.env.CODEK_ELECTRON_SMOKE_FILE_OPERATION_VISIBILITY === "1"
const isSearchReplaceSmoke = process.env.CODEK_ELECTRON_SMOKE_SEARCH_REPLACE === "1"
const isEditorOpenFilesSmoke = process.env.CODEK_ELECTRON_SMOKE_EDITOR_OPEN_FILES === "1"
const isNotebookMarkdownPreviewSmoke = process.env.CODEK_ELECTRON_SMOKE_NOTEBOOK_MARKDOWN_PREVIEW === "1"
const isAccessibleViewVisibleOwnerSmoke = process.env.CODEK_ELECTRON_SMOKE_ACCESSIBLE_VIEW_VISIBLE_OWNER === "1"
const isMultiRootCreateTargetSmoke = process.env.CODEK_ELECTRON_SMOKE_MULTIROOT_CREATE_TARGET === "1"
const isCreateTargetAccuracySmoke = process.env.CODEK_ELECTRON_SMOKE_CREATE_TARGET_ACCURACY === "1"
const isInlineCreateFocusSmoke = process.env.CODEK_ELECTRON_SMOKE_INLINE_CREATE_FOCUS === "1"
const isSearchNavigationSmoke = process.env.CODEK_ELECTRON_SMOKE_SEARCH_NAVIGATION === "1"
const isArtifactOpenSmoke = process.env.CODEK_ELECTRON_SMOKE_ARTIFACT_OPEN === "1"
const isTabOverflowSmoke = process.env.CODEK_ELECTRON_SMOKE_TAB_OVERFLOW === "1"
const isIconThemeRefreshSmoke = process.env.CODEK_ELECTRON_SMOKE_ICON_THEME_REFRESH === "1"
const isIconVisualStateSmoke = process.env.CODEK_ELECTRON_SMOKE_ICON_VISUAL_STATE === "1"
const isRealProjectUiSmoke = process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_UI === "1"
const isWorkbenchUiAuditSmoke = process.env.CODEK_ELECTRON_SMOKE_WORKBENCH_UI_AUDIT === "1"
const isNotificationActionsClickSmoke = process.env.CODEK_ELECTRON_SMOKE_NOTIFICATION_ACTIONS_CLICK === "1"
const isTaskProviderExecuteSmoke = process.env.CODEK_ELECTRON_SMOKE_TASK_PROVIDER_EXECUTE === "1"
const isTaskProviderBackgroundOwnerSmoke = process.env.CODEK_ELECTRON_SMOKE_TASK_PROVIDER_BACKGROUND_OWNER === "1"
const isDebugOutputBridgeSmoke = process.env.CODEK_ELECTRON_SMOKE_DEBUG_OUTPUT_BRIDGE === "1"
const isOutputLogSmoke = process.env.CODEK_ELECTRON_SMOKE_OUTPUT_LOG === "1"
const isDebugSessionSmoke = process.env.CODEK_ELECTRON_SMOKE_DEBUG_SESSION === "1"
const isTestingPublishResultsSmoke = process.env.CODEK_ELECTRON_SMOKE_TESTING_PUBLISH_RESULTS === "1"
const isWorkspaceTrustDowngradeRestartSmoke = process.env.CODEK_ELECTRON_SMOKE_WORKSPACE_TRUST_DOWNGRADE_RESTART === "1"
const isWorkspaceTrustRequestDialogSmoke = process.env.CODEK_ELECTRON_SMOKE_WORKSPACE_TRUST_REQUEST_DIALOG === "1"
const isWorkspaceTrustEditorSmoke = process.env.CODEK_ELECTRON_SMOKE_WORKSPACE_TRUST_EDITOR === "1"
const isExtensionInstallConfirmationSmoke = process.env.CODEK_ELECTRON_SMOKE_EXTENSION_INSTALL_CONFIRMATION === "1"
const isExtensionHostRestartSmoke = process.env.CODEK_ELECTRON_SMOKE_EXTENSION_HOST_RESTART === "1"
const isWorkingCopyHotExitSmoke = process.env.CODEK_ELECTRON_SMOKE_WORKING_COPY_HOT_EXIT === "1"
const isFocusedLargeFileRealProjectUiSmoke = isRealProjectUiSmoke
  && process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_FOCUSED_LARGE_FILE === "1"
const isDevServerFallbackSmoke = process.env.CODEK_ELECTRON_SMOKE_DEV_SERVER_FALLBACK === "1"
const isDev = !app.isPackaged && !isSmoke
const useDevServer = !app.isPackaged && (!isSmoke || isDevServerFallbackSmoke || isExtensionInstallConfirmationSmoke) && process.env.CODEK_USE_DEV_SERVER === "1"
const autoOpenDevTools = isDev && process.env.CODEK_OPEN_DEVTOOLS === "1"
const isWindows = process.platform === "win32"
const isMac = process.platform === "darwin"

const needsSmokeVisualCompositing = isRealProjectUiSmoke || isWorkbenchUiAuditSmoke || isIconVisualStateSmoke

if (isSmoke && !needsSmokeVisualCompositing) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch("disable-gpu")
  app.commandLine.appendSwitch("disable-gpu-compositing")
}

let mainWindow = null
let currentProjectRoot = null
let currentWorkspaceFile = null
let currentWorkspaceRoots = []
let fileWatcher = null
let debounceTimer = null
let electronSmokeExplorerReadDirCalls = []
let electronSmokeExplorerReadDirSamples = []
let electronSmokeExplorerReadDirInFlight = 0
let electronSmokeExplorerReadDirInFlightMax = 0
let electronSmokeMultiRootCreateTargetFixture = null
let electronSmokeRealProjectUiTargetDir = null
let currentWorkspaceScaleProfile = null
let currentWatcherProjectRoot = null
const watchedExpandedDirs = new Set()
const pendingExpandedWatchDirs = new Set()
const pendingWatchEvents = []
let watcherStartupGeneration = 0
let watcherStartupTimer = null
let expandedWatchFlushTimer = null
let electronSmokeExplorerExtremeFile = null
let servicesReady = false
let serviceStartupPromise = null
let serviceStartupError = null
let serviceStartupStats = null
let serviceStartupScheduled = false
let latestIconVisualCompletePayload = null
let iconVisualCompleteWaiters = []
const mcpResourceSubscriptions = new Map()
const pendingRendererWindowCloseRequests = new Map()
const nativeCloseAllowedWindows = new WeakSet()
const nativeCloseInFlightWindows = new WeakSet()

const lspProcesses = new Map()
const dapProcesses = new Map()
let latestDapBridgeEvidence = null
const mcpProcesses = new Map()

const LSP_SHUTDOWN_TIMEOUT_MS = 3000
const DAP_DISCONNECT_TIMEOUT_MS = 3000

const OLLAMA_PORT = 11434
const OLLAMA_BASE_URL = `http://localhost:${OLLAMA_PORT}`

const HOME = app.getPath("home")
const CODEK_DATA = process.env.CODEK_DATA || path.join(HOME, ".codek")
const CODEK_LOGS = path.join(CODEK_DATA, "logs")
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, ".codex")
const ELECTRON_SMOKE_RUN_ID = `${Date.now()}-${process.pid}`
let electronSmokeResultCache = null
let electronSmokeFlushTimer = null

function getElectronSmokeResultFile() {
  if (process.env.CODEK_ELECTRON_SMOKE !== "1") return null
  return process.env.CODEK_ELECTRON_SMOKE_RESULT_FILE || null
}

function loadElectronSmokeResultCache(resultFile) {
  if (electronSmokeResultCache) return electronSmokeResultCache
  let previousRaw = {}
  try {
    previousRaw = resultFile && fs.existsSync(resultFile)
      ? JSON.parse(fs.readFileSync(resultFile, "utf8"))
      : {}
  } catch {
    previousRaw = {}
  }
  const previous = previousRaw.smokeRunId === ELECTRON_SMOKE_RUN_ID ? previousRaw : {}
  electronSmokeResultCache = {
    ...previous,
    ok: Boolean(previous.ok),
    smokeRunId: ELECTRON_SMOKE_RUN_ID,
    stages: Array.isArray(previous.stages) ? previous.stages : [],
    lastStage: previous.lastStage || null,
  }
  return electronSmokeResultCache
}

function flushElectronSmokeResultCache() {
  const resultFile = getElectronSmokeResultFile()
  if (!resultFile || !electronSmokeResultCache) return
  if (electronSmokeFlushTimer) {
    clearTimeout(electronSmokeFlushTimer)
    electronSmokeFlushTimer = null
  }
  try {
    fs.mkdirSync(path.dirname(resultFile), { recursive: true })
    fs.writeFileSync(resultFile, `${JSON.stringify(electronSmokeResultCache, null, 2)}\n`, "utf8")
  } catch (error) {
    console.error("[electron-smoke:result-file-failed]", String(error?.message || error))
  }
}

function scheduleElectronSmokeResultFlush() {
  if (electronSmokeFlushTimer) return
  electronSmokeFlushTimer = setTimeout(() => {
    electronSmokeFlushTimer = null
    flushElectronSmokeResultCache()
  }, 100)
  if (typeof electronSmokeFlushTimer.unref === "function") electronSmokeFlushTimer.unref()
}

function writeElectronSmokeResult(payload) {
  const resultFile = getElectronSmokeResultFile()
  if (!resultFile) return
  try {
    const previous = loadElectronSmokeResultCache(resultFile)
    const stages = Array.isArray(payload?.stages)
      ? payload.stages
      : Array.isArray(previous.stages)
        ? previous.stages
        : []
    const lastStage = payload?.lastStage || previous.lastStage || stages[stages.length - 1] || null
    const next = { ...previous, ...payload, smokeRunId: ELECTRON_SMOKE_RUN_ID, stages, lastStage }
    if (!Object.prototype.hasOwnProperty.call(payload || {}, "error")) delete next.error
    if (!Object.prototype.hasOwnProperty.call(payload || {}, "stage")) delete next.stage
    electronSmokeResultCache = next
    flushElectronSmokeResultCache()
  } catch (error) {
    console.error("[electron-smoke:result-file-failed]", String(error?.message || error))
  }
}

function writeElectronSmokeStage(stage, detail = {}) {
  const resultFile = getElectronSmokeResultFile()
  if (!resultFile) return
  try {
    const previous = loadElectronSmokeResultCache(resultFile)
    const stages = previous.stages
    stages.push({
      stage,
      detail,
      at: new Date().toISOString(),
    })
    const hasFinalChecks = Array.isArray(previous.checks) && previous.checks.length > 0
    electronSmokeResultCache = {
      ...previous,
      ok: hasFinalChecks ? previous.ok : false,
      smokeRunId: ELECTRON_SMOKE_RUN_ID,
      stages,
      lastStage: stages[stages.length - 1],
    }
    scheduleElectronSmokeResultFlush()
  } catch {
    // ignore smoke diagnostics
  }
}

function collectRendererWindowCloseDecision(win, request, timeoutMs = 2500) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return Promise.resolve({ rendererUnavailable: true, error: true, reason: "window-destroyed" })
  }
  const requestId = request.requestId
  return new Promise((resolve) => {
    let settled = false
    const finish = (payload) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pendingRendererWindowCloseRequests.delete(requestId)
      resolve(payload)
    }
    const timer = setTimeout(() => {
      finish({ rendererUnavailable: true, timedOut: true, reason: "renderer-close-timeout", requestId })
    }, timeoutMs)
    if (typeof timer.unref === "function") timer.unref()
    pendingRendererWindowCloseRequests.set(requestId, finish)
    try {
      win.webContents.send("window:will-close", request)
    } catch (error) {
      finish({ rendererUnavailable: true, error: true, reason: String(error?.message || error), requestId })
    }
  })
}

async function evaluateNativeWindowClose(win, options = {}) {
  const request = {
    requestId: `window-close-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: options.source || (isQuitting ? "app-quit" : "native-close"),
    force: options.force === true,
    isQuitting,
    at: Date.now(),
  }
  const rendererLifecycle = request.force
    ? null
    : await collectRendererWindowCloseDecision(win, request, options.timeoutMs)
  const decision = shouldPreventWindowCloseForWorkingCopies({
    rendererLifecycle,
    force: request.force,
    source: request.source,
  })
  const payload = {
    request,
    rendererLifecycle,
    decision,
  }
  writeElectronSmokeStage("window-close:evaluated", payload)
  return payload
}

async function requestNativeWindowClose(win, options = {}) {
  if (!win || win.isDestroyed()) return true
  const { decision } = await evaluateNativeWindowClose(win, options)
  if (!decision.preventClose) {
    nativeCloseAllowedWindows.add(win)
    win.close()
    return true
  }
  return false
}

function registerWindowCloseLifecycle(win) {
  if (!win) return
  win.on("close", (event) => {
    if (nativeQuitApproved || nativeCloseAllowedWindows.has(win)) {
      nativeCloseAllowedWindows.delete(win)
      return
    }
    if (nativeCloseInFlightWindows.has(win)) {
      event.preventDefault()
      return
    }
    event.preventDefault()
    nativeCloseInFlightWindows.add(win)
    void requestNativeWindowClose(win, { source: isQuitting ? "app-quit" : "native-close" })
      .finally(() => {
        nativeCloseInFlightWindows.delete(win)
      })
  })
  win.webContents.on("will-prevent-unload", (event) => {
    event.preventDefault()
    writeElectronSmokeStage("window-close:will-prevent-unload", { windowId: win.id, isQuitting })
  })
}

const ELECTRON_SMOKE_RENDERER_STAGE_SCRIPT = `({
  realProjectUi: window.__codekSmokeRealProjectUiStage || null,
  explorerPerformance: window.__codekSmokeExplorerPerformanceStage || window.__codekSmokeExplorerPerformanceResult || null,
  explorerStress: window.__codekSmokeExplorerStressStage || window.__codekSmokeExplorerPerformanceStage || window.__codekSmokeExplorerStressResult || null,
  tabOverflow: window.__codekSmokeTabOverflowStage || window.__codekSmokeTabOverflowResult || null,
  searchNavigation: window.__codekSmokeSearchNavigationStage || window.__codekSmokeSearchNavigationResult || null,
  artifactOpen: window.__codekSmokeArtifactOpenStage || window.__codekSmokeArtifactOpenResult || null,
  searchReplace: window.__codekSmokeSearchReplaceResult || null,
  fileOperationVisibility: window.__codekSmokeFileOperationVisibilityResult || null,
  workingCopyHotExit: window.__codekSmokeWorkingCopyHotExitResult || null,
  notebookMarkdownPreview: window.__codekSmokeNotebookMarkdownPreviewResult || null,
  iconVisualState: window.__codekSmokeIconVisualStateStage || window.__codekSmokeIconVisualStateResult || null,
  multiRootCreateTarget: window.__codekSmokeMultiRootCreateTargetResult || null,
  inlineCreateFocus: window.__codekSmokeInlineCreateFocusResult || null,
  notificationActionsClick: window.__codekSmokeNotificationActionClickResult || null,
  taskProviderExecute: window.__codekSmokeTaskProviderExecuteResult || null,
  taskProviderBackgroundOwner: window.__codekSmokeTaskProviderBackgroundOwnerResult || null,
  debugOutputBridge: window.__codekSmokeDebugOutputBridgeResult || null,
  outputLog: window.__codekSmokeOutputLogResult || null,
  debugSession: window.__codekSmokeDebugSessionResult || null,
  testingPublishResults: window.__codekSmokeTestingPublishResultsStage || window.__codekSmokeTestingPublishResults || null,
  workspaceTrustDowngradeRestart: window.__codekSmokeWorkspaceTrustDowngradeRestartStage || window.__codekSmokeWorkspaceTrustDowngradeRestartResult || null,
  workspaceTrustRequestDialog: window.__codekSmokeWorkspaceTrustRequestDialogStage || window.__codekSmokeWorkspaceTrustRequestDialogResult || null,
  extensionInstallConfirmation: window.__codekSmokeExtensionInstallConfirmationStage || window.__codekSmokeExtensionInstallConfirmationResult || null,
  extensionHostRestart: window.__codekSmokeExtensionHostRestartStage || window.__codekSmokeExtensionHostRestartResult || null
})`

async function collectElectronSmokeRendererStage(win, timeoutMs = 1500) {
  if (!win || win.isDestroyed()) return null
  try {
    return await Promise.race([
      win.webContents.executeJavaScript(ELECTRON_SMOKE_RENDERER_STAGE_SCRIPT),
      new Promise((resolve) => setTimeout(() => resolve({ rendererStageTimeout: true }), timeoutMs)),
    ])
  } catch {
    return null
  }
}

function normalizeSmokePathForMarkdown(filePath) {
  return String(filePath || "").replace(/\\/g, "/")
}

function sanitizeSmokeTimestamp(value) {
  return String(value || new Date().toISOString()).replace(/[:.]/g, "-")
}

function toSmokeCheckStatus(value) {
  return value ? "pass" : "fail"
}

function buildRealProjectUiSmokeAcceptance(result) {
  const expectedRoot = path.resolve(process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_ROOT || path.resolve(__dirname, ".."))
  const actualRoot = result?.projectRoot ? path.resolve(String(result.projectRoot)) : ""
  const createTargetSkipped = result?.createTargetSkipped === true
  const rootPackageSkipped = Boolean(result?.rootPackageVisibleProbe?.skipped)
  const screenshotEvidence = result?.screenshotEvidence || result?.visualEvidence || null
  const screenshotCapturesEditorSurface = isFocusedLargeFileRealProjectUiSmoke
    ? screenshotEvidence?.skipped === true
    : Boolean(screenshotEvidence?.ready)
  const scrollbarDragDirectLoadOk = result?.largeFileUserScrollbarDragDirectLoadRequired === false
    || Boolean(result?.largeFileUserScrollbarDragDirectLoaded)
  return {
    opensConfiguredRoot: actualRoot === expectedRoot,
    nativeExplorerMounted: Boolean(result?.nativeHostMounted),
    explorerRowsVirtualizedAndNonBlank: Number(result?.domRows || 0) > 0 && Number(result?.domRows || 0) <= 160 && !result?.blankVisibleRows,
    visibleRowsStableAfterFastScroll: Boolean(result?.visibleRowsStableAfterFastScroll),
    scrollP95WithinCursorGradeBudget: Number(result?.p95ScrollMs || 0) <= 48,
    scrollMaxAvoidsHalfSecondStalls: Number(result?.maxScrollMs || 0) <= 160,
    normalEditorContentVisible: Boolean(result?.normalEditorContentVisible),
    rootPackageExplorerClickRendersEditor: rootPackageSkipped || Boolean(result?.rootPackageEditorValueVisible)
      && Boolean(result?.rootPackageDomTextVisible)
      && Boolean(result?.rootPackageLineNumbersVisible),
    largeFileRealContentVisible: Boolean(result?.largeFileRealContentVisible)
      && Boolean(result?.largeFileEditorVisible)
      && Boolean(result?.largeFileContentVisible)
      && Boolean(result?.largeFileDeepViewportTextVisible)
      && Boolean(result?.largeFileNextWindowViewportTextVisible)
      && Boolean(result?.largeFileSafeLineLength)
      && Boolean(result?.largeFileContinuousWindowVisible),
    largeFileUserScrollAvoidsBlankViewport: Boolean(result?.largeFileUserPageDownViewportTextVisible)
      && Boolean(result?.largeFileUserScrollBottomLoaded)
      && Boolean(result?.largeFileUserScrollBottomOffsetAdvanced)
      && Boolean(result?.largeFileUserScrollBottomViewportTextVisible)
      && Boolean(result?.largeFileUserScrollbarDragDispatched)
      && Boolean(result?.largeFileUserScrollbarDragScrollAdvanced)
      && scrollbarDragDirectLoadOk
      && Boolean(result?.largeFileUserScrollbarDragOffsetAdvanced)
      && Boolean(result?.largeFileUserScrollbarDragViewportTextVisible)
      && Boolean(result?.largeFileUserEndViewportTextVisible),
    largeFileAvoidsBlockingNotice: Boolean(result?.largeFileLowNoiseStatusVisible)
      && Boolean(result?.largeFileWarningBadgeHidden)
      && result?.largeFileOrdinaryStatusHidden !== false,
    largeFileReopenRealContentVisible: Boolean(result?.largeFileReopenRealContentVisible)
      && Boolean(result?.largeFileReopenViewportTextVisible),
    largeFileCloseReopenKeepsWorkbenchResponsive: Boolean(result?.largeFileCloseReopenKeepsWorkbenchResponsive),
    extremeFileAutoWindowNavigation: Boolean(result?.extremeFileAutoWindowNavigation)
      && Boolean(result?.extremeFileFirstWindowVisible)
      && Boolean(result?.extremeFileSecondWindowVisible),
    idleFakeLightbulbHidden: Boolean(result?.idleLightbulbHidden),
    searchResultOpensNonBlankEditor: Boolean(result?.searchOpenedContentVisible)
      && !result?.searchBlankEditor
      && result?.searchExpectedPathMatched !== false,
    sameLineSearchDuplicatesCollapsed: Boolean(result?.sameLineDuplicateCollapsed),
    sameLineSearchOccurrencesAccurate: Boolean(result?.sameLineOccurrencesAccurate),
    searchViewRemainsActive: Boolean(result?.searchViewActive),
    chatInputUsable: Boolean(result?.chatInputVisible) && Boolean(result?.chatInputAcceptsText),
    chatComposerAvoidsLargeWhiteBox: Boolean(result?.chatComposerCompact) && Boolean(result?.chatComposerNotWhiteBox),
    workbenchActivityBarRegistryDriven: Boolean(result?.workbenchActivityBarVisible)
      && Number(result?.workbenchActivityButtonCount || 0) >= 7
      && Array.isArray(result?.workbenchActivityContainerIds)
      && result.workbenchActivityContainerIds.includes("workbench.view.explorer")
      && result.workbenchActivityContainerIds.includes("workbench.view.search")
      && result.workbenchActivityContainerIds.includes("workbench.view.scm")
      && result.workbenchActivityContainerIds.includes("workbench.view.extensions")
      && result.workbenchActivityContainerIds.includes("workbench.view.mcp")
      && result.workbenchActivityContainerIds.includes("codek.view.agent")
      && result.workbenchActivityContainerIds.includes("workbench.view.settings")
      && !result.workbenchActivityContainerIds.includes("workbench.view.debug")
      && !result.workbenchActivityContainerIds.includes("codek.view.remote")
      && !result.workbenchActivityContainerIds.includes("codek.view.automation")
      && !result.workbenchActivityContainerIds.includes("workbench.view.testing")
      && Boolean(result?.workbenchExplorerActivityVisible)
      && Boolean(result?.workbenchSearchActivityVisible)
      && Boolean(result?.workbenchScmActivityVisible)
      && Boolean(result?.workbenchExtensionsActivityVisible)
      && Boolean(result?.workbenchMcpActivityVisible)
      && Boolean(result?.workbenchAgentActivityVisible)
      && Boolean(result?.workbenchSettingsActivityVisible),
    workbenchSidebarRegistrySwitches: Boolean(result?.workbenchSidebarVisible)
      && result?.workbenchSidebarContainerId === "workbench.view.search"
      && result?.workbenchSidebarViewId === "search"
      && Number(result?.workbenchSidebarWidth || 0) > 0
      && result?.workbenchRetainedSidebarContainerId === "workbench.view.search"
      && result?.workbenchRetainedSidebarViewId === "search",
    workbenchLayoutServiceFocusRestore: Boolean(result?.workbenchLayoutConsistent)
      && Boolean(result?.workbenchLayoutFocusVisibleParts)
      && Boolean(result?.workbenchLayoutRestoreMatches)
      && Array.isArray(result?.workbenchLayoutFocusPartIds)
      && result.workbenchLayoutFocusPartIds.includes("workbench.parts.sidebar")
      && result.workbenchLayoutFocusPartIds.includes("workbench.parts.editor")
      && result.workbenchLayoutFocusPartIds.includes("workbench.parts.panel")
      && result?.workbenchLayoutVisibleNeighbors?.sidebarNext === "workbench.parts.editor"
      && result?.workbenchLayoutVisibleNeighbors?.editorPrevious === "workbench.parts.sidebar"
      && result?.workbenchLayoutVisibleNeighbors?.editorNext === "workbench.parts.panel"
      && result?.workbenchLayoutServiceSizes?.sidebar?.width === Number(result?.workbenchSidebarWidth || 0)
      && result?.workbenchLayoutServiceSizes?.panel?.height === Number(result?.workbenchPanelHeight || 0),
    workbenchEditorPartSnapshotVisible: Boolean(result?.workbenchEditorPartVisible)
      && Boolean(result?.workbenchEditorPartActiveGroup)
      && Number(result?.workbenchEditorPartEditorCount || 0) > 0,
    workbenchEditorPartStateObservable: Boolean(result?.workbenchEditorPartVisible)
      && Boolean(result?.workbenchEditorPartActiveEditor)
      && Number(result?.workbenchEditorPartEditorCount || 0) > 0
      && Number(result?.workbenchEditorPartDirtyCount || 0) >= 0
      && Number(result?.workbenchEditorPartPinnedCount || 0) >= 0
      && Number(result?.workbenchEditorPartPreviewCount || 0) >= 0
      && Number(result?.workbenchEditorPartOverflowCount || 0) >= 0,
    workbenchPanelSnapshotVisible: isWorkbenchPanelSnapshotVisible(result),
    workbenchTitleBarSurfaceVisible: Boolean(result?.workbenchTitleBarVisible)
      && Boolean(result?.workbenchTitleProjectName)
      && result?.workbenchTitleActiveViewId === "search"
      && result?.workbenchTitleCommandPaletteHint === "Ctrl+Shift+P",
    workbenchStatusBarSurfaceVisible: Boolean(result?.workbenchStatusBarVisible)
      && result?.workbenchStatusActiveViewId === "search"
      && Boolean(result?.workbenchStatusLanguageId)
      && Number(result?.workbenchStatusLine || 0) >= 1
      && Number(result?.workbenchStatusColumn || 0) >= 1,
    workbenchCommandSurfaceVisible: Boolean(result?.workbenchCommandSurfaceVisible)
      && Number(result?.workbenchCommandSurfaceCommandCount || 0) >= 8
      && Array.isArray(result?.workbenchCommandSurfaceCommandIds)
      && result.workbenchCommandSurfaceCommandIds.includes("workbench.view.search")
      && result.workbenchCommandSurfaceCommandIds.includes("workbench.action.toggleSidebarVisibility")
      && Array.isArray(result?.workbenchCommandSurfaceMenuIds)
      && result.workbenchCommandSurfaceMenuIds.includes("CommandPalette")
      && result.workbenchCommandSurfaceMenuIds.includes("MenubarViewMenu")
      && Number(result?.workbenchCommandSurfaceMenuEntryCount || 0) > 0
      && Number(result?.workbenchCommandPaletteCommandCount || 0) > 0,
    agentEvidenceWorkbenchSurfaceVisible: Boolean(result?.agentEvidenceWorkbenchVisible)
      && Boolean(result?.agentEvidenceListVisible)
      && Boolean(result?.agentEvidenceScmVisible)
      && Boolean(result?.agentEvidenceTestingVisible)
      && Boolean(result?.agentEvidenceTimelineVisible)
      && Boolean(result?.agentEvidenceProgressVisible)
      && Boolean(result?.agentEvidenceNotificationsVisible)
      && Boolean(result?.agentEvidenceCorrelationId),
    agentEvidenceWorkbenchServiceBoundary: Array.isArray(result?.agentEvidenceScmOpenCommandIds)
      && Array.isArray(result?.agentEvidenceVsCodeServiceIds)
      && result.agentEvidenceVsCodeServiceIds.includes("timeline")
      && result.agentEvidenceVsCodeServiceIds.includes("scm")
      && result.agentEvidenceVsCodeServiceIds.includes("testService")
      && result.agentEvidenceVsCodeServiceIds.includes("progressService")
      && result.agentEvidenceVsCodeServiceIds.includes("notificationService")
      && result.agentEvidenceScmOpenCommandIds.includes("agent.evidence.openResource")
      && Array.isArray(result?.agentEvidenceScmDiffCommandIds)
      && result.agentEvidenceScmDiffCommandIds.includes("agent.evidence.diffResource")
      && Array.isArray(result?.agentEvidenceScmStageCommandIds)
      && result.agentEvidenceScmStageCommandIds.includes("agent.evidence.stageResource")
      && Array.isArray(result?.agentEvidenceScmAttachCommandIds)
      && result.agentEvidenceScmAttachCommandIds.includes("agent.evidence.attachResource")
      && Array.isArray(result?.agentEvidenceScmReadonlyEvidenceFlags)
      && result.agentEvidenceScmReadonlyEvidenceFlags.includes("true")
      && Array.isArray(result?.agentEvidenceTestingRerunCommandIds)
      && result.agentEvidenceTestingRerunCommandIds.includes("agent.evidence.reviewTests"),
    agentEvidenceWorkbenchListDetailExport: Boolean(result?.agentEvidenceListVisible)
      && Number(result?.agentEvidenceListCount || 0) > 0
      && Array.isArray(result?.agentEvidenceListFilterSurfaces)
      && result.agentEvidenceListFilterSurfaces.includes("timeline")
      && result.agentEvidenceListFilterSurfaces.includes("scm")
      && result.agentEvidenceListFilterSurfaces.includes("testing")
      && result.agentEvidenceListFilterSurfaces.includes("progress")
      && result.agentEvidenceListFilterSurfaces.includes("notifications")
      && Array.isArray(result?.agentEvidenceListItemSurfaces)
      && result.agentEvidenceListItemSurfaces.includes("testing")
      && result.agentEvidenceListItemSurfaces.includes("notifications")
      && Boolean(result?.agentEvidenceDetailKind)
      && Boolean(result?.agentEvidenceDetailEditorId)
      && String(result?.agentEvidenceDetailEditorUri || "").startsWith("agent-evidence://")
      && result?.agentEvidenceExportCommand === "agent.evidence.exportJson"
      && result?.agentEvidenceExportMarkdownCommand === "agent.evidence.exportMarkdown"
      && String(result?.agentEvidenceExportPath || "").endsWith("agent-evidence-workbench-latest.json")
      && String(result?.agentEvidenceExportMarkdownPath || "").endsWith("agent-evidence-workbench-latest.md"),
    agentEvidenceWorkbenchTimelineLinks: Array.isArray(result?.agentEvidenceTimelineCommandIds)
      && result.agentEvidenceTimelineCommandIds.includes("agent.evidence.openTesting")
      && Array.isArray(result?.agentEvidenceTimelineResources)
      && result.agentEvidenceTimelineResources.length > 0
      && Array.isArray(result?.agentEvidenceTimelineLinks)
      && result.agentEvidenceTimelineLinks.length > 0,
    agentEvidenceWorkbenchProgressNotifications: Array.isArray(result?.agentEvidenceProgressAggregateStatuses)
      && result.agentEvidenceProgressAggregateStatuses.length > 0
      && Array.isArray(result?.agentEvidenceProgressCancelCommandIds)
      && result.agentEvidenceProgressCancelCommandIds.includes("agent.evidence.cancelProgress")
      && Array.isArray(result?.agentEvidenceProgressAriaLabels)
      && result.agentEvidenceProgressAriaLabels.length > 0
      && Array.isArray(result?.agentEvidenceNotificationDedupeKeys)
      && result.agentEvidenceNotificationDedupeKeys.length > 0
      && Array.isArray(result?.agentEvidenceNotificationDismissCommandIds)
      && result.agentEvidenceNotificationDismissCommandIds.includes("agent.evidence.dismissNotification")
      && Array.isArray(result?.agentEvidenceNotificationFocusTargets)
      && result.agentEvidenceNotificationFocusTargets.includes("notifications"),
    quickInputWorkbenchRealUi: Boolean(result?.quickInputWorkbenchVisible)
      && Boolean(result?.quickInputWorkbenchPickAccepted)
      && Boolean(result?.quickInputWorkbenchInputCancelled),
    quickInputWorkbenchServiceBoundary: result?.quickInputWorkbenchServiceId === "quickInputService"
      && result?.quickInputWorkbenchStateSource === "quickInputService"
      && result?.quickInputWorkbenchQuickPickKind === "quickPick"
      && result?.quickInputWorkbenchInputKind === "inputBox",
    mcpWorkbenchSurfaceVisible: Boolean(result?.mcpWorkbenchSurfaceVisible)
      && Boolean(result?.mcpWorkbenchServersVisible)
      && Boolean(result?.mcpWorkbenchResourcesVisible)
      && Boolean(result?.mcpWorkbenchGalleryVisible),
    mcpWorkbenchServiceBoundary: Array.isArray(result?.mcpWorkbenchViewIds)
      && result?.mcpWorkbenchServiceId === "mcpWorkbenchService"
      && result?.mcpWorkbenchStateSource === "service"
      && result.mcpWorkbenchViewIds.includes("workbench.mcp.servers")
      && result.mcpWorkbenchViewIds.includes("workbench.mcp.resources")
      && result.mcpWorkbenchViewIds.includes("workbench.mcp.gallery")
      && result?.mcpWorkbenchReadonlyProviderPath === true
      && Array.isArray(result?.mcpWorkbenchQuickAccessPrefixes)
      && result.mcpWorkbenchQuickAccessPrefixes.includes("mcp:")
      && result.mcpWorkbenchQuickAccessPrefixes.includes("mcpr "),
    mcpGalleryWorkbenchDetailActionEvidence: Boolean(result?.mcpGalleryWorkbenchDetailVisible)
      && Boolean(result?.mcpGalleryWorkbenchDetailSeeded)
      && typeof result?.mcpGalleryWorkbenchServer === "string"
      && result.mcpGalleryWorkbenchServer.length > 0
      && Array.isArray(result?.mcpGalleryWorkbenchActionIds)
      && result.mcpGalleryWorkbenchActionIds.includes("install")
      && Number(result?.mcpGalleryWorkbenchMetadataCount || 0) > 0
      && result?.mcpGalleryWorkbenchHasReadme === true
      && result?.mcpGalleryWorkbenchHasManifest === true
      && result?.mcpWorkbenchPreservesAgentApproval === true
      && result?.mcpWorkbenchNoSecondState === true,
    extensionGalleryWorkbenchSurfaceVisible: Boolean(result?.extensionGalleryWorkbenchSurfaceVisible)
      && Boolean(result?.extensionGalleryWorkbenchShellVisible)
      && Boolean(result?.extensionGalleryWorkbenchSearchVisible)
      && Boolean(result?.extensionGalleryWorkbenchInstalledVisible)
      && Boolean(result?.extensionGalleryWorkbenchResultsVisible),
    extensionGalleryWorkbenchServiceBoundary: result?.extensionGalleryWorkbenchContainerId === "workbench.view.extensions"
      && result?.extensionGalleryWorkbenchViewId === "workbench.extensions.marketplace"
      && result?.extensionGalleryWorkbenchServiceId === "extensionsWorkbenchService"
      && result?.extensionGalleryWorkbenchStateSource === "service"
      && result?.extensionGalleryWorkbenchQuickAccessPrefix === "ext "
      && result?.extensionGalleryWorkbenchLocalFirst === true
      && result?.extensionGalleryWorkbenchNoSecondState === true
      && Array.isArray(result?.extensionGalleryWorkbenchCommandIds)
      && result.extensionGalleryWorkbenchCommandIds.includes("workbench.extensions.open")
      && result.extensionGalleryWorkbenchCommandIds.includes("workbench.extensions.install"),
    extensionGalleryWorkbenchEditorActionEvidence: Boolean(result?.extensionGalleryWorkbenchDetailVisible)
      && Boolean(result?.extensionGalleryWorkbenchDetailOpened)
      && result?.extensionGalleryWorkbenchDetailServiceId === "extensionsWorkbenchService"
      && result?.extensionGalleryWorkbenchDetailStateSource === "service"
      && typeof result?.extensionGalleryWorkbenchDetailExtensionId === "string"
      && result.extensionGalleryWorkbenchDetailExtensionId.length > 0
      && Array.isArray(result?.extensionGalleryWorkbenchDetailActionIds)
      && result.extensionGalleryWorkbenchDetailActionIds.length > 0,
    extensionTrustRemoteAuthWorkbenchSurfaceVisible: Boolean(result?.extensionTrustRemoteAuthWorkbenchSurfaceVisible)
      && result?.extensionTrustRemoteAuthWorkbenchContainerId === "codek.view.extensionTrustRemoteAuth"
      && Array.isArray(result?.extensionTrustRemoteAuthWorkbenchViewIds)
      && result.extensionTrustRemoteAuthWorkbenchViewIds.includes("codek.extensionHost.surface")
      && result.extensionTrustRemoteAuthWorkbenchViewIds.includes("codek.workspaceTrust.surface")
      && result.extensionTrustRemoteAuthWorkbenchViewIds.includes("codek.remoteAuthority.surface")
      && result.extensionTrustRemoteAuthWorkbenchViewIds.includes("codek.authentication.surface"),
    extensionTrustRemoteAuthWorkbenchServiceBoundary: result?.extensionTrustRemoteAuthWorkbenchExtensionHostServiceId === "extensionHostService"
      && result?.extensionTrustRemoteAuthWorkbenchWorkspaceTrustServiceId === "workspaceTrustManagementService"
      && result?.extensionTrustRemoteAuthWorkbenchRemoteAuthorityServiceId === "remoteAuthorityResolverService"
      && result?.extensionTrustRemoteAuthWorkbenchAuthenticationServiceId === "IAuthenticationService"
      && result?.extensionTrustRemoteAuthWorkbenchExtensionHostStateSource === "extensionsWorkbenchService+ehClient"
      && result?.extensionTrustRemoteAuthWorkbenchWorkspaceTrustStateSource === "workspaceTrustRoutes+agentPolicy"
      && result?.extensionTrustRemoteAuthWorkbenchRemoteAuthorityStateSource === "remoteManager"
      && result?.extensionTrustRemoteAuthWorkbenchAuthenticationStateSource === "authState+mcpRegistryClient"
      && Array.isArray(result?.extensionTrustRemoteAuthWorkbenchCommandIds)
      && result.extensionTrustRemoteAuthWorkbenchCommandIds.includes("workbench.extensionHost.activatePlaceholder")
      && result.extensionTrustRemoteAuthWorkbenchCommandIds.includes("workbench.workspaceTrust.allow")
      && result.extensionTrustRemoteAuthWorkbenchCommandIds.includes("workbench.remoteAuthority.resolve")
      && result.extensionTrustRemoteAuthWorkbenchCommandIds.includes("workbench.authentication.requestSession")
      && result?.extensionTrustRemoteAuthWorkbenchNoSecondExtensionRuntime === true
      && result?.extensionTrustRemoteAuthWorkbenchNoSecondTrustStore === true
      && result?.extensionTrustRemoteAuthWorkbenchNoSecondRemoteState === true
      && result?.extensionTrustRemoteAuthWorkbenchNoSecondAuthStore === true
      && result?.extensionTrustRemoteAuthWorkbenchPreservesAgentEvidence === true,
    extensionHostWorkbenchActivationEvidence: Number(result?.extensionHostWorkbenchActivationCount || 0) > 0
      && result?.extensionHostWorkbenchLatestActivationEvent === "onStartupFinished"
      && typeof result?.extensionHostWorkbenchLatestActivationExtension === "string"
      && result.extensionHostWorkbenchLatestActivationExtension.length > 0,
    workspaceTrustWorkbenchDecisionEvidence: Number(result?.workspaceTrustWorkbenchDecisionCount || 0) >= 2
      && result?.workspaceTrustWorkbenchLatestDecision === "deny"
      && result?.workspaceTrustWorkbenchStatus === "restricted",
    remoteAuthorityWorkbenchResolveEvidence: Number(result?.remoteAuthorityWorkbenchResolveCount || 0) >= 3
      && Number(result?.remoteAuthorityWorkbenchSuccessCount || 0) >= 2
      && Number(result?.remoteAuthorityWorkbenchFailureCount || 0) >= 1
      && Number(result?.remoteAuthorityWorkbenchCacheHitCount || 0) >= 1
      && result?.remoteAuthorityWorkbenchLatestStatus === "error",
    authenticationWorkbenchSessionEvidence: Array.isArray(result?.authenticationWorkbenchStatuses)
      && result.authenticationWorkbenchStatuses.includes("missing")
      && result.authenticationWorkbenchStatuses.includes("pending")
      && result.authenticationWorkbenchStatuses.includes("authorized")
      && result.authenticationWorkbenchStatuses.includes("revoked")
      && result.authenticationWorkbenchStatuses.includes("error")
      && result?.authenticationWorkbenchLatestStatus === "error"
      && result?.authenticationWorkbenchTokenRedacted === true
      && Array.isArray(result?.authenticationWorkbenchProviderIds)
      && result.authenticationWorkbenchProviderIds.includes("github"),
    terminalDebugTaskWorkbenchServiceBoundary: Boolean(result?.terminalDebugTaskWorkbenchServiceBoundary)
      && result?.terminalDebugTaskWorkbenchServiceId === "terminalDebugTaskWorkbenchService"
      && Array.isArray(result?.terminalDebugTaskWorkbenchVsCodeServiceIds)
      && result.terminalDebugTaskWorkbenchVsCodeServiceIds.includes("terminalService")
      && result.terminalDebugTaskWorkbenchVsCodeServiceIds.includes("outputService")
      && result.terminalDebugTaskWorkbenchVsCodeServiceIds.includes("debugService")
      && result.terminalDebugTaskWorkbenchVsCodeServiceIds.includes("taskService")
      && result.terminalDebugTaskWorkbenchVsCodeServiceIds.includes("problemsWorkbenchService")
      && result.terminalDebugTaskWorkbenchVsCodeServiceIds.includes("paneCompositePartService")
      && Array.isArray(result?.terminalDebugTaskWorkbenchCommandFailures)
      && result.terminalDebugTaskWorkbenchCommandFailures.length === 0,
    terminalDebugTaskWorkbenchPanelBridge: Boolean(result?.terminalDebugTaskWorkbenchPanelBridge)
      && result?.terminalDebugTaskWorkbenchPanelId === "tasks"
      && Number(result?.terminalDebugTaskWorkbenchPaneCompositeOpenCount || 0) >= 4
      && Number(result?.terminalDebugTaskWorkbenchPaneCompositeToggleCount || 0) >= 1,
    outputWorkbenchChannelEvidence: Boolean(result?.outputWorkbenchChannelEvidence)
      && result?.terminalDebugTaskWorkbenchOutputChannelName === "TerminalDebugTaskWorkbench Smoke"
      && Number(result?.terminalDebugTaskWorkbenchOutputEntryCount || 0) > 0,
    taskWorkbenchRunEvidence: Boolean(result?.taskWorkbenchRunEvidence)
      && result?.terminalDebugTaskWorkbenchTaskLatestStatus === "passed"
      && String(result?.terminalDebugTaskWorkbenchTaskLatestSummary || "").length > 0,
    taskWorkbenchPanelSurface: Boolean(result?.taskWorkbenchPanelSurface)
      && result?.terminalDebugTaskWorkbenchTaskPanelVisible === true
      && result?.terminalDebugTaskWorkbenchTaskPanelViewId === "workbench.view.tasks"
      && result?.terminalDebugTaskWorkbenchTaskPanelStateSource === "taskConfigurationModel/userTasksService/problemMatcherRegistry"
      && Number(result?.terminalDebugTaskWorkbenchTaskPanelRunConfigCount || 0) > 0,
    debugWorkbenchSessionEvidence: Boolean(result?.debugWorkbenchSessionEvidence)
      && Number(result?.terminalDebugTaskWorkbenchDebugConsoleEntryCount || 0) > 0,
    terminalWorkbenchCommandEvidence: Boolean(result?.terminalWorkbenchCommandEvidence)
      && Number(result?.terminalDebugTaskWorkbenchTerminalCount || 0) > 0,
    problemsWorkbenchReadOnlyBridge: Boolean(result?.problemsWorkbenchReadOnlyBridge)
      && result?.terminalDebugTaskWorkbenchProblemsVisible === true
      && Number(result?.terminalDebugTaskWorkbenchProblemsDiagnosticCount || 0) >= 0,
    createTargetDisplayMatchesDisk: createTargetSkipped || Boolean(result?.createdFileRowVisible)
      && Boolean(result?.createdFolderRowVisible)
      && Boolean(result?.createdFileExistsOnDisk)
      && Boolean(result?.createdFolderExistsOnDisk)
      && !result?.wrongRootFileExistsOnDisk
      && !result?.wrongRootFolderExistsOnDisk,
    continuousCreateRemainsUsable: createTargetSkipped || Boolean(result?.continuousCreatePassed)
      && Number(result?.continuousCreateCount || 0) >= 10
      && Boolean(result?.continuousCreateRowsVisible)
      && Boolean(result?.continuousCreateAllExistOnDisk),
    staleCreateSnapshotRejected: createTargetSkipped || Boolean(result?.staleCreateSnapshotRejected)
      && !result?.staleRequestedFileExistsOnDisk
      && !result?.staleSnapshotFileExistsOnDisk,
    screenshotCapturesEditorSurface,
  }
}

function renderRealProjectUiSmokeMarkdown(report) {
  const acceptanceRows = Object.entries(report.acceptance || {})
    .map(([name, passed]) => `| ${name} | ${toSmokeCheckStatus(passed)} |`)
    .join("\n")
  const gateAttributionRows = formatRealProjectUiGateAttributionMarkdown(report.gateAttribution)
  const manualAcceptanceContractRows = formatRealProjectUiManualAcceptanceContractMarkdown(report.manualAcceptanceContract)
  const metricRows = [
    ["projectRoot", report.projectRoot],
    ["domRows", report.metrics?.domRows],
    ["totalRows", report.metrics?.totalRows],
    ["blankVisibleRows", report.metrics?.blankVisibleRows],
    ["visibleRowsStableAfterFastScroll", report.metrics?.visibleRowsStableAfterFastScroll],
    ["p95ScrollMs", report.metrics?.p95ScrollMs],
    ["maxScrollMs", report.metrics?.maxScrollMs],
    ["longTasks", report.metrics?.longTasks],
    ["rootPackageFile", report.metrics?.rootPackageFile],
    ["rootPackageActiveFile", report.metrics?.rootPackageActiveFile],
    ["rootPackageEditorValueVisible", report.metrics?.rootPackageEditorValueVisible],
    ["rootPackageDomTextVisible", report.metrics?.rootPackageDomTextVisible],
    ["rootPackageLineNumbersVisible", report.metrics?.rootPackageLineNumbersVisible],
    ["largeFile", report.metrics?.largeFile],
    ["largeFileRealContentVisible", report.metrics?.largeFileRealContentVisible],
    ["largeFileViewportTextVisible", report.metrics?.largeFileViewportTextVisible],
    ["largeFileDeepViewportTextVisible", report.metrics?.largeFileDeepViewportTextVisible],
    ["largeFileDeepViewportLine", report.metrics?.largeFileDeepViewportLine],
    ["largeFileDeepViewportFirstVisibleLineNumber", report.metrics?.largeFileDeepViewportFirstVisibleLineNumber],
    ["largeFileDeepViewportLastVisibleLineNumber", report.metrics?.largeFileDeepViewportLastVisibleLineNumber],
    ["largeFileDeepViewportVisibleLineCount", report.metrics?.largeFileDeepViewportVisibleLineCount],
    ["largeFileNextWindowViewportTextVisible", report.metrics?.largeFileNextWindowViewportTextVisible],
    ["largeFileNextWindowViewportLine", report.metrics?.largeFileNextWindowViewportLine],
    ["largeFileReopenViewportTextVisible", report.metrics?.largeFileReopenViewportTextVisible],
    ["largeFileReopenRealContentVisible", report.metrics?.largeFileReopenRealContentVisible],
    ["largeFileUserPageDownViewportTextVisible", report.metrics?.largeFileUserPageDownViewportTextVisible],
    ["largeFileUserScrollBottomLoaded", report.metrics?.largeFileUserScrollBottomLoaded],
    ["largeFileUserScrollBottomOffsetAdvanced", report.metrics?.largeFileUserScrollBottomOffsetAdvanced],
    ["largeFileUserScrollBottomViewportTextVisible", report.metrics?.largeFileUserScrollBottomViewportTextVisible],
    ["largeFileUserScrollbarDragDispatched", report.metrics?.largeFileUserScrollbarDragDispatched],
    ["largeFileUserScrollbarDragScrollBefore", report.metrics?.largeFileUserScrollbarDragScrollBefore],
    ["largeFileUserScrollbarDragScrollAfter", report.metrics?.largeFileUserScrollbarDragScrollAfter],
    ["largeFileUserScrollbarDragScrollAdvanced", report.metrics?.largeFileUserScrollbarDragScrollAdvanced],
    ["largeFileUserScrollbarDragDirectLoadRequired", report.metrics?.largeFileUserScrollbarDragDirectLoadRequired],
    ["largeFileUserScrollbarDragDirectLoaded", report.metrics?.largeFileUserScrollbarDragDirectLoaded],
    ["largeFileUserScrollbarDragLoaded", report.metrics?.largeFileUserScrollbarDragLoaded],
    ["largeFileUserScrollbarDragOffsetAdvanced", report.metrics?.largeFileUserScrollbarDragOffsetAdvanced],
    ["largeFileUserScrollbarDragViewportTextVisible", report.metrics?.largeFileUserScrollbarDragViewportTextVisible],
    ["largeFileUserEndViewportTextVisible", report.metrics?.largeFileUserEndViewportTextVisible],
    ["largeFileUserScrollBeforeOffset", report.metrics?.largeFileUserScrollBeforeOffset],
    ["largeFileUserScrollTargetOffset", report.metrics?.largeFileUserScrollTargetOffset],
    ["largeFileUserScrollBottomOffset", report.metrics?.largeFileUserScrollBottomOffset],
    ["largeFileUserScrollbarDragTargetOffset", report.metrics?.largeFileUserScrollbarDragTargetOffset],
    ["largeFileUserScrollbarDragOffset", report.metrics?.largeFileUserScrollbarDragOffset],
    ["largeFileUserScrollEndOffset", report.metrics?.largeFileUserScrollEndOffset],
    ["largeFileUserScrollEndHasNext", report.metrics?.largeFileUserScrollEndHasNext],
    ["largeFileCloseReopenKeepsWorkbenchResponsive", report.metrics?.largeFileCloseReopenKeepsWorkbenchResponsive],
    ["largeFileSafeLineLength", report.metrics?.largeFileSafeLineLength],
    ["largeFileContinuousWindowVisible", report.metrics?.largeFileContinuousWindowVisible],
    ["largeFileEditorLineCount", report.metrics?.largeFileEditorLineCount],
    ["largeFileFirstVisibleLineNumber", report.metrics?.largeFileFirstVisibleLineNumber],
    ["largeFileLastVisibleLineNumber", report.metrics?.largeFileLastVisibleLineNumber],
    ["largeFileMaxVisibleLineLength", report.metrics?.largeFileMaxVisibleLineLength],
    ["largeFileLowNoiseStatusVisible", report.metrics?.largeFileLowNoiseStatusVisible],
    ["largeFileWarningBadgeHidden", report.metrics?.largeFileWarningBadgeHidden],
    ["extremeFile", report.metrics?.extremeFile],
    ["extremeFileAutoWindowNavigation", report.metrics?.extremeFileAutoWindowNavigation],
    ["extremeFileFirstWindowVisible", report.metrics?.extremeFileFirstWindowVisible],
    ["extremeFileSecondWindowVisible", report.metrics?.extremeFileSecondWindowVisible],
    ["idleLightbulbCount", report.metrics?.idleLightbulbCount],
    ["searchQuery", report.metrics?.searchQuery],
    ["expectedSearchPath", report.metrics?.expectedSearchPath],
    ["searchMatchPath", report.metrics?.searchMatchPath],
    ["searchExpectedPathMatched", report.metrics?.searchExpectedPathMatched],
    ["sameLineNeedle", report.metrics?.sameLineNeedle],
    ["sameLineSearchPath", report.metrics?.sameLineSearchPath],
    ["sameLineMatchRows", report.metrics?.sameLineMatchRows],
    ["sameLineOccurrences", report.metrics?.sameLineOccurrences],
    ["workbenchActivityButtonCount", report.metrics?.workbenchActivityButtonCount],
    ["workbenchActivityContainerIds", Array.isArray(report.metrics?.workbenchActivityContainerIds) ? report.metrics.workbenchActivityContainerIds.join(", ") : ""],
    ["workbenchSidebarContainerId", report.metrics?.workbenchSidebarContainerId],
    ["workbenchSidebarViewId", report.metrics?.workbenchSidebarViewId],
    ["workbenchRetainedSidebarContainerId", report.metrics?.workbenchRetainedSidebarContainerId],
    ["workbenchRetainedSidebarViewId", report.metrics?.workbenchRetainedSidebarViewId],
    ["workbenchTitleBarVisible", report.metrics?.workbenchTitleBarVisible],
    ["workbenchTitleProjectName", report.metrics?.workbenchTitleProjectName],
    ["workbenchTitleActiveEditor", report.metrics?.workbenchTitleActiveEditor],
    ["workbenchTitleActiveViewId", report.metrics?.workbenchTitleActiveViewId],
    ["workbenchTitleAgentMode", report.metrics?.workbenchTitleAgentMode],
    ["workbenchTitleSandboxMode", report.metrics?.workbenchTitleSandboxMode],
    ["workbenchTitleCommandPaletteHint", report.metrics?.workbenchTitleCommandPaletteHint],
    ["agentEvidenceWorkbenchVisible", report.metrics?.agentEvidenceWorkbenchVisible],
    ["agentEvidenceWorkbenchStatus", report.metrics?.agentEvidenceWorkbenchStatus],
    ["agentEvidenceCorrelationId", report.metrics?.agentEvidenceCorrelationId],
    ["agentEvidenceVsCodeServiceIds", Array.isArray(report.metrics?.agentEvidenceVsCodeServiceIds) ? report.metrics.agentEvidenceVsCodeServiceIds.join(", ") : ""],
    ["agentEvidenceListVisible", report.metrics?.agentEvidenceListVisible],
    ["agentEvidenceListCount", report.metrics?.agentEvidenceListCount],
    ["agentEvidenceListFilterSurfaces", Array.isArray(report.metrics?.agentEvidenceListFilterSurfaces) ? report.metrics.agentEvidenceListFilterSurfaces.join(", ") : ""],
    ["agentEvidenceListFilterStatuses", Array.isArray(report.metrics?.agentEvidenceListFilterStatuses) ? report.metrics.agentEvidenceListFilterStatuses.join(", ") : ""],
    ["agentEvidenceListFilterSeverities", Array.isArray(report.metrics?.agentEvidenceListFilterSeverities) ? report.metrics.agentEvidenceListFilterSeverities.join(", ") : ""],
    ["agentEvidenceListItemSurfaces", Array.isArray(report.metrics?.agentEvidenceListItemSurfaces) ? report.metrics.agentEvidenceListItemSurfaces.join(", ") : ""],
    ["agentEvidenceListItemStatuses", Array.isArray(report.metrics?.agentEvidenceListItemStatuses) ? report.metrics.agentEvidenceListItemStatuses.join(", ") : ""],
    ["agentEvidenceListItemSeverities", Array.isArray(report.metrics?.agentEvidenceListItemSeverities) ? report.metrics.agentEvidenceListItemSeverities.join(", ") : ""],
    ["agentEvidenceListItemCommands", Array.isArray(report.metrics?.agentEvidenceListItemCommands) ? report.metrics.agentEvidenceListItemCommands.join(", ") : ""],
    ["agentEvidenceDetailKind", report.metrics?.agentEvidenceDetailKind],
    ["agentEvidenceDetailId", report.metrics?.agentEvidenceDetailId],
    ["agentEvidenceDetailEditorId", report.metrics?.agentEvidenceDetailEditorId],
    ["agentEvidenceDetailEditorUri", report.metrics?.agentEvidenceDetailEditorUri],
    ["agentEvidenceExportCommand", report.metrics?.agentEvidenceExportCommand],
    ["agentEvidenceExportMarkdownCommand", report.metrics?.agentEvidenceExportMarkdownCommand],
    ["agentEvidenceExportPath", report.metrics?.agentEvidenceExportPath],
    ["agentEvidenceExportMarkdownPath", report.metrics?.agentEvidenceExportMarkdownPath],
    ["agentEvidenceScmVisible", report.metrics?.agentEvidenceScmVisible],
    ["agentEvidenceScmOpenCommandIds", Array.isArray(report.metrics?.agentEvidenceScmOpenCommandIds) ? report.metrics.agentEvidenceScmOpenCommandIds.join(", ") : ""],
    ["agentEvidenceScmDiffCommandIds", Array.isArray(report.metrics?.agentEvidenceScmDiffCommandIds) ? report.metrics.agentEvidenceScmDiffCommandIds.join(", ") : ""],
    ["agentEvidenceScmStageCommandIds", Array.isArray(report.metrics?.agentEvidenceScmStageCommandIds) ? report.metrics.agentEvidenceScmStageCommandIds.join(", ") : ""],
    ["agentEvidenceScmAttachCommandIds", Array.isArray(report.metrics?.agentEvidenceScmAttachCommandIds) ? report.metrics.agentEvidenceScmAttachCommandIds.join(", ") : ""],
    ["agentEvidenceScmReadonlyEvidenceFlags", Array.isArray(report.metrics?.agentEvidenceScmReadonlyEvidenceFlags) ? report.metrics.agentEvidenceScmReadonlyEvidenceFlags.join(", ") : ""],
    ["agentEvidenceScmRollbackRiskLabels", Array.isArray(report.metrics?.agentEvidenceScmRollbackRiskLabels) ? report.metrics.agentEvidenceScmRollbackRiskLabels.join(", ") : ""],
    ["agentEvidenceTestingVisible", report.metrics?.agentEvidenceTestingVisible],
    ["agentEvidenceTestingState", report.metrics?.agentEvidenceTestingState],
    ["agentEvidenceTestingRerunCommandIds", Array.isArray(report.metrics?.agentEvidenceTestingRerunCommandIds) ? report.metrics.agentEvidenceTestingRerunCommandIds.join(", ") : ""],
    ["agentEvidenceTestingFailureDetails", Array.isArray(report.metrics?.agentEvidenceTestingFailureDetails) ? report.metrics.agentEvidenceTestingFailureDetails.join(", ") : ""],
    ["agentEvidenceTestingResourceLinks", Array.isArray(report.metrics?.agentEvidenceTestingResourceLinks) ? report.metrics.agentEvidenceTestingResourceLinks.join(", ") : ""],
    ["agentEvidenceTimelineVisible", report.metrics?.agentEvidenceTimelineVisible],
    ["agentEvidenceTimelineRows", report.metrics?.agentEvidenceTimelineRows],
    ["agentEvidenceTimelineCommandIds", Array.isArray(report.metrics?.agentEvidenceTimelineCommandIds) ? report.metrics.agentEvidenceTimelineCommandIds.join(", ") : ""],
    ["agentEvidenceTimelineResources", Array.isArray(report.metrics?.agentEvidenceTimelineResources) ? report.metrics.agentEvidenceTimelineResources.join(", ") : ""],
    ["agentEvidenceTimelineLinks", Array.isArray(report.metrics?.agentEvidenceTimelineLinks) ? report.metrics.agentEvidenceTimelineLinks.join(", ") : ""],
    ["agentEvidenceProgressVisible", report.metrics?.agentEvidenceProgressVisible],
    ["agentEvidenceProgressRows", report.metrics?.agentEvidenceProgressRows],
    ["agentEvidenceProgressAggregateStatuses", Array.isArray(report.metrics?.agentEvidenceProgressAggregateStatuses) ? report.metrics.agentEvidenceProgressAggregateStatuses.join(", ") : ""],
    ["agentEvidenceProgressCancelCommandIds", Array.isArray(report.metrics?.agentEvidenceProgressCancelCommandIds) ? report.metrics.agentEvidenceProgressCancelCommandIds.join(", ") : ""],
    ["agentEvidenceProgressAriaLabels", Array.isArray(report.metrics?.agentEvidenceProgressAriaLabels) ? report.metrics.agentEvidenceProgressAriaLabels.join(", ") : ""],
    ["agentEvidenceNotificationsVisible", report.metrics?.agentEvidenceNotificationsVisible],
    ["agentEvidenceNotificationSeverities", Array.isArray(report.metrics?.agentEvidenceNotificationSeverities) ? report.metrics.agentEvidenceNotificationSeverities.join(", ") : ""],
    ["agentEvidenceNotificationDedupeKeys", Array.isArray(report.metrics?.agentEvidenceNotificationDedupeKeys) ? report.metrics.agentEvidenceNotificationDedupeKeys.join(", ") : ""],
    ["agentEvidenceNotificationDismissCommandIds", Array.isArray(report.metrics?.agentEvidenceNotificationDismissCommandIds) ? report.metrics.agentEvidenceNotificationDismissCommandIds.join(", ") : ""],
    ["agentEvidenceNotificationFocusTargets", Array.isArray(report.metrics?.agentEvidenceNotificationFocusTargets) ? report.metrics.agentEvidenceNotificationFocusTargets.join(", ") : ""],
    ["quickInputWorkbenchVisible", report.metrics?.quickInputWorkbenchVisible],
    ["quickInputWorkbenchPickAccepted", report.metrics?.quickInputWorkbenchPickAccepted],
    ["quickInputWorkbenchInputCancelled", report.metrics?.quickInputWorkbenchInputCancelled],
    ["quickInputWorkbenchServiceBoundary", report.metrics?.quickInputWorkbenchServiceBoundary],
    ["quickInputWorkbenchServiceId", report.metrics?.quickInputWorkbenchServiceId],
    ["quickInputWorkbenchStateSource", report.metrics?.quickInputWorkbenchStateSource],
    ["quickInputWorkbenchQuickPickKind", report.metrics?.quickInputWorkbenchQuickPickKind],
    ["quickInputWorkbenchInputKind", report.metrics?.quickInputWorkbenchInputKind],
    ["quickInputWorkbenchAcceptedValue", report.metrics?.quickInputWorkbenchAcceptedValue],
    ["quickInputWorkbenchItemCount", report.metrics?.quickInputWorkbenchItemCount],
    ["quickInputWorkbenchError", report.metrics?.quickInputWorkbenchError],
    ["mcpWorkbenchSurfaceVisible", report.metrics?.mcpWorkbenchSurfaceVisible],
    ["mcpWorkbenchServersVisible", report.metrics?.mcpWorkbenchServersVisible],
    ["mcpWorkbenchResourcesVisible", report.metrics?.mcpWorkbenchResourcesVisible],
    ["mcpWorkbenchGalleryVisible", report.metrics?.mcpWorkbenchGalleryVisible],
    ["mcpWorkbenchServiceId", report.metrics?.mcpWorkbenchServiceId],
    ["mcpWorkbenchStateSource", report.metrics?.mcpWorkbenchStateSource],
    ["mcpWorkbenchReadonlyProviderPath", report.metrics?.mcpWorkbenchReadonlyProviderPath],
    ["mcpWorkbenchViewIds", Array.isArray(report.metrics?.mcpWorkbenchViewIds) ? report.metrics.mcpWorkbenchViewIds.join(", ") : ""],
    ["mcpWorkbenchCommandIds", Array.isArray(report.metrics?.mcpWorkbenchCommandIds) ? report.metrics.mcpWorkbenchCommandIds.join(", ") : ""],
    ["mcpWorkbenchQuickAccessPrefixes", Array.isArray(report.metrics?.mcpWorkbenchQuickAccessPrefixes) ? report.metrics.mcpWorkbenchQuickAccessPrefixes.join(", ") : ""],
    ["mcpWorkbenchOpenedCount", report.metrics?.mcpWorkbenchOpenedCount],
    ["mcpWorkbenchAttachmentCount", report.metrics?.mcpWorkbenchAttachmentCount],
    ["mcpGalleryWorkbenchDetailVisible", report.metrics?.mcpGalleryWorkbenchDetailVisible],
    ["mcpGalleryWorkbenchServer", report.metrics?.mcpGalleryWorkbenchServer],
    ["mcpGalleryWorkbenchInstallState", report.metrics?.mcpGalleryWorkbenchInstallState],
    ["mcpGalleryWorkbenchStatusLabel", report.metrics?.mcpGalleryWorkbenchStatusLabel],
    ["mcpGalleryWorkbenchActionIds", Array.isArray(report.metrics?.mcpGalleryWorkbenchActionIds) ? report.metrics.mcpGalleryWorkbenchActionIds.join(", ") : ""],
    ["mcpGalleryWorkbenchEnabledActionIds", Array.isArray(report.metrics?.mcpGalleryWorkbenchEnabledActionIds) ? report.metrics.mcpGalleryWorkbenchEnabledActionIds.join(", ") : ""],
    ["mcpGalleryWorkbenchMetadataCount", report.metrics?.mcpGalleryWorkbenchMetadataCount],
    ["mcpGalleryWorkbenchHasReadme", report.metrics?.mcpGalleryWorkbenchHasReadme],
    ["mcpGalleryWorkbenchHasManifest", report.metrics?.mcpGalleryWorkbenchHasManifest],
    ["mcpGalleryWorkbenchDetailSeeded", report.metrics?.mcpGalleryWorkbenchDetailSeeded],
    ["mcpGalleryWorkbenchDetailSeedError", report.metrics?.mcpGalleryWorkbenchDetailSeedError],
    ["mcpWorkbenchPreservesAgentApproval", report.metrics?.mcpWorkbenchPreservesAgentApproval],
    ["mcpWorkbenchNoSecondState", report.metrics?.mcpWorkbenchNoSecondState],
    ["extensionGalleryWorkbenchSurfaceVisible", report.metrics?.extensionGalleryWorkbenchSurfaceVisible],
    ["extensionGalleryWorkbenchShellVisible", report.metrics?.extensionGalleryWorkbenchShellVisible],
    ["extensionGalleryWorkbenchSearchVisible", report.metrics?.extensionGalleryWorkbenchSearchVisible],
    ["extensionGalleryWorkbenchInstalledVisible", report.metrics?.extensionGalleryWorkbenchInstalledVisible],
    ["extensionGalleryWorkbenchResultsVisible", report.metrics?.extensionGalleryWorkbenchResultsVisible],
    ["extensionGalleryWorkbenchDetailVisible", report.metrics?.extensionGalleryWorkbenchDetailVisible],
    ["extensionGalleryWorkbenchContainerId", report.metrics?.extensionGalleryWorkbenchContainerId],
    ["extensionGalleryWorkbenchViewId", report.metrics?.extensionGalleryWorkbenchViewId],
    ["extensionGalleryWorkbenchServiceId", report.metrics?.extensionGalleryWorkbenchServiceId],
    ["extensionGalleryWorkbenchStateSource", report.metrics?.extensionGalleryWorkbenchStateSource],
    ["extensionGalleryWorkbenchViewIds", Array.isArray(report.metrics?.extensionGalleryWorkbenchViewIds) ? report.metrics.extensionGalleryWorkbenchViewIds.join(", ") : ""],
    ["extensionGalleryWorkbenchCommandIds", Array.isArray(report.metrics?.extensionGalleryWorkbenchCommandIds) ? report.metrics.extensionGalleryWorkbenchCommandIds.join(", ") : ""],
    ["extensionGalleryWorkbenchQuickAccessPrefix", report.metrics?.extensionGalleryWorkbenchQuickAccessPrefix],
    ["extensionGalleryWorkbenchLastQuery", report.metrics?.extensionGalleryWorkbenchLastQuery],
    ["extensionGalleryWorkbenchResultCount", report.metrics?.extensionGalleryWorkbenchResultCount],
    ["extensionGalleryWorkbenchInstalledCount", report.metrics?.extensionGalleryWorkbenchInstalledCount],
    ["extensionGalleryWorkbenchEditorCount", report.metrics?.extensionGalleryWorkbenchEditorCount],
    ["extensionGalleryWorkbenchOpenedExtensionIds", Array.isArray(report.metrics?.extensionGalleryWorkbenchOpenedExtensionIds) ? report.metrics.extensionGalleryWorkbenchOpenedExtensionIds.join(", ") : ""],
    ["extensionGalleryWorkbenchLatestEditorId", report.metrics?.extensionGalleryWorkbenchLatestEditorId],
    ["extensionGalleryWorkbenchActionStateCount", report.metrics?.extensionGalleryWorkbenchActionStateCount],
    ["extensionGalleryWorkbenchErrorActionCount", report.metrics?.extensionGalleryWorkbenchErrorActionCount],
    ["extensionGalleryWorkbenchProgressCount", report.metrics?.extensionGalleryWorkbenchProgressCount],
    ["extensionGalleryWorkbenchLatestProgressPhase", report.metrics?.extensionGalleryWorkbenchLatestProgressPhase],
    ["extensionGalleryWorkbenchLocalFirst", report.metrics?.extensionGalleryWorkbenchLocalFirst],
    ["extensionGalleryWorkbenchNoSecondState", report.metrics?.extensionGalleryWorkbenchNoSecondState],
    ["extensionGalleryWorkbenchResultRows", report.metrics?.extensionGalleryWorkbenchResultRows],
    ["extensionGalleryWorkbenchInstalledRows", report.metrics?.extensionGalleryWorkbenchInstalledRows],
    ["extensionGalleryWorkbenchDetailAttempted", report.metrics?.extensionGalleryWorkbenchDetailAttempted],
    ["extensionGalleryWorkbenchDetailOpened", report.metrics?.extensionGalleryWorkbenchDetailOpened],
    ["extensionGalleryWorkbenchDetailOpenExtensionId", report.metrics?.extensionGalleryWorkbenchDetailOpenExtensionId],
    ["extensionGalleryWorkbenchDetailOpenError", report.metrics?.extensionGalleryWorkbenchDetailOpenError],
    ["extensionGalleryWorkbenchDetailExtensionId", report.metrics?.extensionGalleryWorkbenchDetailExtensionId],
    ["extensionGalleryWorkbenchDetailInstallState", report.metrics?.extensionGalleryWorkbenchDetailInstallState],
    ["extensionGalleryWorkbenchDetailActionIds", Array.isArray(report.metrics?.extensionGalleryWorkbenchDetailActionIds) ? report.metrics.extensionGalleryWorkbenchDetailActionIds.join(", ") : ""],
    ["extensionGalleryWorkbenchDetailRollbackAvailable", report.metrics?.extensionGalleryWorkbenchDetailRollbackAvailable],
    ["extensionGalleryWorkbenchDetailServiceId", report.metrics?.extensionGalleryWorkbenchDetailServiceId],
    ["extensionGalleryWorkbenchDetailStateSource", report.metrics?.extensionGalleryWorkbenchDetailStateSource],
    ["extensionTrustRemoteAuthWorkbenchSurfaceVisible", report.metrics?.extensionTrustRemoteAuthWorkbenchSurfaceVisible],
    ["extensionTrustRemoteAuthWorkbenchContainerId", report.metrics?.extensionTrustRemoteAuthWorkbenchContainerId],
    ["extensionTrustRemoteAuthWorkbenchViewIds", Array.isArray(report.metrics?.extensionTrustRemoteAuthWorkbenchViewIds) ? report.metrics.extensionTrustRemoteAuthWorkbenchViewIds.join(", ") : ""],
    ["extensionTrustRemoteAuthWorkbenchCommandIds", Array.isArray(report.metrics?.extensionTrustRemoteAuthWorkbenchCommandIds) ? report.metrics.extensionTrustRemoteAuthWorkbenchCommandIds.join(", ") : ""],
    ["extensionTrustRemoteAuthWorkbenchExtensionHostServiceId", report.metrics?.extensionTrustRemoteAuthWorkbenchExtensionHostServiceId],
    ["extensionTrustRemoteAuthWorkbenchWorkspaceTrustServiceId", report.metrics?.extensionTrustRemoteAuthWorkbenchWorkspaceTrustServiceId],
    ["extensionTrustRemoteAuthWorkbenchRemoteAuthorityServiceId", report.metrics?.extensionTrustRemoteAuthWorkbenchRemoteAuthorityServiceId],
    ["extensionTrustRemoteAuthWorkbenchAuthenticationServiceId", report.metrics?.extensionTrustRemoteAuthWorkbenchAuthenticationServiceId],
    ["extensionTrustRemoteAuthWorkbenchExtensionHostStateSource", report.metrics?.extensionTrustRemoteAuthWorkbenchExtensionHostStateSource],
    ["extensionTrustRemoteAuthWorkbenchWorkspaceTrustStateSource", report.metrics?.extensionTrustRemoteAuthWorkbenchWorkspaceTrustStateSource],
    ["extensionTrustRemoteAuthWorkbenchRemoteAuthorityStateSource", report.metrics?.extensionTrustRemoteAuthWorkbenchRemoteAuthorityStateSource],
    ["extensionTrustRemoteAuthWorkbenchAuthenticationStateSource", report.metrics?.extensionTrustRemoteAuthWorkbenchAuthenticationStateSource],
    ["extensionHostWorkbenchActivationCount", report.metrics?.extensionHostWorkbenchActivationCount],
    ["extensionHostWorkbenchLatestActivationEvent", report.metrics?.extensionHostWorkbenchLatestActivationEvent],
    ["extensionHostWorkbenchLatestActivationExtension", report.metrics?.extensionHostWorkbenchLatestActivationExtension],
    ["workspaceTrustWorkbenchStatus", report.metrics?.workspaceTrustWorkbenchStatus],
    ["workspaceTrustWorkbenchDecisionCount", report.metrics?.workspaceTrustWorkbenchDecisionCount],
    ["workspaceTrustWorkbenchLatestDecision", report.metrics?.workspaceTrustWorkbenchLatestDecision],
    ["remoteAuthorityWorkbenchResolveCount", report.metrics?.remoteAuthorityWorkbenchResolveCount],
    ["remoteAuthorityWorkbenchSuccessCount", report.metrics?.remoteAuthorityWorkbenchSuccessCount],
    ["remoteAuthorityWorkbenchFailureCount", report.metrics?.remoteAuthorityWorkbenchFailureCount],
    ["remoteAuthorityWorkbenchCacheHitCount", report.metrics?.remoteAuthorityWorkbenchCacheHitCount],
    ["remoteAuthorityWorkbenchLatestStatus", report.metrics?.remoteAuthorityWorkbenchLatestStatus],
    ["authenticationWorkbenchStatuses", Array.isArray(report.metrics?.authenticationWorkbenchStatuses) ? report.metrics.authenticationWorkbenchStatuses.join(", ") : ""],
    ["authenticationWorkbenchLatestStatus", report.metrics?.authenticationWorkbenchLatestStatus],
    ["authenticationWorkbenchProviderIds", Array.isArray(report.metrics?.authenticationWorkbenchProviderIds) ? report.metrics.authenticationWorkbenchProviderIds.join(", ") : ""],
    ["authenticationWorkbenchTokenRedacted", report.metrics?.authenticationWorkbenchTokenRedacted],
    ["extensionTrustRemoteAuthWorkbenchNoSecondExtensionRuntime", report.metrics?.extensionTrustRemoteAuthWorkbenchNoSecondExtensionRuntime],
    ["extensionTrustRemoteAuthWorkbenchNoSecondTrustStore", report.metrics?.extensionTrustRemoteAuthWorkbenchNoSecondTrustStore],
    ["extensionTrustRemoteAuthWorkbenchNoSecondRemoteState", report.metrics?.extensionTrustRemoteAuthWorkbenchNoSecondRemoteState],
    ["extensionTrustRemoteAuthWorkbenchNoSecondAuthStore", report.metrics?.extensionTrustRemoteAuthWorkbenchNoSecondAuthStore],
    ["extensionTrustRemoteAuthWorkbenchPreservesAgentEvidence", report.metrics?.extensionTrustRemoteAuthWorkbenchPreservesAgentEvidence],
    ["extensionTrustRemoteAuthWorkbenchSeeded", report.metrics?.extensionTrustRemoteAuthWorkbenchSeeded],
    ["extensionTrustRemoteAuthWorkbenchSeedError", report.metrics?.extensionTrustRemoteAuthWorkbenchSeedError],
    ["terminalDebugTaskWorkbenchServiceBoundary", report.metrics?.terminalDebugTaskWorkbenchServiceBoundary],
    ["terminalDebugTaskWorkbenchPanelBridge", report.metrics?.terminalDebugTaskWorkbenchPanelBridge],
    ["outputWorkbenchChannelEvidence", report.metrics?.outputWorkbenchChannelEvidence],
    ["taskWorkbenchRunEvidence", report.metrics?.taskWorkbenchRunEvidence],
    ["taskWorkbenchPanelSurface", report.metrics?.taskWorkbenchPanelSurface],
    ["debugWorkbenchSessionEvidence", report.metrics?.debugWorkbenchSessionEvidence],
    ["terminalWorkbenchCommandEvidence", report.metrics?.terminalWorkbenchCommandEvidence],
    ["problemsWorkbenchReadOnlyBridge", report.metrics?.problemsWorkbenchReadOnlyBridge],
    ["terminalDebugTaskWorkbenchServiceId", report.metrics?.terminalDebugTaskWorkbenchServiceId],
    ["terminalDebugTaskWorkbenchVsCodeServiceIds", Array.isArray(report.metrics?.terminalDebugTaskWorkbenchVsCodeServiceIds) ? report.metrics.terminalDebugTaskWorkbenchVsCodeServiceIds.join(", ") : ""],
    ["terminalDebugTaskWorkbenchCommandIds", Array.isArray(report.metrics?.terminalDebugTaskWorkbenchCommandIds) ? report.metrics.terminalDebugTaskWorkbenchCommandIds.join(", ") : ""],
    ["terminalDebugTaskWorkbenchCommandsExecuted", Array.isArray(report.metrics?.terminalDebugTaskWorkbenchCommandsExecuted) ? report.metrics.terminalDebugTaskWorkbenchCommandsExecuted.join(", ") : ""],
    ["terminalDebugTaskWorkbenchCommandFailures", Array.isArray(report.metrics?.terminalDebugTaskWorkbenchCommandFailures) ? report.metrics.terminalDebugTaskWorkbenchCommandFailures.join(", ") : ""],
    ["terminalDebugTaskWorkbenchPanelId", report.metrics?.terminalDebugTaskWorkbenchPanelId],
    ["terminalDebugTaskWorkbenchPanelNodeId", report.metrics?.terminalDebugTaskWorkbenchPanelNodeId],
    ["terminalDebugTaskWorkbenchTerminalCount", report.metrics?.terminalDebugTaskWorkbenchTerminalCount],
    ["terminalDebugTaskWorkbenchOutputChannelName", report.metrics?.terminalDebugTaskWorkbenchOutputChannelName],
    ["terminalDebugTaskWorkbenchOutputEntryCount", report.metrics?.terminalDebugTaskWorkbenchOutputEntryCount],
    ["terminalDebugTaskWorkbenchDebugConsoleEntryCount", report.metrics?.terminalDebugTaskWorkbenchDebugConsoleEntryCount],
    ["terminalDebugTaskWorkbenchTaskLatestStatus", report.metrics?.terminalDebugTaskWorkbenchTaskLatestStatus],
    ["terminalDebugTaskWorkbenchTaskLatestSummary", report.metrics?.terminalDebugTaskWorkbenchTaskLatestSummary],
    ["terminalDebugTaskWorkbenchTaskPanelVisible", report.metrics?.terminalDebugTaskWorkbenchTaskPanelVisible],
    ["terminalDebugTaskWorkbenchTaskPanelViewId", report.metrics?.terminalDebugTaskWorkbenchTaskPanelViewId],
    ["terminalDebugTaskWorkbenchTaskPanelStateSource", report.metrics?.terminalDebugTaskWorkbenchTaskPanelStateSource],
    ["terminalDebugTaskWorkbenchTaskPanelRunConfigCount", report.metrics?.terminalDebugTaskWorkbenchTaskPanelRunConfigCount],
    ["terminalDebugTaskWorkbenchProblemsDiagnosticCount", report.metrics?.terminalDebugTaskWorkbenchProblemsDiagnosticCount],
    ["terminalDebugTaskWorkbenchPaneCompositeOpenCount", report.metrics?.terminalDebugTaskWorkbenchPaneCompositeOpenCount],
    ["terminalDebugTaskWorkbenchPaneCompositeToggleCount", report.metrics?.terminalDebugTaskWorkbenchPaneCompositeToggleCount],
    ["terminalDebugTaskWorkbenchProblemsVisible", report.metrics?.terminalDebugTaskWorkbenchProblemsVisible],
    ["workbenchEditorPartActiveEditor", report.metrics?.workbenchEditorPartActiveEditor],
    ["workbenchEditorPartEditorCount", report.metrics?.workbenchEditorPartEditorCount],
    ["workbenchEditorPartDirtyCount", report.metrics?.workbenchEditorPartDirtyCount],
    ["workbenchEditorPartPinnedCount", report.metrics?.workbenchEditorPartPinnedCount],
    ["workbenchEditorPartPreviewCount", report.metrics?.workbenchEditorPartPreviewCount],
    ["workbenchEditorPartOverflowCount", report.metrics?.workbenchEditorPartOverflowCount],
    ["workbenchEditorPartOverflow", report.metrics?.workbenchEditorPartOverflow],
    ["workbenchLayoutConsistent", report.metrics?.workbenchLayoutConsistent],
    ["workbenchLayoutServiceSizes", JSON.stringify(report.metrics?.workbenchLayoutServiceSizes || {})],
    ["workbenchLayoutVisibleNeighbors", JSON.stringify(report.metrics?.workbenchLayoutVisibleNeighbors || {})],
    ["workbenchLayoutFocusPartIds", Array.isArray(report.metrics?.workbenchLayoutFocusPartIds) ? report.metrics.workbenchLayoutFocusPartIds.join(", ") : ""],
    ["workbenchLayoutFocusVisibleParts", report.metrics?.workbenchLayoutFocusVisibleParts],
    ["workbenchLayoutRestoreMatches", report.metrics?.workbenchLayoutRestoreMatches],
    ["workbenchLayoutRestore", JSON.stringify(report.metrics?.workbenchLayoutRestore || {})],
    ["workbenchPanelId", report.metrics?.workbenchPanelId],
    ["workbenchPanelHeight", report.metrics?.workbenchPanelHeight],
    ["workbenchStatusBarVisible", report.metrics?.workbenchStatusBarVisible],
    ["workbenchStatusActiveViewId", report.metrics?.workbenchStatusActiveViewId],
    ["workbenchStatusActivePanelId", report.metrics?.workbenchStatusActivePanelId],
    ["workbenchStatusLanguageId", report.metrics?.workbenchStatusLanguageId],
    ["workbenchStatusLine", report.metrics?.workbenchStatusLine],
    ["workbenchStatusColumn", report.metrics?.workbenchStatusColumn],
    ["workbenchStatusBranch", report.metrics?.workbenchStatusBranch],
    ["workbenchStatusErrorCount", report.metrics?.workbenchStatusErrorCount],
    ["workbenchStatusWarningCount", report.metrics?.workbenchStatusWarningCount],
    ["workbenchStatusEncoding", report.metrics?.workbenchStatusEncoding],
    ["workbenchStatusEol", report.metrics?.workbenchStatusEol],
    ["workbenchCommandSurfaceVisible", report.metrics?.workbenchCommandSurfaceVisible],
    ["workbenchCommandSurfaceCommandCount", report.metrics?.workbenchCommandSurfaceCommandCount],
    ["workbenchCommandSurfaceCommandIds", Array.isArray(report.metrics?.workbenchCommandSurfaceCommandIds) ? report.metrics.workbenchCommandSurfaceCommandIds.join(", ") : ""],
    ["workbenchCommandSurfaceMenuIds", Array.isArray(report.metrics?.workbenchCommandSurfaceMenuIds) ? report.metrics.workbenchCommandSurfaceMenuIds.join(", ") : ""],
    ["workbenchCommandSurfaceMenuEntryCount", report.metrics?.workbenchCommandSurfaceMenuEntryCount],
    ["workbenchCommandPaletteCommandCount", report.metrics?.workbenchCommandPaletteCommandCount],
    ["workbenchCommandPaletteCommandIds", Array.isArray(report.metrics?.workbenchCommandPaletteCommandIds) ? report.metrics.workbenchCommandPaletteCommandIds.join(", ") : ""],
    ["chatComposerCompact", report.metrics?.chatComposerCompact],
    ["chatComposerNotWhiteBox", report.metrics?.chatComposerNotWhiteBox],
    ["chatComposerRect", JSON.stringify(report.metrics?.chatComposerRect || {})],
    ["chatComposerColors", JSON.stringify(report.metrics?.chatComposerColors || {})],
    ["createTargetDir", report.metrics?.createTargetDir],
    ["continuousCreateCount", report.metrics?.continuousCreateCount],
    ["staleSnapshotRejected", report.metrics?.staleSnapshotRejected],
    ["readDirCallCount", report.metrics?.readDirCallCount],
    ["uniqueReadDirCallCount", report.metrics?.uniqueReadDirCallCount],
  ]
    .map(([name, value]) => `| ${name} | ${String(value ?? "").replace(/\|/g, "\\|")} |`)
    .join("\n")

  return [
    "# Workbench Real Project UI Smoke Evidence",
    "",
    `- Created: ${report.createdAt}`,
    `- Status: ${report.status}`,
    `- Project root: ${normalizeSmokePathForMarkdown(report.projectRoot)}`,
    `- Screenshot: ${normalizeSmokePathForMarkdown(report.screenshotPath || report.screenshotEvidence?.reason || "")}`,
    `- Latest screenshot: ${normalizeSmokePathForMarkdown(report.latestScreenshotPath || report.screenshotEvidence?.reason || "")}`,
    `- Latest JSON: ${normalizeSmokePathForMarkdown(report.latestJsonPath || report.jsonPath || "")}`,
    `- Latest Markdown: ${normalizeSmokePathForMarkdown(report.latestMarkdownPath || report.markdownPath || "")}`,
    "",
    "## Acceptance",
    "",
    "| Check | Status |",
    "| --- | --- |",
    acceptanceRows,
    "",
    "## Gate Attribution",
    "",
    "| Stage | Owner | Status | Checks | Failed checks | Evidence fields | Report paths | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    gateAttributionRows,
    "",
    "## Manual Acceptance Contract",
    "",
    `- Status: ${report.manualAcceptanceContract?.status || "manual-required"}`,
    `- Automated ready: ${report.manualAcceptanceContract?.automatedReady === true ? "true" : "false"}`,
    `- Manual ready: ${report.manualAcceptanceContract?.manualReady === true ? "true" : "false"}`,
    `- Manual JSON: ${report.manualAcceptanceContract?.manualEvidenceJsonPath || ".codek/reports/manual-real-ui-evidence-latest.json"}`,
    `- Manual Markdown: ${report.manualAcceptanceContract?.manualEvidenceMarkdownPath || ".codek/reports/manual-real-ui-evidence-latest.md"}`,
    `- Manual template: ${report.manualAcceptanceContract?.manualEvidenceTemplatePath || ".codek/reports/manual-real-ui/manual-real-ui-evidence-template.json"}`,
    "",
    "| Stage | Automated status | Manual status | Failure owner | Manual evidence | Replay steps | Cursor parity checklist | Automated report paths |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    manualAcceptanceContractRows,
    "",
    "## Metrics",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    metricRows,
    "",
  ].join("\n")
}

function buildSearchNavigationSmokeAcceptance(result) {
  return {
    opensRealEditorContent: Boolean(result?.openedContentVisible),
    keepsEditorNonBlank: !result?.blankEditor,
    revealsExactMatchSelection: Boolean(result?.selectionChanged),
    keepsSearchViewActive: Boolean(result?.searchViewActive),
    clicksTwentyRealResults: Number(result?.clickedCount || 0) >= 20,
    everyClickedEditorNonBlank: Boolean(result?.allClicksNonBlank),
    everyClickedSelectionAccurate: Boolean(result?.allSelectionsAccurate),
    coversSameFileAndCrossFileNavigation: Boolean(result?.sameFileMultiLineClicked)
      && Number(result?.distinctPathsClicked || 0) >= 2,
    keepsSearchViewActiveForEveryClick: Boolean(result?.allClicksKeptSearchView),
    jsonSearchOpensNonBlankEditor: Boolean(result?.jsonSearchOpenedContentVisible)
      && !result?.jsonSearchBlankEditor,
    jsonSearchSelectionAccurate: Boolean(result?.jsonSearchSelectionAccurate),
  }
}

function renderSearchNavigationSmokeMarkdown(report) {
  const acceptanceRows = Object.entries(report.acceptance || {})
    .map(([name, passed]) => `| ${name} | ${toSmokeCheckStatus(passed)} |`)
    .join("\n")
  const metricRows = [
    ["projectRoot", report.projectRoot],
    ["totalMatches", report.metrics?.totalMatches],
    ["clickedCount", report.metrics?.clickedCount],
    ["nonBlankClickCount", report.metrics?.nonBlankClickCount],
    ["selectionAccurateCount", report.metrics?.selectionAccurateCount],
    ["distinctPathsClicked", report.metrics?.distinctPathsClicked],
    ["sameFileMultiLineClicked", report.metrics?.sameFileMultiLineClicked],
    ["allClicksNonBlank", report.metrics?.allClicksNonBlank],
    ["allSelectionsAccurate", report.metrics?.allSelectionsAccurate],
    ["allClicksKeptSearchView", report.metrics?.allClicksKeptSearchView],
    ["jsonSearchQuery", report.metrics?.jsonSearchQuery],
    ["jsonSearchMatchPath", report.metrics?.jsonSearchMatchPath],
    ["jsonSearchMatchLine", report.metrics?.jsonSearchMatchLine],
    ["jsonSearchOpenedContentVisible", report.metrics?.jsonSearchOpenedContentVisible],
    ["jsonSearchBlankEditor", report.metrics?.jsonSearchBlankEditor],
    ["jsonSearchSelectionAccurate", report.metrics?.jsonSearchSelectionAccurate],
  ]
    .map(([name, value]) => `| ${name} | ${String(value ?? "").replace(/\|/g, "\\|")} |`)
    .join("\n")

  return [
    "# Workbench Search Navigation Smoke Evidence",
    "",
    `- Created: ${report.createdAt}`,
    `- Status: ${report.status}`,
    `- Project root: ${normalizeSmokePathForMarkdown(report.projectRoot)}`,
    `- Latest JSON: ${normalizeSmokePathForMarkdown(report.latestJsonPath || report.jsonPath || "")}`,
    `- Latest Markdown: ${normalizeSmokePathForMarkdown(report.latestMarkdownPath || report.markdownPath || "")}`,
    "",
    "## Acceptance",
    "",
    "| Check | Status |",
    "| --- | --- |",
    acceptanceRows,
    "",
    "## Metrics",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    metricRows,
    "",
  ].join("\n")
}

function writeSearchNavigationSmokeEvidence(result) {
  if (!isSmoke || !isSearchNavigationSmoke) return result
  const reportsDir = path.join(CODEK_DATA, "reports")
  const createdAt = new Date().toISOString()
  const stamp = sanitizeSmokeTimestamp(createdAt)
  const jsonPath = path.join(reportsDir, `workbench-search-navigation-${stamp}.json`)
  const markdownPath = path.join(reportsDir, `workbench-search-navigation-${stamp}.md`)
  const latestJsonPath = path.join(reportsDir, "workbench-search-navigation-latest.json")
  const latestMarkdownPath = path.join(reportsDir, "workbench-search-navigation-latest.md")
  fs.mkdirSync(reportsDir, { recursive: true })
  const acceptance = buildSearchNavigationSmokeAcceptance(result)
  const ready = Object.values(acceptance).every(Boolean)
  const report = {
    reportKind: "workbench-search-navigation-smoke-evidence",
    createdAt,
    ready,
    status: ready ? "ready" : "not-ready",
    projectRoot: result?.projectRoot || "",
    metrics: result,
    acceptance,
  }
  const reportWithPaths = { ...report, jsonPath, markdownPath, latestJsonPath, latestMarkdownPath }
  const markdown = renderSearchNavigationSmokeMarkdown(reportWithPaths)
  fs.writeFileSync(jsonPath, `${JSON.stringify(reportWithPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(reportWithPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(markdownPath, markdown, "utf8")
  fs.writeFileSync(latestMarkdownPath, markdown, "utf8")
  return {
    ...result,
    evidence: {
      reportKind: report.reportKind,
      createdAt,
      ready,
      status: report.status,
      jsonPath,
      markdownPath,
      latestJsonPath,
      latestMarkdownPath,
    },
    evidenceJsonExists: fs.existsSync(jsonPath) && fs.existsSync(latestJsonPath),
    evidenceMarkdownExists: fs.existsSync(markdownPath) && fs.existsSync(latestMarkdownPath),
  }
}

function buildSearchReplaceSmokeAcceptance(result) {
  const afterOne = String(result?.afterReplaceOne || "")
  const finalRepeated = String(result?.finalRepeatedDisk || result?.finalRepeated || "")
  const finalOther = String(result?.finalOtherDisk || result?.finalOther || "")
  const previewSummary = result?.previewSummary || {}
  const replaceOneSummary = result?.replaceOneSummary || {}
  const replaceAllSummary = result?.replaceAllSummary || {}
  const changedFiles = Array.isArray(result?.bulkEditChangedFiles) ? result.bulkEditChangedFiles : []
  const refreshEvidence = result?.searchRefreshEvidence || {}
  return {
    keepsSearchViewActive: Boolean(result?.searchViewActive),
    findsMultipleFileGroups: Number(result?.initialGroupCount || 0) >= 2,
    preservesCollapsedOccurrenceMetadata: Number(result?.collapsedOccurrenceCount || 0) >= 2,
    previewsThroughDryRunWithoutWritingDisk: result?.previewDryRun === true
      && result?.previewApplied !== true
      && result?.previewDidNotWriteDisk === true,
    previewReportsBulkEditSummary: Number(previewSummary.changedFileCount || 0) >= 2
      && Number(previewSummary.editCount || 0) >= 2,
    replaceOneUsesBulkEditService: result?.replaceOneApplied === true
      && Number(replaceOneSummary.changedFileCount || 0) === 1
      && Number(replaceOneSummary.editCount || 0) === 1,
    replaceOneOnlyChangesFirstSameLineOccurrence: afterOne.includes("haystack needle")
      && !afterOne.includes("haystack haystack"),
    replaceAllUsesBulkEditService: result?.replaceAllApplied === true
      && Number(replaceAllSummary.changedFileCount || 0) >= 2
      && Number(replaceAllSummary.editCount || 0) >= 2,
    replaceAllUpdatesRepeatedFileOnDisk: finalRepeated.includes("haystack haystack")
      && !finalRepeated.includes("needle"),
    replaceAllUpdatesUnopenedFileOnDisk: finalOther.includes("haystack")
      && !finalOther.includes("needle"),
    clearsRemainingSearchMatches: Number(result?.remainingNeedleGroups || 0) === 0,
    recordsChangedFilesAndRollbackRisk: Boolean(result?.bulkEditAppliedViaService)
      && changedFiles.includes("src/000-repeated.ts")
      && changedFiles.includes("src/100-other.ts")
      && typeof result?.rollbackRisk?.replaceAllDescription === "string"
      && result.rollbackRisk.replaceAllDescription.length > 0,
    refreshesSearchAfterFileServiceWatcher: refreshEvidence.watcherRefreshStable === true
      && Number(refreshEvidence.afterReplaceAllGroupCount || 0) === 0
      && Number(refreshEvidence.afterReplaceAllMatchCount || 0) === 0
      && refreshEvidence.changedFilesStillVisibleAfterReplaceAll === false
      && refreshEvidence.searchBusy === false,
  }
}

function renderSearchReplaceSmokeMarkdown(report) {
  const acceptanceRows = Object.entries(report.acceptance || {})
    .map(([name, passed]) => `| ${name} | ${toSmokeCheckStatus(passed)} |`)
    .join("\n")
  const metricRows = [
    ["projectRoot", report.projectRoot],
    ["initialGroupCount", report.metrics?.initialGroupCount],
    ["collapsedOccurrenceCount", report.metrics?.collapsedOccurrenceCount],
    ["previewDryRun", report.metrics?.previewDryRun],
    ["previewDidNotWriteDisk", report.metrics?.previewDidNotWriteDisk],
    ["previewChangedFileCount", report.metrics?.previewSummary?.changedFileCount],
    ["previewEditCount", report.metrics?.previewSummary?.editCount],
    ["replaceOneApplied", report.metrics?.replaceOneApplied],
    ["replaceOneChangedFileCount", report.metrics?.replaceOneSummary?.changedFileCount],
    ["replaceOneEditCount", report.metrics?.replaceOneSummary?.editCount],
    ["replaceAllApplied", report.metrics?.replaceAllApplied],
    ["replaceAllChangedFileCount", report.metrics?.replaceAllSummary?.changedFileCount],
    ["replaceAllEditCount", report.metrics?.replaceAllSummary?.editCount],
    ["bulkEditAppliedViaService", report.metrics?.bulkEditAppliedViaService],
    ["bulkEditChangedFiles", JSON.stringify(report.metrics?.bulkEditChangedFiles || [])],
    ["rollbackRisk", JSON.stringify(report.metrics?.rollbackRisk || {})],
    ["searchRefreshEvidence", JSON.stringify(report.metrics?.searchRefreshEvidence || {})],
    ["refreshAfterReplaceAllGroupCount", report.metrics?.searchRefreshEvidence?.afterReplaceAllGroupCount],
    ["refreshAfterReplaceAllMatchCount", report.metrics?.searchRefreshEvidence?.afterReplaceAllMatchCount],
    ["watcherRefreshStable", report.metrics?.searchRefreshEvidence?.watcherRefreshStable],
    ["remainingNeedleGroups", report.metrics?.remainingNeedleGroups],
  ]
    .map(([name, value]) => `| ${name} | ${String(value ?? "").replace(/\|/g, "\\|")} |`)
    .join("\n")

  return [
    "# Workbench Search Replace Smoke Evidence",
    "",
    `- Created: ${report.createdAt}`,
    `- Status: ${report.status}`,
    `- Project root: ${normalizeSmokePathForMarkdown(report.projectRoot)}`,
    "",
    "## Acceptance",
    "",
    "| Check | Status |",
    "| --- | --- |",
    acceptanceRows,
    "",
    "## Metrics",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    metricRows,
    "",
  ].join("\n")
}

function writeSearchReplaceSmokeEvidence(result) {
  if (!isSmoke || !isSearchReplaceSmoke) return result
  const reportsDir = path.join(CODEK_DATA, "reports")
  const createdAt = new Date().toISOString()
  const stamp = sanitizeSmokeTimestamp(createdAt)
  const jsonPath = path.join(reportsDir, `workbench-search-replace-${stamp}.json`)
  const markdownPath = path.join(reportsDir, `workbench-search-replace-${stamp}.md`)
  const latestJsonPath = path.join(reportsDir, "workbench-search-replace-latest.json")
  const latestMarkdownPath = path.join(reportsDir, "workbench-search-replace-latest.md")
  fs.mkdirSync(reportsDir, { recursive: true })
  const acceptance = buildSearchReplaceSmokeAcceptance(result)
  const ready = Object.values(acceptance).every(Boolean)
  const report = {
    reportKind: "workbench-search-replace-smoke-evidence",
    createdAt,
    ready,
    status: ready ? "ready" : "not-ready",
    projectRoot: result?.projectRoot || "",
    metrics: result,
    acceptance,
  }
  const reportWithPaths = { ...report, jsonPath, markdownPath, latestJsonPath, latestMarkdownPath }
  const markdown = renderSearchReplaceSmokeMarkdown(reportWithPaths)
  fs.writeFileSync(jsonPath, `${JSON.stringify(reportWithPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(reportWithPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(markdownPath, markdown, "utf8")
  fs.writeFileSync(latestMarkdownPath, markdown, "utf8")
  return {
    ...result,
    evidence: {
      reportKind: report.reportKind,
      createdAt,
      ready,
      status: report.status,
      jsonPath,
      markdownPath,
      latestJsonPath,
      latestMarkdownPath,
    },
    evidenceJsonExists: fs.existsSync(jsonPath) && fs.existsSync(latestJsonPath),
    evidenceMarkdownExists: fs.existsSync(markdownPath) && fs.existsSync(latestMarkdownPath),
  }
}

function buildWorkingCopyHotExitSmokeAcceptance(result) {
  const backupArtifactPaths = Array.isArray(result?.backupArtifactPaths) ? result.backupArtifactPaths : []
  const backupCleanupDiagnostics = collectWorkingCopyBackupCleanupDiagnostics(result)
  const nativeConfirmEvidence = result?.nativeConfirmLifecycle?.rendererLifecycle?.evidence
    || result?.nativeConfirmLifecycle?.evidence
    || result?.nativeConfirmLifecycle?.decision?.evidence
  const nativeConfirmBackupJoin = result?.nativeConfirmLifecycle?.decision?.backupJoin
    || nativeConfirmEvidence?.backupJoin
  const backedUp = [
    ...(Array.isArray(result?.backedUp) ? result.backedUp : []),
    ...(Array.isArray(result?.nativeCancelLifecycle?.backedUp) ? result.nativeCancelLifecycle.backedUp : []),
  ]
  return {
    opensExpectedProject: Boolean(result?.projectRoot),
    createsDirtyWorkingCopyEvidence: result?.dirtyEvidence?.dirtyCount === 1
      && result?.dirtyEvidence?.risk === "dirty-working-copy",
    nativeDirtyCloseVetoesAndKeepsDirty: result?.nativeCancelAllowed === false
      && result?.nativeCancelLifecycle?.decision === "cancel"
      && result?.nativeCancelLifecycle?.dirtyCount === 1
      && result?.nativeCancelLifecycle?.allowed === false,
    nativeConfirmAllowsCloseLifecycle: result?.nativeConfirmLifecycle?.decision?.decision === "confirm"
      && result?.nativeConfirmLifecycle?.decision?.allowed === true
      && result?.nativeConfirmLifecycle?.decision?.forceClose === true
      && nativeConfirmEvidence?.phase === "backupJoin"
      && nativeConfirmBackupJoin?.completed === true,
    nativeForceAllowsCloseLifecycle: result?.nativeForceLifecycle?.decision?.decision === "force"
      && result?.nativeForceLifecycle?.decision?.allowed === true
      && result?.nativeForceLifecycle?.decision?.forced === true,
    guardsDirtyCloseByDefault: result?.closeGuardAllowed === false
      && result?.closeGuardEvidence?.phase === "closeGuard"
      && result?.closeGuardEvidence?.cancelled === true
      && result?.closeGuardEvidence?.risk === "dirty-working-copy",
    writesBackupArtifactPath: backedUp.includes(result?.targetPath)
      && backupArtifactPaths.length > 0,
    restoresBackupAsDirtyWorkingCopy: result?.restoreApplied === true
      && result?.restoreAttemptEvidence?.phase === "restoreAttempt"
      && Array.isArray(result?.restoreAttemptEvidence?.restored)
      && result.restoreAttemptEvidence.restored.includes(result?.targetPath)
      && result?.restoredContentMatches === true
      && result?.dirtyAfterRestore === true
      && result?.restoreAttemptEvidence?.dirtyCount === 1,
    savesRestoredWorkingCopyToDisk: result?.saveSucceeded === true
      && result?.diskAfterSaveMatches === true
      && result?.dirtyAfterSave === false,
    revertsDirtyWorkingCopyFromDisk: result?.reloadReverted === true
      && result?.revertRestoredDiskContent === true
      && result?.dirtyAfterRevert === false,
    keepsEvidenceOnWorkspaceManager: result?.evidencePath === ".codek/reports/working-copy-hot-exit-latest-result.json",
    classifiesMissingBackupDiscardAsNonBlocking: backupCleanupDiagnostics.blocking.length === 0,
  }
}

function collectWorkingCopyBackupCleanupDiagnostics(result) {
  const cached = loadElectronSmokeResultCache(getElectronSmokeResultFile())
  const stages = [
    ...(Array.isArray(result?.stages) ? result.stages : []),
    ...(Array.isArray(cached.stages) ? cached.stages : []),
  ]
  const seen = new Set()
  const diagnostics = stages
    .filter((entry) => entry?.stage === "working-copy-backup:diagnostic" || entry?.stage === "working-copy-backup:error")
    .filter((entry) => {
      const key = JSON.stringify([entry.stage, entry.at || "", entry.detail || {}])
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((entry) => ({
      stage: entry.stage,
      operation: entry.detail?.operation || "",
      resource: entry.detail?.resource || null,
      severity: entry.detail?.severity || (entry.stage === "working-copy-backup:error" ? "error" : "nonBlocking"),
      reason: entry.detail?.reason || "",
      ignored: entry.detail?.ignored === true,
      nonBlocking: entry.detail?.nonBlocking === true || entry.detail?.severity === "nonBlocking",
      error: entry.detail?.error || "",
      at: entry.at || null,
    }))
  return {
    all: diagnostics,
    nonBlocking: diagnostics.filter((entry) => entry.nonBlocking && entry.reason === "backupMissing"),
    blocking: diagnostics.filter((entry) => !entry.nonBlocking),
  }
}

function renderWorkingCopyHotExitSmokeMarkdown(report) {
  const acceptanceRows = Object.entries(report.acceptance || {})
    .map(([name, passed]) => `| ${name} | ${toSmokeCheckStatus(passed)} |`)
    .join("\n")
  const metricRows = [
    ["projectRoot", report.projectRoot],
    ["targetPath", report.metrics?.targetPath],
    ["dirtyCount", report.metrics?.dirtyEvidence?.dirtyCount],
    ["shutdownRisk", report.metrics?.shutdownRisk],
    ["nativeCancelAllowed", report.metrics?.nativeCancelAllowed],
    ["nativeCancelDecision", report.metrics?.nativeCancelLifecycle?.decision],
    ["nativeCancelDirtyCount", report.metrics?.nativeCancelLifecycle?.dirtyCount],
    ["nativeConfirmDecision", report.metrics?.nativeConfirmLifecycle?.decision?.decision],
    ["nativeForceDecision", report.metrics?.nativeForceLifecycle?.decision?.decision],
    ["closeGuardAllowed", report.metrics?.closeGuardAllowed],
    ["closeGuardRisk", report.metrics?.closeGuardEvidence?.risk],
    ["backedUp", Array.isArray(report.metrics?.backedUp) ? report.metrics.backedUp.join(", ") : ""],
    ["backupArtifactPaths", Array.isArray(report.metrics?.backupArtifactPaths) ? report.metrics.backupArtifactPaths.join(", ") : ""],
    ["backupCleanupNonBlockingDiagnostics", Array.isArray(report.nonBlockingDiagnostics?.backupCleanup) ? report.nonBlockingDiagnostics.backupCleanup.length : ""],
    ["backupCleanupBlockingDiagnostics", Array.isArray(report.blockingDiagnostics?.backupCleanup) ? report.blockingDiagnostics.backupCleanup.length : ""],
    ["restoreApplied", report.metrics?.restoreApplied],
    ["restoreAttemptPhase", report.metrics?.restoreAttemptEvidence?.phase],
    ["restoredContentMatches", report.metrics?.restoredContentMatches],
    ["dirtyAfterRestore", report.metrics?.dirtyAfterRestore],
    ["saveSucceeded", report.metrics?.saveSucceeded],
    ["diskAfterSaveMatches", report.metrics?.diskAfterSaveMatches],
    ["dirtyAfterSave", report.metrics?.dirtyAfterSave],
    ["reloadReverted", report.metrics?.reloadReverted],
    ["revertRestoredDiskContent", report.metrics?.revertRestoredDiskContent],
    ["dirtyAfterRevert", report.metrics?.dirtyAfterRevert],
    ["evidencePath", report.metrics?.evidencePath],
  ]
    .map(([name, value]) => `| ${name} | ${String(value ?? "").replace(/\|/g, "\\|")} |`)
    .join("\n")

  return [
    "# Working Copy Hot Exit Smoke Evidence",
    "",
    `- Created: ${report.createdAt}`,
    `- Status: ${report.status}`,
    `- Project root: ${normalizeSmokePathForMarkdown(report.projectRoot)}`,
    "",
    "## Acceptance",
    "",
    "| Check | Status |",
    "| --- | --- |",
    acceptanceRows,
    "",
    "## Metrics",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    metricRows,
    "",
    "## Lifecycle Source",
    "",
    "- Electron `BrowserWindow.close` and renderer `beforeunload` are routed through the working-copy hot-exit state source before allowing or vetoing shutdown.",
    "",
  ].join("\n")
}

function writeWorkingCopyHotExitSmokeEvidence(result) {
  if (!isSmoke || !isWorkingCopyHotExitSmoke) return result
  const reportsDir = path.join(CODEK_DATA, "reports")
  const createdAt = new Date().toISOString()
  const stamp = sanitizeSmokeTimestamp(createdAt)
  const jsonPath = path.join(reportsDir, `electron-smoke-working-copy-hot-exit-${stamp}.json`)
  const markdownPath = path.join(reportsDir, `electron-smoke-working-copy-hot-exit-${stamp}.md`)
  const latestJsonPath = path.join(reportsDir, "electron-smoke-working-copy-hot-exit-latest-result.json")
  const latestMarkdownPath = path.join(reportsDir, "electron-smoke-working-copy-hot-exit-latest-result.md")
  fs.mkdirSync(reportsDir, { recursive: true })
  const acceptance = buildWorkingCopyHotExitSmokeAcceptance(result)
  const backupCleanupDiagnostics = collectWorkingCopyBackupCleanupDiagnostics(result)
  const ready = Object.values(acceptance).every(Boolean)
  const report = {
    reportKind: "working-copy-hot-exit-smoke-evidence",
    createdAt,
    ready,
    status: ready ? "ready" : "not-ready",
    projectRoot: result?.projectRoot || "",
    metrics: result,
    acceptance,
    nonBlockingDiagnostics: {
      backupCleanup: backupCleanupDiagnostics.nonBlocking,
    },
    blockingDiagnostics: {
      backupCleanup: backupCleanupDiagnostics.blocking,
    },
    knownGaps: [],
  }
  const reportWithPaths = { ...report, jsonPath, markdownPath, latestJsonPath, latestMarkdownPath }
  const markdown = renderWorkingCopyHotExitSmokeMarkdown(reportWithPaths)
  fs.writeFileSync(jsonPath, `${JSON.stringify(reportWithPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(reportWithPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(markdownPath, markdown, "utf8")
  fs.writeFileSync(latestMarkdownPath, markdown, "utf8")
  return {
    ...result,
    evidenceReport: reportWithPaths,
    evidence: {
      reportKind: report.reportKind,
      createdAt,
      ready,
      status: report.status,
      jsonPath,
      markdownPath,
      latestJsonPath,
      latestMarkdownPath,
      knownGaps: report.knownGaps,
    },
    evidenceJsonExists: fs.existsSync(jsonPath) && fs.existsSync(latestJsonPath),
    evidenceMarkdownExists: fs.existsSync(markdownPath) && fs.existsSync(latestMarkdownPath),
  }
}

function buildArtifactOpenSmokeAcceptance(result) {
  return {
    opensExpectedProject: Boolean(result?.projectRoot),
    blocksBinaryArtifacts: Boolean(result?.binaryArtifactsBlocked),
    keepsBinaryArtifactsOutOfTabs: Boolean(result?.binaryArtifactsNotOpened),
    keepsWorkbenchResponsiveAfterArtifacts: Boolean(result?.responsiveAfterArtifactClicks),
    opensSmallTextAfterArtifacts: Boolean(result?.textFilesOpened),
    keepsFinalEditorNonBlank: Boolean(result?.finalEditorNonBlank),
    keepsEditorDomVisible: Boolean(result?.editorDomVisible),
    keepsOpenOperationsWithinBudget: Boolean(result?.allOpenDurationsWithinBudget),
  }
}

function renderArtifactOpenSmokeMarkdown(report) {
  const acceptanceRows = Object.entries(report.acceptance || {})
    .map(([name, passed]) => `| ${name} | ${toSmokeCheckStatus(passed)} |`)
    .join("\n")
  const metricRows = [
    ["projectRoot", report.projectRoot],
    ["activeFile", report.metrics?.activeFile],
    ["binaryArtifactsBlocked", report.metrics?.binaryArtifactsBlocked],
    ["binaryArtifactsNotOpened", report.metrics?.binaryArtifactsNotOpened],
    ["textFilesOpened", report.metrics?.textFilesOpened],
    ["finalEditorNonBlank", report.metrics?.finalEditorNonBlank],
    ["editorDomVisible", report.metrics?.editorDomVisible],
    ["maxOpenDurationMs", report.metrics?.maxOpenDurationMs],
    ["openFileCount", Array.isArray(report.metrics?.openFiles) ? report.metrics.openFiles.length : 0],
  ]
    .map(([name, value]) => `| ${name} | ${String(value ?? "").replace(/\|/g, "\\|")} |`)
    .join("\n")

  return [
    "# Workbench Artifact Open Smoke Evidence",
    "",
    `- Created: ${report.createdAt}`,
    `- Status: ${report.status}`,
    `- Project root: ${normalizeSmokePathForMarkdown(report.projectRoot)}`,
    "",
    "## Acceptance",
    "",
    "| Check | Status |",
    "| --- | --- |",
    acceptanceRows,
    "",
    "## Metrics",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    metricRows,
    "",
  ].join("\n")
}

function getWorkbenchUiAuditOutputDir() {
  return path.resolve(process.env.CODEK_WORKBENCH_UI_AUDIT_OUT || path.join(__dirname, "..", "output", "playwright", "workbench-ui-refactor-20260704"))
}

function sanitizeWorkbenchUiAuditFilePart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "capture"
}

async function captureWorkbenchUiAuditShot(win, outDir, item) {
  const theme = item.theme || "dark"
  const view = item.view || "files"
  const viewport = item.viewport || "desktop"
  const name = sanitizeWorkbenchUiAuditFilePart(`${viewport}-${theme}-${view}`)
  const screenshotPath = path.join(outDir, `${name}.png`)
  const state = await win.webContents.executeJavaScript(`
    (async () => {
      const controls = window.__codekSmokeWorkbenchControls || {}
      const closeWorkbenchDetailSurfaces = async () => {
        const hadDetail = Boolean(document.querySelector('[data-codek-smoke="task-run-detail-modal"], .goal-result-modal'))
        for (const closeButton of Array.from(document.querySelectorAll('[data-codek-smoke="task-run-detail-modal"] .goal-result-close, .goal-result-modal .goal-result-close'))) {
          closeButton.click()
        }
        if (hadDetail) {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          await new Promise((resolve) => setTimeout(resolve, 80))
        }
      }
      await closeWorkbenchDetailSurfaces()
      if (typeof controls.setWorkbenchSmokeTheme === "function") {
        await controls.setWorkbenchSmokeTheme(${JSON.stringify(theme)})
      }
      if (typeof controls.openWorkbenchSmokeView === "function") {
        await controls.openWorkbenchSmokeView(${JSON.stringify(view)})
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await new Promise((resolve) => setTimeout(resolve, 180))
      let taskCenterDetailClicked = false
      let taskCenterDetailError = ""
      const waitUntil = (predicate, timeout = 5000) => new Promise((resolve) => {
        const started = Date.now()
        const tick = () => {
          try {
            const result = predicate()
            if (result) {
              resolve(result)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            resolve(null)
            return
          }
          setTimeout(tick, 100)
        }
        tick()
      })
      if (${JSON.stringify(view)} === "goals") {
        try {
          await waitUntil(() => document.querySelector('[data-codek-smoke="task-center-panel"]'), 4000)
          if (!document.querySelector('[data-codek-smoke="task-center-row"]') && window.codek?.api) {
            await window.codek.api("POST", "/api/orchestrator/tasks", {
              message: "UI 审计：验证任务中心查看详情",
              mode: "agent",
              projectRoot: ${JSON.stringify(path.resolve(__dirname, ".."))},
              files: [],
            }).catch(() => null)
            document.querySelector('.goal-panel-header button[title="刷新任务"]')?.click()
          }
          await waitUntil(() => document.querySelector('[data-codek-smoke="task-center-row"]'), 5000)
          const detailButton = document.querySelector('[data-codek-smoke="task-center-row"] button[title="查看详情"]')
            || document.querySelector('[data-codek-smoke="task-center-row"] .goal-main')
          if (detailButton) {
            detailButton.click()
            taskCenterDetailClicked = true
            await waitUntil(() => document.querySelector('[data-codek-smoke="task-run-detail-modal"], .goal-result-modal'), 5000)
            const detailScroller = document.querySelector('[data-codek-smoke="task-run-detail-modal"] .orchestrator-panel, .goal-result-modal')
            if (detailScroller) detailScroller.scrollTop = 0
          }
        } catch (error) {
          taskCenterDetailError = String(error?.message || error)
        }
      }
      if (${JSON.stringify(view)} === "marketplace") {
        await waitUntil(() => {
          const surface = document.querySelector('[data-codek-smoke="extension-gallery-workbench-surface"]')
          const installed = document.querySelector('[data-codek-smoke="extension-gallery-installed"]')
          const results = document.querySelector('[data-codek-smoke="extension-gallery-search-results"]')
          const text = String(surface?.textContent || "")
          return surface && installed && results && !/正在读取已安装扩展|正在搜索扩展|正在读取迁移扩展清单/.test(text)
        }, 10000)
      }
      const visible = (selector) => {
        const node = document.querySelector(selector)
        if (!node) return false
        const rect = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0
      }
      const rectSize = (selector) => {
        const node = document.querySelector(selector)
        if (!node) return { width: 0, height: 0 }
        const rect = node.getBoundingClientRect()
        return { width: Math.round(rect.width), height: Math.round(rect.height) }
      }
      const text = String(document.body?.innerText || "")
      const activityIds = Array.from(document.querySelectorAll(".activity-btn")).map((node) => node.getAttribute("data-workbench-container-id") || "")
      const titlebarText = String(document.querySelector(".menu-bar, .titlebar, [data-workbench-title-bar]")?.textContent || "")
      return {
        theme: document.documentElement.classList.contains("theme-light") ? "light" : "dark",
        view: ${JSON.stringify(view)},
        viewport: ${JSON.stringify(viewport)},
        activeView: controls.getWorkbenchSmokeState?.().activeView || "",
        href: location.href,
        width: window.innerWidth,
        height: window.innerHeight,
        textSample: text.slice(0, 1200),
        visible: {
          appShell: visible(".app-shell"),
          activityBar: visible(".activity-bar"),
          sidebar: visible(".sidebar"),
          welcome: visible(".welcome-page"),
          mcp: visible('[data-codek-smoke="mcp-workbench-surface"]'),
          scm: visible(".source-control-view"),
          settings: visible(".settings-overlay"),
          taskCenter: visible('[data-codek-smoke="task-center-workbench-detail"]'),
          taskRunDetail: visible('[data-codek-smoke="task-run-detail-modal"]'),
          goalResultDetail: visible(".goal-result-modal"),
          marketplace: visible('[data-codek-smoke="extension-gallery-workbench-shell"]'),
        },
        geometry: {
          taskRunDetailModal: rectSize('[data-codek-smoke="task-run-detail-modal"]'),
          taskRunOrchestratorPanel: rectSize('[data-codek-smoke="task-run-detail-modal"] .orchestrator-panel'),
          agentObservablePanel: rectSize('[data-codek-smoke="task-run-detail-modal"] [data-codek-smoke="agent-observable-panel"]'),
        },
        taskCenterDetailClicked,
        taskCenterDetailError,
        activityIds,
        titlebarText,
        hasHiddenNoise: {
          chatText: /\\bChat\\b/.test(titlebarText),
          askText: /\\bask\\b/i.test(titlebarText),
          goalZero: /\\bG\\s*0\\b/.test(titlebarText),
          bangZero: /!\\s*0\\b/.test(titlebarText),
          debugActivity: activityIds.includes("workbench.view.debug"),
          remoteActivity: activityIds.includes("codek.view.remote"),
          automationActivity: activityIds.includes("codek.view.automation"),
          testingActivity: activityIds.includes("workbench.view.testing"),
        },
      }
    })()
  `)
  const image = await win.webContents.capturePage()
  fs.writeFileSync(screenshotPath, image.toPNG())
  if (view === "goals") {
    await win.webContents.executeJavaScript(`
      (async () => {
        for (const closeButton of Array.from(document.querySelectorAll('[data-codek-smoke="task-run-detail-modal"] .goal-result-close, .goal-result-modal .goal-result-close'))) {
          closeButton.click()
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      })()
    `).catch(() => null)
  }
  return {
    ...state,
    name,
    screenshotPath,
    screenshotExists: fs.existsSync(screenshotPath),
  }
}

function buildWorkbenchUiAuditChecks(captures) {
  const checks = []
  const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
  const byName = new Map(captures.map((item) => [item.name, item]))
  const allText = captures.map((item) => item.textSample || "").join("\n")
  const mcpText = [
    byName.get("desktop-light-mcp")?.textSample || "",
    byName.get("desktop-dark-mcp")?.textSample || "",
    byName.get("narrow-light-mcp")?.textSample || "",
  ].join("\n")
  const allActivityIds = new Set(captures.flatMap((item) => item.activityIds || []))
  const noise = captures.flatMap((item) => Object.entries(item.hasHiddenNoise || {}).filter(([, value]) => value).map(([key]) => `${item.name}:${key}`))
  add("截图矩阵文件已写入", captures.every((item) => item.screenshotExists), captures.map((item) => item.screenshotPath).join("\n"))
  add("浅色欢迎页已渲染", Boolean(byName.get("desktop-light-files")?.visible?.welcome), JSON.stringify(byName.get("desktop-light-files") || {}))
  add("深色欢迎页已渲染", Boolean(byName.get("desktop-dark-files")?.visible?.welcome), JSON.stringify(byName.get("desktop-dark-files") || {}))
  add("MCP 管理页已渲染", Boolean(byName.get("desktop-light-mcp")?.visible?.mcp && byName.get("desktop-dark-mcp")?.visible?.mcp), JSON.stringify({
    light: byName.get("desktop-light-mcp")?.visible,
    dark: byName.get("desktop-dark-mcp")?.visible,
  }))
  add("SCM 页面已渲染", Boolean(byName.get("desktop-light-changes")?.visible?.scm && byName.get("desktop-dark-changes")?.visible?.scm), JSON.stringify({
    light: byName.get("desktop-light-changes")?.visible,
    dark: byName.get("desktop-dark-changes")?.visible,
  }))
  add("设置页面已渲染", Boolean(byName.get("desktop-light-settings")?.visible?.settings && byName.get("desktop-dark-settings")?.visible?.settings), JSON.stringify({
    light: byName.get("desktop-light-settings")?.visible,
    dark: byName.get("desktop-dark-settings")?.visible,
  }))
  add("任务中心已渲染", Boolean(byName.get("desktop-light-goals")?.visible?.taskCenter && byName.get("desktop-dark-goals")?.visible?.taskCenter), JSON.stringify({
    light: byName.get("desktop-light-goals")?.visible,
    dark: byName.get("desktop-dark-goals")?.visible,
  }))
  add("任务中心查看打开详情", Boolean(
    byName.get("desktop-light-goals")?.taskCenterDetailClicked
      && (byName.get("desktop-light-goals")?.visible?.taskRunDetail || byName.get("desktop-light-goals")?.visible?.goalResultDetail)
      && byName.get("desktop-dark-goals")?.taskCenterDetailClicked
      && (byName.get("desktop-dark-goals")?.visible?.taskRunDetail || byName.get("desktop-dark-goals")?.visible?.goalResultDetail),
  ), JSON.stringify({
    light: byName.get("desktop-light-goals") || {},
    dark: byName.get("desktop-dark-goals") || {},
  }))
  add("任务详情弹窗首屏高度可读", Boolean(
    (byName.get("desktop-light-goals")?.geometry?.taskRunDetailModal?.height || 0) >= 520
      && (byName.get("desktop-light-goals")?.geometry?.taskRunOrchestratorPanel?.height || 0) >= 480
      && (byName.get("desktop-dark-goals")?.geometry?.taskRunDetailModal?.height || 0) >= 520
      && (byName.get("desktop-dark-goals")?.geometry?.taskRunOrchestratorPanel?.height || 0) >= 480,
  ), JSON.stringify({
    light: byName.get("desktop-light-goals")?.geometry || {},
    dark: byName.get("desktop-dark-goals")?.geometry || {},
  }))
  add("窄屏 MCP 已渲染", Boolean(byName.get("narrow-light-mcp")?.visible?.mcp), JSON.stringify(byName.get("narrow-light-mcp") || {}))
  add("默认活动栏无未完成入口", !["workbench.view.debug", "codek.view.remote", "codek.view.automation", "workbench.view.testing"].some((id) => allActivityIds.has(id)), JSON.stringify([...allActivityIds]))
  add("顶部无重复 Chat/ask/G0/!0 噪声", noise.length === 0, noise.join(", "))
  add("MCP 页面包含管理分区", /服务器[\s\S]*添加服务器[\s\S]*工具[\s\S]*资源[\s\S]*提示词模板[\s\S]*日志[\s\S]*安全与审批/.test(mcpText), mcpText.slice(0, 1000))
  add("页面没有裸露英文调试标签", !/(Variables|Watch|Call Stack|Breakpoints|Debug Console|MCP Servers|MCP Resources|MCP Gallery)/.test(allText), allText.slice(0, 1000))
  return checks
}

function renderWorkbenchUiAuditMarkdown(report) {
  return [
    "# Workbench UI 截图审查",
    "",
    `- 状态：${report.ready ? "通过" : "失败"}`,
    `- 生成时间：${report.createdAt}`,
    `- 截图目录：${normalizeSmokePathForMarkdown(report.outputDir)}`,
    "",
    "## 截图",
    "",
    ...report.captures.map((item) => `- ${item.name}: ${normalizeSmokePathForMarkdown(item.screenshotPath)}`),
    "",
    "## 检查",
    "",
    "| 检查 | 状态 |",
    "| --- | --- |",
    ...report.checks.map((check) => `| ${check.name} | ${toSmokeCheckStatus(check.passed)} |`),
    "",
  ].join("\n")
}

async function exerciseElectronSmokeWorkbenchUiAudit(win) {
  if (!isWorkbenchUiAuditSmoke) return null
  const projectRoot = path.resolve(process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_ROOT || path.resolve(__dirname, ".."))
  if (fs.existsSync(projectRoot) && fs.statSync(projectRoot).isDirectory()) {
    currentProjectRoot = projectRoot
    currentWorkspaceRoots = [projectRoot]
    currentWorkspaceFile = null
    await startFileWatcher(currentProjectRoot)
  }
  const outDir = getWorkbenchUiAuditOutputDir()
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  const desktopBounds = { width: 1400, height: 900 }
  const narrowBounds = { width: 390, height: 820 }
  const captures = []
  const desktopMatrix = [
    ["light", "files"],
    ["dark", "files"],
    ["light", "marketplace"],
    ["dark", "marketplace"],
    ["light", "mcp"],
    ["dark", "mcp"],
    ["light", "changes"],
    ["dark", "changes"],
    ["light", "settings"],
    ["dark", "settings"],
    ["light", "goals"],
    ["dark", "goals"],
  ]
  win.setSize(desktopBounds.width, desktopBounds.height)
  await new Promise((resolve) => setTimeout(resolve, 250))
  for (const [theme, view] of desktopMatrix) {
    captures.push(await captureWorkbenchUiAuditShot(win, outDir, { theme, view, viewport: "desktop" }))
  }
  win.setSize(narrowBounds.width, narrowBounds.height)
  await new Promise((resolve) => setTimeout(resolve, 300))
  for (const view of ["files", "mcp", "settings"]) {
    captures.push(await captureWorkbenchUiAuditShot(win, outDir, { theme: "light", view, viewport: "narrow" }))
  }
  const checks = buildWorkbenchUiAuditChecks(captures)
  const ready = checks.every((check) => check.passed)
  const createdAt = new Date().toISOString()
  const stamp = sanitizeSmokeTimestamp(createdAt)
  const reportsDir = path.join(CODEK_DATA, "reports")
  fs.mkdirSync(reportsDir, { recursive: true })
  const jsonPath = path.join(reportsDir, `workbench-ui-audit-${stamp}.json`)
  const markdownPath = path.join(reportsDir, `workbench-ui-audit-${stamp}.md`)
  const latestJsonPath = path.join(reportsDir, "workbench-ui-audit-latest.json")
  const latestMarkdownPath = path.join(reportsDir, "workbench-ui-audit-latest.md")
  const report = {
    reportKind: "workbench-ui-screenshot-audit",
    createdAt,
    ready,
    status: ready ? "ready" : "not-ready",
    outputDir: outDir,
    captures,
    checks,
    jsonPath,
    markdownPath,
    latestJsonPath,
    latestMarkdownPath,
  }
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  const markdown = renderWorkbenchUiAuditMarkdown(report)
  fs.writeFileSync(markdownPath, markdown, "utf8")
  fs.writeFileSync(latestMarkdownPath, markdown, "utf8")
  return report
}

function writeArtifactOpenSmokeEvidence(result) {
  if (!isSmoke || !isArtifactOpenSmoke) return result
  const reportsDir = path.join(CODEK_DATA, "reports")
  const createdAt = new Date().toISOString()
  const stamp = sanitizeSmokeTimestamp(createdAt)
  const jsonPath = path.join(reportsDir, `workbench-artifact-open-${stamp}.json`)
  const markdownPath = path.join(reportsDir, `workbench-artifact-open-${stamp}.md`)
  const latestJsonPath = path.join(reportsDir, "workbench-artifact-open-latest.json")
  const latestMarkdownPath = path.join(reportsDir, "workbench-artifact-open-latest.md")
  fs.mkdirSync(reportsDir, { recursive: true })
  const acceptance = buildArtifactOpenSmokeAcceptance(result)
  const ready = Object.values(acceptance).every(Boolean)
  const report = {
    reportKind: "workbench-artifact-open-smoke-evidence",
    createdAt,
    ready,
    status: ready ? "ready" : "not-ready",
    projectRoot: result?.projectRoot || "",
    metrics: result,
    acceptance,
  }
  const reportWithPaths = { ...report, jsonPath, markdownPath, latestJsonPath, latestMarkdownPath }
  const markdown = renderArtifactOpenSmokeMarkdown(reportWithPaths)
  fs.writeFileSync(jsonPath, `${JSON.stringify(reportWithPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(reportWithPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(markdownPath, markdown, "utf8")
  fs.writeFileSync(latestMarkdownPath, markdown, "utf8")
  return {
    ...result,
    evidence: {
      reportKind: report.reportKind,
      createdAt,
      ready,
      status: report.status,
      jsonPath,
      markdownPath,
      latestJsonPath,
      latestMarkdownPath,
    },
    evidenceJsonExists: fs.existsSync(jsonPath) && fs.existsSync(latestJsonPath),
    evidenceMarkdownExists: fs.existsSync(markdownPath) && fs.existsSync(latestMarkdownPath),
  }
}

async function writeRealProjectUiSmokeEvidence(win, result) {
  if (!isSmoke || !isRealProjectUiSmoke) return result
  if (!win || win.isDestroyed()) throw new Error("real project UI smoke evidence capture window missing")

  const reportsDir = path.join(CODEK_DATA, "reports")
  const createdAt = new Date().toISOString()
  const stamp = sanitizeSmokeTimestamp(createdAt)
  const reportName = isFocusedLargeFileRealProjectUiSmoke
    ? "workbench-large-file-256mb-real-project-ui"
    : "workbench-real-project-ui"
  const jsonPath = path.join(reportsDir, `${reportName}-${stamp}.json`)
  const markdownPath = path.join(reportsDir, `${reportName}-${stamp}.md`)
  const screenshotPath = path.join(reportsDir, `${reportName}-${stamp}.png`)
  const latestJsonPath = path.join(reportsDir, `${reportName}-latest.json`)
  const latestMarkdownPath = path.join(reportsDir, `${reportName}-latest.md`)
  const latestScreenshotPath = path.join(reportsDir, `${reportName}-latest.png`)

  fs.mkdirSync(reportsDir, { recursive: true })
  const screenshotEvidence = isFocusedLargeFileRealProjectUiSmoke
    ? {
      ready: false,
      skipped: true,
      reason: "skipped for focused large-file real-project-ui smoke",
      attempt: 0,
      pixelState: null,
    }
    : await captureRealProjectUiSmokeScreenshotEvidence(win, result)
  if (!isFocusedLargeFileRealProjectUiSmoke) {
    const image = screenshotEvidence?.image || await win.webContents.capturePage()
    const png = image.toPNG()
    fs.writeFileSync(screenshotPath, png)
    fs.writeFileSync(latestScreenshotPath, png)
  }

  const metricsWithEvidence = {
    ...result,
    screenshotEvidence: {
      ready: Boolean(screenshotEvidence?.ready),
      skipped: Boolean(screenshotEvidence?.skipped),
      reason: screenshotEvidence?.reason || "",
      attempt: screenshotEvidence?.attempt || 0,
      pixelState: screenshotEvidence?.pixelState || null,
    },
  }
  const acceptance = buildRealProjectUiSmokeAcceptance(metricsWithEvidence)
  const gateAttribution = buildRealProjectUiGateAttribution(acceptance)
  const manualAcceptanceContract = gateAttribution.manualAcceptanceContract
  const ready = Object.values(acceptance).every(Boolean)
  const report = {
    reportKind: "workbench-real-project-ui-smoke-evidence",
    createdAt,
    ready,
    status: ready ? "ready" : "not-ready",
    projectRoot: result?.projectRoot || "",
    screenshotPath: isFocusedLargeFileRealProjectUiSmoke ? "" : screenshotPath,
    latestScreenshotPath: isFocusedLargeFileRealProjectUiSmoke ? "" : latestScreenshotPath,
    screenshotEvidence: metricsWithEvidence.screenshotEvidence,
    metrics: metricsWithEvidence,
    acceptance,
    gateAttribution,
    manualAcceptanceContract,
  }
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestJsonPath, `${JSON.stringify({ ...report, jsonPath, markdownPath, latestJsonPath, latestMarkdownPath }, null, 2)}\n`, "utf8")
  const markdown = renderRealProjectUiSmokeMarkdown({ ...report, jsonPath, markdownPath, latestJsonPath, latestMarkdownPath })
  fs.writeFileSync(markdownPath, markdown, "utf8")
  fs.writeFileSync(latestMarkdownPath, markdown, "utf8")

  return {
    ...result,
    evidence: {
      reportKind: report.reportKind,
      createdAt,
      ready,
      status: report.status,
      jsonPath,
      markdownPath,
      screenshotPath: report.screenshotPath,
      latestJsonPath,
      latestMarkdownPath,
      latestScreenshotPath: report.latestScreenshotPath,
    },
    acceptance,
    gateAttribution,
    manualAcceptanceContract,
    ready,
    status: report.status,
    evidenceJsonExists: fs.existsSync(jsonPath) && fs.existsSync(latestJsonPath),
    evidenceMarkdownExists: fs.existsSync(markdownPath) && fs.existsSync(latestMarkdownPath),
    evidenceScreenshotExists: isFocusedLargeFileRealProjectUiSmoke
      ? true
      : fs.existsSync(screenshotPath) && fs.existsSync(latestScreenshotPath),
  }
}

function findExistingPath(candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function getResourcePath(relativePath) {
  if (isDev) {
    return path.join(__dirname, relativePath)
  }
  return path.join(process.resourcesPath, "resources", relativePath)
}

function getBundledFrontendPath() {
  const desktopFrontend = path.join(__dirname, "frontend-dist", "index.html")
  if (fs.existsSync(desktopFrontend)) return desktopFrontend
  return path.join(__dirname, "..", "frontend", "vite-project", "dist", "index.html")
}

function getFrontendPath() {
  if (useDevServer) {
    return process.env.CODEK_DEV_SERVER_URL || `http://localhost:5173`
  }
  return getBundledFrontendPath()
}

async function loadFrontendIntoWindow(win, frontendPath) {
  if (typeof frontendPath === "string" && frontendPath.startsWith("http")) {
    try {
      await win.loadURL(frontendPath)
      return { loadedPath: frontendPath, fallback: false }
    } catch (error) {
      if (!useDevServer) throw error
      const fallbackPath = getBundledFrontendPath()
      const fallbackExists = fs.existsSync(fallbackPath)
      writeElectronSmokeStage("load-frontend-dev-server-failed", {
        frontendPath,
        error: String(error?.message || error),
        fallbackPath,
        fallbackExists,
      })
      log(`Frontend dev server unavailable; falling back to ${fallbackPath}.`)
      if (!fallbackExists) throw error
      await win.loadFile(fallbackPath)
      return { loadedPath: fallbackPath, fallback: true }
    }
  }

  await win.loadFile(frontendPath)
  return { loadedPath: frontendPath, fallback: false }
}

function ensureDirectories() {
  ;[CODEK_DATA, CODEK_LOGS].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  })
}

function isInsideAnyRoot(filePath, roots) {
  const resolved = path.resolve(filePath)
  return roots
    .filter(Boolean)
    .map((root) => path.resolve(root))
    .some((root) => resolved === root || resolved.startsWith(root + path.sep))
}

function getExtensionResourceRoots() {
  return [
    path.resolve(__dirname, "..", "extensions"),
    path.resolve(__dirname, "extensions"),
    path.join(CODEK_DATA, "extensions"),
    path.join(CODEK_DATA, "plugins"),
    path.join(CODEX_HOME, "plugins"),
    path.join(HOME, ".vscode", "extensions"),
    path.join(HOME, ".cursor", "extensions"),
    currentProjectRoot,
    ...currentWorkspaceRoots,
  ]
}

function registerExtensionResourceProtocol() {
  protocol.handle("codek-extension-resource", async (request) => {
    try {
      const resourceUrl = new URL(String(request.url))
      const filePath = fileUriPathToFsPath(resourceUrl.pathname)
      const resolved = path.resolve(filePath)
      if (!isInsideAnyRoot(resolved, getExtensionResourceRoots())) {
        return new Response("Forbidden", { status: 403 })
      }
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        return new Response("Not found", { status: 404 })
      }
      const response = await net.fetch(pathToFileURL(resolved).toString())
      const headers = new Headers(response.headers)
      headers.set("Access-Control-Allow-Origin", "*")
      headers.set("Cross-Origin-Resource-Policy", "cross-origin")
      headers.set("Content-Type", getExtensionResourceMimeType(resolved))
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    } catch (error) {
      return new Response(String(error?.message || error), { status: 500 })
    }
  })
}

function getExtensionResourceMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case ".woff":
      return "font/woff"
    case ".woff2":
      return "font/woff2"
    case ".ttf":
      return "font/ttf"
    case ".otf":
      return "font/otf"
    case ".eot":
      return "application/vnd.ms-fontobject"
    case ".svg":
      return "image/svg+xml"
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".gif":
      return "image/gif"
    case ".webp":
      return "image/webp"
    case ".json":
      return "application/json; charset=utf-8"
    case ".css":
      return "text/css; charset=utf-8"
    default:
      return "application/octet-stream"
  }
}

const WATCH_DEBOUNCE_MS = 200
const MAX_RENDERER_READ_FILE_BYTES = DEFAULT_MAX_RENDERER_READ_FILE_BYTES
const MAX_RENDERER_PREVIEW_FILE_BYTES = DEFAULT_MAX_RENDERER_PREVIEW_FILE_BYTES
const SMOKE_FRONTEND_LARGE_FILE_WINDOW_BYTES = 16 * 1024 * 1024
const FS_STAT_TIMEOUT_MS = 1500
const MAX_RENDERER_LIST_DIR_ENTRIES = 600
const MAX_EXPANDED_WATCH_DIRS = 256
const WATCHER_START_IDLE_MS = 6000
const EXPANDED_WATCH_IDLE_MS = 150

function stopFileWatcherTimers() {
  if (watcherStartupTimer) {
    clearTimeout(watcherStartupTimer)
    watcherStartupTimer = null
  }
  if (expandedWatchFlushTimer) {
    clearTimeout(expandedWatchFlushTimer)
    expandedWatchFlushTimer = null
  }
}

function isActiveWatcherStart(projectRoot, generation) {
  if (generation !== watcherStartupGeneration) return false
  if (!projectRoot || !currentProjectRoot) return false
  return path.resolve(projectRoot) === path.resolve(currentProjectRoot)
}

async function startFileWatcher(projectRoot, generation = watcherStartupGeneration) {
  if (!isActiveWatcherStart(projectRoot, generation)) return
  stopFileWatcher({ preserveScaleProfile: true, preserveExpandedDirs: true, preserveTimers: true })
  if (!projectRoot) {
    currentWatcherProjectRoot = null
    watchedExpandedDirs.clear()
    pendingExpandedWatchDirs.clear()
    return
  }
  const resolvedProjectRoot = path.resolve(projectRoot)
  if (currentWatcherProjectRoot !== resolvedProjectRoot) {
    watchedExpandedDirs.clear()
    currentWatcherProjectRoot = resolvedProjectRoot
  }

  let chokidar
  try {
    const mod = await import("chokidar")
    chokidar = mod.default || mod
  } catch (err) {
    if (!isActiveWatcherStart(resolvedProjectRoot, generation)) return
    log(`Failed to load chokidar: ${err.message}`)
    return
  }
  if (!isActiveWatcherStart(resolvedProjectRoot, generation)) return

  currentWorkspaceScaleProfile = await createWorkspaceScaleProfile(projectRoot).catch((err) => ({
    scale: "huge",
    reasons: [`profile-error:${err.message}`],
    budgets: {
      explorerMaxEntries: 1_200,
      watcherDepth: 1,
      watcherMode: "shallow",
    },
  }))
  if (!isActiveWatcherStart(resolvedProjectRoot, generation)) return
  const watcherOptions = buildWatcherOptions(currentWorkspaceScaleProfile)
  const watchTargets = shouldStartRecursiveWatcher(currentWorkspaceScaleProfile)
    ? [projectRoot]
    : [projectRoot, ...watchedExpandedDirs].filter((dir) => shouldAutoWatchExpandedDirectory(dir, projectRoot))

  fileWatcher = chokidar.watch(watchTargets, watcherOptions)

  const flushWatchEvents = () => {
    if (pendingWatchEvents.length === 0) return
    const events = [...pendingWatchEvents]
    pendingWatchEvents.length = 0
    if (mainWindow && !mainWindow.isDestroyed()) {
      for (const evt of events) {
        mainWindow.webContents.send("fs:changed", evt)
      }
    }
  }

  const handleWatchEvent = (type, filePath) => {
    pendingWatchEvents.push({ path: filePath, type })
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(flushWatchEvents, WATCH_DEBOUNCE_MS)
  }

  fileWatcher.on("add", (p) => handleWatchEvent("add", p))
  fileWatcher.on("change", (p) => handleWatchEvent("change", p))
  fileWatcher.on("unlink", (p) => handleWatchEvent("unlink", p))
  fileWatcher.on("error", (err) => {
    log(`File watcher error: ${err.message}`)
  })

  log(`File watcher started for: ${projectRoot} (${currentWorkspaceScaleProfile.scale}, ${currentWorkspaceScaleProfile.budgets?.watcherMode || "unknown"})`)
}

function watchExpandedDirectory(dirPath) {
  if (!currentProjectRoot || !currentWorkspaceScaleProfile) return
  if (!shouldWatchExpandedDirectories(currentWorkspaceScaleProfile)) return
  if (!shouldAutoWatchExpandedDirectory(dirPath, currentProjectRoot)) return
  const normalized = path.resolve(dirPath)
  if (watchedExpandedDirs.has(normalized)) return
  if (watchedExpandedDirs.size >= MAX_EXPANDED_WATCH_DIRS) return
  if (!fileWatcher) {
    watchedExpandedDirs.add(normalized)
    return
  }
  watchedExpandedDirs.add(normalized)
  try {
    fileWatcher.add(normalized)
    log(`File watcher added expanded directory: ${normalized}`)
  } catch (err) {
    log(`Failed to add expanded directory watcher: ${err.message}`)
  }
}

function scheduleExpandedDirectoryWatch(dirPath) {
  if (!dirPath || !currentProjectRoot || !currentWorkspaceScaleProfile) return
  if (!shouldWatchExpandedDirectories(currentWorkspaceScaleProfile)) return
  const normalized = path.resolve(dirPath)
  if (watchedExpandedDirs.has(normalized) || pendingExpandedWatchDirs.has(normalized)) return
  if (!shouldAutoWatchExpandedDirectory(normalized, currentProjectRoot)) return
  pendingExpandedWatchDirs.add(normalized)
  if (expandedWatchFlushTimer) return
  expandedWatchFlushTimer = setTimeout(() => {
    expandedWatchFlushTimer = null
    const dirs = [...pendingExpandedWatchDirs]
    pendingExpandedWatchDirs.clear()
    for (const dir of dirs) watchExpandedDirectory(dir)
  }, EXPANDED_WATCH_IDLE_MS)
}

function createPendingWorkspaceScaleProfile(projectRoot) {
  const resolvedRoot = projectRoot ? path.resolve(projectRoot) : null
  return {
    root: resolvedRoot,
    scale: "huge",
    reasons: ["pending-background-profile"],
    sampledEntries: 0,
    topLevelEntries: 0,
    topLevelDirs: 0,
    generatedEntryCount: 0,
    heavyDirCount: 0,
    saturatedChildDirs: 0,
    budgets: {
      explorerMaxEntries: 1_200,
      searchMaxVisitedFiles: 6_000,
      searchMaxResults: 500,
      indexMaxFiles: 600,
      analysisMaxFiles: 80,
      watcherDepth: 1,
      watcherMode: "shallow",
    },
    pending: true,
    sampledAt: Date.now(),
  }
}

function scheduleFileWatcher(projectRoot) {
  if (!projectRoot) {
    stopFileWatcher()
    watcherStartupGeneration += 1
    currentWorkspaceScaleProfile = null
    currentWatcherProjectRoot = null
    watchedExpandedDirs.clear()
    pendingExpandedWatchDirs.clear()
    return
  }
  const resolvedProjectRoot = path.resolve(projectRoot)
  if (
    !fileWatcher
    && watcherStartupTimer
    && currentWatcherProjectRoot === resolvedProjectRoot
    && currentWorkspaceScaleProfile?.pending
  ) {
    return
  }
  stopFileWatcher()
  watcherStartupGeneration += 1
  const nextGeneration = watcherStartupGeneration
  currentWorkspaceScaleProfile = createPendingWorkspaceScaleProfile(resolvedProjectRoot)
  currentWatcherProjectRoot = resolvedProjectRoot
  watchedExpandedDirs.clear()
  pendingExpandedWatchDirs.clear()
  watcherStartupTimer = setTimeout(() => {
    watcherStartupTimer = null
    startFileWatcher(resolvedProjectRoot, nextGeneration).catch((err) => {
      if (nextGeneration === watcherStartupGeneration) {
        log(`File watcher background start failed: ${err.message}`)
      }
    })
  }, WATCHER_START_IDLE_MS)
}

function workspacePathKey(value) {
  return normalizeWorkspacePath(value || "").toLowerCase()
}

function sameWorkspaceRoots(nextRoots, nextWorkspaceFile = null) {
  const normalizedRoots = [...new Set((nextRoots || []).map(normalizeWorkspacePath).filter(Boolean))]
  if (normalizedRoots.length !== currentWorkspaceRoots.length) return false
  for (let index = 0; index < normalizedRoots.length; index += 1) {
    if (workspacePathKey(normalizedRoots[index]) !== workspacePathKey(currentWorkspaceRoots[index])) return false
  }
  return workspacePathKey(nextWorkspaceFile || "") === workspacePathKey(currentWorkspaceFile || "")
}

async function waitForWorkspaceScaleProfileReady(projectRoot, timeoutMs = WATCHER_START_IDLE_MS + 15000) {
  const started = Date.now()
  const resolvedProjectRoot = projectRoot ? path.resolve(projectRoot) : ""
  while (Date.now() - started <= timeoutMs) {
    if (
      currentWorkspaceScaleProfile &&
      !currentWorkspaceScaleProfile.pending &&
      (!resolvedProjectRoot || path.resolve(currentWorkspaceScaleProfile.root || resolvedProjectRoot) === resolvedProjectRoot)
    ) {
      return currentWorkspaceScaleProfile
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return currentWorkspaceScaleProfile
}

async function setWorkspaceRoots(roots, workspaceFile = null) {
  const nextRoots = [...new Set((roots || []).map(normalizeWorkspacePath).filter(Boolean))]
  const nextWorkspaceFile = workspaceFile ? normalizeWorkspacePath(workspaceFile) : null
  if (sameWorkspaceRoots(nextRoots, nextWorkspaceFile)) return
  currentWorkspaceRoots = nextRoots
  currentProjectRoot = currentWorkspaceRoots[0] || null
  currentWorkspaceFile = nextWorkspaceFile
  scheduleFileWatcher(currentProjectRoot)
}

function getWorkspaceState() {
  return {
    projectRoot: currentProjectRoot,
    workspaceFile: currentWorkspaceFile,
    workspaceRoots: currentWorkspaceRoots.length > 0
      ? currentWorkspaceRoots
      : (currentProjectRoot ? [currentProjectRoot] : []),
    workspaceScaleProfile: currentWorkspaceScaleProfile,
  }
}

function collectProcessSummary() {
  return {
    app: {
      name: app.getName(),
      version: app.getVersion(),
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      node: process.versions.node,
      memory: process.memoryUsage(),
    },
    windows: BrowserWindow.getAllWindows().map((win) => ({
      id: win.id,
      title: win.getTitle(),
      destroyed: win.isDestroyed(),
      focused: win.isFocused(),
      visible: win.isVisible(),
      rendererPid: win.webContents.getOSProcessId?.() || null,
    })),
    pty: ptyManager.getProcessExplorerSnapshot(),
    lsp: [...lspProcesses.entries()].map(([id, entry]) => ({
      id,
      pid: entry.process?.pid || null,
    })),
    dap: [...dapProcesses.entries()].map(([id, entry]) => ({
      id,
      pid: entry.process?.pid || null,
      adapterType: entry.adapterType || "",
    })),
    mcp: [...mcpProcesses.entries()].map(([id, entry]) => ({
      id,
      pid: entry.process?.pid || null,
      command: entry.command || "",
    })),
  }
}

function writeDiagnosticsBundle() {
  ensureDirectories()
  const dir = path.join(CODEK_DATA, "diagnostics")
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const filePath = path.join(dir, `diagnostics-${stamp}.json`)
  const payload = {
    createdAt: Date.now(),
    app: {
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      dataPath: CODEK_DATA,
      logsPath: app.getPath("logs"),
    },
    workspace: getWorkspaceState(),
    process: collectProcessSummary(),
  }
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8")
  return { path: filePath, payload }
}

function stopFileWatcher(options = {}) {
  if (!options.preserveTimers) stopFileWatcherTimers()
  clearTimeout(debounceTimer)
  pendingWatchEvents.length = 0
  if (fileWatcher) {
    fileWatcher.close()
    fileWatcher = null
    log("File watcher stopped.")
  }
  if (!options.preserveScaleProfile) currentWorkspaceScaleProfile = null
  if (!options.preserveExpandedDirs) {
    watchedExpandedDirs.clear()
    pendingExpandedWatchDirs.clear()
  }
}

function prepareSmokeAnalysisProject() {
  const projectRoot = path.join(CODEK_DATA, "electron-smoke-analysis-project")
  const srcDir = path.join(projectRoot, "src")
  fs.mkdirSync(srcDir, { recursive: true })
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "codek-smoke-analysis-project",
    type: "module",
    private: true,
  }, null, 2), "utf-8")
  fs.writeFileSync(path.join(projectRoot, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      module: "ESNext",
      strict: true,
      skipLibCheck: true,
    },
    include: ["src/**/*.ts"],
  }, null, 2), "utf-8")
  fs.writeFileSync(path.join(srcDir, "main.ts"), [
    "export interface GreetingOptions {",
    "  excited?: boolean",
    "}",
    "",
    "export function greet(name: string, options: GreetingOptions = {}): string {",
    "  const suffix = options.excited ? \"!\" : \".\"",
    "  return `Hello, ${name}${suffix}`",
    "}",
    "",
    "export const smokeGreeting = greet(\"Codek\", { excited: true })",
    "",
  ].join("\n"), "utf-8")
  fs.writeFileSync(path.join(srcDir, "broken.ts"), [
    "export const brokenValue =",
    "",
  ].join("\n"), "utf-8")
  return projectRoot
}

function prepareSmokeExplorerProject() {
  const projectRoot = path.join(CODEK_DATA, "electron-smoke-explorer-project")
  const srcDir = path.join(projectRoot, "src")
  const logsDir = path.join(projectRoot, "logs")
  const generatedDir = path.join(projectRoot, "frontend-dist", "assets")
  const releaseDir = path.join(projectRoot, "release", "win-unpacked")
  const cacheDir = path.join(projectRoot, ".codek", "cache")
  fs.mkdirSync(srcDir, { recursive: true })
  fs.mkdirSync(logsDir, { recursive: true })
  fs.mkdirSync(generatedDir, { recursive: true })
  fs.mkdirSync(releaseDir, { recursive: true })
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "codek-smoke-explorer-project",
    type: "module",
    private: true,
  }, null, 2), "utf-8")

  for (let index = 0; index < 10000; index += 1) {
    const filePath = path.join(srcDir, `file-${String(index).padStart(4, "0")}.ts`)
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, `export const smokeValue${index} = ${index}\n`, "utf-8")
    }
  }
  for (let index = 0; index < 16; index += 1) {
    const generatedFilePath = path.join(generatedDir, `bundle-${index}.js`)
    const releaseFilePath = path.join(releaseDir, `artifact-${index}.js`)
    const cacheFilePath = path.join(cacheDir, `state-${index}.json`)
    if (!fs.existsSync(generatedFilePath)) fs.writeFileSync(generatedFilePath, `console.log(${index})\n`, "utf-8")
    if (!fs.existsSync(releaseFilePath)) fs.writeFileSync(releaseFilePath, `console.log(${index})\n`, "utf-8")
    if (!fs.existsSync(cacheFilePath)) fs.writeFileSync(cacheFilePath, "{}\n", "utf-8")
  }

  const largeFilePath = path.join(logsDir, "huge.log")
  const largeFileBytes = Number(process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_LARGE_FILE_BYTES || 32 * 1024 * 1024)
  let shouldWriteLargeFile = true
  try {
    const existingPrefix = fs.existsSync(largeFilePath)
      ? fs.readFileSync(largeFilePath, { encoding: "utf8", flag: "r" }).slice(0, 4096)
      : ""
    shouldWriteLargeFile = !fs.existsSync(largeFilePath)
      || fs.statSync(largeFilePath).size < largeFileBytes
      || !existingPrefix.includes("codek smoke large log line keeps renderer rows bounded-v2")
  } catch {
    shouldWriteLargeFile = true
  }
  if (shouldWriteLargeFile) {
    writeSmokeLargeLogFile(largeFilePath, largeFileBytes)
  }
  const extremeFilePath = path.join(logsDir, "extreme-windowed.log")
  const extremeFirstWindow = Array.from({ length: 4096 }, (_value, index) => `CODEK_EXTREME_WINDOW_001 line ${index}`).join("\n")
  const extremeSecondWindow = Array.from({ length: 4096 }, (_value, index) => `CODEK_EXTREME_WINDOW_002 line ${index}`).join("\n")
  // Keep the smoke fixture deterministic across runs; older local fixtures may
  // have different marker placement and can cause false large-window failures.
  fs.writeFileSync(extremeFilePath, buildSmokeWindowedContent(extremeFirstWindow, extremeSecondWindow), "utf-8")
  const extremeFileSize = fs.statSync(extremeFilePath).size
  electronSmokeExplorerExtremeFile = {
    filePath: extremeFilePath,
    virtualSize: Math.max(MAX_RENDERER_READ_FILE_BYTES + 1, extremeFileSize),
  }
  return {
    projectRoot,
    largeFile: path.join("logs", "huge.log"),
    extremeFile: path.join("logs", "extreme-windowed.log"),
  }
}

function buildSmokeWindowedContent(firstWindowText, secondWindowText) {
  const first = String(firstWindowText || "")
  const second = String(secondWindowText || "")
  const smokeWindowBytes = Math.max(SMOKE_FRONTEND_LARGE_FILE_WINDOW_BYTES, MAX_RENDERER_PREVIEW_FILE_BYTES)
  const paddingLength = Math.max(0, smokeWindowBytes - Buffer.byteLength(first, "utf8"))
  return `${first}${"x".repeat(paddingLength)}${second}`
}

function writeSmokeLargeLogFile(filePath, targetBytes) {
  const linePrefix = "xxxxxxxx codek smoke large log line keeps renderer rows bounded-v2 and visible "
  const line = `${linePrefix}${"x".repeat(Math.max(0, 255 - linePrefix.length))}\n`
  const chunk = line.repeat(4096)
  const target = Math.max(0, Number(targetBytes) || 0)
  const handle = fs.openSync(filePath, "w")
  try {
    let written = 0
    while (written < target) {
      const remaining = target - written
      const text = remaining >= Buffer.byteLength(chunk, "utf8")
        ? chunk
        : chunk.slice(0, remaining)
      const bytes = fs.writeSync(handle, text, undefined, "utf8")
      if (!bytes) break
      written += bytes
    }
  } finally {
    fs.closeSync(handle)
  }
}

function isRealProjectUiSmokeTargetName(name) {
  return /^codek-real-ui-smoke-target-\d+-\d+$/.test(String(name || ""))
}

function isGeneratedRealProjectUiSmokeTarget(candidateDir) {
  try {
    const searchTargetPath = path.join(candidateDir, "nested", "search-target.ts")
    const largeLogPath = path.join(candidateDir, "logs", "large-real-project.log")
    const extremeLogPath = path.join(candidateDir, "logs", "extreme-real-project-windowed.log")
    if (!fs.existsSync(searchTargetPath)) return false
    const searchTargetSample = fs.readFileSync(searchTargetPath, "utf-8").slice(0, 1024)
    if (!searchTargetSample.includes("codek-real-ui-search-token")) return false
    if (fs.existsSync(largeLogPath)) {
      const largeLogSample = fs.readFileSync(largeLogPath, { encoding: "utf8", flag: "r" }).slice(0, 1024)
      return largeLogSample.includes("codek smoke large log line keeps renderer rows bounded-v2")
    }
    if (fs.existsSync(extremeLogPath)) {
      const extremeLogSample = fs.readFileSync(extremeLogPath, { encoding: "utf8", flag: "r" }).slice(0, 1024)
      return extremeLogSample.includes("CODEK_EXTREME_WINDOW_001")
    }
    return false
  } catch {
    return false
  }
}

function cleanupStaleRealProjectUiSmokeTargets(projectRoot, currentTargetDir) {
  const root = path.resolve(projectRoot)
  const current = path.resolve(currentTargetDir)
  const summary = { scanned: 0, removed: 0, skipped: 0 }
  let entries = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return summary
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !isRealProjectUiSmokeTargetName(entry.name)) continue
    summary.scanned += 1
    const candidate = path.resolve(root, entry.name)
    if (candidate === current || !candidate.startsWith(`${root}${path.sep}`)) {
      summary.skipped += 1
      continue
    }
    if (!isGeneratedRealProjectUiSmokeTarget(candidate)) {
      summary.skipped += 1
      continue
    }
    try {
      fs.rmSync(candidate, { recursive: true, force: true })
      summary.removed += 1
    } catch {
      summary.skipped += 1
    }
  }
  return summary
}

function prepareSmokeFileOperationProject() {
  const projectRoot = path.join(CODEK_DATA, "electron-smoke-file-operation-project")
  const srcDir = path.join(projectRoot, "src")
  fs.mkdirSync(srcDir, { recursive: true })
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "codek-smoke-file-operation-project",
    type: "module",
    private: true,
  }, null, 2), "utf-8")
  fs.writeFileSync(path.join(srcDir, "existing.ts"), "export const existing = 1\n", "utf-8")
  for (const staleFile of ["agent-created.ts", "agent-renamed.ts"]) {
    try {
      fs.rmSync(path.join(srcDir, staleFile), { force: true })
    } catch {
      // ignore stale smoke cleanup failures
    }
  }
  return { projectRoot }
}

function prepareSmokeWorkingCopyHotExitProject() {
  const safeRunId = String(ELECTRON_SMOKE_RUN_ID).replace(/[^a-z0-9_-]/gi, "-")
  const projectRoot = path.join(CODEK_DATA, "electron-smoke-working-copy-hot-exit", safeRunId)
  const srcDir = path.join(projectRoot, "src")
  fs.mkdirSync(srcDir, { recursive: true })
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "codek-smoke-working-copy-hot-exit-project",
    type: "module",
    private: true,
  }, null, 2), "utf-8")
  const targetPath = "src/hot-exit.ts"
  fs.writeFileSync(
    path.join(srcDir, "hot-exit.ts"),
    "export const hotExitSmoke = \"disk baseline\"\n",
    "utf-8",
  )
  return { projectRoot, targetPath }
}

function prepareSmokeSearchReplaceProject(name = "search-replace") {
  const safeName = String(name || "search-replace").replace(/[^a-z0-9_-]/gi, "-").toLowerCase()
  const projectRoot = path.join(CODEK_DATA, `electron-smoke-${safeName}-project`)
  const srcDir = path.join(projectRoot, "src")
  fs.rmSync(projectRoot, { recursive: true, force: true })
  fs.mkdirSync(srcDir, { recursive: true })
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
    name: `codek-smoke-${safeName}-project`,
    type: "module",
    private: true,
  }, null, 2), "utf-8")
  fs.writeFileSync(
    path.join(srcDir, "000-repeated.ts"),
    [
      "export const repeated = \"needle needle\"",
      "export const stable = \"keep\"",
      "",
    ].join("\n"),
    "utf-8",
  )
  fs.writeFileSync(
    path.join(srcDir, "100-other.ts"),
    [
      "export const other = \"needle\"",
      "",
    ].join("\n"),
    "utf-8",
  )
  if (safeName === "search-navigation") {
    fs.writeFileSync(
      path.join(projectRoot, "settings.json"),
      JSON.stringify({
        codekSearchNavigationJsonNeedle: "json navigation root settings",
      }, null, 2) + "\n",
      "utf-8",
    )
    fs.writeFileSync(
      path.join(srcDir, "010-many-lines.ts"),
      Array.from({ length: 24 }, (_value, index) => {
        const line = index + 1
        return `export const manyLine${String(line).padStart(2, "0")} = "needle navigation line ${line}"`
      }).join("\n") + "\n",
      "utf-8",
    )
    for (let index = 0; index < 24; index += 1) {
      const fileName = `nav-${String(index).padStart(2, "0")}.ts`
      fs.writeFileSync(
        path.join(srcDir, fileName),
        [
          `export const nav${String(index).padStart(2, "0")} = "needle navigation file ${index}"`,
          "export const stable = true",
          "",
        ].join("\n"),
        "utf-8",
      )
    }
  }
  return {
    projectRoot,
    repeatedFile: path.join(srcDir, "000-repeated.ts"),
    otherFile: path.join(srcDir, "100-other.ts"),
  }
}

function prepareSmokeDebugSessionProject() {
  const projectRoot = path.join(CODEK_DATA, "electron-smoke-debug-session-project")
  const srcDir = path.join(projectRoot, "src")
  const vscodeDir = path.join(projectRoot, ".vscode")
  fs.rmSync(projectRoot, { recursive: true, force: true })
  fs.mkdirSync(srcDir, { recursive: true })
  fs.mkdirSync(vscodeDir, { recursive: true })
  const program = path.join(srcDir, "debug-session-smoke.js")
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "codek-smoke-debug-session-project",
    private: true,
    type: "commonjs",
  }, null, 2) + "\n", "utf-8")
  fs.writeFileSync(
    program,
    [
      "const value = 42",
      "console.log('codek debug session smoke started', value)",
      "setTimeout(() => {",
      "  console.log('codek debug session smoke done')",
      "}, 5000)",
      "",
    ].join("\n"),
    "utf-8",
  )
  fs.writeFileSync(path.join(vscodeDir, "launch.json"), JSON.stringify({
    version: "0.2.0",
    configurations: [{
      name: "Electron Smoke: Debug Session",
      type: "node",
      request: "launch",
      program,
      cwd: projectRoot,
    }],
  }, null, 2) + "\n", "utf-8")
  return { projectRoot, program }
}

function prepareSmokeArtifactOpenProject() {
  const projectRoot = path.join(CODEK_DATA, "electron-smoke-artifact-open-project")
  const extensionSrcDir = path.join(projectRoot, "vendored-vscode", ".build", "builtInExtensions", "ms-vscode.js-debug", "src")
  const extensionUiDir = path.join(extensionSrcDir, "ui")
  fs.rmSync(projectRoot, { recursive: true, force: true })
  fs.mkdirSync(extensionUiDir, { recursive: true })
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "codek-smoke-artifact-open-project",
    private: true,
  }, null, 2) + "\n", "utf-8")
  fs.writeFileSync(
    path.join(extensionUiDir, "basic-wat.configuration.json"),
    JSON.stringify({
      comments: { lineComment: ";;" },
      brackets: [["(", ")"]],
      smokeMarker: "basic wat configuration text opens after artifacts",
    }, null, 2) + "\n",
    "utf-8",
  )
  fs.writeFileSync(
    path.join(extensionUiDir, "basic-wat.tmLanguage.json"),
    JSON.stringify({
      scopeName: "source.wat",
      patterns: [{ name: "keyword.control.wat", match: "\\b(module|func)\\b" }],
      smokeMarker: "tm language text opens after artifacts",
    }, null, 2) + "\n",
    "utf-8",
  )
  fs.writeFileSync(
    path.join(extensionSrcDir, "extension.js"),
    [
      "export function activate() {",
      "  return \"js debug extension smoke text opens after artifacts\"",
      "}",
      "",
    ].join("\n"),
    "utf-8",
  )
  fs.writeFileSync(path.join(extensionSrcDir, "chromehash_bg.wasm"), Buffer.alloc(512 * 1024, 0))
  fs.writeFileSync(path.join(extensionSrcDir, "win32-app-container-tokens.win32-x64-msvc.node"), Buffer.alloc(384 * 1024, 1))
  fs.writeFileSync(path.join(extensionSrcDir, "chrome_100_percent.pak"), Buffer.alloc(64 * 1024 * 1024, 2))
  fs.writeFileSync(path.join(extensionSrcDir, "ui-preview.png"), Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00,
  ]))

  return {
    projectRoot,
    binaryFiles: [
      "vendored-vscode/.build/builtInExtensions/ms-vscode.js-debug/src/chromehash_bg.wasm",
      "vendored-vscode/.build/builtInExtensions/ms-vscode.js-debug/src/win32-app-container-tokens.win32-x64-msvc.node",
      "vendored-vscode/.build/builtInExtensions/ms-vscode.js-debug/src/chrome_100_percent.pak",
      "vendored-vscode/.build/builtInExtensions/ms-vscode.js-debug/src/ui-preview.png",
    ],
    textFiles: [
      "vendored-vscode/.build/builtInExtensions/ms-vscode.js-debug/src/ui/basic-wat.configuration.json",
      "vendored-vscode/.build/builtInExtensions/ms-vscode.js-debug/src/ui/basic-wat.tmLanguage.json",
      "vendored-vscode/.build/builtInExtensions/ms-vscode.js-debug/src/extension.js",
    ],
  }
}

function prepareSmokeMultiRootCreateTargetProject() {
  const workspaceRoot = path.join(CODEK_DATA, "electron-smoke-multiroot-create-target")
  const appsRoot = path.join(workspaceRoot, "apps", "client")
  const libsRoot = path.join(workspaceRoot, "libs", "client")
  fs.rmSync(workspaceRoot, { recursive: true, force: true })
  fs.mkdirSync(path.join(appsRoot, "src"), { recursive: true })
  fs.mkdirSync(path.join(libsRoot, "src"), { recursive: true })
  fs.writeFileSync(path.join(appsRoot, "package.json"), JSON.stringify({
    name: "codek-smoke-app-client",
    private: true,
  }, null, 2), "utf-8")
  fs.writeFileSync(path.join(libsRoot, "package.json"), JSON.stringify({
    name: "codek-smoke-lib-client",
    private: true,
  }, null, 2), "utf-8")
  fs.writeFileSync(path.join(appsRoot, "src", "app.ts"), "export const appRoot = true\n", "utf-8")
  fs.writeFileSync(path.join(libsRoot, "src", "lib.ts"), "export const libRoot = true\n", "utf-8")
  const workspaceFile = path.join(workspaceRoot, "codek-multiroot.code-workspace")
  fs.writeFileSync(workspaceFile, buildWorkspaceContent([appsRoot, libsRoot], {}), "utf-8")
  return {
    workspaceRoot,
    workspaceFile,
    appsRoot,
    libsRoot,
    selectedFile: path.join(appsRoot, "src", "created-from-selected.ts"),
    selectedFolder: path.join(appsRoot, "src", "generated-from-selected"),
    wrongFileInLibs: path.join(libsRoot, "src", "created-from-selected.ts"),
    wrongFolderInLibs: path.join(libsRoot, "src", "generated-from-selected"),
  }
}

function httpGet(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(res.statusCode < 500)
    })
    req.on("error", () => resolve(false))
    req.setTimeout(3000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitForService(url, timeoutMs = 30000, intervalMs = 800) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await httpGet(url)) return true
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return false
}

function log(message) {
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] ${message}\n`
  try {
    fs.appendFileSync(path.join(CODEK_LOGS, "codek.log"), line)
  } catch {
    // ignore
  }
  console.log(line.trim())
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForServicesReady(timeoutMs = 8000) {
  if (servicesReady) return true
  if (!serviceStartupPromise) startServiceRegistration()
  if (!serviceStartupPromise) return false
  let timeout = null
  try {
    await Promise.race([
      serviceStartupPromise,
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } catch {
    return false
  } finally {
    if (timeout) clearTimeout(timeout)
  }
  return servicesReady
}

function broadcastUserDataProfileChange(payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win || win.isDestroyed()) continue
    try {
      win.webContents.send("userDataProfile:changed", payload)
    } catch (error) {
      log(`Failed to broadcast user data profile change: ${error?.message || error}`)
    }
  }
}

function broadcastUserSettingsChange(payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win || win.isDestroyed()) continue
    try {
      win.webContents.send("settings:changed", payload)
    } catch (error) {
      log(`Failed to broadcast settings change: ${error?.message || error}`)
    }
  }
}

function startServiceRegistration() {
  if (serviceStartupPromise) return serviceStartupPromise
  serviceStartupScheduled = true
  serviceStartupPromise = (async () => {
    try {
      const startedAt = Date.now()
      const { registerServices } = require("./services")
      serviceStartupStats = await registerServices({
        getWorkspaceState,
        onDidChangeUserSettings: broadcastUserSettingsChange,
        onDidChangeWorkbenchProfiles: broadcastUserDataProfileChange,
      })
      servicesReady = true
      serviceStartupError = null
      const durationMs = Date.now() - startedAt
      writeElectronSmokeStage("services-registered", {
        durationMs,
        routeCount: serviceStartupStats?.routeCount,
        slowModules: (serviceStartupStats?.timings || [])
          .filter((item) => Number(item.durationMs || 0) >= 250)
          .slice(-8),
      })
      log(`In-process services registered in ${durationMs}ms.`)
      const slowModules = (serviceStartupStats?.timings || []).filter((item) => Number(item.durationMs || 0) >= 250)
      if (slowModules.length) {
        log(`Slow service modules: ${slowModules.map((item) => `${item.module}=${item.durationMs}ms`).join(", ")}`)
      }
      log("Codek ready.")
      return serviceStartupStats
    } catch (err) {
      serviceStartupError = err
      servicesReady = false
      writeElectronSmokeStage("services-register-failed", { error: String(err?.message || err) })
      log(`Failed to start in-process services: ${err.message}`)
      return null
    }
  })()
  return serviceStartupPromise
}

function scheduleServiceRegistration(delayMs = 0) {
  if (serviceStartupScheduled || serviceStartupPromise) return
  serviceStartupScheduled = true
  setTimeout(() => {
    startServiceRegistration()
  }, delayMs)
}

function getBundledJavaBin() {
  return null
}

async function startBackend() {
  return true
}

async function startOllama() {
  log("Checking Ollama...")

  const alreadyRunning = await httpGet(OLLAMA_BASE_URL)
  if (alreadyRunning) {
    log("Ollama is already running.")
    return true
  }

  log("Starting Ollama service...")

  const ollamaCmd = isWindows ? "ollama.exe" : "ollama"

  const ollamaProcess = spawn(ollamaCmd, ["serve"], {
    stdio: "ignore",
    detached: false,
  })

  ollamaProcess.on("error", () => {
    log("Ollama not found in PATH.")
  })

  ollamaProcess.unref()

  const ready = await waitForService(OLLAMA_BASE_URL, 15000, 1500)

  if (ready) {
    log("Ollama started successfully.")
    return true
  }

  log("Ollama not available.")
  return false
}

async function createMainWindow() {
  const smokeWindowWidth = Number(process.env.CODEK_ELECTRON_SMOKE_WIDTH || 0)
  const smokeWindowHeight = Number(process.env.CODEK_ELECTRON_SMOKE_HEIGHT || 0)
  mainWindow = new BrowserWindow({
    width: isSmoke && smokeWindowWidth ? smokeWindowWidth : 1400,
    height: isSmoke && smokeWindowHeight ? smokeWindowHeight : 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Codek",
    backgroundColor: "#1a1b2e",
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    titleBarOverlay: isMac
      ? undefined
      : {
          color: "#1a1b2e",
          symbolColor: "#d1d5db",
          height: 35,
        },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })

  const showMainWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (!mainWindow.isVisible()) {
      mainWindow.show()
    }
    mainWindow.focus()
  }

  setupMenu()

  mainWindow.once("ready-to-show", showMainWindow)
  mainWindow.webContents.once("did-finish-load", showMainWindow)
  registerWindowCloseLifecycle(mainWindow)

  if (autoOpenDevTools && !isSmoke) {
    mainWindow.webContents.openDevTools({ mode: "detach" })
  }

  if (isSmoke) {
    mainWindow.webContents.on("console-message", (details) => {
      const payload = {
        level: details.level,
        message: details.message,
        line: details.lineNumber,
        sourceId: details.sourceId,
      }
      console.log("[electron-smoke:console]", JSON.stringify(payload))
      const message = String(details.message || "")
      const searchNavigationPrefix = "[codek-smoke-search-navigation-stage]"
      if (message.startsWith(searchNavigationPrefix)) {
        try {
          const stagePayload = JSON.parse(message.slice(searchNavigationPrefix.length).trim())
          if (String(stagePayload?.stage || "").startsWith("working-copy-backup:")) {
            writeElectronSmokeStage(stagePayload.stage, stagePayload.detail || stagePayload)
          } else {
            writeElectronSmokeStage("renderer-search-navigation-stage", stagePayload)
          }
        } catch {
          // smoke diagnostics only
        }
      }
      const searchReplacePrefix = "[codek-smoke-search-replace-stage]"
      if (message.startsWith(searchReplacePrefix)) {
        try {
          const stagePayload = JSON.parse(message.slice(searchReplacePrefix.length).trim())
          if (String(stagePayload?.stage || "").startsWith("working-copy-backup:")) {
            writeElectronSmokeStage(stagePayload.stage, stagePayload.detail || stagePayload)
          } else {
            writeElectronSmokeStage("renderer-search-replace-stage", stagePayload)
          }
        } catch {
          // smoke diagnostics only
        }
      }
      const workingCopyHotExitPrefix = "[codek-smoke-working-copy-hot-exit-stage]"
      if (message.startsWith(workingCopyHotExitPrefix)) {
        try {
          const stagePayload = JSON.parse(message.slice(workingCopyHotExitPrefix.length).trim())
          if (String(stagePayload?.stage || "").startsWith("working-copy-backup:")) {
            writeElectronSmokeStage(stagePayload.stage, stagePayload.detail || stagePayload)
          } else {
            writeElectronSmokeStage("renderer-working-copy-hot-exit-stage", stagePayload)
          }
        } catch {
          // smoke diagnostics only
        }
      }
      const artifactOpenPrefix = "[codek-smoke-artifact-open-stage]"
      if (message.startsWith(artifactOpenPrefix)) {
        try {
          const stagePayload = JSON.parse(message.slice(artifactOpenPrefix.length).trim())
          writeElectronSmokeStage("renderer-artifact-open-stage", stagePayload)
        } catch {
          // smoke diagnostics only
        }
      }
      const realProjectUiPrefix = "[codek-smoke-real-project-ui-stage]"
      if (message.startsWith(realProjectUiPrefix)) {
        try {
          const stagePayload = JSON.parse(message.slice(realProjectUiPrefix.length).trim())
          writeElectronSmokeStage("renderer-real-project-ui-stage", stagePayload)
        } catch {
          // smoke diagnostics only
        }
      }
      const iconVisualPrefix = "[codek-smoke-icon-stage]"
      if (message.startsWith(iconVisualPrefix)) {
        try {
          const stagePayload = JSON.parse(message.slice(iconVisualPrefix.length).trim())
          writeElectronSmokeStage("renderer-icon-stage", stagePayload)
          if (stagePayload?.stage === "complete") {
            latestIconVisualCompletePayload = stagePayload
            for (const resolve of iconVisualCompleteWaiters.splice(0)) {
              try {
                resolve(stagePayload)
              } catch {}
            }
          }
        } catch {
          // smoke diagnostics only
        }
      }
      const preloadPrefix = "[codek-smoke-preload-stage]"
      if (message.startsWith(preloadPrefix)) {
        try {
          const stagePayload = JSON.parse(message.slice(preloadPrefix.length).trim())
          writeElectronSmokeStage("preload-stage", stagePayload)
        } catch {
          // smoke diagnostics only
        }
      }
    })
    mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      console.error("[electron-smoke:did-fail-load]", JSON.stringify({ errorCode, errorDescription, validatedURL }))
    })
    mainWindow.webContents.on("render-process-gone", (_event, details) => {
      console.error("[electron-smoke:render-process-gone]", JSON.stringify(details))
    })
    mainWindow.webContents.once("did-finish-load", () => {
      writeElectronSmokeStage("did-finish-load")
      if (isStartupSmoke) {
        runElectronStartupSmokeChecks(mainWindow)
      } else {
        runElectronSmokeChecks(mainWindow)
      }
    })
  }

  const frontendPath = getFrontendPath()
  writeElectronSmokeStage("load-frontend", {
    frontendPath,
    exists: typeof frontendPath === "string" && !frontendPath.startsWith("http") ? fs.existsSync(frontendPath) : true,
    isPackaged: app.isPackaged,
    useDevServer,
  })
  const frontendLoad = await loadFrontendIntoWindow(mainWindow, frontendPath)
  writeElectronSmokeStage("load-frontend-complete", frontendLoad)

  mainWindow.on("closed", () => {
    mainWindow = null
  })

  return mainWindow
}

async function prepareElectronSmokeLogin(win) {
  if (process.env.CODEK_ELECTRON_SMOKE_LOGIN_WORKBENCH !== "1") return
  const smokeEmailDomain = process.env.CODEK_ELECTRON_SMOKE_EMAIL_DOMAIN || "codek-smoke.local"
  const smokeEmail = `smoke-${Date.now()}@${smokeEmailDomain}`
  const authService = require("./services/auth")
  const authResult = await authService.loginOrCreateOAuth("smoke", `electron-${Date.now()}-${process.pid}`, smokeEmail)
  if (!authResult || !authResult.success || !authResult.token) {
    throw new Error(`smoke login failed: ${authResult?.error || "unknown"}`)
  }
  const serviceReady = await waitForServicesReady(15000)
  if (!serviceReady) {
    throw new Error("smoke login routes were not ready before renderer auto-login")
  }
  const reloadPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("smoke login reload timeout"))
    }, 10000)
    const cleanup = () => {
      clearTimeout(timer)
      win.webContents.removeListener("did-finish-load", onLoad)
      win.webContents.removeListener("did-fail-load", onFail)
    }
    const onLoad = () => {
      cleanup()
      resolve(true)
    }
    const onFail = (_event, _errorCode, errorDescription) => {
      cleanup()
      reject(new Error(`smoke login reload failed: ${errorDescription || "unknown"}`))
    }
    win.webContents.once("did-finish-load", onLoad)
    win.webContents.once("did-fail-load", onFail)
  })
  await win.webContents.executeJavaScript(`
    (async () => {
      if (localStorage.getItem("codek.auth.token")) {
        localStorage.setItem("codek.auth.rememberMe", "1")
        localStorage.setItem("codek.auth.autoLogin", "1")
        location.reload()
        return true
      }
      const data = ${JSON.stringify(authResult)}
      localStorage.setItem("codek.auth.token", data.token)
      localStorage.setItem("codek.auth.username", data.username || ${JSON.stringify(smokeEmail)})
      localStorage.setItem("codek.auth.email", data.email || ${JSON.stringify(smokeEmail)})
      localStorage.setItem("codek.auth.rememberMe", "1")
      localStorage.setItem("codek.auth.autoLogin", "1")
      location.reload()
      return true
    })()
  `)
  await reloadPromise
}

async function prepareSpecialElectronSmokeWorkspace() {
  if (isMultiRootCreateTargetSmoke) {
    electronSmokeMultiRootCreateTargetFixture = prepareSmokeMultiRootCreateTargetProject()
    currentProjectRoot = electronSmokeMultiRootCreateTargetFixture.appsRoot
    currentWorkspaceRoots = [
      electronSmokeMultiRootCreateTargetFixture.appsRoot,
      electronSmokeMultiRootCreateTargetFixture.libsRoot,
    ]
    currentWorkspaceFile = electronSmokeMultiRootCreateTargetFixture.workspaceFile
    await startFileWatcher(currentProjectRoot)
  }
  if (isDebugSessionSmoke) {
    const fixture = prepareSmokeDebugSessionProject()
    currentProjectRoot = fixture.projectRoot
    currentWorkspaceRoots = [fixture.projectRoot]
    currentWorkspaceFile = null
    await startFileWatcher(currentProjectRoot)
  }
}

async function exerciseElectronSmokeWorkbench(win) {
  if (process.env.CODEK_ELECTRON_SMOKE_LOGIN_WORKBENCH !== "1") return
  if (process.env.CODEK_ELECTRON_SMOKE_ANALYSIS_WORKSPACE === "1") return
  if (isExplorerPerformanceSmoke) return
  if (isRealExplorerSmoke) return
  if (isExplorerStressSmoke) return
  if (isFileOperationVisibilitySmoke) return
  if (isSearchReplaceSmoke) return
  if (isEditorOpenFilesSmoke) return
  if (isSearchNavigationSmoke) return
  if (isArtifactOpenSmoke) return
  if (isTabOverflowSmoke) return
  if (isIconThemeRefreshSmoke) return
  if (isIconVisualStateSmoke) return
  if (isRealProjectUiSmoke) return
  if (isWorkbenchUiAuditSmoke) return
  if (isNotificationActionsClickSmoke) return
  if (isTaskProviderExecuteSmoke) return
  if (isTaskProviderBackgroundOwnerSmoke) return
  if (isDebugOutputBridgeSmoke) return
  if (isOutputLogSmoke) return
  if (isDebugSessionSmoke) return
  if (isTestingPublishResultsSmoke) return
  if (isNotebookMarkdownPreviewSmoke) return
  if (isAccessibleViewVisibleOwnerSmoke) return
  if (isWorkspaceTrustDowngradeRestartSmoke) return
  if (isWorkspaceTrustRequestDialogSmoke) return
  if (isWorkspaceTrustEditorSmoke) return
  if (isExtensionInstallConfirmationSmoke) return
  if (isExtensionHostRestartSmoke) return
  if (isWorkingCopyHotExitSmoke) return
  if (isMultiRootCreateTargetSmoke) return
  if (isInlineCreateFocusSmoke) return
  await win.webContents.executeJavaScript(`
    (async () => {
      const waitFor = (selector, timeout = 10000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = () => {
          const node = document.querySelector(selector)
          if (node) {
            resolve(node)
            return
          }
          if (Date.now() - started > timeout) {
            reject(new Error("smoke selector timeout: " + selector))
            return
          }
          setTimeout(tick, 100)
        }
        tick()
      })
      const waitForEnabled = (selector, timeout = 10000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = () => {
          const node = document.querySelector(selector)
          if (node && !node.disabled) {
            resolve(node)
            return
          }
          if (Date.now() - started > timeout) {
            reject(new Error("smoke enabled selector timeout: " + selector))
            return
          }
          setTimeout(tick, 100)
        }
        tick()
      })
      const waitForState = (predicate, label, timeout = 10000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = () => {
          try {
            const result = predicate()
            if (result) {
              resolve(result)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            const detail = window.__codekSmokeWorkbenchControls?.editorFileSurface
            reject(new Error("smoke state timeout: " + label + (detail ? " " + JSON.stringify(detail) : "")))
            return
          }
          setTimeout(tick, 100)
        }
        tick()
      })
      const openTaskCenter = async () => {
        if (!document.querySelector('[data-codek-smoke="task-center-panel"]')) {
          const button = document.querySelector('[aria-label="任务"]') || document.querySelector('[title="任务"]')
          if (button) button.click()
        }
        await waitFor('[data-codek-smoke="task-center-panel"]')
        await waitFor('[data-codek-smoke="task-center-summary"]')
        await waitFor('[data-codek-smoke="task-center-row"]')
      }

      await waitFor(".menu-bar.caption-overlay")
      await waitForState(() => {
        const menuRight = document.querySelector(".menu-bar-right")
        const bar = document.querySelector(".menu-bar")
        if (!menuRight || !bar) return false
        const rightRect = menuRight.getBoundingClientRect()
        const barRect = bar.getBoundingClientRect()
        const reservedWidth = Number.parseFloat(getComputedStyle(bar).getPropertyValue("--codek-caption-button-width")) || 138
        return rightRect.right <= barRect.right - reservedWidth + 1
      }, "titlebar caption inset")

      const filesButton = await waitFor('[data-codek-smoke="open-explorer"]')
      if (!document.querySelector(".sidebar")) filesButton.click()
      await waitFor(".sidebar")
      {
        const extensionsButton = await waitFor('[data-codek-smoke="open-extensions"]')
        extensionsButton.click()
        await waitFor('[data-codek-smoke="sidebar-panel"]')
        await waitFor('[data-codek-smoke="extensions-search-input"]')
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const sidebar = document.querySelector('[data-codek-smoke="sidebar-panel"]')
        const marketplaceSearch = document.querySelector('[data-codek-smoke="extensions-search-input"]')
        const sidebarRect = sidebar?.getBoundingClientRect()
        const searchRect = marketplaceSearch?.getBoundingClientRect()
        window.__codekSmokeWorkbenchControls = {
          ...(window.__codekSmokeWorkbenchControls || {}),
          sidebarLayoutRect: {
            hasSidebar: Boolean(sidebar),
            hasMarketplaceSearch: Boolean(marketplaceSearch),
            sidebarWidth: sidebarRect ? Math.round(sidebarRect.width) : 0,
            searchWithinSidebar: Boolean(searchRect && sidebarRect && searchRect.left >= sidebarRect.left - 1 && searchRect.right <= sidebarRect.right + 1),
          },
        }
        filesButton.click()
        await waitFor('[data-codek-smoke="create-java-project"]')
      }
      const createJavaButton = await waitFor('[data-codek-smoke="create-java-project"]')
      createJavaButton.click()
      await waitForState(() => Array.from(document.querySelectorAll(".tab-name")).some((node) => node.textContent && node.textContent.includes("Main.java")), "java project tab")
      await waitForState(() => {
        const lineNumber = document.querySelector(".editor-container .monaco-editor .line-numbers")
        const tab = document.querySelector(".tab.active")
        const tabIcon = tab?.querySelector(".file-icon-svg")
        const explorerHost = document.querySelector('[data-codek-smoke="native-explorer-host"]')
        const explorerRow = document.querySelector(".codek-explorer-row.active, .codek-explorer-row.selected")
        const memoryFileRow = document.querySelector(".memory-files .file-item.active, .memory-files .file-item")
        const lineRect = lineNumber?.getBoundingClientRect()
        const tabRect = tab?.getBoundingClientRect()
        window.__codekSmokeWorkbenchControls = {
          ...(window.__codekSmokeWorkbenchControls || {}),
          editorFileSurface: {
            hasLineNumber: Boolean(lineNumber && lineRect && lineRect.width > 0 && lineRect.height > 0),
            hasActiveTab: Boolean(tab && tabRect && tabRect.width > 0 && tabRect.height > 0),
            hasTabIcon: Boolean(tabIcon),
            hasExplorerHost: Boolean(explorerHost),
            hasExplorerSelection: Boolean(explorerRow),
            hasMemoryFileRow: Boolean(memoryFileRow),
          },
        }
        return Boolean(lineNumber && tab && tabIcon)
      }, "editor line numbers and file surface")
      const tabCloseButton = await waitFor('[data-codek-smoke="tab-close"]')
      tabCloseButton.click()
      await waitFor(".welcome-page")
      await waitForState(() => !document.querySelector('[data-codek-smoke="breadcrumb-bar"]'), "breadcrumb cleared after closing java tab")

      if (!document.querySelector(".chat-panel.open")) {
        await window.__codekSmokeWorkbenchControls?.openChat?.()
      }
      await waitFor(".chat-panel.open")
      const chatInput = await waitFor('[data-codek-smoke="chat-input"]')
      await window.__codekSmokeWorkbenchControls?.openOutputPanel?.()
      if (!document.querySelector('[data-codek-smoke="bottom-panel"]')) {
        const outputToggle = document.querySelector('[data-codek-smoke="status-output-toggle"]')
        if (outputToggle) outputToggle.click()
      }
      await waitFor('[data-codek-smoke="bottom-panel"]')
      await waitFor('[data-codek-smoke="output-panel"]')
      window.__codekSmokeWorkbenchControls = {
        ...(window.__codekSmokeWorkbenchControls || {}),
        bottomPanel: {
          hasBottomPanel: Boolean(document.querySelector('[data-codek-smoke="bottom-panel"]')),
          hasOutputPanel: Boolean(document.querySelector('[data-codek-smoke="output-panel"]')),
        },
      }

      const modeTrigger = await waitFor('[data-codek-smoke="chat-mode-trigger"]')
      modeTrigger.click()
      const agentMode = await waitFor('[data-codek-smoke="chat-mode-agent"]')
      agentMode.click()
      chatInput.value = "修复 smoke 任务入口并运行 typecheck"
      chatInput.dispatchEvent(new Event("input", { bubbles: true }))
      chatInput.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }))
      await waitForState(() => document.body.innerText.includes("已进入任务中心"), "chat task accepted message")

      await openTaskCenter()
      await new Promise((resolve) => setTimeout(resolve, 500))
      {
        const panel = document.querySelector(".chat-panel.open")
        if (panel) {
          panel.style.width = "480px"
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        }
        const composer = document.querySelector(".chat-composer")
        const modelSelect = document.querySelector(".chat-model-picker .model-select")
        const composerRight = document.querySelector(".composer-right")
        const composerBottom = document.querySelector(".composer-bottom")
        const modelTools = document.querySelector(".composer-model-tools")
        const sendButton = document.querySelector(".chat-send-btn")
        const voiceButton = document.querySelector(".voice-btn")
        const sandboxBar = document.querySelector(".sandbox-mode-bar")
        const sandboxSummary = document.querySelector(".smb-summary")
        const panelRect = panel?.getBoundingClientRect()
        const composerRect = composer?.getBoundingClientRect()
        const bottomRect = composerBottom?.getBoundingClientRect()
        const modelRect = modelSelect?.getBoundingClientRect()
        const modelToolsRect = modelTools?.getBoundingClientRect()
        const rightRect = composerRight?.getBoundingClientRect()
        const sendRect = sendButton?.getBoundingClientRect()
        const voiceRect = voiceButton?.getBoundingClientRect()
        const sandboxRect = sandboxBar?.getBoundingClientRect()
        const sandboxSummaryRect = sandboxSummary?.getBoundingClientRect()
        const within = (child, parent) => Boolean(child && parent &&
          child.left >= parent.left - 1 &&
          child.right <= parent.right + 1 &&
          child.top >= parent.top - 1 &&
          child.bottom <= parent.bottom + 1)
        window.__codekSmokeWorkbenchControls = {
          ...(window.__codekSmokeWorkbenchControls || {}),
          chatLayoutRect: {
            hasPanel: Boolean(panel),
            hasComposer: Boolean(composer),
            hasModelSelect: Boolean(modelSelect),
            hasComposerRight: Boolean(composerRight),
            hasSandboxBar: Boolean(sandboxBar),
            hasSandboxSummary: Boolean(sandboxSummary),
            hasSendButton: Boolean(sendButton),
            hasVoiceButton: Boolean(voiceButton),
            panelWidth: panelRect ? Math.round(panelRect.width) : 0,
            composerWidth: composerRect ? Math.round(composerRect.width) : 0,
            bottomWidth: bottomRect ? Math.round(bottomRect.width) : 0,
            modelWidth: modelRect ? Math.round(modelRect.width) : 0,
            modelRight: modelRect ? Math.round(modelRect.right) : 0,
            modelToolsRight: modelToolsRect ? Math.round(modelToolsRect.right) : 0,
            rightLeft: rightRect ? Math.round(rightRect.left) : 0,
            modelTop: modelRect ? Math.round(modelRect.top) : 0,
            rightTop: rightRect ? Math.round(rightRect.top) : 0,
            sendWidth: sendRect ? Math.round(sendRect.width) : 0,
            sendRight: sendRect ? Math.round(sendRect.right) : 0,
            voiceRight: voiceRect ? Math.round(voiceRect.right) : 0,
            sandboxHeight: sandboxRect ? Math.round(sandboxRect.height) : 0,
            sandboxSummaryWidth: sandboxSummaryRect ? Math.round(sandboxSummaryRect.width) : 0,
            sendWithinPanel: within(sendRect, panelRect),
            rightWithinComposer: within(rightRect, composerRect),
            summaryWithinSandbox: within(sandboxSummaryRect, sandboxRect),
          },
        }
      }
      window.__codekSmokeWorkbenchControls = {
        ...(window.__codekSmokeWorkbenchControls || {}),
        taskCreated: true,
        taskCenter: true,
        chatLayout: Boolean(
          window.__codekSmokeWorkbenchControls?.chatLayoutRect?.panelWidth >= 480 &&
          window.__codekSmokeWorkbenchControls?.chatLayoutRect?.sendWidth >= 30 &&
          window.__codekSmokeWorkbenchControls?.chatLayoutRect?.sendWithinPanel &&
          window.__codekSmokeWorkbenchControls?.chatLayoutRect?.rightWithinComposer &&
          window.__codekSmokeWorkbenchControls?.chatLayoutRect?.modelRight <= window.__codekSmokeWorkbenchControls?.chatLayoutRect?.rightLeft - 4 &&
          Math.abs(window.__codekSmokeWorkbenchControls?.chatLayoutRect?.modelTop - window.__codekSmokeWorkbenchControls?.chatLayoutRect?.rightTop) <= 4
        ),
        sandboxModeBar: Boolean(
          window.__codekSmokeWorkbenchControls?.chatLayoutRect?.hasSandboxBar &&
          window.__codekSmokeWorkbenchControls?.chatLayoutRect?.hasSandboxSummary &&
          window.__codekSmokeWorkbenchControls?.chatLayoutRect?.summaryWithinSandbox
        ),
      }
      return

      const createdTasks = await window.codek.api("GET", "/api/orchestrator/tasks")
      const createdTaskData = createdTasks && createdTasks.data ? createdTasks.data : createdTasks
      if (!createdTaskData || !Array.isArray(createdTaskData.tasks) || createdTaskData.tasks.length < 1) {
        throw new Error("smoke orchestrator task entry failed")
      }
      const permissionFixture = await window.codek.api("POST", "/api/orchestrator/tasks", {
        message: "删除 smoke 临时目录并安装依赖",
        mode: "agent",
        projectRoot: "D:/Workspace",
        files: ["smoke-temp"],
      })
      const permissionData = permissionFixture && permissionFixture.data ? permissionFixture.data : permissionFixture
      if (!permissionData || !permissionData.run || !permissionData.run.permissionRequest) {
        throw new Error("smoke permission request fixture failed")
      }
      const permissionRunId = permissionData.run.id

      await openTaskCenter()
      const taskCenterRow = document.querySelector('[data-codek-goal-run-id="' + permissionRunId + '"] .goal-main') ||
        document.querySelector('[data-codek-smoke="task-center-row"] .goal-main')
      if (taskCenterRow) taskCenterRow.click()
      await waitFor('[data-codek-smoke="orchestrator-panel"]')
      const permissionRunRow = await waitFor('[data-codek-run-id="' + permissionRunId + '"]')
      permissionRunRow.click()
      await waitFor('[data-codek-smoke="orchestrator-router-decision"]')
      await waitFor('[data-codek-smoke="orchestrator-permission-request"]')
      await waitFor('[data-codek-smoke="command-authorization-panel"]')

      let acceptRollbackRunId = ""
      let rejectRunId = ""
      if (window.codek && typeof window.codek.api === "function") {
        await window.codek.api("POST", "/api/orchestrator/evals/run", {})
        await window.codek.api("POST", "/api/orchestrator/acceptance/run", {})
        await window.codek.api("POST", "/api/orchestrator/smoke/release-gate-fixture", {})
        const fixture = await window.codek.api("POST", "/api/orchestrator/smoke/fixture", {})
        const fixtureData = fixture && fixture.data ? fixture.data : fixture
        if (!fixtureData || !fixtureData.run || !fixtureData.run.integrationDecision) {
          throw new Error("smoke orchestrator fixture failed")
        }
        acceptRollbackRunId = fixtureData.run.id
      }

      const refreshButton = document.querySelector('[data-codek-smoke="orchestrator-refresh"]')
      if (refreshButton) refreshButton.click()
      await waitFor('[data-codek-smoke="orchestrator-panel"]')
      await waitForState(() => Boolean(document.querySelector('[data-codek-smoke="release-gate-summary"]')), "release gate summary")
      await waitFor('[data-codek-smoke="acceptance-matrix-summary"]')
      await waitFor('[data-codek-smoke="acceptance-matrix-row"]')
      await waitFor('[data-codek-smoke="acceptance-task-set"]')
      await waitFor('[data-codek-smoke="acceptance-comparison-export"]')
      await waitFor('[data-codek-smoke="acceptance-scenario-groups"]')
      await waitFor('[data-codek-smoke="acceptance-router-data"]')
      await waitFor('[data-codek-smoke="acceptance-history-summary"]')
      await waitFor('[data-codek-smoke="acceptance-history-row"]')
      await waitFor('[data-codek-smoke="release-gate-panel"]')
      await waitFor('[data-codek-smoke="release-gate-summary"]')
      await waitFor('[data-codek-smoke="release-gate-step"]')
      window.__codekSmokeWorkbenchControls = {
        ...(window.__codekSmokeWorkbenchControls || {}),
        acceptanceMatrix: true,
        acceptanceTaskSet: true,
        acceptanceComparison: true,
        acceptanceScenarioGroups: true,
        acceptanceRouterData: true,
        acceptanceHistory: true,
        releaseGatePanel: true,
      }
      const runRow = await waitFor('[data-codek-run-id="' + acceptRollbackRunId + '"]')
      runRow.click()
      await waitFor('[data-codek-smoke="integration-decision"]')
      window.__codekSmokeJControls = {
        ...(window.__codekSmokeJControls || {}),
        integrationDecision: true,
      }
      await waitFor('[data-codek-smoke="command-authorization-panel"]')
      window.__codekSmokeJControls = {
        ...(window.__codekSmokeJControls || {}),
        commandAuthorization: true,
      }
      const saveReportButton = await waitForEnabled('[data-codek-smoke="save-run-task-report"]')
      saveReportButton.click()
      await waitFor('[data-codek-smoke="run-task-report-saved"]')
      window.__codekSmokeJControls = {
        ...(window.__codekSmokeJControls || {}),
        reportSaved: true,
      }
      await waitFor('[data-codek-smoke="agent-diff-viewer"]')
      const diffButton = await waitFor('[data-codek-smoke="load-orchestrator-diff"]')
      diffButton.click()
      await waitFor('[data-codek-smoke="agent-diff-totals"]')
      window.__codekSmokeJControls = {
        ...(window.__codekSmokeJControls || {}),
        diffTotals: true,
      }
      await new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = () => {
          const text = document.body ? document.body.innerText : ""
          if (text.includes("demo.js") && text.includes("smokeValue")) {
            resolve(true)
            return
          }
          if (Date.now() - started > 10000) {
            reject(new Error("smoke diff content timeout"))
            return
          }
          setTimeout(tick, 100)
        }
        tick()
      })
      const acceptButton = await waitForEnabled('[data-codek-smoke="decision-accept"]')
      window.__codekSmokeJControls = {
        ...(window.__codekSmokeJControls || {}),
        decisionActions: true,
      }
      acceptButton.click()
      await new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const fileResult = await window.codek.api("GET", "/api/orchestrator/smoke/fixture/" + encodeURIComponent(acceptRollbackRunId) + "/file?file=demo.js")
            const fileData = fileResult && fileResult.data ? fileResult.data : fileResult
            if ((fileData.file && fileData.file.content || "").replace(/\\r\\n/g, "\\n").includes("smokeValue = 2")) {
              resolve(true)
              return
            }
          } catch {}
          if (Date.now() - started > 10000) {
            reject(new Error("smoke accept file content timeout"))
            return
          }
          setTimeout(tick, 150)
        }
        tick()
      })
      const rollbackButton = await waitForEnabled('[data-codek-smoke="decision-rollback"]')
      rollbackButton.click()
      await new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const fileResult = await window.codek.api("GET", "/api/orchestrator/smoke/fixture/" + encodeURIComponent(acceptRollbackRunId) + "/file?file=demo.js")
            const fileData = fileResult && fileResult.data ? fileResult.data : fileResult
            if ((fileData.file && fileData.file.content || "").replace(/\\r\\n/g, "\\n").includes("smokeValue = 1")) {
              resolve(true)
              return
            }
          } catch {}
          if (Date.now() - started > 10000) {
            reject(new Error("smoke rollback file content timeout"))
            return
          }
          setTimeout(tick, 150)
        }
        tick()
      })

      if (window.codek && typeof window.codek.api === "function") {
        const rejectFixture = await window.codek.api("POST", "/api/orchestrator/smoke/fixture", {})
        const rejectData = rejectFixture && rejectFixture.data ? rejectFixture.data : rejectFixture
        rejectRunId = rejectData.run && rejectData.run.id
      }
      if (refreshButton) refreshButton.click()
      const rejectRow = await waitFor('[data-codek-run-id="' + rejectRunId + '"]')
      rejectRow.click()
      await waitFor('[data-codek-smoke="integration-decision"]')
      window.__codekSmokeJControls = {
        ...(window.__codekSmokeJControls || {}),
        integrationDecision: true,
      }
      const rejectButton = await waitForEnabled('[data-codek-smoke="decision-reject"]')
      window.__codekSmokeJControls = {
        ...(window.__codekSmokeJControls || {}),
        decisionActions: true,
      }
      rejectButton.click()
      await new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const runResult = await window.codek.api("GET", "/api/orchestrator/runs/" + encodeURIComponent(rejectRunId))
            const runData = runResult && runResult.data ? runResult.data : runResult
            const fileResult = await window.codek.api("GET", "/api/orchestrator/smoke/fixture/" + encodeURIComponent(rejectRunId) + "/file?file=demo.js")
            const fileData = fileResult && fileResult.data ? fileResult.data : fileResult
            const content = (fileData.file && fileData.file.content || "").replace(/\\r\\n/g, "\\n")
            if (runData.run && runData.run.status === "cancelled" && content.includes("smokeValue = 1")) {
              resolve(true)
              return
            }
          } catch {}
          if (Date.now() - started > 10000) {
            reject(new Error("smoke reject decision timeout"))
            return
          }
          setTimeout(tick, 150)
        }
        tick()
      })

      if (window.codek && typeof window.codek.api === "function") {
        const recoveryFixture = await window.codek.api("POST", "/api/orchestrator/smoke/recovery-fixture", {})
        const recoveryData = recoveryFixture && recoveryFixture.data ? recoveryFixture.data : recoveryFixture
        const recoveryRunId = recoveryData.run && recoveryData.run.id
        if (refreshButton) refreshButton.click()
        const recoveryRow = await waitFor('[data-codek-run-id="' + recoveryRunId + '"]')
        recoveryRow.click()
        await waitFor('[data-codek-smoke="recovery-recommendation"]')
        window.__codekSmokeJControls = {
          ...(window.__codekSmokeJControls || {}),
          recoveryRecommendation: true,
        }
      }

      const settingsButton = await waitFor('[data-codek-smoke="open-settings"]')
      settingsButton.click()
      await waitFor(".settings-panel")
      const agentNav = Array.from(document.querySelectorAll(".settings-nav-item"))
        .find((node) => (node.textContent || "").includes("Agent"))
      if (!agentNav) throw new Error("settings agent nav not found")
      agentNav.click()
      await waitFor('[data-codek-smoke="real-workspace-trial-settings"]')
      const releaseNav = Array.from(document.querySelectorAll(".settings-nav-item"))
        .find((node) => (node.textContent || "").includes("发布与验收"))
      if (!releaseNav) throw new Error("settings release nav not found")
      releaseNav.click()
      await waitFor('[data-codek-smoke="settings-release-page"]')
      await waitFor('[data-codek-smoke="settings-readiness-summary"]')
      await waitFor('[data-codek-smoke="settings-release-evidence-export"]')
      await waitFor('[data-codek-smoke="settings-release-evidence-open"]')
      await waitFor('[data-codek-smoke="settings-release-evidence-gaps"]')
      await waitFor('[data-codek-smoke="settings-release-evidence-llm-usage"]')
      await waitFor('[data-codek-smoke="settings-release-evidence-llm-cost"]')
      await waitFor('[data-codek-smoke="settings-run-action-audit-summary"]')
      await waitFor('[data-codek-smoke="settings-release-gate"]')
      await waitFor('[data-codek-smoke="settings-acceptance-summary"]')
      await waitFor('[data-codek-smoke="settings-real-workspace-trial-summary"]')
      await waitFor('[data-codek-smoke="settings-release-ci"]')
      await waitFor('[data-codek-smoke="settings-release-ci-check"]')
      await waitFor('[data-codek-smoke="settings-release-ci-freshness"]')
      window.__codekSmokeWorkbenchControls = {
        ...(window.__codekSmokeWorkbenchControls || {}),
        realWorkspaceTrialSettings: true,
        settingsReleasePage: true,
        settingsReadinessSummary: true,
        settingsReleaseEvidenceExport: true,
        settingsReleaseEvidenceOpen: true,
        settingsReleaseEvidenceGaps: true,
        settingsReleaseEvidenceLlmUsage: true,
        settingsReleaseEvidenceLlmCost: true,
        settingsRunActionAuditSummary: true,
        settingsRealWorkspaceTrialSummary: true,
        settingsReleaseCiCheck: true,
        settingsReleaseCiFreshness: true,
      }
      return true
    })()
  `)
}

async function exerciseElectronSmokeAnalysisWorkspace(win) {
  if (process.env.CODEK_ELECTRON_SMOKE_ANALYSIS_WORKSPACE !== "1") return
  const projectRoot = prepareSmokeAnalysisProject()
  currentProjectRoot = projectRoot
  await startFileWatcher(currentProjectRoot)
  const payload = {
    root: projectRoot,
    file: "src/main.ts",
    diagnosticFile: "src/broken.ts",
  }
  await win.webContents.executeJavaScript(`
    (async () => {
      const waitFor = (selector, timeout = 15000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = () => {
          const node = document.querySelector(selector)
          if (node) {
            resolve(node)
            return
          }
          if (Date.now() - started > timeout) {
            reject(new Error("smoke selector timeout: " + selector))
            return
          }
          setTimeout(tick, 100)
        }
        tick()
      })
      const waitForState = (predicate, label, timeout = 20000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const result = await predicate()
            if (result) {
              resolve(result)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("smoke state timeout: " + label + " debug=" + JSON.stringify(window.__codekSmokeSearchReplaceDebug || {})))
            return
          }
          setTimeout(tick, 150)
        }
        tick()
      })

      await waitFor(".app-shell")
      await waitForState(() => typeof window.__codekSmokeOpenAnalysisWorkspace === "function", "analysis smoke bridge")
      await window.__codekSmokeOpenAnalysisWorkspace(${JSON.stringify(payload)})
      await waitFor('[data-codek-smoke="analysis-workspace-ready"]')
      await waitForState(async () => {
        const snapshot = await window.__codekSmokeAnalysisSnapshot?.()
        return snapshot && snapshot.projectRoot && snapshot.activeFile === "src/main.ts" && snapshot.outlineNames.includes("greet")
      }, "analysis outline")

      const symbolsButton = await waitFor('[data-codek-smoke="open-symbols"]')
      symbolsButton.click()
      await waitFor('[data-codek-smoke="symbols-panel"]')
      await waitForState(() => document.body.innerText.includes("greet"), "symbols panel greet")

      await waitForState(async () => {
        const snapshot = await window.__codekSmokeAnalysisSnapshot?.()
        return snapshot && snapshot.diagnostics.some((diag) => String(diag.file || "").endsWith("src/broken.ts"))
      }, "workspace diagnostics")

      await window.__codekSmokeWorkbenchControls?.openProblemsPanel?.()
      if (!document.querySelector('[data-codek-smoke="problems-panel"]')) {
        const problemsStatusButton = document.querySelector('[title*="errors"][title*="warnings"]')
        if (problemsStatusButton) problemsStatusButton.click()
      }
      await waitFor('[data-codek-smoke="problems-panel"]')

      const snapshot = await window.__codekSmokeAnalysisSnapshot?.()
      if (!snapshot) throw new Error("analysis snapshot unavailable")
      if (!snapshot.context.includes("ACTIVE FILE: src/main.ts")) {
        throw new Error("analysis context missing active file")
      }
      if (!snapshot.context.includes("greet") && !snapshot.context.includes("PROJECT SYMBOL MATCHES")) {
        throw new Error("analysis context missing symbols")
      }
      if (!snapshot.breadcrumbVisible && !snapshot.outlineNames.includes("greet")) {
        throw new Error("analysis breadcrumb state unavailable")
      }
      if (!snapshot.savedRefreshOk) {
        throw new Error("analysis save refresh did not complete")
      }
      return true
    })()
  `)
}

async function exerciseElectronSmokeExplorerPerformance(win) {
  if (!isExplorerPerformanceSmoke) return
  const fixture = prepareSmokeExplorerProject()
  electronSmokeExplorerReadDirCalls = []
  electronSmokeExplorerReadDirSamples = []
  electronSmokeExplorerReadDirInFlight = 0
  electronSmokeExplorerReadDirInFlightMax = 0
  currentProjectRoot = fixture.projectRoot
  currentWorkspaceRoots = [fixture.projectRoot]
  currentWorkspaceFile = null
  await startFileWatcher(currentProjectRoot)
  const rendererResult = await win.webContents.executeJavaScript(`
    (async () => {
      const waitForState = (predicate, label, timeout = 30000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("smoke state timeout: " + label))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })

      await waitForState(() => document.querySelector(".app-shell"), "app shell")
      await waitForState(() => typeof window.__codekSmokeExplorerPerformance === "function", "explorer performance bridge")
      const result = await window.__codekSmokeExplorerPerformance(${JSON.stringify({
        root: fixture.projectRoot,
        largeFile: fixture.largeFile,
        extremeFile: fixture.extremeFile,
      })})
      window.__codekSmokeExplorerPerformanceResult = result
      return result
    })()
  `)
  const uniqueReadDirCalls = [...new Set(electronSmokeExplorerReadDirCalls)]
  const refreshOk = electronSmokeExplorerReadDirCalls.length >= 2
  const workspaceScaleProfile = currentWorkspaceScaleProfile
  await win.webContents.executeJavaScript(`
    window.__codekSmokeExplorerPerformanceResult = {
      ...(window.__codekSmokeExplorerPerformanceResult || {}),
      workspaceScaleProfile: ${JSON.stringify(workspaceScaleProfile)},
      readDirCalls: ${JSON.stringify(uniqueReadDirCalls)},
      readDirSamples: ${JSON.stringify(electronSmokeExplorerReadDirSamples)},
      readDirCallCount: ${JSON.stringify(electronSmokeExplorerReadDirCalls.length)},
      uniqueReadDirCallCount: ${JSON.stringify(uniqueReadDirCalls.length)},
      readDirInFlightMax: ${JSON.stringify(electronSmokeExplorerReadDirInFlightMax)},
      refreshOk: ${JSON.stringify(refreshOk)}
    }
  `)
  return {
    ...rendererResult,
    workspaceScaleProfile,
    readDirCalls: uniqueReadDirCalls,
    readDirSamples: electronSmokeExplorerReadDirSamples,
    readDirCallCount: electronSmokeExplorerReadDirCalls.length,
    uniqueReadDirCallCount: uniqueReadDirCalls.length,
    readDirInFlightMax: electronSmokeExplorerReadDirInFlightMax,
    refreshOk,
  }
}

async function exerciseElectronSmokeRealExplorer(win) {
  if (!isRealExplorerSmoke) return
  const projectRoot = path.resolve(process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_ROOT || path.resolve(__dirname, ".."))
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`real explorer smoke root missing: ${projectRoot}`)
  }
  electronSmokeExplorerReadDirCalls = []
  electronSmokeExplorerReadDirSamples = []
  electronSmokeExplorerReadDirInFlight = 0
  electronSmokeExplorerReadDirInFlightMax = 0
  await setWorkspaceRoots([projectRoot], null)
  const expandPaths = [
    path.join(projectRoot, "vscode"),
    path.join(projectRoot, "vscode", "src"),
    path.join(projectRoot, "frontend"),
    path.join(projectRoot, "frontend", "vite-project"),
    path.join(projectRoot, "frontend", "vite-project", "src"),
    path.join(projectRoot, "desktop"),
    path.join(projectRoot, "scripts"),
  ]
    .filter((entry) => fs.existsSync(entry) && fs.statSync(entry).isDirectory())
    .map((entry) => entry.replace(/\\/g, "/"))
  const rendererResult = await win.webContents.executeJavaScript(`
    (async () => {
      const waitForState = (predicate, label, timeout = 45000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("smoke state timeout: " + label))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })

      await waitForState(() => document.querySelector(".app-shell"), "app shell")
      await waitForState(() => typeof window.__codekSmokeRealExplorer === "function", "real explorer bridge")
      const result = await window.__codekSmokeRealExplorer(${JSON.stringify({
        root: projectRoot,
        expandPaths,
      })})
      window.__codekSmokeRealExplorerResult = result
      return result
    })()
  `)
  const workspaceScaleProfile = await waitForWorkspaceScaleProfileReady(projectRoot)
  const uniqueReadDirCalls = [...new Set(electronSmokeExplorerReadDirCalls)]
  await win.webContents.executeJavaScript(`
    window.__codekSmokeRealExplorerResult = {
      ...(window.__codekSmokeRealExplorerResult || {}),
      workspaceScaleProfile: ${JSON.stringify(workspaceScaleProfile)},
      readDirCalls: ${JSON.stringify(uniqueReadDirCalls)},
      readDirSamples: ${JSON.stringify(electronSmokeExplorerReadDirSamples)},
      readDirCallCount: ${JSON.stringify(electronSmokeExplorerReadDirCalls.length)},
      uniqueReadDirCallCount: ${JSON.stringify(uniqueReadDirCalls.length)},
      readDirInFlightMax: ${JSON.stringify(electronSmokeExplorerReadDirInFlightMax)}
    }
  `)
  return {
    ...rendererResult,
    workspaceScaleProfile,
    readDirCalls: uniqueReadDirCalls,
    readDirSamples: electronSmokeExplorerReadDirSamples,
    readDirCallCount: electronSmokeExplorerReadDirCalls.length,
    uniqueReadDirCallCount: uniqueReadDirCalls.length,
    readDirInFlightMax: electronSmokeExplorerReadDirInFlightMax,
  }
}

async function exerciseElectronSmokeExplorerStress(win) {
  if (!isExplorerStressSmoke) return
  const projectRoot = path.resolve(process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_ROOT || path.resolve(__dirname, ".."))
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`explorer stress smoke root missing: ${projectRoot}`)
  }
  electronSmokeExplorerReadDirCalls = []
  electronSmokeExplorerReadDirSamples = []
  electronSmokeExplorerReadDirInFlight = 0
  electronSmokeExplorerReadDirInFlightMax = 0
  await setWorkspaceRoots([projectRoot], null)
  const preferredExpandPaths = [
    path.join(projectRoot, "frontend"),
    path.join(projectRoot, "frontend", "vite-project"),
    path.join(projectRoot, "frontend", "vite-project", "src"),
    path.join(projectRoot, "desktop"),
    path.join(projectRoot, "scripts"),
  ]
  const expandPaths = preferredExpandPaths
    .filter((entry) => fs.existsSync(entry) && fs.statSync(entry).isDirectory())
    .map((entry) => entry.replace(/\\/g, "/"))
  const rendererResult = await win.webContents.executeJavaScript(`
    (async () => {
      const waitForState = (predicate, label, timeout = 60000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("smoke state timeout: " + label))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })

      await waitForState(() => document.querySelector(".app-shell"), "app shell")
      await waitForState(() => typeof window.__codekSmokeExplorerStress === "function", "explorer stress bridge")
      const result = await window.__codekSmokeExplorerStress(${JSON.stringify({
        root: projectRoot,
        expandPaths,
      })})
      window.__codekSmokeExplorerStressResult = result
      return result
    })()
  `)
  const workspaceScaleProfile = await waitForWorkspaceScaleProfileReady(projectRoot)
  const uniqueReadDirCalls = [...new Set(electronSmokeExplorerReadDirCalls)]
  await win.webContents.executeJavaScript(`
    window.__codekSmokeExplorerStressResult = {
      ...(window.__codekSmokeExplorerStressResult || {}),
      workspaceScaleProfile: ${JSON.stringify(workspaceScaleProfile)},
      readDirCalls: ${JSON.stringify(uniqueReadDirCalls)},
      readDirSamples: ${JSON.stringify(electronSmokeExplorerReadDirSamples)},
      readDirCallCount: ${JSON.stringify(electronSmokeExplorerReadDirCalls.length)},
      uniqueReadDirCallCount: ${JSON.stringify(uniqueReadDirCalls.length)},
      readDirInFlightMax: ${JSON.stringify(electronSmokeExplorerReadDirInFlightMax)}
    }
  `)
  return {
    ...rendererResult,
    workspaceScaleProfile,
    readDirCalls: uniqueReadDirCalls,
    readDirSamples: electronSmokeExplorerReadDirSamples,
    readDirCallCount: electronSmokeExplorerReadDirCalls.length,
    uniqueReadDirCallCount: uniqueReadDirCalls.length,
    readDirInFlightMax: electronSmokeExplorerReadDirInFlightMax,
  }
}

async function exerciseElectronSmokeFileOperationVisibility(win) {
  if (!isFileOperationVisibilitySmoke) return
  const fixture = prepareSmokeFileOperationProject()
  currentProjectRoot = fixture.projectRoot
  currentWorkspaceRoots = [fixture.projectRoot]
  currentWorkspaceFile = null
  await startFileWatcher(currentProjectRoot)
  const rendererResult = await win.webContents.executeJavaScript(`
    (async () => {
      const waitForState = (predicate, label, timeout = 30000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("smoke state timeout: " + label))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })

      await waitForState(() => document.querySelector(".app-shell"), "app shell")
      await waitForState(() => window.__codekSmokeWorkbenchControls && typeof window.__codekSmokeWorkbenchControls.runFileOperationVisibilitySmoke === "function", "file operation smoke bridge")
      const result = await window.__codekSmokeWorkbenchControls.runFileOperationVisibilitySmoke(${JSON.stringify({ root: fixture.projectRoot })})
      window.__codekSmokeFileOperationVisibilityResult = result
      return result
    })()
  `)
  await win.webContents.executeJavaScript(`
    window.__codekSmokeFileOperationVisibilityResult = ${JSON.stringify(rendererResult)}
  `)
  return rendererResult
}

async function exerciseElectronSmokeEditorOpenFiles(win) {
  if (!isEditorOpenFilesSmoke) return null
  const rendererResult = await win.webContents.executeJavaScript(`
    (async () => {
      const waitForState = (predicate, label, timeout = 30000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("editor openFiles smoke timeout: " + label))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })
      await waitForState(() => document.querySelector(".app-shell"), "app shell")
      const explorerButton = await waitForState(() => document.querySelector('[data-codek-smoke="open-explorer"]'), "open explorer button")
      explorerButton.click()
      const createJavaButton = await waitForState(() => document.querySelector('[data-codek-smoke="create-java-project"]'), "create java project")
      createJavaButton.click()
      await waitForState(() => Array.from(document.querySelectorAll(".tab-name")).some((node) => String(node.textContent || "").includes("Main.java")), "java project tab")
      await waitForState(() => document.querySelector(".editor-wrapper[data-workbench-editor-part='true']"), "editor wrapper")
      await waitForState(() => document.querySelector(".tab.active .file-icon-svg"), "active tab icon")
      const wrapper = document.querySelector(".editor-wrapper[data-workbench-editor-part='true']")
      const activeTab = document.querySelector(".tab.active")
      const titleBar = document.querySelector('[data-codek-smoke="editor-title-bar"]')
      const result = {
        smokeCase: "editor-open-files",
        editorGroupsSource: wrapper?.getAttribute("data-workbench-open-editors-source") || "",
        openEditorsCount: Number(wrapper?.getAttribute("data-workbench-open-editors-count") || 0),
        noLocalOpenFilesState: wrapper?.getAttribute("data-workbench-no-local-open-files-state") === "true",
        editorPartMounted: wrapper?.getAttribute("data-workbench-editor-part") === "true",
        hasActiveTab: Boolean(activeTab),
        hasTabIcon: Boolean(activeTab?.querySelector?.(".file-icon-svg")),
        hasTitleIcon: Boolean(titleBar?.querySelector?.(".file-icon-svg")),
      }
      window.__codekSmokeEditorOpenFilesResult = result
      return result
    })()
  `)
  return rendererResult
}

async function exerciseElectronSmokeIconThemeRefresh(win) {
  if (!isIconThemeRefreshSmoke) return null
  const rendererResult = await win.webContents.executeJavaScript(`
    (async () => {
      const waitForState = (predicate, label, timeout = 30000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("icon theme refresh smoke timeout: " + label))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })
      await waitForState(() => document.querySelector(".app-shell"), "app shell")
      const explorerButton = await waitForState(() => document.querySelector('[data-codek-smoke="open-explorer"]'), "open explorer button")
      explorerButton.click()
      const createJavaButton = await waitForState(() => document.querySelector('[data-codek-smoke="create-java-project"]'), "create java project")
      createJavaButton.click()
      await waitForState(() => document.querySelector(".tab.active .file-icon-svg"), "active tab icon")
      const tabIcon = await waitForState(() => {
        const node = document.querySelector(".tab.active .file-icon-svg")
        return node?.getAttribute?.("data-file-icon-theme-service") === "workbenchThemeService" ? node : null
      }, "workbench theme service tab icon")
      const titleIcon = document.querySelector('[data-codek-smoke="editor-title-bar"] .file-icon-svg')
      const iconNodes = Array.from(document.querySelectorAll(".file-icon-svg[data-file-icon-theme-id]"))
      const initialThemeId = tabIcon?.getAttribute("data-file-icon-theme-id") || ""
      const initialSource = tabIcon?.getAttribute("data-file-icon-source") || ""
      let changedTabIcon = null
      let changedThemeSnapshot = null
      let settingsPatchOk = false
      let originalUserSettingsFile = null
      let settingsRestored = false
      const unwrapApiData = (response) => {
        if (response && typeof response === "object" && "data" in response) return response.data
        return response
      }
      try {
        originalUserSettingsFile = unwrapApiData(await window.codek?.api?.("GET", "/settings/user"))
        const patchResult = unwrapApiData(await window.codek?.api?.("PATCH", "/settings/user", {
          key: "workbench.iconTheme",
          value: "minimal",
        }))
        settingsPatchOk = Boolean(patchResult)
        changedTabIcon = await waitForState(() => {
          const node = document.querySelector(".tab.active .file-icon-svg")
          return node?.getAttribute?.("data-file-icon-theme-id") === "minimal" ? node : null
        }, "minimal file icon theme event")
        changedThemeSnapshot = {
          themeId: changedTabIcon?.getAttribute("data-file-icon-theme-id") || "",
          themeServiceId: changedTabIcon?.getAttribute("data-file-icon-theme-service") || "",
          source: changedTabIcon?.getAttribute("data-file-icon-source") || "",
        }
      } finally {
        if (originalUserSettingsFile?.settings) {
          const restoreResult = unwrapApiData(await window.codek?.api?.("PUT", "/settings/user", {
            settings: originalUserSettingsFile.settings,
          }).catch(() => null))
          settingsRestored = Boolean(restoreResult)
          if (settingsRestored && initialThemeId && initialThemeId !== "minimal") {
            await waitForState(() => {
              const node = document.querySelector(".tab.active .file-icon-svg")
              return node?.getAttribute?.("data-file-icon-theme-id") === initialThemeId ? node : null
            }, "restored file icon theme event")
          }
        }
      }
      const result = {
        smokeCase: "icon-theme-refresh",
        themeServiceId: tabIcon?.getAttribute("data-file-icon-theme-service") || "",
        themeId: initialThemeId,
        tabIconSource: initialSource,
        settingsPatchOk,
        settingsRestored,
        changedThemeId: changedThemeSnapshot?.themeId || "",
        changedThemeServiceId: changedThemeSnapshot?.themeServiceId || "",
        changedTabIconSource: changedThemeSnapshot?.source || "",
        changeEventReachedFileIconDom: changedThemeSnapshot?.themeId === "minimal",
        titleIconThemeService: titleIcon?.getAttribute?.("data-file-icon-theme-service") || "",
        fileIconDataEvidenceCount: iconNodes.length,
        noStaticIconMapFallback: iconNodes.every((node) => node.getAttribute("data-file-icon-theme-service") === "workbenchThemeService"),
      }
      window.__codekSmokeIconThemeRefreshResult = result
      return result
    })()
  `)
  return rendererResult
}

async function exerciseElectronSmokeWorkingCopyHotExit(win) {
  if (!isWorkingCopyHotExitSmoke) return
  writeElectronSmokeStage("exercise-working-copy-hot-exit:fixture-start")
  const fixture = prepareSmokeWorkingCopyHotExitProject()
  writeElectronSmokeStage("exercise-working-copy-hot-exit:fixture-ready", {
    projectRoot: fixture.projectRoot,
    targetPath: fixture.targetPath,
  })
  currentProjectRoot = fixture.projectRoot
  currentWorkspaceRoots = [fixture.projectRoot]
  currentWorkspaceFile = null
  await startFileWatcher(currentProjectRoot)
  const rendererResult = await win.webContents.executeJavaScript(`
    (async () => {
      const waitForState = (predicate, label, timeout = 30000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("smoke state timeout: " + label))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })

      await waitForState(() => document.querySelector(".app-shell"), "app shell")
      window.__codekSmokeWorkingCopyHotExitStage = { stage: "working-copy-hot-exit:init", at: Date.now(), detail: {} }
      await waitForState(() => window.__codekSmokeWorkbenchControls && typeof window.__codekSmokeWorkbenchControls.runWorkingCopyHotExitSmoke === "function", "working copy hot-exit smoke bridge")
      const result = await window.__codekSmokeWorkbenchControls.runWorkingCopyHotExitSmoke(${JSON.stringify({
        root: fixture.projectRoot,
        targetPath: fixture.targetPath,
      })})
      window.__codekSmokeWorkingCopyHotExitResult = result
      return result
    })()
  `)
  const enrichedResult = writeWorkingCopyHotExitSmokeEvidence({
    ...rendererResult,
    targetPath: rendererResult?.targetPath || fixture.targetPath,
  })
  await win.webContents.executeJavaScript(`
    window.__codekSmokeWorkingCopyHotExitResult = ${JSON.stringify(enrichedResult)}
  `)
  writeElectronSmokeStage("exercise-working-copy-hot-exit:evidence-written", {
    evidenceJsonExists: enrichedResult?.evidenceJsonExists,
    evidenceMarkdownExists: enrichedResult?.evidenceMarkdownExists,
  })
  return enrichedResult
}

async function exerciseElectronSmokeSearchReplace(win) {
  if (!isSearchReplaceSmoke) return
  writeElectronSmokeStage("exercise-search-replace:fixture-start")
  const fixture = prepareSmokeSearchReplaceProject("search-replace")
  writeElectronSmokeStage("exercise-search-replace:fixture-ready", { projectRoot: fixture.projectRoot })
  currentProjectRoot = fixture.projectRoot
  currentWorkspaceRoots = [fixture.projectRoot]
  currentWorkspaceFile = null
  writeElectronSmokeStage("exercise-search-replace:start-watcher", { projectRoot: currentProjectRoot })
  await startFileWatcher(currentProjectRoot)
  writeElectronSmokeStage("exercise-search-replace:watcher-ready", { projectRoot: currentProjectRoot })
  const rendererResult = await win.webContents.executeJavaScript(`
    (async () => {
      const waitForState = (predicate, label, timeout = 30000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("smoke state timeout: " + label))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })

      await waitForState(() => document.querySelector(".app-shell"), "app shell")
      window.__codekSmokeSearchReplaceStage = { stage: "search-replace:init", at: Date.now(), detail: {} }
      await waitForState(() => window.__codekSmokeWorkbenchControls && typeof window.__codekSmokeWorkbenchControls.runSearchReplaceSmoke === "function", "search replace smoke bridge")
      const result = await window.__codekSmokeWorkbenchControls.runSearchReplaceSmoke(${JSON.stringify({ root: fixture.projectRoot })})
      window.__codekSmokeSearchReplaceResult = result
      return result
    })()
  `)
  const finalRepeatedDisk = fs.readFileSync(fixture.repeatedFile, "utf-8")
  const finalOtherDisk = fs.readFileSync(fixture.otherFile, "utf-8")
  const enrichedResult = {
    ...rendererResult,
    finalRepeatedDisk,
    finalOtherDisk,
  }
  const evidenceResult = writeSearchReplaceSmokeEvidence(enrichedResult)
  await win.webContents.executeJavaScript(`
    window.__codekSmokeSearchReplaceResult = ${JSON.stringify(evidenceResult)}
  `)
  writeElectronSmokeStage("exercise-search-replace:evidence-written", {
    evidenceJsonExists: evidenceResult?.evidenceJsonExists,
    evidenceMarkdownExists: evidenceResult?.evidenceMarkdownExists,
  })
  return evidenceResult
}

async function exerciseElectronSmokeSearchNavigation(win) {
  if (!isSearchNavigationSmoke) return
  writeElectronSmokeStage("exercise-search-navigation:fixture-start")
  const fixture = prepareSmokeSearchReplaceProject("search-navigation")
  writeElectronSmokeStage("exercise-search-navigation:fixture-ready", { projectRoot: fixture.projectRoot })
  currentProjectRoot = fixture.projectRoot
  currentWorkspaceRoots = [fixture.projectRoot]
  currentWorkspaceFile = null
  writeElectronSmokeStage("exercise-search-navigation:start-watcher", { projectRoot: currentProjectRoot })
  await startFileWatcher(currentProjectRoot)
  writeElectronSmokeStage("exercise-search-navigation:watcher-ready", { projectRoot: currentProjectRoot })
  const rendererScript = `
    (async () => {
      window.__codekSmokeSearchNavigationStage = { stage: "renderer-search-navigation:start", at: Date.now(), detail: {} }
      try {
        console.info("[codek-smoke-search-navigation-stage]", JSON.stringify(window.__codekSmokeSearchNavigationStage))
      } catch {}
      const describeSmokeDom = () => {
        const bodyText = String(document.body?.innerText || "").slice(0, 500)
        return {
          url: location.href,
          readyState: document.readyState,
          hasAppShell: Boolean(document.querySelector(".app-shell")),
          hasAuthGate: Boolean(document.querySelector(".auth-gate-root")),
          hasWorkbenchControls: Boolean(window.__codekSmokeWorkbenchControls),
          hasSearchNavigationBridge: Boolean(window.__codekSmokeWorkbenchControls && typeof window.__codekSmokeWorkbenchControls.runSearchNavigationSmoke === "function"),
          tokenPresent: Boolean(localStorage.getItem("codek.auth.token")),
          rememberMe: localStorage.getItem("codek.auth.rememberMe"),
          autoLogin: localStorage.getItem("codek.auth.autoLogin"),
          bodyText,
        }
      }
      const waitForState = (predicate, label, timeout = 30000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          window.__codekSmokeSearchNavigationStage = { stage: "renderer-search-navigation:wait:" + label, at: Date.now(), detail: { elapsedMs: Date.now() - started, dom: describeSmokeDom() } }
          try {
            console.info("[codek-smoke-search-navigation-stage]", JSON.stringify(window.__codekSmokeSearchNavigationStage))
          } catch {}
          try {
            const value = await predicate()
            if (value) {
              window.__codekSmokeSearchNavigationStage = { stage: "renderer-search-navigation:ready:" + label, at: Date.now(), detail: { elapsedMs: Date.now() - started, dom: describeSmokeDom() } }
              try {
                console.info("[codek-smoke-search-navigation-stage]", JSON.stringify(window.__codekSmokeSearchNavigationStage))
              } catch {}
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("smoke state timeout: " + label + " " + JSON.stringify(describeSmokeDom())))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })

      await waitForState(() => document.querySelector(".app-shell"), "app shell")
      await waitForState(() => window.__codekSmokeWorkbenchControls && typeof window.__codekSmokeWorkbenchControls.runSearchNavigationSmoke === "function", "search navigation smoke bridge")
      window.__codekSmokeSearchNavigationStage = { stage: "renderer-search-navigation:run-start", at: Date.now(), detail: {} }
      try {
        console.info("[codek-smoke-search-navigation-stage]", JSON.stringify(window.__codekSmokeSearchNavigationStage))
      } catch {}
      const result = await window.__codekSmokeWorkbenchControls.runSearchNavigationSmoke(${JSON.stringify({ root: fixture.projectRoot })})
      window.__codekSmokeSearchNavigationResult = result
      window.__codekSmokeSearchNavigationStage = { stage: "renderer-search-navigation:run-done", at: Date.now(), detail: { clickedCount: result && result.clickedCount, allSelectionsAccurate: result && result.allSelectionsAccurate } }
      try {
        console.info("[codek-smoke-search-navigation-stage]", JSON.stringify(window.__codekSmokeSearchNavigationStage))
      } catch {}
      return result
    })()
  `
  const rendererResult = await Promise.race([
    win.webContents.executeJavaScript(rendererScript),
    new Promise((_, reject) => setTimeout(() => {
      reject(new Error("search navigation renderer smoke timeout"))
    }, 55_000)),
  ]).catch(async (error) => {
    writeElectronSmokeStage("exercise-search-navigation:renderer-timeout", {
      message: String(error?.message || error),
      rendererStage: await collectElectronSmokeRendererStage(win, 500),
    })
    throw error
  })
  writeElectronSmokeStage("exercise-search-navigation:renderer-result", {
    clickedCount: rendererResult?.clickedCount,
    allSelectionsAccurate: rendererResult?.allSelectionsAccurate,
    jsonSearchSelectionAccurate: rendererResult?.jsonSearchSelectionAccurate,
  })
  const enrichedResult = writeSearchNavigationSmokeEvidence(rendererResult)
  writeElectronSmokeStage("exercise-search-navigation:evidence-written", {
    evidenceJsonExists: enrichedResult?.evidenceJsonExists,
    evidenceMarkdownExists: enrichedResult?.evidenceMarkdownExists,
  })
  return enrichedResult
}

async function exerciseElectronSmokeArtifactOpen(win) {
  if (!isArtifactOpenSmoke) return
  writeElectronSmokeStage("exercise-artifact-open:fixture-start")
  const fixture = prepareSmokeArtifactOpenProject()
  writeElectronSmokeStage("exercise-artifact-open:fixture-ready", { projectRoot: fixture.projectRoot })
  currentProjectRoot = fixture.projectRoot
  currentWorkspaceRoots = [fixture.projectRoot]
  currentWorkspaceFile = null
  writeElectronSmokeStage("exercise-artifact-open:start-watcher", { projectRoot: currentProjectRoot })
  await startFileWatcher(currentProjectRoot)
  writeElectronSmokeStage("exercise-artifact-open:watcher-ready", { projectRoot: currentProjectRoot })
  const rendererScript = `
    (async () => {
      window.__codekSmokeArtifactOpenStage = { stage: "renderer-artifact-open:start", at: Date.now(), detail: {} }
      try {
        console.info("[codek-smoke-artifact-open-stage]", JSON.stringify(window.__codekSmokeArtifactOpenStage))
      } catch {}
      const describeSmokeDom = () => {
        const bodyText = String(document.body?.innerText || "").slice(0, 500)
        return {
          url: location.href,
          readyState: document.readyState,
          hasAppShell: Boolean(document.querySelector(".app-shell")),
          hasAuthGate: Boolean(document.querySelector(".auth-gate-root")),
          hasWorkbenchControls: Boolean(window.__codekSmokeWorkbenchControls),
          hasArtifactOpenBridge: Boolean(window.__codekSmokeWorkbenchControls && typeof window.__codekSmokeWorkbenchControls.runArtifactOpenSmoke === "function"),
          tokenPresent: Boolean(localStorage.getItem("codek.auth.token")),
          rememberMe: localStorage.getItem("codek.auth.rememberMe"),
          autoLogin: localStorage.getItem("codek.auth.autoLogin"),
          bodyText,
        }
      }
      const waitForState = (predicate, label, timeout = 30000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          window.__codekSmokeArtifactOpenStage = { stage: "renderer-artifact-open:wait:" + label, at: Date.now(), detail: { elapsedMs: Date.now() - started, dom: describeSmokeDom() } }
          try {
            console.info("[codek-smoke-artifact-open-stage]", JSON.stringify(window.__codekSmokeArtifactOpenStage))
          } catch {}
          try {
            const value = await predicate()
            if (value) {
              window.__codekSmokeArtifactOpenStage = { stage: "renderer-artifact-open:ready:" + label, at: Date.now(), detail: { elapsedMs: Date.now() - started, dom: describeSmokeDom() } }
              try {
                console.info("[codek-smoke-artifact-open-stage]", JSON.stringify(window.__codekSmokeArtifactOpenStage))
              } catch {}
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("smoke state timeout: " + label + " " + JSON.stringify(describeSmokeDom())))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })

      await waitForState(() => document.querySelector(".app-shell"), "app shell", 60000)
      await waitForState(() => window.__codekSmokeWorkbenchControls && typeof window.__codekSmokeWorkbenchControls.runArtifactOpenSmoke === "function", "artifact open smoke bridge", 60000)
      window.__codekSmokeArtifactOpenStage = { stage: "renderer-artifact-open:run-start", at: Date.now(), detail: {} }
      try {
        console.info("[codek-smoke-artifact-open-stage]", JSON.stringify(window.__codekSmokeArtifactOpenStage))
      } catch {}
      const result = await window.__codekSmokeWorkbenchControls.runArtifactOpenSmoke(${JSON.stringify({
        root: fixture.projectRoot,
        binaryFiles: fixture.binaryFiles,
        textFiles: fixture.textFiles,
      })})
      window.__codekSmokeArtifactOpenResult = result
      window.__codekSmokeArtifactOpenStage = {
        stage: "renderer-artifact-open:run-done",
        at: Date.now(),
        detail: {
          activeFile: result && result.activeFile,
          binaryArtifactsBlocked: result && result.binaryArtifactsBlocked,
          textFilesOpened: result && result.textFilesOpened,
          maxOpenDurationMs: result && result.maxOpenDurationMs,
        },
      }
      try {
        console.info("[codek-smoke-artifact-open-stage]", JSON.stringify(window.__codekSmokeArtifactOpenStage))
      } catch {}
      return result
    })()
  `
  const rendererResult = await Promise.race([
    win.webContents.executeJavaScript(rendererScript),
    new Promise((_, reject) => setTimeout(() => {
      reject(new Error("artifact open renderer smoke timeout"))
    }, 55_000)),
  ]).catch(async (error) => {
    writeElectronSmokeStage("exercise-artifact-open:renderer-timeout", {
      message: String(error?.message || error),
      rendererStage: await collectElectronSmokeRendererStage(win, 500),
    })
    throw error
  })
  writeElectronSmokeStage("exercise-artifact-open:renderer-result", {
    activeFile: rendererResult?.activeFile,
    binaryArtifactsBlocked: rendererResult?.binaryArtifactsBlocked,
    textFilesOpened: rendererResult?.textFilesOpened,
    maxOpenDurationMs: rendererResult?.maxOpenDurationMs,
  })
  const enrichedResult = writeArtifactOpenSmokeEvidence(rendererResult)
  writeElectronSmokeStage("exercise-artifact-open:evidence-written", {
    evidenceJsonExists: enrichedResult?.evidenceJsonExists,
    evidenceMarkdownExists: enrichedResult?.evidenceMarkdownExists,
  })
  return enrichedResult
}

async function exerciseElectronSmokeTabOverflow(win) {
  if (!isTabOverflowSmoke) return
  writeElectronSmokeStage("exercise-tab-overflow:fixture-start")
  const fixture = prepareSmokeSearchReplaceProject("tab-overflow")
  for (let index = 0; index < 24; index += 1) {
    fs.writeFileSync(path.join(fixture.projectRoot, "src", `tab-${String(index).padStart(2, "0")}.txt`), `tab smoke ${index}\n`, "utf-8")
  }
  writeElectronSmokeStage("exercise-tab-overflow:fixture-ready", {
    projectRoot: fixture.projectRoot,
    tabFileCount: 24,
  })
  currentProjectRoot = fixture.projectRoot
  currentWorkspaceRoots = [fixture.projectRoot]
  currentWorkspaceFile = null
  writeElectronSmokeStage("exercise-tab-overflow:start-watcher", { projectRoot: currentProjectRoot })
  await startFileWatcher(currentProjectRoot)
  writeElectronSmokeStage("exercise-tab-overflow:watcher-ready", { projectRoot: currentProjectRoot })
  const rendererResult = await win.webContents.executeJavaScript(`
    (async () => {
      window.__codekSmokeTabOverflowStage = { stage: "renderer-tab-overflow:start", at: new Date().toISOString() }
      const describeSmokeDom = () => {
        const bodyText = String(document.body?.innerText || "").slice(0, 500)
        return {
          url: location.href,
          readyState: document.readyState,
          hasAppShell: Boolean(document.querySelector(".app-shell")),
          hasAuthGate: Boolean(document.querySelector(".auth-gate-root")),
          hasWorkbenchControls: Boolean(window.__codekSmokeWorkbenchControls),
          hasTabOverflowBridge: Boolean(window.__codekSmokeWorkbenchControls && typeof window.__codekSmokeWorkbenchControls.runTabOverflowSmoke === "function"),
          tokenPresent: Boolean(localStorage.getItem("codek.auth.token")),
          rememberMe: localStorage.getItem("codek.auth.rememberMe"),
          autoLogin: localStorage.getItem("codek.auth.autoLogin"),
          bodyText,
        }
      }
      const waitForState = (predicate, label, timeout = 30000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          window.__codekSmokeTabOverflowStage = { stage: "renderer-tab-overflow:wait:" + label, at: new Date().toISOString(), elapsedMs: Date.now() - started, dom: describeSmokeDom() }
          try {
            const value = await predicate()
            if (value) {
              window.__codekSmokeTabOverflowStage = { stage: "renderer-tab-overflow:ready:" + label, at: new Date().toISOString(), elapsedMs: Date.now() - started, dom: describeSmokeDom() }
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            const dom = describeSmokeDom()
            window.__codekSmokeTabOverflowStage = { stage: "renderer-tab-overflow:timeout:" + label, at: new Date().toISOString(), elapsedMs: Date.now() - started, dom }
            reject(new Error("smoke state timeout: " + label + " " + JSON.stringify(dom)))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })

      await waitForState(() => document.querySelector(".app-shell"), "app shell", 60000)
      await waitForState(() => window.__codekSmokeWorkbenchControls && typeof window.__codekSmokeWorkbenchControls.runTabOverflowSmoke === "function", "tab overflow smoke bridge", 60000)
      window.__codekSmokeTabOverflowStage = { stage: "renderer-tab-overflow:run-start", at: new Date().toISOString() }
      const result = await window.__codekSmokeWorkbenchControls.runTabOverflowSmoke(${JSON.stringify({ root: fixture.projectRoot })})
      window.__codekSmokeTabOverflowStage = {
        stage: "renderer-tab-overflow:run-done",
        at: new Date().toISOString(),
        tabCount: result && result.tabCount,
        allTabsReadable: result && result.allTabsReadable,
        editorTitleVisible: result && result.editorTitleVisible,
        hasFileIcons: result && result.hasFileIcons,
      }
      window.__codekSmokeTabOverflowResult = result
      return result
    })()
  `)
  writeElectronSmokeStage("exercise-tab-overflow:renderer-result", {
    tabCount: rendererResult?.tabCount,
    allTabsReadable: rendererResult?.allTabsReadable,
    editorTitleVisible: rendererResult?.editorTitleVisible,
    hasFileIcons: rendererResult?.hasFileIcons,
  })
  await win.webContents.executeJavaScript(`
    window.__codekSmokeTabOverflowResult = ${JSON.stringify(rendererResult)}
  `)
  writeElectronSmokeStage("exercise-tab-overflow:result-stored")
  return rendererResult
}

async function exerciseElectronSmokeIconVisualState(win) {
  if (!isIconVisualStateSmoke) return
  writeElectronSmokeStage("exercise-icon-visual-state:fixture-start")
  const fixture = prepareSmokeSearchReplaceProject("icon-visual-state")
  fs.writeFileSync(path.join(fixture.projectRoot, "src", "icon-state.ts"), "export const iconState = true\n", "utf-8")
  fs.writeFileSync(path.join(fixture.projectRoot, "src", "icon-state.json"), JSON.stringify({ iconState: true }, null, 2), "utf-8")
  fs.mkdirSync(path.join(fixture.projectRoot, "src", "components"), { recursive: true })
  fs.mkdirSync(path.join(fixture.projectRoot, "src", "z-collapsed"), { recursive: true })
  fs.writeFileSync(path.join(fixture.projectRoot, "src", "components", "IconState.vue"), "<template><div /></template>\n", "utf-8")
  fs.writeFileSync(path.join(fixture.projectRoot, "src", "z-collapsed", "HiddenState.ts"), "export const hiddenState = true\n", "utf-8")
  writeElectronSmokeStage("exercise-icon-visual-state:fixture-ready", { projectRoot: fixture.projectRoot })
  currentProjectRoot = fixture.projectRoot
  currentWorkspaceRoots = [fixture.projectRoot]
  currentWorkspaceFile = null
  writeElectronSmokeStage("exercise-icon-visual-state:start-watcher", { projectRoot: currentProjectRoot })
  await startFileWatcher(currentProjectRoot)
  writeElectronSmokeStage("exercise-icon-visual-state:watcher-ready", { projectRoot: currentProjectRoot })
  const rendererScript = `
    (async () => {
      const setIconSmokeStage = (stage, detail = {}) => {
        const payload = { stage, at: new Date().toISOString(), detail }
        window.__codekSmokeIconVisualStateStage = payload
        try {
          console.info("[codek-smoke-icon-stage]", JSON.stringify(payload))
        } catch {}
      }
      setIconSmokeStage("renderer-icon-visual:start")
      const waitForState = (predicate, label, timeout = 30000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          setIconSmokeStage("renderer-icon-visual:wait:" + label, { elapsedMs: Date.now() - started })
          try {
            const value = await predicate()
            if (value) {
              setIconSmokeStage("renderer-icon-visual:ready:" + label, { elapsedMs: Date.now() - started })
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            setIconSmokeStage("renderer-icon-visual:timeout:" + label, { elapsedMs: Date.now() - started })
            reject(new Error("smoke state timeout: " + label))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })

      await waitForState(() => document.querySelector(".app-shell"), "app shell")
      await waitForState(() => window.__codekSmokeWorkbenchControls && typeof window.__codekSmokeWorkbenchControls.runIconVisualStateSmoke === "function", "icon visual state smoke bridge")
      setIconSmokeStage("renderer-icon-visual:run-start")
      const runPromise = window.__codekSmokeWorkbenchControls.runIconVisualStateSmoke(${JSON.stringify({ root: fixture.projectRoot })})
        .then((result) => {
          setIconSmokeStage("renderer-icon-visual:run-done", {
            explorerIconCount: result && result.explorerIconCount,
            tabIconCount: result && result.tabIconCount,
            editorIconCount: result && result.editorIconCount,
          })
          window.__codekSmokeIconVisualStateResult = result
          return result
        })
        .catch((error) => {
          setIconSmokeStage("renderer-icon-visual:run-error", { message: String(error && error.message || error) })
          throw error
        })
      window.__codekSmokeIconVisualRunPromise = runPromise
      return await runPromise
    })()
  `
  latestIconVisualCompletePayload = null
  const rendererComplete = waitForIconVisualRendererComplete(40_000)
  const rendererPromise = Promise.race([
    win.webContents.executeJavaScript(rendererScript),
    new Promise((_, reject) => setTimeout(() => {
      reject(new Error("icon visual renderer smoke timeout"))
    }, 45000)),
  ]).catch(async (error) => {
    writeElectronSmokeStage("exercise-icon-visual-state:renderer-timeout", {
      message: String(error?.message || error),
      rendererStage: await collectElectronSmokeRendererStage(win, 500),
    })
    throw error
  })
  const completeStage = await rendererComplete
  if (completeStage?.stage !== "complete") {
    try { await rendererPromise } catch {}
    throw new Error("icon visual renderer did not report complete stage")
  }
  let rendererResult = completeStage.detail || {}
  const rendererSettled = await Promise.race([
    rendererPromise.then((value) => ({ settled: true, value })),
    new Promise((resolve) => setTimeout(() => resolve({ settled: false, timeout: true }), 3500)),
  ]).catch((error) => ({ settled: true, error }))
  writeElectronSmokeStage("exercise-icon-visual-state:renderer-settled-before-capture", {
    settled: Boolean(rendererSettled?.settled),
    timeout: Boolean(rendererSettled?.timeout),
    value: rendererSettled?.value,
    error: rendererSettled?.error ? String(rendererSettled.error?.message || rendererSettled.error) : "",
  })
  if (rendererSettled?.error) {
    throw rendererSettled.error
  }
  if (rendererSettled?.settled && rendererSettled?.value && typeof rendererSettled.value === "object") {
    rendererResult = rendererSettled.value
  } else if (!rendererResult || typeof rendererResult !== "object" || !rendererResult.diagnostics) {
    try {
      const liveRendererResult = await win.webContents.executeJavaScript("window.__codekSmokeIconVisualStateResult || null")
      if (liveRendererResult && typeof liveRendererResult === "object") {
        rendererResult = liveRendererResult
      }
    } catch {
      // fall back to complete-stage detail
    }
  }
  const screenshotResult = await captureIconVisualStateSmokeScreenshotFromCurrentSurface(win, rendererResult)
  writeElectronSmokeStage("exercise-icon-visual-state:renderer-result", {
    explorerIconCount: rendererResult?.explorerIconCount,
    tabIconCount: rendererResult?.tabIconCount,
    editorIconCount: rendererResult?.editorIconCount,
    themeIconsMounted: rendererResult?.themeIconsMounted,
  })
  writeElectronSmokeStage("exercise-icon-visual-state:result-stored")
  return {
    ...rendererResult,
    ...screenshotResult,
  }
}

function waitForIconVisualRendererComplete(timeoutMs = 15000) {
  if (latestIconVisualCompletePayload?.stage === "complete") return Promise.resolve(latestIconVisualCompletePayload)
  return new Promise((resolve) => {
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      iconVisualCompleteWaiters = iconVisualCompleteWaiters.filter((item) => item !== finish)
      resolve(value)
    }
    const timer = setTimeout(() => finish({ timeout: true }), timeoutMs)
    iconVisualCompleteWaiters.push(finish)
  })
}

async function captureIconVisualStateSmokeScreenshotFromCurrentSurface(win, result = {}) {
  if (!isSmoke || !isIconVisualStateSmoke) return result
  if (!win || win.isDestroyed()) return result
  writeElectronSmokeStage("icon-visual-screenshot:surface-ready", {
    visibleRects: result.visibleRects,
    targetWindow: describeSmokeWindow(win),
    windows: BrowserWindow.getAllWindows().map(describeSmokeWindow),
  })
  try {
    if (!win.isVisible()) win.show()
    await bringSmokeWindowToForeground(win, "icon-visual-screenshot")
  } catch (error) {
    writeElectronSmokeStage("icon-visual-screenshot:focus-failed", { error: String(error?.message || error) })
  }
  const reportsDir = path.join(CODEK_DATA, "reports")
  fs.mkdirSync(reportsDir, { recursive: true })
  const screenshotPath = path.join(reportsDir, "workbench-icon-visual-state-latest.png")
  try {
    fs.rmSync(screenshotPath, { force: true })
  } catch {}
  const paintState = result?.visibleRects
    ? {
      fromRendererResult: true,
      tab: Boolean(result.visibleRects.tabBar?.visible || result.visibleRects.firstTab?.visible),
      editorTitle: Boolean(result.visibleRects.editorTitle?.visible),
      editorIcon: Boolean(result.visibleRects.editorIcon?.visible),
      editor: Boolean(result.visibleRects.editorContainer?.visible),
      welcome: Boolean(result.visibleRects.welcomePage?.visible),
      visibleRects: result.visibleRects,
    }
    : await waitForIconVisualStatePaint(win)
  writeElectronSmokeStage("icon-visual-screenshot:paint-state", paintState)
  const rendererCompleteReady = Boolean(
    paintState?.tab
      && paintState?.editorTitle
      && paintState?.editorIcon
      && paintState?.editor
      && !paintState?.welcome
      && result?.hitTargets?.firstTab?.closestTab
      && result?.hitTargets?.editorTitle?.closestTitle
      && result?.hitTargets?.editorContainer?.closestEditor
      && !result?.hitTargets?.editorContainer?.closestWelcome,
  )
  if (!rendererCompleteReady) {
    const restoredState = await restoreIconVisualStateBeforeCapture(win)
    writeElectronSmokeStage("icon-visual-screenshot:restored-before-capture", restoredState)
    await flushIconVisualRendererSurface(win)
    await forceIconVisualWindowCompositeCommit(win)
  } else {
    writeElectronSmokeStage("icon-visual-screenshot:renderer-complete-ready", {
      visibleRects: result.visibleRects,
      hitTargets: result.hitTargets,
    })
  }
  let lastCapture = null
  let nativeWindowCapture = null
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    if (attempt > 1 || !rendererCompleteReady) {
      const restoredState = await restoreIconVisualStateBeforeCapture(win)
      writeElectronSmokeStage("icon-visual-screenshot:retry-restore", { attempt, restoredState })
    }
    await flushIconVisualRendererSurface(win)
    await forceIconVisualWindowCompositeCommit(win)
    await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 300 : 700))
    const liveRendererState = await collectIconVisualRendererCaptureState(win, 1200)
    const rendererCaptureState = {
      ...(result && typeof result === "object" ? result : {}),
      ...(result?.diagnostics && typeof result.diagnostics === "object" ? result.diagnostics : {}),
      ...(liveRendererState && typeof liveRendererState === "object" ? liveRendererState : {}),
      visibleRects: liveRendererState?.visibleRects || result.visibleRects,
      hitTargets: liveRendererState?.hitTargets || result.hitTargets,
    }
    const visibleRects = rendererCaptureState?.visibleRects || result.visibleRects
    writeElectronSmokeStage("icon-visual-screenshot:capture-start", {
      screenshotPath,
      attempt,
      rendererCaptureState,
    })
    const sourceCaptures = []
    const rendererEditorVisible = rendererStateShowsIconVisualEditor(rendererCaptureState)
      || rendererStateShowsIconVisualEditor({ ...result, ...result.diagnostics })
    let evidenceSource = "webContents.capturePage"
    let image = await Promise.race([
      win.webContents.capturePage(),
      new Promise((resolve) => setTimeout(() => resolve(null), 2500)),
    ])
    if (isUsableNativeImage(image)) {
      sourceCaptures.push({ source: evidenceSource, image })
      writeIconVisualCaptureEvidence(reportsDir, "webcontents", image, visibleRects, attempt)
    } else {
      image = null
    }
    if (!image) {
      writeElectronSmokeStage("icon-visual-screenshot:capture-timeout", {
        attempt,
        rendererEditorVisible,
      })
      if (rendererEditorVisible) {
        nativeWindowCapture = await captureBestIconVisualNativeScreenshot(win, reportsDir, visibleRects, attempt)
        if (nativeWindowCapture?.image) {
          image = nativeWindowCapture.image
          evidenceSource = nativeWindowCapture.source || "native-window"
          writeElectronSmokeStage("icon-visual-screenshot:capture-timeout-fallback", {
            attempt,
            source: evidenceSource,
            pixelState: nativeWindowCapture.pixelState,
          })
        }
      }
      if (!image) {
        lastCapture = {
          screenshotVisualReady: false,
          screenshotPixelState: { ready: false, error: "capture timed out" },
          rendererCaptureState,
          visibleRects,
          evidenceSource: "capture-timeout",
          bytes: 0,
        }
        continue
      }
    }
    const stitchedImage = await stitchIconVisualEditorRegionIfNeeded(win, image, visibleRects)
    if (stitchedImage && stitchedImage !== image) {
      writeIconVisualCaptureEvidence(reportsDir, "stitched", stitchedImage, visibleRects, attempt)
    }
    let evidenceImage = stitchedImage
    let screenshotPixelState = analyzeIconVisualScreenshotPixels(evidenceImage, visibleRects)
    let screenshotVisualReady = isIconVisualRectsReady(visibleRects)
      && screenshotPixelState.ready
    if (!screenshotVisualReady && rendererEditorVisible) {
      nativeWindowCapture = nativeWindowCapture || await captureBestIconVisualNativeScreenshot(win, reportsDir, visibleRects, attempt)
      const windowCapture = nativeWindowCapture
      if (windowCapture?.image) {
        const windowImage = windowCapture.image
        const desktopPixelState = windowCapture.pixelState || analyzeIconVisualScreenshotPixels(windowImage, visibleRects)
        try {
          const windowPng = nativeImageToNonEmptyPng(windowImage)
          if (windowPng) fs.writeFileSync(path.join(reportsDir, "workbench-icon-visual-state-native-window-latest.png"), windowPng)
        } catch (error) {
          writeElectronSmokeStage("icon-visual-screenshot:native-window-write-failed", {
            error: String(error?.message || error),
          })
        }
        writeElectronSmokeStage("icon-visual-screenshot:window-capture", {
          attempt,
          source: windowCapture.source,
          desktopPixelState,
        })
        if (desktopPixelState.ready) {
          evidenceImage = windowImage
          evidenceSource = windowCapture.source || "native-window"
          screenshotPixelState = desktopPixelState
          screenshotVisualReady = true
        }
      }
    }
    writeElectronSmokeStage("icon-visual-screenshot:source-captures", {
      attempt,
      sources: sourceCaptures.map((capture) => ({
        source: capture.source,
        size: capture.image?.getSize?.(),
        pixelState: analyzeIconVisualScreenshotPixels(capture.image, visibleRects),
      })),
    })
    const png = nativeImageToNonEmptyPng(evidenceImage)
    if (!png) {
      lastCapture = {
        screenshotVisualReady: false,
        screenshotPixelState: { ready: false, error: "capture image is empty" },
        rendererCaptureState,
        visibleRects,
        evidenceSource,
        bytes: 0,
      }
      writeElectronSmokeStage("icon-visual-screenshot:capture-empty", {
        screenshotPath,
        attempt,
        rendererCaptureState,
        evidenceSource,
      })
      continue
    }
    fs.writeFileSync(screenshotPath, png)
    lastCapture = {
      screenshotVisualReady,
      screenshotPixelState,
      rendererCaptureState,
      visibleRects,
      evidenceSource,
      bytes: png.length,
    }
    writeElectronSmokeStage("icon-visual-screenshot:capture-done", {
      screenshotPath,
      attempt,
      bytes: png.length,
      screenshotPixelState,
      screenshotVisualReady,
      rendererCaptureState,
      evidenceSource,
    })
    if (screenshotVisualReady) break
  }
  const capture = lastCapture || {}
  return {
    screenshotVisualReady: Boolean(capture.screenshotVisualReady),
    screenshotPixelState: capture.screenshotPixelState || { ready: false, error: "capture missing" },
    paintState: {
      fromRendererCompleteStage: true,
      initialPaintState: paintState,
      visibleRects: capture.visibleRects || result.visibleRects,
      rendererCaptureState: capture.rendererCaptureState || null,
      evidenceSource: capture.evidenceSource || "webContents.capturePage",
    },
    screenshotPath,
    screenshotExists: fs.existsSync(screenshotPath),
  }
}

async function captureBestIconVisualNativeScreenshot(win, reportsDir, rects = {}, attempt = 1) {
  const captures = []
  const addCapture = (source, image) => {
    if (!image || image.isEmpty?.()) return
    const evidence = writeIconVisualCaptureEvidence(reportsDir, source, image, rects, attempt)
    captures.push({
      source,
      image,
      pixelState: evidence?.pixelState || analyzeIconVisualScreenshotPixels(image, rects),
    })
  }
  try {
    addCapture("devtools", await captureIconVisualDevToolsScreenshot(win, rects))
  } catch (error) {
    writeElectronSmokeStage("icon-visual-screenshot:devtools-error", { error: String(error?.message || error) })
  }
  try {
    addCapture("native-desktop-capturer", await captureIconVisualDesktopCapturerScreenshot(win))
  } catch (error) {
    writeElectronSmokeStage("icon-visual-screenshot:native-desktop-capturer-error", { error: String(error?.message || error) })
  }
  try {
    addCapture("native-print-window", captureIconVisualWindowPrintScreenshot(win))
  } catch (error) {
    writeElectronSmokeStage("icon-visual-screenshot:native-print-window-error", { error: String(error?.message || error) })
  }
  try {
    addCapture("native-screen", captureIconVisualDesktopScreenshot(win))
  } catch (error) {
    writeElectronSmokeStage("icon-visual-screenshot:native-screen-error", { error: String(error?.message || error) })
  }
  const ready = captures.find((capture) => capture.pixelState?.ready)
  const best = ready
    || captures.slice().sort((a, b) => {
      const score = (capture) => Number(capture.pixelState?.tab?.variedRatio || 0)
        + Number(capture.pixelState?.title?.variedRatio || 0)
        + Number(capture.pixelState?.icon?.variedRatio || 0)
        + Number(capture.pixelState?.editor?.variedRatio || 0)
      return score(b) - score(a)
    })[0]
    || null
  writeElectronSmokeStage("icon-visual-screenshot:native-best", {
    attempt,
    selected: best?.source || null,
    captures: captures.map((capture) => ({
      source: capture.source,
      size: capture.image?.getSize?.(),
      pixelState: capture.pixelState,
    })),
  })
  return best
}

async function bringSmokeWindowToForeground(win, label = "smoke") {
  if (!win || win.isDestroyed()) return { skipped: true, label }
  const restoreAlwaysOnTop = typeof win.isAlwaysOnTop === "function" ? Boolean(win.isAlwaysOnTop()) : false
  try {
    if (!win.isVisible?.()) win.show()
    if (win.isMinimized?.()) win.restore()
    win.setAlwaysOnTop?.(true, "screen-saver")
    win.moveTop?.()
    win.focus()
    win.webContents?.focus?.()
    await new Promise((resolve) => setTimeout(resolve, 180))
    return { focused: Boolean(win.isFocused?.()), foreground: true, label }
  } catch (error) {
    return { focused: false, foreground: false, label, error: String(error?.message || error) }
  } finally {
    try {
      win.setAlwaysOnTop?.(restoreAlwaysOnTop)
    } catch {}
  }
}

async function flushIconVisualRendererSurface(win) {
  if (!win || win.isDestroyed()) return { skipped: true }
  const script = `
    (() => {
      const rectOf = (node) => {
        const rect = node?.getBoundingClientRect?.()
        if (!rect) return null
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        }
      }
      const styleOf = (node) => {
        if (!node) return null
        const style = window.getComputedStyle?.(node)
        return {
          tag: String(node.tagName || "").toLowerCase(),
          className: String(node.getAttribute?.("class") || ""),
          display: String(style?.display || ""),
          visibility: String(style?.visibility || ""),
          opacity: String(style?.opacity || ""),
          position: String(style?.position || ""),
          zIndex: String(style?.zIndex || ""),
          transform: String(style?.transform || ""),
          rect: rectOf(node),
          text: String(node.textContent || "").trim().slice(0, 120),
        }
      }
      const snapshot = (entries = []) => ({
        readyState: document.readyState,
        visibilityState: document.visibilityState,
        activeFile: window.__codekSmokeWorkbenchState?.activeFile
          || window.__codekSmokeIconVisualStateResult?.diagnostics?.activeFile
          || "",
        bodyClass: String(document.body?.className || ""),
        elements: Object.fromEntries(entries.map(([name, node]) => [name, styleOf(node)])),
      })
      try {
        const mainArea = document.querySelector(".main-area")
        const tabBar = document.querySelector(".tab-bar")
        const editorTitle = document.querySelector('[data-codek-smoke="editor-title-bar"]')
        const editorWrapper = document.querySelector(".editor-wrapper")
        const editorSplit = document.querySelector(".editor-split-container")
        const editorContainer = document.querySelector(".editor-container")
        const monacoEditor = document.querySelector(".editor-container .monaco-editor")
        const welcomePage = document.querySelector(".welcome-page")
        const entries = [
          ["mainArea", mainArea],
          ["tabBar", tabBar],
          ["editorTitle", editorTitle],
          ["editorWrapper", editorWrapper],
          ["editorSplit", editorSplit],
          ["editorContainer", editorContainer],
          ["monacoEditor", monacoEditor],
          ["welcomePage", welcomePage],
        ]
        const nodes = entries.map(([, node]) => node).filter(Boolean)
        document.body.classList.add("codek-icon-visual-smoke-capturing")
        for (const node of nodes) {
          node.classList.add("force-editor-surface-paint")
          void node.offsetHeight
          void node.getBoundingClientRect?.()
        }
        for (const node of nodes) {
          void node.offsetWidth
          void node.getBoundingClientRect?.()
        }
        return {
          ok: true,
          at: Date.now(),
          detail: {
            nodes: nodes.length,
            snapshot: snapshot(entries),
          },
        }
      } catch (error) {
        return { ok: false, error: String(error && error.message || error) }
      }
    })()
  `
  try {
    const result = await Promise.race([
      win.webContents.executeJavaScript(script, true),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 1800)),
    ])
    writeElectronSmokeStage("icon-visual-screenshot:renderer-flush", result)
    return result
  } catch (error) {
    const result = { ok: false, error: String(error?.message || error) }
    writeElectronSmokeStage("icon-visual-screenshot:renderer-flush-failed", result)
    return result
  }
}

function describeSmokeWindow(win) {
  if (!win || win.isDestroyed?.()) {
    return { destroyed: true }
  }
  try {
    return {
      id: win.id,
      title: String(win.getTitle?.() || ""),
      visible: Boolean(win.isVisible?.()),
      focused: Boolean(win.isFocused?.()),
      minimized: Boolean(win.isMinimized?.()),
      bounds: win.getBounds?.(),
      contentBounds: win.getContentBounds?.(),
      opacity: typeof win.getOpacity === "function" ? win.getOpacity() : undefined,
      alwaysOnTop: typeof win.isAlwaysOnTop === "function" ? win.isAlwaysOnTop() : undefined,
      webContentsId: win.webContents?.id,
      url: typeof win.webContents?.getURL === "function" ? win.webContents.getURL() : "",
    }
  } catch (error) {
    return { id: win.id, error: String(error?.message || error) }
  }
}

function writeIconVisualCaptureEvidence(reportsDir, suffix, image, rects = {}, attempt = 1) {
  if (!isUsableNativeImage(image)) return null
  const safeSuffix = String(suffix || "capture").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()
  const latestPath = path.join(reportsDir, `workbench-icon-visual-state-${safeSuffix}-latest.png`)
  const attemptPath = path.join(reportsDir, `workbench-icon-visual-state-${safeSuffix}-attempt-${attempt}.png`)
  const pixelState = analyzeIconVisualScreenshotPixels(image, rects)
  try {
    const png = nativeImageToNonEmptyPng(image)
    if (!png) return null
    fs.writeFileSync(latestPath, png)
    fs.writeFileSync(attemptPath, png)
    writeElectronSmokeStage("icon-visual-screenshot:source-written", {
      source: safeSuffix,
      attempt,
      latestPath,
      bytes: png.length,
      size: image.getSize?.(),
      pixelState,
    })
  } catch (error) {
    writeElectronSmokeStage("icon-visual-screenshot:source-write-failed", {
      source: safeSuffix,
      attempt,
      error: String(error?.message || error),
      pixelState,
    })
  }
  return { latestPath, attemptPath, pixelState }
}

function isUsableNativeImage(image) {
  if (!image || image.isEmpty?.()) return false
  const size = image.getSize?.()
  return Number(size?.width || 0) > 0 && Number(size?.height || 0) > 0
}

function nativeImageToNonEmptyPng(image) {
  if (!isUsableNativeImage(image)) return null
  try {
    const png = image.toPNG()
    return Buffer.isBuffer(png) && png.length > 0 ? png : null
  } catch {
    return null
  }
}

async function statFsPathWithTimeout(resolvedPath, timeoutMs = FS_STAT_TIMEOUT_MS) {
  let timer = null
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timeout: true }), timeoutMs)
  })
  try {
    return await Promise.race([
      fs.promises.stat(resolvedPath).then((stat) => ({ stat })),
      timeout,
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function captureRealProjectUiSmokeScreenshotEvidence(win, result = {}) {
  if (!win || win.isDestroyed()) return { ready: false, reason: "window missing" }
  const targetPath = String(
    result?.screenshotRestoreActiveFile
      || result?.workbenchEditorPartActiveEditor
      || result?.rootPackageActiveFile
      || result?.normalActiveFile
      || result?.normalFile
      || result?.largeFile
      || result?.selectedTreePath
      || "",
  )
  const rendererState = await collectWorkbenchEditorRendererCaptureState(win, targetPath, 3000)
  const visibleRects = rendererState?.visibleRects || {}
  let lastCapture = null
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await forceSmokeWindowCompositeCommit(win, `real-project-ui:${attempt}`)
    await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 500 : 900))
    const image = await Promise.race([
      win.webContents.capturePage(),
      new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
    ])
    if (!image) {
      lastCapture = { ready: false, reason: "capture timeout", attempt, rendererState }
      continue
    }
    const pixelState = analyzeWorkbenchEditorScreenshotPixels(image, visibleRects)
    const rendererReady = rendererStateShowsWorkbenchEditor(rendererState)
    const editorContentReady = Boolean(
      result?.screenshotRestoreEditorVisible
        || result?.screenshotRestoreExpectedTextVisible
        || result?.normalEditorContentVisible
        || result?.largeFileRealContentVisible
        || result?.rootPackageEditorValueVisible,
    )
    const ready = Boolean(pixelState.ready && (rendererReady || editorContentReady))
    lastCapture = {
      ready,
      reason: ready ? "" : "capture does not show editor surface",
      attempt,
      image,
      rendererState,
      pixelState,
    }
    writeElectronSmokeStage("real-project-ui:screenshot-evidence", {
      attempt,
      ready,
      reason: lastCapture.reason,
      targetPath,
      rendererReady,
      pixelState,
      visibleRects,
    })
    if (ready) return lastCapture
  }
  return lastCapture || { ready: false, reason: "capture missing" }
}

async function collectWorkbenchEditorRendererCaptureState(win, expectedPath = "", timeoutMs = 3000) {
  if (!win || win.isDestroyed()) return null
  const script = `
    (async () => {
      const expectedPath = ${JSON.stringify(String(expectedPath || ""))}
      const visible = (node) => {
        if (!node) return false
        const rect = node.getBoundingClientRect?.()
        const style = window.getComputedStyle?.(node)
        return Boolean(rect && rect.width > 0 && rect.height > 0 && style?.display !== "none" && style?.visibility !== "hidden" && Number(style?.opacity || 1) !== 0)
      }
      const findPreferredNode = (selector) => {
        if (Array.isArray(selector)) {
          for (const candidate of selector) {
            const match = document.querySelector(candidate)
            if (match) return match
          }
          return null
        }
        return document.querySelector(selector)
      }
      const rectOf = (selector) => {
        const node = findPreferredNode(selector)
        const rect = node?.getBoundingClientRect?.()
        const style = node ? window.getComputedStyle?.(node) : null
        return rect ? {
          text: String(node.textContent || "").trim().slice(0, 160),
          visible: visible(node),
          display: String(style?.display || ""),
          visibility: String(style?.visibility || ""),
          opacity: String(style?.opacity || ""),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        } : null
      }
      const hitTargetOf = (selector) => {
        const node = findPreferredNode(selector)
        const rect = node?.getBoundingClientRect?.()
        if (!rect || rect.width <= 0 || rect.height <= 0) return null
        const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2))
        const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2))
        const hit = document.elementFromPoint(x, y)
        const describe = (item) => item ? {
          tag: String(item.tagName || "").toLowerCase(),
          className: String(item.getAttribute?.("class") || ""),
          smoke: String(item.getAttribute?.("data-codek-smoke") || ""),
          text: String(item.textContent || "").trim().slice(0, 120),
        } : null
        return {
          x: Math.round(x),
          y: Math.round(y),
          target: describe(hit),
          closestTab: describe(hit?.closest?.(".tab")),
          closestTitle: describe(hit?.closest?.('[data-codek-smoke="editor-title-bar"]')),
          closestEditor: describe(hit?.closest?.(".editor-container, .monaco-editor")),
          closestWelcome: describe(hit?.closest?.(".welcome-page")),
        }
      }
      const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await Promise.race([waitFrame(), new Promise((resolve) => setTimeout(resolve, 160))])
      return {
        readyState: document.readyState,
        title: document.title,
        expectedPath,
        bodyTextSample: String(document.body?.innerText || "").slice(0, 360),
        tabCount: document.querySelectorAll(".tab").length,
        editorTitleCount: document.querySelectorAll('[data-codek-smoke="editor-title-bar"]').length,
        monacoEditorCount: document.querySelectorAll(".editor-container .monaco-editor").length,
        welcomePageCount: document.querySelectorAll(".welcome-page").length,
        visibleWelcomePageCount: [...document.querySelectorAll(".welcome-page")].filter((node) => visible(node)).length,
        visibleRects: {
          tabBar: rectOf(".tab-bar"),
          firstTab: rectOf([".tab.active", ".tab"]),
          editorTitle: rectOf('[data-codek-smoke="editor-title-bar"]'),
          editorIcon: rectOf('[data-codek-smoke="editor-title-bar"] .file-icon-svg'),
          editorContainer: rectOf(".editor-container .monaco-editor"),
          welcomePage: rectOf(".welcome-page"),
        },
        hitTargets: {
          firstTab: hitTargetOf([".tab.active", ".tab"]),
          editorTitle: hitTargetOf('[data-codek-smoke="editor-title-bar"]'),
          editorContainer: hitTargetOf(".editor-container .monaco-editor"),
          welcomePage: hitTargetOf(".welcome-page"),
        },
      }
    })()
  `
  try {
    return await Promise.race([
      win.webContents.executeJavaScript(script),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), timeoutMs)),
    ])
  } catch (error) {
    return { error: String(error?.message || error) }
  }
}

function rendererStateShowsWorkbenchEditor(state = {}) {
  if (!state || state.timeout || state.error) return false
  const rects = state.visibleRects || {}
  const hits = state.hitTargets || {}
  return Boolean(
    state.tabCount >= 1
      && state.editorTitleCount >= 1
      && state.monacoEditorCount >= 1
      && Number(state.visibleWelcomePageCount || 0) === 0
      && rects.firstTab?.visible
      && rects.editorTitle?.visible
      && rects.editorContainer?.visible
      && !rects.welcomePage?.visible
      && hits.firstTab?.closestTab
      && hits.editorTitle?.closestTitle
      && hits.editorContainer?.closestEditor
      && !hits.editorContainer?.closestWelcome,
  )
}

async function forceIconVisualWindowCompositeCommit(win) {
  if (!win || win.isDestroyed()) return { skipped: true }
  const result = await forceSmokeWindowCompositeCommit(win, "icon-visual")
  writeElectronSmokeStage("icon-visual-screenshot:composite-commit", result)
  return result
}

async function forceSmokeWindowCompositeCommit(win, label = "smoke") {
  if (!win || win.isDestroyed()) return { skipped: true }
  try {
    win.show()
    const foreground = await bringSmokeWindowToForeground(win, label)
    win.webContents.invalidate?.()
    const bounds = win.getBounds()
    win.setBounds({ ...bounds, width: bounds.width + 1 }, false)
    await new Promise((resolve) => setTimeout(resolve, 180))
    win.setBounds(bounds, false)
    await new Promise((resolve) => setTimeout(resolve, 420))
    return { forced: true, label, foreground }
  } catch (error) {
    return { forced: false, label, error: String(error?.message || error) }
  }
}

async function stitchIconVisualEditorRegionIfNeeded(win, fullImage, rects = {}) {
  const fullPixelState = analyzeIconVisualScreenshotPixels(fullImage, rects)
  if (fullPixelState.ready || !rects?.editorTitle || !rects?.editorContainer) return fullImage
  const regionRect = buildIconVisualEditorRegionRect(rects)
  if (!regionRect) return fullImage
  try {
    const regionImage = await Promise.race([
      win.webContents.capturePage(regionRect),
      new Promise((_, reject) => setTimeout(() => reject(new Error("icon visual region screenshot capture timeout")), 3000)),
    ])
    const regionPixelState = analyzeIconVisualScreenshotPixels(regionImage, {
      firstTab: shiftRectIntoRegion(rects.firstTab, regionRect),
      editorTitle: shiftRectIntoRegion(rects.editorTitle, regionRect),
      editorContainer: shiftRectIntoRegion(rects.editorContainer, regionRect),
    })
    writeElectronSmokeStage("icon-visual-screenshot:region-capture", {
      regionRect,
      fullPixelState,
      regionPixelState,
    })
    if (!regionPixelState.ready) return fullImage
    const stitched = overlayNativeImageRegion(fullImage, regionImage, regionRect, rects)
    return stitched || fullImage
  } catch (error) {
    writeElectronSmokeStage("icon-visual-screenshot:region-capture-failed", {
      regionRect,
      error: String(error?.message || error),
    })
    return fullImage
  }
}

function rendererStateShowsIconVisualEditor(state = {}) {
  if (!state || state.timeout || state.error) return false
  const hits = state.hitTargets || {}
  const rects = state.visibleRects || {}
  const hasRequiredCounts = (
    state.tabCount >= 1
      && state.editorTitleCount >= 1
      && state.monacoEditorCount >= 1
      && Number(state.visibleWelcomePageCount || 0) === 0
  ) || (
    state.tabAndEditorIconsMounted
      && state.editorIconCount >= 1
      && state.tabIconCount >= 1
  )
  return Boolean(
    hasRequiredCounts
      && isIconVisualRectsReady(rects)
      && hits.firstTab?.closestTab
      && hits.editorTitle?.closestTitle
      && hits.editorContainer?.closestEditor
      && !hits.editorContainer?.closestWelcome,
  )
}

async function captureIconVisualDesktopCapturerScreenshot(win) {
  if (!win || win.isDestroyed()) return null
  try {
    const foreground = await bringSmokeWindowToForeground(win, "icon-visual-desktop-capturer")
    writeElectronSmokeStage("icon-visual-screenshot:desktop-capturer-foreground", foreground)
    const bounds = win.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const scaleFactor = Number(display?.scaleFactor || 1)
    const thumbnailSize = {
      width: Math.max(1, Math.round(Number(bounds.width || 0) * scaleFactor)),
      height: Math.max(1, Math.round(Number(bounds.height || 0) * scaleFactor)),
    }
    const title = String(win.getTitle?.() || "")
    const sources = await Promise.race([
      desktopCapturer.getSources({
        types: ["window"],
        thumbnailSize,
        fetchWindowIcons: false,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("desktopCapturer window source timeout")), 2500)),
    ])
    const candidates = Array.isArray(sources)
      ? sources.filter((source) => {
        const name = String(source?.name || "")
        const size = source?.thumbnail?.getSize?.() || {}
        return Boolean(
          source?.thumbnail
            && !source.thumbnail.isEmpty?.()
            && (
              (title && name.includes(title))
              || name.includes("Codek")
              || name.includes("electron-smoke-icon-visual-state-project")
              || Math.abs(Number(size.width || 0) - thumbnailSize.width) <= 4
            ),
        )
      })
      : []
    writeElectronSmokeStage("icon-visual-screenshot:desktop-capturer-sources", {
      title,
      thumbnailSize,
      sourceCount: Array.isArray(sources) ? sources.length : 0,
      candidates: candidates.slice(0, 6).map((source) => ({
        id: source.id,
        name: source.name,
        size: source.thumbnail?.getSize?.(),
      })),
    })
    const source = candidates.find((item) => String(item.name || "").includes(title))
      || candidates.find((item) => String(item.name || "").includes("electron-smoke-icon-visual-state-project"))
      || candidates.find((item) => String(item.name || "").includes("Codek"))
      || candidates[0]
    return source?.thumbnail && !source.thumbnail.isEmpty?.() ? source.thumbnail : null
  } catch (error) {
    writeElectronSmokeStage("icon-visual-screenshot:desktop-capturer-failed", {
      error: String(error?.message || error),
    })
    return null
  }
}

async function captureIconVisualDevToolsScreenshot(win, rects = {}) {
  if (!win || win.isDestroyed()) return null
  const dbg = win.webContents?.debugger
  if (!dbg) return null
  let attachedHere = false
  const command = (name, params, timeoutMs = 5000) => Promise.race([
    dbg.sendCommand(name, params),
    new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ])
  try {
    if (!dbg.isAttached()) {
      dbg.attach("1.3")
      attachedHere = true
    }
    if (win.isDestroyed()) return null
    await command("Page.enable", undefined, 2500)
    if (win.isDestroyed()) return null
    const metrics = await command("Page.getLayoutMetrics", undefined, 2500)
    if (win.isDestroyed()) return null
    const cssViewport = metrics?.cssVisualViewport || metrics?.cssLayoutViewport || {}
    const width = Math.max(1, Math.ceil(Number(cssViewport.clientWidth || cssViewport.width || win.getBounds().width || 0)))
    const height = Math.max(1, Math.ceil(Number(cssViewport.clientHeight || cssViewport.height || win.getBounds().height || 0)))
    const attempts = [
      {
        label: "surface-viewport",
        params: {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
          clip: { x: 0, y: 0, width, height, scale: 1 },
        },
      },
      {
        label: "surface-default",
        params: {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
        },
      },
      {
        label: "view-default",
        params: {
          format: "png",
          fromSurface: false,
          captureBeyondViewport: false,
        },
      },
    ]
    for (const attempt of attempts) {
      if (win.isDestroyed()) return null
      const result = await command("Page.captureScreenshot", attempt.params, 6000)
      if (!result?.data) {
        writeElectronSmokeStage("icon-visual-screenshot:devtools-capture-empty", {
          label: attempt.label,
          rectReady: isIconVisualRectsReady(rects),
        })
        continue
      }
      const image = nativeImage.createFromBuffer(Buffer.from(result.data, "base64"))
      writeElectronSmokeStage("icon-visual-screenshot:devtools-capture", {
        label: attempt.label,
        size: image.getSize?.(),
        rectReady: isIconVisualRectsReady(rects),
      })
      if (image && !image.isEmpty?.()) return image
    }
    return null
  } catch (error) {
    writeElectronSmokeStage("icon-visual-screenshot:devtools-capture-failed", {
      error: String(error?.message || error),
    })
    return null
  } finally {
    if (attachedHere) {
      try {
        dbg.detach()
      } catch {}
    }
  }
}

function captureIconVisualDesktopScreenshot(win) {
  if (process.platform !== "win32") return null
  try {
    win.setAlwaysOnTop(true, "screen-saver")
    win.show()
    win.focus()
    if (typeof win.moveTop === "function") win.moveTop()
    const nativeHandleHex = win.getNativeWindowHandle().reverse().toString("hex").replace(/^0+/, "").toLowerCase()
    if (!nativeHandleHex) return null
    const waitUntil = Date.now() + 1500
    while (Date.now() < waitUntil) {
      const foregroundHex = readWindowsForegroundWindowHex()
      if (foregroundHex && foregroundHex === nativeHandleHex) break
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
    }
    const foregroundHex = readWindowsForegroundWindowHex()
    if (foregroundHex !== nativeHandleHex) {
      writeElectronSmokeStage("icon-visual-screenshot:desktop-capture-skipped", {
        reason: "electron window is not foreground",
        foregroundHex,
        nativeHandleHex,
      })
      return null
    }
    const bounds = win.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const scaleFactor = Number(display?.scaleFactor || 1)
    const captureRect = {
      x: Math.round(Number(bounds.x || 0) * scaleFactor),
      y: Math.round(Number(bounds.y || 0) * scaleFactor),
      width: Math.round(Number(bounds.width || 0) * scaleFactor),
      height: Math.round(Number(bounds.height || 0) * scaleFactor),
    }
    if (captureRect.width <= 0 || captureRect.height <= 0) return null
    const powershell = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "powershell.exe"
    const script = [
      "Add-Type -AssemblyName System.Drawing",
      `$bmp = New-Object System.Drawing.Bitmap ${captureRect.width}, ${captureRect.height}`,
      "$graphics = [System.Drawing.Graphics]::FromImage($bmp)",
      `$graphics.CopyFromScreen(${captureRect.x}, ${captureRect.y}, 0, 0, $bmp.Size)`,
      "$stream = New-Object System.IO.MemoryStream",
      "$bmp.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)",
      "$graphics.Dispose()",
      "$bmp.Dispose()",
      "[Convert]::ToBase64String($stream.ToArray())",
    ].join("; ")
    const output = execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 20 * 1024 * 1024,
    }).trim()
    if (!output) return null
    return nativeImage.createFromBuffer(Buffer.from(output, "base64"))
  } catch (error) {
    writeElectronSmokeStage("icon-visual-screenshot:desktop-capture-failed", {
      error: String(error?.message || error),
    })
    return null
  } finally {
    try {
      win.setAlwaysOnTop(false)
    } catch {}
  }
}

function captureIconVisualWindowPrintScreenshot(win) {
  if (process.platform !== "win32") return null
  try {
    const nativeHandleHex = win.getNativeWindowHandle().reverse().toString("hex").replace(/^0+/, "").toLowerCase()
    if (!nativeHandleHex) return null
    const bounds = win.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const scaleFactor = Number(display?.scaleFactor || 1)
    const width = Math.round(Number(bounds.width || 0) * scaleFactor)
    const height = Math.round(Number(bounds.height || 0) * scaleFactor)
    if (width <= 0 || height <= 0) return null
    const powershell = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "powershell.exe"
    const script = [
      "Add-Type -AssemblyName System.Drawing",
      "Add-Type @\"",
      "using System;",
      "using System.Runtime.InteropServices;",
      "public static class CodekPrintWindowNative {",
      "  [DllImport(\"user32.dll\")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);",
      "}",
      "\"@",
      `$hwnd = [IntPtr]::new([Convert]::ToInt64("${nativeHandleHex}", 16))`,
      `$bmp = New-Object System.Drawing.Bitmap ${width}, ${height}`,
      "$graphics = [System.Drawing.Graphics]::FromImage($bmp)",
      "$hdc = $graphics.GetHdc()",
      "$ok = $false",
      "foreach ($flag in @(2, 3, 0)) {",
      "  $ok = [CodekPrintWindowNative]::PrintWindow($hwnd, $hdc, [uint32]$flag)",
      "  if ($ok) { break }",
      "}",
      "$graphics.ReleaseHdc($hdc)",
      "$stream = New-Object System.IO.MemoryStream",
      "$bmp.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)",
      "$graphics.Dispose()",
      "$bmp.Dispose()",
      "if (-not $ok) { Write-Error 'PrintWindow failed'; exit 2 }",
      "[Convert]::ToBase64String($stream.ToArray())",
    ].join("\n")
    const output = execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 2500,
      maxBuffer: 20 * 1024 * 1024,
    }).trim()
    if (!output) return null
    return nativeImage.createFromBuffer(Buffer.from(output, "base64"))
  } catch (error) {
    writeElectronSmokeStage("icon-visual-screenshot:window-print-capture-failed", {
      error: String(error?.message || error),
      stderr: String(error?.stderr || "").slice(0, 1000),
      stdout: String(error?.stdout || "").slice(0, 1000),
    })
    return null
  }
}

function readWindowsForegroundWindowHex() {
  try {
    const powershell = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "powershell.exe"
    const script = [
      "Add-Type @\"",
      "using System;",
      "using System.Runtime.InteropServices;",
      "public static class Win32ForegroundWindow {",
      "  [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
      "}",
      "\"@",
      "[Win32ForegroundWindow]::GetForegroundWindow().ToString(\"x\")",
    ].join("\n")
    return execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
      maxBuffer: 1024 * 1024,
    }).trim().replace(/^0+/, "").toLowerCase()
  } catch {
    return ""
  }
}

function buildIconVisualEditorRegionRect(rects = {}) {
  const title = rects.editorTitle
  const editor = rects.editorContainer
  if (!title || !editor) return null
  const x = Math.max(0, Math.min(Number(title.x || 0), Number(editor.x || 0)))
  const y = Math.max(0, Math.min(Number(rects.firstTab?.y || title.y || 0), Number(title.y || 0)))
  const right = Math.max(Number(title.x || 0) + Number(title.width || 0), Number(editor.x || 0) + Number(editor.width || 0))
  const bottom = Math.max(Number(title.y || 0) + Number(title.height || 0), Number(editor.y || 0) + Number(editor.height || 0))
  const width = Math.max(1, Math.ceil(right - x))
  const height = Math.max(1, Math.ceil(bottom - y))
  return {
    x: Math.floor(x),
    y: Math.floor(y),
    width,
    height,
  }
}

function shiftRectIntoRegion(rect, region) {
  if (!rect || !region) return rect
  return {
    ...rect,
    x: Math.max(0, Number(rect.x || 0) - Number(region.x || 0)),
    y: Math.max(0, Number(rect.y || 0) - Number(region.y || 0)),
  }
}

function overlayNativeImageRegion(fullImage, regionImage, regionRect, rects = {}) {
  try {
    const fullSize = fullImage.getSize()
    const regionSize = regionImage.getSize()
    const fullBitmap = Buffer.from(fullImage.toBitmap())
    const regionBitmap = regionImage.toBitmap()
    const dpr = resolveIconVisualImageDpr(fullSize, rects)
    const targetX = Math.max(0, Math.floor(Number(regionRect.x || 0) * dpr))
    const targetY = Math.max(0, Math.floor(Number(regionRect.y || 0) * dpr))
    const width = Math.min(Number(regionSize.width || 0), Math.max(0, Number(fullSize.width || 0) - targetX))
    const height = Math.min(Number(regionSize.height || 0), Math.max(0, Number(fullSize.height || 0) - targetY))
    if (width <= 0 || height <= 0) return null
    const bytesPerPixel = 4
    for (let y = 0; y < height; y += 1) {
      const sourceOffset = y * Number(regionSize.width || 0) * bytesPerPixel
      const targetOffset = ((targetY + y) * Number(fullSize.width || 0) + targetX) * bytesPerPixel
      regionBitmap.copy(fullBitmap, targetOffset, sourceOffset, sourceOffset + width * bytesPerPixel)
    }
    return nativeImage.createFromBitmap(fullBitmap, {
      width: Number(fullSize.width || 0),
      height: Number(fullSize.height || 0),
      scaleFactor: 1,
    })
  } catch (error) {
    writeElectronSmokeStage("icon-visual-screenshot:region-stitch-failed", {
      error: String(error?.message || error),
    })
    return null
  }
}

function resolveIconVisualImageDpr(size, rects = {}) {
  const width = Number(size?.width || 0)
  const rendererDpr = Number(rects?.devicePixelRatio || rects?.diagnostics?.devicePixelRatio || 0)
  if (rendererDpr > 0) return Math.max(1, Math.min(4, rendererDpr))
  const editorRight = Number(rects?.editorTitle?.x || 0) + Number(rects?.editorTitle?.width || 0)
  if (!width || !editorRight) return 1
  return Math.max(1, Math.min(4, width / Math.max(1, editorRight)))
}

async function collectIconVisualRendererCaptureState(win, timeoutMs = 3000) {
  if (!win || win.isDestroyed()) return null
  const script = `
    (async () => {
      const visible = (node) => {
        if (!node) return false
        const rect = node.getBoundingClientRect?.()
        const style = window.getComputedStyle?.(node)
        return Boolean(rect && rect.width > 0 && rect.height > 0 && style?.display !== "none" && style?.visibility !== "hidden" && Number(style?.opacity || 1) !== 0)
      }
      const findPreferredNode = (selector) => {
        if (Array.isArray(selector)) {
          for (const candidate of selector) {
            const match = document.querySelector(candidate)
            if (match) return match
          }
          return null
        }
        return document.querySelector(selector)
      }
      const rectOf = (selector) => {
        const node = findPreferredNode(selector)
        const rect = node?.getBoundingClientRect?.()
        return rect ? {
          text: String(node.textContent || "").trim().slice(0, 120),
          visible: visible(node),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        } : null
      }
      const describeNode = (node) => {
        if (!node) return null
        const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
        if (!element) return null
        return {
          tag: String(element.tagName || "").toLowerCase(),
          className: String(element.getAttribute?.("class") || ""),
          smoke: String(element.getAttribute?.("data-codek-smoke") || ""),
          text: String(element.textContent || "").trim().slice(0, 100),
        }
      }
      const hitTargetOf = (selector) => {
        const node = findPreferredNode(selector)
        const rect = node?.getBoundingClientRect?.()
        if (!rect || rect.width <= 0 || rect.height <= 0) return null
        const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2))
        const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2))
        const hit = document.elementFromPoint(x, y)
        return {
          x: Math.round(x),
          y: Math.round(y),
          target: describeNode(hit),
          closestTab: describeNode(hit?.closest?.(".tab")),
          closestTitle: describeNode(hit?.closest?.('[data-codek-smoke="editor-title-bar"]')),
          closestEditor: describeNode(hit?.closest?.(".editor-container, .monaco-editor")),
          closestWelcome: describeNode(hit?.closest?.(".welcome-page")),
        }
      }
      return {
        readyState: document.readyState,
        url: location.href,
        title: document.title,
        bodyTextSample: String(document.body?.innerText || "").slice(0, 320),
        tabCount: document.querySelectorAll(".tab").length,
        editorTitleCount: document.querySelectorAll('[data-codek-smoke="editor-title-bar"]').length,
        monacoEditorCount: document.querySelectorAll(".editor-container .monaco-editor").length,
        welcomePageCount: document.querySelectorAll(".welcome-page").length,
        activeFile: window.__codekSmokeIconVisualStateResult?.diagnostics?.activeFile || "",
        visibleRects: {
          devicePixelRatio: Number(window.devicePixelRatio || 1),
          tabBar: rectOf(".tab-bar"),
          firstTab: rectOf([".tab.active", ".tab"]),
          editorTitle: rectOf('[data-codek-smoke="editor-title-bar"]'),
          editorIcon: rectOf('[data-codek-smoke="editor-title-bar"] .file-icon-svg'),
          editorContainer: rectOf(".editor-container .monaco-editor"),
          welcomePage: rectOf(".welcome-page"),
        },
        hitTargets: {
          firstTab: hitTargetOf([".tab.active", ".tab"]),
          editorTitle: hitTargetOf('[data-codek-smoke="editor-title-bar"]'),
          editorContainer: hitTargetOf(".editor-container .monaco-editor"),
          welcomePage: hitTargetOf(".welcome-page"),
        },
      }
    })()
  `
  try {
    return await Promise.race([
      win.webContents.executeJavaScript(script),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), timeoutMs)),
    ])
  } catch (error) {
    return { error: String(error?.message || error) }
  }
}

async function captureIconVisualStateSmokeScreenshot(win, result = {}) {
  if (!isSmoke || !isIconVisualStateSmoke) return result
  if (!win || win.isDestroyed()) return result
  if (result?.screenshotExists && result?.screenshotPath) return result
  writeElectronSmokeStage("icon-visual-screenshot:prepare")
  try {
    if (!win.isVisible()) win.show()
    win.focus()
  } catch (error) {
    writeElectronSmokeStage("icon-visual-screenshot:focus-failed", { error: String(error?.message || error) })
  }
  const reportsDir = path.join(CODEK_DATA, "reports")
  fs.mkdirSync(reportsDir, { recursive: true })
  const screenshotPath = path.join(reportsDir, "workbench-icon-visual-state-latest.png")
  const restoredState = await restoreIconVisualStateBeforeCapture(win)
  writeElectronSmokeStage("icon-visual-screenshot:restore-state", restoredState)
  const paintState = await waitForIconVisualStatePaint(win)
  writeElectronSmokeStage("icon-visual-screenshot:paint-state", paintState)
  writeElectronSmokeStage("icon-visual-screenshot:capture-start", { screenshotPath })
  const image = await Promise.race([
    win.webContents.capturePage(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("icon visual screenshot capture timeout")), 5000)),
  ])
  const png = image.toPNG()
  fs.writeFileSync(screenshotPath, png)
  writeElectronSmokeStage("icon-visual-screenshot:capture-done", { screenshotPath, bytes: png.length })
  return {
    ...metricsWithEvidence,
    screenshotRestoredState: restoredState,
    paintState,
    screenshotVisualReady: isIconVisualStatePaintReady(paintState),
    screenshotPath,
    screenshotExists: fs.existsSync(screenshotPath),
  }
}

function isIconVisualStatePaintReady(state) {
  return Boolean(
    state
      && !state.timeout
      && state.tab
      && state.editorTitle
      && state.editorIcon
      && state.editor
      && !state.welcome,
  )
}

function isIconVisualRectsReady(rects) {
  return Boolean(
    rects
      && rects.tabBar?.visible
      && rects.firstTab?.visible
      && rects.editorTitle?.visible
      && rects.editorIcon?.visible
      && rects.editorContainer?.visible
      && !rects.welcomePage?.visible,
  )
}

function analyzeIconVisualScreenshotPixels(image, rects = {}) {
  try {
    const size = image.getSize()
    const bitmap = image.toBitmap()
    const width = Number(size.width || 0)
    const height = Number(size.height || 0)
    const dpr = resolveIconVisualImageDpr(size, rects)
    const bytesPerPixel = 4
    const sampleRect = (rect, fallback) => {
      const source = rect && Number(rect.width || 0) > 0 && Number(rect.height || 0) > 0 ? rect : fallback
      const x0 = Math.max(0, Math.floor(Number(source.x || 0) * dpr))
      const y0 = Math.max(0, Math.floor(Number(source.y || 0) * dpr))
      const x1 = Math.min(width, Math.ceil((Number(source.x || 0) + Number(source.width || 0)) * dpr))
      const y1 = Math.min(height, Math.ceil((Number(source.y || 0) + Number(source.height || 0)) * dpr))
      let samples = 0
      let varied = 0
      let bright = 0
      let previous = null
      for (let y = y0; y < y1; y += Math.max(1, Math.floor((y1 - y0) / 12))) {
        for (let x = x0; x < x1; x += Math.max(1, Math.floor((x1 - x0) / 24))) {
          const offset = (y * width + x) * bytesPerPixel
          const b = bitmap[offset]
          const g = bitmap[offset + 1]
          const r = bitmap[offset + 2]
          const luminance = (Number(r || 0) + Number(g || 0) + Number(b || 0)) / 3
          samples += 1
          if (luminance > 70) bright += 1
          const packed = `${r},${g},${b}`
          if (previous !== null && packed !== previous) varied += 1
          previous = packed
        }
      }
      return {
        samples,
        bright,
        varied,
        brightRatio: samples ? bright / samples : 0,
        variedRatio: samples ? varied / samples : 0,
        sampleBounds: { x0, y0, x1, y1 },
      }
    }
    const tab = sampleRect(rects.firstTab, { x: 394, y: 35, width: 176, height: 35 })
    const title = sampleRect(rects.editorTitle, { x: 394, y: 70, width: 1006, height: 38 })
    const icon = sampleRect(rects.editorIcon, { x: 405, y: 81, width: 16, height: 16 })
    const editor = sampleRect(rects.editorContainer, { x: 394, y: 108, width: 1006, height: 240 })
    const ready = tab.variedRatio > 0.01
      && title.variedRatio > 0.03
      && (icon.variedRatio > 0.02 || icon.brightRatio > 0.02)
      && (editor.variedRatio > 0.005 || editor.brightRatio > 0.002)
    return { ready, width, height, dpr, tab, title, icon, editor }
  } catch (error) {
    return { ready: false, error: String(error?.message || error) }
  }
}

function analyzeWorkbenchEditorScreenshotPixels(image, rects = {}) {
  try {
    const size = image.getSize()
    const bitmap = image.toBitmap()
    const width = Number(size.width || 0)
    const height = Number(size.height || 0)
    const reference = rects?.editorContainer || rects?.editorTitle || rects?.firstTab
    const referenceRight = reference ? Number(reference.x || 0) + Number(reference.width || 0) : width
    const dpr = Math.max(1, Math.min(4, width / Math.max(1, referenceRight)))
    const bytesPerPixel = 4
    const sampleRect = (rect, fallback) => {
      const source = rect && Number(rect.width || 0) > 0 && Number(rect.height || 0) > 0 ? rect : fallback
      const x0 = Math.max(0, Math.floor(Number(source.x || 0) * dpr))
      const y0 = Math.max(0, Math.floor(Number(source.y || 0) * dpr))
      const x1 = Math.min(width, Math.ceil((Number(source.x || 0) + Number(source.width || 0)) * dpr))
      const y1 = Math.min(height, Math.ceil((Number(source.y || 0) + Number(source.height || 0)) * dpr))
      let samples = 0
      let varied = 0
      let bright = 0
      let veryBright = 0
      let previous = null
      for (let y = y0; y < y1; y += Math.max(1, Math.floor((y1 - y0) / 14))) {
        for (let x = x0; x < x1; x += Math.max(1, Math.floor((x1 - x0) / 28))) {
          const offset = (y * width + x) * bytesPerPixel
          const b = bitmap[offset]
          const g = bitmap[offset + 1]
          const r = bitmap[offset + 2]
          const luminance = (Number(r || 0) + Number(g || 0) + Number(b || 0)) / 3
          samples += 1
          if (luminance > 55) bright += 1
          if (luminance > 115) veryBright += 1
          const packed = `${r},${g},${b}`
          if (previous !== null && packed !== previous) varied += 1
          previous = packed
        }
      }
      return {
        samples,
        bright,
        veryBright,
        varied,
        brightRatio: samples ? bright / samples : 0,
        veryBrightRatio: samples ? veryBright / samples : 0,
        variedRatio: samples ? varied / samples : 0,
      }
    }
    const welcomeVisible = rects.welcomePage?.visible === true
    const tab = sampleRect(rects.firstTab, { x: 394, y: 35, width: 176, height: 35 })
    const title = sampleRect(rects.editorTitle, { x: 394, y: 70, width: 1006, height: 38 })
    const editor = sampleRect(rects.editorContainer, { x: 394, y: 108, width: 1006, height: 360 })
    const welcome = welcomeVisible
      ? sampleRect(rects.welcomePage, { x: 780, y: 310, width: 520, height: 360 })
      : {
        samples: 0,
        bright: 0,
        veryBright: 0,
        varied: 0,
        brightRatio: 0,
        veryBrightRatio: 0,
        variedRatio: 0,
        skipped: true,
      }
    const tabReady = tab.variedRatio > 0.008 || tab.brightRatio > 0.001
    const ready = tabReady
      && title.variedRatio > 0.015
      && editor.variedRatio > 0.02
      && !welcomeVisible
    return { ready, width, height, dpr, tab, title, editor, welcome, welcomeVisible }
  } catch (error) {
    return { ready: false, error: String(error?.message || error) }
  }
}

async function restoreIconVisualStateBeforeCapture(win) {
  if (!win || win.isDestroyed()) return { skipped: true }
  const script = `
    (async () => {
      const controls = window.__codekSmokeWorkbenchControls || {}
      if (typeof controls.restoreIconVisualStateSmoke !== "function") {
        return { restored: false, reason: "restoreIconVisualStateSmoke missing" }
      }
      const result = await controls.restoreIconVisualStateSmoke()
      await new Promise((resolve) => setTimeout(resolve, 250))
      return {
        restored: true,
        activeFile: result && result.activeFile,
        openFiles: result && result.openFiles,
        visibleRects: result && result.visibleRects,
      }
    })()
  `
  try {
    return await Promise.race([
      win.webContents.executeJavaScript(script),
      new Promise((resolve) => setTimeout(() => resolve({ restored: false, timeout: true }), 8000)),
    ])
  } catch (error) {
    return { restored: false, error: String(error?.message || error) }
  }
}

async function waitForIconVisualStatePaint(win) {
  const script = `
    (async () => {
      const visible = (selector) => {
        const node = document.querySelector(selector)
        if (!node) return false
        const rect = node.getBoundingClientRect()
        const style = window.getComputedStyle(node)
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0
      }
      const snapshot = () => ({
        tab: visible(".tab"),
        editorTitle: visible('[data-codek-smoke="editor-title-bar"]'),
        editorIcon: visible('[data-codek-smoke="editor-title-bar"] .file-icon-svg'),
        editor: visible(".editor-container .monaco-editor"),
        welcome: visible(".welcome-page"),
      })
      const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      let state = snapshot()
      for (let index = 0; index < 20; index += 1) {
        await Promise.race([waitFrame(), delay(120)])
        state = snapshot()
        if (state.tab && state.editorTitle && state.editorIcon && state.editor && !state.welcome) break
      }
      await Promise.race([waitFrame(), delay(120)])
      return { ...snapshot(), href: location.href, innerTextSample: String(document.body?.innerText || "").slice(0, 160) }
    })()
  `
  try {
    return await Promise.race([
      win.webContents.executeJavaScript(script),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 3500)),
    ])
  } catch (error) {
    return { error: String(error?.message || error) }
  }
}

async function exerciseElectronSmokeRealProjectUi(win) {
  if (!isRealProjectUiSmoke) return
  const projectRoot = path.resolve(process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_ROOT || path.resolve(__dirname, ".."))
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`real project UI smoke root missing: ${projectRoot}`)
  }
  const targetBaseName = `codek-real-ui-smoke-target-${sanitizeSmokeTimestamp(ELECTRON_SMOKE_RUN_ID)}`
  const targetDir = path.join(projectRoot, targetBaseName)
  const nestedRelative = `${targetBaseName}/nested`
  const largeFileRelativeDefault = `${targetBaseName}/logs/large-real-project.log`
  const extremeFileRelative = `${targetBaseName}/logs/extreme-real-project-windowed.log`
  const searchToken = `codek-real-ui-search-token-${sanitizeSmokeTimestamp(ELECTRON_SMOKE_RUN_ID)}`
  const sameLineToken = `codek-real-ui-same-line-token-${sanitizeSmokeTimestamp(ELECTRON_SMOKE_RUN_ID)}`
  electronSmokeRealProjectUiTargetDir = targetDir
  const cleanupSummary = cleanupStaleRealProjectUiSmokeTargets(projectRoot, targetDir)
  writeElectronSmokeStage("real-project-ui:cleanup-stale-targets", cleanupSummary)
  try {
    fs.rmSync(targetDir, { recursive: true, force: true })
  } catch {
    // Ignore stale smoke cleanup failures on Windows locked files.
  }
  fs.mkdirSync(path.join(targetDir, "nested"), { recursive: true })
  fs.writeFileSync(path.join(targetDir, "nested", "seed.ts"), "export const realUiSmokeSeed = true\n", "utf-8")
  fs.writeFileSync(
    path.join(targetDir, "nested", "search-target.ts"),
    `export const realUiSearchToken = '${searchToken}'\n`,
    "utf-8",
  )
  fs.writeFileSync(
    path.join(targetDir, "nested", "same-line-repeated.ts"),
    [
      `export const sameLineSmoke = '${sameLineToken} ${sameLineToken} ${sameLineToken}'`,
      "",
    ].join("\n"),
    "utf-8",
  )
  const logsDir = path.join(targetDir, "logs")
  fs.mkdirSync(logsDir, { recursive: true })
  const configuredLargeFileRelative = String(process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_LARGE_FILE_RELATIVE || "").replace(/\\/g, "/").replace(/^\/+/, "")
  const largeFileRelative = configuredLargeFileRelative || largeFileRelativeDefault
  const largeFilePath = path.join(projectRoot, largeFileRelative)
  const largeFileBytes = Number(process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_LARGE_FILE_BYTES || 128 * 1024 * 1024)
  fs.mkdirSync(path.dirname(largeFilePath), { recursive: true })
  let shouldWriteLargeFile = true
  try {
    const existingPrefix = fs.existsSync(largeFilePath)
      ? fs.readFileSync(largeFilePath, { encoding: "utf8", flag: "r" }).slice(0, 4096)
      : ""
    shouldWriteLargeFile = !fs.existsSync(largeFilePath)
      || fs.statSync(largeFilePath).size < largeFileBytes
      || !existingPrefix.includes("codek smoke large log line keeps renderer rows bounded-v2")
  } catch {
    shouldWriteLargeFile = true
  }
  if (shouldWriteLargeFile) writeSmokeLargeLogFile(largeFilePath, largeFileBytes)
  const extremeFilePath = path.join(logsDir, "extreme-real-project-windowed.log")
  const extremeFirstWindow = Array.from({ length: 4096 }, (_value, index) => `CODEK_EXTREME_WINDOW_001 real project line ${index}`).join("\n")
  const extremeSecondWindow = Array.from({ length: 4096 }, (_value, index) => `CODEK_EXTREME_WINDOW_002 real project line ${index}`).join("\n")
  fs.writeFileSync(extremeFilePath, buildSmokeWindowedContent(extremeFirstWindow, extremeSecondWindow), "utf-8")
  const extremeFileSize = fs.statSync(extremeFilePath).size
  electronSmokeExplorerExtremeFile = {
    filePath: extremeFilePath,
    virtualSize: Math.max(MAX_RENDERER_READ_FILE_BYTES + 1, extremeFileSize),
  }

  electronSmokeExplorerReadDirCalls = []
  currentProjectRoot = projectRoot
  currentWorkspaceRoots = [projectRoot]
  currentWorkspaceFile = null
  await startFileWatcher(currentProjectRoot)
  writeElectronSmokeStage("real-project-ui:renderer-result:start")
  const rendererResult = await win.webContents.executeJavaScript(`
    (async () => {
      const waitForState = (predicate, label, timeout = 45000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("smoke state timeout: " + label))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })

      await waitForState(() => document.querySelector(".app-shell"), "app shell")
      await waitForState(() => window.__codekSmokeWorkbenchControls && typeof window.__codekSmokeWorkbenchControls.runRealProjectUiSmoke === "function", "real project UI smoke bridge")
      const result = await window.__codekSmokeWorkbenchControls.runRealProjectUiSmoke(${JSON.stringify({
        root: projectRoot,
        createTargetDir: nestedRelative,
        searchQuery: searchToken,
        expectedSearchPath: `${nestedRelative}/search-target.ts`,
        sameLineNeedle: sameLineToken,
        sameLineSearchPath: `${nestedRelative}/same-line-repeated.ts`,
        openFile: "frontend/vite-project/src/App.vue",
        largeFile: largeFileRelative,
        extremeFile: extremeFileRelative,
        skipCreateTarget: process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_SKIP_CREATE_TARGET === "1",
      })})
      window.__codekSmokeRealProjectUiResult = result
      return result
    })()
  `)
  writeElectronSmokeStage("real-project-ui:renderer-result:done", {
    projectRoot: rendererResult?.projectRoot || "",
    createTargetSkipped: rendererResult?.createTargetSkipped === true,
    keyCount: rendererResult && typeof rendererResult === "object" ? Object.keys(rendererResult).length : 0,
  })
  const createdFile = path.join(targetDir, "nested", "created-real-ui-smoke.ts")
  const createdFolder = path.join(targetDir, "nested", "created-real-ui-smoke-folder")
  const continuousFiles = Array.from({ length: 10 }, (_value, index) => {
    const oneBased = index + 1
    const suffix = String(oneBased).padStart(2, "0")
    const name = oneBased % 2 === 0 ? `continuous-folder-${suffix}` : `continuous-${suffix}.ts`
    return path.join(targetDir, "nested", name)
  })
  const staleRequestedFile = path.join(targetDir, "nested", "stale-snapshot-should-not-exist.ts")
  const staleSnapshotFile = path.join(targetDir, "stale-snapshot-should-not-exist.ts")
  const uniqueReadDirCalls = [...new Set(electronSmokeExplorerReadDirCalls)]
  writeElectronSmokeStage("real-project-ui:evidence:start")
  const enrichedResult = await writeRealProjectUiSmokeEvidence(win, {
    ...rendererResult,
    createdFileExistsOnDisk: fs.existsSync(createdFile),
    createdFolderExistsOnDisk: fs.existsSync(createdFolder),
    continuousCreateExistsOnDiskCount: continuousFiles.filter((entry) => fs.existsSync(entry)).length,
    continuousCreateAllExistOnDisk: continuousFiles.every((entry) => fs.existsSync(entry)),
    staleRequestedFileExistsOnDisk: fs.existsSync(staleRequestedFile),
    staleSnapshotFileExistsOnDisk: fs.existsSync(staleSnapshotFile),
    wrongRootFileExistsOnDisk: fs.existsSync(path.join(projectRoot, "created-real-ui-smoke.ts")),
    wrongRootFolderExistsOnDisk: fs.existsSync(path.join(projectRoot, "created-real-ui-smoke-folder")),
    workspaceScaleProfile: currentWorkspaceScaleProfile,
    readDirCalls: uniqueReadDirCalls,
    readDirCallCount: electronSmokeExplorerReadDirCalls.length,
    uniqueReadDirCallCount: uniqueReadDirCalls.length,
  })
  writeElectronSmokeStage("real-project-ui:evidence:done", {
    ready: enrichedResult?.ready === true,
    acceptanceCount: enrichedResult?.acceptance ? Object.keys(enrichedResult.acceptance).length : 0,
  })
  writeElectronSmokeStage("real-project-ui:renderer-summary:skipped")
  try {
    fs.rmSync(targetDir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup failures; this run uses an isolated target directory.
  }
  return enrichedResult
}

async function exerciseElectronSmokeMultiRootCreateTarget(win) {
  if (!isMultiRootCreateTargetSmoke) return
  const fixture = electronSmokeMultiRootCreateTargetFixture || prepareSmokeMultiRootCreateTargetProject()
  if (!electronSmokeMultiRootCreateTargetFixture) {
    currentProjectRoot = fixture.appsRoot
    currentWorkspaceRoots = [fixture.appsRoot, fixture.libsRoot]
    currentWorkspaceFile = fixture.workspaceFile
    await startFileWatcher(currentProjectRoot)
  }
  const rendererResult = await win.webContents.executeJavaScript(`
    (async () => {
      const describeSmokeDom = () => {
        const bodyText = String(document.body?.innerText || "").slice(0, 500)
        return {
          url: location.href,
          readyState: document.readyState,
          hasAppShell: Boolean(document.querySelector(".app-shell")),
          hasAuthGate: Boolean(document.querySelector(".auth-gate-root")),
          hasLoginView: Boolean(document.querySelector(".login-view") || document.querySelector("[data-codek-smoke='login-view']")),
          hasNativeHost: Boolean(document.querySelector('[data-codek-smoke="native-explorer-host"]')),
          hasWorkbenchControls: Boolean(window.__codekSmokeWorkbenchControls),
          hasMultiRootBridge: Boolean(window.__codekSmokeWorkbenchControls && typeof window.__codekSmokeWorkbenchControls.runMultiRootCreateTargetSmoke === "function"),
          tokenPresent: Boolean(localStorage.getItem("codek.auth.token")),
          rememberMe: localStorage.getItem("codek.auth.rememberMe"),
          autoLogin: localStorage.getItem("codek.auth.autoLogin"),
          bodyText,
        }
      }
      const waitForState = (predicate, label, timeout = 30000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("smoke state timeout: " + label + " " + JSON.stringify(describeSmokeDom())))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })

      await waitForState(() => document.querySelector(".app-shell"), "app shell", 60000)
      await waitForState(() => window.__codekSmokeWorkbenchControls && typeof window.__codekSmokeWorkbenchControls.runMultiRootCreateTargetSmoke === "function", "multi-root create target smoke bridge", 60000)
      const result = await window.__codekSmokeWorkbenchControls.runMultiRootCreateTargetSmoke(${JSON.stringify({
        appsRoot: fixture.appsRoot,
        libsRoot: fixture.libsRoot,
      })})
      window.__codekSmokeMultiRootCreateTargetResult = result
      return result
    })()
  `)
  const enrichedResult = {
    ...rendererResult,
    appsFileExistsOnDisk: fs.existsSync(fixture.selectedFile),
    appsFolderExistsOnDisk: fs.existsSync(fixture.selectedFolder),
    libsWrongFileExistsOnDisk: fs.existsSync(fixture.wrongFileInLibs),
    libsWrongFolderExistsOnDisk: fs.existsSync(fixture.wrongFolderInLibs),
    selectedFileDiskContent: fs.existsSync(fixture.selectedFile) ? fs.readFileSync(fixture.selectedFile, "utf-8") : "",
    fixture,
  }
  await win.webContents.executeJavaScript(`
    window.__codekSmokeMultiRootCreateTargetResult = ${JSON.stringify(enrichedResult)}
  `)
  return enrichedResult
}

async function exerciseElectronSmokeInlineCreateFocus(win) {
  if (!isInlineCreateFocusSmoke) return
  const projectRoot = path.resolve(process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_ROOT || path.resolve(__dirname, ".."))
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`inline create focus smoke root missing: ${projectRoot}`)
  }
  currentProjectRoot = projectRoot
  currentWorkspaceRoots = [projectRoot]
  await startFileWatcher(currentProjectRoot)
  const rendererResult = await win.webContents.executeJavaScript(`
    (async () => {
      const describeSmokeDom = () => {
        const bodyText = String(document.body?.innerText || "").slice(0, 500)
        return {
          url: location.href,
          readyState: document.readyState,
          hasAppShell: Boolean(document.querySelector(".app-shell")),
          hasNativeHost: Boolean(document.querySelector('[data-codek-smoke="native-explorer-host"]')),
          hasWorkbenchControls: Boolean(window.__codekSmokeWorkbenchControls),
          hasInlineCreateBridge: Boolean(window.__codekSmokeWorkbenchControls && typeof window.__codekSmokeWorkbenchControls.runInlineCreateFocusSmoke === "function"),
          bodyText,
        }
      }
      const waitForState = (predicate, label, timeout = 30000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("smoke state timeout: " + label + " " + JSON.stringify(describeSmokeDom())))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })

      await waitForState(() => document.querySelector(".app-shell"), "app shell", 60000)
      await waitForState(() => window.__codekSmokeWorkbenchControls && typeof window.__codekSmokeWorkbenchControls.runInlineCreateFocusSmoke === "function", "inline create focus smoke bridge", 60000)
      const result = await window.__codekSmokeWorkbenchControls.runInlineCreateFocusSmoke(${JSON.stringify({ root: projectRoot })})
      window.__codekSmokeInlineCreateFocusResult = result
      return result
    })()
  `)
  await win.webContents.executeJavaScript(`
    window.__codekSmokeInlineCreateFocusResult = ${JSON.stringify(rendererResult)}
  `)
  return rendererResult
}

async function exerciseElectronSmokeNotificationActionsClick(win) {
  if (!isNotificationActionsClickSmoke) return
  await bringSmokeWindowToForeground(win, "notification-actions-click")
  const mainThreadProgress = require("./services/extensions-host/mainThread/mainThreadProgress")
  const progressHandle = 91001
  const cancelProgressHandle = 91002
  const rendererEvents = []
  const extHostCancelCalls = []
  const progressCancelIpcPayloads = []
  const server = createElectronSmokeProgressServer(mainThreadProgress.MAIN_THREAD_PROGRESS_NID, extHostCancelCalls)
  const sendToRenderer = (channel, payload) => {
    rendererEvents.push({ channel, payload })
    win.webContents.send(channel, payload)
  }
  try { ipcMain.removeAllListeners("ext-host:progress-cancel") } catch {}
  mainThreadProgress.register(server, { ipcMain, sendToRenderer })
  ipcMain.on("ext-host:progress-cancel", (_event, payload = {}) => {
    progressCancelIpcPayloads.push(payload)
  })
  const rendererResult = await win.webContents.executeJavaScript(`
    (async () => {
      const describeSmokeDom = () => ({
        url: location.href,
        readyState: document.readyState,
        hasAppShell: Boolean(document.querySelector(".app-shell")),
        hasNotificationContainer: Boolean(document.querySelector(".notification-container")),
        hasWorkbenchControls: Boolean(window.__codekSmokeWorkbenchControls),
        extensionHostRuntimeBridgeReady: window.__codekSmokeExtensionHostRuntimeBridgeReady === true,
        hasNotificationClickBridge: Boolean(
          window.__codekSmokeWorkbenchControls
            && typeof window.__codekSmokeWorkbenchControls.runNotificationActionClickSmoke === "function"
        ),
        bodyText: String(document.body?.innerText || "").slice(0, 500),
      })
      const waitForState = (predicate, label, timeout = 30000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("notification action click smoke timeout: " + label + " " + JSON.stringify(describeSmokeDom())))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })

      await waitForState(() => document.querySelector(".app-shell"), "app shell", 60000)
      await waitForState(
        () => window.__codekSmokeWorkbenchControls && typeof window.__codekSmokeWorkbenchControls.runNotificationActionClickSmoke === "function",
        "notification action click smoke bridge",
        60000,
      )
      await waitForState(
        () => window.__codekSmokeExtensionHostRuntimeBridgeReady === true,
        "extension host runtime bridge ready",
        60000,
      )
      return true
    })()
  `)
  await server.callRpc("$startProgress", [
    progressHandle,
    {
      location: 15,
      title: "Smoke notification actions progress",
      source: "electron-smoke",
      cancellable: "Cancel Smoke",
      buttons: ["Primary Smoke"],
    },
    "codek.notification-smoke",
  ])
  await server.callRpc("$progressReport", [progressHandle, { message: "show actions", increment: 1, total: 3 }])
  const primaryClickResult = await win.webContents.executeJavaScript(`
    (async () => {
      const result = await window.__codekSmokeWorkbenchControls.runNotificationActionClickSmoke({ scenario: "primary" })
      window.__codekSmokeNotificationActionClickResult = result
      return result
    })()
  `)
  await server.callRpc("$progressEnd", [progressHandle])
  await server.callRpc("$startProgress", [
    cancelProgressHandle,
    {
      location: 15,
      title: "Smoke notification cancel progress",
      source: "electron-smoke",
      cancellable: "Cancel Smoke",
      buttons: ["Primary Smoke"],
    },
    "codek.notification-smoke",
  ])
  await server.callRpc("$progressReport", [cancelProgressHandle, { message: "show cancel", increment: 1, total: 3 }])
  const cancelClickResult = await win.webContents.executeJavaScript(`
    (async () => {
      const result = await window.__codekSmokeWorkbenchControls.runNotificationActionClickSmoke({ scenario: "cancel" })
      window.__codekSmokeNotificationActionClickResult = result
      return result
    })()
  `)
  await server.callRpc("$progressEnd", [cancelProgressHandle])
  const primaryIpcPayload = progressCancelIpcPayloads.find((payload) => payload && payload.handle === progressHandle) || null
  const cancelIpcPayload = progressCancelIpcPayloads.find((payload) => payload && payload.handle === cancelProgressHandle) || null
  const result = {
    ...primaryClickResult,
    primaryScenario: primaryClickResult,
    cancelScenario: cancelClickResult,
    progressHandle,
    cancelProgressHandle,
    rendererEvents,
    progressCancelIpcPayloads,
    primaryBackChannelChoice: primaryIpcPayload ? primaryIpcPayload.choice : undefined,
    cancelBackChannelChoice: cancelIpcPayload ? cancelIpcPayload.choice : undefined,
    primaryCancelIpcPayload: primaryIpcPayload,
    cancelIpcPayload,
    extHostCancelCalls,
    primaryTokenObserved: extHostCancelCalls.some((call) => call && call.method === "$acceptProgressCanceled" && Array.isArray(call.args) && call.args[0] === progressHandle),
    cancelTokenObserved: extHostCancelCalls.some((call) => call && call.method === "$acceptProgressCanceled" && Array.isArray(call.args) && call.args[0] === cancelProgressHandle),
  }
  await win.webContents.executeJavaScript(`
    window.__codekSmokeNotificationActionClickResult = ${JSON.stringify(result)}
  `)
  return result
}

async function exerciseElectronSmokeTaskProviderExecute(win) {
  if (!isTaskProviderExecuteSmoke && !isTaskProviderBackgroundOwnerSmoke) return
  const isBackgroundOwnerSmoke = isTaskProviderBackgroundOwnerSmoke
  const smokeCase = isBackgroundOwnerSmoke ? "task-provider-background-owner" : "task-provider-execute"
  await bringSmokeWindowToForeground(win, smokeCase)
  const mainThreadTask = require("./services/extensions-host/mainThread/mainThreadTask")
  const rendererEvents = []
  const providerTaskFactory = isBackgroundOwnerSmoke
    ? createElectronSmokeProviderBackgroundTask
    : createElectronSmokeProviderTask
  const server = createElectronSmokeTaskProviderServer(providerTaskFactory)
  const sendToRenderer = (channel, payload) => {
    rendererEvents.push({ channel, payload })
    win.webContents.send(channel, payload)
  }
  mainThreadTask.register(server, { sendToRenderer })
  await win.webContents.executeJavaScript(`
    (async () => {
      const describeSmokeDom = () => ({
        url: location.href,
        readyState: document.readyState,
        hasAppShell: Boolean(document.querySelector(".app-shell")),
        hasTaskPanel: Boolean(document.querySelector('[data-codek-smoke="task-workbench-panel"]')),
        hasWorkbenchControls: Boolean(window.__codekSmokeWorkbenchControls),
        bodyText: String(document.body?.innerText || "").slice(0, 500),
      })
      const waitForState = (predicate, label, timeout = 30000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("${smokeCase} smoke timeout: " + label + " " + JSON.stringify(describeSmokeDom())))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })
      await waitForState(
        () => document.querySelector(".app-shell") && window.__codekSmokeWorkbenchControls,
        "app shell and smoke workbench controls",
        60000,
      )
      await waitForState(
        () => window.__codekSmokeExtensionHostRuntimeBridgeReady === true,
        "extension host runtime bridge ready",
        60000,
      )
      return true
    })()
  `)
  await server.callRpc("$registerTaskProvider", [77, "npm"])
  await new Promise((resolve) => setTimeout(resolve, 250))
  const execution = await server.callRpc("$executeTask", [
    providerTaskFactory(),
  ])
  const panelHookResult = await win.webContents.executeJavaScript(`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const controls = window.__codekSmokeWorkbenchControls || {}
      if (typeof controls.openTaskProviderExecuteSmokePanel !== "function") {
        return {
          available: false,
          error: "openTaskProviderExecuteSmokePanel smoke control is not registered",
        }
      }
      try {
        let result = await controls.openTaskProviderExecuteSmokePanel()
        const started = Date.now()
        while (Date.now() - started < 10000) {
          const latestStatus = result?.taskPanelLatestStatus || result?.taskLatestStatus || ""
          const evidenceText = String(result?.taskEvidenceText || "")
          const snapshot = result?.snapshot || {}
          const capability = snapshot?.tasks?.capabilities || {}
          const executionEvidence = capability?.extensionTaskProviderBridge?.executionEvidence || {}
          const backgroundOwnerReady = ${JSON.stringify(isBackgroundOwnerSmoke)}
            && capability.terminalOwnership === "available"
            && executionEvidence.terminalOwnerResolved === true
            && executionEvidence.activeExecutionMapped === true
          if (backgroundOwnerReady || (!${JSON.stringify(isBackgroundOwnerSmoke)} && (latestStatus || evidenceText.includes("electron-provider-output")))) break
          await sleep(150)
          result = await controls.openTaskProviderExecuteSmokePanel()
        }
        return {
          available: true,
          result,
          error: "",
        }
      } catch (error) {
        return {
          available: true,
          result: null,
          error: String(error?.message || error || ""),
        }
      }
    })()
  `)
  const rendererResult = await win.webContents.executeJavaScript(`
    (async () => {
      const taskPanelNode = document.querySelector('[data-codek-smoke="task-workbench-panel"]')
      const taskRows = [...document.querySelectorAll('[data-codek-smoke="task-workbench-list"] [data-task-id]')]
      const taskEvidenceNode = document.querySelector('[data-codek-smoke="task-workbench-evidence"]')
      const text = String(document.body?.innerText || "")
      const panelHook = ${JSON.stringify(panelHookResult)}
      const taskEvidenceText = String(taskEvidenceNode?.textContent || "").trim()
      const taskOutputPreview = String(panelHook?.result?.taskLatestOutputPreview || panelHook?.result?.latestOutputPreview || "")
      const taskPanelLatestStatus = taskPanelNode?.getAttribute?.("data-task-workbench-latest-status")
        || panelHook?.result?.taskPanelLatestStatus
        || panelHook?.result?.taskLatestStatus
        || ""
      const smokeCase = ${JSON.stringify(smokeCase)}
      const taskName = ${JSON.stringify(isBackgroundOwnerSmoke ? "npm: electron provider watch owner" : "npm: electron provider smoke")}
      const expectedOutput = ${JSON.stringify(isBackgroundOwnerSmoke ? "terminalManager pty owner" : "electron-provider-output")}
      const snapshot = panelHook?.result?.snapshot || {}
      const capabilities = snapshot?.tasks?.capabilities || {}
      const lifecycle = snapshot?.tasks?.lifecycle || {}
      const extensionTaskProviderBridge = capabilities?.extensionTaskProviderBridge || {}
      const executionEvidence = extensionTaskProviderBridge?.executionEvidence || {}
      const terminalTabActions = Array.isArray(capabilities?.terminalTabActions) ? capabilities.terminalTabActions : []
      const taskOutputVisibleInEvidence = taskEvidenceText.includes(expectedOutput) || taskOutputPreview.includes(expectedOutput)
      const result = {
        smokeCase,
        taskProviderExecutePanelHookAvailable: Boolean(panelHook?.available),
        taskProviderExecutePanelHookError: panelHook?.error || "",
        taskProviderExecutePanelHook: panelHook?.result || null,
        taskPanelVisible: Boolean(taskPanelNode),
        taskPanelBlockedReason: taskPanelNode
          ? ""
          : panelHook?.available
            ? "Task provider execute smoke emitted ext-host:task-provider-execute from MainThreadTask, but openTaskProviderExecuteSmokePanel did not expose TaskWorkbenchPanel DOM: " + (panelHook?.error || "panel DOM stayed hidden after hook")
            : "Task provider execute smoke emitted ext-host:task-provider-execute from MainThreadTask, but App.vue has not registered the smoke-only openTaskProviderExecuteSmokePanel hook.",
        taskPanelViewId: taskPanelNode?.getAttribute?.("data-task-workbench-view-id") || "",
        taskPanelStateSource: taskPanelNode?.getAttribute?.("data-task-workbench-state-source") || "",
        taskPanelRunConfigCount: Number(taskPanelNode?.getAttribute?.("data-task-workbench-run-config-count") || 0),
        taskPanelLatestStatus,
        taskRows: taskRows.map((node) => ({
          taskId: node.getAttribute("data-task-id") || "",
          source: node.getAttribute("data-task-source") || "",
          text: String(node.textContent || "").trim(),
        })),
        taskEvidenceText,
        taskOutputPreview,
        taskOutputVisibleInEvidence,
        taskOutputBlockedReason: taskOutputVisibleInEvidence
          ? ""
          : "Task panel DOM is visible, but provider-backed executeTask output evidence was not observable in TaskWorkbenchPanel evidence.",
        bodyContainsTaskName: text.includes(taskName),
        terminalOwnership: capabilities?.terminalOwnership || "",
        supportsTerminateAll: capabilities?.supportsTerminateAll === true,
        supportsRestartActiveTerminal: capabilities?.supportsRestartActiveTerminal === true,
        activeExecutionCount: Number(capabilities?.activeExecutionCount || lifecycle?.activeExecutionCount || 0),
        terminalInstanceId: typeof capabilities?.terminalInstanceId === "number" ? capabilities.terminalInstanceId : lifecycle?.terminalInstanceId ?? null,
        processId: typeof capabilities?.processId === "number" ? capabilities.processId : lifecycle?.processId ?? null,
        extensionTaskProviderBridge,
        executionEvidence,
        terminalTabActions,
      }
      if (smokeCase === "task-provider-background-owner") {
        window.__codekSmokeTaskProviderBackgroundOwnerResult = result
      } else {
        window.__codekSmokeTaskProviderExecuteResult = result
      }
      return result
    })()
  `)
  const taskProviderActionResult = isBackgroundOwnerSmoke
    ? await win.webContents.executeJavaScript(`
      (async () => {
        const controls = window.__codekSmokeWorkbenchControls || {}
        if (typeof controls.runTaskProviderActionSmoke !== "function") {
          return {
            available: false,
            error: "runTaskProviderActionSmoke smoke control is not registered",
          }
        }
        try {
          return {
            available: true,
            result: await controls.runTaskProviderActionSmoke(),
            error: "",
          }
        } catch (error) {
          return {
            available: true,
            result: null,
            error: String(error?.message || error || ""),
          }
        }
      })()
    `)
    : null
  const result = {
    ...rendererResult,
    execution,
    rendererEvents,
    extHostCalls: server.calls,
    taskProviderActionResult,
  }
  await win.webContents.executeJavaScript(`
    if (${JSON.stringify(isBackgroundOwnerSmoke)}) {
      window.__codekSmokeTaskProviderBackgroundOwnerResult = ${JSON.stringify(result)}
    } else {
      window.__codekSmokeTaskProviderExecuteResult = ${JSON.stringify(result)}
    }
  `)
  return result
}

async function exerciseElectronSmokeDebugOutputBridge(win) {
  if (!isDebugOutputBridgeSmoke) return
  await bringSmokeWindowToForeground(win, "debug-output-bridge")
  const mainThreadOutputService = require("./services/extensions-host/mainThread/mainThreadOutputService")
  const outputBackingDir = path.join(CODEK_DATA, "electron-smoke-debug-output-bridge")
  fs.mkdirSync(outputBackingDir, { recursive: true })
  const backingFile = path.join(outputBackingDir, `output-${ELECTRON_SMOKE_RUN_ID}.log`)
  fs.writeFileSync(backingFile, "debug-output-smoke:first\n", "utf8")

  const rendererEvents = []
  const server = createElectronSmokeRpcServer(mainThreadOutputService.MAIN_THREAD_OUTPUT_SERVICE_NID)
  const sendToRenderer = (channel, payload) => {
    rendererEvents.push({ channel, payload })
    win.webContents.send(channel, payload)
  }
  mainThreadOutputService.register(server, { sendToRenderer })

  await win.webContents.executeJavaScript(`
    (async () => {
      const describeSmokeDom = () => ({
        url: location.href,
        readyState: document.readyState,
        hasAppShell: Boolean(document.querySelector(".app-shell")),
        hasWorkbenchControls: Boolean(window.__codekSmokeWorkbenchControls),
        extensionHostRuntimeBridgeReady: window.__codekSmokeExtensionHostRuntimeBridgeReady === true,
        bodyText: String(document.body?.innerText || "").slice(0, 500),
      })
      const waitForState = (predicate, label, timeout = 60000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("debug/output bridge smoke timeout: " + label + " " + JSON.stringify(describeSmokeDom())))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })
      await waitForState(() => document.querySelector(".app-shell") && window.__codekSmokeWorkbenchControls, "app shell and smoke controls")
      await waitForState(() => window.__codekSmokeExtensionHostRuntimeBridgeReady === true, "extension host runtime bridge ready")
      return true
    })()
  `)

  const channelLabel = "Debug Output Bridge Smoke"
  const firstLine = "debug-output-smoke:first\n"
  const secondLine = "debug-output-smoke:second\n"
  const channelId = await server.callRpc("$register", [
    channelLabel,
    { scheme: "file", path: backingFile },
    "log",
    "codek.electron-smoke-debug-output",
  ])
  await server.callRpc("$update", [channelId, 1, fs.statSync(backingFile).size])
  fs.appendFileSync(backingFile, secondLine, "utf8")
  await server.callRpc("$update", [channelId, 1, fs.statSync(backingFile).size])
  await server.callRpc("$reveal", [channelId, false])

  const outputEvidence = await win.webContents.executeJavaScript(`
    (async () => {
      const channelLabel = ${JSON.stringify(channelLabel)}
      const waitForState = (predicate, label, timeout = 10000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("debug/output bridge output timeout: " + label))
            return
          }
          setTimeout(tick, 120)
	        }
	        tick()
	      })
	      const controls = window.__codekSmokeWorkbenchControls || {}
	      if (typeof controls.openOutputPanel === "function") {
	        await controls.openOutputPanel()
	      }
	      await waitForState(() => document.querySelector('[data-codek-smoke="output-panel"]'), "output panel visible")
	      const findSnapshot = () => {
	        const evidence = window.__codekSmokeWorkbenchControls
          ?.getDebugOutputBridgeSnapshot?.(channelLabel)
        const snapshot = evidence?.output
        const renderer = evidence?.outputRenderer
        return snapshot
          && renderer
          && String(snapshot.preview || "").includes("debug-output-smoke:second")
          && String(renderer.text || "").includes("debug-output-smoke:second")
          ? evidence
          : null
      }
      const evidence = await waitForState(findSnapshot, "output snapshot and renderer content include backing file increment")
      const snapshot = evidence.output
      const renderer = evidence.outputRenderer
      return {
        channelLabel,
        serviceId: snapshot.serviceId || "",
        stateSource: snapshot.stateSource || "",
        channelName: snapshot.channelName || "",
        activeChannelName: snapshot.activeChannelName || "",
        visibleChannelName: snapshot.visibleChannelName || "",
        entryCount: Number(snapshot.entryCount || 0),
        updateMode: snapshot.updateMode || "",
        preview: String(snapshot.preview || ""),
        channelNames: Array.isArray(snapshot.channelNames) ? snapshot.channelNames : [],
        descriptor: Array.isArray(snapshot.channelDescriptors)
          ? snapshot.channelDescriptors.find((item) => item && item.id === channelLabel) || null
          : null,
        rendererOutputEvidence: {
          panelVisible: renderer.panelVisible === true,
          contentVisible: renderer.contentVisible === true,
          serviceSource: renderer.serviceSource || "",
          activeChannel: renderer.activeChannel || "",
          entryCount: Number(renderer.entryCount || 0),
          preview: String(renderer.preview || ""),
          text: String(renderer.text || ""),
        },
      }
    })()
  `)

  const debugEvidence = await win.webContents.executeJavaScript(`
    (async () => {
      const expression = "debug-output-bridge-repl-smoke"
      const controls = window.__codekSmokeWorkbenchControls || {}
      if (typeof controls.openDebugView === "function") {
        await controls.openDebugView()
        await new Promise((resolve) => setTimeout(resolve, 120))
      }
      if (typeof controls.runDebugOutputBridgeReplSmoke !== "function") {
        return {
          serviceId: "debugService",
          stateSource: "",
          expression,
          hasSetupDebugState: false,
          beforeCount: 0,
          afterCount: 0,
          inputCount: 0,
          errorCount: 0,
          outputCount: 0,
          entries: [],
          evaluateResult: "",
          evaluatePathReached: false,
          noDoubleAppend: false,
          blockedReason: "runDebugOutputBridgeReplSmoke smoke hook is not registered",
        }
      }
      return await controls.runDebugOutputBridgeReplSmoke(expression)
    })()
  `)

  const countOccurrences = (value, needle) => {
    const text = String(value || "")
    if (!needle) return 0
    let count = 0
    let index = 0
    while ((index = text.indexOf(needle, index)) !== -1) {
      count += 1
      index += needle.length
    }
    return count
  }
  const contentEvents = rendererEvents.filter((entry) => entry.channel === "ext-host:output-content")
  const contentEventContents = contentEvents.map((entry) => String(entry.payload?.content || ""))
  const backingFileContent = fs.readFileSync(backingFile, "utf8")
  const outputNoDoubleAppendEvidence = {
    contentEventCount: contentEvents.length,
    contentEventContents,
    expectedContentEventContents: [firstLine, secondLine],
    contentFirstCount: countOccurrences(contentEventContents.join(""), firstLine),
    contentSecondCount: countOccurrences(contentEventContents.join(""), secondLine),
    previewFirstCount: countOccurrences(outputEvidence.preview, firstLine),
    previewSecondCount: countOccurrences(outputEvidence.preview, secondLine),
    backingFileSize: Buffer.byteLength(backingFileContent),
    expectedBackingFileSize: Buffer.byteLength(firstLine) + Buffer.byteLength(secondLine),
    backingFileContentMatchesExpected: backingFileContent === `${firstLine}${secondLine}`,
    backingFileFirstCount: countOccurrences(backingFileContent, firstLine),
    backingFileSecondCount: countOccurrences(backingFileContent, secondLine),
    contentEventsMatchBackingFile: contentEventContents.join("") === backingFileContent,
    noDoubleAppend: contentEvents.length === 2
      && contentEventContents[0] === firstLine
      && contentEventContents[1] === secondLine
      && countOccurrences(outputEvidence.preview, firstLine) === 1
      && countOccurrences(outputEvidence.preview, secondLine) === 1
      && backingFileContent === `${firstLine}${secondLine}`,
  }

  const result = {
    smokeCase: "debug-output-bridge",
    outputEvidence,
    outputNoDoubleAppendEvidence,
    debugEvidence,
    rendererEvents,
    backingFile,
  }
  await win.webContents.executeJavaScript(`
    window.__codekSmokeDebugOutputBridgeResult = ${JSON.stringify(result)}
  `)
  return result
}

async function exerciseElectronSmokeOutputLog(win) {
  if (!isOutputLogSmoke) return
  await bringSmokeWindowToForeground(win, "output-log")
  const mainThreadOutputService = require("./services/extensions-host/mainThread/mainThreadOutputService")
  const outputBackingDir = path.join(CODEK_DATA, "electron-smoke-output-log")
  fs.mkdirSync(outputBackingDir, { recursive: true })
  const backingFile = path.join(outputBackingDir, `output-log-${ELECTRON_SMOKE_RUN_ID}.log`)
  const firstLine = "output-log-smoke:first\n"
  const secondLine = "output-log-smoke:second\n"
  const secretLine = "sk-output-log-secret-should-not-leak\n"
  fs.writeFileSync(backingFile, firstLine, "utf8")

  const rendererEvents = []
  const server = createElectronSmokeRpcServer(mainThreadOutputService.MAIN_THREAD_OUTPUT_SERVICE_NID)
  const sendToRenderer = (channel, payload) => {
    rendererEvents.push({ channel, payload })
    win.webContents.send(channel, payload)
  }
  mainThreadOutputService.register(server, { sendToRenderer })

  await win.webContents.executeJavaScript(`
    (async () => {
      const describeSmokeDom = () => ({
        url: location.href,
        readyState: document.readyState,
        hasAppShell: Boolean(document.querySelector(".app-shell")),
        hasWorkbenchControls: Boolean(window.__codekSmokeWorkbenchControls),
        extensionHostRuntimeBridgeReady: window.__codekSmokeExtensionHostRuntimeBridgeReady === true,
        bodyText: String(document.body?.innerText || "").slice(0, 500),
      })
      const waitForState = (predicate, label, timeout = 60000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("output/log smoke timeout: " + label + " " + JSON.stringify(describeSmokeDom())))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })
      await waitForState(() => document.querySelector(".app-shell") && window.__codekSmokeWorkbenchControls, "app shell and smoke controls")
      await waitForState(() => window.__codekSmokeExtensionHostRuntimeBridgeReady === true, "extension host runtime bridge ready")
      return true
    })()
  `)

  const channelLabel = "Output Log Smoke"
  const channelId = await server.callRpc("$register", [
    channelLabel,
    { scheme: "file", path: backingFile },
    "log",
    "codek.electron-smoke-output-log",
  ])
  await server.callRpc("$update", [channelId, 1, fs.statSync(backingFile).size])
  fs.appendFileSync(backingFile, secondLine, "utf8")
  await server.callRpc("$update", [channelId, 1, fs.statSync(backingFile).size])
  await server.callRpc("$reveal", [channelId, false])

  const beforeClearEvidence = await win.webContents.executeJavaScript(`
    (async () => {
      const channelLabel = ${JSON.stringify(channelLabel)}
      const waitForState = (predicate, label, timeout = 10000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("output/log evidence timeout: " + label))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })
      const findSnapshot = () => {
        const snapshot = window.__codekSmokeWorkbenchControls
          ?.getDebugOutputBridgeSnapshot?.(channelLabel)
          ?.output
        return snapshot && String(snapshot.preview || "").includes("output-log-smoke:second")
          ? snapshot
          : null
      }
      const snapshot = await waitForState(findSnapshot, "output snapshot includes backing file increment")
      window.__codekSmokeWorkbenchControls?.openOutputPanel?.()
      await waitForState(() => document.querySelector('[data-codek-smoke="output-panel"]'), "output panel smoke anchor")
      const panel = document.querySelector('[data-codek-smoke="output-panel"]')
      return {
        channelLabel,
        output: {
          serviceId: snapshot.serviceId || "",
          stateSource: snapshot.stateSource || "",
          channelName: snapshot.channelName || "",
          activeChannelName: snapshot.activeChannelName || "",
          visibleChannelName: snapshot.visibleChannelName || "",
          entryCount: Number(snapshot.entryCount || 0),
          preview: String(snapshot.preview || ""),
          ownerEvidence: snapshot.ownerEvidence || null,
          channelNames: Array.isArray(snapshot.channelNames) ? snapshot.channelNames : [],
          descriptor: Array.isArray(snapshot.channelDescriptors)
            ? snapshot.channelDescriptors.find((item) => item && item.id === channelLabel) || null
            : null,
        },
        panelDataset: panel ? {
          codekSmoke: panel.getAttribute("data-codek-smoke") || "",
          owner: panel.getAttribute("data-output-owner") || "",
          rendererOwner: panel.getAttribute("data-output-renderer-owner") || "",
          mainThreadOwner: panel.getAttribute("data-output-main-thread-owner") || "",
          stateSource: panel.getAttribute("data-output-state-source") || "",
          uiOwnerState: panel.getAttribute("data-output-ui-owner-state") || "",
          evidenceState: panel.getAttribute("data-output-evidence-state") || "",
          remainingGap: panel.getAttribute("data-output-remaining-gap") || "",
          channelCount: panel.getAttribute("data-output-channel-count") || "",
        } : null,
      }
    })()
  `)

  fs.appendFileSync(backingFile, secretLine, "utf8")
  await server.callRpc("$update", [channelId, 3, fs.statSync(backingFile).size])
  const afterClearEvidence = await win.webContents.executeJavaScript(`
    (async () => {
      const channelLabel = ${JSON.stringify(channelLabel)}
      const waitForState = (predicate, label, timeout = 10000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("output/log clear timeout: " + label))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })
      const snapshot = await waitForState(() => {
        const value = window.__codekSmokeWorkbenchControls
          ?.getDebugOutputBridgeSnapshot?.(channelLabel)
          ?.output
        return value && Number(value.entryCount || 0) === 0 ? value : null
      }, "output snapshot clear")
      return {
        entryCount: Number(snapshot.entryCount || 0),
        preview: String(snapshot.preview || ""),
        updateMode: snapshot.updateMode || "",
        ownerEvidence: snapshot.ownerEvidence || null,
      }
    })()
  `)

  const evidenceJson = JSON.stringify({
    owner: beforeClearEvidence.output?.ownerEvidence,
    panelDataset: beforeClearEvidence.panelDataset,
    afterClearOwner: afterClearEvidence.ownerEvidence,
  })
  const result = {
    smokeCase: "output-log",
    channelLabel,
    rendererEvents,
    beforeClearEvidence,
    afterClearEvidence,
    backingFile,
    ownerEvidenceLeakCheck: {
      rawSecretAbsent: !evidenceJson.includes(secretLine.trim()),
      rawFirstLineAbsent: !evidenceJson.includes(firstLine.trim()),
      rawSecondLineAbsent: !evidenceJson.includes(secondLine.trim()),
      partialUiOwnerNotConnected: !evidenceJson.includes("connected"),
    },
  }
  await win.webContents.executeJavaScript(`
    window.__codekSmokeOutputLogResult = ${JSON.stringify(result)}
  `)
  return result
}

async function exerciseElectronSmokeDebugSession(win) {
  if (!isDebugSessionSmoke) return
  await bringSmokeWindowToForeground(win, "debug-session")
  const rendererScript = `
    (async () => {
      const smokeStartedAt = Date.now()
      const describeSmokeDom = () => ({
        url: location.href,
        readyState: document.readyState,
        hasAppShell: Boolean(document.querySelector(".app-shell")),
        hasWorkbenchControls: Boolean(window.__codekSmokeWorkbenchControls),
        hasDebugPanel: Boolean(document.querySelector(".debug-panel")),
        hasConfigSelect: Boolean(document.querySelector(".debug-panel .config-select")),
        hasStartButton: Boolean(document.querySelector('.debug-panel .toolbar-left .toolbar-btn[title="开始调试"]')),
        bodyText: String(document.body?.innerText || "").slice(0, 500),
      })
      const waitForState = (predicate, label, timeout = 60000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("debug session smoke timeout: " + label + " " + JSON.stringify(describeSmokeDom())))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })
      const projectRoot = ${JSON.stringify(currentProjectRoot || "")}
      const program = ${JSON.stringify(path.join(currentProjectRoot || CODEK_DATA, "src", "debug-session-smoke.js"))}
      const cloneSession = (snapshot) => {
        const session = snapshot?.debug?.session || snapshot?.session || snapshot || {}
        return {
          sessionId: typeof session.sessionId === "string" ? session.sessionId : "",
          adapterType: typeof session.adapterType === "string" ? session.adapterType : "",
          phase: typeof session.phase === "string" ? session.phase : "",
          stateSource: typeof session.stateSource === "string" ? session.stateSource : "",
          isRunning: session.isRunning === true,
          paused: session.paused === true,
          capabilities: session.capabilities && typeof session.capabilities === "object" ? session.capabilities : null,
          threadCount: Array.isArray(session.threads) ? session.threads.length : 0,
        }
      }
      const readSnapshot = () => {
        const controls = window.__codekSmokeWorkbenchControls || {}
        if (typeof controls.getDebugOutputBridgeSnapshot !== "function") return null
        return controls.getDebugOutputBridgeSnapshot("Electron Debug Session Smoke")?.debug || null
      }
      await waitForState(() => document.querySelector(".app-shell") && window.__codekSmokeWorkbenchControls, "app shell and smoke controls")
      if (typeof window.__codekSmokeWorkbenchControls.openDebugView === "function") {
        await window.__codekSmokeWorkbenchControls.openDebugView()
        await new Promise((resolve) => setTimeout(resolve, 240))
      }
      if (!window.codek?.dap?.start || !window.codek?.dap?.send || !window.codek?.dap?.stop || !window.codek?.dap?.onEvent) {
        return {
          ok: false,
          blocked: true,
          blockedReason: "window.codek.dap preload bridge is not available in the Electron renderer.",
          dom: describeSmokeDom(),
        }
      }
      const launchConfig = {
        type: "node",
        request: "launch",
        name: "Electron Smoke: Debug Session",
        program,
        cwd: projectRoot,
        noDebug: true,
        confirmed: true,
      }
      const started = await window.codek.dap.start("node", launchConfig)
      const startedSessionId = String(started?.sessionId || "")
      const received = []
      let dispose = null
      if (typeof window.codek.dap.onEvent === "function") {
        dispose = window.codek.dap.onEvent((event) => {
          if (event?.sessionId === startedSessionId) {
            received.push(event)
          }
        })
      }
      const sendRequest = async (command, args = {}) => {
        const seq = received.length + 1
        await window.codek.dap.send(startedSessionId, JSON.stringify({ seq, type: "request", command, arguments: args }))
      }
      await sendRequest("initialize", {
        adapterID: "node",
        clientID: "codek-electron-smoke",
        clientName: "Codek Electron Smoke",
        supportsVariableType: true,
      })
      await new Promise((resolve) => setTimeout(resolve, 400))
      await sendRequest("launch", launchConfig)
      await new Promise((resolve) => setTimeout(resolve, 400))
      await window.codek.dap.stop(startedSessionId)
      if (typeof dispose === "function") dispose()
      const finalSnapshot = readSnapshot()
      const session = cloneSession({ debug: { session: {
        ...(finalSnapshot || {}),
        sessionId: startedSessionId,
        adapterType: started?.adapterType || "node",
        stateSource: finalSnapshot?.stateSource || "debugState",
        isRunning: true,
      } } })
      const sessionId = session.sessionId
      const capabilities = session.capabilities || {}
      const capabilityKeys = Object.keys(capabilities).sort()
      return {
        ok: true,
        smokeCase: "debug-session",
        sessionObserved: Boolean(sessionId),
        elapsedMs: Date.now() - smokeStartedAt,
        dapMetadataOnly: true,
        metadata: {
          sessionIdPrefix: sessionId ? String(sessionId).slice(0, 4) : "",
          sessionIdLength: sessionId ? String(sessionId).length : 0,
          adapterType: session.adapterType,
          phase: session.phase,
          stateSource: session.stateSource,
          isRunningObserved: session.isRunning,
          pausedObserved: session.paused,
          capabilityKeys,
          threadCount: session.threadCount,
        },
        bridgeEvidence: {
          source: "MainThreadDebugService.dapIpcBridge",
          rendererHook: "window.codek.dap.start",
          dapIpc: {
            start: Boolean(window.codek?.dap?.start),
            send: Boolean(window.codek?.dap?.send),
            stop: Boolean(window.codek?.dap?.stop),
            onEvent: Boolean(window.codek?.dap?.onEvent),
          },
          debugStateSource: session.stateSource,
          debugPanelObserved: Boolean(document.querySelector(".debug-panel")),
          eventCount: received.length,
        },
        redaction: {
          noExpressionText: true,
          noSourcePathText: true,
          noAdapterArgsText: true,
          returnedFields: ["smokeCase", "sessionObserved", "elapsedMs", "dapMetadataOnly", "metadata", "bridgeEvidence", "redaction", "debugViewContainerOwner"],
        },
        debugViewContainerOwner: {
          status: "partial",
          connected: false,
          reason: "Observed DebugPanel/debugState in the Electron window; this smoke does not claim the full VS Code Debug View Container owner.",
        },
      }
    })()
  `
  try {
    const result = await win.webContents.executeJavaScript(rendererScript)
    if (result && typeof result === "object") {
      result.mainThreadBridgeEvidence = latestDapBridgeEvidence || null
      if (latestDapBridgeEvidence?.capabilityKeys?.length && result.metadata) {
        result.metadata.capabilityKeys = latestDapBridgeEvidence.capabilityKeys
      }
      if (latestDapBridgeEvidence?.adapterType && result.metadata) {
        result.metadata.adapterType = result.metadata.adapterType || latestDapBridgeEvidence.adapterType
      }
    }
    await win.webContents.executeJavaScript(`
      window.__codekSmokeDebugSessionResult = ${JSON.stringify(result)}
    `)
    return result
  } catch (error) {
    const result = {
      ok: false,
      smokeCase: "debug-session",
      blocked: true,
      blockedReason: String(error?.message || error),
      dapMetadataOnly: true,
      metadata: {
        sessionIdPrefix: "",
        sessionIdLength: 0,
        adapterType: "",
        phase: "",
        stateSource: "",
        isRunningObserved: false,
        pausedObserved: false,
        capabilityKeys: [],
        threadCount: 0,
      },
      bridgeEvidence: {
        source: "MainThreadDebugService.dapIpcBridge",
        rendererHook: "DebugPanel.toolbar.start",
        dapIpc: { start: false, send: false, stop: false, onEvent: false },
        debugStateSource: "",
        debugPanelObserved: false,
      },
      redaction: {
        noExpressionText: true,
        noSourcePathText: true,
        noAdapterArgsText: true,
      },
      debugViewContainerOwner: {
        status: "partial",
        connected: false,
        reason: "Electron smoke could not observe a completed DebugPanel/debugState DAP session; full Debug View Container owner remains outside this thread.",
      },
    }
    await win.webContents.executeJavaScript(`
      window.__codekSmokeDebugSessionResult = ${JSON.stringify(result)}
    `).catch(() => {})
    return result
  }
}

async function exerciseElectronSmokeTestingPublishResults(win) {
  if (!isTestingPublishResultsSmoke) return
  await bringSmokeWindowToForeground(win, "testing-publish-results")
  const projectRoot = currentProjectRoot || process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_ROOT || CODEK_DATA || ""
  const rendererScript = `
    (async () => {
      const describeSmokeDom = () => ({
        url: location.href,
        readyState: document.readyState,
        hasAppShell: Boolean(document.querySelector(".app-shell")),
        hasTestingEvidenceSurface: Boolean(document.querySelector('[data-agent-evidence-surface="testing"]')),
        hasResultPeekOwner: Boolean(document.querySelector('[data-codek-smoke="testing-result-peek-visible-owner"]')),
        hasWorkbenchControls: Boolean(window.__codekSmokeWorkbenchControls),
        hasTestingPublishBridge: Boolean(
          window.__codekSmokeWorkbenchControls
            && typeof window.__codekSmokeWorkbenchControls.runTestingPublishResultsSmoke === "function"
        ),
        hasPreloadPublishApi: Boolean(window.codek && typeof window.codek.publishExtHostTestingResults === "function"),
        bodyText: String(document.body?.innerText || "").slice(0, 500),
      })
      const waitForState = (predicate, label, timeout = 60000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("testing publish results smoke timeout: " + label + " " + JSON.stringify(describeSmokeDom())))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })
      window.__codekSmokeTestingPublishResultsStage = {
        smokeCase: "testing-publish-results",
        owner: "desktop/main.js exerciseElectronSmokeTestingPublishResults",
        dispatcherReady: true,
        projectRoot: ${JSON.stringify(projectRoot)},
      }
      await waitForState(
        () => document.querySelector(".app-shell") && window.__codekSmokeWorkbenchControls,
        "app shell and smoke workbench controls",
        60000,
      )
      await waitForState(
        () => typeof window.__codekSmokeWorkbenchControls.runTestingPublishResultsSmoke === "function",
        "testing publish results smoke bridge",
        60000,
      )
      const result = await window.__codekSmokeWorkbenchControls.runTestingPublishResultsSmoke(${JSON.stringify({ root: projectRoot })})
      window.__codekSmokeTestingPublishResults = {
        ...result,
        mainDispatcher: {
          owner: "desktop/main.js exerciseElectronSmokeTestingPublishResults",
          invoked: true,
          envFlag: "CODEK_ELECTRON_SMOKE_TESTING_PUBLISH_RESULTS",
        },
      }
      return window.__codekSmokeTestingPublishResults
    })()
  `
  const rendererResult = await Promise.race([
    win.webContents.executeJavaScript(rendererScript),
    new Promise((resolve) => setTimeout(() => {
      writeElectronSmokeStage("testing-publish-results:renderer-timeout", {
        reason: "renderer bridge did not return within 30000ms",
      })
      resolve({
        smokeCase: "testing-publish-results",
        timedOut: true,
        blocked: true,
        blockedReason: "testing publish results renderer bridge did not return before the smoke timeout; no Testing result publish evidence is faked",
      })
    }, 30000)),
  ])
  if (!rendererResult?.timedOut) {
    await win.webContents.executeJavaScript(`
      window.__codekSmokeTestingPublishResults = ${JSON.stringify(rendererResult)}
    `)
  }
  return rendererResult
}

async function exerciseElectronSmokeNotebookMarkdownPreview(win) {
  if (!isNotebookMarkdownPreviewSmoke) return
  await bringSmokeWindowToForeground(win, "notebook-markdown-preview")
  const projectRoot = currentProjectRoot || process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_ROOT || CODEK_DATA || ""
  const rendererScript = `
    (async () => {
      const describeSmokeDom = () => ({
        url: location.href,
        readyState: document.readyState,
        hasAppShell: Boolean(document.querySelector(".app-shell")),
        hasEditorPart: Boolean(document.querySelector("[data-workbench-editor-part='true']")),
        hasWorkbenchControls: Boolean(window.__codekSmokeWorkbenchControls),
        hasNotebookSmokeOwner: Boolean(window.__codekSmokeWorkbenchControls && typeof window.__codekSmokeWorkbenchControls.runNotebookMarkdownPreviewSmoke === "function"),
        bodyText: String(document.body?.innerText || "").slice(0, 500),
      })
      const waitForState = (predicate, label, timeout = 60000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("notebook markdown preview smoke timeout: " + label + " " + JSON.stringify(describeSmokeDom())))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })
      await waitForState(() => document.querySelector(".app-shell") && window.__codekSmokeWorkbenchControls, "app shell and smoke controls")
      await waitForState(() => typeof window.__codekSmokeWorkbenchControls.runNotebookMarkdownPreviewSmoke === "function", "notebook markdown preview smoke owner")
      const result = await window.__codekSmokeWorkbenchControls.runNotebookMarkdownPreviewSmoke({
        root: ${JSON.stringify(projectRoot)},
        resource: "electron-smoke-notebook.md",
        notebookUri: "electron-smoke-notebook.codek-notebook",
        rendererId: "codek-notebook-markdown-preview-smoke-renderer",
        kernelId: "codek-notebook-markdown-preview-smoke-kernel",
        content: "# Notebook markdown preview smoke\\n\\nRenderer message bridge.",
      })
      window.__codekSmokeNotebookMarkdownPreviewResult = result
      return result
    })()
  `
  return win.webContents.executeJavaScript(rendererScript)
}

async function exerciseElectronSmokeAccessibleViewVisibleOwner(win) {
  if (!isAccessibleViewVisibleOwnerSmoke) return
  await bringSmokeWindowToForeground(win, "accessible-view-visible-owner")
  const projectRoot = currentProjectRoot || process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_ROOT || CODEK_DATA || ""
  const rendererScript = `
    (async () => {
      const describeSmokeDom = () => ({
        url: location.href,
        readyState: document.readyState,
        hasAppShell: Boolean(document.querySelector(".app-shell")),
        hasAccessibleViewDomShell: Boolean(document.querySelector('[data-codek-smoke="accessible-view-dom-shell"]')),
        hasWorkbenchControls: Boolean(window.__codekSmokeWorkbenchControls),
        hasAccessibleViewVisibleOwnerBridge: Boolean(
          window.__codekSmokeWorkbenchControls
            && typeof window.__codekSmokeWorkbenchControls.runAccessibleViewVisibleOwnerSmoke === "function"
        ),
        bodyText: String(document.body?.innerText || "").slice(0, 500),
      })
      const waitForState = (predicate, label, timeout = 60000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("accessible view visible owner smoke timeout: " + label + " " + JSON.stringify(describeSmokeDom())))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })
      await waitForState(
        () => document.querySelector(".app-shell") && window.__codekSmokeWorkbenchControls,
        "app shell and smoke workbench controls",
        60000,
      )
      await waitForState(
        () => typeof window.__codekSmokeWorkbenchControls.runAccessibleViewVisibleOwnerSmoke === "function",
        "accessible view visible owner smoke bridge",
        60000,
      )
      const result = await window.__codekSmokeWorkbenchControls.runAccessibleViewVisibleOwnerSmoke({
        root: ${JSON.stringify(projectRoot)},
        providerId: "codek.accessibleView.visibleOwnerElectronSmoke",
        content: "Accessible View visible owner Electron smoke\\nSecond line",
        nextContent: "Accessible View visible owner Electron smoke\\nSecond line\\nNext action content",
      })
      window.__codekSmokeAccessibleViewVisibleOwnerResult = result
      return result
    })()
  `
  const rendererResult = await win.webContents.executeJavaScript(rendererScript)
  await win.webContents.executeJavaScript(`
    window.__codekSmokeAccessibleViewVisibleOwnerResult = ${JSON.stringify(rendererResult)}
  `)
  return rendererResult
}

async function exerciseElectronSmokeWorkspaceTrustDowngradeRestart(win) {
  if (!isWorkspaceTrustDowngradeRestartSmoke) return
  await bringSmokeWindowToForeground(win, "workspace-trust-downgrade-restart")
  const projectRoot = currentProjectRoot || process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_ROOT || CODEK_DATA || ""
  const rendererScript = `
    (async () => {
      const describeSmokeDom = () => ({
        url: location.href,
        readyState: document.readyState,
        hasAppShell: Boolean(document.querySelector(".app-shell")),
        hasWorkspaceTrustBanner: Boolean(document.querySelector('[data-codek-smoke="workspace-trust-restricted-banner"]')),
        hasExtensionTrustRemoteAuthSurface: Boolean(document.querySelector('[data-codek-smoke="extension-trust-remote-auth-workbench"]')),
        hasWorkbenchControls: Boolean(window.__codekSmokeWorkbenchControls),
        hasWorkspaceTrustDowngradeRestartBridge: Boolean(
          window.__codekSmokeWorkbenchControls
            && typeof window.__codekSmokeWorkbenchControls.runWorkspaceTrustDowngradeRestartSmoke === "function"
        ),
        bodyText: String(document.body?.innerText || "").slice(0, 500),
      })
      const waitForState = (predicate, label, timeout = 30000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("workspace trust downgrade/restart smoke timeout: " + label + " " + JSON.stringify(describeSmokeDom())))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })
      await waitForState(
        () => document.querySelector(".app-shell") && window.__codekSmokeWorkbenchControls,
        "app shell and smoke workbench controls",
        60000,
      )
      await waitForState(
        () => typeof window.__codekSmokeWorkbenchControls.runWorkspaceTrustDowngradeRestartSmoke === "function",
        "workspace trust downgrade/restart smoke bridge",
        60000,
      )
      const result = await window.__codekSmokeWorkbenchControls.runWorkspaceTrustDowngradeRestartSmoke(${JSON.stringify({ root: projectRoot })})
      window.__codekSmokeWorkspaceTrustDowngradeRestartResult = result
      return result
    })()
  `
  const rendererResult = await Promise.race([
    win.webContents.executeJavaScript(rendererScript),
    new Promise((resolve) => setTimeout(async () => {
      writeElectronSmokeStage("workspace-trust-downgrade-restart:renderer-timeout", {
        reason: "renderer bridge did not return within 20000ms",
      })
      try {
        resolve({
          timedOut: true,
          blocked: true,
          blockedReason: "workspace trust downgrade/restart renderer bridge did not return before the smoke timeout; partial stage/result evidence may remain in renderer console without faking restart completion",
        })
      } catch (error) {
        resolve({
          timedOut: true,
          blocked: true,
          blockedReason: "workspace trust downgrade/restart renderer bridge did not return before the smoke timeout and partial renderer evidence could not be collected",
          error: String(error?.message || error),
        })
      }
    }, 20000)),
  ])
  if (!rendererResult?.timedOut) {
    await win.webContents.executeJavaScript(`
      window.__codekSmokeWorkspaceTrustDowngradeRestartResult = ${JSON.stringify(rendererResult)}
    `)
  }
  return rendererResult
}

async function exerciseElectronSmokeWorkspaceTrustRequestDialog(win) {
  if (!isWorkspaceTrustRequestDialogSmoke) return
  await bringSmokeWindowToForeground(win, "workspace-trust-request-dialog")
  const projectRoot = currentProjectRoot || process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_ROOT || CODEK_DATA || ""
  const rendererScript = `
    (async () => {
      const describeSmokeDom = () => ({
        url: location.href,
        readyState: document.readyState,
        hasAppShell: Boolean(document.querySelector(".app-shell")),
        hasDialogModal: Boolean(document.querySelector('[data-codek-smoke="codek-dialog-service-modal"]')),
        hasWorkbenchControls: Boolean(window.__codekSmokeWorkbenchControls),
        hasWorkspaceTrustRequestDialogBridge: Boolean(
          window.__codekSmokeWorkbenchControls
            && typeof window.__codekSmokeWorkbenchControls.runWorkspaceTrustRequestDialogSmoke === "function"
        ),
        bodyText: String(document.body?.innerText || "").slice(0, 500),
      })
      const waitForState = (predicate, label, timeout = 60000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("workspace trust request dialog smoke timeout: " + label + " " + JSON.stringify(describeSmokeDom())))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })
      await waitForState(
        () => document.querySelector(".app-shell") && window.__codekSmokeWorkbenchControls,
        "app shell and smoke workbench controls",
        60000,
      )
      await waitForState(
        () => typeof window.__codekSmokeWorkbenchControls.runWorkspaceTrustRequestDialogSmoke === "function",
        "workspace trust request dialog smoke bridge",
        60000,
      )
      const result = await window.__codekSmokeWorkbenchControls.runWorkspaceTrustRequestDialogSmoke(${JSON.stringify({ root: projectRoot })})
      window.__codekSmokeWorkspaceTrustRequestDialogResult = result
      return result
    })()
  `
  const rendererResult = await Promise.race([
    win.webContents.executeJavaScript(rendererScript),
    new Promise((resolve) => setTimeout(() => {
      writeElectronSmokeStage("workspace-trust-request-dialog:renderer-timeout", {
        reason: "renderer bridge did not return within 30000ms",
      })
      resolve({
        timedOut: true,
        blocked: true,
        blockedReason: "workspace trust request dialog renderer bridge did not return before the smoke timeout; no decision completion is faked",
      })
    }, 30000)),
  ])
  if (!rendererResult?.timedOut) {
    await win.webContents.executeJavaScript(`
      window.__codekSmokeWorkspaceTrustRequestDialogResult = ${JSON.stringify(rendererResult)}
    `)
  }
  return rendererResult
}

async function exerciseElectronSmokeWorkspaceTrustEditor(win) {
  if (!isWorkspaceTrustEditorSmoke) return
  await bringSmokeWindowToForeground(win, "workspace-trust-editor")
  const projectRoot = currentProjectRoot || process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_ROOT || CODEK_DATA || ""
  const rendererScript = `
    (async () => {
      const describeSmokeDom = () => ({
        url: location.href,
        readyState: document.readyState,
        hasAppShell: Boolean(document.querySelector(".app-shell")),
        hasWorkspaceTrustEditor: Boolean(document.querySelector('[data-codek-smoke="workspace-trust-editor"]')),
        hasWorkbenchControls: Boolean(window.__codekSmokeWorkbenchControls),
        hasWorkspaceTrustEditorBridge: Boolean(
          window.__codekSmokeWorkbenchControls
            && typeof window.__codekSmokeWorkbenchControls.runWorkspaceTrustEditorSmoke === "function"
        ),
        bodyText: String(document.body?.innerText || "").slice(0, 500),
      })
      const waitForState = (predicate, label, timeout = 60000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("workspace trust editor smoke timeout: " + label + " " + JSON.stringify(describeSmokeDom())))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })
      await waitForState(
        () => document.querySelector(".app-shell") && window.__codekSmokeWorkbenchControls,
        "app shell and smoke workbench controls",
        60000,
      )
      await waitForState(
        () => typeof window.__codekSmokeWorkbenchControls.runWorkspaceTrustEditorSmoke === "function",
        "workspace trust editor smoke bridge",
        60000,
      )
      const result = await window.__codekSmokeWorkbenchControls.runWorkspaceTrustEditorSmoke(${JSON.stringify({ root: projectRoot })})
      window.__codekSmokeWorkspaceTrustEditorResult = result
      return result
    })()
  `
  const rendererResult = await win.webContents.executeJavaScript(rendererScript)
  await win.webContents.executeJavaScript(`
    window.__codekSmokeWorkspaceTrustEditorResult = ${JSON.stringify(rendererResult)}
  `)
  return rendererResult
}

async function exerciseElectronSmokeExtensionInstallConfirmation(win) {
  if (!isExtensionInstallConfirmationSmoke) return
  await bringSmokeWindowToForeground(win, "extension-install-confirmation")
  const projectRoot = currentProjectRoot || process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_ROOT || CODEK_DATA || ""
  const rendererScript = `
    (async () => {
      const describeSmokeDom = () => ({
        url: location.href,
        readyState: document.readyState,
        hasAppShell: Boolean(document.querySelector(".app-shell")),
        hasDialogModal: Boolean(document.querySelector('[data-codek-smoke="codek-dialog-service-modal"]')),
        hasExtensionGallerySurface: Boolean(document.querySelector('[data-codek-smoke="extension-gallery-workbench-surface"]')),
        hasExtensionGalleryDetail: Boolean(document.querySelector('[data-codek-smoke="extension-gallery-detail"]')),
        hasWorkbenchControls: Boolean(window.__codekSmokeWorkbenchControls),
        hasExtensionInstallConfirmationBridge: Boolean(
          window.__codekSmokeWorkbenchControls
            && typeof window.__codekSmokeWorkbenchControls.runExtensionInstallConfirmationSmoke === "function"
        ),
        bodyText: String(document.body?.innerText || "").slice(0, 500),
      })
      const waitForState = (predicate, label, timeout = 60000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("extension install confirmation smoke timeout: " + label + " " + JSON.stringify(describeSmokeDom())))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })
      await waitForState(
        () => document.querySelector(".app-shell") && window.__codekSmokeWorkbenchControls,
        "app shell and smoke workbench controls",
        60000,
      )
      await waitForState(
        () => typeof window.__codekSmokeWorkbenchControls.runExtensionInstallConfirmationSmoke === "function",
        "extension install confirmation smoke bridge",
        60000,
      )
      const result = await window.__codekSmokeWorkbenchControls.runExtensionInstallConfirmationSmoke(${JSON.stringify({ root: projectRoot })})
      window.__codekSmokeExtensionInstallConfirmationResult = result
      return result
    })()
  `
  const rendererResult = await Promise.race([
    win.webContents.executeJavaScript(rendererScript),
    new Promise((resolve) => setTimeout(() => {
      writeElectronSmokeStage("extension-install-confirmation:renderer-timeout", {
        reason: "renderer bridge did not return within 30000ms",
      })
      resolve({
        timedOut: true,
        blocked: true,
        blockedReason: "extension install confirmation renderer bridge did not return before the smoke timeout; no install confirmation is faked",
      })
    }, 30000)),
  ])
  if (!rendererResult?.timedOut) {
    await win.webContents.executeJavaScript(`
      window.__codekSmokeExtensionInstallConfirmationResult = ${JSON.stringify(rendererResult)}
    `)
  }
  return rendererResult
}

async function exerciseElectronSmokeExtensionHostRestart(win) {
  if (!isExtensionHostRestartSmoke) return
  await bringSmokeWindowToForeground(win, "extension-host-restart")
  const projectRoot = currentProjectRoot || process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_ROOT || CODEK_DATA || ""
  const workspaceRoots = projectRoot ? [projectRoot] : []
  const beforeUrl = win?.webContents?.getURL?.() || ""
  const ready = await waitForServicesReady(60000)
  if (!ready) {
    return {
      smokeCase: "extension-host-restart",
      owner: "desktop/main.js exerciseElectronSmokeExtensionHostRestart",
      blocked: true,
      blockedReason: serviceStartupError
        ? String(serviceStartupError?.message || serviceStartupError)
        : "Codek services did not become ready before extension host restart smoke.",
      preloadTrigger: false,
      mainTrigger: false,
      rendererTrigger: false,
    }
  }

  const extensionsHost = require("./services/extensions-host")
  const host = extensionsHost.getHost()
  const startResult = await extensionsHost.startExtensionHosts({
    reason: "Extension host restart Electron smoke initial start",
    rootDir: projectRoot,
    workspaceRoots,
    workspaceFile: currentWorkspaceFile,
  })
  const beforePid = host?._process?.pid || 0
  const rendererScript = `
    (async () => {
      const waitForState = (predicate, label, timeout = 60000) => new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = async () => {
          try {
            const value = await predicate()
            if (value) {
              resolve(value)
              return
            }
          } catch {}
          if (Date.now() - started > timeout) {
            reject(new Error("extension host restart smoke timeout: " + label))
            return
          }
          setTimeout(tick, 120)
        }
        tick()
      })
      window.__codekSmokeExtensionHostRestartStage = {
        smokeCase: "extension-host-restart",
        rendererTrigger: true,
        preloadApiPresent: Boolean(window.codek && typeof window.codek.restartExtensionHosts === "function"),
      }
      await waitForState(() => window.codek && typeof window.codek.restartExtensionHosts === "function", "preload restart bridge")
      const result = await window.codek.restartExtensionHosts("Extension host restart Electron smoke", ${JSON.stringify({
        rootDir: projectRoot,
        workspaceRoots,
        workspaceFile: currentWorkspaceFile,
        startupTimeoutMs: 60000,
      })})
      window.__codekSmokeExtensionHostRestartResult = {
        smokeCase: "extension-host-restart",
        owner: "renderer window.codek.restartExtensionHosts",
        rendererTrigger: true,
        preloadTrigger: true,
        result,
      }
      return window.__codekSmokeExtensionHostRestartResult
    })()
  `
  const rendererResult = await Promise.race([
    win.webContents.executeJavaScript(rendererScript),
    new Promise((resolve) => setTimeout(() => {
      writeElectronSmokeStage("extension-host-restart:renderer-timeout", {
        reason: "renderer preload bridge did not return within 60000ms",
      })
      resolve({
        smokeCase: "extension-host-restart",
        timedOut: true,
        blocked: true,
        blockedReason: "extension host restart renderer/preload trigger timed out; no window reload was claimed",
      })
    }, 60000)),
  ])
  const afterPid = host?._process?.pid || 0
  const afterUrl = win?.webContents?.getURL?.() || ""
  const response = rendererResult?.result || {}
  const evidence = response?.data?.evidence || response?.evidence || null
  const evidenceJson = JSON.stringify(evidence || {})
  const result = {
    smokeCase: "extension-host-restart",
    owner: "desktop/main.js exerciseElectronSmokeExtensionHostRestart",
    route: "POST /extensions-host/lifecycle/restart",
    rendererTrigger: rendererResult?.rendererTrigger === true,
    preloadTrigger: rendererResult?.preloadTrigger === true,
    mainTrigger: true,
    startResult,
    routeResult: response,
    evidence,
    before: {
      pid: beforePid,
      url: beforeUrl,
      running: Boolean(beforePid && host?.isRunning),
    },
    after: {
      pid: afterPid,
      url: afterUrl,
      running: Boolean(afterPid && host?.isRunning),
      processReplaced: beforePid > 0 && afterPid > 0 && beforePid !== afterPid,
    },
    reloadEvidence: {
      reloadRequested: evidence?.reloadRequested === true,
      reloaded: evidence?.reloaded === true,
      noIHostServiceReload: !evidenceJson.includes("IHostService.reload"),
      windowUrlStable: beforeUrl === afterUrl,
      layeredFromHostServiceReload: false,
    },
    blocked: rendererResult?.blocked === true,
    blockedReason: rendererResult?.blockedReason || "",
  }
  await win.webContents.executeJavaScript(`
    window.__codekSmokeExtensionHostRestartResult = ${JSON.stringify(result)}
  `)
  return result
}

function createElectronSmokeTaskProviderServer(providerTaskFactory = createElectronSmokeProviderTask) {
  const handlers = new Map()
  const calls = []
  return {
    calls,
    onRpc(actorIdOrMethod, methodOrHandler, maybeHandler) {
      const key = typeof actorIdOrMethod === "number"
        ? `${actorIdOrMethod}:${methodOrHandler}`
        : actorIdOrMethod
      const handler = typeof actorIdOrMethod === "number" ? maybeHandler : methodOrHandler
      handlers.set(key, handler)
    },
    callRpc(method, args = []) {
      const key = `56:${method}`
      const handler = handlers.get(key) || handlers.get(method)
      if (!handler) throw new Error(`missing smoke task provider rpc handler ${method}`)
      return handler(args)
    },
    call(nid, method, args, timeoutMs, options) {
      calls.push({ nid, method, args, timeoutMs, options })
      if (method === "$resolveTask") {
        return Promise.resolve(providerTaskFactory())
      }
      if (method === "$provideTasks") {
        return Promise.resolve({
          tasks: [providerTaskFactory()],
          extension: { identifier: { value: "codek.electron-smoke-task-provider" } },
        })
      }
      return Promise.resolve(undefined)
    },
  }
}

function createElectronSmokeRpcServer(defaultNid) {
  const handlers = new Map()
  return {
    onRpc(actorIdOrMethod, methodOrHandler, maybeHandler) {
      const key = typeof actorIdOrMethod === "number"
        ? `${actorIdOrMethod}:${methodOrHandler}`
        : actorIdOrMethod
      const handler = typeof actorIdOrMethod === "number" ? maybeHandler : methodOrHandler
      handlers.set(key, handler)
    },
    callRpc(method, args = []) {
      const key = `${defaultNid}:${method}`
      const handler = handlers.get(key) || handlers.get(method)
      if (!handler) throw new Error(`missing smoke rpc handler ${method}`)
      return handler(args)
    },
  }
}

function createElectronSmokeProgressServer(defaultNid, extHostCancelCalls) {
  const handlers = new Map()
  return {
    onRpc(actorIdOrMethod, methodOrHandler, maybeHandler) {
      const key = typeof actorIdOrMethod === "number"
        ? `${actorIdOrMethod}:${methodOrHandler}`
        : actorIdOrMethod
      const handler = typeof actorIdOrMethod === "number" ? maybeHandler : methodOrHandler
      handlers.set(key, handler)
    },
    callRpc(method, args = []) {
      const key = `${defaultNid}:${method}`
      const handler = handlers.get(key) || handlers.get(method)
      if (!handler) throw new Error(`missing smoke progress rpc handler ${method}`)
      return handler(args)
    },
    call(nid, method, args, timeoutMs, options) {
      extHostCancelCalls.push({ nid, method, args, timeoutMs, options })
      return Promise.resolve(undefined)
    },
  }
}

function createElectronSmokeProviderTask() {
  return {
    _id: "npm:electron-provider-smoke",
    name: "npm: electron provider smoke",
    source: "npm",
    definition: { type: "npm", script: "electron-provider-smoke" },
    execution: {
      process: "node",
      args: ["-e", "\"process.stdout.write('electron-provider-output')\""],
    },
    isBackground: false,
  }
}

function createElectronSmokeProviderBackgroundTask() {
  return {
    _id: "npm:electron-provider-watch-owner",
    name: "npm: electron provider watch owner",
    source: "npm",
    definition: { type: "npm", script: "electron-provider-watch-owner" },
    execution: {
      process: "node",
      args: ["-e", "\"process.stdout.write('electron-provider-watch-owner')\""],
    },
    isBackground: true,
    problemMatchers: [{
      id: "watch",
      owner: "typescript",
      source: "TypeScript",
      fileLocation: "relative",
      filePrefix: process.cwd(),
      pattern: {
        regexp: /^(.*)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/,
        file: 1,
        line: 2,
        column: 3,
        severity: 4,
        code: 5,
        message: 6,
      },
      background: {
        activeOnStart: true,
        beginsPattern: /terminalManager pty owner/,
        endsPattern: /never-matches-electron-provider-watch-owner/,
      },
    }],
  }
}

function runBackgroundSmokeChecks() {
  if (process.env.CODEK_ELECTRON_SMOKE !== "1") return []
  const checks = []
  const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
  try {
    const { buildTrayMenuTemplate } = require("./tray")
    const calls = []
    const menu = buildTrayMenuTemplate({
      runningGoals: 2,
      paused: false,
      goals: [
        { id: "goal_smoke_1", title: "Smoke Goal 1", progress: 25 },
        { id: "goal_smoke_2", title: "Smoke Goal 2", progress: 75 },
      ],
    }, {
      openGoal: (id) => calls.push(`open:${id}`),
      pauseAll: () => calls.push("pause"),
      openWindow: () => calls.push("open-window"),
      quit: () => calls.push("quit"),
    })
    const task = menu.find((item) => item.label === "Smoke Goal 1 - 25%")
    const pause = menu.find((item) => item.label === "暂停所有任务")
    task?.click?.()
    pause?.click?.()
    add("background tray menu model", menu[0]?.label === "运行中: 2 个任务" && calls.includes("open:goal_smoke_1") && calls.includes("pause"))
  } catch (error) {
    add("background tray menu model", false, String(error?.message || error))
  }

  try {
    const notifications = require("./services/notifications")
    const created = []
    const windowCalls = []
    notifications.resetForTest()
    notifications.setNotificationFactory((options) => {
      const handlers = {}
      const notification = {
        options,
        on: (event, handler) => { handlers[event] = handler },
        show: () => { notification.shown = true },
        click: () => handlers.click?.(),
        shown: false,
      }
      created.push(notification)
      return notification
    })
    notifications.setMainWindow({
      isDestroyed: () => false,
      isVisible: () => false,
      show: () => windowCalls.push("show"),
      focus: () => windowCalls.push("focus"),
      webContents: { send: (channel, id) => windowCalls.push(`${channel}:${id}`) },
    })
    const notification = notifications.notifyGoalFailed({ id: "goal_smoke_notify", description: "Smoke failure", error: "boom" })
    notification?.click?.()
    add("background notification click model", created.length === 1 && created[0].shown && windowCalls.includes("open-goal:goal_smoke_notify"))
    notifications.resetForTest()
  } catch (error) {
    add("background notification click model", false, String(error?.message || error))
  }

  try {
    const lifecycle = shouldKeepAliveOnWindowClosed({
      isQuitting: false,
      isMac,
      hasRunningGoals: true,
    })
    add("background keep-alive decision", lifecycle.keepAlive && lifecycle.hideWindow && !lifecycle.quit)
  } catch (error) {
    add("background keep-alive decision", false, String(error?.message || error))
  }

  try {
    const state = _scheduler?.getState?.()
    add("background scheduler state reachable", Boolean(state && typeof state.runningGoals === "number" && Array.isArray(state.goals)))
  } catch (error) {
    add("background scheduler state reachable", false, String(error?.message || error))
  }
  return checks
}

async function runElectronSmokeChecks(win) {
  if (!win || win.isDestroyed()) return
  const timeout = setTimeout(() => {
    console.error("[electron-smoke] timeout")
    writeElectronSmokeStage("run-smoke:timeout", {
      timeoutMs: Number(process.env.CODEK_ELECTRON_SMOKE_TIMEOUT_MS || 15000),
    })
    void (async () => {
      const stage = await collectElectronSmokeRendererStage(win)
      const payload = isDebugSessionSmoke
        ? {
            ok: false,
            smokeCase: "debug-session",
            blocked: true,
            blockedReason: "timeout",
            dapMetadataOnly: true,
            checks: [{
              name: "debug session smoke reaches Electron DAP session exercise before timeout",
              passed: false,
              detail: JSON.stringify(stage?.debugSession || stage || {}),
            }],
            debugSession: stage?.debugSession || {
              sessionObserved: false,
              metadata: {
                sessionIdPrefix: "",
                sessionIdLength: 0,
                adapterType: "",
                phase: "",
                stateSource: "",
                capabilityKeys: [],
              },
              bridgeEvidence: {
                source: "MainThreadDebugService.dapIpcBridge",
                status: latestDapBridgeEvidence ? "partial" : "not-started",
              },
              mainThreadBridgeEvidence: latestDapBridgeEvidence || null,
              redaction: {
                noExpressionText: true,
                noSourcePathText: true,
                noAdapterArgsText: true,
              },
              debugViewContainerOwner: {
                status: "partial",
                connected: false,
                reason: "Electron smoke timed out before a completed DebugPanel/debugState DAP session was observed.",
              },
            },
            stage,
          }
        : { ok: false, checks: [], error: "timeout", stage }
      writeElectronSmokeResult(payload)
      app.exit(1)
    })()
  }, Number(process.env.CODEK_ELECTRON_SMOKE_TIMEOUT_MS || 15000))

  try {
    writeElectronSmokeStage("run-smoke:prepare-special-workspace")
    await prepareSpecialElectronSmokeWorkspace()
    writeElectronSmokeStage("run-smoke:prepare-login")
    await prepareElectronSmokeLogin(win)
    writeElectronSmokeStage("run-smoke:exercise-workbench")
    await exerciseElectronSmokeWorkbench(win)
    writeElectronSmokeStage("run-smoke:exercise-analysis-workspace")
    await exerciseElectronSmokeAnalysisWorkspace(win)
    writeElectronSmokeStage("run-smoke:exercise-explorer-performance")
    await exerciseElectronSmokeExplorerPerformance(win)
    writeElectronSmokeStage("run-smoke:exercise-real-explorer")
    await exerciseElectronSmokeRealExplorer(win)
    writeElectronSmokeStage("run-smoke:exercise-explorer-stress")
    await exerciseElectronSmokeExplorerStress(win)
    writeElectronSmokeStage("run-smoke:exercise-file-operation-visibility")
    await exerciseElectronSmokeFileOperationVisibility(win)
    writeElectronSmokeStage("run-smoke:exercise-editor-open-files")
    const editorOpenFilesResult = await exerciseElectronSmokeEditorOpenFiles(win)
    if (isEditorOpenFilesSmoke) {
      writeElectronSmokeStage("run-smoke:collect-editor-open-files-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const result = editorOpenFilesResult || {}
      add("editor openFiles smoke uses workbenchExplorerEditorService source", result.editorGroupsSource === "workbenchExplorerEditorService", JSON.stringify(result))
      add("editor openFiles smoke exposes open editors count", Number(result.openEditorsCount || 0) >= 1, JSON.stringify(result))
      add("editor openFiles smoke has no local openFiles state evidence", result.noLocalOpenFilesState === true, JSON.stringify(result))
      add("editor openFiles smoke mounts editor part and tab icon", result.editorPartMounted === true && result.hasActiveTab === true && result.hasTabIcon === true, JSON.stringify(result))
      add("editor openFiles smoke renders title file icon", result.hasTitleIcon === true, JSON.stringify(result))
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = { ok: allFailed.length === 0, smokeCase: "editor-open-files", result, checks: allChecks }
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-icon-theme-refresh")
    const iconThemeRefreshResult = await exerciseElectronSmokeIconThemeRefresh(win)
    if (isIconThemeRefreshSmoke) {
      writeElectronSmokeStage("run-smoke:collect-icon-theme-refresh-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const result = iconThemeRefreshResult || {}
      add("icon theme refresh smoke uses workbenchThemeService source", result.themeServiceId === "workbenchThemeService", JSON.stringify(result))
      add("icon theme refresh smoke exposes theme id", Boolean(result.themeId), JSON.stringify(result))
      add("icon theme refresh smoke patches user icon theme setting", result.settingsPatchOk === true, JSON.stringify(result))
      add("icon theme refresh smoke observes minimal theme after service event", result.changedThemeId === "minimal", JSON.stringify(result))
      add("icon theme refresh smoke keeps changed icon on workbenchThemeService source", result.changedThemeServiceId === "workbenchThemeService", JSON.stringify(result))
      add("icon theme refresh smoke reaches FileIcon DOM after change event", result.changeEventReachedFileIconDom === true, JSON.stringify(result))
      add("icon theme refresh smoke restores user icon theme setting", result.settingsRestored === true, JSON.stringify(result))
      add("icon theme refresh smoke exposes file icon data evidence", Number(result.fileIconDataEvidenceCount || 0) >= 1, JSON.stringify(result))
      add("icon theme refresh smoke avoids static icon map fallback", result.noStaticIconMapFallback === true, JSON.stringify(result))
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = { ok: allFailed.length === 0, smokeCase: "icon-theme-refresh", result, checks: allChecks }
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-working-copy-hot-exit")
    const workingCopyHotExitResult = await exerciseElectronSmokeWorkingCopyHotExit(win)
    if (isWorkingCopyHotExitSmoke) {
      writeElectronSmokeStage("run-smoke:collect-working-copy-hot-exit-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const hotExit = workingCopyHotExitResult || {}
      const backupCleanupDiagnostics = collectWorkingCopyBackupCleanupDiagnostics(hotExit)
      add("working copy hot-exit smoke creates dirty evidence", hotExit.dirtyEvidence?.dirtyCount === 1 && hotExit.dirtyEvidence?.risk === "dirty-working-copy", JSON.stringify(hotExit.dirtyEvidence || {}))
      add("working copy hot-exit smoke vetoes native dirty window close", hotExit.nativeCancelAllowed === false && hotExit.nativeCancelLifecycle?.decision === "cancel" && hotExit.nativeCancelLifecycle?.allowed === false, JSON.stringify(hotExit.nativeCancelLifecycle || {}))
      add("working copy hot-exit smoke records native confirm lifecycle", hotExit.nativeConfirmLifecycle?.decision?.decision === "confirm" && hotExit.nativeConfirmLifecycle?.decision?.allowed === true, JSON.stringify(hotExit.nativeConfirmLifecycle || {}))
      add("working copy hot-exit smoke records native force lifecycle", hotExit.nativeForceLifecycle?.decision?.decision === "force" && hotExit.nativeForceLifecycle?.decision?.forced === true, JSON.stringify(hotExit.nativeForceLifecycle || {}))
      add("working copy hot-exit smoke cancels dirty close by default", hotExit.closeGuardAllowed === false && hotExit.closeGuardEvidence?.cancelled === true, JSON.stringify(hotExit.closeGuardEvidence || {}))
      add("working copy hot-exit smoke writes backup artifact path", Array.isArray(hotExit.backupArtifactPaths) && hotExit.backupArtifactPaths.length > 0, JSON.stringify({ backedUp: hotExit.backedUp, backupArtifactPaths: hotExit.backupArtifactPaths }))
      add("working copy hot-exit smoke restores backup as dirty working copy", hotExit.restoreApplied === true && hotExit.restoredContentMatches === true && hotExit.dirtyAfterRestore === true && hotExit.restoreAttemptEvidence?.dirtyCount === 1, JSON.stringify({ dirtyAfterRestore: hotExit.dirtyAfterRestore, restoreAttemptEvidence: hotExit.restoreAttemptEvidence || {} }))
      add("working copy hot-exit smoke saves restored content to disk and clears dirty", hotExit.saveSucceeded === true && hotExit.diskAfterSaveMatches === true && hotExit.dirtyAfterSave === false, JSON.stringify({ saveSucceeded: hotExit.saveSucceeded, diskAfterSaveMatches: hotExit.diskAfterSaveMatches, dirtyAfterSave: hotExit.dirtyAfterSave }))
      add("working copy hot-exit smoke reverts dirty draft from disk", hotExit.reloadReverted === true && hotExit.revertRestoredDiskContent === true && hotExit.dirtyAfterRevert === false, JSON.stringify({ reloadReverted: hotExit.reloadReverted, revertRestoredDiskContent: hotExit.revertRestoredDiskContent, dirtyAfterRevert: hotExit.dirtyAfterRevert }))
      add("working copy hot-exit smoke writes JSON and Markdown evidence", Boolean(hotExit.evidenceJsonExists && hotExit.evidenceMarkdownExists), JSON.stringify(hotExit.evidence || {}))
      add("working copy hot-exit smoke keeps missing backup cleanup diagnostics non-blocking", backupCleanupDiagnostics.blocking.length === 0, JSON.stringify(backupCleanupDiagnostics))
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = {
        ...(hotExit.evidenceReport || {}),
        ok: allFailed.length === 0,
        checks: allChecks,
        nonBlockingDiagnostics: {
          ...(hotExit.evidenceReport?.nonBlockingDiagnostics || {}),
          backupCleanup: backupCleanupDiagnostics.nonBlocking,
        },
        blockingDiagnostics: {
          ...(hotExit.evidenceReport?.blockingDiagnostics || {}),
          backupCleanup: backupCleanupDiagnostics.blocking,
        },
      }
      writeElectronSmokeStage("run-smoke:write-working-copy-hot-exit-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-search-replace")
    const searchReplaceResult = await exerciseElectronSmokeSearchReplace(win)
    if (isSearchReplaceSmoke) {
      writeElectronSmokeStage("run-smoke:collect-search-replace-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const searchReplace = searchReplaceResult || {}
      const afterOne = String(searchReplace.afterReplaceOne || "")
      const finalRepeated = String(searchReplace.finalRepeatedDisk || searchReplace.finalRepeated || "")
      const finalOther = String(searchReplace.finalOtherDisk || searchReplace.finalOther || "")
      const previewSummary = searchReplace.previewSummary || {}
      const replaceOneSummary = searchReplace.replaceOneSummary || {}
      const replaceAllSummary = searchReplace.replaceAllSummary || {}
      const changedFiles = Array.isArray(searchReplace.bulkEditChangedFiles) ? searchReplace.bulkEditChangedFiles : []
      add("search replace smoke search view active", Boolean(searchReplace.searchViewActive), JSON.stringify(searchReplace))
      add("search replace smoke finds multiple file groups", Number(searchReplace.initialGroupCount || 0) >= 2, JSON.stringify(searchReplace))
      add("search replace smoke preserves collapsed occurrence metadata", Number(searchReplace.collapsedOccurrenceCount || 0) >= 2, JSON.stringify(searchReplace))
      add("search replace smoke previews via dry-run without writing disk", Boolean(searchReplace.previewDryRun && !searchReplace.previewApplied && searchReplace.previewDidNotWriteDisk), JSON.stringify({ previewSummary, previewDidNotWriteDisk: searchReplace.previewDidNotWriteDisk }))
      add("search replace smoke preview reports bulk edit summary", Number(previewSummary.changedFileCount || 0) >= 2 && Number(previewSummary.editCount || 0) >= 2, JSON.stringify(previewSummary))
      add("search replace one applies through bulk edit service", Boolean(searchReplace.replaceOneApplied && Number(replaceOneSummary.changedFileCount || 0) === 1 && Number(replaceOneSummary.editCount || 0) === 1), JSON.stringify(replaceOneSummary))
      add("search replace one only changes first same-line occurrence", afterOne.includes("haystack needle") && !afterOne.includes("haystack haystack"), JSON.stringify({ afterReplaceOne: searchReplace.afterReplaceOne }))
      add("search replace all applies through bulk edit service", Boolean(searchReplace.replaceAllApplied && Number(replaceAllSummary.changedFileCount || 0) >= 2 && Number(replaceAllSummary.editCount || 0) >= 2), JSON.stringify(replaceAllSummary))
      add("search replace all updates repeated file on disk", finalRepeated.includes("haystack haystack") && !finalRepeated.includes("needle"), JSON.stringify({ finalRepeated }))
      add("search replace all updates unopened file on disk", finalOther.includes("haystack") && !finalOther.includes("needle"), JSON.stringify({ finalOther }))
      add("search replace smoke clears remaining grep matches", Number(searchReplace.remainingNeedleGroups || 0) === 0, JSON.stringify({ remainingNeedleGroups: searchReplace.remainingNeedleGroups }))
      add("search replace smoke records rollback risk and affected resources", Boolean(searchReplace.bulkEditAppliedViaService && changedFiles.includes("src/000-repeated.ts") && changedFiles.includes("src/100-other.ts") && searchReplace.rollbackRisk && searchReplace.rollbackRisk.replaceAllDescription), JSON.stringify({ changedFiles, rollbackRisk: searchReplace.rollbackRisk }))
      const searchRefreshEvidence = searchReplace.searchRefreshEvidence || {}
      add("search replace smoke refreshes search after FileService watcher", Boolean(searchRefreshEvidence.watcherRefreshStable === true && Number(searchRefreshEvidence.afterReplaceAllGroupCount || 0) === 0 && Number(searchRefreshEvidence.afterReplaceAllMatchCount || 0) === 0 && searchRefreshEvidence.changedFilesStillVisibleAfterReplaceAll === false && searchRefreshEvidence.searchBusy === false), JSON.stringify(searchRefreshEvidence))
      add("search replace smoke writes latest JSON and Markdown evidence", Boolean(searchReplace.evidenceJsonExists && searchReplace.evidenceMarkdownExists), JSON.stringify(searchReplace.evidence || {}))
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = {
        ok: allFailed.length === 0,
        checks: allChecks,
        searchReplace,
      }
      writeElectronSmokeStage("run-smoke:write-search-replace-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-search-navigation")
    const searchNavigationResult = await exerciseElectronSmokeSearchNavigation(win)
    if (isSearchNavigationSmoke) {
      writeElectronSmokeStage("run-smoke:collect-search-navigation-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const searchNavigation = searchNavigationResult || {}
      add("search navigation smoke opens real editor content", Boolean(searchNavigation.openedContentVisible), JSON.stringify(searchNavigation))
      add("search navigation smoke keeps editor non-blank", !searchNavigation.blankEditor, JSON.stringify(searchNavigation))
      add("search navigation smoke reveals exact match selection", Boolean(searchNavigation.selectionChanged), JSON.stringify(searchNavigation))
      add("search navigation smoke keeps search view active", Boolean(searchNavigation.searchViewActive), JSON.stringify(searchNavigation))
      add("search navigation smoke clicks 20 real results", Number(searchNavigation.clickedCount || 0) >= 20, JSON.stringify(searchNavigation))
      add("search navigation smoke keeps every clicked editor non-blank", Boolean(searchNavigation.allClicksNonBlank), JSON.stringify(searchNavigation))
      add("search navigation smoke reveals every clicked match selection", Boolean(searchNavigation.allSelectionsAccurate), JSON.stringify(searchNavigation))
      add("search navigation smoke covers same-file and cross-file navigation", Boolean(searchNavigation.sameFileMultiLineClicked && Number(searchNavigation.distinctPathsClicked || 0) >= 2), JSON.stringify(searchNavigation))
      add("search navigation smoke keeps search view active for every click", Boolean(searchNavigation.allClicksKeptSearchView), JSON.stringify(searchNavigation))
      add("search navigation smoke covers json query non-blank editor", Boolean(searchNavigation.jsonSearchOpenedContentVisible && !searchNavigation.jsonSearchBlankEditor), JSON.stringify(searchNavigation))
      add("search navigation smoke covers json query exact selection", Boolean(searchNavigation.jsonSearchSelectionAccurate), JSON.stringify(searchNavigation))
      add("search navigation smoke writes latest JSON and Markdown evidence", Boolean(searchNavigation.evidenceJsonExists && searchNavigation.evidenceMarkdownExists), JSON.stringify(searchNavigation.evidence || {}))
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = { ok: allFailed.length === 0, checks: allChecks }
      writeElectronSmokeStage("run-smoke:write-search-navigation-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-inline-create-focus")
    const inlineCreateFocusResult = await exerciseElectronSmokeInlineCreateFocus(win)
    if (isInlineCreateFocusSmoke) {
      writeElectronSmokeStage("run-smoke:collect-inline-create-focus-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const inlineCreate = inlineCreateFocusResult || {}
      add("inline create focus smoke native explorer mounted", Boolean(inlineCreate.nativeHostMounted), JSON.stringify(inlineCreate))
      add("inline create focus smoke file input receives hit target", Boolean(inlineCreate.fileCase?.hitIsInput), JSON.stringify(inlineCreate.fileCase || {}))
      add("inline create focus smoke file input keeps focus", Boolean(inlineCreate.fileCase?.activeElementIsInput), JSON.stringify(inlineCreate.fileCase || {}))
      add("inline create focus smoke file input accepts text", Boolean(inlineCreate.fileCase?.valueAccepted), JSON.stringify(inlineCreate.fileCase || {}))
      add("inline create focus smoke folder input receives hit target", Boolean(inlineCreate.folderCase?.hitIsInput), JSON.stringify(inlineCreate.folderCase || {}))
      add("inline create focus smoke folder input keeps focus", Boolean(inlineCreate.folderCase?.activeElementIsInput), JSON.stringify(inlineCreate.folderCase || {}))
      add("inline create focus smoke folder input accepts text", Boolean(inlineCreate.folderCase?.valueAccepted), JSON.stringify(inlineCreate.folderCase || {}))
      add("inline create focus smoke all inputs are usable", Boolean(inlineCreate.allInputsFocusable), JSON.stringify(inlineCreate))
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = { ok: allFailed.length === 0, checks: allChecks }
      writeElectronSmokeStage("run-smoke:write-inline-create-focus-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-artifact-open")
    const artifactOpenResult = await exerciseElectronSmokeArtifactOpen(win)
    if (isArtifactOpenSmoke) {
      writeElectronSmokeStage("run-smoke:collect-artifact-open-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const artifactOpen = artifactOpenResult || {}
      add("artifact open smoke blocks binary artifacts", Boolean(artifactOpen.binaryArtifactsBlocked), JSON.stringify(artifactOpen))
      add("artifact open smoke keeps binary artifacts out of tabs", Boolean(artifactOpen.binaryArtifactsNotOpened), JSON.stringify(artifactOpen))
      add("artifact open smoke stays responsive after artifact clicks", Boolean(artifactOpen.responsiveAfterArtifactClicks), JSON.stringify(artifactOpen))
      add("artifact open smoke opens text files after artifact clicks", Boolean(artifactOpen.textFilesOpened), JSON.stringify(artifactOpen))
      add("artifact open smoke keeps final editor non-blank", Boolean(artifactOpen.finalEditorNonBlank), JSON.stringify(artifactOpen))
      add("artifact open smoke keeps editor DOM visible", Boolean(artifactOpen.editorDomVisible), JSON.stringify(artifactOpen))
      add("artifact open smoke keeps open operations within budget", Boolean(artifactOpen.allOpenDurationsWithinBudget), JSON.stringify(artifactOpen))
      add("artifact open smoke writes latest JSON and Markdown evidence", Boolean(artifactOpen.evidenceJsonExists && artifactOpen.evidenceMarkdownExists), JSON.stringify(artifactOpen.evidence || {}))
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = { ok: allFailed.length === 0, checks: allChecks }
      writeElectronSmokeStage("run-smoke:write-artifact-open-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-notification-actions-click")
    const notificationActionsClickResult = await exerciseElectronSmokeNotificationActionsClick(win)
    if (isNotificationActionsClickSmoke) {
      writeElectronSmokeStage("run-smoke:collect-notification-actions-click-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const result = notificationActionsClickResult || {}
      const primaryResult = result.primaryScenario || result
      const cancelResult = result.cancelScenario || {}
      const primaryClickResults = Array.isArray(primaryResult.clickResults) ? primaryResult.clickResults : []
      const cancelClickResults = Array.isArray(cancelResult.clickResults) ? cancelResult.clickResults : []
      const clickResults = [...primaryClickResults, ...cancelClickResults]
      const clickCase = (caseName, source = clickResults) => source.find((item) => item && item.caseName === caseName) || {}
      const progressActionIds = Array.isArray(primaryResult.progressActionIds) ? primaryResult.progressActionIds : []
      const cancelProgressActionIds = Array.isArray(cancelResult.progressActionIds) ? cancelResult.progressActionIds : []
      add("notification actions click smoke renders primary action button", Boolean(clickCase("primary", primaryClickResults).visibleBeforeClick), JSON.stringify(clickCase("primary", primaryClickResults)))
      add("notification actions click smoke dispatches primary progress button with choice 0 through Electron IPC", Boolean(primaryResult.primaryTriggered && result.primaryBackChannelChoice === 0 && result.primaryTokenObserved === true), JSON.stringify({
        primaryTriggered: primaryResult.primaryTriggered,
        primaryBackChannelChoice: result.primaryBackChannelChoice,
        primaryCancelIpcPayload: result.primaryCancelIpcPayload,
        primaryTokenObserved: result.primaryTokenObserved,
        primary: clickCase("primary", primaryClickResults),
      }))
      add("notification actions click smoke renders secondary Manage Extension action button", Boolean(clickCase("secondary", primaryClickResults).visibleBeforeClick) && primaryResult.secondaryCommandId === "workbench.extensions.manage", JSON.stringify(clickCase("secondary", primaryClickResults)))
      add("notification actions click smoke dispatches secondary action through commandRegistry", Boolean(primaryResult.secondaryTriggered && primaryResult.secondaryCommandRegisteredBeforeClick && primaryResult.secondaryCommandInvocationCount >= 1), JSON.stringify({
        secondaryCommandId: primaryResult.secondaryCommandId,
        secondaryCommandRegisteredBeforeClick: primaryResult.secondaryCommandRegisteredBeforeClick,
        secondaryCommandInvocationCount: primaryResult.secondaryCommandInvocationCount,
        secondaryCommandInvocationArgs: primaryResult.secondaryCommandInvocationArgs,
        secondaryCommandRegistryResultInferred: primaryResult.secondaryCommandRegistryResultInferred,
      }))
      add("notification actions click smoke keeps secondary action notification open", Boolean(primaryResult.secondaryKeptOpen), JSON.stringify(primaryResult))
      add("notification actions click smoke renders cancel action button", Boolean(clickCase("cancel", cancelClickResults).visibleBeforeClick), JSON.stringify(clickCase("cancel", cancelClickResults)))
      add("notification actions click smoke triggers cancel back-channel without completion", Boolean(cancelResult.cancelTriggered && result.cancelTokenObserved === true && result.cancelIpcPayload?.handle === result.cancelProgressHandle && result.cancelIpcPayload.choice === undefined), JSON.stringify({
        cancelBackChannelChoice: result.cancelBackChannelChoice,
        cancelIpcPayload: result.cancelIpcPayload,
        cancelTokenObserved: result.cancelTokenObserved,
      }))
      add("notification actions click smoke renders progress notifications with primary secondary and cancel actions", progressActionIds.includes("progress.button.0") && progressActionIds.includes("workbench.extensions.manage") && progressActionIds.includes("progress.cancel") && cancelProgressActionIds.includes("progress.cancel"), JSON.stringify({
        primaryNotificationId: primaryResult.notificationId,
        cancelNotificationId: cancelResult.notificationId,
        progressActionIds,
        cancelProgressActionIds,
        progressActionLabels: primaryResult.progressActionLabels,
      }))
      add("notification actions click smoke hits actual action buttons", clickResults.length === 3 && clickResults.every((item) => item.hitTargetMatched), JSON.stringify(clickResults))
      add("notification actions click smoke cleans up notification queue", Number(primaryResult.afterCount || 0) === Math.max(0, Number(primaryResult.beforeCount || 0) - 1) && Number(cancelResult.afterCount || 0) === Math.max(0, Number(cancelResult.beforeCount || 0) - 1), JSON.stringify({
        primaryBeforeCount: primaryResult.beforeCount,
        primaryAfterCount: primaryResult.afterCount,
        cancelBeforeCount: cancelResult.beforeCount,
        cancelAfterCount: cancelResult.afterCount,
      }))
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = {
        ok: allFailed.length === 0,
        checks: allChecks,
        notificationActionsClick: result,
      }
      writeElectronSmokeStage("run-smoke:write-notification-actions-click-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-task-provider-execute")
    const taskProviderExecuteResult = await exerciseElectronSmokeTaskProviderExecute(win)
    if (isTaskProviderExecuteSmoke) {
      writeElectronSmokeStage("run-smoke:collect-task-provider-execute-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const result = taskProviderExecuteResult || {}
      const rendererEvents = Array.isArray(result.rendererEvents) ? result.rendererEvents : []
      const taskRows = Array.isArray(result.taskRows) ? result.taskRows : []
      const extHostCalls = Array.isArray(result.extHostCalls) ? result.extHostCalls : []
      add("task provider execute smoke emits MainThreadTask execute renderer event", rendererEvents.some((entry) => entry.channel === "ext-host:task-provider-execute"), JSON.stringify(rendererEvents))
      add("task provider execute smoke calls ExtHostTask resolveTask", extHostCalls.some((entry) => entry.method === "$resolveTask"), JSON.stringify(extHostCalls))
      add("task provider execute smoke opens Task panel through smoke-only hook", result.taskProviderExecutePanelHookAvailable === true && !result.taskProviderExecutePanelHookError && result.taskPanelVisible === true, JSON.stringify(result))
      add("task provider execute smoke keeps Task workbench state source", result.taskPanelStateSource === "taskConfigurationModel/userTasksService/problemMatcherRegistry", JSON.stringify(result))
      add("task provider execute smoke projects provider task row", taskRows.some((row) => row.source === "extensionProvider" && String(row.text || "").includes("npm: electron provider smoke")), JSON.stringify(taskRows))
      add("task provider execute smoke reports passed lifecycle evidence", result.taskPanelLatestStatus === "passed", JSON.stringify(result))
      add("task provider execute smoke exposes output evidence", Boolean(result.taskOutputVisibleInEvidence), JSON.stringify(result))
      add("task provider execute smoke avoids execute blocked event", !rendererEvents.some((entry) => entry.channel === "ext-host:task-provider-execute-blocked"), JSON.stringify(rendererEvents))
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = {
        ok: allFailed.length === 0,
        checks: allChecks,
        taskProviderExecute: result,
        blockedReason: result.taskPanelBlockedReason || result.taskOutputBlockedReason || "",
      }
      writeElectronSmokeStage("run-smoke:write-task-provider-execute-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    if (isTaskProviderBackgroundOwnerSmoke) {
      writeElectronSmokeStage("run-smoke:collect-task-provider-background-owner-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const result = taskProviderExecuteResult || {}
      const rendererEvents = Array.isArray(result.rendererEvents) ? result.rendererEvents : []
      const taskRows = Array.isArray(result.taskRows) ? result.taskRows : []
      const extHostCalls = Array.isArray(result.extHostCalls) ? result.extHostCalls : []
      const evidence = result.executionEvidence || {}
      const tabActions = Array.isArray(result.terminalTabActions) ? result.terminalTabActions : []
      const actionHook = result.taskProviderActionResult || {}
      const actionResult = actionHook.result || {}
      const actionCommands = actionResult.commandResults || {}
      const beforeAction = actionResult.beforeAction || {}
      const afterRerunAction = actionResult.afterRerunAction || {}
      const afterTerminateAllAction = actionResult.afterTerminateAllAction || {}
      add("task provider background owner smoke emits MainThreadTask execute renderer event", rendererEvents.some((entry) => entry.channel === "ext-host:task-provider-execute"), JSON.stringify(rendererEvents))
      add("task provider background owner smoke calls ExtHostTask resolveTask", extHostCalls.some((entry) => entry.method === "$resolveTask"), JSON.stringify(extHostCalls))
      add("task provider background owner smoke opens Task panel through smoke-only hook", result.taskProviderExecutePanelHookAvailable === true && !result.taskProviderExecutePanelHookError && result.taskPanelVisible === true, JSON.stringify(result))
      add("task provider background owner smoke keeps Task workbench state source", result.taskPanelStateSource === "taskConfigurationModel/userTasksService/problemMatcherRegistry", JSON.stringify(result))
      add("task provider background owner smoke projects background provider task row", taskRows.some((row) => row.source === "extensionProvider" && String(row.text || "").includes("npm: electron provider watch owner")), JSON.stringify(taskRows))
      add("task provider background owner smoke keeps active terminal owner", result.terminalOwnership === "available" && evidence.terminalOwnerCreated === true && evidence.terminalOwnerResolved === true && evidence.activeExecutionMapped === true, JSON.stringify({ terminalOwnership: result.terminalOwnership, evidence }))
      add("task provider background owner smoke exposes terminateAll owner capability", result.supportsTerminateAll === true && tabActions.some((entry) => entry.id === "workbench.action.tasks.terminateAll" && entry.available === true), JSON.stringify({ supportsTerminateAll: result.supportsTerminateAll, tabActions }))
      add("task provider background owner smoke exposes restartActiveTerminal owner capability", result.supportsRestartActiveTerminal === true && tabActions.some((entry) => entry.id === "workbench.action.tasks.rerunTask" && entry.available === true), JSON.stringify({ supportsRestartActiveTerminal: result.supportsRestartActiveTerminal, tabActions }))
      add("task provider background owner smoke triggers task action hook through renderer command registry", actionHook.available === true && !actionHook.error && actionResult.taskProviderActionSmokeHook === true, JSON.stringify(actionHook))
      add("task provider background owner smoke command hook restarts active task terminal owner", actionCommands.rerunActiveTerminal === true && beforeAction.terminalOwnership === "available" && afterRerunAction.lastAction === "rerun" && Number(afterRerunAction.activeExecutionCount || 0) > 0 && typeof afterRerunAction.terminalInstanceId === "number", JSON.stringify({ commandResults: actionCommands, beforeAction, afterRerunAction, commandErrors: actionResult.commandErrors }))
      add("task provider background owner smoke command hook terminates restarted provider owner", actionCommands.terminateAll === true && afterTerminateAllAction.lastAction === "terminate" && Number(afterTerminateAllAction.activeExecutionCount || 0) === 0, JSON.stringify({ commandResults: actionCommands, afterTerminateAllAction, commandErrors: actionResult.commandErrors }))
      add("task provider background owner smoke avoids execute blocked event", !rendererEvents.some((entry) => entry.channel === "ext-host:task-provider-execute-blocked"), JSON.stringify(rendererEvents))
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = {
        ok: allFailed.length === 0,
        smokeCase: "task-provider-background-owner",
        checks: allChecks,
        taskProviderBackgroundOwner: result,
        blockedReason: result.terminalOwnership === "available"
          ? ""
          : evidence.blockedReason || result.taskPanelBlockedReason || result.taskOutputBlockedReason || "",
      }
      writeElectronSmokeStage("run-smoke:write-task-provider-background-owner-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-debug-output-bridge")
    const debugOutputBridgeResult = await exerciseElectronSmokeDebugOutputBridge(win)
    if (isDebugOutputBridgeSmoke) {
      writeElectronSmokeStage("run-smoke:collect-debug-output-bridge-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const result = debugOutputBridgeResult || {}
      const outputEvidence = result.outputEvidence || {}
      const debugEvidence = result.debugEvidence || {}
      const rendererEvents = Array.isArray(result.rendererEvents) ? result.rendererEvents : []
      const outputNoDoubleAppendEvidence = result.outputNoDoubleAppendEvidence || {}
      const expectedOutputContent = ["debug-output-smoke:first\n", "debug-output-smoke:second\n"]
      add("debug/output bridge smoke emits output register event", rendererEvents.some((entry) => entry.channel === "ext-host:output-register"), JSON.stringify(rendererEvents))
      add("debug/output bridge smoke emits exact backing file content events", JSON.stringify(outputNoDoubleAppendEvidence.contentEventContents || []) === JSON.stringify(expectedOutputContent), JSON.stringify(outputNoDoubleAppendEvidence))
      add("debug/output bridge smoke projects each backing file line exactly once into renderer output service", outputNoDoubleAppendEvidence.previewFirstCount === 1 && outputNoDoubleAppendEvidence.previewSecondCount === 1, JSON.stringify(outputEvidence))
      add("debug/output bridge smoke reads backing file increments without output double append", outputNoDoubleAppendEvidence.noDoubleAppend === true && outputNoDoubleAppendEvidence.contentEventsMatchBackingFile === true && outputNoDoubleAppendEvidence.backingFileContentMatchesExpected === true, JSON.stringify(outputNoDoubleAppendEvidence || {}))
      add("debug/output bridge smoke keeps unified output state source", outputEvidence.serviceId === "outputService" && outputEvidence.stateSource === "outputLogTelemetryService", JSON.stringify(outputEvidence))
      add("debug/output bridge smoke shows extension output channel", outputEvidence.activeChannelName === outputEvidence.channelLabel && outputEvidence.visibleChannelName === outputEvidence.channelLabel, JSON.stringify(outputEvidence))
      add("debug/output bridge smoke renders output panel content from outputLogTelemetryService", outputEvidence.rendererOutputEvidence?.panelVisible === true && outputEvidence.rendererOutputEvidence?.contentVisible === true && outputEvidence.rendererOutputEvidence?.serviceSource === "outputLogTelemetryService", JSON.stringify(outputEvidence.rendererOutputEvidence || {}))
      add("debug/output bridge smoke syncs OutputPanel active channel to revealed extension output", outputEvidence.rendererOutputEvidence?.activeChannel === outputEvidence.channelLabel && outputEvidence.rendererOutputEvidence?.entryCount >= 2, JSON.stringify(outputEvidence.rendererOutputEvidence || {}))
      add("debug/output bridge smoke shows backing file lines as visible renderer output text", String(outputEvidence.rendererOutputEvidence?.text || "").includes(expectedOutputContent[0].trim()) && String(outputEvidence.rendererOutputEvidence?.text || "").includes(expectedOutputContent[1].trim()), JSON.stringify(outputEvidence.rendererOutputEvidence || {}))
      add("debug/output bridge smoke observes shared debugState", debugEvidence.hasSetupDebugState === true && debugEvidence.stateSource === "debugState", JSON.stringify(debugEvidence))
      add("debug/output bridge smoke routes REPL evaluate input and error into debugState.consoleOutput", debugEvidence.evaluatePathReached === true && debugEvidence.evaluateResult === "Error: not connected", JSON.stringify(debugEvidence))
      add("debug/output bridge smoke routes successful REPL evaluate output into debugState.consoleOutput", debugEvidence.successEvaluatePathReached === true && debugEvidence.successEvaluateResult === "debug-output-bridge-success-result", JSON.stringify(debugEvidence))
      add("debug/output bridge smoke avoids debug REPL double append", debugEvidence.noDoubleAppend === true && debugEvidence.inputCount === 1 && debugEvidence.errorCount === 1 && debugEvidence.outputCount === 1, JSON.stringify(debugEvidence))
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = {
        ok: allFailed.length === 0,
        checks: allChecks,
        debugOutputBridge: result,
        blockedReason: debugEvidence.blockedReason || "",
      }
      writeElectronSmokeStage("run-smoke:write-debug-output-bridge-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-output-log")
    const outputLogResult = await exerciseElectronSmokeOutputLog(win)
    if (isOutputLogSmoke) {
      writeElectronSmokeStage("run-smoke:collect-output-log-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const result = outputLogResult || {}
      const rendererEvents = Array.isArray(result.rendererEvents) ? result.rendererEvents : []
      const output = result.beforeClearEvidence?.output || {}
      const ownerEvidence = output.ownerEvidence || {}
      const panelDataset = result.beforeClearEvidence?.panelDataset || {}
      const afterClear = result.afterClearEvidence || {}
      const contentEvents = rendererEvents.filter((entry) => entry.channel === "ext-host:output-content")
      const clearContentEvent = contentEvents.find((entry) => Number(entry.payload?.mode) === 3)
      add("output/log smoke emits VS Code-style register event with owner evidence", rendererEvents.some((entry) => entry.channel === "ext-host:output-register" && entry.payload?.ownerEvidence?.owner === "MainThreadOutputService"), JSON.stringify(rendererEvents))
      add("output/log smoke emits append and clear content events", contentEvents.length >= 3 && clearContentEvent?.payload?.content === "", JSON.stringify(contentEvents))
      add("output/log smoke projects append/show into unified output service", String(output.preview || "").includes("output-log-smoke:first") && String(output.preview || "").includes("output-log-smoke:second") && output.activeChannelName === result.channelLabel && output.visibleChannelName === result.channelLabel, JSON.stringify(output))
      add("output/log smoke keeps unified output state source", output.serviceId === "outputService" && output.stateSource === "outputLogTelemetryService", JSON.stringify(output))
      add("output/log smoke exposes service owner evidence as partial UI owner", ownerEvidence.owner === "outputLogTelemetryService" && ownerEvidence.mainThreadOwner === "MainThreadOutputService" && ownerEvidence.rendererOwner === "OutputPanel" && ownerEvidence.uiOwnerState === "partial" && ownerEvidence.evidenceState === "partial", JSON.stringify(ownerEvidence))
      add("output/log smoke exposes OutputPanel smoke metadata from the same owner", panelDataset.owner === "outputLogTelemetryService" && panelDataset.mainThreadOwner === "MainThreadOutputService" && panelDataset.rendererOwner === "OutputPanel" && panelDataset.stateSource === "outputLogTelemetryService" && panelDataset.uiOwnerState === "partial", JSON.stringify(panelDataset))
      add("output/log smoke records remaining UI owner gap without claiming connected", String(ownerEvidence.remainingGap || panelDataset.remainingGap || "").includes("App.vue") && ownerEvidence.uiOwnerState !== "connected" && panelDataset.uiOwnerState !== "connected", JSON.stringify({ ownerEvidence, panelDataset }))
      add("output/log smoke clears the channel through MainThreadOutputService clear update", afterClear.entryCount === 0 && String(afterClear.preview || "") === "", JSON.stringify(afterClear))
      add("output/log smoke keeps owner evidence free of raw output payload", result.ownerEvidenceLeakCheck?.rawSecretAbsent === true && result.ownerEvidenceLeakCheck?.rawFirstLineAbsent === true && result.ownerEvidenceLeakCheck?.rawSecondLineAbsent === true && result.ownerEvidenceLeakCheck?.partialUiOwnerNotConnected === true, JSON.stringify(result.ownerEvidenceLeakCheck || {}))
      const allChecks = [...checks, ...runBackgroundSmokeChecks()]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = {
        ok: allFailed.length === 0,
        smokeCase: "output-log",
        checks: allChecks,
        outputLog: result,
        outputLogOwnerEvidence: ownerEvidence,
        panelDataset,
        remainingGap: ownerEvidence.remainingGap || panelDataset.remainingGap || "",
        nextAuthorizedFiles: ownerEvidence.nextAuthorizedFiles || [],
        blockedReason: ownerEvidence.remainingGap || panelDataset.remainingGap || "",
      }
      writeElectronSmokeStage("run-smoke:write-output-log-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-debug-session")
    const debugSessionResult = await exerciseElectronSmokeDebugSession(win)
    if (isDebugSessionSmoke) {
      writeElectronSmokeStage("run-smoke:collect-debug-session-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const result = debugSessionResult || {}
      const metadata = result.metadata || {}
      const bridgeEvidence = result.bridgeEvidence || {}
      const mainBridge = result.mainThreadBridgeEvidence || {}
      const redaction = result.redaction || {}
      const owner = result.debugViewContainerOwner || {}
      add("debug session smoke observes a real DAP session id", result.sessionObserved === true && metadata.sessionIdPrefix === "dap-" && Number(metadata.sessionIdLength || 0) > 4, JSON.stringify(metadata))
      add("debug session smoke keeps DAP evidence metadata-only", result.dapMetadataOnly === true && Array.isArray(metadata.capabilityKeys), JSON.stringify(metadata))
      add("debug session smoke uses shared debugState projection", metadata.stateSource === "debugState" || bridgeEvidence.debugStateSource === "debugState", JSON.stringify({ metadata, bridgeEvidence }))
      add("debug session smoke observes renderer DAP IPC bridge", bridgeEvidence.dapIpc?.start === true && bridgeEvidence.dapIpc?.send === true && bridgeEvidence.dapIpc?.stop === true && bridgeEvidence.dapIpc?.onEvent === true, JSON.stringify(bridgeEvidence))
      add("debug session smoke observes MainThread DAP bridge commands", mainBridge.source === "MainThreadDebugService.dapIpcBridge" && Number(mainBridge.commandCount || 0) > 0 && Array.isArray(mainBridge.commands) && mainBridge.commands.includes("initialize"), JSON.stringify(mainBridge))
      add("debug session smoke redacts expression/source/adapter args", redaction.noExpressionText === true && redaction.noSourcePathText === true && redaction.noAdapterArgsText === true && !JSON.stringify(result).includes("debug-session-smoke.js") && !JSON.stringify(result).includes("runtimeExecutable"), JSON.stringify(redaction))
      add("debug session smoke does not claim full Debug View Container owner", owner.status === "partial" && owner.connected === false, JSON.stringify(owner))
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const debugSession = {
        sessionObserved: result.sessionObserved === true,
        ...result,
      }
      const payload = {
        ok: allFailed.length === 0,
        smokeCase: "debug-session",
        blocked: allFailed.length > 0 || result.blocked === true,
        dapMetadataOnly: true,
        checks: allChecks,
        debugSession,
        blockedReason: result.blockedReason || "",
      }
      writeElectronSmokeStage("run-smoke:write-debug-session-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-notebook-markdown-preview")
    const notebookMarkdownPreviewResult = await exerciseElectronSmokeNotebookMarkdownPreview(win)
    if (isNotebookMarkdownPreviewSmoke) {
      writeElectronSmokeStage("run-smoke:collect-notebook-markdown-preview-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const result = notebookMarkdownPreviewResult || {}
      const snapshot = result.snapshot || {}
      const notebookSnapshot = result.notebookSnapshot || {}
      const rendererProjection = result.rendererProjection || {}
      const kernelProjection = result.kernelProjection || {}
      const smokeEvidence = result.smokeEvidence || {}
      const domEvidence = result.domEvidence || {}
      add("notebook markdown preview smoke uses App.vue generic workbench control owner", result.owner === "App.vue __codekSmokeWorkbenchControls.runNotebookMarkdownPreviewSmoke", JSON.stringify({ owner: result.owner || "" }))
      add("notebook markdown preview smoke opens preview through notebookMarkdownPreviewService", snapshot.source === "notebookMarkdownPreviewService" && Number(snapshot.previewCount || 0) === 1 && domEvidence.markdownPreviewSource === "notebookMarkdownPreviewService", JSON.stringify({ snapshot, domEvidence }))
      add("notebook markdown preview smoke opens notebook document through notebook service projection", notebookSnapshot.source === "notebookMarkdownPreviewService" && Number(notebookSnapshot.documentCount || 0) === 1 && smokeEvidence.notebookServiceId === "notebookService", JSON.stringify({ notebookSnapshot, smokeEvidence }))
      add("notebook markdown preview smoke selects registered kernel through notebookKernelService projection", result.selectedKernel === true && kernelProjection.source === "notebookKernelService" && Number(kernelProjection.selectedKernelCount || 0) === 1, JSON.stringify(kernelProjection))
      add("notebook markdown preview smoke posts renderer message through notebookRendererMessagingService", result.messagePosted === true && rendererProjection.source === "notebookRendererMessagingService" && rendererProjection.messageBridgeReady === true && Number(rendererProjection.rendererMessageCount || 0) === 1, JSON.stringify(rendererProjection))
      add("notebook markdown preview smoke keeps one notebook/renderer state source", result.constraints?.noSecondNotebookOrRendererStateSource === true && result.constraints?.stateSource === "notebookMarkdownPreviewService", JSON.stringify(result.constraints || {}))
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = {
        ok: allFailed.length === 0,
        smokeCase: "notebook-markdown-preview",
        checks: allChecks,
        notebookMarkdownPreview: result,
        blockedReason: "",
      }
      writeElectronSmokeStage("run-smoke:write-notebook-markdown-preview-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-testing-publish-results")
    const testingPublishResults = await exerciseElectronSmokeTestingPublishResults(win)
    if (isTestingPublishResultsSmoke) {
      writeElectronSmokeStage("run-smoke:collect-testing-publish-results-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const result = testingPublishResults || {}
      const publishBridge = result.publishBridge || {}
      const domEvidence = result.domEvidence || {}
      const projection = result.projection || {}
      const constraints = result.constraints || {}
      const blocked = result.blocked || {}
      const mainDispatcher = result.mainDispatcher || {}
      add("testing publish smoke runs from Electron main dispatcher", mainDispatcher.invoked === true && mainDispatcher.owner === "desktop/main.js exerciseElectronSmokeTestingPublishResults", JSON.stringify(mainDispatcher))
      add("testing publish smoke calls TestingService.completeRun publish path", publishBridge.serviceCompletionInvoked === true && publishBridge.expectedSource === "TestingService.completeRun()", JSON.stringify(publishBridge))
      add("testing publish smoke exposes preload publish API", publishBridge.preloadApiAvailable === true, JSON.stringify(publishBridge))
      add("testing publish smoke renders Agent Evidence testing surface", domEvidence.agentEvidenceTestingVisible === true && Number(domEvidence.resultPeekEntryCount || 0) >= 1, JSON.stringify(domEvidence))
      add("testing publish smoke renders Testing result peek evidence", domEvidence.resultPeekStatus === "available" && Number(domEvidence.resultPeekEntryCount || 0) >= 1 && domEvidence.rowStates.includes("failed"), JSON.stringify(domEvidence))
      add("testing publish smoke renders minimal TestingExplorerView shell and WorkbenchObjectTree row projection", domEvidence.testingExplorerShellStatus === "partial" && domEvidence.testingExplorerObjectTreePresent === true && Number(domEvidence.testingExplorerRowCount || 0) >= 3 && Array.isArray(domEvidence.testingExplorerDomRowIds) && domEvidence.testingExplorerDomRowIds.length >= 3 && projection.explorerDomHookConnected === true, JSON.stringify({ domEvidence, projection }))
      add("testing publish smoke renders minimal TestingExplorerFilter input hook", domEvidence.testingExplorerFilterInputPresent === true && typeof domEvidence.testingExplorerDomFilterValue === "string" && domEvidence.testingExplorerNoSecondState === true, JSON.stringify(domEvidence))
      add("testing publish smoke renders minimal TestResultsViewContent shell rows", domEvidence.resultsViewStatus === "available" && Number(domEvidence.resultsViewTreeRowCount || 0) >= 2 && Array.isArray(domEvidence.resultsViewRowKinds) && domEvidence.resultsViewRowKinds.includes("run") && domEvidence.resultsViewRowKinds.includes("test") && domEvidence.resultsViewNoSecondState === true, JSON.stringify(domEvidence))
      add("testing publish smoke keeps result projection aligned to completed failed run", projection.runState === "failed" && Number(projection.failed || 0) >= 1 && projection.latestRunId === domEvidence.latestRunId, JSON.stringify(projection))
      add("testing publish smoke keeps single Testing state source", constraints.noSecondTestingStateSource === true && domEvidence.noSecondState === true, JSON.stringify({ constraints, domEvidence }))
      add("testing publish smoke does not claim VS Code ViewPane owners", constraints.fullViewPaneOwnerClaimed === false && blocked.testingExplorerViewPaneOwner === true && blocked.testingViewPaneContainerOwner === true, JSON.stringify({ constraints, blocked }))
      add("testing publish smoke records dispatcher as connected", blocked.electronMainSmokeDispatcher === false, JSON.stringify(blocked))
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = {
        ok: allFailed.length === 0,
        smokeCase: "testing-publish-results",
        checks: allChecks,
        testingPublishResults: result,
        blockedReason: allFailed.length ? "Testing publish results Electron smoke failed" : "",
      }
      writeElectronSmokeStage("run-smoke:write-testing-publish-results-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-accessible-view-visible-owner")
    const accessibleViewVisibleOwnerResult = await exerciseElectronSmokeAccessibleViewVisibleOwner(win)
    if (isAccessibleViewVisibleOwnerSmoke) {
      writeElectronSmokeStage("run-smoke:collect-accessible-view-visible-owner-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const result = accessibleViewVisibleOwnerResult || {}
      const domEvidence = result.domEvidence || {}
      const toolbarActionClick = result.toolbarActionClick || {}
      const focusRestore = result.focusRestore || {}
      const connected = result.connected || {}
      const blocked = result.blocked || {}
      const constraints = result.constraints || {}
      add("accessible view smoke uses App.vue DOM shell owner", result.owner === "App.vue __codekSmokeWorkbenchControls.runAccessibleViewVisibleOwnerSmoke", JSON.stringify({ owner: result.owner || "" }))
      add("accessible view smoke shows visible DOM shell from globalAccessibleViewService", domEvidence.visible === true && domEvidence.stateSource === "globalAccessibleViewService.getRendererProjection()" && domEvidence.domShellOwner === "headless-service-adapter", JSON.stringify(domEvidence))
      add("accessible view smoke proves provider lifecycle through service", connected.providerLifecycle === true && result.showResult?.shown === true, JSON.stringify(result.showResult || {}))
      add("accessible view smoke executes DOM-shell AccessibleView action", connected.domShellToolbarAction === true && toolbarActionClick.executed === true && toolbarActionClick.contentChanged === true && toolbarActionClick.menuId === "AccessibleView", JSON.stringify(toolbarActionClick))
      add("accessible view smoke records App.vue editor.focus restore invocation", connected.focusRestoreInvocation === true && focusRestore.focusRestoreInvocationOwner === "App.vue editor.focus" && focusRestore.invoked === true, JSON.stringify(focusRestore))
      add("accessible view smoke keeps no second accessibility state", constraints.noSecondAccessibilityState === true && domEvidence.noSecondState === true, JSON.stringify({ constraints, domEvidence }))
      add("accessible view smoke does not claim CodeEditorWidget or WorkbenchToolBar owners", domEvidence.codeEditorBacked === false && domEvidence.workbenchToolbarBacked === false && blocked.codeEditorWidget === true && blocked.workbenchToolbar === true, JSON.stringify({ domEvidence, blocked }))
      add("accessible view smoke keeps quick-pick and context-view owners blocked", domEvidence.quickPickOwner === "missing" && blocked.symbolQuickPick === true && blocked.contextView === true, JSON.stringify({ domEvidence, blocked }))
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = {
        ok: allFailed.length === 0,
        smokeCase: "accessible-view-visible-owner",
        checks: allChecks,
        accessibleViewVisibleOwner: result,
        blockedReason: "",
      }
      writeElectronSmokeStage("run-smoke:write-accessible-view-visible-owner-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-workspace-trust-downgrade-restart")
    const workspaceTrustDowngradeRestartResult = await exerciseElectronSmokeWorkspaceTrustDowngradeRestart(win)
    if (isWorkspaceTrustDowngradeRestartSmoke) {
      writeElectronSmokeStage("run-smoke:collect-workspace-trust-downgrade-restart-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const result = workspaceTrustDowngradeRestartResult || {}
      const snapshot = result.snapshot || {}
      const latestTransition = snapshot.latestTransition || {}
      const lifecycle = latestTransition.extensionHostLifecycle || {}
      const extensionEnablement = latestTransition.extensionEnablement || {}
      const states = Array.isArray(extensionEnablement.states) ? extensionEnablement.states : []
      const configureRequest = result.configureRequest || {}
      add("workspace trust downgrade smoke triggers configure settings query", configureRequest.opened === true && configureRequest.query === "@tag:workspaceTrust", JSON.stringify(configureRequest))
      add("workspace trust downgrade smoke transitions to restricted", snapshot.status === "restricted" && snapshot.trusted === false, JSON.stringify({ status: snapshot.status, trusted: snapshot.trusted }))
      add("workspace trust downgrade smoke records trust decisions", Number(snapshot.decisionCount || 0) >= 2 && snapshot.latestDecision?.decision === "deny", JSON.stringify(snapshot.latestDecision || {}))
      add("workspace trust downgrade smoke recomputes DisabledByTrustRequirement", Number(extensionEnablement.disabledByTrustRequirementCount || 0) > 0 && states.some((entry) => entry.state === "DisabledByTrustRequirement"), JSON.stringify(extensionEnablement))
      add("workspace trust downgrade smoke records stop/start lifecycle or precise blocked reason", lifecycle.action === "stopStart" && (
        ((lifecycle.status === "completed" || lifecycle.status === "blocked") && (lifecycle.restarted === true || lifecycle.blocked === true))
        || (lifecycle.status === "notRequired" && lifecycle.stopRequested === true && String(lifecycle.reason || "").length > 0)
      ), JSON.stringify(lifecycle))
      add("workspace trust downgrade smoke does not fake restart completion", lifecycle.status !== "blocked" || lifecycle.restarted !== true, JSON.stringify(lifecycle))
      add("workspace trust downgrade smoke keeps single trust store", snapshot.constraints?.noSecondTrustStore === true && result.surfaceNoSecondTrustStore === true, JSON.stringify({ constraints: snapshot.constraints || {}, surfaceNoSecondTrustStore: result.surfaceNoSecondTrustStore }))
      add("workspace trust downgrade smoke exposes restricted banner", result.bannerVisible === true && result.bannerStateSource === "WorkspaceTrustBannerService", JSON.stringify({ bannerVisible: result.bannerVisible, bannerStateSource: result.bannerStateSource, bannerActionLabels: result.bannerActionLabels }))
      add("workspace trust downgrade smoke exposes extension trust remote auth workbench", result.surfaceVisible === true && result.surfaceWorkspaceTrustServiceId === "workspaceTrustManagementService", JSON.stringify({ surfaceVisible: result.surfaceVisible, surfaceWorkspaceTrustServiceId: result.surfaceWorkspaceTrustServiceId, surfaceWorkspaceTrustStateSource: result.surfaceWorkspaceTrustStateSource }))
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = {
        ok: allFailed.length === 0,
        smokeCase: "workspace-trust-downgrade-restart",
        checks: allChecks,
        workspaceTrustDowngradeRestart: result,
        blockedReason: lifecycle.blocked ? lifecycle.reason || lifecycle.blockedBy || "workspace trust transition lifecycle blocked" : "",
      }
      writeElectronSmokeStage("run-smoke:write-workspace-trust-downgrade-restart-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-extension-install-confirmation")
    const extensionInstallConfirmationResult = await exerciseElectronSmokeExtensionInstallConfirmation(win)
    if (isExtensionInstallConfirmationSmoke) {
      writeElectronSmokeStage("run-smoke:collect-extension-install-confirmation-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const result = extensionInstallConfirmationResult || {}
      const modal = result.modalEvidence || {}
      const decision = result.decisionProjection || {}
      const gallery = result.galleryWorkbench || {}
      const detail = result.detailEvidence || {}
      const install = result.installResult || {}
      add("extension install confirmation smoke uses App.vue generic workbench control owner", result.owner === "App.vue __codekSmokeWorkbenchControls.runExtensionInstallConfirmationSmoke", JSON.stringify({ owner: result.owner || "" }))
      add("extension install confirmation smoke shows CodekDialogService modal", modal.visible === true && modal.serviceId === "dialogService", JSON.stringify(modal))
      add("extension install confirmation smoke exposes install dialog selectors", modal.source === "ExtensionInstallConfirmationSmoke" && modal.commandId === "workbench.extensions.install" && String(modal.resource || "").length > 0 && String(modal.buttonLabelsAttribute || "").length > 0, JSON.stringify(modal))
      add("extension install confirmation smoke clicks confirm through dialog service", decision.source === "ExtensionInstallConfirmationSmoke" && decision.evidenceContext?.commandId === "workbench.extensions.install" && decision.outcome === "confirmed", JSON.stringify(decision))
      add("extension install confirmation smoke keeps service-backed extension detail evidence", gallery.serviceId === "extensionsWorkbenchService" && detail.requiresConfirmation === true && (detail.stateSource === "service" || detail.stateSource === "extensionsWorkbenchService"), JSON.stringify({ gallery, detail }))
      add("extension install confirmation smoke routes install confirmation through service", install.confirmed === true && install.source === "extensionsWorkbenchService.resolveInstallConfirmation", JSON.stringify(install))
      add("extension install confirmation smoke keeps single install state source", result.constraints?.noSecondInstallStateSource === true && gallery.noSecondState === true, JSON.stringify({ constraints: result.constraints || {}, galleryNoSecondState: gallery.noSecondState }))
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = {
        ok: allFailed.length === 0,
        smokeCase: "extension-install-confirmation",
        checks: allChecks,
        extensionInstallConfirmation: result,
        blockedReason: result.blockedReason || "",
      }
      writeElectronSmokeStage("run-smoke:write-extension-install-confirmation-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-extension-host-restart")
    const extensionHostRestartResult = await exerciseElectronSmokeExtensionHostRestart(win)
    if (isExtensionHostRestartSmoke) {
      writeElectronSmokeStage("run-smoke:collect-extension-host-restart-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const result = extensionHostRestartResult || {}
      const evidence = result.evidence || {}
      const routeResult = result.routeResult || {}
      const evidenceJson = JSON.stringify(evidence || {})
      add("extension host restart smoke triggers from renderer through preload", result.rendererTrigger === true && result.preloadTrigger === true, JSON.stringify({ rendererTrigger: result.rendererTrigger, preloadTrigger: result.preloadTrigger }))
      add("extension host restart smoke reaches main process route", result.mainTrigger === true && result.route === "POST /extensions-host/lifecycle/restart", JSON.stringify({ mainTrigger: result.mainTrigger, route: result.route }))
      add("extension host restart route dispatch succeeds", routeResult.ok === true && routeResult.data?.success === true, JSON.stringify(routeResult))
      add("extension host restart evidence uses lifecycle service", evidence.serviceId === "extensionHostLifecycleService" && evidence.stateSource === "desktop.extensionsHostService", JSON.stringify(evidence))
      add("extension host restart composes stop/start evidence", evidence.stopEvidence?.stopped === true && evidence.startEvidence?.started === true, JSON.stringify(evidence))
      add("extension host restart replaces process", result.after?.processReplaced === true && Number(result.before?.pid || 0) > 0 && Number(result.after?.pid || 0) > 0, JSON.stringify({ before: result.before, after: result.after }))
      add("extension host restart does not reload workbench window", evidence.reloadRequested === false && evidence.reloaded === false && result.reloadEvidence?.windowUrlStable === true, JSON.stringify(result.reloadEvidence || {}))
      add("extension host restart stays separate from IHostService.reload", result.reloadEvidence?.noIHostServiceReload === true && !evidenceJson.includes("IHostService.reload"), evidenceJson)
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = {
        ok: allFailed.length === 0,
        smokeCase: "extension-host-restart",
        checks: allChecks,
        extensionHostRestart: result,
        blockedReason: result.blockedReason || "",
      }
      writeElectronSmokeStage("run-smoke:write-extension-host-restart-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-workspace-trust-editor")
    const workspaceTrustEditorResult = await exerciseElectronSmokeWorkspaceTrustEditor(win)
    if (isWorkspaceTrustEditorSmoke) {
      writeElectronSmokeStage("run-smoke:collect-workspace-trust-editor-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const result = workspaceTrustEditorResult || {}
      const editorPane = result.editorPane || {}
      const contracts = result.contracts || {}
      add("workspace trust editor smoke renders visible DOM", result.domVisible === true, JSON.stringify({ domVisible: result.domVisible }))
      add("workspace trust editor smoke focuses root element", result.activeAfterFocus === true && result.activeAfterEscape === true, JSON.stringify({ activeAfterFocus: result.activeAfterFocus, activeAfterEscape: result.activeAfterEscape }))
      add("workspace trust editor smoke supports keyboard section navigation", String(result.activeAfterArrowDown || "").length > 0 && Array.isArray(contracts.keyboardContracts) && contracts.keyboardContracts.length >= 3, JSON.stringify({ activeAfterArrowDown: result.activeAfterArrowDown, keyboardContracts: contracts.keyboardContracts }))
      add("workspace trust editor smoke exposes trusted folders table", result.trustedFoldersTableVisible === true && Number(result.trustedFolderCount || 0) >= 1, JSON.stringify({ trustedFoldersTableVisible: result.trustedFoldersTableVisible, trustedFolderCount: result.trustedFolderCount }))
      add("workspace trust editor smoke exposes affected features", result.affectedFeaturesVisible === true && Number(result.disabledByTrustRequirementCount || 0) >= 0, JSON.stringify({ affectedFeaturesVisible: result.affectedFeaturesVisible, disabledByTrustRequirementCount: result.disabledByTrustRequirementCount }))
      add("workspace trust editor smoke uses App.vue DOM/focus/keyboard owner", editorPane.domSmoke?.status === "available" && editorPane.paneOwnerStatus === "partial", JSON.stringify(editorPane.domSmoke || {}))
      add("workspace trust editor smoke keeps single trust store", contracts.noSecondTrustStore === true, JSON.stringify(contracts))
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = {
        ok: allFailed.length === 0,
        smokeCase: "workspace-trust-editor",
        checks: allChecks,
        workspaceTrustEditor: result,
        blockedReason: allFailed.length ? "WorkspaceTrustEditor DOM/focus/keyboard smoke failed" : "",
      }
      writeElectronSmokeStage("run-smoke:write-workspace-trust-editor-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-workspace-trust-request-dialog")
    const workspaceTrustRequestDialogResult = await exerciseElectronSmokeWorkspaceTrustRequestDialog(win)
    if (isWorkspaceTrustRequestDialogSmoke) {
      writeElectronSmokeStage("run-smoke:collect-workspace-trust-request-dialog-checks")
      const checks = []
      const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
      const result = workspaceTrustRequestDialogResult || {}
      const modal = result.modalEvidence || {}
      const decision = result.decisionProjection || {}
      const snapshot = result.trustSnapshot || {}
      const latestRequest = result.latestRequest || {}
      const readiness = result.smokeReadiness || {}
      const constraints = result.constraints || {}
      const serviceEvidence = result.serviceEvidence || {}
      add("workspace trust request smoke dry-run contract is runnable", result.smokeCase === "workspace-trust-request-dialog" && result.blocked !== true, JSON.stringify({ smokeCase: result.smokeCase, blocked: result.blocked }))
      add("workspace trust request smoke shows CodekDialogService modal", modal.visible === true && modal.serviceId === "dialogService", JSON.stringify(modal))
      add("workspace trust request smoke exposes readiness selectors", modal.source === "WorkspaceTrustRequestHandler" && modal.commandId === "workbench.trust.request" && String(modal.workspaceFolder || "").length > 0 && String(modal.buttonLabelsAttribute || "").length > 0, JSON.stringify(modal))
      add("workspace trust request smoke shows Grant/Deny/Manage equivalent buttons", modal.hasGrantOrTrust === true && modal.hasManage === true && modal.hasDenyOrCancel === true, JSON.stringify(modal.buttons || []))
      add("workspace trust request smoke clicks a decision through dialog service", decision.source === "WorkspaceTrustRequestHandler" && decision.evidenceContext?.commandId === "workbench.trust.request" && String(decision.buttonLabel || "").length > 0, JSON.stringify(decision))
      add("workspace trust request smoke writes decision back to WorkspaceTrustWorkbenchService", snapshot.status === "trusted" && snapshot.latestDecision?.decision === "allow" && latestRequest.status === "completed", JSON.stringify({ status: snapshot.status, latestDecision: snapshot.latestDecision, latestRequest }))
      add("workspace trust request smoke keeps single trust store", constraints.noSecondTrustStore === true && snapshot.constraints?.noSecondTrustStore === true, JSON.stringify({ constraints, snapshotConstraints: snapshot.constraints || {} }))
      add("workspace trust request smoke keeps single request source", constraints.noSecondRequestStore === true && serviceEvidence.requestLifecycleSource === "WorkspaceTrustWorkbenchService.requestLifecycle", JSON.stringify({ constraints, serviceEvidence }))
      add("workspace trust request smoke uses CodekDialogService decision projection", serviceEvidence.dialogDecisionSource === "CodekDialogService.getDecisionProjections", JSON.stringify(serviceEvidence))
      add("workspace trust request smoke reads WorkspaceTrustWorkbenchService trust snapshot", serviceEvidence.trustDecisionSource === "WorkspaceTrustWorkbenchService.getTrustSnapshot" && readiness.status === "ready", JSON.stringify({ serviceEvidence, readinessStatus: readiness.status }))
      add("workspace trust request smoke marks Manage pane partial only", result.managePane?.status === "partial" && String(result.managePane?.reason || "").includes("full WorkspaceTrustEditor pane is not claimed"), JSON.stringify(result.managePane || {}))
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = {
        ok: allFailed.length === 0,
        smokeCase: "workspace-trust-request-dialog",
        checks: allChecks,
        workspaceTrustRequestDialog: result,
        blockedReason: result.blockedReason || "",
      }
      writeElectronSmokeStage("run-smoke:write-workspace-trust-request-dialog-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-tab-overflow")
    await exerciseElectronSmokeTabOverflow(win)
    writeElectronSmokeStage("run-smoke:exercise-icon-visual-state")
    const iconVisualStateResult = await exerciseElectronSmokeIconVisualState(win)
    if (isIconVisualStateSmoke) {
      writeElectronSmokeStage("run-smoke:collect-icon-visual-state-checks")
      const result = []
      const add = (name, passed, detail = "") => result.push({ name, passed: Boolean(passed), detail })
      const iconVisual = iconVisualStateResult || {}
      const usableFallbackIcons = Boolean(
        iconVisual.commonExtensionsTyped
        && iconVisual.explorerIconsMounted
        && iconVisual.tabAndEditorIconsMounted,
      )
      const usableThemeOrFallbackIcons = Boolean(iconVisual.themeIconsMounted || usableFallbackIcons)
      const usableExplorerIcons = Boolean(iconVisual.explorerThemeIconsMounted || usableFallbackIcons)
      const usableTabIcons = Boolean(iconVisual.tabThemeIconsMounted || usableFallbackIcons)
      const usableEditorIcons = Boolean(iconVisual.editorThemeIconsMounted || usableFallbackIcons)
      const url = win.webContents.getURL()
      add("document url", Boolean(url), url)
      add("renderer did not load chrome error page", !url.startsWith("chrome-error://"), url)
      if (process.env.CODEK_USE_DEV_SERVER !== "1") {
        add("default startup uses built frontend files", url.startsWith("file:"), url)
      }
      add("login gate or app shell mounted", Boolean(iconVisual.projectRoot), iconVisual.projectRoot || "")
      add("icon visual smoke explorer icons mounted", Boolean(iconVisual.explorerIconsMounted), JSON.stringify(iconVisual))
      add("icon visual smoke uses VS Code theme or stable fallback icons", usableThemeOrFallbackIcons, JSON.stringify(iconVisual))
      add("icon visual smoke explorer uses VS Code theme or stable fallback icons", usableExplorerIcons, JSON.stringify(iconVisual))
      add("icon visual smoke tabs use VS Code theme or stable fallback icons", usableTabIcons, JSON.stringify(iconVisual))
      add("icon visual smoke editor title uses VS Code theme or stable fallback icon", usableEditorIcons, JSON.stringify(iconVisual))
      add("icon visual smoke folder open and closed states differ", Boolean(iconVisual.folderStatesDiffer), JSON.stringify(iconVisual))
      add("icon visual smoke folder icons do not reserve custom slots", Boolean(iconVisual.folderIconsHidden), JSON.stringify(iconVisual.folderLayout || iconVisual))
      add("icon visual smoke file icons remain visible", Boolean(iconVisual.fileIconsVisible), JSON.stringify(iconVisual.folderLayout || iconVisual))
      add("icon visual smoke folder label is adjacent to twistie", Boolean(iconVisual.folderLabelAdjacentToTwistie), JSON.stringify(iconVisual.folderLayout || iconVisual))
      add("icon visual smoke nested folder indent matches VS Code tree", Boolean(iconVisual.nestedFolderIndentMatchesVsCode), JSON.stringify(iconVisual.folderLayout || iconVisual))
      add("icon visual smoke common extensions have typed tokens", Boolean(iconVisual.commonExtensionsTyped), JSON.stringify(iconVisual))
      add("icon visual smoke tab and editor icons mounted", Boolean(iconVisual.tabAndEditorIconsMounted), JSON.stringify(iconVisual))
      add("icon visual smoke screenshot captures editor surface", Boolean(iconVisual.screenshotVisualReady), JSON.stringify({
        paintState: iconVisual.paintState,
        restoredState: iconVisual.screenshotRestoredState,
      }))
      add("icon visual smoke writes screenshot evidence", Boolean(iconVisual.screenshotExists), iconVisual.screenshotPath || "")
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...(Array.isArray(result) ? result : []), ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = { ok: allFailed.length === 0, checks: allChecks }
      writeElectronSmokeStage("run-smoke:write-icon-visual-state-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-real-project-ui")
    const realProjectUiResult = await exerciseElectronSmokeRealProjectUi(win)
    if (isRealProjectUiSmoke) {
      writeElectronSmokeStage("run-smoke:collect-real-project-ui-checks")
      const acceptance = realProjectUiResult?.acceptance || buildRealProjectUiSmokeAcceptance(realProjectUiResult || {})
      const gateAttribution = realProjectUiResult?.gateAttribution || buildRealProjectUiGateAttribution(acceptance)
      const manualAcceptanceContract = realProjectUiResult?.manualAcceptanceContract || gateAttribution.manualAcceptanceContract
      const attributionRows = Array.isArray(gateAttribution?.rows) ? gateAttribution.rows : []
      const checks = Object.entries(acceptance).map(([name, passed]) => ({
        name: `real project UI smoke ${name}`,
        passed: Boolean(passed),
        detail: JSON.stringify({
          projectRoot: realProjectUiResult?.projectRoot || "",
          evidence: realProjectUiResult?.evidence || null,
          gateAttribution: attributionRows.find((row) => Array.isArray(row.checks) && row.checks.includes(name)) || null,
        }),
      }))
      checks.push(
        {
          name: "real project UI smoke writes JSON evidence report",
          passed: Boolean(realProjectUiResult?.evidenceJsonExists),
          detail: JSON.stringify(realProjectUiResult?.evidence || {}),
        },
        {
          name: "real project UI smoke writes Markdown evidence report",
          passed: Boolean(realProjectUiResult?.evidenceMarkdownExists),
          detail: JSON.stringify(realProjectUiResult?.evidence || {}),
        },
        {
          name: "real project UI smoke writes screenshot evidence",
          passed: Boolean(realProjectUiResult?.evidenceScreenshotExists),
          detail: JSON.stringify(realProjectUiResult?.evidence || {}),
        },
      )
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = {
        ok: allFailed.length === 0,
        checks: allChecks,
        gateAttribution,
        manualAcceptanceContract,
        failedRows: Array.isArray(gateAttribution?.failedRows) ? gateAttribution.failedRows : [],
      }
      writeElectronSmokeStage("run-smoke:write-real-project-ui-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-workbench-ui-audit")
    const workbenchUiAuditResult = await exerciseElectronSmokeWorkbenchUiAudit(win)
    if (isWorkbenchUiAuditSmoke) {
      const checks = Array.isArray(workbenchUiAuditResult?.checks) ? workbenchUiAuditResult.checks : []
      const backgroundChecks = runBackgroundSmokeChecks()
      const allChecks = [...checks, ...backgroundChecks]
      const allFailed = allChecks.filter((item) => !item.passed)
      const payload = {
        ok: allFailed.length === 0,
        smokeCase: "workbench-ui-audit",
        checks: allChecks,
        report: workbenchUiAuditResult,
        outputDir: workbenchUiAuditResult?.outputDir || "",
        screenshotPaths: Array.isArray(workbenchUiAuditResult?.captures)
          ? workbenchUiAuditResult.captures.map((item) => item.screenshotPath)
          : [],
      }
      writeElectronSmokeStage("run-smoke:write-workbench-ui-audit-result", {
        checkCount: allChecks.length,
        failedCount: allFailed.length,
      })
      writeElectronSmokeResult(payload)
      console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
      clearTimeout(timeout)
      app.exit(allFailed.length === 0 ? 0 : 1)
      return
    }
    writeElectronSmokeStage("run-smoke:exercise-multiroot-create-target")
    await exerciseElectronSmokeMultiRootCreateTarget(win)
    writeElectronSmokeStage("run-smoke:wait-workbench-content")
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const started = Date.now()
        const tick = () => {
          const hasAuthGate = document.querySelector(".auth-overlay") || document.querySelector(".auth-card")
          const hasWorkbenchContent = document.querySelector(".welcome-page") || document.querySelector(".editor-container")
          if (hasAuthGate || hasWorkbenchContent || Date.now() - started > 10000) {
            resolve(true)
          } else {
            setTimeout(tick, 150)
          }
        }
        tick()
      })
    `)
    writeElectronSmokeStage("run-smoke:collect-checks")
    const result = await win.webContents.executeJavaScript(`
      (async () => {
        const checks = []
        const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
        const text = document.body ? document.body.innerText : ""
        const hasAppShell = Boolean(document.querySelector(".app-shell"))
        const hasAuthGate = Boolean(document.querySelector(".auth-overlay") || document.querySelector(".auth-card"))
        const jControls = window.__codekSmokeJControls || {}
        const workbenchControls = window.__codekSmokeWorkbenchControls || {}
        add("document url", Boolean(location.href), location.href)
        add("renderer did not load chrome error page", !location.href.startsWith("chrome-error://"), location.href)
        if (${JSON.stringify(process.env.CODEK_USE_DEV_SERVER !== "1")}) {
          add("default startup uses built frontend files", location.protocol === "file:", location.href)
        }
        add("body html sample", true, document.body ? document.body.innerHTML.slice(0, 300) : "")
        add("login gate or app shell mounted", hasAuthGate || hasAppShell)
        if (${JSON.stringify(process.env.CODEK_ELECTRON_SMOKE_LOGIN_WORKBENCH === "1" && process.env.CODEK_ELECTRON_SMOKE_ANALYSIS_WORKSPACE !== "1" && !isExplorerPerformanceSmoke && !isRealExplorerSmoke && !isExplorerStressSmoke && !isFileOperationVisibilitySmoke && !isSearchReplaceSmoke && !isEditorOpenFilesSmoke && !isNotebookMarkdownPreviewSmoke && !isAccessibleViewVisibleOwnerSmoke && !isSearchNavigationSmoke && !isArtifactOpenSmoke && !isTabOverflowSmoke && !isIconThemeRefreshSmoke && !isIconVisualStateSmoke && !isRealProjectUiSmoke && !isMultiRootCreateTargetSmoke)}) {
          add("workbench shell mounted after smoke login", hasAppShell)
          add("chat panel opens in smoke workbench", Boolean(document.querySelector(".chat-panel.open")))
          add("chat composer mounted in smoke workbench", Boolean(document.querySelector('[data-codek-smoke="chat-input"]')))
          add("chat agent task entry creates task center run", Boolean(workbenchControls.taskCreated || (text.includes("已进入任务中心") && document.querySelector('[data-codek-smoke="task-center-panel"]'))))
          add("task center summary visible in smoke workbench", Boolean(workbenchControls.taskCenter || document.querySelector('[data-codek-smoke="task-center-summary"]')) || text.includes("任务中心"))
          add("sidebar minimum width preserves marketplace controls", Boolean(
            workbenchControls.sidebarLayoutRect &&
            workbenchControls.sidebarLayoutRect.sidebarWidth >= 320 &&
            workbenchControls.sidebarLayoutRect.hasMarketplaceSearch &&
            workbenchControls.sidebarLayoutRect.searchWithinSidebar
          ), JSON.stringify(workbenchControls.sidebarLayoutRect || {}))
          add("chat layout minimum width prevents composer overlap", Boolean(workbenchControls.chatLayout), JSON.stringify(workbenchControls.chatLayoutRect || {}))
          add("sandbox mode bar uses compact controls", Boolean(workbenchControls.sandboxModeBar || (document.querySelector(".sandbox-mode-bar") && document.querySelector(".smb-switch"))))
          add("bottom panel output toggle opens real Output panel", Boolean(
            workbenchControls.bottomPanel &&
            workbenchControls.bottomPanel.hasBottomPanel &&
            workbenchControls.bottomPanel.hasOutputPanel
          ), JSON.stringify(workbenchControls.bottomPanel || {}))
          add("editor line numbers visible after file open", Boolean(workbenchControls.editorFileSurface?.hasLineNumber), JSON.stringify(workbenchControls.editorFileSurface || {}))
          add("cursor-style file tab surface visible", Boolean(
            workbenchControls.editorFileSurface?.hasActiveTab &&
            workbenchControls.editorFileSurface?.hasTabIcon
          ), JSON.stringify(workbenchControls.editorFileSurface || {}))
          add("file explorer surface mounted for opened file", Boolean(
            (workbenchControls.editorFileSurface?.hasExplorerHost &&
              workbenchControls.editorFileSurface?.hasExplorerSelection) ||
            workbenchControls.editorFileSurface?.hasMemoryFileRow
          ), JSON.stringify(workbenchControls.editorFileSurface || {}))
        }
        if (${JSON.stringify(process.env.CODEK_ELECTRON_SMOKE_ANALYSIS_WORKSPACE === "1")}) {
          const snapshot = await window.__codekSmokeAnalysisSnapshot?.()
          add("analysis smoke project opened", Boolean(snapshot && snapshot.projectRoot && snapshot.activeFile === "src/main.ts"), snapshot ? snapshot.projectRoot : "")
          add("analysis smoke outline generated", Boolean(snapshot && snapshot.outlineNames && snapshot.outlineNames.includes("greet")))
          add("analysis smoke diagnostics generated", Boolean(snapshot && snapshot.diagnostics && snapshot.diagnostics.some((diag) => String(diag.file || "").endsWith("src/broken.ts"))))
          add("analysis smoke breadcrumb state available", Boolean(snapshot && (snapshot.breadcrumbVisible || (snapshot.outlineNames && snapshot.outlineNames.includes("greet")))))
          add("analysis smoke context generated", Boolean(snapshot && snapshot.context && snapshot.context.includes("ACTIVE FILE: src/main.ts") && snapshot.context.includes("greet")))
          add("analysis smoke save refresh completed", Boolean(snapshot && snapshot.savedRefreshOk))
        }
        if (${JSON.stringify(isExplorerPerformanceSmoke)}) {
          const explorer = window.__codekSmokeExplorerPerformanceResult || {}
          const readDirCalls = Array.isArray(explorer.readDirCalls) ? explorer.readDirCalls : []
          const scaleProfile = explorer.workspaceScaleProfile || {}
          const runawayReadDir = readDirCalls.length > 8 || Number(explorer.readDirCallCount || 0) > 12
          add("explorer smoke native host mounted", Boolean(explorer.nativeHostMounted), JSON.stringify(explorer))
          add("explorer smoke enters huge workspace mode", scaleProfile.scale === "huge", JSON.stringify(scaleProfile))
          add("explorer smoke uses shallow huge-workspace watcher", scaleProfile.budgets && scaleProfile.budgets.watcherMode === "shallow", JSON.stringify(scaleProfile.budgets || {}))
          add("explorer smoke keeps full large directory model virtualized", Number(explorer.totalRows || 0) >= 10000 && Number(explorer.domRows || 0) > 0 && Number(explorer.domRows || 0) <= 120 && !explorer.blankVisibleRows, JSON.stringify({ totalRows: explorer.totalRows, domRows: explorer.domRows, blankVisibleRows: explorer.blankVisibleRows }))
          add("explorer smoke scroll p95 stays responsive", Number(explorer.p95ScrollMs || 0) <= 48, JSON.stringify({ p95ScrollMs: explorer.p95ScrollMs, maxScrollMs: explorer.maxScrollMs }))
          add("explorer smoke scroll max avoids half-second stalls", Number(explorer.maxScrollMs || 0) <= 160, JSON.stringify({ p95ScrollMs: explorer.p95ScrollMs, maxScrollMs: explorer.maxScrollMs, longTasks: explorer.longTasks }))
          add("explorer smoke readDir is lazy and bounded", !runawayReadDir && readDirCalls.some((item) => String(item).endsWith("/src")), JSON.stringify({ readDirCalls, readDirCallCount: explorer.readDirCallCount }))
          add("explorer smoke refresh completed", Boolean(explorer.refreshOk), JSON.stringify({ readDirCalls, readDirCallCount: explorer.readDirCallCount }))
          add("explorer smoke large file real content visible", Boolean(explorer.largeFileRealContentVisible || explorer.largeFileWindowVisible || explorer.largeFileOptimizedVisible), JSON.stringify({
            largeFileRealContentVisible: explorer.largeFileRealContentVisible,
            largeFileWindowVisible: explorer.largeFileWindowVisible,
            largeFileOptimizedVisible: explorer.largeFileOptimizedVisible,
            largeFileEditorVisible: explorer.largeFileEditorVisible,
            largeFileContentVisible: explorer.largeFileContentVisible,
          }))
          add("explorer smoke large file editor content visible", Boolean(explorer.largeFileEditorVisible && explorer.largeFileContentVisible), JSON.stringify({
            largeFileWindowVisible: explorer.largeFileWindowVisible,
            largeFileOptimizedVisible: explorer.largeFileOptimizedVisible,
            largeFileEditorVisible: explorer.largeFileEditorVisible,
            largeFileContentVisible: explorer.largeFileContentVisible,
          }))
          add("explorer smoke large file close and reopen shows real content", Boolean(explorer.largeFileReopenRealContentVisible && explorer.largeFileCloseReopenKeepsWorkbenchResponsive), JSON.stringify({
            largeFileReopenRealContentVisible: explorer.largeFileReopenRealContentVisible,
            largeFileCloseReopenKeepsWorkbenchResponsive: explorer.largeFileCloseReopenKeepsWorkbenchResponsive,
          }))
          add("explorer smoke large file avoids blocking or ordinary-file status", Boolean(explorer.largeFileLowNoiseStatusVisible && explorer.largeFileWarningBadgeHidden && explorer.largeFileOrdinaryStatusHidden !== false), JSON.stringify({
            largeFileLowNoiseStatusVisible: explorer.largeFileLowNoiseStatusVisible,
            largeFileOrdinaryStatusHidden: explorer.largeFileOrdinaryStatusHidden,
            largeFileWarningBadgeHidden: explorer.largeFileWarningBadgeHidden,
          }))
          add("explorer smoke extreme file auto-loads adjacent real window", Boolean(explorer.extremeFileAutoWindowNavigation), JSON.stringify({
            extremeFileAutoWindowNavigation: explorer.extremeFileAutoWindowNavigation,
            extremeFileFirstWindowVisible: explorer.extremeFileFirstWindowVisible,
            extremeFileSecondWindowVisible: explorer.extremeFileSecondWindowVisible,
          }))
          add("explorer smoke chat remains usable after large directory", Boolean(explorer.chatInputVisible), JSON.stringify({ chatInputVisible: explorer.chatInputVisible }))
        }
        if (${JSON.stringify(isRealExplorerSmoke)}) {
          const explorer = window.__codekSmokeRealExplorerResult || {}
          const readDirCalls = Array.isArray(explorer.readDirCalls) ? explorer.readDirCalls : []
          const scaleProfile = explorer.workspaceScaleProfile || {}
          const expandedPaths = Array.isArray(explorer.expandedPaths) ? explorer.expandedPaths : []
          const missingExpandPaths = Array.isArray(explorer.missingExpandPaths) ? explorer.missingExpandPaths : []
          const runawayReadDir = readDirCalls.length > 8 || Number(explorer.readDirCallCount || 0) > 12
          add("real explorer smoke native host mounted", Boolean(explorer.nativeHostMounted), JSON.stringify(explorer))
          add("real explorer smoke enters huge workspace mode", scaleProfile.scale === "huge", JSON.stringify(scaleProfile))
          add("real explorer smoke uses root-shallow watcher", scaleProfile.budgets && scaleProfile.budgets.watcherMode === "shallow", JSON.stringify(scaleProfile.budgets || {}))
          add("real explorer smoke expands requested folders", expandedPaths.length >= 1 && missingExpandPaths.length === 0, JSON.stringify({ expandedPaths, missingExpandPaths }))
          add("real explorer smoke keeps rows virtualized and non-blank", Number(explorer.domRows || 0) > 0 && Number(explorer.domRows || 0) <= 160 && !explorer.blankVisibleRows, JSON.stringify({ domRows: explorer.domRows, totalRows: explorer.totalRows, blankVisibleRows: explorer.blankVisibleRows }))
          add("real explorer smoke keeps explorer selection single", Number(explorer.selectedRowCount || 0) <= 1 && Number(explorer.ariaSelectedRowCount || 0) <= 1, JSON.stringify({ selectedRowCount: explorer.selectedRowCount, ariaSelectedRowCount: explorer.ariaSelectedRowCount, selectedRows: explorer.selectedRows }))
          add("real explorer smoke bounds simultaneous folder loading", Number(explorer.readDirInFlightMax || 0) <= 1, JSON.stringify({ loadingRowCountMax: explorer.loadingRowCountMax, readDirInFlightMax: explorer.readDirInFlightMax }))
          add("real explorer smoke visible rows stay stable after fast scroll", Boolean(explorer.visibleRowsStableAfterFastScroll), JSON.stringify({
            before: explorer.visibleRowSnapshotBeforeFastScroll,
            after: explorer.visibleRowSnapshotAfterFastScroll,
          }))
          add("real explorer smoke scroll p95 stays responsive", Number(explorer.p95ScrollMs || 0) <= 48, JSON.stringify({ p95ScrollMs: explorer.p95ScrollMs, maxScrollMs: explorer.maxScrollMs }))
          add("real explorer smoke scroll max avoids half-second stalls", Number(explorer.maxScrollMs || 0) <= 160, JSON.stringify({ p95ScrollMs: explorer.p95ScrollMs, maxScrollMs: explorer.maxScrollMs, longTasks: explorer.longTasks }))
          add("real explorer smoke readDir is lazy and bounded", !runawayReadDir && readDirCalls.length >= 1, JSON.stringify({ readDirCalls, readDirCallCount: explorer.readDirCallCount }))
        }
        if (${JSON.stringify(isExplorerStressSmoke)}) {
          const explorer = window.__codekSmokeExplorerStressResult || {}
          const readDirCalls = Array.isArray(explorer.readDirCalls) ? explorer.readDirCalls : []
          const scaleProfile = explorer.workspaceScaleProfile || {}
          const expandedPaths = Array.isArray(explorer.expandedPaths) ? explorer.expandedPaths : []
          const missingExpandPaths = Array.isArray(explorer.missingExpandPaths) ? explorer.missingExpandPaths : []
          const singleClickExpansionFailures = Array.isArray(explorer.singleClickExpansionFailures) ? explorer.singleClickExpansionFailures : []
          const runawayReadDir = readDirCalls.length > 16 || Number(explorer.readDirCallCount || 0) > 32
          add("explorer stress smoke native host mounted", Boolean(explorer.nativeHostMounted), JSON.stringify(explorer))
          add("explorer stress smoke opens huge real workspace mode", scaleProfile.scale === "huge", JSON.stringify(scaleProfile))
          add("explorer stress smoke expands every clicked directory once", expandedPaths.length >= 2 && missingExpandPaths.length === 0 && singleClickExpansionFailures.length === 0, JSON.stringify({ expandedPaths, missingExpandPaths, singleClickExpansionFailures }))
          add("explorer stress smoke never renders blank visible rows", !explorer.blankVisibleRows && !explorer.reopenBlankVisibleRows && Boolean(explorer.visibleRowsStableAfterStress), JSON.stringify({ blankVisibleRows: explorer.blankVisibleRows, reopenBlankVisibleRows: explorer.reopenBlankVisibleRows, visibleRowsStableAfterStress: explorer.visibleRowsStableAfterStress }))
          add("explorer stress smoke keeps one highlighted row", Number(explorer.selectedRowCountMax || 0) <= 1 && Number(explorer.ariaSelectedRowCountMax || 0) <= 1, JSON.stringify({ selectedRowCountMax: explorer.selectedRowCountMax, ariaSelectedRowCountMax: explorer.ariaSelectedRowCountMax, steps: explorer.steps }))
          add("explorer stress smoke does not snap back to top during rapid expansion", !explorer.scrollResetToTop && Number(explorer.scrollTopBeforeStress || 0) > 0, JSON.stringify({ scrollTopBeforeStress: explorer.scrollTopBeforeStress, scrollTopAfterStress: explorer.scrollTopAfterStress }))
          add("explorer stress smoke bounds simultaneous folder loading", Number(explorer.readDirInFlightMax || 0) <= 1, JSON.stringify({ loadingRowCountMax: explorer.loadingRowCountMax, readDirInFlightMax: explorer.readDirInFlightMax }))
          add("explorer stress smoke keeps rows virtualized", Number(explorer.domRows || 0) > 0 && Number(explorer.domRows || 0) <= 180, JSON.stringify({ domRows: explorer.domRows, totalRows: explorer.totalRows }))
          add("explorer stress smoke scroll p95 stays responsive", Number(explorer.p95ScrollMs || 0) <= 48, JSON.stringify({ p95ScrollMs: explorer.p95ScrollMs, maxScrollMs: explorer.maxScrollMs }))
          add("explorer stress smoke scroll max avoids half-second stalls", Number(explorer.maxScrollMs || 0) <= 160, JSON.stringify({ p95ScrollMs: explorer.p95ScrollMs, maxScrollMs: explorer.maxScrollMs, longTasks: explorer.longTasks }))
          add("explorer stress smoke readDir is lazy and bounded", !runawayReadDir && readDirCalls.length >= 2, JSON.stringify({ readDirCalls, readDirCallCount: explorer.readDirCallCount }))
        }
        if (${JSON.stringify(isFileOperationVisibilitySmoke)}) {
          const fileOperation = window.__codekSmokeFileOperationVisibilityResult || {}
          const visibleUnder200ms = ["createVisibleMs", "updateVisibleMs", "renameVisibleMs", "deleteVisibleMs"]
            .every((key) => Number(fileOperation[key] || 0) > 0 && Number(fileOperation[key] || 0) <= 200)
          add("file operation smoke native explorer mounted", Boolean(fileOperation.nativeHostMounted), JSON.stringify(fileOperation))
          add("file operation smoke update is visible in editor", Boolean(fileOperation.updatedEditorVisible), JSON.stringify(fileOperation))
          add("file operation smoke create is visible in explorer", Boolean(fileOperation.createdExplorerVisible), JSON.stringify(fileOperation))
          add("file operation smoke rename is visible in explorer", Boolean(fileOperation.renamedExplorerVisible), JSON.stringify(fileOperation))
          add("file operation smoke delete is hidden from explorer", Boolean(fileOperation.deletedExplorerHidden), JSON.stringify(fileOperation))
          add("file operation smoke chat remains usable", Boolean(fileOperation.chatInputVisible), JSON.stringify(fileOperation))
          add("file operation smoke visible latency is bounded", visibleUnder200ms, JSON.stringify({
            createVisibleMs: fileOperation.createVisibleMs,
            updateVisibleMs: fileOperation.updateVisibleMs,
            renameVisibleMs: fileOperation.renameVisibleMs,
            deleteVisibleMs: fileOperation.deleteVisibleMs,
          }))
        }
        if (${JSON.stringify(isSearchReplaceSmoke)}) {
          const searchReplace = window.__codekSmokeSearchReplaceResult || {}
          const afterOne = String(searchReplace.afterReplaceOne || "")
          const finalRepeated = String(searchReplace.finalRepeatedDisk || searchReplace.finalRepeated || "")
          const finalOther = String(searchReplace.finalOtherDisk || searchReplace.finalOther || "")
          const previewSummary = searchReplace.previewSummary || {}
          const replaceOneSummary = searchReplace.replaceOneSummary || {}
          const replaceAllSummary = searchReplace.replaceAllSummary || {}
          const changedFiles = Array.isArray(searchReplace.bulkEditChangedFiles) ? searchReplace.bulkEditChangedFiles : []
          add("search replace smoke search view active", Boolean(searchReplace.searchViewActive), JSON.stringify(searchReplace))
          add("search replace smoke finds multiple file groups", Number(searchReplace.initialGroupCount || 0) >= 2, JSON.stringify(searchReplace))
          add("search replace smoke preserves collapsed occurrence metadata", Number(searchReplace.collapsedOccurrenceCount || 0) >= 2, JSON.stringify(searchReplace))
          add("search replace smoke previews via dry-run without writing disk", Boolean(searchReplace.previewDryRun && !searchReplace.previewApplied && searchReplace.previewDidNotWriteDisk), JSON.stringify({ previewSummary, previewDidNotWriteDisk: searchReplace.previewDidNotWriteDisk }))
          add("search replace smoke preview reports bulk edit summary", Number(previewSummary.changedFileCount || 0) >= 2 && Number(previewSummary.editCount || 0) >= 2, JSON.stringify(previewSummary))
          add("search replace one applies through bulk edit service", Boolean(searchReplace.replaceOneApplied && Number(replaceOneSummary.changedFileCount || 0) === 1 && Number(replaceOneSummary.editCount || 0) === 1), JSON.stringify(replaceOneSummary))
          add("search replace one only changes first same-line occurrence", afterOne.includes("haystack needle") && !afterOne.includes("haystack haystack"), JSON.stringify({ afterReplaceOne: searchReplace.afterReplaceOne }))
          add("search replace all applies through bulk edit service", Boolean(searchReplace.replaceAllApplied && Number(replaceAllSummary.changedFileCount || 0) >= 2 && Number(replaceAllSummary.editCount || 0) >= 2), JSON.stringify(replaceAllSummary))
          add("search replace all updates repeated file on disk", finalRepeated.includes("haystack haystack") && !finalRepeated.includes("needle"), JSON.stringify({ finalRepeated }))
          add("search replace all updates unopened file on disk", finalOther.includes("haystack") && !finalOther.includes("needle"), JSON.stringify({ finalOther }))
          add("search replace smoke clears remaining grep matches", Number(searchReplace.remainingNeedleGroups || 0) === 0, JSON.stringify({ remainingNeedleGroups: searchReplace.remainingNeedleGroups }))
          add("search replace smoke records rollback risk and affected resources", Boolean(searchReplace.bulkEditAppliedViaService && changedFiles.includes("src/000-repeated.ts") && changedFiles.includes("src/100-other.ts") && searchReplace.rollbackRisk && searchReplace.rollbackRisk.replaceAllDescription), JSON.stringify({ changedFiles, rollbackRisk: searchReplace.rollbackRisk }))
          const searchRefreshEvidence = searchReplace.searchRefreshEvidence || {}
          add("search replace smoke refreshes search after FileService watcher", Boolean(searchRefreshEvidence.watcherRefreshStable === true && Number(searchRefreshEvidence.afterReplaceAllGroupCount || 0) === 0 && Number(searchRefreshEvidence.afterReplaceAllMatchCount || 0) === 0 && searchRefreshEvidence.changedFilesStillVisibleAfterReplaceAll === false && searchRefreshEvidence.searchBusy === false), JSON.stringify(searchRefreshEvidence))
          add("search replace smoke writes latest JSON and Markdown evidence", Boolean(searchReplace.evidenceJsonExists && searchReplace.evidenceMarkdownExists), JSON.stringify(searchReplace.evidence || {}))
        }
        if (${JSON.stringify(isSearchNavigationSmoke)}) {
          const searchNavigation = window.__codekSmokeSearchNavigationResult || {}
          add("search navigation smoke opens real editor content", Boolean(searchNavigation.openedContentVisible), JSON.stringify(searchNavigation))
          add("search navigation smoke keeps editor non-blank", !searchNavigation.blankEditor, JSON.stringify(searchNavigation))
          add("search navigation smoke reveals exact match selection", Boolean(searchNavigation.selectionChanged), JSON.stringify(searchNavigation))
          add("search navigation smoke keeps search view active", Boolean(searchNavigation.searchViewActive), JSON.stringify(searchNavigation))
          add("search navigation smoke clicks 20 real results", Number(searchNavigation.clickedCount || 0) >= 20, JSON.stringify(searchNavigation))
          add("search navigation smoke keeps every clicked editor non-blank", Boolean(searchNavigation.allClicksNonBlank), JSON.stringify(searchNavigation))
          add("search navigation smoke reveals every clicked match selection", Boolean(searchNavigation.allSelectionsAccurate), JSON.stringify(searchNavigation))
          add("search navigation smoke covers same-file and cross-file navigation", Boolean(searchNavigation.sameFileMultiLineClicked && Number(searchNavigation.distinctPathsClicked || 0) >= 2), JSON.stringify(searchNavigation))
          add("search navigation smoke keeps search view active for every click", Boolean(searchNavigation.allClicksKeptSearchView), JSON.stringify(searchNavigation))
          add("search navigation smoke covers json query non-blank editor", Boolean(searchNavigation.jsonSearchOpenedContentVisible && !searchNavigation.jsonSearchBlankEditor), JSON.stringify(searchNavigation))
          add("search navigation smoke covers json query exact selection", Boolean(searchNavigation.jsonSearchSelectionAccurate), JSON.stringify(searchNavigation))
          add("search navigation smoke writes latest JSON and Markdown evidence", Boolean(searchNavigation.evidenceJsonExists && searchNavigation.evidenceMarkdownExists), JSON.stringify(searchNavigation.evidence || {}))
        }
        if (${JSON.stringify(isArtifactOpenSmoke)}) {
          const artifactOpen = window.__codekSmokeArtifactOpenResult || {}
          add("artifact open smoke blocks binary artifacts", Boolean(artifactOpen.binaryArtifactsBlocked), JSON.stringify(artifactOpen))
          add("artifact open smoke keeps binary artifacts out of tabs", Boolean(artifactOpen.binaryArtifactsNotOpened), JSON.stringify(artifactOpen))
          add("artifact open smoke stays responsive after artifact clicks", Boolean(artifactOpen.responsiveAfterArtifactClicks), JSON.stringify(artifactOpen))
          add("artifact open smoke opens text files after artifact clicks", Boolean(artifactOpen.textFilesOpened), JSON.stringify(artifactOpen))
          add("artifact open smoke keeps final editor non-blank", Boolean(artifactOpen.finalEditorNonBlank), JSON.stringify(artifactOpen))
          add("artifact open smoke keeps editor DOM visible", Boolean(artifactOpen.editorDomVisible), JSON.stringify(artifactOpen))
          add("artifact open smoke keeps open operations within budget", Boolean(artifactOpen.allOpenDurationsWithinBudget), JSON.stringify(artifactOpen))
          add("artifact open smoke writes latest JSON and Markdown evidence", Boolean(artifactOpen.evidenceJsonExists && artifactOpen.evidenceMarkdownExists), JSON.stringify(artifactOpen.evidence || {}))
        }
        if (${JSON.stringify(isTabOverflowSmoke)}) {
          const tabOverflow = window.__codekSmokeTabOverflowResult || {}
          add("tab overflow smoke opens many tabs", Number(tabOverflow.tabCount || 0) >= 20, JSON.stringify(tabOverflow))
          add("tab overflow smoke keeps tab names visible", Boolean(tabOverflow.allTabsReadable), JSON.stringify(tabOverflow))
          add("tab overflow smoke editor title visible", Boolean(tabOverflow.editorTitleVisible), JSON.stringify(tabOverflow))
          add("tab overflow smoke has file icons", Boolean(tabOverflow.hasFileIcons), JSON.stringify(tabOverflow))
        }
        if (${JSON.stringify(isIconVisualStateSmoke)}) {
          const iconVisual = window.__codekSmokeIconVisualStateResult || {}
          const usableFallbackIcons = Boolean(iconVisual.commonExtensionsTyped && iconVisual.explorerIconsMounted && iconVisual.tabAndEditorIconsMounted)
          add("icon visual smoke explorer icons mounted", Boolean(iconVisual.explorerIconsMounted), JSON.stringify(iconVisual))
          add("icon visual smoke uses VS Code theme or stable fallback icons", Boolean(iconVisual.themeIconsMounted || usableFallbackIcons), JSON.stringify(iconVisual))
          add("icon visual smoke explorer uses VS Code theme or stable fallback icons", Boolean(iconVisual.explorerThemeIconsMounted || usableFallbackIcons), JSON.stringify(iconVisual))
          add("icon visual smoke tabs use VS Code theme or stable fallback icons", Boolean(iconVisual.tabThemeIconsMounted || usableFallbackIcons), JSON.stringify(iconVisual))
          add("icon visual smoke editor title uses VS Code theme or stable fallback icon", Boolean(iconVisual.editorThemeIconsMounted || usableFallbackIcons), JSON.stringify(iconVisual))
          add("icon visual smoke folder open and closed states differ", Boolean(iconVisual.folderStatesDiffer), JSON.stringify(iconVisual))
          add("icon visual smoke folder icons do not reserve custom slots", Boolean(iconVisual.folderIconsHidden), JSON.stringify(iconVisual.folderLayout || iconVisual))
          add("icon visual smoke file icons remain visible", Boolean(iconVisual.fileIconsVisible), JSON.stringify(iconVisual.folderLayout || iconVisual))
          add("icon visual smoke folder label is adjacent to twistie", Boolean(iconVisual.folderLabelAdjacentToTwistie), JSON.stringify(iconVisual.folderLayout || iconVisual))
          add("icon visual smoke nested folder indent matches VS Code tree", Boolean(iconVisual.nestedFolderIndentMatchesVsCode), JSON.stringify(iconVisual.folderLayout || iconVisual))
          add("icon visual smoke common extensions have typed tokens", Boolean(iconVisual.commonExtensionsTyped), JSON.stringify(iconVisual))
          add("icon visual smoke tab and editor icons mounted", Boolean(iconVisual.tabAndEditorIconsMounted), JSON.stringify(iconVisual))
        }
        if (${JSON.stringify(isRealProjectUiSmoke)}) {
          const realUi = window.__codekSmokeRealProjectUiResult || {}
          const createTargetSkipped = realUi.createTargetSkipped === true
          const visibleRowsStable = Number(realUi.domRows || 0) > 0 && Number(realUi.domRows || 0) <= 160 && !realUi.blankVisibleRows
          const expectedRoot = ${JSON.stringify(path.resolve(process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_ROOT || path.resolve(__dirname, "..")).replace(/\\/g, "/"))}
          add("real project UI smoke opens expected root", String(realUi.projectRoot || "").replace(/\\\\/g, "/") === expectedRoot, JSON.stringify(realUi))
          add("real project UI smoke native explorer mounted", Boolean(realUi.nativeHostMounted), JSON.stringify(realUi))
          add("real project UI smoke keeps explorer rows virtualized and non-blank", visibleRowsStable, JSON.stringify({ domRows: realUi.domRows, totalRows: realUi.totalRows, blankVisibleRows: realUi.blankVisibleRows }))
          add("real project UI smoke visible rows stay stable after fast scroll", Boolean(realUi.visibleRowsStableAfterFastScroll), JSON.stringify({
            visibleRowsStableAfterFastScroll: realUi.visibleRowsStableAfterFastScroll,
            before: realUi.visibleRowSnapshotBeforeFastScroll,
            after: realUi.visibleRowSnapshotAfterFastScroll,
          }))
          add("real project UI smoke scroll p95 within Cursor-grade budget", Number(realUi.p95ScrollMs || 0) <= 48, JSON.stringify({ p95ScrollMs: realUi.p95ScrollMs, maxScrollMs: realUi.maxScrollMs, longTasks: realUi.longTasks }))
          add("real project UI smoke scroll max avoids half-second stalls", Number(realUi.maxScrollMs || 0) <= 160, JSON.stringify({ p95ScrollMs: realUi.p95ScrollMs, maxScrollMs: realUi.maxScrollMs, longTasks: realUi.longTasks }))
          add("real project UI smoke opens normal editor content", Boolean(realUi.normalEditorContentVisible), JSON.stringify(realUi))
          add("real project UI smoke explorer click renders root package editor DOM", Boolean(realUi.rootPackageEditorValueVisible && realUi.rootPackageDomTextVisible && realUi.rootPackageLineNumbersVisible), JSON.stringify({
            rootPackageFile: realUi.rootPackageFile,
            rootPackageActiveFile: realUi.rootPackageActiveFile,
            rootPackageEditorValueVisible: realUi.rootPackageEditorValueVisible,
            rootPackageDomTextVisible: realUi.rootPackageDomTextVisible,
            rootPackageLineNumbersVisible: realUi.rootPackageLineNumbersVisible,
            rootPackageVisibleProbe: realUi.rootPackageVisibleProbe,
          }))
          add("real project UI smoke large file real content visible", Boolean(realUi.largeFileRealContentVisible && realUi.largeFileEditorVisible && realUi.largeFileContentVisible && realUi.largeFileDeepViewportTextVisible && realUi.largeFileNextWindowViewportTextVisible && realUi.largeFileSafeLineLength && realUi.largeFileContinuousWindowVisible), JSON.stringify({
            largeFile: realUi.largeFile,
            largeFileRealContentVisible: realUi.largeFileRealContentVisible,
            largeFileEditorVisible: realUi.largeFileEditorVisible,
            largeFileContentVisible: realUi.largeFileContentVisible,
            largeFileViewportTextVisible: realUi.largeFileViewportTextVisible,
            largeFileDeepViewportTextVisible: realUi.largeFileDeepViewportTextVisible,
            largeFileDeepViewportLine: realUi.largeFileDeepViewportLine,
            largeFileDeepViewportFirstVisibleLineNumber: realUi.largeFileDeepViewportFirstVisibleLineNumber,
            largeFileDeepViewportLastVisibleLineNumber: realUi.largeFileDeepViewportLastVisibleLineNumber,
            largeFileNextWindowViewportTextVisible: realUi.largeFileNextWindowViewportTextVisible,
            largeFileSafeLineLength: realUi.largeFileSafeLineLength,
            largeFileContinuousWindowVisible: realUi.largeFileContinuousWindowVisible,
            largeFileEditorLineCount: realUi.largeFileEditorLineCount,
            largeFileEditorValueLength: realUi.largeFileEditorValueLength,
            largeFileActiveFileContentLength: realUi.largeFileActiveFileContentLength,
            largeFileOptimizedStateVisible: realUi.largeFileOptimizedStateVisible,
            largeFileRangeStateVisible: realUi.largeFileRangeStateVisible,
            largeFileFirstVisibleLineNumber: realUi.largeFileFirstVisibleLineNumber,
            largeFileLastVisibleLineNumber: realUi.largeFileLastVisibleLineNumber,
            largeFileMaxVisibleLineLength: realUi.largeFileMaxVisibleLineLength,
          }))
          add("real project UI smoke large file user scroll never blanks viewport", Boolean(realUi.largeFileUserPageDownViewportTextVisible && realUi.largeFileUserScrollBottomLoaded && realUi.largeFileUserScrollBottomOffsetAdvanced && realUi.largeFileUserScrollBottomViewportTextVisible && realUi.largeFileUserScrollbarDragDispatched && realUi.largeFileUserScrollbarDragScrollAdvanced && (realUi.largeFileUserScrollbarDragDirectLoadRequired === false || realUi.largeFileUserScrollbarDragDirectLoaded) && realUi.largeFileUserScrollbarDragOffsetAdvanced && realUi.largeFileUserScrollbarDragViewportTextVisible && realUi.largeFileUserEndViewportTextVisible), JSON.stringify({
            largeFile: realUi.largeFile,
            largeFileUserPageDownViewportTextVisible: realUi.largeFileUserPageDownViewportTextVisible,
            largeFileUserScrollBottomLoaded: realUi.largeFileUserScrollBottomLoaded,
            largeFileUserScrollBottomOffsetAdvanced: realUi.largeFileUserScrollBottomOffsetAdvanced,
            largeFileUserScrollBottomViewportTextVisible: realUi.largeFileUserScrollBottomViewportTextVisible,
            largeFileUserScrollbarDragDispatched: realUi.largeFileUserScrollbarDragDispatched,
            largeFileUserScrollbarDragScrollBefore: realUi.largeFileUserScrollbarDragScrollBefore,
            largeFileUserScrollbarDragScrollAfter: realUi.largeFileUserScrollbarDragScrollAfter,
            largeFileUserScrollbarDragScrollAdvanced: realUi.largeFileUserScrollbarDragScrollAdvanced,
            largeFileUserScrollbarDragDirectLoadRequired: realUi.largeFileUserScrollbarDragDirectLoadRequired,
            largeFileUserScrollbarDragDirectLoaded: realUi.largeFileUserScrollbarDragDirectLoaded,
            largeFileUserScrollbarDragLoaded: realUi.largeFileUserScrollbarDragLoaded,
            largeFileUserScrollbarDragOffsetAdvanced: realUi.largeFileUserScrollbarDragOffsetAdvanced,
            largeFileUserScrollbarDragViewportTextVisible: realUi.largeFileUserScrollbarDragViewportTextVisible,
            largeFileUserEndViewportTextVisible: realUi.largeFileUserEndViewportTextVisible,
            largeFileUserScrollBeforeOffset: realUi.largeFileUserScrollBeforeOffset,
            largeFileUserScrollTargetOffset: realUi.largeFileUserScrollTargetOffset,
            largeFileUserScrollBottomOffset: realUi.largeFileUserScrollBottomOffset,
            largeFileUserScrollbarDragTargetOffset: realUi.largeFileUserScrollbarDragTargetOffset,
            largeFileUserScrollbarDragOffset: realUi.largeFileUserScrollbarDragOffset,
            largeFileUserScrollEndOffset: realUi.largeFileUserScrollEndOffset,
          }))
          add("real project UI smoke large file keeps a continuous optimized model", Boolean(realUi.largeFileContinuousWindowVisible), JSON.stringify({
            largeFile: realUi.largeFile,
            largeFileContinuousWindowVisible: realUi.largeFileContinuousWindowVisible,
            largeFileEditorLineCount: realUi.largeFileEditorLineCount,
            largeFileEditorValueLength: realUi.largeFileEditorValueLength,
            largeFileActiveFileContentLength: realUi.largeFileActiveFileContentLength,
            largeFileOptimizedStateVisible: realUi.largeFileOptimizedStateVisible,
            largeFileRangeStateVisible: realUi.largeFileRangeStateVisible,
            largeFileFirstVisibleLineNumber: realUi.largeFileFirstVisibleLineNumber,
            largeFileLastVisibleLineNumber: realUi.largeFileLastVisibleLineNumber,
          }))
          add("real project UI smoke keeps one-line large-file preview under Monaco-safe length", Boolean(realUi.largeFileSafeLineLength), JSON.stringify({
            largeFile: realUi.largeFile,
            largeFileSafeLineLength: realUi.largeFileSafeLineLength,
            largeFileMaxVisibleLineLength: realUi.largeFileMaxVisibleLineLength,
          }))
          add("real project UI smoke large file close and reopen shows real content", Boolean(realUi.largeFileReopenRealContentVisible && realUi.largeFileCloseReopenKeepsWorkbenchResponsive), JSON.stringify({
            largeFile: realUi.largeFile,
            largeFileReopenRealContentVisible: realUi.largeFileReopenRealContentVisible,
            largeFileCloseReopenKeepsWorkbenchResponsive: realUi.largeFileCloseReopenKeepsWorkbenchResponsive,
          }))
          add("real project UI smoke large file avoids blocking notice", Boolean(realUi.largeFileLowNoiseStatusVisible && realUi.largeFileWarningBadgeHidden && realUi.largeFileOrdinaryStatusHidden !== false), JSON.stringify({
            largeFileLowNoiseStatusVisible: realUi.largeFileLowNoiseStatusVisible,
            largeFileWarningBadgeHidden: realUi.largeFileWarningBadgeHidden,
            largeFileOrdinaryStatusHidden: realUi.largeFileOrdinaryStatusHidden,
          }))
          add("real project UI smoke extreme file auto-loads adjacent real window", Boolean(realUi.extremeFileAutoWindowNavigation && realUi.extremeFileFirstWindowVisible && realUi.extremeFileSecondWindowVisible), JSON.stringify({
            extremeFile: realUi.extremeFile,
            extremeFileAutoWindowNavigation: realUi.extremeFileAutoWindowNavigation,
            extremeFileFirstWindowVisible: realUi.extremeFileFirstWindowVisible,
            extremeFileSecondWindowVisible: realUi.extremeFileSecondWindowVisible,
          }))
          add("real project UI smoke does not show idle fake lightbulb", Boolean(realUi.idleLightbulbHidden), JSON.stringify({ idleLightbulbHidden: realUi.idleLightbulbHidden, idleLightbulbCount: realUi.idleLightbulbCount }))
          add("real project UI smoke search result opens non-blank editor", Boolean(realUi.searchOpenedContentVisible) && !realUi.searchBlankEditor && realUi.searchExpectedPathMatched !== false, JSON.stringify(realUi))
          add("real project UI smoke same-line duplicate search rows are collapsed", Boolean(realUi.sameLineDuplicateCollapsed), JSON.stringify({ sameLineSearchPath: realUi.sameLineSearchPath, sameLineMatchRows: realUi.sameLineMatchRows, sameLineOccurrences: realUi.sameLineOccurrences }))
          add("real project UI smoke same-line search occurrence metadata is accurate", Boolean(realUi.sameLineOccurrencesAccurate), JSON.stringify({ sameLineNeedle: realUi.sameLineNeedle, sameLineSearchPath: realUi.sameLineSearchPath, sameLineMatchRows: realUi.sameLineMatchRows, sameLineOccurrences: realUi.sameLineOccurrences }))
          add("real project UI smoke search keeps view active", Boolean(realUi.searchViewActive), JSON.stringify(realUi))
          add("real project UI smoke quick input accepts and cancels through real dialog", Boolean(realUi.quickInputWorkbenchVisible && realUi.quickInputWorkbenchPickAccepted && realUi.quickInputWorkbenchInputCancelled), JSON.stringify(realUi.quickInputWorkbench || {}))
          add("real project UI smoke quick input uses service boundary", Boolean(realUi.quickInputWorkbenchServiceId === "quickInputService" && realUi.quickInputWorkbenchStateSource === "quickInputService" && realUi.quickInputWorkbenchQuickPickKind === "quickPick" && realUi.quickInputWorkbenchInputKind === "inputBox"), JSON.stringify({
            serviceId: realUi.quickInputWorkbenchServiceId,
            stateSource: realUi.quickInputWorkbenchStateSource,
            quickPickKind: realUi.quickInputWorkbenchQuickPickKind,
            inputKind: realUi.quickInputWorkbenchInputKind,
            acceptedValue: realUi.quickInputWorkbenchAcceptedValue,
          }))
          add("real project UI smoke MCP workbench surface visible", Boolean(realUi.mcpWorkbenchSurfaceVisible && realUi.mcpWorkbenchServersVisible && realUi.mcpWorkbenchResourcesVisible && realUi.mcpWorkbenchGalleryVisible), JSON.stringify(realUi.mcpWorkbench || {}))
          add("real project UI smoke MCP workbench uses service/view contribution boundary", Boolean(Array.isArray(realUi.mcpWorkbenchViewIds) && realUi.mcpWorkbenchServiceId === "mcpWorkbenchService" && realUi.mcpWorkbenchStateSource === "service" && realUi.mcpWorkbenchViewIds.includes("workbench.mcp.servers") && realUi.mcpWorkbenchViewIds.includes("workbench.mcp.resources") && realUi.mcpWorkbenchViewIds.includes("workbench.mcp.gallery") && realUi.mcpWorkbenchReadonlyProviderPath === true && Array.isArray(realUi.mcpWorkbenchQuickAccessPrefixes) && realUi.mcpWorkbenchQuickAccessPrefixes.includes("mcp:") && realUi.mcpWorkbenchQuickAccessPrefixes.includes("mcpr ")), JSON.stringify({
            serviceId: realUi.mcpWorkbenchServiceId,
            stateSource: realUi.mcpWorkbenchStateSource,
            viewIds: realUi.mcpWorkbenchViewIds,
            commandIds: realUi.mcpWorkbenchCommandIds,
            quickAccessPrefixes: realUi.mcpWorkbenchQuickAccessPrefixes,
            readonlyProviderPath: realUi.mcpWorkbenchReadonlyProviderPath,
            openedCount: realUi.mcpWorkbenchOpenedCount,
            attachmentCount: realUi.mcpWorkbenchAttachmentCount,
          }))
          add("real project UI smoke MCP gallery detail exposes workbench action evidence", Boolean(realUi.mcpGalleryWorkbenchDetailVisible && realUi.mcpGalleryWorkbenchDetailSeeded && typeof realUi.mcpGalleryWorkbenchServer === "string" && realUi.mcpGalleryWorkbenchServer.length > 0 && Array.isArray(realUi.mcpGalleryWorkbenchActionIds) && realUi.mcpGalleryWorkbenchActionIds.includes("install") && Number(realUi.mcpGalleryWorkbenchMetadataCount || 0) > 0 && realUi.mcpGalleryWorkbenchHasReadme === true && realUi.mcpGalleryWorkbenchHasManifest === true && realUi.mcpWorkbenchPreservesAgentApproval === true && realUi.mcpWorkbenchNoSecondState === true), JSON.stringify({
            server: realUi.mcpGalleryWorkbenchServer,
            installState: realUi.mcpGalleryWorkbenchInstallState,
            statusLabel: realUi.mcpGalleryWorkbenchStatusLabel,
            actionIds: realUi.mcpGalleryWorkbenchActionIds,
            enabledActionIds: realUi.mcpGalleryWorkbenchEnabledActionIds,
            metadataCount: realUi.mcpGalleryWorkbenchMetadataCount,
            hasReadme: realUi.mcpGalleryWorkbenchHasReadme,
            hasManifest: realUi.mcpGalleryWorkbenchHasManifest,
            seeded: realUi.mcpGalleryWorkbenchDetailSeeded,
            preservesAgentApproval: realUi.mcpWorkbenchPreservesAgentApproval,
            noSecondState: realUi.mcpWorkbenchNoSecondState,
          }))
          add("real project UI smoke extension gallery surface visible", Boolean(realUi.extensionGalleryWorkbenchSurfaceVisible && realUi.extensionGalleryWorkbenchShellVisible && realUi.extensionGalleryWorkbenchSearchVisible && realUi.extensionGalleryWorkbenchInstalledVisible && realUi.extensionGalleryWorkbenchResultsVisible), JSON.stringify(realUi.extensionGalleryWorkbench || {}))
          add("real project UI smoke extension gallery uses workbench service boundary", Boolean(realUi.extensionGalleryWorkbenchContainerId === "workbench.view.extensions" && realUi.extensionGalleryWorkbenchViewId === "workbench.extensions.marketplace" && realUi.extensionGalleryWorkbenchServiceId === "extensionsWorkbenchService" && realUi.extensionGalleryWorkbenchStateSource === "service" && realUi.extensionGalleryWorkbenchQuickAccessPrefix === "ext " && realUi.extensionGalleryWorkbenchLocalFirst && realUi.extensionGalleryWorkbenchNoSecondState), JSON.stringify({
            containerId: realUi.extensionGalleryWorkbenchContainerId,
            viewId: realUi.extensionGalleryWorkbenchViewId,
            serviceId: realUi.extensionGalleryWorkbenchServiceId,
            stateSource: realUi.extensionGalleryWorkbenchStateSource,
            quickAccessPrefix: realUi.extensionGalleryWorkbenchQuickAccessPrefix,
            commandIds: realUi.extensionGalleryWorkbenchCommandIds,
          }))
          add("real project UI smoke extension gallery detail opens editor/action evidence", Boolean(realUi.extensionGalleryWorkbenchDetailVisible && realUi.extensionGalleryWorkbenchDetailOpened && realUi.extensionGalleryWorkbenchDetailServiceId === "extensionsWorkbenchService" && realUi.extensionGalleryWorkbenchDetailStateSource === "service" && typeof realUi.extensionGalleryWorkbenchDetailExtensionId === "string" && realUi.extensionGalleryWorkbenchDetailExtensionId.length > 0 && Array.isArray(realUi.extensionGalleryWorkbenchDetailActionIds) && realUi.extensionGalleryWorkbenchDetailActionIds.length > 0), JSON.stringify({
            attempted: realUi.extensionGalleryWorkbenchDetailAttempted,
            opened: realUi.extensionGalleryWorkbenchDetailOpened,
            openExtensionId: realUi.extensionGalleryWorkbenchDetailOpenExtensionId,
            openError: realUi.extensionGalleryWorkbenchDetailOpenError,
            detailExtensionId: realUi.extensionGalleryWorkbenchDetailExtensionId,
            installState: realUi.extensionGalleryWorkbenchDetailInstallState,
            actionIds: realUi.extensionGalleryWorkbenchDetailActionIds,
            rollbackAvailable: realUi.extensionGalleryWorkbenchDetailRollbackAvailable,
            serviceId: realUi.extensionGalleryWorkbenchDetailServiceId,
            stateSource: realUi.extensionGalleryWorkbenchDetailStateSource,
          }))
          add("real project UI smoke chat input remains usable", Boolean(realUi.chatInputVisible) && Boolean(realUi.chatInputAcceptsText), JSON.stringify(realUi))
          add("real project UI smoke create target display matches disk", createTargetSkipped || (Boolean(realUi.createdFileRowVisible) && Boolean(realUi.createdFolderRowVisible) && Boolean(realUi.createdFileExistsOnDisk) && Boolean(realUi.createdFolderExistsOnDisk) && !realUi.wrongRootFileExistsOnDisk && !realUi.wrongRootFolderExistsOnDisk), JSON.stringify({ skipped: createTargetSkipped, ...realUi }))
          add("real project UI smoke continuous create remains usable", createTargetSkipped || (Boolean(realUi.continuousCreatePassed) && Number(realUi.continuousCreateCount || 0) >= 10 && Boolean(realUi.continuousCreateRowsVisible) && Boolean(realUi.continuousCreateAllExistOnDisk)), JSON.stringify({ skipped: createTargetSkipped, continuousCreateCount: realUi.continuousCreateCount, continuousCreateRowsVisible: realUi.continuousCreateRowsVisible, continuousCreateExistsOnDiskCount: realUi.continuousCreateExistsOnDiskCount, continuousCreateAllExistOnDisk: realUi.continuousCreateAllExistOnDisk }))
          add("real project UI smoke rejects stale create snapshot", createTargetSkipped || (Boolean(realUi.staleCreateSnapshotRejected) && !realUi.staleRequestedFileExistsOnDisk && !realUi.staleSnapshotFileExistsOnDisk), JSON.stringify({ skipped: createTargetSkipped, staleCreateSnapshotRejected: realUi.staleCreateSnapshotRejected, staleSnapshotRejected: realUi.staleSnapshotRejected, staleRequestedRowVisible: realUi.staleRequestedRowVisible, staleSnapshotRowVisible: realUi.staleSnapshotRowVisible, staleRequestedFileExistsOnDisk: realUi.staleRequestedFileExistsOnDisk, staleSnapshotFileExistsOnDisk: realUi.staleSnapshotFileExistsOnDisk, staleSnapshotError: realUi.staleSnapshotError }))
          add("real project UI smoke writes JSON evidence report", Boolean(realUi.evidenceJsonExists), JSON.stringify(realUi.evidence || {}))
          add("real project UI smoke writes Markdown evidence report", Boolean(realUi.evidenceMarkdownExists), JSON.stringify(realUi.evidence || {}))
          add("real project UI smoke writes screenshot evidence", Boolean(realUi.evidenceScreenshotExists), JSON.stringify(realUi.evidence || {}))
        }
        if (${JSON.stringify(isMultiRootCreateTargetSmoke)}) {
          const multiRoot = window.__codekSmokeMultiRootCreateTargetResult || {}
          const roots = Array.isArray(multiRoot.workspaceRoots) ? multiRoot.workspaceRoots : []
          add("multi-root create smoke restores workspace roots", roots.length >= 2, JSON.stringify(multiRoot))
          add("multi-root create smoke selected directory controls target", String(multiRoot.selectedParent || "").startsWith("/") && String(multiRoot.selectedParent || "").includes("client (apps)/src"), JSON.stringify(multiRoot))
          add("multi-root create smoke active editor can be in another root", String(multiRoot.activeFileBeforeCreate || "").includes("client (libs)/src/lib.ts"), JSON.stringify(multiRoot))
          add("multi-root create smoke creates file in selected root on disk", Boolean(multiRoot.appsFileExistsOnDisk), JSON.stringify(multiRoot))
          add("multi-root create smoke creates folder in selected root on disk", Boolean(multiRoot.appsFolderExistsOnDisk), JSON.stringify(multiRoot))
          add("multi-root create smoke does not create file in wrong root", !multiRoot.libsWrongFileExistsOnDisk, JSON.stringify(multiRoot))
          add("multi-root create smoke does not create folder in wrong root", !multiRoot.libsWrongFolderExistsOnDisk, JSON.stringify(multiRoot))
          add("multi-root create smoke explorer row visible", Boolean(multiRoot.appsFileRowVisible), JSON.stringify(multiRoot))
        }
        if (hasAppShell) {
          add("custom titlebar mounted", Boolean(document.querySelector(".titlebar") || document.querySelector(".menu-bar") || text.includes("ChatAI")))
          add("activity bar mounted", Boolean(document.querySelector(".activity-bar")))
          add("welcome page or editor mounted", Boolean(document.querySelector(".welcome-page") || document.querySelector(".editor-container") || document.querySelector('[data-codek-smoke="large-file-range-window"]')))
        }
        add("preload bridge exposed", Boolean(window.codek && typeof window.codek.api === "function" && typeof window.codek.openEvalReport === "function"))
        if (window.codek && typeof window.codek.api === "function") {
          try {
            const latest = await window.codek.api("GET", "/api/orchestrator/evals/latest")
            add("orchestrator eval API reachable", latest !== undefined)
            const acceptance = await window.codek.api("GET", "/api/orchestrator/acceptance/latest")
            const acceptanceData = acceptance && acceptance.data ? acceptance.data : acceptance
            add("orchestrator acceptance API reachable", Boolean(acceptanceData && acceptanceData.report && acceptanceData.report.matrix && acceptanceData.report.matrix.total >= 5))
            add("orchestrator acceptance task sets API reachable", Boolean(acceptanceData && Array.isArray(acceptanceData.taskSets) && acceptanceData.taskSets.length >= 3))
            add("orchestrator acceptance history API reachable", Boolean(acceptanceData && Array.isArray(acceptanceData.history) && acceptanceData.history.length >= 1))
            const releaseGate = await window.codek.api("GET", "/api/orchestrator/release-gate/latest")
            const releaseGateData = releaseGate && releaseGate.data ? releaseGate.data : releaseGate
            add("orchestrator release gate API reachable", Boolean(releaseGateData && releaseGateData.report && releaseGateData.report.ready === true))
            const readiness = await window.codek.api("POST", "/api/orchestrator/readiness/check", { projectRoot: "D:/Workspace", settings: { "codek.agent.realWorkspaceTrial.allowedPaths": ["src"], "codek.agent.realWorkspaceTrial.qualityGateCommands": ["npm run typecheck"] } })
            const readinessData = readiness && readiness.data ? readiness.data : readiness
            add("orchestrator readiness API reachable", Boolean(readinessData && readinessData.report && readinessData.report.reportKind === "orchestrator-readiness"))
            const evidence = await window.codek.api("POST", "/api/orchestrator/release-evidence/export", {})
            const evidenceData = evidence && evidence.data ? evidence.data : evidence
            add("orchestrator release evidence export API reachable", Boolean(evidenceData && evidenceData.report && evidenceData.report.reportKind === "release-evidence" && evidenceData.markdownPath))
          } catch (error) {
            add("orchestrator eval API reachable", false, String(error && error.message || error))
            add("orchestrator acceptance API reachable", false, String(error && error.message || error))
            add("orchestrator acceptance history API reachable", false, String(error && error.message || error))
            add("orchestrator release gate API reachable", false, String(error && error.message || error))
            add("orchestrator readiness API reachable", false, String(error && error.message || error))
            add("orchestrator release evidence export API reachable", false, String(error && error.message || error))
          }
        }
        return checks
      })()
    `)
    const failed = Array.isArray(result) ? result.filter((item) => !item.passed) : [{ name: "smoke result", passed: false, detail: "invalid result" }]
    const backgroundChecks = runBackgroundSmokeChecks()
    const allChecks = [...(Array.isArray(result) ? result : []), ...backgroundChecks]
    const allFailed = allChecks.filter((item) => !item.passed)
    const payload = { ok: allFailed.length === 0, checks: allChecks }
    writeElectronSmokeStage("run-smoke:write-result", {
      checkCount: allChecks.length,
      failedCount: allFailed.length,
    })
    writeElectronSmokeResult(payload)
    console.log("[electron-smoke] " + JSON.stringify(payload, null, 2))
    clearTimeout(timeout)
    app.exit(allFailed.length === 0 ? 0 : 1)
  } catch (err) {
    clearTimeout(timeout)
    const stage = await collectElectronSmokeRendererStage(win)
    writeElectronSmokeResult({ ok: false, checks: [], error: String(err?.stack || err?.message || err), stage })
    console.error("[electron-smoke] failed", err)
    app.exit(1)
  }
}

async function runElectronStartupSmokeChecks(win) {
  if (!win || win.isDestroyed()) return
  const timeout = setTimeout(() => {
    console.error("[electron-startup-smoke] timeout")
    writeElectronSmokeResult({ ok: false, checks: [], error: "timeout" })
    app.exit(1)
  }, Number(process.env.CODEK_ELECTRON_SMOKE_TIMEOUT_MS || 15000))

  try {
    const checks = await win.webContents.executeJavaScript(`
      (async () => {
        const checks = []
        const add = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail })
        await new Promise((resolve) => {
          const started = Date.now()
          const tick = () => {
            const hasAuthGate = document.querySelector(".desktop-login") || document.querySelector(".app-window") || document.querySelector(".auth-overlay") || document.querySelector(".auth-card")
            const hasAppShell = document.querySelector(".app-shell")
            const hasRoot = document.querySelector("#app")
            if (hasAuthGate || hasAppShell || hasRoot || Date.now() - started > 10000) {
              resolve(true)
            } else {
              setTimeout(tick, 100)
            }
          }
          tick()
        })
        const text = document.body ? document.body.innerText : ""
        const html = document.body ? document.body.innerHTML : ""
        add("document url", Boolean(location.href), location.href)
        add("renderer did not load chrome error page", !location.href.startsWith("chrome-error://"), location.href)
        add("startup uses built frontend files by default", location.protocol === "file:", location.href)
        add("root app node exists", Boolean(document.querySelector("#app")))
        const hasLoginView = Boolean(
          document.querySelector(".desktop-login")
          || document.querySelector(".app-window")
          || document.querySelector(".auth-overlay")
          || document.querySelector(".auth-card")
        )
        const hasAppShell = Boolean(document.querySelector(".app-shell"))
        const rectOf = (selector) => {
          const el = document.querySelector(selector)
          if (!el) return null
          const rect = el.getBoundingClientRect()
          const style = getComputedStyle(el)
          return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            appRegion: style.webkitAppRegion || style.getPropertyValue("-webkit-app-region") || "",
            overflowX: style.overflowX,
            overflowY: style.overflowY,
          }
        }
        const overlaps = (a, b, gap = 1) => Boolean(
          a && b
          && a.left < b.right - gap
          && a.right > b.left + gap
          && a.top < b.bottom - gap
          && a.bottom > b.top + gap
        )
        const viewport = { width: window.innerWidth, height: window.innerHeight }
        const sidebarRect = rectOf(".sidebar")
        const workspaceRect = rectOf(".workspace")
        const authRect = rectOf(".auth")
        const loginCardRect = rectOf(".login-card")
        const titlebarRect = rectOf(".titlebar")
        const overflowDetail = (() => {
          const loginCard = document.querySelector(".login-card")
          const appWindow = document.querySelector(".app-window")
          const body = document.body
          const titlebarEnd = document.querySelector(".titlebar-side--end")
          const titlebarEndRect = titlebarEnd?.getBoundingClientRect()
          return {
            bodyScrollWidth: body?.scrollWidth || 0,
            viewportWidth: viewport.width,
            appWindowScrollWidth: appWindow?.scrollWidth || 0,
            appWindowClientWidth: appWindow?.clientWidth || 0,
            loginCardScrollHeight: loginCard?.scrollHeight || 0,
            loginCardClientHeight: loginCard?.clientHeight || 0,
            loginCardOverflowY: loginCard ? getComputedStyle(loginCard).overflowY : "",
            titlebarReservedWidth: 138,
            titlebarEndRight: titlebarEndRect?.right || 0,
          }
        })()
        const layoutDetail = JSON.stringify({ viewport, sidebarRect, workspaceRect, authRect, loginCardRect, titlebarRect, overflowDetail })
        const loginPanelsDoNotOverlap = !overlaps(sidebarRect, workspaceRect)
          && !overlaps(workspaceRect, authRect)
          && !overlaps(sidebarRect, authRect)
        const loginCardInsideViewport = Boolean(loginCardRect)
          && loginCardRect.left >= -1
          && loginCardRect.right <= viewport.width + 1
          && loginCardRect.top >= -1
          && loginCardRect.bottom <= viewport.height + 1
        const titlebarDraggable = Boolean(titlebarRect && titlebarRect.appRegion === "drag")
        const noHorizontalOverflow = overflowDetail.bodyScrollWidth <= viewport.width + 2
          && overflowDetail.appWindowScrollWidth <= overflowDetail.appWindowClientWidth + 2
        const loginCardScrollControlled = overflowDetail.loginCardScrollHeight <= overflowDetail.loginCardClientHeight + 2
          || ["auto", "scroll", "overlay"].includes(String(overflowDetail.loginCardOverflowY || ""))
        const loginCardFitsWithoutInternalScroll = overflowDetail.loginCardScrollHeight <= overflowDetail.loginCardClientHeight + 4
        const titlebarCaptionInset = !titlebarRect
          || !overflowDetail.titlebarEndRight
          || overflowDetail.titlebarEndRight <= titlebarRect.right - overflowDetail.titlebarReservedWidth + 2
        const clickWorkspaceTab = async (label) => {
          const tab = Array.from(document.querySelectorAll(".surface-tab"))
            .find((item) => String(item.textContent || "").trim().includes(label))
          if (!tab) return { found: false, active: false, text: "" }
          tab.click()
          await new Promise((resolve) => setTimeout(resolve, 80))
          return {
            found: true,
            active: tab.classList.contains("active") || tab.getAttribute("aria-selected") === "true",
            text: document.querySelector(".surface-core")?.innerText || "",
          }
        }
        const servicesTab = await clickWorkspaceTab("服务")
        const modelTab = await clickWorkspaceTab("模型")
        const overviewTab = await clickWorkspaceTab("概览")
        const workspaceTabsInteractive = servicesTab.found
          && servicesTab.active
          && (servicesTab.text.includes("桌面 API") || servicesTab.text.includes("妗岄潰 API"))
          && modelTab.found
          && modelTab.active
          && (modelTab.text.includes("当前模型") || modelTab.text.includes("褰撳墠妯"))
          && overviewTab.found
          && overviewTab.active
          && (overviewTab.text.includes("启动状态") || overviewTab.text.includes("鍚姩鐘"))
        const workspacePreviewFilled = Boolean(workspaceRect && authRect)
          && workspaceRect.width >= Math.max(560, authRect.width * 1.45)
          && Boolean(document.querySelector(".overview-layout, .services-layout, .model-layout"))
        add("startup shows login screen before explicit login", hasLoginView, text.slice(0, 200) || html.slice(0, 200))
        add("new login page text is visible", text.includes("账号登录") && text.includes("使用 GitHub 登录"), text.slice(0, 300))
        add("startup does not enter workbench without auto login", !hasAppShell, text.slice(0, 200) || html.slice(0, 200))
        add("login screen does not expose removed Google login", !text.includes("Google 登录") && !text.includes("Google"), text.slice(0, 300))
        add("login panels do not overlap at startup viewport", loginPanelsDoNotOverlap, layoutDetail)
        add("login workspace tabs switch real content", workspaceTabsInteractive, JSON.stringify({ servicesTab, modelTab, overviewTab }))
        add("login workspace preview fills left content area", workspacePreviewFilled, layoutDetail)
        add("login card stays inside startup viewport", loginCardInsideViewport, layoutDetail)
        add("login page has no horizontal overflow", noHorizontalOverflow, layoutDetail)
        add("login card overflow is controlled", loginCardScrollControlled, layoutDetail)
        add("login card content fits startup viewport without internal scroll", loginCardFitsWithoutInternalScroll, layoutDetail)
        add("login titlebar exposes draggable region", titlebarDraggable, layoutDetail)
        add("login titlebar keeps controls out of window buttons", titlebarCaptionInset, layoutDetail)
        add("preload bridge exposed", Boolean(window.codek && typeof window.codek.api === "function"))
        return checks
      })()
    `)
    const allChecks = Array.isArray(checks) ? checks : [{ name: "startup smoke result", passed: false, detail: "invalid result" }]
    allChecks.push({
      name: "devtools not opened automatically",
      passed: !win.webContents.isDevToolsOpened(),
      detail: String(win.webContents.isDevToolsOpened()),
    })
    const failed = allChecks.filter((item) => !item.passed)
    const payload = { ok: failed.length === 0, checks: allChecks }
    writeElectronSmokeResult(payload)
    console.log("[electron-startup-smoke] " + JSON.stringify(payload, null, 2))
    clearTimeout(timeout)
    app.exit(failed.length === 0 ? 0 : 1)
  } catch (err) {
    clearTimeout(timeout)
    writeElectronSmokeResult({ ok: false, checks: [], error: String(err?.stack || err?.message || err) })
    console.error("[electron-startup-smoke] failed", err)
    app.exit(1)
  }
}

function setupMenu() {
  // On Windows/Linux the menu is fully replaced by the custom in-renderer MenuBar
  // (see frontend/.../components/MenuBar.vue) so we strip the native one. On macOS
  // we keep an application menu because the OS shows it in the global menu bar at
  // the top of the screen, not inside the window.
  if (!isMac) {
    Menu.setApplicationMenu(null)
    return
  }

  const template = [
    {
      label: "File",
      submenu: [
        { label: "Open Project", accelerator: "CmdOrCtrl+O", click: () => mainWindow?.webContents.send("menu:open-project") },
        { type: "separator" },
        { label: "Settings", accelerator: "CmdOrCtrl+,", click: () => mainWindow?.webContents.send("menu:settings") },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Codek Documentation",
          click: () => shell.openExternal("https://github.com/codek/codek"),
        },
        {
          label: "Check for Updates",
          click: () => mainWindow?.webContents.send("menu:check-updates"),
        },
      ],
    },
  ]

  if (isMac) {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    })
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function setupAutoUpdater() {
  try {
    const { autoUpdater } = require("electron-updater")

    autoUpdater.setFeedURL({
      provider: "github",
      owner: "codek",
      repo: "codek-releases",
    })

    autoUpdater.autoDownload = false

    autoUpdater.on("update-available", (info) => {
      log(`Update available: ${info.version}`)
      mainWindow?.webContents.send("update:available", { version: info.version })
    })

    autoUpdater.on("update-not-available", () => {
      mainWindow?.webContents.send("update:not-available")
    })

    autoUpdater.on("download-progress", (progress) => {
      mainWindow?.webContents.send("update:download-progress", {
        percent: Math.round(progress.percent),
      })
    })

    autoUpdater.on("update-downloaded", () => {
      mainWindow?.webContents.send("update:downloaded")
    })

    autoUpdater.on("error", (err) => {
      log(`Auto-updater error: ${err.message}`)
      mainWindow?.webContents.send("update:error", { message: err.message })
    })

    ipcMain.handle("update:check", async () => {
      try {
        return await autoUpdater.checkForUpdates()
      } catch (err) {
        return { error: err.message }
      }
    })

    ipcMain.handle("update:download", async () => {
      try {
        await autoUpdater.downloadUpdate()
        return { success: true }
      } catch (err) {
        return { error: err.message }
      }
    })

    ipcMain.handle("update:install", () => {
      autoUpdater.quitAndInstall()
    })

    setTimeout(() => autoUpdater.checkForUpdates(), 5000)
  } catch {
    log("electron-updater not available (dev mode)")
  }
}

function setupIPC() {
  try { ipcMain.removeHandler("api:request") } catch {}
  ipcMain.handle("api:request", async (event, request = {}) => {
    const apiStartedAt = Date.now()
    writeElectronSmokeStage("api-request:start", {
      method: request.method,
      path: request.path,
    })
    const startupTimeoutMs = Number.isFinite(Number(request.options?.startupTimeoutMs))
      ? Math.max(0, Number(request.options.startupTimeoutMs))
      : 10000
    const ready = await waitForServicesReady(startupTimeoutMs)
    writeElectronSmokeStage("api-request:services-ready", {
      method: request.method,
      path: request.path,
      ready,
      durationMs: Date.now() - apiStartedAt,
    })
    if (!ready) {
      return {
        ok: false,
        status: serviceStartupError ? 500 : 503,
        error: serviceStartupError
          ? String(serviceStartupError?.message || serviceStartupError)
          : "Codek services are still starting",
        errorCode: serviceStartupError ? "service_start_failed" : "services_starting",
      }
    }

    const router = require("./services/router")
    try {
      const result = await router.dispatch({
        method: request.method,
        path: request.path,
        body: request.body,
        headers: request.headers,
        sender: event.sender,
      })
      const response = request.path === "/search/files"
        ? JSON.parse(JSON.stringify(result))
        : result
      writeElectronSmokeStage("api-request:done", {
        method: request.method,
        path: request.path,
        durationMs: Date.now() - apiStartedAt,
        ok: result?.ok,
        success: result?.success,
        status: result?.status,
      })
      return response
    } catch (error) {
      writeElectronSmokeStage("api-request:error", {
        method: request.method,
        path: request.path,
        durationMs: Date.now() - apiStartedAt,
        error: String(error?.message || error),
      })
      throw error
    }
  })

  const runSearchFilesRequest = async (body = {}, options = {}) => {
    const workspaceState = {
      workspaceRoots: currentWorkspaceRoots,
      workspaceScaleProfile: currentWorkspaceScaleProfile,
    }
    const { searchInWorkspace, searchWorkspace } = require("./services/search")
    const hasMultiFolderQuery = Array.isArray(body.roots) || Array.isArray(body.folderQueries)
    const search = hasMultiFolderQuery ? searchWorkspace : searchInWorkspace
    const result = await search({
      root: body.root,
      roots: Array.isArray(body.roots) ? body.roots : undefined,
      folderQueries: Array.isArray(body.folderQueries) ? body.folderQueries : undefined,
      query: body.query || "",
      include: Array.isArray(body.include) ? body.include : null,
      exclude: Array.isArray(body.exclude) ? body.exclude : null,
      regex: !!body.regex,
      caseSensitive: !!body.caseSensitive,
      wholeWord: !!body.wholeWord,
      maxResults: typeof body.maxResults === "number" ? body.maxResults : undefined,
      maxVisitedFiles: typeof body.maxVisitedFiles === "number" ? body.maxVisitedFiles : undefined,
      searchLargeFiles: body.searchLargeFiles === true,
      searchMaxFileBytes: typeof body.searchMaxFileBytes === "number" ? body.searchMaxFileBytes : undefined,
      discoverFiles: body.discoverFiles === true,
      allowedRoots: Array.isArray(workspaceState.workspaceRoots) ? workspaceState.workspaceRoots : undefined,
      workspaceScaleProfile: workspaceState.workspaceScaleProfile || null,
      includeContentForSmallFiles: body.includeContentForSmallFiles === true,
      contentMaxFileBytes: typeof body.contentMaxFileBytes === "number" ? body.contentMaxFileBytes : undefined,
      contentMaxTotalBytes: typeof body.contentMaxTotalBytes === "number" ? body.contentMaxTotalBytes : undefined,
      signal: options.signal,
      onProgress: options.onProgress,
    })
    return JSON.parse(JSON.stringify({
      ok: true,
      status: 200,
      data: { success: true, ...result },
    }))
  }

  try { ipcMain.removeHandler("search:files") } catch {}
  ipcMain.handle("search:files", async (_event, body = {}) => {
    const startedAt = Date.now()
    writeElectronSmokeStage("search-files-ipc:start", {
      root: body.root,
      queryLength: String(body.query || "").length,
      maxResults: body.maxResults,
    })
    try {
      const response = await runSearchFilesRequest(body)
      const result = response.data || {}
      writeElectronSmokeStage("search-files-ipc:done", {
        durationMs: Date.now() - startedAt,
        matchCount: result.matches?.length || 0,
        skippedLargeFiles: result.skippedLargeFiles || 0,
      })
      return response
    } catch (error) {
      writeElectronSmokeStage("search-files-ipc:error", {
        durationMs: Date.now() - startedAt,
        error: String(error?.message || error),
      })
      return {
        ok: false,
        status: 500,
        data: {
          success: false,
          error: String(error?.message || error),
          matches: [],
          truncated: false,
        },
      }
    }
  })

  const pendingSearchFileRequests = new Map()
  ipcMain.removeAllListeners("search:files:request")
  ipcMain.on("search:files:request", async (event, request = {}) => {
    const requestId = String(request?.requestId || "")
    const body = request?.body || {}
    const controller = new AbortController()
    if (requestId) pendingSearchFileRequests.set(requestId, controller)
    const startedAt = Date.now()
    const sendProgress = (progress) => {
      if (!requestId || controller.signal.aborted) return
      event.sender.send("search:files:progress", {
        requestId,
        progress,
      })
    }
    writeElectronSmokeStage("search-files-event:start", {
      requestId,
      root: body.root,
      queryLength: String(body.query || "").length,
      maxResults: body.maxResults,
    })
    try {
      const response = await runSearchFilesRequest(body, {
        signal: controller.signal,
        onProgress: sendProgress,
      })
      const result = response.data || {}
      writeElectronSmokeStage("search-files-event:done", {
        requestId,
        durationMs: Date.now() - startedAt,
        matchCount: result.matches?.length || 0,
        skippedLargeFiles: result.skippedLargeFiles || 0,
      })
      if (!controller.signal.aborted) {
        event.sender.send("search:files:result", { requestId, result: response })
      }
    } catch (error) {
      const wasCancelled = controller.signal.aborted || error?.name === "AbortError"
      writeElectronSmokeStage("search-files-event:error", {
        requestId,
        durationMs: Date.now() - startedAt,
        error: String(error?.message || error),
        cancelled: wasCancelled,
      })
      if (wasCancelled) return
      event.sender.send("search:files:result", {
        requestId,
        result: {
          ok: false,
          status: 500,
          data: {
            success: false,
            error: String(error?.message || error),
            matches: [],
            truncated: false,
          },
        },
      })
    } finally {
      if (requestId) pendingSearchFileRequests.delete(requestId)
    }
  })
  ipcMain.removeAllListeners("search:files:cancel")
  ipcMain.on("search:files:cancel", (_event, request = {}) => {
    const requestId = String(request?.requestId || "")
    const controller = pendingSearchFileRequests.get(requestId)
    if (!controller) return
    writeElectronSmokeStage("search-files-event:cancel", { requestId })
    controller.abort()
  })

  const disposeMcpResourceSubscription = async (subscriptionId) => {
    const record = mcpResourceSubscriptions.get(subscriptionId)
    if (!record) return false
    mcpResourceSubscriptions.delete(subscriptionId)
    try {
      await record.disposable?.dispose?.()
    } catch {
      // best-effort cleanup for renderer-side watchers
    }
    return true
  }
  try { ipcMain.removeHandler("mcp:resource:subscribe") } catch {}
  ipcMain.handle("mcp:resource:subscribe", async (event, request = {}) => {
    const serverName = String(request?.serverName || "").trim()
    const uri = String(request?.uri || "").trim()
    if (!serverName) throw new Error("MCP server name is required")
    if (!uri) throw new Error("MCP resource uri is required")
    const ready = await waitForServicesReady(10000)
    if (!ready) throw new Error(serviceStartupError ? String(serviceStartupError?.message || serviceStartupError) : "Codek services are still starting")
    const subscriptionId = `mcp_resource_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    const sender = event.sender
    const mcpProfileRegistry = require("./services/mcp/profileMcpAdapter")
    const disposable = await mcpProfileRegistry.subscribeMcpResource(serverName, uri, (payload = {}) => {
      if (!mcpResourceSubscriptions.has(subscriptionId)) return
      if (sender.isDestroyed?.()) return
      sender.send("mcp:resource:update", {
        requestId: request?.requestId || "",
        subscriptionId,
        serverName: payload.serverName || serverName,
        uri: payload.uri || uri,
      })
    })
    const subscribeReady = disposable?.ready !== false
    mcpResourceSubscriptions.set(subscriptionId, { disposable, sender })
    sender.once("destroyed", () => {
      disposeMcpResourceSubscription(subscriptionId).catch(() => {})
    })
    return {
      subscriptionId,
      ready: subscribeReady,
      reason: subscribeReady ? undefined : (disposable?.reason || "MCP resource subscribe is not available for this server."),
      retryMode: disposable?.retryMode,
      retryAfter: disposable?.retryAfter,
      lastEventId: disposable?.lastEventId,
      channelStatus: disposable?.channelStatus,
      reconnectRequested: disposable?.reconnectRequested === true,
      userActionRequired: disposable?.userActionRequired === true,
      noAutoRetry: disposable?.noAutoRetry === true,
    }
  })
  try { ipcMain.removeHandler("mcp:resource:unsubscribe") } catch {}
  ipcMain.handle("mcp:resource:unsubscribe", async (_event, request = {}) => {
    const subscriptionId = String(request?.subscriptionId || "").trim()
    if (!subscriptionId) return { success: false }
    const disposed = await disposeMcpResourceSubscription(subscriptionId)
    return { success: disposed }
  })

  ipcMain.handle("dialog:openProject", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Open Project Folder",
    })
    if (result.canceled || !result.filePaths.length) return null
    await setWorkspaceRoots([result.filePaths[0]], null)
    return currentProjectRoot
  })

  ipcMain.handle("workspace:getState", () => getWorkspaceState())
  ipcMain.handle("workspace:getScaleProfile", () => currentWorkspaceScaleProfile)

  ipcMain.handle("workspace:openPath", async (_event, dirPath) => {
    if (typeof dirPath !== "string" || !dirPath.trim()) return null
    const resolved = path.resolve(dirPath)
    try {
      const stat = fs.statSync(resolved)
      if (!stat.isDirectory()) return null
    } catch {
      return null
    }
    await setWorkspaceRoots([resolved], null)
    return getWorkspaceState()
  })

  ipcMain.handle("workspace:openFileDialog", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      title: "Open Workspace",
      filters: [
        { name: "VS Code Workspace", extensions: ["code-workspace"] },
        { name: "All Files", extensions: ["*"] },
      ],
    })
    if (result.canceled || !result.filePaths.length) return null
    const workspacePath = result.filePaths[0]
    const content = fs.readFileSync(workspacePath, "utf-8")
    const workspace = parseWorkspaceContent(content, workspacePath)
    await setWorkspaceRoots(workspace.roots, workspacePath)
    return { ...workspace, ...getWorkspaceState() }
  })

  ipcMain.handle("workspace:addFolderDialog", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Add Folder to Workspace",
    })
    if (result.canceled || !result.filePaths.length) return null
    const nextRoots = [...getWorkspaceState().workspaceRoots, result.filePaths[0]]
    await setWorkspaceRoots(nextRoots, currentWorkspaceFile)
    return getWorkspaceState()
  })

  ipcMain.handle("workspace:saveAs", async (_event, roots, settings) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save Workspace As",
      defaultPath: currentWorkspaceFile || path.join(currentProjectRoot || HOME, "codek.code-workspace"),
      filters: [
        { name: "VS Code Workspace", extensions: ["code-workspace"] },
      ],
    })
    if (result.canceled || !result.filePath) return null
    const workspaceRoots = Array.isArray(roots) && roots.length ? roots : getWorkspaceState().workspaceRoots
    fs.writeFileSync(result.filePath, buildWorkspaceContent(workspaceRoots, settings || {}), "utf-8")
    await setWorkspaceRoots(workspaceRoots, result.filePath)
    return getWorkspaceState()
  })

  ipcMain.handle("app:getVersion", () => app.getVersion())

  ipcMain.handle("window:new", async (_event, mode) => {
    const win = await createMainWindow()
    if (mode === "agent") {
      win.webContents.once("did-finish-load", () => {
        win.webContents.send("window:agentMode")
      })
    }
    return true
  })

  ipcMain.handle("window:close", async (event, options = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return true
    return requestNativeWindowClose(win, {
      source: options?.source || "renderer-window-close",
      force: options?.force === true,
    })
  })

  ipcMain.handle("window:reloadWorkbench", async (event, options = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const owner = "ElectronMain BrowserWindow.reload"
    const reason = String(options?.reason || "workbench-host-reload")
    const remoteAuthority = String(options?.remoteAuthority || "")
    if (!win || win.isDestroyed()) {
      return {
        ok: false,
        reloaded: false,
        owner,
        reason,
        remoteAuthority,
        error: "No live BrowserWindow is associated with the workbench reload request",
      }
    }
    if (options?.dryRun === true) {
      return {
        ok: true,
        reloaded: false,
        dryRun: true,
        owner,
        reason,
        remoteAuthority,
        windowId: win.id,
      }
    }
    win.reload()
    return {
      ok: true,
      reloaded: true,
      owner,
      reason,
      remoteAuthority,
      windowId: win.id,
    }
  })

  ipcMain.handle("window:simulateCloseLifecycle", async (event, options = {}) => {
    if (!isSmoke) return { skipped: true, reason: "smoke-only" }
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return { allowed: true, reason: "window-destroyed" }
    return evaluateNativeWindowClose(win, {
      source: options?.source || "electron-smoke",
      force: options?.force === true,
      timeoutMs: options?.timeoutMs,
    })
  })

  ipcMain.on("window:will-close-response", (_event, payload = {}) => {
    const requestId = typeof payload?.requestId === "string" ? payload.requestId : ""
    const finish = pendingRendererWindowCloseRequests.get(requestId)
    if (!finish) return
    finish(payload)
  })

  ipcMain.handle("app:quit", async () => {
    isQuitting = true
    const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())
    for (const win of windows) {
      const allowed = await requestNativeWindowClose(win, { source: "app-quit" })
      if (!allowed) {
        isQuitting = false
        nativeQuitApproved = false
        return false
      }
    }
    nativeQuitApproved = true
    app.quit()
    return true
  })

  ipcMain.handle("window:toggleDevTools", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return false
    if (win.webContents.isDevToolsOpened()) {
      win.webContents.closeDevTools()
    } else {
      win.webContents.openDevTools({ mode: "detach" })
    }
    return true
  })

  ipcMain.handle("app:openLogs", () => {
    const logsPath = app.getPath("logs")
    shell.openPath(logsPath)
    return logsPath
  })

  ipcMain.handle("diagnostics:export", () => writeDiagnosticsBundle())

  ipcMain.handle("process:list", () => collectProcessSummary())

  ipcMain.handle("app:openEvalReport", (_event, reportPath) => {
    if (typeof reportPath !== "string" || !reportPath.trim()) return Promise.resolve(false)
    const resolved = path.resolve(reportPath)
    const evalRoots = [
      process.env.CODEK_EVAL_REPORT_DIR,
      path.join(process.cwd(), ".codek", "evals"),
      path.join(process.cwd(), "..", ".codek", "evals"),
      path.join(CODEK_DATA, "evals"),
    ].filter(Boolean).map((dir) => path.resolve(dir))
    const insideEvalRoot = evalRoots.some((rootDir) => {
      const relative = path.relative(rootDir, resolved)
      return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
    })
    if (!insideEvalRoot || path.extname(resolved).toLowerCase() !== ".md" || !fs.existsSync(resolved)) {
      console.warn(`[security] openEvalReport blocked path: ${reportPath}`)
      return Promise.resolve(false)
    }
    return shell.openPath(resolved).then((errorMessage) => errorMessage === "")
  })

  ipcMain.handle("secureStore:available", () => {
    try { return safeStorage.isEncryptionAvailable() } catch { return false }
  })

  ipcMain.handle("secureStore:encrypt", (_event, plaintext) => {
    if (typeof plaintext !== "string" || plaintext.length === 0) return ""
    if (!safeStorage.isEncryptionAvailable()) return ""
    try {
      return safeStorage.encryptString(plaintext).toString("base64")
    } catch {
      return ""
    }
  })

  ipcMain.handle("secureStore:decrypt", (_event, ciphertextB64) => {
    if (typeof ciphertextB64 !== "string" || ciphertextB64.length === 0) return ""
    if (!safeStorage.isEncryptionAvailable()) return ""
    try {
      return safeStorage.decryptString(Buffer.from(ciphertextB64, "base64"))
    } catch {
      return ""
    }
  })

  ipcMain.handle("app:getPath", (_event, name) => {
    try {
      return app.getPath(name)
    } catch {
      return HOME
    }
  })

  ipcMain.handle("app:isPackaged", () => app.isPackaged)

  ipcMain.handle("shell:openExternal", (_event, url) => {
    // Whitelist schemes — shell.openExternal will happily fire javascript:,
    // file:, smb:, ms-cxh:, and other registered protocol handlers, which can
    // escalate a renderer-side XSS into local code execution. Only allow
    // user-navigable web/mail URLs.
    if (typeof url !== "string") return Promise.resolve(false)
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      return Promise.resolve(false)
    }
    const allowed = new Set(["http:", "https:", "mailto:"])
    if (!allowed.has(parsed.protocol)) {
      console.warn(`[security] openExternal blocked scheme: ${parsed.protocol}`)
      return Promise.resolve(false)
    }
    return shell.openExternal(url)
  })

  ipcMain.handle("oauth:login", async (_event, provider) => {
    if (provider !== "github") {
      return { success: false, error: "unsupported_provider" }
    }
    try {
      const router = require("./services/router")
      const res = await router.dispatch({
        method: "POST",
        path: "/auth/oauth/github/device/start",
        body: {},
      })
      if (!res || !res.ok) return { success: false, error: "backend_unreachable" }
      const data = res.data || {}
      if (data.success === false) return data
      if (data.verificationUri) await shell.openExternal(data.verificationUri)
      return { success: true, ...data }
    } catch {
      return { success: false, error: "backend_unreachable" }
    }
  })

  ipcMain.handle("backend:health", async () => {
    return true
  })

  ipcMain.handle("ollama:health", async () => {
    return httpGet(OLLAMA_BASE_URL)
  })

  ipcMain.handle("ollama:install", () => {
    shell.openExternal("https://ollama.com/download")
    return { opened: true }
  })

  ipcMain.handle("run:command", async (_event, command, cwd, meta) => {
    const source = resolveSource(meta)
    const parsed = security.shellGuard.splitCommandLine(command)
    if (!parsed.ok) {
      return { exitCode: -1, stderr: `[security] ${parsed.message}`, stdout: "" }
    }
    const guard = security.shellGuard.validateCommand(parsed.command, parsed.args, { source })
    if (!guard.ok) {
      return { exitCode: -1, stderr: `[security] ${guard.message}`, stdout: "" }
    }
    const result = await security.sandbox.spawnSandboxed({
      command: guard.command,
      args: guard.args,
      cwd: cwd || currentProjectRoot || HOME,
      env: process.env,
      timeoutMs: 30000,
      network: source === "user",
      source,
    })
    return {
      exitCode: result.exitCode,
      stdout: (result.output || "").slice(0, 50000),
      stderr: (result.error || "").slice(0, 10000),
      backend: result.backend,
    }
  })

  ipcMain.handle("fs:readFile", async (_event, filePath, options, meta) => {
    const readOptions = options && typeof options === "object" && !Array.isArray(options) ? options : {}
    const readMeta = meta || (options && options.source ? options : null)
    if (readOptions.streamRequestId) {
      const requestId = String(readOptions.streamRequestId || "")
      const chunkBytes = Math.max(1, Math.min(Number(readOptions.streamChunkBytes || 64 * 1024), DEFAULT_MAX_RENDERER_PREVIEW_FILE_BYTES))
      writeElectronSmokeStage("fs-read-file:stream:start", {
        filePath,
        requestId,
        readOptions,
        chunkBytes,
        source: readMeta?.source || null,
      })
      const g = guardFsPath(filePath, readMeta, { mustExist: true })
      const send = (payload) => {
        if (!_event.sender.isDestroyed()) {
          _event.sender.send("fs:readFileTextChunks:event", { requestId, ...payload })
        }
      }
      if (!g.ok) {
        send({ type: "error", error: `[security] ${g.message}` })
        return { streamed: false, requestId, error: `[security] ${g.message}` }
      }
      try {
        const stat = await fs.promises.stat(g.resolved)
        const requestedLength = Math.max(1, Number(readOptions.length || readOptions.previewBytes || readOptions.maxBytes || chunkBytes))
        const startOffset = Math.max(0, Math.min(
          Number(readOptions.offset || 0),
          Math.max(0, Number(stat.size || 0) - Math.min(requestedLength, Number(stat.size || requestedLength))),
        ))
        const totalLength = Math.min(requestedLength, Math.max(0, Number(stat.size || 0) - startOffset))
        const chunks = []
        const handle = await fs.promises.open(g.resolved, "r")
        let bytesReadTotal = 0
        try {
          while (bytesReadTotal < totalLength) {
            const length = Math.min(chunkBytes, totalLength - bytesReadTotal)
            const buffer = Buffer.allocUnsafe(length)
            const { bytesRead } = await handle.read(buffer, 0, length, startOffset + bytesReadTotal)
            if (bytesRead <= 0) break
            const offset = startOffset + bytesReadTotal
            bytesReadTotal += bytesRead
            const content = buffer.subarray(0, bytesRead).toString("utf-8")
            chunks.push(content)
            send({
              type: "chunk",
              offset,
              content,
              bytesRead,
              size: stat.size,
              path: filePath,
            })
          }
        } finally {
          await handle.close()
        }
        send({
          type: "done",
          offset: startOffset,
          bytesRead: bytesReadTotal,
          size: stat.size,
          limit: chunkBytes,
          previewBytes: bytesReadTotal,
          truncated: startOffset + bytesReadTotal < stat.size,
          path: filePath,
        })
        writeElectronSmokeStage("fs-read-file:stream:done", {
          filePath,
          requestId,
          offset: startOffset,
          bytesRead: bytesReadTotal,
          size: stat.size,
        })
        return {
          streamed: true,
          requestId,
          content: chunks.join(""),
          bytesRead: bytesReadTotal,
          size: stat.size,
          limit: chunkBytes,
          previewBytes: bytesReadTotal,
          offset: startOffset,
          truncated: startOffset + bytesReadTotal < stat.size,
          path: filePath,
        }
      } catch (err) {
        const message = String(err?.message || err)
        writeElectronSmokeStage("fs-read-file:stream:error", {
          filePath,
          requestId,
          error: message,
        })
        send({ type: "error", error: message })
        if (readOptions.allowMissing && err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
          return { streamed: false, requestId, error: message }
        }
        throw new Error(`Cannot stream ${filePath}: ${err.message}`)
      }
    }
    writeElectronSmokeStage("fs-read-file:start", {
      filePath,
      readOptions,
      source: readMeta?.source || null,
    })
    const g = guardFsPath(filePath, readMeta, { mustExist: true })
    if (!g.ok) throw new Error(`[security] ${g.message}`)
    try {
      const stat = await fs.promises.stat(g.resolved)
      writeElectronSmokeStage("fs-read-file:stat", {
        filePath,
        resolved: g.resolved,
        size: stat.size,
        isFile: stat.isFile(),
      })
      const smokeExtremeFile = (isExplorerPerformanceSmoke || isRealProjectUiSmoke)
        && electronSmokeExplorerExtremeFile
        && path.resolve(g.resolved) === path.resolve(electronSmokeExplorerExtremeFile.filePath)
          ? electronSmokeExplorerExtremeFile
          : null
      const result = await readRendererTextFile({
        resolvedPath: g.resolved,
        requestedPath: filePath,
        readOptions,
        readMeta,
        stat,
        smokeExtremeFile,
        maxBytes: MAX_RENDERER_READ_FILE_BYTES,
      })
      if (readOptions.returnContentOnly && result && typeof result === "object" && typeof result.content === "string") {
        writeElectronSmokeStage("fs-read-file:done", {
          filePath,
          resolved: g.resolved,
          resultType: "string",
          resultLength: result.content.length,
          resultKeys: [],
          returnContentOnly: true,
        })
        return result.content
      }
      writeElectronSmokeStage("fs-read-file:done", {
        filePath,
        resolved: g.resolved,
        resultType: typeof result,
        resultLength: typeof result === "string" ? result.length : null,
        resultKeys: result && typeof result === "object" ? Object.keys(result).slice(0, 8) : [],
      })
      return result
    } catch (err) {
      writeElectronSmokeStage("fs-read-file:error", {
        filePath,
        error: String(err?.message || err),
      })
      if (readOptions.allowMissing && err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
        return null
      }
      throw new Error(`Cannot read ${filePath}: ${err.message}`)
    }
  })

  ipcMain.handle("fs:readFileTextChunk", async (_event, filePath, options, meta) => {
    const readOptions = options && typeof options === "object" && !Array.isArray(options) ? options : {}
    const readMeta = meta || (options && options.source ? options : null)
    writeElectronSmokeStage("fs-read-file-text-chunk:start", {
      filePath,
      readOptions,
      source: readMeta?.source || null,
    })
    const g = guardFsPath(filePath, readMeta, { mustExist: true })
    if (!g.ok) throw new Error(`[security] ${g.message}`)
    try {
      const stat = await fs.promises.stat(g.resolved)
      const result = await readRendererTextFileChunk({
        resolvedPath: g.resolved,
        requestedPath: filePath,
        readOptions,
        stat,
        maxChunkBytes: DEFAULT_MAX_RENDERER_PREVIEW_FILE_BYTES,
      })
      writeElectronSmokeStage("fs-read-file-text-chunk:done", {
        filePath,
        resolved: g.resolved,
        offset: result.offset,
        bytesRead: result.bytesRead,
        size: result.size,
      })
      return result
    } catch (err) {
      writeElectronSmokeStage("fs-read-file-text-chunk:error", {
        filePath,
        error: String(err?.message || err),
      })
      if (readOptions.allowMissing && err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
        return null
      }
      throw new Error(`Cannot read chunk ${filePath}: ${err.message}`)
    }
  })

  ipcMain.on("fs:readFileTextChunks", async (event, request) => {
    const requestId = String(request?.requestId || "")
    const filePath = request?.filePath
    const readOptions = request?.options && typeof request.options === "object" && !Array.isArray(request.options)
      ? request.options
      : {}
    const chunkBytes = Math.max(1, Math.min(Number(request?.chunkBytes || 64 * 1024), DEFAULT_MAX_RENDERER_PREVIEW_FILE_BYTES))
    const send = (payload) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("fs:readFileTextChunks:event", { requestId, ...payload })
      }
    }
    writeElectronSmokeStage("fs-read-file-text-chunks:start", {
      filePath,
      requestId,
      readOptions,
      chunkBytes,
    })
    const g = guardFsPath(filePath, null, { mustExist: true })
    if (!g.ok) {
      send({ type: "error", error: `[security] ${g.message}` })
      return
    }
    try {
      const stat = await fs.promises.stat(g.resolved)
      const requestedLength = Math.max(1, Number(readOptions.length || readOptions.previewBytes || readOptions.maxBytes || chunkBytes))
      const startOffset = Math.max(0, Math.min(
        Number(readOptions.offset || 0),
        Math.max(0, Number(stat.size || 0) - Math.min(requestedLength, Number(stat.size || requestedLength))),
      ))
      const totalLength = Math.min(requestedLength, Math.max(0, Number(stat.size || 0) - startOffset))
      const handle = await fs.promises.open(g.resolved, "r")
      let bytesReadTotal = 0
      try {
        while (bytesReadTotal < totalLength) {
          const length = Math.min(chunkBytes, totalLength - bytesReadTotal)
          const buffer = Buffer.allocUnsafe(length)
          const { bytesRead } = await handle.read(buffer, 0, length, startOffset + bytesReadTotal)
          if (bytesRead <= 0) break
          const offset = startOffset + bytesReadTotal
          bytesReadTotal += bytesRead
          send({
            type: "chunk",
            offset,
            content: buffer.subarray(0, bytesRead).toString("utf-8"),
            bytesRead,
            size: stat.size,
            path: filePath,
          })
          writeElectronSmokeStage("fs-read-file-text-chunks:chunk", {
            filePath,
            requestId,
            offset,
            bytesRead,
            bytesReadTotal,
          })
        }
      } finally {
        await handle.close()
      }
      send({
        type: "done",
        offset: startOffset,
        bytesRead: bytesReadTotal,
        size: stat.size,
        limit: chunkBytes,
        previewBytes: bytesReadTotal,
        truncated: startOffset + bytesReadTotal < stat.size,
        path: filePath,
      })
      writeElectronSmokeStage("fs-read-file-text-chunks:done", {
        filePath,
        requestId,
        offset: startOffset,
        bytesRead: bytesReadTotal,
        size: stat.size,
      })
    } catch (err) {
      const message = String(err?.message || err)
      writeElectronSmokeStage("fs-read-file-text-chunks:error", {
        filePath,
        requestId,
        error: message,
      })
      send({ type: "error", error: message })
    }
  })

  ipcMain.handle("fs:writeFile", async (_event, filePath, content, meta) => {
    const g = guardFsPath(filePath, meta)
    if (!g.ok) throw new Error(`[security] ${g.message}`)
    try {
      ensureDirectories()
      fs.writeFileSync(g.resolved, content, "utf-8")
      return true
    } catch (err) {
      throw new Error(`Cannot write ${filePath}: ${err.message}`)
    }
  })

  ipcMain.handle("fs:patchFileSegment", async (_event, filePath, plan, meta) => {
    const g = guardFsPath(filePath, meta, { mustExist: true })
    if (!g.ok) throw new Error(`[security] ${g.message}`)
    try {
      return await patchRendererTextFileSegment(g.resolved, plan)
    } catch (err) {
      throw new Error(`Cannot patch file segment ${filePath}: ${err.message}`)
    }
  })

  ipcMain.handle("fs:mkdir", async (_event, dirPath, meta) => {
    const g = guardFsPath(dirPath, meta)
    if (!g.ok) throw new Error(`[security] ${g.message}`)
    try {
      fs.mkdirSync(g.resolved, { recursive: true })
      return true
    } catch (err) {
      throw new Error(`Cannot create directory ${dirPath}: ${err.message}`)
    }
  })

  ipcMain.handle("fs:stat", async (_event, filePath, meta) => {
    writeElectronSmokeStage("fs-stat:start", {
      filePath,
      source: resolveSource(meta),
    })
    const g = guardFsPath(filePath, meta)
    if (!g.ok) {
      writeElectronSmokeStage("fs-stat:blocked", {
        filePath,
        code: g.code || "BLOCKED",
        message: g.message || "",
      })
      return { exists: false }
    }
    try {
      const statResult = await statFsPathWithTimeout(g.resolved)
      if (statResult?.timeout) {
        writeElectronSmokeStage("fs-stat:timeout", {
          filePath,
          resolved: g.resolved,
          timeoutMs: FS_STAT_TIMEOUT_MS,
        })
        return { exists: false }
      }
      const stat = statResult?.stat
      if (!stat) return { exists: false }
      const smokeExtremeFile = (isExplorerPerformanceSmoke || isRealProjectUiSmoke)
        && electronSmokeExplorerExtremeFile
        && path.resolve(g.resolved) === path.resolve(electronSmokeExplorerExtremeFile.filePath)
          ? electronSmokeExplorerExtremeFile
          : null
      const result = mapStatToFileServiceEntry({
        filePath: g.resolved,
        stat,
        sizeOverride: smokeExtremeFile ? smokeExtremeFile.virtualSize : undefined,
      })
      writeElectronSmokeStage("fs-stat:done", {
        filePath,
        resolved: g.resolved,
        exists: result.exists,
        isDirectory: result.isDirectory,
        isFile: result.isFile,
        size: result.size,
      })
      return result
    } catch (err) {
      writeElectronSmokeStage("fs-stat:error", {
        filePath,
        resolved: g.resolved,
        error: String(err?.message || err),
      })
      return { exists: false }
    }
  })

  ipcMain.handle("fs:listDir", async (_event, dirPath, options, meta) => {
    const listOptions = options && typeof options === "object" && !Array.isArray(options) ? options : {}
    const listMeta = meta || (options && options.source ? options : null)
    const g = guardFsPath(dirPath, listMeta)
    if (!g.ok) return []
    if (isExplorerPerformanceSmoke || isRealExplorerSmoke || isExplorerStressSmoke) {
      electronSmokeExplorerReadDirCalls.push(String(g.resolved || dirPath || "").replace(/\\/g, "/").replace(/\/+$/, ""))
      electronSmokeExplorerReadDirInFlight += 1
      electronSmokeExplorerReadDirInFlightMax = Math.max(electronSmokeExplorerReadDirInFlightMax, electronSmokeExplorerReadDirInFlight)
    }
    try {
      const start = Date.now()
      const entries = await fs.promises.readdir(g.resolved, { withFileTypes: true })
      const profileEntryBudget = Number(currentWorkspaceScaleProfile?.budgets?.explorerMaxEntries || MAX_RENDERER_LIST_DIR_ENTRIES)
      const entryBudget = resolveListDirEntryBudget({
        totalEntries: entries.length,
        options: listOptions,
        meta: listMeta,
        profileEntryBudget,
        defaultEntryBudget: MAX_RENDERER_LIST_DIR_ENTRIES,
      })
      const maxEntries = entryBudget.maxEntries
      const includeStats = listOptions.includeStats === true
      const visibleEntries = entries.slice(0, maxEntries)
      const mappedEntries = await mapDirentsToFileServiceEntries({
        fsPromises: fs.promises,
        parentPath: g.resolved,
        dirents: visibleEntries,
        includeStats,
      })
      recordElectronSmokeExplorerReadDirSample(g.resolved, mappedEntries)
      return mappedEntries.concat(entryBudget.appendLimitSentinel ? [
        createDirectoryEntryLimitSentinel({
          parentPath: g.resolved,
          totalEntries: entries.length,
          readDurationMs: Date.now() - start,
        }),
      ] : [])
    } catch {
      return []
    } finally {
      if (isExplorerPerformanceSmoke || isRealExplorerSmoke || isExplorerStressSmoke) {
        electronSmokeExplorerReadDirInFlight = Math.max(0, electronSmokeExplorerReadDirInFlight - 1)
      }
      scheduleExpandedDirectoryWatch(g.resolved)
    }
  })

  ipcMain.handle("fs:delete", async (_event, filePath, meta) => {
    const g = guardFsPath(filePath, meta)
    if (!g.ok) throw new Error(`[security] ${g.message}`)
    try {
      if (fs.statSync(g.resolved).isDirectory()) {
        fs.rmSync(g.resolved, { recursive: true })
      } else {
        fs.unlinkSync(g.resolved)
      }
      return true
    } catch (err) {
      throw new Error(`Cannot delete ${filePath}: ${err.message}`)
    }
  })

  ipcMain.handle("fs:rename", async (_event, oldPath, newPath, meta) => {
    const g1 = guardFsPath(oldPath, meta)
    const g2 = guardFsPath(newPath, meta)
    if (!g1.ok) throw new Error(`[security] ${g1.message}`)
    if (!g2.ok) throw new Error(`[security] ${g2.message}`)
    try {
      if (fs.existsSync(g2.resolved)) throw new Error("target already exists")
      fs.renameSync(g1.resolved, g2.resolved)
      return true
    } catch (err) {
      throw new Error(`Cannot rename: ${err.message}`)
    }
  })

  ipcMain.handle("fs:copy", async (_event, sourcePath, targetPath, meta) => {
    const source = guardFsPath(sourcePath, meta, { mustExist: true })
    const target = guardFsPath(targetPath, meta)
    if (!source.ok) throw new Error(`[security] ${source.message}`)
    if (!target.ok) throw new Error(`[security] ${target.message}`)
    try {
      if (fs.existsSync(target.resolved)) throw new Error("target already exists")
      const stat = fs.statSync(source.resolved)
      if (stat.isDirectory()) {
        fs.cpSync(source.resolved, target.resolved, { recursive: true, errorOnExist: true, force: false })
      } else {
        fs.mkdirSync(path.dirname(target.resolved), { recursive: true })
        fs.copyFileSync(source.resolved, target.resolved, fs.constants.COPYFILE_EXCL)
      }
      return true
    } catch (err) {
      throw new Error(`Cannot copy: ${err.message}`)
    }
  })

  ipcMain.handle("shell:showItemInFolder", async (_event, filePath, meta) => {
    const g = guardFsPath(filePath, meta, { mustExist: true })
    if (!g.ok) throw new Error(`[security] ${g.message}`)
    shell.showItemInFolder(g.resolved)
    return true
  })

  ipcMain.handle("app:openFileDialog", async (_event, options = {}) => {
    const safeOptions = options && typeof options === "object" ? options : {}
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      title: typeof safeOptions.title === "string" ? safeOptions.title : "Select a file",
      filters: Array.isArray(safeOptions.filters) ? safeOptions.filters : undefined,
    })
    if (result.canceled || !result.filePaths.length) return null
    const filePath = result.filePaths[0]
    if (safeOptions.readContent === false) return { path: filePath, filePath }
    try {
      const content = fs.readFileSync(filePath, "utf-8")
      return { path: filePath, content }
    } catch (err) {
      throw new Error(`Cannot open file: ${err.message}`)
    }
  })

  ipcMain.handle("app:saveFileDialog", async (_event, options = {}) => {
    const safeOptions = options && typeof options === "object" ? options : {}
    const result = await dialog.showSaveDialog(mainWindow, {
      title: typeof safeOptions.title === "string" ? safeOptions.title : "Save file",
      defaultPath: typeof safeOptions.defaultPath === "string" ? safeOptions.defaultPath : undefined,
      filters: Array.isArray(safeOptions.filters) ? safeOptions.filters : undefined,
    })
    if (result.canceled || !result.filePath) return null
    return { path: result.filePath, filePath: result.filePath }
  })

  ipcMain.handle("app:getAppDataPath", () => CODEK_DATA)

  ipcMain.handle("ollama:isInstalled", () => {
    try {
      const cmd = isWindows ? "where ollama" : "which ollama"
      execSync(cmd, { stdio: "pipe" })
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle("fs:getProjectRoot", async () => {
    if (currentProjectRoot && !fileWatcher) {
      scheduleFileWatcher(currentProjectRoot)
    }
    return currentProjectRoot
  })

  ipcMain.handle("window:setTitle", (_event, title) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(title)
    }
  })

  ipcMain.handle("shell:run", async (_event, command, meta) => {
    const source = resolveSource(meta)
    const cwd = typeof meta?.cwd === "string" && meta.cwd.trim() ? meta.cwd : currentProjectRoot || HOME
    const env = meta?.env && typeof meta.env === "object" && !Array.isArray(meta.env)
      ? Object.fromEntries(Object.entries(meta.env).map(([key, value]) => [key, String(value ?? "")]))
      : {}
    const parsed = security.shellGuard.splitCommandLine(command)
    if (!parsed.ok) {
      return { exitCode: -1, stderr: `[security] ${parsed.message}`, stdout: "" }
    }
    const guard = security.shellGuard.validateCommand(parsed.command, parsed.args, { source })
    if (!guard.ok) {
      return { exitCode: -1, stderr: `[security] ${guard.message}`, stdout: "" }
    }
    const result = await security.sandbox.spawnSandboxed({
      command: guard.command,
      args: guard.args,
      cwd,
      env: { ...process.env, ...env },
      timeoutMs: 30000,
      network: source === "user",
      source,
    })
    return {
      exitCode: result.exitCode,
      stdout: (result.output || "").slice(0, 50000),
      stderr: (result.error || "").slice(0, 10000),
      backend: result.backend,
    }
  })

  setupSshIPC()
  setupWslIPC()
  setupDockerIPC()
  setupMcpProcessIPC()
  setupLspIPC()
  setupDapIPC()
  setupPtyIPC()
}

function sendMcpProcessEvent(processId, type, payload = {}) {
  const entry = mcpProcesses.get(processId)
  const windows = entry?.webContents && !entry.webContents.isDestroyed()
    ? [entry.webContents]
    : BrowserWindow.getAllWindows().map((win) => win.webContents)
  for (const webContents of windows) {
    try {
      if (!webContents.isDestroyed()) {
        webContents.send("process:event", { processId, pid: entry?.process?.pid || payload.pid || null, type, ...payload })
      }
    } catch {
      // Ignore renderer shutdown races.
    }
  }
}

function sanitizeMcpProcessEnv(env) {
  if (!env || typeof env !== "object" || Array.isArray(env)) return {}
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [String(key), String(value ?? "")]))
}

function setupMcpProcessIPC() {
  ipcMain.handle("process:spawn", async (event, command, args = [], opts = {}) => {
    const resolvedCommand = typeof command === "string" ? command.trim() : ""
    if (!resolvedCommand) throw new Error("MCP process command is required")
    const resolvedArgs = Array.isArray(args) ? args.filter((arg) => typeof arg === "string") : []
    const cwd = typeof opts?.cwd === "string" && opts.cwd.trim() ? opts.cwd : currentProjectRoot || HOME
    const trustDecision = evaluateCommandExecution(cwd, [resolvedCommand, ...resolvedArgs].join(" "), {
      action: "启动 MCP 服务",
      category: "mcp_process",
      toolName: "mcp",
      confirmed: opts?.confirmed === true,
      audit: true,
    })
    if (!trustDecision.allowed) {
      throw new Error(trustDecision.message || "MCP process blocked by workspace policy")
    }

    const processId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const proc = spawn(resolvedCommand, resolvedArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
      env: { ...process.env, ...sanitizeMcpProcessEnv(opts?.env) },
      shell: false,
    })
    mcpProcesses.set(processId, {
      process: proc,
      command: resolvedCommand,
      webContents: event.sender,
    })

    proc.stdout.on("data", (data) => {
      sendMcpProcessEvent(processId, "stdout", { data: data.toString("utf8") })
    })
    proc.stderr.on("data", (data) => {
      sendMcpProcessEvent(processId, "stderr", { data: data.toString("utf8") })
    })
    proc.on("exit", (code, signal) => {
      sendMcpProcessEvent(processId, "exit", { code, signal })
      mcpProcesses.delete(processId)
    })
    proc.on("error", (error) => {
      sendMcpProcessEvent(processId, "error", { error: error?.message || String(error) })
      mcpProcesses.delete(processId)
    })

    return { id: processId, pid: proc.pid, command: resolvedCommand, args: resolvedArgs }
  })

  ipcMain.handle("process:stdin", async (_event, processId, data) => {
    const entry = mcpProcesses.get(processId)
    if (!entry) throw new Error(`MCP process not found: ${processId}`)
    entry.process.stdin.write(Buffer.isBuffer(data) ? data : String(data ?? ""))
    return true
  })

  ipcMain.handle("process:kill", async (_event, processId) => {
    const entry = mcpProcesses.get(processId)
    if (!entry) return true
    try {
      entry.process.kill("SIGTERM")
    } catch {
      // process may already be gone
    }
    mcpProcesses.delete(processId)
    return true
  })
}

function setupPtyIPC() {
  let unsubscribe = null

  const attachStream = () => {
    if (unsubscribe) return
    unsubscribe = ptyManager.subscribe((event) => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (event.type === "data") {
        mainWindow.webContents.send("pty:data", { id: event.id, data: event.data })
      } else if (event.type === "exit") {
        mainWindow.webContents.send("pty:exit", {
          id: event.id,
          exitCode: event.exitCode,
          signal: event.signal,
        })
      }
    })
  }

  ipcMain.handle("pty:isAvailable", () => ptyManager.isAvailable())

  ipcMain.handle("pty:create", (_event, opts) => {
    attachStream()
    const id = opts?.id || `pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const cwd = opts?.cwd || currentProjectRoot || HOME
    try {
      const info = ptyManager.createSession({
        id,
        shellType: opts?.shellType || "powershell",
        cwd,
          cols: opts?.cols,
          rows: opts?.rows,
          env: opts?.env,
          confirmed: true,
        })
      return { ok: true, ...info }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle("pty:write", (_event, id, data) => {
    return ptyManager.write(id, data)
  })

  ipcMain.handle("pty:resize", (_event, id, cols, rows) => {
    return ptyManager.resize(id, cols, rows)
  })

  ipcMain.handle("pty:dispose", (_event, id) => {
    return ptyManager.dispose(id)
  })

  ipcMain.handle("pty:list", () => ptyManager.listSessions())
  ipcMain.handle("pty:processExplorer", () => ptyManager.getProcessExplorerSnapshot())
}

function runShellCommand(command, cwd, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const proc = spawn(command, [], {
      shell: true,
      cwd: cwd || HOME,
      timeout: timeoutMs,
    })

    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (data) => { stdout += data.toString() })
    proc.stderr.on("data", (data) => { stderr += data.toString() })

    proc.on("close", (code) => {
      resolve({ exitCode: code, stdout: stdout.slice(0, 50000), stderr: stderr.slice(0, 10000) })
    })

    proc.on("error", (err) => {
      resolve({ exitCode: -1, stderr: err.message })
    })
  })
}

const SSH_CONNECTION_TIMEOUT_MS = 15000
const SSH_CMD_TIMEOUT_MS = 30000

const activeSshConnections = new Map()
const sshSftpSessions = new Map()
const sshFileWatchers = new Map()

const SSH_FILE_WATCH_POLL_INTERVAL_MS = 5000

const SHELL_META_CHARS_REGEX = /;|&|\$|`|\|/
const PATH_TRAVERSAL_REGEX = /\.\./

function validatePath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("Invalid path: path must be a non-empty string")
  }
  if (SHELL_META_CHARS_REGEX.test(filePath)) {
    throw new Error(`Invalid path: shell meta characters detected in "${filePath}"`)
  }
  if (PATH_TRAVERSAL_REGEX.test(filePath)) {
    throw new Error(`Invalid path: path traversal detected in "${filePath}"`)
  }
  return filePath
}

const CONTAINER_ID_REGEX = /^[a-f0-9]{1,64}$/i

function validateContainerId(id) {
  if (typeof id !== "string" || !CONTAINER_ID_REGEX.test(id)) {
    throw new Error(`Invalid container ID: "${id}"`)
  }
  return id
}

function checkInotifyAvailable(conn) {
  return new Promise((resolve) => {
    conn.exec("which inotifywait 2>/dev/null", (err, stream) => {
      if (err) {
        resolve(false)
        return
      }
      let stdout = ""
      stream.on("data", (data) => { stdout += data.toString() })
      stream.on("close", (code) => {
        resolve(code === 0 && stdout.trim().length > 0)
      })
    })
  })
}

function startInotifyWatcher(connectionId, conn, remotePath, watcherState) {
  conn.exec(`inotifywait -m -r --format '%w%f %e' '${remotePath}'`, (err, stream) => {
    if (err) {
      log(`[ssh-watch:${connectionId}] inotifywait failed: ${err.message}, switching to polling`)
      startPollingWatcher(connectionId, conn, remotePath, watcherState)
      return
    }

    watcherState.stream = stream

    stream.on("data", (data) => {
      const lines = data.toString().split("\n")
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("Setting up") || trimmed.startsWith("Watches")) continue

        const lastSpaceIdx = trimmed.lastIndexOf(" ")
        if (lastSpaceIdx === -1) continue

        const filePath = trimmed.substring(0, lastSpaceIdx)
        const events = trimmed.substring(lastSpaceIdx + 1)

        let type = "change"
        if (events.includes("CREATE") || events.includes("MOVED_TO")) type = "add"
        else if (events.includes("DELETE") || events.includes("MOVED_FROM")) type = "unlink"

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("ssh:fileWatchEvent", { connectionId, path: filePath, type })
        }
      }
    })

    stream.stderr.on("data", (data) => {
      log(`[ssh-watch:${connectionId}] stderr: ${data.toString().trim()}`)
    })

    stream.on("close", () => {
      if (sshFileWatchers.has(connectionId) && watcherState.mode === "inotify") {
        log(`[ssh-watch:${connectionId}] inotifywait stream closed, switching to polling`)
        watcherState.stream = null
        startPollingWatcher(connectionId, conn, remotePath, watcherState)
      }
    })
  })
}

function startPollingWatcher(connectionId, conn, remotePath, watcherState) {
  watcherState.mode = "polling"

  const safeId = connectionId.replace(/[^a-zA-Z0-9]/g, "_")
  const markerFile = `/tmp/codek_ssh_watch_${safeId}`

  conn.exec(`touch ${markerFile}`, (touchErr, touchStream) => {
    if (touchErr) {
      log(`[ssh-watch:${connectionId}] Failed to create marker: ${touchErr.message}`)
      return
    }
    touchStream.on("close", () => {
      watcherState.intervalId = setInterval(() => {
        pollSshFileChanges(connectionId, conn, remotePath, markerFile)
      }, SSH_FILE_WATCH_POLL_INTERVAL_MS)
    })
  })
}

function pollSshFileChanges(connectionId, conn, remotePath, markerFile) {
  conn.exec(
    `find '${remotePath}' -newer ${markerFile} -type f 2>/dev/null && touch ${markerFile}`,
    (err, stream) => {
      if (err) return

      let stdout = ""
      stream.on("data", (data) => { stdout += data.toString() })
      stream.on("close", () => {
        const files = stdout.trim().split("\n").filter((f) => f.length > 0)
        for (const filePath of files) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("ssh:fileWatchEvent", { connectionId, path: filePath, type: "change" })
          }
        }
      })
    },
  )
}

function stopSshFileWatcher(connectionId) {
  const watcher = sshFileWatchers.get(connectionId)
  if (!watcher) return

  if (watcher.stream) {
    try {
      watcher.stream.close()
    } catch {
      log(`[ssh-watch:${connectionId}] stream close error (already closed)`)
    }
    watcher.stream = null
  }
  if (watcher.intervalId) {
    clearInterval(watcher.intervalId)
    watcher.intervalId = null
  }

  sshFileWatchers.delete(connectionId)
}

function setupSshIPC() {
  ipcMain.handle("ssh:connect", async (_event, config) => {
    const connId = `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    try {
      const ssh2 = require("ssh2")
      const conn = new ssh2.Client()

      const connectOptions = {
        host: config.host,
        port: config.port || 22,
        username: config.username,
        readyTimeout: SSH_CONNECTION_TIMEOUT_MS,
      }

      if (config.authType === "key" && config.keyPath) {
        const keyContent = fs.readFileSync(
          config.keyPath.replace(/^~/, HOME),
          "utf-8",
        )
        connectOptions.privateKey = keyContent
      } else if (config.password) {
        connectOptions.password = config.password
      }

      await new Promise((resolve, reject) => {
        conn.on("ready", resolve)
        conn.on("error", reject)
        conn.connect(connectOptions)
      })

      const sftp = await new Promise((resolve, reject) => {
        conn.sftp((err, sftpInstance) => {
          if (err) return reject(new Error(`SFTP init failed: ${err.message}`))
          resolve(sftpInstance)
        })
      })

      activeSshConnections.set(connId, conn)
      sshSftpSessions.set(connId, sftp)

      return {
        id: connId,
        type: "ssh",
        label: `${config.username}@${config.host}:${config.port || 22}`,
        state: "connected",
        config,
      }
    } catch (err) {
      throw new Error(`SSH connection failed: ${err.message}`)
    }
  })

  ipcMain.handle("ssh:disconnect", async (_event, connId) => {
    stopSshFileWatcher(connId)
    const conn = activeSshConnections.get(connId)
    const sftp = sshSftpSessions.get(connId)
    if (sftp) {
      sftp.end()
      sshSftpSessions.delete(connId)
    }
    if (conn) {
      conn.end()
      activeSshConnections.delete(connId)
    }
    return true
  })

  ipcMain.handle("ssh:execute", async (_event, connId, command) => {
    const conn = activeSshConnections.get(connId)
    if (!conn) throw new Error("SSH connection not found")

    return new Promise((resolve, reject) => {
      conn.exec(command, (err, stream) => {
        if (err) return reject(new Error(err.message))

        let stdout = ""
        let stderr = ""

        stream.on("data", (data) => { stdout += data.toString() })
        stream.stderr.on("data", (data) => { stderr += data.toString() })
        stream.on("close", (code) => {
          resolve({ exitCode: code ?? 0, stdout, stderr })
        })
      })
    })
  })

  ipcMain.handle("ssh:readFile", async (_event, connId, filePath) => {
    const sftp = sshSftpSessions.get(connId)
    if (!sftp) throw new Error("SFTP session not found")

    validatePath(filePath)

    return new Promise((resolve, reject) => {
      sftp.readFile(filePath, (err, buf) => {
        if (err) return reject(new Error(`Read failed: ${err.message}`))
        resolve(buf.toString("utf-8"))
      })
    })
  })

  ipcMain.handle("ssh:writeFile", async (_event, connId, filePath, content) => {
    const sftp = sshSftpSessions.get(connId)
    if (!sftp) throw new Error("SFTP session not found")

    validatePath(filePath)

    return new Promise((resolve, reject) => {
      const writeStream = sftp.createWriteStream(filePath)
      writeStream.on("error", (err) => reject(new Error(`Write failed: ${err.message}`)))
      writeStream.on("close", () => resolve(true))
      writeStream.end(Buffer.from(content, "utf-8"))
    })
  })

  ipcMain.handle("ssh:listDir", async (_event, connId, dirPath) => {
    const sftp = sshSftpSessions.get(connId)
    if (!sftp) throw new Error("SFTP session not found")

    validatePath(dirPath)

    return new Promise((resolve, reject) => {
      sftp.readdir(dirPath, (err, list) => {
        if (err) return reject(new Error(`List dir failed: ${err.message}`))

        const entries = list.map((item) => ({
          name: item.filename,
          path: dirPath.endsWith("/") ? `${dirPath}${item.filename}` : `${dirPath}/${item.filename}`,
          isDirectory: (item.attrs.isFile() === false),
          isFile: item.attrs.isFile() === true,
          size: item.attrs.size || 0,
        }))
        resolve(entries)
      })
    })
  })

  ipcMain.handle("ssh:stat", async (_event, connId, filePath) => {
    const sftp = sshSftpSessions.get(connId)
    if (!sftp) throw new Error("SFTP session not found")

    validatePath(filePath)

    return new Promise((resolve) => {
      sftp.stat(filePath, (err, stats) => {
        if (err) {
          resolve({ exists: false, isDirectory: false, isFile: false, size: 0, mtimeMs: 0 })
          return
        }
        const isDirectory = stats.isDirectory()
        resolve({
          exists: true,
          isDirectory,
          isFile: !isDirectory,
          size: stats.size || 0,
          mtimeMs: (stats.mtime || 0) * 1000,
        })
      })
    })
  })

  ipcMain.handle("ssh:startFileWatcher", async (_event, { connectionId, remotePath }) => {
    const conn = activeSshConnections.get(connectionId)
    if (!conn) throw new Error("SSH connection not found")

    validatePath(remotePath)

    if (sshFileWatchers.has(connectionId)) {
      stopSshFileWatcher(connectionId)
    }

    const watcherState = { mode: null, stream: null, intervalId: null }
    sshFileWatchers.set(connectionId, watcherState)

    const hasInotify = await checkInotifyAvailable(conn)

    if (hasInotify) {
      watcherState.mode = "inotify"
      startInotifyWatcher(connectionId, conn, remotePath, watcherState)
    } else {
      startPollingWatcher(connectionId, conn, remotePath, watcherState)
    }

    return { connectionId, remotePath, mode: watcherState.mode }
  })

  ipcMain.handle("ssh:stopFileWatcher", async (_event, { connectionId }) => {
    stopSshFileWatcher(connectionId)
    return true
  })
}

function setupWslIPC() {
  ipcMain.handle("wsl:list", async () => {
    if (!isWindows) return []

    const result = await runShellCommand("wsl.exe -l -v", HOME, 10000)
    if (result.exitCode !== 0) return []

    const lines = result.stdout
      .replace(/\x00/g, "")
      .split(/\r?\n/)
      .filter((line) => line.trim())

    const distributions = []
    for (const line of lines.slice(1)) {
      const match = line.match(/^\s*\*?\s*(\S+)\s+(\S+)\s+(\d+)/)
      if (!match) continue

      distributions.push({
        name: match[1],
        state: match[2] === "Running" ? "Running" : "Stopped",
        version: Number(match[3]) || 2,
        isDefault: line.includes("*"),
      })
    }
    return distributions
  })

  ipcMain.handle("wsl:connect", async (_event, distribution) => {
    if (!isWindows) {
      return { distribution, connected: false, error: "WSL is only available on Windows" }
    }

    const WSL_CONNECT_TIMEOUT_MS = 5000
    const result = await runShellCommand(
      `wsl.exe -d ${distribution} -- echo ok`,
      HOME,
      WSL_CONNECT_TIMEOUT_MS,
    )

    if (result.exitCode === 0) {
      return { distribution, connected: true }
    }

    return { distribution, connected: false, error: "Distribution not available" }
  })

  ipcMain.handle("wsl:execute", async (_event, distribution, command) => {
    if (!isWindows) {
      throw new Error("WSL is only available on Windows")
    }
    validatePath(distribution)

    return new Promise((resolve) => {
      const proc = spawn("wsl.exe", ["-d", distribution, "--", "bash"], {
        cwd: HOME,
        timeout: SSH_CMD_TIMEOUT_MS,
        stdio: ["pipe", "pipe", "pipe"],
      })

      let stdout = ""
      let stderr = ""

      proc.stdout.on("data", (data) => { stdout += data.toString() })
      proc.stderr.on("data", (data) => { stderr += data.toString() })

      proc.on("close", (code) => {
        resolve({ exitCode: code, stdout: stdout.slice(0, 50000), stderr: stderr.slice(0, 10000) })
      })

      proc.on("error", (err) => {
        resolve({ exitCode: -1, stderr: err.message })
      })

      proc.stdin.write(command)
      proc.stdin.end()
    })
  })

  ipcMain.handle("wsl:readFile", async (_event, distribution, filePath) => {
    if (!isWindows) throw new Error("WSL is only available on Windows")
    const wslCmd = `wsl.exe -d ${distribution} -- cat "${filePath}"`
    const result = await runShellCommand(wslCmd, HOME, SSH_CMD_TIMEOUT_MS)
    if (result.exitCode !== 0) throw new Error(`Read failed: ${result.stderr}`)
    return result.stdout
  })

  ipcMain.handle("wsl:writeFile", async (_event, distribution, filePath, content) => {
    if (!isWindows) throw new Error("WSL is only available on Windows")
    const escapedContent = content.replace(/'/g, "'\\''")
    const wslCmd = `wsl.exe -d ${distribution} -- bash -c "echo -n '${escapedContent}' > '${filePath}'"`
    const result = await runShellCommand(wslCmd, HOME, SSH_CMD_TIMEOUT_MS)
    return result.exitCode === 0
  })

  ipcMain.handle("wsl:listDir", async (_event, distribution, dirPath) => {
    if (!isWindows) throw new Error("WSL is only available on Windows")
    const wslCmd = `wsl.exe -d ${distribution} -- ls -la "${dirPath}"`
    const result = await runShellCommand(wslCmd, HOME, SSH_CMD_TIMEOUT_MS)

    if (result.exitCode !== 0) return []

    const entries = []
    for (const line of result.stdout.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 9) continue

      const name = parts.slice(8).join(" ")
      if (name === "." || name === "..") continue

      const isDirectory = parts[0].startsWith("d")
      entries.push({
        name,
        path: dirPath.endsWith("/") ? `${dirPath}${name}` : `${dirPath}/${name}`,
        isDirectory,
        isFile: !isDirectory,
        size: Number(parts[4]) || 0,
      })
    }
    return entries
  })
}

const DOCKER_CHECK_TIMEOUT_MS = 10000
const DOCKER_NOT_RUNNING_ERROR = "Docker is not running. Please start Docker Desktop and try again."

async function checkDockerAvailable() {
  const result = await runShellCommand(
    'docker info --format "{{.ServerVersion}}"',
    HOME,
    DOCKER_CHECK_TIMEOUT_MS,
  )

  if (result.exitCode === 0) {
    const version = result.stdout.trim()
    return { available: true, version }
  }

  return { available: false, error: result.stderr.trim() || "Docker is not running" }
}

function setupDockerIPC() {
  ipcMain.handle("docker:listContainers", async (_event, all) => {
    const dockerCheck = await checkDockerAvailable()
    if (!dockerCheck.available) {
      return { error: DOCKER_NOT_RUNNING_ERROR }
    }
    const flag = all ? "-a" : ""
    const result = await runShellCommand(
      `docker ps ${flag} --format "{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}\\t{{.CreatedAt}}"`,
      HOME,
      15000,
    )
    if (result.exitCode !== 0) throw new Error(`Docker error: ${result.stderr}`)

    return result.stdout
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const [id, name, image, status, ports, created] = line.split("\t")
        const statusLower = (status || "").toLowerCase()
        let containerStatus = "exited"
        if (statusLower.includes("up")) containerStatus = "running"
        else if (statusLower.includes("paused")) containerStatus = "paused"
        else if (statusLower.includes("restarting")) containerStatus = "restarting"
        else if (statusLower.includes("created")) containerStatus = "created"
        else if (statusLower.includes("removing")) containerStatus = "removing"
        else if (statusLower.includes("dead")) containerStatus = "dead"

        return {
          id: id || "",
          name: name || "",
          image: image || "",
          status: containerStatus,
          ports: ports || "",
          created: created || "",
        }
      })
  })

  ipcMain.handle("docker:listImages", async () => {
    const dockerCheck = await checkDockerAvailable()
    if (!dockerCheck.available) {
      return { error: DOCKER_NOT_RUNNING_ERROR }
    }
    const result = await runShellCommand(
      `docker images --format "{{.ID}}\\t{{.Repository}}\\t{{.Tag}}\\t{{.Size}}\\t{{.CreatedAt}}"`,
      HOME,
      15000,
    )
    if (result.exitCode !== 0) throw new Error(`Docker error: ${result.stderr}`)

    return result.stdout
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const [id, repository, tag, size, created] = line.split("\t")
        const sizeMatch = (size || "").match(/([\d.]+)\s*(KB|MB|GB|B)/i)
        let sizeBytes = 0
        if (sizeMatch) {
          const value = Number(sizeMatch[1]) || 0
          const unit = sizeMatch[2].toUpperCase()
          if (unit === "B") sizeBytes = value
          else if (unit === "KB") sizeBytes = value * 1024
          else if (unit === "MB") sizeBytes = value * 1024 * 1024
          else if (unit === "GB") sizeBytes = value * 1024 * 1024 * 1024
        }

        return {
          id: id || "",
          repository: repository || "",
          tag: tag || "",
          size: sizeBytes,
          created: created || "",
        }
      })
  })

  ipcMain.handle("docker:startContainer", async (_event, id) => {
    const dockerCheck = await checkDockerAvailable()
    if (!dockerCheck.available) {
      return { error: DOCKER_NOT_RUNNING_ERROR }
    }
    const result = await runShellCommand(`docker start ${id}`, HOME, 30000)
    return result.exitCode === 0
  })

  ipcMain.handle("docker:stopContainer", async (_event, id) => {
    const dockerCheck = await checkDockerAvailable()
    if (!dockerCheck.available) {
      return { error: DOCKER_NOT_RUNNING_ERROR }
    }
    const result = await runShellCommand(`docker stop ${id}`, HOME, 30000)
    return result.exitCode === 0
  })

  ipcMain.handle("docker:restartContainer", async (_event, id) => {
    const dockerCheck = await checkDockerAvailable()
    if (!dockerCheck.available) {
      return { error: DOCKER_NOT_RUNNING_ERROR }
    }
    const result = await runShellCommand(`docker restart ${id}`, HOME, 60000)
    return result.exitCode === 0
  })

  ipcMain.handle("docker:removeContainer", async (_event, id) => {
    const dockerCheck = await checkDockerAvailable()
    if (!dockerCheck.available) {
      return { error: DOCKER_NOT_RUNNING_ERROR }
    }
    const result = await runShellCommand(`docker rm -f ${id}`, HOME, 30000)
    return result.exitCode === 0
  })

  ipcMain.handle("docker:containerLogs", async (_event, id, tail) => {
    const dockerCheck = await checkDockerAvailable()
    if (!dockerCheck.available) {
      return { error: DOCKER_NOT_RUNNING_ERROR }
    }
    const tailCount = tail || 100
    const result = await runShellCommand(
      `docker logs --tail ${tailCount} ${id}`,
      HOME,
      15000,
    )
    if (result.exitCode !== 0) throw new Error(`Docker logs error: ${result.stderr}`)
    return result.stdout + result.stderr
  })

  ipcMain.handle("docker:execInContainer", async (_event, id, command) => {
    const dockerCheck = await checkDockerAvailable()
    if (!dockerCheck.available) {
      return { error: DOCKER_NOT_RUNNING_ERROR }
    }
    validateContainerId(id)

    return new Promise((resolve) => {
      const proc = spawn("docker", ["exec", "-i", id, "bash"], {
        cwd: HOME,
        timeout: SSH_CMD_TIMEOUT_MS,
        stdio: ["pipe", "pipe", "pipe"],
      })

      let stdout = ""
      let stderr = ""

      proc.stdout.on("data", (data) => { stdout += data.toString() })
      proc.stderr.on("data", (data) => { stderr += data.toString() })

      proc.on("close", (code) => {
        resolve({
          exitCode: code,
          stdout: stdout.slice(0, 50000),
          stderr: stderr.slice(0, 10000),
        })
      })

      proc.on("error", (err) => {
        resolve({ exitCode: -1, stderr: err.message })
      })

      proc.stdin.write(command)
      proc.stdin.end()
    })
  })

  ipcMain.handle("docker:composeUp", async (_event, composePath) => {
    const dockerCheck = await checkDockerAvailable()
    if (!dockerCheck.available) {
      return { error: DOCKER_NOT_RUNNING_ERROR }
    }
    const dir = path.dirname(composePath)
    const file = path.basename(composePath)
    const result = await runShellCommand(
      `docker compose -f "${file}" up -d`,
      dir,
      120000,
    )
    return result.exitCode === 0
  })

  ipcMain.handle("docker:composeDown", async (_event, composePath) => {
    const dockerCheck = await checkDockerAvailable()
    if (!dockerCheck.available) {
      return { error: DOCKER_NOT_RUNNING_ERROR }
    }
    const dir = path.dirname(composePath)
    const file = path.basename(composePath)
    const result = await runShellCommand(
      `docker compose -f "${file}" down`,
      dir,
      120000,
    )
    return result.exitCode === 0
  })

  ipcMain.handle("docker:composePs", async (_event, composePath) => {
    const dockerCheck = await checkDockerAvailable()
    if (!dockerCheck.available) {
      return { error: DOCKER_NOT_RUNNING_ERROR }
    }
    const dir = path.dirname(composePath)
    const file = path.basename(composePath)
    const result = await runShellCommand(
      `docker compose -f "${file}" ps --format "{{.Name}}\\t{{.Image}}\\t{{.State}}\\t{{.Ports}}"`,
      dir,
      15000,
    )
    if (result.exitCode !== 0) return []

    return result.stdout
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const [name, image, state, ports] = line.split("\t")
        return {
          name: name || "",
          image: image || "",
          state: state || "",
          ports: ports || "",
        }
      })
  })

  ipcMain.handle("docker:parseDockerfile", async (_event, filePath) => {
    const dockerCheck = await checkDockerAvailable()
    if (!dockerCheck.available) {
      return { error: DOCKER_NOT_RUNNING_ERROR }
    }
    try {
      const content = fs.readFileSync(filePath, "utf-8")
      const instructions = []
      const lines = content.split("\n")

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i].trim()
        if (!line || line.startsWith("#")) continue

        const match = line.match(/^(FROM|RUN|CMD|LABEL|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\s+(.*)/i)
        if (match) {
          instructions.push({
            instruction: match[1].toUpperCase(),
            arguments: match[2],
            line: i + 1,
          })
        }
      }
      return instructions
    } catch (err) {
      throw new Error(`Cannot parse Dockerfile: ${err.message}`)
    }
  })

  ipcMain.handle("docker:checkAvailable", async () => {
    return checkDockerAvailable()
  })
}

function createProtocolParser(onMessage) {
  let buffer = Buffer.alloc(0)

  return (data) => {
    buffer = Buffer.concat([buffer, data])

    while (buffer.length > 0) {
      const headerEnd = buffer.indexOf("\r\n\r\n")
      if (headerEnd === -1) break

      const headerStr = buffer.slice(0, headerEnd).toString("utf-8")
      const match = headerStr.match(/Content-Length:\s*(\d+)/i)
      if (!match) {
        buffer = buffer.slice(headerEnd + 4)
        continue
      }

      const contentLength = parseInt(match[1], 10)
      const messageStart = headerEnd + 4
      const messageEnd = messageStart + contentLength

      if (buffer.length < messageEnd) break

      const messageContent = buffer.slice(messageStart, messageEnd).toString("utf-8")
      buffer = buffer.slice(messageEnd)

      onMessage(messageContent)
    }
  }
}

function formatProtocolMessage(message) {
  const content = typeof message === "string" ? message : JSON.stringify(message)
  const header = `Content-Length: ${Buffer.byteLength(content, "utf-8")}\r\n\r\n`
  return header + content
}

function setupLspIPC() {
  ipcMain.handle("lsp:start", async (_event, serverId, config) => {
    if (lspProcesses.has(serverId)) {
      throw new Error(`LSP server ${serverId} already running`)
    }

    const proc = spawn(config.command, config.args || [], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: config.cwd || HOME,
    })

    lspProcesses.set(serverId, { process: proc })

    const parser = createProtocolParser((message) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("lsp:message", { serverId, message })
      }
    })

    proc.stdout.on("data", parser)

    proc.stderr.on("data", (data) => {
      log(`[lsp:${serverId}] stderr: ${data.toString().trim()}`)
    })

    proc.on("exit", (code) => {
      log(`[lsp:${serverId}] exited with code ${code}`)
      lspProcesses.delete(serverId)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("lsp:message", {
          serverId,
          message: JSON.stringify({ jsonrpc: "2.0", method: "exit", params: { code } }),
        })
      }
    })

    proc.on("error", (err) => {
      log(`[lsp:${serverId}] error: ${err.message}`)
      lspProcesses.delete(serverId)
    })

    return { serverId, pid: proc.pid }
  })

  ipcMain.handle("lsp:stop", async (_event, serverId) => {
    const entry = lspProcesses.get(serverId)
    if (!entry) return true

    const { process: proc } = entry

    try {
      const shutdownMsg = formatProtocolMessage(
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "shutdown", params: null }),
      )
      proc.stdin.write(shutdownMsg)

      const exitMsg = formatProtocolMessage(
        JSON.stringify({ jsonrpc: "2.0", method: "exit", params: null }),
      )
      proc.stdin.write(exitMsg)
    } catch {
      // stdin might already be closed
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        try {
          proc.kill("SIGKILL")
        } catch {
          // process might already be dead
        }
        lspProcesses.delete(serverId)
        resolve(true)
      }, LSP_SHUTDOWN_TIMEOUT_MS)

      proc.on("exit", () => {
        clearTimeout(timeout)
        lspProcesses.delete(serverId)
        resolve(true)
      })
    })
  })

  ipcMain.handle("lsp:send", async (_event, serverId, message) => {
    const entry = lspProcesses.get(serverId)
    if (!entry) throw new Error(`LSP server ${serverId} not found`)

    const formatted = formatProtocolMessage(message)
    entry.process.stdin.write(formatted)
    return true
  })
}

function setupDapIPC() {
  ipcMain.handle("dap:start", async (_event, adapterType, config) => {
    const sessionId = `dap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const launchConfig = config || {}

    let command = launchConfig.command
    let args = launchConfig.args || []

    if (!command) {
      const debugHealth = require("./services/debug/adapterHealth")
      const resolved = debugHealth.resolveAdapter(adapterType, launchConfig, {
        jsDebugPath: getResourcePath(path.join("js-debug", "src", "debugServer.js")),
      })
      if (!resolved.available) {
        throw new Error(resolved.message)
      }
      command = resolved.command
      args = resolved.args
    }

    const cwd = launchConfig.cwd || currentProjectRoot || HOME
    const trustDecision = evaluateCommandExecution(cwd, [command, ...(Array.isArray(args) ? args : [])].join(" "), {
      action: "启动调试适配器",
      confirmed: launchConfig.confirmed === true,
    })
    if (!trustDecision.allowed) {
      throw new Error(trustDecision.message)
    }

    const proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
    })

    dapProcesses.set(sessionId, { process: proc, adapterType })
    latestDapBridgeEvidence = {
      source: "MainThreadDebugService.dapIpcBridge",
      sessionIdPrefix: sessionId.slice(0, 4),
      sessionIdLength: sessionId.length,
      adapterType: String(adapterType || ""),
      commandCount: 0,
      commands: [],
      eventCount: 0,
      events: [],
      capabilityKeys: [],
      redaction: {
        noExpressionText: true,
        noSourcePathText: true,
        noAdapterArgsText: true,
      },
      process: {
        pidAvailable: typeof proc.pid === "number",
        started: true,
        exited: false,
      },
    }

    const parser = createProtocolParser((message) => {
      try {
        const parsed = JSON.parse(message)
        if (latestDapBridgeEvidence && latestDapBridgeEvidence.sessionIdPrefix === sessionId.slice(0, 4)) {
          if (parsed?.type === "event") {
            latestDapBridgeEvidence.eventCount += 1
            if (typeof parsed.event === "string" && !latestDapBridgeEvidence.events.includes(parsed.event)) {
              latestDapBridgeEvidence.events.push(parsed.event)
            }
          }
          if (parsed?.type === "response" && parsed.command === "initialize" && parsed.body && typeof parsed.body === "object") {
            latestDapBridgeEvidence.capabilityKeys = Object.keys(parsed.body).sort()
          }
        }
      } catch {
        // smoke metadata only; raw protocol payload is intentionally not retained
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("dap:event", { sessionId, message })
      }
    })

    proc.stdout.on("data", parser)

    proc.stderr.on("data", (data) => {
      log(`[dap:${sessionId}] stderr: ${data.toString().trim()}`)
    })

    proc.on("exit", (code) => {
      log(`[dap:${sessionId}] exited with code ${code}`)
      dapProcesses.delete(sessionId)
      if (latestDapBridgeEvidence && latestDapBridgeEvidence.sessionIdPrefix === sessionId.slice(0, 4)) {
        latestDapBridgeEvidence.process = {
          ...(latestDapBridgeEvidence.process || {}),
          exited: true,
          exitCodeType: typeof code,
        }
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("dap:event", {
          sessionId,
          message: JSON.stringify({ type: "event", event: "exited", body: { exitCode: code } }),
        })
      }
    })

    proc.on("error", (err) => {
      log(`[dap:${sessionId}] error: ${err.message}`)
      dapProcesses.delete(sessionId)
    })

    return { sessionId, pid: proc.pid, adapterType }
  })

  ipcMain.handle("dap:stop", async (_event, sessionId) => {
    const entry = dapProcesses.get(sessionId)
    if (!entry) return true

    const { process: proc } = entry

    try {
      const disconnectMsg = formatProtocolMessage(
        JSON.stringify({ seq: 1, type: "request", command: "disconnect", arguments: { restart: false } }),
      )
      proc.stdin.write(disconnectMsg)
    } catch {
      // stdin might already be closed
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        try {
          proc.kill("SIGKILL")
        } catch {
          // process might already be dead
        }
        dapProcesses.delete(sessionId)
        resolve(true)
      }, DAP_DISCONNECT_TIMEOUT_MS)

      proc.on("exit", () => {
        clearTimeout(timeout)
        dapProcesses.delete(sessionId)
        resolve(true)
      })
    })
  })

  ipcMain.handle("dap:send", async (_event, sessionId, message) => {
    const entry = dapProcesses.get(sessionId)
    if (!entry) throw new Error(`DAP session ${sessionId} not found`)

    try {
      const parsed = JSON.parse(message)
      if (latestDapBridgeEvidence && latestDapBridgeEvidence.sessionIdPrefix === String(sessionId || "").slice(0, 4)) {
        latestDapBridgeEvidence.commandCount += 1
        if (typeof parsed?.command === "string" && !latestDapBridgeEvidence.commands.includes(parsed.command)) {
          latestDapBridgeEvidence.commands.push(parsed.command)
        }
      }
    } catch {
      // smoke metadata only; raw request payload is intentionally not retained
    }
    const formatted = formatProtocolMessage(message)
    entry.process.stdin.write(formatted)
    return true
  })
}

app.whenReady().then(async () => {
  writeElectronSmokeStage("when-ready", { isPackaged: app.isPackaged, resourcesPath: process.resourcesPath })
  ensureDirectories()
  registerExtensionResourceProtocol()
  writeElectronSmokeStage("directories-ready", { codekData: CODEK_DATA })
  log("Codek starting...")

  setupIPC()
  writeElectronSmokeStage("ipc-ready")

  if (!isSmoke) {
    setupAutoUpdater()
  }

  await createMainWindow()
  writeElectronSmokeStage("main-window-created")
  log("Codek window ready.")
  scheduleServiceRegistration(20_000)
  if (!isSmoke) {
    setTimeout(() => {
      startOllama()
        .then((ollamaOk) => {
          if (!ollamaOk) {
            log("Ollama not available - cloud LLM providers will be used by default.")
          }
        })
        .catch(() => {
          log("Ollama not available - cloud LLM providers will be used by default.")
        })
    }, 25_000)
  }

  log("Codek window ready while services continue starting.")
})

let isQuitting = false
let nativeQuitApproved = false
let _scheduler = null
let _tray = null
try {
  _scheduler = require("./services/goalScheduler").getScheduler()
  if (isSmoke) {
    writeElectronSmokeStage("scheduler-initialized-for-smoke")
  } else {
    const notifications = require("./services/notifications")
    _scheduler.on("workerEvent", (ev) => {
      if (ev.type === "done") notifications.notifyGoalDone({ id: ev.goalId, summary: ev.summary || "" })
      if (ev.type === "error") notifications.notifyGoalFailed({ id: ev.goalId, error: ev.error || "" })
      if (mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.webContents.send("goal:event", ev) } catch {}
      }
    })
    _scheduler.resumeFromDb()
  }
} catch (err) {
  console.warn("[main] scheduler init failed:", err && err.message)
}

// Auto-restart guard (PLAN_C §V risk mitigation): trigger relaunch every 24h
// or after 1h of scheduler idle, to avoid main-process memory creep.
const AUTO_RESTART_MAX_MS = 24 * 60 * 60 * 1000
const AUTO_RESTART_IDLE_MS = 60 * 60 * 1000
const _processStart = Date.now()
let _lastBusyAt = Date.now()
function _autoRestartTick() {
  try {
    if (isQuitting) return
    const running = _scheduler && _scheduler.hasRunningGoals && _scheduler.hasRunningGoals()
    if (running) { _lastBusyAt = Date.now(); return }
    const uptime = Date.now() - _processStart
    const idle = Date.now() - _lastBusyAt
    if (uptime >= AUTO_RESTART_MAX_MS || idle >= AUTO_RESTART_IDLE_MS) {
      try { app.relaunch() } catch {}
      isQuitting = true
      app.exit(0)
    }
  } catch {}
}
const _autoRestartTimer = setInterval(_autoRestartTick, 5 * 60 * 1000)
if (typeof _autoRestartTimer.unref === "function") _autoRestartTimer.unref()

app.on("window-all-closed", (e) => {
  const lifecycle = shouldKeepAliveOnWindowClosed({
    isQuitting,
    isMac,
    hasRunningGoals: !!(_scheduler && _scheduler.hasRunningGoals()),
  })

  if (lifecycle.keepAlive) {
    if (e && typeof e.preventDefault === "function") e.preventDefault()
    if (lifecycle.hideWindow && mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
    try {
      if (!_tray) {
        const tray = require("./tray")
        _tray = tray.init({
          scheduler: _scheduler,
          mainWindow,
          quit: () => {
            isQuitting = true
            void (async () => {
              const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())
              for (const win of windows) {
                const allowed = await requestNativeWindowClose(win, { source: "tray-quit" })
                if (!allowed) {
                  isQuitting = false
                  nativeQuitApproved = false
                  return
                }
              }
              nativeQuitApproved = true
              app.quit()
            })()
          },
        })
      }
      const notifications = require("./services/notifications")
      notifications.setMainWindow(mainWindow)
    } catch {}
    return
  }
  if (lifecycle.quit) {
    nativeQuitApproved = true
    app.quit()
  }
})

app.on("before-quit", (event) => {
  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())
  if (!nativeQuitApproved && windows.length === 0) nativeQuitApproved = true
  const hasUnapprovedWindow = windows.some((win) => !nativeCloseAllowedWindows.has(win))
  if (!nativeQuitApproved && hasUnapprovedWindow) {
    if (event && typeof event.preventDefault === "function") event.preventDefault()
    void (async () => {
      isQuitting = true
      for (const win of windows) {
        const allowed = await requestNativeWindowClose(win, { source: "app-before-quit" })
        if (!allowed) {
          isQuitting = false
          nativeQuitApproved = false
          return
        }
      }
      nativeQuitApproved = true
      app.quit()
    })()
    return
  }
  isQuitting = true
  log("Shutting down...")

  stopFileWatcher()

  try {
    require("./services/search").disposeSearchServices()
  } catch (error) {
    log(`Search service shutdown warning: ${error?.message || error}`)
  }

  ptyManager.disposeAll()

  for (const connectionId of sshFileWatchers.keys()) {
    stopSshFileWatcher(connectionId)
  }

  for (const [serverId, entry] of lspProcesses) {
    log(`Stopping LSP server: ${serverId}`)
    try {
      entry.process.kill("SIGKILL")
    } catch {
      // process might already be dead
    }
  }
  lspProcesses.clear()

  for (const [sessionId, entry] of dapProcesses) {
    log(`Stopping DAP session: ${sessionId}`)
    try {
      entry.process.kill("SIGKILL")
    } catch {
      // process might already be dead
    }
  }
  dapProcesses.clear()

  for (const [processId, entry] of mcpProcesses) {
    log(`Stopping MCP process: ${processId}`)
    try {
      entry.process.kill("SIGKILL")
    } catch {
      // process might already be dead
    }
  }
  mcpProcesses.clear()

  log("Codek stopped.")
})

app.on("activate", () => {
  if (!mainWindow && BrowserWindow.getAllWindows().length === 0) {
    createMainWindow()
  }
})
