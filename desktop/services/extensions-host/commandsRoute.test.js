const assert = require("node:assert/strict")
const test = require("node:test")

const router = require("../router")
const mainThreadCommands = require("./mainThread/mainThreadCommands")

function loadExtensionsHostWithFakeHost(fakeHost) {
  delete require.cache[require.resolve("./index")]
  const extensionsHost = require("./index")
  return {
    extensionsHost,
    register(router) {
      extensionsHost.register(router, { getHost: () => fakeHost })
    },
    restore() {
      delete require.cache[require.resolve("./index")]
    },
  }
}

test.afterEach(() => {
  router.clearRoutes()
})

test("commands execute route activates contributed command before delegating to ExtHostCommands", async () => {
  const calls = []
  const fakeHost = {
    isRunning: true,
    call: async (nid, method, args, timeoutMs) => {
      calls.push({ nid, method, args, timeoutMs })
      return method === "$executeContributedCommand" ? "command-result" : undefined
    },
  }
  const { register, restore } = loadExtensionsHostWithFakeHost(fakeHost)
  register(router)

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/commands/execute",
    body: { commandId: "sample.hello", args: ["from-menu"] },
  })

  restore()
  assert.equal(result.ok, true)
  assert.equal(result.data.success, true)
  assert.equal(result.data.result, "command-result")
  assert.equal(result.data.evidence.serviceId, "extensionHostCommandService")
  assert.equal(
    result.data.evidence.vscodeContract,
    "MainThreadCommands.$executeCommand -> ExtHostCommands.$executeContributedCommand",
  )
  assert.equal(result.data.evidence.stateSource, "mainThreadCommands+shared commandRegistry")
  assert.equal(result.data.evidence.commandId, "sample.hello")
  assert.equal(result.data.evidence.activationEvent, "onCommand:sample.hello")
  assert.equal(result.data.evidence.activationStatus, "requested")
  assert.equal(result.data.evidence.argsCount, 1)
  assert.equal(result.data.evidence.actorIds.mainThreadCommands, mainThreadCommands.MAIN_THREAD_COMMANDS_NID)
  assert.equal(result.data.evidence.actorIds.extHostCommands, mainThreadCommands.EXT_HOST_COMMANDS_NID)
  assert.equal(
    result.data.evidence.actorIds.extHostExtensionService,
    mainThreadCommands.EXT_HOST_EXTENSION_SERVICE_NID,
  )
  assert.equal(result.data.evidence.status, "executed")
  assert.equal(typeof result.data.evidence.createdAt, "number")
  assert.deepEqual(calls, [
    {
      nid: mainThreadCommands.EXT_HOST_EXTENSION_SERVICE_NID,
      method: "$activateByEvent",
      args: ["onCommand:sample.hello", 0],
      timeoutMs: 30000,
    },
    {
      nid: mainThreadCommands.EXT_HOST_COMMANDS_NID,
      method: "$executeContributedCommand",
      args: ["sample.hello", "from-menu"],
      timeoutMs: 30000,
    },
  ])
})

test("commands execute route reports Extension Host runtime failures without throwing", async () => {
  const fakeHost = {
    isRunning: true,
    call: async (_nid, method) => {
      if (method === "$executeContributedCommand") throw new Error("command failed")
      return undefined
    },
  }
  const { register, restore } = loadExtensionsHostWithFakeHost(fakeHost)
  register(router)

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/commands/execute",
    body: { commandId: "sample.fail", args: [] },
  })

  restore()
  assert.equal(result.ok, true)
  assert.equal(result.data.success, false)
  assert.equal(result.data.error, "command failed")
  assert.match(result.data.message, /扩展命令执行失败/)
  assert.equal(result.data.evidence.serviceId, "extensionHostCommandService")
  assert.equal(result.data.evidence.stateSource, "mainThreadCommands+shared commandRegistry")
  assert.equal(result.data.evidence.commandId, "sample.fail")
  assert.equal(result.data.evidence.activationEvent, "onCommand:sample.fail")
  assert.equal(result.data.evidence.activationStatus, "requested")
  assert.equal(result.data.evidence.argsCount, 0)
  assert.equal(result.data.evidence.status, "error")
  assert.equal(result.data.evidence.error, "command failed")
})

