const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  buildBetaTrialRunReport,
  classifyDefects,
  mergeFeedbackIntoReport,
  normalizeFeedbackEntries,
  parseArgs,
  readLatestBetaTrialRun,
  saveBetaTrialRunReport,
} = require("./beta-trial-run")

function task(overrides = {}) {
  return {
    id: overrides.id || "BD-T01",
    title: overrides.title || "单文件文案修复",
    expectedStrategy: overrides.expectedStrategy || "single-agent",
    actualStrategy: overrides.actualStrategy || "single-agent",
    runId: overrides.runId || "run_1",
    projectKind: overrides.projectKind || "small-frontend",
    status: overrides.status || "passed",
    decisionPath: overrides.decisionPath || "accepted",
    qualityGateStatus: overrides.qualityGateStatus || "passed",
    recoveryActions: overrides.recoveryActions || [],
    filesChanged: overrides.filesChanged || 1,
    mainWorkspaceProtected: overrides.mainWorkspaceProtected !== false,
    rollbackVerified: overrides.rollbackVerified === true,
    promptHash: overrides.promptHash || "hash",
    promptLength: overrides.promptLength || 42,
    evidence: overrides.evidence || { diffAvailable: true, reportSaved: true },
    defects: overrides.defects || [],
  }
}

test("beta trial run report is ready when 8+ tasks pass and P0 is clear", () => {
  const report = buildBetaTrialRunReport({
    createdAt: 1,
    taskResults: Array.from({ length: 10 }, (_, index) =>
      task({
        id: `BD-T${String(index + 1).padStart(2, "0")}`,
        runId: `run_${index + 1}`,
        actualStrategy: [2, 3, 5, 6].includes(index) ? "multi-agent" : "single-agent",
        rollbackVerified: index === 8,
        decisionPath: index === 7 ? "ask_user" : index === 8 ? "rollback" : "accepted",
        evidence: { diffAvailable: true, reportSaved: true, releaseEvidence: index === 9 },
      }),
    ),
  })

  assert.equal(report.reportKind, "be-beta-trial-run")
  assert.equal(report.ready, true)
  assert.equal(report.summary.total, 10)
  assert.equal(report.summary.passed, 10)
  assert.equal(report.summary.p0, 0)
  assert.equal(report.coverage.rollback, true)
  assert.equal(report.coverage.clarification, true)
  assert.match(report.markdown, /真实 Beta 执行结果/)
  assert.doesNotMatch(JSON.stringify(report), /把设置页里不自然/)
})

test("beta trial run report blocks on P0 defects even with enough completed tasks", () => {
  const results = Array.from({ length: 10 }, (_, index) => task({ id: `BD-T${String(index + 1).padStart(2, "0")}` }))
  results[0].defects = [{ severity: "P0", title: "主工作区误写", action: "修复 path guard" }]
  const report = buildBetaTrialRunReport({ createdAt: 1, taskResults: results })

  assert.equal(report.ready, false)
  assert.equal(report.status, "blocked")
  assert.equal(report.summary.p0, 1)
  assert.equal(report.nextActions[0].severity, "P0")
})

test("classifyDefects normalizes unknown severities into P2", () => {
  const defects = classifyDefects([
    { severity: "P0", title: "崩溃" },
    { severity: "P1", title: "不能创建 run" },
    { severity: "cosmetic", title: "按钮文案不自然" },
  ])

  assert.equal(defects.p0.length, 1)
  assert.equal(defects.p1.length, 1)
  assert.equal(defects.p2.length, 1)
})

test("beta trial run report saves latest markdown, json, and history", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-beta-run-"))
  const report = buildBetaTrialRunReport({
    createdAt: 1,
    taskResults: Array.from({ length: 10 }, (_, index) => task({ id: `BD-T${String(index + 1).padStart(2, "0")}` })),
  })
  const saved = saveBetaTrialRunReport(report, { reportDir })
  const latest = readLatestBetaTrialRun({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(fs.existsSync(saved.historyJson), true)
  assert.equal(fs.existsSync(saved.historyMd), true)
  assert.equal(latest.report.reportKind, "be-beta-trial-run")
  assert.equal(latest.markdownPath, saved.latestMarkdownPath)
})

test("beta feedback import stores metadata, screenshots, defects, and regression evidence without raw bodies", () => {
  const report = buildBetaTrialRunReport({
    createdAt: 1,
    taskResults: Array.from({ length: 10 }, (_, index) => task({
      id: `BD-T${String(index + 1).padStart(2, "0")}`,
      actualStrategy: index === 2 ? "multi-agent" : "single-agent",
      decisionPath: index === 7 ? "ask_user" : index === 8 ? "rollback" : "accepted",
      rollbackVerified: index === 8,
      evidence: { diffAvailable: true, reportSaved: true, attachmentMetadata: index === 6, releaseEvidence: index === 9 },
    })),
    feedbackEntries: [{
      feedbackId: "fb-1",
      taskId: "BD-T03",
      runId: "run_3",
      status: "failed",
      severity: "P1",
      title: "Chat 面板最小宽度下状态栏拥挤",
      reproductionSteps: "DO_NOT_LEAK_REPRO_STEPS_RAW",
      screenshotPaths: ["D:/Workspace/screens/chat-overlap.png"],
      score: 2,
      defectStatus: "verified",
      regressionEvidence: {
        runId: "run_regression_1",
        command: "npm run smoke -- --token sk-test-should-not-leak",
        reportPath: "D:/Workspace/.codek/reports/regression.json",
      },
    }, {
      feedbackId: "fb-2",
      taskId: "BD-T09",
      runId: "run_9",
      status: "passed",
      title: "回滚路径可用",
      screenshotPath: "D:/Workspace/screens/rollback-ok.png",
      score: 5,
    }],
  })

  assert.equal(report.ready, true)
  assert.equal(report.summary.feedbackTotal, 2)
  assert.equal(report.summary.p1, 1)
  assert.equal(report.betaFeedback.available, true)
  assert.equal(report.betaFeedback.ready, true)
  assert.equal(report.betaFeedback.screenshotCount, 2)
  assert.equal(report.betaFeedback.pendingRegression, 0)
  assert.equal(report.betaFeedback.entries[0].reproductionStepsLength > 0, true)
  assert.equal(report.betaFeedback.entries[0].regressionEvidence.commandLength > 0, true)
  const serialized = JSON.stringify(report)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_REPRO_STEPS_RAW/)
  assert.doesNotMatch(serialized, /sk-test-should-not-leak/)
  assert.doesNotMatch(serialized, /chat-overlap\.png/)
})

