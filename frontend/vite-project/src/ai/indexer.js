import { reactive } from "vue"
import { parseAST } from "./ast"
import { normalizeRelativePath, readProjectFile, workspace } from "../workspace/manager"
import { discoverWorkspaceFiles, knownWorkspaceFiles } from "../workspace/fileDiscovery"
import { indexFile, searchIndex, clearProjectIndex, getIndexSize } from "./backend"
import { settingsStore } from "../settings/settingsStore"
import { isSensitiveFilePath } from "../workspace/privacyMode"

const MAX_INDEXED_FILES = 2_000
const MAX_INDEXED_CHARS = 200_000
const PREVIEW_CHARS = 1_200
const BG_TICK_MS = 160
const BG_FILES_PER_TICK = 3
const DEFAULT_INDEX_BUDGET = {
  maxFiles: MAX_INDEXED_FILES,
  tickMs: BG_TICK_MS,
  filesPerTick: BG_FILES_PER_TICK,
}

const indexCache = new Map()

let backendAvailable = false

export const indexingProgress = reactive({
  total: 0,
  done: 0,
  isIndexing: false,
  indexedFiles: 0,
  excludedFiles: 0,
  startedAt: 0,
  updatedAt: 0,
  backendAvailable: false,
})

let bgTimer = null
let bgAbortController = null
let bgWatchCleanup = null
let bgTickMs = BG_TICK_MS
let bgFilesPerTick = BG_FILES_PER_TICK

export async function checkBackendAvailability() {
  try {
    await getIndexSize(".")
    backendAvailable = true
    indexingProgress.backendAvailable = true
    return true
  } catch {
    backendAvailable = false
    indexingProgress.backendAvailable = false
    return false
  }
}

export function invalidateIndex(pathValue) {
  if (!pathValue) return
  indexCache.delete(normalizeRelativePath(pathValue))
}

function contentHash(content) {
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i)
    hash = ((hash << 5) - hash + ch) | 0
  }
  return String(hash)
}

export async function buildIndex(options = {}) {
  if (!isIndexingEnabled()) return []

  const budget = await resolveIndexBudget(options)
  const maxFiles = options.maxFiles || budget.maxFiles
  const discoveredPaths = options.knownOnly
    ? knownWorkspaceFiles(maxFiles * 2)
    : await discoverWorkspaceFiles({ limit: maxFiles * 2 })
  const snapshot = collectIndexableFilePathSnapshot(discoveredPaths)
  const paths = snapshot.indexable.slice(0, maxFiles)
  updateIndexSnapshot(paths.length, snapshot.excluded.length)
  const index = []
  const projectRoot = workspace.projectRoot || "unknown"

  if (backendAvailable && options.useBackend !== false) {
    return buildIndexWithBackend(paths, projectRoot, maxFiles)
  }

  for (const pathValue of paths) {
    const content = await readProjectFile(pathValue)
    if (typeof content !== "string" || content.length > MAX_INDEXED_CHARS) continue

    const cached = indexCache.get(pathValue)
    if (cached && cached.content === content) {
      index.push(cached.entry)
      continue
    }

    const ast = parseAST(content)
    const entry = {
      path: pathValue,
      name: pathValue.split("/").pop() || pathValue,
      functions: [...new Set([...(ast.functions || []), ...(ast.arrows || [])])].slice(0, 40),
      variables: [...new Set(ast.variables || [])].slice(0, 40),
      imports: [...new Set(ast.imports || [])].slice(0, 40),
      lineCount: ast.lines || 0,
      preview: content.slice(0, PREVIEW_CHARS),
      content,
    }

    indexCache.set(pathValue, { content, entry })
    index.push(entry)
  }

  indexingProgress.indexedFiles = index.length
  indexingProgress.updatedAt = Date.now()
  return index
}

async function buildIndexWithBackend(paths, projectRoot) {
  const index = []

  for (const pathValue of paths) {
    if (isSensitiveFilePath(pathValue)) continue
    const content = await readProjectFile(pathValue)
    if (typeof content !== "string" || content.length > MAX_INDEXED_CHARS) continue

    const hash = contentHash(content)
    const cached = indexCache.get(pathValue)
    if (cached && cached.hash === hash) {
      index.push(cached.entry)
      continue
    }

    const ast = parseAST(content)
    const entry = {
      path: pathValue,
      name: pathValue.split("/").pop() || pathValue,
      functions: [...new Set([...(ast.functions || []), ...(ast.arrows || [])])].slice(0, 40),
      variables: [...new Set(ast.variables || [])].slice(0, 40),
      imports: [...new Set(ast.imports || [])].slice(0, 40),
      lineCount: ast.lines || 0,
      preview: content.slice(0, PREVIEW_CHARS),
      content,
    }

    indexCache.set(pathValue, { hash, entry })
    index.push(entry)

    try {
      await indexFile({
        projectRoot,
        filePath: pathValue,
        name: entry.name,
        functions: entry.functions.join(", "),
        variables: entry.variables.join(", "),
        imports: entry.imports.join(", "),
        contentPreview: entry.preview,
        lineCount: entry.lineCount,
        contentHash: hash,
      })
    } catch {
      // backend indexing failure is non-critical for local fallback
    }
  }

  indexingProgress.indexedFiles = index.length
  indexingProgress.updatedAt = Date.now()
  return index
}

