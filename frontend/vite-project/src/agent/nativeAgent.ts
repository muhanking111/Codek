/*---------------------------------------------------------------------------------------------
 *  NativeAgent — drop-in replacement for `Agent` when the active provider supports
 *  native function calling.
 *
 *  Maintains the same surface (send / reset / loadConversation / setMode / setModel /
 *  getConversation / abort) so it slots into the chat-session machinery unchanged,
 *  but delegates the actual model turn + tool dispatch to the main-process
 *  /agent/loop/run endpoint via runAgentLoop.
 *--------------------------------------------------------------------------------------------*/

import { runAgentLoop, runAgentPlan, abortAgentLoop } from "../ai/agentLoop"
import type { AgentEvent } from "../ai/agentLoop"
import { getActiveProvider, getActiveModel } from "../ai/aiProviders"
import type { AgentMode } from "./tools.ts"
import type { ChatPart, TextPart, ToolCallPart, ThinkingPart } from "../ai/chatTypes"
import { decideAgentExecutionStrategy } from "./executionStrategy"
import { requestMcpInputs } from "../ai/mcpInputPrompt"

export type PermissionLevel = "all" | "safe" | null

interface ToolUseInfo {
  name: string
  arguments?: Record<string, unknown>
  status: "running" | "done" | "error"
  result?: string
  error?: string
}

interface ChatTurn {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  tool_calls?: unknown
  tool_call_id?: string
}

export interface NativeAgentOptions {
  model?: string
  projectRoot?: string | null
  workspaceFile?: string | null
  contextProvider?: (query: string) => Promise<string | null>
  onMessage?: (msg: { role: string; content: string }) => void
  onStream?: (content: string) => void
  onToolUse?: (info: ToolUseInfo) => void
  onError?: (error: string) => void
  onDone?: (result?: string) => void
  /** Called on every parts mutation while the assistant turn streams. */
  onPartsUpdate?: (parts: ChatPart[]) => void
  /** Called once when the loop terminates with the final parts list. */
  onPartsComplete?: (parts: ChatPart[]) => void
  /** Called for PlanTree lifecycle events from /agent/loop/plan. */
  onPlanEvent?: (event: AgentEvent) => void
  onProgress?: (message: string) => void
}

export class NativeAgent {
  private model: string
  private projectRoot: string
  private workspaceFile: string
  private mode: AgentMode = "plan"
  private permissionLevel: PermissionLevel = null
  private conversation: ChatTurn[] = []
  private contextProvider: NativeAgentOptions["contextProvider"]
  private onMessage: NativeAgentOptions["onMessage"]
  private onStream: NativeAgentOptions["onStream"]
  private onToolUse: NativeAgentOptions["onToolUse"]
  private onError: NativeAgentOptions["onError"]
  private onDone: NativeAgentOptions["onDone"]
  private onPartsUpdate: NativeAgentOptions["onPartsUpdate"]
  private onPartsComplete: NativeAgentOptions["onPartsComplete"]
  private onPlanEvent: NativeAgentOptions["onPlanEvent"]
  private onProgress: NativeAgentOptions["onProgress"]
  private aborted = false
  private activeRequestId: string | null = null
  private toolCallNames = new Map<string, string>()
  private toolCallArgs = new Map<string, Record<string, unknown>>()

  constructor(options: NativeAgentOptions = {}) {
    this.model = options.model || getActiveModel()
    this.projectRoot = options.projectRoot || ""
    this.workspaceFile = options.workspaceFile || ""
    this.contextProvider = options.contextProvider
    this.onMessage = options.onMessage
    this.onStream = options.onStream
    this.onToolUse = options.onToolUse
    this.onError = options.onError
    this.onDone = options.onDone
    this.onPartsUpdate = options.onPartsUpdate
    this.onPartsComplete = options.onPartsComplete
    this.onPlanEvent = options.onPlanEvent
    this.onProgress = options.onProgress
  }

  setModel(model: string): void {
    this.model = model
  }

  setMode(mode: AgentMode, permissionLevel?: PermissionLevel): void {
    this.mode = mode
    this.permissionLevel = permissionLevel ?? null
  }

  reset(): void {
    this.conversation = []
    this.toolCallNames.clear()
    this.toolCallArgs.clear()
    this.aborted = false
  }

  abort(): void {
    this.aborted = true
    if (this.activeRequestId) {
      void abortAgentLoop(this.activeRequestId)
    }
  }

  loadConversation(messages: ChatTurn[]): void {
    this.conversation = Array.isArray(messages) ? messages.map((m) => ({ ...m })) : []
  }

  getConversation(): ChatTurn[] {
    return this.conversation
  }

