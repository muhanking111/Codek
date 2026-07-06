/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code profile import/export extension activation:
 * - D:\SourceMirror\vscode\src\vs\workbench\services\userDataProfile\browser\userDataProfileImportExportService.ts
 * - D:\SourceMirror\vscode\src\vs\workbench\api\common\extHost.protocol.ts
 *--------------------------------------------------------------------------------------------*/

const EXT_HOST_EXTENSION_SERVICE_NID = 106
const ActivationKind = Object.freeze({
  Normal: 0,
  Immediate: 1,
})

function createNoopProfileContentHandlerActivationAdapter() {
  return async () => undefined
}

function createExtensionHostProfileContentHandlerActivationAdapter(options = {}) {
  const getHost = typeof options.getHost === "function" ? options.getHost : defaultGetHost
  const callEh = typeof options.callEh === "function" ? options.callEh : defaultCallEh
  const timeoutMs = normalizeTimeout(options.timeoutMs)

  return async function activateProfileContentHandlers({ handlerId, includeGeneric = true, signal } = {}) {
    throwIfAborted(signal)
    const host = getHost()
    if (!host?.isRunning) return undefined

    const activationEvents = profileContentHandlerActivationEvents({ handlerId, includeGeneric })
    for (const activationEvent of activationEvents) {
      throwIfAborted(signal)
      await callEh(host, EXT_HOST_EXTENSION_SERVICE_NID, "$activateByEvent", [activationEvent, ActivationKind.Normal], timeoutMs)
    }
    if (typeof host.whenInstalledExtensionsRegistered === "function") {
      await host.whenInstalledExtensionsRegistered(timeoutMs)
    }
    throwIfAborted(signal)
    return undefined
  }
}

function profileContentHandlerActivationEvents({ handlerId, includeGeneric = true } = {}) {
  const events = []
  const normalizedHandlerId = normalizeHandlerId(handlerId)
  if (normalizedHandlerId) events.push(`onProfile:${normalizedHandlerId}`)
  if (includeGeneric && !events.includes("onProfile")) events.push("onProfile")
  if (events.length === 0) events.push("onProfile")
  return events
}

function normalizeHandlerId(value) {
  return String(value || "").trim()
}

function defaultGetHost() {
  try {
    const extensionsHost = require("./index")
    if (typeof extensionsHost.getCurrentHost === "function") return extensionsHost.getCurrentHost()
    if (typeof extensionsHost.getHost === "function") return extensionsHost.getHost()
    return null
  } catch {
    return null
  }
}

function defaultCallEh(host, extHostNid, method, args, timeoutMs) {
  return host.call(extHostNid, method, args, timeoutMs)
}

function normalizeTimeout(value) {
  const numeric = Math.trunc(Number(value))
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 30000
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  const error = new Error("Profile content handler activation cancelled")
  error.name = "AbortError"
  throw error
}

module.exports = {
  ActivationKind,
  EXT_HOST_EXTENSION_SERVICE_NID,
  createExtensionHostProfileContentHandlerActivationAdapter,
  createNoopProfileContentHandlerActivationAdapter,
  profileContentHandlerActivationEvents,
}
