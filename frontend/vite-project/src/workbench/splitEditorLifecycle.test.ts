import { describe, expect, it, vi } from "vitest"
import { initSplitEditor } from "./splitEditorLifecycle"

function createContext(overrides: Record<string, unknown> = {}) {
  const splitEditor = {
    setValue: vi.fn(),
    getValue: vi.fn(() => "updated"),
    getModel: vi.fn(() => ({ id: "model" })),
    onDidChangeModelContent: vi.fn(),
  }
  const create = vi.fn(() => splitEditor)
  const setModelLanguage = vi.fn()
  const context = {
    getSplitEditor: vi.fn(() => null),
    setSplitEditor: vi.fn(),
    getSplitEditorContainer: vi.fn(() => ({ nodeType: 1 })),
    ensureMonaco: vi.fn(async () => ({ editor: { create, setModelLanguage } })),
    getTheme: vi.fn(() => "codek-dark"),
    getEditorOptions: vi.fn(() => ({
      fontSize: 14,
      minimap: { enabled: true },
      lineNumbers: "on",
      glyphMargin: true,
    })),
    setMinimapEnabled: vi.fn(),
    setEditorFontSize: vi.fn(),
    getWorkspace: vi.fn(() => ({
      activeFile: "src/app.ts",
      files: { "src/app.ts": "const app = true" },
    })),
    setSplitFile: vi.fn(),
    getSplitFile: vi.fn(() => "src/app.ts"),
    updateFile: vi.fn(),
    detectLanguage: vi.fn((path: string) => path.endsWith(".ts") ? "typescript" : "plaintext"),
    isReadOnlyFile: vi.fn(() => false),
    attachFormatOnPaste: vi.fn(),
    loadEditorFeatureModules: vi.fn(async () => ({ createEditorContextMenu: vi.fn() })),
    installEditorContextMenu: vi.fn(() => ({ dispose: vi.fn() })),
    setSplitContextMenuDisposable: vi.fn(),
    ...overrides,
  }
  return { context, create, setModelLanguage, splitEditor }
}

describe("splitEditorLifecycle", () => {
  it("creates split editor through unified Monaco create options and active file model", async () => {
    const { context, create, setModelLanguage, splitEditor } = createContext()

    await initSplitEditor(context as any)

    expect(create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      value: "const app = true",
      language: "typescript",
      theme: "codek-dark",
      automaticLayout: true,
      fontSize: 14,
      minimap: { enabled: true },
      lineNumbers: "on",
      glyphMargin: true,
      suggest: { preview: true, showWords: true, showStatusBar: true, insertMode: "insert" },
      inlineSuggest: { enabled: true },
      parameterHints: { enabled: true, cycle: true },
    }))
    expect(context.setSplitFile).toHaveBeenCalledWith("src/app.ts")
    expect(splitEditor.setValue).not.toHaveBeenCalled()
    expect(setModelLanguage).not.toHaveBeenCalled()
    expect(context.setSplitEditor).toHaveBeenCalledWith(splitEditor)
  })

  it("falls back to plaintext placeholder when split active file is not loaded", async () => {
    const { context, create } = createContext({
      getWorkspace: vi.fn(() => ({
        activeFile: "README.md",
        files: {},
      })),
    })

    await initSplitEditor(context as any)

    expect(create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      value: "",
      language: "plaintext",
    }))
    expect(context.setSplitFile).not.toHaveBeenCalled()
  })

  it("writes split editor changes back to the split file", async () => {
    const { context, splitEditor } = createContext()
    await initSplitEditor(context as any)

    const handler = splitEditor.onDidChangeModelContent.mock.calls[0][0]
    handler()

    expect(context.updateFile).toHaveBeenCalledWith("src/app.ts", "updated", { dirty: true, external: false })
  })

  it("keeps split editor read-only for large-file previews", async () => {
    const { context, create, splitEditor } = createContext({
      isReadOnlyFile: vi.fn(() => true),
    })

    await initSplitEditor(context as any)

    expect(create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      readOnly: true,
    }))

    const handler = splitEditor.onDidChangeModelContent.mock.calls[0][0]
    handler()

    expect(context.updateFile).not.toHaveBeenCalled()
  })
})