test("beta feedback import rejects sensitive raw fields and keeps them out of reports", () => {
  const feedback = normalizeFeedbackEntries([{
    feedbackId: "fb-secret",
    taskId: "BD-T07",
    status: "failed",
    severity: "P0",
    title: "附件泄漏",
    promptBody: "DO_NOT_LEAK_PROMPT",
    token: "sk-test-should-not-leak",
    screenshotPath: "D:/Workspace/screens/failure.png",
  }])

  assert.equal(feedback.imported.length, 0)
  assert.equal(feedback.rejected.length, 1)
  assert.equal(feedback.privacyViolations, 1)
  assert.doesNotMatch(JSON.stringify(feedback), /DO_NOT_LEAK_PROMPT/)
  assert.doesNotMatch(JSON.stringify(feedback), /sk-test-should-not-leak/)
})

test("beta feedback fixed or verified defects require regression evidence", () => {
  const report = buildBetaTrialRunReport({
    createdAt: 1,
    taskResults: Array.from({ length: 10 }, (_, index) => task({ id: `BD-T${String(index + 1).padStart(2, "0")}` })),
    feedbackEntries: [{
      feedbackId: "fb-fixed-no-regression",
      taskId: "BD-T02",
      status: "failed",
      severity: "P1",
      title: "模式下拉点外部不关闭",
      defectStatus: "fixed",
      screenshotPath: "D:/Workspace/screens/dropdown.png",
    }],
  })

  assert.equal(report.ready, false)
  assert.equal(report.betaFeedback.ready, false)
  assert.equal(report.betaFeedback.pendingRegression, 1)
  assert.equal(report.nextActions.some((item) => item.title.includes("回归证据")), true)
})

test("mergeFeedbackIntoReport deduplicates feedback and preserves previous task results", () => {
  const base = buildBetaTrialRunReport({
    createdAt: 1,
    taskResults: Array.from({ length: 10 }, (_, index) => task({ id: `BD-T${String(index + 1).padStart(2, "0")}` })),
    feedbackEntries: [{ feedbackId: "fb-1", taskId: "BD-T01", status: "passed", score: 4 }],
  })
  const merged = mergeFeedbackIntoReport(base, [
    { feedbackId: "fb-1", taskId: "BD-T01", status: "failed", severity: "P0" },
    { feedbackId: "fb-2", taskId: "BD-T02", status: "passed", score: 5 },
  ])

  assert.equal(merged.taskResults.length, 10)
  assert.equal(merged.betaFeedback.entries.length, 2)
  assert.equal(merged.betaFeedback.entries.some((item) => item.feedbackId === "fb-2"), true)
  assert.equal(merged.summary.p0, 0)
})

test("mergeFeedbackIntoReport enriches duplicate feedback with new screenshot evidence", () => {
  const base = buildBetaTrialRunReport({
    createdAt: 1,
    taskResults: Array.from({ length: 10 }, (_, index) => task({ id: `BD-T${String(index + 1).padStart(2, "0")}` })),
    feedbackEntries: [{ feedbackId: "fb-1", taskId: "BD-T01", status: "passed", score: 4 }],
  })
  const merged = mergeFeedbackIntoReport(base, [
    { feedbackId: "fb-1", taskId: "BD-T01", status: "passed", screenshotPath: "D:/Workspace/screens/fb-1.png", regressionEvidence: { runId: "run_regression" } },
  ])

  assert.equal(merged.betaFeedback.entries.length, 1)
  assert.equal(merged.betaFeedback.screenshotCount, 1)
  assert.equal(merged.betaFeedback.entries[0].hasRegressionEvidence, true)
})

test("parseArgs supports replacing latest feedback for clean BG evidence runs", () => {
  const options = parseArgs([
    "--replace-feedback",
    "--feedback-dir=D:/Workspace/.codek/reports/agent-ui-feedback",
    "--report-dir=D:/Workspace/.codek/reports",
  ])

  assert.equal(options.replaceFeedback, true)
  assert.equal(options.feedbackDir.endsWith("agent-ui-feedback"), true)
})
