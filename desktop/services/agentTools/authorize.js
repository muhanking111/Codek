/*---------------------------------------------------------------------------------------------
 *  Agent tools authorization bridge.
 *
 *  Renderer ←→ Main flow for user approval of risky tool calls.
 *
 *  Main → Renderer: webContents.send("agentTools:authRequest", { requestId, tool, input, preview })
 *  Renderer → Main: ipcRenderer.send("agentTools:authResolve", { requestId, allow, alwaysAllow })
 *
 *  Always-allow decisions persist in-memory for the current session.
 *--------------------------------------------------------------------------------------------*/

const pending = new Map()
const alwaysAllowSet = new Set()
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

let initialized = false
let ipcMain = null

function getIpcMain() {
  if (ipcMain) return ipcMain
  try {
    ;({ ipcMain } = require("electron"))
  } catch {
    return null
  }
  return ipcMain
}

function init() {
  if (initialized) return
  const ipc = getIpcMain()
  if (!ipc) return
  initialized = true
  ipc.on("agentTools:authResolve", (_event, payload) => {
    if (!payload || typeof payload.requestId !== "string") return
    const entry = pending.get(payload.requestId)
    if (!entry) return
    pending.delete(payload.requestId)
    clearTimeout(entry.timer)
    const allow = !!payload.allow
    if (allow && payload.alwaysAllow && entry.toolName) {
      alwaysAllowSet.add(entry.toolName)
    }
    entry.resolve({ allow, alwaysAllow: !!payload.alwaysAllow })
  })
}

/**
 * Ask the renderer to approve a tool invocation. Resolves with { allow, alwaysAllow }.
 * If sender is no longer alive, resolves with allow=false.
 */
function requestAuthorization(sender, { toolName, input, preview, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  init()
  if (!sender || sender.isDestroyed?.()) {
    return Promise.resolve({ allow: false, alwaysAllow: false })
  }
  if (alwaysAllowSet.has(toolName)) {
    return Promise.resolve({ allow: true, alwaysAllow: true })
  }
  const requestId = `auth_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pending.delete(requestId)) {
        resolve({ allow: false, alwaysAllow: false })
      }
    }, timeoutMs)
    pending.set(requestId, { resolve, timer, toolName })
    try {
      sender.send("agentTools:authRequest", {
        requestId,
        tool: toolName,
        input,
        preview: preview || null,
      })
    } catch (err) {
      pending.delete(requestId)
      clearTimeout(timer)
      resolve({ allow: false, alwaysAllow: false })
    }
  })
}

function isAlwaysAllowed(toolName) {
  return alwaysAllowSet.has(toolName)
}

function clearAlwaysAllow(toolName) {
  if (toolName) {
    alwaysAllowSet.delete(toolName)
  } else {
    alwaysAllowSet.clear()
  }
}

module.exports = {
  requestAuthorization,
  isAlwaysAllowed,
  clearAlwaysAllow,
}
