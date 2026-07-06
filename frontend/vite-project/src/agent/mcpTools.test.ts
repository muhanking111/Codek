import { afterEach, describe, expect, it } from "vitest"
import { applyMcpProfileResource } from "../ai/mcpProfileResource"
import { clearProfileMcpServers } from "../ai/mcp.js"
import { getTool, getToolsForMode, buildToolContext } from "./tools"

afterEach(async () => {
  await clearProfileMcpServers()
})

describe("agent MCP tools", () => {
  it("lists MCP servers imported from the active profile registry", async () => {
    await applyMcpProfileResource(JSON.stringify({
      mcp: JSON.stringify({
        servers: {
          profileServer: { command: "node", args: ["server.js"] },
        },
      }),
    }))

    const tool = getTool("mcp_list_tools")
    expect(tool).toBeTruthy()

    const result = await tool!.execute({}, buildToolContext("D:/workspace")) as any

    expect(result.servers).toEqual([
      expect.objectContaining({
        serverName: "profileServer",
        initialized: false,
        profileScoped: true,
        transport: "stdio",
        command: "node",
      }),
    ])
  })

  it("keeps MCP call execution behind high-risk approval while allowing read-only listing in plan mode", () => {
    expect(getTool("mcp_call_tool")?.risk).toBe("high")
    expect(getToolsForMode("plan").map((tool) => tool.name)).toContain("mcp_list_tools")
    expect(getToolsForMode("plan").map((tool) => tool.name)).not.toContain("mcp_call_tool")
  })
})
