/*---------------------------------------------------------------------------------------------
 *  Frontend agent-loop driver.
 *
 *  Calls the main-process /agent/loop/run endpoint and surfaces structured events
 *  (text deltas, tool_call, tool_result, turn_end, done, error) back to the caller.
 *
 *  Designed to feed ChatPanel's `parts[]` schema directly — text events extend the
 *  current TextPart, tool_call/tool_result spawn ToolCallPart / ToolResultPart entries.
 *
 *  Authorization prompts are handled separately by AuthorizationDialog.vue, which
 *  subscribes to the same agentTools auth-request channel.
 *--------------------------------------------------------------------------------------------*/

import type { ChatPart, ToolCallStatus } from "./chatTypes"
import type { ContextEvidence } from "./contextEvidence"

export type AgentEventType =
  | "text_delta"
  | "thinking_delta"
  | "thinking_start"
  | "thinking_end"
  | "tool_call"
  | "tool_result"
  | "turn_end"
  | "plan"
  | "phase_start"
  | "phase_done"
  | "phase_failed"
  | "phase_blocked"
  | "reflection"
  | "plan_done"
  | "done"
  | "error"

export interface AgentEvent {
  requestId: string
  type: AgentEventType
  content?: string
  id?: string
  callId?: string
  name?: string
  input?: unknown
  isError?: boolean
  structured?: unknown
  error?: string
  reason?: string
  finishReason?: string | null
  hadToolCalls?: boolean
  plan?: unknown
  planId?: string
  phaseId?: string
  decision?: unknown
  summary?: string
  filesChanged?: string[]
  conflicts?: unknown
}

export interface AgentRunRequest {
  provider: string
  model: string
  messages: Array<{ role: string; content: string | null; tool_calls?: unknown; tool_call_id?: string }>
  projectRoot: string
  workspaceFile?: string | null
  apiKey?: string
  baseUrl?: string
  temperature?: number
  topP?: number
  maxTokens?: number
  contextEvidence?: ContextEvidence | null
}

export interface AgentRunCallbacks {
  /** Called once when the request is dispatched, with the requestId used for abort. */
  onStart?: (requestId: string) => void
  /** Append text to the current assistant text part. */
  onTextDelta?: (content: string) => void
  /** Append text to the current thinking part. */
  onThinkingDelta?: (content: string) => void
  /** Model entered a thinking block (Anthropic only signals this explicitly). */
  onThinkingStart?: () => void
  /** Model finished a thinking block (Anthropic only). */
  onThinkingEnd?: () => void
  /** Model decided to call a tool — render a pending tool card. */
  onToolCall?: (call: { id: string; name: string; input: unknown }) => void
  /** Tool finished (success or error). Use this to flip the matching card. */
  onToolResult?: (result: { callId: string; content: string; isError: boolean; structured?: unknown }) => void
  /** Single model turn finished. Useful for splitting parts. */
  onTurnEnd?: (info: { finishReason?: string | null; hadToolCalls?: boolean }) => void
  /** Loop terminated. `reason` is "stop" | "max_turns" | "error" | "aborted". */
  onDone?: (reason: string) => void
  /** Hard error from main process. */
  onError?: (error: string) => void
}

/** Abort a running agent loop by requestId. Safe to call after completion (no-op). */
export async function abortAgentLoop(requestId: string): Promise<void> {
  const bridge = getBridge()
  if (!bridge || !requestId) return
  try { await bridge.abort(requestId) } catch { /* ignore */ }
}

interface AgentLoopBridge {
  run: (request: AgentRunRequest & { requestId?: string }) => Promise<{ ok: boolean; data?: { requestId?: string } }>
  plan?: (request: AgentPlanRequest & { requestId?: string }) => Promise<{ ok: boolean; data?: { requestId?: string } }>
  abort: (requestId: string) => Promise<{ ok: boolean; data?: { aborted: boolean } }>
  onEvent: (callback: (payload: AgentEvent) => void) => () => void
}

function getBridge(): AgentLoopBridge | null {
  const codek = (window as unknown as { codek?: { agentLoop?: AgentLoopBridge } }).codek
  return codek?.agentLoop ?? null
}

