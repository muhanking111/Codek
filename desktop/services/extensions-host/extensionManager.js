/**
 * Extension Manager — handles extension discovery, marketplace search, and .vsix install.
 *
 * Features:
 *   - Scan local extensions directory (uses extensionScanner.js)
 *   - Search open-vsx.org for remote extensions
 *   - Install .vsix files
 *   - Enable/disable extensions
 */

const path = require("path")
const fs = require("fs")
const fsp = require("fs/promises")
const { getExtensionId, scanExtensions } = require("./extensionScanner")
const { fileUriPathToFsPath } = require("./uriComponents")
const {
  buildExtensionEcosystemHealth,
  rankMarketplaceResults,
  readLatestExtensionEcosystemHealth,
  saveExtensionEcosystemHealth,
} = require("./ecosystemHealth")
const {
  DEFAULT_MARKETPLACE_API,
  getMarketplaceDetails,
  getMarketplaceReadme,
  getMarketplaceVersions,
  parseMarketplaceSources,
  searchMarketplaceRegistry,
} = require("./marketplaceRegistry")
const { buildInstallPlan } = require("./extensionInstallPlan")
const {
  buildExtensionsCompatibilityReport,
  evaluateExtensionCompatibility,
  readLatestExtensionCompatibilityReport,
  saveExtensionCompatibilityReport,
} = require("./extensionCompatibility")
const {
  buildExtensionDetailsPayload,
  splitExtensionId,
} = require("./extensionDetails")
const {
  appendExtensionAudit,
  readExtensionAuditLog,
} = require("./extensionAuditLog")
const {
  backupExtensionDirectory,
  getExtensionInstallRecord,
  listExtensionInstallStates,
  restoreExtensionBackup,
  updateExtensionInstallRecord,
} = require("./extensionInstallState")
const {
  DEFAULT_EXTENSION_ICON_DATA_URL,
  buildExtensionIconPresentation,
  buildExtensionRuntimeStatus,
} = require("./extensionPresentation")
const {
  buildExtensionEnablementMetadata,
} = require("./extensionEnablementMetadata")

const EXTENSIONS_DIR = path.resolve(__dirname, "..", "..", "..", "extensions")
const MARKETPLACE_API = DEFAULT_MARKETPLACE_API
const INSTALL_MARKER = ".codek-installed.json"
const ICON_CACHE_DIR = path.resolve(EXTENSIONS_DIR, ".marketplace-cache", "icons")
const ICON_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const ICON_MAX_BYTES = 1024 * 1024
const INSTALLED_SCAN_CACHE_TTL_MS = 5000

// ── Local extension management ──────────────────────────────────────────

let extensionStates = new Map() // id -> { enabled, installPath }
let installedScanCache = { at: 0, value: null }

function nowIso() {
  return new Date().toISOString()
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function assertPathInside(parentDir, candidatePath, label = "path") {
  const parent = path.resolve(parentDir)
  const candidate = path.resolve(candidatePath)
  const relative = path.relative(parent, candidate)
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return candidate
  }
  throw new Error(`Invalid .vsix: ${label} must stay inside ${parent}`)
}

function assertSafeExtensionIdentity(publisher, name) {
  const validSegment = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
  if (!validSegment.test(String(publisher || "")) || !validSegment.test(String(name || ""))) {
    throw new Error("Invalid .vsix: extension publisher/name must be simple identifiers")
  }
  return `${publisher}.${name}`
}

async function assertExtractedTreeSafe(rootDir, currentDir = rootDir) {
  const root = path.resolve(rootDir)
  const current = assertPathInside(root, currentDir, "extracted directory")
  const stat = await fsp.lstat(current)
  if (stat.isSymbolicLink()) {
    throw new Error(`Invalid .vsix: symbolic links are not allowed (${current})`)
  }
  if (!stat.isDirectory()) return

  const entries = await fsp.readdir(current, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = assertPathInside(root, path.join(current, entry.name), `extracted entry ${entry.name}`)
    const entryStat = await fsp.lstat(entryPath)
    if (entryStat.isSymbolicLink()) {
      throw new Error(`Invalid .vsix: symbolic links are not allowed (${entry.name})`)
    }
    if (entryStat.isDirectory()) {
      await assertExtractedTreeSafe(root, entryPath)
    }
  }
}

