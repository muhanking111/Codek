import { afterEach, describe, expect, it, vi } from "vitest"
import { isRealFS, resetTextFileStates, workspace } from "../workspace/manager.js"
import { restoreElectronWorkspace } from "./projectLifecycle"

function resetWorkspaceState() {
  workspace.files = {}
  workspace.activeFile = null
  workspace.projectRoot = null
  workspace.workspaceFile = null
  workspace.workspaceRoots = []
  workspace.workspaceRootLabels = {}
  workspace.fileTree = []
  workspace.openFiles = []
  resetTextFileStates()
  workspace.fileTreeStats = { nodeCount: 0, truncated: false, ignoredCount: 0 }
  workspace.largeFileNotice = null
  isRealFS.value = false
}

function createRestoreContext() {
  return {
    workspace,
    codek: {
      getWorkspaceState: vi.fn(async () => ({
        projectRoot: "D:/smoke/apps/client",
        workspaceFile: "D:/smoke/codek.code-workspace",
        workspaceRoots: ["D:/smoke/apps/client", "D:/smoke/libs/client"],
      })),
      getProjectRoot: vi.fn(async () => "D:/smoke/apps/client"),
    },
    maybeSaveCurrentFile: vi.fn(async () => true),
    resetTreeSelection: vi.fn(),
    syncEditorFromWorkspace: vi.fn(),
    clearSelectedSymbol: vi.fn(),
    loadWorkspaceSettings: vi.fn(),
    applyWorkbenchSettings: vi.fn(),
    applyEditorOptions: vi.fn(),
    openExplorerView: vi.fn(),
    refreshWorkspaceAnalysisRuntime: vi.fn(async () => undefined),
    applyEditorDiagnostics: vi.fn(),
    startWorkspaceAiRuntime: vi.fn(),
    scheduleWorkspaceWarmup: vi.fn(),
    syncSessionAgentsProjectRoot: vi.fn(),
  }
}

describe("projectLifecycle restoreElectronWorkspace", () => {
  afterEach(() => {
    resetWorkspaceState()
    localStorage.clear()
  })

  it("restores multi-root labels through the shared workspace manager state model", async () => {
    const context = createRestoreContext()

    await expect(restoreElectronWorkspace(context)).resolves.toBe(true)

    expect(workspace.workspaceRoots).toEqual(["D:/smoke/apps/client", "D:/smoke/libs/client"])
    expect(workspace.workspaceRootLabels).toEqual({
      "D:/smoke/apps/client": "client (apps)",
      "D:/smoke/libs/client": "client (libs)",
    })
    expect(workspace.fileTree.map((entry) => entry.path)).toEqual(["/client (apps)", "/client (libs)"])
    expect(isRealFS.value).toBe(true)
    expect(context.openExplorerView).toHaveBeenCalled()
  })
})
