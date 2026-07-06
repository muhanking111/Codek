import { planEditorClose, type EditorCloseKind } from "../vscode-adapter/workbench/browser/parts/editor/editorCloseModel"
import { normalizeEditorOpenOptions, promoteEditorOpenModel } from "../vscode-adapter/workbench/browser/parts/editor/editorOpenOptions"
import {
  TextFileEditorModelState,
  getTextFileEditorModelStateName,
  hasExternalTextFileChange,
  isTextFileModelDirty,
  isTextFileModelModified,
  type TextFileEditorModelStateName,
  type TextFileModelState,
} from "../vscode-adapter/workbench/services/textfile/common/textfiles"

export interface EditorEntry {
  path: string
  dirty: boolean
  pinned: boolean
  preview: boolean
  permanent: boolean
}

export interface EditorGroup {
  id: string
  activeEditor: string | null
  editors: EditorEntry[]
}

export interface SplitEditorState {
  open: boolean
  file: string | null
  ratio: number
}

export interface EditorGroupState {
  groups: EditorGroup[]
  activeGroupId: string
  closedEditors: EditorEntry[]
  split: SplitEditorState
}

export interface CreateEditorGroupStateInput {
  editors?: Array<Partial<EditorEntry> & { path: string }>
  activeEditor?: string | null
}

export interface OpenEditorOptions {
  pinned?: boolean
  dirty?: boolean
  preview?: boolean
  permanent?: boolean
}

export type EditorLifecycleStatus = TextFileEditorModelStateName | "readonly"

export interface EditorLifecycleStateInput {
  readonly textFileState?: TextFileModelState | null
  readonly workingCopyDirty?: boolean
  readonly workingCopyModified?: boolean
  readonly readOnly?: boolean
  readonly backupRestored?: boolean
  readonly pendingBackup?: boolean
}

export interface EditorLifecycleState {
  readonly path: string
  readonly stateSource: "textFileService" | "workingCopyService" | "editorGroupState"
  readonly status: EditorLifecycleStatus
  readonly dirty: boolean
  readonly modified: boolean
  readonly saving: boolean
  readonly readOnly: boolean
  readonly conflict: boolean
  readonly orphan: boolean
  readonly error: boolean
  readonly external: boolean
  readonly backupRestored: boolean
  readonly pendingBackup: boolean
  readonly canSave: boolean
  readonly canRevert: boolean
  readonly canCloseWithoutConfirmation: boolean
  readonly badge: "" | "dirty" | "saving" | "readonly" | "conflict" | "orphan" | "error" | "backup"
}

export interface EditorLifecycleProjectionEntry extends EditorEntry {
  readonly lifecycle: EditorLifecycleState
}

export interface EditorLifecycleProjectionGroup {
  readonly id: string
  readonly activeEditor: string | null
  readonly editors: readonly EditorLifecycleProjectionEntry[]
}

export interface EditorLifecycleProjection {
  readonly source: "editorGroups"
  readonly stateSource: "editorGroupState"
  readonly textFileStateSource: "TextFileService.files"
  readonly workingCopyStateSource: "WorkingCopyService"
  readonly ownerEvidence: EditorOwnerEvidence
  readonly activeGroupId: string
  readonly activeEditor: string | null
  readonly dirtyCount: number
  readonly savingCount: number
  readonly conflictCount: number
  readonly orphanCount: number
  readonly errorCount: number
  readonly readonlyCount: number
  readonly backupRestoredCount: number
  readonly groups: readonly EditorLifecycleProjectionGroup[]
  readonly constraints: {
    readonly noSecondEditorState: true
    readonly noDirectWrite: true
    readonly saveBoundary: "TextFileService.save -> FileService.writeFile"
  }
}

export type EditorResourceUriKind =
  | "fileUri"
  | "untitledUri"
  | "customUri"
  | "absolutePath"
  | "relativePath"
  | "unknown"

