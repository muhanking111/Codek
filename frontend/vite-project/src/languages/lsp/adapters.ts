// @ts-nocheck
import type { languages, editor, Uri } from "monaco-editor"
import {
  CompletionItemKind as LspCompletionItemKind,
  CompletionItemTag,
  DiagnosticSeverity as LspDiagnosticSeverity,
  DiagnosticTag,
  InsertTextFormat,
  SymbolKind as LspSymbolKind,
  SymbolTag,
} from "./protocol"
import type {
  Position as LspPosition,
  Range as LspRange,
  Location as LspLocation,
  LocationLink as LspLocationLink,
  CompletionItem as LspCompletionItem,
  MarkupContent,
  DocumentSymbol as LspDocumentSymbol,
  WorkspaceSymbol as LspWorkspaceSymbol,
  CodeAction as LspCodeAction,
  Command as LspCommand,
  CodeLens as LspCodeLens,
  SignatureHelp as LspSignatureHelp,
  SignatureInformation as LspSignatureInformation,
  ParameterInformation as LspParameterInformation,
  Diagnostic as LspDiagnostic,
  TextEdit as LspTextEdit,
  WorkspaceEdit as LspWorkspaceEdit,
  Definition,
  DefinitionLink,
} from "./protocol"
import { languageServerManager } from "./manager"
import { monacoUriToLspDocUri } from "./client"
import { editorLanguageFeatureService } from "../../editor/editorLanguageFeatureService"
import { getAllServerConfigs } from "./serverConfigs"
import { combineDisposables, type DisposableLike } from "../disposable"

type Monaco = typeof import("monaco-editor")

const COMPLETION_KIND_MAP: Record<number, languages.CompletionItemKind> = {
  [LspCompletionItemKind.Text]: 18,
  [LspCompletionItemKind.Method]: 0,
  [LspCompletionItemKind.Function]: 1,
  [LspCompletionItemKind.Constructor]: 2,
  [LspCompletionItemKind.Field]: 3,
  [LspCompletionItemKind.Variable]: 4,
  [LspCompletionItemKind.Class]: 5,
  [LspCompletionItemKind.Interface]: 7,
  [LspCompletionItemKind.Module]: 8,
  [LspCompletionItemKind.Property]: 9,
  [LspCompletionItemKind.Unit]: 11,
  [LspCompletionItemKind.Value]: 12,
  [LspCompletionItemKind.Enum]: 13,
  [LspCompletionItemKind.Keyword]: 14,
  [LspCompletionItemKind.Snippet]: 27,
  [LspCompletionItemKind.Color]: 19,
  [LspCompletionItemKind.File]: 20,
  [LspCompletionItemKind.Reference]: 21,
  [LspCompletionItemKind.Folder]: 23,
  [LspCompletionItemKind.EnumMember]: 16,
  [LspCompletionItemKind.Constant]: 14,
  [LspCompletionItemKind.Struct]: 6,
  [LspCompletionItemKind.Event]: 22,
  [LspCompletionItemKind.Operator]: 24,
  [LspCompletionItemKind.TypeParameter]: 25,
}

const SYMBOL_KIND_MAP: Record<number, languages.SymbolKind> = {
  [LspSymbolKind.File]: 0,
  [LspSymbolKind.Module]: 1,
  [LspSymbolKind.Namespace]: 2,
  [LspSymbolKind.Package]: 3,
  [LspSymbolKind.Class]: 4,
  [LspSymbolKind.Method]: 5,
  [LspSymbolKind.Property]: 6,
  [LspSymbolKind.Field]: 7,
  [LspSymbolKind.Constructor]: 8,
  [LspSymbolKind.Enum]: 9,
  [LspSymbolKind.Interface]: 10,
  [LspSymbolKind.Function]: 11,
  [LspSymbolKind.Variable]: 12,
  [LspSymbolKind.Constant]: 13,
  [LspSymbolKind.String]: 14,
  [LspSymbolKind.Number]: 15,
  [LspSymbolKind.Boolean]: 16,
  [LspSymbolKind.Array]: 17,
  [LspSymbolKind.Object]: 18,
  [LspSymbolKind.Key]: 19,
  [LspSymbolKind.Null]: 20,
  [LspSymbolKind.EnumMember]: 21,
  [LspSymbolKind.Struct]: 22,
  [LspSymbolKind.Event]: 23,
  [LspSymbolKind.Operator]: 24,
  [LspSymbolKind.TypeParameter]: 25,
}

