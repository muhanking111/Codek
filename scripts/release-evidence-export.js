#!/usr/bin/env node

const path = require("node:path")

const { handleReadOnlyCliFlags } = require("./evidence-cli-utils")

const HELP_CONFIG = {
  scriptName: "release-evidence-export.js",
  description: "Build release evidence summary from existing reports.",
  options: [
    "  --report-dir=<path>  Read existing evidence from this reports directory.",
    "  --current-release-gate-mode=<mode>  Treat the current upstream release gate as ready.",
    "  --no-write  Print the summary without writing latest, history, or readiness artifacts.",
  ],
}

const CLI_SPEC = {
  flags: ["--no-write"],
  valueOptions: ["--report-dir=", "--current-release-gate-mode="],
}

const readOnlyExitCode = require.main === module
  ? handleReadOnlyCliFlags(process.argv.slice(2), HELP_CONFIG, CLI_SPEC)
  : null
if (readOnlyExitCode !== null) process.exit(readOnlyExitCode)

const releaseGate = require("./release-gate")
const acceptanceReport = require("../desktop/services/agentLoop/evals/realProjectAcceptance")
const {
  buildOrchestratorReadinessReport,
  listReadinessReports,
  listRunActionAudits,
  readLatestReadinessReport,
  saveReadinessReport,
} = require("../desktop/services/agentLoop/readiness")
const runReport = require("../desktop/services/agentLoop/runReport")
const llmUsage = require("../desktop/services/llm/usage")
const { readLatestProviderHealthReport } = require("../desktop/services/llm/providerHealth")
const { readLatestDebugAdapterHealth } = require("../desktop/services/debug/adapterHealth")
const { readLatestExtensionEcosystemHealth } = require("../desktop/services/extensions-host/ecosystemHealth")
const { readLatestExtensionCompatibilityReport } = require("../desktop/services/extensions-host/extensionCompatibility")
const { readLatestGoalRuntimeHealth } = require("../desktop/services/goalScheduler/stabilityHealth")
const { readLatestSandboxSecurityEvidence } = require("../desktop/services/agentLoop/sandboxSecurityEvidence")
const releaseEvidenceExport = require("../desktop/services/agentLoop/releaseEvidenceExport")
const { readLatestPerformanceBaseline } = require("./ar-health")
const { readLatestPackagingPreflight } = require("./packaging-preflight")
const { readLatestWorkbenchDeepSmoke } = require("./workbench-deep-smoke")
const { readLatestAgentChangeSafetySmoke } = require("./agent-change-safety-smoke")
const { readLatestRouterCalibrationSmoke } = require("./router-calibration-smoke")
const { readLatestProductGradeGate } = require("./au-product-grade-gate")
const { readLatestAxEnterpriseGapGate } = require("./ax-enterprise-gap-gate")
const { readLatestExtensionEnterpriseGate } = require("./extension-enterprise-gate")
const { readLatestMarketplaceSmoke } = require("./extension-marketplace-smoke")
const { readLatestInstallSmoke } = require("./extension-install-smoke")
const { readLatestMarketplaceInstallMatrix } = require("./extension-marketplace-install-matrix")
const { readLatestCompatibilityMatrix } = require("./extension-compatibility-matrix")
const { readLatestMigrationSmoke } = require("./extension-migration-smoke")
const { readLatestSecuritySmoke } = require("./extension-security-smoke")
const { readLatestInstalledMcpDiscoverySmoke } = require("./installed-mcp-discovery-smoke")
const { readLatestMcpGalleryManagementSmoke } = require("./mcp-gallery-management-smoke")
const { readLatestMcpProviderBridgeSmoke } = require("./mcp-provider-bridge-smoke")
const { readLatestAtReleaseCandidatePreflight } = require("./at-release-candidate-preflight")
const { readLatestEnterpriseDocCompletionAudit } = require("./enterprise-doc-completion-audit")
const { readLatestManualRealUiEvidence } = require("./manual-real-ui-evidence")
const { readLatestExtensionPlanCompletionAudit } = require("./extension-plan-completion-audit")
const { readLatestExplorerFsParity } = require("./explorer-fs-parity")
const { createOrchestratorStore } = require("../desktop/services/agentLoop/orchestratorStore")
const betaTrialPlan = require("./beta-trial-plan")
const betaTrialRun = require("./beta-trial-run")

const root = path.resolve(__dirname, "..")

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const currentModeArg = argv.find((arg) => arg.startsWith("--current-release-gate-mode="))
  return {
    noWrite: argv.includes("--no-write"),
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : path.join(root, ".codek", "reports"),
    currentReleaseGateMode: currentModeArg ? currentModeArg.slice("--current-release-gate-mode=".length) : "",
  }
}

