/**
 * Quota — per-goal token & cost ceilings.
 *
 * Stored in goalStore as JSON columns on goals (added lazily via ALTER TABLE).
 * Worker checks remaining budget before each LLM call.
 */

const goalStore = require("../goalStore")

const DEFAULT_TOKEN_LIMIT = 50_000
const DEFAULT_COST_LIMIT = 0.5
const WARN_THRESHOLD = 0.8

function ensureColumns() {
  try {
    const Database = require("better-sqlite3")
    // touch through goalStore: ensure columns exist (no-op if already)
    const path = require("path")
    const os = require("os")
    const fs = require("fs")
    const dir = process.env.CODEK_DATA || path.join(os.homedir(), ".codek")
    const dbPath = path.join(dir, "goals.db")
    if (!fs.existsSync(dbPath)) return
    const db = new Database(dbPath)
    for (const sql of [
      "ALTER TABLE goals ADD COLUMN tokens_used INTEGER DEFAULT 0",
      "ALTER TABLE goals ADD COLUMN cost_used REAL DEFAULT 0",
      "ALTER TABLE goals ADD COLUMN token_limit INTEGER DEFAULT " + DEFAULT_TOKEN_LIMIT,
      "ALTER TABLE goals ADD COLUMN cost_limit REAL DEFAULT " + DEFAULT_COST_LIMIT,
    ]) {
      try { db.exec(sql) } catch {}
    }
    db.close()
  } catch {}
}

function getGoalQuota(goalId) {
  ensureColumns()
  const g = goalStore.getGoal(goalId)
  if (!g) return null
  return {
    tokensUsed: g.tokens_used || 0,
    costUsed: g.cost_used || 0,
    tokenLimit: g.token_limit || DEFAULT_TOKEN_LIMIT,
    costLimit: g.cost_limit || DEFAULT_COST_LIMIT,
  }
}

function recordUsage(goalId, tokens, cost) {
  ensureColumns()
  try {
    const Database = require("better-sqlite3")
    const path = require("path")
    const os = require("os")
    const dir = process.env.CODEK_DATA || path.join(os.homedir(), ".codek")
    const db = new Database(path.join(dir, "goals.db"))
    db.prepare("UPDATE goals SET tokens_used = COALESCE(tokens_used,0) + ?, cost_used = COALESCE(cost_used,0) + ? WHERE id = ?")
      .run(tokens || 0, cost || 0, goalId)
    db.close()
  } catch {}
}

function estimateTokens(value) {
  if (value == null) return 0
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return Math.ceil(String(text).length / 4)
}

async function chargeEstimate(goalId, value, opts = {}) {
  const tokens = Number(opts.tokens ?? estimateTokens(value))
  const costPer1k = Number(opts.costPer1k ?? 0)
  const cost = costPer1k > 0 ? (tokens / 1000) * costPer1k : 0
  if (tokens > 0 || cost > 0) recordUsage(goalId, tokens, cost)
  return check(goalId)
}

async function check(goalId) {
  const q = getGoalQuota(goalId)
  if (!q) return { ok: true }
  if (q.tokensUsed >= q.tokenLimit) return { ok: false, reason: "token limit exceeded" }
  if (q.costUsed >= q.costLimit) return { ok: false, reason: "cost limit exceeded" }
  if (q.tokensUsed >= q.tokenLimit * WARN_THRESHOLD) {
    return { ok: true, warn: `token usage at ${Math.round((q.tokensUsed / q.tokenLimit) * 100)}%` }
  }
  return { ok: true }
}

function setLimits(goalId, { tokenLimit, costLimit } = {}) {
  ensureColumns()
  try {
    const Database = require("better-sqlite3")
    const path = require("path")
    const os = require("os")
    const dir = process.env.CODEK_DATA || path.join(os.homedir(), ".codek")
    const db = new Database(path.join(dir, "goals.db"))
    if (typeof tokenLimit === "number") {
      db.prepare("UPDATE goals SET token_limit = ? WHERE id = ?").run(tokenLimit, goalId)
    }
    if (typeof costLimit === "number") {
      db.prepare("UPDATE goals SET cost_limit = ? WHERE id = ?").run(costLimit, goalId)
    }
    db.close()
  } catch {}
}

module.exports = {
  DEFAULT_TOKEN_LIMIT, DEFAULT_COST_LIMIT, WARN_THRESHOLD,
  getGoalQuota, recordUsage, estimateTokens, chargeEstimate, check, setLimits,
}
