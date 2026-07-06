// VS Code-style symbol/outline service contract adapted for Codek's analysis cache.
// Source references:
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\search\common\search.ts
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\search\browser\symbolsQuickAccess.ts
// - D:\SourceMirror\vscode\src\vs\workbench\services\outline\browser\outline.ts
// - D:\SourceMirror\vscode\src\vs\editor\contrib\gotoSymbol\browser\symbolNavigation.ts

import { CancellationToken, CancellationTokenSource } from "../vscode-adapter/base/common/cancellation"
import type { IDisposable } from "../vscode-adapter/base/common/lifecycle"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import {
  registerQuickAccessProvider,
  type QuickAccessItem,
  type QuickAccessProviderRunOptions,
} from "../vscode-adapter/platform/quickinput/common/quickAccess"
import { executeCommand, getCommand, registerCommand, type CommandDescriptor } from "./commandRegistry"
import { openLocation, type NavigationServiceContext } from "./navigationService"
import {
  CodekWorkspaceSymbolRegistry,
  normalizeSymbol,
  projectWorkspaceSymbolQuickAccessItems,
  sortAndDedupeSymbols,
  type CodekQuickAccessSymbolItem,
  type CodekSymbolInformation,
  type CodekWorkspaceSymbolProvider,
} from "../languages/workspaceSymbols/workspaceSymbolRegistry"
import {
  CodekDocumentSymbolRegistry,
  createCodekOutlineModel,
  projectOutlineTree as projectDocumentOutlineTree,
  type CodekDocumentSymbolProvider,
  type CodekOutlineElement,
  type CodekOutlineModel,
} from "../languages/outline/outlineModel"
import {
  CodekReferencesModel,
  createReferencesModel as createCodekReferencesModel,
  type CodekReferenceLocation,
  type SymbolReferenceData,
} from "../languages/references/referencesModel"

export type {
  CodekQuickAccessSymbolItem,
  CodekRange,
  CodekSymbolInformation,
  CodekSymbolKind,
  CodekWorkspaceSymbolProvider,
} from "../languages/workspaceSymbols/workspaceSymbolRegistry"
export type {
  CodekBreadcrumbSymbol,
  CodekDocumentSymbolProvider,
  CodekOutlineElement,
  CodekOutlineModel,
} from "../languages/outline/outlineModel"
export type {
  CodekReferenceFileGroup,
  CodekReferenceLocation,
  CodekReferenceProjection,
  CodekReferencesPeekModel,
  SymbolReferenceData,
  SymbolReferenceFile,
} from "../languages/references/referencesModel"

export interface SymbolNavigationStore {
  getFileOutline(path: string): CodekSymbolInformation[]
  getWorkspaceSymbols(query: string): CodekSymbolInformation[]
  getSymbolReferences(symbolName: string): SymbolReferenceData
  setSelectedSymbol(symbolName: string): void
}

export interface SymbolNavigationCommandContext {
  getEditor: NavigationServiceContext["getEditor"]
  getActiveFile: () => string | null | undefined
  openFile: NavigationServiceContext["openFile"]
  updateSelectedSymbol?: (symbolName: string) => void
  openSidebarView?: (view: string) => void
  setSymbolQuery?: (query: string) => void
  nextTick?: (callback?: () => void) => Promise<void> | void
}

export interface ISymbolNavigationWorkbenchService {
  readonly _serviceBrand: undefined
  registerDocumentSymbolProvider(provider: CodekDocumentSymbolProvider): IDisposable
  registerWorkspaceSymbolProvider(provider: CodekWorkspaceSymbolProvider): IDisposable
  registerDefaultAnalysisProvider(store: SymbolNavigationStore): IDisposable
  registerQuickAccessProvider(): IDisposable
  registerCommandHandoff(context: SymbolNavigationCommandContext): IDisposable
  getDocumentSymbols(path: string, token?: CancellationToken): Promise<CodekSymbolInformation[]>
  getWorkspaceSymbols(query: string, token?: CancellationToken): Promise<CodekSymbolInformation[]>
  getOutlineModel(path: string, token?: CancellationToken): Promise<CodekOutlineModel>
  projectOutlineTree(symbols: readonly CodekSymbolInformation[]): CodekOutlineElement[]
  projectQuickAccessItems(symbols: readonly CodekSymbolInformation[]): CodekQuickAccessSymbolItem[]
  createReferencesModel(locations: readonly CodekReferenceLocation[], title?: string): CodekReferencesModel
  provideQuickAccessItems(filter: string, options?: QuickAccessProviderRunOptions): Promise<QuickAccessItem[]>
  openSymbol(symbol: CodekSymbolInformation, options?: { preserveFocus?: boolean }): Promise<boolean>
  showWorkspaceSymbols(query: string): Promise<boolean>
  hasCommandHandoff(): boolean
  clearCommandHandoff(): void
  getSymbolReferences(symbolName: string): SymbolReferenceData
  setSelectedSymbol(symbolName: string): void
  clearProviders(): void
}

