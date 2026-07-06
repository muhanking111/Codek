import { describe, expect, it } from "vitest"
import {
  createEditorGroupPersistenceSnapshot,
  hydrateEditorGroupPersistenceSnapshot,
  normalizeSplitRatio,
} from "./editorGroupPersistenceModel"

describe("VS Code editor group persistence model adapter", () => {
  it("serializes editor group state with normalized split and capped closed history", () => {
    const snapshot = createEditorGroupPersistenceSnapshot({
      activeGroupId: "group_1",
      groups: [{
        id: "group_1",
        activeEditor: "src/a.ts",
        editors: [{ path: "src/a.ts", dirty: true }],
      }],
      closedEditors: Array.from({ length: 25 }, (_value, index) => ({ path: `closed-${index}.ts` })),
      split: { open: true, file: "src/a.ts", ratio: 99 },
    })

    expect(snapshot.closedEditors).toHaveLength(20)
    expect(snapshot.split).toEqual({ open: true, file: "src/a.ts", ratio: 80 })
    expect(snapshot.groups[0].editors[0]).toMatchObject({
      path: "src/a.ts",
      dirty: true,
      pinned: false,
      preview: false,
      permanent: false,
    })
  })

  it("hydrates only available editors and keeps active group/editor valid", () => {
    const snapshot = hydrateEditorGroupPersistenceSnapshot({
      version: 1,
      activeGroupId: "missing_group",
      groups: [
        {
          id: "group_1",
          activeEditor: "missing.ts",
          editors: [
            { path: "missing.ts" },
            { path: "src/a.ts", pinned: true },
          ],
        },
      ],
      closedEditors: [{ path: "src/a.ts" }, { path: "src/closed.ts" }, { path: "missing-closed.ts" }],
      split: { open: true, file: "missing.ts", ratio: 10 },
    }, {
      availableFiles: ["src/a.ts", "src/closed.ts"],
      maxClosedEditors: 5,
    })

    expect(snapshot).toMatchObject({
      activeGroupId: "group_1",
      groups: [{
        id: "group_1",
        activeEditor: "src/a.ts",
        editors: [expect.objectContaining({ path: "src/a.ts", pinned: true, permanent: true })],
      }],
      closedEditors: [expect.objectContaining({ path: "src/closed.ts", permanent: true, preview: false })],
      split: { open: false, file: null, ratio: 20 },
    })
  })

  it("rejects corrupt snapshots instead of hydrating partial state", () => {
    expect(hydrateEditorGroupPersistenceSnapshot({ version: 2, groups: [] })).toBeNull()
    expect(hydrateEditorGroupPersistenceSnapshot(null)).toBeNull()
  })

  it("normalizes split ratio to the editor group bounds", () => {
    expect(normalizeSplitRatio(5)).toBe(20)
    expect(normalizeSplitRatio(72.4)).toBe(72)
    expect(normalizeSplitRatio(99)).toBe(80)
    expect(normalizeSplitRatio("bad")).toBe(50)
  })
})