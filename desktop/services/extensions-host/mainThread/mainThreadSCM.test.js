const assert = require("node:assert/strict")
const test = require("node:test")

const mainThreadSCM = require("./mainThreadSCM")
const { ExtHostContext, MainContext } = require("../extHostServer")

function createServer() {
  const handlers = new Map()
  const listeners = new Map()
  return {
    handlers,
    onRpc(actorIdOrMethod, methodOrHandler, maybeHandler) {
      if (typeof actorIdOrMethod === "number") {
        handlers.set(`${actorIdOrMethod}:${methodOrHandler}`, maybeHandler)
        return
      }
      handlers.set(actorIdOrMethod, methodOrHandler)
    },
    on(event, handler) {
      listeners.set(event, handler)
    },
    emit(event) {
      listeners.get(event)?.()
    },
    callRpc(method, args) {
      const handler = handlers.get(`${mainThreadSCM.MAIN_THREAD_SCM_NID}:${method}`) || handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [])
    },
    async call(nid, method, args) {
      this.calls.push({ nid, method, args })
      return undefined
    },
    calls: [],
  }
}

test("MainThreadSCM registers source controls, groups and resource splices with clone-safe payloads", async () => {
  const server = createServer()
  const rendererEvents = []
  mainThreadSCM.register(server, {
    sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
  })

  await server.callRpc("$registerSourceControl", [1, undefined, "git", "Codek", { fsPath: "D:/Workspace" }, undefined, false, { scheme: "vscodeSourceControl", path: "/git/scm1/input" }])
  await server.callRpc("$registerGroups", [1, [
    [7, "changes", "Changes", { hideWhenEmpty: false }, true],
  ], [
    [7, [[0, 0, [[5, { fsPath: "D:/Workspace/src/app.ts" }, [undefined, undefined], "changed", false, false, "ctx", { command: "vscode.open", title: "Open", arguments: ["D:/Workspace/src/app.ts"] }, undefined, undefined]]]]],
  ]])

  const repositories = mainThreadSCM.listRepositories(mainThreadSCM.createStore())
  assert.deepEqual(repositories, [])
  assert.equal(rendererEvents[0].channel, "ext-host:scm-register")
  assert.equal(rendererEvents[1].channel, "ext-host:scm-registerGroups")
  assert.equal(rendererEvents[1].payload.repository.groups[0].resources[0].sourceUri, "D:/Workspace/src/app.ts")
  assert.equal(rendererEvents[1].payload.repository.groups[0].resources[0].resourceUri, "D:/Workspace/src/app.ts")
  assert.equal(rendererEvents[1].payload.repository.groups[0].resources[0].tooltip, "changed")
  assert.equal(Object.hasOwn(rendererEvents[1].payload.repository, "dirtyFiles"), false)
  assert.equal(Object.hasOwn(rendererEvents[1].payload.repository, "externalChanges"), false)
  assert.equal(rendererEvents[1].payload.repository.groups[0].resources[0].command.commandId, "vscode.open")
})

test("MainThreadSCM updates input state, selection and calls ext host back for best-effort sync", async () => {
  const server = createServer()
  const rendererEvents = []
  const bridge = mainThreadSCM.register(server, {
    sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
  })

  await server.callRpc("$registerSourceControl", [1, undefined, "git", "Codek", { fsPath: "D:/Workspace" }, undefined, false, { scheme: "vscodeSourceControl", path: "/git/scm1/input" }])
  await bridge.setSelectedSourceControl(1)
  await bridge.onInputBoxValueChange(1, "hello")
  await server.callRpc("$setInputBoxPlaceholder", [1, "commit message"])
  await server.callRpc("$setInputBoxEnablement", [1, false])
  await server.callRpc("$setInputBoxVisibility", [1, false])

  assert.equal(server.calls.some((entry) => entry.method === "$setSelectedSourceControl"), true)
  assert.equal(server.calls.some((entry) => entry.method === "$onInputBoxValueChange"), true)
  assert.equal(mainThreadSCM.MAIN_THREAD_SCM_NID, MainContext.MainThreadSCM)
  assert.equal(mainThreadSCM.EXT_HOST_SCM_NID, ExtHostContext.ExtHostSCM)
  assert.deepEqual(server.calls.map((entry) => [entry.nid, entry.method]), [
    [mainThreadSCM.EXT_HOST_SCM_NID, "$setSelectedSourceControl"],
    [mainThreadSCM.EXT_HOST_SCM_NID, "$onInputBoxValueChange"],
  ])
  assert.equal(rendererEvents.some((entry) => entry.channel === "ext-host:scm-selectedSourceControl"), true)
  assert.equal(rendererEvents.some((entry) => entry.channel === "ext-host:scm-inputBoxPlaceholder" && entry.payload.placeholder === "commit message"), true)
  assert.equal(rendererEvents.some((entry) => entry.channel === "ext-host:scm-inputBoxEnablement" && entry.payload.enabled === false), true)
  assert.equal(rendererEvents.some((entry) => entry.channel === "ext-host:scm-inputBoxVisibility" && entry.payload.visible === false), true)
})

test("MainThreadSCM keeps RPC payloads clone-safe", () => {
  const circular = { label: "Codek" }
  circular.self = circular

  assert.deepEqual(mainThreadSCM.cloneSafe({
    repo: circular,
    fn() {},
    bytes: Buffer.from("ab", "utf8"),
  }), {
    fn: undefined,
    repo: { label: "Codek", self: undefined },
    bytes: { type: "Buffer", data: [97, 98] },
  })
})

test("MainThreadSCM clears state on host stop", async () => {
  const server = createServer()
  const bridge = mainThreadSCM.register(server)

  await server.callRpc("$registerSourceControl", [1, undefined, "git", "Codek", { fsPath: "D:/Workspace" }, undefined, false, { scheme: "vscodeSourceControl", path: "/git/scm1/input" }])
  await server.callRpc("$registerGroups", [1, [[7, "changes", "Changes", {}, false]], []])

  assert.equal(bridge.store.repositories.size, 1)
  server.emit("stopped")
  assert.equal(bridge.store.repositories.size, 0)
})
