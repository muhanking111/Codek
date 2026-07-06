/**
 * MainThreadMessageService — handles message/notification display.
 *
 * RPC handlers:
 *   $showMessage(severity, message, options)  — Show a message dialog
 *   $showSaveDialog(options)                  — Show save dialog
 *   $showOpenDialog(options)                  — Show open dialog
 */

const MAIN_THREAD_MESSAGE_SERVICE_NID = 28

function onRpc(server, method, handler) {
  server.onRpc(MAIN_THREAD_MESSAGE_SERVICE_NID, method, handler)
  server.onRpc(method, handler)
}

function register(server, opts = {}) {
  const { ipcMain, sendToRenderer } = opts
  let nextMessageRequestId = 0

  function waitForIpc(channel, predicate, timeoutMs = 300000) {
    if (!ipcMain) return Promise.resolve(undefined)
    return new Promise((resolve) => {
      const handler = (_event, payload) => {
        if (!predicate(payload)) return
        ipcMain.removeListener(channel, handler)
        clearTimeout(timeout)
        resolve(payload)
      }
      const timeout = setTimeout(() => {
        ipcMain.removeListener(channel, handler)
        resolve(undefined)
      }, timeoutMs)
      ipcMain.on(channel, handler)
    })
  }

  onRpc(server, "$showMessage", async (args) => {
    const [severity, message, options, commands] = args || []
    if (!message) return undefined

    const severityLabel = ["info", "info", "warn", "error"][severity] || "info"
    const normalizedCommands = Array.isArray(commands)
      ? commands.map((command) => ({
        title: String(command?.title || ""),
        handle: Number(command?.handle),
        isCloseAffordance: command?.isCloseAffordance === true,
      })).filter((command) => command.title && Number.isFinite(command.handle))
      : []

    // Forward to renderer for UI toast/notification
    if (sendToRenderer) {
      const requestId = `message-${Date.now()}-${nextMessageRequestId += 1}`
      const selected = sendToRenderer("ext-host:message", {
        requestId,
        severity: severityLabel,
        message,
        options: options || {},
        commands: normalizedCommands,
        actions: normalizedCommands.map((command) => command.title),
      })
      if (Number.isFinite(selected)) return selected
      if (normalizedCommands.length > 0) {
        const payload = await waitForIpc("ext-host:message-result", (value) => value && value.requestId === requestId)
        if (Number.isFinite(payload?.handle)) return payload.handle
      }
    }

    // VS Code expects a Promise<number> with the selected action index
    // Return undefined when no renderer selection is available.
    return undefined
  })

  onRpc(server, "$showSaveDialog", (args) => {
    const [options] = args || []
    return undefined
  })

  onRpc(server, "$showOpenDialog", (args) => {
    const [options] = args || []
    return undefined
  })
}

module.exports = { MAIN_THREAD_MESSAGE_SERVICE_NID, register }
