/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code raw search service/provider orchestration:
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\node\rawSearchService.ts
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\common\searchService.ts
 *--------------------------------------------------------------------------------------------*/

const RawSearchProviderStatus = Object.freeze({
  success: "success",
  missing: "missing",
  error: "error",
})

const RAW_FILE_SEARCH_BATCH_SIZE = 512

const { compareFilePatternMatches, isFilePatternMatch } = require("./filePatternMatcher")

async function runRawSearchProvider({
  providerRegistry,
  type,
  scheme = "file",
  request = {},
  progress,
  engine,
  signal,
  serviceState,
} = {}) {
  throwIfAborted(signal)
  if (!providerRegistry || typeof providerRegistry.runSearch !== "function") {
    return { status: RawSearchProviderStatus.missing, result: null }
  }

  const normalizedScheme = String(scheme || "file")
  const hasProvider = typeof providerRegistry.schemeHasProvider === "function"
    ? providerRegistry.schemeHasProvider(type, normalizedScheme)
    : true
  if (!hasProvider) return { status: RawSearchProviderStatus.missing, result: null }

  const providerEngine = engine || defaultProviderEngine(type)
  try {
    progress?.provider?.({ engine: providerEngine, type, scheme: normalizedScheme })
    const cacheResult = tryRawFileSearchFromCache({ serviceState, type, request, fallbackEngine: providerEngine, signal })
    if (cacheResult) {
      progressRawFileResultBatches(cacheResult.matches, progress, { engine: cacheResult.engine, fromCache: true })
      return {
        status: RawSearchProviderStatus.success,
        result: cacheResult,
      }
    }

    const result = await providerRegistry.runSearch(type, normalizedScheme, {
      ...request,
      signal: request.signal || signal,
    })
    throwIfAborted(signal)
    if (!result) return { status: RawSearchProviderStatus.missing, result: null }
    const normalizedResult = normalizeRawSearchResult(result, providerEngine, { type, request })
    if (type === "file") {
      storeRawFileSearchCache({ serviceState, request, result: normalizedResult })
      progressRawFileResultBatches(normalizedResult.matches, progress, { engine: normalizedResult.engine, fromCache: false })
    }
    return {
      status: RawSearchProviderStatus.success,
      result: normalizedResult,
    }
  } catch (error) {
    if (isAbortError(error, signal)) {
      progress?.cancelled?.({ engine: providerEngine, type, scheme: normalizedScheme })
      throw normalizeAbortError(error)
    }
    progress?.providerError?.({
      engine: providerEngine,
      type,
      scheme: normalizedScheme,
      error: String(error?.message || error),
      errorName: String(error?.name || ""),
    })
    return {
      status: RawSearchProviderStatus.error,
      result: null,
      error,
      engine: providerEngine,
    }
  }
}

function createRawSearchServiceState() {
  return {
    fileSearchCaches: new Map(),
  }
}

function tryRawFileSearchFromCache({ serviceState, type, request = {}, fallbackEngine, signal } = {}) {
  if (type !== "file" || !request.sortByScore || !request.cacheKey || !serviceState?.fileSearchCaches) {
    return null
  }

  throwIfAborted(signal)
  const cache = serviceState.fileSearchCaches.get(request.cacheKey)
  if (!cache) return null
  const searchValue = String(request.filePattern || "")
  const cachedRow = findRawFileSearchCacheRow(cache, searchValue)
  if (!cachedRow) return null

  const matches = cachedRow.matches.filter((match) => (
    !searchValue || isFilePatternMatch(match, searchValue, true, true)
  ))
  const normalized = normalizeRawFileSearchResult({
    matches,
    truncated: cachedRow.truncated,
    visitedFiles: cachedRow.visitedFiles,
    visitedDirs: cachedRow.visitedDirs,
    skippedLargeFiles: cachedRow.skippedLargeFiles,
    engine: cachedRow.engine || fallbackEngine,
  }, request)

  return {
    ...normalized,
    rawSearchCache: {
      fromCache: true,
      cacheKey: request.cacheKey,
      previousFilePattern: cachedRow.filePattern,
      cacheEntryCount: cachedRow.matches.length,
    },
  }
}

