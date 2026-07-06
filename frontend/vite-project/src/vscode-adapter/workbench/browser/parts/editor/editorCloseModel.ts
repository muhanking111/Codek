// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\workbench\browser\parts\editor\editorGroupView.ts
// - D:\SourceMirror\vscode\src\vs\workbench\common\editor.ts
//
// Codek keeps a lightweight Vue editor group state. This adapter ports the
// group-close planning rules into one place: decide which editors close, keep
// sticky/pinned editors for bulk commands, preserve MRU closed history order,
// and choose the next active editor after removals.

export type EditorCloseKind = "single" | "others" | "right" | "saved"

export interface EditorCloseEntry {
  path: string
  pinned?: boolean
  dirty?: boolean
}

export interface EditorClosePlan<TEditor extends EditorCloseEntry> {
  editors: TEditor[]
  closing: TEditor[]
  activeEditor: string | null
}

export function planEditorClose<TEditor extends EditorCloseEntry>(options: {
  editors: readonly TEditor[]
  activeEditor: string | null
  kind: EditorCloseKind
  targetPath?: string
}): EditorClosePlan<TEditor> {
  const closing = selectEditorsToClose(options)
  if (!closing.length) {
    return { editors: [...options.editors], closing: [], activeEditor: options.activeEditor }
  }

  const closingPaths = new Set(closing.map((editor) => editor.path))
  const editors = options.editors.filter((editor) => !closingPaths.has(editor.path))
  return {
    editors,
    closing,
    activeEditor: resolveActiveEditorAfterClose({
      before: options.editors,
      after: editors,
      activeEditor: options.activeEditor,
      closedPaths: closingPaths,
      targetPath: options.targetPath,
    }),
  }
}

function selectEditorsToClose<TEditor extends EditorCloseEntry>(options: {
  editors: readonly TEditor[]
  kind: EditorCloseKind
  targetPath?: string
}): TEditor[] {
  switch (options.kind) {
    case "single":
      return options.editors.filter((editor) => editor.path === options.targetPath)
    case "others":
      return options.editors.filter((editor) => editor.path !== options.targetPath && !editor.pinned)
    case "right": {
      const targetIndex = options.editors.findIndex((editor) => editor.path === options.targetPath)
      if (targetIndex < 0) return []
      return options.editors.filter((editor, index) => index > targetIndex && !editor.pinned)
    }
    case "saved":
      return options.editors.filter((editor) => !editor.dirty && !editor.pinned)
  }
}

function resolveActiveEditorAfterClose<TEditor extends EditorCloseEntry>(options: {
  before: readonly TEditor[]
  after: readonly TEditor[]
  activeEditor: string | null
  closedPaths: Set<string>
  targetPath?: string
}): string | null {
  if (options.activeEditor && !options.closedPaths.has(options.activeEditor)) return options.activeEditor
  if (!options.after.length) return null

  const targetIndex = options.targetPath ? options.before.findIndex((editor) => editor.path === options.targetPath) : -1
  if (targetIndex >= 0) {
    const previous = findNearestOpenEditor(options.before, options.closedPaths, targetIndex, -1)
    if (previous) return previous.path
    const next = findNearestOpenEditor(options.before, options.closedPaths, targetIndex, 1)
    if (next) return next.path
  }

  return options.after[options.after.length - 1]?.path ?? null
}

function findNearestOpenEditor<TEditor extends EditorCloseEntry>(
  editors: readonly TEditor[],
  closedPaths: Set<string>,
  startIndex: number,
  direction: 1 | -1,
): TEditor | null {
  for (let index = startIndex + direction; index >= 0 && index < editors.length; index += direction) {
    if (!closedPaths.has(editors[index].path)) return editors[index]
  }
  return null
}
