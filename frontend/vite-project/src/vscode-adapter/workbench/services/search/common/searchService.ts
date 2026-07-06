/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code search service contracts:
 * - src/vs/workbench/services/search/common/search.ts
 * - src/vs/workbench/services/search/common/searchService.ts
 * - src/vs/workbench/services/search/common/queryBuilder.ts
 * - src/vs/workbench/services/search/common/searchExtTypes.ts
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, type CancellationToken as CancellationTokenShape } from "../../../../base/common/cancellation"
import type { IDisposable } from "../../../../base/common/lifecycle"
import { createDecorator } from "../../../../platform/instantiation/common/instantiation"
import { InstantiationType, registerSingleton } from "../../../../platform/instantiation/common/extensions"

export const enum QueryType {
  File = 1,
  Text = 2,
}

export const SearchProviderType = Object.freeze({
  file: "file",
  text: "text",
} as const)

export type SearchProviderTypeValue = typeof SearchProviderType[keyof typeof SearchProviderType]

export const enum SearchErrorCode {
  unknownEncoding = 1,
  regexParseError,
  globParseError,
  invalidLiteral,
  rgProcessError,
  other,
  canceled,
  binary,
  tooLarge,
  providerUnavailable,
}

export class SearchError extends Error {
  constructor(message: string, readonly code: SearchErrorCode = SearchErrorCode.other) {
    super(message)
    this.name = "SearchError"
  }
}

export type SearchProgressItem = CodekSearchResult | { readonly message?: string; readonly [key: string]: unknown }

export interface CodekSearchResultProvider {
  readonly textSearch?: (
    query: NormalizedCodekSearchQuery,
    onProgress?: (progress: SearchProgressItem) => void,
  ) => Promise<CodekSearchResult>
  readonly fileSearch?: (
    query: NormalizedCodekSearchQuery,
    onProgress?: (progress: SearchProgressItem) => void,
  ) => Promise<CodekSearchResult>
  readonly clearCache?: (cacheKey?: string) => Promise<void> | void
}

export interface ISearchService {
  readonly _serviceBrand: undefined
  textSearch(query: CodekSearchQuery, token?: CancellationTokenShape, onProgress?: (progress: SearchProgressItem) => void): Promise<CodekSearchResult>
  fileSearch(query: CodekSearchQuery, token?: CancellationTokenShape, onProgress?: (progress: SearchProgressItem) => void): Promise<CodekSearchResult>
  clearCache(cacheKey?: string): Promise<void>
  registerSearchResultProvider(scheme: string, type: SearchProviderTypeValue, provider: CodekSearchResultProvider): IDisposable
  schemeHasFileSearchProvider(scheme: string): boolean
}

export interface CodekSearchFolderQuery {
  readonly folder?: unknown
  readonly root?: string
  readonly path?: string
  readonly fsPath?: string
  readonly scheme?: string
  readonly folderIndex?: number
  readonly rootLabel?: string
}

export interface CodekSearchQuery {
  readonly type?: QueryType
  readonly contentPattern?: {
    readonly pattern?: string
    readonly isRegExp?: boolean
    readonly isCaseSensitive?: boolean
    readonly isWordMatch?: boolean
  }
  readonly filePattern?: string
  readonly query?: string
  readonly folderQueries?: readonly CodekSearchFolderQuery[]
  readonly root?: string
  readonly roots?: readonly (string | CodekSearchFolderQuery)[]
  readonly includePattern?: readonly string[] | Record<string, unknown> | string
  readonly excludePattern?: readonly string[] | Record<string, unknown> | string
  readonly include?: readonly string[] | string
  readonly exclude?: readonly string[] | string
  readonly regex?: boolean
  readonly caseSensitive?: boolean
  readonly wholeWord?: boolean
  readonly maxResults?: number | string
  readonly previewOptions?: Record<string, unknown>
  readonly includeContentForSmallFiles?: boolean
  readonly encoding?: string
  readonly searchLargeFiles?: boolean
  readonly searchMaxFileBytes?: number
  readonly contentMaxFileBytes?: number
  readonly contentMaxTotalBytes?: number
  readonly extraFileResources?: readonly { readonly scheme?: string; readonly path?: string }[]
  readonly [key: string]: unknown
}

