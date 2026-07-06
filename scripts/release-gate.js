const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const root = path.resolve(__dirname, "..")

function defaultReportDir() {
  return path.join(root, ".codek", "release-gate")
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const full = argv.includes("--full")
  const productGrade = argv.includes("--product-grade")
  const publicCandidate = argv.includes("--public-candidate")
  const openSourceCandidate = argv.includes("--open-source-candidate")
  return {
    full,
    productGrade,
    publicCandidate,
    openSourceCandidate,
    includeBuild: full || productGrade || publicCandidate || openSourceCandidate || argv.includes("--include-build"),
    noWrite: argv.includes("--no-write"),
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
  }
}

function makeSteps(options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  const steps = [
    {
      id: "typecheck",
      label: "前端类型检查",
      command: "npm",
      args: ["run", "typecheck"],
    },
    {
      id: "i_j_smoke_tests",
      label: "I/J smoke 单测",
      command: "node",
      args: ["--test", "scripts/i-real-workspace-smoke.test.js"],
    },
    {
      id: "smoke_j",
      label: "J 线数据契约 smoke",
      command: "npm",
      args: ["run", "smoke:j", "--", "--no-write"],
    },
    {
      id: "real_workspace_trial_smoke",
      label: "Q 线真实工作区试运行 smoke",
      command: "npm",
      args: ["run", "smoke:real-workspace-trial", "--", `--report-dir=${reportDir}`],
    },
  ]
  if (options.includeBuild) {
    steps.push({
      id: "build",
      label: "完整构建",
      command: "npm",
      args: ["run", "build"],
    })
  }
  if (options.full) {
    steps.push({
      id: "smoke_k",
      label: "K 线 Electron 登录态 smoke",
      command: "npm",
      args: ["run", "smoke:k"],
    }, {
      id: "ar_health_tests",
      label: "AR health unit tests",
      command: "node",
      args: [
        "--test",
        "desktop/services/extensions-host/ecosystemHealth.test.js",
        "desktop/services/debug/adapterHealth.test.js",
        "desktop/services/llm/providerHealth.test.js",
        "desktop/services/goalScheduler/stabilityHealth.test.js",
        "scripts/ar-health.test.js",
      ],
    }, {
      id: "ar_performance_baseline",
      label: "AR performance baseline",
      command: "node",
      args: ["scripts/ar-health.js", `--report-dir=${reportDir}`],
    }, {
      id: "packaging_preflight",
      label: "Windows packaging preflight",
      command: "node",
      args: ["scripts/packaging-preflight.js", `--report-dir=${reportDir}`],
    })
  }
  if (options.productGrade) {
    steps.push({
      id: "workbench_deep_smoke",
      label: "AU Workbench deep smoke",
      command: "npm",
      args: ["run", "smoke:workbench:deep", "--", `--report-dir=${reportDir}`],
    }, {
      id: "ax8_task_language_smoke",
      label: "AX8 multi-language task/problem matcher smoke",
      command: "npx",
      args: [
        "vitest",
        "run",
        "src/workbench/taskLanguageSmoke.test.ts",
        "src/workbench/problemMatcher.test.ts",
      ],
      cwd: path.join(root, "frontend", "vite-project"),
    }, {
      id: "ax9_debug_adapter_smoke",
      label: "AX9 debug adapter smoke",
      command: "npm",
      args: ["run", "smoke:debug-adapter", "--", `--report-dir=${reportDir}`],
    }, {
      id: "product_grade_release_evidence",
      label: "AU product-grade release evidence tests",
      command: "node",
      args: [
        "--test",
        "scripts/workbench-deep-smoke.test.js",
        "scripts/au-product-grade-gate.test.js",
        "desktop/services/agentLoop/releaseEvidenceExport.test.js",
      ],
    }, {
      id: "product_grade_release_evidence_export",
      label: "AU product-grade release evidence export",
      command: "node",
      args: ["scripts/release-evidence-export.js", `--report-dir=${reportDir}`, "--current-release-gate-mode=product-grade"],
    }, {
      id: "au_product_grade_gate",
      label: "AU product-grade gate",
      command: "npm",
      args: ["run", "au:product-grade", "--", `--report-dir=${reportDir}`, "--current-release-gate-mode=product-grade"],
    })
  }
  if (options.publicCandidate) {
    steps.push({
      id: "real_project_smoke",
      label: "AY real project acceptance matrix",
      command: "npm",
      args: ["run", "smoke:real-project", "--", `--report-dir=${reportDir}`, "--task-set=standard"],
    }, {
      id: "ar_health",
      label: "AY AR health evidence",
      command: "node",
      args: ["scripts/ar-health.js", `--report-dir=${reportDir}`],
    }, {
      id: "packaging_preflight",
      label: "AY Windows packaging preflight",
      command: "node",
      args: ["scripts/packaging-preflight.js", `--report-dir=${reportDir}`],
    }, {
      id: "workbench_deep_smoke",
      label: "AY Workbench deep smoke",
      command: "npm",
      args: ["run", "smoke:workbench:deep", "--", `--report-dir=${reportDir}`],
    }, {
      id: "ax8_task_language_smoke",
      label: "AY multi-language task/problem matcher smoke",
      command: "npx",
      args: [
        "vitest",
        "run",
        "src/workbench/taskLanguageSmoke.test.ts",
        "src/workbench/problemMatcher.test.ts",
      ],
      cwd: path.join(root, "frontend", "vite-project"),
    }, {
      id: "ax9_debug_adapter_smoke",
      label: "AY debug adapter smoke",
      command: "npm",
      args: ["run", "smoke:debug-adapter", "--", `--report-dir=${reportDir}`],
    }, {
      id: "sandbox_security_evidence",
      label: "AY sandbox security evidence",
      command: "node",
      args: ["scripts/sandbox-security-evidence-smoke.js", `--report-dir=${reportDir}`],
    }, {
      id: "release_gate_current_snapshot",
      label: "AY current release gate upstream snapshot",
      command: "node",
      args: ["scripts/release-gate-current-snapshot.js", `--report-dir=${reportDir}`, "--mode=public-candidate-upstream"],
    }, {
      id: "release_evidence_pre_au",
      label: "AY release evidence before AU/AX",
      command: "node",
      args: ["scripts/release-evidence-export.js", `--report-dir=${reportDir}`, "--current-release-gate-mode=public-candidate-upstream"],
    }, {
      id: "au_product_grade_gate",
      label: "AY AU product-grade gate",
      command: "npm",
      args: ["run", "au:product-grade", "--", `--report-dir=${reportDir}`, "--current-release-gate-mode=product-grade"],
    }, {
      id: "ax_enterprise_gap_gate",
      label: "AY AX enterprise gap gate",
      command: "npm",
      args: ["run", "ax:enterprise-gap", "--", `--report-dir=${reportDir}`],
    }, {
      id: "at_preflight",
      label: "AY release candidate preflight",
      command: "npm",
      args: ["run", "at:preflight", "--", `--report-dir=${reportDir}`],
    }, {
      id: "source_deploy_doctor",
      label: "AY source deploy doctor",
      command: "npm",
      args: ["run", "doctor", "--", `--report-dir=${reportDir}`],
    }, {
      id: "at_package_artifacts",
      label: "AY package artifact evidence",
      command: "node",
      args: ["scripts/at3-package-artifacts-check.js", `--report-dir=${reportDir}`],
    }, {
      id: "at_install_smoke",
      label: "AY install smoke contract",
      command: "node",
      args: ["scripts/at4-install-smoke.js", `--report-dir=${reportDir}`],
    }, {
      id: "packaged_app_smoke",
      label: "AY packaged app launch smoke",
      command: "npm",
      args: ["run", "smoke:packaged:report", "--", `--report-dir=${reportDir}`],
    }, {
      id: "packaged_multi_agent_smoke",
      label: "AY packaged multi-agent smoke",
      command: "npm",
      args: ["run", "smoke:packaged:multi-agent", "--", `--report-dir=${reportDir}`],
    }, {
      id: "at_functional_smoke",
      label: "AY functional smoke contract",
      command: "node",
      args: ["scripts/at5-functional-smoke.js", `--report-dir=${reportDir}`],
    }, {
      id: "at_release_candidate_evidence",
      label: "AY release candidate evidence",
      command: "node",
      args: ["scripts/at6-release-candidate-evidence.js", `--report-dir=${reportDir}`],
    }, {
      id: "at_release_candidate_runbook",
      label: "AY release candidate runbook",
      command: "node",
      args: ["scripts/at7-release-candidate-runbook.js", `--report-dir=${reportDir}`],
    }, {
      id: "release_evidence",
      label: "AY release evidence",
      command: "node",
      args: ["scripts/release-evidence-export.js", `--report-dir=${reportDir}`, "--current-release-gate-mode=public-candidate-upstream"],
    }, {
      id: "ay_public_candidate_tests",
      label: "AY public candidate gate tests",
      command: "node",
      args: ["--test", "scripts/ay-public-candidate-gate.test.js", "scripts/source-deploy-doctor.test.js"],
    }, {
      id: "ay_public_candidate_gate",
      label: "AY public candidate gate",
      command: "npm",
      args: ["run", "ay:public-candidate", "--", `--report-dir=${reportDir}`, "--skip-refresh"],
    })
  }
  if (options.openSourceCandidate) {
    steps.push({
      id: "ba_clean_clone_doctor",
      label: "BA clean clone source deploy doctor",
      command: "npm",
      args: ["run", "doctor", "--", "--clean-clone", `--report-dir=${reportDir}`],
    }, {
      id: "ba_open_source_readiness",
      label: "BA open-source readiness",
      command: "npm",
      args: ["run", "ba:open-source-readiness", "--", `--report-dir=${reportDir}`],
    }, {
      id: "ba_ci_readiness",
      label: "BA GitHub Actions CI readiness",
      command: "npm",
      args: ["run", "release:ci:check", "--", `--report-dir=${reportDir}`],
    }, {
      id: "ba_cross_platform_package_plan",
      label: "BA cross-platform package plan",
      command: "npm",
      args: ["run", "ba:cross-platform-package-plan", "--", `--report-dir=${reportDir}`],
    }, {
      id: "ba_release_draft",
      label: "BA release draft",
      command: "npm",
      args: ["run", "ba:release-draft", "--", `--report-dir=${reportDir}`, "--gate-in-progress"],
    }, {
      id: "ba_beta_trial_plan",
      label: "BA beta trial plan",
      command: "npm",
      args: ["run", "ba:beta-trial", "--", `--report-dir=${reportDir}`],
    }, {
      id: "extension_marketplace_smoke",
      label: "Extension marketplace details smoke",
      command: "npm",
      args: ["run", "extension:marketplace-smoke", "--", `--report-dir=${reportDir}`],
    }, {
      id: "extension_install_smoke",
      label: "Extension install lifecycle smoke",
      command: "npm",
      args: ["run", "extension:install-smoke", "--", `--report-dir=${reportDir}`],
    }, {
      id: "extension_migration_smoke",
      label: "Extension migration dry-run smoke",
      command: "npm",
      args: ["run", "extension:migration-smoke", "--", "--source=cursor", "--dry-run", `--report-dir=${reportDir}`],
    }, {
      id: "extension_security_smoke",
      label: "Extension security and governance smoke",
      command: "npm",
      args: ["run", "extension:security-smoke", "--", `--report-dir=${reportDir}`],
    }, {
      id: "eh_memento_storage_e2e",
      label: "Extension Host memento storage E2E",
      command: "npm",
      args: ["run", "eh:e2e", "--", "--memento-storage", "--timeout=18000", `--report-dir=${reportDir}`],
    }, {
      id: "eh_extension_context_e2e",
      label: "Extension Host ExtensionContext E2E",
      command: "npm",
      args: ["run", "eh:e2e", "--", "--extension-context", "--timeout=18000", `--report-dir=${reportDir}`],
    }, {
      id: "eh_implicit_activation_e2e",
      label: "Extension Host implicit activation E2E",
      command: "npm",
      args: ["run", "eh:e2e", "--", "--implicit-activation", "--timeout=18000", `--report-dir=${reportDir}`],
    }, {
      id: "eh_dependency_loop_e2e",
      label: "Extension Host dependency loop E2E",
      command: "npm",
      args: ["run", "eh:e2e", "--", "--dependency-loop", "--timeout=18000", `--report-dir=${reportDir}`],
    }, {
      id: "eh_search_provider_e2e",
      label: "Extension Host SearchProvider E2E",
      command: "npm",
      args: ["run", "eh:e2e", "--", "--search-provider", "--timeout=18000", `--report-dir=${reportDir}`],
    }, {
      id: "eh_profile_content_handler_e2e",
      label: "Extension Host ProfileContentHandler E2E",
      command: "npm",
      args: ["run", "eh:e2e", "--", "--profile-content-handler", "--timeout=18000", `--report-dir=${reportDir}`],
    }, {
      id: "extension_compatibility_matrix",
      label: "Extension Top 100 compatibility matrix",
      command: "npm",
      args: ["run", "extension:compatibility-matrix", "--", "--top=100", `--report-dir=${reportDir}`],
    }, {
      id: "extension_enterprise_gate",
      label: "Extension enterprise compatibility gate",
      command: "npm",
      args: ["run", "extension:enterprise-gate", "--", `--report-dir=${reportDir}`],
    }, {
      id: "ba_open_source_candidate_tests",
      label: "BA open-source candidate tests",
      command: "node",
      args: [
        "--test",
        "scripts/source-deploy-doctor.test.js",
        "scripts/open-source-readiness.test.js",
        "scripts/cross-platform-package-plan.test.js",
        "scripts/release-draft.test.js",
        "scripts/beta-trial-plan.test.js",
        "scripts/open-source-candidate-gate.test.js",
      ],
    }, {
      id: "ba_open_source_candidate_gate",
      label: "BA open-source candidate gate",
      command: "npm",
      args: ["run", "ba:open-source-candidate", "--", `--report-dir=${reportDir}`],
    })
  }
  return steps
}

