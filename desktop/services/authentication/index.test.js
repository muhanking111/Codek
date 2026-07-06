const test = require("node:test")
const assert = require("node:assert/strict")

const { createAuthenticationClosureService } = require("./index")
const { createAccountsClosureService } = require("../accounts")
const { createSecretStorageClosureService } = require("../secrets")

test("desktop authentication closure tracks providers and sessions without exposing tokens", () => {
  const service = createAuthenticationClosureService()

  service.registerProvider({ id: "microsoft", label: "Microsoft" })
  const session = service.createSession("github", {
    accountLabel: "codek-user",
    scopes: ["repo"],
    accessToken: "secret-token",
  })
  service.recordLifecycle("session-changed", { ...session, scopes: ["repo", "workflow"] })
  service.removeSession("github", session.id)

  const snapshot = service.getSnapshot()
  assert.deepEqual(snapshot.providerIds.sort(), ["github", "microsoft"])
  assert.deepEqual(
    snapshot.lifecycle.map((item) => item.action),
    ["login", "session-changed", "logout"],
  )
  assert.equal(snapshot.constraints.noTokenInEvidence, true)
  assert.equal(JSON.stringify(snapshot).includes("secret-token"), false)
})

test("desktop accounts closure derives account projection from authentication sessions", () => {
  const authentication = createAuthenticationClosureService()
  const accounts = createAccountsClosureService(authentication)

  const session = authentication.createSession("github", {
    accountLabel: "codek-user",
    scopes: ["repo", "user:email"],
  })
  const projected = accounts.getAccounts("github")
  accounts.recordAccountAction("github", "codek-user", "menu-open")

  const snapshot = accounts.getSnapshot()
  assert.equal(projected.length, 1)
  assert.equal(projected[0].label, "codek-user")
  assert.deepEqual(projected[0].sessionIds, [session.id])
  assert.deepEqual(projected[0].scopes, ["repo", "user:email"])
  assert.equal(snapshot.actionEvidence[0].action, "menu-open")
  assert.equal(snapshot.constraints.derivedFromAuthenticationSessions, true)
})

test("desktop accounts closure exposes account menu trust and privacy projection without token material", () => {
  const authentication = createAuthenticationClosureService()
  const accounts = createAccountsClosureService(authentication)

  authentication.registerProvider({ id: "microsoft", label: "Microsoft" })
  authentication.createSession("github", {
    accountLabel: "codek-user",
    scopes: ["repo", "workflow"],
    accessToken: "secret-token",
  })

  const projection = accounts.getAccountMenuProjection()
  assert.equal(projection.providerCount, 2)
  assert.equal(projection.sessionCount, 1)
  assert.equal(projection.accounts[0].sessionSummary, "1 session / 2 scopes")
  assert.equal(projection.accounts[0].trustLabel, "Trusted by active authentication session")
  assert.equal(projection.accounts[0].privacyLabel, "Token and secret values redacted")
  assert.equal(projection.providers.find((provider) => provider.providerId === "microsoft").accountCount, 0)
  assert.equal(projection.constraints.menuProjectionTokenRedacted, true)
  assert.equal(JSON.stringify(projection).includes("secret-token"), false)
})

test("desktop secret storage closure redacts values from evidence", async () => {
  const service = createSecretStorageClosureService()

  await service.set("github.auth", "super-secret-value")
  assert.equal(await service.get("github.auth"), "super-secret-value")
  assert.deepEqual(await service.keys(), ["github.auth"])
  await service.delete("github.auth")

  const snapshot = service.getSnapshot()
  assert.deepEqual(snapshot.evidence.map((item) => item.action), ["set", "change", "get", "keys", "delete", "change"])
  assert.equal(snapshot.constraints.noSecretValueInEvidence, true)
  assert.equal(JSON.stringify(snapshot).includes("super-secret-value"), false)
})
