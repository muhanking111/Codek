const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { buildBetaTrialPlan, listBetaTrialPlans, readLatest, save, steps } = require("./beta-trial-plan")

test("beta trial plan covers external product trial essentials", () => {
  const report = buildBetaTrialPlan({ createdAt: 1 })

  assert.equal(report.ready, true)
  assert.equal(steps.length >= 10, true)
  assert.equal(report.reportKind, "bd-user-trial-plan")
  assert.equal(report.tasks.some((item) => item.id === "BD-T03" && item.expectedStrategy === "multi-agent"), true)
  assert.equal(report.tasks.some((item) => item.id === "BD-T09"), true)
  assert.match(report.markdown, /30-45 分钟/)
  assert.match(report.markdown, /30 分钟/)
  assert.match(report.markdown, /Accept \/ Rollback/)
  assert.match(report.markdown, /不采集用户 prompt 正文/)
  assert.match(report.markdown, /BD evidence/)
})

test("beta trial plan saves latest report and docs markdown", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-beta-trial-"))
  const report = buildBetaTrialPlan({ createdAt: 1 })
  const saved = save(report, { reportDir })
  const latest = readLatest({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.reportKind, "bd-user-trial-plan")
  assert.equal(latest.markdownPath, saved.latestMarkdownPath)
  assert.match(latest.markdown, /标准试运行任务集/)

  const history = listBetaTrialPlans({ reportDir })
  assert.equal(history.length, 1)
  assert.equal(history[0].jsonPath, saved.historyJson)
})

test("beta trial plan report does not include private payload bodies", () => {
  const report = buildBetaTrialPlan({ createdAt: 1 })
  const serialized = JSON.stringify(report)

  assert.doesNotMatch(serialized, /DO_NOT_LEAK/)
  assert.match(serialized, /prompt text/)
  assert.match(serialized, /source code body/)
  assert.match(serialized, /attachment body/)
  assert.match(serialized, /full command output/)
})
