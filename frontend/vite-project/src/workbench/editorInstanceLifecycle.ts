export type DisposableLike = { dispose?: () => void } | (() => void) | null | undefined

export interface EditorDomLike {
  getDomNode?: () => Node | null | undefined
}

export interface DisposeEditorInstancesInput {
  editor?: DisposableLike
  editorChangeDisposable?: DisposableLike
  editorScrollDisposable?: DisposableLike
  detachInlineDiffOverlay?: DisposableLike
  detachLsp?: DisposableLike
  contextMenuDisposable?: DisposableLike
  splitContextMenuDisposable?: DisposableLike
  splitEditor?: DisposableLike
  clearInlineDecorations?: () => void
  setEditor?: (value: null) => void
  setEditorChangeDisposable?: (value: null) => void
  setEditorScrollDisposable?: (value: null) => void
  setDetachInlineDiffOverlay?: (value: null) => void
  setDetachLsp?: (value: null) => void
  setContextMenuDisposable?: (value: null) => void
  setSplitContextMenuDisposable?: (value: null) => void
  setSplitEditor?: (value: null) => void
}

export interface DisposeEditorInstancesResult {
  errors: unknown[]
}

export function disposeEditorInstances(input: DisposeEditorInstancesInput): DisposeEditorInstancesResult {
  const errors: unknown[] = []
  const disposeSafely = (resource: DisposableLike) => {
    if (!resource) return
    try {
      if (typeof resource === "function") {
        resource()
        return
      }
      resource.dispose?.()
    } catch (error) {
      errors.push(error)
    }
  }

  disposeSafely(input.editorChangeDisposable)
  disposeSafely(input.editorScrollDisposable)
  try {
    input.clearInlineDecorations?.()
  } catch (error) {
    errors.push(error)
  }
  disposeSafely(input.detachInlineDiffOverlay)
  disposeSafely(input.detachLsp)
  disposeSafely(input.contextMenuDisposable)
  disposeSafely(input.splitContextMenuDisposable)
  disposeSafely(input.editor)
  disposeSafely(input.splitEditor)

  input.setEditor?.(null)
  input.setEditorChangeDisposable?.(null)
  input.setEditorScrollDisposable?.(null)
  input.setDetachInlineDiffOverlay?.(null)
  input.setDetachLsp?.(null)
  input.setContextMenuDisposable?.(null)
  input.setSplitContextMenuDisposable?.(null)
  input.setSplitEditor?.(null)

  return { errors }
}

export function isEditorMountedInContainer(
  editor: EditorDomLike | null | undefined,
  container: Node | null | undefined,
): boolean {
  if (!editor || !container) return false
  const domNode = editor.getDomNode?.()
  return Boolean(domNode && container.contains(domNode))
}
