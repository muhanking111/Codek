import { describe, expect, it, vi } from "vitest"
import { ExplorerTreeHost } from "./ExplorerTreeHost"
import type { ExplorerRawEntry } from "./ExplorerDataSource"
import { Emitter } from "../../vscode-adapter/base/common/event"
import { URI } from "../../vscode-adapter/base/common/uri"
import {
  FileChangeType,
  FileChangesEvent,
  FileOperation,
  FileOperationEvent,
  FileType,
  type FileChangesEvent as FileChangesEventType,
  type FileOperationEvent as FileOperationEventType,
  type IFileStatWithMetadata,
} from "../../vscode-adapter/platform/files/common/files"

function makeContainer(height = 480): HTMLElement {
  const container = document.createElement("div")
  Object.defineProperty(container, "clientHeight", { value: height, configurable: true })
  return container
}

function createReadDir(entries: Record<string, ExplorerRawEntry[]>) {
  return vi.fn(async (uri: string) => entries[uri] || [])
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

async function waitForRow(container: HTMLElement, uri: string): Promise<Element | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const row = container.querySelector(`[data-uri='${uri}']`)
    if (row) return row
    await Promise.resolve()
  }
  return null
}

async function waitForCondition(predicate: () => boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return true
    await Promise.resolve()
  }
  return predicate()
}

