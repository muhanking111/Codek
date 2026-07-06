import { globalWorkbenchAccountsService } from "../accounts/accountsService"
import { globalWorkbenchAuthenticationService } from "../authentication/authenticationService"
import { globalWorkbenchSecretStorageService } from "../secrets/secretStorageService"
import { Action2, MenuId, registerAction2 } from "../vscode-adapter/platform/actions/common/menuRegistry"
import type { Disposable } from "../vscode-adapter/platform/commands/common/commandsRegistry"
import { registerView, registerViewContainer } from "./viewRegistry"

// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\workbench\services\authentication\browser\authenticationService.ts
// - D:\SourceMirror\vscode\src\vs\workbench\services\secrets\browser\secretStorageService.ts
//
// This contribution exposes account/auth/secret service evidence through VS
// Code-style actions and views while delegating state to the single services.

export const AUTH_ACCOUNTS_SECRETS_VIEW_IDS = {
  Container: "codek.view.authAccountsSecrets",
  Accounts: "codek.accounts.surface",
  AuthenticationProviders: "codek.authenticationProviders.surface",
  SecretStorage: "codek.secretStorage.surface",
} as const

export const AUTH_ACCOUNTS_SECRETS_COMMAND_IDS = {
  OpenAccounts: "workbench.accounts.open",
  Login: "workbench.accounts.login",
  Logout: "workbench.accounts.logout",
  RegisterProvider: "workbench.authentication.registerProvider",
  ClearSecretEvidence: "workbench.secretStorage.clearEvidence",
} as const

let registrations: Disposable[] = []

export function registerAuthenticationAccountsSecretsWorkbenchContributions(): Disposable {
  disposeAuthenticationAccountsSecretsWorkbenchContributions()
  registerAuthenticationAccountsSecretsViews()
  registrations = [
    registerOpenAccountsAction(),
    registerLoginAction(),
    registerLogoutAction(),
    registerRegisterProviderAction(),
    registerClearSecretEvidenceAction(),
  ]
  return { dispose: disposeAuthenticationAccountsSecretsWorkbenchContributions }
}

export function disposeAuthenticationAccountsSecretsWorkbenchContributions(): void {
  for (const disposable of registrations.splice(0)) disposable.dispose()
}

export async function getAuthenticationAccountsSecretsWorkbenchSnapshot() {
  return {
    source: "authenticationAccountsSecretsWorkbench",
    containerId: AUTH_ACCOUNTS_SECRETS_VIEW_IDS.Container,
    viewIds: Object.values(AUTH_ACCOUNTS_SECRETS_VIEW_IDS).filter((id) => id !== AUTH_ACCOUNTS_SECRETS_VIEW_IDS.Container),
    commandIds: Object.values(AUTH_ACCOUNTS_SECRETS_COMMAND_IDS),
    authentication: globalWorkbenchAuthenticationService.getSnapshot(),
    accounts: await globalWorkbenchAccountsService.getSnapshot(),
    secrets: globalWorkbenchSecretStorageService.getSnapshot(),
    constraints: {
      noSecondAuthenticationState: true,
      noSecondAccountsState: true,
      noSecretValueInEvidence: true,
      accountMenuActionEvidence: true,
    },
  }
}

function registerAuthenticationAccountsSecretsViews(): void {
  registerViewContainer({
    id: AUTH_ACCOUNTS_SECRETS_VIEW_IDS.Container,
    name: "账号",
    location: "activityBar",
    icon: "account",
    source: "vscode",
    order: 58,
  })
  registerView({
    id: AUTH_ACCOUNTS_SECRETS_VIEW_IDS.Accounts,
    name: "账号",
    containerId: AUTH_ACCOUNTS_SECRETS_VIEW_IDS.Container,
    location: "sideBar",
    source: "vscode",
    order: 10,
  })
  registerView({
    id: AUTH_ACCOUNTS_SECRETS_VIEW_IDS.AuthenticationProviders,
    name: "认证提供方",
    containerId: AUTH_ACCOUNTS_SECRETS_VIEW_IDS.Container,
    location: "sideBar",
    source: "vscode",
    order: 20,
  })
  registerView({
    id: AUTH_ACCOUNTS_SECRETS_VIEW_IDS.SecretStorage,
    name: "密钥存储",
    containerId: AUTH_ACCOUNTS_SECRETS_VIEW_IDS.Container,
    location: "sideBar",
    source: "vscode",
    order: 30,
  })
}

