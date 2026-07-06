/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code workbench editor contracts:
 * - src/vs/workbench/services/editor/common/editorGroupsService.ts
 * - src/vs/workbench/browser/parts/editor/editorPart.ts
 * - src/vs/workbench/common/editor.ts
 *--------------------------------------------------------------------------------------------*/

import {
  closeEditor,
  closeOtherEditors,
  closeRightEditors,
  closeSavedEditors,
  createEditorOwnerEvidence,
  createEditorLifecycleProjection,
  createEditorGroupState,
  markDirty,
  moveEditor,
  openEditor,
  reopenClosedEditor,
  setSplitOpen,
  togglePinned,
  type CreateEditorGroupStateInput,
  type EditorEntry,
  type EditorGroupState,
  type EditorLifecycleProjection,
  type EditorLifecycleStateResolver,
  type EditorOwnerEvidence,
  type OpenEditorOptions,
} from "../../../../../workbench/editorGroups"
import { InstantiationType, registerSingleton } from "../../../../platform/instantiation/common/extensions"
import { createDecorator } from "../../../../platform/instantiation/common/instantiation"

export interface EditorPartOverflowState {
  totalEditors: number
  visibleEditors: number
  overflowCount: number
  overflow: boolean
}

export interface EditorPartStateSummary {
  activeGroupId: string
  activeEditor: string | null
  totalEditors: number
  dirtyCount: number
  pinnedCount: number
  previewCount: number
  ownerEvidence: EditorOwnerEvidence
  lifecycle: EditorLifecycleProjection
  splitOpen: boolean
  overflow: EditorPartOverflowState
}

export interface GenericEditorPaneShellContract {
  readonly owner: "EditorPartService"
  readonly status: "partial"
  readonly vscodeEntrypoints: readonly string[]
  readonly currentCodekSurfaces: readonly string[]
  readonly stateSource: "editorGroups"
  readonly lowConflictAdapterPossible: true
  readonly noSecondWorkbenchState: true
  readonly runtimeReferenceToSourceMirror: false
  readonly supports: readonly string[]
  readonly blockedOwners: readonly string[]
  readonly requiresAppVueOrGenericShellRewriteForFullOwner: true
  readonly reason: string
}

export interface IEditorPartService {
  readonly _serviceBrand: undefined
  createState(input?: CreateEditorGroupStateInput): EditorGroupState
  openEditor(state: EditorGroupState, path: string, options?: OpenEditorOptions): EditorEntry
  focusEditor(state: EditorGroupState, path: string): boolean
  closeEditor(state: EditorGroupState, path: string): boolean
  closeOtherEditors(state: EditorGroupState, keepPath: string): void
  closeRightEditors(state: EditorGroupState, anchorPath: string): void
  closeSavedEditors(state: EditorGroupState): void
  reopenClosedEditor(state: EditorGroupState): EditorEntry | null
  moveEditor(state: EditorGroupState, draggedPath: string, targetPath: string): void
  togglePinned(state: EditorGroupState, path: string): void
  markDirty(state: EditorGroupState, path: string, dirty: boolean): void
  setSplitOpen(state: EditorGroupState, open: boolean, file?: string | null, ratio?: number): void
  getSummary(state: EditorGroupState, options?: { visibleEditors?: number; resolveLifecycleState?: EditorLifecycleStateResolver }): EditorPartStateSummary
  getGenericEditorPaneShellContract(): GenericEditorPaneShellContract
}

export const IEditorPartService = createDecorator<IEditorPartService>("editorPartService")

export class EditorPartService implements IEditorPartService {
  declare readonly _serviceBrand: undefined

  createState(input: CreateEditorGroupStateInput = {}): EditorGroupState {
    return createEditorGroupState(input)
  }

  openEditor(state: EditorGroupState, path: string, options: OpenEditorOptions = {}): EditorEntry {
    return openEditor(state, path, options)
  }

  focusEditor(state: EditorGroupState, path: string): boolean {
    for (const group of state.groups) {
      if (group.editors.some((editor) => editor.path === path)) {
        state.activeGroupId = group.id
        group.activeEditor = path
        return true
      }
    }
    return false
  }

  closeEditor(state: EditorGroupState, path: string): boolean {
    return closeEditor(state, path)
  }

  closeOtherEditors(state: EditorGroupState, keepPath: string): void {
    closeOtherEditors(state, keepPath)
  }

