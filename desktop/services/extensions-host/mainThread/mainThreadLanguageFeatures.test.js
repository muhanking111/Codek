const assert = require("node:assert/strict")
const test = require("node:test")

const mainThreadLanguageFeatures = require("./mainThreadLanguageFeatures")

function createServer() {
  const handlers = new Map()
  return {
    handlers,
    onRpc(actorIdOrMethod, methodOrHandler, maybeHandler) {
      if (typeof actorIdOrMethod === "number") {
        handlers.set(`${actorIdOrMethod}:${methodOrHandler}`, maybeHandler)
        return
      }
      handlers.set(actorIdOrMethod, methodOrHandler)
    },
    callRpc(method, args) {
      const handler = handlers.get(`${mainThreadLanguageFeatures.MAIN_THREAD_LANGUAGE_FEATURES_NID}:${method}`) || handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [])
    },
  }
}

test("MainThreadLanguageFeatures registers providers on the VS Code actor-specific proxy", () => {
  const server = createServer()
  const synced = []
  const rendererEvents = []

  mainThreadLanguageFeatures.resetProviders()
  mainThreadLanguageFeatures.register(server, {
    syncProviders: (providers) => synced.push(providers),
    sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
  })

  assert.equal(typeof server.handlers.get(`${mainThreadLanguageFeatures.MAIN_THREAD_LANGUAGE_FEATURES_NID}:$registerCompletionItemProvider`), "function")

  server.callRpc("$registerCompletionItemProvider", [11, { language: "typescript" }, ["."]])
  server.callRpc("$registerHoverProvider", [12, { language: "typescript" }])

  assert.deepEqual(mainThreadLanguageFeatures.getHandlesForLanguage("typescript"), [11, 12])
  assert.deepEqual(mainThreadLanguageFeatures.getProviderList(), [
    { handle: 11, type: "completionItem", language: "typescript" },
    { handle: 12, type: "hover", language: "typescript" },
  ])
  assert.equal(synced.at(-1).length, 2)
  assert.equal(rendererEvents[0].channel, "ext-host:provider-registered")
})

test("MainThreadLanguageFeatures unregisters providers and removes language index entries", () => {
  const server = createServer()

  mainThreadLanguageFeatures.resetProviders()
  mainThreadLanguageFeatures.register(server)

  server.callRpc("$registerCompletionItemProvider", [21, { language: "javascript" }, []])
  server.callRpc("$registerHoverProvider", [22, { language: "javascript" }])
  server.callRpc("$unregister", [21])

  assert.deepEqual(mainThreadLanguageFeatures.getHandlesForLanguage("javascript"), [22])
  assert.deepEqual(mainThreadLanguageFeatures.getProviderList(), [
    { handle: 22, type: "hover", language: "javascript" },
  ])
})
