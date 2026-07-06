/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code storage/memento flow:
 * - D:\SourceMirror\vscode\src\vs\workbench\api\browser\mainThreadStorage.ts
 * - D:\SourceMirror\vscode\src\vs\workbench\api\common\extHostStorage.ts
 * - D:\SourceMirror\vscode\src\vs\platform\extensionManagement\common\extensionStorage.ts
 *--------------------------------------------------------------------------------------------*/

const path = require("path")
const fs = require("fs")
const userDataProfile = require("../../userDataProfile")

const CODEK_DATA = process.env.CODEK_DATA || path.join(require("os").homedir(), ".codek")
const LEGACY_STORAGE_FILE = path.join(CODEK_DATA, "ext-host-storage.json")
const EXT_HOST_STORAGE_NID = 125
const LARGE_STATE_WARNING_THRESHOLD = 512 * 1024

let legacyStorageCache = null
let currentWorkspace = ""

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function normalizeExtensionId(value) {
  return typeof value === "string" ? value.trim() : ""
}

function adoptToGalleryExtensionId(id) {
  return normalizeExtensionId(id).toLowerCase()
}

function extensionKeysStorageKey(extension) {
  const id = adoptToGalleryExtensionId(extension?.id)
  const version = typeof extension?.version === "string" ? extension.version.trim() : ""
  return id && version ? `extensionKeys/${id}@${version}` : ""
}

function normalizeWorkspace(value) {
  const raw = typeof value === "string" ? value.trim() : ""
  if (raw) return userDataProfile.normalizeWorkspaceKey(raw)
  const fallback = typeof currentWorkspace === "string" ? currentWorkspace.trim() : ""
  return fallback ? userDataProfile.normalizeWorkspaceKey(fallback) : ""
}

function workspaceStorageKey(extensionId, workspace) {
  const normalizedWorkspace = normalizeWorkspace(workspace) || "file:///__codek__/default-workspace"
  return `workspace/${normalizedWorkspace}/${extensionId}`
}

function getCurrentProfileId(options = {}) {
  if (typeof options.getCurrentProfileId === "function") {
    const id = normalizeExtensionId(options.getCurrentProfileId())
    if (id) return id
  }
  const workspace = normalizeWorkspace(options.workspace)
  const state = userDataProfile.readWorkbenchProfileState({ workspace })
  return state.workspaceProfileId || state.activeProfileId || userDataProfile.DEFAULT_PROFILE_ID
}

function readProfileStorage(profileId, options = {}) {
  return userDataProfile.readProfileStorageData(profileId || getCurrentProfileId(options))
}

function parseStoredValue(entry) {
  if (!entry || typeof entry.value !== "string") return undefined
  return entry.value
}

function safeStringifyValue(value) {
  if (value === undefined) return undefined
  return JSON.stringify(isObject(value) || Array.isArray(value) ? value : {})
}

function loadLegacyStorage() {
  if (legacyStorageCache) return legacyStorageCache
  try {
    if (fs.existsSync(LEGACY_STORAGE_FILE)) {
      const raw = fs.readFileSync(LEGACY_STORAGE_FILE, "utf8")
      const parsed = JSON.parse(raw)
      legacyStorageCache = isObject(parsed) ? parsed : {}
      return legacyStorageCache
    }
  } catch (error) {
    console.error("[main-thread:storage] Failed to load legacy storage:", error.message)
  }
  legacyStorageCache = {}
  return legacyStorageCache
}

function getLegacyScope(shared) {
  return shared ? "_global" : "_workspace"
}

function getLegacyExtensionValue(shared, extensionId) {
  const store = loadLegacyStorage()
  const scope = getLegacyScope(shared)
  return isObject(store[scope]) ? store[scope][extensionId] : undefined
}

function migrateLegacyValueIfNeeded(shared, extensionId, options = {}) {
  const legacyValue = getLegacyExtensionValue(shared, extensionId)
  if (legacyValue === undefined) return undefined
  const rawValue = safeStringifyValue(legacyValue)
  if (rawValue === undefined) return undefined
  setExtensionRawValue(shared, extensionId, rawValue, {
    ...options,
    notifyExtHost: false,
    changeReason: "extension-storage:migrate",
  })
  return rawValue
}

function getStorageKey(shared, extensionId, options = {}) {
  return shared ? extensionId : workspaceStorageKey(extensionId, options.workspace)
}

function getExtensionRawValue(shared, extensionId, options = {}) {
  const id = normalizeExtensionId(extensionId)
  if (!id) return undefined
  const profileId = getCurrentProfileId(options)
  const storageKey = getStorageKey(Boolean(shared), id, options)
  const snapshot = readProfileStorage(profileId, options)
  const rawValue = parseStoredValue(snapshot.entries[storageKey])
  if (rawValue !== undefined) return rawValue
  return migrateLegacyValueIfNeeded(Boolean(shared), id, { ...options, profileId })
}

