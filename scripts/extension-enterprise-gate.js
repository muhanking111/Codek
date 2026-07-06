#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const { readLatestExtensionEcosystemHealth } = require("../desktop/services/extensions-host/ecosystemHealth")
const { readLatestExtensionCompatibilityReport } = require("../desktop/services/extensions-host/extensionCompatibility")
const { readLatestExtensionBaseline } = require("./extension-baseline")
const { readLatestMarketplaceSmoke } = require("./extension-marketplace-smoke")
const { readLatestInstallSmoke } = require("./extension-install-smoke")
const { readLatestMarketplaceInstallMatrix } = require("./extension-marketplace-install-matrix")
const { readLatestCompatibilityMatrix } = require("./extension-compatibility-matrix")
const { readLatestMigrationSmoke } = require("./extension-migration-smoke")
const { readLatestSecuritySmoke } = require("./extension-security-smoke")

function readLatestJsonReport(reportDir, fileName) {
  const jsonPath = path.join(reportDir || defaultReportDir(), fileName)
  if (!fs.existsSync(jsonPath)) return { report: null, jsonPath }
  return { report: JSON.parse(fs.readFileSync(jsonPath, "utf8")), jsonPath }
}

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function parseArgs(argv = []) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  return {
    noWrite: argv.includes("--no-write"),
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
  }
}

function makeCheck(id, title, status, detail, nextAction = "") {
  return { id, title, status, detail, nextAction }
}

function summarizeChecks(checks) {
  return {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    warning: checks.filter((check) => check.status === "warning").length,
    failed: checks.filter((check) => check.status === "failed").length,
  }
}

function marketplaceInstallMatrixReady(report) {
  return report?.ready === true
    && Number(report?.summary?.top || 0) >= 100
    && Number(report?.summary?.metadataUsable || 0) >= 95
    && Number(report?.summary?.installChainComplete || 0) >= 90
    && Number(report?.summary?.activationPreflightReady || 0) >= 40
    && report?.installation?.isolated === true
}

function ehSearchProviderReady(report) {
  return report?.ready === true
    && report?.thirdPartyExtensionScanned === true
    && report?.thirdPartyExtensionBuiltinFalse === true
    && report?.thirdPartyInstalledMarkerPresent === true
    && report?.activationEventsByEventHasExtension === true
    && report?.enabledApiProposalsPresent === true
    && report?.textProviderRegistered === true
    && report?.fileProviderRegistered === true
    && report?.activatedByOnSearchFile === true
    && report?.textProviderCalled === true
    && report?.fileProviderCalled === true
    && report?.textSearchEngine === "extension-search"
    && report?.textSearchProvider === "extension-host"
    && report?.fileSearchEngine === "extension-search"
    && report?.fallbackBypassed === true
    && Array.isArray(report?.providerErrors)
    && report.providerErrors.length === 0
}

function ehProfileContentHandlerReady(report) {
  return report?.ready === true
    && report?.thirdPartyExtensionScanned === true
    && report?.thirdPartyExtensionBuiltinFalse === true
    && report?.thirdPartyInstalledMarkerPresent === true
    && report?.activationEventsByEventHasExtension === true
    && report?.enabledApiProposalsPresent === true
    && report?.activatedByOnProfileHandler === true
    && report?.handlerRegistered === true
    && report?.handlerMetadataMatched === true
    && report?.readProfileCalled === true
    && report?.readProfileReturnedTemplate === true
    && report?.saveProfileCalled === true
    && report?.saveProfileReturnedResult === true
    && report?.cleanupAfterStop === true
    && Array.isArray(report?.providerErrors)
    && report.providerErrors.length === 0
}

