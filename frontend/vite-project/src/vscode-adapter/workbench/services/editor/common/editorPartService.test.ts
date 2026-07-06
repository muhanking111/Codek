import { describe, expect, it } from "vitest"
import { ServiceCollection } from "../../../../platform/instantiation/common/serviceCollection"
import { EditorPartService, globalEditorPartService, IEditorPartService } from "./editorPartService"
import { createTextFileModelState, markTextFileExternalChange } from "../../textfile/common/textfiles"

describe("EditorPartService", () => {
  it("registers a VS Code-style service identifier and resolves through ServiceCollection", () => {
    const service = new EditorPartService()
    const collection = new ServiceCollection([IEditorPartService, service])

    const resolved = collection.get(IEditorPartService)

    expect(resolved).toBe(service)
    expect(resolved?._serviceBrand).toBeUndefined()
    expect(globalEditorPartService._serviceBrand).toBeUndefined()
  })

  it("proxies open, focus, dirty, close, reopen and overflow through one editor part state source", () => {
    const service = new EditorPartService()
    const state = service.createState()

    service.openEditor(state, "src/a.ts", { permanent: true, pinned: true })
    service.openEditor(state, "src/b.ts")
    service.markDirty(state, "src/b.ts", true)
    service.openEditor(state, "src/c.ts")
    expect(service.focusEditor(state, "src/a.ts")).toBe(true)

    expect(state.groups[0].activeEditor).toBe("src/a.ts")
    expect(service.focusEditor(state, "src/missing.ts")).toBe(false)
    expect(state.groups[0].activeEditor).toBe("src/a.ts")
    expect(service.getSummary(state, { visibleEditors: 2 })).toEqual(expect.objectContaining({
      activeGroupId: "group_1",
      activeEditor: "src/a.ts",
      totalEditors: 3,
      dirtyCount: 1,
      pinnedCount: 1,
      previewCount: 1,
      overflow: {
        totalEditors: 3,
        visibleEditors: 2,
        overflowCount: 1,
        overflow: true,
      },
    }))

    expect(service.closeEditor(state, "src/c.ts")).toBe(true)
    expect(state.groups[0].activeEditor).toBe("src/a.ts")
    expect(state.closedEditors[0].path).toBe("src/c.ts")

    const reopened = service.reopenClosedEditor(state)
    expect(reopened?.path).toBe("src/c.ts")
    expect(state.groups[0].activeEditor).toBe("src/c.ts")
  })

  it("keeps pinned and dirty semantics consistent with existing Codek tab helpers", () => {
    const service = new EditorPartService()
    const state = service.createState({
      editors: [
        { path: "a.ts", permanent: true },
        { path: "b.ts", permanent: true, pinned: true },
        { path: "c.ts", permanent: true, dirty: true },
        { path: "d.ts", permanent: true },
      ],
      activeEditor: "c.ts",
    })

    service.closeOtherEditors(state, "c.ts")
    expect(state.groups[0].editors.map((editor) => editor.path)).toEqual(["b.ts", "c.ts"])

    service.openEditor(state, "d.ts", { permanent: true })
    service.openEditor(state, "e.ts", { permanent: true })
    service.togglePinned(state, "e.ts")
    service.closeRightEditors(state, "c.ts")
    expect(state.groups[0].editors.map((editor) => editor.path)).toEqual(["b.ts", "c.ts", "e.ts"])

    service.closeSavedEditors(state)
    expect(state.groups[0].editors.map((editor) => editor.path)).toEqual(["b.ts", "c.ts", "e.ts"])
  })

  it("tracks split state through the service boundary", () => {
    const service = new EditorPartService()
    const state = service.createState({ editors: [{ path: "a.ts" }] })

    service.setSplitOpen(state, true, "a.ts", 72)
    expect(service.getSummary(state).splitOpen).toBe(true)
    expect(state.split).toEqual({ open: true, file: "a.ts", ratio: 72 })

    service.setSplitOpen(state, false)
    expect(service.getSummary(state).splitOpen).toBe(false)
    expect(state.split).toEqual({ open: false, file: null, ratio: 72 })
  })

  it("summarizes TextFile and WorkingCopy lifecycle through the editor part service", () => {
    const service = new EditorPartService()
    const textFileState = createTextFileModelState({ dirty: true })
    markTextFileExternalChange(textFileState)
    const state = service.createState({
      editors: [
        { path: "src/app.ts", permanent: true },
        { path: "README.md", permanent: true },
      ],
      activeEditor: "src/app.ts",
    })

    const summary = service.getSummary(state, {
      resolveLifecycleState: (path) => path === "src/app.ts"
        ? { textFileState, pendingBackup: true }
        : { readOnly: true },
    })

    expect(summary.lifecycle).toEqual(expect.objectContaining({
      source: "editorGroups",
      dirtyCount: 1,
      readonlyCount: 1,
      backupRestoredCount: 0,
      constraints: expect.objectContaining({
        saveBoundary: "TextFileService.save -> FileService.writeFile",
      }),
    }))
    expect(summary.dirtyCount).toBe(1)
    expect(summary.lifecycle.groups[0].editors.map((editor) => ({
      path: editor.path,
      stateSource: editor.lifecycle.stateSource,
      badge: editor.lifecycle.badge,
      external: editor.lifecycle.external,
    }))).toEqual([
      { path: "src/app.ts", stateSource: "textFileService", badge: "backup", external: true },
      { path: "README.md", stateSource: "editorGroupState", badge: "readonly", external: false },
    ])
  })

  it("exposes editor groups, tabs and input owner evidence from the shared state source", () => {
    const service = new EditorPartService()
    const state = service.createState({
      editors: [
        { path: "file:///D:/Workspace/src/app.ts", permanent: true },
        { path: "vscode-workspace-trust://workspaceTrustEditor", permanent: true, pinned: true },
      ],
      activeEditor: "file:///D:/Workspace/src/app.ts",
    })

    const summary = service.getSummary(state)

    expect(summary.ownerEvidence).toEqual(expect.objectContaining({
      source: "editorGroups",
      editorGroupsOwner: "EditorPartService",
      editorTabsOwner: "WorkbenchExplorerEditorService.openEditorsModel",
      editorInputOwner: "resourceUriProjection",
      activeEditorSource: "editorGroups.activeGroup.activeEditor",
      groupStateSource: "editorGroups",
      resourceUriKind: "fileUri",
      remainingEditorShellOwnerGap: true,
      noSecondEditorTabsStateSource: true,
      noDirectUserFileWrite: true,
      runtimeReferenceToSourceMirror: false,
    }))
    expect(summary.ownerEvidence.connectedOwners).toEqual([
      "EditorPartService",
      "WorkbenchExplorerEditorService",
    ])
    expect(summary.ownerEvidence.blockedOwners).toEqual(expect.arrayContaining([
      "EditorTabsControl DOM owner",
      "EditorInputSerializer",
      "IEditorService.openEditor(EditorInput)",
      "App.vue/generic shell tab DOM owner",
    ]))
    expect(summary.ownerEvidence.vscodeEntrypoints).toEqual(expect.arrayContaining([
      "src/vs/workbench/services/editor/common/editorGroupsService.ts",
      "src/vs/workbench/browser/parts/editor/editorTabsControl.ts",
      "src/vs/workbench/common/editor/editorInput.ts",
    ]))
    expect(JSON.stringify(summary.ownerEvidence)).not.toContain("D:\\SourceMirror")
    expect(JSON.stringify(summary.ownerEvidence)).not.toContain("SourceMirror/vscode")
  })

  it("exposes a generic EditorPane shell contract without claiming full EditorPane ownership", () => {
    const contract = new EditorPartService().getGenericEditorPaneShellContract()

    expect(contract).toEqual(expect.objectContaining({
      owner: "EditorPartService",
      status: "partial",
      stateSource: "editorGroups",
      lowConflictAdapterPossible: true,
      noSecondWorkbenchState: true,
      runtimeReferenceToSourceMirror: false,
      requiresAppVueOrGenericShellRewriteForFullOwner: true,
      currentCodekSurfaces: expect.arrayContaining([
        "frontend/vite-project/src/workbench/editorGroups.ts",
        "frontend/vite-project/src/workbench/workbenchExplorerEditorService.ts",
        "frontend/vite-project/src/vscode-adapter/workbench/services/editor/common/editorPartService.ts",
      ]),
      vscodeEntrypoints: expect.arrayContaining([
        "src/vs/workbench/browser/parts/editor/editorPane.ts",
        "src/vs/workbench/browser/parts/editor/editorPart.ts",
        "src/vs/workbench/services/editor/common/editorService.ts",
        "src/vs/workbench/services/editor/browser/editorPaneService.ts",
        "src/vs/workbench/common/editor/editorInput.ts",
      ]),
      supports: expect.arrayContaining([
        "editorGroups-backed active editor summary",
        "WorkspaceTrustEditorInput-compatible resource tab via WorkbenchExplorerEditorService",
      ]),
      blockedOwners: expect.arrayContaining([
        "EditorPaneDescriptor registry",
        "IEditorService.openEditor(EditorInput)",
        "EditorPane createEditor(parent) DOM lifecycle",
      ]),
    }))
    expect(JSON.stringify(contract)).not.toContain("D:\\SourceMirror")
    expect(JSON.stringify(contract)).not.toContain("SourceMirror/vscode")
    expect(contract.reason).toContain("low-conflict state owner")
    expect(contract.reason).toContain("full VS Code EditorPane ownership still needs")
  })
})
