import { reactive, watch } from "vue"
import { modelSettings, getActiveProviderForType as getCloudProviderForType } from "./models.js"

export type AiProviderType = "ollama" | "openai" | "claude"

const STORAGE_KEY = "codek.aiProvider.v3"
const LEGACY_STORAGE_KEYS = ["codek.aiProvider.v1", "codek.aiProvider.v2"]
const OLLAMA_TAGS_TIMEOUT_MS = 5_000
const REMOTE_MODELS_TIMEOUT_MS = 15_000
const OLLAMA_BASE_URL = "http://localhost:11434"

export const TYPE_OPTIONS: Array<{ type: AiProviderType; label: string }> = [
  { type: "ollama", label: "Ollama" },
  { type: "openai", label: "OpenAI" },
  { type: "claude", label: "Anthropic" },
]

interface PersistedState {
  activeType: AiProviderType
  activeModel: string
  modelsByType: Partial<Record<AiProviderType, string[]>>
}

interface ProviderInfo {
  type: AiProviderType
  baseUrl: string
  apiKey: string
  /** Cloud-provider id, or empty for Ollama. Useful for UI badges. */
  providerId: string
  name: string
}

interface CodekApi {
  api: (m: string, p: string, b?: unknown) => Promise<unknown>
}

export const aiProviderState = reactive({
  activeType: "ollama" as AiProviderType,
  activeModel: "",
  modelsByType: { ollama: [], openai: [], claude: [] } as Record<AiProviderType, string[]>,
  fetchingType: null as AiProviderType | null,
})

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function persist(): void {
  if (!canUseStorage()) return
  const data: PersistedState = {
    activeType: aiProviderState.activeType,
    activeModel: aiProviderState.activeModel,
    modelsByType: { ...aiProviderState.modelsByType },
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

function isType(value: unknown): value is AiProviderType {
  return value === "ollama" || value === "openai" || value === "claude"
}

export function loadAiProviders(): void {
  if (canUseStorage()) {
    for (const k of LEGACY_STORAGE_KEYS) {
      try { window.localStorage.removeItem(k) } catch { /* ignore */ }
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed: PersistedState = JSON.parse(raw)
        if (isType(parsed.activeType)) aiProviderState.activeType = parsed.activeType
        if (typeof parsed.activeModel === "string") aiProviderState.activeModel = parsed.activeModel
        if (parsed.modelsByType && typeof parsed.modelsByType === "object") {
          for (const t of ["ollama", "openai", "claude"] as AiProviderType[]) {
            const arr = parsed.modelsByType[t]
            if (Array.isArray(arr)) aiProviderState.modelsByType[t] = arr.filter((m) => typeof m === "string")
          }
        }
      }
    } catch { /* ignore */ }
  }

  watch(
    () => [
      modelSettings.cloudProviders.map((cp) => `${cp.id}|${cp.protocol}|${cp.baseUrl}|${cp.apiKey}|${cp.model}`).join("##"),
      modelSettings.activeAnthropicProviderId,
      modelSettings.activeOpenAIProviderId,
    ],
    () => {
      // When the active provider for the current type changes, the cached
      // model list belongs to a different baseUrl/key, so drop it.
      const t = aiProviderState.activeType
      if (t === "openai" || t === "claude") {
        aiProviderState.modelsByType[t] = []
        if (!getModelsForType(t).includes(aiProviderState.activeModel)) {
          aiProviderState.activeModel = ""
        }
        void fetchModelsForType(t)
      }
      persist()
    },
  )
}

export function getActiveType(): AiProviderType {
  return aiProviderState.activeType
}

export function setActiveType(type: AiProviderType): void {
  if (!isType(type)) return
  aiProviderState.activeType = type
  const models = getModelsForType(type)
  if (!models.includes(aiProviderState.activeModel)) {
    aiProviderState.activeModel = models[0] || ""
  }
  persist()
  if (models.length === 0) void fetchModelsForType(type)
}

export function setActiveModel(modelName: string): void {
  aiProviderState.activeModel = modelName || ""
  persist()
}

export function getActiveModel(): string {
  if (aiProviderState.activeModel) return aiProviderState.activeModel
  // Fallback: read directly from the active cloud provider config so the
  // ChatPanel always shows something, even before the async fetch completes.
  if (aiProviderState.activeType === "openai" || aiProviderState.activeType === "claude") {
    const cp = getCloudProviderForType(aiProviderState.activeType)
    if (cp?.model) return cp.model
  }
  return ""
}

export function getModelsForType(type: AiProviderType): string[] {
  return aiProviderState.modelsByType[type] || []
}

export function getActiveProviderInfo(): ProviderInfo | undefined {
  const t = aiProviderState.activeType
  if (t === "ollama") {
    return { type: "ollama", baseUrl: OLLAMA_BASE_URL, apiKey: "", providerId: "ollama", name: "Ollama" }
  }
  const cp = getCloudProviderForType(t)
  if (!cp) return undefined
  return {
    type: t,
    baseUrl: cp.baseUrl || "",
    apiKey: cp.apiKey || "",
    providerId: cp.id,
    name: cp.name || (t === "claude" ? "Anthropic" : "OpenAI"),
  }
}

export function hasActiveProvider(): boolean {
  return !!getActiveProviderInfo()
}

async function _fetchOllamaModelsInternal(): Promise<string[]> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), OLLAMA_TAGS_TIMEOUT_MS)
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: controller.signal })
    clearTimeout(timer)
    if (!response.ok) return []
    const json: { models?: Array<{ name: string }> } = await response.json()
    return (json.models || []).map((m) => m.name)
  } catch {
    return []
  }
}