function makeRequestId(): string {
  return `agent_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Kick off a tool-calling loop. Resolves once the loop emits `done` (or `error`).
 * Throws if the IPC bridge is unavailable.
 */
export async function runAgentLoop(request: AgentRunRequest, callbacks: AgentRunCallbacks = {}): Promise<void> {
  const bridge = getBridge()
  if (!bridge) throw new Error("Agent loop IPC bridge not available")

  const requestId = makeRequestId()
  callbacks.onStart?.(requestId)

  return new Promise<void>((resolve, reject) => {
    let settled = false
    const unsubscribe = bridge.onEvent((payload) => {
      if (payload.requestId !== requestId) return
      switch (payload.type) {
        case "text_delta":
          if (payload.content) callbacks.onTextDelta?.(payload.content)
          break
        case "thinking_delta":
          if (payload.content) callbacks.onThinkingDelta?.(payload.content)
          break
        case "thinking_start":
          callbacks.onThinkingStart?.()
          break
        case "thinking_end":
          callbacks.onThinkingEnd?.()
          break
        case "tool_call":
          if (payload.id && payload.name) {
            callbacks.onToolCall?.({ id: payload.id, name: payload.name, input: payload.input })
          }
          break
        case "tool_result":
          if (payload.callId) {
            callbacks.onToolResult?.({
              callId: payload.callId,
              content: payload.content || "",
              isError: !!payload.isError,
              structured: payload.structured,
            })
          }
          break
        case "turn_end":
          callbacks.onTurnEnd?.({ finishReason: payload.finishReason, hadToolCalls: payload.hadToolCalls })
          break
        case "error":
          callbacks.onError?.(payload.error || "unknown error")
          break
        case "done":
          callbacks.onDone?.(payload.reason || "stop")
          if (!settled) {
            settled = true
            unsubscribe()
            resolve()
          }
          break
      }
    })

    bridge.run({ ...request, requestId }).catch((err: unknown) => {
      if (settled) return
      settled = true
      unsubscribe()
      const msg = err instanceof Error ? err.message : String(err)
      callbacks.onError?.(msg)
      reject(new Error(msg))
    })
  })
}

export interface AgentPlanRequest {
  provider: string
  model: string
  userInput: string
  projectRoot: string
  workspaceFile?: string | null
  projectSummary?: string
  apiKey?: string
  baseUrl?: string
  temperature?: number
  topP?: number
  maxTokens?: number
  contextEvidence?: ContextEvidence | null
}

export interface AgentPlanCallbacks extends AgentRunCallbacks {
  onPlanEvent?: (event: AgentEvent) => void
}

export async function runAgentPlan(request: AgentPlanRequest, callbacks: AgentPlanCallbacks = {}): Promise<void> {
  const bridge = getBridge()
  if (!bridge?.plan) throw new Error("Agent plan IPC bridge not available")
  const plan = bridge.plan

  const requestId = makeRequestId().replace(/^agent_/, "plan_")
  callbacks.onStart?.(requestId)

  return new Promise<void>((resolve, reject) => {
    let settled = false
    const unsubscribe = bridge.onEvent((payload) => {
      if (payload.requestId !== requestId) return
      switch (payload.type) {
        case "plan":
        case "phase_start":
        case "phase_done":
        case "phase_failed":
        case "phase_blocked":
        case "reflection":
        case "plan_done":
          callbacks.onPlanEvent?.(payload)
          break
        case "text_delta":
          if (payload.content) callbacks.onTextDelta?.(payload.content)
          break
        case "thinking_delta":
          if (payload.content) callbacks.onThinkingDelta?.(payload.content)
          break
        case "thinking_start":
          callbacks.onThinkingStart?.()
          break
        case "thinking_end":
          callbacks.onThinkingEnd?.()
          break
        case "tool_call":
          if (payload.id && payload.name) {
            callbacks.onToolCall?.({ id: payload.id, name: payload.name, input: payload.input })
          }
          break
        case "tool_result":
          if (payload.callId) {
            callbacks.onToolResult?.({
              callId: payload.callId,
              content: payload.content || "",
              isError: !!payload.isError,
              structured: payload.structured,
            })
          }
          break
        case "turn_end":
          callbacks.onTurnEnd?.({ finishReason: payload.finishReason, hadToolCalls: payload.hadToolCalls })
          break
        case "error":
          callbacks.onError?.(payload.error || "unknown error")
          break
        case "done":
          callbacks.onDone?.(payload.reason || "stop")
          if (!settled) {
            settled = true
            unsubscribe()
            resolve()
          }
          break
      }
    })

    plan({ ...request, requestId }).catch((err: unknown) => {
      if (settled) return
      settled = true
      unsubscribe()
      const msg = err instanceof Error ? err.message : String(err)
      callbacks.onError?.(msg)
      reject(new Error(msg))
    })
  })
}

/**
 * Helper for ChatPanel: mutate a parts array in place based on an event stream.
 * Returns a callbacks object suitable for `runAgentLoop`. Mutations are committed
 * to the caller-provided refs, so Vue reactivity (assuming the array is a `ref`/`reactive`)
 * will pick them up.
 */
export function buildPartsCallbacks(opts: {
  appendText: (chunk: string) => void
  startToolCall: (call: { id: string; name: string; input: unknown }) => void
  finishToolCall: (callId: string, result: { content: string; isError: boolean; structured?: unknown }) => void
  resetTextBuffer?: () => void
  onError?: (error: string) => void
  onDone?: (reason: string) => void
}): AgentRunCallbacks {
  return {
    onTextDelta: opts.appendText,
    onToolCall: opts.startToolCall,
    onToolResult: ({ callId, content, isError, structured }) =>
      opts.finishToolCall(callId, { content, isError, structured }),
    onTurnEnd: () => opts.resetTextBuffer?.(),
    onError: opts.onError,
    onDone: opts.onDone,
  }
}

// Re-export status type for callers that want to reason about ToolCallPart states.
export type { ToolCallStatus, ChatPart }
