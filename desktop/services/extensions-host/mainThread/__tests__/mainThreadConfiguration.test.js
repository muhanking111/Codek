const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

function loadModules() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-config-"))
  process.env.CODEK_DATA = tempDir

  const settingsPath = path.resolve(__dirname, "../../../settings/index.js")
  const configurationPath = path.resolve(__dirname, "../mainThreadConfiguration.js")
  delete require.cache[settingsPath]
  delete require.cache[configurationPath]

  return {
    configuration: require(configurationPath),
    settings: require(settingsPath),
    tempDir,
  }
}

function createServer() {
  const handlers = new Map()
  return {
    handlers,
    onRpc(method, handler) {
      handlers.set(method, handler)
    },
  }
}

test("mainThreadConfiguration returns VS Code configuration data from user settings", () => {
  const { configuration, settings } = loadModules()
  settings.updateUserSetting("editor.fontSize", 20)
  settings.updateUserSetting("files.autoSave", "off")

  const server = createServer()
  configuration.register(server, { callEh: async () => undefined })
  const data = server.handlers.get("$fetchConfiguration")([])

  assert.equal(data.defaults.contents.editor.fontSize, 14)
  assert.equal(data.userLocal.contents.editor.fontSize, 20)
  assert.equal(data.userLocal.contents.files.autoSave, "off")
  assert.ok(data.userLocal.keys.includes("editor.fontSize"))
  assert.deepEqual(data.folders, [])
  assert.ok(data.configurationScopes.some(([key]) => key === "files.autoSave"))
})

test("mainThreadConfiguration notifies Extension Host after configuration updates", async () => {
  const { configuration, settings } = loadModules()
  const server = createServer()
  const calls = []
  configuration.register(server, {
    callEh: async (...args) => {
      calls.push(args)
    },
  })

  server.handlers.get("$updateConfiguration")(["editor.tabSize", 4])
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(settings.readUserSettings()["editor.tabSize"], 4)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], configuration.EXT_HOST_CONFIGURATION_NID)
  assert.equal(calls[0][1], "$acceptConfigurationChanged")
  assert.equal(calls[0][2][0].userLocal.contents.editor.tabSize, 4)
  assert.deepEqual(calls[0][2][1], { keys: ["editor.tabSize"], overrides: [] })
})

test("mainThreadConfiguration supports VS Code update and remove configuration option RPCs", async () => {
  const { configuration, settings } = loadModules()
  const server = createServer()
  const calls = []
  configuration.register(server, {
    callEh: async (...args) => {
      calls.push(args)
    },
  })

  server.handlers.get("$updateConfigurationOption")([2, "files.autoSave", "off", {}, false])
  server.handlers.get("$removeConfigurationOption")([2, "files.autoSave", {}, false])
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(settings.readUserSettings()["files.autoSave"], undefined)
  assert.equal(calls.length, 2)
  assert.equal(calls[0][2][0].userLocal.contents.files.autoSave, "off")
  assert.equal(calls[1][2][0].defaults.contents.files.autoSave, "afterDelay")
  assert.equal(calls[1][2][0].userLocal.contents.files, undefined)
  assert.deepEqual(calls[1][2][1].keys, ["files.autoSave"])
})

test("mainThreadConfiguration derives null VS Code RPC targets to workspace", async () => {
  const { configuration, settings } = loadModules()
  const server = createServer()
  const calls = []
  configuration.register(server, {
    callEh: async (...args) => {
      calls.push(args)
    },
  })

  server.handlers.get("$updateConfigurationOption")([null, "files.autoSave", "off", {}, false])
  await new Promise((resolve) => setImmediate(resolve))

  const data = server.handlers.get("$fetchConfiguration")([])
  assert.equal(settings.readUserSettings()["files.autoSave"], undefined)
  assert.equal(data.workspace.contents.files.autoSave, "off")
  assert.equal(calls.length, 1)
  assert.equal(calls[0][2][0].workspace.contents.files.autoSave, "off")

  server.handlers.get("$removeConfigurationOption")([null, "files.autoSave", {}, false])
  await new Promise((resolve) => setImmediate(resolve))

  const nextData = server.handlers.get("$fetchConfiguration")([])
  assert.equal(settings.readUserSettings()["files.autoSave"], undefined)
  assert.equal(nextData.workspace.contents.files, undefined)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1][2][1].keys, ["files.autoSave"])
})

test("mainThreadConfiguration honors user and workspace targets without splitting state sources", async () => {
  const { configuration, settings } = loadModules()
  const server = createServer()
  const calls = []
  configuration.register(server, {
    callEh: async (...args) => {
      calls.push(args)
    },
  })

  server.handlers.get("$updateConfigurationOption")([5, "files.autoSave", "afterDelay", {}, false])
  server.handlers.get("$updateConfigurationOption")([2, "editor.fontSize", 22, {}, false])
  await new Promise((resolve) => setImmediate(resolve))

  const data = server.handlers.get("$fetchConfiguration")([])
  assert.equal(settings.readUserSettings()["editor.fontSize"], 22)
  assert.equal(settings.readUserSettings()["files.autoSave"], undefined)
  assert.equal(data.userLocal.contents.editor.fontSize, 22)
  assert.equal(data.workspace.contents.files.autoSave, "afterDelay")
  assert.equal(calls.length, 2)
  assert.equal(calls[0][2][0].workspace.contents.files.autoSave, "afterDelay")
  assert.equal(calls[1][2][0].userLocal.contents.editor.fontSize, 22)
})

