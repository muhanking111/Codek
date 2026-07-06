import { describe, expect, it } from "vitest"
import { CancellationTokenSource } from "../../vscode-adapter/base/common/cancellation"
import {
  CodekWorkspaceSymbolRegistry,
  projectWorkspaceSymbolQuickAccessItems,
  type CodekSymbolInformation,
} from "./workspaceSymbolRegistry"

function symbol(overrides: Partial<CodekSymbolInformation>): CodekSymbolInformation {
  return {
    name: "run",
    kind: "function",
    path: "src/main.ts",
    line: 1,
    column: 1,
    ...overrides,
  }
}

describe("CodekWorkspaceSymbolRegistry", () => {
  it("fans out providers, resolves symbols, isolates failures, and deduplicates results", async () => {
    const registry = new CodekWorkspaceSymbolRegistry()
    registry.register({
      provideWorkspaceSymbols: () => {
        throw new Error("provider failed")
      },
    })
    registry.register({
      provideWorkspaceSymbols: (query) => [
        symbol({ name: `match:${query}`, path: "src/a.ts", line: 2 }),
        symbol({ name: `match:${query}`, path: "src/a.ts", line: 2 }),
      ],
      resolveWorkspaceSymbol: (candidate) => ({
        ...candidate,
        containerName: "Runner",
      }),
    })

    await expect(registry.query("run")).resolves.toEqual([
      expect.objectContaining({ name: "match:run", path: "src/a.ts", containerName: "Runner" }),
    ])
  })

  it("honors cancellation before and after provider resolution", async () => {
    const registry = new CodekWorkspaceSymbolRegistry()
    registry.register({
      provideWorkspaceSymbols: () => [symbol({ name: "late" })],
      resolveWorkspaceSymbol: (candidate, token) => token.isCancellationRequested
        ? candidate
        : { ...candidate, name: "resolved" },
    })
    const cts = new CancellationTokenSource()
    cts.cancel()

    await expect(registry.query("late", cts.token)).resolves.toEqual([])
  })

  it("projects workspace symbols into stable quick access items", () => {
    expect(projectWorkspaceSymbolQuickAccessItems([
      symbol({ name: "Runner", kind: "class", path: "src/runner.ts", line: 4, column: 2 }),
    ], "workbench.action.openSymbol")).toEqual([
      expect.objectContaining({
        id: "src/runner.ts:4:2:class:Runner",
        label: "Runner",
        icon: "C",
        commandId: "workbench.action.openSymbol",
      }),
    ])
  })
})
