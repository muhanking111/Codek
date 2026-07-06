import { getActiveProvider, getActiveModel } from '../ai/aiProviders'
import { chatStream, readUnifiedStream } from '../ai/llmClient'
import { buildMemoryContextAsync, rememberError, rememberSuccess } from './agentMemory'
import { executeWithRetry, buildRetryPrompt } from './agentVerify'
import { emitAgentEvent } from './agentEvents'
import { emitAgentLifecycleEvent } from './agentLifecycle'

export type AgentMode = 'autonomous' | 'supervised'
export type OperationRisk = 'safe' | 'medium' | 'high'

export interface AgentTask {
  id: string
  description: string
  status: 'pending' | 'running' | 'blocked' | 'completed' | 'failed'
  result?: unknown
  error?: string
  requiresApproval?: boolean
  approvalReason?: string
}

export interface AgentOperation {
  id: string
  type: 'read' | 'write' | 'execute' | 'delete' | 'network'
  target: string
  risk: OperationRisk
  description: string
  approved?: boolean
  result?: unknown
}

export interface AgentState {
  mode: AgentMode
  goal: string
  tasks: AgentTask[]
  currentTaskIndex: number
  operations: AgentOperation[]
  pendingApprovals: AgentOperation[]
  context: Map<string, unknown>
  sandboxActive: boolean
}

const SYSTEM_PROMPT = `You are an autonomous coding agent. IMPORTANT: Always respond in 简体中文 (Chinese) unless the user explicitly asks you to use another language. Your goal is to complete user requests by:
1. Breaking down the goal into concrete tasks
2. Executing each task using available tools
3. Verifying results and fixing errors
4. Delivering working code to the user

Rules:
- Always think step-by-step
- Test your changes before declaring success
- Ask for approval before HIGH-RISK operations (delete, network, system commands)
- If stuck after 3 attempts, ask the user for guidance
- Output EXACTLY ONE tool call per response
- Wait for the tool result before deciding your next action
- When the task is complete, output:

\`\`\`done
{ "summary": "what was accomplished" }
\`\`\`

Tool call format:
\`\`\`tool
{
  "name": "tool_name",
  "arguments": { ... },
  "risk": "safe|medium|high"
}
\`\`\`

Available tools:
- read_file: Read file content (args: path)
- write_file: Create/modify files (args: path, content)
- execute_code: Run code in sandbox (args: language, code)
- run_tests: Execute test suite (args: command, language)
- search_code: Search codebase (args: query, filePattern)
- git_commit: Commit changes (args: message, files)
- delete_file: Delete files - HIGH-RISK (args: path)
- run_command: Execute shell command - HIGH-RISK (args: command)
- network_request: Make HTTP requests - MEDIUM-RISK (args: url, method, body)`

const MAX_ITERATIONS = 15

export class AutonomousAgent {
  private state: AgentState
  private onStateChange: (state: AgentState) => void
  private onApprovalRequest: (op: AgentOperation) => Promise<boolean>
  private onProgress: (message: string) => void
  private running = false

  constructor(options: {
    mode?: AgentMode
    onStateChange?: (state: AgentState) => void
    onApprovalRequest?: (op: AgentOperation) => Promise<boolean>
    onProgress?: (message: string) => void
  }) {
    this.state = {
      mode: options.mode || 'supervised',
      goal: '',
      tasks: [],
      currentTaskIndex: 0,
      operations: [],
      pendingApprovals: [],
      context: new Map(),
      sandboxActive: false,
    }
    this.onStateChange = options.onStateChange || (() => {})
    this.onApprovalRequest = options.onApprovalRequest || (() => Promise.resolve(false))
    this.onProgress = options.onProgress || (() => {})
  }

