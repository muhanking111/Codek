const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const {
  USER_SETTINGS_FILE,
  readUserKeybindings,
  readUserSettings,
  writeUserKeybindings,
  writeUserSettings,
} = require("../settings")

const PROFILE_EXTENSION = "code-profile"

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function stripJsonComments(text) {
  return String(text || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function readJsoncFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(stripJsonComments(fs.readFileSync(filePath, "utf8")))
  } catch {
    return fallback
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function stringifyJsonResource(value) {
  return JSON.stringify(value, null, 2)
}

function createSettingsResourceContent(settings) {
  return JSON.stringify({
    settings: stringifyJsonResource(isObject(settings) ? settings : {}),
  })
}

function createKeybindingsResourceContent(keybindings) {
  return JSON.stringify({
    keybindings: stringifyJsonResource(Array.isArray(keybindings) ? keybindings : []),
    platform: process.platform,
  })
}

function createTasksResourceContent(tasks) {
  return JSON.stringify({
    tasks: isObject(tasks) ? stringifyJsonResource(tasks) : null,
  })
}

function createSnippetsResourceContent(snippets) {
  return JSON.stringify({
    snippets: Object.fromEntries(
      (snippets || [])
        .filter((snippet) => typeof snippet?.name === "string" && snippet.name)
        .map((snippet) => [path.basename(snippet.name), stringifyJsonResource(snippet.snippets || {})]),
    ),
  })
}

function createExtensionsResourceContent(extensions) {
  return JSON.stringify(
    (extensions || []).map((id) => ({
      identifier: { id },
    })),
  )
}

function createMcpResourceContent(mcp) {
  return JSON.stringify({
    mcp: isObject(mcp) ? stringifyJsonResource(mcp) : null,
  })
}

function createProfileTemplate(profile) {
  return {
    name: profile.name || profile.id || "默认配置",
    settings: createSettingsResourceContent(profile.settings),
    keybindings: createKeybindingsResourceContent(profile.keybindings),
    tasks: createTasksResourceContent(profile.tasks),
    snippets: createSnippetsResourceContent(profile.snippets),
    extensions: createExtensionsResourceContent(profile.extensions),
    mcp: createMcpResourceContent(profile.mcp),
  }
}

function assertProfileFilePath(filePath) {
  const resolved = path.resolve(String(filePath || ""))
  if (!resolved) {
    const err = new Error("filePath is required")
    err.statusCode = 400
    throw err
  }
  if (path.extname(resolved).toLowerCase() !== `.${PROFILE_EXTENSION}`) {
    const err = new Error(`只支持 .${PROFILE_EXTENSION} Profile 文件`)
    err.statusCode = 400
    throw err
  }
  return resolved
}

function isUserDataProfileTemplate(value) {
  return Boolean(
    isObject(value) &&
      typeof value.name === "string" &&
      (value.icon === undefined || typeof value.icon === "string") &&
      (value.settings === undefined || typeof value.settings === "string") &&
      (value.keybindings === undefined || typeof value.keybindings === "string") &&
      (value.tasks === undefined || typeof value.tasks === "string") &&
      (value.snippets === undefined || typeof value.snippets === "string") &&
      (value.globalState === undefined || typeof value.globalState === "string") &&
      (value.extensions === undefined || typeof value.extensions === "string") &&
      (value.mcp === undefined || typeof value.mcp === "string"),
  )
}

function importProfileFile(filePath) {
  const resolved = assertProfileFilePath(filePath)
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, "utf8"))
  } catch (error) {
    const err = new Error(`无法读取 Profile 文件：${error.message}`)
    err.statusCode = fs.existsSync(resolved) ? 400 : 404
    throw err
  }
  if (!isUserDataProfileTemplate(parsed)) {
    const err = new Error("Profile 文件格式无效")
    err.statusCode = 400
    throw err
  }
  return {
    filePath: resolved,
    profileTemplate: parsed,
  }
}

function exportProfileFile(filePath, template) {
  const resolved = assertProfileFilePath(filePath)
  if (!isUserDataProfileTemplate(template)) {
    const err = new Error("Profile 模板格式无效")
    err.statusCode = 400
    throw err
  }
  const content = `${JSON.stringify(template, null, 2)}\n`
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, content, "utf8")
  return {
    filePath: resolved,
    saved: true,
    bytesWritten: Buffer.byteLength(content),
  }
}

