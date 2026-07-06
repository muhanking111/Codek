import { describe, expect, it } from "vitest"
import { CancellationTokenSource } from "../../vscode-adapter/base/common/cancellation"
import {
  CodekDocumentSymbolRegistry,
  createCodekOutlineModel,
  getBreadcrumbPathForPosition,
  projectBreadcrumbSymbols,
  projectOutlineTree,
} from "./outlineModel"
import type { CodekSymbolInformation } from "../workspaceSymbols/workspaceSymbolRegistry"

function symbol(overrides: Partial<CodekSymbolInformation>): CodekSymbolInformation {
  return {
    name: "run",
    kind: "function",
    path: "src/main.ts",
    line: 1,
    column: 1,
    range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 },
    ...overrides,
  }
}

describe("Codek outline model", () => {
  it("queries document providers with VS Code-style failure isolation and cancellation", async () => {
    const registry = new CodekDocumentSymbolRegistry()
    registry.register({
      provideDocumentSymbols: () => {
        throw new Error("provider failed")
      },
    })
    registry.register({
      provideDocumentSymbols: (path) => [symbol({ path, name: "Runner" })],
    })

    await expect(registry.query("src/main.ts")).resolves.toEqual([
      expect.objectContaining({ name: "Runner", path: "src/main.ts" }),
    ])

    const cts = new CancellationTokenSource()
    cts.cancel()
    await expect(registry.query("src/main.ts", cts.token)).resolves.toEqual([])
  })

  it("projects nested document symbols into an outline tree and breadcrumb path", () => {
    const tree = projectOutlineTree([
      symbol({
        name: "Runner",
        kind: "class",
        line: 1,
        column: 1,
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 30, endColumn: 1 },
      }),
      symbol({
        name: "run",
        kind: "method",
        line: 8,
        column: 3,
        range: { startLineNumber: 8, startColumn: 3, endLineNumber: 12, endColumn: 4 },
      }),
      symbol({ name: "ignoredImport", kind: "import", line: 0, column: 0 }),
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({
      label: "Runner",
      children: [expect.objectContaining({ label: "run", kind: "method" })],
    })
    expect(getBreadcrumbPathForPosition(tree, 9, 5).map((entry) => entry.label)).toEqual(["Runner", "run"])
    expect(projectBreadcrumbSymbols(tree)[0]).toMatchObject({
      name: "Runner",
      children: [expect.objectContaining({ name: "run", icon: "M" })],
    })
  })

  it("creates quick-pick projection from the same outline tree fact source", () => {
    const model = createCodekOutlineModel("src/main.ts", [
      symbol({ name: "Runner", kind: "class", line: 1, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 20, endColumn: 1 } }),
      symbol({ name: "run", kind: "method", line: 3, column: 3, range: { startLineNumber: 3, startColumn: 3, endLineNumber: 5, endColumn: 4 } }),
    ], "workbench.action.openSymbol")

    expect(model).toMatchObject({
      uri: "src/main.ts",
      outlineKind: "codek.analysis",
      isEmpty: false,
    })
    expect(model.quickPickElements.map((entry) => entry.label)).toEqual(["Runner", "run"])
  })
})
