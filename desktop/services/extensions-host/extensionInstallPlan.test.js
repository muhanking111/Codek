const assert = require("node:assert/strict")
const test = require("node:test")

const {
  buildInstallPlan,
  normalizeExtensionId,
  readManifestInstallMetadata,
} = require("./extensionInstallPlan")

test("normalizeExtensionId accepts publisher/name and publisher.name inputs", () => {
  assert.equal(normalizeExtensionId("ms-python", "python"), "ms-python.python")
  assert.equal(normalizeExtensionId("ms-python.python"), "ms-python.python")
  assert.equal(normalizeExtensionId(""), "")
})

test("readManifestInstallMetadata preserves VS Code dependency fields", () => {
  const metadata = readManifestInstallMetadata({
    publisher: "ms-python",
    name: "python",
    version: "2026.4.0",
    extensionDependencies: ["ms-python.debugpy"],
    extensionPack: ["ms-python.vscode-pylance"],
    extensionKind: ["workspace", "ui"],
    engines: { vscode: "^1.90.0" },
    enabledApiProposals: ["notebookVariableProvider"],
    main: "./extension.js",
    browser: "./browser.js",
  })

  assert.equal(metadata.id, "ms-python.python")
  assert.deepEqual(metadata.extensionDependencies, ["ms-python.debugpy"])
  assert.deepEqual(metadata.extensionPack, ["ms-python.vscode-pylance"])
  assert.deepEqual(metadata.extensionKind, ["workspace", "ui"])
  assert.equal(metadata.engines.vscode, "^1.90.0")
  assert.equal(metadata.executesCode, true)
})

test("buildInstallPlan lists missing dependencies and extension packs before install", () => {
  const plan = buildInstallPlan({
    target: {
      id: "ms-python.python",
      version: "2026.4.0",
      displayName: "Python",
      extensionDependencies: ["ms-python.debugpy", "ms-toolsai.jupyter"],
      extensionPack: ["ms-python.vscode-pylance"],
      engines: { vscode: "^1.90.0" },
      enabledApiProposals: ["notebookVariableProvider"],
    },
    installedExtensions: [
      { id: "ms-python.debugpy", version: "2026.2.0" },
    ],
  })

  assert.equal(plan.id, "ms-python.python")
  assert.equal(plan.requiresConfirmation, true)
  assert.deepEqual(plan.missingDependencies, ["ms-toolsai.jupyter"])
  assert.deepEqual(plan.missingExtensionPack, ["ms-python.vscode-pylance"])
  assert.deepEqual(plan.operations.map((item) => `${item.kind}:${item.id}:${item.status}`), [
    "dependency:ms-python.debugpy:already-installed",
    "dependency:ms-toolsai.jupyter:pending",
    "extension-pack:ms-python.vscode-pylance:pending",
    "target:ms-python.python:pending",
  ])
  assert.equal(plan.warnings.some((warning) => warning.id === "enabled_api_proposals"), true)
})

test("buildInstallPlan degrades gracefully when marketplace metadata is incomplete", () => {
  const plan = buildInstallPlan({
    target: { id: "unknown.missing" },
    installedExtensions: [],
  })

  assert.equal(plan.readyToInstall, true)
  assert.equal(plan.warnings.some((warning) => warning.id === "metadata_incomplete"), true)
  assert.equal(plan.operations.at(-1).id, "unknown.missing")
})

test("buildInstallPlan blocks publishers denied by enterprise policy", () => {
  const previous = process.env.CODEK_EXTENSION_PUBLISHER_DENY
  process.env.CODEK_EXTENSION_PUBLISHER_DENY = "bad-publisher"
  try {
    const plan = buildInstallPlan({
      target: { id: "bad-publisher.tool", publisher: "bad-publisher", name: "tool", version: "1.0.0" },
      installedExtensions: [],
    })

    assert.equal(plan.readyToInstall, false)
    assert.equal(plan.publisherPolicy.reason, "publisher_denied")
    assert.equal(plan.warnings.some((warning) => warning.id === "publisher_denied" && warning.severity === "blocker"), true)
  } finally {
    if (previous == null) delete process.env.CODEK_EXTENSION_PUBLISHER_DENY
    else process.env.CODEK_EXTENSION_PUBLISHER_DENY = previous
  }
})
