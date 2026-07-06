import { reactive } from "vue"
import { settingsStore } from "../settings/settingsStore"

export const DEFAULT_OLLAMA_MODEL = "deepseekv4"
export const DEFAULT_OLLAMA_HOST = "http://localhost:11434"
const MODEL_SETTINGS_KEY = "codek.aiModelSettings.v4"
const LANG_SETTINGS_KEY = "codek.langSettings.v1"

export const PROVIDERS = {
  ollama: { id: "ollama", label: "Ollama (Local)", defaultHost: DEFAULT_OLLAMA_HOST },
  openai: { id: "openai", label: "OpenAI (Compatible)", defaultHost: "https://api.openai.com/v1" },
  anthropic: { id: "anthropic", label: "Anthropic (Claude)", defaultHost: "https://api.anthropic.com/v1" },
  "claude-code-shared": { id: "claude-code-shared", label: "Claude Code (cc-switch shared)", defaultHost: "" },
  "codex-shared": { id: "codex-shared", label: "Codex CLI (~/.codex/config.toml shared)", defaultHost: "" },
}

export const COMPLETION_PROVIDERS = {
  ollama: { id: "ollama", label: "Ollama (本地)", apiHost: "http://localhost:11434" },
  openai: { id: "openai", label: "OpenAI 兼容", apiHost: "https://api.openai.com/v1" },
}

export const JDK_VERSIONS = [
  { value: "8", label: "JDK 8" },
  { value: "11", label: "JDK 11" },
  { value: "17", label: "JDK 17 (推荐)" },
  { value: "21", label: "JDK 21" },
  { value: "22", label: "JDK 22" },
  { value: "23", label: "JDK 23" },
]

export const LANGUAGE_SUPPORTS = {
  java: { id: "java", label: "Java", extension: ".java", icon: "JV", enabled: true },
  python: { id: "python", label: "Python", extension: ".py", icon: "PY", enabled: true },
  javascript: { id: "javascript", label: "JavaScript", extension: ".js", icon: "JS", enabled: true },
  typescript: { id: "typescript", label: "TypeScript", extension: ".ts", icon: "TS", enabled: true },
  html: { id: "html", label: "HTML", extension: ".html", icon: "HT", enabled: true },
  css: { id: "css", label: "CSS", extension: ".css", icon: "CS", enabled: true },
  go: { id: "go", label: "Go", extension: ".go", icon: "GO", enabled: true },
  rust: { id: "rust", label: "Rust", extension: ".rs", icon: "RS", enabled: true },
  cpp: { id: "cpp", label: "C/C++", extension: ".cpp", icon: "CP", enabled: true },
  csharp: { id: "csharp", label: "C#", extension: ".cs", icon: "C#", enabled: true },
  kotlin: { id: "kotlin", label: "Kotlin", extension: ".kt", icon: "KT", enabled: true },
  php: { id: "php", label: "PHP", extension: ".php", icon: "PH", enabled: true },
  ruby: { id: "ruby", label: "Ruby", extension: ".rb", icon: "RB", enabled: true },
  dart: { id: "dart", label: "Dart", extension: ".dart", icon: "DT", enabled: true },
}

export const modelSettings = reactive({
  provider: "ollama",
  preferredModel: DEFAULT_OLLAMA_MODEL,
  resolvedModel: DEFAULT_OLLAMA_MODEL,
  availableModels: [],
  ollamaHost: DEFAULT_OLLAMA_HOST,
  openaiApiKey: "",
  openaiBaseURL: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-mini",
  anthropicApiKey: "",
  anthropicBaseURL: "https://api.anthropic.com/v1",
  anthropicModel: "claude-sonnet-4-20250514",
  temperature: 0.8,
  topP: 0.9,
  maxTokens: 4096,
  completionProvider: "ollama",
  cloudProviders: [],
  activeCloudProviderId: "",
  activeAnthropicProviderId: "",
  activeOpenAIProviderId: "",
})

