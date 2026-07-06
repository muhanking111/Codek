// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\workbench\common\editor\editorGroupModel.ts
// - D:\SourceMirror\vscode\src\vs\workbench\browser\parts\editor\editorPart.ts
// - D:\SourceMirror\vscode\src\vs\workbench\browser\parts\editor\editor.contribution.ts
//
// Codek still keeps a lightweight Vue editor group state. This adapter ports the
// transferable persistence semantics into one place: sanitize serialized editor
// groups, keep active editor valid, trim closed-editor history, and normalize
// split editor restoration.

import { normalizeEditorOpenOptions } from "./editorOpenOptions"

export interface CodekPersistedEditorEntry {
  path: string
  dirty?: boolean
  pinned?: boolean
  preview?: boolean
  permanent?: boolean
}

export interface CodekPersistedEditorGroup {
  id: string
  activeEditor: string | null
  editors: CodekPersistedEditorEntry[]
}

export interface CodekEditorSplitState {
  open: boolean
  file: string | null
  ratio: number
}

export interface CodekEditorGroupSnapshot {
  version: 1
  activeGroupId: string
  groups: CodekPersistedEditorGroup[]
  closedEditors: CodekPersistedEditorEntry[]
  split: CodekEditorSplitState
}

export interface CodekEditorGroupHydrationOptions {
  availableFiles?: Iterable<string>
  maxClosedEditors?: number
}

export const EDITOR_GROUP_SNAPSHOT_VERSION = 1
export const DEFAULT_MAX_CLOSED_EDITORS = 20
export const DEFAULT_SPLIT_RATIO = 50

export function createEditorGroupPersistenceSnapshot(input: {
  activeGroupId: string
  groups: CodekPersistedEditorGroup[]
  closedEditors: CodekPersistedEditorEntry[]
  split: CodekEditorSplitState
}): CodekEditorGroupSnapshot {
  return {
    version: EDITOR_GROUP_SNAPSHOT_VERSION,
    activeGroupId: input.activeGroupId,
    groups: input.groups.map((group) => ({
      id: group.id,
      activeEditor: group.activeEditor,
      editors: group.editors.map(clonePersistedEditor),
    })),
    closedEditors: input.closedEditors.map(clonePersistedEditor).slice(0, DEFAULT_MAX_CLOSED_EDITORS),
    split: normalizeSplitState(input.split),
  }
}

export function hydrateEditorGroupPersistenceSnapshot(
  rawSnapshot: unknown,
  options: CodekEditorGroupHydrationOptions = {},
): CodekEditorGroupSnapshot | null {
  if (!isRecord(rawSnapshot) || rawSnapshot.version !== EDITOR_GROUP_SNAPSHOT_VERSION || !Array.isArray(rawSnapshot.groups)) {
    return null
  }

  const available = options.availableFiles ? new Set(Array.from(options.availableFiles, String)) : null
  const rawGroups = rawSnapshot.groups.filter((group): group is Record<string, unknown> => isRecord(group) && Array.isArray(group.editors))
  const groups = rawGroups.map((group, index) => hydrateGroup(group, index, available)).filter((group) => group.editors.length)
  const firstFallbackGroup = rawGroups[0] ? hydrateGroup(rawGroups[0], 0, available) : createEmptyGroup()
  const normalizedGroups = groups.length ? groups : [firstFallbackGroup]
  const activeGroupId = typeof rawSnapshot.activeGroupId === "string" && normalizedGroups.some((group) => group.id === rawSnapshot.activeGroupId)
    ? rawSnapshot.activeGroupId
    : normalizedGroups[0].id
  const openPaths = new Set(normalizedGroups.flatMap((group) => group.editors.map((editor) => editor.path)))
  const maxClosedEditors = normalizeMaxClosedEditors(options.maxClosedEditors)
  const closedEditors = Array.isArray(rawSnapshot.closedEditors)
    ? rawSnapshot.closedEditors
      .filter((editor): editor is Record<string, unknown> => isRecord(editor) && typeof editor.path === "string")
      .filter((editor) => !available || available.has(String(editor.path)))
      .filter((editor) => !openPaths.has(String(editor.path)))
      .map((editor) => normalizeClosedEditor(editor))
      .slice(0, maxClosedEditors)
    : []

  return {
    version: EDITOR_GROUP_SNAPSHOT_VERSION,
    activeGroupId,
    groups: normalizedGroups,
    closedEditors,
    split: hydrateSplitState(isRecord(rawSnapshot.split) ? rawSnapshot.split : null, available),
  }
}

export function clonePersistedEditor(editor: CodekPersistedEditorEntry): CodekPersistedEditorEntry {
  return {
    path: editor.path,
    dirty: editor.dirty === true,
    pinned: editor.pinned === true,
    preview: editor.preview === true,
    permanent: editor.permanent === true,
  }
}

export function normalizeSplitRatio(value: unknown, fallback = DEFAULT_SPLIT_RATIO): number {
  const ratio = Number(value)
  if (!Number.isFinite(ratio)) return fallback
  return Math.min(80, Math.max(20, Math.round(ratio)))
}

function hydrateGroup(group: Record<string, unknown>, index: number, available: Set<string> | null): CodekPersistedEditorGroup {
  const editors = Array.isArray(group.editors)
    ? group.editors
      .filter((editor): editor is Record<string, unknown> => isRecord(editor) && typeof editor.path === "string")
      .filter((editor) => !available || available.has(String(editor.path)))
      .map((editor) => normalizeOpenEditor(editor))
    : []
  const activeEditor = typeof group.activeEditor === "string" && editors.some((editor) => editor.path === group.activeEditor)
    ? group.activeEditor
    : editors[editors.length - 1]?.path ?? null
  return {
    id: typeof group.id === "string" && group.id ? group.id : `group_${index + 1}`,
    activeEditor,
    editors,
  }
}

function createEmptyGroup(): CodekPersistedEditorGroup {
  return { id: "group_1", activeEditor: null, editors: [] }
}

function normalizeOpenEditor(editor: Record<string, unknown>): CodekPersistedEditorEntry {
  return normalizeEditorOpenOptions({
    path: String(editor.path),
    dirty: editor.dirty === true,
    pinned: editor.pinned === true,
    preview: editor.preview === true,
    permanent: editor.permanent === true,
  })
}

function normalizeClosedEditor(editor: Record<string, unknown>): CodekPersistedEditorEntry {
  return {
    ...normalizeEditorOpenOptions({
      path: String(editor.path),
      dirty: editor.dirty === true,
      pinned: editor.pinned === true,
      permanent: true,
      preview: false,
    }),
    preview: false,
    permanent: true,
  }
}

function normalizeSplitState(split: CodekEditorSplitState): CodekEditorSplitState {
  return {
    open: split.open === true && typeof split.file === "string" && Boolean(split.file),
    file: typeof split.file === "string" ? split.file : null,
    ratio: normalizeSplitRatio(split.ratio),
  }
}

function hydrateSplitState(split: Record<string, unknown> | null, available: Set<string> | null): CodekEditorSplitState {
  if (!split) return { open: false, file: null, ratio: DEFAULT_SPLIT_RATIO }
  const file = typeof split.file === "string" && (!available || available.has(split.file)) ? split.file : null
  return {
    open: split.open === true && Boolean(file),
    file,
    ratio: normalizeSplitRatio(split.ratio),
  }
}

function normalizeMaxClosedEditors(value: unknown): number {
  const max = Number(value)
  return Number.isFinite(max) && max >= 0 ? Math.floor(max) : DEFAULT_MAX_CLOSED_EDITORS
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}