/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code MCP management service:
 * - D:\SourceMirror\vscode\src\vs\platform\mcp\common\mcpManagement.ts
 * - D:\SourceMirror\vscode\src\vs\platform\mcp\common\mcpManagementService.ts
 *--------------------------------------------------------------------------------------------*/

const {
  getExtensionInstallRecord,
  listExtensionInstallStates,
  safeName,
  updateExtensionInstallRecord,
} = require("../extensions-host/extensionInstallState")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { EventEmitter } = require("node:events")
const { allowedMcpServersService } = require("./mcpAccess")
const {
  getInstallableMcpServersFromInstalledRecord,
  toInstallableMcpServerFromGallery,
} = require("./mcpManagementAdapter")

const GALLERY_SOURCE = "mcp-gallery"
const GALLERY_EXTENSION_ID_PREFIX = "mcp-gallery."
const lifecycleEvents = new EventEmitter()

function onLifecycleEvent(eventName, listener) {
  lifecycleEvents.on(eventName, listener)
  return {
    dispose() {
      lifecycleEvents.off(eventName, listener)
    },
  }
}

function onInstallMcpServer(listener) {
  return onLifecycleEvent("install:start", listener)
}

function onDidInstallMcpServers(listener) {
  return onLifecycleEvent("install:did", listener)
}

function onDidUpdateMcpServers(listener) {
  return onLifecycleEvent("update:did", listener)
}

function onUninstallMcpServer(listener) {
  return onLifecycleEvent("uninstall:start", listener)
}

function onDidUninstallMcpServer(listener) {
  return onLifecycleEvent("uninstall:did", listener)
}

function mcpResourceFromOptions(options = {}) {
  return options.mcpResource || options.workspaceFile || options.workspaceResource || options.resourcePath || options.mcpResourcePath || ""
}

function defaultMetadataRoot(options = {}) {
  const base = options.codekData || process.env.CODEK_DATA || path.join(os.homedir(), ".codek")
  return path.join(base, "User", "mcp")
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function nowIso(options = {}) {
  return typeof options.now === "function" ? options.now() : new Date().toISOString()
}

function normalizeGalleryName(value) {
  return String(value || "").trim()
}

function galleryInstallId(serverOrName) {
  const name = normalizeGalleryName(isRecord(serverOrName) ? serverOrName.name : serverOrName)
  if (!name) throw new Error("MCP gallery server name is required")
  return `${GALLERY_EXTENSION_ID_PREFIX}${safeName(name)}`
}

function galleryMetadataLocation(galleryServer, options = {}) {
  const name = normalizeGalleryName(galleryServer?.name).replace("/", ".")
  if (!name) throw new Error("MCP gallery server name is required")
  const version = normalizeGalleryName(galleryServer?.version)
  return path.join(options.metadataRoot || defaultMetadataRoot(options), version ? `${name}-${version}` : name)
}

function normalizeLocalServer(installable, record = {}) {
  return {
    name: installable.name,
    config: { ...installable.config },
    inputs: Array.isArray(installable.inputs) ? installable.inputs.map((input) => ({ ...input })) : [],
    version: installable.version || installable.config?.version,
    displayName: installable.displayName,
    description: installable.description,
    galleryUrl: typeof installable.gallery === "string" ? installable.gallery : installable.galleryUrl || installable.resourceGalleryUrl,
    galleryId: installable.galleryId,
    repositoryUrl: installable.repositoryUrl,
    readme: record.mcpGalleryServerReadme,
    readmeUrl: record.mcpGalleryServer?.readmeUrl || record.mcpGalleryServer?.readme,
    manifest: record.mcpGalleryServer?.configuration,
    location: record.installPath || "",
    source: "gallery",
  }
}

function recordToLocalServers(record = {}, options = {}) {
  if (!record || record.enabled === false || record.status === "failed" || record.status === "uninstalled") return []
  return getInstallableMcpServersFromInstalledRecord(record, options)
    .map((server) => normalizeLocalServer(server, record))
}

function getInstalledGalleryMcpServers(options = {}) {
  return listExtensionInstallStates(options)
    .flatMap((record) => recordToLocalServers(record, options))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
}

function canInstallGalleryMcpServer(server, options = {}) {
  const service = options.allowedMcpServersService || allowedMcpServersService
  const allowed = service?.isAllowed ? service.isAllowed(server) : true
  if (allowed === true) return true
  return {
    value: `This mcp server cannot be installed because ${allowed?.value || "MCP access is disabled."}`,
    settingsCommand: allowed?.settingsCommand,
    settingsQuery: allowed?.settingsQuery,
  }
}

async function resolveGalleryReadme(galleryServer, options = {}) {
  if (typeof galleryServer.readme === "string" && galleryServer.readme) return galleryServer.readme
  if (typeof galleryServer.readmeContent === "string" && galleryServer.readmeContent) return galleryServer.readmeContent
  if ((galleryServer.readmeUrl || galleryServer.readme) && typeof options.getReadme === "function") {
    try {
      return await options.getReadme(galleryServer)
    } catch {
      return ""
    }
  }
  return ""
}

function galleryManifestInfo(galleryServer, readme, location) {
  return {
    galleryUrl: galleryServer.galleryUrl,
    galleryId: galleryServer.id,
    name: galleryServer.name,
    displayName: galleryServer.displayName,
    description: galleryServer.description,
    version: galleryServer.version,
    publisher: galleryServer.publisher,
    publisherDisplayName: galleryServer.publisherDisplayName,
    repositoryUrl: galleryServer.repositoryUrl,
    licenseUrl: galleryServer.license,
    icon: galleryServer.icon,
    codicon: galleryServer.codicon,
    manifest: galleryServer.configuration,
    readmeUrl: readme ? path.join(location, "README.md") : undefined,
    location,
  }
}

function writeGalleryMetadata(galleryServer, readme, options = {}) {
  const location = galleryMetadataLocation(galleryServer, options)
  fs.mkdirSync(location, { recursive: true })
  fs.writeFileSync(path.join(location, "manifest.json"), `${JSON.stringify(galleryManifestInfo(galleryServer, readme, location), null, 2)}\n`, "utf8")
  if (readme) {
    fs.writeFileSync(path.join(location, "README.md"), readme, "utf8")
  }
  return location
}

function removeGalleryMetadata(location, options = {}) {
  if (!location || typeof location !== "string") return false
  const root = path.resolve(options.metadataRoot || defaultMetadataRoot(options))
  const target = path.resolve(location)
  if (target !== root && target.startsWith(`${root}${path.sep}`) && fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true })
    return true
  }
  return false
}

