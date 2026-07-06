import { reactive } from "vue"

export interface AgentProviderRequest {
  message: string
  conversation: Array<{ role: "user" | "assistant"; content: string }>
  attachments?: Array<{ path: string; content?: string }>
  signal?: AbortSignal
}

export interface AgentProviderChunk {
  type: "text" | "tool" | "done" | "error"
  content?: string
  toolName?: string
  toolInput?: unknown
  toolOutput?: unknown
  error?: string
}

export interface AgentProvider {
  id: string
  label: string
  description?: string
  icon?: string
  source: "builtin" | "extension"
  extensionId?: string
  send(request: AgentProviderRequest): AsyncIterable<AgentProviderChunk>
}

interface AgentProviderState {
  providers: AgentProvider[]
  activeId: string | null
}

const STORAGE_KEY = "codek-active-agent-provider"

function loadActiveId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export const agentProviderState: AgentProviderState = reactive({
  providers: [],
  activeId: loadActiveId(),
})

export function registerAgentProvider(provider: AgentProvider): () => void {
  const idx = agentProviderState.providers.findIndex((p) => p.id === provider.id)
  if (idx >= 0) {
    agentProviderState.providers[idx] = provider
  } else {
    agentProviderState.providers.push(provider)
  }
  if (!agentProviderState.activeId) {
    agentProviderState.activeId = provider.id
  }
  return () => unregisterAgentProvider(provider.id)
}

export function unregisterAgentProvider(id: string): void {
  agentProviderState.providers = agentProviderState.providers.filter((p) => p.id !== id)
  if (agentProviderState.activeId === id) {
    agentProviderState.activeId = agentProviderState.providers[0]?.id ?? null
    persistActiveId()
  }
}

export function setActiveAgent(id: string | null): void {
  agentProviderState.activeId = id
  persistActiveId()
}

export function getActiveAgent(): AgentProvider | null {
  if (!agentProviderState.activeId) return null
  return agentProviderState.providers.find((p) => p.id === agentProviderState.activeId) ?? null
}

function persistActiveId(): void {
  try {
    if (agentProviderState.activeId) {
      localStorage.setItem(STORAGE_KEY, agentProviderState.activeId)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // storage unavailable
  }
}
