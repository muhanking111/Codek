const fs = require("node:fs")
const path = require("node:path")
const { readLatestReleaseEvidenceSummary } = require("../desktop/services/agentLoop/releaseEvidenceExport")
const { readLatestWorkbenchDeepSmoke } = require("./workbench-deep-smoke")
const { readLatestProductGradeGate } = require("./au-product-grade-gate")

const root = path.resolve(__dirname, "..")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  return {
    noWrite: argv.includes("--no-write"),
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
  }
}

function fileExists(relativePath, files) {
  if (files instanceof Set) return files.has(relativePath.replace(/\\/g, "/"))
  return fs.existsSync(path.join(root, relativePath))
}

function evidenceReady(releaseEvidence, key) {
  const item = releaseEvidence?.evidence?.[key]
  return Boolean(item?.available !== false && item?.ready === true)
}

function releaseEvidenceBaseReady(releaseEvidence) {
  if (releaseEvidence?.ready === true) return true
  const gaps = Array.isArray(releaseEvidence?.gaps) ? releaseEvidence.gaps : []
  if (!releaseEvidence || gaps.length === 0) return false
  const blocking = gaps.filter((gap) => gap?.severity !== "low" && gap?.severity !== "info")
  return blocking.length > 0 && blocking.every((gap) => gap?.id === "ax_enterprise_gate")
}

function makeAx(id, title, checks, nextAction, severity = "high") {
  const failed = checks.filter((check) => !check.passed)
  return {
    id,
    title,
    ready: failed.length === 0,
    status: failed.length === 0 ? "ready" : "blocked",
    statusLabel: failed.length === 0 ? "已就绪" : "存在缺口",
    severity,
    checks,
    summary: `${checks.length - failed.length}/${checks.length} checks`,
    nextAction: failed.length === 0 ? "" : nextAction,
  }
}

function requiredFileCheck(id, label, relativePath, files) {
  return {
    id,
    label,
    passed: fileExists(relativePath, files),
    detail: relativePath,
  }
}

function sourceContainsCheck(id, label, relativePath, patterns, files, fileContents) {
  const normalized = relativePath.replace(/\\/g, "/")
  if (!fileExists(normalized, files)) {
    return { id, label, passed: false, detail: `${normalized} missing` }
  }
  let content = ""
  if (fileContents && Object.prototype.hasOwnProperty.call(fileContents, normalized)) {
    content = String(fileContents[normalized] || "")
  } else if (files instanceof Set) {
    return { id, label, passed: true, detail: `${normalized} exists; content checked in real workspace run` }
  } else {
    try {
      content = fs.readFileSync(path.join(root, normalized), "utf8")
    } catch (error) {
      return { id, label, passed: false, detail: `${normalized} unreadable: ${error.message}` }
    }
  }
  const missing = patterns.filter((pattern) => !content.includes(pattern))
  return {
    id,
    label,
    passed: missing.length === 0,
    detail: missing.length ? `${normalized} missing ${missing.join(", ")}` : normalized,
  }
}

function evidenceCheck(id, label, passed, detail = "") {
  return {
    id,
    label,
    passed: Boolean(passed),
    detail,
  }
}