test("commands execute route returns command bridge evidence when extension host is unavailable", async () => {
  const fakeHost = {
    isRunning: false,
    call: async () => undefined,
  }
  const { register, restore } = loadExtensionsHostWithFakeHost(fakeHost)
  register(router)

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/commands/execute",
    body: { commandId: "sample.offline", args: ["kept"] },
  })

  restore()
  assert.equal(result.ok, true)
  assert.equal(result.data.success, false)
  assert.equal(result.data.error, "Extension host not running")
  assert.match(result.data.message, /扩展宿主未运行/)
  assert.equal(result.data.evidence.serviceId, "extensionHostCommandService")
  assert.equal(result.data.evidence.stateSource, "mainThreadCommands+shared commandRegistry")
  assert.equal(result.data.evidence.commandId, "sample.offline")
  assert.equal(result.data.evidence.activationEvent, "onCommand:sample.offline")
  assert.equal(result.data.evidence.activationStatus, "skipped")
  assert.equal(result.data.evidence.argsCount, 1)
  assert.equal(result.data.evidence.status, "error")
  assert.equal(result.data.evidence.error, "Extension host not running")
})

test("activation route delegates to ExtHostExtensionService and returns activation evidence", async () => {
  const calls = []
  const fakeHost = {
    isRunning: true,
    call: async (nid, method, args, timeoutMs) => {
      calls.push({ nid, method, args, timeoutMs })
      return undefined
    },
  }
  const { register, restore } = loadExtensionsHostWithFakeHost(fakeHost)
  register(router)

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/activate",
    body: {
      activationEvent: "onView:codek.extensionHost.surface",
      extensionId: "sample.extension",
    },
  })

  restore()
  assert.equal(result.ok, true)
  assert.equal(result.data.success, true)
  assert.equal(result.data.evidence.serviceId, "extensionHostService")
  assert.equal(result.data.evidence.stateSource, "extensionsWorkbenchService+ehClient")
  assert.equal(result.data.evidence.activationEvent, "onView:codek.extensionHost.surface")
  assert.equal(result.data.evidence.extensionId, "sample.extension")
  assert.equal(result.data.evidence.status, "activated")
  assert.equal(typeof result.data.evidence.createdAt, "number")
  assert.deepEqual(calls, [
    {
      nid: mainThreadCommands.EXT_HOST_EXTENSION_SERVICE_NID,
      method: "$activateByEvent",
      args: ["onView:codek.extensionHost.surface", 0],
      timeoutMs: 30000,
    },
  ])
})

test("activation route returns error evidence when extension host is unavailable", async () => {
  const fakeHost = {
    isRunning: false,
    call: async () => undefined,
  }
  const { register, restore } = loadExtensionsHostWithFakeHost(fakeHost)
  register(router)

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/activate",
    body: {
      activationEvent: "onStartupFinished",
      extensionId: "sample.extension",
    },
  })

  restore()
  assert.equal(result.ok, true)
  assert.equal(result.data.success, false)
  assert.equal(result.data.error, "Extension host not running")
  assert.match(result.data.message, /扩展宿主未运行/)
  assert.equal(result.data.evidence.status, "error")
  assert.equal(result.data.evidence.error, "Extension host not running")
})

test("lifecycle stop route returns VS Code-style stop evidence without reloading", async () => {
  let stopped = false
  const fakeHost = {
    isRunning: true,
    stop: () => {
      stopped = true
      fakeHost.isRunning = false
    },
  }
  const { register, restore } = loadExtensionsHostWithFakeHost(fakeHost)
  register(router)

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/lifecycle/stop",
    body: {
      reason: "Changing workspace trust",
      rootDir: "D:/Workspace",
      workspaceRoots: ["D:/Workspace"],
      workspaceFile: "D:/Workspace/codek.code-workspace",
    },
  })

  restore()
  assert.equal(result.ok, true)
  assert.equal(result.data.success, true)
  assert.equal(stopped, true)
  assert.equal(result.data.evidence.serviceId, "extensionHostLifecycleService")
  assert.equal(result.data.evidence.vscodeContract, "IExtensionService.stopExtensionHosts")
  assert.equal(result.data.evidence.action, "stopExtensionHosts")
  assert.equal(result.data.evidence.reason, "Changing workspace trust")
  assert.equal(result.data.evidence.auto, true)
  assert.equal(result.data.evidence.wasRunning, true)
  assert.equal(result.data.evidence.stopped, true)
  assert.equal(result.data.evidence.vetoed, false)
  assert.equal(result.data.evidence.rootDir, "D:/Workspace")
  assert.deepEqual(result.data.evidence.workspaceRoots, ["D:/Workspace"])
  assert.equal(result.data.evidence.workspaceFile, "D:/Workspace/codek.code-workspace")
})

