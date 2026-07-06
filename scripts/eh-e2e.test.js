const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  DEFAULT_REQUIRED,
  defaultReportDir,
  createMementoStorageExtension,
  createExtensionContextExtension,
  createImplicitActivationExtension,
  createDependencyLoopExtensions,
  createProfileContentHandlerExtension,
  createSearchProviderExtension,
  makeEhE2eMarketplacePaths,
  makeEhE2eDependencyLoopPaths,
  makeEhE2eExtensionContextPaths,
  makeEhE2eImplicitActivationPaths,
  makeEhE2eMementoStoragePaths,
  makeEhE2eProfileContentHandlerPaths,
  makeEhE2eSearchProviderPaths,
  normalizeId,
  parseArgs,
  saveEhE2eDependencyLoopReport,
  saveEhE2eExtensionContextReport,
  saveEhE2eImplicitActivationReport,
  saveEhE2eMementoStorageReport,
  saveEhE2eMarketplaceReport,
  saveEhE2eProfileContentHandlerReport,
  saveEhE2eSearchProviderReport,
} = require("./eh-e2e")
const { scanExtensions } = require("../desktop/services/extensions-host/extensionScanner")

test("parseArgs keeps default required extensions and timeout", () => {
  assert.deepEqual(parseArgs([]), {
    required: DEFAULT_REQUIRED,
    timeoutMs: 12000,
    mode: "default",
    reportPath: "",
    reportDir: defaultReportDir(),
  })
})

test("parseArgs supports js-debug mode, timeout, report path, and explicit required ids", () => {
  assert.deepEqual(parseArgs(["--js-debug", "--timeout=45000", "--report=out.json", "git"]), {
    required: ["git"],
    timeoutMs: 45000,
    mode: "js-debug",
    reportPath: "out.json",
    reportDir: defaultReportDir(),
  })
})

test("parseArgs supports memento storage mode", () => {
  assert.deepEqual(parseArgs(["--memento-storage", "--timeout=18000", "--report-dir=out"]), {
    required: DEFAULT_REQUIRED,
    timeoutMs: 18000,
    mode: "memento-storage",
    reportPath: "",
    reportDir: "out",
  })
})

test("parseArgs supports extension context mode", () => {
  assert.deepEqual(parseArgs(["--extension-context", "--timeout=18000", "--report-dir=out"]), {
    required: DEFAULT_REQUIRED,
    timeoutMs: 18000,
    mode: "extension-context",
    reportPath: "",
    reportDir: "out",
  })
})

test("parseArgs supports implicit activation mode", () => {
  assert.deepEqual(parseArgs(["--implicit-activation", "--timeout=18000", "--report-dir=out"]), {
    required: DEFAULT_REQUIRED,
    timeoutMs: 18000,
    mode: "implicit-activation",
    reportPath: "",
    reportDir: "out",
  })
})

test("parseArgs supports dependency loop mode", () => {
  assert.deepEqual(parseArgs(["--dependency-loop", "--timeout=18000", "--report-dir=out"]), {
    required: DEFAULT_REQUIRED,
    timeoutMs: 18000,
    mode: "dependency-loop",
    reportPath: "",
    reportDir: "out",
  })
})

test("parseArgs supports search provider mode", () => {
  assert.deepEqual(parseArgs(["--search-provider", "--timeout=18000", "--report-dir=out"]), {
    required: DEFAULT_REQUIRED,
    timeoutMs: 18000,
    mode: "search-provider",
    reportPath: "",
    reportDir: "out",
  })
})

test("parseArgs supports profile content handler mode", () => {
  assert.deepEqual(parseArgs(["--profile-content-handler", "--timeout=18000", "--report-dir=out"]), {
    required: DEFAULT_REQUIRED,
    timeoutMs: 18000,
    mode: "profile-content-handler",
    reportPath: "",
    reportDir: "out",
  })
})

test("parseArgs ignores invalid timeout values", () => {
  assert.equal(parseArgs(["--timeout=nope"]).timeoutMs, 12000)
  assert.equal(parseArgs(["--timeout=-1"]).timeoutMs, 12000)
})

test("normalizeId adds vscode publisher only to shorthand ids", () => {
  assert.equal(normalizeId("git"), "vscode.git")
  assert.equal(normalizeId("ms-vscode.js-debug"), "ms-vscode.js-debug")
})

