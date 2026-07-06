import { afterEach, describe, expect, it } from "vitest"
import { indexingProgress, startBackgroundIndexing, stopBackgroundIndexing } from "./indexer"
import { workspace } from "../workspace/manager"

function resetIndexerTestState() {
  stopBackgroundIndexing()
  workspace.projectRoot = null
  workspace.files = {}
  workspace.openFiles = []
  workspace.activeFile = null
  delete (window as unknown as { codek?: unknown }).codek
}

afterEach(() => {
  resetIndexerTestState()
})

describe("background indexer startup", () => {
  it("uses known files only when startup warmup asks for knownOnly indexing", async () => {
    resetIndexerTestState()
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
          indexMaxFiles: 600,
        },
      }),
      api: async (_method: string, path: string) => {
        apiCalls.push({ path })
        return { matches: [{ path: "src/discovered.ts" }] }
      },
      readFile: async (path: string) => workspace.files[path] || "",
      onFileChange: () => () => undefined,
    }

    await startBackgroundIndexing("D:/Huge", { knownOnly: true })

    expect(apiCalls).toHaveLength(0)
    expect(indexingProgress.total).toBe(1)
  })
})