export const langSettings = reactive({
  jdkVersion: "17",
  enabledLanguages: ["java", "python", "javascript", "typescript", "html", "css", "go", "rust", "cpp", "csharp", "kotlin", "php", "ruby", "dart"],
  jdkPath: "",
  pythonPath: "",
})

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function normalizeModelName(value) {
  return typeof value === "string" ? value.trim() : ""
}

export function resolvePreferredModel(models = [], preferred = DEFAULT_OLLAMA_MODEL) {
  const list = Array.isArray(models)
    ? models.map(normalizeModelName).filter(Boolean)
    : []
  const desired = normalizeModelName(preferred) || DEFAULT_OLLAMA_MODEL

  const exact = list.find((name) => name === desired)
  if (exact) return exact

  const caseInsensitive = list.find((name) => name.toLowerCase() === desired.toLowerCase())
  if (caseInsensitive) return caseInsensitive

  return list[0] || desired
}

export function loadModelSettings() {
  applySettingsStoreToModelSettings()
  if (!canUseStorage()) return modelSettings

  try {
    const raw = window.localStorage.getItem(MODEL_SETTINGS_KEY)
    if (!raw) return modelSettings

    const parsed = JSON.parse(raw)
    const preferred = normalizeModelName(parsed?.preferredModel)
    if (preferred) {
      modelSettings.preferredModel = preferred
      modelSettings.resolvedModel = preferred
    }
    if (parsed?.provider && PROVIDERS[parsed.provider]) {
      modelSettings.provider = parsed.provider
    }
    if (typeof parsed?.ollamaHost === "string" && parsed.ollamaHost.trim()) {
      modelSettings.ollamaHost = parsed.ollamaHost.trim()
    }
    if (typeof parsed?.openaiApiKey === "string") {
      modelSettings.openaiApiKey = parsed.openaiApiKey
    }
    if (typeof parsed?.openaiBaseURL === "string" && parsed.openaiBaseURL.trim()) {
      modelSettings.openaiBaseURL = parsed.openaiBaseURL.trim()
    }
    if (typeof parsed?.openaiModel === "string" && parsed.openaiModel.trim()) {
      modelSettings.openaiModel = parsed.openaiModel.trim()
    }
    if (typeof parsed?.temperature === "number") {
      modelSettings.temperature = Math.max(0, Math.min(2, parsed.temperature))
    }
    if (typeof parsed?.topP === "number") {
      modelSettings.topP = Math.max(0, Math.min(1, parsed.topP))
    }
    if (typeof parsed?.maxTokens === "number") {
      modelSettings.maxTokens = Math.max(128, Math.min(32768, parsed.maxTokens))
    }
    if (parsed?.completionProvider && COMPLETION_PROVIDERS[parsed.completionProvider]) {
      modelSettings.completionProvider = parsed.completionProvider
    }
    if (typeof parsed?.anthropicApiKey === "string") {
      modelSettings.anthropicApiKey = parsed.anthropicApiKey
    }
    if (typeof parsed?.anthropicBaseURL === "string" && parsed.anthropicBaseURL.trim()) {
      modelSettings.anthropicBaseURL = parsed.anthropicBaseURL.trim()
    }
    if (typeof parsed?.anthropicModel === "string" && parsed.anthropicModel.trim()) {
      modelSettings.anthropicModel = parsed.anthropicModel.trim()
    }
    if (Array.isArray(parsed?.cloudProviders)) {
      modelSettings.cloudProviders = parsed.cloudProviders
        .filter((p) => p && typeof p === "object" && p.id)
        .map((p) => ({
          id: String(p.id),
          name: typeof p.name === "string" ? p.name : "",
          protocol: p.protocol === "anthropic" ? "anthropic" : "openai",
          baseUrl: typeof p.baseUrl === "string" ? p.baseUrl : "",
          apiKey: typeof p.apiKey === "string" ? p.apiKey : "",
          model: typeof p.model === "string" ? p.model : "",
        }))
    }
    if (typeof parsed?.activeCloudProviderId === "string") {
      modelSettings.activeCloudProviderId = parsed.activeCloudProviderId
    }
    if (typeof parsed?.activeAnthropicProviderId === "string") {
      modelSettings.activeAnthropicProviderId = parsed.activeAnthropicProviderId
    }
    if (typeof parsed?.activeOpenAIProviderId === "string") {
      modelSettings.activeOpenAIProviderId = parsed.activeOpenAIProviderId
    }
  } catch {
    // ignore invalid saved settings
  }

  syncModelSettingsToStore()

  return modelSettings
}