test("marketplace report paths and save helper write latest evidence", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-eh-marketplace-"))
  const paths = makeEhE2eMarketplacePaths(reportDir)
  const saved = saveEhE2eMarketplaceReport({
    reportKind: "eh-e2e-marketplace",
    ready: false,
    status: "blocked",
    phase: "download",
    extensionId: "publisher.extension",
    error: "fetch failed",
  }, reportDir)

  assert.equal(paths.latestJsonPath, saved.latestJsonPath)
  assert.equal(fs.existsSync(paths.latestJsonPath), true)
  assert.equal(fs.existsSync(paths.latestMarkdownPath), true)
  const parsed = JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8"))
  assert.equal(parsed.phase, "download")
})

test("memento storage report paths and save helper write latest evidence", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-eh-memento-"))
  const paths = makeEhE2eMementoStoragePaths(reportDir)
  const saved = saveEhE2eMementoStorageReport({
    reportKind: "eh-e2e-memento-storage",
    ready: true,
    status: "ready",
    extensionId: "codek-smoke.memento-storage-smoke",
    profileId: "__default__profile__",
    globalStateStored: true,
    workspaceStateStored: true,
    syncKeysStored: true,
    thirdPartyExtensionId: "sample-vendor.memento-storage-third-party-smoke",
    thirdPartyExtensionScanned: true,
    thirdPartyExtensionBuiltinFalse: true,
    thirdPartyInstalledMarkerPresent: true,
    thirdPartyGlobalStateStored: true,
    thirdPartyWorkspaceStateStored: true,
    thirdPartySyncKeysStored: true,
    legacyStorageWritten: false,
  }, reportDir)

  assert.equal(paths.latestJsonPath, saved.latestJsonPath)
  assert.equal(fs.existsSync(paths.latestJsonPath), true)
  assert.equal(fs.existsSync(paths.latestMarkdownPath), true)
  const parsed = JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8"))
  assert.equal(parsed.ready, true)
  assert.equal(parsed.globalStateStored, true)
  assert.equal(parsed.thirdPartyExtensionBuiltinFalse, true)
  const markdown = fs.readFileSync(paths.latestMarkdownPath, "utf8")
  assert.match(markdown, /Third-party extension scanned: YES/)
  assert.match(markdown, /Third-party builtin=false: YES/)
})

test("extension context report paths and save helper write latest evidence", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-eh-context-"))
  const paths = makeEhE2eExtensionContextPaths(reportDir)
  const saved = saveEhE2eExtensionContextReport({
    reportKind: "eh-e2e-extension-context",
    ready: true,
    status: "ready",
    extensionId: "sample-vendor.extension-context-third-party-smoke",
    thirdPartyExtensionScanned: true,
    thirdPartyExtensionBuiltinFalse: true,
    thirdPartyInstalledMarkerPresent: true,
    packageJsonPreserved: true,
    extensionUriFile: true,
    extensionPathMatches: true,
    asAbsolutePathWorks: true,
    storageUriFile: true,
    globalStorageUriFile: true,
    logUriFile: true,
    checks: [{ id: "packageJsonPreserved", passed: true }],
    passedChecks: 1,
    checkCount: 1,
  }, reportDir)

  assert.equal(paths.latestJsonPath, saved.latestJsonPath)
  assert.equal(fs.existsSync(paths.latestJsonPath), true)
  assert.equal(fs.existsSync(paths.latestMarkdownPath), true)
  const parsed = JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8"))
  assert.equal(parsed.ready, true)
  assert.equal(parsed.packageJsonPreserved, true)
  assert.equal(parsed.thirdPartyExtensionBuiltinFalse, true)
  const markdown = fs.readFileSync(paths.latestMarkdownPath, "utf8")
  assert.match(markdown, /Package JSON preserved: YES/)
  assert.match(markdown, /extensionUri file: YES/)
})