export const ISymbolNavigationWorkbenchService =
  createDecorator<ISymbolNavigationWorkbenchService>("symbolNavigationWorkbenchService")

const WORKSPACE_SYMBOL_COMMAND = "workbench.action.showAllSymbols"
const LEGACY_WORKSPACE_SYMBOL_COMMAND = "workbench.action.gotoSymbol"
const OPEN_SYMBOL_COMMAND = "workbench.action.openSymbol"
const QUICK_ACCESS_PREFIX = "#"

export class SymbolNavigationWorkbenchService implements ISymbolNavigationWorkbenchService {
  declare readonly _serviceBrand: undefined

  private readonly documentProviders = new CodekDocumentSymbolRegistry()
  private readonly workspaceProviders = new CodekWorkspaceSymbolRegistry()
  private store: SymbolNavigationStore | null = null
  private commandContext: SymbolNavigationCommandContext | null = null
  private quickAccessDisposable: IDisposable | null = null
  private commandDisposables: IDisposable[] = []
  private generation = 0
  private settingSelectedSymbol = false

  registerDocumentSymbolProvider(provider: CodekDocumentSymbolProvider): IDisposable {
    return this.documentProviders.register(provider)
  }

  registerWorkspaceSymbolProvider(provider: CodekWorkspaceSymbolProvider): IDisposable {
    return this.workspaceProviders.register(provider)
  }

  registerDefaultAnalysisProvider(store: SymbolNavigationStore): IDisposable {
    this.store = store
    const documentProvider = this.registerDocumentSymbolProvider({
      provideDocumentSymbols: (path) => store.getFileOutline(path),
    })
    const workspaceProvider = this.registerWorkspaceSymbolProvider({
      provideWorkspaceSymbols: (query) => store.getWorkspaceSymbols(query),
    })
    return {
      dispose: () => {
        documentProvider.dispose()
        workspaceProvider.dispose()
        if (this.store === store) this.store = null
      },
    }
  }

  registerQuickAccessProvider(): IDisposable {
    this.quickAccessDisposable?.dispose()
    const disposable = registerQuickAccessProvider({
      prefix: QUICK_ACCESS_PREFIX,
      placeholder: "Search workspace symbols",
      helpEntries: [{
        prefix: QUICK_ACCESS_PREFIX,
        description: "Symbols",
        commandId: WORKSPACE_SYMBOL_COMMAND,
        commandCenterLabel: "Go to Symbol in Workspace",
      }],
      provider: {
        provide: (filter, options) => this.provideQuickAccessItems(filter, options),
      },
    })
    this.quickAccessDisposable = disposable
    return {
      dispose: () => {
        disposable.dispose()
        if (this.quickAccessDisposable === disposable) this.quickAccessDisposable = null
      },
    }
  }

  registerCommandHandoff(context: SymbolNavigationCommandContext): IDisposable {
    this.commandContext = context
    for (const disposable of this.commandDisposables) disposable.dispose()
    this.commandDisposables = [
      registerOrReplaceCommand({
        id: WORKSPACE_SYMBOL_COMMAND,
        title: "Go to Symbol in Workspace",
        category: "Navigation",
        source: "vscode",
        handler: async (query = "") => {
          await this.showWorkspaceSymbols(String(query || ""))
        },
      }),
      registerOrReplaceCommand({
        id: LEGACY_WORKSPACE_SYMBOL_COMMAND,
        title: "Go to Symbol in Workspace",
        category: "Navigation",
        source: "vscode",
        handler: async (query = "") => {
          await this.showWorkspaceSymbols(String(query || ""))
        },
      }),
      registerOrReplaceCommand({
        id: OPEN_SYMBOL_COMMAND,
        title: "Open Symbol",
        category: "Navigation",
        source: "vscode",
        handler: async (symbol: CodekSymbolInformation) => {
          await this.openSymbol(symbol)
        },
      }),
    ]
    return {
      dispose: () => {
        if (this.commandContext === context) this.commandContext = null
        for (const disposable of this.commandDisposables) disposable.dispose()
        this.commandDisposables = []
      },
    }
  }

  async getDocumentSymbols(path: string, token: CancellationToken = CancellationToken.None): Promise<CodekSymbolInformation[]> {
    return this.documentProviders.query(path, token)
  }

