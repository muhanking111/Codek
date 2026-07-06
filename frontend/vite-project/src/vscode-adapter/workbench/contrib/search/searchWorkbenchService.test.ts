import { describe, expect, it, vi } from "vitest"
import { ServiceCollection } from "../../../platform/instantiation/common/serviceCollection"
import { InstantiationService } from "../../../platform/instantiation/common/instantiationService"
import { CodekBulkEditService } from "../../services/bulkEdit/common/bulkEditService"
import { CodekSearchService } from "../../services/search/common/searchService"
import { CodekReplaceService } from "./browser/replaceService"
import {
  CodekSearchWorkbenchService,
  ISearchWorkbenchService,
  SEARCH_MIGRATION_AUDIT_EVIDENCE,
  createSearchWorkbenchOwnerEvidence,
  createTextSearchWorkbenchQuery,
  globalSearchWorkbenchService,
  normalizeRawTextSearchMatches,
  projectTextSearchWorkbenchResult,
} from "./searchWorkbenchService"

describe("CodekSearchWorkbenchService", () => {
  it("registers a VS Code-style search workbench service identifier", () => {
    const service = new CodekSearchWorkbenchService()
    const collection = new ServiceCollection([ISearchWorkbenchService, service])
    const instantiationService = new InstantiationService(collection)

    const resolved = instantiationService.invokeFunction((accessor) => accessor.get(ISearchWorkbenchService))

    expect(String(ISearchWorkbenchService)).toBe("searchWorkbenchService")
    expect(resolved).toBe(service)
    expect(resolved._serviceBrand).toBeUndefined()
    expect(globalSearchWorkbenchService._serviceBrand).toBeUndefined()
  })

  it("documents the Search migration blocker audit contract without a second state source", () => {
    expect(SEARCH_MIGRATION_AUDIT_EVIDENCE).toEqual(expect.objectContaining({
      stateSource: "ISearchService.textSearch -> searchModel.resultTree",
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
      remainingUiOwnerGap: expect.objectContaining({
        status: "partial",
        connected: false,
        currentOwner: "SearchPanel.vue",
        vscodeOwner: "SearchView + SearchWidget + SearchResultsView",
      }),
      rawMatchesRole: "adapter-normalization-only",
      temporaryProviderInSearchPanel: false,
      secondSearchStateSource: false,
    }))
    expect(SEARCH_MIGRATION_AUDIT_EVIDENCE.vscodeSourceEntrypoints).toEqual(expect.arrayContaining([
      "src/vs/workbench/services/search/common/search.ts",
      "src/vs/workbench/contrib/search/browser/searchTreeModel/searchModel.ts",
      "src/vs/workbench/contrib/search/browser/searchTreeModel/fileMatch.ts",
      "src/vs/workbench/contrib/search/browser/searchTreeModel/folderMatch.ts",
      "src/vs/workbench/contrib/search/browser/searchTreeModel/textSearchHeading.ts",
      "src/vs/workbench/contrib/search/browser/searchView.ts",
      "src/vs/workbench/contrib/search/browser/replace.ts",
      "src/vs/workbench/contrib/search/common/searchHistoryService.ts",
      "src/vs/workbench/contrib/search/common/constants.ts",
    ]))
    expect(SEARCH_MIGRATION_AUDIT_EVIDENCE.codekEntrypoints).toEqual(expect.arrayContaining([
      "frontend/vite-project/src/vscode-adapter/workbench/services/search/common/searchService.ts",
      "frontend/vite-project/src/vscode-adapter/workbench/contrib/search/searchWorkbenchService.ts",
      "frontend/vite-project/src/vscode-adapter/workbench/contrib/search/searchModel.ts",
      "frontend/vite-project/src/components/SearchPanel.vue",
    ]))
  })

  it("projects one owner evidence contract for text search, result tree, replace, history, and context", () => {
    expect(createSearchWorkbenchOwnerEvidence()).toEqual({
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
    })
  })

  it("creates a text query contract without losing VS Code pattern options", () => {
    expect(createTextSearchWorkbenchQuery({
      root: "D:/Workspace",
      query: "needle",
      include: ["src/**"],
      exclude: ["dist/**"],
      regex: true,
      caseSensitive: true,
      wholeWord: true,
      maxResults: 25,
      previewOptions: { matchLines: 1, charsPerLine: 120 },
      includeContentForSmallFiles: true,
    })).toEqual(expect.objectContaining({
      type: 2,
      root: "D:/Workspace",
      query: "needle",
      contentPattern: {
        pattern: "needle",
        isRegExp: true,
        isCaseSensitive: true,
        isWordMatch: true,
      },
      include: ["src/**"],
      exclude: ["dist/**"],
      maxResults: 25,
      previewOptions: { matchLines: 1, charsPerLine: 120 },
      includeContentForSmallFiles: true,
    }))
  })

  it("projects flat service results into the result tree with evidence", () => {
    const projection = projectTextSearchWorkbenchResult({
      matches: [
        { path: "src/a.ts", line: 1, column: 7, matchLength: 6, preview: "const needle = needle" },
        { path: "src/a.ts", line: 1, column: 16, matchLength: 6, preview: "const needle = needle" },
      ],
      fileContents: {
        "src/a.ts": "const needle = needle\n",
      },
      truncated: true,
    })

    expect(projection).toEqual(expect.objectContaining({
      source: "searchWorkbenchService",
      fileCount: 1,
      matchCount: 2,
      truncated: true,
      success: true,
      partial: false,
      evidence: expect.objectContaining({
        serviceId: "searchWorkbenchService",
        stateSource: "ISearchService.textSearch -> searchModel.resultTree",
        searchServiceOwner: "ISearchService",
        textSearchProviderOwner: "ISearchService.registerSearchResultProvider(file,text)",
        queryOwner: "searchWorkbenchService.createTextQuery",
        resultModelOwner: "searchModel.resultTree",
        resultSource: "ISearchService.textSearch",
        resourceUriKind: "file",
        cancellationOwner: "CancellationToken -> AbortSignal",
        remainingUiOwnerGap: expect.objectContaining({
          status: "partial",
          connected: false,
        }),
        workspaceMutation: "none",
        preservesAgentEvidence: true,
        owners: expect.objectContaining({
          searchService: "ISearchService",
          textSearchProvider: "ISearchService.textSearch",
          query: "searchWorkbenchService.createTextQuery",
          resultTree: "searchModel.resultTree",
          resultSource: "CodekSearchResult.stateSource",
          resourceUriKind: "CodekSearchQuery folder/root/extraFileResources + result paths",
          cancellation: "CancellationToken -> AbortSignal",
          rawMatchesRole: "adapter-normalization-only",
          secondSearchStateSource: false,
        }),
      }),
    }))
    expect(projection.resultTree).toEqual([
      {
        path: "src/a.ts",
        content: "const needle = needle\n",
        matches: [{
          id: "src/a.ts:1:7:6:0",
          line: 1,
          text: "const needle = needle",
          column: 7,
          matchLength: 6,
          count: 2,
          occurrences: [
            { column: 7, matchLength: 6 },
            { column: 16, matchLength: 6 },
          ],
        }],
      },
    ])
  })

  it("projects provider-backed search state source into workbench evidence", () => {
    const projection = projectTextSearchWorkbenchResult({
      matches: [
        { path: "src/cache.ts", line: 1, column: 7, matchLength: 5, preview: "const local = 'local local'" },
      ],
      partial: true,
      success: false,
      error: "rg unavailable",
      stateSource: "workspaceManager.searchTextInProject+openedWorkspaceCache",
    })

    expect(projection.partial).toBe(true)
    expect(projection.success).toBe(false)
    expect(projection.error).toBe("rg unavailable")
    expect(projection.evidence.stateSource).toBe(
      "ISearchService.textSearch -> workspaceManager.searchTextInProject+openedWorkspaceCache -> searchModel.resultTree",
    )
    expect(projection.evidence.resultSource).toBe("workspaceManager.searchTextInProject+openedWorkspaceCache")
    expect(projection.evidence.resourceUriKind).toBe("file")
  })

  it("keeps partial UI owner evidence separate from connected service/model evidence", () => {
    const query = createTextSearchWorkbenchQuery({
      query: "needle",
      folderQueries: [
        { root: "D:/Workspace", scheme: "file" },
        { root: "/server", scheme: "mcp-resource" },
      ],
      extraFileResources: [{ scheme: "mcp-resource", path: "/server/resource" }],
    })

    const projection = projectTextSearchWorkbenchResult({
      matches: [
        { path: "mcp-resource:/server/resource.ts", line: 1, column: 1, matchLength: 6, preview: "needle" },
      ],
      stateSource: "ISearchService.textSearch -> registered:file+mcp-resource",
    }, { query })

    expect(projection.evidence).toEqual(expect.objectContaining({
      searchServiceOwner: "ISearchService",
      textSearchProviderOwner: "ISearchService.registerSearchResultProvider(file,text)",
      queryOwner: "searchWorkbenchService.createTextQuery",
      resultModelOwner: "searchModel.resultTree",
      resultSource: "ISearchService.textSearch -> registered:file+mcp-resource",
      resourceUriKind: "mixed",
      cancellationOwner: "CancellationToken -> AbortSignal",
      remainingUiOwnerGap: expect.objectContaining({
        status: "partial",
        connected: false,
        currentOwner: "SearchPanel.vue",
        vscodeOwner: "SearchView + SearchWidget + SearchResultsView",
        reason: expect.stringContaining("does not own App.vue/generic shell"),
      }),
    }))
    expect(projection.evidence.owners.secondSearchStateSource).toBe(false)
  })

  it("normalizes VS Code IFileMatch text results into Codek raw matches", () => {
    expect(normalizeRawTextSearchMatches([
      {
        resource: { fsPath: "D:/Workspace/src/app.ts" },
        results: [{
          previewText: "const needle = true",
          rangeLocations: [{
            source: { startLineNumber: 4, startColumn: 6, endLineNumber: 4, endColumn: 12 },
            preview: { startLineNumber: 0, startColumn: 6, endLineNumber: 0, endColumn: 12 },
          }],
        }],
      },
    ])).toEqual([
      {
        path: "D:/Workspace/src/app.ts",
        line: 5,
        column: 7,
        matchLength: 6,
        preview: "const needle = true",
        occurrences: [{ column: 7, matchLength: 6 }],
      },
    ])
  })

  it("runs legacy text search through the unified workbench projection", async () => {
    const textSearch = vi.fn(async () => ({
      matches: [{ path: "src/app.ts", line: 2, column: 14, matchLength: 6, preview: "export const needle = true" }],
      truncated: false,
    }))
    const service = new CodekSearchWorkbenchService({
      searchService: new CodekSearchService({ textSearch }),
    })

    const resultTree = await service.legacyTextSearch({
      root: "D:/Workspace",
      query: "needle",
      include: ["src/**"],
      exclude: ["dist/**"],
      maxResults: 1000,
      includeContentForSmallFiles: true,
    })

    expect(textSearch).toHaveBeenCalledWith(expect.objectContaining({
      type: 2,
      query: "needle",
      include: ["src/**"],
      exclude: ["dist/**"],
      maxResults: 1000,
      includeContentForSmallFiles: true,
    }), undefined)
    expect(resultTree).toEqual([
      {
        path: "src/app.ts",
        matches: [{
          id: "src/app.ts:2:14:6:0",
          line: 2,
          text: "export const needle = true",
          column: 14,
          matchLength: 6,
          count: 1,
          occurrences: [{ column: 14, matchLength: 6 }],
        }],
      },
    ])
  })

  it("hands replace preview dry-run back to replace apply without bypassing bulk edit evidence", async () => {
    const contents = {
      "src/app.ts": "const value = needle + needle\n",
    }
    const saveFile = vi.fn(async (path: string, content: string) => {
      contents[path as keyof typeof contents] = content
      return true
    })
    const service = new CodekSearchWorkbenchService({
      replaceService: new CodekReplaceService({
        bulkEditService: new CodekBulkEditService({
          readFile: async (path) => contents[path as keyof typeof contents],
          saveFile,
        }),
      }),
    })

    const preview = await service.previewReplace({
      mode: "all",
      request: {
        pattern: /needle/g,
        replaceText: "haystack",
        matches: [{
          path: "src/app.ts",
          matches: [{
            line: 1,
            column: 15,
            matchLength: 6,
            occurrences: [
              { column: 15, matchLength: 6 },
              { column: 24, matchLength: 6 },
            ],
          }],
        }],
      },
    })

    expect(preview).toEqual(expect.objectContaining({
      source: "searchWorkbenchService.replacePreview",
      mode: "all",
      result: expect.objectContaining({
        applied: false,
        dryRun: true,
        summary: expect.objectContaining({
          changedFiles: ["src/app.ts"],
          editCount: 2,
        }),
        projection: expect.objectContaining({
          source: "workspaceEditService",
          dryRun: true,
        }),
      }),
      evidence: expect.objectContaining({
        stateSource: "IReplaceService.replaceOne/replaceAll -> bulkEditService.apply -> workspaceEditService.apply",
        workspaceMutation: "bulkEditService",
        preservesAgentEvidence: true,
        owners: expect.objectContaining({
          replacePreview: "IReplaceService.openReplacePreview-compatible",
          applyReplace: "IReplaceService.replaceOne/replaceAll -> bulkEditService.apply",
          resultTree: "searchModel.resultTree",
        }),
      }),
    }))
    expect(saveFile).not.toHaveBeenCalled()

    const applied = await service.applyReplacePreview(preview)

    expect(applied.applied).toBe(true)
    expect(saveFile).toHaveBeenCalledWith(
      "src/app.ts",
      "const value = haystack + haystack\n",
      expect.objectContaining({ reason: "search replace" }),
    )
  })
})