test("implicit activation report paths and save helper write latest evidence", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-eh-implicit-"))
  const paths = makeEhE2eImplicitActivationPaths(reportDir)
  const saved = saveEhE2eImplicitActivationReport({
    reportKind: "eh-e2e-implicit-activation",
    ready: true,
    status: "ready",
    extensionId: "sample-vendor.implicit-activation-third-party-smoke",
    activationEvent: "onCommand:thirdPartySmoke.implicitActivation",
    thirdPartyExtensionScanned: true,
    thirdPartyExtensionBuiltinFalse: true,
    thirdPartyInstalledMarkerPresent: true,
    manifestHasExplicitActivationEvents: false,
    implicitOnCommandGenerated: true,
    activationEventsByEventHasExtension: true,
    activatedByImplicitEvent: true,
    commandContributionPreserved: true,
    extensionUriFile: true,
  }, reportDir)

  assert.equal(paths.latestJsonPath, saved.latestJsonPath)
  assert.equal(fs.existsSync(paths.latestJsonPath), true)
  assert.equal(fs.existsSync(paths.latestMarkdownPath), true)
  const parsed = JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8"))
  assert.equal(parsed.ready, true)
  assert.equal(parsed.manifestHasExplicitActivationEvents, false)
  assert.equal(parsed.implicitOnCommandGenerated, true)
  const markdown = fs.readFileSync(paths.latestMarkdownPath, "utf8")
  assert.match(markdown, /Manifest explicit activationEvents: NO/)
  assert.match(markdown, /Implicit onCommand generated: YES/)
})

test("dependency loop report paths and save helper write latest evidence", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-eh-loop-"))
  const paths = makeEhE2eDependencyLoopPaths(reportDir)
  const saved = saveEhE2eDependencyLoopReport({
    reportKind: "eh-e2e-dependency-loop",
    ready: true,
    status: "ready",
    loopExtensionIds: ["codek.loop-a", "codek.loop-b"],
    healthyExtensionId: "codek.good",
    removedDueToLooping: ["codek.loop-a", "codek.loop-b"],
    loopExtensionsAbsentFromAllExtensions: true,
    loopExtensionsAbsentFromById: true,
    loopActivationEventsAbsent: true,
    loopActivationEventsByEventAbsent: true,
    initDataLoopExtensionsAbsent: true,
    initDataMyExtensionsLoopAbsent: true,
    healthyExtensionScanned: true,
    healthyActivationEventIndexed: true,
    healthyExtensionInInitData: true,
    healthyActivated: true,
  }, reportDir)

  assert.equal(paths.latestJsonPath, saved.latestJsonPath)
  assert.equal(fs.existsSync(paths.latestJsonPath), true)
  assert.equal(fs.existsSync(paths.latestMarkdownPath), true)
  const parsed = JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8"))
  assert.equal(parsed.ready, true)
  assert.deepEqual(parsed.removedDueToLooping, ["codek.loop-a", "codek.loop-b"])
  const markdown = fs.readFileSync(paths.latestMarkdownPath, "utf8")
  assert.match(markdown, /Removed due to looping: codek\.loop-a, codek\.loop-b/)
  assert.match(markdown, /Healthy activated: YES/)
})

test("search provider report paths and save helper write latest evidence", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-eh-search-provider-"))
  const paths = makeEhE2eSearchProviderPaths(reportDir)
  const saved = saveEhE2eSearchProviderReport({
    reportKind: "eh-e2e-search-provider",
    ready: true,
    status: "ready",
    extensionId: "sample-vendor.search-provider-third-party-smoke",
    activationEvent: "onSearch:file",
    thirdPartyExtensionScanned: true,
    thirdPartyExtensionBuiltinFalse: true,
    thirdPartyInstalledMarkerPresent: true,
    activationEventsByEventHasExtension: true,
    enabledApiProposalsPresent: true,
    textProviderRegistered: true,
    fileProviderRegistered: true,
    activatedByOnSearchFile: true,
    textSearchEngine: "extension-search",
    textSearchProvider: "extension-host",
    textSearchHitPath: "provider-hit.txt",
    fileSearchEngine: "extension-search",
    fileSearchHitPath: "provider-file-target.txt",
    fallbackBypassed: true,
  }, reportDir)

  assert.equal(paths.latestJsonPath, saved.latestJsonPath)
  assert.equal(fs.existsSync(paths.latestJsonPath), true)
  assert.equal(fs.existsSync(paths.latestMarkdownPath), true)
  const parsed = JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8"))
  assert.equal(parsed.ready, true)
  assert.equal(parsed.textSearchEngine, "extension-search")
  assert.equal(parsed.fallbackBypassed, true)
  const markdown = fs.readFileSync(paths.latestMarkdownPath, "utf8")
  assert.match(markdown, /Text provider registered: YES/)
  assert.match(markdown, /Fallback bypassed: YES/)
})

