import { chatStream, readUnifiedStream } from "../ai/llmClient"
import { getActiveProvider, getActiveModel } from "../ai/aiProviders"
import { getTool, getToolsForMode, buildToolContext } from "./tools.ts"
import type { AgentMode, ToolContext, ToolDefinition } from "./tools.ts"
import { buildMemoryContextAsync, rememberError, rememberSuccess } from "./agentMemory"
import { emitAgentEvent } from "./agentEvents"
import { emitAgentLifecycleEvent } from "./agentLifecycle"
import { getPolicyForMode, checkCommand, checkCode } from "./sandboxPolicy"
import { recordFeedback, optimizePrompt } from "./promptOptimizer"
import { executeWithRetry } from "./agentVerify"
import { diagnoseError } from "./diagnostics"
import { getAgentSpec } from "./agents/registry"
import { decideAgentExecutionStrategy } from "./executionStrategy"
import {
  SYSTEM_PROMPT,
  PLAN_MODE_PROMPT,
  ASK_MODE_PROMPT,
  AGENT_MODE_PROMPT,
  AUTO_MODE_PROMPT,
} from "./prompts.js"

export type PermissionLevel = "all" | "safe" | null

interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

interface ToolUseInfo {
  name: string
  arguments?: Record<string, unknown>
  status: "running" | "done" | "error"
  result?: string
  error?: string
}

interface ParsedToolCall {
  name: string
  arguments: Record<string, unknown>
}

export interface AgentOptions {
  model?: string
  projectRoot?: string | null
  contextProvider?: (query: string) => Promise<string | null>
  onMessage?: (msg: { role: string; content: string }) => void
  onStream?: (content: string) => void
  onToolUse?: (info: ToolUseInfo) => void
  onError?: (error: string) => void
  onDone?: (result?: string) => void
  onDangerConfirm?: (description: string) => Promise<boolean>
  onProgress?: (message: string) => void
  onSuggestModeSwitch?: (targetMode: AgentMode) => void
}

function formatApprovalDesc(name: string, args: Record<string, unknown>): string {
  if (name === "run_command") {
    return `执行命令: ${args.command || "(无)"}`
  }
  if (["write_file", "edit_file", "patch_file", "delete_file"].includes(name)) {
    return `操作文件: ${args.path || "(无)"}
操作: ${name}`
  }
  return `执行: ${name}(${JSON.stringify(args).slice(0, 200)})`
}

function stringifyToolResult(result: unknown): string {
  if (typeof result === "string") return result
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}

const MAX_ITERATIONS = 20
const MAX_CONTEXT_TOKENS = 8000
const CHARS_PER_TOKEN = 3.2
const CODE_INTENT_RE = /(写|创建|修改|删除|重构|修复|实现|增加|添加|重构|重构|建|做个|开发|写一个|创建一个|实现一个|帮我写|帮我创建|帮我修改|帮我修复|帮我实现|帮我重构|帮我删除)/

export class Agent {
  private model: string
  private projectRoot: string
  private mode: AgentMode = "plan"
  private permissionLevel: PermissionLevel = null
  private conversation: ChatMessage[] = []
  private contextProvider: AgentOptions["contextProvider"]
  private onMessage: AgentOptions["onMessage"]
  private onStream: AgentOptions["onStream"]
  private onToolUse: AgentOptions["onToolUse"]
  private onError: AgentOptions["onError"]
  private onDone: AgentOptions["onDone"]
  private onDangerConfirm: AgentOptions["onDangerConfirm"]
  private onProgress: AgentOptions["onProgress"]
  private onSuggestModeSwitch: AgentOptions["onSuggestModeSwitch"]
  private toolContext: ToolContext | null = null
  private _subAgentPlan: string | null = null
  /** Files changed in the current send() cycle, for multi-file tracking. */
  private _changedFiles: Set<string> = new Set()

  constructor(options: AgentOptions = {}) {
    this.model = options.model || getActiveModel()
    this.projectRoot = options.projectRoot || ""
    this.contextProvider = options.contextProvider
    this.onMessage = options.onMessage
    this.onStream = options.onStream
    this.onToolUse = options.onToolUse
    this.onError = options.onError
    this.onDone = options.onDone
    this.onDangerConfirm = options.onDangerConfirm
    this.onProgress = options.onProgress
    this.onSuggestModeSwitch = options.onSuggestModeSwitch
    this.rebuildToolContext()
  }

  setProjectRoot(root: string): void {
    this.projectRoot = root
    this.rebuildToolContext()
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
  }

