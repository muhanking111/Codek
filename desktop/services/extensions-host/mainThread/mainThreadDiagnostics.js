/**
 * MainThreadDiagnostics — handles diagnostic changes from the Extension Host.
 *
 * RPC handlers:
 *   $changeMany(owner, diagnostics)   — Update diagnostics for a resource
 *   $clearDiagnostics(owner)          — Clear all diagnostics for an owner
 *
 * Diagnostics are forwarded to the renderer for display via Monaco markers.
 */

function register(server, opts = {}) {
  server.onRpc("$changeMany", (args) => {
    const [owner, entries] = args || []
    if (!owner) return undefined

    // entries is an array of { uri: URI, diagnostics: Diagnostic[] }
    if (opts.sendToRenderer && entries) {
      // Forward to renderer for Monaco marker display
      const payload = entries.map((entry) => ({
        uri: entry.resource || entry.uri,
        diagnostics: (entry.diagnostics || []).map((d) => ({
          message: d.message,
          severity: d.severity || 0,
          range: d.range,
          code: d.code,
          source: d.source,
          tags: d.tags,
        })),
      }))
      opts.sendToRenderer("ext-host:diagnostics", payload)
    }
    return undefined
  })

  server.onRpc("$clearDiagnostics", (args) => {
    const [owner] = args || []
    if (!owner) return undefined

    if (opts.sendToRenderer) {
      opts.sendToRenderer("ext-host:diagnostics-clear", { owner })
    }
    return undefined
  })
}

module.exports = { register }
