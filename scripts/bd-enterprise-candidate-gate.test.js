const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  makeSteps,
  markdownReport,
  parseArgs,
  readLatestBdEnterpriseCandidate,
  resolveReportDir,
  runBdEnterpriseCandidate,
  saveCrashReport,
} = require("./bd-enterprise-candidate-gate")

function writeRunnerSmokeResult(options = {}, name = "bd mock smoke") {
  const resultFile = options.env?.CODEK_ELECTRON_SMOKE_RESULT_FILE
  if (!resultFile) return ""
  fs.mkdirSync(path.dirname(resultFile), { recursive: true })
  fs.writeFileSync(resultFile, `${JSON.stringify({
    ok: true,
    checks: [{ name, passed: true }],
  }, null, 2)}\n`, "utf8")
  return resultFile
}

test("BD enterprise candidate parseArgs supports report dir and no-write", () => {
  const parsed = parseArgs(["--no-write", "--report-dir=C:/tmp/bd"])
  assert.equal(parsed.noWrite, true)
  assert.equal(parsed.reportDir, "C:/tmp/bd")
})

test("BD enterprise candidate gate includes every documented blocking lane", () => {
  const steps = makeSteps({ reportDir: "D:/reports" })
  const ids = steps.map((step) => step.id)

  assert.deepEqual(ids, [
    "typecheck",
    "frontend_build",
    "desktop_node_tests",
    "p0_workbench_unit_tests",
    "workspace_file_operation_unit_tests",
    "p1_workbench_core_unit_tests",
    "user_visible_i18n_audit",
    "large_file_enterprise_smoke",
    "workbench_deep_smoke",
    "agent_change_safety_smoke",
    "explorer_performance_smoke",
    "explorer_electron_smoke",
    "explorer_fs_parity",
    "file_operation_visibility_electron_smoke",
    "search_replace_electron_smoke",
    "search_navigation_electron_smoke",
    "tab_overflow_electron_smoke",
    "icon_visual_state_electron_smoke",
    "real_project_ui_electron_smoke",
    "visual_baseline_electron_smoke",
    "multiroot_create_target_electron_smoke",
    "create_target_accuracy_electron_smoke",
    "long_task_recovery_smoke",
    "shell_integration_smoke",
    "debug_adapter_smoke",
    "multi_agent_conflict_smoke",
    "router_calibration_smoke",
    "real_project_quick_matrix",
    "extension_enterprise_baseline",
    "extension_ecosystem_health",
    "extension_marketplace_smoke",
    "extension_install_smoke",
    "extension_marketplace_install_matrix",
    "extension_migration_smoke",
    "extension_security_smoke",
    "eh_memento_storage_e2e",
    "eh_extension_context_e2e",
    "eh_implicit_activation_e2e",
    "eh_dependency_loop_e2e",
    "eh_search_provider_e2e",
    "eh_profile_content_handler_e2e",
    "installed_mcp_discovery_smoke",
    "mcp_gallery_management_smoke",
    "eh_mcp_provider_bridge",
    "extension_compatibility_matrix",
    "extension_enterprise_gate",
    "extension_plan_completion_audit",
    "enterprise_doc_completion_audit",
    "release_evidence_export",
  ])

  const workspaceFileOperationStep = steps.find((step) => step.id === "workspace_file_operation_unit_tests")
  assert.ok(workspaceFileOperationStep.args.includes("src/workspace/changeQueue.test.ts"))

  const desktopNodeStep = steps.find((step) => step.id === "desktop_node_tests")
  assert.ok(desktopNodeStep.args.includes("desktop/services/workspace/largeFileReader.test.js"))
  assert.ok(desktopNodeStep.args.includes("desktop/services/languageServices/index.test.js"))
  assert.ok(desktopNodeStep.args.includes("scripts/workbench-visual-baseline-smoke.test.js"))

  const explorerFsParityStep = steps.find((step) => step.id === "explorer_fs_parity")
  assert.equal(explorerFsParityStep.command, "node")
  assert.ok(explorerFsParityStep.args.includes("scripts/explorer-fs-parity.js"))
  assert.ok(explorerFsParityStep.args.includes("--project=D:\\Workspace"))
  assert.ok(explorerFsParityStep.args.includes("--dir=frontend\\vite-project"))

  const p0WorkbenchStep = steps.find((step) => step.id === "p0_workbench_unit_tests")
  assert.ok(p0WorkbenchStep.args.includes("src/workspace/largeFilePolicy.test.ts"))
  assert.ok(p0WorkbenchStep.args.includes("src/workbench/largeFileWindowNavigator.test.ts"))

  const p1WorkbenchCoreStep = steps.find((step) => step.id === "p1_workbench_core_unit_tests")
  assert.ok(p1WorkbenchCoreStep.args.includes("src/workbench/keybindingCommands.test.ts"))
  assert.ok(p1WorkbenchCoreStep.args.includes("src/workbench/commandRegistry.test.ts"))
  assert.ok(p1WorkbenchCoreStep.args.includes("src/workbench/contextKeys.test.ts"))
  assert.ok(p1WorkbenchCoreStep.args.includes("src/settings/settingsRuntimeIntegration.test.ts"))
  assert.ok(p1WorkbenchCoreStep.args.includes("src/settings/vscodeImportClient.test.ts"))

  const searchNavigationStep = steps.find((step) => step.id === "search_navigation_electron_smoke")
  assert.equal(searchNavigationStep.env.CODEK_ELECTRON_SMOKE_TIMEOUT_MS, "120000")
  assert.equal(searchNavigationStep.smokeResultName, "search-navigation")

  const searchReplaceStep = steps.find((step) => step.id === "search_replace_electron_smoke")
  assert.equal(searchReplaceStep.env.CODEK_ELECTRON_SMOKE_TIMEOUT_MS, "120000")
  assert.equal(searchReplaceStep.smokeResultName, "search-replace")

  const tabOverflowStep = steps.find((step) => step.id === "tab_overflow_electron_smoke")
  assert.equal(tabOverflowStep.env.CODEK_ELECTRON_SMOKE_TIMEOUT_MS, "240000")
  assert.equal(tabOverflowStep.smokeResultName, "tab-overflow")

  const visualBaselineStep = steps.find((step) => step.id === "visual_baseline_electron_smoke")
  assert.equal(visualBaselineStep.env.CODEK_ELECTRON_SMOKE_TIMEOUT_MS, "240000")
  assert.ok(visualBaselineStep.args.includes("smoke:workbench:visual-baseline"))
  assert.equal(visualBaselineStep.smokeResultName, "visual-baseline")

  const multiRootStep = steps.find((step) => step.id === "multiroot_create_target_electron_smoke")
  assert.equal(multiRootStep.env.CODEK_ELECTRON_SMOKE_TIMEOUT_MS, "180000")
  assert.equal(multiRootStep.smokeResultName, "multiroot-create-target")

  const createTargetAccuracyStep = steps.find((step) => step.id === "create_target_accuracy_electron_smoke")
  assert.equal(createTargetAccuracyStep.env.CODEK_ELECTRON_SMOKE_TIMEOUT_MS, "120000")
  assert.equal(createTargetAccuracyStep.smokeResultName, "create-target-accuracy")

  const routerCalibrationStep = steps.find((step) => step.id === "router_calibration_smoke")
  assert.ok(routerCalibrationStep.args.includes("smoke:router-calibration"))
  assert.ok(routerCalibrationStep.args.includes("--min-samples=100"))

  const extensionEcosystemStep = steps.find((step) => step.id === "extension_ecosystem_health")
  assert.equal(extensionEcosystemStep.command, "node")
  assert.ok(extensionEcosystemStep.args.includes("scripts/ar-health.js"))
  assert.ok(extensionEcosystemStep.args.includes("--report-dir=D:/reports"))

  const extensionBaselineStep = steps.find((step) => step.id === "extension_enterprise_baseline")
  assert.equal(extensionBaselineStep.command, "node")
  assert.equal(extensionBaselineStep.label, "扩展市场企业级基线")
  assert.ok(extensionBaselineStep.args.includes("scripts/extension-baseline.js"))
  assert.ok(extensionBaselineStep.args.includes("--report-dir=D:/reports"))

  const extensionEnterpriseStep = steps.find((step) => step.id === "extension_enterprise_gate")
  assert.equal(extensionEnterpriseStep.command, "node")
  assert.equal(extensionEnterpriseStep.label, "扩展企业级兼容门禁")
  assert.ok(extensionEnterpriseStep.args.includes("scripts/extension-enterprise-gate.js"))
  assert.ok(extensionEnterpriseStep.args.includes("--report-dir=D:/reports"))

  const extensionMarketplaceSmokeStep = steps.find((step) => step.id === "extension_marketplace_smoke")
  assert.equal(extensionMarketplaceSmokeStep.command, "node")
  assert.ok(extensionMarketplaceSmokeStep.args.includes("scripts/extension-marketplace-smoke.js"))
  assert.ok(extensionMarketplaceSmokeStep.args.includes("--report-dir=D:/reports"))

  const extensionInstallSmokeStep = steps.find((step) => step.id === "extension_install_smoke")
  assert.equal(extensionInstallSmokeStep.command, "node")
  assert.ok(extensionInstallSmokeStep.args.includes("scripts/extension-install-smoke.js"))
  assert.ok(extensionInstallSmokeStep.args.includes("--report-dir=D:/reports"))

  const extensionMarketplaceInstallMatrixStep = steps.find((step) => step.id === "extension_marketplace_install_matrix")
  assert.equal(extensionMarketplaceInstallMatrixStep.command, "node")
  assert.ok(extensionMarketplaceInstallMatrixStep.args.includes("scripts/extension-marketplace-install-matrix.js"))
  assert.ok(extensionMarketplaceInstallMatrixStep.args.includes("--top=100"))
  assert.ok(extensionMarketplaceInstallMatrixStep.args.includes("--report-dir=D:/reports"))

  const extensionMigrationSmokeStep = steps.find((step) => step.id === "extension_migration_smoke")
  assert.equal(extensionMigrationSmokeStep.command, "node")
  assert.ok(extensionMigrationSmokeStep.args.includes("scripts/extension-migration-smoke.js"))
  assert.ok(extensionMigrationSmokeStep.args.includes("--source=cursor"))
  assert.ok(extensionMigrationSmokeStep.args.includes("--dry-run"))
  assert.ok(extensionMigrationSmokeStep.args.includes("--report-dir=D:/reports"))

  const extensionSecuritySmokeStep = steps.find((step) => step.id === "extension_security_smoke")
  assert.equal(extensionSecuritySmokeStep.command, "node")
  assert.ok(extensionSecuritySmokeStep.args.includes("scripts/extension-security-smoke.js"))
  assert.ok(extensionSecuritySmokeStep.args.includes("--report-dir=D:/reports"))

  const ehMementoStorageStep = steps.find((step) => step.id === "eh_memento_storage_e2e")
  assert.equal(ehMementoStorageStep.command, "node")
  assert.equal(ehMementoStorageStep.label, "Extension Host memento storage E2E")
  assert.ok(ehMementoStorageStep.args.includes("scripts/eh-e2e.js"))
  assert.ok(ehMementoStorageStep.args.includes("--memento-storage"))
  assert.ok(ehMementoStorageStep.args.includes("--timeout=18000"))
  assert.ok(ehMementoStorageStep.args.includes("--report-dir=D:/reports"))

  const ehExtensionContextStep = steps.find((step) => step.id === "eh_extension_context_e2e")
  assert.equal(ehExtensionContextStep.command, "node")
  assert.equal(ehExtensionContextStep.label, "Extension Host ExtensionContext E2E")
  assert.ok(ehExtensionContextStep.args.includes("scripts/eh-e2e.js"))
  assert.ok(ehExtensionContextStep.args.includes("--extension-context"))
  assert.ok(ehExtensionContextStep.args.includes("--timeout=18000"))
  assert.ok(ehExtensionContextStep.args.includes("--report-dir=D:/reports"))

  const ehImplicitActivationStep = steps.find((step) => step.id === "eh_implicit_activation_e2e")
  assert.equal(ehImplicitActivationStep.command, "node")
  assert.equal(ehImplicitActivationStep.label, "Extension Host implicit activation E2E")
  assert.ok(ehImplicitActivationStep.args.includes("scripts/eh-e2e.js"))
  assert.ok(ehImplicitActivationStep.args.includes("--implicit-activation"))
  assert.ok(ehImplicitActivationStep.args.includes("--timeout=18000"))
  assert.ok(ehImplicitActivationStep.args.includes("--report-dir=D:/reports"))

  const ehDependencyLoopStep = steps.find((step) => step.id === "eh_dependency_loop_e2e")
  assert.equal(ehDependencyLoopStep.command, "node")
  assert.equal(ehDependencyLoopStep.label, "Extension Host dependency loop E2E")
  assert.ok(ehDependencyLoopStep.args.includes("scripts/eh-e2e.js"))
  assert.ok(ehDependencyLoopStep.args.includes("--dependency-loop"))
  assert.ok(ehDependencyLoopStep.args.includes("--timeout=18000"))
  assert.ok(ehDependencyLoopStep.args.includes("--report-dir=D:/reports"))

  const ehSearchProviderStep = steps.find((step) => step.id === "eh_search_provider_e2e")
  assert.equal(ehSearchProviderStep.command, "node")
  assert.equal(ehSearchProviderStep.label, "Extension Host SearchProvider E2E")
  assert.ok(ehSearchProviderStep.args.includes("scripts/eh-e2e.js"))
  assert.ok(ehSearchProviderStep.args.includes("--search-provider"))
  assert.ok(ehSearchProviderStep.args.includes("--timeout=18000"))
  assert.ok(ehSearchProviderStep.args.includes("--report-dir=D:/reports"))

  const ehProfileContentHandlerStep = steps.find((step) => step.id === "eh_profile_content_handler_e2e")
  assert.equal(ehProfileContentHandlerStep.command, "node")
  assert.equal(ehProfileContentHandlerStep.label, "Extension Host ProfileContentHandler E2E")
  assert.ok(ehProfileContentHandlerStep.args.includes("scripts/eh-e2e.js"))
  const installedMcpDiscoveryStep = steps.find((step) => step.id === "installed_mcp_discovery_smoke")
  assert.equal(installedMcpDiscoveryStep.command, "node")
  assert.equal(installedMcpDiscoveryStep.label, "Installed MCP discovery smoke")
  assert.ok(installedMcpDiscoveryStep.args.includes("scripts/installed-mcp-discovery-smoke.js"))
  assert.ok(installedMcpDiscoveryStep.args.includes("--report-dir=D:/reports"))
  assert.ok(ids.indexOf("eh_profile_content_handler_e2e") < ids.indexOf("installed_mcp_discovery_smoke"))
  assert.ok(ids.indexOf("installed_mcp_discovery_smoke") < ids.indexOf("mcp_gallery_management_smoke"))
  assert.ok(ids.indexOf("mcp_gallery_management_smoke") < ids.indexOf("eh_mcp_provider_bridge"))
  assert.ok(ehProfileContentHandlerStep.args.includes("--profile-content-handler"))
  assert.ok(ehProfileContentHandlerStep.args.includes("--timeout=18000"))
  assert.ok(ehProfileContentHandlerStep.args.includes("--report-dir=D:/reports"))

  const mcpGalleryManagementStep = steps.find((step) => step.id === "mcp_gallery_management_smoke")
  assert.equal(mcpGalleryManagementStep.command, "node")
  assert.equal(mcpGalleryManagementStep.label, "MCP Gallery management smoke")
  assert.ok(mcpGalleryManagementStep.args.includes("scripts/mcp-gallery-management-smoke.js"))
  assert.ok(mcpGalleryManagementStep.args.includes("--report-dir=D:/reports"))

  const ehMcpProviderBridgeStep = steps.find((step) => step.id === "eh_mcp_provider_bridge")
  assert.equal(ehMcpProviderBridgeStep.command, "node")
  assert.equal(ehMcpProviderBridgeStep.label, "Extension Host MCP provider bridge smoke")
  assert.ok(ehMcpProviderBridgeStep.args.includes("scripts/mcp-provider-bridge-smoke.js"))
  assert.ok(ehMcpProviderBridgeStep.args.includes("--report-dir=D:/reports"))

  const extensionCompatibilityMatrixStep = steps.find((step) => step.id === "extension_compatibility_matrix")
  assert.equal(extensionCompatibilityMatrixStep.command, "node")
  assert.ok(extensionCompatibilityMatrixStep.args.includes("scripts/extension-compatibility-matrix.js"))
  assert.ok(extensionCompatibilityMatrixStep.args.includes("--top=100"))
  assert.ok(extensionCompatibilityMatrixStep.args.includes("--report-dir=D:/reports"))

  const i18nAuditStep = steps.find((step) => step.id === "user_visible_i18n_audit")
  assert.equal(i18nAuditStep.command, "npm")
  assert.ok(i18nAuditStep.args.includes("audit:user-visible-i18n"))

  const largeFileEnterpriseStep = steps.find((step) => step.id === "large_file_enterprise_smoke")
  assert.equal(largeFileEnterpriseStep.command, "npm")
  assert.ok(largeFileEnterpriseStep.args.includes("smoke:workbench:large-file-enterprise"))

  const enterpriseDocAuditStep = steps.find((step) => step.id === "enterprise_doc_completion_audit")
  assert.equal(enterpriseDocAuditStep.command, "node")
  assert.ok(enterpriseDocAuditStep.args.includes("scripts/enterprise-doc-completion-audit.js"))
  assert.ok(enterpriseDocAuditStep.args.includes("--report-dir=D:/reports"))
  const extensionPlanAuditStep = steps.find((step) => step.id === "extension_plan_completion_audit")
  assert.equal(extensionPlanAuditStep.command, "node")
  assert.ok(extensionPlanAuditStep.args.includes("scripts/extension-plan-completion-audit.js"))
  assert.ok(extensionPlanAuditStep.args.includes("--report-dir=D:/reports"))
  assert.ok(extensionPlanAuditStep.args.includes("--gate-in-progress"))
  assert.ok(ids.indexOf("large_file_enterprise_smoke") < ids.indexOf("enterprise_doc_completion_audit"))
  assert.ok(ids.indexOf("extension_enterprise_gate") < ids.indexOf("extension_plan_completion_audit"))
  assert.ok(ids.indexOf("extension_plan_completion_audit") < ids.indexOf("enterprise_doc_completion_audit"))
  assert.ok(ids.indexOf("enterprise_doc_completion_audit") < ids.indexOf("release_evidence_export"))
  assert.ok(ids.indexOf("extension_enterprise_baseline") < ids.indexOf("extension_ecosystem_health"))
  assert.ok(ids.indexOf("extension_ecosystem_health") < ids.indexOf("release_evidence_export"))
  assert.ok(ids.indexOf("extension_ecosystem_health") < ids.indexOf("extension_marketplace_smoke"))
  assert.ok(ids.indexOf("extension_marketplace_smoke") < ids.indexOf("extension_enterprise_gate"))
  assert.ok(ids.indexOf("extension_install_smoke") < ids.indexOf("extension_enterprise_gate"))
  assert.ok(ids.indexOf("extension_marketplace_install_matrix") < ids.indexOf("extension_enterprise_gate"))
  assert.ok(ids.indexOf("extension_migration_smoke") < ids.indexOf("extension_enterprise_gate"))
  assert.ok(ids.indexOf("eh_implicit_activation_e2e") < ids.indexOf("eh_dependency_loop_e2e"))
  assert.ok(ids.indexOf("eh_dependency_loop_e2e") < ids.indexOf("extension_enterprise_gate"))
  assert.ok(ids.indexOf("eh_dependency_loop_e2e") < ids.indexOf("eh_search_provider_e2e"))
  assert.ok(ids.indexOf("eh_search_provider_e2e") < ids.indexOf("extension_enterprise_gate"))
  assert.ok(ids.indexOf("eh_search_provider_e2e") < ids.indexOf("eh_profile_content_handler_e2e"))
  assert.ok(ids.indexOf("eh_profile_content_handler_e2e") < ids.indexOf("extension_enterprise_gate"))
  assert.ok(ids.indexOf("eh_profile_content_handler_e2e") < ids.indexOf("eh_mcp_provider_bridge"))
  assert.ok(ids.indexOf("eh_mcp_provider_bridge") < ids.indexOf("extension_enterprise_gate"))
  assert.ok(ids.indexOf("extension_security_smoke") < ids.indexOf("extension_enterprise_gate"))
  assert.ok(ids.indexOf("extension_security_smoke") < ids.indexOf("eh_memento_storage_e2e"))
  assert.ok(ids.indexOf("eh_memento_storage_e2e") < ids.indexOf("extension_enterprise_gate"))
  assert.ok(ids.indexOf("eh_memento_storage_e2e") < ids.indexOf("eh_extension_context_e2e"))
  assert.ok(ids.indexOf("eh_extension_context_e2e") < ids.indexOf("eh_implicit_activation_e2e"))
  assert.ok(ids.indexOf("eh_extension_context_e2e") < ids.indexOf("extension_enterprise_gate"))
  assert.ok(ids.indexOf("eh_implicit_activation_e2e") < ids.indexOf("extension_enterprise_gate"))
  assert.ok(ids.indexOf("extension_compatibility_matrix") < ids.indexOf("extension_enterprise_gate"))
  assert.ok(ids.indexOf("extension_ecosystem_health") < ids.indexOf("extension_enterprise_gate"))
  assert.ok(ids.indexOf("extension_plan_completion_audit") < ids.indexOf("release_evidence_export"))
  assert.ok(ids.indexOf("extension_enterprise_gate") < ids.indexOf("release_evidence_export"))
})

