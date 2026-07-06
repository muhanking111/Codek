const fs = require("fs")
const path = require("path")
const {
  DEFAULT_IGNORED_GLOBS,
  SCALE_BUDGETS,
  pathHasIgnoredSegment,
} = require("../workspace/workspaceScaleProfile")
const { createSearchQueryPlan } = require("./searchQueryAdapter")
const { createSearchProgressReporter } = require("./searchProgressAdapter")
const {
  getSearchSchemesInQuery,
  normalizeWorkspaceSearchFolders,
  runWorkspaceSearch,
  workspaceSearchProgressMessage,
} = require("./searchServiceAdapter")
const { SearchProviderType, createDefaultSearchProviderRegistry } = require("./searchProviderRegistry")
const { RawSearchProviderStatus, createRawSearchServiceState, runRawSearchProvider } = require("./rawSearchServiceAdapter")
const { createExtensionHostSearchActivationAdapter } = require("./searchExtensionActivationAdapter")
const {
  DEFAULT_SEARCH_MAX_FILE_BYTES,
  MAX_FILE_BYTES,
  SEARCH_RESULT_CONTENT_MAX_FILE_BYTES,
  SEARCH_RESULT_CONTENT_MAX_TOTAL_BYTES,
  collectMatchedFileContents,
  countSkippedLargeFiles,
  runLocalFileSearch,
  throwIfAborted,
} = require("./localFileSearchAdapter")

const defaultSearchProviderRegistry = createDefaultSearchProviderRegistry()
const defaultRawSearchServiceState = createRawSearchServiceState()
const defaultActivateSearchProviders = createExtensionHostSearchActivationAdapter()
const SEARCH_ERROR_CODE_PROVIDER_UNAVAILABLE = 10

async function resolveSearchRoot(root) {
  if (!root || typeof root !== "string") return null
  const resolved = path.resolve(root)
  let stat
  try {
    stat = await fs.promises.stat(resolved)
  } catch {
    return null
  }
  if (!stat.isDirectory()) return null
  try {
    return await fs.promises.realpath(resolved)
  } catch {
    return resolved
  }
}

async function isAllowedWorkspaceRoot(searchRoot, allowedRoots) {
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) return true
  const normalizedSearchRoot = path.normalize(searchRoot).toLowerCase()
  for (const root of allowedRoots) {
    const resolvedRoot = await resolveSearchRoot(root)
    if (!resolvedRoot) continue
    if (path.normalize(resolvedRoot).toLowerCase() === normalizedSearchRoot) return true
  }
  return false
}