function lspPositionToMonaco(pos: LspPosition): { lineNumber: number; column: number } {
  return { lineNumber: pos.line + 1, column: pos.character + 1 }
}

function monacoPositionToLsp(pos: { lineNumber: number; column: number }): LspPosition {
  return { line: pos.lineNumber - 1, character: pos.column - 1 }
}

function lspRangeToMonaco(range: LspRange, monaco: Monaco): monaco.IRange {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  )
}

function monacoRangeToLsp(range: monaco.IRange): LspRange {
  return {
    start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
    end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
  }
}

function extractMarkupContent(content: string | MarkupContent): string {
  if (typeof content === "string") return content
  return content.value
}

function lspCompletionKindToMonaco(kind: number | undefined, monaco: Monaco): languages.CompletionItemKind {
  if (kind === undefined) return monaco.languages.CompletionItemKind.Text
  return COMPLETION_KIND_MAP[kind] ?? monaco.languages.CompletionItemKind.Text
}

function lspSymbolKindToMonaco(kind: number, monaco: Monaco): languages.SymbolKind {
  return SYMBOL_KIND_MAP[kind] ?? monaco.languages.SymbolKind.File
}

function convertCompletionItem(
  item: LspCompletionItem,
  position: { lineNumber: number; column: number },
  monaco: Monaco,
): languages.CompletionItem {
  const result: languages.CompletionItem = {
    label: item.label,
    kind: lspCompletionKindToMonaco(item.kind, monaco),
    detail: item.detail,
    sortText: item.sortText,
    filterText: item.filterText,
    preselect: item.preselect,
    commitCharacters: item.commitCharacters,
  }

  if (item.documentation) {
    result.documentation = extractMarkupContent(item.documentation)
  }

  if (item.deprecated || item.tags?.includes(CompletionItemTag.Deprecated)) {
    result.tags = [monaco.languages.CompletionItemTag.Deprecated]
  }

  if (item.insertText) {
    result.insertText = item.insertText
  } else {
    result.insertText = item.label
  }

  if (item.insertTextFormat === InsertTextFormat.Snippet) {
    result.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
  }

  if (item.textEdit) {
    if ("insert" in item.textEdit && "replace" in item.textEdit) {
      result.range = lspRangeToMonaco(item.textEdit.replace, monaco)
      result.insertText = item.textEdit.newText
    } else if ("range" in item.textEdit) {
      result.range = lspRangeToMonaco(item.textEdit.range, monaco)
      result.insertText = item.textEdit.newText
    }
  } else {
    result.range = {
      startLineNumber: position.lineNumber,
      startColumn: position.column,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    }
  }

  if (item.additionalTextEdits) {
    result.additionalTextEdits = item.additionalTextEdits.map(convertTextEdit)
  }

  if (item.labelDetails) {
    result.labelDetails = {
      detail: item.labelDetails.detail,
      description: item.labelDetails.description,
    }
  }

  return result
}

function convertTextEdit(edit: LspTextEdit): languages.TextEdit {
  return {
    range: {
      startLineNumber: edit.range.start.line + 1,
      startColumn: edit.range.start.character + 1,
      endLineNumber: edit.range.end.line + 1,
      endColumn: edit.range.end.character + 1,
    },
    text: edit.newText,
  }
}

function convertDocumentSymbols(
  symbols: LspDocumentSymbol[],
  monaco: Monaco,
): languages.DocumentSymbol[] {
  return symbols.map((sym) => convertDocumentSymbol(sym, monaco))
}

