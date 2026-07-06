const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

function loadMcpAccess() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-mcp-access-"))
  const previous = process.env.CODEK_DATA
  process.env.CODEK_DATA = tempDir
  for (const modulePath of [
    "../settings",
    "./mcpAccess",
  ]) {
    delete require.cache[require.resolve(modulePath)]
  }
  const settings = require("../settings")
  const mcpAccess = require("./mcpAccess")
  if (previous == null) delete process.env.CODEK_DATA
  else process.env.CODEK_DATA = previous
  return { mcpAccess, settings, tempDir }
}

test("MCP access defaults to VS Code all access when setting is missing or invalid", () => {
  const { mcpAccess, settings } = loadMcpAccess()

  assert.equal(mcpAccess.getMcpAccessValue(), "all")
  assert.equal(mcpAccess.isMcpAccessAllowed(), true)

  settings.writeUserSettings({ "chat.mcp.access": "invalid" })

  assert.equal(mcpAccess.getMcpAccessValue(), "all")
  assert.equal(mcpAccess.isMcpAccessAllowed(), true)
})

test("MCP access reads VS Code chat.mcp.access none gate", () => {
  const { mcpAccess, settings } = loadMcpAccess()

  settings.writeUserSettings({ "chat.mcp.access": "none" })

  assert.equal(mcpAccess.getMcpAccessValue(), "none")
  assert.equal(mcpAccess.isMcpAccessAllowed(), false)
  assert.equal(mcpAccess.getMcpAccessDeniedMessage().includes("chat.mcp.access"), true)
})

test("AllowedMcpServersService mirrors VS Code chat.mcp.access and fires change events", () => {
  const { mcpAccess, settings } = loadMcpAccess()
  const service = new mcpAccess.AllowedMcpServersService()
  const events = []
  const disposable = service.onDidChangeAllowedMcpServers(() => events.push(service.access))

  assert.equal(service.isAllowed({ name: "server" }), true)

  settings.writeUserSettings({ "chat.mcp.access": "none" })

  const blocked = service.isAllowed({ name: "server" })
  assert.notEqual(blocked, true)
  assert.match(blocked.value, /chat\.mcp\.access/)
  assert.deepEqual(events, ["none"])

  disposable.dispose()
  service.dispose()
})
