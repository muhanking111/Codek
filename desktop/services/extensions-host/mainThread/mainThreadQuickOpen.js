/**
 * MainThreadQuickOpen — handles quick pick / input box from the Extension Host.
 *
 * RPC handlers:
 *   $createOrUpdate(params)    — Create/update a QuickInput session
 *   $show(instance, options)   — Show and wait for selection
 *   $setItems(instance, items) — Set pick items
 *   $setError(instance, error) — Set error state
 *   $input(options)            — Show input box
 *   $dispose(instance)         — Dispose a session
 *
 * For interactive operations, forwards to renderer via IPC and waits for result.
 */

const MAIN_THREAD_QUICK_OPEN_NID = 33

function onRpc(server, method, handler) {
  server.onRpc(MAIN_THREAD_QUICK_OPEN_NID, method, handler)
  server.onRpc(method, handler)
}

function register(server, opts = {}) {
  const { ipcMain, sendToRenderer } = opts
  const pendingQuickPickItems = new Map()

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

  // ── Quick pick ──────────────────────────────────────────────────────

  onRpc(server, "$createOrUpdate", (args) => {
    const [instance, params] = args || []
    if (instance == null) return undefined

    if (sendToRenderer) {
      sendToRenderer("ext-host:quickpick-update", { instance, params })
    }
    return undefined
  })

  onRpc(server, "$show", async (args) => {
    const [instance, options] = args || []
    if (instance == null) return undefined

    // Forward to renderer and wait for user selection via IPC
    if (ipcMain && sendToRenderer) {
      sendToRenderer("ext-host:quickpick-show", {
        instance,
        options,
        items: pendingQuickPickItems.get(instance) || [],
      })
      try {
        // Wait for result from renderer — renderer sends back via IPC.
        const payload = await waitForIpc("ext-host:quickpick-result", (value) => value && value.instance === instance)
        return payload?.result
      } catch {
        return undefined
      }
    }
    // No renderer — return undefined
    return undefined
  })

  onRpc(server, "$setItems", (args) => {
    const [instance, items] = args || []
    if (instance == null) return undefined
    pendingQuickPickItems.set(instance, Array.isArray(items) ? items : [])

    if (sendToRenderer) {
      sendToRenderer("ext-host:quickpick-items", { instance, items: pendingQuickPickItems.get(instance) })
    }
    return undefined
  })

  onRpc(server, "$setError", (args) => {
    const [instance, error] = args || []
    if (instance == null) return undefined

    if (sendToRenderer) {
      sendToRenderer("ext-host:quickpick-error", { instance, error: error?.message || String(error) })
    }
    return undefined
  })

  onRpc(server, "$dispose", (args) => {
    const [instance] = args || []
    if (instance == null) return undefined
    pendingQuickPickItems.delete(instance)

    if (sendToRenderer) {
      sendToRenderer("ext-host:quickpick-dispose", { instance })
    }
    return undefined
  })

  // ── Input box ───────────────────────────────────────────────────────

  onRpc(server, "$input", async (args) => {
    const [options, validateInput] = args || []

    if (ipcMain && sendToRenderer) {
      const instanceId = `input-${Date.now()}`
      sendToRenderer("ext-host:input-show", { instanceId, options, validateInput: validateInput === true })

      try {
        const payload = await waitForIpc("ext-host:input-result", (value) => value && value.instanceId === instanceId)
        return payload?.value
      } catch {
        return undefined
      }
    }
    return undefined
  })
}

module.exports = { MAIN_THREAD_QUICK_OPEN_NID, register }
