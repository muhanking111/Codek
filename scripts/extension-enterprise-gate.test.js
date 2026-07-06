const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildExtensionEnterpriseGate,
  ehProfileContentHandlerReady,
  ehSearchProviderReady,
  parseArgs,
  readLatestExtensionEnterpriseGate,
  saveExtensionEnterpriseGate,
} = require("./extension-enterprise-gate")

function readyEhSearchProviderE2e() {
  return {
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
  }
}

function readyEhProfileContentHandlerE2e() {
  return {
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
  }
}

test("extension enterprise gate parseArgs supports report dir and no-write", () => {
  const parsed = parseArgs(["--no-write", "--report-dir=D:/reports"])
  assert.equal(parsed.noWrite, true)
  assert.equal(parsed.reportDir, "D:/reports")
})

test("extension enterprise gate is ready when baseline, ecosystem, and compatibility evidence pass", () => {
  const report = buildExtensionEnterpriseGate({
    baseline: {
      ready: true,
      extensionInventory: { total: 99 },
      marketplaceSamples: [{ query: "python", count: 5 }],
      capabilities: {
        marketplaceDetails: true,
        marketplaceDetailsPayload: true,
        marketplaceReadme: true,
        marketplaceVersions: true,
        installPlan: true,
        compatibilityReport: true,
        installState: true,
        auditLog: true,
        rollback: true,
      },
    },
    ecosystem: { ready: true, compatibilityMatrix: { summary: { sampledExtensions: 10, unsupportedContributionPoints: 0 } } },
    compatibility: { ready: true, summary: { blocked: 0, degraded: 0, total: 99 } },
    marketplaceSmoke: { ready: true, status: "ready", summary: { passed: 5, total: 5, failed: 0 } },
    installSmoke: { ready: true, status: "degraded", summary: { passed: 5, warning: 1, total: 6, failed: 0 } },
    marketplaceInstallMatrix: {
      ready: true,
      status: "ready",
      summary: { top: 100, metadataUsable: 95, installChainComplete: 90, activationPreflightReady: 40 },
      installation: { isolated: true },
    },
    compatibilityMatrix: { ready: true, status: "degraded", summary: { sampled: 100, top: 100, blocked: 0, degraded: 20 } },
    migrationSmoke: { ready: true, status: "ready", summary: { passed: 4, total: 4, failed: 0 } },
    securitySmoke: { ready: true, status: "ready", summary: { passed: 4, total: 4, failed: 0 } },
    ehMarketplaceE2e: { ready: true, status: "ready", phase: "done", extensionId: "streetsidesoftware.code-spell-checker-spanish", searchCount: 5 },
    ehSearchProviderE2e: readyEhSearchProviderE2e(),
    ehProfileContentHandlerE2e: readyEhProfileContentHandlerE2e(),
  })

  assert.equal(report.ready, true)
  assert.equal(report.summary.failed, 0)
  assert.equal(report.evidence.migrationSmokeReady, true)
  assert.equal(report.evidence.securitySmokeReady, true)
  assert.equal(report.evidence.ehMarketplaceE2eReady, true)
  assert.equal(report.evidence.ehSearchProviderE2eReady, true)
  assert.equal(report.evidence.ehProfileContentHandlerE2eReady, true)
  assert.equal(report.evidence.marketplaceInstallMatrixReady, true)
})

test("extension enterprise gate blocks when marketplace or compatibility evidence is missing", () => {
  const report = buildExtensionEnterpriseGate({
    baseline: { ready: false, extensionInventory: { total: 90 }, marketplaceSamples: [] },
    ecosystem: null,
    compatibility: { ready: false, summary: { blocked: 2, degraded: 10, total: 90 } },
  })

  assert.equal(report.ready, false)
  assert.equal(report.status, "blocked")
  assert.equal(report.checks.some((check) => check.id === "marketplace_catalog" && check.status === "failed"), true)
  assert.equal(report.checks.some((check) => check.id === "migration_smoke" && check.status === "failed"), true)
  assert.equal(report.checks.some((check) => check.id === "security_smoke" && check.status === "failed"), true)
  assert.equal(report.checks.some((check) => check.id === "eh_marketplace_e2e" && check.status === "failed"), true)
  assert.equal(report.checks.some((check) => check.id === "eh_search_provider_e2e" && check.status === "failed"), true)
  assert.equal(report.checks.some((check) => check.id === "eh_profile_content_handler_e2e" && check.status === "failed"), true)
  assert.equal(report.checks.some((check) => check.id === "marketplace_install_matrix" && check.status === "failed"), true)
  assert.equal(report.checks.some((check) => check.id === "compatibility_blockers" && check.status === "failed"), true)
})

