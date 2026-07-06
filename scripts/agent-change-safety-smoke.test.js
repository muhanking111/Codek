const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildAgentChangeSafetySmoke,
  parseArgs,
  readLatestAgentChangeSafetySmoke,
  saveAgentChangeSafetySmoke,
  toMarkdown,
} = require("./agent-change-safety-smoke")

test("parseArgs supports report directory and no-write mode", () => {
  const parsed = parseArgs(["--no-write", "--report-dir=C:/tmp/codek-agent-change"])
  assert.equal(parsed.noWrite, true)
  assert.equal(parsed.reportDir, "C:/tmp/codek-agent-change")
})

test("agent change safety smoke proves pending and rollback user-change guards", async () => {
  const report = await buildAgentChangeSafetySmoke({ createdAt: 123 })

  assert.equal(report.reportKind, "agent-change-safety-smoke")
  assert.equal(report.ready, true)
  assert.equal(report.summary.failed, 0)
  assert.equal(report.summary.total, 6)
  assert.equal(report.evidence.pendingBatch.applied, false)
  assert.equal(report.evidence.pendingBatch.currentContent, "manual user edit")
  assert.equal(report.evidence.pendingBatch.blockReason, "manual-change-detected")
  assert.equal(report.evidence.pendingBatch.reviewDisplay.status, "blocked")
  assert.equal(report.evidence.pendingBatch.reviewDisplay.messageTitle, "检测到用户手动修改，已暂停应用")
  assert.equal(report.evidence.pendingBatch.reviewDisplay.firstFileCanApply, false)
  assert.equal(report.evidence.pendingBatch.reviewDisplay.firstFileCanReject, true)
  assert.equal(report.evidence.pendingHunk.applied, false)
  assert.equal(report.evidence.pendingHunk.currentContent, "manual user edit")
  assert.equal(report.evidence.pendingHunk.blockReason, "manual-change-detected")
  assert.equal(report.evidence.rollback.reverted, false)
  assert.equal(report.evidence.rollback.currentContent, "manual user edit")
  assert.equal(report.evidence.rollback.operationStatus, "rollback_blocked")
  assert.equal(report.evidence.rollback.rollbackError, "manual-change-detected")
  assert.equal(report.evidence.rollback.operationLog.title, "Agent Change Set")
  assert.equal(report.evidence.rollback.operationLog.badge, "Agent Operation Log")
  assert.equal(report.evidence.rollback.operationLog.primaryPath, "src/app.ts")
  assert.equal(report.evidence.rollback.operationLog.statusLabel, "Rollback blocked")
  assert.equal(report.evidence.rollback.operationLog.rollbackBlocked, true)
  assert.equal(report.evidence.rollback.operationLog.canRevert, false)
  assert.equal(report.evidence.rollback.operationLog.isGitDiff, false)
  assert.equal(report.evidence.rollback.scmAgentChangeSet.title, "Agent Change Set")
  assert.equal(report.evidence.rollback.scmAgentChangeSet.badge, "Agent Operation Log")
  assert.equal(report.evidence.rollback.scmAgentChangeSet.sourceLabel, "Agent")
  assert.equal(report.evidence.rollback.scmAgentChangeSet.primaryPath, "src/app.ts")
  assert.equal(report.evidence.rollback.scmAgentChangeSet.statusLabel, "Rollback blocked")
  assert.equal(report.evidence.rollback.scmAgentChangeSet.rollbackBlocked, true)
  assert.equal(report.evidence.rollback.scmAgentChangeSet.blockedReasonLabel, "Manual change detected")
  assert.equal(report.evidence.rollback.scmAgentChangeSet.isGitDiff, false)
  assert.match(toMarkdown(report), /Agent Change Safety Smoke/)
  assert.match(toMarkdown(report), /manual-change-detected/)
  assert.match(toMarkdown(report), /Change Review display/)
  assert.match(toMarkdown(report), /Operation log/)
  assert.match(toMarkdown(report), /SCM panel model/)
})

test("agent change safety smoke saves latest and history reports", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-agent-change-smoke-"))
  const report = await buildAgentChangeSafetySmoke({ createdAt: 456 })
  const saved = saveAgentChangeSafetySmoke(report, { reportDir })

  assert.equal(fs.existsSync(saved.jsonPath), true)
  assert.equal(fs.existsSync(saved.markdownPath), true)
  assert.equal(fs.existsSync(saved.historyJsonPath), true)
  assert.equal(fs.existsSync(saved.historyMarkdownPath), true)

  const latest = readLatestAgentChangeSafetySmoke({ reportDir })
  assert.equal(latest.report.reportKind, "agent-change-safety-smoke")
  assert.equal(latest.report.ready, true)
  assert.equal(path.basename(latest.report.latestJsonPath), "agent-change-safety-smoke-latest.json")
  assert.equal(path.basename(latest.report.latestMarkdownPath), "agent-change-safety-smoke-latest.md")
  assert.match(latest.markdown, /Pending batch/)
  assert.match(latest.markdown, /agent-change-safety-smoke-latest\.json/)
  assert.match(latest.markdown, /agent-change-safety-smoke-latest\.md/)
})
