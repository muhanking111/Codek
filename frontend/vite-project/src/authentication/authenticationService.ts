import { auth } from "../auth/authState"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import type { Disposable } from "../vscode-adapter/platform/commands/common/commandsRegistry"

// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\workbench\services\authentication\common\authentication.ts
// - D:\SourceMirror\vscode\src\vs\workbench\services\authentication\browser\authenticationService.ts
//
// Codek keeps authState/MCP OAuth as the runtime login boundary. This service
// adds the VS Code provider/session registry contract without creating a second
// token store and without exposing access tokens in evidence snapshots.

export type AuthenticationSessionStatus = "missing" | "pending" | "authorized" | "expired" | "revoked" | "error"
export type AuthenticationLifecycleAction =
  | "provider-registered"
  | "provider-unregistered"
  | "session-added"
  | "session-changed"
  | "session-removed"
  | "session-observed"
  | "login"
  | "logout"
  | "error"

export interface AuthenticationSessionAccount {
  id: string
  label: string
}

export interface AuthenticationSessionProjection {
  id: string
  providerId: string
  account: AuthenticationSessionAccount
  scopes: string[]
  status: AuthenticationSessionStatus
  createdAt: number
  tokenRedacted: true
}

export interface AuthenticationSessionsChangeEvent {
  added?: AuthenticationSessionProjection[]
  removed?: AuthenticationSessionProjection[]
  changed?: AuthenticationSessionProjection[]
}

export interface AuthenticationProviderInformation {
  id: string
  label: string
  authorizationServerGlobs?: string[]
  supportsMultipleAccounts?: boolean
  source?: "extension" | "codek" | "dynamic"
}

export interface AuthenticationProviderRegistrationEvidence {
  serviceId: string
  providerId: string
  label: string
  action: "register" | "unregister"
  providerCount: number
  createdAt: number
}

export interface AuthenticationLifecycleEvidence {
  serviceId: string
  providerId: string
  sessionId: string
  accountLabel: string
  scopes: string[]
  action: AuthenticationLifecycleAction
  status: AuthenticationSessionStatus
  tokenRedacted: true
  secretValueRedacted: true
  createdAt: number
  error: string
}

export interface AuthenticationServiceSnapshot {
  serviceId: string
  stateSource: "authState+mcpRegistryClient"
  providerIds: string[]
  providers: AuthenticationProviderInformation[]
  sessionCount: number
  sessions: AuthenticationSessionProjection[]
  latestSession: AuthenticationSessionProjection | null
  lifecycle: AuthenticationLifecycleEvidence[]
  providerEvidence: AuthenticationProviderRegistrationEvidence[]
  constraints: {
    noSecondAuthStore: true
    noTokenInEvidence: true
    preservesMcpOAuthBoundary: true
    evidenceSafeEvents: true
  }
}

export interface AuthenticationProvider {
  id: string
  label: string
  authorizationServerGlobs?: string[]
  supportsMultipleAccounts?: boolean
}

type Listener<T> = (event: T) => void

export interface WorkbenchAuthenticationService {
  readonly _serviceBrand: undefined
  registerAuthenticationProvider(provider: AuthenticationProvider): Disposable
  unregisterAuthenticationProvider(providerId: string): void
  isAuthenticationProviderRegistered(providerId: string): boolean
  getProviderIds(): string[]
  getProviders(): AuthenticationProviderInformation[]
  observeCodekAuthState(providerId?: string, scopes?: string[] | string): AuthenticationSessionProjection
  createSession(providerId?: string, scopes?: string[] | string, accountLabel?: string): Promise<AuthenticationSessionProjection>
  getSessions(providerId?: string, scopes?: string[] | string): Promise<AuthenticationSessionProjection[]>
  removeSession(providerId: string, sessionId: string): Promise<void>
  recordSessionChange(providerId: string, event: AuthenticationSessionsChangeEvent): void
  onDidRegisterAuthenticationProvider(listener: Listener<AuthenticationProviderInformation>): Disposable
  onDidUnregisterAuthenticationProvider(listener: Listener<AuthenticationProviderInformation>): Disposable
  onDidChangeSessions(listener: Listener<{ providerId: string; label: string; event: AuthenticationSessionsChangeEvent }>): Disposable
  getSnapshot(): AuthenticationServiceSnapshot
  clearEvidence(): void
}

export const IWorkbenchAuthenticationService = createDecorator<WorkbenchAuthenticationService>("workbenchAuthenticationService")