  async start(goal: string): Promise<void> {
    if (this.running) throw new Error('Agent already running')

    this.running = true
    this.state.goal = goal
    this.state.tasks = []
    this.state.currentTaskIndex = 0
    this.state.operations = []
    this.state.pendingApprovals = []
    this.notifyStateChange()

    this.onProgress(`Goal: ${goal}`)
    this.onProgress('Planning tasks...')
    void emitAgentLifecycleEvent({
      type: 'session:start',
      goal,
      workspaceRoot: this.state.context.get('projectRoot') as string | undefined,
      agentRole: 'planner',
      payload: { mode: this.state.mode },
    })

    try {
      await this.planTasks()
      await this.executeTasks()
      this.onProgress('Goal completed!')
      void emitAgentLifecycleEvent({
        type: 'run:done',
        goal,
        workspaceRoot: this.state.context.get('projectRoot') as string | undefined,
        agentRole: 'release',
        payload: { taskCount: this.state.tasks.length },
      })
      rememberSuccess(`Completed: ${goal}`, { goal })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.onProgress(`Error: ${msg}`)
      void emitAgentLifecycleEvent({
        type: 'run:error',
        goal,
        workspaceRoot: this.state.context.get('projectRoot') as string | undefined,
        agentRole: 'coder',
        payload: { error: msg },
      })
      rememberError(msg, { goal })
      throw error
    } finally {
      this.running = false
    }
  }

  stop(): void {
    this.running = false
    this.onProgress('Agent stopped by user')
  }

  private async planTasks(): Promise<void> {
    const memoryContext = await buildMemoryContextAsync(this.state.goal, {
      workspaceRoot: this.state.context.get('projectRoot') as string | undefined,
    })
    const systemPrompt = memoryContext
      ? `${SYSTEM_PROMPT}\n\n## Relevant Context from Past Sessions:\n${memoryContext}`
      : SYSTEM_PROMPT

    const response = await chatStream({
      provider: getActiveProvider(),
      model: getActiveModel(),
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Break down this goal into 3-7 concrete tasks:\n\n${this.state.goal}\n\nOutput ONLY a JSON array of task objects with fields: description, estimatedRisk (safe/medium/high)`,
        },
      ],
      stream: true,
    })

    if (!response.ok || !response.body) {
      throw new Error('Failed to plan tasks')
    }

    let fullContent = ''
    await readUnifiedStream(response.body, (content) => {
      fullContent = content
    })

    const jsonMatch = fullContent.match(/\[\s*\{[\s\S]*\}\s*\]/)
    if (!jsonMatch) {
      throw new Error('Failed to parse task plan')
    }

    const tasks = JSON.parse(jsonMatch[0])
    this.state.tasks = tasks.map((t: { description: string; estimatedRisk?: string }, idx: number) => ({
      id: `task-${idx}`,
      description: t.description,
      status: 'pending' as const,
      requiresApproval: t.estimatedRisk === 'high',
    }))

    this.notifyStateChange()
    this.onProgress(`Planned ${this.state.tasks.length} tasks`)
    void emitAgentLifecycleEvent({
      type: 'plan:created',
      goal: this.state.goal,
      workspaceRoot: this.state.context.get('projectRoot') as string | undefined,
      agentRole: 'planner',
      payload: {
        taskCount: this.state.tasks.length,
        tasks: this.state.tasks.map((task) => task.description),
      },
    })
  }

  private async executeTasks(): Promise<void> {
    for (let i = 0; i < this.state.tasks.length; i++) {
      if (!this.running) break

      this.state.currentTaskIndex = i
      const task = this.state.tasks[i]
      task.status = 'running'
      this.notifyStateChange()

      this.onProgress(`\nTask ${i + 1}/${this.state.tasks.length}: ${task.description}`)
      void emitAgentLifecycleEvent({
        type: 'step:start',
        goal: this.state.goal,
        stepId: task.id,
        workspaceRoot: this.state.context.get('projectRoot') as string | undefined,
        agentRole: 'coder',
        payload: { description: task.description },
      })

      try {
        await executeWithRetry(
          async () => {
            await this.executeTask(task)
          },
          {
            maxAttempts: 3,
            backoffMs: 1000,
            shouldRetry: (error) => !error.message.includes('rejected by user'),
          },
          (attempt, error) => {
            task.error = error.message
            this.onProgress(`Attempt ${attempt} failed: ${error.message}`)
            this.onProgress(`Retrying with adjusted approach...`)
            rememberError(error.message, { goal: this.state.goal, task: task.description })
          },
        )
        task.status = 'completed'
        task.error = undefined
        this.onProgress(`Completed`)
        void emitAgentLifecycleEvent({
          type: 'step:done',
          goal: this.state.goal,
          stepId: task.id,
          workspaceRoot: this.state.context.get('projectRoot') as string | undefined,
          agentRole: 'coder',
          payload: { description: task.description },
        })
        rememberSuccess(task.description, { goal: this.state.goal })
      } catch (error) {
        task.status = 'failed'
        task.error = error instanceof Error ? error.message : String(error)
        this.onProgress(`Failed after retries: ${task.error}`)
        void emitAgentLifecycleEvent({
          type: 'step:error',
          goal: this.state.goal,
          stepId: task.id,
          workspaceRoot: this.state.context.get('projectRoot') as string | undefined,
          agentRole: 'coder',
          payload: { description: task.description, error: task.error },
        })

        if (i < this.state.tasks.length - 1) {
          this.onProgress('Continuing with next task...')
        }
      }

      this.notifyStateChange()
    }
  }

  private async executeTask(task: AgentTask): Promise<void> {
    const memoryContext = await buildMemoryContextAsync(task.description, {
      workspaceRoot: this.state.context.get('projectRoot') as string | undefined,
      agentRole: 'coder',
    })
    const systemPrompt = memoryContext
      ? `${SYSTEM_PROMPT}\n\n## Context:\n${memoryContext}`
      : SYSTEM_PROMPT

    const retryContext = task.error
      ? buildRetryPrompt(task, task.error, 1)
      : ''

    const conversationHistory: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Execute this task: ${task.description}${retryContext ? '\n\n' + retryContext : ''}\n\nProject context: ${JSON.stringify(Object.fromEntries(this.state.context))}\n\nCall ONE tool at a time. After each tool result, decide your next action. When done, output \`\`\`done with a summary.`,
      },
    ]

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      if (!this.running) break

      const response = await chatStream({
        provider: getActiveProvider(),
        model: getActiveModel(),
        messages: conversationHistory,
        stream: true,
      })

      if (!response.ok || !response.body) {
        throw new Error('LLM request failed')
      }

      let fullContent = ''
      await readUnifiedStream(response.body, (content) => {
        fullContent = content
      })

      conversationHistory.push({ role: 'assistant', content: fullContent })

      if (fullContent.includes('```done')) {
        return
      }

      const toolCalls = this.extractToolCalls(fullContent)
      if (toolCalls.length === 0) {
        conversationHistory.push({
          role: 'user',
          content: 'No tool call detected. Either call a tool or signal completion with ```done.',
        })
        continue
      }

      const toolCall = toolCalls[0]
      try {
        await this.executeToolCall(toolCall)
        const result = this.state.context.get(`last_${toolCall.name}_result`)

        conversationHistory.push({
          role: 'user',
          content: `Tool "${toolCall.name}" result:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n\nDecide your next action or signal completion.`,
        })
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        if (errorMsg.includes('rejected by user')) {
          throw error
        }
        conversationHistory.push({
          role: 'user',
          content: `Tool "${toolCall.name}" FAILED: ${errorMsg}\n\nTry an alternative approach or signal completion if the task cannot proceed.`,
        })
      }
    }

