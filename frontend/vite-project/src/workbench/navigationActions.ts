import { openLocation } from "./navigationService"
import {
  globalWorkbenchExplorerEditorService,
  type IWorkbenchExplorerEditorService,
} from "./workbenchExplorerEditorService"
import type { BreadcrumbPathInput, BreadcrumbSymbolInput } from "./breadcrumbDisplay"
import { registerSymbolNavigationCommandHandoff } from "./symbolNavigationService"

interface EditorLike {
  focus?: () => void
  setPosition?: (position: { lineNumber: number; column: number }) => void
  revealPositionInCenter?: (position: { lineNumber: number; column: number }) => void
  revealLineInCenter?: (lineNumber: number) => void
  getModel?: () => unknown
  getPosition?: () => unknown
}

interface WorkspaceLike {
  activeFile?: string | null
  projectRoot?: string
}

interface BreadcrumbState {
  path: unknown[]
  symbols: unknown[]
  activeDropdown: number | null
}

export interface NavigationActionContext {
  getEditor: () => EditorLike | null | undefined
  getMonacoApi: () => unknown
  getWorkspace: () => WorkspaceLike
  openFile: (path: string) => Promise<unknown>
  updateSelectedSymbol: (name: string) => void
  openSidebarView: (view: string) => void
  setSymbolQuery: (query: string) => void
  nextTick: (callback?: () => void) => Promise<void> | void
  getBreadcrumbPath: (editor: unknown, monacoApi: unknown) => unknown[]
  getSymbolBreadcrumb: (model: unknown, position: unknown, activeFile: string) => unknown[]
  getBreadcrumbState: () => BreadcrumbState
  setBreadcrumbPath: (path: unknown[]) => void
  setBreadcrumbSymbols: (symbols: unknown[]) => void
  setActiveBreadcrumbDropdown: (idx: number | null) => void
  clearBreadcrumbState?: () => void
  workbenchExplorerEditorService?: IWorkbenchExplorerEditorService
}

export async function revealLocation(
  path: string | null | undefined,
  line = 1,
  column = 1,
  context: NavigationActionContext,
): Promise<void> {
  await openLocation(
    { path, line, column },
    {
      getEditor: context.getEditor,
      getActiveFile: () => context.getWorkspace().activeFile,
      openFile: context.openFile,
    },
  )
}

export async function selectSymbol(symbol: Record<string, unknown> | null | undefined, context: NavigationActionContext): Promise<void> {
  if (!symbol) return
  context.updateSelectedSymbol(String(symbol.name || ""))
  await revealLocation(
    asString(symbol.path) || context.getWorkspace().activeFile,
    asNumber(symbol.line, 1),
    asNumber(symbol.column, 1),
    context,
  )
}

export async function openDiagnostic(diagnostic: Record<string, unknown> | null | undefined, context: NavigationActionContext): Promise<void> {
  if (!diagnostic) return
  await revealLocation(
    asString(diagnostic.path) || context.getWorkspace().activeFile,
    asNumber(diagnostic.line, 1),
    asNumber(diagnostic.column, 1),
    context,
  )
}

export function gotoLine(line: unknown, context: NavigationActionContext): void {
  const targetLine = asNumber(line, 0)
  if (!targetLine) return
  void openLocation(
    { line: targetLine, column: 1, reveal: "line" },
    {
      getEditor: context.getEditor,
      getActiveFile: () => context.getWorkspace().activeFile,
      openFile: context.openFile,
    },
  )
}

