/**
 * Web Search — SearXNG / SerpAPI / Bing API integration for @web context.
 *
 * Flow: @web "query" → extract query → call search API → return top 5 results
 */

import { settingsStore } from "../settings/settingsStore"

interface SearchResult {
  title: string
  url: string
  snippet: string
  source: string
}

interface SearchConfig {
  provider: 'searxng' | 'serpapi' | 'bing'
  baseUrl: string
  apiKey?: string
}

const DEFAULT_CONFIG: SearchConfig = {
  provider: 'searxng',
  baseUrl: 'http://localhost:8888',
}

let config: SearchConfig = readSettingsConfig()

export function setSearchConfig(c: Partial<SearchConfig>) {
  config = { ...config, ...c }
  if (c.provider) settingsStore.set("codek.webSearch.provider", c.provider)
  if (c.baseUrl !== undefined) settingsStore.set("codek.webSearch.baseUrl", c.baseUrl)
  if (c.apiKey !== undefined) settingsStore.set("codek.webSearch.apiKey", c.apiKey)
}

export function getSearchConfig() { return { ...config } }

export async function searchWeb(query: string): Promise<SearchResult[]> {
  switch (config.provider) {
    case 'searxng': return searchSearxng(query)
    case 'serpapi': return searchSerpapi(query)
    case 'bing': return searchBing(query)
    default: return searchSearxng(query)
  }
}

async function searchSearxng(query: string): Promise<SearchResult[]> {
  try {
    const url = `${config.baseUrl}/search?q=${encodeURIComponent(query)}&format=json&language=zh-CN`
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!resp.ok) return []
    const data = await resp.json()
    return (data.results || []).slice(0, 5).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.content || r.snippet || '',
      source: 'searxng',
    }))
  } catch { return [] }
}

async function searchSerpapi(query: string): Promise<SearchResult[]> {
  if (!config.apiKey) return []
  try {
    const url = `https://serpapi.com/search?q=${encodeURIComponent(query)}&api_key=${config.apiKey}&engine=google`
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!resp.ok) return []
    const data = await resp.json()
    return (data.organic_results || []).slice(0, 5).map((r: any) => ({
      title: r.title || '',
      url: r.link || '',
      snippet: r.snippet || '',
      source: 'serpapi',
    }))
  } catch { return [] }
}

async function searchBing(query: string): Promise<SearchResult[]> {
  if (!config.apiKey) return []
  try {
    const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=5`
    const resp = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': config.apiKey }, signal: AbortSignal.timeout(8000) })
    if (!resp.ok) return []
    const data = await resp.json()
    return (data.webPages?.value || []).slice(0, 5).map((r: any) => ({
      title: r.name || '',
      url: r.url || '',
      snippet: r.snippet || '',
      source: 'bing',
    }))
  } catch { return [] }
}

function readSettingsConfig(): SearchConfig {
  const provider = settingsStore.get("codek.webSearch.provider")
  const baseUrl = settingsStore.get("codek.webSearch.baseUrl")
  const apiKey = settingsStore.get("codek.webSearch.apiKey")
  return {
    provider: isSearchProvider(provider) ? provider : DEFAULT_CONFIG.provider,
    baseUrl: typeof baseUrl === "string" && baseUrl.trim() ? baseUrl : DEFAULT_CONFIG.baseUrl,
    apiKey: typeof apiKey === "string" ? apiKey : undefined,
  }
}

function isSearchProvider(value: unknown): value is SearchConfig["provider"] {
  return value === "searxng" || value === "serpapi" || value === "bing"
}

settingsStore.subscribe(() => {
  config = readSettingsConfig()
})