function convertDocumentSymbol(
  sym: LspDocumentSymbol,
  monaco: Monaco,
): languages.DocumentSymbol {
  const result: languages.DocumentSymbol = {
    name: sym.name,
    detail: sym.detail ?? "",
    kind: lspSymbolKindToMonaco(sym.kind, monaco),
    range: {
      startLineNumber: sym.range.start.line + 1,
      startColumn: sym.range.start.character + 1,
      endLineNumber: sym.range.end.line + 1,
      endColumn: sym.range.end.character + 1,
    },
    selectionRange: {
      startLineNumber: sym.selectionRange.start.line + 1,
      startColumn: sym.selectionRange.start.character + 1,
      endLineNumber: sym.selectionRange.end.line + 1,
      endColumn: sym.selectionRange.end.character + 1,
    },
  }

  if (sym.deprecated || sym.tags?.includes(SymbolTag.Deprecated)) {
    result.tags = [monaco.languages.SymbolTag.Deprecated]
  }

  if (sym.children && sym.children.length > 0) {
    result.children = convertDocumentSymbols(sym.children, monaco)
  }

  return result
}

function convertWorkspaceSymbol(
  sym: LspWorkspaceSymbol,
  monaco: Monaco,
): languages.SymbolInformation {
  const loc = "uri" in sym.location ? sym.location : sym.location
  return {
    name: sym.name,
    kind: lspSymbolKindToMonaco(sym.kind, monaco),
    containerName: sym.containerName ?? "",
    location: {
      uri: (loc as LspLocation).uri,
      range: {
        startLineNumber: (loc as LspLocation).range.start.line + 1,
        startColumn: (loc as LspLocation).range.start.character + 1,
        endLineNumber: (loc as LspLocation).range.end.line + 1,
        endColumn: (loc as LspLocation).range.end.character + 1,
      },
    },
  }
}

function convertDiagnostics(
  diagnostics: LspDiagnostic[],
  monaco: Monaco,
): editor.IMarkerData[] {
  return diagnostics.map((diag) => convertDiagnostic(diag, monaco))
}

function convertDiagnostic(diag: LspDiagnostic, monaco: Monaco): editor.IMarkerData {
  const severity = convertDiagnosticSeverity(diag.severity, monaco)
  const marker: editor.IMarkerData = {
    severity,
    startLineNumber: diag.range.start.line + 1,
    startColumn: diag.range.start.character + 1,
    endLineNumber: diag.range.end.line + 1,
    endColumn: diag.range.end.character + 1,
    message: diag.message,
  }

  if (diag.code !== undefined) {
    marker.code = typeof diag.code === "number" ? diag.code : diag.code
  }

  if (diag.source) {
    marker.source = diag.source
  }

  if (diag.tags?.includes(DiagnosticTag.Unnecessary)) {
    marker.tags = [monaco.MarkerTag.Unnecessary]
  } else if (diag.tags?.includes(DiagnosticTag.Deprecated)) {
    marker.tags = [monaco.MarkerTag.Deprecated]
  }

  if (diag.relatedInformation) {
    marker.relatedInformation = diag.relatedInformation.map((info) => ({
      resource: monaco.Uri.parse(info.location.uri),
      startLineNumber: info.location.range.start.line + 1,
      startColumn: info.location.range.start.character + 1,
      endLineNumber: info.location.range.end.line + 1,
      endColumn: info.location.range.end.character + 1,
      message: info.message,
    }))
  }

  return marker
}

function convertDiagnosticSeverity(
  severity: LspDiagnosticSeverity | undefined,
  monaco: Monaco,
): monaco.MarkerSeverity {
  switch (severity) {
    case LspDiagnosticSeverity.Error: return monaco.MarkerSeverity.Error
    case LspDiagnosticSeverity.Warning: return monaco.MarkerSeverity.Warning
    case LspDiagnosticSeverity.Information: return monaco.MarkerSeverity.Info
    case LspDiagnosticSeverity.Hint: return monaco.MarkerSeverity.Hint
    default: return monaco.MarkerSeverity.Error
  }
}

