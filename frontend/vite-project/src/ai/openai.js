import { getModelParams } from "./models"

const DEFAULT_TIMEOUT = 120_000

export function createOpenAIClient(config) {
  const baseURL = (config?.baseURL || "https://api.openai.com/v1").replace(/\/+$/, "")
  const apiKey = config?.apiKey || ""
  const defaultModel = config?.defaultModel || "gpt-4o-mini"

  if (!apiKey) {
    throw new Error("OpenAI API key is required. Configure it in Settings.")
  }

  return {
    async chat(options = {}) {
      const model = options.model || defaultModel
      const messages = options.messages || []
      const stream = options.stream !== false
      const params = getModelParams()

      const body = {
        model,
        messages,
        stream,
        temperature: options.temperature ?? params.temperature,
        top_p: options.top_p ?? params.top_p,
        max_tokens: options.maxTokens ?? params.num_predict,
      }

      const response = await fetchWithTimeout(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "")
        throw new Error(`OpenAI API error ${response.status}: ${errorBody.slice(0, 200)}`)
      }

      return response
    },

    async chatSync(options = {}) {
      const response = await this.chat({ ...options, stream: false })
      const json = await response.json()
      return json.choices?.[0]?.message?.content || ""
    },

    async listModels() {
      try {
        const response = await fetchWithTimeout(`${baseURL}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        })

        if (!response.ok) return []
        const json = await response.json()
        return (json.data || [])
          .filter((m) => m.id && (m.id.includes("gpt") || m.id.includes("deepseek") || m.id.includes("claude")))
          .map((m) => m.id)
      } catch {
        return []
      }
    },

    async testConnection() {
      try {
        const response = await fetchWithTimeout(`${baseURL}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        })
        return response.ok
      } catch {
        return false
      }
    },
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(timer)
  }
}