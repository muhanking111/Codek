const assert = require("node:assert/strict")
const test = require("node:test")

const mainThreadStatusBar = require("./mainThreadStatusBar")

function createServer() {
  const handlers = new Map()
  return {
    handlers,
    onRpc(actorIdOrMethod, methodOrHandler, maybeHandler) {
      const key = typeof actorIdOrMethod === "number"
        ? `${actorIdOrMethod}:${methodOrHandler}`
        : actorIdOrMethod
      const handler = typeof actorIdOrMethod === "number" ? maybeHandler : methodOrHandler
      handlers.set(key, handler)
    },
    callRpc(method, args) {
      const handler = handlers.get(`${mainThreadStatusBar.MAIN_THREAD_STATUS_BAR_NID}:${method}`) || handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [])
    },
  }
}

test("MainThreadStatusBar projects extension entries with partial bridge owner evidence", () => {
  const server = createServer()
  const rendererEvents = []
  mainThreadStatusBar.register(server, {
    sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
  })

  server.callRpc("$setEntry", [
    "entry:1",
    "status.language",
    "ms.typescript",
    "Language Mode",
    "TypeScript",
    "TypeScript Language Mode",
    false,
    "workbench.action.showCommands",
    "#fff",
    "#000",
    false,
    10,
    { label: "TypeScript" },
  ])
  server.callRpc("$disposeEntry", ["entry:1"])

  assert.deepEqual(rendererEvents, [
    {
      channel: "ext-host:statusbar-entry",
      payload: {
        id: "entry:1",
        statusId: "status.language",
        extensionId: "ms.typescript",
        statusName: "Language Mode",
        text: "TypeScript",
        tooltip: "TypeScript Language Mode",
        command: "workbench.action.showCommands",
        color: "#fff",
        backgroundColor: "#000",
        alignLeft: false,
        priority: 10,
        accessibilityInfo: { label: "TypeScript" },
        ownerEvidence: {
          owner: "MainThreadStatusBar",
          status: "partial",
          stateSource: "ExtHostStatusBarShape -> ext-host:statusbar-entry renderer event",
          rendererStateSource: "workbenchStatusNotificationProgressService.statusbarItems",
          noSecondStatusbarState: true,
          vscodeSource: "src/vs/workbench/services/statusbar/browser/statusbar.ts",
          remainingUiGap: "renderer statusbar IPC consumer / App.vue central shell owner is not connected in this adapter",
        },
      },
    },
    {
      channel: "ext-host:statusbar-dispose",
      payload: {
        id: "entry:1",
        ownerEvidence: mainThreadStatusBar.buildStatusBarBridgeOwnerEvidence(),
      },
    },
  ])
})
