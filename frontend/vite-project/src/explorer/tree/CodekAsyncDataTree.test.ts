import { describe, expect, it, vi } from "vitest"
import { createExplorerItem, ExplorerModel } from "../model/ExplorerModel"
import type { ExplorerItem } from "../model/ExplorerModel"
import { CodekAsyncDataTree } from "./CodekAsyncDataTree"

describe("CodekAsyncDataTree", () => {
  it("expands one directory by reading only that node", async () => {
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true })
    const src = createExplorerItem({ uri: "D:/repo/src", name: "src", isDirectory: true, parent: root })
    const app = createExplorerItem({ uri: "D:/repo/src/App.ts", name: "App.ts", isDirectory: false, parent: src })
    const model = new ExplorerModel()
    const calls: string[] = []
    const tree = new CodekAsyncDataTree({
      model,
      dataSource: {
        hasChildren: (item) => item.isDirectory,
        getChildren: async (item) => {
          calls.push(item?.uri || "root")
          if (!item) return [root]
          if (item.uri === root.uri) return [src]
          if (item.uri === src.uri) return [app]
          return []
        },
      },
    })

    await tree.setInput([root])
    await tree.expand(root)
    await tree.expand(src)

    expect(calls).toEqual(["D:/repo", "D:/repo/src"])
    expect(tree.getFlatItems().map((item) => item.uri)).toEqual(["D:/repo", "D:/repo/src", "D:/repo/src/App.ts"])
  })

  it("collapses descendants with a local splice while keeping children cached", async () => {
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true })
    const src = createExplorerItem({ uri: "D:/repo/src", name: "src", isDirectory: true, parent: root })
    const app = createExplorerItem({ uri: "D:/repo/src/App.ts", name: "App.ts", isDirectory: false, parent: src })
    const tree = new CodekAsyncDataTree({
      model: new ExplorerModel(),
      dataSource: {
        hasChildren: (item) => item.isDirectory,
        getChildren: async (item) => item?.uri === root.uri ? [src] : item?.uri === src.uri ? [app] : [],
      },
    })

    await tree.setInput([root])
    await tree.expand(root)
    await tree.expand(src)
    tree.collapse(root)

    expect(tree.getFlatItems().map((item) => item.uri)).toEqual(["D:/repo"])
    expect(root.children).toEqual([src])
    expect(src.children).toEqual([app])
  })

  it("publishes loading expansion state before asynchronous children finish", async () => {
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true, expanded: true })
    const src = createExplorerItem({ uri: "D:/repo/src", name: "src", isDirectory: true, parent: root })
    root.children = [src]
    root.childrenLoaded = true
    const app = createExplorerItem({ uri: "D:/repo/src/App.ts", name: "App.ts", isDirectory: false, parent: src })
    let resolveChildren!: (children: ExplorerItem[]) => void
    const childrenPromise = new Promise<ExplorerItem[]>((resolve) => {
      resolveChildren = resolve
    })
    const published = [] as Array<{ uris: string[]; srcExpanded: boolean; srcLoading: boolean }>
    const tree = new CodekAsyncDataTree({
      model: new ExplorerModel(),
      dataSource: {
        hasChildren: (item) => item.isDirectory,
        getChildren: async (item) => {
          if (item?.uri !== src.uri) return item?.children || []
          src.loading = true
          const children = await childrenPromise
          src.loading = false
          return children
        },
      },
      onDidChangeFlatItems: (items) => {
        published.push({
          uris: items.map((item) => item.uri),
          srcExpanded: src.expanded,
          srcLoading: src.loading,
        })
      },
    })

    await tree.setInput([root])
    const expanding = tree.expand(src)

    expect(published.at(-1)).toEqual({
      uris: ["D:/repo", "D:/repo/src"],
      srcExpanded: true,
      srcLoading: true,
    })

    resolveChildren([app])
    await expanding

    expect(published.at(-1)).toEqual({
      uris: ["D:/repo", "D:/repo/src", "D:/repo/src/App.ts"],
      srcExpanded: true,
      srcLoading: false,
    })
  })

  it("publishes collapsed state even when a node has no visible descendants", async () => {
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true, expanded: true })
    const publish = vi.fn()
    const tree = new CodekAsyncDataTree({
      model: new ExplorerModel(),
      dataSource: {
        hasChildren: (item) => item.isDirectory,
        getChildren: async () => [],
      },
      onDidChangeFlatItems: publish,
    })

    await tree.setInput([root])
    publish.mockClear()
    tree.collapse(root)

    expect(root.expanded).toBe(false)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0][0].map((item: typeof root) => item.uri)).toEqual(["D:/repo"])
  })

  it("marks collapsed refreshed nodes stale without reading children", async () => {
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true })
    const getChildren = vi.fn(async () => [])
    const tree = new CodekAsyncDataTree({
      model: new ExplorerModel(),
      dataSource: { hasChildren: () => true, getChildren },
    })

    await tree.setInput([root])
    tree.refresh(root)

    expect(root.stale).toBe(true)
    expect(getChildren).not.toHaveBeenCalled()
  })

  it("reveals deep nodes by expanding the parent chain only when needed", async () => {
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true })
    const src = createExplorerItem({ uri: "D:/repo/src", name: "src", isDirectory: true, parent: root })
    const app = createExplorerItem({ uri: "D:/repo/src/App.ts", name: "App.ts", isDirectory: false, parent: src })
    const calls: string[] = []
    const tree = new CodekAsyncDataTree({
      model: new ExplorerModel(),
      dataSource: {
        hasChildren: (item) => item.isDirectory,
        getChildren: async (item) => {
          calls.push(item?.uri || "root")
          if (item?.uri === root.uri) return [src]
          if (item?.uri === src.uri) return [app]
          return []
        },
      },
    })

    await tree.setInput([root])
    await tree.reveal(app)

    expect(calls).toEqual(["D:/repo", "D:/repo/src"])
    expect(tree.getFlatItems().map((item) => item.uri)).toContain(app.uri)
  })

  it("restores expanded descendants in a single batched publish", async () => {
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true, expanded: true })
    const src = createExplorerItem({ uri: "D:/repo/src", name: "src", isDirectory: true, parent: root, expanded: true })
    const app = createExplorerItem({ uri: "D:/repo/src/App.ts", name: "App.ts", isDirectory: false, parent: src })
    root.children = [src]
    root.childrenLoaded = true
    src.children = [app]
    src.childrenLoaded = true
    const publish = vi.fn()
    const tree = new CodekAsyncDataTree({
      model: new ExplorerModel(),
      dataSource: {
        hasChildren: (item) => item.isDirectory,
        getChildren: async (item) => item?.children || [],
      },
      onDidChangeFlatItems: publish,
    })

    await tree.setInput([root])

    expect(tree.getFlatItems().map((item) => item.uri)).toEqual(["D:/repo", "D:/repo/src", "D:/repo/src/App.ts"])
    expect(publish.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it("sets input promptly and restores expanded roots without awaiting slow descendants", async () => {
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true, expanded: true })
    const src = createExplorerItem({ uri: "D:/repo/src", name: "src", isDirectory: true, parent: root, expanded: true })
    const app = createExplorerItem({ uri: "D:/repo/src/App.ts", name: "App.ts", isDirectory: false, parent: src })
    const slowChildren = new Promise<ExplorerItem[]>((resolve) => {
      setTimeout(() => resolve([app]), 20)
    })
    const tree = new CodekAsyncDataTree({
      model: new ExplorerModel(),
      dataSource: {
        hasChildren: (item) => item.isDirectory,
        getChildren: async (item) => {
          if (item?.uri === root.uri) return [src]
          if (item?.uri === src.uri) return slowChildren
          return []
        },
      },
    })

    const start = Date.now()
    await tree.setInput([root], { expandedUris: [root.uri, src.uri] })
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(15)
    expect(tree.getFlatItems().map((item) => item.uri)).toEqual(["D:/repo", "D:/repo/src"])

    await slowChildren
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(tree.getFlatItems().map((item) => item.uri)).toEqual(["D:/repo", "D:/repo/src", "D:/repo/src/App.ts"])
  })

  it("ignores expansion results after the tree input is replaced", async () => {
    const repoA = createExplorerItem({ uri: "D:/repoA", name: "repoA", isDirectory: true, isRoot: true, expanded: true })
    const repoB = createExplorerItem({ uri: "D:/repoB", name: "repoB", isDirectory: true, isRoot: true, expanded: true })
    const childA = createExplorerItem({ uri: "D:/repoA/src", name: "src", isDirectory: true, parent: repoA })
    const childB = createExplorerItem({ uri: "D:/repoB/app", name: "app", isDirectory: true, parent: repoB })
    let resolveRepoA!: (children: ExplorerItem[]) => void
    const repoAChildren = new Promise<ExplorerItem[]>((resolve) => {
      resolveRepoA = resolve
    })
    const tree = new CodekAsyncDataTree({
      model: new ExplorerModel(),
      dataSource: {
        hasChildren: (item) => item.isDirectory,
        getChildren: async (item) => {
          if (item?.uri === repoA.uri) return repoAChildren
          if (item?.uri === repoB.uri) return [childB]
          return []
        },
      },
    })

    const staleInput = tree.setInput([repoA], { expandedUris: [repoA.uri] })
    await Promise.resolve()
    await tree.setInput([repoB], { expandedUris: [repoB.uri] })
    resolveRepoA([childA])
    await repoAChildren
    await staleInput
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(tree.getFlatItems().map((item) => item.uri)).toEqual(["D:/repoB", "D:/repoB/app"])
  })
})
