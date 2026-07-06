/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code MCP gallery service:
 * - D:\SourceMirror\vscode\src\vs\platform\mcp\common\mcpGalleryService.ts
 *--------------------------------------------------------------------------------------------*/

const fs = require("node:fs/promises")
const {
  McpGalleryManifestStatus,
  McpGalleryResourceType,
  createMcpGalleryManifest,
  getConfiguredMcpGalleryProduct,
  getMcpGalleryManifestResourceUri,
} = require("./mcpGalleryManifestAdapter")

const DefaultPageSize = 50
const McpServerSchema2025 = "https://static.modelcontextprotocol.io/schemas/2025-07-09/server.schema.json"

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function isString(value) {
  return typeof value === "string" && value.length > 0
}

function uppercaseFirstLetter(value) {
  const text = String(value || "")
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : ""
}

function titleFromName(value) {
  return String(value || "")
    .split("-")
    .map((part) => {
      const lower = part.toLowerCase()
      if (lower === "mcp") return "MCP"
      if (lower === "github") return "GitHub"
      return uppercaseFirstLetter(lower)
    })
    .join(" ")
}

function formatTemplate(template, values = {}) {
  return String(template || "").replace(/\{([^}]+)\}/g, (_match, key) => {
    const value = values[key]
    return value === undefined || value === null ? "" : String(value)
  })
}

function encodeTemplateName(name) {
  return encodeURIComponent(String(name || ""))
}

function normalizeRegistryType(value) {
  switch (value) {
    case "npm":
      return "npm"
    case "docker":
    case "docker-hub":
    case "oci":
      return "oci"
    case "pypi":
      return "pypi"
    case "nuget":
      return "nuget"
    case "remote":
      return "remote"
    case "mcpb":
      return "mcpb"
    default:
      return "npm"
  }
}

function normalizeTransport(input = {}) {
  const type = input.type || input.transport_type || input.transport
  if (type === "sse") {
    return { type: "sse", url: input.url, headers: normalizeKeyValueInputs(input.headers) }
  }
  if (type === "streamable" || type === "streamable-http") {
    return { type: "streamable-http", url: input.url, headers: normalizeKeyValueInputs(input.headers) }
  }
  return { type: "stdio" }
}

function normalizeInput(input = {}) {
  return {
    ...input,
    isRequired: input.isRequired ?? input.is_required,
    isSecret: input.isSecret ?? input.is_secret,
  }
}

function normalizeVariables(variables) {
  if (!isRecord(variables)) return undefined
  return Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, normalizeInput(value)]))
}

function normalizeArgument(arg = {}) {
  if (arg.type === "positional") {
    return {
      ...arg,
      valueHint: arg.valueHint ?? arg.value_hint,
      isRepeated: arg.isRepeated ?? arg.is_repeated,
      isRequired: arg.isRequired ?? arg.is_required,
      isSecret: arg.isSecret ?? arg.is_secret,
      variables: normalizeVariables(arg.variables),
    }
  }
  return {
    ...arg,
    isRepeated: arg.isRepeated ?? arg.is_repeated,
    isRequired: arg.isRequired ?? arg.is_required,
    isSecret: arg.isSecret ?? arg.is_secret,
    variables: normalizeVariables(arg.variables),
  }
}

function normalizeKeyValueInputs(inputs) {
  if (!Array.isArray(inputs)) return undefined
  return inputs.map((input) => ({
    ...normalizeInput(input),
    variables: normalizeVariables(input.variables),
  }))
}

function normalizePackage(input = {}) {
  return {
    identifier: input.identifier ?? input.name,
    registryType: normalizeRegistryType(input.registryType ?? input.registry_type ?? input.registry_name),
    version: input.version,
    fileSha256: input.fileSha256 ?? input.file_sha256,
    registryBaseUrl: input.registryBaseUrl ?? input.registry_base_url,
    transport: input.transport ? normalizeTransport(input.transport) : { type: "stdio" },
    packageArguments: Array.isArray(input.packageArguments)
      ? input.packageArguments.map(normalizeArgument)
      : Array.isArray(input.package_arguments)
        ? input.package_arguments.map(normalizeArgument)
        : undefined,
    runtimeHint: input.runtimeHint ?? input.runtime_hint,
    runtimeArguments: Array.isArray(input.runtimeArguments)
      ? input.runtimeArguments.map(normalizeArgument)
      : Array.isArray(input.runtime_arguments)
        ? input.runtime_arguments.map(normalizeArgument)
        : undefined,
    environmentVariables: normalizeKeyValueInputs(input.environmentVariables ?? input.environment_variables),
  }
}