async function searchInWorkspace({
  root,
  roots,
  folderQueries,
  query,
  include,
  exclude,
  regex,
  caseSensitive,
  wholeWord,
  maxResults,
  maxVisitedFiles,
  searchLargeFiles,
  searchMaxFileBytes,
  allowedRoots,
  discoverFiles,
  workspaceScaleProfile,
  includeContentForSmallFiles,
  contentMaxFileBytes,
  contentMaxTotalBytes,
  signal,
  onProgress,
  providerRegistry = defaultSearchProviderRegistry,
  rawSearchServiceState = defaultRawSearchServiceState,
  activateSearchProviders = defaultActivateSearchProviders,
  skipSearchProviderActivation = false,
}) {
  const progress = createSearchProgressReporter(onProgress)
  const budgets = workspaceScaleProfile?.budgets || SCALE_BUDGETS.normal
  if (!root || (!query && !discoverFiles)) return { matches: [], truncated: false, visitedFiles: 0, visitedDirs: 0 }
  throwIfAborted(signal)
  const searchSchemes = getSearchSchemesInQuery({ root, roots: Array.isArray(roots) ? roots : [root], folderQueries })
  progress.start({
    root,
    queryLength: String(query || "").length,
    discoverFiles: discoverFiles === true,
  })

  const queryPlan = createSearchQueryPlan({
    query,
    include,
    exclude,
    regex,
    caseSensitive,
    wholeWord,
    maxResults,
    maxVisitedFiles,
    budgets,
    compileTextPattern: !discoverFiles,
  })
  if (queryPlan.error) {
    return { matches: [], truncated: false, visitedFiles: 0, visitedDirs: 0, error: `Invalid pattern: ${queryPlan.error.message}` }
  }
  const re = queryPlan.textPattern

  if (!searchSchemes.includes("file")) {
    if (!skipSearchProviderActivation) {
      await activateSearchProvidersForSearch({
        activateSearchProviders,
        schemes: searchSchemes,
        signal,
      })
    }
    return searchProviderScheme({
      root,
      query,
      queryPlan,
      include,
      exclude,
      regex,
      caseSensitive,
      wholeWord,
      maxResults,
      searchLargeFiles,
      searchMaxFileBytes,
      discoverFiles,
      folderQueries,
      scheme: searchSchemes[0],
      progress,
      signal,
      onProgress,
      providerRegistry,
      rawSearchServiceState,
    })
  }

  const searchRoot = await resolveSearchRoot(root)
  if (!searchRoot) {
    return { matches: [], truncated: false, error: "Invalid workspace root" }
  }
  if (!(await isAllowedWorkspaceRoot(searchRoot, allowedRoots))) {
    return { matches: [], truncated: false, error: "Workspace root is not open" }
  }

  const shouldIncludeFileContents = includeContentForSmallFiles === true && !discoverFiles
  const fileContentMaxBytes = Math.min(
    Math.max(0, Number(contentMaxFileBytes || SEARCH_RESULT_CONTENT_MAX_FILE_BYTES)),
    MAX_FILE_BYTES,
  )
  const totalContentMaxBytes = Math.min(
    Math.max(0, Number(contentMaxTotalBytes || SEARCH_RESULT_CONTENT_MAX_TOTAL_BYTES)),
    16 * 1024 * 1024,
  )
  const largeFileScanLimit = Math.max(
    MAX_FILE_BYTES,
    Number(searchMaxFileBytes || DEFAULT_SEARCH_MAX_FILE_BYTES),
  )
  const discoverFilePattern = discoverFiles ? String(query || "").trim() : ""

  if (!skipSearchProviderActivation) {
    await activateSearchProvidersForSearch({
      activateSearchProviders,
      schemes: searchSchemes,
      signal,
    })
  }

  if (discoverFiles) {
    const providerResult = await runRawSearchProvider({
      providerRegistry,
      type: SearchProviderType.file,
      scheme: "file",
      engine: "ripgrep-files",
      progress,
      signal,
      request: {
        root: searchRoot,
        queryPlan,
        ignoredGlobs: DEFAULT_IGNORED_GLOBS,
        signal,
        shouldIncludePath: (relativePath) => !pathHasIgnoredSegment(relativePath),
        filePattern: discoverFilePattern,
        maxResults: queryPlan.resultLimit,
        sortByScore: Boolean(discoverFilePattern),
        cacheKey: discoverFiles ? createFileSearchCacheKey({
          root: searchRoot,
          include,
          exclude,
          visitedFileLimit: queryPlan.visitedFileLimit,
        }) : undefined,
      },
      serviceState: rawSearchServiceState,
    })
    if (providerResult.status === RawSearchProviderStatus.success) {
      const rgFileResult = providerResult.result
        progress.done({
          engine: rgFileResult.engine || "ripgrep-files",
          matchCount: rgFileResult.matches?.length || 0,
          truncated: rgFileResult.truncated === true,
        })
        return rgFileResult
    }
  } else {
    const providerResult = await runRawSearchProvider({
      providerRegistry,
      type: SearchProviderType.text,
      scheme: "file",
      engine: "ripgrep",
      progress,
      signal,
      request: {
        root: searchRoot,
        query,
        queryPlan,
        regex,
        caseSensitive,
        wholeWord,
        searchLargeFiles,
        searchMaxFileBytes: largeFileScanLimit,
        ignoredGlobs: DEFAULT_IGNORED_GLOBS,
        signal,
        onProgress,
      },
      serviceState: rawSearchServiceState,
    })
    if (providerResult.status === RawSearchProviderStatus.success) {
      const rgResult = providerResult.result
        if (searchLargeFiles !== true) {
          progress.skipped({ engine: "ripgrep", limitBytes: largeFileScanLimit })
          rgResult.skippedLargeFiles = await countSkippedLargeFiles(searchRoot, queryPlan, largeFileScanLimit, signal)
        }
        if (shouldIncludeFileContents) {
          progress.contents({ engine: "ripgrep", matchedFiles: new Set(rgResult.matches.map((match) => match.path)).size })
          const contentResult = await collectMatchedFileContents({
            root: searchRoot,
            matches: rgResult.matches,
            contentMaxFileBytes: fileContentMaxBytes,
            contentMaxTotalBytes: totalContentMaxBytes,
            signal,
          })
          rgResult.fileContents = contentResult.fileContents
          rgResult.fileContentBytes = contentResult.fileContentBytes
        }
        progress.done({
          engine: rgResult.engine || "ripgrep",
          matchCount: rgResult.matches?.length || 0,
          truncated: rgResult.truncated === true,
        })
        return rgResult
    }
  }

  progress.fallback({ discoverFiles: discoverFiles === true })
  const result = await runLocalFileSearch({
    root: searchRoot,
    queryPlan,
    textPattern: re,
    discoverFiles: discoverFiles === true,
    filePattern: discoverFilePattern,
    searchLargeFiles,
    searchMaxFileBytes: largeFileScanLimit,
    includeContentForSmallFiles: shouldIncludeFileContents,
    contentMaxFileBytes: fileContentMaxBytes,
    contentMaxTotalBytes: totalContentMaxBytes,
    signal,
  })
  progress.done({
    engine: result.engine || "local-file-search",
    matchCount: result.matches?.length || 0,
    truncated: result.truncated === true,
  })
  return result
}

