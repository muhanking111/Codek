/**
 * MainThreadErrors — handles error forwarding from the Extension Host.
 *
 * RPC handlers:
 *   $onExtHostError(err)     — Log extension host errors
 */

function register(server) {
  server.onRpc("$onExtHostError", (args) => {
    const [err] = args || []
    if (!err) return undefined
    const msg = typeof err === "string" ? err : (err.message || JSON.stringify(err))
    console.error(`[ext-host:error] ${msg}`)
    return undefined
  })
}

module.exports = { register }