test("profile content handler report paths and save helper write latest evidence", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-eh-profile-content-handler-"))
  const paths = makeEhE2eProfileContentHandlerPaths(reportDir)
  const saved = saveEhE2eProfileContentHandlerReport({
    reportKind: "eh-e2e-profile-content-handler",
    ready: true,
    status: "ready",
    extensionId: "sample-vendor.profile-content-handler-third-party-smoke",
    activationEvent: "onProfile:third-party-profile",
    handlerId: "third-party-profile",
    thirdPartyExtensionScanned: true,
    thirdPartyExtensionBuiltinFalse: true,
    thirdPartyInstalledMarkerPresent: true,
    activationEventsByEventHasExtension: true,
    enabledApiProposalsPresent: true,
    handlerRegistered: true,
    handlerMetadataMatched: true,
    readProfileCalled: true,
    readProfileReturnedTemplate: true,
    saveProfileCalled: true,
    saveProfileReturnedResult: true,
    cleanupAfterStop: true,
    providerErrors: [],
  }, reportDir)

  assert.equal(paths.latestJsonPath, saved.latestJsonPath)
  assert.equal(fs.existsSync(paths.latestJsonPath), true)
  assert.equal(fs.existsSync(paths.latestMarkdownPath), true)
  const parsed = JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8"))
  assert.equal(parsed.ready, true)
  assert.equal(parsed.handlerRegistered, true)
  assert.equal(parsed.readProfileReturnedTemplate, true)
  const markdown = fs.readFileSync(paths.latestMarkdownPath, "utf8")
  assert.match(markdown, /Handler registered: YES/)
  assert.match(markdown, /Cleanup after stop: YES/)
})

test("createMementoStorageExtension can write an installed third-party fixture", () => {
  const extensionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-eh-memento-fixture-"))
  const fixture = createMementoStorageExtension(extensionsRoot, {
    directoryName: "sample-vendor.memento-storage-third-party-smoke",
    publisher: "sample-vendor",
    name: "memento-storage-third-party-smoke",
    displayName: "Third-party Memento Storage Smoke",
    command: "thirdPartySmoke.mementoStorage",
    globalKey: "thirdPartySmokeGlobal",
    workspaceKey: "thirdPartySmokeWorkspace",
    syncKeys: ["thirdPartySmokeGlobal"],
    installedMarker: {
      builtin: false,
      source: "third-party-smoke",
    },
  })

  assert.equal(fixture.extensionId, "sample-vendor.memento-storage-third-party-smoke")
  assert.equal(fixture.command, "thirdPartySmoke.mementoStorage")
  assert.equal(fixture.globalKey, "thirdPartySmokeGlobal")
  assert.equal(fixture.workspaceKey, "thirdPartySmokeWorkspace")
  assert.equal(fs.existsSync(path.join(fixture.extensionDir, ".codek-installed.json")), true)

  const manifest = JSON.parse(fs.readFileSync(path.join(fixture.extensionDir, "package.json"), "utf8"))
  const marker = JSON.parse(fs.readFileSync(path.join(fixture.extensionDir, ".codek-installed.json"), "utf8"))
  assert.equal(manifest.publisher, "sample-vendor")
  assert.equal(manifest.name, "memento-storage-third-party-smoke")
  assert.deepEqual(manifest.activationEvents, ["onCommand:thirdPartySmoke.mementoStorage"])
  assert.deepEqual(marker, { builtin: false, source: "third-party-smoke" })
})

test("createExtensionContextExtension can write an installed third-party fixture", () => {
  const extensionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-eh-context-fixture-"))
  const resultPath = path.join(extensionsRoot, "context-result.json")
  const fixture = createExtensionContextExtension(extensionsRoot, { resultPath })

  assert.equal(fixture.extensionId, "sample-vendor.extension-context-third-party-smoke")
  assert.equal(fixture.command, "thirdPartySmoke.extensionContext")
  assert.equal(fixture.aiKey, "codek-context-ai-key")
  assert.equal(fs.existsSync(path.join(fixture.extensionDir, ".codek-installed.json")), true)

  const manifest = JSON.parse(fs.readFileSync(path.join(fixture.extensionDir, "package.json"), "utf8"))
  const marker = JSON.parse(fs.readFileSync(path.join(fixture.extensionDir, ".codek-installed.json"), "utf8"))
  const extensionJs = fs.readFileSync(path.join(fixture.extensionDir, "extension.js"), "utf8")
  assert.equal(manifest.publisher, "sample-vendor")
  assert.equal(manifest.name, "extension-context-third-party-smoke")
  assert.equal(manifest.aiKey, "codek-context-ai-key")
  assert.deepEqual(manifest.capabilities, { virtualWorkspaces: true, untrustedWorkspaces: { supported: true } })
  assert.deepEqual(manifest.activationEvents, ["onCommand:thirdPartySmoke.extensionContext"])
  assert.deepEqual(marker, { builtin: false, source: "third-party-context-smoke" })
  assert.match(extensionJs, /CODEK_EH_CONTEXT_REPORT_PATH/)
  assert.match(extensionJs, /context\.extension\.packageJSON\.aiKey/)
})

