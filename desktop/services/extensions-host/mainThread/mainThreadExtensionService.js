/**
 * MainThreadExtensionService handles extension lifecycle events emitted by the
 * VS Code extension host. Keeping these RPC names aligned with VS Code lets
 * real extensions finish activation instead of failing on missing lifecycle
 * hooks.
 */

const { hashError, sanitizeValue } = require("../extensionAuditLog")

const MAIN_THREAD_EXTENSION_SERVICE_NID = 52

const lifecycle = {
  activated: new Set(),
  activating: new Set(),
  activationErrors: [],
  runtimeErrors: [],
}

function normalizeIdentifier(value) {
  if (!value) return ""
  if (typeof value === "string") return value
  return value.value || value._lower || String(value)
}

function getLifecycleState() {
  return {
    activating: Array.from(lifecycle.activating),
    activated: Array.from(lifecycle.activated),
    activationErrors: lifecycle.activationErrors.slice(),
    runtimeErrors: lifecycle.runtimeErrors.slice(),
  }
}

function resetLifecycleState() {
  lifecycle.activated.clear()
  lifecycle.activating.clear()
  lifecycle.activationErrors = []
  lifecycle.runtimeErrors = []
}

function registerRpc(server, method, handler) {
  server.onRpc(MAIN_THREAD_EXTENSION_SERVICE_NID, method, handler)
  server.onRpc(method, handler)
}

function audit(opts, entry) {
  if (typeof opts.auditApiInvocation !== "function") return
  try { opts.auditApiInvocation(entry) } catch {}
}

function sanitizeErrorMessage(err) {
  return sanitizeValue(err?.message || String(err || "unknown error"))
}

function register(server, opts = {}) {
  registerRpc(server, "$activateExtension", (args) => {
    const id = normalizeIdentifier(args?.[0])
    if (!id) return undefined
    console.log(`[main-thread:ext-service] Activate: ${id}`)
    lifecycle.activated.add(id)
    lifecycle.activating.delete(id)
    audit(opts, {
      action: "extensionHost.lifecycle.activate",
      extensionId: id,
      status: "ok",
      phase: "activation",
    })
    return undefined
  })

  registerRpc(server, "$onWillActivateExtension", (args) => {
    const id = normalizeIdentifier(args?.[0])
    if (id) lifecycle.activating.add(id)
    if (id) {
      audit(opts, {
        action: "extensionHost.lifecycle.willActivate",
        extensionId: id,
        status: "info",
        phase: "activation",
      })
    }
    return undefined
  })

  registerRpc(server, "$onDidActivateExtension", (args) => {
    const id = normalizeIdentifier(args?.[0])
    if (id) {
      lifecycle.activated.add(id)
      lifecycle.activating.delete(id)
      audit(opts, {
        action: "extensionHost.lifecycle.didActivate",
        extensionId: id,
        status: "ok",
        phase: "activation",
      })
    }
    return undefined
  })

  registerRpc(server, "$onExtensionActivationError", (args) => {
    const id = normalizeIdentifier(args?.[0])
    const err = args?.[1]
    const message = sanitizeErrorMessage(err)
    lifecycle.activationErrors.push({
      id,
      message,
    })
    audit(opts, {
      action: "extensionHost.lifecycle.activationError",
      extensionId: id,
      status: "failed",
      phase: "activation",
      metadata: { errorHash: hashError(err) },
    })
    return undefined
  })

  registerRpc(server, "$onExtensionRuntimeError", (args) => {
    const id = normalizeIdentifier(args?.[0])
    const err = args?.[1]
    const msg = sanitizeErrorMessage(err)
    lifecycle.runtimeErrors.push({ id, message: msg })
    console.error(`[main-thread:ext-service] Runtime error in ${id}: ${msg}`)
    audit(opts, {
      action: "extensionHost.lifecycle.runtimeError",
      extensionId: id,
      status: "failed",
      phase: "runtime",
      metadata: { errorHash: hashError(err) },
    })
    return undefined
  })

  registerRpc(server, "$setEnabledExtension", (args) => {
    const id = normalizeIdentifier(args?.[0])
    const enabled = args?.[1]
    console.log(`[main-thread:ext-service] ${enabled ? "Enable" : "Disable"}: ${id}`)
    return undefined
  })
}

module.exports = {
  MAIN_THREAD_EXTENSION_SERVICE_NID,
  getLifecycleState,
  register,
  resetLifecycleState,
}
