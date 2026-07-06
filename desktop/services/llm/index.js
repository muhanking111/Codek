const { fetch } = require("undici")
const { getConfig } = require("./config")
const {
  estimateUsageFromText,
  mergeUsage,
  normalizeUsage,
  saveUsageAudit,
  summarizeUsageCost,
  summarizeUsageAudits,
} = require("./usage")
const {
  buildProviderHealthReport,
  readLatestProviderHealthReport,
  saveProviderHealthReport,
} = require("./providerHealth")

const CHAT_TIMEOUT_MS = 180_000

function pickProvider(provider) {
  return provider || "ollama"
}

async function* iterateLines(response) {
  const decoder = new TextDecoder("utf-8")
  let buffer = ""
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true })
    let idx
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, "")
      buffer = buffer.slice(idx + 1)
      yield line
    }
  }
  if (buffer.length) yield buffer
}

function emit(emit$, content, done, extra = {}) {
  emit$({ content, done, ...extra })
}

function emitDoneWithUsage(request, emit$, provider, output, providerUsage) {
  const usage = mergeUsage(providerUsage, estimateUsageFromText({
    provider,
    messages: request.messages,
    output,
  }))
  if (usage) {
    try {
      saveUsageAudit({
        requestId: request.requestId,
        provider,
        model: request.model,
        usage,
      })
    } catch {}
  }
  emit(emit$, "", true, usage ? { usage } : {})
}

/**
 * Turns a raw API HTTP error into a user-friendly message.
 * Tries to extract a readable message from JSON error bodies.
 */
function friendlyApiError(status, bodyText, model, baseUrl) {
  let apiMsg = ""
  try {
    const parsed = JSON.parse(bodyText)
    apiMsg = parsed.error?.message || parsed.error?.code || ""
  } catch { /* not JSON */ }
  if (apiMsg) {
    // Strip "but you passed ..." - the user sees their configured model name.
    const dotIdx = apiMsg.indexOf(". but you passed")
    if (dotIdx !== -1) apiMsg = apiMsg.slice(0, dotIdx)
    return `模型「${model}」不可用: ${apiMsg}。请到设置 → Models 中修改模型名称。`
  }
  // Generic fallback
  const name = new URL(baseUrl).hostname || baseUrl
  if (status === 401 || status === 403) return `「${name}」API 认证失败,请检查 API Key 是否正确。`
  if (status === 404) return `「${name}」API 地址不存在,请检查 Base URL。`
  if (status === 429) return `「${name}」请求太频繁,请稍后重试。`
  return `「${name}」API 返回错误(${status}),详细错误信息: ${bodyText.slice(0, 120)}`
}

async function streamOllama(request, emit$) {
  const cfg = getConfig().ollama
  const body = {
    model: request.model,
    messages: request.messages,
    stream: true,
  }
  const options = {}
  if (request.temperature != null) options.temperature = request.temperature
  if (request.topP != null) options.top_p = request.topP
  if (request.maxTokens != null) options.num_predict = request.maxTokens
  if (Object.keys(options).length) body.options = options

  const url = `${cfg.host}/api/chat`
  let output = ""
  let providerUsage = null
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
  })
  if (resp.status >= 400) throw new Error(`Ollama returned HTTP ${resp.status}`)

  for await (const line of iterateLines(resp)) {
    if (!line.trim()) continue
    try {
      const node = JSON.parse(line)
      const content = node.message && node.message.content ? node.message.content : ""
      const done = !!node.done
      if (content) output += content
      providerUsage = mergeUsage(providerUsage, normalizeUsage({ provider: "ollama", node }))
      if (done) {
        if (content) emit(emit$, content, false)
        emitDoneWithUsage(request, emit$, "ollama", output, providerUsage)
        return
      }
      emit(emit$, content, false)
    } catch {
      // skip malformed line
    }
  }
  emitDoneWithUsage(request, emit$, "ollama", output, providerUsage)
}

