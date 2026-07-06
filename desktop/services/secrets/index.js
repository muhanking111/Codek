/**
 * VS Code-style SecretStorage facade for desktop service closure.
 * Values are available through get/set for local delegation, but snapshots and
 * lifecycle evidence always redact secret values.
 */

class SecretStorageClosureService {
  constructor(options = {}) {
    this.serviceId = options.serviceId || "desktopSecretStorageService"
    this.type = options.type || "in-memory"
    this.store = new Map()
    this.evidence = []
  }

  async get(key) {
    const normalized = normalizeKey(key)
    const value = this.store.get(normalized)
    this.recordEvidence(normalized, "get", value !== undefined)
    return value
  }

  async set(key, value) {
    const normalized = normalizeKey(key)
    this.store.set(normalized, String(value))
    this.recordEvidence(normalized, "set", true)
    this.recordEvidence(normalized, "change", true)
  }

  async delete(key) {
    const normalized = normalizeKey(key)
    const found = this.store.delete(normalized)
    this.recordEvidence(normalized, "delete", found)
    this.recordEvidence(normalized, "change", this.store.has(normalized))
  }

  async keys() {
    const keys = Array.from(this.store.keys()).sort()
    this.recordEvidence("__keys__", "keys", keys.length > 0)
    return keys
  }

  getSnapshot() {
    return {
      serviceId: this.serviceId,
      providerType: this.type,
      keyCount: this.store.size,
      keys: Array.from(this.store.keys()).sort(),
      evidence: [...this.evidence],
      constraints: {
        noSecretValueInEvidence: true,
        vscodeSecretStorageKeySemantics: true,
        desktopFacadeOnly: true,
      },
    }
  }

  clear() {
    this.store.clear()
    this.clearEvidence()
  }

  clearEvidence() {
    this.evidence.length = 0
  }

  recordEvidence(key, action, found) {
    this.evidence.push({
      serviceId: this.serviceId,
      key,
      action,
      found: Boolean(found),
      providerType: this.type,
      valueRedacted: true,
      createdAt: Date.now(),
    })
  }
}

function normalizeKey(key) {
  const normalized = String(key || "").trim()
  if (!normalized) throw new Error("Secret key is required")
  return normalized
}

function createSecretStorageClosureService(options) {
  return new SecretStorageClosureService(options)
}

const globalSecretStorageClosureService = createSecretStorageClosureService()

module.exports = {
  SecretStorageClosureService,
  createSecretStorageClosureService,
  globalSecretStorageClosureService,
}
