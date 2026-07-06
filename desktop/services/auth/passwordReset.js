const crypto = require("crypto")

const CODE_TTL_MS = 2 * 60 * 1000
const RESEND_COOLDOWN_MS = 60 * 1000
const MAX_ATTEMPTS = 5

const store = new Map()

function generateCode() {
  const n = crypto.randomInt(0, 1_000_000)
  return String(n).padStart(6, "0")
}

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase()
}

function purgeExpired() {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key)
  }
}

function issueCode(email) {
  const key = normalizeEmail(email)
  if (!key) return { ok: false, code: "invalid_email", message: "邮箱不能为空" }
  purgeExpired()
  const now = Date.now()
  const existing = store.get(key)
  if (existing && now - existing.lastSentAt < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - existing.lastSentAt)) / 1000)
    return { ok: false, code: "rate_limited", message: `请 ${wait} 秒后再试`, retryAfter: wait }
  }
  const code = generateCode()
  store.set(key, {
    code,
    expiresAt: now + CODE_TTL_MS,
    lastSentAt: now,
    attempts: 0,
  })
  return { ok: true, code, expiresInMs: CODE_TTL_MS }
}

function verifyCode(email, submitted) {
  const key = normalizeEmail(email)
  if (!key) return { ok: false, code: "invalid_email", message: "邮箱不能为空" }
  purgeExpired()
  const entry = store.get(key)
  if (!entry) return { ok: false, code: "no_code", message: "请先获取验证码" }
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return { ok: false, code: "expired", message: "验证码已过期，请重新获取" }
  }
  entry.attempts += 1
  if (entry.attempts > MAX_ATTEMPTS) {
    store.delete(key)
    return { ok: false, code: "too_many_attempts", message: "尝试次数过多，请重新获取验证码" }
  }
  const a = Buffer.from(String(submitted || "").padEnd(6, " "), "utf8")
  const b = Buffer.from(entry.code, "utf8")
  if (a.length !== b.length) {
    return { ok: false, code: "wrong_code", message: "验证码错误" }
  }
  const match = crypto.timingSafeEqual(a, b)
  if (!match) {
    return { ok: false, code: "wrong_code", message: "验证码错误" }
  }
  return { ok: true }
}

function consumeCode(email) {
  store.delete(normalizeEmail(email))
}

function clearAll() {
  store.clear()
}

module.exports = {
  issueCode,
  verifyCode,
  consumeCode,
  clearAll,
  CODE_TTL_MS,
  RESEND_COOLDOWN_MS,
  MAX_ATTEMPTS,
}
