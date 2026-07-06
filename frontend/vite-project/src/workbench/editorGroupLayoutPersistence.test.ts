import { describe, expect, it } from "vitest"
import {
  editorGroupsStorageKey,
  persistEditorGroupLayout,
  restoreEditorGroupLayout,
  type StorageLike,
} from "./editorGroupLayoutPersistence"

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike & { values: Record<string, string> } {
  const values = { ...initial }
  return {
    values,
    getItem(key) {
      return values[key] ?? null
    },
    setItem(key, value) {
      values[key] = value
    },
    removeItem(key) {
      delete values[key]
    },
  }
}

describe("editorGroupLayoutPersistence", () => {
  it("uses project-scoped normalized storage keys", () => {
    expect(editorGroupsStorageKey("D:\\Workspace\\demo")).toBe("codek.editorGroups.v1:D:/Workspace/demo")
    expect(editorGroupsStorageKey("")).toBeNull()
  })

  it("persists pinned, dirty, closed editor, active editor, and split layout state", () => {
    const storage = createMemoryStorage()
    const persisted = persistEditorGroupLayout({
      projectRoot: "D:\\repo",
      storage,
      openFiles: ["src/a.ts", "src/b.ts"],
      activeFile: "src/b.ts",
      pinnedTabs: new Set(["src/a.ts"]),
      dirtyFiles: (path) => path === "src/b.ts",
      closedEditors: [{ path: "src/closed.ts", dirty: false, pinned: false, preview: false, permanent: true }],
      split: { open: true, file: "src/b.ts", ratio: 70 },
    })

    expect(persisted).toBe(true)
    const snapshot = JSON.parse(storage.values["codek.editorGroups.v1:D:/repo"])
    expect(snapshot.groups[0].activeEditor).toBe("src/b.ts")
    expect(snapshot.groups[0].editors).toEqual([
      expect.objectContaining({ path: "src/a.ts", pinned: true }),
      expect.objectContaining({ path: "src/b.ts", dirty: true }),
    ])
    expect(snapshot.closedEditors).toEqual([expect.objectContaining({ path: "src/closed.ts" })])
    expect(snapshot.split).toEqual({ open: true, file: "src/b.ts", ratio: 70 })
  })

  it("does not persist while hydrating or without a storage/root", () => {
    const storage = createMemoryStorage()
    const baseInput = {
      projectRoot: "D:\\repo",
      storage,
      openFiles: ["a.ts"],
      activeFile: "a.ts",
      split: { open: false, file: null, ratio: 50 },
    }

    expect(persistEditorGroupLayout({ ...baseInput, isHydrating: true })).toBe(false)
    expect(persistEditorGroupLayout({ ...baseInput, storage: undefined })).toBe(false)
    expect(persistEditorGroupLayout({ ...baseInput, projectRoot: "" })).toBe(false)
    expect(storage.values).toEqual({})
  })

  it("restores stale-filtered layout into workspace-facing state and lazy-loads active content", async () => {
    const storage = createMemoryStorage()
    persistEditorGroupLayout({
      projectRoot: "D:\\repo",
      storage,
      openFiles: ["src/a.ts", "src/b.ts", "missing.ts"],
      activeFile: "src/b.ts",
      pinnedTabs: new Set(["src/a.ts"]),
      closedEditors: [{ path: "src/closed.ts", dirty: false, pinned: false, preview: false, permanent: true }],
      split: { open: true, file: "src/b.ts", ratio: 65 },
    })

    const pinnedTabs = new Set<string>()
    const closedEditors: any[] = []
    const openFiles = new Set<string>()
    let activeFile: string | null = null
    let restoredPaths: string[] = []
    let restoredActive: string | null = null
    let ensuredPath: string | null = null
    let splitOpen = false
    let splitFile: string | null = null
    let splitRatio = 0
    let replacedActiveEditor: string | null = null

    const result = await restoreEditorGroupLayout({
      projectRoot: "D:\\repo",
      storage,
      availableFiles: ["src/a.ts", "src/b.ts", "src/closed.ts"],
      restoreOpenFiles(paths, activePath) {
        restoredPaths = paths
        restoredActive = activePath
        for (const path of paths) openFiles.add(path)
      },
      setActiveFile(path) {
        activeFile = path
      },
      isOpenFile(path) {
        return openFiles.has(path)
      },
      pinnedTabs,
      closedEditors,
      setSplitOpen(value) {
        splitOpen = value
      },
      setSplitFile(value) {
        splitFile = value
      },
      setSplitRatio(value) {
        splitRatio = value
      },
      shouldEnsureActiveFileLoaded: (path) => path === "src/b.ts",
      ensureActiveFileLoaded(path) {
        ensuredPath = path
      },
      replaceEditorGroupState(state) {
        replacedActiveEditor = state.groups.find((group) => group.id === state.activeGroupId)?.activeEditor || null
      },
    })

    expect(result).toEqual({ restored: true })
    expect(restoredPaths).toEqual(["src/a.ts", "src/b.ts"])
    expect(restoredActive).toBe("src/b.ts")
    expect(activeFile).toBe("src/b.ts")
    expect(Array.from(pinnedTabs)).toEqual(["src/a.ts"])
    expect(closedEditors).toEqual([expect.objectContaining({ path: "src/closed.ts" })])
    expect(splitOpen).toBe(true)
    expect(splitFile).toBe("src/b.ts")
    expect(splitRatio).toBe(65)
    expect(ensuredPath).toBe("src/b.ts")
    expect(replacedActiveEditor).toBe("src/b.ts")
  })

  it("restores the persisted active group instead of always replaying the first group", async () => {
    const storage = createMemoryStorage({
      "codek.editorGroups.v1:D:/repo": JSON.stringify({
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
      }),
    })

    let restoredPaths: string[] = []
    let restoredActive: string | null = null
    let activeFile: string | null = null

    const result = await restoreEditorGroupLayout({
      projectRoot: "D:\\repo",
      storage,
      availableFiles: ["src/a.ts", "src/b.ts"],
      restoreOpenFiles(paths, activePath) {
        restoredPaths = paths
        restoredActive = activePath
      },
      setActiveFile(path) {
        activeFile = path
      },
      isOpenFile(path) {
        return path === "src/b.ts"
      },
      setSplitOpen: () => {},
      setSplitFile: () => {},
      setSplitRatio: () => {},
    })

    expect(result).toEqual({ restored: true })
    expect(restoredPaths).toEqual(["src/b.ts"])
    expect(restoredActive).toBe("src/b.ts")
    expect(activeFile).toBe("src/b.ts")
  })

  it("removes corrupt snapshots instead of throwing", async () => {
    const storage = createMemoryStorage({
      "codek.editorGroups.v1:D:/repo": "{bad-json",
    })

    await expect(restoreEditorGroupLayout({
      projectRoot: "D:\\repo",
      storage,
      restoreOpenFiles: () => {},
      isOpenFile: () => false,
      setSplitOpen: () => {},
      setSplitFile: () => {},
      setSplitRatio: () => {},
    })).resolves.toEqual({ restored: false, reason: "corrupt-snapshot" })
    expect(storage.values).toEqual({})
  })
})
