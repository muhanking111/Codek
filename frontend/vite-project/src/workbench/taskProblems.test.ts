import { describe, expect, it, vi } from "vitest"
import { resolveProblemMatchers } from "./problemMatcher"
import { applyTaskProblemDiagnostics } from "./taskProblems"

describe("taskProblems", () => {
  it("routes compiler and lint task output into problem state", () => {
    const problemState = {
      addCompilerDiagnostics: vi.fn(),
      addLintDiagnostics: vi.fn(),
    }
    const matchers = [
      ...resolveProblemMatchers("$tsc"),
      ...resolveProblemMatchers("$eslint-stylish"),
    ]

    const result = applyTaskProblemDiagnostics(
      [
        "src/main.ts(12,8): error TS2322: Type mismatch",
        "./src/App.vue",
        "  4:10  warning  unused variable  no-unused-vars",
      ].join("\n"),
      matchers,
      problemState,
    )

    expect(result).toEqual({ total: 2, files: ["src/App.vue", "src/main.ts"] })
    expect(problemState.addCompilerDiagnostics).toHaveBeenCalledWith("src/main.ts", [
      expect.objectContaining({ source: "TypeScript", diagnosticSource: "compiler" }),
    ])
    expect(problemState.addLintDiagnostics).toHaveBeenCalledWith("src/App.vue", [
      expect.objectContaining({ source: "ESLint", diagnosticSource: "lint" }),
    ])
  })

  it("does nothing without configured problem matchers", () => {
    const problemState = {
      addCompilerDiagnostics: vi.fn(),
      addLintDiagnostics: vi.fn(),
    }

    expect(applyTaskProblemDiagnostics("src/main.ts(1,1): error TS1000: nope", undefined, problemState)).toEqual({
      total: 0,
      files: [],
    })
    expect(problemState.addCompilerDiagnostics).not.toHaveBeenCalled()
    expect(problemState.addLintDiagnostics).not.toHaveBeenCalled()
  })

  it("clears stale files through the shared task problem sink before applying new output", () => {
    const problemState = {
      addCompilerDiagnostics: vi.fn(),
      addLintDiagnostics: vi.fn(),
    }

    const result = applyTaskProblemDiagnostics(
      "Found 0 errors. Watching for file changes.",
      resolveProblemMatchers("$tsc"),
      problemState,
      { clearFiles: ["src/main.ts"] },
    )

    expect(result).toEqual({ total: 0, files: [], clearedFiles: ["src/main.ts"] })
    expect(problemState.addCompilerDiagnostics).toHaveBeenCalledWith("src/main.ts", [])
    expect(problemState.addLintDiagnostics).toHaveBeenCalledWith("src/main.ts", [])
  })
})
