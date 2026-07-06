import {
  applyEditorGroupStateToOpenFiles,
  buildEditorGroupStateFromOpenFiles,
  hydrateEditorGroupState,
  serializeEditorGroupState,
  type EditorGroupPersistenceSnapshot,
} from "./editorGroupPersistence"
import type { EditorEntry, EditorGroupState } from "./editorGroups"

export interface EditorGroupLayoutSnapshotInput {
  openFiles: string[]
  activeFile?: string | null
  pinnedTabs?: Iterable<string>
  dirtyFiles?: (path: string) => boolean
  closedEditors?: EditorEntry[]
  split: {
    open: boolean
    file: string | null
    ratio: number
  }
}

export interface PersistEditorGroupLayoutInput extends EditorGroupLayoutSnapshotInput {
  projectRoot?: string | null
  storage?: StorageLike
  storagePrefix?: string
  isHydrating?: boolean
}

export interface RestoreEditorGroupLayoutInput {
  projectRoot?: string | null
  storage?: StorageLike
  storagePrefix?: string
  availableFiles?: Iterable<string>
  restoreOpenFiles: (paths: string[], activePath: string | null) => Promise<unknown> | unknown
  setActiveFile?: (path: string | null) => void
  isOpenFile: (path: string) => boolean
  pinnedTabs?: Set<string>
  closedEditors?: EditorEntry[]
  setSplitOpen: (open: boolean) => void
  setSplitFile: (path: string | null) => void
  setSplitRatio: (ratio: number) => void
  shouldEnsureActiveFileLoaded?: (path: string) => boolean
  ensureActiveFileLoaded?: (path: string) => Promise<unknown> | unknown
  replaceEditorGroupState?: (state: EditorGroupState) => void
}

export interface RestoreEditorGroupLayoutResult {
  restored: boolean
  reason?: "missing-storage" | "missing-project-root" | "missing-snapshot" | "corrupt-snapshot"
}

export interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

const DEFAULT_STORAGE_PREFIX = "codek.editorGroups.v1"

export function editorGroupsStorageKey(root?: string | null, storagePrefix = DEFAULT_STORAGE_PREFIX): string | null {
  if (!root) return null
  return `${storagePrefix}:${String(root).replace(/\\/g, "/")}`
}

export function buildEditorGroupLayoutSnapshot(input: EditorGroupLayoutSnapshotInput): EditorGroupPersistenceSnapshot {
  const state = buildEditorGroupStateFromOpenFiles({
    openFiles: input.openFiles,
    activeFile: input.activeFile,
    pinnedTabs: input.pinnedTabs,
    dirtyFiles: input.dirtyFiles,
    closedEditors: input.closedEditors,
    split: input.split,
  })
  return serializeEditorGroupState(state)
}

export function persistEditorGroupLayout(input: PersistEditorGroupLayoutInput): boolean {
  if (input.isHydrating || !input.storage) return false
  const key = editorGroupsStorageKey(input.projectRoot, input.storagePrefix)
  if (!key) return false

  input.storage.setItem(key, JSON.stringify(buildEditorGroupLayoutSnapshot(input)))
  return true
}

export async function restoreEditorGroupLayout(input: RestoreEditorGroupLayoutInput): Promise<RestoreEditorGroupLayoutResult> {
  if (!input.storage) return { restored: false, reason: "missing-storage" }
  const key = editorGroupsStorageKey(input.projectRoot, input.storagePrefix)
  if (!key) return { restored: false, reason: "missing-project-root" }

  const rawSnapshot = input.storage.getItem(key)
  if (!rawSnapshot) return { restored: false, reason: "missing-snapshot" }

  let state
  try {
    state = hydrateEditorGroupState(JSON.parse(rawSnapshot), {
      availableFiles: input.availableFiles,
    })
  } catch {
    input.storage.removeItem(key)
    return { restored: false, reason: "corrupt-snapshot" }
  }

  const group = state.groups.find((candidate) => candidate.id === state.activeGroupId) || state.groups[0]
  const editorPaths = group?.editors.map((editor) => editor.path) || []
  const activeEditor = group?.activeEditor || null
  await input.restoreOpenFiles(editorPaths, activeEditor)
  input.replaceEditorGroupState?.(state)

  applyEditorGroupStateToOpenFiles(state, {
    setOpenFiles: () => {},
    setActiveFile: (path) => {
      if (path && input.isOpenFile(path)) input.setActiveFile?.(path)
    },
    pinnedTabs: input.pinnedTabs,
    closedEditors: input.closedEditors,
  })

  input.setSplitOpen(state.split.open)
  input.setSplitFile(state.split.file)
  input.setSplitRatio(state.split.ratio)

  if (activeEditor && input.shouldEnsureActiveFileLoaded?.(activeEditor)) {
    await input.ensureActiveFileLoaded?.(activeEditor)
  }

  return { restored: true }
}
