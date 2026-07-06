#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const root = path.resolve(__dirname, "..")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function resolveReportDir(reportDir) {
  if (!reportDir) return defaultReportDir()
  return path.isAbsolute(reportDir) ? reportDir : path.resolve(root, reportDir)
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  return {
    noWrite: argv.includes("--no-write"),
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
  }
}

function sleep(ms) {
  const normalized = Number(ms || 0)
  if (!Number.isFinite(normalized) || normalized <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, normalized))
}

function makeSteps(options = {}) {
  const reportDir = resolveReportDir(options.reportDir)
  const frontendRoot = path.join(root, "frontend", "vite-project")
  return [
    {
      id: "typecheck",
      label: "前端类型检查",
      command: "npm",
      args: ["run", "typecheck"],
    },
    {
      id: "frontend_build",
      label: "前端生产构建",
      command: "npm",
      args: ["run", "build:frontend"],
    },
    {
      id: "desktop_node_tests",
      label: "桌面端 Node 测试：搜索、大文件读取和 Agent 文件锁",
      command: "node",
      args: [
        "--test",
        "desktop/services/search/index.test.js",
        "desktop/services/languageServices/index.test.js",
        "desktop/services/workspace/largeFileReader.test.js",
        "desktop/services/agentLoop/planExecutor.test.js",
        "scripts/workbench-visual-baseline-smoke.test.js",
      ],
    },
    {
      id: "p0_workbench_unit_tests",
      label: "P0 Workbench 编辑器/搜索/Explorer 单元测试",
      command: "npx",
      args: [
        "vitest",
        "run",
        "src/languages/refactor/refactorProvider.test.ts",
        "src/composables/useWorkspaceSearch.test.ts",
        "src/workbench/searchFileActions.test.ts",
        "src/workbench/tabDisplay.test.ts",
        "src/workbench/fileIconResolver.test.ts",
        "src/workbench/navigationService.test.ts",
        "src/workbench/navigationActions.test.ts",
        "src/workbench/editorGroups.test.ts",
        "src/workbench/editorGroupPersistence.test.ts",
        "src/workbench/editorGroupLayoutPersistence.test.ts",
        "src/workbench/editorInstanceLifecycle.test.ts",
        "src/workbench/editorModelLifecycle.test.ts",
        "src/workbench/largeFileWindowNavigator.test.ts",
        "src/workbench/splitEditorLifecycle.test.ts",
        "src/workbench/tabLifecycle.test.ts",
        "src/workbench/workbenchResourceLifecycle.test.ts",
        "src/workspace/largeFilePolicy.test.ts",
        "src/workspace/manager.test.ts",
        "src/workbench/createTarget.test.ts",
        "src/workbench/fileActions.test.ts",
        "src/explorer/tree/ExplorerTreeHost.test.ts",
      ],
      cwd: frontendRoot,
    },
    {
      id: "workspace_file_operation_unit_tests",
      label: "WorkspaceEdit/FileOperation 真实操作单元测试",
      command: "npx",
      args: [
        "vitest",
        "run",
        "src/workspace/fileOperations.test.ts",
        "src/workspace/changeHistory.test.ts",
        "src/workspace/changeQueue.test.ts",
        "src/workbench/fileOperationEventBridge.test.ts",
        "src/workbench/fileOperationWorkspaceRefresh.test.ts",
        "src/workbench/editorInlineDiffLifecycle.test.ts",
      ],
      cwd: frontendRoot,
    },
    {
      id: "p1_workbench_core_unit_tests",
      label: "P1 Workbench 命令/菜单/快捷键/设置/Profile 测试",
      command: "npx",
      args: [
        "vitest",
        "run",
        "src/workbench/keybindingCommands.test.ts",
        "src/workbench/commandRegistry.test.ts",
        "src/workbench/contextKeys.test.ts",
        "src/workbench/viewRegistry.test.ts",
        "src/workbench/menuActions.test.ts",
        "src/components/menuModel.test.ts",
        "src/keybindings.test.ts",
        "src/components/KeybindingSettings.test.ts",
        "src/settings/settingsStore.test.ts",
        "src/settings/keybindingsJson.test.ts",
        "src/settings/keybindingsFileClient.test.ts",
        "src/settings/profileStore.test.ts",
        "src/settings/settingsRuntimeIntegration.test.ts",
        "src/settings/vscodeImportClient.test.ts",
      ],
      cwd: frontendRoot,
    },
    {
      id: "user_visible_i18n_audit",
      label: "用户可见中文阻断文案审计",
      command: "npm",
      args: ["run", "audit:user-visible-i18n"],
    },
    {
      id: "large_file_enterprise_smoke",
      label: "大文件分段编辑和流式搜索企业级 smoke",
      command: "npm",
      args: ["run", "smoke:workbench:large-file-enterprise"],
    },
    {
      id: "workbench_deep_smoke",
      label: "Workbench 深水区 smoke",
      command: "npm",
      args: ["run", "smoke:workbench:deep", "--", `--report-dir=${reportDir}`],
    },
    {
      id: "agent_change_safety_smoke",
      label: "Agent 待处理变更和回滚安全 smoke",
      command: "npm",
      args: ["run", "smoke:agent-change-safety", "--", `--report-dir=${reportDir}`],
    },
    {
      id: "explorer_performance_smoke",
      label: "Explorer 性能 smoke",
      command: "npm",
      args: ["run", "smoke:workbench:explorer-performance", "--", `--report-dir=${reportDir}`],
    },
    {
      id: "explorer_electron_smoke",
      label: "Electron Explorer 性能 smoke",
      command: "npm",
      args: ["run", "smoke:workbench:explorer-electron"],
      env: { CODEK_ELECTRON_SMOKE_TIMEOUT_MS: "120000" },
      smokeResultName: "explorer-performance",
      maxRetries: 1,
      retryOnTimeout: true,
      cooldownBeforeMs: 2500,
    },
    {
      id: "explorer_fs_parity",
      label: "Explorer 真实目录条目数差异证据",
      command: "node",
      args: [
        "scripts/explorer-fs-parity.js",
        "--project=D:\\Workspace",
        "--dir=.",
        "--dir=frontend",
        "--dir=frontend\\vite-project",
        "--dir=scripts",
        `--report-dir=${reportDir}`,
      ],
    },
    {
      id: "file_operation_visibility_electron_smoke",
      label: "Electron Agent FileOperation 可见性 smoke",
      command: "npm",
      args: ["run", "smoke:workbench:file-operation-visibility"],
      env: { CODEK_ELECTRON_SMOKE_TIMEOUT_MS: "120000" },
      smokeResultName: "file-operation-visibility",
      maxRetries: 1,
      retryOnTimeout: true,
      cooldownBeforeMs: 2500,
    },
    {
      id: "search_replace_electron_smoke",
      label: "Electron 搜索替换单个/全部 smoke",
      command: "npm",
      args: ["run", "smoke:workbench:search-replace"],
      env: { CODEK_ELECTRON_SMOKE_TIMEOUT_MS: "120000" },
      smokeResultName: "search-replace",
      maxRetries: 1,
      retryOnTimeout: true,
      cooldownBeforeMs: 2500,
    },
    {
      id: "search_navigation_electron_smoke",
      label: "Electron 搜索跳转非空编辑器 smoke",
      command: "npm",
      args: ["run", "smoke:workbench:search-navigation"],
      env: { CODEK_ELECTRON_SMOKE_TIMEOUT_MS: "120000" },
      smokeResultName: "search-navigation",
      maxRetries: 1,
      retryOnTimeout: true,
      cooldownBeforeMs: 2500,
    },
    {
      id: "tab_overflow_electron_smoke",
      label: "Electron Tab 溢出文件名可读 smoke",
      command: "npm",
      args: ["run", "smoke:workbench:tab-overflow"],
      env: { CODEK_ELECTRON_SMOKE_TIMEOUT_MS: "240000" },
      smokeResultName: "tab-overflow",
      maxRetries: 1,
      retryOnTimeout: true,
      cooldownBeforeMs: 2500,
    },
    {
      id: "icon_visual_state_electron_smoke",
      label: "Electron Explorer/Tab/File 图标视觉状态 smoke",
      command: "npm",
      args: ["run", "smoke:workbench:icon-visual-state"],
      env: { CODEK_ELECTRON_SMOKE_TIMEOUT_MS: "120000" },
      smokeResultName: "icon-visual-state",
      maxRetries: 1,
      retryOnTimeout: true,
      cooldownBeforeMs: 2500,
    },
    {
      id: "real_project_ui_electron_smoke",
      label: "Electron 真实 D:\\Workspace 项目 UI smoke",
      command: "npm",
      args: ["run", "smoke:workbench:real-project-ui"],
      env: { CODEK_ELECTRON_SMOKE_TIMEOUT_MS: "240000" },
      smokeResultName: "real-project-ui",
      maxRetries: 1,
      retryOnTimeout: true,
      cooldownBeforeMs: 2500,
    },
    {
      id: "visual_baseline_electron_smoke",
      label: "Electron Workbench 视觉基线截图 smoke",
      command: "npm",
      args: ["run", "smoke:workbench:visual-baseline"],
      env: { CODEK_ELECTRON_SMOKE_TIMEOUT_MS: "240000" },
      smokeResultName: "visual-baseline",
      maxRetries: 1,
      retryOnTimeout: true,
      cooldownBeforeMs: 2500,
    },
    {
      id: "multiroot_create_target_electron_smoke",
      label: "Electron 多 root Explorer 新建目标 smoke",
      command: "npm",
      args: ["run", "smoke:workbench:create-target-multiroot"],
      env: { CODEK_ELECTRON_SMOKE_TIMEOUT_MS: "180000" },
      smokeResultName: "multiroot-create-target",
      maxRetries: 1,
      retryOnTimeout: true,
      cooldownBeforeMs: 2500,
    },
    {
      id: "create_target_accuracy_electron_smoke",
      label: "Electron Explorer 新建目标准确性 smoke",
      command: "npm",
      args: ["run", "smoke:workbench:create-target-accuracy"],
      env: { CODEK_ELECTRON_SMOKE_TIMEOUT_MS: "120000" },
      smokeResultName: "create-target-accuracy",
      maxRetries: 1,
      retryOnTimeout: true,
      cooldownBeforeMs: 2500,
    },
    {
      id: "long_task_recovery_smoke",
      label: "长任务暂停/恢复/重开/崩溃恢复 smoke",
      command: "npm",
      args: ["run", "smoke:long-task-recovery", "--", `--report-dir=${reportDir}`],
    },
    {
      id: "shell_integration_smoke",
      label: "终端 Shell 集成 smoke",
      command: "npm",
      args: ["run", "smoke:shell-integration", "--", `--report-dir=${reportDir}`],
    },
    {
      id: "debug_adapter_smoke",
      label: "调试适配器 DAP fixture 和环境 smoke",
      command: "npm",
      args: ["run", "smoke:debug-adapter", "--", `--report-dir=${reportDir}`],
    },
    {
      id: "multi_agent_conflict_smoke",
      label: "多 Agent 冲突和隔离真实运行 smoke",
      command: "node",
      args: ["--test", "desktop/services/agentLoop/evals/realRunComparison.test.js"],
    },
    {
      id: "router_calibration_smoke",
      label: "任务路由 100+ 样本校准 smoke",
      command: "npm",
      args: ["run", "smoke:router-calibration", "--", `--report-dir=${reportDir}`, "--min-samples=100"],
    },
    {
      id: "real_project_quick_matrix",
      label: "真实项目快速验收矩阵",
      command: "npm",
      args: ["run", "smoke:real-project", "--", `--report-dir=${reportDir}`, "--task-set=standard"],
    },
    {
      id: "extension_enterprise_baseline",
      label: "扩展市场企业级基线",
      command: "node",
      args: ["scripts/extension-baseline.js", `--report-dir=${reportDir}`],
    },
    {
      id: "extension_ecosystem_health",
      label: "扩展生态健康报告",
      command: "node",
      args: ["scripts/ar-health.js", `--report-dir=${reportDir}`],
    },
    {
      id: "extension_marketplace_smoke",
      label: "扩展市场详情 smoke",
      command: "node",
      args: ["scripts/extension-marketplace-smoke.js", `--report-dir=${reportDir}`],
    },
    {
      id: "extension_install_smoke",
      label: "扩展安装生命周期 smoke",
      command: "node",
      args: ["scripts/extension-install-smoke.js", `--report-dir=${reportDir}`],
    },
    {
      id: "extension_marketplace_install_matrix",
      label: "扩展 marketplace Top 100 隔离安装矩阵",
      command: "node",
      args: ["scripts/extension-marketplace-install-matrix.js", "--top=100", `--report-dir=${reportDir}`],
    },
    {
      id: "extension_migration_smoke",
      label: "VS Code/Cursor 扩展迁移 dry-run smoke",
      command: "node",
      args: ["scripts/extension-migration-smoke.js", "--source=cursor", "--dry-run", `--report-dir=${reportDir}`],
    },
    {
      id: "extension_security_smoke",
      label: "扩展安全和治理 smoke",
      command: "node",
      args: ["scripts/extension-security-smoke.js", `--report-dir=${reportDir}`],
    },
    {
      id: "eh_memento_storage_e2e",
      label: "Extension Host memento storage E2E",
      command: "node",
      args: ["scripts/eh-e2e.js", "--memento-storage", "--timeout=18000", `--report-dir=${reportDir}`],
    },
    {
      id: "eh_extension_context_e2e",
      label: "Extension Host ExtensionContext E2E",
      command: "node",
      args: ["scripts/eh-e2e.js", "--extension-context", "--timeout=18000", `--report-dir=${reportDir}`],
    },
    {
      id: "eh_implicit_activation_e2e",
      label: "Extension Host implicit activation E2E",
      command: "node",
      args: ["scripts/eh-e2e.js", "--implicit-activation", "--timeout=18000", `--report-dir=${reportDir}`],
    },
    {
      id: "eh_dependency_loop_e2e",
      label: "Extension Host dependency loop E2E",
      command: "node",
      args: ["scripts/eh-e2e.js", "--dependency-loop", "--timeout=18000", `--report-dir=${reportDir}`],
    },
    {
      id: "eh_search_provider_e2e",
      label: "Extension Host SearchProvider E2E",
      command: "node",
      args: ["scripts/eh-e2e.js", "--search-provider", "--timeout=18000", `--report-dir=${reportDir}`],
    },
    {
      id: "eh_profile_content_handler_e2e",
      label: "Extension Host ProfileContentHandler E2E",
      command: "node",
      args: ["scripts/eh-e2e.js", "--profile-content-handler", "--timeout=18000", `--report-dir=${reportDir}`],
    },
    {
      id: "installed_mcp_discovery_smoke",
      label: "Installed MCP discovery smoke",
      command: "node",
      args: ["scripts/installed-mcp-discovery-smoke.js", `--report-dir=${reportDir}`],
    },
    {
      id: "mcp_gallery_management_smoke",
      label: "MCP Gallery management smoke",
      command: "node",
      args: ["scripts/mcp-gallery-management-smoke.js", `--report-dir=${reportDir}`],
    },
    {
      id: "eh_mcp_provider_bridge",
      label: "Extension Host MCP provider bridge smoke",
      command: "node",
      args: ["scripts/mcp-provider-bridge-smoke.js", `--report-dir=${reportDir}`],
    },
    {
      id: "extension_compatibility_matrix",
      label: "扩展 Top 100 兼容矩阵",
      command: "node",
      args: ["scripts/extension-compatibility-matrix.js", "--top=100", `--report-dir=${reportDir}`],
    },
    {
      id: "extension_enterprise_gate",
      label: "扩展企业级兼容门禁",
      command: "node",
      args: ["scripts/extension-enterprise-gate.js", `--report-dir=${reportDir}`],
    },
    {
      id: "extension_plan_completion_audit",
      label: "扩展计划完成审计",
      command: "node",
      args: ["scripts/extension-plan-completion-audit.js", `--report-dir=${reportDir}`, "--gate-in-progress"],
    },
    {
      id: "enterprise_doc_completion_audit",
      label: "企业级文档完成审计",
      command: "node",
      args: ["scripts/enterprise-doc-completion-audit.js", `--report-dir=${reportDir}`, "--gate-in-progress"],
    },
    {
      id: "release_evidence_export",
      label: "BD 企业级候选发布证据导出",
      command: "node",
      args: ["scripts/release-evidence-export.js", `--report-dir=${reportDir}`, "--current-release-gate-mode=bd-enterprise-candidate"],
    },
  ]
}