test("BD enterprise candidate gate stops at first failed step", async () => {
  const calls = []
  const report = await runBdEnterpriseCandidate({ noWrite: true, electronCooldownMs: 0, retryDelayMs: 0 }, (command, args) => {
    calls.push([command, args])
    return { status: calls.length === 2 ? 1 : 0 }
  })

  assert.equal(report.ready, false)
  assert.equal(report.status, "blocked")
  assert.equal(report.steps.length, 2)
  assert.equal(report.steps[1].id, "frontend_build")
  assert.ok(report.missingSteps.includes("desktop_node_tests"))
})

test("BD enterprise candidate gate saves latest report files", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-bd-enterprise-"))
  const report = await runBdEnterpriseCandidate({ reportDir, electronCooldownMs: 0, retryDelayMs: 0 }, (_command, _args, options) => {
    writeRunnerSmokeResult(options)
    return { status: 0 }
  })
  const latest = readLatestBdEnterpriseCandidate({ reportDir })

  assert.equal(report.ready, true)
  assert.equal(fs.existsSync(path.join(reportDir, "bd-enterprise-candidate-latest.json")), true)
  assert.equal(fs.existsSync(path.join(reportDir, "bd-enterprise-candidate-latest.md")), true)
  assert.equal(fs.existsSync(path.join(reportDir, "bd-enterprise-candidate-progress-latest.json")), true)
  assert.equal(latest.report.reportKind, "bd-enterprise-candidate-gate")
  assert.equal(latest.report.ready, true)
})

