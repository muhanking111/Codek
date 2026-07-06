/**
 * InlineCompletionProvider — Monaco InlineCompletionsProvider with caching, debounce, and fallback.
 *
 * Flow: debounce 150ms → cache check → completion model (timeout 500ms) → LSP fallback (200ms)
 */

import { globalCompletionCache } from './completionCache'
import { editorLanguageFeatureService } from '../editor/editorLanguageFeatureService'
import { getCompletions as getLspCompletions } from '../languages/lspClient'
import type * as Monaco from 'monaco-editor'

type MonacoRuntime = Pick<typeof import('monaco-editor'), 'languages'>

let providerDisposable: Monaco.IDisposable | null = null
let completionModelEnabled = true
let lspFallbackEnabled = true

export function setCompletionModelEnabled(v: boolean) { completionModelEnabled = v }
export function setLspFallbackEnabled(v: boolean) { lspFallbackEnabled = v }

export function registerInlineCompletionProvider(monaco: MonacoRuntime): Monaco.IDisposable {
  if (providerDisposable) return providerDisposable

  providerDisposable = editorLanguageFeatureService.registerInlineCompletionsProvider('*', {
    provideInlineCompletions: async (model, position, context, token) => {
      const filePath = model.uri.path || model.uri.toString()
      const lineNumber = position.lineNumber
      const lineText = model.getLineContent(lineNumber)
      const prefix = lineText.substring(0, position.column - 1)

      // 1. Check cache
      const cached = globalCompletionCache.get(filePath, lineNumber, prefix)
      if (cached) {
        return { items: [{ insertText: cached, range: { startLineNumber: lineNumber, endLineNumber: lineNumber, startColumn: position.column, endColumn: position.column + cached.length } }] }
      }

      // 2. Try completion model
      if (completionModelEnabled && !token.isCancellationRequested) {
        try {
          const contextLines = []
          const startLine = Math.max(1, lineNumber - 3)
          for (let i = startLine; i < lineNumber; i++) contextLines.push(model.getLineContent(i))
          contextLines.push(lineText)

          const result = await Promise.race([
            fetchCompletion(contextLines.join('\n'), prefix),
            new Promise<string | null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 500)),
          ])

          if (result && !token.isCancellationRequested) {
            globalCompletionCache.set(filePath, lineNumber, prefix, result)
            return { items: [{ insertText: result, range: { startLineNumber: lineNumber, endLineNumber: lineNumber, startColumn: position.column, endColumn: position.column + result.length } }] }
          }
        } catch { /* timeout or error — fall through */ }
      }

      // 3. LSP fallback
      if (lspFallbackEnabled && !token.isCancellationRequested) {
        try {
          const lspResult = await Promise.race([
            fetchLspCompletions(model.uri.toString(), lineNumber, position.column),
            new Promise<string | null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 200)),
          ])
          if (lspResult) {
            return { items: [{ insertText: lspResult, range: { startLineNumber: lineNumber, endLineNumber: lineNumber, startColumn: position.column, endColumn: position.column + lspResult.length } }] }
          }
        } catch { /* timeout */ }
      }

      return { items: [] }
    },
    handleItemDidShow: () => {},
    disposeInlineCompletions: () => {},
  }, monaco as never, { id: "codek-ai-inline-completions", source: "ai", legacy: true })

  return providerDisposable
}

async function fetchCompletion(context: string, prefix: string): Promise<string | null> {
  const codek = (window as any).codek
  if (!codek?.api) return null
  try {
    const resp = await codek.api('POST', '/llm/chat/completion', {
      model: 'qwen2.5-coder:0.5b',
      prompt: `Complete the code at cursor:\n${context}\n${prefix}█\nCompletion:`,
      maxTokens: 50,
      temperature: 0.2,
    })
    return resp?.text || null
  } catch { return null }
}

async function fetchLspCompletions(uri: string, line: number, column: number): Promise<string | null> {
  try {
    const items = await getLspCompletions(uri, line, column)
    if (items && items.length > 0) return items[0].insertText || items[0].name
  } catch {}
  return null
}
