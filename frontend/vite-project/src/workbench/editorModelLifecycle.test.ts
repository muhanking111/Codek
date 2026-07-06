import { describe, expect, it, vi } from "vitest"
import {
  DEFAULT_LARGE_FILE_BYTES,
  buildEditorLargeFileOptions,
  buildEditorRuntimeOptions,
  buildMonacoEditorCreateOptions,
  buildWorkspaceTextModelContentVersionKey,
  createEditorModelChangeHandler,
  detectContentLargeFileState,
  detectEditorFileState,
  measureTextContent,
  resolveInitialEditorModel,
  syncEditorModelFromWorkspace,
} from "./editorModelLifecycle"
import { CodekStandaloneTextModelService } from "../vscode-adapter/editor/common/model/textModelService"
import { getBoundLspModelDocument } from "../languages/lsp/modelBinding"

function createEditor(value = "") {
  const model = {
    getLineCount: vi.fn(() => value.split("\n").length),
    getOptions: vi.fn(() => ({ insertSpaces: true, tabSize: 2 })),
  }
  return {
    value,
    model,
    setValue: vi.fn((next: string) => {
      value = next
    }),
    getValue: vi.fn(() => value),
    getModel: vi.fn(() => model),
    setModel: vi.fn(),
    updateOptions: vi.fn(),
  }
}