function buildAxEnterpriseGapGate(input = {}) {
  const reportDir = input.reportDir || defaultReportDir()
  const files = input.files
  const releaseEvidence = Object.prototype.hasOwnProperty.call(input, "releaseEvidence")
    ? input.releaseEvidence
    : readLatestReleaseEvidenceSummary({ reportDir }).report
  const workbenchDeep = Object.prototype.hasOwnProperty.call(input, "workbenchDeep")
    ? input.workbenchDeep
    : readLatestWorkbenchDeepSmoke({ reportDir }).report
  const productGradeGate = Object.prototype.hasOwnProperty.call(input, "productGradeGate")
    ? input.productGradeGate
    : readLatestProductGradeGate({ reportDir }).report

  const ax = [
    makeAx("AX1", "Workbench Service / View Registry", [
      requiredFileCheck("view_registry", "View Registry", "frontend/vite-project/src/workbench/viewRegistry.ts", files),
      requiredFileCheck("view_registry_tests", "View Registry tests", "frontend/vite-project/src/workbench/viewRegistry.test.ts", files),
    ], "补齐 ViewContainer / ViewDescriptor / PanelDescriptor 注册和测试。"),
    makeAx("AX2", "VS Code Settings Service", [
      requiredFileCheck("settings_runtime", "Settings runtime tests", "frontend/vite-project/src/settings/settingsRuntimeIntegration.test.ts", files),
      requiredFileCheck("workspace_settings", "Workspace settings", "frontend/vite-project/src/workspace/workspaceSettings.ts", files),
    ], "补齐 default/user/workspace/folder/language/extension default 合并证据。"),
    makeAx("AX3", "Command / Keybindings / Context Keys", [
      requiredFileCheck("command_registry", "Command Registry", "frontend/vite-project/src/workbench/commandRegistry.ts", files),
      requiredFileCheck("command_registry_tests", "Command Registry tests", "frontend/vite-project/src/workbench/commandRegistry.test.ts", files),
      requiredFileCheck("context_keys", "Context Keys", "frontend/vite-project/src/workbench/contextKeys.ts", files),
      requiredFileCheck("context_keys_tests", "Context Keys tests", "frontend/vite-project/src/workbench/contextKeys.test.ts", files),
    ], "补齐命令、when clause、快捷键冲突和导入导出测试。"),
    makeAx("AX4", "Extension Host Contribution Points", [
      requiredFileCheck("contributions", "Workbench contributions", "frontend/vite-project/src/extensions/workbenchContributions.ts", files),
      requiredFileCheck("contributions_tests", "Contribution tests", "frontend/vite-project/src/extensions/workbenchContributions.test.ts", files),
    ], "扩展 contribution points 需覆盖 commands/menus/views/configuration/languages/debug/tasks/snippets/webviews。"),
    makeAx("AX5", "Theme / Product Icon / File Icon Theme", [
      requiredFileCheck("icon_themes", "Icon theme parser", "frontend/vite-project/src/extensions/iconThemes.ts", files),
      requiredFileCheck("icon_themes_tests", "Icon theme tests", "frontend/vite-project/src/extensions/iconThemes.test.ts", files),
    ], "补齐真实 icon theme / color theme fixture 和产品图标映射证据。"),
    makeAx("AX6", "Explorer / Search / FileService", [
      requiredFileCheck("workspace_manager_tests", "Workspace manager tests", "frontend/vite-project/src/workspace/manager.test.ts", files),
      requiredFileCheck("search_service_tests", "SearchService tests", "desktop/services/search/index.test.js", files),
      evidenceCheck("workbench_deep_search", "Workbench deep smoke ready", workbenchDeep?.ready === true, "workbenchDeep.ready"),
    ], "运行 Workbench deep smoke，确认多根、搜索、边界和大工作区保护。"),
    makeAx("AX7", "Editor / Language Feature Registry", [
      requiredFileCheck("language_registry", "Language Registry", "frontend/vite-project/src/languages/languageRegistry.ts", files),
      requiredFileCheck("language_registry_tests", "Language Registry tests", "frontend/vite-project/src/languages/languageRegistry.test.ts", files),
    ], "补齐语言 id、扩展名、icon theme、grammar、LSP、formatter 关联证据。"),
    makeAx("AX8", "Tasks / Problem Matcher / Build Pipeline", [
      requiredFileCheck("task_runner_tests", "Task runner tests", "frontend/vite-project/src/workbench/taskRunner.test.ts", files),
      requiredFileCheck("problem_matcher_tests", "Problem matcher tests", "frontend/vite-project/src/workbench/problemMatcher.test.ts", files),
      requiredFileCheck("task_language_smoke", "Multi-language task smoke", "frontend/vite-project/src/workbench/taskLanguageSmoke.test.ts", files),
      evidenceCheck("workbench_deep_tasks", "Workbench deep task configs", Number(workbenchDeep?.tasks?.app?.length || 0) > 0, "workbenchDeep.tasks"),
    ], "补齐 tasks/problem matcher/dependsOn/inputs 真实 smoke，并确保 release gate 跑多语言任务样本。"),
    makeAx("AX9", "Debug / DAP / launch.json", [
      requiredFileCheck("launch_config_tests", "Launch config tests", "frontend/vite-project/src/debug/launchConfig.test.ts", files),
      requiredFileCheck("debug_manager_tests", "Debug manager tests", "frontend/vite-project/src/debug/debugManager.test.ts", files),
      evidenceReady(releaseEvidence, "arHealth")
        ? evidenceCheck("debug_health", "AR debug health", true, "releaseEvidence.arHealth")
        : evidenceCheck("debug_health", "AR debug health", false, "releaseEvidence.arHealth"),
    ], "补齐真实 Node/Python adapter 健康报告和端到端调试 smoke。"),
    makeAx("AX10", "Terminal / Shell Integration / Process Model", [
      requiredFileCheck("shell_integration_tests", "Shell integration tests", "frontend/vite-project/src/terminal/shellIntegration.test.ts", files),
      requiredFileCheck("pty_tests", "PTY manager tests", "desktop/services/pty/ptyManager.test.js", files),
      evidenceCheck("workbench_deep_terminal", "Workbench terminal split", Boolean(workbenchDeep?.terminal), "workbenchDeep.terminal"),
    ], "补齐真实 shell lifecycle、Process Explorer 和终端分屏 smoke。"),
    makeAx("AX11", "Git / SCM Provider", [
      requiredFileCheck("scm_registry_tests", "SCM registry tests", "frontend/vite-project/src/scm/scmRegistry.test.ts", files),
      sourceContainsCheck("git_panel_provider_tree", "GitPanel consumes SCM provider tree", "frontend/vite-project/src/components/GitPanel.vue", [
        "getScmProviderSnapshot",
        "getScmResourceGroup",
        "activeScmResources",
      ], files, input.fileContents),
      requiredFileCheck("scm_audit_tests", "SCM audit tests", "desktop/services/agentLoop/scmAudit.test.js", files),
    ], "补齐 Git multi-root、conflict、quick diff、SCM provider tree UI 和 Agent SCM 审计证据。"),
    makeAx("AX12", "VS Code Profile / Import / Migration", [
      requiredFileCheck("migration_tests", "VS Code import tests", "desktop/services/migration/vscodeImport.test.js", files),
    ], "扩展清单需进入受控安装队列，Profile 切换成为一等工作台状态。"),
    makeAx("AX13", "Workspace Trust / Enterprise Policy", [
      requiredFileCheck("workspace_trust_tests", "Workspace Trust tests", "desktop/services/workspaceTrust/index.test.js", files),
      requiredFileCheck("agent_policy_tests", "Agent policy tests", "desktop/services/agentPolicy/index.test.js", files),
      evidenceReady(releaseEvidence, "sandboxSecurity")
        ? evidenceCheck("sandbox_security_link", "Sandbox security linked", true, "releaseEvidence.sandboxSecurity")
        : evidenceCheck("sandbox_security_link", "Sandbox security linked", false, "releaseEvidence.sandboxSecurity"),
    ], "把 trust 状态继续接入任务、终端、调试、扩展安装和企业策略文件。"),
    makeAx("AX14", "Codebase Context / Rules / Mentions", [
      requiredFileCheck("context_evidence_frontend", "Frontend context evidence tests", "frontend/vite-project/src/ai/contextEvidence.test.ts", files),
      requiredFileCheck("context_evidence_backend", "Backend context evidence tests", "desktop/services/agentLoop/contextEvidence.test.js", files),
      evidenceReady(releaseEvidence, "codebaseContext")
        ? evidenceCheck("release_context", "Release context evidence", true, "releaseEvidence.codebaseContext")
        : evidenceCheck("release_context", "Release context evidence", false, "releaseEvidence.codebaseContext"),
    ], "继续用真实长任务压测 index freshness、rules 继承和预算策略。"),
    makeAx("AX15", "Codex Sandbox / Multi-Agent Execution", [
      requiredFileCheck("sandbox_security_tests", "Sandbox security tests", "desktop/services/agentLoop/sandboxSecurityEvidence.test.js", files),
      evidenceReady(releaseEvidence, "sandboxSecurity")
        ? evidenceCheck("release_sandbox", "Release sandbox security evidence", true, "releaseEvidence.sandboxSecurity")
        : evidenceCheck("release_sandbox", "Release sandbox security evidence", false, "releaseEvidence.sandboxSecurity"),
    ], "发起受控 Agent/Auto 任务，确认隔离 workspace lease、权限审批、质量门和 rollback 进入证据链。"),
    makeAx("AX16", "Enterprise Product Gate / Evidence Chain", [
      requiredFileCheck("ax_gate_script", "AX enterprise gate script", "scripts/ax-enterprise-gap-gate.js", files),
      evidenceCheck("release_evidence_base_ready", "Release evidence base ready", releaseEvidenceBaseReady(releaseEvidence), "releaseEvidence.ready excluding ax_enterprise_gate recursion"),
      evidenceCheck("product_grade_ready", "AU product-grade gate ready", productGradeGate?.ready === true, "productGradeGate.ready"),
    ], "运行 AX gate + release evidence + AU product-grade gate，degraded 项必须有原因和下一步。"),
  ]

  const gaps = ax.flatMap((item) => item.ready ? [] : item.checks
    .filter((check) => !check.passed)
    .map((check) => ({
      id: `${item.id}_${check.id}`,
      ax: item.id,
      title: item.title,
      severity: item.severity,
      status: "not_ready",
      reason: `${check.label} 未就绪：${check.detail || check.id}`,
      action: item.nextAction,
    })))
  const blockingGaps = gaps.filter((gap) => gap.severity !== "low" && gap.severity !== "info")
  const ready = blockingGaps.length === 0
  const report = {
    reportKind: "ax-enterprise-gap-gate",
    createdAt: Number(input.createdAt || Date.now()),
    ready,
    status: ready ? "ready" : "blocked",
    statusLabel: ready ? "AX 企业级门禁通过" : "AX 企业级门禁存在阻断",
    summary: {
      total: ax.length,
      ready: ax.filter((item) => item.ready).length,
      blocked: ax.filter((item) => !item.ready && item.severity !== "low" && item.severity !== "info").length,
      missing: gaps.length,
    },
    ax,
    gaps,
    nextActions: gaps.slice(0, 5).map((gap) => ({
      id: gap.id,
      ax: gap.ax,
      title: gap.title,
      severity: gap.severity,
      action: gap.action,
    })),
  }
  report.markdown = toMarkdown(report)
  return report
}