async function streamOpenAICompat(request, emit$, providerKey) {
  const cfg = getConfig()[providerKey]
  const apiKey = request.apiKey && request.apiKey.trim() ? request.apiKey : cfg.apiKey
  if (!apiKey) throw new Error(`API key not configured for ${providerKey}`)
  const baseUrl = request.baseUrl && request.baseUrl.trim() ? request.baseUrl : cfg.baseUrl

  const body = {
    model: request.model,
    messages: request.messages,
    stream: true,
  }
  if (request.temperature != null) body.temperature = request.temperature
  if (request.topP != null) body.top_p = request.topP
  if (request.maxTokens != null) body.max_tokens = request.maxTokens

  const url = `${baseUrl}/chat/completions`
  let output = ""
  let providerUsage = null
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
  })
  if (resp.status >= 400) {
    const text = await resp.text().catch(() => "")
    throw new Error(`${providerKey} API HTTP ${resp.status}: ${text.slice(0, 200)}`)
  }

  for await (const line of iterateLines(resp)) {
    if (!line || !line.startsWith("data:")) continue
    const data = line.slice(5).trim()
    if (!data) continue
    if (data === "[DONE]") {
      emitDoneWithUsage(request, emit$, providerKey, output, providerUsage)
      return
    }
    try {
      const node = JSON.parse(data)
      const choice = node.choices && node.choices[0]
      const content = (choice && choice.delta && choice.delta.content) || ""
      if (content) output += content
      providerUsage = mergeUsage(providerUsage, normalizeUsage({ provider: providerKey, node }))
      emit(emit$, content, false)
    } catch {
      // skip malformed
    }
  }
  emitDoneWithUsage(request, emit$, providerKey, output, providerUsage)
}

async function streamAnthropic(request, emit$) {
  const cfg = getConfig().anthropic
  const apiKey = request.apiKey && request.apiKey.trim() ? request.apiKey : cfg.apiKey
  if (!apiKey) throw new Error("Anthropic API key not configured")
  const baseUrl = request.baseUrl && request.baseUrl.trim() ? request.baseUrl : cfg.baseUrl

  // CCSwitch 和其他工具经常在模型名前加 "claude-" 前缀,但 DeepSeek 等
  // Anthropic 兼容 API 不接受这个前缀,后面检查有就自动去掉以免报 400。
  // 同时清理从终端输出导入的 ANSI 转义残留 (如 [1m 或 [1m])。
  const rawModel = typeof request.model === "string" ? request.model.trim() : ""
  const model = rawModel.replace(/^claude-/i, "").replace(/\[[\d;]*m\]?/g, "").trim()

  const body = {
    model,
    max_tokens: request.maxTokens != null ? request.maxTokens : 4096,
    stream: true,
  }
  if (Array.isArray(request.messages) && request.messages.length) {
    let systemContent = null
    const userMessages = []
    for (const msg of request.messages) {
      if (msg.role === "system") systemContent = msg.content
      else userMessages.push(msg)
    }
    if (systemContent) body.system = systemContent
    body.messages = userMessages
  }
  if (request.temperature != null) body.temperature = request.temperature
  if (request.topP != null) body.top_p = request.topP

  const url = `${baseUrl}/messages`
  let output = ""
  let providerUsage = null
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": cfg.version,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
  })
  if (resp.status >= 400) {
    const text = await resp.text().catch(() => "")
    const friendly = friendlyApiError(resp.status, text, model, baseUrl)
    throw new Error(friendly)
  }

  for await (const line of iterateLines(resp)) {
    if (!line || !line.startsWith("data:")) continue
    const data = line.slice(5).trim()
    if (!data) continue
    try {
      const node = JSON.parse(data)
      if (node.type === "content_block_delta") {
        const content = (node.delta && node.delta.text) || ""
        if (content) output += content
        emit(emit$, content, false)
      } else if (node.type === "message_stop") {
        emitDoneWithUsage(request, emit$, "anthropic", output, providerUsage)
        return
      } else if (node.usage || node.type === "message_delta") {
        providerUsage = mergeUsage(providerUsage, normalizeUsage({ provider: "anthropic", node }))
      }
    } catch {
      // skip
    }
  }
  emitDoneWithUsage(request, emit$, "anthropic", output, providerUsage)
}

