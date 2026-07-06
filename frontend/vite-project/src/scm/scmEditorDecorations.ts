import type { ScmDecoration, ScmDecorationMap } from "./scmDecorations"
import { getQuickDiffResource } from "./scmRegistry"

export interface ScmEditorDecorationContext {
  activeFile?: string | null
  decorations: ScmDecorationMap
}

export function getScmDecorationForFile(context: ScmEditorDecorationContext): ScmDecoration | null {
  const activeFile = normalizePath(context.activeFile || "")
  if (!activeFile) return null
  return context.decorations[activeFile]
    || context.decorations[toFileUri(activeFile)]
    || context.decorations[fromFileUri(activeFile)]
    || null
}

export function createScmEditorDecorations(monaco: any, decoration: ScmDecoration | null): any[] {
  if (!monaco || !decoration) return []
  const color = statusColor(decoration.status, decoration.groupId)
  const className = statusClassName(decoration.status, decoration.groupId)
  return [{
    range: new monaco.Range(1, 1, 1, 1),
    options: {
      isWholeLine: false,
      glyphMarginClassName: className,
      glyphMarginHoverMessage: { value: decoration.tooltip },
      overviewRuler: {
        color,
        position: monaco.editor.OverviewRulerLane.Left,
      },
      minimap: {
        color,
        position: monaco.editor.MinimapPosition?.Gutter ?? 1,
      },
      inlineClassName: decoration.readonlyEvidence ? "scm-inline-readonly-evidence" : undefined,
    },
  }]
}

export function createQuickDiffGutterDecorations(monaco: any, activeFile?: string | null): any[] {
  if (!monaco) return []
  const quickDiff = getQuickDiffResource(activeFile || "")
  if (!quickDiff) return []
  return [{
    range: new monaco.Range(1, 1, 1, 1),
    options: {
      isWholeLine: true,
      linesDecorationsClassName: "scm-quick-diff-line",
      glyphMarginClassName: "scm-quick-diff-glyph",
      glyphMarginHoverMessage: {
        value: `Quick Diff: ${quickDiff.status} ${quickDiff.path}`,
      },
      overviewRuler: {
        color: "#58a6ff",
        position: monaco.editor.OverviewRulerLane.Left,
      },
    },
  }]
}

export function applyScmEditorDecorations(context: {
  editor: any
  monaco: any
  activeFile?: string | null
  decorations: ScmDecorationMap
  currentDecorationIds: any[]
}): any[] {
  if (!context.editor || !context.monaco) return context.currentDecorationIds || []
  const decoration = getScmDecorationForFile({
    activeFile: context.activeFile,
    decorations: context.decorations,
  })
  return context.editor.deltaDecorations(
    context.currentDecorationIds || [],
    createScmEditorDecorations(context.monaco, decoration),
  )
}

function statusColor(status: string, groupId: string): string {
  if (groupId === "conflicts" || status === "U") return "#f85149"
  if (groupId === "staged") return "#3fb950"
  if (status === "??" || status === "A") return "#3fb950"
  if (status === "D") return "#f85149"
  if (status === "R") return "#d29922"
  return "#58a6ff"
}

function statusClassName(status: string, groupId: string): string {
  if (groupId === "conflicts" || status === "U") return "scm-glyph-conflict"
  if (groupId === "staged") return "scm-glyph-staged"
  if (status === "??" || status === "A") return "scm-glyph-added"
  if (status === "D") return "scm-glyph-deleted"
  if (status === "R") return "scm-glyph-renamed"
  return "scm-glyph-modified"
}

function normalizePath(value: string): string {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "")
}

function toFileUri(value: string): string {
  const normalized = normalizePath(value)
  if (!normalized || normalized.startsWith("file://")) return normalized
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${normalized}`
  if (normalized.startsWith("/")) return `file://${normalized}`
  return normalized
}

function fromFileUri(value: string): string {
  const normalized = normalizePath(value)
  if (!normalized.startsWith("file://")) return normalized
  return normalized.replace(/^file:\/\/\/?/, "")
}
