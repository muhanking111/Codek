/*---------------------------------------------------------------------------------------------
 * VS Code-style Search workbench facade.
 *
 * The facade does not own a second search state. It projects the existing
 * ISearchService result into the search tree model and routes replace preview
 * / apply through the existing replace and bulk edit services.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, type CancellationToken as CancellationTokenShape } from "../../../base/common/cancellation"
import { InstantiationType, registerSingleton } from "../../../platform/instantiation/common/extensions"
import { createDecorator } from "../../../platform/instantiation/common/instantiation"
import type { BulkEditResult } from "../../services/bulkEdit/common/bulkEditService"
import {
  globalSearchService,
  QueryType,
  type CodekSearchFolderQuery,
  type CodekSearchQuery,
  type CodekSearchResult,
  type ISearchService,
  type SearchProgressItem,
  type SearchProviderFailure,
} from "../../services/search/common/searchService"
import { globalReplaceService, type CodekReplaceRequest, type IReplaceService } from "./browser/replaceService"
import {
  groupTextSearchMatches,
  type CodekRawTextMatch,
  type CodekSearchFileContents,
  type CodekSearchFileMatch,
} from "./searchModel"

export interface ISearchWorkbenchService {
  readonly _serviceBrand: undefined
  createTextQuery(request: CodekSearchWorkbenchTextSearchRequest): CodekSearchQuery
  projectTextSearchResult(result: CodekSearchResult, options?: CodekSearchWorkbenchProjectionOptions): CodekSearchWorkbenchProjection
  textSearch(
    request: CodekSearchWorkbenchTextSearchRequest,
    token?: CancellationTokenShape,
    onProgress?: (progress: SearchProgressItem) => void,
  ): Promise<CodekSearchWorkbenchProjection>
  legacyTextSearch(
    request: CodekSearchWorkbenchTextSearchRequest,
    token?: CancellationTokenShape,
    onProgress?: (progress: SearchProgressItem) => void,
  ): Promise<CodekSearchFileMatch[]>
  previewReplace(request: CodekReplacePreviewRequest, token?: CancellationTokenShape): Promise<CodekReplacePreview>
  applyReplacePreview(preview: CodekReplacePreview, token?: CancellationTokenShape): Promise<BulkEditResult>
}

export interface CodekSearchWorkbenchTextSearchRequest {
  readonly root?: string
  readonly roots?: readonly (string | CodekSearchFolderQuery)[]
  readonly folderQueries?: readonly CodekSearchFolderQuery[]
  readonly query: string
  readonly include?: readonly string[] | string
  readonly exclude?: readonly string[] | string
  readonly regex?: boolean
  readonly caseSensitive?: boolean
  readonly wholeWord?: boolean
  readonly maxResults?: number
  readonly previewOptions?: Record<string, unknown>
  readonly includeContentForSmallFiles?: boolean
  readonly encoding?: string
  readonly searchLargeFiles?: boolean
  readonly searchMaxFileBytes?: number
  readonly contentMaxFileBytes?: number
  readonly contentMaxTotalBytes?: number
  readonly extraFileResources?: CodekSearchQuery["extraFileResources"]
  readonly includeMatch?: (path: string) => boolean
}

export interface CodekSearchWorkbenchProjectionOptions {
  readonly query?: CodekSearchQuery
  readonly includeMatch?: (path: string) => boolean
}

export interface CodekSearchWorkbenchProjection {
  readonly source: "searchWorkbenchService"
  readonly query?: CodekSearchQuery
  readonly resultTree: CodekSearchFileMatch[]
  readonly rawMatches: CodekRawTextMatch[]
  readonly fileContents: CodekSearchFileContents
  readonly matchCount: number
  readonly fileCount: number
  readonly truncated: boolean
  readonly success: boolean
  readonly partial: boolean
  readonly error?: string
  readonly providerFailures?: readonly SearchProviderFailure[]
  readonly evidence: SearchWorkbenchEvidence
}

export interface SearchWorkbenchEvidence {
  readonly serviceId: string
  readonly stateSource: string
  readonly searchServiceOwner: "ISearchService"
  readonly textSearchProviderOwner: "ISearchService.registerSearchResultProvider(file,text)"
  readonly queryOwner: "searchWorkbenchService.createTextQuery"
  readonly resultModelOwner: "searchModel.resultTree"
  readonly resultSource: string
  readonly resourceUriKind: SearchWorkbenchResourceUriKind
  readonly cancellationOwner: "CancellationToken -> AbortSignal"
  readonly remainingUiOwnerGap: SearchWorkbenchUiOwnerGap
  readonly workspaceMutation: "none" | "bulkEditService"
  readonly preservesAgentEvidence: true
  readonly safetyBoundary: string
  readonly owners: SearchWorkbenchOwnerEvidence
}

export interface SearchWorkbenchOwnerEvidence {
  readonly searchService: "ISearchService"
  readonly textSearchProvider: "ISearchService.textSearch"
  readonly query: "searchWorkbenchService.createTextQuery"
  readonly resultTree: "searchModel.resultTree"
  readonly resultSource: "CodekSearchResult.stateSource"
  readonly resourceUriKind: "CodekSearchQuery folder/root/extraFileResources + result paths"
  readonly cancellation: "CancellationToken -> AbortSignal"
  readonly replacePreview: "IReplaceService.openReplacePreview-compatible"
  readonly applyReplace: "IReplaceService.replaceOne/replaceAll -> bulkEditService.apply"
  readonly fileActionNavigation: "Search resultTree match -> navigationService.openLocation"
  readonly history: "SearchHistoryService"
  readonly contextKeys: "SearchContext"
  readonly remainingUiOwnerGap: "SearchPanel is partial; VS Code SearchView owner not connected"
  readonly rawMatchesRole: "adapter-normalization-only"
  readonly secondSearchStateSource: false
}

export type SearchWorkbenchResourceUriKind = "file" | "non-file" | "mixed" | "unknown"

export interface SearchWorkbenchUiOwnerGap {
  readonly status: "partial"
  readonly connected: false
  readonly currentOwner: "SearchPanel.vue"
  readonly vscodeOwner: "SearchView + SearchWidget + SearchResultsView"
  readonly reason: string
}

export interface SearchMigrationAuditEvidence {
  readonly vscodeSourceEntrypoints: readonly string[]
  readonly codekEntrypoints: readonly string[]
  readonly stateSource: typeof DEFAULT_SEARCH_WORKBENCH_STATE_SOURCE
  readonly searchServiceOwner: "ISearchService"
  readonly textSearchProviderOwner: "ISearchService.registerSearchResultProvider(file,text)"
  readonly queryOwner: "searchWorkbenchService.createTextQuery"
  readonly resultTreeOwner: "searchModel.resultTree"
  readonly resultSource: "CodekSearchResult.stateSource"
  readonly resourceUriKind: "CodekSearchQuery folder/root/extraFileResources + result paths"
  readonly cancellationOwner: "CancellationToken -> AbortSignal"
  readonly replacePreviewOwner: "IReplaceService.openReplacePreview-compatible"
  readonly applyReplaceOwner: "IReplaceService.replaceOne/replaceAll -> bulkEditService.apply"
  readonly fileActionNavigationOwner: "Search resultTree match -> navigationService.openLocation"
  readonly historyOwner: "SearchHistoryService"
  readonly contextKeyOwner: "SearchContext"
  readonly remainingUiOwnerGap: SearchWorkbenchUiOwnerGap
  readonly rawMatchesRole: "adapter-normalization-only"
  readonly temporaryProviderInSearchPanel: false
  readonly secondSearchStateSource: false
}

export interface CodekReplacePreviewRequest {
  readonly mode: "one" | "all"
  readonly request: CodekReplaceRequest
}

export interface CodekReplacePreview {
  readonly source: "searchWorkbenchService.replacePreview"
  readonly mode: "one" | "all"
  readonly result: BulkEditResult
  readonly request: CodekReplaceRequest
  readonly applyRequest: CodekReplaceRequest
  readonly evidence: SearchWorkbenchEvidence
}

export const ISearchWorkbenchService = createDecorator<ISearchWorkbenchService>("searchWorkbenchService")
const DEFAULT_SEARCH_WORKBENCH_STATE_SOURCE = "ISearchService.textSearch -> searchModel.resultTree"
const REPLACE_PREVIEW_STATE_SOURCE = "IReplaceService.replaceOne/replaceAll -> bulkEditService.apply -> workspaceEditService.apply"

export const SEARCH_MIGRATION_AUDIT_EVIDENCE: SearchMigrationAuditEvidence = {
  vscodeSourceEntrypoints: [
    "src/vs/workbench/services/search/common/search.ts",
    "src/vs/workbench/services/search/common/queryBuilder.ts",
    "src/vs/workbench/contrib/search/browser/searchTreeModel/searchModel.ts",
    "src/vs/workbench/contrib/search/browser/searchTreeModel/searchResult.ts",
    "src/vs/workbench/contrib/search/browser/searchTreeModel/fileMatch.ts",
    "src/vs/workbench/contrib/search/browser/searchTreeModel/folderMatch.ts",
    "src/vs/workbench/contrib/search/browser/searchTreeModel/textSearchHeading.ts",
    "src/vs/workbench/contrib/search/browser/searchView.ts",
    "src/vs/workbench/contrib/search/browser/replace.ts",
    "src/vs/workbench/contrib/search/common/searchHistoryService.ts",
    "src/vs/workbench/contrib/search/common/constants.ts",
  ],
  codekEntrypoints: [
    "frontend/vite-project/src/vscode-adapter/workbench/services/search/common/searchService.ts",
    "frontend/vite-project/src/vscode-adapter/workbench/contrib/search/searchWorkbenchService.ts",
    "frontend/vite-project/src/vscode-adapter/workbench/contrib/search/searchModel.ts",
    "frontend/vite-project/src/components/SearchPanel.vue",
  ],
  stateSource: DEFAULT_SEARCH_WORKBENCH_STATE_SOURCE,
  searchServiceOwner: "ISearchService",
  textSearchProviderOwner: "ISearchService.registerSearchResultProvider(file,text)",
  queryOwner: "searchWorkbenchService.createTextQuery",
  resultTreeOwner: "searchModel.resultTree",
  resultSource: "CodekSearchResult.stateSource",
  resourceUriKind: "CodekSearchQuery folder/root/extraFileResources + result paths",
  cancellationOwner: "CancellationToken -> AbortSignal",
  replacePreviewOwner: "IReplaceService.openReplacePreview-compatible",
  applyReplaceOwner: "IReplaceService.replaceOne/replaceAll -> bulkEditService.apply",
  fileActionNavigationOwner: "Search resultTree match -> navigationService.openLocation",
  historyOwner: "SearchHistoryService",
  contextKeyOwner: "SearchContext",
  remainingUiOwnerGap: createSearchWorkbenchUiOwnerGap(),
  rawMatchesRole: "adapter-normalization-only",
  temporaryProviderInSearchPanel: false,
  secondSearchStateSource: false,
}

export class CodekSearchWorkbenchService implements ISearchWorkbenchService {
  declare readonly _serviceBrand: undefined

  constructor(
    private readonly options: {
      readonly searchService?: ISearchService
      readonly replaceService?: IReplaceService
    } = {},
  ) {}

  createTextQuery(request: CodekSearchWorkbenchTextSearchRequest): CodekSearchQuery {
    return createTextSearchWorkbenchQuery(request)
  }

  projectTextSearchResult(
    result: CodekSearchResult,
    options: CodekSearchWorkbenchProjectionOptions = {},
  ): CodekSearchWorkbenchProjection {
    return projectTextSearchWorkbenchResult(result, options)
  }

  async textSearch(
    request: CodekSearchWorkbenchTextSearchRequest,
    token: CancellationTokenShape = CancellationToken.None,
    onProgress?: (progress: SearchProgressItem) => void,
  ): Promise<CodekSearchWorkbenchProjection> {
    const query = this.createTextQuery(request)
    const result = await (this.options.searchService || globalSearchService).textSearch(query, token, onProgress)
    return this.projectTextSearchResult(result, {
      query,
      includeMatch: request.includeMatch,
    })
  }

  async legacyTextSearch(
    request: CodekSearchWorkbenchTextSearchRequest,
    token: CancellationTokenShape = CancellationToken.None,
    onProgress?: (progress: SearchProgressItem) => void,
  ): Promise<CodekSearchFileMatch[]> {
    const projection = await this.textSearch(request, token, onProgress)
    return projection.resultTree
  }

  async previewReplace(
    previewRequest: CodekReplacePreviewRequest,
    token: CancellationTokenShape = CancellationToken.None,
  ): Promise<CodekReplacePreview> {
    const replaceService = this.options.replaceService || globalReplaceService
    const request = { ...previewRequest.request, dryRun: true }
    const result = previewRequest.mode === "one"
      ? await replaceService.replaceOne(request, token)
      : await replaceService.replaceAll(request, token)
    return {
      source: "searchWorkbenchService.replacePreview",
      mode: previewRequest.mode,
      result,
      request,
      applyRequest: { ...previewRequest.request, dryRun: false },
      evidence: createSearchWorkbenchEvidence({
        workspaceMutation: "bulkEditService",
        stateSource: REPLACE_PREVIEW_STATE_SOURCE,
      }),
    }
  }

  async applyReplacePreview(
    preview: CodekReplacePreview,
    token: CancellationTokenShape = CancellationToken.None,
  ): Promise<BulkEditResult> {
    const replaceService = this.options.replaceService || globalReplaceService
    return preview.mode === "one"
      ? replaceService.replaceOne(preview.applyRequest, token)
      : replaceService.replaceAll(preview.applyRequest, token)
  }
}

export const globalSearchWorkbenchService = new CodekSearchWorkbenchService()
registerSingleton(ISearchWorkbenchService, globalSearchWorkbenchService, InstantiationType.Delayed)

export function createTextSearchWorkbenchQuery(request: CodekSearchWorkbenchTextSearchRequest): CodekSearchQuery {
  return {
    type: QueryType.Text,
    root: request.root,
    roots: request.roots,
    folderQueries: request.folderQueries,
    contentPattern: {
      pattern: request.query,
      isRegExp: request.regex === true,
      isCaseSensitive: request.caseSensitive === true,
      isWordMatch: request.wholeWord === true,
    },
    query: request.query,
    include: request.include,
    exclude: request.exclude,
    regex: request.regex === true,
    caseSensitive: request.caseSensitive === true,
    wholeWord: request.wholeWord === true,
    maxResults: request.maxResults,
    previewOptions: request.previewOptions,
    includeContentForSmallFiles: request.includeContentForSmallFiles === true,
    encoding: request.encoding,
    searchLargeFiles: request.searchLargeFiles === true,
    searchMaxFileBytes: request.searchMaxFileBytes,
    contentMaxFileBytes: request.contentMaxFileBytes,
    contentMaxTotalBytes: request.contentMaxTotalBytes,
    extraFileResources: request.extraFileResources,
  }
}

export function projectTextSearchWorkbenchResult(
  result: CodekSearchResult,
  options: CodekSearchWorkbenchProjectionOptions = {},
): CodekSearchWorkbenchProjection {
  const rawMatches = normalizeRawTextSearchMatches(result?.matches)
  const fileContents = isPlainRecord(result?.fileContents) ? result.fileContents as CodekSearchFileContents : {}
  const resultTree = groupTextSearchMatches(rawMatches, {
    fileContents,
    includeMatch: options.includeMatch,
  })
  return {
    source: "searchWorkbenchService",
    query: options.query,
    resultTree,
    rawMatches,
    fileContents,
    matchCount: resultTree.reduce((count, fileMatch) => count + fileMatch.matches.reduce((sum, match) => sum + match.count, 0), 0),
    fileCount: resultTree.length,
    truncated: result?.truncated === true,
    success: result?.success !== false,
    partial: result?.partial === true,
    error: typeof result?.error === "string" ? result.error : undefined,
    providerFailures: Array.isArray(result?.providerFailures) ? result.providerFailures : undefined,
    evidence: createSearchWorkbenchEvidence({
      workspaceMutation: "none",
      stateSource: resolveSearchWorkbenchStateSource(result),
      resultSource: resolveSearchWorkbenchResultSource(result),
      resourceUriKind: resolveSearchWorkbenchResourceUriKind(options.query, rawMatches),
    }),
  }
}

export function normalizeRawTextSearchMatches(matches: readonly unknown[] | undefined): CodekRawTextMatch[] {
  if (!Array.isArray(matches)) return []
  return matches.flatMap((match): CodekRawTextMatch[] => {
    if (!match || typeof match !== "object") return []
    const candidate = match as Record<string, unknown>
    if (Array.isArray(candidate.results)) return normalizeVsCodeFileMatch(candidate)
    return normalizeFlatTextMatch(candidate)
  })
}

function normalizeFlatTextMatch(match: Record<string, unknown>): CodekRawTextMatch[] {
  const path = resourcePath(match.path)
  if (!path) return []
  return [{
    path,
    line: normalizePositiveInteger(match.line, 1),
    column: typeof match.column === "number" ? match.column : undefined,
    matchLength: typeof match.matchLength === "number" ? match.matchLength : undefined,
    preview: typeof match.preview === "string" ? match.preview : undefined,
    occurrences: Array.isArray(match.occurrences)
      ? match.occurrences.map((occurrence) => ({
        column: normalizePositiveInteger((occurrence as { column?: unknown })?.column, 1),
        matchLength: normalizeNonNegativeInteger((occurrence as { matchLength?: unknown })?.matchLength, 0),
      }))
      : undefined,
  }]
}

function normalizeVsCodeFileMatch(match: Record<string, unknown>): CodekRawTextMatch[] {
  const path = resourcePath(match.resource) || resourcePath(match.path)
  if (!path) return []
  const rawMatches: CodekRawTextMatch[] = []
  for (const result of match.results as readonly unknown[]) {
    if (!result || typeof result !== "object") continue
    const textResult = result as {
      previewText?: unknown
      rangeLocations?: unknown
    }
    if (typeof textResult.previewText !== "string" || !Array.isArray(textResult.rangeLocations)) continue
    const previewLines = textResult.previewText.split("\n")
    for (const rangeLocation of textResult.rangeLocations) {
      if (!rangeLocation || typeof rangeLocation !== "object") continue
      const pairing = rangeLocation as {
        source?: SearchRangeLike
        preview?: SearchRangeLike
      }
      const source = pairing.source
      if (!source) continue
      const preview = pairing.preview || source
      const previewLine = normalizeZeroBasedInteger(preview.startLineNumber)
      const previewText = previewLines[previewLine] ?? textResult.previewText
      const startColumn = normalizeZeroBasedInteger(source.startColumn)
      const endColumn = normalizeZeroBasedInteger(source.endColumn, startColumn)
      rawMatches.push({
        path,
        line: normalizeZeroBasedInteger(source.startLineNumber) + 1,
        column: startColumn + 1,
        matchLength: Math.max(0, endColumn - startColumn),
        preview: previewText,
        occurrences: [{ column: startColumn + 1, matchLength: Math.max(0, endColumn - startColumn) }],
      })
    }
  }
  return rawMatches
}

export function createSearchWorkbenchOwnerEvidence(): SearchWorkbenchOwnerEvidence {
  return {
    searchService: "ISearchService",
    textSearchProvider: "ISearchService.textSearch",
    query: "searchWorkbenchService.createTextQuery",
    resultTree: "searchModel.resultTree",
    resultSource: "CodekSearchResult.stateSource",
    resourceUriKind: "CodekSearchQuery folder/root/extraFileResources + result paths",
    cancellation: "CancellationToken -> AbortSignal",
    replacePreview: "IReplaceService.openReplacePreview-compatible",
    applyReplace: "IReplaceService.replaceOne/replaceAll -> bulkEditService.apply",
    fileActionNavigation: "Search resultTree match -> navigationService.openLocation",
    history: "SearchHistoryService",
    contextKeys: "SearchContext",
    remainingUiOwnerGap: "SearchPanel is partial; VS Code SearchView owner not connected",
    rawMatchesRole: "adapter-normalization-only",
    secondSearchStateSource: false,
  }
}

export function createSearchWorkbenchUiOwnerGap(): SearchWorkbenchUiOwnerGap {
  return {
    status: "partial",
    connected: false,
    currentOwner: "SearchPanel.vue",
    vscodeOwner: "SearchView + SearchWidget + SearchResultsView",
    reason: "SearchPanel currently consumes the service projection, but this lane does not own App.vue/generic shell SearchView wiring.",
  }
}

interface SearchRangeLike {
  readonly startLineNumber?: unknown
  readonly startColumn?: unknown
  readonly endColumn?: unknown
}

function createSearchWorkbenchEvidence({
  workspaceMutation,
  stateSource,
  resultSource = DEFAULT_SEARCH_WORKBENCH_STATE_SOURCE,
  resourceUriKind = "unknown",
}: {
  workspaceMutation: SearchWorkbenchEvidence["workspaceMutation"]
  stateSource: string
  resultSource?: string
  resourceUriKind?: SearchWorkbenchResourceUriKind
}): SearchWorkbenchEvidence {
  return {
    serviceId: String(ISearchWorkbenchService),
    stateSource,
    searchServiceOwner: "ISearchService",
    textSearchProviderOwner: "ISearchService.registerSearchResultProvider(file,text)",
    queryOwner: "searchWorkbenchService.createTextQuery",
    resultModelOwner: "searchModel.resultTree",
    resultSource,
    resourceUriKind,
    cancellationOwner: "CancellationToken -> AbortSignal",
    remainingUiOwnerGap: createSearchWorkbenchUiOwnerGap(),
    workspaceMutation,
    preservesAgentEvidence: true,
    safetyBoundary: "Search is read-only; replace preview/apply is delegated to replaceService and bulkEditService.",
    owners: createSearchWorkbenchOwnerEvidence(),
  }
}

function resolveSearchWorkbenchStateSource(result: CodekSearchResult | null | undefined): string {
  const delegatedStateSource = typeof result?.stateSource === "string" ? result.stateSource.trim() : ""
  if (!delegatedStateSource) return DEFAULT_SEARCH_WORKBENCH_STATE_SOURCE
  if (delegatedStateSource.includes("searchModel.resultTree")) return delegatedStateSource
  if (delegatedStateSource.startsWith("ISearchService")) return `${delegatedStateSource} -> searchModel.resultTree`
  return `ISearchService.textSearch -> ${delegatedStateSource} -> searchModel.resultTree`
}

function resolveSearchWorkbenchResultSource(result: CodekSearchResult | null | undefined): string {
  const delegatedStateSource = typeof result?.stateSource === "string" ? result.stateSource.trim() : ""
  return delegatedStateSource || "ISearchService.textSearch"
}

function resolveSearchWorkbenchResourceUriKind(
  query: CodekSearchQuery | undefined,
  rawMatches: readonly CodekRawTextMatch[],
): SearchWorkbenchResourceUriKind {
  const schemes = new Set<string>()
  const addScheme = (value: unknown) => {
    const scheme = searchResourceScheme(value)
    if (scheme) schemes.add(scheme)
  }
  for (const folder of query?.folderQueries || []) addScheme(folder.scheme || folder.folder || folder.root || folder.path || folder.fsPath)
  for (const root of query?.roots || []) addScheme(root)
  if (query?.root) addScheme("file")
  for (const resource of query?.extraFileResources || []) addScheme(resource.scheme || resource.path)
  for (const match of rawMatches) addScheme(match.path)
  if (!schemes.size) return "unknown"
  const hasFile = schemes.has("file")
  const hasNonFile = [...schemes].some((scheme) => scheme !== "file")
  if (hasFile && hasNonFile) return "mixed"
  return hasNonFile ? "non-file" : "file"
}

function resourcePath(value: unknown): string {
  if (typeof value === "string") return normalizeResourceString(value)
  if (!value || typeof value !== "object") return ""
  const resource = value as { fsPath?: unknown; path?: unknown; toString?: () => string }
  if (typeof resource.fsPath === "string") return normalizeResourceString(resource.fsPath)
  if (typeof resource.path === "string") return normalizeResourceString(resource.path)
  if (typeof resource.toString === "function") return normalizeResourceString(resource.toString())
  return ""
}

function normalizeResourceString(value: string): string {
  return String(value || "").replace(/^file:\/\//, "").replace(/^\/([a-zA-Z]:\/)/, "$1")
}

function searchResourceScheme(value: unknown): string {
  if (!value) return ""
  if (typeof value === "object") {
    const candidate = value as { scheme?: unknown; fsPath?: unknown; path?: unknown; toString?: () => string }
    if (typeof candidate.scheme === "string" && candidate.scheme.trim()) return candidate.scheme.trim().toLowerCase()
    if (typeof candidate.fsPath === "string") return "file"
    if (typeof candidate.path === "string") return searchResourceScheme(candidate.path)
    if (typeof candidate.toString === "function") return searchResourceScheme(candidate.toString())
    return ""
  }
  const text = String(value || "").trim()
  if (!text) return ""
  if (/^[a-zA-Z]:[\\/]/.test(text) || text.startsWith("/") || text.startsWith("./") || text.startsWith("../")) return "file"
  if (/^file:\/\//i.test(text)) return "file"
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(text)
  return schemeMatch ? schemeMatch[1].toLowerCase() : "file"
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const numeric = Math.trunc(Number(value))
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  const numeric = Math.trunc(Number(value))
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback
}

function normalizeZeroBasedInteger(value: unknown, fallback = 0): number {
  const numeric = Math.trunc(Number(value))
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
