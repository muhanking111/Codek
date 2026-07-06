import type { languages, editor, Position } from "monaco-editor"
import { snippetManager } from "./snippetManager"
import type { SnippetDefinition } from "./snippetManager"
import { editorLanguageFeatureService } from "../../editor/editorLanguageFeatureService"
import { combineDisposables, type DisposableLike } from "../disposable"

type Monaco = typeof import("monaco-editor")

function snippetToCompletionItem(
  snippet: SnippetDefinition,
  monaco: Monaco,
  position: Position,
  insertText: string,
): languages.CompletionItem {
  const prefixes = snippet.prefixes || (Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix])
  return {
    label: prefixes[0],
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    detail: snippet.description || snippet.name,
    documentation: snippet.body,
    sortText: "0",
    filterText: prefixes.join(" "),
    range: {
      startLineNumber: position.lineNumber,
      startColumn: position.column,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    },
  }
}

function getWordUntilPosition(model: editor.ITextModel, position: Position): string {
  const word = model.getWordUntilPosition(position)
  return word?.word ?? ""
}

export function registerSnippetProvider(monaco: Monaco, languageIds: string[]): DisposableLike {
  const disposables: DisposableLike[] = []
  for (const languageId of languageIds) {
    disposables.push(editorLanguageFeatureService.registerCompletionItemProvider(languageId, {
      triggerCharacters: [" "],
      provideCompletionItems(model, position) {
        const word = getWordUntilPosition(model, position)
        const snippets = snippetManager.getSnippetsForLanguage(languageId)

        if (snippets.length === 0) return { suggestions: [] }

        const filtered = word
          ? snippets.filter((s) => getSnippetPrefixes(s).some((prefix) => prefix.toLowerCase().startsWith(word.toLowerCase())))
          : snippets

        const suggestions = filtered.map((s) =>
          snippetToCompletionItem(s, monaco, position, snippetManager.resolveSnippet(s, buildResolveContext(model, position))),
        )

        return { suggestions }
      },
    }, monaco, {
      id: `snippet-completion:${languageId}`,
      source: "snippets",
    }))
  }
  return combineDisposables(...disposables)
}

function getSnippetPrefixes(snippet: SnippetDefinition): string[] {
  return snippet.prefixes || (Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix])
}

function buildResolveContext(model: editor.ITextModel, position: Position) {
  const uriPath = String((model.uri as { path?: string; fsPath?: string } | undefined)?.path || (model.uri as { fsPath?: string } | undefined)?.fsPath || "")
  const normalized = uriPath.replace(/\\/g, "/")
  const fileName = normalized.split("/").filter(Boolean).pop() || "untitled"
  return {
    fileName,
    lineNumber: position.lineNumber,
    columnNumber: position.column,
  }
}

const DEFAULT_LANGUAGE_IDS = [
  "javascript",
  "typescript",
  "python",
  "java",
  "go",
  "rust",
  "cpp",
  "c",
  "html",
  "css",
  "scss",
  "less",
  "json",
  "markdown",
  "yaml",
  "xml",
  "sql",
  "shell",
  "php",
  "ruby",
  "swift",
  "kotlin",
  "scala",
  "lua",
  "dart",
]

export function registerAllSnippetProviders(monaco: Monaco): DisposableLike {
  return registerSnippetProvider(monaco, DEFAULT_LANGUAGE_IDS)
}
