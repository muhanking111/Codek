/**
 * MainThreadWindow — handles VS Code window/env bridge RPC from the Extension Host.
 */

const MAIN_THREAD_WINDOW_NID = 57

let windowState = {
  isFocused: true,
  isActive: true,
}

function normalizeWindowState(nextState = {}) {
  return {
    isFocused: nextState.isFocused !== false,
    isActive: nextState.isActive !== false,
  }
}

function setWindowState(nextState = {}) {
  windowState = normalizeWindowState({ ...windowState, ...nextState })
  return getWindowState()
}

function getWindowState() {
  return { ...windowState }
}

function register(server, opts = {}) {
  if (typeof opts.setExtHostWindowState === "function") {
    opts.setExtHostWindowState(setWindowState)
  }

  server.onRpc(MAIN_THREAD_WINDOW_NID, "$getInitialState", () => {
    return getWindowState()
  })

  server.onRpc(MAIN_THREAD_WINDOW_NID, "$openUri", (args) => {
    const [uri, uriString, options] = args || []
    const payload = {
      uri,
      uriString: typeof uriString === "string" ? uriString : undefined,
      options: options || {},
    }
    if (typeof opts.openExternal === "function") return opts.openExternal(payload)
    if (typeof opts.sendToRenderer === "function") {
      opts.sendToRenderer("ext-host:window-open-uri", payload)
      return true
    }
    return false
  })

  server.onRpc(MAIN_THREAD_WINDOW_NID, "$asExternalUri", (args) => {
    const [uri, options] = args || []
    if (typeof opts.asExternalUri === "function") return opts.asExternalUri(uri, options || {})
    return uri
  })
}

module.exports = {
  MAIN_THREAD_WINDOW_NID,
  getWindowState,
  register,
  setWindowState,
}