  async getWorkspaceSymbols(query: string, token: CancellationToken = CancellationToken.None): Promise<CodekSymbolInformation[]> {
    return this.workspaceProviders.query(query, token)
  }

  async getOutlineModel(path: string, token: CancellationToken = CancellationToken.None): Promise<CodekOutlineModel> {
    const symbols = await this.getDocumentSymbols(path, token)
    return createCodekOutlineModel(path, symbols, OPEN_SYMBOL_COMMAND)
  }

  projectOutlineTree(symbols: readonly CodekSymbolInformation[]): CodekOutlineElement[] {
    return projectDocumentOutlineTree(symbols)
  }

  projectQuickAccessItems(symbols: readonly CodekSymbolInformation[]): CodekQuickAccessSymbolItem[] {
    return projectWorkspaceSymbolQuickAccessItems(symbols, OPEN_SYMBOL_COMMAND)
  }

  createReferencesModel(locations: readonly CodekReferenceLocation[], title?: string): CodekReferencesModel {
    return createCodekReferencesModel(locations, title)
  }

  async provideQuickAccessItems(filter: string, options: QuickAccessProviderRunOptions = {}): Promise<QuickAccessItem[]> {
    const requestId = ++this.generation
    const cts = new CancellationTokenSource(options.token)
    const signalDisposable = bridgeAbortSignal(options.signal, () => cts.cancel())
    try {
      if (cts.token.isCancellationRequested || options.signal?.aborted) return []
      const symbols = await this.getWorkspaceSymbols(filter, cts.token)
      if (requestId !== this.generation || cts.token.isCancellationRequested || options.signal?.aborted) return []
      return this.projectQuickAccessItems(symbols).map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description,
        detail: item.detail,
        commandId: item.commandId,
        args: item.args,
        accept: async () => {
          await this.openSymbol(item.raw)
        },
      }))
    } finally {
      signalDisposable.dispose()
      cts.dispose()
    }
  }

  async openSymbol(symbol: CodekSymbolInformation, options: { preserveFocus?: boolean } = {}): Promise<boolean> {
    const normalized = normalizeSymbol(symbol, symbol?.path)
    this.setSelectedSymbol(normalized.name)
    return openLocation(
      {
        path: normalized.path,
        line: normalized.line,
        column: normalized.column,
        endLine: normalized.range?.endLineNumber,
        endColumn: normalized.range?.endColumn,
        preserveFocus: options.preserveFocus,
      },
      this.requireNavigationContext(),
    )
  }

  async showWorkspaceSymbols(query: string): Promise<boolean> {
    const context = this.commandContext
    if (!context) return false
    context.openSidebarView?.("symbols")
    const applyQuery = () => context.setSymbolQuery?.(query)
    const tick = context.nextTick?.(applyQuery)
    if (tick && typeof (tick as Promise<void>).then === "function") await tick
    else applyQuery()
    return true
  }

  hasCommandHandoff(): boolean {
    return !!this.commandContext
  }

  clearCommandHandoff(): void {
    for (const disposable of this.commandDisposables) disposable.dispose()
    this.commandDisposables = []
    this.commandContext = null
  }

  getSymbolReferences(symbolName: string): SymbolReferenceData {
    const references = this.store?.getSymbolReferences(symbolName)
    if (!references) return { total: 0, files: [] }
    return {
      total: Number(references.total || 0),
      files: Array.isArray(references.files)
        ? references.files.map((file) => ({ path: String(file.path || ""), count: Number(file.count || 0) }))
        : [],
    }
  }

  setSelectedSymbol(symbolName: string): void {
    const name = symbolName || ""
    this.store?.setSelectedSymbol(name)
    if (this.settingSelectedSymbol) return
    this.settingSelectedSymbol = true
    try {
      this.commandContext?.updateSelectedSymbol?.(name)
    } finally {
      this.settingSelectedSymbol = false
    }
  }

  clearProviders(): void {
    this.generation += 1
    this.documentProviders.clear()
    this.workspaceProviders.clear()
    this.store = null
    this.quickAccessDisposable?.dispose()
    this.quickAccessDisposable = null
    this.clearCommandHandoff()
  }

  private requireNavigationContext(): NavigationServiceContext {
    const context = this.commandContext
    if (!context) {
      return {
        getEditor: () => null,
        getActiveFile: () => null,
        openFile: async () => false,
      }
    }
    return {
      getEditor: context.getEditor,
      getActiveFile: context.getActiveFile,
      openFile: context.openFile,
    }
  }
}

export const globalSymbolNavigationWorkbenchService = new SymbolNavigationWorkbenchService()
registerSingleton(ISymbolNavigationWorkbenchService, globalSymbolNavigationWorkbenchService, InstantiationType.Delayed)

