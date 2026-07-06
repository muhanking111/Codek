const { contextBridge, ipcRenderer } = require("electron")
const fs = require("fs")
const path = require("path")

const isSmoke = process.env.CODEK_ELECTRON_SMOKE === "1"
const BINARY_EDITOR_BLOCKED_EXTENSIONS = new Set([
  ".7z",
  ".asar",
  ".bin",
  ".bmp",
  ".br",
  ".class",
  ".dat",
  ".dll",
  ".dylib",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpg",
  ".jpeg",
  ".node",
  ".otf",
  ".pak",
  ".pdf",
  ".png",
  ".rar",
  ".so",
  ".tar",
  ".ttf",
  ".wasm",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
])

function reportPreloadSmokeStage(stage, detail = {}) {
  if (!isSmoke) return
  try {
    console.info("[codek-smoke-preload-stage]", JSON.stringify({ stage, at: Date.now(), detail }))
  } catch {
    // smoke diagnostics only
  }
}

function isPathInside(rootPath, targetPath) {
  if (!rootPath || !targetPath) return false
  const root = path.resolve(String(rootPath))
  const target = path.resolve(String(targetPath))
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function isBinaryEditorBlockedPath(filePath) {
  return BINARY_EDITOR_BLOCKED_EXTENSIONS.has(path.extname(String(filePath || "")).toLowerCase())
}

function buildBinaryEditorBlockedResult(requestedPath, size = 0) {
  return {
    error: "BINARY_FILE",
    size: Math.max(0, Number(size || 0)),
    path: requestedPath,
  }
}

async function readLocalWorkspaceTextChunk(filePath, options = {}) {
  const roots = Array.isArray(options.workspaceRoots) && options.workspaceRoots.length
    ? options.workspaceRoots
    : (options.projectRoot ? [options.projectRoot] : [])
  const resolved = path.resolve(String(filePath || ""))
  if (!roots.some((root) => isPathInside(root, resolved))) {
    reportPreloadSmokeStage("read-text-chunk:fallback-ipc", { filePath, resolved, roots })
    return ipcRenderer.invoke("fs:readFileTextChunk", filePath, options)
  }

  const requestedLength = Math.max(1, Number(options.length || options.previewBytes || options.maxBytes || 512 * 1024))
  const knownSize = Math.max(0, Number(options.fileSize || options.size || 0))
  if (isBinaryEditorBlockedPath(filePath) || isBinaryEditorBlockedPath(resolved)) {
    reportPreloadSmokeStage("read-text-chunk:binary-blocked", { filePath, resolved, size: knownSize })
    return buildBinaryEditorBlockedResult(filePath, knownSize)
  }
  const previewBytes = knownSize > 0
    ? Math.min(requestedLength, knownSize)
    : requestedLength
  const offset = Math.max(0, knownSize > 0
    ? Math.min(Number(options.offset || 0), Math.max(0, knownSize - previewBytes))
    : Number(options.offset || 0))
  const fd = fs.openSync(resolved, "r")
  try {
    const buffer = Buffer.allocUnsafe(previewBytes)
    const bytesRead = fs.readSync(fd, buffer, 0, previewBytes, offset)
    const size = knownSize || Math.max(0, offset + bytesRead)
    const result = {
      content: buffer.subarray(0, bytesRead).toString("utf-8"),
      size,
      bytesRead,
      limit: Number(options.maxBytes || requestedLength),
      previewBytes,
      offset,
      truncated: knownSize > 0 ? offset + bytesRead < knownSize : bytesRead >= previewBytes,
      path: filePath,
    }
    return result
  } finally {
    fs.closeSync(fd)
  }
}

async function invokeApiRequest(method, requestPath, body, headers, options) {
  const startedAt = Date.now()
  reportPreloadSmokeStage("api-request:start", { method, path: requestPath })
  try {
    const result = await ipcRenderer.invoke("api:request", { method, path: requestPath, body, headers, options })
    reportPreloadSmokeStage("api-request:done", {
      method,
      path: requestPath,
      durationMs: Date.now() - startedAt,
      resultType: typeof result,
      ok: result?.ok,
      status: result?.status,
      hasData: Boolean(result?.data),
      success: result?.success,
    })
    return result
  } catch (error) {
    reportPreloadSmokeStage("api-request:error", {
      method,
      path: requestPath,
      durationMs: Date.now() - startedAt,
      error: String(error?.message || error),
    })
    throw error
  }
}

function normalizeSearchResponse(result) {
  if (result && typeof result === "object" && "ok" in result && "data" in result) {
    return result
  }
  return {
    ok: true,
    status: 200,
    data: result,
  }
}

function cloneSearchRequestForIpc(request) {
  if (!request || typeof request !== "object") return {}
  try {
    return JSON.parse(JSON.stringify(request))
  } catch {
    return {}
  }
}

async function invokeSearchFiles(request) {
  const startedAt = Date.now()
  const body = cloneSearchRequestForIpc(request)
  reportPreloadSmokeStage("search-files:start", {
    root: body?.root,
    queryLength: String(body?.query || "").length,
    maxResults: body?.maxResults,
  })
  try {
    const result = await requestSearchFiles(body)
    reportPreloadSmokeStage("search-files:done", {
      durationMs: Date.now() - startedAt,
      resultType: typeof result,
      ok: result?.ok,
      success: result?.success,
      hasData: Boolean(result?.data),
      matchCount: Array.isArray(result?.data?.matches)
        ? result.data.matches.length
        : (Array.isArray(result?.matches) ? result.matches.length : null),
    })
    return result
  } catch (error) {
    reportPreloadSmokeStage("search-files:error", {
      durationMs: Date.now() - startedAt,
      error: String(error?.message || error),
    })
    throw error
  }
}

function requestSearchFiles(request, options = {}) {
  const body = cloneSearchRequestForIpc(request)
  const requestId = `search_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  return new Promise((resolve, reject) => {
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null
    const timer = setTimeout(() => {
      cleanup()
      ipcRenderer.send("search:files:cancel", { requestId })
      reportPreloadSmokeStage("search-files:cancel", { requestId, reason: "timeout" })
      reject(new Error("search:files request timed out"))
    }, 8000)
    const cleanup = () => {
      clearTimeout(timer)
      ipcRenderer.removeListener("search:files:result", handler)
      ipcRenderer.removeListener("search:files:progress", progressHandler)
    }
    const handler = (_event, payload) => {
      if (!payload || payload.requestId !== requestId) return
      cleanup()
      if (payload.error) {
        reject(new Error(String(payload.error)))
        return
      }
      resolve(payload.result)
    }
    const progressHandler = (_event, payload) => {
      if (!payload || payload.requestId !== requestId || !onProgress) return
      onProgress(payload.progress)
    }
    ipcRenderer.on("search:files:result", handler)
    ipcRenderer.on("search:files:progress", progressHandler)
    reportPreloadSmokeStage("search-files:send", {
      requestId,
      root: body?.root,
      queryLength: String(body?.query || "").length,
    })
    ipcRenderer.send("search:files:request", { requestId, body })
    reportPreloadSmokeStage("search-files:sent", { requestId })
  })
}

function startSearchFiles(request, options = {}) {
  const body = cloneSearchRequestForIpc(request)
  const requestId = `search_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 30000))
  let settled = false
  let cleanup = () => {}
  let cancelSearch = () => {}
  const promise = new Promise((resolve, reject) => {
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      cleanup()
      fn(value)
    }
    const timer = setTimeout(() => {
      ipcRenderer.send("search:files:cancel", { requestId })
      reportPreloadSmokeStage("search-files:cancel", { requestId, reason: "timeout" })
      finish(reject, new Error("search:files request timed out"))
    }, timeoutMs)
    const resultHandler = (_event, payload) => {
      if (!payload || payload.requestId !== requestId) return
      if (payload.error) {
        finish(reject, new Error(String(payload.error)))
        return
      }
      finish(resolve, normalizeSearchResponse(payload.result))
    }
    const progressHandler = (_event, payload) => {
      if (!payload || payload.requestId !== requestId || !onProgress) return
      onProgress(payload.progress)
    }
    cancelSearch = () => {
      const error = new Error("Search cancelled")
      error.name = "AbortError"
      finish(reject, error)
    }
    cleanup = () => {
      clearTimeout(timer)
      ipcRenderer.removeListener("search:files:result", resultHandler)
      ipcRenderer.removeListener("search:files:progress", progressHandler)
    }
    ipcRenderer.on("search:files:result", resultHandler)
    ipcRenderer.on("search:files:progress", progressHandler)
    reportPreloadSmokeStage("search-files:send", {
      requestId,
      root: body?.root,
      queryLength: String(body?.query || "").length,
    })
    ipcRenderer.send("search:files:request", { requestId, body })
    reportPreloadSmokeStage("search-files:sent", { requestId })
  })

  const cancel = () => {
    if (settled) return
    ipcRenderer.send("search:files:cancel", { requestId })
    reportPreloadSmokeStage("search-files:cancel", { requestId, reason: "renderer" })
    cancelSearch()
  }
  Object.defineProperties(promise, {
    requestId: { value: requestId },
    promise: { value: promise },
    cancel: { value: cancel },
  })
  return promise
}