async function fetchCloudModels(type: "openai" | "claude"): Promise<string[]> {
  const info = getActiveProviderInfo()
  if (!info || info.type !== type) return []
  if (!info.baseUrl || !info.apiKey) return []
  const codek = (window as unknown as { codek?: CodekApi }).codek
  if (!codek || typeof codek.api !== "function") return []
  const protocol = type === "claude" ? "anthropic" : "openai"
  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), REMOTE_MODELS_TIMEOUT_MS),
  )
  try {
    const result = await Promise.race([
      codek.api("POST", "/llm/models", { protocol, baseUrl: info.baseUrl, apiKey: info.apiKey }),
      timer,
    ])
    const data = (result as { data?: { success?: boolean; models?: string[] }; success?: boolean; models?: string[] } | null)
    const envelope = data && ((data as { data?: unknown }).data || data) as { success?: boolean; models?: string[] }
    if (envelope && envelope.success && Array.isArray(envelope.models)) return envelope.models
    return []
  } catch {
    return []
  }
}

export async function fetchModelsForType(type: AiProviderType): Promise<string[]> {
  if (aiProviderState.fetchingType === type) return getModelsForType(type)
  aiProviderState.fetchingType = type
  try {
    let models: string[] = []
    if (type === "ollama") models = await _fetchOllamaModelsInternal()
    else models = await fetchCloudModels(type)

    // Some providers don't expose /models (404). Fall back to the single model
    // configured in settings when the remote list is empty.
    if (models.length === 0 && (type === "openai" || type === "claude")) {
      const cp = getCloudProviderForType(type)
      if (cp?.model) models = [cp.model]
    }

    aiProviderState.modelsByType[type] = models
    if (aiProviderState.activeType === type) {
      if (!models.includes(aiProviderState.activeModel)) {
        aiProviderState.activeModel = models[0] || ""
      }
    }
    persist()
    return models
  } finally {
    aiProviderState.fetchingType = null
  }
}

export async function fetchModelsForActiveType(): Promise<string[]> {
  return fetchModelsForType(aiProviderState.activeType)
}

/* ─────────────────────────────────────────────────────────────────────────
 * Back-compat shims for the older provider-list API. New code should prefer
 * getActiveProviderInfo / setActiveType / fetchModelsForType.
 * ───────────────────────────────────────────────────────────────────────── */

export interface AiProviderConfig {
  id: string
  name: string
  type: AiProviderType
  baseUrl: string
  apiKey?: string
  models: string[]
  isLocal: boolean
}

export function getActiveProvider(): AiProviderConfig | undefined {
  const info = getActiveProviderInfo()
  if (!info) return undefined
  return {
    id: info.providerId,
    name: info.name,
    type: info.type,
    baseUrl: info.baseUrl,
    apiKey: info.apiKey,
    models: getModelsForType(info.type),
    isLocal: info.type === "ollama",
  }
}

export function fetchOllamaModels(): Promise<string[]> {
  return fetchModelsForType("ollama")
}

/** @deprecated use setActiveType */
export function setActiveProvider(providerOrType: string): void {
  if (isType(providerOrType)) setActiveType(providerOrType)
}
