const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  appendExtensionAudit,
  hashError,
  readExtensionAuditLog,
  sanitizeValue,
} = require("./extensionAuditLog")

test("extension audit log redacts obvious secret fields and token values", () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-audit-")), "audit.jsonl")
  appendExtensionAudit({
    action: "install",
    extensionId: "ms-python.python",
    status: "failed",
    error: "Bearer REDACTION_TEST_TOKENqrstuvwxyz",
    metadata: {
      apiKey: "REDACTION_TEST_API_KEY",
      note: "safe",
    },
  }, { filePath, createdAt: "2026-01-01T00:00:00.000Z" })

  const entries = readExtensionAuditLog({ filePath })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].metadata.apiKey, "[redacted]")
  assert.equal(entries[0].metadata.note, "safe")
  assert.equal(entries[0].error.includes("Bearer"), false)
  assert.equal(entries[0].errorHash.length, 16)
})

test("extension audit log reads latest entries only", () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-audit-limit-")), "audit.jsonl")
  appendExtensionAudit({ action: "install", extensionId: "a.one" }, { filePath })
  appendExtensionAudit({ action: "uninstall", extensionId: "b.two" }, { filePath })

  const entries = readExtensionAuditLog({ filePath, limit: 1 })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].extensionId, "b.two")
})

test("sanitizeValue recursively handles arrays and hashes errors deterministically", () => {
  const sanitized = sanitizeValue({ nested: [{ password: "abc" }, "REDACTION_TEST_PROJECT_SECRET"] })
  assert.equal(sanitized.nested[0].password, "[redacted]")
  assert.equal(sanitized.nested[1], "[redacted]")
  assert.equal(hashError("same"), hashError("same"))
})
