/**
 * MainThreadConfiguration — handles configuration fetch and update.
 *
 * RPC handlers:
 *   $fetchConfiguration()     — Return current configuration (VS Code format)
 *   $updateConfiguration(path, value, target) — Update a config value
 */

const path = require("path")
const fs = require("fs")
const {
  onDidChangeUserSettings,
  readUserSettings,
  updateUserSetting,
} = require("../../settings")
const {
  buildConfigModel,
  buildConfigurationChange,
  deepMerge,
  extractConfigurationDefaults,
  flatToNested,
  setByPath,
} = require("../configurationModelAdapter")

const CODEK_DATA = process.env.CODEK_DATA || path.join(require("os").homedir(), ".codek")
const CONFIG_FILE = path.join(CODEK_DATA, "ext-host-config.json")
const EXT_HOST_CONFIGURATION_NID = 87
const MAIN_THREAD_CONFIGURATION_NID = 12

// Default configuration mimicking VS Code defaults
const DEFAULT_CONFIG = {
  editor: {
    fontSize: 14,
    fontFamily: "Cascadia Code, Consolas, monospace",
    tabSize: 2,
    insertSpaces: true,
    wordWrap: "off",
    lineNumbers: "on",
    minimap: { enabled: true },
    cursorBlinking: "blink",
    cursorStyle: "line",
    renderWhitespace: "selection",
    bracketPairColorization: { enabled: true },
    suggest: { showKeywords: true, showSnippets: true },
    formatOnSave: false,
    formatOnPaste: false,
    autoClosingBrackets: "languageDefined",
    autoClosingQuotes: "languageDefined",
    detectIndentation: true,
  },
  files: {
    encoding: "utf8",
    exclude: { "**/.git": true, "**/node_modules": true, "**/dist": true },
    autoSave: "afterDelay",
    autoSaveDelay: 1000,
    trimTrailingWhitespace: false,
    insertFinalNewline: true,
  },
  workbench: {
    colorTheme: "default",
    iconTheme: "vs-seti",
    preferredDarkColorTheme: "default",
    preferredLightColorTheme: "default",
    statusBar: { visible: true },
    activityBar: { visible: true },
    sidebar: { location: "left" },
    panel: { showLabels: true, defaultLocation: "bottom" },
  },
  terminal: {
    integrated: {
      fontFamily: "Consolas, monospace",
      fontSize: 13,
      defaultProfile: "PowerShell",
    },
  },
  "launch": {},
  "git": {
    enabled: true,
    path: null,
    autofetch: true,
  },
  "extensions": {
    autoUpdate: true,
    ignoreRecommendations: false,
  },
  "window": {
    titleBarStyle: "custom",
    zoomLevel: 0,
  },
}

let cachedConfig = null
let suppressUserSettingsEvent = false
let workspaceConfig = {}
let folderConfigs = []
let contributedDefaultConfig = {}

const CONFIGURATION_TARGET = {
  APPLICATION: 1,
  USER: 2,
  USER_LOCAL: 3,
  USER_REMOTE: 4,
  WORKSPACE: 5,
  WORKSPACE_FOLDER: 6,
  DEFAULT: 7,
  MEMORY: 8,
}

function loadLegacyConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf8")
      return JSON.parse(raw)
    }
  } catch (e) {
    console.error("[main-thread:config] Failed to load config:", e.message)
  }
  return {}
}

function loadDefaultConfig() {
  return deepMerge(deepMerge(DEFAULT_CONFIG, loadLegacyConfig()), contributedDefaultConfig)
}

function loadUserConfig() {
  return flatToNested(readUserSettings())
}

function loadConfig() {
  if (cachedConfig) return cachedConfig
  cachedConfig = deepMerge(loadDefaultConfig(), loadUserConfig())
  return cachedConfig
}

function reloadConfig() {
  cachedConfig = null
  return loadConfig()
}

