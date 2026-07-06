import { describe, expect, it } from "vitest"
import { createExplorerItem, ExplorerModel } from "./ExplorerModel"

describe("ExplorerModel", () => {
  it("removes stale indexed descendants when replacing children", () => {
    const model = new ExplorerModel()
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true })
    const src = createExplorerItem({ uri: "D:/repo/src", name: "src", isDirectory: true, parent: root })
    const app = createExplorerItem({ uri: "D:/repo/src/App.ts", name: "App.ts", isDirectory: false, parent: src })
    model.setRoots([root])
    model.setChildren(root, [src])
    model.setChildren(src, [app])

    expect(model.getItem("D:/repo/src/App.ts")).toBe(app)

    const docs = createExplorerItem({ uri: "D:/repo/docs", name: "docs", isDirectory: true, parent: root })
    model.setChildren(root, [docs])

    expect(model.getItem("D:/repo/src")).toBeNull()
    expect(model.getItem("D:/repo/src/App.ts")).toBeNull()
    expect(model.getItem("D:/repo/docs")).toBe(docs)
  })

  it("renames an indexed item and rebases descendants like VS Code ExplorerItem.rename", () => {
    const model = new ExplorerModel()
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true })
    const src = createExplorerItem({ uri: "D:/repo/src", name: "src", isDirectory: true, parent: root })
    const app = createExplorerItem({ uri: "D:/repo/src/App.ts", name: "App.ts", isDirectory: false, parent: src })
    model.setRoots([root])
    model.setChildren(root, [src])
    model.setChildren(src, [app])
    model.expandedUris.add("D:/repo/src")
    model.setSelected(app)
    model.setFocused(app)

    model.renameItem(src, "D:/repo/source", "source")

    expect(model.getItem("D:/repo/src")).toBeNull()
    expect(model.getItem("D:/repo/src/App.ts")).toBeNull()
    expect(model.getItem("D:/repo/source")).toBe(src)
    expect(model.getItem("D:/repo/source/App.ts")).toBe(app)
    expect(app.uri).toBe("D:/repo/source/App.ts")
    expect(model.selectedUri).toBe("D:/repo/source/App.ts")
    expect(model.focusedUri).toBe("D:/repo/source/App.ts")
    expect([...model.expandedUris]).toContain("D:/repo/source")
  })
})