export interface NormalizedCodekSearchQuery {
  readonly type: QueryType
  readonly query: string
  readonly discoverFiles: boolean
  readonly folderQueries: CodekSearchFolderQuery[]
  readonly root?: string
  readonly roots?: readonly (string | CodekSearchFolderQuery)[]
  readonly include: string[]
  readonly exclude: string[]
  readonly regex: boolean
  readonly caseSensitive: boolean
  readonly wholeWord: boolean
  readonly maxResults?: number
  readonly previewOptions?: Record<string, unknown>
  readonly includeContentForSmallFiles?: boolean
  readonly encoding?: string
  readonly searchLargeFiles?: boolean
  readonly searchMaxFileBytes?: number
  readonly contentMaxFileBytes?: number
  readonly contentMaxTotalBytes?: number
  readonly extraFileResources?: readonly { readonly scheme?: string; readonly path?: string }[]
  readonly signal: AbortSignal
}

export interface CodekSearchResult {
  readonly success?: boolean
  readonly matches?: readonly unknown[]
  readonly truncated?: boolean
  readonly fileContents?: Record<string, string>
  readonly error?: string
  readonly partial?: boolean
  readonly providerFailures?: readonly SearchProviderFailure[]
  readonly [key: string]: unknown
}

export interface SearchProviderFailure {
  readonly scheme: string
  readonly providerType: SearchProviderTypeValue
  readonly code: SearchErrorCode.providerUnavailable
  readonly reason: "missing-provider"
  readonly message: string
  readonly activationEvent: string
}

export interface SearchProviderActivationRequest {
  readonly schemes: string[]
  readonly activationEvents: string[]
  readonly signal: AbortSignal
}

export interface CodekSearchServiceOptions {
  readonly textSearch?: (query: NormalizedCodekSearchQuery, onProgress?: (progress: SearchProgressItem) => void) => Promise<CodekSearchResult>
  readonly fileSearch?: (query: NormalizedCodekSearchQuery, onProgress?: (progress: SearchProgressItem) => void) => Promise<CodekSearchResult>
  readonly activateSearchProviders?: (request: SearchProviderActivationRequest) => Promise<unknown>
  readonly clearCache?: (cacheKey?: string) => Promise<void>
  readonly discardStaleResults?: boolean
}

export const ISearchService = createDecorator<ISearchService>("searchService")

export class CodekSearchService implements ISearchService {
  declare readonly _serviceBrand: undefined

  private readonly fileSearchProviders = new Map<string, CodekSearchResultProvider[]>()
  private readonly textSearchProviders = new Map<string, CodekSearchResultProvider[]>()
  private searchSequence = 0

  constructor(private readonly options: CodekSearchServiceOptions = {}) {}

  async textSearch(
    query: CodekSearchQuery,
    token: CancellationTokenShape = CancellationToken.None,
    onProgress?: (progress: SearchProgressItem) => void,
  ): Promise<CodekSearchResult> {
    return this.doSearch(SearchProviderType.text, query, token, onProgress)
  }

  async fileSearch(
    query: CodekSearchQuery,
    token: CancellationTokenShape = CancellationToken.None,
    onProgress?: (progress: SearchProgressItem) => void,
  ): Promise<CodekSearchResult> {
    return this.doSearch(SearchProviderType.file, query, token, onProgress)
  }

  async clearCache(cacheKey?: string): Promise<void> {
    const providers = new Set([
      ...Array.from(this.fileSearchProviders.values()).flat(),
      ...Array.from(this.textSearchProviders.values()).flat(),
    ])
    await Promise.all([...providers].map((provider) => provider.clearCache?.(cacheKey)))
    await this.options.clearCache?.(cacheKey)
  }