function loadConfigurationData() {
  return buildConfigurationData(loadDefaultConfig(), loadUserConfig())
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cachedConfig, null, 2), "utf8")
  } catch (e) {
    console.error("[main-thread:config] Failed to save config:", e.message)
  }
}

function buildConfigurationData(
  defaultConfig = loadDefaultConfig(),
  userConfig = loadUserConfig(),
  workspace = workspaceConfig,
  folders = folderConfigs,
) {
  const defaultModel = buildConfigModel(defaultConfig)
  const userModel = buildConfigModel(userConfig)
  const workspaceModel = buildConfigModel(workspace)
  const emptyModel = { contents: {}, keys: [], overrides: [] }
  const folderModels = Array.isArray(folders)
    ? folders.map((folder) => ({
      uri: folder.uri,
      name: folder.name,
      index: folder.index || 0,
      configuration: buildConfigModel(folder.configuration || {}),
    }))
    : []
  return {
    defaults: defaultModel,
    policy: emptyModel,
    application: emptyModel,
    userLocal: userModel,
    userRemote: emptyModel,
    workspace: workspaceModel,
    folders: folderModels,
    configurationScopes: [...new Set([
      ...defaultModel.keys,
      ...userModel.keys,
      ...workspaceModel.keys,
      ...folderModels.flatMap((folder) => folder.configuration.keys),
    ])].map((key) => [key, 1]),
  }
}

function notifyConfigurationChanged(opts, changedKeys) {
  if (!opts || typeof opts.callEh !== "function") return
  const change = buildConfigurationChange(changedKeys)
  if (change.keys.length === 0 && change.overrides.length === 0) return
  const data = loadConfigurationData()
  opts.callEh(EXT_HOST_CONFIGURATION_NID, "$acceptConfigurationChanged", [data, change]).catch((err) => {
    if (process.env.DEBUG_EXT_HOST) {
      console.warn("[main-thread:config] Failed to notify configuration change:", err?.message || err)
    }
  })
}

function normalizeConfigurationTarget(target) {
  if (
    target === CONFIGURATION_TARGET.USER ||
    target === CONFIGURATION_TARGET.USER_LOCAL ||
    target === CONFIGURATION_TARGET.USER_REMOTE ||
    target === CONFIGURATION_TARGET.MEMORY
  ) {
    return CONFIGURATION_TARGET.USER
  }
  if (target === CONFIGURATION_TARGET.WORKSPACE) return CONFIGURATION_TARGET.WORKSPACE
  return CONFIGURATION_TARGET.USER
}

function deriveConfigurationTarget(target) {
  if (target === undefined || target === null) return CONFIGURATION_TARGET.WORKSPACE
  return normalizeConfigurationTarget(target)
}

function applyWorkspaceConfigurationValue(keyPath, value) {
  const next = deepMerge({}, workspaceConfig)
  setByPath(next, keyPath, value)
  workspaceConfig = next
}

function removeWorkspaceConfigurationValue(keyPath) {
  const flat = {}
  function flatten(source, prefix = "") {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      if (prefix) flat[prefix] = source
      return
    }
    for (const [key, child] of Object.entries(source)) {
      flatten(child, prefix ? `${prefix}.${key}` : key)
    }
  }
  flatten(workspaceConfig)
  delete flat[keyPath]
  workspaceConfig = flatToNested(flat)
}

function applyConfigurationValue(keyPath, value, opts, target = CONFIGURATION_TARGET.USER) {
  if (!keyPath) return
  const normalizedTarget = normalizeConfigurationTarget(target)
  if (normalizedTarget === CONFIGURATION_TARGET.WORKSPACE) {
    applyWorkspaceConfigurationValue(keyPath, value)
  } else {
    const config = loadConfig()
    setByPath(config, keyPath, value)
    cachedConfig = config
    suppressUserSettingsEvent = true
    try {
      updateUserSetting(keyPath, value)
    } finally {
      suppressUserSettingsEvent = false
    }
  }
  notifyConfigurationChanged(opts, [keyPath])
}