export interface EditorOwnerEvidence {
  readonly source: "editorGroups"
  readonly editorGroupsOwner: "EditorPartService"
  readonly editorTabsOwner: "WorkbenchExplorerEditorService.openEditorsModel"
  readonly editorInputOwner: "resourceUriProjection"
  readonly activeEditorSource: "editorGroups.activeGroup.activeEditor"
  readonly groupStateSource: "editorGroups"
  readonly resourceUriKind: EditorResourceUriKind
  readonly remainingEditorShellOwnerGap: true
  readonly noSecondEditorTabsStateSource: true
  readonly noSecondEditorGroupsStateSource: true
  readonly noDirectUserFileWrite: true
  readonly runtimeReferenceToSourceMirror: false
  readonly connectedOwners: readonly [
    "EditorPartService",
    "WorkbenchExplorerEditorService",
  ]
  readonly blockedOwners: readonly string[]
  readonly vscodeEntrypoints: readonly string[]
  readonly currentCodekSurfaces: readonly string[]
  readonly reason: string
}

export type EditorLifecycleStateResolver = (path: string, editor: EditorEntry) => EditorLifecycleStateInput | undefined

export function createEditorGroupState(input: CreateEditorGroupStateInput = {}): EditorGroupState {
  const editors = (input.editors || []).map(normalizeEditor)
  return {
    groups: [{
      id: "group_1",
      activeEditor: input.activeEditor ?? editors[editors.length - 1]?.path ?? null,
      editors,
    }],
    activeGroupId: "group_1",
    closedEditors: [],
    split: { open: false, file: null, ratio: 50 },
  }
}

export function openEditor(state: EditorGroupState, path: string, options: OpenEditorOptions = {}): EditorEntry {
  const group = activeGroup(state)
  const existing = group.editors.find((editor) => editor.path === path)
  if (existing) {
    Object.assign(existing, normalizeEditor({ ...existing, ...options, path }))
    promoteIfNeeded(existing)
    group.activeEditor = path
    return existing
  }

  const editor = normalizeEditor({ path, ...options })
  if (!editor.permanent && editor.preview) {
    const previewIndex = group.editors.findIndex((item) => item.preview && !item.pinned && !item.dirty)
    if (previewIndex >= 0) group.editors.splice(previewIndex, 1)
  }
  group.editors.push(editor)
  group.activeEditor = path
  return editor
}

export function closeEditor(state: EditorGroupState, path: string): boolean {
  return applyEditorClosePlan(state, "single", path)
}

export function closeOtherEditors(state: EditorGroupState, keepPath: string): void {
  applyEditorClosePlan(state, "others", keepPath)
}

export function closeRightEditors(state: EditorGroupState, anchorPath: string): void {
  applyEditorClosePlan(state, "right", anchorPath)
}

export function closeSavedEditors(state: EditorGroupState): void {
  applyEditorClosePlan(state, "saved")
}

function applyEditorClosePlan(state: EditorGroupState, kind: EditorCloseKind, targetPath?: string): boolean {
  const group = activeGroup(state)
  const plan = planEditorClose({ editors: group.editors, activeEditor: group.activeEditor, kind, targetPath })
  if (!plan.closing.length) return false
  state.closedEditors.unshift(...plan.closing.map((editor) => ({ ...editor })))
  state.closedEditors = state.closedEditors.slice(0, 20)
  group.editors = plan.editors
  group.activeEditor = plan.activeEditor
  return true
}

export function moveEditor(state: EditorGroupState, draggedPath: string, targetPath: string): void {
  const group = activeGroup(state)
  const fromIndex = group.editors.findIndex((editor) => editor.path === draggedPath)
  const toIndex = group.editors.findIndex((editor) => editor.path === targetPath)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
  const [item] = group.editors.splice(fromIndex, 1)
  group.editors.splice(toIndex, 0, item)
}

export function reopenClosedEditor(state: EditorGroupState): EditorEntry | null {
  const closed = state.closedEditors.shift()
  if (!closed) return null
  return openEditor(state, closed.path, { ...closed, preview: false, permanent: true })
}

export function togglePinned(state: EditorGroupState, path: string): void {
  const editor = findEditor(state, path)
  if (!editor) return
  editor.pinned = !editor.pinned
  promoteIfNeeded(editor)
}