  registerSearchResultProvider(scheme: string, type: SearchProviderTypeValue, provider: CodekSearchResultProvider): IDisposable {
    const registry = this.getProviderRegistry(type)
    const normalizedScheme = normalizeScheme(scheme)
    const stack = registry.get(normalizedScheme) || []
    stack.push(provider)
    registry.set(normalizedScheme, stack)
    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        const current = registry.get(normalizedScheme)
        if (!current) return
        const index = current.lastIndexOf(provider)
        if (index !== -1) current.splice(index, 1)
        if (current.length) registry.set(normalizedScheme, current)
        else registry.delete(normalizedScheme)
      },
    }
  }

  schemeHasFileSearchProvider(scheme: string): boolean {
    return Boolean(this.fileSearchProviders.get(normalizeScheme(scheme))?.length)
  }

  private async doSearch(
    providerType: SearchProviderTypeValue,
    query: CodekSearchQuery,
    token: CancellationTokenShape,
    onProgress?: (progress: SearchProgressItem) => void,
  ): Promise<CodekSearchResult> {
    const cancellation = createSearchAbortSignal(token)
    const sequence = ++this.searchSequence
    try {
      throwIfAborted(cancellation.signal)
      const normalized = normalizeSearchQuery(query, providerType, cancellation.signal)
      const schemes = getSearchSchemesInQuery(normalized)
      await this.options.activateSearchProviders?.({
        schemes,
        activationEvents: searchActivationEvents(schemes),
        signal: cancellation.signal,
      })
      throwIfAborted(cancellation.signal)
      const resolvedProviders = this.resolveDelegates(providerType, schemes)
      const delegates = resolvedProviders.delegates
      const result = delegates.length
        ? await this.runDelegates(delegates, normalized, cancellation.signal, onProgress)
        : { matches: [], truncated: false }
      throwIfAborted(cancellation.signal)
      if (this.options.discardStaleResults && sequence !== this.searchSequence) {
        throwAbortError()
      }
      return normalizeSearchResult(result, normalized, resolvedProviders.providerFailures)
    } catch (error) {
      throw normalizeSearchError(error)
    } finally {
      cancellation.dispose()
    }
  }

  private resolveDelegates(
    providerType: SearchProviderTypeValue,
    schemes: readonly string[],
  ): SearchDelegateResolution {
    const registry = this.getProviderRegistry(providerType)
    const entries: SearchDelegateEntry[] = []
    const providerFailures: SearchProviderFailure[] = []
    let fallbackAdded = false
    for (const scheme of schemes) {
      const normalizedScheme = normalizeScheme(scheme)
      const provider = getActiveProvider(registry, normalizedScheme)
      const providerDelegate = providerType === SearchProviderType.file ? provider?.fileSearch : provider?.textSearch
      if (providerDelegate) {
        entries.push({
          scheme: normalizedScheme,
          delegate: providerDelegate.bind(provider),
        })
        continue
      }
      const fallback = providerType === SearchProviderType.file ? this.options.fileSearch : this.options.textSearch
      if (normalizedScheme === "file" && fallback && !fallbackAdded) {
        entries.push({
          scheme: normalizedScheme,
          delegate: fallback,
        })
        fallbackAdded = true
        continue
      }
      if (normalizedScheme !== "file") {
        providerFailures.push(createMissingProviderFailure(normalizedScheme, providerType))
      }
    }
    if (!entries.length && schemes.every((scheme) => normalizeScheme(scheme) === "file")) {
      const fallback = providerType === SearchProviderType.file ? this.options.fileSearch : this.options.textSearch
      if (fallback) entries.push({ scheme: "file", delegate: fallback })
    }
    return { delegates: entries, providerFailures }
  }

  private async runDelegates(
    delegates: readonly SearchDelegateEntry[],
    query: NormalizedCodekSearchQuery,
    signal: AbortSignal,
    onProgress?: (progress: SearchProgressItem) => void,
  ): Promise<CodekSearchResult> {
    const progress = createProgressForwarder(onProgress, signal)
    const results: CodekSearchResult[] = []
    for (const entry of delegates) {
      throwIfAborted(signal)
      const schemeQuery = filterQueryForScheme(query, entry.scheme)
      const result = await raceAbort(entry.delegate(schemeQuery, progress), signal)
      results.push(result)
    }
    return mergeSearchResults(results)
  }

  private getProviderRegistry(providerType: SearchProviderTypeValue): Map<string, CodekSearchResultProvider[]> {
    return providerType === SearchProviderType.file ? this.fileSearchProviders : this.textSearchProviders
  }
}

