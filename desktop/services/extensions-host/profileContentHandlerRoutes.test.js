const assert = require("node:assert/strict")
const test = require("node:test")

const router = require("../router")
const extensionsHost = require("./index")
const profileContentHandlers = require("./mainThread/mainThreadProfileContentHandlers")

test.afterEach(() => {
  router.clearRoutes()
  profileContentHandlers.clearProfileContentHandlers()
})

test("profile content handler list route activates generic onProfile before listing handlers", async () => {
  const activations = []
  extensionsHost.register(router, {
    activateProfileContentHandlers: async (options = {}) => {
      activations.push(options)
      registerCloudHandler()
    },
  })

  const result = await router.dispatch({
    method: "GET",
    path: "/extensions-host/profile-content-handlers",
  })

  assert.equal(result.ok, true)
  assert.deepEqual(activations, [{}])
  assert.deepEqual(result.data.handlers, [{
    id: "cloud",
    name: "Cloud Profiles",
    description: "Remote profile store",
    extensionId: "publisher.cloud",
  }])
})

test("profile content handler read route activates onProfile:handler before reading", async () => {
  const activations = []
  extensionsHost.register(router, {
    activateProfileContentHandlers: async (options = {}) => {
      activations.push(options)
      if (options.handlerId === "cloud") registerCloudHandler()
    },
  })

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/profile-content-handlers/read",
    body: { handlerId: "cloud", idOrUri: "cloud:work" },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(activations, [{ handlerId: "cloud", includeGeneric: false }])
  assert.equal(result.data.success, true)
  assert.equal(result.data.content, JSON.stringify({ name: "Cloud Work", settings: "{}" }))
})

test("profile content handler read route falls back to generic onProfile when a handler-specific event does not register", async () => {
  const activations = []
  extensionsHost.register(router, {
    activateProfileContentHandlers: async (options = {}) => {
      activations.push(options)
      if (!options.handlerId) registerCloudHandler()
    },
  })

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/profile-content-handlers/read",
    body: { handlerId: "cloud", idOrUri: "cloud:work" },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(activations, [
    { handlerId: "cloud", includeGeneric: false },
    {},
  ])
  assert.equal(result.data.content, JSON.stringify({ name: "Cloud Work", settings: "{}" }))
})

test("profile content handler save route activates onProfile:handler before saving", async () => {
  const activations = []
  extensionsHost.register(router, {
    activateProfileContentHandlers: async (options = {}) => {
      activations.push(options)
      if (options.handlerId === "cloud") registerCloudHandler()
    },
  })

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/profile-content-handlers/save",
    body: {
      handlerId: "cloud",
      name: "Cloud Work",
      content: JSON.stringify({ name: "Cloud Work", settings: "{}" }),
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(activations, [{ handlerId: "cloud", includeGeneric: false }])
  assert.equal(result.data.success, true)
  assert.deepEqual(result.data.result, { id: "cloud:work", filePath: "cloud:work", link: undefined, bytesWritten: 64 })
})

function registerCloudHandler() {
  if (profileContentHandlers.listProfileContentHandlers().some((handler) => handler.id === "cloud")) return
  profileContentHandlers.registerProfileContentHandler({
    id: "cloud",
    name: "Cloud Profiles",
    description: "Remote profile store",
    extensionId: "publisher.cloud",
    callEh: async (_nid, method) => {
      if (method === "$readProfile") return JSON.stringify({ name: "Cloud Work", settings: "{}" })
      return { id: "cloud:work", filePath: "cloud:work", bytesWritten: 64 }
    },
    timeoutMs: 1000,
  })
}
