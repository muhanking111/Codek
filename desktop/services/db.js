const Database = require("better-sqlite3")
const path = require("path")
const fs = require("fs")
const os = require("os")

let dbInstance = null

function getDataDir() {
  const dir = process.env.CODEK_DATA_DIR || path.join(os.homedir(), ".codek")
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const dataDir = path.join(dir, "data")
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
  return dataDir
}

function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at INTEGER NOT NULL
  )`)

  const migrationsDir = path.join(__dirname, "migrations")
  if (!fs.existsSync(migrationsDir)) return

  const applied = new Set(
    db.prepare("SELECT name FROM _migrations").all().map((r) => r.name),
  )

  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8")
    const tx = db.transaction(() => {
      db.exec(sql)
      db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)")
        .run(file, Date.now())
    })
    tx()
    console.log(`[db] applied migration: ${file}`)
  }
}

function getDb() {
  if (dbInstance) return dbInstance
  const dbPath = path.join(getDataDir(), "codek.db")
  dbInstance = new Database(dbPath)
  dbInstance.pragma("journal_mode = WAL")
  dbInstance.pragma("foreign_keys = ON")
  runMigrations(dbInstance)
  console.log(`[db] ready at ${dbPath}`)
  return dbInstance
}

function closeDb() {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}

module.exports = { getDb, closeDb, getDataDir }
