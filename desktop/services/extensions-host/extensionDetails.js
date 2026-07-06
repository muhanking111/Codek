const {
  DEFAULT_EXTENSION_ICON_DATA_URL,
  buildExtensionIconPresentation,
} = require("./extensionPresentation")

function splitExtensionId(id) {
  const value = String(id || "").trim()
  const dot = value.indexOf(".")
  if (dot <= 0) return { namespace: "", name: value }
  return { namespace: value.slice(0, dot), name: value.slice(dot + 1) }
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String)
  if (typeof value === "string") return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)
  return []
}

function normalizeExtensionDetails(details = {}) {
  const namespace = details.namespace || details.publisher || ""
  const name = details.name || ""
  const id = details.id || (namespace && name ? `${namespace}.${name}` : name || namespace)
  const icon = buildExtensionIconPresentation({
    id,
    icon: details.icon || details.iconPath || "",
    iconUrl: details.iconUrl || details.files?.icon || "",
    iconCacheUrl: details.iconCacheUrl || "",
    iconUrlFallback: details.iconUrlFallback || details.assets?.icon?.fallbackUri || "",
    installPath: details.installPath || "",
  })
  return {
    id,
    name,
    publisher: details.publisher || namespace,
    namespace,
    displayName: details.displayName || name || id,
    description: details.description || "",
    version: details.version || "",
    source: details.source || "",
    sourceUrl: details.sourceUrl || "",
    repository: details.repository || "",
    license: details.license || "",
    verified: details.verified === true,
    deprecated: details.deprecated === true,
    downloads: Number(details.downloads || details.downloadCount || details.installCount || 0),
    rating: Number(details.rating || details.averageRating || 0),
    downloadUrl: details.downloadUrl || "",
    icon: icon.icon,
    iconPath: icon.iconPath,
    iconUrl: icon.iconUrl,
    iconCacheUrl: icon.iconCacheUrl,
    iconUrlFallback: icon.iconUrlFallback,
    iconSource: icon.iconSource,
    iconDataUrl: details.iconDataUrl || DEFAULT_EXTENSION_ICON_DATA_URL,
    defaultIcon: details.defaultIcon !== false,
    readmeUrl: details.readmeUrl || "",
    categories: toArray(details.categories),
    tags: toArray(details.tags),
    extensionDependencies: toArray(details.extensionDependencies),
    extensionPack: toArray(details.extensionPack),
    enabledApiProposals: toArray(details.enabledApiProposals),
    extensionKind: toArray(details.extensionKind),
    contributes: details.contributes && typeof details.contributes === "object" && !Array.isArray(details.contributes)
      ? details.contributes
      : undefined,
    capabilities: details.capabilities && typeof details.capabilities === "object" && !Array.isArray(details.capabilities)
      ? details.capabilities
      : undefined,
    engines: details.engines || {},
    enablement: details.enablement || null,
    productDisablement: details.productDisablement || null,
    configurationDisablement: details.configurationDisablement || null,
  }
}

function findInstalledExtension(id, installedExtensions = []) {
  const key = String(id || "").toLowerCase()
  return (Array.isArray(installedExtensions) ? installedExtensions : [])
    .find((extension) => String(extension?.id || "").toLowerCase() === key) || null
}

function summarizeCompatibilityForExtension(id, compatibilityReport = {}) {
  const key = String(id || "").toLowerCase()
  const match = (Array.isArray(compatibilityReport.extensions) ? compatibilityReport.extensions : [])
    .find((extension) => String(extension.id || "").toLowerCase() === key)
  if (!match) {
    return {
      available: false,
      status: "unknown",
      blockers: [],
      warnings: [],
      unsupportedContributionPoints: [],
      partialContributionPoints: [],
    }
  }
  return {
    available: true,
    status: match.status || "unknown",
    blockers: Array.isArray(match.blockers) ? match.blockers : [],
    warnings: Array.isArray(match.warnings) ? match.warnings : [],
    unsupportedContributionPoints: Array.isArray(match.unsupportedContributionPoints) ? match.unsupportedContributionPoints : [],
    partialContributionPoints: Array.isArray(match.partialContributionPoints) ? match.partialContributionPoints : [],
  }
}

function summarizeReadme(readme = {}) {
  const text = String(readme.readme || "")
  return {
    id: readme.id || "",
    available: readme.available === true || text.length > 0,
    readmeUrl: readme.readmeUrl || "",
    length: text.length,
    text,
    error: readme.error || "",
  }
}

function normalizeInstallState(installState) {
  if (!installState || typeof installState !== "object") return null
  return {
    ...installState,
    installSource: installState.installSource || installState.source || "",
    error: installState.error || installState.lastError || "",
  }
}

function buildExtensionDetailsPayload(input = {}) {
  const details = normalizeExtensionDetails(input.details || {})
  const installed = findInstalledExtension(details.id, input.installedExtensions)
  const compatibility = summarizeCompatibilityForExtension(details.id, input.compatibilityReport)
  const versions = Array.isArray(input.versions?.versions) ? input.versions.versions : []
  return {
    reportKind: "extension-details",
    createdAt: Number(input.createdAt || Date.now()),
    ready: Boolean(details.id),
    id: details.id,
    extension: details,
    installed: installed ? {
      id: installed.id,
      version: installed.version || "",
      enabled: installed.enabled !== false,
      installPath: installed.installPath || "",
      builtin: installed.isBuiltin !== false && installed.builtin !== false,
      status: installed.status || "",
      statusLabel: installed.statusLabel || "",
      statusDetail: installed.statusDetail || "",
      statusReason: installed.statusReason || "",
      availability: installed.availability || null,
      iconSource: installed.iconSource || "",
      iconUrl: installed.iconUrl || "",
      iconCacheUrl: installed.iconCacheUrl || "",
      iconUrlFallback: installed.iconUrlFallback || "",
      iconDataUrl: installed.iconDataUrl || DEFAULT_EXTENSION_ICON_DATA_URL,
      defaultIcon: installed.defaultIcon !== false,
      enablement: installed.enablement || null,
      productDisablement: installed.productDisablement || null,
      configurationDisablement: installed.configurationDisablement || null,
    } : null,
    readme: summarizeReadme(input.readme || {}),
    versions,
    latestVersion: versions[0]?.version || details.version || "",
    installPlan: input.installPlan || null,
    compatibility,
    installState: normalizeInstallState(input.installState),
    audit: Array.isArray(input.audit) ? input.audit : [],
  }
}

module.exports = {
  buildExtensionDetailsPayload,
  findInstalledExtension,
  normalizeExtensionDetails,
  normalizeInstallState,
  splitExtensionId,
  summarizeCompatibilityForExtension,
  summarizeReadme,
}
