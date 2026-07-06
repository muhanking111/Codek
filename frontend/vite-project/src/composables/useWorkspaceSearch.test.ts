import { afterEach, describe, expect, it, vi } from "vitest"
import { useWorkspaceSearch } from "./useWorkspaceSearch"
import { CodekSearchService, type CodekSearchResult } from "../vscode-adapter/workbench/services/search/common/searchService"

afterEach(() => {
  vi.useRealTimers()
})

describe("useWorkspaceSearch", () => {
  it("uses workspace text search service results for grep groups", async () => {
    const service = new CodekSearchService({
      textSearch: async (query): Promise<CodekSearchResult> => {
        serviceCalls.push(query)
        return {
          matches: [
            {
              path: "src/hidden.ts",
              line: 7,
              column: 14,
              matchLength: 6,
              preview: "const value = needle",
            },
          ],
          truncated: false,
        }
      },
    })
    const serviceCalls: unknown[] = []
    const search = useWorkspaceSearch({
      searchService: service,
      getSettings: () => ({
        "search.include": ["src/**/*.ts"],
        "search.exclude": [],
      }),
    })

    await search.refreshSearchResults("needle")

    expect(serviceCalls).toEqual([
      expect.objectContaining({
        query: "needle",
        include: ["src/**/*.ts"],
        exclude: [],
        regex: false,
        caseSensitive: false,
        wholeWord: false,
        maxResults: 1000,
        includeContentForSmallFiles: true,
        type: 2,
      }),
    ])
    expect(search.searchResults.value).toEqual([])
    expect(search.grepResults.value).toEqual([
      {
        path: "src/hidden.ts",
        matches: [
          {
            id: "src/hidden.ts:7:14:6:0",
            line: 7,
            text: "const value = needle",
            column: 14,
            matchLength: 6,
            count: 1,
            occurrences: [{ column: 14, matchLength: 6 }],
          },
        ],
      },
    ])
  })

  it("keeps small-file service content on grep groups for direct search navigation", async () => {
    const search = useWorkspaceSearch({
      searchService: new CodekSearchService({
        textSearch: async () => ({
          matches: [
            {
              path: "src/cached.ts",
              line: 2,
              column: 16,
              matchLength: 6,
              preview: "export const v = needle",
            },
          ],
          fileContents: {
            "src/cached.ts": "line one\nexport const v = needle\n",
          },
          truncated: false,
        }),
      }),
      getSettings: () => ({}),
    })

    await search.refreshSearchResults("needle")

    expect(search.grepResults.value[0]).toEqual(expect.objectContaining({
      path: "src/cached.ts",
      content: "line one\nexport const v = needle\n",
    }))
  })

  it("does not publish opened-file cache matches before the workspace text search service returns", async () => {
    let resolveService: (value: CodekSearchResult) => void = () => {}
    const search = useWorkspaceSearch({
      searchService: new CodekSearchService({
        textSearch: async () => new Promise((resolve) => {
          resolveService = resolve
        }),
      }),
      getSettings: () => ({}),
    })

    const refresh = search.refreshSearchResults("needle")
    await Promise.resolve()

    expect(search.searchBusy.value).toBe(true)
    expect(search.grepResults.value).toEqual([])

    resolveService({
      matches: [
        {
          path: "src/service.ts",
          line: 1,
          column: 1,
          matchLength: 6,
          preview: "needle from service",
        },
      ],
      truncated: false,
    })
    await refresh

    expect(search.grepResults.value).toEqual([
      {
        path: "src/service.ts",
        matches: [
          {
            id: "src/service.ts:1:1:6:0",
            line: 1,
            text: "needle from service",
            column: 1,
            matchLength: 6,
            count: 1,
            occurrences: [{ column: 1, matchLength: 6 }],
          },
        ],
      },
    ])
  })

  it("keeps opened-file cache fallback inside the registered SearchService provider", async () => {
    const serviceCalls: unknown[] = []
    const service = new CodekSearchService({
      textSearch: async (query) => {
        serviceCalls.push(query)
        return {
          matches: [
            {
              path: "src/service.ts",
              line: 1,
              column: 1,
              matchLength: 6,
              preview: "needle from service",
            },
          ],
          truncated: false,
        }
      },
    })
    const search = useWorkspaceSearch({
      searchService: service,
      getSettings: () => ({}),
    })

    await search.refreshSearchResults("needle")

    expect(serviceCalls).toEqual([
      expect.objectContaining({
        query: "needle",
        include: [],
        exclude: [],
        regex: false,
        caseSensitive: false,
        wholeWord: false,
        maxResults: 1000,
        includeContentForSmallFiles: true,
        type: 2,
      }),
    ])
    expect(search.grepResults.value).toEqual([
      {
        path: "src/service.ts",
        matches: [
          {
            id: "src/service.ts:1:1:6:0",
            line: 1,
            text: "needle from service",
            column: 1,
            matchLength: 6,
            count: 1,
            occurrences: [{ column: 1, matchLength: 6 }],
          },
        ],
      },
    ])
  })

  it("collapses repeated occurrences on the same line while preserving jump metadata", async () => {
    const search = useWorkspaceSearch({
      searchService: new CodekSearchService({
        textSearch: async () => ({
          matches: [
            {
              path: "src/repeated.ts",
              line: 3,
              column: 7,
              matchLength: 6,
              preview: "const needle = needle",
            },
            {
              path: "src/repeated.ts",
              line: 3,
              column: 16,
              matchLength: 6,
              preview: "const needle = needle",
            },
          ],
          truncated: false,
        }),
      }),
      getSettings: () => ({}),
    })

    await search.refreshSearchResults("needle")

    expect(search.searchResults.value).toEqual([])
    expect(search.grepResults.value).toEqual([
      {
        path: "src/repeated.ts",
        matches: [
          {
            id: "src/repeated.ts:3:7:6:0",
            line: 3,
            text: "const needle = needle",
            column: 7,
            matchLength: 6,
            count: 2,
            occurrences: [
              { column: 7, matchLength: 6 },
              { column: 16, matchLength: 6 },
            ],
          },
        ],
      },
    ])
  })

  it("preserves service-provided same-line occurrences from one result", async () => {
    const search = useWorkspaceSearch({
      searchService: new CodekSearchService({
        textSearch: async () => ({
          matches: [
            {
              path: "src/service-repeated.ts",
              line: 4,
              column: 12,
              matchLength: 5,
              preview: "const value = token token token",
              occurrences: [
                { column: 15, matchLength: 5 },
                { column: 21, matchLength: 5 },
                { column: 27, matchLength: 5 },
              ],
            },
          ],
          truncated: false,
        }),
      }),
      getSettings: () => ({}),
    })

    await search.refreshSearchResults("token")

    expect(search.grepResults.value).toEqual([
      {
        path: "src/service-repeated.ts",
        matches: [
          {
            id: "src/service-repeated.ts:4:15:5:0",
            line: 4,
            text: "const value = token token token",
            column: 15,
            matchLength: 5,
            count: 3,
            occurrences: [
              { column: 15, matchLength: 5 },
              { column: 21, matchLength: 5 },
              { column: 27, matchLength: 5 },
            ],
          },
        ],
      },
    ])
  })

  it("surfaces SearchService failure instead of running UI cache fallback", async () => {
    const search = useWorkspaceSearch({
      searchService: new CodekSearchService({
        textSearch: async () => {
          throw new Error("service unavailable")
        },
      }),
      getSettings: () => ({
        "search.exclude": ["**/*.test.ts"],
      }),
    })

    await search.refreshSearchResults("needle")

    expect(search.searchError.value).toContain("service unavailable")
    expect(search.grepResults.value).toEqual([])
  })

  it("cancels stale SearchService results when a newer search starts", async () => {
    let resolveFirst: (value: CodekSearchResult) => void = () => {}
    let resolveSecond: (value: CodekSearchResult) => void = () => {}
    const search = useWorkspaceSearch({
      searchService: new CodekSearchService({
        textSearch: async (query) => new Promise((resolve) => {
          if (query.query === "first") resolveFirst = resolve
          else resolveSecond = resolve
        }),
      }),
      getSettings: () => ({}),
    })

    const first = search.refreshSearchResults("first")
    const second = search.refreshSearchResults("second")
    await Promise.resolve()

    resolveSecond({
      matches: [{ path: "src/second.ts", line: 1, column: 1, matchLength: 6, preview: "second" }],
      truncated: false,
    })
    await second
    resolveFirst({
      matches: [{ path: "src/first.ts", line: 1, column: 1, matchLength: 5, preview: "first" }],
      truncated: false,
    })
    await first

    expect(search.grepResults.value).toEqual([
      {
        path: "src/second.ts",
        matches: [
          {
            id: "src/second.ts:1:1:6:0",
            line: 1,
            text: "second",
            column: 1,
            matchLength: 6,
            count: 1,
            occurrences: [{ column: 1, matchLength: 6 }],
          },
        ],
      },
    ])
  })

  it("uses service timeout cancellation without falling back to UI cache", async () => {
    const search = useWorkspaceSearch({
      searchService: new CodekSearchService({
        textSearch: async () => new Promise(() => {}),
      }),
      serviceTimeoutMs: 1,
      getSettings: () => ({}),
    })

    await search.refreshSearchResults("json")

    expect(search.searchError.value).toContain("workspace search timed out")
    expect(search.grepResults.value).toEqual([])
  })

  it("handles invalid regex without throwing", async () => {
    const search = useWorkspaceSearch({
      searchService: new CodekSearchService({
        textSearch: async () => ({
          matches: [{ path: "src/open.ts", line: 1, column: 1, matchLength: 1, preview: "needle" }],
        }),
      }),
      getSettings: () => ({}),
    })
    search.isRegex.value = true

    await search.refreshSearchResults("(")

    expect(search.grepResults.value).toEqual([])
  })
})
