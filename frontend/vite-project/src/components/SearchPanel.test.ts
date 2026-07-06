import { mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import SearchPanel from "./SearchPanel.vue"

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(async () => ({
    success: true,
    matches: [],
    truncated: false,
  })),
  retrieveRelevantFiles: vi.fn(async () => []),
}))

const searchWorkbenchService = vi.hoisted(() => ({
  textSearch: vi.fn(),
}))

const searchService = vi.hoisted(() => ({
  registerSearchResultProvider: vi.fn(),
}))

vi.mock("../lib/api", () => ({
  api: {
    post: mocks.apiPost,
  },
}))

vi.mock("../ai/retriever.js", () => ({
  retrieveRelevantFiles: mocks.retrieveRelevantFiles,
}))

vi.mock("../settings/settingsStore", () => ({
  settingsStore: {
    getAll: () => ({}),
  },
}))

vi.mock("../vscode-adapter/workbench/contrib/search/searchWorkbenchService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../vscode-adapter/workbench/contrib/search/searchWorkbenchService")>()
  return {
    ...actual,
    globalSearchWorkbenchService: searchWorkbenchService,
  }
})

vi.mock("../vscode-adapter/workbench/services/search/common/searchService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../vscode-adapter/workbench/services/search/common/searchService")>()
  return {
    ...actual,
    globalSearchService: searchService,
  }
})