function runStep(step, runner = spawnSync) {
  const startedAt = Date.now()
  const result = runner(step.command, step.args, {
    cwd: step.cwd || root,
    env: step.env ? { ...process.env, ...step.env } : process.env,
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
    command: [step.command, ...step.args].join(" "),
    cwd: step.cwd || root,
    exitCode,
    passed: exitCode === 0,
    durationMs: Date.now() - startedAt,
    error: result.error ? String(result.error.message || result.error) : "",
  }
}

function runStepAttempt(step, attemptNumber, options = {}, runner = spawnSync) {
  const reportDir = resolveReportDir(options.reportDir)
  const attemptStep = { ...step }
  if (step.smokeResultName) {
    const attemptResultFile = path.join(reportDir, `electron-smoke-${step.smokeResultName}-bd-try-${attemptNumber}.json`)
    try {
      fs.mkdirSync(path.dirname(attemptResultFile), { recursive: true })
      fs.rmSync(attemptResultFile, { force: true })
    } catch {
      // 诊断文件清理失败不应阻断真实 smoke 执行。
    }
    attemptStep.env = {
      ...(step.env || {}),
      CODEK_ELECTRON_SMOKE_RESULT_FILE: attemptResultFile,
    }
    attemptStep.smokeAttemptResultFile = attemptResultFile
  }
  const result = runStep(attemptStep, runner)
  const smokeResult = readSmokeAttemptResult(attemptStep.smokeAttemptResultFile)
  const smokeEvidenceError = validateSmokeEvidence(step, result, smokeResult)
  const normalizedResult = smokeEvidenceError
    ? {
        ...result,
        exitCode: result.exitCode || 1,
        passed: false,
        error: result.error ? `${result.error}; ${smokeEvidenceError}` : smokeEvidenceError,
      }
    : result
  if (!options.noWrite && attemptStep.smokeAttemptResultFile && step.smokeResultName && smokeResult) {
    copyLatestSmokeResult(reportDir, step.smokeResultName, smokeResult)
  }
  const retryable = Boolean(!normalizedResult.passed && step.retryOnTimeout && isSmokeTimeout(normalizedResult, smokeResult))
  return {
    ...normalizedResult,
    attempt: attemptNumber,
    retryable,
    smokeResultFile: attemptStep.smokeAttemptResultFile || "",
    smokeResult,
  }
}

async function runStepWithPolicy(step, options = {}, runner = spawnSync) {
  await sleep(options.electronCooldownMs ?? step.cooldownBeforeMs)
  const maxRetries = Number(step.maxRetries || 0)
  const attempts = []
  for (let index = 0; index <= maxRetries; index += 1) {
    if (index > 0) await sleep(options.retryDelayMs ?? step.retryDelayMs ?? 2500)
    const attempt = runStepAttempt(step, index + 1, options, runner)
    attempts.push(attempt)
    if (attempt.passed || !attempt.retryable || index >= maxRetries) {
      const final = {
        ...attempt,
        retryCount: attempts.length - 1,
        attempts,
        durationMs: attempts.reduce((total, item) => total + Number(item.durationMs || 0), 0),
      }
      delete final.attempt
      delete final.retryable
      delete final.smokeResult
      delete final.smokeResultFile
      await sleep(isElectronSmokeStep(step) ? options.electronCooldownMs ?? step.electronCooldownMs ?? 750 : 0)
      return final
    }
  }
  return attempts[attempts.length - 1]
}

function readSmokeAttemptResult(resultFile) {
  if (!resultFile || !fs.existsSync(resultFile)) return null
  try {
    return JSON.parse(fs.readFileSync(resultFile, "utf8"))
  } catch (error) {
    return { ok: false, error: `smoke 结果文件解析失败: ${String(error?.message || error)}` }
  }
}

function validateSmokeEvidence(step, result, smokeResult) {
  if (!step?.smokeResultName || !result?.passed) return ""
  if (!smokeResult) return "Electron smoke 没有写入诊断结果文件，不能作为企业级 UI 证据。"
  if (smokeResult.ok !== true) return "Electron smoke 诊断结果不是通过状态，不能作为企业级 UI 证据。"
  if (!Array.isArray(smokeResult.checks) || smokeResult.checks.length === 0) {
    return "Electron smoke 诊断结果没有任何检查项，疑似空壳证据，不能作为企业级 UI 证据。"
  }
  if (smokeResult.checks.some((check) => check?.passed === false)) {
    return "Electron smoke 诊断结果包含失败检查项，不能作为企业级 UI 证据。"
  }
  return ""
}

function copyLatestSmokeResult(reportDir, smokeResultName, smokeResult) {
  try {
    const latestPath = path.join(reportDir, `electron-smoke-${smokeResultName}-latest-result.json`)
    fs.mkdirSync(path.dirname(latestPath), { recursive: true })
    fs.writeFileSync(latestPath, `${JSON.stringify(smokeResult, null, 2)}\n`, "utf8")
  } catch {
    // 最新 smoke 诊断文件只服务审计，不影响当前步骤的真实退出码。
  }
}

function isElectronSmokeStep(step) {
  return /_electron_smoke$/.test(String(step?.id || ""))
}

function isSmokeTimeout(stepResult, smokeResult) {
  const values = [
    stepResult?.error,
    smokeResult?.error,
    smokeResult?.stage?.error,
    smokeResult?.lastStage?.error,
  ].filter(Boolean)
  return values.some((value) => /timeout|超时/i.test(String(value)))
}

function markdownReport(report) {
  const lines = [
    "# BD 企业级候选门禁",
    "",
    `- 就绪: ${report.ready ? "是" : "否"}`,
    `- 当前状态: ${formatGateStatus(report.status)}`,
    `- 生成时间: ${new Date(report.createdAt).toISOString()}`,
    `- 总耗时: ${report.durationMs}ms`,
    "",
    "## 执行步骤",
    "",
    "| 步骤 ID | 步骤名称 | 状态 | 耗时 | 命令 |",
    "| --- | --- | --- | ---: | --- |",
    ...report.steps.map((step) => `| ${escapeCell(step.id)} | ${escapeCell(step.label || step.id)} | ${step.passed ? "通过" : "失败"} | ${step.durationMs}ms | \`${String(step.command || "").replace(/`/g, "'")}\` |`),
    "",
  ]
  const retrySteps = report.steps.filter((step) => Array.isArray(step.attempts) && step.attempts.some((attempt) => attempt.attempt > 1 || attempt.smokeResult))
  if (retrySteps.length > 0) {
    lines.push(
      "## 重试诊断",
      "",
      "| 步骤 ID | 尝试 | 状态 | 可重试 | 错误 | 最后阶段 | 结果文件 |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...retrySteps.flatMap((step) => step.attempts.map((attempt) => `| ${escapeCell(step.id)} | 第 ${attempt.attempt} 次 | ${attempt.passed ? "通过" : "失败"} | ${attempt.retryable ? "是" : "否"} | ${escapeCell(formatSmokeError(attempt.smokeResult?.error || attempt.error))} | ${escapeCell(formatSmokeStage(attempt.smokeResult))} | ${escapeCell(attempt.smokeResultFile)} |`)),
      "",
    )
  }
  if (report.missingSteps.length > 0) {
    lines.push("## 未执行步骤", "", ...report.missingSteps.map((step) => `- ${step}`), "")
  }
  if (Array.isArray(report.warnings) && report.warnings.length > 0) {
    lines.push(
      "## 人工验收提示",
      "",
      "| 提示 | 严重度 | 说明 |",
      "| --- | --- | --- |",
      ...report.warnings.map((warning) => `| ${escapeCell(warning.id)} | ${formatSeverity(warning.severity)} | ${escapeCell(warning.note)} |`),
      "",
    )
  }
  return `${lines.join("\n")}\n`
}