function buildExtensionEnterpriseGate(input = {}) {
  const baseline = input.baseline || null
  const ecosystem = input.ecosystem || null
  const compatibility = input.compatibility || null
  const marketplaceSmoke = input.marketplaceSmoke || null
  const installSmoke = input.installSmoke || null
  const marketplaceInstallMatrix = input.marketplaceInstallMatrix || null
  const compatibilityMatrix = input.compatibilityMatrix || null
  const migrationSmoke = input.migrationSmoke || null
  const securitySmoke = input.securitySmoke || null
  const ehMarketplaceE2e = input.ehMarketplaceE2e || null
  const ehSearchProviderE2e = input.ehSearchProviderE2e || null
  const ehProfileContentHandlerE2e = input.ehProfileContentHandlerE2e || null
  const capabilities = baseline?.capabilities || {}
  const capabilityKeys = [
    "marketplaceDetails",
    "marketplaceDetailsPayload",
    "marketplaceReadme",
    "marketplaceVersions",
    "installPlan",
    "compatibilityReport",
    "installState",
    "auditLog",
    "rollback",
  ]
  const missingCapabilities = capabilityKeys.filter((key) => capabilities[key] !== true)
  const marketplaceSampleCount = (baseline?.marketplaceSamples || []).reduce((total, sample) => total + Number(sample.count || 0), 0)
  const checks = [
    makeCheck(
      "baseline_report",
      "Extension baseline report",
      baseline?.ready ? "passed" : "failed",
      baseline ? `Baseline status is ${baseline.status || "unknown"}.` : "Missing extension baseline report.",
      "Run node scripts/extension-baseline.js before enterprise release.",
    ),
    makeCheck(
      "marketplace_catalog",
      "Marketplace catalog evidence",
      marketplaceSampleCount > 0 ? "passed" : "failed",
      marketplaceSampleCount > 0
        ? `Marketplace samples returned ${marketplaceSampleCount} total extension results.`
        : "No marketplace samples are available.",
      "Verify Open VSX or enterprise registry connectivity.",
    ),
    makeCheck(
      "marketplace_capability_surface",
      "Marketplace capability surface",
      missingCapabilities.length === 0 ? "passed" : "failed",
      missingCapabilities.length === 0
        ? "Details, README, versions, install plan, and compatibility report APIs are present."
        : `Missing capabilities: ${missingCapabilities.join(", ")}.`,
      "Wire missing backend endpoints before exposing Cursor-level extension UX.",
    ),
    makeCheck(
      "marketplace_smoke",
      "Marketplace smoke",
      marketplaceSmoke?.ready ? "passed" : "failed",
      marketplaceSmoke
        ? `Marketplace smoke status is ${marketplaceSmoke.status || "unknown"} with ${marketplaceSmoke.summary?.passed || 0}/${marketplaceSmoke.summary?.total || 0} checks passed.`
        : "Missing marketplace smoke report.",
      "Run node scripts/extension-marketplace-smoke.js --report-dir=.codek/reports.",
    ),
    makeCheck(
      "install_lifecycle_smoke",
      "Install lifecycle smoke",
      installSmoke?.ready ? "passed" : "failed",
      installSmoke
        ? `Install smoke status is ${installSmoke.status || "unknown"} with ${installSmoke.summary?.passed || 0}/${installSmoke.summary?.total || 0} checks passed.`
        : "Missing install smoke report.",
      "Run node scripts/extension-install-smoke.js --report-dir=.codek/reports.",
    ),
    makeCheck(
      "marketplace_install_matrix",
      "Marketplace install matrix",
      marketplaceInstallMatrixReady(marketplaceInstallMatrix) ? "passed" : "failed",
      marketplaceInstallMatrix
        ? `Install matrix status is ${marketplaceInstallMatrix.status || "unknown"}; metadata ${Number(marketplaceInstallMatrix.summary?.metadataUsable || 0)}, install-chain ${Number(marketplaceInstallMatrix.summary?.installChainComplete || 0)}, activation preflight ${Number(marketplaceInstallMatrix.summary?.activationPreflightReady || 0)}.`
        : "Missing marketplace install matrix report.",
      "Run node scripts/extension-marketplace-install-matrix.js --top=100 --report-dir=.codek/reports.",
    ),
    makeCheck(
      "migration_smoke",
      "VS Code/Cursor migration smoke",
      migrationSmoke?.ready ? "passed" : "failed",
      migrationSmoke
        ? `Migration smoke status is ${migrationSmoke.status || "unknown"} with ${migrationSmoke.summary?.passed || 0}/${migrationSmoke.summary?.total || 0} checks passed.`
        : "Missing migration smoke report.",
      "Run node scripts/extension-migration-smoke.js --source=cursor --dry-run --report-dir=.codek/reports.",
    ),
    makeCheck(
      "security_smoke",
      "Extension security smoke",
      securitySmoke?.ready ? "passed" : "failed",
      securitySmoke
        ? `Security smoke status is ${securitySmoke.status || "unknown"} with ${securitySmoke.summary?.passed || 0}/${securitySmoke.summary?.total || 0} checks passed.`
        : "Missing extension security smoke report.",
      "Run node scripts/extension-security-smoke.js --report-dir=.codek/reports.",
    ),
    makeCheck(
      "eh_marketplace_e2e",
      "Extension host marketplace E2E",
      ehMarketplaceE2e?.ready ? "passed" : "failed",
      ehMarketplaceE2e
        ? `EH marketplace E2E status is ${ehMarketplaceE2e.status || "unknown"} at phase ${ehMarketplaceE2e.phase || "unknown"} for ${ehMarketplaceE2e.extensionId || "unknown"}.`
        : "Missing EH marketplace E2E report.",
      "Run npm run eh:e2e:marketplace -- --report-dir=.codek/reports.",
    ),
    makeCheck(
      "eh_search_provider_e2e",
      "Extension host SearchProvider E2E",
      ehSearchProviderReady(ehSearchProviderE2e) ? "passed" : "failed",
      ehSearchProviderE2e
        ? `EH SearchProvider E2E status is ${ehSearchProviderE2e.status || "unknown"} for ${ehSearchProviderE2e.extensionId || "unknown"}; text ${ehSearchProviderE2e.textSearchEngine || "missing"}/${ehSearchProviderE2e.textSearchProvider || "missing"}, file ${ehSearchProviderE2e.fileSearchEngine || "missing"}, fallback ${ehSearchProviderE2e.fallbackBypassed === true ? "bypassed" : "used"}, provider errors ${Array.isArray(ehSearchProviderE2e.providerErrors) ? ehSearchProviderE2e.providerErrors.length : "unknown"}.`
        : "Missing EH SearchProvider E2E report.",
      "Run node scripts/eh-e2e.js --search-provider --report-dir=.codek/reports.",
    ),
    makeCheck(
      "eh_profile_content_handler_e2e",
      "Extension host ProfileContentHandler E2E",
      ehProfileContentHandlerReady(ehProfileContentHandlerE2e) ? "passed" : "failed",
        ehProfileContentHandlerE2e
          ? `EH ProfileContentHandler E2E status is ${ehProfileContentHandlerE2e.status || "unknown"} for ${ehProfileContentHandlerE2e.extensionId || "unknown"}; activation ${ehProfileContentHandlerE2e.activationEvent || "missing"} ${ehProfileContentHandlerE2e.activatedByOnProfileHandler === true ? "ok" : "missing"}, handler ${ehProfileContentHandlerE2e.handlerId || "missing"}, read ${ehProfileContentHandlerE2e.readProfileCalled === true ? "called" : "missing"}, save ${ehProfileContentHandlerE2e.saveProfileCalled === true ? "called" : "missing"}, cleanup ${ehProfileContentHandlerE2e.cleanupAfterStop === true ? "ok" : "missing"}, provider errors ${Array.isArray(ehProfileContentHandlerE2e.providerErrors) ? ehProfileContentHandlerE2e.providerErrors.length : "unknown"}.`
        : "Missing EH ProfileContentHandler E2E report.",
      "Run node scripts/eh-e2e.js --profile-content-handler --report-dir=.codek/reports.",
    ),
    makeCheck(
      "ecosystem_health",
      "Extension ecosystem health",
      ecosystem?.ready ? "passed" : "failed",
      ecosystem ? `Ecosystem status is ${ecosystem.status || "unknown"}.` : "Missing extension ecosystem health report.",
      "Run node scripts/ar-health.js after marketplace and scanner changes.",
    ),
    makeCheck(
      "top_n_compatibility_matrix",
      "Top N compatibility matrix",
      compatibilityMatrix?.ready ? "passed" : "failed",
      compatibilityMatrix
        ? `Sampled ${Number(compatibilityMatrix.summary?.sampled || 0)}/${Number(compatibilityMatrix.summary?.top || 0)} extensions; ${Number(compatibilityMatrix.summary?.blocked || 0)} blocked.`
        : "Missing Top N compatibility matrix report.",
      "Run node scripts/extension-compatibility-matrix.js --top=100 --report-dir=.codek/reports.",
    ),
    makeCheck(
      "compatibility_report",
      "Installed compatibility report",
      compatibility?.ready ? "passed" : "failed",
      compatibility
        ? `Compatibility summary: ${compatibility.summary?.blocked || 0} blocked, ${compatibility.summary?.degraded || 0} degraded.`
        : "Missing installed compatibility report.",
      "Run the compatibility report and fix blocked runtime/API issues.",
    ),
    makeCheck(
      "compatibility_blockers",
      "Compatibility blockers",
      Number(compatibility?.summary?.blocked || 0) === 0 ? "passed" : "failed",
      `${Number(compatibility?.summary?.blocked || 0)} installed extensions are blocked.`,
      "Resolve runtime errors or mark blocked extensions with user-visible reasons before release.",
    ),
  ]
  const summary = summarizeChecks(checks)
  const status = summary.failed > 0 ? "blocked" : summary.warning > 0 ? "degraded" : "ready"
  return {
    reportKind: "extension-enterprise-gate",
    createdAt: Number(input.createdAt || Date.now()),
    ready: summary.failed === 0,
    status,
    summary,
    checks,
    gaps: checks.filter((check) => check.status === "failed").map((check) => ({
      id: check.id,
      title: check.title,
      detail: check.detail,
      nextAction: check.nextAction,
    })),
    evidence: {
      baselineReady: baseline?.ready === true,
      ecosystemReady: ecosystem?.ready === true,
      compatibilityReady: compatibility?.ready === true,
      marketplaceSmokeReady: marketplaceSmoke?.ready === true,
      installSmokeReady: installSmoke?.ready === true,
      marketplaceInstallMatrixReady: marketplaceInstallMatrixReady(marketplaceInstallMatrix),
      compatibilityMatrixReady: compatibilityMatrix?.ready === true,
      migrationSmokeReady: migrationSmoke?.ready === true,
      securitySmokeReady: securitySmoke?.ready === true,
      ehMarketplaceE2eReady: ehMarketplaceE2e?.ready === true,
      ehSearchProviderE2eReady: ehSearchProviderReady(ehSearchProviderE2e),
      ehProfileContentHandlerE2eReady: ehProfileContentHandlerReady(ehProfileContentHandlerE2e),
      extensionInventory: baseline?.extensionInventory || null,
      compatibilitySummary: compatibility?.summary || null,
      marketplaceSmokeSummary: marketplaceSmoke?.summary || null,
      installSmokeSummary: installSmoke?.summary || null,
      marketplaceInstallMatrixSummary: marketplaceInstallMatrix?.summary || null,
      compatibilityMatrixSummary: compatibilityMatrix?.summary || null,
      migrationSmokeSummary: migrationSmoke?.summary || null,
      securitySmokeSummary: securitySmoke?.summary || null,
      ehMarketplaceE2e: ehMarketplaceE2e ? {
        status: ehMarketplaceE2e.status || "",
        phase: ehMarketplaceE2e.phase || "",
        extensionId: ehMarketplaceE2e.extensionId || "",
        searchCount: Number(ehMarketplaceE2e.searchCount || 0),
      } : null,
      ehSearchProviderE2e: ehSearchProviderE2e ? {
        status: ehSearchProviderE2e.status || "",
        extensionId: ehSearchProviderE2e.extensionId || "",
        activationEvent: ehSearchProviderE2e.activationEvent || "",
        textSearchEngine: ehSearchProviderE2e.textSearchEngine || "",
        textSearchProvider: ehSearchProviderE2e.textSearchProvider || "",
        fileSearchEngine: ehSearchProviderE2e.fileSearchEngine || "",
        textProviderCalled: ehSearchProviderE2e.textProviderCalled === true,
        fileProviderCalled: ehSearchProviderE2e.fileProviderCalled === true,
        fallbackBypassed: ehSearchProviderE2e.fallbackBypassed === true,
        providerErrors: Array.isArray(ehSearchProviderE2e.providerErrors) ? ehSearchProviderE2e.providerErrors.length : 0,
      } : null,
      ehProfileContentHandlerE2e: ehProfileContentHandlerE2e ? {
        status: ehProfileContentHandlerE2e.status || "",
        extensionId: ehProfileContentHandlerE2e.extensionId || "",
        activationEvent: ehProfileContentHandlerE2e.activationEvent || "",
        activatedByOnProfileHandler: ehProfileContentHandlerE2e.activatedByOnProfileHandler === true,
        handlerId: ehProfileContentHandlerE2e.handlerId || "",
        handlerRegistered: ehProfileContentHandlerE2e.handlerRegistered === true,
        handlerMetadataMatched: ehProfileContentHandlerE2e.handlerMetadataMatched === true,
        readProfileCalled: ehProfileContentHandlerE2e.readProfileCalled === true,
        readProfileReturnedTemplate: ehProfileContentHandlerE2e.readProfileReturnedTemplate === true,
        saveProfileCalled: ehProfileContentHandlerE2e.saveProfileCalled === true,
        saveProfileReturnedResult: ehProfileContentHandlerE2e.saveProfileReturnedResult === true,
        cleanupAfterStop: ehProfileContentHandlerE2e.cleanupAfterStop === true,
        providerErrors: Array.isArray(ehProfileContentHandlerE2e.providerErrors) ? ehProfileContentHandlerE2e.providerErrors.length : 0,
      } : null,
    },
  }
}