function isCodeAction(item: LspCodeAction | LspCommand): item is LspCodeAction {
  return "edit" in item || "kind" in item
}

function convertCodeAction(
  item: LspCodeAction | LspCommand,
  monaco: Monaco,
): languages.CodeAction {
  if (!isCodeAction(item)) {
    return {
      title: item.title,
      command: {
        id: item.command,
        title: item.title,
        arguments: item.arguments as (string | number | boolean | Record<string, unknown>)[],
      },
    }
  }

  const action: languages.CodeAction = {
    title: item.title,
    isPreferred: item.isPreferred,
  }

  if (item.kind) {
    action.kind = item.kind
  }

  if (item.diagnostics) {
    action.diagnostics = convertDiagnostics(item.diagnostics, monaco)
  }

  if (item.edit) {
    action.edit = convertWorkspaceEdit(item.edit, monaco)
  }

  if (item.command) {
    action.command = {
      id: item.command.command,
      title: item.command.title,
      arguments: item.command.arguments as (string | number | boolean | Record<string, unknown>)[],
    }
  }

  if (item.disabled) {
    action.isPreferred = false
  }

  return action
}

function convertCodeLens(lens: LspCodeLens, monaco: Monaco) {
  return {
    range: lspRangeToMonaco(lens.range, monaco),
    command: lens.command
      ? {
        id: lens.command.command,
        title: lens.command.title,
        arguments: lens.command.arguments as unknown[] | undefined,
      }
      : undefined,
    data: lens.data,
  }
}

function convertWorkspaceEdit(edit: LspWorkspaceEdit, monaco: Monaco): languages.WorkspaceEdit {
  const edits: languages.WorkspaceTextEdit[] = []

  if (edit.changes) {
    for (const [uri, textEdits] of Object.entries(edit.changes)) {
      const resource = monaco.Uri.parse(uri)
      for (const textEdit of textEdits) {
        edits.push({
          resource,
          edit: convertTextEdit(textEdit),
        })
      }
    }
  }

  return { edits }
}

function convertSignatureHelp(
  help: LspSignatureHelp,
): languages.SignatureHelp {
  return {
    signatures: help.signatures.map(convertSignatureInfo),
    activeSignature: help.activeSignature ?? 0,
    activeParameter: help.activeParameter ?? 0,
  }
}

function convertSignatureInfo(info: LspSignatureInformation): languages.SignatureInformation {
  const result: languages.SignatureInformation = {
    label: info.label,
  }

  if (info.documentation) {
    result.documentation = extractMarkupContent(info.documentation)
  }

  if (info.parameters) {
    result.parameters = info.parameters.map(convertParameterInfo)
  }

  return result
}

function convertParameterInfo(info: LspParameterInformation): languages.ParameterInformation {
  const result: languages.ParameterInformation = {
    label: typeof info.label === "string" ? info.label : info.label,
  }

  if (info.documentation) {
    result.documentation = extractMarkupContent(info.documentation)
  }

  return result
}

function resolveServerId(model: editor.ITextModel): string | null {
  const uri = monacoUriToLspDocUri(model.uri)
  return languageServerManager.resolveServerForFile(uri)
}

export function registerLspProviders(monaco: Monaco): DisposableLike {
  return combineDisposables(
    registerCompletionProvider(monaco),
    registerHoverProvider(monaco),
    registerDefinitionProvider(monaco),
    registerReferenceProvider(monaco),
    registerRenameProvider(monaco),
    registerCodeActionProvider(monaco),
    registerCodeLensProvider(monaco),
    registerDocumentSymbolProvider(monaco),
    registerSignatureHelpProvider(monaco),
  )
}

function getConfiguredLanguages(): string[] {
  return [...new Set(getAllServerConfigs().flatMap((config) => config.languages))]
}

