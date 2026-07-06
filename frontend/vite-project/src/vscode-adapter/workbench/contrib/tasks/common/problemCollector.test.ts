import { describe, expect, it, vi } from "vitest"
import { applyTaskProblems, collectTaskProblems } from "./problemCollector"
import { resolveTaskProblemMatchers } from "./problemMatcher"

describe("VS Code task problem collector adapter", () => {
  it("groups markers by resource and owner-style source without duplicate marker keys", () => {
    const matchers = [
      ...resolveTaskProblemMatchers("$tsc"),
      ...resolveTaskProblemMatchers("$eslint-stylish"),
    ]
    const result = collectTaskProblems([
      "src/main.ts(12,8): error TS2322: Type mismatch",
      "src/main.ts(12,8): error TS2322: Type mismatch",
      "./src/App.vue",
      "  4:10  warning  unused variable  no-unused-vars",
    ].join("\n"), matchers)

    expect(result.total).toBe(2)
    expect(result.files).toEqual(["src/App.vue", "src/main.ts"])
    expect(result.byFile.get("src/main.ts")).toHaveLength(1)
    expect(result.byFileAndSource.get("src/App.vue")?.get("lint")?.[0]).toMatchObject({
      file: "src/App.vue",
      line: 4,
      column: 10,
      source: "ESLint",
      diagnosticSource: "lint",
    })
  })

  it("applies collected diagnostics to lint and compiler sinks", () => {
    const sink = {
      addCompilerDiagnostics: vi.fn(),
      addLintDiagnostics: vi.fn(),
    }
    const result = applyTaskProblems([
      "src/main.ts(12,8): error TS2322: Type mismatch",
      "./src/App.vue",
      "  4:10  warning  unused variable  no-unused-vars",
    ].join("\n"), [
      ...resolveTaskProblemMatchers("$tsc"),
      ...resolveTaskProblemMatchers("$eslint-stylish"),
    ], sink)

    expect(result.total).toBe(2)
    expect(sink.addCompilerDiagnostics).toHaveBeenCalledWith("src/main.ts", [
      expect.objectContaining({ diagnosticSource: "compiler" }),
    ])
    expect(sink.addLintDiagnostics).toHaveBeenCalledWith("src/App.vue", [
      expect.objectContaining({ diagnosticSource: "lint" }),
    ])
  })

  it("clears requested task projection files even when a new run has no matches", () => {
    const sink = {
      addCompilerDiagnostics: vi.fn(),
      addLintDiagnostics: vi.fn(),
    }

    const result = applyTaskProblems(
      "Found 0 errors. Watching for file changes.",
      resolveTaskProblemMatchers("$tsc"),
      sink,
      undefined,
      { clearFiles: ["src/main.ts"] },
    )

    expect(result.total).toBe(0)
    expect(result.clearedFiles).toEqual(["src/main.ts"])
    expect(sink.addCompilerDiagnostics).toHaveBeenCalledWith("src/main.ts", [])
    expect(sink.addLintDiagnostics).toHaveBeenCalledWith("src/main.ts", [])
  })
})
