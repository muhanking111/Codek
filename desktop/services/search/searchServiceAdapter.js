/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code SearchService provider orchestration:
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\common\searchService.ts
 *--------------------------------------------------------------------------------------------*/

const path = require("path")
const { SCALE_BUDGETS } = require("../workspace/workspaceScaleProfile")

function normalizeWorkspaceSearchFolders({ root, roots, folderQueries } = {}) {
  const folders = []
  const pushFolder = (value, index = folders.length) => {
    if (!value) return
    const folder = typeof value === "string" ? { root: value } : value
    const rawFolder = folder.folder
    const folderRoot = folder.root
      || folder.path
      || folder.fsPath
      || (typeof rawFolder === "string" ? rawFolder : null)
      || rawFolder?.fsPath
      || rawFolder?.path
    if (!folderRoot || typeof folderRoot !== "string") return
    const normalizedRoot = path.resolve(folderRoot)
    const scheme = normalizeScheme(folder.scheme || rawFolder?.scheme || "file")
    const duplicateKey = `${scheme}:${path.normalize(normalizedRoot).toLowerCase()}`
    const existing = folders.find((entry) => entry.key === duplicateKey)
    if (existing) return
    folders.push({
      key: duplicateKey,
      root: normalizedRoot,
      rootLabel: typeof folder.rootLabel === "string" && folder.rootLabel
        ? folder.rootLabel
        : path.basename(normalizedRoot),
      folderIndex: Number.isFinite(Number(folder.folderIndex)) ? Number(folder.folderIndex) : index,
      scheme,
    })
  }

  if (Array.isArray(folderQueries) && folderQueries.length) {
    folderQueries.forEach(pushFolder)
  } else if (Array.isArray(roots) && roots.length) {
    roots.forEach(pushFolder)
  } else {
    pushFolder(root)
  }
  return folders.map(({ key: _key, ...folder }) => folder)
}

function groupWorkspaceFoldersByScheme(folders) {
  const grouped = new Map()
  for (const folder of folders || []) {
    const scheme = normalizeScheme(folder.scheme || "file")
    const schemeFolders = grouped.get(scheme) || []
    schemeFolders.push(folder)
    grouped.set(scheme, schemeFolders)
  }
  return grouped
}

function getSearchSchemesInQuery(query = {}) {
  const schemes = []
  const seen = new Set()
  const addScheme = (value) => {
    const scheme = normalizeScheme(value || "file")
    if (seen.has(scheme)) return
    seen.add(scheme)
    schemes.push(scheme)
  }

  const folders = normalizeWorkspaceSearchFolders({
    root: query.root,
    roots: query.roots,
    folderQueries: query.folderQueries,
  })
  for (const folder of folders) addScheme(folder.scheme)

  if (Array.isArray(query.extraFileResources)) {
    for (const resource of query.extraFileResources) {
      addScheme(resource?.scheme)
    }
  }

  if (!schemes.length) addScheme("file")
  return schemes
}

async function runWorkspaceSearch({
  root,
  roots,
  folderQueries,
  maxResults,
  signal,
  onProgress,
  runFolderSearch,
} = {}) {
  if (typeof runFolderSearch !== "function") {
    throw new TypeError("runWorkspaceSearch requires runFolderSearch")
  }

  const folders = normalizeWorkspaceSearchFolders({ root, roots, folderQueries })
  if (!folders.length) return emptyWorkspaceSearchResult()
  const resultLimit = Math.max(1, Number(maxResults || SCALE_BUDGETS.normal.searchMaxResults || 1000))
  const groupedFolders = groupWorkspaceFoldersByScheme(folders)

  emitWorkspaceSearchProgress(onProgress, "search:workspace:start", {
    folderCount: folders.length,
  })

  const folderTasks = []
  let order = 0
  for (const [scheme, schemeFolders] of groupedFolders) {
    for (const folder of schemeFolders) {
      const folderOrder = order
      order += 1
      folderTasks.push(runOneFolderSearch({
        folder,
        scheme,
        order: folderOrder,
        resultLimit,
        signal,
        onProgress,
        runFolderSearch,
      }))
    }
  }

  const folderResults = await Promise.all(folderTasks)
  const result = aggregateWorkspaceSearchResults({
    folders,
    folderResults: folderResults.sort((left, right) => left.order - right.order),
    resultLimit,
  })

  emitWorkspaceSearchProgress(onProgress, "search:workspace:done", {
    folderCount: folders.length,
    matchCount: result.matches.length,
    truncated: result.truncated,
  })

  return result
}

