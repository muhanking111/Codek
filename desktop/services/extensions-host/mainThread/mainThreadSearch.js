/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code MainThreadSearch:
 * - D:\SourceMirror\vscode\src\vs\workbench\api\browser\mainThreadSearch.ts
 *--------------------------------------------------------------------------------------------*/

const path = require("path")
const { SearchProviderType } = require("../../search/searchProviderRegistry")
const { defaultSearchProviderRegistry } = require("../../search")
const { fileUriPathToFsPath, toFileUriComponents } = require("../uriComponents")

const EXT_HOST_SEARCH_NID = 111
const QueryType = Object.freeze({
  File: 1,
  Text: 2,
  aiText: 3,
})

let nextSessionId = 1

class SearchOperation {
  constructor(progress) {
    this.id = nextSessionId++
    this.progress = progress
    this.matchesByPath = new Map()
    this.keywords = []
    this.aborted = false
  }

  addMatch(match) {
    if (this.aborted || !match?.path) return
    const existing = this.matchesByPath.get(match.path)
    if (existing && Array.isArray(existing.results) && Array.isArray(match.results)) {
      existing.results.push(...match.results)
    } else if (!existing) {
      this.matchesByPath.set(match.path, match)
    }
    this.progress?.(existing || match)
  }

  addKeyword(keyword) {
    if (this.aborted) return
    this.keywords.push(keyword)
    this.progress?.(keyword)
  }

  results() {
    return Array.from(this.matchesByPath.values())
  }
}

class RemoteSearchProvider {
  constructor({ registry, type, scheme, handle, callEh }) {
    this.registry = registry
    this.type = type
    this.scheme = scheme
    this.handle = handle
    this.callEh = callEh
    this.searches = new Map()
    this.registration = registry.registerSearchResultProvider(scheme, type, this)
  }

  dispose() {
    this.registration?.dispose?.()
    this.registration = null
    for (const search of this.searches.values()) {
      search.aborted = true
    }
    this.searches.clear()
  }

  fileSearch(request = {}) {
    return this.doSearch(normalizeFileQuery(request), request)
  }

  textSearch(request = {}) {
    return this.doSearch(normalizeTextQuery(request), request)
  }

  async doSearch(query, request = {}) {
    const signal = request.signal || query.signal
    throwIfAborted(signal)
    const search = new SearchOperation(request.onProgress)
    this.searches.set(search.id, search)
    const abort = () => {
      search.aborted = true
      this.searches.delete(search.id)
    }
    signal?.addEventListener?.("abort", abort, { once: true })
    try {
      const stats = await this.provideSearchResults(query, search.id, signal)
      throwIfAborted(signal)
      return normalizeSearchComplete(search, stats, query)
    } finally {
      signal?.removeEventListener?.("abort", abort)
      this.searches.delete(search.id)
    }
  }

  provideSearchResults(query, session, signal) {
    throwIfAborted(signal)
    const args = [this.handle, session, query]
    const options = { usesCancellationToken: true }
    if (query.type === QueryType.File) {
      return this.callEh(EXT_HOST_SEARCH_NID, "$provideFileSearchResults", args, undefined, options)
    }
    return this.callEh(EXT_HOST_SEARCH_NID, "$provideTextSearchResults", args, undefined, options)
  }

  clearCache(cacheKey) {
    return this.callEh(EXT_HOST_SEARCH_NID, "$clearCache", [cacheKey])
  }

  handleFindMatch(session, dataOrUri = []) {
    const search = this.searches.get(session)
    if (!search) return
    for (const result of dataOrUri) {
      const match = normalizeRemoteMatch(result, search)
      if (match) search.addMatch(match)
    }
  }

  handleKeywordResult(session, keyword) {
    const search = this.searches.get(session)
    if (!search) return
    search.addKeyword(keyword)
  }
}

