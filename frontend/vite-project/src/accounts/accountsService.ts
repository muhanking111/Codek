import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import type {
  AuthenticationProviderInformation,
  AuthenticationSessionAccount,
  AuthenticationSessionProjection,
  WorkbenchAuthenticationService,
} from "../authentication/authenticationService"
import { globalWorkbenchAuthenticationService } from "../authentication/authenticationService"

// VS Code source adapter.
// Source reference:
// - D:\SourceMirror\vscode\src\vs\workbench\services\authentication\browser\authenticationService.ts#getAccounts
//
// Accounts are a projection of authentication sessions. This service never owns
// login state and therefore cannot drift from the authentication registry.

export interface AccountProjection extends AuthenticationSessionAccount {
  providerId: string
  sessionIds: string[]
  scopes: string[]
  lastSeenAt: number
}

export interface AccountActionEvidence {
  serviceId: string
  providerId: string
  accountId: string
  accountLabel: string
  action: "menu-open" | "login" | "logout" | "session-change"
  sessionCount: number
  tokenRedacted: true
  createdAt: number
}

export interface AccountsServiceSnapshot {
  serviceId: string
  stateSource: "workbenchAuthenticationService.sessions"
  accounts: AccountProjection[]
  accountCount: number
  actionEvidence: AccountActionEvidence[]
  constraints: {
    noSecondAccountStore: true
    noTokenInEvidence: true
    derivedFromAuthenticationSessions: true
  }
}

export interface AccountMenuProviderProjection {
  providerId: string
  label: string
  registered: boolean
  accountCount: number
  trustLabel: "Provider registered" | "Provider unavailable"
  privacyLabel: "Session tokens stay in authentication service"
}

export interface AccountMenuAccountProjection extends AccountProjection {
  sessionSummary: string
  trustLabel: "Trusted by active authentication session" | "No active authentication session"
  privacyLabel: "Token and secret values redacted"
  canSignOut: boolean
  tokenRedacted: true
  action: {
    commandId: "workbench.accounts.open"
    args: [string, string]
    evidenceSafe: true
  }
}

export interface AccountMenuProjection {
  stateSource: "workbenchAuthenticationService.sessions"
  providerCount: number
  sessionCount: number
  providers: AccountMenuProviderProjection[]
  accounts: AccountMenuAccountProjection[]
  actionEvidence: AccountActionEvidence[]
  constraints: {
    noSecondAccountStore: true
    derivedFromAuthenticationSessions: true
    menuProjectionTokenRedacted: true
  }
}

export interface WorkbenchAccountsService {
  readonly _serviceBrand: undefined
  getAccounts(providerId?: string): Promise<AccountProjection[]>
  getAccountMenuProjection(): Promise<AccountMenuProjection>
  recordAccountAction(providerId: string, accountLabel: string, action: AccountActionEvidence["action"]): Promise<AccountActionEvidence>
  getSnapshot(): Promise<AccountsServiceSnapshot>
  clearEvidence(): void
}

export const IWorkbenchAccountsService = createDecorator<WorkbenchAccountsService>("workbenchAccountsService")

export class CodekWorkbenchAccountsService implements WorkbenchAccountsService {
  declare readonly _serviceBrand: undefined
  private readonly actionEvidence: AccountActionEvidence[] = []

  constructor(private readonly authenticationService: WorkbenchAuthenticationService = globalWorkbenchAuthenticationService) {}

  async getAccounts(providerId?: string): Promise<AccountProjection[]> {
    const providerIds = providerId ? [providerId] : this.authenticationService.getProviderIds()
    const accounts = new Map<string, AccountProjection>()
    for (const id of providerIds) {
      const sessions = await this.authenticationService.getSessions(id)
      for (const session of sessions) {
        const key = `${session.providerId}:${session.account.id}`
        const existing = accounts.get(key)
        const scopes = [...new Set([...(existing?.scopes || []), ...session.scopes])]
        const sessionIds = [...new Set([...(existing?.sessionIds || []), session.id])]
        accounts.set(key, {
          providerId: session.providerId,
          id: session.account.id,
          label: session.account.label,
          sessionIds,
          scopes,
          lastSeenAt: Math.max(existing?.lastSeenAt || 0, session.createdAt),
        })
      }
    }
    return [...accounts.values()]
  }

