const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

function loadService() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-profiles-"))
  process.env.CODEK_DATA = tempDir
  const modulePath = path.resolve(__dirname, "index.js")
  delete require.cache[modulePath]
  return {
    tempDir,
    service: require(modulePath),
  }
}

test("desktop user data profile service writes profile state under Codek User data", () => {
  const { tempDir, service } = loadService()

  const result = service.writeWorkbenchProfileState({
    activeProfileId: "desktop-profile",
    profiles: [
      {
        id: "desktop-profile",
        name: "Desktop Profile",
        settings: { "editor.fontSize": 16 },
      },
    ],
  })

  assert.equal(result.activeProfileId, "desktop-profile")
  assert.equal(result.version, 2)
  assert.equal(result.profiles.length, 1)
  assert.deepEqual(result.profileAssociations, { workspaces: {}, emptyWindows: {} })
  assert.ok(result.path.endsWith(path.join(".codek", "User", "profiles", "workbenchProfiles.json")) || result.path.startsWith(tempDir))

  const read = service.readWorkbenchProfileState()
  assert.equal(read.exists, true)
  assert.equal(read.activeProfileId, "desktop-profile")
  assert.deepEqual(read.profiles[0].settings, { "editor.fontSize": 16 })
})

test("desktop user data profile service registers workbench profile routes", async () => {
  const { service } = loadService()
  const routes = new Map()
  const changes = []
  const router = {
    register(method, routePath, handler) {
      routes.set(`${method} ${routePath}`, handler)
    },
  }

  service.register(router, {
    onDidChangeWorkbenchProfiles(event) {
      changes.push(event)
    },
  })
  await routes.get("PUT /profiles/workbench")({
    body: {
      activeProfileId: "active",
      profiles: [{ id: "active", name: "Active", settings: {} }],
    },
  })
  const result = await routes.get("GET /profiles/workbench")({ query: {} })

  assert.equal(result.exists, true)
  assert.equal(result.activeProfileId, "active")
  assert.equal(result.profiles[0].name, "Active")
  assert.equal(changes.length, 1)
  assert.equal(changes[0].reason, "profiles:write")
  assert.equal(changes[0].activeProfileId, "active")
  assert.deepEqual(changes[0].profileIds, ["active"])
  assert.equal(changes[0].profileCount, 1)
})

test("desktop user data profile service reads and updates VS Code style profile scoped storage", async () => {
  const { service } = loadService()
  const changes = []

  let result = service.updateProfileStorageData("profile-a", {
    data: {
      "workbench.panel.defaultLocation": "bottom",
      "machine.only": { value: "local", target: 1 },
    },
  }, {
    onDidChangeWorkbenchProfiles(event) {
      changes.push(event)
    },
  })

  assert.equal(result.profileId, "profile-a")
  assert.equal(result.entries["workbench.panel.defaultLocation"].value, "bottom")
  assert.equal(result.entries["workbench.panel.defaultLocation"].target, 0)
  assert.equal(result.entries["workbench.panel.defaultLocation"].scope, 0)
  assert.equal(result.entries["machine.only"].target, 1)
  assert.equal(changes.length, 1)
  assert.equal(changes[0].reason, "storage:update")
  assert.equal(changes[0].profileId, "profile-a")
  assert.deepEqual(changes[0].storageKeys.sort(), ["machine.only", "workbench.panel.defaultLocation"])

  result = service.updateProfileStorageData("profile-a", {
    data: {
      "workbench.panel.defaultLocation": null,
    },
  })

  assert.equal(result.entries["workbench.panel.defaultLocation"], undefined)
  assert.equal(result.entries["machine.only"].value, "local")

  const read = service.readProfileStorageData("profile-a")
  assert.equal(read.profileId, "profile-a")
  assert.equal(read.entries["machine.only"].value, "local")
  assert.equal(read.entries["machine.only"].target, 1)
})

test("desktop user data profile service registers profile scoped storage routes", async () => {
  const { service } = loadService()
  const routes = new Map()
  const changes = []
  const router = {
    register(method, routePath, handler) {
      routes.set(`${method} ${routePath}`, handler)
    },
  }

  service.register(router, {
    onDidChangeWorkbenchProfiles(event) {
      changes.push(event)
    },
  })

  const updated = await routes.get("PUT /profiles/workbench/:profileId/storage")({
    params: { profileId: "route-profile" },
    body: {
      data: {
        "global.state": { value: "enabled", target: 0, scope: 0 },
      },
      target: 0,
      scope: 0,
    },
  })
  const read = await routes.get("GET /profiles/workbench/:profileId/storage")({
    params: { profileId: "route-profile" },
  })

  assert.equal(updated.entries["global.state"].value, "enabled")
  assert.deepEqual(read.entries, updated.entries)
  assert.equal(changes.at(-1).reason, "storage:update")
  assert.equal(changes.at(-1).profileId, "route-profile")
  assert.deepEqual(changes.at(-1).storageKeys, ["global.state"])
})