test("BD enterprise candidate gate writes progress after a failed step", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-bd-enterprise-progress-"))
  let calls = 0
  const report = await runBdEnterpriseCandidate({ reportDir, electronCooldownMs: 0, retryDelayMs: 0 }, () => {
    calls += 1
    return { status: calls === 3 ? 1 : 0 }
  })
  const progressPath = path.join(reportDir, "bd-enterprise-candidate-progress-latest.json")
  const progress = JSON.parse(fs.readFileSync(progressPath, "utf8"))

  assert.equal(report.ready, false)
  assert.equal(progress.status, "blocked")
  assert.equal(progress.steps.length, 3)
  assert.equal(progress.steps[2].id, "desktop_node_tests")
  assert.ok(progress.missingSteps.includes("p0_workbench_unit_tests"))
})

test("BD enterprise candidate gate writes crash diagnostics", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-bd-enterprise-crash-"))
  const result = saveCrashReport(new Error("boom"), { reportDir })
  const crash = JSON.parse(fs.readFileSync(result.latestJsonPath, "utf8"))

  assert.equal(crash.status, "crashed")
  assert.equal(crash.ready, false)
  assert.equal(crash.error.message, "boom")
  assert.ok(crash.missingSteps.includes("typecheck"))
})

test("BD enterprise candidate gate forwards per-step env overrides", async () => {
  const envValues = []
  await runBdEnterpriseCandidate({ noWrite: true, electronCooldownMs: 0, retryDelayMs: 0 }, (_command, _args, options = {}) => {
    envValues.push(options.env?.CODEK_ELECTRON_SMOKE_TIMEOUT_MS || "")
    writeRunnerSmokeResult(options)
    return { status: 0 }
  })

  assert.ok(envValues.includes("120000"))
})