function serializeV0_1Server(input) {
  if (!isRecord(input) || !isRecord(input.server)) return undefined
  const server = input.server
  if (!isString(server.name) || !isString(server.description) || !isString(server.version)) return undefined
  const registryInfo = input._meta?.["io.modelcontextprotocol.registry/official"]
  const publisherMeta = server._meta?.["io.modelcontextprotocol.registry/publisher-provided"] || {}
  return {
    name: server.name,
    description: server.description,
    version: server.version,
    title: server.title,
    repository: isRecord(server.repository) ? {
      url: server.repository.url,
      source: server.repository.source,
      id: server.repository.id,
    } : undefined,
    readme: publisherMeta.github?.readme,
    icons: server.icons,
    websiteUrl: server.websiteUrl,
    packages: Array.isArray(server.packages) ? server.packages.map(normalizePackage) : undefined,
    remotes: Array.isArray(server.remotes) ? server.remotes.map(normalizeTransport) : undefined,
    status: registryInfo?.status,
    registryInfo,
    githubInfo: publisherMeta.github,
    apicInfo: input._meta ? Object.fromEntries(Object.entries(input._meta).filter(([key]) => key !== "io.modelcontextprotocol.registry/official")) : undefined,
  }
}

function serialize2025Server(input) {
  if (!isRecord(input)) return undefined
  if (input.$schema && input.$schema !== McpServerSchema2025) return undefined
  if (!isString(input.name) || !isString(input.description) || !isString(input.version)) return undefined
  const registryInfo = input._meta?.["io.modelcontextprotocol.registry/official"] || {}
  const publisherMeta = input._meta?.["io.modelcontextprotocol.registry/publisher-provided"] || {}
  return {
    id: registryInfo.id,
    name: input.name,
    description: input.description,
    repository: isRecord(input.repository) ? {
      url: input.repository.url,
      source: input.repository.source,
      id: input.repository.id,
    } : undefined,
    readme: input.repository?.readme,
    version: input.version,
    createdAt: input.created_at,
    updatedAt: input.updated_at,
    packages: Array.isArray(input.packages) ? input.packages.map(normalizePackage) : undefined,
    remotes: Array.isArray(input.remotes) ? input.remotes.map(normalizeTransport) : undefined,
    registryInfo: {
      isLatest: registryInfo.is_latest,
      publishedAt: registryInfo.published_at,
      updatedAt: registryInfo.updated_at,
    },
    githubInfo: publisherMeta.github ? {
      name: publisherMeta.github.name,
      nameWithOwner: publisherMeta.github.name_with_owner,
      displayName: publisherMeta.github.display_name,
      isInOrganization: publisherMeta.github.is_in_organization,
      license: publisherMeta.github.license,
      opengraphImageUrl: publisherMeta.github.opengraph_image_url,
      ownerAvatarUrl: publisherMeta.github.owner_avatar_url,
      preferredImage: publisherMeta.github.preferred_image,
      primaryLanguage: publisherMeta.github.primary_language,
      primaryLanguageColor: publisherMeta.github.primary_language_color,
      pushedAt: publisherMeta.github.pushed_at,
      readme: publisherMeta.github.readme,
      stargazerCount: publisherMeta.github.stargazer_count,
      topics: publisherMeta.github.topics,
      usesCustomOpengraphImage: publisherMeta.github.uses_custom_opengraph_image,
    } : undefined,
  }
}

function serializeGalleryServer(input, manifest) {
  const version = manifest?.version || "v0"
  if (version === "v0.1") return serializeV0_1Server(input)
  return serializeV0_1Server(input) || serialize2025Server(input)
}

function serializeGalleryServerResult(input, manifest) {
  if (!isRecord(input) || !Array.isArray(input.servers)) return undefined
  const servers = []
  for (const entry of input.servers) {
    const server = serializeGalleryServer(entry, manifest)
    if (!server) {
      if (servers.length === 0) return undefined
      continue
    }
    servers.push(server)
  }
  const metadata = input.metadata || {}
  return {
    metadata: {
      count: Number(metadata.count || 0),
      nextCursor: metadata.nextCursor || metadata.next_cursor,
    },
    servers,
  }
}

function publisherFromServer(server) {
  if (server.githubInfo?.nameWithOwner) return String(server.githubInfo.nameWithOwner).split("/")[0] || ""
  const nameParts = String(server.name || "").split("/")
  const domainParts = String(nameParts[0] || "").split(".")
  return domainParts[domainParts.length - 1] || ""
}

