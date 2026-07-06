/**
 * MainThreadLanguageFeatures — routes extension language providers to Monaco.
 *
 * Handles provider registration calls from the Extension Host and provides
 * IPC handlers for the renderer to query provider data.
 *
 * Provider types handled (all routed through Monaco's equivalent APIs):
 *   $registerCompletionItemProvider
 *   $registerHoverProvider
 *   $registerDefinitionProvider
 *   $registerReferenceProvider
 *   $registerSignatureHelpProvider
 *   $registerCodeActionsProvider
 *   $registerDocumentHighlightProvider
 *   $registerDocumentSymbolProvider
 *   $registerDocumentFormattingEditProvider
 *   $registerRenameProvider
 *   $registerFoldingRangeProvider
 *   $registerSelectionRangeProvider
 *   $registerInlayHintsProvider
 *   $registerCodeLensProvider
 *   $registerDocumentLinkProvider
 */

// Provider registry: { handle -> { type, language, triggerCharacters, ...metadata } }
const providers = {}
// Language -> [handle] mapping for lookup
const languageIndex = {}
const MAIN_THREAD_LANGUAGE_FEATURES_NID = 25
const EXT_HOST_LANGUAGE_FEATURES_NID = 101

function indexLanguage(language, handle) {
  if (!language) return
  if (!languageIndex[language]) languageIndex[language] = []
  if (!languageIndex[language].includes(handle)) languageIndex[language].push(handle)
}

function getHandlesForLanguage(language) {
  return languageIndex[language] || []
}

function getProviderList() {
  return Object.values(providers).map(p => ({ handle: p.handle, type: p.type, language: p.language }))
}

function syncProviderList(opts) {
  if (opts.syncProviders) {
    opts.syncProviders(getProviderList())
  }
}

function removeFromLanguageIndex(handle) {
  for (const [language, handles] of Object.entries(languageIndex)) {
    languageIndex[language] = handles.filter((entry) => entry !== handle)
    if (languageIndex[language].length === 0) delete languageIndex[language]
  }
}

function resetProviders() {
  for (const key of Object.keys(providers)) delete providers[key]
  for (const key of Object.keys(languageIndex)) delete languageIndex[key]
}

function registerProvider(opts, type, args, extraBuilder = () => ({})) {
  const [handle, filter] = args || []
  if (handle == null) return undefined
  const language = filter?.language || filter?.scheme || "*"
  providers[handle] = { type, language, handle, ...extraBuilder(args || []) }
  indexLanguage(language, handle)
  syncProviderList(opts)
  return { handle, language }
}

function registerRpc(server, method, handler) {
  server.onRpc(MAIN_THREAD_LANGUAGE_FEATURES_NID, method, handler)
  server.onRpc(method, handler)
}

function register(server, opts = {}) {
  // ── Provider registration handlers ──────────────────────────────────

  registerRpc(server, "$registerCompletionItemProvider", (args) => {
    const triggerCharacters = Array.isArray(args?.[2]) ? args[2] : []
    const registered = registerProvider(opts, "completionItem", args, () => ({ triggerCharacters }))
    if (!registered) return undefined
    const { handle, language } = registered
    if (handle == null) return undefined
    console.log(`[main-thread:lf] registerCompletionItemProvider handle=${handle} lang=${language}`)
    if (opts.sendToRenderer) {
      opts.sendToRenderer("ext-host:provider-registered", { type: "completionItem", handle, language, triggerCharacters })
    }
    return undefined
  })

  // Helper: register a provider type with sync
  function regProvider(method, type) {
    registerRpc(server, method, (args) => {
      registerProvider(opts, type, args, (allArgs) => allArgs[2] ? { extra: allArgs[2] } : {})
      return undefined
    })
  }

  regProvider("$registerHoverProvider", "hover")
  regProvider("$registerDefinitionProvider", "definition")
  regProvider("$registerReferenceProvider", "reference")
  regProvider("$registerSignatureHelpProvider", "signatureHelp")
  regProvider("$registerCodeActionsProvider", "codeActions")
  regProvider("$registerDocumentHighlightProvider", "documentHighlight")
  regProvider("$registerDocumentSymbolProvider", "documentSymbol")
  regProvider("$registerDocumentFormattingEditProvider", "documentFormattingEdit")
  regProvider("$registerRenameProvider", "rename")
  regProvider("$registerFoldingRangeProvider", "foldingRange")
  regProvider("$registerSelectionRangeProvider", "selectionRange")
  regProvider("$registerInlayHintsProvider", "inlayHints")
  regProvider("$registerCodeLensProvider", "codeLens")
  regProvider("$registerDocumentLinkProvider", "documentLink")

  registerRpc(server, "$unregister", (args) => {
    const [handle] = args || []
    if (handle == null) return undefined
    delete providers[handle]
    removeFromLanguageIndex(handle)
    syncProviderList(opts)
    return undefined
  })

  // ── IPC handlers for renderer queries ─────────────────────────────

  // Register IPC handler to query provider data from EH
  if (opts.ipcMain && opts.callEh) {
    const { ipcMain } = opts

    ipcMain.handle("ext-host:provide-completions", async (_event, { language, position, context }) => {
      const handles = getHandlesForLanguage(language)
      let allItems = []
      for (const handle of handles) {
        if (providers[handle]?.type !== "completionItem") continue
        try {
          const result = await opts.callEh(EXT_HOST_LANGUAGE_FEATURES_NID, "$provideCompletionItem", [handle, position, context])
          if (result) {
            allItems = allItems.concat(result.items || result)
          }
        } catch (err) {
          // Provider error — skip
        }
      }
      return allItems
    })

    // For now, return empty for other provider types
    ipcMain.handle("ext-host:provide-hover", async (_event, { language, position }) => {
      const handles = getHandlesForLanguage(language)
      for (const handle of handles) {
        if (providers[handle]?.type !== "hover") continue
        try {
          const result = await opts.callEh(EXT_HOST_LANGUAGE_FEATURES_NID, "$provideHover", [handle, position])
          if (result) return result
        } catch {}
      }
      return null
    })

    ipcMain.handle("ext-host:get-providers", () => {
      return Object.values(providers).map(p => ({ handle: p.handle, type: p.type, language: p.language }))
    })
  }
}

module.exports = {
  EXT_HOST_LANGUAGE_FEATURES_NID,
  MAIN_THREAD_LANGUAGE_FEATURES_NID,
  getHandlesForLanguage,
  getProviderList,
  register,
  resetProviders,
}