function registerCompletionProvider(monaco: Monaco): DisposableLike {
  const disposables: DisposableLike[] = []
  for (const langId of getConfiguredLanguages()) {
    disposables.push(editorLanguageFeatureService.registerCompletionItemProvider(langId, {
      triggerCharacters: [".", "\"", "'", "/", "@", "<", "(", ","],
      async provideCompletionItems(model, position) {
        const sid = resolveServerId(model)
        if (!sid) return { suggestions: [] }
        const c = languageServerManager.getClient(sid)
        if (!c) return { suggestions: [] }

        const result = await c.requestCompletion({
          textDocument: { uri: monacoUriToLspDocUri(model.uri) },
          position: monacoPositionToLsp(position),
        })

        if (!result) return { suggestions: [] }

        const items = Array.isArray(result) ? result : result.items
        return {
          suggestions: items.map((item) => convertCompletionItem(item, position, monaco)),
          incomplete: !Array.isArray(result) && result.isIncomplete === true,
        }
      },
    }, monaco, {
      id: `lsp-completion:${langId}`,
      source: "lsp",
    }))
  }
  return combineDisposables(...disposables)
}

function registerHoverProvider(monaco: Monaco): DisposableLike {
  const disposables: DisposableLike[] = []
  for (const langId of getConfiguredLanguages()) {
    disposables.push(editorLanguageFeatureService.registerHoverProvider(langId, {
      async provideHover(model, position) {
        const sid = resolveServerId(model)
        if (!sid) return null
        const c = languageServerManager.getClient(sid)
        if (!c) return null

        const result = await c.requestHover({
          textDocument: { uri: monacoUriToLspDocUri(model.uri) },
          position: monacoPositionToLsp(position),
        })

        if (!result) return null

        const contents: languages.IMarkdownString[] = []
        if (Array.isArray(result.contents)) {
          for (const item of result.contents) {
            if (typeof item === "string") {
              contents.push({ value: item })
            } else if ("kind" in item) {
              contents.push({ value: (item as MarkupContent).value })
            } else if ("language" in item) {
              contents.push({ value: `\`\`\`${(item as { language: string; value: string }).language}\n${(item as { language: string; value: string }).value}\n\`\`\`` })
            }
          }
        } else if (typeof result.contents === "string") {
          contents.push({ value: result.contents })
        } else if ("kind" in result.contents) {
          contents.push({ value: (result.contents as MarkupContent).value })
        }

        return {
          contents,
          range: result.range ? lspRangeToMonaco(result.range, monaco) : undefined,
        }
      },
    }, monaco, { id: `lsp-hover:${langId}`, source: "lsp" }))
  }
  return combineDisposables(...disposables)
}

function registerDefinitionProvider(monaco: Monaco): DisposableLike {
  const disposables: DisposableLike[] = []
  for (const langId of getConfiguredLanguages()) {
    disposables.push(monaco.languages.registerDefinitionProvider(langId, {
      async provideDefinition(model, position) {
        const sid = resolveServerId(model)
        if (!sid) return []
        const c = languageServerManager.getClient(sid)
        if (!c) return []

        const result = await c.requestDefinition({
          textDocument: { uri: monacoUriToLspDocUri(model.uri) },
          position: monacoPositionToLsp(position),
        })

        if (!result) return []

        return flattenDefinitionResult(result, monaco)
      },
    }))
  }
  return combineDisposables(...disposables)
}

function flattenDefinitionResult(
  result: Definition | DefinitionLink,
  monaco: Monaco,
): languages.Location[] {
  if (Array.isArray(result)) {
    if (result.length === 0) return []
    if ("uri" in result[0] && "range" in result[0]) {
      return (result as LspLocation[]).map((loc) => ({
        uri: monaco.Uri.parse(loc.uri),
        range: lspRangeToMonaco(loc.range, monaco),
      }))
    }
    return (result as LspLocationLink[]).map((link) => ({
      uri: monaco.Uri.parse(link.targetUri),
      range: lspRangeToMonaco(link.targetSelectionRange, monaco),
    }))
  }

  const loc = result as LspLocation
  return [{
    uri: monaco.Uri.parse(loc.uri),
    range: lspRangeToMonaco(loc.range, monaco),
  }]
}

