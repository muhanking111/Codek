const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { listReports, readLatestReport, saveLatestReport } = require("./reportStore")

test("reportStore writes and reads latest eval report as json and markdown", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-eval-report-"))
  const report = {
    createdAt: 123,
    total: 1,
    passed: 1,
    failed: 0,
    routerShadowEval: {
      total: 1,
      currentAligned: 1,
      candidateAligned: 1,
      currentMisaligned: 0,
      candidateMisaligned: 0,
      improved: 0,
      regressed: 0,
      switched: 0,
      recommendation: "keep-current-router",
      config: {},
    },
    results: [
      { id: "task_1", expectedStrategy: "single-agent", actualStrategy: "single-agent", passed: true, reason: "ok" },
    ],
  }

  const saved = saveLatestReport(report, { reportDir })
  assert.ok(fs.existsSync(saved.jsonPath))
  assert.ok(fs.existsSync(saved.markdownPath))
  assert.ok(fs.existsSync(saved.historyJsonPath))
  assert.ok(fs.existsSync(saved.historyMarkdownPath))

  const latest = readLatestReport({ reportDir })
  assert.equal(latest.report.total, 1)
  assert.match(latest.markdown, /Multi-Agent Eval Report/)

  const history = listReports({ reportDir })
  assert.equal(history.length, 1)
  assert.equal(history[0].successRate, 100)
  assert.equal(history[0].routerShadowEval.recommendation, "keep-current-router")
})
