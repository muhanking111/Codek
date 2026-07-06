import {
  registerAgentProvider,
  type AgentProvider,
  type AgentProviderChunk,
  type AgentProviderRequest,
} from "./agentProviders"

const STORAGE_KEY = "codek-claude-code-config"

export interface ClaudeCodeConfig {
  enabled: boolean
  executablePath: string
  workingDir: string
  extraArgs: string
}

const DEFAULT_CONFIG: ClaudeCodeConfig = {
  enabled: false,
  executablePath: "claude",
  workingDir: "",
  extraArgs: "",
}

export function loadClaudeCodeConfig(): ClaudeCodeConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_CONFIG }
    const parsed = JSON.parse(raw) as Partial<ClaudeCodeConfig>
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveClaudeCodeConfig(config: ClaudeCodeConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // storage unavailable
  }
}

interface ProcessApi {
  spawn(opts: {
    command: string
    args: string[]
    cwd?: string
  }): Promise<{ sessionId: string }>
  write(sessionId: string, data: string): Promise<void>
  onData(sessionId: string, cb: (chunk: string) => void): () => void
  kill(sessionId: string): Promise<void>
}

function getProcessApi(): ProcessApi | null {
  const codek = (globalThis as { codek?: { pty?: unknown } }).codek
  if (!codek || !codek.pty) return null
  const pty = codek.pty as {
    create: (opts: { shellType: string; cwd?: string; cols: number; rows: number; command?: string; args?: string[] }) => Promise<{ id: string }>
    write: (id: string, data: string) => Promise<void>
    dispose: (id: string) => Promise<void>
    onData: (cb: (payload: { id: string; data: string }) => void) => () => void
  }
  return {
    async spawn(opts) {
      const res = await pty.create({
        shellType: "custom",
        cwd: opts.cwd,
        cols: 120,
        rows: 30,
        command: opts.command,
        args: opts.args,
      })
      return { sessionId: res.id }
    },
    async write(sessionId, data) {
      await pty.write(sessionId, data)
    },
    onData(sessionId, cb) {
      return pty.onData((payload) => {
        if (payload.id === sessionId) cb(payload.data)
      })
    },
    async kill(sessionId) {
      await pty.dispose(sessionId)
    },
  }
}

async function* claudeCodeSend(request: AgentProviderRequest): AsyncIterable<AgentProviderChunk> {
  const config = loadClaudeCodeConfig()
  if (!config.enabled) {
    yield { type: "error", error: "Claude Code 集成未开启（设置 → 智能模型 → Claude Code）" }
    return
  }
  const api = getProcessApi()
  if (!api) {
    yield { type: "error", error: "无法访问本地进程 API" }
    return
  }
  const args = config.extraArgs.trim() ? config.extraArgs.trim().split(/\s+/) : []
  let sessionId: string
  try {
    const result = await api.spawn({
      command: config.executablePath || "claude",
      args: ["-p", request.message, ...args],
      cwd: config.workingDir || undefined,
    })
    sessionId = result.sessionId
  } catch (err) {
    yield { type: "error", error: `启动 Claude Code 失败: ${err instanceof Error ? err.message : String(err)}` }
    return
  }

  const buffer: string[] = []
  let done = false
  let resolveWait: (() => void) | null = null

  const unsub = api.onData(sessionId, (chunk) => {
    buffer.push(chunk)
    if (resolveWait) {
      resolveWait()
      resolveWait = null
    }
  })

  if (request.signal) {
    request.signal.addEventListener("abort", () => {
      void api.kill(sessionId)
      done = true
      if (resolveWait) resolveWait()
    })
  }

  try {
    while (!done) {
      if (buffer.length === 0) {
        await new Promise<void>((resolve) => { resolveWait = resolve })
        continue
      }
      yield { type: "text", content: buffer.shift() ?? "" }
    }
  } finally {
    unsub()
  }
  yield { type: "done" }
}

export function registerClaudeCodeProvider(): () => void {
  const provider: AgentProvider = {
    id: "claude-code",
    label: "Claude Code",
    description: "通过本地 Claude Code CLI 调用 Anthropic 官方 agent",
    source: "builtin",
    send: claudeCodeSend,
  }
  return registerAgentProvider(provider)
}
