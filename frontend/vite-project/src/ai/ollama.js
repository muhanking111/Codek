import { getOllamaHost, getModelParams } from "./models.js"

const FETCH_TIMEOUT_MS = 60_000
const MAX_RETRIES = 2

function host() {
  return getOllamaHost() || "http://localhost:11434"
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
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

async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
  let lastError = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options)
      if (response.ok || attempt === retries) return response
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)))
      }
    }
  }

  throw lastError
}

export async function callOllama({ model, messages }) {
  const params = getModelParams()
  return fetchWithRetry(`${host()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      messages,
      options: {
        temperature: params.temperature,
        top_p: params.top_p,
        num_predict: params.num_predict,
      },
    }),
  })
}

export async function callOllamaSync({ model, messages }) {
  const params = getModelParams()
  const res = await fetchWithRetry(`${host()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages,
      options: {
        temperature: params.temperature,
        top_p: params.top_p,
        num_predict: params.num_predict,
      },
    }),
  })

  const json = await res.json()
  return json.message?.content || ""
}

export async function listModels() {
  try {
    const res = await fetch(`${host()}/api/tags`)
    const json = await res.json()
    return (json.models || []).map((m) => m.name)
  } catch {
    return []
  }
}

export async function ping() {
  try {
    const res = await fetchWithTimeout(`${host()}`, { method: "GET" }, 5_000)
    return res.ok
  } catch {
    return false
  }
}