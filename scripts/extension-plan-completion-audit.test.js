const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  REQUIRED_CODE_FILES,
  buildExtensionPlanCompletionAudit,
  parseArgs,
  readLatestExtensionPlanCompletionAudit,
  saveExtensionPlanCompletionAudit,
} = require("./extension-plan-completion-audit")

function writeFile(filePath, content = "") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, "utf8")
}

function writeJson(filePath, value) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function writeFixtureRoot() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-plan-audit-"))
  const reportDir = path.join(rootDir, ".codek", "reports")
  for (const filePath of REQUIRED_CODE_FILES) {
    writeFile(path.join(rootDir, filePath), "fixture\n")
  }
  writeFile(path.join(rootDir, "docs", "RELEASE_RUNBOOK.md"), "扩展 release-evidence gate 门禁\n")
  writeFile(path.join(rootDir, "README.md"), "Codek supports VS Code extension ecosystem compatibility evidence.\n")
  fs.mkdirSync(reportDir, { recursive: true })
  writeJson(path.join(reportDir, "extension-baseline-latest.json"), {
    ready: true,
    extensionInventory: { total: 99 },
  })
  writeJson(path.join(reportDir, "extension-ecosystem-health-latest.json"), { ready: true })
  writeJson(path.join(reportDir, "extension-marketplace-smoke-latest.json"), {
    ready: true,
    summary: { total: 5, passed: 5, failed: 0 },
  })
  writeJson(path.join(reportDir, "extension-install-smoke-latest.json"), {
    ready: true,
    summary: { total: 6, passed: 5, warning: 1, failed: 0 },
  })
  writeJson(path.join(reportDir, "extension-marketplace-install-matrix-latest.json"), {
    ready: true,
    summary: {
      top: 100,
      metadataUsable: 95,
      installChainComplete: 90,
      activationPreflightReady: 40,
    },
    installation: { isolated: true },
  })
  writeJson(path.join(reportDir, "extension-migration-smoke-latest.json"), {
    ready: true,
    dryRun: true,
    evidence: { queue: { installed: 0, installPolicy: "user-confirmed" } },
  })
  writeJson(path.join(reportDir, "extension-security-smoke-latest.json"), {
    ready: true,
    checks: [
      { id: "restricted_workspace_blocks_install", status: "passed" },
      { id: "unknown_workspace_requires_confirmation", status: "passed" },
      { id: "publisher_deny_policy", status: "passed" },
      { id: "audit_log_redacts_secrets", status: "passed" },
    ],
  })
  writeJson(path.join(reportDir, "extension-compatibility-matrix-latest.json"), {
    ready: true,
    summary: { top: 100, blocked: 0 },
  })
  writeJson(path.join(reportDir, "eh-e2e-marketplace-latest.json"), {
    ready: true,
    phase: "done",
    extensionId: "streetsidesoftware.code-spell-checker-spanish",
    searchCount: 5,
  })
  writeJson(path.join(reportDir, "eh-e2e-memento-storage-latest.json"), {
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
  })
  writeJson(path.join(reportDir, "eh-e2e-extension-context-latest.json"), {
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
  })
  writeJson(path.join(reportDir, "eh-e2e-implicit-activation-latest.json"), {
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
  })
  writeJson(path.join(reportDir, "eh-e2e-dependency-loop-latest.json"), {
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
  })
  writeJson(path.join(reportDir, "eh-e2e-search-provider-latest.json"), {
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
    textProviderCalled: true,
    fileProviderCalled: true,
    textSearchEngine: "extension-search",
    textSearchProvider: "extension-host",
    fileSearchEngine: "extension-search",
    fallbackBypassed: true,
    providerErrors: [],
  })
  writeJson(path.join(reportDir, "eh-e2e-profile-content-handler-latest.json"), {
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
    activatedByOnProfileHandler: true,
    handlerRegistered: true,
    handlerMetadataMatched: true,
    readProfileCalled: true,
    readProfileReturnedTemplate: true,
    saveProfileCalled: true,
    saveProfileReturnedResult: true,
    cleanupAfterStop: true,
    providerErrors: [],
  })
  writeJson(path.join(reportDir, "eh-e2e-mcp-provider-latest.json"), {
    ready: true,
    status: "ready",
    extensionId: "publisher.sample",
    collectionId: "publisher.sample/sample-provider",
    mainThreadMcpRegistered: true,
    definitionsPublishedToExtHost: true,
    delegateTransportStarted: true,
    secretRedactionVerified: true,
    deletePublishesEmptyDefinitions: true,
    providerErrors: [],
  })
  writeJson(path.join(reportDir, "installed-mcp-discovery-latest.json"), {
    ready: true,
    status: "ready",
    extensionId: "publisher.installed-mcp-tools",
    installedMcpPersisted: true,
    installedDiscoveryRead: true,
    installedRegistryApplied: true,
    workspaceDiscoveryFilteredInRegistryMode: true,
    secretRedactionVerified: true,
    providerErrors: [],
  })
  writeJson(path.join(reportDir, "mcp-gallery-management-latest.json"), {
    ready: true,
    status: "ready",
    galleryInstallReady: true,
    workspaceResourceWritten: true,
    workspaceRegistryConsumed: true,
    workbenchRegistryRouteReady: true,
    registryRouteSnapshot: { collections: 1, servers: 1, delegates: 1 },
    galleryUninstallReady: true,
    lifecycleEventsEmitted: true,
    providerErrors: [],
  })
  writeJson(path.join(reportDir, "extension-enterprise-gate-latest.json"), {
    ready: true,
    summary: { total: 10, passed: 10, failed: 0 },
    gaps: [],
  })
  writeJson(path.join(reportDir, "bd-enterprise-candidate-latest.json"), {
    ready: true,
    missingSteps: [],
    steps: [
      { id: "extension_migration_smoke", passed: true },
      { id: "extension_security_smoke", passed: true },
      { id: "eh_memento_storage_e2e", passed: true },
      { id: "eh_extension_context_e2e", passed: true },
      { id: "eh_implicit_activation_e2e", passed: true },
      { id: "eh_dependency_loop_e2e", passed: true },
      { id: "eh_search_provider_e2e", passed: true },
      { id: "eh_profile_content_handler_e2e", passed: true },
      { id: "installed_mcp_discovery_smoke", passed: true },
      { id: "mcp_gallery_management_smoke", passed: true },
      { id: "eh_mcp_provider_bridge", passed: true },
      { id: "release_evidence_export", passed: true },
    ],
  })
  writeJson(path.join(reportDir, "release-evidence-latest.json"), {
    ready: true,
    summary: { baseReady: true, enterpriseComplete: false },
    gaps: [{ id: "manual_real_ui_evidence", severity: "low" }],
    evidence: {
      extensionMarketplaceSmoke: { ready: true },
      extensionInstallSmoke: { ready: true },
      extensionMarketplaceInstallMatrix: { ready: true },
      extensionMigrationSmoke: { ready: true },
      extensionSecuritySmoke: { ready: true },
      ehMarketplaceE2e: { ready: true },
      ehMementoStorageE2e: { ready: true },
      ehExtensionContextE2e: { ready: true },
      ehImplicitActivationE2e: { ready: true },
      ehDependencyLoopE2e: { ready: true },
      ehSearchProviderE2e: { ready: true },
      ehProfileContentHandlerE2e: { ready: true },
      installedMcpDiscovery: { ready: true },
      mcpGalleryManagement: { ready: true },
      ehMcpProviderBridge: { ready: true },
      extensionCompatibilityMatrix: { ready: true },
      extensionEnterpriseGate: { ready: true },
    },
  })
  writeJson(path.join(reportDir, "manual-real-ui-evidence-latest.json"), {
    ready: false,
    manualRunConfirmed: false,
    cursorLevelSmoothnessConfirmed: false,
    windowsExplorerCrossCheckConfirmed: false,
  })
  return { rootDir, reportDir }
}

