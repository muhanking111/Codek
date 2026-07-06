import { describe, expect, it } from "vitest"
import { collectProblemDiagnostics, resolveProblemMatchers } from "./problemMatcher"

describe("AX8 task language smoke fixtures", () => {
  it("parses JS/TypeScript task output with the VS Code style tsc matcher", () => {
    const diagnostics = collectProblemDiagnostics(
      "src/app.ts(12,8): error TS2322: Type 'string' is not assignable to type 'number'.",
      resolveProblemMatchers("$tsc", "D:/Workspace"),
    )

    expect(diagnostics).toEqual([
      expect.objectContaining({
        file: "D:/Workspace/src/app.ts",
        line: 12,
        column: 8,
        severity: "error",
        source: "TypeScript",
      }),
    ])
  })

  it("parses Java/Maven task output", () => {
    const diagnostics = collectProblemDiagnostics(
      "[ERROR] src/main/java/App.java:[7,13] cannot find symbol",
      resolveProblemMatchers("$maven", "D:/Workspace"),
    )

    expect(diagnostics).toEqual([
      expect.objectContaining({
        file: "D:/Workspace/src/main/java/App.java",
        line: 7,
        column: 13,
        severity: "error",
        source: "Maven",
      }),
    ])
  })

  it("parses Python task output without requiring debugpy or pytest to be installed", () => {
    const diagnostics = collectProblemDiagnostics(
      "src/app.py:4:9: warning: unused import os",
      resolveProblemMatchers("$python", "D:/Workspace"),
    )

    expect(diagnostics).toEqual([
      expect.objectContaining({
        file: "D:/Workspace/src/app.py",
        line: 4,
        column: 9,
        severity: "warning",
        source: "Python",
      }),
    ])
  })

  it("parses Rust and Go task output", () => {
    const rust = collectProblemDiagnostics(
      "  --> src/main.rs:5:9",
      resolveProblemMatchers("$rustc", "D:/Workspace"),
    )
    const go = collectProblemDiagnostics(
      "cmd/app/main.go:8:2: undefined: missingSymbol",
      resolveProblemMatchers("$go", "D:/Workspace"),
    )

    expect(rust[0]).toMatchObject({
      file: "D:/Workspace/src/main.rs",
      line: 5,
      column: 9,
      source: "Rust",
    })
    expect(go[0]).toMatchObject({
      file: "D:/Workspace/cmd/app/main.go",
      line: 8,
      column: 2,
      source: "Go",
    })
  })
})
