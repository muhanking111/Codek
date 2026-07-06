const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

function createServer() {
  const handlers = new Map()
  return {
    handlers,
    onRpc(method, handler) {
      handlers.set(method, handler)
    },
    call(method, args) {
      const handler = handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [], { reqId: 1 })
    },
  }
}

function loadServices() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-main-thread-storage-"))
  process.env.CODEK_DATA = tempDir
  const profilePath = path.resolve(__dirname, "../../userDataProfile/index.js")
  const storagePath = path.resolve(__dirname, "mainThreadStorage.js")
  delete require.cache[profilePath]
  delete require.cache[storagePath]
  return {
    tempDir,
    profileService: require(profilePath),
    mainThreadStorage: require(storagePath),
  }
}

test("MainThreadStorage stores extension globalState in VS Code profile scoped storage", () => {
  const { profileService, mainThreadStorage } = loadServices()
  const server = createServer()
  const changes = []
  mainThreadStorage.register(server, {
    onDidChangeWorkbenchProfiles(event) {
      changes.push(event)
    },
  })

  server.call("$setValue", [true, "publisher.extension", { enabled: true, nested: { value: 1 } }])

  const raw = server.call("$initializeExtensionStorage", [true, "publisher.extension"])
  assert.equal(raw, JSON.stringify({ enabled: true, nested: { value: 1 } }))

  const snapshot = profileService.readProfileStorageData(profileService.DEFAULT_PROFILE_ID)
  assert.equal(snapshot.entries["publisher.extension"].value, JSON.stringify({ enabled: true, nested: { value: 1 } }))
  assert.equal(snapshot.entries["publisher.extension"].scope, profileService.STORAGE_SCOPE.PROFILE)
  assert.equal(snapshot.entries["publisher.extension"].target, profileService.STORAGE_TARGET.MACHINE)
  assert.equal(changes.at(-1).reason, "extension-storage:update")
  assert.deepEqual(changes.at(-1).storageKeys, ["publisher.extension"])
})

test("MainThreadStorage keeps workspaceState isolated from globalState", () => {
  const { profileService, mainThreadStorage } = loadServices()
  const server = createServer()
  mainThreadStorage.register(server, {
    workspace: "D:\\Workspace\\workspace-a",
  })

  server.call("$setValue", [true, "publisher.extension", { shared: true }])
  server.call("$setValue", [false, "publisher.extension", { local: true }])

  assert.equal(server.call("$initializeExtensionStorage", [true, "publisher.extension"]), JSON.stringify({ shared: true }))
  assert.equal(server.call("$initializeExtensionStorage", [false, "publisher.extension"]), JSON.stringify({ local: true }))

  const snapshot = profileService.readProfileStorageData(profileService.DEFAULT_PROFILE_ID)
  assert.equal(snapshot.entries["publisher.extension"].value, JSON.stringify({ shared: true }))
  assert.equal(snapshot.entries["workspace/file:///D:/Workspace/workspace-a/publisher.extension"].value, JSON.stringify({ local: true }))
  assert.equal(snapshot.entries["workspace/file:///D:/Workspace/workspace-a/publisher.extension"].scope, profileService.STORAGE_SCOPE.WORKSPACE)
})

test("MainThreadStorage records extension globalState sync keys like VS Code ExtensionStorageService", () => {
  const { profileService, mainThreadStorage } = loadServices()
  const server = createServer()
  mainThreadStorage.register(server)

  server.call("$registerExtensionStorageKeysToSync", [{ id: "Publisher.Extension", version: "1.2.3" }, ["token", "recent"]])

  const snapshot = profileService.readProfileStorageData(profileService.DEFAULT_PROFILE_ID)
  const key = "extensionKeys/publisher.extension@1.2.3"
  assert.equal(snapshot.entries[key].value, JSON.stringify(["token", "recent"]))
  assert.equal(snapshot.entries[key].scope, profileService.STORAGE_SCOPE.PROFILE)
  assert.equal(snapshot.entries[key].target, profileService.STORAGE_TARGET.MACHINE)
})

test("MainThreadStorage migrates legacy ext-host-storage globalState on first read", () => {
  const { tempDir, profileService, mainThreadStorage } = loadServices()
  fs.writeFileSync(path.join(tempDir, "ext-host-storage.json"), JSON.stringify({
    _global: {
      "publisher.legacy": { migrated: true },
    },
  }), "utf8")
  const server = createServer()
  mainThreadStorage.register(server)

  const raw = server.call("$initializeExtensionStorage", [true, "publisher.legacy"])

  assert.equal(raw, JSON.stringify({ migrated: true }))
  const snapshot = profileService.readProfileStorageData(profileService.DEFAULT_PROFILE_ID)
  assert.equal(snapshot.entries["publisher.legacy"].value, JSON.stringify({ migrated: true }))
})

test("MainThreadStorage exposes owner evidence for the desktop profile bridge", () => {
  const { mainThreadStorage } = loadServices()

  assert.deepEqual(mainThreadStorage.getOwnerEvidence(), {
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
  })
})