async function searchWorkspace({
  root,
  roots,
  folderQueries,
  query,
  include,
  exclude,
  regex,
  caseSensitive,
  wholeWord,
  maxResults,
  maxVisitedFiles,
  searchLargeFiles,
  searchMaxFileBytes,
  allowedRoots,
  discoverFiles,
  workspaceScaleProfile,
  includeContentForSmallFiles,
  contentMaxFileBytes,
  contentMaxTotalBytes,
  signal,
  onProgress,
  providerRegistry = defaultSearchProviderRegistry,
  rawSearchServiceState = defaultRawSearchServiceState,
  activateSearchProviders = defaultActivateSearchProviders,
}) {
  await activateSearchProvidersForSearch({
    activateSearchProviders,
    schemes: getSearchSchemesInQuery({ root, roots, folderQueries }),
    signal,
  })

  return runWorkspaceSearch({
    root,
    roots,
    folderQueries,
    maxResults,
    signal,
    onProgress,
    runFolderSearch: (folder, options) => searchInWorkspace({
      root: folder.root,
      query,
      include,
      exclude,
      regex,
      caseSensitive,
      wholeWord,
      maxResults: options.maxResults,
      maxVisitedFiles,
      searchLargeFiles,
      searchMaxFileBytes,
      allowedRoots,
      discoverFiles,
      workspaceScaleProfile,
      includeContentForSmallFiles,
      contentMaxFileBytes,
      contentMaxTotalBytes,
      signal,
      providerRegistry,
      rawSearchServiceState,
      activateSearchProviders,
      skipSearchProviderActivation: true,
      onProgress: options.onProgress,
      folderQueries: [searchFolderToFolderQuery(folder)],
    }),
  })
}

async function activateSearchProvidersForSearch({ activateSearchProviders, schemes, signal } = {}) {
  if (typeof activateSearchProviders !== "function") return
  await activateSearchProviders({ schemes, signal })
  throwIfAborted(signal)
}

async function searchProviderScheme({
  root,
  query,
  queryPlan,
  include,
  exclude,
  regex,
  caseSensitive,
  wholeWord,
  maxResults,
  searchLargeFiles,
  searchMaxFileBytes,
  discoverFiles,
  folderQueries,
  scheme,
  progress,
  signal,
  onProgress,
  providerRegistry,
  rawSearchServiceState,
}) {
  const providerType = discoverFiles ? SearchProviderType.file : SearchProviderType.text
  const providerResult = await runRawSearchProvider({
    providerRegistry,
    type: providerType,
    scheme,
    progress,
    signal,
    request: {
      root,
      query,
      queryPlan,
      include,
      exclude,
      regex,
      caseSensitive,
      wholeWord,
      searchLargeFiles,
      searchMaxFileBytes,
      discoverFiles: discoverFiles === true,
      filePattern: discoverFiles ? String(query || "").trim() : undefined,
      maxResults: maxResults || queryPlan.resultLimit,
      folderQueries,
      signal,
      onProgress,
    },
    serviceState: rawSearchServiceState,
  })
  if (providerResult.status === RawSearchProviderStatus.success) {
    const result = providerResult.result
    progress.done({
      engine: result.engine || "extension-search",
      matchCount: result.matches?.length || 0,
      truncated: result.truncated === true,
    })
    return result
  }
  if (providerResult.status === RawSearchProviderStatus.missing) {
    return withSearchProviderFailures({ matches: [], truncated: false, visitedFiles: 0, visitedDirs: 0 }, [
      createMissingProviderFailure(scheme, providerType),
    ])
  }
  return {
    matches: [],
    truncated: false,
    visitedFiles: 0,
    visitedDirs: 0,
    success: false,
    partial: false,
    error: providerResult.error?.message || String(providerResult.error || "Search provider failed"),
  }
}

