const DEFAULT_MARKETPLACE_API = process.env.CODEK_EXTENSION_MARKETPLACE_API || "https://open-vsx.org/api"
const DEFAULT_TIMEOUT_MS = Number(process.env.CODEK_EXTENSION_MARKETPLACE_TIMEOUT_MS || 15000)
const {
  DEFAULT_EXTENSION_ICON_DATA_URL,
  buildExtensionIconPresentation,
} = require("./extensionPresentation")

const memoryCache = new Map()

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_MARKETPLACE_API).trim().replace(/\/+$/, "")
}

function parseMarketplaceSources(value = process.env.CODEK_EXTENSION_MARKETPLACE_SOURCES || "", fallback = DEFAULT_MARKETPLACE_API) {
  const raw = String(value || "").trim()
  if (!raw) {
    return [{ name: "open-vsx", baseUrl: normalizeBaseUrl(fallback), kind: "open-vsx" }]
  }

  return raw
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const eq = entry.indexOf("=")
      const hasName = eq > 0
      const name = hasName ? entry.slice(0, eq).trim() : sourceNameFromUrl(entry, index)
      const baseUrl = hasName ? entry.slice(eq + 1).trim() : entry
      return {
        name: sanitizeSourceName(name || `registry-${index + 1}`),
        baseUrl: normalizeBaseUrl(baseUrl),
        kind: "open-vsx",
      }
    })
}

function sourceNameFromUrl(value, index) {
  try {
    const host = new URL(value).hostname.split(".")[0] || "registry"
    return `${host}-${index + 1}`
  } catch {
    return `registry-${index + 1}`
  }
}

function sanitizeSourceName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "registry"
}

function buildMarketplaceSearchUrl(source, query = "", options = {}) {
  const params = new URLSearchParams()
  params.set("query", String(query || ""))
  params.set("size", String(Math.max(1, Number(options.size || options.pageSize || 20))))
  if (options.offset != null) params.set("offset", String(Math.max(0, Number(options.offset) || 0)))
  if (options.category) params.set("category", String(options.category))
  return `${normalizeBaseUrl(source?.baseUrl)}/-/search?${params.toString()}`
}

function buildMarketplaceDetailsUrl(source, namespace, name, version, options = {}) {
  const base = `${normalizeBaseUrl(source?.baseUrl)}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`
  if (options.targetPlatform && version) {
    return `${base}/${encodeURIComponent(options.targetPlatform)}/${encodeURIComponent(version)}`
  }
  return version ? `${base}/${encodeURIComponent(version)}` : base
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String)
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function normalizeOpenVsxExtension(raw = {}, source = {}) {
  const namespace = raw.namespace || raw.publisher || raw.publisherName || ""
  const name = raw.name || raw.extensionName || ""
  const properties = raw.properties || {}
  const id = raw.id || (namespace && name ? `${namespace}.${name}` : name || namespace)
  const files = raw.files || {}
  const iconPresentation = buildExtensionIconPresentation({
    id,
    iconUrl: files.icon || raw.iconUrl || "",
    iconCacheUrl: files.icon
      ? `/extensions-host/marketplace/icon/${encodeURIComponent(id)}?url=${encodeURIComponent(files.icon)}`
      : raw.iconCacheUrl || "",
    iconUrlFallback: raw.assets?.icon?.fallbackUri || raw.iconUrlFallback || "",
  })
  const dependencies = raw.extensionDependencies || raw.dependencies || properties.dependencies || properties.extensionDependencies
  const extensionPack = raw.extensionPack || properties.extensionPack
  const enabledApiProposals = raw.enabledApiProposals || properties.enabledApiProposals
  const engine = raw.engines?.vscode || raw.engine || properties.engine || properties.vscodeEngine
  const extensionKind = raw.extensionKind || properties.extensionKind
  const targetPlatform = raw.targetPlatform || properties.targetPlatform || ""
  return {
    id,
    name,
    publisher: namespace,
    namespace,
    version: raw.version || "",
    displayName: raw.displayName || name || id,
    description: raw.description || raw.shortDescription || "",
    categories: Array.isArray(raw.categories) ? raw.categories : [],
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    installCount: Number(raw.downloadCount || raw.installCount || raw.downloads || 0),
    downloadCount: Number(raw.downloadCount || raw.installCount || raw.downloads || 0),
    averageRating: Number(raw.averageRating || raw.rating || 0),
    reviewCount: Number(raw.reviewCount || 0),
    repository: raw.repository || raw.namespaceUrl || properties.repository || "",
    license: raw.license || properties.license || "",
    verified: raw.verified === true,
    preview: raw.preview || raw.preRelease || properties.isPreReleaseVersion || false,
    deprecated: raw.deprecated === true,
    downloadUrl: files.download || raw.downloadUrl || "",
    iconUrl: iconPresentation.iconUrl,
    iconCacheUrl: iconPresentation.iconCacheUrl,
    iconUrlFallback: iconPresentation.iconUrlFallback,
    iconSource: iconPresentation.iconSource,
    iconDataUrl: DEFAULT_EXTENSION_ICON_DATA_URL,
    defaultIcon: true,
    readmeUrl: files.readme || raw.readmeUrl || "",
    manifestUrl: files.manifest || raw.manifestUrl || "",
    signatureUrl: files.signature || raw.signatureUrl || "",
    sha256Url: files.sha256 || raw.sha256Url || "",
    allVersions: raw.allVersions || [],
    targetPlatform,
    extensionDependencies: toArray(dependencies),
    extensionPack: toArray(extensionPack),
    enabledApiProposals: toArray(enabledApiProposals),
    engines: raw.engines || (engine ? { vscode: engine } : {}),
    extensionKind: toArray(extensionKind),
    source: source.name || "open-vsx",
    sourceBaseUrl: source.baseUrl || DEFAULT_MARKETPLACE_API,
    sourceUrl: raw.url || (namespace && name ? buildMarketplaceDetailsUrl(source, namespace, name) : ""),
    raw,
  }
}

