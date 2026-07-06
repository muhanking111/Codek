const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const { scanExtensions } = require("./extensionScanner")

function writeExtension(root, dirName, manifest, marker) {
  const extDir = path.join(root, dirName)
  fs.mkdirSync(extDir, { recursive: true })
  fs.writeFileSync(path.join(extDir, "package.json"), JSON.stringify(manifest, null, 2))
  if (marker) {
    fs.writeFileSync(path.join(extDir, ".codek-installed.json"), JSON.stringify(marker, null, 2))
  }
  return extDir
}

test("scanExtensions preserves VS Code activationEvents arrays", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-scan-"))
  writeExtension(root, "Anthropic.claude-code", {
    name: "claude-code",
    displayName: "Claude Code for VS Code",
    publisher: "Anthropic",
    version: "2.1.158",
    main: "./extension.js",
    activationEvents: ["onStartupFinished", "onWebviewPanel:claudeVSCodePanel"],
  }, { builtin: false, source: "vsix" })

  const scanned = scanExtensions({ extensionsDir: root })
  const ext = scanned.byId.get("Anthropic.claude-code")

  assert.equal(ext.id, "Anthropic.claude-code")
  assert.deepEqual(ext.identifier, { value: "Anthropic.claude-code", _lower: "anthropic.claude-code" })
  assert.deepEqual(ext.activationEvents, ["onStartupFinished", "onWebviewPanel:claudeVSCodePanel"])
  assert.deepEqual(scanned.activationEvents["Anthropic.claude-code"], ["onStartupFinished", "onWebviewPanel:claudeVSCodePanel"])
  assert.deepEqual(scanned.activationEventsByEvent.onStartupFinished, ["Anthropic.claude-code"])
  assert.deepEqual(scanned.activationEventsByEvent["onWebviewPanel:claudeVSCodePanel"], ["Anthropic.claude-code"])
  assert.equal(scanned.activationEvents["0"], undefined)
  assert.equal(ext.isBuiltin, false)
})

test("scanExtensions preserves custom packageJSON fields used by VS Code extensions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-scan-"))
  writeExtension(root, "vscode.microsoft-authentication", {
    name: "microsoft-authentication",
    displayName: "%displayName%",
    description: "%description%",
    publisher: "vscode",
    version: "0.0.1",
    main: "./out/extension.js",
    activationEvents: ["onAuthenticationRequest:microsoft"],
    engines: { vscode: "*" },
    aiKey: "extension-custom-ai-key",
    capabilities: { virtualWorkspaces: true },
  })
  fs.writeFileSync(path.join(root, "vscode.microsoft-authentication", "package.nls.json"), JSON.stringify({
    displayName: "Microsoft Authentication",
    description: "Microsoft authentication provider.",
  }, null, 2))

  const scanned = scanExtensions({ extensionsDir: root })
  const ext = scanned.byId.get("vscode.microsoft-authentication")

  assert.equal(ext.displayName, "Microsoft Authentication")
  assert.equal(ext.description, "Microsoft authentication provider.")
  assert.equal(ext.aiKey, "extension-custom-ai-key")
  assert.deepEqual(ext.capabilities, { virtualWorkspaces: true })
})

test("scanExtensions still accepts legacy activationEvents object maps", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-scan-"))
  writeExtension(root, "codek.legacy", {
    name: "legacy",
    publisher: "codek",
    version: "1.0.0",
    main: "./extension.js",
    activationEvents: { "onCommand:legacy.run": true },
  })

  const scanned = scanExtensions({ extensionsDir: root })
  const ext = scanned.byId.get("codek.legacy")

  assert.deepEqual(ext.activationEvents, ["onCommand:legacy.run"])
  assert.deepEqual(scanned.activationEvents["codek.legacy"], ["onCommand:legacy.run"])
  assert.deepEqual(scanned.activationEventsByEvent["onCommand:legacy.run"], ["codek.legacy"])
  assert.equal(ext.isBuiltin, true)
})

test("scanExtensions adds VS Code implicit activation events from contributions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-scan-"))
  writeExtension(root, "codek.implicit", {
    name: "implicit",
    publisher: "codek",
    version: "1.0.0",
    main: "./extension.js",
    activationEvents: ["onUri"],
    contributes: {
      commands: [{ command: "codek.implicit.run", title: "Run" }],
      languages: [{ id: "codekLang", configuration: "./language-configuration.json" }],
      views: {
        explorer: [{ id: "codek.implicitView", name: "Implicit View" }],
      },
      taskDefinitions: [{ type: "codekTask", required: ["script"], properties: {} }],
      authentication: [{ id: "codek-auth", label: "Codek Auth" }],
      terminal: { profiles: [{ id: "codek-terminal", title: "Codek" }] },
      customEditors: [{ viewType: "codek.customEditor" }],
      notebookRenderer: [{ id: "codek.renderer" }],
      languageModelTools: [{ name: "codek.tool" }],
      mcpServerDefinitionProviders: [{ id: "codek.mcp" }],
    },
  })

  const scanned = scanExtensions({ extensionsDir: root })
  const ext = scanned.byId.get("codek.implicit")

  assert.deepEqual(ext.activationEvents, [
    "onUri:codek.implicit",
    "onCommand:codek.implicit.run",
    "onLanguage:codekLang",
    "onView:codek.implicitView",
    "onTaskType:codekTask",
    "onAuthenticationRequest:codek-auth",
    "onTerminalProfile:codek-terminal",
    "onCustomEditor:codek.customEditor",
    "onRenderer:codek.renderer",
    "onLanguageModelTool:codek.tool",
    "onMcpCollection:codek.mcp",
  ])
  assert.deepEqual(scanned.activationEvents["codek.implicit"], ext.activationEvents)
  assert.deepEqual(scanned.activationEventsByEvent["onCommand:codek.implicit.run"], ["codek.implicit"])
  assert.deepEqual(scanned.activationEventsByEvent["onView:codek.implicitView"], ["codek.implicit"])
})

