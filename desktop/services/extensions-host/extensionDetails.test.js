const assert = require("node:assert/strict")
const test = require("node:test")

const {
  buildExtensionDetailsPayload,
  normalizeExtensionDetails,
  splitExtensionId,
  summarizeCompatibilityForExtension,
} = require("./extensionDetails")

test("extension details split and normalize marketplace metadata", () => {
  assert.deepEqual(splitExtensionId("ms-python.python"), { namespace: "ms-python", name: "python" })
  const details = normalizeExtensionDetails({
    namespace: "ms-python",
    name: "python",
    extensionPack: "ms-python.vscode-pylance",
    extensionDependencies: ["ms-python.debugpy"],
    engines: { vscode: "^1.90.0" },
    capabilities: {
      untrustedWorkspaces: {
        supported: false,
        description: "Python extension reads workspace files.",
        restrictedConfigurations: ["python.defaultInterpreterPath"],
      },
    },
  })

  assert.equal(details.id, "ms-python.python")
  assert.deepEqual(details.extensionPack, ["ms-python.vscode-pylance"])
  assert.deepEqual(details.extensionDependencies, ["ms-python.debugpy"])
  assert.equal(details.engines.vscode, "^1.90.0")
  assert.equal(details.capabilities.untrustedWorkspaces.supported, false)
  assert.deepEqual(details.capabilities.untrustedWorkspaces.restrictedConfigurations, ["python.defaultInterpreterPath"])
})

test("extension details payload merges readme, versions, install plan, install state, and compatibility", () => {
  const payload = buildExtensionDetailsPayload({
    details: {
      id: "ms-python.python",
      name: "python",
      publisher: "ms-python",
      version: "1.0.0",
      iconUrl: "https://example.com/icon.png",
      iconUrlFallback: "https://example.com/fallback.png",
      capabilities: {
        untrustedWorkspaces: {
          supported: false,
          description: "Python extension reads workspace files.",
          restrictedConfigurations: ["python.defaultInterpreterPath"],
        },
      },
      contributes: {
        commands: [{ command: "python.exec", title: "Run Python" }],
        configuration: { properties: { "python.defaultInterpreterPath": { type: "string" } } },
      },
    },
    readme: { id: "ms-python.python", readme: "# Python", available: true },
    versions: { versions: [{ version: "1.0.0" }] },
    installPlan: { readyToInstall: true },
    installState: { status: "installed", source: "marketplace", lastError: "" },
    installedExtensions: [{
      id: "ms-python.python",
      version: "1.0.0",
      enabled: true,
      installPath: "x",
      availability: { status: "activated", label: "已激活", detail: "Extension host activated", reason: "extension-host" },
      iconSource: "gallery",
      iconDataUrl: "data:image/svg+xml;base64,abc",
    }],
    compatibilityReport: {
      extensions: [{
        id: "ms-python.python",
        status: "degraded",
        blockers: [],
        warnings: [{ id: "partial", message: "partial" }],
        unsupportedContributionPoints: ["themes"],
      }],
    },
    audit: [{ action: "install" }],
  })

  assert.equal(payload.ready, true)
  assert.equal(payload.installed.version, "1.0.0")
  assert.equal(payload.installed.availability.status, "activated")
  assert.equal(payload.installed.iconSource, "gallery")
  assert.equal(payload.installed.iconDataUrl, "data:image/svg+xml;base64,abc")
  assert.equal(payload.readme.length, 8)
  assert.equal(payload.latestVersion, "1.0.0")
  assert.equal(payload.installPlan.readyToInstall, true)
  assert.equal(payload.installState.status, "installed")
  assert.equal(payload.installState.installSource, "marketplace")
  assert.equal(payload.extension.iconSource, "gallery")
  assert.equal(payload.extension.iconUrlFallback, "https://example.com/fallback.png")
  assert.equal(payload.extension.capabilities.untrustedWorkspaces.supported, false)
  assert.equal(payload.extension.capabilities.untrustedWorkspaces.description, "Python extension reads workspace files.")
  assert.equal(payload.extension.contributes.commands.length, 1)
  assert.equal(payload.extension.contributes.configuration.properties["python.defaultInterpreterPath"].type, "string")
  assert.equal(payload.compatibility.status, "degraded")
  assert.deepEqual(payload.compatibility.unsupportedContributionPoints, ["themes"])
  assert.equal(payload.audit.length, 1)
})

test("extension details payload preserves desktop product and configuration disablement evidence", () => {
  const payload = buildExtensionDetailsPayload({
    details: {
      id: "publisher.disabled",
      name: "disabled",
      publisher: "publisher",
      version: "1.0.0",
      enablement: {
        state: "DisabledByEnvironment",
        reason: "product",
        source: "desktop.extensionsHost.enablementMetadata",
        productDisablement: {
          disabled: true,
          source: "productService.disableExtensions",
          reason: "product-disableExtensions",
          runtimeReference: false,
        },
      },
      productDisablement: {
        disabled: true,
        source: "productService.disableExtensions",
        reason: "product-disableExtensions",
        runtimeReference: false,
      },
    },
    installedExtensions: [{
      id: "publisher.disabled",
      version: "1.0.0",
      enabled: false,
      installPath: "x",
      enablement: {
        state: "DisabledGlobally",
        reason: "globalUser",
        source: "desktop.extensionsHost.enablementMetadata",
        configurationDisablement: {
          disabled: true,
          source: "globalExtensionEnablementService.disabledExtensions",
          configKey: "extensionsIdentifiers/disabled",
          runtimeReference: false,
        },
      },
      configurationDisablement: {
        disabled: true,
        source: "globalExtensionEnablementService.disabledExtensions",
        configKey: "extensionsIdentifiers/disabled",
        runtimeReference: false,
      },
    }],
  })

  assert.equal(payload.extension.enablement.state, "DisabledByEnvironment")
  assert.equal(payload.extension.productDisablement.source, "productService.disableExtensions")
  assert.equal(payload.installed.enablement.state, "DisabledGlobally")
  assert.equal(payload.installed.configurationDisablement.source, "globalExtensionEnablementService.disabledExtensions")
  assert.equal(payload.installed.configurationDisablement.configKey, "extensionsIdentifiers/disabled")
})

test("extension compatibility summary returns unknown when extension is absent", () => {
  const summary = summarizeCompatibilityForExtension("missing.id", { extensions: [] })
  assert.equal(summary.available, false)
  assert.equal(summary.status, "unknown")
})