function toGalleryMcpServer(server, manifest = null) {
  const publisher = publisherFromServer(server)
  let displayName = server.title
  if (!displayName && server.githubInfo?.name) displayName = titleFromName(server.githubInfo.name)
  if (!displayName) {
    const nameParts = String(server.name || "").split("/")
    displayName = titleFromName(nameParts[nameParts.length - 1])
  }
  if (server.githubInfo?.displayName) displayName = server.githubInfo.displayName

  const webTemplate = manifest ? getMcpGalleryManifestResourceUri(manifest, McpGalleryResourceType.McpServerWebUri) : ""
  const publisherTemplate = manifest ? getMcpGalleryManifestResourceUri(manifest, McpGalleryResourceType.PublisherUriTemplate) : ""
  const icon = resolveIcon(server)

  return {
    id: server.id,
    name: server.name,
    displayName,
    galleryUrl: manifest?.url,
    webUrl: webTemplate ? formatTemplate(webTemplate, { name: server.name }) : undefined,
    description: server.description,
    status: server.status || "active",
    version: server.version,
    isLatest: server.registryInfo?.isLatest ?? true,
    publishDate: server.registryInfo?.publishedAt ? Date.parse(server.registryInfo.publishedAt) : undefined,
    lastUpdated: server.githubInfo?.pushedAt ? Date.parse(server.githubInfo.pushedAt) : server.registryInfo?.updatedAt ? Date.parse(server.registryInfo.updatedAt) : undefined,
    repositoryUrl: server.repository?.url,
    readme: server.readme,
    readmeUrl: server.readme,
    icon,
    publisher,
    publisherUrl: publisherTemplate ? formatTemplate(publisherTemplate, { name: publisher, publisher }) : undefined,
    license: server.githubInfo?.license,
    starsCount: server.githubInfo?.stargazerCount,
    topics: server.githubInfo?.topics,
    configuration: {
      packages: server.packages,
      remotes: server.remotes,
    },
  }
}

function resolveIcon(server) {
  const image = server.githubInfo?.preferredImage || server.githubInfo?.ownerAvatarUrl || server.apicInfo?.["x-ms-icon"]
  if (image) return { light: image, dark: image }
  if (!Array.isArray(server.icons) || !server.icons.length) return undefined
  const light = server.icons.find((icon) => icon.theme === "light") || server.icons[0]
  const dark = server.icons.find((icon) => icon.theme === "dark") || light
  return { light: light.src, dark: dark.src }
}

function getConfiguredManifest(options = {}) {
  if (options.manifest) return options.manifest
  const productGallery = options.productGallery === undefined ? getConfiguredMcpGalleryProduct(options) : options.productGallery
  return productGallery?.serviceUrl ? createMcpGalleryManifest(productGallery.serviceUrl, options.version, productGallery) : null
}

function isEnabled(options = {}) {
  return getConfiguredManifest(options) ? McpGalleryManifestStatus.Available : McpGalleryManifestStatus.Unavailable
}

async function fetchJson(url, options = {}) {
  const response = await (options.fetchImpl || fetch)(url, {})
  if (response.status >= 400 && response.status < 500) return undefined
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  if (typeof response.json === "function") return response.json()
  const text = typeof response.text === "function" ? await response.text() : ""
  return text ? JSON.parse(text) : undefined
}

