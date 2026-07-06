import type * as monaco from "monaco-editor"

export interface ContextMenuItem {
  id: string
  label: string
  shortcut?: string
  action?: (editor: monaco.editor.IStandaloneCodeEditor) => void
  enabled?: boolean | (() => boolean)
  separator?: boolean
}

export interface ContextMenuContext {
  canUndo: boolean
  canRedo: boolean
  hasSelection: boolean
}

const MENU_CLASS = "editor-context-menu"

function createMenuContainer(): HTMLDivElement {
  const el = document.createElement("div")
  el.className = MENU_CLASS
  el.style.cssText =
    "position:fixed;z-index:10000;background:#1e1e2e;border:1px solid #2a2d34;" +
    "border-radius:6px;box-shadow:0 8px 30px rgba(0,0,0,0.45);padding:4px 0;" +
    "min-width:220px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
    "font-size:13px;color:#d1d5db;display:none;user-select:none"
  el.addEventListener("contextmenu", (e) => e.preventDefault())
  document.body.appendChild(el)
  return el
}

function resolveEnabled(item: ContextMenuItem): boolean {
  if (item.separator) return true
  if (item.enabled === undefined) return true
  if (typeof item.enabled === "function") return item.enabled()
  return item.enabled
}

function renderMenu(
  menuEl: HTMLDivElement,
  editor: monaco.editor.IStandaloneCodeEditor,
  items: ContextMenuItem[],
  x: number,
  y: number
): void {
  menuEl.innerHTML = ""

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement("div")
      sep.style.cssText = "height:1px;background:#2a2d34;margin:4px 8px"
      menuEl.appendChild(sep)
      continue
    }

    const row = document.createElement("div")
    const isEnabled = resolveEnabled(item)

    row.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;" +
      "padding:6px 12px;cursor:" + (isEnabled ? "pointer" : "default") + ";" +
      "opacity:" + (isEnabled ? "1" : "0.4") + ";transition:background 0.1s"

    const labelSpan = document.createElement("span")
    labelSpan.textContent = item.label
    row.appendChild(labelSpan)

    if (item.shortcut) {
      const shortcutSpan = document.createElement("span")
      shortcutSpan.textContent = item.shortcut
      shortcutSpan.style.cssText = "margin-left:24px;color:#5a5e6a;font-size:11px"
      row.appendChild(shortcutSpan)
    }

    if (isEnabled && item.action) {
      row.addEventListener("mouseenter", () => {
        row.style.background = "#2a2d34"
      })
      row.addEventListener("mouseleave", () => {
        row.style.background = "transparent"
      })
      row.addEventListener("click", () => {
        item.action!(editor)
        hideMenu(menuEl)
      })
    }

    menuEl.appendChild(row)
  }

  menuEl.style.display = "block"
  menuEl.style.left = x + "px"
  menuEl.style.top = y + "px"

  requestAnimationFrame(() => {
    const rect = menuEl.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (x + rect.width > vw) menuEl.style.left = (vw - rect.width - 4) + "px"
    if (y + rect.height > vh) menuEl.style.top = (vh - rect.height - 4) + "px"
  })
}

function hideMenu(menuEl: HTMLDivElement): void {
  menuEl.style.display = "none"
  menuEl.innerHTML = ""
}

export function createEditorContextMenu(
  editor: monaco.editor.IStandaloneCodeEditor,
  getActions: (ctx: ContextMenuContext) => ContextMenuItem[]
): monaco.IDisposable {
  const menuEl = createMenuContainer()

  let maxAltVersionId = editor.getModel()?.getAlternativeVersionId() ?? 1

  const contentDisp = editor.onDidChangeModelContent(() => {
    const current = editor.getModel()?.getAlternativeVersionId() ?? 1
    if (current > maxAltVersionId) maxAltVersionId = current
  })

  const modelDisp = editor.onDidChangeModel(() => {
    maxAltVersionId = editor.getModel()?.getAlternativeVersionId() ?? 1
  })

  const scrollDisp = editor.onDidScrollChange(() => hideMenu(menuEl))

  const editorDisposeDisp = editor.onDidDispose(() => hideMenu(menuEl))

  function computeContext(): ContextMenuContext {
    const model = editor.getModel()
    const selection = editor.getSelection()
    const altId = model?.getAlternativeVersionId() ?? 1
    return {
      canUndo: altId > 1,
      canRedo: altId < maxAltVersionId,
      hasSelection: selection ? !selection.isEmpty() : false,
    }
  }

  const ctxMenuDisp = editor.onContextMenu((e) => {
    e.event.preventDefault()
    e.event.stopPropagation()
    const ctx = computeContext()
    const items = getActions(ctx)
    renderMenu(menuEl, editor, items, e.event.posx, e.event.posy)
  })

  const editorDom = editor.getDomNode()

  const preventBrowserMenu = (e: MouseEvent) => {
    if (editorDom?.contains(e.target as Node)) e.preventDefault()
  }
  editorDom?.addEventListener("contextmenu", preventBrowserMenu)

  const onClickOutside = (e: MouseEvent) => {
    if (!menuEl.contains(e.target as Node)) hideMenu(menuEl)
  }
  const onKeyEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") hideMenu(menuEl)
  }

  document.addEventListener("mousedown", onClickOutside)
  document.addEventListener("keydown", onKeyEscape)

  return {
    dispose() {
      ctxMenuDisp.dispose()
      contentDisp.dispose()
      modelDisp.dispose()
      scrollDisp.dispose()
      editorDisposeDisp.dispose()
      editorDom?.removeEventListener("contextmenu", preventBrowserMenu)
      document.removeEventListener("mousedown", onClickOutside)
      document.removeEventListener("keydown", onKeyEscape)
      menuEl.remove()
    },
  }
}
