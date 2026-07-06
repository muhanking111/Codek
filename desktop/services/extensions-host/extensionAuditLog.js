const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const crypto = require("node:crypto")

const SECRET_KEY_PATTERN = /(token|secret|password|passwd|api[-_]?key|authorization|cookie|credential)/i
const SECRET_VALUE_PATTERN = /(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|Bearer\s+[A-Za-z0-9._-]{8,})/gi

function defaultAuditLogPath() {
  const base = process.env.CODEK_DATA || path.join(os.homedir(), ".codek")
  return path.join(base, "User", "extensions", "extension-audit.jsonl")
}

function sanitizeToken(value) {
  return String(value || "")
    .replace(SECRET_VALUE_PATTERN, "[redacted]")
    .slice(0, 1000)
}

function sanitizeValue(value) {
  if (value == null) return value
  if (typeof value === "string") return sanitizeToken(value)
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return value.slice(0, 50).map(sanitizeValue)
  if (typeof value === "object") {
    const out = {}
    for (const [key, nested] of Object.entries(value)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeValue(nested)
    }
    return out
  }
  return String(value)
}

function hashError(error) {
  const text = typeof error === "string"
    ? error
    : String(error?.stack || error?.message || error || "")
  if (!text) return ""
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16)
}

function normalizeAuditEntry(entry = {}, options = {}) {
  const errorText = entry.error ? sanitizeToken(entry.error.message || entry.error) : ""
  return sanitizeValue({
    createdAt: options.createdAt || entry.createdAt || new Date().toISOString(),
    action: entry.action || "unknown",
    extensionId: entry.extensionId || entry.id || "",
    version: entry.version || "",
    source: entry.source || "",
    phase: entry.phase || "",
    status: entry.status || "info",
    correlationId: entry.correlationId || "",
    durationMs: Number.isFinite(Number(entry.durationMs)) ? Number(entry.durationMs) : undefined,
    backupPath: entry.backupPath || "",
    targetPath: entry.targetPath || "",
    error: errorText,
    errorHash: entry.errorHash || hashError(errorText),
    metadata: entry.metadata || undefined,
  })
}

function appendExtensionAudit(entry, options = {}) {
  const filePath = options.filePath || defaultAuditLogPath()
  const normalized = normalizeAuditEntry(entry, options)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.appendFileSync(filePath, `${JSON.stringify(normalized)}\n`, "utf8")
  return normalized
}

function readExtensionAuditLog(options = {}) {
  const filePath = options.filePath || defaultAuditLogPath()
  const limit = Math.max(1, Number(options.limit || 200))
  if (!fs.existsSync(filePath)) return []
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

module.exports = {
  appendExtensionAudit,
  defaultAuditLogPath,
  hashError,
  normalizeAuditEntry,
  readExtensionAuditLog,
  sanitizeValue,
}
