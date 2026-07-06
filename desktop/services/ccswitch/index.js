const path = require("path")
const os = require("os")
const fs = require("fs")
const { app } = require("electron")

function candidatePaths() {
  const out = []
  try {
    if (app && typeof app.getPath === "function") {
      out.push(path.join(app.getPath("appData"), "cc-switch", "cc-switch.db"))
    }
  } catch {}
  if (process.env.APPDATA) {
    out.push(path.join(process.env.APPDATA, "cc-switch", "cc-switch.db"))
  }
  if (process.env.XDG_CONFIG_HOME) {
    out.push(path.join(process.env.XDG_CONFIG_HOME, "cc-switch", "cc-switch.db"))
  }
  const home = os.homedir()
  out.push(path.join(home, ".cc-switch", "cc-switch.db"))
  out.push(path.join(home, ".config", "cc-switch", "cc-switch.db"))
  out.push(path.join(home, "Library", "Application Support", "cc-switch", "cc-switch.db"))
  const seen = new Set()
  return out.filter((p) => {
    if (seen.has(p)) return false
    seen.add(p)
    return true
  })
}

function dbPath() {
  for (const p of candidatePaths()) {
    if (fs.existsSync(p)) return p
  }
  return candidatePaths()[0] || path.join(os.homedir(), ".cc-switch", "cc-switch.db")
}

function loadSqlite() {
  try {
    return require("better-sqlite3")
  } catch (e) {
    throw new Error(`better-sqlite3 unavailable: ${e.message}`)
  }
}

function safeJson(raw) {
  if (!raw || typeof raw !== "string") return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function parseTomlSimple(raw) {
  const out = {}
  if (!raw || typeof raw !== "string") return out
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#") || line.startsWith("[")) continue
    const m = line.match(/^([A-Za-z0-9_\-.]+)\s*=\s*(.+)$/)
    if (!m) continue
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[m[1]] = val
  }
  return out
}

function scan() {
  const file = dbPath()
  if (!fs.existsSync(file)) {
    return { exists: false, path: file, claudeCount: 0, codexCount: 0 }
  }
  const Database = loadSqlite()
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const claudeCount = db.prepare("SELECT COUNT(*) c FROM providers WHERE app_type='claude'").get().c
    const codexCount = db.prepare("SELECT COUNT(*) c FROM providers WHERE app_type='codex'").get().c
    return { exists: true, path: file, claudeCount, codexCount }
  } finally {
    db.close()
  }
}

function buildClaudeEntry(row) {
  const cfg = safeJson(row.settings_config)
  const env = (cfg && cfg.env) || {}
  const baseUrl = env.ANTHROPIC_BASE_URL || env.ANTHROPIC_API_BASE || ""
  const apiKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || ""
  const model = env.ANTHROPIC_MODEL || env.ANTHROPIC_DEFAULT_MODEL || ""
  return {
    name: row.name || "CCS Claude",
    protocol: "anthropic",
    baseUrl: String(baseUrl).replace(/\/+$/, ""),
    apiKey: String(apiKey),
    model: String(model),
  }
}

function buildCodexEntry(row) {
  const cfg = safeJson(row.settings_config)
  const auth = (cfg && cfg.auth) || {}
  const tomlText = (cfg && typeof cfg.config === "string") ? cfg.config : ""
  const toml = parseTomlSimple(tomlText)
  const baseUrl = toml.base_url || toml.OPENAI_BASE_URL || ""
  const apiKey = auth.OPENAI_API_KEY || auth.api_key || toml.api_key || ""
  const model = toml.model || toml.default_model || toml.preferred_model || ""
  return {
    name: row.name || "CCS Codex",
    protocol: "openai",
    baseUrl: String(baseUrl).replace(/\/+$/, ""),
    apiKey: String(apiKey),
    model: String(model),
  }
}

function importEntries(appType) {
  const file = dbPath()
  if (!fs.existsSync(file)) throw new Error(`找不到 cc-switch.db (${file})`)
  if (appType !== "claude" && appType !== "codex") throw new Error(`unsupported appType: ${appType}`)
  const Database = loadSqlite()
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const rows = db
      .prepare("SELECT id, app_type, name, settings_config FROM providers WHERE app_type = ? ORDER BY sort_index ASC, created_at ASC")
      .all(appType)
    const entries = rows.map((r) => (appType === "claude" ? buildClaudeEntry(r) : buildCodexEntry(r)))
    return entries
  } finally {
    db.close()
  }
}

function register(router) {
  router.register("GET", "/ccswitch/scan", async () => {
    try {
      const info = scan()
      return { success: true, ...info }
    } catch (e) {
      return { success: false, error: e.message, path: dbPath() }
    }
  })

  router.register("POST", "/ccswitch/import", async ({ body }) => {
    try {
      const appType = (body && body.appType) || ""
      const entries = importEntries(appType)
      return { success: true, entries }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
}

module.exports = { register }