async function patchForGalleryServer(galleryServer, local, options = {}) {
  const installedAt = options.installedAt || nowIso(options)
  const readme = await resolveGalleryReadme(galleryServer, options)
  const location = writeGalleryMetadata(galleryServer, readme, options)
  return {
    status: "installed",
    phase: "done",
    source: GALLERY_SOURCE,
    enabled: true,
    version: galleryServer.version || local.version || "",
    installPath: location,
    installedAt,
    lastError: "",
    mcpGalleryServer: {
      ...galleryServer,
      configuration: galleryServer.configuration,
    },
    mcpGalleryServerReadme: readme,
    mcpGalleryServerLocal: {
      name: local.name,
      config: local.config,
      inputs: local.inputs,
      notices: local.notices,
    },
  }
}

async function installGalleryMcpServer(galleryServer, options = {}) {
  if (!isRecord(galleryServer)) throw new Error("MCP gallery server is required")
  const allowed = canInstallGalleryMcpServer(galleryServer, options)
  if (allowed !== true) throw new Error(allowed.value || "MCP gallery server install is not allowed")
  const installable = toInstallableMcpServerFromGallery(galleryServer, options)
  if (!installable) throw new Error(`MCP gallery server is not installable: ${galleryServer.name || ""}`)
  const id = options.extensionId || galleryInstallId(galleryServer)
  const mcpResource = mcpResourceFromOptions(options)
  lifecycleEvents.emit("install:start", { name: installable.name, mcpResource, source: galleryServer })
  try {
    const record = updateExtensionInstallRecord(id, await patchForGalleryServer(galleryServer, installable, options), {
      ...options,
      updatedAt: nowIso(options),
    })
    const local = normalizeLocalServer(installable, record)
    lifecycleEvents.emit("install:did", [{ name: installable.name, local, mcpResource, source: galleryServer }])
    return local
  } catch (error) {
    lifecycleEvents.emit("install:did", [{ name: installable.name, error, mcpResource, source: galleryServer }])
    throw error
  }
}

