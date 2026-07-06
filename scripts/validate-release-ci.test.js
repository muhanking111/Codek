const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  defaultOpenSourceWorkflowPath,
  defaultReleaseEvidencePath,
  saveReport,
  validateReleaseCiWorkflow,
  validateReleaseEvidenceLatest,
  defaultWorkflowPath,
} = require("./validate-release-ci")

test("defaultWorkflowPath points to the release gate workflow", () => {
  assert.match(defaultWorkflowPath(), /\.github[\\/]workflows[\\/]release-gate\.yml$/)
})

test("defaultReleaseEvidencePath points to release-evidence-latest.json", () => {
  assert.match(defaultReleaseEvidencePath(), /\.codek[\\/]reports[\\/]release-evidence-latest\.json$/)
})

test("defaultOpenSourceWorkflowPath points to the open-source candidate workflow", () => {
  assert.match(defaultOpenSourceWorkflowPath(), /\.github[\\/]workflows[\\/]open-source-candidate\.yml$/)
})

test("validateReleaseCiWorkflow accepts the repository workflow", () => {
  const result = validateReleaseCiWorkflow()

  assert.equal(result.ok, true)
  assert.equal(result.ready, true)
  assert.equal(result.reportKind, "release-ci-readiness")
  assert.equal(result.checks.every((check) => check.passed), true)
  assert.equal(Array.isArray(result.releaseEvidence.checks), true)
})

test("validateReleaseCiWorkflow rejects missing open-source matrix workflow", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-ci-matrix-missing-"))
  const workflowPath = path.join(dir, "release-gate.yml")
  fs.writeFileSync(workflowPath, [
    "name: Release Gate",
    "on: [pull_request, push, workflow_dispatch]",
    "jobs:",
    "  release-gate:",
    "    runs-on: windows-latest",
    "    steps:",
    "      - run: npm ci",
    "      - run: npm run release:gate -- --include-build --no-write",
    "",
  ].join("\n"), "utf8")

  const result = validateReleaseCiWorkflow({ workflowPath, openSourceWorkflowPath: path.join(dir, "missing.yml") })

  assert.equal(result.ok, false)
  assert.equal(result.checks.some((check) => check.id === "open_source_workflow_exists" && !check.passed), true)
})

test("saveReport writes release CI readiness latest artifacts", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-ci-save-"))
  const saved = saveReport({
    ready: true,
    createdAt: 1,
    summary: { total: 1, passed: 1, failed: 0, warning: 0 },
    checks: [{ label: "check", passed: true, detail: "ok" }],
  }, { reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
})

test("validateReleaseEvidenceLatest accepts a valid latest JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-evidence-test-"))
  const evidencePath = path.join(dir, "release-evidence-latest.json")
  fs.writeFileSync(evidencePath, JSON.stringify({
    reportKind: "release-evidence",
    createdAt: Date.now(),
    summary: {
      total: 5,
      available: 4,
      ready: 3,
      missing: 1,
    },
    evidence: {
      releaseGate: { available: true, ready: true },
      acceptance: { available: true, ready: true },
    },
  }), "utf8")

  const result = validateReleaseEvidenceLatest({ releaseEvidencePath: evidencePath, releaseEvidenceRequired: true })

  assert.equal(result.ok, true)
  assert.equal(result.exists, true)
  assert.equal(result.checks.every((check) => check.passed), true)
  assert.equal(result.fresh, true)
  assert.equal(result.ageMs >= 0, true)
})

test("validateReleaseEvidenceLatest warns for stale latest JSON by default", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-evidence-stale-"))
  const evidencePath = path.join(dir, "release-evidence-latest.json")
  fs.writeFileSync(evidencePath, JSON.stringify({
    reportKind: "release-evidence",
    createdAt: 1000,
    summary: {
      total: 5,
      available: 5,
      ready: 5,
      missing: 0,
    },
    evidence: {
      releaseGate: { available: true, ready: true },
    },
  }), "utf8")

  const result = validateReleaseEvidenceLatest({
    releaseEvidencePath: evidencePath,
    now: 1000 + 49 * 60 * 60 * 1000,
    maxAgeMs: 24 * 60 * 60 * 1000,
  })

  assert.equal(result.ok, true)
  assert.equal(result.fresh, false)
  assert.equal(result.ageMs, 49 * 60 * 60 * 1000)
  assert.equal(result.warnings.some((warning) => warning.id === "release_evidence_latest_stale"), true)
})

test("validateReleaseEvidenceLatest fails stale latest JSON when freshness is required", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-evidence-stale-required-"))
  const evidencePath = path.join(dir, "release-evidence-latest.json")
  fs.writeFileSync(evidencePath, JSON.stringify({
    reportKind: "release-evidence",
    createdAt: 1000,
    summary: {
      total: 5,
      available: 5,
      ready: 5,
      missing: 0,
    },
    evidence: {
      releaseGate: { available: true, ready: true },
    },
  }), "utf8")

  const result = validateReleaseEvidenceLatest({
    releaseEvidencePath: evidencePath,
    now: 1000 + 49 * 60 * 60 * 1000,
    maxAgeMs: 24 * 60 * 60 * 1000,
    requireFreshReleaseEvidence: true,
  })

  assert.equal(result.ok, false)
  assert.equal(result.fresh, false)
  assert.equal(result.checks.some((check) => check.id === "release_evidence_fresh" && !check.passed), true)
})

test("validateReleaseEvidenceLatest warns when the default latest JSON is missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-evidence-missing-"))
  const evidencePath = path.join(dir, "release-evidence-latest.json")

  const result = validateReleaseEvidenceLatest({ releaseEvidencePath: evidencePath })

  assert.equal(result.ok, true)
  assert.equal(result.exists, false)
  assert.equal(result.warnings.some((warning) => warning.id === "release_evidence_latest_missing"), true)
})

test("validateReleaseEvidenceLatest fails required malformed latest JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-evidence-bad-"))
  const evidencePath = path.join(dir, "release-evidence-latest.json")
  fs.writeFileSync(evidencePath, JSON.stringify({
    reportKind: "not-release-evidence",
    createdAt: 0,
    summary: {},
  }), "utf8")

  const result = validateReleaseEvidenceLatest({ releaseEvidencePath: evidencePath, releaseEvidenceRequired: true })

  assert.equal(result.ok, false)
  assert.equal(result.exists, true)
  assert.equal(result.checks.some((check) => !check.passed), true)
})

test("validateReleaseCiWorkflow rejects workflows that run full smoke by default", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-ci-test-"))
  const workflowPath = path.join(dir, "release-gate.yml")
  fs.writeFileSync(workflowPath, [
    "name: Release Gate",
    "on: [pull_request, workflow_dispatch]",
    "jobs:",
    "  release-gate:",
    "    runs-on: windows-latest",
    "    steps:",
    "      - run: npm ci",
    "      - run: npm run release:gate -- --full --no-write",
    "",
  ].join("\n"), "utf8")

  const result = validateReleaseCiWorkflow({ workflowPath })

  assert.equal(result.ok, false)
  assert.equal(result.checks.some((check) => check.id === "no_full_mode" && !check.passed), true)
})
