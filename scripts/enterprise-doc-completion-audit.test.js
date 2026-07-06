const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  DOCS,
  RETIRED_DOCS,
  buildEnterpriseDocCompletionAudit,
  parseArgs,
  readLatestEnterpriseDocCompletionAudit,
  releaseEvidenceHasOnlySelfOrManualAdvisoryGaps,
  retiredDocsRemoved,
  saveReport,
  toMarkdown,
} = require("./enterprise-doc-completion-audit")

function writeFixtureDocs(rootDir) {
  const docsDir = path.join(rootDir, "docs")
  fs.mkdirSync(docsDir, { recursive: true })
  fs.writeFileSync(path.join(docsDir, DOCS.index), [
    "本文件是 `docs/` 的唯一当前任务入口。",
    "当前 P0 入口是 `docs/PLAN_2026_06_19_manual_acceptance_cursor_vscode_parity_repair.md`。",
    "## 已归并或删除的旧入口",
    "## 禁止重复堆叠",
  ].join("\n"), "utf8")
  fs.writeFileSync(path.join(docsDir, DOCS.p0), [
    "## 完成门槛",
    "## P0-A 大文件真实滚动和可编辑窗口",
    "## P0-B Explorer / 创建落点 / 文件数量",
    "## P0-C Search / Navigation",
    "## P0-D MCP / Extension Host 收口",
    "## P0-E 视觉和中文化",
    "直到 `enterpriseComplete=true`。",
  ].join("\n"), "utf8")
  fs.writeFileSync(path.join(docsDir, DOCS.matrix), [
    "先对照 VS Code 源码",
    "必须删除、替换或明确旁路旧自研路径。",
    "禁止长期保留 VS Code 模型和 Codek 简化模型双轨并存。",
    "## 自研例外流程",
  ].join("\n"), "utf8")
  fs.writeFileSync(path.join(docsDir, DOCS.audit), [
    "## 状态定义",
    "`verified-automation-only`",
    "## 当前能力矩阵",
    "| MCP | partially-usable |",
    "## 审计硬规则",
  ].join("\n"), "utf8")
  fs.writeFileSync(path.join(docsDir, DOCS.overview), [
    "当前任务入口看 `docs/ENTERPRISE_PLAN_INDEX.md`。",
    "## 当前策略",
    "## 当前文档",
    "旧 BD / BE / 06-07 / 06-18 计划已经归并。",
  ].join("\n"), "utf8")
  fs.writeFileSync(path.join(docsDir, DOCS.release), [
    "它不代表已经 push。",
    "## 发布前检查",
    "## 不允许公开的内容",
  ].join("\n"), "utf8")
  fs.writeFileSync(path.join(docsDir, DOCS.beta), [
    "Agent / Auto",
    "默认 `proposal-only`。",
    "不采集 prompt 正文。",
    "## 标准任务集",
    "## 失败分类",
  ].join("\n"), "utf8")
}

function writeFixtureReports(reportDir) {
  fs.mkdirSync(reportDir, { recursive: true })
  fs.writeFileSync(path.join(reportDir, "release-evidence-latest.json"), `${JSON.stringify({
    ready: true,
    gaps: [],
    createdAt: 1,
  }, null, 2)}\n`, "utf8")
}

test("parseArgs supports no-write, root and report dir", () => {
  const parsed = parseArgs(["--no-write", "--gate-in-progress", "--root=C:/repo", "--report-dir=C:/repo/.codek/reports"])

  assert.equal(parsed.noWrite, true)
  assert.equal(parsed.gateInProgress, true)
  assert.equal(parsed.rootDir, "C:/repo")
  assert.equal(parsed.reportDir, "C:/repo/.codek/reports")
})

