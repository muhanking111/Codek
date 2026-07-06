import { describe, expect, it, vi } from "vitest"
import { buildEditorContextMenuItems, getEditorContextMenuOwnerEvidence, installEditorContextMenu } from "./editorContextMenuLifecycle"

const t = (key: string) => key

describe("editorContextMenuLifecycle", () => {
  it("builds the VS Code style editor context menu in a stable order", () => {
    const openCommandPalette = vi.fn()

    const items = buildEditorContextMenuItems(
      { canUndo: true, canRedo: false, hasSelection: true },
      { t, openCommandPalette },
    )

    expect(items.map((item) => item.id)).toEqual([
      "undo",
      "redo",
      "sep-1",
      "cut",
      "copy",
      "paste",
      "selectAll",
      "sep-2",
      "format",
      "sep-3",
      "goToDefinition",
      "findReferences",
      "rename",
      "sep-4",
      "commentLine",
      "sep-5",
      "commandPalette",
    ])
    expect(items.find((item) => item.id === "undo")?.enabled).toBe(true)
    expect(items.find((item) => item.id === "redo")?.enabled).toBe(false)
    expect(items.find((item) => item.id === "cut")?.enabled).toBe(true)

    items.find((item) => item.id === "commandPalette")?.action?.({} as never)
    expect(openCommandPalette).toHaveBeenCalledTimes(1)
  })

  it("installs the context menu through editor features", () => {
    const disposable = { dispose: vi.fn() }
    const editor = { id: "editor" }
    const createEditorContextMenu = vi.fn((editorInstance: unknown, buildItems: Function) => {
      void editorInstance
      void buildItems
      return disposable
    })

    const result = installEditorContextMenu(editor, { createEditorContextMenu }, { t, openCommandPalette: vi.fn() })

    expect(result).toBe(disposable)
    expect(createEditorContextMenu).toHaveBeenCalledTimes(1)
    expect(createEditorContextMenu.mock.calls[0][0]).toBe(editor)

    const buildItems = createEditorContextMenu.mock.calls[0]?.[1]
    expect(buildItems).toBeTypeOf("function")
    expect(buildItems({ canUndo: false, canRedo: true, hasSelection: false }).map((item) => item.id)).toContain(
      "commandPalette",
    )
  })

  it("exposes readonly editor context menu owner evidence without marking the partial DOM owner connected", () => {
    const openCommandPalette = vi.fn()
    const featureHook = vi.fn()
    const evidence = getEditorContextMenuOwnerEvidence(
      { createEditorContextMenu: featureHook },
      { canUndo: true, canRedo: true, hasSelection: true },
      { t, openCommandPalette },
    )

    expect(featureHook).not.toHaveBeenCalled()
    expect(openCommandPalette).not.toHaveBeenCalled()
    expect(evidence.contextMenuOwner).toEqual({
      owner: "editorContextMenuLifecycle.createEditorContextMenu feature hook",
      state: "partial",
      connected: false,
      readonlyEvidence: true,
      featureHookAvailable: true,
      missingOwner: "CodeEditorWidget/MenuId.EditorContext DOM context menu owner",
    })
    expect(evidence.commandRoutingOwner).toMatchObject({
      owner: "ContextMenuItem.action",
      stateSource: "buildEditorContextMenuItems",
      connected: true,
      readonlyEvidence: true,
      executesRealCommandsDuringEvidenceRead: false,
    })
    expect(evidence.commandRoutingOwner.actionIds).toEqual([
      "undo",
      "redo",
      "cut",
      "copy",
      "paste",
      "selectAll",
      "format",
      "goToDefinition",
      "findReferences",
      "rename",
      "commentLine",
      "commandPalette",
    ])
    expect(evidence.remainingMenuUiOwnerGap).toEqual({
      owner: "CodeEditorWidget/MenuId.EditorContext DOM context menu owner",
      state: "partial",
      connected: false,
      blockedBy: "完整 editor DOM context menu owner 需要 generic editor shell 或 CodeEditorWidget 接线",
      nextOwnerFiles: ["generic editor shell", "CodeEditorWidget integration"],
    })
  })
})
