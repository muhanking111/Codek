const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const router = require("../router")

function loadMigration(codekData = fs.mkdtempSync(path.join(os.tmpdir(), "codek-data-import-"))) {
  const previous = process.env.CODEK_DATA
  process.env.CODEK_DATA = codekData
  delete require.cache[require.resolve("../settings")]
  delete require.cache[require.resolve("./vscodeImport")]
  const settings = require("../settings")
  const migration = require("./vscodeImport")
  if (previous == null) delete process.env.CODEK_DATA
  else process.env.CODEK_DATA = previous
  return { settings, migration, codekData }
}

function makeSource() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-vscode-import-"))
  const userDir = path.join(root, "Code", "User")
  fs.mkdirSync(path.join(userDir, "snippets"), { recursive: true })
  fs.mkdirSync(path.join(userDir, "profiles", "work", "snippets"), { recursive: true })
  fs.mkdirSync(path.join(root, "extensions"), { recursive: true })
  fs.writeFileSync(path.join(userDir, "settings.json"), "{\n  // comment\n  \"editor.fontSize\": 16,\n  \"workbench.colorTheme\": \"Default Dark Modern\"\n}\n")
  fs.writeFileSync(path.join(userDir, "keybindings.json"), "[{\"key\":\"ctrl+k ctrl+s\",\"command\":\"workbench.action.openGlobalKeybindings\"}]\n")
  fs.writeFileSync(path.join(userDir, "tasks.json"), "{\"version\":\"2.0.0\",\"tasks\":[{\"label\":\"build\"}]}\n")
  fs.writeFileSync(path.join(userDir, "mcp.json"), "{\"servers\":{\"local\":{\"command\":\"node\"}}}\n")
  fs.writeFileSync(path.join(userDir, "snippets", "javascript.json"), "{\"Print\":{\"prefix\":\"print\",\"body\":\"return $1\"}}\n")
  fs.writeFileSync(path.join(userDir, "profiles", "work", "settings.json"), "{\"editor.fontSize\": 18,\"workbench.colorTheme\":\"Cursor Dark\"}\n")
  fs.writeFileSync(path.join(userDir, "profiles", "work", "keybindings.json"), "[{\"key\":\"ctrl+shift+p\",\"command\":\"workbench.action.showCommands\"}]\n")
  fs.writeFileSync(path.join(userDir, "profiles", "work", "tasks.json"), "{\"version\":\"2.0.0\",\"tasks\":[{\"label\":\"test\"}]}\n")
  fs.writeFileSync(path.join(userDir, "profiles", "work", "mcp.json"), "{\"servers\":{\"profile\":{\"command\":\"node\"}}}\n")
  fs.writeFileSync(path.join(userDir, "profiles", "work", "snippets", "typescript.json"), "{\"Type\":{\"prefix\":\"type\",\"body\":\"type $1 = $2\"}}\n")
  fs.writeFileSync(path.join(root, "extensions", "extensions.json"), JSON.stringify([
    { identifier: { id: "ms-python.python" } },
    { identifier: { id: "Vue.volar" } },
  ]))
  return { root, userDir }
}

test("stripJsonComments preserves URLs while removing JSONC comments", () => {
  const { migration } = loadMigration()
  const text = migration.stripJsonComments('{"url":"https://example.com","a":1 // tail\n}')
  assert.match(text, /https:\/\/example\.com/)
  assert.doesNotMatch(text, /tail/)
})

test("getCandidateSources detects Windows VS Code and Cursor user dirs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-vscode-candidates-"))
  const appData = path.join(root, "Roaming")
  fs.mkdirSync(path.join(appData, "Cursor", "User"), { recursive: true })
  const { migration } = loadMigration()
  const sources = migration.getCandidateSources({ platform: "win32", env: { APPDATA: appData }, homedir: root })
  const cursor = sources.find((item) => item.app === "cursor")
  assert.equal(cursor.exists, true)
  assert.match(cursor.userDir, /Cursor/)
})

