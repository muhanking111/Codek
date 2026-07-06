import { describe, expect, it, vi } from "vitest"
import { MarkerService } from "../vscode-adapter/platform/markers/common/markers"
import {
  applyEditorDiagnostics,
  createDiagnosticDecorationProjection,
  createScrollbarDecorations,
  installEditorMarkerSync,
  toCodekDiagnostics,
  toMonacoMarkers,
} from "./editorDiagnosticsLifecycle"

function createMonacoMock(markers: any[] = []) {
  return {
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
    Range: class Range {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
    editor: {
      OverviewRulerLane: { Right: 7 },
      setModelMarkers: vi.fn(),
      getModelMarkers: vi.fn(() => markers),
      onDidChangeMarkers: vi.fn((callback) => {
        callback()
        return { dispose: vi.fn() }
      }),
    },
  }
}

describe("editorDiagnosticsLifecycle", () => {
  it("maps Monaco markers into Codek diagnostics", () => {
    expect(
      toCodekDiagnostics("src/App.vue", [
        { startLineNumber: 2, startColumn: 3, endLineNumber: 2, message: "boom", severity: 8, source: "ts" },
        { startLineNumber: 4, startColumn: 1, endLineNumber: 4, message: "careful", severity: 4 },
      ]),
    ).toEqual([
      expect.objectContaining({ file: "src/App.vue", line: 2, column: 3, severity: "error", diagnosticSource: "monaco" }),
      expect.objectContaining({ file: "src/App.vue", line: 4, column: 1, severity: "warning", diagnosticSource: "monaco" }),
    ])
  })

  it("maps Codek diagnostics into Monaco markers", () => {
    const monaco = createMonacoMock()

    expect(toMonacoMarkers(monaco, [{ line: 5, column: 2, message: "warn", severity: "warning", code: "W1" }])).toEqual([
      expect.objectContaining({
        startLineNumber: 5,
        startColumn: 2,
        endLineNumber: 5,
        endColumn: 3,
        severity: 4,
        source: "Codek",
      }),
    ])
  })

  it("creates overview ruler decorations for scrollbar markers", () => {
    const monaco = createMonacoMock()

    const decorations = createScrollbarDecorations(monaco, [
      { startLineNumber: 8, startColumn: 1, endLineNumber: 8, message: "info", severity: 2 },
    ])

    expect(decorations[0].options.overviewRuler).toEqual({ color: "#3794ff", position: 7 })
    expect(decorations[0].options.glyphMarginClassName).toBe("glyph-info")
  })

  it("projects diagnostic decoration ranges for evidence surfaces", () => {
    const projection = createDiagnosticDecorationProjection([
      {
        startLineNumber: 8,
        startColumn: 4,
        endLineNumber: 8,
        endColumn: 12,
        message: "deprecated",
        severity: 2,
        source: "ts",
      },
    ])

    expect(projection).toEqual({
      count: 1,
      ranges: [
        {
          startLineNumber: 8,
          startColumn: 4,
          endLineNumber: 8,
          endColumn: 12,
          severity: "info",
          message: "deprecated",
          source: "ts",
        },
      ],
    })
  })

  it("applies diagnostics to the active Monaco model", () => {
    const monaco = createMonacoMock()
    const model = { uri: "file://app" }
    const editor = { getModel: vi.fn(() => model) }

    applyEditorDiagnostics(editor, monaco, [{ line: 1, column: 1, message: "bad", severity: "error" }])

    expect(monaco.editor.setModelMarkers).toHaveBeenCalledWith(model, "codek-analysis", [
      expect.objectContaining({ message: "bad", severity: 8 }),
    ])
  })

  it("syncs Monaco marker changes into problem state and scrollbar decorations", async () => {
    const markers = [{ startLineNumber: 3, startColumn: 2, endLineNumber: 3, message: "bad", severity: 8 }]
    const monaco = createMonacoMock(markers)
    const model = { uri: "file://app" }
    const nextDecorations = ["decor-1"]
    const editor = {
      getModel: vi.fn(() => model),
      deltaDecorations: vi.fn(() => nextDecorations),
    }
    const problemState = {
      clearForFile: vi.fn(),
      addDiagnostics: vi.fn(),
    }
    const markerService = new MarkerService()
    const markerChanged = vi.fn()
    markerService.onMarkerChanged(markerChanged)
    let scrollbarDecorations: any[] = []

    installEditorMarkerSync({
      editor,
      monaco,
      getActiveFile: () => "src/App.vue",
      problemState,
      markerService,
      getScrollbarDecorations: () => scrollbarDecorations,
      setScrollbarDecorations: (decorations) => {
        scrollbarDecorations = decorations
      },
    })

    expect(problemState.clearForFile).not.toHaveBeenCalled()
    expect(problemState.addDiagnostics).not.toHaveBeenCalled()
    expect(markerService.read({ owner: "monaco" }).map((marker) => `${marker.resource.path}:${marker.message}`)).toEqual([
      "/src/App.vue:bad",
    ])
    await Promise.resolve()
    expect(markerChanged).toHaveBeenCalledTimes(1)
    expect(scrollbarDecorations).toBe(nextDecorations)
  })
})
