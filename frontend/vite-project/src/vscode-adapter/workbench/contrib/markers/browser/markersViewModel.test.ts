import { describe, expect, it } from "vitest"
import {
  createProblemMarkersViewModel,
  createProblemSeverityFilterDefs,
  createProblemSourceFilterDefs,
  getProblemDiagnosticSourceKey,
  type ProblemDiagnosticLike,
} from "./markersViewModel"

describe("markers view model adapter", () => {
  it("deduplicates diagnostics using VS Code marker identity and sorts by severity/resource/range", () => {
    const diagnostics: ProblemDiagnosticLike[] = [
      { file: "src/b.ts", line: 1, column: 1, message: "info", severity: "info", source: "ts" },
      { file: "src/a.ts", line: 8, column: 2, message: "late", severity: "error", source: "ts" },
      { file: "src/a.ts", line: 2, column: 2, message: "early", severity: "error", source: "ts" },
      { file: "src/a.ts", line: 2, column: 2, message: "early", severity: "error", source: "ts" },
      { file: "src/a.ts", line: 2, column: 2, message: "early", severity: "warning", source: "ts" },
      { file: "src/a.ts", line: 1, column: 1, message: "warn", severity: "warning", source: "ts" },
    ]

    const viewModel = createProblemMarkersViewModel(diagnostics)
    const monaco = viewModel.sourceGroups.find((group) => group.source === "monaco")

    expect(viewModel.total).toBe(5)
    expect(monaco?.fileGroups.map((group) => group.file)).toEqual(["src/a.ts", "src/b.ts"])
    expect(monaco?.fileGroups[0]?.items.map((diag) => `${diag.severity}:${diag.line}`)).toEqual([
      "error:2",
      "error:8",
      "warning:1",
      "warning:2",
    ])
  })

  it("keeps Codek source compatibility while using VS Code-style source filters", () => {
    const diagnostics: ProblemDiagnosticLike[] = [
      { file: "src/app.ts", line: 1, column: 1, message: "compiler", severity: "error", diagnosticSource: "compiler" },
      { file: "src/app.ts", line: 2, column: 1, message: "eslint", severity: "warning", source: "ESLint" },
      { file: "src/app.ts", line: 3, column: 1, message: "lsp", severity: "info", source: "Language Server" },
      { file: "src/app.ts", line: 4, column: 1, message: "ai", severity: "ai", source: "智能扫描" },
    ]

    expect(diagnostics.map(getProblemDiagnosticSourceKey)).toEqual(["compiler", "lint", "lsp", "other"])

    const viewModel = createProblemMarkersViewModel(diagnostics, {
      severities: new Set(["error", "warning", "info", "ai"]),
      sources: new Set(["lint", "other"]),
    })

    expect(viewModel.sourceGroups.map((group) => group.source)).toEqual(["lint", "other"])
    expect(viewModel.visibleTotal).toBe(2)
    expect(viewModel.sourceCounts).toEqual({
      compiler: 1,
      lsp: 1,
      lint: 1,
      monaco: 0,
      other: 1,
    })
  })

  it("builds filter definitions from the unfiltered marker model counts", () => {
    const viewModel = createProblemMarkersViewModel(
      [
        { file: "src/a.ts", line: 1, column: 1, message: "error", severity: "error", diagnosticSource: "compiler" },
        { file: "src/a.ts", line: 2, column: 1, message: "warning", severity: "warning", source: "linter" },
        { file: "src/a.ts", line: 3, column: 1, message: "ai", severity: "ai", source: "智能扫描" },
      ],
      {
        severities: new Set(["error"]),
        sources: new Set(["compiler"]),
      },
    )

    expect(viewModel.visibleTotal).toBe(1)
    expect(createProblemSeverityFilterDefs(viewModel.severityCounts).map((filter) => `${filter.severity}:${filter.count}`)).toEqual([
      "error:1",
      "warning:1",
      "info:0",
      "ai:1",
    ])
    expect(createProblemSourceFilterDefs(viewModel.sourceCounts).map((filter) => `${filter.source}:${filter.count}`)).toEqual([
      "compiler:1",
      "lsp:0",
      "lint:1",
      "monaco:0",
      "other:1",
    ])
  })
})
