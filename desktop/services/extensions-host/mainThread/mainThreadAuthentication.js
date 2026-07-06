/**
 * MainThreadAuthentication — minimal VS Code authentication provider bridge.
 *
 * Extension providers register on the extension host. Codek keeps the main
 * thread provider registry and delegates provider-owned session operations
 * back to ExtHostAuthentication.
 */

const EXT_HOST_AUTHENTICATION_NID = 152
const EXT_HOST_EXTENSION_SERVICE_NID = 106
const ActivationKind = Object.freeze({
  Normal: 0,
  Immediate: 1,
})

const providers = new Map()
const sessionsByProvider = new Map()

function normalizeProviderId(value) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeExtensionId(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function getCallEh(server, opts = {}) {
  if (typeof opts.callEh === "function") return opts.callEh
  return (nid, method, args, timeoutMs) => server.call(nid, method, args, timeoutMs)
}

function sessionScopesMatch(session, scopesOrRequest) {
  const requested = Array.isArray(scopesOrRequest)
    ? scopesOrRequest
    : (Array.isArray(scopesOrRequest?.fallbackScopes) ? scopesOrRequest.fallbackScopes : undefined)
  if (!requested) return true
  const existing = Array.isArray(session?.scopes) ? session.scopes : []
  return requested.every((scope) => existing.includes(scope))
}

function rememberSessions(providerId, sessions) {
  const id = normalizeProviderId(providerId)
  if (!id || !Array.isArray(sessions)) return
  sessionsByProvider.set(id, sessions.slice())
}

function addSession(providerId, session) {
  const id = normalizeProviderId(providerId)
  if (!id || !session) return
  const sessions = sessionsByProvider.get(id) || []
  const existingIndex = sessions.findIndex((item) => item.id === session.id)
  if (existingIndex >= 0) sessions[existingIndex] = session
  else sessions.push(session)
  sessionsByProvider.set(id, sessions)
}

function removeSession(providerId, sessionId) {
  const id = normalizeProviderId(providerId)
  if (!id) return
  const sessions = sessionsByProvider.get(id) || []
  sessionsByProvider.set(id, sessions.filter((session) => session.id !== sessionId))
}

function listAccounts(providerId) {
  const seen = new Set()
  const accounts = []
  for (const session of sessionsByProvider.get(normalizeProviderId(providerId)) || []) {
    const account = session?.account
    if (!account || seen.has(account.id || account.label)) continue
    seen.add(account.id || account.label)
    accounts.push(account)
  }
  return accounts
}

async function ensureProvider(providerId, callEh, timeoutMs = 30000) {
  const id = normalizeProviderId(providerId)
  if (!id || providers.has(id)) return undefined
  await callEh(
    EXT_HOST_EXTENSION_SERVICE_NID,
    "$activateByEvent",
    [`onAuthenticationRequest:${id}`, ActivationKind.Immediate],
    timeoutMs,
  )
  return undefined
}

async function getSession(providerId, scopesOrRequest, extensionId, extensionName, options = {}, callEh, timeoutMs = 30000) {
  const id = normalizeProviderId(providerId)
  if (!id) return undefined
  await ensureProvider(id, callEh, timeoutMs)

  const cached = (sessionsByProvider.get(id) || []).find((session) => sessionScopesMatch(session, scopesOrRequest))
  if (cached && !options.forceNewSession) return cached

  if (options.createIfNone || options.forceNewSession) {
    const session = await callEh(
      EXT_HOST_AUTHENTICATION_NID,
      "$createSession",
      [id, Array.isArray(scopesOrRequest) ? scopesOrRequest : scopesOrRequest?.fallbackScopes || [], options],
      timeoutMs,
    )
    addSession(id, session)
    return session
  }

  const sessions = await callEh(
    EXT_HOST_AUTHENTICATION_NID,
    "$getSessions",
    [id, Array.isArray(scopesOrRequest) ? scopesOrRequest : scopesOrRequest?.fallbackScopes, options],
    timeoutMs,
  )
  rememberSessions(id, sessions)
  return Array.isArray(sessions) ? sessions.find((session) => sessionScopesMatch(session, scopesOrRequest)) : undefined
}

function clearAuthenticationProviders() {
  providers.clear()
  sessionsByProvider.clear()
}

function register(server, opts = {}) {
  const callEh = getCallEh(server, opts)
  const timeoutMs = Math.trunc(Number(opts.timeoutMs)) > 0 ? Math.trunc(Number(opts.timeoutMs)) : 30000

  server.onRpc("$registerAuthenticationProvider", (args) => {
    const [details] = args || []
    const id = normalizeProviderId(details?.id)
    if (!id) return undefined
    providers.set(id, {
      id,
      label: String(details.label || id),
      supportsMultipleAccounts: details.supportsMultipleAccounts === true,
      supportedAuthorizationServers: Array.isArray(details.supportedAuthorizationServers)
        ? details.supportedAuthorizationServers
        : [],
      supportsChallenges: details.supportsChallenges === true,
    })
    if (!sessionsByProvider.has(id)) sessionsByProvider.set(id, [])
    return undefined
  })

  server.onRpc("$unregisterAuthenticationProvider", async (args) => {
    const [providerId] = args || []
    const id = normalizeProviderId(providerId)
    if (!id) return undefined
    providers.delete(id)
    sessionsByProvider.delete(id)
    await callEh(EXT_HOST_AUTHENTICATION_NID, "$onDidUnregisterAuthenticationProvider", [id], timeoutMs)
    return undefined
  })

  server.onRpc("$ensureProvider", (args) => {
    const [providerId] = args || []
    return ensureProvider(providerId, callEh, timeoutMs)
  })

  server.onRpc("$sendDidChangeSessions", async (args) => {
    const [providerId, event] = args || []
    const id = normalizeProviderId(providerId)
    if (!id) return undefined
    const sessions = sessionsByProvider.get(id) || []
    for (const session of event?.added || []) addSession(id, session)
    for (const session of event?.changed || []) addSession(id, session)
    for (const session of event?.removed || []) removeSession(id, session.id)
    if (!event?.added && !event?.changed && !event?.removed) sessionsByProvider.set(id, sessions)
    const provider = providers.get(id)
    await callEh(EXT_HOST_AUTHENTICATION_NID, "$onDidChangeAuthenticationSessions", [id, provider?.label || id], timeoutMs)
    return undefined
  })

  server.onRpc("$getSession", (args) => {
    const [providerId, scopesOrRequest, extensionId, extensionName, options] = args || []
    return getSession(
      providerId,
      scopesOrRequest,
      normalizeExtensionId(extensionId),
      extensionName,
      options || {},
      callEh,
      timeoutMs,
    )
  })

  server.onRpc("$getAccounts", (args) => {
    const [providerId] = args || []
    return listAccounts(providerId)
  })

  server.onRpc("$removeSession", async (args) => {
    const [providerId, sessionId] = args || []
    const id = normalizeProviderId(providerId)
    if (!id || !sessionId) return undefined
    await callEh(EXT_HOST_AUTHENTICATION_NID, "$removeSession", [id, sessionId], timeoutMs)
    removeSession(id, sessionId)
    return undefined
  })

  server.onRpc("$waitForUriHandler", () => {
    throw new Error("Authentication URI handler flow is not available in Codek yet.")
  })

  server.onRpc("$showContinueNotification", () => false)
  server.onRpc("$showDeviceCodeModal", () => false)
  server.onRpc("$promptForClientRegistration", () => undefined)
  server.onRpc("$registerDynamicAuthenticationProvider", () => undefined)
  server.onRpc("$setSessionsForDynamicAuthProvider", () => undefined)
  server.onRpc("$sendDidChangeDynamicProviderInfo", () => undefined)

  if (typeof server.on === "function") {
    const clear = () => clearAuthenticationProviders()
    server.on("stopped", clear)
    server.on("exit", clear)
  }
}

module.exports = {
  ActivationKind,
  EXT_HOST_AUTHENTICATION_NID,
  EXT_HOST_EXTENSION_SERVICE_NID,
  clearAuthenticationProviders,
  ensureProvider,
  getSession,
  register,
}