function register(server, opts = {}) {
  const registry = opts.searchProviderRegistry || defaultSearchProviderRegistry
  const callEh = typeof opts.callEh === "function"
    ? opts.callEh
    : (nid, method, args) => server.call(nid, method, args)
  const providers = new Map()
  const aiProviderHandles = new Set()

  const enableExtensionHostSearch = () => {
    callEh(EXT_HOST_SEARCH_NID, "$enableExtensionHostSearch", []).catch?.(() => undefined)
  }
  if (server.isRunning) {
    enableExtensionHostSearch()
  } else if (typeof server.on === "function") {
    server.on("ready", enableExtensionHostSearch)
  }

  function registerProvider(handle, scheme, type) {
    if (handle == null) return undefined
    const numericHandle = Number(handle)
    providers.get(numericHandle)?.dispose?.()
    const provider = new RemoteSearchProvider({
      registry,
      type,
      scheme: normalizeScheme(scheme),
      handle: numericHandle,
      callEh,
    })
    providers.set(numericHandle, provider)
    return undefined
  }

  server.onRpc("$registerTextSearchProvider", (args) => {
    const [handle, scheme] = args || []
    return registerProvider(handle, scheme, SearchProviderType.text)
  })

  server.onRpc("$registerFileSearchProvider", (args) => {
    const [handle, scheme] = args || []
    return registerProvider(handle, scheme, SearchProviderType.file)
  })

  server.onRpc("$registerAITextSearchProvider", (args) => {
    const [handle, scheme] = args || []
    if (handle != null) aiProviderHandles.add(Number(handle))
    return registerProvider(handle, scheme, SearchProviderType.text)
  })

  server.onRpc("$unregisterProvider", (args) => {
    const [handle] = args || []
    const numericHandle = Number(handle)
    providers.get(numericHandle)?.dispose?.()
    providers.delete(numericHandle)
    aiProviderHandles.delete(numericHandle)
    return undefined
  })

  server.onRpc("$handleFileMatch", (args) => {
    const [handle, session, data] = args || []
    const provider = providers.get(Number(handle))
    if (!provider) throw new Error("Got result for unknown provider")
    provider.handleFindMatch(session, Array.isArray(data) ? data : [])
    return undefined
  })

  server.onRpc("$handleTextMatch", (args) => {
    const [handle, session, data] = args || []
    const provider = providers.get(Number(handle))
    if (!provider) throw new Error("Got result for unknown provider")
    provider.handleFindMatch(session, Array.isArray(data) ? data : [])
    return undefined
  })

  server.onRpc("$handleKeywordResult", (args) => {
    const [handle, session, data] = args || []
    const provider = providers.get(Number(handle))
    if (!provider) throw new Error("Got result for unknown provider")
    provider.handleKeywordResult(session, data)
    return undefined
  })

  server.onRpc("$handleTelemetry", () => undefined)

  if (typeof opts.setSearchProviderRegistry === "function") {
    opts.setSearchProviderRegistry({ providers, aiProviderHandles })
  }
}

function normalizeTextQuery(request = {}) {
  return {
    ...commonQueryProps(request),
    type: QueryType.Text,
    contentPattern: {
      pattern: String(request.query || request.contentPattern?.pattern || ""),
      isRegExp: Boolean(request.regex || request.contentPattern?.isRegExp),
      isCaseSensitive: Boolean(request.caseSensitive || request.contentPattern?.isCaseSensitive),
      isWordMatch: Boolean(request.wholeWord || request.contentPattern?.isWordMatch),
    },
    previewOptions: request.previewOptions || { matchLines: 100, charsPerLine: 10000 },
    maxFileSize: request.searchMaxFileBytes,
  }
}

function normalizeFileQuery(request = {}) {
  return {
    ...commonQueryProps(request),
    type: QueryType.File,
    filePattern: String(request.filePattern || request.query || ""),
    maxResults: request.maxResults,
  }
}

function commonQueryProps(request = {}) {
  return {
    folderQueries: normalizeFolderQueries(request),
    includePattern: expressionFromArray(request.include),
    excludePattern: expressionFromArray(request.exclude),
    ignoreGlobCase: process.platform === "win32",
    maxResults: request.maxResults || request.queryPlan?.resultLimit,
    _reason: request.reason || "codek-extension-search",
  }
}

function normalizeFolderQueries(request = {}) {
  if (Array.isArray(request.folderQueries) && request.folderQueries.length) {
    return request.folderQueries.map((folderQuery) => ({
      ...folderQuery,
      folder: normalizeFolderUri(folderQuery.folder || folderQuery.root || request.root),
    }))
  }
  const root = request.root || request.folder?.fsPath || request.folder?.path
  return root ? [{ folder: normalizeFolderUri(root) }] : []
}

function normalizeFolderUri(value) {
  if (value && typeof value === "object" && value.scheme) {
    return completeFileUriComponents(value)
  }
  const filePath = String(value || process.cwd()).replace(/\\/g, "/")
  return completeFileUriComponents(toFileUriComponents(filePath))
}

function completeFileUriComponents(value) {
  if (!value || typeof value !== "object") return toFileUriComponents(process.cwd())
  if (value.$mid === 1 && value.fsPath) return value
  if (value.scheme !== "file") return { ...value }
  const rawPath = value.fsPath || (value.path ? fileUriPathToFsPath(value.path) : process.cwd())
  return {
    ...toFileUriComponents(rawPath),
    authority: value.authority || "",
    query: value.query || "",
    fragment: value.fragment || "",
  }
}

function expressionFromArray(patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return undefined
  const expression = {}
  for (const pattern of patterns) {
    const key = String(pattern || "").trim()
    if (key) expression[key] = true
  }
  return expression
}

