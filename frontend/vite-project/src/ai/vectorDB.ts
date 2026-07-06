import { encode } from "./embedding"

const DB_NAME = "codek-vectordb"
const DB_VERSION = 1
const STORE_NAME = "vectors"

export interface VectorEntry {
  id: string
  vector: number[]
  content: string
  metadata: Record<string, string>
  timestamp: number
}

export interface SearchResult extends VectorEntry {
  score: number
}

export interface SearchOptions {
  topK: number
  minScore: number
  metadataFilter?: Record<string, string>
}

const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  topK: 5,
  minScore: 0.1,
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0

  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }

  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8)
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" })
        store.createIndex("timestamp", "timestamp", { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error("Failed to open IndexedDB"))
  })
}

async function getAllFromStore(): Promise<VectorEntry[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result as VectorEntry[])
    request.onerror = () => reject(new Error("Failed to read from IndexedDB"))
    tx.oncomplete = () => db.close()
  })
}

async function putToStore(entry: VectorEntry): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    store.put(entry)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(new Error("Failed to write to IndexedDB"))
    }
  })
}

async function deleteFromStore(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    store.delete(id)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(new Error("Failed to delete from IndexedDB"))
    }
  })
}

async function clearStore(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    store.clear()
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(new Error("Failed to clear IndexedDB"))
    }
  })
}

function matchesMetadata(
  entry: VectorEntry,
  filter: Record<string, string>,
): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (entry.metadata[key] !== value) return false
  }
  return true
}

export class VectorDB {
  private readonly memoryCache: Map<string, VectorEntry> = new Map()
  private isLoaded = false

  private async ensureLoaded(): Promise<void> {
    if (this.isLoaded) return
    const entries = await getAllFromStore()
    for (const entry of entries) {
      this.memoryCache.set(entry.id, entry)
    }
    this.isLoaded = true
  }

  async add(id: string, content: string, metadata?: Record<string, string>): Promise<void> {
    await this.ensureLoaded()
    const vector = await encode(content)
    const entry: VectorEntry = {
      id,
      vector,
      content,
      metadata: metadata ?? {},
      timestamp: Date.now(),
    }
    this.memoryCache.set(id, entry)
    await putToStore(entry)
  }

  async addBatch(items: Array<{ id: string; content: string; metadata?: Record<string, string> }>): Promise<void> {
    await this.ensureLoaded()
    for (const item of items) {
      const vector = await encode(item.content)
      const entry: VectorEntry = {
        id: item.id,
        vector,
        content: item.content,
        metadata: item.metadata ?? {},
        timestamp: Date.now(),
      }
      this.memoryCache.set(item.id, entry)
      await putToStore(entry)
    }
  }

  async remove(id: string): Promise<boolean> {
    await this.ensureLoaded()
    if (!this.memoryCache.has(id)) return false
    this.memoryCache.delete(id)
    await deleteFromStore(id)
    return true
  }

  async removeBatch(ids: string[]): Promise<number> {
    await this.ensureLoaded()
    let removed = 0
    for (const id of ids) {
      if (this.memoryCache.has(id)) {
        this.memoryCache.delete(id)
        await deleteFromStore(id)
        removed++
      }
    }
    return removed
  }

  async search(query: string, options?: Partial<SearchOptions>): Promise<SearchResult[]> {
    await this.ensureLoaded()
    const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options }
    const qVec = await encode(query)

    const candidates: SearchResult[] = []
    for (const entry of this.memoryCache.values()) {
      if (opts.metadataFilter && !matchesMetadata(entry, opts.metadataFilter)) {
        continue
      }
      const score = cosine(qVec, entry.vector)
      if (score >= opts.minScore) {
        candidates.push({ ...entry, score })
      }
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.topK)
  }

  async searchBatch(
    queries: string[],
    options?: Partial<SearchOptions>,
  ): Promise<SearchResult[][]> {
    const results: SearchResult[][] = []
    for (const query of queries) {
      results.push(await this.search(query, options))
    }
    return results
  }

  async get(id: string): Promise<VectorEntry | undefined> {
    await this.ensureLoaded()
    return this.memoryCache.get(id)
  }

  async count(): Promise<number> {
    await this.ensureLoaded()
    return this.memoryCache.size
  }

  async clear(): Promise<void> {
    this.memoryCache.clear()
    this.isLoaded = false
    await clearStore()
  }

  async getAll(): Promise<VectorEntry[]> {
    await this.ensureLoaded()
    return Array.from(this.memoryCache.values())
  }
}

export const vectorDB = new VectorDB()
