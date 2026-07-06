/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  AgentMemoryProvider,
  agentMemory,
  buildMemoryContextAsync,
  buildMemoryContext,
  clearMemory,
  getMemoryRuntimeState,
  getRelevantMemories,
  recallMemories,
  rememberMemory,
  rememberPreference,
  rememberUserCorrection,
  resetMemoryProviderForTests,
} from "./agentMemory"
import { settingsStore } from "../settings/settingsStore"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("agent memory providers", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    localStorage.clear()
    settingsStore.reset()
    clearMemory()
    resetMemoryProviderForTests()
  })

  it("keeps the compatibility facade on the local provider and supports scoped recall", async () => {
    await rememberMemory({
      type: "preference",
      content: "回答要保持中文和紧凑",
      context: {
        workspaceRoot: "D:/Workspace",
        agentRole: "planner",
        source: "manual",
      },
    })
    await rememberMemory({
      type: "error",
      content: "另一个工作区的错误",
      context: {
        workspaceRoot: "D:/Other",
        source: "lifecycle",
      },
    })

    const scoped = getRelevantMemories("中文", {
      limit: 5,
      workspaceRoot: "D:/Workspace",
      types: ["preference"],
      agentRole: "planner",
    })

    expect(scoped).toHaveLength(1)
    expect(scoped[0]).toEqual(expect.objectContaining({
      type: "preference",
      content: "回答要保持中文和紧凑",
      context: expect.objectContaining({ agentRole: "planner" }),
    }))
    expect(buildMemoryContext("中文")).toContain("回答要保持中文和紧凑")
  })

  it("preserves legacy rememberPreference behavior while trimming by configured type limit", () => {
    settingsStore.set("codek.memory.maxEntriesPerType", 1)

    rememberPreference("第一条偏好")
    rememberPreference("第二条偏好")

    expect(agentMemory.preferences).toHaveLength(1)
    expect(buildMemoryContext("偏好")).toContain("第二条偏好")
    expect(buildMemoryContext("偏好")).not.toContain("第一条偏好")
  })

  it("records manual user corrections as scoped decision memory", async () => {
    rememberUserCorrection("以后必须对照真实证据复核", {
      workspaceRoot: "D:/Workspace",
      agentRole: "reviewer",
      tags: ["plan-audit"],
    })
    await Promise.resolve()

    const context = buildMemoryContext("真实证据")

    expect(context).toContain("**Decisions:**")
    expect(context).toContain("User correction: 以后必须对照真实证据复核")
    expect(agentMemory.decisions[0].context).toEqual(expect.objectContaining({
      workspaceRoot: "D:/Workspace",
      agentRole: "reviewer",
      source: "manual",
      tags: ["plan-audit", "user-correction"],
    }))
  })

  it("wraps agentmemory REST paths inside the provider", async () => {
    const calls: Array<{ url: string; body?: unknown }> = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      if (url.endsWith("/agentmemory/health")) return jsonResponse({ status: "healthy" })
      if (url.endsWith("/agentmemory/observe")) return jsonResponse({ id: "remote-1" }, 201)
      if (url.endsWith("/agentmemory/search")) {
        return jsonResponse({
          results: [
            {
              memory: {
                id: "remote-2",
                type: "decision",
                content: "使用 provider adapter",
                createdAt: "2026-06-09T00:00:00.000Z",
              },
              score: 1,
            },
          ],
        })
      }
      return jsonResponse({}, 404)
    }))

    const provider = new AgentMemoryProvider({
      baseUrl: "http://127.0.0.1:3111",
      timeoutMs: 500,
    })

    await expect(provider.health()).resolves.toEqual({ ok: true })
    await provider.remember({
      type: "decision",
      content: "使用 provider adapter",
      context: {
        workspaceRoot: "D:/Workspace",
        repo: "Codek",
        source: "manual",
      },
    })
    const recalled = await provider.recall("provider", { limit: 2, workspaceRoot: "D:/Workspace" })

    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:3111/agentmemory/health",
      "http://127.0.0.1:3111/agentmemory/observe",
      "http://127.0.0.1:3111/agentmemory/search",
    ])
    expect(calls[1].body).toEqual(expect.objectContaining({
      hookType: "notification",
      project: "Codek",
      cwd: "D:/Workspace",
      data: expect.objectContaining({
        type: "decision",
        content: "使用 provider adapter",
      }),
    }))
    expect(calls[2].body).toEqual(expect.objectContaining({
      query: "provider",
      limit: 2,
      project: "D:/Workspace",
      cwd: "D:/Workspace",
      format: "compact",
    }))
    expect(recalled[0].content).toBe("使用 provider adapter")
  })

  it("passes an optional local agentmemory authorization header", async () => {
    const headers: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      headers.push(String((init?.headers as Record<string, string> | undefined)?.Authorization || ""))
      return jsonResponse({ status: "healthy" })
    }))
    settingsStore.set("codek.memory.agentmemory.authHeader", "Bearer local-secret")

    const provider = new AgentMemoryProvider({ baseUrl: "http://127.0.0.1:3111" })
    await provider.health()

    expect(headers).toEqual(["Bearer local-secret"])
  })

  it("redacts direct provider writes before sending them to agentmemory", async () => {
    let observedBody: Record<string, unknown> | undefined
    const secretName = "tok" + "en"
    const secretValue = "abcdefghijklmnopqrstuvwxyz" + "123456"
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/agentmemory/observe")) {
        observedBody = init?.body ? JSON.parse(String(init.body)) : undefined
        return jsonResponse({ id: "remote-secret" }, 201)
      }
      return jsonResponse({ status: "healthy" })
    }))

    const provider = new AgentMemoryProvider({ baseUrl: "http://localhost:3111" })
    const saved = await provider.remember({
      type: "decision",
      content: `${secretName}=${secretValue}`,
      context: { workspaceRoot: "D:/Workspace", source: "manual" },
    })

    expect(saved.content).toContain("[REDACTED_SECRET]")
    expect(JSON.stringify(observedBody)).toContain("[REDACTED_SECRET]")
    expect(JSON.stringify(observedBody)).not.toContain(secretValue)
  })

  it("redacts memory content even when generic log redaction is disabled", async () => {
    settingsStore.set("codek.privacy.redactLogs", false)
    const secretKeyName = "OPENAI_" + "API_" + "KEY"
    const secretValue = "sk-" + "proj-" + "abcdefghijklmnopqrstuvwxyz" + "1234567890"

    await rememberMemory({
      type: "decision",
      content: `${secretKeyName}=${secretValue}`,
      context: { workspaceRoot: "D:/Workspace", source: "manual" },
    })

    expect(buildMemoryContext("OPENAI")).toContain("[REDACTED")
    expect(JSON.stringify(agentMemory)).not.toContain(secretValue)
  })

  it("falls back to local memory when agentmemory is unavailable and fallback is enabled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline")
    }))
    settingsStore.update({
      "codek.memory.provider": "agentmemory",
      "codek.memory.agentmemory.baseUrl": "http://127.0.0.1:3111",
      "codek.memory.agentmemory.fallbackToLocal": true,
    })

    await rememberMemory({
      type: "error",
      content: "agentmemory offline during recall",
      context: {
        workspaceRoot: "D:/Workspace",
        source: "lifecycle",
      },
    })

    expect(getMemoryRuntimeState()).toEqual(expect.objectContaining({
      provider: "agentmemory",
      status: "fallback",
      error: expect.stringContaining("offline"),
    }))
    expect(buildMemoryContext("offline")).toContain("agentmemory offline during recall")
  })

  it("falls back to local memory when agentmemory returns HTTP 500", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "boom" }, 500)))
    settingsStore.update({
      "codek.memory.provider": "agentmemory",
      "codek.memory.agentmemory.baseUrl": "http://127.0.0.1:3111",
      "codek.memory.agentmemory.fallbackToLocal": true,
    })

    await rememberMemory({
      type: "error",
      content: "agentmemory 500 should not block agent execution",
      context: {
        workspaceRoot: "D:/Workspace",
        source: "lifecycle",
      },
    })

    expect(getMemoryRuntimeState()).toEqual(expect.objectContaining({
      provider: "agentmemory",
      status: "fallback",
      error: expect.stringContaining("HTTP 500"),
    }))
    expect(buildMemoryContext("500")).toContain("agentmemory 500 should not block agent execution")
  })

  it("falls back to local memory when agentmemory times out", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      const signal = init?.signal
      signal?.addEventListener("abort", () => {
        reject(new DOMException("agentmemory request timed out", "AbortError"))
      }, { once: true })
    })))
    settingsStore.update({
      "codek.memory.provider": "agentmemory",
      "codek.memory.agentmemory.baseUrl": "http://127.0.0.1:3111",
      "codek.memory.agentmemory.timeoutMs": 5,
      "codek.memory.agentmemory.fallbackToLocal": true,
    })

    const saved = rememberMemory({
      type: "error",
      content: "agentmemory timeout should fallback",
      context: {
        workspaceRoot: "D:/Workspace",
        source: "lifecycle",
      },
    })

    await vi.advanceTimersByTimeAsync(5)
    await saved

    expect(getMemoryRuntimeState()).toEqual(expect.objectContaining({
      provider: "agentmemory",
      status: "fallback",
      error: expect.stringContaining("timed out"),
    }))
    expect(buildMemoryContext("timeout")).toContain("agentmemory timeout should fallback")
  })

  it("uses remote recall for the active agentmemory provider", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/agentmemory/search")) {
        return jsonResponse({
          results: [
            {
              observation: {
                id: "obs-1",
                type: "decision",
                narrative: "远端检索到的决策记忆",
                timestamp: "2026-06-09T00:00:00.000Z",
              },
              score: 0.9,
            },
          ],
        })
      }
      return jsonResponse({ status: "healthy" })
    }))
    settingsStore.update({
      "codek.memory.provider": "agentmemory",
      "codek.memory.agentmemory.baseUrl": "http://127.0.0.1:3111",
    })

    const memories = await recallMemories("决策", { limit: 1, workspaceRoot: "D:/Workspace" })

    expect(memories).toHaveLength(1)
    expect(memories[0]).toEqual(expect.objectContaining({
      type: "decision",
      content: "远端检索到的决策记忆",
    }))
    expect(getMemoryRuntimeState().status).toBe("connected")
  })

  it("builds async memory context from the active agentmemory provider", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/agentmemory/search")) {
        return jsonResponse({
          results: [
            {
              memory: {
                id: "remote-context",
                type: "decision",
                content: "remote provider context is active",
                context: { source: "lifecycle", workspaceRoot: "D:/Workspace" },
              },
            },
          ],
        })
      }
      return jsonResponse({ status: "healthy" })
    })
    vi.stubGlobal("fetch", fetch)
    settingsStore.update({
      "codek.memory.provider": "agentmemory",
      "codek.memory.agentmemory.baseUrl": "http://127.0.0.1:3111",
    })

    const context = await buildMemoryContextAsync("remote provider", { workspaceRoot: "D:/Workspace" })

    expect(context).toContain("remote provider context is active")
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3111/agentmemory/search",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("does not call agentmemory when memory is disabled", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    settingsStore.update({
      "codek.memory.enabled": false,
      "codek.memory.provider": "agentmemory",
    })

    await expect(rememberMemory({
      type: "decision",
      content: "disabled memory should not write",
      context: { source: "manual" },
    })).resolves.toBeNull()
    await expect(recallMemories("disabled")).resolves.toEqual([])
    await expect(buildMemoryContextAsync("disabled")).resolves.toBe("")

    expect(fetch).not.toHaveBeenCalled()
    expect(getMemoryRuntimeState().status).toBe("disabled")
  })

  it("does not silently clear remote agentmemory data", async () => {
    const provider = new AgentMemoryProvider({ baseUrl: "http://127.0.0.1:3111" })

    await expect(provider.clear()).rejects.toThrow("unsupported")
  })

  it("keeps legacy fire-and-forget helpers non-blocking when remote memory fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("remote down")
    }))
    settingsStore.update({
      "codek.memory.provider": "agentmemory",
      "codek.memory.agentmemory.fallbackToLocal": false,
    })

    expect(() => rememberPreference("remote failure should not throw")).not.toThrow()

    await vi.waitFor(() => {
      expect(getMemoryRuntimeState()).toEqual(expect.objectContaining({
        provider: "agentmemory",
        status: "error",
        error: expect.stringContaining("remote down"),
      }))
    })
  })

  it("rejects non-local agentmemory base URLs and falls back locally", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    settingsStore.update({
      "codek.memory.provider": "agentmemory",
      "codek.memory.agentmemory.baseUrl": "https://agentmemory.example.com",
      "codek.memory.agentmemory.fallbackToLocal": true,
    })

    const saved = await rememberMemory({
      type: "decision",
      content: "外部 agentmemory 地址被拒绝",
      context: { workspaceRoot: "D:/Workspace", source: "manual" },
    })

    expect(saved?.content).toBe("外部 agentmemory 地址被拒绝")
    expect(fetch).not.toHaveBeenCalled()
    expect(getMemoryRuntimeState()).toEqual(expect.objectContaining({
      provider: "agentmemory",
      status: "fallback",
      error: expect.stringContaining("localhost"),
    }))
    expect(buildMemoryContext("外部")).toContain("外部 agentmemory 地址被拒绝")
  })

  it("parses array export responses from agentmemory", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/agentmemory/export")) {
        return jsonResponse([
          {
            id: "export-1",
            type: "verification",
            content: "导出的验证记忆",
            context: { source: "verification", agentRole: "tester" },
            createdAt: "not-a-date",
          },
        ])
      }
      return jsonResponse({ status: "healthy" })
    }))

    const provider = new AgentMemoryProvider({ baseUrl: "http://[::1]:3111" })
    const exported = await provider.export()

    expect(exported).toHaveLength(1)
    expect(exported[0]).toEqual(expect.objectContaining({
      type: "verification",
      content: "导出的验证记忆",
      context: expect.objectContaining({ agentRole: "tester" }),
    }))
    expect(Number.isFinite(exported[0].createdAt)).toBe(true)
  })
})