function storeRawFileSearchCache({ serviceState, request = {}, result } = {}) {
  if (!request.sortByScore || !request.cacheKey || !serviceState?.fileSearchCaches || !result) return
  const cache = serviceState.fileSearchCaches.get(request.cacheKey) || new Map()
  const filePattern = String(request.filePattern || "")
  const cacheMatches = Array.isArray(result.__rawFileSearchCacheMatches)
    ? result.__rawFileSearchCacheMatches
    : result.matches
  cache.set(filePattern, {
    filePattern,
    matches: Array.isArray(cacheMatches) ? [...cacheMatches] : [],
    truncated: result.truncated === true,
    visitedFiles: Number(result.visitedFiles || 0),
    visitedDirs: Number(result.visitedDirs || 0),
    skippedLargeFiles: Number(result.skippedLargeFiles || 0),
    engine: result.engine,
  })
  serviceState.fileSearchCaches.set(request.cacheKey, cache)
  result.rawSearchCache = {
    fromCache: false,
    cacheKey: request.cacheKey,
    cacheEntryCount: cache.get(filePattern).matches.length,
  }
}

function findRawFileSearchCacheRow(cache, searchValue) {
  const hasPathSeparator = /[\\/]/.test(searchValue)
  for (const [previousSearch, row] of cache.entries()) {
    if (!searchValue.startsWith(previousSearch)) continue
    if (hasPathSeparator && !/[\\/]/.test(previousSearch) && previousSearch !== "") continue
    return row
  }
  return null
}

function progressRawFileResultBatches(matches, progress, detail = {}) {
  if (!progress || typeof progress.resultBatch !== "function" || !Array.isArray(matches)) return
  if (!matches.length) return
  for (let index = 0; index < matches.length; index += RAW_FILE_SEARCH_BATCH_SIZE) {
    const batch = matches.slice(index, index + RAW_FILE_SEARCH_BATCH_SIZE)
    progress.resultBatch({
      ...detail,
      matches: batch,
      count: batch.length,
      total: matches.length,
      batchIndex: Math.floor(index / RAW_FILE_SEARCH_BATCH_SIZE),
    })
  }
}

function normalizeRawSearchResult(result, fallbackEngine, options = {}) {
  const normalized = {
    ...result,
    matches: Array.isArray(result.matches) ? result.matches : [],
    truncated: result.truncated === true,
    visitedFiles: Number(result.visitedFiles || 0),
    visitedDirs: Number(result.visitedDirs || 0),
    skippedLargeFiles: Number(result.skippedLargeFiles || 0),
    engine: result.engine || fallbackEngine,
  }
  if (options.type === "file") return normalizeRawFileSearchResult(normalized, options.request || {})
  return normalized
}

function normalizeRawFileSearchResult(result, request = {}) {
  const filePattern = String(request.filePattern || "").trim()
  const shouldGlobMatchFilePattern = request.shouldGlobMatchFilePattern === true
  const maxResults = normalizePositiveInteger(request.maxResults || request.queryPlan?.resultLimit)
  let matches = result.matches

  if (filePattern) {
    matches = matches.filter((match) => isFilePatternMatch(match, filePattern, !shouldGlobMatchFilePattern, true))
  }
  if (filePattern && request.sortByScore !== false) {
    matches = [...matches].sort((left, right) => compareFilePatternMatches(filePattern, left, right))
  }
  const cacheMatches = Array.isArray(matches) ? [...matches] : []

  let truncated = result.truncated === true
  if (maxResults && matches.length > maxResults) {
    matches = matches.slice(0, maxResults)
    truncated = true
  }
  const normalized = {
    ...result,
    matches,
    truncated,
    visitedFiles: Math.max(Number(result.visitedFiles || 0), matches.length),
  }
  Object.defineProperty(normalized, "__rawFileSearchCacheMatches", {
    value: cacheMatches,
    enumerable: false,
    configurable: true,
  })
  return normalized
}

function defaultProviderEngine(type) {
  return type === "file" ? "ripgrep-files" : "ripgrep"
}

function normalizePositiveInteger(value) {
  const numeric = Math.trunc(Number(value))
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function isAbortError(error, signal) {
  return signal?.aborted === true || error?.name === "AbortError"
}

function normalizeAbortError(error) {
  if (error?.name === "AbortError") return error
  const abortError = new Error("Search cancelled")
  abortError.name = "AbortError"
  return abortError
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  throw normalizeAbortError()
}

module.exports = {
  RAW_FILE_SEARCH_BATCH_SIZE,
  RawSearchProviderStatus,
  createRawSearchServiceState,
  normalizeRawFileSearchResult,
  normalizeRawSearchResult,
  runRawSearchProvider,
}