  async recordAccountAction(providerId: string, accountLabel: string, action: AccountActionEvidence["action"]): Promise<AccountActionEvidence> {
    const accounts = await this.getAccounts(providerId)
    const account = accounts.find((item) => item.label === accountLabel || item.id === accountLabel)
    const evidence: AccountActionEvidence = {
      serviceId: String(IWorkbenchAccountsService),
      providerId,
      accountId: account?.id || accountLabel,
      accountLabel: account?.label || accountLabel,
      action,
      sessionCount: account?.sessionIds.length || 0,
      tokenRedacted: true,
      createdAt: Date.now(),
    }
    this.actionEvidence.push(evidence)
    return evidence
  }

  async getAccountMenuProjection(): Promise<AccountMenuProjection> {
    const providers = this.authenticationService.getProviders()
    const accounts = projectAccountsFromSessions(this.authenticationService.getSnapshot().sessions)
    return {
      stateSource: "workbenchAuthenticationService.sessions",
      providerCount: providers.length,
      sessionCount: accounts.reduce((count, account) => count + account.sessionIds.length, 0),
      providers: providers.map((provider) => this.toProviderProjection(provider, accounts)),
      accounts: accounts.map((account) => this.toAccountMenuProjection(account)),
      actionEvidence: [...this.actionEvidence],
      constraints: {
        noSecondAccountStore: true,
        derivedFromAuthenticationSessions: true,
        menuProjectionTokenRedacted: true,
      },
    }
  }

  async getSnapshot(): Promise<AccountsServiceSnapshot> {
    const accounts = await this.getAccounts()
    return {
      serviceId: String(IWorkbenchAccountsService),
      stateSource: "workbenchAuthenticationService.sessions",
      accounts,
      accountCount: accounts.length,
      actionEvidence: [...this.actionEvidence],
      constraints: {
        noSecondAccountStore: true,
        noTokenInEvidence: true,
        derivedFromAuthenticationSessions: true,
      },
    }
  }

  clearEvidence(): void {
    this.actionEvidence.length = 0
  }

  private toProviderProjection(
    provider: AuthenticationProviderInformation,
    accounts: AccountProjection[],
  ): AccountMenuProviderProjection {
    const accountCount = accounts.filter((account) => account.providerId === provider.id).length
    return {
      providerId: provider.id,
      label: provider.label,
      registered: true,
      accountCount,
      trustLabel: "Provider registered",
      privacyLabel: "Session tokens stay in authentication service",
    }
  }

  private toAccountMenuProjection(account: AccountProjection): AccountMenuAccountProjection {
    return {
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
    }
  }
}

function projectAccountsFromSessions(sessions: AuthenticationSessionProjection[]): AccountProjection[] {
  const accounts = new Map<string, AccountProjection>()
  for (const session of sessions) {
    const key = `${session.providerId}:${session.account.id}`
    const existing = accounts.get(key)
    const scopes = [...new Set([...(existing?.scopes || []), ...session.scopes])]
    const sessionIds = [...new Set([...(existing?.sessionIds || []), session.id])]
    accounts.set(key, {
      providerId: session.providerId,
      id: session.account.id,
      label: session.account.label,
      sessionIds,
      scopes,
      lastSeenAt: Math.max(existing?.lastSeenAt || 0, session.createdAt),
    })
  }
  return [...accounts.values()]
}

export const globalWorkbenchAccountsService = new CodekWorkbenchAccountsService()
registerSingleton(IWorkbenchAccountsService, globalWorkbenchAccountsService, InstantiationType.Delayed)
