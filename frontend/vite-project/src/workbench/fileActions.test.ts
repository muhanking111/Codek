import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearCommands, executeCommand, getCommand } from "./commandRegistry"
import {
  copyEntry,
  cutEntry,
  getExplorerFileActionOwnerEvidence,
  inlineCreate,
  isEditorDefaultPlaceholder,
  openFile,
  openTerminalAtEntry,
  pasteEntry,
  registerExplorerCommands,
  renameEntry,
  saveFile,
  type FileActionContext,
} from "./fileActions"
import { globalWorkbenchExplorerEditorService } from "./workbenchExplorerEditorService"

function createSaveContext(editorValue: string, workspaceValue: string) {
  const saved = vi.fn(async () => true)
  const updateFile = vi.fn()
  const refreshActiveAnalysis = vi.fn(async () => undefined)
  const context: FileActionContext = {
    workspace: {
      activeFile: "src/main.ts",
      projectRoot: "D:/Workspace",
      files: {
        "src/main.ts": workspaceValue,
      },
    },
    workspaceManager: {
      openFile: vi.fn(async () => true),
      saveFile: saved,
      addFile: vi.fn(),
      createFile: vi.fn(async () => true),
      createDir: vi.fn(async () => true),
      deleteFile: vi.fn(async () => true),
      renameEntry: vi.fn(async () => true),
      copyEntry: vi.fn(() => true),
      cutEntry: vi.fn(() => true),
      pasteEntry: vi.fn(async () => "src/main copy.ts"),
      revealPath: vi.fn(async () => true),
      showItemInFolder: vi.fn(async () => true),
      refreshFileTree: vi.fn(async () => undefined),
      updateFile,
      markClean: vi.fn(),
      readProjectFile: vi.fn(async () => workspaceValue),
      getRelativePath: vi.fn((path: string) => path),
      getLargeFileState: vi.fn(() => null),
      entryExists: vi.fn(async () => false),
    },
    getEditor: () => ({
      getValue: () => editorValue,
    }),
    getOpenFiles: () => ["src/main.ts"],
    isDirty: () => true,
    isRealFS: () => true,
    isFormatOnSave: () => false,
    isLintOnSave: () => false,
    setSuppressEditorSync: vi.fn(),
    syncEditorFromWorkspace: vi.fn(),
    refreshActiveAnalysis,
    loadFormatManager: vi.fn(async () => ({ formatFile: vi.fn(async () => ({ success: false })) })),
    loadLintManager: vi.fn(async () => ({ lintFile: vi.fn(async () => []) })),
    problemState: {
      addLintDiagnostics: vi.fn(),
    },
    setSelectedDir: vi.fn(),
    setSelectedTree: vi.fn(),
    confirmDelete: vi.fn(() => true),
    promptRename: vi.fn((_path: string, currentName: string) => `${currentName}.bak`),
    copyText: vi.fn(),
    openTerminalAtPath: vi.fn(),
    notifyLspFileOpened: vi.fn(),
    joinRelativePath: vi.fn((parentPath: string, name: string) => `${parentPath}/${name}`),
    reportOpenFileStage: vi.fn(),
  }
  return { context, saved, updateFile, refreshActiveAnalysis }
}

describe("fileActions save protection", () => {
  it("detects localized editor placeholder content", () => {
    expect(isEditorDefaultPlaceholder('// 打开一个项目或创建文件以开始。\nconsole.log("你好 Codek")')).toBe(true)
    expect(isEditorDefaultPlaceholder("export function greet() {}")).toBe(false)
  })

  it("does not overwrite a loaded real file with the editor startup placeholder", async () => {
    const workspaceValue = "export function greet(name: string) { return name }\n"
    const editorValue = '// 打开一个项目或创建文件以开始。\nconsole.log("你好 Codek")'
    const { context, saved, updateFile } = createSaveContext(editorValue, workspaceValue)

    await expect(saveFile("src/main.ts", context)).resolves.toBe(true)

    expect(saved).toHaveBeenCalledWith("src/main.ts", workspaceValue)
    expect(updateFile).toHaveBeenCalledWith("src/main.ts", workspaceValue, { dirty: false, external: false })
  })
})