export class CodekWorkbenchAuthenticationService implements WorkbenchAuthenticationService {
  declare readonly _serviceBrand: undefined
  private readonly providers = new Map<string, AuthenticationProviderInformation>()
  private readonly sessions = new Map<string, AuthenticationSessionProjection>()
  private readonly lifecycle: AuthenticationLifecycleEvidence[] = []
  private readonly providerEvidence: AuthenticationProviderRegistrationEvidence[] = []
  private readonly registerListeners = new Set<Listener<AuthenticationProviderInformation>>()
  private readonly unregisterListeners = new Set<Listener<AuthenticationProviderInformation>>()
  private readonly sessionListeners = new Set<Listener<{ providerId: string; label: string; event: AuthenticationSessionsChangeEvent }>>()

  constructor() {
    this.registerAuthenticationProvider({ id: "github", label: "GitHub", source: "codek" } as AuthenticationProvider)
    this.providerEvidence.length = 0
  }

  registerAuthenticationProvider(provider: AuthenticationProvider): Disposable {
    const normalized = normalizeProvider(provider)
    this.providers.set(normalized.id, normalized)
    const evidence = this.recordProviderEvidence(normalized, "register")
    this.emit(this.registerListeners, normalized)

    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        if (this.providerEvidence.includes(evidence)) this.unregisterAuthenticationProvider(normalized.id)
      },
    }
  }

  unregisterAuthenticationProvider(providerId: string): void {
    const id = normalizeProviderId(providerId)
    const provider = this.providers.get(id)
    if (!provider) return
    this.providers.delete(id)
    this.recordProviderEvidence(provider, "unregister")
    this.emit(this.unregisterListeners, provider)
  }

  isAuthenticationProviderRegistered(providerId: string): boolean {
    return this.providers.has(normalizeProviderId(providerId))
  }

  getProviderIds(): string[] {
    return [...this.providers.keys()]
  }

  getProviders(): AuthenticationProviderInformation[] {
    return [...this.providers.values()]
  }

  observeCodekAuthState(providerId: string = auth.oauthProvider || "github", scopes: string[] | string = []): AuthenticationSessionProjection {
    const session = this.buildSession(providerId, normalizeScopes(scopes), auth.username || auth.email || "", statusFromAuthState())
    if (session.status === "authorized") this.sessions.set(session.id, session)
    this.recordLifecycle("session-observed", session)
    this.fireSessionChange(session.providerId, { changed: [session] })
    return session
  }

  async createSession(providerId: string = auth.oauthProvider || "github", scopes: string[] | string = [], accountLabel: string = auth.username || auth.email || ""): Promise<AuthenticationSessionProjection> {
    const status = auth.isLoggedIn ? "authorized" : statusFromAuthState()
    const session = this.buildSession(providerId, normalizeScopes(scopes), accountLabel, status)
    if (session.status === "authorized") this.sessions.set(session.id, session)
    this.recordLifecycle(status === "authorized" ? "login" : "session-added", session)
    this.fireSessionChange(session.providerId, { added: [session] })
    return session
  }

  async getSessions(providerId: string = auth.oauthProvider || "github", scopes: string[] | string = []): Promise<AuthenticationSessionProjection[]> {
    const id = normalizeProviderId(providerId)
    const scopeList = normalizeScopes(scopes)
    const sessions = [...this.sessions.values()]
      .filter((session) => session.providerId === id)
      .filter((session) => scopesMatch(session.scopes, scopeList))
    if (sessions.length || !auth.isLoggedIn) return sessions
    const session = this.buildSession(id, scopeList, auth.username || auth.email || "", "authorized")
    this.sessions.set(session.id, session)
    this.recordLifecycle("session-observed", session)
    return [session]
  }

  async removeSession(providerId: string, sessionId: string): Promise<void> {
    const id = normalizeProviderId(providerId)
    const existing = this.sessions.get(sessionId)
    const session = existing || this.buildSession(id, [], sessionId.split(":").at(-1) || "", "revoked")
    this.sessions.delete(sessionId)
    const revoked = { ...session, status: "revoked" as const, createdAt: Date.now() }
    this.recordLifecycle("logout", revoked)
    this.fireSessionChange(id, { removed: [revoked] })
  }

  recordSessionChange(providerId: string, event: AuthenticationSessionsChangeEvent): void {
    const id = normalizeProviderId(providerId)
    for (const session of event.added || []) {
      this.sessions.set(session.id, session)
      this.recordLifecycle("session-added", session)
    }
    for (const session of event.changed || []) {
      this.sessions.set(session.id, session)
      this.recordLifecycle("session-changed", session)
    }
    for (const session of event.removed || []) {
      this.sessions.delete(session.id)
      this.recordLifecycle("session-removed", { ...session, status: "revoked" })
    }
    this.fireSessionChange(id, event)
  }

  onDidRegisterAuthenticationProvider(listener: Listener<AuthenticationProviderInformation>): Disposable {
    return addListener(this.registerListeners, listener)
  }

  onDidUnregisterAuthenticationProvider(listener: Listener<AuthenticationProviderInformation>): Disposable {
    return addListener(this.unregisterListeners, listener)
  }

  onDidChangeSessions(listener: Listener<{ providerId: string; label: string; event: AuthenticationSessionsChangeEvent }>): Disposable {
    return addListener(this.sessionListeners, listener)
  }

  getSnapshot(): AuthenticationServiceSnapshot {
    const sessions = [...this.sessions.values()]
    return {
      serviceId: String(IWorkbenchAuthenticationService),
      stateSource: "authState+mcpRegistryClient",
      providerIds: this.getProviderIds(),
      providers: this.getProviders(),
      sessionCount: sessions.length,
      sessions,
      latestSession: sessions.at(-1) || null,
      lifecycle: [...this.lifecycle],
      providerEvidence: [...this.providerEvidence],
      constraints: {
        noSecondAuthStore: true,
        noTokenInEvidence: true,
        preservesMcpOAuthBoundary: true,
        evidenceSafeEvents: true,
      },
    }
  }

  clearEvidence(): void {
    this.sessions.clear()
    this.lifecycle.length = 0
    this.providerEvidence.length = 0
  }

  private buildSession(
    providerId: string,
    scopes: string[],
    accountLabel: string,
    status: AuthenticationSessionStatus,
  ): AuthenticationSessionProjection {
    const id = normalizeProviderId(providerId)
    const label = accountLabel || auth.username || auth.email || "codek"
    return {
      id: `${id}:${label}`,
      providerId: id,
      account: { id: label, label },
      scopes,
      status,
      createdAt: Date.now(),
      tokenRedacted: true,
    }
  }

  private recordLifecycle(action: AuthenticationLifecycleAction, session: AuthenticationSessionProjection, error = ""): void {
    this.lifecycle.push({
      serviceId: String(IWorkbenchAuthenticationService),
      providerId: session.providerId,
      sessionId: session.id,
      accountLabel: session.account.label,
      scopes: [...session.scopes],
      action,
      status: session.status,
      tokenRedacted: true,
      secretValueRedacted: true,
      createdAt: Date.now(),
      error: action === "error" ? error : "",
    })
  }

  private recordProviderEvidence(
    provider: AuthenticationProviderInformation,
    action: "register" | "unregister",
  ): AuthenticationProviderRegistrationEvidence {
    const evidence = {
      serviceId: String(IWorkbenchAuthenticationService),
      providerId: provider.id,
      label: provider.label,
      action,
      providerCount: this.providers.size,
      createdAt: Date.now(),
    }
    this.providerEvidence.push(evidence)
    return evidence
  }

  private fireSessionChange(providerId: string, event: AuthenticationSessionsChangeEvent): void {
    const provider = this.providers.get(providerId)
    this.emit(this.sessionListeners, { providerId, label: provider?.label || providerId, event })
  }

  private emit<T>(listeners: Set<Listener<T>>, event: T): void {
    for (const listener of listeners) listener(event)
  }
}

