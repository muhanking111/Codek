import { beforeEach, describe, expect, it, vi } from "vitest"
import { CancellationTokenSource } from "../vscode-adapter/base/common/cancellation"
import { getSingletonServiceDescriptors } from "../vscode-adapter/platform/instantiation/common/extensions"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"
import { clearQuickAccessProviders } from "../vscode-adapter/platform/quickinput/common/quickAccess"
import { clearCommands, executeCommand, getCommand } from "./commandRegistry"
import { openPaletteSymbolSearch } from "./navigationActions"
import {
  clearSymbolNavigationCommandHandoff,
  globalSymbolNavigationWorkbenchService,
  ISymbolNavigationWorkbenchService,
  SymbolNavigationWorkbenchService,
  type CodekSymbolInformation,
} from "./symbolNavigationService"
import type { NavigationActionContext } from "./navigationActions"

function symbol(overrides: Partial<CodekSymbolInformation>): CodekSymbolInformation {
  return {
    name: "run",
    kind: "function",
    path: "src/main.ts",
    line: 1,
    column: 1,
    detail: "",
    ...overrides,
  }
}

function resetRegistries(): void {
  clearCommands()
  clearQuickAccessProviders()
  clearSymbolNavigationCommandHandoff()
}

beforeEach(() => {
  resetRegistries()
})