function toMarkdown(report) {
  const axRows = (report.ax || []).map((item) =>
    `| ${item.id} | ${escapeCell(item.title)} | ${item.statusLabel} | ${escapeCell(item.summary)} | ${escapeCell(item.nextAction || "-")} |`,
  )
  const gapRows = (report.gaps || []).map((gap) =>
    `| ${gap.ax} | ${escapeCell(gap.title)} | ${gap.severity} | ${escapeCell(gap.reason)} | ${escapeCell(gap.action)} |`,
  )
  return [
    "# AX Enterprise Gap Gate",
    "",
    `- 状态: ${report.statusLabel}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Created At: ${new Date(report.createdAt || Date.now()).toISOString()}`,
    `- Summary: ${report.summary.ready}/${report.summary.total} ready, ${report.summary.blocked} blocked, ${report.summary.missing} gaps`,
    "",
    "| AX | 能力 | 状态 | 摘要 | 下一步 |",
    "| --- | --- | --- | --- | --- |",
    ...axRows,
    "",
    "## Gaps",
    "",
    "| AX | 能力 | 严重度 | 原因 | 建议动作 |",
    "| --- | --- | --- | --- | --- |",
    ...(gapRows.length ? gapRows : ["| - | - | - | 无阻断缺口 | 人工复核 latest JSON/Markdown |"]),
  ].join("\n")
}