describe("SearchPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.retrieveRelevantFiles.mockResolvedValue([])
    searchWorkbenchService.textSearch.mockReset()
    searchWorkbenchService.textSearch.mockResolvedValue(searchProjection())
    searchService.registerSearchResultProvider.mockReturnValue({ dispose: vi.fn() })
    delete (window as unknown as { codek?: unknown }).codek
  })

  afterEach(() => {
    delete (window as unknown as { codek?: unknown }).codek
  })

  it("drives text search through SearchWorkbenchService and renders progress", async () => {
    let resolveSearch: (value: unknown) => void = () => {}
    searchWorkbenchService.textSearch.mockImplementation((_request, _token, onProgress) => {
      onProgress?.({ message: "Searching with provider-backed workspace search" })
      return new Promise((resolve) => {
        resolveSearch = resolve
      })
    })

    const wrapper = mountSearchPanel()

    await wrapper.find(".search-input").setValue("needle")
    await wrapper.find("form").trigger("submit")
    await wrapper.vm.$nextTick()

    expect(searchWorkbenchService.textSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        root: "D:/Workspace",
        query: "needle",
        maxResults: 1000,
        includeContentForSmallFiles: true,
      }),
      expect.anything(),
      expect.any(Function),
    )
    expect(searchService.registerSearchResultProvider).not.toHaveBeenCalled()
    expect(wrapper.find(".search-progress").text()).toBe("Searching with provider-backed workspace search")

    await wrapper.find(".search-submit.cancel").trigger("click")
    resolveSearch(searchProjection())
    wrapper.unmount()
  })

  it("renders the service-backed result tree instead of maintaining a raw-match projection", async () => {
    searchWorkbenchService.textSearch.mockResolvedValue(searchProjection({
      rawMatches: [{
        path: "src/raw-only.ts",
        line: 1,
        column: 1,
        matchLength: 6,
        preview: "raw-only needle",
      }],
      resultTree: [{
        path: "src/app.ts",
        matches: [{
          id: "src/app.ts:1:7:6:0",
          line: 1,
          text: "const needle = true",
          column: 7,
          matchLength: 6,
          count: 1,
          occurrences: [{ column: 7, matchLength: 6 }],
        }],
      }],
      matchCount: 1,
      fileCount: 1,
    }))

    const wrapper = mountSearchPanel()

    await wrapper.find(".search-input").setValue("needle")
    await wrapper.find("form").trigger("submit")
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain("src/app.ts")
    expect(wrapper.text()).toContain("const ")
    expect(wrapper.text()).toContain("needle")
    expect(wrapper.text()).not.toContain("src/raw-only.ts")
    expect(searchService.registerSearchResultProvider).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it("surfaces partial provider-backed failures while preserving fallback matches", async () => {
    searchWorkbenchService.textSearch.mockResolvedValue(searchProjection({
      resultTree: [{
        path: "src/local.ts",
        matches: [{
          id: "src/local.ts:1:7:5:0",
          line: 1,
          text: "const local = 'local local'",
          column: 7,
          matchLength: 5,
          count: 2,
          occurrences: [
            { column: 7, matchLength: 5 },
            { column: 16, matchLength: 5 },
          ],
        }],
      }],
      matchCount: 2,
      fileCount: 1,
      success: false,
      partial: true,
      error: "rg unavailable",
      evidence: searchEvidence("ISearchService.textSearch -> workspaceManager.searchTextInProject+openedWorkspaceCache -> searchModel.resultTree"),
    }))

    const wrapper = mountSearchPanel()

    await wrapper.find(".search-input").setValue("local")
    await wrapper.find("form").trigger("submit")
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    expect(wrapper.find(".search-error").text()).toBe("rg unavailable")
    expect(wrapper.text()).toContain("src/local.ts")
    expect(wrapper.text()).toContain("const local = 'local local'")

    wrapper.unmount()
  })

  it("passes include and exclude filters to the workbench service", async () => {
    const wrapper = mountSearchPanel()

    await wrapper.find(".search-input").setValue("needle")
    const inputs = wrapper.findAll(".search-input")
    await inputs[1].setValue("src/**/*.ts, packages/**/*.ts")
    await inputs[2].setValue("**/node_modules/**, dist/**")
    await wrapper.find("form").trigger("submit")
    await vi.dynamicImportSettled()

    expect(searchWorkbenchService.textSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        include: ["src/**/*.ts", "packages/**/*.ts"],
        exclude: ["**/node_modules/**", "dist/**"],
      }),
      expect.anything(),
      expect.any(Function),
    )
    expect(mocks.apiPost).not.toHaveBeenCalled()
  })

  it("discards stale text-search results from the workbench service", async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    let resolveSecond: (value: unknown) => void = () => {}
    searchWorkbenchService.textSearch
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))

    const wrapper = mountSearchPanel()

    await wrapper.find(".search-input").setValue("first")
    await wrapper.find("form").trigger("submit")
    await wrapper.find(".search-input").setValue("second")
    await wrapper.find("form").trigger("submit")

    resolveSecond(searchProjection({
      resultTree: [{
        path: "src/second.ts",
        matches: [{
          id: "src/second.ts:1:1:6:0",
          line: 1,
          text: "second",
          column: 1,
          matchLength: 6,
          count: 1,
          occurrences: [{ column: 1, matchLength: 6 }],
        }],
      }],
      matchCount: 1,
      fileCount: 1,
    }))
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    resolveFirst(searchProjection({
      resultTree: [{
        path: "src/first.ts",
        matches: [{
          id: "src/first.ts:1:1:5:0",
          line: 1,
          text: "first",
          column: 1,
          matchLength: 5,
          count: 1,
          occurrences: [{ column: 1, matchLength: 5 }],
        }],
      }],
      matchCount: 1,
      fileCount: 1,
    }))
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain("src/second.ts")
    expect(wrapper.text()).not.toContain("src/first.ts")
    wrapper.unmount()
  })

  it("keeps semantic search on the semantic retriever path", async () => {
    mocks.retrieveRelevantFiles.mockResolvedValueOnce([
      {
        path: "src/semantic.ts",
        score: 0.92,
        snippet: "semantic match",
        symbols: ["semanticSymbol"],
      },
    ])

    const wrapper = mountSearchPanel()

    await wrapper.findAll(".search-tab")[1].trigger("click")
    await wrapper.find(".search-input").setValue("semantic")
    await wrapper.find("form").trigger("submit")
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    expect(mocks.retrieveRelevantFiles).toHaveBeenCalledWith("semantic", expect.objectContaining({
      projectRoot: "D:/Workspace",
    }))
    expect(searchWorkbenchService.textSearch).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain("src/semantic.ts")
  })
})

function mountSearchPanel() {
  return mount(SearchPanel, {
    props: {
      visible: true,
      projectRoot: "D:/Workspace",
    },
  })
}

function searchProjection(overrides: Record<string, unknown> = {}) {
  return {
    source: "searchWorkbenchService",
    resultTree: [],
    rawMatches: [],
    fileContents: {},
    matchCount: 0,
    fileCount: 0,
    truncated: false,
    success: true,
    partial: false,
    evidence: searchEvidence(),
    ...overrides,
  }
}

function searchEvidence(stateSource = "ISearchService.textSearch -> workspaceManager.searchTextInProject -> searchModel.resultTree") {
  return {
    serviceId: "searchWorkbenchService",
    stateSource,
    workspaceMutation: "none",
    preservesAgentEvidence: true,
    safetyBoundary: "Search is read-only; replace preview/apply is delegated to replaceService and bulkEditService.",
  }
}
