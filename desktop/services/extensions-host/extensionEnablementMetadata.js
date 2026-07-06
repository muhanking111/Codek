const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const ALLOWED_EXTENSIONS_CONFIG_KEY = "extensions.allowed"
const DISABLED_EXTENSIONS_STORAGE_PATH = "extensionsIdentifiers/disabled"

function codekDataRoot() {
  return process.env.CODEK_DATA || path.join(os.homedir(), ".codek")
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function readJsonFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"))
    return isPlainObject(parsed) || Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function normalizeExtensionId(extension) {
  if (typeof extension === "string") return extension.trim()
  return String(extension?.id || extension?.identifier?.value || extension?.identifier?.id || "").trim()
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase()
}

function toIdentifierList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "string") return item
      if (typeof item?.id === "string") return item.id
      if (typeof item?.identifier === "string") return item.identifier
      if (typeof item?.identifier?.id === "string") return item.identifier.id
      if (typeof item?.identifier?.value === "string") return item.identifier.value
      return ""
    }).filter(Boolean)
  }
  if (typeof value === "string") {
    return value.split(/[,\n;]/).map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function readUserSettings(options = {}) {
  if (isPlainObject(options.userSettings)) return options.userSettings
  if (options.userSettingsPath) return readJsonFile(options.userSettingsPath) || {}
  if (isPlainObject(options.configuration)) return options.configuration
  try {
    const settings = require("../settings")
    return settings.readUserSettings()
  } catch {
    return {}
  }
}

function readProductConfiguration(options = {}) {
  if (isPlainObject(options.productService)) return options.productService
  if (isPlainObject(options.productConfiguration)) return options.productConfiguration
  const productPath = options.productPath || process.env.CODEK_PRODUCT_JSON || path.join(codekDataRoot(), "product.json")
  return readJsonFile(productPath) || {}
}

function readGlobalDisabledExtensions(options = {}) {
  const explicit = options.disabledExtensions || options.globalDisabledExtensions
  if (explicit) return toIdentifierList(explicit)

  const storagePath = options.storagePath || process.env.CODEK_EXTENSION_ENABLEMENT_STORAGE || path.join(codekDataRoot(), "User", "globalStorage", "storage.json")
  const storage = readJsonFile(storagePath)
  if (Array.isArray(storage)) return toIdentifierList(storage)
  if (!isPlainObject(storage)) return []
  return toIdentifierList(
    storage[DISABLED_EXTENSIONS_STORAGE_PATH]
      || storage.disabledExtensions
      || storage.globalDisabledExtensions
      || storage["extensions.disabled"],
  )
}

function getAllowedExtensionsConfig(options = {}) {
  const settings = readUserSettings(options)
  const value = settings[ALLOWED_EXTENSIONS_CONFIG_KEY]
    || settings.extensions?.allowed
    || options.allowedExtensions
  if (!isPlainObject(value)) return undefined
  const entries = Object.entries(value).map(([key, item]) => [normalizeKey(key), item])
  if (entries.length === 1 && entries[0][0] === "*" && entries[0][1] === true) return undefined
  return Object.fromEntries(entries)
}

function isAllowedByConfiguration(extension, allowedConfig) {
  if (!allowedConfig) return true
  const id = normalizeKey(normalizeExtensionId(extension))
  const version = String(extension?.version || "*")
  const publisher = normalizeKey(extension?.publisher || id.slice(0, id.indexOf(".")))
  const extensionValue = allowedConfig[id]

  if (extensionValue !== undefined) {
    if (typeof extensionValue === "boolean") return extensionValue
    if (extensionValue === "stable") return true
    if (Array.isArray(extensionValue)) return extensionValue.some((entry) => String(entry).split("@")[0] === version)
    return true
  }

  const publisherValue = allowedConfig[publisher]
  if (publisherValue !== undefined) {
    if (typeof publisherValue === "boolean") return publisherValue
    if (publisherValue === "stable") return true
    return true
  }

  return allowedConfig["*"] === true
}

function buildProductDisablement(extension, options = {}) {
  const product = readProductConfiguration(options)
  const disabled = toIdentifierList(
    product.disableExtensions
      || product.disabledExtensions
      || product.extensions?.disabled
      || product.extensions?.disable,
  )
  const id = normalizeKey(normalizeExtensionId(extension))
  const match = disabled.find((item) => normalizeKey(item) === id)
  if (!match) return null
  return {
    disabled: true,
    source: "productService.disableExtensions",
    reason: "product-disableExtensions",
    detail: "Product metadata disables this extension.",
    scope: "environment",
    runtimeReference: false,
  }
}

function buildConfigurationDisablement(extension, options = {}) {
  const id = normalizeKey(normalizeExtensionId(extension))
  const globalDisabled = readGlobalDisabledExtensions(options)
  if (globalDisabled.some((item) => normalizeKey(item) === id)) {
    return {
      disabled: true,
      source: "globalExtensionEnablementService.disabledExtensions",
      reason: "global-disabledExtensions",
      detail: "VS Code global extension enablement storage lists this extension in disabledExtensions.",
      configKey: DISABLED_EXTENSIONS_STORAGE_PATH,
      scope: "profile",
      runtimeReference: false,
    }
  }

  const allowedConfig = getAllowedExtensionsConfig(options)
  if (allowedConfig && !isAllowedByConfiguration(extension, allowedConfig)) {
    return {
      disabled: true,
      source: "configurationService.extensions.allowed",
      reason: "extensions.allowed",
      detail: "extensions.allowed blocks this extension.",
      configKey: ALLOWED_EXTENSIONS_CONFIG_KEY,
      scope: "global",
      runtimeReference: false,
    }
  }

  return null
}

function buildExtensionEnablementMetadata(extension, options = {}) {
  const productDisablement = buildProductDisablement(extension, options)
  const configurationDisablement = buildConfigurationDisablement(extension, options)
  if (!productDisablement && !configurationDisablement) return null

  const state = productDisablement
    ? "DisabledByEnvironment"
    : (configurationDisablement.source === "globalExtensionEnablementService.disabledExtensions" ? "DisabledGlobally" : "DisabledByAllowlist")
  return {
    state,
    reason: productDisablement ? "product" : (state === "DisabledGlobally" ? "globalUser" : "configuration"),
    source: "desktop.extensionsHost.enablementMetadata",
    detail: productDisablement?.detail || configurationDisablement?.detail || "",
    productDisablement,
    configurationDisablement,
  }
}

function applyExtensionEnablementMetadata(extension, options = {}) {
  const enablement = buildExtensionEnablementMetadata(extension, options)
  if (!enablement) return extension
  return {
    ...extension,
    enabled: false,
    enablement,
    productDisablement: enablement.productDisablement,
    configurationDisablement: enablement.configurationDisablement,
  }
}

module.exports = {
  ALLOWED_EXTENSIONS_CONFIG_KEY,
  DISABLED_EXTENSIONS_STORAGE_PATH,
  applyExtensionEnablementMetadata,
  buildConfigurationDisablement,
  buildExtensionEnablementMetadata,
  buildProductDisablement,
  getAllowedExtensionsConfig,
  isAllowedByConfiguration,
  readGlobalDisabledExtensions,
}
