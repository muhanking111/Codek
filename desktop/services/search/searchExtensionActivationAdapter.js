/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code SearchService#doSearch extension activation:
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\common\searchService.ts
 * - D:\SourceMirror\vscode\src\vs\workbench\api\common\extHost.protocol.ts
 *--------------------------------------------------------------------------------------------*/

const EXT_HOST_EXTENSION_SERVICE_NID = 106
const ActivationKind = Object.freeze({
  Normal: 0,
  Immediate: 1,
})

function createNoopSearchExtensionActivationAdapter() {
  return async () => undefined
}

function createExtensionHostSearchActivationAdapter(options = {}) {
  const getHost = typeof options.getHost === "function" ? options.getHost : defaultGetHost
  const callEh = typeof options.callEh === "function" ? options.callEh : defaultCallEh
  const timeoutMs = normalizeTimeout(options.timeoutMs)

  return async function activateSearchProviders({ schemes = ["file"], signal } = {}) {
    throwIfAborted(signal)
    const host = getHost()
    if (!host?.isRunning) return undefined

    const activationEvents = searchActivationEvents(schemes)
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

function searchActivationEvents(schemes = ["file"]) {
  const normalizedSchemes = normalizeSchemes(schemes)
  const events = normalizedSchemes.map((scheme) => `onSearch:${scheme}`)
  if (!events.includes("onSearch:file")) events.push("onSearch:file")
  return events
}

function normalizeSchemes(schemes) {
  const source = Array.isArray(schemes) && schemes.length ? schemes : ["file"]
  const normalized = []
  const seen = new Set()
  for (const scheme of source) {
    const value = String(scheme || "file").trim().toLowerCase() || "file"
    if (seen.has(value)) continue
    seen.add(value)
    normalized.push(value)
  }
  return normalized.length ? normalized : ["file"]
}

function defaultGetHost() {
  try {
    const extensionsHost = require("../extensions-host")
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
  const error = new Error("Search cancelled")
  error.name = "AbortError"
  throw error
}

module.exports = {
  ActivationKind,
  EXT_HOST_EXTENSION_SERVICE_NID,
  createExtensionHostSearchActivationAdapter,
  createNoopSearchExtensionActivationAdapter,
  searchActivationEvents,
}
