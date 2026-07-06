import { afterEach, describe, expect, it } from "vitest"
import {
  applyActiveProfileMcpResource,
  applyMcpProfileResource,
  parseMcpProfileResource,
} from "./mcpProfileResource"
import { clearProfileMcpServers, listConfiguredMcpServers } from "./mcp.js"
import { WorkbenchProfileStore } from "../settings/profileStore"
import { SettingsStore, type SettingsStorage } from "../settings/settingsStore"

class MemoryStorage implements SettingsStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function createProfileStore(): WorkbenchProfileStore {
  const storage = new MemoryStorage()
  return new WorkbenchProfileStore({
    storage,
    settingsStore: new SettingsStore({ storage, userKey: "settings:user" }),
    profilesKey: "profiles",
    activeKey: "profiles:active",
    profileStorage: null,
    now: () => new Date("2026-06-21T00:00:00.000Z"),
  })
}

afterEach(async () => {
  await clearProfileMcpServers()
})

describe("MCP profile resource adapter", () => {
  it("parses VS Code .code-profile mcp resource into runtime server configs", () => {
    const inner = `{
      // VS Code mcp.json allows comments and trailing commas.
      "servers": {
        "local": {
          "command": "node",
          "args": ["server.js", "--stdio",],
          "env": { "PORT": 3000, "EMPTY": null, },
        },
        "remote": {
          "type": "http",
          "url": "https://example.test/mcp",
          "headers": { "Authorization": "Bearer x" },
        },
        "legacy": {
          "config": { "command": "python", "args": ["-m", "mcp_server"], },
          "version": "1.0.0",
        },
        "websocket": { "type": "ws", "url": "ws://localhost" },
      },
      "inputs": [{ "id": "token", "type": "promptString" }],
    }`
    const resource = JSON.stringify({ mcp: inner })

    const parsed = parseMcpProfileResource(resource)

    expect(parsed.errors).toEqual([])
    expect(parsed.inputs).toEqual([{ id: "token", type: "promptString" }])
    expect(parsed.servers).toEqual([
      {
        serverName: "local",
        name: "local",
        type: "stdio",
        transport: "stdio",
        command: "node",
        args: ["server.js", "--stdio"],
        env: { PORT: "3000", EMPTY: "" },
        cwd: undefined,
      },
      {
        serverName: "remote",
        name: "remote",
        type: "http",
        transport: "http",
        url: "https://example.test/mcp",
        serverUrl: "https://example.test/mcp",
        headers: { Authorization: "Bearer x" },
      },
      {
        serverName: "legacy",
        name: "legacy",
        type: "stdio",
        transport: "stdio",
        command: "python",
        args: ["-m", "mcp_server"],
        env: undefined,
        cwd: undefined,
      },
    ])
  })

  it("supports Cursor mcpServers wrapper and replaces previous profile-scoped servers", async () => {
    await applyMcpProfileResource(JSON.stringify({
      mcp: JSON.stringify({
        mcpServers: {
          first: { command: "node", args: ["first.js"] },
        },
      }),
    }))

    expect(listConfiguredMcpServers().map((server) => server.serverName)).toEqual(["first"])

    await applyMcpProfileResource(JSON.stringify({
      mcp: JSON.stringify({
        servers: {
          second: { command: "node", args: ["second.js"] },
        },
      }),
    }))

    expect(listConfiguredMcpServers().map((server) => server.serverName)).toEqual(["second"])
    expect(listConfiguredMcpServers()[0].profileScoped).toBe(true)
  })

  it("applies the active Workbench profile mcp resource", async () => {
    const profiles = createProfileStore()
    profiles.upsertSnapshot({
      id: "no-mcp",
      name: "No MCP",
      settings: {},
      resources: {
        mcp: JSON.stringify({ mcp: JSON.stringify({ servers: { stale: { command: "node" } } }) }),
      },
      activate: false,
    })
    profiles.upsertSnapshot({
      id: "active-mcp",
      name: "Active MCP",
      settings: {},
      resources: {
        mcp: JSON.stringify({ mcp: JSON.stringify({ servers: { active: { command: "python" } } }) }),
      },
      activate: true,
    })

    const parsed = await applyActiveProfileMcpResource(profiles)

    expect(parsed.servers.map((server) => server.serverName)).toEqual(["active"])
    expect(listConfiguredMcpServers()).toEqual([
      expect.objectContaining({
        serverName: "active",
        profileScoped: true,
        config: expect.objectContaining({ command: "python" }),
      }),
    ])
  })
})