test("BD enterprise candidate gate resolves relative smoke result paths from repo root", async () => {
  const smokeResultFiles = []
  await runBdEnterpriseCandidate(
    { reportDir: ".codek/reports", noWrite: true, electronCooldownMs: 0, retryDelayMs: 0 },
    (_command, _args, options = {}) => {
      const resultFile = writeRunnerSmokeResult(options)
      if (resultFile) smokeResultFiles.push(resultFile)
      return { status: 0 }
    },
  )

  assert.ok(smokeResultFiles.length > 0)
  assert.ok(smokeResultFiles.every((resultFile) => path.isAbsolute(resultFile)))
  assert.ok(smokeResultFiles.every((resultFile) => resultFile.startsWith(resolveReportDir(".codek/reports"))))
})

test("BD enterprise candidate no-write does not overwrite latest smoke evidence", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-bd-enterprise-no-write-smoke-"))
  const latestPath = path.join(reportDir, "electron-smoke-icon-visual-state-latest-result.json")
  const previous = {
    ok: true,
    checks: [{ name: "icon visual smoke fallback icons are svg not text badges", passed: true }],
  }
  fs.writeFileSync(latestPath, `${JSON.stringify(previous, null, 2)}\n`, "utf8")

  await runBdEnterpriseCandidate(
    { reportDir, noWrite: true, electronCooldownMs: 0, retryDelayMs: 0 },
    (_command, args, options = {}) => {
      writeRunnerSmokeResult(options)
      return { status: 0 }
    },
  )

  const latest = JSON.parse(fs.readFileSync(latestPath, "utf8"))
  assert.deepEqual(latest, previous)
})