describe("editorModelLifecycle", () => {
  it("measures UTF-8 byte size and line count without allocating encoded buffers", () => {
    const content = "ascii\n中文\nemoji-😀"

    expect(measureTextContent(content)).toEqual({
      byteSize: new TextEncoder().encode(content).length,
      lineCount: 3,
    })
  })

  it("uses the VS Code-style line index for trailing newline line counts", () => {
    expect(measureTextContent("one\ntwo\n")).toEqual({
      byteSize: new TextEncoder().encode("one\ntwo\n").length,
      lineCount: 3,
    })
  })

  it("resolves initial editor model from active workspace file instead of hard-coded JavaScript", () => {
    expect(resolveInitialEditorModel({
      activeFile: "src/app.ts",
      files: { "src/app.ts": "const app = true" },
      defaultValue: "placeholder",
      detectLanguage: (path) => path.endsWith(".ts") ? "typescript" : "plaintext",
    })).toEqual({
      value: "const app = true",
      language: "typescript",
    })

    expect(resolveInitialEditorModel({
      activeFile: "README.md",
      files: {},
      defaultValue: "placeholder",
      detectLanguage: () => "markdown",
    })).toEqual({
      value: "placeholder",
      language: "plaintext",
    })
  })

  it("uses content identity in ordinary workspace text model version keys", () => {
    const first = buildWorkspaceTextModelContentVersionKey({
      projectRoot: "D:/project",
      path: "src\\existing.ts",
      content: "export const existing = 1\n",
    })
    const second = buildWorkspaceTextModelContentVersionKey({
      projectRoot: "D:/project",
      path: "src/existing.ts",
      content: "export const existing = 2\n",
    })

    expect(first).not.toBe(second)
    expect(first).toContain("D:/project::src/existing.ts::26::")
  })

  it("builds Monaco create options with product-grade defaults and user settings preserved", () => {
    const options = buildMonacoEditorCreateOptions({
      value: "const value = 1",
      language: "typescript",
      theme: "codek-dark",
      settingsOptions: {
        fontSize: 15,
        minimap: { enabled: true },
        lineNumbers: "on",
        glyphMargin: true,
      },
    })

    expect(options).toEqual(expect.objectContaining({
      value: "const value = 1",
      language: "typescript",
      theme: "codek-dark",
      automaticLayout: true,
      fontSize: 15,
      minimap: { enabled: true },
      lineNumbers: "on",
      glyphMargin: true,
      quickSuggestions: { other: "on", comments: "on", strings: "on" },
      quickSuggestionsDelay: 10,
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: "on",
      tabCompletion: "on",
      wordBasedSuggestions: "allDocuments",
      suggest: { preview: true, showWords: true, showStatusBar: true, insertMode: "insert" },
      inlineSuggest: { enabled: true },
      parameterHints: { enabled: true, cycle: true },
    }))
  })

  it("syncs active workspace content into Monaco and updates language plus file metadata", () => {
    const editor = createEditor()
    const monaco = { editor: { setModelLanguage: vi.fn() } }

    const result = syncEditorModelFromWorkspace({
      editor,
      monaco,
      activeFile: "src/app.ts",
      files: { "src/app.ts": "const value = 1\n" },
      detectLanguage: () => "typescript",
      setSuppressEditorSync: vi.fn(),
      onFileState: vi.fn(),
    })

    expect(result.synced).toBe(true)
    expect(editor.setValue).toHaveBeenCalledWith("const value = 1\n")
    expect(monaco.editor.setModelLanguage).toHaveBeenCalledWith(editor.model, "typescript")
    expect(result.fileState).toEqual(expect.objectContaining({
      eolType: "LF",
      indentType: "Spaces: 2",
      isLargeFile: false,
      readOnly: false,
    }))
  })

  it("proxies workspace content through the VS Code-style text model service", () => {
    const editor = createEditor("stale")
    const textModelService = new CodekStandaloneTextModelService()
    const onDidCreateModel = vi.fn()
    textModelService.onDidCreateModel(onDidCreateModel)

    const result = syncEditorModelFromWorkspace({
      editor,
      monaco: { editor: { setModelLanguage: vi.fn() } },
      activeFile: "src/model.ts",
      files: { "src/model.ts": "export const model = true\n" },
      detectLanguage: () => "typescript",
      setSuppressEditorSync: vi.fn(),
      textModelService,
    })

    const model = textModelService.getModel("src/model.ts")
    expect(result.synced).toBe(true)
    expect(model?.getValue()).toBe("export const model = true\n")
    expect(model?.getLanguageId()).toBe("typescript")
    expect(editor.setModel).toHaveBeenCalledWith(model)
    expect(onDidCreateModel).toHaveBeenCalledTimes(1)

    syncEditorModelFromWorkspace({
      editor,
      monaco: { editor: { setModelLanguage: vi.fn() } },
      activeFile: "src/model.ts",
      files: { "src/model.ts": "export const model = false\n" },
      detectLanguage: () => "typescript",
      setSuppressEditorSync: vi.fn(),
      textModelService,
    })

    expect(textModelService.getModel("src/model.ts")).toBe(model)
    expect(model?.getValue()).toBe("export const model = false\n")
    expect(model?.getVersionId()).toBe(2)
  })

  it("binds the current Monaco model to a stable LSP document identity", () => {
    const editor = createEditor("const value = 1\n")

    syncEditorModelFromWorkspace({
      editor,
      monaco: { editor: { setModelLanguage: vi.fn() } },
      activeFile: "src/model.ts",
      files: { "src/model.ts": "const value = 1\n" },
      detectLanguage: () => "typescript",
      setSuppressEditorSync: vi.fn(),
    })

    expect(getBoundLspModelDocument(editor.getModel() as never)).toEqual({
      filePath: "src/model.ts",
      documentUri: "file:///src/model.ts",
    })
  })

  it("can switch ordinary source files by replacing the editor model instead of mutating the current model", () => {
    const editor = createEditor("first")
    const setModelLanguage = vi.fn()
    const nextModel = { getLineCount: vi.fn(() => 1), getOptions: vi.fn(() => ({ insertSpaces: true, tabSize: 2 })) }
    const replaceModel = vi.fn(() => {
      ;(editor.getModel as any).mockReturnValue(nextModel)
      return true
    })

    const result = syncEditorModelFromWorkspace({
      editor,
      monaco: { editor: { setModelLanguage } },
      activeFile: "src/next.json",
      files: { "src/next.json": "{\"next\":true}\n" },
      detectLanguage: () => "json",
      setSuppressEditorSync: vi.fn(),
      shouldReplaceModel: () => true,
      replaceModel,
    })

    expect(result.synced).toBe(true)
    expect(replaceModel).toHaveBeenCalledWith("{\"next\":true}\n", "json", "src/next.json:14")
    expect(editor.setValue).not.toHaveBeenCalled()
    expect(setModelLanguage).not.toHaveBeenCalled()
  })

  it("refreshes replaced ordinary source models when the content version key changes at the same length", () => {
    const firstContent = "export const existing = 1\n"
    const secondContent = "export const existing = 2\n"
    const editor = createEditor(firstContent)
    const cachedModel = {
      getLineCount: vi.fn(() => 1),
      getOptions: vi.fn(() => ({ insertSpaces: true, tabSize: 2 })),
      setValue: vi.fn(),
    }
    const replaceModel = vi.fn((content: string, _language: string, versionKey: string) => {
      if (versionKey.endsWith(":v2")) {
        cachedModel.setValue(content)
      }
      ;(editor.getModel as any).mockReturnValue(cachedModel)
      return true
    })

    syncEditorModelFromWorkspace({
      editor,
      monaco: { editor: { setModelLanguage: vi.fn() } },
      activeFile: "src/existing.ts",
      files: { "src/existing.ts": firstContent },
      detectLanguage: () => "typescript",
      setSuppressEditorSync: vi.fn(),
      shouldReplaceModel: () => true,
      replaceModel,
      contentVersionKey: "src/existing.ts:v1",
    })
    replaceModel.mockClear()

    const result = syncEditorModelFromWorkspace({
      editor,
      monaco: { editor: { setModelLanguage: vi.fn() } },
      activeFile: "src/existing.ts",
      files: { "src/existing.ts": secondContent },
      detectLanguage: () => "typescript",
      setSuppressEditorSync: vi.fn(),
      shouldReplaceModel: () => true,
      replaceModel,
      contentVersionKey: "src/existing.ts:v2",
    })

    expect(result.synced).toBe(true)
    expect(replaceModel).toHaveBeenCalledWith(secondContent, "typescript", "src/existing.ts:v2")
    expect(cachedModel.setValue).toHaveBeenCalledWith(secondContent)
    expect(editor.setValue).not.toHaveBeenCalledWith(secondContent)
  })

  it("applies large-file editor options before setting large content into Monaco", () => {
    const editor = createEditor()
    const applyBeforeSetValue = vi.fn()
    const setSuppressEditorSync = vi.fn()
    const content = "x".repeat((20 * 1024 * 1024) + 1)

    const result = syncEditorModelFromWorkspace({
      editor,
      monaco: { editor: { setModelLanguage: vi.fn() } },
      activeFile: "logs/huge.log",
      files: { "logs/huge.log": content },
      detectLanguage: () => "plaintext",
      setSuppressEditorSync,
      applyBeforeSetValue,
    })

    expect(result.synced).toBe(true)
    expect(applyBeforeSetValue).toHaveBeenCalledWith(expect.objectContaining({
      isLargeFile: true,
      readOnly: false,
    }))
    expect(applyBeforeSetValue.mock.invocationCallOrder[0]).toBeLessThan(editor.setValue.mock.invocationCallOrder[0])
    expect(setSuppressEditorSync.mock.invocationCallOrder[0]).toBeGreaterThan(applyBeforeSetValue.mock.invocationCallOrder[0])
  })

  it("does not re-set an already mounted large file window during visibility probes", () => {
    const content = "line\n".repeat(5000)
    const editor = createEditor(content)
    const setModelLanguage = vi.fn()
    ;(editor.model as any).getValueLength = vi.fn(() => content.length)

    const result = syncEditorModelFromWorkspace({
      editor,
      monaco: { editor: { setModelLanguage } },
      activeFile: "logs/windowed.log",
      files: { "logs/windowed.log": content },
      detectLanguage: () => "plaintext",
      setSuppressEditorSync: vi.fn(),
      fileStateBudget: { largeFileBytes: 1024 },
    })

    expect(result.synced).toBe(true)
    expect(result.fileState).toEqual(expect.objectContaining({ isLargeFile: true }))
    expect(editor.getValue).not.toHaveBeenCalled()
    expect(editor.setValue).not.toHaveBeenCalled()
    expect(setModelLanguage).toHaveBeenCalledWith(editor.model, "plaintext")
  })

  it("refreshes equal-length range windows when the large-file version key changes", () => {
    const firstWindow = "a".repeat(4096)
    const secondWindow = "b".repeat(4096)
    const editor = createEditor(firstWindow)
    ;(editor.model as any).getValueLength = vi.fn(() => firstWindow.length)
    const replaceModel = vi.fn(() => true)

    syncEditorModelFromWorkspace({
      editor,
      monaco: { editor: { setModelLanguage: vi.fn() } },
      activeFile: "logs/windowed.log",
      files: { "logs/windowed.log": firstWindow },
      detectLanguage: () => "plaintext",
      setSuppressEditorSync: vi.fn(),
      fileStateBudget: { largeFileBytes: 1024 },
      forceLargeFile: true,
      contentVersionKey: "logs/windowed.log:0:4096:4096:first",
      replaceModel,
    })
    editor.setValue.mockClear()
    editor.getValue.mockClear()
    replaceModel.mockClear()

    syncEditorModelFromWorkspace({
      editor,
      monaco: { editor: { setModelLanguage: vi.fn() } },
      activeFile: "logs/windowed.log",
      files: { "logs/windowed.log": secondWindow },
      detectLanguage: () => "plaintext",
      setSuppressEditorSync: vi.fn(),
      fileStateBudget: { largeFileBytes: 1024 },
      forceLargeFile: true,
      contentVersionKey: "logs/windowed.log:4096:4096:4096:second",
      replaceModel,
    })

    expect(editor.getValue).not.toHaveBeenCalled()
    expect(replaceModel).toHaveBeenCalledWith(secondWindow, "plaintext", "logs/windowed.log:4096:4096:4096:second")
    expect(editor.setValue).not.toHaveBeenCalled()
  })

  it("sets language on the replacement model instead of the stale model", () => {
    const content = "a".repeat(4096)
    const oldModel = {
      getLineCount: vi.fn(() => 1),
      getOptions: vi.fn(() => ({ insertSpaces: true, tabSize: 2 })),
      getValueLength: vi.fn(() => content.length),
    }
    const nextModel = {
      getLineCount: vi.fn(() => 1),
      getOptions: vi.fn(() => ({ insertSpaces: true, tabSize: 2 })),
      getValueLength: vi.fn(() => content.length),
    }
    let currentModel = oldModel
    const editor = {
      setValue: vi.fn(),
      getValue: vi.fn(() => content),
      getModel: vi.fn(() => currentModel),
      setModel: vi.fn((model) => {
        currentModel = model as typeof nextModel
      }),
      updateOptions: vi.fn(),
    }
    const setModelLanguage = vi.fn()

    const result = syncEditorModelFromWorkspace({
      editor,
      monaco: { editor: { setModelLanguage } },
      activeFile: "logs/windowed.log",
      files: { "logs/windowed.log": content },
      detectLanguage: () => "plaintext",
      setSuppressEditorSync: vi.fn(),
      fileStateBudget: { largeFileBytes: 1024 },
      forceLargeFile: true,
      contentVersionKey: "logs/windowed.log:0:4096:4096:first",
      replaceModel: vi.fn(() => {
        editor.setModel(nextModel)
        return true
      }),
    })

    expect(result.synced).toBe(true)
    expect(setModelLanguage).toHaveBeenCalledWith(nextModel, "plaintext")
    expect(setModelLanguage).not.toHaveBeenCalledWith(oldModel, "plaintext")
  })

  it("lets callers delay suppress release after large-file model replacement", () => {
    const content = "a".repeat(4096)
    const editor = createEditor(content)
    ;(editor.model as any).getValueLength = vi.fn(() => content.length)
    const setSuppressEditorSync = vi.fn()
    const releaseSuppressEditorSync = vi.fn()

    syncEditorModelFromWorkspace({
      editor,
      monaco: { editor: { setModelLanguage: vi.fn() } },
      activeFile: "logs/windowed.log",
      files: { "logs/windowed.log": content },
      detectLanguage: () => "plaintext",
      setSuppressEditorSync,
      releaseSuppressEditorSync,
      fileStateBudget: { largeFileBytes: 1024 },
      forceLargeFile: true,
      contentVersionKey: "logs/windowed.log:0:4096:4096:first",
      replaceModel: vi.fn(() => true),
    })

    expect(setSuppressEditorSync).toHaveBeenCalledWith(true)
    expect(releaseSuppressEditorSync).toHaveBeenCalledWith(true)
    expect(setSuppressEditorSync).not.toHaveBeenCalledWith(false)
  })

  it("does not re-set the same large-file range version while probing visibility", () => {
    const content = "a".repeat(4096)
    const editor = createEditor(content)
    ;(editor.model as any).getValueLength = vi.fn(() => content.length)
    const versionKey = "logs/windowed.log:0:4096:4096:first"

    syncEditorModelFromWorkspace({
      editor,
      monaco: { editor: { setModelLanguage: vi.fn() } },
      activeFile: "logs/windowed.log",
      files: { "logs/windowed.log": content },
      detectLanguage: () => "plaintext",
      setSuppressEditorSync: vi.fn(),
      fileStateBudget: { largeFileBytes: 1024 },
      forceLargeFile: true,
      contentVersionKey: versionKey,
    })
    editor.setValue.mockClear()
    editor.getValue.mockClear()

    syncEditorModelFromWorkspace({
      editor,
      monaco: { editor: { setModelLanguage: vi.fn() } },
      activeFile: "logs/windowed.log",
      files: { "logs/windowed.log": content },
      detectLanguage: () => "plaintext",
      setSuppressEditorSync: vi.fn(),
      fileStateBudget: { largeFileBytes: 1024 },
      forceLargeFile: true,
      contentVersionKey: versionKey,
    })

    expect(editor.getValue).not.toHaveBeenCalled()
    expect(editor.setValue).not.toHaveBeenCalled()
  })

  it("does not sync unloaded active files", () => {
    const editor = createEditor()
    const warn = vi.fn()

    const result = syncEditorModelFromWorkspace({
      editor,
      monaco: { editor: { setModelLanguage: vi.fn() } },
      activeFile: "src/missing.ts",
      files: {},
      detectLanguage: () => "typescript",
      setSuppressEditorSync: vi.fn(),
      warn,
    })

    expect(result.synced).toBe(false)
    expect(editor.setValue).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  it("builds large-file options without dropping gutter and line-number related settings", () => {
    const normal = buildEditorRuntimeOptions({
      settingsOptions: { minimap: { enabled: true }, fontSize: 14, lineNumbers: "on" },
      largeFile: false,
    })
    const large = buildEditorRuntimeOptions({
      settingsOptions: { minimap: { enabled: true }, fontSize: 14, lineNumbers: "on" },
      largeFile: true,
      readOnly: false,
    })
    const extremeReadOnly = buildEditorRuntimeOptions({
      settingsOptions: { minimap: { enabled: true }, fontSize: 14, lineNumbers: "on" },
      largeFile: true,
      readOnly: true,
    })

    expect(normal).toEqual(expect.objectContaining({
      minimap: { enabled: true },
      stopRenderingLineAfter: 10000,
      lineNumbers: "on",
    }))
    expect(large).toEqual(expect.objectContaining({
      largeFileOptimizations: true,
      readOnly: false,
      minimap: { enabled: false },
      maxTokenizationLineLength: 20_000,
      semanticHighlighting: { enabled: false },
      inlayHints: { enabled: "off" },
      codeLens: false,
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
      unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false, nonBasicASCII: false },
      occurrencesHighlight: "off",
      selectionHighlight: false,
      folding: false,
      bracketPairColorization: { enabled: false },
      guides: { bracketPairs: false, indentation: false },
      wordWrap: "off",
      smoothScrolling: false,
      cursorSmoothCaretAnimation: "off",
      glyphMargin: true,
      lineDecorationsWidth: 14,
      lineNumbersMinChars: 3,
      lineNumbers: "on",
    }))
    expect(large).not.toHaveProperty("readOnlyMessage")
    expect(extremeReadOnly).toEqual(expect.objectContaining({
      largeFileOptimizations: true,
      readOnly: true,
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      wordBasedSuggestions: "off",
      hover: { enabled: false },
      links: false,
    }))
    expect(extremeReadOnly).not.toHaveProperty("readOnlyMessage")
    expect(buildEditorLargeFileOptions(false)).toEqual({
      stopRenderingLineAfter: 10000,
      readOnly: false,
      scrollBeyondLastLine: true,
    })
  })

  it("keeps Monaco invisible unicode highlighting disabled in create and runtime options", () => {
    const createOptions = buildMonacoEditorCreateOptions({
      value: "const value = 1",
      language: "typescript",
      theme: "codek-dark",
      settingsOptions: {
        unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false, nonBasicASCII: false },
      },
    })
    const runtimeOptions = buildEditorRuntimeOptions({
      settingsOptions: {
        unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false, nonBasicASCII: false },
      },
      largeFile: false,
    })

    expect(createOptions).toMatchObject({
      unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false, nonBasicASCII: false },
    })
    expect(runtimeOptions).toMatchObject({
      unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false, nonBasicASCII: false },
    })
  })

  it("detects large files by byte size or line count", () => {
    const small = detectEditorFileState("a\nb", createEditor("a\nb") as any, {
      largeFileBytes: 100,
      largeFileLines: 10,
    })
    const manyLines = detectEditorFileState("a\nb\nc", createEditor("a\nb\nc") as any, {
      largeFileBytes: 100,
      largeFileLines: 2,
    })

    expect(small.isLargeFile).toBe(false)
    expect(manyLines.isLargeFile).toBe(true)
    expect(detectEditorFileState("a", createEditor("a") as any, {
      largeFileBytes: 100,
      largeFileLines: 10,
    }, true)).toEqual(expect.objectContaining({
      isLargeFile: true,
      readOnly: true,
    }))
  })

  it("preflights large content without waiting for Monaco model measurement", () => {
    expect(detectContentLargeFileState("a\nb", {
      largeFileBytes: 100,
      largeFileLines: 10,
    })).toEqual({
      isLargeFile: false,
      readOnly: false,
      byteSize: 3,
      lineCount: 2,
    })
    expect(detectContentLargeFileState("a\nb\nc", {
      largeFileBytes: 100,
      largeFileLines: 2,
    })).toEqual(expect.objectContaining({
      isLargeFile: true,
      readOnly: false,
      lineCount: 3,
    }))
    expect(detectContentLargeFileState("window", {
      largeFileBytes: 100,
      largeFileLines: 10,
    }, true)).toEqual(expect.objectContaining({
      isLargeFile: true,
      readOnly: true,
    }))
  })

  it("does not require whole-file heap measurement for read-only large-file windows", () => {
    const editor = createEditor("window") as any
    editor.model.getValueLength = vi.fn(() => 512)
    const state = detectEditorFileState("window", editor, {
      largeFileBytes: 100,
      largeFileLines: 10,
    }, true)

    expect(editor.model.getValueLength).toHaveBeenCalled()
    expect(state).toEqual(expect.objectContaining({
      isLargeFile: true,
      readOnly: true,
      byteSize: 512,
    }))
  })

  it("does not classify ordinary 2MB-class files as large when no legacy budget is passed", () => {
    const content = "x".repeat((2 * 1024 * 1024) + 10)
    const fileState = syncEditorModelFromWorkspace({
      editor: createEditor(content) as any,
      monaco: { editor: { setModelLanguage: vi.fn() } },
      activeFile: "logs/normal.log",
      files: { "logs/normal.log": content },
      detectLanguage: () => "plaintext",
      setSuppressEditorSync: vi.fn(),
    })

    expect(DEFAULT_LARGE_FILE_BYTES).toBe(20 * 1024 * 1024)
    expect(fileState.fileState).toEqual(expect.objectContaining({
      isLargeFile: false,
      readOnly: false,
    }))
  })

  it("classifies 20MB-class files as optimized but still editable", () => {
    const content = "x".repeat(DEFAULT_LARGE_FILE_BYTES + 10)
    const fileState = syncEditorModelFromWorkspace({
      editor: createEditor(content) as any,
      monaco: { editor: { setModelLanguage: vi.fn() } },
      activeFile: "logs/optimized.log",
      files: { "logs/optimized.log": content },
      detectLanguage: () => "plaintext",
      setSuppressEditorSync: vi.fn(),
    })

    expect(fileState.fileState).toEqual(expect.objectContaining({
      isLargeFile: true,
      readOnly: false,
    }))
    expect(buildEditorLargeFileOptions(true, false)).toEqual(expect.objectContaining({
      largeFileOptimizations: true,
      semanticHighlighting: { enabled: false },
      folding: false,
      readOnly: false,
    }))
  })

  it("creates a content-change handler that respects suppress state and writes dirty workspace content", () => {
    const editor = createEditor("updated")
    const updateFile = vi.fn()
    const scheduleAnalysisRefresh = vi.fn()
    const scheduleAutosave = vi.fn()
    const isSuppressed = vi.fn(() => false)

    const handler = createEditorModelChangeHandler({
      editor,
      getActiveFile: () => "src/app.ts",
      isSuppressed,
      updateFile,
      scheduleAnalysisRefresh,
      scheduleAutosave,
    })

    handler()

    expect(updateFile).toHaveBeenCalledWith("src/app.ts", "updated", { dirty: true, external: false })
    expect(scheduleAnalysisRefresh).toHaveBeenCalled()
    expect(scheduleAutosave).toHaveBeenCalled()

    isSuppressed.mockReturnValue(true)
    handler()
    expect(updateFile).toHaveBeenCalledTimes(1)
  })

  it("ignores model change events when the editor already matches workspace content", () => {
    const editor = createEditor("window content")
    const updateFile = vi.fn()
    const scheduleAnalysisRefresh = vi.fn()
    const scheduleAutosave = vi.fn()

    const handler = createEditorModelChangeHandler({
      editor,
      getActiveFile: () => "logs/huge.log",
      getWorkspaceContent: () => "window content",
      isSuppressed: () => false,
      updateFile,
      scheduleAnalysisRefresh,
      scheduleAutosave,
    })

    handler()

    expect(updateFile).not.toHaveBeenCalled()
    expect(scheduleAnalysisRefresh).not.toHaveBeenCalled()
    expect(scheduleAutosave).not.toHaveBeenCalled()
  })

  it("lets callers ignore delayed programmatic model change events", () => {
    const editor = createEditor("previous window")
    const updateFile = vi.fn()
    const scheduleAnalysisRefresh = vi.fn()
    const scheduleAutosave = vi.fn()

    const handler = createEditorModelChangeHandler({
      editor,
      getActiveFile: () => "logs/huge.log",
      getWorkspaceContent: () => "next window",
      shouldIgnoreChange: (path, content, event) => path === "logs/huge.log" && content === "previous window" && event?.isFlush === true,
      isSuppressed: () => false,
      updateFile,
      scheduleAnalysisRefresh,
      scheduleAutosave,
    })

    handler({ isFlush: true })

    expect(updateFile).not.toHaveBeenCalled()
    expect(scheduleAnalysisRefresh).not.toHaveBeenCalled()
    expect(scheduleAutosave).not.toHaveBeenCalled()
  })

  it("does not write editor changes for read-only large file range views", () => {
    const editor = createEditor("updated")
    const updateFile = vi.fn()
    const handler = createEditorModelChangeHandler({
      editor,
      getActiveFile: () => "logs/huge.log",
      isSuppressed: () => false,
      isReadOnly: () => true,
      updateFile,
      scheduleAnalysisRefresh: vi.fn(),
      scheduleAutosave: vi.fn(),
    })

    handler()

    expect(updateFile).not.toHaveBeenCalled()
  })
})
