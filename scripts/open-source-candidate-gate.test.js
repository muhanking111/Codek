const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  betaTrialTaskCount,
  buildOpenSourceCandidateGate,
  readLatest,
  save,
  toMarkdown,
} = require("./open-source-candidate-gate")

function latest(report) {
  return { report, jsonPath: "x.json", markdownPath: "x.md" }
}

test("open-source candidate gate is ready only when AY and BA evidence are ready", () => {
  const report = buildOpenSourceCandidateGate({
    createdAt: 1,
    ay: latest({ ready: true, overallGrade: "public-candidate-ready" }),
    doctor: latest({ ready: true, cleanClone: true, summary: { failed: 0 } }),
    readiness: latest({ ready: true, summary: { failed: 0 } }),
    ci: latest({ ready: true, summary: { failed: 0 } }),
    crossPlatform: latest({ ready: true, summary: { failed: 0 } }),
    releaseDraft: latest({ ready: true, version: "1.0.0", draft: "# draft" }),
    beta: latest({ ready: true, steps: Array.from({ length: 10 }, (_, index) => ({ id: `s${index}` })) }),
  })

  assert.equal(report.ready, true)
  assert.equal(report.overallGrade, "open-source-candidate-ready")
  assert.equal(report.summary.total, 7)
})

test("open-source candidate gate blocks missing clean clone doctor", () => {
  const report = buildOpenSourceCandidateGate({
    createdAt: 1,
    ay: latest({ ready: true, overallGrade: "public-candidate-ready" }),
    doctor: latest({ ready: true, cleanClone: false, summary: { failed: 0 } }),
    readiness: latest({ ready: true, summary: { failed: 0 } }),
    ci: latest({ ready: true, summary: { failed: 0 } }),
    crossPlatform: latest({ ready: true, summary: { failed: 0 } }),
    releaseDraft: latest({ ready: true, version: "1.0.0", draft: "# draft" }),
    beta: latest({ ready: true, steps: Array.from({ length: 10 }, (_, index) => ({ id: `s${index}` })) }),
  })

  assert.equal(report.ready, false)
  assert.equal(report.publicBlockers.some((item) => item.id === "clean_clone_doctor"), true)
})

test("open-source candidate gate accepts current beta trial plan task summary shape", () => {
  const beta = {
    ready: true,
    summary: { requiredTasks: 10 },
    tasks: Array.from({ length: 10 }, (_, index) => ({ id: `BD-T${index + 1}` })),
  }

  assert.equal(betaTrialTaskCount(beta), 10)
  const report = buildOpenSourceCandidateGate({
    createdAt: 1,
    ay: latest({ ready: true, overallGrade: "public-candidate-ready" }),
    doctor: latest({ ready: true, cleanClone: true, summary: { failed: 0 } }),
    readiness: latest({ ready: true, summary: { failed: 0 } }),
    ci: latest({ ready: true, summary: { failed: 0 } }),
    crossPlatform: latest({ ready: true, summary: { failed: 0 } }),
    releaseDraft: latest({ ready: true, version: "1.0.0", draft: "# draft" }),
    beta: latest(beta),
  })

  assert.equal(report.ready, true)
  assert.match(report.stages.find((item) => item.id === "beta_trial").detail, /tasks=10/)
})

test("open-source candidate gate saves latest and history artifacts", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-open-source-gate-"))
  const report = buildOpenSourceCandidateGate({ createdAt: 1, reportDir })
  const saved = save(report, { reportDir })
  const latestReport = readLatest({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latestReport.report.reportKind, "open-source-candidate-gate")
  assert.match(toMarkdown(report), /Open Source Candidate Gate/)
})
