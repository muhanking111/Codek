import type { editor } from "monaco-editor"
import type { SourceBreakpoint, Source, Breakpoint as DapBreakpoint } from "./dapProtocol"
import type { Breakpoint } from "../components/debugState"

type MonacoInstance = typeof import("monaco-editor")
type StandaloneEditor = editor.IStandaloneCodeEditor

export interface BreakpointChange {
  file: string
  line: number
  added: boolean
}

export class MonacoBreakpointAdapter {
  private editor: StandaloneEditor
  private monaco: MonacoInstance
  private decorations: string[] = []
  private onToggle: (change: BreakpointChange) => void
  private disposable: { dispose(): void } | null = null

  constructor(
    editor: StandaloneEditor,
    monaco: MonacoInstance,
    onToggle: (change: BreakpointChange) => void,
  ) {
    this.editor = editor
    this.monaco = monaco
    this.onToggle = onToggle
    this.setupGlyphMarginClick()
  }

  toSourceBreakpoints(breakpoints: readonly Breakpoint[]): SourceBreakpoint[] {
    return breakpoints
      .filter((bp) => bp.enabled)
      .map((bp) => ({
        line: bp.line,
        condition: bp.condition,
      }))
  }

  toDapSource(file: string): Source {
    return { path: file }
  }

  updateDecorations(breakpoints: readonly Breakpoint[]): void {
    const model = this.editor.getModel()
    if (!model) return

    const file = this.extractFilePath(model)
    const decorations: editor.IModelDeltaDecoration[] = []

    for (const bp of breakpoints) {
      if (bp.file !== file) continue
      decorations.push(this.createBreakpointDecoration(bp))
    }

    this.decorations = this.editor.deltaDecorations(this.decorations, decorations)
  }

  updateVerifiedBreakpoints(dapBreakpoints: readonly DapBreakpoint[]): void {
    const model = this.editor.getModel()
    if (!model) return

    const decorations: editor.IModelDeltaDecoration[] = []

    for (const dbp of dapBreakpoints) {
      if (!dbp.verified || !dbp.line) continue
      decorations.push(this.createVerifiedDecoration(dbp))
    }

    this.decorations = this.editor.deltaDecorations(this.decorations, decorations)
  }

  dispose(): void {
    this.decorations = this.editor.deltaDecorations(this.decorations, [])
    if (this.disposable) {
      this.disposable.dispose()
      this.disposable = null
    }
  }

  private setupGlyphMarginClick(): void {
    this.disposable = this.editor.onMouseDown((event) => {
      if (event.target.type !== this.monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
      if (event.target.detail.isAfterLines) return

      const line = event.target.position?.lineNumber
      const model = this.editor.getModel()
      if (!line || !model) return

      const file = this.extractFilePath(model)
      const existing = this.findBreakpointAtLine(file, line)
      this.onToggle({ file, line, added: !existing })
    })
  }

  private extractFilePath(model: editor.ITextModel): string {
    const uri = model.uri
    const pathValue = (uri as unknown as { path?: string }).path
    return typeof pathValue === "string" ? pathValue : uri.toString()
  }

  private findBreakpointAtLine(file: string, line: number): boolean {
    const model = this.editor.getModel()
    if (!model) return false

    const currentDecorations = this.editor.getLineDecorations(line)
    return currentDecorations.some(
      (d) =>
        d.options.glyphMarginClassName === "debug-breakpoint-enabled" ||
        d.options.glyphMarginClassName === "debug-breakpoint-disabled",
    )
  }

  private createBreakpointDecoration(bp: Breakpoint): editor.IModelDeltaDecoration {
    return {
      range: new this.monaco.Range(bp.line, 1, bp.line, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: bp.enabled
          ? "debug-breakpoint-enabled"
          : "debug-breakpoint-disabled",
        glyphMarginHoverMessage: { value: this.buildTooltip(bp) },
        stickiness: this.monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    }
  }

  private createVerifiedDecoration(dbp: DapBreakpoint): editor.IModelDeltaDecoration {
    const line = dbp.line ?? 1
    return {
      range: new this.monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: "debug-breakpoint-verified",
        glyphMarginHoverMessage: {
          value: dbp.message ?? `已验证断点：第 ${line} 行`,
        },
        stickiness: this.monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    }
  }

  private buildTooltip(bp: Breakpoint): string {
    const parts: string[] = [`断点：第 ${bp.line} 行`]
    if (bp.condition) parts.push(`条件：${bp.condition}`)
    if (!bp.enabled) parts.push("已停用")
    return parts.join(" | ")
  }
}
