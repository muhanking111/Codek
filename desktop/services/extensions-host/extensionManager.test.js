const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  _test,
  getInstalledExtensions,
  pickManifestInstallState,
  rollbackExtension,
} = require("./extensionManager")
const {
  getExtensionInstallRecord,
  updateExtensionInstallRecord,
} = require("./extensionInstallState")
const { readExtensionAuditLog } = require("./extensionAuditLog")

test("pickManifestInstallState preserves VS Code MCP contribution for installed discovery", () => {
  const state = pickManifestInstallState({
    publisher: "publisher",
    name: "mcp-tools",
    version: "1.0.0",
    displayName: "MCP Tools",
    activationEvents: ["onStartupFinished"],
    capabilities: {
      untrustedWorkspaces: {
        supported: false,
        description: "Requires trusted workspace file access.",
        restrictedConfigurations: ["publisher.mcp-tools.workspaceRoot"],
      },
    },
    contributes: {
      mcp: {
        servers: {
          installedServer: {
            command: "node",
            args: ["server.js"],
          },
        },
      },
      commands: [{ command: "ignored.command" }],
    },
  })

  assert.equal(state.manifest.id, "publisher.mcp-tools")
  assert.equal(state.manifest.contributes.mcp.servers.installedServer.command, "node")
  assert.equal(state.mcp.servers.installedServer.args[0], "server.js")
  assert.equal(state.manifest.contributes.commands, undefined)
  assert.equal(state.manifest.capabilities.untrustedWorkspaces.supported, false)
  assert.deepEqual(state.manifest.capabilities.untrustedWorkspaces.restrictedConfigurations, ["publisher.mcp-tools.workspaceRoot"])
})

test("pickManifestInstallState prefers explicit top-level MCP resource", () => {
  const state = pickManifestInstallState({
    publisher: "publisher",
    name: "mcp-tools",
    version: "1.0.0",
    mcp: {
      servers: {
        topLevelServer: { command: "node" },
      },
    },
    contributes: {
      mcp: {
        servers: {
          contributedServer: { command: "python" },
        },
      },
    },
  })

  assert.equal(state.mcp.servers.topLevelServer.command, "node")
  assert.equal(state.manifest.contributes.mcp.servers.contributedServer.command, "python")
})

test("VSIX path safety rejects install targets outside the extensions directory", () => {
  const root = path.join(os.tmpdir(), "codek-ext-safe-root")

  assert.equal(_test.assertPathInside(root, path.join(root, "publisher.sample"), "target"), path.resolve(root, "publisher.sample"))
  assert.throws(
    () => _test.assertPathInside(root, path.join(root, "..", "outside"), "target"),
    /Invalid \.vsix: target must stay inside/,
  )
})

test("VSIX manifest identity must not contain path separators", () => {
  assert.equal(_test.assertSafeExtensionIdentity("publisher", "sample-tool"), "publisher.sample-tool")
  assert.throws(
    () => _test.assertSafeExtensionIdentity("publisher", "../sample"),
    /publisher\/name must be simple identifiers/,
  )
  assert.throws(
    () => _test.assertSafeExtensionIdentity("bad/publisher", "sample"),
    /publisher\/name must be simple identifiers/,
  )
})

test("VSIX extracted tree safety rejects symbolic links", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-tree-safe-"))
  const extensionDir = path.join(root, "extension")
  fs.mkdirSync(extensionDir, { recursive: true })
  fs.writeFileSync(path.join(extensionDir, "package.json"), JSON.stringify({
    name: "sample",
    publisher: "publisher",
    version: "1.0.0",
  }))
  const linkPath = path.join(extensionDir, "linked-package.json")
  try {
    fs.symlinkSync(path.join(extensionDir, "package.json"), linkPath)
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") {
      t.skip("current Windows permissions do not allow creating symlinks")
      return
    }
    throw error
  }

  await assert.rejects(
    () => _test.assertExtractedTreeSafe(root),
    /symbolic links are not allowed/,
  )
})

test("getInstalledExtensions projects VS Code-style icon and availability state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-manager-"))
  const extDir = path.join(root, "publisher.sample")
  fs.mkdirSync(path.join(extDir, "media"), { recursive: true })
  fs.writeFileSync(path.join(extDir, "media", "icon.svg"), "<svg />", "utf8")
  fs.writeFileSync(path.join(extDir, ".codek-installed.json"), JSON.stringify({ builtin: false, source: "vsix" }))
  fs.writeFileSync(path.join(extDir, "package.json"), JSON.stringify({
    name: "sample",
    publisher: "publisher",
    version: "1.0.0",
    displayName: "Sample",
    description: "Sample extension",
    icon: "media/icon.svg",
    main: "./extension.js",
    activationEvents: ["onStartupFinished"],
    engines: { vscode: "*" },
    capabilities: {
      untrustedWorkspaces: {
        supported: false,
        description: "Sample needs trusted workspace file access.",
        restrictedConfigurations: ["publisher.sample.workspaceRoot"],
      },
      virtualWorkspaces: { supported: "limited" },
    },
    contributes: {
      webviews: [{ viewType: "sample.webview" }],
    },
  }))

  const statePath = path.join(root, "install-state.json")
  const installed = getInstalledExtensions({
    extensionsDir: root,
    stateFilePath: statePath,
    lifecycle: {
      activated: ["publisher.sample"],
      activationErrors: [],
      runtimeErrors: [],
    },
  })

  assert.equal(installed.length, 1)
  assert.equal(installed[0].id, "publisher.sample")
  assert.equal(installed[0].builtin, false)
  assert.equal(installed[0].icon, "media/icon.svg")
  assert.equal(installed[0].iconSource, "manifest")
  assert.equal(installed[0].iconCacheUrl, "/extensions-host/installed/publisher.sample/icon")
  assert.equal(installed[0].defaultIcon, true)
  assert.equal(installed[0].availability.status, "unsupported")
  assert.equal(installed[0].availability.reason, "compatibility")
  assert.equal(installed[0].status, "unsupported")
  assert.match(installed[0].statusDetail, /webviews|contribution/i)
  assert.equal(installed[0].capabilities.untrustedWorkspaces.supported, false)
  assert.equal(installed[0].capabilities.untrustedWorkspaces.description, "Sample needs trusted workspace file access.")
  assert.deepEqual(installed[0].capabilities.untrustedWorkspaces.restrictedConfigurations, ["publisher.sample.workspaceRoot"])
  assert.equal(installed[0].capabilities.virtualWorkspaces.supported, "limited")
})