test("parseArgs supports no-write, root and report dir", () => {
  const parsed = parseArgs(["--no-write", "--gate-in-progress", "--root=C:/repo", "--report-dir=C:/repo/.codek/reports"])

  assert.equal(parsed.gateInProgress, true)
  assert.equal(parsed.noWrite, true)
  assert.equal(parsed.rootDir, "C:/repo")
  assert.equal(parsed.reportDir, "C:/repo/.codek/reports")
})

test("extension plan audit passes automated evidence but keeps manual UI evidence separate", () => {
  const { rootDir, reportDir } = writeFixtureRoot()
  const report = buildExtensionPlanCompletionAudit({ rootDir, reportDir, createdAt: 1 })

  assert.equal(report.ready, true)
  assert.equal(report.enterpriseComplete, false)
  assert.equal(report.status, "ready-with-manual-evidence-required")
  assert.equal(report.summary.missing, 0)
  assert.equal(report.summary.manualRequired, 1)
  assert.equal(report.requirements.some((item) => item.id === "eh_marketplace_e2e" && item.status === "passed"), true)
  assert.equal(report.requirements.some((item) => item.id === "eh_memento_storage_e2e" && item.status === "passed"), true)
  assert.equal(report.requirements.some((item) => item.id === "eh_extension_context_e2e" && item.status === "passed"), true)
  assert.equal(report.requirements.some((item) => item.id === "eh_implicit_activation_e2e" && item.status === "passed"), true)
  assert.equal(report.requirements.some((item) => item.id === "eh_dependency_loop_e2e" && item.status === "passed"), true)
  assert.equal(report.requirements.some((item) => item.id === "eh_search_provider_e2e" && item.status === "passed"), true)
  assert.equal(report.requirements.some((item) => item.id === "eh_profile_content_handler_e2e" && item.status === "passed"), true)
  assert.equal(report.requirements.some((item) => item.id === "installed_mcp_discovery_smoke" && item.status === "passed"), true)
  assert.equal(report.requirements.some((item) => item.id === "mcp_gallery_management_smoke" && item.status === "passed"), true)
  assert.equal(report.requirements.some((item) => item.id === "eh_mcp_provider_bridge" && item.status === "passed"), true)
  assert.equal(report.requirements.some((item) => item.id === "manual_real_ui_evidence" && item.status === "manual_required"), true)
})

