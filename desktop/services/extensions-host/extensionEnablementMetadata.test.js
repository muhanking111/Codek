const assert = require("node:assert/strict")
const test = require("node:test")

const {
  buildExtensionEnablementMetadata,
  getAllowedExtensionsConfig,
  isAllowedByConfiguration,
  readGlobalDisabledExtensions,
} = require("./extensionEnablementMetadata")

test("extension enablement metadata projects product disableExtensions as environment disablement", () => {
  const enablement = buildExtensionEnablementMetadata({
    id: "publisher.product-disabled",
    publisher: "publisher",
    version: "1.0.0",
  }, {
    productService: {
      disableExtensions: ["publisher.product-disabled"],
    },
  })

  assert.equal(enablement.state, "DisabledByEnvironment")
  assert.equal(enablement.reason, "product")
  assert.equal(enablement.productDisablement.source, "productService.disableExtensions")
  assert.equal(enablement.productDisablement.runtimeReference, false)
})

test("extension enablement metadata projects extensions.allowed blocks", () => {
  const allowed = getAllowedExtensionsConfig({
    userSettings: {
      "extensions.allowed": {
        "publisher.allowed": true,
        "*": false,
      },
    },
  })
  const enablement = buildExtensionEnablementMetadata({
    id: "publisher.blocked",
    publisher: "publisher",
    version: "1.0.0",
  }, {
    userSettings: {
      "extensions.allowed": {
        "publisher.allowed": true,
        "*": false,
      },
    },
  })

  assert.equal(isAllowedByConfiguration({ id: "publisher.allowed", publisher: "publisher", version: "1.0.0" }, allowed), true)
  assert.equal(isAllowedByConfiguration({ id: "publisher.blocked", publisher: "publisher", version: "1.0.0" }, allowed), false)
  assert.equal(enablement.state, "DisabledByAllowlist")
  assert.equal(enablement.reason, "configuration")
  assert.equal(enablement.configurationDisablement.source, "configurationService.extensions.allowed")
  assert.equal(enablement.configurationDisablement.configKey, "extensions.allowed")
})

test("extension enablement metadata projects VS Code global disabledExtensions storage", () => {
  const enablement = buildExtensionEnablementMetadata({
    id: "publisher.global-disabled",
    publisher: "publisher",
    version: "1.0.0",
  }, {
    disabledExtensions: [{ id: "publisher.global-disabled" }],
  })

  assert.deepEqual(readGlobalDisabledExtensions({ disabledExtensions: [{ id: "publisher.global-disabled" }] }), ["publisher.global-disabled"])
  assert.equal(enablement.state, "DisabledGlobally")
  assert.equal(enablement.reason, "globalUser")
  assert.equal(enablement.configurationDisablement.source, "globalExtensionEnablementService.disabledExtensions")
  assert.equal(enablement.configurationDisablement.configKey, "extensionsIdentifiers/disabled")
  assert.equal(enablement.configurationDisablement.scope, "profile")
})