export function markDirty(state: EditorGroupState, path: string, dirty: boolean): void {
  const editor = findEditor(state, path)
  if (!editor) return
  editor.dirty = dirty
  promoteIfNeeded(editor)
}

export function setSplitOpen(state: EditorGroupState, open: boolean, file: string | null = null, ratio?: number): void {
  state.split.open = open
  state.split.file = open ? file : null
  if (typeof ratio === "number" && Number.isFinite(ratio)) {
    state.split.ratio = Math.max(20, Math.min(80, ratio))
  }
}

export function buildEditorLifecycleState(
  editor: EditorEntry,
  input: EditorLifecycleStateInput = {},
): EditorLifecycleState {
  const textFileState = input.textFileState ?? null
  const textFileDirty = textFileState ? isTextFileModelDirty(textFileState) : undefined
  const textFileModified = textFileState ? isTextFileModelModified(textFileState) : undefined
  const dirty = textFileDirty ?? input.workingCopyDirty ?? editor.dirty
  const modified = textFileModified ?? input.workingCopyModified ?? dirty
  const saving = textFileState?.state === TextFileEditorModelState.PENDING_SAVE
  const conflict = textFileState?.state === TextFileEditorModelState.CONFLICT
  const orphan = textFileState?.state === TextFileEditorModelState.ORPHAN
  const error = textFileState?.state === TextFileEditorModelState.ERROR
  const readOnly = input.readOnly === true
  const backupRestored = input.backupRestored === true
  const pendingBackup = input.pendingBackup === true
  const status = readOnly && !dirty
    ? "readonly"
    : textFileState
      ? getTextFileEditorModelStateName(textFileState.state)
      : dirty
        ? "dirty"
        : "saved"

  return {
    path: editor.path,
    stateSource: textFileState ? "textFileService" : input.workingCopyDirty !== undefined || input.workingCopyModified !== undefined ? "workingCopyService" : "editorGroupState",
    status,
    dirty,
    modified,
    saving,
    readOnly,
    conflict,
    orphan,
    error,
    external: textFileState ? hasExternalTextFileChange(textFileState) : false,
    backupRestored,
    pendingBackup,
    canSave: dirty && !saving && !readOnly,
    canRevert: (dirty || modified || backupRestored || pendingBackup) && !saving,
    canCloseWithoutConfirmation: !dirty && !backupRestored && !pendingBackup,
    badge: resolveEditorLifecycleBadge({
      readOnly,
      conflict,
      orphan,
      error,
      saving,
      dirty,
      backupRestored,
      pendingBackup,
    }),
  }
}

export function createEditorLifecycleProjection(
  state: EditorGroupState,
  resolveState: EditorLifecycleStateResolver = () => undefined,
): EditorLifecycleProjection {
  const groups = state.groups.map((group) => ({
    id: group.id,
    activeEditor: group.activeEditor,
    editors: group.editors.map((editor) => ({
      ...editor,
      lifecycle: buildEditorLifecycleState(editor, resolveState(editor.path, editor) ?? {}),
    })),
  }))
  const entries = groups.flatMap((group) => group.editors)
  const activeGroup = groups.find((group) => group.id === state.activeGroupId) || groups[0]
  return {
    source: "editorGroups",
    stateSource: "editorGroupState",
    textFileStateSource: "TextFileService.files",
    workingCopyStateSource: "WorkingCopyService",
    ownerEvidence: createEditorOwnerEvidence(state),
    activeGroupId: state.activeGroupId,
    activeEditor: activeGroup?.activeEditor ?? null,
    dirtyCount: entries.filter((entry) => entry.lifecycle.dirty).length,
    savingCount: entries.filter((entry) => entry.lifecycle.saving).length,
    conflictCount: entries.filter((entry) => entry.lifecycle.conflict).length,
    orphanCount: entries.filter((entry) => entry.lifecycle.orphan).length,
    errorCount: entries.filter((entry) => entry.lifecycle.error).length,
    readonlyCount: entries.filter((entry) => entry.lifecycle.readOnly).length,
    backupRestoredCount: entries.filter((entry) => entry.lifecycle.backupRestored).length,
    groups,
    constraints: {
      noSecondEditorState: true,
      noDirectWrite: true,
      saveBoundary: "TextFileService.save -> FileService.writeFile",
    },
  }
}

