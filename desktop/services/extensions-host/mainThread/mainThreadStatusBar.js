/**
 * MainThreadStatusBar — handles status bar entries from the Extension Host.
 *
 * RPC handlers:
 *   $setEntry(id, statusId, extName, text, tooltip, ...) — Set a status bar entry
 *   $disposeEntry(id)                                     — Remove a status bar entry
 */

const MAIN_THREAD_STATUS_BAR_NID = 34

function buildStatusBarBridgeOwnerEvidence() {
  return {
    owner: "MainThreadStatusBar",
    status: "partial",
    stateSource: "ExtHostStatusBarShape -> ext-host:statusbar-entry renderer event",
    rendererStateSource: "workbenchStatusNotificationProgressService.statusbarItems",
    noSecondStatusbarState: true,
    vscodeSource: "src/vs/workbench/services/statusbar/browser/statusbar.ts",
    remainingUiGap: "renderer statusbar IPC consumer / App.vue central shell owner is not connected in this adapter",
  }
}

function onRpc(server, method, handler) {
  server.onRpc(MAIN_THREAD_STATUS_BAR_NID, method, handler)
  server.onRpc(method, handler)
}

function register(server, opts = {}) {
  const { sendToRenderer } = opts

  onRpc(server, "$setEntry", (args) => {
    const [id, statusId, extensionId, statusName, text, tooltip, hasTooltipProvider, command, color, backgroundColor, alignLeft, priority, accessibilityInfo] = args || []
    if (!id) return undefined

    if (sendToRenderer) {
      sendToRenderer("ext-host:statusbar-entry", {
        id,
        statusId,
        extensionId,
        statusName,
        text: text || "",
        tooltip: typeof tooltip === "string" ? tooltip : undefined,
        command,
        color: typeof color === "string" ? color : undefined,
        backgroundColor: typeof backgroundColor === "string" ? backgroundColor : undefined,
        alignLeft: !!alignLeft,
        priority: priority || 0,
        accessibilityInfo,
        ownerEvidence: buildStatusBarBridgeOwnerEvidence(),
      })
    }
    return undefined
  })

  onRpc(server, "$disposeEntry", (args) => {
    const [id] = args || []
    if (!id) return undefined

    if (sendToRenderer) {
      sendToRenderer("ext-host:statusbar-dispose", { id, ownerEvidence: buildStatusBarBridgeOwnerEvidence() })
    }
    return undefined
  })
}

module.exports = { MAIN_THREAD_STATUS_BAR_NID, buildStatusBarBridgeOwnerEvidence, register }
