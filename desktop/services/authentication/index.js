/**
 * VS Code source adapter.
 * Source references:
 * - D:\SourceMirror\vscode\src\vs\workbench\services\authentication\common\authentication.ts
 * - D:\SourceMirror\vscode\src\vs\workbench\services\authentication\browser\authenticationService.ts
 *
 * This service owns provider/session lifecycle evidence for desktop-side
 * workbench integration. It does not replace desktop/services/auth login routes
 * and never includes access tokens in snapshots.
 */

function normalizeProviderId(providerId) {
  return String(providerId || "").trim()
}

function normalizeScopes(scopes) {
  if (Array.isArray(scopes)) return scopes.map((scope) => String(scope || "").trim()).filter(Boolean)
  if (typeof scopes === "string" && scopes.trim()) return [scopes.trim()]
  return []
}

function normalizeProvider(provider) {
  const id = normalizeProviderId(provider && provider.id)
  const label = String(provider && provider.label || "").trim()
  if (!id) throw new Error("Authentication provider id is required")
  if (!label) throw new Error("Authentication provider label is required")
  return {
    id,
    label,
    authorizationServerGlobs: Array.isArray(provider.authorizationServerGlobs) ? [...provider.authorizationServerGlobs] : [],
    supportsMultipleAccounts: provider.supportsMultipleAccounts === true,
    source: provider.source || "extension",
  }
}

class AuthenticationClosureService {
  constructor(options = {}) {
    this.serviceId = options.serviceId || "desktopAuthenticationService"
    this.stateSource = "desktopAuthRoutes+mcpOAuthBoundary"
    this.providers = new Map()
    this.sessions = new Map()
    this.lifecycle = []
    this.providerEvidence = []
    this.registerProvider({ id: "github", label: "GitHub", source: "codek" })
    this.providerEvidence.length = 0
  }

  registerProvider(provider) {
    const normalized = normalizeProvider(provider)
    this.providers.set(normalized.id, normalized)
    this.providerEvidence.push({
      serviceId: this.serviceId,
      providerId: normalized.id,
      label: normalized.label,
      action: "register",
      providerCount: this.providers.size,
      createdAt: Date.now(),
    })
    return {
      dispose: () => this.unregisterProvider(normalized.id),
    }
  }

  unregisterProvider(providerId) {
    const id = normalizeProviderId(providerId)
    const provider = this.providers.get(id)
    if (!provider) return
    this.providers.delete(id)
    this.providerEvidence.push({
      serviceId: this.serviceId,
      providerId: id,
      label: provider.label,
      action: "unregister",
      providerCount: this.providers.size,
      createdAt: Date.now(),
    })
  }

  isProviderRegistered(providerId) {
    return this.providers.has(normalizeProviderId(providerId))
  }

  getProviderIds() {
    return Array.from(this.providers.keys())
  }

  createSession(providerId = "github", input = {}) {
    const id = normalizeProviderId(providerId || input.providerId || "github")
    const accountLabel = String(input.accountLabel || input.username || input.email || "codek")
    const scopes = normalizeScopes(input.scopes)
    const status = input.status || "authorized"
    const session = {
      id: input.sessionId || `${id}:${accountLabel}`,
      providerId: id,
      account: {
        id: String(input.accountId || accountLabel),
        label: accountLabel,
      },
      scopes,
      status,
      createdAt: Date.now(),
      tokenRedacted: true,
    }
    if (status === "authorized") this.sessions.set(session.id, session)
    this.recordLifecycle(status === "authorized" ? "login" : "session-added", session)
    return session
  }

  getSessions(providerId, scopes) {
    const id = providerId ? normalizeProviderId(providerId) : ""
    const scopeList = normalizeScopes(scopes)
    return Array.from(this.sessions.values())
      .filter((session) => !id || session.providerId === id)
      .filter((session) => scopeList.every((scope) => session.scopes.includes(scope)))
  }

  removeSession(providerId, sessionId) {
    const id = normalizeProviderId(providerId)
    const existing = this.sessions.get(sessionId)
    const fallbackLabel = String(sessionId || "").split(":").pop() || "codek"
    const session = existing || {
      id: sessionId || `${id}:${fallbackLabel}`,
      providerId: id,
      account: { id: fallbackLabel, label: fallbackLabel },
      scopes: [],
      status: "revoked",
      createdAt: Date.now(),
      tokenRedacted: true,
    }
    this.sessions.delete(session.id)
    const revoked = { ...session, status: "revoked", createdAt: Date.now() }
    this.recordLifecycle("logout", revoked)
    return revoked
  }

  recordLifecycle(action, session, error = "") {
    this.lifecycle.push({
      serviceId: this.serviceId,
      providerId: session.providerId,
      sessionId: session.id,
      accountLabel: session.account && session.account.label || "",
      scopes: Array.isArray(session.scopes) ? [...session.scopes] : [],
      action,
      status: session.status || "authorized",
      tokenRedacted: true,
      secretValueRedacted: true,
      createdAt: Date.now(),
      error: action === "error" ? String(error || "") : "",
    })
  }

  getSnapshot() {
    const sessions = Array.from(this.sessions.values())
    return {
      serviceId: this.serviceId,
      stateSource: this.stateSource,
      providerIds: this.getProviderIds(),
      providers: Array.from(this.providers.values()),
      sessionCount: sessions.length,
      sessions,
      latestSession: sessions[sessions.length - 1] || null,
      lifecycle: [...this.lifecycle],
      providerEvidence: [...this.providerEvidence],
      constraints: {
        noSecondAuthStore: true,
        noTokenInEvidence: true,
        preservesDesktopAuthRoutes: true,
        evidenceSafeEvents: true,
      },
    }
  }

  clearEvidence() {
    this.sessions.clear()
    this.lifecycle.length = 0
    this.providerEvidence.length = 0
  }
}

function createAuthenticationClosureService(options) {
  return new AuthenticationClosureService(options)
}

const globalAuthenticationClosureService = createAuthenticationClosureService()

module.exports = {
  AuthenticationClosureService,
  createAuthenticationClosureService,
  globalAuthenticationClosureService,
}
