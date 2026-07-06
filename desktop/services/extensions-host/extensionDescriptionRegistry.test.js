const assert = require("node:assert/strict")
const test = require("node:test")

const {
  ExtensionDescriptionRegistry,
  createExtensionScanResult,
  extensionCmp,
} = require("./extensionDescriptionRegistry")

function extension(id, extra = {}) {
  const folder = extra.folder || id
  return {
    identifier: { value: id, _lower: id.toLowerCase() },
    id,
    name: id.split(".").pop(),
    publisher: id.split(".")[0],
    version: "1.0.0",
    extensionLocation: { scheme: "file", path: `/extensions/${folder}` },
    isBuiltin: extra.isBuiltin ?? true,
    isUnderDevelopment: extra.isUnderDevelopment ?? false,
    activationEvents: extra.activationEvents,
    extensionDependencies: extra.extensionDependencies,
    main: extra.main,
    browser: extra.browser,
    contributes: extra.contributes,
    api: extra.api,
    uuid: extra.uuid,
  }
}

test("ExtensionDescriptionRegistry indexes activation events and extension ids like VS Code", () => {
  const registry = new ExtensionDescriptionRegistry({
    readActivationEvents(extensionDescription) {
      return extensionDescription.activationEvents || []
    },
  }, [
    extension("Publisher.Sample", { activationEvents: ["onStartupFinished", "onCommand:sample.run"], uuid: "sample-uuid" }),
  ])

  assert.equal(registry.containsActivationEvent("onStartupFinished"), true)
  assert.equal(registry.containsExtension("publisher.sample"), true)
  assert.equal(registry.containsExtension({ value: "Publisher.Sample" }), true)
  assert.equal(registry.getExtensionDescription("publisher.sample").id, "Publisher.Sample")
  assert.equal(registry.getExtensionDescriptionByUUID("sample-uuid").id, "Publisher.Sample")
  assert.equal(registry.getExtensionDescriptionByIdOrUUID("missing.id", "sample-uuid").id, "Publisher.Sample")
  assert.deepEqual(
    registry.getExtensionDescriptionsForActivationEvent("onCommand:sample.run").map((item) => item.id),
    ["Publisher.Sample"],
  )

  const activationExtensions = registry.getExtensionDescriptionsForActivationEvent("onStartupFinished")
  activationExtensions.pop()
  assert.equal(registry.getExtensionDescriptionsForActivationEvent("onStartupFinished").length, 1)
})

test("ExtensionDescriptionRegistry removes looping extension dependencies using VS Code algorithm", () => {
  const registry = new ExtensionDescriptionRegistry({
    readActivationEvents(extensionDescription) {
      return extensionDescription.activationEvents || []
    },
  }, [])

  const result = registry.deltaExtensions([
    extension("codek.a", { extensionDependencies: ["codek.b"], activationEvents: ["onCommand:a"] }),
    extension("codek.b", { extensionDependencies: ["codek.a"], activationEvents: ["onCommand:b"] }),
    extension("codek.c", { extensionDependencies: ["codek.missing"], activationEvents: ["onCommand:c"] }),
  ], [])

  assert.equal(result.versionId, 1)
  assert.deepEqual(result.removedDueToLooping.map((item) => item.id).sort(), ["codek.a", "codek.b"])
  assert.deepEqual(registry.getAllExtensionDescriptions().map((item) => item.id), ["codek.c"])
  assert.equal(registry.containsActivationEvent("onCommand:a"), false)
  assert.equal(registry.containsActivationEvent("onCommand:c"), true)
})

test("ExtensionDescriptionRegistry activation maps use lower-case keys and optional legacy aliases", () => {
  const registry = new ExtensionDescriptionRegistry({
    readActivationEvents(extensionDescription) {
      return extensionDescription.activationEvents || []
    },
  }, [
    extension("Publisher.Sample", { activationEvents: ["onStartupFinished"] }),
  ])

  const strictMap = registry.createActivationEventsMap()
  assert.deepEqual(Object.keys(strictMap), ["publisher.sample"])
  assert.deepEqual(strictMap["publisher.sample"], ["onStartupFinished"])

  const compatMap = registry.createActivationEventsMap({ includeOriginalKeys: true })
  assert.deepEqual(compatMap["publisher.sample"], ["onStartupFinished"])
  assert.deepEqual(compatMap["Publisher.Sample"], ["onStartupFinished"])
})

test("createExtensionScanResult preserves scanExtensions shape while using registry indexes", () => {
  const scanned = createExtensionScanResult([
    extension("Publisher.Sample", {
      main: "./extension.js",
      contributes: {
        commands: [{ command: "publisher.sample.run", title: "Run" }],
      },
    }),
  ])

  const ext = scanned.byId.get("Publisher.Sample")
  assert.equal(scanned.byId.get("publisher.sample"), ext)
  assert.deepEqual(ext.activationEvents, ["onCommand:publisher.sample.run"])
  assert.deepEqual(scanned.activationEvents["publisher.sample"], ["onCommand:publisher.sample.run"])
  assert.deepEqual(scanned.activationEvents["Publisher.Sample"], ["onCommand:publisher.sample.run"])
  assert.deepEqual(scanned.activationEventsByEvent["onCommand:publisher.sample.run"], ["Publisher.Sample"])
  assert.deepEqual(scanned.removedDueToLooping, [])
})

test("extensionCmp keeps VS Code builtin, user, development bucket ordering", () => {
  const user = extension("codek.user", { isBuiltin: false, folder: "b-user" })
  const builtinB = extension("codek.builtinB", { isBuiltin: true, folder: "b-builtin" })
  const builtinA = extension("codek.builtinA", { isBuiltin: true, folder: "a-builtin" })
  const dev = extension("codek.dev", { isBuiltin: false, isUnderDevelopment: true, folder: "a-dev" })

  assert.deepEqual(
    [user, dev, builtinB, builtinA].sort(extensionCmp).map((item) => item.id),
    ["codek.builtinA", "codek.builtinB", "codek.user", "codek.dev"],
  )
})