function normalizeSearchComplete(search, stats = {}, query = {}) {
  const roots = queryFolderRoots(query)
  const matches = search.results().flatMap((match) => (
    match.results?.length
      ? match.results.map((result) => matchResultToCodek(match, result, roots))
      : [fileMatchToCodek(match, roots)]
  )).filter(Boolean)
  return {
    matches,
    truncated: stats?.limitHit === true,
    limitHit: stats?.limitHit === true,
    messages: Array.isArray(stats?.messages) ? stats.messages : [],
    stats: stats?.stats,
    aiKeywords: search.keywords,
    visitedFiles: Math.max(Number(stats?.stats?.filesWalked || 0), search.results().length),
    visitedDirs: Number(stats?.stats?.directoriesWalked || 0),
    skippedLargeFiles: 0,
    engine: "extension-search",
    provider: "extension-host",
    type: query.type,
  }
}

function normalizeRemoteMatch(result) {
  if (!result) return null
  if (Array.isArray(result.results) || result.resource) {
    return {
      resource: result.resource,
      path: resourceToRelativePath(result.resource),
      results: Array.isArray(result.results) ? result.results : undefined,
    }
  }
  if (result.scheme || result.path || result.fsPath) {
    return {
      resource: result,
      path: resourceToRelativePath(result),
    }
  }
  return null
}

function fileMatchToCodek(match, roots) {
  const relativePath = relativePathForMatch(match, roots)
  if (!relativePath) return null
  return {
    path: relativePath,
    line: 1,
    column: 1,
    matchLength: 0,
    preview: "",
  }
}

function matchResultToCodek(match, result, roots) {
  const range = firstSourceRange(result)
  const relativePath = relativePathForMatch(match, roots)
  if (!relativePath) return null
  return {
    path: relativePath,
    line: Math.max(1, Number(range?.startLineNumber || result.lineNumber || 1)),
    column: Math.max(1, Number(range?.startColumn || 1)),
    matchLength: matchLengthFromRange(range),
    preview: String(result.previewText || result.text || ""),
  }
}

function firstSourceRange(result) {
  const first = Array.isArray(result?.rangeLocations) ? result.rangeLocations[0] : null
  return first?.source || first?.preview || result?.range || null
}

function matchLengthFromRange(range) {
  if (!range) return 0
  const start = Number(range.startColumn || 0)
  const end = Number(range.endColumn || start)
  return Math.max(0, end - start)
}

function resourceToRelativePath(resource) {
  if (!resource) return ""
  const fsPath = resource.fsPath || (resource.path ? fileUriPathToFsPath(resource.path) : "")
  if (!fsPath) return ""
  const normalized = fsPath.replace(/\\/g, "/")
  const cwd = process.cwd().replace(/\\/g, "/")
  if (path.resolve(fsPath).toLowerCase().startsWith(path.resolve(process.cwd()).toLowerCase())) {
    return path.relative(process.cwd(), fsPath).replace(/\\/g, "/")
  }
  const driveMatch = normalized.match(/^[A-Za-z]:\/(.+)$/)
  if (driveMatch && cwd.includes(":")) return driveMatch[1]
  return normalized.replace(/^\/[A-Za-z]:\//, "")
}

function relativePathForMatch(match, roots) {
  const fsPath = match?.fsPath || resourceToFsPath(match?.resource)
  if (fsPath) {
    for (const root of roots || []) {
      const relative = relativeIfInsideRoot(fsPath, root)
      if (relative) return relative
    }
  }
  return match?.path || ""
}

function queryFolderRoots(query = {}) {
  return (query.folderQueries || [])
    .map((folderQuery) => resourceToFsPath(folderQuery?.folder))
    .filter(Boolean)
}

function relativeIfInsideRoot(filePath, root) {
  const resolvedFile = path.resolve(filePath)
  const resolvedRoot = path.resolve(root)
  const fileKey = resolvedFile.toLowerCase()
  const rootKey = resolvedRoot.toLowerCase()
  if (fileKey === rootKey) return path.basename(resolvedFile)
  if (!fileKey.startsWith(`${rootKey}${path.sep}`.toLowerCase())) return ""
  return path.relative(resolvedRoot, resolvedFile).replace(/\\/g, "/")
}

function resourceToFsPath(resource) {
  if (!resource) return ""
  if (resource.fsPath) return resource.fsPath
  if (!resource.path) return ""
  return fileUriPathToFsPath(resource.path)
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  const error = new Error("Search cancelled")
  error.name = "AbortError"
  throw error
}

function normalizeScheme(scheme) {
  return String(scheme || "file").trim().toLowerCase() || "file"
}

module.exports = {
  EXT_HOST_SEARCH_NID,
  QueryType,
  RemoteSearchProvider,
  register,
}