    throw new Error(`Task exceeded maximum iterations (${MAX_ITERATIONS})`)
  }

  private extractToolCalls(content: string): Array<{ name: string; arguments: unknown; risk: OperationRisk }> {
    const calls: Array<{ name: string; arguments: unknown; risk: OperationRisk }> = []
    const regex = /```tool\s*([\s\S]*?)```/g
    let match

    while ((match = regex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim())
        calls.push({
          name: parsed.name,
          arguments: parsed.arguments || {},
          risk: parsed.risk || 'safe',
        })
      } catch {
        // ignore invalid tool calls
      }
    }

    return calls
  }

  private async executeToolCall(toolCall: {
    name: string
    arguments: unknown
    risk: OperationRisk
  }): Promise<void> {
    const operation: AgentOperation = {
      id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type: this.getOperationType(toolCall.name),
      target: JSON.stringify(toolCall.arguments),
      risk: toolCall.risk,
      description: `${toolCall.name}(${JSON.stringify(toolCall.arguments).slice(0, 50)}...)`,
      approved: toolCall.risk === 'safe',
    }

    this.state.operations.push(operation)

    if (toolCall.risk === 'high' || (toolCall.risk === 'medium' && this.state.mode === 'supervised')) {
      this.state.pendingApprovals.push(operation)
      this.notifyStateChange()

      this.onProgress(`Requesting approval: ${operation.description}`)
      const approved = await this.onApprovalRequest(operation)

      operation.approved = approved
      this.state.pendingApprovals = this.state.pendingApprovals.filter((op) => op.id !== operation.id)
      this.notifyStateChange()

      if (!approved) {
        throw new Error(`Operation rejected by user: ${operation.description}`)
      }
    }

    this.onProgress(`Executing: ${toolCall.name}`)
    void emitAgentLifecycleEvent({
      type: 'tool:before',
      goal: this.state.goal,
      workspaceRoot: this.state.context.get('projectRoot') as string | undefined,
      agentRole: 'coder',
      payload: { tool: toolCall.name, args: toolCall.arguments },
    })

    const tool = await import('./agentTools').then((m) => m.getTool(toolCall.name))
    if (!tool) {
      throw new Error(`Unknown tool: ${toolCall.name}`)
    }

    try {
      const context = this.buildToolContext()
      const result = await tool.execute(toolCall.arguments as Record<string, unknown>, context)
      const args = asRecord(toolCall.arguments)
      operation.result = result
      this.state.context.set(`last_${toolCall.name}_result`, result)
      this.onProgress(`${toolCall.name} completed`)
      void emitAgentLifecycleEvent({
        type: 'tool:after',
        goal: this.state.goal,
        workspaceRoot: this.state.context.get('projectRoot') as string | undefined,
        agentRole: 'coder',
        payload: {
          tool: toolCall.name,
          command: typeof args.command === 'string' ? args.command : undefined,
          result,
        },
      })
    } catch (error) {
      const args = asRecord(toolCall.arguments)
      operation.result = { error: error instanceof Error ? error.message : String(error) }
      this.onProgress(`${toolCall.name} failed: ${error instanceof Error ? error.message : String(error)}`)
      void emitAgentLifecycleEvent({
        type: 'step:error',
        goal: this.state.goal,
        workspaceRoot: this.state.context.get('projectRoot') as string | undefined,
        agentRole: 'coder',
        payload: {
          tool: toolCall.name,
          command: typeof args.command === 'string' ? args.command : undefined,
          error: error instanceof Error ? error.message : String(error),
        },
      })
      throw error
    }

    this.notifyStateChange()
  }

  private getOperationType(toolName: string): AgentOperation['type'] {
    if (toolName.includes('read')) return 'read'
    if (toolName.includes('write') || toolName.includes('create')) return 'write'
    if (toolName.includes('delete') || toolName.includes('remove')) return 'delete'
    if (toolName.includes('execute') || toolName.includes('run')) return 'execute'
    if (toolName.includes('network') || toolName.includes('http')) return 'network'
    return 'execute'
  }

  private notifyStateChange(): void {
    this.onStateChange({ ...this.state })
  }

  private buildToolContext(): import('./agentTools').ToolContext {
    return {
      projectRoot: this.state.context.get('projectRoot') as string | undefined,
      readFile: async (path: string) => {
        const response = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`)
        if (!response.ok) throw new Error(`Failed to read file: ${path}`)
        const data = await response.json()
        return data.content
      },
      writeFile: async (path: string, content: string) => {
        const response = await fetch('/api/files/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content }),
        })
        if (!response.ok) throw new Error(`Failed to write file: ${path}`)
        emitAgentEvent({ type: 'file-changed', payload: { path, action: 'write' } })
      },
      deleteFile: async (path: string) => {
        const response = await fetch('/api/files/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        })
        if (!response.ok) throw new Error(`Failed to delete file: ${path}`)
        emitAgentEvent({ type: 'file-changed', payload: { path, action: 'delete' } })
      },
      runCommand: async (command: string) => {
        const response = await fetch('/api/terminal/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command, projectRoot: this.state.context.get('projectRoot') }),
        })
        if (!response.ok) throw new Error(`Failed to run command: ${command}`)
        const result = await response.json()
        emitAgentEvent({ type: 'command-executed', payload: { command, ...result } })
        if (command.startsWith('git ')) {
          emitAgentEvent({ type: 'git-operation', payload: { command } })
        }
        return result
      },
      searchCode: async (query: string) => {
        const response = await fetch(`/api/search/code?q=${encodeURIComponent(query)}`)
        if (!response.ok) throw new Error(`Failed to search code: ${query}`)
        return response.json()
      },
    }
  }

  getState(): AgentState {
    return { ...this.state }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