function getActiveProvider(
  registry: Map<string, CodekSearchResultProvider[]>,
  scheme: string,
): CodekSearchResultProvider | undefined {
  const stack = registry.get(scheme)
  return stack?.[stack.length - 1]
}

export const globalSearchService = new CodekSearchService()
registerSingleton(ISearchService, globalSearchService, InstantiationType.Delayed)

interface SearchDelegateEntry {
  readonly scheme: string
  readonly delegate: (
    query: NormalizedCodekSearchQuery,
    onProgress?: (progress: SearchProgressItem) => void,
  ) => Promise<CodekSearchResult>
}

interface SearchDelegateResolution {
  readonly delegates: SearchDelegateEntry[]
  readonly providerFailures: SearchProviderFailure[]
}

export function normalizeSearchQuery(
  query: CodekSearchQuery,
  providerType: SearchProviderTypeValue,
  signal: AbortSignal = new AbortController().signal,
): NormalizedCodekSearchQuery {
  const isFileSearch = providerType === SearchProviderType.file
  const contentPattern = query.contentPattern || {}
  const rawQuery = isFileSearch
    ? query.filePattern ?? query.query ?? contentPattern.pattern
    : contentPattern.pattern ?? query.query ?? query.filePattern
  const folderQueries = normalizeFolderQueries(query.folderQueries)
  return {
    type: isFileSearch ? QueryType.File : QueryType.Text,
    query: String(rawQuery || ""),
    discoverFiles: isFileSearch,
    folderQueries,
    root: typeof query.root === "string" ? query.root : folderQueries[0]?.root,
    roots: query.roots,
    include: normalizePatternList(query.includePattern ?? query.include),
    exclude: normalizePatternList(query.excludePattern ?? query.exclude),
    regex: Boolean(contentPattern.isRegExp ?? query.regex),
    caseSensitive: Boolean(contentPattern.isCaseSensitive ?? query.caseSensitive),
    wholeWord: Boolean(contentPattern.isWordMatch ?? query.wholeWord),
    maxResults: normalizePositiveNumber(query.maxResults),
    previewOptions: isPlainRecord(query.previewOptions) ? query.previewOptions : undefined,
    includeContentForSmallFiles: query.includeContentForSmallFiles === true,
    encoding: typeof query.encoding === "string" ? query.encoding : undefined,
    searchLargeFiles: query.searchLargeFiles === true,
    searchMaxFileBytes: normalizePositiveNumber(query.searchMaxFileBytes),
    contentMaxFileBytes: normalizePositiveNumber(query.contentMaxFileBytes),
    contentMaxTotalBytes: normalizePositiveNumber(query.contentMaxTotalBytes),
    extraFileResources: query.extraFileResources,
    signal,
  }
}

