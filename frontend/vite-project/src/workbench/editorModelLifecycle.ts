import { createLargeTextLineIndex } from "../vscode-adapter/editor/common/model/largeTextLineIndex"
import type { CodekTextModelService } from "../vscode-adapter/editor/common/model/textModelService"
import { LARGE_FILE_LINE_COUNT, VSCODE_TOKENIZATION_LARGE_FILE_BYTES } from "../workspace/largeFilePolicy"
import { bindLspModelDocument, clearLspModelDocumentBinding } from "../languages/lsp/modelBinding"

export interface MonacoEditorLike {
  setValue: (value: string) => void
  getValue: () => string
  getModel?: () => {
    getLineCount?: () => number
    getOptions?: () => { insertSpaces?: boolean; tabSize?: number }
    getValueLength?: () => number
  } | null
  setModel?: (model: unknown) => void
  updateOptions?: (options: Record<string, unknown>) => void
}

export interface EditorTextModelServiceLike extends Pick<CodekTextModelService, "getOrCreateModel" | "updateModel" | "getModel"> {}

export interface MonacoApiLike {
  editor?: {
    setModelLanguage?: (model: unknown, language: string) => void
  }
}

export interface MonacoContentChangeEventLike {
  isFlush?: boolean
}

const syncedLargeFileVersionKeys = new WeakMap<MonacoEditorLike, string>()

export const DISABLED_UNICODE_HIGHLIGHT_OPTIONS = {
  ambiguousCharacters: false,
  invisibleCharacters: false,
  nonBasicASCII: false,
}

export interface EditorFileState {
  eolType: "CRLF" | "LF"
  indentType: string
  isLargeFile: boolean
  readOnly: boolean
  byteSize: number
  lineCount: number
}

export interface EditorFileStateBudget {
  largeFileBytes: number
  largeFileLines: number
}

const DEFAULT_STOP_RENDERING_AFTER = 10000
export const DEFAULT_LARGE_FILE_BYTES = VSCODE_TOKENIZATION_LARGE_FILE_BYTES
export const DEFAULT_LARGE_FILE_LINES = LARGE_FILE_LINE_COUNT

export function measureTextContent(value: string): { byteSize: number; lineCount: number } {
  let byteSize = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x80) {
      byteSize += 1
    } else if (code < 0x800) {
      byteSize += 2
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        byteSize += 4
        index += 1
      } else {
        byteSize += 3
      }
    } else {
      byteSize += 3
    }
  }
  const lineCount = createLargeTextLineIndex(value).lineCount
  return { byteSize, lineCount }
}

export function resolveInitialEditorModel(input: {
  activeFile: string | null | undefined
  files: Record<string, unknown>
  defaultValue: string
  detectLanguage: (path: string) => string
}): { value: string; language: string } {
  const { activeFile } = input
  if (!activeFile) {
    return {
      value: input.defaultValue,
      language: "plaintext",
    }
  }

  const content = input.files[activeFile]
  if (typeof content !== "string") {
    return {
      value: input.defaultValue,
      language: "plaintext",
    }
  }

  return {
    value: content,
    language: input.detectLanguage(activeFile),
  }
}

export function buildWorkspaceTextModelContentVersionKey(input: {
  projectRoot?: string | null
  path: string
  content: string
}): string {
  const normalizedPath = String(input.path || "").replace(/\\/g, "/")
  return [
    String(input.projectRoot || ""),
    normalizedPath,
    input.content.length,
    hashTextContent(input.content),
  ].join("::")
}

