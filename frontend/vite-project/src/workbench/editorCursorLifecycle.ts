import { Position } from "../vscode-adapter/editor/common/core/position"
import { Selection } from "../vscode-adapter/editor/common/core/selection"

export interface EditorCursorPosition {
  lineNumber?: number
  column?: number
}

export interface EditorCursorSelection {
  isEmpty?: () => boolean
  selectionStartLineNumber?: number
  selectionStartColumn?: number
  positionLineNumber?: number
  positionColumn?: number
}

export interface EditorCursorLifecycleContext {
  editor: {
    getPosition?: () => EditorCursorPosition | null | undefined
    getSelection?: () => EditorCursorSelection | null | undefined
    onDidChangeCursorPosition?: (callback: () => void) => { dispose?: () => void }
    onDidChangeCursorSelection?: (callback: () => void) => { dispose?: () => void }
  }
  getActiveFile: () => string | null | undefined
  setCursorPosition: (line: number, column: number) => void
  setHasEditorSelection: (hasSelection: boolean) => void
  updateBreadcrumb: () => void
  pushNavigationHistory?: (entry: { file: string; line: number; column: number }) => void
}

export function installEditorCursorLifecycle(context: EditorCursorLifecycleContext): { dispose: () => void } {
  const cursorDisposable = context.editor.onDidChangeCursorPosition?.(() => {
    const position = normalizeEditorCursorPosition(context.editor.getPosition?.())
    const line = position.lineNumber
    const column = position.column
    context.setCursorPosition(line, column)
    context.updateBreadcrumb()
    context.pushNavigationHistory?.({
      file: context.getActiveFile() || "",
      line,
      column,
    })
  })

  const selectionDisposable = context.editor.onDidChangeCursorSelection?.(() => {
    const selection = normalizeEditorCursorSelection(context.editor.getSelection?.())
    context.setHasEditorSelection(Boolean(selection && !selection.isEmpty?.()))
  })

  return {
    dispose: () => {
      cursorDisposable?.dispose?.()
      selectionDisposable?.dispose?.()
    },
  }
}

export function normalizeEditorCursorPosition(position: EditorCursorPosition | null | undefined): Position {
  return new Position(
    Math.max(1, Number(position?.lineNumber) || 1),
    Math.max(1, Number(position?.column) || 1),
  )
}

export function normalizeEditorCursorSelection(selection: EditorCursorSelection | null | undefined): Selection | null {
  if (!selection) return null
  if (
    typeof selection.selectionStartLineNumber === "number" &&
    typeof selection.selectionStartColumn === "number" &&
    typeof selection.positionLineNumber === "number" &&
    typeof selection.positionColumn === "number"
  ) {
    return new Selection(
      selection.selectionStartLineNumber,
      selection.selectionStartColumn,
      selection.positionLineNumber,
      selection.positionColumn,
    )
  }
  return selection.isEmpty?.() ? new Selection(1, 1, 1, 1) : new Selection(1, 1, 1, 2)
}