test("createImplicitActivationExtension omits explicit activationEvents and scanner derives onCommand", () => {
  const extensionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-eh-implicit-fixture-"))
  const resultPath = path.join(extensionsRoot, "implicit-result.json")
  const fixture = createImplicitActivationExtension(extensionsRoot, { resultPath })

  assert.equal(fixture.extensionId, "sample-vendor.implicit-activation-third-party-smoke")
  assert.equal(fixture.command, "thirdPartySmoke.implicitActivation")
  assert.equal(fs.existsSync(path.join(fixture.extensionDir, ".codek-installed.json")), true)

  const manifest = JSON.parse(fs.readFileSync(path.join(fixture.extensionDir, "package.json"), "utf8"))
  const marker = JSON.parse(fs.readFileSync(path.join(fixture.extensionDir, ".codek-installed.json"), "utf8"))
  const extensionJs = fs.readFileSync(path.join(fixture.extensionDir, "extension.js"), "utf8")
  assert.equal(Object.prototype.hasOwnProperty.call(manifest, "activationEvents"), false)
  assert.deepEqual(manifest.contributes.commands, [{
    command: "thirdPartySmoke.implicitActivation",
    title: "Third-party Implicit Activation Smoke",
  }])
  assert.deepEqual(marker, { builtin: false, source: "third-party-implicit-activation-smoke" })
  assert.match(extensionJs, /CODEK_EH_IMPLICIT_ACTIVATION_REPORT_PATH/)

  const scan = scanExtensions({ extensionsDir: extensionsRoot })
  const ext = scan.byId.get(fixture.extensionId)
  assert.equal(ext.isBuiltin, false)
  assert.equal(ext.activationEvents.includes("onCommand:thirdPartySmoke.implicitActivation"), true)
  assert.deepEqual(scan.activationEventsByEvent["onCommand:thirdPartySmoke.implicitActivation"], [fixture.extensionId])
})

test("createDependencyLoopExtensions writes looping fixtures and scanner removes them", () => {
  const extensionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-eh-loop-fixture-"))
  const fixture = createDependencyLoopExtensions(extensionsRoot)

  assert.deepEqual(fixture.loopExtensionIds, ["codek.loop-a", "codek.loop-b"])
  assert.equal(fixture.healthyExtensionId, "codek.good")
  assert.equal(fixture.healthyActivationEvent, "onCommand:good.run")
  assert.equal(fs.existsSync(path.join(fixture.healthyExtensionDir, ".codek-installed.json")), true)

  const scan = scanExtensions({ extensionsDir: extensionsRoot })
  assert.deepEqual(scan.allExtensions.map((extension) => extension.id), ["codek.good"])
  assert.deepEqual(scan.removedDueToLooping.map((extension) => extension.id).sort(), ["codek.loop-a", "codek.loop-b"])
  assert.equal(scan.byId.has("codek.loop-a"), false)
  assert.equal(scan.byId.has("codek.loop-b"), false)
  assert.equal(scan.activationEvents["codek.loop-a"], undefined)
  assert.equal(scan.activationEventsByEvent["onCommand:loop.a"], undefined)
  assert.equal(scan.activationEventsByEvent["onCommand:good.run"].includes("codek.good"), true)
})