function detectProfileSource(userDir) {
  const normalized = String(userDir || "").toLowerCase()
  if (normalized.includes("cursor")) return "cursor"
  if (normalized.includes("code")) return "vscode"
  return "codek"
}

function createProfileSnapshot({ sourceDir, profile, settings, keybindings }) {
  const source = detectProfileSource(sourceDir)
  const id = `imported-${source}-${profile.id || "default"}`
  return {
    id,
    name: `${profile.name || profile.id || "默认配置"}（${source === "cursor" ? "Cursor" : source === "vscode" ? "VS Code" : "Codek"}）`,
    source,
    settings: isObject(settings) ? settings : {},
    keybindings: Array.isArray(keybindings) ? keybindings : [],
    activate: true,
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath)
  } catch {
    return null
  }
}

function resolveUserHome(options = {}) {
  return options.homedir || os.homedir()
}

function resolveEnv(options = {}) {
  return options.env || process.env
}

function getCandidateSources(options = {}) {
  const platform = options.platform || process.platform
  const env = resolveEnv(options)
  const home = resolveUserHome(options)
  const sources = []
  const push = (app, label, userDir) => {
    if (!userDir) return
    sources.push({ app, label, userDir })
  }

  if (platform === "win32") {
    const appData = env.APPDATA || path.join(home, "AppData", "Roaming")
    push("vscode", "VS Code", path.join(appData, "Code", "User"))
    push("cursor", "Cursor", path.join(appData, "Cursor", "User"))
    push("vscode-insiders", "VS Code Insiders", path.join(appData, "Code - Insiders", "User"))
  } else if (platform === "darwin") {
    const appSupport = path.join(home, "Library", "Application Support")
    push("vscode", "VS Code", path.join(appSupport, "Code", "User"))
    push("cursor", "Cursor", path.join(appSupport, "Cursor", "User"))
    push("vscode-insiders", "VS Code Insiders", path.join(appSupport, "Code - Insiders", "User"))
  } else {
    const config = env.XDG_CONFIG_HOME || path.join(home, ".config")
    push("vscode", "VS Code", path.join(config, "Code", "User"))
    push("cursor", "Cursor", path.join(config, "Cursor", "User"))
    push("vscode-insiders", "VS Code Insiders", path.join(config, "Code - Insiders", "User"))
  }

  return sources.map((source) => ({
    ...source,
    exists: Boolean(safeStat(source.userDir)?.isDirectory()),
  }))
}

function readSnippets(userDir) {
  const snippetsDir = path.join(userDir, "snippets")
  const stat = safeStat(snippetsDir)
  if (!stat?.isDirectory()) return []
  return fs.readdirSync(snippetsDir)
    .filter((name) => name.endsWith(".json") || name.endsWith(".code-snippets"))
    .map((name) => {
      const filePath = path.join(snippetsDir, name)
      return {
        name,
        path: filePath,
        snippets: readJsoncFile(filePath, {}),
      }
    })
}

function readExtensionIds(userDir) {
  const roots = [
    path.resolve(userDir, "..", "..", "extensions", "extensions.json"),
    path.join(userDir, "extensions.json"),
  ]
  const ids = new Set()
  for (const filePath of roots) {
    const parsed = readJsoncFile(filePath, null)
    const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.extensions) ? parsed.extensions : []
    for (const entry of entries) {
      const id = entry?.identifier?.id || entry?.identifier || entry?.id || entry?.name
      if (typeof id === "string" && id.trim()) ids.add(id.trim())
    }
  }
  return [...ids].sort()
}

function readProfileDirs(userDir) {
  const profilesRoot = path.join(userDir, "profiles")
  const stat = safeStat(profilesRoot)
  if (!stat?.isDirectory()) return []
  return fs.readdirSync(profilesRoot)
    .map((name) => path.join(profilesRoot, name))
    .filter((entry) => safeStat(entry)?.isDirectory())
}

function readProfileName(profileDir) {
  const profile = readJsoncFile(path.join(profileDir, "profile.json"), {})
  return typeof profile?.name === "string" && profile.name.trim()
    ? profile.name.trim()
    : path.basename(profileDir)
}

