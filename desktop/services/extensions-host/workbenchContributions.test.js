const assert = require("node:assert/strict")
const test = require("node:test")

const {
  buildExtensionWorkbenchContributions,
  mapViewContainerLocation,
  matchesActivationEvent,
  validateWorkbenchContributionManifest,
} = require("./workbenchContributions")

test("buildExtensionWorkbenchContributions aggregates VS Code workbench contribution points", () => {
  const result = buildExtensionWorkbenchContributions([
    {
      id: "codek.sample",
      displayName: "Sample",
      enabled: true,
      activationEvents: ["onStartupFinished", "onCommand:sample.hello", "onView:sampleView"],
      contributes: {
        commands: [
          { command: "sample.hello", title: "Hello", category: "Sample", enablement: "workspaceFolderCount != 0" },
        ],
        viewsContainers: {
          activitybar: [{ id: "sampleContainer", title: "Sample Container", icon: "media/icon.svg" }],
        },
        views: {
          sampleContainer: [{ id: "sampleView", name: "Sample View", when: "sampleEnabled" }],
        },
        keybindings: [
          { command: "sample.hello", key: "ctrl+alt+h", when: "editorTextFocus" },
        ],
        menus: {
          "explorer/context": [
            { command: "sample.hello", when: "resourceLangId == samplelang", group: "navigation@10" },
            { command: "sample.hidden", alt: "sample.alt", group: "inline" },
          ],
        },
        languages: [
          {
            id: "samplelang",
            aliases: ["SampleLang"],
            extensions: [".sample"],
            filenames: ["Samplefile"],
            firstLine: "^#!.*sample",
            configuration: "./language-configuration.json",
          },
        ],
      },
    },
    {
      id: "codek.disabled",
      enabled: false,
      contributes: {
        commands: [{ command: "disabled.command", title: "Disabled" }],
      },
    },
  ])

  assert.equal(result.summary.extensions, 1)
  assert.equal(result.summary.commands, 1)
  assert.equal(result.summary.menus, 2)
  assert.equal(result.summary.languages, 1)
  assert.equal(result.commands[0].id, "sample.hello")
  assert.equal(result.commands[0].source, "extension")
  assert.equal(result.viewsContainers[0].location, "activityBar")
  assert.equal(result.views[0].containerId, "sampleContainer")
  assert.equal(result.keybindings[0].key, "ctrl+alt+h")
  assert.deepEqual(result.menus[0], {
    location: "explorer/context",
    command: "sample.hello",
    alt: undefined,
    when: "resourceLangId == samplelang",
    group: "navigation",
    order: 10,
    source: "extension",
    extensionId: "codek.sample",
  })
  assert.deepEqual(result.menus[1], {
    location: "explorer/context",
    command: "sample.hidden",
    alt: "sample.alt",
    when: undefined,
    group: "inline",
    order: undefined,
    source: "extension",
    extensionId: "codek.sample",
  })
  assert.deepEqual(result.languages[0], {
    id: "samplelang",
    aliases: ["SampleLang"],
    extensions: [".sample"],
    filenames: ["Samplefile"],
    firstLine: "^#!.*sample",
    mimetypes: [],
    configuration: "./language-configuration.json",
    source: "extension",
    extensionId: "codek.sample",
  })
  assert.deepEqual(result.sources[0], {
    extensionId: "codek.sample",
    displayName: "Sample",
    commands: 1,
    viewsContainers: 1,
    views: 1,
    menus: 2,
    keybindings: 1,
    languages: 1,
  })
  assert.deepEqual(result.contract, {
    version: 1,
    runtime: "codek.extensionWorkbenchContributions",
    source: "vscode-compatible-manifest",
  })
  assert.equal(result.validation.invalid, 0)
  assert.equal(result.activation.matches["onCommand:sample.hello"][0], "codek.sample")
  assert.equal(result.activation.matches["onView:sampleView"][0], "codek.sample")
  assert.equal(result.evidence.activationMatchCount, 3)
  assert.equal(result.evidence.validationInvalidCount, 0)
  assert.equal(result.evidence.constraints.commandExecutionGoesThroughExtensionHost, true)
})

test("mapViewContainerLocation keeps VS Code secondary sidebar out of the main activity bar", () => {
  assert.equal(mapViewContainerLocation("activitybar"), "activityBar")
  assert.equal(mapViewContainerLocation("secondarySidebar"), "auxiliaryBar")
  assert.equal(mapViewContainerLocation("panel"), "panel")
})

test("validateWorkbenchContributionManifest reports malformed contribution entries without blocking valid ones", () => {
  const validation = validateWorkbenchContributionManifest({
    id: "codek.bad",
    contributes: {
      commands: [{ title: "Missing id" }, { command: "codek.valid", title: "Valid" }],
      menus: {
        commandPalette: [{ group: "navigation" }, { command: "codek.unknown" }],
      },
      keybindings: [{ command: "codek.valid" }],
      views: {
        explorer: [{ name: "Missing id" }],
      },
    },
  })

  assert.equal(validation.valid, false)
  assert.equal(validation.invalid, 4)
  assert.equal(validation.issues.some((issue) => issue.point === "commands" && issue.severity === "error"), true)
  assert.equal(validation.issues.some((issue) => issue.point === "menus" && issue.message.includes("not defined")), true)
})

test("matchesActivationEvent follows VS Code-style exact event matching with startup wildcard support", () => {
  assert.equal(matchesActivationEvent(["onCommand:codek.run"], "onCommand:codek.run"), true)
  assert.equal(matchesActivationEvent(["*"], "onView:codek.view"), true)
  assert.equal(matchesActivationEvent(["onCommand:codek.run"], "onCommand:other.run"), false)
})
