import { describe, expect, it, vi } from "vitest"
import { CodekSearchService } from "../vscode-adapter/workbench/services/search/common/searchService"
import { registerWorkspaceSearchServiceProvider } from "./workspaceSearchServiceProvider"

describe("registerWorkspaceSearchServiceProvider", () => {
  it("routes workspace text search through ISearchService file provider", async () => {
    const service = new CodekSearchService()
    const searchTextInProject = vi.fn(async () => ({
      matches: [
        { path: "src/app.ts", line: 1, column: 8, matchLength: 6, preview: "const needle = true" },
      ],
      truncated: false,
    }))
    const disposable = registerWorkspaceSearchServiceProvider({
      searchService: service,
      workspaceManager: {
        searchTextInProject,
        getAllFiles: () => ({ "src/local.ts": "needle from cache" }),
      },
    })

    const result = await service.textSearch({
      query: "needle",
      include: ["src/**"],
      exclude: [],
      maxResults: 1000,
      includeContentForSmallFiles: true,
    })

    expect(searchTextInProject).toHaveBeenCalledWith("needle", expect.objectContaining({
      include: ["src/**"],
      exclude: [],
      maxResults: 1000,
      includeContentForSmallFiles: true,
      signal: expect.any(AbortSignal),
    }))
    expect(result.matches).toEqual([
      { path: "src/app.ts", line: 1, column: 8, matchLength: 6, preview: "const needle = true" },
    ])
    expect(result.stateSource).toBe("workspaceManager.searchTextInProject")

    disposable.dispose()
  })

  it("preserves includeContentForSmallFiles instead of forcing cached content collection", async () => {
    const service = new CodekSearchService()
    const searchTextInProject = vi.fn(async () => ({
      matches: [{ path: "src/app.ts", line: 1, column: 1, matchLength: 6 }],
      truncated: false,
    }))
    registerWorkspaceSearchServiceProvider({
      searchService: service,
      workspaceManager: {
        searchTextInProject,
        getAllFiles: () => ({ "src/app.ts": "needle" }),
      },
    })

    await service.textSearch({
      query: "needle",
      includeContentForSmallFiles: false,
    })

    expect(searchTextInProject).toHaveBeenCalledWith("needle", expect.objectContaining({
      includeContentForSmallFiles: false,
      signal: expect.any(AbortSignal),
    }))
  })

  it("keeps opened-file cache fallback inside the provider when manager search returns null", async () => {
    const service = new CodekSearchService()
    registerWorkspaceSearchServiceProvider({
      searchService: service,
      workspaceManager: {
        searchTextInProject: vi.fn(async () => null),
        getAllFiles: () => ({
          "src/local.ts": "const local = 'local local'\n",
          "src/ignored.test.ts": "local ignored",
        }),
      },
    })

    const result = await service.textSearch({
      query: "local",
      exclude: ["**/*.test.ts"],
      maxResults: 10,
      includeContentForSmallFiles: true,
    })

    expect(result).toEqual(expect.objectContaining({
      truncated: false,
      stateSource: "openedWorkspaceCache",
      matches: [
        {
          path: "src/local.ts",
          line: 1,
          column: 7,
          matchLength: 5,
          preview: "const local = 'local local'",
          occurrences: [
            { column: 7, matchLength: 5 },
            { column: 16, matchLength: 5 },
            { column: 22, matchLength: 5 },
          ],
        },
      ],
      fileContents: {
        "src/local.ts": "const local = 'local local'\n",
      },
    }))
  })

  it("marks workspace-manager failures as partial cache fallback when opened files still satisfy the query", async () => {
    const service = new CodekSearchService()
    registerWorkspaceSearchServiceProvider({
      searchService: service,
      workspaceManager: {
        searchTextInProject: vi.fn(async () => {
          throw new Error("rg unavailable")
        }),
        getAllFiles: () => ({
          "src/local.ts": "const local = 'local local'\n",
        }),
      },
    })

    const result = await service.textSearch({
      query: "local",
      maxResults: 10,
      includeContentForSmallFiles: true,
    })

    expect(result).toEqual(expect.objectContaining({
      success: false,
      partial: true,
      error: "rg unavailable",
      stateSource: "workspaceManager.searchTextInProject+openedWorkspaceCache",
      matches: [
        expect.objectContaining({
          path: "src/local.ts",
          preview: "const local = 'local local'",
        }),
      ],
    }))
  })
})
