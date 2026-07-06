import { ref } from "vue"
import { getSearchSettings, matchesSearchSettings } from "../settings/searchSettings"
import { CancellationTokenSource } from "../vscode-adapter/base/common/cancellation"
import type { CodekSearchFileMatch, CodekSearchOccurrence } from "../vscode-adapter/workbench/contrib/search/searchModel"
import { CodekSearchWorkbenchService, globalSearchWorkbenchService } from "../vscode-adapter/workbench/contrib/search/searchWorkbenchService"
import type { ISearchService } from "../vscode-adapter/workbench/services/search/common/searchService"

interface WorkspaceSearchOptions {
  searchService?: ISearchService
  getSettings: () => Record<string, unknown>
  delay?: number
  serviceTimeoutMs?: number
}

type GrepOccurrence = CodekSearchOccurrence

interface WorkspaceFileSearchResult {
  path: string
  score?: number
  snippet?: string
}

type GrepFileGroup = CodekSearchFileMatch

interface GrepOptions {
  isRegex?: boolean
  caseSensitive?: boolean
  searchSettings?: ReturnType<typeof getSearchSettings>
}

const SEARCH_SERVICE_TIMEOUT_MS = 5000

function reportSearchSmokeStage(stage: string, detail: Record<string, unknown> = {}): void {
  if (
    typeof window === "undefined"
    || !((window as unknown as { __codekSmokeRealProjectUiStage?: unknown }).__codekSmokeRealProjectUiStage)
  ) return
  try {
    const payload = { stage, at: Date.now(), detail }
    ;(window as unknown as { __codekSmokeRealProjectUiStage?: unknown }).__codekSmokeRealProjectUiStage = payload
    console.info("[codek-smoke-real-project-ui-stage]", JSON.stringify(payload))
  } catch {
    // Smoke reporting must not affect search behavior.
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function getSearchErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error || "Search failed")
}

export function useWorkspaceSearch(options: WorkspaceSearchOptions) {
  const searchQuery = ref("")
  const searchReplaceQuery = ref("")
  const isRegex = ref(false)
  const caseSensitive = ref(false)
  const searchBusy = ref(false)
  const searchError = ref("")
  const searchResults = ref<WorkspaceFileSearchResult[]>([])
  const grepResults = ref<GrepFileGroup[]>([])
  const collapsedGrepFiles = ref(new Set<string>())
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let searchSequence = 0
  let activeSearchSource: CancellationTokenSource | null = null

  function createPattern(query = searchQuery.value): RegExp | null {
    const flags = caseSensitive.value ? "g" : "gi"
    try {
      return isRegex.value ? new RegExp(query, flags) : new RegExp(escapeRegExp(query), flags)
    } catch {
      return null
    }
  }

  async function grepInProject(query: string, grepOptions: GrepOptions = {}, tokenSource: CancellationTokenSource) {
    if (!query.trim()) return []

    const searchSettings = grepOptions.searchSettings ?? getSearchSettings(options.getSettings())
    reportSearchSmokeStage("search:grep-service:start", { queryLength: query.length })
    const serviceGroups = await grepWorkspaceService(query, grepOptions, searchSettings, tokenSource)
    reportSearchSmokeStage("search:grep-service:done", {
      groupCount: serviceGroups.length,
    })
    return serviceGroups
  }

  async function grepWorkspaceService(
    query: string,
    grepOptions: GrepOptions,
    searchSettings: ReturnType<typeof getSearchSettings>,
    tokenSource: CancellationTokenSource,
  ): Promise<GrepFileGroup[]> {
    const searchWorkbenchService = options.searchService
      ? new CodekSearchWorkbenchService({ searchService: options.searchService })
      : globalSearchWorkbenchService
    return withTimeout(
      searchWorkbenchService.legacyTextSearch({
        query,
        include: searchSettings.include,
        exclude: searchSettings.exclude,
        regex: Boolean(grepOptions.isRegex),
        caseSensitive: Boolean(grepOptions.caseSensitive),
        wholeWord: false,
        maxResults: 1000,
        includeContentForSmallFiles: true,
        includeMatch: (path) => matchesSearchSettings(path, searchSettings),
      }, tokenSource.token),
      options.serviceTimeoutMs ?? SEARCH_SERVICE_TIMEOUT_MS,
      () => tokenSource.cancel(),
    )
  }

  function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null
    return Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`workspace search timed out after ${timeoutMs}ms`))
          onTimeout()
        }, timeoutMs)
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer)
    })
  }

  async function refreshSearchResults(query: string): Promise<void> {
    if (!query.trim()) {
      activeSearchSource?.cancel()
      activeSearchSource?.dispose()
      activeSearchSource = null
      searchResults.value = []
      grepResults.value = []
      searchError.value = ""
      searchBusy.value = false
      return
    }

    const pattern = createPattern(query)
    if (!pattern) {
      activeSearchSource?.cancel()
      activeSearchSource?.dispose()
      activeSearchSource = null
      searchResults.value = []
      grepResults.value = []
      searchError.value = ""
      searchBusy.value = false
      return
    }

    activeSearchSource?.cancel()
    activeSearchSource?.dispose()
    const tokenSource = new CancellationTokenSource()
    activeSearchSource = tokenSource
    const sequence = ++searchSequence
    const searchSettings = getSearchSettings(options.getSettings())
    const grepOptions = {
      isRegex: isRegex.value,
      caseSensitive: caseSensitive.value,
      searchSettings,
    }

    searchBusy.value = true
    searchError.value = ""
    try {
      // Search view is Find in Files. Filename/path lookup belongs to Quick Open.
      searchResults.value = []
      reportSearchSmokeStage("search:refresh-service:start", { queryLength: query.length })
      const groups = await grepInProject(query, grepOptions, tokenSource)
      if (sequence !== searchSequence || tokenSource.token.isCancellationRequested) return
      grepResults.value = groups
      reportSearchSmokeStage("search:refresh-service:done", { groupCount: grepResults.value.length })
    } catch (error) {
      if (sequence !== searchSequence) return
      if (tokenSource.token.isCancellationRequested && !isSearchTimeoutError(error)) return
      searchError.value = getSearchErrorMessage(error)
      grepResults.value = []
    } finally {
      if (sequence === searchSequence) {
        searchBusy.value = false
        if (activeSearchSource === tokenSource) activeSearchSource = null
      }
      tokenSource.dispose()
    }
  }

  function scheduleSearch(query: string): void {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      void refreshSearchResults(query)
    }, options.delay ?? 320)
  }

  function toggleGrepFile(path: string): void {
    const next = new Set(collapsedGrepFiles.value)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
    }
    collapsedGrepFiles.value = next
  }

  return {
    searchQuery,
    searchReplaceQuery,
    isRegex,
    caseSensitive,
    searchBusy,
    searchError,
    searchResults,
    grepResults,
    collapsedGrepFiles,
    createPattern,
    refreshSearchResults,
    scheduleSearch,
    toggleGrepFile,
  }
}

function isSearchTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("workspace search timed out")
}