test("lifecycle stop route reports VS Code-style onWillStop veto evidence", async () => {
  let stopped = false
  const fakeHost = {
    isRunning: true,
    stop: () => {
      stopped = true
    },
  }
  const { extensionsHost, restore } = loadExtensionsHostWithFakeHost(fakeHost)
  extensionsHost.register(router, {
    getHost: () => fakeHost,
    willStopVeto: async ({ reason, auto }) => {
      assert.equal(reason, "Changing workspace trust")
      assert.equal(auto, true)
      return "extension host stop vetoed by trust participant"
    },
  })

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/lifecycle/stop",
    body: { reason: "Changing workspace trust" },
  })

  restore()
  assert.equal(result.ok, true)
  assert.equal(result.data.success, true)
  assert.equal(stopped, false)
  assert.equal(result.data.evidence.vscodeContract, "IExtensionService.stopExtensionHosts")
  assert.equal(result.data.evidence.auto, true)
  assert.equal(result.data.evidence.wasRunning, true)
  assert.equal(result.data.evidence.stopped, false)
  assert.equal(result.data.evidence.vetoed, true)
  assert.equal(result.data.evidence.vetoReason, "extension host stop vetoed by trust participant")
})

test("lifecycle start route starts the extension host and waits for ready evidence", async () => {
  const calls = []
  const fakeHost = {
    isRunning: false,
    once(event, listener) {
      if (event === "ready") {
        fakeHost.readyListener = listener
      }
    },
    start(initData) {
      calls.push(initData)
      fakeHost.isRunning = true
      setImmediate(() => fakeHost.readyListener?.())
      return Promise.resolve()
    },
    _setWorkspaceRoots: (roots, workspaceFile) => {
      fakeHost.workspaceRoots = roots
      fakeHost.workspaceFile = workspaceFile
    },
    _registerConfigurationDefaults: () => {
      fakeHost.configurationDefaultsRegistered = true
    },
  }
  const { register, restore } = loadExtensionsHostWithFakeHost(fakeHost)
  register(router)

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/lifecycle/start",
    body: {
      reason: "Changing workspace trust",
      rootDir: "D:/Workspace",
      workspaceRoots: ["D:/Workspace"],
      workspaceFile: "D:/Workspace/codek.code-workspace",
    },
  })

  restore()
  assert.equal(result.ok, true)
  assert.equal(result.data.success, true)
  assert.deepEqual(calls, [{
    rootDir: "D:/Workspace",
    workspaceRoots: ["D:/Workspace"],
    workspaceFile: "D:/Workspace/codek.code-workspace",
  }])
  assert.deepEqual(fakeHost.workspaceRoots, ["D:/Workspace"])
  assert.equal(fakeHost.workspaceFile, "D:/Workspace/codek.code-workspace")
  assert.equal(fakeHost.configurationDefaultsRegistered, true)
  assert.equal(result.data.evidence.serviceId, "extensionHostLifecycleService")
  assert.equal(result.data.evidence.vscodeContract, "IExtensionService.startExtensionHosts")
  assert.equal(result.data.evidence.action, "startExtensionHosts")
  assert.equal(result.data.evidence.started, true)
})

test("lifecycle start route normalizes blank workspace roots before recording evidence", async () => {
  const calls = []
  const fakeHost = {
    isRunning: false,
    once(event, listener) {
      if (event === "ready") {
        fakeHost.readyListener = listener
      }
    },
    start(initData) {
      calls.push(initData)
      fakeHost.isRunning = true
      setImmediate(() => fakeHost.readyListener?.())
      return Promise.resolve()
    },
    _setWorkspaceRoots: (roots, workspaceFile) => {
      fakeHost.workspaceRoots = roots
      fakeHost.workspaceFile = workspaceFile
    },
    _registerConfigurationDefaults: () => {},
  }
  const { register, restore } = loadExtensionsHostWithFakeHost(fakeHost)
  register(router)

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/lifecycle/start",
    body: {
      reason: "Changing workspace trust",
      rootDir: "  D:/Fallback  ",
      workspaceRoots: ["", "  D:/Workspace  ", null],
      workspaceFile: "  D:/Workspace/codek.code-workspace  ",
    },
  })

  restore()
  assert.equal(result.ok, true)
  assert.equal(result.data.success, true)
  assert.deepEqual(calls, [{
    rootDir: "D:/Workspace",
    workspaceRoots: ["D:/Workspace"],
    workspaceFile: "D:/Workspace/codek.code-workspace",
  }])
  assert.deepEqual(result.data.evidence.workspaceRoots, ["D:/Workspace"])
  assert.equal(result.data.evidence.rootDir, "D:/Workspace")
  assert.equal(result.data.evidence.workspaceFile, "D:/Workspace/codek.code-workspace")
})

