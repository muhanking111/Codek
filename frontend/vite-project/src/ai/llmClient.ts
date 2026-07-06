import { getActiveProviderInfo, getActiveModel, getActiveType } from './aiProviders'
import type { AiProviderConfig, AiProviderType } from './aiProviders'
import { getCachedResponse, setCachedResponse } from './responseCache'

const FETCH_TIMEOUT_MS = 120_000

export type LlmTextContentPart = { type: "text"; text: string }
export type LlmImageUrlContentPart = { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" | string } }
export type LlmAnthropicImageContentPart = { type: "image"; source: { type: "base64"; media_type: string; data: string } }
export type LlmMessageContent = string | Array<LlmTextContentPart | LlmImageUrlContentPart | LlmAnthropicImageContentPart>

export interface LlmChatOptions {
  type?: AiProviderType
  provider?: AiProviderConfig
  model?: string
  messages: Array<{ role: string; content: LlmMessageContent }>
  temperature?: number
  topP?: number
  maxTokens?: number
  stream?: boolean
  apiKey?: string
  baseUrl?: string
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  source: "provider" | "estimated" | string
  provider: string
}

function makeRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

interface CodekIpc {
  api: (m: string, p: string, b?: unknown) => Promise<unknown>
  onLlmChunk?: (cb: (payload: { requestId: string; content?: string; done?: boolean; error?: string; usage?: LlmUsage }) => void) => () => void
}

/**
 * Starts an LLM stream via IPC. Returns a Response-shaped object whose body is
 * a ReadableStream that emits SSE-formatted `data: {...}\n\n` lines so existing
 * `readUnifiedStream` consumers keep working unchanged.
 */
export async function chatStream(options: LlmChatOptions): Promise<Response> {
  const legacyProvider = options.provider
  const info = legacyProvider || getActiveProviderInfo()
  const type = options.type || legacyProvider?.type || getActiveType()
  if (!info) {
    throw new Error("没有可用的模型供应商，请先在 设置 → 智能模型 中启用一个供应商")
  }
  // Clean model name: strip "claude-" prefix and ANSI escape artifacts
  const rawModel = options.model || getActiveModel()
  const model = rawModel.replace(/^claude-/i, "").replace(/\[[\d;]*m\]?/g, "").trim()
  const requestId = makeRequestId()

  const backendProvider =
    type === "claude" ? "anthropic" :
    type === "ollama" ? "ollama" : "openai"

  const body = {
    requestId,
    provider: backendProvider,
    model,
    messages: options.messages,
    temperature: options.temperature,
    topP: options.topP,
    maxTokens: options.maxTokens,
    stream: options.stream !== false,
    apiKey: options.apiKey || info.apiKey,
    baseUrl: options.baseUrl || info.baseUrl,
  }

  const codek = (window as unknown as { codek?: CodekIpc }).codek
  if (!codek || typeof codek.api !== 'function' || typeof codek.onLlmChunk !== 'function') {
    throw new Error('Codek IPC API not available')
  }

  let unsubscribe: (() => void) | null = null
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = codek.onLlmChunk!((payload) => {
        if (payload.requestId !== requestId) return
        const obj: Record<string, unknown> = {}
        if (payload.content) obj.content = payload.content
        if (payload.error) obj.error = payload.error
        if (payload.usage) obj.usage = payload.usage
        if (payload.done) obj.done = true
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
        } catch {
          // controller closed
        }
        if (payload.done) {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          if (unsubscribe) {
            unsubscribe()
            unsubscribe = null
          }
          try { controller.close() } catch { /* noop */ }
        }
      })

      timeoutHandle = setTimeout(() => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'timeout', done: true })}\n\n`))
          controller.close()
        } catch { /* noop */ }
        if (unsubscribe) { unsubscribe(); unsubscribe = null }
      }, FETCH_TIMEOUT_MS)

      codek.api('POST', '/llm/chat/stream', JSON.parse(JSON.stringify(body))).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg, done: true })}\n\n`))
          controller.close()
        } catch { /* noop */ }
        if (timeoutHandle) clearTimeout(timeoutHandle)
        if (unsubscribe) { unsubscribe(); unsubscribe = null }
      })
    },
    cancel() {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      if (unsubscribe) { unsubscribe(); unsubscribe = null }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

export async function readUnifiedStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (content: string) => void,
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue

      const data = trimmed.slice(5).trim()

      try {
        const json = JSON.parse(data)
        const content = json.content || ''
        const isDone = json.done === true
        const streamError = json.error || ''

        if (streamError && isDone) {
          throw new Error(String(streamError))
        }

        if (content) {
          fullContent += content
          onChunk(fullContent)
        }

        if (isDone) {
          return fullContent
        }
      } catch (parseErr) {
        // re-throw known stream errors, swallow JSON parse noise
        if (parseErr instanceof Error && !parseErr.message.startsWith('Unexpected token')) {
          throw parseErr
        }
      }
    }
  }

  return fullContent
}

export async function chatSync(options: LlmChatOptions): Promise<string> {
  // Check prefix cache for non-streaming calls
  if (!options.stream) {
    const cached = getCachedResponse(options.messages)
    if (cached !== null) return cached
  }

  const response = await chatStream(options)

  if (!response.ok || !response.body) {
    throw new Error(`LLM request failed with status ${response.status}`)
  }

  let result = ''
  await readUnifiedStream(response.body, (content) => {
    result = content
  })

  // Cache non-streaming responses
  if (!options.stream && result) {
    setCachedResponse(options.messages, result)
  }

  return result
}
