/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code search provider registration:
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\common\searchService.ts
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\node\rawSearchService.ts
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\node\ripgrepSearchProvider.ts
 *--------------------------------------------------------------------------------------------*/

const { runRipgrepFileSearch } = require("./ripgrepFileSearchAdapter")
const { runRipgrepSearch } = require("./ripgrepSearchAdapter")
const { createSearchWorkerProcessProviders } = require("./searchWorkerProcessAdapter")

const SearchProviderType = Object.freeze({
  file: "file",
  text: "text",
})

class SearchProviderRegistry {
  constructor() {
    this.providersByType = new Map([
      [SearchProviderType.file, new Map()],
      [SearchProviderType.text, new Map()],
    ])
  }

  registerSearchResultProvider(scheme, type, provider) {
    const providers = this.getProviderMap(type)
    const normalizedScheme = normalizeScheme(scheme)
    if (!provider || typeof provider !== "object") {
      throw new TypeError("Search provider must be an object")
    }
    const stack = providers.get(normalizedScheme) || []
    stack.push(provider)
    providers.set(normalizedScheme, stack)
    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        const current = providers.get(normalizedScheme)
        if (!current) return
        const index = current.lastIndexOf(provider)
        if (index !== -1) current.splice(index, 1)
        if (current.length) providers.set(normalizedScheme, current)
        else providers.delete(normalizedScheme)
      },
    }
  }

  getSearchProvider(type, scheme = "file") {
    const stack = this.getProviderMap(type).get(normalizeScheme(scheme))
    return stack?.[stack.length - 1] || null
  }

  schemeHasProvider(type, scheme = "file") {
    return this.getSearchProvider(type, scheme) !== null
  }

  providerSchemes(type) {
    return [...this.getProviderMap(type).keys()]
  }

  async runSearch(type, scheme, request) {
    const provider = this.getSearchProvider(type, scheme)
    if (!provider) return null
    if (type === SearchProviderType.file) {
      if (typeof provider.fileSearch !== "function") return null
      return provider.fileSearch(request)
    }
    if (type === SearchProviderType.text) {
      if (typeof provider.textSearch !== "function") return null
      return provider.textSearch(request)
    }
    throw new Error(`Unknown SearchProviderType: ${type}`)
  }

  async clearCache(cacheKey) {
    const providers = new Set()
    for (const providerMap of this.providersByType.values()) {
      for (const stack of providerMap.values()) {
        for (const provider of stack) providers.add(provider)
      }
    }
    await Promise.all([...providers].map((provider) => (
      typeof provider.clearCache === "function" ? provider.clearCache(cacheKey) : undefined
    )))
  }

  getProviderMap(type) {
    const providers = this.providersByType.get(type)
    if (!providers) throw new Error(`Unknown SearchProviderType: ${type}`)
    return providers
  }
}

function createDefaultSearchProviderRegistry(options = {}) {
  const registry = new SearchProviderRegistry()
  const useWorkerProcess = options.useWorkerProcess ?? shouldUseSearchWorkerProcess()
  if (useWorkerProcess) {
    const providers = createSearchWorkerProcessProviders(options.workerProcess)
    registry.searchWorkerProcessHost = providers.host
    registry.registerSearchResultProvider("file", SearchProviderType.text, providers.textProvider)
    registry.registerSearchResultProvider("file", SearchProviderType.file, providers.fileProvider)
    return registry
  }
  registry.registerSearchResultProvider("file", SearchProviderType.text, {
    textSearch: (request) => runRipgrepSearch(request),
    clearCache: async () => undefined,
  })
  registry.registerSearchResultProvider("file", SearchProviderType.file, {
    fileSearch: (request) => runRipgrepFileSearch(request),
    clearCache: async () => undefined,
  })
  return registry
}

function shouldUseSearchWorkerProcess() {
  if (process.env.CODEK_SEARCH_WORKER_PROCESS === "0") return false
  if (process.env.CODEK_SEARCH_WORKER_PROCESS === "1") return true
  return Boolean(process.versions?.electron)
}

function normalizeScheme(scheme) {
  return String(scheme || "file").trim().toLowerCase() || "file"
}

module.exports = {
  SearchProviderRegistry,
  SearchProviderType,
  createDefaultSearchProviderRegistry,
  shouldUseSearchWorkerProcess,
}