test("desktop user data profile service stores VS Code style workspace associations", async () => {
  const { tempDir, service } = loadService()
  const workspace = path.join(tempDir, "workspace-root")
  const changes = []
  service.writeWorkbenchProfileState({
    activeProfileId: "global",
    profiles: [
      { id: "global", name: "Global", settings: {} },
      { id: "workspace-profile", name: "Workspace Profile", settings: {} },
    ],
    profileAssociations: {
      workspaces: {
        "file:///already-associated": "global",
      },
    },
  })

  const routes = new Map()
  const router = {
    register(method, routePath, handler) {
      routes.set(`${method} ${routePath}`, handler)
    },
  }

  service.register(router, {
    onDidChangeWorkbenchProfiles(event) {
      changes.push(event)
    },
  })
  const associated = await routes.get("PUT /profiles/workbench/workspace")({
    body: { workspace, profileId: "workspace-profile" },
  })
  const workspaceKey = service.normalizeWorkspaceKey(workspace)

  assert.equal(associated.workspaceProfileId, "workspace-profile")
  assert.equal(associated.profileAssociations.workspaces[workspaceKey], "workspace-profile")
  assert.equal(associated.profileAssociations.workspaces["file:///already-associated"], "global")
  assert.equal(changes.at(-1).reason, "workspace:set")
  assert.equal(changes.at(-1).workspace, workspaceKey)
  assert.equal(changes.at(-1).workspaceProfileId, "workspace-profile")
  assert.equal(changes.at(-1).profileAssociations.workspaces[workspaceKey], "workspace-profile")

  const lookup = await routes.get("GET /profiles/workbench/workspace")({ query: { workspace } })
  assert.deepEqual(lookup, {
    workspace: workspaceKey,
    profileId: "workspace-profile",
  })

  const stateForWorkspace = await routes.get("GET /profiles/workbench")({ query: { workspace } })
  assert.equal(stateForWorkspace.workspaceProfileId, "workspace-profile")

  const removed = await routes.get("DELETE /profiles/workbench/workspace")({ body: { workspace } })
  assert.equal(removed.workspaceProfileId, undefined)
  assert.equal(removed.profileAssociations.workspaces[workspaceKey], undefined)
  assert.equal(removed.profileAssociations.workspaces["file:///already-associated"], "global")
  assert.equal(changes.at(-1).reason, "workspace:unset")
  assert.equal(changes.at(-1).workspace, workspaceKey)
  assert.equal(changes.at(-1).workspaceProfileId, "")
})

test("desktop user data profile service preserves workspace associations when route writes only profiles", async () => {
  const { tempDir, service } = loadService()
  const workspace = path.join(tempDir, "workspace-root")
  const workspaceKey = service.normalizeWorkspaceKey(workspace)

  service.writeWorkbenchProfileState({
    activeProfileId: "workspace-profile",
    profiles: [{ id: "workspace-profile", name: "Workspace Profile", settings: {} }],
    profileAssociations: {
      workspaces: { [workspaceKey]: "workspace-profile" },
      emptyWindows: { "empty-window": "workspace-profile" },
    },
  })

  const routes = new Map()
  const router = {
    register(method, routePath, handler) {
      routes.set(`${method} ${routePath}`, handler)
    },
  }
  service.register(router)

  await routes.get("PUT /profiles/workbench")({
    body: {
      activeProfileId: "workspace-profile",
      profiles: [{ id: "workspace-profile", name: "Renamed", settings: {} }],
    },
  })

  const result = service.readWorkbenchProfileState({ workspace })
  assert.equal(result.workspaceProfileId, "workspace-profile")
  assert.deepEqual(result.profileAssociations, {
    workspaces: { [workspaceKey]: "workspace-profile" },
    emptyWindows: { "empty-window": "workspace-profile" },
  })
})

test("desktop user data profile service ignores invalid profile JSON without crashing", () => {
  const { service } = loadService()
  fs.mkdirSync(path.dirname(service.WORKBENCH_PROFILES_FILE), { recursive: true })
  fs.writeFileSync(service.WORKBENCH_PROFILES_FILE, "{ invalid", "utf8")

  const result = service.readWorkbenchProfileState()

  assert.equal(result.exists, true)
  assert.equal(result.invalid, true)
  assert.deepEqual(result.profiles, [])
})
