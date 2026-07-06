import { describe, expect, it } from "vitest"
import {
  resolveTreeLayoutTraits,
  VSCODE_EXPLORER_ALIGN_OFFSET_MARGIN_LEFT,
  VSCODE_EXPLORER_FILE_ICON_GAP,
  VSCODE_EXPLORER_FILE_ICON_WIDTH,
  VSCODE_EXPLORER_FOLDER_ICON_GAP,
  VSCODE_EXPLORER_FOLDER_ICON_WIDTH,
  VSCODE_EXPLORER_ITEM_HEIGHT,
  VSCODE_TREE_DEFAULT_INDENT,
  VSCODE_TREE_TWISTIE_WIDTH,
} from "./treeLayout"

describe("VS Code tree layout adapter", () => {
  it("derives aria level and selected state from normalized depth", () => {
    expect(resolveTreeLayoutTraits({ depth: 2, isDirectory: false, selected: true })).toMatchObject({
      depth: 2,
      ariaLevel: 3,
      ariaSelected: "true",
      ariaExpanded: null,
      indentPx: 16,
      rowPaddingLeftPx: 16,
      guideOffsetPx: 8,
      twistieWidthPx: 16,
      iconWidthPx: 16,
      iconGapPx: 3,
      showIcon: true,
      twistieState: "none",
    })
  })

  it("keeps VS Code tree spacing constants as the native explorer layout contract", () => {
    expect(VSCODE_TREE_DEFAULT_INDENT).toBe(8)
    expect(VSCODE_TREE_TWISTIE_WIDTH).toBe(16)
    expect(VSCODE_EXPLORER_ITEM_HEIGHT).toBe(22)
    expect(VSCODE_EXPLORER_ALIGN_OFFSET_MARGIN_LEFT).toBe(14)
    expect(VSCODE_EXPLORER_FILE_ICON_WIDTH).toBe(16)
    expect(VSCODE_EXPLORER_FILE_ICON_GAP).toBe(3)
    expect(VSCODE_EXPLORER_FOLDER_ICON_WIDTH).toBe(0)
    expect(VSCODE_EXPLORER_FOLDER_ICON_GAP).toBe(0)
  })

  it("uses twisties for expandable directories without exposing a file icon slot", () => {
    expect(resolveTreeLayoutTraits({ depth: 1, isDirectory: true, expanded: false })).toMatchObject({
      ariaExpanded: "false",
      rowPaddingLeftPx: 8,
      iconWidthPx: 0,
      iconGapPx: 0,
      twistieText: ">",
      twistieState: "collapsed",
      showIcon: false,
    })
    expect(resolveTreeLayoutTraits({ depth: 1, isDirectory: true, expanded: true })).toMatchObject({
      ariaExpanded: "true",
      twistieText: ">",
      twistieState: "expanded",
      showIcon: false,
    })
  })

  it("treats ignored directories as non-expandable tree rows", () => {
    expect(resolveTreeLayoutTraits({ depth: 1, isDirectory: true, expanded: true, ignored: true })).toMatchObject({
      ariaExpanded: null,
      twistieText: "",
      twistieState: "none",
      showIcon: false,
    })
  })
})