function runStep(step, runner = spawnSync) {
  const startedAt = Date.now()
  const args = typeof step.resolveArgs === "function" ? step.resolveArgs() : step.args
  const result = runner(step.command, args, {
    cwd: step.cwd || root,
    shell: process.platform === "win32",
    stdio: "inherit",
  })
  const exitCode = typeof result.status === "number"
    ? result.status
    : result.error
      ? 1
      : 0
  return {
    id: step.id,
    label: step.label,
    command: [step.command, ...args].join(" "),
    cwd: step.cwd || root,
    exitCode,
    passed: exitCode === 0,
    durationMs: Date.now() - startedAt,
    error: result.error ? String(result.error.message || result.error) : "",
  }
}

function saveReport(report, reportDir) {
  fs.mkdirSync(reportDir, { recursive: true })
  const jsonPath = path.join(reportDir, "release-gate-latest.json")
  const normalized = { ...report, jsonPath }
  fs.writeFileSync(jsonPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  return jsonPath
}

function readLatestReport(options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  const jsonPath = path.join(reportDir, "release-gate-latest.json")
  if (!fs.existsSync(jsonPath)) {
    return {
      report: null,
      jsonPath,
    }
  }
  const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"))
  return {
    report: {
      ...report,
      jsonPath: report.jsonPath || jsonPath,
    },
    jsonPath,
  }
}

async function runReleaseGate(options = {}, runner = spawnSync) {
  const startedAt = Date.now()
  const steps = []
  const planned = makeSteps(options)
  for (const step of planned) {
    if (step.id === "ba_release_draft") {
      const passedStepIds = steps.filter((item) => item.passed).map((item) => item.id)
      step.resolveArgs = () => [...step.args, `--passed-step-ids=${passedStepIds.join(",")}`]
    }
    const result = runStep(step, runner)
    steps.push(result)
    if (!result.passed) break
  }
  const report = {
    createdAt: Date.now(),
    mode: options.openSourceCandidate ? "open-source-candidate" : options.publicCandidate ? "public-candidate" : options.productGrade ? "product-grade" : options.full ? "full" : options.includeBuild ? "build" : "quick",
    ready: steps.length === planned.length && steps.every((step) => step.passed),
    durationMs: Date.now() - startedAt,
    plannedSteps: planned.map((step) => step.id),
    steps,
    warnings: [
      {
        id: "electron_smoke_full_mode",
        severity: "info",
        note: "Electron 登录态 smoke 仅在 --full 模式运行。",
      },
    ],
  }
  if (!options.noWrite) {
    report.jsonPath = saveReport(report, options.reportDir || defaultReportDir())
  }
  return report
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = await runReleaseGate(options)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err?.stack || err}\n`)
    process.exit(1)
  })
}

module.exports = {
  defaultReportDir,
  makeSteps,
  parseArgs,
  readLatestReport,
  runReleaseGate,
  runStep,
  saveReport,
}
