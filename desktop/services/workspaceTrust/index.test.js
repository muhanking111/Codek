const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const router = require("../router")

function loadWorkspaceTrust(codekData = fs.mkdtempSync(path.join(os.tmpdir(), "codek-trust-"))) {
  const previous = process.env.CODEK_DATA
  process.env.CODEK_DATA = codekData
  delete require.cache[require.resolve("./index")]
  const workspaceTrust = require("./index")
  if (previous == null) delete process.env.CODEK_DATA
  else process.env.CODEK_DATA = previous
  return workspaceTrust
}

test("workspace trust defaults to unknown and persists trusted roots", () => {
  const trust = loadWorkspaceTrust()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-root-"))

  assert.equal(trust.getWorkspaceTrust(root).status, "unknown")
  const saved = trust.setWorkspaceTrust(root, { status: "trusted" })

  assert.equal(saved.status, "trusted")
  assert.equal(trust.getWorkspaceTrust(root).status, "trusted")
})

test("trusted folders are normalized, deduped and included in trust snapshots", () => {
  const trust = loadWorkspaceTrust()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-trusted-folders-"))
  const tools = path.join(root, "tools")
  const docs = path.join(root, "docs")

  const snapshot = trust.setTrustedFolders(root, [tools, tools, docs])

  assert.deepEqual(snapshot.trustedFolders, [tools, docs].map((folder) => path.resolve(folder)))
  assert.equal(trust.getWorkspaceTrust(root).trustedFolders.length, 2)
  assert.equal(trust.isUriTrusted(root, path.join(tools, "task.js")).trusted, true)
  assert.equal(trust.isUriTrusted(root, path.join(root, "src", "app.js")).trusted, false)
})

test("workspace trust model exposes restricted capabilities without duplicating policy state", () => {
  const trust = loadWorkspaceTrust()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-capabilities-"))

  trust.setWorkspaceTrust(root, { status: "restricted", trustedFolders: [path.join(root, "docs")] })

  const model = trust.getWorkspaceTrustModel(root)
  assert.equal(model.stateSource, "workspaceTrustStore+enterprisePolicy")
  assert.equal(model.status, "restricted")
  assert.equal(model.restrictedMode.enabled, true)
  assert.equal(model.restrictedMode.canExecuteCommands, false)
  assert.equal(model.restrictedMode.canUseNetwork, false)
  assert.equal(model.restrictedMode.canInstallExtensions, false)
  assert.equal(model.trustedFolders.length, 1)
  assert.equal(model.constraints.noSecondTrustStore, true)
  assert.equal(model.constraints.securityAuditPathOwnedByBackend, true)
})

test("workspace trust model exposes stable owner evidence from the existing store only", () => {
  const codekData = fs.mkdtempSync(path.join(os.tmpdir(), "codek-owner-evidence-"))
  const trust = loadWorkspaceTrust(codekData)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-owner-root-"))

  trust.setWorkspaceTrust(root, { status: "restricted" })
  const model = trust.getWorkspaceTrustModel(root)
  const decision = trust.evaluateWorkspaceTrustAction(root, "安装扩展", { confirmed: true })

  assert.equal(model.workspaceTrustServiceOwner, "desktop/services/workspaceTrust")
  assert.equal(model.trustStateSource, "workspaceTrustStore")
  assert.equal(model.extensionTrustGateOwner, "desktop/services/extensions-host install routes")
  assert.equal(model.securityPolicyOwner, "desktop/services/workspaceTrust enterprisePolicy")
  assert.equal(model.persistenceSource, "CODEK_DATA/workspace-trust.json")
  assert.equal(model.remainingTrustUiOwnerGap.includes("full WorkspaceTrustEditor/App shell owner"), true)
  assert.equal(model.constraints.noSecondTrustStore, true)
  assert.equal(model.constraints.partialUiOwnerIsNotConnected, true)
  assert.equal(model.runtimeReference, false)
  assert.deepEqual(decision.trustStateSource, model.trustStateSource)
  assert.equal(decision.workspaceTrustServiceOwner, model.workspaceTrustServiceOwner)
  assert.equal(fs.existsSync(path.join(codekData, "workspace-trust.json")), true)
  assert.equal(JSON.stringify(model).includes("SourceMirror"), false)
  assert.equal(JSON.stringify(decision).includes("SourceMirror"), false)
})

test("restricted workspace forces read-only policy with network disabled", () => {
  const trust = loadWorkspaceTrust()
  const result = trust.applyWorkspaceTrustToPolicy(
    { sandboxMode: "workspace-write", approvalMode: "never", networkAllowed: true },
    { status: "restricted" },
  )

  assert.equal(result.sandboxMode, "read-only")
  assert.equal(result.approvalMode, "untrusted")
  assert.equal(result.networkAllowed, false)
})

