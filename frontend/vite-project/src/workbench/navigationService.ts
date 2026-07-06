export interface NavigationEditorLike {
  focus?: () => void
  setPosition?: (position: { lineNumber: number; column: number }) => void
  setSelection?: (selection: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }) => void
  revealLineInCenter?: (lineNumber: number) => void
  revealLineInCenterIfOutsideViewport?: (lineNumber: number) => void
  revealPosition?: (position: { lineNumber: number; column: number }) => void
  revealPositionInCenter?: (position: { lineNumber: number; column: number }) => void
  revealPositionInCenterIfOutsideViewport?: (position: { lineNumber: number; column: number }) => void
}

export interface NavigationTarget {
  path?: string | null
  line?: unknown
  column?: unknown
  endLine?: unknown
  endColumn?: unknown
  matchLength?: unknown
  reveal?: "center" | "line" | "none"
  preserveFocus?: boolean
}

export interface NavigationServiceContext {
  getEditor: () => NavigationEditorLike | null | undefined
  getActiveFile?: () => string | null | undefined
  openFile: (path: string) => Promise<unknown>
}

export async function openLocation(
  target: NavigationTarget,
  context: NavigationServiceContext,
): Promise<boolean> {
  const path = normalizePath(target.path)
  const activeFile = context.getActiveFile?.() || null
  if (path && path !== activeFile) {
    const opened = await context.openFile(path)
    if (!opened) return false
  }

  const editor = context.getEditor()
  if (!editor) return false

  const lineNumber = asPositiveNumber(target.line, 1)
  const column = asPositiveNumber(target.column, 1)
  const selection = buildSelection(target, lineNumber, column)
  if (selection && editor.setSelection) {
    editor.setSelection(selection)
  } else {
    editor.setPosition?.({ lineNumber, column })
  }

  if (target.reveal !== "none") {
    const position = { lineNumber, column }
    if (target.reveal === "line") {
      if (editor.revealPositionInCenterIfOutsideViewport) editor.revealPositionInCenterIfOutsideViewport(position)
      else if (editor.revealLineInCenterIfOutsideViewport) editor.revealLineInCenterIfOutsideViewport(lineNumber)
      else editor.revealLineInCenter?.(lineNumber)
    } else if (editor.revealPositionInCenterIfOutsideViewport) {
      editor.revealPositionInCenterIfOutsideViewport(position)
    } else if (editor.revealPositionInCenter) {
      editor.revealPositionInCenter(position)
    } else {
      editor.revealPosition?.(position)
    }
  }
  if (!target.preserveFocus) editor.focus?.()
  return true
}

function buildSelection(
  target: NavigationTarget,
  lineNumber: number,
  column: number,
): { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | null {
  const endLine = target.endLine === undefined ? lineNumber : asPositiveNumber(target.endLine, lineNumber)
  let endColumn = target.endColumn === undefined ? 0 : asPositiveNumber(target.endColumn, column)
  if (!endColumn) {
    const matchLength = Math.max(0, Number(target.matchLength) || 0)
    if (matchLength > 0) endColumn = column + matchLength
  }
  if (!endColumn || (endLine === lineNumber && endColumn <= column)) return null
  return {
    startLineNumber: lineNumber,
    startColumn: column,
    endLineNumber: endLine,
    endColumn,
  }
}

function asPositiveNumber(value: unknown, fallback: number): number {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(1, numberValue)
}

function normalizePath(path: unknown): string {
  return typeof path === "string" ? path : ""
}