function pickLatest(primary, fallback) {
  return primary?.report ? primary : fallback
}

function currentReleaseGateReport(mode) {
  if (!mode) return null
  return {
    reportKind: "release-gate-current-run",
    createdAt: Date.now(),
    mode,
    ready: true,
    upstreamReady: true,
    status: "upstream-ready",
    durationMs: 0,
    plannedSteps: [],
    steps: [],
    warnings: [{
      id: "current_run_snapshot",
      severity: "info",
      note: "当前 release gate 上游步骤已通过，最终报告会在门禁结束后写入。",
    }],
  }
}

function readLatestArHealthReports(reportDir) {
  return {
    provider: readLatestProviderHealthReport({ reportDir }).report,
    debug: readLatestDebugAdapterHealth({ reportDir }).report,
    extensions: readLatestExtensionEcosystemHealth({ reportDir }).report,
    compatibility: readLatestExtensionCompatibilityReport({ reportDir }).report,
    goals: readLatestGoalRuntimeHealth({ reportDir }).report,
    performance: readLatestPerformanceBaseline({ reportDir }).report,
  }
}

function readLatestJsonReport(reportDir, fileName) {
  const jsonPath = path.join(reportDir, fileName)
  try {
    const report = JSON.parse(require("node:fs").readFileSync(jsonPath, "utf8"))
    return { report, jsonPath }
  } catch {
    return { report: null, jsonPath }
  }
}

function readOrchestratorRuns(options = {}) {
  if (Array.isArray(options.runs)) return options.runs
  const dbPath = options.orchestratorDbPath || path.join(root, ".codek", "orchestrator.db")
  let store = null
  try {
    store = createOrchestratorStore({ dbPath })
    return store.listRuns(200)
  } catch {
    return []
  } finally {
    if (store) store.close()
  }
}