export function persistModelSettings() {
  syncModelSettingsToStore()
  if (!canUseStorage()) return
  window.localStorage.setItem(
    MODEL_SETTINGS_KEY,
    JSON.stringify({
      provider: modelSettings.provider,
      preferredModel: modelSettings.preferredModel,
      ollamaHost: modelSettings.ollamaHost,
      openaiApiKey: modelSettings.openaiApiKey,
      openaiBaseURL: modelSettings.openaiBaseURL,
      openaiModel: modelSettings.openaiModel,
      temperature: modelSettings.temperature,
      topP: modelSettings.topP,
      maxTokens: modelSettings.maxTokens,
      completionProvider: modelSettings.completionProvider,
      anthropicApiKey: modelSettings.anthropicApiKey,
      anthropicBaseURL: modelSettings.anthropicBaseURL,
      anthropicModel: modelSettings.anthropicModel,
      cloudProviders: modelSettings.cloudProviders,
      activeCloudProviderId: modelSettings.activeCloudProviderId,
      activeAnthropicProviderId: modelSettings.activeAnthropicProviderId,
      activeOpenAIProviderId: modelSettings.activeOpenAIProviderId,
    }),
  )
}

export function setProvider(providerId) {
  if (!PROVIDERS[providerId]) return
  modelSettings.provider = providerId
  persistModelSettings()
}

export function setPreferredModel(model) {
  const normalized = normalizeModelName(model)
  if (!normalized) return

  modelSettings.preferredModel = normalized
  modelSettings.resolvedModel = resolvePreferredModel(modelSettings.availableModels, normalized)
  persistModelSettings()
}

export function setOllamaHost(host) {
  const trimmed = (host || "").trim()
  if (!trimmed) return
  modelSettings.ollamaHost = trimmed.replace(/\/+$/, "")
  persistModelSettings()
}

export function setOpenAIApiKey(key) {
  modelSettings.openaiApiKey = (key || "").trim()
  persistModelSettings()
}

export function setOpenAIBaseURL(url) {
  modelSettings.openaiBaseURL = (url || "").trim().replace(/\/+$/, "")
  persistModelSettings()
}

export function setOpenAIModel(model) {
  const normalized = normalizeModelName(model)
  if (!normalized) return
  modelSettings.openaiModel = normalized
  persistModelSettings()
}

export function setModelParams({ temperature, topP, maxTokens }) {
  if (typeof temperature === "number") {
    modelSettings.temperature = Math.max(0, Math.min(2, temperature))
  }
  if (typeof topP === "number") {
    modelSettings.topP = Math.max(0, Math.min(1, topP))
  }
  if (typeof maxTokens === "number") {
    modelSettings.maxTokens = Math.max(128, Math.min(32768, maxTokens))
  }
  persistModelSettings()
}

export function syncAvailableModels(models = []) {
  const list = Array.isArray(models)
    ? [...new Set(models.map(normalizeModelName).filter(Boolean))]
    : []
  modelSettings.availableModels = list
  modelSettings.resolvedModel = resolvePreferredModel(list, modelSettings.preferredModel)
  return modelSettings.resolvedModel
}

export function getActiveModel() {
  if (modelSettings.provider === "anthropic") {
    return modelSettings.anthropicModel || "claude-sonnet-4-20250514"
  }
  if (modelSettings.provider === "openai") {
    return modelSettings.openaiModel || "gpt-4o-mini"
  }
  return modelSettings.resolvedModel || modelSettings.preferredModel || DEFAULT_OLLAMA_MODEL
}

