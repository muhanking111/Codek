const { getDb } = require("../db")
const vectorStore = require("./vectorStore")
const duckdbVectorStore = require("./duckdbVectorStore")

function escapeFts5(query) {
  return (query || "").replace(/[\x00-\x1F\x7F"*]/g, " ").trim()
}

function indexFile({ projectRoot, filePath, name, functions, variables, imports, contentPreview, lineCount, contentHash }) {
  const db = getDb()
  db.prepare("DELETE FROM code_index WHERE file_path = ? AND project_root = ?").run(filePath, projectRoot)
  db.prepare(`
    INSERT INTO code_index (file_path, name, functions, variables, imports, content_preview, line_count, project_root)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(filePath, name || "", functions || "", variables || "", imports || "", contentPreview || "", lineCount || 0, projectRoot)
  db.prepare(`
    INSERT INTO index_meta (file_path, content_hash, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET content_hash = excluded.content_hash, updated_at = excluded.updated_at
  `).run(filePath, contentHash || "", Date.now())
}

function clearProjectIndex(projectRoot) {
  getDb().prepare("DELETE FROM code_index WHERE project_root = ?").run(projectRoot)
}

function search(query, projectRoot, limit) {
  const escaped = escapeFts5(query)
  if (!escaped) return []
  const rows = getDb().prepare(`
    SELECT file_path, name, functions, variables, content_preview, line_count, rank
    FROM code_index
    WHERE code_index MATCH ? AND project_root = ?
    ORDER BY rank
    LIMIT ?
  `).all(escaped, projectRoot, Math.max(limit || 20, 1))
  return rows.map((r) => ({
    filePath: r.file_path,
    name: r.name,
    functions: r.functions,
    variables: r.variables,
    contentPreview: r.content_preview,
    lineCount: r.line_count,
    rank: r.rank,
  }))
}

function indexSize(projectRoot) {
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM code_index WHERE project_root = ?").get(projectRoot)
  return row ? row.c : 0
}

function addDocument({ projectRoot, title, content, category }) {
  const db = getDb()
  db.prepare("DELETE FROM knowledge_base WHERE title = ? AND project_root = ?").run(title, projectRoot)
  db.prepare("INSERT INTO knowledge_base (title, content, category, project_root) VALUES (?, ?, ?, ?)")
    .run(title, content || "", category || "", projectRoot)
}

function searchKnowledge(query, projectRoot, limit) {
  const escaped = escapeFts5(query)
  if (!escaped) return []
  const rows = getDb().prepare(`
    SELECT title, content, category,
      snippet(knowledge_base, 0, '<mark>', '</mark>', '...', 40) AS snippet
    FROM knowledge_base
    WHERE knowledge_base MATCH ? AND project_root = ?
    ORDER BY rank
    LIMIT ?
  `).all(escaped, projectRoot, Math.max(limit || 20, 1))
  return rows
}

function register(router) {
  const wrap = (fn) => async ({ body }) => {
    try { return await fn(body) } catch (e) { return { success: false, error: e.message } }
  }

  router.register("POST", "/index/file", wrap(async (b) => {
    indexFile(b)
    return { success: true }
  }))
  router.register("POST", "/index/clear", wrap(async (b) => {
    clearProjectIndex(b.projectRoot)
    return { success: true }
  }))
  router.register("POST", "/index/search", wrap(async (b) => ({
    success: true,
    results: search(b.query, b.projectRoot, b.limit),
  })))
  router.register("POST", "/index/size", wrap(async (b) => ({
    success: true,
    size: indexSize(b.projectRoot),
  })))

  router.register("POST", "/knowledge/add", wrap(async (b) => {
    addDocument(b)
    return { success: true }
  }))
  router.register("POST", "/knowledge/search", wrap(async (b) => ({
    success: true,
    results: searchKnowledge(b.query, b.projectRoot, b.limit),
  })))

  // Choose vector backend: DuckDB if available, else JSON-persisted in-memory.
  // The router matches routes in registration order, so we register only one.
  if (duckdbVectorStore.isAvailable()) {
    console.log("[idx] duckdb-async available — using DuckDB vector backend")
    duckdbVectorStore.register(router)
  } else {
    vectorStore.register(router)
  }
}

module.exports = { register }