async function streamChat(request, emit$) {
  const provider = pickProvider(request.provider)
  switch (provider) {
    case "ollama":
      return streamOllama(request, emit$)
    case "openai":
      return streamOpenAICompat(request, emit$, "openai")
    case "claude":
    case "anthropic":
      return streamAnthropic(request, emit$)
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

async function testProvider({ protocol, baseUrl, apiKey, model }) {
  const url = (baseUrl || "").replace(/\/+$/, "")
  if (!url) throw new Error("Base URL is required")
  if (!model) throw new Error("Model is required")
  if (protocol === "anthropic") {
    if (!apiKey) throw new Error("Anthropic API key is required")
    const resp = await fetch(`${url}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 32,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: AbortSignal.timeout(30_000),
    })
    const text = await resp.text()
    if (resp.status >= 400) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`)
    try {
      const node = JSON.parse(text)
      const reply = (node.content && node.content[0] && node.content[0].text) || ""
      return { ok: true, reply: reply || "(empty)", raw: text.slice(0, 400) }
    } catch {
      return { ok: true, reply: text.slice(0, 200), raw: text.slice(0, 400) }
    }
  }
  if (!apiKey) throw new Error("API key is required")
  const resp = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 32,
      stream: false,
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await resp.text()
  if (resp.status >= 400) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`)
  try {
    const node = JSON.parse(text)
    const reply = (node.choices && node.choices[0] && node.choices[0].message && node.choices[0].message.content) || ""
    return { ok: true, reply: reply || "(empty)", raw: text.slice(0, 400) }
  } catch {
    return { ok: true, reply: text.slice(0, 200), raw: text.slice(0, 400) }
  }
}

async function listProviderModels({ protocol, baseUrl, apiKey }) {
  const url = (baseUrl || "").replace(/\/+$/, "")
  if (!url) throw new Error("Base URL is required")
  if (!apiKey) throw new Error("API key is required")
  const headers = protocol === "anthropic"
    ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
    : { Authorization: `Bearer ${apiKey}` }
  const resp = await fetch(`${url}/models`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(30_000),
  })
  const text = await resp.text()
  // 404 / empty response means this provider doesn't expose model enumeration —
  // treat it as success with an empty list, not an error.
  if (resp.status >= 500) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`)
  try {
    const node = JSON.parse(text)
    const arr = Array.isArray(node.data) ? node.data : Array.isArray(node) ? node : []
    const models = arr
      .map((m) => (typeof m === "string" ? m : m && (m.id || m.name)))
      .filter((s) => typeof s === "string" && s.trim())
    return { ok: true, models }
  } catch {
    return { ok: true, models: [] }
  }
}

async function proxyOllamaSync(endpoint, body) {
  const cfg = getConfig().ollama
  const url = `${cfg.host}${endpoint}`
  const init = {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(120_000),
  }
  if (body) init.body = typeof body === "string" ? body : JSON.stringify(body)
  const resp = await fetch(url, init)
  const text = await resp.text()
  if (resp.status >= 400) throw new Error(`Ollama HTTP ${resp.status}: ${text.slice(0, 200)}`)
  return text
}

function register(router, opts = {}) {
  const webContentsRef = opts.webContentsRef || (() => null)

  router.register("POST", "/llm/chat/stream", async ({ body, sender }) => {
    const requestId = body.requestId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const channel = "llm:chunk"
    const emit$ = (payload) => {
      if (sender && !sender.isDestroyed()) {
        sender.send(channel, { requestId, ...payload })
      }
    }
    streamChat({ ...body, requestId }, emit$).catch((err) => {
      console.warn("[llm] stream error:", err.message)
      if (sender && !sender.isDestroyed()) {
        sender.send(channel, { requestId, content: "", done: true, error: err.message })
      }
    })
    return { requestId }
  })

  router.register("GET", "/llm/usage/summary", async ({ query }) => summarizeUsageAudits({
    reportDir: query?.reportDir,
    limit: query?.limit,
  }))

  router.register("GET", "/llm/usage/cost-summary", async ({ query }) => summarizeUsageCost({
    reportDir: query?.reportDir,
    limit: query?.limit,
  }))

  router.register("GET", "/llm/provider-health", async ({ query }) => {
    const latest = readLatestProviderHealthReport({ reportDir: query?.reportDir })
    return latest.report || {
      reportKind: "provider-health",
      status: "missing",
      statusLabel: "暂无模型链路健康报告",
      ready: false,
      jsonPath: latest.latestJsonPath,
      markdownPath: latest.latestMarkdownPath,
    }
  })

  router.register("POST", "/llm/provider-health/run", async ({ body }) => {
    const report = buildProviderHealthReport(body || {})
    if (body?.write === false) return report
    saveProviderHealthReport(report, { reportDir: body?.reportDir })
    return report
  })

  router.register("POST", "/llm/test", async ({ body }) => {
    try {
      const result = await testProvider(body || {})
      return { success: true, ...result }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  router.register("POST", "/llm/models", async ({ body }) => {
    try {
      const result = await listProviderModels(body || {})
      return { success: true, ...result }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  router.register("GET", "/ollama/health", async () => {
    try {
      await proxyOllamaSync("/api/tags", null)
      return { success: true, status: "running" }
    } catch (e) {
      return { success: false, status: "unavailable", error: e.message }
    }
  })

  router.register("POST", "/ollama/embed", async ({ body }) => {
    if (!body.model || body.input == null) {
      return { success: false, error: "model and input are required" }
    }
    try {
      const result = await proxyOllamaSync("/api/embed", { model: body.model, input: body.input })
      return { success: true, embeddings: result }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  router.register("POST", "/ollama/chat", async ({ body }) => {
    try {
      const result = await proxyOllamaSync("/api/chat", body)
      return { success: true, response: result }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  router.register("POST", "/ollama/generate", async ({ body }) => {
    try {
      const result = await proxyOllamaSync("/api/generate", body)
      return { success: true, response: result }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
}

module.exports = { register, streamChat, buildProviderHealthReport }
