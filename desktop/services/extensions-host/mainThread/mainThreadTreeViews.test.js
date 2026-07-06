const assert = require("node:assert/strict")
const test = require("node:test")

const mainThreadTreeViews = require("./mainThreadTreeViews")

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
      const handler = handlers.get(`${mainThreadTreeViews.MAIN_THREAD_TREE_VIEWS_NID}:${method}`) || handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [])
    },
  }
}

test("MainThreadTreeViews registers, refreshes, and disposes tree data providers", async () => {
  mainThreadTreeViews.clearTreeViews()
  const server = createServer()
  const rendererEvents = []
  mainThreadTreeViews.register(server, {
    sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
  })

  await server.callRpc("$registerTreeViewDataProvider", ["codek.views.sample", {
    showCollapseAll: true,
    canSelectMany: false,
  }])
  await server.callRpc("$refresh", ["codek.views.sample", {
    root: { handle: "root", label: { label: "Root" }, command: { title: "Run", command: "codek.run" } },
  }])
  await server.callRpc("$setMessage", ["codek.views.sample", "Ready"])
  await server.callRpc("$setTitle", ["codek.views.sample", "Sample", "Tree"])

  assert.deepEqual(mainThreadTreeViews.listTreeViews()[0], {
    id: "codek.views.sample",
    options: {
      showCollapseAll: true,
      canSelectMany: false,
    },
    message: "Ready",
    title: "Sample",
    description: "Tree",
    badge: undefined,
    disposed: false,
  })
  assert.equal(rendererEvents[0].channel, "ext-host:tree-view-register")
  assert.equal(rendererEvents[1].channel, "ext-host:tree-view-refresh")
  assert.equal(rendererEvents[1].payload.items.root.command.command, "codek.run")

  await server.callRpc("$disposeTree", ["codek.views.sample"])
  assert.deepEqual(mainThreadTreeViews.listTreeViews(), [])
  assert.equal(rendererEvents.at(-1).channel, "ext-host:tree-view-dispose")
})

test("MainThreadTreeViews keeps RPC payloads clone-safe", () => {
  const circular = { label: "Root" }
  circular.self = circular

  assert.deepEqual(mainThreadTreeViews.normalizeRefreshItems({
    root: circular,
    child: { bytes: Buffer.from("ab", "utf8"), fn() {} },
  }), {
    root: { label: "Root", self: undefined },
    child: { bytes: { type: "Buffer", data: [97, 98] } },
  })
})

test("MainThreadTreeViews clears provider registry on host stop", async () => {
  mainThreadTreeViews.clearTreeViews()
  const server = createServer()
  mainThreadTreeViews.register(server)

  await server.callRpc("$registerTreeViewDataProvider", ["codek.views.sample", {}])
  assert.equal(mainThreadTreeViews.listTreeViews().length, 1)

  server.emit("stopped")
  assert.deepEqual(mainThreadTreeViews.listTreeViews(), [])
})

test("MainThreadTreeViews projects owner evidence without real extension provider side effects", async () => {
  mainThreadTreeViews.clearTreeViews()
  const server = createServer()
  const rendererEvents = []
  mainThreadTreeViews.register(server, {
    sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
  })

  await server.callRpc("$registerTreeViewDataProvider", ["codek.views.mockFixture", {
    showCollapseAll: false,
    canSelectMany: true,
  }])

  const evidence = mainThreadTreeViews.getTreeViewsOwnerEvidence()

  assert.deepEqual(evidence.vscodeSourceEntrypoints, {
    mainThreadTreeViews: "src/vs/workbench/api/browser/mainThreadTreeViews.ts",
    viewsRegistry: "src/vs/workbench/common/views.ts",
    viewsService: "src/vs/workbench/services/views/common/viewsService.ts",
  })
  assert.equal(evidence.treeViewBridgeOwner.owner, "MainThreadTreeViews")
  assert.equal(evidence.treeViewBridgeOwner.connected, true)
  assert.equal(evidence.treeViewBridgeOwner.noSecondTreeState, true)
  assert.deepEqual(evidence.treeViewBridgeOwner.registeredTreeViewIds, ["codek.views.mockFixture"])
  assert.equal(evidence.treeDataSourceOwner.owner, "ExtHostTreeViews.registerTreeDataProvider")
  assert.equal(evidence.treeDataSourceOwner.connected, true)
  assert.equal(evidence.treeDataSourceOwner.providerSideEffectsStarted, false)
  assert.equal(evidence.viewsServiceOwner.connected, false)
  assert.equal(evidence.viewContainerOwner.connected, false)
  assert.equal(evidence.activationOwner.connected, false)
  assert.deepEqual(evidence.remainingViewsUiOwnerGap, [
    "ActivityBar/Views UI owner remains in App.vue/generic shell and is intentionally not wired by this backend evidence thread.",
  ])
  assert.deepEqual(evidence.constraints, {
    noSecondViewState: true,
    noSecondTreeState: true,
    runtimeSourceMirrorDependency: false,
    extensionTreeProviderSideEffectsStarted: false,
  })
  assert.equal(rendererEvents[0].channel, "ext-host:tree-view-register")
})