async function readFileUri(uri, options = {}) {
  const filePath = String(uri || "").replace(/^file:\/\//, "")
  if (typeof options.fileReader === "function") return options.fileReader(filePath)
  return fs.readFile(decodeURIComponent(filePath), "utf8")
}

async function queryRawGalleryMcpServers(query, manifest, options = {}) {
  const resourceUrl = getMcpGalleryManifestResourceUri(manifest, McpGalleryResourceType.McpServersQueryService)
  if (!resourceUrl) return { servers: [], metadata: { count: 0 } }

  if (resourceUrl.startsWith("file://")) {
    try {
      return JSON.parse(await readFileUri(resourceUrl, options))
    } catch {
      return { servers: [], metadata: { count: 0 } }
    }
  }

  const url = new URL(resourceUrl)
  url.searchParams.set("limit", String(query.pageSize || DefaultPageSize))
  url.searchParams.set("version", "latest")
  if (query.cursor) url.searchParams.set("cursor", query.cursor)
  if (query.searchText) url.searchParams.set("search", query.searchText)

  try {
    const data = await fetchJson(url.toString(), options)
    if (!data) return { servers: [], metadata: { count: 0 } }
    const result = serializeGalleryServerResult(data, manifest)
    if (!result) throw new Error(`Failed to serialize MCP servers result from ${resourceUrl}`)
    return result
  } catch (error) {
    if (options.throwOnError) throw error
    return { servers: [], metadata: { count: 0 }, error: error.message }
  }
}

async function queryMcpGallery(queryOptions = {}, options = {}) {
  const manifest = getConfiguredManifest(options)
  if (!manifest) {
    return {
      firstPage: { items: [], hasMore: false },
      getNextPage: async () => ({ items: [], hasMore: false }),
    }
  }
  const query = {
    pageSize: Math.max(1, Number(queryOptions.pageSize || queryOptions.limit || DefaultPageSize)),
    searchText: typeof queryOptions.text === "string" ? queryOptions.text.trim() : "",
  }
  const first = await queryRawGalleryMcpServers(query, manifest, options)
  let currentCursor = first.metadata.nextCursor
  return {
    firstPage: {
      items: first.servers.map((server) => toGalleryMcpServer(server, manifest)),
      hasMore: Boolean(currentCursor),
    },
    getNextPage: async () => {
      if (!currentCursor) return { items: [], hasMore: false }
      const next = await queryRawGalleryMcpServers({ pageSize: query.pageSize, cursor: currentCursor }, manifest, options)
      currentCursor = next.metadata.nextCursor
      return {
        items: next.servers.map((server) => toGalleryMcpServer(server, manifest)),
        hasMore: Boolean(currentCursor),
      }
    },
  }
}

async function getMcpServer(url, options = {}) {
  const data = await fetchJson(url, options)
  if (!data) return undefined
  const manifest = options.manifest && url.startsWith(options.manifest.url) ? options.manifest : getConfiguredManifest(options)
  const server = serializeGalleryServer(data, manifest)
  if (!server) throw new Error(`Failed to serialize MCP server from ${url}`)
  return toGalleryMcpServer(server, manifest)
}

async function getMcpServersFromGallery(infos = [], options = {}) {
  const manifest = getConfiguredManifest(options)
  if (!manifest) return []
  const servers = []
  await Promise.allSettled(infos.map(async (info) => {
    const server = await getMcpServerByName(info, manifest, options)
    if (server) servers.push(server)
  }))
  return servers
}

async function getMcpServerByName(info = {}, manifest, options = {}) {
  const name = String(info.name || "")
  const id = info.id
  const latest = getTemplateUrl(manifest, McpGalleryResourceType.McpServerLatestVersionUri, { name: encodeTemplateName(name) })
  if (latest) {
    const server = await getMcpServer(latest, { ...options, manifest })
    if (server) return server
  }
  const byName = getTemplateUrl(manifest, McpGalleryResourceType.McpServerNamedResourceUri, { name })
  if (byName) {
    const server = await getMcpServer(byName, { ...options, manifest })
    if (server) return server
  }
  const byId = id ? getTemplateUrl(manifest, McpGalleryResourceType.McpServerIdUri, { id }) : ""
  if (byId) {
    const server = await getMcpServer(byId, { ...options, manifest })
    if (server) return server
  }
  return undefined
}

function getTemplateUrl(manifest, type, values) {
  const template = getMcpGalleryManifestResourceUri(manifest, type)
  return template ? formatTemplate(template, values) : ""
}

async function getMcpGalleryReadme(gallery = {}, options = {}) {
  const readmeUrl = gallery.readmeUrl || gallery.readme
  if (!readmeUrl) return "No README available"
  if (String(readmeUrl).startsWith("file://")) {
    try {
      return await readFileUri(readmeUrl, options)
    } catch {
      return "No README available"
    }
  }
  let authority = ""
  try {
    authority = new URL(readmeUrl).host
  } catch {
    return "No README available"
  }
  if (authority !== "raw.githubusercontent.com") {
    return `You can find information about this server [here](${readmeUrl})`
  }
  const response = await (options.fetchImpl || fetch)(readmeUrl, {})
  const text = typeof response.text === "function" ? await response.text() : ""
  if (!text) throw new Error(`Failed to fetch README from ${readmeUrl}`)
  return text
}

module.exports = {
  DefaultPageSize,
  getConfiguredManifest,
  getMcpGalleryReadme,
  getMcpServer,
  getMcpServersFromGallery,
  isEnabled,
  queryMcpGallery,
  serializeGalleryServer,
  serializeGalleryServerResult,
  toGalleryMcpServer,
}
