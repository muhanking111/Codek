const fs = require("fs")
const path = require("path")
const os = require("os")

const CONFIG_DIR = path.join(os.homedir(), ".codek")
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json")
const CODEX_DIR = path.join(os.homedir(), ".codex")

const DEFAULTS = {
  ollama: { host: process.env.CODEK_OLLAMA_HOST || "http://localhost:11434" },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    baseUrl: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1",
    version: process.env.ANTHROPIC_VERSION || "2023-06-01",
  },
  "codex-shared": {
    baseUrl: "",
    apiKey: "",
    model: "",
    providerName: "",
  },
}

let cached = null

function readFileConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {}
    const raw = fs.readFileSync(CONFIG_FILE, "utf8")
    return JSON.parse(raw || "{}")
  } catch (e) {
    console.warn("[llm.config] read failed:", e.message)
    return {}
  }
}

function persist(cfg) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8")
  } catch (e) {
    console.warn("[llm.config] persist failed:", e.message)
  }
}

function mergeProvider(name) {
  const fileCfg = readFileConfig()
  const file = (fileCfg.llm && fileCfg.llm[name]) || {}
  return { ...DEFAULTS[name], ...file }
}

function stripComment(line) {
  let inString = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inString) {
      if (ch === "\\") { i++; continue }
      if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'") { inString = ch; continue }
    if (ch === "#") return line.slice(0, i)
  }
  return line
}

function parseScalar(raw) {
  if (!raw) return undefined
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
  }
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1)
  }
  return raw
}

function parseTomlSubset(text) {
  const root = {}
  const sections = {}
  let current = root
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim()
    if (!line) continue
    const sec = /^\[([^\]]+)\]$/.exec(line)
    if (sec) {
      const name = sec[1].trim()
      if (!sections[name]) sections[name] = {}
      current = sections[name]
      continue
    }
    const kv = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line)
    if (!kv) continue
    const value = parseScalar(kv[2].trim())
    if (value !== undefined) current[kv[1].trim()] = value
  }
  return { root, sections }
}

function ensureOpenAIBase(url) {
  const trimmed = url.replace(/\/+$/, "")
  if (/\/v\d+$/.test(trimmed)) return trimmed
  return `${trimmed}/v1`
}

function readCodexAuthJson(authPath) {
  if (!fs.existsSync(authPath)) return ""
  try {
    const parsed = JSON.parse(fs.readFileSync(authPath, "utf8"))
    const candidates = [
      parsed.OPENAI_API_KEY,
      parsed.openai_api_key,
      parsed.apiKey,
      parsed.api_key,
      parsed.tokens && parsed.tokens.access_token,
    ]
    for (const v of candidates) {
      if (typeof v === "string" && v.trim()) return v.trim()
    }
  } catch {}
  return ""
}

function readCodexShared() {
  const tomlPath = path.join(CODEX_DIR, "config.toml")
  if (!fs.existsSync(tomlPath)) {
    return { baseUrl: "", apiKey: "", model: "", providerName: "", error: "no-config-toml" }
  }
  try {
    const parsed = parseTomlSubset(fs.readFileSync(tomlPath, "utf8"))
    const providerName = parsed.root.model_provider
    const model = parsed.root.model
    if (!providerName || !model) {
      return { baseUrl: "", apiKey: "", model: model || "", providerName: providerName || "", error: "missing-root-fields" }
    }
    const section = parsed.sections[`model_providers.${providerName}`]
    if (!section || !section.base_url) {
      return { baseUrl: "", apiKey: "", model, providerName, error: "missing-provider-section" }
    }
    let apiKey = section.experimental_bearer_token || ""
    if (!apiKey) apiKey = readCodexAuthJson(path.join(CODEX_DIR, "auth.json"))
    return {
      baseUrl: ensureOpenAIBase(section.base_url),
      apiKey,
      model,
      providerName,
    }
  } catch (e) {
    return { baseUrl: "", apiKey: "", model: "", providerName: "", error: String(e && e.message || e) }
  }
}

function getConfig() {
  if (cached) return cached
  cached = {
    ollama: mergeProvider("ollama"),
    openai: mergeProvider("openai"),
    anthropic: mergeProvider("anthropic"),
    "codex-shared": readCodexShared(),
  }
  return cached
}

function updateProvider(name, patch) {
  const all = readFileConfig()
  if (!all.llm) all.llm = {}
  all.llm[name] = { ...(all.llm[name] || {}), ...patch }
  persist(all)
  cached = null
  return getConfig()
}

module.exports = { getConfig, updateProvider, readCodexShared }
