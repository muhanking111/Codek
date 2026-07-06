import { describe, expect, it } from "vitest"
import {
  closeAllSavedTabs,
  closeOtherTabs,
  closeRightTabs,
  closeTab,
  onTabDrop,
  reopenClosedTab,
  togglePinTab,
  type TabLifecycleContext,
} from "./tabLifecycle"
import { WorkbenchExplorerEditorService } from "./workbenchExplorerEditorService"

function createContext(files = ["a.ts", "b.ts", "c.ts"], activeFile: string | null = files[files.length - 1] || null): TabLifecycleContext & { opened: string[]; activeFile: string | null } {
  const dirty = new Set<string>()
  const opened: string[] = []
  return {
    activeFile,
    workspace: {
      openFiles: [...files],
      closeFile(path: string) {
        this.openFiles = this.openFiles.filter((item) => item !== path)
      },
    },
    getOpenFiles() {
      return this.workspace.openFiles
    },
    getActiveFile() {
      return this.activeFile
    },
    setActiveFile(path: string | null) {
      this.activeFile = path
    },
    pinnedTabs: new Set<string>(),
    tabContextMenu: { visible: false, x: 0, y: 0, path: "" },
    unsavedDialog: { visible: false, path: "", resolve: null },
    dragState: { draggedTab: null },
    closedEditors: [],
    isDirty: (path: string) => dirty.has(path),
    saveFile: async (path: string) => {
      dirty.delete(path)
      return true
    },
    syncEditorFromWorkspace() {},
    setDragOverTab() {},
    openFile(path: string) {
      opened.push(path)
      if (!this.workspace.openFiles.includes(path)) this.workspace.openFiles.push(path)
      this.activeFile = path
    },
    opened,
  }
}

describe("tabLifecycle", () => {
  it("records closed editors and can reopen the latest closed tab", async () => {
    const context = createContext(["a.ts", "b.ts"])

    await closeTab("b.ts", context)
    expect(context.workspace.openFiles).toEqual(["a.ts"])
    expect(context.activeFile).toBe("a.ts")
    expect(context.closedEditors?.[0].path).toBe("b.ts")

    await reopenClosedTab(context)
    expect(context.workspace.openFiles).toEqual(["a.ts", "b.ts"])
    expect(context.activeFile).toBe("b.ts")
    expect(context.opened).toEqual(["b.ts"])
  })

  it("uses editor group rules for close other, close right, close saved, pin, and move", async () => {
    const context = createContext(["a.ts", "b.ts", "c.ts", "d.ts"])

    togglePinTab("b.ts", context)
    await closeOtherTabs("c.ts", context)
    expect(context.workspace.openFiles).toEqual(["b.ts", "c.ts"])
    expect(context.closedEditors?.map((editor) => editor.path)).toEqual(["a.ts", "d.ts"])

    context.workspace.openFiles.push("d.ts", "e.ts")
    togglePinTab("e.ts", context)
    await closeRightTabs("c.ts", context)
    expect(context.workspace.openFiles).toEqual(["b.ts", "c.ts", "e.ts"])
    expect(context.closedEditors?.map((editor) => editor.path)).toEqual(["d.ts", "a.ts", "d.ts"])

    closeAllSavedTabs(context)
    expect(context.workspace.openFiles).toEqual(["b.ts", "e.ts"])

    context.workspace.openFiles = ["a.ts", "b.ts", "c.ts"]
    context.dragState.draggedTab = "c.ts"
    onTabDrop("a.ts", context)
    expect(context.workspace.openFiles).toEqual(["c.ts", "a.ts", "b.ts"])
  })

  it("routes legacy tab helpers through the shared workbench explorer/editor service", async () => {
    const service = new WorkbenchExplorerEditorService()
    const context = createContext(["a.ts", "b.ts", "c.ts"])
    context.workbenchExplorerEditorService = service

    await closeTab("b.ts", context)

    expect(context.workspace.openFiles).toEqual(["a.ts", "c.ts"])
    expect(context.activeFile).toBe("c.ts")
    expect(service.getOpenEditorsModel()).toEqual(expect.objectContaining({
      source: "workbenchExplorerEditorService",
      activeEditor: "c.ts",
      totalEditors: 2,
      entries: [
        expect.objectContaining({ path: "a.ts" }),
        expect.objectContaining({ path: "c.ts" }),
      ],
    }))
    expect(service.getEditorGroupState().closedEditors[0].path).toBe("b.ts")
  })

  it("keeps activeFile projected from the service-backed editor group state", async () => {
    const service = new WorkbenchExplorerEditorService()
    const context = createContext(["a.ts", "b.ts", "c.ts"], "b.ts")
    context.workbenchExplorerEditorService = service

    await closeOtherTabs("c.ts", context)
    expect(context.workspace.openFiles).toEqual(["c.ts"])
    expect(context.activeFile).toBe("c.ts")
    expect(service.getOpenEditorsModel().activeEditor).toBe("c.ts")

    context.workspace.openFiles = ["a.ts", "b.ts", "c.ts"]
    context.activeFile = "b.ts"
    await closeRightTabs("a.ts", context)
    expect(context.workspace.openFiles).toEqual(["a.ts"])
    expect(context.activeFile).toBe("a.ts")
    expect(service.getOpenEditorsModel().activeEditor).toBe("a.ts")
  })
})
