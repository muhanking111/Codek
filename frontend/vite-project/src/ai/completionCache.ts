/**
 * Completion Cache — LRU cache for inline completions.
 * Key: filePath + lineNumber + prefixHash
 * Value: completionText
 * TTL: 60s, Max: 500 entries
 */

interface CacheEntry {
  value: string
  expiry: number
}

export class CompletionCache {
  private cache = new Map<string, CacheEntry>()
  private maxSize: number
  private ttlMs: number

  constructor(maxSize = 500, ttlMs = 60000) {
    this.maxSize = maxSize
    this.ttlMs = ttlMs
  }

  private makeKey(filePath: string, lineNumber: number, prefix: string): string {
    let hash = 0
    for (let i = 0; i < prefix.length; i++) {
      hash = ((hash << 5) - hash) + prefix.charCodeAt(i)
      hash |= 0
    }
    return `${filePath}:${lineNumber}:${hash}`
  }

  get(filePath: string, lineNumber: number, prefix: string): string | null {
    const key = this.makeKey(filePath, lineNumber, prefix)
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiry) {
      this.cache.delete(key)
      return null
    }
    return entry.value
  }

  set(filePath: string, lineNumber: number, prefix: string, value: string): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }
    const key = this.makeKey(filePath, lineNumber, prefix)
    this.cache.set(key, { value, expiry: Date.now() + this.ttlMs })
  }

  clear(): void { this.cache.clear() }

  get size(): number { return this.cache.size }

  /**
   * Fallback lookup: scan cache for any entry on the same file+line whose
   * prefix is a prefix of the current text. Used when both the AI model and
   * LSP fail to provide a completion in time.
   */
  lookupByPrefix(filePath: string, lineNumber: number, prefix: string): string | null {
    const filePrefix = `${filePath}:${lineNumber}:`
    const now = Date.now()
    for (const [key, entry] of this.cache) {
      if (!key.startsWith(filePrefix)) continue
      if (now > entry.expiry) {
        this.cache.delete(key)
        continue
      }
      if (entry.value && prefix.length > 0 && entry.value.startsWith(prefix.slice(-Math.min(prefix.length, 24)))) {
        return entry.value
      }
    }
    return null
  }
}

export const globalCompletionCache = new CompletionCache()
