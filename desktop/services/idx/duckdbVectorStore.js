/**
 * DuckDB-backed vector store adapter.
 *
 * Optional — loaded only when `duckdb-async` is installed. Same surface as
 * vectorStore.js so `index.js` can choose the backend at runtime:
 *
 *   const backend = require("./duckdbVectorStore").tryLoad() || require("./vectorStore")
 *
 * Schema: one row per (project_root, id) with the embedding stored as a
 * DuckDB FLOAT[] array. Search uses `list_cosine_similarity` for fast in-DB
 * scoring when available, falling back to JS cosine when not.
 */

const path = require("path")
const os = require("os")
const fs = require("fs")
const crypto = require("crypto")

const TOP_K_DEFAULT = 8
const MIN_SCORE_DEFAULT = 0.1

let _duck = null
let _db = null
let _connection = null
let _ready = false
let _initPromise = null

function dataPath() {
  const base = process.env.CODEK_DATA_DIR || path.join(os.homedir(), ".codek")
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true })
  return path.join(base, "vectors.duckdb")
}

function tryLoad() {
  if (_duck) return _duck
  try {
    _duck = require("duckdb-async")
    return _duck
  } catch {
    return null
  }
}

async function ensureReady() {
  if (_ready) return _connection
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    const duck = tryLoad()
    if (!duck) throw new Error("duckdb-async not installed")
    _db = await duck.Database.create(dataPath())
    _connection = await _db.connect()
    await _connection.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        project_root TEXT NOT NULL,
        id TEXT NOT NULL,
        vector FLOAT[] NOT NULL,
        content TEXT,
        metadata JSON,
        ts BIGINT,
        PRIMARY KEY (project_root, id)
      )
    `)
    _ready = true
    return _connection
  })()
  return _initPromise
}

function hashRoot(projectRoot) {
  return crypto.createHash("sha1").update(projectRoot || "default").digest("hex").slice(0, 16)
}

async function upsert({ projectRoot, id, vector, content, metadata }) {
  if (!projectRoot || !id || !Array.isArray(vector)) {
    throw new Error("upsert requires projectRoot, id, vector[]")
  }
  const conn = await ensureReady()
  const root = hashRoot(projectRoot)
  await conn.run(
    `INSERT OR REPLACE INTO vectors (project_root, id, vector, content, metadata, ts)
     VALUES (?, ?, ?, ?, ?, ?)`,
    root,
    id,
    vector,
    typeof content === "string" ? content : "",
    JSON.stringify(metadata || {}),
    Date.now(),
  )
  return { id }
}

async function upsertBatch({ projectRoot, items }) {
  if (!Array.isArray(items)) throw new Error("items must be an array")
  const conn = await ensureReady()
  const root = hashRoot(projectRoot)
  await conn.exec("BEGIN")
  try {
    for (const it of items) {
      if (!it || !it.id || !Array.isArray(it.vector)) continue
      await conn.run(
        `INSERT OR REPLACE INTO vectors (project_root, id, vector, content, metadata, ts)
         VALUES (?, ?, ?, ?, ?, ?)`,
        root,
        it.id,
        it.vector,
        typeof it.content === "string" ? it.content : "",
        JSON.stringify(it.metadata || {}),
        Date.now(),
      )
    }
    await conn.exec("COMMIT")
  } catch (e) {
    await conn.exec("ROLLBACK")
    throw e
  }
  return { inserted: items.length }
}

async function search({ projectRoot, queryVector, topK, minScore, metadataFilter }) {
  if (!Array.isArray(queryVector) || queryVector.length === 0) return []
  const conn = await ensureReady()
  const root = hashRoot(projectRoot)
  const k = topK || TOP_K_DEFAULT
  const floor = minScore != null ? minScore : MIN_SCORE_DEFAULT

  const rows = await conn.all(
    `SELECT id, content, metadata,
            list_cosine_similarity(vector, ?::FLOAT[]) AS score
     FROM vectors
     WHERE project_root = ?
     ORDER BY score DESC
     LIMIT ?`,
    queryVector,
    root,
    Math.max(k * 3, k),
  )

  const out = []
  for (const r of rows) {
    if (r.score == null || r.score < floor) continue
    let meta = {}
    try { meta = r.metadata ? JSON.parse(r.metadata) : {} } catch {}
    if (metadataFilter) {
      let ok = true
      for (const key of Object.keys(metadataFilter)) {
        if (meta[key] !== metadataFilter[key]) { ok = false; break }
      }
      if (!ok) continue
    }
    out.push({ id: r.id, content: r.content || "", metadata: meta, score: r.score })
    if (out.length >= k) break
  }
  return out
}

async function remove({ projectRoot, id }) {
  const conn = await ensureReady()
  await conn.run("DELETE FROM vectors WHERE project_root = ? AND id = ?", hashRoot(projectRoot), id)
  return { removed: true }
}

async function clear({ projectRoot }) {
  const conn = await ensureReady()
  await conn.run("DELETE FROM vectors WHERE project_root = ?", hashRoot(projectRoot))
  return { success: true }
}

async function count({ projectRoot }) {
  const conn = await ensureReady()
  const row = await conn.all("SELECT COUNT(*) AS c FROM vectors WHERE project_root = ?", hashRoot(projectRoot))
  return { size: (row?.[0]?.c) || 0 }
}

function register(router) {
  const wrap = (fn) => async ({ body }) => {
    try { return { success: true, ...(await fn(body || {})) } }
    catch (e) { return { success: false, error: e.message } }
  }
  router.register("POST", "/idx/vector/upsert", wrap(upsert))
  router.register("POST", "/idx/vector/upsert-batch", wrap(upsertBatch))
  router.register("POST", "/idx/vector/search", wrap(async (b) => ({ results: await search(b) })))
  router.register("POST", "/idx/vector/remove", wrap(remove))
  router.register("POST", "/idx/vector/clear", wrap(clear))
  router.register("POST", "/idx/vector/count", wrap(count))
}

module.exports = {
  tryLoad,
  isAvailable: () => tryLoad() != null,
  upsert,
  upsertBatch,
  search,
  remove,
  clear,
  count,
  register,
}
