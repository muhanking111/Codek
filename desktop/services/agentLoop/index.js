/*---------------------------------------------------------------------------------------------
 *  Agent loop service.
 *
 *  Runs the tool-calling iteration entirely in the main process:
 *    1. send messages + tool schemas to the provider
 *    2. stream text deltas → renderer
 *    3. when the model emits tool_calls, execute them locally (with user authz)
 *    4. append tool_result messages and loop until the model stops calling tools
 *       or MAX_TURNS is reached.
 *
 *  Streams structured events on the `agent:event` channel.
 *  Event shapes:
 *    { type: "text_delta", content }
 *    { type: "tool_call", id, name, input }
 *    { type: "tool_result", callId, content, isError, structured }
 *    { type: "turn_end" }
 *    { type: "done", reason }
 *    { type: "error", error }
 *
 *  Supports OpenAI-compatible providers (openai, any compat base URL) and
 *  Anthropic (claude). Ollama tool-use is not yet wired — those providers should
 *  keep using the legacy text-protocol Agent until native function-calling lands.
 *--------------------------------------------------------------------------------------------*/

const { fetch } = require("undici")
const { getConfig } = require("../llm/config")
const { listSchemas, getTool } = require("../agentTools/tools")
const { requestAuthorization, isAlwaysAllowed } = require("../agentTools/authorize")
const { evaluateToolCall, getPolicy } = require("../agentPolicy")

const CHAT_TIMEOUT_MS = 180_000
const MAX_TURNS = 10

const OPENAI_COMPAT = new Set(["openai"])
const ANTHROPIC_IDS = new Set(["claude", "anthropic"])

// requestId → AbortController for in-flight loops. Used by /agent/loop/abort.
const RUNNING = new Map()

function combineSignals(signals) {
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  for (const s of signals) {
    if (!s) continue
    if (s.aborted) { ctrl.abort(); break }
    s.addEventListener("abort", onAbort, { once: true })
  }
  return ctrl.signal
}

function normalizeToolNameFilter(filter) {
  if (!filter) return null
  const names = Array.isArray(filter) ? filter : String(filter).split(",")
  const normalized = names.map((name) => String(name).trim()).filter(Boolean)
  return normalized.length ? new Set(normalized) : null
}

function getFilteredSchemas(toolNameFilter) {
  const allowed = normalizeToolNameFilter(toolNameFilter)
  const schemas = listSchemas()
  return allowed ? schemas.filter((schema) => allowed.has(schema.name)) : schemas
}

function structuredToolError(error, toolCall) {
  const message = error?.message || String(error)
  if (error?.code === "MCP_INPUT_REQUIRED") {
    const input = toolCall?.parsedArguments && typeof toolCall.parsedArguments === "object" ? toolCall.parsedArguments : {}
    return {
      content: `MCP input required: ${(error.missingInputs || []).map((entry) => entry?.id).filter(Boolean).join(", ")}`,
      structured: {
        code: "MCP_INPUT_REQUIRED",
        serverName: input.serverName || null,
        toolName: input.toolName || null,
        missingInputs: Array.isArray(error.missingInputs) ? error.missingInputs.map((entry) => ({ ...entry })) : [],
      },
    }
  }
  return {
    content: `Error: ${message}`,
    structured: null,
  }
}

function buildAnthropicTools(toolNameFilter) {
  return getFilteredSchemas(toolNameFilter).map((s) => ({
    name: s.name,
    description: s.description,
    input_schema: s.inputSchema,
  }))
}

/**
 * Normalize a conversation into Anthropic's message shape.
 * - role:system entries collapse into a single `system` string.
 * - assistant turns may carry `tool_calls` (OpenAI shape) which we convert to
 *   `tool_use` content blocks.
 * - role:"tool" entries become `tool_result` blocks attached to the next user message.
 */
function shapeMessagesForAnthropic(messages) {
  let system = null
  const out = []
  for (const msg of messages) {
    if (msg.role === "system") {
      system = system ? `${system}\n\n${msg.content || ""}` : (msg.content || "")
      continue
    }
    if (msg.role === "tool") {
      const last = out[out.length - 1]
      const block = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id,
        content: msg.content || "",
      }
      if (last && last.role === "user" && Array.isArray(last.content)) {
        last.content.push(block)
      } else {
        out.push({ role: "user", content: [block] })
      }
      continue
    }
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      const blocks = []
      if (msg.content) blocks.push({ type: "text", text: String(msg.content) })
      for (const tc of msg.tool_calls) {
        let input = {}
        try { input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {} } catch {}
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function?.name || "",
          input,
        })
      }
      out.push({ role: "assistant", content: blocks })
      continue
    }
    out.push({ role: msg.role, content: msg.content || "" })
  }
  return { system, messages: out }
}