  closeRightEditors(state: EditorGroupState, anchorPath: string): void {
    closeRightEditors(state, anchorPath)
  }

  closeSavedEditors(state: EditorGroupState): void {
    closeSavedEditors(state)
  }

  reopenClosedEditor(state: EditorGroupState): EditorEntry | null {
    return reopenClosedEditor(state)
  }

  moveEditor(state: EditorGroupState, draggedPath: string, targetPath: string): void {
    moveEditor(state, draggedPath, targetPath)
  }

  togglePinned(state: EditorGroupState, path: string): void {
    togglePinned(state, path)
  }

  markDirty(state: EditorGroupState, path: string, dirty: boolean): void {
    markDirty(state, path, dirty)
  }

  setSplitOpen(state: EditorGroupState, open: boolean, file: string | null = null, ratio?: number): void {
    setSplitOpen(state, open, file, ratio)
  }

  getSummary(
    state: EditorGroupState,
    options: { visibleEditors?: number; resolveLifecycleState?: EditorLifecycleStateResolver } = {},
  ): EditorPartStateSummary {
    const group = state.groups.find((candidate) => candidate.id === state.activeGroupId) || state.groups[0]
    const editors = group?.editors || []
    const totalEditors = editors.length
    const visibleEditors = sanitizeVisibleEditors(options.visibleEditors, totalEditors)
    const lifecycle = createEditorLifecycleProjection(state, options.resolveLifecycleState)
    return {
      activeGroupId: state.activeGroupId,
      activeEditor: group?.activeEditor || null,
      totalEditors,
      dirtyCount: lifecycle.dirtyCount,
      pinnedCount: editors.filter((editor) => editor.pinned).length,
      previewCount: editors.filter((editor) => editor.preview).length,
      ownerEvidence: createEditorOwnerEvidence(state),
      lifecycle,
      splitOpen: state.split.open,
      overflow: {
        totalEditors,
        visibleEditors,
        overflowCount: Math.max(0, totalEditors - visibleEditors),
        overflow: totalEditors > visibleEditors,
      },
    }
  }

  getGenericEditorPaneShellContract(): GenericEditorPaneShellContract {
    return {
      owner: "EditorPartService",
      status: "partial",
      vscodeEntrypoints: [
        "src/vs/workbench/browser/parts/editor/editorPane.ts",
        "src/vs/workbench/browser/parts/editor/editorPart.ts",
        "src/vs/workbench/services/editor/common/editorService.ts",
        "src/vs/workbench/services/editor/common/editorGroupsService.ts",
        "src/vs/workbench/services/editor/browser/editorPaneService.ts",
        "src/vs/workbench/common/editor/editorInput.ts",
        "src/vs/workbench/browser/editor.ts",
      ],
      currentCodekSurfaces: [
        "frontend/vite-project/src/workbench/editorGroups.ts",
        "frontend/vite-project/src/workbench/workbenchExplorerEditorService.ts",
        "frontend/vite-project/src/vscode-adapter/workbench/services/editor/common/editorPartService.ts",
      ],
      stateSource: "editorGroups",
      lowConflictAdapterPossible: true,
      noSecondWorkbenchState: true,
      runtimeReferenceToSourceMirror: false,
      supports: [
        "editorGroups-backed active editor summary",
        "pinned/permanent/preview open options",
        "focus/close/reopen/pin/dirty tab lifecycle",
        "overflow and split editor projections",
        "WorkspaceTrustEditorInput-compatible resource tab via WorkbenchExplorerEditorService",
      ],
      blockedOwners: [
        "EditorPaneDescriptor registry",
        "EditorInput serializer",
        "IEditorService.openEditor(EditorInput)",
        "EditorPane createEditor(parent) DOM lifecycle",
        "IInstantiationService-created pane graph",
        "theme/storage/telemetry injected EditorPane base",
      ],
      requiresAppVueOrGenericShellRewriteForFullOwner: true,
      reason: "EditorPartService is the reusable low-conflict state owner for a generic EditorPane shell contract, but full VS Code EditorPane ownership still needs a real App.vue/generic shell DOM host and EditorPaneDescriptor/EditorInput wiring.",
    }
  }
}

function sanitizeVisibleEditors(value: number | undefined, totalEditors: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return totalEditors
  return Math.max(0, Math.min(totalEditors, Math.floor(value)))
}

export const globalEditorPartService = new EditorPartService()
registerSingleton(IEditorPartService, globalEditorPartService, InstantiationType.Delayed)