function formatGateStatus(status) {
  if (status === "ready") return "就绪"
  if (status === "blocked") return "已阻断"
  return status || "未知"
}

function formatSeverity(severity) {
  if (severity === "high") return "高"
  if (severity === "medium") return "中"
  if (severity === "low") return "低"
  if (severity === "info") return "信息"
  return severity || "未知"
}

function escapeCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function formatSmokeError(error) {
  const text = String(error || "")
  if (!text) return ""
  if (/timeout/i.test(text)) return "超时"
  return text
}

function formatSmokeStage(smokeResult) {
  if (!smokeResult) return ""
  if (smokeResult.stage && typeof smokeResult.stage === "object") {
    for (const value of Object.values(smokeResult.stage)) {
      if (value && typeof value === "object" && typeof value.stage === "string") return value.stage
    }
  }
  const directStage = smokeResult.lastStage || smokeResult.stage
  if (directStage) {
    if (typeof directStage === "string") return directStage
    if (directStage.stage) return directStage.stage
    if (directStage.main?.stage) return directStage.main.stage
    for (const value of Object.values(directStage)) {
      if (value && typeof value === "object" && typeof value.stage === "string") return value.stage
    }
  }
  const stages = Array.isArray(smokeResult.stages) ? smokeResult.stages : []
  const last = stages[stages.length - 1]
  return last?.stage || ""
}