test("scanExtensions deduplicates explicit and implicit activation events per extension", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-scan-"))
  writeExtension(root, "codek.dedupe", {
    name: "dedupe",
    publisher: "codek",
    version: "1.0.0",
    main: "./extension.js",
    activationEvents: ["onCommand:codek.dedupe.run"],
    contributes: {
      commands: [{ command: "codek.dedupe.run", title: "Run" }],
    },
  })

  const scanned = scanExtensions({ extensionsDir: root })
  const ext = scanned.byId.get("codek.dedupe")

  assert.deepEqual(ext.activationEvents, ["onCommand:codek.dedupe.run"])
  assert.deepEqual(scanned.activationEvents["codek.dedupe"], ["onCommand:codek.dedupe.run"])
  assert.deepEqual(scanned.activationEventsByEvent["onCommand:codek.dedupe.run"], ["codek.dedupe"])
})

test("scanExtensions does not add implicit activation to contribution-only extension without main or browser", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-scan-"))
  writeExtension(root, "codek.theme-only", {
    name: "theme-only",
    publisher: "codek",
    version: "1.0.0",
    contributes: {
      commands: [{ command: "codek.themeOnly.run", title: "Run" }],
    },
  })

  const scanned = scanExtensions({ extensionsDir: root })
  const ext = scanned.byId.get("codek.theme-only")

  assert.deepEqual(ext.activationEvents, [])
  assert.equal(scanned.activationEvents["codek.theme-only"], undefined)
  assert.equal(scanned.activationEventsByEvent["onCommand:codek.themeOnly.run"], undefined)
})

test("scanExtensions discovers nested built-in extensions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-scan-"))
  writeExtension(root, "git-base", {
    name: "git-base",
    displayName: "%displayName%",
    publisher: "vscode",
    version: "10.0.0",
  })
  const nested = writeExtension(path.join(root, "git-base"), "github", {
    name: "github",
    displayName: "%displayName%",
    publisher: "vscode",
    version: "0.0.1",
    extensionDependencies: ["vscode.git-base"],
    activationEvents: ["*"],
  })
  fs.writeFileSync(path.join(nested, "package.nls.json"), JSON.stringify({
    displayName: "GitHub",
  }, null, 2))
  fs.mkdirSync(path.join(nested, "node_modules", "fake-extension"), { recursive: true })
  fs.writeFileSync(path.join(nested, "node_modules", "fake-extension", "package.json"), JSON.stringify({
    name: "fake-extension",
    publisher: "ignored",
  }))

  const scanned = scanExtensions({ extensionsDir: root })
  const github = scanned.byId.get("vscode.github")

  assert.equal(scanned.byId.has("vscode.git-base"), true)
  assert.equal(github.id, "vscode.github")
  assert.equal(github.displayName, "GitHub")
  assert.deepEqual(github.extensionDependencies, ["vscode.git-base"])
  assert.equal(scanned.byId.has("ignored.fake-extension"), false)
})

test("scanExtensions removes extensions with dependency loops before EH InitData", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-scan-loop-"))
  writeExtension(root, "codek.loop-a", {
    name: "loop-a",
    publisher: "codek",
    version: "1.0.0",
    main: "./extension.js",
    activationEvents: ["onCommand:loop.a"],
    extensionDependencies: ["codek.loop-b"],
  })
  writeExtension(root, "codek.loop-b", {
    name: "loop-b",
    publisher: "codek",
    version: "1.0.0",
    main: "./extension.js",
    activationEvents: ["onCommand:loop.b"],
    extensionDependencies: ["codek.loop-a"],
  })
  writeExtension(root, "codek.good", {
    name: "good",
    publisher: "codek",
    version: "1.0.0",
    main: "./extension.js",
    activationEvents: ["onCommand:good.run"],
    extensionDependencies: ["codek.missing-ok"],
  })

  const scanned = scanExtensions({ extensionsDir: root })

  assert.deepEqual(scanned.allExtensions.map((extension) => extension.id), ["codek.good"])
  assert.equal(scanned.byId.has("codek.loop-a"), false)
  assert.equal(scanned.byId.has("codek.loop-b"), false)
  assert.deepEqual(scanned.removedDueToLooping.map((extension) => extension.id).sort(), ["codek.loop-a", "codek.loop-b"])
  assert.equal(scanned.activationEvents["codek.loop-a"], undefined)
  assert.equal(scanned.activationEventsByEvent["onCommand:loop.a"], undefined)
  assert.deepEqual(scanned.activationEvents["codek.good"], ["onCommand:good.run"])
  assert.deepEqual(scanned.activationEventsByEvent["onCommand:good.run"], ["codek.good"])
})
