const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  buildAgentUiFeedbackReport,
  saveAgentUiFeedbackReport,
} = require("./bg-agent-ui-feedback-smoke")

test("agent UI feedback report converts a passing Electron smoke into 10 automated feedback entries", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-bg-agent-ui-"))
  const report = buildAgentUiFeedbackReport({
    createdAt: 1,
    reportDir,
    smokeResultFile: path.join(reportDir, "smoke.json"),
    realElectronUiLaunched: true,
    smokePayload: {
      ok: true,
      checks: [
        { name: "workbench shell mounted after smoke login", passed: true },
        { name: "chat composer mounted in smoke workbench", passed: true },
      ],
    },
  })

  assert.equal(report.ready, true)
  assert.equal(report.summary.totalTasks, 10)
  assert.equal(report.summary.confirmedByAgentUi, 10)
  assert.equal(report.summary.manualConfirmed, 0)
  assert.equal(report.scope.replacesHumanManualBeta, false)
  assert.equal(report.entries.every((entry) => entry.agentUiRunConfirmed === true), true)
  assert.equal(report.entries.every((entry) => entry.manualRunConfirmed === false), true)
  assert.match(report.markdown, /自动走查不替代人工主观反馈/)
})

test("agent UI feedback report blocks when Electron smoke has failed checks", () => {
  const report = buildAgentUiFeedbackReport({
    createdAt: 1,
    smokePayload: {
      ok: false,
      checks: [
        { name: "chat composer mounted in smoke workbench", passed: false, detail: "missing input" },
      ],
    },
  })

  assert.equal(report.ready, false)
  assert.equal(report.status, "blocked")
  assert.equal(report.summary.failedSmokeChecks, 1)
  assert.equal(report.entries[0].status, "blocked")
  assert.equal(report.entries[0].severity, "P1")
})

test("agent UI feedback save writes JSON files without marking manual confirmation", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-bg-agent-ui-"))
  const report = buildAgentUiFeedbackReport({
    createdAt: 1,
    reportDir,
    smokePayload: { ok: true, checks: [{ name: "ok", passed: true }] },
  })
  const saved = saveAgentUiFeedbackReport(report, { reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  const taskFile = path.join(saved.feedbackDir, "bd-t01-agent-ui.json")
  assert.equal(fs.existsSync(taskFile), true)
  const entry = JSON.parse(fs.readFileSync(taskFile, "utf8"))
  assert.equal(entry.agentUiRunConfirmed, true)
  assert.equal(entry.manualRunConfirmed, false)
  assert.doesNotMatch(JSON.stringify(entry), /promptBody|sourceCode|commandOutput/)
})
