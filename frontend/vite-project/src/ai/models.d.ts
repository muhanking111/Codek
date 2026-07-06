export const DEFAULT_OLLAMA_MODEL: string
export const DEFAULT_OLLAMA_HOST: string
export const PROVIDERS: Record<string, { id: string; label: string; defaultHost: string }>
export const COMPLETION_PROVIDERS: Record<string, { id: string; label: string; apiHost: string }>
export const JDK_VERSIONS: Array<{ value: string; label: string }>
export const LANGUAGE_SUPPORTS: Record<string, unknown>

export interface LangSettingsState {
  jdkVersion?: string
  jdkPath?: string
  pythonPath?: string
  [key: string]: unknown
}

/** Vue reactive — 运行时由 models.js 提供 */
export interface ModelSettingsState {
  provider: string
  preferredModel: string
  resolvedModel: string
  availableModels: unknown[]
  ollamaHost: string
  openaiApiKey: string
  openaiBaseURL: string
  openaiModel: string
  temperature: number
  topP: number
  maxTokens: number
  completionProvider: string
  anthropicApiKey: string
  anthropicBaseURL: string
  anthropicModel: string
  cloudProviders: CloudProvider[]
  activeCloudProviderId: string
  activeAnthropicProviderId: string
  activeOpenAIProviderId: string
  [key: string]: unknown
}

export interface CloudProvider {
  id: string
  name: string
  protocol: "openai" | "anthropic"
  baseUrl: string
  apiKey: string
  model: string
}

export const modelSettings: ModelSettingsState
export const langSettings: LangSettingsState

export function resolvePreferredModel(models?: unknown[], preferred?: string): unknown
export function loadModelSettings(): void
export function persistModelSettings(): void
export function setProvider(providerId: string): void
export function setPreferredModel(model: string): void
export function setOllamaHost(host: string): void
export function setOpenAIApiKey(key: string): void
export function setOpenAIBaseURL(url: string): void
export function setOpenAIModel(model: string): void
export function setModelParams(params: { temperature?: number; topP?: number; maxTokens?: number }): void
export function syncAvailableModels(models?: unknown[]): void
export function getActiveModel(): string
export function getModelLabel(model?: string): string
export function getOllamaHost(): string
export function getModelParams(): { temperature?: number; top_p?: number; max_tokens?: number; num_predict?: number }
export function getProviderInfo(): {
  provider: string
  openaiApiKey?: string
  openaiBaseURL?: string
  openaiModel?: string
}
export function setCompletionProvider(providerId: string): void
export function setAnthropicApiKey(key: string): void
export function setAnthropicBaseURL(url: string): void
export function setAnthropicModel(model: string): void
export function getCompletionConfig(): Record<string, unknown>
export function loadLangSettings(): void
export function persistLangSettings(): void
export function setJdkVersion(version: string): void
export function setJdkPath(path: string): void
export function setPythonPath(path: string): void
export function toggleLanguage(langId: string): void
export function isLanguageEnabled(langId: string): boolean
export function activateCloudProvider(id: string): void
export function deleteCloudProvider(id: string): void
export function addCloudProvider(patch?: Partial<CloudProvider>): string
export function updateCloudProvider(id: string, patch?: Partial<CloudProvider>): void
export function getActiveProviderForType(type: "openai" | "claude" | "anthropic"): CloudProvider | undefined