function registerOpenAccountsAction(): Disposable {
  return registerAction2(class OpenAccountsAction extends Action2 {
    constructor() {
      super({
        id: AUTH_ACCOUNTS_SECRETS_COMMAND_IDS.OpenAccounts,
        title: "账号：打开账号",
        category: "账号",
        f1: true,
        source: "vscode",
        menu: { id: MenuId.MenubarViewMenu, group: "1_views", order: 156 },
      })
    }

    async run(): Promise<void> {
      const accounts = await globalWorkbenchAccountsService.getAccounts()
      const first = accounts[0]
      await globalWorkbenchAccountsService.recordAccountAction(first?.providerId || "github", first?.label || "", "menu-open")
    }
  })
}

function registerLoginAction(): Disposable {
  return registerAction2(class LoginAction extends Action2 {
    constructor() {
      super({
        id: AUTH_ACCOUNTS_SECRETS_COMMAND_IDS.Login,
        title: "账号：登录",
        category: "账号",
        f1: true,
        source: "vscode",
        menu: { id: MenuId.ViewTitle, when: `view == ${AUTH_ACCOUNTS_SECRETS_VIEW_IDS.Accounts}`, group: "navigation", order: 10 },
      })
    }

    async run(_accessor: unknown, providerId?: unknown, scopes?: unknown): Promise<void> {
      const session = await globalWorkbenchAuthenticationService.createSession(String(providerId || "github"), normalizeActionScopes(scopes))
      await globalWorkbenchAccountsService.recordAccountAction(session.providerId, session.account.label, "login")
    }
  })
}

function registerLogoutAction(): Disposable {
  return registerAction2(class LogoutAction extends Action2 {
    constructor() {
      super({
        id: AUTH_ACCOUNTS_SECRETS_COMMAND_IDS.Logout,
        title: "账号：退出登录",
        category: "账号",
        f1: true,
        source: "vscode",
        menu: { id: MenuId.ViewTitle, when: `view == ${AUTH_ACCOUNTS_SECRETS_VIEW_IDS.Accounts}`, group: "navigation", order: 20 },
      })
    }

    async run(_accessor: unknown, providerId?: unknown, sessionId?: unknown): Promise<void> {
      const id = String(providerId || "github")
      const resolvedSessionId = String(sessionId || "")
      await globalWorkbenchAuthenticationService.removeSession(id, resolvedSessionId)
      await globalWorkbenchAccountsService.recordAccountAction(id, resolvedSessionId.split(":").at(-1) || "", "logout")
    }
  })
}

function registerRegisterProviderAction(): Disposable {
  return registerAction2(class RegisterProviderAction extends Action2 {
    constructor() {
      super({
        id: AUTH_ACCOUNTS_SECRETS_COMMAND_IDS.RegisterProvider,
        title: "认证：注册提供方",
        category: "认证",
        f1: true,
        source: "vscode",
        menu: { id: MenuId.ViewTitle, when: `view == ${AUTH_ACCOUNTS_SECRETS_VIEW_IDS.AuthenticationProviders}`, group: "navigation", order: 10 },
      })
    }

    run(_accessor: unknown, providerId?: unknown, label?: unknown): void {
      globalWorkbenchAuthenticationService.registerAuthenticationProvider({
        id: String(providerId || "github"),
        label: String(label || providerId || "GitHub"),
      })
    }
  })
}

function registerClearSecretEvidenceAction(): Disposable {
  return registerAction2(class ClearSecretEvidenceAction extends Action2 {
    constructor() {
      super({
        id: AUTH_ACCOUNTS_SECRETS_COMMAND_IDS.ClearSecretEvidence,
        title: "密钥存储：清理证据",
        category: "密钥存储",
        f1: true,
        source: "vscode",
        menu: { id: MenuId.ViewTitle, when: `view == ${AUTH_ACCOUNTS_SECRETS_VIEW_IDS.SecretStorage}`, group: "navigation", order: 10 },
      })
    }

    run(): void {
      globalWorkbenchSecretStorageService.clearEvidence()
    }
  })
}

function normalizeActionScopes(scopes: unknown): string[] {
  if (Array.isArray(scopes)) return scopes.map((scope) => String(scope || "").trim()).filter(Boolean)
  if (typeof scopes === "string" && scopes.trim()) return [scopes.trim()]
  return []
}