async function streamAnthropicTurn({ request, emit, signal }) {
  const cfg = getConfig().anthropic
  const apiKey = request.apiKey?.trim() || cfg.apiKey
  if (!apiKey) throw new Error("Anthropic API key not configured")
  const baseUrl = request.baseUrl?.trim() || cfg.baseUrl

  const { system, messages } = shapeMessagesForAnthropic(request.messages)
  const body = {
    model: request.model,
    max_tokens: request.maxTokens != null ? request.maxTokens : 4096,
    stream: true,
    tools: buildAnthropicTools(request.toolNameFilter),
    messages,
  }
  if (system) body.system = system
  if (request.temperature != null) body.temperature = request.temperature
  if (request.topP != null) body.top_p = request.topP

  const resp = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": cfg.version,
    },
    body: JSON.stringify(body),
    signal: combineSignals([AbortSignal.timeout(CHAT_TIMEOUT_MS), signal]),
  })
  if (resp.status >= 400) {
    const text = await resp.text().catch(() => "")
    throw new Error(`Anthropic HTTP ${resp.status}: ${text.slice(0, 200)}`)
  }

  let textBuf = ""
  // Active content blocks keyed by index. type ∈ {"text", "tool_use"}.
  const blocks = new Map()
  let stopReason = null

  for await (const line of iterateLines(resp)) {
    if (!line || !line.startsWith("data:")) continue
    const data = line.slice(5).trim()
    if (!data) continue
    let node
    try { node = JSON.parse(data) } catch { continue }
    if (node.type === "content_block_start") {
      const block = node.content_block || {}
      blocks.set(node.index, {
        type: block.type,
        id: block.id,
        name: block.name,
        text: "",
        partialJson: "",
      })
      if (block.type === "thinking") emit({ type: "thinking_start" })
    } else if (node.type === "content_block_delta") {
      const entry = blocks.get(node.index)
      if (!entry) continue
      const delta = node.delta || {}
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        entry.text += delta.text
        textBuf += delta.text
        emit({ type: "text_delta", content: delta.text })
      } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
        entry.partialJson += delta.partial_json
      } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
        entry.text += delta.thinking
        emit({ type: "thinking_delta", content: delta.thinking })
      }
    } else if (node.type === "content_block_stop") {
      const entry = blocks.get(node.index)
      if (entry && entry.type === "thinking") emit({ type: "thinking_end" })
    } else if (node.type === "message_delta") {
      if (node.delta?.stop_reason) stopReason = node.delta.stop_reason
    } else if (node.type === "message_stop") {
      break
    }
  }

  const toolCalls = []
  for (const [, entry] of [...blocks.entries()].sort((a, b) => a[0] - b[0])) {
    if (entry.type !== "tool_use") continue
    let parsed = {}
    try { parsed = entry.partialJson ? JSON.parse(entry.partialJson) : {} } catch { parsed = { __raw: entry.partialJson } }
    toolCalls.push({
      id: entry.id,
      name: entry.name,
      arguments: entry.partialJson || "{}",
      parsedArguments: parsed,
    })
  }

  return { text: textBuf, toolCalls, finishReason: stopReason }
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

function buildOpenAITools(toolNameFilter) {
  return getFilteredSchemas(toolNameFilter).map((s) => ({
    type: "function",
    function: {
      name: s.name,
      description: s.description,
      parameters: s.inputSchema,
    },
  }))
}

/**
 * Stream a single turn against an OpenAI-compatible endpoint. Emits text deltas
 * and yields the assistant message (incl. any tool_calls) once the turn finishes.
 */
