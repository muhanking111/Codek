/**
 * MainThreadDocuments — handles document synchronization from the Extension Host.
 *
 * RPC handlers:
 *   $acceptDocumentsAndEditorsDelta(delta)   — Document/editor state changes
 *   $acceptModelModeChanged(uri, mode)      — Language mode changes
 */

function register(server, opts = {}) {
  server.onRpc("$acceptDocumentsAndEditorsDelta", (args) => {
    const [delta] = args || []
    if (!delta) return undefined

    if (opts.sendToRenderer && (delta.addedDocuments?.length || delta.removedDocuments?.length)) {
      opts.sendToRenderer("ext-host:documents-delta", {
        added: (delta.addedDocuments || []).map((d) => ({
          uri: d.uri,
          languageId: d.languageId,
          versionId: d.versionId,
          lines: d.lines,
          eol: d.eol,
        })),
        removed: (delta.removedDocuments || []).map((d) => d.uri),
      })
    }
    return undefined
  })

  server.onRpc("$acceptModelModeChanged", (args) => {
    const [uri, oldModeId, newModeId] = args || []
    if (!uri || !newModeId) return undefined

    if (opts.sendToRenderer) {
      opts.sendToRenderer("ext-host:model-mode-changed", { uri, mode: newModeId })
    }
    return undefined
  })

  // Document content requests from EH — $provideTextDocumentContent is the reverse call
  // Handled via the call() mechanism
}

module.exports = { register }
