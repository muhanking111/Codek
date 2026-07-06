import { describe, expect, it, vi } from "vitest"
import { CancellationTokenSource } from "../../../../base/common/cancellation"
import { ServiceCollection } from "../../../../platform/instantiation/common/serviceCollection"
import { InstantiationService } from "../../../../platform/instantiation/common/instantiationService"
import {
  CodekSearchService,
  ISearchService,
  QueryType,
  SearchErrorCode,
  SearchProviderType,
  globalSearchService,
  normalizeSearchQuery,
} from "./searchService"

describe("CodekSearchService", () => {
  it("registers a VS Code-style service identifier and resolves through ServiceCollection", () => {
    const service = new CodekSearchService()
    const collection = new ServiceCollection([ISearchService, service])
    const instantiationService = new InstantiationService(collection)

    const resolved = instantiationService.invokeFunction((accessor) => accessor.get(ISearchService))

    expect(String(ISearchService)).toBe("searchService")
    expect(resolved).toBe(service)
    expect(resolved._serviceBrand).toBeUndefined()
    expect(globalSearchService._serviceBrand).toBeUndefined()
  })

  it("normalizes text search queries without losing Codek search options", async () => {
    const onProgress = vi.fn()
    const textSearch = vi.fn(async (_query, progress) => {
      progress?.({ message: "Searching with provider" })
      return {
      matches: [{ path: "src/app.ts", line: 1, column: 1, matchLength: 6 }],
      truncated: false,
      query: _query,
      }
    })
    const activateSearchProviders = vi.fn(async () => undefined)
    const service = new CodekSearchService({ textSearch, activateSearchProviders })

    const result = await service.textSearch({
      type: QueryType.Text,
      contentPattern: { pattern: "needle", isRegExp: true, isCaseSensitive: true, isWordMatch: true },
      folderQueries: [{ folder: "D:/Workspace", scheme: "file" }],
      includePattern: { "src/**": true },
      excludePattern: { "dist/**": true },
      maxResults: 25,
      previewOptions: { matchLines: 2, charsPerLine: 120 },
      includeContentForSmallFiles: true,
      encoding: "utf8",
      searchLargeFiles: true,
      extraFileResources: [{ scheme: "mcp-resource", path: "/server/resource" }],
    }, undefined, onProgress)

    expect(activateSearchProviders).toHaveBeenCalledWith({
      schemes: ["file", "mcp-resource"],
      activationEvents: ["onSearch:file", "onSearch:mcp-resource"],
      signal: expect.any(AbortSignal),
    })
    expect(textSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "needle",
        regex: true,
        caseSensitive: true,
        wholeWord: true,
        include: ["src/**"],
        exclude: ["dist/**"],
        maxResults: 25,
        includeContentForSmallFiles: true,
        encoding: "utf8",
        searchLargeFiles: true,
        previewOptions: { matchLines: 2, charsPerLine: 120 },
        signal: expect.any(AbortSignal),
      }),
      expect.any(Function),
    )
    expect(result.matches).toHaveLength(1)
    expect(onProgress).toHaveBeenCalledWith({ message: "Searching with provider" })
  })

  it("normalizes file search queries and activates onSearch by unique resource scheme", async () => {
    const fileSearch = vi.fn(async (query) => ({
      matches: [{ path: "src/app.ts", score: 5 }],
      truncated: false,
      query,
    }))
    const activateSearchProviders = vi.fn(async () => undefined)
    const service = new CodekSearchService({ fileSearch, activateSearchProviders })

    await service.fileSearch({
      type: QueryType.File,
      filePattern: "app",
      folderQueries: [
        { folder: "D:/Workspace", scheme: "file" },
        { folder: "codek://workspace", scheme: "codek" },
      ],
      extraFileResources: [
        { scheme: "codek", path: "/already-covered" },
        { scheme: "mcp-resource", path: "/server/resource" },
      ],
      maxResults: 10,
    })

    expect(activateSearchProviders).toHaveBeenCalledWith({
      schemes: ["file", "codek", "mcp-resource"],
      activationEvents: ["onSearch:file", "onSearch:codek", "onSearch:mcp-resource"],
      signal: expect.any(AbortSignal),
    })
    expect(fileSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "app",
        discoverFiles: true,
        maxResults: 10,
        signal: expect.any(AbortSignal),
      }),
      undefined,
    )
  })

  it("activates onSearch:file after non-file scheme activation for VS Code compatibility", async () => {
    const activateSearchProviders = vi.fn(async () => undefined)
    const service = new CodekSearchService({ activateSearchProviders })

    await service.textSearch({
      query: "needle",
      folderQueries: [{ root: "/server", scheme: "codek" }],
    })

    expect(activateSearchProviders).toHaveBeenCalledWith({
      schemes: ["codek"],
      activationEvents: ["onSearch:codek", "onSearch:file"],
      signal: expect.any(AbortSignal),
    })
  })

  it("cancels before activation or delegate search can run", async () => {
    const textSearch = vi.fn(async () => ({ matches: [] }))
    const activateSearchProviders = vi.fn(async () => undefined)
    const service = new CodekSearchService({ textSearch, activateSearchProviders })

    await expect(service.textSearch({ contentPattern: { pattern: "needle" } }, {
      isCancellationRequested: true,
      onCancellationRequested: () => ({ dispose() {} }),
    })).rejects.toMatchObject({ name: "AbortError" })

    expect(activateSearchProviders).not.toHaveBeenCalled()
    expect(textSearch).not.toHaveBeenCalled()
  })

  it("cancels after onSearch activation and before delegate completion", async () => {
    const source = new CancellationTokenSource()
    const textSearch = vi.fn(async () => {
      source.cancel()
      return { matches: [] }
    })
    const service = new CodekSearchService({
      textSearch,
      activateSearchProviders: vi.fn(async () => undefined),
    })

    await expect(service.textSearch({ contentPattern: { pattern: "needle" } }, source.token))
      .rejects.toMatchObject({ name: "AbortError" })
  })

  it("caps provider matches at maxResults and reports limitHit-style truncation", async () => {
    const service = new CodekSearchService({
      textSearch: vi.fn(async () => ({
        matches: [
          { path: "src/a.ts" },
          { path: "src/b.ts" },
          { path: "src/c.ts" },
        ],
        truncated: false,
      })),
    })

    const result = await service.textSearch({ query: "needle", maxResults: 2 })

    expect(result.matches).toEqual([{ path: "src/a.ts" }, { path: "src/b.ts" }])
    expect(result.truncated).toBe(true)
  })

  it("normalizes provider errors into VS Code-style SearchError codes", async () => {
    const service = new CodekSearchService({
      textSearch: vi.fn(async () => {
        throw new Error(JSON.stringify({ message: "Glob parse failed", code: SearchErrorCode.globParseError }))
      }),
    })

    await expect(service.textSearch({ query: "needle" })).rejects.toMatchObject({
      name: "SearchError",
      code: SearchErrorCode.globParseError,
      message: "Glob parse failed",
    })
  })

  it("registers scheme providers and forwards provider capability/cache calls", async () => {
    const provider = {
      textSearch: vi.fn(async () => ({ matches: [{ path: "mcp://server/resource" }], truncated: false })),
      clearCache: vi.fn(async () => undefined),
    }
    const service = new CodekSearchService()
    const disposable = service.registerSearchResultProvider("mcp-resource", SearchProviderType.text, provider)

    const onProgress = vi.fn()
    const result = await service.textSearch({
      query: "needle",
      folderQueries: [{ root: "/server", scheme: "mcp-resource" }],
    }, undefined, onProgress)
    await service.clearCache("workspace-cache")

    expect(result.matches).toEqual([{ path: "mcp://server/resource" }])
    expect(provider.textSearch).toHaveBeenCalledWith(expect.objectContaining({ query: "needle" }), expect.any(Function))
    expect(provider.clearCache).toHaveBeenCalledWith("workspace-cache")

    disposable.dispose()
    await service.textSearch({ query: "needle", folderQueries: [{ root: "/server", scheme: "mcp-resource" }] })
    expect(provider.textSearch).toHaveBeenCalledTimes(1)
  })

  it("clears shared text/file providers once and preserves replacement registrations", async () => {
    const oldProvider = {
      textSearch: vi.fn(async () => ({ matches: [{ path: "old.ts" }], truncated: false })),
      clearCache: vi.fn(async () => undefined),
    }
    const sharedProvider = {
      textSearch: vi.fn(async () => ({ matches: [{ path: "new.ts" }], truncated: false })),
      fileSearch: vi.fn(async () => ({ matches: [{ path: "new.ts" }], truncated: false })),
      clearCache: vi.fn(async () => undefined),
    }
    const service = new CodekSearchService()
    const staleDisposable = service.registerSearchResultProvider("file", SearchProviderType.text, oldProvider)
    const textDisposable = service.registerSearchResultProvider("file", SearchProviderType.text, sharedProvider)
    service.registerSearchResultProvider("file", SearchProviderType.file, sharedProvider)

    staleDisposable.dispose()
    staleDisposable.dispose()
    await service.clearCache("workspace-cache")
    const result = await service.textSearch({ query: "needle", folderQueries: [{ root: "D:/Workspace", scheme: "file" }] })

    expect(result.matches).toEqual([{ path: "new.ts" }])
    expect(oldProvider.textSearch).not.toHaveBeenCalled()
    expect(sharedProvider.textSearch).toHaveBeenCalledTimes(1)
    expect(sharedProvider.clearCache).toHaveBeenCalledTimes(1)
    expect(sharedProvider.clearCache).toHaveBeenCalledWith("workspace-cache")

    textDisposable.dispose()
    const afterDispose = await service.textSearch({ query: "needle", folderQueries: [{ root: "D:/Workspace", scheme: "file" }] })
    expect(afterDispose).toEqual({ matches: [], truncated: false })
  })

  it("restores the previous scheme provider when a temporary registration is disposed", async () => {
    const baseProvider = {
      textSearch: vi.fn(async () => ({ matches: [{ path: "base.ts" }], truncated: false })),
    }
    const temporaryProvider = {
      textSearch: vi.fn(async () => ({ matches: [{ path: "temporary.ts" }], truncated: false })),
    }
    const service = new CodekSearchService()
    const baseDisposable = service.registerSearchResultProvider("file", SearchProviderType.text, baseProvider)
    const temporaryDisposable = service.registerSearchResultProvider("file", SearchProviderType.text, temporaryProvider)

    await expect(service.textSearch({ query: "needle" })).resolves.toEqual(expect.objectContaining({
      matches: [{ path: "temporary.ts" }],
    }))

    temporaryDisposable.dispose()

    await expect(service.textSearch({ query: "needle" })).resolves.toEqual(expect.objectContaining({
      matches: [{ path: "base.ts" }],
    }))
    expect(baseProvider.textSearch).toHaveBeenCalledTimes(1)
    expect(temporaryProvider.textSearch).toHaveBeenCalledTimes(1)

    baseDisposable.dispose()
  })

  it("fans out one search across file delegate and registered scheme providers", async () => {
    const textSearch = vi.fn(async (_query, progress) => {
      progress?.({ message: "file provider" })
      return { matches: [{ path: "src/local.ts" }], truncated: false }
    })
    const mcpProvider = {
      textSearch: vi.fn(async (_query, progress) => {
        progress?.({ message: "mcp provider" })
        return { matches: [{ path: "mcp-resource:/server/remote.ts" }], truncated: false }
      }),
    }
    const service = new CodekSearchService({ textSearch })
    service.registerSearchResultProvider("mcp-resource", SearchProviderType.text, mcpProvider)

    const onProgress = vi.fn()
    const result = await service.textSearch({
      query: "needle",
      folderQueries: [
        { root: "D:/Workspace", scheme: "file" },
        { root: "/server", scheme: "mcp-resource" },
      ],
    }, undefined, onProgress)

    expect(textSearch).toHaveBeenCalledWith(expect.objectContaining({ query: "needle" }), expect.any(Function))
    expect(mcpProvider.textSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "needle",
        root: "/server",
        folderQueries: [expect.objectContaining({ root: "/server", scheme: "mcp-resource" })],
      }),
      expect.any(Function),
    )
    expect(result.matches).toEqual([
      { path: "src/local.ts" },
      { path: "mcp-resource:/server/remote.ts" },
    ])
    expect(onProgress).toHaveBeenCalledWith({ message: "file provider" })
    expect(onProgress).toHaveBeenCalledWith({ message: "mcp provider" })
  })

  it("records unsupported scheme provider failures without hiding file delegate results", async () => {
    const textSearch = vi.fn(async () => ({ matches: [{ path: "src/local.ts" }], truncated: false }))
    const activateSearchProviders = vi.fn(async () => undefined)
    const service = new CodekSearchService({ textSearch, activateSearchProviders })

    const result = await service.textSearch({
      query: "needle",
      folderQueries: [
        { root: "D:/Workspace", scheme: "file" },
        { root: "/server", scheme: "mcp-resource" },
      ],
    })

    expect(activateSearchProviders).toHaveBeenCalledWith({
      schemes: ["file", "mcp-resource"],
      activationEvents: ["onSearch:file", "onSearch:mcp-resource"],
      signal: expect.any(AbortSignal),
    })
    expect(textSearch).toHaveBeenCalledTimes(1)
    expect(result.matches).toEqual([{ path: "src/local.ts" }])
    expect(result).toEqual(expect.objectContaining({
      success: false,
      partial: true,
      error: "Search provider unavailable for text:mcp-resource",
      providerFailures: [expect.objectContaining({
        scheme: "mcp-resource",
        providerType: SearchProviderType.text,
        code: SearchErrorCode.providerUnavailable,
        activationEvent: "onSearch:mcp-resource",
        reason: "missing-provider",
        message: "No text search provider registered for scheme mcp-resource",
      })],
    }))
  })

  it("does not fall back to the file delegate for unsupported non-file providers", async () => {
    const textSearch = vi.fn(async () => ({ matches: [{ path: "src/local.ts" }], truncated: false }))
    const service = new CodekSearchService({ textSearch })

    const result = await service.textSearch({
      query: "needle",
      folderQueries: [{ root: "/server", scheme: "mcp-resource" }],
    })

    expect(textSearch).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({
      matches: [],
      truncated: false,
      success: false,
      partial: false,
      error: expect.stringContaining("mcp-resource"),
      providerFailures: [expect.objectContaining({
        scheme: "mcp-resource",
        providerType: SearchProviderType.text,
        code: SearchErrorCode.providerUnavailable,
        activationEvent: "onSearch:mcp-resource",
        reason: "missing-provider",
      })],
    }))
  })

  it("discards stale results when a newer search starts on the same service instance", async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    let resolveSecond: (value: unknown) => void = () => {}
    const service = new CodekSearchService({
      discardStaleResults: true,
      textSearch: vi.fn(async (query) => {
        if (query.query === "first") {
          return new Promise((resolve) => { resolveFirst = resolve }) as Promise<{ matches: unknown[] }>
        }
        return new Promise((resolve) => { resolveSecond = resolve }) as Promise<{ matches: unknown[] }>
      }),
    })

    const first = service.textSearch({ query: "first" })
    const second = service.textSearch({ query: "second" })
    await Promise.resolve()
    resolveSecond({ matches: [{ path: "src/second.ts" }] })
    await expect(second).resolves.toEqual(expect.objectContaining({ matches: [{ path: "src/second.ts" }] }))

    resolveFirst({ matches: [{ path: "src/first.ts" }] })
    await expect(first).rejects.toMatchObject({ name: "AbortError" })
  })

  it("exposes a reusable normalizer for callers that still use legacy Codek query objects", () => {
    const normalized = normalizeSearchQuery({
      query: "needle",
      include: "src/**",
      exclude: ["dist/**"],
      regex: false,
      caseSensitive: false,
      maxResults: "12",
      folderQueries: [{ folder: "D:/Workspace", scheme: "file" }],
      previewOptions: { matchLines: 1 },
    }, SearchProviderType.text)

    expect(normalized).toEqual(expect.objectContaining({
      query: "needle",
      include: ["src/**"],
      exclude: ["dist/**"],
      regex: false,
      caseSensitive: false,
      maxResults: 12,
      previewOptions: { matchLines: 1 },
      type: QueryType.Text,
    }))
  })
})
