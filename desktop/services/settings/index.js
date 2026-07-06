const fs = require("fs")
const os = require("os")
const path = require("path")
const { EventEmitter } = require("events")

const CODEK_DATA = process.env.CODEK_DATA || path.join(os.homedir(), ".codek")
const USER_SETTINGS_FILE = path.join(CODEK_DATA, "User", "settings.json")
const USER_KEYBINDINGS_FILE = path.join(CODEK_DATA, "User", "keybindings.json")
const settingsEvents = new EventEmitter()

function ensureUserSettingsDir() {
  fs.mkdirSync(path.dirname(USER_SETTINGS_FILE), { recursive: true })
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {}
    const raw = fs.readFileSync(filePath, "utf8")
    const parsed = JSON.parse(raw)
    return isObject(parsed) ? parsed : {}
  } catch (error) {
    console.error(`[settings] Failed to read ${filePath}:`, error.message)
    return {}
  }
}

function writeJsonFile(filePath, value) {
  ensureUserSettingsDir()
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function getByPath(source, keyPath) {
  if (!keyPath) return source
  const parts = keyPath.split(".")
  let cursor = source
  for (const part of parts) {
    if (!isObject(cursor) || !(part in cursor)) return undefined
    cursor = cursor[part]
  }
  return cursor
}

function setByPath(source, keyPath, value) {
  const parts = keyPath.split(".")
  let cursor = source
  for (const part of parts.slice(0, -1)) {
    if (!isObject(cursor[part])) cursor[part] = {}
    cursor = cursor[part]
  }
  cursor[parts[parts.length - 1]] = value
  return source
}

function stableStringify(value) {
  if (value === undefined) return "__undefined__"
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function getChangedKeys(previous, next) {
  const keys = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})])
  return [...keys].filter((key) => stableStringify(previous?.[key]) !== stableStringify(next?.[key]))
}

function readUserSettings() {
  return readJsonFile(USER_SETTINGS_FILE)
}

function readUserKeybindings() {
  try {
    if (!fs.existsSync(USER_KEYBINDINGS_FILE)) return []
    const raw = fs.readFileSync(USER_KEYBINDINGS_FILE, "utf8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.error(`[settings] Failed to read ${USER_KEYBINDINGS_FILE}:`, error.message)
    return []
  }
}

function removeUndefinedValues(source) {
  const out = {}
  for (const [key, value] of Object.entries(source || {})) {
    if (value !== undefined) out[key] = value
  }
  return out
}

function writeUserSettings(settings) {
  const previous = readUserSettings()
  writeJsonFile(USER_SETTINGS_FILE, removeUndefinedValues(settings))
  const next = readUserSettings()
  const changedKeys = getChangedKeys(previous, next)
  if (changedKeys.length > 0) {
    settingsEvents.emit("change", { changedKeys, settings: next })
  }
}

function writeUserKeybindings(keybindings) {
  ensureUserSettingsDir()
  const entries = Array.isArray(keybindings) ? keybindings : []
  fs.writeFileSync(USER_KEYBINDINGS_FILE, `${JSON.stringify(entries, null, 2)}\n`, "utf8")
}

function updateUserSetting(keyPath, value) {
  const settings = readUserSettings()
  if (value === undefined) {
    delete settings[keyPath]
  } else {
    settings[keyPath] = value
  }
  writeUserSettings(settings)
  return settings
}

function onDidChangeUserSettings(listener) {
  settingsEvents.on("change", listener)
  return {
    dispose() {
      settingsEvents.off("change", listener)
    },
  }
}

function emitRegisteredUserSettingsChange(options, event) {
  const listener = typeof options?.onDidChangeUserSettings === "function"
    ? options.onDidChangeUserSettings
    : null
  if (!listener) return
  try {
    listener({
      version: 1,
      reason: "settings:write",
      path: USER_SETTINGS_FILE,
      changedKeys: event?.changedKeys || [],
      settings: event?.settings || readUserSettings(),
    })
  } catch (error) {
    console.warn("[settings] Failed to emit user settings change:", error?.message || error)
  }
}

function register(router, options = {}) {
  router.register("GET", "/settings/user", async () => ({
    path: USER_SETTINGS_FILE,
    settings: readUserSettings(),
  }))

  router.register("PUT", "/settings/user", async ({ body }) => {
    const settings = isObject(body?.settings) ? body.settings : {}
    writeUserSettings(settings)
    return {
      path: USER_SETTINGS_FILE,
      settings: readUserSettings(),
    }
  })

  router.register("PATCH", "/settings/user", async ({ body }) => {
    const key = typeof body?.key === "string" ? body.key : ""
    if (!key) {
      const err = new Error("settings key is required")
      err.statusCode = 400
      throw err
    }
    return {
      path: USER_SETTINGS_FILE,
      settings: updateUserSetting(key, body?.value),
    }
  })

  router.register("GET", "/keybindings/user", async () => ({
    path: USER_KEYBINDINGS_FILE,
    keybindings: readUserKeybindings(),
  }))

  router.register("PUT", "/keybindings/user", async ({ body }) => {
    const keybindings = Array.isArray(body?.keybindings) ? body.keybindings : []
    writeUserKeybindings(keybindings)
    return {
      path: USER_KEYBINDINGS_FILE,
      keybindings: readUserKeybindings(),
    }
  })

  if (typeof options?.onDidChangeUserSettings === "function") {
    onDidChangeUserSettings((event) => emitRegisteredUserSettingsChange(options, event))
  }
}

module.exports = {
  USER_KEYBINDINGS_FILE,
  USER_SETTINGS_FILE,
  getByPath,
  onDidChangeUserSettings,
  readJsonFile,
  readUserKeybindings,
  readUserSettings,
  register,
  setByPath,
  updateUserSetting,
  writeUserKeybindings,
  writeUserSettings,
}
