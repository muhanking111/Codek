const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  defaultReportDir,
  makeSteps,
  parseArgs,
  readLatestReport,
  runReleaseGate,
  saveReport,
} = require("./release-gate")

test("parseArgs supports quick, build, and full release gate modes", () => {
  assert.deepEqual(parseArgs(["--no-write"]).includeBuild, false)
  assert.equal(parseArgs(["--include-build"]).includeBuild, true)
  const full = parseArgs(["--full", "--report-dir=C:/tmp/codek-release"])
  assert.equal(full.full, true)
  assert.equal(full.includeBuild, true)
  assert.equal(full.reportDir, "C:/tmp/codek-release")
  const productGrade = parseArgs(["--product-grade"])
  assert.equal(productGrade.productGrade, true)
  assert.equal(productGrade.includeBuild, true)
  const publicCandidate = parseArgs(["--public-candidate"])
  assert.equal(publicCandidate.publicCandidate, true)
  assert.equal(publicCandidate.includeBuild, true)
  const openSourceCandidate = parseArgs(["--open-source-candidate"])
  assert.equal(openSourceCandidate.openSourceCandidate, true)
  assert.equal(openSourceCandidate.includeBuild, true)
})

test("makeSteps keeps quick mode lightweight and full mode complete", () => {
  assert.deepEqual(makeSteps({}).map((step) => step.id), ["typecheck", "i_j_smoke_tests", "smoke_j", "real_workspace_trial_smoke"])
  assert.deepEqual(makeSteps({ includeBuild: true }).map((step) => step.id), ["typecheck", "i_j_smoke_tests", "smoke_j", "real_workspace_trial_smoke", "build"])
  assert.deepEqual(makeSteps({ includeBuild: true, full: true }).map((step) => step.id), [
    "typecheck",
    "i_j_smoke_tests",
    "smoke_j",
    "real_workspace_trial_smoke",
    "build",
    "smoke_k",
    "ar_health_tests",
    "ar_performance_baseline",
    "packaging_preflight",
  ])
  assert.deepEqual(makeSteps({ includeBuild: true, productGrade: true }).map((step) => step.id), [
    "typecheck",
    "i_j_smoke_tests",
    "smoke_j",
    "real_workspace_trial_smoke",
    "build",
    "workbench_deep_smoke",
    "ax8_task_language_smoke",
    "ax9_debug_adapter_smoke",
    "product_grade_release_evidence",
    "product_grade_release_evidence_export",
    "au_product_grade_gate",
  ])
  const ax8Step = makeSteps({ includeBuild: true, productGrade: true }).find((step) => step.id === "ax8_task_language_smoke")
  assert.match(ax8Step.cwd, /frontend[\\/]vite-project$/)
  const auGateStep = makeSteps({ includeBuild: true, productGrade: true }).find((step) => step.id === "au_product_grade_gate")
  assert.equal(auGateStep.args.includes("--current-release-gate-mode=product-grade"), true)
  const releaseEvidenceExportStep = makeSteps({ includeBuild: true, productGrade: true }).find((step) => step.id === "product_grade_release_evidence_export")
  assert.equal(releaseEvidenceExportStep.args.includes("--current-release-gate-mode=product-grade"), true)
  assert.deepEqual(makeSteps({ includeBuild: true, publicCandidate: true }).map((step) => step.id), [
    "typecheck",
    "i_j_smoke_tests",
    "smoke_j",
    "real_workspace_trial_smoke",
    "build",
    "real_project_smoke",
    "ar_health",
    "packaging_preflight",
    "workbench_deep_smoke",
    "ax8_task_language_smoke",
    "ax9_debug_adapter_smoke",
    "sandbox_security_evidence",
    "release_gate_current_snapshot",
    "release_evidence_pre_au",
    "au_product_grade_gate",
    "ax_enterprise_gap_gate",
    "at_preflight",
    "source_deploy_doctor",
    "at_package_artifacts",
    "at_install_smoke",
    "packaged_app_smoke",
    "packaged_multi_agent_smoke",
    "at_functional_smoke",
    "at_release_candidate_evidence",
    "at_release_candidate_runbook",
    "release_evidence",
    "ay_public_candidate_tests",
    "ay_public_candidate_gate",
  ])
  const ayGateStep = makeSteps({ includeBuild: true, publicCandidate: true }).find((step) => step.id === "ay_public_candidate_gate")
  assert.equal(ayGateStep.args.includes("--skip-refresh"), true)
  assert.deepEqual(makeSteps({ includeBuild: true, openSourceCandidate: true }).map((step) => step.id), [
    "typecheck",
    "i_j_smoke_tests",
    "smoke_j",
    "real_workspace_trial_smoke",
    "build",
    "ba_clean_clone_doctor",
    "ba_open_source_readiness",
    "ba_ci_readiness",
    "ba_cross_platform_package_plan",
    "ba_release_draft",
    "ba_beta_trial_plan",
    "extension_marketplace_smoke",
    "extension_install_smoke",
    "extension_migration_smoke",
    "extension_security_smoke",
    "eh_memento_storage_e2e",
    "eh_extension_context_e2e",
    "eh_implicit_activation_e2e",
    "eh_dependency_loop_e2e",
    "eh_search_provider_e2e",
    "eh_profile_content_handler_e2e",
    "extension_compatibility_matrix",
    "extension_enterprise_gate",
    "ba_open_source_candidate_tests",
    "ba_open_source_candidate_gate",
  ])
  const baDoctorStep = makeSteps({ includeBuild: true, openSourceCandidate: true }).find((step) => step.id === "ba_clean_clone_doctor")
  assert.equal(baDoctorStep.args.includes("--clean-clone"), true)
  const openSourceSteps = makeSteps({ includeBuild: true, openSourceCandidate: true })
  const releaseDraftStep = openSourceSteps.find((step) => step.id === "ba_release_draft")
  assert.equal(releaseDraftStep.args.includes("--gate-in-progress"), true)
  const extensionMarketplaceSmokeStep = openSourceSteps.find((step) => step.id === "extension_marketplace_smoke")
  assert.deepEqual(extensionMarketplaceSmokeStep.args.slice(0, 3), ["run", "extension:marketplace-smoke", "--"])
  assert.match(extensionMarketplaceSmokeStep.args[3], /--report-dir=.*\.codek[\\/]release-gate$/)
  const extensionInstallSmokeStep = openSourceSteps.find((step) => step.id === "extension_install_smoke")
  assert.deepEqual(extensionInstallSmokeStep.args.slice(0, 3), ["run", "extension:install-smoke", "--"])
  const extensionMigrationSmokeStep = openSourceSteps.find((step) => step.id === "extension_migration_smoke")
  assert.deepEqual(extensionMigrationSmokeStep.args.slice(0, 3), ["run", "extension:migration-smoke", "--"])
  assert.equal(extensionMigrationSmokeStep.args.includes("--source=cursor"), true)
  assert.equal(extensionMigrationSmokeStep.args.includes("--dry-run"), true)
  const extensionSecuritySmokeStep = openSourceSteps.find((step) => step.id === "extension_security_smoke")
  assert.deepEqual(extensionSecuritySmokeStep.args.slice(0, 3), ["run", "extension:security-smoke", "--"])
  assert.match(extensionInstallSmokeStep.args[3], /--report-dir=.*\.codek[\\/]release-gate$/)
  const ehMementoStorageStep = openSourceSteps.find((step) => step.id === "eh_memento_storage_e2e")
  assert.deepEqual(ehMementoStorageStep.args.slice(0, 5), ["run", "eh:e2e", "--", "--memento-storage", "--timeout=18000"])
  assert.match(ehMementoStorageStep.args[5], /--report-dir=.*\.codek[\\/]release-gate$/)
  const ehExtensionContextStep = openSourceSteps.find((step) => step.id === "eh_extension_context_e2e")
  assert.deepEqual(ehExtensionContextStep.args.slice(0, 5), ["run", "eh:e2e", "--", "--extension-context", "--timeout=18000"])
  assert.match(ehExtensionContextStep.args[5], /--report-dir=.*\.codek[\\/]release-gate$/)
  const ehImplicitActivationStep = openSourceSteps.find((step) => step.id === "eh_implicit_activation_e2e")
  assert.deepEqual(ehImplicitActivationStep.args.slice(0, 5), ["run", "eh:e2e", "--", "--implicit-activation", "--timeout=18000"])
  assert.match(ehImplicitActivationStep.args[5], /--report-dir=.*\.codek[\\/]release-gate$/)
  const ehDependencyLoopStep = openSourceSteps.find((step) => step.id === "eh_dependency_loop_e2e")
  assert.deepEqual(ehDependencyLoopStep.args.slice(0, 5), ["run", "eh:e2e", "--", "--dependency-loop", "--timeout=18000"])
  assert.match(ehDependencyLoopStep.args[5], /--report-dir=.*\.codek[\\/]release-gate$/)
  const ehSearchProviderStep = openSourceSteps.find((step) => step.id === "eh_search_provider_e2e")
  assert.deepEqual(ehSearchProviderStep.args.slice(0, 5), ["run", "eh:e2e", "--", "--search-provider", "--timeout=18000"])
  assert.match(ehSearchProviderStep.args[5], /--report-dir=.*\.codek[\\/]release-gate$/)
  const ehProfileContentHandlerStep = openSourceSteps.find((step) => step.id === "eh_profile_content_handler_e2e")
  assert.deepEqual(ehProfileContentHandlerStep.args.slice(0, 5), ["run", "eh:e2e", "--", "--profile-content-handler", "--timeout=18000"])
  assert.match(ehProfileContentHandlerStep.args[5], /--report-dir=.*\.codek[\\/]release-gate$/)
  const extensionCompatibilityMatrixStep = openSourceSteps.find((step) => step.id === "extension_compatibility_matrix")
  assert.deepEqual(extensionCompatibilityMatrixStep.args.slice(0, 4), ["run", "extension:compatibility-matrix", "--", "--top=100"])
  assert.match(extensionCompatibilityMatrixStep.args[4], /--report-dir=.*\.codek[\\/]release-gate$/)
  const extensionEnterpriseGateStep = openSourceSteps.find((step) => step.id === "extension_enterprise_gate")
  assert.deepEqual(extensionEnterpriseGateStep.args.slice(0, 3), ["run", "extension:enterprise-gate", "--"])
  assert.match(extensionEnterpriseGateStep.args[3], /--report-dir=.*\.codek[\\/]release-gate$/)
  const openSourceIds = openSourceSteps.map((step) => step.id)
  assert.ok(openSourceIds.indexOf("ba_beta_trial_plan") < openSourceIds.indexOf("extension_marketplace_smoke"))
  assert.ok(openSourceIds.indexOf("extension_marketplace_smoke") < openSourceIds.indexOf("extension_enterprise_gate"))
  assert.ok(openSourceIds.indexOf("extension_install_smoke") < openSourceIds.indexOf("extension_enterprise_gate"))
  assert.ok(openSourceIds.indexOf("extension_migration_smoke") < openSourceIds.indexOf("extension_enterprise_gate"))
  assert.ok(openSourceIds.indexOf("extension_security_smoke") < openSourceIds.indexOf("extension_enterprise_gate"))
  assert.ok(openSourceIds.indexOf("extension_security_smoke") < openSourceIds.indexOf("eh_memento_storage_e2e"))
  assert.ok(openSourceIds.indexOf("eh_memento_storage_e2e") < openSourceIds.indexOf("extension_enterprise_gate"))
  assert.ok(openSourceIds.indexOf("eh_memento_storage_e2e") < openSourceIds.indexOf("eh_extension_context_e2e"))
  assert.ok(openSourceIds.indexOf("eh_extension_context_e2e") < openSourceIds.indexOf("eh_implicit_activation_e2e"))
  assert.ok(openSourceIds.indexOf("eh_extension_context_e2e") < openSourceIds.indexOf("extension_enterprise_gate"))
  assert.ok(openSourceIds.indexOf("eh_implicit_activation_e2e") < openSourceIds.indexOf("extension_enterprise_gate"))
  assert.ok(openSourceIds.indexOf("eh_implicit_activation_e2e") < openSourceIds.indexOf("eh_dependency_loop_e2e"))
  assert.ok(openSourceIds.indexOf("eh_dependency_loop_e2e") < openSourceIds.indexOf("extension_enterprise_gate"))
  assert.ok(openSourceIds.indexOf("eh_dependency_loop_e2e") < openSourceIds.indexOf("eh_search_provider_e2e"))
  assert.ok(openSourceIds.indexOf("eh_search_provider_e2e") < openSourceIds.indexOf("extension_enterprise_gate"))
  assert.ok(openSourceIds.indexOf("eh_search_provider_e2e") < openSourceIds.indexOf("eh_profile_content_handler_e2e"))
  assert.ok(openSourceIds.indexOf("eh_profile_content_handler_e2e") < openSourceIds.indexOf("extension_enterprise_gate"))
  assert.ok(openSourceIds.indexOf("extension_compatibility_matrix") < openSourceIds.indexOf("extension_enterprise_gate"))
  assert.ok(openSourceIds.indexOf("extension_enterprise_gate") < openSourceIds.indexOf("ba_open_source_candidate_tests"))
})

