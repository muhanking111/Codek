// @ts-nocheck
import type * as Monaco from "monaco-editor"
import { combineDisposables, type DisposableLike, NOOP_DISPOSABLE } from "./disposable"
import { registerLspProviders } from "./lsp/adapters"
import { languageServerManager } from "./lsp/manager"
import { CompletionItemKind } from "./lsp/protocol"
import { getServerConfigForFile, getServerConfigForLanguage, toLspServerRuntimeConfig } from "./lsp/serverConfigs"
import { getBoundLspModelDocument, getBoundLspModelDocumentByModelUri } from "./lsp/modelBinding"

let registeredMonacoLspDisposable: DisposableLike = NOOP_DISPOSABLE
let editorLifecycleDisposable: DisposableLike = NOOP_DISPOSABLE
let diagnosticsDisposable: DisposableLike = NOOP_DISPOSABLE
let currentEditor: Monaco.editor.IStandaloneCodeEditor | null = null
let initializedRoot: string | null = null
const openDocuments = new Map<string, { serverId: string; documentUri: string }>()

export interface LspCompletion {
  name: string
  kind?: string
  kindModifiers?: string
  sortText?: string
  insertText?: string
}

export interface LspQuickInfo {
  displayString?: string
  documentation?: string
  start?: { line: number; offset: number }
  end?: { line: number; offset: number }
}

export interface LspDefinition {
  file: string
  start: { line: number; offset: number }
  end: { line: number; offset: number }
}

function normalizeWorkspaceRoot(projectRoot: string): string {
  return String(projectRoot || "").replace(/\\/g, "/").replace(/\/+$/, "")
}

function toFileDocumentUri(pathValue: string): string {
  const normalized = String(pathValue || "").replace(/\\/g, "/").replace(/^\/+/, "")
  return `file:///${normalized}`
}

