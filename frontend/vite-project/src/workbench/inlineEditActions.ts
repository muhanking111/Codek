interface InlineEditState {
  visible: boolean
  busy: boolean
  status: string
  statusText: string
  activeModel: string
  review: string
  originalCode: string
  modifiedCode: string
  selection: any
  cursorTop: number
  cursorLeft: number
}

interface WorkspaceLike {
  activeFile?: string | null
}

interface EditCodeOptions {
  onModelChange?: (model: string, text: string) => void
  onReview?: (text: string) => void
}

type EditCodeFn = (
  code: string,
  instruction: string,
  options?: EditCodeOptions,
) => Promise<{ code?: string | null | undefined }>

export interface InlineEditActionContext {
  getEditor: () => any
  getMonacoApi: () => any
  getWorkspace: () => WorkspaceLike
  getInlineEdit: () => InlineEditState
  loadEditCode: () => Promise<EditCodeFn>
  updateFile: (path: string, content: string, options?: Record<string, unknown>) => void
  recordChange: (change: Record<string, unknown>) => void
  scheduleAnalysisRefresh: () => void
  scheduleAutosave: () => void
  clearInlineDecorations: () => void
  showInlineDiff: (oldCode: string, newCode: string) => void
  getSelectedText: () => string
  setChatOpen: (open: boolean) => void
  appendCodeContextToChat: (text: string, path: string) => void
  nextTick: (callback?: () => void) => Promise<void> | void
}

export function openInlineEdit(context: InlineEditActionContext): void {
  const editor = context.getEditor()
  if (!editor) return
  const selection = editor.getSelection()
  const model = editor.getModel()
  if (!selection || !model) return

  const inlineEdit = context.getInlineEdit()
  if (selection.isEmpty()) {
    const lineNumber = selection.positionLineNumber
    const line = model.getLineContent(lineNumber)
    inlineEdit.selection = {
      startLineNumber: lineNumber,
      startColumn: 1,
      endLineNumber: lineNumber,
      endColumn: line.length + 1,
    }
    inlineEdit.originalCode = line
  } else {
    inlineEdit.selection = {
      startLineNumber: selection.startLineNumber,
      startColumn: selection.startColumn,
      endLineNumber: selection.endLineNumber,
      endColumn: selection.endColumn,
    }
    inlineEdit.originalCode = model.getValueInRange(selection)
  }

  const topLine = inlineEdit.selection.startLineNumber
  const topPos = editor.getScrolledVisiblePosition({ lineNumber: topLine, column: 1 })
  if (topPos) {
    inlineEdit.cursorTop = topPos.top + topPos.height + 2
    inlineEdit.cursorLeft = topPos.left
  } else {
    inlineEdit.cursorTop = 0
    inlineEdit.cursorLeft = 0
  }

  inlineEdit.visible = true
  inlineEdit.busy = false
  inlineEdit.status = ""
  inlineEdit.modifiedCode = ""
  context.clearInlineDecorations()
}

export async function submitInlineEdit(instruction: string, context: InlineEditActionContext): Promise<void> {
  const inlineEdit = context.getInlineEdit()
  inlineEdit.busy = true
  inlineEdit.status = "model"
  inlineEdit.review = ""

  try {
    const editCode = await context.loadEditCode()
    const result = await editCode(inlineEdit.originalCode, instruction, {
      onModelChange(model, text) {
        inlineEdit.activeModel = model
        inlineEdit.statusText = text
      },
      onReview(text) {
        inlineEdit.review = text
      },
    })

    if (!result.code) throw new Error("模型返回了空代码。")
    inlineEdit.modifiedCode = result.code
    inlineEdit.status = "done"
    inlineEdit.busy = false
    context.showInlineDiff(inlineEdit.originalCode, result.code)
  } catch {
    inlineEdit.status = "error"
    inlineEdit.busy = false
  }
}

export function applyInlineEdit(context: InlineEditActionContext): void {
  const editor = context.getEditor()
  const monacoApi = context.getMonacoApi()
  const inlineEdit = context.getInlineEdit()
  if (!editor || !inlineEdit.modifiedCode || !inlineEdit.selection || !monacoApi) return

  const beforeContent = inlineEdit.originalCode
  const range = new monacoApi.Range(
    inlineEdit.selection.startLineNumber,
    inlineEdit.selection.startColumn,
    inlineEdit.selection.endLineNumber,
    inlineEdit.selection.endColumn,
  )

  editor.executeEdits("inline-edit", [{ range, text: inlineEdit.modifiedCode, forceMoveMarkers: true }])
  const activeFile = context.getWorkspace().activeFile
  if (activeFile) {
    const afterContent = editor.getValue()
    context.updateFile(activeFile, afterContent, { dirty: true, external: false })
    context.recordChange({
      path: activeFile,
      beforeContent,
      afterContent,
      source: "inline",
      action: "edit",
    })
    context.scheduleAnalysisRefresh()
    context.scheduleAutosave()
  }
  closeInlineEdit(context)
}

export function cancelInlineEdit(context: InlineEditActionContext): void {
  closeInlineEdit(context)
}

export function sendSelectionToChat(context: InlineEditActionContext): void {
  const selectedText = context.getSelectedText()
  context.setChatOpen(true)
  if (!selectedText) return

  void context.nextTick(() => {
    context.appendCodeContextToChat(selectedText, context.getWorkspace().activeFile || "")
  })
}

function closeInlineEdit(context: InlineEditActionContext): void {
  const inlineEdit = context.getInlineEdit()
  inlineEdit.visible = false
  inlineEdit.busy = false
  inlineEdit.status = ""
  inlineEdit.statusText = ""
  inlineEdit.activeModel = ""
  inlineEdit.review = ""
  inlineEdit.originalCode = ""
  inlineEdit.modifiedCode = ""
  inlineEdit.selection = null
  context.clearInlineDecorations()
  context.getEditor()?.focus?.()
}