export function createEditorOwnerEvidence(state: EditorGroupState, resourcePath?: string | null): EditorOwnerEvidence {
  const group = activeGroup(state)
  const activeEditor = group?.activeEditor ?? null
  const resource = resourcePath ?? activeEditor
  return {
    source: "editorGroups",
    editorGroupsOwner: "EditorPartService",
    editorTabsOwner: "WorkbenchExplorerEditorService.openEditorsModel",
    editorInputOwner: "resourceUriProjection",
    activeEditorSource: "editorGroups.activeGroup.activeEditor",
    groupStateSource: "editorGroups",
    resourceUriKind: getEditorResourceUriKind(resource),
    remainingEditorShellOwnerGap: true,
    noSecondEditorTabsStateSource: true,
    noSecondEditorGroupsStateSource: true,
    noDirectUserFileWrite: true,
    runtimeReferenceToSourceMirror: false,
    connectedOwners: [
      "EditorPartService",
      "WorkbenchExplorerEditorService",
    ],
    blockedOwners: [
      "EditorTabsControl DOM owner",
      "EditorInputSerializer",
      "IEditorService.openEditor(EditorInput)",
      "EditorPaneDescriptor registry",
      "EditorPane createEditor(parent) DOM lifecycle",
      "App.vue/generic shell tab DOM owner",
    ],
    vscodeEntrypoints: [
      "src/vs/workbench/services/editor/common/editorGroupsService.ts",
      "src/vs/workbench/browser/parts/editor/editorTabsControl.ts",
      "src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts",
      "src/vs/workbench/browser/parts/editor/editorGroupView.ts",
      "src/vs/workbench/common/editor/editorInput.ts",
      "src/vs/workbench/services/editor/common/editorService.ts",
    ],
    currentCodekSurfaces: [
      "frontend/vite-project/src/workbench/editorGroups.ts",
      "frontend/vite-project/src/workbench/workbenchExplorerEditorService.ts",
      "frontend/vite-project/src/vscode-adapter/workbench/services/editor/common/editorPartService.ts",
    ],
    reason: "Editor groups and Open Editors tab evidence are projected from the existing editorGroups state through EditorPartService and WorkbenchExplorerEditorService; full VS Code tabs DOM and EditorInput ownership remains blocked until the generic editor shell/App.vue owner is wired.",
  }
}

export function getEditorResourceUriKind(resource: string | null | undefined): EditorResourceUriKind {
  const value = String(resource || "").trim()
  if (!value) return "unknown"
  if (/^file:\/\//i.test(value)) return "fileUri"
  if (/^untitled:/i.test(value)) return "untitledUri"
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return "customUri"
  if (/^[a-z]:[\\/]/i.test(value) || value.startsWith("/") || value.startsWith("\\\\")) return "absolutePath"
  return "relativePath"
}

function activeGroup(state: EditorGroupState): EditorGroup {
  return state.groups.find((group) => group.id === state.activeGroupId) || state.groups[0]
}

function findEditor(state: EditorGroupState, path: string): EditorEntry | null {
  for (const group of state.groups) {
    const found = group.editors.find((editor) => editor.path === path)
    if (found) return found
  }
  return null
}

function normalizeEditor(input: Partial<EditorEntry> & { path: string }): EditorEntry {
  return normalizeEditorOpenOptions(input)
}

function promoteIfNeeded(editor: EditorEntry): void {
  Object.assign(editor, promoteEditorOpenModel(editor))
}

function resolveEditorLifecycleBadge(input: {
  readOnly: boolean
  conflict: boolean
  orphan: boolean
  error: boolean
  saving: boolean
  dirty: boolean
  backupRestored: boolean
  pendingBackup: boolean
}): EditorLifecycleState["badge"] {
  if (input.conflict) return "conflict"
  if (input.orphan) return "orphan"
  if (input.error) return "error"
  if (input.saving) return "saving"
  if (input.backupRestored || input.pendingBackup) return "backup"
  if (input.dirty) return "dirty"
  if (input.readOnly) return "readonly"
  return ""
}
