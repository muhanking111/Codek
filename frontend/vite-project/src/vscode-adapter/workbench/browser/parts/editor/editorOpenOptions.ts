// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\workbench\browser\parts\editor\editorGroupView.ts
// - D:\SourceMirror\vscode\src\vs\workbench\common\editor\editorInput.ts
//
// Codek does not yet host the full VS Code EditorGroupModel. This adapter keeps
// the first transferable part explicit: preview editors are promoted to
// permanent when they become pinned, dirty, or are opened as permanent.

export interface CodekEditorOpenInput {
  path: string
  dirty?: boolean
  pinned?: boolean
  preview?: boolean
  permanent?: boolean
}

export interface CodekEditorOpenModel {
  path: string
  dirty: boolean
  pinned: boolean
  preview: boolean
  permanent: boolean
}

export function normalizeEditorOpenOptions(input: CodekEditorOpenInput): CodekEditorOpenModel {
  const dirty = input.dirty === true
  const pinned = input.pinned === true
  const permanent = input.permanent === true || pinned || dirty
  return {
    path: input.path,
    dirty,
    pinned,
    preview: input.preview !== false && !permanent,
    permanent,
  }
}

export function promoteEditorOpenModel(input: CodekEditorOpenModel): CodekEditorOpenModel {
  return normalizeEditorOpenOptions(input)
}