  loadConversation(messages: ChatMessage[]): void {
    this.conversation = Array.isArray(messages) ? messages.map((m) => ({ ...m })) : []
  }

  getConversation(): ChatMessage[] {
    return this.conversation
  }

  private rebuildToolContext(): void {
    if (this.projectRoot) {
      this.toolContext = buildToolContext(this.projectRoot)
    }
  }

  async send(userMessage: string): Promise<string | void> {
    this.conversation.push({ role: "user", content: userMessage })
    this._changedFiles.clear()

    // Ask mode: single-turn Q&A, no tool execution.
    if (this.mode === "ask") {
      const hasIntent = CODE_INTENT_RE.test(userMessage)
      const response = await this.callModel(userMessage)
      this.onMessage?.({ role: "assistant", content: response })
      this.onDone?.(response)
      // Show mode-switch dialog when user intent is detected
      if (hasIntent && this.onSuggestModeSwitch) {
        this.onSuggestModeSwitch("agent")
      }
      return response
    }

    let iterationsLeft = MAX_ITERATIONS
    let lastResponse = ""
    let totalCalls = 0
    let parseFailures = 0
    let toolFailures = 0
    const errorSamples: string[] = []
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const strategy = decideAgentExecutionStrategy({
      visibleMode: this.mode,
      text: userMessage,
    })
    if (strategy.executionStrategy !== "none") {
      const label = strategy.executionStrategy === "multi-agent" ? "多智能体" : "单智能体"
      this.onProgress?.(`智能体路由：本次任务选择 ${label} 执行 - ${strategy.reason}`)
    }

    // Auto mode: call planner sub-agent for structured plan before execution
    if (this.mode === "auto") {
      try {
        const plannerSpec = getAgentSpec("planner")
        if (plannerSpec) {
          this.onProgress?.("规划智能体：分析需求中...")
          const planResult = await this.callSubAgent(plannerSpec.systemPrompt, `用户需求: ${userMessage}\n\n请分析需求并产出 2-3 个方案。`)
          if (planResult) {
            this._subAgentPlan = planResult
            this.onProgress?.("✅ 规划完成,开始执行")
          }
        }
      } catch {
        this.onProgress?.("规划 Agent 调用失败,直接执行")
      }
    }

    while (iterationsLeft-- > 0) {
      const response = await this.callModel(userMessage)
      lastResponse = response
      totalCalls++

      const { toolCalls, parseErrors } = this.parseToolBlocks(response)
      parseFailures += parseErrors
      if (toolCalls.length === 0) {
        this.onMessage?.({ role: "assistant", content: response })
        this.onDone?.(response)
        recordFeedback({
          taskId,
          promptVersion: `mode-${this.mode}`,
          totalCalls,
          parseFailures,
          toolFailures,
          retries: 0,
          success: true,
          timestamp: Date.now(),
          errorSamples,
        })
        return response
      }

      // Parallelize independent tool calls
      const readOnlyNames = new Set(["read_file", "read_dir", "search_code", "get_code_context"])
      const independentCalls = toolCalls.filter((tc) => readOnlyNames.has(tc.name))
      const dependentCalls = toolCalls.filter((tc) => !readOnlyNames.has(tc.name))

      // Run independent (read-only) calls in parallel
      if (independentCalls.length > 0) {
        const results = await Promise.allSettled(
          independentCalls.map(async (toolCall) => {
            const result = await this.executeTool(toolCall)
            const resultStr = typeof result === "string" ? result : JSON.stringify(result)
            if (result && typeof result === "object" && "error" in (result as Record<string, unknown>)) {
              toolFailures++
              errorSamples.push(String((result as { error: unknown }).error))
            }
            this.conversation.push({
              role: "assistant",
              content: `Tool ${toolCall.name} returned:\n${resultStr}`,
            })
          }),
        )
        // Log any parallel failures
        for (const result of results) {
          if (result.status === "rejected") {
            toolFailures++
            errorSamples.push(String(result.reason))
          }
        }
      }

      // Run dependent (write) calls sequentially
      for (const toolCall of dependentCalls) {
        const result = await this.executeTool(toolCall)
        const resultStr = typeof result === "string" ? result : JSON.stringify(result)

        if (result && typeof result === "object" && "error" in (result as Record<string, unknown>)) {
          toolFailures++
          errorSamples.push(String((result as { error: unknown }).error))
        }

        this.conversation.push({
          role: "assistant",
          content: `Tool ${toolCall.name} returned:\n${resultStr}`,
        })
      }
    }

    // Multi-file editing summary
    if (this._changedFiles.size > 1) {
      const fileList = Array.from(this._changedFiles).join(", ")
      this.onProgress?.(`📝 修改了 ${this._changedFiles.size} 个文件: ${fileList}`)
      this.conversation.push({
        role: "assistant",
        content: `[共修改 ${this._changedFiles.size} 个文件: ${fileList}]`,
      })
    }

    // Auto mode: post-execution review (advisory, won't block)
    if (this.mode === "auto") {
      try {
        const reviewerSpec = getAgentSpec("reviewer")
        if (reviewerSpec && lastResponse) {
          this.onProgress?.("🔍 审查 Agent: 检查代码质量中...")
          const reviewResult = await this.callSubAgent(
            reviewerSpec.systemPrompt,
            `原始需求: ${userMessage}\n\n执行结果: ${lastResponse.slice(0, 2000)}`,
          )
          if (reviewResult && reviewResult.includes('"approved": false')) {
            this.onProgress?.("⚠️ 审查发现问题,将在下次对话中修复")
            // Append review to conversation so next turn sees it
            this.conversation.push({ role: "assistant", content: `审查反馈:\n${reviewResult.slice(0, 1000)}` })
          } else {
            this.onProgress?.("✅ 审查通过")
          }
        }
      } catch {
        // Review is advisory, don't block on failure
      }
    }

    this.onMessage?.({ role: "assistant", content: lastResponse })
    this.onDone?.(lastResponse)
    recordFeedback({
      taskId,
      promptVersion: `mode-${this.mode}`,
      totalCalls,
      parseFailures,
      toolFailures,
      retries: 0,
      success: toolFailures === 0,
      timestamp: Date.now(),
      errorSamples,
    })
    return lastResponse
  }