function findRecordForGalleryServer(serverOrName, options = {}) {
  const name = normalizeGalleryName(isRecord(serverOrName) ? serverOrName.name : serverOrName)
  if (!name) return null
  const directId = galleryInstallId(name)
  const direct = getExtensionInstallRecord(directId, options)
  if (direct?.mcpGalleryServer?.name === name) return { id: directId, record: direct }
  for (const record of listExtensionInstallStates(options)) {
    if (record?.mcpGalleryServer?.name === name) return { id: record.id, record }
    if (Array.isArray(record?.mcpGalleryServers) && record.mcpGalleryServers.some((server) => server?.name === name)) {
      return { id: record.id, record }
    }
  }
  return null
}

async function updateGalleryMcpServerMetadata(localOrName, galleryServer, options = {}) {
  if (!isRecord(galleryServer)) throw new Error("MCP gallery server is required")
  const found = findRecordForGalleryServer(localOrName || galleryServer, options)
  const id = found?.id || options.extensionId || galleryInstallId(galleryServer)
  const installable = toInstallableMcpServerFromGallery(galleryServer, options)
  if (!installable) throw new Error(`MCP gallery server is not installable: ${galleryServer.name || ""}`)
  const previous = found?.record || {}
  const mcpResource = mcpResourceFromOptions(options)
  try {
    const record = updateExtensionInstallRecord(id, {
      ...previous,
      ...await patchForGalleryServer(galleryServer, installable, {
        ...options,
        installedAt: previous.installedAt || nowIso(options),
      }),
      metadataUpdatedAt: nowIso(options),
    }, {
      ...options,
      updatedAt: nowIso(options),
    })
    const local = normalizeLocalServer(installable, record)
    lifecycleEvents.emit("update:did", [{ name: installable.name, local, mcpResource, source: galleryServer }])
    return local
  } catch (error) {
    lifecycleEvents.emit("update:did", [{ name: installable.name, error, mcpResource, source: galleryServer }])
    throw error
  }
}

async function uninstallGalleryMcpServer(serverOrName, options = {}) {
  const found = findRecordForGalleryServer(serverOrName, options)
  if (!found) return { uninstalled: false }
  const { id, record } = found
  const name = normalizeGalleryName(isRecord(serverOrName) ? serverOrName.name : serverOrName)
  const mcpResource = mcpResourceFromOptions(options)
  lifecycleEvents.emit("uninstall:start", { name, mcpResource })

  try {
    if (record.source === GALLERY_SOURCE || id.startsWith(GALLERY_EXTENSION_ID_PREFIX)) {
      removeGalleryMetadata(record.installPath, options)
      updateExtensionInstallRecord(id, {
        status: "uninstalled",
        phase: "done",
        enabled: false,
        uninstalledAt: nowIso(options),
        lastError: "",
        mcpGalleryServer: undefined,
        mcpGalleryServerReadme: undefined,
        mcpGalleryServerLocal: undefined,
      }, {
        ...options,
        updatedAt: nowIso(options),
      })
      lifecycleEvents.emit("uninstall:did", { name, mcpResource })
      return { uninstalled: true, id }
    }

    if (Array.isArray(record.mcpGalleryServers)) {
      updateExtensionInstallRecord(id, {
        mcpGalleryServers: record.mcpGalleryServers.filter((server) => server?.name !== name),
        metadataUpdatedAt: nowIso(options),
      }, {
        ...options,
        updatedAt: nowIso(options),
      })
      lifecycleEvents.emit("uninstall:did", { name, mcpResource })
      return { uninstalled: true, id }
    }

    lifecycleEvents.emit("uninstall:did", { name, mcpResource })
    return { uninstalled: false, id }
  } catch (error) {
    lifecycleEvents.emit("uninstall:did", { name, error, mcpResource })
    throw error
  }
}

module.exports = {
  GALLERY_EXTENSION_ID_PREFIX,
  GALLERY_SOURCE,
  canInstallGalleryMcpServer,
  defaultMetadataRoot,
  galleryInstallId,
  galleryMetadataLocation,
  getInstalledGalleryMcpServers,
  installGalleryMcpServer,
  onDidInstallMcpServers,
  onDidUninstallMcpServer,
  onDidUpdateMcpServers,
  onInstallMcpServer,
  onUninstallMcpServer,
  removeGalleryMetadata,
  recordToLocalServers,
  uninstallGalleryMcpServer,
  updateGalleryMcpServerMetadata,
  writeGalleryMetadata,
}