test("extension plan audit blocks when EH marketplace E2E report is missing", () => {
  const { rootDir, reportDir } = writeFixtureRoot()
  fs.unlinkSync(path.join(reportDir, "eh-e2e-marketplace-latest.json"))

  const report = buildExtensionPlanCompletionAudit({ rootDir, reportDir, createdAt: 1 })

  assert.equal(report.ready, false)
  assert.equal(report.enterpriseComplete, false)
  assert.equal(report.requirements.some((item) => item.id === "eh_marketplace_e2e" && item.status === "missing"), true)
})

test("extension plan audit accepts ready extension summary when release evidence is blocked only by manual or audit gaps", () => {
  const { rootDir, reportDir } = writeFixtureRoot()
  writeJson(path.join(reportDir, "release-evidence-latest.json"), {
    ready: false,
    summary: { baseReady: false, enterpriseComplete: false },
    gaps: [
      { id: "enterprise_doc_completion_audit", severity: "high" },
      { id: "extension_plan_completion_audit", severity: "high" },
      { id: "manual_real_ui_evidence", severity: "low" },
    ],
    evidence: {
      extensionMarketplaceSmoke: { ready: true },
      extensionInstallSmoke: { ready: true },
      extensionMarketplaceInstallMatrix: { ready: true },
      extensionMigrationSmoke: { ready: true },
      extensionSecuritySmoke: { ready: true },
      ehMarketplaceE2e: { ready: true },
      ehMementoStorageE2e: { ready: true },
      ehExtensionContextE2e: { ready: true },
      ehImplicitActivationE2e: { ready: true },
      ehDependencyLoopE2e: { ready: true },
      ehSearchProviderE2e: { ready: true },
      ehProfileContentHandlerE2e: { ready: true },
      installedMcpDiscovery: { ready: true },
      mcpGalleryManagement: { ready: true },
      ehMcpProviderBridge: { ready: true },
      extensionCompatibilityMatrix: { ready: true },
      extensionEnterpriseGate: { ready: true },
    },
  })

  const report = buildExtensionPlanCompletionAudit({ rootDir, reportDir, createdAt: 1 })
  const requirement = report.requirements.find((item) => item.id === "release_evidence_extension_summary")

  assert.equal(requirement.status, "passed")
  assert.equal(requirement.evidence.ready, false)
  assert.deepEqual(requirement.evidence.notReadyKeys, [])
  assert.equal(report.ready, true)
})

test("extension plan audit avoids BD gate and release evidence self-reference while gate is in progress", () => {
  const { rootDir, reportDir } = writeFixtureRoot()
  writeJson(path.join(reportDir, "bd-enterprise-candidate-latest.json"), {
    ready: false,
    missingSteps: ["extension_plan_completion_audit", "enterprise_doc_completion_audit", "release_evidence_export"],
    steps: [
      { id: "extension_migration_smoke", passed: true },
      { id: "extension_security_smoke", passed: true },
    ],
  })
  writeJson(path.join(reportDir, "release-evidence-latest.json"), {
    ready: false,
    gaps: [
      { id: "extension_plan_completion_audit", severity: "high" },
      { id: "manual_real_ui_evidence", severity: "low" },
    ],
    evidence: {},
  })

  const report = buildExtensionPlanCompletionAudit({ rootDir, reportDir, createdAt: 1, gateInProgress: true })

  assert.equal(report.ready, true)
  assert.equal(report.enterpriseComplete, false)
  assert.equal(report.status, "ready-with-manual-evidence-required")
  assert.equal(report.summary.missing, 0)
  assert.equal(report.requirements.find((item) => item.id === "bd_enterprise_candidate_gate").evidence.gateInProgress, true)
  assert.equal(report.requirements.find((item) => item.id === "release_evidence_extension_summary").evidence.deferredUntilFinalGateReport, true)
})

test("extension plan audit saves and reads latest reports", () => {
  const { rootDir, reportDir } = writeFixtureRoot()
  const report = buildExtensionPlanCompletionAudit({ rootDir, reportDir, createdAt: 1 })
  const saved = saveExtensionPlanCompletionAudit(report, { reportDir })
  const latest = readLatestExtensionPlanCompletionAudit({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.reportKind, "extension-plan-completion-audit")
  assert.equal(latest.report.ready, true)
})
