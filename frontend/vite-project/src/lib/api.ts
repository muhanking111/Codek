// Unified API client: routes through Electron IPC to main-process services.
// Strips the legacy "/api" prefix because services register paths without it.

function normalizePath(p: string): string {
  let path = p
  if (path.startsWith("http://") || path.startsWith("https://")) {
    try {
      const u = new URL(path)
      path = u.pathname + u.search
    } catch {
      // keep as-is
    }
  }
  if (path.startsWith("/api/")) path = path.slice(4)
  else if (path === "/api") path = "/"
  return path
}

interface ApiRequestOptions {
  startupTimeoutMs?: number
  signal?: AbortSignal
}

async function request<T = any>(method: string, rawPath: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
  const path = normalizePath(rawPath)
  const codek = window.codek
  if (codek && typeof codek.api === "function") {
    const result = await codek.api(method, path, body ?? null, undefined, options)
    if (result && typeof result === "object" && "ok" in result && "data" in result) {
      const r = result as { ok: boolean; data: T; error?: string; status?: number }
      if (!r.ok) {
        const err: any = new Error(r.error || `Request failed: ${method} ${path}`)
        err.status = r.status
        throw err
      }
      return r.data
    }
    return result as T
  }
  throw new Error("Codek API not available")
}

export const api = {
  get: <T = any>(path: string, options?: ApiRequestOptions) => request<T>("GET", path, undefined, options),
  post: <T = any>(path: string, body?: unknown, options?: ApiRequestOptions) => request<T>("POST", path, body, options),
  request,
}
