const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const os = require("os")
const { SignJWT, jwtVerify } = require("jose")

const ACCESS_EXPIRE_MS = 30 * 60 * 1000
const REFRESH_EXPIRE_MS = 7 * 24 * 60 * 60 * 1000
const REFRESH_TYPE = "refresh"

let cachedSecret = null

function resolveJwtSecret() {
  if (cachedSecret) return cachedSecret
  const envSecret = process.env.CODEK_JWT_SECRET
  if (envSecret && envSecret.trim()) {
    cachedSecret = new TextEncoder().encode(envSecret.trim())
    return cachedSecret
  }
  const secretFile = path.join(os.homedir(), ".codek", "jwt-secret")
  try {
    if (fs.existsSync(secretFile)) {
      const fileSecret = fs.readFileSync(secretFile, "utf8").trim()
      if (fileSecret) {
        cachedSecret = new TextEncoder().encode(fileSecret)
        return cachedSecret
      }
    }
  } catch (e) {
    console.warn("[jwt] read secret failed:", e.message)
  }
  const newSecret = crypto.randomBytes(32).toString("base64")
  try {
    fs.mkdirSync(path.dirname(secretFile), { recursive: true })
    fs.writeFileSync(secretFile, newSecret, "utf8")
    console.log(`[jwt] generated new secret at ${secretFile}`)
  } catch (e) {
    console.warn("[jwt] persist secret failed:", e.message)
  }
  cachedSecret = new TextEncoder().encode(newSecret)
  return cachedSecret
}

async function signAccessToken(username) {
  const secret = resolveJwtSecret()
  return await new SignJWT({ sub: username })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + ACCESS_EXPIRE_MS) / 1000))
    .setSubject(username)
    .sign(secret)
}

async function signRefreshToken(username) {
  const secret = resolveJwtSecret()
  return await new SignJWT({ sub: username, type: REFRESH_TYPE })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + REFRESH_EXPIRE_MS) / 1000))
    .setSubject(username)
    .sign(secret)
}

async function verifyAccessToken(token) {
  const secret = resolveJwtSecret()
  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.type === REFRESH_TYPE) return null
    return payload.sub || null
  } catch {
    return null
  }
}

async function verifyRefreshTokenSignature(token) {
  const secret = resolveJwtSecret()
  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.type !== REFRESH_TYPE) return null
    return payload.sub || null
  } catch {
    return null
  }
}

module.exports = {
  ACCESS_EXPIRE_MS,
  REFRESH_EXPIRE_MS,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshTokenSignature,
}