export async function searchWithBackend(query, projectRoot, limit = 30) {
  if (!backendAvailable) return []
  try {
    return searchIndex(query, projectRoot, limit)
  } catch {
    return []
  }
}

export async function clearBackendIndex(projectRoot) {
  if (!backendAvailable) return
  try {
    await clearProjectIndex(projectRoot)
  } catch {
    // ignore
  }
}

async function indexSingleFile(pathValue, projectRoot) {
  if (isSensitiveFilePath(pathValue)) {
    invalidateIndex(pathValue)
    indexingProgress.excludedFiles += 1
    indexingProgress.updatedAt = Date.now()
    return
  }

  const content = await readProjectFile(pathValue)
  if (typeof content !== "string" || content.length > MAX_INDEXED_CHARS) return

  if (backendAvailable) {
    const hash = contentHash(content)
    const cached = indexCache.get(pathValue)
    if (cached && cached.hash === hash) return

    const ast = parseAST(content)
    const entry = {
      path: pathValue,
      name: pathValue.split("/").pop() || pathValue,
      functions: [...new Set([...(ast.functions || []), ...(ast.arrows || [])])].slice(0, 40),
      variables: [...new Set(ast.variables || [])].slice(0, 40),
      imports: [...new Set(ast.imports || [])].slice(0, 40),
      lineCount: ast.lines || 0,
      preview: content.slice(0, PREVIEW_CHARS),
      content,
    }

    indexCache.set(pathValue, { hash, entry })

    try {
      await indexFile({
        projectRoot,
        filePath: pathValue,
        name: entry.name,
        functions: entry.functions.join(", "),
        variables: entry.variables.join(", "),
        imports: entry.imports.join(", "),
        contentPreview: entry.preview,
        lineCount: entry.lineCount,
        contentHash: hash,
      })
    } catch {
      // backend indexing failure is non-critical
    }
    indexingProgress.indexedFiles = Math.max(indexingProgress.indexedFiles, indexCache.size)
    indexingProgress.updatedAt = Date.now()
    return
  }

  const cached = indexCache.get(pathValue)
  if (cached && cached.content === content) return

  const ast = parseAST(content)
  const entry = {
    path: pathValue,
    name: pathValue.split("/").pop() || pathValue,
    functions: [...new Set([...(ast.functions || []), ...(ast.arrows || [])])].slice(0, 40),
    variables: [...new Set(ast.variables || [])].slice(0, 40),
    imports: [...new Set(ast.imports || [])].slice(0, 40),
    lineCount: ast.lines || 0,
    preview: content.slice(0, PREVIEW_CHARS),
    content,
  }

  indexCache.set(pathValue, { content, entry })
  indexingProgress.indexedFiles = Math.max(indexingProgress.indexedFiles, indexCache.size)
  indexingProgress.updatedAt = Date.now()
}

async function bgTick(paths, projectRoot) {
  if (bgAbortController?.signal?.aborted) return

  const start = indexingProgress.done
  const batch = paths.slice(start, start + bgFilesPerTick)

  for (const pathValue of batch) {
    if (bgAbortController?.signal?.aborted) return
    try {
      await indexSingleFile(pathValue, projectRoot)
    } catch {
      // skip files that fail to index
    }
    indexingProgress.done += 1
    indexingProgress.indexedFiles = Math.max(indexingProgress.indexedFiles, Math.min(indexCache.size, indexingProgress.total))
    indexingProgress.updatedAt = Date.now()
  }

  if (indexingProgress.done >= indexingProgress.total) {
    indexingProgress.isIndexing = false
    return
  }

  bgTimer = setTimeout(() => bgTick(paths, projectRoot), bgTickMs)
}