test("runReleaseGate stops after the first failed step", async () => {
  const calls = []
  const report = await runReleaseGate({ noWrite: true }, (command, args) => {
    calls.push([command, ...args].join(" "))
    return { status: calls.length === 2 ? 1 : 0 }
  })

  assert.equal(report.ready, false)
  assert.equal(report.steps.length, 2)
  assert.equal(report.steps[1].passed, false)
})

test("runReleaseGate writes release gate report when enabled", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-gate-test-"))
  const report = await runReleaseGate({ reportDir }, () => ({ status: 0 }))

  assert.equal(report.ready, true)
  assert.equal(fs.existsSync(report.jsonPath), true)
  const saved = JSON.parse(fs.readFileSync(report.jsonPath, "utf8"))
  assert.equal(saved.ready, true)
  assert.equal(saved.mode, "quick")
})

test("runReleaseGate records public candidate mode", async () => {
  const report = await runReleaseGate({ publicCandidate: true, includeBuild: true, noWrite: true }, () => ({ status: 0 }))

  assert.equal(report.ready, true)
  assert.equal(report.mode, "public-candidate")
  assert.equal(report.plannedSteps.includes("ay_public_candidate_gate"), true)
})

test("runReleaseGate records open-source candidate mode", async () => {
  const report = await runReleaseGate({ openSourceCandidate: true, includeBuild: true, noWrite: true }, () => ({ status: 0 }))

  assert.equal(report.ready, true)
  assert.equal(report.mode, "open-source-candidate")
  assert.equal(report.plannedSteps.includes("ba_open_source_candidate_gate"), true)
})