test("createSearchProviderExtension writes installed third-party fixture and scanner indexes onSearch:file", () => {
  const extensionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-eh-search-provider-fixture-"))
  const resultPath = path.join(extensionsRoot, "search-provider-result.json")
  const workspaceRoot = path.join(extensionsRoot, "workspace")
  const textHitPath = path.join(workspaceRoot, "provider-hit.txt")
  const fileHitPath = path.join(workspaceRoot, "provider-file-target.txt")
  const fixture = createSearchProviderExtension(extensionsRoot, {
    resultPath,
    workspaceRoot,
    textHitPath,
    fileHitPath,
    needle: "CODEK_SEARCH_PROVIDER_NEEDLE",
  })

  assert.equal(fixture.extensionId, "sample-vendor.search-provider-third-party-smoke")
  assert.equal(fixture.activationEvent, "onSearch:file")
  assert.equal(fs.existsSync(path.join(fixture.extensionDir, ".codek-installed.json")), true)

  const manifest = JSON.parse(fs.readFileSync(path.join(fixture.extensionDir, "package.json"), "utf8"))
  const marker = JSON.parse(fs.readFileSync(path.join(fixture.extensionDir, ".codek-installed.json"), "utf8"))
  const extensionJs = fs.readFileSync(path.join(fixture.extensionDir, "extension.js"), "utf8")
  assert.equal(manifest.publisher, "sample-vendor")
  assert.equal(manifest.name, "search-provider-third-party-smoke")
  assert.deepEqual(manifest.activationEvents, ["onSearch:file"])
  assert.deepEqual(manifest.enabledApiProposals, ["textSearchProvider", "fileSearchProvider"])
  assert.deepEqual(marker, { builtin: false, source: "third-party-search-provider-smoke" })
  assert.match(extensionJs, /CODEK_EH_SEARCH_PROVIDER_REPORT_PATH/)
  assert.match(extensionJs, /registerTextSearchProvider/)
  assert.match(extensionJs, /registerFileSearchProvider/)

  const scan = scanExtensions({ extensionsDir: extensionsRoot })
  const ext = scan.byId.get(fixture.extensionId)
  assert.equal(ext.isBuiltin, false)
  assert.deepEqual(ext.enabledApiProposals, ["textSearchProvider", "fileSearchProvider"])
  assert.equal(ext.activationEvents.includes("onSearch:file"), true)
  assert.deepEqual(scan.activationEventsByEvent["onSearch:file"], [fixture.extensionId])
})

test("createProfileContentHandlerExtension writes installed third-party fixture and scanner indexes onProfile", () => {
  const extensionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-eh-profile-content-handler-fixture-"))
  const resultPath = path.join(extensionsRoot, "profile-content-handler-result.json")
  const savedPath = path.join(extensionsRoot, "exported.code-profile")
  const fixture = createProfileContentHandlerExtension(extensionsRoot, {
    resultPath,
    savedPath,
  })

  assert.equal(fixture.extensionId, "sample-vendor.profile-content-handler-third-party-smoke")
  assert.equal(fixture.activationEvent, "onProfile:third-party-profile")
  assert.equal(fixture.handlerId, "third-party-profile")
  assert.equal(fs.existsSync(path.join(fixture.extensionDir, ".codek-installed.json")), true)

  const manifest = JSON.parse(fs.readFileSync(path.join(fixture.extensionDir, "package.json"), "utf8"))
  const marker = JSON.parse(fs.readFileSync(path.join(fixture.extensionDir, ".codek-installed.json"), "utf8"))
  const extensionJs = fs.readFileSync(path.join(fixture.extensionDir, "extension.js"), "utf8")
  assert.equal(manifest.publisher, "sample-vendor")
  assert.equal(manifest.name, "profile-content-handler-third-party-smoke")
  assert.deepEqual(manifest.activationEvents, ["onProfile:third-party-profile"])
  assert.deepEqual(manifest.enabledApiProposals, ["profileContentHandlers"])
  assert.equal(Object.prototype.hasOwnProperty.call(manifest, "contributes"), false)
  assert.deepEqual(marker, { builtin: false, source: "third-party-profile-content-handler-smoke" })
  assert.match(extensionJs, /CODEK_EH_PROFILE_CONTENT_HANDLER_REPORT_PATH/)
  assert.match(extensionJs, /registerProfileContentHandler/)
  assert.match(extensionJs, /Third-party Imported Profile/)

  const scan = scanExtensions({ extensionsDir: extensionsRoot })
  const ext = scan.byId.get(fixture.extensionId)
  assert.equal(ext.isBuiltin, false)
  assert.deepEqual(ext.enabledApiProposals, ["profileContentHandlers"])
  assert.equal(ext.activationEvents.includes("onProfile:third-party-profile"), true)
  assert.deepEqual(scan.activationEventsByEvent["onProfile:third-party-profile"], [fixture.extensionId])
})