describe("ExplorerTreeHost", () => {
  it("renders native filesystem rows without Vue TreeNode components", async () => {
    const container = makeContainer()
    const readDir = createReadDir({
      "D:/repo": [{ name: "src", path: "D:/repo/src", isDirectory: true }],
      "D:/repo/src": Array.from({ length: 1000 }, (_, index) => ({
        name: `file-${index}.ts`,
        path: `D:/repo/src/file-${index}.ts`,
        isFile: true,
      })),
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({
      projectRoot: "D:/repo",
      workspaceRoots: ["D:/repo"],
      workspaceScaleProfile: { scale: "normal" },
    })
    await host.expandPath("D:/repo/src")

    expect(readDir.mock.calls.map(([uri]) => uri)).toEqual(["D:/repo", "D:/repo/src"])
    expect(container.querySelectorAll("[data-codek-explorer-row]").length).toBeLessThanOrEqual(120)
    expect(container.querySelector("tree-node")).toBeNull()

    host.dispose()
  })

  it("projects the Explorer list as a reusable partial IListService and WorkbenchObjectTree owner", async () => {
    const container = makeContainer()
    const readDir = createReadDir({
      "D:/repo": [
        { name: "src", path: "D:/repo/src", isDirectory: true },
        { name: "README.md", path: "D:/repo/README.md", isFile: true },
      ],
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    const widget = container.querySelector(".codek-list-view") as HTMLElement
    widget.focus()
    widget.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    const projection = host.getWorkbenchObjectTreeOwnerProjection()

    expect(projection).toEqual(expect.objectContaining({
      source: "codek.explorerWorkbenchObjectTreeOwner",
      status: "partial",
      noSecondState: true,
      runtimeReferenceToSourceMirror: false,
      vscodeSourcePaths: expect.arrayContaining([
        "src/vs/platform/list/browser/listService.ts",
        "src/vs/base/browser/ui/tree/objectTree.ts",
      ]),
      currentSourcePaths: expect.arrayContaining([
        "frontend/vite-project/src/vscode-adapter/platform/list/browser/listService.ts",
        "frontend/vite-project/src/explorer/tree/CodekListView.ts",
      ]),
      implementedOwners: expect.arrayContaining([
        "IListService lastFocusedList registry",
        "WorkbenchListWidget getHTMLElement/onDidFocus/onDidDispose contract",
      ]),
      missingOwners: expect.arrayContaining([
        "generic ObjectTree factory for TestingObjectTree/SettingsTree",
      ]),
    }))
    expect(projection.widget).toEqual(expect.objectContaining({
      role: "tree",
      ariaLabel: "Files Explorer",
      tabIndex: 0,
      rowCount: 3,
      isLastFocusedList: true,
    }))
    expect(host.getListOwnerSnapshot()).toMatchObject({
      serviceId: "listService",
      ownerId: "objectTreeList",
      widgetKind: "objectTree",
      reusableByWorkbenchTrees: true,
      modelBacked: true,
      noSecondState: true,
      factoryEvidence: "ExplorerTreeHost creates a reusable WorkbenchObjectTree owner through CodekListView + IListService",
      capabilities: {
        selection: {
          modelBacked: true,
          noSecondState: true,
          stateSource: "ExplorerModel.selectedUri/focusedUri + CodekAsyncDataTree flat item model",
        },
      },
    })

    host.dispose()
  })

  it("keeps all entries returned by explorer reads instead of injecting a 2000 item limit row", async () => {
    const container = makeContainer(480)
    const largeChildren = Array.from({ length: 3000 }, (_, index) => ({
      name: `file-${String(index).padStart(4, "0")}.ts`,
      path: `D:/repo/huge/file-${String(index).padStart(4, "0")}.ts`,
      isFile: true,
    }))
    const readDir = createReadDir({
      "D:/repo": [{ name: "huge", path: "D:/repo/huge", isDirectory: true }],
      "D:/repo/huge": largeChildren,
    })
    const host = new ExplorerTreeHost({ container, readDir, rowHeight: 24 })

    await host.update({
      projectRoot: "D:/repo",
      workspaceRoots: ["D:/repo"],
      workspaceScaleProfile: { scale: "huge", pending: false },
    })
    await host.expandPath("D:/repo/huge")

    const uris = host.getFlatItems().map((item) => item.uri)
    expect(uris).toContain("D:/repo/huge/file-2999.ts")
    expect(uris).not.toContain("D:/repo/huge/__codek_dir_entry_limit__")
    expect(readDir.mock.calls.map(([uri]) => uri)).toEqual(["D:/repo", "D:/repo/huge"])

    host.dispose()
  })

  it("does not skip VS Code heavy directory names by default in the user-facing explorer", async () => {
    const container = makeContainer()
    const readDir = createReadDir({
      "D:/repo": [
        { name: ".git", path: "D:/repo/.git", isDirectory: true },
        { name: "dist", path: "D:/repo/dist", isDirectory: true },
        { name: "build", path: "D:/repo/build", isDirectory: true },
      ],
      "D:/repo/.git": [{ name: "HEAD", path: "D:/repo/.git/HEAD", isFile: true }],
      "D:/repo/dist": [{ name: "bundle.js", path: "D:/repo/dist/bundle.js", isFile: true }],
      "D:/repo/build": [{ name: "artifact.txt", path: "D:/repo/build/artifact.txt", isFile: true }],
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.expandPath("D:/repo/.git")
    await host.expandPath("D:/repo/dist")
    await host.expandPath("D:/repo/build")

    expect(host.model.getItem("D:/repo/.git")?.ignored).toBe(false)
    expect(host.model.getItem("D:/repo/dist")?.ignored).toBe(false)
    expect(host.model.getItem("D:/repo/build")?.ignored).toBe(false)
    expect(host.getFlatItems().map((item) => item.uri)).toEqual([
      "D:/repo",
      "D:/repo/.git",
      "D:/repo/.git/HEAD",
      "D:/repo/build",
      "D:/repo/build/artifact.txt",
      "D:/repo/dist",
      "D:/repo/dist/bundle.js",
    ])

    host.dispose()
  })

  it("keeps native explorer dirty indicators on SCM decorations instead of dirty file state", async () => {
    const container = makeContainer()
    const readDir = createReadDir({
      "D:/repo": [{ name: "App.ts", path: "D:/repo/App.ts", isFile: true }],
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update(({
      projectRoot: "D:/repo",
      workspaceRoots: ["D:/repo"],
      dirtyFiles: { "D:/repo/App.ts": true },
      externalChanges: { "D:/repo/App.ts": true },
    }) as Parameters<ExplorerTreeHost["update"]>[0])

    const row = await waitForRow(container, "D:/repo/App.ts")
    expect(row?.querySelector(".codek-explorer-decoration")?.textContent).toBe("")

    await host.update(({
      dirtyFiles: { "D:/repo/App.ts": false },
      externalChanges: { "D:/repo/App.ts": false },
      gitDecorations: { "D:/repo/App.ts": { label: "M", tooltip: "Git: 修改" } },
    }) as Parameters<ExplorerTreeHost["update"]>[0])

    expect(row?.querySelector(".codek-explorer-decoration")?.textContent).toBe("M")
    expect(row?.querySelector(".codek-explorer-decoration")?.getAttribute("title")).toBe("Git: 修改")

    host.dispose()
  })

  it("delegates selection, file open, and context menu through native rows", async () => {
    const container = makeContainer()
    const openFile = vi.fn()
    const selectDir = vi.fn()
    const contextMenu = vi.fn()
    const readDir = createReadDir({
      "D:/repo": [
        { name: "src", path: "D:/repo/src", isDirectory: true },
        { name: "README.md", path: "D:/repo/README.md", isFile: true },
      ],
      "D:/repo/src": [{ name: "App.ts", path: "D:/repo/src/App.ts", isFile: true }],
    })
    const host = new ExplorerTreeHost({
      container,
      readDir,
      onOpenFile: openFile,
      onSelectDir: selectDir,
      onContextMenu: contextMenu,
    })

    await host.update({
      projectRoot: "D:/repo",
      workspaceRoots: ["D:/repo"],
      workspaceScaleProfile: { scale: "normal" },
    })

    const srcRow = container.querySelector("[data-uri='D:/repo/src']")
    srcRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()

    expect(selectDir).toHaveBeenCalledWith("D:/repo/src")
    expect(readDir.mock.calls.map(([uri]) => uri)).toEqual(["D:/repo", "D:/repo/src"])

    const appRow = await waitForRow(container, "D:/repo/src/App.ts")
    appRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    expect(openFile).toHaveBeenCalledWith("D:/repo/src/App.ts")

    appRow?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))

    expect(contextMenu).toHaveBeenCalled()

    host.dispose()
  })

  it("uses focused explorer item for keyboard open instead of the first rendered row", async () => {
    const container = makeContainer()
    const openFile = vi.fn()
    const readDir = createReadDir({
      "D:/repo": [
        { name: "src", path: "D:/repo/src", isDirectory: true },
        { name: "README.md", path: "D:/repo/README.md", isFile: true },
      ],
    })
    const host = new ExplorerTreeHost({ container, readDir, onOpenFile: openFile })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })

    container.querySelector("[data-uri='D:/repo/README.md']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    openFile.mockClear()
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))

    expect(openFile).toHaveBeenCalledWith("D:/repo/README.md")
    expect(openFile).not.toHaveBeenCalledWith("D:/repo")

    host.dispose()
  })

  it("supports VS Code style explorer keyboard focus navigation", async () => {
    const container = makeContainer(72)
    const openFile = vi.fn()
    const readDir = createReadDir({
      "D:/repo": [
        { name: "a.ts", path: "D:/repo/a.ts", isFile: true },
        { name: "b.ts", path: "D:/repo/b.ts", isFile: true },
        { name: "c.ts", path: "D:/repo/c.ts", isFile: true },
      ],
    })
    const host = new ExplorerTreeHost({ container, readDir, onOpenFile: openFile })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })

    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))

    expect(openFile).toHaveBeenCalledWith("D:/repo/c.ts")

    openFile.mockClear()
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }))
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))

    expect(openFile).toHaveBeenCalledWith("D:/repo/a.ts")

    host.dispose()
  })

  it("projects VS Code style tree role and active descendant from the focused row", async () => {
    const container = makeContainer()
    const readDir = createReadDir({
      "D:/repo": [
        { name: "src", path: "D:/repo/src", isDirectory: true },
        { name: "README.md", path: "D:/repo/README.md", isFile: true },
      ],
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })

    const tree = container.querySelector(".codek-list-view") as HTMLElement | null
    const rootRow = container.querySelector("[data-uri='D:/repo']") as HTMLElement | null
    expect(tree?.getAttribute("role")).toBe("tree")
    expect(tree?.getAttribute("aria-label")).toBe("Files Explorer")
    expect(tree?.getAttribute("aria-activedescendant")).toBe(rootRow?.id)

    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    const srcRow = container.querySelector("[data-uri='D:/repo/src']") as HTMLElement | null

    expect(srcRow?.id).toBeTruthy()
    expect(tree?.getAttribute("aria-activedescendant")).toBe(srcRow?.id)
    expect(srcRow?.getAttribute("aria-selected")).toBe("true")

    host.dispose()
  })

  it("matches VS Code tree Left Right and Space expansion semantics", async () => {
    const container = makeContainer()
    const readDir = createReadDir({
      "D:/repo": [
        { name: "src", path: "D:/repo/src", isDirectory: true },
        { name: "README.md", path: "D:/repo/README.md", isFile: true },
      ],
      "D:/repo/src": [{ name: "App.ts", path: "D:/repo/src/App.ts", isFile: true }],
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })

    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    const appRow = await waitForRow(container, "D:/repo/src/App.ts") as HTMLElement | null
    const srcRow = container.querySelector("[data-uri='D:/repo/src']") as HTMLElement | null
    const tree = container.querySelector(".codek-list-view") as HTMLElement | null

    expect(srcRow?.getAttribute("aria-expanded")).toBe("true")
    expect(tree?.getAttribute("aria-activedescendant")).toBe(srcRow?.id)
    expect(await waitForCondition(() => srcRow?.classList.contains("loading") === false)).toBe(true)

    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    expect(tree?.getAttribute("aria-activedescendant")).toBe(appRow?.id)
    expect(appRow?.getAttribute("aria-selected")).toBe("true")

    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
    expect(tree?.getAttribute("aria-activedescendant")).toBe(srcRow?.id)

    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
    expect(srcRow?.getAttribute("aria-expanded")).toBe("false")

    container.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))
    expect(srcRow?.getAttribute("aria-expanded")).toBe("true")

    host.dispose()
  })

  it("shows folder expansion state immediately and keeps first-click expansion through selection updates", async () => {
    const container = makeContainer()
    const devcontainerEntries = createDeferred<ExplorerRawEntry[]>()
    let host: ExplorerTreeHost
    const readDir = vi.fn((uri: string) => {
      if (uri === "D:/repo") {
        return Promise.resolve([{ name: ".devcontainer", path: "D:/repo/.devcontainer", isDirectory: true }])
      }
      if (uri === "D:/repo/.devcontainer") return devcontainerEntries.promise
      return Promise.resolve([])
    })
    host = new ExplorerTreeHost({
      container,
      readDir,
      onSelectDir: (path) => {
        void host.update({
          projectRoot: "D:/repo",
          workspaceRoots: ["D:/repo"],
          selectedPath: path,
          selectedKind: "dir",
        })
      },
    })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })

    const folderRow = container.querySelector("[data-uri='D:/repo/.devcontainer']") as HTMLElement | null
    expect(folderRow).toBeTruthy()

    folderRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    expect(folderRow?.classList.contains("expanded")).toBe(true)
    expect(folderRow?.classList.contains("loading")).toBe(true)

    devcontainerEntries.resolve([
      { name: "devcontainer.json", path: "D:/repo/.devcontainer/devcontainer.json", isFile: true },
    ])

    expect(await waitForRow(container, "D:/repo/.devcontainer/devcontainer.json")).toBeTruthy()
    expect(host.model.getItem("D:/repo/.devcontainer")?.expanded).toBe(true)

    host.dispose()
  })

  it("starts directory expansion before emitting selection updates", async () => {
    const container = makeContainer()
    const events: string[] = []
    const srcEntries = createDeferred<ExplorerRawEntry[]>()
    let host: ExplorerTreeHost
    const readDir = vi.fn((uri: string) => {
      if (uri === "D:/repo") {
        return Promise.resolve([{ name: "src", path: "D:/repo/src", isDirectory: true }])
      }
      if (uri === "D:/repo/src") {
        events.push("expand-read")
        return srcEntries.promise
      }
      return Promise.resolve([])
    })
    host = new ExplorerTreeHost({
      container,
      readDir,
      onSelectDir: (path) => {
        events.push(`select:${path}`)
        void host.update({
          projectRoot: "D:/repo",
          workspaceRoots: ["D:/repo"],
          selectedPath: path,
          selectedKind: "dir",
          workspaceScaleProfile: { scale: "normal" },
        })
      },
    })

    await host.update({
      projectRoot: "D:/repo",
      workspaceRoots: ["D:/repo"],
      workspaceScaleProfile: { scale: "normal" },
    })

    const srcRow = container.querySelector("[data-uri='D:/repo/src']") as HTMLElement | null
    srcRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    expect(events).toEqual(["expand-read", "select:D:/repo/src"])
    expect(host.model.getItem("D:/repo/src")?.expanded).toBe(true)

    srcEntries.resolve([{ name: "index.ts", path: "D:/repo/src/index.ts", isFile: true }])
    expect(await waitForRow(container, "D:/repo/src/index.ts")).toBeTruthy()

    host.dispose()
  })

  it("does not collapse a folder when it is clicked again while its first expansion is still loading", async () => {
    const container = makeContainer()
    const srcEntries = createDeferred<ExplorerRawEntry[]>()
    const readDir = vi.fn((uri: string) => {
      if (uri === "D:/repo") {
        return Promise.resolve([{ name: "src", path: "D:/repo/src", isDirectory: true }])
      }
      if (uri === "D:/repo/src") return srcEntries.promise
      return Promise.resolve([])
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })

    const srcRow = container.querySelector("[data-uri='D:/repo/src']") as HTMLElement | null
    expect(srcRow).toBeTruthy()

    srcRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    srcRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    expect(host.model.getItem("D:/repo/src")?.expanded).toBe(true)

    srcEntries.resolve([{ name: "App.ts", path: "D:/repo/src/App.ts", isFile: true }])

    expect(await waitForRow(container, "D:/repo/src/App.ts")).toBeTruthy()
    expect(host.model.getItem("D:/repo/src")?.expanded).toBe(true)
    expect((container.querySelector("[data-uri='D:/repo/src']") as HTMLElement | null)?.classList.contains("expanded")).toBe(true)

    host.dispose()
  })

  it("expands a collapsed directory on pointer down so drag-enabled rows do not swallow the first open", async () => {
    const container = makeContainer()
    const workspaceEntries = createDeferred<ExplorerRawEntry[]>()
    const selectDir = vi.fn()
    const readDir = vi.fn((uri: string) => {
      if (uri === "D:/repo") {
        return Promise.resolve([{ name: "workspace", path: "D:/repo/workspace", isDirectory: true }])
      }
      if (uri === "D:/repo/workspace") return workspaceEntries.promise
      return Promise.resolve([])
    })
    const host = new ExplorerTreeHost({ container, readDir, onSelectDir: selectDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })

    const row = container.querySelector("[data-uri='D:/repo/workspace']") as HTMLElement | null
    const label = row?.querySelector(".codek-explorer-label") as HTMLElement | null
    label?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))

    expect(selectDir).toHaveBeenCalledWith("D:/repo/workspace")
    expect(host.model.getItem("D:/repo/workspace")?.expanded).toBe(true)
    expect(row?.classList.contains("expanded")).toBe(true)
    expect(row?.getAttribute("aria-expanded")).toBe("true")

    workspaceEntries.resolve([{ name: "index.ts", path: "D:/repo/workspace/index.ts", isFile: true }])
    expect(await waitForRow(container, "D:/repo/workspace/index.ts")).toBeTruthy()

    host.dispose()
  })

  it("does not let a lost directory click swallow the next click on the same folder", async () => {
    const container = makeContainer()
    const folderEntries = createDeferred<ExplorerRawEntry[]>()
    const readDir = vi.fn((uri: string) => {
      if (uri === "D:/repo") {
        return Promise.resolve([{ name: "versioned", path: "D:/repo/versioned", isDirectory: true }])
      }
      if (uri === "D:/repo/versioned") return folderEntries.promise
      return Promise.resolve([])
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })

    const row = container.querySelector("[data-uri='D:/repo/versioned']") as HTMLElement | null
    row?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    row?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }))

    folderEntries.resolve([{ name: "index.ts", path: "D:/repo/versioned/index.ts", isFile: true }])
    expect(await waitForRow(container, "D:/repo/versioned/index.ts")).toBeTruthy()

    await new Promise((resolve) => setTimeout(resolve, 0))
    const expandedRow = container.querySelector("[data-uri='D:/repo/versioned']") as HTMLElement | null
    expandedRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    expect(host.model.getItem("D:/repo/versioned")?.expanded).toBe(false)
    expect(host.getFlatItems().map((item) => item.uri)).toEqual(["D:/repo", "D:/repo/versioned"])

    host.dispose()
  })

  it("opens a file on pointer release when native draggable rows suppress the click event", async () => {
    const container = makeContainer()
    const openFile = vi.fn()
    const readDir = createReadDir({
      "D:/repo": [
        { name: "versioned", path: "D:/repo/versioned", isDirectory: true },
      ],
      "D:/repo/versioned": [
        { name: "index.ts", path: "D:/repo/versioned/index.ts", isFile: true },
      ],
    })
    const host = new ExplorerTreeHost({ container, readDir, onOpenFile: openFile })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.expandPath("D:/repo/versioned")

    const fileRow = await waitForRow(container, "D:/repo/versioned/index.ts") as HTMLElement | null
    fileRow?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 12, clientY: 12 }))
    fileRow?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 12, clientY: 12 }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(openFile).toHaveBeenCalledTimes(1)
    expect(openFile).toHaveBeenCalledWith("D:/repo/versioned/index.ts")
    expect([...container.querySelectorAll(".codek-explorer-row.selected")].map((row) => (row as HTMLElement).dataset.uri)).toEqual([
      "D:/repo/versioned/index.ts",
    ])

    host.dispose()
  })

  it("cancels pending pointer fallback when focus leaves the window", async () => {
    const container = makeContainer()
    const openFile = vi.fn()
    const readDir = createReadDir({
      "D:/repo": [
        { name: "versioned", path: "D:/repo/versioned", isDirectory: true },
      ],
      "D:/repo/versioned": [
        { name: "index.ts", path: "D:/repo/versioned/index.ts", isFile: true },
      ],
    })
    const host = new ExplorerTreeHost({ container, readDir, onOpenFile: openFile })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.expandPath("D:/repo/versioned")

    const fileRow = await waitForRow(container, "D:/repo/versioned/index.ts") as HTMLElement | null
    fileRow?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 12, clientY: 12 }))
    fileRow?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 12, clientY: 12 }))
    window.dispatchEvent(new Event("blur"))
    window.dispatchEvent(new Event("focus"))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(openFile).not.toHaveBeenCalled()
    expect(container.querySelectorAll(".codek-explorer-row.selected")).toHaveLength(0)

    host.dispose()
  })

  it("cancels pending pointer fallback when focus moves outside the explorer", async () => {
    const container = makeContainer()
    const outsideInput = document.createElement("input")
    document.body.appendChild(outsideInput)
    const openFile = vi.fn()
    const readDir = createReadDir({
      "D:/repo": [
        { name: "versioned", path: "D:/repo/versioned", isDirectory: true },
      ],
      "D:/repo/versioned": [
        { name: "index.ts", path: "D:/repo/versioned/index.ts", isFile: true },
      ],
    })
    const host = new ExplorerTreeHost({ container, readDir, onOpenFile: openFile })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.expandPath("D:/repo/versioned")

    const fileRow = await waitForRow(container, "D:/repo/versioned/index.ts") as HTMLElement | null
    fileRow?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 12, clientY: 12 }))
    fileRow?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 12, clientY: 12 }))
    outsideInput.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(openFile).not.toHaveBeenCalled()
    expect(container.querySelectorAll(".codek-explorer-row.selected")).toHaveLength(0)

    host.dispose()
    outsideInput.remove()
  })

  it("keeps visible folder rows clickable after stale workspace-switch reads resolve late", async () => {
    const container = makeContainer()
    const staleSourceMirrorRoot = createDeferred<ExplorerRawEntry[]>()
    const finalSourceMirrorRoot = createDeferred<ExplorerRawEntry[]>()
    const sourceMirrorRootReads = [staleSourceMirrorRoot, finalSourceMirrorRoot]
    const readDir = vi.fn((uri: string) => {
      if (uri === "D:/Workspace") {
        return Promise.resolve([{ name: "frontend", path: "D:/Workspace/frontend", isDirectory: true }])
      }
      if (uri === "D:/SourceMirror") {
        const nextRead = sourceMirrorRootReads.shift()
        return nextRead?.promise || Promise.resolve([{ name: "src", path: "D:/SourceMirror/src", isDirectory: true }])
      }
      if (uri === "D:/SourceMirror/src") {
        return Promise.resolve([{ name: "index.ts", path: "D:/SourceMirror/src/index.ts", isFile: true }])
      }
      return Promise.resolve([])
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/Workspace", workspaceRoots: ["D:/Workspace"] })
    const staleUpdate = host.update({ projectRoot: "D:/SourceMirror", workspaceRoots: ["D:/SourceMirror"] })
    await Promise.resolve()
    await host.update({ projectRoot: "D:/Workspace", workspaceRoots: ["D:/Workspace"] })
    const finalUpdate = host.update({ projectRoot: "D:/SourceMirror", workspaceRoots: ["D:/SourceMirror"] })

    finalSourceMirrorRoot.resolve([{ name: "src", path: "D:/SourceMirror/src", isDirectory: true }])
    await finalUpdate

    const currentSrc = host.getFlatItems().find((item) => item.uri === "D:/SourceMirror/src")
    expect(currentSrc).toBeTruthy()

    staleSourceMirrorRoot.resolve([{ name: "src", path: "D:/SourceMirror/src", isDirectory: true }])
    await staleUpdate
    await Promise.resolve()

    expect(host.model.getItem("D:/SourceMirror/src")).toBe(currentSrc)

    const srcRow = container.querySelector("[data-uri='D:/SourceMirror/src']") as HTMLElement | null
    srcRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    expect(await waitForRow(container, "D:/SourceMirror/src/index.ts")).toBeTruthy()

    host.dispose()
  })

  it("keeps expanded child nodes visible when a parent refresh returns the same child URI", async () => {
    const container = makeContainer()
    const readDir = createReadDir({
      "D:/repo": [{ name: "src", path: "D:/repo/src", isDirectory: true }],
      "D:/repo/src": [{ name: "App.ts", path: "D:/repo/src/App.ts", isFile: true }],
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.expandPath("D:/repo/src")
    const firstSrc = host.model.getItem("D:/repo/src")

    await host.refresh()

    expect(host.model.getItem("D:/repo/src")).toBe(firstSrc)
    expect(host.getFlatItems().map((item) => item.uri)).toEqual([
      "D:/repo",
      "D:/repo/src",
      "D:/repo/src/App.ts",
    ])
    expect(host.model.getItem("D:/repo/src")?.expanded).toBe(true)

    host.dispose()
  })

  it("does not carry expanded nodes from the previous native root into the next root", async () => {
    const container = makeContainer()
    const readDir = createReadDir({
      "D:/large": [{ name: "src", path: "D:/large/src", isDirectory: true }],
      "D:/large/src": [{ name: "index.ts", path: "D:/large/src/index.ts", isFile: true }],
      "D:/small": [{ name: "docs", path: "D:/small/docs", isDirectory: true }],
      "D:/small/docs": [{ name: "readme.md", path: "D:/small/docs/readme.md", isFile: true }],
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/large", workspaceRoots: ["D:/large"] })
    await host.expandPath("D:/large/src")

    expect(host.model.expandedUris.has("D:/large/src")).toBe(true)

    await host.update({ projectRoot: "D:/small", workspaceRoots: ["D:/small"] })

    expect(host.model.expandedUris.has("D:/large/src")).toBe(false)
    expect(host.getFlatItems().map((item) => item.uri)).toEqual(["D:/small", "D:/small/docs"])
    expect(host.model.expandedUris.has("D:/small/docs")).toBe(false)
    expect(host.getFlatItems().map((item) => item.uri)).not.toContain("D:/small/docs/readme.md")

    host.dispose()
  })

  it("resets stale scroll offset when switching to a root without saved view state", async () => {
    const container = makeContainer(240)
    const readDir = createReadDir({
      "D:/large": Array.from({ length: 120 }, (_, index) => ({
        name: `file-${index}.ts`,
        path: `D:/large/file-${index}.ts`,
        isFile: true,
      })),
      "D:/small": [{ name: "README.md", path: "D:/small/README.md", isFile: true }],
    })
    const host = new ExplorerTreeHost({ container, readDir, rowHeight: 24 })

    await host.update({ projectRoot: "D:/large", workspaceRoots: ["D:/large"] })
    await host.revealPath("D:/large/file-90.ts")

    expect(host.getScrollTop()).toBeGreaterThan(0)

    await host.update({ projectRoot: "D:/small", workspaceRoots: ["D:/small"] })

    expect(host.getFlatItems().map((item) => item.uri)).toEqual(["D:/small", "D:/small/README.md"])
    expect(host.getScrollTop()).toBe(0)

    host.dispose()
  })

  it("prewarms visible child directories after root expansion with a bounded read budget", async () => {
    const container = makeContainer()
    const calls: string[] = []
    const readDir = vi.fn(async (uri: string) => {
      calls.push(uri)
      if (uri === "D:/repo") {
        return [
          { name: "src", path: "D:/repo/src", isDirectory: true },
          { name: "packages", path: "D:/repo/packages", isDirectory: true },
          { name: "node_modules", path: "D:/repo/node_modules", isDirectory: true },
          { name: "README.md", path: "D:/repo/README.md", isFile: true },
        ]
      }
      return [{ name: "index.ts", path: `${uri}/index.ts`, isFile: true }]
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({
      projectRoot: "D:/repo",
      workspaceRoots: ["D:/repo"],
      workspaceScaleProfile: { scale: "normal" },
    })
    for (let attempt = 0; attempt < 10 && calls.length < 3; attempt += 1) {
      await Promise.resolve()
    }

    expect(calls[0]).toBe("D:/repo")
    expect(calls.slice(1)).toHaveLength(2)
    expect(calls.slice(1)).toContain("D:/repo/node_modules")
    expect([host.model.getItem("D:/repo/src")?.childrenLoaded, host.model.getItem("D:/repo/packages")?.childrenLoaded].filter(Boolean)).toHaveLength(1)
    expect(host.model.getItem("D:/repo/node_modules")?.childrenLoaded).toBe(true)

    host.dispose()
  })

  it("does not restore deep expanded directories or prewarm top-level folders for huge workspaces", async () => {
    const container = makeContainer()
    const calls: string[] = []
    const readDir = vi.fn(async (uri: string) => {
      calls.push(uri)
      if (uri === "D:/SourceMirror") {
        return [
          { name: "vscode", path: "D:/SourceMirror/vscode", isDirectory: true },
          { name: "salvage", path: "D:/SourceMirror/salvage", isDirectory: true },
        ]
      }
      if (uri === "D:/SourceMirror/vscode") {
        return [{ name: "src", path: "D:/SourceMirror/vscode/src", isDirectory: true }]
      }
      if (uri === "D:/SourceMirror/vscode/src") {
        return [{ name: "vs", path: "D:/SourceMirror/vscode/src/vs", isDirectory: true }]
      }
      return []
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({
      projectRoot: "D:/SourceMirror",
      workspaceRoots: ["D:/SourceMirror"],
      workspaceScaleProfile: { scale: "normal" },
    })
    await host.expandPath("D:/SourceMirror/vscode")
    await host.expandPath("D:/SourceMirror/vscode/src")

    expect(host.model.expandedUris.has("D:/SourceMirror/vscode/src")).toBe(true)

    await host.update({ projectRoot: "D:/Workspace", workspaceRoots: ["D:/Workspace"] })
    calls.length = 0
    await host.update({
      projectRoot: "D:/SourceMirror",
      workspaceRoots: ["D:/SourceMirror"],
      workspaceScaleProfile: { scale: "huge" },
    })
    await Promise.resolve()

    expect(host.getFlatItems().map((item) => item.uri)).toEqual([
      "D:/SourceMirror",
      "D:/SourceMirror/salvage",
      "D:/SourceMirror/vscode",
    ])
    expect(host.model.expandedUris.has("D:/SourceMirror/vscode")).toBe(false)
    expect(host.model.expandedUris.has("D:/SourceMirror/vscode/src")).toBe(false)
    expect(calls).toEqual(["D:/SourceMirror"])

    host.dispose()
  })

  it("treats missing workspace scale profile as pending while switching roots", async () => {
    const container = makeContainer()
    const calls: string[] = []
    const readDir = vi.fn(async (uri: string) => {
      calls.push(uri)
      if (uri === "D:/SourceMirror") {
        return [
          { name: "salvage", path: "D:/SourceMirror/salvage", isDirectory: true },
          { name: "vscode", path: "D:/SourceMirror/vscode", isDirectory: true },
        ]
      }
      if (uri === "D:/SourceMirror/vscode") {
        return [{ name: "src", path: "D:/SourceMirror/vscode/src", isDirectory: true }]
      }
      if (uri === "D:/SourceMirror/vscode/src") {
        return [{ name: "vs", path: "D:/SourceMirror/vscode/src/vs", isDirectory: true }]
      }
      return []
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({
      projectRoot: "D:/SourceMirror",
      workspaceRoots: ["D:/SourceMirror"],
      workspaceScaleProfile: { scale: "normal" },
    })
    await host.expandPath("D:/SourceMirror/vscode")
    await host.expandPath("D:/SourceMirror/vscode/src")

    await host.update({ projectRoot: "D:/Workspace", workspaceRoots: ["D:/Workspace"] })
    calls.length = 0
    await host.update({
      projectRoot: "D:/SourceMirror",
      workspaceRoots: ["D:/SourceMirror"],
      workspaceScaleProfile: null,
    })
    await Promise.resolve()

    expect(host.getFlatItems().map((item) => item.uri)).toEqual([
      "D:/SourceMirror",
      "D:/SourceMirror/salvage",
      "D:/SourceMirror/vscode",
    ])
    expect(host.model.expandedUris.has("D:/SourceMirror/vscode")).toBe(false)
    expect(host.model.expandedUris.has("D:/SourceMirror/vscode/src")).toBe(false)
    expect(calls).toEqual(["D:/SourceMirror"])

    host.dispose()
  })

  it("does not rebuild the tree model for selection-only updates", async () => {
    const container = makeContainer()
    const readDir = createReadDir({
      "D:/repo": [{ name: "src", path: "D:/repo/src", isDirectory: true }],
      "D:/repo/src": Array.from({ length: 10_000 }, (_, index) => ({
        name: `file-${index}.ts`,
        path: `D:/repo/src/file-${index}.ts`,
        isFile: true,
      })),
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.expandPath("D:/repo/src")
    const firstItem = host.model.getItem("D:/repo/src/file-9999.ts")

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"], activeFile: "src/file-9999.ts" })
    const secondItem = host.model.getItem("D:/repo/src/file-9999.ts")

    expect(secondItem).toBe(firstItem)
    expect(readDir.mock.calls.map(([uri]) => uri)).toEqual(["D:/repo", "D:/repo/src"])
    expect(container.querySelectorAll("[data-codek-explorer-row]").length).toBeLessThanOrEqual(120)

    host.dispose()
  })

  it("limits selection-only row patches to affected visible rows", async () => {
    const container = makeContainer(240)
    const readDir = createReadDir({
      "D:/repo": [{ name: "src", path: "D:/repo/src", isDirectory: true }],
      "D:/repo/src": Array.from({ length: 10_000 }, (_, index) => ({
        name: `file-${index}.ts`,
        path: `D:/repo/src/file-${index}.ts`,
        isFile: true,
      })),
    })
    const host = new ExplorerTreeHost({ container, readDir, rowHeight: 24 })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.expandPath("D:/repo/src")
    const firstRowsBefore = [...container.querySelectorAll("[data-codek-explorer-row]")]
      .map((row) => `${(row as HTMLElement).dataset.uri}:${row.className}`)

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"], activeFile: "src/file-9999.ts" })
    const firstRowsAfterInvisibleSelection = [...container.querySelectorAll("[data-codek-explorer-row]")]
      .map((row) => `${(row as HTMLElement).dataset.uri}:${row.className}`)

    expect(firstRowsAfterInvisibleSelection).toEqual(firstRowsBefore)

    const visibleFileUri = (container.querySelector("[data-uri$='file-0.ts']") as HTMLElement | null)?.dataset.uri || ""
    expect(visibleFileUri).toBeTruthy()

    await host.update({
      projectRoot: "D:/repo",
      workspaceRoots: ["D:/repo"],
      activeFile: visibleFileUri,
      selectedPath: visibleFileUri,
      selectedKind: "file",
    })
    const selectedVisibleRow = container.querySelector(`[data-uri='${visibleFileUri}']`)

    expect(selectedVisibleRow?.classList.contains("selected")).toBe(true)

    host.dispose()
  })

  it("keeps explorer selection single when a directory is clicked after an active file", async () => {
    const container = makeContainer()
    const readDir = createReadDir({
      "D:/repo": [
        { name: "server", path: "D:/repo/server", isDirectory: true },
        { name: "README.md", path: "D:/repo/README.md", isFile: true },
      ],
      "D:/repo/server": [
        { name: "bin", path: "D:/repo/server/bin", isDirectory: true },
      ],
    })
    let host: ExplorerTreeHost
    host = new ExplorerTreeHost({
      container,
      readDir,
      onSelectDir: (path) => {
        void host.update({
          projectRoot: "D:/repo",
          workspaceRoots: ["D:/repo"],
          activeFile: "README.md",
          selectedPath: path,
          selectedKind: "dir",
        })
      },
    })

    await host.update({
      projectRoot: "D:/repo",
      workspaceRoots: ["D:/repo"],
      activeFile: "README.md",
      selectedPath: "README.md",
      selectedKind: "file",
    })

    expect(container.querySelectorAll(".codek-explorer-row.selected")).toHaveLength(1)

    const serverRow = container.querySelector("[data-uri='D:/repo/server']") as HTMLElement | null
    serverRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()

    const selectedRows = [...container.querySelectorAll(".codek-explorer-row.selected")]
      .map((row) => (row as HTMLElement).dataset.uri)
    const ariaSelectedRows = [...container.querySelectorAll(".codek-explorer-row[aria-selected='true']")]
      .map((row) => (row as HTMLElement).dataset.uri)

    expect(selectedRows).toEqual(["D:/repo/server"])
    expect(ariaSelectedRows).toEqual(["D:/repo/server"])
    expect(container.querySelector("[data-uri='D:/repo/README.md']")?.classList.contains("selected")).toBe(false)
    expect(container.querySelector("[data-uri='D:/repo/README.md']")?.classList.contains("active")).toBe(false)
    expect(container.querySelector("[data-uri='D:/repo/README.md']")?.classList.contains("selected")).toBe(false)

    host.dispose()
  })

  it("keeps local file selection visible while openFile is still pending", async () => {
    const container = makeContainer()
    const openFile = vi.fn()
    const readDir = createReadDir({
      "D:/repo": [
        { name: "server", path: "D:/repo/server", isDirectory: true },
        { name: "README.md", path: "D:/repo/README.md", isFile: true },
      ],
      "D:/repo/server": [
        { name: "code-192.png", path: "D:/repo/server/code-192.png", isFile: true },
      ],
    })
    const host = new ExplorerTreeHost({
      container,
      readDir,
      onOpenFile: openFile,
    })

    await host.update({
      projectRoot: "D:/repo",
      workspaceRoots: ["D:/repo"],
      activeFile: "README.md",
      selectedPath: "server",
      selectedKind: "dir",
    })
    await host.expandPath("D:/repo/server")

    const fileRow = await waitForRow(container, "D:/repo/server/code-192.png") as HTMLElement | null
    fileRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()

    expect(openFile).toHaveBeenCalledWith("D:/repo/server/code-192.png")
    expect([...container.querySelectorAll(".codek-explorer-row.selected")].map((row) => (row as HTMLElement).dataset.uri)).toEqual([
      "D:/repo/server/code-192.png",
    ])
    expect(container.querySelector("[data-uri='D:/repo/server']")?.classList.contains("selected")).toBe(false)
    expect(container.querySelector("[data-uri='D:/repo/README.md']")?.classList.contains("active")).toBe(false)

    await host.update({
      projectRoot: "D:/repo",
      workspaceRoots: ["D:/repo"],
      activeFile: "README.md",
      selectedPath: "server",
      selectedKind: "dir",
    })

    expect([...container.querySelectorAll(".codek-explorer-row.selected")].map((row) => (row as HTMLElement).dataset.uri)).toEqual([
      "D:/repo/server/code-192.png",
    ])

    host.dispose()
  })

  it("keeps one highlighted row through rapid directory and file clicks", async () => {
    const container = makeContainer()
    const readDir = createReadDir({
      "D:/repo": [
        { name: "server", path: "D:/repo/server", isDirectory: true },
        { name: "client", path: "D:/repo/client", isDirectory: true },
        { name: "README.md", path: "D:/repo/README.md", isFile: true },
      ],
      "D:/repo/server": [
        { name: "bin", path: "D:/repo/server/bin", isDirectory: true },
        { name: "code-192.png", path: "D:/repo/server/code-192.png", isFile: true },
      ],
      "D:/repo/client": [
        { name: "index.ts", path: "D:/repo/client/index.ts", isFile: true },
      ],
    })
    let host: ExplorerTreeHost
    host = new ExplorerTreeHost({
      container,
      readDir,
      onOpenFile: (path) => {
        void host.update({
          projectRoot: "D:/repo",
          workspaceRoots: ["D:/repo"],
          activeFile: path,
          selectedPath: path,
          selectedKind: "file",
        })
      },
      onSelectDir: (path) => {
        void host.update({
          projectRoot: "D:/repo",
          workspaceRoots: ["D:/repo"],
          activeFile: "D:/repo/README.md",
          selectedPath: path,
          selectedKind: "dir",
        })
      },
    })

    await host.update({
      projectRoot: "D:/repo",
      workspaceRoots: ["D:/repo"],
      activeFile: "README.md",
      selectedPath: "README.md",
      selectedKind: "file",
    })

    const click = async (uri: string) => {
      const row = await waitForRow(container, uri) as HTMLElement | null
      expect(row).toBeTruthy()
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      expect(container.querySelectorAll(".codek-explorer-row.selected")).toHaveLength(1)
      expect(container.querySelectorAll(".codek-explorer-row[aria-selected='true']")).toHaveLength(1)
    }

    await click("D:/repo/server")
    expect(await waitForCondition(() => Boolean(container.querySelector("[data-uri='D:/repo/server/code-192.png']")))).toBe(true)
    await click("D:/repo/client")
    expect(await waitForCondition(() => Boolean(container.querySelector("[data-uri='D:/repo/client/index.ts']")))).toBe(true)
    await click("D:/repo/client/index.ts")
    await click("D:/repo/server/code-192.png")

    const selectedRows = [...container.querySelectorAll(".codek-explorer-row.selected")]
      .map((row) => (row as HTMLElement).dataset.uri)

    expect(selectedRows).toEqual(["D:/repo/server/code-192.png"])

    host.dispose()
  })

  it("keeps rapid large-workspace folder clicks from piling up directory reads", async () => {
    const container = makeContainer()
    const deferredReads = new Map<string, ReturnType<typeof createDeferred<ExplorerRawEntry[]>>>()
    const activeReads: string[] = []
    let maxActiveReads = 0
    for (const name of ["first", "second", "third"]) {
      deferredReads.set(`D:/repo/${name}`, createDeferred<ExplorerRawEntry[]>())
    }
    const readDir = vi.fn((uri: string) => {
      if (uri === "D:/repo") {
        return Promise.resolve([
          { name: "first", path: "D:/repo/first", isDirectory: true },
          { name: "second", path: "D:/repo/second", isDirectory: true },
          { name: "third", path: "D:/repo/third", isDirectory: true },
        ])
      }
      activeReads.push(uri)
      maxActiveReads = Math.max(maxActiveReads, activeReads.length)
      return (deferredReads.get(uri)?.promise || Promise.resolve([])).finally(() => {
        activeReads.splice(activeReads.indexOf(uri), 1)
      })
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({
      projectRoot: "D:/repo",
      workspaceRoots: ["D:/repo"],
      workspaceScaleProfile: { scale: "huge", pending: true },
    })

    for (const uri of ["D:/repo/first", "D:/repo/second", "D:/repo/third"]) {
      const row = container.querySelector(`[data-uri='${uri}']`) as HTMLElement | null
      expect(row).toBeTruthy()
      row?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    }
    await Promise.resolve()
    await Promise.resolve()

    expect(readDir.mock.calls.map(([uri]) => uri)).toEqual(["D:/repo", "D:/repo/first"])
    expect([...container.querySelectorAll(".codek-explorer-row.loading")].map((row) => (row as HTMLElement).dataset.uri)).toEqual([
      "D:/repo/first",
      "D:/repo/second",
      "D:/repo/third",
    ])

    const secondRow = container.querySelector("[data-uri='D:/repo/second']") as HTMLElement | null
    secondRow?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    secondRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
    expect(host.model.getItem("D:/repo/second")?.expanded).toBe(true)
    expect(container.querySelector("[data-uri='D:/repo/second']")?.classList.contains("expanded")).toBe(true)

    deferredReads.get("D:/repo/first")?.resolve([{ name: "index.ts", path: "D:/repo/first/index.ts", isFile: true }])
    expect(await waitForCondition(() => readDir.mock.calls.some(([uri]) => uri === "D:/repo/second"))).toBe(true)
    expect(maxActiveReads).toBe(1)

    deferredReads.get("D:/repo/second")?.resolve([{ name: "index.ts", path: "D:/repo/second/index.ts", isFile: true }])
    expect(await waitForCondition(() => readDir.mock.calls.some(([uri]) => uri === "D:/repo/third"))).toBe(true)
    expect(maxActiveReads).toBe(1)

    deferredReads.get("D:/repo/third")?.resolve([{ name: "index.ts", path: "D:/repo/third/index.ts", isFile: true }])
    expect(await waitForRow(container, "D:/repo/third/index.ts")).toBeTruthy()
    expect(maxActiveReads).toBe(1)

    host.dispose()
  })

  it("clears visible stale loading decorations when background prewarm finishes", async () => {
    const container = makeContainer(240)
    const srcEntries = createDeferred<ExplorerRawEntry[]>()
    const readDir = vi.fn((uri: string) => {
      if (uri === "D:/repo") {
        return Promise.resolve([
          { name: "src", path: "D:/repo/src", isDirectory: true },
          { name: "components", path: "D:/repo/components", isDirectory: true },
        ])
      }
      if (uri === "D:/repo/src") return srcEntries.promise
      if (uri === "D:/repo/components") return Promise.resolve([{ name: "Button.ts", path: "D:/repo/components/Button.ts", isFile: true }])
      return Promise.resolve([])
    })
    const host = new ExplorerTreeHost({ container, readDir, rowHeight: 24 })

    await host.update({
      projectRoot: "D:/repo",
      workspaceRoots: ["D:/repo"],
      workspaceScaleProfile: { scale: "normal" },
    })
    await Promise.resolve()

    const srcRow = container.querySelector("[data-uri='D:/repo/src']") as HTMLElement | null
    expect(srcRow?.classList.contains("loading")).toBe(true)
    expect(srcRow?.querySelector(".codek-explorer-decoration")?.textContent).toBe("loading")

    srcEntries.resolve([{ name: "App.ts", path: "D:/repo/src/App.ts", isFile: true }])
    expect(await waitForCondition(() => {
      const row = container.querySelector("[data-uri='D:/repo/src']") as HTMLElement | null
      return Boolean(row && !row.classList.contains("loading") && row.querySelector(".codek-explorer-decoration")?.textContent !== "loading")
    })).toBe(true)

    host.dispose()
  })

  it("keeps scroll position while consecutive directory expansions publish new rows", async () => {
    const container = makeContainer(240)
    const topLevel = Array.from({ length: 200 }, (_, index) => ({
      name: `folder-${String(index).padStart(3, "0")}`,
      path: `D:/repo/folder-${String(index).padStart(3, "0")}`,
      isDirectory: true,
    }))
    const readDir = vi.fn(async (uri: string) => {
      if (uri === "D:/repo") return topLevel
      return [
        { name: "child-0.ts", path: `${uri}/child-0.ts`, isFile: true },
        { name: "child-1.ts", path: `${uri}/child-1.ts`, isFile: true },
      ]
    })
    const host = new ExplorerTreeHost({ container, readDir, rowHeight: 24 })

    await host.update({
      projectRoot: "D:/repo",
      workspaceRoots: ["D:/repo"],
      workspaceScaleProfile: { scale: "huge", pending: true },
    })
    await host.revealPath("D:/repo/folder-150")
    const scrollTopBefore = host.getScrollTop()

    expect(scrollTopBefore).toBeGreaterThan(0)

    await host.expandPath("D:/repo/folder-150")
    await host.expandPath("D:/repo/folder-151")
    await host.expandPath("D:/repo/folder-152")

    expect(host.getScrollTop()).toBe(scrollTopBefore)
    expect(host.getScrollTop()).toBeGreaterThan(0)
    expect(host.getFlatItems().map((item) => item.uri)).toContain("D:/repo/folder-150/child-0.ts")

    host.dispose()
  })

  it("keeps the visible viewport filled after rapid expand and collapse cycles", async () => {
    const container = makeContainer(360)
    const topLevel = Array.from({ length: 160 }, (_, index) => ({
      name: `folder-${String(index).padStart(3, "0")}`,
      path: `D:/repo/folder-${String(index).padStart(3, "0")}`,
      isDirectory: true,
    }))
    const readDir = vi.fn(async (uri: string) => {
      if (uri === "D:/repo") return topLevel
      return Array.from({ length: 4 }, (_, index) => ({
        name: `child-${index}.ts`,
        path: `${uri}/child-${index}.ts`,
        isFile: true,
      }))
    })
    const host = new ExplorerTreeHost({ container, readDir, rowHeight: 24 })

    await host.update({
      projectRoot: "D:/repo",
      workspaceRoots: ["D:/repo"],
      workspaceScaleProfile: { scale: "huge", pending: true },
    })
    await host.revealPath("D:/repo/folder-100")

    for (const uri of ["D:/repo/folder-100", "D:/repo/folder-101", "D:/repo/folder-102"]) {
      await host.expandPath(uri)
      host.collapsePath(uri)
      await host.expandPath(uri)
    }

    const visibleRows = [...container.querySelectorAll("[data-codek-explorer-row]")]
      .map((row) => row as HTMLElement)
      .filter((row) => row.style.display !== "none")
    const visibleIndexes = visibleRows.map((row) => Number(row.dataset.index || -1))
    const expectedMinimumRows = Math.ceil(360 / 24)

    expect(host.getScrollTop()).toBeGreaterThan(0)
    expect(visibleRows.length).toBeGreaterThanOrEqual(expectedMinimumRows)
    expect(visibleIndexes.every((index) => index >= 0)).toBe(true)
    expect(new Set(visibleIndexes).size).toBe(visibleIndexes.length)

    host.dispose()
  })

  it("refreshes native roots and loaded children without legacy tree input", async () => {
    const container = makeContainer()
    const readDir = createReadDir({
      "D:/repo": [{ name: "src", path: "D:/repo/src", isDirectory: true }],
      "D:/repo/src": [{ name: "App.ts", path: "D:/repo/src/App.ts", isFile: true }],
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.expandPath("D:/repo/src")

    readDir.mockClear()
    await host.refresh()

    expect(readDir.mock.calls.map(([uri]) => uri)).toEqual(["D:/repo", "D:/repo/src"])
    expect(host.getFlatItems().map((item) => item.uri)).toEqual([
      "D:/repo",
      "D:/repo/src",
      "D:/repo/src/App.ts",
    ])

    host.dispose()
  })

  it("keeps a deeply expanded create target visible across repeated real-fs refreshes", async () => {
    const container = makeContainer()
    const dynamicEntries: Record<string, ExplorerRawEntry[]> = {
      "D:/repo": [{ name: "smoke-target", path: "D:/repo/smoke-target", isDirectory: true }],
      "D:/repo/smoke-target": [{ name: "nested", path: "D:/repo/smoke-target/nested", isDirectory: true }],
      "D:/repo/smoke-target/nested": [],
    }
    const readDir = vi.fn(async (uri: string) => dynamicEntries[uri] || [])
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.expandPath("D:/repo/smoke-target")
    await host.expandPath("D:/repo/smoke-target/nested")

    dynamicEntries["D:/repo/smoke-target/nested"] = [
      { name: "created.ts", path: "D:/repo/smoke-target/nested/created.ts", isFile: true },
      { name: "created-folder", path: "D:/repo/smoke-target/nested/created-folder", isDirectory: true },
    ]

    await host.refresh()

    expect(host.getFlatItems().map((item) => item.uri)).toEqual([
      "D:/repo",
      "D:/repo/smoke-target",
      "D:/repo/smoke-target/nested",
      "D:/repo/smoke-target/nested/created-folder",
      "D:/repo/smoke-target/nested/created.ts",
    ])

    dynamicEntries["D:/repo/smoke-target/nested"] = [
      ...dynamicEntries["D:/repo/smoke-target/nested"],
      { name: "continuous-01.ts", path: "D:/repo/smoke-target/nested/continuous-01.ts", isFile: true },
    ]

    await host.refresh()

    expect(host.getFlatItems().map((item) => item.uri)).toContain("D:/repo/smoke-target/nested/continuous-01.ts")
    expect(host.model.getItem("D:/repo/smoke-target")?.expanded).toBe(true)
    expect(host.model.getItem("D:/repo/smoke-target/nested")?.expanded).toBe(true)

    host.dispose()
  })

  it("applies known file operations to loaded explorer rows before a full refresh", async () => {
    const container = makeContainer()
    const readDir = createReadDir({
      "D:/repo": [{ name: "src", path: "D:/repo/src", isDirectory: true }],
      "D:/repo/src": [{ name: "App.ts", path: "D:/repo/src/App.ts", isFile: true }],
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.expandPath("D:/repo/src")
    readDir.mockClear()

    expect(host.applyFileOperation({
      type: "create_file",
      action: "create",
      pathAfter: "src/NewFile.ts",
    })).toBe(true)
    expect(container.querySelector("[data-uri='D:/repo/src/NewFile.ts']")).toBeTruthy()
    expect(readDir).not.toHaveBeenCalled()

    expect(host.applyFileOperation({
      type: "delete_file",
      action: "delete",
      pathBefore: "src/NewFile.ts",
    })).toBe(true)
    expect(host.model.getItem("D:/repo/src/NewFile.ts")).toBeNull()
    expect(host.getFlatItems().map((item) => item.uri)).not.toContain("D:/repo/src/NewFile.ts")
    const recycledRow = container.querySelector("[data-uri='D:/repo/src/NewFile.ts']") as HTMLElement | null
    expect(recycledRow?.style.display || "none").toBe("none")

    host.dispose()
  })

  it("starts create as an editable Explorer item rendered by the native tree", async () => {
    const container = makeContainer()
    const inlineCreate = vi.fn(async () => undefined)
    const readDir = createReadDir({
      "D:/repo": [{ name: "src", path: "D:/repo/src", isDirectory: true }],
      "D:/repo/src": [],
    })
    const host = new ExplorerTreeHost({ container, readDir, onInlineCreate: inlineCreate })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.startCreate("file", "D:/repo/src", { parentPath: "D:/repo/src" })

    const editableItem = host.getFlatItems().find((item) => item.editable?.kind === "createFile")
    expect(editableItem?.parent?.uri).toBe("D:/repo/src")
    const row = container.querySelector(`[data-uri='${editableItem?.uri}']`) as HTMLElement | null
    const input = row?.querySelector(".codek-explorer-input") as HTMLInputElement | null
    expect(row?.classList.contains("editable")).toBe(true)
    expect(input).toBeTruthy()

    input!.value = "created.ts"
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()

    expect(inlineCreate).toHaveBeenCalledWith({
      type: "file",
      parentPath: "D:/repo/src",
      targetSnapshot: { parentPath: "D:/repo/src" },
      name: "created.ts",
    })
    expect(host.getFlatItems().some((item) => item.editable)).toBe(false)

    host.dispose()
  })

  it("keeps the editable Explorer item when create fails validation downstream", async () => {
    const container = makeContainer()
    const inlineCreate = vi.fn(async () => {
      throw new Error("The name is not valid.")
    })
    const readDir = createReadDir({
      "D:/repo": [{ name: "src", path: "D:/repo/src", isDirectory: true }],
      "D:/repo/src": [],
    })
    const host = new ExplorerTreeHost({ container, readDir, onInlineCreate: inlineCreate })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.startCreate("file", "D:/repo/src")
    const input = container.querySelector(".codek-explorer-row.editable .codek-explorer-input") as HTMLInputElement
    input.value = "bad-name.ts"
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()

    expect(inlineCreate).toHaveBeenCalled()
    expect(host.getFlatItems().some((item) => item.editable)).toBe(true)
    expect(container.querySelector(".codek-explorer-row.editable")).toBeTruthy()

    host.dispose()
  })

  it("starts rename as a VS Code style editable item and selects the renamed path", async () => {
    const container = makeContainer()
    const renameEntry = vi.fn(async () => undefined)
    const readDir = createReadDir({
      "D:/repo": [{ name: "src", path: "D:/repo/src", isDirectory: true }],
      "D:/repo/src": [{ name: "main.ts", path: "D:/repo/src/main.ts", isFile: true }],
    })
    const host = new ExplorerTreeHost({ container, readDir, onRenameEntry: renameEntry })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.expandPath("D:/repo/src")
    await expect(host.startRename("D:/repo/src/main.ts")).resolves.toBe(true)

    const row = container.querySelector("[data-uri='D:/repo/src/main.ts']") as HTMLElement | null
    const input = row?.querySelector(".codek-explorer-input") as HTMLInputElement | null
    expect(row?.classList.contains("editable")).toBe(true)
    expect(input?.value).toBe("main.ts")

    input!.value = "app.ts"
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()

    expect(renameEntry).toHaveBeenCalledWith({
      path: "D:/repo/src/main.ts",
      newPath: "D:/repo/src/app.ts",
      name: "app.ts",
    })
    expect(host.model.getItem("D:/repo/src/main.ts")).toBeNull()
    expect(host.model.getItem("D:/repo/src/app.ts")?.name).toBe("app.ts")
    expect(host.model.selectedUri).toBe("D:/repo/src/app.ts")
    expect(container.querySelector("[data-uri='D:/repo/src/app.ts']")?.classList.contains("selected")).toBe(true)
    expect(host.getFlatItems().some((item) => item.editable)).toBe(false)

    host.dispose()
  })

  it("keeps rename editable when the workspace rename fails", async () => {
    const container = makeContainer()
    const renameEntry = vi.fn(async () => {
      throw new Error("rename failed")
    })
    const readDir = createReadDir({
      "D:/repo": [{ name: "src", path: "D:/repo/src", isDirectory: true }],
      "D:/repo/src": [{ name: "main.ts", path: "D:/repo/src/main.ts", isFile: true }],
    })
    const host = new ExplorerTreeHost({ container, readDir, onRenameEntry: renameEntry })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.expandPath("D:/repo/src")
    await host.startRename("D:/repo/src/main.ts")
    const input = container.querySelector(".codek-explorer-row.editable .codek-explorer-input") as HTMLInputElement
    input.value = "app.ts"
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()

    expect(renameEntry).toHaveBeenCalled()
    expect(host.model.getItem("D:/repo/src/main.ts")?.editable?.kind).toBe("rename")
    expect(host.model.getItem("D:/repo/src/main.ts")?.editable?.value).toBe("app.ts")
    expect(container.querySelector(".codek-explorer-row.editable")).toBeTruthy()

    host.dispose()
  })

  it("cancels rename editable without removing the real item", async () => {
    const container = makeContainer()
    const renameEntry = vi.fn()
    const readDir = createReadDir({
      "D:/repo": [{ name: "main.ts", path: "D:/repo/main.ts", isFile: true }],
    })
    const host = new ExplorerTreeHost({ container, readDir, onRenameEntry: renameEntry })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.startRename("D:/repo/main.ts")
    const input = container.querySelector(".codek-explorer-row.editable .codek-explorer-input") as HTMLInputElement
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    await Promise.resolve()

    expect(renameEntry).not.toHaveBeenCalled()
    expect(host.model.getItem("D:/repo/main.ts")?.editable).toBeNull()
    expect(host.model.getItem("D:/repo/main.ts")).toBeTruthy()
    expect(container.querySelector("[data-uri='D:/repo/main.ts']")).toBeTruthy()

    host.dispose()
  })

  it("reveals the target parent before applying deep create operations", async () => {
    const container = makeContainer()
    const readDir = createReadDir({
      "D:/repo": [{ name: "smoke-target", path: "D:/repo/smoke-target", isDirectory: true }],
      "D:/repo/smoke-target": [{ name: "nested", path: "D:/repo/smoke-target/nested", isDirectory: true }],
      "D:/repo/smoke-target/nested": [],
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })

    expect(host.applyFileOperation({
      type: "create_file",
      action: "create",
      pathAfter: "smoke-target/nested/continuous-09.ts",
    })).toBe(false)

    await expect(host.applyFileOperationAsync({
      type: "create_file",
      action: "create",
      pathAfter: "smoke-target/nested/continuous-09.ts",
    })).resolves.toBe(true)

    expect(host.getFlatItems().map((item) => item.uri)).toEqual([
      "D:/repo",
      "D:/repo/smoke-target",
      "D:/repo/smoke-target/nested",
      "D:/repo/smoke-target/nested/continuous-09.ts",
    ])
    expect(container.querySelector("[data-uri='D:/repo/smoke-target/nested/continuous-09.ts']")).toBeTruthy()

    host.dispose()
  })

  it("keeps editable rows visible while the explorer filter would otherwise hide them", async () => {
    const container = makeContainer()
    const readDir = createReadDir({
      "D:/repo": [{ name: "src", path: "D:/repo/src", isDirectory: true }],
      "D:/repo/src": [{ name: "main.ts", path: "D:/repo/src/main.ts", isFile: true }],
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"], filterQuery: "zzz" })
    await host.expandPath("D:/repo/src")
    await host.startRename("D:/repo/src/main.ts")

    expect(host.getFlatItems().map((item) => item.uri)).toContain("D:/repo/src/main.ts")
    expect(container.querySelector(".codek-explorer-row.editable [data-codek-smoke='explorer-inline-create-input']")).toBeTruthy()

    host.dispose()
  })

  it("reveals and selects created or copied rows after file operation events", async () => {
    const container = makeContainer()
    const readDir = createReadDir({
      "D:/repo": [{ name: "src", path: "D:/repo/src", isDirectory: true }],
      "D:/repo/src": [],
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.expandPath("D:/repo/src")

    expect(host.applyFileOperation({
      type: "copy_file",
      action: "copy",
      pathAfter: "src/copied.ts",
    })).toBe(true)

    expect(host.model.selectedUri).toBe("D:/repo/src/copied.ts")
    expect(host.model.focusedUri).toBe("D:/repo/src/copied.ts")
    expect(container.querySelector("[data-uri='D:/repo/src/copied.ts']")?.classList.contains("selected")).toBe(true)

    host.dispose()
  })

  it("keeps old and new parents refreshed when a loaded file operation moves a row", async () => {
    const container = makeContainer()
    const readDir = createReadDir({
      "D:/repo": [
        { name: "src", path: "D:/repo/src", isDirectory: true },
        { name: "tests", path: "D:/repo/tests", isDirectory: true },
      ],
      "D:/repo/src": [{ name: "main.ts", path: "D:/repo/src/main.ts", isFile: true }],
      "D:/repo/tests": [{ name: "fixture.ts", path: "D:/repo/tests/fixture.ts", isFile: true }],
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.expandPath("D:/repo/src")
    await host.expandPath("D:/repo/tests")

    expect(host.applyFileOperation({
      type: "rename_move",
      action: "rename",
      pathBefore: "src/main.ts",
      pathAfter: "tests/main.ts",
    })).toBe(true)

    expect(host.model.getItem("D:/repo/src/main.ts")).toBeNull()
    expect(host.model.getItem("D:/repo/tests/main.ts")?.parent?.uri).toBe("D:/repo/tests")
    expect(host.model.selectedUri).toBe("D:/repo/tests/main.ts")
    expect(host.getFlatItems().map((item) => item.uri)).toEqual([
      "D:/repo",
      "D:/repo/src",
      "D:/repo/tests",
      "D:/repo/tests/fixture.ts",
      "D:/repo/tests/main.ts",
    ])

    host.dispose()
  })

  it("keeps expanded nested children and focus when a loaded directory is moved", async () => {
    const container = makeContainer()
    const readDir = createReadDir({
      "D:/repo": [
        { name: "src", path: "D:/repo/src", isDirectory: true },
        { name: "tests", path: "D:/repo/tests", isDirectory: true },
      ],
      "D:/repo/src": [{ name: "feature", path: "D:/repo/src/feature", isDirectory: true }],
      "D:/repo/src/feature": [{ name: "index.ts", path: "D:/repo/src/feature/index.ts", isFile: true }],
      "D:/repo/tests": [],
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.expandPath("D:/repo/src")
    await host.expandPath("D:/repo/src/feature")
    await host.expandPath("D:/repo/tests")
    host.model.setSelected(host.model.getItem("D:/repo/src/feature/index.ts"))
    host.model.setFocused(host.model.getItem("D:/repo/src/feature/index.ts"))

    expect(host.applyFileOperation({
      type: "rename_move",
      action: "rename",
      pathBefore: "src/feature",
      pathAfter: "tests/feature",
    })).toBe(true)

    expect(host.model.getItem("D:/repo/src/feature")).toBeNull()
    expect(host.model.getItem("D:/repo/tests/feature")?.expanded).toBe(true)
    expect(host.model.getItem("D:/repo/tests/feature/index.ts")?.parent?.uri).toBe("D:/repo/tests/feature")
    expect(host.model.selectedUri).toBe("D:/repo/tests/feature/index.ts")
    expect(host.model.focusedUri).toBe("D:/repo/tests/feature/index.ts")
    expect(host.getFlatItems().map((item) => item.uri)).toEqual([
      "D:/repo",
      "D:/repo/src",
      "D:/repo/tests",
      "D:/repo/tests/feature",
      "D:/repo/tests/feature/index.ts",
    ])

    host.dispose()
  })

  it("subscribes to FileService operation events and applies ExplorerService-style reveal and focus", async () => {
    const container = makeContainer()
    const operationEmitter = new Emitter<FileOperationEventType>()
    const changeEmitter = new Emitter<FileChangesEventType>()
    const readDir = createReadDir({
      "D:/repo": [{ name: "src", path: "D:/repo/src", isDirectory: true }],
      "D:/repo/src": [{ name: "main.ts", path: "D:/repo/src/main.ts", isFile: true }],
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.expandPath("D:/repo/src")
    host.bindFileService({
      onDidRunOperation: operationEmitter.event,
      onDidFilesChange: changeEmitter.event,
    })

    operationEmitter.fire(new FileOperationEvent(
      URI.file("D:/repo/src/main.ts"),
      FileOperation.MOVE,
      stat("D:/repo/src/app.ts"),
    ))
    await Promise.resolve()

    expect(host.model.getItem("D:/repo/src/main.ts")).toBeNull()
    expect(host.model.selectedUri).toBe("D:/repo/src/app.ts")
    expect(host.model.focusedUri).toBe("D:/repo/src/app.ts")
    expect(container.querySelector("[data-uri='D:/repo/src/app.ts']")?.classList.contains("selected")).toBe(true)

    host.dispose()
  })

  it("defers FileService file-change refresh while an editable row is active", async () => {
    vi.useFakeTimers()
    const container = makeContainer()
    const operationEmitter = new Emitter<FileOperationEventType>()
    const changeEmitter = new Emitter<FileChangesEventType>()
    const readDir = createReadDir({
      "D:/repo": [{ name: "src", path: "D:/repo/src", isDirectory: true }],
      "D:/repo/src": [{ name: "main.ts", path: "D:/repo/src/main.ts", isFile: true }],
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.expandPath("D:/repo/src")
    readDir.mockClear()
    host.bindFileService({
      onDidRunOperation: operationEmitter.event,
      onDidFilesChange: changeEmitter.event,
    })
    await host.startRename("D:/repo/src/main.ts")

    changeEmitter.fire(new FileChangesEvent([
      { type: FileChangeType.DELETED, resource: URI.file("D:/repo/src/main.ts") },
    ], true))
    await vi.runAllTimersAsync()
    expect(readDir).not.toHaveBeenCalled()

    host.clearEditable(false)
    await expect(host.flushFileServiceChanges()).resolves.toBe(true)
    expect(readDir).toHaveBeenCalledWith("D:/repo")
    expect(readDir).toHaveBeenCalledWith("D:/repo/src")

    host.dispose()
    vi.useRealTimers()
  })

  it("focuses the next visible explorer row after deleting the selected row", async () => {
    const container = makeContainer()
    const readDir = createReadDir({
      "D:/repo": [
        { name: "a.ts", path: "D:/repo/a.ts", isFile: true },
        { name: "b.ts", path: "D:/repo/b.ts", isFile: true },
        { name: "c.ts", path: "D:/repo/c.ts", isFile: true },
      ],
    })
    const host = new ExplorerTreeHost({ container, readDir })

    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.revealPath("D:/repo/b.ts")
    host.model.setSelected(host.model.getItem("D:/repo/b.ts"))
    host.model.setFocused(host.model.getItem("D:/repo/b.ts"))

    expect(host.applyFileOperation({
      type: "delete_file",
      action: "delete",
      pathBefore: "b.ts",
    })).toBe(true)

    expect(host.model.getItem("D:/repo/b.ts")).toBeNull()
    expect(host.model.selectedUri).toBe("D:/repo/c.ts")
    expect(host.model.focusedUri).toBe("D:/repo/c.ts")
    expect(container.querySelector("[data-uri='D:/repo/c.ts']")?.classList.contains("selected")).toBe(true)

    host.dispose()
  })
})

function stat(path: string, isDirectory = false): IFileStatWithMetadata {
  return {
    resource: URI.file(path),
    name: path.split(/[\\/]/).pop() || path,
    type: isDirectory ? FileType.Directory : FileType.File,
    isFile: !isDirectory,
    isDirectory,
    isSymbolicLink: false,
    mtime: 1,
    ctime: 1,
    size: 1,
    etag: "1",
    readonly: false,
    locked: false,
    executable: false,
    children: undefined,
  }
}
