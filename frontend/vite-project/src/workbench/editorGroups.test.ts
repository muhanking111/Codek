import { describe, expect, it } from "vitest"
import {
  closeEditor,
  closeOtherEditors,
  closeRightEditors,
  closeSavedEditors,
  buildEditorLifecycleState,
  createEditorLifecycleProjection,
  createEditorGroupState,
  markDirty,
  moveEditor,
  openEditor,
  reopenClosedEditor,
  setSplitOpen,
  togglePinned,
} from "./editorGroups"
import {
  TextFileEditorModelState,
  createTextFileModelState,
  markTextFileExternalChange,
  markTextFileSavePending,
  setTextFileModelState,
} from "../vscode-adapter/workbench/services/textfile/common/textfiles"

describe("editorGroups", () => {
  it("opens preview editors and promotes pinned or dirty editors to permanent", () => {
    const state = createEditorGroupState()

    openEditor(state, "src/a.ts")
    expect(state.groups[0].editors).toEqual([
      expect.objectContaining({ path: "src/a.ts", preview: true, permanent: false }),
    ])

    openEditor(state, "src/b.ts")
    expect(state.groups[0].editors.map((item) => item.path)).toEqual(["src/b.ts"])

    markDirty(state, "src/b.ts", true)
    expect(state.groups[0].editors[0]).toEqual(expect.objectContaining({ dirty: true, preview: false, permanent: true }))

    openEditor(state, "src/c.ts")
    expect(state.groups[0].editors.map((item) => item.path)).toEqual(["src/b.ts", "src/c.ts"])
  })

  it("keeps pinned editors open when closing others, right, or saved editors", () => {
    const state = createEditorGroupState({
      editors: [
        { path: "a.ts" },
        { path: "b.ts", pinned: true },
        { path: "c.ts", dirty: true },
        { path: "d.ts" },
      ],
      activeEditor: "c.ts",
    })

    closeOtherEditors(state, "c.ts")
    expect(state.groups[0].editors.map((item) => item.path)).toEqual(["b.ts", "c.ts"])

    openEditor(state, "d.ts", { permanent: true })
    openEditor(state, "e.ts", { permanent: true })
    togglePinned(state, "e.ts")
    closeRightEditors(state, "c.ts")
    expect(state.groups[0].editors.map((item) => item.path)).toEqual(["b.ts", "c.ts", "e.ts"])

    closeSavedEditors(state)
    expect(state.groups[0].editors.map((item) => item.path)).toEqual(["b.ts", "c.ts", "e.ts"])
  })

  it("moves editors and reopens the most recently closed editor", () => {
    const state = createEditorGroupState({ editors: [{ path: "a.ts" }, { path: "b.ts" }, { path: "c.ts" }] })

    moveEditor(state, "c.ts", "a.ts")
    expect(state.groups[0].editors.map((item) => item.path)).toEqual(["c.ts", "a.ts", "b.ts"])

    closeEditor(state, "a.ts")
    expect(state.closedEditors[0].path).toBe("a.ts")
    expect(state.groups[0].editors.map((item) => item.path)).toEqual(["c.ts", "b.ts"])

    const reopened = reopenClosedEditor(state)
    expect(reopened?.path).toBe("a.ts")
    expect(state.groups[0].activeEditor).toBe("a.ts")
    expect(state.groups[0].editors.map((item) => item.path)).toEqual(["c.ts", "b.ts", "a.ts"])
  })

  it("tracks split group state independently from editor metadata", () => {
    const state = createEditorGroupState({ editors: [{ path: "a.ts" }] })

    setSplitOpen(state, true, "a.ts", 64)
    expect(state.split).toEqual({ open: true, file: "a.ts", ratio: 64 })

    setSplitOpen(state, false)
    expect(state.split).toEqual({ open: false, file: null, ratio: 64 })
  })

  it("projects text file and working copy lifecycle without creating a second state source", () => {
    const dirtyState = createTextFileModelState({ dirty: true })
    const conflictState = createTextFileModelState({ dirty: true })
    markTextFileExternalChange(conflictState)
    setTextFileModelState(conflictState, TextFileEditorModelState.CONFLICT, { external: true })
    const savingState = createTextFileModelState({ dirty: true })
    markTextFileSavePending(savingState)
    const state = createEditorGroupState({
      editors: [
        { path: "src/dirty.ts", dirty: false, permanent: true },
        { path: "src/conflict.ts", permanent: true },
        { path: "src/saving.ts", permanent: true },
        { path: "src/readonly.ts", permanent: true },
      ],
      activeEditor: "src/conflict.ts",
    })

    const projection = createEditorLifecycleProjection(state, (path) => {
      if (path.endsWith("dirty.ts")) return { textFileState: dirtyState }
      if (path.endsWith("conflict.ts")) return { textFileState: conflictState, pendingBackup: true }
      if (path.endsWith("saving.ts")) return { textFileState: savingState }
      if (path.endsWith("readonly.ts")) return { readOnly: true }
      return undefined
    })

    expect(projection).toEqual(expect.objectContaining({
      source: "editorGroups",
      stateSource: "editorGroupState",
      textFileStateSource: "TextFileService.files",
      workingCopyStateSource: "WorkingCopyService",
      activeEditor: "src/conflict.ts",
      dirtyCount: 3,
      savingCount: 1,
      conflictCount: 1,
      readonlyCount: 1,
      constraints: {
        noSecondEditorState: true,
        noDirectWrite: true,
        saveBoundary: "TextFileService.save -> FileService.writeFile",
      },
    }))
    expect(projection.groups[0].editors.map((editor) => ({
      path: editor.path,
      badge: editor.lifecycle.badge,
      canSave: editor.lifecycle.canSave,
      canCloseWithoutConfirmation: editor.lifecycle.canCloseWithoutConfirmation,
    }))).toEqual([
      { path: "src/dirty.ts", badge: "dirty", canSave: true, canCloseWithoutConfirmation: false },
      { path: "src/conflict.ts", badge: "conflict", canSave: true, canCloseWithoutConfirmation: false },
      { path: "src/saving.ts", badge: "saving", canSave: false, canCloseWithoutConfirmation: false },
      { path: "src/readonly.ts", badge: "readonly", canSave: false, canCloseWithoutConfirmation: true },
    ])
  })

  it("derives fallback lifecycle from working copy and editor group state", () => {
    expect(buildEditorLifecycleState(
      { path: "src/wc.ts", dirty: false, pinned: false, preview: false, permanent: true },
      { workingCopyDirty: true, workingCopyModified: true, backupRestored: true },
    )).toEqual(expect.objectContaining({
      stateSource: "workingCopyService",
      status: "dirty",
      dirty: true,
      modified: true,
      backupRestored: true,
      badge: "backup",
      canSave: true,
      canRevert: true,
    }))

    expect(buildEditorLifecycleState(
      { path: "src/group.ts", dirty: true, pinned: false, preview: false, permanent: true },
    )).toEqual(expect.objectContaining({
      stateSource: "editorGroupState",
      status: "dirty",
      badge: "dirty",
    }))
  })
})