export function getModelLabel(model) {
  const name = normalizeModelName(model)
  if (!name) return ""
  if (name.toLowerCase() === DEFAULT_OLLAMA_MODEL.toLowerCase()) return "DeepSeek V4"
  return name
}

export function getOllamaHost() {
  return modelSettings.ollamaHost || DEFAULT_OLLAMA_HOST
}

export function getModelParams() {
  return {
    temperature: modelSettings.temperature,
    top_p: modelSettings.topP,
    num_predict: modelSettings.maxTokens,
  }
}

export function getProviderInfo() {
  return {
    provider: modelSettings.provider,
    ollamaHost: modelSettings.ollamaHost,
    openaiApiKey: modelSettings.openaiApiKey,
    openaiBaseURL: modelSettings.openaiBaseURL,
    openaiModel: modelSettings.openaiModel,
    anthropicApiKey: modelSettings.anthropicApiKey,
    anthropicBaseURL: modelSettings.anthropicBaseURL,
    anthropicModel: modelSettings.anthropicModel,
  }
}

export function setCompletionProvider(providerId) {
  if (!COMPLETION_PROVIDERS[providerId]) return
  modelSettings.completionProvider = providerId
  persistModelSettings()
}

export function setAnthropicApiKey(key) {
  modelSettings.anthropicApiKey = (key || "").trim()
  persistModelSettings()
}

export function setAnthropicBaseURL(url) {
  modelSettings.anthropicBaseURL = (url || "").trim().replace(/\/+$/, "")
  persistModelSettings()
}

export function setAnthropicModel(model) {
  const normalized = normalizeModelName(model)
  if (!normalized) return
  modelSettings.anthropicModel = normalized
  persistModelSettings()
}

