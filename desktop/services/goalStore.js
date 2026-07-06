/**
 * Goal Store — SQLite-backed persistent goal storage with checkpoint recovery.
 * Uses better-sqlite3 for Node native performance.
 */

const path = require("path")
const fs = require("fs")

const DB_DIR = process.env.CODEK_DATA || path.join(require("os").homedir(), ".codek")
const DB_PATH = path.join(DB_DIR, "goals.db")

let db = null

function getDb() {
  if (db) return db
  try {
    const Database = require("better-sqlite3")
    fs.mkdirSync(DB_DIR, { recursive: true })
    db = new Database(DB_PATH)
    db.pragma("journal_mode = WAL")
    initSchema()
    return db
  } catch {
    // Fallback: JSON file storage if better-sqlite3 unavailable
    return getJsonStore()
  }
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      project_root TEXT,
      queue_position INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS steps (
      id TEXT PRIMARY KEY,
      goal_id TEXT REFERENCES goals(id),
      description TEXT,
      status TEXT DEFAULT 'pending',
      result TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      goal_id TEXT REFERENCES goals(id),
      step_index INTEGER,
      conversation_snapshot TEXT,
      created_at INTEGER
    );
  `)
}

// JSON fallback when better-sqlite3 is not available
const JSON_PATH = path.join(DB_DIR, "goals.json")
function getJsonStore() {
  fs.mkdirSync(DB_DIR, { recursive: true })
  return {
    _json: true,
    _read() {
      try { return JSON.parse(fs.readFileSync(JSON_PATH, "utf8")) }
      catch { return { goals: [], steps: [], checkpoints: [] } }
    },
    _write(data) { fs.mkdirSync(DB_DIR, { recursive: true }); fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2)) },
    prepare(sql) { return { run: (...params) => {}, get: () => null, all: () => [] } },
    exec() {},
  }
}

let idCounter = Date.now()
function genId() { return `goal_${idCounter++}` }

// ── API ──────────────────────────────────────────────────────────────

function createGoal(description, projectRoot) {
  const d = getDb()
  const id = genId()
  const ts = Date.now()
  if (d._json) {
    const data = d._read()
    data.goals.push({
      id,
      description,
      status: "pending",
      project_root: projectRoot || "",
      queue_position: 0,
      created_at: ts,
      updated_at: ts,
    })
    d._write(data)
    return { id, description, status: "pending", projectRoot }
  }
  d.prepare("INSERT INTO goals (id, description, status, project_root, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?, ?)").run(id, description, projectRoot || "", ts, ts)
  return { id, description, status: "pending", projectRoot }
}

function listGoals(status) {
  const d = getDb()
  if (d._json) {
    const goals = d._read().goals
      .filter((g) => !status || g.status === status)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    return goals
  }
  if (status) {
    return d.prepare("SELECT * FROM goals WHERE status = ? ORDER BY created_at DESC").all(status)
  }
  return d.prepare("SELECT * FROM goals ORDER BY created_at DESC").all()
}

function getGoal(id) {
  const d = getDb()
  if (d._json) {
    const data = d._read()
    const goal = data.goals.find((g) => g.id === id)
    if (!goal) return null
    return {
      ...goal,
      steps: data.steps.filter((s) => s.goal_id === id).sort((a, b) => (a.created_at || 0) - (b.created_at || 0)),
      checkpoints: data.checkpoints
        .filter((c) => c.goal_id === id)
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        .slice(0, 10),
    }
  }
  const goal = d.prepare("SELECT * FROM goals WHERE id = ?").get(id)
  if (!goal) return null
  goal.steps = d.prepare("SELECT * FROM steps WHERE goal_id = ? ORDER BY created_at").all(id)
  goal.checkpoints = d.prepare("SELECT * FROM checkpoints WHERE goal_id = ? ORDER BY created_at DESC LIMIT 10").all(id)
  return goal
}

function updateGoalStatus(id, status) {
  const d = getDb()
  if (d._json) {
    const data = d._read()
    const goal = data.goals.find((g) => g.id === id)
    if (goal) {
      goal.status = status
      goal.updated_at = Date.now()
      if (status !== "queued") goal.queue_position = 0
    }
    d._write(data)
    return
  }
  d.prepare("UPDATE goals SET status = ?, updated_at = ? WHERE id = ?").run(status, Date.now(), id)
}

function addStep(goalId, description) {
  const d = getDb()
  const id = `step_${genId()}`
  if (d._json) {
    const data = d._read()
    data.steps.push({ id, goal_id: goalId, description, status: "pending", result: "", created_at: Date.now() })
    d._write(data)
    return id
  }
  d.prepare("INSERT INTO steps (id, goal_id, description, status, created_at) VALUES (?, ?, ?, 'pending', ?)").run(id, goalId, description, Date.now())
  return id
}

function updateStep(id, status, result) {
  const d = getDb()
  if (d._json) {
    const data = d._read()
    const step = data.steps.find((s) => s.id === id)
    if (step) {
      step.status = status
      step.result = result || ""
    }
    d._write(data)
    return
  }
  d.prepare("UPDATE steps SET status = ?, result = ? WHERE id = ?").run(status, result || "", id)
}

function saveCheckpoint(goalId, stepIndex, conversationSnapshot) {
  const d = getDb()
  const id = `ckpt_${genId()}`
  const snap = typeof conversationSnapshot === "string" ? conversationSnapshot : JSON.stringify(conversationSnapshot)
  // Limit checkpoint size to 50KB
  const truncated = snap.length > 51200 ? snap.slice(0, 51200) : snap
  if (d._json) {
    const data = d._read()
    data.checkpoints.push({ id, goal_id: goalId, step_index: stepIndex, conversation_snapshot: truncated, created_at: Date.now() })
    const keep = data.checkpoints
      .filter((c) => c.goal_id === goalId)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      .slice(0, 10)
      .map((c) => c.id)
    data.checkpoints = data.checkpoints.filter((c) => c.goal_id !== goalId || keep.includes(c.id))
    d._write(data)
    return id
  }
  d.prepare("INSERT INTO checkpoints (id, goal_id, step_index, conversation_snapshot, created_at) VALUES (?, ?, ?, ?, ?)").run(id, goalId, stepIndex, truncated, Date.now())
  // Keep only last 10 checkpoints per goal
  const count = d.prepare("SELECT COUNT(*) as cnt FROM checkpoints WHERE goal_id = ?").get(goalId)
  if (count && count.cnt > 10) {
    d.prepare("DELETE FROM checkpoints WHERE goal_id = ? AND id NOT IN (SELECT id FROM checkpoints WHERE goal_id = ? ORDER BY created_at DESC LIMIT 10)").run(goalId, goalId)
  }
  return id
}

function getLastCheckpoint(goalId) {
  const d = getDb()
  if (d._json) {
    return d._read().checkpoints
      .filter((c) => c.goal_id === goalId)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0] || null
  }
  return d.prepare("SELECT * FROM checkpoints WHERE goal_id = ? ORDER BY created_at DESC LIMIT 1").get(goalId)
}

function deleteGoal(id) {
  const d = getDb()
  if (d._json) {
    const data = d._read()
    data.checkpoints = data.checkpoints.filter((c) => c.goal_id !== id)
    data.steps = data.steps.filter((s) => s.goal_id !== id)
    data.goals = data.goals.filter((g) => g.id !== id)
    d._write(data)
    return
  }
  d.prepare("DELETE FROM checkpoints WHERE goal_id = ?").run(id)
  d.prepare("DELETE FROM steps WHERE goal_id = ?").run(id)
  d.prepare("DELETE FROM goals WHERE id = ?").run(id)
}

function getIncompleteGoals() {
  const d = getDb()
  if (d._json) {
    return d._read().goals
      .filter((g) => ["running", "pending"].includes(g.status))
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
  }
  return d.prepare("SELECT * FROM goals WHERE status IN ('running', 'pending') ORDER BY created_at DESC").all()
}

function enqueueGoal(id) {
  const d = getDb()
  if (d._json) {
    const data = d._read()
    const max = data.goals
      .filter((g) => g.status === "queued")
      .reduce((m, g) => Math.max(m, g.queue_position || 0), 0)
    const next = max + 1
    const goal = data.goals.find((g) => g.id === id)
    if (goal) {
      goal.status = "queued"
      goal.queue_position = next
      goal.updated_at = Date.now()
    }
    d._write(data)
    return { id, queuePosition: next }
  }
  // Migration safety: add queue_position column if missing on old databases
  try { d.exec("ALTER TABLE goals ADD COLUMN queue_position INTEGER DEFAULT 0") } catch {}
  const max = d.prepare("SELECT MAX(queue_position) AS m FROM goals WHERE status = 'queued'").get()
  const next = (max?.m || 0) + 1
  d.prepare("UPDATE goals SET status = 'queued', queue_position = ?, updated_at = ? WHERE id = ?")
    .run(next, Date.now(), id)
  return { id, queuePosition: next }
}

function dequeueGoal(id) {
  const d = getDb()
  if (d._json) {
    const data = d._read()
    const goal = data.goals.find((g) => g.id === id)
    if (goal) {
      goal.status = "pending"
      goal.queue_position = 0
      goal.updated_at = Date.now()
    }
    d._write(data)
    return { id }
  }
  d.prepare("UPDATE goals SET status = 'pending', queue_position = 0, updated_at = ? WHERE id = ?")
    .run(Date.now(), id)
  return { id }
}

function listQueue() {
  const d = getDb()
  if (d._json) {
    return d._read().goals
      .filter((g) => g.status === "queued")
      .sort((a, b) => (a.queue_position || 0) - (b.queue_position || 0))
  }
  try {
    return d.prepare("SELECT * FROM goals WHERE status = 'queued' ORDER BY queue_position ASC").all()
  } catch { return [] }
}

function getNextQueuedGoal() {
  const d = getDb()
  if (d._json) {
    const data = d._read()
    const row = data.goals
      .filter((g) => g.status === "queued")
      .sort((a, b) => (a.queue_position || 0) - (b.queue_position || 0))[0]
    if (row) {
      row.status = "running"
      row.queue_position = 0
      row.updated_at = Date.now()
      d._write(data)
    }
    return row || null
  }
  try {
    const row = d.prepare("SELECT * FROM goals WHERE status = 'queued' ORDER BY queue_position ASC LIMIT 1").get()
    if (row) {
      d.prepare("UPDATE goals SET status = 'running', queue_position = 0, updated_at = ? WHERE id = ?")
        .run(Date.now(), row.id)
    }
    return row || null
  } catch { return null }
}

module.exports = {
  createGoal, listGoals, getGoal, updateGoalStatus,
  addStep, updateStep, saveCheckpoint, getLastCheckpoint,
  deleteGoal, getIncompleteGoals,
  enqueueGoal, dequeueGoal, listQueue, getNextQueuedGoal,
}