test("previewSource reads settings, keybindings, snippets, and extensions", () => {
  const { userDir } = makeSource()
  const { migration } = loadMigration()
  const preview = migration.previewSource(userDir)

  assert.equal(preview.settingsCount, 2)
  assert.equal(preview.keybindingsCount, 1)
  assert.equal(preview.snippetsCount, 1)
  assert.equal(preview.profilesCount, 1)
  assert.equal(preview.profiles[0].id, "work")
  assert.deepEqual(preview.extensions, ["Vue.volar", "ms-python.python"])
  assert.equal(preview.profileTemplate.name, "默认配置")
  assert.deepEqual(JSON.parse(JSON.parse(preview.profileTemplate.settings).settings), {
    "editor.fontSize": 16,
    "workbench.colorTheme": "Default Dark Modern",
  })
  assert.deepEqual(JSON.parse(JSON.parse(preview.profileTemplate.tasks).tasks), {
    version: "2.0.0",
    tasks: [{ label: "build" }],
  })
  assert.deepEqual(JSON.parse(JSON.parse(preview.profileTemplate.mcp).mcp), {
    servers: { local: { command: "node" } },
  })
  assert.deepEqual(
    JSON.parse(preview.profileTemplate.extensions).map((entry) => entry.identifier.id),
    ["Vue.volar", "ms-python.python"],
  )
})

test("importSource imports settings, keybindings, snippets, and extension manifest", () => {
  const codekData = fs.mkdtempSync(path.join(os.tmpdir(), "codek-data-import-"))
  const { userDir } = makeSource()
  const { settings, migration } = loadMigration(codekData)

  const result = migration.importSource(userDir, { mode: "replace" })
  assert.equal(result.settings.imported, 2)
  assert.equal(result.keybindings.imported, 1)
  assert.equal(result.snippets.imported, 1)
  assert.equal(result.extensions.imported, 2)
  assert.equal(result.profileTemplate.name, "默认配置")
  assert.deepEqual(JSON.parse(JSON.parse(result.profileTemplate.keybindings).keybindings)[0], {
    key: "ctrl+k ctrl+s",
    command: "workbench.action.openGlobalKeybindings",
  })
  assert.equal(result.profileSnapshot.id, "imported-vscode-default")
  assert.equal(result.profileSnapshot.source, "vscode")
  assert.equal(result.profileSnapshot.settings["editor.fontSize"], 16)
  assert.equal(result.profileSnapshot.keybindings[0].command, "workbench.action.openGlobalKeybindings")
  assert.equal(settings.readUserSettings()["editor.fontSize"], 16)
  assert.equal(settings.readUserKeybindings()[0].command, "workbench.action.openGlobalKeybindings")
  assert.equal(fs.existsSync(path.join(codekData, "User", "snippets", "javascript.json")), true)
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(codekData, "User", "migration", "vscode-extensions.json"), "utf8")).extensions,
    ["Vue.volar", "ms-python.python"],
  )
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(codekData, "User", "migration", "vscode-extensions.json"), "utf8")).installPolicy,
    "user-confirmed",
  )
})

test("extension install queue exposes pending, installed, and failed migration items", () => {
  const codekData = fs.mkdtempSync(path.join(os.tmpdir(), "codek-data-extension-queue-"))
  const { userDir } = makeSource()
  const { migration } = loadMigration(codekData)

  migration.importSource(userDir, { mode: "replace" })
  const initial = migration.readExtensionInstallQueue()
  assert.equal(initial.exists, true)
  assert.equal(initial.total, 2)
  assert.equal(initial.pending, 2)
  assert.equal(initial.installPolicy, "user-confirmed")
  assert.deepEqual(initial.extensions.map((entry) => entry.status), ["pending", "pending"])

  const installed = migration.updateExtensionInstallQueueStatus("ms-python.python", "installed")
  assert.equal(installed.installed, 1)
  assert.equal(installed.pending, 1)
  assert.equal(installed.extensions.find((entry) => entry.id === "ms-python.python").status, "installed")

  const failed = migration.updateExtensionInstallQueueStatus("Vue.volar", "failed", { error: "网络不可用" })
  const volar = failed.extensions.find((entry) => entry.id === "Vue.volar")
  assert.equal(failed.failed, 1)
  assert.equal(volar.status, "failed")
  assert.equal(volar.error, "网络不可用")

  const retried = migration.updateExtensionInstallQueueStatus("Vue.volar", "pending")
  assert.equal(retried.failed, 0)
  assert.equal(retried.pending, 1)
})

