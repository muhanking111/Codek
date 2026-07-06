import { describe, expect, it, vi } from "vitest"
import { createExplorerItem, ExplorerModel } from "../model/ExplorerModel"
import { ExplorerDataSource } from "./ExplorerDataSource"
import { getExplorerSortOrderConfiguration } from "../../vscode-adapter/workbench/contrib/files/explorerSettings"
import { FileType } from "../../vscode-adapter/platform/files/common/files"

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

describe("ExplorerDataSource", () => {
  it("reads only requested directory children and caches loaded children", async () => {
    const calls: string[] = []
    const model = new ExplorerModel()
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true })
    const source = new ExplorerDataSource({
      roots: [root],
      model,
      heavyDirectories: new Set(["node_modules"]),
      readDir: async (uri) => {
        calls.push(uri)
        return [
          { name: "src", path: `${uri}/src`, isDir: true },
          { name: "package.json", path: `${uri}/package.json`, isFile: true, size: 100 },
        ]
      },
    })

    const first = await source.getChildren(root)
    const second = await source.getChildren(root)

    expect(calls).toEqual(["D:/repo"])
    expect(first).toBe(second)
    expect(first.map((item) => item.name)).toEqual(["src", "package.json"])
  })

  it("sorts explorer entries with VS Code numeric filename comparison", async () => {
    const model = new ExplorerModel()
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true })
    const source = new ExplorerDataSource({
      roots: [root],
      model,
      readDir: async (uri) => [
        { name: "file-10.ts", path: `${uri}/file-10.ts`, isFile: true },
        { name: "file-2.ts", path: `${uri}/file-2.ts`, isFile: true },
        { name: "src-10", path: `${uri}/src-10`, isDir: true },
        { name: "src-2", path: `${uri}/src-2`, isDir: true },
      ],
    })

    const children = await source.getChildren(root)

    expect(children.map((item) => item.name)).toEqual(["src-2", "src-10", "file-2.ts", "file-10.ts"])
  })

  it("allows node_modules expansion by default like VS Code", async () => {
    const calls: string[] = []
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true })
    const source = new ExplorerDataSource({
      roots: [root],
      model: new ExplorerModel(),
      readDir: async (uri) => {
        calls.push(uri)
        if (uri === "D:/repo") return [{ name: "node_modules", path: `${uri}/node_modules`, isDir: true }]
        return [{ name: "pkg", path: `${uri}/pkg`, isDir: true }]
      },
    })

    const [nodeModules] = await source.getChildren(root)
    const children = await source.getChildren(nodeModules)

    expect(nodeModules.ignored).toBe(false)
    expect(source.hasChildren(nodeModules)).toBe(true)
    expect(children.map((item) => item.name)).toEqual(["pkg"])
    expect(calls).toEqual(["D:/repo", "D:/repo/node_modules"])
  })

  it("consumes VS Code FileType entries from the Electron file service adapter", async () => {
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true })
    const source = new ExplorerDataSource({
      roots: [root],
      model: new ExplorerModel(),
      readDir: async (uri) => [
        { name: "src", path: `${uri}/src`, type: FileType.Directory, mtimeMs: 11 },
        { name: "linked-package", path: `${uri}/linked-package`, type: FileType.Directory | FileType.SymbolicLink, mtimeMs: 12 },
        { name: "README.md", path: `${uri}/README.md`, type: FileType.File, size: 42, mtimeMs: 13 },
      ],
    })

    const children = await source.getChildren(root)

    expect(children.map((item) => [item.name, item.isDirectory, item.size, item.mtime])).toEqual([
      ["linked-package", true, 0, 12],
      ["src", true, 0, 11],
      ["README.md", false, 42, 13],
    ])
    expect(source.hasChildren(children[0])).toBe(true)
  })

  it("keeps explicit heavy directories expandable while avoiding automatic prewarm", async () => {
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true })
    const source = new ExplorerDataSource({
      roots: [root],
      model: new ExplorerModel(),
      heavyDirectories: new Set(["node_modules"]),
      readDir: async (uri) => [
        { name: "node_modules", path: `${uri}/node_modules`, isDir: true },
      ],
    })

    const [nodeModules] = await source.getChildren(root)

    expect(nodeModules.ignored).toBe(false)
    expect(source.hasChildren(nodeModules)).toBe(true)
    expect(nodeModules.childrenLoaded).toBe(false)

    const children = await source.getChildren(nodeModules)
    expect(children.map((item) => item.name)).toEqual(["node_modules"])
  })

  it("disposes in-flight reads without mutating stale explorer items", async () => {
    const model = new ExplorerModel()
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true })
    model.setRoots([root])
    const deferred = createDeferred<Array<{ name: string; path: string; isFile: boolean }>>()
    const source = new ExplorerDataSource({
      roots: [root],
      model,
      readDir: async () => deferred.promise,
    })

    const loading = source.getChildren(root)

    expect(root.loading).toBe(true)

    source.dispose()

    expect(root.loading).toBe(false)

    deferred.resolve([{ name: "stale.ts", path: "D:/repo/stale.ts", isFile: true }])
    await loading

    expect(root.childrenLoaded).toBe(false)
    expect(root.children).toEqual([])
    expect(model.getItem("D:/repo/stale.ts")).toBeNull()
  })

  it("prewarms child directories with a bounded budget", async () => {
    const calls: string[] = []
    const model = new ExplorerModel()
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true })
    model.setRoots([root])
    const source = new ExplorerDataSource({
      roots: [root],
      model,
      heavyDirectories: new Set(["node_modules"]),
      readDir: async (uri) => {
        calls.push(uri)
        if (uri === "D:/repo") {
          return [
            { name: "src", path: "D:/repo/src", isDir: true },
            { name: "packages", path: "D:/repo/packages", isDir: true },
            { name: "node_modules", path: "D:/repo/node_modules", isDir: true },
          ]
        }
        return [
          { name: "nested", path: `${uri}/nested`, isDir: true },
          { name: "index.ts", path: `${uri}/index.ts`, isFile: true },
        ]
      },
    })

    await source.getChildren(root)
    await source.prewarmChildren(root.children, { maxDirectories: 2, maxDepth: 2, concurrency: 2 })

    expect(calls[0]).toBe("D:/repo")
    expect(calls.slice(1)).toHaveLength(2)
    expect(calls.slice(1)).not.toContain("D:/repo/node_modules")
    expect(model.getItem("D:/repo/node_modules")?.ignored).toBe(false)
    expect(model.getItem("D:/repo/node_modules")?.childrenLoaded).toBe(false)
    expect([model.getItem("D:/repo/src")?.childrenLoaded, model.getItem("D:/repo/packages")?.childrenLoaded].filter(Boolean)).toHaveLength(2)
    expect(model.getItem("D:/repo/src/nested")?.childrenLoaded ?? false).toBe(false)
  })

  it("limits concurrent directory reads across rapid expansion requests", async () => {
    const model = new ExplorerModel()
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true })
    const first = createExplorerItem({ uri: "D:/repo/first", name: "first", isDirectory: true, parent: root })
    const second = createExplorerItem({ uri: "D:/repo/second", name: "second", isDirectory: true, parent: root })
    const third = createExplorerItem({ uri: "D:/repo/third", name: "third", isDirectory: true, parent: root })
    model.setRoots([root])
    model.setChildren(root, [first, second, third])
    const activeReads: string[] = []
    let maxActiveReads = 0
    const readDir = vi.fn(async (uri: string) => {
      activeReads.push(uri)
      maxActiveReads = Math.max(maxActiveReads, activeReads.length)
      await new Promise((resolve) => setTimeout(resolve, 5))
      activeReads.splice(activeReads.indexOf(uri), 1)
      return [{ name: "index.ts", path: `${uri}/index.ts`, isFile: true }]
    })
    const source = new ExplorerDataSource({
      roots: [root],
      model,
      readDir,
      maxConcurrentReads: 1,
    })

    const reads = Promise.all([
      source.getChildren(first),
      source.getChildren(second),
      source.getChildren(third),
    ])

    await Promise.resolve()
    expect(readDir).toHaveBeenCalledTimes(1)
    expect(first.loading).toBe(true)
    expect(second.loading).toBe(true)
    expect(third.loading).toBe(true)

    await reads

    expect(readDir.mock.calls.map(([uri]) => uri)).toEqual([
      "D:/repo/first",
      "D:/repo/second",
      "D:/repo/third",
    ])
    expect(maxActiveReads).toBe(1)
    expect(first.loading).toBe(false)
    expect(second.loading).toBe(false)
    expect(third.loading).toBe(false)
  })

  it("notifies visible rows when loading starts and settles", async () => {
    const model = new ExplorerModel()
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true })
    model.setRoots([root])
    const read = createDeferred<Array<{ name: string; path: string; isFile: boolean }>>()
    const changed: Array<{ uri: string; loading: boolean }> = []
    const source = new ExplorerDataSource({
      roots: [root],
      model,
      readDir: async () => read.promise,
      onDidChangeItem: (item) => changed.push({ uri: item.uri, loading: item.loading }),
    })

    const request = source.getChildren(root)

    expect(changed).toEqual([{ uri: "D:/repo", loading: true }])

    read.resolve([{ name: "index.ts", path: "D:/repo/index.ts", isFile: true }])
    await request

    expect(changed).toEqual([
      { uri: "D:/repo", loading: true },
      { uri: "D:/repo", loading: false },
    ])
  })

  it("releases queued reads when the data source is disposed", async () => {
    const model = new ExplorerModel()
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true })
    const first = createExplorerItem({ uri: "D:/repo/first", name: "first", isDirectory: true, parent: root })
    const second = createExplorerItem({ uri: "D:/repo/second", name: "second", isDirectory: true, parent: root })
    model.setRoots([root])
    model.setChildren(root, [first, second])
    const firstRead = createDeferred<Array<{ name: string; path: string; isFile: boolean }>>()
    const source = new ExplorerDataSource({
      roots: [root],
      model,
      maxConcurrentReads: 1,
      readDir: async (uri) => {
        if (uri === "D:/repo/first") return firstRead.promise
        return [{ name: "index.ts", path: `${uri}/index.ts`, isFile: true }]
      },
    })

    const firstRequest = source.getChildren(first)
    const secondRequest = source.getChildren(second)
    await Promise.resolve()

    expect(first.loading).toBe(true)
    expect(second.loading).toBe(true)

    source.dispose()
    firstRead.resolve([{ name: "index.ts", path: "D:/repo/first/index.ts", isFile: true }])

    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([[], []])
    expect(first.loading).toBe(false)
    expect(second.loading).toBe(false)
    expect(model.getItem("D:/repo/second/index.ts")).toBeNull()
  })
  it("applies VS Code explorer sort settings to loaded children", async () => {
    const root = createExplorerItem({ uri: "D:/repo", name: "repo", isDirectory: true, isRoot: true })
    const model = new ExplorerModel()
    model.setRoots([root])
    const dataSource = new ExplorerDataSource({
      roots: [root],
      model,
      sortOrderConfiguration: getExplorerSortOrderConfiguration({ "explorer.sortOrder": "filesFirst" }),
      readDir: async () => [
        { name: "src", path: "D:/repo/src", isDirectory: true, mtime: 1 },
        { name: "a.ts", path: "D:/repo/a.ts", isDirectory: false, mtime: 2 },
      ],
    })

    const children = await dataSource.getChildren(root)

    expect(children.map((child) => child.name)).toEqual(["a.ts", "src"])
  })
})
