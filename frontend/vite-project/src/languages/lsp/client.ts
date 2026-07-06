// @ts-nocheck
import type {
  InitializeParams,
  InitializeResult,
  DidOpenTextDocumentParams,
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  DidSaveTextDocumentParams,
  CompletionParams,
  CompletionList,
  HoverParams,
  Hover,
  CodeLens,
  CodeLensParams,
  DefinitionParams,
  Definition,
  DefinitionLink,
  ReferenceParams,
  Location,
  RenameParams,
  WorkspaceEdit,
  PrepareRenameParams,
  PrepareRenameResult,
  DocumentSymbolParams,
  DocumentSymbol,
  WorkspaceSymbolParams,
  WorkspaceSymbol,
  CodeActionParams,
  CodeAction,
  Command,
  SignatureHelpParams,
  SignatureHelp,
  LSPAny,
} from "./protocol"
import { getBoundLspModelDocumentByModelUri } from "./modelBinding"

interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number | string
  method: string
  params?: LSPAny
}

interface JsonRpcNotification {
  jsonrpc: "2.0"
  method: string
  params?: LSPAny
}

interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: number | string
  result?: LSPAny
  error?: JsonRpcError
}

interface JsonRpcError {
  code: number
  message: string
  data?: LSPAny
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse

const JSON_RPC_VERSION = "2.0" as const
const REQUEST_TIMEOUT_MS = 30_000

type ResponseResolver = {
  resolve: (value: LSPAny) => void
  reject: (reason: Error) => void
}

type NotificationHandler = (params: LSPAny) => void

export interface LspTransport {
  send(message: string): void
  onMessage(handler: (message: string) => void): () => void
}

function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return "id" in msg && ("result" in msg || "error" in msg)
}

function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return "id" in msg && "method" in msg
}

function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return !("id" in msg) && "method" in msg
}

function parseMessage(raw: string): JsonRpcMessage | null {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && parsed.jsonrpc === JSON_RPC_VERSION) {
      return parsed as JsonRpcMessage
    }
    return null
  } catch {
    return null
  }
}

function createRequest(id: number, method: string, params?: LSPAny): JsonRpcRequest {
  const msg: JsonRpcRequest = { jsonrpc: JSON_RPC_VERSION, id, method }
  if (params !== undefined) msg.params = params
  return msg
}

function createNotification(method: string, params?: LSPAny): JsonRpcNotification {
  const msg: JsonRpcNotification = { jsonrpc: JSON_RPC_VERSION, method }
  if (params !== undefined) msg.params = params
  return msg
}

export class LspClient {
  private nextId = 1
  private readonly pending = new Map<number | string, ResponseResolver>()
  private readonly notificationHandlers = new Map<string, NotificationHandler>()
  private readonly requestHandlers = new Map<string, (id: number | string, params: LSPAny) => void>()
  private readonly transport: LspTransport
  private removeTransportListener: (() => void) | null = null
  private serverCapabilities: InitializeResult | null = null
  private initialized = false

  constructor(transport: LspTransport) {
    this.transport = transport
    this.removeTransportListener = transport.onMessage((raw) => this.handleMessage(raw))
  }

  getCapabilities(): InitializeResult | null {
    return this.serverCapabilities
  }

  isInitialized(): boolean {
    return this.initialized
  }

  onNotification(method: string, handler: NotificationHandler): () => void {
    this.notificationHandlers.set(method, handler)
    return () => this.notificationHandlers.delete(method)
  }

  onRequest(method: string, handler: (id: number | string, params: LSPAny) => void): () => void {
    this.requestHandlers.set(method, handler)
    return () => this.requestHandlers.delete(method)
  }

  async initialize(params: InitializeParams): Promise<InitializeResult> {
    const result = await this.sendRequest<InitializeResult>("initialize", params)
    this.serverCapabilities = result
    this.sendNotification("initialized", {})
    this.initialized = true
    return result
  }

  async shutdown(): Promise<void> {
    await this.sendRequest<null>("shutdown")
    this.sendNotification("exit")
    this.initialized = false
  }

  dispose(): void {
    for (const [, resolver] of this.pending) {
      resolver.reject(new Error("Client disposed"))
    }
    this.pending.clear()
    this.notificationHandlers.clear()
    this.requestHandlers.clear()
    if (this.removeTransportListener) {
      this.removeTransportListener()
      this.removeTransportListener = null
    }
    this.initialized = false
  }

  notifyDidOpen(params: DidOpenTextDocumentParams): void {
    this.sendNotification("textDocument/didOpen", params as unknown as LSPAny)
  }

  notifyDidChange(params: DidChangeTextDocumentParams): void {
    this.sendNotification("textDocument/didChange", params as unknown as LSPAny)
  }

  notifyDidClose(params: DidCloseTextDocumentParams): void {
    this.sendNotification("textDocument/didClose", params as unknown as LSPAny)
  }

  notifyDidSave(params: DidSaveTextDocumentParams): void {
    this.sendNotification("textDocument/didSave", params as unknown as LSPAny)
  }

  requestCompletion(params: CompletionParams): Promise<CompletionList | null> {
    return this.sendRequest<CompletionList | null>("textDocument/completion", params as unknown as LSPAny)
  }

  requestHover(params: HoverParams): Promise<Hover | null> {
    return this.sendRequest<Hover | null>("textDocument/hover", params as unknown as LSPAny)
  }