async function streamOpenAITurn({ request, providerKey, emit, signal }) {
  const cfg = getConfig()[providerKey]
  const apiKey = request.apiKey?.trim() || cfg.apiKey
  if (!apiKey) throw new Error(`API key not configured for ${providerKey}`)
  const baseUrl = request.baseUrl?.trim() || cfg.baseUrl

  const body = {
    model: request.model,
    messages: request.messages,
    stream: true,
    tools: buildOpenAITools(request.toolNameFilter),
    tool_choice: "auto",
  }
  if (request.temperature != null) body.temperature = request.temperature
  if (request.topP != null) body.top_p = request.topP
  if (request.maxTokens != null) body.max_tokens = request.maxTokens

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: combineSignals([AbortSignal.timeout(CHAT_TIMEOUT_MS), signal]),
  })
  if (resp.status >= 400) {
    const text = await resp.text().catch(() => "")
    throw new Error(`${providerKey} HTTP ${resp.status}: ${text.slice(0, 200)}`)
  }

  let textBuf = ""
  // tool_calls accumulator keyed by index (per OpenAI spec)
  const calls = new Map() // index → { id, name, argsBuf }
  let finishReason = null

  for await (const line of iterateLines(resp)) {
    if (!line || !line.startsWith("data:")) continue
    const data = line.slice(5).trim()
    if (!data || data === "[DONE]") break
    let node
    try { node = JSON.parse(data) } catch { continue }
    const choice = node.choices?.[0]
    if (!choice) continue
    const delta = choice.delta || {}
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      emit({ type: "thinking_delta", content: delta.reasoning_content })
    } else if (typeof delta.reasoning === "string" && delta.reasoning) {
      emit({ type: "thinking_delta", content: delta.reasoning })
    }
    if (typeof delta.content === "string" && delta.content) {
      textBuf += delta.content
      emit({ type: "text_delta", content: delta.content })
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = typeof tc.index === "number" ? tc.index : 0
        let entry = calls.get(idx)
        if (!entry) {
          entry = { id: tc.id || `call_${idx}`, name: "", argsBuf: "" }
          calls.set(idx, entry)
        }
        if (tc.id) entry.id = tc.id
        if (tc.function?.name) entry.name += tc.function.name
        if (tc.function?.arguments) entry.argsBuf += tc.function.arguments
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason
  }

  const toolCalls = []
  for (const [, entry] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
    let parsed = {}
    try { parsed = entry.argsBuf ? JSON.parse(entry.argsBuf) : {} } catch { parsed = { __raw: entry.argsBuf } }
    toolCalls.push({ id: entry.id, name: entry.name, arguments: entry.argsBuf, parsedArguments: parsed })
  }

  return { text: textBuf, toolCalls, finishReason }
}

async function executeToolCall({ sender, toolCall, projectRoot, request = {}, emit }) {
  const tool = getTool(toolCall.name)
  if (!tool) {
    const content = `unknown tool: ${toolCall.name}`
    emit({ type: "tool_result", callId: toolCall.id, content, isError: true })
    return { content, isError: true }
  }

  // ── Policy gate ──────────────────────────────────────────────────────────
  // agentPolicy is the single decision point for sandbox + approval. It does
  // the path-containment check, the sandbox-mode refusal, and tells us whether
  // to prompt the user. The legacy `autoAuthorize` flag on the tool is now an
  // optimization hint only — policy decides.
  let decision
  try {
    decision = evaluateToolCall({
      tool,
      input: toolCall.parsedArguments,
      projectRoot,
    })
  } catch (err) {
    const content = `policy error: ${err?.message || String(err)}`
    emit({ type: "tool_result", callId: toolCall.id, content, isError: true })
    return { content, isError: true }
  }

  if (decision.decision === "deny") {
    const content = `denied: ${decision.reason || "blocked by policy"}`
    emit({ type: "tool_result", callId: toolCall.id, content, isError: true })
    return { content, isError: true }
  }

  if (decision.decision === "prompt" && !isAlwaysAllowed(toolCall.name)) {
    let preview = toolCall.name
    try { preview = tool.makePreview ? tool.makePreview(toolCall.parsedArguments) : tool.name } catch {}
    const { allow } = await requestAuthorization(sender, {
      toolName: toolCall.name,
      input: toolCall.parsedArguments,
      preview,
    })
    if (!allow) {
      const content = `user denied ${toolCall.name}`
      emit({ type: "tool_result", callId: toolCall.id, content, isError: true })
      return { content, isError: true }
    }
  }

  try {
    const result = await tool.execute(toolCall.parsedArguments, buildToolContext({ ...request, projectRoot }, decision))
    const content = result?.content ?? ""
    const isError = !!result?.isError
    emit({ type: "tool_result", callId: toolCall.id, content, isError, structured: result?.structured ?? null })
    return { content, isError, structured: result?.structured ?? null }
  } catch (err) {
    const { content, structured } = structuredToolError(err, toolCall)
    emit({ type: "tool_result", callId: toolCall.id, content, isError: true, structured })
    return { content, isError: true, structured }
  }
}

function buildToolContext(request, decision) {
  return {
    projectRoot: request.projectRoot,
    workspaceFile: request.workspaceFile,
    workspaceResource: request.workspaceResource,
    mcpResourcePath: request.mcpResourcePath,
    resourcePath: request.resourcePath,
    sandboxMode: getPolicy().sandboxMode,
    networkAccess: decision.networkAccess,
  }
}

