/**
 * Cross-goal file locks (PLAN_C §W2.3).
 *
 * Persistent SQLite-backed locks so locks survive across goal worker
 * child_processes. Each lock is keyed by absolute file path and held by
 * a goalId. Stale locks older than STALE_TIMEOUT_MS auto-release.
 */

const path = require("path")
const fs = require("fs")

const DB_DIR = process.env.CODEK_DATA || path.join(require("os").homedir(), ".codek")
const DB_PATH = path.join(DB_DIR, "goals.db")
const STALE_TIMEOUT_MS = 10 * 60 * 1000

let db = null
let inited = false

function getDb() {
  if (db) return db
  try {
    const Database = require("better-sqlite3")
    fs.mkdirSync(DB_DIR, { recursive: true })
    db = new Database(DB_PATH)
    db.pragma("journal_mode = WAL")
  } catch {
    db = null
  }
  return db
}

function ensureTable() {
  if (inited) return
  const d = getDb()
  if (!d) return
  try {
    d.exec(`
      CREATE TABLE IF NOT EXISTS file_locks (
        file_path TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        acquired_at INTEGER NOT NULL
      );
    `)
    inited = true
  } catch {}
}

function reapStale() {
  const d = getDb()
  if (!d) return
  try {
    const cutoff = Date.now() - STALE_TIMEOUT_MS
    const stmt = d.prepare("DELETE FROM file_locks WHERE acquired_at < ?")
    const info = stmt.run(cutoff)
    if (info.changes > 0) {
      console.warn(`[fileLocks] reaped ${info.changes} stale lock(s)`)
    }
  } catch {}
}

function normalize(p) {
  return path.resolve(p).replace(/\\/g, "/")
}

/**
 * Try to acquire locks atomically. Returns { ok: true } on success, or
 * { ok: false, conflictWith: { file, goalId } } if any path is already locked
 * by a different goal.
 */
function acquire(goalId, files) {
  ensureTable()
  reapStale()
  const d = getDb()
  if (!d) return { ok: true }
  const paths = files.map(normalize)
  const tx = d.transaction(() => {
    const sel = d.prepare("SELECT goal_id FROM file_locks WHERE file_path = ?")
    for (const p of paths) {
      const row = sel.get(p)
      if (row && row.goal_id !== goalId) {
        const e = new Error("LOCK_CONFLICT")
        e._conflict = { file: p, goalId: row.goal_id }
        throw e
      }
    }
    const ins = d.prepare("INSERT OR REPLACE INTO file_locks(file_path, goal_id, acquired_at) VALUES (?, ?, ?)")
    const now = Date.now()
    for (const p of paths) ins.run(p, goalId, now)
  })
  try {
    tx()
    return { ok: true }
  } catch (err) {
    if (err && err._conflict) return { ok: false, conflictWith: err._conflict }
    return { ok: true }
  }
}

function release(goalId, files) {
  ensureTable()
  const d = getDb()
  if (!d) return
  try {
    if (files && files.length) {
      const stmt = d.prepare("DELETE FROM file_locks WHERE file_path = ? AND goal_id = ?")
      for (const p of files.map(normalize)) stmt.run(p, goalId)
    } else {
      d.prepare("DELETE FROM file_locks WHERE goal_id = ?").run(goalId)
    }
  } catch {}
}

function listLocked() {
  ensureTable()
  const d = getDb()
  if (!d) return []
  try {
    return d.prepare("SELECT file_path, goal_id, acquired_at FROM file_locks").all()
  } catch { return [] }
}

module.exports = { acquire, release, listLocked, STALE_TIMEOUT_MS }
