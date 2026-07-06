const assert = require("node:assert/strict")
const test = require("node:test")

const {
  ActivationKind,
  EXT_HOST_EXTENSION_SERVICE_NID,
  createExtensionHostProfileContentHandlerActivationAdapter,
  createNoopProfileContentHandlerActivationAdapter,
  profileContentHandlerActivationEvents,
} = require("./profileContentHandlerActivationAdapter")

test("profileContentHandlerActivationEvents matches VS Code onProfile activation order", () => {
  assert.deepEqual(profileContentHandlerActivationEvents(), ["onProfile"])
  assert.deepEqual(profileContentHandlerActivationEvents({ handlerId: " third-party-profile ", includeGeneric: false }), [
    "onProfile:third-party-profile",
  ])
  assert.deepEqual(profileContentHandlerActivationEvents({ handlerId: "third-party-profile" }), [
    "onProfile:third-party-profile",
    "onProfile",
  ])
})

test("profile content handler activation targets ExtHostExtensionService actor", async () => {
  const calls = []
  const host = {
    isRunning: true,
    call: async (...args) => {
      calls.push(args)
      return undefined
    },
    whenInstalledExtensionsRegistered: async (timeoutMs) => {
      calls.push(["ready", timeoutMs])
    },
  }
  const activateProfileContentHandlers = createExtensionHostProfileContentHandlerActivationAdapter({
    getHost: () => host,
    timeoutMs: 4321,
  })

  await activateProfileContentHandlers({ handlerId: "third-party-profile", includeGeneric: false })

  assert.equal(EXT_HOST_EXTENSION_SERVICE_NID, 106)
  assert.equal(ActivationKind.Normal, 0)
  assert.deepEqual(calls, [
    [106, "$activateByEvent", ["onProfile:third-party-profile", 0], 4321],
    ["ready", 4321],
  ])
})

test("profile content handler activation lists providers through generic onProfile", async () => {
  const calls = []
  const activateProfileContentHandlers = createExtensionHostProfileContentHandlerActivationAdapter({
    getHost: () => ({
      isRunning: true,
      call: async (...args) => {
        calls.push(args)
      },
    }),
    timeoutMs: 777,
  })

  await activateProfileContentHandlers()

  assert.deepEqual(calls, [
    [106, "$activateByEvent", ["onProfile", 0], 777],
  ])
})

test("profile content handler activation is a no-op without a running EH", async () => {
  const calls = []
  const activateProfileContentHandlers = createExtensionHostProfileContentHandlerActivationAdapter({
    getHost: () => ({ isRunning: false }),
    callEh: async (...args) => calls.push(args),
  })

  await activateProfileContentHandlers({ handlerId: "third-party-profile" })

  assert.deepEqual(calls, [])
  await createNoopProfileContentHandlerActivationAdapter()()
})

test("profile content handler activation respects abort signals", async () => {
  const controller = new AbortController()
  controller.abort()
  const activateProfileContentHandlers = createExtensionHostProfileContentHandlerActivationAdapter({
    getHost: () => ({ isRunning: true }),
  })

  await assert.rejects(
    () => activateProfileContentHandlers({ signal: controller.signal }),
    /Profile content handler activation cancelled/,
  )
})
