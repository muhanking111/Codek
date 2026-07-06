/**
 * MainThreadProgress — handles progress operations from the Extension Host.
 *
 * RPC handlers:
 *   $startProgress(handle, options, extId)   — Start a progress indicator
 *   $progressReport(handle, message)         — Report progress update
 *   $progressEnd(handle)                     — End progress
 */

const { ExtHostContext } = require("../extHostServer")

const MAIN_THREAD_PROGRESS_NID = 31
const EXT_HOST_PROGRESS_NID = ExtHostContext.ExtHostProgress
const PROGRESS_LOCATION_NOTIFICATION = 15

function buildProgressBridgeOwnerEvidence() {
  return {
    owner: "MainThreadProgress",
    status: "connected",
    stateSource: "ExtHostProgressShape -> ext-host:progress-* renderer events",
    rendererStateSource: "workbenchStatusNotificationProgressService.progressTasks",
    notificationStateSource: "workbenchStatusNotificationProgressService.notifications",
    noSecondProgressState: true,
    vscodeSource: "src/vs/platform/progress/common/progress.ts",
    cancelBridge: "ext-host:progress-cancel -> ExtHostProgress.$acceptProgressCanceled",
  }
}

function onRpc(server, method, handler) {
  server.onRpc(MAIN_THREAD_PROGRESS_NID, method, handler)
  server.onRpc(method, handler)
}

function getCallEh(server, opts = {}) {
  if (typeof opts.callEh === "function") return opts.callEh
  return (nid, method, args, timeoutMs) => server.call(nid, method, args, timeoutMs)
}

function normalizeProgressAction(action) {
  const id = String(action?.id || action?.command || "").trim()
  const label = String(action?.label || action?.labelShort || id).trim()
  if (!id || !label) return null
  const result = {
    id,
    label,
  }
  if (typeof action?.command === "string") result.command = action.command
  if (Array.isArray(action?.args)) result.args = action.args
  if (action?.keepOpen === true) result.keepOpen = true
  return result
}

function normalizeProgressActions(actions) {
  if (!Array.isArray(actions)) return []
  return actions.map(normalizeProgressAction).filter(Boolean)
}

function register(server, opts = {}) {
  const { ipcMain, sendToRenderer } = opts
  const callEh = getCallEh(server, opts)

  if (ipcMain && typeof ipcMain.on === "function") {
    ipcMain.on("ext-host:progress-cancel", (_event, payload = {}) => {
      const handle = payload?.handle
      if (handle == null) return
      Promise.resolve(callEh(EXT_HOST_PROGRESS_NID, "$acceptProgressCanceled", [handle, payload?.choice], 30000)).catch(() => {})
    })
  }

  onRpc(server, "$startProgress", (args) => {
    const [handle, options, extensionId] = args || []
    if (handle == null) return undefined

    const location = options?.location
    const title = options?.title
    const source = options?.source
    const secondaryActions = normalizeProgressActions(options?.secondaryActions)
    const notificationSecondaryActions = location === PROGRESS_LOCATION_NOTIFICATION && extensionId
      ? [
        ...secondaryActions,
        {
          id: "workbench.extensions.manage",
          label: "Manage Extension",
          command: "_extensions.manage",
          args: [extensionId],
          keepOpen: true,
        },
      ]
      : secondaryActions

    if (sendToRenderer) {
      sendToRenderer("ext-host:progress-start", {
        handle,
        location,
        title,
        source,
        cancellable: !!options?.cancellable,
        cancellableLabel: typeof options?.cancellable === "string" ? options.cancellable : undefined,
        buttons: Array.isArray(options?.buttons) ? options.buttons : [],
        secondaryActions: notificationSecondaryActions,
        extensionId,
        ownerEvidence: buildProgressBridgeOwnerEvidence(),
      })
    }
    return undefined
  })

  onRpc(server, "$progressReport", (args) => {
    const [handle, message] = args || []
    if (handle == null) return undefined

    if (sendToRenderer) {
      sendToRenderer("ext-host:progress-report", { handle, message, ownerEvidence: buildProgressBridgeOwnerEvidence() })
    }
    return undefined
  })

  onRpc(server, "$progressEnd", (args) => {
    const [handle] = args || []
    if (handle == null) return undefined

    if (sendToRenderer) {
      sendToRenderer("ext-host:progress-end", { handle, ownerEvidence: buildProgressBridgeOwnerEvidence() })
    }
    return undefined
  })
}

module.exports = { EXT_HOST_PROGRESS_NID, MAIN_THREAD_PROGRESS_NID, buildProgressBridgeOwnerEvidence, register }
