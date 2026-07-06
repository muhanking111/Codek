/**
 * MainThreadLogService — handles log messages from the Extension Host.
 *
 * RPC handlers:
 *   $log(level, message)     — Log a message at the given level
 */

function register(server) {
  server.onRpc("$log", (args) => {
    const [level, message] = args || []
    if (!message) return undefined

    const prefix = `[ext-host:${level || "info"}]`
    switch (level) {
      case "error":
      case "warn":
        console.warn(prefix, message)
        break
      case "trace":
      case "debug":
        if (process.env.DEBUG_EXT_HOST) console.log(prefix, message)
        break
      default:
        console.log(prefix, message)
    }
    return undefined
  })
}

module.exports = { register }
