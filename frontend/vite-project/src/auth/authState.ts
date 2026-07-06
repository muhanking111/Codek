import { reactive } from "vue"
import { api } from "../lib/api"

const TOKEN_KEY = "codek.auth.token"
const USER_KEY = "codek.auth.username"
const EMAIL_KEY = "codek.auth.email"
const REMEMBER_KEY = "codek.auth.rememberMe"
const AUTOLOGIN_KEY = "codek.auth.autoLogin"
const SAVED_EMAIL_KEY = "codek.auth.savedEmail"
const SAVED_PASSWORD_KEY = "codek.auth.savedPassword"
const SAVED_PASSWORD_ENC_KEY = "codek.auth.savedPasswordEnc"

interface SecureStoreApi {
  available: () => Promise<boolean>
  encrypt: (plaintext: string) => Promise<string>
  decrypt: (ciphertext: string) => Promise<string>
}

export type LoginErrorCode =
  | ""
  | "user_not_found"
  | "wrong_password"
  | "network"
  | "captcha_required"
  | "cancelled"
  | "expired"
  | "unknown"

export type OAuthProvider = "github"
export type OAuthStatus = "idle" | "pending" | "exchanging" | "success" | "cancelled" | "expired" | "error"

export interface OAuthProviderConfig {
  provider: OAuthProvider
  label: string
  configured: boolean
  authorizeUrl: string
}

interface AuthResponse {
  success?: boolean
  valid?: boolean
  status?: "pending" | "authorized"
  token?: string
  username?: string
  email?: string
  error?: string
  errorCode?: string
  needCaptcha?: boolean
  delivered?: boolean
  devMode?: boolean
  expiresInMs?: number
  resendCooldownMs?: number
  retryAfter?: number
  provider?: OAuthProvider
  deviceCode?: string
  userCode?: string
  verificationUri?: string
  expiresIn?: number
  interval?: number
}

type OAuthLoginResult = AuthResponse

interface AuthInitOptions {
  lightweight?: boolean
  background?: boolean
}

export interface GitHubDeviceFlowState {
  active: boolean
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresAt: number
  expiresIn: number
  remainingSeconds: number
  interval: number
  statusText: string
  copyState: "idle" | "copied" | "failed"
}

interface CodekWindowApi {
  secureStore?: SecureStoreApi
  openExternal?: (url: string) => Promise<void | boolean>
  oauthLogin?: (provider: OAuthProvider) => Promise<OAuthLoginResult>
}

const defaultOAuthProviders: OAuthProviderConfig[] = [
  { provider: "github", label: "GitHub", configured: true, authorizeUrl: "" },
]

function defaultDeviceFlow(): GitHubDeviceFlowState {
  return {
    active: false,
    deviceCode: "",
    userCode: "",
    verificationUri: "",
    expiresAt: 0,
    expiresIn: 0,
    remainingSeconds: 0,
    interval: 5,
    statusText: "",
    copyState: "idle",
  }
}

function getCodek(): CodekWindowApi | null {
  return typeof window !== "undefined"
    ? ((window as unknown as { codek?: CodekWindowApi }).codek || null)
    : null
}

function getSecureStore(): SecureStoreApi | null {
  return getCodek()?.secureStore || null
}

function encodeSecret(value: string): string {
  try {
    return btoa(unescape(encodeURIComponent(value)))
  } catch {
    return ""
  }
}

function decodeSecret(value: string): string {
  try {
    return decodeURIComponent(escape(atob(value)))
  } catch {
    return ""
  }
}

async function encryptPassword(plaintext: string): Promise<{ value: string; encrypted: boolean }> {
  const store = getSecureStore()
  if (store) {
    try {
      if (await store.available()) {
        const enc = await store.encrypt(plaintext)
        if (enc) return { value: enc, encrypted: true }
      }
    } catch {
      // Fall back to legacy base64 only outside packaged Electron.
    }
  }
  return { value: encodeSecret(plaintext), encrypted: false }
}

