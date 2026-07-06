let undiciFetch
try {
  ;({ fetch: undiciFetch } = require("undici"))
} catch {
  undiciFetch = globalThis.fetch
}

let fetchImpl = undiciFetch

const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code"
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token"
const GITHUB_USER_URL = "https://api.github.com/user"
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails"
const GITHUB_SCOPE = "read:user user:email"
const GITHUB_DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"

const PROVIDERS = [
  { provider: "github", label: "GitHub" },
]

function urlEncode(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&")
}

function githubClientId() {
  return (process.env.GITHUB_OAUTH_CLIENT_ID || "").trim()
}

function isConfigured(provider) {
  if (provider !== "github") return false
  return !!githubClientId()
}

async function readJson(resp) {
  return resp.json().catch(() => ({}))
}

function makeError(code, message) {
  const err = new Error(code)
  err.code = code
  err.userMessage = message || code
  return err
}

function requireGithubClientId() {
  const clientId = githubClientId()
  if (!clientId) {
    throw makeError(
      "github_client_id_required",
      "GitHub 登录暂时不可用，请配置 GITHUB_OAUTH_CLIENT_ID 后重试。",
    )
  }
  return clientId
}

function githubHeaders(extra = {}) {
  return {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
    ...extra,
  }
}

function githubApiHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
}

async function startGithubDeviceFlow() {
  const clientId = requireGithubClientId()
  const resp = await fetchImpl(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: githubHeaders(),
    body: urlEncode({
      client_id: clientId,
      scope: GITHUB_SCOPE,
    }),
  })
  const json = await readJson(resp)
  if (json.error) {
    throw makeError("github_device_start_failed", json.error_description || json.error)
  }

  const deviceCode = String(json.device_code || "")
  const userCode = String(json.user_code || "")
  const verificationUri = String(json.verification_uri || "")
  const expiresIn = Number(json.expires_in) || 0
  const interval = Number(json.interval) || 5

  if (!deviceCode || !userCode || !verificationUri || !expiresIn) {
    throw makeError("github_device_start_failed", "GitHub 未返回完整的设备授权信息。")
  }

  return {
    provider: "github",
    deviceCode,
    userCode,
    verificationUri,
    expiresIn,
    interval,
  }
}

function mapGithubDeviceError(error) {
  if (error === "expired_token") {
    return makeError("github_device_code_expired", "验证码已过期，请重新发起 GitHub 登录。")
  }
  if (error === "access_denied") {
    return makeError("github_authorization_denied", "你已取消 GitHub 授权。")
  }
  if (error === "device_flow_disabled") {
    return makeError(
      "github_device_flow_disabled",
      "GitHub 登录暂时不可用，请在 OAuth App 设置中启用 Device Flow。",
    )
  }
  return makeError("github_device_poll_failed", error || "GitHub 授权验证失败。")
}

async function pollGithubDeviceFlow(deviceCode, currentInterval = 5) {
  const clientId = requireGithubClientId()
  if (!deviceCode) throw makeError("github_device_code_required", "缺少 GitHub 设备授权码。")

  const resp = await fetchImpl(GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: githubHeaders(),
    body: urlEncode({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: GITHUB_DEVICE_GRANT_TYPE,
    }),
  })
  const json = await readJson(resp)
  if (json.error === "authorization_pending") {
    return {
      status: "pending",
      interval: Math.max(Number(currentInterval) || 5, 1),
      error: "authorization_pending",
    }
  }
  if (json.error === "slow_down") {
    return {
      status: "pending",
      interval: Math.max(Number(currentInterval) || 5, 1) + 5,
      error: "slow_down",
    }
  }
  if (json.error) throw mapGithubDeviceError(String(json.error))

  const accessToken = String(json.access_token || "")
  if (!accessToken) throw makeError("github_token_failed", "GitHub 未返回访问令牌。")

  const identity = await fetchGithubIdentity(accessToken)
  return {
    status: "authorized",
    ...identity,
  }
}

async function fetchGithubIdentity(accessToken) {
  if (!accessToken) throw makeError("github_token_required", "缺少 GitHub 授权令牌。")

  const userResp = await fetchImpl(GITHUB_USER_URL, {
    headers: githubApiHeaders(accessToken),
  })
  const userJson = await readJson(userResp)
  const oauthId = userJson.id != null ? String(userJson.id) : ""
  if (!oauthId) throw makeError("github_user_failed", "无法获取 GitHub 用户身份。")

  const emailsResp = await fetchImpl(GITHUB_EMAILS_URL, {
    headers: githubApiHeaders(accessToken),
  })
  const emails = await readJson(emailsResp)
  const primary = Array.isArray(emails)
    ? emails.find((email) => email && email.primary && email.verified && email.email)
    : null
  if (!primary) {
    throw makeError(
      "github_verified_email_required",
      "GitHub 账号需要存在已验证的主邮箱才能登录。",
    )
  }

  return { provider: "github", oauthId, email: String(primary.email).toLowerCase() }
}

function authorizeUrls() {
  return PROVIDERS.map(({ provider, label }) => ({
    provider,
    label,
    configured: isConfigured(provider),
    authorizeUrl: "",
  }))
}

async function exchange() {
  throw makeError("unsupported_provider", "当前 OAuth 授权码登录方式已停用。")
}

function setFetchForTest(nextFetch) {
  fetchImpl = nextFetch || undiciFetch
}

module.exports = {
  exchange,
  authorizeUrls,
  startGithubDeviceFlow,
  pollGithubDeviceFlow,
  fetchGithubIdentity,
  setFetchForTest,
}