test("lifecycle restart route composes stop and start evidence without window reload", async () => {
  const calls = []
  const fakeHost = {
    isRunning: true,
    once(event, listener) {
      if (event === "ready") {
        fakeHost.readyListener = listener
      }
    },
    stop() {
      calls.push({ action: "stop" })
      fakeHost.isRunning = false
    },
    start(initData) {
      calls.push({ action: "start", initData })
      fakeHost.isRunning = true
      setImmediate(() => fakeHost.readyListener?.())
      return Promise.resolve()
    },
    _setWorkspaceRoots: (roots, workspaceFile) => {
      fakeHost.workspaceRoots = roots
      fakeHost.workspaceFile = workspaceFile
    },
    _registerConfigurationDefaults: () => {},
  }
  const { register, restore } = loadExtensionsHostWithFakeHost(fakeHost)
  register(router)

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/lifecycle/restart",
    body: {
      reason: "Changing workspace trust",
      rootDir: "D:/Workspace",
      workspaceRoots: ["D:/Workspace"],
      workspaceFile: "D:/Workspace/codek.code-workspace",
    },
  })

  restore()
  assert.equal(result.ok, true)
  assert.equal(result.data.success, true)
  assert.equal(result.data.evidence.serviceId, "extensionHostLifecycleService")
  assert.equal(result.data.evidence.stateSource, "desktop.extensionsHostService")
  assert.equal(
    result.data.evidence.vscodeContract,
    "IExtensionService.stopExtensionHosts+startExtensionHosts",
  )
  assert.equal(result.data.evidence.action, "restartExtensionHosts")
  assert.equal(result.data.evidence.restartRequested, true)
  assert.equal(result.data.evidence.restartObserved, true)
  assert.equal(result.data.evidence.restarted, true)
  assert.equal(result.data.evidence.hostKind, "LocalProcess")
  assert.equal(result.data.evidence.hostSource, "ExtensionHostServer")
  assert.equal(result.data.evidence.lifecyclePhase, "restarted")
  assert.equal(result.data.evidence.activationReplay, "preserveRequestedActivationEvents")
  assert.equal(result.data.evidence.blockedReason, "")
  assert.equal(result.data.evidence.reloadRequested, false)
  assert.equal(result.data.evidence.reloaded, false)
  assert.equal(result.data.evidence.stopEvidence.action, "stopExtensionHosts")
  assert.equal(result.data.evidence.stopEvidence.stopped, true)
  assert.equal(result.data.evidence.stopEvidence.lifecyclePhase, "stopped")
  assert.equal(result.data.evidence.stopEvidence.hostKind, "LocalProcess")
  assert.equal(result.data.evidence.stopEvidence.blockedReason, "")
  assert.equal(result.data.evidence.startEvidence.action, "startExtensionHosts")
  assert.equal(result.data.evidence.startEvidence.started, true)
  assert.equal(result.data.evidence.startEvidence.lifecyclePhase, "started")
  assert.equal(result.data.evidence.startEvidence.hostKind, "LocalProcess")
  assert.deepEqual(result.data.evidence.workspaceRoots, ["D:/Workspace"])
  assert.equal(result.data.evidence.workspaceFile, "D:/Workspace/codek.code-workspace")
  assert.deepEqual(calls, [
    { action: "stop" },
    {
      action: "start",
      initData: {
        rootDir: "D:/Workspace",
        workspaceRoots: ["D:/Workspace"],
        workspaceFile: "D:/Workspace/codek.code-workspace",
      },
    },
  ])
  assert.ok(!JSON.stringify(result.data.evidence).includes("IHostService.reload"))
})

test("lifecycle restart route preserves structured blocked evidence when stop is vetoed", async () => {
  let stopped = false
  const fakeHost = {
    isRunning: true,
    stop() {
      stopped = true
    },
  }
  const { extensionsHost, restore } = loadExtensionsHostWithFakeHost(fakeHost)
  extensionsHost.register(router, {
    getHost: () => fakeHost,
    willStopVeto: async () => "workspace trust participant veto",
  })

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/lifecycle/restart",
    body: {
      reason: "Changing workspace trust",
      rootDir: "D:/Workspace",
      workspaceRoots: ["D:/Workspace"],
    },
  })

  restore()
  assert.equal(result.ok, true)
  assert.equal(result.data.success, true)
  assert.equal(stopped, false)
  assert.equal(result.data.evidence.restartRequested, true)
  assert.equal(result.data.evidence.restartObserved, false)
  assert.equal(result.data.evidence.restarted, false)
  assert.equal(result.data.evidence.lifecyclePhase, "blocked")
  assert.equal(result.data.evidence.blockedBy, "onWillStopVeto")
  assert.equal(result.data.evidence.blockedReason, "workspace trust participant veto")
  assert.equal(result.data.evidence.vetoReason, "workspace trust participant veto")
  assert.equal(result.data.evidence.stopEvidence.vetoed, true)
  assert.equal(result.data.evidence.stopEvidence.lifecyclePhase, "blocked")
  assert.equal(result.data.evidence.stopEvidence.blockedReason, "workspace trust participant veto")
  assert.equal(result.data.evidence.startEvidence, null)
})