function removeConfigurationValue(keyPath, opts, target = CONFIGURATION_TARGET.USER) {
  if (!keyPath) return
  const normalizedTarget = normalizeConfigurationTarget(target)
  if (normalizedTarget === CONFIGURATION_TARGET.WORKSPACE) {
    removeWorkspaceConfigurationValue(keyPath)
  } else {
    suppressUserSettingsEvent = true
    try {
      updateUserSetting(keyPath, undefined)
    } finally {
      suppressUserSettingsEvent = false
    }
    reloadConfig()
  }
  notifyConfigurationChanged(opts, [keyPath])
}

function applyConfigurationDefaults(contributions) {
  const defaults = extractConfigurationDefaults(contributions)
  if (Object.keys(defaults).length === 0) return []
  contributedDefaultConfig = deepMerge(contributedDefaultConfig, flatToNested(defaults))
  cachedConfig = null
  return Object.keys(defaults)
}

function setWorkspaceConfiguration(config = {}) {
  workspaceConfig = flatToNested(config)
}

function setFolderConfigurations(folders = []) {
  folderConfigs = Array.isArray(folders)
    ? folders.map((folder, index) => ({
      uri: folder.uri,
      name: folder.name,
      index: folder.index ?? index,
      configuration: flatToNested(folder.configuration || {}),
    }))
    : []
}

function onRpc(server, method, handler) {
  server.onRpc(MAIN_THREAD_CONFIGURATION_NID, method, handler)
  server.onRpc(method, handler)
}

function register(server, opts = {}) {
  onRpc(server, "$fetchConfiguration", () => {
    return loadConfigurationData()
  })

  onRpc(server, "$updateConfiguration", (args) => {
    const [path, value, target] = args || []
    if (!path) return undefined

    applyConfigurationValue(path, value, opts, target)
    return undefined
  })

  onRpc(server, "$updateConfigurationOption", (args) => {
    const [target, key, value] = args || []
    if (!key) return undefined

    applyConfigurationValue(key, value, opts, deriveConfigurationTarget(target))
    return undefined
  })

  onRpc(server, "$removeConfigurationOption", (args) => {
    const [target, key] = args || []
    if (!key) return undefined

    removeConfigurationValue(key, opts, deriveConfigurationTarget(target))
    return undefined
  })

  onRpc(server, "$fetchConfigurationValues", () => {
    return loadConfigurationData()
  })

  onRpc(server, "$acceptConfigurationDefaults", (args) => {
    const [contributions] = args || []
    const changedKeys = applyConfigurationDefaults(contributions)
    notifyConfigurationChanged(opts, changedKeys)
    return undefined
  })

  if (typeof opts.registerConfigurationDefaults === "function") {
    opts.registerConfigurationDefaults((contributions) => {
      const changedKeys = applyConfigurationDefaults(contributions)
      notifyConfigurationChanged(opts, changedKeys)
    })
  }

  if (typeof opts.setWorkspaceConfiguration === "function") {
    opts.setWorkspaceConfiguration(setWorkspaceConfiguration)
  }

  if (typeof opts.setFolderConfigurations === "function") {
    opts.setFolderConfigurations(setFolderConfigurations)
  }

  if (typeof onDidChangeUserSettings === "function") {
    onDidChangeUserSettings((event) => {
      if (suppressUserSettingsEvent) return
      reloadConfig()
      notifyConfigurationChanged(opts, event?.changedKeys || [])
    })
  }
}

module.exports = {
  CONFIGURATION_TARGET,
  EXT_HOST_CONFIGURATION_NID,
  MAIN_THREAD_CONFIGURATION_NID,
  applyConfigurationDefaults,
  applyConfigurationValue,
  buildConfigurationChange,
  buildConfigurationData,
  buildConfigModel,
  deriveConfigurationTarget,
  extractConfigurationDefaults,
  normalizeConfigurationTarget,
  register,
  removeConfigurationValue,
  setFolderConfigurations,
  setWorkspaceConfiguration,
}
