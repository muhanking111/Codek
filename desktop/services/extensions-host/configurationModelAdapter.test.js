const assert = require("node:assert/strict")
const test = require("node:test")

const {
  buildConfigModel,
  buildConfigurationChange,
  deleteByPath,
  extractConfigurationDefaults,
  flatToNested,
  keyFromOverrideIdentifiers,
  overrideIdentifiersFromKey,
  setByPath,
} = require("./configurationModelAdapter")

test("configurationModelAdapter converts flat settings into VS Code style value trees", () => {
  const nested = flatToNested({
    "editor.fontSize": 16,
    "editor.guides.indentation": true,
    files: {
      autoSave: "off",
    },
  })

  assert.deepEqual(nested, {
    editor: {
      fontSize: 16,
      guides: {
        indentation: true,
      },
    },
    files: {
      autoSave: "off",
    },
  })
})

test("configurationModelAdapter builds multi-language override models", () => {
  const model = buildConfigModel({
    "editor.tabSize": 2,
    "[typescript][javascript]": {
      "editor.tabSize": 3,
      "editor.insertSpaces": false,
    },
    "[typescript]": {
      "files.trimTrailingWhitespace": true,
    },
  })

  assert.deepEqual(model.contents, {
    editor: {
      tabSize: 2,
    },
  })
  assert.deepEqual(model.keys, ["editor.tabSize"])
  assert.deepEqual(model.overrides, [
    {
      identifiers: ["typescript", "javascript"],
      contents: {
        editor: {
          tabSize: 3,
          insertSpaces: false,
        },
      },
      keys: ["editor.tabSize", "editor.insertSpaces"],
    },
    {
      identifiers: ["typescript"],
      contents: {
        files: {
          trimTrailingWhitespace: true,
        },
      },
      keys: ["files.trimTrailingWhitespace"],
    },
  ])
  assert.deepEqual(overrideIdentifiersFromKey("[typescript][javascript]"), [
    "typescript",
    "javascript",
  ])
  assert.equal(keyFromOverrideIdentifiers(["typescript", "javascript"]), "[typescript][javascript]")
})

test("configurationModelAdapter extracts defaults from configuration, allOf and override defaults", () => {
  const defaults = extractConfigurationDefaults([
    {
      configurationDefaults: {
        "editor.fontSize": 15,
        "[typescript][javascript]": {
          "editor.tabSize": 2,
        },
      },
      configuration: {
        allOf: [
          {
            properties: {
              "codek.alpha.enabled": {
                type: "boolean",
                default: true,
              },
            },
          },
          {
            properties: {
              "codek.alpha.mode": {
                type: "string",
                default: "auto",
              },
              "codek.alpha.noDefault": {
                type: "string",
              },
            },
          },
        ],
      },
    },
  ])

  assert.deepEqual(defaults, {
    "editor.fontSize": 15,
    "[typescript][javascript]": {
      "editor.tabSize": 2,
    },
    "codek.alpha.enabled": true,
    "codek.alpha.mode": "auto",
  })
})

test("configurationModelAdapter builds deduplicated VS Code configuration change records", () => {
  assert.deepEqual(
    buildConfigurationChange([
      "editor.fontSize",
      "[typescript][javascript]",
      "editor.fontSize",
      "[typescript]",
      "",
      null,
    ]),
    {
      keys: ["editor.fontSize"],
      overrides: ["typescript", "javascript"],
    },
  )
})

test("configurationModelAdapter mutates nested paths through shared VS Code-style helpers", () => {
  const source = {}

  setByPath(source, "editor.guides.indentation", true)
  setByPath(source, "editor.fontSize", 14)
  deleteByPath(source, "editor.guides.indentation")

  assert.deepEqual(source, {
    editor: {
      guides: {},
      fontSize: 14,
    },
  })
})
