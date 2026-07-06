import { beforeEach, describe, expect, it } from "vitest"
import { auth } from "../auth/authState"
import { CodekWorkbenchAccountsService, globalWorkbenchAccountsService } from "../accounts/accountsService"
import { CodekWorkbenchAuthenticationService, globalWorkbenchAuthenticationService } from "../authentication/authenticationService"
import { CodekWorkbenchSecretStorageService, globalWorkbenchSecretStorageService } from "../secrets/secretStorageService"
import { MenuId, MenuRegistry } from "../vscode-adapter/platform/actions/common/menuRegistry"
import { getSingletonServiceDescriptors } from "../vscode-adapter/platform/instantiation/common/extensions"
import { clearCommands, executeCommand, getCommand } from "./commandRegistry"
import {
  AUTH_ACCOUNTS_SECRETS_COMMAND_IDS,
  AUTH_ACCOUNTS_SECRETS_VIEW_IDS,
  disposeAuthenticationAccountsSecretsWorkbenchContributions,
  getAuthenticationAccountsSecretsWorkbenchSnapshot,
  registerAuthenticationAccountsSecretsWorkbenchContributions,
} from "./authenticationAccountsSecretsWorkbench"
import { clearViews, getViewContainers, getViews } from "./viewRegistry"
import { IWorkbenchAccountsService } from "../accounts/accountsService"
import { IWorkbenchAuthenticationService } from "../authentication/authenticationService"
import { IWorkbenchSecretStorageService } from "../secrets/secretStorageService"

function resetAuthState(): void {
  auth.isLoggedIn = false
  auth.token = ""
  auth.username = ""
  auth.email = ""
  auth.loading = false
  auth.oauthStatus = "idle"
  auth.oauthProvider = ""
  auth.loginError = ""
  auth.loginErrorCode = ""
  auth.githubDeviceFlow.active = false
}

