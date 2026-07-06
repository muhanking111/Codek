/**
 * Accounts are derived from authentication sessions. The desktop service keeps
 * account menu evidence only and does not own a second account store.
 */

const { globalAuthenticationClosureService } = require("../authentication")

class AccountsClosureService {
  constructor(authenticationService = globalAuthenticationClosureService, options = {}) {
    this.authenticationService = authenticationService
    this.serviceId = options.serviceId || "desktopAccountsService"
    this.actionEvidence = []
  }

  getAccounts(providerId) {
    const sessions = this.authenticationService.getSessions(providerId)
    const accounts = new Map()
    for (const session of sessions) {
      const key = `${session.providerId}:${session.account.id}`
      const existing = accounts.get(key)
      accounts.set(key, {
        providerId: session.providerId,
        id: session.account.id,
        label: session.account.label,
        sessionIds: Array.from(new Set([...(existing && existing.sessionIds || []), session.id])),
        scopes: Array.from(new Set([...(existing && existing.scopes || []), ...session.scopes])),
        lastSeenAt: Math.max(existing && existing.lastSeenAt || 0, session.createdAt),
      })
    }
    return Array.from(accounts.values())
  }

  recordAccountAction(providerId, accountLabel, action) {
    const account = this.getAccounts(providerId).find((item) => item.label === accountLabel || item.id === accountLabel)
    const evidence = {
      serviceId: this.serviceId,
      providerId,
      accountId: account && account.id || accountLabel || "",
      accountLabel: account && account.label || accountLabel || "",
      action,
      sessionCount: account ? account.sessionIds.length : 0,
      tokenRedacted: true,
      createdAt: Date.now(),
    }
    this.actionEvidence.push(evidence)
    return evidence
  }

  getAccountMenuProjection() {
    const providers = this.authenticationService.getSnapshot().providers
    const accounts = projectAccountsFromSessions(this.authenticationService.getSnapshot().sessions)
    return {
      stateSource: "desktopAuthenticationService.sessions",
      providerCount: providers.length,
      sessionCount: accounts.reduce((count, account) => count + account.sessionIds.length, 0),
      providers: providers.map((provider) => ({
        providerId: provider.id,
        label: provider.label,
        registered: true,
        accountCount: accounts.filter((account) => account.providerId === provider.id).length,
        trustLabel: "Provider registered",
        privacyLabel: "Session tokens stay in authentication service",
      })),
      accounts: accounts.map((account) => ({
        ...account,
        sessionSummary: `${account.sessionIds.length} session${account.sessionIds.length === 1 ? "" : "s"} / ${account.scopes.length} scope${account.scopes.length === 1 ? "" : "s"}`,
        trustLabel: account.sessionIds.length ? "Trusted by active authentication session" : "No active authentication session",
        privacyLabel: "Token and secret values redacted",
        canSignOut: account.sessionIds.length > 0,
        tokenRedacted: true,
        action: {
          commandId: "workbench.accounts.open",
          args: [account.providerId, account.label],
          evidenceSafe: true,
        },
      })),
      actionEvidence: [...this.actionEvidence],
      constraints: {
        noSecondAccountStore: true,
        derivedFromAuthenticationSessions: true,
        menuProjectionTokenRedacted: true,
      },
    }
  }

  getSnapshot() {
    const accounts = this.getAccounts()
    return {
      serviceId: this.serviceId,
      stateSource: "desktopAuthenticationService.sessions",
      accountCount: accounts.length,
      accounts,
      actionEvidence: [...this.actionEvidence],
      constraints: {
        noSecondAccountStore: true,
        noTokenInEvidence: true,
        derivedFromAuthenticationSessions: true,
      },
    }
  }

  clearEvidence() {
    this.actionEvidence.length = 0
  }
}

function projectAccountsFromSessions(sessions) {
  const accounts = new Map()
  for (const session of sessions) {
    const key = `${session.providerId}:${session.account.id}`
    const existing = accounts.get(key)
    accounts.set(key, {
      providerId: session.providerId,
      id: session.account.id,
      label: session.account.label,
      sessionIds: Array.from(new Set([...(existing && existing.sessionIds || []), session.id])),
      scopes: Array.from(new Set([...(existing && existing.scopes || []), ...session.scopes])),
      lastSeenAt: Math.max(existing && existing.lastSeenAt || 0, session.createdAt),
    })
  }
  return Array.from(accounts.values())
}

function createAccountsClosureService(authenticationService, options) {
  return new AccountsClosureService(authenticationService, options)
}

const globalAccountsClosureService = createAccountsClosureService(globalAuthenticationClosureService)

module.exports = {
  AccountsClosureService,
  createAccountsClosureService,
  globalAccountsClosureService,
}