export const globalWorkbenchAuthenticationService = new CodekWorkbenchAuthenticationService()
registerSingleton(IWorkbenchAuthenticationService, globalWorkbenchAuthenticationService, InstantiationType.Delayed)

function normalizeProvider(provider: AuthenticationProvider): AuthenticationProviderInformation {
  const id = normalizeProviderId(provider.id)
  if (!id) throw new Error("Authentication provider id is required")
  const label = String(provider.label || "").trim()
  if (!label) throw new Error("Authentication provider label is required")
  return {
    id,
    label,
    authorizationServerGlobs: [...(provider.authorizationServerGlobs || [])],
    supportsMultipleAccounts: provider.supportsMultipleAccounts === true,
    source: "source" in provider && provider.source === "dynamic" ? "dynamic" : "extension",
  }
}

function normalizeProviderId(providerId: string): string {
  return String(providerId || "").trim()
}

export function normalizeScopes(scopes: string[] | string | undefined): string[] {
  if (Array.isArray(scopes)) return scopes.map((scope) => String(scope || "").trim()).filter(Boolean)
  if (typeof scopes === "string" && scopes.trim()) return [scopes.trim()]
  return []
}

function statusFromAuthState(): AuthenticationSessionStatus {
  if (auth.oauthStatus === "expired" || auth.loginErrorCode === "expired") return "expired"
  if (auth.loginError || auth.oauthStatus === "error") return "error"
  if (auth.isLoggedIn) return "authorized"
  if (auth.loading || auth.oauthStatus === "pending" || auth.githubDeviceFlow.active) return "pending"
  return "missing"
}

function scopesMatch(sessionScopes: string[], requestedScopes: string[]): boolean {
  return requestedScopes.every((scope) => sessionScopes.includes(scope))
}

function addListener<T>(listeners: Set<Listener<T>>, listener: Listener<T>): Disposable {
  listeners.add(listener)
  return { dispose: () => listeners.delete(listener) }
}
