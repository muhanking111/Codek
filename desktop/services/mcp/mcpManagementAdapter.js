const {
  McpGalleryResourceType,
  createMcpGalleryManifest,
  getConfiguredMcpGalleryProduct,
  resolveMcpGalleryServerResourceUri,
} = require("./mcpGalleryManifestAdapter")

const RegistryType = Object.freeze({
  NODE: "npm",
  PYTHON: "pypi",
  DOCKER: "oci",
  NUGET: "nuget",
  MCPB: "mcpb",
  REMOTE: "remote",
})

const TransportType = Object.freeze({
  STDIO: "stdio",
  STREAMABLE_HTTP: "streamable-http",
  SSE: "sse",
})

const McpServerType = Object.freeze({
  LOCAL: "stdio",
  REMOTE: "http",
})

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function normalizeRegistryType(value) {
  switch (value) {
    case "npm":
      return RegistryType.NODE
    case "docker":
    case "docker-hub":
    case "oci":
      return RegistryType.DOCKER
    case "pypi":
      return RegistryType.PYTHON
    case "nuget":
      return RegistryType.NUGET
    case "mcpb":
      return RegistryType.MCPB
    case "remote":
      return RegistryType.REMOTE
    default:
      return RegistryType.NODE
  }
}

function normalizeTransport(transport) {
  if (!isRecord(transport)) return { type: TransportType.STDIO }
  if (transport.type === TransportType.SSE) {
    return {
      type: TransportType.SSE,
      url: typeof transport.url === "string" ? transport.url : "",
      headers: Array.isArray(transport.headers) ? transport.headers : undefined,
    }
  }
  if (transport.type === TransportType.STREAMABLE_HTTP || transport.type === "streamable") {
    return {
      type: TransportType.STREAMABLE_HTTP,
      url: typeof transport.url === "string" ? transport.url : "",
      headers: Array.isArray(transport.headers) ? transport.headers : undefined,
    }
  }
  return { type: TransportType.STDIO }
}

function getCommandName(packageType) {
  switch (packageType) {
    case RegistryType.NODE:
      return "npx"
    case RegistryType.DOCKER:
      return "docker"
    case RegistryType.PYTHON:
      return "uvx"
    case RegistryType.NUGET:
      return "dnx"
    default:
      return packageType
  }
}

function getVariables(variableInputs = {}) {
  return Object.entries(variableInputs)
    .filter(([, value]) => isRecord(value))
    .map(([key, value]) => ({
      id: key,
      type: Array.isArray(value.choices) ? "pick" : "prompt",
      description: value.description || "",
      password: !!value.isSecret || !!value.is_secret,
      default: value.default,
      options: Array.isArray(value.choices) ? value.choices : undefined,
    }))
}

function processKeyValueInputs(keyValueInputs = []) {
  const notices = []
  const inputs = {}
  const variables = []

  for (const input of Array.isArray(keyValueInputs) ? keyValueInputs : []) {
    if (!isRecord(input) || typeof input.name !== "string" || !input.name) continue
    const inputVariables = isRecord(input.variables) ? getVariables(input.variables) : []
    let value = typeof input.value === "string" ? input.value : ""

    if (inputVariables.length) {
      for (const variable of inputVariables) {
        value = value.replace(`{${variable.id}}`, `\${input:${variable.id}}`)
      }
      variables.push(...inputVariables)
    } else if (!value && (input.description || Array.isArray(input.choices) || input.default !== undefined)) {
      variables.push({
        id: input.name,
        type: Array.isArray(input.choices) ? "pick" : "prompt",
        description: input.description || "",
        password: !!input.isSecret || !!input.is_secret,
        default: input.default,
        options: Array.isArray(input.choices) ? input.choices : undefined,
      })
      value = `\${input:${input.name}}`
    }

    inputs[input.name] = value
  }

  return { inputs, variables, notices }
}