test("getInstalledExtensions carries desktop enablement metadata from real configuration sources", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-enablement-"))
  const productDisabledDir = path.join(root, "publisher.product-disabled")
  const allowlistDisabledDir = path.join(root, "publisher.allowlist-disabled")
  const globalDisabledDir = path.join(root, "publisher.global-disabled")
  for (const [dir, name] of [
    [productDisabledDir, "product-disabled"],
    [allowlistDisabledDir, "allowlist-disabled"],
    [globalDisabledDir, "global-disabled"],
  ]) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
      name,
      publisher: "publisher",
      version: "1.0.0",
      engines: { vscode: "*" },
    }))
  }

  const installed = getInstalledExtensions({
    extensionsDir: root,
    productService: {
      disableExtensions: ["publisher.product-disabled"],
    },
    userSettings: {
      "extensions.allowed": {
        "publisher.product-disabled": true,
        "publisher.global-disabled": true,
        "*": false,
      },
    },
    disabledExtensions: ["publisher.global-disabled"],
  })
  const byId = new Map(installed.map((extension) => [extension.id, extension]))

  assert.equal(byId.get("publisher.product-disabled").enabled, false)
  assert.equal(byId.get("publisher.product-disabled").enablement.state, "DisabledByEnvironment")
  assert.equal(byId.get("publisher.product-disabled").productDisablement.source, "productService.disableExtensions")
  assert.equal(byId.get("publisher.allowlist-disabled").enabled, false)
  assert.equal(byId.get("publisher.allowlist-disabled").enablement.state, "DisabledByAllowlist")
  assert.equal(byId.get("publisher.allowlist-disabled").configurationDisablement.source, "configurationService.extensions.allowed")
  assert.equal(byId.get("publisher.global-disabled").enabled, false)
  assert.equal(byId.get("publisher.global-disabled").enablement.state, "DisabledGlobally")
  assert.equal(byId.get("publisher.global-disabled").configurationDisablement.source, "globalExtensionEnablementService.disabledExtensions")
})

test("rollbackExtension records restored install state and audit evidence", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-rollback-"))
  const previousData = process.env.CODEK_DATA
  process.env.CODEK_DATA = root
  const targetDir = path.join(root, "extensions", "publisher.sample")
  const backupDir = path.join(root, "backup", "publisher.sample")
  fs.mkdirSync(targetDir, { recursive: true })
  fs.writeFileSync(path.join(targetDir, "package.json"), JSON.stringify({ version: "2.0.0" }))
  fs.mkdirSync(backupDir, { recursive: true })
  fs.writeFileSync(path.join(backupDir, "package.json"), JSON.stringify({ version: "1.0.0" }))
  updateExtensionInstallRecord("publisher.sample", {
    status: "installed",
    version: "2.0.0",
    installPath: targetDir,
    lastBackup: {
      extensionId: "publisher.sample",
      backupDir,
      targetDir,
      reason: "replace",
    },
  })

  try {
    const restored = await rollbackExtension("publisher.sample")
    const record = getExtensionInstallRecord("publisher.sample")

    assert.equal(restored.targetDir, targetDir)
    assert.equal(JSON.parse(fs.readFileSync(path.join(targetDir, "package.json"), "utf8")).version, "1.0.0")
    assert.equal(record.status, "installed")
    assert.equal(record.phase, "rollback")
    assert.equal(record.rollbackStatus, "restored")
    assert.equal(record.enabled, true)
    assert.equal(record.lastError, "")
    assert.ok(record.lastRollbackAt)
    const [audit] = readExtensionAuditLog({ limit: 1 })
    assert.equal(audit.action, "rollback")
    assert.equal(audit.extensionId, "publisher.sample")
    assert.equal(audit.phase, "restore")
    assert.equal(audit.status, "success")
    assert.equal(audit.backupPath, backupDir)
    assert.equal(audit.targetPath, targetDir)
  } finally {
    if (previousData == null) delete process.env.CODEK_DATA
    else process.env.CODEK_DATA = previousData
  }
})
