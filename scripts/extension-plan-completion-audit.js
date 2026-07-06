#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")
const { handleReadOnlyCliFlags } = require("./evidence-cli-utils")

const root = path.resolve(__dirname, "..")

const HELP_CONFIG = {
  scriptName: "extension-plan-completion-audit.js",
  description: "Audit extension plan completion from source files and existing reports.",
  options: [
    "  --root=<path>  Repository root to inspect.",
    "  --report-dir=<path>  Read existing evidence from this reports directory.",
    "  --gate-in-progress  Classify current gate output as in progress.",
    "  --no-write  Print the audit without writing latest or timestamped artifacts.",
  ],
}

const CLI_SPEC = {
  flags: ["--gate-in-progress", "--no-write"],
  valueOptions: ["--root=", "--report-dir="],
}

const readOnlyExitCode = require.main === module
  ? handleReadOnlyCliFlags(process.argv.slice(2), HELP_CONFIG, CLI_SPEC)
  : null
if (readOnlyExitCode !== null) process.exit(readOnlyExitCode)

const REQUIRED_CODE_FILES = [
  "desktop/services/extensions-host/marketplaceRegistry.js",
  "desktop/services/extensions-host/extensionDetails.js",
  "desktop/services/extensions-host/extensionInstallPlan.js",
  "desktop/services/extensions-host/extensionInstallState.js",
  "desktop/services/extensions-host/extensionCompatibility.js",
  "desktop/services/extensions-host/extensionAuditLog.js",
  "frontend/vite-project/src/components/ExtensionDetails.vue",
  "frontend/vite-project/src/components/ExtensionMigrationPanel.vue",
  "scripts/extension-marketplace-smoke.js",
  "scripts/extension-install-smoke.js",
  "scripts/extension-marketplace-install-matrix.js",
  "scripts/extension-migration-smoke.js",
  "scripts/extension-security-smoke.js",
  "scripts/extension-compatibility-matrix.js",
  "scripts/extension-enterprise-gate.js",
  "scripts/eh-e2e.js",
  "scripts/installed-mcp-discovery-smoke.js",
  "scripts/mcp-gallery-management-smoke.js",
]

