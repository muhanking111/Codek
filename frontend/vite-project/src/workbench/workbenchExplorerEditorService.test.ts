import { describe, expect, it, vi } from "vitest"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"
import { createExplorerItem, ExplorerModel } from "../explorer/model/ExplorerModel"
import {
  IWorkbenchExplorerEditorService,
  WorkbenchExplorerEditorService,
  globalWorkbenchExplorerEditorService,
} from "./workbenchExplorerEditorService"

describe("WorkbenchExplorerEditorService", () => {
  it("registers a VS Code-style service and binds the active ExplorerModel", () => {
    const service = new WorkbenchExplorerEditorService()
    const collection = new ServiceCollection([IWorkbenchExplorerEditorService, service])
    const events: string[] = []
    service.onDidChange((event) => events.push(event.kind))

    const model = new ExplorerModel()
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true })
    const src = createExplorerItem({ uri: "D:/repo/src", name: "src", isDirectory: true, parent: root })
    const disposable = service.bindExplorerModel(model)
    model.setRoots([root])
    model.setChildren(root, [src])
    model.setSelected(src)

    expect(collection.get(IWorkbenchExplorerEditorService)).toBe(service)
    expect(globalWorkbenchExplorerEditorService._serviceBrand).toBeUndefined()
    expect(service.getExplorerModel()).toBe(model)
    expect(service.getExplorerSnapshot()).toEqual(expect.objectContaining({
      source: "workbenchExplorerEditorService",
      rootCount: 1,
      itemCount: 2,
      expandedUris: [],
      selectedUri: "D:/repo/src",
      focusedUri: "",
      viewState: expect.objectContaining({ selectedUri: "D:/repo/src" }),
    }))
    expect(events).toEqual(["explorer", "explorer", "explorer", "explorer"])

    disposable.dispose()
    expect(service.getExplorerModel()).toBeNull()
  })

  it("owns editor group state and derives Open Editors from the same model", () => {
    const service = new WorkbenchExplorerEditorService()
    const state = service.replaceEditorGroupStateFromOpenFiles({
      openFiles: ["src/a.ts", "src/b.ts"],
      activeFile: "src/b.ts",
      pinnedTabs: new Set(["src/a.ts"]),
      dirtyFiles: (path) => path === "src/b.ts",
    })

    expect(service.getEditorGroupState()).toBe(state)
    expect(service.getOpenEditorsModel()).toEqual(expect.objectContaining({
      source: "workbenchExplorerEditorService",
      activeEditor: "src/b.ts",
      totalEditors: 2,
      dirtyCount: 1,
      pinnedCount: 1,
      entries: [
        expect.objectContaining({ path: "src/a.ts", label: "a.ts", pinned: true, active: false }),
        expect.objectContaining({ path: "src/b.ts", label: "b.ts", dirty: true, active: true }),
      ],
    }))

    service.openEditor("src/c.ts", { permanent: true })
    service.focusEditor("src/a.ts")
    service.closeEditor("src/c.ts")

    const openEditors = service.getOpenEditorsModel({ visibleEditors: 1 })
    expect(openEditors.activeEditor).toBe("src/a.ts")
    expect(openEditors.entries.map((entry) => entry.path)).toEqual(["src/a.ts", "src/b.ts"])
    expect(openEditors.overflow).toEqual({
      totalEditors: 2,
      visibleEditors: 1,
      overflowCount: 1,
      overflow: true,
    })
    expect(service.reopenClosedEditor()?.path).toBe("src/c.ts")
  })

  it("projects editor tab owner evidence without creating another tab state source", () => {
    const service = new WorkbenchExplorerEditorService()
    service.replaceEditorGroupStateFromOpenFiles({
      openFiles: ["src/a.ts", "untitled:scratch"],
      activeFile: "untitled:scratch",
      pinnedTabs: new Set(["src/a.ts"]),
    })

    const openEditors = service.getOpenEditorsModel({ visibleEditors: 1 })

    expect(openEditors.ownerEvidence).toEqual(expect.objectContaining({
      source: "editorGroups",
      editorGroupsOwner: "EditorPartService",
      editorTabsOwner: "WorkbenchExplorerEditorService.openEditorsModel",
      editorInputOwner: "resourceUriProjection",
      activeEditorSource: "editorGroups.activeGroup.activeEditor",
      groupStateSource: "editorGroups",
      resourceUriKind: "untitledUri",
      remainingEditorShellOwnerGap: true,
      noSecondEditorTabsStateSource: true,
      noDirectUserFileWrite: true,
      runtimeReferenceToSourceMirror: false,
    }))
    expect(openEditors.ownerEvidence.connectedOwners).toEqual([
      "EditorPartService",
      "WorkbenchExplorerEditorService",
    ])
    expect(openEditors.ownerEvidence.blockedOwners).toEqual(expect.arrayContaining([
      "EditorTabsControl DOM owner",
      "IEditorService.openEditor(EditorInput)",
      "App.vue/generic shell tab DOM owner",
    ]))
    expect(openEditors.entries.map((entry) => ({
      path: entry.path,
      source: entry.ownerEvidence.source,
      stateSource: entry.ownerEvidence.groupStateSource,
      resourceUriKind: entry.ownerEvidence.resourceUriKind,
    }))).toEqual([
      {
        path: "src/a.ts",
        source: "editorGroups",
        stateSource: "editorGroups",
        resourceUriKind: "relativePath",
      },
      {
        path: "untitled:scratch",
        source: "editorGroups",
        stateSource: "editorGroups",
        resourceUriKind: "untitledUri",
      },
    ])
    expect(openEditors.overflow).toEqual({
      totalEditors: 2,
      visibleEditors: 1,
      overflowCount: 1,
      overflow: true,
    })
    expect(JSON.stringify(openEditors.ownerEvidence)).not.toContain("D:\\SourceMirror")
    expect(JSON.stringify(openEditors.ownerEvidence)).not.toContain("SourceMirror/vscode")
  })

  it("derives Explorer working-tree visibility and file decorations from the bound models", () => {
    const service = new WorkbenchExplorerEditorService()
    const model = new ExplorerModel()
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true })
    const src = createExplorerItem({ uri: "D:/repo/src", name: "src", isDirectory: true, parent: root })
    const app = createExplorerItem({ uri: "D:/repo/src/App.ts", name: "App.ts", isDirectory: false, parent: src })
    const generated = createExplorerItem({ uri: "D:/repo/dist/generated.js", name: "generated.js", isDirectory: false, ignored: true })
    model.setRoots([root])
    model.setChildren(root, [src, generated])
    model.setChildren(src, [app])
    service.bindExplorerModel(model)
    service.replaceEditorGroupStateFromOpenFiles({
      openFiles: ["D:/repo/src/App.ts", "D:/repo/README.md"],
      activeFile: "D:/repo/src/App.ts",
      dirtyFiles: (path) => path.endsWith("App.ts"),
    })

    const snapshot = service.getExplorerSnapshot()

    expect(snapshot.visibleUris).toEqual([
      "D:/repo",
      "D:/repo/src",
      "D:/repo/src/App.ts",
      "D:/repo/dist/generated.js",
    ])
    expect(snapshot.workingTree).toEqual({
      visibleOpenUris: ["D:/repo/src/App.ts"],
      visibleDirtyUris: ["D:/repo/src/App.ts"],
      hiddenOpenUris: ["D:/repo/README.md"],
      openCount: 2,
      dirtyCount: 1,
    })
    expect(snapshot.decorations).toEqual({
      "D:/repo/src/App.ts": { label: "M", status: "modified", tooltip: "Modified working tree file" },
      "D:/repo/dist/generated.js": { label: "", status: "ignored", tooltip: "Ignored by workspace visibility rules" },
    })
  })

  it("keeps breadcrumbs in the service model instead of template-local state", () => {
    const service = new WorkbenchExplorerEditorService()
    service.replaceEditorGroupStateFromOpenFiles({ openFiles: ["src/App.vue"], activeFile: "src/App.vue" })

    service.updateBreadcrumbs({
      path: [{ name: "src", kind: "folder" }, { name: "App.vue", kind: "file" }],
      symbols: [{
        name: "setup",
        kind: "function",
        icon: "f",
        range: { startLine: 12 },
        children: [{ name: "child", kind: "method", icon: "m", range: { startLine: 18 } }],
      }],
      activeDropdown: 0,
    })

    expect(service.getBreadcrumbs()).toEqual(expect.objectContaining({
      source: "workbenchExplorerEditorService",
      activeEditor: "src/App.vue",
      pathCount: 2,
      symbolCount: 1,
      displayModel: expect.objectContaining({
        visible: true,
        elements: expect.arrayContaining([
          expect.objectContaining({ type: "symbol", label: "setup()", dropdownOpen: true }),
        ]),
      }),
    }))

    service.setActiveBreadcrumbDropdown(null)
    expect(service.getBreadcrumbs().displayModel.elements.find((element) => element.type === "symbol")?.dropdownOpen).toBe(false)

    service.clearBreadcrumbs()
    expect(service.getBreadcrumbs().displayModel.visible).toBe(false)
  })

  it("emits editor/open-editor changes and updates breadcrumb ownership when the active editor changes", () => {
    const service = new WorkbenchExplorerEditorService()
    const listener = vi.fn()
    service.onDidChange(listener)

    service.replaceEditorGroupStateFromOpenFiles({ openFiles: ["a.ts"] })
    service.openEditor("b.ts", { permanent: true })
    service.markDirty("b.ts", true)
    service.setSplitOpen(true, "b.ts", 60)

    expect(listener.mock.calls.map(([event]) => event.kind)).toEqual([
      "breadcrumbs",
      "editorGroups",
      "openEditors",
      "breadcrumbs",
      "editorGroups",
      "openEditors",
      "editorGroups",
      "openEditors",
      "editorGroups",
      "openEditors",
    ])
  })

})
