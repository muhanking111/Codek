const fs = require("fs")
const path = require("path")

function parseEnvLine(rawLine) {
  const line = String(rawLine || "").trim()
  if (!line || line.startsWith("#")) return null

  const normalized = line.startsWith("export ") ? line.slice(7).trim() : line
  const eq = normalized.indexOf("=")
  if (eq <= 0) return null

  const key = normalized.slice(0, eq).trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null

  let value = normalized.slice(eq + 1).trim()
  const quote = value[0]
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    value = value.slice(1, -1)
  }

  return { key, value }
}

function candidateEnvPaths(baseDir = __dirname, cwd = process.cwd()) {
  return [
    path.join(baseDir, ".env"),
    path.join(baseDir, "..", ".env"),
    path.join(baseDir, "..", "..", ".env"),
    path.join(cwd, ".env"),
    path.join(cwd, "..", ".env"),
  ]
}

function loadLocalEnv(options = {}) {
  const baseDir = options.baseDir || __dirname
  const cwd = options.cwd || process.cwd()
  const env = options.env || process.env
  const paths = options.paths || candidateEnvPaths(baseDir, cwd)
  const seen = new Set()
  let loaded = 0

  for (const candidate of paths) {
    const envPath = path.resolve(candidate)
    if (seen.has(envPath) || !fs.existsSync(envPath)) continue
    seen.add(envPath)

    const text = fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "")
    for (const rawLine of text.split(/\r?\n/)) {
      const parsed = parseEnvLine(rawLine)
      if (!parsed || env[parsed.key] !== undefined) continue
      env[parsed.key] = parsed.value
      loaded += 1
    }
  }

  return loaded
}

module.exports = {
  loadLocalEnv,
  parseEnvLine,
  candidateEnvPaths,
}