function processArguments(argumentsList = []) {
  const args = []
  const variables = []
  const notices = []

  for (const arg of Array.isArray(argumentsList) ? argumentsList : []) {
    if (!isRecord(arg)) continue
    const argVariables = isRecord(arg.variables) ? getVariables(arg.variables) : []

    if (arg.type === "positional") {
      let value = typeof arg.value === "string" ? arg.value : ""
      if (value) {
        for (const variable of argVariables) {
          value = value.replace(`{${variable.id}}`, `\${input:${variable.id}}`)
        }
        args.push(value)
        if (argVariables.length) variables.push(...argVariables)
      } else if (arg.valueHint && (arg.description || arg.default !== undefined)) {
        variables.push({
          id: arg.valueHint,
          type: "prompt",
          description: arg.description || "",
          password: false,
          default: arg.default,
        })
        args.push(`\${input:${arg.valueHint}}`)
      } else {
        args.push(arg.valueHint || "")
      }
    } else if (arg.type === "named") {
      if (!arg.name) {
        notices.push(`Named argument is missing a name. ${JSON.stringify(arg)}`)
        continue
      }
      args.push(arg.name)
      if (arg.value) {
        let value = String(arg.value)
        for (const variable of argVariables) {
          value = value.replace(`{${variable.id}}`, `\${input:${variable.id}}`)
        }
        args.push(value)
        if (argVariables.length) variables.push(...argVariables)
      } else if (arg.description || arg.default !== undefined) {
        const variableId = String(arg.name).replace(/^--?/, "")
        variables.push({
          id: variableId,
          type: "prompt",
          description: arg.description || "",
          password: false,
          default: arg.default,
        })
        args.push(`\${input:${variableId}}`)
      }
    }
  }

  return { args, variables, notices }
}

function getMcpServerConfigurationFromManifest(manifest = {}, packageType = RegistryType.NODE) {
  const normalizedPackageType = normalizeRegistryType(packageType)

  if (normalizedPackageType === RegistryType.REMOTE && Array.isArray(manifest.remotes) && manifest.remotes.length) {
    const remote = manifest.remotes[0]
    const headers = Array.isArray(remote.headers) ? remote.headers : []
    const effectiveHeaders = String(remote.url || "").startsWith("https://api.githubcopilot.com/mcp")
      ? headers.filter((header) => String(header?.name || "").toLowerCase() !== "authorization")
      : headers
    const { inputs, variables } = processKeyValueInputs(effectiveHeaders)
    return {
      notices: [],
      mcpServerConfiguration: {
        config: {
          type: McpServerType.REMOTE,
          url: remote.url,
          headers: Object.keys(inputs).length ? inputs : undefined,
        },
        inputs: variables.length ? variables : undefined,
      },
    }
  }

  const packages = Array.isArray(manifest.packages) ? manifest.packages : []
  const serverPackage = packages.find((entry) => normalizeRegistryType(entry?.registryType) === normalizedPackageType)
    || packages[0]
  if (!serverPackage) {
    throw new Error("No server package found")
  }

  const registryType = normalizeRegistryType(serverPackage.registryType)
  const args = []
  const inputs = []
  const env = {}
  const notices = []

  if (registryType === RegistryType.DOCKER) {
    args.push("run", "-i", "--rm")
  }

  if (Array.isArray(serverPackage.runtimeArguments) && serverPackage.runtimeArguments.length) {
    const result = processArguments(serverPackage.runtimeArguments)
    args.push(...result.args)
    inputs.push(...result.variables)
    notices.push(...result.notices)
  }

  if (Array.isArray(serverPackage.environmentVariables) && serverPackage.environmentVariables.length) {
    const result = processKeyValueInputs(serverPackage.environmentVariables)
    inputs.push(...result.variables)
    notices.push(...result.notices)
    for (const [name, value] of Object.entries(result.inputs)) {
      env[name] = value
      if (registryType === RegistryType.DOCKER) {
        args.push("-e", name)
      }
    }
  }

  switch (registryType) {
    case RegistryType.NODE:
      if (serverPackage.registryBaseUrl) args.push("--registry", serverPackage.registryBaseUrl)
      args.push(serverPackage.version ? `${serverPackage.identifier}@${serverPackage.version}` : serverPackage.identifier)
      break
    case RegistryType.PYTHON:
      if (serverPackage.registryBaseUrl) args.push("--index-url", serverPackage.registryBaseUrl)
      args.push(serverPackage.version ? `${serverPackage.identifier}@${serverPackage.version}` : serverPackage.identifier)
      break
    case RegistryType.DOCKER: {
      const dockerIdentifier = serverPackage.registryBaseUrl
        ? `${serverPackage.registryBaseUrl}/${serverPackage.identifier}`
        : serverPackage.identifier
      args.push(serverPackage.version ? `${dockerIdentifier}:${serverPackage.version}` : dockerIdentifier)
      break
    }
    case RegistryType.NUGET:
      args.push(serverPackage.version ? `${serverPackage.identifier}@${serverPackage.version}` : serverPackage.identifier)
      args.push("--yes")
      if (serverPackage.registryBaseUrl) args.push("--source", serverPackage.registryBaseUrl)
      if (Array.isArray(serverPackage.packageArguments) && serverPackage.packageArguments.length) args.push("--")
      break
    default:
      args.push(serverPackage.version ? `${serverPackage.identifier}@${serverPackage.version}` : serverPackage.identifier)
      break
  }

  if (Array.isArray(serverPackage.packageArguments) && serverPackage.packageArguments.length) {
    const result = processArguments(serverPackage.packageArguments)
    args.push(...result.args)
    inputs.push(...result.variables)
    notices.push(...result.notices)
  }

  return {
    notices,
    mcpServerConfiguration: {
      config: {
        type: McpServerType.LOCAL,
        command: getCommandName(registryType),
        args: args.length ? args : undefined,
        env: Object.keys(env).length ? env : undefined,
      },
      inputs: inputs.length ? inputs : undefined,
    },
  }
}