export function registerDocumentSymbolProvider(provider: CodekDocumentSymbolProvider): IDisposable {
  return globalSymbolNavigationWorkbenchService.registerDocumentSymbolProvider(provider)
}

export function registerWorkspaceSymbolProvider(provider: CodekWorkspaceSymbolProvider): IDisposable {
  return globalSymbolNavigationWorkbenchService.registerWorkspaceSymbolProvider(provider)
}

export function getDocumentSymbols(path: string, token?: CancellationToken): Promise<CodekSymbolInformation[]> {
  return globalSymbolNavigationWorkbenchService.getDocumentSymbols(path, token)
}

export function getWorkspaceSymbols(query: string, token?: CancellationToken): Promise<CodekSymbolInformation[]> {
  return globalSymbolNavigationWorkbenchService.getWorkspaceSymbols(query, token)
}

export function getOutlineModel(path: string, token?: CancellationToken): Promise<CodekOutlineModel> {
  return globalSymbolNavigationWorkbenchService.getOutlineModel(path, token)
}

export function projectOutlineTree(symbols: readonly CodekSymbolInformation[]): CodekOutlineElement[] {
  return globalSymbolNavigationWorkbenchService.projectOutlineTree(symbols)
}

export function projectQuickAccessItems(symbols: readonly CodekSymbolInformation[]): CodekQuickAccessSymbolItem[] {
  return globalSymbolNavigationWorkbenchService.projectQuickAccessItems(symbols)
}

export function createReferencesModel(locations: readonly CodekReferenceLocation[], title?: string): CodekReferencesModel {
  return globalSymbolNavigationWorkbenchService.createReferencesModel(locations, title)
}

export function registerSymbolNavigationQuickAccessProvider(): IDisposable {
  return globalSymbolNavigationWorkbenchService.registerQuickAccessProvider()
}

export function registerSymbolNavigationCommandHandoff(context: SymbolNavigationCommandContext): IDisposable {
  return globalSymbolNavigationWorkbenchService.registerCommandHandoff(context)
}

export function registerDefaultAnalysisSymbolProvider(store: SymbolNavigationStore): IDisposable {
  return globalSymbolNavigationWorkbenchService.registerDefaultAnalysisProvider(store)
}

export function getAnalysisBackedFileOutline(path: string): CodekSymbolInformation[] {
  return syncDocumentSymbolsFromStore(path)
}

export function getAnalysisBackedProjectSymbols(query: string): CodekSymbolInformation[] {
  return syncWorkspaceSymbolsFromStore(query)
}

export function getAnalysisBackedSymbolReferences(symbolName: string): SymbolReferenceData {
  return globalSymbolNavigationWorkbenchService.getSymbolReferences(symbolName)
}

export function setAnalysisBackedSelectedSymbol(symbolName: string): void {
  globalSymbolNavigationWorkbenchService.setSelectedSymbol(symbolName)
}

export function hasSymbolNavigationCommandHandoff(): boolean {
  return globalSymbolNavigationWorkbenchService.hasCommandHandoff()
}

export function clearSymbolNavigationCommandHandoff(): void {
  globalSymbolNavigationWorkbenchService.clearCommandHandoff()
}

function syncDocumentSymbolsFromStore(path: string): CodekSymbolInformation[] {
  const store = getInternalStore(globalSymbolNavigationWorkbenchService)
  return store ? sortAndDedupeSymbols(store.getFileOutline(path).map((symbol) => normalizeSymbol(symbol, path))) : []
}

function syncWorkspaceSymbolsFromStore(query: string): CodekSymbolInformation[] {
  const store = getInternalStore(globalSymbolNavigationWorkbenchService)
  return store ? sortAndDedupeSymbols(store.getWorkspaceSymbols(query).map((symbol) => normalizeSymbol(symbol, symbol.path))) : []
}

function getInternalStore(service: SymbolNavigationWorkbenchService): SymbolNavigationStore | null {
  return (service as unknown as { store: SymbolNavigationStore | null }).store
}

function registerOrReplaceCommand(command: CommandDescriptor): IDisposable {
  const existing = getCommand(command.id)
  if (!existing) return registerCommand(command)
  return registerCommand({
    ...existing,
    ...command,
    handler: command.handler,
  })
}

function bridgeAbortSignal(signal: AbortSignal | undefined, cancel: () => void): IDisposable {
  if (!signal) return { dispose() {} }
  if (signal.aborted) {
    cancel()
    return { dispose() {} }
  }
  const listener = () => cancel()
  signal.addEventListener("abort", listener, { once: true })
  return { dispose: () => signal.removeEventListener("abort", listener) }
}