export async function openVisualEditorSource(payload: Record<string, unknown> | null | undefined, context: NavigationActionContext): Promise<void> {
  const rawFile = asString(payload?.file)
  if (!rawFile) return

  const workspace = context.getWorkspace()
  let filePath = rawFile
  if (filePath.startsWith("file://")) filePath = filePath.replace(/^file:\/\//, "")
  if (workspace.projectRoot && !filePath.startsWith(workspace.projectRoot) && !filePath.match(/^[a-zA-Z]:/)) {
    const root = workspace.projectRoot.replace(/\\/g, "/").replace(/\/$/, "")
    filePath = `${root}/${filePath.replace(/^\.?\//, "")}`
  }

  await context.openFile(filePath)
  gotoLine(asNumber(payload?.line, 1), context)
}

export function openPaletteSymbolSearch(query: string, context: NavigationActionContext): void {
  ensureSymbolNavigationHandoff(context)
  if (!context.getEditor()) return
  context.openSidebarView("symbols")
  void context.nextTick(() => {
    context.setSymbolQuery(query)
  })
}

function ensureSymbolNavigationHandoff(context: NavigationActionContext): void {
  registerSymbolNavigationCommandHandoff({
    getEditor: context.getEditor,
    getActiveFile: () => context.getWorkspace().activeFile,
    openFile: context.openFile,
    updateSelectedSymbol: context.updateSelectedSymbol,
    openSidebarView: context.openSidebarView,
    setSymbolQuery: context.setSymbolQuery,
    nextTick: context.nextTick,
  })
}

export function clickBreadcrumb(targetLine: unknown, context: NavigationActionContext): void {
  getWorkbenchExplorerEditorService(context).setActiveBreadcrumbDropdown(null)
  context.setActiveBreadcrumbDropdown(null)
  gotoLine(targetLine, context)
}

export function toggleBreadcrumbDropdown(idx: number, context: NavigationActionContext): void {
  const current = context.getBreadcrumbState().activeDropdown
  const next = current === idx ? null : idx
  getWorkbenchExplorerEditorService(context).setActiveBreadcrumbDropdown(next)
  context.setActiveBreadcrumbDropdown(next)
}

export function selectBreadcrumbDropdown(targetLine: unknown, context: NavigationActionContext): void {
  getWorkbenchExplorerEditorService(context).setActiveBreadcrumbDropdown(null)
  context.setActiveBreadcrumbDropdown(null)
  clickBreadcrumb(targetLine, context)
}

export function updateBreadcrumbState(context: NavigationActionContext): void {
  const editor = context.getEditor()
  const workspace = context.getWorkspace()
  if (!editor || !workspace.activeFile) {
    clearBreadcrumbState(context)
    return
  }

  const path = toBreadcrumbPathInput(context.getBreadcrumbPath(editor, context.getMonacoApi()))
  const symbols = updateBreadcrumbSymbols(context)
  getWorkbenchExplorerEditorService(context).updateBreadcrumbs({
    path,
    symbols,
    activeDropdown: context.getBreadcrumbState().activeDropdown,
  })
  context.setBreadcrumbPath(path)
  context.setBreadcrumbSymbols(symbols)
}

function updateBreadcrumbSymbols(context: NavigationActionContext): BreadcrumbSymbolInput[] {
  const editor = context.getEditor()
  const activeFile = context.getWorkspace().activeFile
  if (!editor || !activeFile) {
    clearBreadcrumbState(context)
    return []
  }

  const result = context.getSymbolBreadcrumb(editor.getModel?.(), editor.getPosition?.(), activeFile)
  return toBreadcrumbSymbolInput(result.slice(-4))
}

function clearBreadcrumbState(context: NavigationActionContext): void {
  getWorkbenchExplorerEditorService(context).clearBreadcrumbs()
  if (context.clearBreadcrumbState) {
    context.clearBreadcrumbState()
    return
  }

  context.setBreadcrumbPath([])
  context.setBreadcrumbSymbols([])
  context.setActiveBreadcrumbDropdown(null)
}

function getWorkbenchExplorerEditorService(context: NavigationActionContext): IWorkbenchExplorerEditorService {
  return context.workbenchExplorerEditorService || globalWorkbenchExplorerEditorService
}

function toBreadcrumbPathInput(values: unknown[]): BreadcrumbPathInput[] {
  return Array.isArray(values) ? values.filter(isRecord).map((value) => ({ ...value })) : []
}

function toBreadcrumbSymbolInput(values: unknown[]): BreadcrumbSymbolInput[] {
  return Array.isArray(values) ? values.filter(isRecord).map(cloneSymbol) : []
}

function cloneSymbol(symbol: Record<string, unknown>): BreadcrumbSymbolInput {
  return {
    ...symbol,
    range: isRecord(symbol.range) ? { ...symbol.range } : undefined,
    children: Array.isArray(symbol.children)
      ? symbol.children.filter(isRecord).map(cloneSymbol)
      : undefined,
  } as BreadcrumbSymbolInput
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function asNumber(value: unknown, fallback: number): number {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(1, numberValue)
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}
