import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { nextTick } from "vue"
import { clearMcpInputPromptQueue, mcpInputPromptState, requestMcpInputs } from "../ai/mcpInputPrompt"
import { executeCommand } from "../workbench/commandRegistry"
import { MCP_COMMAND_IDS } from "../workbench/mcpCommandIds"
import McpInputPromptDialog from "./McpInputPromptDialog.vue"

vi.mock("../workbench/commandRegistry", () => ({
  executeCommand: vi.fn(),
}))

describe("McpInputPromptDialog", () => {
  beforeEach(() => {
    clearMcpInputPromptQueue()
    vi.clearAllMocks()
  })

  it("saves missing MCP inputs through the VS Code command registry", async () => {
    vi.mocked(executeCommand).mockResolvedValue(true)
    requestMcpInputs({
      code: "MCP_INPUT_REQUIRED",
      serverName: "fs",
      toolName: "read_file",
      profileId: "profile-a",
      missingInputs: [{ id: "root", description: "Root path" }],
    })

    const wrapper = mount(McpInputPromptDialog, { attachTo: document.body })
    await nextTick()
    const input = document.body.querySelector(".mcp-input-control") as HTMLInputElement
    input.value = "D:/workspace"
    input.dispatchEvent(new Event("input"))
    await nextTick()
    ;(document.body.querySelector(".cdk-btn-primary") as HTMLButtonElement).click()
    await vi.waitFor(() => expect(executeCommand).toHaveBeenCalled())

    expect(executeCommand).toHaveBeenCalledWith(MCP_COMMAND_IDS.EditStoredInput, [
      { id: "root", description: "Root path", password: false },
      "D:/workspace",
      { profileId: "profile-a" },
    ])
    await vi.waitFor(() => expect(mcpInputPromptState.queue).toHaveLength(0))
    await nextTick()
    expect(document.body.querySelector(".mcp-input-control")).toBeNull()
    wrapper.unmount()
  })

  it("uses password inputs for secret metadata", async () => {
    requestMcpInputs({
      code: "MCP_INPUT_REQUIRED",
      missingInputs: [{ id: "API_TOKEN", password: true }],
    })

    const wrapper = mount(McpInputPromptDialog, { attachTo: document.body })
    await nextTick()

    expect((document.body.querySelector(".mcp-input-control") as HTMLInputElement).type).toBe("password")
    wrapper.unmount()
  })
})