function getExtensionValue(shared, extensionId, options = {}) {
  const rawValue = getExtensionRawValue(shared, extensionId, options)
  if (rawValue === undefined) return undefined
  try {
    return JSON.parse(rawValue)
  } catch (error) {
    console.error(`[main-thread:storage] unexpected error parsing storage contents (extensionId: ${extensionId}, global: ${Boolean(shared)}): ${error.message}`)
    return undefined
  }
}

function emitAcceptValue(shared, extensionId, rawValue, options = {}) {
  if (!shared || typeof options.callEh !== "function" || options.notifyExtHost === false) return
  options.callEh(EXT_HOST_STORAGE_NID, "$acceptValue", [true, extensionId, rawValue]).catch?.(() => undefined)
}

function setExtensionRawValue(shared, extensionId, rawValue, options = {}) {
  const id = normalizeExtensionId(extensionId)
  if (!id) return undefined
  if (rawValue && rawValue.length > LARGE_STATE_WARNING_THRESHOLD) {
    console.warn(`[main-thread:storage] large extension state detected (extensionId: ${id}, global: ${Boolean(shared)}): ${rawValue.length / 1024}kb. Consider using storageUri/globalStorageUri for data on disk.`)
  }
  const profileId = options.profileId || getCurrentProfileId(options)
  const storageKey = getStorageKey(Boolean(shared), id, options)
  const result = userDataProfile.updateProfileStorageData(profileId, {
    data: {
      [storageKey]: rawValue === undefined
        ? null
        : {
          value: rawValue,
          target: userDataProfile.STORAGE_TARGET.MACHINE,
          scope: shared ? userDataProfile.STORAGE_SCOPE.PROFILE : userDataProfile.STORAGE_SCOPE.WORKSPACE,
        },
    },
  }, {
    onDidChangeWorkbenchProfiles: options.onDidChangeWorkbenchProfiles,
    broadcastUserDataProfileChange: options.broadcastUserDataProfileChange,
    changeReason: options.changeReason || "extension-storage:update",
  })
  if (rawValue !== undefined) emitAcceptValue(Boolean(shared), id, rawValue, options)
  return result
}

function setExtensionValue(shared, extensionId, value, options = {}) {
  return setExtensionRawValue(Boolean(shared), extensionId, safeStringifyValue(value), options)
}

function setKeysForSync(extension, keys, options = {}) {
  const storageKey = extensionKeysStorageKey(extension)
  if (!storageKey) return undefined
  const normalizedKeys = Array.isArray(keys) ? keys.filter((key) => typeof key === "string") : []
  return setExtensionRawValue(true, storageKey, JSON.stringify(normalizedKeys), {
    ...options,
    notifyExtHost: false,
    changeReason: "extension-storage:sync-keys",
  })
}

function setWorkspaceRoot(root) {
  currentWorkspace = typeof root === "string" ? root : ""
}

function getOwnerEvidence() {
  return {
    mainThreadBridgeOwner: "MainThreadStorage",
    profileStorageOwner: "desktop.userDataProfile",
    persistenceSource: "CODEK_DATA/profile-storage",
    scopeOwner: {
      profile: "userDataProfile.updateProfileStorageData",
      workspace: "userDataProfile.updateProfileStorageData",
    },
    secondStateSourceCreated: false,
    remainingProfileUiOwnerGap: {
      connected: false,
      owner: "workbench.profile.ui",
      reason: "Extension-host storage is bridged to profile storage; full profile UI ownership is not connected here.",
    },
  }
}

function register(server, opts = {}) {
  const options = () => ({
    ...opts,
    workspace: opts.workspace || currentWorkspace,
  })

  server.onRpc("$initializeExtensionStorage", (args) => {
    const [shared, extensionId] = args || []
    const id = normalizeExtensionId(extensionId)
    if (!id) return undefined
    return getExtensionRawValue(Boolean(shared), id, options())
  })

  server.onRpc("$getValue", (args) => {
    const [shared, key] = args || []
    const id = normalizeExtensionId(key)
    if (!id) return undefined
    const val = getExtensionValue(Boolean(shared), id, options())
    return val !== undefined ? { value: val } : undefined
  })

  server.onRpc("$setValue", (args) => {
    const [shared, extensionId, value] = args || []
    const id = normalizeExtensionId(extensionId)
    if (!id) return undefined
    setExtensionValue(Boolean(shared), id, value, options())
    return undefined
  })

  server.onRpc("$registerExtensionStorageKeysToSync", (args) => {
    const [extension, keys] = args || []
    setKeysForSync(extension, keys, options())
    return undefined
  })

  if (typeof opts.setWorkspaceRootForStorage === "function") {
    opts.setWorkspaceRootForStorage(setWorkspaceRoot)
  }
}

module.exports = {
  EXT_HOST_STORAGE_NID,
  adoptToGalleryExtensionId,
  extensionKeysStorageKey,
  getExtensionValue,
  getExtensionRawValue,
  getOwnerEvidence,
  register,
  setExtensionValue,
  setExtensionRawValue,
  setKeysForSync,
  setWorkspaceRoot,
  workspaceStorageKey,
}