async function decryptPassword(value: string, encrypted: boolean): Promise<string> {
  if (encrypted) {
    const store = getSecureStore()
    if (!store) return ""
    try {
      return await store.decrypt(value)
    } catch {
      return ""
    }
  }
  return value ? decodeSecret(value) : ""
}

async function apiPost<T = AuthResponse>(path: string, body: Record<string, unknown>): Promise<T> {
  return api.post<T>(path, body)
}

async function apiGet(path: string): Promise<AuthResponse & { captchaId?: string; image?: string }> {
  return api.get(path)
}

function oauthErrorMessage(error?: string): string {
  if (error === "cancelled") return "已取消 GitHub 授权"
  if (error === "github_client_id_required") return "GitHub 登录暂时无法发起，请先使用邮箱登录或稍后重试"
  if (error === "github_device_flow_disabled") return "GitHub 登录暂时不可用，请先使用邮箱登录"
  if (error === "github_device_code_expired") return "GitHub 验证码已过期，请重新登录"
  if (error === "github_authorization_denied") return "你已取消 GitHub 授权"
  if (error === "github_verified_email_required") return "GitHub 账号需要存在已验证的主邮箱才能登录"
  if (error === "github_token_failed") return "GitHub 授权未完成，请重新登录"
  if (error === "github_user_failed") return "无法读取 GitHub 账号信息，请稍后重试"
  if (error === "github_device_start_failed") return "无法发起 GitHub 设备授权，请稍后重试"
  if (error === "github_device_poll_failed") return "GitHub 授权验证失败，请重新登录"
  if (error === "backend_unreachable") return "暂时无法连接登录服务，请稍后重试"
  if (error === "unsupported_provider") return "当前登录方式暂不可用"
  return error || "登录失败"
}

function toLoginErrorCode(error?: string): LoginErrorCode {
  if (error === "cancelled" || error === "github_authorization_denied") return "cancelled"
  if (error === "github_device_code_expired") return "expired"
  if (error === "network" || error === "backend_unreachable") return "network"
  return "unknown"
}

let githubFlowId = 0
let githubPollTimer: number | null = null
let githubCountdownTimer: number | null = null

function clearGithubTimers() {
  if (githubPollTimer != null) window.clearTimeout(githubPollTimer)
  if (githubCountdownTimer != null) window.clearInterval(githubCountdownTimer)
  githubPollTimer = null
  githubCountdownTimer = null
}