test("enterprise document audit passes current docs and separates manual real UI evidence", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-enterprise-docs-"))
  const reportDir = path.join(rootDir, ".codek", "reports")
  writeFixtureDocs(rootDir)
  writeFixtureReports(reportDir)

  const report = buildEnterpriseDocCompletionAudit({ rootDir, reportDir, createdAt: 1 })

  assert.equal(report.ready, true)
  assert.equal(report.enterpriseComplete, false)
  assert.equal(report.status, "ready-with-manual-evidence-required")
  assert.equal(report.summary.missing, 0)
  assert.equal(report.summary.manualRequired, 1)
  assert.equal(report.requirements.some((item) => item.id === "manual_cursor_feel_check" && item.status === "manual_required"), true)
  assert.equal(report.requirements.some((item) => item.id === "vscode_source_rules" && item.status === "passed"), true)
})

test("enterprise document audit accepts beta trial failure category wording variants", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-enterprise-docs-beta-"))
  const reportDir = path.join(rootDir, ".codek", "reports")
  writeFixtureDocs(rootDir)
  writeFixtureReports(reportDir)
  fs.writeFileSync(path.join(rootDir, "docs", DOCS.beta), [
    "Agent / Auto",
    "默认 `proposal-only`。",
    "不采集 prompt 正文。",
    "## 标准任务集",
    "不能恢复时记录错误类别和截图。",
  ].join("\n"), "utf8")

  const report = buildEnterpriseDocCompletionAudit({ rootDir, reportDir, createdAt: 1 })

  assert.equal(report.requirements.find((item) => item.id === "beta_trial_merged").status, "passed")
})

test("enterprise document audit accepts beta trial privacy wording variants", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-enterprise-docs-beta-privacy-"))
  const reportDir = path.join(rootDir, ".codek", "reports")
  writeFixtureDocs(rootDir)
  writeFixtureReports(reportDir)
  fs.writeFileSync(path.join(rootDir, "docs", DOCS.beta), [
    "Agent / Auto",
    "默认 `proposal-only`。",
    "不采集用户 prompt 正文、附件正文、源代码正文、命令输出正文或密钥。",
    "## 标准任务集",
    "## 失败分类",
  ].join("\n"), "utf8")

  const report = buildEnterpriseDocCompletionAudit({ rootDir, reportDir, createdAt: 1 })

  assert.equal(report.requirements.find((item) => item.id === "beta_trial_merged").status, "passed")
})

test("enterprise document audit accepts beta trial task set wording variants", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-enterprise-docs-beta-task-set-"))
  const reportDir = path.join(rootDir, ".codek", "reports")
  writeFixtureDocs(rootDir)
  writeFixtureReports(reportDir)
  fs.writeFileSync(path.join(rootDir, "docs", DOCS.beta), [
    "Agent / Auto",
    "默认 `proposal-only`。",
    "不采集 prompt 正文。",
    "## 标准试运行任务集",
    "## 失败分类",
  ].join("\n"), "utf8")

  const report = buildEnterpriseDocCompletionAudit({ rootDir, reportDir, createdAt: 1 })

  assert.equal(report.requirements.find((item) => item.id === "beta_trial_merged").status, "passed")
})

test("enterprise document audit does not recurse on stale release evidence readiness", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-enterprise-docs-release-stale-"))
  const reportDir = path.join(rootDir, ".codek", "reports")
  writeFixtureDocs(rootDir)
  fs.mkdirSync(reportDir, { recursive: true })
  fs.writeFileSync(path.join(reportDir, "release-evidence-latest.json"), `${JSON.stringify({
    ready: false,
    status: "degraded",
    gaps: [
      { id: "enterprise_doc_completion_audit", severity: "high" },
      { id: "extension_enterprise_gate", severity: "high" },
    ],
    createdAt: 2,
  }, null, 2)}\n`, "utf8")

  const report = buildEnterpriseDocCompletionAudit({ rootDir, reportDir, createdAt: 2 })

  assert.equal(report.ready, true)
  assert.equal(report.requirements.find((item) => item.id === "release_evidence_readable").status, "passed")
  assert.equal(report.requirements.find((item) => item.id === "release_evidence_readable").evidence.ready, false)
})

