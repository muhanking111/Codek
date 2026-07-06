/**
 * MainThreadClipboard — handles clipboard operations from the Extension Host.
 *
 * RPC handlers:
 *   $readText()     → string (clipboard contents)
 *   $writeText(text) → void
 *
 * Note: In Electron main process, clipboard requires the 'clipboard' module.
 */

const MAIN_THREAD_CLIPBOARD_NID = 8

function onRpc(server, method, handler) {
  server.onRpc(MAIN_THREAD_CLIPBOARD_NID, method, handler)
  server.onRpc(method, handler)
}

function register(server) {
  onRpc(server, "$readText", () => {
    try {
      const { clipboard } = require("electron")
      return clipboard.readText()
    } catch {
      return ""
    }
  })

  onRpc(server, "$writeText", (args) => {
    const [text] = args || []
    if (text == null) return undefined

    try {
      const { clipboard } = require("electron")
      clipboard.writeText(String(text))
    } catch {
      // Electron clipboard not available
    }
    return undefined
  })
}

module.exports = { MAIN_THREAD_CLIPBOARD_NID, register }