function searchFolderToFolderQuery(folder) {
  return {
    root: folder.root,
    rootLabel: folder.rootLabel,
    folderIndex: folder.folderIndex,
    folder: {
      scheme: normalizeSearchScheme(folder.scheme),
      fsPath: folder.root,
      path: folder.root,
    },
  }
}

function createMissingProviderFailure(scheme, providerType) {
  const normalizedScheme = normalizeSearchScheme(scheme)
  return {
    scheme: normalizedScheme,
    providerType,
    code: SEARCH_ERROR_CODE_PROVIDER_UNAVAILABLE,
    reason: "missing-provider",
    message: `No ${providerType} search provider registered for scheme ${normalizedScheme}`,
    activationEvent: `onSearch:${normalizedScheme}`,
  }
}

function withSearchProviderFailures(result, providerFailures) {
  return {
    ...result,
    success: false,
    partial: Array.isArray(result.matches) && result.matches.length > 0,
    error: describeProviderFailures(providerFailures),
    providerFailures,
  }
}

function describeProviderFailures(providerFailures) {
  const schemes = providerFailures.map((failure) => `${failure.providerType}:${failure.scheme}`).join(", ")
  return `Search provider unavailable for ${schemes}`
}

function normalizeSearchScheme(scheme) {
  return String(scheme || "file").trim().toLowerCase() || "file"
}

function createFileSearchCacheKey({ root, include, exclude, visitedFileLimit } = {}) {
  return [
    path.resolve(root || ""),
    stablePatternKey(include),
    stablePatternKey(exclude),
    Number.isFinite(Number(visitedFileLimit)) ? Math.trunc(Number(visitedFileLimit)) : "",
  ].join("\u0000")
}

function stablePatternKey(value) {
  if (!Array.isArray(value)) return ""
  return value.map((item) => String(item || "").trim()).filter(Boolean).sort().join("|")
}

function disposeSearchServices({
  providerRegistry = defaultSearchProviderRegistry,
} = {}) {
  providerRegistry?.searchWorkerProcessHost?.dispose?.()
}

function register(router, opts = {}) {
  router.register("POST", "/search/files", async ({ body }) => {
    const workspaceState = typeof opts.getWorkspaceState === "function" ? opts.getWorkspaceState() : null
    const hasMultiFolderQuery = Array.isArray(body.folderQueries) || Array.isArray(body.roots)
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
      allowedRoots: Array.isArray(workspaceState?.workspaceRoots) ? workspaceState.workspaceRoots : undefined,
      workspaceScaleProfile: workspaceState?.workspaceScaleProfile || null,
      includeContentForSmallFiles: body.includeContentForSmallFiles === true,
      contentMaxFileBytes: typeof body.contentMaxFileBytes === "number" ? body.contentMaxFileBytes : undefined,
      contentMaxTotalBytes: typeof body.contentMaxTotalBytes === "number" ? body.contentMaxTotalBytes : undefined,
      providerRegistry: opts.searchProviderRegistry || defaultSearchProviderRegistry,
      rawSearchServiceState: opts.rawSearchServiceState || defaultRawSearchServiceState,
    })
    return { success: true, ...result }
  })
}

module.exports = {
  register,
  searchInWorkspace,
  searchWorkspace,
  createFileSearchCacheKey,
  disposeSearchServices,
  getSearchSchemesInQuery,
  normalizeWorkspaceSearchFolders,
  workspaceSearchProgressMessage,
  defaultSearchProviderRegistry,
  defaultRawSearchServiceState,
  defaultActivateSearchProviders,
}
