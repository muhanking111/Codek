/**
 * Vector storage backend — JSON-persisted in-memory store with cosine search.
 *
 * Designed as a stub: same API surface a DuckDB-backed implementation would
 * expose (upsert/search/remove/clear/count). When duckdb-async is available we
 * swap the storage engine without changing callers.
 *
 * Persistence: one JSON file per projectRoot under {CODEK_DATA_DIR}/vectors/.
 * For 10k+ vectors switch to DuckDB; the JSON path is fine for the typical
 * single-repo workspace (a few thousand chunks).
 */

const fs = require("fs")
const path = require("path")
const os = require("os")
const crypto = require("crypto")

const MIN_SCORE_DEFAULT = 0.1
const TOP_K_DEFAULT = 8

function getVectorDir() {
  const base = process.env.CODEK_DATA_DIR || path.join(os.homedir(), ".codek")
  const dir = path.join(base, "vectors")
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function projectFile(projectRoot) {
  const key = crypto.createHash("sha1").update(projectRoot || "default").digest("hex").slice(0, 16)
  return path.join(getVectorDir(), `${key}.json`)
}

const cache = new Map() // projectRoot -> Map<id, entry>
const dirty = new Set() // projectRoot keys awaiting flush

function loadProject(projectRoot) {
  if (cache.has(projectRoot)) return cache.get(projectRoot)
  const file = projectFile(projectRoot)
  const map = new Map()
  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"))
      if (Array.isArray(raw)) {
        for (const entry of raw) if (entry && entry.id) map.set(entry.id, entry)
      }
    } catch {
      // corrupt file — start fresh; next flush will overwrite
    }
  }
  cache.set(projectRoot, map)
  return map
}

function scheduleFlush(projectRoot) {
  dirty.add(projectRoot)
  // Coalesce writes: 500ms debounce per project
  if (scheduleFlush._timer) return
  scheduleFlush._timer = setTimeout(() => {
    scheduleFlush._timer = null
    for (const key of dirty) flushProject(key)
    dirty.clear()
  }, 500)
}

function flushProject(projectRoot) {
  const map = cache.get(projectRoot)
  if (!map) return
  const file = projectFile(projectRoot)
  const arr = Array.from(map.values())
  fs.writeFileSync(file, JSON.stringify(arr))
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i], y = b[i]
    dot += x * y
    na += x * x
    nb += y * y
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8)
}

function matchesFilter(metadata, filter) {
  if (!filter) return true
  for (const k of Object.keys(filter)) {
    if ((metadata || {})[k] !== filter[k]) return false
  }
  return true
}

function upsert({ projectRoot, id, vector, content, metadata }) {
  if (!projectRoot || !id || !Array.isArray(vector)) {
    throw new Error("upsert requires projectRoot, id, vector[]")
  }
  const map = loadProject(projectRoot)
  map.set(id, {
    id,
    vector,
    content: typeof content === "string" ? content : "",
    metadata: metadata || {},
    timestamp: Date.now(),
  })
  scheduleFlush(projectRoot)
  return { id, size: map.size }
}

function upsertBatch({ projectRoot, items }) {
  if (!Array.isArray(items)) throw new Error("items must be an array")
  let count = 0
  for (const it of items) {
    if (it && it.id && Array.isArray(it.vector)) {
      upsert({ projectRoot, ...it })
      count++
    }
  }
  return { inserted: count, size: loadProject(projectRoot).size }
}

function search({ projectRoot, queryVector, topK, minScore, metadataFilter }) {
  if (!Array.isArray(queryVector) || queryVector.length === 0) return []
  const map = loadProject(projectRoot)
  const k = topK || TOP_K_DEFAULT
  const floor = minScore != null ? minScore : MIN_SCORE_DEFAULT
  const out = []
  for (const entry of map.values()) {
    if (!matchesFilter(entry.metadata, metadataFilter)) continue
    const score = cosine(queryVector, entry.vector)
    if (score >= floor) {
      out.push({
        id: entry.id,
        content: entry.content,
        metadata: entry.metadata,
        score,
      })
    }
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, k)
}

function remove({ projectRoot, id }) {
  const map = loadProject(projectRoot)
  const ok = map.delete(id)
  if (ok) scheduleFlush(projectRoot)
  return { removed: ok }
}

function clear({ projectRoot }) {
  const map = loadProject(projectRoot)
  map.clear()
  scheduleFlush(projectRoot)
  return { success: true }
}

function count({ projectRoot }) {
  return { size: loadProject(projectRoot).size }
}

function register(router) {
  const wrap = (fn) => async ({ body }) => {
    try { return { success: true, ...fn(body || {}) } }
    catch (e) { return { success: false, error: e.message } }
  }
  router.register("POST", "/idx/vector/upsert", wrap(upsert))
  router.register("POST", "/idx/vector/upsert-batch", wrap(upsertBatch))
  router.register("POST", "/idx/vector/search", wrap((b) => ({ results: search(b) })))
  router.register("POST", "/idx/vector/remove", wrap(remove))
  router.register("POST", "/idx/vector/clear", wrap(clear))
  router.register("POST", "/idx/vector/count", wrap(count))
}

module.exports = {
  upsert,
  upsertBatch,
  search,
  remove,
  clear,
  count,
  register,
}
