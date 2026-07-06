export type AgentEventType =
  | 'command-executed'
  | 'file-changed'
  | 'git-operation'
  | 'diff-available'
  | 'workspace-file-operation'
  | 'agent-lifecycle'

export interface AgentEvent {
  type: AgentEventType
  payload: Record<string, unknown>
}

type AgentEventListener = (event: AgentEvent) => void

const listeners: AgentEventListener[] = []

export function onAgentEvent(listener: AgentEventListener): () => void {
  listeners.push(listener)
  return () => {
    const idx = listeners.indexOf(listener)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}

export function emitAgentEvent(event: AgentEvent): void {
  for (const listener of listeners) {
    listener(event)
  }
}
