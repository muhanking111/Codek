import { describe, expect, it, vi } from "vitest"
import { disposeEditorInstances, isEditorMountedInContainer } from "./editorInstanceLifecycle"

describe("editorInstanceLifecycle", () => {
  it("disposes editor instance resources and clears mutable lifecycle slots", () => {
    const editor = { dispose: vi.fn() }
    const editorChangeDisposable = { dispose: vi.fn() }
    const editorScrollDisposable = { dispose: vi.fn() }
    const splitEditor = { dispose: vi.fn() }
    const contextMenuDisposable = { dispose: vi.fn() }
    const splitContextMenuDisposable = { dispose: vi.fn() }
    const detachInlineDiffOverlay = vi.fn()
    const detachLsp = vi.fn()
    const clearInlineDecorations = vi.fn()
    const setters = {
      setEditor: vi.fn(),
      setEditorChangeDisposable: vi.fn(),
      setEditorScrollDisposable: vi.fn(),
      setDetachInlineDiffOverlay: vi.fn(),
      setDetachLsp: vi.fn(),
      setContextMenuDisposable: vi.fn(),
      setSplitContextMenuDisposable: vi.fn(),
      setSplitEditor: vi.fn(),
    }

    const result = disposeEditorInstances({
      editor,
      editorChangeDisposable,
      editorScrollDisposable,
      detachInlineDiffOverlay,
      detachLsp,
      contextMenuDisposable,
      splitContextMenuDisposable,
      splitEditor,
      clearInlineDecorations,
      ...setters,
    })

    expect(result.errors).toEqual([])
    expect(editorChangeDisposable.dispose).toHaveBeenCalled()
    expect(editorScrollDisposable.dispose).toHaveBeenCalled()
    expect(detachInlineDiffOverlay).toHaveBeenCalled()
    expect(detachLsp).toHaveBeenCalled()
    expect(contextMenuDisposable.dispose).toHaveBeenCalled()
    expect(splitContextMenuDisposable.dispose).toHaveBeenCalled()
    expect(editor.dispose).toHaveBeenCalled()
    expect(splitEditor.dispose).toHaveBeenCalled()
    expect(clearInlineDecorations).toHaveBeenCalled()
    expect(setters.setEditor).toHaveBeenCalledWith(null)
    expect(setters.setEditorChangeDisposable).toHaveBeenCalledWith(null)
    expect(setters.setEditorScrollDisposable).toHaveBeenCalledWith(null)
    expect(setters.setDetachInlineDiffOverlay).toHaveBeenCalledWith(null)
    expect(setters.setDetachLsp).toHaveBeenCalledWith(null)
    expect(setters.setContextMenuDisposable).toHaveBeenCalledWith(null)
    expect(setters.setSplitContextMenuDisposable).toHaveBeenCalledWith(null)
    expect(setters.setSplitEditor).toHaveBeenCalledWith(null)
  })

  it("keeps disposing later resources when one disposable throws", () => {
    const thrown = new Error("dispose failed")
    const splitEditor = { dispose: vi.fn() }
    const result = disposeEditorInstances({
      editorChangeDisposable: { dispose: vi.fn(() => { throw thrown }) },
      splitEditor,
      clearInlineDecorations: vi.fn(),
    })

    expect(result.errors).toEqual([thrown])
    expect(splitEditor.dispose).toHaveBeenCalled()
  })

  it("supports dispose objects returned by LSP registrations", () => {
    const detachLsp = { dispose: vi.fn() }
    const result = disposeEditorInstances({ detachLsp })

    expect(result.errors).toEqual([])
    expect(detachLsp.dispose).toHaveBeenCalled()
  })

  it("detects when a Monaco editor instance is detached from the current container", () => {
    const currentContainer = document.createElement("div")
    const staleContainer = document.createElement("div")
    const editorDomNode = document.createElement("div")
    const editor = { getDomNode: vi.fn(() => editorDomNode) }

    staleContainer.appendChild(editorDomNode)

    expect(isEditorMountedInContainer(editor, currentContainer)).toBe(false)

    currentContainer.appendChild(editorDomNode)

    expect(isEditorMountedInContainer(editor, currentContainer)).toBe(true)
  })
})