function registerReferenceProvider(monaco: Monaco): DisposableLike {
  const disposables: DisposableLike[] = []
  for (const langId of getConfiguredLanguages()) {
    const lspReferenceProvider = {
      async provideReferences(model, position, context) {
        const sid = resolveServerId(model)
        if (!sid) return []
        const c = languageServerManager.getClient(sid)
        if (!c) return []

        const result = await c.requestReferences({
          textDocument: { uri: monacoUriToLspDocUri(model.uri) },
          position: monacoPositionToLsp(position),
          context: { includeDeclaration: context.includeDeclaration },
        })

        if (!result) return []

        return result.map((loc) => ({
          uri: monaco.Uri.parse(loc.uri),
          range: lspRangeToMonaco(loc.range, monaco),
        }))
      },
    }

    disposables.push(editorLanguageFeatureService.registerReferenceProvider(langId, lspReferenceProvider, monaco, {
      id: `lsp-reference:${langId}`,
      source: "lsp",
    }))
  }
  return combineDisposables(...disposables)
}

function registerRenameProvider(monaco: Monaco): DisposableLike {
  const disposables: DisposableLike[] = []
  for (const langId of getConfiguredLanguages()) {
    const lspRenameProvider = {
      async provideRenameEdits(model, position, newName) {
        const sid = resolveServerId(model)
        if (!sid) return null
        const c = languageServerManager.getClient(sid)
        if (!c) return null

        const result = await c.requestRename({
          textDocument: { uri: monacoUriToLspDocUri(model.uri) },
          position: monacoPositionToLsp(position),
          newName,
        })

        if (!result) return null
        return convertWorkspaceEdit(result, monaco)
      },
      async resolveRenameLocation(model, position) {
        const sid = resolveServerId(model)
        if (!sid) return null
        const c = languageServerManager.getClient(sid)
        if (!c) return null

        const result = await c.requestPrepareRename({
          textDocument: { uri: monacoUriToLspDocUri(model.uri) },
          position: monacoPositionToLsp(position),
        })

        if (!result) return null

        return {
          range: lspRangeToMonaco(result.range, monaco),
          text: result.placeholder,
        }
      },
    }

    disposables.push(editorLanguageFeatureService.registerRenameProvider(langId, lspRenameProvider, monaco, {
      id: `lsp-rename:${langId}`,
      source: "lsp",
    }))
  }
  return combineDisposables(...disposables)
}

function registerCodeActionProvider(monaco: Monaco): DisposableLike {
  const disposables: DisposableLike[] = []
  for (const langId of getConfiguredLanguages()) {
    const lspCodeActionProvider = {
      async provideCodeActions(model, range, context) {
        const sid = resolveServerId(model)
        if (!sid) return { actions: [], dispose() {} }
        const c = languageServerManager.getClient(sid)
        if (!c) return { actions: [], dispose() {} }

        const diagnostics = context.markers.map((marker) => ({
          range: monacoRangeToLsp(marker),
          message: marker.message,
          severity: LspDiagnosticSeverity.Error,
        }))

        const result = await c.requestCodeAction({
          textDocument: { uri: monacoUriToLspDocUri(model.uri) },
          range: monacoRangeToLsp(range),
          context: { diagnostics },
        })

        if (!result) return { actions: [], dispose() {} }

        return {
          actions: result.map((item) => convertCodeAction(item, monaco)),
          dispose() {},
        }
      },
    }

    disposables.push(editorLanguageFeatureService.registerCodeActionProvider(langId, lspCodeActionProvider, monaco, {
      id: `lsp-code-action:${langId}`,
      source: "lsp",
    }))
  }
  return combineDisposables(...disposables)
}

