/**
 * MainThreadTextEditors — handles editor operations from the Extension Host.
 *
 * RPC handlers:
 *   $tryShowTextDocument(uri, options)    — Open/show a document
 *   $trySetSelections(id, selections)     — Set editor selections
 *   $tryApplyEdits(id, version, edits)    — Apply text edits
 *   $tryRevealRange(id, range, reveal)    — Reveal a range
 *   $trySetOptions(id, options)           — Set editor options
 *   $trySetDecorations(id, key, ranges)   — Set decorations
 *   $registerTextEditorDecorationType(...)— Register decoration type
 *   $removeTextEditorDecorationType(key)  — Remove decoration type
 *   $tryInsertSnippet(id, ver, template)  — Insert snippet
 *   $getDiffInformation(id)              — Get diff info
 */

function register(server, opts = {}) {
  const { sendToRenderer, ipcMain } = opts

  server.onRpc("$tryShowTextDocument", async (args) => {
    const [resource, options] = args || []
    if (!resource) return undefined

    if (sendToRenderer) {
      sendToRenderer("ext-host:editor-show", { uri: resource, options })
    }
    // Return a pseudo-editor ID — the renderer creates the actual editor
    return `editor-${Date.now()}`
  })

  server.onRpc("$trySetSelections", (args) => {
    const [id, selections] = args || []
    if (!id) return undefined

    if (sendToRenderer) {
      sendToRenderer("ext-host:editor-selections", { id, selections })
    }
    return undefined
  })

  server.onRpc("$tryApplyEdits", async (args) => {
    // This is called when an extension does TextEditor.edit()
    // We need to forward to renderer which applies to Monaco
    const [id, modelVersionId, edits, opts2] = args || []
    if (!id) return false

    if (sendToRenderer && ipcMain) {
      sendToRenderer("ext-host:editor-applyEdits", { id, modelVersionId, edits, opts: opts2 })
      // For now, assume edits are applied successfully
      return true
    }
    return false
  })

  server.onRpc("$tryRevealRange", (args) => {
    const [id, range, revealType] = args || []
    if (!id) return undefined

    if (sendToRenderer) {
      sendToRenderer("ext-host:editor-revealRange", { id, range, revealType })
    }
    return undefined
  })

  server.onRpc("$trySetOptions", (args) => {
    const [id, options] = args || []
    if (!id) return undefined

    if (sendToRenderer) {
      sendToRenderer("ext-host:editor-setOptions", { id, options })
    }
    return undefined
  })

  server.onRpc("$trySetDecorations", (args) => {
    const [id, key, ranges] = args || []
    if (!id || !key) return undefined

    if (sendToRenderer) {
      sendToRenderer("ext-host:editor-decorations", { id, key, ranges })
    }
    return undefined
  })

  server.onRpc("$registerTextEditorDecorationType", (args) => {
    const [extensionId, key, options] = args || []
    if (!key) return undefined

    if (sendToRenderer) {
      sendToRenderer("ext-host:editor-decorationType", { extensionId, key, options })
    }
    return undefined
  })

  server.onRpc("$removeTextEditorDecorationType", (args) => {
    const [key] = args || []
    if (!key) return undefined

    if (sendToRenderer) {
      sendToRenderer("ext-host:editor-removeDecorationType", { key })
    }
    return undefined
  })

  server.onRpc("$tryInsertSnippet", async (args) => {
    const [id, modelVersionId, template, ranges, opts3] = args || []
    if (!id) return false

    if (sendToRenderer) {
      sendToRenderer("ext-host:editor-insertSnippet", { id, modelVersionId, template, ranges, opts: opts3 })
    }
    return true
  })

  server.onRpc("$getDiffInformation", () => {
    // Diff information not supported yet
    return []
  })

  server.onRpc("$tryShowEditor", () => undefined)
  server.onRpc("$tryHideEditor", () => undefined)
  server.onRpc("$trySetDecorationsFast", () => undefined)
}

module.exports = { register }
