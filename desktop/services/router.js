const routes = []

function register(method, pathPattern, handler) {
  const segments = pathPattern.split("/").filter(Boolean)
  const paramNames = []
  const regex = new RegExp(
    "^/" + segments.map((s) => {
      if (s.startsWith(":")) {
        paramNames.push(s.slice(1))
        return "([^/]+)"
      }
      return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    }).join("/") + "$",
  )
  routes.push({ method: method.toUpperCase(), regex, paramNames, handler, pathPattern })
}

function clearRoutes() {
  routes.length = 0
}

async function dispatch({ method, path, body, headers, sender }) {
  const m = (method || "GET").toUpperCase()
  const { pathname, query } = parseRequestPath(path || "/")
  for (const route of routes) {
    if (route.method !== m) continue
    const match = route.regex.exec(pathname)
    if (!match) continue
    const params = {}
    route.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(match[i + 1]) })
    try {
      const result = await route.handler({ params, query, body: body || {}, headers: headers || {}, sender })
      return { ok: true, status: 200, data: result }
    } catch (err) {
      const status = err.statusCode || err.status || 500
      console.error(`[api] ${m} ${path} → ${status}:`, err.message)
      return { ok: false, status, error: err.message, errorCode: err.code || "internal" }
    }
  }
  return { ok: false, status: 404, error: `No route: ${m} ${path}`, errorCode: "not_found" }
}

function parseRequestPath(rawPath) {
  const input = String(rawPath || "/")
  const base = "codek://local"
  try {
    const url = new URL(input, base)
    const query = {}
    for (const [key, value] of url.searchParams.entries()) {
      if (Object.prototype.hasOwnProperty.call(query, key)) {
        query[key] = Array.isArray(query[key]) ? [...query[key], value] : [query[key], value]
      } else {
        query[key] = value
      }
    }
    return { pathname: url.pathname || "/", query }
  } catch {
    const [pathname, queryString = ""] = input.split("?")
    const query = {}
    for (const pair of queryString.split("&")) {
      if (!pair) continue
      const [key, value = ""] = pair.split("=")
      query[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, " "))
    }
    return { pathname: pathname || "/", query }
  }
}

function listRoutes() {
  return routes.map((r) => `${r.method} ${r.pathPattern}`)
}

class HttpError extends Error {
  constructor(status, message, code) {
    super(message)
    this.statusCode = status
    this.code = code || "error"
  }
}

module.exports = { register, dispatch, clearRoutes, listRoutes, HttpError }