const REQUIRED_REPORTS = [
  {
    id: "extension_baseline",
    fileName: "extension-baseline-latest.json",
    title: "Extension baseline report",
    verify: (report) => report?.ready === true && Number(report?.extensionInventory?.total || 0) >= 90,
  },
  {
    id: "extension_ecosystem_health",
    fileName: "extension-ecosystem-health-latest.json",
    title: "Extension ecosystem health",
    verify: (report) => report?.ready === true,
  },
  {
    id: "extension_marketplace_smoke",
    fileName: "extension-marketplace-smoke-latest.json",
    title: "Marketplace smoke",
    verify: (report) => report?.ready === true && Number(report?.summary?.failed || 0) === 0,
  },
  {
    id: "extension_install_smoke",
    fileName: "extension-install-smoke-latest.json",
    title: "Install lifecycle smoke",
    verify: (report) => report?.ready === true && Number(report?.summary?.failed || 0) === 0,
  },
  {
    id: "extension_marketplace_install_matrix",
    fileName: "extension-marketplace-install-matrix-latest.json",
    title: "Marketplace install matrix",
    verify: (report) => report?.ready === true
      && Number(report?.summary?.top || 0) >= 100
      && Number(report?.summary?.metadataUsable || 0) >= 95
      && Number(report?.summary?.installChainComplete || 0) >= 90
      && Number(report?.summary?.activationPreflightReady || 0) >= 40
      && report?.installation?.isolated === true,
  },
  {
    id: "extension_migration_smoke",
    fileName: "extension-migration-smoke-latest.json",
    title: "VS Code/Cursor migration smoke",
    verify: (report) => report?.ready === true
      && report?.dryRun === true
      && Number(report?.evidence?.queue?.installed || 0) === 0
      && String(report?.evidence?.queue?.installPolicy || "") === "user-confirmed",
  },
  {
    id: "extension_security_smoke",
    fileName: "extension-security-smoke-latest.json",
    title: "Extension security smoke",
    verify: (report) => report?.ready === true
      && hasPassedCheck(report, "restricted_workspace_blocks_install")
      && hasPassedCheck(report, "unknown_workspace_requires_confirmation")
      && hasPassedCheck(report, "publisher_deny_policy")
      && hasPassedCheck(report, "audit_log_redacts_secrets"),
  },
  {
    id: "extension_compatibility_matrix",
    fileName: "extension-compatibility-matrix-latest.json",
    title: "Top N compatibility matrix",
    verify: (report) => report?.ready === true
      && Number(report?.summary?.top || 0) >= 100
      && Number(report?.summary?.blocked || 0) === 0,
  },
  {
    id: "eh_marketplace_e2e",
    fileName: "eh-e2e-marketplace-latest.json",
    title: "Extension host marketplace E2E",
    verify: (report) => report?.ready === true
      && report?.phase === "done"
      && Boolean(report?.extensionId)
      && Number(report?.searchCount || 0) > 0,
  },
  {
    id: "eh_memento_storage_e2e",
    fileName: "eh-e2e-memento-storage-latest.json",
    title: "Extension host memento storage E2E",
    verify: (report) => report?.ready === true
      && report?.globalStateStored === true
      && report?.workspaceStateStored === true
      && report?.syncKeysStored === true
      && report?.thirdPartyExtensionScanned === true
      && report?.thirdPartyExtensionBuiltinFalse === true
      && report?.thirdPartyInstalledMarkerPresent === true
      && report?.thirdPartyGlobalStateStored === true
      && report?.thirdPartyWorkspaceStateStored === true
      && report?.thirdPartySyncKeysStored === true
      && report?.legacyStorageWritten === false,
  },
  {
    id: "eh_extension_context_e2e",
    fileName: "eh-e2e-extension-context-latest.json",
    title: "Extension host ExtensionContext E2E",
    verify: (report) => report?.ready === true
      && report?.thirdPartyExtensionScanned === true
      && report?.thirdPartyExtensionBuiltinFalse === true
      && report?.thirdPartyInstalledMarkerPresent === true
      && report?.packageJsonPreserved === true
      && report?.extensionUriFile === true
      && report?.extensionPathMatches === true
      && report?.asAbsolutePathWorks === true
      && report?.storageUriFile === true
      && report?.globalStorageUriFile === true
      && report?.logUriFile === true,
  },
  {
    id: "eh_implicit_activation_e2e",
    fileName: "eh-e2e-implicit-activation-latest.json",
    title: "Extension host implicit activation E2E",
    verify: (report) => report?.ready === true
      && report?.thirdPartyExtensionScanned === true
      && report?.thirdPartyExtensionBuiltinFalse === true
      && report?.thirdPartyInstalledMarkerPresent === true
      && report?.manifestHasExplicitActivationEvents === false
      && report?.implicitOnCommandGenerated === true
      && report?.activationEventsByEventHasExtension === true
      && report?.activatedByImplicitEvent === true
      && report?.commandContributionPreserved === true,
  },
  {
    id: "eh_dependency_loop_e2e",
    fileName: "eh-e2e-dependency-loop-latest.json",
    title: "Extension host dependency loop E2E",
    verify: (report) => report?.ready === true
      && Array.isArray(report?.removedDueToLooping)
      && report.removedDueToLooping.includes("codek.loop-a")
      && report.removedDueToLooping.includes("codek.loop-b")
      && report?.loopExtensionsAbsentFromAllExtensions === true
      && report?.loopExtensionsAbsentFromById === true
      && report?.loopActivationEventsAbsent === true
      && report?.loopActivationEventsByEventAbsent === true
      && report?.initDataLoopExtensionsAbsent === true
      && report?.initDataMyExtensionsLoopAbsent === true
      && report?.healthyExtensionScanned === true
      && report?.healthyActivationEventIndexed === true
      && report?.healthyExtensionInInitData === true
      && report?.healthyActivated === true,
  },
  {
    id: "eh_search_provider_e2e",
    fileName: "eh-e2e-search-provider-latest.json",
    title: "Extension host SearchProvider E2E",
    verify: (report) => report?.ready === true
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
      && report.providerErrors.length === 0,
  },
  {
    id: "eh_profile_content_handler_e2e",
    fileName: "eh-e2e-profile-content-handler-latest.json",
    title: "Extension host ProfileContentHandler E2E",
    verify: (report) => report?.ready === true
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
      && report.providerErrors.length === 0,
  },
  {
    id: "installed_mcp_discovery_smoke",
    fileName: "installed-mcp-discovery-latest.json",
    title: "Installed MCP discovery smoke",
    verify: (report) => report?.ready === true
      && report?.installedMcpPersisted === true
      && report?.installedDiscoveryRead === true
      && report?.installedRegistryApplied === true
      && report?.workspaceDiscoveryFilteredInRegistryMode === true
      && report?.secretRedactionVerified === true
      && Array.isArray(report?.providerErrors)
      && report.providerErrors.length === 0,
  },
  {
    id: "mcp_gallery_management_smoke",
    fileName: "mcp-gallery-management-latest.json",
    title: "MCP Gallery management smoke",
    verify: (report) => report?.ready === true
      && report?.galleryInstallReady === true
      && report?.workspaceResourceWritten === true
      && report?.workspaceRegistryConsumed === true
      && report?.workbenchRegistryRouteReady === true
      && report?.galleryUninstallReady === true
      && report?.lifecycleEventsEmitted === true
      && Array.isArray(report?.providerErrors)
      && report.providerErrors.length === 0,
  },
  {
    id: "eh_mcp_provider_bridge",
    fileName: "eh-e2e-mcp-provider-latest.json",
    title: "Extension host MCP provider bridge",
    verify: (report) => report?.ready === true
      && report?.mainThreadMcpRegistered === true
      && report?.definitionsPublishedToExtHost === true
      && report?.delegateTransportStarted === true
      && report?.secretRedactionVerified === true
      && report?.deletePublishesEmptyDefinitions === true
      && Array.isArray(report?.providerErrors)
      && report.providerErrors.length === 0,
  },
  {
    id: "extension_enterprise_gate",
    fileName: "extension-enterprise-gate-latest.json",
    title: "Extension enterprise gate",
    verify: (report) => report?.ready === true
      && Number(report?.summary?.failed || 0) === 0
      && Array.isArray(report?.gaps)
      && report.gaps.length === 0,
  },
  {
    id: "bd_enterprise_candidate_gate",
    fileName: "bd-enterprise-candidate-latest.json",
    title: "BD enterprise candidate gate",
    verify: (report) => report?.ready === true
      && Array.isArray(report?.missingSteps)
      && report.missingSteps.length === 0
      && stepPassed(report, "extension_migration_smoke")
      && stepPassed(report, "extension_security_smoke")
      && stepPassed(report, "eh_memento_storage_e2e")
      && stepPassed(report, "eh_extension_context_e2e")
      && stepPassed(report, "eh_implicit_activation_e2e")
      && stepPassed(report, "eh_dependency_loop_e2e")
      && stepPassed(report, "eh_search_provider_e2e")
      && stepPassed(report, "eh_profile_content_handler_e2e")
      && stepPassed(report, "installed_mcp_discovery_smoke")
      && stepPassed(report, "mcp_gallery_management_smoke")
      && stepPassed(report, "release_evidence_export"),
  },
]