function pickManifestInstallState(manifest = {}) {
  if (!isPlainObject(manifest)) return {}
  const contributes = isPlainObject(manifest.contributes) ? manifest.contributes : {}
  const summary = {
    id: manifest.publisher && manifest.name ? `${manifest.publisher}.${manifest.name}` : manifest.id,
    publisher: manifest.publisher || manifest.namespace || "",
    name: manifest.name || "",
    version: manifest.version || "",
    displayName: manifest.displayName || manifest.name || manifest.id || "",
    description: manifest.description || "",
    main: manifest.main || "",
    browser: manifest.browser || "",
    activationEvents: Array.isArray(manifest.activationEvents) ? manifest.activationEvents : [],
    extensionDependencies: Array.isArray(manifest.extensionDependencies) ? manifest.extensionDependencies : [],
    extensionPack: Array.isArray(manifest.extensionPack) ? manifest.extensionPack : [],
    extensionKind: Array.isArray(manifest.extensionKind) ? manifest.extensionKind : [],
    enabledApiProposals: Array.isArray(manifest.enabledApiProposals) ? manifest.enabledApiProposals : [],
    capabilities: isPlainObject(manifest.capabilities) ? manifest.capabilities : undefined,
    contributes: {
      mcp: contributes.mcp,
    },
  }
  if (!summary.capabilities) delete summary.capabilities
  if (!summary.contributes.mcp) delete summary.contributes.mcp
  if (Object.keys(summary.contributes).length === 0) delete summary.contributes
  const mcp = isPlainObject(manifest.mcp) ? manifest.mcp : contributes.mcp
  return {
    manifest: summary,
    ...(mcp ? { mcp } : {}),
  }
}

function getCachedInstalledScan(options = {}) {
  if (options.extensionsDir || options.maxDepth != null) {
    return scanExtensions({
      extensionsDir: options.extensionsDir,
      maxDepth: options.maxDepth,
    })
  }
  if (installedScanCache.value && Date.now() - installedScanCache.at <= INSTALLED_SCAN_CACHE_TTL_MS) {
    return installedScanCache.value
  }
  installedScanCache = { at: Date.now(), value: scanExtensions() }
  return installedScanCache.value
}

function invalidateInstalledScanCache() {
  installedScanCache = { at: 0, value: null }
}

function installStateOptions(options = {}) {
  return options.stateFilePath ? { filePath: options.stateFilePath } : {}
}

function getInstalledExtensions(options = {}) {
  const scanned = getCachedInstalledScan(options)
  const lifecycle = options.lifecycle || readActivationReport() || {}
  const result = []

  for (const ext of scanned.allExtensions) {
    const id = getExtensionId(ext)
    const installState = getExtensionInstallRecord(id, installStateOptions(options)) || {}
    const state = extensionStates.get(id) || installState || { enabled: true }
    const installPath = getExtensionInstallPath(scanned.byId.get(id))
    const enablement = buildExtensionEnablementMetadata({ ...ext, id, installPath }, options)
    const enabled = state.enabled !== false && !enablement
    const compatibility = evaluateExtensionCompatibility(ext, { activationReport: lifecycle })
    const availability = buildExtensionRuntimeStatus({
      id,
      enabled,
      installState,
      compatibility,
      lifecycle,
    })
    const iconPresentation = buildExtensionIconPresentation({
      id,
      icon: ext.icon || "",
      installPath,
    })
    result.push({
      id,
      name: ext.name,
      publisher: ext.publisher,
      version: ext.version,
      displayName: ext.displayName,
      description: ext.description,
      categories: ext.categories || [],
      contributes: ext.contributes || {},
      activationEvents: ext.activationEvents || [],
      extensionDependencies: ext.extensionDependencies || [],
      extensionPack: ext.extensionPack || [],
      extensionKind: ext.extensionKind || [],
      enabledApiProposals: ext.enabledApiProposals || [],
      capabilities: ext.capabilities || undefined,
      engines: ext.engines || {},
      main: ext.main || "",
      browser: ext.browser || "",
      isBuiltin: ext.isBuiltin !== false,
      builtin: ext.isBuiltin !== false,
      enabled,
      installStatus: installState.status || "installed",
      installSource: installState.source || "",
      lastInstallError: installState.lastError || "",
      lastInstallPhase: installState.phase || "",
      ...iconPresentation,
      status: availability.status,
      statusLabel: availability.label,
      statusDetail: availability.detail,
      statusReason: availability.reason,
      availability,
      compatibility,
      installPath,
      enablement,
      productDisablement: enablement?.productDisablement || null,
      configurationDisablement: enablement?.configurationDisablement || null,
    })
  }

  return result
}