function readUserDataProfile(userDir) {
  const settings = readJsoncFile(path.join(userDir, "settings.json"), {})
  const keybindings = readJsoncFile(path.join(userDir, "keybindings.json"), [])
  const tasks = readJsoncFile(path.join(userDir, "tasks.json"), null)
  const mcp = readJsoncFile(path.join(userDir, "mcp.json"), null)
  return {
    userDir,
    settings: isObject(settings) ? settings : {},
    keybindings: Array.isArray(keybindings) ? keybindings : [],
    tasks: isObject(tasks) ? tasks : null,
    mcp: isObject(mcp) ? mcp : null,
    snippets: readSnippets(userDir),
    extensions: readExtensionIds(userDir),
    profiles: readProfileDirs(userDir).map((profileDir) => ({
      id: path.basename(profileDir),
      name: readProfileName(profileDir),
      userDir: profileDir,
      settings: (() => {
        const value = readJsoncFile(path.join(profileDir, "settings.json"), {})
        return isObject(value) ? value : {}
      })(),
      keybindings: (() => {
        const value = readJsoncFile(path.join(profileDir, "keybindings.json"), [])
        return Array.isArray(value) ? value : []
      })(),
      tasks: (() => {
        const value = readJsoncFile(path.join(profileDir, "tasks.json"), null)
        return isObject(value) ? value : null
      })(),
      mcp: (() => {
        const value = readJsoncFile(path.join(profileDir, "mcp.json"), null)
        return isObject(value) ? value : null
      })(),
      snippets: readSnippets(profileDir),
      extensions: readExtensionIds(profileDir),
    })),
  }
}

function summarizeProfile(profile) {
  return {
    id: profile.id || "default",
    name: profile.name || "默认配置",
    userDir: profile.userDir,
    settingsCount: Object.keys(profile.settings || {}).length,
    keybindingsCount: (profile.keybindings || []).length,
    snippetsCount: (profile.snippets || []).length,
    extensionsCount: (profile.extensions || []).length,
    profilesCount: (profile.profiles || []).length,
  }
}

function selectImportProfile(profile, profileId) {
  const id = typeof profileId === "string" ? profileId.trim() : ""
  if (!id || id === "default") return { ...profile, id: "default", name: "默认配置" }
  const selected = (profile.profiles || []).find((entry) => entry.id === id || entry.name === id)
  if (!selected) {
    const err = new Error(`profile not found: ${id}`)
    err.statusCode = 404
    throw err
  }
  return selected
}

function getCodekUserDir() {
  return path.dirname(USER_SETTINGS_FILE)
}

function getExtensionManifestPath() {
  return path.join(getCodekUserDir(), "migration", "vscode-extensions.json")
}

function normalizeExtensionId(id) {
  return String(id || "").trim()
}

function readExtensionInstallQueue(options = {}) {
  const filePath = options.filePath || getExtensionManifestPath()
  const manifest = readJsoncFile(filePath, null)
  const extensions = Array.isArray(manifest?.extensions)
    ? manifest.extensions.map(normalizeExtensionId).filter(Boolean)
    : []
  const installed = Array.isArray(manifest?.installed)
    ? manifest.installed.map(normalizeExtensionId).filter(Boolean)
    : []
  const failed = isObject(manifest?.failed) ? manifest.failed : {}
  const installedSet = new Set(installed.map((id) => id.toLowerCase()))
  const failedMap = new Map(Object.entries(failed).map(([id, value]) => [id.toLowerCase(), value]))
  const seen = new Set()
  const entries = []

  for (const id of extensions) {
    const key = id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const failedEntry = failedMap.get(key)
    const status = installedSet.has(key) ? "installed" : failedEntry ? "failed" : "pending"
    entries.push({
      id,
      status,
      error: typeof failedEntry?.error === "string" ? failedEntry.error : "",
      updatedAt: typeof failedEntry?.updatedAt === "string" ? failedEntry.updatedAt : "",
    })
  }

  return {
    path: filePath,
    exists: Boolean(manifest),
    source: manifest?.source || "",
    importedAt: manifest?.importedAt || "",
    installPolicy: manifest?.installPolicy || "user-confirmed",
    reason: manifest?.reason || "扩展需要在扩展页逐个确认安装，避免自动联网安装或冲突扩展破坏当前工作台。",
    total: entries.length,
    pending: entries.filter((entry) => entry.status === "pending").length,
    installed: entries.filter((entry) => entry.status === "installed").length,
    failed: entries.filter((entry) => entry.status === "failed").length,
    extensions: entries,
  }
}

