/**
 * Model Prefix Cache — caches LLM responses for repeated request prefixes.
 *
 * Strategy:
 * - Hash the last N messages (the "prefix") and cache the response
 * - When the same prefix appears again, return the cached response
 * - LRU eviction: keeps the most recently used entries
 * - Saves API costs for repeated patterns (hover info, completion requests, etc.)
 */

import type { LlmMessageContent } from "./llmClient"

interface CacheEntry {
  key: string
  response: string
  timestamp: number
  hitCount: number
}

const MAX_CACHE_SIZE = 200
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

const cache = new Map<string, CacheEntry>()
const keyOrder: string[] = []

function contentToCacheText(content: LlmMessageContent): string {
  if (typeof content === "string") return content
  return content.map((part) => {
    if (part.type === "text") return part.text
    if (part.type === "image_url") return `[image_url:${part.image_url.url.slice(0, 80)}]`
    return `[image:${part.source.media_type}:${part.source.data.slice(0, 40)}]`
  }).join("\n")
}

function hashMessages(messages: Array<{ role: string; content: LlmMessageContent }>): string {
  // Hash the last N messages to create a prefix key
  const relevant = messages.slice(-6)
  let hash = 0
  for (const msg of relevant) {
    const str = `${msg.role}:${contentToCacheText(msg.content).slice(0, 200)}`
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + ch
      hash |= 0
    }
  }
  return String(hash)
}

function evictLRU(): void {
  while (cache.size >= MAX_CACHE_SIZE && keyOrder.length > 0) {
    const oldest = keyOrder.shift()
    if (oldest) cache.delete(oldest)
  }
}

function touch(key: string): void {
  const idx = keyOrder.indexOf(key)
  if (idx >= 0) keyOrder.splice(idx, 1)
  keyOrder.push(key)
}

/**
 * Check if there's a cached response for the given messages.
 * Returns the cached text or null if not found.
 */
export function getCachedResponse(messages: Array<{ role: string; content: LlmMessageContent }>): string | null {
  const key = hashMessages(messages)
  const entry = cache.get(key)
  if (!entry) return null

  // Check TTL
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key)
    const idx = keyOrder.indexOf(key)
    if (idx >= 0) keyOrder.splice(idx, 1)
    return null
  }

  entry.hitCount++
  touch(key)
  return entry.response
}

/**
 * Store a response in the cache.
 */
export function setCachedResponse(
  messages: Array<{ role: string; content: LlmMessageContent }>,
  response: string,
): void {
  if (!response || response.length < 10) return // Don't cache empty/tiny responses

  const key = hashMessages(messages)
  if (cache.has(key)) return // Already cached

  evictLRU()

  cache.set(key, {
    key,
    response,
    timestamp: Date.now(),
    hitCount: 0,
  })
  keyOrder.push(key)
}

/**
 * Clear the entire cache.
 */
export function clearCache(): void {
  cache.clear()
  keyOrder.length = 0
}

/**
 * Get cache statistics.
 */
export function getCacheStats(): { size: number; hits: number; entries: Array<{ age: number; hits: number }> } {
  const now = Date.now()
  let totalHits = 0
  const entries: Array<{ age: number; hits: number }> = []
  for (const entry of cache.values()) {
    totalHits += entry.hitCount
    entries.push({ age: now - entry.timestamp, hits: entry.hitCount })
  }
  return { size: cache.size, hits: totalHits, entries }
}
