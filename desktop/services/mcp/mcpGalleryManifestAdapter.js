/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code MCP gallery manifest service:
 * - D:\SourceMirror\vscode\src\vs\platform\mcp\common\mcpGalleryManifest.ts
 * - D:\SourceMirror\vscode\src\vs\platform\mcp\common\mcpGalleryManifestService.ts
 *--------------------------------------------------------------------------------------------*/

const { readUserSettings } = require("../settings")

const SUPPORTED_VERSIONS = Object.freeze(["v0.1", "v0"])

const McpGalleryResourceType = Object.freeze({
  McpServersQueryService: "McpServersQueryService",
  McpServerWebUri: "McpServerWebUriTemplate",
  McpServerVersionUri: "McpServerVersionUriTemplate",
  McpServerIdUri: "McpServerIdUriTemplate",
  McpServerLatestVersionUri: "McpServerLatestVersionUriTemplate",
  McpServerNamedResourceUri: "McpServerNamedResourceUriTemplate",
  PublisherUriTemplate: "PublisherUriTemplate",
  ContactSupportUri: "ContactSupportUri",
  PrivacyPolicyUri: "PrivacyPolicyUri",
  TermsOfServiceUri: "TermsOfServiceUri",
  ReportUri: "ReportUri",
})

const McpGalleryManifestStatus = Object.freeze({
  Available: "available",
  Unavailable: "unavailable",
})

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function normalizeServiceUrl(value) {
  const url = typeof value === "string" ? value.trim() : ""
  return url.replace(/\/+$/, "")
}

function templateFromSetting(settings, key, fallback) {
  const value = settings?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function getConfiguredMcpGalleryProduct(options = {}) {
  const settings = isRecord(options.settings) ? options.settings : readUserSettings()
  const env = isRecord(options.env) ? options.env : process.env
  if (settings["chat.mcp.gallery.enabled"] === false) return null

  const serviceUrl = normalizeServiceUrl(
    settings["chat.mcp.gallery.serviceUrl"] || env.CODEK_MCP_GALLERY_SERVICE_URL,
  )
  if (!serviceUrl) return null

  return {
    serviceUrl,
    itemWebUrl: templateFromSetting(settings, "chat.mcp.gallery.itemWebUrl", `${serviceUrl}/items/{name}`),
    publisherUrl: templateFromSetting(settings, "chat.mcp.gallery.publisherUrl", `${serviceUrl}/publishers/{publisher}`),
    supportUrl: templateFromSetting(settings, "chat.mcp.gallery.supportUrl", `${serviceUrl}/support`),
    privacyPolicyUrl: templateFromSetting(settings, "chat.mcp.gallery.privacyPolicyUrl", `${serviceUrl}/privacy`),
    termsOfServiceUrl: templateFromSetting(settings, "chat.mcp.gallery.termsOfServiceUrl", `${serviceUrl}/terms`),
    reportUrl: templateFromSetting(settings, "chat.mcp.gallery.reportUrl", `${serviceUrl}/report/{name}`),
  }
}

function getMcpGalleryManifestStatus(options = {}) {
  const productGallery = Object.prototype.hasOwnProperty.call(options, "productGallery")
    ? options.productGallery
    : getConfiguredMcpGalleryProduct(options)
  return productGallery?.serviceUrl ? McpGalleryManifestStatus.Available : McpGalleryManifestStatus.Unavailable
}

function createMcpGalleryManifest(url, version = SUPPORTED_VERSIONS[0], productGallery = getConfiguredMcpGalleryProduct()) {
  const normalizedUrl = normalizeServiceUrl(url)
  if (!normalizedUrl) throw new Error("MCP gallery service URL is required")
  const supportedVersion = SUPPORTED_VERSIONS.includes(version) ? version : SUPPORTED_VERSIONS[0]
  const isProductGalleryUrl = normalizeServiceUrl(productGallery?.serviceUrl) === normalizedUrl
  const serversUrl = `${normalizedUrl}/${supportedVersion}/servers`
  const resources = [
    {
      id: serversUrl,
      type: McpGalleryResourceType.McpServersQueryService,
    },
    {
      id: `${serversUrl}/{name}/versions/{version}`,
      type: McpGalleryResourceType.McpServerVersionUri,
    },
    {
      id: `${serversUrl}/{name}/versions/latest`,
      type: McpGalleryResourceType.McpServerLatestVersionUri,
    },
  ]

  if (isProductGalleryUrl) {
    resources.push({
      id: `${serversUrl}/by-name/{name}`,
      type: McpGalleryResourceType.McpServerNamedResourceUri,
    })
    resources.push({
      id: productGallery.itemWebUrl,
      type: McpGalleryResourceType.McpServerWebUri,
    })
    resources.push({
      id: productGallery.publisherUrl,
      type: McpGalleryResourceType.PublisherUriTemplate,
    })
    resources.push({
      id: productGallery.supportUrl,
      type: McpGalleryResourceType.ContactSupportUri,
    })
    resources.push({
      id: productGallery.privacyPolicyUrl,
      type: McpGalleryResourceType.PrivacyPolicyUri,
    })
    resources.push({
      id: productGallery.termsOfServiceUrl,
      type: McpGalleryResourceType.TermsOfServiceUri,
    })
    resources.push({
      id: productGallery.reportUrl,
      type: McpGalleryResourceType.ReportUri,
    })
  }

  if (supportedVersion === "v0") {
    resources.push({
      id: `${serversUrl}/{id}`,
      type: McpGalleryResourceType.McpServerIdUri,
    })
  }

  return {
    version: supportedVersion,
    url: normalizedUrl,
    resources,
  }
}

function getMcpGalleryManifestResourceUri(manifest, type) {
  if (!isRecord(manifest) || !Array.isArray(manifest.resources)) return undefined
  const [name, version] = String(type || "").split("/")
  for (const resource of manifest.resources) {
    const [resourceName, resourceVersion] = String(resource?.type || "").split("/")
    if (resourceName !== name) continue
    if (!version || resourceVersion === version) return resource.id
    break
  }
  return undefined
}

function fillUriTemplate(template, values = {}) {
  if (typeof template !== "string" || !template) return ""
  return template.replace(/\{([^}]+)\}/g, (match, key) => {
    const value = values[key]
    return value === undefined || value === null ? "" : encodeURIComponent(String(value))
  })
}

function resolveMcpGalleryServerResourceUri(manifest, type, server = {}) {
  const template = getMcpGalleryManifestResourceUri(manifest, type)
  if (!template) return ""
  return fillUriTemplate(template, {
    id: server.id,
    name: server.name,
    publisher: server.publisher || server.publisherName || String(server.name || "").split(".")[0],
    version: server.version || "latest",
  })
}

module.exports = {
  McpGalleryManifestStatus,
  McpGalleryResourceType,
  SUPPORTED_VERSIONS,
  createMcpGalleryManifest,
  getConfiguredMcpGalleryProduct,
  getMcpGalleryManifestResourceUri,
  getMcpGalleryManifestStatus,
  normalizeServiceUrl,
  resolveMcpGalleryServerResourceUri,
}