test("enterprise document audit blocks when a retained document is missing", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-enterprise-docs-missing-"))
  const reportDir = path.join(rootDir, ".codek", "reports")
  writeFixtureDocs(rootDir)
  writeFixtureReports(reportDir)
  fs.rmSync(path.join(rootDir, "docs", DOCS.matrix))

  const report = buildEnterpriseDocCompletionAudit({ rootDir, reportDir, createdAt: 1 })

  assert.equal(report.ready, false)
  assert.equal(report.requirements.some((item) => item.id === "docs_present" && item.status === "missing"), true)
  assert.equal(report.requirements.find((item) => item.id === "docs_present").evidence.missing.includes(DOCS.matrix), true)
})

test("enterprise document audit blocks when retired docs still exist", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-enterprise-docs-retired-"))
  const reportDir = path.join(rootDir, ".codek", "reports")
  writeFixtureDocs(rootDir)
  writeFixtureReports(reportDir)
  fs.writeFileSync(path.join(rootDir, "docs", RETIRED_DOCS[0]), "# stale\n", "utf8")

  const report = buildEnterpriseDocCompletionAudit({ rootDir, reportDir, createdAt: 1 })

  assert.equal(retiredDocsRemoved(path.join(rootDir, "docs")).passed, false)
  assert.equal(report.ready, false)
  assert.equal(report.requirements.some((item) => item.id === "retired_docs_removed" && item.status === "missing"), true)
})

test("enterprise document audit accepts release evidence self gap plus manual low advisory only", () => {
  assert.equal(releaseEvidenceHasOnlySelfOrManualAdvisoryGaps({
    ready: false,
    gaps: [
      { id: "enterprise_doc_completion_audit", severity: "high" },
      { id: "manual_real_ui_evidence", severity: "low" },
    ],
  }), true)
  assert.equal(releaseEvidenceHasOnlySelfOrManualAdvisoryGaps({
    ready: false,
    gaps: [{ id: "manual_real_ui_evidence", severity: "high" }],
  }), false)
})

test("enterprise document audit saves latest JSON and markdown reports", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-enterprise-docs-save-"))
  const reportDir = path.join(rootDir, ".codek", "reports")
  writeFixtureDocs(rootDir)
  writeFixtureReports(reportDir)

  const saved = saveReport(buildEnterpriseDocCompletionAudit({ rootDir, reportDir, createdAt: 1 }), reportDir)
  const latest = readLatestEnterpriseDocCompletionAudit({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.reportKind, "enterprise-doc-completion-audit")
  assert.equal(latest.report.ready, true)
})

test("enterprise document audit markdown is Chinese for user-visible report text", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-enterprise-docs-zh-"))
  const reportDir = path.join(rootDir, ".codek", "reports")
  writeFixtureDocs(rootDir)
  writeFixtureReports(reportDir)

  const report = buildEnterpriseDocCompletionAudit({ rootDir, reportDir, createdAt: 1 })
  const markdown = toMarkdown(report)

  assert.match(markdown, /^# 企业级文档完成审计/m)
  assert.match(markdown, /- 就绪: 是/)
  assert.match(markdown, /- 企业级完成: 否/)
  assert.match(markdown, /- 当前状态: 就绪，但仍需要真实 UI 手感证据/)
  assert.match(markdown, /\| vscode_source_rules \| 通过 \| VS_CODE_SOURCE_MIGRATION_MATRIX\.md \| VS Code 迁移矩阵保留源码优先、禁止双轨和旧逻辑处理规则 \|/)
  assert.match(markdown, /\| manual_cursor_feel_check \| 需要人工证据 \| manual-real-ui-evidence-latest\.json \| Cursor 级主观流畅度和 Windows Explorer 交叉检查已有真实人工或 Computer Use 证据 \|/)
  assert.doesNotMatch(markdown, /Enterprise Document Completion Audit/)
  assert.doesNotMatch(markdown, /\| [^|]+ \| (passed|missing|manual_required) \|/)
})