function parseArgs(argv = []) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const rootArg = argv.find((arg) => arg.startsWith("--root="))
  return {
    gateInProgress: argv.includes("--gate-in-progress"),
    noWrite: argv.includes("--no-write"),
    rootDir: rootArg ? rootArg.slice("--root=".length) : root,
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : path.join(root, ".codek", "reports"),
  }
}

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function readJson(jsonPath) {
  try {
    return JSON.parse(fs.readFileSync(jsonPath, "utf8"))
  } catch {
    return null
  }
}

function hasPassedCheck(report, id) {
  return Array.isArray(report?.checks) && report.checks.some((check) => check?.id === id && (check.status === "passed" || check.passed === true))
}

function stepPassed(report, id) {
  return Array.isArray(report?.steps) && report.steps.some((step) => step?.id === id && step.passed === true)
}

function requirement(id, title, source, status, evidence = {}) {
  return { id, title, source, status, evidence }
}

function section13Requirements(rootDir, reportDir) {
  const codeRequirements = REQUIRED_CODE_FILES.map((filePath) => {
    const absolutePath = path.join(rootDir, filePath)
    return requirement(
      `code:${filePath}`,
      `${filePath} exists`,
      filePath,
      fs.existsSync(absolutePath) ? "passed" : "missing",
      { absolutePath },
    )
  })
  const reportRequirements = REQUIRED_REPORTS.map((item) => {
    const jsonPath = path.join(reportDir, item.fileName)
    const report = readJson(jsonPath)
    return requirement(
      item.id,
      item.title,
      item.fileName,
      item.verify(report) ? "passed" : "missing",
      {
        jsonPath,
        available: Boolean(report),
        ready: report?.ready === true,
        status: report?.status || "",
        summary: report?.summary || null,
      },
    )
  })
  return [...codeRequirements, ...reportRequirements]
}

