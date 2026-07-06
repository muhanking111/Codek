const fs = require("fs")
const os = require("os")
const path = require("path")
const { pathToFileURL } = require("url")

const CODEK_DATA = process.env.CODEK_DATA || path.join(os.homedir(), ".codek")
const WORKBENCH_PROFILES_FILE = path.join(CODEK_DATA, "User", "profiles", "workbenchProfiles.json")
const PROFILE_STORAGE_DIR = path.join(CODEK_DATA, "User", "profiles", "storage")
const DEFAULT_PROFILE_ID = "__default__profile__"
const STORAGE_SCOPE = {
  APPLICATION_SHARED: -2,
  APPLICATION: -1,
  PROFILE: 0,
  WORKSPACE: 1,
}
const STORAGE_TARGET = {
  USER: 0,
  MACHINE: 1,
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function ensureProfilesDir(filePath = WORKBENCH_PROFILES_FILE) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function ensureProfileStorageDir(dirPath = PROFILE_STORAGE_DIR) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function normalizeWorkspaceKey(value) {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) return ""
  if (/^[a-zA-Z]:[\\/]/.test(raw) || /^\\\\/.test(raw)) {
    try {
      return pathToFileURL(path.resolve(raw)).toString()
    } catch {
      return raw.replace(/\\/g, "/")
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw
  try {
    return pathToFileURL(path.resolve(raw)).toString()
  } catch {
    return raw.replace(/\\/g, "/")
  }
}

function normalizeProfileId(value) {
  const id = typeof value === "string" ? value.trim() : ""
  if (!id) {
    const error = new Error("profileId required")
    error.status = 400
    throw error
  }
  return id.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
}

function getProfileStorageFile(profileId, options = {}) {
  const storageDir = options.storageDir || PROFILE_STORAGE_DIR
  return path.join(storageDir, `${normalizeProfileId(profileId)}.json`)
}

function normalizeStorageScope(value, fallback = STORAGE_SCOPE.PROFILE) {
  const scope = Number(value)
  return [
    STORAGE_SCOPE.APPLICATION_SHARED,
    STORAGE_SCOPE.APPLICATION,
    STORAGE_SCOPE.PROFILE,
    STORAGE_SCOPE.WORKSPACE,
  ].includes(scope) ? scope : fallback
}

function normalizeStorageTarget(value, fallback = STORAGE_TARGET.USER) {
  const target = Number(value)
  return target === STORAGE_TARGET.MACHINE ? STORAGE_TARGET.MACHINE : fallback
}

function normalizeStorageValue(value, fallbackTarget = STORAGE_TARGET.USER, fallbackScope = STORAGE_SCOPE.PROFILE) {
  if (isObject(value)) {
    const raw = hasOwn(value, "value") ? value.value : undefined
    return {
      value: raw === undefined || raw === null ? undefined : String(raw),
      target: normalizeStorageTarget(value.target, fallbackTarget),
      scope: normalizeStorageScope(value.scope, fallbackScope),
    }
  }
  return {
    value: value === undefined || value === null ? undefined : String(value),
    target: fallbackTarget,
    scope: fallbackScope,
  }
}

function normalizeProfileStorageEntries(value) {
  const source = isObject(value?.entries) ? value.entries : isObject(value) ? value : {}
  const entries = {}
  for (const [key, entry] of Object.entries(source)) {
    const storageKey = typeof key === "string" ? key.trim() : ""
    if (!storageKey) continue
    const normalized = normalizeStorageValue(entry)
    if (normalized.value !== undefined) entries[storageKey] = normalized
  }
  return entries
}

function readProfileStorageData(profileId, options = {}) {
  const id = normalizeProfileId(profileId)
  const filePath = options.filePath || getProfileStorageFile(id, options)
  try {
    if (!fs.existsSync(filePath)) {
      return {
        path: filePath,
        exists: false,
        version: 1,
        profileId: id,
        entries: {},
      }
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"))
    return {
      path: filePath,
      exists: true,
      version: 1,
      profileId: id,
      entries: normalizeProfileStorageEntries(parsed),
    }
  } catch (error) {
    console.error(`[userDataProfile] Failed to read profile storage ${filePath}:`, error.message)
    return {
      path: filePath,
      exists: true,
      version: 1,
      profileId: id,
      entries: {},
      invalid: true,
      error: error.message,
    }
  }
}

function buildProfileStorageChangeEvent(reason, result, changedKeys = []) {
  return {
    version: 1,
    reason,
    path: result?.path || "",
    profileId: result?.profileId || "",
    storageKeys: changedKeys,
    storageEntryCount: Object.keys(result?.entries || {}).length,
  }
}

function emitProfileStorageChange(options, reason, result, changedKeys = []) {
  const listener = typeof options?.onDidChangeWorkbenchProfiles === "function"
    ? options.onDidChangeWorkbenchProfiles
    : (typeof options?.broadcastUserDataProfileChange === "function" ? options.broadcastUserDataProfileChange : null)
  if (!listener) return
  try {
    listener(buildProfileStorageChangeEvent(reason, result, changedKeys))
  } catch (error) {
    console.warn("[userDataProfile] Failed to emit profile storage change:", error?.message || error)
  }
}

function updateProfileStorageData(profileId, input, options = {}) {
  const id = normalizeProfileId(profileId)
  const filePath = options.filePath || getProfileStorageFile(id, options)
  const fallbackTarget = normalizeStorageTarget(input?.target, STORAGE_TARGET.USER)
  const fallbackScope = normalizeStorageScope(input?.scope, STORAGE_SCOPE.PROFILE)
  const data = isObject(input?.data) ? input.data : {}
  const current = readProfileStorageData(id, { ...options, filePath })
  const entries = { ...current.entries }
  const changedKeys = []

  for (const [key, value] of Object.entries(data)) {
    const storageKey = typeof key === "string" ? key.trim() : ""
    if (!storageKey) continue
    changedKeys.push(storageKey)
    const normalized = normalizeStorageValue(value, fallbackTarget, fallbackScope)
    if (normalized.value === undefined) {
      delete entries[storageKey]
    } else {
      entries[storageKey] = normalized
    }
  }

  ensureProfileStorageDir(path.dirname(filePath))
  const state = {
    version: 1,
    profileId: id,
    entries,
  }
  const content = `${JSON.stringify(state, null, 2)}\n`
  fs.writeFileSync(filePath, content, "utf8")
  const result = {
    path: filePath,
    exists: true,
    bytesWritten: Buffer.byteLength(content),
    ...state,
  }
  emitProfileStorageChange(options, options.changeReason || "storage:update", result, changedKeys)
  return result
}

function normalizeProfileAssociations(value) {
  const source = isObject(value) ? value : {}
  const workspaces = {}
  const emptyWindows = {}
  if (isObject(source.workspaces)) {
    for (const [workspace, profileId] of Object.entries(source.workspaces)) {
      const key = normalizeWorkspaceKey(workspace)
      const id = typeof profileId === "string" ? profileId.trim() : ""
      if (key && id) workspaces[key] = id
    }
  }
  if (isObject(source.emptyWindows)) {
    for (const [windowId, profileId] of Object.entries(source.emptyWindows)) {
      const key = typeof windowId === "string" ? windowId.trim() : ""
      const id = typeof profileId === "string" ? profileId.trim() : ""
      if (key && id) emptyWindows[key] = id
    }
  }
  return { workspaces, emptyWindows }
}

function normalizeWorkbenchProfileState(value) {
  const profiles = Array.isArray(value?.profiles) ? value.profiles : []
  const activeProfileId = typeof value?.activeProfileId === "string" ? value.activeProfileId : ""
  return {
    version: 2,
    profiles,
    activeProfileId,
    profileAssociations: normalizeProfileAssociations(value?.profileAssociations),
  }
}

function getProfileIdForWorkspace(profileAssociations, workspace) {
  const key = normalizeWorkspaceKey(workspace)
  return key ? profileAssociations?.workspaces?.[key] || "" : ""
}

function getProfileIds(profiles) {
  return (Array.isArray(profiles) ? profiles : [])
    .map((profile) => typeof profile?.id === "string" ? profile.id.trim() : "")
    .filter(Boolean)
}

function withWorkspaceProfile(state, workspace) {
  const workspaceProfileId = getProfileIdForWorkspace(state.profileAssociations, workspace)
  return workspaceProfileId ? { ...state, workspaceProfileId } : state
}

function buildWorkbenchProfileChangeEvent(reason, state, options = {}) {
  const profileAssociations = normalizeProfileAssociations(state?.profileAssociations)
  const workspace = normalizeWorkspaceKey(options.workspace)
  const profileIds = getProfileIds(state?.profiles)
  return {
    version: 1,
    reason,
    path: state?.path || "",
    activeProfileId: typeof state?.activeProfileId === "string" ? state.activeProfileId : "",
    profileIds,
    profileCount: profileIds.length,
    workspace: workspace || undefined,
    workspaceProfileId: state?.workspaceProfileId || getProfileIdForWorkspace(profileAssociations, workspace) || "",
    profileAssociations,
  }
}

function emitWorkbenchProfileChange(options, reason, state) {
  const listener = typeof options?.onDidChangeWorkbenchProfiles === "function"
    ? options.onDidChangeWorkbenchProfiles
    : (typeof options?.broadcastUserDataProfileChange === "function" ? options.broadcastUserDataProfileChange : null)
  if (!listener) return
  try {
    listener(buildWorkbenchProfileChangeEvent(reason, state, options))
  } catch (error) {
    console.warn("[userDataProfile] Failed to emit profile change:", error?.message || error)
  }
}

function readWorkbenchProfileState(options = {}) {
  const filePath = options.filePath || WORKBENCH_PROFILES_FILE
  try {
    if (!fs.existsSync(filePath)) {
      const state = {
        path: filePath,
        exists: false,
        version: 2,
        profiles: [],
        activeProfileId: "",
        profileAssociations: { workspaces: {}, emptyWindows: {} },
      }
      return withWorkspaceProfile(state, options.workspace)
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"))
    const state = normalizeWorkbenchProfileState(isObject(parsed) ? parsed : {})
    return withWorkspaceProfile({
      path: filePath,
      exists: true,
      ...state,
    }, options.workspace)
  } catch (error) {
    console.error(`[userDataProfile] Failed to read ${filePath}:`, error.message)
    return withWorkspaceProfile({
      path: filePath,
      exists: true,
      version: 2,
      profiles: [],
      activeProfileId: "",
      profileAssociations: { workspaces: {}, emptyWindows: {} },
      invalid: true,
      error: error.message,
    }, options.workspace)
  }
}

function writeWorkbenchProfileState(input, options = {}) {
  const filePath = options.filePath || WORKBENCH_PROFILES_FILE
  const source = isObject(input) ? input : {}
  const existingAssociations = hasOwn(source, "profileAssociations")
    ? undefined
    : readWorkbenchProfileState({ filePath }).profileAssociations
  const state = normalizeWorkbenchProfileState({
    ...source,
    profileAssociations: hasOwn(source, "profileAssociations")
      ? source.profileAssociations
      : existingAssociations,
  })
  ensureProfilesDir(filePath)
  const content = `${JSON.stringify(state, null, 2)}\n`
  fs.writeFileSync(filePath, content, "utf8")
  const result = withWorkspaceProfile({
    path: filePath,
    exists: true,
    bytesWritten: Buffer.byteLength(content),
    ...state,
  }, options.workspace)
  emitWorkbenchProfileChange(options, options.changeReason || "profiles:write", result)
  return result
}

function setProfileForWorkspace(workspace, profileId, options = {}) {
  const workspaceKey = normalizeWorkspaceKey(workspace)
  const id = typeof profileId === "string" ? profileId.trim() : ""
  if (!workspaceKey) {
    const error = new Error("workspace required")
    error.status = 400
    throw error
  }
  if (!id) {
    const error = new Error("profileId required")
    error.status = 400
    throw error
  }
  const state = readWorkbenchProfileState(options)
  const profiles = Array.isArray(state.profiles) ? state.profiles : []
  if (profiles.length > 0 && !profiles.some((profile) => profile?.id === id)) {
    const error = new Error(`Profile not found: ${id}`)
    error.status = 404
    throw error
  }
  const nextAssociations = normalizeProfileAssociations(state.profileAssociations)
  nextAssociations.workspaces[workspaceKey] = id
  return writeWorkbenchProfileState({
    ...state,
    profileAssociations: nextAssociations,
  }, { ...options, workspace, changeReason: "workspace:set" })
}

function unsetProfileForWorkspace(workspace, options = {}) {
  const workspaceKey = normalizeWorkspaceKey(workspace)
  if (!workspaceKey) {
    const error = new Error("workspace required")
    error.status = 400
    throw error
  }
  const state = readWorkbenchProfileState(options)
  const nextAssociations = normalizeProfileAssociations(state.profileAssociations)
  delete nextAssociations.workspaces[workspaceKey]
  return writeWorkbenchProfileState({
    ...state,
    profileAssociations: nextAssociations,
  }, { ...options, workspace, changeReason: "workspace:unset" })
}

function register(router, options = {}) {
  router.register("GET", "/profiles/workbench", async ({ query }) => {
    return readWorkbenchProfileState({ workspace: query?.workspace })
  })

  router.register("PUT", "/profiles/workbench", async ({ body }) => {
    const input = {
      profiles: Array.isArray(body?.profiles) ? body.profiles : [],
      activeProfileId: typeof body?.activeProfileId === "string" ? body.activeProfileId : "",
    }
    if (hasOwn(body || {}, "profileAssociations")) {
      input.profileAssociations = body?.profileAssociations
    }
    return writeWorkbenchProfileState(input, {
      ...options,
      workspace: body?.workspace,
      changeReason: "profiles:write",
    })
  })

  router.register("GET", "/profiles/workbench/workspace", async ({ query }) => {
    const state = readWorkbenchProfileState({ workspace: query?.workspace })
    return {
      workspace: normalizeWorkspaceKey(query?.workspace),
      profileId: state.workspaceProfileId || "",
    }
  })

  router.register("PUT", "/profiles/workbench/workspace", async ({ body }) => {
    return setProfileForWorkspace(body?.workspace, body?.profileId, options)
  })

  router.register("DELETE", "/profiles/workbench/workspace", async ({ body }) => {
    return unsetProfileForWorkspace(body?.workspace, options)
  })

  router.register("GET", "/profiles/workbench/:profileId/storage", async ({ params }) => {
    return readProfileStorageData(params.profileId)
  })

  router.register("PUT", "/profiles/workbench/:profileId/storage", async ({ params, body }) => {
    return updateProfileStorageData(params.profileId, body, options)
  })
}

module.exports = {
  DEFAULT_PROFILE_ID,
  PROFILE_STORAGE_DIR,
  STORAGE_SCOPE,
  STORAGE_TARGET,
  WORKBENCH_PROFILES_FILE,
  buildProfileStorageChangeEvent,
  buildWorkbenchProfileChangeEvent,
  getProfileStorageFile,
  getProfileIdForWorkspace,
  normalizeProfileAssociations,
  normalizeProfileId,
  normalizeProfileStorageEntries,
  normalizeStorageScope,
  normalizeStorageTarget,
  normalizeWorkspaceKey,
  readProfileStorageData,
  readWorkbenchProfileState,
  register,
  setProfileForWorkspace,
  unsetProfileForWorkspace,
  updateProfileStorageData,
  writeWorkbenchProfileState,
}