export const auth = reactive({
  isLoggedIn: false,
  token: "",
  username: "",
  email: "",
  showRegister: false,
  needCaptcha: false,
  captchaId: "",
  captchaImage: "",
  loginError: "",
  loginErrorCode: "" as LoginErrorCode,
  loading: false,
  oauthStatus: "idle" as OAuthStatus,
  oauthProvider: "" as OAuthProvider | "",
  oauthProviders: [...defaultOAuthProviders] as OAuthProviderConfig[],
  githubDeviceFlow: defaultDeviceFlow(),
  rememberMe: localStorage.getItem(REMEMBER_KEY) === "1",
  autoLogin: localStorage.getItem(AUTOLOGIN_KEY) === "1",

  async getSavedCredentials(): Promise<{ email: string; password: string }> {
    const email = localStorage.getItem(SAVED_EMAIL_KEY) || ""
    const encValue = localStorage.getItem(SAVED_PASSWORD_ENC_KEY) || ""
    const legacyValue = localStorage.getItem(SAVED_PASSWORD_KEY) || ""
    if (encValue) return { email, password: await decryptPassword(encValue, true) }
    if (legacyValue) return { email, password: await decryptPassword(legacyValue, false) }
    return { email, password: "" }
  },

  setRememberMe(value: boolean) {
    this.rememberMe = value
    if (value) {
      localStorage.setItem(REMEMBER_KEY, "1")
      return
    }
    localStorage.removeItem(REMEMBER_KEY)
    localStorage.removeItem(SAVED_EMAIL_KEY)
    localStorage.removeItem(SAVED_PASSWORD_KEY)
    localStorage.removeItem(SAVED_PASSWORD_ENC_KEY)
    this.autoLogin = false
    localStorage.removeItem(AUTOLOGIN_KEY)
  },

  setAutoLogin(value: boolean) {
    this.autoLogin = value
    if (value) localStorage.setItem(AUTOLOGIN_KEY, "1")
    else localStorage.removeItem(AUTOLOGIN_KEY)
  },

  async saveCredentials(email: string, password: string) {
    localStorage.setItem(SAVED_EMAIL_KEY, email)
    const { value, encrypted } = await encryptPassword(password)
    if (encrypted) {
      localStorage.setItem(SAVED_PASSWORD_ENC_KEY, value)
      localStorage.removeItem(SAVED_PASSWORD_KEY)
    } else {
      localStorage.setItem(SAVED_PASSWORD_KEY, value)
      localStorage.removeItem(SAVED_PASSWORD_ENC_KEY)
    }
  },

  async init(options: AuthInitOptions = {}) {
    if (!options.lightweight) await this.loadOAuthProviders()
    const savedToken = localStorage.getItem(TOKEN_KEY)
    const savedUser = localStorage.getItem(USER_KEY)
    this.rememberMe = localStorage.getItem(REMEMBER_KEY) === "1"
    this.autoLogin = localStorage.getItem(AUTOLOGIN_KEY) === "1"
    const autoLoginEnabled = this.autoLogin && this.rememberMe
    const keepBackgroundSession = () => options.background && this.isLoggedIn && Boolean(this.token)
    if (options.lightweight) {
      if (savedToken && autoLoginEnabled) {
        this.isLoggedIn = true
        this.token = savedToken
        this.username = savedUser || ""
        this.email = localStorage.getItem(EMAIL_KEY) || ""
        return
      }
      if (!autoLoginEnabled) {
        this.token = ""
        this.username = ""
        this.email = ""
        this.isLoggedIn = false
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(USER_KEY)
        localStorage.removeItem(EMAIL_KEY)
      }
      return
    }
    if (savedToken && autoLoginEnabled) {
      try {
        const res = await apiPost("/api/auth/verify", { token: savedToken })
        if (res.valid) {
          if (options.background && (!this.isLoggedIn || this.token !== savedToken || localStorage.getItem(TOKEN_KEY) !== savedToken)) {
            return
          }
          this.isLoggedIn = true
          this.token = savedToken
          this.username = savedUser || res.username || ""
          this.email = res.email || localStorage.getItem(EMAIL_KEY) || ""
          return
        }
        if (keepBackgroundSession()) return
        this.clear()
      } catch {
        if (keepBackgroundSession()) return
        this.loginError = "无法连接服务端，请确认后端已启动"
        this.clear()
        return
      }
    }

    if (!autoLoginEnabled) {
      if (keepBackgroundSession()) return
      this.token = ""
      this.username = ""
      this.email = ""
      this.isLoggedIn = false
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
      localStorage.removeItem(EMAIL_KEY)
    }

    if (autoLoginEnabled) {
      const saved = await this.getSavedCredentials()
      if (saved.email && saved.password) await this.loginWithEmail(saved.email, saved.password)
    }
  },

  async loadOAuthProviders(): Promise<OAuthProviderConfig[]> {
    try {
      const providers = await api.get<OAuthProviderConfig[]>("/api/auth/oauth/urls")
      this.oauthProviders = Array.isArray(providers) && providers.length
        ? providers.map((provider) => ({
          ...provider,
          configured: provider.provider === "github" ? true : provider.configured,
          authorizeUrl: "",
        }))
        : [...defaultOAuthProviders]
    } catch {
      this.oauthProviders = [...defaultOAuthProviders]
    }
    return this.oauthProviders
  },

  async refreshCaptcha() {
    try {
      const res = await apiGet("/api/auth/captcha")
      this.captchaId = res.captchaId || ""
      this.captchaImage = res.image || ""
    } catch {
      this.captchaImage = ""
    }
  },

  resetError() {
    this.loginError = ""
    this.loginErrorCode = ""
  },

  resetOAuthFlow() {
    githubFlowId += 1
    clearGithubTimers()
    this.githubDeviceFlow = defaultDeviceFlow()
    this.oauthStatus = "idle"
    this.oauthProvider = ""
  },

  applySuccess(res: AuthResponse) {
    this.isLoggedIn = true
    this.token = res.token || ""
    this.username = res.username || ""
    this.email = res.email || ""
    this.needCaptcha = false
    this.loginError = ""
    this.loginErrorCode = ""
    this.loading = false
    this.oauthStatus = "success"
    clearGithubTimers()
    this.githubDeviceFlow = defaultDeviceFlow()
    if (res.token) localStorage.setItem(TOKEN_KEY, res.token)
    if (res.username) localStorage.setItem(USER_KEY, res.username)
    if (res.email) localStorage.setItem(EMAIL_KEY, res.email)
  },

  async loginWithEmail(email: string, password: string, captcha?: string): Promise<boolean> {
    this.loading = true
    this.resetOAuthFlow()
    this.resetError()

    const body: Record<string, unknown> = { email, password }
    if (this.needCaptcha && this.captchaId) {
      body.captchaId = this.captchaId
      body.captcha = captcha || ""
    }

    try {
      const res = await apiPost("/api/auth/login", body)
      this.loading = false
      if (res.success) {
        this.applySuccess(res)
        if (this.rememberMe) await this.saveCredentials(email, password)
        return true
      }
      if (res.needCaptcha) {
        this.needCaptcha = true
        await this.refreshCaptcha()
      }
      this.loginError = res.error || "登录失败"
      this.loginErrorCode = (res.errorCode as LoginErrorCode) || "unknown"
      return false
    } catch {
      this.loading = false
      this.loginError = "无法连接服务端，请检查后端是否启动"
      this.loginErrorCode = "network"
      return false
    }
  },

  async requestRegisterCode(email: string): Promise<AuthResponse> {
    this.resetError()
    try {
      const res = await apiPost("/api/auth/register/send-code", { email })
      if (!res.success) {
        this.loginError = res.error || "验证码发送失败"
        this.loginErrorCode = (res.errorCode as LoginErrorCode) || "unknown"
      }
      return res
    } catch {
      const res = { success: false, error: "无法连接服务端", errorCode: "network" }
      this.loginError = res.error
      this.loginErrorCode = "network"
      return res
    }
  },

  async registerWithEmail(email: string, password: string, code: string): Promise<boolean> {
    this.loading = true
    this.resetError()
    try {
      const res = await apiPost("/api/auth/register", { email, password, code })
      this.loading = false
      if (res.success) {
        this.applySuccess(res)
        return true
      }
      this.loginError = res.error || "注册失败"
      this.loginErrorCode = (res.errorCode as LoginErrorCode) || "unknown"
      return false
    } catch {
      this.loading = false
      this.loginError = "无法连接服务端"
      this.loginErrorCode = "network"
      return false
    }
  },

  async loginWithOAuth(provider: OAuthProvider): Promise<boolean> {
    if (provider !== "github" || this.loading || this.githubDeviceFlow.active) return false

    this.loading = true
    this.oauthStatus = "pending"
    this.oauthProvider = provider
    this.resetError()
    const flowId = githubFlowId + 1
    githubFlowId = flowId
    clearGithubTimers()

    try {
      const started = await apiPost<AuthResponse>("/api/auth/oauth/github/device/start", {})
      if (!started.success && started.errorCode) {
        this.loading = false
        this.oauthStatus = "error"
        this.loginError = oauthErrorMessage(started.errorCode)
        this.loginErrorCode = toLoginErrorCode(started.errorCode)
        return false
      }

      const deviceCode = started.deviceCode || ""
      const userCode = started.userCode || ""
      const verificationUri = started.verificationUri || ""
      const expiresIn = Math.max(Number(started.expiresIn) || 0, 0)
      const interval = Math.max(Number(started.interval) || 5, 1)
      if (!deviceCode || !userCode || !verificationUri || !expiresIn) {
        this.loading = false
        this.oauthStatus = "error"
        this.loginError = "GitHub 未返回完整的设备授权信息，请稍后重试"
        this.loginErrorCode = "unknown"
        return false
      }

      this.githubDeviceFlow = {
        active: true,
        deviceCode,
        userCode,
        verificationUri,
        expiresAt: Date.now() + expiresIn * 1000,
        expiresIn,
        remainingSeconds: expiresIn,
        interval,
        statusText: "已打开 GitHub 授权页，等待你完成授权",
        copyState: "idle",
      }

      await this.openGithubDevicePage()
      this.startGithubCountdown(flowId)
      this.scheduleGithubPoll(flowId, interval)
      return false
    } catch {
      this.loading = false
      this.oauthStatus = "error"
      this.loginError = "无法连接 GitHub 登录服务，请稍后重试"
      this.loginErrorCode = "network"
      return false
    }
  },

  startGithubCountdown(flowId: number) {
    if (githubCountdownTimer != null) window.clearInterval(githubCountdownTimer)
    githubCountdownTimer = window.setInterval(() => {
      if (flowId !== githubFlowId || !this.githubDeviceFlow.active) return
      const remaining = Math.max(Math.ceil((this.githubDeviceFlow.expiresAt - Date.now()) / 1000), 0)
      this.githubDeviceFlow.remainingSeconds = remaining
      if (remaining <= 0) {
        clearGithubTimers()
        this.loading = false
        this.oauthStatus = "expired"
        this.githubDeviceFlow.active = false
        this.githubDeviceFlow.statusText = "GitHub 验证码已过期，请重新发起登录"
        this.loginError = oauthErrorMessage("github_device_code_expired")
        this.loginErrorCode = "expired"
      }
    }, 1000)
  },

  scheduleGithubPoll(flowId: number, intervalSeconds: number) {
    if (githubPollTimer != null) window.clearTimeout(githubPollTimer)
    githubPollTimer = window.setTimeout(
      () => {
        void this.pollGithubDeviceFlow(flowId)
      },
      Math.max(intervalSeconds, 1) * 1000,
    )
  },

  async pollGithubDeviceFlow(flowId: number) {
    if (flowId !== githubFlowId || !this.githubDeviceFlow.active) return
    if (this.githubDeviceFlow.remainingSeconds <= 0) return

    try {
      const res = await apiPost<AuthResponse>("/api/auth/oauth/github/device/poll", {
        deviceCode: this.githubDeviceFlow.deviceCode,
        interval: this.githubDeviceFlow.interval,
      })

      if (flowId !== githubFlowId) return

      if (res.success && res.token) {
        this.oauthStatus = "exchanging"
        this.githubDeviceFlow.statusText = "授权成功，正在进入 Codek"
        this.applySuccess(res)
        return
      }

      if (res.status === "pending") {
        const nextInterval = Math.max(Number(res.interval) || this.githubDeviceFlow.interval || 5, 1)
        this.githubDeviceFlow.interval = nextInterval
        this.githubDeviceFlow.statusText = res.error === "slow_down"
          ? "GitHub 要求放慢检查频率，正在继续等待授权"
          : "等待你在 GitHub 页面确认授权"
        this.scheduleGithubPoll(flowId, nextInterval)
        return
      }

      const code = res.errorCode || "github_device_poll_failed"
      clearGithubTimers()
      this.loading = false
      this.oauthStatus = code === "github_device_code_expired" ? "expired" : code === "github_authorization_denied" ? "cancelled" : "error"
      this.githubDeviceFlow.active = false
      this.githubDeviceFlow.statusText = oauthErrorMessage(code)
      this.loginError = res.error || oauthErrorMessage(code)
      this.loginErrorCode = toLoginErrorCode(code)
    } catch {
      if (flowId !== githubFlowId) return
      clearGithubTimers()
      this.loading = false
      this.oauthStatus = "error"
      this.githubDeviceFlow.active = false
      this.githubDeviceFlow.statusText = "无法连接 GitHub，请检查网络后重试"
      this.loginError = "无法连接 GitHub，请检查网络后重试"
      this.loginErrorCode = "network"
    }
  },

  async openGithubDevicePage(): Promise<boolean> {
    const url = this.githubDeviceFlow.verificationUri
    if (!url) return false
    const codek = getCodek()
    try {
      if (codek?.openExternal) {
        await codek.openExternal(url)
        return true
      }
      window.open(url, "_blank", "noopener,noreferrer")
      return true
    } catch {
      return false
    }
  },

  async copyGithubUserCode(): Promise<boolean> {
    const code = this.githubDeviceFlow.userCode
    if (!code) return false
    try {
      await navigator.clipboard.writeText(code)
      this.githubDeviceFlow.copyState = "copied"
      window.setTimeout(() => {
        if (this.githubDeviceFlow.userCode === code) this.githubDeviceFlow.copyState = "idle"
      }, 1800)
      return true
    } catch {
      this.githubDeviceFlow.copyState = "failed"
      return false
    }
  },

  cancelGithubDeviceFlow() {
    githubFlowId += 1
    clearGithubTimers()
    this.loading = false
    this.oauthStatus = "cancelled"
    this.githubDeviceFlow.active = false
    this.githubDeviceFlow.statusText = "已取消 GitHub 授权"
    this.loginError = oauthErrorMessage("cancelled")
    this.loginErrorCode = "cancelled"
  },

  async requestPasswordReset(email: string): Promise<{ success: boolean; error?: string; errorCode?: string; expiresInMs?: number; resendCooldownMs?: number; devMode?: boolean }> {
    this.resetError()
    try {
      const res = await apiPost("/api/auth/password/forgot", { email })
      if (res.success) {
        return {
          success: true,
          expiresInMs: res.expiresInMs,
          resendCooldownMs: res.resendCooldownMs,
          devMode: res.devMode,
        }
      }
      return { success: false, error: res.error || "获取验证码失败", errorCode: res.errorCode || "unknown" }
    } catch {
      return { success: false, error: "无法连接服务端", errorCode: "network" }
    }
  },

  async resetPasswordWithCode(email: string, code: string, newPassword: string): Promise<{ success: boolean; error?: string; errorCode?: string }> {
    this.resetError()
    try {
      const res = await apiPost("/api/auth/password/reset", { email, code, newPassword })
      if (res.success) return { success: true }
      return { success: false, error: res.error || "重置失败", errorCode: res.errorCode || "unknown" }
    } catch {
      return { success: false, error: "无法连接服务端", errorCode: "network" }
    }
  },

  logout() {
    this.isLoggedIn = false
    this.token = ""
    this.username = ""
    this.email = ""
    this.needCaptcha = false
    this.captchaId = ""
    this.captchaImage = ""
    this.loginError = ""
    this.loginErrorCode = ""
    this.showRegister = false
    this.resetOAuthFlow()
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(EMAIL_KEY)
    this.autoLogin = false
    localStorage.removeItem(AUTOLOGIN_KEY)
  },

  clear() {
    this.token = ""
    this.username = ""
    this.email = ""
    this.isLoggedIn = false
    this.needCaptcha = false
    this.resetOAuthFlow()
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(EMAIL_KEY)
  },
})
