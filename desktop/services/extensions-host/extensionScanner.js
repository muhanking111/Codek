/**
 * Extension Scanner — reads the extensions/ directory and builds IExtensionDescription[]
 * for the EH InitData.
 */

const fs = require("fs")
const path = require("path")
const { createExtensionScanResult } = require("./extensionDescriptionRegistry")
const { toFileUriComponents } = require("./uriComponents")

const EXTENSIONS_DIR = path.resolve(__dirname, "..", "..", "..", "extensions")
const INSTALL_MARKER = ".codek-installed.json"
const VERBOSE_EXTENSION_SCAN = process.env.CODEK_VERBOSE_EXTENSION_SCAN === "1"

function logScanDetail(message) {
  if (VERBOSE_EXTENSION_SCAN) console.log(message)
}

/**
 * Parse a package.nls.json file and return its contents as a flat map.
 */
function loadNls(localeDir, locale = "zh-cn") {
  try {
    const nlsPath = path.join(localeDir, "package.nls.json")
    if (fs.existsSync(nlsPath)) {
      return JSON.parse(fs.readFileSync(nlsPath, "utf8"))
    }
    // Try localized variant
    const localizedPath = path.join(localeDir, "package.nls." + locale + ".json")
    if (fs.existsSync(localizedPath)) {
      return JSON.parse(fs.readFileSync(localizedPath, "utf8"))
    }
  } catch {}
  return {}
}

/**
 * Resolve %localized.string% references using an nls map.
 */
function resolveNls(obj, nls) {
  if (typeof obj === "string") {
    const match = obj.match(/^%([^%]+)%$/)
    return match && nls[match[1]] ? nls[match[1]] : obj
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveNls(item, nls))
  }
  if (obj && typeof obj === "object") {
    const result = {}
    for (const [key, val] of Object.entries(obj)) {
      result[key] = resolveNls(val, nls)
    }
    return result
  }
  return obj
}

function normalizeActivationEvents(value) {
  if (Array.isArray(value)) {
    return value.filter((event) => typeof event === "string" && event.trim())
  }
  if (value && typeof value === "object") {
    return Object.keys(value).filter((event) => typeof event === "string" && event.trim())
  }
  return undefined
}

function makeExtensionIdentifier(id) {
  return {
    value: id,
    _lower: String(id || "").toLowerCase(),
  }
}

function getExtensionId(extension) {
  if (!extension) return ""
  if (typeof extension === "string") return extension
  if (typeof extension.id === "string") return extension.id
  if (typeof extension.identifier === "string") return extension.identifier
  if (extension.identifier?.value) return extension.identifier.value
  if (extension.identifier?._lower) return extension.identifier._lower
  return ""
}

function shouldSkipExtensionScanDir(name) {
  return name === "node_modules"
    || name === INSTALL_MARKER
    || name.startsWith(".")
    || name === "out"
    || name === "dist"
    || name === "build"
}

function collectExtensionDirs(dir, depth = 0, maxDepth = 1) {
  const result = []
  if (!fs.existsSync(dir)) return result

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || shouldSkipExtensionScanDir(entry.name)) continue
    const extPath = path.join(dir, entry.name)
    if (fs.existsSync(path.join(extPath, "package.json"))) {
      result.push(extPath)
    }
    if (depth < maxDepth) {
      result.push(...collectExtensionDirs(extPath, depth + 1, maxDepth))
    }
  }
  return result
}

/**
 * Scan all extensions in the extensions/ directory.
 * @param {object} [options]
 * @param {string} [options.extensionsDir]  - Custom extensions directory
 * @returns {{ allExtensions: object[], activationEvents: object, activationEventsByEvent: object, byId: Map<string, object>, removedDueToLooping: object[] }}
 */
function scanExtensions(options = {}) {
  const dir = options.extensionsDir || EXTENSIONS_DIR
  const allExtensions = []

  if (!fs.existsSync(dir)) {
    console.log(`[ext-scan] No extensions directory at: ${dir}`)
    return createExtensionScanResult(allExtensions)
  }

  const extensionDirs = collectExtensionDirs(dir, 0, Number(options.maxDepth ?? 1))

  for (const extPath of extensionDirs) {
    const entryName = path.basename(extPath)
    const pkgPath = path.join(extPath, "package.json")

    try {
      const raw = fs.readFileSync(pkgPath, "utf8")
      const manifest = JSON.parse(raw)
      const markerPath = path.join(extPath, INSTALL_MARKER)
      let installMarker = null
      if (fs.existsSync(markerPath)) {
        try {
          installMarker = JSON.parse(fs.readFileSync(markerPath, "utf8"))
        } catch {}
      }

      const id = `${manifest.publisher || "unknown"}.${manifest.name || entryName}`
      const manifestActivationEvents = normalizeActivationEvents(manifest.activationEvents)

      // Load NLS and resolve localized strings in the manifest. VS Code
      // built-ins commonly use "%displayName%" and "%description%" at the
      // package root, not just inside contributes.
      const nls = loadNls(extPath)
      const resolvedManifest = resolveNls(manifest, nls)
      const displayName = resolvedManifest.displayName || resolvedManifest.name || entryName
      const description = resolvedManifest.description || ""
      const categories = resolvedManifest.categories || []
      const contributions = resolvedManifest.contributes

      // Build IExtensionDescription (subset — enough for EH to register)
      const extDesc = {
        ...resolvedManifest,
        id,
        identifier: makeExtensionIdentifier(id),
        name: resolvedManifest.name || entryName,
        version: resolvedManifest.version || "1.0.0",
        publisher: resolvedManifest.publisher || "unknown",
        enabledApiProposals: resolvedManifest.enabledApiProposals || undefined,
        engines: resolvedManifest.engines || { vscode: "*" },
        extensionDependencies: resolvedManifest.extensionDependencies || undefined,
        extensionPack: resolvedManifest.extensionPack || undefined,
        capabilities: resolvedManifest.capabilities || undefined,
        extensionLocation: toFileUriComponents(extPath),
        isBuiltin: installMarker?.builtin === false ? false : true,
        isUnderDevelopment: false,
        activationEvents: manifestActivationEvents,
        contributes: contributions,
        main: resolvedManifest.main || undefined,
        browser: resolvedManifest.browser || undefined,
        categories,
        description,
        displayName,
        icon: resolvedManifest.icon || undefined,
        repository: resolvedManifest.repository || undefined,
        license: resolvedManifest.license || undefined,
        extensionKind: resolvedManifest.extensionKind || ["workspace"],
      }

      allExtensions.push(extDesc)

      logScanDetail(`[ext-scan] Found: ${id} v${manifest.version}`)
    } catch (err) {
      console.error(`[ext-scan] Error loading ${entryName}: ${err.message}`)
    }
  }

  const result = createExtensionScanResult(allExtensions)
  if (result.removedDueToLooping.length > 0) {
    console.error(`[ext-scan] Disabled dependency loops: ${result.removedDueToLooping.map((extension) => getExtensionId(extension)).join(", ")}`)
  }
  console.log(`[ext-scan] Total: ${result.allExtensions.length} extensions, ${Object.keys(result.activationEventsByEvent).length} activation events`)
  return result
}

module.exports = {
  getExtensionId,
  makeExtensionIdentifier,
  normalizeActivationEvents,
  scanExtensions,
}
