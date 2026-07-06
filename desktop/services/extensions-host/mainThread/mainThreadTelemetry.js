/**
 * MainThreadTelemetry — no-op telemetry handler.
 *
 * The Extension Host sends telemetry events; we silently discard them.
 * All RPC methods on this proxy return undefined.
 */

function register(server) {
  // Log telemetry call at debug level once to confirm it's wired
  let logged = false

  // Generic catch-all for any $telemetry_* methods
  const telemetryMethods = [
    "$publicLog",
    "$publicLog2",
    "$publicLogError2",
    "$flush",
  ]

  for (const method of telemetryMethods) {
    server.onRpc(method, () => {
      if (!logged) {
        console.log("[main-thread:telemetry] Telemetry calls being silently discarded")
        logged = true
      }
      return undefined
    })
  }
}

module.exports = { register }
