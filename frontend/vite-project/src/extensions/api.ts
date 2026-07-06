import {
  registerAgentProvider,
  type AgentProvider,
  type AgentProviderRequest,
  type AgentProviderChunk,
} from "../ai/agentProviders"

export class Disposable {
  _callback: (() => void) | null
  _disposed: boolean

  constructor(callback: () => void) {
    this._callback = callback
    this._disposed = false
  }

  dispose(): void {
    if (!this._disposed && this._callback) {
      this._disposed = true
      this._callback()
      this._callback = null
    }
  }
}

export interface CodekHost {
  showMessage(msg: string): void
  registerSidebarView(id: string, title: string): void
  executeCommand(id: string, ...args: unknown[]): Promise<unknown>
  onDidSaveFile(cb: (path: string) => void): Disposable
  onDidOpenFile(cb: (path: string) => void): Disposable
}

export interface ExtensionAgentProviderInput {
  id: string
  label: string
  description?: string
  icon?: string
  send: (request: AgentProviderRequest) => AsyncIterable<AgentProviderChunk>
}

export class CodekExtensionAPI {
  context: Record<string, unknown>
  extensionId: string
  _subscriptions: Disposable[]

  constructor(context: Record<string, unknown>, extensionId = "unknown") {
    this.context = context
    this.extensionId = extensionId
    this._subscriptions = []
  }

  subscribe(disposable: Disposable): Disposable {
    this._subscriptions.push(disposable)
    return disposable
  }

  registerAgentProvider(provider: ExtensionAgentProviderInput): Disposable {
    const full: AgentProvider = {
      id: provider.id,
      label: provider.label,
      description: provider.description,
      icon: provider.icon,
      source: "extension",
      extensionId: this.extensionId,
      send: provider.send,
    }
    const unreg = registerAgentProvider(full)
    return this.subscribe(new Disposable(unreg))
  }

  dispose(): void {
    for (const sub of this._subscriptions) {
      try { sub.dispose() } catch { /* ignore */ }
    }
    this._subscriptions = []
  }
}
