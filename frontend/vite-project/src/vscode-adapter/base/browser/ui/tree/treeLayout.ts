/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\base\browser\ui\tree\abstractTree.ts
// - D:\SourceMirror\vscode\src\vs\base\browser\ui\list\listWidget.ts
//
// Codek keeps its Vue/Electron renderer, but tree rows should derive aria,
// indent and twistie/icon traits from one VS Code-style model instead of
// scattering depth/padding/icon-slot decisions across FileTree and Explorer.

export const VSCODE_TREE_DEFAULT_INDENT = 8
export const VSCODE_TREE_TWISTIE_WIDTH = 16
export const VSCODE_EXPLORER_ITEM_HEIGHT = 22
export const VSCODE_EXPLORER_ALIGN_OFFSET_MARGIN_LEFT = Math.max(
  VSCODE_EXPLORER_ITEM_HEIGHT - VSCODE_TREE_DEFAULT_INDENT,
  0,
)
export const VSCODE_EXPLORER_FILE_ICON_WIDTH = 16
export const VSCODE_EXPLORER_FILE_ICON_GAP = 3
export const VSCODE_EXPLORER_FOLDER_ICON_WIDTH = 0
export const VSCODE_EXPLORER_FOLDER_ICON_GAP = 0

export interface TreeLayoutInput {
  depth: number
  isDirectory: boolean
  expanded?: boolean
  ignored?: boolean
  selected?: boolean
}

export interface TreeLayoutTraits {
  depth: number
  ariaLevel: number
  ariaSelected: string
  ariaExpanded: string | null
  treeDepthCssValue: string
  indentPx: number
  rowPaddingLeftPx: number
  guideOffsetPx: number
  alignOffsetMarginLeftPx: number
  twistieWidthPx: number
  iconWidthPx: number
  iconGapPx: number
  twistieText: string
  twistieState: "expanded" | "collapsed" | "none"
  showIcon: boolean
}

export function resolveTreeLayoutTraits(input: TreeLayoutInput): TreeLayoutTraits {
  const depth = Math.max(0, Math.trunc(Number(input.depth || 0)))
  const isExpandable = !!input.isDirectory && !input.ignored
  const expanded = isExpandable && !!input.expanded
  return {
    depth,
    ariaLevel: depth + 1,
    ariaSelected: String(!!input.selected),
    ariaExpanded: isExpandable ? String(expanded) : null,
    treeDepthCssValue: String(depth),
    indentPx: depth * VSCODE_TREE_DEFAULT_INDENT,
    rowPaddingLeftPx: depth * VSCODE_TREE_DEFAULT_INDENT,
    guideOffsetPx: VSCODE_TREE_DEFAULT_INDENT,
    alignOffsetMarginLeftPx: VSCODE_EXPLORER_ALIGN_OFFSET_MARGIN_LEFT,
    twistieWidthPx: VSCODE_TREE_TWISTIE_WIDTH,
    iconWidthPx: input.isDirectory ? VSCODE_EXPLORER_FOLDER_ICON_WIDTH : VSCODE_EXPLORER_FILE_ICON_WIDTH,
    iconGapPx: input.isDirectory ? VSCODE_EXPLORER_FOLDER_ICON_GAP : VSCODE_EXPLORER_FILE_ICON_GAP,
    twistieText: isExpandable ? ">" : "",
    twistieState: isExpandable ? (expanded ? "expanded" : "collapsed") : "none",
    showIcon: !input.isDirectory,
  }
}

export function applyTreeLayoutTraits(row: HTMLElement, traits: TreeLayoutTraits): void {
  row.dataset.depth = String(traits.depth)
  row.setAttribute("role", "treeitem")
  row.setAttribute("aria-level", String(traits.ariaLevel))
  row.setAttribute("aria-selected", traits.ariaSelected)
  if (traits.ariaExpanded === null) row.removeAttribute("aria-expanded")
  else row.setAttribute("aria-expanded", traits.ariaExpanded)
  row.style.setProperty("--codek-tree-depth", traits.treeDepthCssValue)
  row.style.setProperty("--codek-tree-indent-px", `${traits.indentPx}px`)
  row.style.setProperty("--codek-tree-row-padding-left-px", `${traits.rowPaddingLeftPx}px`)
  row.style.setProperty("--codek-tree-guide-offset-px", `${traits.guideOffsetPx}px`)
  row.style.setProperty("--codek-tree-align-offset-margin-left", `${traits.alignOffsetMarginLeftPx}px`)
  row.style.setProperty("--codek-tree-twistie-width-px", `${traits.twistieWidthPx}px`)
  row.style.setProperty("--codek-tree-icon-width-px", `${traits.iconWidthPx}px`)
  row.style.setProperty("--codek-tree-icon-gap-px", `${traits.iconGapPx}px`)
  row.style.paddingLeft = ""
}