test("unknown workspace disables network and restores approval prompts", () => {
  const trust = loadWorkspaceTrust()
  const result = trust.applyWorkspaceTrustToPolicy(
    { sandboxMode: "workspace-write", approvalMode: "never", networkAllowed: true },
    { status: "unknown" },
  )

  assert.equal(result.sandboxMode, "workspace-write")
  assert.equal(result.approvalMode, "on-request")
  assert.equal(result.networkAllowed, false)
})

test("workspace trust action blocks restricted workspace and asks confirmation for unknown", () => {
  const trust = loadWorkspaceTrust()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-action-root-"))

  let decision = trust.evaluateWorkspaceTrustAction(root, "安装扩展")
  assert.equal(decision.allowed, false)
  assert.equal(decision.code, "workspace_trust_confirmation_required")

  decision = trust.evaluateWorkspaceTrustAction(root, "安装扩展", { confirmed: true })
  assert.equal(decision.allowed, true)
  assert.equal(decision.status, "unknown")

  trust.setWorkspaceTrust(root, { status: "restricted" })
  decision = trust.evaluateWorkspaceTrustAction(root, "安装扩展", { confirmed: true })
  assert.equal(decision.allowed, false)
  assert.equal(decision.code, "workspace_trust_restricted")

  trust.setWorkspaceTrust(root, { status: "trusted" })
  decision = trust.evaluateWorkspaceTrustAction(root, "安装扩展")
  assert.equal(decision.allowed, true)
  assert.equal(decision.status, "trusted")
})

test("command execution trust decision carries sanitized command metadata", () => {
  const trust = loadWorkspaceTrust()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-command-root-"))
  const command = "npm run build && echo done"

  let decision = trust.evaluateCommandExecution(root, command)
  assert.equal(decision.allowed, false)
  assert.equal(decision.code, "workspace_trust_confirmation_required")
  assert.equal(decision.command, command)

  trust.setWorkspaceTrust(root, { status: "restricted" })
  decision = trust.evaluateCommandExecution(root, `${command} ${"x".repeat(400)}`, { confirmed: true })
  assert.equal(decision.allowed, false)
  assert.equal(decision.code, "workspace_trust_restricted")
  assert.equal(decision.command.length, 200)
})

test("enterprise policy denies command prefixes and audit stores metadata only", () => {
  const trust = loadWorkspaceTrust()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-enterprise-command-"))
  trust.writeEnterprisePolicy({ deny: { commands: ["npm install"] } })

  const command = "npm install super-secret-package --token sk-test-123"
  const decision = trust.evaluateCommandExecution(root, command, { confirmed: true })

  assert.equal(decision.allowed, false)
  assert.equal(decision.code, "enterprise_policy_denied")
  const events = trust.listSecurityAuditEvents()
  assert.equal(events.length, 1)
  assert.equal(events[0].decision, "blocked")
  assert.equal(events[0].commandLength, command.length)
  assert.ok(events[0].commandHash)
  assert.equal(JSON.stringify(events).includes(command), false)
  assert.equal(JSON.stringify(events).includes("sk-test-123"), false)
})

test("enterprise policy allowlist requires explicit command match", () => {
  const trust = loadWorkspaceTrust()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-enterprise-allow-"))
  trust.writeEnterprisePolicy({ allow: { commands: ["npm run typecheck"] } })

  let decision = trust.evaluateCommandExecution(root, "npm run typecheck -- --pretty false", { confirmed: true })
  assert.equal(decision.allowed, true)

  decision = trust.evaluateCommandExecution(root, "npm test", { confirmed: true })
  assert.equal(decision.allowed, false)
  assert.equal(decision.code, "enterprise_policy_not_allowed")
})

test("workspace trust routes expose enterprise policy and security audit", async () => {
  router.clearRoutes()
  const trust = loadWorkspaceTrust()
  trust.register(router)

  const saved = await router.dispatch({
    method: "POST",
    path: "/workspace/enterprise-policy",
    body: { deny: { actions: ["安装扩展"] } },
  })
  assert.equal(saved.ok, true)
  assert.deepEqual(saved.data.policy.deny.actions, ["安装扩展"])

  const blocked = trust.evaluateWorkspaceTrustAction(
    fs.mkdtempSync(path.join(os.tmpdir(), "codek-policy-route-")),
    "安装扩展",
    { confirmed: true },
  )
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.code, "enterprise_policy_denied")

  const audit = await router.dispatch({
    method: "GET",
    path: "/workspace/security-audit",
    query: { limit: 5 },
  })
  assert.equal(audit.ok, true)
  assert.equal(audit.data.events.length, 1)
  assert.equal(audit.data.events[0].action, "安装扩展")
})