test("mainThreadConfiguration broadcasts external user settings file writes", async () => {
  const { configuration, settings } = loadModules()
  const server = createServer()
  const calls = []
  configuration.register(server, {
    callEh: async (...args) => {
      calls.push(args)
    },
  })

  settings.writeUserSettings({
    "editor.fontSize": 19,
    "files.autoSave": "off",
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], configuration.EXT_HOST_CONFIGURATION_NID)
  assert.deepEqual(calls[0][2][1].keys, ["editor.fontSize", "files.autoSave"])
  assert.equal(calls[0][2][0].userLocal.contents.editor.fontSize, 19)
})

test("mainThreadConfiguration builds deduplicated change events", () => {
  const { configuration } = loadModules()

  assert.deepEqual(configuration.buildConfigurationChange(["editor.fontSize", "", "editor.fontSize", null]), {
    keys: ["editor.fontSize"],
    overrides: [],
  })
})

test("mainThreadConfiguration builds language override models and change events", () => {
  const { configuration } = loadModules()

  const model = configuration.buildConfigModel({
    "[typescript]": {
      "editor.tabSize": 4,
      "editor.insertSpaces": true,
    },
  })

  assert.deepEqual(model.contents, {})
  assert.deepEqual(model.keys, [])
  assert.deepEqual(model.overrides, [{
    identifiers: ["typescript"],
    contents: {
      editor: {
        tabSize: 4,
        insertSpaces: true,
      },
    },
    keys: ["editor.tabSize", "editor.insertSpaces"],
  }])
  assert.deepEqual(configuration.buildConfigurationChange(["[typescript]", "[typescript]"]), {
    keys: [],
    overrides: ["typescript"],
  })
})

test("mainThreadConfiguration applies extension contributed configuration defaults", async () => {
  const { configuration } = loadModules()
  const server = createServer()
  const calls = []
  configuration.register(server, {
    callEh: async (...args) => {
      calls.push(args)
    },
  })

  server.handlers.get("$acceptConfigurationDefaults")([{
    configurationDefaults: {
      "editor.fontSize": 16,
    },
    configuration: {
      properties: {
        "codek.sample.enabled": {
          type: "boolean",
          default: true,
        },
      },
    },
  }])
  await new Promise((resolve) => setImmediate(resolve))

  const data = server.handlers.get("$fetchConfiguration")([])
  assert.equal(data.defaults.contents.editor.fontSize, 16)
  assert.equal(data.defaults.contents.codek.sample.enabled, true)
  assert.ok(data.defaults.keys.includes("editor.fontSize"))
  assert.ok(data.defaults.keys.includes("codek.sample.enabled"))
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0][2][1], {
    keys: ["editor.fontSize", "codek.sample.enabled"],
    overrides: [],
  })
})

test("mainThreadConfiguration exposes workspace and folder scoped configuration models", () => {
  const { configuration } = loadModules()

  configuration.setWorkspaceConfiguration({
    "editor.fontSize": 18,
  })
  configuration.setFolderConfigurations([{
    uri: "file:///workspace/app",
    name: "app",
    configuration: {
      "files.autoSave": "off",
    },
  }])

  const data = configuration.buildConfigurationData()
  assert.equal(data.workspace.contents.editor.fontSize, 18)
  assert.equal(data.folders.length, 1)
  assert.equal(data.folders[0].uri, "file:///workspace/app")
  assert.equal(data.folders[0].name, "app")
  assert.equal(data.folders[0].index, 0)
  assert.equal(data.folders[0].configuration.contents.files.autoSave, "off")
  assert.ok(data.configurationScopes.some(([key]) => key === "editor.fontSize"))
  assert.ok(data.configurationScopes.some(([key]) => key === "files.autoSave"))
})

test("mainThreadConfiguration registration exposes callbacks for defaults and scopes", async () => {
  const { configuration } = loadModules()
  const server = createServer()
  const calls = []
  let acceptDefaults
  let setWorkspace
  let setFolders

  configuration.register(server, {
    callEh: async (...args) => {
      calls.push(args)
    },
    registerConfigurationDefaults(callback) {
      acceptDefaults = callback
    },
    setWorkspaceConfiguration(callback) {
      setWorkspace = callback
    },
    setFolderConfigurations(callback) {
      setFolders = callback
    },
  })

  acceptDefaults({
    configurationDefaults: {
      "editor.tabSize": 8,
    },
  })
  setWorkspace({
    "files.trimTrailingWhitespace": true,
  })
  setFolders([{
    uri: "file:///workspace/pkg",
    name: "pkg",
    configuration: {
      "editor.wordWrap": "on",
    },
  }])
  await new Promise((resolve) => setImmediate(resolve))

  const data = server.handlers.get("$fetchConfiguration")([])
  assert.equal(data.defaults.contents.editor.tabSize, 8)
  assert.equal(data.workspace.contents.files.trimTrailingWhitespace, true)
  assert.equal(data.folders[0].configuration.contents.editor.wordWrap, "on")
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0][2][1], {
    keys: ["editor.tabSize"],
    overrides: [],
  })
})
