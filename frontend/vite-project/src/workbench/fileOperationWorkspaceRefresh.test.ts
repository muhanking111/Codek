import { describe, expect, it, vi } from "vitest"
import {
  FileChangeType,
} from "../vscode-adapter/platform/files/common/files"
import {
  URI,
} from "../vscode-adapter/base/common/uri"
import {
  createWorkspaceOperationRefreshScheduler,
  createWorkspaceOperationRefreshPlan,
  createWorkspaceOperationFileChangesEvent,
  getWorkspaceOperationFileChanges,
  getWorkspaceOperationRefreshDelay,
  getWorkspaceOperationRefreshPaths,
  getWorkspaceOperationAnalysisPaths,
  isActiveFileAffectedByWorkspaceOperation,
  normalizeWorkspaceOperationPath,
  shouldRefreshExplorerForWorkspaceOperation,
  WORKSPACE_OPERATION_STRUCTURAL_REFRESH_DELAY_MS,
  WORKSPACE_OPERATION_UPDATE_REFRESH_DELAY_MS,
} from "./fileOperationWorkspaceRefresh"

describe("fileOperationWorkspaceRefresh", () => {
  it("normalizes operation paths through the workspace path normalizer when available", () => {
    const normalizePath = vi.fn((path: string) => path.replace(/\\/g, "/").replace(/^src\//, "app/"))

    expect(normalizeWorkspaceOperationPath("src\\main.ts", normalizePath)).toBe("app/main.ts")
    expect(normalizePath).toHaveBeenCalledWith("src\\main.ts")
  })

  it("falls back to safe slash normalization when workspace normalization rejects a path", () => {
    const normalizePath = vi.fn(() => {
      throw new Error("bad path")
    })

    expect(normalizeWorkspaceOperationPath(".\\src\\main.ts", normalizePath)).toBe("src/main.ts")
  })

  it("deduplicates path, pathBefore, and pathAfter for batched refreshes", () => {
    expect(getWorkspaceOperationRefreshPaths({
      path: "src/main.ts",
      pathBefore: "src/main.ts",
      pathAfter: "src/main.ts",
    })).toEqual(["src/main.ts"])
  })

  it("maps workspace operations to VS Code file change events", () => {
    const changes = getWorkspaceOperationFileChanges({
      type: "rename_move",
      pathBefore: "src/old.ts",
      pathAfter: "src/new.ts",
    })

    expect(changes.map((change) => [change.type, change.resource.path])).toEqual([
      [FileChangeType.DELETED, "/src/old.ts"],
      [FileChangeType.ADDED, "/src/new.ts"],
    ])
  })

  it("uses VS Code deleted-parent semantics for folder operations affecting active files", () => {
    const event = createWorkspaceOperationFileChangesEvent({
      type: "delete_file",
      pathBefore: "src/generated",
    })

    expect(event.contains(URI.from({ scheme: "codek-workspace", path: "/src/generated/page.ts" }))).toBe(true)
  })

  it("does not refresh the explorer for plain file updates", () => {
    expect(shouldRefreshExplorerForWorkspaceOperation({
      type: "update_file",
      action: "write",
    })).toBe(false)
  })

  it("refreshes the explorer for create, delete, and rename operations", () => {
    expect(shouldRefreshExplorerForWorkspaceOperation({ type: "create_file" })).toBe(true)
    expect(shouldRefreshExplorerForWorkspaceOperation({ type: "create_folder" })).toBe(true)
    expect(shouldRefreshExplorerForWorkspaceOperation({ type: "delete_file" })).toBe(true)
    expect(shouldRefreshExplorerForWorkspaceOperation({ type: "rename_move" })).toBe(true)
    expect(shouldRefreshExplorerForWorkspaceOperation({ action: "rename" })).toBe(true)
  })

  it("excludes created folders from file analysis paths", () => {
    expect(getWorkspaceOperationAnalysisPaths({
      type: "create_folder",
      path: "src/generated",
      pathAfter: "src/generated",
    })).toEqual([])
    expect(getWorkspaceOperationAnalysisPaths({
      type: "create_file",
      path: "src/generated/page.ts",
    })).toEqual(["src/generated/page.ts"])
  })

  it("marks active files affected by either side of a rename operation", () => {
    const paths = getWorkspaceOperationRefreshPaths({
      type: "rename_move",
      pathBefore: "src/old.ts",
      pathAfter: "src/new.ts",
    })

    expect(isActiveFileAffectedByWorkspaceOperation("src/old.ts", paths)).toBe(true)
    expect(isActiveFileAffectedByWorkspaceOperation("src/new.ts", paths)).toBe(true)
    expect(isActiveFileAffectedByWorkspaceOperation("src/other.ts", paths)).toBe(false)
  })

  it("marks active child files affected when their parent folder is deleted or renamed", () => {
    expect(isActiveFileAffectedByWorkspaceOperation(
      "SRC/OLD/page.ts",
      ["src/old"],
      undefined,
      { type: "rename_move", pathBefore: "src/old", pathAfter: "src/new" },
    )).toBe(true)
    expect(isActiveFileAffectedByWorkspaceOperation(
      "src/generated/page.ts",
      ["src/generated"],
      undefined,
      { type: "delete_file", pathBefore: "src/generated" },
    )).toBe(true)
  })

  it("creates a complete refresh plan for workspace file operation events", () => {
    expect(createWorkspaceOperationRefreshPlan({
      type: "delete_file",
      pathBefore: "src/remove.ts",
      explorerOwner: "ExplorerService",
      fileServiceOwner: "IFileService",
      operationSource: "explorer.context.delete",
      resourceUriKind: "workspace-relative",
      readonlyGuard: "writable",
      destructiveGuard: "confirmed",
      remainingUiOwnerGap: "service-evidence-only",
    }, "src/remove.ts")).toEqual({
      paths: ["src/remove.ts"],
      refreshExplorer: true,
      activeFileAffected: true,
    })
  })

  it("keeps owner evidence stable while deriving refresh paths", () => {
    const payload = {
      type: "rename_move",
      action: "rename",
      pathBefore: "src/old.ts",
      pathAfter: "src/new.ts",
      explorerOwner: "ExplorerService",
      fileServiceOwner: "IFileService",
      operationSource: "FileService.onDidRunOperation",
      resourceUriKind: "file-uri",
      readonlyGuard: "writable",
      destructiveGuard: "not-destructive",
      remainingUiOwnerGap: "service-evidence-only",
    }

    expect(getWorkspaceOperationRefreshPaths(payload)).toEqual(["src/old.ts", "src/new.ts"])
    expect(createWorkspaceOperationRefreshPlan(payload, "src/new.ts")).toEqual({
      paths: ["src/old.ts", "src/new.ts"],
      refreshExplorer: true,
      activeFileAffected: true,
    })
  })

  it("uses a short delay for structural explorer operations", () => {
    const plan = createWorkspaceOperationRefreshPlan({
      type: "create_file",
      path: "src/new.ts",
    })

    expect(getWorkspaceOperationRefreshDelay(plan)).toBe(WORKSPACE_OPERATION_STRUCTURAL_REFRESH_DELAY_MS)
    expect(getWorkspaceOperationRefreshDelay(plan)).toBeLessThan(80)
  })

  it("keeps plain updates on a short UI refresh delay", () => {
    const plan = createWorkspaceOperationRefreshPlan({
      type: "update_file",
      path: "src/existing.ts",
    })

    expect(getWorkspaceOperationRefreshDelay(plan)).toBe(WORKSPACE_OPERATION_UPDATE_REFRESH_DELAY_MS)
    expect(getWorkspaceOperationRefreshDelay(plan)).toBeLessThanOrEqual(40)
  })

  it("batches workspace operation side effects outside App.vue", async () => {
    vi.useFakeTimers()
    const refreshWorkspaceTree = vi.fn(async () => undefined)
    const refreshExplorerHost = vi.fn(async () => undefined)
    const reloadFile = vi.fn(async () => undefined)
    const syncEditorFromWorkspace = vi.fn()
    const refreshActiveAnalysis = vi.fn()
    const refreshScmEditorDecorations = vi.fn()
    const refreshInlineDiff = vi.fn()
    const debugState: Record<string, unknown> = {}
    const scheduler = createWorkspaceOperationRefreshScheduler({
      getActiveFile: () => "src/new.ts",
      getProjectRoot: () => "D:/project",
      getFiles: () => ({}),
      isDirty: () => false,
      normalizePath: (path) => path.replace(/\\/g, "/"),
      refreshWorkspaceTree,
      refreshExplorerHost,
      reloadFile,
      syncEditorFromWorkspace,
      refreshActiveAnalysis,
      refreshScmEditorDecorations,
      refreshInlineDiff,
      setDebugState: (next) => Object.assign(debugState, next),
    })

    scheduler.schedule({ type: "create_file", path: "src/new.ts" })
    scheduler.schedule({ type: "rename_move", pathBefore: "src/old.ts", pathAfter: "src/new.ts" })
    await vi.runAllTimersAsync()

    expect(refreshWorkspaceTree).toHaveBeenCalledTimes(1)
    expect(refreshExplorerHost).toHaveBeenCalledTimes(1)
    expect(reloadFile).toHaveBeenCalledWith("src/new.ts")
    expect(syncEditorFromWorkspace).toHaveBeenCalled()
    expect(refreshActiveAnalysis).toHaveBeenCalledWith("src/new.ts")
    expect(refreshActiveAnalysis).toHaveBeenCalledWith("src/old.ts")
    expect(refreshScmEditorDecorations).toHaveBeenCalled()
    expect(refreshInlineDiff).toHaveBeenCalledWith("src/new.ts")
    expect(debugState).toEqual(expect.objectContaining({
      refreshExplorerFinishedAt: expect.any(Number),
      hasFileTreeRef: true,
    }))
    scheduler.cancel()
    vi.useRealTimers()
  })

  it("applies structural explorer operations optimistically before the batched refresh", async () => {
    vi.useFakeTimers()
    const applyFileOperationToExplorer = vi.fn(async () => true)
    const refreshWorkspaceTree = vi.fn(async () => undefined)
    const refreshExplorerHost = vi.fn(async () => undefined)
    const debugState: Record<string, unknown> = {}
    const scheduler = createWorkspaceOperationRefreshScheduler({
      getActiveFile: () => null,
      getProjectRoot: () => "D:/project",
      getFiles: () => ({}),
      isDirty: () => false,
      normalizePath: (path) => path,
      refreshWorkspaceTree,
      refreshExplorerHost,
      applyFileOperationToExplorer,
      reloadFile: vi.fn(),
      syncEditorFromWorkspace: vi.fn(),
      refreshActiveAnalysis: vi.fn(),
      refreshScmEditorDecorations: vi.fn(),
      refreshInlineDiff: vi.fn(),
      setDebugState: (next) => Object.assign(debugState, next),
    })

    scheduler.schedule({ type: "create_file", path: "src/new.ts", pathAfter: "src/new.ts" })
    await Promise.resolve()

    expect(applyFileOperationToExplorer).toHaveBeenCalledWith({
      type: "create_file",
      path: "src/new.ts",
      pathAfter: "src/new.ts",
    })
    expect(refreshWorkspaceTree).not.toHaveBeenCalled()
    expect(refreshExplorerHost).not.toHaveBeenCalled()
    expect(debugState).toEqual(expect.objectContaining({
      optimisticExplorerApplied: true,
    }))

    await vi.runAllTimersAsync()

    expect(refreshWorkspaceTree).toHaveBeenCalled()
    expect(refreshExplorerHost).toHaveBeenCalled()
    scheduler.cancel()
    vi.useRealTimers()
  })

  it("syncs an already loaded affected active file without reloading it", async () => {
    vi.useFakeTimers()
    const reloadFile = vi.fn()
    const syncEditorFromWorkspace = vi.fn()
    const scheduler = createWorkspaceOperationRefreshScheduler({
      getActiveFile: () => "src/existing.ts",
      getProjectRoot: () => "D:/project",
      getFiles: () => ({ "src/existing.ts": "loaded" }),
      isDirty: () => false,
      normalizePath: (path) => path,
      refreshWorkspaceTree: vi.fn(),
      refreshExplorerHost: vi.fn(),
      reloadFile,
      syncEditorFromWorkspace,
      refreshActiveAnalysis: vi.fn(),
      refreshScmEditorDecorations: vi.fn(),
      refreshInlineDiff: vi.fn(),
    })

    scheduler.schedule({ type: "update_file", path: "src/existing.ts" })
    expect(syncEditorFromWorkspace).toHaveBeenCalled()
    expect(reloadFile).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()

    expect(reloadFile).not.toHaveBeenCalled()
    expect(syncEditorFromWorkspace).toHaveBeenCalled()
    scheduler.cancel()
    vi.useRealTimers()
  })

  it("syncs an already loaded active child file when a parent directory operation affects it", async () => {
    vi.useFakeTimers()
    const reloadFile = vi.fn()
    const syncEditorFromWorkspace = vi.fn()
    const refreshInlineDiff = vi.fn()
    const scheduler = createWorkspaceOperationRefreshScheduler({
      getActiveFile: () => "src/generated/page.ts",
      getProjectRoot: () => "D:/project",
      getFiles: () => ({ "src/generated/page.ts": "loaded" }),
      isDirty: () => false,
      normalizePath: (path) => path,
      refreshWorkspaceTree: vi.fn(),
      refreshExplorerHost: vi.fn(),
      reloadFile,
      syncEditorFromWorkspace,
      refreshActiveAnalysis: vi.fn(),
      refreshScmEditorDecorations: vi.fn(),
      refreshInlineDiff,
    })

    scheduler.schedule({ type: "delete_file", pathBefore: "src/generated" })

    expect(syncEditorFromWorkspace).toHaveBeenCalled()
    expect(refreshInlineDiff).toHaveBeenCalledWith("src/generated/page.ts")
    expect(reloadFile).not.toHaveBeenCalled()
    scheduler.cancel()
    vi.useRealTimers()
  })

  it("refreshes explorer but skips file reload and analysis for created folders", async () => {
    vi.useFakeTimers()
    const reloadFile = vi.fn()
    const refreshActiveAnalysis = vi.fn()
    const refreshWorkspaceTree = vi.fn(async () => undefined)
    const refreshExplorerHost = vi.fn(async () => undefined)
    const scheduler = createWorkspaceOperationRefreshScheduler({
      getActiveFile: () => "src/generated",
      getProjectRoot: () => "D:/project",
      getFiles: () => ({}),
      isDirty: () => false,
      normalizePath: (path) => path,
      refreshWorkspaceTree,
      refreshExplorerHost,
      reloadFile,
      syncEditorFromWorkspace: vi.fn(),
      refreshActiveAnalysis,
      refreshScmEditorDecorations: vi.fn(),
      refreshInlineDiff: vi.fn(),
    })

    scheduler.schedule({ type: "create_folder", path: "src/generated", pathAfter: "src/generated" })
    await vi.runAllTimersAsync()

    expect(refreshWorkspaceTree).toHaveBeenCalled()
    expect(refreshExplorerHost).toHaveBeenCalled()
    expect(reloadFile).not.toHaveBeenCalled()
    expect(refreshActiveAnalysis).not.toHaveBeenCalled()
    scheduler.cancel()
    vi.useRealTimers()
  })
})