function toAbsoluteLikePath(pathValue: string): string {
  return String(pathValue || "").replace(/^file:\/\/\//, "").replace(/^\/+/, "").replace(/\\/g, "/")
}

function resolveDocumentBinding(pathOrUri: string): { filePath: string; documentUri: string } {
  const rawValue = String(pathOrUri || "")
  const bound = getBoundLspModelDocumentByModelUri(rawValue)
  if (bound) return bound
  if (rawValue.startsWith("file:///")) {
    const filePath = toAbsoluteLikePath(rawValue)
    return { filePath, documentUri: rawValue }
  }
  const filePath = rawValue.replace(/\\/g, "/")
  return { filePath, documentUri: toFileDocumentUri(filePath) }
}

function normalizeLanguageId(languageId: string): string {
  if (languageId === "typescriptreact") return "typescript"
  if (languageId === "javascriptreact") return "javascript"
  return languageId
}

function toLspLine(lineNumber: number): number {
  return Math.max(0, Number(lineNumber || 1) - 1)
}

function toLspCharacter(column: number): number {
  return Math.max(0, Number(column || 1) - 1)
}

function lspCompletionKindToLegacyKind(kind: number | undefined): string | undefined {
  switch (kind) {
    case CompletionItemKind.Text: return "text"
    case CompletionItemKind.Method: return "method"
    case CompletionItemKind.Function: return "function"
    case CompletionItemKind.Constructor: return "constructor"
    case CompletionItemKind.Field: return "field"
    case CompletionItemKind.Variable: return "variable"
    case CompletionItemKind.Class: return "class"
    case CompletionItemKind.Interface: return "interface"
    case CompletionItemKind.Module: return "module"
    case CompletionItemKind.Property: return "property"
    case CompletionItemKind.Unit: return "unit"
    case CompletionItemKind.Value: return "value"
    case CompletionItemKind.Enum: return "enum"
    case CompletionItemKind.Keyword: return "keyword"
    case CompletionItemKind.Snippet: return "snippet"
    case CompletionItemKind.Color: return "color"
    case CompletionItemKind.File: return "file"
    case CompletionItemKind.Reference: return "reference"
    case CompletionItemKind.Folder: return "folder"
    case CompletionItemKind.EnumMember: return "enum"
    case CompletionItemKind.Constant: return "constant"
    case CompletionItemKind.Struct: return "struct"
    case CompletionItemKind.Event: return "event"
    case CompletionItemKind.Operator: return "operator"
    case CompletionItemKind.TypeParameter: return "typeParameter"
    default: return undefined
  }
}

function getLegacyCompletionInsertText(item: {
  label?: string
  insertText?: string
  textEdit?: { newText?: string } | { insert?: unknown; replace?: unknown; newText?: string }
}): string {
  if (typeof item.insertText === "string" && item.insertText.length > 0) return item.insertText
  if (item.textEdit && typeof item.textEdit === "object" && "newText" in item.textEdit && typeof item.textEdit.newText === "string" && item.textEdit.newText.length > 0) {
    return item.textEdit.newText
  }
  return item.label || ""
}

async function ensureServerForFile(filePath: string, explicitLanguageId?: string): Promise<string | null> {
  const normalizedPath = toAbsoluteLikePath(filePath)
  const languageId = normalizeLanguageId(explicitLanguageId || "")
  const config = languageId
    ? getServerConfigForLanguage(languageId)
    : getServerConfigForFile(normalizedPath)
  if (!config) return null

  const existing = languageServerManager.getServerStatus(config.id)
  if (existing !== "running") {
    await languageServerManager.startServer(toLspServerRuntimeConfig(config))
  }
  return config.id
}

async function ensureOpenDocument(pathValue: string, content?: string, explicitLanguageId?: string): Promise<{ serverId: string; filePath: string; documentUri: string } | null> {
  const binding = resolveDocumentBinding(pathValue)
  const fallbackLanguageId = normalizeLanguageId(getServerConfigForFile(binding.filePath)?.languages?.[0] || "")
  const languageId = normalizeLanguageId(explicitLanguageId || fallbackLanguageId)
  const serverId = await ensureServerForFile(binding.filePath, languageId || undefined)
  if (!serverId) return null

  const existing = openDocuments.get(binding.filePath)
  if (!existing || existing.serverId !== serverId || existing.documentUri !== binding.documentUri) {
    if (existing && existing.serverId !== serverId) {
      languageServerManager.didClose(existing.serverId, existing.documentUri)
    }
    languageServerManager.didOpen(serverId, {
      uri: binding.documentUri,
      languageId: languageId || fallbackLanguageId || "plaintext",
      version: 1,
      text: typeof content === "string" ? content : "",
    })
    openDocuments.set(binding.filePath, { serverId, documentUri: binding.documentUri })
  }

  return { serverId, filePath: binding.filePath, documentUri: binding.documentUri }
}

function clearDocumentMarkers(
  monaco: typeof Monaco,
  binding: { documentUri: string } | null | undefined,
  fallbackModel?: Monaco.editor.ITextModel | null,
): void {
  if (!binding && !fallbackModel) return
  const uri = binding ? monaco.Uri.parse(binding.documentUri) : null
  const model = (uri ? monaco.editor.getModel(uri) : null) || fallbackModel || null
  if (!model) return
  monaco.editor.setModelMarkers(model, "lsp", [])
}

function attachEditorLifecycle(monaco: typeof Monaco, editor: Monaco.editor.IStandaloneCodeEditor): DisposableLike {
  const disposables: DisposableLike[] = []
  let contentListener: DisposableLike = NOOP_DISPOSABLE
  let currentModel = editor.getModel()

  const attachModelListener = (model: Monaco.editor.ITextModel | null) => {
    contentListener.dispose()
    currentModel = model
    if (!model) {
      contentListener = NOOP_DISPOSABLE
      return
    }
    const binding = getBoundLspModelDocument(model)
    if (binding) {
      const open = openDocuments.get(binding.filePath)
      if (!open) {
        void openFile(binding.filePath, model.getValue(), model.getLanguageId())
      }
    }
    contentListener = model.onDidChangeContent(() => {
      const bound = getBoundLspModelDocument(model)
      if (!bound) return
      void changeFile(bound.filePath, model.getValue(), model.getLanguageId())
    })
  }

  attachModelListener(currentModel)
  disposables.push({
    dispose: () => contentListener.dispose(),
  })
  disposables.push(editor.onDidChangeModel((event) => {
    const previousBinding = getBoundLspModelDocument(event.oldModelUrl ? monaco.editor.getModel(event.oldModelUrl) : null)
    if (previousBinding) {
      void closeFile(previousBinding.filePath)
    }
    attachModelListener(editor.getModel())
  }))

  return combineDisposables(...disposables)
}

export async function initLsp(projectRoot: string): Promise<boolean> {
  const normalizedRoot = normalizeWorkspaceRoot(projectRoot)
  if (!normalizedRoot) return false
  if (initializedRoot === normalizedRoot) return true

  initializedRoot = normalizedRoot
  languageServerManager.setRootUri(toFileDocumentUri(normalizedRoot))
  return true
}

export async function stopLsp(): Promise<void> {
  await languageServerManager.stopAll()
  openDocuments.clear()
  initializedRoot = null
}

export async function openFile(filePath: string, content?: string, explicitLanguageId?: string): Promise<void> {
  await ensureOpenDocument(filePath, content, explicitLanguageId)
}

export async function changeFile(filePath: string, content: string, explicitLanguageId?: string): Promise<void> {
  const ensured = await ensureOpenDocument(filePath, content, explicitLanguageId)
  if (!ensured) return
  languageServerManager.didChange(ensured.serverId, ensured.documentUri, [
    languageServerManager.fullChange(content),
  ])
}

export async function closeFile(filePath: string): Promise<void> {
  const binding = resolveDocumentBinding(filePath)
  const open = openDocuments.get(binding.filePath)
  if (!open) return
  languageServerManager.didClose(open.serverId, open.documentUri)
  openDocuments.delete(binding.filePath)
}

export async function getCompletions(
  filePath: string,
  line: number,
  offset: number,
): Promise<LspCompletion[]> {
  const ensured = await ensureOpenDocument(filePath)
  if (!ensured) return []
  const client = languageServerManager.getClient(ensured.serverId)
  if (!client) return []

  const result = await client.requestCompletion({
    textDocument: { uri: ensured.documentUri },
    position: { line: toLspLine(line), character: toLspCharacter(offset) },
  })
  if (!result) return []

  const items = Array.isArray(result) ? result : result.items
  return items.map((item) => ({
    name: item.label,
    kind: lspCompletionKindToLegacyKind(item.kind),
    sortText: item.sortText,
    insertText: getLegacyCompletionInsertText(item),
  }))
}

export async function getQuickInfo(
  filePath: string,
  line: number,
  offset: number,
): Promise<LspQuickInfo | null> {
  const ensured = await ensureOpenDocument(filePath)
  if (!ensured) return null
  const client = languageServerManager.getClient(ensured.serverId)
  if (!client) return null

  const result = await client.requestHover({
    textDocument: { uri: ensured.documentUri },
    position: { line: toLspLine(line), character: toLspCharacter(offset) },
  })
  if (!result) return null

  const contents = Array.isArray(result.contents) ? result.contents : [result.contents]
  const values = contents.map((item) => {
    if (typeof item === "string") return item
    if (item && typeof item === "object" && "value" in item) return String(item.value || "")
    if (item && typeof item === "object" && "language" in item) return String(item.value || "")
    return ""
  }).filter(Boolean)

  return {
    displayString: values[0],
    documentation: values.slice(1).join("\n\n") || values[0] || undefined,
    start: result.range ? {
      line: result.range.start.line,
      offset: result.range.start.character,
    } : undefined,
    end: result.range ? {
      line: result.range.end.line,
      offset: result.range.end.character,
    } : undefined,
  }
}

export async function getDefinitions(
  filePath: string,
  line: number,
  offset: number,
): Promise<LspDefinition[]> {
  const ensured = await ensureOpenDocument(filePath)
  if (!ensured) return []
  const client = languageServerManager.getClient(ensured.serverId)
  if (!client) return []

  const result = await client.requestDefinition({
    textDocument: { uri: ensured.documentUri },
    position: { line: toLspLine(line), character: toLspCharacter(offset) },
  })
  if (!result) return []

  const definitions = Array.isArray(result) ? result : [result]
  return definitions.map((item) => {
    const target = "targetUri" in item
      ? {
        uri: item.targetUri,
        range: item.targetSelectionRange,
      }
      : item
    return {
      file: toAbsoluteLikePath(target.uri),
      start: {
        line: target.range.start.line,
        offset: target.range.start.character,
      },
      end: {
        line: target.range.end.line,
        offset: target.range.end.character,
      },
    }
  })
}

export function registerMonacoLsp(monaco: typeof Monaco, editor: Monaco.editor.IStandaloneCodeEditor): () => void {
  currentEditor = editor
  registeredMonacoLspDisposable.dispose()
  editorLifecycleDisposable.dispose()
  diagnosticsDisposable.dispose()

  registeredMonacoLspDisposable = registerLspProviders(monaco)
  editorLifecycleDisposable = attachEditorLifecycle(monaco, editor)
  diagnosticsDisposable = languageServerManager.onDiagnostics((_serverId, params) => {
    const binding = resolveDocumentBinding(params.uri)
    const uri = monaco.Uri.parse(binding.documentUri)
    const model = monaco.editor.getModel(uri) || editor.getModel()
    if (!model) return
    const bound = getBoundLspModelDocument(model)
    if (bound && bound.documentUri !== binding.documentUri) return
    const markers = params.diagnostics.map((diag) => ({
      severity: diag.severity === 1
        ? monaco.MarkerSeverity.Error
        : diag.severity === 2
          ? monaco.MarkerSeverity.Warning
          : diag.severity === 4
            ? monaco.MarkerSeverity.Hint
            : monaco.MarkerSeverity.Info,
      startLineNumber: diag.range.start.line + 1,
      startColumn: diag.range.start.character + 1,
      endLineNumber: diag.range.end.line + 1,
      endColumn: diag.range.end.character + 1,
      message: diag.message,
      source: diag.source,
    }))
    monaco.editor.setModelMarkers(model, "lsp", markers)
  })

  return () => {
    registeredMonacoLspDisposable.dispose()
    editorLifecycleDisposable.dispose()
    diagnosticsDisposable.dispose()
    if (currentEditor?.getModel()) {
      const binding = getBoundLspModelDocument(currentEditor.getModel())
      clearDocumentMarkers(monaco, binding, currentEditor.getModel())
    }
    currentEditor = null
  }
}
