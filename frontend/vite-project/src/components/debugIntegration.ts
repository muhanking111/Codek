import { debugState, toggleBreakpoint } from "./debugState"

export function setupDebugBreakpoints(editor: unknown, monaco: unknown): void {
  const m = monaco as typeof import("monaco-editor")
  const ed = editor as import("monaco-editor").editor.IStandaloneCodeEditor

  let breakpointDecorations: string[] = []

  const updateDecorations = () => {
    const model = ed.getModel()
    if (!model) return

    const file =
      typeof (model.uri as unknown as { path?: string }).path === "string"
        ? (model.uri as unknown as { path: string }).path
        : model.uri.toString()
    const decorations: import("monaco-editor").editor.IModelDeltaDecoration[] = []

    for (const bp of debugState.breakpoints.value) {
      if (bp.file !== file) continue

      decorations.push({
        range: {
          startLineNumber: bp.line,
          startColumn: 1,
          endLineNumber: bp.line,
          endColumn: 1,
        },
        options: {
          isWholeLine: false,
          glyphMarginClassName: bp.enabled
            ? "debug-breakpoint-enabled"
            : "debug-breakpoint-disabled",
          glyphMarginHoverMessage: bp.enabled
            ? { value: `断点：第 ${bp.line} 行${bp.condition ? `（条件：${bp.condition}）` : ""}` }
            : { value: `已停用断点：第 ${bp.line} 行` },
          stickiness: m.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      })
    }

    breakpointDecorations = ed.deltaDecorations(breakpointDecorations, decorations)
  }

  ed.onMouseDown((event) => {
    if (event.target.type !== m.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
    if (event.target.detail.isAfterLines) return

    const line = event.target.position?.lineNumber
    const model = ed.getModel()
    if (!line || !model) return

    const file =
      typeof (model.uri as unknown as { path?: string }).path === "string"
        ? (model.uri as unknown as { path: string }).path
        : model.uri.toString()
    toggleBreakpoint(file, line)
  })

  ed.onDidChangeModel(() => updateDecorations())
  updateDecorations()
}