function saveAxEnterpriseGapGate(report, options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  fs.mkdirSync(reportDir, { recursive: true })
  const historyDir = path.join(reportDir, "history")
  fs.mkdirSync(historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const jsonPath = path.join(reportDir, "ax-enterprise-gap-gate-latest.json")
  const markdownPath = path.join(reportDir, "ax-enterprise-gap-gate-latest.md")
  const historyJsonPath = path.join(historyDir, `ax-enterprise-gap-gate-${stamp}.json`)
  const historyMarkdownPath = path.join(historyDir, `ax-enterprise-gap-gate-${stamp}.md`)
  const payload = { ...report, jsonPath, markdownPath, historyJsonPath, historyMarkdownPath }
  const markdown = report.markdown || toMarkdown(report)
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  fs.writeFileSync(markdownPath, `${markdown}\n`, "utf8")
  fs.writeFileSync(historyJsonPath, `${JSON.stringify({ ...payload, jsonPath: historyJsonPath, markdownPath: historyMarkdownPath }, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMarkdownPath, `${markdown}\n`, "utf8")
  return { report: payload, jsonPath, markdownPath, historyJsonPath, historyMarkdownPath, markdown }
}

function readLatestAxEnterpriseGapGate(options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  const jsonPath = path.join(reportDir, "ax-enterprise-gap-gate-latest.json")
  const markdownPath = path.join(reportDir, "ax-enterprise-gap-gate-latest.md")
  if (!fs.existsSync(jsonPath)) return { report: null, jsonPath, markdownPath, markdown: "" }
  return {
    report: JSON.parse(fs.readFileSync(jsonPath, "utf8")),
    jsonPath,
    markdownPath,
    markdown: fs.existsSync(markdownPath) ? fs.readFileSync(markdownPath, "utf8") : "",
  }
}

function escapeCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = buildAxEnterpriseGapGate(options)
  const saved = options.noWrite ? { report, markdown: report.markdown } : saveAxEnterpriseGapGate(report, options)
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    nextActions: report.nextActions,
    jsonPath: saved.jsonPath || "",
    markdownPath: saved.markdownPath || "",
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
  buildAxEnterpriseGapGate,
  defaultReportDir,
  parseArgs,
  readLatestAxEnterpriseGapGate,
  saveAxEnterpriseGapGate,
  toMarkdown,
}