function genProviderId() {
  return `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function sanitizeUrl(url) {
  return (url || "").trim().replace(/\/+$/, "")
}

export function addCloudProvider(patch = {}) {
  const entry = {
    id: genProviderId(),
    name: typeof patch.name === "string" && patch.name.trim() ? patch.name.trim() : "新供应商",
    protocol: patch.protocol === "anthropic" ? "anthropic" : "openai",
    baseUrl: sanitizeUrl(patch.baseUrl),
    apiKey: typeof patch.apiKey === "string" ? patch.apiKey : "",
    model: normalizeModelName(patch.model),
  }
  modelSettings.cloudProviders.push(entry)
  persistModelSettings()
  return entry.id
}

export function updateCloudProvider(id, patch = {}) {
  const idx = modelSettings.cloudProviders.findIndex((p) => p.id === id)
  if (idx < 0) return
  const cur = modelSettings.cloudProviders[idx]
  const next = {
    ...cur,
    ...(typeof patch.name === "string" ? { name: patch.name.trim() } : {}),
    ...(patch.protocol === "anthropic" || patch.protocol === "openai" ? { protocol: patch.protocol } : {}),
    ...(typeof patch.baseUrl === "string" ? { baseUrl: sanitizeUrl(patch.baseUrl) } : {}),
    ...(typeof patch.apiKey === "string" ? { apiKey: patch.apiKey } : {}),
    ...(typeof patch.model === "string" ? { model: normalizeModelName(patch.model) } : {}),
  }
  modelSettings.cloudProviders.splice(idx, 1, next)
  if (modelSettings.activeCloudProviderId === id) {
    applyActiveCloudProvider(next)
  }
  persistModelSettings()
}

export function deleteCloudProvider(id) {
  const idx = modelSettings.cloudProviders.findIndex((p) => p.id === id)
  if (idx < 0) return
  modelSettings.cloudProviders.splice(idx, 1)
  if (modelSettings.activeCloudProviderId === id) {
    modelSettings.activeCloudProviderId = ""
  }
  if (modelSettings.activeAnthropicProviderId === id) {
    modelSettings.activeAnthropicProviderId = ""
  }
  if (modelSettings.activeOpenAIProviderId === id) {
    modelSettings.activeOpenAIProviderId = ""
  }
  persistModelSettings()
}

function applyActiveCloudProvider(entry) {
  if (!entry) return
  if (entry.protocol === "anthropic") {
    modelSettings.anthropicApiKey = entry.apiKey || modelSettings.anthropicApiKey
    if (entry.baseUrl) modelSettings.anthropicBaseURL = entry.baseUrl
    if (entry.model) modelSettings.anthropicModel = entry.model
    modelSettings.provider = "anthropic"
  } else {
    modelSettings.openaiApiKey = entry.apiKey || modelSettings.openaiApiKey
    if (entry.baseUrl) modelSettings.openaiBaseURL = entry.baseUrl
    if (entry.model) modelSettings.openaiModel = entry.model
    modelSettings.provider = "openai"
  }
}

export function activateCloudProvider(id) {
  const entry = modelSettings.cloudProviders.find((p) => p.id === id)
  if (!entry) return
  modelSettings.activeCloudProviderId = id
  if (entry.protocol === "anthropic") {
    modelSettings.activeAnthropicProviderId = id
  } else {
    modelSettings.activeOpenAIProviderId = id
  }
  applyActiveCloudProvider(entry)
  persistModelSettings()
}

export function getActiveProviderForType(type) {
  const normalized = type === "claude" ? "anthropic" : type
  if (normalized === "anthropic") {
    const id = modelSettings.activeAnthropicProviderId
    return modelSettings.cloudProviders.find((p) => p.id === id && p.protocol === "anthropic")
  }
  if (normalized === "openai") {
    const id = modelSettings.activeOpenAIProviderId
    return modelSettings.cloudProviders.find((p) => p.id === id && p.protocol === "openai")
  }
  return undefined
}

export function getCompletionConfig() {
  return {
    completionProvider: modelSettings.completionProvider,
    ollamaHost: modelSettings.ollamaHost,
    ollamaModel: modelSettings.resolvedModel || modelSettings.preferredModel,
    openaiApiKey: modelSettings.openaiApiKey,
    openaiBaseURL: modelSettings.openaiBaseURL,
    openaiModel: modelSettings.openaiModel,
  }
}

export function loadLangSettings() {
  applySettingsStoreToLangSettings()
  if (!canUseStorage()) return

  try {
    const raw = window.localStorage.getItem(LANG_SETTINGS_KEY)
    if (!raw) return

    const parsed = JSON.parse(raw)
    if (parsed?.jdkVersion && JDK_VERSIONS.some((v) => v.value === parsed.jdkVersion)) {
      langSettings.jdkVersion = parsed.jdkVersion
    }
    if (Array.isArray(parsed?.enabledLanguages)) {
      langSettings.enabledLanguages = parsed.enabledLanguages.filter((id) =>
        Object.prototype.hasOwnProperty.call(LANGUAGE_SUPPORTS, id),
      )
    }
    if (typeof parsed?.jdkPath === "string") {
      langSettings.jdkPath = parsed.jdkPath
    }
    if (typeof parsed?.pythonPath === "string") {
      langSettings.pythonPath = parsed.pythonPath
    }
  } catch {
    // ignore
  }

  syncLangSettingsToStore()
}

export function persistLangSettings() {
  syncLangSettingsToStore()
  if (!canUseStorage()) return
  window.localStorage.setItem(
    LANG_SETTINGS_KEY,
    JSON.stringify({
      jdkVersion: langSettings.jdkVersion,
      enabledLanguages: langSettings.enabledLanguages,
      jdkPath: langSettings.jdkPath,
      pythonPath: langSettings.pythonPath,
    }),
  )
}

export function setJdkVersion(version) {
  if (!JDK_VERSIONS.some((v) => v.value === version)) return
  langSettings.jdkVersion = version
  persistLangSettings()
}

export function setJdkPath(path) {
  langSettings.jdkPath = path || ""
  persistLangSettings()
}

export function setPythonPath(path) {
  langSettings.pythonPath = path || ""
  persistLangSettings()
}

export function toggleLanguage(langId) {
  if (!Object.prototype.hasOwnProperty.call(LANGUAGE_SUPPORTS, langId)) return
  const idx = langSettings.enabledLanguages.indexOf(langId)
  if (idx >= 0) {
    langSettings.enabledLanguages.splice(idx, 1)
  } else {
    langSettings.enabledLanguages.push(langId)
  }
  persistLangSettings()
}

export function isLanguageEnabled(langId) {
  return langSettings.enabledLanguages.includes(langId)
}

function applySettingsStoreToModelSettings() {
  const provider = settingsStore.get("codek.ai.provider")
  if (typeof provider === "string" && PROVIDERS[provider]) {
    modelSettings.provider = provider
  }

  const model = settingsStore.get("codek.ai.model")
  if (typeof model === "string" && model.trim()) {
    modelSettings.preferredModel = model.trim()
    modelSettings.resolvedModel = resolvePreferredModel(modelSettings.availableModels, model.trim())
  }

  const baseUrl = settingsStore.get("codek.ai.baseUrl")
  if (typeof baseUrl === "string" && baseUrl.trim()) {
    modelSettings.openaiBaseURL = baseUrl.trim().replace(/\/+$/, "")
  }

  const temperature = settingsStore.get("codek.ai.temperature")
  if (typeof temperature === "number") {
    modelSettings.temperature = Math.max(0, Math.min(2, temperature))
  }

  const topP = settingsStore.get("codek.ai.topP")
  if (typeof topP === "number") {
    modelSettings.topP = Math.max(0, Math.min(1, topP))
  }

  const maxTokens = settingsStore.get("codek.ai.maxTokens")
  if (typeof maxTokens === "number") {
    modelSettings.maxTokens = Math.max(128, Math.min(32768, maxTokens))
  }
}

function syncModelSettingsToStore() {
  settingsStore.update({
    "codek.ai.provider": modelSettings.provider,
    "codek.ai.model": modelSettings.preferredModel,
    "codek.ai.baseUrl": modelSettings.openaiBaseURL,
    "codek.ai.temperature": modelSettings.temperature,
    "codek.ai.topP": modelSettings.topP,
    "codek.ai.maxTokens": modelSettings.maxTokens,
  })
}

function applySettingsStoreToLangSettings() {
  const jdkVersion = settingsStore.get("codek.languages.jdkVersion")
  if (typeof jdkVersion === "string" && JDK_VERSIONS.some((v) => v.value === jdkVersion)) {
    langSettings.jdkVersion = jdkVersion
  }

  const jdkPath = settingsStore.get("codek.languages.jdkPath")
  if (typeof jdkPath === "string") {
    langSettings.jdkPath = jdkPath
  }

  const pythonPath = settingsStore.get("codek.languages.pythonPath")
  if (typeof pythonPath === "string") {
    langSettings.pythonPath = pythonPath
  }

  const enabledLanguages = settingsStore.get("codek.languages.enabled")
  if (Array.isArray(enabledLanguages)) {
    langSettings.enabledLanguages = enabledLanguages.filter((id) =>
      typeof id === "string" && Object.prototype.hasOwnProperty.call(LANGUAGE_SUPPORTS, id),
    )
  }
}

function syncLangSettingsToStore() {
  settingsStore.update({
    "codek.languages.jdkVersion": langSettings.jdkVersion,
    "codek.languages.jdkPath": langSettings.jdkPath,
    "codek.languages.pythonPath": langSettings.pythonPath,
    "codek.languages.enabled": [...langSettings.enabledLanguages],
  })
}

settingsStore.subscribe(() => {
  applySettingsStoreToModelSettings()
  applySettingsStoreToLangSettings()
})