describe("SymbolNavigationWorkbenchService", () => {
  it("registers VS Code-style provider registries and resolves the service identifier", async () => {
    const service = new SymbolNavigationWorkbenchService()
    const collection = new ServiceCollection([ISymbolNavigationWorkbenchService, service])
    const singleton = getSingletonServiceDescriptors().find(([id]) => id === ISymbolNavigationWorkbenchService)

    const disposable = service.registerWorkspaceSymbolProvider({
      provideWorkspaceSymbols: (query) => [
        symbol({ name: `run:${query}`, line: 4, column: 2 }),
      ],
    })

    await expect(service.getWorkspaceSymbols("main")).resolves.toMatchObject([
      { name: "run:main", path: "src/main.ts", line: 4, column: 2 },
    ])
    expect(String(ISymbolNavigationWorkbenchService)).toBe("symbolNavigationWorkbenchService")
    expect(collection.get(ISymbolNavigationWorkbenchService)).toBe(service)
    expect(singleton?.[1]).toBe(globalSymbolNavigationWorkbenchService)

    disposable.dispose()
    await expect(service.getWorkspaceSymbols("main")).resolves.toEqual([])
  })

  it("fans out providers, isolates failures, deduplicates symbols, and honors cancellation", async () => {
    const service = new SymbolNavigationWorkbenchService()
    service.registerWorkspaceSymbolProvider({
      provideWorkspaceSymbols: () => {
        throw new Error("provider failed")
      },
    })
    service.registerWorkspaceSymbolProvider({
      provideWorkspaceSymbols: () => [
        symbol({ name: "duplicate", path: "src/a.ts", line: 3, column: 1 }),
        symbol({ name: "duplicate", path: "src/a.ts", line: 3, column: 1 }),
        symbol({ name: "other", path: "src/b.ts", line: 1, column: 1 }),
      ],
    })

    await expect(service.getWorkspaceSymbols("dup")).resolves.toEqual([
      expect.objectContaining({ name: "duplicate", path: "src/a.ts" }),
      expect.objectContaining({ name: "other", path: "src/b.ts" }),
    ])

    const cts = new CancellationTokenSource()
    cts.cancel()
    await expect(service.getWorkspaceSymbols("dup", cts.token)).resolves.toEqual([])
  })

  it("projects flat document symbols into an outline tree and quick pick elements", () => {
    const service = new SymbolNavigationWorkbenchService()
    const symbols = [
      symbol({
        name: "Runner",
        kind: "class",
        line: 1,
        column: 1,
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 20, endColumn: 1 },
      }),
      symbol({
        name: "run",
        kind: "method",
        line: 4,
        column: 3,
        detail: "class Runner",
        range: { startLineNumber: 4, startColumn: 3, endLineNumber: 6, endColumn: 4 },
      }),
      symbol({
        name: "helper",
        kind: "function",
        line: 30,
        column: 1,
        range: { startLineNumber: 30, startColumn: 1, endLineNumber: 32, endColumn: 1 },
      }),
      symbol({ name: "reactive", kind: "import", line: 0, column: 0 }),
    ]

    const outline = service.projectOutlineTree(symbols)
    expect(outline).toHaveLength(2)
    expect(outline[0]).toMatchObject({
      label: "Runner",
      kind: "class",
      children: [expect.objectContaining({ label: "run", kind: "method" })],
    })
    expect(outline[1]).toMatchObject({ label: "helper", kind: "function" })

    expect(service.projectQuickAccessItems(symbols).map((item) => item.label)).toEqual([
      "reactive",
      "Runner",
      "run",
      "helper",
    ])
  })

  it("filters workspace symbols through QuickAccess item projection and discards stale results", async () => {
    const service = new SymbolNavigationWorkbenchService()
    let resolveSlow: ((value: CodekSymbolInformation[]) => void) | undefined
    service.registerWorkspaceSymbolProvider({
      provideWorkspaceSymbols: (query) => query === "slow"
        ? new Promise<CodekSymbolInformation[]>((resolve) => { resolveSlow = resolve })
        : [symbol({ name: `match:${query}`, line: 7, column: 5 })],
    })

    await expect(service.provideQuickAccessItems("main")).resolves.toEqual([
      expect.objectContaining({
        id: "src/main.ts:7:5:function:match:main",
        label: "match:main",
        commandId: "workbench.action.openSymbol",
        args: [expect.objectContaining({ name: "match:main" })],
      }),
    ])

    const slow = service.provideQuickAccessItems("slow")
    const fast = service.provideQuickAccessItems("fast")
    resolveSlow?.([symbol({ name: "slow", line: 2 })])

    await expect(fast).resolves.toMatchObject([{ label: "match:fast" }])
    await expect(slow).resolves.toEqual([])
  })

  it("opens symbols through the command handoff and shared navigation service", async () => {
    const service = new SymbolNavigationWorkbenchService()
    const editor = {
      setPosition: vi.fn(),
      revealPositionInCenter: vi.fn(),
      focus: vi.fn(),
    }
    const workspace = { activeFile: "src/current.ts" }
    const openFile = vi.fn(async (path: string) => {
      workspace.activeFile = path
      return true
    })
    const updateSelectedSymbol = vi.fn()

    service.registerCommandHandoff({
      getEditor: () => editor,
      getActiveFile: () => workspace.activeFile,
      openFile,
      updateSelectedSymbol,
      openSidebarView: vi.fn(),
      setSymbolQuery: vi.fn(),
    })

    expect(getCommand("workbench.action.openSymbol")).toBeTruthy()
    await expect(executeCommand("workbench.action.openSymbol", [symbol({ name: "run", path: "src/run.ts", line: 8, column: 2 })])).resolves.toBe(true)

    expect(openFile).toHaveBeenCalledWith("src/run.ts")
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 8, column: 2 })
    expect(updateSelectedSymbol).toHaveBeenCalledWith("run")
  })

  it("keeps the old # symbol-search entry as a proxy to the service command handoff", async () => {
    const context = createNavigationContext()

    openPaletteSymbolSearch("runner", context)

    expect(context.openSidebarView).toHaveBeenCalledWith("symbols")
    expect(context.setSymbolQuery).toHaveBeenCalledWith("runner")
    expect(getCommand("workbench.action.showAllSymbols")).toBeTruthy()

    await expect(executeCommand("workbench.action.showAllSymbols", ["helper"])).resolves.toBe(true)

    expect(context.openSidebarView).toHaveBeenCalledWith("symbols")
    expect(context.setSymbolQuery).toHaveBeenCalledWith("helper")
  })
})

function createNavigationContext(): NavigationActionContext {
  const editor = {
    setPosition: vi.fn(),
    revealPositionInCenter: vi.fn(),
    focus: vi.fn(),
  }
  const workspace = { activeFile: "src/main.ts", projectRoot: "D:/Workspace" }
  return {
    getEditor: () => editor,
    getMonacoApi: () => ({}),
    getWorkspace: () => workspace,
    openFile: vi.fn(async (path: string) => {
      workspace.activeFile = path
      return true
    }),
    updateSelectedSymbol: vi.fn(),
    openSidebarView: vi.fn(),
    setSymbolQuery: vi.fn(),
    nextTick: (callback?: () => void) => {
      callback?.()
      return Promise.resolve()
    },
    getBreadcrumbPath: vi.fn(() => []),
    getSymbolBreadcrumb: vi.fn(() => []),
    getBreadcrumbState: () => ({ path: [], symbols: [], activeDropdown: null }),
    setBreadcrumbPath: vi.fn(),
    setBreadcrumbSymbols: vi.fn(),
    setActiveBreadcrumbDropdown: vi.fn(),
  }
}