  private async callModel(userMessage: string): Promise<string> {
    const systemMessages = await this.buildSystemMessages()
    const dynamicContext = this.contextProvider ? await this.contextProvider(userMessage) : null

    const messages: ChatMessage[] = [
      ...systemMessages,
    ]

    if (dynamicContext) {
      messages.push({ role: "system", content: dynamicContext })
    }

    this.trimConversation(messages)
    messages.push(...this.conversation)

    const provider = getActiveProvider()
    const response = await chatStream({
      provider,
      model: getActiveModel(),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    })

    if (!response.ok || !response.body) {
      const errMsg = `LLM request failed with status ${response.status}`
      this.onError?.(errMsg)
      throw new Error(errMsg)
    }

    let fullContent = ""
    let streamCounter = 0
    await readUnifiedStream(response.body, (content) => {
      fullContent = content
      streamCounter++
      if (streamCounter % 4 === 0) {
        this.onStream?.(fullContent)
      }
    })

    this.onStream?.(fullContent)
    this.conversation.push({ role: "assistant", content: fullContent })

    return fullContent
  }

  private async buildSystemMessages(): Promise<ChatMessage[]> {
    const lastUser = this.conversation[this.conversation.length - 1]?.content || ""
    const messages: ChatMessage[] = [{ role: "system", content: optimizePrompt(SYSTEM_PROMPT, lastUser) }]

    const modePrompt =
      this.mode === "ask" ? ASK_MODE_PROMPT
      : this.mode === "plan" ? PLAN_MODE_PROMPT
      : this.mode === "agent" ? AGENT_MODE_PROMPT
      : AUTO_MODE_PROMPT

    messages.push({ role: "system", content: modePrompt })

    const tools = getToolsForMode(this.mode)
    const toolList = tools.map((t: ToolDefinition) => `- ${t.name}: ${t.description} [risk: ${t.risk}]`).join("\n")
    messages.push({ role: "system", content: `Available tools:\n${toolList}` })

    const memoryCtx = await buildMemoryContextAsync(this.conversation[this.conversation.length - 1]?.content || "", {
      workspaceRoot: this.projectRoot,
    })
    if (memoryCtx) {
      messages.push({ role: "system", content: memoryCtx })
    }

    // AGENTS.md support: read and inject as project rules
    if (this.projectRoot) {
      try {
        const codekApi = (typeof window !== "undefined" ? window.codek : null) as { readFile?: (p: string) => Promise<string> } | null
        if (codekApi?.readFile) {
          const content = await codekApi.readFile(this.projectRoot + "/AGENTS.md")
          if (content && content.trim()) {
            messages.push({ role: "system", content: `AGENTS.md (project rules):\n${content.slice(0, 4000)}` })
          }
        }
      } catch {
        // File not found or not readable — non-critical
      }
    }

    // Inject sub-agent plan for auto mode
    if (this._subAgentPlan) {
      messages.push({ role: "system", content: `规划 Agent 的分析结果:\n${this._subAgentPlan}` })
    }

    return messages
  }

