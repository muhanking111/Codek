/**
 * MainThreadSecretState — extension SecretStorage bridge.
 *
 * This mirrors VS Code's extension-scoped secret key shape while using a
 * local encrypted file under CODEK_DATA. It keeps plaintext out of disk
 * storage and notifies ExtHostSecretState on changes.
 */

const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")

const CODEK_DATA = process.env.CODEK_DATA || path.join(os.homedir(), ".codek")
const SECRET_FILE = path.join(CODEK_DATA, "extension-secrets.json")
const KEY_FILE = path.join(CODEK_DATA, "extension-secrets.key.json")
const EXT_HOST_SECRET_STATE_NID = 124
const ALGORITHM = "aes-256-gcm"
const KEY_LENGTH = 32
const IV_LENGTH = 12
const TAG_LENGTH = 16

let cache = null

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function normalizeExtensionId(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function normalizeSecretKey(value) {
  return typeof value === "string" ? value.trim() : ""
}

function storageKey(extensionId, key) {
  return JSON.stringify({ extensionId: normalizeExtensionId(extensionId), key: normalizeSecretKey(key) })
}

function parseStorageKey(value) {
  try {
    const parsed = JSON.parse(value)
    const extensionId = normalizeExtensionId(parsed.extensionId)
    const key = normalizeSecretKey(parsed.key)
    return extensionId && key ? { extensionId, key } : undefined
  } catch {
    return undefined
  }
}

function ensureDir() {
  fs.mkdirSync(CODEK_DATA, { recursive: true })
}

function readEncryptionKey() {
  ensureDir()
  try {
    if (fs.existsSync(KEY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(KEY_FILE, "utf8"))
      const key = Buffer.from(parsed.k || "", "base64")
      if (key.length === KEY_LENGTH) return key
    }
  } catch {}

  const key = crypto.randomBytes(KEY_LENGTH)
  fs.writeFileSync(KEY_FILE, JSON.stringify({ kty: "oct", alg: "A256GCM", k: key.toString("base64") }, null, 2), "utf8")
  return key
}

function encrypt(value) {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, readEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    iv: iv.toString("base64"),
    value: Buffer.concat([encrypted, tag]).toString("base64"),
  }
}

function decrypt(record) {
  if (!isObject(record) || typeof record.iv !== "string" || typeof record.value !== "string") return undefined
  const iv = Buffer.from(record.iv, "base64")
  const sealed = Buffer.from(record.value, "base64")
  if (iv.length !== IV_LENGTH || sealed.length <= TAG_LENGTH) return undefined
  const encrypted = sealed.subarray(0, sealed.length - TAG_LENGTH)
  const tag = sealed.subarray(sealed.length - TAG_LENGTH)
  const decipher = crypto.createDecipheriv(ALGORITHM, readEncryptionKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")
}

function loadStore() {
  if (cache) return cache
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SECRET_FILE, "utf8"))
      cache = isObject(parsed) && isObject(parsed.secrets) ? parsed : { version: 1, secrets: {} }
      return cache
    }
  } catch {}
  cache = { version: 1, secrets: {} }
  return cache
}

function flushStore() {
  ensureDir()
  fs.writeFileSync(SECRET_FILE, JSON.stringify(loadStore(), null, 2), "utf8")
}

async function notifyChanged(callEh, extensionId, key, timeoutMs) {
  if (typeof callEh !== "function") return
  await callEh(
    EXT_HOST_SECRET_STATE_NID,
    "$onDidChangePassword",
    [{ extensionId: normalizeExtensionId(extensionId), key: normalizeSecretKey(key) }],
    timeoutMs,
  )
}

async function getPassword(extensionId, key) {
  const extId = normalizeExtensionId(extensionId)
  const secretKey = normalizeSecretKey(key)
  if (!extId || !secretKey) return undefined
  const record = loadStore().secrets[storageKey(extId, secretKey)]
  try {
    return decrypt(record)
  } catch {
    return undefined
  }
}

async function setPassword(extensionId, key, value, options = {}) {
  const extId = normalizeExtensionId(extensionId)
  const secretKey = normalizeSecretKey(key)
  if (!extId || !secretKey) return undefined
  loadStore().secrets[storageKey(extId, secretKey)] = encrypt(String(value ?? ""))
  flushStore()
  await notifyChanged(options.callEh, extId, secretKey, options.timeoutMs || 30000)
  return undefined
}

async function deletePassword(extensionId, key, options = {}) {
  const extId = normalizeExtensionId(extensionId)
  const secretKey = normalizeSecretKey(key)
  if (!extId || !secretKey) return undefined
  delete loadStore().secrets[storageKey(extId, secretKey)]
  flushStore()
  await notifyChanged(options.callEh, extId, secretKey, options.timeoutMs || 30000)
  return undefined
}

async function getKeys(extensionId) {
  const extId = normalizeExtensionId(extensionId)
  if (!extId) return []
  return Object.keys(loadStore().secrets)
    .map(parseStorageKey)
    .filter((parsed) => parsed && parsed.extensionId === extId)
    .map((parsed) => parsed.key)
    .sort()
}

function clearCacheForTests() {
  cache = null
}

function register(server, opts = {}) {
  const callEh = typeof opts.callEh === "function"
    ? opts.callEh
    : (nid, method, args, timeoutMs) => server.call(nid, method, args, timeoutMs)
  const timeoutMs = Math.trunc(Number(opts.timeoutMs)) > 0 ? Math.trunc(Number(opts.timeoutMs)) : 30000
  const options = { callEh, timeoutMs }

  server.onRpc("$getPassword", (args) => {
    const [extensionId, key] = args || []
    return getPassword(extensionId, key)
  })

  server.onRpc("$setPassword", (args) => {
    const [extensionId, key, value] = args || []
    return setPassword(extensionId, key, value, options)
  })

  server.onRpc("$deletePassword", (args) => {
    const [extensionId, key] = args || []
    return deletePassword(extensionId, key, options)
  })

  server.onRpc("$getKeys", (args) => {
    const [extensionId] = args || []
    return getKeys(extensionId)
  })
}

module.exports = {
  EXT_HOST_SECRET_STATE_NID,
  clearCacheForTests,
  deletePassword,
  getKeys,
  getPassword,
  register,
  setPassword,
}
