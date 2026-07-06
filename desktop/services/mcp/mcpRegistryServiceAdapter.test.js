const assert = require("node:assert/strict")
const test = require("node:test")

const { McpRegistryServiceAdapter } = require("./mcpRegistryServiceAdapter")

test("McpRegistryServiceAdapter exposes VS Code-style collection snapshots and change events", async () => {
  const events = []
  const registry = new McpRegistryServiceAdapter()
  const disposable = registry.onDidChangeCollections((event) => events.push(event))

  registry.registerCollection({ id: "workspace", label: "Workspace MCP", scope: "workspace", order: 10 })
  registry.registerCollection({ id: "profile", label: "Profile MCP", scope: "profile", order: 0 })
  registry.addServerToCollection("workspace", "workspaceServer")
  registry.addServerToCollection("profile", "profileServer")

  assert.deepEqual(registry.listCollections().map((collection) => collection.id), ["profile", "workspace"])
  assert.deepEqual(registry.listCollections()[0].serverNames, ["profileServer"])
  assert.equal(events.some((event) => event.reason === "add-server" && event.serverName === "workspaceServer"), true)

  await registry.clearCollection("workspace")
  assert.deepEqual(registry.listCollections().map((collection) => collection.id), ["profile"])
  assert.equal(events.at(-1).reason, "remove-collection")

  disposable.dispose()
})

test("McpRegistryServiceAdapter replaces lazy collections and sorts delegates by priority", () => {
  const delegateEvents = []
  const registry = new McpRegistryServiceAdapter()
  registry.onDidChangeDelegates((event) => delegateEvents.push(event))

  registry.registerCollection({ id: "extension", label: "Lazy", order: 20, lazy: { isCached: false } })
  registry.registerCollection({ id: "extension", label: "Real", order: 20 }, { replace: true })

  assert.equal(registry.listCollections()[0].label, "Real")

  const low = registry.registerDelegate({ priority: 1, start: async () => undefined })
  const high = registry.registerDelegate({ priority: 10, start: async () => undefined })
  assert.deepEqual(registry.listDelegates().map((delegate) => delegate.priority), [10, 1])
  assert.equal(delegateEvents.at(-1).reason, "add-delegate")

  high.dispose()
  low.dispose()
  assert.deepEqual(registry.listDelegates(), [])
})

test("McpRegistryServiceAdapter hides collections when chat.mcp.access is none", () => {
  const registry = new McpRegistryServiceAdapter({ accessProvider: () => "none" })
  registry.registerCollection({ id: "profile", label: "Profile MCP", scope: "profile" })
  registry.addServerToCollection("profile", "profileServer")

  assert.deepEqual(registry.listCollections(), [])
  assert.equal(registry.getCollectionForServer("profileServer").id, "profile")
})
