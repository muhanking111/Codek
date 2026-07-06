import { describe, expect, it } from "vitest"
import {
  applyEditorGroupStateToOpenFiles,
  buildEditorGroupStateFromOpenFiles,
  hydrateEditorGroupState,
  reviveSerializedEditorGroupState,
  serializeEditorGroupState,
} from "./editorGroupPersistence"

describe("editorGroupPersistence", () => {
  it("serializes and hydrates editor groups, closed editors, pinned state, and split state", () => {
    const state = buildEditorGroupStateFromOpenFiles({
      openFiles: ["src/a.ts", "src/b.ts"],
      activeFile: "src/b.ts",
      pinnedTabs: new Set(["src/a.ts"]),
      dirtyFiles: (path) => path === "src/b.ts",
      closedEditors: [{ path: "src/closed.ts", dirty: false, pinned: false, preview: false, permanent: true }],
      split: { open: true, file: "src/b.ts", ratio: 72 },
    })

    const snapshot = serializeEditorGroupState(state)
    const hydrated = hydrateEditorGroupState(snapshot, {
      availableFiles: ["src/a.ts", "src/b.ts", "src/closed.ts"],
    })

    expect(hydrated.groups[0].activeEditor).toBe("src/b.ts")
    expect(hydrated.groups[0].editors).toEqual([
      expect.objectContaining({ path: "src/a.ts", pinned: true, permanent: true }),
      expect.objectContaining({ path: "src/b.ts", dirty: true, permanent: true }),
    ])
    expect(hydrated.closedEditors).toEqual([expect.objectContaining({ path: "src/closed.ts" })])
    expect(hydrated.split).toEqual({ open: true, file: "src/b.ts", ratio: 72 })
  })

  it("filters stale editors and disables split when the split file is unavailable", () => {
    const hydrated = hydrateEditorGroupState({
      version: 1,
      activeGroupId: "group_1",
      groups: [{
        id: "group_1",
        activeEditor: "missing.ts",
        editors: [
          { path: "src/a.ts", pinned: true },
          { path: "missing.ts", pinned: false },
        ],
      }],
      closedEditors: [{ path: "closed-missing.ts" }, { path: "src/closed.ts" }],
      split: { open: true, file: "missing.ts", ratio: 99 },
    }, {
      availableFiles: ["src/a.ts", "src/closed.ts"],
    })

    expect(hydrated.groups[0].editors.map((editor) => editor.path)).toEqual(["src/a.ts"])
    expect(hydrated.groups[0].activeEditor).toBe("src/a.ts")
    expect(hydrated.closedEditors.map((editor) => editor.path)).toEqual(["src/closed.ts"])
    expect(hydrated.split).toEqual({ open: false, file: null, ratio: 80 })
  })

  it("hydrates the persisted active group instead of always collapsing to the first group", () => {
    const hydrated = hydrateEditorGroupState({
      version: 1,
      activeGroupId: "group_2",
      groups: [
        {
          id: "group_1",
          activeEditor: "src/a.ts",
          editors: [{ path: "src/a.ts", pinned: true }],
        },
        {
          id: "group_2",
          activeEditor: "src/b.ts",
          editors: [{ path: "src/b.ts", dirty: true }],
        },
      ],
      closedEditors: [],
      split: { open: false, file: null, ratio: 50 },
    }, {
      availableFiles: ["src/a.ts", "src/b.ts"],
    })

    expect(hydrated.activeGroupId).toBe("group_2")
    expect(hydrated.groups[0].id).toBe("group_2")
    expect(hydrated.groups[0].activeEditor).toBe("src/b.ts")
    expect(hydrated.groups[0].editors).toEqual([
      expect.objectContaining({ path: "src/b.ts", dirty: true }),
    ])
  })

  it("falls back safely for corrupt serialized state", () => {
    expect(reviveSerializedEditorGroupState("{not-json").groups[0].editors).toEqual([])
    expect(hydrateEditorGroupState({ version: 99 }).groups[0].editors).toEqual([])
  })

  it("applies hydrated state back to workspace-facing tab collections", () => {
    const state = buildEditorGroupStateFromOpenFiles({
      openFiles: ["a.ts", "b.ts"],
      activeFile: "b.ts",
      pinnedTabs: new Set(["a.ts"]),
      closedEditors: [{ path: "closed.ts", dirty: false, pinned: false, preview: false, permanent: true }],
    })
    const pinnedTabs = new Set<string>()
    const closedEditors: any[] = []
    let openFiles: string[] = []
    let activeFile: string | null = null

    applyEditorGroupStateToOpenFiles(state, {
      setOpenFiles(paths) {
        openFiles = paths
      },
      setActiveFile(path) {
        activeFile = path
      },
      pinnedTabs,
      closedEditors,
    })

    expect(openFiles).toEqual(["a.ts", "b.ts"])
    expect(activeFile).toBe("b.ts")
    expect(Array.from(pinnedTabs)).toEqual(["a.ts"])
    expect(closedEditors).toEqual([expect.objectContaining({ path: "closed.ts" })])
  })
})