function registerCodeLensProvider(monaco: Monaco): DisposableLike {
  const disposables: DisposableLike[] = []
  for (const langId of getConfiguredLanguages()) {
    const lspCodeLensProvider = {
      async provideCodeLenses(model) {
        const sid = resolveServerId(model)
        if (!sid) return { lenses: [] }
        const c = languageServerManager.getClient(sid)
        if (!c) return { lenses: [] }

        const result = await c.requestCodeLens({
          textDocument: { uri: monacoUriToLspDocUri(model.uri) },
        })

        return {
          lenses: (result || []).map((lens) => convertCodeLens(lens, monaco)),
        }
      },
      async resolveCodeLens(model, codeLens) {
        const sid = resolveServerId(model)
        if (!sid || !codeLens.data) return codeLens
        const c = languageServerManager.getClient(sid)
        if (!c) return codeLens
        const resolved = await c.resolveCodeLens({
          range: monacoRangeToLsp(codeLens.range),
          command: codeLens.command
            ? {
              title: codeLens.command.title,
              command: codeLens.command.id,
              arguments: codeLens.command.arguments as any,
            }
            : undefined,
          data: codeLens.data as any,
        })
        return resolved ? convertCodeLens(resolved, monaco) : codeLens
      },
    }

    disposables.push(editorLanguageFeatureService.registerCodeLensProvider(langId, lspCodeLensProvider, monaco, { id: `lsp-codelens:${langId}`, source: "lsp" }))
  }
  return combineDisposables(...disposables)
}

function registerDocumentSymbolProvider(monaco: Monaco): DisposableLike {
  const disposables: DisposableLike[] = []
  for (const langId of getConfiguredLanguages()) {
    disposables.push(monaco.languages.registerDocumentSymbolProvider(langId, {
      async provideDocumentSymbols(model) {
        const sid = resolveServerId(model)
        if (!sid) return []
        const c = languageServerManager.getClient(sid)
        if (!c) return []

        const result = await c.requestDocumentSymbol({
          textDocument: { uri: monacoUriToLspDocUri(model.uri) },
        })

        if (!result) return []
        return convertDocumentSymbols(result, monaco)
      },
    }))
  }
  return combineDisposables(...disposables)
}

function registerSignatureHelpProvider(monaco: Monaco): DisposableLike {
  const disposables: DisposableLike[] = []
  for (const langId of getConfiguredLanguages()) {
    disposables.push(editorLanguageFeatureService.registerSignatureHelpProvider(langId, {
      signatureHelpTriggerCharacters: ["(", ","],
      async provideSignatureHelp(model, position) {
        const sid = resolveServerId(model)
        if (!sid) return { value: { signatures: [], activeSignature: 0, activeParameter: 0 }, dispose() {} }
        const c = languageServerManager.getClient(sid)
        if (!c) return { value: { signatures: [], activeSignature: 0, activeParameter: 0 }, dispose() {} }

        const result = await c.requestSignatureHelp({
          textDocument: { uri: monacoUriToLspDocUri(model.uri) },
          position: monacoPositionToLsp(position),
        })

        if (!result) return { value: { signatures: [], activeSignature: 0, activeParameter: 0 }, dispose() {} }

        return {
          value: convertSignatureHelp(result),
          dispose() {},
        }
      },
    }, monaco, {
      id: `lsp-signature:${langId}`,
      source: "lsp",
    }))
  }
  return combineDisposables(...disposables)
}

export function applyLspDiagnostics(
  monaco: Monaco,
  uri: Uri,
  diagnostics: LspDiagnostic[],
  owner: string,
): void {
  const model = monaco.editor.getModel(uri)
  if (!model) return
  const markers = convertDiagnostics(diagnostics, monaco)
  monaco.editor.setModelMarkers(model, owner, markers)
}

export {
  lspPositionToMonaco,
  monacoPositionToLsp,
  lspRangeToMonaco,
  monacoRangeToLsp,
  convertCompletionItem,
  convertTextEdit,
  convertDocumentSymbols,
  convertWorkspaceSymbol,
  convertDiagnostics,
  convertCodeAction,
  convertCodeLens,
  convertWorkspaceEdit,
  convertSignatureHelp,
}