function extensionKey(item) {
  return String(item.id || `${item.publisher || item.namespace || ""}.${item.name || ""}`).toLowerCase()
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options)
  return text ? JSON.parse(text) : null
}

async function fetchText(url, options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const response = await fetchImpl(url, controller ? { signal: controller.signal } : {})
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`)
      error.status = response.status
      throw error
    }
    if (typeof response.text === "function") return await response.text()
    if (typeof response.json === "function") return JSON.stringify(await response.json())
    return ""
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function cacheGet(key, ttlMs) {
  const hit = memoryCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > ttlMs) {
    memoryCache.delete(key)
    return null
  }
  return hit.value
}

function cacheSet(key, value) {
  memoryCache.set(key, { at: Date.now(), value })
  return value
}

async function searchMarketplaceRegistry(query, options = {}) {
  const sources = options.sources || parseMarketplaceSources()
  const size = Number(options.size || options.pageSize || 20)
  const cacheKey = `search:${sources.map((s) => `${s.name}:${s.baseUrl}`).join("|")}:${query}:${size}:${options.category || ""}:${options.offset || 0}`
  const cached = options.cacheTtlMs ? cacheGet(cacheKey, Number(options.cacheTtlMs)) : null
  if (cached) return cached

  const extensions = []
  const errors = []
  const sourceReports = []

  for (const source of sources) {
    const url = buildMarketplaceSearchUrl(source, query, {
      size,
      category: options.category,
      offset: options.offset,
    })
    try {
      const response = await (options.fetchImpl || fetch)(url, {})
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      const list = Array.isArray(data.extensions)
        ? data.extensions
        : Array.isArray(data.results)
          ? data.results
          : []
      const normalized = list.map((item) => normalizeOpenVsxExtension(item, source))
      extensions.push(...normalized)
      sourceReports.push({ name: source.name, baseUrl: source.baseUrl, count: normalized.length, ok: true })
    } catch (error) {
      errors.push({ source: source.name, baseUrl: source.baseUrl, error: error.message })
      sourceReports.push({ name: source.name, baseUrl: source.baseUrl, count: 0, ok: false, error: error.message })
    }
  }

  const deduped = []
  const seen = new Set()
  for (const extension of extensions) {
    const key = extensionKey(extension)
    if (!key || seen.has(key)) continue
    seen.add(key)
    deduped.push(extension)
  }
  deduped.sort((a, b) => Number(b.downloadCount || 0) - Number(a.downloadCount || 0))
  return cacheSet(cacheKey, { extensions: deduped, sources: sourceReports, errors })
}

async function getMarketplaceDetails(namespace, name, options = {}) {
  const source = options.source || parseMarketplaceSources()[0]
  const cacheKey = `details:${source.baseUrl}:${namespace}.${name}:${options.targetPlatform || ""}:${options.version || ""}`
  const cached = options.cacheTtlMs ? cacheGet(cacheKey, Number(options.cacheTtlMs)) : null
  if (cached) return cached

  const url = buildMarketplaceDetailsUrl(source, namespace, name, options.version, {
    targetPlatform: options.targetPlatform,
  })
  const data = await fetchJson(url, options)
  return cacheSet(cacheKey, normalizeOpenVsxExtension(data || {}, source))
}

function normalizeVersions(details) {
  const allVersions = details?.raw?.allVersions || details?.allVersions || []
  if (Array.isArray(allVersions)) {
    return allVersions.map((item) => typeof item === "string"
      ? { version: item }
      : {
          version: item.version || item.name || "",
          date: item.date || item.timestamp || item.lastUpdated || "",
          targetPlatforms: item.targetPlatforms || item.targetPlatform ? [item.targetPlatform].filter(Boolean) : [],
          url: item.url || "",
        }).filter((item) => item.version)
  }
  if (allVersions && typeof allVersions === "object") {
    return Object.keys(allVersions).map((version) => ({ version, url: allVersions[version] }))
  }
  return details?.version ? [{ version: details.version, url: details.sourceUrl || "" }] : []
}

async function getMarketplaceVersions(namespace, name, options = {}) {
  const details = await getMarketplaceDetails(namespace, name, options)
  return {
    id: `${namespace}.${name}`,
    source: details.source,
    versions: normalizeVersions(details),
  }
}

async function getMarketplaceReadme(namespace, name, options = {}) {
  const details = await getMarketplaceDetails(namespace, name, options)
  const readmeUrl = details.readmeUrl
  if (!readmeUrl) {
    return { id: `${namespace}.${name}`, source: details.source, readme: "", available: false, readmeUrl: "" }
  }
  try {
    const readme = await fetchText(readmeUrl, options)
    return { id: `${namespace}.${name}`, source: details.source, readme, available: Boolean(readme), readmeUrl }
  } catch (error) {
    return {
      id: `${namespace}.${name}`,
      source: details.source,
      readme: "",
      available: false,
      readmeUrl,
      error: error.message,
    }
  }
}

module.exports = {
  DEFAULT_MARKETPLACE_API,
  buildMarketplaceDetailsUrl,
  buildMarketplaceSearchUrl,
  getMarketplaceDetails,
  getMarketplaceReadme,
  getMarketplaceVersions,
  normalizeOpenVsxExtension,
  parseMarketplaceSources,
  searchMarketplaceRegistry,
}