  requestDefinition(params: DefinitionParams): Promise<Definition | DefinitionLink | null> {
    return this.sendRequest<Definition | DefinitionLink | null>("textDocument/definition", params as unknown as LSPAny)
  }

  requestReferences(params: ReferenceParams): Promise<Location[] | null> {
    return this.sendRequest<Location[] | null>("textDocument/references", params as unknown as LSPAny)
  }

  requestRename(params: RenameParams): Promise<WorkspaceEdit | null> {
    return this.sendRequest<WorkspaceEdit | null>("textDocument/rename", params as unknown as LSPAny)
  }

  requestPrepareRename(params: PrepareRenameParams): Promise<PrepareRenameResult | null> {
    return this.sendRequest<PrepareRenameResult | null>("textDocument/prepareRename", params as unknown as LSPAny)
  }

  requestDocumentSymbol(params: DocumentSymbolParams): Promise<DocumentSymbol[] | null> {
    return this.sendRequest<DocumentSymbol[] | null>("textDocument/documentSymbol", params as unknown as LSPAny)
  }

  requestWorkspaceSymbol(params: WorkspaceSymbolParams): Promise<WorkspaceSymbol[] | null> {
    return this.sendRequest<WorkspaceSymbol[] | null>("workspace/symbol", params as unknown as LSPAny)
  }

  requestCodeAction(params: CodeActionParams): Promise<(CodeAction | Command)[] | null> {
    return this.sendRequest<(CodeAction | Command)[] | null>("textDocument/codeAction", params as unknown as LSPAny)
  }

  requestCodeLens(params: CodeLensParams): Promise<CodeLens[] | null> {
    return this.sendRequest<CodeLens[] | null>("textDocument/codeLens", params as unknown as LSPAny)
  }

  resolveCodeLens(codeLens: CodeLens): Promise<CodeLens | null> {
    return this.sendRequest<CodeLens | null>("codeLens/resolve", codeLens as unknown as LSPAny)
  }

  requestSignatureHelp(params: SignatureHelpParams): Promise<SignatureHelp | null> {
    return this.sendRequest<SignatureHelp | null>("textDocument/signatureHelp", params as unknown as LSPAny)
  }

  private sendRequest<T>(method: string, params?: LSPAny): Promise<T> {
    const id = this.nextId++
    const msg = createRequest(id, method, params)
    const serialized = JSON.stringify(msg)

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`LSP request timed out: ${method} (id=${id})`))
      }, REQUEST_TIMEOUT_MS)

      this.pending.set(id, {
        resolve: (value: LSPAny) => {
          clearTimeout(timer)
          this.pending.delete(id)
          resolve(value as T)
        },
        reject: (reason: Error) => {
          clearTimeout(timer)
          this.pending.delete(id)
          reject(reason)
        },
      })

      this.transport.send(serialized)
    })
  }

  private sendNotification(method: string, params?: LSPAny): void {
    const msg = createNotification(method, params)
    const serialized = JSON.stringify(msg)
    this.transport.send(serialized)
  }

  private handleMessage(raw: string): void {
    const msg = parseMessage(raw)
    if (!msg) return

    if (isResponse(msg)) {
      this.handleResponse(msg)
    } else if (isRequest(msg)) {
      this.handleIncomingRequest(msg)
    } else if (isNotification(msg)) {
      this.handleIncomingNotification(msg)
    }
  }

  private handleResponse(msg: JsonRpcResponse): void {
    const resolver = this.pending.get(msg.id)
    if (!resolver) return

    if (msg.error) {
      const error = new Error(`LSP error ${msg.error.code}: ${msg.error.message}`)
      resolver.reject(error)
    } else {
      resolver.resolve(msg.result ?? null)
    }
  }

  private handleIncomingNotification(msg: JsonRpcNotification): void {
    const handler = this.notificationHandlers.get(msg.method)
    if (handler) handler(msg.params ?? null)
  }

  private handleIncomingRequest(msg: JsonRpcRequest): void {
    const handler = this.requestHandlers.get(msg.method)
    if (handler) handler(msg.id, msg.params ?? null)
  }
}

export class IpcTransport implements LspTransport {
  private readonly serverId: string
  private readonly listeners = new Set<(message: string) => void>()
  private removeIpcListener: (() => void) | null = null

  constructor(serverId: string) {
    this.serverId = serverId
    this.setupIpcListener()
  }

  send(message: string): void {
    window.codek?.lsp?.send(this.serverId, message)
  }

  onMessage(handler: (message: string) => void): () => void {
    this.listeners.add(handler)
    return () => this.listeners.delete(handler)
  }

  private setupIpcListener(): void {
    this.removeIpcListener?.()
    this.removeIpcListener = window.codek?.lsp?.onMessage?.((payload: { serverId?: string; message?: string } | string) => {
      if (typeof payload === "string") return
      if (!payload || payload.serverId !== this.serverId || typeof payload.message !== "string") return
      for (const listener of this.listeners) {
        try {
          listener(payload.message)
        } catch {
          // prevent one failing listener from blocking others
        }
      }
    })
  }
}

export function createIpcClient(serverId: string): LspClient {
  const transport = new IpcTransport(serverId)
  return new LspClient(transport)
}

export function monacoUriToLspDocUri(uri: { toString(): string }): string {
  const monacoUri = uri.toString()
  return getBoundLspModelDocumentByModelUri(monacoUri)?.documentUri ?? monacoUri
}

export function lspDocUriToMonacoUri(docUri: string): string {
  return docUri
}
