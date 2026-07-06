const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildProductGradeGate,
  parseArgs,
  readLatestProductGradeGate,
  saveProductGradeGate,
} = require("./au-product-grade-gate")

function summary(total = 1) {
  return { total, passed: total, warning: 0, failed: 0 }
}

function readyFixture() {
  return {
    releaseGate: { ready: true, mode: "product-grade", summary: summary(), plannedSteps: ["workbench_deep_smoke"], steps: [{ passed: true }] },
    releaseEvidence: {
      ready: true,
      reportKind: "release-evidence",
      summary: { total: 9, ready: 9, missing: 0 },
      evidence: {
        sandboxSecurity: {
          available: true,
          ready: true,
          status: "ready",
          statusLabel: "沙箱安全证据已就绪",
          isolatedAssignments: 1,
          assignmentCount: 1,
          qualityGateStatus: "passed",
          commandAuthorizationBlocked: 0,
          violations: [],
        },
      },
    },
    workbenchDeep: { ready: true, reportKind: "workbench-deep-smoke", summary: summary(11) },
    extensions: { ready: true, reportKind: "extension-ecosystem-health", summary: summary(6) },
    provider: { ready: true, reportKind: "provider-health", summary: summary(3) },
    debug: { ready: true, reportKind: "debug-adapter-health", summary: summary(2) },
    goals: { ready: true, reportKind: "goal-runtime-health", summary: summary(3) },
    performance: { ready: true, reportKind: "performance-baseline", summary: summary(2) },
    acceptance: {
      ready: true,
      reportKind: "real-project-acceptance",
      passed: 50,
      total: 50,
      matrix: { passed: 12, total: 12, failed: 0 },
      routerData: { calibration: { total: 12 } },
      failureRecommendations: { total: 0 },
    },
    readiness: { ready: true, reportKind: "orchestrator-readiness", summary: summary(5) },
    realTrial: { ready: true, realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    packaging: { reportKind: "packaging-preflight", summary: summary(4) },
    usage: { reportKind: "llm-usage", totalRequests: 1 },
  }
}

test("parseArgs supports strict, no-write, and report directory", () => {
  const parsed = parseArgs(["--strict", "--no-write", "--report-dir=C:/tmp/au"])
  assert.equal(parsed.strict, true)
  assert.equal(parsed.noWrite, true)
  assert.equal(parsed.reportDir, "C:/tmp/au")
  assert.equal(parseArgs(["--current-release-gate-mode=product-grade"]).currentReleaseGateMode, "product-grade")
})

test("AU product-grade gate falls back to canonical reports when current report dir is partial", () => {
  const currentDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-au-current-"))
  const canonicalDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-au-canonical-"))
  fs.writeFileSync(path.join(currentDir, "workbench-deep-smoke-latest.json"), JSON.stringify({
    ready: true,
    reportKind: "workbench-deep-smoke",
    summary: summary(11),
  }), "utf8")
  fs.writeFileSync(path.join(canonicalDir, "extension-ecosystem-health-latest.json"), JSON.stringify({
    ready: true,
    reportKind: "extension-ecosystem-health",
    summary: summary(6),
  }), "utf8")

  const fixture = readyFixture()
  delete fixture.workbenchDeep
  delete fixture.extensions
  const report = buildProductGradeGate({
    createdAt: 890,
    ...fixture,
    reportDir: currentDir,
    canonicalReportDir: canonicalDir,
  })

  assert.equal(report.capabilities.find((item) => item.id === "au1_workbench").ready, true)
  assert.equal(report.capabilities.find((item) => item.id === "au2_extensions").ready, true)
})

test("AU product-grade gate passes only when AU1-AU10 evidence is ready", () => {
  const report = buildProductGradeGate({ createdAt: 123, ...readyFixture() })

  assert.equal(report.reportKind, "au-product-grade-gate")
  assert.equal(report.ready, true)
  assert.equal(report.summary.ready, 10)
  assert.equal(report.summary.blocked, 0)
  assert.equal(report.capabilities.map((item) => item.au).join(","), "AU1,AU2,AU3,AU4,AU5,AU6,AU7,AU8,AU9,AU10")
  assert.match(report.markdown, /AU 产品级 Cursor\/Codex 差距闭环门禁/)
})

test("AU product-grade gate blocks missing workbench and non product-grade release gate", () => {
  const fixture = readyFixture()
  fixture.workbenchDeep = null
  fixture.releaseGate = { ready: true, mode: "quick", summary: summary() }

  const report = buildProductGradeGate({ createdAt: 456, ...fixture })

  assert.equal(report.ready, false)
  assert.equal(report.capabilities.find((item) => item.id === "au1_workbench").status, "missing")
  assert.equal(report.capabilities.find((item) => item.id === "au10_release_center").ready, false)
  assert.equal(report.nextActions[0].id, "au1_workbench")
})

test("AU product-grade gate blocks when sandbox security evidence is missing from release evidence", () => {
  const fixture = readyFixture()
  fixture.releaseEvidence = {
    ready: true,
    reportKind: "release-evidence",
    summary: { total: 8, ready: 8, missing: 0 },
    evidence: {},
  }

  const report = buildProductGradeGate({ createdAt: 567, ...fixture })
  const security = report.capabilities.find((item) => item.id === "au8_security")

  assert.equal(report.ready, false)
  assert.equal(security.ready, false)
  assert.equal(security.status, "not_ready")
  assert.equal(report.nextActions.some((item) => item.id === "au8_security"), true)
})

test("AU product-grade gate saves latest and history reports", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-au-product-gate-"))
  const report = buildProductGradeGate({ createdAt: 789, ...readyFixture() })
  const saved = saveProductGradeGate(report, { reportDir })

  assert.equal(fs.existsSync(saved.jsonPath), true)
  assert.equal(fs.existsSync(saved.markdownPath), true)
  assert.equal(fs.existsSync(saved.historyJsonPath), true)

  const latest = readLatestProductGradeGate({ reportDir })
  assert.equal(latest.report.reportKind, "au-product-grade-gate")
  assert.match(latest.markdown, /产品级候选/)
})