function updateExtensionInstallQueueStatus(extensionId, status, options = {}) {
  const id = normalizeExtensionId(extensionId)
  if (!id) {
    const err = new Error("extensionId is required")
    err.statusCode = 400
    throw err
  }

  const filePath = options.filePath || getExtensionManifestPath()
  const manifest = readJsoncFile(filePath, null)
  if (!manifest || !Array.isArray(manifest.extensions)) {
    const err = new Error("VS Code 扩展迁移清单不存在")
    err.statusCode = 404
    throw err
  }

  const ids = manifest.extensions.map(normalizeExtensionId).filter(Boolean)
  const matched = ids.some((entry) => entry.toLowerCase() === id.toLowerCase())
  if (!matched) {
    const err = new Error(`扩展不在迁移清单中：${id}`)
    err.statusCode = 404
    throw err
  }

  const installed = new Set((Array.isArray(manifest.installed) ? manifest.installed : [])
    .map(normalizeExtensionId)
    .filter(Boolean)
    .map((entry) => entry.toLowerCase()))
  const failed = isObject(manifest.failed) ? { ...manifest.failed } : {}
  const canonicalId = ids.find((entry) => entry.toLowerCase() === id.toLowerCase()) || id

  if (status === "installed") {
    installed.add(canonicalId.toLowerCase())
    for (const key of Object.keys(failed)) {
      if (key.toLowerCase() === canonicalId.toLowerCase()) delete failed[key]
    }
  } else if (status === "failed") {
    failed[canonicalId] = {
      error: typeof options.error === "string" ? options.error.slice(0, 500) : "安装失败",
      updatedAt: new Date().toISOString(),
    }
    installed.delete(canonicalId.toLowerCase())
  } else if (status === "pending") {
    installed.delete(canonicalId.toLowerCase())
    for (const key of Object.keys(failed)) {
      if (key.toLowerCase() === canonicalId.toLowerCase()) delete failed[key]
    }
  } else {
    const err = new Error(`unsupported status: ${status}`)
    err.statusCode = 400
    throw err
  }

  const installedCanonical = ids.filter((entry) => installed.has(entry.toLowerCase()))
  writeJsonFile(filePath, {
    ...manifest,
    installPolicy: "user-confirmed",
    reason: "扩展清单已导入；安装需要用户在扩展页逐个确认执行，避免自动联网安装或冲突扩展破坏当前工作台。",
    installed: installedCanonical,
    failed,
    updatedAt: new Date().toISOString(),
  })
  return readExtensionInstallQueue({ filePath })
}

function writeSnippets(snippets, mode) {
  const targetDir = path.join(getCodekUserDir(), "snippets")
  fs.mkdirSync(targetDir, { recursive: true })
  if (mode === "replace") {
    for (const name of fs.readdirSync(targetDir)) {
      if (name.endsWith(".json") || name.endsWith(".code-snippets")) {
        fs.rmSync(path.join(targetDir, name), { force: true })
      }
    }
  }
  const written = []
  for (const snippet of snippets || []) {
    const safeName = path.basename(snippet.name || "")
    if (!safeName || (!safeName.endsWith(".json") && !safeName.endsWith(".code-snippets"))) continue
    const target = path.join(targetDir, safeName)
    writeJsonFile(target, snippet.snippets || {})
    written.push({ name: safeName, path: target })
  }
  return written
}

function writeExtensionManifest(extensions, source, mode) {
  const filePath = getExtensionManifestPath()
  const existing = readJsoncFile(filePath, { extensions: [], installed: [], failed: {} })
  const current = mode === "replace" ? [] : existing.extensions || []
  const merged = [...new Set([...(Array.isArray(current) ? current : []), ...(extensions || [])])].sort()
  const mergedSet = new Set(merged.map((id) => String(id).toLowerCase()))
  const installed = mode === "replace"
    ? []
    : (Array.isArray(existing.installed) ? existing.installed : []).filter((id) => mergedSet.has(String(id).toLowerCase()))
  const failed = mode === "replace" ? {} : Object.fromEntries(
    Object.entries(isObject(existing.failed) ? existing.failed : {})
      .filter(([id]) => mergedSet.has(String(id).toLowerCase())),
  )
  writeJsonFile(filePath, {
    source,
    importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    installPolicy: "user-confirmed",
    reason: "扩展清单已导入；安装需要用户在扩展页逐个确认执行，避免自动联网安装或冲突扩展破坏当前工作台。",
    extensions: merged,
    installed,
    failed,
  })
  return { path: filePath, extensions: merged }
}

