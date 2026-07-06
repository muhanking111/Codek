const dns = require("dns")
const passwordReset = require("./passwordReset")

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase()
}

function isValidEmail(email) {
  return EMAIL_REGEX.test(email || "")
}

async function validateEmailAddress(email, options = {}) {
  const normalized = normalizeEmail(email)
  if (!isValidEmail(normalized)) {
    return { ok: false, code: "invalid_email", message: "请输入有效的邮箱地址" }
  }

  const domain = normalized.slice(normalized.lastIndexOf("@") + 1)
  const resolveMx = options.resolveMx || dns.promises.resolveMx
  let records
  try {
    records = await resolveMx(domain)
  } catch {
    records = []
  }

  const hasMx = Array.isArray(records)
    && records.some((record) => record && typeof record.exchange === "string" && record.exchange.trim())
  if (!hasMx) {
    return { ok: false, code: "email_domain_unreachable", message: "该邮箱域名没有可用的收信记录" }
  }

  return { ok: true, email: normalized }
}

function issueRegistrationCode(email) {
  return passwordReset.issueCode(email)
}

function verifyRegistrationCode(email, code) {
  return passwordReset.verifyCode(email, code)
}

function consumeRegistrationCode(email) {
  passwordReset.consumeCode(email)
}

module.exports = {
  normalizeEmail,
  isValidEmail,
  validateEmailAddress,
  issueRegistrationCode,
  verifyRegistrationCode,
  consumeRegistrationCode,
}