function getExtensionInstallPath(ext) {
  const raw = ext?.extensionLocation?.path || ext?.installPath || ""
  return raw ? path.resolve(fileUriPathToFsPath(raw)) : ""
}

function setExtensionEnabled(id, enabled) {
  const state = extensionStates.get(id) || {}
  state.enabled = enabled
  extensionStates.set(id, state)
  updateExtensionInstallRecord(id, {
    enabled,
    status: enabled ? "enabled" : "disabled",
    phase: enabled ? "enable" : "disable",
  })
  appendExtensionAudit({
    action: enabled ? "enable" : "disable",
    extensionId: id,
    phase: "toggle",
    status: "success",
  })
  return true
}

function normalizeForSearch(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function compactSearch(value) {
  return normalizeForSearch(value).replace(/\s+/g, "")
}

function scoreMarketplaceResult(ext, query) {
  const q = normalizeForSearch(query)
  const qc = compactSearch(query)
  if (!q) return Number(ext.downloadCount || 0) / 1000

  const id = normalizeForSearch(`${ext.namespace || ""}.${ext.name || ""}`)
  const idCompact = compactSearch(`${ext.namespace || ""}.${ext.name || ""}`)
  const name = normalizeForSearch(ext.name)
  const nameCompact = compactSearch(ext.name)
  const display = normalizeForSearch(ext.displayName)
  const displayCompact = compactSearch(ext.displayName)
  const tags = Array.isArray(ext.tags) ? ext.tags.map(normalizeForSearch) : []

  let score = 0
  if (id === q || idCompact === qc) score += 10000
  if (name === q || nameCompact === qc) score += 9000
  if (display === q || displayCompact === qc) score += 8000
  if (id.includes(q) || idCompact.includes(qc)) score += 4000
  if (name.includes(q) || nameCompact.includes(qc)) score += 3500
  if (display.includes(q) || displayCompact.includes(qc)) score += 3000
  if (tags.some((tag) => tag === q)) score += 800
  if (tags.some((tag) => tag.includes(q))) score += 300

  // VS Code Marketplace generally balances textual relevance first, then
  // popularity. Keep downloads as a tie-breaker so exact name matches do not
  // get buried by loosely related but popular extensions.
  score += Math.log10(Number(ext.downloadCount || 0) + 1) * 20
  score += Number(ext.averageRating || 0) * 5
  return score
}

function sanitizeIconCacheKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "extension"
}

function getIconCachePath(extensionId) {
  return path.join(ICON_CACHE_DIR, `${sanitizeIconCacheKey(extensionId)}.json`)
}

function getIconMimeType(contentType, sourceUrl) {
  const type = String(contentType || "").split(";")[0].trim().toLowerCase()
  if (type.startsWith("image/")) return type
  const pathname = (() => {
    try { return new URL(sourceUrl).pathname.toLowerCase() } catch { return "" }
  })()
  if (pathname.endsWith(".svg")) return "image/svg+xml"
  if (pathname.endsWith(".webp")) return "image/webp"
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg"
  return "image/png"
}

