/*---------------------------------------------------------------------------------------------
 * VS Code-style document outline model adapted for Codek's analysis-backed symbols.
 * Source references:
 * - D:\SourceMirror\vscode\src\vs\editor\contrib\documentSymbols\browser\outlineModel.ts
 * - D:\SourceMirror\vscode\src\vs\workbench\services\outline\browser\outline.ts
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from "../../vscode-adapter/base/common/cancellation"
import type { IDisposable } from "../../vscode-adapter/base/common/lifecycle"
import {
  compareSymbolsByPosition,
  normalizeSymbol,
  normalizeRange,
  projectWorkspaceSymbolQuickAccessItems,
  SYMBOL_KIND_ICONS,
  symbolKey,
  type CodekQuickAccessSymbolItem,
  type CodekRange,
  type CodekSymbolInformation,
  type CodekSymbolKind,
} from "../workspaceSymbols/workspaceSymbolRegistry"

export interface CodekDocumentSymbolProvider {
  provideDocumentSymbols(path: string, token: CancellationToken): CodekSymbolInformation[] | Promise<CodekSymbolInformation[]>
}

export interface CodekOutlineElement {
  id: string
  label: string
  kind: CodekSymbolKind
  icon: string
  path: string
  line: number
  column: number
  detail: string
  range: CodekRange
  children: CodekOutlineElement[]
  raw: CodekSymbolInformation
}

export interface CodekOutlineModel {
  uri: string
  outlineKind: "codek.analysis"
  isEmpty: boolean
  elements: CodekOutlineElement[]
  quickPickElements: CodekQuickAccessSymbolItem[]
}

export interface CodekBreadcrumbSymbol {
  name: string
  kind: string
  icon: string
  range: { startLine: number; startCol: number; endLine: number; endCol: number }
  children: CodekBreadcrumbSymbol[]
}

export class CodekDocumentSymbolRegistry {
  private providers: CodekDocumentSymbolProvider[] = []

  register(provider: CodekDocumentSymbolProvider): IDisposable {
    this.providers.unshift(provider)
    return {
      dispose: () => {
        const index = this.providers.indexOf(provider)
        if (index !== -1) this.providers.splice(index, 1)
      },
    }
  }

  ordered(): CodekDocumentSymbolProvider[] {
    return [...this.providers]
  }

  clear(): void {
    this.providers = []
  }

  async query(path: string, token: CancellationToken = CancellationToken.None): Promise<CodekSymbolInformation[]> {
    if (!path || token.isCancellationRequested) return []
    const symbols: CodekSymbolInformation[] = []
    await Promise.all(this.ordered().map(async (provider) => {
      try {
        const provided = await Promise.resolve(provider.provideDocumentSymbols(path, token))
        if (!provided || token.isCancellationRequested) return
        symbols.push(...provided.map((symbol) => normalizeSymbol(symbol, path)))
      } catch {
        // Provider failures stay isolated, matching VS Code outline fanout.
      }
    }))
    if (token.isCancellationRequested) return []
    return sortDocumentSymbols(symbols)
  }
}

export function createCodekOutlineModel(
  uri: string,
  symbols: readonly CodekSymbolInformation[],
  commandId: string,
): CodekOutlineModel {
  const elements = projectOutlineTree(symbols)
  return {
    uri,
    outlineKind: "codek.analysis",
    isEmpty: elements.length === 0,
    elements,
    quickPickElements: projectWorkspaceSymbolQuickAccessItems(flattenOutline(elements).map((element) => element.raw), commandId),
  }
}

export function projectOutlineTree(symbols: readonly CodekSymbolInformation[]): CodekOutlineElement[] {
  const root: CodekOutlineElement[] = []
  const stack: CodekOutlineElement[] = []
  const sorted = symbols
    .map((symbol) => normalizeSymbol(symbol, symbol.path))
    .filter((symbol) => symbol.kind !== "import")
    .sort(compareSymbolsByPosition)

  for (const symbol of sorted) {
    const node = toOutlineElement(symbol)
    while (stack.length && !containsRange(stack[stack.length - 1].range, node.range)) {
      stack.pop()
    }
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(node)
    else root.push(node)
    stack.push(node)
  }

  return root
}

export function getBreadcrumbPathForPosition(
  elements: readonly CodekOutlineElement[],
  line: number,
  column: number,
): CodekOutlineElement[] {
  for (const element of elements) {
    if (!containsPosition(element.range, line, column)) continue
    const childPath = getBreadcrumbPathForPosition(element.children, line, column)
    return [element, ...childPath]
  }
  return []
}

export function projectBreadcrumbSymbols(elements: readonly CodekOutlineElement[]): CodekBreadcrumbSymbol[] {
  return elements.map((element) => ({
    name: element.label,
    kind: element.kind,
    icon: element.icon,
    range: {
      startLine: element.range.startLineNumber,
      startCol: element.range.startColumn,
      endLine: element.range.endLineNumber,
      endCol: element.range.endColumn,
    },
    children: projectBreadcrumbSymbols(element.children),
  }))
}

export function flattenOutline(elements: readonly CodekOutlineElement[]): CodekOutlineElement[] {
  const result: CodekOutlineElement[] = []
  for (const element of elements) {
    result.push(element)
    result.push(...flattenOutline(element.children))
  }
  return result
}

function sortDocumentSymbols(symbols: readonly CodekSymbolInformation[]): CodekSymbolInformation[] {
  const result = new Map<string, CodekSymbolInformation>()
  for (const symbol of [...symbols].sort(compareSymbolsByPosition)) {
    const normalized = normalizeSymbol(symbol, symbol.path)
    if (normalized.name && normalized.path) result.set(symbolKey(normalized), normalized)
  }
  return [...result.values()]
}

function toOutlineElement(symbol: CodekSymbolInformation): CodekOutlineElement {
  const normalized = normalizeSymbol(symbol, symbol.path)
  return {
    id: symbolKey(normalized),
    label: normalized.name,
    kind: normalized.kind,
    icon: SYMBOL_KIND_ICONS[normalized.kind] || normalized.kind.charAt(0).toUpperCase(),
    path: normalized.path,
    line: normalized.line,
    column: normalized.column,
    detail: normalized.detail || normalized.containerName || "",
    range: normalized.range || normalizeRange(undefined, normalized.line, normalized.column),
    children: [],
    raw: normalized,
  }
}

function containsRange(parent: CodekRange, child: CodekRange): boolean {
  if (child.startLineNumber < parent.startLineNumber) return false
  if (child.endLineNumber < parent.startLineNumber) return false
  if (child.startLineNumber === parent.startLineNumber && child.startColumn < parent.startColumn) return false
  if (parent.endLineNumber === parent.startLineNumber && parent.endColumn === parent.startColumn) {
    return child.startLineNumber > parent.startLineNumber
  }
  if (child.endLineNumber > parent.endLineNumber) return false
  if (child.endLineNumber === parent.endLineNumber && child.endColumn > parent.endColumn) return false
  return true
}

function containsPosition(range: CodekRange, line: number, column: number): boolean {
  if (line < range.startLineNumber || line > range.endLineNumber) return false
  if (line === range.startLineNumber && column < range.startColumn) return false
  if (line === range.endLineNumber && column > range.endColumn) return false
  return true
}
