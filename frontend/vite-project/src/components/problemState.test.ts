import { beforeEach, describe, expect, it, vi } from "vitest"
import { globalProblemsDiagnosticsService } from "../workbench/problemsDiagnosticsService"
import { URI } from "../vscode-adapter/base/common/uri"
import { globalMarkerService } from "../vscode-adapter/platform/markers/common/markers"
import { problemState, type Diagnostic } from "./problemState"

describe("problemState", () => {
  beforeEach(() => problemState.clear())

  it("stores diagnostics in VS Code marker order", () => {
    const diagnostics: Diagnostic[] = [
      { file: "b.ts", line: 1, column: 1, message: "info", severity: "info" },
      { file: "a.ts", line: 5, column: 1, message: "late error", severity: "error" },
      { file: "a.ts", line: 2, column: 1, message: "early error", severity: "error" },
      { file: "a.ts", line: 1, column: 1, message: "warning", severity: "warning" },
    ]

    problemState.addDiagnostics(diagnostics)

    expect(problemState.diagnostics.map((diag) => `${diag.file}:${diag.severity}:${diag.line}`)).toEqual([
      "a.ts:error:2",
      "a.ts:error:5",
      "a.ts:warning:1",
      "b.ts:info:1",
    ])
    expect(globalMarkerService.read().map((marker) => `${marker.owner}:${marker.resource.path}:${marker.message}`)).toEqual([
      "codek-analysis:/a.ts:early error",
      "codek-analysis:/a.ts:late error",
      "codek-analysis:/a.ts:warning",
      "codek-analysis:/b.ts:info",
    ])
  })

  it("groups all diagnostics by file after marker sorting", () => {
    problemState.addDiagnostics([
      { file: "b.ts", line: 1, column: 1, message: "b", severity: "warning" },
      { file: "a.ts", line: 1, column: 1, message: "a", severity: "error" },
    ])

    expect(problemState.allDiagnostics.value.map((group) => group.file)).toEqual(["a.ts", "b.ts"])
  })

  it("tracks source diagnostics with stable marker keys", () => {
    problemState.addCompilerDiagnostics("src/App.vue", [
      { file: "src/App.vue", line: 2, column: 3, message: "bad¦pipe", severity: "error" },
    ])

    expect(problemState.diagnosticSources.size).toBe(1)
    expect(globalMarkerService.read({ owner: "compiler" }).map((marker) => marker.message)).toEqual(["bad¦pipe"])

    problemState.clearSourceDiagnostics("compiler")
    expect(problemState.diagnostics).toHaveLength(0)
    expect(problemState.diagnosticSources.size).toBe(0)
    expect(globalMarkerService.read({ owner: "compiler" })).toEqual([])
  })

  it("keeps the diagnostics outlet current after source rebuilds and clears", () => {
    const diagnosticsRef = problemState.diagnostics

    problemState.addLintDiagnostics("src/App.vue", [
      { file: "src/App.vue", line: 3, column: 1, message: "lint", severity: "warning" },
    ])
    problemState.addCompilerDiagnostics("src/App.vue", [
      { file: "src/App.vue", line: 1, column: 1, message: "compile", severity: "error" },
    ])

    expect(problemState.diagnostics).toBe(diagnosticsRef)
    expect(problemState.diagnostics.map((diag) => `${diag.diagnosticSource}:${diag.message}`)).toEqual([
      "compiler:compile",
      "lint:lint",
    ])
    expect(problemState.lintDiagnostics.value.map((diag) => diag.message)).toEqual(["lint"])
    expect(problemState.compilerDiagnostics.value.map((diag) => diag.message)).toEqual(["compile"])

    problemState.clearForFile("src/App.vue")
    expect(problemState.diagnostics).toBe(diagnosticsRef)
    expect(problemState.diagnostics).toHaveLength(0)
    expect(problemState.lintDiagnostics.value).toEqual([])
    expect(problemState.compilerDiagnostics.value).toEqual([])
    expect(globalMarkerService.read()).toEqual([])
  })

  it("refreshes the Problems outlet from VS Code-style microtask marker events", async () => {
    const diagnosticsRef = problemState.diagnostics
    const app = URI.from({ scheme: "codek", path: "/src/App.vue" })
    const main = URI.from({ scheme: "codek", path: "/src/main.ts" })

    globalMarkerService.changeOne("lint", app, [
      { startLineNumber: 5, startColumn: 2, message: "lint", severity: "warning", source: "ESLint" },
    ])
    globalMarkerService.changeOne("compiler", app, [
      { startLineNumber: 2, startColumn: 1, message: "compile", severity: "error", source: "vue-tsc" },
    ])
    globalMarkerService.changeOne("lsp", main, [
      { startLineNumber: 1, startColumn: 3, message: "lsp", severity: "info", source: "tsserver" },
    ])

    expect(problemState.diagnostics).toBe(diagnosticsRef)
    expect(problemState.diagnostics).toHaveLength(0)

    await Promise.resolve()

    expect(problemState.diagnostics).toBe(diagnosticsRef)
    expect(problemState.diagnostics.map((diag) => `${diag.diagnosticSource}:${diag.file}:${diag.line}:${diag.message}`)).toEqual([
      "compiler:src/App.vue:2:compile",
      "lint:src/App.vue:5:lint",
      "lsp:src/main.ts:1:lsp",
    ])

    const projection = globalProblemsDiagnosticsService.createVisibleProjection({
      severities: new Set(["error", "warning", "info", "ai"]),
      sources: new Set(["compiler", "lint", "lsp"]),
    }, problemState.diagnostics)
    expect(projection.summary).toEqual(expect.objectContaining({
      diagnosticCount: 3,
      errorCount: 1,
      warningCount: 1,
      infoCount: 1,
      fileCount: 2,
    }))
    expect(projection.viewModel.sourceGroups.map((group) => `${group.source}:${group.items.length}`)).toEqual([
      "compiler:1",
      "lsp:1",
      "lint:1",
    ])
  })

  it("keeps the marker service as the source for smart scan and Monaco-compatible clears", () => {
    problemState.addDiagnostics([
      { file: "src/App.vue", line: 1, column: 1, message: "ai", severity: "ai", source: "智能扫描" },
      { file: "src/App.vue", line: 2, column: 1, message: "editor", severity: "error", diagnosticSource: "monaco" },
      { file: "src/Other.vue", line: 1, column: 1, message: "other", severity: "warning" },
    ])

    expect(globalMarkerService.getStatistics()).toEqual({ errors: 1, warnings: 1, infos: 0, unknowns: 1 })

    problemState.clearAiForFile("src/App.vue")

    expect(problemState.diagnostics.map((diag) => `${diag.file}:${diag.message}`)).toEqual([
      "src/App.vue:editor",
      "src/Other.vue:other",
    ])
    expect(globalMarkerService.read().map((marker) => marker.message)).toEqual(["editor", "other"])
  })

  it("hydrates compatibility diagnostics from pre-existing marker service state on module load", async () => {
    vi.resetModules()
    const markerModule = await import("../vscode-adapter/platform/markers/common/markers")
    markerModule.globalMarkerService.changeOne("lint", { scheme: "codek", path: "/src/preexisting.ts" } as any, [
      { startLineNumber: 7, startColumn: 2, message: "preexisting", severity: "warning", source: "ESLint" },
    ])
    const reloaded = await import("./problemState")

    expect(reloaded.problemState.diagnostics).toEqual([
      expect.objectContaining({
        file: "src/preexisting.ts",
        line: 7,
        column: 2,
        message: "preexisting",
        severity: "warning",
        diagnosticSource: "lint",
      }),
    ])
    expect(reloaded.problemState.allDiagnostics.value).toEqual([
      {
        file: "src/preexisting.ts",
        items: [
          expect.objectContaining({
            message: "preexisting",
            diagnosticSource: "lint",
          }),
        ],
      },
    ])

    reloaded.problemState.clear()
  })

  it("exposes owner evidence from the marker-backed diagnostics source", () => {
    problemState.addLspDiagnostics("src/App.vue", [
      { line: 2, column: 4, message: "lsp", severity: "error", source: "tsserver" },
    ])

    const evidence = problemState.createOwnerEvidenceSnapshot()

    expect(evidence.stateSource).toBe("markerService")
    expect(evidence.markerServiceOwner.stateSource).toBe("markerService")
    expect(evidence.markerServiceOwner.owners.map((owner) => owner.owner)).toEqual(["lsp"])
    expect(evidence.problemsViewOwner.status).toBe("partial")
    expect(evidence.listOwner.status).toBe("partial")
    expect(evidence.actions.find((action) => action.id === "problems.quickFix")).toEqual(expect.objectContaining({
      status: "blocked",
      mutatesWorkspace: false,
    }))
    expect(globalMarkerService.read({ owner: "lsp" }).map((marker) => marker.message)).toEqual(["lsp"])
  })
})
