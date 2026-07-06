import {
  globalMarkerService,
  type IMarkerService,
  MarkerSeverity,
  normalizeMarkerData,
  toCodekSeverity,
  toMarkerSeverity,
} from "../vscode-adapter/platform/markers/common/markers"
import { URI } from "../vscode-adapter/base/common/uri"

export interface CodekDiagnostic {
  file?: string
  line?: number
  column?: number
  message?: string
  severity?: string
  code?: string | number
  source?: string
  diagnosticSource?: string
}

export interface MonacoMarkerLike {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn?: number
  message: string
  severity: number
  code?: string | number
  source?: string
}

export interface DiagnosticDecorationProjection {
  count: number
  ranges: Array<{
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
    severity: "error" | "warning" | "info" | "ai"
    message: string
    source?: string
  }>
}

export interface ProblemStateLike {
  clearForFile: (file: string) => void
  addDiagnostics: (diagnostics: CodekDiagnostic[]) => void
}

export function getMonacoMarkerSeverity(monaco: any, level?: string): number {
  const severity = toMarkerSeverity(level)
  if (severity === MarkerSeverity.Warning) return monaco.MarkerSeverity?.Warning ?? MarkerSeverity.Warning
  if (severity === MarkerSeverity.Info) return monaco.MarkerSeverity?.Info ?? MarkerSeverity.Info
  if (severity === MarkerSeverity.Hint) return monaco.MarkerSeverity?.Hint ?? MarkerSeverity.Hint
  return monaco.MarkerSeverity?.Error ?? MarkerSeverity.Error
}

export function toCodekDiagnostics(file: string, markers: MonacoMarkerLike[]): CodekDiagnostic[] {
  return markers.map((marker) => {
    const normalized = normalizeMarkerData(marker)
    return {
      file,
      line: normalized.startLineNumber,
      column: normalized.startColumn,
      message: normalized.message,
      severity: toCodekSeverity(normalized.severity),
      source: normalized.source,
      diagnosticSource: "monaco",
    }
  })
}

export function toMonacoMarkers(monaco: any, diagnostics: CodekDiagnostic[]): MonacoMarkerLike[] {
  return diagnostics.map((diag) => {
    const normalized = normalizeMarkerData({
      startLineNumber: diag.line,
      startColumn: diag.column,
      message: diag.message,
      severity: diag.severity,
      code: diag.code,
      source: diag.source || "Codek",
    })
    return {
      ...normalized,
      severity: getMonacoMarkerSeverity(monaco, diag.severity),
      code: String(diag.code || ""),
      source: normalized.source || "Codek",
    }
  })
}

export function createScrollbarDecorations(monaco: any, markers: MonacoMarkerLike[]): any[] {
  return markers.map((marker) => {
    const normalized = normalizeMarkerData(marker)
    return {
      range: new monaco.Range(normalized.startLineNumber, 1, normalized.endLineNumber, 1),
      options: {
        isWholeLine: true,
        overviewRuler: {
          color: getMarkerColor(normalized.severity),
          position: monaco.editor.OverviewRulerLane.Right,
        },
        glyphMarginClassName: getMarkerGlyphClass(normalized.severity),
        glyphMarginHoverMessage: { value: normalized.message },
      },
    }
  })
}

export function createDiagnosticDecorationProjection(markers: MonacoMarkerLike[]): DiagnosticDecorationProjection {
  const ranges = markers.map((marker) => {
    const normalized = normalizeMarkerData(marker)
    return {
      startLineNumber: normalized.startLineNumber,
      startColumn: normalized.startColumn,
      endLineNumber: normalized.endLineNumber,
      endColumn: normalized.endColumn,
      severity: toCodekSeverity(normalized.severity),
      message: normalized.message,
      source: normalized.source,
    }
  })
  return { count: ranges.length, ranges }
}

function getMarkerColor(severity: MarkerSeverity): string {
  if (severity === MarkerSeverity.Error) return "#f44747"
  if (severity === MarkerSeverity.Warning) return "#ff9d00"
  return "#3794ff"
}

function getMarkerGlyphClass(severity: MarkerSeverity): string {
  if (severity === MarkerSeverity.Error) return "glyph-error"
  if (severity === MarkerSeverity.Warning) return "glyph-warning"
  return "glyph-info"
}

export function applyEditorDiagnostics(
  editor: any,
  monaco: any,
  diagnostics: CodekDiagnostic[],
  owner = "codek-analysis",
): void {
  if (!editor || !monaco) return
  const model = editor.getModel?.()
  if (!model) return
  monaco.editor.setModelMarkers(model, owner, toMonacoMarkers(monaco, diagnostics))
}

export function installEditorMarkerSync(context: {
  editor: any
  monaco: any
  getActiveFile: () => string | null | undefined
  problemState: ProblemStateLike
  markerService?: IMarkerService
  setScrollbarDecorations: (decorations: any[]) => void
  getScrollbarDecorations: () => any[]
}): { dispose?: () => void } | null {
  const disposable = context.monaco.editor.onDidChangeMarkers(() => {
    const model = context.editor.getModel?.()
    const activeFile = context.getActiveFile()
    if (!model || !activeFile) return

    const markers = context.monaco.editor.getModelMarkers({ resource: model.uri })
    const markerService = context.markerService || globalMarkerService
    if (markerService) {
      markerService.changeOne("monaco", toDiagnosticResource(activeFile), markers)
    } else {
      context.problemState.clearForFile(activeFile)
      context.problemState.addDiagnostics(toCodekDiagnostics(activeFile, markers))
    }
    const decorations = createScrollbarDecorations(context.monaco, markers)
    context.setScrollbarDecorations(context.editor.deltaDecorations(context.getScrollbarDecorations(), decorations))
  })
  return disposable || null
}

function toDiagnosticResource(file: string): URI {
  const normalized = String(file || "").replace(/\\/g, "/")
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("//")) {
    return URI.file(normalized)
  }
  return URI.from({ scheme: "codek", path: `/${normalized.replace(/^\/+/, "")}` })
}