function saveReport(report, reportDir) {
  reportDir = resolveReportDir(reportDir)
  fs.mkdirSync(reportDir, { recursive: true })
  const stamp = new Date(report.createdAt).toISOString().replace(/[:.]/g, "-")
  const jsonPath = path.join(reportDir, `bd-enterprise-candidate-${stamp}.json`)
  const markdownPath = path.join(reportDir, `bd-enterprise-candidate-${stamp}.md`)
  const latestJsonPath = path.join(reportDir, "bd-enterprise-candidate-latest.json")
  const latestMarkdownPath = path.join(reportDir, "bd-enterprise-candidate-latest.md")
  const normalized = {
    ...report,
    jsonPath,
    markdownPath,
    latestJsonPath,
    latestMarkdownPath,
  }
  fs.writeFileSync(jsonPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  fs.writeFileSync(markdownPath, markdownReport(normalized), "utf8")
  fs.writeFileSync(latestMarkdownPath, markdownReport(normalized), "utf8")
  return { jsonPath, markdownPath, latestJsonPath, latestMarkdownPath }
}

function buildReport({ startedAt, planned, steps, status, error }) {
  const reached = new Set(steps.map((step) => step.id))
  const allPassed = steps.length === planned.length && steps.every((step) => step.passed)
  return {
    reportKind: "bd-enterprise-candidate-gate",
    createdAt: Date.now(),
    ready: allPassed,
    status: status || (allPassed ? "ready" : "blocked"),
    durationMs: Date.now() - startedAt,
    plannedSteps: planned.map((step) => step.id),
    steps,
    missingSteps: planned.map((step) => step.id).filter((id) => !reached.has(id)),
    warnings: [
      {
        id: "manual_real_ui_required",
        severity: "high",
        note: "manual_real_ui_evidence is still required before enterprise completion.",
      },
    ],
    ...(error ? { error } : {}),
  }
}

function saveJsonSnapshot(report, reportDir, fileName) {
  reportDir = resolveReportDir(reportDir)
  fs.mkdirSync(reportDir, { recursive: true })
  const latestJsonPath = path.join(reportDir, fileName)
  const normalized = {
    ...report,
    latestJsonPath,
  }
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  return { latestJsonPath }
}

function saveProgressReport(report, reportDir) {
  return saveJsonSnapshot(report, reportDir, "bd-enterprise-candidate-progress-latest.json")
}

function saveCrashReport(error, options = {}) {
  const startedAt = Date.now()
  const reportDir = resolveReportDir(options.reportDir)
  const planned = makeSteps({ ...options, reportDir })
  const report = buildReport({
    startedAt,
    planned,
    steps: [],
    status: "crashed",
    error: {
      message: String(error?.message || error),
      stack: String(error?.stack || ""),
    },
  })
  return {
    report,
    ...saveJsonSnapshot(report, reportDir, "bd-enterprise-candidate-crash-latest.json"),
  }
}

function readLatestBdEnterpriseCandidate(options = {}) {
  const reportDir = resolveReportDir(options.reportDir)
  const jsonPath = path.join(reportDir, "bd-enterprise-candidate-latest.json")
  if (!fs.existsSync(jsonPath)) return { report: null, jsonPath }
  const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"))
  return { report, jsonPath }
}

async function runBdEnterpriseCandidate(options = {}, runner = spawnSync) {
  const startedAt = Date.now()
  const reportDir = resolveReportDir(options.reportDir)
  const runOptions = {
    ...options,
    reportDir,
  }
  const planned = makeSteps(runOptions)
  const steps = []
  for (const step of planned) {
    const result = await runStepWithPolicy(step, runOptions, runner)
    steps.push(result)
    if (!options.noWrite) {
      const progressComplete = steps.length === planned.length && steps.every((item) => item.passed)
      saveProgressReport(buildReport({
        startedAt,
        planned,
        steps,
        status: progressComplete ? "ready" : result.passed ? "in_progress" : "blocked",
      }), reportDir)
    }
    if (!result.passed) break
  }
  const reached = new Set(steps.map((step) => step.id))
  const report = {
    reportKind: "bd-enterprise-candidate-gate",
    createdAt: Date.now(),
    ready: steps.length === planned.length && steps.every((step) => step.passed),
    status: steps.length === planned.length && steps.every((step) => step.passed) ? "ready" : "blocked",
    durationMs: Date.now() - startedAt,
    plannedSteps: planned.map((step) => step.id),
    steps,
    missingSteps: planned.map((step) => step.id).filter((id) => !reached.has(id)),
    warnings: [
      {
        id: "manual_real_ui_required",
        severity: "high",
        note: "此门禁不能替代用户真实项目中的 Cursor 级主观流畅度人工验收。",
      },
    ],
  }
  if (!options.noWrite) {
    Object.assign(report, saveReport(report, reportDir))
  }
  return report
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = await runBdEnterpriseCandidate(options)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

if (require.main === module) {
  main().catch((error) => {
    try {
      saveCrashReport(error, parseArgs(process.argv.slice(2)))
    } catch {
      // Crash evidence is best-effort; stderr remains the source of truth if this also fails.
    }
    process.stderr.write(`${error?.stack || error}\n`)
    process.exit(1)
  })
}

module.exports = {
  buildReport,
  defaultReportDir,
  makeSteps,
  markdownReport,
  parseArgs,
  readLatestBdEnterpriseCandidate,
  resolveReportDir,
  runBdEnterpriseCandidate,
  runStep,
  runStepWithPolicy,
  saveCrashReport,
  saveProgressReport,
  saveReport,
  validateSmokeEvidence,
}