describe("Authentication / SecretStorage / Accounts service closure", () => {
  beforeEach(() => {
    clearCommands()
    clearViews()
    MenuRegistry.clear()
    disposeAuthenticationAccountsSecretsWorkbenchContributions()
    resetAuthState()
    globalWorkbenchAuthenticationService.clearEvidence()
    globalWorkbenchAccountsService.clearEvidence()
    globalWorkbenchSecretStorageService.clear()
  })

  it("registers VS Code-style service identifiers as singleton facades", () => {
    expect(String(IWorkbenchAuthenticationService)).toBe("workbenchAuthenticationService")
    expect(String(IWorkbenchAccountsService)).toBe("workbenchAccountsService")
    expect(String(IWorkbenchSecretStorageService)).toBe("workbenchSecretStorageService")

    expect(getSingletonServiceDescriptors()).toEqual(expect.arrayContaining([
      [IWorkbenchAuthenticationService, globalWorkbenchAuthenticationService],
      [IWorkbenchAccountsService, globalWorkbenchAccountsService],
      [IWorkbenchSecretStorageService, globalWorkbenchSecretStorageService],
    ]))
  })

  it("tracks provider registration and session change lifecycle without exposing tokens", async () => {
    const service = new CodekWorkbenchAuthenticationService()
    const events: string[] = []
    service.onDidRegisterAuthenticationProvider((provider) => events.push(`register:${provider.id}`))
    service.onDidChangeSessions((event) => events.push(`sessions:${event.providerId}`))

    service.registerAuthenticationProvider({ id: "microsoft", label: "Microsoft" })
    auth.isLoggedIn = true
    auth.token = "secret-auth-token"
    auth.username = "codek-user"
    auth.oauthProvider = "github"
    auth.oauthStatus = "success"

    const session = await service.createSession("github", ["repo"])
    service.recordSessionChange("github", { changed: [{ ...session, scopes: ["repo", "workflow"] }] })
    await service.removeSession("github", session.id)

    const snapshot = service.getSnapshot()
    expect(events).toEqual(expect.arrayContaining(["register:microsoft", "sessions:github"]))
    expect(snapshot.providerIds).toEqual(expect.arrayContaining(["github", "microsoft"]))
    expect(snapshot.lifecycle.map((item) => item.action)).toEqual(expect.arrayContaining(["login", "session-changed", "logout"]))
    expect(snapshot.constraints).toMatchObject({
      noSecondAuthStore: true,
      noTokenInEvidence: true,
      evidenceSafeEvents: true,
    })
    expect(JSON.stringify(snapshot)).not.toContain("secret-auth-token")
  })

  it("projects expired OAuth sessions through the shared authentication boundary", async () => {
    const service = new CodekWorkbenchAuthenticationService()
    auth.oauthProvider = "github"
    auth.oauthStatus = "expired"
    auth.loginError = "GitHub 验证码已过期，请重新登录"
    auth.loginErrorCode = "expired"

    const session = await service.createSession("github", ["repo"])

    expect(session).toMatchObject({
      providerId: "github",
      status: "expired",
    })
    expect(service.getSnapshot().lifecycle.at(-1)).toMatchObject({
      action: "session-added",
      status: "expired",
    })
  })

  it("derives accounts only from authentication sessions and records account menu action evidence", async () => {
    const authService = new CodekWorkbenchAuthenticationService()
    const accountsService = new CodekWorkbenchAccountsService(authService)
    auth.isLoggedIn = true
    auth.token = "secret-token"
    auth.username = "codek-user"

    const session = await authService.createSession("github", ["repo", "user:email"])
    const accounts = await accountsService.getAccounts("github")
    await accountsService.recordAccountAction("github", "codek-user", "menu-open")
    await authService.removeSession("github", session.id)

    const snapshot = await accountsService.getSnapshot()
    expect(accounts).toEqual([expect.objectContaining({
      providerId: "github",
      label: "codek-user",
      sessionIds: [session.id],
      scopes: ["repo", "user:email"],
    })])
    expect(snapshot.actionEvidence[0]).toMatchObject({
      providerId: "github",
      accountLabel: "codek-user",
      action: "menu-open",
      tokenRedacted: true,
    })
    expect(snapshot.constraints).toMatchObject({
      noSecondAccountStore: true,
      derivedFromAuthenticationSessions: true,
    })
    expect(JSON.stringify(snapshot)).not.toContain("secret-token")
  })

  it("projects account menu sessions with trust and privacy labels without exposing token material", async () => {
    const authService = new CodekWorkbenchAuthenticationService()
    const accountsService = new CodekWorkbenchAccountsService(authService)
    auth.isLoggedIn = true
    auth.token = "secret-token"
    auth.username = "codek-user"

    await authService.createSession("github", ["repo", "workflow"])
    authService.registerAuthenticationProvider({
      id: "microsoft",
      label: "Microsoft",
      authorizationServerGlobs: ["https://login.microsoftonline.com/*"],
    })

    const menu = await accountsService.getAccountMenuProjection()

    expect(menu.stateSource).toBe("workbenchAuthenticationService.sessions")
    expect(menu.providerCount).toBe(2)
    expect(menu.sessionCount).toBe(1)
    expect(menu.accounts[0]).toMatchObject({
      providerId: "github",
      label: "codek-user",
      sessionSummary: "1 session / 2 scopes",
      trustLabel: "Trusted by active authentication session",
      privacyLabel: "Token and secret values redacted",
      action: {
        commandId: "workbench.accounts.open",
        args: ["github", "codek-user"],
      },
      canSignOut: true,
      tokenRedacted: true,
    })
    expect(menu.providers.find((provider) => provider.providerId === "github")).toMatchObject({
      providerId: "github",
      label: "GitHub",
      registered: true,
      accountCount: 1,
      trustLabel: "Provider registered",
      privacyLabel: "Session tokens stay in authentication service",
    })
    expect(menu.providers.find((provider) => provider.providerId === "microsoft")).toMatchObject({
      providerId: "microsoft",
      accountCount: 0,
      trustLabel: "Provider registered",
    })
    expect(menu.constraints).toMatchObject({
      noSecondAccountStore: true,
      derivedFromAuthenticationSessions: true,
      menuProjectionTokenRedacted: true,
    })
    expect(JSON.stringify(menu)).not.toContain("secret-token")
  })

  it("provides a secret storage facade with change events and redacted evidence", async () => {
    const service = new CodekWorkbenchSecretStorageService()
    const changed: string[] = []
    service.onDidChangeSecret((key) => changed.push(key))

    await service.set("github.auth", "super-secret-value")
    expect(await service.get("github.auth")).toBe("super-secret-value")
    expect(await service.keys()).toEqual(["github.auth"])
    await service.delete("github.auth")

    const snapshot = service.getSnapshot()
    expect(changed).toEqual(["github.auth", "github.auth"])
    expect(snapshot.evidence.map((item) => item.action)).toEqual(["set", "change", "get", "keys", "delete", "change"])
    expect(snapshot.constraints).toMatchObject({
      noSecretValueInEvidence: true,
      vscodeSecretStorageKeySemantics: true,
    })
    expect(JSON.stringify(snapshot)).not.toContain("super-secret-value")
  })

  it("registers account menu actions and rolls auth/accounts/secrets into one workbench snapshot", async () => {
    registerAuthenticationAccountsSecretsWorkbenchContributions()
    auth.isLoggedIn = true
    auth.username = "codek-user"
    auth.token = "secret-token"
    auth.oauthStatus = "success"

    await executeCommand(AUTH_ACCOUNTS_SECRETS_COMMAND_IDS.Login, ["github", ["repo"]])
    await globalWorkbenchSecretStorageService.set("github.auth", "super-secret-value")
    await executeCommand(AUTH_ACCOUNTS_SECRETS_COMMAND_IDS.OpenAccounts)

    const snapshot = await getAuthenticationAccountsSecretsWorkbenchSnapshot()
    expect(getViewContainers("activityBar").map((container) => container.id)).toContain(AUTH_ACCOUNTS_SECRETS_VIEW_IDS.Container)
    expect(getViews(AUTH_ACCOUNTS_SECRETS_VIEW_IDS.Container).map((view) => view.id)).toEqual(expect.arrayContaining([
      AUTH_ACCOUNTS_SECRETS_VIEW_IDS.Accounts,
      AUTH_ACCOUNTS_SECRETS_VIEW_IDS.AuthenticationProviders,
      AUTH_ACCOUNTS_SECRETS_VIEW_IDS.SecretStorage,
    ]))
    expect(getCommand(AUTH_ACCOUNTS_SECRETS_COMMAND_IDS.Login)?.id).toBe(AUTH_ACCOUNTS_SECRETS_COMMAND_IDS.Login)
    expect(MenuRegistry.getMenuEntries(MenuId.ViewTitle, { view: AUTH_ACCOUNTS_SECRETS_VIEW_IDS.Accounts })
      .map((entry) => entry.type === "item" ? entry.commandId : entry.id))
      .toEqual(expect.arrayContaining([
        AUTH_ACCOUNTS_SECRETS_COMMAND_IDS.Login,
        AUTH_ACCOUNTS_SECRETS_COMMAND_IDS.Logout,
      ]))
    expect(snapshot.accounts.actionEvidence.map((item) => item.action)).toEqual(expect.arrayContaining(["login", "menu-open"]))
    expect(snapshot.constraints).toMatchObject({
      noSecondAuthenticationState: true,
      noSecondAccountsState: true,
      noSecretValueInEvidence: true,
      accountMenuActionEvidence: true,
    })
    expect(JSON.stringify(snapshot)).not.toContain("secret-token")
    expect(JSON.stringify(snapshot)).not.toContain("super-secret-value")
  })
})
