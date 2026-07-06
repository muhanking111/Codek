export function createOpenAIClient(config?: {
  baseURL?: string
  apiKey?: string
  defaultModel?: string
}): {
  chat(opts?: Record<string, unknown>): Promise<Response>
  chatSync(options?: Record<string, unknown>): Promise<string>
  listModels(): Promise<string[]>
  testConnection(): Promise<boolean>
}
