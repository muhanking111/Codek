const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  buildManualFeedbackPlan,
  initManualFeedbackWorkspace,
  validateManualFeedbackWorkspace,
} = require("./manual-beta-feedback")

test("manual feedback plan creates one template for each BD task", () => {
  const plan = buildManualFeedbackPlan({ createdAt: 1 })

  assert.equal(plan.reportKind, "bg-manual-beta-feedback-plan")
  assert.equal(plan.ready, true)
  assert.equal(plan.summary.totalTasks, 10)
  assert.equal(plan.tasks[0].id, "BD-T01")
  assert.equal(plan.tasks[9].id, "BD-T10")
  assert.equal(plan.privacyPolicy.deny.includes("promptBody"), true)
})

test("manual feedback workspace init writes task templates without raw prompt bodies", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-manual-feedback-"))
  const saved = initManualFeedbackWorkspace({ reportDir, createdAt: 1 })

  assert.equal(fs.existsSync(saved.feedbackDir), true)
  assert.equal(fs.existsSync(saved.screenshotDir), true)
  assert.equal(fs.existsSync(saved.indexPath), true)
  assert.equal(saved.templatePaths.length, 10)
  const template = JSON.parse(fs.readFileSync(saved.templatePaths[0], "utf8"))
  assert.equal(template.taskId, "BD-T01")
  assert.equal(template.status, "blocked")
  assert.equal(template.severity, "P2")
  assert.equal(template.screenshotPaths.length, 1)
  assert.equal(Object.hasOwn(template, "promptBody"), false)
  assert.doesNotMatch(JSON.stringify(template), /把设置页里不自然的中文提示/)
})

test("manual feedback workspace validation requires 10 real feedback files and screenshots", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-manual-feedback-"))
  initManualFeedbackWorkspace({ reportDir, createdAt: 1 })
  const validation = validateManualFeedbackWorkspace({ reportDir })

  assert.equal(validation.ready, false)
  assert.equal(validation.summary.imported, 10)
  assert.equal(validation.summary.screenshotCount, 10)
  assert.equal(validation.summary.p0, 0)
  assert.equal(validation.gaps.some((gap) => gap.id === "manual_feedback_not_real"), true)
})

test("manual feedback workspace validation rejects sensitive raw fields", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-manual-feedback-"))
  const saved = initManualFeedbackWorkspace({ reportDir, createdAt: 1 })
  const first = saved.templatePaths[0]
  const payload = JSON.parse(fs.readFileSync(first, "utf8"))
  payload.status = "failed"
  payload.severity = "P0"
  payload.promptBody = "DO_NOT_LEAK_PROMPT"
  payload.token = "sk-test-should-not-leak"
  fs.writeFileSync(first, `${JSON.stringify(payload, null, 2)}\n`, "utf8")

  const validation = validateManualFeedbackWorkspace({ reportDir })

  assert.equal(validation.ready, false)
  assert.equal(validation.summary.rejected, 1)
  assert.equal(validation.summary.privacyViolations, 1)
  assert.doesNotMatch(JSON.stringify(validation), /DO_NOT_LEAK_PROMPT/)
  assert.doesNotMatch(JSON.stringify(validation), /sk-test-should-not-leak/)
})

test("manual feedback workspace validation passes when all tasks are marked real", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-manual-feedback-"))
  const saved = initManualFeedbackWorkspace({ reportDir, createdAt: 1 })
  for (const file of saved.templatePaths) {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"))
    payload.status = "passed"
    payload.severity = ""
    payload.score = 5
    payload.manualRunConfirmed = true
    payload.defectStatus = "verified"
    payload.regressionEvidence = { runId: `regression-${payload.taskId}` }
    fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  }

  const validation = validateManualFeedbackWorkspace({ reportDir })

  assert.equal(validation.ready, true)
  assert.equal(validation.summary.imported, 10)
  assert.equal(validation.summary.coveredTasks, 10)
  assert.equal(validation.summary.pendingRegression, 0)
  assert.equal(validation.gaps.length, 0)
})
