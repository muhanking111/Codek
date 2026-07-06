/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code MCP registry input storage:
 * - D:\SourceMirror\vscode\src\vs\workbench\contrib\mcp\common\mcpRegistryInputStorage.ts
 *--------------------------------------------------------------------------------------------*/

const crypto = require("node:crypto")
const userDataProfile = require("../userDataProfile")

const MCP_ENCRYPTION_KEY_NAME = "mcpEncryptionKey"
const MCP_ENCRYPTION_KEY_ALGORITHM = "aes-256-gcm"
const MCP_ENCRYPTION_KEY_LEN = 32
const MCP_ENCRYPTION_IV_LENGTH = 12
const MCP_AUTH_TAG_LENGTH = 16
const MCP_DATA_STORED_VERSION = 1
const MCP_DATA_STORED_KEY = "mcpInputs"
const DEFAULT_INPUT_STORAGE_PROFILE_ID = userDataProfile.DEFAULT_PROFILE_ID

const defaultLogService = {
  warn: (...args) => console.warn(...args),
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function normalizeResolvedValue(value) {
  if (isRecord(value)) return { ...value }
  return { value }
}

function normalizeResolvedValueMap(values) {
  const output = {}
  if (!isRecord(values)) return output
  for (const [key, value] of Object.entries(values)) {
    const inputKey = String(key || "").trim()
    if (!inputKey) continue
    output[inputKey] = normalizeResolvedValue(value)
  }
  return output
}

function cloneMap(values) {
  return Object.fromEntries(
    Object.entries(isRecord(values) ? values : {}).map(([key, value]) => [key, normalizeResolvedValue(value)]),
  )
}

function normalizeStoredRecord(value) {
  if (!isRecord(value) || value.version !== MCP_DATA_STORED_VERSION) {
    return { version: MCP_DATA_STORED_VERSION, values: {} }
  }
  const record = {
    version: MCP_DATA_STORED_VERSION,
    values: cloneMap(value.values),
  }
  if (isRecord(value.secrets) && typeof value.secrets.value === "string" && typeof value.secrets.iv === "string") {
    record.secrets = { value: value.secrets.value, iv: value.secrets.iv }
  }
  return record
}

function parseStoredRecord(raw) {
  if (typeof raw !== "string" || !raw.trim()) return { version: MCP_DATA_STORED_VERSION, values: {} }
  try {
    return normalizeStoredRecord(JSON.parse(raw))
  } catch {
    return { version: MCP_DATA_STORED_VERSION, values: {} }
  }
}

function serializeStoredRecord(record) {
  const output = {
    version: MCP_DATA_STORED_VERSION,
    values: cloneMap(record.values),
  }
  if (isRecord(record.secrets)) {
    output.secrets = { value: String(record.secrets.value || ""), iv: String(record.secrets.iv || "") }
  }
  return JSON.stringify(output)
}

function readStorageEntry(profileId, key, options = {}) {
  const data = userDataProfile.readProfileStorageData(profileId, options)
  return data.entries[key]?.value
}

function writeStorageEntries(profileId, entries, options = {}) {
  return userDataProfile.updateProfileStorageData(profileId, {
    target: userDataProfile.STORAGE_TARGET.USER,
    scope: userDataProfile.STORAGE_SCOPE.PROFILE,
    data: entries,
  }, {
    ...options,
    changeReason: options.changeReason || "mcp-input-storage:update",
  })
}

class McpRegistryInputStorageAdapter {
  constructor(options = {}) {
    this.profileId = typeof options.profileId === "string" && options.profileId.trim()
      ? options.profileId.trim()
      : DEFAULT_INPUT_STORAGE_PROFILE_ID
    this.storageOptions = options.storageOptions || {}
    this.logService = options.logService || defaultLogService
    this.unsealedSecrets = undefined
    this.record = parseStoredRecord(readStorageEntry(this.profileId, MCP_DATA_STORED_KEY, this.storageOptions))
  }

  async clearAll() {
    this.record.values = {}
    this.record.secrets = undefined
    this.unsealedSecrets = undefined
    this.flush()
  }

  async clear(inputKey) {
    const key = String(inputKey || "").trim()
    if (!key) return
    const secrets = await this.unsealSecrets()
    delete this.record.values[key]
    if (Object.prototype.hasOwnProperty.call(secrets, key)) {
      delete secrets[key]
      await this.sealSecrets()
    } else {
      this.flush()
    }
  }

  async getMap() {
    const secrets = await this.unsealSecrets()
    return {
      ...cloneMap(this.record.values),
      ...cloneMap(secrets),
    }
  }

  async setPlainText(values) {
    Object.assign(this.record.values, normalizeResolvedValueMap(values))
    this.flush()
  }

  async setSecrets(values) {
    const secrets = await this.unsealSecrets()
    Object.assign(secrets, normalizeResolvedValueMap(values))
    await this.sealSecrets()
  }

  flush() {
    writeStorageEntries(this.profileId, {
      [MCP_DATA_STORED_KEY]: serializeStoredRecord(this.record),
    }, this.storageOptions)
  }

  readEncryptionKey() {
    const raw = readStorageEntry(this.profileId, MCP_ENCRYPTION_KEY_NAME, this.storageOptions)
    if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed = JSON.parse(raw)
        const key = Buffer.from(parsed.k || parsed.key || "", "base64")
        if (key.length === MCP_ENCRYPTION_KEY_LEN) return key
      } catch {
        // Fall through and replace invalid key material.
      }
    }
    const key = crypto.randomBytes(MCP_ENCRYPTION_KEY_LEN)
    writeStorageEntries(this.profileId, {
      [MCP_ENCRYPTION_KEY_NAME]: JSON.stringify({
        kty: "oct",
        alg: "A256GCM",
        k: key.toString("base64"),
      }),
    }, this.storageOptions)
    return key
  }

  async sealSecrets() {
    const secrets = cloneMap(this.unsealedSecrets)
    if (Object.keys(secrets).length === 0) {
      this.record.secrets = undefined
      this.flush()
      return
    }

    const iv = crypto.randomBytes(MCP_ENCRYPTION_IV_LENGTH)
    const cipher = crypto.createCipheriv(MCP_ENCRYPTION_KEY_ALGORITHM, this.readEncryptionKey(), iv)
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(secrets), "utf8"),
      cipher.final(),
    ])
    const tag = cipher.getAuthTag()
    this.record.secrets = {
      iv: iv.toString("base64"),
      value: Buffer.concat([encrypted, tag]).toString("base64"),
    }
    this.flush()
  }

  async unsealSecrets() {
    if (this.unsealedSecrets) return this.unsealedSecrets
    if (!this.record.secrets) {
      this.unsealedSecrets = {}
      return this.unsealedSecrets
    }

    try {
      const iv = Buffer.from(this.record.secrets.iv, "base64")
      const sealed = Buffer.from(this.record.secrets.value, "base64")
      if (iv.length !== MCP_ENCRYPTION_IV_LENGTH || sealed.length <= MCP_AUTH_TAG_LENGTH) {
        throw new Error("Invalid MCP secret payload")
      }
      const encrypted = sealed.subarray(0, sealed.length - MCP_AUTH_TAG_LENGTH)
      const tag = sealed.subarray(sealed.length - MCP_AUTH_TAG_LENGTH)
      const decipher = crypto.createDecipheriv(MCP_ENCRYPTION_KEY_ALGORITHM, this.readEncryptionKey(), iv)
      decipher.setAuthTag(tag)
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")
      this.unsealedSecrets = cloneMap(JSON.parse(decrypted))
      return this.unsealedSecrets
    } catch (error) {
      this.logService.warn("Error unsealing MCP secrets", error)
      this.record.secrets = undefined
      this.unsealedSecrets = {}
      this.flush()
      return this.unsealedSecrets
    }
  }
}

module.exports = {
  DEFAULT_INPUT_STORAGE_PROFILE_ID,
  MCP_DATA_STORED_KEY,
  MCP_DATA_STORED_VERSION,
  MCP_ENCRYPTION_KEY_ALGORITHM,
  MCP_ENCRYPTION_KEY_NAME,
  McpRegistryInputStorageAdapter,
}