function releaseEvidenceRequirement(reportDir) {
  const jsonPath = path.join(reportDir, "release-evidence-latest.json")
  const report = readJson(jsonPath)
  const evidence = report?.evidence || {}
  const requiredKeys = [
    "extensionMarketplaceSmoke",
    "extensionInstallSmoke",
    "extensionMarketplaceInstallMatrix",
    "extensionMigrationSmoke",
    "extensionSecuritySmoke",
    "ehMarketplaceE2e",
    "ehMementoStorageE2e",
    "ehExtensionContextE2e",
    "ehImplicitActivationE2e",
    "ehDependencyLoopE2e",
    "ehSearchProviderE2e",
    "ehProfileContentHandlerE2e",
    "ehMcpProviderBridge",
    "mcpGalleryManagement",
    "extensionCompatibilityMatrix",
    "extensionEnterpriseGate",
  ]
  const missingKeys = requiredKeys.filter((key) => !evidence[key])
  const notReadyKeys = requiredKeys.filter((key) => evidence[key] && evidence[key].ready !== true)
  const extensionEvidenceReady = Boolean(report) && missingKeys.length === 0 && notReadyKeys.length === 0
  return requirement(
    "release_evidence_extension_summary",
    "release-evidence-latest.json contains ready extension ecosystem summary",
    "release-evidence-latest.json",
    extensionEvidenceReady ? "passed" : "missing",
    {
      jsonPath,
      available: Boolean(report),
      ready: report?.ready === true,
      enterpriseComplete: report?.summary?.enterpriseComplete === true,
      baseReady: report?.summary?.baseReady === true,
      missingKeys,
      notReadyKeys,
      gaps: Array.isArray(report?.gaps) ? report.gaps.map((gap) => gap.id) : [],
    },
  )
}

function gateInProgressRequirement(id, title, source) {
  return requirement(
    id,
    title,
    source,
    "passed",
    {
      gateInProgress: true,
      deferredUntilFinalGateReport: true,
    },
  )
}

function docsAndRunbookRequirements(rootDir) {
  const runbookPath = path.join(rootDir, "docs", "RELEASE_RUNBOOK.md")
  const readmePath = path.join(rootDir, "README.md")
  const runbook = fs.existsSync(runbookPath) ? fs.readFileSync(runbookPath, "utf8") : ""
  const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : ""
  const overclaimPattern = /完全兼容所有\s*VS Code\s*扩展|100%\s*兼容所有\s*VS Code/i
  return [
    requirement(
      "release_runbook_extension_steps",
      "Release runbook documents extension ecosystem release steps",
      "docs/RELEASE_RUNBOOK.md",
      /extension|扩展/i.test(runbook) && /release-evidence|发布证据|gate|门禁/i.test(runbook) ? "passed" : "missing",
      { absolutePath: runbookPath, available: Boolean(runbook) },
    ),
    requirement(
      "readme_no_extension_overclaim",
      "README does not overclaim full VS Code extension compatibility",
      "README.md",
      readme && !overclaimPattern.test(readme) ? "passed" : "missing",
      { absolutePath: readmePath, available: Boolean(readme) },
    ),
  ]
}

function finalManualRequirement(reportDir) {
  const jsonPath = path.join(reportDir, "manual-real-ui-evidence-latest.json")
  const report = readJson(jsonPath)
  const ready = report?.ready === true
    && report?.manualRunConfirmed === true
    && report?.cursorLevelSmoothnessConfirmed === true
    && report?.windowsExplorerCrossCheckConfirmed === true
  return requirement(
    "manual_real_ui_evidence",
    "Final real UI manual review confirms Cursor-level smoothness and Windows Explorer cross-check",
    "manual-real-ui-evidence-latest.json",
    ready ? "passed" : "manual_required",
    {
      jsonPath,
      available: Boolean(report),
      manualRunConfirmed: report?.manualRunConfirmed === true,
      cursorLevelSmoothnessConfirmed: report?.cursorLevelSmoothnessConfirmed === true,
      windowsExplorerCrossCheckConfirmed: report?.windowsExplorerCrossCheckConfirmed === true,
      summary: report?.summary || null,
    },
  )
}