  async send(userMessage: string): Promise<string | void> {
    if (!this.projectRoot) {
      this.onError?.("projectRoot is required for NativeAgent")
      return
    }
    this.aborted = false
    const provider = getActiveProvider()
    if (!provider) {
      this.onError?.("No active provider")
      return
    }

    let prelude = ""
    try {
      const ctx = await this.contextProvider?.(userMessage)
      if (ctx) prelude = ctx
    } catch {
      // ignore context provider errors
    }

    const userContent = prelude ? `${prelude}\n\n${userMessage}` : userMessage
    this.conversation.push({ role: "user", content: userContent })
    const strategy = decideAgentExecutionStrategy({
      visibleMode: this.mode,
      text: userMessage,
    })
    if (strategy.executionStrategy !== "none") {
      const label = strategy.executionStrategy === "multi-agent" ? "多智能体" : "单智能体"
      this.onProgress?.(`智能体路由：本次任务选择 ${label} 执行 - ${strategy.reason}`)
    }

    if (this.mode === "auto") {
      await this.sendWithPlanEndpoint(userMessage, prelude, provider)
      return
    }

    const parts: ChatPart[] = []
    let currentText: TextPart | null = null
    let currentThinking: ThinkingPart | null = null
    let textBuf = ""
    const usingParts = !!this.onPartsUpdate

    const emitParts = () => {
      if (!usingParts) return
      this.onPartsUpdate?.(parts.map((p) => ({ ...p })))
    }

    try {
      await runAgentLoop(
        {
          provider: provider.id,
          model: this.model || getActiveModel(),
          messages: this.conversation.map((m) => ({ ...m })),
          projectRoot: this.projectRoot,
          workspaceFile: this.workspaceFile || null,
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl,
        },
        {
          onStart: (requestId) => {
            this.activeRequestId = requestId
          },
          onTextDelta: (chunk) => {
            if (this.aborted) return
            textBuf += chunk
            if (usingParts) {
              if (currentThinking) {
                currentThinking.streaming = false
                currentThinking = null
              }
              if (!currentText) {
                currentText = { type: "text", text: "" }
                parts.push(currentText)
              }
              currentText.text += chunk
              emitParts()
            } else {
              this.onStream?.(textBuf)
            }
          },
          onThinkingDelta: (chunk) => {
            if (this.aborted || !usingParts) return
            if (!currentThinking) {
              currentText = null
              currentThinking = { type: "thinking", text: "", streaming: true }
              parts.push(currentThinking)
            }
            currentThinking.text += chunk
            emitParts()
          },
          onThinkingEnd: () => {
            if (!usingParts || !currentThinking) return
            currentThinking.streaming = false
            currentThinking = null
            emitParts()
          },
          onToolCall: ({ id, name, input }) => {
            if (this.aborted) return
            const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
            this.toolCallNames.set(id, name)
            this.toolCallArgs.set(id, args)
            if (usingParts) {
              currentText = null
              if (currentThinking) { currentThinking.streaming = false; currentThinking = null }
              const card: ToolCallPart = {
                type: "tool_call",
                id,
                name,
                input: args,
                status: "running",
              }
              parts.push(card)
              emitParts()
            } else {
              this.onToolUse?.({ name, arguments: args, status: "running" })
            }
          },
          onToolResult: ({ callId, content, isError, structured }) => {
            if (this.aborted) return
            if (isError) requestMcpInputs(structured)
            const name = this.toolCallNames.get(callId) || "tool"
            const args = this.toolCallArgs.get(callId)
            if (usingParts) {
              const tc = parts.find(
                (p) => p.type === "tool_call" && (p as ToolCallPart).id === callId,
              ) as ToolCallPart | undefined
              if (tc) {
                tc.status = isError ? "error" : "done"
                if (isError) tc.errorMessage = content
              }
              parts.push({
                type: "tool_result",
                callId,
                content,
                isError: !!isError,
                structured,
              })
              emitParts()
            } else {
              this.onToolUse?.({
                name,
                arguments: args,
                status: isError ? "error" : "done",
                result: isError ? undefined : content,
                error: isError ? content : undefined,
              })
            }
          },
          onTurnEnd: () => {
            // Future text deltas open a new TextPart.
            currentText = null
            if (currentThinking) { currentThinking.streaming = false; currentThinking = null }
          },
          onError: (err) => {
            this.onError?.(err)
          },
          onDone: () => {
            this.activeRequestId = null
            if (textBuf) {
              this.conversation.push({ role: "assistant", content: textBuf })
            }
            if (usingParts) {
              this.onPartsComplete?.(parts.map((p) => ({ ...p })))
            } else if (textBuf) {
              this.onMessage?.({ role: "assistant", content: textBuf })
            }
            this.onDone?.(textBuf)
          },
        },
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.onError?.(msg)
    } finally {
      this.activeRequestId = null
    }

    return textBuf
  }

  private async sendWithPlanEndpoint(
    userMessage: string,
    projectSummary: string,
    provider: ReturnType<typeof getActiveProvider>,
  ): Promise<void> {
    if (!provider) {
      this.onError?.("No active provider")
      return
    }

    try {
      await runAgentPlan(
        {
          provider: provider.id,
          model: this.model || getActiveModel(),
          userInput: userMessage,
          projectRoot: this.projectRoot,
          workspaceFile: this.workspaceFile || null,
          projectSummary,
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl,
        },
        {
          onStart: (requestId) => {
            this.activeRequestId = requestId
          },
          onPlanEvent: (event) => {
            this.onPlanEvent?.(event)
          },
          onError: (err) => {
            this.onError?.(err)
          },
          onDone: () => {
            this.activeRequestId = null
            this.conversation.push({
              role: "assistant",
              content: "PlanTree execution finished.",
            })
            this.onDone?.("PlanTree execution finished.")
          },
        },
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.onError?.(msg)
    } finally {
      this.activeRequestId = null
    }
  }
}
