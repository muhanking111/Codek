import type { IDisposable } from "../vscode-adapter/base/common/lifecycle"
import {
  groupTextSearchMatchesFromContent,
  type CodekRawTextMatch,
} from "../vscode-adapter/workbench/contrib/search/searchModel"
import {
  SearchProviderType,
  type CodekSearchResult,
  type ISearchService,
  type NormalizedCodekSearchQuery,
} from "../vscode-adapter/workbench/services/search/common/searchService"
import { matchesSearchSettings } from "../settings/searchSettings"

const WORKSPACE_MANAGER_SEARCH_STATE_SOURCE = "workspaceManager.searchTextInProject"
const OPENED_WORKSPACE_CACHE_STATE_SOURCE = "openedWorkspaceCache"

export interface WorkspaceSearchManagerLike {
  searchTextInProject(query: string, options?: Record<string, unknown>): Promise<CodekSearchResult | null>
  getAllFiles(): Record<string, unknown>
}

export interface WorkspaceSearchServiceProviderOptions {
  searchService: ISearchService
  workspaceManager: WorkspaceSearchManagerLike
}

export function registerWorkspaceSearchServiceProvider(
  options: WorkspaceSearchServiceProviderOptions,
): IDisposable {
  return options.searchService.registerSearchResultProvider("file", SearchProviderType.text, {
    textSearch: (query) => searchWorkspaceThroughManager(query, options.workspaceManager),
  })
}

async function searchWorkspaceThroughManager(
  query: NormalizedCodekSearchQuery,
  workspaceManager: WorkspaceSearchManagerLike,
): Promise<CodekSearchResult> {
  throwIfSearchAborted(query)
  try {
    const result = await workspaceManager.searchTextInProject(query.query, toWorkspaceSearchRequest(query))
    throwIfSearchAborted(query)
    if (result) return normalizeWorkspaceSearchResult(result, query)
  } catch (error) {
    throwIfSearchAborted(query)
    const fallback = searchOpenedWorkspaceCache(query, workspaceManager)
    if (fallback.matches.length) {
      return {
        ...fallback,
        success: false,
        partial: true,
        error: error instanceof Error ? error.message : String(error || "Workspace search failed"),
        stateSource: combineSearchStateSources(WORKSPACE_MANAGER_SEARCH_STATE_SOURCE, fallback.stateSource),
      }
    }
    throw error
  }
  return searchOpenedWorkspaceCache(query, workspaceManager)
}

function toWorkspaceSearchRequest(query: NormalizedCodekSearchQuery): Record<string, unknown> {
  return {
    include: query.include,
    exclude: query.exclude,
    regex: query.regex,
    caseSensitive: query.caseSensitive,
    wholeWord: query.wholeWord,
    maxResults: query.maxResults,
    searchLargeFiles: query.searchLargeFiles,
    searchMaxFileBytes: query.searchMaxFileBytes,
    includeContentForSmallFiles: query.includeContentForSmallFiles === true,
    contentMaxFileBytes: query.contentMaxFileBytes,
    contentMaxTotalBytes: query.contentMaxTotalBytes,
    signal: query.signal,
  }
}

function normalizeWorkspaceSearchResult(
  result: CodekSearchResult,
  query: NormalizedCodekSearchQuery,
): CodekSearchResult {
  const matches = Array.isArray(result.matches)
    ? result.matches.filter((match) => isIncludedSearchMatch(match, query))
    : []
  return {
    ...result,
    matches,
    truncated: result.truncated === true,
    stateSource: normalizeSearchStateSource(result.stateSource, WORKSPACE_MANAGER_SEARCH_STATE_SOURCE),
  }
}

function searchOpenedWorkspaceCache(
  query: NormalizedCodekSearchQuery,
  workspaceManager: WorkspaceSearchManagerLike,
): CodekSearchResult {
  const pattern = createSearchPattern(query)
  if (!pattern) return { matches: [], truncated: false }
  const grouped = groupTextSearchMatchesFromContent(
    workspaceManager.getAllFiles(),
    pattern,
    (path) => matchesSearchSettings(path, { include: query.include, exclude: query.exclude }),
  )
  const matches = grouped.flatMap((group) => group.matches.map((match): CodekRawTextMatch => ({
    path: group.path,
    line: match.line,
    column: match.column,
    matchLength: match.matchLength,
    preview: match.text,
    occurrences: match.occurrences,
  })))
  const maxResults = query.maxResults ?? matches.length
  return {
    matches: matches.slice(0, maxResults),
    truncated: matches.length > maxResults,
    fileContents: Object.fromEntries(
      Object.entries(workspaceManager.getAllFiles())
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .filter(([path]) => matches.some((match) => match.path === path)),
    ),
    stateSource: OPENED_WORKSPACE_CACHE_STATE_SOURCE,
  }
}

function createSearchPattern(query: NormalizedCodekSearchQuery): RegExp | null {
  const flags = query.caseSensitive ? "g" : "gi"
  try {
    return query.regex ? new RegExp(query.query, flags) : new RegExp(escapeRegExp(query.query), flags)
  } catch {
    return null
  }
}

function isIncludedSearchMatch(match: unknown, query: NormalizedCodekSearchQuery): boolean {
  const path = String((match as { path?: unknown } | null)?.path || "")
  return Boolean(path && matchesSearchSettings(path, { include: query.include, exclude: query.exclude }))
}

function throwIfSearchAborted(query: NormalizedCodekSearchQuery): void {
  if (!query.signal.aborted) return
  const error = new Error("Search cancelled")
  error.name = "AbortError"
  throw error
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizeSearchStateSource(value: unknown, fallback: string): string {
  const normalized = typeof value === "string" ? value.trim() : ""
  return normalized || fallback
}

function combineSearchStateSources(...values: unknown[]): string {
  const normalized = values
    .flatMap((value) => typeof value === "string" ? [value.trim()] : [])
    .filter((value) => value.length > 0)
  return [...new Set(normalized)].join("+")
}
