const assert = require("node:assert/strict")
const test = require("node:test")

const { buildExtensionConfigurationDefaults } = require("./configurationDefaults")

test("buildExtensionConfigurationDefaults aggregates enabled extension defaults with sources", () => {
  const result = buildExtensionConfigurationDefaults([
    {
      id: "codek.alpha",
      displayName: "Alpha",
      enabled: true,
      contributes: {
        configuration: {
          properties: {
            "alpha.enabled": { type: "boolean", default: true },
            "editor.fontSize": { type: "number", default: 13 },
            "alpha.noDefault": { type: "string" },
          },
        },
      },
    },
    {
      id: "codek.beta",
      displayName: "Beta",
      enabled: true,
      contributes: {
        configurationDefaults: {
          "[typescript]": { "editor.tabSize": 2 },
          "editor.fontSize": 15,
        },
      },
    },
    {
      id: "codek.disabled",
      enabled: false,
      contributes: {
        configuration: {
          properties: {
            "disabled.value": { default: true },
          },
        },
      },
    },
  ])

  assert.deepEqual(result.defaults, {
    "alpha.enabled": true,
    "editor.fontSize": 15,
    "[typescript]": { "editor.tabSize": 2 },
  })
  assert.deepEqual(result.sources, [
    { extensionId: "codek.alpha", displayName: "Alpha", keys: ["alpha.enabled", "editor.fontSize"] },
    { extensionId: "codek.beta", displayName: "Beta", keys: ["[typescript]", "editor.fontSize"] },
  ])
})

test("buildExtensionConfigurationDefaults tolerates malformed contributions", () => {
  const result = buildExtensionConfigurationDefaults([
    null,
    { id: "empty.one", contributes: null },
    { id: "empty.two", contributes: { configuration: [{ properties: null }] } },
  ])

  assert.deepEqual(result.defaults, {})
  assert.deepEqual(result.sources, [])
})
