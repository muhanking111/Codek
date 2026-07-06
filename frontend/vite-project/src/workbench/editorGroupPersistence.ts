import {
  createEditorGroupPersistenceSnapshot,
  DEFAULT_MAX_CLOSED_EDITORS,
  hydrateEditorGroupPersistenceSnapshot,
  clonePersistedEditor,
  normalizeSplitRatio,
  type CodekEditorGroupSnapshot,
} from "../vscode-adapter/workbench/browser/parts/editor/editorGroupPersistenceModel"
import {
  createEditorGroupState,
  openEditor,
  setSplitOpen,
  type EditorEntry,
  type EditorGroupState,
} from "./editorGroups"

export type EditorGroupPersistenceSnapshot = CodekEditorGroupSnapshot

export interface EditorGroupHydrationInput {
  availableFiles?: Iterable<string>
  maxClosedEditors?: number
}

export function serializeEditorGroupState(state: EditorGroupState): EditorGroupPersistenceSnapshot {
  return createEditorGroupPersistenceSnapshot({
    activeGroupId: state.activeGroupId,
    groups: state.groups.map((group) => ({
      id: group.id,
      activeEditor: group.activeEditor,
      editors: group.editors.map(cloneEditor),
    })),
    closedEditors: state.closedEditors.map(cloneEditor),
    split: {
      open: state.split.open,
      file: state.split.file,
      ratio: state.split.ratio,
    },
  })
}

export function hydrateEditorGroupState(
  rawSnapshot: unknown,
  input: EditorGroupHydrationInput = {},
): EditorGroupState {
  const snapshot = hydrateEditorGroupPersistenceSnapshot(rawSnapshot, input)
  if (!snapshot) return createEditorGroupState()

  const activeGroup = snapshot.groups.find((group) => group.id === snapshot.activeGroupId) || snapshot.groups[0]
  const state = createEditorGroupState({
    editors: activeGroup.editors.map(cloneEditor),
    activeEditor: activeGroup.activeEditor,
  })
  state.groups[0].id = activeGroup.id
  state.activeGroupId = activeGroup.id
  state.closedEditors = snapshot.closedEditors.map(cloneEditor)
  setSplitOpen(state, snapshot.split.open, snapshot.split.file, snapshot.split.ratio)
  return state
}

export function buildEditorGroupStateFromOpenFiles(input: {
  openFiles: string[]
  activeFile?: string | null
  pinnedTabs?: Iterable<string>
  dirtyFiles?: (path: string) => boolean
  closedEditors?: EditorEntry[]
  split?: { open: boolean; file: string | null; ratio: number }
}): EditorGroupState {
  const pinned = new Set(input.pinnedTabs ? Array.from(input.pinnedTabs, String) : [])
  const state = createEditorGroupState({
    editors: input.openFiles.map((path) => ({
      path,
      dirty: input.dirtyFiles?.(path) === true,
      pinned: pinned.has(path),
      permanent: pinned.has(path) || input.dirtyFiles?.(path) === true,
      preview: !pinned.has(path) && input.dirtyFiles?.(path) !== true,
    })),
    activeEditor: input.activeFile && input.openFiles.includes(input.activeFile) ? input.activeFile : input.openFiles[input.openFiles.length - 1] || null,
  })

  if (input.closedEditors?.length) {
    state.closedEditors = input.closedEditors.map(cloneEditor).slice(0, DEFAULT_MAX_CLOSED_EDITORS)
  }
  if (input.split) {
    setSplitOpen(state, input.split.open, input.split.file, input.split.ratio)
  }
  return state
}

export function applyEditorGroupStateToOpenFiles(
  state: EditorGroupState,
  target: {
    setOpenFiles: (paths: string[]) => void
    setActiveFile?: (path: string | null) => void
    pinnedTabs?: Set<string>
    closedEditors?: EditorEntry[]
  },
): void {
  const group = state.groups.find((candidate) => candidate.id === state.activeGroupId) || state.groups[0]
  target.setOpenFiles(group.editors.map((editor) => editor.path))
  target.setActiveFile?.(group.activeEditor)

  if (target.pinnedTabs) {
    target.pinnedTabs.clear()
    for (const editor of group.editors) {
      if (editor.pinned) target.pinnedTabs.add(editor.path)
    }
  }

  if (target.closedEditors) {
    target.closedEditors.splice(0, target.closedEditors.length, ...state.closedEditors.map(cloneEditor))
  }
}

export function reviveSerializedEditorGroupState(serialized: string | null | undefined, input?: EditorGroupHydrationInput): EditorGroupState {
  if (!serialized) return createEditorGroupState()
  try {
    return hydrateEditorGroupState(JSON.parse(serialized), input)
  } catch {
    return createEditorGroupState()
  }
}

export function addEditorToPersistedState(state: EditorGroupState, path: string, options: Parameters<typeof openEditor>[2] = {}): EditorGroupState {
  openEditor(state, path, options)
  return state
}

function cloneEditor(editor: EditorEntry): EditorEntry {
  const clone = clonePersistedEditor(editor)
  return {
    path: clone.path,
    dirty: clone.dirty === true,
    pinned: clone.pinned === true,
    preview: clone.preview === true,
    permanent: clone.permanent === true,
  }
}

export function normalizeEditorSplitRatio(value: unknown): number {
  return normalizeSplitRatio(value)
}