function buildAndSaveReleaseEvidence(options = {}) {
  const reportDir = options.reportDir || path.join(root, ".codek", "reports")
  const runs = readOrchestratorRuns(options)
  const currentGate = currentReleaseGateReport(options.currentReleaseGateMode)
  const releaseLatest = currentGate
    ? { report: currentGate, jsonPath: "" }
    : pickLatest(releaseGate.readLatestReport({ reportDir }), releaseGate.readLatestReport())
  const acceptanceLatest = pickLatest(
    acceptanceReport.readLatestAcceptanceReport({ reportDir }),
    acceptanceReport.readLatestAcceptanceReport(),
  )
  const realTrialLatest = runReport.readLatestRealWorkspaceTrialReport({ reportDir })
  const bdUserTrialLatest = betaTrialPlan.readLatest({ reportDir })
  const betaTrialRunLatest = betaTrialRun.readLatestBetaTrialRun({ reportDir })

  const readinessReport = buildOrchestratorReadinessReport({
    projectRoot: root,
    settings: {
      "codek.agent.realWorkspaceTrial.allowedPaths": ["desktop", "frontend", "scripts"],
      "codek.agent.realWorkspaceTrial.qualityGateCommands": ["npm run typecheck"],
    },
    runs,
    releaseGateReport: releaseLatest.report,
    acceptanceReport: acceptanceLatest.report,
    realTrialReport: realTrialLatest.report,
  })
  const savedReadiness = options.noWrite ? { markdownPath: "", jsonPath: "" } : saveReadinessReport(readinessReport, { reportDir })
  const readinessLatest = options.noWrite
    ? { report: readinessReport, markdownPath: "", jsonPath: "" }
    : readLatestReadinessReport({ reportDir })

  const workbenchDeepLatest = readLatestWorkbenchDeepSmoke({ reportDir })
  const agentChangeSafetyLatest = readLatestAgentChangeSafetySmoke({ reportDir })
  const routerCalibrationLatest = readLatestRouterCalibrationSmoke({ reportDir })
  const workbenchRealProjectUiLatest = readLatestJsonReport(reportDir, "workbench-real-project-ui-latest.json")
  const explorerFsParityLatest = readLatestExplorerFsParity(reportDir)
  const shellIntegrationLatest = readLatestJsonReport(reportDir, "shell-integration-smoke-latest.json")
  const debugAdapterLatest = readLatestJsonReport(reportDir, "debug-adapter-smoke-latest.json")
  const enterpriseDocAuditLatest = readLatestEnterpriseDocCompletionAudit({ reportDir })
  const extensionPlanAuditLatest = readLatestExtensionPlanCompletionAudit({ reportDir })
  const manualRealUiLatest = readLatestManualRealUiEvidence({ reportDir })
  const extensionMarketplaceSmokeLatest = readLatestMarketplaceSmoke({ reportDir })
  const extensionInstallSmokeLatest = readLatestInstallSmoke({ reportDir })
  const extensionMarketplaceInstallMatrixLatest = readLatestMarketplaceInstallMatrix({ reportDir })
  const extensionMigrationSmokeLatest = readLatestMigrationSmoke({ reportDir })
  const extensionSecuritySmokeLatest = readLatestSecuritySmoke({ reportDir })
  const extensionHostRestartSmokeLatest = readLatestJsonReport(reportDir, "extension-host-restart-smoke-latest-result.json")
  const ehMarketplaceE2eLatest = readLatestJsonReport(reportDir, "eh-e2e-marketplace-latest.json")
  const ehMementoStorageE2eLatest = readLatestJsonReport(reportDir, "eh-e2e-memento-storage-latest.json")
  const ehExtensionContextE2eLatest = readLatestJsonReport(reportDir, "eh-e2e-extension-context-latest.json")
  const ehImplicitActivationE2eLatest = readLatestJsonReport(reportDir, "eh-e2e-implicit-activation-latest.json")
  const ehDependencyLoopE2eLatest = readLatestJsonReport(reportDir, "eh-e2e-dependency-loop-latest.json")
  const ehSearchProviderE2eLatest = readLatestJsonReport(reportDir, "eh-e2e-search-provider-latest.json")
  const ehProfileContentHandlerE2eLatest = readLatestJsonReport(reportDir, "eh-e2e-profile-content-handler-latest.json")
  const installedMcpDiscoveryLatest = readLatestInstalledMcpDiscoverySmoke({ reportDir })
  const mcpGalleryManagementLatest = readLatestMcpGalleryManagementSmoke({ reportDir })
  const ehMcpProviderBridgeLatest = readLatestMcpProviderBridgeSmoke({ reportDir })
  const extensionCompatibilityMatrixLatest = readLatestCompatibilityMatrix({ reportDir })
  const extensionEnterpriseGateLatest = readLatestExtensionEnterpriseGate({ reportDir })
  const report = releaseEvidenceExport.buildReleaseEvidenceSummary({
    createdAt: Date.now(),
    releaseGateReport: releaseLatest.report,
    releaseGateJsonPath: releaseLatest.jsonPath,
    acceptanceReport: acceptanceLatest.report,
    acceptanceMarkdownPath: acceptanceLatest.markdownPath,
    acceptanceHistory: acceptanceReport.listAcceptanceReports({ reportDir }),
    readinessReport: readinessLatest.report,
    readinessMarkdownPath: readinessLatest.markdownPath || savedReadiness.markdownPath,
    readinessHistory: listReadinessReports({ reportDir }),
    realTrialReport: realTrialLatest.report,
    realTrialMarkdownPath: realTrialLatest.markdownPath,
    realTrialHistory: runReport.listRealWorkspaceTrialReports({ reportDir }),
    bdUserTrialReport: bdUserTrialLatest.report,
    bdUserTrialMarkdownPath: bdUserTrialLatest.markdownPath,
    bdUserTrialHistory: betaTrialPlan.listBetaTrialPlans({ reportDir }),
    betaTrialRunReport: betaTrialRunLatest.report,
    betaTrialRunMarkdownPath: betaTrialRunLatest.markdownPath,
    betaTrialRunHistory: betaTrialRun.listBetaTrialRuns({ reportDir }),
    runActionAudits: listRunActionAudits({ reportDir }),
    usageSummary: llmUsage.summarizeUsageAudits({ reportDir }),
    arHealth: readLatestArHealthReports(reportDir),
    packagingPreflight: readLatestPackagingPreflight({ reportDir }).report,
    sandboxSecurityReport: readLatestSandboxSecurityEvidence({ reportDir }).report,
    workbenchDeep: workbenchDeepLatest.report,
    agentChangeSafety: agentChangeSafetyLatest.report,
    agentChangeSafetyJsonPath: agentChangeSafetyLatest.jsonPath,
    agentChangeSafetyMarkdownPath: agentChangeSafetyLatest.markdownPath,
    routerCalibration: routerCalibrationLatest.report,
    routerCalibrationJsonPath: routerCalibrationLatest.jsonPath,
    routerCalibrationMarkdownPath: routerCalibrationLatest.markdownPath,
    workbenchRealProjectUi: workbenchRealProjectUiLatest.report,
    workbenchRealProjectUiJsonPath: workbenchRealProjectUiLatest.jsonPath,
    workbenchRealProjectUiMarkdownPath: workbenchRealProjectUiLatest.report?.latestMarkdownPath || path.join(reportDir, "workbench-real-project-ui-latest.md"),
    workbenchRealProjectUiScreenshotPath: workbenchRealProjectUiLatest.report?.latestScreenshotPath || path.join(reportDir, "workbench-real-project-ui-latest.png"),
    explorerFsParity: explorerFsParityLatest,
    explorerFsParityJsonPath: explorerFsParityLatest?.latestJsonPath || path.join(reportDir, "explorer-fs-parity-latest.json"),
    explorerFsParityMarkdownPath: explorerFsParityLatest?.latestMarkdownPath || path.join(reportDir, "explorer-fs-parity-latest.md"),
    shellIntegration: shellIntegrationLatest.report,
    shellIntegrationJsonPath: shellIntegrationLatest.jsonPath,
    shellIntegrationMarkdownPath: shellIntegrationLatest.report?.latestMarkdownPath || path.join(reportDir, "shell-integration-smoke-latest.md"),
    debugAdapterSmoke: debugAdapterLatest.report,
    debugAdapterSmokeJsonPath: debugAdapterLatest.jsonPath,
    debugAdapterSmokeMarkdownPath: debugAdapterLatest.report?.latestMarkdownPath || path.join(reportDir, "debug-adapter-smoke-latest.md"),
    enterpriseDocAudit: enterpriseDocAuditLatest.report,
    enterpriseDocAuditJsonPath: enterpriseDocAuditLatest.jsonPath,
    enterpriseDocAuditMarkdownPath: enterpriseDocAuditLatest.report?.latestMarkdownPath || path.join(reportDir, "enterprise-doc-completion-audit-latest.md"),
    extensionPlanAudit: extensionPlanAuditLatest.report,
    extensionPlanAuditJsonPath: extensionPlanAuditLatest.jsonPath,
    extensionPlanAuditMarkdownPath: extensionPlanAuditLatest.report?.latestMarkdownPath || path.join(reportDir, "extension-plan-completion-audit-latest.md"),
    manualRealUiEvidence: manualRealUiLatest.report,
    manualRealUiEvidenceJsonPath: manualRealUiLatest.jsonPath,
    manualRealUiEvidenceMarkdownPath: manualRealUiLatest.report?.latestMarkdownPath || path.join(reportDir, "manual-real-ui-evidence-latest.md"),
    taskRunEvidence: workbenchDeepLatest.report?.taskRunEvidence,
    productGradeGate: readLatestProductGradeGate({ reportDir }).report,
    axEnterpriseGate: readLatestAxEnterpriseGapGate({ reportDir }).report,
    extensionMarketplaceSmoke: extensionMarketplaceSmokeLatest.report,
    extensionMarketplaceSmokeJsonPath: extensionMarketplaceSmokeLatest.jsonPath,
    extensionMarketplaceSmokeMarkdownPath: extensionMarketplaceSmokeLatest.markdownPath,
    extensionInstallSmoke: extensionInstallSmokeLatest.report,
    extensionInstallSmokeJsonPath: extensionInstallSmokeLatest.jsonPath,
    extensionInstallSmokeMarkdownPath: extensionInstallSmokeLatest.markdownPath,
    extensionMarketplaceInstallMatrix: extensionMarketplaceInstallMatrixLatest.report,
    extensionMarketplaceInstallMatrixJsonPath: extensionMarketplaceInstallMatrixLatest.jsonPath,
    extensionMarketplaceInstallMatrixMarkdownPath: extensionMarketplaceInstallMatrixLatest.markdownPath,
    extensionMigrationSmoke: extensionMigrationSmokeLatest.report,
    extensionMigrationSmokeJsonPath: extensionMigrationSmokeLatest.jsonPath,
    extensionMigrationSmokeMarkdownPath: extensionMigrationSmokeLatest.markdownPath,
    extensionSecuritySmoke: extensionSecuritySmokeLatest.report,
    extensionSecuritySmokeJsonPath: extensionSecuritySmokeLatest.jsonPath,
    extensionSecuritySmokeMarkdownPath: extensionSecuritySmokeLatest.markdownPath,
    extensionHostRestartSmoke: extensionHostRestartSmokeLatest.report,
    extensionHostRestartSmokeJsonPath: extensionHostRestartSmokeLatest.jsonPath,
    extensionHostRestartSmokeMarkdownPath: extensionHostRestartSmokeLatest.markdownPath,
    ehMarketplaceE2e: ehMarketplaceE2eLatest.report,
    ehMarketplaceE2eJsonPath: ehMarketplaceE2eLatest.jsonPath,
    ehMarketplaceE2eMarkdownPath: ehMarketplaceE2eLatest.markdownPath,
    ehMementoStorageE2e: ehMementoStorageE2eLatest.report,
    ehMementoStorageE2eJsonPath: ehMementoStorageE2eLatest.jsonPath,
    ehMementoStorageE2eMarkdownPath: ehMementoStorageE2eLatest.markdownPath,
    ehExtensionContextE2e: ehExtensionContextE2eLatest.report,
    ehExtensionContextE2eJsonPath: ehExtensionContextE2eLatest.jsonPath,
    ehExtensionContextE2eMarkdownPath: ehExtensionContextE2eLatest.markdownPath,
    ehImplicitActivationE2e: ehImplicitActivationE2eLatest.report,
    ehImplicitActivationE2eJsonPath: ehImplicitActivationE2eLatest.jsonPath,
    ehImplicitActivationE2eMarkdownPath: ehImplicitActivationE2eLatest.markdownPath,
    ehDependencyLoopE2e: ehDependencyLoopE2eLatest.report,
    ehDependencyLoopE2eJsonPath: ehDependencyLoopE2eLatest.jsonPath,
    ehDependencyLoopE2eMarkdownPath: ehDependencyLoopE2eLatest.markdownPath,
    ehSearchProviderE2e: ehSearchProviderE2eLatest.report,
    ehSearchProviderE2eJsonPath: ehSearchProviderE2eLatest.jsonPath,
    ehSearchProviderE2eMarkdownPath: ehSearchProviderE2eLatest.markdownPath,
    ehProfileContentHandlerE2e: ehProfileContentHandlerE2eLatest.report,
    ehProfileContentHandlerE2eJsonPath: ehProfileContentHandlerE2eLatest.jsonPath,
    ehProfileContentHandlerE2eMarkdownPath: ehProfileContentHandlerE2eLatest.markdownPath,
    installedMcpDiscovery: installedMcpDiscoveryLatest.report,
    installedMcpDiscoveryJsonPath: installedMcpDiscoveryLatest.jsonPath,
    installedMcpDiscoveryMarkdownPath: installedMcpDiscoveryLatest.markdownPath,
    mcpGalleryManagement: mcpGalleryManagementLatest.report,
    mcpGalleryManagementJsonPath: mcpGalleryManagementLatest.jsonPath,
    mcpGalleryManagementMarkdownPath: mcpGalleryManagementLatest.markdownPath,
    ehMcpProviderBridge: ehMcpProviderBridgeLatest.report,
    ehMcpProviderBridgeJsonPath: ehMcpProviderBridgeLatest.jsonPath,
    ehMcpProviderBridgeMarkdownPath: ehMcpProviderBridgeLatest.markdownPath,
    extensionCompatibilityMatrix: extensionCompatibilityMatrixLatest.report,
    extensionCompatibilityMatrixJsonPath: extensionCompatibilityMatrixLatest.jsonPath,
    extensionCompatibilityMatrixMarkdownPath: extensionCompatibilityMatrixLatest.markdownPath,
    extensionEnterpriseGate: extensionEnterpriseGateLatest.report,
    extensionEnterpriseGateJsonPath: extensionEnterpriseGateLatest.jsonPath,
    extensionEnterpriseGateMarkdownPath: extensionEnterpriseGateLatest.markdownPath,
    atPreflight: readLatestAtReleaseCandidatePreflight({ reportDir }).report,
    currentReleaseGateMode: options.currentReleaseGateMode,
    reportDir,
    runs,
  })

  if (options.noWrite) {
    return { report, markdown: report.markdown, jsonPath: "", markdownPath: "" }
  }
  return releaseEvidenceExport.saveReleaseEvidenceSummary(report, { reportDir })
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const saved = buildAndSaveReleaseEvidence(options)
  const report = saved.report
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    gaps: (report.gaps || []).map((gap) => gap.id),
    jsonPath: saved.jsonPath,
    markdownPath: saved.markdownPath,
  }, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

if (require.main === module) {
  main()
}

module.exports = {
  buildAndSaveReleaseEvidence,
  currentReleaseGateReport,
  parseArgs,
  readOrchestratorRuns,
}
