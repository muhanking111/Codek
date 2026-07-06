import type { ContextMenuContext, ContextMenuItem } from "../components/EditorContextMenu"
import { resolveEditorFeatureActionId } from "../editor/editorLanguageFeatureService"

export interface EditorContextMenuLifecycleContext {
  t: (key: string, params?: Record<string, unknown>) => string
  openCommandPalette: () => void
}

export interface EditorContextMenuFeatures {
  createEditorContextMenu?: (
    editor: unknown,
    buildItems: (context: ContextMenuContext) => ContextMenuItem[],
  ) => { dispose?: () => void } | null | undefined
}

export interface EditorContextMenuOwnerEvidence {
  contextMenuOwner: {
    owner: "editorContextMenuLifecycle.createEditorContextMenu feature hook"
    state: "partial" | "blocked"
    connected: false
    readonlyEvidence: true
    featureHookAvailable: boolean
    missingOwner: "CodeEditorWidget/MenuId.EditorContext DOM context menu owner"
  }
  commandRoutingOwner: {
    owner: "ContextMenuItem.action"
    stateSource: "buildEditorContextMenuItems"
    connected: true
    readonlyEvidence: true
    actionIds: string[]
    executesRealCommandsDuringEvidenceRead: false
  }
  activeContextSource: "ContextMenuContext argument"
  remainingMenuUiOwnerGap: {
    owner: "CodeEditorWidget/MenuId.EditorContext DOM context menu owner"
    state: "partial"
    connected: false
    blockedBy: "完整 editor DOM context menu owner 需要 generic editor shell 或 CodeEditorWidget 接线"
    nextOwnerFiles: readonly ["generic editor shell", "CodeEditorWidget integration"]
  }
}

export function buildEditorContextMenuItems(
  context: ContextMenuContext,
  lifecycle: EditorContextMenuLifecycleContext,
): ContextMenuItem[] {
  const { t, openCommandPalette } = lifecycle

  return [
    { id: "undo", label: t("app.ctxUndo"), shortcut: "Ctrl+Z", action: (ed) => ed.trigger("contextMenu", "undo", null), enabled: context.canUndo },
    { id: "redo", label: t("app.ctxRedo"), shortcut: "Ctrl+Y", action: (ed) => ed.trigger("contextMenu", "redo", null), enabled: context.canRedo },
    { id: "sep-1", label: "", separator: true },
    { id: "cut", label: t("app.ctxCut"), shortcut: "Ctrl+X", action: (ed) => ed.trigger("contextMenu", "editor.action.clipboardCutAction", null), enabled: context.hasSelection },
    { id: "copy", label: t("app.ctxCopy"), shortcut: "Ctrl+C", action: (ed) => ed.trigger("contextMenu", "editor.action.clipboardCopyAction", null), enabled: context.hasSelection },
    { id: "paste", label: t("app.ctxPaste"), shortcut: "Ctrl+V", action: (ed) => ed.trigger("contextMenu", "editor.action.clipboardPasteAction", null) },
    { id: "selectAll", label: t("app.ctxSelectAll"), shortcut: "Ctrl+A", action: (ed) => ed.trigger("contextMenu", "editor.action.selectAll", null) },
    { id: "sep-2", label: "", separator: true },
    { id: "format", label: t("app.ctxFormat"), shortcut: "Shift+Alt+F", action: (ed) => ed.trigger("contextMenu", "editor.action.formatDocument", null) },
    { id: "sep-3", label: "", separator: true },
    { id: "goToDefinition", label: t("app.ctxGoToDefinition"), shortcut: "F12", action: (ed) => ed.trigger("contextMenu", "editor.action.revealDefinition", null) },
    { id: "findReferences", label: t("app.ctxFindReferences"), shortcut: "Shift+F12", action: (ed) => ed.trigger("contextMenu", resolveEditorFeatureActionId("findReferences"), null) },
    { id: "rename", label: t("app.ctxRename"), shortcut: "F2", action: (ed) => ed.trigger("contextMenu", resolveEditorFeatureActionId("renameSymbol"), null) },
    { id: "sep-4", label: "", separator: true },
    { id: "commentLine", label: t("app.ctxCommentLine"), shortcut: "Ctrl+/", action: (ed) => ed.trigger("contextMenu", "editor.action.commentLine", null) },
    { id: "sep-5", label: "", separator: true },
    { id: "commandPalette", label: t("app.ctxCommandPalette"), shortcut: "Ctrl+Shift+P", action: openCommandPalette },
  ]
}

export function installEditorContextMenu(
  editor: unknown,
  features: EditorContextMenuFeatures,
  context: EditorContextMenuLifecycleContext,
): { dispose?: () => void } | null {
  const disposable = features.createEditorContextMenu?.(editor, (menuContext) => buildEditorContextMenuItems(menuContext, context))
  return disposable || null
}

export function getEditorContextMenuOwnerEvidence(
  features: EditorContextMenuFeatures = {},
  context: ContextMenuContext = { canUndo: false, canRedo: false, hasSelection: false },
  lifecycle: EditorContextMenuLifecycleContext = { t: (key) => key, openCommandPalette: () => {} },
): EditorContextMenuOwnerEvidence {
  const items = buildEditorContextMenuItems(context, lifecycle)
  const featureHookAvailable = typeof features.createEditorContextMenu === "function"

  return {
    contextMenuOwner: {
      owner: "editorContextMenuLifecycle.createEditorContextMenu feature hook",
      state: featureHookAvailable ? "partial" : "blocked",
      connected: false,
      readonlyEvidence: true,
      featureHookAvailable,
      missingOwner: "CodeEditorWidget/MenuId.EditorContext DOM context menu owner",
    },
    commandRoutingOwner: {
      owner: "ContextMenuItem.action",
      stateSource: "buildEditorContextMenuItems",
      connected: true,
      readonlyEvidence: true,
      actionIds: items.filter((item) => !item.separator).map((item) => item.id),
      executesRealCommandsDuringEvidenceRead: false,
    },
    activeContextSource: "ContextMenuContext argument",
    remainingMenuUiOwnerGap: {
      owner: "CodeEditorWidget/MenuId.EditorContext DOM context menu owner",
      state: "partial",
      connected: false,
      blockedBy: "完整 editor DOM context menu owner 需要 generic editor shell 或 CodeEditorWidget 接线",
      nextOwnerFiles: ["generic editor shell", "CodeEditorWidget integration"],
    },
  }
}