async function getInstalledExtensionIconDataUrl(extensionId, options = {}) {
  const scanned = getCachedInstalledScan(options)
  const ext = scanned.byId.get(extensionId)
    || scanned.allExtensions.find((item) => getExtensionId(item).toLowerCase() === String(extensionId).toLowerCase())
  if (!ext?.icon) return DEFAULT_EXTENSION_ICON_DATA_URL

  const installPath = getExtensionInstallPath(ext)
  const iconPath = path.resolve(installPath, ext.icon)
  if (!iconPath.startsWith(installPath + path.sep) && iconPath !== installPath) return DEFAULT_EXTENSION_ICON_DATA_URL

  try {
    const stat = await fsp.stat(iconPath)
    if (!stat.isFile() || stat.size > ICON_MAX_BYTES) return DEFAULT_EXTENSION_ICON_DATA_URL
    const buffer = await fsp.readFile(iconPath)
    const mime = getIconMimeType("", iconPath)
    return `data:${mime};base64,${buffer.toString("base64")}`
  } catch {
    return DEFAULT_EXTENSION_ICON_DATA_URL
  }
}

async function readCachedIcon(extensionId) {
  try {
    const raw = await fsp.readFile(getIconCachePath(extensionId), "utf8")
    const cached = JSON.parse(raw)
    if (!cached?.dataUrl || !cached?.cachedAt) return null
    if (Date.now() - Number(cached.cachedAt) > ICON_CACHE_TTL_MS) return null
    return cached.dataUrl
  } catch {
    return null
  }
}