function previewSource(userDir) {
  const profile = readUserDataProfile(userDir)
  return {
    ...summarizeProfile(profile),
    profileTemplate: createProfileTemplate({ ...profile, id: "default", name: "默认配置" }),
    settings: profile.settings,
    keybindings: profile.keybindings,
    snippets: profile.snippets.map((item) => ({ name: item.name, path: item.path })),
    extensions: profile.extensions,
    profiles: profile.profiles.map((entry) => ({
      id: entry.id,
      ...summarizeProfile(entry),
    })),
  }
}

function importSource(userDir, options = {}) {
  const sections = options.sections || {}
  const mode = options.mode === "replace" ? "replace" : "merge"
  const rootProfile = readUserDataProfile(userDir)
  const profile = selectImportProfile(rootProfile, options.profileId)
  const profileTemplate = createProfileTemplate(profile)
  const result = {
    source: userDir,
    profileId: profile.id || "default",
    profileName: profile.name || profile.id || "默认配置",
    mode,
    profileTemplate,
    profileSnapshot: createProfileSnapshot({
      sourceDir: profile.userDir || userDir,
      profile,
      settings: profile.settings,
      keybindings: profile.keybindings,
    }),
    settings: { imported: 0 },
    keybindings: { imported: 0 },
    snippets: { imported: 0, written: [] },
    extensions: { imported: 0, manifestPath: "", skipped: "扩展清单已导入，安装仍需用户在扩展页确认执行" },
  }

  if (sections.settings !== false) {
    const current = mode === "replace" ? {} : readUserSettings()
    const next = { ...current, ...profile.settings }
    writeUserSettings(next)
    result.profileSnapshot.settings = next
    result.settings.imported = Object.keys(profile.settings || {}).length
  }

  if (sections.keybindings !== false) {
    const current = mode === "replace" ? [] : readUserKeybindings()
    const next = mode === "replace"
      ? profile.keybindings
      : [...current, ...profile.keybindings]
    writeUserKeybindings(next)
    result.profileSnapshot.keybindings = next
    result.keybindings.imported = profile.keybindings.length
  }

  if (sections.snippets !== false) {
    const written = writeSnippets(profile.snippets, mode)
    result.snippets.imported = written.length
    result.snippets.written = written
  }

  if (sections.extensions !== false) {
    const manifest = writeExtensionManifest(profile.extensions, profile.userDir, mode)
    result.extensions.imported = profile.extensions.length
    result.extensions.manifestPath = manifest.path
  }
  return result
}

function register(router) {
  router.register("GET", "/migration/vscode/sources", async () => ({
    sources: getCandidateSources(),
  }))

  router.register("POST", "/migration/vscode/preview", async ({ body }) => {
    const userDir = typeof body?.userDir === "string" ? body.userDir : ""
    if (!userDir) {
      const err = new Error("userDir is required")
      err.statusCode = 400
      throw err
    }
    return previewSource(userDir)
  })

  router.register("POST", "/migration/vscode/import", async ({ body }) => {
    const userDir = typeof body?.userDir === "string" ? body.userDir : ""
    if (!userDir) {
      const err = new Error("userDir is required")
      err.statusCode = 400
      throw err
    }
    return importSource(userDir, {
      sections: isObject(body?.sections) ? body.sections : {},
      mode: body?.mode,
      profileId: body?.profileId,
    })
  })

  router.register("POST", "/migration/vscode/profile-file/import", async ({ body }) => {
    return importProfileFile(typeof body?.filePath === "string" ? body.filePath : "")
  })

  router.register("POST", "/migration/vscode/profile-file/export", async ({ body }) => {
    return exportProfileFile(
      typeof body?.filePath === "string" ? body.filePath : "",
      isObject(body?.template) ? body.template : null,
    )
  })

  router.register("GET", "/migration/vscode/extensions", async () => readExtensionInstallQueue())

  router.register("POST", "/migration/vscode/extensions/status", async ({ body }) => {
    const extensionId = typeof body?.extensionId === "string" ? body.extensionId : ""
    const status = typeof body?.status === "string" ? body.status : ""
    return updateExtensionInstallQueueStatus(extensionId, status, {
      error: typeof body?.error === "string" ? body.error : "",
    })
  })
}

module.exports = {
  exportProfileFile,
  getCandidateSources,
  getExtensionManifestPath,
  importProfileFile,
  importSource,
  previewSource,
  PROFILE_EXTENSION,
  readExtensionInstallQueue,
  readUserDataProfile,
  register,
  isUserDataProfileTemplate,
  stripJsonComments,
  updateExtensionInstallQueueStatus,
}
