import { beforeEach, describe, expect, it } from "vitest"
import {
  clearMcpInputPromptQueue,
  mcpInputPromptState,
  normalizeMcpInputRequiredPayload,
  requestMcpInputs,
} from "./mcpInputPrompt"

describe("mcpInputPrompt", () => {
  beforeEach(() => clearMcpInputPromptQueue())

  it("normalizes VS Code MCP missing input payloads from structured tool results", () => {
    const result = normalizeMcpInputRequiredPayload({
      code: "MCP_INPUT_REQUIRED",
      serverName: "fs",
      toolName: "read_file",
      profileId: "profile-a",
      missingInputs: [
        { id: "root", password: false, default: "${workspaceFolder}" },
        { id: " API_TOKEN ", password: true },
        { id: "" },
      ],
    })

    expect(result).toEqual({
      serverName: "fs",
      toolName: "read_file",
      profileId: "profile-a",
      inputs: [
        { id: "root", password: false, default: "${workspaceFolder}" },
        { id: "API_TOKEN", password: true },
      ],
    })
  })

  it("queues prompt requests only when missing input metadata is present", () => {
    expect(requestMcpInputs({ code: "MCP_INPUT_REQUIRED", missingInputs: [] })).toBeNull()

    const request = requestMcpInputs({
      code: "MCP_INPUT_REQUIRED",
      activeProfileId: "profile-a",
      missingInputs: [{ id: "root" }],
    })

    expect(request?.inputs).toEqual([{ id: "root", password: false }])
    expect(request?.profileId).toBe("profile-a")
    expect(mcpInputPromptState.queue).toHaveLength(1)
  })
})