test("BD enterprise candidate gate blocks empty Electron smoke evidence", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-bd-enterprise-empty-smoke-"))
  let tabOverflowCalls = 0

  const report = await runBdEnterpriseCandidate({ reportDir, noWrite: true, electronCooldownMs: 0, retryDelayMs: 0 }, (_command, args, options = {}) => {
    if (!args.includes("smoke:workbench:tab-overflow")) {
      writeRunnerSmokeResult(options)
      return { status: 0 }
    }

    tabOverflowCalls += 1
    fs.writeFileSync(
      options.env.CODEK_ELECTRON_SMOKE_RESULT_FILE,
      `${JSON.stringify({ ok: true, checks: [] }, null, 2)}\n`,
      "utf8",
    )
    return { status: 0 }
  })

  const tabStep = report.steps.find((step) => step.id === "tab_overflow_electron_smoke")
  assert.equal(report.ready, false)
  assert.equal(report.status, "blocked")
  assert.equal(tabOverflowCalls, 1)
  assert.equal(tabStep.passed, false)
  assert.match(tabStep.error, /空壳证据/)
  assert.ok(report.missingSteps.includes("icon_visual_state_electron_smoke"))
})

test("BD enterprise candidate markdown is Chinese for user-visible report text", async () => {
  const report = await runBdEnterpriseCandidate({ noWrite: true, electronCooldownMs: 0, retryDelayMs: 0 }, (_command, _args, options) => {
    writeRunnerSmokeResult(options)
    return { status: 0 }
  })
  const markdown = markdownReport(report)

  assert.match(markdown, /^# BD 企业级候选门禁/m)
  assert.match(markdown, /- 就绪: 是/)
  assert.match(markdown, /- 当前状态: 就绪/)
  assert.match(markdown, /- 总耗时: \d+ms/)
  assert.match(markdown, /## 执行步骤/)
  assert.match(markdown, /\| 步骤 ID \| 步骤名称 \| 状态 \| 耗时 \| 命令 \|/)
  assert.match(markdown, /\| typecheck \| 前端类型检查 \| 通过 \| \d+ms \| `npm run typecheck` \|/)
  assert.match(markdown, /## 人工验收提示/)
  assert.match(markdown, /此门禁不能替代用户真实项目中的 Cursor 级主观流畅度人工验收。/)
  assert.doesNotMatch(markdown, /BD Enterprise Candidate Gate/)
  assert.doesNotMatch(markdown, /Ready:|Status:|Created:|Duration:|Steps|Step \| Status/)
  assert.doesNotMatch(markdown, /\| [^|]+ \| (passed|failed) \|/)
  assert.doesNotMatch(markdown, /This gate cannot replace human validation/)
})

test("BD enterprise candidate gate retries tab overflow once when Electron smoke times out", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-bd-enterprise-retry-"))
  let tabOverflowCalls = 0

  const report = await runBdEnterpriseCandidate({ reportDir, noWrite: true, electronCooldownMs: 0, retryDelayMs: 0 }, (_command, args, options = {}) => {
    if (!args.includes("smoke:workbench:tab-overflow")) {
      writeRunnerSmokeResult(options)
      return { status: 0 }
    }

    tabOverflowCalls += 1
    fs.writeFileSync(
      options.env.CODEK_ELECTRON_SMOKE_RESULT_FILE,
      `${JSON.stringify(tabOverflowCalls === 1
        ? { ok: false, error: "timeout", lastStage: { stage: "exercise-tab-overflow:start" } }
        : { ok: true, checks: [{ name: "tab overflow smoke keeps tab names visible", passed: true }] }, null, 2)}\n`,
      "utf8",
    )
    return { status: tabOverflowCalls === 1 ? 1 : 0 }
  })

  const tabStep = report.steps.find((step) => step.id === "tab_overflow_electron_smoke")
  assert.equal(report.ready, true)
  assert.equal(tabOverflowCalls, 2)
  assert.equal(tabStep.passed, true)
  assert.equal(tabStep.retryCount, 1)
  assert.equal(tabStep.attempts.length, 2)
  assert.equal(tabStep.attempts[0].smokeResult.error, "timeout")
  assert.equal(tabStep.attempts[0].retryable, true)
  assert.equal(tabStep.attempts[1].passed, true)
})

test("BD enterprise candidate gate does not retry non-timeout Electron smoke assertions", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-bd-enterprise-no-retry-"))
  let tabOverflowCalls = 0

  const report = await runBdEnterpriseCandidate({ reportDir, noWrite: true, electronCooldownMs: 0, retryDelayMs: 0 }, (_command, args, options = {}) => {
    if (!args.includes("smoke:workbench:tab-overflow")) {
      writeRunnerSmokeResult(options)
      return { status: 0 }
    }

    tabOverflowCalls += 1
    fs.writeFileSync(
      options.env.CODEK_ELECTRON_SMOKE_RESULT_FILE,
      `${JSON.stringify({ ok: false, error: "tab names unreadable", checks: [{ name: "tab names", passed: false }] }, null, 2)}\n`,
      "utf8",
    )
    return { status: 1 }
  })

  const tabStep = report.steps.find((step) => step.id === "tab_overflow_electron_smoke")
  assert.equal(report.ready, false)
  assert.equal(report.status, "blocked")
  assert.equal(tabOverflowCalls, 1)
  assert.equal(tabStep.passed, false)
  assert.equal(tabStep.retryCount, 0)
  assert.equal(tabStep.attempts.length, 1)
  assert.equal(tabStep.attempts[0].retryable, false)
})

test("BD enterprise candidate markdown includes Chinese retry diagnostics", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-bd-enterprise-md-retry-"))
  let tabOverflowCalls = 0

  const report = await runBdEnterpriseCandidate({ reportDir, noWrite: true, electronCooldownMs: 0, retryDelayMs: 0 }, (_command, args, options = {}) => {
    if (!args.includes("smoke:workbench:tab-overflow")) {
      writeRunnerSmokeResult(options)
      return { status: 0 }
    }

    tabOverflowCalls += 1
    fs.writeFileSync(
      options.env.CODEK_ELECTRON_SMOKE_RESULT_FILE,
      `${JSON.stringify(tabOverflowCalls === 1
        ? { ok: false, error: "timeout", lastStage: { stage: "exercise-tab-overflow:start" } }
        : { ok: true, checks: [] }, null, 2)}\n`,
      "utf8",
    )
    return { status: tabOverflowCalls === 1 ? 1 : 0 }
  })
  const markdown = markdownReport(report)

  assert.match(markdown, /## 重试诊断/)
  assert.match(markdown, /tab_overflow_electron_smoke/)
  assert.match(markdown, /第 1 次/)
  assert.match(markdown, /超时/)
  assert.match(markdown, /exercise-tab-overflow:start/)
  assert.doesNotMatch(markdown, /Retry|attempt|timeout diagnostic/)
})

test("BD enterprise candidate markdown prefers renderer timeout stage diagnostics", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-bd-enterprise-renderer-stage-"))
  let tabOverflowCalls = 0

  const report = await runBdEnterpriseCandidate({ reportDir, noWrite: true, electronCooldownMs: 0, retryDelayMs: 0 }, (_command, args, options = {}) => {
    if (!args.includes("smoke:workbench:tab-overflow")) {
      writeRunnerSmokeResult(options)
      return { status: 0 }
    }

    tabOverflowCalls += 1
    fs.writeFileSync(
      options.env.CODEK_ELECTRON_SMOKE_RESULT_FILE,
      `${JSON.stringify(tabOverflowCalls === 1
        ? {
            ok: false,
            error: "timeout",
            lastStage: { stage: "run-smoke:timeout" },
            stage: { tabOverflow: { stage: "renderer-tab-overflow:run-start" } },
          }
        : { ok: true, checks: [{ name: "tab overflow smoke keeps tab names visible", passed: true }] }, null, 2)}\n`,
      "utf8",
    )
    return { status: tabOverflowCalls === 1 ? 1 : 0 }
  })
  const markdown = markdownReport(report)

  assert.match(markdown, /renderer-tab-overflow:run-start/)
  assert.doesNotMatch(markdown, /run-smoke:timeout/)
})
