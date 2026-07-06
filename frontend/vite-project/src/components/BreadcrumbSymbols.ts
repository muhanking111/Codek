import type * as monaco from "monaco-editor"
import { getAnalysisBackedFileOutline, projectOutlineTree } from "../workbench/symbolNavigationService"
import { getBreadcrumbPathForPosition, projectBreadcrumbSymbols } from "../languages/outline/outlineModel"

export interface BreadcrumbSymbol {
  name: string
  kind: string
  icon: string
  range: { startLine: number; startCol: number; endLine: number; endCol: number }
  children: BreadcrumbSymbol[]
}

export function getSymbolBreadcrumb(
  model: monaco.editor.ITextModel | null,
  position: monaco.Position | null,
  filePath: string | null,
): BreadcrumbSymbol[] {
  if (!position || !filePath) return []

  const outline = getAnalysisBackedFileOutline(filePath)

  if (outline.length === 0) return []

  const tree = projectOutlineTree(outline)
  return projectBreadcrumbSymbols(getBreadcrumbPathForPosition(tree, position.lineNumber, position.column))
}

export function getSymbolChildren(
  symbols: BreadcrumbSymbol[],
  pathIndex: number,
): BreadcrumbSymbol[] {
  if (pathIndex < 0 || pathIndex >= symbols.length) return []
  return symbols[pathIndex].children
}
