// @ts-nocheck
import type {
  InitializeParams,
  ClientCapabilities,
  TextDocumentItem,
  VersionedTextDocumentIdentifier,
  TextDocumentContentChangeEvent,
  TextDocumentIdentifier,
  PublishDiagnosticsParams,
  DocumentUri,
  LSPAny,
} from "./protocol"
import { LspClient, IpcTransport } from "./client"
import { detectLanguageForPath } from "../languageRegistry"

export interface LspServerConfig {
  id: string
  command: string
  args: string[]
  languages: string[]
  filePatterns?: string[]
  initializationOptions?: LSPAny
  cwd?: string
  env?: Record<string, string>
}

interface ManagedServer {
  config: LspServerConfig
  client: LspClient
  status: ServerStatus
  documentVersions: Map<string, number>
  openDocuments: Set<string>
}

export type ServerStatus = "starting" | "running" | "stopped" | "error"

export type DiagnosticHandler = (serverId: string, params: PublishDiagnosticsParams) => void
export type StatusChangeHandler = (serverId: string, status: ServerStatus) => void

const DEFAULT_CLIENT_INFO = { name: "Codek", version: "1.0.0" }

export class LanguageServerManager {
  private readonly servers = new Map<string, ManagedServer>()
  private readonly diagnosticHandlers = new Set<DiagnosticHandler>()
  private readonly statusHandlers = new Set<StatusChangeHandler>()
  private rootUri: DocumentUri | null = null

  setRootUri(uri: DocumentUri): void {
    this.rootUri = uri
  }

  getRootUri(): DocumentUri | null {
    return this.rootUri
  }

  onDiagnostics(handler: DiagnosticHandler): () => void {
    this.diagnosticHandlers.add(handler)
    return () => this.diagnosticHandlers.delete(handler)
  }

  onStatusChange(handler: StatusChangeHandler): () => void {
    this.statusHandlers.add(handler)
    return () => this.statusHandlers.delete(handler)
  }

  async startServer(config: LspServerConfig): Promise<void> {
    const existing = this.servers.get(config.id)
    if (existing && existing.status === "running") return

    this.updateStatus(config.id, "starting")

    try {
      await window.codek?.lsp?.start(config.id, {
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        env: config.env,
      })

      const transport = new IpcTransport(config.id)
      const client = new LspClient(transport)

      client.onNotification("textDocument/publishDiagnostics", (params) => {
        this.emitDiagnostics(config.id, params as unknown as PublishDiagnosticsParams)
      })

      const initParams = this.buildInitializeParams(config)
      await client.initialize(initParams)

      const managed: ManagedServer = {
        config,
        client,
        status: "running",
        documentVersions: new Map(),
        openDocuments: new Set(),
      }
      this.servers.set(config.id, managed)
      this.updateStatus(config.id, "running")
    } catch (error) {
      this.updateStatus(config.id, "error")
      throw error
    }
  }

  async stopServer(serverId: string): Promise<void> {
    const managed = this.servers.get(serverId)
    if (!managed) return

    try {
      if (managed.client.isInitialized()) {
        await managed.client.shutdown()
      }
      managed.client.dispose()
    } catch {
      // server may already be dead
    }

    await window.codek?.lsp?.stop(serverId)

    managed.status = "stopped"
    managed.openDocuments.clear()
    managed.documentVersions.clear()
    this.updateStatus(serverId, "stopped")
  }