test("extension enterprise gate rejects SearchProvider E2E fallback or provider errors", () => {
  const ready = readyEhSearchProviderE2e()

  assert.equal(ehSearchProviderReady(ready), true)
  assert.equal(ehSearchProviderReady({ ...ready, fallbackBypassed: false }), false)
  assert.equal(ehSearchProviderReady({ ...ready, providerErrors: [{ error: "fq.folder.with is not a function" }] }), false)
})

test("extension enterprise gate rejects ProfileContentHandler E2E cleanup or provider errors", () => {
  const ready = readyEhProfileContentHandlerE2e()

  assert.equal(ehProfileContentHandlerReady(ready), true)
  assert.equal(ehProfileContentHandlerReady({ ...ready, cleanupAfterStop: false }), false)
  assert.equal(ehProfileContentHandlerReady({ ...ready, providerErrors: [{ error: "handler save failed" }] }), false)
})

test("extension enterprise gate rejects a small marketplace install matrix smoke as release evidence", () => {
  const report = buildExtensionEnterpriseGate({
    baseline: {
      ready: true,
      extensionInventory: { total: 99 },
      marketplaceSamples: [{ count: 5 }],
      capabilities: {
        marketplaceDetails: true,
        marketplaceDetailsPayload: true,
        marketplaceReadme: true,
        marketplaceVersions: true,
        installPlan: true,
        compatibilityReport: true,
        installState: true,
        auditLog: true,
        rollback: true,
      },
    },
    ecosystem: { ready: true },
    compatibility: { ready: true, summary: { blocked: 0, degraded: 0, total: 99 } },
    marketplaceSmoke: { ready: true, status: "ready", summary: { passed: 5, total: 5, failed: 0 } },
    installSmoke: { ready: true, status: "degraded", summary: { passed: 5, warning: 1, total: 6, failed: 0 } },
    marketplaceInstallMatrix: {
      ready: true,
      status: "ready",
      summary: { top: 3, metadataUsable: 3, installChainComplete: 3, activationPreflightReady: 3 },
      installation: { isolated: true },
    },
    compatibilityMatrix: { ready: true, status: "degraded", summary: { sampled: 100, top: 100, blocked: 0, degraded: 20 } },
    migrationSmoke: { ready: true, status: "ready", summary: { passed: 4, total: 4, failed: 0 } },
    securitySmoke: { ready: true, status: "ready", summary: { passed: 4, total: 4, failed: 0 } },
    ehMarketplaceE2e: { ready: true, status: "ready", phase: "done", extensionId: "streetsidesoftware.code-spell-checker-spanish", searchCount: 5 },
    ehSearchProviderE2e: readyEhSearchProviderE2e(),
    ehProfileContentHandlerE2e: readyEhProfileContentHandlerE2e(),
  })

  assert.equal(report.ready, false)
  assert.equal(report.checks.some((check) => check.id === "marketplace_install_matrix" && check.status === "failed"), true)
})

test("extension enterprise gate saves latest json and markdown reports", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-gate-"))
  const report = buildExtensionEnterpriseGate({
    baseline: { ready: true, extensionInventory: { total: 99 }, marketplaceSamples: [{ count: 1 }], capabilities: {} },
    ecosystem: { ready: true, compatibilityMatrix: { summary: { sampledExtensions: 1 } } },
    compatibility: { ready: true, summary: { blocked: 0, degraded: 0, total: 99 } },
  })
  const saved = saveExtensionEnterpriseGate(report, { reportDir })
  const latest = readLatestExtensionEnterpriseGate({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.reportKind, "extension-enterprise-gate")
})