export function getSearchSchemesInQuery(query: Pick<NormalizedCodekSearchQuery, "folderQueries" | "roots" | "root" | "extraFileResources">): string[] {
  const schemes: string[] = []
  const seen = new Set<string>()
  const addScheme = (value: unknown) => {
    const scheme = normalizeScheme(value)
    if (seen.has(scheme)) return
    seen.add(scheme)
    schemes.push(scheme)
  }

  for (const folder of query.folderQueries || []) addScheme(folder.scheme)
  for (const root of query.roots || []) {
    if (typeof root === "string") addScheme("file")
    else addScheme(root.scheme)
  }
  if (query.root && (!query.folderQueries?.length || query.folderQueries.some((folder) => normalizeScheme(folder.scheme) === "file"))) {
    addScheme("file")
  }
  for (const resource of query.extraFileResources || []) addScheme(resource.scheme)
  if (!schemes.length) addScheme("file")
  return schemes
}

export function searchActivationEvents(schemes: readonly string[]): string[] {
  const events = schemes.map((scheme) => `onSearch:${normalizeScheme(scheme)}`)
  if (!events.includes("onSearch:file")) events.push("onSearch:file")
  return events
}

function normalizeFolderQueries(value: CodekSearchQuery["folderQueries"]): CodekSearchFolderQuery[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const rawFolder = entry.folder as { scheme?: unknown; fsPath?: unknown; path?: unknown } | string | undefined
    const folderObject = rawFolder && typeof rawFolder === "object" ? rawFolder : undefined
    const root = entry.root
      || entry.path
      || entry.fsPath
      || (typeof rawFolder === "string" ? rawFolder : undefined)
      || (typeof folderObject?.fsPath === "string" ? folderObject.fsPath : undefined)
      || (typeof folderObject?.path === "string" ? folderObject.path : undefined)
    return {
      ...entry,
      root,
      scheme: normalizeScheme(entry.scheme || folderObject?.scheme),
    }
  })
}

function normalizePatternList(value: unknown): string[] {
  if (!value) return []
  if (typeof value === "string") return value.trim() ? [value.trim()] : []
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean)
  if (isPlainRecord(value)) {
    return Object.entries(value)
      .filter(([, enabled]) => enabled !== false)
      .map(([pattern]) => pattern.trim())
      .filter(Boolean)
  }
  return []
}

function normalizePositiveNumber(value: unknown): number | undefined {
  const numeric = Math.trunc(Number(value))
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined
}