async function getMarketplaceIconDataUrl(extensionId, sourceUrl) {
  if (!extensionId || !sourceUrl) return DEFAULT_EXTENSION_ICON_DATA_URL

  const cached = await readCachedIcon(extensionId)
  if (cached) return cached

  try {
    const parsed = new URL(sourceUrl)
    if (parsed.protocol !== "https:") return DEFAULT_EXTENSION_ICON_DATA_URL

    const response = await fetch(parsed.toString(), { timeout: 10000 })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const contentLength = Number(response.headers.get("content-length") || 0)
    if (contentLength > ICON_MAX_BYTES) throw new Error("icon too large")

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > ICON_MAX_BYTES) throw new Error("icon too large")

    const mime = getIconMimeType(response.headers.get("content-type"), parsed.toString())
    const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`
    await fsp.mkdir(ICON_CACHE_DIR, { recursive: true })
    await fsp.writeFile(getIconCachePath(extensionId), JSON.stringify({
      sourceUrl: parsed.toString(),
      mime,
      cachedAt: Date.now(),
      dataUrl,
    }))
    return dataUrl
  } catch (err) {
    console.warn(`[ext-mgr] Icon cache failed for ${extensionId}: ${err.message}`)
    return DEFAULT_EXTENSION_ICON_DATA_URL
  }
}

// ── Marketplace search via open-vsx.org ─────────────────────────────────

async function searchMarketplace(query, size = 20, options = {}) {
  try {
    const report = await searchMarketplaceRegistry(query, {
      size,
      pageSize: size,
      category: options.category,
      offset: options.offset,
      sources: options.sources || parseMarketplaceSources(),
      cacheTtlMs: options.cacheTtlMs || 60 * 1000,
    })
    return rankMarketplaceResults(report.extensions || [], query)
  } catch (err) {
    console.error(`[ext-mgr] Marketplace search failed: ${err.message}`)
    return []
  }
}

async function getExtensionDetails(namespace, name, version) {
  try {
    return await getMarketplaceDetails(namespace, name, { version, cacheTtlMs: 5 * 60 * 1000 })
  } catch (err) {
    console.error(`[ext-mgr] Failed to get details: ${err.message}`)
    return null
  }
}

async function getExtensionReadme(namespace, name) {
  try {
    return await getMarketplaceReadme(namespace, name, { cacheTtlMs: 5 * 60 * 1000 })
  } catch (err) {
    return { id: `${namespace}.${name}`, readme: "", available: false, error: err.message }
  }
}

async function getExtensionVersions(namespace, name) {
  try {
    return await getMarketplaceVersions(namespace, name, { cacheTtlMs: 5 * 60 * 1000 })
  } catch (err) {
    return { id: `${namespace}.${name}`, versions: [], error: err.message }
  }
}

async function getExtensionDetailsPayload(extensionIdOrNamespace, name, version) {
  const parsed = name
    ? { namespace: extensionIdOrNamespace, name }
    : splitExtensionId(extensionIdOrNamespace)
  const extensionId = parsed.namespace && parsed.name
    ? `${parsed.namespace}.${parsed.name}`
    : String(extensionIdOrNamespace || "")
  const installed = getInstalledExtensions()
  const installedMatch = installed.find((extension) => String(extension.id || "").toLowerCase() === extensionId.toLowerCase())
  const details = parsed.namespace && parsed.name
    ? await getExtensionDetails(parsed.namespace, parsed.name, version)
    : null
  const readme = parsed.namespace && parsed.name
    ? await getExtensionReadme(parsed.namespace, parsed.name)
    : { id: extensionId, readme: "", available: false }
  const versions = parsed.namespace && parsed.name
    ? await getExtensionVersions(parsed.namespace, parsed.name)
    : { id: extensionId, versions: [] }
  const installPlan = parsed.namespace && parsed.name
    ? await buildMarketplaceInstallPlan({ extensionId, metadata: details || installedMatch || { id: extensionId } })
    : null
  const compatibilityReport = buildInstalledCompatibilityReport()
  const audit = readExtensionAuditLog({ limit: 100 })
    .filter((entry) => String(entry.extensionId || "").toLowerCase() === extensionId.toLowerCase())
    .slice(-20)
  const payloadDetails = details
    ? {
        ...details,
        capabilities: details.capabilities || installedMatch?.capabilities,
      }
    : installedMatch || { id: extensionId, namespace: parsed.namespace, name: parsed.name }
  return buildExtensionDetailsPayload({
    details: payloadDetails,
    installedExtensions: installed,
    readme,
    versions,
    installPlan,
    compatibilityReport,
    installState: getExtensionInstallRecord(extensionId),
    audit,
  })
}

async function buildMarketplaceInstallPlan(input = {}) {
  const extensionId = input.extensionId || input.id || (input.namespace && input.name ? `${input.namespace}.${input.name}` : "")
  let namespace = input.namespace || ""
  let name = input.name || ""
  if (!namespace && extensionId.includes(".")) {
    const idx = extensionId.indexOf(".")
    namespace = extensionId.slice(0, idx)
    name = extensionId.slice(idx + 1)
  }
  const details = input.metadata || await getExtensionDetails(namespace, name)
  return buildInstallPlan({
    target: details || { id: extensionId, namespace, name },
    installedExtensions: input.installedExtensions || getInstalledExtensions(),
  })
}

function buildInstalledCompatibilityReport(options = {}) {
  return buildExtensionsCompatibilityReport({
    extensions: options.extensions || getInstalledExtensions(),
    activationReport: options.activationReport || readActivationReport(),
  })
}

function buildAndSaveCompatibilityReport(options = {}) {
  const report = buildInstalledCompatibilityReport(options)
  if (options.write === false) return report
  saveExtensionCompatibilityReport(report, { reportDir: options.reportDir })
  return report
}

// ── .vsix installation ─────────────────────────────────────────────────

async function installVsix(vsixPath) {
  if (!fs.existsSync(vsixPath)) {
    throw new Error(`File not found: ${vsixPath}`)
  }

  // .vsix is a ZIP file with a specific structure:
  // extension/package.json  — extension manifest
  // extension/...           — extension code

  const extract = require("extract-zip")
  const tmpDir = path.join(EXTENSIONS_DIR, ".tmp-install-" + Date.now())
  const startedAt = Date.now()
  let extensionId = ""
  let targetDir = ""
  let manifest = null
  let backup = null

  try {
    appendExtensionAudit({
      action: "install",
      source: "vsix",
      phase: "extract",
      status: "started",
      targetPath: vsixPath,
    })
    await extract(vsixPath, { dir: tmpDir })
    await assertExtractedTreeSafe(tmpDir)

    // Find and validate package.json
    const extDir = assertPathInside(tmpDir, path.join(tmpDir, "extension"), "extension directory")
    const pkgPath = assertPathInside(extDir, path.join(extDir, "package.json"), "extension manifest")
    if (!fs.existsSync(pkgPath)) {
      throw new Error("Invalid .vsix: no extension/package.json found")
    }

    manifest = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
    const extName = manifest.name
    const publisher = manifest.publisher || "unknown"
    extensionId = assertSafeExtensionIdentity(publisher, extName)
    targetDir = assertPathInside(EXTENSIONS_DIR, path.join(EXTENSIONS_DIR, extensionId), "extension install target")
    backup = await backupExtensionDirectory(extensionId, targetDir, { reason: "replace-vsix" })
    updateExtensionInstallRecord(extensionId, {
      status: "installing",
      phase: "copy",
      source: "vsix",
      version: manifest.version || "",
      installPath: targetDir,
      lastBackup: backup,
      ...pickManifestInstallState(manifest),
    })

    // Remove existing installation if present
    if (fs.existsSync(targetDir)) {
      await fsp.rm(targetDir, { recursive: true, force: true })
    }

    // Copy instead of rename: Windows can return EPERM for cross-device or
    // recently deleted directory moves while antivirus/indexing still holds it.
    await fsp.cp(extDir, targetDir, { recursive: true, force: true })
    await fsp.writeFile(path.join(targetDir, INSTALL_MARKER), JSON.stringify({
      builtin: false,
      source: "vsix",
      installedAt: new Date().toISOString(),
    }, null, 2))
    updateExtensionInstallRecord(extensionId, {
      status: "installed",
      phase: "done",
      source: "vsix",
      version: manifest.version || "",
      enabled: true,
      installPath: targetDir,
      installedAt: nowIso(),
      lastError: "",
      lastBackup: backup,
      ...pickManifestInstallState(manifest),
    })
    appendExtensionAudit({
      action: "install",
      source: "vsix",
      extensionId,
      version: manifest.version || "",
      phase: "done",
      status: "success",
      targetPath: targetDir,
      backupPath: backup?.backupDir || "",
      durationMs: Date.now() - startedAt,
    })
    invalidateInstalledScanCache()

    // Cleanup
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})

    console.log(`[ext-mgr] Installed: ${publisher}.${extName} v${manifest.version}`)
    return {
      id: `${publisher}.${extName}`,
      name: extName,
      publisher,
      version: manifest.version,
      displayName: manifest.displayName || extName,
      manifest,
    }
  } catch (err) {
    let rollbackStatus = ""
    if (backup) {
      try {
        await restoreExtensionBackup(backup, { updateState: false })
        rollbackStatus = "restored"
      } catch (rollbackError) {
        rollbackStatus = `failed:${rollbackError.message}`
      }
    }
    if (extensionId) {
      updateExtensionInstallRecord(extensionId, {
        status: "failed",
        phase: "install",
        source: "vsix",
        version: manifest?.version || "",
        installPath: targetDir,
        lastError: err.message,
        rollbackStatus,
        lastBackup: backup,
      })
      appendExtensionAudit({
        action: "install",
        source: "vsix",
        extensionId,
        version: manifest?.version || "",
        phase: "install",
        status: "failed",
        error: err,
        targetPath: targetDir,
        backupPath: backup?.backupDir || "",
        metadata: { rollbackStatus },
        durationMs: Date.now() - startedAt,
      })
    }
    // Cleanup on failure
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    invalidateInstalledScanCache()
    throw err
  }
}

async function installFromMarketplace(namespace, name, version, onProgress) {
  // Accept either ("publisher", "name") or ("publisher.name") as first arg.
  if (typeof name === "function" && typeof version === "undefined") {
    onProgress = name
    name = undefined
  }
  if (!name && namespace && namespace.includes(".")) {
    const idx = namespace.indexOf(".")
    name = namespace.slice(idx + 1)
    namespace = namespace.slice(0, idx)
  }

  const url = version
    ? `${MARKETPLACE_API}/${namespace}/${name}/${version}`
    : `${MARKETPLACE_API}/${namespace}/${name}`

  const emit = (phase, percent, extra) => {
    if (typeof onProgress === "function") {
      try { onProgress({ phase, percent, ...(extra || {}) }) } catch {}
    }
  }

  const tmpDir = path.join(EXTENSIONS_DIR, ".tmp-download-" + Date.now())
  const vsixPath = path.join(tmpDir, "extension.vsix")

  try {
    await fsp.mkdir(tmpDir, { recursive: true })

    emit("download", 0)
    // Get .vsix download URL first
    const extensionId = `${namespace}.${name}`
    updateExtensionInstallRecord(extensionId, {
      status: "installing",
      phase: "download",
      source: "marketplace",
      version: version || "",
    })
    appendExtensionAudit({
      action: "install",
      source: "marketplace",
      extensionId,
      version: version || "",
      phase: "download",
      status: "started",
    })
    const meta = await getExtensionDetails(namespace, name, version)
    const dlUrl = meta?.downloadUrl || meta?.files?.download || url
    const response = await fetch(dlUrl, { timeout: 60000 })
    if (!response.ok) throw new Error(`Marketplace returned HTTP ${response.status}`)

    const buffer = Buffer.from(await response.arrayBuffer())
    await fsp.writeFile(vsixPath, buffer)
    emit("download", 100)

    emit("extract", 50)
    const result = await installVsix(vsixPath)
    updateExtensionInstallRecord(result.id, {
      status: "installed",
      phase: "done",
      source: "marketplace",
      version: result.version || version || "",
      marketplaceSource: meta?.source || "",
      downloadUrl: dlUrl,
      lastError: "",
      ...pickManifestInstallState(result.manifest || meta),
    })
    appendExtensionAudit({
      action: "install",
      source: "marketplace",
      extensionId: result.id,
      version: result.version || version || "",
      phase: "done",
      status: "success",
    })
    emit("extract", 100)

    emit("activate", 100)
    emit("done", 100, { id: result.id })

    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    return result
  } catch (err) {
    emit("error", 0, { message: err.message })
    const extensionId = namespace && name ? `${namespace}.${name}` : ""
    if (extensionId) {
      updateExtensionInstallRecord(extensionId, {
        status: "failed",
        phase: "marketplace",
        source: "marketplace",
        version: version || "",
        lastError: err.message,
      })
      appendExtensionAudit({
        action: "install",
        source: "marketplace",
        extensionId,
        version: version || "",
        phase: "marketplace",
        status: "failed",
        error: err,
      })
    }
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

async function uninstallExtension(extensionId) {
  const scanned = getCachedInstalledScan()
  const ext = scanned.byId.get(extensionId)
  if (!ext) throw new Error(`Extension not found: ${extensionId}`)

  const installPath = getExtensionInstallPath(ext)
  if (!installPath) throw new Error(`Cannot determine install path for ${extensionId}`)

  // Don't uninstall built-in extensions
  if (ext.isBuiltin) throw new Error(`Cannot uninstall built-in extension: ${extensionId}`)

  const startedAt = Date.now()
  const backup = await backupExtensionDirectory(extensionId, installPath, { reason: "uninstall" })
  updateExtensionInstallRecord(extensionId, {
    status: "uninstalling",
    phase: "remove",
    installPath,
    lastBackup: backup,
  })
  appendExtensionAudit({
    action: "uninstall",
    extensionId,
    phase: "remove",
    status: "started",
    targetPath: installPath,
    backupPath: backup?.backupDir || "",
  })
  try {
    await fsp.rm(installPath, { recursive: true, force: true })
  } catch (err) {
    updateExtensionInstallRecord(extensionId, {
      status: "failed",
      phase: "uninstall",
      installPath,
      lastError: err.message,
      lastBackup: backup,
    })
    appendExtensionAudit({
      action: "uninstall",
      extensionId,
      phase: "remove",
      status: "failed",
      error: err,
      targetPath: installPath,
      backupPath: backup?.backupDir || "",
      durationMs: Date.now() - startedAt,
    })
    throw err
  }
  extensionStates.delete(extensionId)
  updateExtensionInstallRecord(extensionId, {
    status: "uninstalled",
    phase: "done",
    enabled: false,
    installPath,
    uninstalledAt: nowIso(),
    lastBackup: backup,
    lastError: "",
  })
  appendExtensionAudit({
    action: "uninstall",
    extensionId,
    phase: "done",
    status: "success",
    targetPath: installPath,
    backupPath: backup?.backupDir || "",
    durationMs: Date.now() - startedAt,
  })
  invalidateInstalledScanCache()
  console.log(`[ext-mgr] Uninstalled: ${extensionId}`)
  return true
}

async function rollbackExtension(extensionId) {
  const record = getExtensionInstallRecord(extensionId)
  if (!record?.lastBackup) throw new Error(`No rollback backup found for ${extensionId}`)
  const restored = await restoreExtensionBackup(record.lastBackup)
  updateExtensionInstallRecord(extensionId, {
    status: "installed",
    phase: "rollback",
    enabled: true,
    installPath: restored.targetDir,
    rollbackStatus: "restored",
    lastError: "",
    lastRollbackAt: nowIso(),
  })
  appendExtensionAudit({
    action: "rollback",
    extensionId,
    phase: "restore",
    status: "success",
    targetPath: restored.targetDir,
    backupPath: restored.backupDir,
  })
  invalidateInstalledScanCache()
  return restored
}

function readActivationReport() {
  const reportPath = path.join(EXTENSIONS_DIR, "_activation_report.json")
  try {
    if (!fs.existsSync(reportPath)) return null
    return JSON.parse(fs.readFileSync(reportPath, "utf8"))
  } catch {
    return null
  }
}

async function buildAndSaveEcosystemHealth(options = {}) {
  const query = options.query || "ms-python.python"
  const searchResults = options.searchResults || await searchMarketplace(query, Number(options.pageSize || 20))
  const report = buildExtensionEcosystemHealth({
    query,
    installed: getInstalledExtensions(),
    searchResults,
    iconCache: options.iconCache || {},
    activationReport: options.activationReport || readActivationReport(),
    installResults: options.installResults || [],
  })
  if (options.write === false) return report
  saveExtensionEcosystemHealth(report, { reportDir: options.reportDir })
  return report
}

module.exports = {
  buildAndSaveEcosystemHealth,
  getExtensionInstallPath,
  getInstalledExtensions,
  pickManifestInstallState,
  setExtensionEnabled,
  searchMarketplace,
  getMarketplaceIconDataUrl,
  getInstalledExtensionIconDataUrl,
  getExtensionDetails,
  getExtensionDetailsPayload,
  installVsix,
  installFromMarketplace,
  listExtensionInstallStates,
  readExtensionAuditLog,
  readActivationReport,
  readLatestExtensionEcosystemHealth,
  readLatestExtensionCompatibilityReport,
  uninstallExtension,
  rollbackExtension,
  buildMarketplaceInstallPlan,
  buildInstalledCompatibilityReport,
  buildAndSaveCompatibilityReport,
  getExtensionReadme,
  getExtensionVersions,
  getMarketplaceReadme: getExtensionReadme,
  getMarketplaceVersions: getExtensionVersions,
  _test: {
    assertExtractedTreeSafe,
    assertPathInside,
    assertSafeExtensionIdentity,
  },
}