async function runOneFolderSearch({
  folder,
  scheme,
  order,
  resultLimit,
  signal,
  onProgress,
  runFolderSearch,
}) {
  throwIfAborted(signal)
  emitWorkspaceSearchProgress(onProgress, "search:workspace:folder", {
    root: folder.root,
    rootLabel: folder.rootLabel,
    folderIndex: folder.folderIndex,
    scheme,
    remainingResults: resultLimit,
  })

  try {
    const result = await runFolderSearch(folder, {
      maxResults: resultLimit,
      signal,
      onProgress: (progress) => {
        if (typeof onProgress !== "function") return
        onProgress({
          ...progress,
          detail: {
            ...(progress?.detail || {}),
            root: folder.root,
            rootLabel: folder.rootLabel,
            folderIndex: folder.folderIndex,
            scheme,
          },
        })
      },
    })
    throwIfAborted(signal)
    return { order, folder, result: result || emptyFolderSearchResult() }
  } catch (error) {
    if (isAbortError(error, signal)) throw normalizeAbortError(error)
    return {
      order,
      folder,
      result: {
        ...emptyFolderSearchResult(),
        error: error?.message || String(error || "Search failed"),
      },
    }
  }
}

function aggregateWorkspaceSearchResults({ folders, folderResults, resultLimit }) {
  const matches = []
  const acceptedPathsByRoot = new Map()
  const fileContents = {}
  const fileContentsByRoot = {}
  const errors = []
  const providerFailures = []
  let truncated = false
  let visitedFiles = 0
  let visitedDirs = 0
  let skippedLargeFiles = 0
  let fileContentBytes = 0
  let engine = null
  let totalResultCount = 0

  for (const { folder, result } of folderResults) {
    if (result?.error) errors.push({ root: folder.root, rootLabel: folder.rootLabel, error: result.error })
    if (Array.isArray(result?.providerFailures)) providerFailures.push(...result.providerFailures)
    const rootMatches = Array.isArray(result?.matches) ? result.matches : []
    totalResultCount += rootMatches.length
    for (const match of rootMatches) {
      if (matches.length >= resultLimit) {
        truncated = true
        break
      }
      const relativePath = match.path
      matches.push({
        ...match,
        root: folder.root,
        rootLabel: folder.rootLabel,
        folderIndex: folder.folderIndex,
      })
      if (relativePath) {
        const accepted = acceptedPathsByRoot.get(folder.root) || new Set()
        accepted.add(relativePath)
        acceptedPathsByRoot.set(folder.root, accepted)
      }
    }

    truncated = truncated || result?.truncated === true
    visitedFiles += Number(result?.visitedFiles || 0)
    visitedDirs += Number(result?.visitedDirs || 0)
    skippedLargeFiles += Number(result?.skippedLargeFiles || 0)
    engine = engine || result?.engine || null
  }

  if (totalResultCount > resultLimit) truncated = true

  for (const { folder, result } of folderResults) {
    const accepted = acceptedPathsByRoot.get(folder.root)
    if (!accepted || !result?.fileContents || typeof result.fileContents !== "object") continue
    fileContentsByRoot[folder.root] = fileContentsByRoot[folder.root] || {}
    for (const [relativePath, content] of Object.entries(result.fileContents)) {
      if (!accepted.has(relativePath) || typeof content !== "string") continue
      fileContentsByRoot[folder.root][relativePath] = content
      fileContents[`${folder.root}\u0000${relativePath}`] = content
      if (folders.length === 1) fileContents[relativePath] = content
      fileContentBytes += Buffer.byteLength(content, "utf8")
    }
  }

  const aggregated = {
    matches,
    truncated,
    visitedFiles,
    visitedDirs,
    skippedLargeFiles,
    fileContents,
    fileContentsByRoot,
    fileContentBytes,
    engine: engine || "workspace",
    errors,
    folderCount: folders.length,
  }
  if (!providerFailures.length) return aggregated
  return withSearchProviderFailures(aggregated, providerFailures)
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

function emitWorkspaceSearchProgress(onProgress, stage, detail = {}) {
  if (typeof onProgress !== "function") return
  onProgress({
    type: "message",
    stage,
    message: workspaceSearchProgressMessage(stage, detail),
    detail,
  })
}

function workspaceSearchProgressMessage(stage, detail = {}) {
  switch (stage) {
    case "search:workspace:start":
      return "Searching workspace folders"
    case "search:workspace:folder":
      return detail.rootLabel ? `Searching ${detail.rootLabel}` : "Searching folder"
    case "search:workspace:done":
      return "Workspace search complete"
    default:
      return String(stage || "Search")
  }
}

function emptyWorkspaceSearchResult() {
  return { matches: [], truncated: false, visitedFiles: 0, visitedDirs: 0 }
}

function emptyFolderSearchResult() {
  return { matches: [], truncated: false, visitedFiles: 0, visitedDirs: 0 }
}

function normalizeScheme(scheme) {
  return String(scheme || "file").trim().toLowerCase() || "file"
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
  aggregateWorkspaceSearchResults,
  getSearchSchemesInQuery,
  groupWorkspaceFoldersByScheme,
  normalizeWorkspaceSearchFolders,
  runWorkspaceSearch,
  workspaceSearchProgressMessage,
}
