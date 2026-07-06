const bcrypt = require("bcrypt")
const crypto = require("crypto")
const { getDb } = require("../db")
const { HttpError } = require("../router")
const captcha = require("./captcha")
const oauth = require("./oauth")
const passwordReset = require("./passwordReset")
const mailer = require("./mailer")
const emailVerification = require("./emailVerification")
const {
  ACCESS_EXPIRE_MS,
  REFRESH_EXPIRE_MS,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshTokenSignature,
} = require("./jwt")

function normalizeEmail(email) {
  return emailVerification.normalizeEmail(email)
}

function isValidEmail(email) {
  return emailVerification.isValidEmail(email)
}

function errorResult(code, message) {
  return {
    success: false,
    token: "",
    username: "",
    email: "",
    refreshToken: "",
    error: message,
    errorCode: code,
  }
}

async function buildSuccess(username, email) {
  const accessToken = await signAccessToken(username)
  const refreshToken = await signRefreshToken(username)
  const db = getDb()
  db.prepare(
    "INSERT INTO refresh_tokens (username, token, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).run(username, refreshToken, Date.now() + REFRESH_EXPIRE_MS, Date.now())
  return {
    success: true,
    token: accessToken,
    username,
    email: email || "",
    refreshToken,
    error: "",
    errorCode: "",
  }
}

function verifyLegacyPassword(password, storedHash, storedSalt) {
  const hash = crypto.createHash("sha256")
  hash.update(Buffer.from(storedSalt || "", "utf8"))
  hash.update(Buffer.from(password, "utf8"))
  const computed = hash.digest("hex")
  const a = Buffer.from(computed, "utf8")
  const b = Buffer.from(storedHash, "utf8")
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

async function verifyPassword(password, storedHash, storedSalt, username) {
  if (
    storedHash.startsWith("$2a$")
    || storedHash.startsWith("$2b$")
    || storedHash.startsWith("$2y$")
  ) {
    return bcrypt.compare(password, storedHash)
  }
  const ok = verifyLegacyPassword(password, storedHash, storedSalt)
  if (ok) {
    try {
      const newHash = await bcrypt.hash(password, 10)
      getDb().prepare(
        "UPDATE users SET password_hash = ?, salt = '' WHERE username = ?",
      ).run(newHash, username)
      console.log(`[auth] migrated legacy password to bcrypt for ${username}`)
    } catch (e) {
      console.warn("[auth] legacy → bcrypt migration failed:", e.message)
    }
  }
  return ok
}

async function requestRegisterCode(email) {
  const validated = await emailVerification.validateEmailAddress(email)
  if (!validated.ok) return errorResult(validated.code, validated.message)

  const normalized = validated.email
  const existing = getDb().prepare("SELECT COUNT(*) AS c FROM users WHERE email = ?").get(normalized)
  if (existing && existing.c > 0) return errorResult("email_taken", "该邮箱已注册")

  const issued = emailVerification.issueRegistrationCode(normalized)
  if (!issued.ok) {
    return {
      ...errorResult(issued.code, issued.message),
      retryAfter: issued.retryAfter || 0,
    }
  }

  try {
    const result = await mailer.sendVerificationCode(normalized, issued.code, issued.expiresInMs)
    return {
      success: true,
      delivered: result.delivered,
      devMode: result.devMode,
      expiresInMs: issued.expiresInMs,
      resendCooldownMs: passwordReset.RESEND_COOLDOWN_MS,
    }
  } catch (err) {
    console.error("[auth] registration verification email failed:", err.message)
    return errorResult("mail_send_failed", "验证码邮件发送失败，请稍后再试")
  }
}

async function registerByEmail(email, password, code) {
  const validated = await emailVerification.validateEmailAddress(email)
  if (!validated.ok) return errorResult(validated.code, validated.message)
  if (!password || password.length < 6) return errorResult("password_short", "密码至少 6 位")
  const normalized = validated.email

  const db = getDb()
  const existing = db.prepare("SELECT COUNT(*) AS c FROM users WHERE email = ?").get(normalized)
  if (existing && existing.c > 0) return errorResult("email_taken", "该邮箱已注册")

  const verified = emailVerification.verifyRegistrationCode(normalized, code)
  if (!verified.ok) return errorResult(verified.code, verified.message)

  const hashed = await bcrypt.hash(password, 10)
  db.prepare(
    "INSERT INTO users (username, email, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(normalized, normalized, hashed, "", Date.now())
  emailVerification.consumeRegistrationCode(normalized)
  console.log(`[auth] user registered: ${normalized}`)
  return buildSuccess(normalized, normalized)
}
async function loginByEmail(email, password) {
  if (!isValidEmail(email) || !password) {
    return errorResult("invalid_email", "请输入有效的邮箱与密码")
  }
  const normalized = normalizeEmail(email)
  const row = getDb().prepare(
    "SELECT username, email, password_hash, salt FROM users WHERE email = ?",
  ).get(normalized)
  if (!row) return errorResult("user_not_found", "账号不存在")
  if (!row.password_hash) return errorResult("oauth_only", "该账号通过第三方登录，请使用对应方式登录")
  const ok = await verifyPassword(password, row.password_hash, row.salt, row.username)
  if (!ok) return errorResult("wrong_password", "密码错误")
  console.log(`[auth] user logged in: ${normalized}`)
  return buildSuccess(row.username, row.email || normalized)
}

async function loginOrCreateOAuth(provider, oauthId, email) {
  if (!provider || !oauthId) return errorResult("oauth_missing", "缺少 OAuth 信息")
  const db = getDb()
  const existing = db.prepare(
    "SELECT username, email FROM users WHERE oauth_provider = ? AND oauth_id = ?",
  ).get(provider, oauthId)
  if (existing) return buildSuccess(existing.username, existing.email || "")

  const username = `${provider}:${oauthId}`
  const safeEmail = normalizeEmail(email || "")
  db.prepare(
    "INSERT INTO users (username, email, password_hash, salt, oauth_provider, oauth_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(username, safeEmail, "", "", provider, oauthId, Date.now())
  console.log(`[auth] oauth user created: ${username}`)
  return buildSuccess(username, safeEmail)
}

async function refreshAccessToken(refreshToken) {
  if (!refreshToken) return { success: false, accessToken: "", refreshToken: "", error: "缺少刷新令牌" }
  const username = await verifyRefreshTokenSignature(refreshToken)
  if (!username) return { success: false, accessToken: "", refreshToken: "", error: "刷新令牌无效或已过期" }
  const db = getDb()
  const row = db.prepare(
    "SELECT expires_at FROM refresh_tokens WHERE token = ? AND username = ?",
  ).get(refreshToken, username)
  if (!row) return { success: false, accessToken: "", refreshToken: "", error: "刷新令牌无效或已过期" }
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM refresh_tokens WHERE token = ?").run(refreshToken)
    return { success: false, accessToken: "", refreshToken: "", error: "刷新令牌已过期" }
  }
  db.prepare("DELETE FROM refresh_tokens WHERE token = ?").run(refreshToken)
  const newAccess = await signAccessToken(username)
  const newRefresh = await signRefreshToken(username)
  db.prepare(
    "INSERT INTO refresh_tokens (username, token, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).run(username, newRefresh, Date.now() + REFRESH_EXPIRE_MS, Date.now())
  return { success: true, accessToken: newAccess, refreshToken: newRefresh, error: "" }
}

function lookupEmail(username) {
  if (!username) return ""
  const row = getDb().prepare("SELECT email FROM users WHERE username = ?").get(username)
  return (row && row.email) || ""
}

async function requestPasswordReset(email) {
  if (!isValidEmail(email)) {
    return { success: false, error: "请输入有效的邮箱地址", errorCode: "invalid_email" }
  }
  const normalized = normalizeEmail(email)
  const row = getDb().prepare("SELECT username FROM users WHERE email = ?").get(normalized)
  if (!row) {
    return { success: false, error: "该邮箱尚未注册", errorCode: "user_not_found" }
  }
  const issued = passwordReset.issueCode(normalized)
  if (!issued.ok) {
    return {
      success: false,
      error: issued.message,
      errorCode: issued.code,
      retryAfter: issued.retryAfter || 0,
    }
  }
  try {
    const result = await mailer.sendVerificationCode(normalized, issued.code, issued.expiresInMs)
    return {
      success: true,
      delivered: result.delivered,
      devMode: result.devMode,
      expiresInMs: issued.expiresInMs,
      resendCooldownMs: passwordReset.RESEND_COOLDOWN_MS,
    }
  } catch (err) {
    console.error("[auth] 发送验证码失败:", err.message)
    return {
      success: false,
      error: "验证码邮件发送失败，请稍后再试",
      errorCode: "mail_send_failed",
    }
  }
}

async function resetPasswordByEmail(email, code, newPassword) {
  if (!isValidEmail(email)) {
    return { success: false, error: "请输入有效的邮箱地址", errorCode: "invalid_email" }
  }
  if (!newPassword || newPassword.length < 6) {
    return { success: false, error: "新密码至少 6 位", errorCode: "password_short" }
  }
  const normalized = normalizeEmail(email)
  const row = getDb().prepare("SELECT username FROM users WHERE email = ?").get(normalized)
  if (!row) {
    return { success: false, error: "该邮箱尚未注册", errorCode: "user_not_found" }
  }
  const verified = passwordReset.verifyCode(normalized, code)
  if (!verified.ok) {
    return { success: false, error: verified.message, errorCode: verified.code }
  }
  const hashed = await bcrypt.hash(newPassword, 10)
  getDb().prepare(
    "UPDATE users SET password_hash = ?, salt = '' WHERE username = ?",
  ).run(hashed, row.username)
  passwordReset.consumeCode(normalized)
  getDb().prepare("DELETE FROM refresh_tokens WHERE username = ?").run(row.username)
  console.log(`[auth] password reset via email: ${normalized}`)
  return { success: true }
}

function register(router) {
  router.register("POST", "/auth/register/send-code", async ({ body }) => {
    return requestRegisterCode(body.email)
  })

  router.register("POST", "/auth/register", async ({ body }) => {
    return registerByEmail(body.email, body.password, body.code)
  })

  router.register("POST", "/auth/login", async ({ body }) => {
    if (body.captchaId && body.captchaId.trim()) {
      const ok = captcha.verify(body.captchaId, body.captcha)
      if (!ok) {
        return {
          success: false,
          needCaptcha: true,
          error: "验证码错误",
          errorCode: "invalid_captcha",
          token: "",
          username: "",
          email: "",
          refreshToken: "",
        }
      }
    }
    const result = await loginByEmail(body.email, body.password)
    return { ...result, needCaptcha: false }
  })

  router.register("POST", "/auth/oauth/:provider", async ({ params, body }) => {
    let user
    try {
      user = await oauth.exchange(params.provider, body.code, body.redirectUri)
    } catch (ex) {
      return errorResult("oauth_exchange_failed", ex.message)
    }
    return loginOrCreateOAuth(user.provider, user.oauthId, user.email)
  })

  router.register("POST", "/auth/oauth/github/device/start", async () => {
    try {
      return await oauth.startGithubDeviceFlow()
    } catch (ex) {
      return errorResult(ex.code || "github_device_start_failed", ex.userMessage || ex.message)
    }
  })

  router.register("POST", "/auth/oauth/github/device/poll", async ({ body }) => {
    let result
    try {
      result = await oauth.pollGithubDeviceFlow(body.deviceCode, body.interval)
    } catch (ex) {
      return errorResult(ex.code || "github_device_poll_failed", ex.userMessage || ex.message)
    }

    if (!result || result.status !== "authorized") return result
    return loginOrCreateOAuth(result.provider, result.oauthId, result.email)
  })

  router.register("GET", "/auth/oauth/urls", async () => oauth.authorizeUrls())

  router.register("POST", "/auth/refresh", async ({ body }) => {
    return refreshAccessToken(body.refreshToken)
  })

  router.register("POST", "/auth/verify", async ({ body }) => {
    const username = await verifyAccessToken(body.token)
    const valid = !!username
    return {
      valid,
      username: valid ? username : "",
      email: valid ? lookupEmail(username) : "",
    }
  })

  router.register("GET", "/auth/captcha", async () => captcha.generate())

  router.register("POST", "/auth/password/forgot", async ({ body }) => {
    return requestPasswordReset(body.email)
  })

  router.register("POST", "/auth/password/reset", async ({ body }) => {
    return resetPasswordByEmail(body.email, body.code, body.newPassword)
  })
}

module.exports = {
  register,
  registerByEmail,
  loginByEmail,
  loginOrCreateOAuth,
  refreshAccessToken,
  verifyAccessToken,
  lookupEmail,
  requestPasswordReset,
  resetPasswordByEmail,
  requestRegisterCode,
}