async function runLoop({ request, sender, emit, signal }) {
  const provider = request.provider || "openai"
  const isOpenAI = OPENAI_COMPAT.has(provider)
  const isAnthropic = ANTHROPIC_IDS.has(provider)
  if (!isOpenAI && !isAnthropic) {
    throw new Error(`agent loop does not yet support provider: ${provider}`)
  }
  if (!request.projectRoot) {
    throw new Error("projectRoot is required for agent loop")
  }

  const messages = Array.isArray(request.messages) ? [...request.messages] : []
  const isAborted = () => !!(signal && signal.aborted)

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (isAborted()) {
      emit({ type: "done", reason: "aborted" })
      return
    }
    const turnResult = isOpenAI
      ? await streamOpenAITurn({ request: { ...request, messages }, providerKey: provider, emit, signal })
      : await streamAnthropicTurn({ request: { ...request, messages }, emit, signal })
    const { text, toolCalls, finishReason } = turnResult
    emit({ type: "turn_end", finishReason, hadToolCalls: toolCalls.length > 0 })

    if (isAborted()) {
      emit({ type: "done", reason: "aborted" })
      return
    }

    if (toolCalls.length === 0) {
      emit({ type: "done", reason: "stop" })
      return
    }

    // Append assistant message in OpenAI's tool_calls shape regardless of provider.
    // shapeMessagesForAnthropic converts it back when calling Anthropic next turn.
    messages.push({
      role: "assistant",
      content: text || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments || "{}" },
      })),
    })

    for (const tc of toolCalls) {
      if (isAborted()) {
        emit({ type: "done", reason: "aborted" })
        return
      }
      emit({ type: "tool_call", id: tc.id, name: tc.name, input: tc.parsedArguments })
      const result = await executeToolCall({ sender, toolCall: tc, projectRoot: request.projectRoot, request, emit })
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result.content || "",
      })
    }
  }

  emit({ type: "done", reason: "max_turns" })
}

function register(router) {
  router.register("POST", "/agent/loop/run", async ({ body, sender }) => {
    const requestId = body?.requestId || `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const channel = "agent:event"
    const emit = (payload) => {
      if (sender && !sender.isDestroyed()) {
        sender.send(channel, { requestId, ...payload })
      }
    }

    const controller = new AbortController()
    RUNNING.set(requestId, controller)
    const cleanup = () => { RUNNING.delete(requestId) }

    runLoop({ request: body || {}, sender, emit, signal: controller.signal })
      .catch((err) => {
        if (controller.signal.aborted) {
          emit({ type: "done", reason: "aborted" })
          return
        }
        const msg = err?.message || String(err)
        emit({ type: "error", error: msg })
        emit({ type: "done", reason: "error" })
      })
      .finally(cleanup)

    return { requestId }
  })

  router.register("POST", "/agent/loop/plan", async ({ body, sender }) => {
    const planner = require("./planner")
    const executor = require("./planExecutor")
    const memory = require("./memory")
    const goalStore = require("../goalStore")

    const requestId = body?.requestId || `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const channel = "agent:event"
    const emit = (payload) => {
      if (sender && !sender.isDestroyed()) {
        sender.send(channel, { requestId, ...payload })
      }
    }
    const controller = new AbortController()
    RUNNING.set(requestId, controller)
    const cleanup = () => RUNNING.delete(requestId)

    ;(async () => {
      try {
        const rules = memory.buildContextBlock(body?.projectRoot)
        const plan = await planner.generate({
          userInput: body?.userInput || "",
          provider: body?.provider || "openai",
          model: body?.model,
          apiKey: body?.apiKey,
          baseUrl: body?.baseUrl,
          projectSummary: body?.projectSummary || "",
          rules,
          signal: controller.signal,
        })
        let goalId = null
        try {
          const g = goalStore.createGoal(body?.userInput || "", body?.projectRoot)
          goalId = g.id
        } catch {}
        await executor.execute({
          plan,
          parentRequest: {
            provider: body?.provider || "openai",
            model: body?.model,
            apiKey: body?.apiKey,
            baseUrl: body?.baseUrl,
            projectRoot: body?.projectRoot,
            workspaceFile: body?.workspaceFile,
            temperature: body?.temperature,
            topP: body?.topP,
            maxTokens: body?.maxTokens,
          },
          emit, signal: controller.signal, goalId,
          sharedContext: rules,
        })
        if (goalId) {
          try { goalStore.updateGoalStatus(goalId, "completed") } catch {}
        }
        emit({ type: "done", reason: "stop" })
      } catch (err) {
        if (controller.signal.aborted) emit({ type: "done", reason: "aborted" })
        else {
          emit({ type: "error", error: err?.message || String(err) })
          emit({ type: "done", reason: "error" })
        }
      } finally { cleanup() }
    })()

    return { requestId }
  })

  router.register("POST", "/agent/loop/abort", async ({ body }) => {
    const requestId = body?.requestId
    if (!requestId) return { aborted: false, reason: "missing requestId" }
    const ctrl = RUNNING.get(requestId)
    if (!ctrl) return { aborted: false, reason: "not running" }
    ctrl.abort()
    RUNNING.delete(requestId)
    return { aborted: true }
  })
}

module.exports = {
  register,
  runLoop,
  buildAnthropicTools,
  buildToolContext,
  buildOpenAITools,
  getFilteredSchemas,
  normalizeToolNameFilter,
  structuredToolError,
}