function enterpriseGatePaths(reportDir = defaultReportDir()) {
  return {
    reportDir,
    latestJsonPath: path.join(reportDir, "extension-enterprise-gate-latest.json"),
    latestMarkdownPath: path.join(reportDir, "extension-enterprise-gate-latest.md"),
  }
}

function toMarkdown(report) {
  const rows = (report.checks || []).map((check) =>
    `| ${check.id} | ${check.status} | ${String(check.detail || "").replace(/\|/g, "\\|")} | ${String(check.nextAction || "").replace(/\|/g, "\\|")} |`,
  )
  return [
    "# Extension Enterprise Gate",
    "",
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Status: ${report.status}`,
    "",
    "| Check | Status | Detail | Next Action |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
}

function saveExtensionEnterpriseGate(report, options = {}) {
  const paths = enterpriseGatePaths(options.reportDir || defaultReportDir())
  fs.mkdirSync(paths.reportDir, { recursive: true })
  const withPaths = { ...report, ...paths }
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${toMarkdown(withPaths)}\n`, "utf8")
  return { ...paths, report: withPaths }
}

function readLatestExtensionEnterpriseGate(options = {}) {
  const paths = enterpriseGatePaths(options.reportDir || defaultReportDir())
  if (!fs.existsSync(paths.latestJsonPath)) return { report: null, ...paths }
  return { report: JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8")), ...paths }
}

function runExtensionEnterpriseGate(options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  const report = buildExtensionEnterpriseGate({
    baseline: readLatestExtensionBaseline({ reportDir }).report,
    ecosystem: readLatestExtensionEcosystemHealth({ reportDir }).report,
    compatibility: readLatestExtensionCompatibilityReport({ reportDir }).report,
    marketplaceSmoke: readLatestMarketplaceSmoke({ reportDir }).report,
    installSmoke: readLatestInstallSmoke({ reportDir }).report,
    marketplaceInstallMatrix: readLatestMarketplaceInstallMatrix({ reportDir }).report,
    compatibilityMatrix: readLatestCompatibilityMatrix({ reportDir }).report,
    migrationSmoke: readLatestMigrationSmoke({ reportDir }).report,
    securitySmoke: readLatestSecuritySmoke({ reportDir }).report,
    ehMarketplaceE2e: readLatestJsonReport(reportDir, "eh-e2e-marketplace-latest.json").report,
    ehSearchProviderE2e: readLatestJsonReport(reportDir, "eh-e2e-search-provider-latest.json").report,
    ehProfileContentHandlerE2e: readLatestJsonReport(reportDir, "eh-e2e-profile-content-handler-latest.json").report,
  })
  if (!options.noWrite) saveExtensionEnterpriseGate(report, { reportDir })
  return report
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = runExtensionEnterpriseGate(options)
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    gaps: report.gaps.map((gap) => gap.id),
    jsonPath: options.noWrite ? "" : enterpriseGatePaths(options.reportDir).latestJsonPath,
    markdownPath: options.noWrite ? "" : enterpriseGatePaths(options.reportDir).latestMarkdownPath,
  }, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

if (require.main === module) {
  main()
}

module.exports = {
  buildExtensionEnterpriseGate,
  defaultReportDir,
  ehProfileContentHandlerReady,
  ehSearchProviderReady,
  marketplaceInstallMatrixReady,
  enterpriseGatePaths,
  parseArgs,
  readLatestExtensionEnterpriseGate,
  runExtensionEnterpriseGate,
  saveExtensionEnterpriseGate,
  toMarkdown,
}
