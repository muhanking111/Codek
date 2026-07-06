import { afterEach, describe, expect, it } from "vitest"
import { refreshFileAnalysis, refreshWorkspaceAnalysis } from "./analysis"
import { analysisCache, analysisState } from "./analysisState"
import { workspace } from "./manager"

function resetWorkspaceAnalysisState() {
  workspace.files = {}
  workspace.activeFile = null
  workspace.projectRoot = null
  workspace.fileTree = []
  workspace.openFiles = []
  workspace.largeFiles = {}
  workspace.largeFileNotice = null
  analysisCache.clear()
  analysisState.files = {}
  analysisState.projectSymbols = []
  analysisState.projectReferences = {}
}

afterEach(() => {
  resetWorkspaceAnalysisState()
  delete (window as unknown as { codek?: unknown }).codek
})

describe("workspace analysis", () => {
  it("keeps active and open file analysis when the tree branch is not expanded", async () => {
    resetWorkspaceAnalysisState()
    workspace.projectRoot = "D:/Workspace"
    workspace.activeFile = "src/main.ts"
    workspace.openFiles = ["src/main.ts"]
    workspace.files = {
      "src/main.ts": "export function greet(name: string) { return name }\n",
    }
    workspace.fileTree = [
      {
        name: "src",
        path: "D:/Workspace/src",
        isDir: true,
        open: false,
      },
    ]

    await refreshFileAnalysis("src/main.ts")
    await refreshWorkspaceAnalysis()

    expect(analysisState.files["src/main.ts"]?.symbols.map((symbol: { name: string }) => symbol.name)).toContain("greet")
    expect(analysisState.projectSymbols.map((symbol: { name: string }) => symbol.name)).toContain("greet")
  })

  it("keeps explicitly refreshed diagnostics for unopened files across workspace refresh", async () => {
    resetWorkspaceAnalysisState()
    workspace.projectRoot = "D:/Workspace"
    workspace.activeFile = "src/main.ts"
    workspace.openFiles = ["src/main.ts"]
    workspace.files = {
      "src/main.ts": "export function greet(name: string) { return name }\n",
      "src/broken.ts": "export const brokenValue =\n",
    }
    workspace.fileTree = [
      {
        name: "src",
        path: "D:/Workspace/src",
        isDir: true,
        open: false,
      },
    ]

    await refreshFileAnalysis("src/main.ts")
    await refreshFileAnalysis("src/broken.ts")
    await refreshWorkspaceAnalysis()

    expect(analysisState.files["src/broken.ts"]?.diagnostics.length).toBeGreaterThan(0)
  })

  it("uses workspace scale analysis budgets for huge workspaces", async () => {
    resetWorkspaceAnalysisState()
    workspace.projectRoot = "D:/Huge"
    workspace.files = {}
    for (let index = 0; index < 120; index += 1) {
      workspace.files[`src/file-${index}.ts`] = `export const value${index} = ${index}\n`
    }
    ;(window as unknown as { codek: Record<string, unknown> }).codek = {
      getWorkspaceScaleProfile: async () => ({
        scale: "huge",
        budgets: {
          analysisMaxFiles: 80,
        },
      }),
    }

    await refreshWorkspaceAnalysis()

    expect(Object.keys(analysisState.files)).toHaveLength(80)
  })

  it("keeps startup known-only analysis off full workspace discovery", async () => {
    resetWorkspaceAnalysisState()
    const apiCalls: Array<{ path: string }> = []
    workspace.projectRoot = "D:/Huge"
    workspace.activeFile = "src/main.ts"
    workspace.openFiles = ["src/main.ts"]
    workspace.files = {
      "src/main.ts": "export function greet(name: string) { return name }\n",
    }
    ;(window as unknown as { codek: Record<string, unknown> }).codek = {
      getWorkspaceScaleProfile: async () => ({
        scale: "huge",
        budgets: {
          analysisMaxFiles: 80,
        },
      }),
      api: async (_method: string, path: string) => {
        apiCalls.push({ path })
        return { matches: [{ path: "src/discovered.ts" }] }
      },
    }

    await refreshWorkspaceAnalysis({ knownOnly: true })

    expect(apiCalls).toHaveLength(0)
    expect(analysisState.files["src/main.ts"]?.symbols.map((symbol: { name: string }) => symbol.name)).toContain("greet")
    expect(analysisState.files["src/discovered.ts"]).toBeUndefined()
  })

  it("skips range-window large file analysis and clears stale cached results", async () => {
    resetWorkspaceAnalysisState()
    workspace.projectRoot = "D:/Workspace"
    workspace.activeFile = "logs/huge.log"
    workspace.openFiles = ["logs/huge.log"]
    workspace.files = {
      "logs/huge.log": "window content\n",
    }
    workspace.largeFiles = {
      "logs/huge.log": {
        mode: "range",
        path: "logs/huge.log",
        size: 64 * 1024 * 1024,
        limit: 16 * 1024 * 1024,
        reason: "range-window",
        readOnly: false,
        truncated: true,
      },
    }
    analysisCache.set("logs/huge.log", {
      content: "stale content\n",
      analysis: {
        path: "logs/huge.log",
        content: "stale content\n",
        symbols: [{ name: "stale", kind: "variable", path: "logs/huge.log", line: 1, column: 1, detail: "" }],
        diagnostics: [],
        references: {},
        sourceText: "stale content\n",
      },
    })
    analysisState.files["logs/huge.log"] = analysisCache.get("logs/huge.log")?.analysis

    await expect(refreshFileAnalysis("logs/huge.log")).resolves.toBeNull()

    expect(analysisCache.has("logs/huge.log")).toBe(false)
    expect(analysisState.files["logs/huge.log"]).toBeUndefined()
  })
})
