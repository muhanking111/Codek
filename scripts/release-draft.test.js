const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { buildReleaseDraft, readLatest, save } = require("./release-draft")

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

test("release draft is ready when AY, release gate, and package artifacts are ready", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-draft-ready-"))
  writeJson(path.join(reportDir, "ay-public-candidate-gate-latest.json"), { ready: true, overallGrade: "public-candidate-ready" })
  writeJson(path.join(reportDir, "release-gate-latest.json"), { ready: true })
  writeJson(path.join(reportDir, "package-artifacts-latest.json"), {
    ready: true,
    artifacts: [{ kind: "installer" }, { kind: "portable", path: "desktop/release/win-unpacked/Codek.exe" }],
  })

  const report = buildReleaseDraft({ reportDir, version: "1.2.3", createdAt: 1 })

  assert.equal(report.ready, true)
  assert.equal(report.releaseName, "Codek 1.2.3 Open Source Candidate")
  assert.match(report.draft, /Rollback/)
  assert.match(report.draft, /Signing/)
})

test("release draft can be generated while release gate is in progress after draft prerequisites pass", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-draft-gate-progress-"))
  writeJson(path.join(reportDir, "ay-public-candidate-gate-latest.json"), { ready: true, overallGrade: "public-candidate-ready" })
  writeJson(path.join(reportDir, "release-gate-latest.json"), {
    ready: false,
    steps: [
      "typecheck",
      "i_j_smoke_tests",
      "smoke_j",
      "real_workspace_trial_smoke",
      "build",
      "ba_clean_clone_doctor",
      "ba_open_source_readiness",
      "ba_ci_readiness",
      "ba_cross_platform_package_plan",
    ].map((id) => ({ id, passed: true })),
  })
  writeJson(path.join(reportDir, "package-artifacts-latest.json"), {
    ready: true,
    artifacts: [{ kind: "portable", path: "desktop/release/win-unpacked/Codek.exe" }],
  })

  const report = buildReleaseDraft({ reportDir, version: "1.2.3", createdAt: 1, gateInProgress: true })

  assert.equal(report.ready, true)
  assert.equal(report.evidence.gateInProgress, true)
  assert.equal(report.evidence.artifacts.releaseGateStatus, "in_progress_prerequisites_passed")
})

test("release draft accepts live release gate passed step ids during the current run", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-draft-live-gate-progress-"))
  writeJson(path.join(reportDir, "ay-public-candidate-gate-latest.json"), { ready: true, overallGrade: "public-candidate-ready" })
  writeJson(path.join(reportDir, "release-gate-latest.json"), {
    ready: false,
    steps: [{ id: "typecheck", passed: true }, { id: "ba_release_draft", passed: false }],
  })
  writeJson(path.join(reportDir, "package-artifacts-latest.json"), {
    ready: true,
    artifacts: [{ kind: "portable", path: "desktop/release/win-unpacked/Codek.exe" }],
  })

  const report = buildReleaseDraft({
    reportDir,
    version: "1.2.3",
    createdAt: 1,
    gateInProgress: true,
    passedStepIds: [
      "typecheck",
      "i_j_smoke_tests",
      "smoke_j",
      "real_workspace_trial_smoke",
      "build",
      "ba_clean_clone_doctor",
      "ba_open_source_readiness",
      "ba_ci_readiness",
      "ba_cross_platform_package_plan",
    ],
  })

  assert.equal(report.ready, true)
  assert.equal(report.evidence.artifacts.releaseGateStatus, "in_progress_prerequisites_passed")
})

test("release draft saves latest markdown and json", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-draft-save-"))
  const report = buildReleaseDraft({ reportDir, version: "1.2.3", createdAt: 1 })
  const saved = save(report, { reportDir })
  const latest = readLatest({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.reportKind, "release-draft")
  assert.match(latest.markdown, /Codek 1.2.3/)
})