function buildExtensionPlanCompletionAudit(options = {}) {
  const rootDir = path.resolve(options.rootDir || root)
  const reportDir = path.resolve(options.reportDir || defaultReportDir())
  const gateInProgress = options.gateInProgress === true
  const section13 = section13Requirements(rootDir, reportDir).map((item) => {
    if (gateInProgress && item.id === "bd_enterprise_candidate_gate") {
      return gateInProgressRequirement(
        "bd_enterprise_candidate_gate",
        "BD enterprise candidate gate is running; final latest report is deferred until gate completion",
        "bd-enterprise-candidate-latest.json",
      )
    }
    return item
  })
  const requirements = [
    ...section13,
    gateInProgress
      ? gateInProgressRequirement(
        "release_evidence_extension_summary",
        "Release evidence export is deferred until BD gate reaches the release evidence step",
        "release-evidence-latest.json",
      )
      : releaseEvidenceRequirement(reportDir),
    ...docsAndRunbookRequirements(rootDir),
    finalManualRequirement(reportDir),
  ]
  const missing = requirements.filter((item) => item.status === "missing")
  const manualRequired = requirements.filter((item) => item.status === "manual_required")
  const passed = requirements.filter((item) => item.status === "passed")
  return {
    reportKind: "extension-plan-completion-audit",
    createdAt: Number(options.createdAt || Date.now()),
    planPath: path.join(rootDir, "docs", "VS_CODE_SOURCE_MIGRATION_MATRIX.md"),
    ready: missing.length === 0,
    enterpriseComplete: missing.length === 0 && manualRequired.length === 0,
    status: missing.length > 0 ? "blocked" : manualRequired.length > 0 ? "ready-with-manual-evidence-required" : "complete",
    summary: {
      total: requirements.length,
      passed: passed.length,
      missing: missing.length,
      manualRequired: manualRequired.length,
    },
    requirements,
    nextActions: [
      ...missing.slice(0, 8).map((item) => ({
        id: item.id,
        action: `Complete missing evidence for ${item.source}.`,
      })),
      ...manualRequired.map((item) => ({
        id: item.id,
        action: "Complete the real Codek UI manual review and import manual-real-ui evidence.",
      })),
    ],
  }
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function formatStatus(status) {
  if (status === "passed") return "通过"
  if (status === "manual_required") return "需要人工证据"
  return "缺失"
}

function toMarkdown(report) {
  const rows = report.requirements.map((item) =>
    `| ${escapeCell(item.id)} | ${formatStatus(item.status)} | ${escapeCell(item.source)} | ${escapeCell(item.title)} |`,
  )
  return [
    "# Extension Plan Completion Audit",
    "",
    `- Ready: ${report.ready}`,
    `- Enterprise complete: ${report.enterpriseComplete}`,
    `- Status: ${report.status}`,
    `- Passed: ${report.summary.passed}/${report.summary.total}`,
    `- Missing: ${report.summary.missing}`,
    `- Manual required: ${report.summary.manualRequired}`,
    "",
    "| Requirement | Status | Evidence source | Title |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n")
}

function saveExtensionPlanCompletionAudit(report, options = {}) {
  const reportDir = path.resolve(options.reportDir || defaultReportDir())
  fs.mkdirSync(reportDir, { recursive: true })
  const stamp = new Date(report.createdAt).toISOString().replace(/[:.]/g, "-")
  const latestJsonPath = path.join(reportDir, "extension-plan-completion-audit-latest.json")
  const latestMarkdownPath = path.join(reportDir, "extension-plan-completion-audit-latest.md")
  const jsonPath = path.join(reportDir, `extension-plan-completion-audit-${stamp}.json`)
  const markdownPath = path.join(reportDir, `extension-plan-completion-audit-${stamp}.md`)
  const normalized = { ...report, jsonPath, markdownPath, latestJsonPath, latestMarkdownPath }
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  fs.writeFileSync(jsonPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestMarkdownPath, `${toMarkdown(normalized)}\n`, "utf8")
  fs.writeFileSync(markdownPath, `${toMarkdown(normalized)}\n`, "utf8")
  return normalized
}

function readLatestExtensionPlanCompletionAudit(options = {}) {
  const reportDir = path.resolve(options.reportDir || defaultReportDir())
  const jsonPath = path.join(reportDir, "extension-plan-completion-audit-latest.json")
  return { report: readJson(jsonPath), jsonPath }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = buildExtensionPlanCompletionAudit(options)
  const output = options.noWrite ? report : saveExtensionPlanCompletionAudit(report, { reportDir: options.reportDir })
  process.stdout.write(`${JSON.stringify({
    reportKind: output.reportKind,
    ready: output.ready,
    enterpriseComplete: output.enterpriseComplete,
    status: output.status,
    summary: output.summary,
    missing: output.requirements.filter((item) => item.status === "missing").map((item) => item.id),
    manualRequired: output.requirements.filter((item) => item.status === "manual_required").map((item) => item.id),
    jsonPath: output.latestJsonPath || "",
    markdownPath: output.latestMarkdownPath || "",
  }, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`)
    process.exit(1)
  })
}

module.exports = {
  REQUIRED_CODE_FILES,
  REQUIRED_REPORTS,
  buildExtensionPlanCompletionAudit,
  defaultReportDir,
  parseArgs,
  readLatestExtensionPlanCompletionAudit,
  saveExtensionPlanCompletionAudit,
  toMarkdown,
}