function hashTextContent(content: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function toFileDocumentUri(path: string): string {
  const normalized = String(path || "").replace(/\\/g, "/").replace(/^\/+/, "")
  return `file:///${normalized}`
}

export function buildMonacoEditorCreateOptions(input: {
  value: string
  language: string
  theme: string
  settingsOptions: Record<string, any>
}): Record<string, unknown> {
  return {
    value: input.value,
    language: input.language,
    theme: input.theme,
    automaticLayout: true,
    ...input.settingsOptions,
    quickSuggestions: { other: "on", comments: "on", strings: "on" },
    quickSuggestionsDelay: 10,
    suggestOnTriggerCharacters: true,
    acceptSuggestionOnEnter: "on",
    tabCompletion: "on",
    wordBasedSuggestions: "allDocuments",
    suggest: { preview: true, showWords: true, showStatusBar: true, insertMode: "insert" },
    inlineSuggest: { enabled: true },
    parameterHints: { enabled: true, cycle: true },
  }
}

export function syncEditorModelFromWorkspace(input: {
  editor: MonacoEditorLike | null | undefined
  monaco: MonacoApiLike | null | undefined
  activeFile: string | null | undefined
  files: Record<string, unknown>
  detectLanguage: (path: string) => string
  setSuppressEditorSync: (suppress: boolean) => void
  onFileState?: (state: EditorFileState) => void
  warn?: (message: string, path: string) => void
  fileStateBudget?: Partial<EditorFileStateBudget>
  isReadOnlyFile?: (path: string) => boolean
  forceLargeFile?: boolean
  contentVersionKey?: string
  replaceModel?: (content: string, language: string, versionKey: string) => boolean
  textModelService?: EditorTextModelServiceLike
  textModelUri?: string
  shouldReplaceModel?: (path: string, content: string, language: string) => boolean
  applyBeforeSetValue?: (state: Pick<EditorFileState, "isLargeFile" | "readOnly" | "byteSize" | "lineCount">) => void
  releaseSuppressEditorSync?: (largeFileSync: boolean) => void
}): { synced: boolean; fileState: EditorFileState | null } {
  const { editor, monaco, activeFile } = input
  if (!editor || !activeFile) return { synced: false, fileState: null }

  const content = input.files[activeFile]
  if (typeof content !== "string") {
    input.warn?.("[editor] active file content is not loaded:", activeFile)
    return { synced: false, fileState: null }
  }

  const budget = {
    largeFileBytes: input.fileStateBudget?.largeFileBytes ?? DEFAULT_LARGE_FILE_BYTES,
    largeFileLines: input.fileStateBudget?.largeFileLines ?? DEFAULT_LARGE_FILE_LINES,
  }
  const readOnly = input.isReadOnlyFile?.(activeFile) === true
  const model = editor.getModel?.()
  const language = input.detectLanguage(activeFile)
  const textModelUri = input.textModelUri || activeFile.replace(/\\/g, "/")
  const useForcedLargeFile = input.forceLargeFile === true
  const preflightState = useForcedLargeFile
    ? {
      isLargeFile: true,
      readOnly,
      byteSize: Number(model?.getValueLength?.() || content.length),
      lineCount: Number(model?.getLineCount?.() || 1),
    }
    : detectContentLargeFileState(content, budget, readOnly)
  input.applyBeforeSetValue?.(preflightState)

  input.setSuppressEditorSync(true)
  let usedLargeFileSync = false
  try {
    const modelLength = Number(model?.getValueLength?.() ?? -1)
    const useLargeFileSync = preflightState.isLargeFile || useForcedLargeFile
    usedLargeFileSync = useLargeFileSync
    const serviceTextModel = input.textModelService?.getModel(textModelUri)
      ? input.textModelService.updateModel(textModelUri, content, language)
      : input.textModelService?.getOrCreateModel(content, language, textModelUri)
    let replacedModel = false
    if (useLargeFileSync) {
      const versionKey = input.contentVersionKey
      const syncedVersionKey = versionKey ? syncedLargeFileVersionKeys.get(editor) : ""
      if (versionKey) {
        if (syncedVersionKey !== versionKey) {
          const replaced = input.replaceModel?.(content, language, versionKey) === true
          replacedModel = replaced
          if (!replaced) editor.setValue(content)
          syncedLargeFileVersionKeys.set(editor, versionKey)
        }
      } else if (modelLength !== content.length) {
        editor.setValue(content)
      }
    } else if (input.shouldReplaceModel?.(activeFile, content, language) === true) {
      const versionKey = input.contentVersionKey || `${activeFile}:${content.length}`
      const replaced = input.replaceModel?.(content, language, versionKey) === true
      replacedModel = replaced
      if (!replaced && editor.getValue?.() !== content) editor.setValue(content)
      syncedLargeFileVersionKeys.delete(editor)
    } else if (editor.getValue?.() !== content) {
      editor.setValue(content)
      syncedLargeFileVersionKeys.delete(editor)
    }
    if (serviceTextModel && editor.getModel?.() !== serviceTextModel) {
      editor.setModel?.(serviceTextModel)
    }
    const currentModel = editor.getModel?.()
    if (model && model !== currentModel) {
      clearLspModelDocumentBinding(model as never)
    }
    bindLspModelDocument(currentModel as never, {
      filePath: activeFile,
      documentUri: toFileDocumentUri(activeFile),
    })
    if (currentModel && ((usedLargeFileSync && replacedModel) || currentModel === model)) {
      monaco?.editor?.setModelLanguage?.(currentModel, language)
    }
  } finally {
    if (input.releaseSuppressEditorSync) {
      input.releaseSuppressEditorSync(usedLargeFileSync)
    } else {
      input.setSuppressEditorSync(false)
    }
  }

  const fileState: EditorFileState = useForcedLargeFile
    ? {
      eolType: content.includes("\r\n") ? "CRLF" : "LF",
      indentType: (() => {
        const options = editor.getModel?.()?.getOptions?.()
        return options?.insertSpaces === false ? "Tab" : `Spaces: ${options?.tabSize ?? 2}`
      })(),
      isLargeFile: true,
      readOnly,
      byteSize: Number(editor.getModel?.()?.getValueLength?.() || content.length),
      lineCount: Number(editor.getModel?.()?.getLineCount?.() || 1),
    }
    : detectEditorFileState(content, editor, budget, readOnly)
  input.onFileState?.(fileState)
  return { synced: true, fileState }
}

export function detectContentLargeFileState(
  content: string,
  budget: EditorFileStateBudget,
  readOnly = false,
): Pick<EditorFileState, "isLargeFile" | "readOnly" | "byteSize" | "lineCount"> {
  const { byteSize, lineCount } = measureTextContent(content)
  return {
    isLargeFile: readOnly || byteSize > budget.largeFileBytes || lineCount > budget.largeFileLines,
    readOnly,
    byteSize,
    lineCount,
  }
}

export function detectEditorFileState(
  content: string,
  editor: MonacoEditorLike | null | undefined,
  budget: EditorFileStateBudget,
  readOnly = false,
): EditorFileState {
  const model = editor?.getModel?.()
  const options = model?.getOptions?.()
  const measured = readOnly && model?.getValueLength ? null : measureTextContent(content)
  const byteSize = readOnly && model?.getValueLength
    ? model.getValueLength()
    : measured?.byteSize ?? 0
  const lineCount = model?.getLineCount?.() ?? measured?.lineCount ?? 1
  return {
    eolType: content.includes("\r\n") ? "CRLF" : "LF",
    indentType: options?.insertSpaces === false ? "Tab" : `Spaces: ${options?.tabSize ?? 2}`,
    isLargeFile: readOnly || byteSize > budget.largeFileBytes || lineCount > budget.largeFileLines,
    readOnly,
    byteSize,
    lineCount,
  }
}

export function buildEditorLargeFileOptions(isLargeFile: boolean, readOnly = false): Record<string, unknown> {
  if (!isLargeFile) {
    return {
      stopRenderingLineAfter: DEFAULT_STOP_RENDERING_AFTER,
      readOnly,
      scrollBeyondLastLine: true,
    }
  }
  const options: Record<string, unknown> = {
    readOnly,
    largeFileOptimizations: true,
    maxTokenizationLineLength: 20_000,
    semanticHighlighting: { enabled: false },
    occurrencesHighlight: "off",
    selectionHighlight: false,
    codeLens: false,
    inlayHints: { enabled: "off" },
    colorDecorators: false,
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    acceptSuggestionOnEnter: "off",
    tabCompletion: "off",
    wordBasedSuggestions: "off",
    suggest: { preview: false, showWords: false, showStatusBar: false },
    inlineSuggest: { enabled: false },
    parameterHints: { enabled: false },
    hover: { enabled: false },
    links: false,
    unicodeHighlight: DISABLED_UNICODE_HIGHLIGHT_OPTIONS,
    renderLineHighlight: "gutter",
    smoothScrolling: false,
    cursorSmoothCaretAnimation: "off",
    renderWhitespace: "none",
    stopRenderingLineAfter: DEFAULT_STOP_RENDERING_AFTER,
    minimap: { enabled: false },
    folding: false,
    bracketPairColorization: { enabled: false },
    guides: { bracketPairs: false, indentation: false },
    wordWrap: "off",
    scrollBeyondLastLine: false,
    scrollBeyondLastColumn: 2,
    glyphMargin: true,
    lineDecorationsWidth: 14,
    lineNumbersMinChars: 3,
  }
  return options
}

export function buildEditorRuntimeOptions(input: {
  settingsOptions: Record<string, any>
  largeFile: boolean
  readOnly?: boolean
}): Record<string, unknown> {
  return {
    ...input.settingsOptions,
    ...buildEditorLargeFileOptions(input.largeFile, input.readOnly === true),
  }
}

export function applyEditorRuntimeOptions(input: {
  editor?: MonacoEditorLike | null
  splitEditor?: MonacoEditorLike | null
  settingsOptions: Record<string, any>
  largeFile: boolean
  readOnly?: boolean
  setMinimapEnabled?: (enabled: boolean) => void
  setEditorFontSize?: (fontSize: number) => void
}): Record<string, unknown> | null {
  if (!input.editor) return null
  input.setMinimapEnabled?.(Boolean(input.settingsOptions.minimap?.enabled))
  if (typeof input.settingsOptions.fontSize === "number") {
    input.setEditorFontSize?.(input.settingsOptions.fontSize)
  }
  const options = buildEditorRuntimeOptions({
    settingsOptions: input.settingsOptions,
    largeFile: input.largeFile,
    readOnly: input.readOnly,
  })
  input.editor.updateOptions?.(options)
  input.splitEditor?.updateOptions?.(options)
  return options
}

export function createEditorModelChangeHandler(input: {
  editor: MonacoEditorLike | null | undefined
  getActiveFile: () => string | null | undefined
  getWorkspaceContent?: (path: string) => unknown
  shouldIgnoreChange?: (path: string, content: string, event?: MonacoContentChangeEventLike) => boolean
  isSuppressed: () => boolean
  isReadOnly?: (path: string) => boolean
  updateFile: (path: string, content: string, options: { dirty: boolean; external: boolean }) => void
  scheduleAnalysisRefresh: () => void
  scheduleAutosave: () => void
}): (event?: MonacoContentChangeEventLike) => void {
  return (event) => {
    const activeFile = input.getActiveFile()
    if (input.isSuppressed() || !input.editor || !activeFile) return
    if (input.isReadOnly?.(activeFile)) return
    const editorValue = input.editor.getValue()
    if (input.shouldIgnoreChange?.(activeFile, editorValue, event)) return
    if (input.getWorkspaceContent?.(activeFile) === editorValue) return
    input.updateFile(activeFile, editorValue, { dirty: true, external: false })
    input.scheduleAnalysisRefresh()
    input.scheduleAutosave()
  }
}
