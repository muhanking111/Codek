import type {
  Request,
  Response,
  Event as DapEvent,
  ProtocolMessage,
  DapCommand,
  DapRequestMap,
  DapEventType,
  DapEventMap,
  Capabilities,
} from "./dapProtocol"

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

export interface DapIpcTransport {
  start(adapterType: string, config: Record<string, unknown>): Promise<string>
  stop(sessionId: string): Promise<void>
  send(sessionId: string, message: string): Promise<void>
  onEvent(callback: (message: string) => void): () => void
}

const TRANSPORT_UNAVAILABLE = "DAP transport unavailable: window.codek.dap API not found"

class CodekDapTransport implements DapIpcTransport {
  async start(adapterType: string, config: Record<string, unknown>): Promise<string> {
    if (!window.codek?.dap?.start) {
      throw new Error(TRANSPORT_UNAVAILABLE)
    }
    const result = await window.codek.dap.start(adapterType, config)
    if (typeof result === "string") return result
    const record = result as { sessionId?: string }
    if (record?.sessionId) return record.sessionId
    throw new Error("DAP transport returned no sessionId")
  }

  async stop(sessionId: string): Promise<void> {
    if (!window.codek?.dap?.stop) return
    await window.codek.dap.stop(sessionId)
  }

  async send(sessionId: string, message: string): Promise<void> {
    if (!window.codek?.dap?.send) {
      throw new Error(TRANSPORT_UNAVAILABLE)
    }
    await window.codek.dap.send(sessionId, message)
  }

  onEvent(callback: (message: string) => void): () => void {
    if (!window.codek?.dap?.onEvent) {
      return () => {}
    }
    return window.codek.dap.onEvent((payload) => {
      const message = typeof payload === "string" ? payload : payload.message
      if (message) callback(message)
    })
  }
}

export function createCodekTransport(): DapIpcTransport {
  return new CodekDapTransport()
}

export class DapClient {
  private seq = 1
  private sessionId: string | null = null
  private pendingRequests = new Map<number, PendingRequest>()
  private eventListeners = new Map<string, Set<(body: unknown) => void>>()
  private transport: DapIpcTransport
  private removeIpcListener: (() => void) | null = null
  private capabilities: Capabilities | null = null
  private connected = false

  constructor(transport: DapIpcTransport) {
    this.transport = transport
  }

  get isConnected(): boolean {
    return this.connected
  }

  get adapterCapabilities(): Capabilities | null {
    return this.capabilities
  }

  async connect(adapterType: string, config: Record<string, unknown>): Promise<string> {
    const sid = await this.transport.start(adapterType, config)
    this.sessionId = sid
    this.connected = true

    this.removeIpcListener = this.transport.onEvent((raw) => {
      this.handleRawMessage(raw)
    })

    return sid
  }

  async disconnect(): Promise<void> {
    if (!this.sessionId) return

    this.rejectAllPending(new Error("DAP session disconnected"))

    if (this.removeIpcListener) {
      this.removeIpcListener()
      this.removeIpcListener = null
    }

    try {
      await this.transport.stop(this.sessionId)
    } catch {
      // stop errors are non-critical
    }

    this.sessionId = null
    this.connected = false
    this.capabilities = null
  }

  sendRequest<C extends DapCommand>(
    command: C,
    args?: DapRequestMap[C]["args"],
  ): Promise<DapRequestMap[C]["result"]> {
    if (!this.sessionId || !this.connected) {
      return Promise.reject(new Error("DAP client not connected"))
    }

    const currentSeq = this.seq++
    const request: Request = {
      seq: currentSeq,
      type: "request",
      command,
    }

    if (args !== undefined && args !== null) {
      request.arguments = args as Record<string, unknown>
    }

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(currentSeq, { resolve, reject })
    })

    this.transport.send(this.sessionId, JSON.stringify(request)).catch((err: unknown) => {
      const pending = this.pendingRequests.get(currentSeq)
      if (pending) {
        this.pendingRequests.delete(currentSeq)
        pending.reject(err instanceof Error ? err : new Error(String(err)))
      }
    })

    return promise as Promise<DapRequestMap[C]["result"]>
  }

  on<E extends DapEventType>(
    eventType: E,
    listener: (body: DapEventMap[E]) => void,
  ): () => void {
    const typedListener = listener as (body: unknown) => void
    let listeners = this.eventListeners.get(eventType)
    if (!listeners) {
      listeners = new Set()
      this.eventListeners.set(eventType, listeners)
    }
    listeners.add(typedListener)

    return () => {
      const existing = this.eventListeners.get(eventType)
      if (existing) {
        existing.delete(typedListener)
      }
    }
  }

  removeAllListeners(): void {
    this.eventListeners.clear()
  }

  private handleRawMessage(raw: string): void {
    const message = this.parseMessage(raw)
    if (!message) return

    if (message.type === "response") {
      this.handleResponse(message as Response)
    } else if (message.type === "event") {
      this.handleEvent(message as DapEvent)
    }
  }

  private parseMessage(raw: string): ProtocolMessage | null {
    try {
      return JSON.parse(raw) as ProtocolMessage
    } catch {
      return null
    }
  }

  private handleResponse(response: Response): void {
    const pending = this.pendingRequests.get(response.request_seq)
    if (!pending) return

    this.pendingRequests.delete(response.request_seq)

    if (response.success) {
      pending.resolve(response.body ?? {})
    } else {
      const errorMsg = response.message ?? `DAP request failed: ${response.command}`
      pending.reject(new Error(errorMsg))
    }
  }

  private handleEvent(event: DapEvent): void {
    const listeners = this.eventListeners.get(event.event)
    if (!listeners || listeners.size === 0) return

    const body = event.body ?? {}
    for (const listener of listeners) {
      try {
        listener(body)
      } catch {
        // listener errors must not break the event dispatch loop
      }
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      pending.reject(error)
    }
    this.pendingRequests.clear()
  }
}
