interface DisposableLike {
  dispose?: () => void
}

interface SettingsStoreLike {
  set: (key: string, value: unknown) => void
}

export interface EditorViewActionContext {
  hasEditor: () => boolean
  getSplitOpen: () => boolean
  setSplitOpen: (open: boolean) => void
  setSplitFile: (path: string | null) => void
  disposeSplitEditor: () => void
  getSplitContextMenuDisposable: () => DisposableLike | null | undefined
  setSplitContextMenuDisposable: (disposable: DisposableLike | null) => void
  initSplitEditor: () => Promise<void> | void
  nextTick: (callback?: () => void) => Promise<void> | void
  setSplitDividerDragging: (dragging: boolean) => void
  setSplitRatio: (ratio: number) => void
  setMarkdownPreviewOpen: (open: boolean, input?: { resource?: string; content?: string }) => void
  setVisualEditorOpen: (open: boolean) => void
  getMinimapEnabled: () => boolean
  setMinimapEnabled: (enabled: boolean) => void
  settingsStore: SettingsStoreLike
  applyEditorOptions: () => void
  document: Document
}

export function toggleSplitView(context: EditorViewActionContext): void {
  const nextOpen = !context.getSplitOpen()
  context.setSplitOpen(nextOpen)
  if (nextOpen) {
    void context.nextTick(() => {
      void context.initSplitEditor()
    })
  } else {
    closeSplitView(context)
  }
}

export function closeSplitView(context: EditorViewActionContext): void {
  context.disposeSplitEditor()
  context.getSplitContextMenuDisposable()?.dispose?.()
  context.setSplitContextMenuDisposable(null)
  context.setSplitOpen(false)
  context.setSplitFile(null)
}

export function startSplitDividerDrag(event: MouseEvent, context: EditorViewActionContext): void {
  event.preventDefault()
  context.setSplitDividerDragging(true)
  const container = (event.target as HTMLElement | null)?.parentElement
  if (!container) return
  const containerRect = container.getBoundingClientRect()

  const handleMouseMove = (moveEvent: MouseEvent) => {
    const offsetX = moveEvent.clientX - containerRect.left
    const ratio = Math.min(80, Math.max(20, (offsetX / containerRect.width) * 100))
    context.setSplitRatio(ratio)
  }

  const handleMouseUp = () => {
    context.setSplitDividerDragging(false)
    context.document.removeEventListener("mousemove", handleMouseMove)
    context.document.removeEventListener("mouseup", handleMouseUp)
  }

  context.document.addEventListener("mousemove", handleMouseMove)
  context.document.addEventListener("mouseup", handleMouseUp)
}

export function closeMarkdownPreview(context: EditorViewActionContext): void {
  context.setMarkdownPreviewOpen(false)
}

export function closeVisualEditor(context: EditorViewActionContext): void {
  context.setVisualEditorOpen(false)
}

export function toggleMinimapSetting(context: EditorViewActionContext): void {
  if (!context.hasEditor()) return
  const enabled = !context.getMinimapEnabled()
  context.setMinimapEnabled(enabled)
  context.settingsStore.set("editor.minimap.enabled", enabled)
  context.applyEditorOptions()
}
