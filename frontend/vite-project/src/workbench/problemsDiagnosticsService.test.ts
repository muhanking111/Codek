import { beforeEach, describe, expect, it, vi } from "vitest"
import { URI } from "../vscode-adapter/base/common/uri"
import { MarkerService } from "../vscode-adapter/platform/markers/common/markers"
import { ProblemsDiagnosticsService, type Diagnostic } from "./problemsDiagnosticsService"

describe("ProblemsDiagnosticsService", () => {
  let markerService: MarkerService
  let service: ProblemsDiagnosticsService

  beforeEach(() => {
    markerService = new MarkerService()
    service = new ProblemsDiagnosticsService(markerService)
  })

  it("writes diagnostics into the marker service by owner and resource", () => {
    service.addDiagnostics([
      { file: "src/App.vue", line: 3, column: 2, message: "lint", severity: "warning", diagnosticSource: "lint", source: "ESLint" },
      { file: "src/App.vue", line: 1, column: 1, message: "compiler", severity: "error", diagnosticSource: "compiler", source: "TypeScript" },
    ])

    expect(markerService.read({ owner: "lint" }).map((marker) => `${marker.resource.path}:${marker.message}`)).toEqual([
      "/src/App.vue:lint",
    ])
    expect(markerService.read({ owner: "compiler" }).map((marker) => `${marker.resource.path}:${marker.message}`)).toEqual([
      "/src/App.vue:compiler",
    ])
    expect(service.getDiagnostics().map((diag) => `${diag.diagnosticSource}:${diag.message}`)).toEqual([
      "compiler:compiler",
      "lint:lint",
    ])
  })

  it("replaces and clears diagnostics for a single source without touching other owners", () => {
    service.replaceSourceDiagnosticsForFile("src/App.vue", "lint", [
      { file: "src/App.vue", line: 3, column: 2, message: "old lint", severity: "warning" },
    ])
    service.replaceSourceDiagnosticsForFile("src/App.vue", "compiler", [
      { file: "src/App.vue", line: 1, column: 1, message: "compile", severity: "error" },
    ])
    service.replaceSourceDiagnosticsForFile("src/App.vue", "lint", [])

    expect(markerService.read({ owner: "lint" })).toEqual([])
    expect(markerService.read({ owner: "compiler" }).map((marker) => marker.message)).toEqual(["compile"])
  })

  it("keeps empty source replacements as no-op marker changes when no owner/resource exists", async () => {
    const changed = vi.fn()
    markerService.onMarkerChanged(changed)

    service.replaceSourceDiagnosticsForFile("src/App.vue", "lint", [])
    await Promise.resolve()

    expect(changed).not.toHaveBeenCalled()
    expect(service.getDiagnostics()).toEqual([])
  })

  it("clears one file across owners while preserving other resources", () => {
    service.addDiagnostics([
      { file: "src/App.vue", line: 1, column: 1, message: "app", severity: "error", diagnosticSource: "monaco" },
      { file: "src/Other.vue", line: 1, column: 1, message: "other", severity: "warning", diagnosticSource: "lint" },
    ])

    service.clearForFile("src/App.vue")

    expect(service.getDiagnostics().map((diag) => `${diag.file}:${diag.message}`)).toEqual([
      "src/Other.vue:other",
    ])
  })

  it("aggregates Problems summary and visible projection from marker service data", () => {
    const diagnostics: Diagnostic[] = [
      { file: "src/a.ts", line: 2, column: 1, message: "compile", severity: "error", diagnosticSource: "compiler", source: "TypeScript" },
      { file: "src/a.ts", line: 5, column: 1, message: "lint", severity: "warning", diagnosticSource: "lint", source: "ESLint" },
      { file: "src/b.ts", line: 1, column: 1, message: "ai", severity: "ai", source: "智能扫描" },
    ]

    service.addDiagnostics(diagnostics)
    const projection = service.createVisibleProjection({
      severities: new Set(["error", "warning", "info", "ai"]),
      sources: new Set(["compiler", "other"]),
    })

    expect(projection.summary).toEqual({
      diagnosticCount: 3,
      errorCount: 1,
      warningCount: 1,
      infoCount: 0,
      aiCount: 1,
      fileCount: 2,
      sourceNames: ["TypeScript", "ESLint", "智能扫描"],
    })
    expect(projection.viewModel.visibleTotal).toBe(2)
    expect(projection.viewModel.sourceGroups.map((group) => group.source)).toEqual(["compiler", "other"])
  })

  it("reads file URI markers through the same diagnostic projection", () => {
    markerService.changeOne("monaco", URI.file("D:/Workspace/src/App.vue"), [
      { startLineNumber: 4, startColumn: 3, message: "editor", severity: "error", source: "typescript" },
    ])

    expect(service.getDiagnostics()).toEqual([
      expect.objectContaining({
        file: "d:/Workspace/src/App.vue",
        line: 4,
        column: 3,
        diagnosticSource: "monaco",
      }),
    ])
  })

  it("projects a VS Code-style resource marker model with deduped sorted markers", () => {
    service.addDiagnostics([
      { file: "src/b.ts", line: 8, column: 4, message: "lint", severity: "warning", diagnosticSource: "lint", source: "ESLint" },
      { file: "src/a.ts", line: 2, column: 1, message: "compile", severity: "error", diagnosticSource: "compiler", source: "TypeScript" },
      { file: "src/a.ts", line: 2, column: 1, message: "compile", severity: "error", diagnosticSource: "compiler", source: "TypeScript" },
      { file: "src/a.ts", line: 5, column: 2, message: "hint", severity: "ai", source: "智能扫描" },
    ])

    const resources = service.createResourceMarkerModel()

    expect(resources.map((resource) => `${resource.file}:${resource.total}:${resource.errorCount}:${resource.aiCount}`)).toEqual([
      "src/a.ts:2:1:1",
      "src/b.ts:1:0:0",
    ])
    expect(resources[0].markers.map((marker) => `${marker.owner}:${marker.line}:${marker.message}`)).toEqual([
      "compiler:2:compile",
      "codek-analysis:5:hint",
    ])
  })

  it("keeps owner/source/severity projection on diagnostics and actions", () => {
    markerService.changeOne("eslint", URI.from({ scheme: "codek", path: "/src/App.vue" }), [
      { startLineNumber: 4, startColumn: 3, message: "semi", severity: "warning", source: "ESLint", code: "semi" },
    ])

    const [diag] = service.getDiagnostics()
    const actions = service.createActionEvidence(diag)

    expect(diag).toEqual(expect.objectContaining({
      owner: "eslint",
      diagnosticSource: "lint",
      severity: "warning",
      source: "ESLint",
      code: "semi",
    }))
    expect(actions).toEqual([
      expect.objectContaining({
        id: "problems.open",
        boundary: "navigation-target-only",
        mutatesWorkspace: false,
        requiresApproval: false,
        owner: "eslint",
        sourceKey: "lint",
      }),
      expect.objectContaining({
        id: "problems.quickFix",
        boundary: "evidence-only",
        mutatesWorkspace: false,
        requiresApproval: true,
        owner: "eslint",
        sourceKey: "lint",
      }),
    ])
    expect(actions.some((action) => "handler" in action)).toBe(false)
  })

  it("builds evidence-safe navigation targets without opening files", () => {
    const diag: Diagnostic = {
      file: "src/App.vue",
      line: 0,
      column: -4,
      endLine: 3,
      endColumn: 10,
      message: "bad range",
      severity: "error",
      diagnosticSource: "compiler",
      source: "vue-tsc",
    }

    expect(service.createNavigationTarget(diag)).toEqual({
      file: "src/App.vue",
      resource: "codek:/src/App.vue",
      line: 1,
      column: 1,
      selection: {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 3,
        endColumn: 10,
      },
      evidence: expect.objectContaining({
        markerKey: expect.any(String),
        owner: "compiler",
        source: "vue-tsc",
        severity: "error",
        message: "bad range",
      }),
    })
  })

  it("builds a readonly owner evidence snapshot without marking partial UI owners connected", () => {
    const longMessage = "x".repeat(220)
    const longFile = `src/${"nested/".repeat(30)}App.vue`
    service.addDiagnostics([
      { file: longFile, line: 2, column: 3, message: longMessage, severity: "error", diagnosticSource: "compiler", source: "vue-tsc" },
      { file: "src/Lint.vue", line: 4, column: 1, message: "lint", severity: "warning", diagnosticSource: "lint", source: "ESLint" },
    ])

    const evidence = service.createOwnerEvidenceSnapshot()

    expect(evidence).toEqual(expect.objectContaining({
      serviceId: "problemsDiagnosticsService",
      stateSource: "markerService",
      readonlyEvidence: true,
      markerServiceOwner: expect.objectContaining({
        serviceId: "markerService",
        stateSource: "markerService",
        ownerCount: 2,
        markerCount: 2,
      }),
      problemsViewOwner: {
        owner: "ProblemsPanel",
        status: "partial",
        connectedStateSource: "problemState.diagnostics",
        vscodeReference: "MarkersView",
      },
      resourceGroupOwner: expect.objectContaining({
        owner: "ProblemsDiagnosticsService.createResourceMarkerModel",
        status: "connected",
        resourceCount: 2,
        markerCount: 2,
      }),
      listOwner: expect.objectContaining({
        owner: "ProblemsPanel",
        status: "partial",
      }),
      detailOwner: expect.objectContaining({
        owner: "ProblemsDiagnosticsService.createActionEvidence",
        status: "projected",
      }),
      remainingUiOwnerGap: expect.arrayContaining([
        expect.stringContaining("App.vue/generic shell"),
        expect.stringContaining("Quick Fix"),
      ]),
    }))
    expect(evidence.problemsViewOwner.status).not.toBe("connected")
    expect(evidence.actions).toEqual([
      expect.objectContaining({ id: "problems.open", status: "projected", boundary: "navigation-target-only", mutatesWorkspace: false }),
      expect.objectContaining({ id: "problems.quickFix", status: "blocked", boundary: "evidence-only", mutatesWorkspace: false, requiresApproval: true }),
      expect.objectContaining({ id: "problems.diff", status: "blocked", boundary: "not-wired", mutatesWorkspace: false, requiresApproval: true }),
    ])

    const [detail] = evidence.detailOwner.markerDetails
    expect(detail.messagePreview).toHaveLength(160)
    expect(detail.messagePreview.endsWith("...")).toBe(true)
    expect(detail.resourcePreview.length).toBeLessThanOrEqual(160)
    expect(evidence.markerServiceOwner.owners.flatMap((owner) => owner.resources).every((resource) => resource.resourcePreview.length <= 160)).toBe(true)
  })
})