export async function startBackgroundIndexing(projectRoot, options = {}) {
  stopBackgroundIndexing()

  if (!isIndexingEnabled() || !projectRoot) return

  const budget = await resolveIndexBudget()
  bgTickMs = budget.tickMs
  bgFilesPerTick = budget.filesPerTick
  const discoveredPaths = options.knownOnly
    ? knownWorkspaceFiles(budget.maxFiles * 2)
    : await discoverWorkspaceFiles({ limit: budget.maxFiles * 2 })
  const snapshot = collectIndexableFilePathSnapshot(discoveredPaths)
  const paths = snapshot.indexable.slice(0, budget.maxFiles)

  if (paths.length === 0) return

  indexingProgress.total = paths.length
  indexingProgress.done = 0
  indexingProgress.indexedFiles = Math.min(indexCache.size, paths.length)
  indexingProgress.excludedFiles = snapshot.excluded.length
  indexingProgress.isIndexing = true
  indexingProgress.startedAt = Date.now()
  indexingProgress.updatedAt = indexingProgress.startedAt

  bgAbortController = new AbortController()
  bgTick(paths, projectRoot)

  setupFileWatcher()
}

async function resolveIndexBudget(options = {}) {
  if (options.maxFiles) {
    return {
      ...DEFAULT_INDEX_BUDGET,
      maxFiles: Number(options.maxFiles),
    }
  }
  const profile = await getWorkspaceScaleProfile()
  const maxFiles = Number(profile?.budgets?.indexMaxFiles || MAX_INDEXED_FILES)
  if (profile?.scale === "huge") {
    return {
      maxFiles,
      tickMs: 220,
      filesPerTick: 2,
    }
  }
  if (profile?.scale === "large") {
    return {
      maxFiles,
      tickMs: 180,
      filesPerTick: 3,
    }
  }
  return {
    maxFiles,
    tickMs: BG_TICK_MS,
    filesPerTick: BG_FILES_PER_TICK,
  }
}

async function getWorkspaceScaleProfile() {
  if (typeof window === "undefined" || typeof window.codek?.getWorkspaceScaleProfile !== "function") return null
  try {
    return await window.codek.getWorkspaceScaleProfile()
  } catch {
    return null
  }
}

export function stopBackgroundIndexing() {
  if (bgTimer) {
    clearTimeout(bgTimer)
    bgTimer = null
  }

  if (bgAbortController) {
    bgAbortController.abort()
    bgAbortController = null
  }

  if (bgWatchCleanup) {
    bgWatchCleanup()
    bgWatchCleanup = null
  }

  indexingProgress.isIndexing = false
  indexingProgress.updatedAt = Date.now()
}

function setupFileWatcher() {
  if (typeof window === "undefined" || !window.codek?.onFileChange) return

  const handler = (event) => {
    if (!event?.path || !workspace.projectRoot) return
    const pathValue = normalizeRelativePath(event.path)
    if (!pathValue) return
    invalidateIndex(pathValue)

    if (indexingProgress.isIndexing) return
    indexSingleFile(pathValue, workspace.projectRoot).catch(() => {
      // ignore single file indexing errors
    })
  }

  window.codek.onFileChange(handler)
  bgWatchCleanup = () => {
    if (typeof window !== "undefined" && window.codek?.offFileChange) {
      window.codek.offFileChange(handler)
    }
  }
}

function isIndexingEnabled() {
  return settingsStore.get("codek.indexing.enabled", true) !== false
}

function collectIndexableFilePathSnapshot(paths) {
  const all = (paths || []).map(normalizeRelativePath).filter(Boolean)
  const indexable = []
  const excluded = []
  for (const pathValue of all) {
    if (isSensitiveFilePath(pathValue)) excluded.push(pathValue)
    else indexable.push(pathValue)
  }
  return { indexable, excluded }
}

function updateIndexSnapshot(indexableFiles, excludedFiles) {
  indexingProgress.total = indexableFiles
  indexingProgress.excludedFiles = excludedFiles
  indexingProgress.updatedAt = Date.now()
}

export function getIndexStatus() {
  const enabled = isIndexingEnabled()
  const now = Date.now()
  const updatedAt = indexingProgress.updatedAt || null
  const staleAfterMs = 60_000
  const freshness = !enabled
    ? "disabled"
    : indexingProgress.isIndexing
      ? "indexing"
      : updatedAt && now - updatedAt <= staleAfterMs
        ? "fresh"
        : updatedAt
          ? "stale"
          : "not-started"

  return {
    enabled,
    state: indexingProgress.isIndexing ? "indexing" : enabled ? "idle" : "disabled",
    indexedFiles: indexingProgress.indexedFiles || Math.min(indexCache.size, indexingProgress.total || indexCache.size),
    indexableFiles: indexingProgress.total || 0,
    excludedFiles: indexingProgress.excludedFiles || 0,
    workspaceRoots: workspace.workspaceRoots?.length || (workspace.projectRoot ? 1 : 0),
    freshness,
    updatedAt,
    backendAvailable: indexingProgress.backendAvailable === true,
  }
}

settingsStore.subscribe((settings) => {
  if (settings["codek.indexing.enabled"] === false) {
    stopBackgroundIndexing()
  }
})