function normalizeScheme(value: unknown): string {
  return String(value || "file").trim().toLowerCase() || "file"
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function createSearchAbortSignal(token: CancellationTokenShape): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController()
  const abort = () => {
    if (!controller.signal.aborted) controller.abort("Search cancelled")
  }
  if (token?.isCancellationRequested) abort()
  const listener: IDisposable | undefined = token && token !== CancellationToken.None
    ? token.onCancellationRequested(abort)
    : undefined
  return {
    signal: controller.signal,
    dispose() {
      listener?.dispose()
    },
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throwAbortError()
}

function throwAbortError(): never {
  const error = new SearchError("Search cancelled", SearchErrorCode.canceled)
  error.name = "AbortError"
  throw error
}

function createProgressForwarder(
  onProgress: ((progress: SearchProgressItem) => void) | undefined,
  signal: AbortSignal,
): ((progress: SearchProgressItem) => void) | undefined {
  if (!onProgress) return undefined
  return (progress) => {
    if (signal.aborted) return
    onProgress(progress)
  }
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throwAbortError()
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cleanup()
      try {
        throwAbortError()
      } catch (error) {
        reject(error)
      }
    }
    const cleanup = () => signal.removeEventListener("abort", abort)
    signal.addEventListener("abort", abort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

function normalizeSearchResult(
  result: CodekSearchResult | null | undefined,
  query: NormalizedCodekSearchQuery,
  providerFailures: readonly SearchProviderFailure[] = [],
): CodekSearchResult {
  const normalized = result || { matches: [], truncated: false }
  const capped = !Array.isArray(normalized.matches) || !query.maxResults || normalized.matches.length <= query.maxResults
    ? normalized
    : {
      ...normalized,
      matches: normalized.matches.slice(0, query.maxResults),
      truncated: true,
    }
  if (!providerFailures.length) return capped
  return withSearchProviderFailures(capped, providerFailures)
}

function filterQueryForScheme(query: NormalizedCodekSearchQuery, scheme: string): NormalizedCodekSearchQuery {
  const normalizedScheme = normalizeScheme(scheme)
  const folderQueries = query.folderQueries.filter((folder) => normalizeScheme(folder.scheme) === normalizedScheme)
  const roots = query.roots?.filter((root) => typeof root === "string" ? normalizedScheme === "file" : normalizeScheme(root.scheme) === normalizedScheme)
  const extraFileResources = query.extraFileResources?.filter((resource) => normalizeScheme(resource.scheme) === normalizedScheme)
  const root = folderQueries[0]?.root
    || (typeof roots?.[0] === "string" ? roots[0] : roots?.[0]?.root)
    || (normalizedScheme === "file" ? query.root : undefined)
  return {
    ...query,
    root,
    folderQueries,
    roots,
    extraFileResources,
  }
}

function mergeSearchResults(results: readonly CodekSearchResult[]): CodekSearchResult {
  if (results.length === 0) return { matches: [], truncated: false }
  if (results.length === 1) return results[0] || { matches: [], truncated: false }
  const matches = results.flatMap((result) => Array.isArray(result?.matches) ? result.matches : [])
  const fileContents = Object.assign({}, ...results.map((result) => isPlainRecord(result?.fileContents) ? result.fileContents : {}))
  return {
    ...results[results.length - 1],
    matches,
    ...(Object.keys(fileContents).length ? { fileContents } : {}),
    truncated: results.some((result) => result?.truncated === true),
  }
}

function createMissingProviderFailure(scheme: string, providerType: SearchProviderTypeValue): SearchProviderFailure {
  return {
    scheme,
    providerType,
    code: SearchErrorCode.providerUnavailable,
    reason: "missing-provider",
    message: `No ${providerType} search provider registered for scheme ${scheme}`,
    activationEvent: `onSearch:${scheme}`,
  }
}

function withSearchProviderFailures(
  result: CodekSearchResult,
  providerFailures: readonly SearchProviderFailure[],
): CodekSearchResult {
  const hasMatches = Array.isArray(result.matches) && result.matches.length > 0
  return {
    ...result,
    success: false,
    partial: hasMatches,
    error: describeProviderFailures(providerFailures),
    providerFailures,
  }
}

function describeProviderFailures(providerFailures: readonly SearchProviderFailure[]): string {
  const schemes = providerFailures.map((failure) => `${failure.providerType}:${failure.scheme}`).join(", ")
  return `Search provider unavailable for ${schemes}`
}

function normalizeSearchError(error: unknown): Error {
  if (error instanceof SearchError) return error
  if (error instanceof Error && error.name === "AbortError") return error
  if (isAbortLikeError(error)) {
    const abortError = new Error((error as Error).message || "Search cancelled")
    abortError.name = "AbortError"
    return abortError
  }
  if (error instanceof Error) {
    const deserialized = deserializeSearchError(error)
    if (deserialized) return deserialized
    return new SearchError(error.message || "Search failed", SearchErrorCode.other)
  }
  return new SearchError(String(error || "Search failed"), SearchErrorCode.other)
}

function deserializeSearchError(error: Error): SearchError | null {
  try {
    const details = JSON.parse(error.message) as { message?: unknown; code?: unknown }
    if (typeof details?.message !== "string") return null
    return new SearchError(details.message, normalizeSearchErrorCode(details.code))
  } catch {
    return null
  }
}

function normalizeSearchErrorCode(value: unknown): SearchErrorCode {
  const code = Number(value)
  return Number.isFinite(code) && code >= SearchErrorCode.unknownEncoding && code <= SearchErrorCode.providerUnavailable
    ? code as SearchErrorCode
    : SearchErrorCode.other
}

function isAbortLikeError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && ((error as { name?: unknown }).name === "AbortError" || (error as { code?: unknown }).code === SearchErrorCode.canceled),
  )
}