function inferPackageType(configuration = {}) {
  if (Array.isArray(configuration.remotes) && configuration.remotes.length) return RegistryType.REMOTE
  const firstPackage = Array.isArray(configuration.packages) ? configuration.packages[0] : null
  return normalizeRegistryType(firstPackage?.registryType)
}

function toInstallableMcpServerFromGallery(galleryServer, options = {}) {
  if (!isRecord(galleryServer) || !galleryServer.name || !isRecord(galleryServer.configuration)) return null
  const packageType = normalizeRegistryType(options.packageType || galleryServer.packageType || inferPackageType(galleryServer.configuration))
  const parsed = getMcpServerConfigurationFromManifest(galleryServer.configuration, packageType)
  const productGallery = options.productGallery === undefined ? getConfiguredMcpGalleryProduct() : options.productGallery
  const manifest = options.manifest || (productGallery?.serviceUrl
    ? createMcpGalleryManifest(productGallery.serviceUrl, options.galleryVersion, productGallery)
    : null)
  const resourceGalleryUrl = manifest
    ? resolveMcpGalleryServerResourceUri(manifest, McpGalleryResourceType.McpServerWebUri, galleryServer)
    : ""
  const gallery = galleryServer.galleryUrl || galleryServer.webUrl || resourceGalleryUrl || true
  return {
    name: String(options.name || galleryServer.name),
    displayName: galleryServer.displayName || galleryServer.name,
    description: galleryServer.description || "",
    version: galleryServer.version,
    gallery,
    galleryId: galleryServer.id,
    galleryUrl: galleryServer.galleryUrl || "",
    resourceGalleryUrl,
    repositoryUrl: galleryServer.repositoryUrl || "",
    config: {
      ...parsed.mcpServerConfiguration.config,
      version: galleryServer.version,
      gallery,
    },
    inputs: parsed.mcpServerConfiguration.inputs || [],
    notices: parsed.notices || [],
  }
}

function collectGalleryServerCandidates(record = {}) {
  const candidates = []
  for (const key of ["mcpGalleryServer", "galleryMcpServer", "mcpGallery"]) {
    if (isRecord(record[key])) candidates.push(record[key])
  }
  for (const key of ["mcpGalleryServers", "galleryMcpServers"]) {
    if (Array.isArray(record[key])) candidates.push(...record[key].filter(isRecord))
  }
  if (isRecord(record.gallery) && isRecord(record.gallery.mcpServer)) candidates.push(record.gallery.mcpServer)
  return candidates
}

function getInstallableMcpServersFromInstalledRecord(record = {}, options = {}) {
  return collectGalleryServerCandidates(record)
    .map((server) => toInstallableMcpServerFromGallery(server, options))
    .filter(Boolean)
}

module.exports = {
  McpServerType,
  RegistryType,
  TransportType,
  getInstallableMcpServersFromInstalledRecord,
  getMcpServerConfigurationFromManifest,
  inferPackageType,
  normalizeRegistryType,
  normalizeTransport,
  toInstallableMcpServerFromGallery,
}