  private trimConversation(systemMessages: ChatMessage[]): void {
    const systemTokens = systemMessages.reduce((sum, m) => sum + m.content.length / CHARS_PER_TOKEN, 0)
    const budget = MAX_CONTEXT_TOKENS - systemTokens

    let total = 0
    let cutIndex = 0
    for (let i = this.conversation.length - 1; i >= 0; i--) {
      total += this.conversation[i].content.length / CHARS_PER_TOKEN
      if (total > budget) {
        cutIndex = i + 1
        break
      }
    }

    if (cutIndex > 0) {
      const trimmed = this.conversation.slice(0, cutIndex)
      this.conversation = this.conversation.slice(cutIndex)

      // Auto context compression: summarize trimmed portion if it's large enough
      if (trimmed.length >= 4) {
        const compressKey = "codek:compress"
        try {
          const keyContent = trimmed.map((m) => `${m.role}: ${m.content.slice(0, 200)}`).join("\n")
          sessionStorage.setItem(compressKey, keyContent.slice(0, 2000))
          this.conversation.unshift({
            role: "system",
            content: `[对话摘要] 以下是已裁剪的早期对话关键信息:\n${keyContent.slice(0, 1500)}`,
          })
        } catch {
          // compression failure is non-critical, just trim
        }
      }
    }
  }

  private parseToolBlocks(response: string): { toolCalls: ParsedToolCall[]; parseErrors: number } {
    const toolCalls: ParsedToolCall[] = []
    let parseErrors = 0
    const regex = /```tool\s*([\s\S]*?)```/g
    let match: RegExpExecArray | null

    while ((match = regex.exec(response)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim())
        const name = parsed.name || parsed.tool
        const args = parsed.arguments || parsed.args || {}
        if (name && getTool(name)) {
          toolCalls.push({ name, arguments: args })
        } else {
          parseErrors++
        }
      } catch {
        parseErrors++
      }
    }

