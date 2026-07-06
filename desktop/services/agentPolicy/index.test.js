const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

function loadAgentPolicy(codekData = fs.mkdtempSync(path.join(os.tmpdir(), "codek-policy-"))) {
  const previous = process.env.CODEK_DATA
  process.env.CODEK_DATA = codekData
  delete require.cache[require.resolve("../settings")]
  delete require.cache[require.resolve("../mcp/mcpAccess")]
  delete require.cache[require.resolve("../workspaceTrust")]
  delete require.cache[require.resolve("./index")]
  const settings = require("../settings")
  const workspaceTrust = require("../workspaceTrust")
  const agentPolicy = require("./index")
  if (previous == null) delete process.env.CODEK_DATA
  else process.env.CODEK_DATA = previous
  return { agentPolicy, settings, workspaceTrust }
}

test("restricted workspace blocks mutating agent tools", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-restricted-root-"))
  const { agentPolicy, workspaceTrust } = loadAgentPolicy()
  workspaceTrust.setWorkspaceTrust(root, { status: "restricted" })
  agentPolicy.setPolicy({ sandboxMode: "workspace-write", approvalMode: "never", networkAllowed: true })

  const decision = agentPolicy.evaluateToolCall({
    projectRoot: root,
    tool: { name: "write_file", flags: { mutates: true, pathArgs: ["path"] } },
    input: { path: "src/app.ts" },
  })

  assert.equal(decision.decision, "deny")
  assert.match(decision.reason, /restricted/)
})

test("unknown workspace restores approval prompts for mutating tools", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-unknown-root-"))
  const { agentPolicy } = loadAgentPolicy()
  agentPolicy.setPolicy({ sandboxMode: "workspace-write", approvalMode: "never", networkAllowed: true })

  const decision = agentPolicy.evaluateToolCall({
    projectRoot: root,
    tool: { name: "write_file", flags: { mutates: true, pathArgs: ["path"] } },
    input: { path: "src/app.ts" },
  })

  assert.equal(decision.decision, "prompt")
  assert.equal(decision.networkAccess, false)
})

test("trusted workspace keeps user policy", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-trusted-root-"))
  const { agentPolicy, workspaceTrust } = loadAgentPolicy()
  workspaceTrust.setWorkspaceTrust(root, { status: "trusted" })
  agentPolicy.setPolicy({ sandboxMode: "workspace-write", approvalMode: "never", networkAllowed: true })

  const decision = agentPolicy.evaluateToolCall({
    projectRoot: root,
    tool: { name: "run_shell", flags: { mutates: true } },
    input: {},
  })

  assert.equal(decision.decision, "allow")
  assert.equal(decision.networkAccess, true)
})

test("enterprise policy denylist blocks agent write tools and keeps audit metadata only", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-enterprise-agent-"))
  const { agentPolicy, workspaceTrust } = loadAgentPolicy()
  workspaceTrust.setWorkspaceTrust(root, { status: "trusted" })
  workspaceTrust.writeEnterprisePolicy({ deny: { tools: ["write_file"] } })

  const decision = agentPolicy.evaluateToolCall({
    projectRoot: root,
    tool: { name: "write_file", flags: { mutates: true, pathArgs: ["path"] } },
    input: { path: "src/secret-token-file.ts", content: "sk-test-should-not-be-audited" },
  })

  assert.equal(decision.decision, "deny")
  assert.equal(decision.code, "enterprise_policy_denied")
  const events = workspaceTrust.listSecurityAuditEvents()
  assert.equal(events.length, 1)
  assert.equal(events[0].toolName, "write_file")
  assert.ok(events[0].pathHash)
  assert.equal(JSON.stringify(events).includes("secret-token-file"), false)
  assert.equal(JSON.stringify(events).includes("sk-test-should-not-be-audited"), false)
})

test("VS Code chat.mcp.access none blocks MCP tool calls before approval or startup", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-mcp-access-policy-"))
  const { agentPolicy, settings, workspaceTrust } = loadAgentPolicy()
  workspaceTrust.setWorkspaceTrust(root, { status: "trusted" })
  settings.writeUserSettings({ "chat.mcp.access": "none" })
  agentPolicy.setPolicy({ sandboxMode: "danger-full-access", approvalMode: "never", networkAllowed: true })

  const decision = agentPolicy.evaluateToolCall({
    projectRoot: root,
    tool: { name: "mcp_call_tool", flags: { mutates: true, network: true, pathArgs: [] } },
    input: { serverName: "blocked", toolName: "echo" },
  })

  assert.equal(decision.decision, "deny")
  assert.equal(decision.code, "mcp_access_disabled")
  assert.equal(decision.networkAccess, false)
  assert.equal(decision.mcpAccess, "none")
  assert.match(decision.reason, /chat\.mcp\.access/)
  const events = workspaceTrust.listSecurityAuditEvents()
  assert.equal(events.at(-1).code, "mcp_access_disabled")
  assert.equal(events.at(-1).policyRule, "chat.mcp.access")
})
