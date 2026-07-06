const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

function loadSettingsService() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-settings-"))
  process.env.CODEK_DATA = tempDir
  const modulePath = path.resolve(__dirname, "../index.js")
  delete require.cache[modulePath]
  return {
    tempDir,
    service: require(modulePath),
  }
}

test("desktop settings service writes VS Code style flat keys", () => {
  const { service } = loadSettingsService()

  service.updateUserSetting("editor.fontSize", 18)
  service.updateUserSetting("files.autoSave", "afterDelay")

  assert.deepEqual(service.readUserSettings(), {
    "editor.fontSize": 18,
    "files.autoSave": "afterDelay",
  })
})

test("desktop settings service ignores invalid settings JSON", () => {
  const { service } = loadSettingsService()

  fs.mkdirSync(path.dirname(service.USER_SETTINGS_FILE), { recursive: true })
  fs.writeFileSync(service.USER_SETTINGS_FILE, "[]", "utf8")

  assert.deepEqual(service.readUserSettings(), {})
})

test("desktop settings service registers user settings routes", async () => {
  const { service } = loadSettingsService()
  const routes = new Map()
  const router = {
    register(method, routePath, handler) {
      routes.set(`${method} ${routePath}`, handler)
    },
  }

  service.register(router)
  await routes.get("PUT /settings/user")({
    body: {
      settings: {
        "editor.fontSize": 21,
      },
    },
  })
  const result = await routes.get("GET /settings/user")({ body: {} })

  assert.equal(result.settings["editor.fontSize"], 21)
  assert.ok(result.path.endsWith(path.join(".codek", "User", "settings.json")) || result.path.includes("settings.json"))
})

test("desktop settings service broadcasts route writes with changed keys and file path", async () => {
  const { service } = loadSettingsService()
  const routes = new Map()
  const broadcasts = []
  const router = {
    register(method, routePath, handler) {
      routes.set(`${method} ${routePath}`, handler)
    },
  }

  service.register(router, {
    onDidChangeUserSettings(event) {
      broadcasts.push(event)
    },
  })

  await routes.get("PUT /settings/user")({
    body: {
      settings: {
        "editor.fontSize": 21,
        "workbench.iconTheme": "vs-seti",
      },
    },
  })
  await routes.get("PATCH /settings/user")({
    body: {
      key: "workbench.iconTheme",
      value: "minimal",
    },
  })

  assert.deepEqual(broadcasts.map((event) => event.changedKeys), [
    ["editor.fontSize", "workbench.iconTheme"],
    ["workbench.iconTheme"],
  ])
  assert.equal(broadcasts[0].reason, "settings:write")
  assert.equal(broadcasts[0].version, 1)
  assert.ok(broadcasts[0].path.endsWith(path.join(".codek", "User", "settings.json")) || broadcasts[0].path.includes("settings.json"))
  assert.deepEqual(broadcasts.at(-1).settings, {
    "editor.fontSize": 21,
    "workbench.iconTheme": "minimal",
  })
})

test("desktop settings service emits changed flat keys after writes", () => {
  const { service } = loadSettingsService()
  const events = []
  const disposable = service.onDidChangeUserSettings((event) => events.push(event))

  service.writeUserSettings({
    "editor.fontSize": 18,
    "files.autoSave": "off",
  })
  service.updateUserSetting("editor.fontSize", 20)
  service.writeUserSettings({
    "editor.fontSize": 20,
  })
  disposable.dispose()

  assert.deepEqual(events.map((event) => event.changedKeys), [
    ["editor.fontSize", "files.autoSave"],
    ["editor.fontSize"],
    ["files.autoSave"],
  ])
  assert.deepEqual(events.at(-1).settings, {
    "editor.fontSize": 20,
  })
})

test("desktop settings service reads and writes VS Code keybindings file", async () => {
  const { service } = loadSettingsService()

  service.writeUserKeybindings([
    {
      key: "ctrl+s",
      command: "workbench.action.files.save",
      when: "editorTextFocus",
    },
  ])

  assert.deepEqual(service.readUserKeybindings(), [
    {
      key: "ctrl+s",
      command: "workbench.action.files.save",
      when: "editorTextFocus",
    },
  ])

  const routes = new Map()
  const router = {
    register(method, routePath, handler) {
      routes.set(`${method} ${routePath}`, handler)
    },
  }

  service.register(router)
  await routes.get("PUT /keybindings/user")({
    body: {
      keybindings: [
        {
          key: "ctrl+shift+p",
          command: "workbench.action.showCommands",
        },
      ],
    },
  })
  const result = await routes.get("GET /keybindings/user")({ body: {} })

  assert.deepEqual(result.keybindings, [
    {
      key: "ctrl+shift+p",
      command: "workbench.action.showCommands",
    },
  ])
  assert.ok(result.path.endsWith(path.join(".codek", "User", "keybindings.json")) || result.path.includes("keybindings.json"))
})
