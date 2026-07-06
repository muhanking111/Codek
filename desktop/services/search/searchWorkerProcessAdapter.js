/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code RawSearchService searchProcess boundary:
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\node\rawSearchService.ts
 *--------------------------------------------------------------------------------------------*/

const { fork } = require("child_process")
const path = require("path")

const DEFAULT_WORKER_IDLE_MS = 30_000
const SearchProviderType = Object.freeze({
  file: "file",
  text: "text",
})

class SearchWorkerProcessHost {
  constructor({
    workerPath = path.join(__dirname, "searchWorkerProcessMain.js"),
    idleMs = DEFAULT_WORKER_IDLE_MS,
    forkImpl = fork,
  } = {}) {
    this.workerPath = workerPath
    this.idleMs = Math.max(0, Number(idleMs || 0))
    this.forkImpl = forkImpl
    this.child = null
    this.nextId = 1
    this.pending = new Map()
    this.idleTimer = null
  }

  textSearch(request) {
    return this.run(SearchProviderType.text, request)
  }

  fileSearch(request) {
    return this.run(SearchProviderType.file, request)
  }

  run(type, request = {}) {
    const id = this.nextId
    this.nextId += 1
    const child = this.ensureChild()
    const payload = serializeWorkerRequest(type, request)

    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal: request.signal }
      this.pending.set(id, entry)
      const cancel = () => {
        child.send?.({ type: "cancel", id })
      }
      if (request.signal?.aborted) {
        this.pending.delete(id)
        reject(normalizeAbortError())
        return
      }
      request.signal?.addEventListener?.("abort", cancel, { once: true })
      entry.dispose = () => request.signal?.removeEventListener?.("abort", cancel)
      child.send({ type: "search", id, searchType: type, request: payload }, (error) => {
        if (!error) return
        this.finishPending(id, null, error)
      })
    })
  }

  clearCache() {
    return Promise.resolve(undefined)
  }

  dispose() {
    this.clearIdleTimer()
    for (const [id, entry] of this.pending) {
      entry.dispose?.()
      entry.reject(normalizeAbortError())
      this.pending.delete(id)
    }
    if (this.child) {
      this.child.kill()
      this.child = null
    }
  }

  ensureChild() {
    this.clearIdleTimer()
    if (this.child) return this.child
    const child = this.forkImpl(this.workerPath, [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    })
    child.on("message", (message) => this.handleMessage(message))
    child.on("exit", () => this.handleExit())
    child.on("error", (error) => this.handleExit(error))
    this.child = child
    return child
  }

  handleMessage(message) {
    if (!message || typeof message !== "object") return
    if (message.type === "result") this.finishPending(message.id, message.result, null)
    else if (message.type === "error") this.finishPending(message.id, null, reviveWorkerError(message.error))
  }

  handleExit(error) {
    const pending = [...this.pending.entries()]
    this.pending.clear()
    this.child = null
    for (const [, entry] of pending) {
      entry.dispose?.()
      entry.reject(error || new Error("Search worker exited"))
    }
  }

  finishPending(id, result, error) {
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    entry.dispose?.()
    if (error) entry.reject(error)
    else entry.resolve(result)
    this.scheduleIdle()
  }

  scheduleIdle() {
    if (!this.child || this.pending.size > 0 || this.idleMs <= 0) return
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      if (this.pending.size === 0 && this.child) {
        this.child.kill()
        this.child = null
      }
    }, this.idleMs)
    this.idleTimer.unref?.()
  }

  clearIdleTimer() {
    if (!this.idleTimer) return
    clearTimeout(this.idleTimer)
    this.idleTimer = null
  }
}

function createSearchWorkerProcessProviders(options) {
  const host = new SearchWorkerProcessHost(options)
  return {
    host,
    textProvider: {
      textSearch: (request) => host.textSearch(request),
      clearCache: (cacheKey) => host.clearCache(cacheKey),
    },
    fileProvider: {
      fileSearch: (request) => host.fileSearch(request),
      clearCache: (cacheKey) => host.clearCache(cacheKey),
    },
  }
}

function serializeWorkerRequest(type, request = {}) {
  const queryOptions = request.queryOptions || buildQueryOptions(type, request)
  const payload = {
    ...request,
    queryOptions,
    signal: undefined,
    queryPlan: undefined,
    onProgress: undefined,
    shouldIncludePath: undefined,
  }
  if (typeof request.shouldIncludePath === "function" && request.shouldIncludePathMode) {
    payload.shouldIncludePathMode = request.shouldIncludePathMode
  }
  return JSON.parse(JSON.stringify(payload))
}

function buildQueryOptions(type, request = {}) {
  const queryPlan = request.queryPlan || {}
  return {
    query: request.query || request.filePattern || "",
    include: expressionKeys(queryPlan.includeExpression),
    exclude: expressionKeys(queryPlan.excludeExpression),
    regex: request.regex === true,
    caseSensitive: request.caseSensitive === true,
    wholeWord: request.wholeWord === true,
    maxResults: request.maxResults || queryPlan.resultLimit,
    maxVisitedFiles: queryPlan.visitedFileLimit,
    compileTextPattern: type !== SearchProviderType.file,
  }
}

function expressionKeys(expression) {
  return Object.keys(expression || {}).filter((key) => expression[key] !== false)
}

function reviveWorkerError(error) {
  const revived = new Error(error?.message || "Search worker failed")
  revived.name = error?.name || "Error"
  revived.stack = error?.stack
  return revived
}

function normalizeAbortError() {
  const error = new Error("Search cancelled")
  error.name = "AbortError"
  return error
}

module.exports = {
  SearchWorkerProcessHost,
  createSearchWorkerProcessProviders,
  serializeWorkerRequest,
}
