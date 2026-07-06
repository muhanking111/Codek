const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  buildAyPublicCandidateGate,
  readLatest,
  save,
  toMarkdown,
} = require("./ay-public-candidate-gate")

function stage(report) {
  return { report, jsonPath: "fake.json", markdownPath: "fake.md", available: true }
}

function readySummary() {
  return { total: 1, passed: 1, warning: 0, failed: 0 }
}

function baseInput(overrides = {}) {
  return {
    sourceDoctor: stage({ ready: true, status: "ready", summary: readySummary(), statusLabel: "ok" }),
    packageArtifacts: stage({
      ready: true,
      status: "ready",
      summary: readySummary(),
      artifacts: [
        { name: "Codek-Setup-1.0.0-x64.exe", type: "installer" },
        { name: "win-unpacked/Codek.exe", type: "unpacked" },
      ],
    }),
    installSmoke: stage({
      ready: true,
      status: "ready",
      summary: readySummary(),
      statusLabel: "ok",
      checks: [{ id: "nsis_installer", status: "passed" }],
    }),
    packagedAppSmoke: stage({
      ready: true,
      status: "ready",
      summary: { ...readySummary(), smokeChecks: 12 },
      statusLabel: "packaged ok",
      scope: { realLaunchExecuted: true, packagedEnvironment: true },
    }),
    packagedMultiAgentSmoke: stage({
      ready: true,
      status: "ready",
      summary: { total: 8, passed: 8, warning: 0, failed: 0 },
      statusLabel: "packaged multi-agent ok",
      scope: {
        realLaunchExecuted: true,
        packagedEnvironment: true,
        equivalentPackagedAgentEnvironment: true,
      },
    }),
    functionalSmoke: stage({ ready: true, status: "ready", summary: readySummary(), statusLabel: "ok" }),
    releaseCandidateEvidence: stage({
      overall: { grade: "release-ready", hasInstaller: true, hasUnpacked: true },
      productionBlocked: [],
      reviewItems: [],
    }),
    releaseCandidateRunbook: stage({
      sections: { sourceFallback: ["fallback"], cleanup: ["cleanup"] },
      evidenceSummary: { overallGrade: "release-ready" },
    }),
    productGradeGate: stage({ ready: true, summary: { total: 10, ready: 10, blocked: 0, missing: 0 } }),
    axGate: stage({ ready: true, summary: { total: 16, ready: 16, blocked: 0, missing: 0 } }),
    releaseEvidence: stage({ ready: true, summary: { total: 14, ready: 14, missing: 0 }, gaps: [] }),
    ...overrides,
  }
}

test("AY public candidate gate is ready only when public artifacts and evidence are complete", () => {
  const report = buildAyPublicCandidateGate({ createdAt: 1, ...baseInput() })

  assert.equal(report.overallGrade, "public-candidate-ready")
  assert.equal(report.ready, true)
  assert.equal(report.publicBlockers.length, 0)
})

test("AY public candidate gate marks missing NSIS as internal-only when win-unpacked exists", () => {
  const report = buildAyPublicCandidateGate({
    createdAt: 1,
    ...baseInput({
      packageArtifacts: stage({
        ready: true,
        status: "ready",
        summary: readySummary(),
        artifacts: [{ name: "win-unpacked/Codek.exe", type: "unpacked" }],
      }),
      installSmoke: stage({
        ready: true,
        status: "degraded",
        summary: { total: 2, passed: 1, warning: 1, failed: 0 },
        checks: [{ id: "nsis_installer", status: "warning" }],
      }),
      releaseCandidateEvidence: stage({
        overall: { grade: "internal-allowed-review", hasInstaller: false, hasUnpacked: true },
        productionBlocked: [],
        reviewItems: [{ action: "Generate installer" }],
      }),
    }),
  })

  assert.equal(report.overallGrade, "internal-only")
  assert.equal(report.ready, false)
  assert.equal(report.summary.internalBlocking, 0)
  assert.equal(report.publicBlockers.length > 0, true)
})

test("AY public candidate gate blocks when no runnable packaged artifact exists", () => {
  const report = buildAyPublicCandidateGate({
    createdAt: 1,
    ...baseInput({
      packageArtifacts: stage({
        ready: false,
        status: "blocked",
        summary: { total: 1, passed: 0, warning: 0, failed: 1 },
        artifacts: [],
      }),
    }),
  })

  assert.equal(report.overallGrade, "blocked")
  assert.equal(report.summary.internalBlocking > 0, true)
})

test("AY public candidate gate requires real packaged launch smoke", () => {
  const report = buildAyPublicCandidateGate({
    createdAt: 1,
    ...baseInput({
      packagedAppSmoke: stage({
        ready: false,
        status: "blocked",
        summary: { total: 1, passed: 0, warning: 0, failed: 1, smokeChecks: 0 },
        statusLabel: "packaged app smoke has not run",
        scope: { realLaunchExecuted: false, packagedEnvironment: false },
      }),
    }),
  })

  assert.equal(report.overallGrade, "blocked")
  assert.equal(report.publicBlockers.some((item) => item.id === "packaged_app_smoke"), true)
  assert.equal(report.internalBlockers.some((item) => item.id === "packaged_app_smoke"), true)
})

test("AY public candidate gate requires packaged multi-agent evidence", () => {
  const report = buildAyPublicCandidateGate({
    createdAt: 1,
    ...baseInput({
      packagedMultiAgentSmoke: stage({
        ready: false,
        status: "blocked",
        summary: { total: 1, passed: 0, warning: 0, failed: 1 },
        statusLabel: "packaged multi-agent missing",
        scope: {
          realLaunchExecuted: true,
          packagedEnvironment: true,
          equivalentPackagedAgentEnvironment: false,
        },
      }),
    }),
  })

  assert.equal(report.overallGrade, "blocked")
  assert.equal(report.publicBlockers.some((item) => item.id === "packaged_multi_agent_smoke"), true)
  assert.equal(report.internalBlockers.some((item) => item.id === "packaged_multi_agent_smoke"), true)
})

test("AY public candidate gate allows low-severity release evidence review gaps", () => {
  const report = buildAyPublicCandidateGate({
    createdAt: 1,
    ...baseInput({
      releaseEvidence: stage({
        ready: true,
        summary: { total: 15, ready: 14, missing: 1 },
        gaps: [{ id: "task_runs", severity: "low", status: "missing" }],
      }),
    }),
  })

  assert.equal(report.overallGrade, "public-candidate-ready")
  assert.equal(report.publicBlockers.some((item) => item.id === "release_evidence"), false)
})

test("AY public candidate gate keeps high-severity release evidence gaps out of public candidate", () => {
  const report = buildAyPublicCandidateGate({
    createdAt: 1,
    ...baseInput({
      releaseEvidence: stage({
        ready: true,
        summary: { total: 15, ready: 14, missing: 1 },
        gaps: [{ id: "sandbox_security", severity: "high", status: "not_ready" }],
      }),
    }),
  })

  assert.equal(report.overallGrade, "internal-only")
  assert.equal(report.summary.internalBlocking, 0)
  assert.equal(report.publicBlockers.some((item) => item.id === "release_evidence"), true)
})

test("AY public candidate gate saves latest and history artifacts", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ay-gate-"))
  const report = buildAyPublicCandidateGate({ createdAt: 1, ...baseInput() })
  const saved = save(report, { reportDir })
  const latest = readLatest({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.overallGrade, "public-candidate-ready")
  assert.match(toMarkdown(report), /Public Candidate Gate/)
})
