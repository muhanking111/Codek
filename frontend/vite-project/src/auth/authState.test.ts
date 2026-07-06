import { beforeEach, describe, expect, it, vi } from "vitest"

const apiGet = vi.fn()
const apiPost = vi.fn()

vi.mock("../lib/api", () => ({
  api: {
    get: apiGet,
    post: apiPost,
  },
}))

async function freshAuth() {
  vi.resetModules()
  return import("./authState")
}

describe("auth init auto-login gating", () => {
  beforeEach(() => {
    localStorage.clear()
    apiGet.mockReset()
    apiGet.mockResolvedValue([{ provider: "github", label: "GitHub", configured: true, authorizeUrl: "" }])
    apiPost.mockReset()
  })

  it("keeps the login screen and clears stale token state when auto login is disabled", async () => {
    localStorage.setItem("codek.auth.token", "saved-token")
    localStorage.setItem("codek.auth.username", "saved-user")
    localStorage.setItem("codek.auth.rememberMe", "1")

    const { auth } = await freshAuth()
    await auth.init()

    expect(apiPost).not.toHaveBeenCalledWith("/api/auth/verify", expect.anything())
    expect(auth.isLoggedIn).toBe(false)
    expect(auth.token).toBe("")
    expect(auth.rememberMe).toBe(true)
    expect(localStorage.getItem("codek.auth.token")).toBeNull()
  })

  it("restores local auto-login state without touching backend services in lightweight init", async () => {
    localStorage.setItem("codek.auth.token", "saved-token")
    localStorage.setItem("codek.auth.username", "saved-user")
    localStorage.setItem("codek.auth.email", "saved@example.com")
    localStorage.setItem("codek.auth.rememberMe", "1")
    localStorage.setItem("codek.auth.autoLogin", "1")

    const { auth } = await freshAuth()
    await auth.init({ lightweight: true })

    expect(apiGet).not.toHaveBeenCalled()
    expect(apiPost).not.toHaveBeenCalled()
    expect(auth.isLoggedIn).toBe(true)
    expect(auth.token).toBe("saved-token")
    expect(auth.username).toBe("saved-user")
    expect(auth.email).toBe("saved@example.com")
  })

  it("verifies a saved token only when remember me and auto login are both enabled", async () => {
    localStorage.setItem("codek.auth.token", "saved-token")
    localStorage.setItem("codek.auth.username", "saved-user")
    localStorage.setItem("codek.auth.rememberMe", "1")
    localStorage.setItem("codek.auth.autoLogin", "1")
    apiPost.mockResolvedValueOnce({ valid: true, username: "saved-user", email: "saved@example.com" })

    const { auth } = await freshAuth()
    await auth.init()

    expect(apiPost).toHaveBeenCalledWith("/api/auth/verify", { token: "saved-token" })
    expect(auth.isLoggedIn).toBe(true)
    expect(auth.username).toBe("saved-user")
    expect(auth.email).toBe("saved@example.com")
  })

  it("does not clear a smoke token written while provider loading is still pending", async () => {
    let resolveProviders: (value: unknown) => void = () => {}
    apiGet.mockReturnValueOnce(new Promise((resolve) => {
      resolveProviders = resolve
    }))
    apiPost.mockResolvedValueOnce({ valid: true, username: "smoke-user", email: "smoke@example.com" })

    const { auth } = await freshAuth()
    const initPromise = auth.init()

    localStorage.setItem("codek.auth.token", "smoke-token")
    localStorage.setItem("codek.auth.username", "smoke-user")
    localStorage.setItem("codek.auth.email", "smoke@example.com")
    localStorage.setItem("codek.auth.rememberMe", "1")
    localStorage.setItem("codek.auth.autoLogin", "1")

    resolveProviders([{ provider: "github", label: "GitHub", configured: true, authorizeUrl: "" }])
    await initPromise

    expect(apiPost).toHaveBeenCalledWith("/api/auth/verify", { token: "smoke-token" })
    expect(auth.isLoggedIn).toBe(true)
    expect(auth.token).toBe("smoke-token")
    expect(localStorage.getItem("codek.auth.token")).toBe("smoke-token")
  })

  it("keeps the current lightweight session when background token verification is unavailable", async () => {
    localStorage.setItem("codek.auth.token", "saved-token")
    localStorage.setItem("codek.auth.username", "saved-user")
    localStorage.setItem("codek.auth.email", "saved@example.com")
    localStorage.setItem("codek.auth.rememberMe", "1")
    localStorage.setItem("codek.auth.autoLogin", "1")

    const { auth } = await freshAuth()
    await auth.init({ lightweight: true })

    apiPost.mockRejectedValueOnce(new Error("backend unavailable"))
    await auth.init({ background: true })

    expect(apiPost).toHaveBeenCalledWith("/api/auth/verify", { token: "saved-token" })
    expect(auth.isLoggedIn).toBe(true)
    expect(auth.token).toBe("saved-token")
    expect(auth.username).toBe("saved-user")
    expect(auth.email).toBe("saved@example.com")
    expect(localStorage.getItem("codek.auth.token")).toBe("saved-token")
  })

  it("keeps the current lightweight session when background token verification returns invalid", async () => {
    localStorage.setItem("codek.auth.token", "saved-token")
    localStorage.setItem("codek.auth.username", "saved-user")
    localStorage.setItem("codek.auth.email", "saved@example.com")
    localStorage.setItem("codek.auth.rememberMe", "1")
    localStorage.setItem("codek.auth.autoLogin", "1")

    const { auth } = await freshAuth()
    await auth.init({ lightweight: true })

    apiPost.mockResolvedValueOnce({ valid: false })
    await auth.init({ background: true })

    expect(apiPost).toHaveBeenCalledWith("/api/auth/verify", { token: "saved-token" })
    expect(auth.isLoggedIn).toBe(true)
    expect(auth.token).toBe("saved-token")
    expect(localStorage.getItem("codek.auth.token")).toBe("saved-token")
  })

  it("does not clear an active manual session during background init when auto login is disabled", async () => {
    const { auth } = await freshAuth()
    auth.applySuccess({ token: "manual-token", username: "manual-user", email: "manual@example.com" })

    await auth.init({ background: true })

    expect(apiPost).not.toHaveBeenCalledWith("/api/auth/verify", expect.anything())
    expect(auth.isLoggedIn).toBe(true)
    expect(auth.token).toBe("manual-token")
    expect(auth.username).toBe("manual-user")
    expect(localStorage.getItem("codek.auth.token")).toBe("manual-token")
  })
})
