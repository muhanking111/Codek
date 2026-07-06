/*---------------------------------------------------------------------------------------------
 * VS Code-style workspace symbol provider fanout adapted for Codek.
 * Source references:
 * - D:\SourceMirror\vscode\src\vs\workbench\contrib\search\browser\symbolsQuickAccess.ts
 * - D:\SourceMirror\vscode\src\vs\editor\common\languageFeatureRegistry.ts
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from "../../vscode-adapter/base/common/cancellation"
import type { IDisposable } from "../../vscode-adapter/base/common/lifecycle"

export type CodekSymbolKind =
  | "class"
  | "interface"
  | "method"
  | "function"
  | "variable"
  | "type"
  | "enum"
  | "import"
  | string

export interface CodekRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export interface CodekSymbolInformation {
  name: string
  kind: CodekSymbolKind
  path: string
  line: number
  column: number
  detail?: string
  containerName?: string
  range?: CodekRange
}

export interface CodekWorkspaceSymbolProvider {
  provideWorkspaceSymbols(query: string, token: CancellationToken): CodekSymbolInformation[] | Promise<CodekSymbolInformation[]>
  resolveWorkspaceSymbol?(symbol: CodekSymbolInformation, token: CancellationToken): CodekSymbolInformation | Promise<CodekSymbolInformation>
}

export interface CodekQuickAccessSymbolItem {
  id: string
  label: string
  description?: string
  detail?: string
  icon: string
  commandId: string
  args: [CodekSymbolInformation]
  raw: CodekSymbolInformation
}

export const SYMBOL_KIND_ICONS: Record<string, string> = {
  class: "C",
  interface: "I",
  method: "M",
  function: "F",
  variable: "V",
  type: "T",
  enum: "E",
  import: "->",
}

export class CodekWorkspaceSymbolRegistry {
  private providers: CodekWorkspaceSymbolProvider[] = []

  register(provider: CodekWorkspaceSymbolProvider): IDisposable {
    this.providers.unshift(provider)
    return {
      dispose: () => {
        const index = this.providers.indexOf(provider)
        if (index !== -1) this.providers.splice(index, 1)
      },
    }
  }

  ordered(): CodekWorkspaceSymbolProvider[] {
    return [...this.providers]
  }

  clear(): void {
    this.providers = []
  }

  async query(query: string, token: CancellationToken = CancellationToken.None): Promise<CodekSymbolInformation[]> {
    const normalizedQuery = String(query || "")
    if (token.isCancellationRequested) return []
    const symbols: CodekSymbolInformation[] = []
    await Promise.all(this.ordered().map(async (provider) => {
      try {
        const provided = await Promise.resolve(provider.provideWorkspaceSymbols(normalizedQuery, token))
        if (!provided || token.isCancellationRequested) return
        for (const symbol of provided) {
          const normalized = normalizeSymbol(symbol, symbol.path)
          const resolved = provider.resolveWorkspaceSymbol
            ? await Promise.resolve(provider.resolveWorkspaceSymbol(normalized, token))
            : normalized
          if (!resolved || token.isCancellationRequested) continue
          symbols.push(normalizeSymbol(resolved, normalized.path))
        }
      } catch {
        // Keep one extension-style provider from breaking the picker.
      }
    }))
    if (token.isCancellationRequested) return []
    return sortAndDedupeSymbols(symbols)
  }
}

export function projectWorkspaceSymbolQuickAccessItems(
  symbols: readonly CodekSymbolInformation[],
  commandId: string,
): CodekQuickAccessSymbolItem[] {
  return sortAndDedupeSymbols(symbols).map((symbol) => {
    const normalized = normalizeSymbol(symbol, symbol.path)
    return {
      id: symbolKey(normalized),
      label: normalized.name,
      description: normalized.containerName || normalized.path,
      detail: `${normalized.kind} - ${normalized.path}:${normalized.line}:${normalized.column}`,
      icon: SYMBOL_KIND_ICONS[normalized.kind] || normalized.kind.charAt(0).toUpperCase(),
      commandId,
      args: [normalized],
      raw: normalized,
    }
  })
}

export function normalizeSymbol(
  symbol: Partial<CodekSymbolInformation> | null | undefined,
  fallbackPath = "",
): CodekSymbolInformation {
  const line = asPositiveNumber(symbol?.line, 1)
  const column = asPositiveNumber(symbol?.column, 1)
  const range = normalizeRange(symbol?.range, line, column)
  return {
    name: String(symbol?.name || ""),
    kind: String(symbol?.kind || "variable"),
    path: String(symbol?.path || fallbackPath || ""),
    line,
    column,
    detail: typeof symbol?.detail === "string" ? symbol.detail : "",
    containerName: typeof symbol?.containerName === "string" ? symbol.containerName : "",
    range,
  }
}

export function normalizeRange(range: CodekRange | undefined, line: number, column: number): CodekRange {
  const startLineNumber = asPositiveNumber(range?.startLineNumber, line)
  const startColumn = asPositiveNumber(range?.startColumn, column)
  const endLineNumber = asPositiveNumber(range?.endLineNumber, startLineNumber)
  const endColumn = asPositiveNumber(range?.endColumn, startColumn)
  return {
    startLineNumber,
    startColumn,
    endLineNumber: Math.max(startLineNumber, endLineNumber),
    endColumn: endLineNumber === startLineNumber ? Math.max(startColumn, endColumn) : endColumn,
  }
}

export function compareSymbolsByPosition(left: CodekSymbolInformation, right: CodekSymbolInformation): number {
  return left.path.localeCompare(right.path)
    || left.line - right.line
    || left.column - right.column
    || left.name.localeCompare(right.name)
}

export function sortAndDedupeSymbols(symbols: readonly CodekSymbolInformation[]): CodekSymbolInformation[] {
  const result = new Map<string, CodekSymbolInformation>()
  for (const symbol of [...symbols].sort(compareSymbolsByPosition)) {
    const normalized = normalizeSymbol(symbol, symbol.path)
    if (normalized.name && normalized.path) result.set(symbolKey(normalized), normalized)
  }
  return [...result.values()]
}

export function symbolKey(symbol: CodekSymbolInformation): string {
  return `${symbol.path}:${symbol.line}:${symbol.column}:${symbol.kind}:${symbol.name}`
}

function asPositiveNumber(value: unknown, fallback: number): number {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(1, numberValue)
}
