/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  emitAgentLifecycleEvent,
  resetLifecycleSessionForTests,
  summarizeLifecyclePayload,
} from "./agentLifecycle"
import { buildMemoryContext, buildMemoryContextAsync, clearMemory, resetMemoryProviderForTests } from "./agentMemory"
import { onAgentEvent } from "./agentEvents"
import { settingsStore } from "../settings/settingsStore"

describe("agent lifecycle memory", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    settingsStore.reset()
    clearMemory()
    resetMemoryProviderForTests()
    resetLifecycleSessionForTests()
  })

  it("redacts secrets and trims tool output before writing lifecycle memory", async () => {
    settingsStore.set("codek.memory.includeToolOutputs", true)
    const secretKeyName = "OPENAI_" + "API_" + "KEY"
    const secretValue = "sk-" + "proj-" + "abcdefghijklmnopqrstuvwxyz" + "1234567890"

    await emitAgentLifecycleEvent({
      type: "tool:after",
      goal: "运行验证",
      stepId: "step-1",
      agentRole: "tester",
      workspaceRoot: "D:/Workspace",
      payload: {
        command: "npm test",
        stdout: `${secretKeyName}=${secretValue}
line 1
line 2
line 3
line 4`,
        fileContent: "完整文件内容不应该被保存",
      },
    })

    const context = buildMemoryContext("npm test")
    expect(context).toContain("npm test")
    expect(context).toContain("[REDACTED")
    expect(context).not.toContain(secretValue)
    expect(context).not.toContain("完整文件内容不应该被保存")
  })

  it("does not include tool output when includeToolOutputs is disabled", () => {
    settingsStore.set("codek.memory.includeToolOutputs", false)

    const summary = summarizeLifecyclePayload({
      command: "npm run build",
      stdout: "very long stdout",
      stderr: "failure details",
      fileContent: "source code",
    })

    expect(summary).toContain("npm run build")
    expect(summary).not.toContain("very long stdout")
    expect(summary).not.toContain("failure details")
    expect(summary).not.toContain("source code")
  })

  it("filters nested source-like payload fields before summarizing lifecycle data", () => {
    settingsStore.set("codek.memory.includeToolOutputs", false)

    const summary = summarizeLifecyclePayload({
      tool: "read_file",
      result: {
        path: "src/App.vue",
        content: "嵌套完整文件内容不应该被保存",
        diff: "diff --git a/src/App.vue b/src/App.vue",
        meta: {
          stdout: "nested stdout should be omitted",
          status: "completed",
        },
      },
    })

    expect(summary).toContain("read_file")
    expect(summary).toContain("src/App.vue")
    expect(summary).toContain("completed")
    expect(summary).not.toContain("嵌套完整文件内容不应该被保存")
    expect(summary).not.toContain("diff --git")
    expect(summary).not.toContain("nested stdout")
  })

  it("redacts nested secrets and omits read_file content from lifecycle memory", async () => {
    settingsStore.set("codek.memory.includeToolOutputs", true)
    const secretKeyName = "OPENAI_" + "API_" + "KEY"
    const secretValue = "sk-" + "proj-" + "abcdefghijklmnopqrstuvwxyz" + "1234567890"

    await emitAgentLifecycleEvent({
      type: "tool:after",
      goal: "read sensitive file",
      stepId: "step-read",
      agentRole: "coder",
      payload: {
        tool: "read_file",
        result: {
          path: ".env",
          content: `${secretKeyName}=${secretValue}`,
          nested: {
            source: "complete source should be omitted",
            stdout: `token=${"abcdefghijklmnopqrstuvwxyz1234567890"}`,
            status: "completed",
          },
        },
      },
    })

    const context = await buildMemoryContextAsync(".env")
    expect(context).toContain(".env")
    expect(context).toContain("completed")
    expect(context).not.toContain(secretValue)
    expect(context).not.toContain("complete source should be omitted")
    expect(context).not.toContain("abcdefghijklmnopqrstuvwxyz1234567890")
  })

  it("keeps run_command stdout out by default and trims it when enabled", () => {
    settingsStore.set("codek.memory.includeToolOutputs", false)
    expect(summarizeLifecyclePayload({
      tool: "run_command",
      command: "npm test",
      stdout: "x".repeat(800),
    })).not.toContain("xxx")

    settingsStore.set("codek.memory.includeToolOutputs", true)
    const summary = summarizeLifecyclePayload({
      tool: "run_command",
      command: "npm test",
      stdout: "x".repeat(800),
    })

    expect(summary).toContain("npm test")
    expect(summary.length).toBeLessThanOrEqual(900)
  })

  it("handles circular payload objects without blocking lifecycle summaries", () => {
    const payload: Record<string, unknown> = { status: "completed" }
    payload.self = payload

    const summary = summarizeLifecyclePayload({ result: payload })

    expect(summary).toContain("completed")
    expect(summary).toContain("[Circular]")
  })

  it("maps failure, verification, and completion lifecycle events to typed memory", async () => {
    await emitAgentLifecycleEvent({
      type: "step:error",
      goal: "修复构建",
      stepId: "step-1",
      agentRole: "coder",
      payload: { error: "Type error in src/App.vue" },
    })
    await emitAgentLifecycleEvent({
      type: "verification:done",
      goal: "修复构建",
      agentRole: "tester",
      payload: { command: "npm run typecheck", passed: false, error: "Type error" },
    })
    await emitAgentLifecycleEvent({
      type: "run:done",
      goal: "修复构建",
      agentRole: "release",
      payload: { result: "typecheck passed", files: ["src/App.vue"] },
    })

    const context = buildMemoryContext("Type error typecheck passed")
    expect(context).toContain("Known Issues")
    expect(context).toContain("npm run typecheck")
    expect(context).toContain("Successful Approaches")
  })

  it("emits lifecycle summaries to the observable event stream", async () => {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = []
    const unsubscribe = onAgentEvent((event) => events.push(event))

    try {
      await emitAgentLifecycleEvent({
        type: "step:start",
        goal: "执行计划",
        planId: "plan-1",
        stepId: "step-1",
        agentRole: "coder",
        workspaceRoot: "D:/Workspace",
        payload: {
          command: "npm run build",
          stdout: "stdout is hidden by default",
        },
      })
    } finally {
      unsubscribe()
    }

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: "agent-lifecycle",
      payload: expect.objectContaining({
        lifecycleType: "step:start",
        goal: "执行计划",
        planId: "plan-1",
        stepId: "step-1",
        agentRole: "coder",
        workspaceRoot: "D:/Workspace",
        summary: expect.stringContaining("npm run build"),
      }),
    })
    expect(String(events[0].payload.summary)).not.toContain("stdout is hidden by default")
  })

  it("swallows provider failures so lifecycle events never block the agent run", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("agentmemory unavailable")
    }))
    settingsStore.update({
      "codek.memory.provider": "agentmemory",
      "codek.memory.agentmemory.fallbackToLocal": false,
    })

    await expect(emitAgentLifecycleEvent({
      type: "run:error",
      goal: "失败任务",
      payload: { error: "boom" },
    })).resolves.toBeUndefined()
  })
})