function subscribeMcpResource(serverName, uri, callback) {
  const resourceServerName = String(serverName || "").trim()
  const resourceUri = String(uri || "").trim()
  if (!resourceServerName) return Promise.reject(new Error("MCP server name is required"))
  if (!resourceUri) return Promise.reject(new Error("MCP resource uri is required"))
  if (typeof callback !== "function") return Promise.reject(new Error("MCP resource listener is required"))
  const requestId = `mcp_resource_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  let subscriptionId = ""
  let disposed = false
  const handler = (_event, payload) => {
    if (!payload) return
    const matchesSubscription = subscriptionId
      ? payload.subscriptionId === subscriptionId
      : payload.requestId === requestId
    if (!matchesSubscription) return
    callback({
      serverName: payload.serverName || resourceServerName,
      uri: payload.uri || resourceUri,
    })
  }
  ipcRenderer.on("mcp:resource:update", handler)
  return ipcRenderer.invoke("mcp:resource:subscribe", { requestId, serverName: resourceServerName, uri: resourceUri }).then((result) => {
    subscriptionId = String(result?.subscriptionId || "")
    if (!subscriptionId) throw new Error("MCP resource subscription failed")
    const ready = result?.ready !== false
    const dispose = () => {
      if (disposed) return
      disposed = true
      ipcRenderer.removeListener("mcp:resource:update", handler)
      ipcRenderer.invoke("mcp:resource:unsubscribe", { subscriptionId }).catch(() => {})
    }
    return {
      ready,
      reason: ready ? undefined : String(result?.reason || "MCP resource subscribe is not available for this server."),
      retryMode: typeof result?.retryMode === "string" ? result.retryMode : undefined,
      retryAfter: typeof result?.retryAfter === "string" ? result.retryAfter : undefined,
      lastEventId: typeof result?.lastEventId === "string" ? result.lastEventId : undefined,
      channelStatus: typeof result?.channelStatus === "string" ? result.channelStatus : undefined,
      reconnectRequested: result?.reconnectRequested === true,
      userActionRequired: result?.userActionRequired === true,
      noAutoRetry: result?.noAutoRetry === true,
      dispose,
    }
  }, (error) => {
    ipcRenderer.removeListener("mcp:resource:update", handler)
    throw error
  })
}

const processEventCallbacks = new Map()
let processEventAttached = false

function attachProcessEventBridge() {
  if (processEventAttached) return
  processEventAttached = true
  ipcRenderer.on("process:event", (_event, payload) => {
    const callbacks = processEventCallbacks.get(payload?.processId)
    if (!callbacks) return
    if (payload.type === "stdout") {
      callbacks.onStdout?.(payload.data || "")
    } else if (payload.type === "stderr") {
      callbacks.onStderr?.(payload.data || "")
    } else if (payload.type === "exit") {
      callbacks.onExit?.({ code: payload.code, signal: payload.signal })
      processEventCallbacks.delete(payload.processId)
    } else if (payload.type === "error") {
      callbacks.onStderr?.(payload.error || "")
      callbacks.onExit?.({ error: payload.error })
      processEventCallbacks.delete(payload.processId)
    }
  })
}

function listenToExtHost(channel, callback) {
  if (typeof callback !== "function") return () => {}
  const handler = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld("codek", {
  readDir: (dirPath, options) => ipcRenderer.invoke("fs:listDir", dirPath, options),
  readFile: (filePath, options) => ipcRenderer.invoke("fs:readFile", filePath, options),
  startReadFileTextChunks: (request) => {
    ipcRenderer.send("fs:readFileTextChunks", request || {})
    return { requestId: request?.requestId || null, streamed: true }
  },
  onReadFileTextChunk: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on("fs:readFileTextChunks:event", handler)
    return () => ipcRenderer.removeListener("fs:readFileTextChunks:event", handler)
  },
  readFileTextChunk: (filePath, options) => readLocalWorkspaceTextChunk(filePath, options || {}),
  searchFiles: (request) => invokeSearchFiles(request || {}),
  startSearchFiles: (request, options) => startSearchFiles(request || {}, options || {}),
  writeFile: (filePath, content) => ipcRenderer.invoke("fs:writeFile", filePath, content),
  patchFileSegment: (filePath, plan) => ipcRenderer.invoke("fs:patchFileSegment", filePath, plan),
  createDir: (dirPath) => ipcRenderer.invoke("fs:mkdir", dirPath),
  deleteFile: (filePath) => ipcRenderer.invoke("fs:delete", filePath),
  rename: (oldPath, newPath) => ipcRenderer.invoke("fs:rename", oldPath, newPath),
  copyEntry: (sourcePath, targetPath) => ipcRenderer.invoke("fs:copy", sourcePath, targetPath),
  fileExists: (filePath) => ipcRenderer.invoke("fs:stat", filePath),
  getProjectRoot: () => ipcRenderer.invoke("fs:getProjectRoot"),
  getWorkspaceState: () => ipcRenderer.invoke("workspace:getState"),
  getWorkspaceScaleProfile: () => ipcRenderer.invoke("workspace:getScaleProfile"),
  openProjectPath: (dirPath) => ipcRenderer.invoke("workspace:openPath", dirPath),
  openWorkspaceFile: () => ipcRenderer.invoke("workspace:openFileDialog"),
  addFolderToWorkspace: () => ipcRenderer.invoke("workspace:addFolderDialog"),
  saveWorkspaceAs: (roots, settings) => ipcRenderer.invoke("workspace:saveAs", roots, settings),
  selectDirectory: () => ipcRenderer.invoke("dialog:openProject"),
  runCommand: (command, options) => ipcRenderer.invoke("shell:run", command, { source: "user", ...(options || {}) }),
  spawnProcess: async (command, args, opts = {}) => {
    attachProcessEventBridge()
    const result = await ipcRenderer.invoke("process:spawn", command, Array.isArray(args) ? args : [], {
      cwd: opts?.cwd,
      env: opts?.env,
      confirmed: opts?.confirmed,
    })
    processEventCallbacks.set(result.id, {
      onStdout: typeof opts?.onStdout === "function" ? opts.onStdout : undefined,
      onStderr: typeof opts?.onStderr === "function" ? opts.onStderr : undefined,
      onExit: typeof opts?.onExit === "function" ? opts.onExit : undefined,
    })
    return result
  },
  writeStdin: (pid, data) => ipcRenderer.invoke("process:stdin", pid, data),
  killProcess: (pid) => ipcRenderer.invoke("process:kill", pid),
  onFileChanged: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on("fs:changed", handler)
    return () => ipcRenderer.removeListener("fs:changed", handler)
  },
  onUserDataProfileChanged: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on("userDataProfile:changed", handler)
    return () => ipcRenderer.removeListener("userDataProfile:changed", handler)
  },
  onUserSettingsChanged: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on("settings:changed", handler)
    return () => ipcRenderer.removeListener("settings:changed", handler)
  },
  onOpenGoal: (callback) => {
    const handler = (_event, goalId) => callback(goalId)
    ipcRenderer.on("open-goal", handler)
    return () => ipcRenderer.removeListener("open-goal", handler)
  },
  ...(isSmoke ? {
    onSmokeOpenProjectPath: (callback) => {
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on("smoke:open-project-path", handler)
      return () => ipcRenderer.removeListener("smoke:open-project-path", handler)
    },
  } : {}),
  setTitle: (title) => ipcRenderer.invoke("window:setTitle", title),
  onExtHostMessage: (callback) => listenToExtHost("ext-host:message", callback),
  sendExtHostMessageResult: (payload) => {
    ipcRenderer.send("ext-host:message-result", payload || {})
  },
  onExtHostQuickPickShow: (callback) => listenToExtHost("ext-host:quickpick-show", callback),
  onExtHostQuickPickItems: (callback) => listenToExtHost("ext-host:quickpick-items", callback),
  onExtHostQuickPickUpdate: (callback) => listenToExtHost("ext-host:quickpick-update", callback),
  onExtHostQuickPickError: (callback) => listenToExtHost("ext-host:quickpick-error", callback),
  onExtHostQuickPickDispose: (callback) => listenToExtHost("ext-host:quickpick-dispose", callback),
  sendExtHostQuickPickResult: (payload) => {
    ipcRenderer.send("ext-host:quickpick-result", payload || {})
  },
  onExtHostInputShow: (callback) => listenToExtHost("ext-host:input-show", callback),
  sendExtHostInputResult: (payload) => {
    ipcRenderer.send("ext-host:input-result", payload || {})
  },
  onExtHostOutputRegister: (callback) => listenToExtHost("ext-host:output-register", callback),
  onExtHostOutputContent: (callback) => listenToExtHost("ext-host:output-content", callback),
  onExtHostOutputUpdate: (callback) => listenToExtHost("ext-host:output-update", callback),
  onExtHostOutputReveal: (callback) => listenToExtHost("ext-host:output-reveal", callback),
  onExtHostOutputClose: (callback) => listenToExtHost("ext-host:output-close", callback),
  onExtHostOutputDispose: (callback) => listenToExtHost("ext-host:output-dispose", callback),
  onExtHostProgressStart: (callback) => listenToExtHost("ext-host:progress-start", callback),
  onExtHostProgressReport: (callback) => listenToExtHost("ext-host:progress-report", callback),
  onExtHostProgressEnd: (callback) => listenToExtHost("ext-host:progress-end", callback),
  sendExtHostProgressCancel: (payload) => {
    ipcRenderer.send("ext-host:progress-cancel", payload || {})
  },
  onExtHostTestingController: (callback) => listenToExtHost("ext-host:testing-controller", callback),
  onExtHostTestingControllerRemove: (callback) => listenToExtHost("ext-host:testing-controller-remove", callback),
  onExtHostTestingProfile: (callback) => listenToExtHost("ext-host:testing-profile", callback),
  onExtHostTestingProfileUpdate: (callback) => listenToExtHost("ext-host:testing-profile-update", callback),
  onExtHostTestingProfileRemove: (callback) => listenToExtHost("ext-host:testing-profile-remove", callback),
  onExtHostTestingItem: (callback) => listenToExtHost("ext-host:testing-item", callback),
  onExtHostTestingItemRemove: (callback) => listenToExtHost("ext-host:testing-item-remove", callback),
  onExtHostTestingRunStart: (callback) => listenToExtHost("ext-host:testing-run-start", callback),
  onExtHostTestingRunTaskStart: (callback) => listenToExtHost("ext-host:testing-run-task-start", callback),
  onExtHostTestingRunTaskFinish: (callback) => listenToExtHost("ext-host:testing-run-task-finish", callback),
  onExtHostTestingRunOutput: (callback) => listenToExtHost("ext-host:testing-run-output", callback),
  onExtHostTestingRunState: (callback) => listenToExtHost("ext-host:testing-run-state", callback),
  onExtHostTestingRunComplete: (callback) => listenToExtHost("ext-host:testing-run-complete", callback),
  onExtHostTestingCoverage: (callback) => listenToExtHost("ext-host:testing-coverage", callback),
  onExtHostTestingRetire: (callback) => listenToExtHost("ext-host:testing-retire", callback),
  sendExtHostTestingCancel: (payload) => {
    ipcRenderer.send("ext-host:testing-cancel", payload || {})
  },
  sendExtHostTestingConfigureProfile: (payload) => {
    ipcRenderer.send("ext-host:testing-configure-profile", payload || {})
  },
  getExtHostTestingCoverageDetails: (payload) => ipcRenderer.invoke("ext-host:testing-coverage-details", payload || {}),
  provideExtHostTestingFollowups: (payload) => ipcRenderer.invoke("ext-host:testing-provide-followups", payload || {}),
  executeExtHostTestingFollowup: (payload) => ipcRenderer.invoke("ext-host:testing-execute-followup", payload || {}),
  disposeExtHostTestingFollowups: (payload) => ipcRenderer.invoke("ext-host:testing-dispose-followups", payload || {}),
  syncExtHostTesting: () => ipcRenderer.invoke("ext-host:testing-sync-tests"),
  refreshExtHostTesting: (payload) => ipcRenderer.invoke("ext-host:testing-refresh-tests", payload || {}),
  expandExtHostTesting: (payload) => ipcRenderer.invoke("ext-host:testing-expand-test", payload || {}),
  getExtHostTestingCodeRelatedToTest: (payload) => ipcRenderer.invoke("ext-host:testing-code-related-to-test", payload || {}),
  getExtHostTestingTestsRelatedToCode: (payload) => ipcRenderer.invoke("ext-host:testing-tests-related-to-code", payload || {}),
  publishExtHostTestingResults: (payload) => ipcRenderer.invoke("ext-host:testing-publish-results", payload || {}),
  onExtHostTaskProviderRegister: (callback) => listenToExtHost("ext-host:task-provider-register", callback),
  onExtHostTaskProviderUnregister: (callback) => listenToExtHost("ext-host:task-provider-unregister", callback),
  onExtHostTaskProviderProvide: (callback) => listenToExtHost("ext-host:task-provider-provide", callback),
  onExtHostTaskProviderResolve: (callback) => listenToExtHost("ext-host:task-provider-resolve", callback),
  onExtHostTaskProviderExecute: (callback) => listenToExtHost("ext-host:task-provider-execute", callback),
  onExtHostTaskProviderExecuteBlocked: (callback) => listenToExtHost("ext-host:task-provider-execute-blocked", callback),
  onExtHostTaskProviderTerminateBlocked: (callback) => listenToExtHost("ext-host:task-provider-terminate-blocked", callback),

  backendHealth: () => ipcRenderer.invoke("backend:health"),
  ollamaHealth: () => ipcRenderer.invoke("ollama:health"),
  ollamaIsInstalled: () => ipcRenderer.invoke("ollama:isInstalled"),
  ollamaInstall: () => ipcRenderer.invoke("ollama:install"),
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  getPath: (name) => ipcRenderer.invoke("app:getPath", name),
  isPackaged: () => ipcRenderer.invoke("app:isPackaged"),
  getAppDataPath: () => ipcRenderer.invoke("app:getAppDataPath"),
  restartExtensionHosts: (reason, options = {}) => ipcRenderer.invoke("api:request", {
    method: "POST",
    path: "/extensions-host/lifecycle/restart",
    body: {
      ...(options || {}),
      reason,
    },
    options: {
      startupTimeoutMs: Number(options?.startupTimeoutMs || 60000),
    },
  }),
  reloadWorkbenchWindow: (options) => ipcRenderer.invoke("window:reloadWorkbench", options || {}),
  openFileDialog: (options) => ipcRenderer.invoke("app:openFileDialog", options),
  saveFileDialog: (options) => ipcRenderer.invoke("app:saveFileDialog", options),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  showItemInFolder: (filePath) => ipcRenderer.invoke("shell:showItemInFolder", filePath),
  openEvalReport: (reportPath) => ipcRenderer.invoke("app:openEvalReport", reportPath),
  newWindow: (mode) => ipcRenderer.invoke("window:new", mode),
  closeWindow: (options) => ipcRenderer.invoke("window:close", options || {}),
  simulateWindowCloseLifecycle: (options) => ipcRenderer.invoke("window:simulateCloseLifecycle", options || {}),
  onWindowWillClose: (callback) => {
    const handler = (_event, payload) => callback(payload || {})
    ipcRenderer.on("window:will-close", handler)
    return () => ipcRenderer.removeListener("window:will-close", handler)
  },
  resolveWindowClose: (requestId, decision) => {
    ipcRenderer.send("window:will-close-response", {
      ...(decision || {}),
      requestId,
    })
  },
  quit: () => ipcRenderer.invoke("app:quit"),
  toggleDeveloperTools: () => ipcRenderer.invoke("window:toggleDevTools"),
  openLogs: () => ipcRenderer.invoke("app:openLogs"),
  exportDiagnostics: () => ipcRenderer.invoke("diagnostics:export"),
  listProcesses: () => ipcRenderer.invoke("process:list"),
  oauthLogin: (provider) => ipcRenderer.invoke("oauth:login", provider),
  api: (method, path, body, headers, options) => invokeApiRequest(method, path, body, headers, options),
  subscribeMcpResource: (serverName, uri, callback) => subscribeMcpResource(serverName, uri, callback),
  onLlmChunk: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on("llm:chunk", handler)
    return () => ipcRenderer.removeListener("llm:chunk", handler)
  },

  "ssh:connect": (config) => ipcRenderer.invoke("ssh:connect", config),
  "ssh:disconnect": (connId) => ipcRenderer.invoke("ssh:disconnect", connId),
  "ssh:execute": (connId, command) => ipcRenderer.invoke("ssh:execute", connId, command),
  "ssh:readFile": (connId, filePath) => ipcRenderer.invoke("ssh:readFile", connId, filePath),
  "ssh:writeFile": (connId, filePath, content) => ipcRenderer.invoke("ssh:writeFile", connId, filePath, content),
  "ssh:listDir": (connId, dirPath) => ipcRenderer.invoke("ssh:listDir", connId, dirPath),
  "ssh:stat": (connId, filePath) => ipcRenderer.invoke("ssh:stat", connId, filePath),
  sshStartFileWatcher: (connectionId, remotePath) => ipcRenderer.invoke("ssh:startFileWatcher", { connectionId, remotePath }),
  sshStopFileWatcher: (connectionId) => ipcRenderer.invoke("ssh:stopFileWatcher", { connectionId }),
  "ssh:onFileWatchEvent": (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on("ssh:fileWatchEvent", handler)
    return () => ipcRenderer.removeListener("ssh:fileWatchEvent", handler)
  },

  "wsl:list": () => ipcRenderer.invoke("wsl:list"),
  "wsl:connect": (distribution) => ipcRenderer.invoke("wsl:connect", distribution),
  "wsl:execute": (distribution, command) => ipcRenderer.invoke("wsl:execute", distribution, command),
  "wsl:readFile": (distribution, filePath) => ipcRenderer.invoke("wsl:readFile", distribution, filePath),
  "wsl:writeFile": (distribution, filePath, content) => ipcRenderer.invoke("wsl:writeFile", distribution, filePath, content),
  "wsl:listDir": (distribution, dirPath) => ipcRenderer.invoke("wsl:listDir", distribution, dirPath),

  "docker:listContainers": (all) => ipcRenderer.invoke("docker:listContainers", all),
  "docker:listImages": () => ipcRenderer.invoke("docker:listImages"),
  "docker:startContainer": (id) => ipcRenderer.invoke("docker:startContainer", id),
  "docker:stopContainer": (id) => ipcRenderer.invoke("docker:stopContainer", id),
  "docker:restartContainer": (id) => ipcRenderer.invoke("docker:restartContainer", id),
  "docker:removeContainer": (id) => ipcRenderer.invoke("docker:removeContainer", id),
  "docker:containerLogs": (id, tail) => ipcRenderer.invoke("docker:containerLogs", id, tail),
  "docker:execInContainer": (id, command) => ipcRenderer.invoke("docker:execInContainer", id, command),
  "docker:composeUp": (composePath) => ipcRenderer.invoke("docker:composeUp", composePath),
  "docker:composeDown": (composePath) => ipcRenderer.invoke("docker:composeDown", composePath),
  "docker:composePs": (composePath) => ipcRenderer.invoke("docker:composePs", composePath),
  "docker:parseDockerfile": (filePath) => ipcRenderer.invoke("docker:parseDockerfile", filePath),
  dockerCheckAvailable: () => ipcRenderer.invoke("docker:checkAvailable"),

  lsp: {
    start: (serverId, config) => ipcRenderer.invoke("lsp:start", serverId, config),
    stop: (serverId) => ipcRenderer.invoke("lsp:stop", serverId),
    send: (serverId, message) => ipcRenderer.invoke("lsp:send", serverId, message),
    onMessage: (callback) => {
      const handler = (_, data) => callback(data)
      ipcRenderer.on("lsp:message", handler)
      return () => ipcRenderer.removeListener("lsp:message", handler)
    },
  },

  dap: {
    start: (adapterType, config) => ipcRenderer.invoke("dap:start", adapterType, config),
    stop: (sessionId) => ipcRenderer.invoke("dap:stop", sessionId),
    send: (sessionId, message) => ipcRenderer.invoke("dap:send", sessionId, message),
    onEvent: (callback) => {
      const handler = (_, data) => callback(data)
      ipcRenderer.on("dap:event", handler)
      return () => ipcRenderer.removeListener("dap:event", handler)
    },
  },

  agent: {
    readFile: (filePath) => ipcRenderer.invoke("fs:readFile", filePath, {}, { source: "agent" }),
    writeFile: (filePath, content) => ipcRenderer.invoke("fs:writeFile", filePath, content, { source: "agent" }),
    createDir: (dirPath) => ipcRenderer.invoke("fs:mkdir", dirPath, { source: "agent" }),
    deleteFile: (filePath) => ipcRenderer.invoke("fs:delete", filePath, { source: "agent" }),
    fileExists: (filePath) => ipcRenderer.invoke("fs:stat", filePath, { source: "agent" }),
    readDir: (dirPath) => ipcRenderer.invoke("fs:listDir", dirPath, {}, { source: "agent" }),
    rename: (oldPath, newPath) => ipcRenderer.invoke("fs:rename", oldPath, newPath, { source: "agent" }),
    runCommand: (command, cwd) => ipcRenderer.invoke("run:command", command, cwd, { source: "agent" }),
    shellRun: (command) => ipcRenderer.invoke("shell:run", command, { source: "agent" }),
  },

  agentTools: {
    list: () => ipcRenderer.invoke("api:request", { method: "POST", path: "/agent/tools/list", body: {} }),
    invoke: (name, input, projectRoot) => ipcRenderer.invoke("api:request", {
      method: "POST",
      path: "/agent/tools/invoke",
      body: { name, input, projectRoot },
    }),
    clearAlwaysAllow: (tool) => ipcRenderer.invoke("api:request", {
      method: "POST",
      path: "/agent/tools/always-allow/clear",
      body: { tool: tool || null },
    }),
    onAuthRequest: (callback) => {
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on("agentTools:authRequest", handler)
      return () => ipcRenderer.removeListener("agentTools:authRequest", handler)
    },
    resolveAuth: (requestId, allow, alwaysAllow) => {
      ipcRenderer.send("agentTools:authResolve", { requestId, allow: !!allow, alwaysAllow: !!alwaysAllow })
    },
  },

  agentLoop: {
    run: (request) => ipcRenderer.invoke("api:request", {
      method: "POST",
      path: "/agent/loop/run",
      body: request,
    }),
    plan: (request) => ipcRenderer.invoke("api:request", {
      method: "POST",
      path: "/agent/loop/plan",
      body: request,
    }),
    abort: (requestId) => ipcRenderer.invoke("api:request", {
      method: "POST",
      path: "/agent/loop/abort",
      body: { requestId },
    }),
    onEvent: (callback) => {
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on("agent:event", handler)
      return () => ipcRenderer.removeListener("agent:event", handler)
    },
  },

  secureStore: {
    available: () => ipcRenderer.invoke("secureStore:available"),
    encrypt: (plaintext) => ipcRenderer.invoke("secureStore:encrypt", plaintext),
    decrypt: (ciphertext) => ipcRenderer.invoke("secureStore:decrypt", ciphertext),
  },

  pty: {
    isAvailable: () => ipcRenderer.invoke("pty:isAvailable"),
    create: (opts) => ipcRenderer.invoke("pty:create", opts),
    write: (id, data) => ipcRenderer.invoke("pty:write", id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke("pty:resize", id, cols, rows),
    dispose: (id) => ipcRenderer.invoke("pty:dispose", id),
    list: () => ipcRenderer.invoke("pty:list"),
    processExplorer: () => ipcRenderer.invoke("pty:processExplorer"),
    onData: (callback) => {
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on("pty:data", handler)
      return () => ipcRenderer.removeListener("pty:data", handler)
    },
    onExit: (callback) => {
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on("pty:exit", handler)
      return () => ipcRenderer.removeListener("pty:exit", handler)
    },
  },
})
