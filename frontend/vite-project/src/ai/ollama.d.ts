export async function callOllama(opts: {
  model: string
  messages: Array<{ role: string; content: string }>
}): Promise<Response>

export async function callOllamaSync(opts: {
  model: string
  messages: Array<{ role: string; content: string }>
}): Promise<string>

export async function listModels(): Promise<string[]>
export async function ping(): Promise<boolean>