  async restartServer(serverId: string): Promise<void> {
    const managed = this.servers.get(serverId)
    if (!managed) return
    await this.stopServer(serverId)
    await this.startServer(managed.config)
  }

  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.servers.keys()).map((id) => this.stopServer(id))
    await Promise.allSettled(stopPromises)
  }

  getClient(serverId: string): LspClient | null {
    return this.servers.get(serverId)?.client ?? null
  }

  getServerStatus(serverId: string): ServerStatus {
    return this.servers.get(serverId)?.status ?? "stopped"
  }

  resolveServerForFile(filePath: string): string | null {
    const languageId = detectLanguageForPath(filePath)
    for (const [serverId, managed] of this.servers) {
      if (managed.status !== "running") continue
      if (managed.config.languages.includes(languageId)) return serverId
      if (matchesFilePattern(filePath, managed.config.filePatterns)) return serverId
    }
    return null
  }

  resolveServerForLanguage(languageId: string): string | null {
    for (const [serverId, managed] of this.servers) {
      if (managed.status !== "running") continue
      if (managed.config.languages.includes(languageId)) return serverId
    }
    return null
  }

  didOpen(serverId: string, document: TextDocumentItem): void {
    const managed = this.servers.get(serverId)
    if (!managed || managed.status !== "running") return

    managed.openDocuments.add(document.uri)
    managed.documentVersions.set(document.uri, document.version)
    managed.client.notifyDidOpen({ textDocument: document })
  }

  didChange(
    serverId: string,
    uri: DocumentUri,
    contentChanges: TextDocumentContentChangeEvent[],
  ): void {
    const managed = this.servers.get(serverId)
    if (!managed || managed.status !== "running") return
    if (!managed.openDocuments.has(uri)) return

    const version = (managed.documentVersions.get(uri) ?? 0) + 1
    managed.documentVersions.set(uri, version)

    const textDocument: VersionedTextDocumentIdentifier = { uri, version }
    managed.client.notifyDidChange({ textDocument, contentChanges })
  }

  didClose(serverId: string, uri: DocumentUri): void {
    const managed = this.servers.get(serverId)
    if (!managed || managed.status !== "running") return

    managed.openDocuments.delete(uri)
    managed.documentVersions.delete(uri)

    const textDocument: TextDocumentIdentifier = { uri }
    managed.client.notifyDidClose({ textDocument })
  }

  didSave(serverId: string, uri: DocumentUri, text?: string): void {
    const managed = this.servers.get(serverId)
    if (!managed || managed.status !== "running") return

    const textDocument: TextDocumentIdentifier = { uri }
    managed.client.notifyDidSave({ textDocument, text })
  }

  fullChange(text: string): TextDocumentContentChangeEvent {
    return { text }
  }

  incrementalChange(
    text: string,
    range?: { startLine: number; startChar: number; endLine: number; endChar: number },
  ): TextDocumentContentChangeEvent {
    if (!range) return { text }
    return {
      range: {
        start: { line: range.startLine, character: range.startChar },
        end: { line: range.endLine, character: range.endChar },
      },
      text,
    }
  }

  getOpenDocuments(serverId: string): ReadonlySet<string> {
    return this.servers.get(serverId)?.openDocuments ?? new Set()
  }

  getServerIds(): string[] {
    return Array.from(this.servers.keys())
  }

  getRunningServerIds(): string[] {
    return Array.from(this.servers.entries())
      .filter(([, m]) => m.status === "running")
      .map(([id]) => id)
  }

  private buildInitializeParams(config: LspServerConfig): InitializeParams {
    const capabilities: ClientCapabilities = {
      textDocument: {
        synchronization: { dynamicRegistration: false, willSave: true, willSaveWaitUntil: false, didSave: true },
        completion: {
          dynamicRegistration: false,
          completionItem: {
            snippetSupport: true,
            commitCharactersSupport: true,
            documentationFormat: ["markdown", "plaintext"],
            deprecatedSupport: true,
            preselectSupport: true,
            insertReplaceSupport: true,
            resolveSupport: { properties: ["documentation", "detail", "additionalTextEdits"] },
            labelDetailsSupport: true,
          },
          contextSupport: true,
        },
        hover: { dynamicRegistration: false, contentFormat: ["markdown", "plaintext"] },
        signatureHelp: {
          dynamicRegistration: false,
          signatureInformation: {
            documentationFormat: ["markdown", "plaintext"],
            parameterInformation: { labelOffsetSupport: true },
          },
          contextSupport: true,
        },
        definition: { dynamicRegistration: false, linkSupport: true },
        references: { dynamicRegistration: false },
        documentSymbol: {
          dynamicRegistration: false,
          hierarchicalDocumentSymbolSupport: true,
          tagSupport: { valueSet: [1] },
        },
        codeAction: {
          dynamicRegistration: false,
          codeActionLiteralSupport: {
            codeActionKind: {
              valueSet: ["", "quickfix", "refactor", "refactor.extract", "refactor.inline", "refactor.rewrite", "source", "source.organizeImports", "source.fixAll"],
            },
          },
          isPreferredSupport: true,
          disabledSupport: true,
          dataSupport: true,
          resolveSupport: { properties: ["edit"] },
        },
        rename: { dynamicRegistration: false, prepareSupport: true },
        publishDiagnostics: {
          relatedInformation: true,
          tagSupport: { valueSet: [1, 2] },
          versionSupport: true,
        },
      },
      workspace: {
        workspaceFolders: true,
        symbol: { dynamicRegistration: false, tagSupport: { valueSet: [1] } },
      },
    }

    return {
      processId: null,
      clientInfo: DEFAULT_CLIENT_INFO,
      rootUri: this.rootUri,
      initializationOptions: config.initializationOptions,
      capabilities,
      workspaceFolders: this.rootUri ? [{ uri: this.rootUri, name: "root" }] : null,
    }
  }

  private emitDiagnostics(serverId: string, params: PublishDiagnosticsParams): void {
    for (const handler of this.diagnosticHandlers) {
      try {
        handler(serverId, params)
      } catch {
        // prevent one handler from blocking others
      }
    }
  }

  private updateStatus(serverId: string, status: ServerStatus): void {
    const managed = this.servers.get(serverId)
    if (managed) managed.status = status
    for (const handler of this.statusHandlers) {
      try {
        handler(serverId, status)
      } catch {
        // prevent one handler from blocking others
      }
    }
  }
}

function matchesFilePattern(filePath: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return false
  const normalized = filePath.replace(/\\/g, "/")
  return patterns.some((pattern) => {
    const regexStr = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".")
    try {
      return new RegExp(regexStr).test(normalized)
    } catch {
      return false
    }
  })
}

export const languageServerManager = new LanguageServerManager()