    return { toolCalls, parseErrors }
  }

  private async executeTool(toolCall: ParsedToolCall): Promise<unknown> {
    const tool = getTool(toolCall.name)
    if (!tool) {
      return { error: `Unknown tool: ${toolCall.name}` }
    }

    const writeTools = new Set(["write_file", "edit_file", "patch_file", "delete_file", "run_command", "git_commit"])
    if (this.mode === "plan" && writeTools.has(toolCall.name)) {
      return { error: `Tool ${toolCall.name} is not available in plan mode.` }
    }

    const policyResult = this.applySandboxPolicy(toolCall)
    if (!policyResult.allowed) {
      return { error: `Blocked by sandbox policy: ${policyResult.reason}` }
    }
    if (policyResult.routeTo && toolCall.name === "execute_code") {
      toolCall.arguments = { ...toolCall.arguments, route: policyResult.routeTo }
    }
    if (policyResult.requireApproval) {
      const approved = await this.onDangerConfirm?.(
        `Auto sandbox policy requires approval for: ${toolCall.name}(${JSON.stringify(toolCall.arguments).slice(0, 200)})`
      )
      if (!approved) {
        return { error: "Operation rejected by user." }
      }
    }

    if (this.needsApproval(tool)) {
      const approved = await this.onDangerConfirm?.(
        formatApprovalDesc(toolCall.name, toolCall.arguments)
      )
      if (!approved) {
        return { error: "Operation rejected by user." }
      }
    }

    this.onToolUse?.({
      name: toolCall.name,
      arguments: toolCall.arguments,
      status: "running",
    })
    void emitAgentLifecycleEvent({
      type: "tool:before",
      goal: this.lastUserMessage(),
      workspaceRoot: this.projectRoot,
      agentRole: this.mode === "plan" ? "planner" : "coder",
      payload: {
        tool: toolCall.name,
        args: toolCall.arguments,
      },
    })

    try {
      const context = this.toolContext || buildToolContext(this.projectRoot)
      // Wrap execution with auto-retry (max 3 attempts, exponential backoff)
      const result = await executeWithRetry(
        () => tool.execute(toolCall.arguments, context),
        undefined,
        (attempt, error) => {
          this.onProgress?.(`${toolCall.name} 失败,自动重试 (${attempt}/3): ${error.message.slice(0, 80)}`)
        },
      )

      this.onToolUse?.({
        name: toolCall.name,
        status: "done",
        result: stringifyToolResult(result).slice(0, 1500),
      })

      this.emitToolEvent(toolCall)
      void emitAgentLifecycleEvent({
        type: "tool:after",
        goal: this.lastUserMessage(),
        workspaceRoot: this.projectRoot,
        agentRole: this.mode === "plan" ? "planner" : "coder",
        payload: {
          tool: toolCall.name,
          command: typeof toolCall.arguments.command === "string" ? toolCall.arguments.command : undefined,
          path: typeof toolCall.arguments.path === "string" ? toolCall.arguments.path : undefined,
          output: stringifyToolResult(result),
        },
      })
      rememberSuccess(`Tool ${toolCall.name} succeeded`, { tool: toolCall.name })

      // Track changed files for multi-file editing summary
      const writeToolNames = new Set(["write_file", "edit_file", "patch_file", "delete_file"])
      if (writeToolNames.has(toolCall.name) && toolCall.arguments?.path) {
        this._changedFiles.add(String(toolCall.arguments.path))
      }

      return result
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.onToolUse?.({
        name: toolCall.name,
        status: "error",
        error: errorMsg,
      })
      // Diagnose the error for better error messages
      const diagnosis = diagnoseError(errorMsg)
      if (diagnosis) {
        this.onProgress?.(`诊断: ${diagnosis.summary} — ${diagnosis.suggestedActions[0] || ""}`)
      }
      void emitAgentLifecycleEvent({
        type: "step:error",
        goal: this.lastUserMessage(),
        workspaceRoot: this.projectRoot,
        agentRole: this.mode === "plan" ? "planner" : "coder",
        payload: {
          tool: toolCall.name,
          command: typeof toolCall.arguments.command === "string" ? toolCall.arguments.command : undefined,
          path: typeof toolCall.arguments.path === "string" ? toolCall.arguments.path : undefined,
          error: errorMsg,
        },
      })
      rememberError(`Tool ${toolCall.name} failed: ${errorMsg}`, { tool: toolCall.name })
      return { error: errorMsg }
    }
  }

  private applySandboxPolicy(toolCall: ParsedToolCall): { allowed: boolean; reason?: string; requireApproval?: boolean; routeTo?: string } {
    const policy = getPolicyForMode(this.mode)
    if (toolCall.name === "run_command") {
      const cmd = typeof toolCall.arguments.command === "string" ? toolCall.arguments.command : ""
      return checkCommand(cmd, policy)
    }
    if (toolCall.name === "execute_code") {
      const language = typeof toolCall.arguments.language === "string" ? toolCall.arguments.language : ""
      const code = typeof toolCall.arguments.code === "string" ? toolCall.arguments.code : ""
      return checkCode(language, code, policy)
    }
    return { allowed: true }
  }

  private needsApproval(tool: ToolDefinition): boolean {
    if (this.mode === "auto" && this.permissionLevel === "all") return false
    if (this.mode === "auto" && this.permissionLevel === "safe") {
      return tool.risk === "high"
    }
    if (this.mode === "agent") {
      return tool.risk === "high"
    }
    return false
  }

  private lastUserMessage(): string {
    for (let index = this.conversation.length - 1; index >= 0; index--) {
      const message = this.conversation[index]
      if (message.role === "user") return message.content
    }
    return ""
  }

  /** Call a sub-agent with a custom system prompt, returns text response. */
  private async callSubAgent(systemPrompt: string, userContext: string): Promise<string> {
    const provider = getActiveProvider()
    const response = await chatStream({
      provider,
      model: getActiveModel(),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContext },
      ],
      stream: false,
    })
    if (!response.ok) return ""
    const text = await response.text()
    return text || ""
  }

  private emitToolEvent(toolCall: ParsedToolCall): void {
    const writeTools = new Set(["write_file", "edit_file", "patch_file", "delete_file"])
    const gitTools = new Set(["git_commit"])

    if (toolCall.name === "patch_file") {
      emitAgentEvent({ type: "diff-available", payload: { tool: toolCall.name, args: toolCall.arguments } })
    } else if (writeTools.has(toolCall.name)) {
      emitAgentEvent({ type: "file-changed", payload: { tool: toolCall.name, args: toolCall.arguments } })
    } else if (gitTools.has(toolCall.name)) {
      emitAgentEvent({ type: "git-operation", payload: { tool: toolCall.name, args: toolCall.arguments } })
    } else if (toolCall.name === "run_command") {
      emitAgentEvent({ type: "command-executed", payload: { command: toolCall.arguments.command } })
    }
  }
}
