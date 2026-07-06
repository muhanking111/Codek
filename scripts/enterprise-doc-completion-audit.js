#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")
const { handleReadOnlyCliFlags } = require("./evidence-cli-utils")

const HELP_CONFIG = {
  scriptName: "enterprise-doc-completion-audit.js",
  description: "Audit enterprise documentation completion from docs and existing reports.",
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

const { readLatestManualRealUiEvidence } = require("./manual-real-ui-evidence")

const root = path.resolve(__dirname, "..")

const DOCS = {
  index: "ENTERPRISE_PLAN_INDEX.md",
  p0: "PLAN_2026_06_19_manual_acceptance_cursor_vscode_parity_repair.md",
  matrix: "VS_CODE_SOURCE_MIGRATION_MATRIX.md",
  audit: "ENTERPRISE_CAPABILITY_AUDIT.md",
  overview: "PLAN_OVERVIEW.md",
  release: "RELEASE_RUNBOOK.md",
  beta: "BETA_TRIAL.md",
}

const RETIRED_DOCS = [
  "PLAN_2026_06_07_enterprise_completion_recovery.md",
  "PLAN_2026_06_18_git_state_recovery.md",
  "PLAN_2026_06_18_cursor_vscode_enterprise_rebuild.md",
  "PLAN_BD_enterprise_cursor_codex_product_rebuild.md",
  "PLAN_BE_cursor_workbench_visual_search_create_regression.md",
  "RUNBOOK_real_project_agent_trial.md",
]

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const rootDirArg = argv.find((arg) => arg.startsWith("--root="))
  return {
    gateInProgress: argv.includes("--gate-in-progress"),
    noWrite: argv.includes("--no-write"),
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
    rootDir: rootDirArg ? rootDirArg.slice("--root=".length) : root,
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8")
  } catch {
    return ""
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function includesAll(text, items) {
  return items.every((item) => text.includes(item))
}

function includesAny(text, items) {
  return items.some((item) => text.includes(item))
}

function requirement(id, source, title, status, evidence = {}) {
  return {
    id,
    source,
    title,
    status,
    automated: status === "passed",
    manualRequired: status === "manual_required",
    evidence,
  }
}

function releaseEvidenceHasOnlySelfOrManualAdvisoryGaps(releaseEvidence) {
  if (releaseEvidence?.ready === true && Array.isArray(releaseEvidence?.gaps) && releaseEvidence.gaps.length === 0) {
    return true
  }
  const gaps = Array.isArray(releaseEvidence?.gaps) ? releaseEvidence.gaps : []
  if (gaps.length === 0) return false
  return gaps.every((gap) => {
    if (gap?.id === "enterprise_doc_completion_audit") return true
    if (gap?.id === "manual_real_ui_evidence") {
      return gap?.severity === "low" || gap?.severity === "info"
    }
    return false
  })
}

function releaseEvidenceHasNoBlockingGaps(releaseEvidence) {
  const gaps = Array.isArray(releaseEvidence?.gaps) ? releaseEvidence.gaps : []
  return gaps.every((gap) => gap?.severity === "low" || gap?.severity === "info")
}

function requiredDocsExist(docsDir) {
  const missing = Object.values(DOCS).filter((file) => !fs.existsSync(path.join(docsDir, file)))
  return {
    passed: missing.length === 0,
    missing,
  }
}

function retiredDocsRemoved(docsDir) {
  const present = RETIRED_DOCS.filter((file) => fs.existsSync(path.join(docsDir, file)))
  return {
    passed: present.length === 0,
    present,
  }
}

function buildEnterpriseDocCompletionAudit(options = {}) {
  const rootDir = options.rootDir || root
  const docsDir = path.join(rootDir, "docs")
  const reportDir = options.reportDir || defaultReportDir()
  const texts = Object.fromEntries(Object.entries(DOCS).map(([key, file]) => [key, readText(path.join(docsDir, file))]))
  const docsPresence = requiredDocsExist(docsDir)
  const retiredPresence = retiredDocsRemoved(docsDir)
  const releaseEvidence = readJson(path.join(reportDir, "release-evidence-latest.json"))
  const manualRealUi = readLatestManualRealUiEvidence({ reportDir }).report

  const requirements = []

  requirements.push(requirement(
    "docs_present",
    "docs",
    "当前保留文档全部存在",
    docsPresence.passed ? "passed" : "missing",
    docsPresence,
  ))

  requirements.push(requirement(
    "retired_docs_removed",
    "docs",
    "旧 BD / BE / 06-07 / 06-18 计划和旧 Agent runbook 已删除",
    retiredPresence.passed ? "passed" : "missing",
    retiredPresence,
  ))

  requirements.push(requirement(
    "single_entry_index",
    DOCS.index,
    "计划索引声明唯一当前入口并登记旧文档归并关系",
    includesAll(texts.index, [
      "唯一当前任务入口",
      "当前 P0 入口",
      "已归并或删除的旧入口",
      "禁止重复堆叠",
    ]) ? "passed" : "missing",
  ))

  requirements.push(requirement(
    "vscode_source_rules",
    DOCS.matrix,
    "VS Code 迁移矩阵保留源码优先、禁止双轨和旧逻辑处理规则",
    includesAll(texts.matrix, [
      "先对照 VS Code 源码",
      "删除、替换或明确旁路旧自研路径",
      "禁止长期保留 VS Code 模型和 Codek 简化模型双轨并存",
      "自研例外流程",
    ]) ? "passed" : "missing",
  ))

  requirements.push(requirement(
    "p0_plan_current",
    DOCS.p0,
    "当前 P0 计划覆盖大文件、Explorer、Search、MCP、视觉中文化和最终证据门",
    includesAll(texts.p0, [
      "完成门槛",
      "P0-A 大文件真实滚动和可编辑窗口",
      "P0-B Explorer / 创建落点 / 文件数量",
      "P0-C Search / Navigation",
      "P0-D MCP / Extension Host 收口",
      "P0-E 视觉和中文化",
      "enterpriseComplete=true",
    ]) ? "passed" : "missing",
  ))

  requirements.push(requirement(
    "capability_audit_current",
    DOCS.audit,
    "能力审计用当前状态矩阵替代长篇历史日志",
    includesAll(texts.audit, [
      "状态定义",
      "当前能力矩阵",
      "verified-automation-only",
      "MCP",
      "审计硬规则",
    ]) ? "passed" : "missing",
  ))

  requirements.push(requirement(
    "overview_current",
    DOCS.overview,
    "路线总览指向当前索引且说明旧计划已归并",
    includesAll(texts.overview, [
      "当前任务入口看",
      "当前策略",
      "当前文档",
      "旧 BD / BE / 06-07 / 06-18 计划已经归并",
    ]) ? "passed" : "missing",
  ))

  requirements.push(requirement(
    "release_runbook_present",
    DOCS.release,
    "发布手册保留授权发布、门禁和不得公开内容边界",
    includesAll(texts.release, [
      "不代表已经 push",
      "发布前检查",
      "不允许公开的内容",
    ]) ? "passed" : "missing",
  ))

  requirements.push(requirement(
    "beta_trial_merged",
    DOCS.beta,
    "Beta 指南已合并真实项目 Agent / Auto 试运行流程和隐私边界",
    includesAll(texts.beta, [
      "Agent / Auto",
      "proposal-only",
    ]) && includesAny(texts.beta, [
      "标准任务集",
      "标准试运行任务集",
      "试运行任务集",
    ]) && includesAny(texts.beta, [
      "不采集 prompt 正文",
      "不采集用户 prompt 正文",
      "不保存正文",
    ]) && includesAny(texts.beta, [
      "失败分类",
      "错误类别",
      "失败任务是否能分类",
    ]) ? "passed" : "missing",
  ))

  requirements.push(requirement(
    "release_evidence_readable",
    "release-evidence-latest.json",
    "最新 release evidence 可读取；发布是否 ready 由 release evidence 自身判断",
    releaseEvidence ? "passed" : "missing",
    {
      gateInProgress: options.gateInProgress === true,
      createdAt: releaseEvidence?.createdAt || null,
      ready: releaseEvidence?.ready === true,
      status: releaseEvidence?.status || "",
      gaps: Array.isArray(releaseEvidence?.gaps) ? releaseEvidence.gaps.map((gap) => gap.id) : [],
    },
  ))

  const manualRealUiReady = manualRealUi?.ready === true
    && manualRealUi?.manualRunConfirmed === true
    && manualRealUi?.cursorLevelSmoothnessConfirmed === true
    && manualRealUi?.windowsExplorerCrossCheckConfirmed === true

  requirements.push(requirement(
    "manual_cursor_feel_check",
    "manual-real-ui-evidence-latest.json",
    "Cursor 级主观流畅度和 Windows Explorer 交叉检查已有真实人工或 Computer Use 证据",
    manualRealUiReady ? "passed" : "manual_required",
    manualRealUiReady
      ? {
          createdAt: manualRealUi.createdAt || null,
          method: manualRealUi.method || "",
          scenarios: manualRealUi?.summary?.passedScenarios || 0,
          checks: manualRealUi?.summary?.passedChecks || 0,
          screenshotCount: manualRealUi?.summary?.screenshotCount || 0,
          jsonPath: manualRealUi.latestJsonPath || "",
          markdownPath: manualRealUi.latestMarkdownPath || "",
        }
      : {
          reason: "自动化 smoke 可以证明行为和性能预算，但不能替代真实桌面手感确认。",
          expectedEvidence: "manual-real-ui-evidence-latest.json 中 manualRunConfirmed、cursorLevelSmoothnessConfirmed 和 windowsExplorerCrossCheckConfirmed 均为 true。",
        },
  ))

  const missing = requirements.filter((item) => item.status === "missing")
  const manualRequired = requirements.filter((item) => item.status === "manual_required")
  const automatedPassed = requirements.filter((item) => item.status === "passed")

  return {
    reportKind: "enterprise-doc-completion-audit",
    createdAt: Number(options.createdAt || Date.now()),
    ready: missing.length === 0,
    status: missing.length > 0 ? "blocked" : manualRequired.length > 0 ? "ready-with-manual-evidence-required" : "complete",
    enterpriseComplete: missing.length === 0 && manualRequired.length === 0,
    summary: {
      total: requirements.length,
      automatedPassed: automatedPassed.length,
      manualRequired: manualRequired.length,
      missing: missing.length,
    },
    requirements,
    nextActions: manualRequired.length > 0 ? [{
      id: "manual_real_ui_required",
      severity: "high",
      action: "使用真实人工操作或 Computer Use 证据验证 Cursor 级主观流畅度、Windows Explorer 创建落点和真实大项目交互。",
    }] : [],
  }
}

function escapeMarkdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function formatRequirementStatus(status) {
  if (status === "passed") return "通过"
  if (status === "missing") return "缺失"
  if (status === "manual_required") return "需要人工证据"
  return status || "未知"
}

function formatAuditStatus(status) {
  if (status === "complete") return "完成"
  if (status === "blocked") return "已阻断"
  if (status === "ready-with-manual-evidence-required") return "就绪，但仍需要真实 UI 手感证据"
  return status || "未知"
}

function toMarkdown(report) {
  const rows = report.requirements.map((item) =>
    `| ${escapeMarkdownCell(item.id)} | ${formatRequirementStatus(item.status)} | ${escapeMarkdownCell(item.source)} | ${escapeMarkdownCell(item.title)} |`)
  return [
    "# 企业级文档完成审计",
    "",
    `- 就绪: ${report.ready ? "是" : "否"}`,
    `- 企业级完成: ${report.enterpriseComplete ? "是" : "否"}`,
    `- 当前状态: ${formatAuditStatus(report.status)}`,
    `- 生成时间: ${new Date(report.createdAt).toISOString()}`,
    `- 自动化通过: ${report.summary.automatedPassed}/${report.summary.total}`,
    `- 需要人工证据: ${report.summary.manualRequired}`,
    `- 缺失: ${report.summary.missing}`,
    "",
    "| 要求 | 状态 | 证据来源 | 标题 |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n") + "\n"
}

function saveReport(report, reportDir = defaultReportDir()) {
  fs.mkdirSync(reportDir, { recursive: true })
  const stamp = new Date(report.createdAt).toISOString().replace(/[:.]/g, "-")
  const jsonPath = path.join(reportDir, `enterprise-doc-completion-audit-${stamp}.json`)
  const markdownPath = path.join(reportDir, `enterprise-doc-completion-audit-${stamp}.md`)
  const latestJsonPath = path.join(reportDir, "enterprise-doc-completion-audit-latest.json")
  const latestMarkdownPath = path.join(reportDir, "enterprise-doc-completion-audit-latest.md")
  const normalized = { ...report, jsonPath, markdownPath, latestJsonPath, latestMarkdownPath }
  fs.writeFileSync(jsonPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  fs.writeFileSync(markdownPath, toMarkdown(normalized), "utf8")
  fs.writeFileSync(latestMarkdownPath, toMarkdown(normalized), "utf8")
  return normalized
}

function readLatestEnterpriseDocCompletionAudit(options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  const jsonPath = path.join(reportDir, "enterprise-doc-completion-audit-latest.json")
  return {
    report: readJson(jsonPath),
    jsonPath,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = buildEnterpriseDocCompletionAudit(options)
  const output = options.noWrite ? report : saveReport(report, options.reportDir)
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`)
    process.exit(1)
  })
}

module.exports = {
  DOCS,
  RETIRED_DOCS,
  buildEnterpriseDocCompletionAudit,
  defaultReportDir,
  parseArgs,
  readLatestEnterpriseDocCompletionAudit,
  releaseEvidenceHasNoBlockingGaps,
  releaseEvidenceHasOnlySelfOrManualAdvisoryGaps,
  retiredDocsRemoved,
  saveReport,
  toMarkdown,
}
