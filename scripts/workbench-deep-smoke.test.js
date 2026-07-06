const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildWorkbenchDeepSmoke,
  parseArgs,
  readLatestWorkbenchDeepSmoke,
  saveWorkbenchDeepSmoke,
  toMarkdown,
} = require("./workbench-deep-smoke")

test("parseArgs supports report directory and no-write mode", () => {
  const parsed = parseArgs(["--no-write", "--report-dir=C:/tmp/codek-au"])
  assert.equal(parsed.noWrite, true)
  assert.equal(parsed.reportDir, "C:/tmp/codek-au")
})

test("workbench deep smoke covers multi-root, tasks, search, diagnostics, and terminal contracts", async () => {
  const report = await buildWorkbenchDeepSmoke({ createdAt: 123 })

  assert.equal(report.reportKind, "workbench-deep-smoke")
  assert.equal(report.ready, true)
  assert.equal(report.summary.failed, 0)
  assert.equal(report.workspace.roots.length, 3)
  assert.equal(report.workspace.boundary.outsideBlocked, true)
  assert.equal(report.tasks.app.some((task) => task.id === "task-build"), true)
  assert.equal(report.tasks.java.some((task) => task.id === "maven-package"), true)
  assert.equal(report.tasks.python.some((task) => task.id === "python-lint"), true)
  assert.equal(report.search.appMatches.length, 1)
  assert.equal(report.search.javaMatches.length, 1)
  assert.equal(report.diagnostics.exported, true)
  assert.equal(report.diagnostics.problems.length, 2)
  assert.equal(report.taskProblemEvidence.ready, true)
  assert.equal(report.taskProblemEvidence.totalDiagnostics, 2)
  assert.equal(report.taskProblemEvidence.files.length, 2)
  assert.equal(report.taskProblemEvidence.agentEvidence.problemDiagnostics, 2)
  assert.equal(report.terminal.splitSessions.length, 2)
  assert.equal(report.taskRunEvidence.length, 1)
  assert.equal(report.taskRunEvidence[0].status, "passed")
  assert.equal(report.taskRunEvidence[0].steps.length > 0, true)
  assert.equal(report.taskRunEvidence[0].steps.some((step) => step.problemDiagnostics > 0), true)
  assert.match(toMarkdown(report), /AU Workbench Deep Smoke/)
  assert.match(toMarkdown(report), /Task Problem Evidence/)
})

test("workbench deep smoke loads task discovery with frontend relative dependencies", async () => {
  const report = await buildWorkbenchDeepSmoke({ createdAt: 234 })

  assert.equal(report.ready, true)
  assert.equal(report.tasks.app.some((task) => task.id === "task-worker"), true)
  assert.equal(report.tasks.app.some((task) => task.id === "task-build" && Array.isArray(task.problemMatchers)), true)
  assert.equal(report.tasks.app.some((task) => task.id === "task-worker" && Array.isArray(task.problemMatchers)), false)
})

test("workbench deep smoke saves latest and history reports", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-workbench-smoke-"))
  const report = await buildWorkbenchDeepSmoke({ createdAt: 456 })
  const saved = saveWorkbenchDeepSmoke(report, { reportDir })

  assert.equal(fs.existsSync(saved.jsonPath), true)
  assert.equal(fs.existsSync(saved.markdownPath), true)
  assert.equal(fs.existsSync(saved.historyJsonPath), true)
  assert.equal(fs.existsSync(saved.historyMarkdownPath), true)

  const latest = readLatestWorkbenchDeepSmoke({ reportDir })
  assert.equal(latest.report.reportKind, "workbench-deep-smoke")
  assert.equal(latest.report.ready, true)
  assert.match(latest.markdown, /多根工作区/)
})