describe("explorer file commands", () => {
  beforeEach(() => {
    clearCommands()
    globalWorkbenchExplorerEditorService.replaceEditorGroupStateFromOpenFiles({ openFiles: [] })
  })

  it("registers VS Code style Explorer commands through the shared registry", async () => {
    const { context } = createSaveContext("export {}", "export {}")
    registerExplorerCommands(context)

    expect(getCommand("explorer.newFile")?.title).toBe("新建文件")
    expect(getCommand("explorer.rename")?.category).toBe("Explorer")
    expect(await executeCommand("explorer.refresh", [], { explorerVisible: true })).toBe(true)
    expect(context.workspaceManager.refreshFileTree).toHaveBeenCalled()
  })

  it("exposes owner evidence for non-mutating Explorer open actions without a second state source", () => {
    expect(getExplorerFileActionOwnerEvidence("open")).toEqual({
      explorerOwner: "FileTree",
      fileServiceOwner: "workspaceManager.openFile",
      operationSource: "explorer.open",
      resourceUriKind: "workspace-relative",
      readonlyGuard: "read-only-open-allowed",
      destructiveGuard: "not-destructive",
      remainingUiOwnerGap: "service-evidence-only",
    })
  })

  it("renames an entry by prompting for a new basename", async () => {
    const { context } = createSaveContext("export {}", "export {}")

    await renameEntry("src/main.ts", context)

    expect(context.promptRename).toHaveBeenCalledWith("src/main.ts", "main.ts")
    expect(context.workspaceManager.renameEntry).toHaveBeenCalledWith("src/main.ts", "src/main.ts.bak")
  })

  it("uses shared copy cut paste operations", async () => {
    const { context } = createSaveContext("export {}", "export {}")

    await copyEntry("src/main.ts", context)
    await cutEntry("src/old.ts", context)
    await pasteEntry("src", context)

    expect(context.workspaceManager.copyEntry).toHaveBeenCalledWith("src/main.ts")
    expect(context.workspaceManager.cutEntry).toHaveBeenCalledWith("src/old.ts")
    expect(context.workspaceManager.pasteEntry).toHaveBeenCalledWith("src")
    expect(context.workspaceManager.refreshFileTree).toHaveBeenCalled()
  })

  it("projects successful file opens into the service-backed editor group state", async () => {
    const { context } = createSaveContext("export {}", "export {}")
    context.workspace.activeFile = "src/app.ts"
    context.workspace.files["src/app.ts"] = "export const app = true"
    context.workspaceManager.openFile = vi.fn(async (path: string) => {
      context.workspace.activeFile = path
      context.workspace.files[path] = "export const app = true"
      return true
    })

    await expect(openFile("src/app.ts", context)).resolves.toBe(true)

    expect(context.reportOpenFileStage).toHaveBeenCalledWith("start", expect.objectContaining({
      path: "src/app.ts",
      explorerOwner: "FileTree",
      fileServiceOwner: "workspaceManager.openFile",
      operationSource: "explorer.open",
      destructiveGuard: "not-destructive",
    }))
    expect(globalWorkbenchExplorerEditorService.getOpenEditorsModel()).toEqual(expect.objectContaining({
      activeEditor: "src/app.ts",
      entries: [expect.objectContaining({ path: "src/app.ts" })],
    }))
  })

  it("opens editor content before slow analysis and LSP work finishes", async () => {
    const { context } = createSaveContext("export {}", "export {}")
    let releaseAnalysis: (() => void) | null = null
    context.isDirty = () => false
    context.refreshActiveAnalysis = vi.fn(() => new Promise((resolve) => {
      releaseAnalysis = () => resolve(undefined)
    }))
    context.workspaceManager.readProjectFile = vi.fn((): Promise<string> => new Promise(() => {}))

    await expect(openFile("src/main.ts", context)).resolves.toBe(true)

    expect(context.workspaceManager.openFile).toHaveBeenCalledWith("src/main.ts")
    expect(context.syncEditorFromWorkspace).toHaveBeenCalled()
    expect(context.setSelectedTree).toHaveBeenCalledWith("src/main.ts", "file")
    expect(context.refreshActiveAnalysis).toHaveBeenCalledWith("src/main.ts")
    releaseAnalysis?.()
  })

  it("does not let stale open-file background work run after a newer file wins", async () => {
    const { context } = createSaveContext("export {}", "export {}")
    context.isDirty = () => false
    context.workspace.activeFile = null
    context.workspace.files = {}
    let releaseSlowOpen: ((value: boolean) => void) | null = null
    context.workspaceManager.openFile = vi.fn(async (path: string) => {
      if (path.endsWith("slow.ts")) {
        await new Promise<boolean>((resolve) => {
          releaseSlowOpen = resolve
        })
      }
      context.workspace.activeFile = path
      context.workspace.files[path] = path.endsWith("slow.ts")
        ? "export const slow = true\n"
        : "export const fast = true\n"
      return true
    })
    context.workspaceManager.readProjectFile = vi.fn(async (path: string) => `content for ${path}`)
    context.refreshActiveAnalysis = vi.fn(async () => undefined)
    context.notifyLspFileOpened = vi.fn(async () => undefined)

    const slowOpen = openFile("src/slow.ts", context)
    await Promise.resolve()
    await expect(openFile("src/fast.ts", context)).resolves.toBe(true)
    releaseSlowOpen?.(true)
    await expect(slowOpen).resolves.toBe(false)

    expect(context.refreshActiveAnalysis).toHaveBeenCalledWith("src/fast.ts")
    expect(context.refreshActiveAnalysis).not.toHaveBeenCalledWith("src/slow.ts")
    expect(context.workspaceManager.readProjectFile).not.toHaveBeenCalledWith("src/slow.ts")
    expect(context.notifyLspFileOpened).not.toHaveBeenCalledWith("src/slow.ts", expect.any(String))
    expect(context.notifyLspFileOpened).toHaveBeenCalledWith("src/fast.ts", "content for src/fast.ts")
  })

  it("resyncs the editor surface when a blocked binary file removes stale active editor state", async () => {
    const { context } = createSaveContext("\0stale binary", "export const alive = true\n")
    context.isDirty = () => false
    context.workspace.activeFile = "vscode/.build/electron/locales/af.pak"
    context.workspace.files = {
      "src/main.ts": "export const alive = true\n",
      "vscode/.build/electron/locales/af.pak": "\0stale binary",
    }
    context.workspaceManager.openFile = vi.fn(async () => {
      delete context.workspace.files["vscode/.build/electron/locales/af.pak"]
      context.workspace.activeFile = "src/main.ts"
      return false
    })

    await expect(openFile("vscode/.build/electron/locales/af.pak", context)).resolves.toBe(false)

    expect(context.syncEditorFromWorkspace).toHaveBeenCalled()
    expect(context.setSelectedTree).not.toHaveBeenCalledWith("vscode/.build/electron/locales/af.pak", "file")
    expect(context.refreshActiveAnalysis).not.toHaveBeenCalledWith("vscode/.build/electron/locales/af.pak")
  })

  it("does not block file opening when LSP open hangs after reading content", async () => {
    const { context } = createSaveContext("export {}", "export {}")
    context.isDirty = () => false
    context.workspaceManager.readProjectFile = vi.fn(async () => "export const ready = true\n")
    context.notifyLspFileOpened = vi.fn(() => new Promise<void>(() => {}))

    await expect(openFile("src/main.ts", context)).resolves.toBe(true)

    expect(context.workspaceManager.openFile).toHaveBeenCalledWith("src/main.ts")
    expect(context.workspaceManager.readProjectFile).toHaveBeenCalledWith("src/main.ts")
    expect(context.notifyLspFileOpened).toHaveBeenCalledWith("src/main.ts", "export const ready = true\n")
  })

  it("does not notify LSP for range-window large files", async () => {
    const { context } = createSaveContext("export {}", "export {}")
    context.isDirty = () => false
    context.workspaceManager.openFile = vi.fn(async (path: string) => {
      context.workspace.activeFile = path
      context.workspace.files[path] = "large window\n"
      return true
    })
    context.workspaceManager.getLargeFileState = vi.fn(() => ({ mode: "range", readOnly: true }))

    await expect(openFile("src/huge.ts", context)).resolves.toBe(true)

    expect(context.workspaceManager.readProjectFile).not.toHaveBeenCalled()
    expect(context.notifyLspFileOpened).not.toHaveBeenCalled()
  })

  it("skips heavy mount retries and analysis for range-window large files", async () => {
    const { context } = createSaveContext("", "large window\n")
    context.isDirty = () => false
    context.workspace.activeFile = null
    context.workspace.files = {}
    context.workspaceManager.openFile = vi.fn(async (path: string) => {
      context.workspace.activeFile = path
      context.workspace.files[path] = "large window\n"
      return true
    })
    context.workspaceManager.getLargeFileState = vi.fn(() => ({ mode: "range", readOnly: false }))
    context.getEditor = () => ({
      getValue: () => "",
    })
    context.syncEditorFromWorkspace = vi.fn()
    context.ensureEditorContentVisible = vi.fn(async () => false)
    context.refreshActiveAnalysis = vi.fn(async () => undefined)

    await expect(openFile("src/huge.ts", context)).resolves.toBe(true)

    expect(context.syncEditorFromWorkspace).toHaveBeenCalledTimes(1)
    expect(context.ensureEditorContentVisible).not.toHaveBeenCalled()
    expect(context.refreshActiveAnalysis).not.toHaveBeenCalled()
    expect(context.workspaceManager.readProjectFile).not.toHaveBeenCalled()
    expect(context.notifyLspFileOpened).not.toHaveBeenCalled()
  })

  it("opens optimized large files without calling heap-heavy editor getValue", async () => {
    const { context } = createSaveContext("", "large optimized window\n")
    const getValue = vi.fn(() => {
      throw new Error("optimized large-file open must not call editor.getValue()")
    })
    context.isDirty = () => false
    context.workspace.activeFile = null
    context.workspace.files = {}
    context.workspaceManager.openFile = vi.fn(async (path: string) => {
      context.workspace.activeFile = path
      context.workspace.files[path] = "large optimized window\n"
      return true
    })
    context.workspaceManager.getLargeFileState = vi.fn(() => ({
      mode: "optimized",
      readOnly: false,
      size: 260 * 1024 * 1024,
      bytesRead: 260 * 1024 * 1024,
    }))
    context.getEditor = () => ({
      getValue,
      getModel: () => ({
        getValueLength: () => 260 * 1024 * 1024,
      }),
    })
    context.syncEditorFromWorkspace = vi.fn()
    context.ensureEditorContentVisible = vi.fn(async () => false)
    context.refreshActiveAnalysis = vi.fn(async () => undefined)

    await expect(openFile("src/huge.ts", context)).resolves.toBe(true)
    await Promise.resolve()

    expect(context.syncEditorFromWorkspace).toHaveBeenCalledTimes(1)
    expect(getValue).not.toHaveBeenCalled()
    expect(context.ensureEditorContentVisible).not.toHaveBeenCalled()
    expect(context.refreshActiveAnalysis).not.toHaveBeenCalled()
    expect(context.workspaceManager.readProjectFile).not.toHaveBeenCalled()
    expect(context.notifyLspFileOpened).not.toHaveBeenCalled()
  })

  it("waits for the opened file content to mount in the editor before resolving", async () => {
    const { context } = createSaveContext("", "export const mounted = true\n")
    let editorValue = ""
    context.isDirty = () => false
    context.workspace.activeFile = null
    context.workspace.files = {}
    context.workspaceManager.openFile = vi.fn(async (path: string) => {
      context.workspace.activeFile = path
      context.workspace.files[path] = "export const mounted = true\n"
      return true
    })
    context.getEditor = () => ({
      getValue: () => editorValue,
    })
    let syncCalls = 0
    context.syncEditorFromWorkspace = vi.fn(() => {
      syncCalls += 1
      if (syncCalls >= 2) {
        editorValue = String(context.workspace.files["src/main.ts"])
      }
    })

    await expect(openFile("src/main.ts", context)).resolves.toBe(true)

    expect(context.syncEditorFromWorkspace).toHaveBeenCalled()
    expect(context.setSelectedTree).toHaveBeenCalledWith("src/main.ts", "file")
  })

  it("does not block open when the editor has not been created yet", async () => {
    const { context } = createSaveContext("", "export const mounted = true\n")
    context.isDirty = () => false
    context.workspace.activeFile = null
    context.workspace.files = {}
    context.workspaceManager.openFile = vi.fn(async (path: string) => {
      context.workspace.activeFile = path
      context.workspace.files[path] = "export const mounted = true\n"
      return true
    })
    context.getEditor = () => ({})
    context.ensureEditorContentVisible = vi.fn(async () => false)

    await expect(openFile("src/main.ts", context)).resolves.toBe(true)

    expect(context.workspaceManager.openFile).toHaveBeenCalledWith("src/main.ts")
    expect(context.setSelectedTree).toHaveBeenCalledWith("src/main.ts", "file")
    expect(context.refreshActiveAnalysis).toHaveBeenCalledWith("src/main.ts")
  })

  it("stops stale editor-mount retries after the user opens another file", async () => {
    vi.useFakeTimers()
    try {
      const { context } = createSaveContext("", "export const mounted = true\n")
      const syncCalls: string[] = []
      context.isDirty = () => false
      context.workspace.activeFile = null
      context.workspace.files = {}
      context.workspaceManager.openFile = vi.fn(async (path: string) => {
        context.workspace.activeFile = path
        context.workspace.files[path] = path.endsWith("first.ts")
          ? "export const first = true\n"
          : "export const second = true\n"
        return true
      })
      context.getEditor = () => ({
        getValue: () => "",
      })
      context.syncEditorFromWorkspace = vi.fn(() => {
        syncCalls.push(String(context.workspace.activeFile || ""))
      })

      await expect(openFile("src/first.ts", context)).resolves.toBe(true)
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(20)
      const firstSyncCountBeforeSecondOpen = syncCalls.filter((path) => path === "src/first.ts").length

      await expect(openFile("src/second.ts", context)).resolves.toBe(true)
      await vi.advanceTimersByTimeAsync(250)

      expect(syncCalls.filter((path) => path === "src/first.ts").length).toBe(firstSyncCountBeforeSecondOpen)
      expect(syncCalls.filter((path) => path === "src/second.ts").length).toBeGreaterThanOrEqual(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("waits for the opened file content to be visibly rendered when the workbench provides a DOM probe", async () => {
    const { context } = createSaveContext("export const mounted = true\n", "export const mounted = true\n")
    context.isDirty = () => false
    context.workspace.activeFile = null
    context.workspace.files = {}
    context.workspaceManager.openFile = vi.fn(async (path: string) => {
      context.workspace.activeFile = path
      context.workspace.files[path] = "export const mounted = true\n"
      return true
    })
    context.getEditor = () => ({})
    const visibleProbe = vi.fn(async () => visibleProbe.mock.calls.length >= 2)
    context.ensureEditorContentVisible = visibleProbe

    await expect(openFile("src/main.ts", context)).resolves.toBe(true)

    expect(visibleProbe).toHaveBeenCalledTimes(2)
    expect(visibleProbe).toHaveBeenCalledWith("src/main.ts", "export const mounted = true\n")
  })

  it("can require visible editor content before resolving validation opens", async () => {
    const { context } = createSaveContext("export const mounted = true\n", "export const mounted = true\n")
    context.isDirty = () => false
    context.workspace.activeFile = null
    context.workspace.files = {}
    context.workspaceManager.openFile = vi.fn(async (path: string) => {
      context.workspace.activeFile = path
      context.workspace.files[path] = "export const mounted = true\n"
      return true
    })
    context.getEditor = () => ({})
    context.shouldBlockUntilEditorContentVisible = () => true
    const visibleProbe = vi.fn(async () => visibleProbe.mock.calls.length >= 3)
    context.ensureEditorContentVisible = visibleProbe

    await expect(openFile("src/main.ts", context)).resolves.toBe(true)

    expect(visibleProbe).toHaveBeenCalledTimes(3)
    expect(context.refreshActiveAnalysis).toHaveBeenCalledWith("src/main.ts")
  })

  it("does not force visible content before the editor exists on cold validation opens", async () => {
    const { context } = createSaveContext("export const mounted = true\n", "export const mounted = true\n")
    context.isDirty = () => false
    context.workspace.activeFile = null
    context.workspace.files = {}
    context.workspaceManager.openFile = vi.fn(async (path: string) => {
      context.workspace.activeFile = path
      context.workspace.files[path] = "export const mounted = true\n"
      return true
    })
    context.getEditor = () => null
    context.shouldBlockUntilEditorContentVisible = () => true
    const visibleProbe = vi.fn(async () => false)
    context.ensureEditorContentVisible = visibleProbe

    await expect(openFile("src/main.ts", context)).resolves.toBe(true)

    expect(visibleProbe).not.toHaveBeenCalled()
    expect(context.refreshActiveAnalysis).toHaveBeenCalledWith("src/main.ts")
  })

  it("does not hang when the visible editor probe stops responding", async () => {
    const { context } = createSaveContext("export const mounted = true\n", "export const mounted = true\n")
    context.isDirty = () => false
    context.workspace.activeFile = null
    context.workspace.files = {}
    context.workspaceManager.openFile = vi.fn(async (path: string) => {
      context.workspace.activeFile = path
      context.workspace.files[path] = "export const mounted = true\n"
      return true
    })
    context.ensureEditorContentVisible = vi.fn(() => new Promise<boolean>(() => {}))

    await expect(openFile("src/main.ts", context)).resolves.toBe(true)

    expect(context.workspaceManager.openFile).toHaveBeenCalledWith("src/main.ts")
    expect(context.setSelectedTree).toHaveBeenCalledWith("src/main.ts", "file")
    expect(context.refreshActiveAnalysis).toHaveBeenCalledWith("src/main.ts")
  })

  it("opens Explorer terminal through the shared terminal action instead of writing output", async () => {
    const { context } = createSaveContext("export {}", "export {}")

    await openTerminalAtEntry("src/main.ts", context)

    expect(context.openTerminalAtPath).toHaveBeenCalledWith("src/main.ts")
  })

  it("keeps create selection anchored after creating a file", async () => {
    const { context } = createSaveContext("export {}", "export {}")

    await inlineCreate({
      type: "file",
      parentPath: "scripts",
      name: "new-tool.js",
      targetSnapshot: {
        workspaceRoot: "D:/Workspace",
        rootLabel: "Codek",
        parentPath: "scripts",
        parentLabel: "scripts",
        parentKind: "directory",
        source: "selected-directory",
        selectedPathAtStart: "scripts",
        activeFileAtStart: "src/main.ts",
        displayLabel: "scripts",
        resolvedAbsoluteParent: "D:/Workspace/scripts",
      },
    }, context)

    expect(context.workspaceManager.createFile).toHaveBeenCalledWith(
      "scripts/new-tool.js",
      "\n".repeat(9),
      expect.objectContaining({ openAfterCreate: true }),
    )
    expect(context.workspaceManager.refreshFileTree).toHaveBeenCalled()
    expect(context.workspaceManager.revealPath).toHaveBeenCalledWith("scripts/new-tool.js")
    expect(context.setSelectedTree).toHaveBeenCalledWith("scripts/new-tool.js", "file")
    expect(context.setSelectedDir).toHaveBeenCalledWith("scripts")
  })

  it("normalizes inline create names with VS Code editable filename rules", async () => {
    const { context } = createSaveContext("export {}", "export {}")

    await inlineCreate({
      type: "file",
      parentPath: "scripts",
      name: "\ttools/new-tool.js/",
      targetSnapshot: {
        workspaceRoot: "D:/Workspace",
        rootLabel: "Codek",
        parentPath: "scripts",
        parentLabel: "scripts",
        parentKind: "directory",
        source: "selected-directory",
        selectedPathAtStart: "scripts",
        activeFileAtStart: "src/main.ts",
        displayLabel: "scripts",
        resolvedAbsoluteParent: "D:/Workspace/scripts",
      },
    }, context)

    expect(context.workspaceManager.createFile).toHaveBeenCalledWith(
      "scripts/tools/new-tool.js",
      "\n".repeat(9),
      expect.objectContaining({ openAfterCreate: true }),
    )
  })

  it("rejects invalid inline create names before touching the filesystem", async () => {
    const { context } = createSaveContext("export {}", "export {}")

    await expect(inlineCreate({
      type: "file",
      parentPath: "scripts",
      name: "bad:name.ts",
      targetSnapshot: {
        workspaceRoot: "D:/Workspace",
        rootLabel: "Codek",
        parentPath: "scripts",
        parentLabel: "scripts",
        parentKind: "directory",
        source: "selected-directory",
        selectedPathAtStart: "scripts",
        activeFileAtStart: "src/main.ts",
        displayLabel: "scripts",
        resolvedAbsoluteParent: "D:/Workspace/scripts",
      },
    }, context)).rejects.toThrow("not valid")

    expect(context.workspaceManager.createFile).not.toHaveBeenCalled()
    expect(context.workspaceManager.createDir).not.toHaveBeenCalled()
  })

  it("rejects duplicate inline create names using the workspace entry check", async () => {
    const { context } = createSaveContext("export {}", "export {}")
    context.workspaceManager.entryExists = vi.fn(async (path: string) => path === "scripts/existing.ts")

    await expect(inlineCreate({
      type: "file",
      parentPath: "scripts",
      name: "existing.ts",
      targetSnapshot: {
        workspaceRoot: "D:/Workspace",
        rootLabel: "Codek",
        parentPath: "scripts",
        parentLabel: "scripts",
        parentKind: "directory",
        source: "selected-directory",
        selectedPathAtStart: "scripts",
        activeFileAtStart: "src/main.ts",
        displayLabel: "scripts",
        resolvedAbsoluteParent: "D:/Workspace/scripts",
      },
    }, context)).rejects.toThrow("already exists")

    expect(context.workspaceManager.entryExists).toHaveBeenCalledWith("scripts/existing.ts")
    expect(context.workspaceManager.createFile).not.toHaveBeenCalled()
  })

  it("keeps create selection anchored after creating a folder", async () => {
    const { context } = createSaveContext("export {}", "export {}")

    await inlineCreate({
      type: "folder",
      parentPath: "scripts",
      name: "generated",
      targetSnapshot: {
        workspaceRoot: "D:/Workspace",
        rootLabel: "Codek",
        parentPath: "scripts",
        parentLabel: "scripts",
        parentKind: "directory",
        source: "selected-directory",
        selectedPathAtStart: "scripts",
        activeFileAtStart: "src/main.ts",
        displayLabel: "scripts",
        resolvedAbsoluteParent: "D:/Workspace/scripts",
      },
    }, context)

    expect(context.workspaceManager.createDir).toHaveBeenCalledWith("scripts/generated")
    expect(context.workspaceManager.refreshFileTree).toHaveBeenCalled()
    expect(context.workspaceManager.revealPath).toHaveBeenCalledWith("scripts/generated")
    expect(context.setSelectedDir).toHaveBeenCalledWith("scripts/generated")
    expect(context.setSelectedTree).toHaveBeenCalledWith("scripts/generated", "dir")
  })

  it("rejects mismatched create snapshots instead of silently creating elsewhere", async () => {
    const { context } = createSaveContext("export {}", "export {}")

    await expect(inlineCreate({
      type: "file",
      parentPath: "apps",
      name: "wrong.ts",
      targetSnapshot: {
        workspaceRoot: "D:/Workspace",
        rootLabel: "Codek",
        parentPath: "libs",
        parentLabel: "libs",
        parentKind: "directory",
        source: "selected-directory",
        selectedPathAtStart: "libs",
        activeFileAtStart: "src/main.ts",
        displayLabel: "libs",
        resolvedAbsoluteParent: "D:/Workspace/libs",
      },
    }, context)).rejects.toThrow("创建目标快照不一致")

    expect(context.workspaceManager.createFile).not.toHaveBeenCalled()
  })

  it("rejects invalid rename names before calling workspace rename", async () => {
    const { context } = createSaveContext("export {}", "export {}")
    context.promptRename = vi.fn(() => "con")

    await expect(renameEntry("src/main.ts", context)).resolves.toBe(false)

    expect(context.workspaceManager.renameEntry).not.toHaveBeenCalled()
  })

  it("rejects duplicate rename targets using the workspace entry check", async () => {
    const { context } = createSaveContext("export {}", "export {}")
    context.promptRename = vi.fn(() => "existing.ts")
    context.workspaceManager.entryExists = vi.fn(async (path: string) => path === "src/existing.ts")

    await expect(renameEntry("src/main.ts", context)).resolves.toBe(false)

    expect(context.workspaceManager.entryExists).toHaveBeenCalledWith("src/existing.ts")
    expect(context.workspaceManager.renameEntry).not.toHaveBeenCalled()
  })
})