test("runReleaseGate passes current successful step ids to release draft", async () => {
  const calls = []
  const report = await runReleaseGate({ openSourceCandidate: true, includeBuild: true, noWrite: true }, (command, args) => {
    calls.push({ command, args })
    return { status: 0 }
  })
  const releaseDraftCall = calls.find((call) => call.args.includes("ba:release-draft"))

  assert.equal(report.ready, true)
  assert.ok(releaseDraftCall)
  assert.equal(releaseDraftCall.args.includes("--gate-in-progress"), true)
  const passedStepIdsArg = releaseDraftCall.args.find((arg) => arg.startsWith("--passed-step-ids="))
  assert.match(passedStepIdsArg, /typecheck/)
  assert.match(passedStepIdsArg, /ba_cross_platform_package_plan/)
  assert.doesNotMatch(passedStepIdsArg, /ba_release_draft/)
})

test("saveReport creates the target directory", () => {
  const reportDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-gate-save-")), "nested")
  const jsonPath = saveReport({ ready: true, steps: [] }, reportDir)

  assert.equal(fs.existsSync(jsonPath), true)
})

test("readLatestReport returns null when no report exists", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-gate-empty-"))
  const latest = readLatestReport({ reportDir })

  assert.equal(latest.report, null)
  assert.equal(latest.jsonPath, path.join(reportDir, "release-gate-latest.json"))
})

test("readLatestReport loads saved release gate reports", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-gate-latest-"))
  const report = await runReleaseGate({ reportDir }, () => ({ status: 0 }))
  const latest = readLatestReport({ reportDir })

  assert.equal(latest.report.ready, true)
  assert.equal(latest.report.mode, "quick")
  assert.equal(latest.report.jsonPath, report.jsonPath)
  assert.equal(latest.jsonPath, report.jsonPath)
})

test("defaultReportDir points at the workspace release gate folder", () => {
  assert.match(defaultReportDir(), /\.codek[\\/]release-gate$/)
})
