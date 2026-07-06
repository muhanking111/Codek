/**
 * Monaco Bridge — connects ext-host providers to Monaco Editor.
 *
 * Architecture:
 *   Extension Host (EH)
 *     → RPC (named pipe)
 *   Main Process (electron)
 *     → webContents.send("ext-host:*", data)
 *   Renderer (this module)
 *     → monaco.languages.register*Provider(...)
 *     → codek.api('POST', '/ext-host/call', ...) for data
 *
 * Supported provider types:
 *   completionItem, hover, definition, reference, signatureHelp,
 *   codeActions, documentHighlight, documentSymbol, formattingEdit,
 *   rename, foldingRange, inlayHints, codeLens, documentLink
 */

import type * as Monaco from 'monaco-editor'
import { editorLanguageFeatureService } from '../editor/editorLanguageFeatureService'

type MonacoRuntime = Pick<typeof import('monaco-editor'), 'languages'>

const EXT_HOST_NID_LANGUAGE_FEATURES = 101

// Provider registry: language -> [{ type, handle }]
const providerRegistry = new Map()

// Provider handle -> language mapping (from EH)
const handleToInfo = new Map()

let initialised = false
let codekApi = null
let monacoApi: MonacoRuntime | null = null

/**
 * Initialize the Monaco bridge.
 * @param {Function} apiFn - codek.api function
 * @returns {Promise<void>}
 */
export async function initMonacoBridge(apiFn, monaco: MonacoRuntime) {
  if (initialised) return
  codekApi = apiFn
  monacoApi = monaco
  initialised = true

  console.log('[monaco-bridge] Initializing...')

  // Listen for ext-host events from main process
  const codek = window.codek
  if (!codek) {
    console.warn('[monaco-bridge] codek IPC not available')
    return
  }

  // Register generic Monaco providers for each type
  // These delegate to the appropriate EH handles via IPC
  registerCompletionProvider()
  registerHoverProvider()
  registerCodeLensProvider()

  // Listen for provider registrations from EH
  // We use polling via the providers sync endpoint
  await syncProviders()

  console.log('[monaco-bridge] Initialized')

  // Periodically sync providers (every 5s)
  setInterval(syncProviders, 5000)
}

async function syncProviders() {
  if (!codekApi) return
  try {
    const resp = await codekApi('GET', '/ext-host/providers')
    if (!resp?.providers) return

    // Track what's new
    for (const p of resp.providers) {
      const key = `${p.type}:${p.language}`
      if (!handleToInfo.has(key)) {
        handleToInfo.set(key, p)
        console.log(`[monaco-bridge] Provider: ${p.type} for ${p.language}`)
      }
    }
  } catch (err) {
    // EH not running yet — silent
  }
}

function getHandles(type, language) {
  const results = []
  for (const [, info] of handleToInfo) {
    if (info.type === type && (info.language === language || info.language === '*')) {
      results.push(info)
    }
  }
  return results
}

async function callEh(method, args) {
  if (!codekApi) return undefined
  try {
    const resp = await codekApi('POST', '/ext-host/call', {
      extHostNid: EXT_HOST_NID_LANGUAGE_FEATURES,
      method,
      args,
    })
    return resp?.result
  } catch {
    return undefined
  }
}

// ── Monaco Provider Registrations ────────────────────────────────────

function registerCompletionProvider() {
  const monaco = monacoApi
  if (!monaco) return
  monaco.languages.registerCompletionItemProvider('*', {
    triggerCharacters: ['.', '>', '/', '"', "'", ':', '<', '@'],
    provideCompletionItems: async (model, position, context) => {
      const lang = model.getLanguageId()
      const handles = getHandles('completionItem', lang)
      if (handles.length === 0) return { suggestions: [] }

      const uri = {
        scheme: 'file',
        authority: '',
        path: model.uri.path,
        query: '',
        fragment: '',
      }
      const pos = { lineNumber: position.lineNumber, column: position.column }
      const ctx = {
        triggerKind: context.triggerKind ?? 0,
        triggerCharacter: context.triggerCharacter ?? undefined,
      }
      const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }

      let allSuggestions = []
      for (const h of handles) {
        try {
          const result = await callEh('$provideCompletionItems', [h.handle, uri, pos, ctx, token])
          if (result) {
            const items = Array.isArray(result) ? result : (result.items || result.suggestions || [])
            allSuggestions.push(...items.map(item => ({
              label: typeof item.label === 'string' ? item.label : item.label?.label || '',
              kind: item.kind ?? 0,
              detail: item.detail,
              documentation: item.documentation,
              insertText: item.insertText || item.textEdit?.newText || item.label,
              range: item.range,
              sortText: item.sortText,
              filterText: item.filterText,
            })))
          }
        } catch {}
      }

      return { suggestions: allSuggestions }
    },
  })
}

function registerHoverProvider() {
  const monaco = monacoApi
  if (!monaco) return
  editorLanguageFeatureService.registerHoverProvider('*', {
    provideHover: async (model, position) => {
      const lang = model.getLanguageId()
      const handles = getHandles('hover', lang)
      if (handles.length === 0) return null

      const uri = {
        scheme: 'file',
        authority: '',
        path: model.uri.path,
        query: '',
        fragment: '',
      }
      const pos = { lineNumber: position.lineNumber, column: position.column }
      const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }

      for (const h of handles) {
        try {
          const result = await callEh('$provideHover', [h.handle, uri, pos, token])
          if (result) {
            return {
              contents: [{ value: result.contents?.[0]?.value || result.contents || '', isTrusted: true }],
              range: result.range,
            }
          }
        } catch {}
      }
      return null
    },
  }, monaco as never, { id: 'ext-host-hover', source: 'ext-host', legacy: true })
}

function registerCodeLensProvider() {
  const monaco = monacoApi
  if (!monaco) return
  editorLanguageFeatureService.registerCodeLensProvider('*', {
    provideCodeLenses: async (model) => {
      const lang = model.getLanguageId()
      const handles = getHandles('codeLens', lang)
      if (handles.length === 0) return { lenses: [] }

      const uri = {
        scheme: 'file',
        authority: '',
        path: model.uri.path,
        query: '',
        fragment: '',
      }
      const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }

      const lenses = []
      for (const h of handles) {
        try {
          const result = await callEh('$provideCodeLenses', [h.handle, uri, token])
          const items = Array.isArray(result) ? result : (result?.lenses || [])
          lenses.push(...items.map(item => ({
            ...item,
            data: { ...(typeof item.data === 'object' && item.data ? item.data : {}), extHostHandle: h.handle },
          })))
        } catch {}
      }

      return { lenses }
    },
    resolveCodeLens: async (model, codeLens) => {
      const handle = (codeLens.data as { extHostHandle?: unknown } | undefined)?.extHostHandle
      if (typeof handle !== 'number') return codeLens
      const uri = {
        scheme: 'file',
        authority: '',
        path: model.uri.path,
        query: '',
        fragment: '',
      }
      const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }
      const resolved = await callEh('$resolveCodeLens', [handle, uri, codeLens, token])
      return resolved || codeLens
    },
  }, monaco as never, { id: 'ext-host-codelens', source: 'ext-host', legacy: true })
}