test("importSource can import a selected VS Code profile", () => {
  const codekData = fs.mkdtempSync(path.join(os.tmpdir(), "codek-data-profile-import-"))
  const { userDir } = makeSource()
  const { settings, migration } = loadMigration(codekData)

  const result = migration.importSource(userDir, { mode: "replace", profileId: "work" })
  assert.equal(result.profileId, "work")
  assert.equal(result.settings.imported, 2)
  assert.equal(result.profileTemplate.name, "work")
  assert.equal(JSON.parse(JSON.parse(result.profileTemplate.settings).settings)["editor.fontSize"], 18)
  assert.equal(JSON.parse(JSON.parse(result.profileTemplate.tasks).tasks).tasks[0].label, "test")
  assert.deepEqual(JSON.parse(JSON.parse(result.profileTemplate.mcp).mcp), {
    servers: { profile: { command: "node" } },
  })
  assert.equal(result.profileSnapshot.id, "imported-vscode-work")
  assert.equal(result.profileSnapshot.settings["workbench.colorTheme"], "Cursor Dark")
  assert.equal(settings.readUserSettings()["editor.fontSize"], 18)
  assert.equal(settings.readUserKeybindings()[0].command, "workbench.action.showCommands")
  assert.equal(fs.existsSync(path.join(codekData, "User", "snippets", "typescript.json")), true)
})

test("importSource snapshots the effective merged profile without requiring the UI to reread files", () => {
  const codekData = fs.mkdtempSync(path.join(os.tmpdir(), "codek-data-profile-merge-"))
  const { userDir } = makeSource()
  const { settings, migration } = loadMigration(codekData)
  settings.writeUserSettings({ "files.autoSave": "afterDelay", "editor.fontSize": 12 })
  settings.writeUserKeybindings([{ key: "ctrl+o", command: "workbench.action.files.openFile" }])

  const result = migration.importSource(userDir, { mode: "merge", profileId: "default" })

  assert.deepEqual(result.profileSnapshot.settings, {
    "files.autoSave": "afterDelay",
    "editor.fontSize": 16,
    "workbench.colorTheme": "Default Dark Modern",
  })
  assert.deepEqual(result.profileSnapshot.keybindings.map((entry) => entry.command), [
    "workbench.action.files.openFile",
    "workbench.action.openGlobalKeybindings",
  ])
  assert.deepEqual(settings.readUserSettings(), result.profileSnapshot.settings)
  assert.deepEqual(settings.readUserKeybindings(), result.profileSnapshot.keybindings)
})

test("profile file import/export follows VS Code .code-profile template contract", () => {
  const { migration } = loadMigration()
  const profileFile = path.join(os.tmpdir(), `codek-profile-${Date.now()}.code-profile`)
  const template = {
    name: "Work",
    settings: JSON.stringify({
      settings: JSON.stringify({ "editor.fontSize": 17 }),
    }),
    keybindings: JSON.stringify({
      keybindings: JSON.stringify([{ key: "ctrl+k ctrl+s", command: "workbench.action.openGlobalKeybindings" }]),
      platform: "win32",
    }),
  }

  const exported = migration.exportProfileFile(profileFile, template)
  assert.equal(exported.saved, true)
  assert.equal(exported.filePath, profileFile)
  assert.equal(path.extname(exported.filePath), ".code-profile")
  assert.ok(exported.bytesWritten > 0)

  const imported = migration.importProfileFile(profileFile)
  assert.equal(imported.filePath, profileFile)
  assert.deepEqual(imported.profileTemplate, template)
})

test("migration routes expose preview and import", async () => {
  router.clearRoutes()
  const { migration } = loadMigration()
  migration.register(router)
  const { userDir } = makeSource()
  const preview = await router.dispatch({
    method: "POST",
    path: "/migration/vscode/preview",
    body: { userDir },
  })
  assert.equal(preview.ok, true)
  assert.equal(preview.data.settingsCount, 2)
})

test("migration routes expose extension install queue and status updates", async () => {
  router.clearRoutes()
  const codekData = fs.mkdtempSync(path.join(os.tmpdir(), "codek-data-route-queue-"))
  const { migration } = loadMigration(codekData)
  migration.register(router)
  const { userDir } = makeSource()

  const imported = await router.dispatch({
    method: "POST",
    path: "/migration/vscode/import",
    body: { userDir, mode: "replace" },
  })
  assert.equal(imported.ok, true)

  const queue = await router.dispatch({ method: "GET", path: "/migration/vscode/extensions" })
  assert.equal(queue.ok, true)
  assert.equal(queue.data.pending, 2)

  const marked = await router.dispatch({
    method: "POST",
    path: "/migration/vscode/extensions/status",
    body: { extensionId: "ms-python.python", status: "installed" },
  })
  assert.equal(marked.ok, true)
  assert.equal(marked.data.installed, 1)
})
