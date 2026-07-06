const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  buildPackagedMultiAgentSmoke,
  parseArgs,
  readLatest,
  save,
  toMarkdown,
} = require("./packaged-multi-agent-smoke")

function stage(report) {
  return { report, jsonPath: "fake.json", markdownPath: "fake.md" }
}

function packagedReady() {
  return stage({
    ready: true,
    status: "ready",
    summary: { total: 4, passed: 4, failed: 0, smokeChecks: 65 },
    scope: { packagedEnvironment: true, realLaunchExecuted: true },
  })
}

function acceptanceReady(overrides = {}) {
  return stage({
    ready: true,
    taskSet: "standard",
    total: 123,
    passed: 123,
    failed: 0,
    task: { expectedStrategy: "multi-agent" },
    run: {
      executionStrategy: "multi-agent",
      statusBeforeAccept: "waiting_user",
      writeModeBeforeAccept: "proposed_patch_only",
      statusAfterAccept: "completed",
      writeModeAfterAccept: "applied",
      phaseCount: 5,
      assignmentCount: 5,
      artifactCount: 11,
      filesChanged: ["src/app.js", "src/state.js", "src/view.js"],
    },
    matrix: {
      scenarios: [{
        id: "multi_file_success",
        passed: true,
        strategy: "multi-agent",
        patchArtifactCount: 3,
      }],
    },
    recovery: { actionCount: 1, executedAction: "retry" },
    ...overrides,
  })
}

test("parseArgs reads report directory and no-write", () => {
  const args = parseArgs(["--report-dir=C:/tmp/reports", "--no-write"])
  assert.equal(args.reportDir, "C:/tmp/reports")
  assert.equal(args.noWrite, true)
})

test("packaged multi-agent smoke passes with packaged launch and multi-agent acceptance evidence", () => {
  const report = buildPackagedMultiAgentSmoke({
    createdAt: 1,
    packagedAppSmoke: packagedReady(),
    acceptance: acceptanceReady(),
  })

  assert.equal(report.ready, true)
  assert.equal(report.summary.failed, 0)
  assert.equal(report.evidence.realProjectAcceptance.executionStrategy, "multi-agent")
  assert.match(toMarkdown(report), /Packaged Multi-Agent Smoke/)
})

test("packaged multi-agent smoke blocks when packaged app smoke is missing real launch", () => {
  const report = buildPackagedMultiAgentSmoke({
    createdAt: 1,
    packagedAppSmoke: stage({
      ready: true,
      status: "ready",
      summary: { smokeChecks: 65 },
      scope: { packagedEnvironment: true, realLaunchExecuted: false },
    }),
    acceptance: acceptanceReady(),
  })

  assert.equal(report.ready, false)
  assert.equal(report.checks.find((item) => item.id === "packaged_app_smoke_ready").status, "failed")
})

test("packaged multi-agent smoke blocks when acceptance is not multi-agent proposal-only", () => {
  const report = buildPackagedMultiAgentSmoke({
    createdAt: 1,
    packagedAppSmoke: packagedReady(),
    acceptance: acceptanceReady({
      task: { expectedStrategy: "single-agent" },
      run: {
        executionStrategy: "single-agent",
        statusBeforeAccept: "completed",
        writeModeBeforeAccept: "applied",
        statusAfterAccept: "completed",
        writeModeAfterAccept: "applied",
        phaseCount: 1,
        assignmentCount: 1,
        artifactCount: 1,
        filesChanged: ["demo.js"],
      },
      matrix: { scenarios: [] },
      recovery: { actionCount: 0 },
    }),
  })

  assert.equal(report.ready, false)
  assert.equal(report.checks.find((item) => item.id === "multi_agent_strategy").status, "failed")
  assert.equal(report.checks.find((item) => item.id === "proposal_only_before_accept").status, "failed")
})

test("packaged multi-agent smoke saves latest and history artifacts", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-packaged-agent-"))
  const report = buildPackagedMultiAgentSmoke({
    createdAt: 1,
    packagedAppSmoke: packagedReady(),
    acceptance: acceptanceReady(),
  })
  const saved = save(report, { reportDir })
  const latest = readLatest({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.reportKind, "packaged-multi-agent-smoke")
})
