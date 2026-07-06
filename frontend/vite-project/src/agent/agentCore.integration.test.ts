/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmChatOptions } from "../ai/llmClient"
import { clearMemory, rememberMemory, resetMemoryProviderForTests } from "./agentMemory"
import { settingsStore } from "../settings/settingsStore"

const llmMocks = vi.hoisted(() => ({
  calls: [] as LlmChatOptions[],
  responses: [] as string[],
  chatStream: vi.fn(),
}))

vi.mock("../ai/llmClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ai/llmClient")>()
  return {
    ...actual,
    chatStream: llmMocks.chatStream,
  }
})

function streamResponse(content: string): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })
}

describe("AutonomousAgent memory integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    settingsStore.reset()
    clearMemory()
    resetMemoryProviderForTests()
    llmMocks.calls.length = 0
    llmMocks.responses = []
    llmMocks.chatStream.mockImplementation(async (options: LlmChatOptions) => {
      llmMocks.calls.push(options)
      return streamResponse(llmMocks.responses.shift() || "```done\n{\"summary\":\"ok\"}\n```")
    })
  })

  it("injects previous coder failure memory into the next planning call", async () => {
    const { AutonomousAgent } = await import("./agentCore")
    await rememberMemory({
      type: "error",
      content: "config migration failed with TypeError: missing workspaceRoot",
      context: {
        workspaceRoot: "D:/Workspace",
        agentRole: "coder",
        source: "lifecycle",
      },
    })
    llmMocks.responses = [
      JSON.stringify([{ description: "修复 config migration", estimatedRisk: "safe" }]),
      "```done\n{\"summary\":\"fixed\"}\n```",
    ]
    const agent = new AutonomousAgent({ mode: "autonomous" })
    agent.getState().context.set("projectRoot", "D:/Workspace")

    await agent.start("修复 config migration")

    const planningCall = llmMocks.calls[0]
    const systemPrompt = String(planningCall.messages[0]?.content || "")
    expect(systemPrompt).toContain("Relevant Context from Past Sessions")
    expect(systemPrompt).toContain("Known Issues")
    expect(systemPrompt).toContain("missing workspaceRoot")
  })
})
